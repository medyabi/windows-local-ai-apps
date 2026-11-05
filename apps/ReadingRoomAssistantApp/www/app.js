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
    describeImage: (base64) => call('describeImage', { base64 }),
    parseDicom: (base64) => call('parseDicom', { base64 }),
  };
})();

const $ = id => document.getElementById(id);
const PRIORITY_THRESHOLD = 0.75;

// ═══════════════════════════════════════════════════
//  STATE
// ═══════════════════════════════════════════════════
let studies = seedStudies();
let currentStudyId = null;
let viewerState = { zoom: 1, panX: 0, panY: 0, brightness: 100, contrast: 100, mode: 'pan', compare: false };
let drawStart = null;

// ═══════════════════════════════════════════════════
//  VIEW SWITCHING
// ═══════════════════════════════════════════════════
function showView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  $('view-' + name).classList.add('active');
  const navItem = document.querySelector('.nav-item[data-view="' + name + '"]');
  if (navItem) navItem.classList.add('active');
  if (name === 'worklist') renderWorklist();
  if (name === 'dashboard') renderDashboard();
  if (name === 'import') resetImportForm();
}
document.querySelectorAll('.nav-item[data-view]').forEach(el => {
  el.addEventListener('click', () => showView(el.dataset.view));
});
document.querySelectorAll('[data-back]').forEach(el => {
  el.addEventListener('click', () => showView(el.dataset.back));
});

function fmtHoursAgo(iso) {
  const h = (Date.now() - new Date(iso).getTime()) / 3600000;
  if (h < 1) return Math.round(h * 60) + ' min ago';
  if (h < 24) return h.toFixed(1) + ' h ago';
  return Math.round(h / 24) + ' d ago';
}
function fmtMonthsAgo(iso) {
  const d = new Date(iso);
  const months = Math.round((Date.now() - d.getTime()) / (30.44 * 86400000));
  return months <= 1 ? '1 month ago' : months + ' months ago';
}

// ═══════════════════════════════════════════════════
//  DETERMINISTIC PRIORITIZATION — code decides, AI narrates
// ═══════════════════════════════════════════════════
function computePriorityFromFindings(findings) {
  if (!findings.length) return 'routine';
  const maxConf = Math.max(...findings.map(f => f.confidence));
  if (findings.length >= 2 && findings.every(f => f.confidence >= 0.55)) return 'stat';
  if (maxConf >= PRIORITY_THRESHOLD) return 'high';
  return 'routine';
}
function priorityReasonText(study) {
  if (study.docSource === 'import') return 'Imported — no automated detection';
  const findings = study.findings || [];
  if (!findings.length) return 'No AI-flagged regions of interest';
  const maxConf = Math.max(...findings.map(f => f.confidence));
  if (study.clinicalPriority === 'stat') return `${findings.length} regions flagged (highest confidence ${maxConf.toFixed(2)}) — multiple-finding STAT rule`;
  if (study.clinicalPriority === 'high') return `Confidence ${maxConf.toFixed(2)} ≥ ${PRIORITY_THRESHOLD} high-priority threshold`;
  return `Highest confidence ${maxConf.toFixed(2)} — below prioritization threshold`;
}
function findingReasonText(f) {
  return f.confidence >= PRIORITY_THRESHOLD
    ? `Confidence ${f.confidence.toFixed(2)} meets the ${PRIORITY_THRESHOLD} high-priority threshold — this contributed to moving the study up the worklist.`
    : `Confidence ${f.confidence.toFixed(2)} is below the ${PRIORITY_THRESHOLD} prioritization threshold; retained for radiologist review at routine priority.`;
}
const STATUS_LABEL = { queued: 'Queued', processing: 'Processing', prioritized: 'Prioritized', in_review: 'In Review', read: 'Read', signed: 'Signed' };

// ═══════════════════════════════════════════════════
//  WORKLIST
// ═══════════════════════════════════════════════════
function sortedWorklist() {
  const priOrder = { stat: 0, high: 1, routine: 2 };
  return [...studies].sort((a, b) => {
    const aActive = !['read', 'signed'].includes(a.status);
    const bActive = !['read', 'signed'].includes(b.status);
    if (aActive !== bActive) return aActive ? -1 : 1;
    if (aActive) {
      if (a.status === 'processing' && b.status !== 'processing') return -1;
      if (b.status === 'processing' && a.status !== 'processing') return 1;
      const pa = priOrder[a.clinicalPriority] ?? 2, pb = priOrder[b.clinicalPriority] ?? 2;
      if (pa !== pb) return pa - pb;
      return new Date(a.receivedAt) - new Date(b.receivedAt);
    }
    return new Date(b.receivedAt) - new Date(a.receivedAt);
  });
}

