'use strict';

// Application state and all rendering: sidebar, top bar, message thread, composer.
const App = {
  chat: null,            // the chat on screen (a new chat isn't saved until its first message)
  busy: null,            // { rid, chatId, nodeId } while the model is writing
  attach: [],            // composer attachments: { id, path, name, ext, status, note }
  docs: [],              // the file library (indexed documents)
  model: { ok: false, state: '', text: 'Starting…' },
  lastCtx: null,         // { prompt, histUsed, histDropped, sources, inline } of the latest reply
  projectFilter: null,
  showArchived: false,
  stick: true,
  speaking: null,
  indexing: null,
};

// ── theme / font ───────────────────────────────────────────────────────
function applyTheme() {
  const t = Store.settings.theme;
  const dark = t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.documentElement.style.setProperty('--fs', (Store.settings.fontSize || 15.5) + 'px');
  const use = document.querySelector('#btnTheme use');
  if (use) use.setAttribute('href', dark ? '#i-sun' : '#i-moon');
}

// ── sidebar ────────────────────────────────────────────────────────────
function chatRow(m) {
  const active = App.chat && App.chat.id === m.id;
  const row = h('div', { class: 'row' + (active ? ' active' : ''), 'data-chat': m.id, tabindex: 0, role: 'button', title: m.title },
    m.pinned ? h('span', { class: 'pin', html: ic('pin', 'pin') }) : null,
    h('span', { class: 't' }, m.title || 'New chat'),
    h('button', { class: 'more', 'aria-label': 'Chat options', 'data-more': m.id, html: ic('dots') }));
  return row;
}

function renderSidebar() {
  const box = $('sbScroll');
  box.innerHTML = '';

  // assistants
  const sec1 = h('div', { class: 'sb-sec' }, h('div', { class: 'sb-h' }, h('span', {}, 'Assistants'), h('button', { 'data-act': 'manageAssistants', title: 'Manage assistants' }, 'Manage')));
  for (const a of Store.allAssistants().slice(0, 7)) {
    sec1.append(h('div', { class: 'row', 'data-asst': a.id, tabindex: 0, role: 'button', title: a.description },
      h('span', { class: 'av', style: 'background:' + a.color }, a.letter || a.name[0]), h('span', { class: 't' }, a.name)));
  }
  box.append(sec1);

  // projects
  const sec2 = h('div', { class: 'sb-sec' }, h('div', { class: 'sb-h' }, h('span', {}, 'Projects'), h('button', { 'data-act': 'newProject', title: 'New project' }, '+ New')));
  if (!Store.projects.length) sec2.append(h('div', { class: 'sb-empty' }, 'Group chats with shared instructions and files.'));
  for (const p of Store.projects) {
    const n = Store.index.filter((m) => m.projectId === p.id && !m.archived).length;
    sec2.append(h('div', { class: 'row' + (App.projectFilter === p.id ? ' active' : ''), 'data-proj': p.id, tabindex: 0, role: 'button' },
      h('span', { html: ic('folder') }), h('span', { class: 't' }, p.name), h('span', { class: 'cnt' }, n || ''),
      h('button', { class: 'more', 'data-projmore': p.id, 'aria-label': 'Project options', html: ic('dots') })));
  }
  box.append(sec2);

  // chats
  const list = Store.index.filter((m) => !m.archived && (!App.projectFilter || m.projectId === App.projectFilter));
  const sec3 = h('div', { class: 'sb-sec' });
  const proj = App.projectFilter ? Store.project(App.projectFilter) : null;
  sec3.append(h('div', { class: 'sb-h' }, h('span', {}, proj ? 'Chats in ' + proj.name : 'Chats'),
    proj ? h('button', { 'data-act': 'clearProject' }, 'Show all') : null));
  if (!list.length) sec3.append(h('div', { class: 'sb-empty' }, proj ? 'No chats in this project yet.' : 'Your conversations will appear here. They stay on this PC.'));
  const pinned = list.filter((m) => m.pinned).sort((a, b) => b.updated - a.updated);
  if (pinned.length) { sec3.append(h('div', { class: 'sb-h' }, h('span', {}, 'Pinned'))); pinned.forEach((m) => sec3.append(chatRow(m))); }
  let lastLabel = '';
  for (const m of list.filter((x) => !x.pinned).sort((a, b) => b.updated - a.updated)) {
    const lab = relDate(m.updated);
    if (lab !== lastLabel) { sec3.append(h('div', { class: 'sb-h' }, h('span', {}, lab))); lastLabel = lab; }
    sec3.append(chatRow(m));
  }
  box.append(sec3);

  const arch = Store.index.filter((m) => m.archived);
  if (arch.length) {
    const sec4 = h('div', { class: 'sb-sec' }, h('div', { class: 'sb-h' }, h('span', {}, 'Archived (' + arch.length + ')'), h('button', { 'data-act': 'toggleArchived' }, App.showArchived ? 'Hide' : 'Show')));
    if (App.showArchived) arch.sort((a, b) => b.updated - a.updated).forEach((m) => sec4.append(chatRow(m)));
    box.append(sec4);
  }
}

