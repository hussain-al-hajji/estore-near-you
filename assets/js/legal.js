// صفحتا سياسة الخصوصية وشروط الاستخدام: النص من إعدادات لوحة التحكم (سطر ## عنوان، و- نقطة، وغير ذلك فقرة)
import { SETTINGS, formatDate } from './settings.js';
import { escapeHtml } from './utils.js';

const TITLES = { privacy: 'سياسة الخصوصية', terms: 'شروط الاستخدام' };

function markup(text) {
  const out = [];
  let list = false;
  const closeList = () => {
    if (list) out.push('</ul>');
    list = false;
  };
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trim();
    if (!line) {
      closeList();
    } else if (line.startsWith('## ')) {
      closeList();
      out.push(`<h2>${escapeHtml(line.slice(3))}</h2>`);
    } else if (line.startsWith('- ')) {
      if (!list) out.push('<ul>');
      list = true;
      out.push(`<li>${escapeHtml(line.slice(2))}</li>`);
    } else {
      closeList();
      out.push(`<p>${escapeHtml(line)}</p>`);
    }
  }
  closeList();
  return out.join('');
}

export function onShow() {
  const doc = location.hash === '#terms' ? 'terms' : 'privacy';
  const updated = SETTINGS.legal.updated ? `<p class="legal-updated">آخر تحديث: ${escapeHtml(formatDate(SETTINGS.legal.updated))}</p>` : '';
  document.getElementById('legalDoc').innerHTML = `<h1>${TITLES[doc]}</h1>${updated}${markup(SETTINGS.legal[doc])}`;
  for (const a of document.querySelectorAll('.legal-tabs a')) a.classList.toggle('active', a.dataset.doc === doc);
  document.title = `${TITLES[doc]} | دكان الحي`;
}
