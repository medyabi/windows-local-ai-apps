'use strict';

// Chat flows: sending, streaming, regenerate / edit (branches), slash commands, built-in tools, memory, attachments, background jobs.
const SLASH = [
  { cmd: 'summarize', desc: 'Summarize text or an attached file as bullets (Windows AI skill)' },
  { cmd: 'tldr', desc: 'Summarize as one short paragraph (Windows AI skill)' },
  { cmd: 'rewrite', desc: 'Rewrite text: /rewrite formal | casual | <any tone>: text (Windows AI skill)' },
  { cmd: 'table', desc: 'Turn text into a table (Windows AI skill)' },
  { cmd: 'translate', desc: 'Translate: /translate French: text' },
  { cmd: 'explain', desc: 'Explain something simply, with an example' },
  { cmd: 'image', desc: 'Create a picture on your NPU: /image a lighthouse at sunset (add a photo to restyle it; “coloring:” for line art)' },
  { cmd: 'upscale', desc: 'Make an attached or recent picture larger and sharper (Windows AI)' },
  { cmd: 'cutout', desc: 'Remove the background from an attached or recent picture (Windows AI)' },
  { cmd: 'calc', desc: 'Exact calculator: /calc 12.5% of 480' },
  { cmd: 'remember', desc: 'Save a fact to memory' },
  { cmd: 'forget', desc: 'Remove something from memory' },
  { cmd: 'memory', desc: 'Open the memory manager' },
  { cmd: 'new', desc: 'Start a new chat' },
  { cmd: 'help', desc: 'What HybridMind can do — and what it can’t' },
];

const IMG_EXT = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'tif', 'tiff'];
const clipText = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);

function renderAll() { renderSidebar(); renderThread(); renderAttach(); updateSend(); if (typeof updateRouteUi === 'function') updateRouteUi(); }

// ── navigation ─────────────────────────────────────────────────────────
function newChat(opts = {}) {
  if (App.busy) { toast('Wait for the current reply to finish, or press Stop.'); return; }
  const prevAssistant = App.chat && !S_hasMessages() ? App.chat.assistantId : null;
  App.chat = Store.newChat({ assistantId: opts.assistantId || (opts.keepAssistant ? prevAssistant : null) || Store.settings.defaultAssistant, projectId: opts.projectId !== undefined ? opts.projectId : App.projectFilter, temporary: !!opts.temporary });
  App.attach = []; App.lastCtx = null;
  $('input').value = ''; autosize();
  renderAll(); updateRing();
  if (window.innerWidth <= 760) $('app').classList.add('collapsed');
  $('input').focus();
}

function openChat(id) {
  if (App.busy) { toast('Wait for the current reply to finish, or press Stop.'); return; }
  const c = Store.chats.get(id); if (!c) return;
  App.chat = c; App.attach = []; App.lastCtx = null;
  renderAll(); updateRing();
  if (window.innerWidth <= 760) $('app').classList.add('collapsed');
  $('input').focus();
}

// ── sending ────────────────────────────────────────────────────────────
function parseSlash(text) {
  const m = /^\/([a-z0-9-]+)(?:\s+([\s\S]*))?$/i.exec(text);
  if (!m) return null;
  const cmd = m[1].toLowerCase();
  if (SLASH.some((s) => s.cmd === cmd)) return { cmd, arg: (m[2] || '').trim() };
  const sk = Skills.find(cmd);
  return sk ? { cmd, arg: (m[2] || '').trim(), skill: sk } : null;
}

// every slash command: the built-in ones plus the user's enabled skills
function slashList() {
  const skills = Skills.enabled().map((s) => ({ cmd: s.dir, desc: (s.description || 'Skill') + (s.hint ? ' — ' + s.hint : ''), skill: true }));
  return SLASH.concat(skills.filter((s) => !SLASH.some((b) => b.cmd === s.cmd)));
}

async function send(override) {
  if (App.busy) return;
  const chat = App.chat;
  let text = (override !== undefined ? override : $('input').value).trim();
  const atts = App.attach.filter((a) => a.status === 'ready');
  if (!text && !atts.length) return;
  if (App.attach.some((a) => a.status === 'indexing')) { toast('Still reading your attachment…'); return; }
  const slash = parseSlash(text);
  if (slash && ['memory', 'new', 'help'].includes(slash.cmd)) {
    $('input').value = ''; autosize(); updateSend();
    if (slash.cmd === 'memory') return openMemory();
    if (slash.cmd === 'new') return newChat();
  }
  if (!text) text = 'Please summarize the attached ' + (atts.length === 1 ? 'file' : 'files') + '.';

  // the user's message joins the conversation
  const path = Store.path(chat);
  const parent = path.length ? path[path.length - 1].id : 'root';
  const userNode = Store.addNode(chat, parent, { role: 'user', content: text, attachments: atts.map((a) => ({ path: a.path, name: a.name, ext: a.ext, thumb: a.thumb || '' })) });
  if (atts.length) { for (const a of atts) if (!chat.scope.includes(a.path)) chat.scope.push(a.path); }
  if (!path.length) chat.title = clipText(text.replace(/\s+/g, ' '), 46);
  $('input').value = ''; App.attach = []; autosize(); renderAttach();
  App.stick = true;

  if (slash) return runSlash(chat, userNode, slash);
  await prepareTurn(chat, userNode);
}