// ── top bar / status ───────────────────────────────────────────────────
function renderTop() {
  const c = App.chat, a = Store.assistant(c.assistantId);
  $('asstName').textContent = a.name;
  $('asstSub').textContent = 'Phi Silica · on-device';
  const proj = c.projectId ? Store.project(c.projectId) : null;
  $('chatTitle').innerHTML = (proj ? esc(proj.name) + ' › ' : '') + (S_hasMessages() ? '<b>' + esc(c.title) + '</b>' : '');
  $('tempBadge').style.display = c.temporary ? '' : 'none';
  $('btnTemp').classList.toggle('on', c.temporary);
  $('btnTemp').style.display = S_hasMessages() ? 'none' : '';
  $('btnOpen').style.display = $('app').classList.contains('collapsed') ? '' : 'none';
  updateRing();
  const n = effectiveScope().length;
  const chip = $('scopeChip');
  chip.style.display = n ? '' : 'none';
  chip.innerHTML = ic('file') + n + ' file' + (n === 1 ? '' : 's');
  $('btnKnow').classList.toggle('on', n > 0);
  $('hintMem').textContent = c.temporary ? 'Temporary chat: not saved, memory off.' : Store.settings.memory && Store.memories.length ? '· ' + Store.activeMemories().length + ' memories in use' : '';
}
function S_hasMessages() { return App.chat && Store.path(App.chat).length > 0; }

function setStatus(kind, text, title) {
  $('dot').className = 'dot ' + kind;
  $('statusTxt').textContent = text;
  $('status').title = title || text;
}

function updateRing() {
  const max = Store.settings.maxPrompt || 7500;
  const L = App.lastCtx;
  const frac = L ? clamp(L.prompt / max, 0, 1) : 0;
  $('ringFg').style.strokeDashoffset = String(56.5 * (1 - frac));
  $('btnCtx').querySelector('.ring').classList.toggle('hot', frac > 0.85);
  $('btnCtx').title = L ? `Context used by the last reply: ${L.prompt.toLocaleString()} of ~${max.toLocaleString()} characters (${Math.round(frac * 100)}%)\n${L.histUsed} earlier messages included` +
    (L.histDropped ? `, ${L.histDropped} older ones summarised or left out` : '') + (L.sources ? `\n${L.sources} file excerpt${L.sources === 1 ? '' : 's'} included` : '') : 'Context meter — fills as the conversation grows. Click for details.';
}

// ── scope (files this chat may use) ────────────────────────────────────
function effectiveScope() {
  const c = App.chat; if (!c) return [];
  const set = new Set(c.scope || []);
  const a = Store.assistant(c.assistantId); (a.docs || []).forEach((d) => set.add(d));
  const p = c.projectId ? Store.project(c.projectId) : null; if (p) (p.docs || []).forEach((d) => set.add(d));
  return [...set].filter((path) => App.docs.some((d) => d.path === path && d.status === 'indexed'));
}

// ── thread ─────────────────────────────────────────────────────────────
function navHtml(chat, n) {
  const sibs = Store.siblings(chat, n);
  if (sibs.length < 2) return '';
  const i = sibs.indexOf(n.id) + 1;
  return `<span class="nav"><button data-act="prev" aria-label="Previous version" ${i === 1 ? 'disabled' : ''}>${ic('left')}</button>${i} / ${sibs.length}<button data-act="next" aria-label="Next version" ${i === sibs.length ? 'disabled' : ''}>${ic('right')}</button></span>`;
}

