// Security headers and request checks shared by server.js and the Vercel functions.
// vercel.json repeats the same headers for static files on Vercel; keep the two in sync.

const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://cdn.moyasar.com",
  "style-src 'self' 'unsafe-inline' https://cdn.moyasar.com https://fonts.googleapis.com",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data: https://fonts.gstatic.com https://cdn.moyasar.com",
  "connect-src 'self' https://api.moyasar.com https://cdn.moyasar.com",
  "frame-src 'self' https://*.moyasar.com",
  "worker-src 'self'",
  "manifest-src 'self'",
  "media-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'"
].join('; ');

const HEADERS = {
  'Content-Security-Policy': CSP,
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(self), geolocation=(self), microphone=(), payment=(self), usb=(), interest-cohort=()',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains'
};

// API writes must be JSON: a cross-site <form> can only send text/plain, urlencoded or multipart,
// so this blocks forged orders and account changes from other websites.
function jsonOnly(method, headers) {
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return true;
  const ct = String((headers && (headers['content-type'] || headers['Content-Type'])) || '').toLowerCase();
  return ct.startsWith('application/json');
}

module.exports = { CSP, HEADERS, jsonOnly };
