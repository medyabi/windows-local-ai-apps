'use strict';

// Hybrid routing: use the on-device Windows AI model whenever it can do the job, and the user's own cloud model only when it can't —
// always visibly, always with a way to say no. The page has no network access; cloud calls are made by the host process.
const Router = (() => {
  const R = { cfg: null, cancelHook: null };

  R.refresh = async () => { try { R.cfg = await Native.cloudConfigGet(); } catch { R.cfg = null; } return R.cfg; };
  R.ready = () => {
    const c = R.cfg;
    if (!c || !c.endpoint || !c.model) return false;
    return !!c.hasKey || /^https?:\/\/(localhost|127\.|\[::1\])/i.test(c.endpoint);
  };
  R.host = () => { try { return new URL(R.cfg.endpoint).host; } catch { return ''; } };
  R.modeOf = (chat) => chat.route || Store.settings.route.mode;

  // ── what the task needs ────────────────────────────────────────────────
  const docChars = (paths) => paths.reduce((n, p) => { const d = App.docs.find((x) => x.path === p); return n + (d ? (d.chunks || 0) * 650 : 0); }, 0);

  // How much a small on-device model is likely to struggle with this request (0 = fine). Heuristics, shown to the user as reasons.
  R.complexity = (text) => {
    const why = []; let score = 0;
    const words = /(\d{3,4})[- ]?words?\b/i.exec(text);
    if ((words && +words[1] >= 400) || /\b(essay|article|report|blog post|white ?paper|in[- ]depth|comprehensive|detailed (?:guide|analysis|plan|report))\b/i.test(text)) { score += 2; why.push('a long, detailed answer'); }
    if (/\b(write|implement|build|create|refactor|debug|fix|optimi[sz]e)\b[\s\S]{0,60}\b(function|class|script|program|api|app|component|algorithm|query|regex|module|service|test suite)\b/i.test(text) || (text.match(/\n/g) || []).length > 14 && /[{};=]/.test(text)) { score += 1; why.push('non-trivial code'); }
    if (/\b(prove|derive|step[- ]by[- ]step|trade-?offs?|root cause|strategy|architecture|critique|evaluate|analy[sz]e|reason about|compare\b[\s\S]{0,40}\b(?:and|vs\.?|versus)\b)/i.test(text)) { score += 1; why.push('multi-step reasoning'); }
    const nums = (text.match(/\d+(?:\.\d+)?/g) || []).length;
    if (nums >= 3 && /\b(how many|how much|percent|probability|rate|equation|solve|growth|interest|average)\b/i.test(text) && !Tools.detectMath(text)) { score += 1; why.push('a multi-number word problem'); }
    const letters = (text.match(/\p{L}/gu) || []).length, nonAscii = (text.match(/[^\u0000-ɏ\s\d\p{P}]/gu) || []).length;
    if (letters > 20 && nonAscii / letters > 0.25) { score += 1; why.push('text in a script the on-device model handles less well'); }
    return { score, why };
  };

  const WHOLE_DOC = /\b(summari[sz]e|summary of|translate|proofread|rewrite|extract (?:all|every)|list (?:all|every)|every|entire|whole|full (?:text|document)|compare (?:the )?(?:two|these) (?:documents|files))\b/i;
  const PIXELS = /\b(chart|graph|diagram|plot|screenshot|handwriting|handwritten|count (?:the|how many)|how many (?:people|objects|items)|what colou?r exactly|layout|ui |slide|table in)\b/i;

  const local = (reason, code, extra) => ({ target: 'device', reason, code, ...extra });
  const cloud = (reason, code, extra) => ({ target: 'cloud', reason, code, ...extra });

  R.decide = (chat, userNode) => {
    const s = Store.settings.route, mode = R.modeOf(chat), text = userNode.prompt || userNode.content || '';
    const explicitCloud = /\b(use|ask|try|send (?:this )?to)\s+(?:the\s+)?(?:cloud|gpt|openai|azure)\b/i.test(text);
    const explicitLocal = /\b(keep (?:this|it) (?:private|local|on[- ]device)|on[- ]device only|don'?t (?:send|use) (?:this |it )?(?:to )?the cloud)\b/i.test(text);
    if (mode === 'device' || explicitLocal) return local(explicitLocal ? 'You asked to keep this on your device' : 'Route set to On-device', 'user');
    if (!R.ready()) return local(mode === 'cloud' ? 'Cloud isn’t set up yet, so this ran on your device' : 'Cloud not set up', 'no-cloud', { notice: mode === 'cloud' });
    if (chat.temporary && !s.allowTemporary && mode !== 'cloud') return local('Temporary chat — kept on your device', 'temporary');
    if (mode === 'cloud' || explicitCloud) return cloud(explicitCloud && mode !== 'cloud' ? 'You asked for the cloud model' : 'Route set to Cloud', 'user', { explicit: true });

    // auto
    if (s.consent === 'never') return local('Cloud use is set to “only when I retry”', 'consent-never');
    if (!App.model.ok) return cloud('The on-device model isn’t available', 'local-unavailable');
    if (s.dailyCharCap > 0 && Store.cloudSentToday() >= s.dailyCharCap) return local('Daily cloud limit reached', 'cap', { notice: true });
    const atts = userNode.attachments || [];
    const scopePaths = effectiveScope();
    const hasDocs = atts.length > 0 || scopePaths.length > 0;
    if (hasDocs && !s.sendFiles) return local('Your files stay on this PC', 'files-private');

    const hard = [];
    if (text.length > 4500) hard.push('a very long message');
    const dChars = docChars(atts.map((a) => a.path));
    if (dChars > 3000 && WHOLE_DOC.test(text)) hard.push('a task over a whole large document');
    const histChars = Store.path(chat).reduce((n, m) => n + (m.content || '').length, 0);
    if (histChars > 16000 && s.policy !== 'local-first') hard.push('a very long conversation');
    const pics = atts.filter((a) => IMG_EXT.includes((a.ext || '').toLowerCase()));
    if (pics.length && s.sendImages && R.cfg.vision && PIXELS.test(text)) hard.push('a question about the picture’s contents that a text description can’t answer');
    if (hard.length) return cloud('This needs more than the on-device model can handle: ' + hard.join(', '), 'too-big', { why: hard });

    const c = R.complexity(text);
    const need = { 'local-first': 3, balanced: 2, 'quality-first': 1 }[s.policy] || 3;
    if (c.score >= need) return cloud('This looks hard for a small on-device model: ' + c.why.join(', '), 'complex', { why: c.why });
    return local(c.score ? 'Simple enough for the on-device model' : 'On-device model can handle this', 'ok');
  };

  // Did the on-device answer fail or look unreliable (so the cloud should get a chance)?
  R.looksFailed = (res) => {
    if (res.cancelled) return false;
    if (!res.ok) return !/content safety|declined|blocked/i.test(res.error || '');
    const t = (res.text || '').trim();
    if (t.length < 2) return true;
    if (t.length < 300 && /^(?:i'?m sorry,?\s*(?:but\s*)?)?(?:i (?:can(?:no|')t|am unable|'m unable|do not have|don'?t have)|as an ai(?: language model)?,? i (?:can(?:no|')t|don'?t))/i.test(t)) return true;
    const m = /(.{12,40}?)\1{3,}/s.exec(t);
    return !!m;
  };

  // ── the consent / privacy dialog ───────────────────────────────────────
  const hl = (t) => esc(t.length > 6000 ? t.slice(0, 6000) + '\n… (' + (t.length - 6000) + ' more characters)' : t).replace(/\[([A-Z_]+_\d+)\]/g, '<mark>[$1]</mark>');
  function describeSent(prep) {
    const rows = [];
    rows.push(['Goes to', `${esc(prep.model)} at ${esc(prep.host)}`]);
    rows.push(['Size', `${prep.chars.toLocaleString()} characters in ${prep.messages.length} messages`]);
    if (prep.inlineDocs.length) rows.push(['Files in full', prep.inlineDocs.map(esc).join(', ')]);
    const ex = prep.sources.filter((s) => s.sent);
    if (ex.length) rows.push(['File excerpts', ex.length + ' passages from ' + [...new Set(ex.map((s) => s.docName))].map(esc).join(', ')]);
    const pics = prep.messages.reduce((n, m) => n + (m.images || 0), 0);
    if (pics) rows.push(['Pictures', pics + ' picture' + (pics === 1 ? '' : 's')]);
    return rows;
  }

  // returns { action: 'send' | 'device' | 'cancel', redacted, always }
  R.dialog = (prep, opts) => new Promise((resolve) => {
    const found = prep.findings || [];
    const secret = found.some((f) => f.level === 'secret');
    const rows = describeSent(prep);
    const always = h('input', { type: 'checkbox' });
    let done = false;
    const finish = (v) => { if (done) return; done = true; R.cancelHook = null; closeModalNow(); resolve(v); };
    R.cancelHook = () => finish({ action: 'cancel' });
    const showRed = h('div', { class: 'pre-wrap' });
    const draw = (red) => { const m = (red ? prep.redacted : prep.messages); showRed.innerHTML = m.map((x) => `<div class="pv-role">${esc(x.role)}${x.images ? ' · +' + x.images + ' picture(s)' : ''}</div><pre>${red ? hl(x.content) : esc(x.content.slice(0, 6000))}</pre>`).join(''); };
    draw(found.length > 0);
    const body = h('div', {},
      h('p', { style: 'margin:2px 0 10px;color:var(--text2)' }, opts.reason),
      h('dl', { class: 'kv', html: rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('') }),
      found.length ? h('div', { class: 'note warn', html: `<b>Sensitive-looking values found:</b> ` + found.map((f) => `${esc(f.kind.replace('_', ' ').toLowerCase())} ×${f.count} <span style="opacity:.7">(${f.samples.map(esc).join(', ')})</span>`).join('; ') + `.<br>Redacting replaces each with a placeholder such as <code>[EMAIL_1]</code> before sending and puts the original back in the reply. This catches patterns (keys, cards, e-mails, phone numbers) — <b>not</b> names, addresses or confidential wording.` }) : null,
      h('details', { class: 'sources', style: 'margin-top:10px' }, h('summary', {}, h('span', { html: ic('eye') }), h('span', {}, 'Preview exactly what would be sent')), h('div', { style: 'padding:8px 12px;max-height:240px;overflow:auto' }, showRed)),
      opts.offerAlways ? h('label', { style: 'display:flex;gap:8px;align-items:center;margin-top:12px;font-size:13.5px' }, always, 'Don’t ask again in this chat') : null);
    const actions = [{ label: 'Keep on this PC', fn: () => finish({ action: 'device' }) }];
    if (found.length) {
      actions.push({ label: secret ? 'Send as is (includes secrets)' : 'Send as is', danger: secret, fn: () => finish({ action: 'send', redacted: false, always: always.checked }) });
      actions.push({ label: 'Send redacted', pri: true, fn: () => finish({ action: 'send', redacted: true, always: always.checked }) });
    } else actions.push({ label: 'Send to cloud', pri: true, fn: () => finish({ action: 'send', redacted: false, always: always.checked }) });
    openModal({ title: 'Use the cloud model for this message?', body, actions: actions.map((a) => ({ ...a, fn: () => a.fn() })), onClose: () => finish({ action: 'cancel' }) });
  });

  // ── try the cloud for one message ──────────────────────────────────────
  // returns { res } on a cloud answer, or { stay: 'why' } if the message should be answered on device instead
  R.tryCloud = async (chat, userNode, asst, rid, decision, buildReq) => {
    const s = Store.settings.route;
    const log = (extra) => Store.addCloudLog({ ts: Date.now(), chatId: chat.id, title: chat.title, model: R.cfg.model, host: R.host(), reason: decision.reason, mode: R.modeOf(chat), ...extra });
    asst.status = 'Checking what would be sent to the cloud…'; paintStreamSoon(asst);
    let prep;
    try { prep = await Native.cloudPrepare(buildReq('cloud')); } catch (e) { return { stay: 'Cloud request failed to start (' + e.message + ')' }; }
    if (!prep.ok) return { stay: prep.error || 'Cloud isn’t configured' };
    const found = prep.findings || [];
    const explicit = !!decision.explicit;

    if (found.length && s.privacy === 'block' && !explicit) {
      log({ sent: false, chars: 0, blocked: found.map((f) => f.kind) });
      await Native.cloudDiscard(prep.prepId).catch(() => {});
      return { stay: 'Kept on device: it contains sensitive-looking data (' + [...new Set(found.map((f) => f.kind.toLowerCase().replace('_', ' ')))].join(', ') + ')', blocked: true };
    }
    const needPrivacyAsk = found.length > 0 && (s.privacy === 'ask' || (s.privacy === 'block' && explicit));
    const needConsent = !explicit && s.consent === 'ask' && !chat.cloudOk;
    let redacted = found.length > 0 && !needPrivacyAsk;     // 'redact' policy redacts automatically
    if (needPrivacyAsk || needConsent) {
      asst.status = 'Waiting for your OK to use the cloud…'; paintStreamSoon(asst);
      const d = await R.dialog(prep, { reason: decision.reason + '.', offerAlways: needConsent });
      if (d.action === 'cancel') { await Native.cloudDiscard(prep.prepId).catch(() => {}); return { cancelled: true }; }
      if (d.action === 'device') { log({ sent: false, chars: 0, declined: true }); await Native.cloudDiscard(prep.prepId).catch(() => {}); return { stay: 'You kept this on your device' }; }
      redacted = !!d.redacted;
      if (d.always) { chat.cloudOk = true; Store.saveChat(chat); }
      else if (needConsent) chat.cloudOk = false;
    }
    asst.status = 'Asking ' + R.cfg.model + ' in the cloud…'; paintStreamSoon(asst);
    let res;
    try { res = await Native.cloudChat({ prepId: prep.prepId, rid, redacted }); } catch (e) { res = { ok: false, error: e.message, errorKind: 'unreachable', text: '' }; }
    log({ sent: true, ok: !!res.ok, chars: res.sentChars || 0, redactions: res.redactions || 0, tokensIn: res.tokensIn || 0, tokensOut: res.tokensOut || 0, error: res.ok ? null : res.errorKind });
    return { res };
  };

  return R;
})();
