// طلبات الإعلان لصاحب المتجر: بنر بصورة أو تثبيت بطاقة المتجر، مع التكلفة الفورية ومحادثة مع الإدارة
import { REGIONS } from './constants.js';
import { SETTINGS, formatDate } from './settings.js';
import { AD_KINDS, AD_STATUS, MESSAGE_KIND, adBreakdown, addDays } from './ads-common.js';
import { compressBanner } from './image.js';
import { formatNumber } from './charts.js';
import { escapeHtml, riyadhDay, safeUrl, safeImage, normalizeUrl } from './utils.js';

const $ = id => document.getElementById(id);
const TIME = new Intl.DateTimeFormat('ar-u-ca-gregory-nu-latn', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const state = { backend: null, store: null, requests: [], editing: null, regions: new Set(), image: '', kind: 'banner', onChange: () => {} };

export function adsPanelHtml() {
  const { first_region: first, extra_region: extra } = SETTINGS.ads;
  return `
    <article class="panel" id="ownerAds">
      <div class="panel-head">
        <h2>📣 إعلانات متجرك</h2>
        <button type="button" class="btn btn-primary btn-sm" id="newAdBtn">+ طلب إعلان</button>
      </div>
      <p class="hint">أظهر متجرك في الواجهة الرئيسية: <strong>بنر بصورتك</strong> تحت الخريطة، أو <strong>تثبيت بطاقة متجرك</strong> في أعلى القائمة، للمناطق والمدة اللي تختارها.
        تكلفة اليوم الإعلاني: <strong>${formatNumber(first)} ر.س</strong> للمنطقة الأولى، و<strong>${formatNumber(extra)} ر.س</strong> لكل منطقة إضافية.</p>
      <div id="adRequests"><p class="muted">جارٍ التحميل…</p></div>
    </article>`;
}

function defaultLink(store) {
  if (store.url) return store.url;
  if (store.instagram) return `https://instagram.com/${store.instagram}`;
  if (store.snapchat) return `https://www.snapchat.com/add/${store.snapchat}`;
  if (store.tiktok) return `https://www.tiktok.com/@${store.tiktok}`;
  return '';
}

// ---- قائمة الطلبات ----

function threadHtml(r) {
  return `<ul class="ad-thread">${r.messages.map(m => {
    const who = m.sender === 'admin' ? 'فريق دكان الحي' : m.sender === 'owner' ? 'أنت' : 'النظام';
    const kind = MESSAGE_KIND[m.kind];
    return `<li class="ad-msg ad-msg-${m.sender}">
      <div class="ad-msg-head"><strong>${who}</strong>${kind ? `<span class="tag-chip static">${kind}</span>` : ''}<small>${escapeHtml(TIME.format(new Date(m.created_at)))}</small></div>
      ${m.body ? `<p>${escapeHtml(m.body)}</p>` : ''}</li>`;
  }).join('')}</ul>`;
}

function requestHtml(r) {
  const st = AD_STATUS[r.status];
  const kind = AD_KINDS[r.kind];
  const closed = ['rejected', 'cancelled', 'paid'].includes(r.status);
  const img = r.image && safeImage(r.image);
  return `
    <article class="ad-req" data-id="${r.id}">
      <div class="ad-req-head">
        <span class="status-pill ad-st-${st.cls}">${st.icon} ${st.label}</span>
        <strong>${kind.icon} ${kind.label}</strong>
        <span class="ad-price">${formatNumber(Number(r.price))} ر.س</span>
      </div>
      <p class="ad-req-meta">📍 ${r.regions.map(escapeHtml).join('، ')} · 📅 ${escapeHtml(formatDate(r.starts_on))} ← ${escapeHtml(formatDate(r.ends_on))} (${formatNumber(r.days)} يوم)</p>
      ${img ? `<img class="ad-req-img" src="${escapeHtml(img)}" alt="صورة البنر">` : ''}
      ${r.status === 'changes' ? '<p class="notice warn">✏️ الإدارة طلبت تعديلًا على الطلب. اقرأ الرسالة تحت، ثم اضغط «تعديل الطلب» وأعد إرساله.</p>' : ''}
      ${r.status === 'approved' ? '<p class="notice ok">💳 تمت الموافقة. شوف طريقة السداد في رسالة الإدارة تحت، وبعد استلام السداد يظهر إعلانك في موعده.</p>' : ''}
      ${threadHtml(r)}
      ${r.status === 'rejected' || r.status === 'cancelled' ? '' : `
      <form class="ad-reply" data-reply="${r.id}">
        <input name="body" maxlength="1500" placeholder="اكتب رسالة للإدارة…" aria-label="رسالة للإدارة">
        <button class="btn btn-ghost btn-sm">إرسال</button>
      </form>`}
      <div class="ad-req-actions">
        ${['pending', 'changes'].includes(r.status) ? `<button type="button" class="btn ${r.status === 'changes' ? 'btn-primary' : 'btn-ghost'} btn-sm" data-ad-edit="${r.id}">✏️ تعديل الطلب</button>` : ''}
        ${!closed || r.status === 'approved' ? '' : ''}
        ${['pending', 'changes', 'approved'].includes(r.status) ? `<button type="button" class="btn btn-ghost btn-sm danger" data-ad-cancel="${r.id}">إلغاء الطلب</button>` : ''}
      </div>
    </article>`;
}

function renderList() {
  $('adRequests').innerHTML = state.requests.length
    ? state.requests.map(requestHtml).join('')
    : '<p class="muted">ما أرسلت أي طلب إعلان بعد. اضغط «+ طلب إعلان» وحدد المناطق والمدة، وتشوف التكلفة قبل الإرسال.</p>';
}

async function reload() {
  try {
    state.requests = await state.backend.ads(state.store.id);
    renderList();
  } catch (err) {
    $('adRequests').innerHTML = `<p class="muted">الإعلانات تتوفر بعد تشغيل ترحيل قاعدة البيانات 011. <small>${escapeHtml(err.message)}</small></p>`;
  }
}

// ---- نموذج الطلب ----

const form = $('adForm');
const field = name => form.elements[name];

function formData() {
  return {
    kind: state.kind, regions: REGIONS.map(r => r.name).filter(n => state.regions.has(n)), starts_on: field('starts_on').value,
    days: Number(field('days').value) || 0, link_url: field('link_url').value.trim() ? normalizeUrl(field('link_url').value.trim()) : '',
    image: state.kind === 'banner' ? state.image : '', note: field('note').value.trim(),
  };
}

function updateCost() {
  const d = formData();
  const b = adBreakdown(d.regions.length, d.days);
  $('adCost').innerHTML = d.regions.length && d.days > 0
    ? `<div class="cost-total"><span>التكلفة الإجمالية</span><strong>${formatNumber(b.total)} ر.س</strong></div>
       <ul class="cost-lines">
         <li>المنطقة الأولى: ${formatNumber(b.first)} ر.س لليوم</li>
         ${b.extraCount ? `<li>${formatNumber(b.extraCount)} ${b.extraCount === 1 ? 'منطقة إضافية' : 'مناطق إضافية'} × ${formatNumber(b.extra)} ر.س = ${formatNumber(b.extra * b.extraCount)} ر.س لليوم</li>` : ''}
         <li>اليوم الواحد: ${formatNumber(b.daily)} ر.س × ${formatNumber(d.days)} ${d.days === 1 ? 'يوم' : 'أيام'}</li>
         <li>ينتهي في ${escapeHtml(formatDate(addDays(d.starts_on || riyadhDay(), d.days - 1)))}</li>
       </ul>`
    : '<p class="muted">اختر منطقة واحدة على الأقل وحدد عدد الأيام وتظهر لك التكلفة هنا.</p>';
  const img = d.image && safeImage(d.image);
  $('adPreview').innerHTML = d.kind === 'banner'
    ? `<div class="ad-banner ad-imageonly"><div class="ad-static">${img ? `<img class="ad-full" src="${escapeHtml(img)}" alt=""><small class="ad-tag">إعلان</small>` : '<span class="muted">ارفع صورة البنر لتشوف المعاينة</span>'}</div></div>`
    : '<p class="muted">ستظهر بطاقة متجرك في أعلى قائمة المتاجر بشارة «📌 مثبّت» للمناطق المختارة.</p>';
}

function renderRegionPicks() {
  $('adRegions').innerHTML = REGIONS.map(r =>
    `<label class="toggle"><input type="checkbox" value="${escapeHtml(r.name)}"${state.regions.has(r.name) ? ' checked' : ''}><span>${escapeHtml(r.name)}</span></label>`).join('');
}

function syncKind() {
  for (const el of form.querySelectorAll('[data-for]')) el.hidden = el.dataset.for !== state.kind;
  for (const radio of form.querySelectorAll('input[name="kind"]')) radio.checked = radio.value === state.kind;
}

function openForm(request = null) {
  state.editing = request;
  const today = riyadhDay();
  state.kind = request?.kind || 'banner';
  state.regions = new Set(request?.regions || []);
  state.image = request?.image || '';
  $('adDialogTitle').textContent = request ? 'تعديل طلب الإعلان' : 'طلب إعلان جديد';
  field('starts_on').min = today;
  field('starts_on').value = request && request.starts_on >= today ? request.starts_on : addDays(today, request ? 1 : 3);
  field('days').value = request?.days || 7;
  field('link_url').value = request?.link_url ?? defaultLink(state.store);
  field('note').value = '';
  $('adError').hidden = true;
  $('adSubmit').textContent = request ? 'أعد إرسال الطلب' : 'أرسل الطلب';
  syncKind();
  renderRegionPicks();
  updateCost();
  $('adDialog').showModal();
}

form.addEventListener('change', e => {
  if (e.target.name === 'kind') {
    state.kind = e.target.value;
    syncKind();
  } else if (e.target.closest('#adRegions')) {
    if (e.target.checked) state.regions.add(e.target.value);
    else state.regions.delete(e.target.value);
  }
  updateCost();
});
form.addEventListener('input', updateCost);
$('adQuick').addEventListener('click', e => {
  const days = Number(e.target.closest('[data-days]')?.dataset.days);
  if (days) {
    field('days').value = days;
    updateCost();
  }
});
$('adImageBtn').addEventListener('click', () => $('adImageFile').click());
$('adImageFile').addEventListener('change', async e => {
  const [file] = e.target.files;
  e.target.value = '';
  if (!file) return;
  $('adImageNote').classList.remove('error');
  $('adImageNote').textContent = 'جارٍ تجهيز الصورة…';
  try {
    state.image = await compressBanner(file);
    $('adImageNote').textContent = `✅ جاهزة (${Math.max(1, Math.round(state.image.length / 1024))} كيلوبايت)`;
  } catch (err) {
    $('adImageNote').classList.add('error');
    $('adImageNote').textContent = err.message;
  }
  updateCost();
});
$('adDialog').addEventListener('click', e => {
  if (e.target === $('adDialog') || e.target.closest('[data-close]')) $('adDialog').close();
});

// وصف التعديلات لتصل واضحة للإدارة
function changeSummary(old, d) {
  const parts = [];
  if (old.kind !== d.kind) parts.push(`النوع: ${AD_KINDS[d.kind].label}`);
  if (old.starts_on !== d.starts_on || old.days !== d.days) parts.push(`الموعد: ${formatDate(d.starts_on)} لمدة ${d.days} يوم (كان ${formatDate(old.starts_on)} لمدة ${old.days} يوم)`);
  if (old.regions.join() !== d.regions.join()) parts.push(`المناطق: ${d.regions.join('، ')}`);
  if ((old.link_url || '') !== d.link_url) parts.push('تغيّر الرابط');
  if ((old.image || '') !== (d.image || '')) parts.push('تغيّرت صورة البنر');
  return parts.length ? `عدّلت الطلب: ${parts.join(' · ')}` : 'أعدت إرسال الطلب بدون تغيير';
}

form.addEventListener('submit', async e => {
  e.preventDefault();
  const d = formData();
  const fail = msg => {
    $('adError').textContent = msg;
    $('adError').hidden = false;
  };
  $('adError').hidden = true;
  if (!d.regions.length) return fail('اختر منطقة واحدة على الأقل.');
  if (!(d.days >= 1 && d.days <= 365)) return fail('مدة الإعلان من يوم إلى 365 يوم.');
  if (!d.starts_on || d.starts_on < riyadhDay()) return fail('تاريخ البداية لازم يكون من اليوم فصاعدًا.');
  if (d.link_url && !safeUrl(d.link_url)) return fail('الرابط لازم يبدأ بـ https://');
  if (d.kind === 'banner' && !d.image) return fail('ارفع صورة البنر.');
  $('adSubmit').disabled = true;
  try {
    if (state.editing) {
      const summary = changeSummary(state.editing, d);
      await state.backend.updateAd(state.editing.id, { ...d, note: d.note ? `${summary}\n${d.note}` : summary });
    } else {
      await state.backend.submitAd(state.store.id, d);
    }
    $('adDialog').close();
    state.onChange(state.editing ? '✅ أُرسل الطلب المعدّل للمراجعة' : '✅ وصل طلبك للإدارة، وبنرد عليك هنا');
    await reload();
  } catch (err) {
    fail(err.message);
  } finally {
    $('adSubmit').disabled = false;
  }
  return undefined;
});

// ---- التعامل مع قائمة الطلبات ----

function bind() {
  $('newAdBtn').addEventListener('click', () => openForm());
  $('adRequests').addEventListener('click', async e => {
    const edit = e.target.closest('[data-ad-edit]');
    const cancel = e.target.closest('[data-ad-cancel]');
    try {
      if (edit) openForm(state.requests.find(r => r.id === Number(edit.dataset.adEdit)));
      else if (cancel) {
        if (!confirm('إلغاء طلب الإعلان؟')) return;
        await state.backend.cancelAd(Number(cancel.dataset.adCancel));
        state.onChange('تم إلغاء الطلب');
        await reload();
      }
    } catch (err) {
      state.onChange(`تعذر تنفيذ العملية: ${err.message}`);
    }
  });
  $('adRequests').addEventListener('submit', async e => {
    const reply = e.target.closest('[data-reply]');
    if (!reply) return;
    e.preventDefault();
    const body = reply.elements.body.value.trim();
    if (!body) return;
    try {
      await state.backend.adMessage(Number(reply.dataset.reply), body);
      await reload();
    } catch (err) {
      state.onChange(`تعذر الإرسال: ${err.message}`);
    }
  });
}

export async function mountAds({ backend, store, onChange }) {
  Object.assign(state, { backend, store, onChange: onChange || (() => {}) });
  if (!$('ownerAds')) return;
  bind();
  await reload();
}