function renderWorklist() {
  const list = sortedWorklist();
  $('wlSub').textContent = `${list.length} studies — ${list.filter(s => s.clinicalPriority !== 'routine' && !['read', 'signed'].includes(s.status)).length} prioritized, ${list.filter(s => s.status === 'queued').length} queued.`;
  $('worklistBody').innerHTML = list.map(s => {
    const isPriRow = ['stat', 'high'].includes(s.clinicalPriority) && !['read', 'signed'].includes(s.status);
    const findingsCount = (s.findings || []).length;
    const aiChip = s.docSource === 'import'
      ? '<span class="ai-chip none">No auto-detection</span>'
      : s.status === 'processing'
      ? '<span class="ai-chip none">Processing…</span>'
      : findingsCount ? `<span class="ai-chip">${findingsCount} finding${findingsCount > 1 ? 's' : ''}</span>` : '<span class="ai-chip none">No findings</span>';
    return `<tr class="clickable ${isPriRow ? 'pri-row' : ''}" data-open="${s.id}">
      <td><span class="pri-stripe ${s.clinicalPriority}"></span></td>
      <td style="font-family:var(--mono)">${s.accession}</td>
      <td style="font-family:var(--mono)">${s.patientId}</td>
      <td>${s.age}${s.sex}</td>
      <td>${s.examType}</td>
      <td>${aiChip}</td>
      <td style="color:var(--text2);font-size:10.8px;">${priorityReasonText(s)}</td>
      <td><span class="status-badge ${s.status}">${STATUS_LABEL[s.status]}</span></td>
    </tr>`;
  }).join('') || '<tr><td colspan="8" class="empty-note">No studies.</td></tr>';
  $('worklistBody').querySelectorAll('[data-open]').forEach(el => el.addEventListener('click', () => openStudy(el.dataset.open)));
}

// ═══════════════════════════════════════════════════
//  STUDY READING VIEW
// ═══════════════════════════════════════════════════
function openStudy(id) {
  currentStudyId = id;
  const s = studies.find(x => x.id === id);
  if (!s) return;
  viewerState = { zoom: 1, panX: 0, panY: 0, brightness: 100, contrast: 100, mode: 'pan', compare: false };
  showView('study');

  if (s.status === 'processing') {
    renderProcessingScreen(s);
    return;
  }
  if (['queued', 'prioritized'].includes(s.status)) {
    s.status = 'in_review';
    if (!s.openedAt) s.openedAt = new Date().toISOString();
    s.auditLog.push({ ts: new Date().toISOString(), actor: 'Radiologist', action: 'Opened study for review.' });
  }
  renderStudyView(s);
  runOpenGeneration(s);
}

async function runOpenGeneration(s) {
  if (s.docSource === 'import' && s.aiImageDescription === null) {
    await generateImageDescription(s);
  }
  if (s.aiDraftImpression === null) {
    generateDraftImpression(s);
  }
}

function renderProcessingScreen(s) {
  $('studyInfoBar').innerHTML = studyInfoHtml(s);
  $('procStrip').textContent = 'Awaiting AI pre-screening';
  $('viewerToolbar').innerHTML = '';
  $('viewerCanvas').innerHTML = '';
  $('viewerStage').style.cursor = 'default';
  $('viewerCanvas').innerHTML = `<img src="${s.image}" style="max-height:min(70vh,720px);width:auto;filter:grayscale(1) brightness(70%);">`;
  $('sidePane').innerHTML = `
    <div class="side-section">
      <div class="side-title">🧠 AI Pre-screening <span class="badge-src ai">AI</span></div>
      <p style="font-size:11.5px;color:var(--text2);line-height:1.6;margin-bottom:10px;">
        This study just arrived and hasn't been pre-screened yet. In a live deployment this runs automatically
        within seconds of the study arriving in the local reading environment. Run it now to see the full
        workflow: analysis → region-of-interest detection → confidence scoring → worklist prioritization.
      </p>
      <button class="btn primary" id="runPrescreenBtn">▶ Run AI Pre-screening Now</button>
      <div id="prescreenStatus" style="margin-top:10px;font-size:11.5px;"></div>
    </div>`;
  $('runPrescreenBtn').addEventListener('click', () => runPrescreening(s));
}

function runPrescreening(s) {
  const btn = $('runPrescreenBtn');
  const status = $('prescreenStatus');
  btn.disabled = true;
  status.innerHTML = '<span class="loading-inline"><span class="spinner"></span> Analyzing image on-device…</span>';
  const t0 = performance.now();
  setTimeout(() => {
    const findings = s.pendingFindings || [];
    s.findings = findings;
    delete s.pendingFindings;
    const priority = computePriorityFromFindings(findings);
    s.clinicalPriority = priority;
    s.status = priority === 'routine' ? 'queued' : 'prioritized';
    const timeSeconds = +(((performance.now() - t0) / 1000) + 0.3).toFixed(1);
    s.processing = { status: 'complete', timeSeconds, regionsDetected: findings.length, prioritized: priority !== 'routine' };
    s.auditLog.push({ ts: new Date().toISOString(), actor: 'AI', action: `Pre-screening complete — ${findings.length} region(s) flagged${priority !== 'routine' ? ', study prioritized (' + priority.toUpperCase() + ')' : ''}.` });
    status.innerHTML = '<span style="color:var(--green)">✓ Pre-screening complete — opening study…</span>';
    setTimeout(() => openStudy(s.id), 500);
  }, 900);
}

function studyInfoHtml(s) {
  return `
    <b>${s.accession}</b><span class="sep">·</span>
    <span style="font-family:var(--mono)">${s.patientId}</span><span class="sep">·</span>
    ${s.age}${s.sex}<span class="sep">·</span>
    ${s.examType}<span class="sep">·</span>
    <span class="status-badge ${s.status}">${STATUS_LABEL[s.status]}</span>
    <span class="pri-stripe ${s.clinicalPriority}" title="${s.clinicalPriority} priority"></span>
  `;
}

