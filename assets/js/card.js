// بطاقة المتجر كما تظهر للزوار: تُستخدم في صفحة التصفح وفي معاينة صفحة التسجيل
import { DELIVERY, DELIVERY_ICONS } from './constants.js';
import { CATEGORY_ICONS, ENTITY_TYPES } from './settings.js';
import { escapeHtml, safeUrl, safeImage, formatDistance } from './utils.js';

export const ICONS = {
  instagram: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1.2" class="fill"/></svg>',
  x: '<svg viewBox="0 0 24 24"><path d="M4 4l16 16M20 4L4 20"/></svg>',
  tiktok: '<svg viewBox="0 0 24 24"><path d="M14 3v11.5a3.5 3.5 0 1 1-3.5-3.5M14 3c.6 2.6 2.6 4.6 5 4.8"/></svg>',
  snapchat: '<svg viewBox="0 0 24 24"><path d="M12 3.5c3 0 5 2.2 5 5.2v2.1l1.8-.5c.6.6.3 1.3-.4 1.6l-1.6.7c.6 1.8 1.9 3.1 3.6 3.6-.3.9-1.4 1.1-2.4 1.2l-.4 1.3-1.6-.2c-1 .8-2.4 1.8-4 1.8s-3-1-4-1.8l-1.6.2-.4-1.3c-1-.1-2.1-.3-2.4-1.2 1.7-.5 3-1.8 3.6-3.6l-1.6-.7c-.7-.3-1-1-.4-1.6l1.8.5V8.7c0-3 2-5.2 5-5.2z"/></svg>',
  email: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M4 7l8 6 8-6"/></svg>',
  flag: '<svg viewBox="0 0 24 24"><path d="M5 21V4M5 4h11l-2 4 2 4H5"/></svg>',
  share: '<svg viewBox="0 0 24 24"><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M8.2 10.8l7.6-3.6M8.2 13.2l7.6 3.6"/></svg>',
  whatsapp: '<svg viewBox="0 0 24 24"><path d="M3.5 20.5l1.3-4.2A8.5 8.5 0 1 1 8 19.5z"/><path d="M9 9.5c.5 2.2 2.3 4 4.5 4.5"/></svg>',
};
const AVATAR_THEMES = ['violet', 'coral', 'lime', 'sky', 'pink'];

export function mainLoc(s) {
  return s.shownLocs[s.nearest ?? 0];
}

export function socialList(s) {
  const links = [];
  if (s.whatsapp) links.push(['whatsapp', 'واتساب', `https://wa.me/${encodeURIComponent(s.whatsapp)}`]);
  if (s.instagram) links.push(['instagram', 'انستقرام', `https://instagram.com/${encodeURIComponent(s.instagram)}`]);
  if (s.snapchat) links.push(['snapchat', 'سناب شات', `https://www.snapchat.com/add/${encodeURIComponent(s.snapchat)}`]);
  if (s.tiktok) links.push(['tiktok', 'تيك توك', `https://www.tiktok.com/@${encodeURIComponent(s.tiktok)}`]);
  if (s.x_handle) links.push(['x', 'إكس', `https://x.com/${encodeURIComponent(s.x_handle)}`]);
  if (s.store_email) links.push(['email', 'إيميل المتجر', `mailto:${encodeURIComponent(s.store_email).replace('%40', '@')}`]);
  return links;
}

function socialLinks(s) {
  return socialList(s).map(([key, label, href]) =>
    `<a class="icon-btn" href="${href}" target="_blank" rel="noopener" title="${label}" aria-label="${label}" data-click="${escapeHtml(s.id)}">${ICONS[key]}</a>`).join('');
}

// الزر الرئيسي: رابط المتجر، أو أول حساب تواصل للمتاجر التي تبيع عبر حساباتها فقط
export function primaryLink(s) {
  const url = safeUrl(s.url);
  if (url) return { href: url, label: 'زيارة المتجر ↗' };
  const list = socialList(s);
  const first = list.find(([key]) => key !== 'whatsapp' && key !== 'email') || list[0];
  return first ? { href: first[2], label: `تواصل عبر ${first[1]} ↗` } : null;
}

