'use strict';

// Dialogs: settings, memory, knowledge library, assistants, projects, search, message info, export / import.
const field = (label, input, help) => h('div', { class: 'field' }, h('label', {}, label), input, help ? h('div', { class: 'help' }, help) : null);
const toggleRow = (title, desc, checked, onchange) =>
  h('div', { class: 'toggle' }, h('div', { class: 'tx' }, h('b', {}, title), desc ? h('span', {}, desc) : null),
    h('label', { class: 'sw' }, h('input', { type: 'checkbox', checked, onchange: (e) => onchange(e.target.checked) }), h('i')));
const seg = (opts, cur, fn) => { const el = h('div', { class: 'seg' }); opts.forEach(([v, l]) => el.append(h('button', { class: v === cur ? 'on' : '', onclick: (e) => { el.querySelectorAll('button').forEach((b) => b.classList.remove('on')); e.target.classList.add('on'); fn(v); } }, l))); return el; };
const saveSettings = () => { Store.saveSettings(); };

// ── settings ───────────────────────────────────────────────────────────
function openSettings(tab) {
  const tabs = [['general', 'gear', 'General'], ['personal', 'wand', 'Personalization'], ['skills', 'bolt', 'Skills'], ['cloud', 'cloud', 'Cloud'], ['agent', 'bolt', 'Agent'], ['routing', 'lock', 'Routing & privacy'], ['usage', 'table', 'Cloud usage'], ['knowledge', 'book', 'Files & knowledge'], ['model', 'cpu', 'Model'], ['data', 'download', 'Data'], ['about', 'info', 'About']];
  let cur = tab || 'general';
  const bodyEl = h('div', { class: 'tabbody' });
  const nav = h('div', { class: 'tabs' });
  const draw = () => {
    nav.innerHTML = '';
    tabs.forEach(([id, icon, label]) => nav.append(h('button', { class: id === cur ? 'on' : '', onclick: () => { cur = id; draw(); } }, h('span', { html: ic(icon) }), label)));
    bodyEl.innerHTML = '';
    ({ general: tabGeneral, personal: tabPersonal, skills: tabSkills, cloud: tabCloud, agent: tabAgent, routing: tabRouting, usage: tabUsage, knowledge: tabKnowledge, model: tabModel, data: tabData, about: tabAbout })[cur](bodyEl);
    bodyEl.scrollTop = 0;
  };
  draw();
  openModal({ title: 'Settings', wide: true, tabs: true, body: h('div', { class: 'tabs-layout' }, nav, bodyEl), onClose: () => { Store.saveSettings(); renderTop(); renderThread(true); } });
}

function tabGeneral(el) {
  const s = Store.settings;
  el.append(h('h3', {}, 'Appearance'),
    field('Theme', seg([['system', 'System'], ['dark', 'Dark'], ['light', 'Light']], s.theme, (v) => { s.theme = v; applyTheme(); saveSettings(); })),
    field('Text size', h('input', { type: 'range', min: 13, max: 19, step: 0.5, value: s.fontSize, oninput: (e) => { s.fontSize = +e.target.value; applyTheme(); saveSettings(); } })),
    h('h3', {}, 'Chat'),
    toggleRow('Press Enter to send', 'Shift+Enter adds a new line. Turn off to send with Ctrl+Enter.', s.enterToSend, (v) => { s.enterToSend = v; saveSettings(); }),
    toggleRow('Show timing under replies', 'First-word time, total time and speed — a peek at how the on-device model performs.', s.showStats, (v) => { s.showStats = v; saveSettings(); }),
    toggleRow('Exact tools', 'Calculator, unit conversion and date maths run as code and are handed to the model as facts.', s.tools, (v) => { s.tools = v; saveSettings(); }),
    h('h3', {}, 'Read aloud'));
  const sel = h('select', { class: 'sel', onchange: (e) => { s.voice = e.target.value; saveSettings(); } });
  const fill = () => {
    sel.innerHTML = '';
    sel.append(h('option', { value: '' }, 'Automatic (matches your language)'));
    if ('speechSynthesis' in window) speechSynthesis.getVoices().filter((v) => v.localService).forEach((v) => sel.append(h('option', { value: v.name, selected: v.name === s.voice }, `${v.name} (${v.lang})`)));
  };
  fill(); if ('speechSynthesis' in window) speechSynthesis.onvoiceschanged = fill;
  el.append(field('Voice', sel, 'Only voices installed on this PC are offered, so reading aloud never uses the cloud.'),
    field('Speed', h('input', { type: 'range', min: 0.6, max: 1.6, step: 0.1, value: s.rate, oninput: (e) => { s.rate = +e.target.value; saveSettings(); } })));
  const as = h('select', { class: 'sel', onchange: (e) => { s.defaultAssistant = e.target.value; saveSettings(); } });
  Store.allAssistants().forEach((a) => as.append(h('option', { value: a.id, selected: a.id === s.defaultAssistant }, a.name)));
  el.append(h('h3', {}, 'New chats'), field('Default assistant', as));
}

