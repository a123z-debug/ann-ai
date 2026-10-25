// Single Vercel function for every /api/v1/* call (keeps the project within the function limit).
const { handle } = require('../lib/router');

module.exports = async function app(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const url = new URL(req.url, 'http://local');
  const query = Object.assign({}, req.query || {});
  let path = query.p || '';
  delete query.p;
  if (Array.isArray(path)) path = path.join('/');
  if (!path) { const m = url.pathname.match(/\/api\/(?:v1|app)\/?(.*)$/); path = m ? m[1] : ''; }
  if (path === 'diag' || query.diag === '1') return res.status(200).json({ url: req.url, path, query, method: req.method, ct: req.headers['content-type'] || '' });
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body || '{}'); } catch { return res.status(400).json({ error: 'bad_json' }); } }
  const r = await handle(req.method, path, { query, body: body || {}, headers: req.headers || {} });
  return res.status(r.status).json(r.body);
};
