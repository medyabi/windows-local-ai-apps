// Development-only stand-in for the WebView2 bridge, so the UI can be exercised in a plain browser. Never shipped.
(() => {
  const kv = {};
  const listeners = [];
  const emit = (data) => setTimeout(() => listeners.forEach((f) => f({ data })), 0);
  const docs = [
    { path: 'C:\\files\\Vendor-Agreement.docx', name: 'Vendor-Agreement.docx', ext: '.docx', sizeBytes: 31000, pages: 0, chunks: 4, status: 'indexed', note: '' },
    { path: 'C:\\files\\Q3-sales.csv', name: 'Q3-sales.csv', ext: '.csv', sizeBytes: 2200, pages: 0, chunks: 2, status: 'indexed', note: '' },
    { path: 'C:\\files\\Old-Report.doc', name: 'Old-Report.doc', ext: '.doc', sizeBytes: 9000, pages: 0, chunks: 0, status: 'skipped', note: 'Legacy .doc — save as .docx' },
  ];
  const REPLY = {
    code: 'Here is a small example.\n\n```javascript\nfunction fib(n) {\n  return n < 2 ? n : fib(n - 1) + fib(n - 2);\n}\nconsole.log(fib(10));\n```\n\n```python\ndef reverse(s):\n    return s[::-1]  # slice\n```\n\n```html\n<h1 style="color:#6c57f5">Hello</h1>\n```\n\nRun the first block to see `55`.',
    md: '## A quick overview\n\nLocalMind runs **on this PC**. It can:\n\n- Chat with *streaming* replies\n- Remember facts about you\n  - and forget them on request\n- Search your files [1]\n\n1. First step\n2. Second step\n\n| Feature | Local? |\n| --- | :---: |\n| Chat | yes |\n| Web search | no |\n\n> It is a small model — double-check important answers.\n\nSee [the docs](https://example.com/docs) for more.',
  };
  function reply(text) { return /code|function|python/i.test(text) ? REPLY.code : /overview|table|list/i.test(text) ? REPLY.md : 'This is a mock reply to: "' + text.slice(0, 60) + '". The real app answers with the on-device Phi Silica model.'; }

  const handlers = {
    ensureReady: () => ({ ok: true, state: 'Ready' }),
    sysInfo: () => ({ ok: true, text: JSON.stringify({ model: 'Ready', ocr: 'Ready', describe: 'Ready', dataFolder: 'C:\\Users\\you\\AppData\\Local\\Packages\\Dyabi.LocalMind\\LocalState', dataBytes: 123456, version: '1.0.0.0' }) }),
    kvGetAll: () => ({ ok: true, text: JSON.stringify(Object.fromEntries(Object.entries(kv).map(([k, v]) => [k, JSON.parse(v)]))) }),
    kvGet: (m) => ({ ok: true, text: kv[m.prompt] || '' }),
    kvPut: (m) => { kv[m.prompt] = m.data; return { ok: true }; },
    kvDelete: (m) => { delete kv[m.prompt]; return { ok: true }; },
    getLibrary: () => ({ ok: true, text: JSON.stringify({ docs, totalChunks: 6 }) }),
    indexPaths: (m) => ({ ok: true, text: JSON.stringify({ added: 1, updated: 0, unchanged: 0, skipped: 0, failed: 0, filesSeen: 1, chunksAdded: 3, seconds: 0.2, messages: [], paths: JSON.parse(m.prompt) }) }),
    pickFiles: () => ({ ok: true, text: JSON.stringify(['C:\\files\\Q3-sales.csv']) }),
    skill: (m) => { const req = JSON.parse(m.data); const full = req.name === 'table' ? '| Item | Price |\n| --- | --- |\n| Apples | 2 |' : 'Mock ' + req.name + ' result for: ' + req.text.slice(0, 40); setTimeout(() => emit({ event: 'chat', rid: req.rid, kind: 'text', text: full }), 50); return { ok: true, text: JSON.stringify({ ok: true, text: full, ms: 400, status: 'Complete' }), delay: 600 }; },
    bg: (m) => { const r = JSON.parse(m.data); if (r.name === 'title') return { ok: true, text: JSON.stringify({ ok: true, text: 'Mock chat title', ms: 100 }) }; if (r.name === 'memory') return { ok: true, text: JSON.stringify({ ok: true, facts: ['User lives in Dublin.'], ms: 100 }) }; return { ok: true, text: JSON.stringify({ ok: true, text: 'Earlier summary.', ms: 100 }) }; },
    cancel: (m) => { window.__cancel = window.__cancel || {}; window.__cancel[m.prompt] = true; return { ok: true }; },
    chat: (m) => {
      const req = JSON.parse(m.data); const full = reply(req.user); const t0 = Date.now();
      window.__lastReq = req;
      let i = 0;
      return new Promise((resolve) => {
        const tick = () => {
          if ((window.__cancel || {})[req.rid]) { resolve({ ok: true, text: JSON.stringify({ ok: true, cancelled: true, text: full.slice(0, i), status: 'Cancelled', promptChars: 500 }) }); return; }
          i = Math.min(full.length, i + 6); emit({ event: 'chat', rid: req.rid, kind: 'text', text: full.slice(0, i) });
          if (i >= full.length) {
            const withSrc = req.scope.length || req.inlineDocs.length;
            resolve({ ok: true, text: JSON.stringify({ ok: true, text: full + (withSrc ? ' [1]' : ''), status: 'Complete', promptChars: 1200 + req.history.length * 300, historyUsed: req.history.length, historyDropped: 0, firstTokenMs: 800, genMs: Date.now() - t0 + 800, retrievalMs: 120,
              sources: withSrc ? [{ n: 1, docName: 'Vendor-Agreement.docx', docPath: docs[0].path, loc: 'lines 1–9', text: 'Either party may terminate this agreement by giving 60 days written notice.', sent: true }] : [], inlineDocs: [] }) });
          } else setTimeout(tick, 40);
        };
        emit({ event: 'chat', rid: req.rid, kind: 'status', text: 'Thinking…' }); setTimeout(tick, 300);
      });
    },
  };
  window.chrome = window.chrome || {};
  window.chrome.webview = {
    addEventListener: (t, f) => { if (t === 'message') listeners.push(f); },
    postMessage: async (m) => { const f = handlers[m.type]; let r = f ? await f(m) : { ok: false, error: 'mock: no ' + m.type }; r = Object.assign({ id: m.id }, r); const d = r.delay || 0; setTimeout(() => emit(r), d); },
    postMessageWithAdditionalObjects: (m) => window.chrome.webview.postMessage(m),
  };
  window.__mockKv = kv;
})();
