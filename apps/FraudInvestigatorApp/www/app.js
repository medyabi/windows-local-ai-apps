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
    indexPolicy: (contentId, text) => call('indexPolicy', { contentId, prompt: text }),
    queryPolicy: (query) => call('queryPolicy', { prompt: query }),
  };
})();

const $ = id => document.getElementById(id);

// ═══════════════════════════════════════════════════
//  STATE
// ═══════════════════════════════════════════════════
let txns = [];               // {id, customerId, ts(Date), amount, currency, type, sender, receiver, receiverName, receiverBic, country, purpose, merchant, channel}
let profiles = {};           // customerId -> {name, occupation, expectedMonthlyVolume, riskRating, pep}
let customers = {};         // customerId -> computed profile (see analyzeAll)
let cases = [];             // {id, customerId, riskLevel, status, alerts, notes, created}
let policies = {};          // contentId -> {name, fullText}
let policyChunkCount = 0;
let currentCustomerId = null;
let copilotHistory = [];
let copilotBusy = false;
let caseCounter = 1;

// ═══════════════════════════════════════════════════
//  VIEW SWITCHING
// ═══════════════════════════════════════════════════
function showView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  $('view-' + name).classList.add('active');
  const navItem = document.querySelector('.nav-item[data-view="' + name + '"]');
  if (navItem) navItem.classList.add('active');
  if (name === 'cases') renderCasesList();
}

// ═══════════════════════════════════════════════════
//  CSV PARSING (transactions + customer profiles)
// ═══════════════════════════════════════════════════
// Accepts either the original 11-column schema or the enriched 14-column schema
// (...,receiver_name,receiver_bic,country,purpose,merchant,channel) — older files still load fine.
function parseTxnCSV(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const out = [];
  for (const line of lines) {
    const parts = line.split(',');
    if (parts.length < 11) continue;
    let id, customerId, timestamp, amount, currency, type, sender, receiver, receiverName, receiverBic, country, purpose, merchant, channel;
    if (parts.length >= 14) {
      [id, customerId, timestamp, amount, currency, type, sender, receiver, receiverName, receiverBic, country, purpose, merchant, channel] = parts;
    } else {
      [id, customerId, timestamp, amount, currency, type, sender, receiver, country, merchant, channel] = parts;
      receiverName = null; receiverBic = null; purpose = null;
    }
    const amt = parseFloat(amount);
    const ts = new Date(timestamp.replace(' ', 'T'));
    if (!id || id.toLowerCase() === 'transaction_id' || isNaN(amt) || isNaN(ts.getTime())) continue; // skip header
    out.push({ id, customerId, ts, amount: amt, currency, type, sender, receiver, receiverName, receiverBic, country, purpose, merchant, channel });
  }
  return out;
}

function parseProfileCSV(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const out = {};
  for (const line of lines) {
    const parts = line.split(',');
    if (parts.length < 6) continue;
    const [customerId, name, occupation, expectedVolume, riskRating, pep] = parts;
    if (!customerId || customerId.toLowerCase() === 'customer_id') continue;
    out[customerId] = { name, occupation, expectedMonthlyVolume: parseFloat(expectedVolume) || 0, riskRating, pep: (pep || '').toUpperCase() === 'YES' };
  }
  return out;
}

function handleTxnFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    txns = parseTxnCSV(e.target.result);
    analyzeAll();
    renderDashboard();
    toast(txns.length + ' transactions loaded and analyzed locally');
  };
  reader.readAsText(file);
}

function handleProfileFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    profiles = parseProfileCSV(e.target.result);
    if (txns.length) analyzeAll();
    renderDashboard();
    toast(Object.keys(profiles).length + ' customer profiles loaded locally');
  };
  reader.readAsText(file);
}

const zone = $('uploadZone');
zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag'); });
zone.addEventListener('dragleave', () => zone.classList.remove('drag'));
zone.addEventListener('drop', e => { e.preventDefault(); zone.classList.remove('drag'); if (e.dataTransfer.files[0]) handleTxnFile(e.dataTransfer.files[0]); });

const profileZone = $('profileUploadZone');
if (profileZone) {
  profileZone.addEventListener('dragover', e => { e.preventDefault(); profileZone.classList.add('drag'); });
  profileZone.addEventListener('dragleave', () => profileZone.classList.remove('drag'));
  profileZone.addEventListener('drop', e => { e.preventDefault(); profileZone.classList.remove('drag'); if (e.dataTransfer.files[0]) handleProfileFile(e.dataTransfer.files[0]); });
}

