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
  const home = $('[data-nav-home]');
  if (home) setActive(home);
}

function closeSheets(activateHomeAfter = false) {
  sheets.forEach(sheet => {
    sheet.classList.remove('is-open');
    sheet.setAttribute('aria-hidden', 'true');
  });

  if (sheetBackdrop) {
    sheetBackdrop.classList.remove('is-visible');
    sheetBackdrop.style.pointerEvents = 'none';
    sheetBackdrop.hidden = true;
  }

  if (activateHomeAfter) activateHome();
}

function openSheet(name, trigger) {
  closeChat(false);
  closeSheets(false);

  const sheet = $('.ann-sheet[data-sheet="' + name + '"]');
  if (!sheet) return;

  sheet.hidden = false;
  sheet.setAttribute('aria-hidden', 'false');
  sheet.classList.add('is-open');

  if (sheetBackdrop) {
    sheetBackdrop.hidden = false;
    sheetBackdrop.style.pointerEvents = 'auto';
    requestAnimationFrame(() => sheetBackdrop.classList.add('is-visible'));
  }

  if (trigger) setActive(trigger);
}

function openChat(trigger) {
  if (!panel) return;

  closeSheets(false);
  lastTrigger = trigger || document.activeElement;

  panel.classList.add('open');
  panel.setAttribute('aria-hidden', 'false');

  if (chatBackdrop) {
    chatBackdrop.hidden = false;
    chatBackdrop.style.pointerEvents = 'auto';
    requestAnimationFrame(() => chatBackdrop.classList.add('visible'));
  }

  document.body.classList.add('chat-open');

  const assistant = $('.ann-nav-assistant');
  if (assistant) setActive(assistant);

  window.setTimeout(() => input?.focus(), 100);
}

function closeChat(activateHomeAfter = true) {
  if (!panel) return;

  panel.classList.remove('open');
  panel.setAttribute('aria-hidden', 'true');

  if (chatBackdrop) {
    chatBackdrop.classList.remove('visible');
    chatBackdrop.style.pointerEvents = 'none';
    chatBackdrop.hidden = true;
  }

  document.body.classList.remove('chat-open');

  if (activateHomeAfter) activateHome();

  if (lastTrigger && typeof lastTrigger.focus === 'function') {
    window.setTimeout(() => lastTrigger.focus(), 0);
  }
}

document.addEventListener('click', event => {
  const openSheetBtn = event.target.closest('[data-open-sheet]');
  if (openSheetBtn) {
    event.preventDefault();
    openSheet(openSheetBtn.dataset.openSheet, openSheetBtn);
    return;
  }

  const closeSheetBtn = event.target.closest('[data-close-sheet]');
  if (closeSheetBtn) {
    event.preventDefault();
    closeSheets(true);
    return;
  }

  const homeBtn = event.target.closest('[data-nav-home]');
  if (homeBtn) {
    event.preventDefault();
    closeSheets(false);
    closeChat(false);
    setActive(homeBtn);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }

  const openChatBtn = event.target.closest('[data-open-chat]');
  if (openChatBtn) {
    event.preventDefault();
    openChat(openChatBtn);
    return;
  }

  const closeChatBtn = event.target.closest('[data-close-chat]');
  if (closeChatBtn) {
    event.preventDefault();
    closeChat(true);
  }
});

document.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  if (panel?.classList.contains('open')) closeChat(true);
  else if (sheets.some(sheet => sheet.classList.contains('is-open'))) closeSheets(true);
});

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

// Defensive startup: hidden overlays must never intercept taps.
if (sheetBackdrop && !sheetBackdrop.classList.contains('is-visible')) {
  sheetBackdrop.hidden = true;
  sheetBackdrop.style.pointerEvents = 'none';
}
if (chatBackdrop && !chatBackdrop.classList.contains('visible')) {
  chatBackdrop.hidden = true;
  chatBackdrop.style.pointerEvents = 'none';
}


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

  // Small tactile confirmation on supported phones.
  document.addEventListener('pointerup', event => {
    if (!event.target.closest('.ann-nav-item,.cta,.ann-sheet-cta')) return;
    if (navigator.vibrate && matchMedia('(pointer: coarse)').matches) {
      try { navigator.vibrate(8); } catch {}
    }
  }, {passive:true});

  // Improve sheet semantics/focus without changing visuals.
  const focusables = root => [...root.querySelectorAll(
    'button:not([disabled]),a[href],input:not([disabled]),[tabindex]:not([tabindex="-1"])'
  )].filter(el => !el.hidden && el.offsetParent !== null);

  document.addEventListener('keydown', event => {
    if (event.key !== 'Tab') return;
    const openSurface = document.querySelector('.ann-sheet.is-open') ||
      document.querySelector('.chat-panel.open');
    if (!openSurface) return;
    const list = focusables(openSurface);
    if (!list.length) return;
    const first = list[0], last = list[list.length-1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault(); last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault(); first.focus();
    }
  });

  document.addEventListener('click', event => {
    const trigger = event.target.closest('[data-open-sheet]');
    if (!trigger) return;
    trigger.setAttribute('aria-expanded','true');
    const id = trigger.getAttribute('aria-controls');
    const sheet = id && document.getElementById(id);
    requestAnimationFrame(() => sheet?.querySelector('.ann-sheet-close')?.focus());
  });

  document.addEventListener('click', event => {
    if (!event.target.closest('[data-close-sheet]')) return;
    document.querySelectorAll('[data-open-sheet][aria-expanded="true"]')
      .forEach(el => el.setAttribute('aria-expanded','false'));
  });
})();
