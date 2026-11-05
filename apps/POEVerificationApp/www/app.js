'use strict';

// ═══════════════════════════════════════════════════
//  NATIVE AI BRIDGE
// ═══════════════════════════════════════════════════
const NativeAI = (() => {
  const native = !!(window.chrome && window.chrome.webview);
  const pending = new Map();
  let counter = 0;
  if (native) {
    window.chrome.webview.addEventListener('message', (e) => {
      const msg = e.data;
      if (!msg || !msg.id || !pending.has(msg.id)) return;
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.ok) resolve(msg); else reject(new Error(msg.error || 'Native AI error'));
    });
  }
  function call(type, extra) {
    if (!native) return Promise.reject(new Error('Native AI bridge not available — this app must run inside the installed desktop shell.'));
    const id = 't' + (++counter) + '_' + Date.now();
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      window.chrome.webview.postMessage(Object.assign({ id, type }, extra));
    });
  }
  return {
    isNative: native,
    ensureReady: () => call('ensureReady'),
    generate: (prompt) => call('generate', { prompt }),
    pdfText: (base64) => call('pdfText', { base64 }),
    ocr: (base64) => call('ocr', { base64 }),
    describeImage: (base64) => call('describeImage', { base64 }),
    indexPoe: (contentId, text) => call('indexPoe', { contentId, prompt: text }),
    queryPoe: (query) => call('queryPoe', { prompt: query }),
  };
})();

const $ = id => document.getElementById(id);
const fmtMoney = n => '€' + Math.round(n).toLocaleString('en-US');

// ═══════════════════════════════════════════════════
//  STATE
// ═══════════════════════════════════════════════════
let cases = [];
let currentCaseId = null;
let currentSupplierId = null;
let copilotHistory = [];
let copilotBusy = false;
let reuseCache = {}; // caseId -> array of matched case ids (excluding self)

// ═══════════════════════════════════════════════════
//  VIEW SWITCHING
// ═══════════════════════════════════════════════════
function showView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  $('view-' + name).classList.add('active');
  const navItem = document.querySelector('.nav-item[data-view="' + name + '"]');
  if (navItem) navItem.classList.add('active');
  if (name === 'cases') renderCasesTable();
  if (name === 'suppliers') renderSuppliers();
}

document.querySelectorAll('.nav-item[data-view]').forEach(el => {
  el.addEventListener('click', () => showView(el.dataset.view));
});
document.querySelectorAll('[data-back]').forEach(el => {
  el.addEventListener('click', () => showView(el.dataset.back));
});

function toast(msg) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  $('toastWrap').appendChild(el);
  setTimeout(() => el.remove(), 3800);
}

// ═══════════════════════════════════════════════════
//  VERIFICATION ENGINE — deterministic. AI never computes these numbers.
// ═══════════════════════════════════════════════════
function buildMatrix(c) {
  const rows = [];
  rows.push({ field: 'Quantity', po: c.po.quantity, invoice: c.invoice.quantity, poe: c.poe.quantity, ok: c.po.quantity === c.invoice.quantity && c.invoice.quantity === c.poe.quantity });
  rows.push({ field: 'Amount', po: fmtMoney(c.po.amount), invoice: fmtMoney(c.invoice.amount), poe: '—', ok: c.po.amount === c.invoice.amount });
  rows.push({ field: 'Date', po: c.po.date, invoice: c.invoice.date, poe: c.poe.date, ok: c.po.date === c.poe.date });
  rows.push({ field: 'Location', po: c.po.location, invoice: c.invoice.location, poe: c.poe.location, ok: c.po.location === c.invoice.location && c.invoice.location === c.poe.location });
  rows.push({ field: 'Product', po: c.po.product, invoice: c.invoice.product, poe: c.poe.product, ok: c.po.product === c.invoice.product && c.invoice.product === c.poe.product });
  rows.push({ field: 'Reference', po: c.po.number, invoice: c.invoice.reference, poe: c.poe.reference, ok: c.po.number === c.invoice.reference && c.invoice.reference === c.poe.reference });
  return rows;
}

function computeExposure(c) {
  return Math.max(0, c.invoice.amount - c.po.amount);
}

