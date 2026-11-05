'use strict';

// Start-up and event wiring.
async function initModel() {
  setStatus('busy', 'Starting model…');
  try {
    const r = await Native.ensureReady();
    App.model = { ok: true, state: r.state, text: 'Ready' };
    setStatus('ok', 'On-device ready', 'The on-device language model is ready. Click for details.');
  } catch (e) {
    App.model = { ok: false, text: e.message };
    setStatus('bad', 'Model unavailable', e.message);
  }
}

function toggleSidebar(force) {
  const app = $('app');
  const collapse = force !== undefined ? force : !app.classList.contains('collapsed');
  app.classList.toggle('collapsed', collapse);
  Store.settings.sidebar = !collapse; Store.saveSettings();
  $('btnOpen').style.display = collapse ? '' : 'none';
}

function assistantMenu() {
  const c = App.chat;
  popMenu($('btnAssistant'), [
    { header: 'Assistant for this chat' },
    ...Store.allAssistants().map((a) => ({ label: (a.id === c.assistantId ? '✓ ' : '') + a.name, icon: 'wand', hint: a.builtin ? '' : 'custom', fn: () => { c.assistantId = a.id; if (!c.temporary && Store.path(c).length) Store.saveChat(c); renderSidebar(); renderThread(true); } })),
    'hr', { label: 'Manage assistants…', icon: 'gear', fn: openAssistants },
  ]);
}

function chatOptionsMenu() {
  const c = App.chat, has = S_hasMessages();
  const items = [];
  if (has && !c.temporary) { chatMenu($('btnChatMenu'), c.id, { right: true }); return; }
  items.push({ label: c.temporary ? 'Leave temporary mode' : 'Temporary chat (not saved, no memory)', icon: 'lock', fn: () => { if (!has) { c.temporary = !c.temporary; renderTop(); renderThread(true); } else toast('Start a new chat to use temporary mode.'); } },
    { label: 'Files this chat can use…', icon: 'book', fn: openLibrary }, { label: 'Context details', icon: 'info', fn: openContextInfo }, 'hr', { label: 'Settings', icon: 'gear', fn: () => openSettings() });
  popMenu($('btnChatMenu'), items, { right: true });
}

function lastUserNode() { const p = Store.path(App.chat).filter((n) => n.role === 'user'); return p[p.length - 1]; }