function tabPersonal(el) {
  const s = Store.settings;
  el.append(h('p', { style: 'color:var(--muted);margin:6px 0 0' }, 'These are stored on this PC and added to every chat so replies fit you.'),
    field('What should HybridMind call you?', h('input', { class: 'in', value: s.nickname, maxlength: 60, oninput: (e) => { s.nickname = e.target.value; saveSettings(); } })),
    field('About you', h('textarea', { class: 'ta', maxlength: 500, placeholder: 'Your job, interests, what you’re working on…', value: s.about, oninput: (e) => { s.about = e.target.value; saveSettings(); } }), 'Up to 500 characters.'),
    field('How should it respond?', h('textarea', { class: 'ta', maxlength: 500, placeholder: 'e.g. Use British English. Avoid jargon. Give examples.', value: s.style, oninput: (e) => { s.style = e.target.value; saveSettings(); } }), 'Up to 500 characters.'),
    field('Answer length', seg([['concise', 'Concise'], ['balanced', 'Balanced'], ['detailed', 'Detailed']], s.length, (v) => { s.length = v; saveSettings(); })),
    h('h3', {}, 'Memory'),
    toggleRow('Use memory', 'Let HybridMind keep facts about you across chats and use them in replies.', s.memory, (v) => { s.memory = v; saveSettings(); }),
    toggleRow('Save facts automatically', 'After you state something about yourself, a background job proposes a memory (shown with Undo). “Remember that…” always works.', s.autoMemory, (v) => { s.autoMemory = v; saveSettings(); }),
    toggleRow('Refer to past chats', 'When you say “earlier” or “last time”, search your other chats for relevant snippets.', s.recall, (v) => { s.recall = v; saveSettings(); }),
    h('div', { style: 'margin-top:12px' }, h('button', { class: 'btn', onclick: () => { openMemory(); } }, h('span', { html: ic('brain') }), 'Manage memory (' + Store.memories.length + ')')));
}

function tabModel(el) {
  const s = Store.settings;
  const info = h('div', { class: 'note' }, 'Checking the on-device model…');
  el.append(h('h3', {}, 'On-device AI'), info);
  Native.sysInfo().then((i) => {
    info.className = 'note' + (i.model === 'Ready' ? '' : ' warn');
    const st = (v) => (v === 'Ready' ? 'Ready' : v === 'NotReady' ? 'Not downloaded yet (Windows fetches it on first use)' : v === 'NotSupportedOnCurrentSystem' ? 'Not supported on this PC' : esc(v));
    info.innerHTML = `<dl class="kv"><dt>Language model</dt><dd>Phi Silica — ${esc(i.model)}</dd><dt>Text recognition (OCR)</dt><dd>${esc(i.ocr)}</dd><dt>Photo description</dt><dd>${esc(i.describe)}</dd><dt>Picture generator</dt><dd>${st(i.imageGen)}</dd><dt>Picture upscaler</dt><dd>${st(i.scaler)}</dd><dt>Background remover</dt><dd>${st(i.cutout)}</dd><dt>Runs on</dt><dd>This PC’s NPU through Windows AI APIs. A cloud model is used only if you configure one and the routing rules allow it.</dd></dl>`;
  }).catch((e) => { info.textContent = e.message; });
  const useDef = s.temperature == null;
  const slider = h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: s.temperature ?? 0.7, disabled: useDef, oninput: (e) => { s.temperature = +e.target.value; lab.textContent = s.temperature.toFixed(2); saveSettings(); } });
  const lab = h('span', { style: 'color:var(--muted);margin-left:8px' }, useDef ? 'model default' : s.temperature.toFixed(2));
  const defCb = h('input', { type: 'checkbox', checked: useDef, onchange: (e) => { if (e.target.checked) { s.temperature = null; slider.disabled = true; lab.textContent = 'model default'; } else { s.temperature = +slider.value; slider.disabled = false; lab.textContent = s.temperature.toFixed(2); } saveSettings(); } });
  el.append(h('h3', {}, 'Creativity'),
    field('Temperature', h('div', {}, h('label', { style: 'display:flex;gap:8px;align-items:center;font-weight:400;margin-bottom:8px' }, defCb, 'Use the model’s default', lab), slider), 'Lower is steadier and more literal; higher is more varied. Most people should leave the default.'),
    h('h3', {}, 'Context budget'),
    field('Characters sent to the model per reply', (() => { const sel = h('select', { class: 'sel', onchange: (e) => { s.maxPrompt = +e.target.value; saveSettings(); } }); [[5000, '5,000 — fastest'], [7500, '7,500 — balanced (default)'], [10000, '10,000 — more history and file excerpts, slower first word']].forEach(([v, l]) => sel.append(h('option', { value: v, selected: v === s.maxPrompt }, l))); return sel; })(),
      'The on-device model has a limited context window. HybridMind measures what fits with the real model, drops the oldest turns first, and keeps a rolling summary of them.'),
    h('div', { style: 'margin-top:14px' }, h('button', { class: 'btn', onclick: async () => { setStatus('busy', 'Checking…'); await initModel(); toast(App.model.ok ? 'Model is ready.' : App.model.text); } }, h('span', { html: ic('refresh') }), 'Re-check model')));
}

