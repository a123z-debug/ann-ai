/* آن coffee: menu options, cart and checkout */
(() => {
  const A = window.Ann; if (!A) return;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const { esc, money, ls } = A;
  const ssGet = k => { try { return sessionStorage.getItem(k); } catch { return null; } };
  const ssSet = (k, v) => { try { v == null ? sessionStorage.removeItem(k) : sessionStorage.setItem(k, v); } catch {} };

  const drawer = $('#cart'), body = $('#cartBody'), foot = $('#cartFoot'), back = $('#cartBack'), title = $('#cart-title');
  const backdrop = $('.cart-backdrop'), bar = $('#cartBar');
  if (!drawer) return;

  let MENU = new Map(), GROUPS = {};
  let S = { open: true, types: { pickup: true, dinein: true, delivery: true }, deliveryFee: 0, payAtCounter: true, payOnline: false, soldOut: [], branches: [], loyalty: { enabled: true, stamps: 8, cap: 25 } };
  let ACC = null;
  let view = 'cart', lastFocus = null;
  let promo = null; // { code, discount, label }
  const form = Object.assign({ type: '', name: '', phone: '', when: 'asap', address: '', notes: '', pay: '', branch: '', useReward: false }, ls.get('ann-checkout', {}));
  form.useReward = false;

  // cart lines: { key, id, qty, note, opts }
  let cart = ls.get('ann-cart', []).filter(l => l && l.id && l.qty > 0).map(l => Object.assign({ opts: {}, note: '' }, l, { key: l.key || l.id }));

  const qp = new URLSearchParams(location.search);
  const tq = parseInt(qp.get('table') || '', 10);
  if (tq > 0 && tq < 301) ssSet('ann-table', String(tq));
  if (qp.get('b')) ssSet('ann-branch', qp.get('b'));
  const table = parseInt(ssGet('ann-table') || '', 10) || null;
  if (table) form.type = 'dinein';

  const save = () => ls.set('ann-cart', cart);
  const saveForm = () => ls.set('ann-checkout', { name: form.name, phone: form.phone, when: form.when, address: form.address, type: form.type, branch: form.branch });

  // ---------- pricing (mirrors the server) ----------
  function normOpts(item, opts) {
    const out = {};
    for (const g of item.opts || []) {
      const grp = GROUPS[g]; if (!grp) continue;
      if (grp.type === 'one') {
        const v = opts && opts[g] != null ? String(opts[g]) : grp.default;
        out[g] = grp.choices.some(c => c.id === v) ? v : grp.default;
      } else {
        const v = (opts && Array.isArray(opts[g]) ? opts[g] : []).filter(x => grp.choices.some(c => c.id === x));
        if (v.length) out[g] = v;
      }
    }
    return out;
  }
  function unitOf(id, opts) {
    const it = MENU.get(id); if (!it) return 0;
    let p = it.price;
    for (const g of it.opts || []) {
      const grp = GROUPS[g]; if (!grp) continue;
      const v = opts && opts[g];
      if (grp.type === 'one') { const c = grp.choices.find(c => c.id === (v || grp.default)); p += c ? c.price || 0 : 0; }
      else for (const x of v || []) { const c = grp.choices.find(c => c.id === x); p += c ? c.price || 0 : 0; }
    }
    return p;
  }
  function optText(id, opts) {
    const it = MENU.get(id); if (!it) return '';
    const out = [];
    for (const g of it.opts || []) {
      const grp = GROUPS[g]; if (!grp) continue;
      const v = opts && opts[g];
      if (grp.type === 'one') { const c = grp.choices.find(c => c.id === v); if (c && (c.id !== grp.default || c.price)) out.push(c.label); }
      else for (const c of grp.choices) if ((v || []).includes(c.id)) out.push(c.label);
    }
    return out.join('، ');
  }
  const keyOf = (id, opts) => id + '|' + Object.keys(opts || {}).sort().map(k => k + '=' + [].concat(opts[k]).sort().join('+')).join(';');
  const itemName = it => it.name + (it.variant ? ` (${it.variant})` : '');
  const isOut = id => (S.soldOut || []).includes(id);
  const count = () => cart.reduce((n, l) => n + l.qty, 0);
  const subtotal = () => cart.reduce((n, l) => n + unitOf(l.id, l.opts) * l.qty, 0);
  const qtyOf = id => cart.filter(l => l.id === id).reduce((n, l) => n + l.qty, 0);

  function addLine(id, opts, qty, note) {
    const it = MENU.get(id); if (!it) return;
    opts = normOpts(it, opts);
    const key = keyOf(id, opts) + (note ? '#' + note : '');
    const ex = cart.find(l => l.key === key);
    if (ex) ex.qty = Math.min(20, ex.qty + qty);
    else cart.push({ key, id, qty: Math.min(20, qty), note: note || '', opts });
    save(); paint();
    if (!drawer.classList.contains('open')) A.toast(`أضفنا ${itemName(it)} للسلة`);
  }
  function setLineQty(key, qty) {
    const i = cart.findIndex(l => l.key === key); if (i < 0) return;
    if (qty <= 0) cart.splice(i, 1); else cart[i].qty = Math.min(20, qty);
    save(); paint();
  }
  function minusItem(id) {
    for (let i = cart.length - 1; i >= 0; i--) if (cart[i].id === id) { setLineQty(cart[i].key, cart[i].qty - 1); return; }
  }

  // ---------- options sheet ----------
  let sheetEl = null, sheetState = null;
  function ensureSheet() {
    if (sheetEl) return sheetEl;
    sheetEl = document.createElement('div');
    sheetEl.className = 'opt-wrap'; sheetEl.hidden = true;
    sheetEl.innerHTML = `<div class="opt-backdrop" data-opt-close></div>
      <div class="opt-sheet" role="dialog" aria-modal="true" aria-labelledby="optTitle">
        <header class="opt-head"><div><h3 id="optTitle"></h3><p class="opt-base"></p></div>
          <button class="cart-x" type="button" data-opt-close aria-label="إغلاق"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button></header>
        <form class="opt-body" id="optForm"></form>
        <footer class="opt-foot">
          <span class="stepper sm" role="group" aria-label="الكمية"><button type="button" data-oq="1" aria-label="زيادة"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg></button><output id="optQty">1</output><button type="button" data-oq="-1" aria-label="تقليل"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg></button></span>
          <button class="cta" type="button" id="optAdd"></button>
        </footer>
      </div>`;
    document.body.append(sheetEl);
    sheetEl.addEventListener('click', e => {
      if (e.target.closest('[data-opt-close]')) { closeSheet(); return; }
      const q = e.target.closest('[data-oq]'); if (q) { sheetState.qty = Math.max(1, Math.min(20, sheetState.qty + Number(q.dataset.oq))); paintSheetTotal(); }
      if (e.target.closest('#optAdd')) commitSheet();
    });
    sheetEl.addEventListener('change', () => { readSheet(); paintSheetTotal(); });
    sheetEl.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheet(); });
    return sheetEl;
  }
  function openSheet(id, editKey) {
    const it = MENU.get(id); if (!it) return;
    const el = ensureSheet();
    const line = editKey ? cart.find(l => l.key === editKey) : null;
    sheetState = { id, editKey, qty: line ? line.qty : 1, opts: normOpts(it, line ? line.opts : {}), note: line ? line.note : '' };
    $('#optTitle', el).innerHTML = esc(it.name) + (it.variant ? ` <em class="tag ${it.variant === 'بارد' ? 'cold' : 'hot'}">${esc(it.variant)}</em>` : '');
    $('.opt-base', el).textContent = `${money(it.price)} ر.س`;
    $('#optForm', el).innerHTML = (it.opts || []).map(g => {
      const grp = GROUPS[g]; if (!grp) return '';
      const one = grp.type === 'one';
      return `<fieldset class="opt-grp"><legend>${esc(grp.label)}${one ? '' : ' <small>(اختياري)</small>'}</legend><div class="chips">${grp.choices.map(c => {
        const on = one ? sheetState.opts[g] === c.id : (sheetState.opts[g] || []).includes(c.id);
        return `<label class="chip-opt"><input type="${one ? 'radio' : 'checkbox'}" name="${g}" value="${c.id}" ${on ? 'checked' : ''}><span>${esc(c.label)}${c.price ? ` <small>+${c.price}</small>` : ''}</span></label>`;
      }).join('')}</div></fieldset>`;
    }).join('') + `<label class="fld opt-note"><span>ملاحظة <small>(اختياري)</small></span><input name="__note" maxlength="80" value="${esc(sheetState.note)}" placeholder="مثال: حار جدًا"></label>`;
    $('#optAdd', el).dataset.edit = editKey ? '1' : '';
    paintSheetTotal();
    lastFocus = lastFocus || document.activeElement;
    el.hidden = false; requestAnimationFrame(() => el.classList.add('open'));
    document.body.classList.add('cart-open');
    setTimeout(() => ($('input:checked', el) || $('#optAdd', el)).focus(), 60);
  }
  function readSheet() {
    const it = MENU.get(sheetState.id); const f = $('#optForm', sheetEl);
    const opts = {};
    for (const g of it.opts || []) {
      const grp = GROUPS[g]; if (!grp) continue;
      if (grp.type === 'one') { const c = $(`input[name="${g}"]:checked`, f); opts[g] = c ? c.value : grp.default; }
      else { const v = $$(`input[name="${g}"]:checked`, f).map(x => x.value); if (v.length) opts[g] = v; }
    }
    sheetState.opts = opts;
    sheetState.note = ($('input[name="__note"]', f) || {}).value || '';
  }
  function paintSheetTotal() {
    $('#optQty', sheetEl).textContent = sheetState.qty;
    const total = unitOf(sheetState.id, sheetState.opts) * sheetState.qty;
    $('#optAdd', sheetEl).textContent = `${sheetState.editKey ? 'حفظ التعديل' : 'أضف للسلة'} · ${money(total)} ر.س`;
  }
  function commitSheet() {
    readSheet();
    const { id, editKey, qty, opts, note } = sheetState;
    if (editKey) { const i = cart.findIndex(l => l.key === editKey); if (i > -1) cart.splice(i, 1); }
    closeSheet(true);
    addLine(id, opts, qty, note.trim().slice(0, 80));
  }
  function closeSheet(keepCartOpen) {
    if (!sheetEl) return;
    sheetEl.classList.remove('open'); sheetEl.hidden = true;
    if (!drawer.classList.contains('open')) document.body.classList.remove('cart-open');
    if (!keepCartOpen && lastFocus && lastFocus.focus && !drawer.classList.contains('open')) lastFocus.focus();
    lastFocus = null;
  }

  // ---------- menu controls ----------
  const ICON_PLUS = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>';
  const ICON_MINUS = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>';
  function controlHTML(id, compact) {
    const it = MENU.get(id); if (!it) return '';
    if (isOut(id)) return '<span class="out-tag">نفد</span>';
    const q = qtyOf(id), nm = esc(itemName(it));
    if (!q) return compact
      ? `<button type="button" class="add-mini" data-add="${id}" aria-label="أضف ${nm}">${ICON_PLUS}</button>`
      : `<button type="button" class="add" data-add="${id}" aria-label="أضف ${nm}">${ICON_PLUS}أضف</button>`;
    return `<span class="stepper${compact ? ' sm' : ''}" role="group" aria-label="كمية ${nm}">
      <button type="button" data-add="${id}" aria-label="زيادة ${nm}">${ICON_PLUS}</button><output>${q}</output>
      <button type="button" data-minus="${id}" aria-label="تقليل ${nm}">${ICON_MINUS}</button></span>`;
  }
  function paintMenu() {
    $$('.shelf li[data-id], .price-list li[data-id]').forEach(li => {
      const compact = li.closest('.price-list');
      let slot = $('.add-slot', li);
      if (!slot) { slot = document.createElement(compact ? 'span' : 'div'); slot.className = 'add-slot'; li.append(slot); }
      slot.innerHTML = controlHTML(li.dataset.id, !!compact);
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
    if (view === 'checkout') refreshPromo();
    setTimeout(() => (drawer.querySelector('button.cta,input,button') || drawer).focus(), 80);
  }
  function closeCart() {
    drawer.classList.remove('open'); drawer.setAttribute('aria-hidden', 'true');
    backdrop.classList.remove('visible'); backdrop.hidden = true;
    document.body.classList.remove('cart-open');
    paintBadges();
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  function loyaltyBar() {
    if (!S.loyalty || !S.loyalty.enabled) return '';
    const per = S.loyalty.stamps || 8;
    const have = ACC ? ACC.stamps || 0 : 0;
    const rw = ACC ? ACC.rewards || 0 : 0;
    const dots = Array.from({ length: per }, (_, i) => `<i class="${i < have ? 'on' : ''}"></i>`).join('');
    return `<a class="loyal-mini" href="/account"><span class="lm-dots" aria-hidden="true">${dots}</span>
      <span>${rw ? `<b>عندك ${rw === 1 ? 'مشروب مجاني' : A.ar(rw) + ' مشروبات مجانية'}</b> تستخدمه في إتمام الطلب` : `<b>${A.ar(have)} من ${A.ar(per)} أختام</b> كل مشروب بختم، وإذا اكتملت فالمشروب الجاي علينا`}</span></a>`;
  }

  function cartView() {
    title.textContent = 'سلتك'; back.hidden = true;
    const tableChip = table ? `<p class="table-chip"><b>طاولة ${table}</b> اطلب من مكانك، ويوصلك الطلب على طاولتك.</p>` : '';
    const closed = !S.open ? `<p class="notice">${S.closedReason === 'hours' && S.hours ? `نستقبل الطلبات من ${S.hours.open} إلى ${S.hours.close}. تقدر تجهّز سلتك الحين.` : 'استقبال الطلبات يبدأ مع الافتتاح. تقدر تجهّز سلتك من الحين.'}</p>` : '';
    const recent = ls.get('ann-orders', []).filter(o => Date.now() - o.at < 6 * 3600e3)[0];
    const last = recent ? `<a class="last-order" href="/order?o=${encodeURIComponent(recent.id)}">تابع طلبك #${recent.number}</a>` : '';
    if (!cart.length) {
      body.innerHTML = `${tableChip}${last}<div class="empty"><svg viewBox="0 0 64 64" aria-hidden="true"><path d="M14 22h36l-3 30a4 4 0 0 1-4 3.6H21a4 4 0 0 1-4-3.6L14 22Z" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/><path d="M24 26v-6a8 8 0 0 1 16 0v6" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg><h3>سلتك فاضية</h3><p>اختر مشروبك أو حلاك من القائمة.</p></div>${loyaltyBar()}`;
      foot.innerHTML = `<button class="cta" type="button" data-go-menu>تصفّح القائمة</button>`;
      return;
    }
    body.innerHTML = tableChip + closed + last + `<ul class="lines">` + cart.map(l => {
      const it = MENU.get(l.id); if (!it) return '';
      const out = isOut(l.id), unit = unitOf(l.id, l.opts), ot = optText(l.id, l.opts);
      return `<li class="line${out ? ' is-out' : ''}">
        <div class="l-main">
          <b>${esc(it.name)}${it.variant ? ` <em class="tag ${it.variant === 'بارد' ? 'cold' : 'hot'}">${esc(it.variant)}</em>` : ''}</b>
          ${ot ? `<span class="l-opts">${esc(ot)}</span>` : ''}
          ${l.note ? `<span class="l-opts">ملاحظة: ${esc(l.note)}</span>` : ''}
          <span class="l-price">${money(unit)} ر.س${out ? ' · نفد، احذفه' : ''}</span>
          ${it.opts && it.opts.length ? `<button type="button" class="l-edit" data-edit="${esc(l.key)}">تعديل الخيارات</button>` : ''}
        </div>
        <span class="stepper sm" role="group" aria-label="كمية ${esc(itemName(it))}">
          <button type="button" data-lplus="${esc(l.key)}" aria-label="زيادة">${ICON_PLUS}</button><output>${l.qty}</output>
          <button type="button" data-lminus="${esc(l.key)}" aria-label="تقليل">${ICON_MINUS}</button></span>
        <span class="l-total">${money(unit * l.qty)} ر.س</span>
      </li>`;
    }).join('') + `</ul>` + loyaltyBar();
    const hasOut = cart.some(l => isOut(l.id));
    foot.innerHTML = `<div class="sum"><span>المجموع</span><b>${money(subtotal())} ر.س</b></div>
      <button class="cta" type="button" data-checkout ${!S.open || hasOut ? 'disabled' : ''}>متابعة الطلب</button>`;
  }

  const typesAvailable = () => (table ? ['dinein', 'pickup', 'delivery'] : ['pickup', 'delivery', 'dinein']).filter(t => S.types[t]);

  function rewardValue() {
    if (!form.useReward || !ACC || !ACC.rewards) return 0;
    const drinks = cart.filter(l => (MENU.get(l.id) || {}).drink !== false).map(l => unitOf(l.id, l.opts));
    if (!drinks.length) return 0;
    const best = Math.max(...drinks);
    return Math.min(best, Number(S.loyalty.cap) || best);
  }
  function totals() {
    const sub = subtotal();
    const rw = rewardValue();
    const pr = promo ? Math.min(promo.discount, Math.max(0, sub - rw)) : 0;
    const fee = form.type === 'delivery' ? Number(S.deliveryFee) || 0 : 0;
    return { sub, rw, pr, fee, total: Math.max(0, sub - rw - pr) + fee };
  }

  function checkoutView() {
    title.textContent = 'إتمام الطلب'; back.hidden = false;
    const types = typesAvailable();
    if (!types.includes(form.type)) form.type = types[0];
    const t = form.type, T = totals();
    const payOpts = [];
    if (S.payOnline) payOpts.push('online');
    if (ACC && ACC.balance > 0) payOpts.push('wallet');
    if (S.payAtCounter) payOpts.push('counter');
    if (!payOpts.includes(form.pay)) form.pay = payOpts.includes('counter') ? 'counter' : payOpts[0];
    const label = { dinein: 'داخل المحل', pickup: 'استلام من المحل', delivery: 'توصيل' };
    const hint = { dinein: 'من طاولتك، والكاشير يجهّزه لك', pickup: 'نجهّزه وتمر تاخذه', delivery: 'يوصلك لين بابك' };
    const branches = S.branches || [];
    if (!form.branch || !branches.some(b => b.id === form.branch)) form.branch = ssGet('ann-branch') && branches.some(b => b.id === ssGet('ann-branch')) ? ssGet('ann-branch') : (branches[0] || {}).id;
    const walletLow = ACC && ACC.balance < T.total;
    body.innerHTML = `<form id="checkout" class="co" novalidate>
      ${branches.length > 1 ? `<label class="fld"><span>الفرع</span><select name="branch">${branches.map(b => `<option value="${esc(b.id)}" ${b.id === form.branch ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</select></label>` : ''}
      <fieldset class="seg-wrap"><legend>كيف تبي طلبك؟</legend>
        <div class="seg">${types.map(x => `<label class="${x === t ? 'on' : ''}"><input type="radio" name="type" value="${x}" ${x === t ? 'checked' : ''}><b>${label[x]}</b><small>${hint[x]}</small></label>`).join('')}</div>
      </fieldset>
      ${t === 'dinein' ? `
        <label class="fld"><span>رقم الطاولة</span><input name="table" inputmode="numeric" maxlength="3" value="${table || ''}" ${table ? 'readonly' : ''} required placeholder="مكتوب على الطاولة"></label>
        <label class="fld"><span>اسمك <small>(اختياري)</small></span><input name="name" maxlength="40" autocomplete="given-name" value="${esc(form.name)}" placeholder="عشان نناديك باسمك"></label>` : `
        <label class="fld"><span>اسمك</span><input name="name" maxlength="40" autocomplete="name" value="${esc(form.name)}" required></label>
        <label class="fld"><span>رقم الجوال</span><input name="phone" type="tel" inputmode="tel" autocomplete="tel" dir="ltr" maxlength="14" value="${esc(form.phone)}" placeholder="05xxxxxxxx" required></label>`}
      ${t === 'pickup' ? `<label class="fld"><span>متى تمر؟</span><select name="when">${[['asap', 'بأقرب وقت'], ['15', 'بعد ١٥ دقيقة'], ['30', 'بعد ٣٠ دقيقة'], ['45', 'بعد ٤٥ دقيقة'], ['60', 'بعد ساعة']].map(([v, l]) => `<option value="${v}" ${form.when === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>` : ''}
      ${t === 'delivery' ? `
        <label class="fld"><span>العنوان</span><textarea name="address" rows="2" maxlength="200" placeholder="الحي، الشارع، أقرب معلم">${esc(form.address)}</textarea></label>
        <button type="button" class="loc-btn${form.location ? ' done' : ''}" data-locate>${form.location ? 'تم تحديد موقعك ✓' : 'شارك موقعي الحالي'}</button>` : ''}
      <label class="fld"><span>ملاحظات للطلب <small>(اختياري)</small></span><input name="notes" maxlength="200" value="${esc(form.notes)}" placeholder="أي شي تبينا نعرفه"></label>
      ${ACC && ACC.rewards > 0 && S.loyalty.enabled ? `<label class="reward-opt ${form.useReward ? 'on' : ''}"><input type="checkbox" name="useReward" ${form.useReward ? 'checked' : ''}><span><b>استخدم مشروبك المجاني</b><small>نخصم أغلى مشروب في السلة${S.loyalty.cap ? ` (حتى ${S.loyalty.cap} ر.س)` : ''}</small></span></label>` : ''}
      <div class="promo-row">
        <label class="fld"><span>كوبون خصم <small>(اختياري)</small></span><input name="promo" dir="ltr" maxlength="20" value="${esc(promo ? promo.code : (form.promoCode || ''))}" placeholder="ANN10" autocapitalize="characters"></label>
        <button type="button" class="btn btn-line promo-btn" data-promo>${promo ? 'إلغاء' : 'تطبيق'}</button>
      </div>
      ${promo ? `<p class="promo-ok">✓ ${esc(promo.label)}</p>` : ''}
      <fieldset class="pay"><legend>الدفع</legend>
        ${payOpts.map(p => {
          const lab = p === 'online' ? ['ادفع الآن', 'Apple Pay، مدى، أو بطاقة ائتمانية'] : p === 'wallet' ? ['من رصيد محفظتك', `رصيدك ${money(ACC.balance)} ر.س${walletLow ? ' · ما يكفي هذا الطلب' : ''}`] : [t === 'dinein' ? 'ادفع عند الكاشير' : 'الدفع عند الاستلام', 'كاش أو شبكة'];
          return `<label class="pay-opt ${p === form.pay ? 'on' : ''}${p === 'wallet' && walletLow ? ' dim' : ''}"><input type="radio" name="pay" value="${p}" ${p === form.pay ? 'checked' : ''} ${p === 'wallet' && walletLow ? 'disabled' : ''}><span><b>${lab[0]}</b><small>${lab[1]}</small></span></label>`;
        }).join('')}
        ${!S.payOnline ? '<p class="soon-pay">الدفع الإلكتروني (Apple Pay ومدى) يتفعّل قريبًا.</p>' : ''}
      </fieldset>
      <p class="err" id="coErr" role="alert" hidden></p>
    </form>`;
    foot.innerHTML = `<div class="sum-rows">
        <div><span>المجموع</span><span>${money(T.sub)} ر.س</span></div>
        ${T.rw ? `<div class="disc"><span>مشروب مجاني</span><span>-${money(T.rw)} ر.س</span></div>` : ''}
        ${T.pr ? `<div class="disc"><span>الكوبون</span><span>-${money(T.pr)} ر.س</span></div>` : ''}
        ${t === 'delivery' ? `<div><span>التوصيل</span><span>${T.fee ? money(T.fee) + ' ر.س' : 'يحدده المحل'}</span></div>` : ''}
        <div class="total"><span>الإجمالي</span><b>${money(T.total)} ر.س</b></div>
      </div>
      <button class="cta" type="submit" form="checkout" id="placeBtn">${form.pay === 'online' ? 'أكّد وادفع' : 'أكّد الطلب'} · ${money(T.total)} ر.س</button>`;
  }

  function paint() {
    paintMenu(); paintBadges();
    if (drawer.classList.contains('open')) (view === 'checkout' ? checkoutView : cartView)();
  }

  async function refreshPromo() {
    if (!promo) return;
    const r = await A.api('POST', 'promo/check', { code: promo.code, subtotal: Math.max(0, subtotal() - rewardValue()) });
    if (r.ok) promo = r.data; else { promo = null; A.toast(r.data.message || 'الكوبون غير صالح.'); }
    if (view === 'checkout') paint();
  }

  // ---------- events ----------
  document.addEventListener('click', e => {
    const add = e.target.closest('[data-add]'), minus = e.target.closest('[data-minus]');
    if (add) {
      e.preventDefault(); const id = add.dataset.add; const it = MENU.get(id);
      if (!it) return;
      if (it.opts && it.opts.length) openSheet(id); else addLine(id, {}, 1, '');
      return;
    }
    if (minus) { e.preventDefault(); minusItem(minus.dataset.minus); return; }
    const lp = e.target.closest('[data-lplus]'), lm = e.target.closest('[data-lminus]'), ed = e.target.closest('[data-edit]');
    if (lp) { const l = cart.find(x => x.key === lp.dataset.lplus); if (l) setLineQty(l.key, l.qty + 1); return; }
    if (lm) { const l = cart.find(x => x.key === lm.dataset.lminus); if (l) setLineQty(l.key, l.qty - 1); return; }
    if (ed) { const l = cart.find(x => x.key === ed.dataset.edit); if (l) openSheet(l.id, l.key); return; }
    if (e.target.closest('[data-open-cart]')) { e.preventDefault(); openCart(); return; }
    if (e.target.closest('[data-close-cart]')) { e.preventDefault(); closeCart(); return; }
    if (e.target.closest('[data-go-menu]')) { closeCart(); location.hash = '#menu'; return; }
    if (e.target.closest('[data-checkout]')) { view = 'checkout'; paint(); body.scrollTop = 0; refreshPromo(); return; }
    if (e.target.closest('[data-locate]')) { locate(e.target.closest('[data-locate]')); return; }
    if (e.target.closest('[data-promo]')) { applyPromo(); return; }
  });
  back.addEventListener('click', () => { view = 'cart'; paint(); });
  document.addEventListener('keydown', e => {
    if (!drawer.classList.contains('open') || (sheetEl && !sheetEl.hidden)) return;
    if (e.key === 'Escape') closeCart();
    if (e.key === 'Tab') {
      const f = $$('button:not([disabled]):not([hidden]),input:not([type=radio]):not([type=checkbox]),input[type=radio]:checked,input[type=checkbox],select,textarea,a[href]', drawer).filter(x => x.offsetParent !== null);
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    }
  });
  body.addEventListener('input', e => {
    const f = e.target.form; if (!f || f.id !== 'checkout') return;
    if (['name', 'phone', 'address', 'notes'].includes(e.target.name)) { form[e.target.name] = e.target.value; saveForm(); }
    if (e.target.name === 'promo') form.promoCode = e.target.value;
  });
  body.addEventListener('change', e => {
    const f = e.target.form; if (!f || f.id !== 'checkout') return;
    if (['type', 'pay', 'branch'].includes(e.target.name)) { form[e.target.name] = e.target.value; saveForm(); paint(); }
    if (e.target.name === 'when') { form.when = e.target.value; saveForm(); }
    if (e.target.name === 'useReward') { form.useReward = e.target.checked; refreshPromo(); paint(); }
  });
  body.addEventListener('submit', e => { if (e.target.id === 'checkout') { e.preventDefault(); place(); } });
  foot.addEventListener('click', e => { if (e.target.id === 'placeBtn') { e.preventDefault(); place(); } });

  async function applyPromo() {
    if (promo) { promo = null; form.promoCode = ''; paint(); return; }
    const inp = $('#checkout [name="promo"]'); const code = (inp && inp.value || '').trim();
    if (!code) { showErr('اكتب الكوبون.', 'promo'); return; }
    const r = await A.api('POST', 'promo/check', { code, subtotal: Math.max(0, subtotal() - rewardValue()) });
    if (!r.ok) { showErr(r.data.message || 'الكوبون غير صالح.', 'promo'); return; }
    promo = r.data; paint();
  }

  function locate(btn) {
    if (!navigator.geolocation) { A.toast('جهازك ما يدعم تحديد الموقع، اكتب العنوان.'); return; }
    btn.disabled = true; btn.textContent = 'نحدد موقعك…';
    navigator.geolocation.getCurrentPosition(p => {
      form.location = { lat: p.coords.latitude, lng: p.coords.longitude };
      btn.disabled = false; btn.classList.add('done'); btn.textContent = 'تم تحديد موقعك ✓';
    }, () => { btn.disabled = false; btn.textContent = 'شارك موقعي الحالي'; A.toast('ما قدرنا نحدد موقعك، اكتب العنوان.'); }, { enableHighAccuracy: true, timeout: 10000 });
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
    const latin = A.latin;
    if (form.type === 'dinein' && !(parseInt(latin(v.table), 10) > 0)) return showErr('اكتب رقم الطاولة.', 'table');
    if (form.type !== 'dinein') {
      if (String(v.name || '').trim().length < 2) return showErr('اكتب اسمك.', 'name');
      if (!/^(?:\+?966|0)?5\d{8}$/.test(latin(v.phone).replace(/[\s-]/g, ''))) return showErr('رقم الجوال غير صحيح، اكتبه مثل 05xxxxxxxx.', 'phone');
    }
    if (form.type === 'delivery' && String(v.address || '').trim().length < 6 && !form.location) return showErr('اكتب عنوانك أو شارك موقعك.', 'address');

    placing = true;
    const btn = $('#placeBtn'); const old = btn.textContent; btn.disabled = true; btn.textContent = 'نرسل طلبك…';
    try {
      if (!A.token()) await A.ensureAccount({ name: v.name, phone: v.phone });
      const r = await A.api('POST', 'order', {
        type: form.type, branch: form.branch, table: v.table, name: v.name, phone: v.phone, when: v.when, address: v.address,
        location: form.location, notes: v.notes, pay: form.pay, useReward: !!form.useReward, promo: promo ? promo.code : '',
        items: cart.map(l => ({ id: l.id, qty: l.qty, note: l.note, opts: l.opts }))
      });
      if (!r.ok) { showErr(r.data.message || 'تعذر إرسال الطلب، جرّب مرة ثانية.', r.data.error); if (r.data.error === 'promo') { promo = null; } return; }
      const o = r.data.order;
      ls.set('ann-order-' + o.id, Object.assign({}, o, { stored: r.data.stored }));
      const list = ls.get('ann-orders', []).filter(x => x.id !== o.id);
      list.unshift({ id: o.id, number: o.number, at: Date.now() }); ls.set('ann-orders', list.slice(0, 20));
      cart = []; save(); promo = null; form.useReward = false;
      location.href = `/order?o=${encodeURIComponent(o.id)}&new=1`;
    } finally {
      placing = false; if (btn && document.body.contains(btn)) { btn.disabled = false; btn.textContent = old; }
    }
  }

  // home page stamp card: the visitor's real stamps once they have an account
  function paintStampCard() {
    const grid = $('.stampcard .sc-grid'); if (!grid || !S.loyalty) return;
    const sec = $('#rewards');
    if (!S.loyalty.enabled) { const c = $('.stampcard'); if (c) c.hidden = true; const h = $('#rw-title'); if (h) h.textContent = 'آن في جوالك'; return; }
    const per = Math.max(2, Number(S.loyalty.stamps) || 8);
    const CUP = '<svg viewBox="0 0 24 24" fill="none"><path d="M5 9h10v5.2A4.8 4.8 0 0 1 10.2 19H9.8A4.8 4.8 0 0 1 5 14.2V9Z" stroke="currentColor" stroke-width="2"/><path d="M15 10.5h1.7a2.3 2.3 0 0 1 0 4.6H15" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
    const have = ACC ? Math.min(ACC.stamps || 0, per) : Math.min(5, per - 1);
    grid.style.gridTemplateColumns = `repeat(${per + 1 <= 9 ? 3 : per + 1 <= 12 ? 4 : 5},1fr)`;
    grid.innerHTML = Array.from({ length: per }, (_, i) => i < have ? `<i class="on${ACC ? ' pop' : ''}" style="animation-delay:${i * 60}ms">${CUP}</i>` : `<i>${A.ar(i + 1)}</i>`).join('') + '<i class="free">مجاني</i>';
    const foot = $('.stampcard .sc-foot');
    if (foot) foot.textContent = ACC && ACC.rewards ? `عندك ${ACC.rewards === 1 ? 'مشروب مجاني' : A.ar(ACC.rewards) + ' مشروبات مجانية'}، استخدمه من السلة` : `باقي ${A.ar(per - have)} ${per - have === 1 ? 'ختم' : 'أختام'} على مشروبك المجاني`;
    if (per !== 8) { const h = $('#rw-title'); if (h) h.textContent = `كل ${A.ar(per)} مشروبات، الجاي علينا`; const p = sec && sec.querySelector('.rw-copy > p'); if (p) p.textContent = `كل مشروب تطلبه من آن يضيف ختم في بطاقتك. اكتمل ${A.ar(per)} أختام؟ مشروبك الجاي مجاني، تستخدمه بضغطة وقت الطلب.`; }
  }

  // ---------- boot ----------
  Promise.all([A.menu(), A.settings(true), A.token() ? A.api('GET', 'account') : Promise.resolve(null)]).then(([m, s, a]) => {
    if (m && m.items) { MENU = new Map(m.items.map(i => [i.id, i])); GROUPS = m.optionGroups || {}; }
    if (s) S = Object.assign(S, s);
    if (a && a.ok) ACC = a.data.account;
    cart = cart.filter(l => MENU.has(l.id)).map(l => Object.assign(l, { opts: normOpts(MENU.get(l.id), l.opts) }));
    // reorder from account page
    const re = ssGet('ann-reorder');
    if (re) { ssSet('ann-reorder', null); try { JSON.parse(re).forEach(l => MENU.has(l.id) && addLine(l.id, l.opts || {}, l.qty || 1, l.note || '')); } catch {} }
    paint(); paintStampCard();
    if (table && !ssGet('ann-table-greeted')) { ssSet('ann-table-greeted', '1'); A.toast(`أهلًا بك! أنت على طاولة ${table}، اطلب من القائمة.`); }
    if (qp.get('cart') === '1' || re) openCart();
  });
})();
