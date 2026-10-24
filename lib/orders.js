// Ordering logic for آن coffee, shared by server.js (Railway/local) and api/*.js (Vercel).
// Every handler takes { method, query, body, headers } and returns { status, body }.

const crypto = require('crypto');
const menu = require('../data/menu.json');
const shop = require('../data/shop.json');
const store = require('./store');

const ITEMS = new Map(menu.items.map(i => [i.id, i]));
const STATUSES = ['awaiting_payment', 'new', 'preparing', 'ready', 'done', 'cancelled'];
const TYPES = ['pickup', 'dinein', 'delivery'];
const TYPE_AR = { pickup: 'استلام من المحل', dinein: 'داخل المحل', delivery: 'توصيل' };
const WHEN_AR = { asap: 'بأقرب وقت', '15': 'بعد ١٥ دقيقة', '30': 'بعد ٣٠ دقيقة', '45': 'بعد ٤٥ دقيقة', '60': 'بعد ساعة' };

const MOYASAR_PK = process.env.MOYASAR_PUBLISHABLE_KEY || '';
const MOYASAR_SK = process.env.MOYASAR_SECRET_KEY || '';
const onlineConfigured = Boolean(MOYASAR_PK && MOYASAR_SK);

const ok = body => ({ status: 200, body });
const fail = (status, error, message) => ({ status, body: { error, message } });

const MAX_TRIES = 8, LOCK_SEC = 15 * 60;
function clientIp(headers) {
  const h = headers || {};
  return String(h['x-real-ip'] || String(h['x-forwarded-for'] || '').split(',')[0] || 'local').trim().slice(0, 64);
}
function pinMatches(headers) {
  const expected = String(process.env.ADMIN_PIN || '');
  const got = String((headers && (headers['x-admin-pin'] || headers['X-Admin-Pin'])) || '');
  if (!expected || !got) return false;
  const a = crypto.createHash('sha256').update(expected).digest(), b = crypto.createHash('sha256').update(got).digest();
  return crypto.timingSafeEqual(a, b);
}
// Returns null when allowed, or a failure response (wrong PIN / too many tries).
async function guard(headers) {
  const key = 'pin:' + clientIp(headers);
  const tries = await store.hits(key).catch(() => 0);
  if (tries >= MAX_TRIES) return fail(429, 'locked', 'محاولات كثيرة. جرّب بعد ١٥ دقيقة.');
  if (pinMatches(headers)) return null;
  await store.hit(key, LOCK_SEC).catch(() => 0);
  return fail(401, 'unauthorized', 'رمز الإدارة غير صحيح.');
}

const clean = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const toLatin = s => String(s || '').replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d));

function normalizePhone(v) {
  const d = toLatin(v).replace(/[^\d+]/g, '');
  const m = d.match(/^(?:\+?966|00966|0)?(5\d{8})$/);
  return m ? '0' + m[1] : null;
}
function waNumber(v) {
  const d = toLatin(v).replace(/\D/g, '');
  if (/^05\d{8}$/.test(d)) return '966' + d.slice(1);
  if (/^5\d{8}$/.test(d)) return '966' + d;
  if (/^9665\d{8}$/.test(d)) return d;
  if (/^009665\d{8}$/.test(d)) return d.slice(2);
  return d.length >= 8 ? d : '';
}

// ---------- settings ----------
function defaults() {
  return {
    open: process.env.ORDERS_OPEN !== 'false',
    whatsapp: process.env.SHOP_WHATSAPP || shop.whatsapp || '',
    deliveryFee: Number(process.env.DELIVERY_FEE || 0) || 0,
    types: { pickup: true, dinein: true, delivery: true },
    payAtCounter: true,
    payOnline: true,
    soldOut: [],
    tables: 12
  };
}
async function settings() {
  const saved = await store.getSettings().catch(() => null);
  const d = defaults();
  const s = Object.assign(d, saved || {});
  s.types = Object.assign(defaults().types, (saved && saved.types) || {});
  if (!Array.isArray(s.soldOut)) s.soldOut = [];
  return s;
}
function publicSettings(s) {
  const online = onlineConfigured && s.payOnline !== false;
  // Never take an order we can't deliver to the shop: needs storage or a WhatsApp number.
  const reachable = store.durable || Boolean(waNumber(s.whatsapp));
  return {
    open: !!s.open && reachable,
    setupNeeded: !reachable,
    types: s.types,
    deliveryFee: s.deliveryFee,
    whatsapp: waNumber(s.whatsapp) || '',
    payAtCounter: s.payAtCounter !== false || !online,
    payOnline: online,
    moyasarKey: online ? MOYASAR_PK : '',
    soldOut: s.soldOut,
    durable: store.durable
  };
}

