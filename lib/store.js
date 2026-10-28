// Key-value storage for آن coffee.
// Upstash Redis (or Vercel KV, same REST API) when configured; otherwise a JSON file
// (durable on Railway/local, temporary on Vercel where /tmp is per instance).

const fs = require('fs');
const path = require('path');

const REST_URL = (process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || '').replace(/\/$/, '');
const REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || '';
const useRedis = Boolean(REST_URL && REST_TOKEN);
const onVercel = Boolean(process.env.VERCEL);
const FILE = process.env.ORDERS_FILE || (onVercel ? '/tmp/ann-store.json' : path.join(__dirname, '..', 'data', 'store.local.json'));
const P = 'ann:';

async function redis(...cmd) {
  const r = await fetch(REST_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${REST_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd.map(String))
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error('redis_error: ' + (j.error || r.status));
  return j.result;
}

// ---- file backend ----
// The data lives in memory and is read from disk once per process. Writes made in the same tick
// are flushed together (atomic rename), and expired keys are dropped, so the file stays small and
// a request no longer re-parses the whole file for every read. One process per file.
let mem = null, pending = false, lastPurge = 0;
const alive = e => e && (!e.exp || e.exp > Date.now());
function load() {
  if (!mem) {
    try { mem = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { mem = {}; }
    mem.kv = mem.kv || {}; mem.z = mem.z || {};
  }
  return mem;
}
function flush() {
  pending = false;
  if (Date.now() - lastPurge > 60000) {
    lastPurge = Date.now();
    for (const k of Object.keys(mem.kv)) if (!alive(mem.kv[k])) delete mem.kv[k];
  }
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const tmp = FILE + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(mem));
  fs.renameSync(tmp, FILE);
}
function save() {
  if (pending) return;
  pending = true;
  setImmediate(() => { try { flush(); } catch (e) { pending = false; console.error('store write failed', e); } });
}
if (!useRedis) {
  process.once('beforeExit', () => { if (pending) flush(); });
  for (const sig of ['SIGTERM', 'SIGINT']) process.once(sig, () => { try { if (pending) flush(); } finally { process.exit(0); } });
}
const parse = v => { if (v == null) return null; try { return JSON.parse(v); } catch { return v; } };

const kv = {
  kind: useRedis ? 'redis' : 'file',
  durable: useRedis || !onVercel,

  async get(k) {
    if (useRedis) return parse(await redis('GET', P + k));
    const e = load().kv[k]; return alive(e) ? e.v : null;
  },
  async set(k, v, ttl) {
    if (useRedis) { ttl ? await redis('SET', P + k, JSON.stringify(v), 'EX', ttl) : await redis('SET', P + k, JSON.stringify(v)); return; }
    const db = load(); db.kv[k] = { v, exp: ttl ? Date.now() + ttl * 1000 : 0 }; save(db);
  },
  async del(k) {
    if (useRedis) { await redis('DEL', P + k); return; }
    const db = load(); delete db.kv[k]; save(db);
  },
  async setnx(k, v, ttl) {
    if (useRedis) return (await redis('SET', P + k, JSON.stringify(v), 'NX', 'EX', ttl || 30)) === 'OK';
    const db = load(); if (alive(db.kv[k])) return false;
    db.kv[k] = { v, exp: Date.now() + (ttl || 30) * 1000 }; save(db); return true;
  },
  async incr(k, by = 1, ttl) {
    if (useRedis) {
      const n = Number(await redis('INCRBY', P + k, by));
      if (ttl && n === by) await redis('EXPIRE', P + k, ttl);
      return n;
    }
    const db = load(); const e = db.kv[k];
    const n = (alive(e) ? Number(e.v) || 0 : 0) + by;
    db.kv[k] = { v: n, exp: alive(e) ? e.exp : (ttl ? Date.now() + ttl * 1000 : 0) }; save(db); return n;
  },
  async mget(keys) {
    if (!keys.length) return [];
    if (useRedis) return (await redis('MGET', ...keys.map(k => P + k))).map(parse);
    const db = load(); return keys.map(k => alive(db.kv[k]) ? db.kv[k].v : null);
  },
  async zadd(set, score, member) {
    if (useRedis) { await redis('ZADD', P + set, score, member); return; }
    const db = load(); (db.z[set] = db.z[set] || {})[member] = score; save(db);
  },
  async zrem(set, member) {
    if (useRedis) { await redis('ZREM', P + set, member); return; }
    const db = load(); if (db.z[set]) { delete db.z[set][member]; save(db); }
  },
  async zrange(set, min, max) {
    if (useRedis) return await redis('ZRANGEBYSCORE', P + set, min, max);
    const z = load().z[set] || {};
    const num = v => v === '+inf' ? Infinity : v === '-inf' ? -Infinity : Number(v);
    const lo = num(min), hi = num(max);
    return Object.keys(z).filter(m => z[m] >= lo && z[m] <= hi).sort((a, b) => z[a] - z[b]);
  }
};

const sleep = ms => new Promise(r => setTimeout(r, ms));
// Serialises updates to one record (balances, stamps) across concurrent requests.
async function withLock(name, fn) {
  const key = 'lock:' + name;
  for (let i = 0; i < 40; i++) {
    if (await kv.setnx(key, 1, 8)) {
      try { return await fn(); } finally { await kv.del(key).catch(() => {}); }
    }
    await sleep(60 + Math.random() * 60);
  }
  throw new Error('busy');
}

module.exports = { kv, withLock };