function tabData(el) {
  const info = h('dl', { class: 'kv' }, h('dt', {}, 'Stored in'), h('dd', {}, '…'));
  el.append(h('h3', {}, 'Where your data lives'), h('p', { style: 'color:var(--muted);margin:4px 0' }, 'Chats, memories and settings are plain files in HybridMind’s data folder on this PC. They are not encrypted by the app and are never uploaded (only what you send to your cloud model leaves the PC — see Cloud usage). Anyone who can open your Windows profile can read them.'), info);
  Native.sysInfo().then((i) => { info.innerHTML = `<dt>Folder</dt><dd>${esc(i.dataFolder)}</dd><dt>Size</dt><dd>${fmtSize(i.dataBytes)} (includes the file index)</dd><dt>Chats</dt><dd>${Store.index.length}</dd><dt>Memories</dt><dd>${Store.memories.length}</dd><dt>Version</dt><dd>${esc(i.version)}</dd>`; }).catch(() => {});
  const pics = h('dl', { class: 'kv' }, h('dt', {}, 'Generated pictures'), h('dd', {}, '…'));
  Native.mediaInfo().then((n) => { pics.innerHTML = '<dt>Pictures &amp; thumbnails</dt><dd>' + fmtSize(n) + ' (made on this PC; not included in exports)</dd>'; }).catch(() => {});
  el.append(pics);
  el.append(h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;margin:12px 0' },
    h('button', { class: 'btn', onclick: () => Native.revealData().catch((e) => toast(e.message)) }, h('span', { html: ic('folder') }), 'Open data folder'),
    h('button', { class: 'btn', onclick: exportEverything }, h('span', { html: ic('download') }), 'Export everything (JSON)'),
    h('button', { class: 'btn', onclick: importEverything }, h('span', { html: ic('upload') }), 'Import…')),
    h('h3', {}, 'Delete'),
    h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;margin:8px 0' },
      h('button', { class: 'btn danger', onclick: () => confirmBox('Delete all chats?', 'Every conversation is removed from this PC. Memories and files are kept.', 'Delete chats', () => { Store.deleteAllChats(); newChat(); toast('All chats deleted.'); }) }, 'Delete all chats'),
      h('button', { class: 'btn danger', onclick: () => confirmBox('Clear memory?', 'All ' + Store.memories.length + ' memories are removed.', 'Clear memory', () => { Store.memories = []; Store.saveMemories(); renderTop(); toast('Memory cleared.'); }) }, 'Clear memory'),
      h('button', { class: 'btn danger', onclick: () => confirmBox('Delete generated pictures?', 'Pictures made by HybridMind and attachment thumbnails are deleted. Chats that show them will lose the image.', 'Delete pictures', async () => { await Native.clearMedia(); toast('Pictures deleted.'); renderThread(true); }) }, 'Delete generated pictures'),
      h('button', { class: 'btn danger', onclick: () => confirmBox('Remove all indexed files?', 'The file index is emptied (your original files are not touched).', 'Remove index', async () => { await Native.clearLibrary(); App.docs = []; Store.chats.forEach((c) => { c.scope = []; }); renderTop(); toast('File index cleared.'); }) }, 'Clear file index')));
}

function tabAbout(el) {
  el.append(h('div', { class: 'note' }, h('b', {}, 'HybridMind by Dyabi'), ' — a hybrid assistant. It runs on this PC with Windows’ on-device AI (Phi Silica on the NPU) and works fully offline; if you add your own cloud model it can hand over requests the on-device model can’t do well, under the consent, redaction and limit rules you choose.'),
    h('div', { class: 'note warn' }, h('b', {}, 'What leaves this PC: '), 'only text you (or the routing rules, with your consent) send to the cloud endpoint you configured, made by the app’s host process — the web page itself has no network access. Your API key is stored encrypted for your Windows account and is never shown or logged. Redaction catches patterns (keys, cards, e-mails, phones, IDs), not names or confidential wording.'),
    h('h3', {}, 'What runs where'),
    h('div', { class: 'list' },
      ...[['Writing replies', 'Phi Silica on your NPU (Windows AI LanguageModel)'], ['Reading files', 'Code in this app; scanned pages and images use Windows’ on-device OCR; photo descriptions use an on-device image model'],
        ['Searching your files', 'Windows App Content Search (local semantic index) blended with keyword scoring'], ['Summarize / rewrite / table', 'Built-in Windows AI text skills'],
        ['Reading photos', 'Windows on-device OCR for text, plus an on-device image-description model for what the picture shows'],
      ['Creating / editing pictures', 'Windows AI image generator, upscaler and background remover — each downloaded by Windows on first use, when Windows offers it for your PC'],
      ['Skills', 'Instruction packs (SKILL.md folders) added to the prompt for one reply; applied by you (/name) or picked automatically when your message matches'],
      ['Calculator, units, dates, memory commands', 'Plain code — exact, not model guesses'], ['Chats, memory, settings', 'Files in this app’s data folder']].map(([a, b]) => h('div', { class: 'card' }, h('div', { class: 'grow' }, h('div', { class: 'ct' }, a), h('div', { class: 'cs' }, b))))),
    h('h3', {}, 'Honest limits'),
    h('ul', { style: 'color:var(--text2);padding-left:20px;margin:6px 0' },
      h('li', {}, 'It’s a small on-device model: good for drafting, explaining and Q&A on your files; weaker at long reasoning, maths without the calculator, and obscure facts.'),
      h('li', {}, 'No web access or live information. Picture generation needs a Windows model that Windows Update must provide for your PC — check Settings → Model to see if it is available here. No voice dictation yet.'),
      h('li', {}, 'Replies can be wrong. File answers cite their sources so you can check them.'),
      h('li', {}, 'Windows’ content-safety layer can block some prompts or replies.'),
      h('li', {}, 'Windows says its on-device index isn’t meant for highly sensitive data.')),
    h('h3', {}, 'Keyboard shortcuts'),
    h('dl', { class: 'kv' }, ...[['Ctrl+Shift+O', 'New chat'], ['Ctrl+K', 'Search chats'], ['Ctrl+B', 'Show / hide sidebar'], ['Ctrl+,', 'Settings'], ['Ctrl+Shift+T', 'Temporary chat'], ['Esc', 'Stop generating / close dialog'], ['↑ in empty box', 'Edit your last message'], ['/', 'Commands']].flatMap(([k, v]) => [h('dt', {}, h('kbd', {}, k)), h('dd', {}, v)])));
}