// tools and memory commands run as code before the model is asked
async function prepareTurn(chat, userNode) {
  const text = userNode.content;
  userNode.tools = [];
  if (Store.settings.tools) {
    const cal = Tools.detectMath(text); if (cal) userNode.tools.push({ icon: 'calc', text: 'Calculator: ' + cal.text });
    const un = Tools.detectUnits(text); if (un) userNode.tools.push({ icon: 'calc', text: 'Units: ' + un.text });
    const dt = Tools.detectDates(text); if (dt) userNode.tools.push({ icon: 'calc', text: 'Dates: ' + dt.text });
  }
  // a message that clearly matches a skill's description uses that skill (shown as a chip; the user can regenerate without it)
  if (!userNode.skillName && !userNode.skillOff) {
    const hit = Skills.match(text);
    if (hit) { userNode.skillName = hit.dir; userNode.skillAuto = true; }
  }
  const pic = userNode.skillName ? null : Tools.imageIntent(text);
  if (pic && !(userNode.attachments || []).length) return generatePicture(chat, userNode, { op: 'generate', ...pictureStyle(pic) });
  const mc = Tools.memoryCommand(text);
  if (mc && !userNode.attachments.length) {
    if (mc.type === 'remember') return localMemoryReply(chat, userNode, mc.fact, null);
    if (mc.type === 'forget') return localMemoryReply(chat, userNode, null, mc.query);
  }
  return generateReply(chat, userNode, {});
}

function localReply(chat, userNode, md, meta, extra) {
  const a = Store.addNode(chat, userNode.id, Object.assign({ role: 'assistant', content: md, meta: Object.assign({ first: 0, gen: 0, local: true }, meta || {}) }, extra || {}));
  Store.saveChat(chat);
  renderThread(); renderSidebar(); updateSend();
  return a;
}

function localMemoryReply(chat, userNode, fact, forgetQuery) {
  if (chat.temporary) return localReply(chat, userNode, 'This is a **temporary chat**, so memory is off. Start a normal chat to save things to memory.');
  if (!Store.settings.memory) return localReply(chat, userNode, 'Memory is turned off. You can enable it in **Settings → Personalization**.');
  if (fact) {
    const m = Store.addMemory(fact, 'user', chat.id);
    return localReply(chat, userNode, `Got it — I’ll remember that.\n\n> ${m.text}\n\nYou can review or delete memories any time from the 🧠 button in the sidebar.`, { skill: 'Memory' }, { memoryAdded: [m] });
  }
  const hits = Tools.rank(Store.memories.map((m) => ({ id: m.id, text: m.text, m })), forgetQuery, 3, 0.3);
  if (!hits.length) return localReply(chat, userNode, `I couldn’t find anything in memory matching “${forgetQuery}”. Open the memory manager to see everything I remember.`, { skill: 'Memory' });
  const gone = hits[0].doc.m;
  Store.removeMemory(gone.id);
  return localReply(chat, userNode, `Done — I’ve forgotten this:\n\n> ${gone.text}`, { skill: 'Memory' }, { memoryRemoved: [gone] });
}

// ── slash commands ─────────────────────────────────────────────────────
async function runSlash(chat, userNode, { cmd, arg, skill }) {
  const att = userNode.attachments && userNode.attachments[0];
  if (skill) {
    if (!arg && !att) return localReply(chat, userNode, `The **${skill.title}** skill needs some input${skill.hint ? ' — ' + skill.hint : ''}. Example: \`/${skill.dir} …\`, or attach a file.`, { skill: 'Skill' });
    userNode.skillName = skill.dir;
    userNode.prompt = arg || 'Use the attached file.';
    userNode.tools = [];
    return generateReply(chat, userNode, {});
  }
  if (cmd === 'help') return localReply(chat, userNode, HELP_MD);
  if (cmd === 'image' || cmd === 'upscale' || cmd === 'cutout') {
    const src = att ? att.path : lastPicture(chat, userNode);
    if (cmd === 'image') {
      if (!arg) return localReply(chat, userNode, 'Describe the picture, for example `/image a red bicycle leaning on a blue wall, flat illustration`.\n\nAttach a photo first to **restyle** it instead, or start with `coloring:` for line art.', { skill: 'Image generator' });
      return generatePicture(chat, userNode, att ? { op: 'restyle', prompt: arg, source: att.path } : { op: 'generate', ...pictureStyle(arg) });
    }
    if (!src) return localReply(chat, userNode, 'Attach a picture (📎, drag & drop or paste) and run `/' + cmd + '` again.', { skill: 'Windows AI' });
    return generatePicture(chat, userNode, { op: cmd, prompt: cmd, source: src });
  }
  if (cmd === 'calc') {
    if (!arg) return localReply(chat, userNode, 'Type an expression, for example `/calc 12.5% of 480` or `/calc (3+4)*2^3`.', { skill: 'Calculator' });
    const r = Tools.detectMath(arg) || (() => { try { const v = Tools.evaluate(arg); return { text: `${arg} = ${Tools.fmtNum(v)}` }; } catch { return null; } })();
    return localReply(chat, userNode, r ? '**' + r.text + '**\n\nComputed by code in the app, not by the AI model.' : 'I couldn’t read that as a calculation. Try something like `/calc 12.5% of 480`.', { skill: 'Calculator (code)' });
  }
  if (cmd === 'remember') return arg ? localMemoryReply(chat, userNode, Tools.firstToThird(arg), null) : localReply(chat, userNode, 'Tell me what to remember, for example `/remember I prefer metric units`.');
  if (cmd === 'forget') return arg ? localMemoryReply(chat, userNode, null, arg) : localReply(chat, userNode, 'Tell me what to forget, for example `/forget my favourite colour`.');
  if (['summarize', 'tldr', 'rewrite', 'table'].includes(cmd)) {
    let name = cmd === 'tldr' ? 'summarize-paragraph' : cmd, tone = null, text = arg;
    if (cmd === 'rewrite') {
      const m = /^(formal|casual|general)\b[:\s-]*([\s\S]*)$/i.exec(arg);
      const c = /^([^:\n]{3,40}):\s*([\s\S]+)$/.exec(arg);
      if (m) { tone = m[1].toLowerCase(); text = m[2]; } else if (c) { tone = c[1].trim(); text = c[2]; } else tone = 'general';
    }
    if (!text && !att) return localReply(chat, userNode, `Add some text after the command, or attach a file. Example: \`/${cmd}${cmd === 'rewrite' ? ' formal' : ''} <your text>\``, { skill: 'Windows AI' });
    return generateReply(chat, userNode, { skill: { name, tone, text, docPath: !text && att ? att.path : null, label: { summarize: 'Text summarizer', 'summarize-paragraph': 'Text summarizer', rewrite: 'Text rewriter' + (tone && tone !== 'general' ? ' · ' + tone : ''), table: 'Text-to-table' }[name] } });
  }
  if (cmd === 'translate' || cmd === 'explain') {
    if (!arg && !att) return localReply(chat, userNode, cmd === 'translate' ? 'Example: `/translate French: Could we meet on Thursday?`' : 'Example: `/explain how a heat pump works`');
    let prompt;
    if (cmd === 'translate') {
      const m = /^([A-Za-zÀ-ɏ ]{2,24})\s*[:\-]\s*([\s\S]+)$/.exec(arg) || /^(?:to\s+)?([A-Za-z]{3,20})\s+([\s\S]+)$/.exec(arg);
      prompt = m ? `Translate the following text into ${m[1].trim()}. Reply with the translation only.\n\n${m[2].trim()}` : `Translate the following text into English if it is in another language, otherwise ask which language to use. Reply with the translation only.\n\n${arg}`;
    } else prompt = `Explain the following in simple terms, with one short example:\n\n${arg || 'the attached file'}`;
    userNode.prompt = prompt;
    return generateReply(chat, userNode, {});
  }
  return generateReply(chat, userNode, {});
}

