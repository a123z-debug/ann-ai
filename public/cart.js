/* آن coffee: cart and checkout */
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = n => (Math.round(n * 100) / 100).toLocaleString('en-US');
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
    sget(k) { try { return sessionStorage.getItem(k); } catch { return null; } },
    sset(k, v) { try { sessionStorage.setItem(k, v); } catch {} }
  };

  const drawer = $('#cart'), body = $('#cartBody'), foot = $('#cartFoot'), back = $('#cartBack'), title = $('#cart-title');
  const backdrop = $('.cart-backdrop'), bar = $('#cartBar'), toast = $('#toast');
  if (!drawer) return;

  let MENU = new Map();
  let S = { open: true, types: { pickup: true, dinein: true, delivery: true }, deliveryFee: 0, payAtCounter: true, payOnline: false, soldOut: [], whatsapp: '' };
  let cart = store.get('ann-cart', []).filter(l => l && l.id && l.qty > 0);
  let view = 'cart';
  let lastFocus = null;
  const form = store.get('ann-checkout', { type: '', name: '', phone: '', when: 'asap', address: '', notes: '', pay: '' });

  // A table QR opens the site with ?table=N
  const qp = new URLSearchParams(location.search);
  const tq = parseInt(qp.get('table') || '', 10);
  if (tq > 0 && tq < 301) store.sset('ann-table', String(tq));
  const table = parseInt(store.sget('ann-table') || '', 10) || null;
  if (table) form.type = 'dinein';

  const save = () => { store.set('ann-cart', cart); };
  const count = () => cart.reduce((n, l) => n + l.qty, 0);
  const subtotal = () => cart.reduce((n, l) => n + (MENU.get(l.id)?.price || 0) * l.qty, 0);
  const itemName = it => it.name + (it.variant ? ` (${it.variant})` : '');
  const isOut = id => S.soldOut.includes(id);

  function say(msg) {
    toast.textContent = msg; toast.classList.add('show');
    clearTimeout(say.t); say.t = setTimeout(() => toast.classList.remove('show'), 2200);
  }

  function setQty(id, qty) {
    const it = MENU.get(id); if (!it) return;
    qty = Math.max(0, Math.min(20, qty));
    const i = cart.findIndex(l => l.id === id);
    if (qty === 0) { if (i > -1) cart.splice(i, 1); }
    else if (i > -1) cart[i].qty = qty;
    else { cart.push({ id, qty, note: '' }); if (!drawer.classList.contains('open')) say(`أضفنا ${itemName(it)} للسلة`); }
    save(); paint();
  }
  const qtyOf = id => (cart.find(l => l.id === id) || {}).qty || 0;

  // ---------- controls on the menu ----------
  function controlHTML(id, compact) {
    const it = MENU.get(id); if (!it) return '';
    if (isOut(id)) return `<span class="out-tag">نفد</span>`;
    const q = qtyOf(id), nm = esc(itemName(it));
    if (!q) return compact
      ? `<button type="button" class="add-mini" data-plus="${id}" aria-label="أضف ${nm} للسلة"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg></button>`
      : `<button type="button" class="add" data-plus="${id}" aria-label="أضف ${nm} للسلة"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>أضف</button>`;
    return `<span class="stepper${compact ? ' sm' : ''}" role="group" aria-label="كمية ${nm}">
      <button type="button" data-plus="${id}" aria-label="زيادة ${nm}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg></button>
      <output aria-live="polite">${q}</output>
      <button type="button" data-minus="${id}" aria-label="تقليل ${nm}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg></button>
    </span>`;
  }
  function paintMenu() {
    $$('.shelf li[data-id]').forEach(li => {
      let slot = $('.add-slot', li);
      if (!slot) { slot = document.createElement('div'); slot.className = 'add-slot'; li.append(slot); }
      slot.innerHTML = controlHTML(li.dataset.id, false);
      li.classList.toggle('is-out', isOut(li.dataset.id));
      li.classList.toggle('in-cart', qtyOf(li.dataset.id) > 0);
    });
    $$('.price-list li[data-id]').forEach(li => {
      let slot = $('.add-slot', li);
      if (!slot) { slot = document.createElement('span'); slot.className = 'add-slot'; li.append(slot); }
      slot.innerHTML = controlHTML(li.dataset.id, true);
      li.classList.toggle('is-out', isOut(li.dataset.id));
      li.classList.toggle('in-cart', qtyOf(li.dataset.id) > 0);
    });
  }

  function paintBadges() {
    const n = count();
    $$('.cart-count').forEach(b => { b.textContent = n; b.hidden = !n; });
    bar.hidden = !n || drawer.classList.contains('open');
    document.body.classList.toggle('has-cart', !!n);
    if (n) { $('.cb-count', bar).textContent = n; $('.cb-total', bar).textContent = `${money(subtotal())} ر.س`; }
  }

  // ---------- drawer ----------
  function openCart(start) {
    lastFocus = document.activeElement;
    view = start || 'cart';
    drawer.classList.add('open'); drawer.setAttribute('aria-hidden', 'false');
    backdrop.hidden = false; requestAnimationFrame(() => backdrop.classList.add('visible'));
    document.body.classList.add('cart-open');
    paint();
    setTimeout(() => (drawer.querySelector('input,button.cta,button') || drawer).focus(), 80);
  }
  function closeCart() {
    drawer.classList.remove('open'); drawer.setAttribute('aria-hidden', 'true');
    backdrop.classList.remove('visible'); backdrop.hidden = true;
    document.body.classList.remove('cart-open');
    paintBadges();
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  function cartView() {
    title.textContent = 'سلتك';
    back.hidden = true;
    const tableChip = table ? `<p class="table-chip"><b>طاولة ${table}</b> اطلب من مكانك، ويوصلك الطلب على طاولتك.</p>` : '';
    const closed = !S.open ? `<p class="notice">استقبال الطلبات يبدأ مع الافتتاح. تقدر تجهّز سلتك من الحين.</p>` : '';
    const recent = store.get('ann-orders', []).filter(o => Date.now() - o.at < 6 * 3600e3)[0];
    const last = recent ? `<a class="last-order" href="/order?o=${encodeURIComponent(recent.id)}">تابع طلبك #${recent.number}</a>` : '';
    if (!cart.length) {
      body.innerHTML = `${tableChip}${last}<div class="empty"><svg viewBox="0 0 64 64" aria-hidden="true"><path d="M14 22h36l-3 30a4 4 0 0 1-4 3.6H21a4 4 0 0 1-4-3.6L14 22Z" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/><path d="M24 26v-6a8 8 0 0 1 16 0v6" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg><h3>سلتك فاضية</h3><p>اختر مشروبك أو حلاك من القائمة.</p></div>`;
      foot.innerHTML = `<button class="cta" type="button" data-go-menu>تصفّح القائمة</button>`;
      return;
    }
    body.innerHTML = tableChip + closed + last + `<ul class="lines">` + cart.map(l => {
      const it = MENU.get(l.id); if (!it) return '';
      const out = isOut(l.id);
      return `<li class="line${out ? ' is-out' : ''}" data-line="${l.id}">
        <div class="l-main">
          <b>${esc(it.name)}${it.variant ? ` <em class="tag ${it.variant === 'بارد' ? 'cold' : 'hot'}">${esc(it.variant)}</em>` : ''}</b>
          <span class="l-price">${money(it.price)} ر.س${out ? ' · نفد، احذفه' : ''}</span>
        </div>
        ${controlHTML(l.id, true).replace('class="add-mini"', 'class="add-mini" hidden')}
        <span class="l-total">${money(it.price * l.qty)} ر.س</span>
        <label class="l-note"><span class="sr-only">ملاحظة على ${esc(itemName(it))}</span><input type="text" maxlength="80" value="${esc(l.note)}" placeholder="ملاحظة (مثال: بدون سكر)" data-note="${l.id}"></label>
      </li>`;
    }).join('') + `</ul>`;
    const hasOut = cart.some(l => isOut(l.id));
    foot.innerHTML = `<div class="sum"><span>المجموع</span><b>${money(subtotal())} ر.س</b></div>
      <button class="cta" type="button" data-checkout ${!S.open || hasOut ? 'disabled' : ''}>متابعة الطلب</button>`;
  }

  function typesAvailable() { return (table ? ['dinein', 'pickup', 'delivery'] : ['pickup', 'delivery', 'dinein']).filter(t => S.types[t]); }

  function checkoutView() {
    title.textContent = 'إتمام الطلب';
    back.hidden = false;
    const types = typesAvailable();
    if (!types.includes(form.type)) form.type = types[0];
    const payOpts = [];
    if (S.payOnline) payOpts.push('online');
    if (S.payAtCounter) payOpts.push('counter');
    if (!payOpts.includes(form.pay)) form.pay = payOpts[0];
    const t = form.type;
    const fee = t === 'delivery' ? S.deliveryFee : 0;
    const label = { dinein: 'داخل المحل', pickup: 'استلام من المحل', delivery: 'توصيل' };
    const hint = { dinein: 'من طاولتك والكاشير يجهّزه لك', pickup: 'جهّزه وأمرّ آخذه', delivery: 'يوصلك لين بابك' };
    body.innerHTML = `<form id="checkout" class="co" novalidate>
      <fieldset class="seg-wrap"><legend>كيف تبي طلبك؟</legend>
        <div class="seg">${types.map(x => `<label class="${x === t ? 'on' : ''}"><input type="radio" name="type" value="${x}" ${x === t ? 'checked' : ''}><b>${label[x]}</b><small>${hint[x]}</small></label>`).join('')}</div>
      </fieldset>
      ${t === 'dinein' ? `
        <label class="fld"><span>رقم الطاولة</span><input name="table" inputmode="numeric" pattern="[0-9]*" maxlength="3" value="${table || ''}" ${table ? 'readonly' : ''} required placeholder="مكتوب على الطاولة"></label>
        <label class="fld"><span>اسمك <small>(اختياري)</small></span><input name="name" maxlength="40" autocomplete="given-name" value="${esc(form.name)}" placeholder="عشان نناديك باسمك"></label>` : `
        <label class="fld"><span>اسمك</span><input name="name" maxlength="40" autocomplete="name" value="${esc(form.name)}" required></label>
        <label class="fld"><span>رقم الجوال</span><input name="phone" type="tel" inputmode="tel" autocomplete="tel" dir="ltr" maxlength="14" value="${esc(form.phone)}" placeholder="05xxxxxxxx" required></label>`}
      ${t === 'pickup' ? `<label class="fld"><span>متى تمر؟</span><select name="when">${[['asap', 'بأقرب وقت'], ['15', 'بعد ١٥ دقيقة'], ['30', 'بعد ٣٠ دقيقة'], ['45', 'بعد ٤٥ دقيقة'], ['60', 'بعد ساعة']].map(([v, l]) => `<option value="${v}" ${form.when === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>` : ''}
      ${t === 'delivery' ? `
        <label class="fld"><span>العنوان</span><textarea name="address" rows="2" maxlength="200" placeholder="الحي، الشارع، أقرب معلم">${esc(form.address)}</textarea></label>
        <button type="button" class="loc-btn${form.location ? ' done' : ''}" data-locate>${form.location ? 'تم تحديد موقعك ✓' : 'شارك موقعي الحالي'}</button>` : ''}
      <label class="fld"><span>ملاحظات للطلب <small>(اختياري)</small></span><input name="notes" maxlength="200" value="${esc(form.notes)}" placeholder="أي شي تبينا نعرفه"></label>
      <fieldset class="pay"><legend>الدفع</legend>
        ${payOpts.map(p => `<label class="pay-opt ${p === form.pay ? 'on' : ''}"><input type="radio" name="pay" value="${p}" ${p === form.pay ? 'checked' : ''}>
          <span><b>${p === 'online' ? 'ادفع الآن' : (t === 'dinein' ? 'ادفع عند الكاشير' : 'الدفع عند الاستلام')}</b><small>${p === 'online' ? 'Apple Pay، مدى، أو بطاقة ائتمانية' : 'كاش أو شبكة'}</small></span>
</label>`).join('')}
        ${!S.payOnline ? '<p class="soon-pay">الدفع الإلكتروني (Apple Pay ومدى) يتفعّل قريبًا.</p>' : ''}
      </fieldset>
      <p class="err" id="coErr" role="alert" hidden></p>
    </form>`;
    foot.innerHTML = `<div class="sum-rows">
        <div><span>المجموع</span><span>${money(subtotal())} ر.س</span></div>
        ${t === 'delivery' ? `<div><span>التوصيل</span><span>${fee ? money(fee) + ' ر.س' : 'يحدده المحل'}</span></div>` : ''}
        <div class="total"><span>الإجمالي</span><b>${money(subtotal() + fee)} ر.س</b></div>
      </div>
      <button class="cta" type="submit" form="checkout" id="placeBtn">${form.pay === 'online' ? 'أكّد وادفع' : 'أكّد الطلب'} · ${money(subtotal() + fee)} ر.س</button>`;
  }

  function paint() {
    paintMenu(); paintBadges();
    if (drawer.classList.contains('open')) (view === 'checkout' ? checkoutView : cartView)();
  }

  // ---------- events ----------
  document.addEventListener('click', e => {
    const plus = e.target.closest('[data-plus]'), minus = e.target.closest('[data-minus]');
    if (plus) { e.preventDefault(); setQty(plus.dataset.plus, qtyOf(plus.dataset.plus) + 1); return; }
    if (minus) { e.preventDefault(); setQty(minus.dataset.minus, qtyOf(minus.dataset.minus) - 1); return; }
    if (e.target.closest('[data-open-cart]')) { e.preventDefault(); openCart(); return; }
    if (e.target.closest('[data-close-cart]')) { e.preventDefault(); closeCart(); return; }
    if (e.target.closest('[data-go-menu]')) { closeCart(); location.hash = '#menu'; return; }
    if (e.target.closest('[data-checkout]')) { view = 'checkout'; paint(); body.scrollTop = 0; return; }
    if (e.target.closest('[data-locate]')) { locate(e.target.closest('[data-locate]')); return; }
  });
  back.addEventListener('click', () => { view = 'cart'; paint(); });
  document.addEventListener('keydown', e => {
    if (!drawer.classList.contains('open')) return;
    if (e.key === 'Escape') closeCart();
    if (e.key === 'Tab') {
      const f = $$('button:not([disabled]):not([hidden]),input:not([type=radio]),input[type=radio]:checked,select,textarea,a[href]', drawer).filter(x => x.offsetParent !== null);
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    }
  });
  body.addEventListener('input', e => {
    const n = e.target.dataset.note;
    if (n) { const l = cart.find(x => x.id === n); if (l) { l.note = e.target.value.slice(0, 80); save(); } return; }
    const f = e.target.form; if (!f || f.id !== 'checkout') return;
    if (['name', 'phone', 'address', 'notes'].includes(e.target.name)) { form[e.target.name] = e.target.value; store.set('ann-checkout', Object.assign({}, form, { location: undefined })); }
  });
  body.addEventListener('change', e => {
    const f = e.target.form; if (!f || f.id !== 'checkout') return;
    if (e.target.name === 'type' || e.target.name === 'pay') { form[e.target.name] = e.target.value; paint(); }
    if (e.target.name === 'when') form.when = e.target.value;
  });
  body.addEventListener('submit', e => { if (e.target.id === 'checkout') { e.preventDefault(); place(); } });
  foot.addEventListener('click', e => { if (e.target.id === 'placeBtn') { e.preventDefault(); place(); } });

  function locate(btn) {
    if (!navigator.geolocation) { say('جهازك ما يدعم تحديد الموقع، اكتب العنوان.'); return; }
    btn.disabled = true; btn.textContent = 'نحدد موقعك…';
    navigator.geolocation.getCurrentPosition(p => {
      form.location = { lat: p.coords.latitude, lng: p.coords.longitude };
      btn.disabled = false; btn.classList.add('done'); btn.textContent = 'تم تحديد موقعك ✓';
    }, () => { btn.disabled = false; btn.textContent = 'شارك موقعي الحالي'; say('ما قدرنا نحدد موقعك، اكتب العنوان.'); }, { enableHighAccuracy: true, timeout: 10000 });
  }

  function showErr(msg, field) {
    const el = $('#coErr'); if (el) { el.textContent = msg; el.hidden = false; }
    const inp = field && $(`#checkout [name="${field}"]`);
    if (inp) { inp.setAttribute('aria-invalid', 'true'); inp.focus(); }
  }

  let placing = false;
  async function place() {
    if (placing) return;
    const f = $('#checkout'); if (!f) return;
    $$('[aria-invalid]', f).forEach(x => x.removeAttribute('aria-invalid'));
    const v = Object.fromEntries(new FormData(f).entries());
    const latin = s => String(s || '').replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
    if (form.type === 'dinein' && !(parseInt(latin(v.table), 10) > 0)) return showErr('اكتب رقم الطاولة.', 'table');
    if (form.type !== 'dinein') {
      if (String(v.name || '').trim().length < 2) return showErr('اكتب اسمك.', 'name');
      if (!/^(?:\+?966|0)?5\d{8}$/.test(latin(v.phone).replace(/[\s-]/g, ''))) return showErr('رقم الجوال غير صحيح، اكتبه مثل 05xxxxxxxx.', 'phone');
    }
    if (form.type === 'delivery' && String(v.address || '').trim().length < 6 && !form.location) return showErr('اكتب عنوانك أو شارك موقعك.', 'address');

    placing = true;
    const btn = $('#placeBtn'); const old = btn.textContent; btn.disabled = true; btn.textContent = 'نرسل طلبك…';
    try {
      const r = await fetch('/api/order', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: form.type, table: v.table, name: v.name, phone: v.phone, when: v.when, address: v.address,
          location: form.location, notes: v.notes, pay: form.pay,
          items: cart.map(l => ({ id: l.id, qty: l.qty, note: l.note }))
        })
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { showErr(j.message || 'تعذر إرسال الطلب، جرّب مرة ثانية.', j.error); return; }
      const o = j.order;
      store.set('ann-order-' + o.id, Object.assign({}, o, { stored: j.stored }));
      const list = store.get('ann-orders', []).filter(x => x.id !== o.id);
      list.unshift({ id: o.id, number: o.number, at: Date.now() }); store.set('ann-orders', list.slice(0, 10));
      cart = []; save();
      location.href = `/order?o=${encodeURIComponent(o.id)}&new=1`;
    } catch {
      showErr('صار انقطاع في الاتصال، جرّب مرة ثانية.');
    } finally {
      placing = false; if (btn && document.body.contains(btn)) { btn.disabled = false; btn.textContent = old; }
    }
  }

  // ---------- boot ----------
  Promise.all([
    fetch('/api/menu').then(r => r.json()).catch(() => null),
    fetch('/api/settings', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null)
  ]).then(([m, s]) => {
    if (m && m.items) MENU = new Map(m.items.map(i => [i.id, i]));
    if (s) S = Object.assign(S, s);
    cart = cart.filter(l => MENU.has(l.id));
    paint();
    if (table && !store.sget('ann-table-greeted')) { store.sset('ann-table-greeted', '1'); say(`أهلًا بك! أنت على طاولة ${table}، اطلب من القائمة.`); }
  });
})();