// ── memory ─────────────────────────────────────────────────────────────
function openMemory() {
  const body = h('div');
  const draw = () => {
    body.innerHTML = '';
    body.append(toggleRow('Use memory', 'HybridMind keeps short facts about you and uses them in replies.', Store.settings.memory, (v) => { Store.settings.memory = v; Store.saveSettings(); renderTop(); }));
    const inp = h('input', { class: 'in', placeholder: 'Add a memory, e.g. “User prefers metric units.”' });
    const add = () => { const v = inp.value.trim(); if (!v) return; Store.addMemory(v.startsWith('User') ? v : Tools.firstToThird(v), 'user'); inp.value = ''; draw(); renderTop(); };
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
    body.append(h('div', { style: 'display:flex;gap:8px;margin:14px 0 6px' }, inp, h('button', { class: 'btn pri', onclick: add }, 'Add')));
    if (!Store.memories.length) body.append(h('div', { class: 'empty' }, 'Nothing saved yet. Say “remember that I’m vegetarian”, or just tell HybridMind about yourself.'));
    const list = h('div', { class: 'list' });
    for (const m of Store.memories) {
      list.append(h('div', { class: 'card' },
        h('div', { class: 'grow' }, h('div', { class: 'ct', style: 'font-weight:500;' + (m.on === false ? 'opacity:.5' : '') }, m.text), h('div', { class: 'cs' }, (m.src === 'auto' ? 'Saved automatically' : 'Added by you') + ' · ' + fmtDateTime(m.ts))),
        h('div', { class: 'btns' },
          h('label', { class: 'sw', title: m.on === false ? 'Off — not used' : 'On' }, h('input', { type: 'checkbox', checked: m.on !== false, onchange: (e) => { m.on = e.target.checked; Store.saveMemories(); draw(); } }), h('i')),
          h('button', { class: 'icon-btn', title: 'Edit', onclick: () => textPrompt('Edit memory', 'Memory', m.text, 'Save', (v) => { m.text = v; Store.saveMemories(); draw(); }, { multiline: true }), html: ic('edit') }),
          h('button', { class: 'icon-btn', title: 'Delete', onclick: () => { Store.removeMemory(m.id); draw(); renderTop(); }, html: ic('trash') }))));
    }
    body.append(list);
    if (Store.memories.length) body.append(h('div', { style: 'text-align:right' }, h('button', { class: 'btn danger sm', onclick: () => confirmBox('Clear all memory?', 'Remove all ' + Store.memories.length + ' memories?', 'Clear', () => { Store.memories = []; Store.saveMemories(); draw(); renderTop(); }) }, 'Clear all')));
    body.append(h('div', { class: 'note' }, 'Memories live only on this PC. Temporary chats never read or write memory. Turn a memory off to keep it without using it.'));
  };
  draw();
  openModal({ title: 'Memory', body, wide: false, onClose: () => { renderTop(); } });
}

// ── library / knowledge ────────────────────────────────────────────────
Native.on((ev) => { if (ev.event === 'progress') { App.indexing = ev.stage === 'indexing' ? ev : null; if (App.libraryUpdate) App.libraryUpdate(); } });

