import { REGIONS, DELIVERY, DELIVERY_ICONS, SA_CENTER, SA_ZOOM, MAX_CATEGORIES } from './constants.js';
import {
  CATEGORIES, CATEGORY_ICONS, SETTINGS, priceFor, graceFor, graceLabel, badgeText, pricingText, isLaunchPeriod, formatDate,
} from './settings.js';
import { submitStore, isDemo } from './api.js';
import { createOwnerBackend } from './owner-data.js';
import { createMap, pinIcon } from './map.js';
import { normalize } from './intent.js';
import { cardHtml } from './card.js';
import { compressLogo } from './image.js';
import { locate, accuracyLabel, geoErrorMessage, searchPlaces, reverseGeocode } from './geo.js';
import {
  inSaudi, nearestCity, parseLocation, normalizeUrl, normalizeHandle, normalizePhone, safeUrl, escapeHtml, storeCategories,
} from './utils.js';

const form = document.getElementById('storeForm');
const f = form.elements;
const $ = id => document.getElementById(id);

// register: تسجيل متجر جديد · edit: طلب تعديل متجر قائم (يمر على مراجعة المشرف)
// admin: تعديل المشرف المباشر لكل بيانات المتجر (يُحفظ فورًا)
let mode = 'register';
let adminBackend = null;
let editId = null;
let ownerPromise = null;
const owner = () => (ownerPromise ||= createOwnerBackend());

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
  $('successTitle').textContent = 'وصلنا طلبك!';
  $('successLink').textContent = 'تصفح المتاجر';
  $('successLink').href = '#';
  $('pricingNote').textContent = `💳 ${pricingText()}`;
  for (const el of form.querySelectorAll('[data-price]')) {
    const type = el.dataset.price;
    el.textContent = `${priceFor(type)} ر.س سنويًا · مهلة السداد ${graceLabel(graceFor(type))}`;
  }
  for (const tag of form.querySelectorAll('[data-launch]')) {
    tag.hidden = !isLaunchPeriod();
    tag.textContent = `🎉 مجاني حتى ${formatDate(SETTINGS.pricing.launch_end)}`;
  }

  renderCategories();

  // بيانات التواصل مع المنصة تظهر هنا فقط (نهاية نموذج التسجيل)
  const email = (SETTINGS.footer.email || '').trim();
  const wa = (SETTINGS.footer.whatsapp || '').replace(/\D/g, '');
  // أيقونات فقط: الإيميل والرقم لا يُعرضان كنص، ويظهر اسم الوسيلة عند التمرير
  const mailIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M4 7l8 6 8-6"/></svg>';
  const waIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 20.5l1.3-4.2A8.5 8.5 0 1 1 8 19.5z"/><path d="M9 9.5c.5 2.2 2.3 4 4.5 4.5"/></svg>';
  $('formContactLinks').innerHTML = [
    email && `<a class="fc-icon" href="mailto:${escapeHtml(email)}" title="راسلنا على الإيميل" aria-label="راسلنا على الإيميل">${mailIcon}</a>`,
    wa && `<a class="fc-icon" href="https://wa.me/${escapeHtml(wa)}" target="_blank" rel="noopener" title="تواصل معنا على واتساب" aria-label="تواصل معنا على واتساب">${waIcon}</a>`,
  ].filter(Boolean).join('');
  $('formContact').hidden = !email && !wa;

  for (const wrap of form.querySelectorAll('[data-field]')) {
    // المشرف يشوف كل الحقول ولا يُلزم بشي منها
    const cfg = mode === 'admin' ? { visible: true, required: false } : fs.fields[wrap.dataset.field] || { visible: true, required: false };
    const required = cfg.visible && cfg.required;
    wrap.hidden = !cfg.visible;
    const opt = wrap.querySelector('.opt');
    opt.textContent = required ? '*' : '(اختياري)';
    opt.classList.toggle('req', required);
    for (const input of wrap.querySelectorAll('input, textarea')) {
      if (input.name === 'logo_url') logoRequired = required;
      if (TEXT_FIELDS.includes(input.name)) input.required = required;
    }
  }
}

// ---- الوسوم: كلمات يبحث بها الناس (بخور، عود…) ----
const MAX_TAGS = 20;
let tags = [];

