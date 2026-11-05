'use strict';

// Persistent data (settings, memories, assistants, projects, chats) kept in the app's own data folder through the native key-value store.
const DEFAULT_SETTINGS = {
  theme: 'system', fontSize: 15.5, enterToSend: true, showStats: true,
  nickname: '', about: '', style: '', length: 'balanced',
  memory: true, autoMemory: true, recall: true, tools: true,
  temperature: null, voice: '', rate: 1, describePhotos: true, maxPrompt: 7500,
  defaultAssistant: 'general', sidebar: true, skillsAuto: true, skillsOff: [],
  // hybrid routing: where each request runs, and what may leave the PC
  route: {
    mode: 'auto',               // auto | device | cloud (default for new chats)
    policy: 'local-first',      // local-first | balanced | quality-first — how readily auto mode escalates
    consent: 'ask',             // ask (once per chat) | always | never (cloud only on an explicit "Retry in cloud")
    privacy: 'redact',          // redact | ask | block — when sensitive values are found in what would be sent
    sendPersonal: false,        // name, about-me, memories and recalled chats
    sendFiles: true,            // attached files / retrieved excerpts
    sendImages: false,          // pictures (needs a vision model)
    autoFallback: true,         // cloud unreachable → answer on device; device fails → try the cloud
    allowTemporary: false,      // temporary chats may use the cloud
    dailyCharCap: 300000,       // characters sent per day (0 = no limit)
  },
};