function computeRiskIndicators(c) {
  const risks = [];
  if (c.invoice.quantity !== c.po.quantity) {
    risks.push({ level: 'high', title: 'Quantity mismatch',
      desc: `PO authorizes ${c.po.quantity} units. Invoice bills ${c.invoice.quantity}. POE confirms ${c.poe.quantity} executed.` });
  }
  if (c.invoice.amount !== c.po.amount) {
    risks.push({ level: 'high', title: 'Amount mismatch',
      desc: `PO value is ${fmtMoney(c.po.amount)}. Invoice requests ${fmtMoney(c.invoice.amount)} — a difference of ${fmtMoney(Math.abs(c.invoice.amount - c.po.amount))}.` });
  }
  if (c.poe.quantity < c.po.quantity && c.invoice.quantity === c.po.quantity) {
    risks.push({ level: 'high', title: 'Execution shortfall',
      desc: `Invoice matches the PO quantity (${c.invoice.quantity}), but the POE only confirms ${c.poe.quantity} units executed — ${c.po.quantity - c.poe.quantity} units billed without matching evidence.` });
  }
  if (c.po.date && c.poe.date && new Date(c.poe.date) < new Date(c.po.date)) {
    risks.push({ level: 'med', title: 'Date inconsistency',
      desc: `The POE execution date (${c.poe.date}) is before the purchase order date (${c.po.date}) — execution evidence predates its own authorization.` });
  }
  if (c.po.location !== c.poe.location) {
    risks.push({ level: 'med', title: 'Location mismatch',
      desc: `PO specifies ${c.po.location}, but the POE was recorded at ${c.poe.location}.` });
  }
  return risks;
}

function caseHasMismatch(c) {
  return buildMatrix(c).some(r => !r.ok);
}

function statusBadge(status) {
  const map = { review: ['Review Required', 'risk-review'], approved: ['Approved', 'risk-approved'], pending: ['Pending', 'risk-pending'] };
  const [label, cls] = map[status] || [status, 'risk-pending'];
  return `<span class="risk-badge ${cls}">${label}</span>`;
}

// ═══════════════════════════════════════════════════
//  DASHBOARD
// ═══════════════════════════════════════════════════
function renderDashboard() {
  const reviewCases = cases.filter(c => c.status === 'review');
  const exposure = reviewCases.reduce((sum, c) => sum + computeExposure(c), 0);
  const reused = Object.keys(reuseCache).filter(id => reuseCache[id].length > 0).length;

  $('dashStats').innerHTML = `
    <div class="stat-card"><div class="stat-v">${cases.length}</div><div class="stat-l">Cases analyzed</div></div>
    <div class="stat-card alert"><div class="stat-v">${reviewCases.length}</div><div class="stat-l">Review required</div></div>
    <div class="stat-card alert"><div class="stat-v">${fmtMoney(exposure)}</div><div class="stat-l">Potential exposure</div></div>
    <div class="stat-card warn"><div class="stat-v">${reused}</div><div class="stat-l">Reused evidence flags</div></div>
  `;

  if (!reviewCases.length) {
    $('dashReviewTable').innerHTML = '<tr><td colspan="5" class="empty-note">No cases yet — go to "New Case" to verify your first submission.</td></tr>';
    return;
  }
  $('dashReviewTable').innerHTML = reviewCases.map(c => {
    const risks = computeRiskIndicators(c);
    return `<tr class="clickable" data-open="${c.id}">
      <td style="font-family:var(--mono)">${c.id}</td>
      <td>${c.supplierName}</td>
      <td>${fmtMoney(c.invoice.amount)}</td>
      <td>${risks.length} indicator${risks.length === 1 ? '' : 's'}</td>
      <td>${statusBadge(c.status)}</td>
    </tr>`;
  }).join('');
  $('dashReviewTable').querySelectorAll('[data-open]').forEach(el => el.addEventListener('click', () => openCase(el.dataset.open)));
}

// ═══════════════════════════════════════════════════
//  CASES LIST
// ═══════════════════════════════════════════════════
function renderCasesTable() {
  $('casesSub').textContent = cases.length ? `${cases.length} POE verification cases across ${new Set(cases.map(c => c.supplierId)).size} suppliers.` : 'All POE verification cases.';
  if (!cases.length) {
    $('casesTable').innerHTML = '<tr><td colspan="7" class="empty-note">No cases yet — go to "New Case" to verify your first submission.</td></tr>';
    return;
  }
  $('casesTable').innerHTML = cases.map(c => `
    <tr class="clickable" data-open="${c.id}">
      <td style="font-family:var(--mono)">${c.id}</td>
      <td>${c.supplierName}</td>
      <td class="${c.po.quantity !== c.invoice.quantity ? 'matrix-cell-bad' : ''}">${c.po.quantity}</td>
      <td class="${c.po.quantity !== c.invoice.quantity ? 'matrix-cell-bad' : ''}">${c.invoice.quantity}</td>
      <td>${c.poe.quantity}</td>
      <td>${fmtMoney(c.invoice.amount)}</td>
      <td>${statusBadge(c.status)}</td>
    </tr>
  `).join('');
  $('casesTable').querySelectorAll('[data-open]').forEach(el => el.addEventListener('click', () => openCase(el.dataset.open)));
}

