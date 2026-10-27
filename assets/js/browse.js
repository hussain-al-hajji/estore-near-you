import { REGIONS, CATEGORIES, DELIVERY, LOCATION_TYPES } from './constants.js';
import { fetchStores, isDemo } from './api.js';
import { createMap, pinIcon, userIcon } from './map.js';
import {
  escapeHtml, safeUrl, haversineKm, formatDistance, storesCountLabel, storage,
} from './utils.js';

const $ = id => document.getElementById(id);
const els = {
  q: $('q'), region: $('region'), city: $('city'), category: $('category'),
  nearMe: $('nearMe'), radius: $('radius'), list: $('list'), count: $('count'), status: $('status'),
};

const state = { stores: [], userLoc: null, selectedId: null };
const markers = new Map();

const map = createMap('map');
const cluster = L.markerClusterGroup({ showCoverageOnHover: false, maxClusterRadius: 45 });
map.addLayer(cluster);
let userMarker = null;

function fillSelect(select, values) {
  for (const v of values) select.add(new Option(v, v));
}

fillSelect(els.region, REGIONS.map(r => r.name));
fillSelect(els.category, CATEGORIES);
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
    && (!els.category.value || s.category === els.category.value)
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
  if (s.instagram) links.push(['انستقرام', `https://instagram.com/${encodeURIComponent(s.instagram)}`]);
  if (s.x_handle) links.push(['إكس', `https://x.com/${encodeURIComponent(s.x_handle)}`]);
  if (s.tiktok) links.push(['تيك توك', `https://www.tiktok.com/@${encodeURIComponent(s.tiktok)}`]);
  if (s.whatsapp) links.push(['واتساب', `https://wa.me/${encodeURIComponent(s.whatsapp)}`]);
  return links.map(([label, href]) =>
    `<a href="${href}" target="_blank" rel="noopener">${label}</a>`).join('');
}

function logoHtml(s) {
  const src = s.logo_url && safeUrl(s.logo_url);
  const initial = escapeHtml([...s.name.trim()][0] || '؟');
  return src
    ? `<span class="logo"><img src="${escapeHtml(src)}" alt="" loading="lazy" referrerpolicy="no-referrer" data-initial="${initial}"></span>`
    : `<span class="logo">${initial}</span>`;
}

function cardHtml(s) {
  const url = safeUrl(s.url);
  const delivery = (s.delivery || []).map(d => DELIVERY[d]).filter(Boolean);
  return `
    <li class="card${s.id === state.selectedId ? ' selected' : ''}" data-id="${escapeHtml(s.id)}" tabindex="0">
      ${logoHtml(s)}
      <div class="card-body">
        <div class="card-title">
          <h2>${escapeHtml(s.name)}</h2>
          ${s.pending ? '<span class="badge badge-pending">قيد المراجعة</span>' : ''}
          ${s.km != null ? `<span class="badge badge-distance">${formatDistance(s.km)}</span>` : ''}
        </div>
        <p class="meta">
          <span>${escapeHtml(s.category)}</span>
          <span>${escapeHtml(s.city)}${s.district ? ` · ${escapeHtml(s.district)}` : ''}</span>
          <span class="kind kind-${s.location_type}">${LOCATION_TYPES[s.location_type] || ''}${s.approximate ? ' (تقريبي)' : ''}</span>
        </p>
        ${s.description ? `<p class="desc">${escapeHtml(s.description)}</p>` : ''}
        ${delivery.length ? `<p class="chips">${delivery.map(d => `<span>${d}</span>`).join('')}</p>` : ''}
        <div class="actions">
          ${url ? `<a class="btn btn-primary btn-sm" href="${escapeHtml(url)}" target="_blank" rel="noopener">زيارة المتجر</a>` : ''}
          <button type="button" class="btn btn-ghost btn-sm" data-action="locate">على الخريطة</button>
          <span class="social">${socialLinks(s)}</span>
        </div>
      </div>
    </li>`;
}

function popupHtml(s) {
  const url = safeUrl(s.url);
  return `<div class="popup">
    <strong>${escapeHtml(s.name)}</strong>
    <span>${escapeHtml(s.category)} · ${escapeHtml(s.city)}</span>
    ${url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener">زيارة المتجر ←</a>` : ''}
  </div>`;
}

function render({ fit = false } = {}) {
  const rows = filtered();
  els.count.textContent = storesCountLabel(rows.length);
  els.list.innerHTML = rows.map(cardHtml).join('');
  els.list.querySelectorAll('.logo img').forEach(img => img.addEventListener('error', () => {
    img.parentElement.textContent = img.dataset.initial;
  }, { once: true }));

  els.status.hidden = rows.length > 0;
  if (!rows.length) {
    els.status.textContent = state.stores.length
      ? 'لا توجد متاجر تطابق الفلاتر الحالية. جرّب توسيع البحث.'
      : 'لا توجد متاجر بعد. كن أول من يضيف متجره!';
  }

  cluster.clearLayers();
  markers.clear();
  for (const s of rows) {
    const m = L.marker([s.lat, s.lng], { icon: pinIcon(s.location_type), title: s.name })
      .bindPopup(popupHtml(s));
    m.on('click', () => select(s.id, { fromMap: true }));
    markers.set(String(s.id), m);
    cluster.addLayer(m);
  }

  if (fit && rows.length) {
    const points = rows.map(s => [s.lat, s.lng]);
    if (state.userLoc) points.push([state.userLoc.lat, state.userLoc.lng]);
    map.fitBounds(L.latLngBounds(points), { padding: [40, 40], maxZoom: 14 });
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

els.q.addEventListener('input', () => render());
els.category.addEventListener('change', () => render({ fit: true }));
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

els.nearMe.addEventListener('click', () => {
  if (!navigator.geolocation) {
    alert('متصفحك لا يدعم تحديد الموقع.');
    return;
  }
  els.nearMe.disabled = true;
  els.nearMe.textContent = '… جارٍ تحديد موقعك';
  navigator.geolocation.getCurrentPosition(pos => {
    state.userLoc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    if (userMarker) userMarker.remove();
    userMarker = L.marker([state.userLoc.lat, state.userLoc.lng], { icon: userIcon, zIndexOffset: 1000 })
      .bindTooltip('موقعك').addTo(map);
    // البحث بالقرب يتجاوز فلتر المنطقة والمدينة
    els.region.value = '';
    updateCities();
    els.radius.hidden = false;
    if (!els.radius.value) els.radius.value = '25';
    els.nearMe.disabled = false;
    els.nearMe.textContent = '📍 تحديث موقعي';
    els.nearMe.classList.add('active');
    render({ fit: true });
  }, () => {
    els.nearMe.disabled = false;
    els.nearMe.textContent = '📍 القريبة مني';
    alert('لم نتمكن من الوصول لموقعك. تأكد من السماح للموقع في المتصفح، أو اختر مدينتك من القائمة.');
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