// ---- معاينة حية لشكل المتجر عند الزوار ----
let previewReady = false;
let previewFrame = 0;

function previewStore() {
  const picked = locations.filter(l => l.region && l.city);
  const locs = picked.length ? picked.map(l => ({ lat: l.lat, lng: l.lng, region: l.region, city: l.city, district: l.district })) : [{ city: 'مدينتك', district: '', region: '' }];
  const url = f.url.value.trim() && safeUrl(normalizeUrl(f.url.value)) ? normalizeUrl(f.url.value) : null;
  const logo = uploadedLogo || (safeUrl(f.logo_url.value.trim()) ? f.logo_url.value.trim() : null);
  const handle = name => normalizeHandle(f[name].value) || null;
  const physical = form.querySelector('input[name="physical_store"]:checked')?.value;
  return {
    id: 'preview', name: f.name.value.trim() || 'اسم متجرك', url, logo_url: logo, description: f.description.value.trim(),
    cats: [...chosenCats], category: chosenCats[0], entity_type: f.entity_type.value || '',
    has_physical_store: physical === 'yes' ? true : physical === 'no' ? false : null, approximate: f.approximate.checked,
    delivery: [...form.querySelectorAll('input[name="delivery"]:checked')].map(c => c.value),
    instagram: handle('instagram'), snapchat: handle('snapchat'), tiktok: handle('tiktok'), x_handle: handle('x_handle'),
    whatsapp: normalizePhone(f.whatsapp.value) || null, store_email: f.store_email.value.trim() || null,
    locs, shownLocs: locs,
  };
}

function updatePreview() {
  if (!previewReady) return;
  cancelAnimationFrame(previewFrame);
  previewFrame = requestAnimationFrame(() => {
    const s = previewStore();
    $('livePreviewCard').innerHTML = cardHtml(s, { preview: true });
    $('lpWarn').hidden = Boolean(s.url || s.instagram || s.snapchat || s.tiktok || s.x_handle);
    for (const img of $('livePreviewCard').querySelectorAll('.avatar img')) {
      img.addEventListener('error', () => { img.parentElement.classList.add('avatar-violet'); img.parentElement.textContent = img.dataset.initial; }, { once: true });
    }
  });
}

form.addEventListener('input', updatePreview);
form.addEventListener('change', updatePreview);
$('lpToggle').addEventListener('click', () => {
  const open = $('lpBody').hidden;
  $('lpBody').hidden = !open;
  $('lpToggle').textContent = open ? 'إخفاء' : 'إظهار';
  $('lpToggle').setAttribute('aria-expanded', String(open));
});

function renderTags() {
  $('tagList').innerHTML = tags.map((t, i) =>
    `<span class="tag-chip">${escapeHtml(t)}<button type="button" data-remove-tag="${i}" aria-label="حذف ${escapeHtml(t)}">✕</button></span>`).join('');
  updatePreview();
  $('tagInput').disabled = tags.length >= MAX_TAGS;
  $('tagInput').placeholder = tags.length >= MAX_TAGS ? 'وصلت للحد (20 كلمة)' : tags.length ? '' : 'مثال: بخور، عود، دهن عود';
}

function addTags(text) {
  for (const raw of String(text).split(/[,،\n]/)) {
    const tag = raw.replace(/\s+/g, ' ').trim().slice(0, 30);
    if (!tag || tags.length >= MAX_TAGS) continue;
    if (!tags.some(t => normalize(t) === normalize(tag))) tags.push(tag);
  }
  renderTags();
}

$('tagInput').addEventListener('keydown', e => {
  if (e.key === 'Enter' || e.key === ',' || e.key === '،') {
    e.preventDefault();
    addTags(e.target.value);
    e.target.value = '';
  } else if (e.key === 'Backspace' && !e.target.value && tags.length) {
    tags.pop();
    renderTags();
  }
});
$('tagInput').addEventListener('blur', e => {
  addTags(e.target.value);
  e.target.value = '';
});
$('tagBox').addEventListener('click', e => {
  const remove = e.target.closest('[data-remove-tag]');
  if (remove) {
    tags.splice(Number(remove.dataset.removeTag), 1);
    renderTags();
  }
  $('tagInput').focus();
});

// ---- الشعار: رفع صورة (تُضغط في المتصفح) أو رابط ----
let uploadedLogo = '';
let logoRequired = false;