// ═══════════════════════════════════════════════════
//  CASE DETAIL
// ═══════════════════════════════════════════════════
function openCase(id) {
  currentCaseId = id;
  showView('casedetail');
  renderCaseDetail();
  resetCopilotForCase(id);
}

function renderCaseDetail() {
  const c = cases.find(x => x.id === currentCaseId);
  if (!c) return;
  const matrix = buildMatrix(c);
  const exposure = computeExposure(c);
  const risks = computeRiskIndicators(c);
  const reuseMatches = reuseCache[c.id] || null;

  const matrixRows = matrix.map(r => `
    <tr>
      <td>${r.field}</td>
      <td>${r.po}</td>
      <td class="${r.ok ? '' : 'matrix-cell-bad'}">${r.invoice}</td>
      <td>${r.poe}</td>
      <td><span class="matrix-badge ${r.ok ? 'good' : 'bad'}"></span></td>
    </tr>`).join('');

  const risksHtml = risks.length
    ? risks.map(r => `<div class="risk-item"><div class="risk-icon ${r.level === 'high' ? 'high' : 'med'}">${r.level === 'high' ? '🔴' : '🟠'}</div><div class="risk-body"><div class="risk-title">${r.title}</div><div class="risk-desc">${r.desc}</div></div></div>`).join('')
    : '<div class="empty-note">No document-level inconsistencies detected.</div>';

  const docsHtml = c.docSource === 'upload' ? `
    <div class="card">
      <div class="card-title">📄 Documents (live on-device extraction)</div>
      ${docRow(c.uploadedDocs.po.name, 'Purchase Order', 'po')}
      ${docRow(c.uploadedDocs.invoice.name, 'Invoice', 'invoice')}
      ${docRow(c.uploadedDocs.poe.name, 'Proof of Execution', 'poe')}
    </div>` : '';

  const photosHtml = c.photos ? `
    <div class="card">
      <div class="card-title">🖼 POE Photos</div>
      <div class="photo-grid">
        ${c.photos.map(p => `<div class="photo-thumb"><img src="${photoSrc(c, p)}" alt="${p.label}"><div class="caption">${p.label}</div></div>`).join('')}
      </div>
      <button class="btn primary" id="analyzePhotosBtn">🔎 Analyze photos with on-device AI</button>
      <div class="doc-extract-out" id="photoAnalysisOut"></div>
    </div>` : '';

  const reuseHtml = `
    <div class="card">
      <div class="card-title">🚨 Evidence Reuse Detection</div>
      <p style="font-size:11.5px;color:var(--text2);">Search the on-device semantic index for other invoices backed by the same or highly similar execution evidence.</p>
      <button class="btn primary" id="searchReuseBtn" style="margin-top:8px;">🔍 Search for reused evidence</button>
      <div id="reuseResultBox"></div>
    </div>`;

  const timelineHtml = `
    <div class="card">
      <div class="card-title">🕐 Timeline</div>
      <div class="timeline">
        ${c.timeline.map(t => `<div class="tl-item ${t.type === 'poe' || t.type === 'exec' ? '' : ''}"><div class="tl-dot"></div><div class="tl-date">${t.date}</div><div class="tl-label">${t.label}</div></div>`).join('')}
      </div>
    </div>`;

  $('caseDetailBody').innerHTML = `
    <div class="case-header">
      <div>
        <div class="case-id">${c.id}</div>
        <div style="font-size:12px;color:var(--text2)">${c.supplierName} — ${c.po.service}</div>
      </div>
      <div class="case-actions">${statusBadge(c.status)}</div>
    </div>

    <div class="exposure-box">
      <div class="exposure-num ${exposure > 0 ? 'alert' : 'clean'}">${fmtMoney(exposure)}</div>
      <div class="exposure-meta">
        <div class="exposure-label">Potential financial exposure</div>
        <div class="exposure-sub">${exposure > 0 ? 'Difference between invoiced amount and authorized purchase order value.' : 'Invoice matches the authorized purchase order value.'}</div>
      </div>
    </div>

    <div class="sh">Verification Matrix</div>
    <table class="data-table" style="margin-bottom:18px;">
      <thead><tr><th>Field</th><th>PO</th><th>Invoice</th><th>POE</th><th>Result</th></tr></thead>
      <tbody>${matrixRows}</tbody>
    </table>

    <div class="sh">Risk Indicators</div>
    <div class="card">${risksHtml}</div>

    ${docsHtml}
    ${photosHtml}
    ${reuseHtml}
    ${timelineHtml}
  `;

  if (c.docSource === 'upload') {
    ['po', 'invoice', 'poe'].forEach(k => {
      const btn = document.querySelector(`[data-extract="${k}"]`);
      if (btn) btn.addEventListener('click', () => extractDoc(c, k, btn));
    });
  }
  if (c.photos) {
    $('analyzePhotosBtn').addEventListener('click', () => analyzePhotos(c));
  }
  $('searchReuseBtn').addEventListener('click', () => searchReuse(c));
  if (reuseMatches) renderReuseResult(c, reuseMatches);
}

