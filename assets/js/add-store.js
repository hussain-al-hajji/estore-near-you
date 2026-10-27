import { REGIONS, DELIVERY, DELIVERY_ICONS, SA_CENTER, SA_ZOOM } from './constants.js';
import {
  CATEGORIES, CATEGORY_ICONS, SETTINGS, priceFor, graceFor, graceLabel, badgeText, pricingText, isLaunchPeriod, formatDate,
} from './settings.js';
import { submitStore, isDemo } from './api.js';
import { createMap, pinIcon } from './map.js';
import { locate, accuracyLabel, geoErrorMessage, searchPlaces, reverseGeocode } from './geo.js';
import {
  inSaudi, nearestCity, parseLocation, normalizeUrl, normalizeHandle, normalizePhone, safeUrl, escapeHtml,
} from './utils.js';

const form = document.getElementById('storeForm');
const f = form.elements;
const $ = id => document.getElementById(id);

if (isDemo) $('addDemoBanner').hidden = false;

for (const r of REGIONS) f.region.add(new Option(r.name, r.name));
$('deliveryChecks').innerHTML = Object.entries(DELIVERY).map(([value, label]) =>
  `<label class="toggle"><input type="checkbox" name="delivery" value="${value}"><span>${DELIVERY_ICONS[value]} ${label}</span></label>`).join('');

// نصوص النموذج والأسعار والتصنيفات والحقول الاختيارية من إعدادات لوحة التحكم
const TEXT_FIELDS = ['logo_url', 'description', 'district', 'cr_number'];
function applyFormSettings() {
  const fs = SETTINGS.form;
  $('formTitle').textContent = fs.title;
  $('formSubtitle').textContent = fs.subtitle;
  const badge = badgeText();
  $('formBadge').textContent = badge;
  $('formBadge').hidden = !badge;
  $('termsText').textContent = fs.terms;
  $('formDisclaimer').textContent = SETTINGS.legal.disclaimer;
  $('successText').textContent = fs.success;
  $('pricingNote').textContent = `💳 ${pricingText()}`;
  const launch = isLaunchPeriod() ? `\nمجاني حتى ${formatDate(SETTINGS.pricing.launch_end)}` : '';
  for (const el of form.querySelectorAll('[data-price]')) {
    const type = el.dataset.price;
    el.textContent = `${priceFor(type)} ر.س سنويًا · مهلة السداد ${graceLabel(graceFor(type))}${launch}`;
  }

  const current = f.category.value;
  f.category.length = 1;
  for (const c of CATEGORIES) f.category.add(new Option(`${CATEGORY_ICONS[c]}  ${c}`, c));
  if (CATEGORIES.includes(current)) f.category.value = current;

  for (const wrap of form.querySelectorAll('[data-field]')) {
    const cfg = fs.fields[wrap.dataset.field] || { visible: true, required: false };
    const required = cfg.visible && cfg.required;
    wrap.hidden = !cfg.visible;
    const opt = wrap.querySelector('.opt');
    opt.textContent = required ? '*' : '(اختياري)';
    opt.classList.toggle('req', required);
    for (const input of wrap.querySelectorAll('input, textarea')) {
      if (TEXT_FIELDS.includes(input.name)) input.required = required;
    }
  }
}

function updateEntity() {
  const type = f.entity_type.value;
  $('crLabel').textContent = type === 'company' ? 'رقم السجل التجاري'
    : type === 'freelance' ? 'رقم وثيقة العمل الحر أو شهادة الأسر المنتجة'
      : 'رقم السجل التجاري أو وثيقة العمل الحر';
}

function updateRole() {
  const employee = f.registrant_role.value === 'employee';
  $('titleField').hidden = !employee;
  f.registrant_title.required = employee;
}

form.querySelectorAll('input[name="entity_type"]').forEach(r => r.addEventListener('change', updateEntity));
form.querySelectorAll('input[name="registrant_role"]').forEach(r => r.addEventListener('change', updateRole));
applyFormSettings();
updateEntity();
updateRole();

// ---- المواقع (واحد أو أكثر) ----
// الحقول المنطقة/المدينة/الحي تعرض بيانات الموقع النشط، والخريطة تعرض كل المواقع بدبابيس مرقمة
const MAX_LOCATIONS = 10;
const map = createMap('pickerMap');
const emptyLocation = () => ({ lat: null, lng: null, region: '', city: '', district: '', place: '', accuracy: null });
let locations = [emptyLocation()];
let active = 0;
let markers = [];
let geoToken = 0;

function updateCities(selected = '') {
  const region = REGIONS.find(r => r.name === f.region.value);
  f.city.length = 1;
  f.city.disabled = !region;
  if (region) for (const c of region.cities) f.city.add(new Option(c.name, c.name));
  if (selected) f.city.value = selected;
}

