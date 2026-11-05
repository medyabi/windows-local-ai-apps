import json, os

HELP = r"""
window.W = (f, ms) => new Promise(res => { const t0 = Date.now(); const i = setInterval(() => { if (f() || Date.now() - t0 > (ms || 120000)) { clearInterval(i); res(); } }, 100); });
window.lastA = () => { const p = Store.path(App.chat).filter(n => n.role === 'assistant'); return p[p.length - 1]; };
window.modalTitle = () => document.querySelector('#overlay.on .modal h2') && document.querySelector('#overlay.on .modal h2').textContent;
window.clickModal = (label) => { const b = [...document.querySelectorAll('#overlay.on .mf button')].find(x => x.textContent.trim() === label); if (b) b.click(); return !!b; };
window.res = (extra) => { const a = lastA(); return Object.assign({ route: a.route && a.route.target, code: a.route && a.route.code, why: (a.route && a.route.reason || '').slice(0, 80), a: (a.content || '').slice(0, 230), err: a.error || null, warn: a.warnings || null, badge: (document.querySelector('.msg:last-child .routebadge') || {}).innerText }, extra || {}); };
window.ask = async (q) => { await send(q); await W(() => !App.busy); return res({ q: q.slice(0, 50) }); };
window.cfg = (o) => Native.cloudConfigSet(Object.assign({ provider: 'compatible', endpoint: 'http://127.0.0.1:8790/v1', model: 'gpt-test', apiVersion: '', imageModel: 'dall-e-3', maxTokens: 400, vision: false }, o));
"""

S1 = HELP + r"""
const out = [];
await cfg({ apiKey: 'test-key-123' });
await Router.refresh(); updateRouteUi();
Store.settings.route.consent = 'always';
out.push({ ready: Router.ready(), cloudTxt: document.getElementById('cloudTxt').textContent });
newChat();
out.push(await ask('What is the capital of France?'));
out.push(await ask('Please review this long text. ' + 'The quarterly figures were stable across all regions and the team agreed to continue. '.repeat(70)));
newChat(); App.chat.route = 'cloud'; updateRouteUi();
out.push(await ask('Email me at jane.doe@contoso.com, my card is 4111 1111 1111 1111. What is 2+2?'));
out.push({ warnChip: [...document.querySelectorAll('.msg:last-child .chip.warn')].map(c => c.innerText) });
await regenerate(lastA().id, { forceDevice: true }); await W(() => !App.busy);
out.push(res({ step: 'retry on device' }));
await regenerate(lastA().id, { forceCloud: true }); await W(() => !App.busy);
out.push(res({ step: 'retry in cloud' }));
out.push({ log: Store.cloudLog.slice(0, 6).map(e => [e.sent, e.ok, e.chars, e.redactions, (e.reason || '').slice(0, 36)].join('|')), today: Store.cloudSentToday() });
window.__t = { done: true, out };
"""

S2 = HELP + r"""
const out = [];
Store.settings.route.consent = 'ask'; Store.settings.route.privacy = 'redact';
newChat(); App.chat.route = 'auto';
const long1 = 'Please review this long text. ' + 'Revenue grew in every region and churn fell again this quarter. '.repeat(75);
const p1 = send(long1);
await W(() => modalTitle(), 20000);
out.push({ dialog: modalTitle(), body: document.querySelector('#overlay .modal .mb').innerText.replace(/\s+/g, ' ').slice(0, 260), hasPreview: !!document.querySelector('#overlay details.sources') });
document.querySelector('#overlay .mb input[type=checkbox]').checked = true;
clickModal('Send to cloud'); await p1; await W(() => !App.busy);
out.push(res({ step: 'after consent', cloudOk: App.chat.cloudOk }));
await send('Another long one. ' + 'Costs were flat and hiring continued as planned. '.repeat(100));
out.push(res({ step: 'second message (no dialog expected)', dialogOpen: !!modalTitle() }));
newChat();
const p3 = send(long1); await W(() => modalTitle(), 20000); clickModal('Keep on this PC'); await p3;
out.push(res({ step: 'declined' }));
Store.settings.route.consent = 'always'; Store.settings.route.privacy = 'block'; newChat();
out.push(await ask('Please review this. Contact jane.doe@contoso.com. ' + 'The plan is on track and every milestone was met on schedule. '.repeat(75)));
Store.settings.route.privacy = 'ask'; newChat(); App.chat.route = 'cloud';
const p4 = send('My server key is sk-abc123def456ghi789jkl012mno345 and my email is jane.doe@contoso.com. Summarize why keys must be rotated.');
await W(() => modalTitle(), 20000);
out.push({ dialog2: modalTitle(), btns: [...document.querySelectorAll('#overlay.on .mf button')].map(b => b.textContent.trim()), notes: (document.querySelector('#overlay .note.warn') || {}).innerText && document.querySelector('#overlay .note.warn').innerText.slice(0, 160) });
clickModal('Send redacted'); await p4; await W(() => !App.busy);
out.push(res({ step: 'ask then redacted' }));
window.__t = { done: true, out };
"""

S3 = HELP + r"""
const out = [];
Store.settings.route.consent = 'always'; Store.settings.route.privacy = 'redact';
await cfg({ model: 'fail500' }); await Router.refresh(); newChat(); App.chat.route = 'cloud';
out.push(await ask('Tell me one fun fact about octopuses.'));
await cfg({ apiKey: 'wrong' }); await Router.refresh(); newChat(); App.chat.route = 'cloud';
out.push(await ask('Tell me one fun fact about cats.'));
await cfg({ apiKey: 'test-key-123' }); await Router.refresh();
newChat(); App.chat.route = 'auto'; App.model.ok = false;
out.push(await ask('Give me a haiku about rain.'));
App.model.ok = true;
newChat(); App.chat.route = 'cloud';
out.push(await ask('/image a red bicycle against a blue wall'));
out.push({ imgs: (lastA().images || []).map(i => i.url + ' cloud=' + i.cloud), figure: !!document.querySelector('.genimg img'), badge: (document.querySelector('.msg:last-child .routebadge') || {}).innerText });
newChat(); App.chat.route = 'auto';
out.push(await ask('/summarize ' + 'The committee reviewed the budget in detail and noted several items for follow-up across departments. '.repeat(90)));
out.push({ log: Store.cloudLog.slice(0, 8).map(e => [e.sent, e.ok, e.error || '', (e.reason || '').slice(0, 30)].join('|')) });
window.__t = { done: true, out };
"""

shots = [
    {"file": "h-chat.png", "js": "Store.settings.theme='dark'; applyTheme(); scrollBottom(true)"},
    {"file": "h-settings-cloud.png", "js": "openSettings('cloud')"},
    {"file": "h-settings-routing.png", "js": "closeModalNow(); openSettings('routing')"},
    {"file": "h-settings-usage.png", "js": "closeModalNow(); openSettings('usage')"},
]
conf = {"ui": [S1, S2, S3], "shots": shots}
d = os.path.expandvars(r'%LOCALAPPDATA%/Packages/Dyabi.HybridMind_rya69sw2cbryg/LocalState')
os.makedirs(d, exist_ok=True)
open(os.path.join(d, 'selftest.json'), 'w', encoding='utf-8').write(json.dumps(conf))
for f in ('bridge.log',):
    try:
        os.remove(os.path.join(d, f))
    except Exception:
        pass
open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'mock_log.jsonl'), 'w').close()
print('config written')
