// لوحة التحكم: طلبات الإعلان (تقويم يكشف التداخل + قائمة + محادثة مع المتجر + موافقة وسداد)
import { REGIONS } from './constants.js';
import { formatDate } from './settings.js';
import { AD_KINDS, AD_STATUS, MESSAGE_KIND, OPEN_STATUSES, addDays, overlaps } from './ads-common.js';
import { formatNumber } from './charts.js';
import { escapeHtml, safeImage, riyadhDay } from './utils.js';

const $ = id => document.getElementById(id);
const TIME = new Intl.DateTimeFormat('ar-u-ca-gregory-nu-latn', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const MONTH = new Intl.DateTimeFormat('ar-u-ca-gregory-nu-latn', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const REGION_NAMES = REGIONS.map(r => r.name);

const state = { backend: null, toast: () => {}, getBank: () => ({}), requests: [], month: riyadhDay().slice(0, 7), filter: 'action', openId: null, mode: null, ready: false };

export const pendingCount = () => state.requests.filter(r => r.status === 'pending').length;

// ---- التقويم ----

function monthDays(key) {
  const [y, m] = key.split('-').map(Number);
  const count = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: count }, (_, i) => `${key}-${String(i + 1).padStart(2, '0')}`);
}

const shiftMonth = (key, n) => {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

const activeRequests = () => state.requests.filter(r => OPEN_STATUSES.includes(r.status));

function cellRequests(region, day) {
  return activeRequests().filter(r => r.regions.includes(region) && r.starts_on <= day && day <= r.ends_on);
}

function renderCalendar() {
  const days = monthDays(state.month);
  const today = riyadhDay();
  $('adMonthLabel').textContent = MONTH.format(new Date(`${state.month}-01T00:00:00Z`));
  const head = `<tr><th class="cal-region"></th>${days.map(d => `<th class="${d === today ? 'cal-today' : ''}">${Number(d.slice(8))}</th>`).join('')}</tr>`;
  const body = REGION_NAMES.map(region => `<tr><th class="cal-region">${escapeHtml(region)}</th>${days.map(day => {
    const list = cellRequests(region, day);
    if (!list.length) return `<td class="cal-cell${day === today ? ' cal-today' : ''}" data-region="${escapeHtml(region)}" data-day="${day}"></td>`;
    const top = list.some(r => r.status === 'paid') ? 'paid' : list.some(r => r.status === 'approved') ? 'approved' : 'pending';
    return `<td class="cal-cell c-${top}${list.length > 1 ? ' c-overlap' : ''}" data-region="${escapeHtml(region)}" data-day="${day}" title="${escapeHtml(list.map(r => `${r.stores?.name} (${AD_STATUS[r.status].label})`).join(' + '))}">${list.length > 1 ? list.length : ''}</td>`;
  }).join('')}</tr>`).join('');
  $('adCalendar').innerHTML = `<table class="cal-table"><thead>${head}</thead><tbody>${body}</tbody></table>`;
}

function showCell(region, day) {
  const list = cellRequests(region, day);
  $('adCellDetail').innerHTML = list.length
    ? `<strong>${escapeHtml(region)} · ${escapeHtml(formatDate(day))}</strong>${list.map(r => `
        <button type="button" class="cell-req" data-open="${r.id}"><span class="status-pill ad-st-${AD_STATUS[r.status].cls}">${AD_STATUS[r.status].icon} ${AD_STATUS[r.status].label}</span> ${escapeHtml(r.stores?.name || '')} · ${AD_KINDS[r.kind].label}</button>`).join('')}`
    : `<span class="muted">${escapeHtml(region)} · ${escapeHtml(formatDate(day))}: لا توجد طلبات.</span>`;
}

// ---- القائمة ----

const conflictsOf = r => activeRequests().filter(o => overlaps(r, o));

function renderList() {
  const needs = r => r.status === 'pending' || (r.status === 'approved') || (r.status === 'changes' && r.messages.at(-1)?.sender === 'owner');
  const list = state.requests.filter(r => (state.filter === 'all' ? true : needs(r)))
    .sort((a, b) => (needs(b) - needs(a)) || a.starts_on.localeCompare(b.starts_on));
  const badge = pendingCount();
  $('adReqBadge').textContent = badge;
  $('adReqBadge').hidden = !badge;
  $('adReqList').innerHTML = list.length ? list.map(r => {
    const st = AD_STATUS[r.status];
    const conflicts = OPEN_STATUSES.includes(r.status) ? conflictsOf(r).length : 0;
    const last = r.messages.at(-1);
    return `<article class="banner-card ad-row" data-open="${r.id}" tabindex="0">
      <div class="msg-head"><strong>${escapeHtml(r.stores?.name || 'متجر')}</strong><span class="status-pill ad-st-${st.cls}">${st.icon} ${st.label}</span>
        <span class="tag-chip static">${AD_KINDS[r.kind].icon} ${AD_KINDS[r.kind].label}</span><span class="ad-price">${formatNumber(Number(r.price))} ر.س</span></div>
      <div class="banner-meta"><span>📍 ${r.regions.map(escapeHtml).join('، ')}</span><span>📅 ${escapeHtml(formatDate(r.starts_on))} ← ${escapeHtml(formatDate(r.ends_on))} (${r.days} يوم)</span>
        ${conflicts ? `<span class="conflict-tag">⚠️ يتداخل مع ${conflicts} ${conflicts === 1 ? 'طلب' : 'طلبات'}</span>` : ''}</div>
      ${last ? `<p class="muted ad-last">${last.sender === 'owner' ? 'المتجر' : last.sender === 'admin' ? 'أنت' : 'النظام'}: ${escapeHtml((last.body || MESSAGE_KIND[last.kind] || '').slice(0, 120))}</p>` : ''}
    </article>`;
  }).join('') : `<div class="status"><span class="big">📭</span><strong>${state.requests.length ? 'ما فيه طلبات تحتاج إجراء' : 'ما وصلت طلبات إعلان بعد'}</strong></div>`;
}

export function renderAll() {
  renderCalendar();
  renderList();
}

// ---- نافذة الطلب ----

function paymentText(r, method, invoice, extra) {
  const bank = state.getBank();
  const parts = [];
  if (method !== 'invoice' && bank.iban) parts.push(`حوالة بنكية:\nالبنك: ${bank.bank_name || '—'}\nاسم المستفيد: ${bank.account_name || '—'}\nالآيبان: ${bank.iban}`);
  if (method !== 'bank' && invoice) parts.push(`سداد إلكتروني عبر رابط الفاتورة:\n${invoice}`);
  const how = !parts.length ? 'سنرسل لك تفاصيل السداد.' : parts.length > 1 ? `تقدر تسدد بإحدى الطريقتين:\n\n١) ${parts[0]}\n\n٢) ${parts[1]}` : parts[0];
  return `تمت الموافقة على طلب إعلانك ✅\n${AD_KINDS[r.kind].label} · ${r.regions.join('، ')}\nمن ${formatDate(r.starts_on)} إلى ${formatDate(r.ends_on)} (${r.days} يوم)\nالمبلغ المطلوب: ${formatNumber(Number(r.price))} ريال\n\n${how}${extra ? `\n\n${extra}` : ''}\n\nبعد السداد أرسل لنا ما يثبته هنا، ويظهر إعلانك في موعده بعد التأكيد.`;
}

function dialogHtml(r) {
  const st = AD_STATUS[r.status];
  const img = r.image && safeImage(r.image);
  const conflicts = OPEN_STATUSES.includes(r.status) ? conflictsOf(r) : [];
  const closed = ['rejected', 'cancelled'].includes(r.status);
  return `
    <header class="bd-head"><h2>${escapeHtml(r.stores?.name || 'متجر')} <small class="muted">${escapeHtml(r.stores?.city || '')}</small></h2><button type="button" class="close" data-close aria-label="إغلاق">✕</button></header>
    <div class="ad-req-head"><span class="status-pill ad-st-${st.cls}">${st.icon} ${st.label}</span><strong>${AD_KINDS[r.kind].icon} ${AD_KINDS[r.kind].label}</strong><span class="ad-price">${formatNumber(Number(r.price))} ر.س</span></div>
    <p class="ad-req-meta">📍 ${r.regions.map(escapeHtml).join('، ')}<br>📅 ${escapeHtml(formatDate(r.starts_on))} ← ${escapeHtml(formatDate(r.ends_on))} (${r.days} يوم)${r.link_url ? `<br>🔗 <a href="${escapeHtml(r.link_url)}" target="_blank" rel="noopener" dir="ltr">${escapeHtml(r.link_url)}</a>` : ''}</p>
    ${img ? `<img class="ad-req-img" src="${escapeHtml(img)}" alt="صورة البنر">` : ''}
    ${conflicts.length ? `<div class="notice warn"><strong>⚠️ يتداخل مع ${conflicts.length} ${conflicts.length === 1 ? 'طلب' : 'طلبات'}:</strong>
      <ul>${conflicts.map(c => `<li>${escapeHtml(c.stores?.name || '')} · ${AD_STATUS[c.status].label} · ${c.regions.filter(x => r.regions.includes(x)).map(escapeHtml).join('، ')} · ${escapeHtml(formatDate(c.starts_on))} ← ${escapeHtml(formatDate(c.ends_on))}</li>`).join('')}</ul></div>` : ''}
    <ul class="ad-thread">${r.messages.map(m => `<li class="ad-msg ad-msg-${m.sender}">
      <div class="ad-msg-head"><strong>${m.sender === 'admin' ? 'أنت' : m.sender === 'owner' ? 'المتجر' : 'النظام'}</strong>${MESSAGE_KIND[m.kind] ? `<span class="tag-chip static">${MESSAGE_KIND[m.kind]}</span>` : ''}<small>${escapeHtml(TIME.format(new Date(m.created_at)))}</small></div>
      ${m.body ? `<p>${escapeHtml(m.body)}</p>` : ''}</li>`).join('')}</ul>
    ${closed ? '' : `
    <div class="ad-actions-box">
      ${state.mode === 'approve' ? `
        <h4>✅ الموافقة وطلب السداد</h4>
        <div class="segmented" role="radiogroup" aria-label="طريقة السداد">
          <label><input type="radio" name="payMethod" value="bank" checked><span>🏦 حوالة بنكية</span></label>
          <label><input type="radio" name="payMethod" value="invoice"><span>🧾 رابط فاتورة</span></label>
          <label><input type="radio" name="payMethod" value="both"><span>الاثنين</span></label>
        </div>
        <label class="field"><span>رابط الفاتورة الإلكترونية</span><input id="payInvoice" dir="ltr" inputmode="url" placeholder="https://…"></label>
        <label class="field"><span>نص الرسالة <small>(تقدر تعدّله)</small></span><textarea id="adReplyText" rows="9">${escapeHtml(paymentText(r, 'bank', '', ''))}</textarea></label>
        <div class="bd-actions"><button type="button" class="btn btn-primary btn-sm" data-ad-do="approve">إرسال الموافقة وطلب السداد</button><button type="button" class="btn btn-ghost btn-sm" data-ad-mode="">رجوع</button></div>`
      : `
        <label class="field"><span>رسالتك للمتجر</span><textarea id="adReplyText" rows="3" maxlength="1500" placeholder="اكتب رسالة، أو سبب طلب التعديل…"></textarea></label>
        <div class="bd-actions">
          <button type="button" class="btn btn-ghost btn-sm" data-ad-do="message">💬 إرسال رسالة</button>
          ${['pending', 'approved', 'changes'].includes(r.status) ? '<button type="button" class="btn btn-ghost btn-sm" data-ad-do="changes">✏️ طلب تعديل الموعد / الطلب</button>' : ''}
          ${['pending', 'changes'].includes(r.status) ? '<button type="button" class="btn btn-primary btn-sm" data-ad-mode="approve">✅ موافقة وطلب سداد</button>' : ''}
          ${r.status === 'approved' ? '<button type="button" class="btn btn-primary btn-sm" data-ad-do="paid">💰 تأكيد استلام السداد وتفعيل الإعلان</button>' : ''}
          ${r.status !== 'paid' ? '<button type="button" class="btn btn-ghost btn-sm danger" data-ad-do="reject">❌ رفض</button>' : '<button type="button" class="btn btn-ghost btn-sm danger" data-ad-do="cancel">إلغاء الإعلان المفعّل</button>'}
        </div>`}
    </div>`}`;
}

function openRequest(id) {
  const r = state.requests.find(x => x.id === Number(id));
  if (!r) return;
  state.openId = r.id;
  state.mode = null;
  paintDialog();
  if (!$('adReqDialog').open) $('adReqDialog').showModal();
}

function paintDialog() {
  const r = state.requests.find(x => x.id === state.openId);
  if (r) $('adReqBody').innerHTML = dialogHtml(r);
}

async function act(action) {
  const r = state.requests.find(x => x.id === state.openId);
  const text = ($('adReplyText')?.value || '').trim();
  if (['reject', 'cancel'].includes(action) && !confirm(action === 'reject' ? 'رفض طلب الإعلان؟' : 'إلغاء الإعلان المفعّل؟')) return;
  if (action === 'paid' && !confirm('تأكيد استلام السداد؟ يتفعّل الإعلان تلقائيًا في موعده.')) return;
  try {
    await state.backend.adReply(r.id, action, text);
    state.toast({ message: '✅ تم', kind: 'ok' });
    state.mode = null;
    await load();
    paintDialog();
  } catch (err) {
    state.toast({ message: `تعذر التنفيذ: ${err.message}`, kind: 'error' });
  }
}

export async function load() {
  try {
    state.requests = (await state.backend.adRequests()) || [];
    state.ready = true;
  } catch (err) {
    state.ready = false;
    $('adReqList').innerHTML = `<div class="status"><span class="big">🛠️</span><strong>طلبات الإعلان تتوفر بعد تشغيل ترحيل قاعدة البيانات 011</strong><span class="muted">${escapeHtml(err.message)}</span></div>`;
    return;
  }
  renderAll();
}

export function initAdRequests({ backend, toast, getBank }) {
  Object.assign(state, { backend, toast, getBank });
  $('adMonthPrev').addEventListener('click', () => { state.month = shiftMonth(state.month, -1); renderCalendar(); });
  $('adMonthNext').addEventListener('click', () => { state.month = shiftMonth(state.month, 1); renderCalendar(); });
  $('adCalendar').addEventListener('click', e => {
    const cell = e.target.closest('.cal-cell');
    if (cell) showCell(cell.dataset.region, cell.dataset.day);
  });
  document.querySelectorAll('input[name="adFilter"]').forEach(r => r.addEventListener('change', e => { state.filter = e.target.value; renderList(); }));
  $('adminAds').addEventListener('click', e => {
    const open = e.target.closest('[data-open]');
    if (open) openRequest(open.dataset.open);
  });
  $('adReqList').addEventListener('keydown', e => {
    const row = e.target.closest('[data-open]');
    if (row && e.key === 'Enter') openRequest(row.dataset.open);
  });
  const dialog = $('adReqDialog');
  dialog.addEventListener('click', e => {
    if (e.target === dialog || e.target.closest('[data-close]')) return dialog.close();
    const mode = e.target.closest('[data-ad-mode]');
    if (mode) {
      state.mode = mode.dataset.adMode || null;
      paintDialog();
      return undefined;
    }
    const doIt = e.target.closest('[data-ad-do]');
    if (doIt) act(doIt.dataset.adDo);
    return undefined;
  });
  // نص السداد يتحدث مع اختيار الطريقة ورابط الفاتورة
  dialog.addEventListener('input', e => {
    if (e.target.id !== 'payInvoice') return;
    refreshPaymentText();
  });
  dialog.addEventListener('change', e => {
    if (e.target.name === 'payMethod') refreshPaymentText();
  });
}

function refreshPaymentText() {
  const r = state.requests.find(x => x.id === state.openId);
  const method = document.querySelector('input[name="payMethod"]:checked')?.value || 'bank';
  $('adReplyText').value = paymentText(r, method, $('payInvoice').value.trim(), '');
}
