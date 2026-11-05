import json, os, shutil

BASE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'agent-test')
DOCS = os.path.join(BASE, 'docs'); WS = os.path.join(BASE, 'workspace')
shutil.rmtree(WS, ignore_errors=True); os.makedirs(WS)
HELP = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'make_agent_test.py'), encoding='utf-8').read().split('HELP = r"""')[1].split('"""')[0]

S1 = HELP + r"""
const out = [];
const bad = await Native.localAgentSet({ provider: 'compatible', endpoint: 'https://example.com/v1', model: 'x', apiVersion: '', imageModel: '', maxTokens: 1024, vision: false }).then(() => 'accepted').catch((e) => 'rejected: ' + e.message.slice(0, 90));
out.push({ remoteRejected: bad });
const saved = await Native.localAgentSet({ provider: 'compatible', endpoint: 'http://127.0.0.1:8791/v1', model: 'mock-local-model', apiVersion: '', imageModel: '', maxTokens: 1024, vision: false });
out.push({ saved: saved.endpoint + ' ' + saved.model, hasKey: saved.hasKey });
out.push({ models: await Native.localAgentModels() });
const t = await Native.localAgentTest(); out.push({ toolProbe: t.ok, err: t.error, ms: t.ms });
// no cloud configured at all: the local agent must still work
await Native.cloudConfigSet({ provider: 'compatible', endpoint: '', model: '', apiVersion: '', imageModel: '', maxTokens: 3000, vision: false, clearKey: true }); await Router.refresh();
Store.cloudLog.length = 0;
newChat(); setAgentKind('local');
out.push({ btnOn: document.getElementById('btnAgent').classList.contains('on'), hint: document.getElementById('hintMain').innerText.slice(0, 60) });
const p = send('AGENT-REPORT summarise my notes please. Contact jane.doe@contoso.com');
await W(() => modalTitle(), 30000);
out.push({ approval: modalTitle(), before: stepsOf() });
clickModal('Allow'); await p; await W(() => !App.busy);
const a = lastA();
out.push({ route: a.route && (a.route.target + '/' + a.route.code), final: a.content, steps: stepsOf(), err: a.error || null, cloudLogEntries: Store.cloudLog.length, badge: (document.querySelector('.msg:last-child .routebadge') || {}).innerText, stat: (document.querySelector('.msg:last-child .stat') || {}).innerText, sentChars: a.agent.sentChars });
// menu
document.getElementById('btnAgent').click(); await new Promise(r => setTimeout(r, 500));
out.push({ menu: [...document.querySelectorAll('.menu .it, .menu .mhd')].map(x => x.innerText.replace(/\s+/g, ' ')) });
window.__t = { done: true, out };
"""

files = [os.path.join(WS, 'reports', 'summary.md')]
conf = {"agent": {"roots": [DOCS], "workspace": WS}, "ui": [S1], "files": files}
d = os.path.expandvars(r'%LOCALAPPDATA%/Packages/Dyabi.HybridMindDev_rya69sw2cbryg/LocalState')
os.makedirs(d, exist_ok=True)
open(os.path.join(d, 'selftest.json'), 'w', encoding='utf-8').write(json.dumps(conf))
try: os.remove(os.path.join(d, 'bridge.log'))
except Exception: pass
open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'mock_log.jsonl'), 'w').close()
print('local agent test written')

