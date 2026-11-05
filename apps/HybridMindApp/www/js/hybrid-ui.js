'use strict';

// Hybrid controls: the per-chat route switch, cloud status, and Settings → Cloud / Routing & privacy / Cloud usage.
const CLOUD_PRESETS = {
  azure: { label: 'Azure OpenAI / Azure AI Foundry', endpoint: 'https://YOUR-RESOURCE.services.ai.azure.com', model: 'Deployment name, e.g. gpt-5.4 (not the version date)', note: 'Paste the resource endpoint — a Foundry “Project endpoint” or a full URL is shortened to the resource automatically. The model field is your DEPLOYMENT name from the Deployments page. Leave API version empty to use the Azure v1 API.' },
  openai: { label: 'OpenAI', endpoint: 'https://api.openai.com/v1', model: 'Model, e.g. gpt-4.1-mini', note: 'Bearer authentication against the OpenAI API.' },
  compatible: { label: 'Other OpenAI-compatible service', endpoint: 'https://your-service.example.com/v1', model: 'Model name', note: 'Any server that implements /chat/completions (OpenRouter, a company gateway, LM Studio on localhost…). Plain http is allowed only for localhost.' },
};

function updateRouteUi() {
  const c = App.chat; if (!c) return;
  const mode = Router.modeOf(c);
  $('btnAgent').classList.toggle('on', !!c.agent);
  $('btnAgent').title = c.agent === 'local' ? 'Local agent on (click to change)' : c.agent ? 'Cloud agent on (click to change)' : 'Agent mode: let a model use tools on your allowed folders';
  $('input').placeholder = c.agent ? 'Ask the agent to search, read and write files in your allowed folders…' : 'Message HybridMind…  (type / for commands)';
  document.querySelectorAll('#routeSeg button').forEach((b) => b.classList.toggle('on', b.dataset.route === mode));
  const ready = Router.ready();
  const st = App.cloudState || (ready ? 'configured' : 'unset');
  $('cdot').className = 'dot' + (st === 'ok' ? ' ok' : st === 'bad' ? ' bad' : st === 'configured' ? ' busy' : '');
  $('cloudTxt').textContent = ready ? (Router.cfg.model.length > 14 ? Router.cfg.model.slice(0, 13) + '…' : Router.cfg.model) : 'Cloud off';
  $('cloudStatus').title = ready ? `Cloud model: ${Router.cfg.model} at ${Router.host()}${st === 'ok' ? ' — connection tested' : st === 'bad' ? ' — last call failed' : ''}. Click to configure.` : 'Cloud model not set up — click to configure. Everything works on-device without it.';
  const used = Store.cloudSentToday();
  const cap = Store.settings.route.dailyCharCap;
  $('hintMain').innerHTML = c.agent === 'local' ? '<b>Local agent.</b> A model on this PC works with tools on your allowed folders. Nothing leaves the PC; writes need your approval.' : c.agent ? '<b>Cloud agent.</b> The cloud model works with tools on your allowed folders; what it reads is sent to it, writes need your approval.' : mode === 'device' ? '<b>On-device only.</b> Nothing leaves this PC in this chat.'
    : mode === 'cloud' ? `<b>Cloud.</b> Messages go to ${esc(ready ? Router.cfg.model : 'the cloud model')} (you see what is sent).`
    : ready ? `<b>Auto.</b> On-device first; cloud only when needed${used ? ` · ${used.toLocaleString()} chars sent today${cap ? ' of ' + cap.toLocaleString() : ''}` : ''}.`
    : '<b>On-device.</b> Add a cloud model in Settings → Cloud to let hard requests escalate.';
}

function wireHybrid() {
  $('routeSeg').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-route]'); if (!b) return;
    const c = App.chat, mode = b.dataset.route;
    if (mode !== 'device' && !Router.ready()) { toast('Cloud isn’t set up yet — add an endpoint, model and key first.'); openSettings('cloud'); return; }
    c.route = mode;
    if (!c.temporary && Store.path(c).length) Store.saveChat(c);
    updateRouteUi();
  });
  $('btnAgent').onclick = () => agentMenu();
  $('cloudStatus').onclick = () => openSettings('cloud');
  $('cloudStatus').onkeydown = (e) => { if (e.key === 'Enter') openSettings('cloud'); };
}