const HELP_MD = `**HybridMind** answers on this PC with Windows’ on-device AI first, and can hand a request to **your own cloud model** when the on-device one can’t do it well — only under the rules you set (Settings → Routing & privacy). Every reply shows where it ran and why.\n\n` +
  `- **Routing** — the switch at the top of a chat: **Auto**, **On-device** or **Cloud**. Auto escalates for very long inputs, hard reasoning, an unavailable or unreliable on-device answer. Use *Retry in cloud* / *Retry on device* under any reply\n` +
  `- **Agent mode** — the ⚡ button in the message box lets your cloud model use tools in a loop: search and read the folders you allow (Settings → Agent), and write results to a working folder, with your approval for every write. It can’t run programs, delete or touch anything else\n` +
  `- **Privacy guard** — before anything goes to the cloud you can preview it; keys, passwords, cards, e-mails and phone numbers can be redacted first. The cloud usage log (Settings) records what was sent and why\n` +
  `- **Chat** with streaming replies, regenerate, edit your message (versions are kept) and search past chats (Ctrl+K)\n` +
  `- **Files** — attach documents, PDFs, spreadsheets, slides, notes, code or images (📎, drag & drop, or paste a screenshot). Scanned pages and images are read with on-device OCR; photos can be described by an on-device model\n` +
  `- **Memory** — say “remember that I prefer metric units”; review or delete everything in the memory manager\n` +
  `- **Assistants & projects** — preset personas (Writer, Coder, Tutor…) and groups of chats with shared instructions and files\n` +
  `- **Windows AI skills** — \`/summarize\`, \`/tldr\`, \`/rewrite\`, \`/table\`\n` +
  `- **Pictures** — attach or paste a photo and ask about it (an on-device model describes it and reads any text). \`/image\` creates a picture, \`/upscale\` enlarges one and \`/cutout\` removes its background — these use Windows AI models that Windows downloads on first use, and aren't available on every PC (Settings → Model shows the status)
` +
  `- **Skills** — saved instruction packs. Run one with \`/skill-name your text\` or let HybridMind pick it when your message matches. Create, edit and import them in Settings → Skills\n` +
  `- **Exact tools** — \`/calc\`, unit conversions and date maths are computed by code, not guessed by the model\n` +
  `- **Run code** — JavaScript blocks have a Run button (sandboxed, no network); HTML/SVG blocks have Preview\n\n` +
  `**What it can’t do:** browse the web or know today’s news, or take voice dictation. Without a cloud model configured, hard reasoning is limited to a small on-device model; cloud answers come from whatever model you configure. Either way — double-check anything important.`;

// ── generating a reply ─────────────────────────────────────────────────
function buildRequest(chat, userNode, rid, vary, route) {
  route = route || 'device';
  const cloud = route === 'cloud', rs = Store.settings.route;
  const path = Store.path(chat);
  const idx = path.findIndex((n) => n.id === userNode.id);
  const hist = path.slice(0, idx).filter((n) => (n.content || '').trim() && !n.error).map((n) => ({
    role: n.role,
    content: n.role === 'user' && n.attachments && n.attachments.length ? n.content + '\n(attached: ' + n.attachments.map((a) => a.name).join(', ') + ')' : n.content,
  }));
  const text = userNode.prompt || userNode.content;
  let summary = null;
  if (chat.summary && chat.summaryUpTo && path.slice(0, idx).some((n) => n.id === chat.summaryUpTo)) summary = chat.summary;
  const skill = userNode.skillName && !userNode.skillOff ? Skills.find(userNode.skillName) : null;
  const sys = buildSystem(chat, route) + (skill ? '\n\n' + Skills.block(skill, text) : '');
  // what may leave the PC: personalisation (name, about-me, memories, recalled chats), files and pictures are each opt-in for the cloud
  const personal = !cloud || rs.sendPersonal;
  const mem = chat.temporary || !personal ? '' : memoryBlock(text);
  const recall = [];
  if (personal && Store.settings.recall && !chat.temporary && Tools.RECALL_CUE.test(text))
    for (const d of Store.recall(text, chat.id)) recall.push(`(${d.title}, ${new Date(d.ts).toLocaleDateString()}) ${clipText(d.text.replace(/\s+/g, ' '), 260)}`);
  const files = !cloud || rs.sendFiles;
  const atts = userNode.attachments || [];
  const req = {
    rid, system: sys + (mem ? '\n\n' + mem : ''), summary, history: hist, user: text,
    inlineDocs: files ? atts.map((a) => a.path) : [], scope: files ? effectiveScope() : [], recall,
    notes: (userNode.tools || []).map((t) => t.text), maxPrompt: Store.settings.maxPrompt || 7500,
    images: cloud && rs.sendImages && Router.cfg && Router.cfg.vision ? atts.filter((a) => IMG_EXT.includes((a.ext || '').toLowerCase())).map((a) => a.path) : [],
  };
  // the on-device model decodes deterministically by default; a regenerate needs some randomness or it would repeat itself
  if (vary) req.temperature = Math.max(Store.settings.temperature == null ? 0 : Store.settings.temperature, 0.8);
  else if (Store.settings.temperature != null) req.temperature = Store.settings.temperature;
  userNode.usedRecall = recall.length;
  return req;
}

