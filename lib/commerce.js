// Gift cards, wallet top-ups, promo codes, Moyasar payment checks and the ZATCA QR.
const { kv, withLock } = require('./store');
const U = require('./util');
const accounts = require('./accounts');

const MOYASAR_SK = () => process.env.MOYASAR_SECRET_KEY || '';
const onlineReady = () => Boolean(process.env.MOYASAR_PUBLISHABLE_KEY && process.env.MOYASAR_SECRET_KEY);

// Checks a Moyasar payment against what we expect, and makes sure it is used once.
async function checkPayment(paymentId, halalas, kind, ref) {
  if (!onlineReady()) return { error: 'not_configured', message: 'الدفع الإلكتروني غير مفعّل.' };
  if (!/^[A-Za-z0-9_-]{6,80}$/.test(String(paymentId || ''))) return { error: 'payment', message: 'رقم العملية غير صحيح.' };
  const r = await fetch(`https://api.moyasar.com/v1/payments/${encodeURIComponent(paymentId)}`, {
    headers: { Authorization: 'Basic ' + Buffer.from(MOYASAR_SK() + ':').toString('base64') }
  });
  const p = await r.json().catch(() => ({}));
  const m = p.metadata || {};
  const refOk = (m.kind === kind && m.ref === ref) || (kind === 'order' && (m.order_id === ref || m.order === ref));
  if (!(r.ok && p.status === 'paid' && p.currency === 'SAR' && Number(p.amount) === halalas && refOk)) {
    return { error: 'not_paid', message: p.status === 'failed' ? 'ما تمت عملية الدفع، جرّب مرة ثانية.' : 'ما تأكد الدفع.' };
  }
  if (!(await kv.setnx('paid:' + paymentId, ref, 400 * 86400))) {
    const used = await kv.get('paid:' + paymentId);
    if (used !== ref) return { error: 'reused', message: 'هذه العملية مستخدمة من قبل.' };
  }
  return { ok: true };
}

// ---------- gift cards ----------
const giftCode = () => 'ANN-' + U.randomCode(4) + '-' + U.randomCode(4);
const normCode = c => U.toLatin(c).toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^ANN/, '');
const giftKey = c => 'gift:' + normCode(c);

function giftView(g, withCode) {
  if (!g) return null;
  return {
    code: withCode ? g.code : undefined, amount: g.amount, status: g.status,
    from: g.from, to: g.to, message: g.message, createdAt: g.createdAt, redeemedAt: g.redeemedAt || null
  };
}

function giftInput(body, s) {
  const amount = Math.round(Number(U.toLatin(body.amount)));
  if (!(amount >= 10 && amount <= 2000)) return { error: 'amount', message: 'اختر مبلغ بين ١٠ و ٢٠٠٠ ريال.' };
  return {
    amount,
    from: U.clean(body.from, 40),
    to: U.clean(body.to, 40),
    message: U.clean(body.message, 160)
  };
}

async function createPendingGift(body, s) {
  if (!onlineReady()) return { error: 'not_configured', message: 'شراء بطاقات الهدايا أونلاين يتفعّل مع الدفع الإلكتروني. تقدر تشتريها من الكاشير.' };
  const g = giftInput(body || {}, s); if (g.error) return g;
  const ref = U.randomId(10);
  await kv.set('giftp:' + ref, Object.assign(g, { ref, createdAt: Date.now() }), 86400);
  return { ref, amount: g.amount };
}

async function activateGift(fields, source, extra) {
  let code;
  for (let i = 0; i < 6; i++) { code = giftCode(); if (await kv.setnx(giftKey(code), { status: 'reserving' }, 60)) break; }
  const g = Object.assign({ code, status: 'active', createdAt: Date.now(), source }, fields, extra || {});
  await kv.set(giftKey(code), g);
  await kv.zadd('gifts', g.createdAt, normCode(code));
  return g;
}

