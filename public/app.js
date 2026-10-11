const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];

const panel = $('#chatPanel');
const chatBackdrop = $('.chat-backdrop');
const form = $('#form');
const input = $('#input');
const messages = $('#messages');
const submitButton = form?.querySelector('button[type="submit"]');
const sheetBackdrop = $('.ann-sheet-backdrop');
const sheets = $$('.ann-sheet');
const navItems = $$('.ann-nav-item');
const pageContent = $('.ann-shell');
let activeSurface = null;
let lastTrigger = null;
let sending = false;

function setActive(button) {
  navItems.forEach(item => {
    const active = item === button;
    item.classList.toggle('is-active', active);
    if (active) item.setAttribute('aria-current', 'page');
    else item.removeAttribute('aria-current');
  });
}

function activateHome() {
  setActive($('.ann-nav-item[data-nav-home]'));
}

function closeSurface(restoreFocus = true) {
  [panel, ...sheets].filter(Boolean).forEach(surface => {
    surface.classList.remove('is-open', 'open');
    surface.setAttribute('aria-hidden', 'true');
    surface.inert = true;
    surface.hidden = true;
  });
  [sheetBackdrop, chatBackdrop].filter(Boolean).forEach(backdrop => {
    backdrop.classList.remove('is-visible', 'visible');
    backdrop.hidden = true;
  });
  $$('[data-open-sheet]').forEach(button => button.setAttribute('aria-expanded', 'false'));
  if (pageContent) pageContent.inert = false;
  document.body.classList.remove('overlay-open', 'chat-open');
  activeSurface = null;
  activateHome();
  if (restoreFocus && lastTrigger?.isConnected && lastTrigger.getClientRects().length) lastTrigger.focus();
}

function showSurface(surface, trigger, isChat = false) {
  if (!surface) return;
  // Retain the original page trigger when moving from one dialog to another.
  if (!activeSurface || !activeSurface.contains(trigger)) lastTrigger = trigger || document.activeElement;
  closeSurface(false);
  activeSurface = surface;
  surface.hidden = false;
  surface.inert = false;
  surface.setAttribute('aria-hidden', 'false');
  surface.classList.add(isChat ? 'open' : 'is-open');
  const backdrop = isChat ? chatBackdrop : sheetBackdrop;
  if (backdrop) {
    backdrop.hidden = false;
    backdrop.classList.add(isChat ? 'visible' : 'is-visible');
  }
  if (pageContent) pageContent.inert = true;
  document.body.classList.add('overlay-open');
  if (isChat) {
    setActive($('.ann-nav-assistant'));
    input?.focus();
  } else {
    const name = surface.dataset.sheet;
    $$('[data-open-sheet]').forEach(button => button.setAttribute('aria-expanded', String(button.dataset.openSheet === name)));
    setActive($('.ann-nav-item[data-open-sheet="' + name + '"]'));
    surface.focus();
  }
}

