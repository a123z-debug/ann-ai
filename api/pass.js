const { buildPass, missingConfig } = require('../lib/pass');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  if (String(req.query?.check || '') === '1') {
    return res.status(200).json({ ready: missingConfig().length === 0 });
  }

  try {
    const pkpass = buildPass();
    res.setHeader('Content-Type', 'application/vnd.apple.pkpass');
    res.setHeader('Content-Disposition', 'attachment; filename="ann-coffee.pkpass"');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).send(pkpass);
  } catch (e) {
    if (e.code === 'NOT_CONFIGURED') return res.status(503).json({ error: 'wallet_not_configured' });
    return res.status(500).json({ error: 'pass_build_failed' });
  }
};