function procStripText(s) {
  if (s.docSource === 'import') {
    return `Imported study · no automated pre-screening · ${s.priorStudy ? 'prior imaging attached' : 'no prior imaging attached'}`;
  }
  const p = s.processing;
  if (!p || p.status !== 'complete') return 'Processing…';
  const parts = [`${p.regionsDetected} region${p.regionsDetected === 1 ? '' : 's'} flagged`];
  parts.push(p.prioritized ? 'prioritized' : 'not prioritized');
  parts.push(`${p.timeSeconds}s processing time`);
  parts.push(s.priorStudy ? 'prior imaging found' : 'no prior imaging found');
  return parts.join(' · ');
}

function renderStudyView(s) {
  $('studyInfoBar').innerHTML = studyInfoHtml(s);
  $('procStrip').textContent = procStripText(s);
  renderViewerToolbar(s);
  renderViewer(s);
  renderSidePane(s);
}

// ── Imaging viewer ──
function renderViewerToolbar(s) {
  const canCompare = !!s.priorStudy;
  $('viewerToolbar').innerHTML = `
    <button class="tbtn" id="zoomOutBtn">−</button>
    <span class="tb-label" id="zoomPct">${Math.round(viewerState.zoom * 100)}%</span>
    <button class="tbtn" id="zoomInBtn">+</button>
    <button class="tbtn" id="resetViewBtn">⟲ Reset</button>
    <div class="tb-sep"></div>
    <button class="tbtn ${viewerState.mode === 'pan' ? 'active' : ''}" id="panModeBtn">🖐 Pan</button>
    <button class="tbtn" id="annotateModeBtn">✏ Add annotation</button>
    ${canCompare ? `<button class="tbtn ${viewerState.compare ? 'active' : ''}" id="compareBtn">🔀 Compare with prior</button>` : ''}
    <div class="tb-sep"></div>
    <span class="tb-label">Brightness</span>
    <input type="range" min="40" max="180" value="${viewerState.brightness}" class="tb-slider" id="brightnessSlider">
    <span class="tb-label">Contrast</span>
    <input type="range" min="40" max="200" value="${viewerState.contrast}" class="tb-slider" id="contrastSlider">
  `;
  $('zoomInBtn').addEventListener('click', () => setZoom(viewerState.zoom + 0.25));
  $('zoomOutBtn').addEventListener('click', () => setZoom(viewerState.zoom - 0.25));
  $('resetViewBtn').addEventListener('click', resetView);
  $('panModeBtn').addEventListener('click', () => setMode('pan'));
  $('annotateModeBtn').addEventListener('click', () => setMode('annotate'));
  if (canCompare) $('compareBtn').addEventListener('click', () => toggleCompare(s));
  $('brightnessSlider').addEventListener('input', e => { viewerState.brightness = +e.target.value; applyImgFilter(); });
  $('contrastSlider').addEventListener('input', e => { viewerState.contrast = +e.target.value; applyImgFilter(); });
}

function setMode(mode) {
  viewerState.mode = mode;
  const s = studies.find(x => x.id === currentStudyId);
  renderViewerToolbar(s);
  const stage = $('viewerStage');
  stage.classList.toggle('drawing', mode === 'annotate');
}

function setZoom(z) {
  viewerState.zoom = Math.max(0.5, Math.min(4, z));
  applyTransform();
  $('zoomPct').textContent = Math.round(viewerState.zoom * 100) + '%';
}
function resetView() {
  viewerState.zoom = 1; viewerState.panX = 0; viewerState.panY = 0;
  viewerState.brightness = 100; viewerState.contrast = 100;
  applyTransform(); applyImgFilter();
  const s = studies.find(x => x.id === currentStudyId);
  renderViewerToolbar(s);
}
function applyTransform() {
  const canvas = $('viewerCanvas');
  if (canvas) canvas.style.transform = `translate(${viewerState.panX}px, ${viewerState.panY}px) scale(${viewerState.zoom})`;
}
function applyImgFilter() {
  const img = document.querySelector('#viewerCanvas > img');
  if (img) img.style.filter = `grayscale(1) brightness(${viewerState.brightness}%) contrast(${viewerState.contrast}%)`;
}

function toggleCompare(s) {
  viewerState.compare = !viewerState.compare;
  renderViewerToolbar(s);
  renderViewer(s);
}

function renderViewer(s) {
  const stage = $('viewerStage');
  if (viewerState.compare && s.priorStudy) {
    stage.innerHTML = `<div class="viewer-split">
      <div class="half"><div class="half-label">CURRENT — today</div><img src="${s.image}"></div>
      <div class="half"><div class="half-label">PRIOR — ${fmtMonthsAgo(s.priorStudy.date)}</div><img src="${s.priorStudy.image}"></div>
    </div>`;
    return;
  }
  stage.innerHTML = `<div class="viewer-canvas" id="viewerCanvas"><img src="${s.image}" style="max-height:min(70vh,720px);width:auto;"></div>`;
  applyTransform();
  applyImgFilter();
  renderBoxes(s);
  wireStageInteraction(s);
}

