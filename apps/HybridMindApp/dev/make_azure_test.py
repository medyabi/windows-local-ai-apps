import json, os
def az(model, ver, ep='http://127.0.0.1:8790/api/projects/proj-default'):
    return {"op":"config","cfg":{"provider":"azure","endpoint":ep,"model":model,"apiVersion":ver,"imageModel":"","maxTokens":3000,"vision":False,"apiKey":"test-key-123"}}
cloud=[
 az('gpt-5.4','2026-03-05'), {"op":"test"}, {"op":"chat","user":"hello azure","redact":True},
 az('gpt-5.4',''), {"op":"test"},
 az('gpt-5.4','2024-10-21'), {"op":"test"},
 az('nov1gpt','') , {"op":"test"},
 az('404model',''), {"op":"test"},
]
d=os.path.expandvars(r'%LOCALAPPDATA%/Packages/Dyabi.HybridMind_rya69sw2cbryg/LocalState')
os.makedirs(d,exist_ok=True)
open(os.path.join(d,'selftest.json'),'w',encoding='utf-8').write(json.dumps({"cloud":cloud}))
try: os.remove(os.path.join(d,'bridge.log'))
except Exception: pass
open('mock_log.jsonl','w').close()
print('ok')
