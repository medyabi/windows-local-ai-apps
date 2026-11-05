import json, os, shutil, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
BASE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'agent-test')
DOCS = os.path.join(BASE, 'docs'); WS = os.path.join(BASE, 'workspace')
shutil.rmtree(WS, ignore_errors=True); os.makedirs(WS)

HELP = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'make_agent_test.py'), encoding='utf-8').read().split('HELP = r"""')[1].split('"""')[0]

S_STOP = HELP + r"""
const out = [];
await cfg({ apiKey: 'test-key-123' }); await Router.refresh();
Store.settings.route.consent = 'always'; Store.settings.route.privacy = 'redact';
await Native.agentOptions({ roots: [], workspace: '', allowIndexed: true, maxSteps: 12 });
newChat(); App.chat.agent = true;
const p = send('AGENT-LONG keep exploring');
await W(() => lastA() && lastA().agent && lastA().agent.steps.length >= 2, 60000);
stopGenerating(); await p; await W(() => !App.busy, 30000);
const a = lastA();
out.push({ cancelled: a.cancelled, stepsAtStop: a.agent.steps.length, running: a.agent.running, err: a.error || null, sendBtn: document.getElementById('btnSend').className });
window.__t = { done: true, out };
"""

S_SHOT = HELP + r"""
Store.settings.route.consent = 'always'; Store.settings.route.privacy = 'redact'; await cfg({ apiKey: 'test-key-123' }); await Router.refresh();
newChat(); App.chat.agent = true; Store.settings.theme = 'dark'; applyTheme();
const p = send('AGENT-REPORT please summarise my notes into a report. Contact me at jane.doe@contoso.com');
await W(() => modalTitle(), 30000);
window.__p = p;
window.__t = { done: true };
"""

conf = {"agent": {"roots": [DOCS], "workspace": WS}, "ui": [S_SHOT],
        "shots": [{"file": "agent-approval.png", "js": "1"},
                  {"file": "agent-done.png", "js": "clickModal('Allow'); await window.__p; await W(() => !App.busy); document.querySelector('.msg:last-child .astep:last-of-type > summary').click(); scrollBottom(true)"}]}
d = os.path.expandvars(r'%LOCALAPPDATA%/Packages/Dyabi.HybridMind_rya69sw2cbryg/LocalState')
open(os.path.join(d, 'selftest.json'), 'w', encoding='utf-8').write(json.dumps(conf))
try: os.remove(os.path.join(d, 'bridge.log'))
except Exception: pass
print('ok')