function docRow(filename, label, key) {
  return `<div class="doc-row">
    <div class="doc-icon">📄</div>
    <div style="flex:1;">
      <div class="doc-name">${label}</div>
      <div class="doc-meta">${filename}</div>
      <div class="doc-extract-out" id="extractOut-${key}"></div>
    </div>
    <button class="btn" data-extract="${key}" id="extractBtn-${key}">Extract with on-device AI</button>
  </div>`;
}

function fileToBase64(fileOrBlob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(fileOrBlob);
  });
}

function docBase64(c, key) {
  return fileToBase64(c.uploadedDocs[key]);
}

function photoSrc(c, p) {
  return URL.createObjectURL(p.file);
}

function photoBase64(c, p) {
  return fileToBase64(p.file);
}

async function extractDoc(c, key, btn) {
  const out = $('extractOut-' + key);
  btn.disabled = true;
  btn.textContent = 'Extracting…';
  try {
    const base64 = await docBase64(c, key);
    const resp = await NativeAI.pdfText(base64);
    out.textContent = resp.text.trim();
    out.classList.add('visible');
    btn.textContent = 'Re-extract';
  } catch (e) {
    out.textContent = 'Extraction failed: ' + e.message;
    out.classList.add('visible');
    btn.textContent = 'Retry';
  }
  btn.disabled = false;
}

async function analyzePhotos(c) {
  const btn = $('analyzePhotosBtn');
  const out = $('photoAnalysisOut');
  btn.disabled = true;
  btn.innerHTML = '<span class="loading-inline"><span class="spinner"></span> Analyzing photos on-device…</span>';
  out.classList.add('visible');
  out.textContent = 'Running on-device image description…';
  try {
    const descriptions = [];
    for (const p of c.photos) {
      const base64 = await photoBase64(c, p);
      const resp = await NativeAI.describeImage(base64);
      descriptions.push(`${p.label}: ${resp.text.trim()}`);
    }
    const prompt = `You are analyzing photos submitted as proof of execution for a delivery/deployment claim. ` +
      `The proof of execution document claims ${c.poe.quantity} units of "${c.poe.product}" were delivered/installed. ` +
      `Below are on-device descriptions of ${c.photos.length} photos submitted as evidence:\n\n${descriptions.join('\n')}\n\n` +
      `Estimate the total number of visible units across all photos combined, compare it to the claimed quantity of ${c.poe.quantity}, ` +
      `and state clearly whether this is consistent or whether there is a potential quantity discrepancy. Be concise (3-4 sentences). ` +
      `This is a visual estimate, not an exact count — say so.`;
    const resp = await NativeAI.generate(prompt);
    out.textContent = resp.text.trim();
    btn.innerHTML = '✓ Photos analyzed';
  } catch (e) {
    out.textContent = 'Photo analysis failed: ' + e.message;
    btn.innerHTML = 'Retry analysis';
    btn.disabled = false;
  }
}

// ═══════════════════════════════════════════════════
//  VERIFY NEW SUBMISSION — upload arbitrary PO/Invoice/POE + photos,
//  extract structured fields with on-device AI, and run them through the
//  same deterministic verification engine as every other case.
// ═══════════════════════════════════════════════════
const newCaseFiles = { po: null, invoice: null, poe: null, photos: [] };

function extractJsonLoose(text) {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  return JSON.parse(cleaned);
}

function coerceNumber(v) {
  if (typeof v === 'number') return v;
  const n = parseFloat(String(v ?? '').replace(/[^0-9.\-]/g, ''));
  return isNaN(n) ? 0 : n;
}

const EXTRACTION_SHAPES = {
  po: '{"number": "string", "quantity": number, "amount": number, "location": "string", "date": "YYYY-MM-DD", "product": "string", "service": "string"}',
  invoice: '{"number": "string", "quantity": number, "amount": number, "location": "string", "date": "YYYY-MM-DD", "product": "string", "reference": "string (the PO number this invoice references)"}',
  poe: '{"quantity": number, "location": "string", "date": "YYYY-MM-DD", "product": "string", "reference": "string (the PO number this execution references)"}',
};
const EXTRACTION_REQUIRED = {
  po: ['number', 'quantity', 'amount', 'location', 'date', 'product'],
  invoice: ['number', 'quantity', 'amount', 'location', 'date', 'product'],
  poe: ['quantity', 'location', 'date', 'product'],
};

