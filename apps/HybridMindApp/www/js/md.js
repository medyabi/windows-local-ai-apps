'use strict';

// A small, safe Markdown renderer (everything is HTML-escaped first) with syntax highlighting for fenced code.
const MD = (() => {
  // ── syntax highlighting ──────────────────────────────────────────────
  const KW = {
    js: 'async await break case catch class const continue debugger default delete do else export extends finally for from function if import in instanceof let new of return super switch this throw try typeof var void while with yield null true false undefined',
    py: 'and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return True try while with yield self print',
    c: 'int long short float double char bool boolean void string var let const static public private protected internal class struct enum interface namespace using new return if else for foreach while do switch case break continue try catch finally throw null true false this base override virtual abstract async await in is as typeof sizeof fn func def pub mut impl use mod match loop go defer package import extends implements readonly record init get set where',
    sql: 'select from where group by order having join left right inner outer full on as and or not null insert into values update set delete create table alter drop index primary key foreign references limit offset union distinct count sum avg min max case when then else end like in between is desc asc exists',
    sh: 'if then else elif fi for while do done case esac function in echo cd ls rm cp mv cat grep sed awk export source set unset return exit local read test',
    lit: 'true false null',
  };
  const kwSet = (k) => new Set(KW[k].split(' '));
  const SETS = { js: kwSet('js'), py: kwSet('py'), c: kwSet('c'), sql: kwSet('sql'), sh: kwSet('sh'), lit: kwSet('lit') };
  const FAMILY = {
    js: 'js', javascript: 'js', jsx: 'js', ts: 'js', typescript: 'js', tsx: 'js', node: 'js',
    py: 'py', python: 'py', ps1: 'sh', powershell: 'sh', bash: 'sh', sh: 'sh', shell: 'sh', zsh: 'sh', yaml: 'yaml', yml: 'yaml', toml: 'yaml', ini: 'yaml',
    c: 'c', cpp: 'c', 'c++': 'c', cs: 'c', csharp: 'c', 'c#': 'c', java: 'c', go: 'c', rust: 'c', rs: 'c', kotlin: 'c', swift: 'c', php: 'c', dart: 'c', scala: 'c',
    sql: 'sql', json: 'json', jsonc: 'json', html: 'html', xml: 'html', svg: 'html', xaml: 'html', css: 'css', scss: 'css',
  };
  const RX = {
    js: /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\[\s\S]|[^`\\])*`)|(\b\d[\d_.]*(?:e[+-]?\d+)?\b)|(\b[A-Za-z_$][\w$]*\b)(?=\s*\()|(\b[A-Za-z_$][\w$]*\b)/g,
    c: /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*')|(\b\d[\d_.]*(?:e[+-]?\d+)?[fFdDlLuU]?\b)|(\b[A-Za-z_][\w]*\b)(?=\s*\()|(\b[A-Za-z_][\w]*\b)/g,
    py: /(#[^\n]*)|("""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*')|(\b\d[\d_.]*(?:e[+-]?\d+)?\b)|(\b[A-Za-z_][\w]*\b)(?=\s*\()|(\b[A-Za-z_][\w]*\b)/g,
    sh: /(#[^\n]*)|("(?:\\.|[^"\\])*"|'[^']*')|(\b\d+\b)|(\$\{?[A-Za-z_][\w]*\}?|--?[A-Za-z][\w-]*)|(\b[A-Za-z_][\w-]*\b)/g,
    sql: /(--[^\n]*|\/\*[\s\S]*?\*\/)|('(?:''|[^'])*')|(\b\d+(?:\.\d+)?\b)|(\b[A-Za-z_][\w]*\b)(?=\s*\()|(\b[A-Za-z_][\w]*\b)/g,
    yaml: /(#[^\n]*)|("(?:\\.|[^"\\\n])*"|'[^'\n]*')|(\b\d+(?:\.\d+)?\b)|(^[ \t-]*[\w.-]+)(?=\s*:)|(\b(?:true|false|null|yes|no)\b)/gm,
  };
  const span = (c, s) => `<span class="tk-${c}">${esc(s)}</span>`;

  function highlight(code, lang) {
    const fam = FAMILY[(lang || '').toLowerCase()];
    if (!fam) return esc(code);
    if (fam === 'json') {
      return esc(code).replace(/(&quot;(?:\\.|[^&\\])*?&quot;)(\s*:)?|\b(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\b|\b(true|false|null)\b/g,
        (m, s, colon, n, k) => (s ? `<span class="tk-${colon ? 'f' : 's'}">${s}</span>${colon || ''}` : n ? `<span class="tk-n">${n}</span>` : `<span class="tk-k">${k}</span>`));
    }
    if (fam === 'html') {
      return esc(code).replace(/(&lt;!--[\s\S]*?--&gt;)|(&lt;\/?[A-Za-z][\w:-]*)|(\s[\w:-]+)(=)(&quot;[^&]*?&quot;|'[^']*')?|(\/?&gt;)/g,
        (m, c, t, a, eq, v, e) => (c ? `<span class="tk-c">${c}</span>` : t ? `<span class="tk-t">${t}</span>` : a ? `<span class="tk-a">${a}</span>${eq}${v ? `<span class="tk-s">${v}</span>` : ''}` : `<span class="tk-t">${e}</span>`));
    }
    if (fam === 'css') {
      return esc(code).replace(/(\/\*[\s\S]*?\*\/)|(&quot;[^&]*?&quot;|'[^']*')|(#[0-9a-fA-F]{3,8}\b|\b\d+(?:\.\d+)?(?:px|em|rem|%|vh|vw|s|ms|deg)?\b)|(@[\w-]+)|([\w-]+)(\s*:)/g,
        (m, c, s, n, at, p, col) => (c ? `<span class="tk-c">${c}</span>` : s ? `<span class="tk-s">${s}</span>` : n ? `<span class="tk-n">${n}</span>` : at ? `<span class="tk-k">${at}</span>` : `<span class="tk-a">${p}</span>${col}`));
    }
    const rx = RX[fam]; rx.lastIndex = 0;
    const kws = fam === 'yaml' ? SETS.lit : SETS[fam];
    const ci = fam === 'sql';
    let out = '', last = 0, m;
    while ((m = rx.exec(code))) {
      out += esc(code.slice(last, m.index));
      const [all, com, str, num, fn, ident] = m;
      if (com) out += span('c', all);
      else if (str) out += span('s', all);
      else if (num) out += span('n', all);
      else if (fam === 'yaml' && fn) out += span('f', all);
      else if (fam === 'yaml') out += span('k', all);
      else if (fam === 'sh' && fn) out += span('a', all);
      else if (fn && kws.has(ci ? fn.toLowerCase() : fn)) out += span('k', all);
      else if (fn && fam !== 'sh') out += span('f', all);
      else if (ident && kws.has(ci ? ident.toLowerCase() : ident)) out += span('k', all);
      else out += esc(all);
      last = m.index + all.length;
      if (all.length === 0) rx.lastIndex++;
    }
    return out + esc(code.slice(last));
  }

  // ── inline ───────────────────────────────────────────────────────────
  function inline(text, ctx) {
    const codes = [];
    let t = text.replace(/(`+)([\s\S]*?[^`])\1(?!`)/g, (m, a, c) => { codes.push(c.replace(/^ (.*) $/, '$1')); return '\u0000' + (codes.length - 1) + '\u0000'; });
    t = esc(t);
    t = t.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, (m, label, url) => `<a data-href="${url}" title="${url}">${label}</a>`);
    t = t.replace(/(^|[\s(>])(https?:\/\/[^\s<)]+[^\s<).,;:!?])/g, (m, pre, url) => `${pre}<a data-href="${url}" title="${url}">${url}</a>`);
    t = t.replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<strong>$1</strong>').replace(/__(?=\S)([\s\S]*?\S)__/g, '<strong>$1</strong>');
    t = t.replace(/(^|[^\w*])\*(?=[^\s*])([^*\n]*?[^\s*])\*(?![\w*])/g, '$1<em>$2</em>').replace(/(^|[^\w_])_(?=[^\s_])([^_\n]*?[^\s_])_(?![\w_])/g, '$1<em>$2</em>');
    t = t.replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<del>$1</del>');
    if (ctx && ctx.cites) {
      t = t.replace(/\[(\d{1,2}(?:\s*,\s*\d{1,2})*)\](?!\()/g, (m, nums) => nums.split(/\s*,\s*/).map((n) => {
        const k = parseInt(n, 10);
        return k >= 1 && k <= ctx.cites ? `<sup class="cite" data-n="${k}" title="Show source ${k}">${k}</sup>` : '';
      }).join(''));
    }
    return t.replace(/\u0000(\d+)\u0000/g, (m, i) => `<code>${esc(codes[+i])}</code>`);
  }

  // ── blocks ───────────────────────────────────────────────────────────
  const FENCE = /^\s{0,3}(`{3,}|~{3,})\s*([\w+#.-]*)[^\n]*$/;
  const LISTITEM = /^(\s*)([-*+]|\d{1,3}[.)])\s+(.*)$/;
  const SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

  function codeBlock(lang, code, ctx) {
    const l = (lang || '').toLowerCase();
    const runnable = ['js', 'javascript', 'node'].includes(l);
    const previewable = ['html', 'svg'].includes(l);
    return `<div class="codeblock" data-lang="${esc(l)}"><div class="codehead"><span class="lang">${esc(l || 'text')}</span>` +
      (runnable ? `<button data-act="run" title="Run in a sandbox (no network, 5 s limit)">${ic('play')}Run</button>` : '') +
      (previewable ? `<button data-act="preview" title="Preview (scripts disabled)">${ic('eye')}Preview</button>` : '') +
      `<button data-act="copy" title="Copy code">${ic('copy')}Copy</button></div><pre><code>${highlight(code, l)}</code></pre></div>`;
  }

  function splitRow(line) {
    let s = line.trim();
    if (s.startsWith('|')) s = s.slice(1);
    if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
    return s.split(/(?<!\\)\|/).map((c) => c.replace(/\\\|/g, '|').trim());
  }

  function buildList(items, from, ctx) {
    const base = items[from].indent, ordered = items[from].ordered;
    let i = from, html = '';
    while (i < items.length && items[i].indent >= base) {
      const it = items[i];
      if (it.indent === base && it.ordered !== ordered) break;
      let body = inline(it.text.replace(/^\[( |x|X)\]\s+/, (m, c) => (c === ' ' ? '☐ ' : '☑ ')), ctx).replace(/\n/g, '<br>');
      i++;
      if (i < items.length && items[i].indent > base) { const sub = buildList(items, i, ctx); body += sub.html; i = sub.next; }
      html += `<li>${body}</li>`;
    }
    const tag = ordered ? 'ol' : 'ul';
    const start = ordered && items[from].start > 1 ? ` start="${items[from].start}"` : '';
    return { html: `<${tag}${start}>${html}</${tag}>`, next: i };
  }

  function blocks(src, ctx) {
    const lines = src.replace(/\r\n?/g, '\n').split('\n');
    let out = '', i = 0, para = [];
    const flush = () => { if (para.length) { out += `<p>${inline(para.join('\n'), ctx).replace(/\n/g, '<br>')}</p>`; para = []; } };
    while (i < lines.length) {
      const line = lines[i];
      let m;
      if ((m = FENCE.exec(line))) {
        flush();
        const marker = m[1][0], len = m[1].length, lang = m[2];
        const body = [];
        i++;
        while (i < lines.length && !new RegExp('^\\s{0,3}' + marker + '{' + len + ',}\\s*$').test(lines[i])) body.push(lines[i++]);
        i++;
        out += codeBlock(lang, body.join('\n'), ctx);
        continue;
      }
      if (!line.trim()) { flush(); i++; continue; }
      if ((m = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line))) { flush(); const n = Math.min(4, m[1].length); out += `<h${n}>${inline(m[2], ctx)}</h${n}>`; i++; continue; }
      if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) { flush(); out += '<hr>'; i++; continue; }
      if (/^\s{0,3}>/.test(line)) {
        flush();
        const q = [];
        while (i < lines.length && /^\s{0,3}>/.test(lines[i])) q.push(lines[i++].replace(/^\s{0,3}>\s?/, ''));
        out += `<blockquote>${blocks(q.join('\n'), ctx)}</blockquote>`;
        continue;
      }
      if (line.includes('|') && i + 1 < lines.length && SEP.test(lines[i + 1]) && lines[i + 1].includes('-')) {
        flush();
        const head = splitRow(line);
        const aligns = splitRow(lines[i + 1]).map((c) => (/^:-+:$/.test(c) ? 'center' : /-:$/.test(c) ? 'right' : ''));
        i += 2;
        const rows = [];
        while (i < lines.length && lines[i].trim() && lines[i].includes('|')) rows.push(splitRow(lines[i++]));
        const cell = (tag, c, k) => `<${tag}${aligns[k] ? ` style="text-align:${aligns[k]}"` : ''}>${inline(c, ctx)}</${tag}>`;
        out += `<div class="tbl"><table><thead><tr>${head.map((c, k) => cell('th', c, k)).join('')}</tr></thead><tbody>` +
          rows.map((r) => `<tr>${head.map((_, k) => cell('td', r[k] || '', k)).join('')}</tr>`).join('') + '</tbody></table></div>';
        continue;
      }
      if (LISTITEM.test(line)) {
        flush();
        const items = [];
        while (i < lines.length) {
          const lm = LISTITEM.exec(lines[i]);
          if (lm) { items.push({ indent: lm[1].replace(/\t/g, '    ').length, ordered: /\d/.test(lm[2]), start: parseInt(lm[2], 10) || 1, text: lm[3] }); i++; continue; }
          if (items.length && /^\s{2,}\S/.test(lines[i]) && !FENCE.test(lines[i])) { items[items.length - 1].text += '\n' + lines[i].trim(); i++; continue; }
          if (!lines[i].trim() && i + 1 < lines.length && LISTITEM.test(lines[i + 1])) { i++; continue; }
          break;
        }
        let k = 0;
        while (k < items.length) { const r = buildList(items, k, ctx); out += r.html; k = r.next; }
        continue;
      }
      para.push(line);
      i++;
    }
    flush();
    return out;
  }

  function render(src, ctx) { return blocks(String(src || ''), ctx || {}); }

  // plain text for read-aloud: drop code blocks and Markdown punctuation
  function plain(src) {
    return String(src || '').replace(/```[\s\S]*?(```|$)/g, ' (code block) ').replace(/`([^`]*)`/g, '$1')
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/^#{1,6}\s+/gm, '').replace(/(\*\*|__|~~|\*|_)/g, '')
      .replace(/^\s*[-*+]\s+/gm, '').replace(/\[\d{1,2}\]/g, '').replace(/\|/g, ' ').replace(/\n{2,}/g, '. ').trim();
  }

  return { render, plain, highlight };
})();