// ── Settings → Cloud ───────────────────────────────────────────────────
function tabCloud(el) {
  const c = Router.cfg || { provider: 'azure', endpoint: '', model: '', apiVersion: '2024-10-21', imageModel: '', maxTokens: 3000, vision: false, hasKey: false };
  const draft = { ...c, apiKey: '' };
  const prov = h('select', { class: 'sel', onchange: (e) => { draft.provider = e.target.value; ep.placeholder = CLOUD_PRESETS[draft.provider].endpoint; mdl.placeholder = CLOUD_PRESETS[draft.provider].model; note.textContent = CLOUD_PRESETS[draft.provider].note; verRow.style.display = draft.provider === 'azure' ? '' : 'none'; } });
  for (const [k, v] of Object.entries(CLOUD_PRESETS)) prov.append(h('option', { value: k, selected: k === draft.provider }, v.label));
  const note = h('div', { class: 'help' }, CLOUD_PRESETS[draft.provider].note);
  const ep = h('input', { class: 'in', value: draft.endpoint, placeholder: CLOUD_PRESETS[draft.provider].endpoint, oninput: (e) => { draft.endpoint = e.target.value; } });
  const mdl = h('input', { class: 'in', value: draft.model, placeholder: CLOUD_PRESETS[draft.provider].model, oninput: (e) => { draft.model = e.target.value; } });
  const verHint = h('div', { class: 'help', style: 'color:var(--warn)' });
  const checkVer = () => { const v = (draft.apiVersion || '').trim(); const m = /^(\d{4})-\d{2}-\d{2}$/.exec(v); verHint.textContent = m && +m[1] >= 2026 ? 'That looks like a model version (as shown in the Deployments table). API versions look like 2024-10-21 — or leave this empty to use the Azure v1 API.' : ''; };
  const ver = h('input', { class: 'in', value: draft.apiVersion, placeholder: 'Empty = Azure v1 API (recommended)', oninput: (e) => { draft.apiVersion = e.target.value; checkVer(); } });
  const verRow = field('API version (Azure, optional)', ver, 'Leave empty unless you need a specific dated version, e.g. 2024-10-21.');
  verRow.append(verHint); checkVer();
  verRow.style.display = draft.provider === 'azure' ? '' : 'none';
  const key = h('input', { class: 'in', type: 'password', autocomplete: 'off', placeholder: c.hasKey ? '•••••••• saved — leave empty to keep it' : 'Paste your API key', oninput: (e) => { draft.apiKey = e.target.value; } });
  const img = h('input', { class: 'in', value: draft.imageModel, placeholder: 'Optional, e.g. gpt-image-1 or dall-e-3', oninput: (e) => { draft.imageModel = e.target.value; } });
  const tok = h('input', { class: 'in', type: 'number', min: 64, max: 16000, value: draft.maxTokens, oninput: (e) => { draft.maxTokens = +e.target.value || 1500; } });
  const result = h('div', { style: 'margin-top:10px' });
  const doSave = async () => {
    try {
      const hadKey = !!(Router.cfg && Router.cfg.hasKey);
      const saved = await Native.cloudConfigSet({ provider: draft.provider, endpoint: draft.endpoint.trim(), model: draft.model.trim(), apiVersion: draft.apiVersion.trim(), imageModel: draft.imageModel.trim(), maxTokens: draft.maxTokens, vision: draft.vision, apiKey: draft.apiKey || null, clearKey: false });
      Router.cfg = saved; draft.apiKey = ''; key.value = ''; key.placeholder = saved.hasKey ? '•••••••• saved — leave empty to keep it' : 'Paste your API key';
      draft.endpoint = saved.endpoint; ep.value = saved.endpoint;   // Azure endpoints are normalised by the host
      App.cloudState = null; updateRouteUi();
      if (hadKey && !saved.hasKey) toast('The endpoint changed, so the saved API key was removed for safety. Enter the key again.', null, 6000);
      return true;
    } catch (e) { result.innerHTML = `<div class="errbox">${esc(e.message)}</div>`; return false; }
  };
  el.append(
    h('div', { class: 'note' }, h('b', {}, 'Optional. '), 'HybridMind works fully on-device. Add your own cloud model to let requests the on-device model can’t handle (very long inputs, hard reasoning, a failed local answer) go to it — never without the rules you set in ', h('b', {}, 'Routing & privacy'), '.'),
    field('Service', prov, null), note, field('Endpoint', ep, 'The page itself can’t reach the network; the app’s host process makes the call, only to this address, and does not follow redirects.'),
    field('Model / deployment name', mdl), verRow,
    field('API key', key, 'Stored encrypted for your Windows account (DPAPI). It is sent only to the endpoint above and can’t be read back by the app’s web page — you can only replace or delete it.'),
    h('div', { class: 'help', style: 'margin:-6px 0 8px' }, c.hasKey ? h('button', { class: 'btn sm danger', onclick: async () => { Router.cfg = await Native.cloudConfigSet({ ...draft, apiKey: null, clearKey: true }); App.cloudState = null; updateRouteUi(); toast('API key deleted.'); tabRedraw(el); } }, 'Delete saved key') : ''),
    h('h3', {}, 'Options'),
    field('Max output tokens', tok), field('Image model (optional)', img, 'Used as a fallback when the on-device picture generator isn’t available. Leave empty to disable cloud pictures.'),
    toggleRow('This model accepts pictures (vision)', 'Lets a question about an attached picture be answered by looking at it — only if “Send pictures” is on in Routing & privacy.', draft.vision, (v) => { draft.vision = v; }),
    h('div', { style: 'display:flex;gap:8px;margin-top:14px' },
      h('button', { class: 'btn pri', onclick: async () => { if (await doSave()) { result.innerHTML = '<div class="note">Saved.</div>'; } } }, 'Save'),
      h('button', { class: 'btn', onclick: async () => {
        if (!(await doSave())) return;
        result.innerHTML = '<div class="note">Testing…</div>';
        try {
          const r = await Native.cloudTest();
          App.cloudState = r.ok ? 'ok' : 'bad'; updateRouteUi();
          result.innerHTML = r.ok ? `<div class="note">Connected — ${esc(r.model)} answered in ${r.ms} ms.</div>` : `<div class="errbox">${esc(r.error || 'Test failed')}</div>`;
        } catch (e) { result.innerHTML = `<div class="errbox">${esc(e.message)}</div>`; }
      } }, 'Save & test connection')),
    result);
}
const tabRedraw = (el) => { el.innerHTML = ''; tabCloud(el); };

