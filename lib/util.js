// Small shared helpers for the آن coffee server.
const crypto = require('crypto');

const ok = body => ({ status: 200, body });
const fail = (status, error, message, extra) => ({ status, body: Object.assign({ error, message }, extra || {}) });

const clean = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const toLatin = s => String(s == null ? '' : s).replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d));
const money = n => Math.round(Number(n || 0) * 100) / 100;
const fmt = n => money(n).toString();
const sha256 = s => crypto.createHash('sha256').update(String(s)).digest('hex');

function normalizePhone(v) {
  const d = toLatin(v).replace(/[^\d+]/g, '');
  const m = d.match(/^(?:\+?966|00966|0)?(5\d{8})$/);
  return m ? '0' + m[1] : null;
}
function intlPhone(local) { return local ? '966' + String(local).slice(1) : ''; }
function waNumber(v) {
  const d = toLatin(v).replace(/\D/g, '');
  if (/^05\d{8}$/.test(d)) return '966' + d.slice(1);
  if (/^5\d{8}$/.test(d)) return '966' + d;
  if (/^9665\d{8}$/.test(d)) return d;
  if (/^009665\d{8}$/.test(d)) return d.slice(2);
  return d.length >= 8 ? d : '';
}

const ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function randomCode(len) { return Array.from(crypto.randomBytes(len), b => ALPHA[b % ALPHA.length]).join(''); }
const randomId = (bytes = 12) => crypto.randomBytes(bytes).toString('base64url');

function clientIp(headers) {
  const h = headers || {};
  return String(h['x-real-ip'] || String(h['x-forwarded-for'] || '').split(',')[0] || 'local').trim().slice(0, 64);
}
function header(headers, name) {
  if (!headers) return '';
  return String(headers[name] || headers[name.toLowerCase()] || '');
}

// Riyadh is UTC+3 all year.
function riyadh(ms) {
  const d = new Date((ms || Date.now()) + 3 * 3600e3);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), hh: d.getUTCHours(), mm: d.getUTCMinutes(), dow: d.getUTCDay(), date: d };
}
function riyadhDayStart(ms) {
  const r = riyadh(ms);
  return Date.UTC(r.y, r.m - 1, r.d) - 3 * 3600e3;
}

module.exports = { ok, fail, clean, toLatin, money, fmt, sha256, normalizePhone, intlPhone, waNumber, randomCode, randomId, clientIp, header, riyadh, riyadhDayStart };