const MEDIA = 'https://media.hybridmind.local/';
function attachChip(a) {
  const img = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'tif', 'tiff', 'heic'].includes(a.ext);
  if (img && a.thumb) return `<span class="chip file pic" title="${esc(a.path || '')}"><img class="thumb" src="${MEDIA}${esc(a.thumb)}" alt="">${esc(a.name)}</span>`;
  return `<span class="chip file" title="${esc(a.path || '')}">${ic(img ? 'image' : 'file')}${esc(a.name)}</span>`;
}

function userMsgEl(chat, n, isLast) {
  const el = h('div', { class: 'msg user', 'data-id': n.id });
  const body = h('div', { class: 'body' });
  if (n.attachments && n.attachments.length) body.append(h('div', { class: 'attach-row', html: n.attachments.map(attachChip).join('') }));
  body.append(h('div', { class: 'bubble' }, n.content));
  const chipHtml = (n.tools || []).map((t) => `<span class="chip tool" title="Computed by code, not by the AI model">${ic(t.icon || 'calc')}${esc(t.text)}</span>`);
  if (n.skillName) {
    const sk = Skills.get(n.skillName);
    const title = sk ? sk.title : n.skillName;
    if (n.skillOff) chipHtml.push(`<span class="chip">${ic('wand')}Skill “${esc(title)}” skipped</span>`);
    else chipHtml.push(`<span class="chip skill" title="${esc(sk ? sk.description : '')}">${ic('wand')}Skill: ${esc(title)}${n.skillAuto ? ' (picked automatically)' : ''}${n.skillAuto ? `<button data-act="skillOff">Don’t use</button>` : ''}</span>`);
  }
  if (chipHtml.length) body.append(h('div', { class: 'chips', html: chipHtml.join('') }));
  body.append(h('div', { class: 'actions', html: navHtml(chat, n) +
    `<button data-act="copyUser" title="Copy">${ic('copy')}</button><button data-act="edit" title="Edit and resend">${ic('edit')}</button>` }));
  el.append(body);
  return el;
}

function srcHtml(n) {
  const srcs = (n.sources || []).filter((s) => s.sent);
  const inl = n.inlineDocs || [];
  if (!srcs.length && !inl.length) return '';
  const terms = n.terms || [];
  const mark = (t) => { let s = esc(t.length > 700 ? t.slice(0, 700) + '…' : t); for (const w of terms) s = s.replace(new RegExp('\\b(' + escRx(esc(w)) + ')\\b', 'ig'), '<mark>$1</mark>'); return s; };
  const label = (srcs.length ? `${srcs.length} excerpt${srcs.length === 1 ? '' : 's'} from your files` : '') + (srcs.length && inl.length ? ' · ' : '') + (inl.length ? `read in full: ${inl.map(esc).join(', ')}` : '');
  return `<details class="sources"><summary>${ic('book')}<span>${label}</span></summary>` +
    srcs.map((s) => `<div class="src" data-n="${s.n}"><div class="sh"><b>[${s.n}] ${esc(s.docName)}</b><span>${esc(s.loc)}</span><button data-act="openSrc" data-path="${esc(s.docPath)}">Open file</button></div><div class="sx">${mark(s.text)}</div></div>`).join('') + '</details>';
}

function statLine(n) {
  const m = n.meta; if (!m || !Store.settings.showStats || m.local) return '';
  if (n.agent && n.agent.local) return `<span class="stat">${n.agent.calls} tool call${n.agent.calls === 1 ? '' : 's'} · on this PC</span>`;
  if (n.agent) return `<span class="stat" title="Steps / tokens used by the cloud model">${n.agent.calls} tool call${n.agent.calls === 1 ? '' : 's'} · ${(n.agent.tokensIn + n.agent.tokensOut).toLocaleString()} tokens · ${n.agent.sentChars.toLocaleString()} chars sent</span>`;
  if (m.img) return `<span class="stat">Windows AI · ${fmtDur(m.gen || 0)}</span>`;
  if (m.cloud) return `<span class="stat" title="Time to first word / total time / tokens written">${m.skill ? m.skill + ' · ' : ''}${fmtDur(m.first || 0)} · ${fmtDur(m.gen || 0)}${n.route && n.route.tokensOut ? ' · ' + n.route.tokensOut + ' tokens' : ''}</span>`;
  const cps = m.gen > m.first + 200 ? Math.round(n.content.length / ((m.gen - m.first) / 1000)) : 0;
  return `<span class="stat" title="Time to first word / total time / speed">${m.skill ? 'Windows AI · ' : ''}${fmtDur(m.first || 0)} · ${fmtDur(m.gen || 0)}${cps ? ' · ' + cps + ' chars/s' : ''}</span>`;
}