// ═══════════════════════════════════════════════════
//  DETECTION ENGINE — deterministic. The AI never computes these numbers.
// ═══════════════════════════════════════════════════
function analyzeAll() {
  customers = {};
  const byCustomer = groupBy(txns, t => t.customerId);

  // ── account-level mule/fan-in detection (across all customers) ──
  const byReceiver = groupBy(txns, t => t.receiver);
  const muleAccounts = new Set();
  for (const [acct, list] of Object.entries(byReceiver)) {
    const distinctSenders = new Set(list.map(t => t.customerId));
    if (distinctSenders.size >= 5) muleAccounts.add(acct);
  }

  for (const [customerId, list] of Object.entries(byCustomer)) {
    const sorted = [...list].sort((a, b) => a.ts - b.ts);
    const amounts = sorted.map(t => Math.abs(t.amount));
    const mean = avg(amounts);
    const sd = stddev(amounts, mean);

    const knownReceiversBefore = (txn, idx) => {
      const seen = new Set();
      for (let i = 0; i < idx; i++) seen.add(sorted[i].receiver);
      return seen;
    };
    const knownCountriesBefore = (idx) => {
      const seen = new Set();
      for (let i = 0; i < idx; i++) seen.add(sorted[i].country);
      return seen;
    };

    const factors = []; // {key, label, points, evidence: []}
    let points = { rapid: 0, newBen: 0, amountAnom: 0, geo: 0, structuring: 0, dormancy: 0, mule: 0 };

    // amount anomaly (z-score)
    const amountAnomalies = [];
    sorted.forEach(t => {
      if (sd > 0) {
        const z = (Math.abs(t.amount) - mean) / sd;
        if (z > 2.5 && amounts.length >= 4) amountAnomalies.push(t);
      }
    });
    if (amountAnomalies.length) {
      points.amountAnom = 20;
      factors.push({ key: 'amountAnom', label: 'Unusual transaction amount', points: 20,
        evidence: amountAnomalies.map(t => fmtEv(t)) });
    }

    // new beneficiary + large amount
    const newBenLarge = [];
    sorted.forEach((t, i) => {
      if (i < 2) return; // need some history first
      const known = knownReceiversBefore(t, i);
      if (!known.has(t.receiver) && Math.abs(t.amount) >= Math.max(3000, mean * 1.5)) newBenLarge.push(t);
    });
    if (newBenLarge.length) {
      points.newBen = 25;
      factors.push({ key: 'newBen', label: 'Large transfer to new beneficiary', points: 25,
        evidence: newBenLarge.map(t => fmtEv(t) + ' — first payment to this beneficiary') });
    }

    // geographic anomaly
    const geoAnomalies = [];
    sorted.forEach((t, i) => {
      if (i < 3) return;
      const knownC = knownCountriesBefore(i);
      if (knownC.size >= 1 && !knownC.has(t.country)) geoAnomalies.push(t);
    });
    if (geoAnomalies.length) {
      points.geo = 20;
      factors.push({ key: 'geo', label: 'Geographic anomaly', points: 20,
        evidence: geoAnomalies.map(t => fmtEv(t) + ' — new country for this customer') });
    }

    // rapid fund movement (velocity): 3+ txns within 60 min combined >= 15000
    let rapidChain = null;
    for (let i = 0; i < sorted.length; i++) {
      const windowTxns = [sorted[i]];
      for (let j = i + 1; j < sorted.length; j++) {
        if ((sorted[j].ts - sorted[i].ts) / 60000 <= 60) windowTxns.push(sorted[j]);
        else break;
      }
      const sum = windowTxns.reduce((s, t) => s + Math.abs(t.amount), 0);
      if (windowTxns.length >= 3 && sum >= 15000) { rapidChain = windowTxns; break; }
    }
    if (rapidChain) {
      points.rapid = 35;
      factors.push({ key: 'rapid', label: 'Rapid fund movement', points: 35,
        evidence: rapidChain.map(t => fmtEv(t)) });
    }

    // structuring: 3+ txns each 4500-4999.99 within 7 days
    let structChain = null;
    const nearThreshold = sorted.filter(t => Math.abs(t.amount) >= 4500 && Math.abs(t.amount) < 5000);
    for (let i = 0; i < nearThreshold.length; i++) {
      const windowTxns = [nearThreshold[i]];
      for (let j = i + 1; j < nearThreshold.length; j++) {
        if ((nearThreshold[j].ts - nearThreshold[i].ts) / 86400000 <= 7) windowTxns.push(nearThreshold[j]);
      }
      if (windowTxns.length >= 3) { structChain = windowTxns; break; }
    }
    if (structChain) {
      points.structuring = 30;
      factors.push({ key: 'structuring', label: 'Possible structuring (amounts just under reporting threshold)', points: 30,
        evidence: structChain.map(t => fmtEv(t)) });
    }

    // dormancy then spike
    let dormancyEvt = null;
    for (let i = 1; i < sorted.length; i++) {
      const gapDays = (sorted[i].ts - sorted[i - 1].ts) / 86400000;
      if (gapDays > 60 && mean > 0 && Math.abs(sorted[i].amount) > mean * 3) { dormancyEvt = sorted[i]; break; }
    }
    if (dormancyEvt) {
      points.dormancy = 25;
      factors.push({ key: 'dormancy', label: 'Dormant account followed by large transaction', points: 25,
        evidence: [fmtEv(dormancyEvt)] });
    }

    // mule / fan-in (this customer's account IS a mule receiver)
    const customerAccounts = new Set(sorted.map(t => t.sender));
    const isMule = [...customerAccounts].some(a => muleAccounts.has(a)) ||
      [...new Set(sorted.map(t => t.receiver))].some(a => muleAccounts.has(a));
    if (isMule) {
      points.mule = 35;
      factors.push({ key: 'mule', label: 'Account receiving from many unrelated customers (fan-in)', points: 35,
        evidence: ['Account associated with this customer received funds from 5+ distinct customers'] });
    }

    // declared vs. actual volume — only possible because we joined the customer profile table.
    // This catches anomalies pure transaction-history inference can't: a brand-new customer with
    // no prior baseline still has a *declared* KYC expectation to compare against.
    const profile = profiles[customerId] || null;
    const monthsSpanned = Math.max(1, (sorted[sorted.length - 1].ts - sorted[0].ts) / (30 * 86400000));
    const actualMonthlyVolume = amounts.reduce((a, b) => a + b, 0) / monthsSpanned;
    points.declaredVolume = 0;
    if (profile && profile.expectedMonthlyVolume > 0 && actualMonthlyVolume > profile.expectedMonthlyVolume * 2.5) {
      points.declaredVolume = 20;
      factors.push({ key: 'declaredVolume', label: 'Activity significantly exceeds declared KYC expectation', points: 20,
        evidence: ['Declared expected monthly volume: ' + eur(profile.expectedMonthlyVolume) +
          ' — actual observed: ' + eur(actualMonthlyVolume) + '/month (' + Math.round(actualMonthlyVolume / profile.expectedMonthlyVolume) + 'x declared)'] });
    }

    let riskScore = Math.min(100, Object.values(points).reduce((a, b) => a + b, 0));
    // a PEP (politically exposed person) flag doesn't itself indicate wrongdoing, but combined
    // with an already-triggered behavioral anomaly it raises the review priority — never scored alone.
    if (profile && profile.pep && riskScore > 0) riskScore = Math.min(100, riskScore + 10);

    customers[customerId] = {
      id: customerId,
      txns: sorted,
      riskScore,
      factors,
      profile,
      totalAmount: amounts.reduce((a, b) => a + b, 0),
      actualMonthlyVolume,
      mean, sd,
      topFactor: factors.length ? factors.reduce((a, b) => a.points > b.points ? a : b) : null,
      rapidChain,
    };
  }
}

