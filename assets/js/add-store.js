import { REGIONS, CATEGORIES, CATEGORY_ICONS, DELIVERY, DELIVERY_ICONS, SA_CENTER, SA_ZOOM } from './constants.js';
import { submitStore, isDemo } from './api.js';
import { createMap, pinIcon } from './map.js';
import {
  inSaudi, nearestCity, parseLocation, normalizeUrl, normalizeHandle, normalizePhone, safeUrl,
} from './utils.js';

const form = document.getElementById('storeForm');
const f = form.elements;
const $ = id => document.getElementById(id);

if (isDemo) $('addDemoBanner').hidden = false;

for (const c of CATEGORIES) f.category.add(new Option(`${CATEGORY_ICONS[c]}  ${c}`, c));
for (const r of REGIONS) f.region.add(new Option(r.name, r.name));
$('deliveryChecks').innerHTML = Object.entries(DELIVERY).map(([value, label]) =>
  `<label class="toggle"><input type="checkbox" name="delivery" value="${value}"><span>${DELIVERY_ICONS[value]} ${label}</span></label>`).join('');

function updateCities(selected = '') {
  const region = REGIONS.find(r => r.name === f.region.value);
  f.city.length = 1;
  f.city.disabled = !region;
  if (region) for (const c of region.cities) f.city.add(new Option(c.name, c.name));
  if (selected) f.city.value = selected;
}

f.region.addEventListener('change', () => {
  updateCities();
  const region = REGIONS.find(r => r.name === f.region.value);
  if (region && !picked) map.flyTo([region.cities[0].lat, region.cities[0].lng], 9);
});
f.city.addEventListener('change', () => {
  const city = REGIONS.find(r => r.name === f.region.value)?.cities.find(c => c.name === f.city.value);
  if (city && !picked) map.flyTo([city.lat, city.lng], 12);
});

// ---- منتقي الموقع ----
const map = createMap('pickerMap');
let marker = null;
let picked = null;

function kind() {
  return form.querySelector('input[name="location_type"]:checked').value;
}

function setLocation(lat, lng, { fly = true } = {}) {
  if (!inSaudi(lat, lng)) {
    showLinkError('الموقع المحدد خارج المملكة.');
    return;
  }
  picked = { lat, lng };
  if (!marker) {
    marker = L.marker([lat, lng], { draggable: true, icon: pinIcon(kind(), CATEGORY_ICONS[f.category.value]) }).addTo(map);
    marker.on('dragend', () => {
      const p = marker.getLatLng();
      setLocation(p.lat, p.lng, { fly: false });
    });
  } else {
    marker.setLatLng([lat, lng]);
  }
  if (fly) map.flyTo([lat, lng], Math.max(map.getZoom(), 15));
  $('coords').textContent = `الموقع المحدد: ${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  $('coords').classList.add('ok');
  $('pickerMap').classList.remove('invalid');
  showLinkError('');

  // نقترح المنطقة والمدينة الأقرب، ويمكن لصاحب المتجر تعديلها
  const near = nearestCity(lat, lng);
  if (near && near.km < 60) {
    f.region.value = near.region;
    updateCities(near.city);
  }
}

function showLinkError(msg) {
  $('linkError').textContent = msg;
  $('linkError').hidden = !msg;
}

map.on('click', e => setLocation(e.latlng.lat, e.latlng.lng, { fly: false }));

const refreshPin = () => marker?.setIcon(pinIcon(kind(), CATEGORY_ICONS[f.category.value]));
form.querySelectorAll('input[name="location_type"]').forEach(r => r.addEventListener('change', refreshPin));
f.category.addEventListener('change', refreshPin);

$('parseLink').addEventListener('click', () => {
  const result = parseLocation($('mapLink').value);
  if (result.error) showLinkError(result.error);
  else setLocation(result.lat, result.lng);
});
$('mapLink').addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    e.preventDefault();
    $('parseLink').click();
  }
});

$('useMyLocation').addEventListener('click', () => {
  if (!navigator.geolocation) return showLinkError('متصفحك لا يدعم تحديد الموقع.');
  const btn = $('useMyLocation');
  btn.disabled = true;
  navigator.geolocation.getCurrentPosition(pos => {
    btn.disabled = false;
    setLocation(pos.coords.latitude, pos.coords.longitude);
  }, () => {
    btn.disabled = false;
    showLinkError('لم نتمكن من الوصول لموقعك. حدده يدويًا على الخريطة أو الصق رابط الموقع.');
  }, { enableHighAccuracy: true, timeout: 10000 });
});

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
  if (!picked) {
    $('pickerMap').classList.add('invalid');
    return formError('حدد موقع المتجر أو المخزون على الخريطة.', $('pickerMap'));
  }

  const payload = {
    name: f.name.value.trim(),
    url: f.url.value,
    category: f.category.value,
    description: f.description.value.trim() || null,
    logo_url: f.logo_url.value || null,
    instagram: normalizeHandle(f.instagram.value) || null,
    x_handle: normalizeHandle(f.x_handle.value) || null,
    tiktok: normalizeHandle(f.tiktok.value) || null,
    whatsapp: normalizePhone(f.whatsapp.value) || null,
    delivery: [...form.querySelectorAll('input[name="delivery"]:checked')].map(c => c.value),
    location_type: kind(),
    region: f.region.value,
    city: f.city.value,
    district: f.district.value.trim() || null,
    lat: picked.lat,
    lng: picked.lng,
    approximate: f.approximate.checked,
    owner_name: f.owner_name.value.trim(),
    phone,
    email: f.email.value.trim(),
    cr_number: f.cr_number.value.trim() || null,
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
  if ($('success').hidden) return;
  form.reset();
  form.classList.remove('validated');
  updateCities();
  marker?.remove();
  marker = null;
  picked = null;
  $('coords').textContent = 'لم يُحدد الموقع بعد';
  $('coords').classList.remove('ok');
  map.setView(SA_CENTER, SA_ZOOM);
  $('success').hidden = true;
  form.hidden = false;
}