function asstActions(chat, n, isLast) {
  const speaking = App.speaking === n.id;
  return navHtml(chat, n) +
    `<button data-act="copy" title="Copy">${ic('copy')}</button>` +
    `<button data-act="regen" title="Regenerate">${ic('refresh')}</button>` +
    `<button data-act="up" class="${n.feedback === 'up' ? 'on' : ''}" title="Good response">${ic('up')}</button>` +
    `<button data-act="down" class="${n.feedback === 'down' ? 'on' : ''}" title="Bad response">${ic('down')}</button>` +
    `<button data-act="speak" class="${speaking ? 'on' : ''}" title="${speaking ? 'Stop reading' : 'Read aloud (on-device voice)'}">${ic('speaker')}</button>` +
    (n.route && n.route.target === 'device' && Router.ready() && !(n.meta && n.meta.local) && !n.agent ? `<button data-act="retryCloud" title="Run this again with the cloud model (you'll see exactly what is sent)">${ic('cloud')}Retry in cloud</button>` : '') +
    (n.route && n.route.target === 'cloud' && !n.agent ? `<button data-act="retryDevice" title="Run this again on your device">${ic('cpu')}Retry on device</button>` : '') +
    `<button data-act="info" title="How this was made">${ic('info')}</button>` + statLine(n);
}

function routeBadge(n) {
  const r = n.route;
  if (!r || (n.meta && (n.meta.local || (n.meta.skill && r.target === 'device')))) return '';
  const why = r.reason ? `<small>${esc(r.reason.length > 110 ? r.reason.slice(0, 109) + '…' : r.reason)}</small>` : '';
  if (n.agent && r.target === 'device') return `<div class="routebadge device" title="A model on this PC; nothing was sent off the machine">${ic('cpu')}Local agent · ${esc(r.model || '')}</div>`;
  if (r.target === 'cloud') return `<div class="routebadge cloud" title="${esc(r.reason || '')}">${ic('cloud')}Cloud · ${esc(r.model || '')}${why}</div>`;
  return `<div class="routebadge device" title="${esc(r.reason || '')}">${ic('cpu')}On-device${r.code === 'ok' || r.code === 'user' ? '' : why}</div>`;
}

function asstBody(n) {
  const cites = (n.sources || []).filter((s) => s.sent).length;
  let html = routeBadge(n) + (n.agent ? agentStepsHtml(n) : '');
  if (n.meta && n.meta.skill) html += `<div class="skillbadge">${ic('bolt')}${n.meta.local || n.meta.cloud ? '' : 'Windows AI · '}${esc(n.meta.skill)}</div>`;
  for (const im of n.images || []) {
    html += `<figure class="genimg"><img src="${MEDIA}${esc(im.url)}" alt="${esc(im.prompt || 'Generated picture')}" data-act="openImg" data-url="${esc(im.url)}" title="Open"><figcaption>` +
      `<button data-act="saveImg" data-url="${esc(im.url)}">${ic('download')}Save as…</button><button data-act="openImg" data-url="${esc(im.url)}">${ic('eye')}Open</button>` +
      `<button data-act="useImg" data-path="${esc(im.path)}">${ic('clip')}Use in chat</button><span>${im.w} × ${im.h}px · made on this PC${im.seed ? ' · seed ' + im.seed : ''}</span></figcaption></figure>`;
  }
  if (n.content) html += `<div class="content">${MD.render(n.content, { cites })}</div>`;
  else if (!n.error && !n.streaming && !(n.images && n.images.length)) html += '<div class="content" style="color:var(--muted)">(no text)</div>';
  if (n.cancelled) html += `<div class="chips"><span class="chip warn">${ic('stop')}Stopped</span></div>`;
  if (n.error) html += `<div class="errbox">${esc(n.error)}</div>`;
  const chips = [];
  for (const mm of n.memoryAdded || []) chips.push(`<span class="chip mem">${ic('brain')}Saved to memory: ${esc(mm.text)}<button data-act="undoMem" data-mid="${mm.id}">Undo</button></span>`);
  for (const mm of n.memoryRemoved || []) chips.push(`<span class="chip mem">${ic('brain')}Forgot: ${esc(mm.text)}</span>`);
  if (n.route && n.route.deviceTried) chips.push(`<span class="chip warn">The on-device answer looked unreliable, so the cloud model answered</span>`);
  if (n.warnings) for (const w of n.warnings) chips.push(`<span class="chip warn">${esc(w)}</span>`);
  if (chips.length) html += `<div class="chips">${chips.join('')}</div>`;
  html += srcHtml(n);
  return html;
}

