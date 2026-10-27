import { REGIONS, CATEGORIES, CATEGORY_ICONS, DELIVERY, DELIVERY_ICONS, LOCATION_TYPES } from './constants.js';
import { fetchStores, isDemo } from './api.js';
import { createMap, pinIcon, userIcon, clusterIcon } from './map.js';
import {
  escapeHtml, safeUrl, haversineKm, formatDistance, storesCountLabel, storage,
} from './utils.js';

const $ = id => document.getElementById(id);
const els = {
  q: $('q'), region: $('region'), city: $('city'), chips: $('categoryChips'),
  nearMe: $('nearMe'), radius: $('radius'), list: $('list'), count: $('count'),
  subtitle: $('subtitle'), status: $('status'),
};

const state = { stores: [], userLoc: null, selectedId: null, category: '' };
const markers = new Map();

const map = createMap('map');
const cluster = L.markerClusterGroup({
  showCoverageOnHover: false, maxClusterRadius: 45, iconCreateFunction: clusterIcon,
});
map.addLayer(cluster);
let userMarker = null;

const ICONS = {
  instagram: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1.2" class="fill"/></svg>',
  x: '<svg viewBox="0 0 24 24"><path d="M4 4l16 16M20 4L4 20"/></svg>',
  tiktok: '<svg viewBox="0 0 24 24"><path d="M14 3v11.5a3.5 3.5 0 1 1-3.5-3.5M14 3c.6 2.6 2.6 4.6 5 4.8"/></svg>',
  whatsapp: '<svg viewBox="0 0 24 24"><path d="M3.5 20.5l1.3-4.2A8.5 8.5 0 1 1 8 19.5z"/><path d="M9 9.5c.5 2.2 2.3 4 4.5 4.5"/></svg>',
};
const AVATAR_THEMES = ['violet', 'coral', 'lime', 'sky', 'pink'];

function fillSelect(select, values) {
  for (const v of values) select.add(new Option(v, v));
}

fillSelect(els.region, REGIONS.map(r => r.name));
els.chips.innerHTML = [['', '✨', 'الكل'], ...CATEGORIES.map(c => [c, CATEGORY_ICONS[c], c])]
  .map(([value, icon, label]) =>
    `<button type="button" class="chip${value ? '' : ' active'}" data-value="${escapeHtml(value)}" aria-pressed="${!value}"><span>${icon}</span>${escapeHtml(label)}</button>`)
  .join('');
if (isDemo) $('demoBanner').hidden = false;

function updateCities() {
  const region = REGIONS.find(r => r.name === els.region.value);
  els.city.length = 1;
  els.city.disabled = !region;
  if (region) fillSelect(els.city, region.cities.map(c => c.name));
}

function filtered() {
  const q = els.q.value.trim().toLowerCase();
  const radius = Number(els.radius.value) || 0;
  let rows = state.stores.filter(s =>
    (!els.region.value || s.region === els.region.value)
    && (!els.city.value || s.city === els.city.value)
    && (!state.category || s.category === state.category)
    && (!q || `${s.name} ${s.description || ''} ${s.category} ${s.district || ''}`.toLowerCase().includes(q)),
  );
  if (state.userLoc) {
    rows = rows.map(s => ({ ...s, km: haversineKm(state.userLoc.lat, state.userLoc.lng, s.lat, s.lng) }));
    if (radius) rows = rows.filter(s => s.km <= radius);
    rows.sort((a, b) => a.km - b.km);
  }
  return rows;
}

function socialLinks(s) {
  const links = [];
  if (s.instagram) links.push(['instagram', 'انستقرام', `https://instagram.com/${encodeURIComponent(s.instagram)}`]);
  if (s.x_handle) links.push(['x', 'إكس', `https://x.com/${encodeURIComponent(s.x_handle)}`]);
  if (s.tiktok) links.push(['tiktok', 'تيك توك', `https://www.tiktok.com/@${encodeURIComponent(s.tiktok)}`]);
  if (s.whatsapp) links.push(['whatsapp', 'واتساب', `https://wa.me/${encodeURIComponent(s.whatsapp)}`]);
  return links.map(([key, label, href]) =>
    `<a class="icon-btn" href="${href}" target="_blank" rel="noopener" title="${label}" aria-label="${label}">${ICONS[key]}</a>`).join('');
}