const KIND_TEXT = { unreachable: 'couldn’t be reached', auth: 'rejected the key', config: 'isn’t configured correctly', rate: 'is rate-limiting', filter: 'declined the request', context: 'can’t take a message this long', http: 'returned an error' };

// Run one chat turn through the router: on-device when it can do the job, the cloud when it can't (with consent / privacy checks and fallbacks).
async function runRouted(chat, userNode, asst, rid, opts) {
  let decision = opts.forceDevice ? { target: 'device', reason: 'You chose to retry on your device', code: 'user', explicit: true }
    : opts.forceCloud ? { target: 'cloud', reason: 'You chose to retry in the cloud', code: 'user', explicit: true }
    : Router.decide(chat, userNode);
  const build = (route) => buildRequest(chat, userNode, rid, !!opts.vary, route);
  const cloudRoute = (d) => ({ target: 'cloud', reason: d.reason, code: d.code, model: Router.cfg.model });
  const settings = Store.settings.route;
  let note = decision.notice ? decision.reason : null;

  if (decision.target === 'cloud') {
    const out = await Router.tryCloud(chat, userNode, asst, rid, decision, build);
    if (out.cancelled) return { res: { ok: true, cancelled: true, text: '' }, route: { target: 'device', reason: 'Cancelled', code: 'cancelled' } };
    if (out.res) {
      const r = out.res;
      r.route = 'cloud';
      if (r.ok || r.cancelled) return { res: r, route: cloudRoute(decision) };
      const canFallback = settings.autoFallback && App.model.ok && !['filter', 'context', 'auth', 'config'].includes(r.errorKind || '') ;
      if (!canFallback) return { res: r, route: cloudRoute(decision), cloudFailed: true };
      note = 'The cloud model ' + (KIND_TEXT[r.errorKind] || 'failed') + ' — answered on your device instead';
    } else note = out.stay;
    asst.content = ''; asst.status = 'Answering on your device…'; paintStreamSoon(asst);
    decision = { target: 'device', reason: note, code: 'fallback', notice: true };
  }

  let res = await Native.chat(build('device'));
  res.route = 'device';
  const auto = Router.modeOf(chat) === 'auto' && !opts.forceDevice && decision.code !== 'fallback' && decision.code !== 'user' && decision.code !== 'temporary';
  if (auto && Router.ready() && settings.autoFallback && settings.consent !== 'never' && Router.looksFailed(res)) {
    const d2 = { target: 'cloud', reason: 'The on-device answer looked unreliable', code: 'local-failed' };
    asst.content = ''; asst.status = 'The on-device answer looked unreliable — trying the cloud…'; paintStreamSoon(asst);
    const out = await Router.tryCloud(chat, userNode, asst, rid, d2, build);
    if (out.res && (out.res.ok || out.res.cancelled)) { out.res.route = 'cloud'; return { res: out.res, route: cloudRoute(d2), deviceTried: true }; }
    if (out.cancelled) return { res: { ok: true, cancelled: true, text: '' }, route: { target: 'device', reason: 'Cancelled', code: 'cancelled' } };
    if (out.stay) note = out.stay;
  }
  return { res, route: { target: 'device', reason: decision.reason, code: decision.code, notice: decision.notice || !!note && decision.code === 'fallback' } };
}

// The Windows text skills run on-device; if the text is too long for them (or they fail) the cloud may do the same job.
const CLOUD_SKILL = {
  summarize: () => 'Summarize the following text as concise bullet points. Use only what the text says.',
  'summarize-paragraph': () => 'Summarize the following text as one short paragraph. Use only what the text says.',
  rewrite: (tone) => 'Rewrite the following text' + (tone && tone !== 'general' ? ' in a ' + tone + ' tone' : '') + ', keeping its meaning. Output only the rewritten text.',
  table: () => 'Convert the following text into a Markdown table with a header row. Output only the table.',
};
async function runTextSkill(chat, userNode, asst, rid, s) {
  let res = await Native.skill({ rid, name: s.name, text: s.text || '', tone: s.tone || null, docPath: s.docPath || null });
  res.firstTokenMs = 0; res.genMs = res.ms; res.text = res.text || '';
  const mode = Router.modeOf(chat), rs = Store.settings.route;
  const wantCloud = mode === 'cloud' || (mode === 'auto' && rs.autoFallback && rs.consent !== 'never' && (res.truncated || (!res.ok && !res.cancelled && !/content safety|declined|blocked/i.test(res.error || ''))));
  if (!wantCloud || !Router.ready() || (userNode.attachments || []).length && !rs.sendFiles || (chat.temporary && !rs.allowTemporary && mode !== 'cloud')) return { res, route: { target: 'device', reason: 'Windows AI text skill', code: 'skill' } };
  const d = { target: 'cloud', reason: res.truncated ? 'The text was longer than the on-device skill can take' : 'The on-device skill couldn’t finish', code: res.truncated ? 'too-big' : 'local-failed', explicit: mode === 'cloud' };
  asst.content = ''; paintStreamSoon(asst);
  const instr = (CLOUD_SKILL[s.name] || CLOUD_SKILL.summarize)(s.tone);
  const build = () => ({ rid, system: buildSystem(chat, 'cloud') + '\n\n' + instr, summary: null, history: [], user: s.text || 'Use the attached file.', inlineDocs: s.docPath ? [s.docPath] : [], scope: [], recall: [], notes: [], maxPrompt: 7500, images: [] });
  const out = await Router.tryCloud(chat, userNode, asst, rid, d, build);
  if (out.res && (out.res.ok || out.res.cancelled)) { out.res.route = 'cloud'; return { res: out.res, route: { target: 'cloud', reason: d.reason, code: d.code, model: Router.cfg.model }, skillLabel: s.label + ' (cloud)' }; }
  return { res, route: { target: 'device', reason: out.stay || 'Windows AI text skill', code: 'skill' } };
}

