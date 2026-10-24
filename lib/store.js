// Order storage for آن coffee.
// Uses Upstash Redis (or Vercel KV, same REST API) when its env vars are set;
// otherwise a JSON file: durable on Railway/local, temporary on Vercel (/tmp).

const fs = require('fs');
const path = require('path');

const REST_URL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || '';
const REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || '';
const useRedis = Boolean(REST_URL && REST_TOKEN);
const onVercel = Boolean(process.env.VERCEL);
const FILE = process.env.ORDERS_FILE || (onVercel ? '/tmp/ann-orders.json' : path.join(__dirname, '..', 'data', 'orders.local.json'));
const P = 'ann:';

async function redis(...cmd) {
  const r = await fetch(REST_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${REST_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd)
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error('redis_error: ' + (j.error || r.status));
  return j.result;
}

// ---- file store ----
function readFile() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); }
  catch { return { seq: 1000, orders: {}, settings: null }; }
}
function writeFile(db) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, FILE);
}

const store = {
  kind: useRedis ? 'redis' : 'file',
  durable: useRedis || !onVercel,

  async nextNumber() {
    if (useRedis) return 1000 + Number(await redis('INCR', P + 'seq'));
    // Temporary storage on Vercel is per instance, so a counter could repeat: use the clock instead.
    if (onVercel) return 1000 + (Math.floor(Date.now() / 1000) % 9000);
    const db = readFile(); db.seq = (db.seq || 1000) + 1; writeFile(db); return db.seq;
  },

  async saveOrder(o) {
    if (useRedis) {
      await redis('SET', P + 'order:' + o.id, JSON.stringify(o), 'EX', 60 * 60 * 24 * 90);
      await redis('ZADD', P + 'orders', String(o.createdAt), o.id);
      return;
    }
    const db = readFile(); db.orders[o.id] = o;
    const ids = Object.keys(db.orders);
    if (ids.length > 2000) ids.sort((a, b) => db.orders[a].createdAt - db.orders[b].createdAt).slice(0, ids.length - 2000).forEach(k => delete db.orders[k]);
    writeFile(db);
  },

  async getOrder(id) {
    if (!/^[A-Za-z0-9_-]{8,40}$/.test(String(id || ''))) return null;
    if (useRedis) { const v = await redis('GET', P + 'order:' + id); return v ? JSON.parse(v) : null; }
    return readFile().orders[id] || null;
  },

  async listOrders(sinceMs) {
    if (useRedis) {
      const ids = await redis('ZRANGEBYSCORE', P + 'orders', String(sinceMs), '+inf');
      if (!ids || !ids.length) return [];
      const vals = await redis('MGET', ...ids.map(i => P + 'order:' + i));
      return vals.filter(Boolean).map(v => JSON.parse(v));
    }
    return Object.values(readFile().orders).filter(o => o.createdAt >= sinceMs);
  },

  async getSettings() {
    if (useRedis) { const v = await redis('GET', P + 'settings'); return v ? JSON.parse(v) : null; }
    return readFile().settings || null;
  },

  async saveSettings(s) {
    if (useRedis) { await redis('SET', P + 'settings', JSON.stringify(s)); return; }
    const db = readFile(); db.settings = s; writeFile(db);
  }
};

module.exports = store;