function libraryPanel(host, opts = {}) {
  const draw = () => {
    host.innerHTML = '';
    const chat = App.chat;
    const drop = h('div', { class: 'drop' }, h('div', { style: 'margin-bottom:10px' }, 'Drop files or a folder here — or'),
      h('div', { style: 'display:flex;gap:8px;justify-content:center;flex-wrap:wrap' },
        h('button', { class: 'btn', onclick: async () => { try { const p = await Native.pickFiles(); if (p && p.length) { await addToLibrary(p); } } catch (e) { toast(e.message); } } }, h('span', { html: ic('file') }), 'Add files'),
        h('button', { class: 'btn', onclick: async () => { try { const p = await Native.pickFolder(); if (p) await addToLibrary([p]); } catch (e) { toast(e.message); } } }, h('span', { html: ic('folder') }), 'Add folder')));
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', async (e) => { e.preventDefault(); e.stopPropagation(); drop.classList.remove('over'); if (e.dataTransfer.files.length) await addToLibrary(null, [...e.dataTransfer.files]); });
    host.append(drop);
    if (App.indexing) {
      const p = App.indexing;
      host.append(h('div', { style: 'margin-top:10px' }, h('div', { style: 'font-size:13px;color:var(--text2)' }, `Reading ${p.current} of ${p.total}: ${p.file}`), h('div', { class: 'progress' }, h('i', { style: `width:${p.total ? Math.round(100 * p.current / p.total) : 0}%` }))));
    }
    host.append(toggleRow('Describe photos that contain no text', 'Uses the on-device image model to index a short, AI-written description. Slower; descriptions can be wrong.', Store.settings.describePhotos, (v) => { Store.settings.describePhotos = v; Store.saveSettings(); }));
    const docs = App.docs;
    host.append(h('div', { style: 'display:flex;align-items:center;justify-content:space-between;margin-top:6px' }, h('h3', { style: 'margin:10px 0' }, `Indexed files (${docs.filter((d) => d.status === 'indexed').length})`),
      docs.length ? h('span', { style: 'font-size:12.5px;color:var(--muted)' }, 'Tick the files this chat may use') : null));
    if (!docs.length) host.append(h('div', { class: 'empty' }, 'No files yet. Add documents, PDFs, spreadsheets, slides, notes, code or images — they are read and indexed on this PC.'));
    const list = h('div', { class: 'list' });
    for (const d of docs.slice().sort((a, b) => a.name.localeCompare(b.name))) {
      const ok = d.status === 'indexed';
      const inChat = chat && chat.scope.includes(d.path);
      const viaOther = !inChat && effectiveScope().includes(d.path);
      list.append(h('div', { class: 'card' },
        ok ? h('label', { class: 'sw', title: viaOther ? 'Included through the assistant or project' : 'Let this chat use the file' }, h('input', { type: 'checkbox', checked: inChat || viaOther, disabled: viaOther, onchange: (e) => { if (e.target.checked) chat.scope.push(d.path); else chat.scope = chat.scope.filter((p) => p !== d.path); if (!chat.temporary && Store.path(chat).length) Store.saveChat(chat); renderTop(); } }), h('i')) : h('span', { class: 'tbadge' }, d.status),
        h('div', { class: 'grow' }, h('div', { class: 'ct' }, d.name), h('div', { class: 'cs' }, (d.ext || '').replace('.', '').toUpperCase() + ' · ' + fmtSize(d.sizeBytes) + (ok ? ` · ${d.chunks} passages` : '') + (d.note ? ' · ' + d.note : ''))),
        h('div', { class: 'btns' },
          h('button', { class: 'icon-btn', title: 'Show in folder', onclick: () => Native.openPath(d.path, true).catch((e) => toast(e.message)), html: ic('folder') }),
          h('button', { class: 'icon-btn', title: 'Remove from index', onclick: async () => { await Native.removeDoc(d.path); await refreshLibrary(); Store.chats.forEach((c) => { c.scope = c.scope.filter((p) => p !== d.path); }); draw(); renderTop(); }, html: ic('trash') }))));
    }
    host.append(list);
    host.append(h('div', { class: 'note' }, 'Files stay where they are; HybridMind keeps a searchable index of their text on this PC. Windows notes that its on-device index is not intended for highly sensitive data.'));
  };
  App.libraryUpdate = () => { if (host.isConnected) draw(); else App.libraryUpdate = null; };
  draw();
  return draw;
}

async function addToLibrary(paths, files) {
  try {
    const describe = !!Store.settings.describePhotos;
    toast('Reading files…', null, 6000);
    const sum = files ? await Native.dropPaths(files, describe) : await Native.indexPaths(paths, describe);
    await refreshLibrary();
    App.indexing = null;
    if (App.libraryUpdate) App.libraryUpdate();
    toast(`${sum.added + sum.updated} file${sum.added + sum.updated === 1 ? '' : 's'} indexed` + (sum.unchanged ? `, ${sum.unchanged} unchanged` : '') + (sum.skipped ? `, ${sum.skipped} skipped` : '') + (sum.failed ? `, ${sum.failed} failed` : '') + '.');
  } catch (e) { toast(e.message); }
}

function tabKnowledge(el) { libraryPanel(el); }
function openLibrary() {
  const host = h('div');
  libraryPanel(host);
  openModal({ title: 'Files & knowledge', body: host, wide: true, onClose: () => { App.libraryUpdate = null; renderTop(); } });
}

// ── assistants & projects ──────────────────────────────────────────────
function openAssistants() {
  const body = h('div');
  const draw = () => {
    body.innerHTML = '';
    body.append(h('p', { style: 'color:var(--text2);margin:4px 0 8px' }, 'Assistants are saved personas with their own instructions, starter prompts and (optionally) files — like custom GPTs, but stored on this PC.'));
    const list = h('div', { class: 'list' });
    for (const a of Store.allAssistants()) {
      list.append(h('div', { class: 'card' }, h('div', { class: 'av', style: 'background:' + a.color }, a.letter || a.name[0]),
        h('div', { class: 'grow' }, h('div', { class: 'ct' }, a.name + (a.builtin ? '' : ' · custom')), h('div', { class: 'cs' }, a.description || (a.instructions || '').slice(0, 100))),
        h('div', { class: 'btns' },
          h('button', { class: 'btn sm', onclick: () => { closeModalNow(); newChat({ assistantId: a.id }); } }, 'Chat'),
          h('button', { class: 'btn sm', onclick: () => editAssistant(a, draw) }, a.builtin ? 'Customize' : 'Edit'))));
    }
    body.append(list, h('button', { class: 'btn pri', onclick: () => editAssistant(null, draw) }, h('span', { html: ic('plus') }), 'Create assistant'));
  };
  draw();
  openModal({ title: 'Assistants', body, onClose: () => { renderSidebar(); renderTop(); } });
}
const closeModalNow = () => { if (openModal.cur) openModal.cur.close(); };

