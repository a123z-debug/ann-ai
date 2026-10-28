// Shop settings: stored in the KV store, with safe defaults.
const { kv } = require('./store');
const { waNumber, riyadh } = require('./util');
const shop = require('../data/shop.json');

const TYPES = ['pickup', 'dinein', 'delivery'];

function defaults() {
  return {
    open: process.env.ORDERS_OPEN !== 'false',
    whatsapp: process.env.SHOP_WHATSAPP || shop.whatsapp || '',
    deliveryFee: Number(process.env.DELIVERY_FEE || 0) || 0,
    types: { pickup: true, dinein: true, delivery: true },
    payAtCounter: true,
    payOnline: true,
    soldOut: [],
    tables: 12,
    branches: [{ id: 'main', name: 'الفرع الرئيسي، شمال محايل عسير', active: true }],
    hours: { enabled: false, open: '07:00', close: '01:00' },
    prepMinutes: 10,
    loyalty: { enabled: true, stamps: 8, cap: 25 },
    walletBonus: 0,
    topupAmounts: [50, 100, 200],
    giftAmounts: [50, 100, 200],
    invoice: { vatNumber: '', legalName: 'آن coffee', crNumber: '', address: 'شمال محايل عسير' }
  };
}

function merge(saved) {
  const d = defaults();
  const s = Object.assign(d, saved || {});
  s.types = Object.assign(defaults().types, (saved && saved.types) || {});
  s.hours = Object.assign(defaults().hours, (saved && saved.hours) || {});
  s.loyalty = Object.assign(defaults().loyalty, (saved && saved.loyalty) || {});
  s.invoice = Object.assign(defaults().invoice, (saved && saved.invoice) || {});
  if (!Array.isArray(s.soldOut)) s.soldOut = [];
  if (!Array.isArray(s.branches) || !s.branches.length) s.branches = defaults().branches;
  return s;
}

// Settings change rarely and are read on almost every request: keep a 5-second copy per process
// (saves one database round trip per request on warm serverless instances).
let cached = null, cachedAt = 0;
const TTL = 5000;
async function load() {
  if (!cached || Date.now() - cachedAt > TTL) { cached = merge(await kv.get('settings').catch(() => null)); cachedAt = Date.now(); }
  return structuredClone(cached);
}
async function save(s) { await kv.set('settings', s); cached = structuredClone(s); cachedAt = Date.now(); }

const toMin = t => { const m = String(t || '').match(/^(\d{1,2}):(\d{2})$/); return m ? (+m[1]) * 60 + (+m[2]) : null; };
function withinHours(s, ms) {
  if (!s.hours || !s.hours.enabled) return true;
  const o = toMin(s.hours.open), c = toMin(s.hours.close);
  if (o == null || c == null || o === c) return true;
  const r = riyadh(ms); const now = r.hh * 60 + r.mm;
  return o < c ? now >= o && now < c : now >= o || now < c;
}
function reachable(s) { return kv.durable || Boolean(waNumber(s.whatsapp)); }
function acceptingNow(s, ms) { return !!s.open && reachable(s) && withinHours(s, ms); }

function publicView(s, extra) {
  const online = Boolean(process.env.MOYASAR_PUBLISHABLE_KEY && process.env.MOYASAR_SECRET_KEY) && s.payOnline !== false;
  const inHours = withinHours(s);
  return Object.assign({
    open: acceptingNow(s),
    closedReason: !s.open ? 'paused' : !reachable(s) ? 'setup' : !inHours ? 'hours' : '',
    hours: s.hours,
    setupNeeded: !reachable(s),
    types: s.types,
    deliveryFee: s.deliveryFee,
    whatsapp: waNumber(s.whatsapp) || '',
    payAtCounter: s.payAtCounter !== false || !online,
    payOnline: online,
    moyasarKey: online ? process.env.MOYASAR_PUBLISHABLE_KEY : '',
    soldOut: s.soldOut,
    branches: s.branches.filter(b => b.active !== false).map(b => ({ id: b.id, name: b.name })),
    prepMinutes: s.prepMinutes,
    loyalty: s.loyalty,
    walletBonus: s.walletBonus,
    topupAmounts: s.topupAmounts,
    giftAmounts: s.giftAmounts,
    invoiceVat: Boolean(s.invoice && s.invoice.vatNumber),
    durable: kv.durable
  }, extra || {});
}

module.exports = { TYPES, defaults, load, save, publicView, acceptingNow, withinHours, reachable };
