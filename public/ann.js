/* آن coffee: shared client helpers (API, account token, toast, app install, notifications) */
window.Ann = (() => {
  const ls = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
    raw(k) { try { return localStorage.getItem(k); } catch { return null; } },
    rawSet(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} }
  };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = n => (Math.round(Number(n || 0) * 100) / 100).toLocaleString('en-US');
  const latin = s => String(s || '').replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));

  const token = () => ls.raw('ann-token');
  const setToken = t => { if (t) ls.rawSet('ann-token', t); };

  async function api(method, path, body) {
    const h = { 'Content-Type': 'application/json' };
    const t = token(); if (t) h['x-ann-token'] = t;
    try {
      const r = await fetch('/api/v1/' + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
      const data = await r.json().catch(() => ({}));
      if (data && data.token) setToken(data.token);
      return { ok: r.ok, status: r.status, data };
    } catch {
      return { ok: false, status: 0, data: { message: 'صار انقطاع في الاتصال، جرّب مرة ثانية.' } };
    }
  }

  let sP = null, mP = null;
  const settings = (fresh) => (!fresh && sP) || (sP = api('GET', 'settings').then(r => r.ok ? r.data : null));
  const menu = () => mP || (mP = api('GET', 'menu').then(r => r.ok ? r.data : null));

  function toast(msg) {
    let t = document.getElementById('toast');
    if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; t.setAttribute('role', 'status'); t.setAttribute('aria-live', 'polite'); document.body.append(t); }
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2400);
  }

  // ---------- installable app ----------
  let deferred = null;
  const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
  }
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; document.dispatchEvent(new Event('ann:installable')); });
  const canInstall = () => !standalone() && (Boolean(deferred) || isIOS);

  function sheet(html) {
    const wrap = document.createElement('div');
    wrap.className = 'ann-modal';
    wrap.innerHTML = `<div class="ann-modal-card" role="dialog" aria-modal="true">${html}<button class="btn btn-roast ann-modal-close" type="button">تمام</button></div>`;
    const close = () => wrap.remove();
    wrap.addEventListener('click', e => { if (e.target === wrap || e.target.closest('.ann-modal-close')) close(); });
    document.addEventListener('keydown', function k(e) { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', k); } });
    document.body.append(wrap);
    wrap.querySelector('.ann-modal-close').focus();
    return wrap;
  }

  async function install() {
    if (deferred) { deferred.prompt(); const c = await deferred.userChoice.catch(() => null); deferred = null; return c && c.outcome === 'accepted'; }
    if (isIOS) {
      sheet(`<h2>ثبّت آن على جوالك</h2>
        <ol class="ios-steps">
          <li>اضغط زر <b>المشاركة</b> <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M7 8l5-5 5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg> أسفل Safari.</li>
          <li>اختر <b>إضافة إلى الشاشة الرئيسية</b>.</li>
          <li>اضغط <b>إضافة</b>، وبتلقى أيقونة آن مع تطبيقاتك.</li>
        </ol>`);
      return false;
    }
    return false;
  }

  // ---------- notifications ----------
  const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const b64ToBytes = s => { const p = '='.repeat((4 - s.length % 4) % 4); const b = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(b, c => c.charCodeAt(0)); };
  async function enablePush(opts) {
    opts = opts || {};
    if (!pushSupported()) {
      if (isIOS && !standalone()) { sheet('<h2>الإشعارات على iPhone</h2><p>ثبّت آن على الشاشة الرئيسية أول، وبعدها فعّل الإشعارات من داخل التطبيق.</p>'); return { error: 'ios_install' }; }
      return { error: 'unsupported', message: 'جهازك ما يدعم الإشعارات.' };
    }
    const key = await api('GET', 'push/key');
    if (!key.ok) return { error: 'off', message: key.data.message || 'الإشعارات غير متاحة حاليًا.' };
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') return { error: 'denied', message: 'سمحت للإشعارات؟ فعّلها من إعدادات المتصفح.' };
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(key.data.key) });
    const headers = {};
    const body = { sub: sub.toJSON(), order: opts.order, admin: !!opts.admin };
    if (opts.admin) {
      const r = await fetch('/api/v1/push/subscribe', { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json', 'x-admin-pin': opts.pin }, headers), body: JSON.stringify(body) });
      return r.ok ? { ok: true } : { error: 'fail', message: 'ما قدرنا نفعّل الإشعارات.' };
    }
    const r = await api('POST', 'push/subscribe', body);
    return r.ok ? { ok: true } : { error: 'fail', message: r.data.message || 'ما قدرنا نفعّل الإشعارات.' };
  }

  async function pushEnabled() {
    if (!pushSupported() || Notification.permission !== 'granted') return false;
    const reg = await navigator.serviceWorker.getRegistration();
    return Boolean(reg && await reg.pushManager.getSubscription());
  }

  async function ensureAccount(profile) {
    const r = await api('POST', 'account', profile || {});
    return r.ok ? r.data.account : null;
  }

  // ---------- online payment (Moyasar) ----------
  let myP = null;
  function loadMoyasar() {
    if (myP) return myP;
    const v = '1.15.0';
    myP = new Promise((res, rej) => {
      const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = `https://cdn.moyasar.com/mpf/${v}/moyasar.css`; document.head.append(css);
      const js = document.createElement('script'); js.src = `https://cdn.moyasar.com/mpf/${v}/moyasar.js`;
      js.onload = () => res(window.Moyasar); js.onerror = () => { myP = null; rej(new Error('load')); };
      document.head.append(js);
    });
    return myP;
  }
  // o: { amount (SAR), description, metadata, callback }
  async function pay(el, o) {
    const s = await settings();
    if (!s || !s.payOnline || !s.moyasarKey) { el.innerHTML = '<p class="o-err">الدفع الإلكتروني غير متاح حاليًا.</p>'; return false; }
    el.innerHTML = '<p class="muted">نجهّز صفحة الدفع…</p>';
    try { await loadMoyasar(); } catch { el.innerHTML = '<p class="o-err">ما قدرنا نفتح صفحة الدفع، حدّث الصفحة.</p>'; return false; }
    const id = 'mysr' + Math.random().toString(36).slice(2, 8);
    el.innerHTML = `<div class="mysr-form" id="${id}"></div>`;
    window.Moyasar.init({
      element: '#' + id, amount: Math.round(o.amount * 100), currency: 'SAR', description: o.description,
      publishable_api_key: s.moyasarKey, callback_url: o.callback,
      methods: ['applepay', 'creditcard', 'stcpay'], supported_networks: ['mada', 'visa', 'mastercard'],
      apple_pay: { country: 'SA', label: 'آن coffee', validate_merchant_url: 'https://api.moyasar.com/v1/applepay/initiate' },
      metadata: o.metadata, language: 'ar'
    });
    return true;
  }

  // QR code as an SVG string (needs /vendor/qrcode.js on the page)
  function qrSVG(text, px) {
    if (typeof window.qrcode !== 'function') return '';
    const q = window.qrcode(0, 'M'); q.addData(text); q.make();
    const n = q.getModuleCount(), m = 2, size = n + m * 2;
    let d = '';
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += `M${c + m} ${r + m}h1v1h-1z`;
    return `<svg viewBox="0 0 ${size} ${size}" width="${px || 200}" height="${px || 200}" shape-rendering="crispEdges" aria-hidden="true"><rect width="${size}" height="${size}" fill="#fff"/><path d="${d}" fill="#2e140b"/></svg>`;
  }

  const ar = n => Number(n || 0).toLocaleString('ar-SA');
  const when = ms => new Date(ms).toLocaleString('ar-SA-u-nu-latn', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

  return { ls, esc, money, latin, api, token, setToken, settings, menu, toast, install, canInstall, isIOS, standalone, sheet, pushSupported, pushEnabled, enablePush, ensureAccount, pay, qrSVG, ar, when };
})();