function asstMsgEl(chat, n, isLast) {
  const el = h('div', { class: 'msg assistant', 'data-id': n.id });
  el.insertAdjacentHTML('afterbegin', '<svg class="avatar"><use href="#logo"/></svg>');
  const body = h('div', { class: 'body' });
  if (n.streaming) body.append(h('div', { class: 'live' }));
  else body.append(h('div', { class: 'static', html: asstBody(n) }), h('div', { class: 'actions' + (isLast ? ' keep' : ''), html: asstActions(chat, n, isLast) }));
  el.append(body);
  return el;
}

function heroEl() {
  const c = App.chat, a = Store.assistant(c.assistantId);
  const hr = new Date().getHours();
  const greet = hr < 5 ? 'Working late' : hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening';
  const nm = Store.settings.nickname ? ', ' + esc(Store.settings.nickname) : '';
  const el = h('div', { class: 'hero' });
  el.innerHTML = `<svg class="logo"><use href="#logo"/></svg><h1>${greet}${nm}. <span>${a.id === 'general' ? 'What’s on your mind?' : esc(a.name) + ' is ready.'}</span></h1>` +
    `<p>${esc(a.description)} It answers on this PC with Windows’ on-device AI first, and asks before using the cloud.</p>`;
  const st = h('div', { class: 'starters' });
  for (const s of (a.starters || []).slice(0, 4)) st.append(h('button', { class: 'starter', 'data-starter': s, html: ic('spark') + '<span>' + esc(s) + '</span>' }));
  el.append(st);
  const info = [];
  info.push(Router.ready() ? `<button class="badge" data-act="openCloud">${ic('cloud')}Cloud: ${esc(Router.cfg.model)}</button>` : `<button class="badge" data-act="openCloud">${ic('cloud')}Add a cloud model</button>`);
  info.push(`<span class="badge">${ic('cpu')}On-device first</span>`);
  if (Store.settings.memory) info.push(`<button class="badge" data-act="openMemory">${ic('brain')}${Store.activeMemories().length} memories</button>`);
  if (Skills.enabled().length) info.push(`<button class="badge" data-act="openSkills">${ic('wand')}${Skills.enabled().length} skills</button>`);
  info.push(`<button class="badge" data-act="openLibrary">${ic('book')}${App.docs.filter((d) => d.status === 'indexed').length} files indexed</button>`);
  el.append(h('div', { class: 'heroline', html: info.join('') }));
  return el;
}

function renderThread(keepScroll) {
  const th = $('thread'), sc = $('stream');
  const prev = sc.scrollTop;
  th.innerHTML = '';
  const chat = App.chat, path = Store.path(chat);
  if (!path.length) { th.append(heroEl()); }
  else path.forEach((n, i) => th.append(n.role === 'user' ? userMsgEl(chat, n, i === path.length - 1) : asstMsgEl(chat, n, i === path.length - 1)));
  renderTop();
  if (keepScroll) sc.scrollTop = prev; else scrollBottom(true);
  if (App.busy) { const n = chat.nodes[App.busy.nodeId]; if (n && n.streaming) paintStream(n); }
}

function scrollBottom(force) {
  const sc = $('stream');
  if (force || App.stick) sc.scrollTop = sc.scrollHeight;
  $('jump').classList.toggle('on', !App.stick && !!App.busy);
}

// ── streaming a reply into its bubble ─────────────────────────────────
function paintStream(n) {
  const el = document.querySelector(`.msg[data-id="${n.id}"] .live`);
  if (!el) return;
  const open = [...el.querySelectorAll('details.astep')].map((d) => d.open);
  const steps = n.agent ? agentStepsHtml(n) : '';
  if (n.content) el.innerHTML = steps + '<div class="content">' + MD.render(n.content, {}) + '<span class="caret"></span></div>';
  else el.innerHTML = steps + `<div class="thinking"><i></i><i></i><i></i><span>${esc(n.status || 'Thinking…')}</span></div>`;
  el.querySelectorAll('details.astep').forEach((d, i) => { if (open[i]) d.open = true; });
  scrollBottom();
}
const paintStreamSoon = (() => { let n = null, pending = false; return (node) => { n = node; if (pending) return; pending = true; requestAnimationFrame(() => { pending = false; paintStream(n); }); }; })();

