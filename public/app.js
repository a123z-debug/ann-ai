const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];

const panel = $('#chatPanel');
const chatBackdrop = $('.chat-backdrop');
const form = $('#form');
const input = $('#input');
const messages = $('#messages');
const submitButton = form?.querySelector('button[type="submit"]');
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

let lastTrigger = null;
let sending = false;

/* ---------- chat panel ---------- */
function openChat(trigger) {
  if (!panel) return;
  lastTrigger = trigger || document.activeElement;
  panel.classList.add('open');
  panel.setAttribute('aria-hidden', 'false');
  if (chatBackdrop) {
    chatBackdrop.hidden = false;
    chatBackdrop.style.pointerEvents = 'auto';
    requestAnimationFrame(() => chatBackdrop.classList.add('visible'));
  }
  document.body.classList.add('chat-open');
  window.setTimeout(() => input?.focus(), 120);
}

function closeChat() {
  if (!panel) return;
  panel.classList.remove('open');
  panel.setAttribute('aria-hidden', 'true');
  if (chatBackdrop) {
    chatBackdrop.classList.remove('visible');
    chatBackdrop.style.pointerEvents = 'none';
    chatBackdrop.hidden = true;
  }
  document.body.classList.remove('chat-open');
  if (lastTrigger && typeof lastTrigger.focus === 'function') {
    window.setTimeout(() => lastTrigger.focus(), 0);
  }
}

document.addEventListener('click', event => {
  if (event.target.closest('[data-open-chat]')) {
    event.preventDefault();
    openChat(event.target.closest('[data-open-chat]'));
    return;
  }
  if (event.target.closest('[data-close-chat]')) {
    event.preventDefault();
    closeChat();
    return;
  }
  const quick = event.target.closest('.quick button');
  if (quick) send(quick.textContent);
});

document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && panel?.classList.contains('open')) closeChat();
  if (event.key !== 'Tab' || !panel?.classList.contains('open')) return;
  const list = $$('button:not([disabled]),input:not([disabled])', panel).filter(el => el.offsetParent !== null);
  if (!list.length) return;
  const first = list[0], last = list[list.length - 1];
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
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
  const wrap = addMessage('…', 'bot');
  wrap?.setAttribute('aria-label', 'جاري الكتابة');
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

if (chatBackdrop && !chatBackdrop.classList.contains('visible')) {
  chatBackdrop.hidden = true;
  chatBackdrop.style.pointerEvents = 'none';
}

/* ---------- page motion ---------- */
(() => {
  const topbar = $('#topbar');
  const heroImg = $('.hero-img');
  const hero = $('.hero');

  // Reveal on scroll
  const items = $$('[data-reveal]');
  if ('IntersectionObserver' in window && !reduceMotion) {
    const io = new IntersectionObserver(entries => {
      entries.forEach(e => {
        if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
      });
    }, { threshold: .15, rootMargin: '0px 0px -6% 0px' });
    items.forEach(el => io.observe(el));
  } else {
    items.forEach(el => el.classList.add('in'));
  }

  // Header state + subtle hero parallax
  let ticking = false;
  const onScroll = () => {
    ticking = false;
    const y = window.scrollY;
    topbar?.classList.toggle('is-scrolled', y > 40);
    if (!reduceMotion && hero && y < hero.offsetHeight) {
      if (heroImg) heroImg.style.translate = '0 ' + (y * 0.12).toFixed(1) + 'px';
    }
  };
  window.addEventListener('scroll', () => {
    if (!ticking) { ticking = true; requestAnimationFrame(onScroll); }
  }, { passive: true });
  onScroll();

  // Highlight the current section in both navs
  const links = $$('.links a, .bottom-nav a');
  const sections = ['about', 'experience', 'menu', 'gallery', 'location']
    .map(id => document.getElementById(id)).filter(Boolean);
  if (hero) { hero.id = hero.id || 'hero'; sections.unshift(hero); }
  if ('IntersectionObserver' in window) {
    const spy = new IntersectionObserver(entries => {
      entries.forEach(e => {
        if (!e.isIntersecting) return;
        const id = e.target === hero ? '#top' : '#' + e.target.id;
        links.forEach(a => a.classList.toggle('is-current', a.getAttribute('href') === id));
      });
    }, { rootMargin: '-40% 0px -55% 0px' });
    sections.forEach(s => spy.observe(s));
  }

  // Light haptic tap on phones
  document.addEventListener('pointerup', event => {
    if (!event.target.closest('.bottom-nav a,.btn,.chat-fab')) return;
    if (navigator.vibrate && matchMedia('(pointer: coarse)').matches) {
      try { navigator.vibrate(8); } catch {}
    }
  }, { passive: true });
})();
