// Read-only knowledge base for the old admin page. Same PIN check and lockout as the dashboard.
const kb = require('../data/knowledge.json');
const { guard } = require('../lib/admin');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET' && req.method !== 'PUT') {
    res.setHeader('Allow', 'GET, PUT');
    return res.status(405).json({ error: 'method_not_allowed' });
  }
  const denied = await guard(req.headers || {});
  if (denied) return res.status(denied.status).json(denied.body);
  if (req.method === 'GET') return res.status(200).json(kb);
  return res.status(503).json({
    error: 'persistent_storage_required',
    message: 'الحفظ الدائم سيُفعّل بعد ربط مخزن بيانات دائم.'
  });
};