function updateLogoUi() {
  const src = uploadedLogo || (safeUrl(f.logo_url.value) ? f.logo_url.value : '');
  $('logoPreview').innerHTML = src ? `<img src="${escapeHtml(src)}" alt="" referrerpolicy="no-referrer">` : '🛍️';
  $('logoRemoveBtn').hidden = !uploadedLogo && !f.logo_url.value;
  $('logoUploadBtn').textContent = uploadedLogo ? '📷 غيّر الصورة' : '📷 ارفع صورة الشعار';
  f.logo_url.required = logoRequired && !uploadedLogo;
  updatePreview();
}

$('logoUploadBtn').addEventListener('click', () => $('logoFile').click());
$('logoFile').addEventListener('change', async e => {
  const [file] = e.target.files;
  e.target.value = '';
  if (!file) return;
  $('logoNote').classList.remove('error');
  $('logoNote').textContent = 'جارٍ تصغير الصورة…';
  try {
    uploadedLogo = await compressLogo(file);
    f.logo_url.value = '';
    f.logo_url.setCustomValidity('');
    $('logoNote').textContent = `✅ جاهزة (${Math.max(1, Math.round(uploadedLogo.length / 1024))} كيلوبايت)`;
  } catch (err) {
    $('logoNote').classList.add('error');
    $('logoNote').textContent = err.message;
  }
  updateLogoUi();
});
$('logoRemoveBtn').addEventListener('click', () => {
  uploadedLogo = '';
  f.logo_url.value = '';
  $('logoNote').classList.remove('error');
  $('logoNote').textContent = 'تُصغَّر الصورة تلقائيًا في جوالك قبل الرفع.';
  updateLogoUi();
});
f.logo_url.addEventListener('input', () => {
  if (f.logo_url.value.trim()) uploadedLogo = '';
  updateLogoUi();
});

// ---- المجالات (اختيار متعدد بالترتيب، الأول هو الرئيسي) ----
let chosenCats = [];

function renderCategories() {
  const all = [...CATEGORIES, ...chosenCats.filter(c => !CATEGORIES.includes(c))];
  $('categoryToggles').innerHTML = all.map(c => {
    const i = chosenCats.indexOf(c);
    return `<label class="cat-option${i === 0 ? ' primary' : ''}"><input type="checkbox" name="categories" value="${escapeHtml(c)}"${i !== -1 ? ' checked' : ''}><span>${i === 0 ? '⭐ ' : ''}${CATEGORY_ICONS[c] || '🛍️'} ${escapeHtml(c)}</span></label>`;
  }).join('');
  updatePreview();
  $('catSummary').innerHTML = chosenCats.length
    ? chosenCats.map((c, i) => `<span class="cat-chip">${i === 0 ? '⭐ ' : ''}${CATEGORY_ICONS[c] || '🛍️'} ${escapeHtml(c)}</span>`).join('')
    : 'اختر مجالات متجرك…';
}

// القائمة المنسدلة: تُفتح بالضغط وتُغلق بالضغط خارجها أو Esc
function toggleCatPanel(open = $('categoryToggles').hidden) {
  $('categoryToggles').hidden = !open;
  $('catBtn').setAttribute('aria-expanded', String(open));
}
$('catBtn').addEventListener('click', () => toggleCatPanel());
document.addEventListener('click', e => {
  if (!e.target.closest('#catDropdown')) toggleCatPanel(false);
});
$('catDropdown').addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    toggleCatPanel(false);
    $('catBtn').focus();
  }
});

$('categoryToggles').addEventListener('change', e => {
  const value = e.target.value;
  if (e.target.checked) {
    if (chosenCats.length >= MAX_CATEGORIES) {
      e.target.checked = false;
      formError(`تقدر تختار ${MAX_CATEGORIES} مجالات بحد أقصى.`);
      return;
    }
    chosenCats.push(value);
  } else {
    chosenCats = chosenCats.filter(c => c !== value);
  }
  formError('');
  renderCategories();
  renderMarkers();
});

function updateEntity() {
  updatePreview();
  const type = f.entity_type.value;
  $('crLabel').textContent = 'السجل التجاري / وثيقة العمل الحر';
}

function updateRole() {
  const employee = f.registrant_role.value === 'employee';
  $('titleField').hidden = !employee;
  f.registrant_title.required = employee;
}

