'use strict';

// ═══════════════════════════════════════════════════
//  NATIVE BRIDGE (resolved lazily so the page also loads outside the desktop shell)
// ═══════════════════════════════════════════════════
const NativeAI = (() => {
  let counter = 0, wired = false, onEvent = null;
  const pending = new Map();
  const wv = () => (window.chrome && window.chrome.webview) || null;
  function wire() {
    if (wired || !wv()) return;
    wired = true;
    wv().addEventListener('message', (e) => {
      const msg = e.data;
      if (!msg) return;
      if (msg.event) { if (onEvent) onEvent(msg); return; }
      if (!msg.id || !pending.has(msg.id)) return;
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.ok) resolve(msg); else reject(new Error(msg.error || 'Native error'));
    });
  }
  function call(type, extra, files) {
    if (!wv()) return Promise.reject(new Error('The desktop shell isn\'t available — run the installed app (this page only previews the layout).'));
    wire();
    const id = 't' + (++counter) + '_' + Date.now();
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      const m = Object.assign({ id, type }, extra || {});
      if (files && files.length && wv().postMessageWithAdditionalObjects) wv().postMessageWithAdditionalObjects(m, files);
      else wv().postMessage(m);
    });
  }
  return {
    get isNative() { return !!wv(); },
    set onEvent(fn) { onEvent = fn; wire(); },
    ensureReady: () => call('ensureReady'),
    getLibrary: () => call('getLibrary'),
    pickFolder: () => call('pickFolder'),
    indexPaths: (pathOrJson, describe) => call('indexPaths', { prompt: pathOrJson, n: describe ? 1 : 0 }),
    dropPaths: (files, describe) => call('dropPaths', { n: describe ? 1 : 0 }, files),
    indexStatus: () => call('indexStatus'),
    search: (q, scope, hist) => call('search', { prompt: q, data: scope || '', hist: hist || '', n: 8 }),
    ask: (q, scope, hist) => call('ask', { prompt: q, data: scope || '', hist: hist || '' }),
    openPath: (path, reveal) => call('openPath', { prompt: path, n: reveal ? 1 : 0 }),
    removeDoc: (path) => call('removeDoc', { prompt: path }),
    clearLibrary: () => call('clearLibrary'),
  };
})();

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const escRx = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const state = { docs: [], totalChunks: 0, lastFolder: '', scope: '', prevQuestion: '', busy: false, indexing: false, polling: false, messages: 0 };

function toast(msg, ms = 3200) {
  const t = $('toast');
  t.textContent = msg; t.classList.add('on');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('on'), ms);
}
function setPill(id, cls, html, title) {
  const p = $(id);
  p.className = 'pill' + (cls ? ' ' + cls : '');
  p.innerHTML = '<i></i>' + html;
  if (title) p.title = title;
}
function addNote(cls, html) { $('addNote').innerHTML = html ? `<div class="note ${cls}">${html}</div>` : ''; }

// ═══════════════════════════════════════════════════
//  LIBRARY
// ═══════════════════════════════════════════════════
function extBadge(ext) {
  const e = (ext || '').replace('.', '').toLowerCase();
  return { cls: e, label: (e === 'markdown' ? 'md' : e).toUpperCase().slice(0, 4) };
}
function fmtSize(b) {
  if (b > 1048576) return (b / 1048576).toFixed(1) + ' MB';
  if (b > 1024) return Math.round(b / 1024) + ' KB';
  return b + ' B';
}