const COLORS = ['#7a6cf5', '#e0709a', '#2fa77f', '#e0a13a', '#3a8fe0', '#3fb1c9', '#d9534f', '#8a6d3b', '#6c757d'];
function editAssistant(base, back) {
  const a = base && !base.builtin ? base : null;
  const draft = a ? { ...a } : { id: uid('a'), name: base ? base.name + ' (copy)' : '', letter: '', color: base ? base.color : COLORS[Math.floor(Math.random() * COLORS.length)], description: base ? base.description : '', instructions: base ? base.instructions : '', starters: base ? [...base.starters] : [], docs: [] };
  const name = h('input', { class: 'in', value: draft.name, maxlength: 40 });
  const desc = h('input', { class: 'in', value: draft.description, maxlength: 140 });
  const ins = h('textarea', { class: 'ta', style: 'min-height:130px', value: draft.instructions, maxlength: 900, placeholder: 'How should this assistant behave? Tone, format, rules…' });
  const st = h('textarea', { class: 'ta', value: (draft.starters || []).join('\n'), placeholder: 'One starter prompt per line' });
  let color = draft.color;
  const sw = h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' });
  const drawSw = () => { sw.innerHTML = ''; COLORS.forEach((c) => sw.append(h('button', { style: `width:28px;height:28px;border-radius:9px;background:${c};outline:${c === color ? '3px solid var(--text)' : 'none'};outline-offset:2px`, onclick: () => { color = c; drawSw(); }, 'aria-label': 'Colour ' + c }))); }; drawSw();
  const docsSel = new Set(draft.docs || []);
  const docBox = h('div', { class: 'list', style: 'max-height:160px;overflow:auto' });
  const indexed = App.docs.filter((d) => d.status === 'indexed');
  if (!indexed.length) docBox.append(h('div', { class: 'empty' }, 'No indexed files yet — add some in Files & knowledge.'));
  indexed.forEach((d) => docBox.append(h('label', { class: 'card', style: 'padding:8px 12px;align-items:center;cursor:pointer' }, h('input', { type: 'checkbox', checked: docsSel.has(d.path), onchange: (e) => { if (e.target.checked) docsSel.add(d.path); else docsSel.delete(d.path); } }), h('div', { class: 'grow ct', style: 'font-weight:500' }, d.name))));
  openModal({
    title: a ? 'Edit assistant' : 'New assistant', body: h('div', {}, field('Name', name), field('Short description', desc), field('Instructions', ins, 'Added to the system prompt (up to 900 characters).'), field('Starter prompts', st), field('Colour', sw), field('Knowledge files', docBox, 'These files are searched in every chat with this assistant.')),
    actions: [
      a ? { label: 'Delete', danger: true, fn: (c) => { c(); confirmBox('Delete assistant?', `“${a.name}” will be removed. Existing chats keep working with the default assistant.`, 'Delete', () => { Store.assistants = Store.assistants.filter((x) => x.id !== a.id); Store.saveAssistants(); Store.chats.forEach((ch) => { if (ch.assistantId === a.id) ch.assistantId = 'general'; }); if (Store.settings.defaultAssistant === a.id) Store.settings.defaultAssistant = 'general'; renderAll(); back && back(); }); } } : null,
      { label: 'Cancel', fn: (c) => c() },
      { label: 'Save', pri: true, fn: (c) => {
        if (!name.value.trim()) { toast('Give the assistant a name.'); return; }
        Object.assign(draft, { name: name.value.trim(), letter: name.value.trim()[0].toUpperCase(), color, description: desc.value.trim(), instructions: ins.value.trim(), starters: st.value.split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 6), docs: [...docsSel] });
        const i = Store.assistants.findIndex((x) => x.id === draft.id);
        if (i >= 0) Store.assistants[i] = draft; else Store.assistants.push(draft);
        Store.saveAssistants(); c(); renderAll(); back && back();
      } }].filter(Boolean),
  });
}

function editProject(id) {
  const p = id ? Store.project(id) : null;
  const draft = p ? { ...p, docs: [...(p.docs || [])] } : { id: uid('p'), name: '', instructions: '', docs: [] };
  const name = h('input', { class: 'in', value: draft.name, maxlength: 60 });
  const ins = h('textarea', { class: 'ta', value: draft.instructions, maxlength: 600, placeholder: 'Shared instructions for every chat in this project (optional)' });
  const docsSel = new Set(draft.docs);
  const docBox = h('div', { class: 'list', style: 'max-height:200px;overflow:auto' });
  const indexed = App.docs.filter((d) => d.status === 'indexed');
  if (!indexed.length) docBox.append(h('div', { class: 'empty' }, 'No indexed files yet — add some in Files & knowledge.'));
  indexed.forEach((d) => docBox.append(h('label', { class: 'card', style: 'padding:8px 12px;align-items:center;cursor:pointer' }, h('input', { type: 'checkbox', checked: docsSel.has(d.path), onchange: (e) => { if (e.target.checked) docsSel.add(d.path); else docsSel.delete(d.path); } }), h('div', { class: 'grow ct', style: 'font-weight:500' }, d.name))));
  openModal({
    title: p ? 'Edit project' : 'New project', body: h('div', {}, field('Name', name), field('Instructions', ins), field('Project files', docBox, 'Every chat in the project can search these files.')),
    actions: [
      p ? { label: 'Delete', danger: true, fn: (c) => { c(); confirmBox('Delete project?', `“${p.name}” is removed. Its chats are kept and move out of the project.`, 'Delete', () => { Store.projects = Store.projects.filter((x) => x.id !== p.id); Store.saveProjects(); Store.chats.forEach((ch) => { if (ch.projectId === p.id) ch.projectId = null; }); Store.index.forEach((m) => { if (m.projectId === p.id) m.projectId = null; }); Store.chats.forEach((ch) => Store.touchIndex(ch)); if (App.projectFilter === p.id) App.projectFilter = null; renderAll(); }); } } : null,
      { label: 'Cancel', fn: (c) => c() },
      { label: 'Save', pri: true, fn: (c) => {
        if (!name.value.trim()) { toast('Give the project a name.'); return; }
        Object.assign(draft, { name: name.value.trim(), instructions: ins.value.trim(), docs: [...docsSel] });
        const i = Store.projects.findIndex((x) => x.id === draft.id);
        if (i >= 0) Store.projects[i] = draft; else Store.projects.push(draft);
        Store.saveProjects(); c(); renderAll();
      } }].filter(Boolean),
  });
}

