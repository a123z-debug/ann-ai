// Dashboard authentication: ADMIN_PIN, or a temporary code stored only as a scrypt fingerprint.
// Locks a device for 15 minutes after 8 wrong attempts.
const crypto = require('crypto');
const { kv } = require('./store');
const U = require('./util');
const shop = require('../data/shop.json');

const MAX_TRIES = 8, LOCK_SEC = 15 * 60;

function pinMatches(headers) {
  const expected = String(process.env.ADMIN_PIN || '');
  const got = U.header(headers, 'x-admin-pin');
  if (!got || got.length > 200) return false;
  if (!expected) {
    const t = shop.tempAdmin;
    if (!t || !t.hash || !t.salt) return false;
    const want = Buffer.from(t.hash, 'base64');
    const have = crypto.scryptSync(got, t.salt, want.length, { N: t.N || 16384, r: t.r || 8, p: t.p || 1 });
    return crypto.timingSafeEqual(want, have);
  }
  const a = crypto.createHash('sha256').update(expected).digest(), b = crypto.createHash('sha256').update(got).digest();
  return crypto.timingSafeEqual(a, b);
}

// Returns null when allowed, or a failure response.
async function guard(headers) {
  const key = 'pin:' + U.clientIp(headers);
  const tries = Number(await kv.get('hit:' + key).catch(() => 0)) || 0;
  if (tries >= MAX_TRIES) return U.fail(429, 'locked', 'محاولات كثيرة. جرّب بعد ١٥ دقيقة.');
  if (pinMatches(headers)) return null;
  await kv.incr('hit:' + key, 1, LOCK_SEC).catch(() => 0);
  return U.fail(401, 'unauthorized', 'رمز الإدارة غير صحيح.');
}

module.exports = { guard };