async function generateReply(chat, userNode, opts) {
  const asst = Store.addNode(chat, userNode.id, { role: 'assistant', content: '', streaming: true, status: opts.skill ? 'Working…' : 'Thinking…' });
  const rid = uid('q');
  App.busy = { rid, chatId: chat.id, nodeId: asst.id };
  renderThread(); updateSend();
  let res, routeInfo = { target: 'device', reason: '', code: '' }, extra = {};
  try {
    if (!Native.isNative) throw new Error('The desktop shell isn’t available — run the installed app.');
    const out = opts.skill ? await runTextSkill(chat, userNode, asst, rid, opts.skill) : chat.agent ? await runAgentTurn(chat, userNode, asst, rid) : await runRouted(chat, userNode, asst, rid, opts);
    res = out.res; routeInfo = out.route; extra = out;
  } catch (e) { res = { ok: false, error: e.message, text: asst.content || '' }; }

  asst.streaming = false;
  asst.content = res.text || '';
  asst.cancelled = !!res.cancelled;
  if (!res.ok && !res.cancelled) asst.error = res.error || 'The model returned no reply.';
  asst.sources = (res.sources || []).map((s) => ({ n: s.n, docName: s.docName, docPath: s.docPath, loc: s.loc, text: s.text, sent: s.sent }));
  asst.inlineDocs = res.inlineDocs || [];
  asst.terms = [...new Set(Tools.tokens(userNode.content))].filter((t) => t.length > 3).slice(0, 8);
  asst.route = { ...routeInfo, sentChars: res.sentChars || 0, redactions: res.redactions || 0, tokensIn: res.tokensIn || 0, tokensOut: res.tokensOut || 0, deviceTried: !!extra.deviceTried, errorKind: res.errorKind || null };
  asst.meta = { first: res.firstTokenMs || 0, gen: res.genMs || 0, prompt: res.promptChars || 0, hist: res.historyUsed || 0, dropped: res.historyDropped || 0, retr: res.retrievalMs || 0, skill: opts.skill ? (extra.skillLabel || opts.skill.label) : null, cloud: routeInfo.target === 'cloud' };
  const warn = [];
  if (routeInfo.notice && routeInfo.reason && routeInfo.target === 'device') warn.push(routeInfo.reason);
  if (res.userTruncated) warn.push('Your message was longer than the on-device model can read, so only the start was used. Attach long text as a file, use /summarize, or send it to the cloud.');
  if (res.truncated) warn.push('The text was longer than this Windows AI skill can take, so only the first part was used.');
  if (res.redactions) warn.push(res.redactions + ' sensitive-looking value' + (res.redactions === 1 ? ' was' : 's were') + ' replaced with placeholders before sending to the cloud.');
  if (warn.length) asst.warnings = warn;
  if (opts.skill && opts.skill.name === 'summarize' && !asst.content && !asst.error) asst.error = 'Nothing came back.';
  if (!opts.skill && routeInfo.target === 'device') App.lastCtx = { prompt: res.promptChars || 0, histUsed: res.historyUsed || 0, histDropped: res.historyDropped || 0, sources: (res.sources || []).filter((s) => s.sent).length, inline: (res.inlineDocs || []).length };
  App.busy = null; Router.cancelHook = null;
  Store.saveChat(chat);
  if (App.chat === chat) { renderThread(true); scrollBottom(); }
  renderSidebar(); updateSend(); updateRing(); updateRouteUi();
  if (res.ok && !res.cancelled && asst.content) afterReply(chat, userNode, asst, res);
}

function stopGenerating() {
  if (Router.cancelHook) { Router.cancelHook(); return; }
  if (App.busy) Native.cancel(App.busy.rid).catch(() => {});
}

// streamed text from the host
Native.on((ev) => {
  if (ev.event !== 'chat' || !App.busy || ev.rid !== App.busy.rid) return;
  const chat = Store.chats.get(App.busy.chatId) || App.chat;
  const n = chat && chat.nodes[App.busy.nodeId];
  if (!n || !n.streaming) return;
  if (ev.kind === 'text') n.content = ev.text; else n.status = ev.text;
  if (App.chat === chat) paintStreamSoon(n);
});

// ── after a reply: title, memory, rolling summary (all low priority; the next message pre-empts them) ──
async function afterReply(chat, userNode, asst, res) {
  try {
    const first = Store.path(chat).filter((n) => n.role === 'assistant').length === 1;
    if (first && !chat.titleLocked) {
      const t = await Native.bg({ name: 'title', text: userNode.content });
      if (t && t.ok && t.text && !chat.titleLocked) { chat.title = t.text; Store.touchIndex(chat); renderSidebar(); renderTop(); }
    }
  } catch { /* background job: ignore */ }
  try {
    if (Store.settings.memory && Store.settings.autoMemory && !chat.temporary && !userNode.prompt && Tools.FACT_CUE.test(userNode.content) && !/\?\s*$/.test(userNode.content.trim())) {
      const r = await Native.bg({ name: 'memory', text: userNode.content, existing: Store.memories.map((m) => m.text) });
      if (r && r.ok && r.facts && r.facts.length) {
        const added = r.facts.map((f) => Store.addMemory(f, 'auto', chat.id)).filter(Boolean);
        if (added.length) { asst.memoryAdded = added; Store.saveChat(chat); if (App.chat === chat) refreshMsg(asst.id); renderTop(); }
      }
    }
  } catch { /* ignore */ }
  try {
    if (res.historyDropped > 0 && !chat.temporary) {
      const path = Store.path(chat);
      const idx = path.findIndex((n) => n.id === userNode.id);
      const cutoff = res.historyDropped;                      // path[0 .. cutoff) are the messages the model could not see
      const upTo = path[cutoff - 1];
      if (upTo && chat.summaryUpTo !== upTo.id) {
        const startAt = chat.summaryUpTo ? path.findIndex((n) => n.id === chat.summaryUpTo) + 1 : 0;
        const slice = path.slice(Math.max(0, startAt), cutoff).filter((n) => (n.content || '').trim());
        if (slice.length) {
          const text = slice.map((n) => (n.role === 'user' ? 'User: ' : 'Assistant: ') + clipText(n.content.replace(/\s+/g, ' '), 500)).join('\n');
          const prev = startAt > 0 ? chat.summary : '';
          const r = await Native.bg({ name: 'summary', text, summary: prev });
          if (r && r.ok && r.text) { chat.summary = r.text; chat.summaryUpTo = upTo.id; Store.saveChat(chat); }
        }
      }
    }
  } catch { /* ignore */ }
}