function renderLibrary() {
  const ok = state.docs.filter(d => d.status === 'indexed');
  $('libTitle').textContent = state.docs.length ? `Library · ${ok.length} docs · ${state.totalChunks} passages` : 'Library';
  $('rescanBtn').style.display = $('clearBtn').style.display = state.docs.length ? '' : 'none';

  const sel = $('scopeSel');
  const keep = state.docs.some(d => d.path === state.scope) ? state.scope : '';
  state.scope = keep;
  sel.innerHTML = '<option value="">All documents</option>' + ok.map(d => `<option value="${esc(d.path)}">${esc(d.name)}</option>`).join('');
  sel.value = keep;
  updatePlaceholder();

  const list = $('docList');
  if (!state.docs.length) { list.innerHTML = '<li class="empty-lib">No documents yet.<br>Drop a folder, paste a path, or press Browse.</li>'; return; }
  list.innerHTML = state.docs.map(d => {
    const b = extBadge(d.ext);
    let meta, mcls = '';
    if (d.status === 'indexed') { meta = `${d.pages ? d.pages + ' ' + (d.ext === '.pdf' ? 'pages' : 'sections') + ' · ' : ''}${d.chunks} passages · ${fmtSize(d.sizeBytes)}`; if (d.note) { meta += ' · ⚠ ' + d.note; mcls = 'warn'; } }
    else { meta = d.note || d.status; mcls = d.status === 'error' ? 'bad' : 'warn'; }
    return `<li class="doc${state.scope === d.path ? ' sel' : ''}" data-path="${esc(d.path)}" title="${esc(d.path)}">
      <div class="badge ${esc(b.cls)}">${esc(b.label)}</div>
      <div style="min-width:0"><div class="doc-name">${esc(d.name)}</div><div class="doc-meta ${mcls}">${esc(meta)}</div></div>
      <div class="doc-actions">
        ${d.status === 'indexed' ? '<button class="ibtn" data-act="scope" title="Ask only about this document">🎯</button>' : ''}
        <button class="ibtn" data-act="open" title="Open file">↗</button>
        <button class="ibtn" data-act="reveal" title="Show in folder">📁</button>
        <button class="ibtn" data-act="remove" title="Remove from library">✕</button>
      </div></li>`;
  }).join('');
  renderHero();
}

async function refreshLibrary() {
  try {
    const r = JSON.parse((await NativeAI.getLibrary()).text);
    state.docs = r.docs || []; state.totalChunks = r.totalChunks || 0; state.lastFolder = r.lastFolder || '';
    if (state.lastFolder && !$('pathInput').value) $('pathInput').value = state.lastFolder;
  } catch (e) { /* preview mode */ }
  renderLibrary();
}

$('docList').addEventListener('click', async (e) => {
  const li = e.target.closest('.doc'); if (!li) return;
  const path = li.dataset.path;
  const act = e.target.closest('[data-act]')?.dataset.act;
  try {
    if (act === 'open') await NativeAI.openPath(path, false);
    else if (act === 'reveal') await NativeAI.openPath(path, true);
    else if (act === 'remove') { await NativeAI.removeDoc(path); await refreshLibrary(); pollStatus(); toast('Removed from the library'); }
    else if (act === 'scope') setScope(state.scope === path ? '' : path);
  } catch (err) { toast(err.message); }
});
function setScope(path) {
  state.scope = path; $('scopeSel').value = path;
  document.querySelectorAll('.doc').forEach(el => el.classList.toggle('sel', el.dataset.path === path));
  updatePlaceholder();
}
function updatePlaceholder() {
  const d = state.docs.find(x => x.path === state.scope);
  $('q').placeholder = d ? `Ask about ${d.name}…` : 'Ask anything about your files…  e.g. “What did we decide about the launch date?”';
}
$('scopeSel').addEventListener('change', (e) => setScope(e.target.value));

// ═══════════════════════════════════════════════════
//  INDEXING
// ═══════════════════════════════════════════════════
function setProgress(on, pct, text, indeterminate) {
  $('prog').classList.toggle('on', on);
  const bar = $('progBar');
  bar.classList.toggle('indet', !!indeterminate);
  bar.style.width = indeterminate ? '' : (pct || 0) + '%';
  $('progText').textContent = text || '';
}
NativeAI.onEvent = (ev) => {
  if (ev.event !== 'progress') return;
  if (ev.stage === 'scanning') setProgress(true, 0, 'Scanning for documents…', true);
  else setProgress(true, ev.total ? Math.round(ev.current / ev.total * 100) : 0, `Reading ${ev.current} of ${ev.total} — ${ev.file}`, false);
};

