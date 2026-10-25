/* آن coffee service worker: offline shell, fast repeat visits, order notifications. */
const VERSION = 'ann-2026-10-25';
const CORE = ['/', '/offline.html', '/styles.css?v=4', '/ann.js?v=4', '/app.js?v=4', '/cart.js?v=4', '/logo-white.webp', '/logo.webp',
  '/fonts/zain-regular.woff', '/fonts/zain-bold.woff', '/fonts/zain-extrabold.woff', '/fonts/zain-black.woff', '/icons/icon-192.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => Promise.all(CORE.map(u => c.add(u).catch(() => null)))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin || url.pathname.startsWith('/api/') || url.pathname === '/sw.js') return;

  // pages: network first, cached copy or the offline page when there is no signal
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then(r => {
      if (r.ok) { const copy = r.clone(); caches.open(VERSION).then(c => c.put(url.pathname, copy)); }
      return r;
    }).catch(async () => (await caches.match(url.pathname)) || (await caches.match('/offline.html'))));
    return;
  }
  // assets: cached copy straight away, refreshed in the background
  e.respondWith(caches.match(req).then(hit => {
    const net = fetch(req).then(r => { if (r.ok && r.type === 'basic') { const copy = r.clone(); caches.open(VERSION).then(c => c.put(req, copy)); } return r; }).catch(() => hit);
    return hit || net;
  }));
});

// Pushes carry no payload: ask the server what the message is.
self.addEventListener('push', e => {
  e.waitUntil((async () => {
    let m = null;
    try {
      const sub = await self.registration.pushManager.getSubscription();
      const r = await fetch('/api/v1/push/inbox', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: sub && sub.endpoint }) });
      m = (await r.json()).msg;
    } catch {}
    m = m || { title: 'آن coffee', body: 'عندك تحديث جديد على طلبك.', url: '/account#orders' };
    await self.registration.showNotification(m.title, {
      body: m.body, tag: m.tag || 'ann', renotify: true, dir: 'rtl', lang: 'ar',
      icon: '/icons/icon-192.png', badge: '/icons/badge-96.png', data: { url: m.url || '/' }
    });
  })());
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const target = new URL((e.notification.data && e.notification.data.url) || '/', location.origin).href;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) if (w.url === target && 'focus' in w) return w.focus();
    if (wins[0] && 'navigate' in wins[0]) { await wins[0].navigate(target).catch(() => null); return wins[0].focus(); }
    return self.clients.openWindow(target);
  })());
});