function showLinkError(msg) {
  $('linkError').textContent = msg;
  $('linkError').hidden = !msg;
}

function loadFields() {
  const loc = locations[active];
  f.region.value = loc.region;
  updateCities(loc.city);
  f.district.value = loc.district;
}

function renderCoords() {
  const loc = locations[active];
  const el = $('coords');
  el.classList.toggle('ok', loc.lat !== null);
  if (loc.lat === null) {
    el.textContent = locations.length > 1 ? `حدد مكان الموقع ${active + 1} على الخريطة` : 'لم يُحدد الموقع بعد';
    return;
  }
  const place = loc.place ? `📍 ${loc.place}` : 'الموقع المحدد';
  const acc = loc.accuracy ? ` · دقة ${accuracyLabel(loc.accuracy)}` : '';
  el.textContent = `${place}${acc} (${loc.lat.toFixed(5)}, ${loc.lng.toFixed(5)})`;
}

function renderTabs() {
  const tabs = locations.map((loc, i) => `
    <button type="button" class="loc-tab${i === active ? ' active' : ''}${loc.lat === null ? ' empty' : ''}" data-loc="${i}" role="tab" aria-selected="${i === active}">
      <b>${i + 1}</b> ${escapeHtml(loc.district || loc.city || (loc.lat === null ? 'غير محدد' : 'موقع'))}
      ${locations.length > 1 ? `<span class="loc-remove" data-remove="${i}" title="حذف الموقع" aria-label="حذف الموقع ${i + 1}">✕</span>` : ''}
    </button>`).join('');
  const add = locations.length < MAX_LOCATIONS
    ? '<button type="button" class="loc-tab add" data-add-loc>+ إضافة موقع آخر</button>' : '';
  $('locTabs').innerHTML = tabs + add;
}

function renderMarkers() {
  markers.forEach(m => m?.remove());
  markers = locations.map((loc, i) => {
    if (loc.lat === null) return null;
    const m = L.marker([loc.lat, loc.lng], {
      draggable: true,
      icon: pinIcon('store', locations.length > 1 ? String(i + 1) : CATEGORY_ICONS[f.category.value]),
      zIndexOffset: i === active ? 1000 : 0,
      opacity: i === active ? 1 : 0.75,
    }).addTo(map);
    m.on('click', () => selectLocation(i));
    m.on('dragend', () => {
      const p = m.getLatLng();
      if (active !== i) selectLocation(i, { fly: false });
      setLocation(p.lat, p.lng, { fly: false });
    });
    return m;
  });
}

function refreshAll() {
  renderTabs();
  renderMarkers();
  renderCoords();
}

function selectLocation(i, { fly = true } = {}) {
  active = i;
  loadFields();
  refreshAll();
  showLinkError('');
  const loc = locations[i];
  if (fly && loc.lat !== null) map.flyTo([loc.lat, loc.lng], Math.max(map.getZoom(), 14));
}

function setLocation(lat, lng, { fly = true, accuracy = null } = {}) {
  if (!inSaudi(lat, lng)) {
    showLinkError('الموقع المحدد خارج المملكة.');
    return;
  }
  const loc = locations[active];
  Object.assign(loc, { lat, lng, accuracy, place: '' });
  // نقترح المنطقة والمدينة الأقرب، ويمكن لصاحب المتجر تعديلها
  const near = nearestCity(lat, lng);
  if (near && near.km < 60) {
    loc.region = near.region;
    loc.city = near.city;
  }
  loadFields();
  if (fly) map.flyTo([lat, lng], Math.max(map.getZoom(), 15));
  $('pickerMap').classList.remove('invalid');
  showLinkError('');
  refreshAll();

  // اسم الحي والمدينة الفعليين، حتى يتأكد صاحب المتجر أن الدبوس في المكان الصحيح
  const token = ++geoToken;
  const index = active;
  reverseGeocode(lat, lng).then(info => {
    if (!info || token !== geoToken) return;
    const target = locations[index];
    target.place = info.label;
    if (!target.district && info.district) {
      target.district = info.district;
      if (index === active) f.district.value = info.district;
    }
    refreshAll();
  });
}

f.region.addEventListener('change', () => {
  updateCities();
  locations[active].region = f.region.value;
  locations[active].city = '';
  const region = REGIONS.find(r => r.name === f.region.value);
  if (region && locations[active].lat === null) map.flyTo([region.cities[0].lat, region.cities[0].lng], 9);
});
f.city.addEventListener('change', () => {
  locations[active].city = f.city.value;
  const city = REGIONS.find(r => r.name === f.region.value)?.cities.find(c => c.name === f.city.value);
  if (city && locations[active].lat === null) map.flyTo([city.lat, city.lng], 12);
  renderTabs();
});
f.district.addEventListener('input', () => {
  locations[active].district = f.district.value;
  renderTabs();
});

