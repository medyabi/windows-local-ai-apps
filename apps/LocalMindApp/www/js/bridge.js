'use strict';

// The JSON bridge to the desktop shell (WebView2 ↔ C#). Resolved lazily so the page can also load outside the shell (layout preview).
const Native = (() => {
  let counter = 0, wired = false;
  const pending = new Map();
  const listeners = new Set();
  const wv = () => (window.chrome && window.chrome.webview) || null;

  function wire() {
    if (wired || !wv()) return;
    wired = true;
    wv().addEventListener('message', (e) => {
      const msg = e.data;
      if (!msg) return;
      if (msg.event) { listeners.forEach((f) => { try { f(msg); } catch (err) { console.error(err); } }); return; }
      if (!msg.id || !pending.has(msg.id)) return;
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.ok) resolve(msg); else reject(new Error(msg.error || 'Native error'));
    });
  }

  function call(type, extra, files) {
    if (!wv()) return Promise.reject(new Error('The desktop shell isn’t available — run the installed app.'));
    wire();
    const id = 'r' + (++counter) + '_' + Date.now();
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      const m = Object.assign({ id, type }, extra || {});
      if (files && files.length && wv().postMessageWithAdditionalObjects) wv().postMessageWithAdditionalObjects(m, files);
      else wv().postMessage(m);
    });
  }
  const json = (r) => (r.text ? JSON.parse(r.text) : null);

  return {
    get isNative() { return !!wv(); },
    on(fn) { listeners.add(fn); wire(); return () => listeners.delete(fn); },
    ensureReady: () => call('ensureReady'),
    sysInfo: () => call('sysInfo').then(json),

    // chat
    chat: (req) => call('chat', { data: JSON.stringify(req) }).then(json),
    skill: (req) => call('skill', { data: JSON.stringify(req) }).then(json),
    bg: (req) => call('bg', { data: JSON.stringify(req) }).then(json),
    cancel: (rid) => call('cancel', { prompt: rid }),
    image: (req) => call('image', { data: JSON.stringify(req) }).then(json),
    thumb: (path) => call('thumb', { prompt: path }).then((r) => r.text),
    saveImageAs: (rel) => call('saveImageAs', { prompt: rel }).then((r) => r.text),
    openMedia: (rel) => call('openMedia', { prompt: rel }),
    mediaInfo: () => call('mediaInfo').then((r) => parseInt(r.text || '0', 10)),
    clearMedia: () => call('clearMedia'),

    // skills (folders with SKILL.md)
    skillsList: () => call('skillsList').then(json),
    skillSave: (dir, md) => call('skillSave', { prompt: dir, data: md }),
    skillDelete: (dir) => call('skillDelete', { prompt: dir }),
    skillImportFolder: () => call('skillImportFolder').then((r) => r.text),
    skillImportFile: () => call('skillImportFile').then((r) => r.text),
    skillsFolder: () => call('skillsFolder'),

    // page data
    kvGet: (k) => call('kvGet', { prompt: k }).then((r) => (r.text ? JSON.parse(r.text) : null)),
    kvPut: (k, v) => call('kvPut', { prompt: k, data: JSON.stringify(v) }),
    kvDelete: (k) => call('kvDelete', { prompt: k }),
    kvList: (prefix) => call('kvList', { prompt: prefix }).then(json),
    kvGetAll: (prefix) => call('kvGetAll', { prompt: prefix }).then(json),

    // files / knowledge
    getLibrary: () => call('getLibrary').then(json),
    pickFolder: () => call('pickFolder').then((r) => r.text || ''),
    pickFiles: () => call('pickFiles').then(json),
    indexPaths: (paths, describe) => call('indexPaths', { prompt: JSON.stringify(paths), n: describe ? 1 : 0 }).then(json),
    dropPaths: (files, describe) => call('dropPaths', { n: describe ? 1 : 0 }, files).then(json),
    indexStatus: () => call('indexStatus').then(json),
    openPath: (path, reveal) => call('openPath', { prompt: path, n: reveal ? 1 : 0 }),
    removeDoc: (path) => call('removeDoc', { prompt: path }),
    clearLibrary: () => call('clearLibrary'),
    saveAttachment: (ext, b64) => call('saveAttachment', { prompt: ext, data: b64 }).then((r) => r.text),

    // export / import / misc
    saveFile: (name, content) => call('saveFile', { prompt: name, data: content }).then((r) => r.text),
    importFile: () => call('importFile').then((r) => r.text),
    openUrl: (url) => call('openUrl', { prompt: url }),
    revealData: () => call('revealData'),
  };
})();
