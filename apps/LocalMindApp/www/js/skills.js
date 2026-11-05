'use strict';

// Skills: reusable instruction packs (a folder with SKILL.md: front matter + instructions, plus optional reference text files).
// A skill is applied to one reply, either explicitly (/name input) or automatically when the message clearly matches its description.
// Skills only add instructions to the prompt; nothing in a skill folder is ever executed.
const Skills = (() => {
  const S = { list: [], loaded: false };
  const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'skill';
  const FM = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;
  const MAX_INSTR = 1800, MAX_REF = 1200;

  function parse(md, dir, extras) {
    const text = String(md || '').replace(/^﻿/, '');
    const m = FM.exec(text);
    const fm = {};
    let body = text;
    if (m) {
      body = m[2];
      for (const line of m[1].split(/\r?\n/)) {
        const k = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
        if (k) fm[k[1].toLowerCase()] = k[2].trim().replace(/^["']|["']$/g, '');
      }
    }
    return {
      dir, title: fm.name || dir, description: fm.description || '', hint: fm['argument-hint'] || fm.hint || '',
      auto: !/^(false|no|0|off)$/i.test(fm.auto == null ? 'true' : fm.auto),
      triggers: (fm.triggers || '').split(',').map((x) => x.trim()).filter(Boolean),
      instructions: body.trim(), extras: extras || [], raw: text,
    };
  }

  function toMarkdown(s) {
    const lines = ['---', 'name: ' + (s.title || s.dir), 'description: ' + (s.description || '').replace(/\s+/g, ' ')];
    if (s.hint) lines.push('argument-hint: ' + s.hint.replace(/\s+/g, ' '));
    lines.push('auto: ' + (s.auto ? 'true' : 'false'));
    if (s.triggers && s.triggers.length) lines.push('triggers: ' + s.triggers.join(', '));
    lines.push('---', s.instructions.trim(), '');
    return lines.join('\n');
  }

  S.load = async () => {
    if (!Native.isNative) { S.loaded = true; return; }
    try {
      const raw = (await Native.skillsList()) || [];
      S.list = raw.map((r) => parse(r.md, r.dir, r.files));
    } catch (e) { console.error('skills', e); S.list = []; }
    S.loaded = true;
  };

  S.enabled = () => S.list.filter((s) => !(Store.settings.skillsOff || []).includes(s.dir));
  S.find = (dir) => S.enabled().find((s) => s.dir === dir) || null;
  S.get = (dir) => S.list.find((s) => s.dir === dir) || null;
  S.isOn = (dir) => !(Store.settings.skillsOff || []).includes(dir);
  S.setOn = (dir, on) => {
    const off = new Set(Store.settings.skillsOff || []);
    if (on) off.delete(dir); else off.add(dir);
    Store.settings.skillsOff = [...off]; Store.saveSettings();
  };
  S.parse = parse; S.toMarkdown = toMarkdown; S.slug = slug;

  S.save = async (skill) => { await Native.skillSave(skill.dir, toMarkdown(skill)); await S.load(); };
  S.remove = async (dir) => { await Native.skillDelete(dir); await S.load(); };

  // the extra system text for one reply that uses this skill
  S.block = (skill, input) => {
    let ins = skill.instructions
      .replace(/\{\{\s*input\s*\}\}/gi, input || '')
      .replace(/\{\{\s*date\s*\}\}/gi, new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }));
    if (ins.length > MAX_INSTR) ins = ins.slice(0, MAX_INSTR - 1) + '…';
    let out = `The user is using the skill "${skill.title}". For this reply follow these instructions; they take precedence over your usual style:\n${ins}`;
    let ref = '';
    for (const f of skill.extras || []) {
      const piece = `\n[${f.name}]\n${f.text.trim()}\n`;
      if (ref.length + piece.length > MAX_REF) { ref += piece.slice(0, Math.max(0, MAX_REF - ref.length)); break; }
      ref += piece;
    }
    if (ref) out += '\n\nReference material supplied with the skill:' + ref;
    return out;
  };

  // Pick a skill for a message that doesn't name one. Conservative: the message must share at least two distinctive words with exactly one
  // skill's name/description/triggers, or contain one of its trigger phrases.
  S.match = (text) => {
    if (!Store.settings.skillsAuto) return null;
    const cands = S.enabled().filter((s) => s.auto && (s.description || s.triggers.length));
    if (!cands.length || text.trim().length < 12) return null;
    const lower = text.toLowerCase();
    for (const s of cands) for (const t of s.triggers) if (t.length >= 4 && lower.includes(t.toLowerCase())) return s;
    const q = new Set(Tools.tokens(text));
    const docs = cands.map((s) => ({ id: s.dir, text: s.title.replace(/-/g, ' ') + ' ' + s.description, s }));
    const ranked = Tools.rank(docs, text, 2, 0).map((r) => ({ s: r.doc.s, score: r.score, overlap: Tools.tokens(r.doc.text).filter((t, i, a) => a.indexOf(t) === i && q.has(t)).length }));
    if (!ranked.length) return null;
    const top = ranked[0], second = ranked[1];
    if (top.overlap < 2 || top.score < 2.2) return null;
    if (second && second.score > top.score * 0.7) return null;
    return top.s;
  };

  return S;
})();
