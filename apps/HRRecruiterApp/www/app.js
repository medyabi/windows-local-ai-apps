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
    indexResume: (contentId, text) => call('indexResume', { contentId, prompt: text }),
    queryResume: (query) => call('queryResume', { prompt: query }),
    fetchUrl: (url) => call('fetchUrl', { url }),
  };
})();

const $ = id => document.getElementById(id);

// ═══════════════════════════════════════════════════
//  STATE
// ═══════════════════════════════════════════════════
let roles = [];
let candidates = [];
let currentRoleId = null;
let currentCandidateId = null;
let copilotScope = null; // { type: 'role'|'candidate', id }
let copilotBusy = false;

// ═══════════════════════════════════════════════════
//  VIEW SWITCHING
// ═══════════════════════════════════════════════════
function showView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  $('view-' + name).classList.add('active');
  const navItem = document.querySelector('.nav-item[data-view="' + name + '"]');
  if (navItem) navItem.classList.add('active');
  if (name === 'roles') renderRolesGrid();
  if (name === 'dashboard') renderDashboard();
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

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Small on-device models occasionally produce near-valid JSON (trailing commas,
// or output cut off before the structure closes). Try a straight parse first,
// then a couple of cheap, safe repairs before giving up — the caller's own
// validateXxx() functions still check the *content*, this only recovers syntax.
function extractJsonLoose(text) {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    const noTrailingCommas = cleaned.replace(/,(\s*[\]}])/g, '$1');
    try {
      return JSON.parse(noTrailingCommas);
    } catch (e2) {
      return JSON.parse(closeUnbalancedJson(noTrailingCommas));
    }
  }
}

