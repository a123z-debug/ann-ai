// Customer accounts: device token by default, phone login by SMS code when a provider is set up.
// Holds wallet balance (with a ledger), loyalty stamps/rewards and order history.

const crypto = require('crypto');
const { kv, withLock } = require('./store');
const U = require('./util');
const sms = require('./sms');

const TOK = t => 'acct:tok:' + U.sha256(t);
const ACC = id => 'acct:' + id;
const TOKEN_TTL = 400 * 86400;

async function get(id) { return id ? kv.get(ACC(id)) : null; }
async function put(a) { a.updatedAt = Date.now(); await kv.set(ACC(a.id), a); return a; }

async function fromHeaders(headers) {
  const t = U.header(headers, 'x-ann-token');
  if (!t || t.length < 20 || t.length > 80) return null;
  const id = await kv.get(TOK(t));
  const a = id ? await get(id) : null;
  return a && a.mergedInto ? get(a.mergedInto) : a;
}
async function issueToken(id) { const t = U.randomId(24); await kv.set(TOK(t), id, TOKEN_TTL); return t; }

function applyProfile(a, p) {
  if (!p) return;
  const name = U.clean(p.name, 40);
  if (name.length >= 2) a.name = name;
  const phone = p.phone ? U.normalizePhone(p.phone) : null;
  if (phone && !a.phoneVerified) a.phone = phone;
}

async function create(profile) {
  let code = '';
  for (let i = 0; i < 8; i++) { const c = U.randomCode(6); if (await kv.setnx('acct:code:' + c, 'pending', 60)) { code = c; break; } }
  const a = { id: U.randomId(12), code, name: '', phone: '', phoneVerified: false, balance: 0, stamps: 0, rewards: 0, totalStamps: 0, ledger: [], orders: [], push: [], createdAt: Date.now() };
  applyProfile(a, profile);
  await kv.set('acct:code:' + code, a.id);
  await put(a);
  return { a, token: await issueToken(a.id) };
}

// Returns { a, token } where token is set only when a new account was created.
async function ensure(headers, profile) {
  const a = await fromHeaders(headers);
  if (a) {
    if (profile) await withLock('acct:' + a.id, async () => { const fresh = await get(a.id); applyProfile(fresh, profile); await put(fresh); Object.assign(a, fresh); });
    return { a, token: null };
  }
  return create(profile);
}

function view(a, orders) {
  if (!a) return null;
  return {
    code: a.code, name: a.name, phone: a.phone, phoneVerified: !!a.phoneVerified,
    balance: U.money(a.balance), stamps: a.stamps, rewards: a.rewards, totalStamps: a.totalStamps,
    ledger: (a.ledger || []).slice(0, 30), createdAt: a.createdAt,
    orders: orders || undefined
  };
}

function ledger(a, e) { a.ledger = [Object.assign({ at: Date.now() }, e)].concat(a.ledger || []).slice(0, 80); }

async function credit(id, amount, type, ref, note) {
  amount = U.money(amount);
  if (!(amount > 0)) throw new Error('bad_amount');
  return withLock('acct:' + id, async () => {
    const a = await get(id); if (!a) throw new Error('no_account');
    a.balance = U.money((a.balance || 0) + amount);
    ledger(a, { type, amount, ref, note, balance: a.balance });
    return put(a);
  });
}
// Returns the updated account, or null when the balance is not enough.
async function debit(id, amount, type, ref, note) {
  amount = U.money(amount);
  return withLock('acct:' + id, async () => {
    const a = await get(id); if (!a) return null;
    if ((a.balance || 0) + 1e-9 < amount) return null;
    a.balance = U.money(a.balance - amount);
    ledger(a, { type, amount: -amount, ref, note, balance: a.balance });
    return put(a);
  });
}

async function addStamps(id, n, loyalty) {
  if (!id || !(n > 0) || !loyalty || !loyalty.enabled) return null;
  const per = Math.max(2, Number(loyalty.stamps) || 8);
  return withLock('acct:' + id, async () => {
    const a = await get(id); if (!a) return null;
    a.stamps = (a.stamps || 0) + n; a.totalStamps = (a.totalStamps || 0) + n;
    let won = 0;
    while (a.stamps >= per) { a.stamps -= per; a.rewards = (a.rewards || 0) + 1; won++; }
    await put(a);
    return { a, won };
  });
}
async function useReward(id) {
  return withLock('acct:' + id, async () => {
    const a = await get(id); if (!a || !(a.rewards > 0)) return false;
    a.rewards -= 1; await put(a); return true;
  });
}
async function restoreReward(id) {
  return withLock('acct:' + id, async () => { const a = await get(id); if (!a) return; a.rewards = (a.rewards || 0) + 1; await put(a); });
}
async function linkOrder(id, orderId) {
  return withLock('acct:' + id, async () => {
    const a = await get(id); if (!a) return;
    a.orders = [orderId].concat((a.orders || []).filter(x => x !== orderId)).slice(0, 60);
    await put(a);
  });
}
// After an order: link it to the account and keep the name/phone, in one locked update.
async function afterOrder(id, orderId, profile) {
  return withLock('acct:' + id, async () => {
    const a = await get(id); if (!a) return null;
    a.orders = [orderId].concat((a.orders || []).filter(x => x !== orderId)).slice(0, 60);
    applyProfile(a, profile);
    return put(a);
  });
}
async function addPush(id, h) {
  return withLock('acct:' + id, async () => {
    const a = await get(id); if (!a) return;
    a.push = [h].concat((a.push || []).filter(x => x !== h)).slice(0, 8);
    await put(a);
  });
}

