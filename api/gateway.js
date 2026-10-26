// Single Vercel function for every /api/v1/* call (keeps the project within the function limit).
// Not named app.js/index.js/server.js: Vercel treats those names as a whole-server entrypoint.
const { handle } = require('../lib/router');
const { jsonOnly } = require('../lib/security');

module.exports = async function gateway(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const url = new URL(req.url, 'http://local');
  const query = Object.assign({}, req.query || {});
  let path = query.p || '';
  delete query.p;
  if (Array.isArray(path)) path = path.join('/');
  if (!path) { const m = url.pathname.match(/\/api\/(?:v1|gateway)\/?(.*)$/); path = m ? m[1] : ''; }
  if (!jsonOnly(req.method, req.headers)) return res.status(415).json({ error: 'json_only', message: 'الطلب لازم يكون JSON.' });
  let body;
  try { body = req.body; } catch { return res.status(400).json({ error: 'bad_json', message: 'بيانات الطلب غير صحيحة.' }); }
  if (typeof body === 'string') { try { body = JSON.parse(body || '{}'); } catch { return res.status(400).json({ error: 'bad_json', message: 'بيانات الطلب غير صحيحة.' }); } }
  const r = await handle(req.method, path, { query, body: body || {}, headers: req.headers || {} });
  return res.status(r.status).json(r.body);
};