function buildExtractionPrompt(docType, rawText) {
  return `You are a document-intelligence extractor for a procurement verification system. Read the raw text extracted ` +
    `from a ${docType.toUpperCase()} document below and return ONLY one valid JSON object with exactly this shape ` +
    `(best-effort reading of the actual text; use 0 for a genuinely missing number and "" for a genuinely missing string — ` +
    `never invent data not implied by the text):\n${EXTRACTION_SHAPES[docType]}\n\nRAW DOCUMENT TEXT:\n${rawText}\n\nJSON:`;
}

function validateExtractedFields(docType, data) {
  if (typeof data !== 'object' || data === null) throw new Error('AI response was not an object.');
  for (const f of EXTRACTION_REQUIRED[docType]) {
    if (!(f in data)) throw new Error(`Extraction missing required field "${f}" for ${docType.toUpperCase()}.`);
  }
  data.quantity = coerceNumber(data.quantity);
  if ('amount' in data) data.amount = coerceNumber(data.amount);
  return data;
}

async function extractDocumentFields(docType, file) {
  const base64 = await fileToBase64(file);
  const pdfResp = await NativeAI.pdfText(base64);
  const rawText = (pdfResp.text || '').trim();
  if (!rawText) throw new Error(`${docType.toUpperCase()} contains no extractable text.`);
  const genResp = await NativeAI.generate(buildExtractionPrompt(docType, rawText));
  return validateExtractedFields(docType, extractJsonLoose(genResp.text));
}

function buildTimelineFromDates(poDate, poeDate, invDate) {
  return [
    { date: poDate, label: 'PO created', type: 'po' },
    { date: poeDate, label: 'Execution on site', type: 'exec' },
    { date: poeDate, label: 'POE created', type: 'poe' },
    { date: invDate, label: 'Invoice submitted', type: 'invoice' },
  ].sort((a, b) => new Date(a.date) - new Date(b.date));
}

function slugify(s) {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'unknown-supplier';
}

function newCaseZoneLabelId(doc) {
  return 'newDrop' + doc.charAt(0).toUpperCase() + doc.slice(1) + 'Label';
}

function updateExtractButtonState() {
  const supplierOk = $('newCaseSupplier').value.trim().length > 0;
  $('extractNewCaseBtn').disabled = !(newCaseFiles.po && newCaseFiles.invoice && newCaseFiles.poe && supplierOk);
}

function handleNewCaseFile(doc, files) {
  if (!files || !files.length) return;
  if (doc === 'photos') {
    newCaseFiles.photos = Array.from(files);
    $(newCaseZoneLabelId('photos')).textContent = '✓ ' + newCaseFiles.photos.length + ' photo(s) attached';
  } else {
    newCaseFiles[doc] = files[0];
    $(newCaseZoneLabelId(doc)).textContent = '✓ ' + files[0].name;
  }
  updateExtractButtonState();
}

document.querySelectorAll('#view-newcase .upload-zone').forEach(zone => {
  const doc = zone.dataset.doc;
  const input = zone.querySelector('input[type=file]');
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag'));
  zone.addEventListener('drop', e => { e.preventDefault(); zone.classList.remove('drag'); handleNewCaseFile(doc, e.dataTransfer.files); });
  input.addEventListener('change', e => handleNewCaseFile(doc, e.target.files));
});
$('newCaseSupplier').addEventListener('input', updateExtractButtonState);

$('extractNewCaseBtn').addEventListener('click', extractNewCase);