// ---------- phone login ----------
async function sendOtp(phoneRaw, ip) {
  if (!sms.configured()) return { error: 'sms_off', message: 'تسجيل الدخول برقم الجوال يتفعّل قريبًا.' };
  const phone = U.normalizePhone(phoneRaw);
  if (!phone) return { error: 'phone', message: 'رقم الجوال غير صحيح، اكتبه مثل 05xxxxxxxx.' };
  if (await kv.incr('otp:rate:p:' + phone, 1, 900) > 3) return { error: 'rate', message: 'أرسلنا رموز كثيرة. جرّب بعد ١٥ دقيقة.' };
  if (await kv.incr('otp:rate:ip:' + ip, 1, 900) > 10) return { error: 'rate', message: 'محاولات كثيرة. جرّب بعد ١٥ دقيقة.' };
  const code = String(crypto.randomInt(100000, 1000000));
  await kv.set('otp:' + phone, { h: U.sha256(code + ':' + phone), tries: 0 }, 300);
  try { await sms.send(U.intlPhone(phone), `رمز الدخول لآن coffee: ${code}\nلا تشاركه مع أحد.`); }
  catch { return { error: 'sms_failed', message: 'ما قدرنا نرسل الرسالة، جرّب بعد شوي.' }; }
  return { ok: true, phone };
}

async function merge(target, from) {
  return withLock('acct:' + target.id, async () => {
    const t = await get(target.id);
    t.balance = U.money((t.balance || 0) + (from.balance || 0));
    t.stamps = (t.stamps || 0) + (from.stamps || 0);
    t.rewards = (t.rewards || 0) + (from.rewards || 0);
    t.totalStamps = (t.totalStamps || 0) + (from.totalStamps || 0);
    t.orders = [...new Set([].concat(from.orders || [], t.orders || []))].slice(0, 60);
    t.ledger = [].concat(from.ledger || [], t.ledger || []).sort((x, y) => y.at - x.at).slice(0, 80);
    if (!t.name && from.name) t.name = from.name;
    await put(t);
    await kv.set(ACC(from.id), { id: from.id, mergedInto: t.id, code: from.code });
    await kv.set('acct:code:' + from.code, t.id);
    return t;
  });
}

async function verifyOtp(phoneRaw, codeRaw, headers) {
  const phone = U.normalizePhone(phoneRaw);
  const code = U.toLatin(codeRaw).replace(/\D/g, '');
  if (!phone || code.length !== 6) return { error: 'code', message: 'اكتب الرمز المكوّن من ٦ أرقام.' };
  const rec = await kv.get('otp:' + phone);
  if (!rec) return { error: 'expired', message: 'انتهت صلاحية الرمز، اطلب رمز جديد.' };
  if (rec.tries >= 5) return { error: 'locked', message: 'محاولات كثيرة، اطلب رمز جديد.' };
  if (U.sha256(code + ':' + phone) !== rec.h) {
    rec.tries += 1; await kv.set('otp:' + phone, rec, 300);
    return { error: 'code', message: 'الرمز غير صحيح.' };
  }
  await kv.del('otp:' + phone);
  const current = await fromHeaders(headers);
  const existingId = await kv.get('acct:phone:' + phone);
  if (existingId && (!current || current.id !== existingId)) {
    let target = await get(existingId);
    if (current && !current.mergedInto) target = await merge(target, current);
    return { a: target, token: await issueToken(target.id) };
  }
  if (current) {
    const a = await withLock('acct:' + current.id, async () => { const f = await get(current.id); f.phone = phone; f.phoneVerified = true; return put(f); });
    await kv.set('acct:phone:' + phone, a.id);
    return { a, token: null };
  }
  const { a, token } = await create({});
  a.phone = phone; a.phoneVerified = true; await put(a);
  await kv.set('acct:phone:' + phone, a.id);
  return { a, token };
}

async function findForAdmin(q) {
  const s = U.toLatin(q).trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  let id = null;
  if (/^[A-Z0-9]{6}$/.test(s)) id = await kv.get('acct:code:' + s);
  if (!id) { const p = U.normalizePhone(q); if (p) id = await kv.get('acct:phone:' + p); }
  let a = await get(id);
  if (a && a.mergedInto) a = await get(a.mergedInto);
  return a;
}

module.exports = { get, put, fromHeaders, ensure, create, view, credit, debit, addStamps, useReward, restoreReward, linkOrder, afterOrder, addPush, sendOtp, verifyOtp, findForAdmin, issueToken };