function avatarTheme(name) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return AVATAR_THEMES[h % AVATAR_THEMES.length];
}

function logoHtml(s) {
  const src = s.logo_url && safeImage(s.logo_url);
  const initial = escapeHtml([...s.name.trim()][0] || '؟');
  return src
    ? `<span class="avatar"><img src="${escapeHtml(src)}" alt="" loading="lazy" referrerpolicy="no-referrer" data-initial="${initial}"></span>`
    : `<span class="avatar avatar-${avatarTheme(s.name)}">${initial}</span>`;
}

// نوع المشروع (شركة/مؤسسة أو عمل حر/أسر منتجة) يظهر بجنب الاسم، وليس ضمن مجالات المنتجات
export function entityChip(s) {
  const e = ENTITY_TYPES[s.entity_type];
  return e ? `<span class="entity-chip entity-${escapeHtml(s.entity_type)}">${e.icon} ${e.label}</span>` : '';
}

export function cardHtml(s, { selected = false, preview = false } = {}) {
  const main = primaryLink(s);
  const delivery = (s.delivery || []).filter(d => DELIVERY[d]);
  return `
    <li class="card${selected ? ' selected' : ''}${preview ? ' card-preview' : ''}" data-id="${escapeHtml(s.id)}" tabindex="0">
      <div class="card-top">
        ${logoHtml(s)}
        <div class="card-head">
          <div class="card-title">
            <h2>${escapeHtml(s.name)}</h2>
            ${entityChip(s)}
          </div>
          <p class="meta">📍 ${escapeHtml(mainLoc(s).city)}${mainLoc(s).district ? ` · ${escapeHtml(mainLoc(s).district)}` : ''}${s.locs.length > 1 ? ` <span class="more-locs">+${s.locs.length - 1} ${s.locs.length === 2 ? 'موقع آخر' : 'مواقع أخرى'}</span>` : ''}</p>
        </div>
        ${s.pinned ? '<span class="badge badge-pin">📌 مثبّت</span>' : ''}
        ${s.km != null ? `<span class="badge badge-distance">${formatDistance(s.km)}</span>` : ''}
        ${s.pending ? '<span class="badge badge-pending">قيد المراجعة</span>' : ''}
      </div>
      <p class="tags">
        ${s.cats.map(c => `<span class="tag">${CATEGORY_ICONS[c] || '🛍️'} ${escapeHtml(c)}</span>`).join('')}
        ${s.has_physical_store === true ? '<span class="tag">🏬 له محل فعلي</span>' : ''}
        ${s.approximate ? '<span class="tag">📍 موقع تقريبي</span>' : ''}
      </p>
      ${s.description ? `<p class="desc">${escapeHtml(s.description)}</p>` : ''}
      ${delivery.length ? `<p class="delivery">${delivery.map(d => `<span>${DELIVERY_ICONS[d]} ${DELIVERY[d]}</span>`).join('')}</p>` : ''}
      <div class="actions">
        ${main ? `<a class="btn btn-primary btn-sm" href="${escapeHtml(main.href)}" target="_blank" rel="noopener" data-click="${escapeHtml(s.id)}">${main.label}</a>` : ''}
        <button type="button" class="btn btn-ghost btn-sm" data-action="locate">على الخريطة</button>
        <span class="social">${socialLinks(s)}</span>
        <button type="button" class="icon-btn share-btn" data-action="share" title="شارك المتجر" aria-label="شارك ${escapeHtml(s.name)}">${ICONS.share}</button>
        <button type="button" class="icon-btn report-btn" data-action="report" title="بلّغ عن المتجر" aria-label="بلّغ عن ${escapeHtml(s.name)}">${ICONS.flag}</button>
      </div>
    </li>`;
}