async function runIndex(starter) {
  if (state.indexing) { toast('Already indexing — one moment.'); return; }
  state.indexing = true; setButtons();
  addNote('', ''); setProgress(true, 0, 'Starting…', true);
  try {
    const sum = JSON.parse((await starter()).text);
    const parts = [];
    if (sum.added) parts.push(`${sum.added} new`);
    if (sum.updated) parts.push(`${sum.updated} updated`);
    if (sum.unchanged) parts.push(`${sum.unchanged} unchanged`);
    if (sum.skipped) parts.push(`${sum.skipped} skipped`);
    if (sum.failed) parts.push(`${sum.failed} failed`);
    const head = sum.filesSeen ? `✓ ${sum.filesSeen} file${sum.filesSeen === 1 ? '' : 's'} scanned — ${parts.join(' · ') || 'nothing to do'} (${sum.chunksAdded} passages, ${sum.seconds}s)` : 'No supported files found.';
    const msgs = (sum.messages || []).slice(0, 3).map(m => `<br>• ${esc(m)}`).join('');
    addNote(sum.failed || !sum.filesSeen ? 'warn' : 'ok', esc(head) + msgs);
    await refreshLibrary();
    pollStatus(true);
  } catch (e) {
    addNote('bad', esc(e.message));
  } finally {
    state.indexing = false; setProgress(false); setButtons();
  }
}
const describeOn = () => !!$('describeToggle').checked;
function setButtons() {
  $('indexBtn').disabled = $('browseBtn').disabled = $('rescanBtn').disabled = state.indexing;
  $('indexBtn').textContent = state.indexing ? 'Indexing…' : 'Index this folder';
}

$('indexBtn').addEventListener('click', () => {
  const p = $('pathInput').value.trim();
  if (!p) { addNote('warn', 'Paste a folder path above, or press <b>Browse…</b>'); return; }
  runIndex(() => NativeAI.indexPaths(p, describeOn()));
});
$('pathInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('indexBtn').click(); });
$('browseBtn').addEventListener('click', async () => {
  try {
    const r = await NativeAI.pickFolder();
    if (r.text) { $('pathInput').value = r.text; runIndex(() => NativeAI.indexPaths(r.text, describeOn())); }
  } catch (e) { addNote('bad', esc(e.message)); }
});
$('rescanBtn').addEventListener('click', () => {
  const p = $('pathInput').value.trim() || state.lastFolder;
  if (!p) { toast('No folder to re-scan yet.'); return; }
  runIndex(() => NativeAI.indexPaths(p, describeOn()));
});
$('clearBtn').addEventListener('click', async () => {
  if (!confirm('Remove all documents from the library? Your original files are not touched.')) return;
  try { await NativeAI.clearLibrary(); await refreshLibrary(); pollStatus(); toast('Library cleared'); } catch (e) { toast(e.message); }
});

// drag & drop anywhere in the window
let dragDepth = 0;
const hasFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
window.addEventListener('dragenter', (e) => { if (hasFiles(e)) { dragDepth++; document.body.classList.add('dragging'); e.preventDefault(); } });
window.addEventListener('dragover', (e) => { e.preventDefault(); });
window.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) document.body.classList.remove('dragging'); });
window.addEventListener('drop', (e) => {
  e.preventDefault(); dragDepth = 0; document.body.classList.remove('dragging');
  const files = Array.from(e.dataTransfer?.files || []);
  if (files.length) runIndex(() => NativeAI.dropPaths(files, describeOn()));
});