// ── Settings → Routing & privacy ───────────────────────────────────────
function tabRouting(el) {
  const s = Store.settings.route;
  const sv = () => { Store.saveSettings(); updateRouteUi(); };
  el.append(
    h('div', { class: 'note' }, h('b', {}, 'How routing works. '), 'In ', h('b', {}, 'Auto'), ' mode every message is first judged: can the on-device Windows AI model do this well? If yes it stays on your PC. If not — it’s too long, needs hard reasoning, the local model is unavailable, or the local answer looked unreliable — it may go to your cloud model, subject to the rules below. Each reply says where it ran and why.'),
    h('h3', {}, 'Routing'),
    field('Default for new chats', seg([['auto', 'Auto'], ['device', 'On-device'], ['cloud', 'Cloud']], s.mode, (v) => { s.mode = v; sv(); })),
    field('How readily Auto uses the cloud', seg([['local-first', 'Only when needed'], ['balanced', 'Balanced'], ['quality-first', 'Quality first']], s.policy, (v) => { s.policy = v; sv(); }), 'Only when needed: long inputs, local failures and clearly hard tasks. Balanced: also moderately hard tasks. Quality first: anything non-trivial.'),
    toggleRow('Fall back automatically', 'If the cloud can’t be reached the answer is produced on-device; if the on-device answer fails or looks unreliable, the cloud is tried (still subject to consent).', s.autoFallback, (v) => { s.autoFallback = v; sv(); }),
    h('h3', {}, 'Consent'),
    field('Before the cloud is used', seg([['ask', 'Ask once per chat'], ['always', 'Don’t ask'], ['never', 'Only when I click “Retry in cloud”']], s.consent, (v) => { s.consent = v; sv(); }), 'You always see the destination and can preview the exact text. Choosing Cloud for a chat, or clicking “Retry in cloud”, counts as consent for that message.'),
    h('h3', {}, 'Privacy guard'),
    field('If sensitive-looking data is found', seg([['redact', 'Redact & send'], ['ask', 'Ask me'], ['block', 'Keep on device']], s.privacy, (v) => { s.privacy = v; sv(); }), 'Detects API keys and secrets, passwords, payment-card numbers, IBANs, ID-like numbers, e-mail addresses and phone numbers. It does not understand meaning, so names, addresses and confidential wording are not caught.'),
    toggleRow('Send my personalisation', 'Your name, “about you”, memories and recalled chats. Off by default — the cloud then sees only the conversation and what you attach.', s.sendPersonal, (v) => { s.sendPersonal = v; sv(); }),
    toggleRow('Send attached files', 'Small files in full, bigger ones as the few passages found on-device by your question. Turn off to keep every file strictly local (questions about files then stay on-device).', s.sendFiles, (v) => { s.sendFiles = v; sv(); }),
    toggleRow('Send pictures', 'Attached pictures go to a vision-capable cloud model (needs “accepts pictures” in Cloud settings). Otherwise the cloud only gets the on-device description.', s.sendImages, (v) => { s.sendImages = v; sv(); }),
    toggleRow('Allow temporary chats to use the cloud', 'Temporary chats stay on-device unless you choose Cloud for them explicitly.', s.allowTemporary, (v) => { s.allowTemporary = v; sv(); }),
    h('h3', {}, 'Limits'),
    field('Daily cloud limit (characters sent)', (() => { const sel = h('select', { class: 'sel', onchange: (e) => { s.dailyCharCap = +e.target.value; sv(); } }); [[0, 'No limit'], [50000, '50,000'], [150000, '150,000'], [300000, '300,000 (default)'], [1000000, '1,000,000']].forEach(([v, l]) => sel.append(h('option', { value: v, selected: v === s.dailyCap || v === s.dailyCharCap }, l))); return sel; })(), 'When the limit is reached, Auto stays on-device until tomorrow. Roughly 4 characters ≈ 1 token.'));
}