async function confirmGift(ref, paymentId) {
  const p = await kv.get('giftp:' + ref);
  if (!p) return { error: 'not_found', message: 'ما لقينا البطاقة.' };
  if (p.code) return { gift: await kv.get(giftKey(p.code)) };
  const chk = await checkPayment(paymentId, Math.round(p.amount * 100), 'gift', ref);
  if (chk.error) return chk;
  return withLock('giftp:' + ref, async () => {
    const again = await kv.get('giftp:' + ref);
    if (again.code) return { gift: await kv.get(giftKey(again.code)) };
    const g = await activateGift({ amount: p.amount, from: p.from, to: p.to, message: p.message }, 'online', { paymentId });
    again.code = g.code; await kv.set('giftp:' + ref, again, 400 * 86400);
    return { gift: g };
  });
}

async function getGift(code) { const g = await kv.get(giftKey(code)); return g && g.code ? g : null; }

async function redeemGift(code, accountId, ip) {
  if (await kv.incr('gift:rate:' + ip, 1, 900) > 20) return { error: 'rate', message: 'محاولات كثيرة. جرّب بعد ١٥ دقيقة.' };
  const key = giftKey(code);
  return withLock(key, async () => {
    const g = await kv.get(key);
    if (!g || !g.code) return { error: 'not_found', message: 'رمز البطاقة غير صحيح.' };
    if (g.status === 'redeemed') return { error: 'used', message: 'هذه البطاقة مستخدمة من قبل.' };
    if (g.status !== 'active') return { error: 'inactive', message: 'البطاقة غير مفعّلة.' };
    const a = await accounts.credit(accountId, g.amount, 'gift', g.code, g.from ? `هدية من ${g.from}` : 'بطاقة هدية');
    g.status = 'redeemed'; g.redeemedAt = Date.now(); g.redeemedBy = accountId;
    await kv.set(key, g);
    return { gift: g, account: a };
  });
}

async function listGifts(limit = 60) {
  const codes = (await kv.zrange('gifts', 0, '+inf')).slice(-limit).reverse();
  const vals = await kv.mget(codes.map(c => 'gift:' + c));
  return vals.filter(Boolean);
}

// ---------- wallet top-ups ----------
async function createTopup(accountId, amountRaw, s) {
  if (!onlineReady()) return { error: 'not_configured', message: 'شحن الرصيد أونلاين يتفعّل مع الدفع الإلكتروني. تقدر تشحن من الكاشير.' };
  const amount = Math.round(Number(U.toLatin(amountRaw)));
  if (!(amount >= 10 && amount <= 2000)) return { error: 'amount', message: 'اختر مبلغ بين ١٠ و ٢٠٠٠ ريال.' };
  const bonus = U.money(amount * (Math.max(0, Math.min(50, Number(s.walletBonus) || 0)) / 100));
  const ref = U.randomId(10);
  await kv.set('topup:' + ref, { ref, accountId, amount, bonus, status: 'pending', createdAt: Date.now() }, 86400 * 2);
  return { ref, amount, bonus };
}
async function confirmTopup(ref, paymentId) {
  const t = await kv.get('topup:' + ref);
  if (!t) return { error: 'not_found', message: 'ما لقينا عملية الشحن.' };
  if (t.status === 'done') return { topup: t, account: await accounts.get(t.accountId) };
  const chk = await checkPayment(paymentId, Math.round(t.amount * 100), 'topup', ref);
  if (chk.error) return chk;
  return withLock('topup:' + ref, async () => {
    const again = await kv.get('topup:' + ref);
    if (again.status === 'done') return { topup: again, account: await accounts.get(again.accountId) };
    let a = await accounts.credit(again.accountId, again.amount, 'topup', ref, 'شحن رصيد');
    if (again.bonus > 0) a = await accounts.credit(again.accountId, again.bonus, 'bonus', ref, 'مكافأة الشحن');
    again.status = 'done'; again.paymentId = paymentId; again.doneAt = Date.now();
    await kv.set('topup:' + ref, again, 400 * 86400);
    return { topup: again, account: a };
  });
}