function fmtEv(t) {
  const who = t.receiverName ? t.receiverName + (t.receiverBic && t.receiverBic !== 'N/A' ? ' (BIC ' + t.receiverBic + ')' : '') : t.receiver;
  const purpose = t.purpose && t.purpose !== 'N/A' ? ', purpose: "' + t.purpose + '"' : '';
  return t.ts.toISOString().slice(0, 16).replace('T', ' ') + '  ' + categorizeTxn(t) + '  ' + eur(Math.abs(t.amount)) + '  → ' + who + '  (' + t.country + ')' + purpose;
}
function categorizeTxn(t) { return t.type || 'TRANSFER'; }

function groupBy(arr, keyFn) { const o = {}; arr.forEach(x => { const k = keyFn(x); (o[k] = o[k] || []).push(x); }); return o; }
function avg(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0; }
function stddev(arr, mean) { if (arr.length < 2) return 0; const v = arr.reduce((s, x) => s + (x - mean) ** 2, 0) / arr.length; return Math.sqrt(v); }
function eur(n) { return '€' + Math.round(n).toLocaleString('en-IE'); }

// ═══════════════════════════════════════════════════
//  DASHBOARD RENDERING
// ═══════════════════════════════════════════════════
function renderDashboard() {
  $('statCustomers').textContent = Object.keys(customers).length.toLocaleString();
  $('statTxns').textContent = txns.length.toLocaleString();
  const flagged = Object.values(customers).filter(c => c.riskScore >= 50);
  $('statAlerts').textContent = flagged.reduce((s, c) => s + c.factors.length, 0);
  $('statCases').textContent = cases.length;

  const ranked = Object.values(customers).filter(c => c.riskScore > 0).sort((a, b) => b.riskScore - a.riskScore).slice(0, 12);
  if (!ranked.length) {
    $('highRiskBody').innerHTML = '<tr><td colspan="4" class="empty-note">No risk indicators detected in this dataset.</td></tr>';
    return;
  }
  $('highRiskBody').innerHTML = ranked.map(c => `
    <tr class="clickable" onclick="openCustomer('${c.id}')">
      <td>${c.id}${c.profile ? ' — ' + escXml(c.profile.name) : ''}${c.profile && c.profile.pep ? ' <span class="risk-badge risk-med" style="font-size:9px;">PEP</span>' : ''}</td>
      <td><span class="risk-badge ${riskCls(c.riskScore)}">${c.riskScore}/100</span></td>
      <td>${c.topFactor ? c.topFactor.label : '—'}</td>
      <td>${eur(c.totalAmount)}</td>
    </tr>`).join('');
}
function riskCls(score) { return score >= 70 ? 'risk-high' : score >= 40 ? 'risk-med' : 'risk-low'; }

// ═══════════════════════════════════════════════════
//  DEMO DATASET
// ═══════════════════════════════════════════════════
function loadDemoDataset() {
  Promise.all([
    fetch('sample-transactions.csv').then(r => r.text()),
    fetch('customer-profiles.csv').then(r => r.text()).catch(() => ''),
  ]).then(([txnText, profileText]) => {
    txns = parseTxnCSV(txnText);
    if (profileText) profiles = parseProfileCSV(profileText);
    analyzeAll();
    renderDashboard();
    toast(txns.length + ' demo transactions + ' + Object.keys(profiles).length + ' customer profiles loaded and analyzed locally');
  }).catch(e => toast('Could not load demo dataset: ' + e.message, 'err'));
}

// ═══════════════════════════════════════════════════
//  CUSTOMER DETAIL
// ═══════════════════════════════════════════════════
function openCustomer(id) {
  currentCustomerId = id;
  const c = customers[id];
  if (!c) return;
  showView('customer');
  $('custDetailId').textContent = id + (c.profile ? ' — ' + c.profile.name : '');
  const subParts = [c.txns.length + ' transactions', 'total volume ' + eur(c.totalAmount)];
  if (c.profile) {
    subParts.push(c.profile.occupation);
    subParts.push('declared risk: ' + c.profile.riskRating);
    if (c.profile.pep) subParts.push('⚠ PEP');
    subParts.push('actual ' + eur(c.actualMonthlyVolume) + '/mo vs declared ' + eur(c.profile.expectedMonthlyVolume) + '/mo');
  }
  $('custDetailSub').textContent = subParts.join(' · ');
  $('riskScoreNum').textContent = c.riskScore;
  $('riskScoreNum').className = 'risk-score-num ' + (c.riskScore >= 70 ? 'high' : c.riskScore >= 40 ? 'med' : 'low');
  $('riskFactors').innerHTML = c.factors.length
    ? c.factors.map(f => `
      <div class="rf-row">
        <div class="rf-label">${f.label}</div>
        <div class="rf-bar-track"><div class="rf-bar-fill" style="width:${f.points}%"></div></div>
      </div>`).join('')
    : '<div class="empty-note">No risk factors triggered.</div>';

  $('evidenceList').innerHTML = c.factors.length
    ? c.factors.map(f => `
      <div class="evidence-card">
        <div class="ev-title">${f.label}</div>
        <div class="ev-detail">${f.evidence.slice(0, 5).join('\n')}</div>
      </div>`).join('')
    : '<div class="empty-note">No evidence — this customer\'s activity matches their historical pattern.</div>';

  $('custAssessment').textContent = '—';
  $('reportBox').classList.remove('visible');
  $('accountDetailBox').classList.remove('visible');
  renderGraph(c);

  $('copilotContext').textContent = 'Investigating: ' + id + ' (risk ' + c.riskScore + '/100)';
  clearCopilot();

  runCustomerAssessment(c);
}

