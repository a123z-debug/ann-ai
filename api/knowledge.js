const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const KB_PATH = path.join(process.cwd(), 'data', 'knowledge.json');

function authorized(req) {
  const expected = String(process.env.ADMIN_PIN || '');
  const received = String(req.headers['x-admin-pin'] || '');
  if (!expected || !received) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = async function handler(req, res) {
  if (!authorized(req)) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  if (req.method === 'GET') {
    try {
      return res.status(200).json(JSON.parse(fs.readFileSync(KB_PATH, 'utf8')));
    } catch {
      return res.status(500).json({ error: 'knowledge_unavailable' });
    }
  }

  if (req.method === 'PUT') {
    return res.status(503).json({
      error: 'persistent_storage_required',
      message: 'الحفظ الدائم سيُفعّل بعد ربط مخزن بيانات دائم.'
    });
  }

  res.setHeader('Allow', 'GET, PUT');
  return res.status(405).json({ error: 'method_not_allowed' });
};
