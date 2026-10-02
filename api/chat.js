const fs = require('fs');
const path = require('path');

const KB_PATH = path.join(process.cwd(), 'data', 'knowledge.json');

function normalize(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[^\u0600-\u06FFa-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function readKnowledge() {
  return JSON.parse(fs.readFileSync(KB_PATH, 'utf8'));
}

function answer(message, kb) {
  const q = normalize(message);
  let best = null;
  let score = 0;

  for (const item of kb.facts || []) {
    let current = 0;
    for (const keyword of item.keywords || []) {
      const k = normalize(keyword);
      if (k && q.includes(k)) current += k.length;
    }
    if (current > score) {
      score = current;
      best = item;
    }
  }

  return best ? best.answer : kb.fallback;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const message = String(body.message || '').slice(0, 1000).trim();

    if (!message) {
      return res.status(400).json({ error: 'empty_message' });
    }

    const kb = readKnowledge();
    return res.status(200).json({ reply: answer(message, kb) });
  } catch {
    return res.status(500).json({ error: 'server_error' });
  }
};
