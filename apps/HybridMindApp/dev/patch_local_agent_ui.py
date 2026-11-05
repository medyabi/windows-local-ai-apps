import os
W = r'C:\Users\MohamedDYABI\HybridMindApp\www'

def sub(path, old, new, count=1):
    p = os.path.join(W, path)
    s = open(p, encoding='utf-8').read()
    assert old in s, (path, old[:90])
    open(p, 'w', encoding='utf-8').write(s.replace(old, new, count))

# ⚡ opens the menu
a = open(os.path.join(W, 'js/hybrid-ui.js'), encoding='utf-8').read()
i = a.index("  $('btnAgent').onclick = () => {")
j = a.index("  $('cloudStatus').onclick")
a = a[:i] + "  $('btnAgent').onclick = () => agentMenu();\n" + a[j:]
open(os.path.join(W, 'js/hybrid-ui.js'), 'w', encoding='utf-8').write(a)

sub('js/hybrid-ui.js', "  $('input').placeholder = c.agent ? 'Ask the agent to search, read and write files in your allowed folders…' : 'Message HybridMind…  (type / for commands)';",
    "  $('btnAgent').title = c.agent === 'local' ? 'Local agent on (click to change)' : c.agent ? 'Cloud agent on (click to change)' : 'Agent mode: let a model use tools on your allowed folders';\n  $('input').placeholder = c.agent ? 'Ask the agent to search, read and write files in your allowed folders…' : 'Message HybridMind…  (type / for commands)';")
sub('js/hybrid-ui.js', "$('hintMain').innerHTML = c.agent ? '<b>Agent.</b> The cloud model works with tools on your allowed folders; reads are sent to it, writes need your approval.' :",
    "$('hintMain').innerHTML = c.agent === 'local' ? '<b>Local agent.</b> A model on this PC works with tools on your allowed folders. Nothing leaves the PC; writes need your approval.' : c.agent ? '<b>Cloud agent.</b> The cloud model works with tools on your allowed folders; what it reads is sent to it, writes need your approval.' :")

# badge for the local agent
sub('js/ui.js', "  if (r.target === 'cloud') return `<div class=\"routebadge cloud\"",
    "  if (n.agent && r.target === 'device') return `<div class=\"routebadge device\" title=\"A model on this PC; nothing was sent off the machine\">${ic('cpu')}Local agent · ${esc(r.model || '')}</div>`;\n  if (r.target === 'cloud') return `<div class=\"routebadge cloud\"")
# stat line for the local agent (no token counts reported)
sub('js/ui.js', "  if (n.agent) return `<span class=\"stat\" title=\"Steps / tokens used by the cloud model\">",
    "  if (n.agent && n.agent.local) return `<span class=\"stat\">${n.agent.calls} tool call${n.agent.calls === 1 ? '' : 's'} · on this PC</span>`;\n  if (n.agent) return `<span class=\"stat\" title=\"Steps / tokens used by the cloud model\">")

# Settings -> Agent: local agent card
sub('js/agent-ui.js', "    h('h3', {}, 'Limits'),",
    "    h('h3', {}, 'Local agent (a model on this PC)'),\n    h('div', { class: 'card', style: 'align-items:center' }, h('span', { html: ic('cpu') }), h('div', { class: 'grow' }, h('div', { class: 'ct' }, lcfg && lcfg.model ? lcfg.model : 'Not set up'), h('div', { class: 'cs' }, lcfg && lcfg.endpoint ? lcfg.endpoint : 'Use Foundry Local, LM Studio or Ollama on this PC')), h('div', { class: 'btns' }, h('button', { class: 'btn sm', onclick: () => openLocalAgentSetup(() => redraw()) }, 'Configure…'))),\n    h('h3', {}, 'Limits'),")
sub('js/agent-ui.js', "  const redraw = () => tabAgent(el);", "  const redraw = () => tabAgent(el);\n  let lcfg = null; try { lcfg = await Native.localAgentGet(); } catch { /* ignore */ }")

# scripts
sub('index.html', '<script src="js/agent-ui.js"></script>', '<script src="js/agent-ui.js"></script>\n<script src="js/agent-menu.js"></script>')
print('ui patched')
