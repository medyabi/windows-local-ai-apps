'use strict';

// Built-in assistants (like custom GPTs: a name, instructions and starter prompts) and the system prompt builder.
const BUILTIN_ASSISTANTS = [
  {
    id: 'general', builtin: true, name: 'HybridMind', letter: 'H', color: '#7a6cf5', description: 'General-purpose assistant for questions, writing, brainstorming and more.',
    instructions: '',
    starters: ['Explain how a transistor works, in simple terms', 'Draft a polite email asking to reschedule a meeting', 'Give me a 3-day study plan for learning SQL', 'What are the pros and cons of electric cars?'],
  },
  {
    id: 'writer', builtin: true, name: 'Writer', letter: 'W', color: '#e0709a', description: 'Drafts and edits emails, posts and documents.',
    instructions: 'You are a professional writing assistant. When asked to write something, give the finished text first, then at most one short note offering a change. When editing, keep the user\'s meaning and voice and show the improved version. Ask one brief clarifying question only if it is essential.',
    starters: ['Write a friendly reminder email about an overdue invoice', 'Rewrite this to sound more confident: "I think maybe we could possibly try this"', 'Draft a LinkedIn post announcing a new job', 'Turn these notes into a clear 5-bullet summary'],
  },
  {
    id: 'coder', builtin: true, name: 'Coder', letter: 'C', color: '#2fa77f', description: 'Writes, explains and debugs code.',
    instructions: 'You are a careful senior software engineer. Give working code in fenced blocks that name the language, then explain briefly and mention important edge cases. Prefer simple, readable solutions. If you are not sure that a library function or API exists, say so instead of inventing it.',
    starters: ['Write a Python function that removes duplicates from a list but keeps the order', 'Explain what this regex does: ^(?=.*\\d)(?=.*[a-z]).{8,}$', 'Show a JavaScript debounce function with an example', 'Write a SQL query for the top 5 customers by total spend'],
  },
  {
    id: 'tutor', builtin: true, name: 'Tutor', letter: 'T', color: '#e0a13a', description: 'Explains concepts step by step and checks understanding.',
    instructions: 'You are a patient tutor. Explain step by step in plain language with a small example, avoid jargon unless you define it, and finish with one short question that checks understanding.',
    starters: ['Teach me how compound interest works', 'Explain recursion with an example I can try', 'Help me understand the difference between TCP and UDP', 'Quiz me on the basics of photosynthesis'],
  },
  {
    id: 'translator', builtin: true, name: 'Translator', letter: 'Tr', color: '#3a8fe0', description: 'Translates between languages and keeps the tone.',
    instructions: 'You are a translator. Translate faithfully and naturally, keep names, numbers and formatting, and reply with the translation only unless asked to explain. If the target language is unclear, ask which one.',
    starters: ['Translate to French: "Could we move the meeting to Thursday afternoon?"', 'Translate to Spanish: "Thank you for your patience."', 'Translate to German: "The report is attached."', 'Translate to Arabic: "Good morning, how can I help you?"'],
  },
  {
    id: 'analyst', builtin: true, name: 'Document analyst', letter: 'D', color: '#3fb1c9', description: 'Answers from the files you attach, with citations.',
    instructions: 'You answer questions about the user\'s attached files. Quote exact figures and dates, cite excerpt numbers like [1] when excerpts are numbered, and say clearly when the files do not contain the answer. Do not use outside knowledge for facts about the files.',
    starters: ['Summarize the attached file in five bullets', 'List every date and deadline mentioned in the files', 'What are the key risks or obligations in this document?', 'Extract all amounts and who they are owed to'],
  },
];

const clip = (s, n) => (s && s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s || '');

function buildSystem(chat, route) {
  const cloud = route === 'cloud';
  const personal = !cloud || Store.settings.route.sendPersonal;   // name / about-me only go to the cloud if the user allows it
  const s = Store.settings, a = Store.assistant(chat.assistantId), proj = chat.projectId ? Store.project(chat.projectId) : null;
  const who = a.id === 'general' ? 'HybridMind' : `${a.name}, a HybridMind assistant`;
  const parts = [];
  const where = cloud ? 'answering through a cloud language model' : "running on the user's own Windows PC with an on-device model (no internet)";
  parts.push(`You are ${who}, a friendly assistant ${where}. The user is the person writing to you: "my", "me" and "I" in their messages always refer to the user, never to you. You cannot browse the web, look up live information (news, prices, weather) or open links, and you know nothing about recent events; say so instead of guessing. Never invent facts, numbers, quotes, links, or names of real businesses, places or people; if you are unsure, say you are unsure. Use Markdown only when it helps (lists, bold, tables) and code blocks only for code, with the language name.`);
  parts.push(s.length === 'concise' ? 'Keep answers short and direct unless the user asks for more.' : s.length === 'detailed' ? 'Give thorough, well-organised answers, with steps or examples where they help.' : 'Be clear and reasonably concise.');
  parts.push('Current date and time: ' + new Date().toLocaleString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }) + ' (the user\'s local time).');
  if (a.instructions) parts.push(clip(a.instructions, 900));
  if (proj && proj.instructions) parts.push('Project instructions: ' + clip(proj.instructions, 600));
  const you = [];
  if (personal && s.nickname) you.push(`The user's name is ${clip(s.nickname, 60)}.`);
  if (personal && s.about) you.push('About the user: ' + clip(s.about, 500));
  if (s.style) you.push('How the user wants you to respond: ' + clip(s.style, 500));
  if (you.length) parts.push(you.join('\n'));
  return parts.join('\n\n');
}

function memoryBlock(query) {
  if (!Store.settings.memory) return '';
  const mem = Store.memoriesFor(query);
  if (!mem.length) return '';
  let out = '', n = 0;
  for (const m of mem) { const line = '- ' + clip(m.text, 160) + '\n'; if (out.length + line.length > 900) break; out += line; n++; }
  return n ? 'What you remember about the user from earlier conversations (use it only when it is relevant; do not recite it or mention that you have a memory unless asked):\n' + out.trimEnd() : '';
}