// index health pill
async function pollStatus(force) {
  if (state.polling && !force) return;
  state.polling = true;
  try {
    for (let i = 0; i < 400; i++) {
      let st;
      try { st = JSON.parse((await NativeAI.indexStatus()).text); } catch { setPill('pillIndex', '', 'Index: n/a'); break; }
      renderIndexPill(st);
      if (st.idle || !st.indexReady) break;
      await new Promise(r => setTimeout(r, 1500));
    }
  } finally { state.polling = false; }
}
function renderIndexPill(st) {
  const tip = `Local index (Windows App Content Search). Semantic: ${st.semantic}. Keyword: ${st.lexical}.`;
  if (!state.docs.length) setPill('pillIndex', '', 'Index: empty', tip);
  else if (!st.idle) setPill('pillIndex', 'warn', `Index building… ${st.completed}/${st.items}`, tip + ' Answers already work (keyword search) while the semantic index finishes.');
  else setPill('pillIndex', 'ok', `Index ready · ${st.items} passages`, tip);
}

// ═══════════════════════════════════════════════════
//  ASK
// ═══════════════════════════════════════════════════
const STOP = new Set('the and for are what which who how does with that this from have has can its into per your you any all not was were will would should could about there their than then them when where why also use used using get list show tell give please between compare'.split(' '));
function highlightRx(question) {
  const terms = [...new Set((question.match(/[A-Za-z0-9][A-Za-z0-9.\-_/+%]*/g) || []).map(t => t.replace(/[.\-_/+]+$/, '')).filter(t => t.length >= 3 && !STOP.has(t.toLowerCase())))];
  return terms.length ? new RegExp('(' + terms.sort((a, b) => b.length - a.length).map(escRx).join('|') + ')', 'gi') : null;
}
function markLine(line, rx) {
  if (!rx) return esc(line);
  let out = '', last = 0;
  line.replace(rx, (m, _g, idx) => { out += esc(line.slice(last, idx)) + '<mark>' + esc(m) + '</mark>'; last = idx + m.length; return m; });
  return out + esc(line.slice(last));
}
function srcTextHtml(h, rx) {
  const keys = new Set(h.keyLines || []);
  return h.text.split('\n').map(line => keys.has(line) ? `<span class="kl">${markLine(line, rx)}</span>` : markLine(line, rx) + '\n').join('');
}

function inline(s) {
  s = esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\[(\d+(?:\s*,\s*\d+)*)\]/g, (m, g) => g.split(',').map(n => `<a class="cite" data-n="${n.trim()}">${n.trim()}</a>`).join(''));
  return s.replace(/(<a class="cite" data-n="(\d+)">\d+<\/a>)(?:\s*)+/g, '$1');
}
function formatAnswer(text) {
  let out = '', inList = false;
  for (let ln of text.split(/\n+/)) {
    ln = ln.trim(); if (!ln) continue;
    const m = ln.match(/^(?:[-*•]|\d+[.)])\s+(.*)$/);
    if (m) { if (!inList) { out += '<ul>'; inList = true; } out += '<li>' + inline(m[1]) + '</li>'; }
    else { if (inList) { out += '</ul>'; inList = false; } out += '<p>' + inline(ln) + '</p>'; }
  }
  return out + (inList ? '</ul>' : '');
}

function verifyHtml(r) {
  if (r.notFound) return '';
  const f = r.numbersFound || [], m = r.numbersMissing || [];
  let h = '';
  if (m.length) h += `<div class="vchip warn">⚠ <b>Number check:</b> not found verbatim in the sources — ${m.map(x => `<code>${esc(x)}</code>`).join(' ')}. The model may have calculated or misread it; confirm in the source cards below.</div>`;
  if (f.length && !m.length) h += `<div class="vchip ok">✓ <b>Number check:</b> every value in the answer appears verbatim in the sources — ${f.slice(0, 8).map(x => `<code>${esc(x)}</code>`).join(' ')}</div>`;
  else if (f.length) h += `<div class="vchip info">Found in sources: ${f.slice(0, 8).map(x => `<code>${esc(x)}</code>`).join(' ')}</div>`;
  if (r.rescued) h += '<div class="vchip info">The first attempt didn\'t produce an answer, so the app retried using the best-matching passages.</div>';
  if (r.autoCited) h += '<div class="vchip info">The model didn\'t cite sources, so the app attached them based on where each value appears.</div>';
  else if (r.citationsFixed) h += '<div class="vchip info">Some citations were corrected by the app so they point at the passage that actually contains the quoted values.</div>';
  return h ? `<div class="verify">${h}</div>` : '';
}

