// Web Push for order updates, without third-party packages.
// Pushes carry no payload: the service worker asks /api/v1/push/inbox for the message,
// so only VAPID signing is needed (no payload encryption).

const crypto = require('crypto');
const { kv } = require('./store');
const { sha256 } = require('./util');

const SUBJECT = process.env.SITE_URL || 'https://ann-ai-lac.vercel.app';
const b64u = b => Buffer.from(b).toString('base64url');

async function keys() {
  let k = await kv.get('vapid');
  if (k && k.pub && k.jwk) return k;
  const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = privateKey.export({ format: 'jwk' });
  const pub = b64u(Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]));
  k = { pub, jwk };
  if (!(await kv.setnx('vapid', k, 10 * 365 * 86400))) k = await kv.get('vapid');
  return k;
}

function vapidJwt(aud, jwk) {
  const head = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const body = b64u(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: SUBJECT }));
  const key = crypto.createPrivateKey({ key: jwk, format: 'jwk' });
  const sig = crypto.sign('sha256', Buffer.from(head + '.' + body), { key, dsaEncoding: 'ieee-p1363' });
  return head + '.' + body + '.' + b64u(sig);
}

const hashOf = endpoint => sha256(endpoint).slice(0, 32);

// Only real browser push services: the server POSTs to this URL later, so anything else
// would let a visitor make the server call an address of their choosing.
const PUSH_HOSTS = ['fcm.googleapis.com', 'android.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com'];
const PUSH_SUFFIXES = ['.push.apple.com', '.notify.windows.com', '.push.services.mozilla.com'];
function pushHostAllowed(u) {
  const h = u.hostname.toLowerCase();
  return u.protocol === 'https:' && !u.username && !u.password && (!u.port || u.port === '443') &&
    (PUSH_HOSTS.includes(h) || PUSH_SUFFIXES.some(sfx => h.endsWith(sfx)));
}

async function subscribe(sub) {
  const endpoint = sub && String(sub.endpoint || '');
  let u; try { u = new URL(endpoint); } catch { return null; }
  if (!pushHostAllowed(u) || endpoint.length > 1000) return null;
  const h = hashOf(endpoint);
  await kv.set('push:sub:' + h, { endpoint }, 180 * 86400);
  return h;
}

async function sendOne(h, k) {
  const sub = await kv.get('push:sub:' + h);
  if (!sub) return false;
  const url = new URL(sub.endpoint);
  if (!pushHostAllowed(url)) { await kv.del('push:sub:' + h); return false; }
  const aud = url.origin;
  const r = await fetch(sub.endpoint, {
    method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(5000),
    headers: { TTL: '86400', Urgency: 'high', Authorization: `vapid t=${vapidJwt(aud, k.jwk)}, k=${k.pub}`, 'Content-Length': '0' }
  }).catch(() => null);
  if (r && (r.status === 404 || r.status === 410)) { await kv.del('push:sub:' + h); return false; }
  return Boolean(r && r.ok);
}

// msg: { title, body, url, tag }
async function notify(hashes, msg) {
  const list = [...new Set((hashes || []).filter(Boolean))];
  if (!list.length || !kv.durable) return 0;
  const k = await keys();
  let sent = 0;
  await Promise.all(list.map(async h => {
    await kv.set('push:inbox:' + h, Object.assign({ at: Date.now() }, msg), 86400);
    if (await sendOne(h, k).catch(() => false)) sent++;
  }));
  return sent;
}

async function inbox(endpoint) {
  if (!endpoint) return null;
  return kv.get('push:inbox:' + hashOf(String(endpoint)));
}

async function adminHashes() { return kv.zrange('push:admins', 0, '+inf'); }
async function addAdmin(h) { await kv.zadd('push:admins', Date.now(), h); }

module.exports = { keys, subscribe, notify, inbox, adminHashes, addAdmin, hashOf, pushHostAllowed };
