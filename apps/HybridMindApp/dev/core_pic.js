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
