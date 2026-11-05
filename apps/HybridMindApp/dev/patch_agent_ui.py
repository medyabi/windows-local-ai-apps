import os
W = r'C:\Users\MohamedDYABI\HybridMindApp\www'

def sub(path, old, new, count=1):
    p = os.path.join(W, path)
    s = open(p, encoding='utf-8').read()
    assert old in s, (path, old[:80])
    open(p, 'w', encoding='utf-8').write(s.replace(old, new, count))

# bridge
sub('js/bridge.js', "    // skills (folders with SKILL.md)", """    // agent (tools run in the host)
    agentConfigGet: () => call('agentConfigGet').then(json),
    agentAddFolder: () => call('agentAddFolder').then(json),
    agentRemoveFolder: (p) => call('agentRemoveFolder', { prompt: p }).then(json),
    agentSetWorkspace: () => call('agentSetWorkspace').then(json),
    agentOptions: (cfg) => call('agentOptions', { data: JSON.stringify(cfg) }).then(json),
    agentOpenWorkspace: () => call('agentOpenWorkspace'),
    agentStart: (req) => call('agentStart', { data: JSON.stringify(req) }).then((r) => r.text),
    agentStep: (req, redact) => call('agentStep', { data: JSON.stringify(req), n: redact ? 1 : 0 }).then(json),
    agentTool: (req) => call('agentTool', { data: JSON.stringify(req) }).then(json),
    agentEnd: (id) => call('agentEnd', { prompt: id }),

    // skills (folders with SKILL.md)""")

# chat.js: route a turn through the agent when the chat is in agent mode
sub('js/chat.js', "const out = opts.skill ? await runTextSkill(chat, userNode, asst, rid, opts.skill) : await runRouted(chat, userNode, asst, rid, opts);",
    "const out = opts.skill ? await runTextSkill(chat, userNode, asst, rid, opts.skill) : chat.agent ? await runAgentTurn(chat, userNode, asst, rid) : await runRouted(chat, userNode, asst, rid, opts);")

# ui.js: live + static rendering of agent steps
sub('js/ui.js', "  if (n.content) el.innerHTML = '<div class=\"content\">' + MD.render(n.content, {}) + '<span class=\"caret\"></span></div>';\n  else el.innerHTML = `<div class=\"thinking\"><i></i><i></i><i></i><span>${esc(n.status || 'Thinking…')}</span></div>`;",
    "  const open = [...el.querySelectorAll('details.astep')].map((d) => d.open);\n  const steps = n.agent ? agentStepsHtml(n) : '';\n  if (n.content) el.innerHTML = steps + '<div class=\"content\">' + MD.render(n.content, {}) + '<span class=\"caret\"></span></div>';\n  else el.innerHTML = steps + `<div class=\"thinking\"><i></i><i></i><i></i><span>${esc(n.status || 'Thinking…')}</span></div>`;\n  el.querySelectorAll('details.astep').forEach((d, i) => { if (open[i]) d.open = true; });")
sub('js/ui.js', "  let html = routeBadge(n);", "  let html = routeBadge(n) + (n.agent ? agentStepsHtml(n) : '');")
sub('js/ui.js', "  if (m.img) return", "  if (n.agent) return `<span class=\"stat\" title=\"Steps / tokens used by the cloud model\">${n.agent.calls} tool call${n.agent.calls === 1 ? '' : 's'} · ${(n.agent.tokensIn + n.agent.tokensOut).toLocaleString()} tokens · ${n.agent.sentChars.toLocaleString()} chars sent</span>`;\n  if (m.img) return")
sub('js/ui.js', "(n.route && n.route.target === 'device' && Router.ready() && !(n.meta && n.meta.local)", "(n.route && n.route.target === 'device' && Router.ready() && !(n.meta && n.meta.local) && !n.agent")
sub('js/ui.js', "(n.route && n.route.target === 'cloud' ? `<button data-act=\"retryDevice\"", "(n.route && n.route.target === 'cloud' && !n.agent ? `<button data-act=\"retryDevice\"")