async function runCustomerAssessment(c) {
  $('custAssessment').textContent = 'Analyzing on-device…';
  try {
    const facts = buildCustomerFacts(c);
    const sys = `You are a fraud/AML analyst assistant running locally on the user's device.
Explain in 3-5 sentences why this customer's activity was flagged, using ONLY the facts given. Never state definitively that this is fraud — use language like "potentially suspicious" or "warrants review". Plain language, no markdown.`;
    const prompt = sys + '\n\nFACTS:\n' + facts + '\n\nExplanation:';
    const gen = await callLocal(prompt);
    $('custAssessment').textContent = gen;
  } catch (e) {
    $('custAssessment').textContent = 'AI explanation unavailable: ' + e.message;
  }
}

function buildCustomerFacts(c) {
  const lines = [];
  lines.push('Customer ' + c.id + ' — risk score ' + c.riskScore + '/100.');
  if (c.profile) {
    lines.push('Declared profile: occupation ' + c.profile.occupation + ', declared KYC risk rating ' + c.profile.riskRating +
      (c.profile.pep ? ', flagged as a politically exposed person (PEP)' : '') +
      ', declared expected volume ' + eur(c.profile.expectedMonthlyVolume) + '/month vs. actual observed ' + eur(c.actualMonthlyVolume) + '/month.');
  }
  lines.push('Total transaction volume: ' + eur(c.totalAmount) + ' across ' + c.txns.length + ' transactions.');
  c.factors.forEach(f => {
    lines.push('- ' + f.label + ': ' + f.evidence.slice(0, 3).join('; '));
  });
  return lines.join('\n');
}

// generic local-model call: native bridge, no Foundry Local fallback in this app (matches the
// "zero cloud, zero fallback" story — see project memory / README).
async function callLocal(prompt) {
  const gen = await NativeAI.generate(prompt);
  return (gen.text || '').trim();
}

// ═══════════════════════════════════════════════════
//  TRANSACTION CHAIN GRAPH (SVG) — curved flow paths, animated money-movement
//  pulses, glowing risk halos. Pure SVG/CSS, no external graph library.
// ═══════════════════════════════════════════════════
function renderGraph(c) {
  const wrap = $('graphWrap');
  const chain = c.rapidChain || c.txns.slice(0, 4);
  if (!chain || !chain.length) { wrap.innerHTML = '<div class="empty-note">No transaction chain to display.</div>'; return; }

  // Build node sequence: customer -> receiver1 -> receiver2 ...
  const nodeIds = [c.id];
  chain.forEach(t => { if (nodeIds[nodeIds.length - 1] !== t.receiver) nodeIds.push(t.receiver); });
  const n = nodeIds.length;

  const nodeW = 156, nodeH = 66, gapX = 110, baseY = 96;
  const totalW = n * nodeW + (n - 1) * gapX + 40;
  const svgH = 200;

  // gentle zigzag so the flow reads as an organic path, not a rigid grid
  const yOff = (i) => (i % 2 === 0 ? -20 : 22);
  const nx = (i) => 20 + i * (nodeW + gapX);
  const ny = (i) => baseY + yOff(i) - nodeH / 2;
  const cx = (i) => nx(i) + nodeW / 2;
  const cy = (i) => baseY + yOff(i);

  let defs = `<defs>
    <linearGradient id="nodeGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="var(--bg3)"/><stop offset="100%" stop-color="var(--bg2)"/>
    </linearGradient>
    <linearGradient id="originGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="rgba(96,165,250,0.16)"/><stop offset="100%" stop-color="var(--bg2)"/>
    </linearGradient>
    <linearGradient id="flowGrad" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="var(--blue)"/><stop offset="100%" stop-color="var(--accent)"/>
    </linearGradient>
    <radialGradient id="haloGrad"><stop offset="0%" stop-color="var(--accent)" stop-opacity="0.55"/><stop offset="100%" stop-color="var(--accent)" stop-opacity="0"/></radialGradient>
    <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="var(--accent)"/>
    </marker>
  </defs>`;

  let edgesSvg = '', nodesSvg = '';

  // ── edges: curved bezier + amount pill + elapsed-time label + animated pulse ──
  for (let i = 0; i < n - 1; i++) {
    const x1 = nx(i) + nodeW, y1 = cy(i), x2 = nx(i + 1), y2 = cy(i + 1);
    const midX = (x1 + x2) / 2;
    const pathId = 'edgepath' + i;
    const d = `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`;
    const t = chain[i];
    const amt = t ? Math.abs(t.amount) : 0;
    const strokeW = Math.min(6, Math.max(2, Math.log10(amt + 1) * 1.4));
    const elapsedMin = (i > 0 && chain[i - 1]) ? Math.round((t.ts - chain[i - 1].ts) / 60000) : null;

    edgesSvg += `<path id="${pathId}" class="edge-path" d="${d}" stroke="url(#flowGrad)" stroke-width="${strokeW}" marker-end="url(#arrow)" opacity="0.85"/>`;
    edgesSvg += `<circle r="3.5" class="flow-pulse" fill="var(--accent)"><animateMotion dur="${(2.2 + i * 0.3).toFixed(1)}s" repeatCount="indefinite"><mpath href="#${pathId}"/></animateMotion></circle>`;

    const label = t ? eur(amt) : '';
    const pillW = Math.max(56, label.length * 7.2 + 16);
    const pillX = midX - pillW / 2, pillY = (y1 + y2) / 2 - 30;
    edgesSvg += `<g class="edge-amount-pill">
      <rect x="${pillX}" y="${pillY}" width="${pillW}" height="20" rx="10"/>
      <text x="${midX}" y="${pillY + 14}" text-anchor="middle" font-size="10.5" fill="var(--accent)">${escXml(label)}</text>
    </g>`;
    if (elapsedMin !== null) {
      edgesSvg += `<text class="edge-time-label" x="${midX}" y="${pillY - 5}" text-anchor="middle">+${elapsedMin} min later</text>`;
    }
  }

  // ── nodes ──
  nodeIds.forEach((nid, i) => {
    const x = nx(i), y = ny(i), midY = cy(i);
    const isOrigin = i === 0;
    const flagged = !isOrigin;
    const role = isOrigin ? 'Customer · Origin' : (i === n - 1 ? 'Destination' : 'Hop ' + i);
    const country = isOrigin ? null : (chain[i - 1] ? chain[i - 1].country : null);
    const icon = isOrigin ? '👤' : '🏦';
    const label = nid.length > 13 ? nid.slice(0, 11) + '…' : nid;

    if (flagged) {
      edgesSvg += `<circle class="halo" cx="${x + nodeW / 2}" cy="${midY}" r="${nodeH * 0.72}" fill="url(#haloGrad)" style="animation-delay:${(i * 0.3).toFixed(1)}s"/>`;
    }

    nodesSvg += `<g class="gnode ${isOrigin ? 'origin' : ''} ${flagged ? 'flagged' : ''}" onclick="showAccountDetail('${escAttr(nid)}')">
      <rect class="node-card" x="${x}" y="${y}" width="${nodeW}" height="${nodeH}" rx="10"/>
      <rect class="node-accent" x="${x}" y="${y}" width="4" height="${nodeH}" rx="2" fill="${isOrigin ? 'var(--blue)' : 'var(--accent)'}"/>
      <text class="node-role" x="${x + 16}" y="${y + 17}">${escXml(role)}</text>
      <line x1="${x + 14}" y1="${y + 24}" x2="${x + nodeW - 14}" y2="${y + 24}" stroke="var(--border)" stroke-width="1"/>
      <text x="${x + 15}" y="${y + 44}" font-size="15">${icon}</text>
      <text class="node-title" x="${x + 36}" y="${y + 43}">${escXml(label)}</text>
      ${country ? `<text class="node-country" x="${x + 16}" y="${y + 59}">📍 ${escXml(country)}</text>` : `<text class="node-sub" x="${x + 16}" y="${y + 59}">this customer</text>`}
    </g>`;
  });

  wrap.innerHTML = `<svg width="${totalW}" height="${svgH}" viewBox="0 0 ${totalW} ${svgH}">${defs}${edgesSvg}${nodesSvg}</svg>`;
}