// ── pictures: generate / restyle / upscale / cut out (Windows AI, on-device) ──
function pictureStyle(text) {
  const m = /^(?:coloring(?: book)?|line ?art)\s*[:\-]\s*([\s\S]+)$/i.exec(text.trim());
  return m ? { prompt: m[1].trim(), style: 'coloring' } : { prompt: text.trim(), style: 'default' };
}
function lastPicture(chat, beforeNode) {
  const path = Store.path(chat);
  const stop = beforeNode ? path.findIndex((n) => n.id === beforeNode.id) : path.length;
  for (let i = (stop < 0 ? path.length : stop) - 1; i >= 0; i--) {
    const n = path[i];
    if (n.images && n.images.length) return n.images[0].path;
    const a = (n.attachments || []).find((x) => IMG_EXT.includes((x.ext || '').toLowerCase()));
    if (a) return a.path;
  }
  return null;
}
const PIC_LABEL = { generate: 'Image generator', restyle: 'Image generator · restyle', upscale: 'Image upscaler', cutout: 'Background remover' };

// Cloud picture generation: the fallback when the on-device generator isn't available on this PC (or the user asks for the cloud).
async function cloudPicture(chat, rid, p, reason, explicit) {
  const s = Store.settings.route;
  if (!Router.ready() || !Router.cfg.imageModel) return { stay: 'no cloud image model is configured' };
  if (chat.temporary && !s.allowTemporary && !explicit) return { stay: 'temporary chats stay on this PC' };
  if (s.consent === 'never' && !explicit) return { stay: 'cloud use is set to “only when I retry”' };
  let prep;
  try { prep = await Native.cloudScan(p.prompt); } catch (e) { return { stay: e.message }; }
  prep.model = Router.cfg.imageModel; prep.host = Router.host(); prep.chars = p.prompt.length;
  const found = prep.findings || [];
  const log = (extra) => Store.addCloudLog({ ts: Date.now(), chatId: chat.id, title: chat.title, model: Router.cfg.imageModel, host: Router.host(), reason, mode: Router.modeOf(chat), ...extra });
  if (found.length && s.privacy === 'block' && !explicit) { log({ sent: false, chars: 0, blocked: found.map((f) => f.kind) }); return { stay: 'the prompt contains sensitive-looking data' }; }
  let redacted = found.length > 0 && s.privacy === 'redact';
  const needAsk = (found.length > 0 && s.privacy !== 'redact') || (!explicit && s.consent === 'ask' && !chat.cloudOk);
  if (needAsk) {
    const d = await Router.dialog(prep, { reason: reason + '.', offerAlways: !explicit && s.consent === 'ask' && !chat.cloudOk });
    if (d.action === 'cancel') return { cancelled: true };
    if (d.action === 'device') { log({ sent: false, chars: 0, declined: true }); return { stay: 'you kept this on your device' }; }
    redacted = !!d.redacted;
    if (d.always) { chat.cloudOk = true; Store.saveChat(chat); }
  }
  const prompt = redacted ? prep.redacted[0].content : p.prompt;
  let res;
  try { res = await Native.cloudImage({ rid, op: 'generate', prompt }); } catch (e) { res = { ok: false, error: e.message }; }
  log({ sent: true, ok: !!res.ok, chars: prompt.length, redactions: redacted ? found.reduce((a, f) => a + f.count, 0) : 0, error: res.ok ? null : 'http' });
  return { res };
}

async function generatePicture(chat, userNode, p) {
  const asst = Store.addNode(chat, userNode.id, { role: 'assistant', content: '', streaming: true, status: 'Preparing…', imgParams: p });
  const rid = uid('q');
  App.busy = { rid, chatId: chat.id, nodeId: asst.id };
  renderThread(); updateSend();
  let res, route = { target: 'device', reason: 'On-device picture generator', code: 'ok' }, note = null;
  try {
    if (!Native.isNative) throw new Error('The desktop shell isn’t available — run the installed app.');
    const mode = Router.modeOf(chat);
    const cloudOnly = p.op === 'generate' && !p.forceDevice && (p.forceCloud || mode === 'cloud');
    const canCloud = p.op === 'generate' && !p.forceDevice && mode !== 'device';
    if (cloudOnly && Router.ready() && Router.cfg.imageModel) {
      const out = await cloudPicture(chat, rid, p, 'You chose the cloud for this picture', true);
      if (out.cancelled) res = { ok: true, cancelled: true };
      else if (out.res && (out.res.ok || out.res.cancelled)) { res = out.res; route = { target: 'cloud', reason: 'You chose the cloud for this picture', code: 'user', model: Router.cfg.imageModel }; }
      else note = out.stay || (out.res && out.res.error);
    }
    if (!res) {
      res = await Native.image({ rid, op: p.op, prompt: p.prompt || '', style: p.style || null, source: p.source || null, seed: p.seed == null ? null : p.seed });
      if (!res.ok && res.unavailable && canCloud && Store.settings.route.autoFallback && Router.ready() && Router.cfg.imageModel) {
        asst.status = 'The on-device picture generator isn’t available on this PC — trying the cloud…'; paintStreamSoon(asst);
        const out = await cloudPicture(chat, rid, p, 'The on-device picture generator isn’t available on this PC', false);
        if (out.cancelled) res = { ok: true, cancelled: true };
        else if (out.res && out.res.ok) { res = out.res; route = { target: 'cloud', reason: 'The on-device picture generator isn’t available on this PC', code: 'local-unavailable', model: Router.cfg.imageModel }; }
        else if (out.stay) res.error = (res.error || '') + ' (Not tried in the cloud: ' + out.stay + '.)';
      } else if (!res.ok && res.unavailable && canCloud && Router.ready() && !Router.cfg.imageModel) res.error = (res.error || '') + ' Tip: add a cloud image model in Settings → Cloud to use as a fallback.';
    }
  } catch (e) { res = { ok: false, error: e.message }; }
  asst.streaming = false;
  asst.cancelled = !!res.cancelled;
  if (res.ok && !res.cancelled) {
    asst.images = [{ url: res.url, path: res.path, w: res.width, h: res.height, op: p.op, prompt: p.prompt, seed: res.seed, cloud: route.target === 'cloud' }];
    asst.content = { generate: '**“' + p.prompt + '”**', restyle: '**Restyled:** “' + p.prompt + '”', upscale: 'Upscaled to ' + res.width + ' × ' + res.height + ' px.', cutout: 'Background removed — saved as a transparent PNG.' }[p.op] || '';
  } else if (!res.ok) asst.error = res.error || note || 'The picture could not be made.';
  asst.route = route;
  asst.meta = { first: 0, gen: res.ms || 0, skill: PIC_LABEL[p.op], img: true, cloud: route.target === 'cloud' };
  App.busy = null; Router.cancelHook = null;
  Store.saveChat(chat);
  if (App.chat === chat) { renderThread(true); scrollBottom(); }
  renderSidebar(); updateSend(); updateRouteUi();
}

