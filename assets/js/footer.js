// تذييل الموقع: نبذة وشعار وعنوان وبيانات تواصل، من إعدادات لوحة التحكم
import { SETTINGS } from './settings.js';

const MAIL_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M4 7l8 6 8-6"/></svg>';
const WA_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 20.5l1.3-4.2A8.5 8.5 0 1 1 8 19.5z"/><path d="M9 9.5c.5 2.2 2.3 4 4.5 4.5"/></svg>';
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

// أيقونة فقط: الإيميل والرقم لا يُعرضان كنص، وتظهر التسمية عند التمرير
function contactIcon(href, icon, label) {
  return el('a', {
    href, class: 'footer-icon-btn', title: label, 'aria-label': label,
    target: href.startsWith('http') ? '_blank' : '_self', rel: 'noopener', html: icon,
  });
}

export function renderFooters() {
  const f = SETTINGS.footer;
  const email = (f.email || '').trim();
  const wa = (f.whatsapp || '').replace(/\D/g, '');
  for (const host of document.querySelectorAll('[data-site-footer]')) {
    const contacts = el('div', { class: 'footer-contacts' });
    if (f.address) {
      const addr = el('span', { class: 'footer-contact' });
      addr.append(el('span', { class: 'footer-icon', html: PIN_ICON }), el('span', { text: f.address }));
      contacts.append(addr);
    }
    const icons = el('div', { class: 'footer-icons' });
    if (email) icons.append(contactIcon(`mailto:${email}`, MAIL_ICON, 'راسلنا على الإيميل'));
    if (wa) icons.append(contactIcon(`https://wa.me/${wa}`, WA_ICON, 'تواصل معنا على واتساب'));
    if (icons.childElementCount) contacts.append(el('span', { class: 'footer-reach', text: 'تواصل معنا' }), icons);

    const brand = el('div', { class: 'footer-brand' }, [
      el('img', { src: 'assets/img/logo-white.svg', alt: 'دكان الحي', height: '40' }),
      el('p', { text: f.about || '' }),
    ]);
    const links = el('nav', { class: 'footer-links', 'aria-label': 'روابط' }, [
      el('a', { href: '#', text: 'تصفح المتاجر' }),
      el('a', { href: '#add', text: 'أضف متجرك' }),
    ]);
    const disclaimer = SETTINGS.legal.disclaimer
      ? el('p', { class: 'footer-disclaimer' }, [el('strong', { text: '⚖️ إخلاء مسؤولية: ' }), SETTINGS.legal.disclaimer])
      : '';
    const bottom = el('div', { class: 'footer-bottom', text: `© ${new Date().getFullYear()} دكان الحي · جميع الحقوق محفوظة` });
    host.replaceChildren(el('div', { class: 'footer-inner' }, [brand, el('div', { class: 'footer-side' }, [contacts, links])]), disclaimer, bottom);
  }
}