function keysHtml(hits) {
  const rows = [];
  for (const h of hits.filter(x => x.sent !== false).concat(hits.filter(x => x.sent === false))) for (const l of (h.keyLines || [])) rows.push({ l, h });
  if (!rows.length) return '';
  return `<div class="keys"><div class="srcs-title" style="margin-top:12px">Best matching lines</div>` +
    rows.slice(0, 4).map(({ l, h }) => `<div class="kline"><code>${esc(l)}</code><span><a class="cite" data-n="${h.n}">${h.n}</a> ${esc(h.docName)} · ${esc(h.loc)}</span></div>`).join('') + '</div>';
}

function sourcesHtml(r, rx, title) {
  const hits = r.hits || [];
  if (!hits.length) return '';
  const docs = new Set(hits.map(h => h.docPath)).size;
  return `<div class="srcs-title">${esc(title)} · ${hits.length} passage${hits.length === 1 ? '' : 's'} from ${docs} document${docs === 1 ? '' : 's'}</div>` + hits.map((h, i) => {
    const tags = (h.viaIndex ? '<span class="tag sem">semantic</span>' : '') + (h.viaKeyword ? '<span class="tag kw">keyword</span>' : '') + (h.sent === false ? '<span class="tag nosend">not sent to AI</span>' : '');
    return `<details class="src" data-n="${h.n}" ${i === 0 ? 'open' : ''}>
      <summary><span class="sn ${h.sent === false ? 'dim' : ''}">${h.n}</span><span class="sname">${esc(h.docName)}</span><span class="sloc">${esc(h.loc)}</span><span class="tags">${tags}</span></summary>
      <div class="src-body"><div class="src-text">${srcTextHtml(h, rx)}</div>
        <div class="src-actions"><button class="btn sm" data-open="${esc(h.docPath)}">Open file</button><button class="btn sm" data-reveal="${esc(h.docPath)}">Show in folder</button></div></div></details>`;
  }).join('');
}

function metaHtml(r, answered) {
  const hits = r.hits || [];
  const parts = [`${hits.length} passages retrieved in ${r.retrievalMs} ms`];
  parts.push(`semantic index ${r.indexMatches} · keyword ${r.keywordMatches} candidates`);
  if (answered) parts.push(`${r.excerptsSent} sent to the on-device model · answered in ${(r.generationMs / 1000).toFixed(1)} s`);
  return `<div class="meta">${parts.map(esc).map(x => `<span>${x}</span>`).join('')}</div>`;
}

