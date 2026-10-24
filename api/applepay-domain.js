// Serves the Apple Pay domain-association file that Moyasar gives you (paste it into APPLE_PAY_DOMAIN_ASSOCIATION).
module.exports = function handler(req, res) {
  const v = process.env.APPLE_PAY_DOMAIN_ASSOCIATION || '';
  if (!v) return res.status(404).send('not configured');
  res.setHeader('Content-Type', 'text/plain');
  return res.status(200).send(v);
};
