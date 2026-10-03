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


// ===== ANN IMMERSIVE MOTION =====
(() => {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const finePointer = window.matchMedia('(pointer: fine)').matches;
  const hero = document.querySelector('.hero');
  const heroBg = document.querySelector('.hero-bg');
  if (!hero || !heroBg) return;

  let pointerX = 0;
  let pointerY = 0;
  let targetX = 0;
  let targetY = 0;
  let frame = 0;

  const renderHero = () => {
    frame = 0;
    if (reduceMotion) return;

    pointerX += (targetX - pointerX) * .075;
    pointerY += (targetY - pointerY) * .075;

    const maxScroll = Math.max(hero.offsetHeight, 1);
    const progress = Math.min(Math.max(window.scrollY / maxScroll, 0), 1);
    const scrollShift = -(progress * 72);

    heroBg.style.setProperty('--hero-x', pointerX.toFixed(2) + 'px');
    heroBg.style.setProperty('--hero-y', pointerY.toFixed(2) + 'px');
    heroBg.style.setProperty('--hero-scroll', scrollShift.toFixed(2) + 'px');

    if (Math.abs(targetX - pointerX) > .08 || Math.abs(targetY - pointerY) > .08) {
      requestHero();
    }
  };

  const requestHero = () => {
    if (!frame) frame = requestAnimationFrame(renderHero);
  };

  if (!reduceMotion) {
    window.addEventListener('scroll', requestHero, {passive:true});

    if (finePointer) {
      hero.addEventListener('pointermove', event => {
        const rect = hero.getBoundingClientRect();
        const nx = ((event.clientX - rect.left) / rect.width) - .5;
        const ny = ((event.clientY - rect.top) / rect.height) - .5;

        targetX = nx * 22;
        targetY = ny * 14;

        const glowX = Math.round(50 + nx * 34);
        const glowY = Math.round(44 + ny * 24);
        hero.style.setProperty('--glow-x', glowX + '%');
        hero.style.setProperty('--glow-y', glowY + '%');
        requestHero();
      }, {passive:true});

      hero.addEventListener('pointerleave', () => {
        targetX = 0;
        targetY = 0;
        hero.style.setProperty('--glow-x', '72%');
        hero.style.setProperty('--glow-y', '38%');
        requestHero();
      });
    }

    requestHero();
  }

  const revealTargets = document.querySelectorAll(
    '.experience-copy, .feature-card, .opening-panel'
  );

  revealTargets.forEach(el => el.classList.add('reveal'));

  if (reduceMotion || !('IntersectionObserver' in window)) {
    revealTargets.forEach(el => el.classList.add('is-visible'));
  } else {
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    }, {threshold:.16, rootMargin:'0px 0px -7% 0px'});

    revealTargets.forEach(el => observer.observe(el));
  }

  if (!reduceMotion && finePointer) {
    document.querySelectorAll('.feature-card').forEach(card => {
      card.addEventListener('pointermove', event => {
        const rect = card.getBoundingClientRect();
        const x = (event.clientX - rect.left) / rect.width;
        const y = (event.clientY - rect.top) / rect.height;
        card.style.setProperty('--card-x', (x * 100).toFixed(1) + '%');
        card.style.setProperty('--card-y', (y * 100).toFixed(1) + '%');
      }, {passive:true});
    });
  }
})();


// ===== ANN PROFESSIONAL MOBILE NAV =====
(() => {
  const navItems = [...document.querySelectorAll('.ann-nav-item')];
  const sheets = [...document.querySelectorAll('.ann-sheet')];
  const sheetBackdrop = document.querySelector('.ann-sheet-backdrop');

  const setActive = (button) => {
    navItems.forEach(item => {
      item.classList.toggle('is-active', item === button);
      if (item === button) item.setAttribute('aria-current','page');
      else item.removeAttribute('aria-current');
    });
  };

  const closeSheets = () => {
    sheets.forEach(sheet => {
      sheet.classList.remove('is-open');
      sheet.setAttribute('aria-hidden','true');
    });
    if (sheetBackdrop) {
      sheetBackdrop.classList.remove('is-visible');
      setTimeout(() => { sheetBackdrop.hidden = true; }, 220);
    }
  };

  const openSheet = (name, trigger) => {
    closeSheets();
    const sheet = document.querySelector('.ann-sheet[data-sheet="' + name + '"]');
    if (!sheet) return;
    sheet.setAttribute('aria-hidden','false');
    sheet.classList.add('is-open');
    if (sheetBackdrop) {
      sheetBackdrop.hidden = false;
      requestAnimationFrame(() => sheetBackdrop.classList.add('is-visible'));
    }
    if (trigger) setActive(trigger);
  };

  document.querySelectorAll('[data-open-sheet]').forEach(btn => {
    btn.addEventListener('click', () => openSheet(btn.dataset.openSheet, btn));
  });

  document.querySelectorAll('[data-close-sheet]').forEach(btn => {
    btn.addEventListener('click', () => {
      closeSheets();
      const home = document.querySelector('[data-nav-home]');
      if (home) setActive(home);
    });
  });

  document.querySelectorAll('[data-nav-home]').forEach(btn => {
    btn.addEventListener('click', () => {
      closeSheets();
      setActive(btn);
      window.scrollTo({top:0,behavior:'smooth'});
    });
  });

  document.querySelectorAll('.ann-nav-assistant').forEach(btn => {
    btn.addEventListener('click', () => {
      closeSheets();
      setActive(btn);
    });
  });

  document.querySelectorAll('.ann-sheet [data-open-chat]').forEach(btn => {
    btn.addEventListener('click', () => {
      closeSheets();
      const assistant = document.querySelector('.ann-nav-assistant');
      if (assistant) setActive(assistant);
    });
  });
})();