function avatarTheme(name) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return AVATAR_THEMES[h % AVATAR_THEMES.length];
}

function logoHtml(s) {
  const src = s.logo_url && safeUrl(s.logo_url);
  const initial = escapeHtml([...s.name.trim()][0] || '؟');
  return src
    ? `<span class="avatar"><img src="${escapeHtml(src)}" alt="" loading="lazy" referrerpolicy="no-referrer" data-initial="${initial}"></span>`
    : `<span class="avatar avatar-${avatarTheme(s.name)}">${initial}</span>`;
}

function cardHtml(s) {
  const url = safeUrl(s.url);
  const delivery = (s.delivery || []).filter(d => DELIVERY[d]);
  return `
    <li class="card${s.id === state.selectedId ? ' selected' : ''}" data-id="${escapeHtml(s.id)}" tabindex="0">
      <div class="card-top">
        ${logoHtml(s)}
        <div class="card-head">
          <h2>${escapeHtml(s.name)}</h2>
          <p class="meta">📍 ${escapeHtml(s.city)}${s.district ? ` · ${escapeHtml(s.district)}` : ''}</p>
        </div>
        ${s.km != null ? `<span class="badge badge-distance">${formatDistance(s.km)}</span>` : ''}
        ${s.pending ? '<span class="badge badge-pending">قيد المراجعة</span>' : ''}
      </div>
      <p class="tags">
        <span class="tag">${CATEGORY_ICONS[s.category] || '🛍️'} ${escapeHtml(s.category)}</span>
        <span class="tag tag-${s.location_type}">${s.location_type === 'warehouse' ? '📦' : '🏪'} ${LOCATION_TYPES[s.location_type] || ''}${s.approximate ? ' (تقريبي)' : ''}</span>
      </p>
      ${s.description ? `<p class="desc">${escapeHtml(s.description)}</p>` : ''}
      ${delivery.length ? `<p class="delivery">${delivery.map(d => `<span>${DELIVERY_ICONS[d]} ${DELIVERY[d]}</span>`).join('')}</p>` : ''}
      <div class="actions">
        ${url ? `<a class="btn btn-primary btn-sm" href="${escapeHtml(url)}" target="_blank" rel="noopener">زيارة المتجر ↗</a>` : ''}
        <button type="button" class="btn btn-ghost btn-sm" data-action="locate">على الخريطة</button>
        <span class="social">${socialLinks(s)}</span>
      </div>
    </li>`;
}

