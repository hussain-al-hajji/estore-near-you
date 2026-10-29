// تذييل الموقع: نبذة وشعار وعنوان وبيانات تواصل، من إعدادات لوحة التحكم
import { SETTINGS } from './settings.js';

const PIN_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>';

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'html') node.innerHTML = v;
    else if (k === 'text') node.textContent = v;
    else node.setAttribute(k, v);
  }
  node.append(...children);
  return node;
}

export function renderFooters() {
  const f = SETTINGS.footer;
  for (const host of document.querySelectorAll('[data-site-footer]')) {
    const contacts = el('div', { class: 'footer-contacts' });
    if (f.address) {
      const addr = el('span', { class: 'footer-contact' });
      addr.append(el('span', { class: 'footer-icon', html: PIN_ICON }), el('span', { text: f.address }));
      contacts.append(addr);
    }
    if (f.document) {
      const doc = el('span', { class: 'footer-contact' });
      doc.append(el('span', { text: `رقم الوثيقة: ${f.document}` }));
      contacts.append(doc);
    }
    const brand = el('div', { class: 'footer-brand' }, [
      el('img', { src: 'assets/img/logo-white.svg', alt: 'دكان الحي', height: '40' }),
      el('p', { text: f.about || '' }),
    ]);
    // سطر أزرار (راسلنا · دخول المتجر) وتحته سطر الروابط القانونية
    const links = el('nav', { class: 'footer-links', 'aria-label': 'روابط' }, [
      el('div', { class: 'footer-actions' }, [
        el('button', { type: 'button', class: 'footer-pill', 'data-open-contact': 'general', html: '<span aria-hidden="true">✉️</span> راسلنا' }),
        el('a', { class: 'footer-pill', href: '#account', html: '<span aria-hidden="true">🔑</span> دخول المتجر' }),
      ]),
      el('div', { class: 'footer-legal' }, [
        el('a', { href: '#privacy', text: 'سياسة الخصوصية' }),
        el('span', { class: 'sep', 'aria-hidden': 'true', text: '|' }),
        el('a', { href: '#terms', text: 'شروط الاستخدام' }),
      ]),
    ]);
    const disclaimer = SETTINGS.legal.disclaimer
      ? el('p', { class: 'footer-disclaimer' }, [el('strong', { text: '⚖️ إخلاء مسؤولية: ' }), SETTINGS.legal.disclaimer])
      : '';
    const bottom = el('div', { class: 'footer-bottom', text: `© ${new Date().getFullYear()} دكان الحي · جميع الحقوق محفوظة` });
    host.replaceChildren(el('div', { class: 'footer-inner' }, [brand, el('div', { class: 'footer-side' }, [contacts, links])]), disclaimer, bottom);
  }
}