const Store = (() => {
  const S = {
    ready: false,
    settings: { ...DEFAULT_SETTINGS, route: { ...DEFAULT_SETTINGS.route } },
    cloudLog: [],
    memories: [], assistants: [], projects: [], index: [],
    chats: new Map(),
    _recall: null,
  };
  const dirty = new Set();
  const put = (k, v) => Native.isNative ? Native.kvPut(k, v).catch((e) => console.error('save ' + k, e)) : Promise.resolve();
  const flush = debounce(async () => { const keys = [...dirty]; dirty.clear(); for (const k of keys) await put(k, getKey(k)); }, 350);
  function getKey(k) {
    if (k === 'settings') return S.settings;
    if (k === 'memories') return S.memories;
    if (k === 'assistants') return S.assistants;
    if (k === 'projects') return S.projects;
    if (k === 'chatindex') return S.index;
    if (k === 'cloudlog') return S.cloudLog;
    if (k.startsWith('chat_')) return S.chats.get(k.slice(5));
    return null;
  }
  const mark = (k) => { dirty.add(k); flush(); };

  S.load = async () => {
    if (!Native.isNative) { S.ready = true; return; }
    const all = await Native.kvGetAll('').catch(() => ({})) || {};
    if (all.settings) S.settings = { ...DEFAULT_SETTINGS, ...all.settings, route: { ...DEFAULT_SETTINGS.route, ...(all.settings.route || {}) } };
    S.cloudLog = all.cloudlog || [];
    S.memories = all.memories || [];
    S.assistants = all.assistants || [];
    S.projects = all.projects || [];
    S.index = all.chatindex || [];
    for (const [k, v] of Object.entries(all)) if (k.startsWith('chat_') && v && v.id) S.chats.set(v.id, v);
    // an index entry whose chat file is missing is dropped; a chat file missing from the index is re-added
    S.index = S.index.filter((m) => S.chats.has(m.id));
    for (const c of S.chats.values()) if (!S.index.some((m) => m.id === c.id)) S.index.push(S.meta(c));
    S.ready = true;
  };

  S.saveSettings = () => mark('settings');
  S.saveMemories = () => mark('memories');
  S.saveAssistants = () => mark('assistants');
  S.saveProjects = () => mark('projects');
  S.flushNow = () => flush.flush();

  // ── chats ──
  S.newChat = (o = {}) => ({
    id: uid('c'), title: 'New chat', created: Date.now(), updated: Date.now(), pinned: false, archived: false,
    projectId: o.projectId || null, assistantId: o.assistantId || S.settings.defaultAssistant || 'general', temporary: !!o.temporary, route: S.settings.route.mode, cloudOk: false,
    nodes: { root: { id: 'root', role: 'root', children: [], cur: -1 } }, scope: [], summary: '', summaryUpTo: null, v: 1,
  });
  S.meta = (c) => {
    const first = S.path(c).find((n) => n.role === 'user');
    return { id: c.id, title: c.title, created: c.created, updated: c.updated, pinned: c.pinned, archived: c.archived, projectId: c.projectId, assistantId: c.assistantId, preview: first ? first.content.slice(0, 140) : '' };
  };
  S.saveChat = (c) => {
    if (c.temporary) return;
    c.updated = Date.now();
    S.chats.set(c.id, c);
    const m = S.meta(c);
    const i = S.index.findIndex((x) => x.id === c.id);
    if (i >= 0) S.index[i] = m; else S.index.unshift(m);
    S._recall = null;
    mark('chat_' + c.id); mark('chatindex');
  };
  S.deleteChat = (id) => {
    S.chats.delete(id);
    S.index = S.index.filter((m) => m.id !== id);
    S._recall = null;
    dirty.delete('chat_' + id);
    if (Native.isNative) Native.kvDelete('chat_' + id).catch(() => {});
    mark('chatindex');
  };
  S.touchIndex = (c) => { const i = S.index.findIndex((x) => x.id === c.id); if (i >= 0) S.index[i] = S.meta(c); mark('chatindex'); mark('chat_' + c.id); };

  // ── message tree: nodes[id] = {id, parent, role, content, children[], cur, ts, …}; the visible conversation follows `cur` from the root ──
  S.path = (c) => {
    const out = [];
    let n = c.nodes.root;
    while (n && n.children.length) {
      const idx = n.cur >= 0 && n.cur < n.children.length ? n.cur : n.children.length - 1;
      n = c.nodes[n.children[idx]];
      if (n) out.push(n);
    }
    return out;
  };
  S.addNode = (c, parentId, node) => {
    node.id = node.id || uid('m');
    node.parent = parentId;
    node.children = node.children || [];
    node.cur = -1;
    node.ts = node.ts || Date.now();
    c.nodes[node.id] = node;
    const p = c.nodes[parentId];
    p.children.push(node.id);
    p.cur = p.children.length - 1;
    return node;
  };
  S.siblings = (c, n) => c.nodes[n.parent].children;
  S.switchSibling = (c, n, delta) => {
    const p = c.nodes[n.parent];
    const i = p.children.indexOf(n.id) + delta;
    if (i < 0 || i >= p.children.length) return false;
    p.cur = i;
    return true;
  };
  // drop a node and everything below it
  S.removeSubtree = (c, id) => {
    const n = c.nodes[id]; if (!n) return;
    n.children.slice().forEach((k) => S.removeSubtree(c, k));
    const p = c.nodes[n.parent];
    if (p) { p.children = p.children.filter((k) => k !== id); p.cur = p.children.length - 1; }
    delete c.nodes[id];
  };

  // ── cloud usage log (what was sent to the cloud, when and why — stays on this PC) ──
  S.addCloudLog = (e) => { S.cloudLog.unshift(e); if (S.cloudLog.length > 500) S.cloudLog.length = 500; mark('cloudlog'); };
  S.clearCloudLog = () => { S.cloudLog = []; mark('cloudlog'); };
  S.cloudSentToday = () => { const d0 = dayStart(Date.now()); return S.cloudLog.filter((e) => e.ts >= d0 && e.sent).reduce((a, e) => a + (e.chars || 0), 0); };

  // ── memory ──
  S.activeMemories = () => S.memories.filter((m) => m.on !== false);
  S.addMemory = (text, src, chatId) => {
    const t = text.trim();
    if (!t) return null;
    const a = Tools.tokens(t);
    const dupe = S.memories.find((m) => { const b = Tools.tokens(m.text); const inter = a.filter((x) => b.includes(x)).length; return inter / Math.max(1, Math.min(a.length, b.length)) >= 0.8; });
    if (dupe) return dupe;
    const m = { id: uid('mem'), text: t, ts: Date.now(), src: src || 'user', chatId: chatId || null, on: true };
    S.memories.unshift(m);
    S.saveMemories();
    return m;
  };
  S.removeMemory = (id) => { S.memories = S.memories.filter((m) => m.id !== id); S.saveMemories(); };
  // the facts to give the model for this message: all of them when few, otherwise the best matches plus the newest
  S.memoriesFor = (query, limit = 12) => {
    const act = S.activeMemories();
    if (act.length <= limit) return act;
    const hits = Tools.rank(act.map((m) => ({ id: m.id, text: m.text, m })), query, limit - 4, 0).map((r) => r.doc.m);
    const rest = act.filter((m) => !hits.includes(m)).slice(0, limit - hits.length);
    return hits.concat(rest);
  };

  // ── assistants / projects ──
  S.allAssistants = () => BUILTIN_ASSISTANTS.concat(S.assistants);
  S.assistant = (id) => S.allAssistants().find((a) => a.id === id) || BUILTIN_ASSISTANTS[0];
  S.project = (id) => S.projects.find((p) => p.id === id) || null;

  // ── searching chats ──
  S.chatText = (c) => c.title + '\n' + Object.values(c.nodes).filter((n) => n.role === 'user' || n.role === 'assistant').map((n) => n.content).join('\n');
  S.searchChats = (q) => {
    q = q.trim().toLowerCase();
    if (!q) return [];
    const words = q.split(/\s+/).filter(Boolean);
    const res = [];
    for (const m of S.index) {
      const c = S.chats.get(m.id); if (!c) continue;
      const text = S.chatText(c), low = text.toLowerCase();
      if (!words.every((w) => low.includes(w))) continue;
      const inTitle = words.every((w) => m.title.toLowerCase().includes(w));
      const at = low.indexOf(words[0], inTitle ? m.title.length : 0);
      const snip = at >= 0 ? text.slice(Math.max(0, at - 50), at + 110).replace(/\s+/g, ' ') : m.preview;
      res.push({ meta: m, snippet: snip, score: (inTitle ? 100 : 0) + m.updated / 1e13 });
    }
    return res.sort((a, b) => b.score - a.score).slice(0, 40);
  };
  // earlier exchanges from other chats, for "what did we discuss about…" questions
  S.recall = (query, excludeId, limit = 3) => {
    if (!S._recall) {
      S._recall = [];
      for (const c of S.chats.values()) {
        if (c.temporary) continue;
        const p = S.path(c);
        for (let i = 0; i + 1 < p.length; i++) if (p[i].role === 'user' && p[i + 1].role === 'assistant')
          S._recall.push({ id: c.id + '#' + p[i].id, chatId: c.id, title: c.title, ts: p[i].ts, text: p[i].content.slice(0, 300) + ' ' + p[i + 1].content.slice(0, 400) });
      }
    }
    return Tools.rank(S._recall.filter((d) => d.chatId !== excludeId), query, limit, 0.6).map((r) => r.doc);
  };

  // ── export / import ──
  S.exportAll = () => ({ app: 'HybridMind', version: 1, exported: new Date().toISOString(), settings: S.settings, memories: S.memories, assistants: S.assistants, projects: S.projects, chats: [...S.chats.values()].filter((c) => !c.temporary) });
  S.importAll = (data) => {
    if (!data || data.app !== 'HybridMind') throw new Error('That file isn’t a HybridMind export.');
    let nc = 0, nm = 0;
    for (const c of data.chats || []) if (c && c.id && c.nodes && !S.chats.has(c.id)) { S.chats.set(c.id, c); S.index.push(S.meta(c)); mark('chat_' + c.id); nc++; }
    for (const m of data.memories || []) if (m && m.text && !S.memories.some((x) => x.id === m.id)) { S.memories.push(m); nm++; }
    for (const a of data.assistants || []) if (a && a.id && !S.assistants.some((x) => x.id === a.id)) S.assistants.push(a);
    for (const p of data.projects || []) if (p && p.id && !S.projects.some((x) => x.id === p.id)) S.projects.push(p);
    S._recall = null;
    mark('chatindex'); S.saveMemories(); S.saveAssistants(); S.saveProjects();
    return { chats: nc, memories: nm };
  };
  S.deleteAllChats = () => { for (const id of [...S.chats.keys()]) S.deleteChat(id); S.index = []; mark('chatindex'); };

  return S;
})();
