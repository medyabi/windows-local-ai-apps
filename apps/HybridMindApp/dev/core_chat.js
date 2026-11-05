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
    const out = opts.skill ? await runTextSkill(chat, userNode, asst, rid, opts.skill) : await runRouted(chat, userNode, asst, rid, opts);
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
