p = r'C:\Users\MohamedDYABI\HybridMindApp\www\js\hybrid-ui.js'
s = open(p, encoding='utf-8').read()

def sub(old, new):
    global s
    assert old in s, old[:70]
    s = s.replace(old, new, 1)

a = s.index("  azure: {")
b = s.index("\n", a)
s = s[:a] + "  azure: { label: 'Azure OpenAI / Azure AI Foundry', endpoint: 'https://YOUR-RESOURCE.services.ai.azure.com', model: 'Deployment name, e.g. gpt-5.4 (not the version date)', note: 'Paste the resource endpoint — a Foundry “Project endpoint” or a full URL is shortened to the resource automatically. The model field is your DEPLOYMENT name from the Deployments page. Leave API version empty to use the Azure v1 API.' }," + s[b:]

sub("  const ver = h('input', { class: 'in', value: draft.apiVersion, oninput: (e) => { draft.apiVersion = e.target.value; } });\n  const verRow = field('API version (Azure)', ver);",
    "  const verHint = h('div', { class: 'help', style: 'color:var(--warn)' });\n  const checkVer = () => { const v = (draft.apiVersion || '').trim(); const m = /^(\\d{4})-\\d{2}-\\d{2}$/.exec(v); verHint.textContent = m && +m[1] >= 2026 ? 'That looks like a model version (as shown in the Deployments table). API versions look like 2024-10-21 — or leave this empty to use the Azure v1 API.' : ''; };\n  const ver = h('input', { class: 'in', value: draft.apiVersion, placeholder: 'Empty = Azure v1 API (recommended)', oninput: (e) => { draft.apiVersion = e.target.value; checkVer(); } });\n  const verRow = field('API version (Azure, optional)', ver, 'Leave empty unless you need a specific dated version, e.g. 2024-10-21.');\n  verRow.append(verHint); checkVer();")
sub("      App.cloudState = null; updateRouteUi();\n", "      draft.endpoint = saved.endpoint; ep.value = saved.endpoint;   // Azure endpoints are normalised by the host\n      App.cloudState = null; updateRouteUi();\n")
s = s.replace("maxTokens: 1500, vision: false, hasKey: false };", "maxTokens: 3000, vision: false, hasKey: false };")
open(p, 'w', encoding='utf-8').write(s)
print('ui patched')
