// Orders for آن coffee: create, track, update, rate, pay, report.
const { kv, withLock } = require('./store');
const U = require('./util');
const S = require('./settings');
const M = require('./menu');
const accounts = require('./accounts');
const C = require('./commerce');
const push = require('./push');

const STATUSES = ['awaiting_payment', 'new', 'preparing', 'ready', 'done', 'cancelled'];
const TYPE_AR = { pickup: 'استلام من المحل', dinein: 'داخل المحل', delivery: 'توصيل' };
const WHEN_AR = { asap: 'بأقرب وقت', '15': 'بعد ١٥ دقيقة', '30': 'بعد ٣٠ دقيقة', '45': 'بعد ٤٥ دقيقة', '60': 'بعد ساعة' };
const PAY_AR = { counter: 'عند الاستلام', online: 'إلكتروني', wallet: 'من رصيد المحفظة', free: 'مجاني' };
const ORDER_TTL = 400 * 86400;
const { ok, fail } = U;

const oKey = id => 'order:' + id;
async function getRaw(id) { return /^[A-Za-z0-9_-]{8,40}$/.test(String(id || '')) ? kv.get(oKey(id)) : null; }
// Every change bumps a revision number, so the dashboard can ask "anything new?" for one read.
async function save(o) { o.updatedAt = Date.now(); await kv.set(oKey(o.id), o, ORDER_TTL); await kv.incr('orders:rev', 1).catch(() => 0); return o; }

function orderText(o, s) {
  const L = [];
  L.push('طلب جديد من موقع آن coffee 🤎');
  L.push(`رقم الطلب: #${o.number}`);
  const br = s && s.branches.length > 1 ? (s.branches.find(b => b.id === o.branch) || {}).name : '';
  L.push(`النوع: ${TYPE_AR[o.type]}${o.type === 'dinein' ? ` • طاولة ${o.table}` : ''}${o.type === 'pickup' ? ` • ${WHEN_AR[o.when] || WHEN_AR.asap}` : ''}${br ? ` • ${br}` : ''}`);
  if (o.name) L.push(`الاسم: ${o.name}`);
  if (o.phone) L.push(`الجوال: ${o.phone}`);
  if (o.type === 'delivery') {
    L.push(`العنوان: ${o.address}`);
    if (o.location) L.push(`الموقع: https://maps.google.com/?q=${o.location.lat},${o.location.lng}`);
  }
  L.push('');
  for (const l of o.lines) {
    L.push(`${l.qty}× ${l.name}${l.variant ? ` (${l.variant})` : ''} = ${U.fmt(l.total)} ر.س`);
    if (l.optText) L.push(`   ${l.optText}`);
    if (l.note) L.push(`   ملاحظة: ${l.note}`);
  }
  L.push('');
  for (const d of o.discounts || []) L.push(`${d.label}: -${U.fmt(d.amount)} ر.س`);
  if (o.deliveryFee) L.push(`التوصيل: ${U.fmt(o.deliveryFee)} ر.س`);
  L.push(`الإجمالي: ${U.fmt(o.total)} ر.س`);
  L.push(`الدفع: ${PAY_AR[o.pay] || o.pay}${o.paid ? ' ✅' : ''}`);
  if (o.notes) L.push(`ملاحظات: ${o.notes}`);
  return L.join('\n');
}

function invoice(o, s) {
  const inv = s.invoice || {};
  const vatAmount = U.money(o.total * 15 / 115);
  const out = { number: o.number, legalName: inv.legalName || 'آن coffee', address: inv.address || '', vatNumber: inv.vatNumber || '', crNumber: inv.crNumber || '', vat: vatAmount, net: U.money(o.total - vatAmount) };
  if (inv.vatNumber) out.qr = C.zatcaQR({ seller: out.legalName, vat: inv.vatNumber, time: new Date(o.createdAt).toISOString(), total: o.total, vatAmount });
  return out;
}

function view(o, s) {
  const wa = U.waNumber(s.whatsapp);
  const v = Object.assign({}, o, {
    whatsappUrl: wa ? `https://wa.me/${wa}?text=${encodeURIComponent(orderText(o, s))}` : '',
    invoice: invoice(o, s),
    readyBy: o.createdAt + (s.prepMinutes || 10) * 60000 + (o.type === 'pickup' && WHEN_AR[o.when] && o.when !== 'asap' ? (+o.when) * 60000 : 0),
    branchName: (s.branches.find(b => b.id === o.branch) || {}).name || ''
  });
  delete v.push; delete v.accountId; delete v.paymentId;
  return v;
}

