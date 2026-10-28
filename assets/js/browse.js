import { REGIONS, DELIVERY, DELIVERY_ICONS, REPORT_REASONS } from './constants.js';
import { CATEGORIES, CATEGORY_ICONS, ENTITY_TYPES } from './settings.js';
import { searchStores, refreshStores, submitReport, getBanners, bannerClick, getPinnedStores, isDemo, logEvent, logImpressions } from './api.js';
import { parseIntent } from './intent.js';
import { createMap, pinIcon, userIcon, clusterIcon } from './map.js';
import { locate, accuracyLabel, geoErrorMessage } from './geo.js';
import {
  escapeHtml, safeUrl, safeImage, haversineKm, formatDistance, storesCountLabel, storage, storeLocations, nearestCity, storeCategories,
} from './utils.js';

const $ = id => document.getElementById(id);
const els = {
  q: $('q'), region: $('region'), city: $('city'), entity: $('entity'), chips: $('categoryChips'),
  nearMe: $('nearMe'), radius: $('radius'), list: $('list'), count: $('count'),
  subtitle: $('subtitle'), status: $('status'), geoNote: $('geoNote'), intent: $('intentNote'), banner: $('adBanner'),
};

// gate: قبل السماح بالموقع أو اختيار مدينة/فلتر، نعرض طلب تفعيل الموقع بدل القائمة
// النتائج تجي من السيرفر صفحة صفحة (30 متجر)، مع عدد المتاجر في كل مدينة للخريطة
const state = {
  results: [], total: 0, cities: [], pageSize: 30, maxOffset: 60, error: null, relaxed: false,
  intent: null, intentFor: '', dismissed: new Set(), eff: { region: '', city: '' }, shared: null, pinned: [],
  userLoc: null, selectedId: null, category: '', gate: true, geoDenied: false,
};
const markers = new Map();

const map = createMap('map');
const cluster = L.markerClusterGroup({
  showCoverageOnHover: false, maxClusterRadius: 45, iconCreateFunction: clusterIcon,
});
map.addLayer(cluster);
// فقاعات المدن المتقاربة (الدمام والخبر والقطيف مثلًا) تندمج عند التصغير ويظهر مجموعها
const cityLayer = L.markerClusterGroup({
  showCoverageOnHover: false, maxClusterRadius: 50,
  iconCreateFunction: c => cityIcon(c.getAllChildMarkers().reduce((sum, m) => sum + m.options.count, 0)),
}).addTo(map);
let userMarker = null;
let accuracyCircle = null;