function popupHtml(s) {
  const url = safeUrl(s.url);
  return `<div class="popup">
    <strong>${CATEGORY_ICONS[s.category] || '🛍️'} ${escapeHtml(s.name)}</strong>
    <span>${escapeHtml(s.category)} · ${escapeHtml(s.city)}</span>
    ${url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener">زيارة المتجر ↗</a>` : ''}
  </div>`;
}

function render({ fit = false } = {}) {
  const rows = filtered();
  els.count.textContent = storesCountLabel(rows.length);
  els.subtitle.textContent = state.userLoc ? 'مرتبة من الأقرب لك' : (els.city.value || els.region.value || 'في كل المملكة');
  els.list.innerHTML = rows.map(cardHtml).join('');
  els.list.querySelectorAll('.avatar img').forEach(img => img.addEventListener('error', () => {
    const avatar = img.parentElement;
    avatar.classList.add('avatar-violet');
    avatar.textContent = img.dataset.initial;
  }, { once: true }));

  els.status.hidden = rows.length > 0;
  if (!rows.length) {
    els.status.innerHTML = state.stores.length
      ? '<span class="big">🔍</span><strong>ما لقينا متاجر بهالفلاتر</strong><span>جرّب توسّع البحث أو تغيّر التصنيف.</span>'
      : '<span class="big">🛍️</span><strong>ما فيه متاجر للحين</strong><span>كن أول متجر في حيّك!</span><a class="btn btn-primary btn-sm" href="add-store.html">أضف متجرك</a>';
  }

  cluster.clearLayers();
  markers.clear();
  for (const s of rows) {
    const m = L.marker([s.lat, s.lng], {
      icon: pinIcon(s.location_type, CATEGORY_ICONS[s.category]), title: s.name,
    }).bindPopup(popupHtml(s));
    m.on('click', () => select(s.id, { fromMap: true }));
    markers.set(String(s.id), m);
    cluster.addLayer(m);
  }

  if (fit && rows.length) {
    const points = rows.map(s => [s.lat, s.lng]);
    if (state.userLoc) points.push([state.userLoc.lat, state.userLoc.lng]);
    map.fitBounds(L.latLngBounds(points), { padding: [50, 50], maxZoom: 14 });
  }
}

function select(id, { fromMap = false } = {}) {
  state.selectedId = id;
  els.list.querySelectorAll('.card.selected').forEach(c => c.classList.remove('selected'));
  const card = els.list.querySelector(`.card[data-id="${CSS.escape(String(id))}"]`);
  if (card) {
    card.classList.add('selected');
    if (fromMap) card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  const marker = markers.get(String(id));
  if (marker && !fromMap) {
    cluster.zoomToShowLayer(marker, () => marker.openPopup());
  }
}

els.list.addEventListener('click', e => {
  if (e.target.closest('a')) return;
  const card = e.target.closest('.card');
  if (card) select(card.dataset.id);
});
els.list.addEventListener('keydown', e => {
  const card = e.target.closest('.card');
  if (card && e.key === 'Enter' && e.target === card) select(card.dataset.id);
});

els.chips.addEventListener('click', e => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  state.category = chip.dataset.value;
  els.chips.querySelectorAll('.chip').forEach(c => {
    c.classList.toggle('active', c === chip);
    c.setAttribute('aria-pressed', String(c === chip));
  });
  render({ fit: true });
});

els.q.addEventListener('input', () => render());
els.radius.addEventListener('change', () => render({ fit: true }));
els.region.addEventListener('change', () => {
  updateCities();
  render({ fit: true });
  storage('dukkan.region', els.region.value);
});
els.city.addEventListener('change', () => {
  const region = REGIONS.find(r => r.name === els.region.value);
  const city = region?.cities.find(c => c.name === els.city.value);
  render({ fit: !city });
  if (city) map.flyTo([city.lat, city.lng], 11);
  storage('dukkan.city', els.city.value);
});

const nearMeLabel = els.nearMe.innerHTML;
els.nearMe.addEventListener('click', () => {
  if (!navigator.geolocation) {
    alert('متصفحك لا يدعم تحديد الموقع.');
    return;
  }
  els.nearMe.disabled = true;
  els.nearMe.textContent = 'لحظة…';
  navigator.geolocation.getCurrentPosition(pos => {
    state.userLoc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    if (userMarker) userMarker.remove();
    userMarker = L.marker([state.userLoc.lat, state.userLoc.lng], { icon: userIcon, zIndexOffset: 1000 })
      .bindTooltip('أنت هنا').addTo(map);
    // البحث بالقرب يتجاوز فلتر المنطقة والمدينة
    els.region.value = '';
    updateCities();
    els.radius.hidden = false;
    if (!els.radius.value) els.radius.value = '25';
    els.nearMe.disabled = false;
    els.nearMe.innerHTML = nearMeLabel;
    els.nearMe.classList.add('active');
    render({ fit: true });
  }, () => {
    els.nearMe.disabled = false;
    els.nearMe.innerHTML = nearMeLabel;
    alert('ما قدرنا نوصل لموقعك. اسمح للموقع من إعدادات المتصفح، أو اختر مدينتك من القائمة.');
  }, { enableHighAccuracy: true, timeout: 10000 });
});

async function init() {
  const savedRegion = storage('dukkan.region');
  if (savedRegion && REGIONS.some(r => r.name === savedRegion)) {
    els.region.value = savedRegion;
    updateCities();
    const savedCity = storage('dukkan.city');
    if (savedCity && [...els.city.options].some(o => o.value === savedCity)) els.city.value = savedCity;
  }
  try {
    state.stores = (await fetchStores()).map(s => ({ ...s, id: String(s.id) }));
    render({ fit: true });
  } catch (err) {
    els.count.textContent = 'تعذر التحميل';
    els.status.hidden = false;
    els.status.textContent = err.message;
  }
}

init();
