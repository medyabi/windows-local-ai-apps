import json, os, sys

HELP = r"""
window.cfg = (o) => Native.cloudConfigSet(Object.assign({ provider: 'compatible', endpoint: 'http://127.0.0.1:8790/v1', model: 'gpt-test', apiVersion: '', imageModel: 'dall-e-3', maxTokens: 400, vision: false }, o));
"""
STEP1 = HELP + r"""
const out = [];
out.push({ saved: (await cfg({ apiKey: 'test-key-123' })).hasKey });
const r = await Native.cloudTest(); out.push({ testBeforeRestart: r.ok });
window.__t = { done: true, out };
"""
STEP2 = HELP + r"""
const out = [];
const g = await Native.cloudConfigGet(); out.push({ hasKeyAfterRestart: g.hasKey, endpoint: g.endpoint, apiKeyReturned: 'apiKey' in g && g.apiKey });
const r = await Native.cloudTest(); out.push({ testAfterRestart: r.ok, err: r.error });
const moved = await cfg({ endpoint: 'http://127.0.0.1:8791/v1' }); out.push({ afterEndpointChange_hasKey: moved.hasKey });
const t2 = await Native.cloudTest(); out.push({ testWithoutKey: t2.ok, kind: t2.errorKind });
const back = await cfg({ endpoint: 'http://127.0.0.1:8790/v1', apiKey: 'test-key-123' }); out.push({ restored: back.hasKey });
const bad = await cfg({ endpoint: 'http://evil.example.com/v1' }).then(() => 'accepted').catch((e) => 'rejected: ' + e.message); out.push({ httpRemote: bad });
const cred = await cfg({ endpoint: 'https://user:pw@example.com/v1' }).then(() => 'accepted').catch((e) => 'rejected: ' + e.message); out.push({ urlCreds: cred });
window.__t = { done: true, out };
"""
step = sys.argv[1] if len(sys.argv) > 1 else '1'
conf = {"ui": [STEP1 if step == '1' else STEP2]}
d = os.path.expandvars(r'%LOCALAPPDATA%/Packages/Dyabi.HybridMind_rya69sw2cbryg/LocalState')
os.makedirs(d, exist_ok=True)
open(os.path.join(d, 'selftest.json'), 'w', encoding='utf-8').write(json.dumps(conf))
try:
    os.remove(os.path.join(d, 'bridge.log'))
except Exception:
    pass
print('step', step, 'written')