// ── Settings → Cloud usage ─────────────────────────────────────────────
function tabUsage(el) {
  const log = Store.cloudLog, d0 = dayStart(Date.now());
  const sentToday = Store.cloudSentToday(), n = log.filter((e) => e.sent).length;
  el.append(
    h('div', { class: 'note' }, 'This log lives only on this PC. It records when something was (or wasn’t) sent to the cloud, why, how much and whether values were redacted — never the text itself.'),
    h('dl', { class: 'kv', html: `<dt>Sent today</dt><dd>${sentToday.toLocaleString()} characters${Store.settings.route.dailyCharCap ? ' of ' + Store.settings.route.dailyCharCap.toLocaleString() : ''}</dd><dt>All logged calls</dt><dd>${n} sent · ${log.filter((e) => !e.sent).length} kept on device</dd><dt>Redacted values</dt><dd>${log.reduce((a, e) => a + (e.redactions || 0), 0)}</dd><dt>Tokens (reported)</dt><dd>${log.reduce((a, e) => a + (e.tokensIn || 0), 0).toLocaleString()} in · ${log.reduce((a, e) => a + (e.tokensOut || 0), 0).toLocaleString()} out</dd>` }));
  if (!log.length) { el.append(h('div', { class: 'empty' }, 'Nothing has been sent to the cloud yet.')); return; }
  const tbl = h('div', { class: 'tbl' }, h('table', {}, h('thead', {}, h('tr', {}, ['When', 'Chat', 'Model', 'Result', 'Chars', 'Why'].map((x) => h('th', {}, x)))),
    h('tbody', {}, log.slice(0, 80).map((e) => h('tr', {}, h('td', {}, new Date(e.ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })), h('td', {}, (e.title || '').slice(0, 28)), h('td', {}, e.model || ''),
      h('td', {}, e.sent ? (e.ok ? 'sent' : 'failed (' + (e.error || '?') + ')') : e.blocked ? 'blocked: ' + e.blocked.join(', ').toLowerCase() : 'kept on device'), h('td', {}, e.sent ? (e.chars || 0).toLocaleString() + (e.redactions ? ' · ' + e.redactions + ' redacted' : '') : '—'), h('td', {}, (e.reason || '').slice(0, 70)))))));
  el.append(h('div', { style: 'margin:12px 0' }, tbl),
    h('div', { style: 'display:flex;gap:8px' },
      h('button', { class: 'btn', onclick: async () => { const csv = ['time,chat,model,sent,ok,chars,redactions,tokens_in,tokens_out,reason'].concat(log.map((e) => [new Date(e.ts).toISOString(), JSON.stringify(e.title || ''), e.model, e.sent, e.ok, e.chars || 0, e.redactions || 0, e.tokensIn || 0, e.tokensOut || 0, JSON.stringify(e.reason || '')].join(','))).join('\n'); const p = await Native.saveFile('hybridmind-cloud-usage.csv', csv); if (p) toast('Saved to ' + p); } }, h('span', { html: ic('download') }), 'Export CSV'),
      h('button', { class: 'btn danger', onclick: () => confirmBox('Clear the usage log?', 'This removes the record only; it doesn’t change anything else.', 'Clear', () => { Store.clearCloudLog(); updateRouteUi(); el.innerHTML = ''; tabUsage(el); }) }, 'Clear log')));
}