$('locTabs').addEventListener('click', e => {
  const remove = e.target.closest('[data-remove]');
  if (remove) {
    const i = Number(remove.dataset.remove);
    locations.splice(i, 1);
    selectLocation(Math.min(active > i ? active - 1 : active, locations.length - 1));
    return;
  }
  if (e.target.closest('[data-add-loc]')) {
    locations.push(emptyLocation());
    selectLocation(locations.length - 1);
    showLinkError('');
    $('coords').textContent = `اضغط على الخريطة أو ابحث لتحديد الموقع ${locations.length}`;
    return;
  }
  const tab = e.target.closest('[data-loc]');
  if (tab) selectLocation(Number(tab.dataset.loc));
});

map.on('click', e => setLocation(e.latlng.lat, e.latlng.lng, { fly: false }));
f.category.addEventListener('change', renderMarkers);

// ---- البحث عن مكان أو لصق رابط ----
function hideResults() {
  $('searchResults').hidden = true;
  $('searchResults').innerHTML = '';
}

$('parseLink').addEventListener('click', async () => {
  const text = $('mapLink').value.trim();
  if (!text) return showLinkError('اكتب اسم الحي أو المدينة، أو الصق رابط الموقع.');
  const parsed = parseLocation(text);
  if (!parsed.error) {
    hideResults();
    setLocation(parsed.lat, parsed.lng);
    return;
  }
  // ليس رابطًا أو إحداثيات: نبحث بالاسم
  if (/^https?:|goo\.gl|maps\.app/i.test(text)) return showLinkError(parsed.error);
  const btn = $('parseLink');
  btn.disabled = true;
  try {
    const results = await searchPlaces(text);
    if (!results.length) {
      hideResults();
      return showLinkError('ما لقينا نتائج، جرّب اسم الحي مع المدينة، مثل: الخصاب سيهات.');
    }
    showLinkError('');
    $('searchResults').innerHTML = results.map((r, i) =>
      `<li><button type="button" data-result="${i}">📍 ${escapeHtml(r.label)}</button></li>`).join('');
    $('searchResults').hidden = false;
    $('searchResults').results = results;
  } catch (err) {
    showLinkError(err.message);
  } finally {
    btn.disabled = false;
  }
});
$('searchResults').addEventListener('click', e => {
  const btn = e.target.closest('[data-result]');
  if (!btn) return;
  const r = $('searchResults').results[Number(btn.dataset.result)];
  hideResults();
  setLocation(r.lat, r.lng);
  map.setZoom(15);
});
$('mapLink').addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    e.preventDefault();
    $('parseLink').click();
  } else if (e.key === 'Escape') {
    hideResults();
  }
});

const useMyLocationLabel = $('useMyLocation').innerHTML;
$('useMyLocation').addEventListener('click', async () => {
  const btn = $('useMyLocation');
  btn.disabled = true;
  btn.textContent = 'جارٍ تحديد موقعك…';
  try {
    const best = await locate({ onUpdate: p => setLocation(p.lat, p.lng, { accuracy: p.accuracy }) });
    if (best.accuracy > 300) {
      showLinkError(`⚠️ دقة موقع جهازك ضعيفة (${accuracyLabel(best.accuracy)}) وقد يكون بعيدًا عن مكانك. تأكد من اسم الحي تحت الخريطة، وإذا كان غلط ابحث باسم حيّك أو اسحب الدبوس.`);
    }
  } catch (err) {
    showLinkError(`${geoErrorMessage(err)} وتقدر تبحث باسم الحي أو تحدده يدويًا على الخريطة.`);
  } finally {
    btn.disabled = false;
    btn.innerHTML = useMyLocationLabel;
  }
});

refreshAll();

// ---- الإرسال ----
// نمسح رسائل التحقق المخصصة عند التعديل حتى يُعاد فحصها عند الإرسال
for (const name of ['url', 'logo_url', 'phone']) f[name].addEventListener('input', () => f[name].setCustomValidity(''));

function formError(msg, focusEl) {
  $('formError').textContent = msg;
  $('formError').hidden = !msg;
  if (focusEl) {
    focusEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    focusEl.focus?.({ preventScroll: true });
  }
}

