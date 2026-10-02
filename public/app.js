const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];

const panel = $('#chatPanel');
const backdrop = $('.chat-backdrop');
const form = $('#form');
const input = $('#input');
const messages = $('#messages');
const submitButton = form?.querySelector('button[type="submit"]');

let lastTrigger = null;
let sending = false;

function openChat(trigger) {
  if (!panel) return;
  lastTrigger = trigger || document.activeElement;
  panel.classList.add('open');
  panel.setAttribute('aria-hidden', 'false');
  if (backdrop) {
    backdrop.hidden = false;
    requestAnimationFrame(() => backdrop.classList.add('visible'));
  }
  document.body.classList.add('chat-open');
  window.setTimeout(() => input?.focus(), 120);
}

function closeChat() {
  if (!panel) return;
  panel.classList.remove('open');
  panel.setAttribute('aria-hidden', 'true');
  backdrop?.classList.remove('visible');
  document.body.classList.remove('chat-open');
  window.setTimeout(() => {
    if (backdrop) backdrop.hidden = true;
    if (lastTrigger && typeof lastTrigger.focus === 'function') lastTrigger.focus();
  }, 220);
}

$$('[data-open-chat]').forEach(btn => btn.addEventListener('click', () => openChat(btn)));
$$('[data-close-chat]').forEach(btn => btn.addEventListener('click', closeChat));

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && panel?.classList.contains('open')) closeChat();
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
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({message: text})
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

form?.addEventListener('submit', e => {
  e.preventDefault();
  send(input?.value);
});

$$('.quick button').forEach(btn => {
  btn.addEventListener('click', () => send(btn.textContent));
});