// ── regenerate / edit / versions ───────────────────────────────────────
async function regenerate(nodeId, extra) {
  if (App.busy) return;
  const chat = App.chat, n = chat.nodes[nodeId]; if (!n) return;
  const user = chat.nodes[n.parent]; if (!user || user.role !== 'user') return;
  App.stick = true;
  if (n.imgParams) return generatePicture(chat, user, { ...n.imgParams, seed: null, forceCloud: !!(extra && extra.forceCloud), forceDevice: !!(extra && extra.forceDevice) });
  const sl = parseSlash(user.content);
  if (sl && ['summarize', 'tldr', 'rewrite', 'table'].includes(sl.cmd)) return runSlash(chat, user, sl);
  await generateReply(chat, user, { vary: !(extra && (extra.forceCloud || extra.forceDevice)), ...(extra || {}) });
}

function startEdit(nodeId) {
  if (App.busy) { toast('Wait for the reply to finish, or press Stop.'); return; }
  const chat = App.chat, n = chat.nodes[nodeId];
  const el = document.querySelector(`.msg[data-id="${nodeId}"] .body`);
  if (!el || !n) return;
  const ta = h('textarea', { class: 'editbox', value: n.content });
  const save = async () => {
    const v = ta.value.trim(); if (!v) return;
    if (v === n.content) return renderThread(true);
    const node = Store.addNode(chat, n.parent, { role: 'user', content: v, attachments: n.attachments || [] });
    if (chat.nodes[n.parent] && chat.nodes[n.parent].role === 'root' && !chat.titleLocked) chat.title = clipText(v.replace(/\s+/g, ' '), 46);
    App.stick = true;
    const sl = parseSlash(v);
    if (sl) return runSlash(chat, node, sl);
    await prepareTurn(chat, node);
  };
  el.innerHTML = '';
  el.append(ta, h('div', { class: 'editbtns' }, h('button', { class: 'btn sm', onclick: () => renderThread(true) }, 'Cancel'), h('button', { class: 'btn sm pri', onclick: save }, 'Save & resend')));
  ta.style.height = 'auto'; ta.style.height = Math.min(260, ta.scrollHeight + 4) + 'px';
  ta.focus();
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || !e.shiftKey)) { e.preventDefault(); save(); } if (e.key === 'Escape') renderThread(true); });
}

function switchVersion(nodeId, delta) {
  if (App.busy) return;
  const chat = App.chat, n = chat.nodes[nodeId];
  if (n && Store.switchSibling(chat, n, delta)) { Store.saveChat(chat); renderThread(true); }
}

function setFeedback(nodeId, kind) {
  const chat = App.chat, n = chat.nodes[nodeId]; if (!n) return;
  n.feedback = n.feedback === kind ? null : kind;
  Store.saveChat(chat); refreshMsg(nodeId);
  toast(n.feedback ? 'Thanks — saved on this PC only (it isn’t sent anywhere).' : 'Feedback removed.');
}

// ── read aloud (on-device voices) ──────────────────────────────────────
function pickVoice() {
  const voices = speechSynthesis.getVoices().filter((v) => v.localService);
  if (Store.settings.voice) { const v = voices.find((x) => x.name === Store.settings.voice); if (v) return v; }
  const lang = (navigator.language || 'en-US').toLowerCase();
  return voices.find((v) => v.lang.toLowerCase() === lang) || voices.find((v) => v.lang.toLowerCase().startsWith(lang.slice(0, 2))) || voices[0] || null;
}
function speak(nodeId) {
  if (!('speechSynthesis' in window)) return toast('This PC has no speech voices available.');
  const chat = App.chat, n = chat.nodes[nodeId];
  const was = App.speaking;
  speechSynthesis.cancel();
  App.speaking = null;
  if (was) refreshMsg(was);
  if (was === nodeId) return;
  const u = new SpeechSynthesisUtterance(MD.plain(n.content));
  const v = pickVoice(); if (v) u.voice = v;
  u.rate = Store.settings.rate || 1;
  u.onend = u.onerror = () => { if (App.speaking === nodeId) { App.speaking = null; refreshMsg(nodeId); } };
  App.speaking = nodeId; refreshMsg(nodeId);
  speechSynthesis.speak(u);
}

