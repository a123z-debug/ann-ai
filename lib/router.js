// One router for every /api/v1/* call, shared by server.js and the Vercel function api/gateway.js.
const U = require('./util');
const { kv } = require('./store');
const S = require('./settings');
const M = require('./menu');
const accounts = require('./accounts');
const C = require('./commerce');
const push = require('./push');
const O = require('./orders');
const { guard } = require('./admin');
const sms = require('./sms');
const { ok, fail } = U;

const needAccount = async headers => accounts.fromHeaders(headers);

// Per-IP limits on public writes and guessable lookups. Generous, because customers on the
// shop Wi-Fi or a mobile carrier can share one public IP.
const LIMITS = {
  'POST order': [40, 600], 'POST pay': [30, 600], 'POST order/rate': [30, 3600],
  'POST promo/check': [40, 900], 'GET gift': [40, 900], 'POST gift': [20, 3600],
  'POST account/topup': [20, 3600], 'POST push/subscribe': [20, 3600]
};
async function limited(headers, name, max, sec) {
  const n = await kv.incr(`rl:${name}:${U.clientIp(headers)}`, 1, sec).catch(() => 0);
  return n > max ? fail(429, 'rate', 'طلبات كثيرة، جرّب بعد شوي.') : null;
}

const routes = {
  // ----- public -----
  'GET settings': async () => ok(S.publicView(await S.load(), { smsLogin: sms.configured(), push: kv.durable })),
  'GET menu': async () => ok(M.menu),
  'POST order': O.createOrder,
  'GET order': O.getOrder,
  'POST order/rate': O.rateOrder,

  'POST pay': async ({ body }) => {
    body = body || {};
    if (body.kind === 'topup') { const r = await C.confirmTopup(body.ref, body.payment); return r.error ? fail(402, r.error, r.message) : ok({ account: accounts.view(r.account) }); }
    if (body.kind === 'gift') { const r = await C.confirmGift(body.ref, body.payment); return r.error ? fail(402, r.error, r.message) : ok({ gift: C.giftView(r.gift, true) }); }
    return O.confirmOrderPayment(body.order || body.ref, body.payment);
  },

  // ----- account -----
  'GET account': async ({ headers }) => {
    const a = await needAccount(headers);
    return ok({ account: a ? await O.customerSummary(a) : null });
  },
  'POST account': async ({ headers, body }) => {
    if (!(await accounts.fromHeaders(headers))) { const busy = await limited(headers, 'acct', 30, 3600); if (busy) return busy; }
    const { a, token } = await accounts.ensure(headers, body || {});
    return ok({ account: await O.customerSummary(await accounts.get(a.id)), token });
  },
  'POST account/topup': async ({ headers, body }) => {
    const a = await needAccount(headers);
    if (!a) return fail(401, 'account', 'افتح حسابك أول.');
    const r = await C.createTopup(a.id, body && body.amount, await S.load());
    return r.error ? fail(400, r.error, r.message) : ok(r);
  },
  'POST auth/send': async ({ headers, body }) => {
    const r = await accounts.sendOtp(body && body.phone, U.clientIp(headers));
    return r.error ? fail(400, r.error, r.message) : ok(r);
  },
  'POST auth/verify': async ({ headers, body }) => {
    const r = await accounts.verifyOtp(body && body.phone, body && body.code, headers);
    return r.error ? fail(400, r.error, r.message) : ok({ account: await O.customerSummary(r.a), token: r.token });
  },

  // ----- gifts & promos -----
  'GET gift': async ({ query }) => {
    const g = await C.getGift(query && query.code);
    return g ? ok({ gift: C.giftView(g) }) : fail(404, 'not_found', 'رمز البطاقة غير صحيح.');
  },
  'POST gift': async ({ body }) => {
    const r = await C.createPendingGift(body || {}, await S.load());
    return r.error ? fail(400, r.error, r.message) : ok(r);
  },
  'POST gift/redeem': async ({ headers, body }) => {
    const { a, token } = await accounts.ensure(headers, null);
    const r = await C.redeemGift(body && body.code, a.id, U.clientIp(headers));
    return r.error ? fail(400, r.error, r.message, { token }) : ok({ gift: C.giftView(r.gift), account: accounts.view(r.account), token });
  },
  'POST promo/check': async ({ body }) => {
    const r = await C.checkPromo(body && body.code, Number(body && body.subtotal) || 0);
    return r.error ? fail(400, r.error, r.message) : ok(r);
  },

  // ----- push -----
  'GET push/key': async () => kv.durable ? ok({ key: (await push.keys()).pub }) : fail(503, 'push_off', 'الإشعارات تتفعّل بعد ربط قاعدة البيانات.'),
  'POST push/subscribe': async ({ headers, body }) => {
    body = body || {};
    if (!kv.durable) return fail(503, 'push_off', 'الإشعارات تتفعّل بعد ربط قاعدة البيانات.');
    const h = await push.subscribe(body.sub);
    if (!h) return fail(400, 'sub', 'اشتراك غير صالح.');
    if (body.order) await O.linkPush(body.order, h);
    const a = await accounts.fromHeaders(headers); if (a) await accounts.addPush(a.id, h);
    if (body.admin) { const denied = await guard(headers); if (denied) return denied; await push.addAdmin(h); }
    return ok({ ok: true });
  },
  'POST push/inbox': async ({ body }) => ok({ msg: await push.inbox(body && body.endpoint) }),

  // ----- dashboard (PIN) -----
  'GET admin/orders': O.adminList,
  'PATCH admin/orders': O.adminUpdate,
  'GET admin/settings': O.adminSettings,
  'PUT admin/settings': O.adminSettings,
  'GET admin/stats': O.stats,
  'GET admin/customer': async ({ query }) => {
    const a = await accounts.findForAdmin(query && query.q);
    return a ? ok({ customer: await O.customerSummary(a) }) : fail(404, 'not_found', 'ما لقينا عميل بهذا الرمز أو الجوال.');
  },
  'POST admin/topup': async ({ body }) => {
    body = body || {};
    const a = await accounts.findForAdmin(body.q);
    if (!a) return fail(404, 'not_found', 'ما لقينا العميل.');
    const amount = Math.round(Number(U.toLatin(body.amount)) * 100) / 100;
    if (!(amount > 0 && amount <= 2000)) return fail(400, 'amount', 'اكتب مبلغ بين ١ و ٢٠٠٠.');
    const s = await S.load();
    let acc = await accounts.credit(a.id, amount, 'cashier', 'cashier', U.clean(body.note, 60) || 'شحن من الكاشير');
    const bonus = U.money(amount * (Number(s.walletBonus) || 0) / 100);
    if (bonus > 0) acc = await accounts.credit(a.id, bonus, 'bonus', 'cashier', 'مكافأة الشحن');
    return ok({ customer: await O.customerSummary(acc) });
  },
  // stamps for counter purchases, and using a free drink at the counter
  'POST admin/stamps': async ({ body }) => {
    body = body || {};
    const a = await accounts.findForAdmin(body.q);
    if (!a) return fail(404, 'not_found', 'ما لقينا العميل.');
    const s = await S.load();
    if (!s.loyalty.enabled) return fail(400, 'loyalty', 'نظام الأختام موقوف من الإعدادات.');
    if (body.redeem) {
      if (!(await accounts.useReward(a.id))) return fail(400, 'reward', 'ما عنده مشروب مجاني متاح.');
      return ok({ customer: await O.customerSummary(await accounts.get(a.id)), redeemed: true });
    }
    const n = Math.floor(Number(U.toLatin(body.n)));
    if (!(n >= 1 && n <= 20)) return fail(400, 'n', 'اكتب عدد الأختام من ١ إلى ٢٠.');
    const r = await accounts.addStamps(a.id, n, s.loyalty);
    return ok({ customer: await O.customerSummary(r.a), won: r.won });
  },
  'POST admin/gift': async ({ body }) => {
    const g0 = C.giftInput(body || {}); if (g0.error) return fail(400, g0.error, g0.message);
    const g = await C.activateGift(g0, 'cashier', { note: U.clean(body.note, 60) });
    return ok({ gift: C.giftView(g, true) });
  },
  'GET admin/gifts': async () => ok({ gifts: (await C.listGifts()).map(g => C.giftView(g, true)) }),
  'GET admin/promos': async () => ok({ promos: await C.promos() }),
  'PUT admin/promos': async ({ body }) => { const r = await C.savePromo(body || {}); return r.error ? fail(400, r.error, r.message) : ok(r); }
};

// path like "order/rate" (without /api/v1/)
async function handle(method, path, { query, body, headers }) {
  const p = String(path || '').replace(/^\/+|\/+$/g, '');
  const key = method + ' ' + p;
  const fn = Object.prototype.hasOwnProperty.call(routes, key) ? routes[key] : null;
  if (!fn) return fail(404, 'not_found', 'المسار غير موجود.');
  if (p.startsWith('admin/')) { const denied = await guard(headers); if (denied) return denied; }
  try {
    if (LIMITS[key]) { const busy = await limited(headers, key.replace(/\W/g, '_'), LIMITS[key][0], LIMITS[key][1]); if (busy) return busy; }
    return await fn({ method, query: query || {}, body: body || {}, headers: headers || {} });
  } catch (e) {
    if (String(e && e.message) === 'busy') return fail(503, 'busy', 'ضغط على الخادم، جرّب بعد ثواني.');
    console.error('api error', p, e);
    return fail(500, 'server_error', 'صار خطأ في الخادم، جرّب بعد شوي.');
  }
}

module.exports = { handle, routes };