form.addEventListener('submit', async e => {
  e.preventDefault();
  formError('');

  if (f.company_site.value) return; // برنامج آلي

  f.url.value = normalizeUrl(f.url.value);
  if (f.url.value && !safeUrl(f.url.value)) f.url.setCustomValidity('رابط غير صالح');
  else f.url.setCustomValidity('');
  if (f.logo_url.value) {
    f.logo_url.value = normalizeUrl(f.logo_url.value);
    f.logo_url.setCustomValidity(safeUrl(f.logo_url.value) ? '' : 'رابط غير صالح');
  }
  const phone = normalizePhone(f.phone.value);
  f.phone.setCustomValidity(/^9665\d{8}$/.test(phone) ? '' : 'رقم جوال سعودي غير صالح');

  const invalid = [...form.elements].find(el => el.willValidate && !el.checkValidity());
  if (invalid) {
    form.classList.add('validated');
    const label = invalid.closest('.field, .check')?.querySelector('span')?.textContent.replace('*', '').trim();
    return formError(`تأكد من حقل: ${label || 'الحقول المطلوبة'}`, invalid);
  }
  const districtRequired = SETTINGS.form.fields.district?.visible !== false && SETTINGS.form.fields.district?.required;
  const missing = locations.findIndex(l => l.lat === null || !l.region || !l.city || (districtRequired && !l.district.trim()));
  if (missing !== -1) {
    selectLocation(missing);
    const loc = locations[missing];
    if (loc.lat === null) {
      $('pickerMap').classList.add('invalid');
      return formError(locations.length > 1 ? `حدد مكان الموقع ${missing + 1} على الخريطة، أو احذفه.` : 'حدد موقعك على الخريطة.', $('pickerMap'));
    }
    if (!loc.region || !loc.city) return formError(`اختر المنطقة والمدينة للموقع ${missing + 1}.`, f.region);
    return formError(`اكتب اسم الحي للموقع ${missing + 1}.`, f.district);
  }

  const fields = SETTINGS.form.fields;
  const shown = key => fields[key]?.visible !== false;
  const needed = key => shown(key) && fields[key]?.required;
  const delivery = shown('delivery') ? [...form.querySelectorAll('input[name="delivery"]:checked')].map(c => c.value) : [];
  if (needed('delivery') && !delivery.length) {
    return formError('اختر خيار توصيل واحد على الأقل.', $('deliveryChecks'));
  }
  const social = name => (shown('socials') ? f[name].value : '');
  const hasSocial = ['instagram', 'x_handle', 'tiktok', 'snapchat', 'whatsapp'].some(n => social(n).trim());
  if (needed('socials') && !hasSocial) {
    return formError('أضف حساب تواصل واحد على الأقل.', f.instagram);
  }
  if (!f.url.value && !hasSocial) {
    return formError(shown('socials') ? 'أضف رابط متجرك، أو حساب تواصل واحد على الأقل يوصل له العملاء.' : 'أضف رابط متجرك.', f.url);
  }
  const text = name => (shown(name) ? f[name].value.trim() : '');

  const payload = {
    name: f.name.value.trim(),
    url: f.url.value || null,
    category: f.category.value,
    entity_type: f.entity_type.value,
    description: text('description') || null,
    logo_url: text('logo_url') || null,
    instagram: normalizeHandle(social('instagram')) || null,
    x_handle: normalizeHandle(social('x_handle')) || null,
    tiktok: normalizeHandle(social('tiktok')) || null,
    snapchat: normalizeHandle(social('snapchat')) || null,
    whatsapp: normalizePhone(social('whatsapp')) || null,
    delivery,
    location_type: 'store',
    locations: locations.map(l => ({
      lat: l.lat, lng: l.lng, region: l.region, city: l.city, district: shown('district') ? l.district.trim() || null : null,
    })),
    approximate: f.approximate.checked,
    owner_name: f.owner_name.value.trim(),
    phone,
    email: f.email.value.trim(),
    cr_number: text('cr_number') || null,
    registrant_role: f.registrant_role.value,
    registrant_title: f.registrant_role.value === 'employee' ? f.registrant_title.value.trim() : null,
  };

  const btn = $('submitBtn');
  btn.disabled = true;
  btn.textContent = 'لحظة… جارٍ الإرسال';
  try {
    await submitStore(payload);
    form.hidden = true;
    $('success').hidden = false;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (err) {
    formError(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'أرسل طلبك 🚀';
  }
});

// عند فتح القسم مجددًا: نعيد ضبط حجم الخريطة، ونبدأ نموذجًا جديدًا إذا كان الطلب السابق قد أُرسل
export function onShow() {
  map.invalidateSize();
  applyFormSettings();
  if ($('success').hidden) return;
  form.reset();
  form.classList.remove('validated');
  updateCities();
  updateEntity();
  updateRole();
  locations = [emptyLocation()];
  active = 0;
  refreshAll();
  map.setView(SA_CENTER, SA_ZOOM);
  $('success').hidden = true;
  form.hidden = false;
}
