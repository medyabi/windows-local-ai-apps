'use strict';

// Settings → Skills: list, switch on/off, create, edit, import, export.
function tabSkills(el) {
  const draw = () => {
    el.innerHTML = '';
    el.append(
      h('p', { style: 'color:var(--text2);margin:6px 0 0' }, 'A skill is a saved set of instructions you can run with ', h('code', {}, '/skill-name your text'), ', or let LocalMind pick automatically when your message clearly matches its description. Skills only add instructions to the prompt — nothing in a skill is ever executed.'),
      toggleRow('Pick skills automatically', 'When a message clearly matches one skill’s description, apply it (shown on your message with a “Don’t use” button).', Store.settings.skillsAuto, (v) => { Store.settings.skillsAuto = v; saveSettings(); }),
      h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;margin:10px 0' },
        h('button', { class: 'btn pri', onclick: () => editSkill(null, draw) }, h('span', { html: ic('plus') }), 'New skill'),
        h('button', { class: 'btn', onclick: () => importSkill('folder', draw) }, h('span', { html: ic('folder') }), 'Import folder…'),
        h('button', { class: 'btn', onclick: () => importSkill('file', draw) }, h('span', { html: ic('file') }), 'Import SKILL.md…'),
        h('button', { class: 'btn', onclick: () => Native.skillsFolder().catch((e) => toast(e.message)) }, 'Open skills folder')));
    if (!Skills.list.length) el.append(h('div', { class: 'empty' }, 'No skills yet. Create one, or import a folder that contains a SKILL.md file.'));
    const list = h('div', { class: 'list' });
    for (const s of Skills.list) {
      const on = Skills.isOn(s.dir);
      list.append(h('div', { class: 'card' },
        h('label', { class: 'sw', title: on ? 'On' : 'Off' }, h('input', { type: 'checkbox', checked: on, onchange: (e) => { Skills.setOn(s.dir, e.target.checked); renderThread(true); } }), h('i')),
        h('div', { class: 'grow' },
          h('div', { class: 'ct' }, h('code', {}, '/' + s.dir), s.title !== s.dir ? '  ' + s.title : '', s.auto ? h('span', { class: 'tbadge', style: 'margin-left:8px' }, 'auto') : null),
          h('div', { class: 'cs' }, s.description || (s.instructions || '').slice(0, 100)),
          s.extras.length ? h('div', { class: 'cs' }, 'Reference files: ' + s.extras.map((x) => x.name).join(', ')) : null),
        h('div', { class: 'btns' }, h('button', { class: 'btn sm', onclick: () => editSkill(s, draw) }, 'Edit'))));
    }
    el.append(list,
      h('div', { class: 'note' }, 'Skills live in plain folders, so you can also edit them outside the app. Compatible with the SKILL.md format (name, description, instructions); scripts and other files in a skill folder are ignored — only text/markdown reference files are read.'));
  };
  draw();
}

async function importSkill(kind, back) {
  try {
    const r = kind === 'folder' ? await Native.skillImportFolder() : await Native.skillImportFile();
    if (!r) return;
    await Skills.load(); renderThread(true);
    toast(kind === 'folder' ? `${r} skill${r === '1' ? '' : 's'} imported.` : 'Skill imported.');
    back && back();
  } catch (e) { toast('Import failed: ' + e.message); }
}

function editSkill(skill, back) {
  const draft = skill ? { ...skill } : { dir: '', title: '', description: '', hint: '', auto: true, triggers: [], instructions: '', extras: [] };
  const name = h('input', { class: 'in', value: draft.dir, maxlength: 40, placeholder: 'e.g. release-notes', disabled: !!skill });
  const desc = h('input', { class: 'in', value: draft.description, maxlength: 200, placeholder: 'What it does and when to use it — also used to match your messages' });
  const hint = h('input', { class: 'in', value: draft.hint, maxlength: 100, placeholder: 'What to type after the command, e.g. paste the notes' });
  const trg = h('input', { class: 'in', value: (draft.triggers || []).join(', '), placeholder: 'Optional phrases that should always trigger it, separated by commas' });
  const auto = h('input', { type: 'checkbox', checked: draft.auto });
  const ins = h('textarea', { class: 'ta', style: 'min-height:190px', value: draft.instructions, placeholder: 'Write the instructions the assistant should follow. Use {{input}} where the user’s text should go (optional).' });
  const counter = h('div', { class: 'help' });
  const upd = () => { const n = ins.value.length; counter.textContent = n + ' / 1800 characters' + (n > 1800 ? ' — the end will be cut off when the skill runs; shorter skills work better with the small on-device model' : ''); counter.style.color = n > 1800 ? 'var(--warn)' : ''; };
  ins.addEventListener('input', upd); upd();
  const save = async (close) => {
    const dir = skill ? skill.dir : Skills.slug(name.value);
    if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(dir)) { toast('Use a short name with letters, digits and dashes.'); return; }
    if (!skill && Skills.get(dir)) { toast('A skill with that name already exists.'); return; }
    if (!ins.value.trim()) { toast('Add some instructions.'); return; }
    const out = { dir, title: skill ? skill.title : dir, description: desc.value.trim(), hint: hint.value.trim(), auto: auto.checked, triggers: trg.value.split(',').map((x) => x.trim()).filter(Boolean), instructions: ins.value.trim() };
    try { await Skills.save(out); close(); renderThread(true); back && back(); toast('Skill saved.'); } catch (e) { toast(e.message); }
  };
  const actions = [];
  if (skill) actions.push({ label: 'Delete', danger: true, fn: (c) => { c(); confirmBox('Delete skill?', `“/${skill.dir}” and its folder will be removed from this PC.`, 'Delete', async () => { try { await Skills.remove(skill.dir); renderThread(true); back && back(); } catch (e) { toast(e.message); } }); } });
  if (skill) actions.push({ label: 'Export', fn: async () => { try { const p = await Native.saveFile(skill.dir + '.md', Skills.toMarkdown(draftFrom())); if (p) toast('Saved to ' + p); } catch (e) { toast(e.message); } } });
  actions.push({ label: 'Cancel', fn: (c) => c() }, { label: 'Save', pri: true, fn: save });
  const draftFrom = () => ({ ...draft, description: desc.value.trim(), hint: hint.value.trim(), auto: auto.checked, triggers: trg.value.split(',').map((x) => x.trim()).filter(Boolean), instructions: ins.value.trim() });
  openModal({
    title: skill ? 'Edit skill “/' + skill.dir + '”' : 'New skill', wide: false,
    body: h('div', {}, field('Command name', name, skill ? 'The folder name; it can’t be changed after saving.' : 'You’ll run it with /name.'), field('Description', desc), field('Input hint', hint), field('Instructions', ins), counter, field('Trigger phrases', trg),
      h('label', { style: 'display:flex;gap:10px;align-items:center;margin-top:10px' }, auto, h('span', {}, 'Allow LocalMind to pick this skill automatically'))),
    actions,
  });
}

function openSkillsHelp() { openSettings('skills'); }