function showAccountDetail(acct) {
  const involved = (customers[currentCustomerId] ? customers[currentCustomerId].txns : txns)
    .filter(t => t.sender === acct || t.receiver === acct);
  const allForAcct = txns.filter(t => t.sender === acct || t.receiver === acct).sort((a, b) => a.ts - b.ts);
  const firstSeen = allForAcct.length ? allForAcct[0].ts.toISOString().slice(0, 10) : '—';
  const incoming = allForAcct.filter(t => t.receiver === acct).reduce((s, t) => s + Math.abs(t.amount), 0);
  const outgoing = allForAcct.filter(t => t.sender === acct).reduce((s, t) => s + Math.abs(t.amount), 0);
  const country = allForAcct.length ? (allForAcct.find(t => t.receiver === acct) || allForAcct[0]).country : '—';
  const distinctSenders = new Set(allForAcct.filter(t => t.receiver === acct).map(t => t.customerId)).size;

  const box = $('accountDetailBox');
  box.innerHTML = `
    <div class="adk">Account</div><div class="adv">${escXml(acct)}</div>
    <div class="adk">Country</div><div class="adv">${escXml(country)}</div>
    <div class="adk">First seen in dataset</div><div class="adv">${firstSeen}</div>
    <div class="adk">Incoming / Outgoing</div><div class="adv">${eur(incoming)} / ${eur(outgoing)}</div>
    <div class="adk">Distinct customers sending to this account</div><div class="adv">${distinctSenders}${distinctSenders >= 5 ? ' ⚠ possible mule account' : ''}</div>`;
  box.classList.add('visible');
}