async function extractNewCase() {
  const btn = $('extractNewCaseBtn');
  const status = $('newCaseStatus');
  btn.disabled = true;
  const supplierName = $('newCaseSupplier').value.trim();
  const supplierId = slugify(supplierName);

  try {
    status.innerHTML = '<span class="loading-inline"><span class="spinner"></span> Extracting Purchase Order…</span>';
    const poFields = await extractDocumentFields('po', newCaseFiles.po);
    status.innerHTML = '<span class="loading-inline"><span class="spinner"></span> Extracting Invoice…</span>';
    const invFields = await extractDocumentFields('invoice', newCaseFiles.invoice);
    status.innerHTML = '<span class="loading-inline"><span class="spinner"></span> Extracting Proof of Execution…</span>';
    const poeFields = await extractDocumentFields('poe', newCaseFiles.poe);

    const fingerprint = `Execution confirmed: ${poeFields.quantity} ${poeFields.product || invFields.product} units delivered at ${poeFields.location} on ${poeFields.date}.`;
    const id = 'POE-2026-' + (90000 + Math.floor(Math.random() * 9999));

    const newCase = {
      id, supplierId, supplierName,
      po: { number: poFields.number, quantity: poFields.quantity, amount: poFields.amount, location: poFields.location, date: poFields.date, product: poFields.product, service: poFields.service || '' },
      invoice: { number: invFields.number, quantity: invFields.quantity, amount: invFields.amount, location: invFields.location, date: invFields.date, product: invFields.product, reference: invFields.reference || poFields.number },
      poe: { quantity: poeFields.quantity, location: poeFields.location, date: poeFields.date, product: poeFields.product, reference: poeFields.reference || poFields.number, fingerprint },
      photos: newCaseFiles.photos.length ? newCaseFiles.photos.map(f => ({ file: f, label: f.name })) : null,
      docSource: 'upload',
      uploadedDocs: { po: newCaseFiles.po, invoice: newCaseFiles.invoice, poe: newCaseFiles.poe },
      timeline: buildTimelineFromDates(poFields.date, poeFields.date, invFields.date),
      status: 'pending',
    };
    newCase.status = caseHasMismatch(newCase) ? 'review' : 'approved';

    cases.unshift(newCase);
    if (NativeAI.isNative) NativeAI.indexPoe(newCase.id, fingerprint).catch(() => {});

    status.innerHTML = '<span style="color:var(--green)">✓ Extraction complete — opening case…</span>';
    renderDashboard();
    renderCasesTable();
    openCase(id);

    newCaseFiles.po = newCaseFiles.invoice = newCaseFiles.poe = null;
    newCaseFiles.photos = [];
    ['po', 'invoice', 'poe', 'photos'].forEach(d => {
      const label = $(newCaseZoneLabelId(d));
      label.textContent = label.dataset.defaultLabel;
    });
    $('newCaseSupplier').value = '';
    status.textContent = '';
  } catch (e) {
    status.innerHTML = `<span style="color:var(--red)">✗ Extraction failed: ${e.message}</span>`;
  }
  updateExtractButtonState();
}