function appendHtml(html) {
  const wrap = document.createElement('div');
  wrap.innerHTML = html;
  const node = wrap.firstElementChild;
  $('threadCol').appendChild(node);
  state.messages++; $('hero')?.remove();
  return node;
}
function renderHero() {
  if (state.messages) return;
  const ready = state.docs.some(d => d.status === 'indexed');
  const mark = $('threadCol').querySelector('.hero svg')?.outerHTML || document.querySelector('.brand svg').outerHTML;
  const chips = ['What did we decide in the last meeting?', 'How much is due on the latest invoice?', 'What does the contract say about termination?', 'Where is the retry logic implemented?', 'What is on the whiteboard?'];
  const n = state.docs.filter(d => d.status === 'indexed').length;
  $('threadCol').innerHTML = `<div class="hero" id="hero">${mark}
    <h1>Ask your local assistant anything.</h1>
    <p>${ready ? `${n} file${n === 1 ? '' : 's'} indexed on this PC. Answers are written on-device and cite the exact passages they come from.` : 'Point it at a folder of documents, PDFs, notes, spreadsheets, images or code. Everything is indexed on this PC — nothing is uploaded, and it all works offline.'}</p>
    ${ready ? `<div class="chips">${chips.map(c => `<button class="chip" data-chip="${esc(c)}">${esc(c)}</button>`).join('')}</div>`
      : `<div class="steps"><div class="card step"><div class="n">1</div><b>Add a folder</b><span>Drop it here, paste a path, or press Browse.</span></div>
         <div class="card step"><div class="n">2</div><b>Let it read</b><span>Documents, tables, scanned pages and images are read and indexed locally.</span></div>
         <div class="card step"><div class="n">3</div><b>Ask</b><span>Phi Silica answers from your files and shows the sources.</span></div></div>`}
  </div>`;
}

$('threadCol').addEventListener('click', async (e) => {
  const chip = e.target.closest('[data-chip]');
  if (chip) { ask(chip.dataset.chip); return; }
  const open = e.target.closest('[data-open]'), reveal = e.target.closest('[data-reveal]');
  if (open || reveal) { try { await NativeAI.openPath((open || reveal).dataset.open || reveal.dataset.reveal, !!reveal); } catch (err) { toast(err.message); } return; }
  const cite = e.target.closest('.cite');
  if (cite) {
    const msg = cite.closest('.msg'); const src = msg && msg.querySelector(`.src[data-n="${cite.dataset.n}"]`);
    if (src) { src.open = true; src.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); src.classList.remove('flash'); void src.offsetWidth; src.classList.add('flash'); }
  }
});