function summary(o) {
  return {
    id: o.id, number: o.number, status: o.status, total: o.total, type: o.type, createdAt: o.createdAt, rating: o.rating ? o.rating.stars : null,
    lines: o.lines.map(l => ({ id: l.id, name: l.name, variant: l.variant, qty: l.qty, optText: l.optText, opts: l.opts, note: l.note || '' }))
  };
}

function closedMessage(s) {
  const p = S.publicView(s);
  if (p.closedReason === 'hours') return `نستقبل الطلبات من ${s.hours.open} إلى ${s.hours.close}.`;
  return 'استقبال الطلبات متوقف حاليًا، ويبدأ مع الافتتاح.';
}

// ---------- create ----------
async function createOrder({ body, headers }) {
  const s = await S.load();
  if (!S.acceptingNow(s)) return fail(409, 'closed', closedMessage(s));
  body = body || {};

  const type = String(body.type || '');
  if (!S.TYPES.includes(type) || !s.types[type]) return fail(400, 'type', 'اختر طريقة استلام متاحة.');
  const branches = s.branches.filter(b => b.active !== false);
  const branch = (branches.find(b => b.id === body.branch) || branches[0] || { id: 'main' }).id;

  const lines = [];
  for (const r of (Array.isArray(body.items) ? body.items.slice(0, 40) : [])) {
    const p = M.priceLine(r && r.id, r && r.opts);
    const qty = Math.floor(Number(r && r.qty));
    if (p.error || !(qty >= 1 && qty <= 20)) continue;
    if (s.soldOut.includes(p.item.id)) return fail(409, 'sold_out', `«${p.item.name}» خلص حاليًا، احذفه من السلة.`);
    const line = { id: p.item.id, key: M.lineKey(p.item.id, p.opts), name: p.item.name, variant: p.item.variant || '', opts: p.opts, optText: p.optText, unit: p.unit, qty, total: U.money(p.unit * qty), drink: p.item.drink !== false };
    const note = U.clean(r.note, 80); if (note) line.note = note;
    lines.push(line);
  }
  if (!lines.length) return fail(400, 'empty', 'السلة فاضية.');

  const name = U.clean(body.name, 40);
  const phone = body.phone ? U.normalizePhone(body.phone) : null;
  const o = { type, branch, lines, notes: U.clean(body.notes, 200) };
  if (type === 'dinein') {
    const table = Math.floor(Number(U.toLatin(body.table)));
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
    const address = U.clean(body.address, 200);
    const loc = body.location || {};
    const lat = Number(loc.lat), lng = Number(loc.lng);
    const hasLoc = Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
    if (address.length < 6 && !hasLoc) return fail(400, 'address', 'اكتب عنوانك أو شارك موقعك.');
    o.address = address || 'الموقع المرسل';
    if (hasLoc) o.location = { lat: +lat.toFixed(6), lng: +lng.toFixed(6) };
  }

  const acct = await accounts.fromHeaders(headers);
  o.subtotal = U.money(lines.reduce((n, l) => n + l.total, 0));
  o.discounts = [];

  // loyalty reward: the dearest drink, up to the cap
  let rewardUsed = false;
  if (body.useReward) {
    if (!acct || !s.loyalty.enabled) return fail(400, 'reward', 'المكافأة تحتاج حسابك في آن.');
    const best = lines.filter(l => l.drink).sort((a, b) => b.unit - a.unit)[0];
    if (!best) return fail(400, 'reward', 'المكافأة على المشروبات، أضف مشروب للسلة.');
    if (!(await accounts.useReward(acct.id))) return fail(400, 'reward', 'ما عندك مكافأة متاحة.');
    rewardUsed = true;
    o.discounts.push({ type: 'reward', label: `مشروب مجاني: ${best.name}`, amount: U.money(Math.min(best.unit, Number(s.loyalty.cap) || best.unit)) });
  }
  const restore = async () => { if (rewardUsed) await accounts.restoreReward(acct.id).catch(() => {}); };

  if (body.promo) {
    const after = o.subtotal - o.discounts.reduce((n, d) => n + d.amount, 0);
    const pr = await C.checkPromo(body.promo, after);
    if (pr.error) { await restore(); return fail(400, 'promo', pr.message); }
    o.discounts.push({ type: 'promo', code: pr.code, label: `${pr.label} (${pr.code})`, amount: pr.discount });
  }

  const discountTotal = U.money(o.discounts.reduce((n, d) => n + d.amount, 0));
  o.deliveryFee = type === 'delivery' ? U.money(s.deliveryFee) : 0;
  o.total = U.money(Math.max(0, o.subtotal - discountTotal) + o.deliveryFee);

  const pub = S.publicView(s);
  let pay = ['online', 'wallet', 'counter'].includes(body.pay) ? body.pay : 'counter';
  if (o.total === 0) pay = 'free';
  if (pay === 'online' && !pub.payOnline) { await restore(); return fail(400, 'pay', 'الدفع الإلكتروني غير متاح حاليًا.'); }
  if (pay === 'online' && o.total < 1) { await restore(); return fail(400, 'amount', 'المبلغ أقل من الحد الأدنى للدفع.'); }
  if (pay === 'counter' && !pub.payAtCounter) { await restore(); return fail(400, 'pay', 'اختر طريقة دفع ثانية.'); }
  if (pay === 'wallet' && !acct) { await restore(); return fail(400, 'pay', 'الدفع من المحفظة يحتاج حسابك في آن.'); }

  o.pay = pay;
  o.paid = pay === 'free';
  o.status = pay === 'online' ? 'awaiting_payment' : 'new';
  o.id = U.randomId(12);
  o.number = kv.durable ? 1000 + await kv.incr('seq', 1) : 1000 + (Math.floor(Date.now() / 1000) % 9000);
  o.createdAt = Date.now();
  o.history = [{ status: o.status, at: o.createdAt }];
  if (acct) o.accountId = acct.id;
  o.push = [];

  if (pay === 'wallet') {
    const a = await accounts.debit(acct.id, o.total, 'order', o.id, `طلب #${o.number}`);
    if (!a) { await restore(); return fail(402, 'balance', 'رصيد المحفظة ما يكفي.'); }
    o.paid = true;
  }

  try { await save(o); await kv.zadd('orders', o.createdAt, o.id); }
  catch (e) {
    if (pay === 'wallet') await accounts.credit(acct.id, o.total, 'refund', o.id, 'استرجاع').catch(() => {});
    await restore();
    return fail(500, 'save', 'ما قدرنا نحفظ الطلب، جرّب مرة ثانية.');
  }

  if (o.discounts.some(d => d.type === 'promo')) await C.consumePromo(o.discounts.find(d => d.type === 'promo').code).catch(() => {});
  const fresh = acct ? await accounts.afterOrder(acct.id, o.id, { name: o.name, phone: o.phone }).catch(() => null) : null;
  if (o.status === 'new') await notifyAdmins(o, s);
  return ok({ order: view(o, s), stored: kv.durable, account: accounts.view(fresh) });
}

