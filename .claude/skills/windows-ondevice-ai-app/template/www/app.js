// Playground: one tab per Windows AI component that this app was built with, plus a self-test.
// It exists to (1) prove every component works on THIS PC and (2) show the call pattern for each one.
// Replace this file (and index.html / style.css) with the real UI; keep bridge.js.
(async function () {
  const $ = (s, r = document) => r.querySelector(s);
  function h(tag, props, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid != null) e.append(kid.nodeType ? kid : document.createTextNode(kid));
    return e;
  }
  const show = (out, text, err) => { out.textContent = text; out.classList.toggle('error', !!err); };
  // Run a bridge call, mirror status/delta events into `out`, disable `btn` meanwhile.
  async function run(btn, out, type, args, onDone) {
    btn.disabled = true; show(out, 'Working...');
    const t0 = performance.now();
    try {
      const r = await NativeAI.call(type, args, ev => { if (ev.event === 'delta' || ev.event === 'status') show(out, ev.text); });
      onDone ? onDone(r) : show(out, r.text || JSON.stringify(r, null, 2));
      NativeAI.log(`${type} ok ${Math.round(performance.now() - t0)}ms`);
    } catch (e) { show(out, e.message, true); NativeAI.log(`${type} failed`); }
    btn.disabled = false;
  }
  const field = (label, el) => h('div', {}, h('label', {}, label), el);
  const out = () => h('pre', { class: 'out', 'aria-live': 'polite' });

  // ── test fixtures (generated in the page: no files needed) ───────────────────────────────────────
  function canvasPng(draw, w = 640, hgt = 220) {
    const c = document.createElement('canvas'); c.width = w; c.height = hgt;
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, w, hgt); draw(g);
    return c.toDataURL('image/png');
  }
  const textImage = () => canvasPng(g => { g.fillStyle = '#000'; g.font = 'bold 34px Arial'; g.fillText('INVOICE 4821', 30, 70); g.font = '28px Arial'; g.fillText('Total due: 129.50 EUR', 30, 130); g.fillText('Customer: Contoso Ltd', 30, 180); });
  const sceneImage = () => canvasPng(g => {
    g.fillStyle = '#87ceeb'; g.fillRect(0, 0, 640, 220); g.fillStyle = '#4caf50'; g.fillRect(0, 150, 640, 70);
    g.fillStyle = '#ffd400'; g.beginPath(); g.arc(540, 50, 32, 0, 7); g.fill();
    g.fillStyle = '#c0392b'; g.fillRect(250, 90, 120, 80); g.fillStyle = '#7b241c'; g.beginPath(); g.moveTo(240, 90); g.lineTo(310, 40); g.lineTo(380, 90); g.fill();
  });
  function makePdf(text) {                                  // tiny valid PDF with a real text layer (ASCII only)
    const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>'];
    const stream = `BT /F1 28 Tf 40 100 Td (${text}) Tj ET`;
    objs.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
    let o = '%PDF-1.4\n'; const offs = [];
    objs.forEach((b, i) => { offs.push(o.length); o += `${i + 1} 0 obj\n${b}\nendobj\n`; });
    const x = o.length;
    o += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map(v => String(v).padStart(10, '0') + ' 00000 n \n').join('');
    o += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF`;
    return btoa(o);
  }
  const b64of = dataUrl => dataUrl.split(',')[1];

  // ── panels ───────────────────────────────────────────────────────────────────────────────────────
  const panels = {};
  const info = await NativeAI.call('info');
  const has = op => info.ops.includes(op);
  const mode = $('#mode');
  mode.textContent = NativeAI.isNative ? 'On-device' : 'Browser mock (no Windows AI)';
  mode.classList.add(NativeAI.isNative ? 'ok' : 'bad');

  panels.status = () => {
    const o = out(); const t = h('div');
    const btn = h('button', { class: 'btn' }, 'Check this PC');
    const go = async () => {
      const r = await NativeAI.call('status');
      t.replaceChildren(h('table', {}, h('tr', {}, h('th', {}, 'Feature'), h('th', {}, 'State')),
        r.features.map(f => h('tr', {}, h('td', {}, f.feature), h('td', { class: f.state === 'Ready' ? 'ok' : '' }, f.state)))));
    };
    btn.addEventListener('click', go); go();
    return [h('div', { class: 'card' }, h('h2', {}, 'Windows AI components on this PC'),
      h('p', { class: 'hint' }, 'Ready = usable now. NotReady = Windows downloads the model on first use. NotSupportedOnCurrentSystem = needs a Copilot+ PC.'), t, h('div', { class: 'row' }, btn))];
  };

  if (has('generate')) panels.language = () => {
    const sys = h('textarea', { rows: 2 }, 'You are a concise assistant.');
    const prompt = h('textarea', {}, 'Explain in two sentences why the sky is blue.');
    const temp = h('input', { type: 'number', step: '0.1', min: '0', max: '1', placeholder: 'default (deterministic)' });
    const o = out();
    const go = h('button', { class: 'btn' }, 'Generate');
    const st = h('button', { class: 'btn' }, 'Stream');
    const stop = h('button', { class: 'btn secondary' }, 'Stop');
    const fit = h('button', { class: 'btn secondary' }, 'Does it fit?');
    const args = () => ({ system: sys.value, prompt: prompt.value, temperature: temp.value === '' ? undefined : Number(temp.value) });
    go.addEventListener('click', () => run(go, o, 'generate', args(), r => show(o, `${r.text}\n\n[status ${r.status}, ${r.ms} ms]`)));
    st.addEventListener('click', () => { run(st, o, 'generateStream', args(), r => show(o, `${r.text}\n\n[status ${r.status}, first token ${r.firstTokenMs} ms, ${r.ms} ms]`)); });
    stop.addEventListener('click', () => NativeAI.cancel(NativeAI.lastId()));
    fit.addEventListener('click', () => run(fit, o, 'promptFits', { system: sys.value, prompt: prompt.value }, r => show(o, `fits: ${r.fits} (length ${r.length}, usable ${r.usable})`)));
    return [h('div', { class: 'card' }, h('h2', {}, 'Phi Silica (LanguageModel)'), field('System prompt', sys), field('Prompt', prompt), field('Temperature (empty = deterministic)', temp),
      h('div', { class: 'row' }, go, st, stop, fit), o)];
  };

  if (has('summarize')) panels.textskills = () => {
    const text = h('textarea', { rows: 6 }, 'Windows 11 Copilot+ PCs have a neural processing unit (NPU). Apps can call on-device language, vision and search models through the Windows AI APIs without sending data to the cloud. The first call may download the model, which takes a few minutes. After that, answers are generated locally in a second or two.');
    const tone = h('input', { type: 'text', placeholder: 'formal | casual | general | custom (e.g. friendly and brief)' });
    const o = out();
    const mk = (label, type, args) => { const b = h('button', { class: 'btn' }, label); b.addEventListener('click', () => run(b, o, type, args())); return b; };
    return [h('div', { class: 'card' }, h('h2', {}, 'Text skills (TextSummarizer, TextRewriter, TextToTableConverter)'), field('Text (max ~6000 characters)', text), field('Rewrite tone', tone),
      h('div', { class: 'row' }, mk('Summarize', 'summarize', () => ({ text: text.value })), mk('Summarize (paragraph)', 'summarizeParagraph', () => ({ text: text.value })),
        mk('Rewrite', 'rewrite', () => ({ text: text.value, tone: tone.value })),
        mk('To table', 'table', () => ({ text: 'Name, Role, City\nAda Lovelace, Engineer, London\nGrace Hopper, Admiral, New York' }))), o)];
  };

  const filePanel = (title, hint, accept, actions) => () => {
    const file = h('input', { type: 'file', accept }); const o = out(); const img = h('img', { class: 'result', hidden: true, alt: '' });
    const row = h('div', { class: 'row' });
    for (const [label, type, extra] of actions) {
      const b = h('button', { class: 'btn' }, label);
      b.addEventListener('click', async () => {
        if (!file.files[0]) return show(o, 'Choose a file first.', true);
        const base64 = await NativeAI.fileToBase64(file.files[0]);
        await run(b, o, type, Object.assign({ base64 }, extra && extra()), r => {
          if (r.png) { img.src = 'data:image/png;base64,' + r.png; img.hidden = false; show(o, `${r.width} x ${r.height}`); }
          else show(o, r.text || '(empty)');
        });
      });
      row.append(b);
    }
    return [h('div', { class: 'card' }, h('h2', {}, title), h('p', { class: 'hint' }, hint), file, row, o, img)];
  };
  if (has('ocr')) panels.ocr = filePanel('OCR (TextRecognizer)', 'Image -> OCR. A scanned PDF -> OCR PDF (pages are rendered, then recognised).', 'image/*,.pdf',
    [['OCR image', 'ocr'], ['OCR scanned PDF', 'ocrPdf', () => ({ maxPages: 10 })]]);
  if (has('pdfText')) panels.pdf = filePanel('PDF text layer (PdfPig)', 'Exact text of a PDF that has a text layer. hasText=false means it is a scan: use OCR PDF.', '.pdf', [['Extract text', 'pdfText']]);
  if (has('describeImage')) panels.vision = () => {
    const kind = h('select', {}, ['detailed', 'brief', 'diagram', 'accessible'].map(k => h('option', { value: k }, k)));
    const p = filePanel('Image description (ImageDescriptionGenerator)', 'Captions a photo. Use it for descriptions, never for counting.', 'image/*', [['Describe', 'describeImage', () => ({ kind: kind.value })]])();
    p[0].insertBefore(field('Kind', kind), p[0].querySelector('.row'));
    return p;
  };
  if (has('imageGenerate')) panels.images = () => {
    const prompt = h('input', { type: 'text', value: 'a small red house on a green hill, simple illustration' });
    const o = out(); const img = h('img', { class: 'result', hidden: true, alt: 'generated' });
    const go = h('button', { class: 'btn' }, 'Generate picture');
    go.addEventListener('click', () => run(go, o, 'imageGenerate', { prompt: prompt.value }, r => { img.src = 'data:image/png;base64,' + r.png; img.hidden = false; show(o, `${r.width} x ${r.height}`); }));
    const p = filePanel('Upscale / cut-out', 'Pick a picture. The first use of each model downloads it through Windows Update (can take many minutes).', 'image/*',
      [['Upscale 2x', 'imageUpscale'], ['Remove background', 'imageCutout'], ['Restyle with prompt', 'imageRestyle', () => ({ prompt: prompt.value })]])();
    return [h('div', { class: 'card' }, h('h2', {}, 'Image generation (ImageGenerator)'), field('Prompt', prompt), h('div', { class: 'row' }, go), o, img), ...p];
  };
  if (has('indexAdd')) panels.index = () => {
    const docs = h('textarea', { rows: 5 }, 'warranty: The product has a two year limited warranty.\nbattery: The battery lasts about 18 hours of video playback.\nsupport: Contact support through the app or by phone on weekdays.');
    const q = h('input', { type: 'text', value: 'how long is the warranty' });
    const o = out();
    const add = h('button', { class: 'btn secondary' }, 'Index lines (id: text)');
    const ask = h('button', { class: 'btn' }, 'Search');
    const clr = h('button', { class: 'btn secondary' }, 'Clear index');
    add.addEventListener('click', () => run(add, o, 'indexAddMany', { items: docs.value.split('\n').filter(Boolean).map(l => { const i = l.indexOf(':'); return { contentId: l.slice(0, i).trim(), text: l.slice(i + 1).trim() }; }) }));
    ask.addEventListener('click', () => run(ask, o, 'indexQuery', { query: q.value, top: 5 }, r => show(o, r.matches.length ? r.matches.map(m => `${m.confirmed ? '[confirmed]' : '[fuzzy]   '} ${m.contentId}: ${m.text}`).join('\n') : 'No match')));
    clr.addEventListener('click', () => run(clr, o, 'indexClear', {}, () => show(o, 'Index cleared')));
    return [h('div', { class: 'card' }, h('h2', {}, 'Local search (AppContentIndexer)'), h('p', { class: 'hint' }, 'Indexing is asynchronous and matching is fuzzy: the module retries an empty answer once and flags "confirmed" hits.'),
      field('Passages (one per line, "id: text")', docs), field('Query', q), h('div', { class: 'row' }, add, ask, clr), o)];
  };

  // ── self-test ────────────────────────────────────────────────────────────────────────────────────
  async function selfTest(options) {
    const withImages = /images/i.test(options || '') || /[?&]images=1/.test(location.search);
    const results = [];
    const T = async (name, fn) => {
      const t0 = performance.now();
      try { const detail = await fn(); results.push({ name, status: 'pass', detail: String(detail ?? '').slice(0, 160), ms: Math.round(performance.now() - t0) }); }
      catch (e) { results.push({ name, status: e.skip ? 'skip' : 'FAIL', detail: String(e.message).slice(0, 220), ms: Math.round(performance.now() - t0) }); }
      onProgress && onProgress(results);
    };
    const skip = (m) => { const e = new Error(m); e.skip = true; throw e; };
    let onProgress = selfTest.onProgress;
    await T('info', async () => `${info.modules.join(', ')}`);
    await T('status', async () => { const r = await NativeAI.call('status'); return r.features.map(f => `${f.feature}=${f.state}`).join('; '); });
    if (has('generate')) {
      // checks that the pipeline works (non-empty text, a status), not the quality of a small model's answer
      await T('language: generate', async () => { const r = await NativeAI.call('generate', { prompt: 'Name one colour.' }); if (!r.text.trim()) throw new Error('empty answer'); return `${r.text.trim().slice(0, 60)} (${r.ms} ms, ${r.status})`; });
      await T('language: stream', async () => { let n = 0; const r = await NativeAI.call('generateStream', { prompt: 'Count from one to five in words.' }, ev => { if (ev.event === 'delta') n++; }); if (!r.text) throw new Error('empty'); return `${n} delta events, first token ${r.firstTokenMs} ms`; });
      await T('language: promptFits', async () => { const r = await NativeAI.call('promptFits', { prompt: 'short' }); if (!r.fits) throw new Error('short prompt reported as not fitting'); return `usable ${r.usable}`; });
    }
    if (has('summarize')) {
      const txt = 'The city council met on Tuesday to discuss the new bicycle lanes. Several residents spoke in favour, citing safety. Two members worried about parking. The vote was postponed to next month.';
      await T('textskills: summarize', async () => (await NativeAI.call('summarize', { text: txt })).text);
      await T('textskills: rewrite', async () => (await NativeAI.call('rewrite', { text: 'hey, the meeting is moved to 3pm, ok?', tone: 'formal' })).text);
      await T('textskills: table', async () => { const r = await NativeAI.call('table', { text: 'Name, City\nAda, London\nGrace, New York' }); if (!r.rows.length) throw new Error('no rows'); return `${r.rows.length} rows`; });
    }
    if (has('ocr')) await T('ocr: image', async () => { const r = await NativeAI.call('ocr', { base64: b64of(textImage()) }); if (!/4821/.test(r.text)) throw new Error('did not read 4821: ' + r.text); return r.text.replace(/\n/g, ' | '); });
    const pdf = makePdf('Order 4821 total 129.50');
    if (has('pdfText')) await T('pdf: text layer', async () => { const r = await NativeAI.call('pdfText', { base64: pdf }); if (!/4821/.test(r.text)) throw new Error('did not read 4821: ' + r.text); return r.text.trim(); });
    if (has('ocrPdf')) await T('ocr: pdf pages', async () => { const r = await NativeAI.call('ocrPdf', { base64: pdf, maxPages: 1 }); if (!/4821/.test(r.text)) throw new Error('did not read 4821: ' + r.text); return r.text.replace(/\n/g, ' | '); });
    if (has('describeImage')) await T('vision: describe', async () => { const r = await NativeAI.call('describeImage', { base64: b64of(sceneImage()) }); return r.text; });
    if (has('indexAdd')) await T('index: add + query', async () => {
      await NativeAI.call('indexClear');
      await NativeAI.call('indexAddMany', { items: [{ contentId: 't1', text: 'The warranty period is two years.' }, { contentId: 't2', text: 'The battery lasts eighteen hours.' }] });
      const r = await NativeAI.call('indexQuery', { query: 'warranty period', top: 3 });
      const hit = r.matches.find(m => m.contentId === 't1');
      await NativeAI.call('indexClear');
      if (!hit) throw new Error('no hit for t1 (' + r.matches.length + ' matches)');
      return `hit t1, confirmed=${hit.confirmed}`;
    });
    if (has('imageGenerate')) {
      if (!withImages) await T('images: generate / upscale / cutout', async () => skip('skipped: the image models can take many minutes to download. Run with autotest.flag containing "images".'));
      else {
        await T('images: upscale', async () => { const r = await NativeAI.call('imageUpscale', { base64: b64of(sceneImage()) }); return `${r.width}x${r.height}`; });
        await T('images: cutout', async () => { const r = await NativeAI.call('imageCutout', { base64: b64of(sceneImage()) }); return `${r.width}x${r.height}`; });
        await T('images: generate', async () => { const r = await NativeAI.call('imageGenerate', { prompt: 'a small red house on a green hill' }); return `${r.width}x${r.height}`; });
      }
    }
    return results;
  }

  panels.selftest = () => {
    const t = h('div'); const o = out();
    const render = rs => t.replaceChildren(h('table', {}, h('tr', {}, h('th', {}, 'Check'), h('th', {}, 'Result'), h('th', {}, 'ms'), h('th', {}, 'Detail')),
      rs.map(r => h('tr', {}, h('td', {}, r.name), h('td', { class: r.status === 'pass' ? 'ok' : r.status === 'skip' ? 'skip' : 'bad' }, r.status), h('td', {}, r.ms), h('td', {}, r.detail)))));
    const go = h('button', { class: 'btn' }, 'Run all checks');
    const withImg = h('input', { type: 'checkbox', id: 'wi' });
    go.addEventListener('click', async () => {
      go.disabled = true; show(o, 'Running... the first run downloads models and can take a few minutes.');
      selfTest.onProgress = render;
      const rs = await selfTest(withImg.checked ? 'images' : ''); render(rs);
      const failed = rs.filter(r => r.status === 'FAIL').length;
      show(o, failed ? `${failed} check(s) failed` : 'All checks passed', !!failed); go.disabled = false;
    });
    return [h('div', { class: 'card' }, h('h2', {}, 'Self-test'), h('p', { class: 'hint' }, 'Runs every component with generated test data (an invoice picture, a small PDF, a scene). Headless: create autotest.flag in the app\'s LocalState folder and start the app; the report is written to selftest-report.json.'),
      h('div', { class: 'row' }, go, h('label', {}, withImg, ' include image models (slow first run)')), t, o)];
  };

  // ── tabs ─────────────────────────────────────────────────────────────────────────────────────────
  const names = { status: 'This PC', language: 'Language', textskills: 'Text skills', ocr: 'OCR', pdf: 'PDF', vision: 'Vision', images: 'Images', index: 'Search', selftest: 'Self-test' };
  const tabs = $('#tabs'), host = $('#panels');
  const keys = Object.keys(panels);
  keys.forEach((k, i) => {
    const sec = h('section', { class: 'panel', id: 'p-' + k, role: 'tabpanel' }, panels[k]());
    const btn = h('button', { role: 'tab', 'aria-selected': 'false', 'aria-controls': 'p-' + k }, names[k] || k);
    btn.addEventListener('click', () => {
      tabs.querySelectorAll('button').forEach(b => b.setAttribute('aria-selected', 'false'));
      host.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
      btn.setAttribute('aria-selected', 'true'); sec.classList.add('active');
    });
    tabs.append(btn); host.append(sec);
    if (i === 0) btn.click();
  });

  // Headless self-test, triggered by the host when <LocalState>\autotest.flag exists.
  NativeAI.on('autotest', async (ev) => {
    NativeAI.log('autotest started');
    const rs = await selfTest(ev.options);
    const report = { app: info.app, at: new Date().toISOString(), summary: { pass: rs.filter(r => r.status === 'pass').length, skip: rs.filter(r => r.status === 'skip').length, fail: rs.filter(r => r.status === 'FAIL').length }, results: rs };
    await NativeAI.call('writeReport', { text: JSON.stringify(report, null, 2) });
    NativeAI.log('autotest finished fail=' + report.summary.fail);
  });
})();