async function searchReuse(c) {
  const btn = $('searchReuseBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="loading-inline"><span class="spinner"></span> Searching on-device index…</span>';
  try {
    let resp = await NativeAI.queryPoe(c.poe.fingerprint);
    // The on-device index commits new content in the background; if this case was indexed only
    // moments ago the index may not be queryable yet. One short retry covers that window.
    if (JSON.parse(resp.text || '[]').length === 0) {
      await new Promise(r => setTimeout(r, 3000));
      resp = await NativeAI.queryPoe(c.poe.fingerprint);
    }
    const matches = JSON.parse(resp.text || '[]');
    // The on-device semantic index returns candidate matches by keyword/text similarity — it can
    // surface partial/false-positive hits (e.g. shared words like "Execution confirmed... Casablanca").
    // Never trust that blindly: confirm each candidate actually shares the same execution-evidence
    // fingerprint text before calling it reused evidence, matching this app's "AI proposes, code
    // decides" verification principle.
    const candidateIds = [...new Set(matches.map(m => m.contentId))].filter(id => id !== c.id);
    const matchedIds = candidateIds.filter(id => {
      const other = cases.find(x => x.id === id);
      return other && other.poe.fingerprint === c.poe.fingerprint;
    });
    reuseCache[c.id] = matchedIds;
    renderReuseResult(c, matchedIds);
    btn.textContent = 'Search again';
    btn.disabled = false;
    renderDashboard();
  } catch (e) {
    $('reuseResultBox').innerHTML = `<p style="color:var(--red);font-size:12px;margin-top:8px;">Search failed: ${e.message}</p>`;
    btn.textContent = 'Retry search';
    btn.disabled = false;
  }
}

function renderReuseResult(c, matchedIds) {
  const box = $('reuseResultBox');
  if (!matchedIds.length) {
    box.innerHTML = '<p style="font-size:12px;color:var(--green);margin-top:10px;">🟢 No reused evidence found — this POE appears unique in the local index.</p>';
    return;
  }
  const matchedCases = matchedIds.map(id => cases.find(x => x.id === id)).filter(Boolean);
  box.innerHTML = `
    <div class="reuse-result">
      <p style="font-size:12px;color:var(--amber);margin:10px 0;">🚨 Potentially reused evidence — this POE's execution evidence closely matches ${matchedCases.length} other case(s).</p>
      <div class="reuse-chain">
        <div class="reuse-fp">POE fingerprint (this case)</div>
        <div class="reuse-arrow">↓</div>
      </div>
      <table class="data-table">
        <thead><tr><th>Case</th><th>Invoice</th><th>Amount</th><th>Status</th></tr></thead>
        <tbody>${matchedCases.map(m => `<tr class="clickable" data-open="${m.id}"><td style="font-family:var(--mono)">${m.id}</td><td>${m.invoice.number}</td><td>${fmtMoney(m.invoice.amount)}</td><td>${statusBadge(m.status)}</td></tr>`).join('')}</tbody>
      </table>
    </div>`;
  box.querySelectorAll('[data-open]').forEach(el => el.addEventListener('click', () => openCase(el.dataset.open)));
}

// ═══════════════════════════════════════════════════
//  INVESTIGATION COPILOT
// ═══════════════════════════════════════════════════
function resetCopilotForCase(id) {
  const c = cases.find(x => x.id === id);
  copilotHistory = [];
  $('copilotContext').textContent = c.id + ' — ' + c.supplierName;
  $('copilotBody').innerHTML = '';
  $('copilotInput').disabled = !NativeAI.isNative;
  $('copilotSend').disabled = !NativeAI.isNative;
  $('copilotExamples').innerHTML = [
    'Why was this case flagged?',
    'Show me all previous invoices associated with this POE.',
    'Are there any unusual events in this timeline?',
    'What should I investigate first?',
  ].map(q => `<button class="copilot-chip">${q}</button>`).join('');
  $('copilotExamples').querySelectorAll('.copilot-chip').forEach(chip => {
    chip.addEventListener('click', () => askCopilot(chip.textContent));
  });
  if (!NativeAI.isNative) {
    appendMsg('ai', 'Investigation Copilot needs the native desktop shell to run the on-device model. Launch the installed app to use this panel.');
  }
}

function appendMsg(role, text) {
  const el = document.createElement('div');
  el.className = 'msg ' + role;
  el.textContent = text;
  $('copilotBody').appendChild(el);
  $('copilotBody').scrollTop = $('copilotBody').scrollHeight;
  return el;
}

function buildCopilotContext(c) {
  const matrix = buildMatrix(c);
  const risks = computeRiskIndicators(c);
  const reuseMatches = (reuseCache[c.id] || []).map(id => cases.find(x => x.id === id)).filter(Boolean);
  return `CASE: ${c.id}, Supplier: ${c.supplierName}, Status: ${c.status}
PURCHASE ORDER: ${JSON.stringify(c.po)}
INVOICE: ${JSON.stringify(c.invoice)}
PROOF OF EXECUTION: ${JSON.stringify({ quantity: c.poe.quantity, location: c.poe.location, date: c.poe.date, product: c.poe.product, reference: c.poe.reference })}
VERIFICATION MATRIX: ${JSON.stringify(matrix.map(r => ({ field: r.field, po: r.po, invoice: r.invoice, poe: r.poe, matches: r.ok })))}
COMPUTED RISK INDICATORS: ${JSON.stringify(risks)}
POTENTIAL FINANCIAL EXPOSURE: ${fmtMoney(computeExposure(c))}
REUSED-EVIDENCE MATCHES: ${reuseMatches.length ? JSON.stringify(reuseMatches.map(m => ({ case: m.id, invoice: m.invoice.number, amount: m.invoice.amount, status: m.status }))) : 'Not yet searched — the analyst has not run reuse detection for this case yet.'}
TIMELINE: ${JSON.stringify(c.timeline)}`;
}

async function askCopilot(question) {
  if (copilotBusy || !NativeAI.isNative) return;
  const c = cases.find(x => x.id === currentCaseId);
  if (!c) return;
  copilotBusy = true;
  $('copilotSend').disabled = true;
  appendMsg('user', question);
  const typing = appendMsg('ai typing', 'Investigating…');

  const sys = `You are the Investigation Copilot inside a POE (Proof of Execution) verification tool for a finance/procurement fraud-prevention team. ` +
    `You are given the deterministic, already-computed verification data for one case below — never invent numbers, dates, or document contents not present in it. ` +
    `Speak like an experienced fraud/verification analyst: precise, concise (3-5 sentences unless asked to list something), and always frame findings as "requires investigation" rather than declaring fraud outright — a human analyst makes the final call.\n\n` +
    buildCopilotContext(c);
  const prompt = sys + `\n\nAnalyst question: ${question}\nAnswer:`;

  try {
    const resp = await NativeAI.generate(prompt);
    typing.remove();
    appendMsg('ai', resp.text.trim());
  } catch (e) {
    typing.remove();
    appendMsg('ai', 'Investigation Copilot is unavailable: ' + e.message);
  }
  copilotBusy = false;
  $('copilotSend').disabled = false;
}

$('copilotSend').addEventListener('click', () => {
  const val = $('copilotInput').value.trim();
  if (!val) return;
  $('copilotInput').value = '';
  askCopilot(val);
});
$('copilotInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('copilotSend').click();
});