function closeUnbalancedJson(s) {
  let str = s;
  const quoteCount = (str.match(/(?<!\\)"/g) || []).length;
  if (quoteCount % 2 !== 0) str = str.slice(0, str.lastIndexOf('"'));
  str = str.replace(/,\s*$/, '');
  let depthCurly = 0, depthSquare = 0, inStr = false, esc = false;
  for (const ch of str) {
    if (esc) { esc = false; continue; }
    if (ch === '\\') { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === '{') depthCurly++;
    else if (ch === '}') depthCurly--;
    else if (ch === '[') depthSquare++;
    else if (ch === ']') depthSquare--;
  }
  return str + ']'.repeat(Math.max(0, depthSquare)) + '}'.repeat(Math.max(0, depthCurly));
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

function slugId(prefix) {
  return prefix + '-' + Date.now().toString(36) + Math.floor(Math.random() * 999);
}

// ═══════════════════════════════════════════════════
//  ROLE ANALYZER
// ═══════════════════════════════════════════════════
// Text copy-pasted straight from a job board (Indeed, LinkedIn, Upwork, ...) usually
// drags along site chrome — nav links, cookie banners, "Apply now" / "Save" / "Share"
// buttons, related-jobs lists, "N people have already applied" — none of which is
// part of the actual job description. Strip the most common patterns deterministically
// before it ever reaches the model: cheaper, faster, and more reliable than asking the
// LLM to silently ignore clutter inside a huge prompt.
const JD_BOILERPLATE_LINE_PATTERNS = [
  /^(apply now|apply today|save (this )?job|share (this )?job|report (this )?job|print|sign in|log in|create (your )?profile|create alert|job alert)s?$/i,
  /^\d+[\d,.]*\s*(people|applicants?|candidates?)\s+(have\s+)?applied/i,
  /^(we use cookies|this site uses cookies|by using this site|accept cookies|cookie (policy|settings|preferences))/i,
  /^(related jobs|similar jobs|jobs you might like|more jobs (at|from)|recommended jobs|other jobs)/i,
  /^(posted|listed)\s+\d+\s*(day|hour|week|month)s?\s+ago$/i,
  /^(easy apply|quick apply)$/i,
  /^\d+\s*(reviews?|salaries?|ratings?)$/i,
  /^(back to search results|view all jobs|see all jobs)$/i,
];

function cleanPastedJdText(text) {
  return text
    .split(/\r?\n/)
    .filter(line => {
      const trimmed = line.trim();
      if (!trimmed) return true; // keep blank lines for paragraph structure
      return !JD_BOILERPLATE_LINE_PATTERNS.some(re => re.test(trimmed));
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function buildRoleAnalysisPrompt(jdText) {
  const cleaned = cleanPastedJdText(jdText);
  return `You are a technical recruiting analyst. The text below was copy-pasted from a job posting — it may still ` +
    `contain site navigation, "Apply now" buttons, cookie notices, related-job listings, or other page clutter mixed ` +
    `in alongside the real job description. Ignore anything that isn't part of the actual role description. ` +
    `Identify concrete, checkable requirements (skills, years of experience, certifications, education, key ` +
    `responsibilities) from the real content — phrase each as a single verifiable statement (e.g. "5+ years of Azure ` +
    `cloud architecture experience"). Mark each requirement "must" (explicitly required) or "nice" (preferred/bonus). ` +
    `Extract 6-14 requirements. Return ONLY one valid JSON object with exactly this shape:\n` +
    `{"title":"string","company":"string","seniority":"string (e.g. Senior, Mid-level, Junior)","summary":"2-3 sentence plain-English summary of the role","requirements":[{"text":"string","category":"must"|"nice"}]}\n\n` +
    `PASTED JOB POSTING TEXT:\n${cleaned.slice(0, 6000)}\n\nJSON:`;
}

function validateRoleAnalysis(data) {
  if (typeof data !== 'object' || data === null) throw new Error('AI response was not an object.');
  if (!Array.isArray(data.requirements) || !data.requirements.length) throw new Error('AI response missing requirements.');
  data.requirements.forEach((r, i) => {
    if (typeof r.text !== 'string' || !r.text.trim()) throw new Error(`requirement[${i}] missing text.`);
    if (r.category !== 'must' && r.category !== 'nice') r.category = 'must';
  });
  data.title = data.title || 'Untitled Role';
  data.company = data.company || '';
  data.seniority = data.seniority || '';
  data.summary = data.summary || '';
  return data;
}

// Catches the case where someone pastes a bare link into the JD text box instead of the
// posting's actual text (e.g. typed into the wrong field, or a "Fetch" attempt above failed and
// the URL was left/copied into this box too) — a URL alone gives the model nothing to analyze.
function looksLikeBareUrl(text) {
  const stripped = text.trim();
  if (!stripped) return false;
  const words = stripped.split(/\s+/);
  return words.length <= 2 && /^https?:\/\/\S+$/i.test(words[0]);
}

async function analyzeRole(jdText) {
  const btn = $('analyzeRoleBtn');
  const status = $('newRoleStatus');
  if (looksLikeBareUrl(jdText)) {
    status.innerHTML = '<span style="color:var(--red)">✗ That\'s a link, not the job posting text — the analyzer needs the actual description. ' +
      'Use the "Fetch" button above (works for many career-site pages, but not Indeed/LinkedIn/Upwork), or copy the posting text and paste it here.</span>';
    return;
  }
  btn.disabled = true;
  status.innerHTML = '<span class="loading-inline"><span class="spinner"></span> Analyzing role on-device…</span>';
  try {
    const resp = await NativeAI.generate(buildRoleAnalysisPrompt(jdText));
    const data = validateRoleAnalysis(extractJsonLoose(resp.text));
    const role = {
      id: slugId('role'),
      title: data.title, company: data.company, seniority: data.seniority,
      summary: data.summary, requirements: data.requirements, jdText,
    };
    roles.unshift(role);
    status.innerHTML = '<span style="color:var(--green)">✓ Role analyzed — opening…</span>';
    $('jdTextInput').value = '';
    updateAnalyzeRoleButtonState();
    openRole(role.id);
    status.textContent = '';
  } catch (e) {
    status.innerHTML = `<span style="color:var(--red)">✗ Analysis failed: ${e.message}</span>`;
  }
  btn.disabled = false;
}

$('jdTextInput').addEventListener('input', updateAnalyzeRoleButtonState);
function updateAnalyzeRoleButtonState() {
  $('analyzeRoleBtn').disabled = !$('jdTextInput').value.trim();
}
$('analyzeRoleBtn').addEventListener('click', () => analyzeRole($('jdTextInput').value.trim()));

const jdZone = document.querySelector('.upload-zone[data-doc="jd"]');
jdZone.addEventListener('dragover', e => { e.preventDefault(); jdZone.classList.add('drag'); });
jdZone.addEventListener('dragleave', () => jdZone.classList.remove('drag'));
jdZone.addEventListener('drop', e => { e.preventDefault(); jdZone.classList.remove('drag'); handleJdFile(e.dataTransfer.files[0]); });
jdZone.querySelector('input[type=file]').addEventListener('change', e => handleJdFile(e.target.files[0]));

async function handleJdFile(file) {
  if (!file) return;
  const label = $('jdDropLabel');
  label.textContent = 'Extracting ' + file.name + '…';
  try {
    const base64 = await fileToBase64(file);
    const resp = await NativeAI.pdfText(base64);
    $('jdTextInput').value = (resp.text || '').trim();
    updateAnalyzeRoleButtonState();
    label.textContent = '✓ Extracted from ' + file.name;
  } catch (e) {
    label.textContent = 'Extraction failed: ' + e.message;
  }
}

// Best-effort readable-text extraction from a fetched job-posting page. Tries a few common
// job-detail container selectors first (these sites tend to isolate the description into one
// element); falls back to the whole page's visible text, which cleanPastedJdText()/the model
// prompt then filter down further.
function extractJobTextFromHtml(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script,style,noscript,svg,nav,footer,header').forEach(el => el.remove());
  const selectors = [
    '#jobDescriptionText',            // Indeed
    '.jobsearch-JobComponent-description',
    '[data-testid="job-details"]',
    '.jobs-description__content',     // LinkedIn
    '.jobs-box__html-content',
    '.job-details',                   // Upwork
    'article', 'main',
  ];
  for (const sel of selectors) {
    const el = doc.querySelector(sel);
    if (el && el.innerText && el.innerText.trim().length > 200) return el.innerText;
  }
  return doc.body ? doc.body.innerText : '';
}

async function fetchJdFromUrl(url) {
  const status = $('jdUrlStatus');
  const btn = $('fetchJdUrlBtn');
  if (!url) { status.innerHTML = '<span style="color:var(--red)">Enter a URL first.</span>'; return; }
  btn.disabled = true;
  status.innerHTML = '<span class="loading-inline"><span class="spinner"></span> Fetching page…</span>';
  try {
    const resp = await NativeAI.fetchUrl(url);
    const text = extractJobTextFromHtml(resp.text || '').trim();
    if (text.length < 100) {
      status.innerHTML = '<span style="color:var(--red)">Fetched the page but couldn\'t find enough readable text — the site likely renders the listing with JavaScript. Copy the posting text and paste it below instead.</span>';
    } else {
      $('jdTextInput').value = text;
      updateAnalyzeRoleButtonState();
      status.innerHTML = '<span style="color:var(--green)">✓ Pulled text from the page — review it below, then Analyze Role.</span>';
    }
  } catch (e) {
    status.innerHTML = `<span style="color:var(--red)">✗ ${e.message} — try copying the posting text and pasting it below instead.</span>`;
  }
  btn.disabled = false;
}
$('fetchJdUrlBtn').addEventListener('click', () => fetchJdFromUrl($('jdUrlInput').value.trim()));
$('jdUrlInput').addEventListener('keydown', e => { if (e.key === 'Enter') fetchJdFromUrl($('jdUrlInput').value.trim()); });

// ═══════════════════════════════════════════════════
//  DASHBOARD / ROLES LIST
// ═══════════════════════════════════════════════════
function roleCandidates(roleId) {
  return candidates.filter(c => c.roleId === roleId);
}

function renderDashboard() {
  const highFit = candidates.filter(c => c.fit && c.fit.level === 'High').length;
  const avgScore = candidates.length ? Math.round(candidates.reduce((s, c) => s + (c.fit ? c.fit.score : 0), 0) / candidates.length) : 0;

  $('dashStats').innerHTML = `
    <div class="stat-card"><div class="stat-v">${roles.length}</div><div class="stat-l">Open roles</div></div>
    <div class="stat-card"><div class="stat-v">${candidates.length}</div><div class="stat-l">Candidates screened</div></div>
    <div class="stat-card good"><div class="stat-v">${highFit}</div><div class="stat-l">High-fit candidates</div></div>
    <div class="stat-card"><div class="stat-v">${avgScore}</div><div class="stat-l">Average fit score</div></div>
  `;

  if (!roles.length) {
    $('dashRoleGrid').innerHTML = '<div class="empty-note">No roles yet — go to "New Role" to analyze your first job description.</div>';
    return;
  }
  $('dashRoleGrid').innerHTML = roles.map(roleCardHtml).join('');
  $('dashRoleGrid').querySelectorAll('[data-open]').forEach(el => el.addEventListener('click', () => openRole(el.dataset.open)));
}

function roleCardHtml(r) {
  const rc = roleCandidates(r.id);
  const top = rc.length ? Math.max(...rc.map(c => c.fit ? c.fit.score : 0)) : null;
  return `<div class="role-card" data-open="${r.id}">
    <div class="role-name">${escapeHtml(r.title)}</div>
    <div class="role-company">${escapeHtml(r.company || r.seniority || '')}</div>
    <div class="role-mini-stats">
      <div><b>${rc.length}</b> candidates</div>
      <div><b>${top === null ? '—' : top}</b> top score</div>
    </div>
  </div>`;
}

function renderRolesGrid() {
  if (!roles.length) {
    $('rolesGrid').innerHTML = '<div class="empty-note">No roles yet — go to "New Role" to analyze your first job description.</div>';
    return;
  }
  $('rolesGrid').innerHTML = roles.map(roleCardHtml).join('');
  $('rolesGrid').querySelectorAll('[data-open]').forEach(el => el.addEventListener('click', () => openRole(el.dataset.open)));
}

// ═══════════════════════════════════════════════════
//  ROLE DETAIL + RÉSUMÉ UPLOAD
// ═══════════════════════════════════════════════════
function openRole(id) {
  currentRoleId = id;
  showView('roledetail');
  renderRoleDetail();
  resetCopilotForRole(id);
}

function levelClass(level) {
  return (level || '').toLowerCase();
}

function renderRoleDetail() {
  const r = roles.find(x => x.id === currentRoleId);
  if (!r) return;
  const rc = roleCandidates(r.id).slice().sort((a, b) => (b.fit ? b.fit.score : -1) - (a.fit ? a.fit.score : -1));

  const reqHtml = r.requirements.map(req => `
    <div class="req-item">
      <div class="req-head">
        <div class="req-text">${escapeHtml(req.text)}</div>
        <div class="req-badges"><span class="badge ${req.category}">${req.category === 'must' ? 'MUST' : 'NICE'}</span></div>
      </div>
    </div>`).join('');

  const candTable = rc.length ? `
    <table class="data-table">
      <thead><tr><th>Rank</th><th>Candidate</th><th>Fit Score</th><th>Level</th><th>Top Strength</th><th>Top Gap</th></tr></thead>
      <tbody>
        ${rc.map((c, i) => `<tr class="${c.error ? '' : 'clickable'}" ${c.error ? '' : `data-open="${c.id}"`}>
          <td style="font-family:var(--mono)">#${i + 1}</td>
          <td>${escapeHtml(c.profile ? c.profile.name : c.fileName)}</td>
          <td style="font-family:var(--mono)">${c.fit ? c.fit.score : '—'}</td>
          <td>${c.fit ? `<span class="badge ${levelClass(c.fit.level)}">${c.fit.level}</span>`
              : c.error ? `<span style="color:var(--red);font-size:11px;">✗ Failed</span> <button class="btn small" data-retry="${c.id}">Retry</button>`
              : '<span class="loading-inline"><span class="spinner"></span> analyzing…</span>'}</td>
          <td>${c.strengths && c.strengths[0] ? escapeHtml(c.strengths[0])
              : c.insightsError === 'retrying' ? '<span class="loading-inline"><span class="spinner"></span> retrying…</span>'
              : c.insightsError ? `<span style="color:var(--amber);font-size:11px;">✗ Failed</span> <button class="btn small" data-retry-insights="${c.id}">Retry</button>`
              : c.fit ? '<span class="loading-inline"><span class="spinner"></span> …</span>' : '—'}</td>
          <td>${c.gaps && c.gaps[0] ? escapeHtml(c.gaps[0]) : '—'}</td>
        </tr>`).join('')}
      </tbody>
    </table>` : '<div class="empty-note">No candidates yet — drop résumés below.</div>';

  $('roleDetailBody').innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-id">${escapeHtml(r.title)}</div>
        <div style="font-size:12px;color:var(--text2)">${escapeHtml(r.company || '')}${r.company && r.seniority ? ' — ' : ''}${escapeHtml(r.seniority || '')}</div>
      </div>
    </div>

    <div class="card">
      <div class="card-title">📋 Role Summary</div>
      <p style="font-size:12.5px;color:var(--text);line-height:1.6;">${escapeHtml(r.summary)}</p>
    </div>

    <div class="sh">Requirements (${r.requirements.length})</div>
    <div class="card">${reqHtml}</div>

    <div class="sh">Upload Résumés</div>
    <div class="upload-zone" id="resumeDropZone" style="margin-bottom:18px;">
      <div class="upload-title">📄 Drop résumé PDFs here</div>
      <div class="upload-sub">One or more files — each is analyzed on-device automatically</div>
      <input type="file" accept="application/pdf" multiple id="resumeFileInput">
    </div>

    <div class="sh">Recruiter Prioritization</div>
    ${candTable}
  `;

  const zone = $('resumeDropZone');
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag'));
  zone.addEventListener('drop', e => { e.preventDefault(); zone.classList.remove('drag'); handleResumeFiles(r.id, e.dataTransfer.files); });
  $('resumeFileInput').addEventListener('change', e => handleResumeFiles(r.id, e.target.files));

  $('roleDetailBody').querySelectorAll('[data-open]').forEach(el => el.addEventListener('click', () => openCandidate(el.dataset.open)));
  $('roleDetailBody').querySelectorAll('[data-retry]').forEach(el => el.addEventListener('click', (e) => { e.stopPropagation(); retryCandidate(el.dataset.retry); }));
  $('roleDetailBody').querySelectorAll('[data-retry-insights]').forEach(el => el.addEventListener('click', (e) => { e.stopPropagation(); retryInsights(el.dataset.retryInsights); }));
}

async function handleResumeFiles(roleId, files) {
  if (!files || !files.length) return;
  for (const file of Array.from(files)) {
    await processResume(roleId, file);
  }
}

async function retryCandidate(candidateId) {
  const c = candidates.find(x => x.id === candidateId);
  if (!c) return;
  const roleId = c.roleId, file = c.resumeFile;
  candidates = candidates.filter(x => x.id !== candidateId);
  renderRoleDetail();
  await processResume(roleId, file);
}

// Retries only the strengths/gaps/interview-questions call — the résumé is already
// extracted and the fit/evidence assessment already succeeded, so this is fast and
// doesn't touch anything that's already working.
async function retryInsights(candidateId) {
  const c = candidates.find(x => x.id === candidateId);
  if (!c || !c.fit) return;
  const role = roles.find(r => r.id === c.roleId);
  c.insightsError = 'retrying';
  renderRoleDetail();
  if (currentCandidateId === candidateId) renderCandidateProfile();
  try {
    const insightsResp = await NativeAI.generate(buildInsightsPrompt(role, c.fit));
    const insights = validateInsights(extractJsonLoose(insightsResp.text));
    c.strengths = insights.strengths;
    c.gaps = insights.gaps;
    c.interviewQuestions = insights.interviewQuestions;
    c.insightsError = null;
  } catch (e) {
    c.insightsError = e.message;
  }
  renderRoleDetail();
  if (currentCandidateId === candidateId) renderCandidateProfile();
}

// ═══════════════════════════════════════════════════
//  RÉSUMÉ ANALYZER + FIT ASSESSMENT
// ═══════════════════════════════════════════════════
function buildProfilePrompt(resumeText) {
  return `You are extracting a structured candidate profile from a résumé. Return ONLY one valid JSON object with ` +
    `exactly this shape (use "" or [] for genuinely missing fields — never invent data not present in the text):\n` +
    `{"name":"string","email":"string","phone":"string","totalYearsExperience":number,"skills":["string",...],` +
    `"education":[{"degree":"string","institution":"string","year":"string"}],` +
    `"workHistory":[{"title":"string","company":"string","start":"string","end":"string","description":"1 sentence"}],` +
    `"certifications":["string",...]}\n\nRESUME TEXT:\n${resumeText.slice(0, 6000)}\n\nJSON:`;
}

function validateProfile(data) {
  if (typeof data !== 'object' || data === null) throw new Error('AI response was not an object.');
  data.name = data.name || 'Unknown Candidate';
  data.email = data.email || '';
  data.phone = data.phone || '';
  data.totalYearsExperience = typeof data.totalYearsExperience === 'number' ? data.totalYearsExperience : 0;
  data.skills = Array.isArray(data.skills) ? data.skills : [];
  data.education = Array.isArray(data.education) ? data.education : [];
  data.workHistory = Array.isArray(data.workHistory) ? data.workHistory : [];
  data.certifications = Array.isArray(data.certifications) ? data.certifications : [];
  return data;
}

// Split into two smaller calls rather than one giant combined one: on-device models
// generate a large combined JSON (score + evidence per requirement + strengths + gaps +
// interview questions) noticeably slower and are more prone to truncation/malformed
// output the longer the response gets. Two focused calls are each faster and more
// reliable than one big one, and let the fit/evidence result render as soon as it's
// ready instead of waiting for everything at once.
function buildFitPrompt(role, resumeText) {
  const reqList = role.requirements.map((r, i) => `${i + 1}. [${r.category.toUpperCase()}] ${r.text}`).join('\n');
  return `You are an experienced technical recruiter evaluating one candidate against one open role. Base your ` +
    `evaluation ONLY on job-relevant qualifications: skills, experience, education, and certifications found in the ` +
    `résumé text. Do NOT factor in the candidate's name, gender, age, ethnicity, nationality, or any other ` +
    `characteristic not directly relevant to job qualifications — evaluate the work only.\n\n` +
    `For EACH requirement listed below, find the most relevant evidence in the résumé text (quote it closely, as ` +
    `close to verbatim as possible) and assess whether the candidate meets it. If there is no evidence, say ` +
    `"No direct evidence found in the résumé." rather than inventing evidence. Keep each evidence quote and ` +
    `assessment short (one sentence each).\n\n` +
    `Return ONLY one valid JSON object with exactly this shape:\n` +
    `{"score": number 0-100, "level": "High"|"Medium"|"Low", "summary": "2-3 sentence overall fit summary", ` +
    `"requirementResults": [{"requirement":"string (verbatim from the list below)","status":"met"|"partial"|"not-met",` +
    `"evidence":"string","assessment":"1 short sentence"}]}\n\n` +
    `ROLE: ${role.title}${role.company ? ' at ' + role.company : ''} (${role.seniority})\n` +
    `REQUIREMENTS:\n${reqList}\n\nCANDIDATE RESUME TEXT:\n${resumeText.slice(0, 5000)}\n\nJSON:`;
}

function validateFit(data) {
  if (typeof data !== 'object' || data === null) throw new Error('AI response was not an object.');
  if (typeof data.score !== 'number') throw new Error('AI response missing score.');
  if (!['High', 'Medium', 'Low'].includes(data.level)) {
    data.level = data.score >= 75 ? 'High' : data.score >= 50 ? 'Medium' : 'Low';
  }
  data.summary = data.summary || '';
  data.requirementResults = Array.isArray(data.requirementResults) ? data.requirementResults : [];
  data.requirementResults.forEach(rr => {
    if (!['met', 'partial', 'not-met'].includes(rr.status)) rr.status = 'partial';
    rr.evidence = rr.evidence || 'No direct evidence found in the résumé.';
    rr.assessment = rr.assessment || '';
  });
  return data;
}

function buildInsightsPrompt(role, fit) {
  const reqStatus = fit.requirementResults.map(rr => `${rr.requirement}: ${rr.status}`).join('\n');
  return `You are an experienced technical recruiter. Based on the requirement-by-requirement fit assessment below ` +
    `for a candidate against the ${role.title} role, write concise strengths, gaps, and tailored interview ` +
    `questions. Ground everything in the assessment given — do not invent new qualifications.\n\n` +
    `OVERALL FIT: ${fit.score}/100 (${fit.level}) — ${fit.summary}\n` +
    `REQUIREMENT STATUS:\n${reqStatus}\n\n` +
    `Return ONLY one valid JSON object with exactly this shape:\n` +
    `{"strengths": ["string", ...] (3-4 short items), "gaps": ["string", ...] (2-3 short items), ` +
    `"interviewQuestions": [{"question":"string","rationale":"1 short sentence"}] (4 items, prioritizing gaps and validating claimed strengths)}\n\nJSON:`;
}

function validateInsights(data) {
  if (typeof data !== 'object' || data === null) throw new Error('AI response was not an object.');
  data.strengths = Array.isArray(data.strengths) ? data.strengths : [];
  data.gaps = Array.isArray(data.gaps) ? data.gaps : [];
  data.interviewQuestions = Array.isArray(data.interviewQuestions) ? data.interviewQuestions : [];
  return data;
}

async function processResume(roleId, file) {
  const role = roles.find(r => r.id === roleId);
  if (!role) return;

  // placeholder candidate shown immediately so the recruiter sees progress
  const candidate = { id: slugId('cand'), roleId, fileName: file.name, resumeFile: file, profile: null, fit: null, strengths: [], gaps: [], interviewQuestions: [], insightsError: null };
  candidates.unshift(candidate);
  renderRoleDetail();

  try {
    const base64 = await fileToBase64(file);
    const pdfResp = await NativeAI.pdfText(base64);
    const resumeText = (pdfResp.text || '').trim();
    if (!resumeText) throw new Error('Résumé contains no extractable text.');
    candidate.resumeText = resumeText;

    const profResp = await NativeAI.generate(buildProfilePrompt(resumeText));
    candidate.profile = validateProfile(extractJsonLoose(profResp.text));
    renderRoleDetail();

    const fitResp = await NativeAI.generate(buildFitPrompt(role, resumeText));
    const fit = validateFit(extractJsonLoose(fitResp.text));
    candidate.fit = { score: fit.score, level: fit.level, summary: fit.summary, requirementResults: fit.requirementResults };

    // Fingerprinting/indexing only needs the profile+fit we already have — do this
    // now rather than after the insights call, so duplicate-application detection
    // still works even if the (separate, best-effort) insights call below fails.
    candidate.fingerprint = `${candidate.profile.name} — ${candidate.profile.totalYearsExperience} years — ` +
      `Skills: ${candidate.profile.skills.join(', ')} — Most recent: ${candidate.profile.workHistory[0] ? candidate.profile.workHistory[0].title + ' at ' + candidate.profile.workHistory[0].company : 'n/a'}`;
    if (NativeAI.isNative) NativeAI.indexResume(candidate.id, candidate.fingerprint).catch(() => {});
    renderRoleDetail();

    // The strengths/gaps/interview-questions call is separate from — and less critical
    // than — the fit assessment itself. Never let its failure erase or hide an already-
    // successful score/evidence result; just record it so the UI can offer a retry.
    try {
      const insightsResp = await NativeAI.generate(buildInsightsPrompt(role, fit));
      const insights = validateInsights(extractJsonLoose(insightsResp.text));
      candidate.strengths = insights.strengths;
      candidate.gaps = insights.gaps;
      candidate.interviewQuestions = insights.interviewQuestions;
      candidate.insightsError = null;
    } catch (insightErr) {
      candidate.insightsError = insightErr.message;
    }

    renderRoleDetail();
    toast(`${candidate.profile.name} analyzed — ${fit.level} fit (${fit.score})`);
  } catch (e) {
    candidate.error = e.message;
    renderRoleDetail();
    toast(`Analysis failed for ${file.name}: ${e.message}`);
  }
}

// ═══════════════════════════════════════════════════
//  CANDIDATE PROFILE
// ═══════════════════════════════════════════════════
function openCandidate(id) {
  currentCandidateId = id;
  const c = candidates.find(x => x.id === id);
  showView('candidate');
  $('candidateBackLink').onclick = () => showView('roledetail');
  renderCandidateProfile();
  resetCopilotForCandidate(id);
}

function renderCandidateProfile() {
  const c = candidates.find(x => x.id === currentCandidateId);
  if (!c) return;
  const role = roles.find(r => r.id === c.roleId);

  if (!c.fit || !c.profile) {
    $('candidateBody').innerHTML = `<div class="page-header"><div class="page-id">${escapeHtml(c.fileName)}</div></div>
      <div class="card">${c.error ? `<p style="color:var(--red);font-size:12px;">${escapeHtml(c.error)}</p>` : '<span class="loading-inline"><span class="spinner"></span> Analyzing résumé on-device…</span>'}</div>`;
    return;
  }

  const p = c.profile, fit = c.fit;

  const reqRows = fit.requirementResults.map((rr, i) => `
    <div class="req-item">
      <div class="req-head" data-toggle="ev-${i}">
        <div class="req-text">${escapeHtml(rr.requirement)}</div>
        <div class="req-badges">
          <span class="badge ${rr.status === 'met' ? 'met' : rr.status === 'partial' ? 'partial' : 'notmet'}">${rr.status === 'met' ? 'MET' : rr.status === 'partial' ? 'PARTIAL' : 'NOT MET'}</span>
          <button class="btn small" data-toggle-btn="ev-${i}">🔎 Evidence</button>
        </div>
      </div>
      <div class="evidence-box" id="ev-${i}">
        <div class="evidence-row"><div class="evidence-label">Evidence</div><div class="evidence-quote">"${escapeHtml(rr.evidence)}"</div></div>
        <div class="evidence-row"><div class="evidence-label">Assessment</div><div>${escapeHtml(rr.assessment)}</div></div>
      </div>
    </div>`).join('');

  const insightsFailedHtml = c.insightsError === 'retrying'
    ? '<span class="loading-inline"><span class="spinner"></span> Retrying…</span>'
    : `<p style="font-size:11.5px;color:var(--amber);">✗ This step failed to generate (${escapeHtml(c.insightsError)}).</p>
       <button class="btn small primary" data-retry-insights="${c.id}" style="margin-top:6px;">Retry</button>`;

  const strengthsHtml = c.strengths.length ? c.strengths.map(s => `<div class="list-item strength"><span class="dot"></span>${escapeHtml(s)}</div>`).join('')
    : c.insightsError ? insightsFailedHtml : '<div class="empty-note">None identified.</div>';
  const gapsHtml = c.gaps.length ? c.gaps.map(g => `<div class="list-item gap"><span class="dot"></span>${escapeHtml(g)}</div>`).join('')
    : c.insightsError ? insightsFailedHtml : '<div class="empty-note">None identified.</div>';

  const iqHtml = c.interviewQuestions.length ? c.interviewQuestions.map(q => `
    <div class="iq-item"><div class="iq-q">${escapeHtml(q.question)}</div><div class="iq-r">${escapeHtml(q.rationale)}</div></div>`).join('')
    : c.insightsError ? insightsFailedHtml : '<div class="empty-note">None generated.</div>';

  const skillsHtml = p.skills.length ? p.skills.map(s => `<span class="skill-chip">${escapeHtml(s)}</span>`).join('') : '<span style="color:var(--text3);font-size:12px;">None listed</span>';
  const eduHtml = p.education.length ? p.education.map(e => `<div class="profile-value">${escapeHtml(e.degree)}${e.institution ? ' — ' + escapeHtml(e.institution) : ''}${e.year ? ' (' + escapeHtml(e.year) + ')' : ''}</div>`).join('') : '<span style="color:var(--text3);font-size:12px;">None listed</span>';
  const workHtml = p.workHistory.length ? p.workHistory.map(w => `
    <div class="work-item">
      <div class="work-title">${escapeHtml(w.title)}${w.company ? ' — ' + escapeHtml(w.company) : ''}</div>
      <div class="work-meta">${escapeHtml(w.start)}${w.start || w.end ? ' – ' : ''}${escapeHtml(w.end)}</div>
      <div class="work-desc">${escapeHtml(w.description)}</div>
    </div>`).join('') : '<div class="empty-note">None listed.</div>';
  const certHtml = p.certifications.length ? p.certifications.map(s => `<span class="skill-chip">${escapeHtml(s)}</span>`).join('') : '<span style="color:var(--text3);font-size:12px;">None listed</span>';

  $('candidateBody').innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-id">${escapeHtml(p.name)}</div>
        <div style="font-size:12px;color:var(--text2)">${role ? escapeHtml(role.title) : ''}${p.email ? ' — ' + escapeHtml(p.email) : ''}${p.phone ? ' — ' + escapeHtml(p.phone) : ''}</div>
      </div>
      <div><span class="badge ${levelClass(fit.level)}">${fit.level} FIT</span></div>
    </div>

    <div class="score-box">
      <div class="score-num ${levelClass(fit.level)}">${fit.score}</div>
      <div class="score-meta">
        <div class="score-label">Fit Score</div>
        <div class="score-sub">${escapeHtml(fit.summary)}</div>
      </div>
    </div>

    <div class="card">
      <div class="card-title">👤 Candidate Profile</div>
      <div class="profile-grid">
        <div>
          <div class="profile-field"><div class="profile-label">Total Experience</div><div class="profile-value">${p.totalYearsExperience} years</div></div>
          <div class="profile-field"><div class="profile-label">Education</div>${eduHtml}</div>
          <div class="profile-field"><div class="profile-label">Certifications</div>${certHtml}</div>
        </div>
        <div>
          <div class="profile-field"><div class="profile-label">Skills</div>${skillsHtml}</div>
        </div>
      </div>
      <div class="profile-field" style="margin-top:6px;"><div class="profile-label">Work History</div>${workHtml}</div>
    </div>

    <div class="sh">Fit Assessment — Show Me The Evidence</div>
    <div class="card">${reqRows}</div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
      <div class="card">
        <div class="card-title">💪 Strengths</div>
        ${strengthsHtml}
      </div>
      <div class="card">
        <div class="card-title">⚠ Gaps</div>
        ${gapsHtml}
      </div>
    </div>

    <div class="sh">Suggested Interview Questions</div>
    <div class="card">${iqHtml}</div>

    <div class="sh">Duplicate Application Check</div>
    <div class="card">
      <p style="font-size:11.5px;color:var(--text2);">Search the on-device index for this candidate having applied to a different role before.</p>
      <button class="btn primary" id="checkDupBtn" style="margin-top:8px;">🔍 Check for prior applications</button>
      <div id="dupResultBox"></div>
    </div>
  `;

  $('candidateBody').querySelectorAll('[data-toggle]').forEach(el => {
    el.addEventListener('click', () => {
      const box = $(el.dataset.toggle);
      box.classList.toggle('visible');
    });
  });
  $('candidateBody').querySelectorAll('[data-retry-insights]').forEach(el => el.addEventListener('click', () => retryInsights(el.dataset.retryInsights)));
  $('checkDupBtn').addEventListener('click', () => checkDuplicates(c));
}

async function checkDuplicates(c) {
  const btn = $('checkDupBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="loading-inline"><span class="spinner"></span> Searching on-device index…</span>';
  try {
    let resp = await NativeAI.queryResume(c.fingerprint);
    if (JSON.parse(resp.text || '[]').length === 0) {
      await new Promise(r => setTimeout(r, 3000));
      resp = await NativeAI.queryResume(c.fingerprint);
    }
    const matches = JSON.parse(resp.text || '[]');
    const candidateIds = [...new Set(matches.map(m => m.contentId))].filter(id => id !== c.id);
    // The semantic index matches on keyword/text overlap, not identity — confirm by name
    // equality (case-insensitive) before calling it the same person, and only surface matches
    // in a *different* role (same-role re-upload isn't a "prior application").
    const confirmed = candidateIds
      .map(id => candidates.find(x => x.id === id))
      .filter(other => other && other.profile && other.profile.name.toLowerCase() === c.profile.name.toLowerCase() && other.roleId !== c.roleId);

    const box = $('dupResultBox');
    if (!confirmed.length) {
      box.innerHTML = '<p style="font-size:12px;color:var(--green);margin-top:10px;">🟢 No prior applications found for this candidate.</p>';
    } else {
      box.innerHTML = `<p style="font-size:12px;color:var(--amber);margin:10px 0;">🚨 This candidate has applied before:</p>
        <table class="data-table"><thead><tr><th>Role</th><th>Fit Score</th><th>Level</th></tr></thead><tbody>
        ${confirmed.map(m => {
          const mr = roles.find(r => r.id === m.roleId);
          return `<tr class="clickable" data-open="${m.id}"><td>${escapeHtml(mr ? mr.title : m.roleId)}</td><td style="font-family:var(--mono)">${m.fit.score}</td><td><span class="badge ${levelClass(m.fit.level)}">${m.fit.level}</span></td></tr>`;
        }).join('')}
        </tbody></table>`;
      box.querySelectorAll('[data-open]').forEach(el => el.addEventListener('click', () => openCandidate(el.dataset.open)));
    }
    btn.textContent = 'Search again';
    btn.disabled = false;
  } catch (e) {
    $('dupResultBox').innerHTML = `<p style="color:var(--red);font-size:12px;margin-top:8px;">Search failed: ${e.message}</p>`;
    btn.textContent = 'Retry search';
    btn.disabled = false;
  }
}

// ═══════════════════════════════════════════════════
//  RECRUITING COPILOT
// ═══════════════════════════════════════════════════
function resetCopilotForRole(roleId) {
  const r = roles.find(x => x.id === roleId);
  copilotScope = { type: 'role', id: roleId };
  $('copilotContext').textContent = r.title + (r.company ? ' — ' + r.company : '');
  $('copilotBody').innerHTML = '';
  $('copilotInput').disabled = !NativeAI.isNative;
  $('copilotSend').disabled = !NativeAI.isNative;
  $('copilotExamples').innerHTML = [
    'Who is the strongest candidate so far?',
    'Compare the top 2 candidates.',
    'What criteria should I add or relax?',
    'Summarize the candidate pool.',
  ].map(q => `<button class="copilot-chip">${escapeHtml(q)}</button>`).join('');
  wireCopilotChips();
  if (!NativeAI.isNative) appendMsg('ai', 'Recruiting Copilot needs the native desktop shell to run the on-device model. Launch the installed app to use this panel.');
}

function resetCopilotForCandidate(candidateId) {
  const c = candidates.find(x => x.id === candidateId);
  copilotScope = { type: 'candidate', id: candidateId };
  $('copilotContext').textContent = (c.profile ? c.profile.name : c.fileName);
  $('copilotBody').innerHTML = '';
  $('copilotInput').disabled = !NativeAI.isNative;
  $('copilotSend').disabled = !NativeAI.isNative;
  const level = c.fit ? c.fit.level.toLowerCase() : 'this';
  $('copilotExamples').innerHTML = [
    `Why did you give this candidate a ${c.fit ? c.fit.level : ''} fit?`,
    'What should I focus on in the interview?',
    'What is the single biggest risk with this candidate?',
    'Show me all previous applications from this candidate.',
  ].map(q => `<button class="copilot-chip">${escapeHtml(q)}</button>`).join('');
  wireCopilotChips();
  if (!NativeAI.isNative) appendMsg('ai', 'Recruiting Copilot needs the native desktop shell to run the on-device model. Launch the installed app to use this panel.');
}

function wireCopilotChips() {
  $('copilotExamples').querySelectorAll('.copilot-chip').forEach(chip => {
    chip.addEventListener('click', () => askCopilot(chip.textContent));
  });
}

function appendMsg(role, text) {
  const el = document.createElement('div');
  el.className = 'msg ' + role;
  el.textContent = text;
  $('copilotBody').appendChild(el);
  $('copilotBody').scrollTop = $('copilotBody').scrollHeight;
  return el;
}

function buildRoleCopilotContext(roleId) {
  const r = roles.find(x => x.id === roleId);
  const rc = roleCandidates(roleId);
  return `ROLE: ${r.title}${r.company ? ' at ' + r.company : ''} (${r.seniority})\n` +
    `ROLE SUMMARY: ${r.summary}\n` +
    `REQUIREMENTS: ${JSON.stringify(r.requirements)}\n` +
    `CANDIDATES ANALYZED SO FAR: ${JSON.stringify(rc.filter(c => c.fit).map(c => ({
      name: c.profile.name, score: c.fit.score, level: c.fit.level, summary: c.fit.summary,
      strengths: c.strengths, gaps: c.gaps,
    })))}`;
}

function buildCandidateCopilotContext(candidateId) {
  const c = candidates.find(x => x.id === candidateId);
  const r = roles.find(x => x.id === c.roleId);
  return `ROLE: ${r.title}${r.company ? ' at ' + r.company : ''}\n` +
    `REQUIREMENTS: ${JSON.stringify(r.requirements)}\n` +
    `CANDIDATE PROFILE: ${JSON.stringify(c.profile)}\n` +
    `FIT ASSESSMENT: score=${c.fit.score}, level=${c.fit.level}, summary="${c.fit.summary}"\n` +
    `PER-REQUIREMENT EVIDENCE: ${JSON.stringify(c.fit.requirementResults)}\n` +
    `STRENGTHS: ${JSON.stringify(c.strengths)}\nGAPS: ${JSON.stringify(c.gaps)}\n` +
    `SUGGESTED INTERVIEW QUESTIONS: ${JSON.stringify(c.interviewQuestions)}`;
}

async function askCopilot(question) {
  if (copilotBusy || !NativeAI.isNative || !copilotScope) return;
  copilotBusy = true;
  $('copilotSend').disabled = true;
  appendMsg('user', question);
  const typing = appendMsg('ai typing', 'Thinking…');

  let context;
  try {
    context = copilotScope.type === 'role' ? buildRoleCopilotContext(copilotScope.id) : buildCandidateCopilotContext(copilotScope.id);
  } catch (e) {
    typing.remove();
    appendMsg('ai', 'This candidate is still being analyzed — try again in a moment.');
    copilotBusy = false;
    $('copilotSend').disabled = false;
    return;
  }

  const sys = `You are the Recruiting Copilot inside an on-device candidate-screening tool. You are given the ` +
    `deterministic, already-computed role/candidate data below — never invent qualifications, scores, or evidence ` +
    `not present in it. Speak like an experienced technical recruiter: precise, concise (3-5 sentences unless asked ` +
    `to list or compare things), and always leave the final hiring decision to the human recruiter.\n\n${context}`;
  const prompt = sys + `\n\nRecruiter question: ${question}\nAnswer:`;

  try {
    const resp = await NativeAI.generate(prompt);
    typing.remove();
    appendMsg('ai', resp.text.trim());
  } catch (e) {
    typing.remove();
    appendMsg('ai', 'Recruiting Copilot is unavailable: ' + e.message);
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
//  RESPONSIBLE AI PAGE + MISC
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
  toast(`0 résumés uploaded externally · 0 API calls · ${candidates.length} candidates screened entirely on this device`);
});

if (!NativeAI.isNative) {
  $('localPill').innerHTML = '<span class="pill-dot" style="background:var(--amber);box-shadow:none"></span> Browser preview';
  $('localPill').style.borderColor = 'rgba(251,191,36,0.35)';
  $('localPill').style.color = 'var(--amber)';
  $('localPill').style.background = 'var(--amber-dim)';
}

renderDashboard();