async function notifyAdmins(o, s) {
  if (!kv.durable) return;
  await push.notify(await push.adminHashes().catch(() => []), {
    title: `طلب جديد #${o.number}`,
    body: `${TYPE_AR[o.type]}${o.type === 'dinein' ? ` • طاولة ${o.table}` : ''} • ${U.fmt(o.total)} ر.س`,
    url: '/orders', tag: 'new-' + o.id
  }).catch(() => 0);
}

async function getOrder({ query }) {
  const o = await getRaw(query && (query.id || query.o));
  if (!o) return fail(404, 'not_found', 'ما لقينا الطلب.');
  return ok({ order: view(o, await S.load()), stored: kv.durable });
}

async function rateOrder({ body }) {
  body = body || {};
  return withLock('order:' + body.id, async () => {
    const o = await getRaw(body.id);
    if (!o) return fail(404, 'not_found', 'ما لقينا الطلب.');
    if (o.status !== 'done') return fail(400, 'status', 'تقدر تقيّم بعد استلام الطلب.');
    const stars = Math.round(Number(body.stars));
    if (!(stars >= 1 && stars <= 5)) return fail(400, 'stars', 'اختر من ١ إلى ٥ نجوم.');
    if (o.rating && Date.now() - o.rating.at > 24 * 3600e3) return fail(400, 'late', 'انتهى وقت تعديل التقييم.');
    o.rating = { stars, comment: U.clean(body.comment, 300), at: Date.now() };
    await save(o);
    return ok({ order: view(o, await S.load()) });
  });
}

