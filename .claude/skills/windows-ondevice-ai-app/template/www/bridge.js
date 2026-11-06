// Page side of the bridge. Keep this file; replace the rest of www/ with the real UI.
//
//   const r = await NativeAI.call('generate', { prompt: 'Hello' });          // -> { ok, text, status, ... } (rejects with Error on ok:false)
//   await NativeAI.call('generateStream', { prompt }, ev => ev.text);          // ev: { event:'delta'|'status', text }  (delta text is CUMULATIVE)
//   NativeAI.cancel(id)                                                        // id: NativeAI.lastId() right after starting a call
//   NativeAI.on('autotest', () => ...)                                         // events pushed by the host without a request
//   const b64 = await NativeAI.fileToBase64(file)                              // File/Blob -> base64 (no data: prefix)
//
// Outside the packaged app (a normal browser) window.chrome.webview does not exist: `NativeAI.isNative` is false and calls are
// answered by a tiny mock so that the layout can be developed in any browser.
const NativeAI = (() => {
  const native = !!(window.chrome && window.chrome.webview);
  const pending = new Map();
  const listeners = new Map();
  let counter = 0, last = '';

  if (native) {
    window.chrome.webview.addEventListener('message', (e) => {
      const msg = e.data;
      if (!msg) return;
      if (msg.event) {                                    // progress event
        const p = msg.id && pending.get(msg.id);
        if (p && p.onEvent) p.onEvent(msg);
        else if (!msg.id) (listeners.get(msg.event) || []).forEach(fn => fn(msg));
        return;
      }
      if (!msg.id || !pending.has(msg.id)) return;
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.ok) resolve(msg); else reject(new Error(msg.error || 'Native AI error'));
    });
  }

  function call(type, extra, onEvent) {
    const id = 'c' + (++counter) + '_' + Date.now();
    last = id;
    if (!native) return mock(type, extra || {}, onEvent);
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject, onEvent });
      window.chrome.webview.postMessage(Object.assign({ id, type }, extra));
    });
  }

  function mock(type, a, onEvent) {
    const wait = (ms, v) => new Promise(r => setTimeout(() => r(v), ms));
    const all = ['info', 'status', 'log', 'cancel', 'writeReport', 'ensureReady', 'generate', 'generateStream', 'promptFits', 'summarize',
      'summarizeParagraph', 'rewrite', 'table', 'ocr', 'ocrPdf', 'describeImage', 'pdfText', 'indexAdd', 'indexAddMany', 'indexRemove',
      'indexClear', 'indexQuery', 'indexStats', 'imageGenerate', 'imageRestyle', 'imageUpscale', 'imageCutout'];
    switch (type) {
      case 'info': return wait(50, { ok: true, app: 'Browser mock', modules: ['core', 'language', 'textskills', 'ocr', 'vision', 'pdf', 'index', 'images'], ops: all });
      case 'status': return wait(50, { ok: true, features: [{ module: 'mock', feature: 'Browser mock (no Windows AI)', state: 'NotSupportedOnCurrentSystem' }] });
      case 'generateStream': {
        const text = '[mock] This is a streamed answer from the browser mock.';
        return (async () => { for (let i = 8; i <= text.length + 8; i += 8) { onEvent && onEvent({ event: 'delta', text: text.slice(0, i) }); await wait(60); } return { ok: true, text, status: 'Complete' }; })();
      }
      case 'generate': case 'summarize': case 'summarizeParagraph': case 'rewrite':
        return wait(200, { ok: true, text: '[mock] ' + type + ' result', status: 'Complete' });
      case 'indexQuery': return wait(100, { ok: true, matches: [] });
      case 'indexStats': return wait(50, { ok: true, count: 0 });
      default: return wait(100, { ok: true, text: '[mock] ' + type });
    }
  }

  return {
    isNative: native,
    call,
    lastId: () => last,
    cancel: (id) => call('cancel', { target: id }),
    on: (name, fn) => { if (!listeners.has(name)) listeners.set(name, []); listeners.get(name).push(fn); },
    log: (text) => { if (native) call('log', { text: String(text).slice(0, 300) }).catch(() => { }); },
    fileToBase64: (file) => new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result).split(',')[1] || '');
      fr.onerror = () => reject(fr.error);
      fr.readAsDataURL(file);
    }),
  };
})();