// ── search ─────────────────────────────────────────────────────────────
function openSearch() {
  const inp = h('input', { class: 'in search-in', placeholder: 'Search your chats…', 'aria-label': 'Search chats' });
  const res = h('div', { style: 'margin-top:10px' });
  let items = [], sel = 0;
  const draw = () => {
    res.innerHTML = '';
    const q = inp.value.trim();
    if (q) items = Store.searchChats(q).map((r) => ({ meta: r.meta, sub: r.snippet }));
    else items = Store.index.filter((m) => !m.archived).sort((a, b) => b.updated - a.updated).slice(0, 12).map((m) => ({ meta: m, sub: m.preview }));
    if (!items.length) res.append(h('div', { class: 'empty' }, q ? 'No chats match.' : 'No chats yet.'));
    sel = clamp(sel, 0, Math.max(0, items.length - 1));
    const rx = q ? new RegExp('(' + q.split(/\s+/).filter(Boolean).map(escRx).join('|') + ')', 'ig') : null;
    const hl = (t) => (rx ? esc(t).replace(rx, '<mark>$1</mark>') : esc(t));
    items.forEach((it, i) => res.append(h('div', { class: 'hit' + (i === sel ? ' sel' : ''), onclick: () => { closeModalNow(); openChat(it.meta.id); } },
      h('div', { class: 'ht', html: hl(it.meta.title) }), h('div', { class: 'hs', html: hl(it.sub || '') + ' · ' + new Date(it.meta.updated).toLocaleDateString() }))));
  };
  inp.addEventListener('input', () => { sel = 0; draw(); });
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { sel = Math.min(items.length - 1, sel + 1); draw(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); draw(); e.preventDefault(); }
    else if (e.key === 'Enter' && items[sel]) { closeModalNow(); openChat(items[sel].meta.id); }
  });
  openModal({ title: 'Search chats', body: h('div', {}, inp, res) });
  draw(); setTimeout(() => inp.focus(), 30);
}

// ── message / context info ─────────────────────────────────────────────
function showInfo(nodeId) {
  const chat = App.chat, n = chat.nodes[nodeId], m = n.meta || {};
  const user = chat.nodes[n.parent];
  const rows = [];
  const rt = n.route || {};
  if (rt.target === 'cloud') {
    rows.push(['Ran on', 'Cloud — ' + (rt.model || '') + (Router.host() ? ' at ' + Router.host() : '')]);
    rows.push(['Why the cloud', rt.reason || '—']);
    rows.push(['Sent to the cloud', (rt.sentChars || 0).toLocaleString() + ' characters' + (rt.redactions ? ', after replacing ' + rt.redactions + ' sensitive-looking value(s) with placeholders' : '')]);
    if (rt.tokensIn || rt.tokensOut) rows.push(['Tokens', (rt.tokensIn || 0) + ' in · ' + (rt.tokensOut || 0) + ' out']);
  } else {
    rows.push(['Ran on', m.local ? 'Nowhere — answered by code in the app' : m.skill ? 'Your device · Windows AI ' + m.skill : 'Your device · Phi Silica on the NPU']);
    if (rt.reason && !m.local) rows.push(['Why on-device', rt.reason]);
    if (!m.local) rows.push(['Sent to the cloud', 'Nothing']);
  }
  if (!m.local) {
    rows.push(['First word after', fmtDur(m.first || 0)], ['Total time', fmtDur(m.gen || 0)]);
    if (m.prompt) rows.push(['Prompt size', m.prompt.toLocaleString() + ' characters sent to the model']);
    if (m.hist != null && !m.skill) rows.push(['Earlier messages included', m.hist + (m.dropped ? ` (${m.dropped} older ones left out${chat.summary ? ', summarised' : ''})` : '')]);
    if (m.retr) rows.push(['File search', fmtDur(m.retr)]);
  }
  const srcs = (n.sources || []).filter((s) => s.sent);
  if (srcs.length) rows.push(['File excerpts used', srcs.map((s) => `[${s.n}] ${s.docName}`).join(', ')]);
  if (n.inlineDocs && n.inlineDocs.length) rows.push(['Files read in full', n.inlineDocs.join(', ')]);
  if (user && user.tools && user.tools.length) rows.push(['Exact tools used', user.tools.map((t) => t.text).join('; ')]);
  if (user && user.usedRecall) rows.push(['Past chats consulted', user.usedRecall + ' snippet(s)']);
  rows.push(['Memory', chat.temporary ? 'Off (temporary chat)' : Store.settings.memory ? Store.activeMemories().length + ' memories available' : 'Off']);
  rows.push(['Written', fmtDateTime(n.ts)]);
  openModal({ title: 'How this reply was made', body: h('div', {}, h('dl', { class: 'kv' }, rows.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])),
    h('div', { class: 'note' }, 'Replies come from a small on-device model and can be wrong. Nothing here left your PC.')) });
}

