'use strict';

// Built-in tools that run as plain code in the page (never as model output): a calculator, unit conversion,
// date arithmetic, memory commands and small text-matching helpers. Their results are handed to the model as
// exact facts and shown to the user as chips, so numbers are never left to the language model.
const Tools = (() => {
  // ── calculator: tokenizer + shunting-yard, no eval ───────────────────
  const FUNCS = {
    sqrt: Math.sqrt, abs: Math.abs, round: Math.round, floor: Math.floor, ceil: Math.ceil, sin: (x) => Math.sin(x), cos: (x) => Math.cos(x), tan: (x) => Math.tan(x),
    ln: Math.log, log: Math.log10, log10: Math.log10, log2: Math.log2, exp: Math.exp,
  };
  const FUNC2 = { min: Math.min, max: Math.max, pow: Math.pow };
  const CONST = { pi: Math.PI, e: Math.E };
  const PREC = { '+': 1, '-': 1, '*': 2, '/': 2, '%': 2, '^': 4, 'u-': 3 };
  const RIGHT = { '^': true, 'u-': true };

  function tokenize(src) {
    const s = src.replace(/,(?=\d{3}(\D|$))/g, '').replace(/(?<=[\d)\s])x(?=\s*[\d(])/gi, '*').replace(/[×·]/g, '*').replace(/÷/g, '/').replace(/\*\*/g, '^').replace(/\bmod\b/gi, '%');
    const toks = []; let i = 0;
    while (i < s.length) {
      const c = s[i];
      if (/\s/.test(c)) { i++; continue; }
      let m;
      if ((m = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(s.slice(i)))) { toks.push({ t: 'n', v: parseFloat(m[0]) }); i += m[0].length; continue; }
      if ((m = /^[a-z][a-z0-9]*/i.exec(s.slice(i)))) {
        const w = m[0].toLowerCase();
        if (w in CONST) toks.push({ t: 'n', v: CONST[w] });
        else if (w in FUNCS || w in FUNC2) toks.push({ t: 'f', v: w });
        else throw new Error('unknown word ' + w);
        i += m[0].length; continue;
      }
      if ('+-*/^%(),'.includes(c)) { toks.push({ t: c === '(' || c === ')' || c === ',' ? c : 'o', v: c }); i++; continue; }
      throw new Error('bad character ' + c);
    }
    return toks;
  }

  function evaluate(src) {
    const toks = tokenize(src);
    const out = [], ops = [];
    let prev = null;
    const apply = (op) => {
      if (op === 'u-') { out.push(-out.pop()); return; }
      const b = out.pop(), a = out.pop();
      if (a === undefined || b === undefined) throw new Error('malformed');
      out.push(op === '+' ? a + b : op === '-' ? a - b : op === '*' ? a * b : op === '/' ? a / b : op === '%' ? a % b : Math.pow(a, b));
    };
    for (const tk of toks) {
      if (tk.t === 'n') { out.push(tk.v); prev = 'n'; }
      else if (tk.t === 'f') { ops.push({ f: tk.v, argc: 1 }); prev = 'f'; }
      else if (tk.t === '(') { ops.push('('); prev = '('; }
      else if (tk.t === ',') {
        while (ops.length && ops[ops.length - 1] !== '(') apply(ops.pop());
        const f = ops[ops.length - 2]; if (f && f.f) f.argc++;
        prev = ',';
      } else if (tk.t === ')') {
        while (ops.length && ops[ops.length - 1] !== '(') apply(ops.pop());
        if (!ops.length) throw new Error('unbalanced');
        ops.pop();
        const f = ops[ops.length - 1];
        if (f && f.f) {
          ops.pop();
          if (f.f in FUNC2) { const args = out.splice(out.length - f.argc, f.argc); out.push(FUNC2[f.f](...args)); }
          else out.push(FUNCS[f.f](out.pop()));
        }
        prev = 'n';
      } else {
        let op = tk.v;
        if (op === '-' && (prev === null || prev === 'o' || prev === '(' || prev === ',')) op = 'u-';
        else if (op === '+' && (prev === null || prev === 'o' || prev === '(' || prev === ',')) { prev = 'o'; continue; }
        while (ops.length) {
          const top = ops[ops.length - 1];
          if (top === '(' || top.f) break;
          if (PREC[top] > PREC[op] || (PREC[top] === PREC[op] && !RIGHT[op])) apply(ops.pop()); else break;
        }
        ops.push(op); prev = 'o';
      }
    }
    while (ops.length) { const o = ops.pop(); if (o === '(' || o.f) throw new Error('unbalanced'); apply(o); }
    if (out.length !== 1 || !isFinite(out[0])) throw new Error('no result');
    return out[0];
  }

  function fmtNum(v) {
    if (Number.isInteger(v) && Math.abs(v) < 1e15) return v.toLocaleString('en-US');
    const r = Math.abs(v) >= 1e15 || Math.abs(v) < 1e-6 ? v.toExponential(6) : String(parseFloat(v.toPrecision(12)));
    return r;
  }

  // Find a calculation in a chat message. Returns {expr, result, text} or null.
  function detectMath(msg) {
    const text = msg.trim();
    if (text.length > 220) return null;
    // "15% of 240"
    let m = /(\d+(?:\.\d+)?)\s*%\s*of\s*(\d[\d,]*(?:\.\d+)?)/i.exec(text);
    if (m) { const v = (parseFloat(m[1]) / 100) * parseFloat(m[2].replace(/,/g, '')); return { expr: `${m[1]}% of ${m[2]}`, result: v, text: `${m[1]}% of ${m[2]} = ${fmtNum(v)}` }; }
    if (/\d{4}-\d{2}-\d{2}/.test(text) || /\b\d{3}[-.\s]\d{3,4}[-.\s]\d{3,4}\b/.test(text)) return null;
    const cue = /\b(calculate|compute|evaluate|what(?:'s| is)|how much is|solve|equals?|=)\b/i.test(text);
    // the longest run that looks like arithmetic
    const rx = /(?:\b(?:sqrt|abs|round|floor|ceil|sin|cos|tan|ln|log|log10|log2|exp|min|max|pow)\s*\([^)]*\)|[\d.,]+|[()+\-*/^%×÷x·]|\bpi\b|\bmod\b|\s)+/gi;
    let best = null;
    for (const r of text.matchAll(rx)) {
      const e = r[0].trim().replace(/^[=x·×*/^%]+|[+\-*/^%(×÷x·]+$/gi, '').trim();
      if (!/\d/.test(e) || !/[+\-*/^%×÷·]|\bx\b|\w\s*\(/i.test(e)) continue;
      if ((e.match(/\d+(?:\.\d+)?/g) || []).length < 2 && !/\w\s*\(/.test(e)) continue;
      if (!best || e.length > best.length) best = e;
    }
    if (!best) return null;
    if (!cue && text.replace(best, '').trim().length > 14) return null;   // only a clear calculation, not a number in a sentence
    try {
      const v = evaluate(best);
      return { expr: best, result: v, text: `${best.replace(/\s+/g, ' ')} = ${fmtNum(v)}` };
    } catch { return null; }
  }

  // ── unit conversion ──────────────────────────────────────────────────
  const U = {
    // length (metres)
    mm: ['len', 0.001], cm: ['len', 0.01], m: ['len', 1], km: ['len', 1000], in: ['len', 0.0254], inch: ['len', 0.0254], inches: ['len', 0.0254], ft: ['len', 0.3048], feet: ['len', 0.3048], foot: ['len', 0.3048],
    yd: ['len', 0.9144], yard: ['len', 0.9144], yards: ['len', 0.9144], mi: ['len', 1609.344], mile: ['len', 1609.344], miles: ['len', 1609.344], kilometers: ['len', 1000], kilometres: ['len', 1000], meters: ['len', 1], metres: ['len', 1],
    // mass (kg)
    g: ['mass', 0.001], kg: ['mass', 1], lb: ['mass', 0.45359237], lbs: ['mass', 0.45359237], pound: ['mass', 0.45359237], pounds: ['mass', 0.45359237], oz: ['mass', 0.0283495231], ounce: ['mass', 0.0283495231], ounces: ['mass', 0.0283495231], kilos: ['mass', 1], kilograms: ['mass', 1], grams: ['mass', 0.001], stone: ['mass', 6.35029318],
    // volume (litres)
    ml: ['vol', 0.001], l: ['vol', 1], liter: ['vol', 1], liters: ['vol', 1], litre: ['vol', 1], litres: ['vol', 1], gal: ['vol', 3.785411784], gallon: ['vol', 3.785411784], gallons: ['vol', 3.785411784], cup: ['vol', 0.2365882365], cups: ['vol', 0.2365882365], tbsp: ['vol', 0.01478676], tsp: ['vol', 0.00492892], floz: ['vol', 0.0295735],
    // speed (m/s)
    'km/h': ['spd', 1 / 3.6], kph: ['spd', 1 / 3.6], kmh: ['spd', 1 / 3.6], mph: ['spd', 0.44704], 'm/s': ['spd', 1], knots: ['spd', 0.514444], knot: ['spd', 0.514444],
    // data (bytes)
    b: ['data', 1], kb: ['data', 1024], mb: ['data', 1048576], gb: ['data', 1073741824], tb: ['data', 1099511627776],
  };
  const TEMP = { c: 'c', celsius: 'c', f: 'f', fahrenheit: 'f', k: 'k', kelvin: 'k' };

  function detectUnits(msg) {
    const m = /(-?\d+(?:[.,]\d+)?)\s*°?\s*([a-z/]+)\s+(?:to|in|into|as)\s+°?\s*([a-z/]+)\b/i.exec(msg);
    if (!m) return null;
    const v = parseFloat(m[1].replace(',', '.')), a = m[2].toLowerCase(), b = m[3].toLowerCase();
    if (TEMP[a] && TEMP[b]) {
      const toC = TEMP[a] === 'c' ? v : TEMP[a] === 'f' ? (v - 32) * 5 / 9 : v - 273.15;
      const r = TEMP[b] === 'c' ? toC : TEMP[b] === 'f' ? toC * 9 / 5 + 32 : toC + 273.15;
      return { text: `${fmtNum(v)} °${TEMP[a].toUpperCase()} = ${fmtNum(+r.toFixed(2))} °${TEMP[b].toUpperCase()}` };
    }
    if (U[a] && U[b] && U[a][0] === U[b][0]) {
      const r = v * U[a][1] / U[b][1];
      return { text: `${fmtNum(v)} ${a} = ${fmtNum(+r.toPrecision(8))} ${b}` };
    }
    return null;
  }

  // ── dates ────────────────────────────────────────────────────────────
  const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  function parseDate(s) {
    s = s.trim();
    let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
    m = /^(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3,9})\.?,?\s*(\d{4})?$/i.exec(s) || null;
    if (m) { const mo = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()); if (mo >= 0) return new Date(m[3] ? +m[3] : new Date().getFullYear(), mo, +m[1]); }
    m = /^([a-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s*(\d{4})?$/i.exec(s);
    if (m) { const mo = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()); if (mo >= 0) return new Date(m[3] ? +m[3] : new Date().getFullYear(), mo, +m[2]); }
    if (/^today$/i.test(s)) return new Date(new Date().setHours(0, 0, 0, 0));
    if (/^tomorrow$/i.test(s)) { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + 1); return d; }
    return null;
  }
  const DATE_PART = '(\\d{4}-\\d{2}-\\d{2}|today|tomorrow|\\d{1,2}(?:st|nd|rd|th)?\\s+[a-z]{3,9}\\.?,?\\s*(?:\\d{4})?|[a-z]{3,9}\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s*(?:\\d{4})?)';
  function detectDates(msg) {
    let m = new RegExp('how many days (?:are there |is it )?(?:until|till|to|before)\\s+' + DATE_PART, 'i').exec(msg);
    if (m) {
      const d = parseDate(m[1]); if (!d) return null;
      const t = new Date(); t.setHours(0, 0, 0, 0);
      const n = Math.round((d - t) / 864e5);
      return { text: `${n} day${Math.abs(n) === 1 ? '' : 's'} from today (${t.toDateString()}) until ${d.toDateString()}` };
    }
    m = new RegExp('(?:days|time)?\\s*between\\s+' + DATE_PART + '\\s+and\\s+' + DATE_PART, 'i').exec(msg) || new RegExp('from\\s+' + DATE_PART + '\\s+(?:to|until)\\s+' + DATE_PART, 'i').exec(msg);
    if (m) {
      const a = parseDate(m[1]), b = parseDate(m[2]); if (!a || !b) return null;
      const n = Math.round((b - a) / 864e5);
      return { text: `${Math.abs(n)} days between ${a.toDateString()} and ${b.toDateString()}` };
    }
    m = new RegExp('what (?:day|weekday)(?: of the week)? (?:is|was|will)\\s+(?:it\\s+)?(?:on\\s+)?' + DATE_PART, 'i').exec(msg);
    if (m) { const d = parseDate(m[1]); if (d) return { text: `${d.toDateString()} is a ${d.toLocaleDateString('en-US', { weekday: 'long' })}` }; }
    return null;
  }

  // ── memory & recall intents ──────────────────────────────────────────
  function firstToThird(s) {
    let t = s.trim().replace(/[.!\s]+$/, '');
    const rules = [
      [/^i['’]m\s+/i, 'User is '], [/^i am\s+/i, 'User is '], [/^i['’]ve\s+/i, 'User has '], [/^i have\s+/i, 'User has '], [/^i['’]ll\s+/i, 'User will '],
      [/^i (like|love|prefer|use|work|live|speak|study|play|hate|want|need|own|drive|eat|drink|enjoy|teach|manage|run|write|code|read|watch|avoid|follow|support)\b/i, (m, v) => 'User ' + v.toLowerCase() + (/(s|x|ch|sh)$/.test(v.toLowerCase()) ? 'es' : 's')],
      [/^my\s+/i, "User's "], [/^i can['’]?t\s+/i, 'User cannot '], [/^i don['’]t\s+/i, 'User does not '],
    ];
    for (const [rx, rep] of rules) if (rx.test(t)) { t = t.replace(rx, rep); break; }
    if (!/^User/.test(t)) t = 'User note: ' + t;
    t = t.replace(/\b(I|me)\b/g, 'the user').replace(/\bmy\b/gi, "the user's");
    return t.charAt(0).toUpperCase() + t.slice(1) + '.';
  }

  function memoryCommand(msg) {
    let m = /^\s*(?:please\s+)?(?:remember|memorize|note|keep in mind)\s*(?:that|:)?\s+(.{3,300})$/is.exec(msg);
    if (m && !/\?\s*$/.test(m[1])) return { type: 'remember', fact: firstToThird(m[1]) };
    m = /^\s*(?:please\s+)?from now on[,:]?\s+(.{4,240})$/is.exec(msg);
    if (m) return { type: 'remember', fact: 'User wants: ' + m[1].trim().replace(/[.!\s]+$/, '') + '.' };
    m = /^\s*(?:please\s+)?(?:forget|delete|remove|erase)\s+(?:that\s+|about\s+|my\s+memory (?:of|about)\s+|what i (?:said|told you) about\s+)?(.{2,200})$/is.exec(msg);
    if (m && !/\b(chat|conversation|file|message|this)\b/i.test(m[1])) return { type: 'forget', query: m[1].replace(/[.!\s]+$/, '') };
    return null;
  }
  const FACT_CUE = /\b(i am|i['’]m|i['’]ve|i live|i work|i have|i study|my (name|wife|husband|partner|girlfriend|boyfriend|daughter|son|kids?|child|children|dog|cat|job|company|team|manager|boss|favou?rite|birthday|hometown|city|country|language|role|title)|call me|i (like|love|prefer|hate|use|speak|play|own|drive|enjoy|am allergic|avoid)|i['’]m (a|an|the)\b|we (live|work|have)|always (answer|reply|respond|write|use|give)|never (use|write|give|say))\b/i;
  const RECALL_CUE = /\b(earlier|last time|previously|before|we (talked|discussed|spoke|chatted)|you (said|told|mentioned|suggested|wrote)|remember when|our (last |previous )?(chat|conversation|discussion)|as we (said|discussed)|that (thing|plan|idea) (we|you))\b/i;

  // ── text matching helpers (memory selection, chat recall, chat search) ──
  const STOP = new Set('the and for are but you your with that this from have has had was were will would could should about what when where which who how why not can its into than then them they their there here our out all any one just very also been being over under more most some such only other these those while does did doing done get got make made use used using like want need please tell give show let me my we us it is in on at by to of as be or if so do an a i'.split(' '));
  function tokens(s) { return (String(s).toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).filter((t) => t.length > 1 && !STOP.has(t)).map((t) => (t.length > 5 ? t.slice(0, 5) : t)); }

  // BM25 over small in-memory documents: docs = [{id, text}]
  function rank(docs, query, limit = 5, minScore = 0.01) {
    const q = [...new Set(tokens(query))];
    if (!q.length || !docs.length) return [];
    const tfs = docs.map((d) => { const m = new Map(); for (const t of tokens(d.text)) m.set(t, (m.get(t) || 0) + 1); return m; });
    const lens = tfs.map((m) => [...m.values()].reduce((a, b) => a + b, 0) || 1);
    const avg = lens.reduce((a, b) => a + b, 0) / docs.length;
    const N = docs.length;
    const df = new Map();
    for (const t of q) df.set(t, tfs.filter((m) => m.has(t)).length);
    const res = [];
    docs.forEach((d, i) => {
      let s = 0;
      for (const t of q) {
        const f = tfs[i].get(t); if (!f) continue;
        const idf = Math.log(1 + (N - df.get(t) + 0.5) / (df.get(t) + 0.5));
        s += idf * (f * 2.2) / (f + 1.2 * (0.25 + 0.75 * lens[i] / avg));
      }
      if (s > minScore) res.push({ doc: d, score: s });
    });
    return res.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  // "draw a picture of …", "generate an image of …" → the description to paint (null if the message isn't asking for a picture)
  const IMG_NOUN = '(?:image|picture|photo|photograph|illustration|drawing|painting|artwork|logo|icon|wallpaper|poster|sketch|portrait|cartoon|render(?:ing)?)';
  function imageIntent(msg) {
    const lead = new RegExp(String.raw`^\s*(?:(?:please|pls|can you|could you|would you|i want you to|i need you to)\s+)*(generate|create|make|draw|paint|design|render|produce|illustrate|sketch)\s+(?:me\s+)?`, 'i');
    const m = lead.exec(msg);
    if (!m) return null;
    let rest = msg.slice(m[0].length);
    // it must really name a picture: "an image of…", "a cute cartoon cat picture", "a logo for…"
    const named = new RegExp(String.raw`^(?:an?\s+|the\s+|some\s+)?(?:[\w-]+\s+){0,3}?${IMG_NOUN}\b`, 'i');
    if (new RegExp(String.raw`^(?:an?\s+|the\s+)?(?:table|chart|graph|diagram|flowchart|plot|timeline|schedule)\b`, 'i').test(rest)) return null;
    if (!named.test(rest)) return /^(draw|paint|sketch|illustrate)$/i.test(m[1]) && rest.trim().length >= 3 ? rest.trim() : null;   // "draw a cat"
    // drop only the generic lead-in ("an image of …"); keep adjectives and meaningful nouns (logo, poster…)
    rest = rest.replace(new RegExp(String.raw`^(?:an?\s+|the\s+|some\s+)?(?:image|picture|photo|photograph|illustration|drawing|painting|artwork)\b\s*(?:of|showing|with|depicting|that shows|about|:|-)\s*`, 'i'), '');
    rest = rest.trim();
    return rest.length >= 3 ? rest : msg.trim();
  }

  return { imageIntent, evaluate, detectMath, detectUnits, detectDates, memoryCommand, firstToThird, FACT_CUE, RECALL_CUE, tokens, rank, fmtNum };
})();
