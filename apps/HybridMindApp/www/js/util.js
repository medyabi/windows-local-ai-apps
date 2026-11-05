'use strict';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const escRx = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const uid = (p = '') => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const ic = (n, cls = '') => `<svg class="i ${cls}"><use href="#i-${n}"/></svg>`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

function debounce(fn, ms) {
  let t;
  const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  d.flush = (...a) => { clearTimeout(t); fn(...a); };
  return d;
}

function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'html') e.innerHTML = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'checked' || k === 'disabled' || k === 'value' || k === 'selected') e[k] = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k.nodeType ? k : document.createTextNode(String(k)));
  return e;
}

function toast(msg, action, ms = 3600) {
  const t = $('toast');
  t.innerHTML = '';
  t.append(h('span', {}, msg));
  if (action) t.append(h('button', { onclick: () => { t.classList.remove('on'); action.fn(); } }, action.label));
  t.classList.add('on');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('on'), ms);
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fall through */ }
  try {
    const ta = h('textarea', { style: 'position:fixed;opacity:0' }); ta.value = text;
    document.body.append(ta); ta.select(); const ok = document.execCommand('copy'); ta.remove(); return ok;
  } catch { return false; }
}

function fmtSize(b) {
  if (b > 1073741824) return (b / 1073741824).toFixed(1) + ' GB';
  if (b > 1048576) return (b / 1048576).toFixed(1) + ' MB';
  if (b > 1024) return Math.round(b / 1024) + ' KB';
  return b + ' B';
}
function fmtDur(ms) { return ms < 1000 ? ms + ' ms' : (ms / 1000).toFixed(1) + ' s'; }
function dayStart(t) { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); }
function relDate(t) {
  const now = Date.now(), d0 = dayStart(now), d = dayStart(t);
  const days = Math.round((d0 - d) / 864e5);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 8) return 'Previous 7 days';
  if (days < 31) return 'Previous 30 days';
  return new Date(t).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}
function fmtDateTime(t) { return new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }); }
function baseName(p) { return String(p || '').split(/[\\/]/).pop(); }
function extOf(p) { const m = /\.([A-Za-z0-9]+)$/.exec(baseName(p)); return m ? m[1].toLowerCase() : ''; }

// Popover menu anchored to an element. items: {label, icon, fn, danger, hint} | 'hr' | {header}
function popMenu(anchor, items, opts = {}) {
  closeMenu();
  const m = h('div', { class: 'menu', role: 'menu' });
  for (const it of items) {
    if (!it) continue;
    if (it === 'hr') { m.append(h('hr')); continue; }
    if (it.header) { m.append(h('div', { class: 'mhd' }, it.header)); continue; }
    m.append(h('button', { class: 'it' + (it.danger ? ' danger' : ''), role: 'menuitem', onclick: (e) => { e.stopPropagation(); closeMenu(); it.fn && it.fn(); } },
      it.icon ? h('span', { html: ic(it.icon) }) : null, h('span', {}, it.label), it.hint ? h('small', {}, it.hint) : null));
  }
  document.body.append(m);
  const r = anchor.getBoundingClientRect(), mw = m.offsetWidth, mh = m.offsetHeight;
  let x = opts.right ? r.right - mw : r.left;
  let y = opts.up ? r.top - mh - 6 : r.bottom + 6;
  if (y + mh > innerHeight - 8) y = Math.max(8, r.top - mh - 6);
  m.style.left = clamp(x, 8, innerWidth - mw - 8) + 'px';
  m.style.top = clamp(y, 8, innerHeight - mh - 8) + 'px';
  popMenu.el = m;
  setTimeout(() => document.addEventListener('mousedown', popMenu.away = (e) => { if (!m.contains(e.target)) closeMenu(); }, { once: true }), 0);
  return m;
}
function closeMenu() { if (popMenu.el) { popMenu.el.remove(); popMenu.el = null; } if (popMenu.away) document.removeEventListener('mousedown', popMenu.away); }

// Modal dialog. Returns {el, close}. opts: {title, wide, body (Node), actions:[{label, pri, danger, fn}], onClose}
function openModal(opts) {
  const ov = $('overlay');
  const close = () => { ov.classList.remove('on'); ov.innerHTML = ''; document.removeEventListener('keydown', onKey, true); opts.onClose && opts.onClose(); openModal.cur = null; };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  ov.innerHTML = '';
  const box = h('div', { class: 'modal' + (opts.wide ? ' wide' : '') },
    h('div', { class: 'mh' }, h('h2', {}, opts.title || ''), h('button', { class: 'icon-btn', 'aria-label': 'Close', onclick: close, html: ic('x') })),
    opts.tabs ? opts.body : h('div', { class: 'mb' }, opts.body),
    opts.actions ? h('div', { class: 'mf' }, opts.actions.map((a) => h('button', { class: 'btn' + (a.pri ? ' pri' : '') + (a.danger ? ' danger' : ''), onclick: () => a.fn(close) }, a.label))) : null);
  ov.append(box);
  ov.classList.add('on');
  ov.onmousedown = (e) => { if (e.target === ov) close(); };
  document.addEventListener('keydown', onKey, true);
  openModal.cur = { el: box, close };
  return openModal.cur;
}

function confirmBox(title, text, okLabel, fn, danger = true) {
  openModal({ title, body: h('p', { style: 'margin:4px 0 0;color:var(--text2)' }, text), actions: [
    { label: 'Cancel', fn: (c) => c() }, { label: okLabel, pri: !danger, danger, fn: (c) => { c(); fn(); } }] });
}

function textPrompt(title, label, value, okLabel, fn, opts = {}) {
  const inp = opts.multiline ? h('textarea', { class: 'ta', value: value || '' }) : h('input', { class: 'in', value: value || '' });
  const go = (c) => { const v = inp.value.trim(); if (!v && !opts.allowEmpty) return; c(); fn(v); };
  openModal({ title, body: h('div', { class: 'field' }, h('label', {}, label), inp), actions: [{ label: 'Cancel', fn: (c) => c() }, { label: okLabel, pri: true, fn: go }] });
  setTimeout(() => { inp.focus(); inp.select && inp.select(); }, 30);
  if (!opts.multiline) inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(openModal.cur.close); });
}