# index.html: toggle button + scripts
sub('index.html', '          <button class="icon-btn" id="btnImage"', '          <button class="icon-btn" id="btnAgent" title="Agent mode: let the cloud model use tools on your allowed folders" aria-label="Agent mode"><svg class="i"><use href="#i-bolt"/></svg></button>\n          <button class="icon-btn" id="btnImage"')
sub('index.html', '<script src="js/router.js"></script>', '<script src="js/router.js"></script>\n<script src="js/agent.js"></script>')
sub('index.html', '<script src="js/hybrid-ui.js"></script>', '<script src="js/hybrid-ui.js"></script>\n<script src="js/agent-ui.js"></script>')

# hybrid-ui: agent state in the route UI + toggle wiring
sub('js/hybrid-ui.js', "  const mode = Router.modeOf(c);\n  document.querySelectorAll('#routeSeg button')", "  const mode = Router.modeOf(c);\n  $('btnAgent').classList.toggle('on', !!c.agent);\n  $('input').placeholder = c.agent ? 'Ask the agent to search, read and write files in your allowed folders…' : 'Message HybridMind…  (type / for commands)';\n  document.querySelectorAll('#routeSeg button')")
sub('js/hybrid-ui.js', "  $('cloudStatus').onclick = () => openSettings('cloud');", """  $('btnAgent').onclick = () => {
    const c = App.chat;
    if (!c.agent && !Router.ready()) { toast('Agent mode runs on your cloud model — add one first.'); openSettings('cloud'); return; }
    c.agent = !c.agent;
    if (c.agent && c.route === 'device') c.route = 'auto';
    if (!c.temporary && Store.path(c).length) Store.saveChat(c);
    updateRouteUi();
    toast(c.agent ? 'Agent mode on: the cloud model can search and read your allowed folders and write to the working folder (each write needs your OK).' : 'Agent mode off.', null, 5000);
  };
  $('cloudStatus').onclick = () => openSettings('cloud');""")
# hint line mentions agent
sub('js/hybrid-ui.js', "  $('hintMain').innerHTML = mode === 'device'", "  $('hintMain').innerHTML = c.agent ? '<b>Agent.</b> The cloud model works with tools on your allowed folders; reads are sent to it, writes need your approval.' : mode === 'device'")

# panels: Agent tab
sub('js/panels.js', "['cloud', 'cloud', 'Cloud'],", "['cloud', 'cloud', 'Cloud'], ['agent', 'bolt', 'Agent'],")
sub('js/panels.js', "cloud: tabCloud,", "cloud: tabCloud, agent: tabAgent,")

# css
p = os.path.join(W, 'style.css')
c = open(p, encoding='utf-8').read()
c += """
/* agent */
.agentsteps { border: 1px solid var(--line); border-radius: 12px; background: var(--surface); margin: 6px 0 10px; overflow: hidden; }
.agentsteps .ah { display: flex; align-items: center; gap: 8px; padding: 7px 12px; font-size: 12.5px; font-weight: 650; color: var(--accent); border-bottom: 1px solid var(--line); }
.astep { border-bottom: 1px solid var(--line); }
.astep:last-child { border-bottom: 0; }
.astep > summary { list-style: none; cursor: pointer; display: flex; align-items: center; gap: 8px; padding: 7px 12px; font-size: 13px; color: var(--text2); flex-wrap: wrap; }
.astep > summary::-webkit-details-marker { display: none; }
.astep .ap { color: var(--muted); font-family: var(--mono); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 46%; }
.astep .as { margin-left: auto; font-size: 12px; color: var(--muted); }
.astep.ok > summary svg { color: var(--ok); } .astep.run > summary svg { color: var(--warn); } .astep.bad > summary svg { color: var(--danger); }
.astep .ad { padding: 4px 12px 10px; }
.astep .al { font-size: 11px; text-transform: uppercase; letter-spacing: .5px; color: var(--muted); margin: 6px 0 2px; font-weight: 650; }
.astep .an { font-size: 13px; color: var(--text2); font-style: italic; margin-bottom: 4px; }
.astep pre { margin: 0; white-space: pre-wrap; word-break: break-word; max-height: 180px; overflow: auto; font: 12px/1.45 var(--mono); background: var(--code); color: var(--codeText); padding: 7px 9px; border-radius: 8px; }
#btnAgent.on { color: var(--accent2); background: color-mix(in srgb, var(--accent2) 16%, transparent); }
"""
open(p, 'w', encoding='utf-8').write(c)
print('agent ui patched')