async function linkPush(orderId, h) {
  return withLock('order:' + orderId, async () => {
    const o = await getRaw(orderId); if (!o) return false;
    o.push = [h].concat((o.push || []).filter(x => x !== h)).slice(0, 5);
    await save(o); return true;
  });
}

// ---------- payment confirmation ----------
async function confirmOrderPayment(id, paymentId) {
  const o0 = await getRaw(id);
  if (!o0) return fail(404, 'not_found', 'ما لقينا الطلب.');
  const s = await S.load();
  if (o0.paid) return ok({ order: view(o0, s) });
  const chk = await C.checkPayment(paymentId, Math.round(o0.total * 100), 'order', o0.id);
  if (chk.error) return fail(402, chk.error, chk.message);
  const o = await withLock('order:' + id, async () => {
    const x = await getRaw(id);
    if (x.paid) return x;
    x.paid = true; x.paymentId = paymentId;
    if (x.status === 'awaiting_payment') { x.status = 'new'; x.history.push({ status: 'new', at: Date.now(), note: 'paid' }); }
    return save(x);
  });
  await notifyAdmins(o, s);
  return ok({ order: view(o, s) });
}

// ---------- dashboard ----------
async function listOrders(sinceMs) {
  const ids = await kv.zrange('orders', sinceMs, '+inf');
  return (await kv.mget(ids.map(oKey))).filter(Boolean);
}

// Only what the cashier board shows (the full view with invoice and WhatsApp text is ~3x larger).
function boardRow(o, s) {
  const r = {};
  for (const k of ['id', 'number', 'status', 'type', 'table', 'when', 'name', 'phone', 'address', 'location', 'notes', 'total', 'pay', 'paid', 'createdAt', 'updatedAt', 'branch']) if (o[k] !== undefined) r[k] = o[k];
  r.lines = o.lines.map(l => ({ name: l.name, variant: l.variant, qty: l.qty, optText: l.optText, note: l.note }));
  if ((o.discounts || []).length) r.discounts = o.discounts.map(d => ({ label: d.label, amount: d.amount }));
  if (o.rating) r.rating = { stars: o.rating.stars, comment: o.rating.comment };
  r.readyBy = o.createdAt + (s.prepMinutes || 10) * 60000 + (o.type === 'pickup' && WHEN_AR[o.when] && o.when !== 'asap' ? (+o.when) * 60000 : 0);
  if (s.branches.length > 1) r.branchName = (s.branches.find(b => b.id === o.branch) || {}).name || '';
  return r;
}

async function adminList({ query }) {
  query = query || {};
  const rev = String((await kv.get('orders:rev').catch(() => 0)) || 0);
  const meta = { rev, durable: kv.durable, storage: kv.kind, online: C.onlineReady(), now: Date.now() };
  if (query.rev && query.rev === rev) return ok(Object.assign({ same: true }, meta));
  const hours = Math.min(Math.max(Number(query.hours) || 24, 1), 24 * 30);
  let list = await listOrders(Date.now() - hours * 3600e3);
  if (query.branch) list = list.filter(o => o.branch === query.branch);
  list.sort((a, b) => b.createdAt - a.createdAt);
  const s = await S.load();
  return ok(Object.assign({ orders: list.map(o => boardRow(o, s)) }, meta));
}

const PUSH_MSG = {
  preparing: o => ({ title: 'نجهّز طلبك الحين ☕', body: `طلبك #${o.number} قيد التحضير.` }),
  ready: o => ({ title: o.type === 'delivery' ? 'طلبك طلع لك 🚗' : 'طلبك جاهز ✨', body: o.type === 'dinein' ? `طلب #${o.number} بيوصلك على طاولة ${o.table}.` : o.type === 'delivery' ? `طلب #${o.number} في الطريق.` : `طلب #${o.number} جاهز للاستلام من الكاشير.` }),
  done: o => ({ title: 'بالعافية 🤎', body: `شكرًا لاختيارك آن. قيّم طلب #${o.number}.` }),
  cancelled: o => ({ title: 'انلغى طلبك', body: `طلب #${o.number} انلغى. تواصل معنا إذا عندك سؤال.` })
};