function openContextInfo() {
  const L = App.lastCtx, c = App.chat;
  const body = h('div', {},
    h('p', { style: 'margin:4px 0;color:var(--text2)' }, 'The on-device model can read only a limited amount of text at once. For every reply HybridMind fits, in this order: instructions and memories, your message, file excerpts, then as many recent messages as still fit. Older turns are summarised in the background.'),
    L ? h('dl', { class: 'kv' }, h('dt', {}, 'Last prompt'), h('dd', {}, L.prompt.toLocaleString() + ' characters'), h('dt', {}, 'Messages included'), h('dd', {}, String(L.histUsed)), h('dt', {}, 'Left out / summarised'), h('dd', {}, String(L.histDropped)),
      h('dt', {}, 'File excerpts'), h('dd', {}, String(L.sources)), h('dt', {}, 'Files read in full'), h('dd', {}, String(L.inline))) : h('p', { style: 'color:var(--muted)' }, 'Send a message to see usage.'),
    c.summary ? h('div', { class: 'note' }, h('b', {}, 'Rolling summary of older messages: '), c.summary) : null);
  openModal({ title: 'Context', body });
}

// ── export / import ────────────────────────────────────────────────────
function chatToMarkdown(chat) {
  const lines = [`# ${chat.title}`, '', `_Exported from HybridMind · ${new Date().toLocaleString()}_`, ''];
  for (const n of Store.path(chat)) {
    if (n.role === 'user') { lines.push('## You', ''); if (n.attachments && n.attachments.length) lines.push('_Attached: ' + n.attachments.map((a) => a.name).join(', ') + '_', ''); lines.push(n.content, ''); }
    else {
      lines.push('## HybridMind', '', n.content || '_(no text)_', '');
      const srcs = (n.sources || []).filter((s) => s.sent);
      if (srcs.length) { lines.push('Sources:', ''); srcs.forEach((s) => lines.push(`- [${s.n}] ${s.docName} — ${s.loc}`)); lines.push(''); }
    }
  }
  return lines.join('\n');
}
async function exportChat(chat, fmt) {
  const safe = chat.title.replace(/[^\w\- ]+/g, '').trim().slice(0, 50) || 'chat';
  try {
    const out = fmt === 'json' ? JSON.stringify({ app: 'HybridMind', version: 1, chats: [chat] }, null, 2) : chatToMarkdown(chat);
    const p = await Native.saveFile(safe + (fmt === 'json' ? '.json' : '.md'), out);
    if (p) toast('Saved to ' + p);
  } catch (e) { toast(e.message); }
}
async function exportEverything() {
  try { const p = await Native.saveFile('HybridMind-export-' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify(Store.exportAll(), null, 2)); if (p) toast('Exported to ' + p); } catch (e) { toast(e.message); }
}
async function importEverything() {
  try {
    const txt = await Native.importFile(); if (!txt) return;
    const r = Store.importAll(JSON.parse(txt));
    renderAll(); toast(`Imported ${r.chats} chat${r.chats === 1 ? '' : 's'} and ${r.memories} memor${r.memories === 1 ? 'y' : 'ies'}.`);
  } catch (e) { toast('Import failed: ' + e.message); }
}

// ── chat / project menus ───────────────────────────────────────────────
function chatMenu(anchor, id, opts = {}) {
  const c = Store.chats.get(id) || (App.chat && App.chat.id === id ? App.chat : null); if (!c) return;
  const projItems = Store.projects.map((p) => ({ label: (c.projectId === p.id ? '✓ ' : '') + p.name, icon: 'folder', fn: () => { c.projectId = c.projectId === p.id ? null : p.id; Store.touchIndex(c); renderAll(); } }));
  popMenu(anchor, [
    { label: 'Rename', icon: 'edit', fn: () => textPrompt('Rename chat', 'Title', c.title, 'Rename', (v) => { c.title = v; c.titleLocked = true; Store.touchIndex(c); renderSidebar(); renderTop(); }) },
    { label: c.pinned ? 'Unpin' : 'Pin', icon: 'pin', fn: () => { c.pinned = !c.pinned; Store.touchIndex(c); renderSidebar(); } },
    projItems.length ? 'hr' : null, projItems.length ? { header: 'Move to project' } : null, ...projItems,
    'hr',
    { label: 'Export as Markdown', icon: 'download', fn: () => exportChat(c, 'md') },
    { label: 'Export as JSON', icon: 'download', fn: () => exportChat(c, 'json') },
    { label: c.archived ? 'Unarchive' : 'Archive', icon: 'archive', fn: () => { c.archived = !c.archived; Store.touchIndex(c); if (c.archived && App.chat === c) newChat(); renderSidebar(); } },
    { label: 'Delete', icon: 'trash', danger: true, fn: () => confirmBox('Delete chat?', `“${c.title}” will be permanently removed from this PC.`, 'Delete', () => { Store.deleteChat(c.id); if (App.chat === c) { App.chat = null; newChat(); } else renderSidebar(); }) },
  ], { right: opts.right });
}

function projectMenu(anchor, id) {
  popMenu(anchor, [
    { label: 'New chat in project', icon: 'plus', fn: () => newChat({ projectId: id }) },
    { label: 'Edit project…', icon: 'edit', fn: () => editProject(id) },
  ]);
}