// ── attachments ────────────────────────────────────────────────────────
async function refreshLibrary() {
  try { const lib = await Native.getLibrary(); App.docs = (lib && lib.docs) || []; } catch { App.docs = App.docs || []; }
}

// Attach files that are already on disk (paths) or were dropped onto the window (File objects; the host reads their paths).
async function attachPaths(paths, dropFiles) {
  const describe = !!Store.settings.describePhotos;
  const placeholders = dropFiles
    ? [{ id: uid('a'), path: '', name: dropFiles.length === 1 ? dropFiles[0].name : dropFiles.length + ' items', ext: dropFiles.length === 1 ? extOf(dropFiles[0].name) : '', status: 'indexing', note: '' }]
    : paths.map((p) => ({ id: uid('a'), path: p, name: baseName(p), ext: extOf(p), status: 'indexing', note: '' }));
  if (placeholders.length <= 6) { App.attach.push(...placeholders); renderAttach(); updateSend(); }
  else toast('Reading ' + placeholders.length + ' files…', null, 8000);
  let sum;
  try { sum = dropFiles ? await Native.dropPaths(dropFiles, describe) : await Native.indexPaths(paths, describe); }
  catch (e) {
    for (const a of placeholders) { a.status = 'error'; a.note = e.message; }
    renderAttach(); updateSend(); toast('Couldn’t read the file: ' + e.message);
    return;
  }
  await refreshLibrary();
  App.attach = App.attach.filter((a) => !placeholders.includes(a));
  const got = sum.paths || [];
  if (got.length > 6) {
    // a folder or a big drop becomes knowledge for this chat rather than a pile of chips
    let n = 0;
    for (const p of got) { const d = App.docs.find((x) => x.path === p); if (d && d.status === 'indexed') { if (!App.chat.scope.includes(p)) App.chat.scope.push(p); n++; } }
    toast(n + ' file' + (n === 1 ? '' : 's') + ' added to this chat’s knowledge' + (sum.skipped ? ' (' + sum.skipped + ' skipped)' : '') + '.');
  } else {
    for (const p of got) {
      const d = App.docs.find((x) => x.path === p);
      const ok = d && d.status === 'indexed';
      App.attach.push({ id: uid('a'), path: p, name: baseName(p), ext: extOf(p), status: ok ? 'ready' : 'error', note: ok ? d.note || '' : d ? d.note || 'Nothing readable' : 'Not indexed' });
    }
    if (!got.length) toast((sum.messages && sum.messages[0]) || 'Nothing readable in that file.');
    else if (sum.messages && sum.messages.length) toast(sum.messages[0]);
  }
  renderAttach(); updateSend(); renderTop();
  for (const a of App.attach.filter((x) => IMG_EXT.includes(x.ext) && !x.thumb)) Native.thumb(a.path).then((t) => { a.thumb = t; renderAttach(); }).catch(() => {});
}

async function pickAttachments() {
  try { const paths = await Native.pickFiles(); if (paths && paths.length) await attachPaths(paths); } catch (e) { toast(e.message); }
}

async function attachPastedImage(blob) {
  const ext = (blob.type.split('/')[1] || 'png').replace('jpeg', 'jpg').replace(/[^a-z0-9]/g, '') || 'png';
  const b64 = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.readAsDataURL(blob); });
  try { const path = await Native.saveAttachment(ext, b64); await attachPaths([path]); } catch (e) { toast('Couldn’t attach the image: ' + e.message); }
}

// ── code blocks: copy / run in a sandbox / preview ─────────────────────
function codeOf(block) { return block.querySelector('pre code').textContent; }

function runCode(block) {
  let out = block.querySelector('.runout');
  if (!out) { out = h('div', { class: 'runout' }); block.append(out); }
  out.innerHTML = '<span class="meta">Running…</span>';
  const code = codeOf(block);
  const src = `const __f=(a)=>a.map(x=>{try{return typeof x==='string'?x:JSON.stringify(x)}catch(e){return String(x)}}).join(' ');
console.log=(...a)=>postMessage({t:'log',v:__f(a)});console.info=console.log;console.warn=(...a)=>postMessage({t:'log',v:'warn: '+__f(a)});console.error=(...a)=>postMessage({t:'err',v:__f(a)});
try{
${code}
}catch(e){postMessage({t:'err',v:String(e&&e.stack||e)})}
postMessage({t:'done'});`;
  const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
  let w; const lines = []; let finished = false;
  const done = (extra) => { if (finished) return; finished = true; clearTimeout(timer); try { w.terminate(); } catch { } URL.revokeObjectURL(url); out.innerHTML = lines.join('') + (extra || '') || '<span class="meta">(no output)</span>'; };
  const timer = setTimeout(() => done('<span class="err">Stopped: the code ran longer than 5 seconds.</span>'), 5000);
  try {
    w = new Worker(url);
    w.onmessage = (e) => { const m = e.data; if (m.t === 'log') lines.push(esc(m.v) + '\n'); else if (m.t === 'err') lines.push('<span class="err">' + esc(m.v) + '</span>\n'); else if (m.t === 'done') done('<span class="meta">— finished</span>'); };
    w.onerror = (e) => { e.preventDefault(); lines.push('<span class="err">' + esc(e.message || 'Script error') + '</span>\n'); done(); };
  } catch (e) { done('<span class="err">' + esc(e.message) + '</span>'); }
}

function previewCode(block) {
  let pv = block.querySelector('.preview');
  if (pv) { pv.remove(); return; }
  pv = h('div', { class: 'preview' });
  const f = h('iframe', { sandbox: '', title: 'Preview' });
  const code = codeOf(block);
  f.srcdoc = block.dataset.lang === 'svg' ? '<body style="margin:0;display:grid;place-items:center;min-height:100vh;background:#fff">' + code + '</body>' : code;
  pv.append(f); block.append(pv);
}

function openLink(url) {
  confirmBox('Open link in your browser?', url + '\n\nHybridMind works offline; this opens your default browser, which will connect to the internet.', 'Open', () => Native.openUrl(url).catch((e) => toast(e.message)), false);
}