function renderBoxes(s) {
  const canvas = $('viewerCanvas');
  if (!canvas) return;
  (s.findings || []).forEach(f => {
    const el = document.createElement('div');
    el.className = `bbox ai ${f.status === 'accepted' ? 'accepted' : ''} ${f.status === 'rejected' ? 'rejected' : ''}`;
    el.style.left = (f.bbox.x * 100) + '%';
    el.style.top = (f.bbox.y * 100) + '%';
    el.style.width = (f.bbox.w * 100) + '%';
    el.style.height = (f.bbox.h * 100) + '%';
    el.innerHTML = `<div class="bbox-label">AI · ${Math.round(f.confidence * 100)}%</div>`;
    canvas.appendChild(el);
  });
  (s.annotations || []).forEach(a => {
    const el = document.createElement('div');
    el.className = 'bbox md';
    el.style.left = (a.x * 100) + '%';
    el.style.top = (a.y * 100) + '%';
    el.style.width = (a.w * 100) + '%';
    el.style.height = (a.h * 100) + '%';
    el.innerHTML = `<div class="bbox-label">${a.label}</div>`;
    canvas.appendChild(el);
  });
}

function wireStageInteraction(s) {
  const stage = $('viewerStage');
  stage.classList.toggle('drawing', viewerState.mode === 'annotate');

  stage.onwheel = (e) => { e.preventDefault(); setZoom(viewerState.zoom + (e.deltaY < 0 ? 0.2 : -0.2)); };

  stage.onmousedown = (e) => {
    if (viewerState.mode === 'annotate') {
      const canvas = $('viewerCanvas');
      const rect = canvas.getBoundingClientRect();
      drawStart = { x: e.clientX, y: e.clientY, rect };
      const preview = document.createElement('div');
      preview.className = 'bbox md';
      preview.id = 'drawPreview';
      canvas.appendChild(preview);
      document.onmousemove = (me) => {
        const x0 = Math.min(drawStart.x, me.clientX), x1 = Math.max(drawStart.x, me.clientX);
        const y0 = Math.min(drawStart.y, me.clientY), y1 = Math.max(drawStart.y, me.clientY);
        preview.style.left = ((x0 - rect.left) / rect.width * 100) + '%';
        preview.style.top = ((y0 - rect.top) / rect.height * 100) + '%';
        preview.style.width = ((x1 - x0) / rect.width * 100) + '%';
        preview.style.height = ((y1 - y0) / rect.height * 100) + '%';
      };
      document.onmouseup = (me) => {
        document.onmousemove = null; document.onmouseup = null;
        const x0 = Math.min(drawStart.x, me.clientX), x1 = Math.max(drawStart.x, me.clientX);
        const y0 = Math.min(drawStart.y, me.clientY), y1 = Math.max(drawStart.y, me.clientY);
        preview.remove();
        if (x1 - x0 > 8 && y1 - y0 > 8) {
          const label = prompt('Label for this annotation:', 'Radiologist annotation') || 'Radiologist annotation';
          s.annotations.push({
            x: (x0 - rect.left) / rect.width, y: (y0 - rect.top) / rect.height,
            w: (x1 - x0) / rect.width, h: (y1 - y0) / rect.height, label,
          });
          s.auditLog.push({ ts: new Date().toISOString(), actor: 'Radiologist', action: `Added annotation — "${label}".` });
          renderViewer(s);
          renderSidePane(s);
        }
        setMode('pan');
      };
      return;
    }
    // pan mode
    stage.classList.add('grabbing');
    const start = { x: e.clientX, y: e.clientY, panX: viewerState.panX, panY: viewerState.panY };
    document.onmousemove = (me) => {
      viewerState.panX = start.panX + (me.clientX - start.x);
      viewerState.panY = start.panY + (me.clientY - start.y);
      applyTransform();
    };
    document.onmouseup = () => {
      document.onmousemove = null; document.onmouseup = null;
      stage.classList.remove('grabbing');
    };
  };
}

