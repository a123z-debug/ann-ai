// Menu items, option groups and server-side pricing of a cart line.
const menu = require('../data/menu.json');
const { clean } = require('./util');

const ITEMS = new Map(menu.items.map(i => [i.id, i]));
const GROUPS = menu.optionGroups || {};

// Returns { item, opts, unit, optText } or { error } for a requested line.
function priceLine(id, rawOpts) {
  const item = ITEMS.get(String(id || ''));
  if (!item) return { error: 'unknown' };
  const opts = {};
  let add = 0;
  const labels = [];
  const req = rawOpts && typeof rawOpts === 'object' ? rawOpts : {};
  for (const g of item.opts || []) {
    const grp = GROUPS[g]; if (!grp) continue;
    if (grp.type === 'one') {
      const want = req[g] == null ? grp.default : String(req[g]);
      const ch = grp.choices.find(c => c.id === want) || grp.choices.find(c => c.id === grp.default) || grp.choices[0];
      opts[g] = ch.id; add += ch.price || 0;
      if (ch.id !== grp.default || ch.price) labels.push(ch.label);
    } else {
      const want = Array.isArray(req[g]) ? req[g].map(String) : [];
      const picked = grp.choices.filter(c => want.includes(c.id));
      if (picked.length) {
        opts[g] = picked.map(c => c.id);
        for (const c of picked) { add += c.price || 0; labels.push(c.label); }
      }
    }
  }
  return { item, opts, unit: item.price + add, optText: labels.join('، ') };
}

function lineKey(id, opts) {
  const parts = Object.keys(opts || {}).sort().map(k => k + '=' + [].concat(opts[k]).sort().join('+'));
  return id + (parts.length ? '|' + parts.join(';') : '');
}

module.exports = { menu, ITEMS, GROUPS, priceLine, lineKey, clean };