// ---------- order text ----------
const money = n => (Math.round(n * 100) / 100).toString();
function orderText(o) {
  const L = [];
  L.push(`طلب جديد من موقع آن coffee 🤎`);
  L.push(`رقم الطلب: #${o.number}`);
  L.push(`النوع: ${TYPE_AR[o.type]}${o.type === 'dinein' ? ` • طاولة ${o.table}` : ''}${o.type === 'pickup' ? ` • ${WHEN_AR[o.when] || WHEN_AR.asap}` : ''}`);
  if (o.name) L.push(`الاسم: ${o.name}`);
  if (o.phone) L.push(`الجوال: ${o.phone}`);
  if (o.type === 'delivery') {
    L.push(`العنوان: ${o.address}`);
    if (o.location) L.push(`الموقع: https://maps.google.com/?q=${o.location.lat},${o.location.lng}`);
  }
  L.push('');
  for (const l of o.lines) L.push(`${l.qty}× ${l.name}${l.variant ? ` (${l.variant})` : ''} = ${money(l.total)} ر.س${l.note ? `\n   ملاحظة: ${l.note}` : ''}`);
  L.push('');
  if (o.deliveryFee) L.push(`التوصيل: ${money(o.deliveryFee)} ر.س`);
  L.push(`الإجمالي: ${money(o.total)} ر.س`);
  L.push(`الدفع: ${o.pay === 'online' ? (o.paid ? 'مدفوع إلكترونيًا ✅' : 'إلكتروني (بانتظار الدفع)') : 'عند الاستلام'}`);
  if (o.notes) L.push(`ملاحظات: ${o.notes}`);
  return L.join('\n');
}

function view(o, s) {
  const wa = waNumber(s && s.whatsapp);
  return Object.assign({}, o, { whatsappUrl: wa ? `https://wa.me/${wa}?text=${encodeURIComponent(orderText(o))}` : '' });
}

// ---------- handlers ----------
async function getSettingsPublic() {
  return ok(publicSettings(await settings()));
}

async function createOrder({ body }) {
  const s = await settings();
  if (!s.open || !(store.durable || waNumber(s.whatsapp))) return fail(409, 'closed', 'استقبال الطلبات متوقف حاليًا، ويبدأ مع الافتتاح.');
  body = body || {};

  const type = String(body.type || '');
  if (!TYPES.includes(type) || !s.types[type]) return fail(400, 'type', 'اختر طريقة استلام متاحة.');

  const raw = Array.isArray(body.items) ? body.items.slice(0, 40) : [];
  const lines = [];
  for (const r of raw) {
    const it = ITEMS.get(String(r && r.id));
    const qty = Math.floor(Number(r && r.qty));
    if (!it || !(qty >= 1 && qty <= 20)) continue;
    if (s.soldOut.includes(it.id)) return fail(409, 'sold_out', `«${it.name}» خلص حاليًا، احذفه من السلة.`);
    const note = clean(r.note, 80);
    const line = { id: it.id, name: it.name, variant: it.variant || '', price: it.price, qty, total: it.price * qty };
    if (note) line.note = note;
    lines.push(line);
  }
  if (!lines.length) return fail(400, 'empty', 'السلة فاضية.');

  const name = clean(body.name, 40);
  const phone = body.phone ? normalizePhone(body.phone) : null;
  const o = { type, lines, notes: clean(body.notes, 200) };

  if (type === 'dinein') {
    const table = Math.floor(Number(toLatin(body.table)));
    if (!(table >= 1 && table <= 300)) return fail(400, 'table', 'اكتب رقم الطاولة.');
    o.table = table;
    if (name) o.name = name;
    if (body.phone && !phone) return fail(400, 'phone', 'رقم الجوال غير صحيح، اكتبه مثل 05xxxxxxxx.');
    if (phone) o.phone = phone;
  } else {
    if (name.length < 2) return fail(400, 'name', 'اكتب اسمك.');
    if (!phone) return fail(400, 'phone', 'رقم الجوال غير صحيح، اكتبه مثل 05xxxxxxxx.');
    o.name = name; o.phone = phone;
  }
  if (type === 'pickup') o.when = WHEN_AR[body.when] ? String(body.when) : 'asap';
  if (type === 'delivery') {
    const address = clean(body.address, 200);
    const loc = body.location || {};
    const lat = Number(loc.lat), lng = Number(loc.lng);
    const hasLoc = Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
    if (address.length < 6 && !hasLoc) return fail(400, 'address', 'اكتب عنوانك أو شارك موقعك.');
    o.address = address || 'الموقع المرسل';
    if (hasLoc) o.location = { lat: +lat.toFixed(6), lng: +lng.toFixed(6) };
  }

  const pub = publicSettings(s);
  const pay = body.pay === 'online' ? 'online' : 'counter';
  if (pay === 'online' && !pub.payOnline) return fail(400, 'pay', 'الدفع الإلكتروني غير متاح حاليًا، اختر الدفع عند الاستلام.');
  if (pay === 'counter' && !pub.payAtCounter) return fail(400, 'pay', 'اختر الدفع الإلكتروني.');

  o.subtotal = lines.reduce((n, l) => n + l.total, 0);
  o.deliveryFee = type === 'delivery' ? s.deliveryFee : 0;
  o.total = o.subtotal + o.deliveryFee;
  if (pay === 'online' && o.total < 1) return fail(400, 'amount', 'المبلغ أقل من الحد الأدنى للدفع.');
  o.pay = pay;
  o.paid = false;
  o.status = pay === 'online' ? 'awaiting_payment' : 'new';
  o.id = crypto.randomBytes(12).toString('base64url');
  o.number = await store.nextNumber().catch(() => 1000 + Math.floor(Math.random() * 9000));
  o.createdAt = Date.now();
  o.updatedAt = o.createdAt;
  o.history = [{ status: o.status, at: o.createdAt }];

  let stored = true;
  try { await store.saveOrder(o); } catch { stored = false; }
  return ok({ order: view(o, s), stored: stored && store.durable });
}