function escXml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function escAttr(s) { return String(s).replace(/'/g, "\\'"); }

// ═══════════════════════════════════════════════════
//  INVESTIGATION REPORT
// ═══════════════════════════════════════════════════
async function generateReport() {
  const c = customers[currentCustomerId];
  if (!c) return;
  const btn = $('btnReport');
  btn.disabled = true;
  btn.textContent = 'Generating…';
  try {
    const facts = buildCustomerFacts(c);
    const sys = `You are a fraud/AML analyst assistant writing an investigation report, running locally on the user's device.
Use ONLY the facts given. Never state definitively that this is fraud — always "potentially suspicious" / "warrants review". This assists a human investigator; it does not make the determination.
Respond with ONLY one valid JSON object, no markdown:
{"executive_summary":"<2-3 sentences>","key_findings":["<finding 1>","..."],"recommended_actions":["<action 1>","..."]}`;
    const prompt = sys + '\n\nFACTS:\n' + facts + '\n\nJSON:';
    let raw = await callLocal(prompt);
    raw = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    let report;
    try { report = JSON.parse(raw); } catch (e) { report = { executive_summary: raw, key_findings: [], recommended_actions: [] }; }

    const box = $('reportBox');
    box.innerHTML = `
      <h3>Investigation Report — ${c.id}</h3>
      <div>Generated ${new Date().toLocaleString()} · Risk score ${c.riskScore}/100</div>
      <h3>Executive Summary</h3>
      <div>${escXml(report.executive_summary || '')}</div>
      <h3>Key Findings</h3>
      <div>${(report.key_findings || []).map(f => '• ' + escXml(f)).join('\n')}</div>
      <h3>Supporting Evidence</h3>
      <div>${c.factors.map(f => f.label + ':\n  ' + f.evidence.slice(0, 3).join('\n  ')).join('\n\n')}</div>
      <h3>Recommended Analyst Actions</h3>
      <div>${(report.recommended_actions || []).map(a => '• ' + escXml(a)).join('\n')}</div>`;
    box.classList.add('visible');
    box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (e) {
    toast('Report generation failed: ' + e.message, 'err');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Generate Investigation Report';
  }
}

// ═══════════════════════════════════════════════════
//  CASE MANAGEMENT
// ═══════════════════════════════════════════════════
function createCase() {
  const c = customers[currentCustomerId];
  if (!c) return;
  const existing = cases.find(cs => cs.customerId === c.id && cs.status !== 'closed');
  if (existing) { toast('A case already exists for this customer', 'err'); return; }
  const newCase = {
    id: '2026-' + String(caseCounter++).padStart(5, '0'),
    customerId: c.id,
    riskLevel: c.riskScore >= 70 ? 'HIGH' : c.riskScore >= 40 ? 'MEDIUM' : 'LOW',
    status: 'investigation',
    alerts: c.factors.map(f => f.label),
    notes: '',
    created: new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' }),
  };
  cases.push(newCase);
  toast('Case ' + newCase.id + ' created', 'ok');
  renderDashboard();
}

function renderCasesList() {
  const list = $('casesList');
  if (!cases.length) {
    list.innerHTML = '<div class="empty-note">No cases created yet — open a high-risk customer and click "Create Case".</div>';
    $('caseDetailPanel').style.display = 'none';
    return;
  }
  list.innerHTML = cases.map((cs, i) => `
    <div class="case-card" onclick="openCaseDetail(${i})">
      <div class="case-top">
        <span class="case-id">Case #${cs.id}</span>
        <span class="case-status ${cs.status === 'closed' ? 'closed' : ''}">${cs.status}</span>
      </div>
      <div class="case-meta">
        <span>Customer: ${cs.customerId}</span>
        <span>Risk: ${cs.riskLevel}</span>
        <span>Created: ${cs.created}</span>
      </div>
    </div>`).join('');
}

function openCaseDetail(i) {
  const cs = cases[i];
  const panel = $('caseDetailPanel');
  panel.style.display = 'block';
  panel.innerHTML = `
    <div class="sh">Case #${cs.id}</div>
    <div style="font-size:13px;margin-bottom:10px;">Customer <b>${cs.customerId}</b> · Risk level <b>${cs.riskLevel}</b></div>
    <div style="font-size:11px;color:var(--text3);font-family:var(--mono);text-transform:uppercase;margin-bottom:4px;">Alerts</div>
    <div style="font-size:12px;margin-bottom:10px;">${cs.alerts.map(a => '✓ ' + escXml(a)).join('<br>') || '—'}</div>
    <div style="font-size:11px;color:var(--text3);font-family:var(--mono);text-transform:uppercase;">Status</div>
    <select class="case-status-select" onchange="cases[${i}].status=this.value; renderCasesList();">
      <option value="investigation" ${cs.status === 'investigation' ? 'selected' : ''}>Investigation</option>
      <option value="closed-confirmed" ${cs.status === 'closed-confirmed' ? 'selected' : ''}>Closed — Confirmed</option>
      <option value="closed-false-positive" ${cs.status === 'closed-false-positive' ? 'selected' : ''}>Closed — False Positive</option>
    </select>
    <div style="font-size:11px;color:var(--text3);font-family:var(--mono);text-transform:uppercase;margin-top:10px;">Notes</div>
    <textarea class="case-notes" oninput="cases[${i}].notes=this.value" placeholder="Analyst notes...">${escXml(cs.notes)}</textarea>
    <button class="btn" style="margin-top:10px;" onclick="openCustomer('${cs.customerId}')">View customer</button>`;
}

// ═══════════════════════════════════════════════════
//  POLICY LIBRARY (RAG)
// ═══════════════════════════════════════════════════
function chunkText(text, maxLen) {
  maxLen = maxLen || 800;
  const paras = text.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
  const chunks = [];
  let cur = '';
  for (const p of paras) {
    if ((cur + '\n\n' + p).length > maxLen && cur) { chunks.push(cur); cur = p; }
    else cur = cur ? cur + '\n\n' + p : p;
  }
  if (cur) chunks.push(cur);
  return chunks.length ? chunks : [text];
}

async function indexPolicyDoc(name, fullText) {
  const chunks = chunkText(fullText);
  for (let i = 0; i < chunks.length; i++) {
    const contentId = name + '#' + i;
    policies[contentId] = { name, text: chunks[i] };
    await NativeAI.indexPolicy(contentId, chunks[i]);
    policyChunkCount++;
  }
}

async function handlePolicyFiles(fileList) {
  const files = Array.from(fileList);
  for (const file of files) {
    const row = addPolicyRow(file.name, 'busy');
    try {
      const b64 = await fileToBase64(file);
      const r = await NativeAI.pdfText(b64);
      await indexPolicyDoc(file.name, r.text || '');
      row.querySelector('.policy-doc-status').textContent = '✓ indexed';
      row.querySelector('.policy-doc-status').className = 'policy-doc-status ok';
    } catch (e) {
      row.querySelector('.policy-doc-status').textContent = '✗ ' + e.message;
    }
  }
}

function addPolicyRow(name, status) {
  const list = $('policyDocList');
  const empty = list.querySelector('.empty-note');
  if (empty) empty.remove();
  const row = document.createElement('div');
  row.className = 'policy-doc-row';
  row.innerHTML = `<div class="policy-doc-icon">📄</div><div class="policy-doc-name">${escXml(name)}</div><span class="policy-doc-status busy">⟳ indexing…</span>`;
  list.appendChild(row);
  return row;
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

const policyZone = $('policyUploadZone');
policyZone.addEventListener('dragover', e => { e.preventDefault(); policyZone.classList.add('drag'); });
policyZone.addEventListener('dragleave', () => policyZone.classList.remove('drag'));
policyZone.addEventListener('drop', e => { e.preventDefault(); policyZone.classList.remove('drag'); if (e.dataTransfer.files.length) handlePolicyFiles(e.dataTransfer.files); });

async function loadDemoPolicies() {
  const files = ['AML_Policy.pdf', 'KYC_Policy.pdf', 'Transaction_Monitoring_Procedures.pdf', 'Fraud_Investigation_Handbook.pdf'];
  for (const name of files) {
    const row = addPolicyRow(name, 'busy');
    try {
      const buf = await fetch('policies/' + name).then(r => r.arrayBuffer());
      const b64 = arrayBufferToBase64(buf);
      const r = await NativeAI.pdfText(b64);
      await indexPolicyDoc(name, r.text || '');
      row.querySelector('.policy-doc-status').textContent = '✓ indexed';
      row.querySelector('.policy-doc-status').className = 'policy-doc-status ok';
    } catch (e) {
      row.querySelector('.policy-doc-status').textContent = '✗ ' + e.message;
    }
  }
  toast('Demo policy library indexed locally', 'ok');
}

function arrayBufferToBase64(buf) {
  return btoa(new Uint8Array(buf).reduce((s, b) => s + String.fromCharCode(b), ''));
}

async function retrievePolicyContext(query) {
  try {
    const r = await NativeAI.queryPolicy(query);
    const matches = JSON.parse(r.text || '[]');
    const good = matches.filter(m => policies[m.contentId]);
    if (!good.length) return null;
    const snippets = good.slice(0, 3).map(m => {
      const chunk = policies[m.contentId].text;
      const snippet = m.length > 0 ? chunk.substring(m.offset, m.offset + m.length) : chunk.slice(0, 200);
      return { source: policies[m.contentId].name, text: snippet || chunk.slice(0, 200) };
    });
    return snippets;
  } catch (e) {
    return null;
  }
}

// ═══════════════════════════════════════════════════
//  NATURAL-LANGUAGE INVESTIGATION QUERY
// ═══════════════════════════════════════════════════
function setNLQ(text) { $('nlqInput').value = text; runNLQuery(); }

async function runNLQuery() {
  const q = $('nlqInput').value.trim();
  if (!q) return;
  if (!txns.length) { toast('Load a dataset first', 'err'); return; }
  const btn = $('nlqBtn');
  btn.disabled = true; btn.textContent = '…';
  try {
    const sys = `You translate a fraud analyst's natural-language question into ONE structured query. Respond with ONLY one JSON object, no markdown, choosing "type" from exactly these options:
- "large_new_beneficiary": {"type":"large_new_beneficiary","minAmount":number}
- "fan_in": {"type":"fan_in","minSenders":number}
- "after_large_payment": {"type":"after_large_payment","minAmount":number,"withinMinutes":number}
- "behavior_deviation": {"type":"behavior_deviation"}
- "amount_filter": {"type":"amount_filter","minAmount":number,"maxAmount":number|null,"country":string|null}
Pick the closest match. Use reasonable defaults if not specified (minAmount 10000, minSenders 5, withinMinutes 30).`;
    const prompt = sys + '\n\nQuestion: ' + q + '\nJSON:';
    let raw = await callLocal(prompt);
    raw = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    const spec = JSON.parse(raw);
    const { summary, rows } = executeStructuredQuery(spec);
    $('nlqSummary').textContent = summary;
    $('nlqTable').innerHTML = renderResultTable(rows);
    $('nlqResult').classList.add('visible');
  } catch (e) {
    $('nlqSummary').textContent = 'Could not run that query: ' + e.message;
    $('nlqTable').innerHTML = '';
    $('nlqResult').classList.add('visible');
  } finally {
    btn.disabled = false; btn.textContent = 'Search';
  }
}

function executeStructuredQuery(spec) {
  let rows = [];
  if (spec.type === 'large_new_beneficiary') {
    const min = spec.minAmount || 10000;
    Object.values(customers).forEach(c => {
      c.factors.filter(f => f.key === 'newBen').forEach(f => {
        c.txns.forEach((t, i) => {
          if (Math.abs(t.amount) >= min) {
            const knownBefore = new Set(c.txns.slice(0, i).map(x => x.receiver));
            if (!knownBefore.has(t.receiver)) rows.push(t);
          }
        });
      });
    });
    return { summary: rows.length + ' transaction(s) above ' + eur(min) + ' to a newly observed beneficiary.', rows };
  }
  if (spec.type === 'fan_in') {
    const min = spec.minSenders || 5;
    const byReceiver = groupBy(txns, t => t.receiver);
    const accounts = Object.entries(byReceiver).filter(([, list]) => new Set(list.map(t => t.customerId)).size >= min);
    rows = accounts.flatMap(([acct, list]) => list.slice(0, 3));
    return { summary: accounts.length + ' account(s) received funds from ' + min + '+ unrelated customers. Sample transactions below.', rows };
  }
  if (spec.type === 'after_large_payment') {
    const min = spec.minAmount || 5000; // wait, reuse: large incoming payment threshold
    const within = spec.withinMinutes || 30;
    const bigIncoming = txns.filter(t => Math.abs(t.amount) >= (spec.minAmount || 10000));
    bigIncoming.forEach(big => {
      txns.forEach(t => {
        if (t.id !== big.id && t.customerId === big.customerId && t.ts > big.ts && (t.ts - big.ts) / 60000 <= within) rows.push(t);
      });
    });
    return { summary: rows.length + ' transaction(s) occurring within ' + within + ' minutes of a large incoming payment.', rows };
  }
  if (spec.type === 'behavior_deviation') {
    const flagged = Object.values(customers).filter(c => c.riskScore >= 40);
    rows = flagged.flatMap(c => c.txns.slice(-2));
    return { summary: flagged.length + ' customer(s) whose current activity differs significantly from their history.', rows };
  }
  // amount_filter / fallback
  const min = spec.minAmount || 0, max = spec.maxAmount || Infinity;
  rows = txns.filter(t => Math.abs(t.amount) >= min && Math.abs(t.amount) <= max && (!spec.country || t.country === spec.country));
  return { summary: rows.length + ' matching transaction(s).', rows };
}

function renderResultTable(rows) {
  if (!rows.length) return '<tbody><tr><td class="empty-note">No matches.</td></tr></tbody>';
  const shown = rows.slice(0, 25);
  return `<thead><tr><th>Date</th><th>Customer</th><th>Amount</th><th>Route</th><th>Country</th></tr></thead>
    <tbody>${shown.map(t => `<tr class="clickable" onclick="openCustomer('${escAttr(t.customerId)}')">
      <td>${t.ts.toISOString().slice(0, 16).replace('T', ' ')}</td><td>${escXml(t.customerId)}</td>
      <td>${eur(Math.abs(t.amount))}</td><td>${escXml(t.sender)} → ${escXml(t.receiver)}</td><td>${escXml(t.country)}</td>
    </tr>`).join('')}</tbody>`;
}

// ═══════════════════════════════════════════════════
//  INVESTIGATION COPILOT (chat)
// ═══════════════════════════════════════════════════
function handleCopilotKey(e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendCopilotMessage(); } }

function clearCopilot() {
  copilotHistory = [];
  $('copilotMessages').innerHTML = '<div class="copilot-empty">Ask a question about this customer\'s evidence, or say "show me the transaction chain".</div>';
}

function appendCopilotMessage(role, text, cite) {
  const box = $('copilotMessages');
  const empty = box.querySelector('.copilot-empty');
  if (empty) empty.remove();
  const div = document.createElement('div');
  div.className = 'chat-msg ' + role;
  div.innerHTML = '<div class="chat-bubble"></div>' + (cite ? '<div class="chat-cite">' + escXml(cite) + '</div>' : '');
  div.querySelector('.chat-bubble').textContent = text;
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
  return div;
}

async function sendCopilotMessage() {
  if (copilotBusy) return;
  const input = $('copilotInput');
  const question = input.value.trim();
  if (!question) return;
  copilotBusy = true;
  $('copilotSend').disabled = true;
  input.value = '';
  appendCopilotMessage('user', question);
  const thinking = appendCopilotMessage('assistant', 'Thinking…');
  thinking.classList.add('thinking');

  try {
    const c = currentCustomerId ? customers[currentCustomerId] : null;
    const policyCtx = await retrievePolicyContext(question);

    let context = c ? buildCustomerFacts(c) : 'No specific customer selected. Dataset: ' + txns.length + ' transactions, ' + Object.keys(customers).length + ' customers, ' +
      Object.values(customers).filter(x => x.riskScore >= 50).length + ' flagged as elevated risk.';

    if (c) {
      const recent = c.txns.slice(-15).map(t => t.ts.toISOString().slice(0, 16).replace('T', ' ') + ' | ' + categorizeTxn(t) + ' | ' + eur(Math.abs(t.amount)) + ' | ' + t.sender + '→' + t.receiver + ' | ' + t.country).join('\n');
      context += '\n\nRecent transactions:\n' + recent;
    }

    let policyNote = '';
    if (policyCtx && policyCtx.length) {
      context += '\n\nRelevant policy excerpts:\n' + policyCtx.map(p => '[' + p.source + '] ' + p.text).join('\n\n');
      policyNote = policyCtx.map(p => p.source).filter((v, i, a) => a.indexOf(v) === i).join(', ');
    }

    const historyText = copilotHistory.slice(-3).map(t => 'Q: ' + t.q + '\nA: ' + t.a).join('\n\n');

    const sys = `You are a fraud/AML Investigation Copilot running locally on the user's device.
Answer using ONLY the data given below. Never state definitively that something is fraud — use "potentially suspicious" language. Be concise (2-6 sentences, or a short list). Cite specific dates/amounts/accounts when relevant.`;
    const prompt = sys + '\n\n' + context + (historyText ? '\n\nPrevious Q&A:\n' + historyText : '') + '\n\nQuestion: ' + question + '\nAnswer:';

    const answer = await callLocal(prompt);
    thinking.remove();
    appendCopilotMessage('assistant', answer, policyNote ? 'Source: ' + policyNote : null);
    copilotHistory.push({ q: question, a: answer });
  } catch (e) {
    thinking.remove();
    appendCopilotMessage('error', 'Error: ' + e.message);
  } finally {
    copilotBusy = false;
    $('copilotSend').disabled = false;
    input.focus();
  }
}

// ═══════════════════════════════════════════════════
//  PROVE IT
// ═══════════════════════════════════════════════════
function openProveIt() {
  $('proveTxnCount').textContent = txns.length.toLocaleString();
  $('provePolicyCount').textContent = policyChunkCount.toLocaleString();
  $('proveModal').classList.add('show');
}
function closeProveIt(e) { if (e.target === $('proveModal')) $('proveModal').classList.remove('show'); }

// ═══════════════════════════════════════════════════
//  MODEL STATUS
// ═══════════════════════════════════════════════════
async function checkStatus() {
  const dot = $('miniDot'), txt = $('miniText');
  dot.style.background = 'var(--text3)'; txt.textContent = 'Checking...';
  if (!NativeAI.isNative) { dot.style.background = 'var(--accent)'; txt.textContent = 'Not running in native shell'; return; }
  try {
    const r = await NativeAI.ensureReady();
    if (r.ok) { dot.style.background = 'var(--green)'; txt.textContent = 'On-device model: ready'; }
    else { dot.style.background = 'var(--accent)'; txt.textContent = 'Model: ' + (r.error || r.state); }
  } catch (e) { dot.style.background = 'var(--accent)'; txt.textContent = 'Model: ' + e.message; }
}

function toast(msg, type) {
  console.log('[toast' + (type ? ':' + type : '') + ']', msg);
}

checkStatus();