// ---------- promo codes ----------
const promoKey = c => U.toLatin(c).toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 20);
async function promos() { return (await kv.get('promos')) || {}; }

function promoDiscount(p, subtotal) {
  if (!p || !p.active) return { error: 'promo', message: 'الكوبون غير صالح.' };
  if (p.expires && Date.now() > p.expires) return { error: 'promo', message: 'انتهت صلاحية الكوبون.' };
  if (p.maxUses && p.uses >= p.maxUses) return { error: 'promo', message: 'انتهى عدد استخدامات الكوبون.' };
  if (p.min && subtotal < p.min) return { error: 'promo', message: `الكوبون يشتغل على طلب من ${p.min} ريال وفوق.` };
  let d = p.type === 'percent' ? subtotal * Math.min(100, p.value) / 100 : Number(p.value);
  if (p.type === 'percent' && p.cap) d = Math.min(d, p.cap);
  d = U.money(Math.max(0, Math.min(d, subtotal)));
  return { discount: d, label: p.type === 'percent' ? `خصم ${p.value}%` : `خصم ${p.value} ر.س` };
}
async function checkPromo(code, subtotal) {
  const k = promoKey(code); if (!k) return { error: 'promo', message: 'اكتب الكوبون.' };
  const all = await promos();
  const r = promoDiscount(all[k], subtotal);
  return r.error ? r : Object.assign({ code: k }, r);
}
async function consumePromo(code) {
  const k = promoKey(code);
  return withLock('promos', async () => { const all = await promos(); if (all[k]) { all[k].uses = (all[k].uses || 0) + 1; await kv.set('promos', all); } });
}
async function savePromo(body) {
  const code = promoKey(body.code);
  if (code.length < 3) return { error: 'code', message: 'الكوبون لازم ٣ أحرف أو أكثر (إنجليزي أو أرقام).' };
  return withLock('promos', async () => {
    const all = await promos();
    if (body.delete) { delete all[code]; await kv.set('promos', all); return { promos: all }; }
    const type = body.type === 'amount' ? 'amount' : 'percent';
    const value = Number(U.toLatin(body.value));
    if (!(value > 0) || (type === 'percent' && value > 100)) return { error: 'value', message: 'قيمة الخصم غير صحيحة.' };
    const prev = all[code] || {};
    all[code] = {
      code, type, value,
      min: Math.max(0, Number(U.toLatin(body.min)) || 0),
      cap: type === 'percent' ? Math.max(0, Number(U.toLatin(body.cap)) || 0) : 0,
      maxUses: Math.max(0, Math.floor(Number(U.toLatin(body.maxUses)) || 0)),
      uses: prev.uses || 0,
      expires: body.expires ? Date.parse(body.expires) || 0 : 0,
      active: body.active !== false,
      createdAt: prev.createdAt || Date.now()
    };
    await kv.set('promos', all);
    return { promos: all };
  });
}

// ---------- ZATCA (phase 1) QR: TLV of seller, VAT number, time, total, VAT ----------
function zatcaQR({ seller, vat, time, total, vatAmount }) {
  const parts = [seller, vat, time, U.money(total).toFixed(2), U.money(vatAmount).toFixed(2)].map((v, i) => {
    const b = Buffer.from(String(v), 'utf8');
    return Buffer.concat([Buffer.from([i + 1, b.length]), b]);
  });
  return Buffer.concat(parts).toString('base64');
}

module.exports = { onlineReady, checkPayment, giftView, createPendingGift, confirmGift, activateGift, giftInput, getGift, redeemGift, listGifts, createTopup, confirmTopup, promos, checkPromo, consumePromo, savePromo, zatcaQR, normCode };