// refresh one message in place after it finishes (or its actions change)
function refreshMsg(nodeId) {
  const chat = App.chat, n = chat.nodes[nodeId];
  const old = document.querySelector(`.msg[data-id="${nodeId}"]`);
  if (!n || !old) return;
  const path = Store.path(chat);
  const isLast = path.length && path[path.length - 1].id === nodeId;
  const fresh = n.role === 'user' ? userMsgEl(chat, n, isLast) : asstMsgEl(chat, n, isLast);
  old.replaceWith(fresh);
}

// ── composer ───────────────────────────────────────────────────────────
function autosize() {
  const t = $('input');
  t.style.height = 'auto';
  t.style.height = Math.min(t.scrollHeight, 220) + 'px';
}

function renderAttach() {
  const row = $('attachRow');
  row.innerHTML = '';
  for (const a of App.attach) {
    const isImg = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'tif', 'tiff'].includes(a.ext);
    const cls = a.status === 'error' ? 'chip err' : a.status === 'indexing' ? 'chip warn' : a.note ? 'chip warn' : 'chip file';
    const label = a.status === 'indexing' ? (isImg ? 'Reading image…' : 'Reading…') : a.status === 'error' ? 'Couldn’t read' : '';
    row.append(h('span', { class: cls + (a.thumb ? ' pic' : ''), title: a.note || a.path || '' }, a.thumb ? h('img', { class: 'thumb', src: MEDIA + a.thumb, alt: '' }) : h('span', { html: ic(isImg ? 'image' : 'file') }), a.name, label ? h('small', { style: 'opacity:.8' }, label) : null,
      a.note && a.status !== 'indexing' ? h('small', { style: 'opacity:.85' }, '— ' + a.note) : null,
      h('button', { class: 'x', 'aria-label': 'Remove', onclick: () => { App.attach = App.attach.filter((x) => x.id !== a.id); renderAttach(); updateSend(); } }, '×')));
  }
}

function updateSend() {
  const b = $('btnSend');
  if (App.busy) { b.disabled = false; b.className = 'send stop'; b.title = 'Stop generating (Esc)'; b.innerHTML = ic('stop'); return; }
  b.className = 'send'; b.title = 'Send (Enter)'; b.innerHTML = ic('send');
  const readying = App.attach.some((a) => a.status === 'indexing');
  b.disabled = readying || (!$('input').value.trim() && !App.attach.some((a) => a.status === 'ready'));
}

// ── slash menu ─────────────────────────────────────────────────────────
let slashSel = 0, slashItems = [];
function updateSlash() {
  const box = $('slash'), v = $('input').value;
  if (!/^\/[a-z0-9-]*$/i.test(v.split('\n')[0]) || v.includes('\n') || v.includes(' ')) { box.style.display = 'none'; slashItems = []; return; }
  const q = v.slice(1).toLowerCase();
  slashItems = slashList().filter((s) => s.cmd.startsWith(q));
  if (!slashItems.length) { box.style.display = 'none'; return; }
  slashSel = clamp(slashSel, 0, slashItems.length - 1);
  box.innerHTML = '';
  slashItems.forEach((s, i) => box.append(h('div', { class: 'it' + (i === slashSel ? ' sel' : ''), onmousedown: (e) => { e.preventDefault(); pickSlash(i); } }, h('code', {}, '/' + s.cmd), h('span', {}, s.desc), s.skill ? h('small', { style: 'margin-left:auto;color:var(--accent)' }, 'skill') : null)));
  box.style.display = '';
}
function pickSlash(i) {
  const s = slashItems[i]; if (!s) return;
  $('input').value = '/' + s.cmd + ' ';
  $('slash').style.display = 'none'; slashItems = [];
  $('input').focus(); autosize(); updateSend();
}
function slashKey(e) {
  if ($('slash').style.display === 'none' || !slashItems.length) return false;
  if (e.key === 'ArrowDown') { slashSel = (slashSel + 1) % slashItems.length; updateSlash(); return true; }
  if (e.key === 'ArrowUp') { slashSel = (slashSel - 1 + slashItems.length) % slashItems.length; updateSlash(); return true; }
  if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) { pickSlash(slashSel); return true; }
  if (e.key === 'Escape') { $('slash').style.display = 'none'; return true; }
  return false;
}