const ICONS = {
  instagram: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1.2" class="fill"/></svg>',
  x: '<svg viewBox="0 0 24 24"><path d="M4 4l16 16M20 4L4 20"/></svg>',
  tiktok: '<svg viewBox="0 0 24 24"><path d="M14 3v11.5a3.5 3.5 0 1 1-3.5-3.5M14 3c.6 2.6 2.6 4.6 5 4.8"/></svg>',
  snapchat: '<svg viewBox="0 0 24 24"><path d="M12 3.5c3 0 5 2.2 5 5.2v2.1l1.8-.5c.6.6.3 1.3-.4 1.6l-1.6.7c.6 1.8 1.9 3.1 3.6 3.6-.3.9-1.4 1.1-2.4 1.2l-.4 1.3-1.6-.2c-1 .8-2.4 1.8-4 1.8s-3-1-4-1.8l-1.6.2-.4-1.3c-1-.1-2.1-.3-2.4-1.2 1.7-.5 3-1.8 3.6-3.6l-1.6-.7c-.7-.3-1-1-.4-1.6l1.8.5V8.7c0-3 2-5.2 5-5.2z"/></svg>',
  flag: '<svg viewBox="0 0 24 24"><path d="M5 21V4M5 4h11l-2 4 2 4H5"/></svg>',
  share: '<svg viewBox="0 0 24 24"><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M8.2 10.8l7.6-3.6M8.2 13.2l7.6 3.6"/></svg>',
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

// نفهم جملة البحث (مدينة، توصيل، نوع النشاط، مرادفات…) ونحوّلها لفلاتر وكلمات يطابقها السيرفر
function understand() {
  const q = els.q.value.trim();
  if (q !== state.intentFor) {
    state.intentFor = q;
    state.dismissed = new Set();
  }
  return parseIntent(q, { categories: CATEGORIES, dismissed: state.dismissed });
}

function searchParams() {
  if (state.shared) return { id: state.shared };
  const it = understand();
  state.intent = it;
  // ما كتبه الزائر في البحث يتقدم على القوائم المنسدلة
  const region = it.region || els.region.value;
  const city = it.city || (it.region ? '' : els.city.value);
  state.eff = { region, city };
  return {
    lat: state.userLoc?.lat, lng: state.userLoc?.lng,
    radius: state.userLoc ? Number(els.radius.value) || 0 : 0,
    region, city, category: state.category,
    entity: it.entity || els.entity.value, delivery: it.delivery,
    terms: it.terms, boost: it.boost, q: els.q.value.trim(),
  };
}

function hasFilters() {
  return Boolean(state.userLoc || els.region.value || state.category || els.entity.value || els.q.value.trim());
}

// المتجر قد يكون له أكثر من موقع: نعرض المواقع المطابقة للمنطقة/المدينة، والمسافة تُقاس لأقربها
function rows() {
  const { region, city } = state.eff;
  // المتاجر المثبّتة تظهر أولًا عند التصفح بدون كلمات بحث، وتحترم فلتر المجال والنوع
  const it = state.intent;
  const pins = state.shared || it?.terms?.length ? [] : state.pinned
    .filter(s => (!state.category || s.cats.includes(state.category)) && (!(it?.entity || els.entity.value) || s.entity_type === (it?.entity || els.entity.value)))
    .map(s => ({ ...s, pinned: true, shownLocs: s.locs }));
  const pinnedIds = new Set(pins.map(s => s.id));
  let list = state.results
    .filter(s => !pinnedIds.has(s.id))
    .map(s => ({ ...s, shownLocs: s.locs.filter(l => (!region || l.region === region) && (!city || l.city === city)) }))
    .filter(s => s.shownLocs.length);
  if (state.userLoc) {
    list = list.map(s => {
      const dists = s.shownLocs.map(l => haversineKm(state.userLoc.lat, state.userLoc.lng, l.lat, l.lng));
      const nearest = dists.indexOf(Math.min(...dists));
      return { ...s, km: dists[nearest], nearest };
    });
    list.sort((a, b) => a.km - b.km);
    for (const s of pins) {
      const dists = s.shownLocs.map(l => haversineKm(state.userLoc.lat, state.userLoc.lng, l.lat, l.lng));
      s.nearest = dists.indexOf(Math.min(...dists));
      s.km = dists[s.nearest];
    }
  }
  return [...pins, ...list];
}

// ---- البحث من السيرفر ----

let searchSeq = 0;
async function search({ fit = false, append = false } = {}) {
  const seq = ++searchSeq;
  try {
    const res = await searchStores({ ...searchParams(), offset: append ? state.results.length : 0 });
    if (seq !== searchSeq) return false;
    const page = res.stores.map(s => ({ ...s, id: String(s.id), locs: storeLocations(s), cats: storeCategories(s) }));
    const have = new Set(append ? state.results.map(r => r.id) : []);
    state.results = append ? [...state.results, ...page.filter(r => !have.has(r.id))] : page;
    Object.assign(state, {
      total: res.total, cities: res.cities || [], pageSize: res.page_size || 30, maxOffset: res.max_offset ?? 60, error: null,
      relaxed: Boolean(res.relaxed),
    });
  } catch (err) {
    if (seq !== searchSeq) return false;
    state.error = err.message;
    if (!append) Object.assign(state, { results: [], total: 0, cities: [] });
  }
  if (state.shared && !state.error && !state.results.length) {
    leaveShared();
    toast('هذا المتجر غير متاح حاليًا، تصفح المتاجر الأخرى');
    return search({ fit: true });
  }
  render({ fit: fit && !append });
  if (state.shared && state.results[0]) select(state.results[0].id);
  return true;
}

// يجمع التغييرات السريعة (الكتابة، تحديثات الموقع) في طلب واحد. يرجع false إذا جاء بحث أحدث منه
let searchTimer = null;
let pendingSearch = null;
// إشارة فورية للزائر أن البحث بدأ (قبل وصول النتائج)
function showLoading() {
  if (state.gate && !state.userLoc) return;
  els.count.textContent = 'جارٍ البحث…';
  els.list.classList.add('is-loading');
  if (els.status.classList.contains('gate')) {
    els.status.hidden = true;
    els.status.classList.remove('gate');
  }
}

function scheduleSearch({ fit = false } = {}, delay = 0) {
  showLoading();
  clearTimeout(searchTimer);
  const merged = fit || Boolean(pendingSearch?.fit);
  pendingSearch?.resolve(false);
  return new Promise(resolve => {
    pendingSearch = { fit: merged, resolve };
    searchTimer = setTimeout(async () => {
      const job = pendingSearch;
      pendingSearch = null;
      job.resolve(await search({ fit: job.fit }));
    }, delay);
  });
}

function mainLoc(s) {
  return s.shownLocs[s.nearest ?? 0];
}

function socialList(s) {
  const links = [];
  if (s.whatsapp) links.push(['whatsapp', 'واتساب', `https://wa.me/${encodeURIComponent(s.whatsapp)}`]);
  if (s.instagram) links.push(['instagram', 'انستقرام', `https://instagram.com/${encodeURIComponent(s.instagram)}`]);
  if (s.snapchat) links.push(['snapchat', 'سناب شات', `https://www.snapchat.com/add/${encodeURIComponent(s.snapchat)}`]);
  if (s.tiktok) links.push(['tiktok', 'تيك توك', `https://www.tiktok.com/@${encodeURIComponent(s.tiktok)}`]);
  if (s.x_handle) links.push(['x', 'إكس', `https://x.com/${encodeURIComponent(s.x_handle)}`]);
  return links;
}

function socialLinks(s) {
  return socialList(s).map(([key, label, href]) =>
    `<a class="icon-btn" href="${href}" target="_blank" rel="noopener" title="${label}" aria-label="${label}" data-click="${escapeHtml(s.id)}">${ICONS[key]}</a>`).join('');
}

// الزر الرئيسي: رابط المتجر، أو أول حساب تواصل للمتاجر التي تبيع عبر حساباتها فقط
function primaryLink(s) {
  const url = safeUrl(s.url);
  if (url) return { href: url, label: 'زيارة المتجر ↗' };
  const [first] = socialList(s);
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

function cardHtml(s) {
  const main = primaryLink(s);
  const delivery = (s.delivery || []).filter(d => DELIVERY[d]);
  return `
    <li class="card${s.id === state.selectedId ? ' selected' : ''}" data-id="${escapeHtml(s.id)}" tabindex="0">
      <div class="card-top">
        ${logoHtml(s)}
        <div class="card-head">
          <h2>${escapeHtml(s.name)}</h2>
          <p class="meta">📍 ${escapeHtml(mainLoc(s).city)}${mainLoc(s).district ? ` · ${escapeHtml(mainLoc(s).district)}` : ''}${s.locs.length > 1 ? ` <span class="more-locs">+${s.locs.length - 1} ${s.locs.length === 2 ? 'موقع آخر' : 'مواقع أخرى'}</span>` : ''}</p>
        </div>
        ${s.pinned ? '<span class="badge badge-pin">📌 مثبّت</span>' : ''}
        ${s.km != null ? `<span class="badge badge-distance">${formatDistance(s.km)}</span>` : ''}
        ${s.pending ? '<span class="badge badge-pending">قيد المراجعة</span>' : ''}
      </div>
      <p class="tags">
        ${s.cats.map(c => `<span class="tag">${CATEGORY_ICONS[c] || '🛍️'} ${escapeHtml(c)}</span>`).join('')}
        ${ENTITY_TYPES[s.entity_type] ? `<span class="tag tag-entity">${ENTITY_TYPES[s.entity_type].icon} ${ENTITY_TYPES[s.entity_type].label}</span>` : ''}
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

function popupHtml(s, loc) {
  const main = primaryLink(s);
  return `<div class="popup">
    <strong>${CATEGORY_ICONS[s.category] || '🛍️'} ${escapeHtml(s.name)}</strong>
    <span>${escapeHtml(s.cats.join('، '))} · ${escapeHtml(loc.city)}${loc.district ? ` · ${escapeHtml(loc.district)}` : ''}</span>
    ${main ? `<a href="${escapeHtml(main.href)}" target="_blank" rel="noopener" data-click="${escapeHtml(s.id)}">${main.label}</a>` : ''}
  </div>`;
}

function gateHtml() {
  const browseAll = '<span class="gate-or">أو اختر منطقتك ومدينتك من الأعلى، أو <button type="button" class="link-btn" data-action="browse-all">تصفح كل المتاجر</button></span>';
  if (state.geoDenied) {
    return `<span class="big">🔒</span><strong>الموقع مقفل في متصفحك</strong>
      <span>عشان تطلع لك المتاجر القريبة، اسمح للموقع من إعدادات المتصفح (اضغط على القفل 🔒 جنب الرابط ← الموقع ← سماح)، ثم حدّث الصفحة.</span>${browseAll}`;
  }
  return `<span class="big">📍</span><strong>فعّل الموقع عشان تطلع لك المتاجر القريبة منك</strong>
    <span>نستخدم موقعك بس لترتيب المتاجر حسب المسافة، وما نحفظه.</span>
    <button type="button" class="btn btn-primary btn-pop" data-action="locate-me">📍 تفعيل الموقع</button>${browseAll}`;
}

function gateOff() {
  state.gate = false;
  leaveShared();
}

// ---- رابط مشاركة متجر (#store=…) ----
function applyShared() {
  const m = /^#store=([\w-]{1,64})$/.exec(location.hash);
  state.shared = m ? m[1] : null;
  if (state.shared) state.gate = false;
}

function leaveShared() {
  if (!state.shared) return;
  state.shared = null;
  if (location.hash.startsWith('#store=')) history.replaceState(null, '', location.pathname + location.search);
}

function toast(message) {
  let el = document.getElementById('browseToast');
  if (!el) {
    el = Object.assign(document.createElement('div'), { id: 'browseToast', className: 'toast toast-ok', hidden: true });
    el.setAttribute('role', 'status');
    document.body.append(el);
  }
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { el.hidden = true; }, 3200);
}

async function shareStore(id) {
  const s = state.results.find(x => x.id === id);
  if (!s) return;
  const url = `${location.origin}${location.pathname}#store=${encodeURIComponent(id)}`;
  try {
    if (navigator.share) {
      await navigator.share({ title: s.name, text: `${s.name} على دكان الحي`, url });
      return;
    }
  } catch (err) {
    if (err?.name === 'AbortError') return;
  }
  try {
    await navigator.clipboard.writeText(url);
    toast('🔗 تم نسخ رابط المتجر، الصقه وشاركه');
  } catch {
    prompt('انسخ رابط المتجر:', url);
  }
}

// ---- إحصائيات ظهور المتاجر لأصحابها ----
// بعد استقرار الفلاتر نرسل دفعة واحدة: المتاجر الظاهرة + كلمة البحث + مدينة الباحث (بدون بيانات شخصية)
let impressionTimer = null;
const loggedImpressions = new Set();

function searcherCity() {
  if (state.eff.city) return state.eff.city;
  if (state.userLoc) return nearestCity(state.userLoc.lat, state.userLoc.lng)?.city || '';
  return state.eff.region;
}

function scheduleImpressions(rows) {
  clearTimeout(impressionTimer);
  impressionTimer = setTimeout(() => {
    const term = els.q.value.trim().toLowerCase().slice(0, 40);
    const city = searcherCity();
    const ids = rows.filter(s => !s.pending).slice(0, 30).map(s => s.id).filter(id => {
      const key = `${id}|${term}|${city}`;
      if (loggedImpressions.has(key)) return false;
      loggedImpressions.add(key);
      return true;
    });
    logImpressions(ids, term, city);
  }, 1500);
}

function moreHtml(list) {
  const shown = state.results.length;
  if (!list.length || shown >= state.total) return '';
  if (shown >= state.maxOffset + state.pageSize) {
    return `<li class="list-more"><span>نعرض ${state.userLoc ? 'أقرب' : 'أحدث'} ${storesCountLabel(shown)} من ${state.total}. اختر مدينتك أو التصنيف أو ابحث بالاسم عشان تلقى غيرها.</span></li>`;
  }
  return `<li class="list-more"><button type="button" class="btn btn-ghost" data-action="more">عرض المزيد <small>(${shown} من ${state.total})</small></button></li>`;
}

function cityIcon(label, city = '') {
  return L.divIcon({
    className: 'city-count', html: `<span>${label}</span>${city ? `<b>${escapeHtml(city)}</b>` : ''}`, iconSize: [60, 60],
  });
}

// فقاعات بعدد المتاجر في كل مدينة غير المعروضة في القائمة (الضغط عليها يختار المدينة)
function renderCities(list) {
  cityLayer.clearLayers();
  const shown = new Map();
  for (const s of list) {
    for (const key of new Set(s.shownLocs.map(l => `${l.region}|${l.city}`))) shown.set(key, (shown.get(key) || 0) + 1);
  }
  for (const c of state.cities) {
    const rest = c.count - (shown.get(`${c.region}|${c.city}`) || 0);
    const place = REGIONS.find(r => r.name === c.region)?.cities.find(x => x.name === c.city);
    if (rest <= 0 || !place) continue;
    const label = shown.has(`${c.region}|${c.city}`) ? `+${rest}` : String(rest);
    L.marker([place.lat, place.lng], { icon: cityIcon(label, c.city), keyboard: false, count: rest })
      .bindTooltip(`${storesCountLabel(rest)} ${shown.has(`${c.region}|${c.city}`) ? 'أخرى ' : ''}في ${c.city} · اضغط للعرض`)
      .on('click', () => pickCity(c.region, c.city))
      .addTo(cityLayer);
  }
}

function pickCity(region, city) {
  els.region.value = region;
  updateCities();
  els.city.value = city;
  els.city.dispatchEvent(new Event('change'));
}

// ما فهمناه من البحث (قابل للإلغاء)، ورسالة إذا عرضنا نتائج قريبة بدل المطابقة الكاملة
function renderIntent() {
  const it = state.intent;
  const parts = [];
  if (state.shared) {
    parts.push('<span class="intent-label">🔗 متجر شاركه معك أحدهم</span><button type="button" class="link-btn" data-intent="leave-shared">تصفح المتاجر القريبة ←</button>');
  } else if (it?.interpreted) {
    parts.push('<span class="intent-label">🧠 فهمت من بحثك:</span>');
    for (const c of it.chips) {
      const needsLoc = c.key === 'near' && !state.userLoc;
      parts.push(`<span class="intent-chip${c.info ? ' info' : ''}"><button type="button" data-intent="${escapeHtml(c.key)}" data-kind="${needsLoc ? 'locate' : 'info'}">${escapeHtml(c.label)}${needsLoc ? ' · فعّل الموقع' : ''}</button><button type="button" data-dismiss="${escapeHtml(c.key)}" aria-label="إلغاء: ${escapeHtml(c.label)}">✕</button></span>`);
    }
  }
  if (state.relaxed && !state.shared) parts.push('<span class="intent-relax">ما لقينا متجر يطابق كل كلماتك، فعرضنا الأقرب لها أولًا.</span>');
  els.intent.innerHTML = parts.join('');
  els.intent.hidden = !parts.length;
}

els.intent.addEventListener('click', e => {
  if (e.target.closest('[data-intent="leave-shared"]')) {
    leaveShared();
    state.gate = false;
    scheduleSearch({ fit: true });
    return;
  }
  const dismiss = e.target.closest('[data-dismiss]');
  if (dismiss) {
    state.dismissed.add(dismiss.dataset.dismiss);
    scheduleSearch({ fit: true });
    return;
  }
  if (e.target.closest('[data-kind="locate"]')) els.nearMe.click();
});

// ---- البنر الإعلاني تحت الخريطة (يختاره المشرف حسب المنطقة والمدة) ----
let bannerRegion = null;

let bannerSlides = [];
let bannerIndex = 0;
let bannerTimer = null;

// إعلان واحد ثابت، أو عدة إعلانات تتبدل كل 6 ثوانٍ مع نقاط للتنقل
function renderBanners(list) {
  clearInterval(bannerTimer);
  bannerSlides = list;
  bannerIndex = 0;
  if (!list.length) {
    els.banner.hidden = true;
    els.banner.innerHTML = '';
    return;
  }
  showBanner(0);
  if (list.length > 1) bannerTimer = setInterval(() => { if (!els.banner.matches(':hover')) showBanner(bannerIndex + 1); }, 6000);
}

function showBanner(i) {
  bannerIndex = (i + bannerSlides.length) % bannerSlides.length;
  renderBanner(bannerSlides[bannerIndex]);
  if (bannerSlides.length > 1) {
    els.banner.insertAdjacentHTML('beforeend', `<span class="ad-dots">${bannerSlides.map((_, k) =>
      `<button type="button" data-slide="${k}" class="${k === bannerIndex ? 'on' : ''}" aria-label="إعلان ${k + 1}"></button>`).join('')}</span>`);
  }
}

function renderBanner(b) {
  const link = safeUrl(b.link_url);
  const image = b.image_url && safeUrl(b.image_url);
  const inner = `${image ? `<img src="${escapeHtml(image)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}
    <span class="ad-text"><small class="ad-tag">إعلان</small><strong>${escapeHtml(b.title)}</strong>${b.body ? `<span>${escapeHtml(b.body)}</span>` : ''}</span>
    ${link && b.button_label ? `<span class="ad-btn">${escapeHtml(b.button_label)}</span>` : ''}`;
  els.banner.className = `ad-banner ad-${['violet', 'coral', 'lime', 'sky', 'ink'].includes(b.theme) ? b.theme : 'violet'}`;
  els.banner.innerHTML = link
    ? `<a href="${escapeHtml(link)}" target="_blank" rel="sponsored noopener" data-banner="${escapeHtml(String(b.id))}">${inner}</a>`
    : `<div class="ad-static">${inner}</div>`;
  els.banner.hidden = false;
}

async function refreshBanner() {
  const region = state.eff.region || (state.userLoc ? nearestCity(state.userLoc.lat, state.userLoc.lng)?.region : '') || '';
  if (region === bannerRegion) return;
  bannerRegion = region;
  const [banners, pinned] = await Promise.all([getBanners(region), getPinnedStores(region)]);
  if (region !== bannerRegion) return;
  renderBanners(banners);
  const next = pinned.map(s => ({ ...s, id: String(s.id), locs: storeLocations(s), cats: storeCategories(s) }));
  if (next.map(s => s.id).join() !== state.pinned.map(s => s.id).join()) {
    state.pinned = next;
    render();
  }
}

els.banner.addEventListener('click', e => {
  const dot = e.target.closest('[data-slide]');
  if (dot) {
    showBanner(Number(dot.dataset.slide));
    return;
  }
  const link = e.target.closest('[data-banner]');
  if (link) bannerClick(link.dataset.banner);
});

function render({ fit = false } = {}) {
  els.list.classList.remove('is-loading');
  const gated = state.gate && !state.userLoc;
  const list = gated ? [] : rows();
  if (!gated) scheduleImpressions(list);
  els.count.textContent = state.error && !list.length ? 'تعذر التحميل'
    : gated ? '📍 المتاجر القريبة منك' : storesCountLabel(state.total);
  els.subtitle.textContent = gated ? 'فعّل موقعك، أو اختر منطقتك ومدينتك'
    : state.shared ? 'متجر شاركه معك أحدهم' : state.userLoc ? 'مرتبة من الأقرب لك' : (state.eff.city || state.eff.region || 'في كل المملكة');
  renderIntent();
  refreshBanner();
  els.list.innerHTML = list.map(cardHtml).join('') + moreHtml(list);
  els.list.querySelectorAll('.avatar img').forEach(img => img.addEventListener('error', () => {
    const avatar = img.parentElement;
    avatar.classList.add('avatar-violet');
    avatar.textContent = img.dataset.initial;
  }, { once: true }));

  els.status.hidden = list.length > 0 && !gated && !state.error;
  els.status.classList.toggle('gate', gated && !state.error);
  if (state.error) {
    els.status.innerHTML = `<span class="big">⏳</span><strong>${escapeHtml(state.error)}</strong>`;
  } else if (gated) {
    els.status.innerHTML = gateHtml();
  } else if (!list.length && state.userLoc && els.radius.value) {
    els.status.innerHTML = `<span class="big">📍</span><strong>ما فيه متاجر خلال ${escapeHtml(els.radius.value)} كم منك</strong><span>وسّع المسافة أو تصفح كل المتاجر.</span><button type="button" class="btn btn-primary btn-sm" data-action="widen">وسّع البحث</button>`;
  } else if (!list.length) {
    els.status.innerHTML = hasFilters()
      ? '<span class="big">🔍</span><strong>ما لقينا متاجر بهالفلاتر</strong><span>جرّب توسّع البحث أو تغيّر التصنيف.</span>'
      : '<span class="big">🛍️</span><strong>ما فيه متاجر للحين</strong><span>كن أول متجر في حيّك!</span><a class="btn btn-primary btn-sm" href="#add">أضف متجرك</a>';
  }

  cluster.clearLayers();
  markers.clear();
  for (const s of list) {
    const pins = s.shownLocs.map(l => {
      const m = L.marker([l.lat, l.lng], {
        icon: pinIcon('store', CATEGORY_ICONS[s.category]), title: s.name,
      }).bindPopup(popupHtml(s, l));
      m.on('click', () => select(s.id, { fromMap: true }));
      cluster.addLayer(m);
      return m;
    });
    // أقرب موقع أولًا حتى يقرّب عليه زر «على الخريطة»
    if (s.nearest) pins.unshift(pins.splice(s.nearest, 1)[0]);
    markers.set(String(s.id), pins);
  }
  renderCities(list);

  if (fit && list.length) {
    const points = list.flatMap(s => s.shownLocs.map(l => [l.lat, l.lng]));
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
  const marker = markers.get(String(id))?.[0];
  if (marker && !fromMap) {
    cluster.zoomToShowLayer(marker, () => marker.openPopup());
  }
}

els.list.addEventListener('click', e => {
  if (e.target.closest('a')) return;
  if (e.target.closest('[data-action="share"]')) {
    shareStore(e.target.closest('.card').dataset.id);
    return;
  }
  if (e.target.closest('[data-action="report"]')) {
    openReport(e.target.closest('.card').dataset.id);
    return;
  }
  const more = e.target.closest('[data-action="more"]');
  if (more) {
    more.disabled = true;
    more.textContent = 'جارٍ التحميل…';
    search({ append: true });
    return;
  }
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
  gateOff();
  state.category = chip.dataset.value;
  els.chips.querySelectorAll('.chip').forEach(c => {
    c.classList.toggle('active', c === chip);
    c.setAttribute('aria-pressed', String(c === chip));
  });
  scheduleSearch({ fit: true });
});

els.q.addEventListener('input', () => {
  gateOff();
  scheduleSearch({}, 400);
});
els.radius.addEventListener('change', () => scheduleSearch({ fit: true }));
els.entity.addEventListener('change', () => {
  gateOff();
  scheduleSearch({ fit: true });
});
// اختيار منطقة أو مدينة يعني تصفحها: نلغي حد المسافة ونبقي الترتيب حسب القرب
function clearRadius() {
  if (state.userLoc) els.radius.value = '';
}

els.region.addEventListener('change', () => {
  gateOff();
  clearRadius();
  updateCities();
  scheduleSearch({ fit: true });
  storage('dukkan.region', els.region.value);
});
els.city.addEventListener('change', () => {
  gateOff();
  clearRadius();
  const region = REGIONS.find(r => r.name === els.region.value);
  const city = region?.cities.find(c => c.name === els.city.value);
  scheduleSearch({ fit: !city });
  if (city) map.flyTo([city.lat, city.lng], 11);
  storage('dukkan.city', els.city.value);
});

// ---- «القريبة مني» ----

let geoNoteTimer = null;
function showGeoNote(text, kind = 'info', autoHide = false) {
  clearTimeout(geoNoteTimer);
  els.geoNote.textContent = text;
  els.geoNote.className = `geo-note geo-${kind}`;
  els.geoNote.hidden = !text;
  if (autoHide) geoNoteTimer = setTimeout(() => { els.geoNote.hidden = true; }, 4000);
}

// تقريب الخريطة على المستخدم: نُظهر أقرب المتاجر معه، أو نقرّب عليه إن لم يوجد متاجر قريبة
function focusUser(accuracy = 0) {
  const { lat, lng } = state.userLoc;
  const near = rows().slice(0, 15);
  if (near.length) {
    const points = near.map(s => [mainLoc(s).lat, mainLoc(s).lng]);
    points.push([lat, lng]);
    map.fitBounds(L.latLngBounds(points), { padding: [50, 50], maxZoom: 15 });
  } else {
    map.setView([lat, lng], accuracy > 5000 ? 11 : accuracy > 1000 ? 13 : 15);
  }
}

async function setUserLocation(p, { manual = false } = {}) {
  if (!state.userLoc) {
    // البحث بالقرب يتجاوز فلتر المنطقة والمدينة
    els.region.value = '';
    updateCities();
    els.radius.hidden = false;
    if (!els.radius.value) els.radius.value = '25';
  }
  state.userLoc = { lat: p.lat, lng: p.lng };
  const ll = [p.lat, p.lng];
  if (!userMarker) {
    userMarker = L.marker(ll, { icon: userIcon, zIndexOffset: 1000, draggable: true })
      .bindTooltip('أنت هنا · اسحبني لتعديل موقعك')
      .addTo(map);
    userMarker.on('dragend', () => {
      const q = userMarker.getLatLng();
      setUserLocation({ lat: q.lat, lng: q.lng }, { manual: true });
      showGeoNote('📍 عدّلت موقعك يدويًا', 'ok', true);
    });
  } else {
    userMarker.setLatLng(ll);
  }
  accuracyCircle?.remove();
  accuracyCircle = null;
  if (!manual && p.accuracy > 30) {
    accuracyCircle = L.circle(ll, {
      radius: p.accuracy, color: '#2fb8ff', weight: 1, fillOpacity: 0.08, interactive: false,
    }).addTo(map);
  }
  const applied = await scheduleSearch({}, 300);
  if (applied && !manual) focusUser(p.accuracy);
}

const nearMeLabel = els.nearMe.innerHTML;
els.nearMe.addEventListener('click', async () => {
  els.nearMe.disabled = true;
  els.nearMe.textContent = 'جارٍ تحديد موقعك…';
  showGeoNote('📡 نحدد موقعك بدقة، لحظات…');
  try {
    const best = await locate({ onUpdate: p => setUserLocation(p) });
    els.nearMe.classList.add('active');
    if (best.accuracy > 1500) {
      showGeoNote(`⚠️ موقعك تقريبي (${accuracyLabel(best.accuracy)}). اسحب النقطة الزرقاء لمكانك الصحيح، أو جرّب من الجوال مع تشغيل الـ GPS.`, 'warn');
    } else {
      showGeoNote(`📍 تم تحديد موقعك (${accuracyLabel(best.accuracy)})`, 'ok', true);
    }
  } catch (err) {
    if (err?.code === 1) {
      state.geoDenied = true;
      showGeoNote('');
      render();
    } else {
      showGeoNote(geoErrorMessage(err), 'warn');
    }
  } finally {
    els.nearMe.disabled = false;
    els.nearMe.innerHTML = nearMeLabel;
  }
});

els.status.addEventListener('click', e => {
  const action = e.target.closest('[data-action]')?.dataset.action;
  if (action === 'widen') {
    els.radius.value = '';
    scheduleSearch({ fit: true });
  } else if (action === 'locate-me') {
    els.nearMe.click();
  } else if (action === 'browse-all') {
    gateOff();
    scheduleSearch({ fit: true });
  }
});

// ---- البلاغ عن متجر ----

const report = {
  dialog: $('reportDialog'), form: $('reportForm'), error: $('reportError'), storeId: null,
};
$('reportReasons').innerHTML = Object.entries(REPORT_REASONS).map(([key, r]) =>
  `<label class="toggle"><input type="radio" name="reason" value="${key}" required><span>${r.icon} ${r.label}</span></label>`).join('');

function openReport(id) {
  const s = state.results.find(x => x.id === id);
  if (!s) return;
  report.storeId = id;
  report.form.reset();
  report.form.classList.remove('validated');
  report.error.hidden = true;
  report.form.querySelector('.report-body').hidden = false;
  report.form.querySelector('.report-done').hidden = true;
  $('reportStore').textContent = s.name;
  $('reportDetailsHint').textContent = '(اختياري)';
  report.dialog.showModal();
}

report.form.addEventListener('change', e => {
  if (e.target.name !== 'reason') return;
  const other = e.target.value === 'other';
  report.form.details.required = other;
  $('reportDetailsHint').textContent = other ? '(مطلوب)' : '(اختياري)';
});
report.dialog.addEventListener('click', e => {
  // الضغط خارج النافذة أو على زر الإغلاق
  if (e.target === report.dialog || e.target.closest('[data-close]')) report.dialog.close();
});
report.form.addEventListener('submit', async e => {
  e.preventDefault();
  const f = report.form;
  report.error.hidden = true;
  f.classList.add('validated');
  if (!f.reason.value) {
    report.error.textContent = 'اختر سبب البلاغ.';
    report.error.hidden = false;
    return;
  }
  if (!f.checkValidity()) {
    report.error.textContent = 'اكتب تفاصيل البلاغ.';
    report.error.hidden = false;
    return;
  }
  const button = f.querySelector('[type="submit"]');
  button.disabled = true;
  try {
    // الحقل المخفي يعبّيه البوت فقط: نتظاهر بالنجاح بدون إرسال
    if (!f.website.value) {
      await submitReport({
        storeId: report.storeId, reason: f.reason.value, details: f.details.value.trim(), contact: f.contact.value.trim(),
      });
    }
    f.querySelector('.report-body').hidden = true;
    f.querySelector('.report-done').hidden = false;
  } catch (err) {
    report.error.textContent = err.message;
    report.error.hidden = false;
  } finally {
    button.disabled = false;
  }
});

// إحصائيات لوحة التحكم: زيارة واحدة لكل جلسة، ونقرة لكل فتح متجر
document.addEventListener('click', e => {
  const link = e.target.closest('a[data-click]');
  if (link) logEvent('store_click', link.dataset.click);
});
try {
  if (!sessionStorage.getItem('dukkan.visited')) {
    sessionStorage.setItem('dukkan.visited', '1');
    logEvent('visit');
  }
} catch {
  logEvent('visit');
}

window.addEventListener('hashchange', () => {
  if (document.body.dataset.view !== 'browse') return;
  const before = state.shared;
  applyShared();
  if (state.shared !== before) scheduleSearch({ fit: true });
});

async function init() {
  applyShared();
  const savedRegion = storage('dukkan.region');
  if (!state.shared && savedRegion && REGIONS.some(r => r.name === savedRegion)) {
    gateOff();
    els.region.value = savedRegion;
    updateCities();
    const savedCity = storage('dukkan.city');
    if (savedCity && [...els.city.options].some(o => o.value === savedCity)) els.city.value = savedCity;
  }

  // إذا سبق وسمح بالموقع نحدده تلقائيًا، وإذا رفضه نوضح له كيف يفعّله
  let permission = null;
  try {
    permission = await navigator.permissions?.query({ name: 'geolocation' });
  } catch { /* متصفح لا يدعم الاستعلام */ }
  if (permission) {
    state.geoDenied = permission.state === 'denied';
    permission.onchange = () => {
      state.geoDenied = permission.state === 'denied';
      if (permission.state === 'granted' && !state.userLoc) els.nearMe.click();
      else render();
    };
  }

  // قبل تفعيل الموقع نجيب عدد المتاجر في كل مدينة فقط لفقاعات الخريطة
  await scheduleSearch({ fit: !state.gate });
  if (permission?.state === 'granted' && !state.userLoc) els.nearMe.click();
}

init();

// عند الرجوع للتصفح من قسم آخر: نعيد ضبط حجم الخريطة ونحدّث القائمة (قد يكون متجر اعتُمد أو أُضيف)
let shown = false;
export function onShow() {
  if (!shown) {
    shown = true;
    return;
  }
  map.invalidateSize();
  refreshStores();
  applyShared();
  scheduleSearch({ fit: Boolean(state.shared) });
}