document.addEventListener('click', event => {
  const sheetButton = event.target.closest('[data-open-sheet]');
  if (sheetButton) {
    event.preventDefault();
    const surface = sheets.find(sheet => sheet.dataset.sheet === sheetButton.dataset.openSheet);
    showSurface(surface, sheetButton);
    return;
  }
  if (event.target.closest('[data-close-sheet], [data-close-chat]')) {
    event.preventDefault();
    closeSurface();
    return;
  }
  const chatButton = event.target.closest('[data-open-chat]');
  if (chatButton) {
    event.preventDefault();
    showSurface(panel, chatButton, true);
    return;
  }
  if (event.target.closest('[data-nav-home]')) {
    event.preventDefault();
    closeSurface(false);
    window.scrollTo({ top: 0, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  }
});

document.addEventListener('keydown', event => {
  if (!activeSurface) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    closeSurface();
    return;
  }
  if (event.key !== 'Tab') return;
  const list = $$('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])', activeSurface)
    .filter(element => element.getClientRects().length && !element.closest('[hidden], [inert]'));
  if (!list.length) {
    event.preventDefault();
    activeSurface.focus();
    return;
  }
  const first = list[0], last = list[list.length - 1];
  if (event.shiftKey && (document.activeElement === first || document.activeElement === activeSurface)) {
    event.preventDefault(); last.focus();
  } else if (!event.shiftKey && (document.activeElement === last || !activeSurface.contains(document.activeElement))) {
    event.preventDefault(); first.focus();
  }
});

closeSurface(false);

function addMessage(text, who = 'user', extraClass = '') {
  if (!messages) return null;

  const wrap = document.createElement('div');
  wrap.className = ['msg', who, extraClass].filter(Boolean).join(' ');

  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.textContent = text;

  wrap.appendChild(bubble);
  messages.appendChild(wrap);
  messages.scrollTop = messages.scrollHeight;
  return wrap;
}

function addTyping() {
  const wrap = document.createElement('div');
  wrap.className = 'msg bot';
  wrap.setAttribute('aria-label', 'جاري الكتابة');

  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.textContent = '…';

  wrap.appendChild(bubble);
  messages.appendChild(wrap);
  messages.scrollTop = messages.scrollHeight;
  return wrap;
}

async function send(text) {
  text = String(text || '').trim();
  if (!text || sending) return;

  sending = true;
  addMessage(text, 'user');
  if (input) input.value = '';
  if (submitButton) submitButton.disabled = true;

  const typing = addTyping();

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text })
    });

    const data = await response.json().catch(() => ({}));
    typing?.remove();

    if (!response.ok) {
      addMessage('تعذر عليّ الرد الآن. جرّب مرة ثانية بعد لحظات.', 'bot', 'error');
      return;
    }

    addMessage(data.reply || 'ما عندي معلومة مؤكدة عن هذا السؤال حاليًا.', 'bot');
  } catch {
    typing?.remove();
    addMessage('صار انقطاع بسيط في الاتصال. جرّب مرة ثانية.', 'bot', 'error');
  } finally {
    sending = false;
    if (submitButton) submitButton.disabled = false;
    input?.focus();
  }
}

form?.addEventListener('submit', event => {
  event.preventDefault();
  send(input?.value);
});

document.addEventListener('click', event => {
  const quick = event.target.closest('.quick button');
  if (quick) send(quick.textContent);
});

// ===== ANN UI/UX PRO MAX INTERACTIONS =====
(() => {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const finePointer = window.matchMedia('(pointer: fine)').matches;
  const desktop = document.querySelector('.desktop-concept');
  let raf = 0;
  let tx = 0, ty = 0, cx = 0, cy = 0;

  const render = () => {
    raf = 0;
    cx += (tx - cx) * .09;
    cy += (ty - cy) * .09;
    desktop?.style.setProperty('--ann-parallax-x', cx.toFixed(2) + 'px');
    desktop?.style.setProperty('--ann-parallax-y', cy.toFixed(2) + 'px');
    if (Math.abs(tx-cx) > .08 || Math.abs(ty-cy) > .08) raf = requestAnimationFrame(render);
  };

  if (desktop && !reduceMotion && finePointer) {
    desktop.addEventListener('pointermove', event => {
      const r = desktop.getBoundingClientRect();
      const nx = ((event.clientX-r.left)/r.width)-.5;
      const ny = ((event.clientY-r.top)/r.height)-.5;
      tx = nx * 5;
      ty = ny * 3;
      desktop.style.setProperty('--ann-pointer-x', ((nx+.5)*100).toFixed(1)+'%');
      desktop.style.setProperty('--ann-pointer-y', ((ny+.5)*100).toFixed(1)+'%');
      if (!raf) raf = requestAnimationFrame(render);
    }, {passive:true});

    desktop.addEventListener('pointerleave', () => {
      tx = 0; ty = 0;
      desktop.style.setProperty('--ann-pointer-x','50%');
      desktop.style.setProperty('--ann-pointer-y','42%');
      if (!raf) raf = requestAnimationFrame(render);
    }, {passive:true});
  }

})();