let thinkTimer = null;
async function ask(question) {
  question = (question || '').trim();
  if (!question || state.busy) return;
  if (!state.docs.some(d => d.status === 'indexed')) { toast('Add a folder of documents first.'); return; }
  state.busy = true; $('askBtn').disabled = true;
  const raw = $('rawMode').checked;
  const rx = highlightRx(question);
  appendHtml(`<div class="msg q"><div class="bubble">${esc(question)}</div></div>`);
  const holder = appendHtml(`<div class="msg"><div class="card think"><div class="spin"></div><span id="thinkText">${raw ? 'Searching your documents…' : 'Searching your documents and writing an answer…'}</span></div></div>`);
  holder.scrollIntoView({ block: 'end', behavior: 'smooth' });
  const t0 = Date.now();
  clearInterval(thinkTimer);
  thinkTimer = setInterval(() => { const s = Math.round((Date.now() - t0) / 1000); const el = $('thinkText'); if (el && !raw && s >= 2) el.textContent = `Reading the passages and writing an answer… ${s}s`; }, 1000);
  try {
    let html;
    if (raw) {
      const r = JSON.parse((await NativeAI.search(question, state.scope, state.prevQuestion)).text);
      r.hits.forEach((h, i) => { h.n = h.n || i + 1; });
      html = `<div class="msg"><div class="card a"><div class="a-head"><span class="dot"></span>Passages only</div>
        <div class="a-body"><p>${r.hits.length ? 'Here are the most relevant passages — no AI answer was generated.' : 'No matching passages found.'}</p></div>${metaHtml(r, false)}</div>${keysHtml(r.hits)}${sourcesHtml(r, rx, 'Sources')}</div>`;
    } else {
      const r = JSON.parse((await NativeAI.ask(question, state.scope, state.prevQuestion)).text);
      r.hits.forEach(h => { h.sent = h.sent !== false; });
      let body, head = 'Answer', cls = '';
      if (r.modelError && !r.answer) {
        head = 'AI answer unavailable';
        body = `<p>The on-device model couldn't answer (${esc(r.modelError)}). The most relevant passages are shown below, so you can still find the value.</p>`;
      } else if (r.notFound && r.hits.some(h => (h.keyLines || []).length)) {
        head = 'No confident answer';
        body = `<p><b>The model couldn't turn these passages into a confident answer</b>, but some lines match your question closely — see the highlighted lines below. You may need to read or compare them yourself.</p>`;
      } else if (r.notFound) {
        head = 'Not found';
        const unk = (r.unknownTerms || []).map(t => `<b>${esc(t)}</b>`).join(', ');
        body = unk
          ? `<p><b>I couldn't find that in your documents</b> — none of the indexed files mention ${unk}. The closest passages are below in case it's worded differently.</p>`
          : `<p><b>I couldn't find that in your documents.</b> The closest passages are below — worth a quick look in case the answer is phrased differently.</p>`;
      } else body = formatAnswer(r.answer);
      html = `<div class="msg"><div class="card a"><div class="a-head"><span class="dot" ${r.notFound ? 'style="background:var(--warn)"' : ''}></span>${esc(head)}</div>
        <div class="a-body">${body}</div>${verifyHtml(r)}${metaHtml(r, !!r.answer)}</div>${keysHtml(r.hits)}${sourcesHtml(r, rx, 'Sources')}</div>`;
    }
    holder.replaceWith(Object.assign(document.createElement('div'), { innerHTML: html }).firstElementChild);
    state.prevQuestion = question;
  } catch (e) {
    holder.querySelector('.card').innerHTML = `<div class="a-head"><span class="dot" style="background:var(--bad)"></span>Something went wrong</div><div class="a-body"><p>${esc(e.message)}</p></div>`;
  } finally {
    clearInterval(thinkTimer);
    state.busy = false; $('askBtn').disabled = false;
    const msgs = $('threadCol').querySelectorAll('.msg');
    const lastQ = [...$('threadCol').querySelectorAll('.msg.q')].pop();
    if (lastQ) lastQ.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }
}

// composer
const ta = $('q');
function autosize() { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 140) + 'px'; }
ta.addEventListener('input', autosize);
ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('askBtn').click(); } });
$('askBtn').addEventListener('click', () => { const v = ta.value; if (!v.trim() || state.busy) return; ta.value = ''; autosize(); ask(v); });
document.addEventListener('keydown', (e) => {
  if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) { e.preventDefault(); ta.focus(); }
  if (e.key === 'Escape') $('howModal').classList.remove('on');
});

// how it works
$('howBtn').addEventListener('click', () => $('howModal').classList.add('on'));
$('howClose').addEventListener('click', () => $('howModal').classList.remove('on'));
$('howModal').addEventListener('click', (e) => { if (e.target === $('howModal')) $('howModal').classList.remove('on'); });
$('netTest').addEventListener('click', async () => {
  const out = $('netResult'); out.textContent = 'Trying…';
  try { await fetch('https://example.com/', { mode: 'no-cors' }); out.textContent = '⚠ The request went out'; out.style.color = 'var(--bad)'; }
  catch (e) { out.textContent = '✓ Blocked — this window cannot reach the network'; out.style.color = 'var(--ok)'; }
});

// ═══════════════════════════════════════════════════
//  START
// ═══════════════════════════════════════════════════
(async function init() {
  renderHero();
  if (!NativeAI.isNative) {
    setPill('pillModel', 'warn', 'Layout preview (no desktop shell)');
    return;
  }
  await refreshLibrary();
  pollStatus();
  try {
    const r = await NativeAI.ensureReady();
    setPill('pillModel', 'ok', 'AI model: Phi Silica ready', 'On-device model, running on this PC\'s NPU.');
  } catch (e) {
    setPill('pillModel', 'bad', 'AI model unavailable', e.message + ' — "Passages only" mode still works.');
  }
})();
