// Builds a signed Apple Wallet pass (.pkpass) for آن coffee.
// No npm dependencies: ZIP is written by hand and the PKCS#7 signature uses the openssl CLI.
//
// Required environment variables (see README):
//   APPLE_PASS_TYPE_ID   e.g. pass.com.example.anncoffee
//   APPLE_TEAM_ID        10-character Apple team id
//   APPLE_PASS_CERT      Pass Type ID certificate, PEM text OR base64 of the PEM
//   APPLE_PASS_KEY       Its private key, PEM text OR base64 of the PEM
//   APPLE_WWDR_CERT      Apple WWDR (G4) intermediate certificate, PEM text OR base64 of the PEM
// Optional:
//   APPLE_PASS_KEY_PASSPHRASE, SITE_URL

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ASSET_DIR = path.join(__dirname, '..', 'public', 'pass');
const ASSETS = ['icon.png', 'icon@2x.png', 'icon@3x.png', 'logo.png', 'logo@2x.png', 'logo@3x.png', 'strip.png', 'strip@2x.png', 'strip@3x.png'];

function pem(value) {
  const v = String(value || '').trim();
  if (!v) return '';
  if (v.includes('-----BEGIN')) return v.replace(/\\n/g, '\n') + '\n';
  return Buffer.from(v, 'base64').toString('utf8').trim() + '\n';
}

function missingConfig(env = process.env) {
  return ['APPLE_PASS_TYPE_ID', 'APPLE_TEAM_ID', 'APPLE_PASS_CERT', 'APPLE_PASS_KEY', 'APPLE_WWDR_CERT'].filter(k => !env[k]);
}

function passJson(env = process.env) {
  const site = env.SITE_URL || 'https://ann-ai-lac.vercel.app';
  const host = site.replace(/^https?:\/\//, '').replace(/\/$/, '');
  return {
    formatVersion: 1,
    passTypeIdentifier: env.APPLE_PASS_TYPE_ID,
    teamIdentifier: env.APPLE_TEAM_ID,
    serialNumber: 'ann-coffee-card',
    organizationName: 'آن coffee',
    description: 'بطاقة آن coffee',
    logoText: 'آن coffee',
    foregroundColor: 'rgb(255, 255, 255)',
    labelColor: 'rgb(232, 189, 114)',
    backgroundColor: 'rgb(75, 31, 16)',
    barcodes: [{ format: 'PKBarcodeFormatQR', message: site, messageEncoding: 'iso-8859-1', altText: host }],
    storeCard: {
      headerFields: [{ key: 'status', label: 'الحالة', value: 'قريبًا الافتتاح', textAlignment: 'PKTextAlignmentLeft' }],
      primaryFields: [{ key: 'welcome', label: 'مرحبًا', value: 'ضيفنا الكريم' }],
      secondaryFields: [{ key: 'tag', label: 'آن coffee', value: 'قهوة مختصة وأكثر' }],
      auxiliaryFields: [{ key: 'loc', label: 'الموقع', value: 'شمال محايل عسير' }],
      backFields: [
        { key: 'site', label: 'موقعنا', value: site, dataDetectorTypes: ['PKDataDetectorTypeLink'] },
        { key: 'about', label: 'عن آن', value: 'آن coffee — قهوة مختصة وأكثر في شمال محايل عسير. امسح الباركود لزيارة صفحتنا.' }
      ]
    }
  };
}

// ---- minimal ZIP (store) ----
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function zip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, data] of files) {
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(0, 8);
    lh.writeUInt16LE(0, 10); lh.writeUInt16LE(0x21, 12); lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nameBuf.length, 26); lh.writeUInt16LE(0, 28);
    locals.push(lh, nameBuf, data);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(0, 10);
    ch.writeUInt16LE(0, 12); ch.writeUInt16LE(0x21, 14); ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(nameBuf.length, 28);
    ch.writeUInt32LE(offset, 42);
    centrals.push(ch, nameBuf);
    offset += lh.length + nameBuf.length + data.length;
  }
  const cdSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cdSize, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

function sign(manifest, env) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ann-pass-'));
  try {
    const f = n => path.join(dir, n);
    fs.writeFileSync(f('cert.pem'), pem(env.APPLE_PASS_CERT), { mode: 0o600 });
    fs.writeFileSync(f('key.pem'), pem(env.APPLE_PASS_KEY), { mode: 0o600 });
    fs.writeFileSync(f('wwdr.pem'), pem(env.APPLE_WWDR_CERT), { mode: 0o600 });
    fs.writeFileSync(f('manifest.json'), manifest);
    const args = ['smime', '-sign', '-binary', '-signer', f('cert.pem'), '-inkey', f('key.pem'), '-certfile', f('wwdr.pem'),
      '-in', f('manifest.json'), '-out', f('signature'), '-outform', 'DER'];
    if (env.APPLE_PASS_KEY_PASSPHRASE) args.push('-passin', 'env:APPLE_PASS_KEY_PASSPHRASE');
    execFileSync('openssl', args, { env: { ...process.env, APPLE_PASS_KEY_PASSPHRASE: env.APPLE_PASS_KEY_PASSPHRASE || '' }, stdio: 'pipe' });
    return fs.readFileSync(f('signature'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function buildPass(env = process.env) {
  const missing = missingConfig(env);
  if (missing.length) {
    const e = new Error('wallet_not_configured');
    e.code = 'NOT_CONFIGURED';
    e.missing = missing;
    throw e;
  }
  const files = new Map();
  files.set('pass.json', Buffer.from(JSON.stringify(passJson(env), null, 2), 'utf8'));
  for (const a of ASSETS) files.set(a, fs.readFileSync(path.join(ASSET_DIR, a)));
  const manifest = {};
  for (const [name, data] of files) manifest[name] = crypto.createHash('sha1').update(data).digest('hex');
  const manifestBuf = Buffer.from(JSON.stringify(manifest), 'utf8');
  files.set('manifest.json', manifestBuf);
  files.set('signature', sign(manifestBuf, env));
  return zip([...files.entries()]);
}

module.exports = { buildPass, missingConfig, passJson };
