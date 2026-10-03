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
