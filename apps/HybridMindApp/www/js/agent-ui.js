'use strict';

// Settings → Agent: which folders the agent may read, its working folder, and limits.
async function tabAgent(el) {
  el.innerHTML = '';
  let cfg;
  try { cfg = await Native.agentConfigGet(); } catch (e) { el.append(h('div', { class: 'errbox' }, e.message)); return; }
  const redraw = () => tabAgent(el);
  let lcfg = null; try { lcfg = await Native.localAgentGet(); } catch { /* ignore */ }
  const rolesList = h('div', { class: 'list' });
  if (!cfg.roots.length) rolesList.append(h('div', { class: 'empty' }, 'No folders yet. Without any, the agent can read only files you attach to a message and files you indexed in the app.'));
  for (const r of cfg.roots) rolesList.append(h('div', { class: 'card', style: 'align-items:center' }, h('span', { html: ic('folder') }), h('div', { class: 'grow ct', style: 'font-weight:500;word-break:break-all' }, r),
    h('div', { class: 'btns' }, h('button', { class: 'btn sm', onclick: async () => { cfg = await Native.agentRemoveFolder(r); redraw(); } }, 'Remove'))));
  const steps = h('select', { class: 'sel', onchange: async (e) => { cfg = await Native.agentOptions({ ...cfg, maxSteps: +e.target.value }); } });
  [[6, '6 — quick tasks'], [12, '12 — default'], [20, '20 — longer tasks'], [30, '30 — maximum']].forEach(([v, l]) => steps.append(h('option', { value: v, selected: v === cfg.maxSteps }, l)));
  el.append(
    h('div', { class: 'note' }, h('b', {}, 'Agent mode '), 'lets your cloud model plan a task and use tools — search and read your files, write results to a working folder, do exact maths — in a loop until it can answer. Turn it on per chat with the ', h('b', {}, 'bolt'), ' button in the message box. The model never touches your PC itself: each tool call is run by this app, which enforces the folders below.'),
    h('div', { class: 'note warn' }, h('b', {}, 'What this means for privacy and safety. '), 'Everything the agent reads (search results, file contents) is sent to the cloud model, with sensitive-looking values redacted or withheld per Routing & privacy. A document can contain text that tries to steer the agent (“prompt injection”): the agent is told to treat file text as data, but no model is immune — so it can’t delete or overwrite anything outside the working folder, can’t run programs or scripts, and every write is shown to you first.'),
    h('h3', {}, 'Folders the agent may read'),
    rolesList,
    h('div', { style: 'margin:8px 0' }, h('button', { class: 'btn', onclick: async () => { try { cfg = await Native.agentAddFolder(); redraw(); } catch (e) { toast(e.message); } } }, h('span', { html: ic('plus') }), 'Add a folder…')),
    toggleRow('Also allow files I’ve indexed in the app', 'Files you added under Files & knowledge can be searched and read by the agent.', cfg.allowIndexed, async (v) => { cfg = await Native.agentOptions({ ...cfg, allowIndexed: v }); }),
    h('div', { class: 'help' }, 'Never readable, even inside an allowed folder: credential and key files (.env, *.pem, *.key, *.pfx, id_rsa, *.kdbx…), .ssh/.aws/.azure/AppData folders, and anything reached through a junction or symlink.'),
    h('h3', {}, 'Working folder (the only place it can write)'),
    h('div', { class: 'card', style: 'align-items:center' }, h('span', { html: ic('folder') }), h('div', { class: 'grow ct', style: 'font-weight:500;word-break:break-all' }, cfg.workspace),
      h('div', { class: 'btns' }, h('button', { class: 'btn sm', onclick: async () => { cfg = await Native.agentSetWorkspace(); redraw(); } }, 'Change…'), h('button', { class: 'btn sm', onclick: () => Native.agentOpenWorkspace().catch((e) => toast(e.message)) }, 'Open'))),
    h('div', { class: 'help' }, 'Text and code files only, up to 1 MB each and 20 per task; programs and scripts that Windows can run (.exe, .bat, .ps1, .js, .vbs …) are refused. Replacing a file needs your approval and keeps the old copy in .history. The agent can also read this folder.'),
    h('h3', {}, 'Local agent (a model on this PC)'),
    h('div', { class: 'card', style: 'align-items:center' }, h('span', { html: ic('cpu') }), h('div', { class: 'grow' }, h('div', { class: 'ct' }, lcfg && lcfg.model ? lcfg.model : 'Not set up'), h('div', { class: 'cs' }, lcfg && lcfg.endpoint ? lcfg.endpoint : 'Use Foundry Local, LM Studio or Ollama on this PC')), h('div', { class: 'btns' }, h('button', { class: 'btn sm', onclick: () => openLocalAgentSetup(() => redraw()) }, 'Configure…'))),
    h('h3', {}, 'Limits'),
    field('Maximum steps per task', steps, 'Each step is one request to the cloud model; your daily cloud limit also applies.'));
}
