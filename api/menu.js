const menu = require('../data/menu.json');
module.exports = function handler(req, res) {
  res.setHeader('Cache-Control', 'public, max-age=300');
  return res.status(200).json(menu);
};