async function adminUpdate({ body }) {
  body = body || {};
  const s = await S.load();
  const res = await withLock('order:' + body.id, async () => {
    const o = await getRaw(body.id);
    if (!o) return null;
    const before = o.status;
    if (body.status) {
      if (!STATUSES.includes(body.status)) return { error: true };
      o.status = body.status;
      o.history.push({ status: o.status, at: Date.now() });
    }
    if (typeof body.paid === 'boolean') o.paid = body.paid;
    // side effects, each applied once
    if (o.status === 'done' && !o.stamped && o.accountId && s.loyalty.enabled) {
      const n = o.lines.filter(l => l.drink).reduce((k, l) => k + l.qty, 0) - (o.discounts || []).filter(d => d.type === 'reward').length;
      if (n > 0) { const r = await accounts.addStamps(o.accountId, n, s.loyalty).catch(() => null); o.stamped = n; if (r && r.won) o.rewardWon = r.won; }
      else o.stamped = -1;
    }
    if (o.status === 'cancelled') {
      if (o.pay === 'wallet' && o.paid && !o.refunded && o.accountId) { await accounts.credit(o.accountId, o.total, 'refund', o.id, `استرجاع طلب #${o.number}`); o.refunded = true; o.paid = false; }
      if ((o.discounts || []).some(d => d.type === 'reward') && !o.rewardRestored && o.accountId) { await accounts.restoreReward(o.accountId); o.rewardRestored = true; }
    }
    await save(o);
    return { o, changed: before !== o.status };
  });
  if (!res) return fail(404, 'not_found', 'ما لقينا الطلب.');
  if (res.error) return fail(400, 'status', 'حالة غير معروفة.');
  const o = res.o;
  if (res.changed && PUSH_MSG[o.status]) {
    const m = PUSH_MSG[o.status](o);
    let hashes = o.push || [];
    if (o.accountId) { const a = await accounts.get(o.accountId); hashes = hashes.concat((a && a.push) || []); }
    await push.notify(hashes, Object.assign(m, { url: `/order?o=${o.id}`, tag: 'order-' + o.id })).catch(() => 0);
  }
  return ok({ order: view(o, s) });
}

async function adminSettings({ method, body }) {
  const s = await S.load();
  if (method === 'GET') return ok({ settings: s, menu: M.menu.items, durable: kv.durable, storage: kv.kind, online: C.onlineReady(), sms: require('./sms').configured() });
  body = body || {};
  const num = (v, lo, hi, d) => { const n = Number(U.toLatin(v)); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };
  if (typeof body.open === 'boolean') s.open = body.open;
  if (body.whatsapp !== undefined) s.whatsapp = U.clean(body.whatsapp, 20);
  if (body.deliveryFee !== undefined) s.deliveryFee = num(body.deliveryFee, 0, 200, 0);
  if (body.types && typeof body.types === 'object') for (const t of S.TYPES) if (typeof body.types[t] === 'boolean') s.types[t] = body.types[t];
  if (typeof body.payAtCounter === 'boolean') s.payAtCounter = body.payAtCounter;
  if (typeof body.payOnline === 'boolean') s.payOnline = body.payOnline;
  if (Array.isArray(body.soldOut)) s.soldOut = body.soldOut.filter(id => M.ITEMS.has(id));
  if (body.tables !== undefined) s.tables = Math.floor(num(body.tables, 1, 300, 12));
  if (body.prepMinutes !== undefined) s.prepMinutes = Math.floor(num(body.prepMinutes, 1, 120, 10));
  if (body.walletBonus !== undefined) s.walletBonus = num(body.walletBonus, 0, 50, 0);
  if (body.hours && typeof body.hours === 'object') {
    const t = v => /^\d{1,2}:\d{2}$/.test(String(v)) ? String(v).padStart(5, '0') : null;
    s.hours = { enabled: !!body.hours.enabled, open: t(body.hours.open) || s.hours.open, close: t(body.hours.close) || s.hours.close };
  }
  if (body.loyalty && typeof body.loyalty === 'object') {
    s.loyalty = { enabled: body.loyalty.enabled !== false, stamps: Math.floor(num(body.loyalty.stamps, 2, 30, 8)), cap: num(body.loyalty.cap, 0, 200, 25) };
  }
  if (body.invoice && typeof body.invoice === 'object') {
    const vat = U.toLatin(body.invoice.vatNumber || '').replace(/\D/g, '');
    if (vat && !/^3\d{13}3$/.test(vat)) return fail(400, 'vat', 'الرقم الضريبي لازم ١٥ رقم، يبدأ وينتهي بـ 3.');
    s.invoice = { vatNumber: vat, legalName: U.clean(body.invoice.legalName, 80) || 'آن coffee', crNumber: U.toLatin(body.invoice.crNumber || '').replace(/\D/g, '').slice(0, 15), address: U.clean(body.invoice.address, 120) };
  }
  if (Array.isArray(body.branches)) {
    const seen = new Set();
    const list = body.branches.slice(0, 20).map((b, i) => {
      let id = String(b.id || '').replace(/[^a-z0-9-]/gi, '').slice(0, 20) || ('b' + (i + 1));
      while (seen.has(id)) id += 'x'; seen.add(id);
      return { id, name: U.clean(b.name, 60) || `فرع ${i + 1}`, active: b.active !== false };
    });
    if (list.length) s.branches = list;
  }
  if (Array.isArray(body.topupAmounts)) s.topupAmounts = body.topupAmounts.map(Number).filter(n => n >= 10 && n <= 2000).slice(0, 6);
  if (Array.isArray(body.giftAmounts)) s.giftAmounts = body.giftAmounts.map(Number).filter(n => n >= 10 && n <= 2000).slice(0, 6);
  await S.save(s);
  return ok({ settings: s });
}