async function getOrder({ query }) {
  const o = await store.getOrder(query && (query.id || query.o));
  if (!o) return fail(404, 'not_found', 'ما لقينا الطلب.');
  return ok({ order: view(o, await settings()), stored: store.durable });
}

async function verifyPayment({ body }) {
  body = body || {};
  const o = await store.getOrder(body.order);
  if (!o) return fail(404, 'not_found', 'ما لقينا الطلب.');
  if (o.paid) return ok({ order: view(o, await settings()) });
  if (!onlineConfigured) return fail(400, 'not_configured', 'الدفع الإلكتروني غير مفعّل.');
  const pid = String(body.payment || '');
  if (!/^[A-Za-z0-9_-]{6,80}$/.test(pid)) return fail(400, 'payment', 'رقم العملية غير صحيح.');
  const r = await fetch(`https://api.moyasar.com/v1/payments/${encodeURIComponent(pid)}`, {
    headers: { Authorization: 'Basic ' + Buffer.from(MOYASAR_SK + ':').toString('base64') }
  });
  const p = await r.json().catch(() => ({}));
  const meta = p.metadata || {};
  const good = r.ok && p.status === 'paid' && p.currency === 'SAR' && Number(p.amount) === Math.round(o.total * 100) && (meta.order_id === o.id || meta.order === o.id);
  if (!good) return fail(402, 'not_paid', p.status === 'failed' ? 'ما تمت عملية الدفع، جرّب مرة ثانية.' : 'ما تأكد الدفع.');
  o.paid = true; o.paymentId = pid; o.status = 'new'; o.updatedAt = Date.now();
  o.history.push({ status: 'new', at: o.updatedAt, note: 'paid' });
  await store.saveOrder(o);
  return ok({ order: view(o, await settings()) });
}

async function adminList({ headers, query }) {
  const denied = await guard(headers); if (denied) return denied;
  const hours = Math.min(Math.max(Number(query && query.hours) || 24, 1), 24 * 30);
  const list = await store.listOrders(Date.now() - hours * 3600e3);
  list.sort((a, b) => b.createdAt - a.createdAt);
  return ok({ orders: list, durable: store.durable, storage: store.kind, online: onlineConfigured, now: Date.now() });
}

async function adminUpdate({ headers, body }) {
  const denied = await guard(headers); if (denied) return denied;
  body = body || {};
  const o = await store.getOrder(body.id);
  if (!o) return fail(404, 'not_found', 'ما لقينا الطلب.');
  if (body.status) {
    if (!STATUSES.includes(body.status)) return fail(400, 'status', 'حالة غير معروفة.');
    o.status = body.status; o.updatedAt = Date.now();
    o.history.push({ status: o.status, at: o.updatedAt });
  }
  if (typeof body.paid === 'boolean') { o.paid = body.paid; o.updatedAt = Date.now(); }
  await store.saveOrder(o);
  return ok({ order: o });
}

async function adminSettings({ method, headers, body }) {
  const denied = await guard(headers); if (denied) return denied;
  const s = await settings();
  if (method === 'GET') return ok({ settings: s, menu: menu.items, durable: store.durable, storage: store.kind, online: onlineConfigured });
  body = body || {};
  if (typeof body.open === 'boolean') s.open = body.open;
  if (body.whatsapp !== undefined) s.whatsapp = clean(body.whatsapp, 20);
  if (body.deliveryFee !== undefined) s.deliveryFee = Math.max(0, Math.min(200, Number(toLatin(body.deliveryFee)) || 0));
  if (body.types && typeof body.types === 'object') for (const t of TYPES) if (typeof body.types[t] === 'boolean') s.types[t] = body.types[t];
  if (typeof body.payAtCounter === 'boolean') s.payAtCounter = body.payAtCounter;
  if (typeof body.payOnline === 'boolean') s.payOnline = body.payOnline;
  if (Array.isArray(body.soldOut)) s.soldOut = body.soldOut.filter(id => ITEMS.has(id));
  if (body.tables !== undefined) s.tables = Math.max(1, Math.min(300, Math.floor(Number(toLatin(body.tables))) || 12));
  await store.saveSettings(s);
  return ok({ settings: s });
}

module.exports = { getSettingsPublic, createOrder, getOrder, verifyPayment, adminList, adminUpdate, adminSettings, orderText, normalizePhone, waNumber };