// ── Keyboard shortcuts ──
document.addEventListener('keydown', (e) => {
  if (['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
  if (!$('view-study').classList.contains('active')) return;
  const s = studies.find(x => x.id === currentStudyId);
  if (!s) return;
  if (e.key === '+' || e.key === '=') setZoom(viewerState.zoom + 0.25);
  else if (e.key === '-') setZoom(viewerState.zoom - 0.25);
  else if (e.key === '0') resetView();
  else if (e.key === 'ArrowLeft') { viewerState.panX += 20; applyTransform(); }
  else if (e.key === 'ArrowRight') { viewerState.panX -= 20; applyTransform(); }
  else if (e.key === 'ArrowUp') { viewerState.panY += 20; applyTransform(); }
  else if (e.key === 'ArrowDown') { viewerState.panY -= 20; applyTransform(); }
  else if (e.key === 'a' || e.key === 'A') setMode('annotate');
  else if (e.key === 'Escape') setMode('pan');
  else if ((e.key === 'c' || e.key === 'C') && s.priorStudy) toggleCompare(s);
});

// ═══════════════════════════════════════════════════
//  SIDE PANE — AI findings, prior study, draft/final impression, audit
// ═══════════════════════════════════════════════════
function renderSidePane(s) {
  $('sidePane').innerHTML = `
    ${findingsSectionHtml(s)}
    ${s.docSource === 'import' ? imageDescriptionSectionHtml(s) : ''}
    ${priorStudySectionHtml(s)}
    ${impressionSectionHtml(s)}
    ${auditSectionHtml(s)}
  `;
  wireSidePane(s);
}

function imageDescriptionSectionHtml(s) {
  const body = s.aiImageDescription === null
    ? `<div class="loading-inline"><span class="spinner"></span> Generating on-device image description…</div>`
    : `<div class="prior-box"><div class="prior-summary" style="font-style:normal;">${s.aiImageDescription}</div></div>`;
  return `<div class="side-section">
    <div class="side-title">🔍 On-device Image Description <span class="badge-src ai">AI</span></div>
    <p style="font-size:10.5px;color:var(--text3);margin-bottom:8px;">General-purpose vision model — not a radiology-specific finding.</p>
    ${body}
  </div>`;
}

function findingsSectionHtml(s) {
  const findings = s.findings || [];
  if (s.docSource === 'import') {
    return `<div class="side-section">
      <div class="side-title">AI Findings <span class="badge-src ai">AI</span></div>
      <div class="empty-note" style="padding:6px 0;line-height:1.6;">
        Automated region-of-interest detection is not available for imported studies in this prototype —
        there is no validated medical-imaging detection model connected. A production deployment would
        connect one here. See the on-device image description below, and use "✏ Add annotation" to mark
        up the image yourself.
      </div>
    </div>`;
  }
  if (!findings.length) {
    return `<div class="side-section">
      <div class="side-title">AI Findings <span class="badge-src ai">AI</span></div>
      <div class="empty-note" style="padding:6px 0;">No AI-flagged regions of interest for this study.</div>
    </div>`;
  }
  return `<div class="side-section">
    <div class="side-title">AI Findings <span class="badge-src ai">AI</span></div>
    ${findings.map(f => `
      <div class="finding-card ${f.status}" data-fid="${f.id}">
        <div class="finding-head">
          <div>
            <div class="finding-type">${f.findingType}</div>
            <div class="finding-roi">Region of interest: ${f.roi}</div>
          </div>
          <div class="conf-badge">${Math.round(f.confidence * 100)}%</div>
        </div>
        <div class="conf-bar"><div class="conf-bar-fill" style="width:${f.confidence * 100}%"></div></div>
        <div class="finding-actions">
          <button class="fbtn accept ${f.status === 'accepted' ? 'active-accept' : ''}" data-act="accept" data-fid="${f.id}">✓ Accept</button>
          <button class="fbtn reject ${f.status === 'rejected' ? 'active-reject' : ''}" data-act="reject" data-fid="${f.id}">✗ Reject</button>
          <button class="fbtn" data-act="modify" data-fid="${f.id}">✎ Modify</button>
          <button class="fbtn" data-act="explain" data-fid="${f.id}">ⓘ Why</button>
        </div>
        ${f.radiologistNote ? `<div style="margin-top:7px;font-size:10.8px;color:var(--md);">📝 ${f.radiologistNote}</div>` : ''}
        <div class="finding-explain" id="explain-${f.id}">
          <div><b>Finding type:</b> ${f.findingType}</div>
          <div><b>Confidence score:</b> ${f.confidence.toFixed(2)}</div>
          <div><b>Region of interest:</b> ${f.roi}</div>
          <div><b>Reason for prioritization:</b> ${findingReasonText(f)}</div>
          <div><b>Processing status:</b> Complete</div>
        </div>
      </div>`).join('')}
  </div>`;
}

function priorStudySectionHtml(s) {
  if (!s.priorStudy) {
    return `<div class="side-section">
      <div class="side-title">Prior Imaging</div>
      <div class="prior-none">No previous imaging available for comparison.</div>
    </div>`;
  }
  return `<div class="side-section">
    <div class="side-title">Prior Imaging</div>
    <div class="prior-box">
      <div class="prior-date">${s.priorStudy.examType} — ${fmtMonthsAgo(s.priorStudy.date)}</div>
      <div class="prior-summary">"${s.priorStudy.summary}"</div>
    </div>
  </div>`;
}

function impressionSectionHtml(s) {
  const signed = s.status === 'signed';
  const draftHtml = s.aiDraftImpression === null
    ? `<div class="loading-inline"><span class="spinner"></span> Generating AI draft impression on-device…</div>`
    : `<div class="draft-box">
        <div class="draft-flag">🤖 AI DRAFT — Radiologist confirmation required</div>
        ${s.aiDraftImpression}
      </div>`;
  return `<div class="side-section">
    <div class="side-title">AI Draft Impression <span class="badge-src ai">AI</span></div>
    ${draftHtml}
    <div class="side-title" style="margin-top:14px;">Final Impression <span class="badge-src md">Radiologist</span></div>
    <textarea class="impression-textarea" id="impressionInput" placeholder="Write or edit the final impression here…" ${signed ? 'disabled' : ''}>${s.radiologistImpression || ''}</textarea>
    ${signed
      ? `<div class="signed-banner" style="margin-top:10px;">✓ Signed by ${s.signedBy} — report finalized and locked.</div>`
      : `<div class="btn-row">
          <button class="btn" id="useDraftBtn" ${s.aiDraftImpression === null ? 'disabled' : ''}>Start from AI draft</button>
          <button class="btn" id="markReadBtn">Mark as Read</button>
          <button class="btn sign" id="signBtn">🖋 Sign &amp; Finalize Report</button>
        </div>`}
  </div>`;
}

function auditSectionHtml(s) {
  return `<div class="side-section">
    <div class="collapse-toggle" id="auditToggle">▸ Audit Trail (${s.auditLog.length})</div>
    <div class="collapse-body" id="auditBody">
      <div class="audit-list">
        ${s.auditLog.slice().reverse().map(a => `<div><span class="a-actor ${a.actor}">${a.actor}</span> — ${a.action} <span class="audit-time">${fmtHoursAgo(a.ts)}</span></div>`).join('')}
      </div>
    </div>
  </div>`;
}

function wireSidePane(s) {
  document.querySelectorAll('[data-act]').forEach(btn => {
    btn.addEventListener('click', () => handleFindingAction(s, btn.dataset.fid, btn.dataset.act));
  });
  const impressionInput = $('impressionInput');
  if (impressionInput) {
    impressionInput.addEventListener('input', () => { s.radiologistImpression = impressionInput.value; updateSignButtonState(s); });
  }
  const useDraftBtn = $('useDraftBtn');
  if (useDraftBtn) useDraftBtn.addEventListener('click', () => {
    impressionInput.value = stripDraftLabel(s.aiDraftImpression);
    s.radiologistImpression = impressionInput.value;
    updateSignButtonState(s);
  });
  const markReadBtn = $('markReadBtn');
  if (markReadBtn) markReadBtn.addEventListener('click', () => {
    s.status = 'read';
    s.auditLog.push({ ts: new Date().toISOString(), actor: 'Radiologist', action: 'Marked study as read.' });
    renderStudyView(s);
  });
  const signBtn = $('signBtn');
  if (signBtn) {
    updateSignButtonState(s);
    signBtn.addEventListener('click', () => signStudy(s));
  }
  const auditToggle = $('auditToggle');
  if (auditToggle) auditToggle.addEventListener('click', () => {
    $('auditBody').classList.toggle('open');
    auditToggle.textContent = (auditToggle.textContent[0] === '▸' ? '▾' : '▸') + auditToggle.textContent.slice(1);
  });
}

function updateSignButtonState(s) {
  const signBtn = $('signBtn');
  if (signBtn) signBtn.disabled = !(s.radiologistImpression && s.radiologistImpression.trim());
}
function stripDraftLabel(text) {
  return (text || '').replace(/\s*AI draft.*confirmation required\.?\s*$/i, '').trim();
}

function handleFindingAction(s, fid, act) {
  const f = s.findings.find(x => x.id === fid);
  if (!f) return;
  if (act === 'accept') {
    f.status = f.status === 'accepted' ? 'pending' : 'accepted';
    s.auditLog.push({ ts: new Date().toISOString(), actor: 'Radiologist', action: `${f.status === 'accepted' ? 'Accepted' : 'Un-accepted'} AI finding — "${f.findingType}" (${f.roi}).` });
  } else if (act === 'reject') {
    f.status = f.status === 'rejected' ? 'pending' : 'rejected';
    s.auditLog.push({ ts: new Date().toISOString(), actor: 'Radiologist', action: `${f.status === 'rejected' ? 'Rejected' : 'Un-rejected'} AI finding — "${f.findingType}" (${f.roi}).` });
  } else if (act === 'modify') {
    const newType = prompt('Modify finding description:', f.findingType);
    if (newType && newType.trim()) {
      const oldType = f.findingType;
      f.findingType = newType.trim();
      f.status = 'accepted';
      f.radiologistNote = `Modified by radiologist from "${oldType}".`;
      s.auditLog.push({ ts: new Date().toISOString(), actor: 'Radiologist', action: `Modified AI finding — "${oldType}" → "${f.findingType}".` });
    }
  } else if (act === 'explain') {
    $('explain-' + fid).classList.toggle('open');
    return;
  }
  renderStudyView(s);
}

function signStudy(s) {
  if (!s.radiologistImpression || !s.radiologistImpression.trim()) return;
  if (!confirm('Sign and finalize this report? This cannot be undone in this session.')) return;
  s.status = 'signed';
  s.signedAt = new Date().toISOString();
  s.signedBy = 'Dr. M. Idrissi';
  s.auditLog.push({ ts: s.signedAt, actor: 'Radiologist', action: 'Signed and finalized report.' });
  renderStudyView(s);
}

// ═══════════════════════════════════════════════════
//  AI DRAFT IMPRESSION — genuinely generated on-device, grounded in the
//  study's structured (demo) finding data. Never invents a diagnosis.
// ═══════════════════════════════════════════════════
function buildDraftPrompt(s) {
  const priorText = s.priorStudy
    ? `Prior ${s.priorStudy.examType} from ${fmtMonthsAgo(s.priorStudy.date)}: "${s.priorStudy.summary}"`
    : 'No prior imaging is available for comparison.';

  if (s.docSource === 'import') {
    const descText = s.aiImageDescription ? `"${s.aiImageDescription}"` : 'not yet available';
    return `You are drafting a short scaffold note for a human radiologist reviewing an IMPORTED study in a ` +
      `decision-support prototype. IMPORTANT: no automated region-of-interest detection was performed on this ` +
      `image — there is no validated medical-imaging model connected. Do NOT invent, suggest, or imply any specific ` +
      `abnormality, finding, region of interest, or diagnosis. You may neutrally mention the general-purpose, ` +
      `non-diagnostic on-device image description if provided, without adding clinical interpretation to it. State ` +
      `clearly that the radiologist's own review is required. Keep it to 2 sentences and end with exactly this ` +
      `sentence: "AI draft — radiologist confirmation required."\n\n` +
      `EXAM: ${s.examType}, patient ${s.age}${s.sex}\n` +
      `GENERAL ON-DEVICE IMAGE DESCRIPTION (non-diagnostic): ${descText}\n` +
      `PRIOR IMAGING: ${priorText}\n\n` +
      `Draft note:`;
  }

  const findingsText = (s.findings || []).length
    ? s.findings.map(f => `- ${f.findingType} in the ${f.roi} (AI confidence ${f.confidence.toFixed(2)}, requires radiologist review)`).join('\n')
    : '- No regions of interest were flagged.';
  return `You are drafting a PRELIMINARY, NON-FINAL radiology impression for a human radiologist to review, edit, and sign. ` +
    `Never state a confirmed diagnosis. Use cautious, structured clinical language such as "possible", "region of interest", ` +
    `and "requires review". Reference the AI findings and prior-study comparison below. Keep it to 2-3 sentences, clinically ` +
    `structured, and end with exactly this sentence: "AI draft — radiologist confirmation required."\n\n` +
    `EXAM: ${s.examType}, patient ${s.age}${s.sex}\n` +
    `AI FINDINGS:\n${findingsText}\n\n` +
    `PRIOR IMAGING: ${priorText}\n\n` +
    `Draft impression:`;
}

async function imageSrcToBase64(src) {
  if (src.startsWith('data:')) return src.split(',')[1];
  const blob = await (await fetch(src)).blob();
  return fileToBase64(blob);
}

async function generateImageDescription(s) {
  try {
    const base64 = await imageSrcToBase64(s.image);
    const resp = await NativeAI.describeImage(base64);
    s.aiImageDescription = resp.text.trim();
  } catch (e) {
    s.aiImageDescription = `(Image description unavailable: ${e.message})`;
  }
  if (currentStudyId === s.id) renderStudyView(s);
}

async function generateDraftImpression(s) {
  try {
    const resp = await NativeAI.generate(buildDraftPrompt(s));
    s.aiDraftImpression = resp.text.trim();
  } catch (e) {
    s.aiDraftImpression = `(AI draft unavailable: ${e.message}) — please write the impression manually. AI draft — radiologist confirmation required.`;
  }
  if (currentStudyId === s.id) renderStudyView(s);
}

// ═══════════════════════════════════════════════════
//  IMPORT STUDY — real images (or DICOM), not demo data. No fabricated AI
//  findings are ever attached to an imported study; see findingsSectionHtml().
// ═══════════════════════════════════════════════════
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

const importState = { main: null, prior: null };

function isDicomFile(file) {
  return /\.dcm$/i.test(file.name) || file.type === 'application/dicom';
}

function resetImportForm() {
  importState.main = null;
  importState.prior = null;
  ['impAccession', 'impPatientId', 'impAge', 'impExamType', 'impPriorDate', 'impPriorSummary'].forEach(id => { if ($(id)) $(id).value = ''; });
  if ($('impSex')) $('impSex').value = 'M';
  $('importMainLabel').textContent = $('importMainLabel').dataset.defaultLabel;
  $('importPriorLabel').textContent = $('importPriorLabel').dataset.defaultLabel;
  $('importPriorBody').classList.remove('open');
  $('importPriorToggle').textContent = '▸ + Add prior study for comparison (optional)';
  $('importParseStatus').textContent = '';
  $('importSubmitStatus').textContent = '';
  updateImportButtonState();
}

async function handleImportFile(doc, files) {
  if (!files || !files.length) return;
  const file = files[0];
  const label = $(doc === 'main' ? 'importMainLabel' : 'importPriorLabel');
  label.textContent = 'Reading ' + file.name + '…';
  const entry = { file, isDicom: isDicomFile(file), imageSrc: null, meta: null };

  if (entry.isDicom) {
    if (doc === 'main') $('importParseStatus').innerHTML = '<span class="loading-inline"><span class="spinner"></span> Parsing DICOM on-device…</span>';
    try {
      const base64 = await fileToBase64(file);
      const resp = await NativeAI.parseDicom(base64);
      const meta = JSON.parse(resp.text);
      entry.meta = meta;
      entry.imageSrc = 'data:image/png;base64,' + meta.pngBase64;
      label.textContent = '✓ ' + file.name + ' (DICOM parsed)';
      if (doc === 'main') {
        $('importParseStatus').innerHTML = '<span style="color:var(--green)">✓ DICOM parsed — fields pre-filled below, review before importing.</span>';
        if (meta.patientId) $('impPatientId').value = meta.patientId;
        if (meta.age) $('impAge').value = meta.age;
        if (meta.sex) $('impSex').value = meta.sex;
        if (meta.accession) $('impAccession').value = meta.accession;
        const examGuess = meta.bodyPart ? (meta.bodyPart.charAt(0) + meta.bodyPart.slice(1).toLowerCase() + ' X-ray') : (meta.studyDescription || '');
        if (examGuess) $('impExamType').value = examGuess;
      } else if (meta.studyDate) {
        $('impPriorDate').value = meta.studyDate;
      }
    } catch (e) {
      label.textContent = 'Failed to parse: ' + e.message;
      if (doc === 'main') $('importParseStatus').innerHTML = `<span style="color:var(--red)">✗ ${e.message}</span>`;
      return;
    }
  } else {
    entry.imageSrc = URL.createObjectURL(file);
    label.textContent = '✓ ' + file.name;
    if (doc === 'main') $('importParseStatus').textContent = '';
  }

  importState[doc] = entry;
  updateImportButtonState();
}

document.querySelectorAll('#view-import .upload-zone').forEach(zone => {
  const doc = zone.dataset.doc;
  const input = zone.querySelector('input[type=file]');
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag'));
  zone.addEventListener('drop', e => { e.preventDefault(); zone.classList.remove('drag'); handleImportFile(doc, e.dataTransfer.files); });
  input.addEventListener('change', e => handleImportFile(doc, e.target.files));
});

$('importPriorToggle').addEventListener('click', () => {
  $('importPriorBody').classList.toggle('open');
  const open = $('importPriorBody').classList.contains('open');
  $('importPriorToggle').textContent = (open ? '▾' : '▸') + ' + Add prior study for comparison (optional)';
});

['impAccession', 'impPatientId', 'impAge', 'impExamType'].forEach(id => $(id).addEventListener('input', updateImportButtonState));

function updateImportButtonState() {
  const ok = importState.main && $('impAccession').value.trim() && $('impPatientId').value.trim() && $('impAge').value && $('impExamType').value.trim();
  $('importSubmitBtn').disabled = !ok;
}

$('importSubmitBtn').addEventListener('click', submitImport);

function submitImport() {
  const now = new Date().toISOString();
  const accession = $('impAccession').value.trim();
  const priorEntry = importState.prior;

  const study = {
    id: 'STU-IMPORT-' + Date.now(),
    accession, patientId: $('impPatientId').value.trim(),
    age: +$('impAge').value, sex: $('impSex').value,
    examType: $('impExamType').value.trim(),
    bodyPart: '', modality: 'XR',
    image: importState.main.imageSrc,
    receivedAt: now,
    status: 'queued',
    clinicalPriority: 'routine',
    findings: [],
    processing: { status: 'not_applicable', timeSeconds: null, regionsDetected: null, prioritized: false },
    priorStudy: priorEntry ? {
      date: $('impPriorDate').value || now,
      examType: $('impExamType').value.trim() + ' (prior)',
      image: priorEntry.imageSrc,
      summary: $('impPriorSummary').value.trim() || 'No summary provided at import time.',
    } : null,
    aiSummaryHint: '',
    aiImageDescription: null,
    aiDraftImpression: null,
    radiologistImpression: '',
    annotations: [],
    docSource: 'import',
    auditLog: [{ ts: now, actor: 'System', action: `Study imported by radiologist (${importState.main.isDicom ? 'DICOM' : 'image file'}) — no automated pre-screening performed.` }],
    signedAt: null, signedBy: null, openedAt: null,
  };

  studies.unshift(study);
  $('importSubmitStatus').innerHTML = '<span style="color:var(--green)">✓ Study imported — opening…</span>';
  setTimeout(() => openStudy(study.id), 300);
}

// ═══════════════════════════════════════════════════
//  DASHBOARD
// ═══════════════════════════════════════════════════
function renderDashboard() {
  const processed = studies.filter(s => s.status !== 'queued' && s.status !== 'processing').length;
  const prioritized = studies.filter(s => ['stat', 'high'].includes(s.clinicalPriority)).length;
  const queued = studies.filter(s => s.status === 'queued' || s.status === 'processing').length;
  const reviewed = studies.filter(s => ['read', 'signed'].includes(s.status)).length;
  const procTimes = studies.map(s => s.processing && s.processing.timeSeconds).filter(t => typeof t === 'number');
  const avgProc = procTimes.length ? (procTimes.reduce((a, b) => a + b, 0) / procTimes.length) : 0;
  const readingTimes = studies.filter(s => s.openedAt && s.signedAt).map(s => (new Date(s.signedAt) - new Date(s.openedAt)) / 60000);
  const avgReading = readingTimes.length ? (readingTimes.reduce((a, b) => a + b, 0) / readingTimes.length) : 0;
  const allFindings = studies.flatMap(s => s.findings || []);
  const accepted = allFindings.filter(f => f.status === 'accepted').length;
  const rejected = allFindings.filter(f => f.status === 'rejected').length;

  $('dashStats1').innerHTML = `
    <div class="stat-card"><div class="stat-v">${studies.length}</div><div class="stat-l">Studies processed</div></div>
    <div class="stat-card ai"><div class="stat-v">${prioritized}</div><div class="stat-l">Prioritized</div></div>
    <div class="stat-card"><div class="stat-v">${queued}</div><div class="stat-l">Awaiting review</div></div>
    <div class="stat-card green"><div class="stat-v">${reviewed}</div><div class="stat-l">Reviewed</div></div>
  `;
  $('dashStats2').innerHTML = `
    <div class="stat-card"><div class="stat-v">${avgProc.toFixed(1)}s</div><div class="stat-l">Avg processing time</div></div>
    <div class="stat-card"><div class="stat-v">${avgReading ? avgReading.toFixed(0) + 'm' : '—'}</div><div class="stat-l">Avg reading time</div></div>
    <div class="stat-card ai"><div class="stat-v">${allFindings.length}</div><div class="stat-l">AI findings generated</div></div>
    <div class="stat-card md"><div class="stat-v">${accepted}/${rejected}</div><div class="stat-l">Findings accepted/rejected</div></div>
  `;
}

// ═══════════════════════════════════════════════════
//  INIT
// ═══════════════════════════════════════════════════
if (!NativeAI.isNative) {
  $('localPill').innerHTML = '<span class="pill-dot" style="background:var(--amber);box-shadow:none"></span> Browser preview';
  $('localPill').style.borderColor = 'rgba(251,191,36,0.35)';
  $('localPill').style.color = 'var(--amber)';
  $('localPill').style.background = 'var(--amber-dim)';
}
renderWorklist();