async function stats({ query }) {
  const days = [1, 7, 30].includes(Number(query && query.days)) ? Number(query.days) : 1;
  const since = U.riyadhDayStart(Date.now()) - (days - 1) * 86400e3;
  const all = await listOrders(since);
  const list = all.filter(o => !['cancelled', 'awaiting_payment'].includes(o.status));
  const revenue = U.money(list.reduce((n, o) => n + o.total, 0));
  const byType = { pickup: 0, dinein: 0, delivery: 0 }, byPay = {};
  const items = {}, hours = Array(24).fill(0);
  const accountsSeen = {};
  let ratingSum = 0, ratingN = 0; const comments = [];
  for (const o of list) {
    byType[o.type] = (byType[o.type] || 0) + 1;
    byPay[o.pay] = (byPay[o.pay] || 0) + 1;
    hours[U.riyadh(o.createdAt).hh]++;
    for (const l of o.lines) {
      const k = l.name + (l.variant ? ` (${l.variant})` : '');
      items[k] = items[k] || { name: k, qty: 0, revenue: 0 };
      items[k].qty += l.qty; items[k].revenue = U.money(items[k].revenue + l.total);
    }
    if (o.accountId) accountsSeen[o.accountId] = (accountsSeen[o.accountId] || 0) + 1;
    if (o.rating) { ratingSum += o.rating.stars; ratingN++; if (o.rating.comment) comments.push({ number: o.number, stars: o.rating.stars, comment: o.rating.comment, at: o.rating.at }); }
  }
  const top = Object.values(items).sort((a, b) => b.qty - a.qty).slice(0, 8);
  return ok({
    days, orders: list.length, cancelled: all.filter(o => o.status === 'cancelled').length,
    revenue, avg: list.length ? U.money(revenue / list.length) : 0,
    byType, byPay, top, hours,
    customers: Object.keys(accountsSeen).length, returning: Object.values(accountsSeen).filter(n => n > 1).length,
    rating: ratingN ? U.money(ratingSum / ratingN) : null, ratingCount: ratingN,
    comments: comments.sort((a, b) => b.at - a.at).slice(0, 6)
  });
}

async function customerSummary(a) {
  if (!a) return null;
  const orders = (await kv.mget((a.orders || []).slice(0, 12).map(oKey))).filter(Boolean).map(summary);
  return Object.assign(accounts.view(a), { orders });
}

module.exports = { createOrder, getOrder, rateOrder, linkPush, confirmOrderPayment, adminList, adminUpdate, adminSettings, stats, summary, customerSummary, orderText, view, getRaw, STATUSES };