// ---- حساب الدخول ----
const PW_RULES = {
  len: p => p.length >= 8,
  upper: p => /[A-Z]/.test(p),
  lower: p => /[a-z]/.test(p),
  digit: p => /\d/.test(p),
  symbol: p => /[^A-Za-z0-9\s]/.test(p),
};
let loggedEmail = null;
let loginTouched = false;

function checkPassword() {
  const p = f.password.value;
  const ok = Object.fromEntries(Object.entries(PW_RULES).map(([k, test]) => [k, test(p)]));
  ok.match = Boolean(p) && p === f.password2.value;
  for (const li of $('pwRules').children) li.classList.toggle('ok', Boolean(ok[li.dataset.rule]));
  return Object.values(ok).every(Boolean);
}

function accountNeeded() {
  return mode === 'register' && !loggedEmail;
}

async function refreshAccount() {
  try {
    loggedEmail = (await (await owner()).session())?.email || null;
  } catch {
    loggedEmail = null;
  }
  $('accountLogged').hidden = !loggedEmail;
  $('accountFields').hidden = Boolean(loggedEmail);
  $('accountEmail').textContent = loggedEmail || '';
  for (const name of ['login_email', 'password', 'password2']) f[name].required = accountNeeded();
}

f.password.addEventListener('input', checkPassword);
f.password2.addEventListener('input', checkPassword);
f.login_email.addEventListener('input', () => { loginTouched = true; });
f.email.addEventListener('input', () => {
  if (!loginTouched) f.login_email.value = f.email.value;
});

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
      icon: pinIcon('store', locations.length > 1 ? String(i + 1) : CATEGORY_ICONS[chosenCats[0]]),
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
  updatePreview();
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
previewReady = true;
updatePreview();

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
  const strong = !accountNeeded() || checkPassword();
  f.password.setCustomValidity(strong ? '' : 'كلمة المرور لا تحقق الشروط');

  const invalid = [...form.elements].find(el => el.willValidate && !el.checkValidity());
  if (invalid) {
    form.classList.add('validated');
    if (invalid === f.password || invalid === f.password2) {
      return formError('كلمة المرور لازم تحقق كل الشروط الموضحة، والتأكيد يطابقها.', f.password);
    }
    const label = invalid.closest('.field, .check')?.querySelector('span')?.textContent.replace('*', '').trim();
    return formError(`تأكد من حقل: ${label || 'الحقول المطلوبة'}`, invalid);
  }
  if (!chosenCats.length) {
    return formError('اختر مجال واحد على الأقل لمتجرك.', $('catBtn'));
  }
  const fields = mode === 'admin' ? {} : SETTINGS.form.fields;
  const districtRequired = fields.district?.visible !== false && fields.district?.required;
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

  const shown = key => fields[key]?.visible !== false;
  const needed = key => shown(key) && fields[key]?.required;
  const delivery = shown('delivery') ? [...form.querySelectorAll('input[name="delivery"]:checked')].map(c => c.value) : [];
  if (needed('delivery') && !delivery.length) {
    return formError('اختر خيار توصيل واحد على الأقل.', $('deliveryChecks'));
  }
  const social = name => (shown('socials') ? f[name].value : '');
  const hasSocial = ['instagram', 'x_handle', 'tiktok', 'snapchat'].some(n => social(n).trim());
  if (needed('socials') && !hasSocial) {
    return formError('أضف حساب تواصل واحد على الأقل.', f.instagram);
  }
  const text = name => (shown(name) ? f[name].value.trim() : '');

  const payload = {
    name: f.name.value.trim(),
    url: f.url.value || null,
    category: chosenCats[0],
    categories: [...chosenCats],
    entity_type: f.entity_type.value,
    description: text('description') || null,
    logo_url: shown('logo_url') ? uploadedLogo || f.logo_url.value.trim() || null : null,
    tags: [...tags],
    instagram: normalizeHandle(social('instagram')) || null,
    x_handle: normalizeHandle(social('x_handle')) || null,
    tiktok: normalizeHandle(social('tiktok')) || null,
    snapchat: normalizeHandle(social('snapchat')) || null,
    whatsapp: normalizePhone(f.whatsapp.value) || null,
    store_email: f.store_email.value.trim() || null,
    has_physical_store: f.physical_store.value ? f.physical_store.value === 'yes' : null,
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
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'لحظة… جارٍ الإرسال';
  try {
    if (mode === 'admin') {
      const { owner_name, phone: ownerPhone, cr_number, registrant_role, registrant_title, email, location_type, ...fieldsData } = payload;
      await adminBackend.adminUpdateStore(editId, {
        ...fieldsData, owner: { owner_name, phone: ownerPhone, email, cr_number, registrant_role, registrant_title },
      });
      $('successTitle').textContent = 'تم حفظ التعديلات ✅';
      $('successText').textContent = 'تحدّثت بيانات المتجر وصارت ظاهرة على المنصة مباشرة.';
      $('successLink').textContent = 'رجوع للوحة التحكم';
      $('successLink').href = '#admin';
    } else if (mode === 'edit') {
      const { owner_name, phone: ownerPhone, cr_number, registrant_role, registrant_title, email, location_type, ...fieldsData } = payload;
      await (await owner()).submitEdit(editId, {
        ...fieldsData, owner: { owner_name, phone: ownerPhone, cr_number, registrant_role, registrant_title },
      });
      $('successTitle').textContent = 'وصلنا طلب التعديل!';
      $('successText').textContent = 'بنراجع التعديلات، وتطلع على المنصة بعد الاعتماد. تقدر تتابع حالة الطلب من «متجري».';
      $('successLink').textContent = 'رجوع لمتجري';
      $('successLink').href = '#account';
    } else {
      const account = loggedEmail ? null : { email: f.login_email.value.trim(), password: f.password.value };
      await submitStore(payload, account);
      $('successText').textContent = `${SETTINGS.form.success} وبعد الاعتماد تقدر تدخل «متجري» بإيميل الدخول وكلمة المرور.`;
      f.password.value = '';
      f.password2.value = '';
      refreshAccount();
    }
    form.hidden = true;
    $('success').hidden = false;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (err) {
    formError(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
});

// ---- وضع التعديل ----
function localPhone(p) {
  return p && p.startsWith('966') ? `0${p.slice(3)}` : (p || '');
}

function setChecked(name, value) {
  const input = form.querySelector(`input[name="${name}"][value="${value}"]`);
  if (input) input.checked = true;
}

async function startEdit() {
  let wanted = null;
  try { wanted = sessionStorage.getItem('dukkan.editStore'); } catch { /* لا شيء */ }
  let items = [];
  try {
    items = await (await owner()).dashboard();
  } catch { /* غير داخل */ }
  const item = items.find(x => x.store.id === wanted) || items[0];
  if (!item) {
    location.hash = '#account';
    return;
  }
  mode = 'edit';
  fillForm(item);
  const { edit } = item;
  $('formTitle').textContent = 'تعديل بيانات متجرك';
  $('formSubtitle').textContent = 'عدّل اللي تبيه وأرسله، ويطلع على المنصة بعد مراجعة فريق دكان الحي.';
  $('editNotice').hidden = !(edit && edit.status !== 'approved');
  $('editNotice').textContent = edit?.status === 'pending'
    ? '⏳ عندك طلب تعديل سابق قيد المراجعة، وإرسال طلب جديد يستبدله.'
    : edit?.status === 'rejected' ? `❌ آخر طلب تعديل ما اعتُمد${edit.admin_note ? `: ${edit.admin_note}` : ''}.` : '';
  $('submitBtn').textContent = 'أرسل التعديل للمراجعة ✏️';
}

// المشرف: يفتح أي متجر من لوحة التحكم ويعدّل كل بياناته، والحفظ مباشر بدون مراجعة
async function startAdminEdit() {
  let wanted = null;
  try { wanted = sessionStorage.getItem('dukkan.adminEdit'); } catch { /* لا شيء */ }
  let s = null;
  try {
    const { createBackend } = await import('./admin-data.js');
    adminBackend ||= await createBackend();
    if (await adminBackend.session() && await adminBackend.isAdmin()) s = (await adminBackend.stores()).find(x => x.id === wanted);
  } catch { /* غير مشرف */ }
  if (!s) {
    location.hash = '#admin';
    return;
  }
  mode = 'admin';
  fillForm({ store: s, owner: s.owner || {}, locations: s.store_locations });
  $('formTitle').textContent = `تعديل بيانات «${s.name}»`;
  $('formSubtitle').textContent = 'تعديل المشرف: كل الحقول متاحة، والحفظ يطلع على المنصة مباشرة بدون مراجعة.';
  $('editNotice').hidden = false;
  $('editNotice').textContent = '🛠️ أنت تعدّل كمشرف. التعديلات تُحفظ فورًا، وأي طلب تعديل معلّق من صاحب المتجر يبقى بانتظار مراجعتك.';
  f.email.disabled = false;
  f.agree.checked = true;
  // متاجر قديمة ما جاوبت على «محل فعلي؟»: المشرف ما يُلزم بها
  form.querySelectorAll('input[name="physical_store"]').forEach(r => { r.required = false; });
  $('submitBtn').textContent = 'حفظ التعديلات 💾';
}

function fillForm({ store: s, owner: o = {}, locations: locs }) {
  editId = s.id;
  $('formBadge').hidden = true;
  $('accountFieldset').hidden = true;
  for (const name of ['login_email', 'password', 'password2']) f[name].required = false;

  setChecked('entity_type', s.entity_type);
  updateEntity();
  f.name.value = s.name || '';
  f.url.value = s.url || '';
  chosenCats = [...storeCategories(s)];
  renderCategories();
  uploadedLogo = s.logo_url?.startsWith('data:image/') ? s.logo_url : '';
  f.logo_url.value = uploadedLogo ? '' : s.logo_url || '';
  updateLogoUi();
  tags = [...(s.tags || [])];
  renderTags();
  f.description.value = s.description || '';
  form.querySelectorAll('input[name="delivery"]').forEach(c => { c.checked = (s.delivery || []).includes(c.value); });
  for (const name of ['instagram', 'x_handle', 'tiktok', 'snapchat']) f[name].value = s[name] || '';
  f.whatsapp.value = localPhone(s.whatsapp);
  f.store_email.value = s.store_email || '';
  if (typeof s.has_physical_store === 'boolean') setChecked('physical_store', s.has_physical_store ? 'yes' : 'no');
  f.approximate.checked = Boolean(s.approximate);

  o ||= {};
  f.owner_name.value = o.owner_name || '';
  f.phone.value = localPhone(o.phone);
  f.email.value = o.email || '';
  f.email.disabled = true;
  f.cr_number.value = o.cr_number || '';
  setChecked('registrant_role', o.registrant_role || 'owner');
  f.registrant_title.value = o.registrant_title || '';
  updateRole();

  locations = (locs?.length ? [...locs].sort((a, b) => (a.position ?? 0) - (b.position ?? 0)) : [s])
    .map(l => ({ ...emptyLocation(), lat: Number(l.lat), lng: Number(l.lng), region: l.region, city: l.city, district: l.district || '' }));
  active = 0;
  loadFields();
  refreshAll();
  map.invalidateSize();
  map.fitBounds(L.latLngBounds(locations.map(l => [l.lat, l.lng])), { padding: [40, 40], maxZoom: 15 });
}

function exitEdit() {
  mode = 'register';
  form.querySelectorAll('input[name="physical_store"]').forEach(r => { r.required = true; });
  editId = null;
  $('accountFieldset').hidden = false;
  $('editNotice').hidden = true;
  f.email.disabled = false;
  $('submitBtn').textContent = 'أرسل طلبك 🚀';
}

function resetForm() {
  form.reset();
  chosenCats = [];
  renderCategories();
  tags = [];
  renderTags();
  uploadedLogo = '';
  updateLogoUi();
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
  formError('');
}

// عند فتح القسم: #edit يفتح وضع التعديل، و#add نموذج تسجيل جديد
export async function onShow() {
  map.invalidateSize();
  if (location.hash === '#admin-edit') {
    if (mode === 'edit') exitEdit();
    resetForm();
    mode = 'admin';
    applyFormSettings();
    await startAdminEdit();
    return;
  }
  if (location.hash === '#edit') {
    if (mode === 'admin') exitEdit();
    resetForm();
    applyFormSettings();
    await startEdit();
    return;
  }
  if (mode !== 'register') {
    exitEdit();
    resetForm();
  }
  applyFormSettings();
  refreshAccount();
  if (!$('success').hidden) resetForm();
}
