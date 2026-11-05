'use strict';

// The ⚡ button: choose which engine drives agent mode in this chat — the cloud model or a local model on this PC.
const LOCAL_PRESETS = [
  ['Foundry Local', 'http://127.0.0.1:60084/v1'],
  ['LM Studio', 'http://127.0.0.1:1234/v1'],
  ['Ollama', 'http://127.0.0.1:11434/v1'],
];

function setAgentKind(kind) {
  const c = App.chat;
  c.agent = kind || false;
  if (kind === 'cloud' && c.route === 'device') c.route = 'auto';
  if (!c.temporary && Store.path(c).length) Store.saveChat(c);
  updateRouteUi();
  toast(kind === 'local' ? 'Local agent on: a model on this PC works with your allowed folders. Nothing leaves the PC; each write needs your OK.'
    : kind === 'cloud' ? 'Cloud agent on: your cloud model works with your allowed folders (what it reads is sent to it); each write needs your OK.' : 'Agent mode off.', null, 5500);
}

async function agentMenu() {
  const c = App.chat;
  let lc = null;
  try { lc = await Native.localAgentGet(); } catch { /* ignore */ }
  const cloudOk = Router.ready(), localOk = !!(lc && lc.endpoint && lc.model);
  const mark = (k) => (c.agent === k || (k === 'cloud' && c.agent === true) ? '✓ ' : '');
  popMenu($('btnAgent'), [
    { header: 'Agent mode — who does the work?' },
    { label: mark('cloud') + 'Cloud agent' + (cloudOk ? ' · ' + Router.cfg.model : ' (set up in Settings → Cloud)'), icon: 'cloud', fn: () => { if (!cloudOk) { toast('Add a cloud model first.'); openSettings('cloud'); } else setAgentKind('cloud'); } },
    { label: mark('local') + 'Local agent' + (localOk ? ' · ' + lc.model : ' (set up…)'), icon: 'cpu', fn: () => (localOk ? setAgentKind('local') : openLocalAgentSetup(() => setAgentKind('local'))) },
    { label: 'Choose local model…', icon: 'gear', fn: () => openLocalAgentSetup(() => { if (c.agent !== 'local') setAgentKind('local'); }) },
    'hr',
    c.agent ? { label: 'Turn agent mode off', icon: 'x', fn: () => setAgentKind(false) } : { label: 'Agent folders & limits…', icon: 'folder', fn: () => openSettings('agent') },
  ], { up: true });
}

// ── local agent setup dialog ───────────────────────────────────────────
async function openLocalAgentSetup(done) {
  let cfg;
  try { cfg = await Native.localAgentGet(); } catch (e) { toast(e.message); return; }
  const draft = { endpoint: cfg.endpoint || LOCAL_PRESETS[0][1], model: cfg.model || '', maxTokens: cfg.maxTokens && cfg.maxTokens <= 4096 ? cfg.maxTokens : 1024 };
  const ep = h('input', { class: 'in', value: draft.endpoint, oninput: (e) => { draft.endpoint = e.target.value.trim(); } });
  const list = h('datalist', { id: 'localModels' });
  const mdl = h('input', { class: 'in', list: 'localModels', value: draft.model, placeholder: 'Model id, e.g. phi-4-mini-instruct-openvino-npu', oninput: (e) => { draft.model = e.target.value.trim(); } });
  const tok = h('input', { class: 'in', type: 'number', min: 128, max: 4096, value: draft.maxTokens, oninput: (e) => { draft.maxTokens = +e.target.value || 1024; } });
  const out = h('div', { style: 'margin-top:10px' });
  const presets = h('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px' }, LOCAL_PRESETS.map(([n, u]) => h('button', { class: 'btn sm', onclick: () => { ep.value = u; draft.endpoint = u; } }, n)));
  const save = async () => {
    const saved = await Native.localAgentSet({ provider: 'compatible', endpoint: draft.endpoint, model: draft.model, apiVersion: '', imageModel: '', maxTokens: draft.maxTokens, vision: false, apiKey: null, clearKey: false });
    cfg = saved; return saved;
  };
  const detect = async () => {
    out.innerHTML = '<div class="note">Looking for models…</div>';
    try {
      await save();
      const r = await Native.localAgentModels();
      if (r.error) { out.innerHTML = `<div class="errbox">${esc(r.error)}</div>`; return; }
      list.innerHTML = '';
      r.models.forEach((m) => list.append(h('option', { value: m })));
      out.innerHTML = `<div class="note">${r.models.length} model${r.models.length === 1 ? '' : 's'} found. Start typing in the model box to pick one. Foundry Local lists its whole catalog; a model must be <b>loaded</b> (<code>foundry model load &lt;alias&gt;</code>) and should show <b>Tools ●</b> in <code>foundry model list</code>.</div>`;
    } catch (e) { out.innerHTML = `<div class="errbox">${esc(e.message)}</div>`; }
  };
  const test = async () => {
    if (!draft.model) { out.innerHTML = '<div class="errbox">Pick a model first.</div>'; return; }
    out.innerHTML = '<div class="note">Testing tool calling — a loaded NPU model can take 10–40 s on its first request…</div>';
    try {
      await save();
      const r = await Native.localAgentTest();
      out.innerHTML = r.ok ? `<div class="note">Tool calling works — ${esc(r.model)} called the tool correctly in ${(r.ms / 1000).toFixed(1)} s.</div>` : `<div class="errbox">${esc(r.error || 'Test failed')}</div>`;
    } catch (e) { out.innerHTML = `<div class="errbox">${esc(e.message)}</div>`; }
  };
  const body = h('div', {},
    h('div', { class: 'note' }, 'The local agent uses a model served on this PC through an OpenAI-compatible API (for example ', h('b', {}, 'Foundry Local'), '). Everything stays on your machine — only loopback addresses are accepted.'),
    field('Server', h('div', {}, presets, ep), 'Foundry Local: http://127.0.0.1:60084/v1 (check “foundry server status”).'),
    h('div', { style: 'margin:-4px 0 6px' }, h('button', { class: 'btn sm', onclick: detect }, h('span', { html: ic('search') }), 'Detect models')),
    field('Model', h('div', {}, mdl, list), 'Small models do best with tool calling when they are marked “Tools” (e.g. phi-4-mini on NPU, qwen2.5/qwen3 on GPU).'),
    field('Max output tokens', tok, 'NPU models in Foundry Local cap near 1,500 tokens; 1,024 is safe.'),
    toggleRow('Compact mode for small models', 'Shorter instructions, five tools, smaller file excerpts, at most 8 steps — small context windows need it.', Store.settings.agentCompact !== false, (v) => { Store.settings.agentCompact = v; Store.saveSettings(); }),
    h('div', { style: 'display:flex;gap:8px;margin-top:6px' }, h('button', { class: 'btn', onclick: test }, 'Test tool calling')), out);
  openModal({ title: 'Local agent', body, actions: [
    { label: 'Cancel', fn: (c) => c() },
    { label: 'Save & use', pri: true, fn: async (c) => {
      if (!draft.model) { toast('Pick a model.'); return; }
      try { await save(); c(); updateRouteUi(); done && done(); } catch (e) { out.innerHTML = `<div class="errbox">${esc(e.message)}</div>`; }
    } }] });
}
