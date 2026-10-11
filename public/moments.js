(() => {
  'use strict';
  const tasteForm = document.getElementById('tasteForm');
  const tasteStatus = document.getElementById('tasteStatus');
  const saveTaste = document.getElementById('saveTaste');
  const clearTaste = document.getElementById('clearTaste');
  const storageKey = 'ann:taste:v1';
  const allowed = { temperature: ['cold', 'hot'], style: ['milk', 'black'], sweetness: ['light', 'medium', 'none'] };
  let saved = false;

  function preference() {
    return Object.fromEntries(Object.keys(allowed).map(key => [key, tasteForm.elements[key].value]));
  }

  function renderTaste() {
    const value = preference();
    const milk = value.style === 'milk';
    const sweetness = document.getElementById('tasteSweetness');
    sweetness.hidden = !milk;
    sweetness.disabled = !milk;
    document.getElementById('tasteTitle').textContent = 'قهوة ' + (value.temperature === 'cold' ? 'باردة' : 'حارة') + (milk ? ' بالحليب' : ' سوداء');
    document.getElementById('tasteDescription').textContent = milk ? ({ light: 'حلاوة خفيفة', medium: 'حلاوة معتدلة', none: 'بدون إضافة للتحلية' }[value.sweetness]) : 'طعم القهوة، بدون حليب أو إضافة للتحلية';
    saveTaste.textContent = saved ? 'حدّث بطاقتي' : 'احفظ ذوقي';
  }

  try {
    const value = JSON.parse(localStorage.getItem(storageKey));
    if (value && value.version === 1 && Object.entries(allowed).every(([key, options]) => options.includes(value[key]))) {
      Object.keys(allowed).forEach(key => { tasteForm.elements[key].value = value[key]; });
      saved = true;
      clearTaste.hidden = false;
      tasteStatus.textContent = 'هذه بطاقتك المحفوظة على هذا الجهاز.';
    }
  } catch { /* A private browser or blocked storage still allows using the picker. */ }

  tasteForm.addEventListener('change', () => { tasteStatus.textContent = ''; renderTaste(); });
  tasteForm.addEventListener('submit', event => {
    event.preventDefault();
    try {
      localStorage.setItem(storageKey, JSON.stringify({ version: 1, ...preference() }));
      saved = true;
      clearTaste.hidden = false;
      tasteStatus.textContent = 'تم حفظ ذوقك على هذا الجهاز. تلقاه هنا في زيارتك القادمة.';
      renderTaste();
    } catch {
      tasteStatus.textContent = 'متصفحك لا يتيح الحفظ الآن. تقدر تستخدم البطاقة أثناء فتح الصفحة.';
    }
  });
  clearTaste.addEventListener('click', () => {
    try {
      localStorage.removeItem(storageKey);
      saved = false;
      clearTaste.hidden = true;
      tasteForm.reset();
      renderTaste();
      tasteStatus.textContent = 'مُسحت البطاقة المحفوظة من هذا الجهاز.';
      saveTaste.focus();
    } catch { tasteStatus.textContent = 'تعذر مسح البطاقة. حاول من إعدادات بيانات الموقع في متصفحك.'; }
  });
  renderTaste();

  const inviteForm = document.getElementById('inviteForm');
  const inviteName = document.getElementById('inviteName');
  const inviteMessage = document.getElementById('inviteMessage');
  const status = document.getElementById('invitationStatus');
  const canonicalUrl = 'https://ann-ai-lac.vercel.app/';
  const values = () => ({ name: inviteName.value.trim().slice(0, 30) || 'شخص عزيز', message: inviteMessage.value.trim().slice(0, 120) || 'للقهوة طعم أحلى معك. نجتمع في آن بعد الافتتاح؟' });
  const invitationText = () => { const value = values(); return 'إلى ' + value.name + '\n' + value.message + '\n\nآن coffee · شمال محايل عسير\nدعوة شخصية، والموعد بعد إعلان الافتتاح.\n' + canonicalUrl; };
  const renderInvitation = () => {
    const value = values();
    document.getElementById('invitationTo').textContent = 'إلى ' + value.name;
    document.getElementById('invitationMessage').textContent = value.message;
    status.textContent = '';
  };
  inviteForm.addEventListener('submit', event => event.preventDefault());
  inviteName.addEventListener('input', renderInvitation);
  inviteMessage.addEventListener('input', renderInvitation);

  document.getElementById('copyInvitation').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(invitationText());
      status.textContent = 'نُسخت الدعوة. شاركها بالطريقة اللي تناسبك.';
    } catch { status.textContent = 'تعذر النسخ التلقائي. تقدر تحدد نص البطاقة وتنسخه، أو تنزّلها كصورة.'; }
  });

  const share = document.getElementById('shareInvitation');
  if (typeof navigator.share === 'function') share.hidden = false;
  share.addEventListener('click', async () => {
    try { await navigator.share({ title: 'دعوة من آن coffee', text: invitationText() }); }
    catch (error) { if (error.name !== 'AbortError') status.textContent = 'المشاركة غير متاحة الآن. جرّب نسخ الدعوة أو تنزيل البطاقة.'; }
  });

  function wrappedLines(context, text, width) {
    const lines = [];
    let line = '';
    for (const word of text.split(/\s+/)) {
      if (context.measureText((line ? line + ' ' : '') + word).width <= width) {
        line += (line ? ' ' : '') + word;
        continue;
      }
      if (line) lines.push(line);
      line = '';
      for (const character of Array.from(word)) {
        if (context.measureText(line + character).width > width && line) { lines.push(line); line = ''; }
        line += character;
      }
    }
    if (line) lines.push(line);
    return lines;
  }

  const download = document.getElementById('downloadInvitation');
  download.addEventListener('click', async () => {
    download.disabled = true;
    status.textContent = 'نجهّز بطاقتك…';
    try {
      if (document.fonts?.ready) await document.fonts.ready;
      const canvas = document.createElement('canvas');
      canvas.width = 1080; canvas.height = 1350;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('canvas_unavailable');
      context.fillStyle = '#f8f0e3'; context.fillRect(0, 0, 1080, 1350);
      context.fillStyle = '#eadac6'; context.fillRect(55, 55, 970, 1240);
      context.fillStyle = '#fff9ef'; context.fillRect(64, 64, 952, 1222);
      context.textAlign = 'center'; context.direction = 'rtl';
      context.fillStyle = '#572b1d'; context.font = '700 96px Tajawal, sans-serif';
      context.fillText('آن', 540, 228);
      context.font = '28px Georgia, serif'; context.fillText('coffee', 540, 280);
      const value = values();
      context.font = '500 34px Tajawal, sans-serif';
      wrappedLines(context, 'إلى ' + value.name, 770).forEach((line, index) => context.fillText(line, 540, 395 + index * 49));
      context.font = '700 64px Tajawal, sans-serif'; context.fillText('لك في آن لحظة.', 540, 558);
      context.fillStyle = '#6a4e3f'; context.font = '500 39px Tajawal, sans-serif';
      wrappedLines(context, value.message, 770).slice(0, 6).forEach((line, index) => context.fillText(line, 540, 675 + index * 62));
      context.fillStyle = '#572b1d'; context.font = '500 28px Tajawal, sans-serif';
      context.fillText('دعوة شخصية · الموعد بعد إعلان الافتتاح', 540, 1150);
      context.fillText('شمال محايل عسير', 540, 1200);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('export_failed');
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url; link.download = 'aan-invitation.png';
      document.body.appendChild(link); link.click(); link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 30000);
      status.textContent = 'بطاقتك جاهزة. تجدها في تنزيلات جهازك.';
    } catch { status.textContent = 'تعذر تجهيز الصورة. تقدر تنسخ الدعوة وتشارك نصها.'; }
    finally { download.disabled = false; }
  });
})();
