// Wraps a shared handler ({method, query, body, headers}) => {status, body} for Vercel functions.
module.exports = function adapter(routes) {
  return async function handler(req, res) {
    const fn = routes[req.method];
    res.setHeader('Cache-Control', 'no-store');
    if (!fn) { res.setHeader('Allow', Object.keys(routes).join(', ')); return res.status(405).json({ error: 'method_not_allowed' }); }
    try {
      let body = req.body;
      if (typeof body === 'string') { try { body = JSON.parse(body || '{}'); } catch { return res.status(400).json({ error: 'bad_json' }); } }
      const r = await fn({ method: req.method, query: req.query || {}, body: body || {}, headers: req.headers || {} });
      return res.status(r.status).json(r.body);
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: 'صار خطأ في الخادم، جرّب بعد شوي.' });
    }
  };
};