// ═══════════════════════════════════════════════════
//  SUPPLIERS
// ═══════════════════════════════════════════════════
function supplierStats(supplierId) {
  const supCases = cases.filter(c => c.supplierId === supplierId);
  const reviewCases = supCases.filter(c => c.status === 'review');
  let quantityMismatches = 0, amountMismatches = 0, dateInconsistencies = 0, duplicatePoe = 0;
  supCases.forEach(c => {
    if (c.po.quantity !== c.invoice.quantity) quantityMismatches++;
    if (c.po.amount !== c.invoice.amount) amountMismatches++;
    if (new Date(c.poe.date) < new Date(c.po.date)) dateInconsistencies++;
    if ((reuseCache[c.id] || []).length > 0) duplicatePoe++;
  });
  return {
    name: supCases[0] ? supCases[0].supplierName : supplierId,
    total: supCases.length, reviewRequired: reviewCases.length, approved: supCases.length - reviewCases.length,
    quantityMismatches, amountMismatches, dateInconsistencies, duplicatePoe,
    cases: supCases,
  };
}

function renderSuppliers() {
  const ids = [...new Set(cases.map(c => c.supplierId))];
  if (!ids.length) {
    $('supplierGrid').innerHTML = '<div class="empty-note">No cases yet — go to "New Case" to verify your first submission.</div>';
    return;
  }
  $('supplierGrid').innerHTML = ids.map(id => {
    const s = supplierStats(id);
    return `<div class="supplier-card" data-open="${id}">
      <div class="supplier-name">${s.name}</div>
      <div class="supplier-mini-stats">
        <div><b>${s.total}</b> cases</div>
        <div><b>${s.reviewRequired}</b> review</div>
      </div>
    </div>`;
  }).join('');
  $('supplierGrid').querySelectorAll('[data-open]').forEach(el => el.addEventListener('click', () => openSupplier(el.dataset.open)));
}

function openSupplier(id) {
  currentSupplierId = id;
  showView('supplierdetail');
  const s = supplierStats(id);
  $('supplierDetailBody').innerHTML = `
    <div class="case-header">
      <div>
        <div class="case-id">${s.name}</div>
        <div style="font-size:12px;color:var(--text2)">Supplier verification history</div>
      </div>
    </div>
    <div class="stat-row">
      <div class="stat-card"><div class="stat-v">${s.total}</div><div class="stat-l">Cases analyzed</div></div>
      <div class="stat-card good"><div class="stat-v">${s.approved}</div><div class="stat-l">Approved</div></div>
      <div class="stat-card alert"><div class="stat-v">${s.reviewRequired}</div><div class="stat-l">Review required</div></div>
      <div class="stat-card warn"><div class="stat-v">${s.duplicatePoe}</div><div class="stat-l">Reused POE flags</div></div>
    </div>
    <div class="card">
      <div class="card-title">Risk breakdown</div>
      <div class="sec-row" style="margin-bottom:6px;"><span>Quantity mismatches</span><b>${s.quantityMismatches}</b></div>
      <div class="sec-row" style="margin-bottom:6px;"><span>Amount discrepancies</span><b>${s.amountMismatches}</b></div>
      <div class="sec-row" style="margin-bottom:6px;"><span>Date inconsistencies</span><b>${s.dateInconsistencies}</b></div>
      <div class="sec-row"><span>Reused / duplicate POE (flagged so far)</span><b>${s.duplicatePoe}</b></div>
    </div>
    <div class="sh">Cases</div>
    <table class="data-table">
      <thead><tr><th>Case</th><th>Invoice</th><th>Claim</th><th>Status</th></tr></thead>
      <tbody>${s.cases.map(c => `<tr class="clickable" data-open="${c.id}"><td style="font-family:var(--mono)">${c.id}</td><td>${c.invoice.number}</td><td>${fmtMoney(c.invoice.amount)}</td><td>${statusBadge(c.status)}</td></tr>`).join('')}</tbody>
    </table>
  `;
  $('supplierDetailBody').querySelectorAll('[data-open]').forEach(el => el.addEventListener('click', () => openCase(el.dataset.open)));
}

// ═══════════════════════════════════════════════════
//  LOCAL AI PAGE + MISC
// ═══════════════════════════════════════════════════
$('checkReadyBtn').addEventListener('click', async () => {
  const out = $('readyResult');
  out.textContent = 'Checking…';
  try {
    const resp = await NativeAI.ensureReady();
    out.textContent = resp.ok ? '✓ Ready (' + resp.state + ')' : '✗ ' + resp.error;
    out.style.color = resp.ok ? 'var(--green)' : 'var(--red)';
  } catch (e) {
    out.textContent = '✗ ' + e.message;
    out.style.color = 'var(--red)';
  }
});

$('proveItBtn').addEventListener('click', () => {
  toast(`0 documents uploaded externally · 0 API calls · ${cases.length} cases processed entirely on this device`);
});

if (!NativeAI.isNative) {
  $('localPill').innerHTML = '<span class="pill-dot" style="background:var(--amber);box-shadow:none"></span> Browser preview';
  $('localPill').style.borderColor = 'rgba(251,191,36,0.35)';
  $('localPill').style.color = 'var(--amber)';
  $('localPill').style.background = 'var(--amber-dim)';
}

renderDashboard();