function wire() {
  // top / sidebar buttons
  $('btnNew').onclick = () => newChat();
  $('btnSearch').onclick = openSearch;
  $('btnCollapse').onclick = () => toggleSidebar(true);
  $('btnOpen').onclick = () => toggleSidebar(false);
  $('btnSettings').onclick = () => openSettings();
  $('btnMem').onclick = openMemory;
  $('status').onclick = () => openSettings('model');
  $('status').onkeydown = (e) => { if (e.key === 'Enter') openSettings('model'); };
  $('btnTheme').onclick = () => { const dark = document.documentElement.dataset.theme === 'dark'; Store.settings.theme = dark ? 'light' : 'dark'; Store.saveSettings(); applyTheme(); };
  $('btnTemp').onclick = () => { if (S_hasMessages()) return; App.chat.temporary = !App.chat.temporary; renderTop(); renderThread(true); toast(App.chat.temporary ? 'Temporary chat: nothing is saved and memory is off.' : 'Normal chat.'); };
  $('btnCtx').onclick = openContextInfo;
  $('btnChatMenu').onclick = chatOptionsMenu;
  $('btnAssistant').onclick = assistantMenu;
  $('btnAttach').onclick = pickAttachments;
  $('btnImage').onclick = () => { const i = $('input'); if (!i.value.startsWith('/image')) i.value = '/image ' + i.value; i.focus(); autosize(); updateSend(); updateSlash(); toast('Describe the picture and press Enter. Attach a photo first to restyle it.'); };
  $('btnKnow').onclick = openLibrary;
  $('scopeChip').onclick = openLibrary;
  $('btnSend').onclick = () => (App.busy ? stopGenerating() : send());
  $('jump').onclick = () => { App.stick = true; scrollBottom(true); };

  // sidebar clicks
  $('sbScroll').addEventListener('click', (e) => {
    const more = e.target.closest('[data-more]');
    if (more) { e.stopPropagation(); chatMenu(more, more.dataset.more); return; }
    const pm = e.target.closest('[data-projmore]');
    if (pm) { e.stopPropagation(); projectMenu(pm, pm.dataset.projmore); return; }
    const act = e.target.closest('[data-act]');
    if (act) {
      const a = act.dataset.act;
      if (a === 'manageAssistants') openAssistants();
      else if (a === 'newProject') editProject(null);
      else if (a === 'clearProject') { App.projectFilter = null; renderSidebar(); }
      else if (a === 'toggleArchived') { App.showArchived = !App.showArchived; renderSidebar(); }
      return;
    }
    const ch = e.target.closest('[data-chat]'); if (ch) return openChat(ch.dataset.chat);
    const as = e.target.closest('[data-asst]'); if (as) return newChat({ assistantId: as.dataset.asst });
    const pr = e.target.closest('[data-proj]');
    if (pr) { App.projectFilter = App.projectFilter === pr.dataset.proj ? null : pr.dataset.proj; renderSidebar(); }
  });
  $('sbScroll').addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches('.row')) e.target.click(); });
  $('sbScroll').addEventListener('contextmenu', (e) => { const ch = e.target.closest('[data-chat]'); if (ch) { e.preventDefault(); chatMenu(ch, ch.dataset.chat); } });

  // thread clicks
  $('thread').addEventListener('click', (e) => {
    const t = e.target;
    const st = t.closest('[data-starter]'); if (st) { send(st.dataset.starter); return; }
    const link = t.closest('a[data-href]'); if (link) { e.preventDefault(); openLink(link.dataset.href); return; }
    const cite = t.closest('.cite');
    if (cite) {
      const det = cite.closest('.msg').querySelector('.sources');
      if (det) { det.open = true; const s = det.querySelector(`.src[data-n="${cite.dataset.n}"]`); if (s) { s.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); s.classList.remove('flash'); void s.offsetWidth; s.classList.add('flash'); } }
      return;
    }
    const btn = t.closest('[data-act]'); if (!btn) return;
    const block = btn.closest('.codeblock');
    const act = btn.dataset.act;
    if (block) {
      if (act === 'copy') copyText(codeOf(block)).then((ok) => { btn.innerHTML = ic('check') + 'Copied'; setTimeout(() => { btn.innerHTML = ic('copy') + 'Copy'; }, 1400); });
      else if (act === 'run') runCode(block);
      else if (act === 'preview') previewCode(block);
      return;
    }
    if (act === 'saveImg') { Native.saveImageAs(btn.dataset.url).then((p) => { if (p) toast('Saved to ' + p); }).catch((er) => toast(er.message)); return; }
    if (act === 'openImg') { Native.openMedia(btn.dataset.url).catch((er) => toast(er.message)); return; }
    if (act === 'useImg') { attachPaths([btn.dataset.path]); $('input').focus(); toast('Picture added to your next message.'); return; }
    if (act === 'openSkills') return openSettings('skills');
    if (act === 'openCloud') return openSettings('cloud');
    if (act === 'skillOff') {
      const um = btn.closest('.msg'), un = um && App.chat.nodes[um.dataset.id];
      if (!un || App.busy) return;
      un.skillOff = true; Store.saveChat(App.chat); refreshMsg(un.id);
      const reply = un.children.map((k) => App.chat.nodes[k]).filter((x) => x.role === 'assistant').pop();
      if (reply) regenerate(reply.id);
      return;
    }
    if (act === 'openMemory') return openMemory();
    if (act === 'openLibrary') return openLibrary();
    const msg = btn.closest('.msg'); if (!msg && act !== 'openSrc') return;
    const id = msg && msg.dataset.id, chat = App.chat, n = id && chat.nodes[id];
    switch (act) {
      case 'copy': copyText(n.content).then((ok) => toast(ok ? 'Copied' : 'Couldn’t copy')); break;
      case 'copyUser': copyText(n.content).then((ok) => toast(ok ? 'Copied' : 'Couldn’t copy')); break;
      case 'edit': startEdit(id); break;
      case 'regen': regenerate(id); break;
      case 'retryCloud': regenerate(id, { forceCloud: true }); break;
      case 'retryDevice': regenerate(id, { forceDevice: true }); break;
      case 'up': setFeedback(id, 'up'); break;
      case 'down': setFeedback(id, 'down'); break;
      case 'speak': speak(id); break;
      case 'info': showInfo(id); break;
      case 'prev': switchVersion(id, -1); break;
      case 'next': switchVersion(id, +1); break;
      case 'openSrc': Native.openPath(btn.dataset.path, false).catch((er) => toast(er.message)); break;
      case 'undoMem': {
        const mid = btn.dataset.mid; Store.removeMemory(mid);
        n.memoryAdded = (n.memoryAdded || []).filter((m) => m.id !== mid); Store.saveChat(chat); refreshMsg(id); renderTop(); toast('Memory removed.');
        break;
      }
    }
  });

  // scrolling
  $('stream').addEventListener('scroll', () => { const s = $('stream'); App.stick = s.scrollHeight - s.scrollTop - s.clientHeight < 90; $('jump').classList.toggle('on', !App.stick && !!App.busy); });

  // composer
  const inp = $('input');
  inp.addEventListener('input', () => { autosize(); updateSend(); updateSlash(); });
  inp.addEventListener('keydown', (e) => {
    if (slashKey(e)) { e.preventDefault(); return; }
    if (e.key === 'Enter' && !e.isComposing) {
      const wantSend = Store.settings.enterToSend ? !e.shiftKey : e.ctrlKey;
      if (wantSend) { e.preventDefault(); if (!App.busy) send(); }
    } else if (e.key === 'ArrowUp' && !inp.value && !App.busy) { const u = lastUserNode(); if (u) { e.preventDefault(); startEdit(u.id); } }
    else if (e.key === 'Escape' && App.busy) stopGenerating();
  });
  inp.addEventListener('paste', (e) => {
    const items = [...(e.clipboardData && e.clipboardData.items || [])];
    const img = items.find((i) => i.kind === 'file' && i.type.startsWith('image/'));
    if (img) { e.preventDefault(); attachPastedImage(img.getAsFile()); return; }
    const files = e.clipboardData && e.clipboardData.files && e.clipboardData.files.length ? [...e.clipboardData.files] : null;
    if (files) { e.preventDefault(); attachPaths(null, files); }
  });

  // drag & drop files anywhere
  let depth = 0;
  const hasFiles = (e) => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
  document.addEventListener('dragenter', (e) => { if (hasFiles(e) && !$('overlay').classList.contains('on')) { depth++; $('dropveil').classList.add('on'); } });
  document.addEventListener('dragleave', (e) => { if (hasFiles(e)) { depth = Math.max(0, depth - 1); if (!depth) $('dropveil').classList.remove('on'); } });
  document.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
  document.addEventListener('drop', (e) => {
    depth = 0; $('dropveil').classList.remove('on');
    if (!hasFiles(e) || $('overlay').classList.contains('on')) return;
    e.preventDefault();
    if (e.dataTransfer.files.length) attachPaths(null, [...e.dataTransfer.files]);
  });

  // keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.shiftKey && e.key.toLowerCase() === 'o') { e.preventDefault(); newChat(); }
    else if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); openSearch(); }
    else if (mod && e.key.toLowerCase() === 'b') { e.preventDefault(); toggleSidebar(); }
    else if (mod && e.key === ',') { e.preventDefault(); openSettings(); }
    else if (mod && e.shiftKey && e.key.toLowerCase() === 't') { e.preventDefault(); $('btnTemp').click(); }
    else if (e.key === 'Escape' && App.busy && !$('overlay').classList.contains('on')) stopGenerating();
    else if (e.key === '/' && !mod && document.activeElement === document.body) { e.preventDefault(); $('input').focus(); }
  });
  wireHybrid();
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
  window.addEventListener('beforeunload', () => Store.flushNow());
}

async function boot() {
  applyTheme();
  try { await Store.load(); } catch (e) { console.error('load', e); toast('Couldn’t load saved data: ' + e.message); }
  await Skills.load();
  await Router.refresh();
  applyTheme();
  $('app').classList.toggle('collapsed', Store.settings.sidebar === false || window.innerWidth <= 760);
  App.chat = Store.newChat();
  wire();
  renderAll();
  updateRouteUi();
  initModel();
  refreshLibrary().then(() => renderTop());
  $('input').focus();
}

boot();
