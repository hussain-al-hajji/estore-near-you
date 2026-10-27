import { REGIONS, DELIVERY, DELIVERY_ICONS } from './constants.js';
import {
  CATEGORIES, CATEGORY_ICONS, SETTINGS, ENTITY_TYPES, REGISTRANT_ROLES, applySettings, deepMerge, graceLabel,
} from './settings.js';
import { DEFAULT_SETTINGS, DEFAULT_ADMIN_SETTINGS } from './default-settings.js';
import { renderFooters } from './footer.js';
import { createBackend } from './admin-data.js';
import { createMap, pinIcon } from './map.js';
import { columnChart, barList, formatNumber, formatCompact } from './charts.js';
import { billingInfo, BILLING_LABELS, graceRemainingText, fillTemplate, formatDate } from './billing.js';
import { escapeHtml, safeUrl, dayKey, storeLocations, storeCategories } from './utils.js';

const $ = id => document.getElementById(id);
const backend = await createBackend();

const STATUS = {
  pending: { label: 'قيد المراجعة', icon: '⏳' },
  approved: { label: 'معتمد', icon: '✓' },
  suspended: { label: 'موقوف', icon: '⏸' },
  rejected: { label: 'مرفوض', icon: '✕' },
};
const FIELD_LABELS = {
  logo_url: 'رابط الشعار',
  description: 'نبذة عن المتجر',
  delivery: 'خيارات التوصيل',
  socials: 'حسابات التواصل',
  district: 'الحي',
  cr_number: 'رقم السجل / الوثيقة',
};
const DATE = new Intl.DateTimeFormat('ar-u-ca-gregory-nu-latn', { day: 'numeric', month: 'short', year: 'numeric' });
const DATETIME = new Intl.DateTimeFormat('ar-u-ca-gregory-nu-latn', { dateStyle: 'full', timeStyle: 'short' });
const RELATIVE = new Intl.RelativeTimeFormat('ar-u-nu-latn', { numeric: 'auto' });

const state = {
  stores: [],
  stats: null,
  payments: [],
  edits: [],
  adminSettings: structuredClone(DEFAULT_ADMIN_SETTINGS),
  range: 30,
  clicks: new Map(),
  status: 'all',
  sort: { key: 'created_at', dir: 'desc' },
  openId: null,
};
let drawerMap = null;

// ---------- مساعدات ----------

function toast(message, kind = 'ok') {
  const el = $('toast');
  el.textContent = message;
  el.className = `toast toast-${kind}`;
  el.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { el.hidden = true; }, 3600);
}

function relative(iso) {
  const days = Math.round((new Date(iso) - new Date()) / 86400000);
  if (Math.abs(days) < 1) {
    const hours = Math.round((new Date(iso) - new Date()) / 3600000);
    return hours === 0 ? 'الآن' : RELATIVE.format(hours, 'hour');
  }
  if (Math.abs(days) < 30) return RELATIVE.format(days, 'day');
  return DATE.format(new Date(iso));
}

function localPhone(p) {
  return p && p.startsWith('966') ? `0${p.slice(3)}` : (p || '');
}

function statusPill(status) {
  const s = STATUS[status] || STATUS.pending;
  return `<span class="status-pill status-${status}">${s.icon} ${s.label}</span>`;
}

function inRange(iso, days, offset = 0) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (days - 1) - offset);
  const end = new Date(start);
  end.setDate(end.getDate() + days);
  const t = new Date(iso);
  return t >= start && t < end;
}

function delta(current, previous) {
  if (!previous) return current ? 'جديد في هذه الفترة' : 'لا تغيير';
  const pct = Math.round(((current - previous) / previous) * 100);
  if (pct === 0) return 'نفس الفترة السابقة';
  return `${pct > 0 ? '↑' : '↓'} ${Math.abs(pct)}% عن الفترة السابقة`;
}

// الاشتراك يهم المتاجر الظاهرة أو الموقوفة فقط
function billable(s) {
  return s.status === 'approved' || s.status === 'suspended';
}

function billingMatches(s, filter) {
  if (!filter) return true;
  if (!billable(s)) return false;
  const info = billingInfo(s);
  if (filter === 'soon') return info.soon && info.key !== 'overdue';
  return info.key === filter;
}

function billingLine(s) {
  if (!billable(s)) return '';
  const info = billingInfo(s);
  return `<small class="bill bill-${info.key}${info.soon ? ' soon' : ''}">${BILLING_LABELS[info.key].icon} ${info.short}</small>`;
}

function paymentEmailLink(s) {
  const email = s.owner?.email;
  if (!email) return null;
  const info = billingInfo(s);
  const { bank, email: tpl } = state.adminSettings;
  const vars = {
    store: s.name,
    owner: s.owner?.owner_name || '',
    amount: info.fee,
    due_date: formatDate(info.due),
    grace_end: formatDate(info.graceEnd),
    days_left: graceRemainingText(info),
    bank_name: bank.bank_name || '—',
    account_name: bank.account_name || '—',
    iban: bank.iban || '—',
  };
  return `mailto:${email}?subject=${encodeURIComponent(fillTemplate(tpl.subject, vars))}&body=${encodeURIComponent(fillTemplate(tpl.body, vars))}`;
}

const bankMissing = () => !state.adminSettings.bank.iban;

// ---------- تسجيل الدخول ----------

async function showLogin(error = '') {
  $('appView').hidden = true;
  $('loginView').hidden = false;
  $('loginError').textContent = error;
  $('loginError').hidden = !error;
  if (backend.demo) {
    $('loginDemo').hidden = false;
    $('loginFields').hidden = true;
    $('loginFields').querySelectorAll('input').forEach(i => { i.required = false; });
    $('loginBtn').textContent = 'دخول تجريبي 🚀';
  }
}

async function enter(session) {
  try {
    if (!(await backend.isAdmin())) {
      await backend.signOut();
      return showLogin('هذا الحساب ليس له صلاحية المشرف.');
    }
  } catch (err) {
    return showLogin(`تعذر التحقق من الصلاحية: ${err.message}`);
  }
  $('loginView').hidden = true;
  $('appView').hidden = false;
  $('appDemo').hidden = !backend.demo;
  $('userEmail').textContent = session.email;
  route();
  await loadAll();
}

$('loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target.elements;
  const btn = $('loginBtn');
  btn.disabled = true;
  try {
    const session = await backend.signIn(f.email.value.trim(), f.password.value);
    await enter(session);
  } catch (err) {
    showLogin(err.message);
  } finally {
    btn.disabled = false;
  }
});

$('logoutBtn').addEventListener('click', async () => {
  await backend.signOut();
  closeDrawer();
  showLogin();
});

// ---------- التحميل ----------

async function loadAll() {
  document.body.classList.add('loading');
  try {
    const [stores, stats, payments, adminSettings, edits] = await Promise.all([
      backend.stores(), backend.eventStats(state.range * 2), backend.payments(), backend.adminSettings(),
      backend.edits().catch(() => []),
    ]);
    state.stores = stores;
    state.payments = payments;
    state.edits = edits;
    state.adminSettings = deepMerge(structuredClone(DEFAULT_ADMIN_SETTINGS), adminSettings);
    setStats(stats);
    renderAll();
    renderSettings();
    renderStorage();
  } catch (err) {
    toast(`تعذر تحميل البيانات: ${err.message}`, 'error');
  } finally {
    document.body.classList.remove('loading');
  }
}

async function loadStats() {
  document.body.classList.add('loading');
  try {
    setStats(await backend.eventStats(state.range * 2));
    renderAll();
  } catch (err) {
    toast(`تعذر تحميل الإحصائيات: ${err.message}`, 'error');
  } finally {
    document.body.classList.remove('loading');
  }
}

// نطلب ضعف الفترة لنقارن الفترة الحالية بالسابقة
function setStats(stats) {
  const daily = stats.daily || [];
  state.stats = { current: daily.slice(-state.range), previous: daily.slice(0, -state.range) };
  state.clicks = new Map((stats.store_clicks || []).map(r => [String(r.store_id), r.clicks]));
}

function renderAll() {
  const pending = state.stores.filter(s => s.status === 'pending').length + state.edits.length;
  $('pendingBadge').textContent = pending;
  $('pendingBadge').hidden = !pending;
  renderOverview();
  renderTable();
}

// ---------- نظرة عامة ----------

function renderOverview() {
  const { current, previous } = state.stats;
  const sum = (rows, k) => rows.reduce((n, r) => n + r[k], 0);
  const approved = state.stores.filter(s => s.status === 'approved');
  const pending = state.stores.filter(s => s.status === 'pending').length;
  const billed = state.stores.filter(billable).map(s => ({ s, info: billingInfo(s) }));
  const overdue = billed.filter(b => b.info.key === 'overdue').length;
  const soon = billed.filter(b => b.info.soon && b.info.key !== 'overdue').length;
  const yearAgo = Date.now() - 365 * 86400000;
  const revenue = state.payments.filter(p => new Date(p.created_at) >= yearAgo).reduce((n, p) => n + Number(p.amount), 0);
  const signups = state.stores.filter(s => inRange(s.created_at, state.range)).length;
  const prevSignups = state.stores.filter(s => inRange(s.created_at, state.range, state.range)).length;
  const visits = sum(current, 'visits');
  const clicks = sum(current, 'clicks');
  const cities = new Set(approved.map(s => s.city)).size;

  const tiles = [
    { label: 'بانتظار المراجعة', value: pending, sub: pending ? 'اضغط للمراجعة ←' : 'كل الطلبات مراجعة 👌', accent: pending > 0, status: 'pending' },
    { label: 'طلبات تعديل', value: state.edits.length, sub: state.edits.length ? 'تعديلات من أصحاب المتاجر ←' : 'لا توجد طلبات', accent: state.edits.length > 0, status: 'edits' },
    { label: 'متاجر معتمدة', value: approved.length, sub: `في ${formatNumber(cities)} مدينة` },
    { label: 'اشتراكات متأخرة', value: overdue, sub: overdue ? 'انتهت مهلتها، اضغط للعرض ←' : 'لا يوجد تأخير 👌', warn: overdue > 0, billing: 'overdue' },
    { label: 'مستحقة قريبًا', value: soon, sub: 'خلال 30 يوم أو في المهلة', billing: 'soon' },
    { label: 'إيرادات آخر 12 شهر', value: `${formatNumber(revenue)} ر.س`, sub: `${formatNumber(state.payments.length)} دفعة مسجلة` },
    { label: 'زيارات الموقع', value: visits, sub: delta(visits, sum(previous, 'visits')) },
    { label: 'نقرات على المتاجر', value: clicks, sub: delta(clicks, sum(previous, 'clicks')) },
    { label: 'تسجيلات جديدة', value: signups, sub: delta(signups, prevSignups) },
  ];
  $('tiles').innerHTML = tiles.map(t => {
    const link = t.status || t.billing;
    const tag = link ? `a href="#admin/stores" ${t.status ? `data-status="${t.status}"` : `data-billing="${t.billing}"`}` : 'div';
    const cls = `tile${t.accent ? ' tile-accent' : ''}${t.warn ? ' tile-warn' : ''}`;
    return `<${tag} class="${cls}">
      <span class="tile-label">${t.label}</span>
      <strong class="tile-value">${typeof t.value === 'number' ? formatCompact(t.value) : t.value}</strong>
      <span class="tile-sub">${t.sub}</span>
    </${link ? 'a' : 'div'}>`;
  }).join('');

  // مواعيد السداد: المتأخر أولًا ثم الأقرب
  const due = billed
    .sort((a, b) => a.info.toGraceEnd - b.info.toGraceEnd || a.info.due.localeCompare(b.info.due))
    .slice(0, 8);
  $('dueList').innerHTML = due.length ? due.map(({ s, info }) => {
    const mail = paymentEmailLink(s);
    return `<div class="due-row" data-id="${escapeHtml(s.id)}">
      <span class="due-store"><strong>${escapeHtml(s.name)}</strong><small>${ENTITY_TYPES[s.entity_type]?.icon || ''} ${ENTITY_TYPES[s.entity_type]?.label || ''} · ${formatNumber(info.fee)} ر.س</small></span>
      <span class="due-when"><span class="bill bill-${info.key}${info.soon ? ' soon' : ''}">${BILLING_LABELS[info.key].icon} ${info.short}</span><small>${info.key === 'paid' || info.key === 'launch' ? `الاستحقاق ${formatDate(info.due)}` : `آخر موعد ${formatDate(info.graceEnd)}`}</small></span>
      ${mail ? `<a class="btn btn-ghost btn-sm" href="${escapeHtml(mail)}" title="إيميل بيانات السداد">✉️ تذكير</a>` : ''}
    </div>`;
  }).join('') : '<p class="muted empty">لا توجد متاجر معتمدة بعد.</p>';

  const tooltip = $('tooltip');
  columnChart($('visitsChart'), current.map(d => ({ day: d.day, value: d.visits })), { unit: 'زيارة', tooltip });

  const signupDays = new Map(current.map(d => [d.day, 0]));
  for (const s of state.stores) {
    const k = dayKey(s.created_at);
    if (signupDays.has(k)) signupDays.set(k, signupDays.get(k) + 1);
  }
  columnChart($('signupsChart'), [...signupDays].map(([day, value]) => ({ day, value })), { unit: 'متجر', tooltip });

  const byId = new Map(state.stores.map(s => [s.id, s]));
  barList($('topStores'), [...state.clicks]
    .filter(([id]) => byId.has(id))
    .slice(0, 8)
    .map(([id, value]) => ({ label: byId.get(id).name, icon: CATEGORY_ICONS[byId.get(id).category], value })),
  { empty: 'لا توجد نقرات في هذه الفترة' });

  const count = key => {
    const m = new Map();
    for (const s of approved) m.set(s[key], (m.get(s[key]) || 0) + 1);
    return [...m].sort((a, b) => b[1] - a[1]);
  };
  barList($('byRegion'), count('region').map(([label, value]) => ({ label, value })));
  const byCat = new Map();
  for (const s of approved) for (const c of storeCategories(s)) byCat.set(c, (byCat.get(c) || 0) + 1);
  barList($('byCategory'), [...byCat].sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value, icon: CATEGORY_ICONS[label] })));
}

document.querySelectorAll('input[name="range"]').forEach(r => r.addEventListener('change', () => {
  state.range = Number(r.value);
  loadStats();
}));

// البطاقات والروابط التي تفتح جدول المتاجر بفلتر جاهز
document.addEventListener('click', e => {
  const link = e.target.closest('#screen-admin a[data-status], #screen-admin a[data-billing]');
  if (!link) return;
  state.status = link.dataset.status || 'all';
  $('tableBilling').value = link.dataset.billing || '';
  renderTable();
});

$('dueList').addEventListener('click', e => {
  if (e.target.closest('a')) return;
  const row = e.target.closest('.due-row');
  if (row) openDrawer(row.dataset.id);
});

// ---------- جدول المتاجر ----------

for (const r of REGIONS) $('tableRegion').add(new Option(r.name, r.name));

function fillCategoryFilter() {
  const current = $('tableCategory').value;
  $('tableCategory').length = 1;
  for (const c of CATEGORIES) $('tableCategory').add(new Option(`${CATEGORY_ICONS[c]} ${c}`, c));
  $('tableCategory').value = CATEGORIES.includes(current) ? current : '';
}
fillCategoryFilter();

function filteredStores() {
  const q = $('tableSearch').value.trim().toLowerCase();
  const region = $('tableRegion').value;
  const category = $('tableCategory').value;
  const billing = $('tableBilling').value;
  const rows = state.stores.filter(s =>
    (state.status === 'all' || s.status === state.status || (state.status === 'edits' && editFor(s.id)))
    && (!region || storeLocations(s).some(l => l.region === region))
    && (!category || storeCategories(s).includes(category))
    && billingMatches(s, billing)
    && (!q || [s.name, s.url, s.city, s.district, s.owner?.owner_name, s.owner?.email, s.owner?.phone, localPhone(s.owner?.phone)]
      .some(v => v && String(v).toLowerCase().includes(q))));
  const { key, dir } = state.sort;
  const value = s => (key === 'owner' ? s.owner?.owner_name : key === 'clicks' ? state.clicks.get(s.id) || 0 : s[key]) ?? '';
  rows.sort((a, b) => {
    const va = value(a);
    const vb = value(b);
    const cmp = typeof va === 'number' ? va - vb : String(va).localeCompare(String(vb), 'ar');
    return dir === 'asc' ? cmp : -cmp;
  });
  return rows;
}

function renderTable() {
  const counts = { all: state.stores.length };
  for (const s of state.stores) counts[s.status] = (counts[s.status] || 0) + 1;
  counts.edits = state.edits.length;
  $('statusTabs').innerHTML = [['all', 'الكل'], ['pending', 'قيد المراجعة'], ['edits', '✏️ طلبات تعديل'], ['approved', 'معتمد'], ['suspended', 'موقوف'], ['rejected', 'مرفوض']]
    .map(([k, label]) => `<button type="button" class="status-tab${state.status === k ? ' active' : ''}" data-status="${k}" role="tab" aria-selected="${state.status === k}">${label} <span>${counts[k] || 0}</span></button>`)
    .join('');

  document.querySelector('th[data-sort="clicks"]').textContent = `النقرات (${state.range} يوم)`;
  document.querySelectorAll('th[data-sort]').forEach(th => {
    th.classList.toggle('sorted', th.dataset.sort === state.sort.key);
    th.classList.toggle('asc', th.dataset.sort === state.sort.key && state.sort.dir === 'asc');
    th.classList.toggle('desc', th.dataset.sort === state.sort.key && state.sort.dir === 'desc');
  });

  const rows = filteredStores();
  $('storesSummary').textContent = `${formatNumber(rows.length)} من ${formatNumber(state.stores.length)} متجر`;
  $('tableBody').innerHTML = rows.map(s => {
    const host = (() => { try { return new URL(s.url).host.replace(/^www\./, ''); } catch { return s.url || 'حسابات تواصل فقط'; } })();
    const phone = s.owner?.phone;
    const entity = ENTITY_TYPES[s.entity_type];
    const actions = s.status === 'pending'
      ? '<button type="button" class="mini-btn approve" data-action="approve" title="اعتماد">✓</button><button type="button" class="mini-btn reject" data-action="reject" title="رفض">✕</button>'
      : '<span class="open-hint">تفاصيل ←</span>';
    return `
      <tr data-id="${escapeHtml(s.id)}" tabindex="0">
        <td>
          <div class="cell-store">
            <span class="mini-avatar">${escapeHtml([...s.name.trim()][0] || '؟')}</span>
            <span><strong>${escapeHtml(s.name)}</strong><small dir="ltr">${escapeHtml(host)}</small></span>
          </div>
        </td>
        <td class="nowrap"><span>${CATEGORY_ICONS[s.category] || '🛍️'} ${escapeHtml(s.category)}${storeCategories(s).length > 1 ? ` <em class="more-cats" title="${escapeHtml(storeCategories(s).join('، '))}">+${storeCategories(s).length - 1}</em>` : ''}</span><small>${entity ? `${entity.icon} ${entity.label}` : ''}</small></td>
        <td class="nowrap"><span>${escapeHtml(s.city)}${s.district ? ` · ${escapeHtml(s.district)}` : ''}</span><small>${storeLocations(s).length > 1 ? `📍 ${storeLocations(s).length} مواقع` : `📍 ${escapeHtml(s.region)}`}</small></td>
        <td class="nowrap"><span>${escapeHtml(s.owner?.owner_name || '—')}${s.owner?.registrant_role === 'employee' ? ' <em class="role-tag">موظف</em>' : ''}</span>${phone ? `<small><a href="https://wa.me/${escapeHtml(phone)}" target="_blank" rel="noopener" title="واتساب" dir="ltr">${escapeHtml(localPhone(phone))}</a></small>` : ''}</td>
        <td class="num">${formatNumber(state.clicks.get(s.id) || 0)}</td>
        <td class="nowrap" title="${escapeHtml(DATETIME.format(new Date(s.created_at)))}">${relative(s.created_at)}</td>
        <td class="nowrap">${statusPill(s.status)}${editFor(s.id) ? '<span class="status-pill status-edit">✏️ تعديل</span>' : ''}${billingLine(s)}</td>
        <td class="nowrap row-actions">${actions}</td>
      </tr>`;
  }).join('');

  $('tableEmpty').hidden = rows.length > 0;
  $('tableEmpty').innerHTML = state.stores.length
    ? '<span class="big">🔍</span><strong>لا توجد متاجر تطابق البحث</strong>'
    : '<span class="big">🛍️</span><strong>لم يسجل أي متجر بعد</strong><span>شارك رابط «أضف متجرك» مع أصحاب المتاجر.</span>';
}

$('statusTabs').addEventListener('click', e => {
  const tab = e.target.closest('[data-status]');
  if (!tab) return;
  state.status = tab.dataset.status;
  renderTable();
});
['tableSearch', 'tableRegion', 'tableCategory', 'tableBilling'].forEach(id =>
  $(id).addEventListener(id === 'tableSearch' ? 'input' : 'change', renderTable));

document.querySelector('.data-table thead').addEventListener('click', e => {
  const th = e.target.closest('th[data-sort]');
  if (!th) return;
  const key = th.dataset.sort;
  state.sort = { key, dir: state.sort.key === key && state.sort.dir === 'desc' ? 'asc' : 'desc' };
  renderTable();
});

$('tableBody').addEventListener('click', e => {
  if (e.target.closest('a')) return;
  const row = e.target.closest('tr[data-id]');
  if (!row) return;
  const action = e.target.closest('[data-action]')?.dataset.action;
  if (action) act(row.dataset.id, action);
  else openDrawer(row.dataset.id);
});
$('tableBody').addEventListener('keydown', e => {
  const row = e.target.closest('tr[data-id]');
  if (row && e.key === 'Enter' && e.target === row) openDrawer(row.dataset.id);
});

$('copyEmailsBtn').addEventListener('click', async () => {
  const emails = [...new Set(filteredStores().map(s => s.owner?.email).filter(Boolean))];
  if (!emails.length) return toast('لا توجد إيميلات في النتائج الحالية', 'error');
  try {
    await navigator.clipboard.writeText(emails.join(', '));
    toast(`📋 تم نسخ ${formatNumber(emails.length)} إيميل، الصقها في خانة BCC`);
  } catch {
    prompt('انسخ الإيميلات:', emails.join(', '));
  }
});

// ---------- الإجراءات ----------

const STATUS_ACTIONS = {
  approve: { status: 'approved', message: '🎉 تم اعتماد المتجر وصار يظهر في الموقع' },
  resume: { status: 'approved', message: '▶️ رجع المتجر للظهور في الموقع' },
  suspend: { status: 'suspended', message: '⏸ تم إيقاف ظهور المتجر' },
  reject: { status: 'rejected', message: 'تم رفض المتجر' },
  pending: { status: 'pending', message: 'رجع المتجر لقائمة المراجعة' },
};

async function act(id, action) {
  const store = state.stores.find(s => s.id === id);
  if (!store) return;
  try {
    if (action === 'delete') {
      if (!confirm(`حذف «${store.name}» نهائيًا مع بيانات صاحبه ومدفوعاته؟ لا يمكن التراجع.`)) return;
      await backend.remove(id);
      state.stores = state.stores.filter(s => s.id !== id);
      state.payments = state.payments.filter(p => p.store_id !== id);
      closeDrawer();
      toast('🗑️ تم حذف المتجر');
    } else if (action === 'edit-approve' || action === 'edit-reject') {
      const edit = editFor(id);
      const approve = action === 'edit-approve';
      if (!approve && !$('editNote').value.trim() && !confirm('رفض التعديل بدون ذكر السبب لصاحب المتجر؟')) return;
      await backend.reviewEdit(edit.id, approve, $('editNote').value.trim());
      [state.stores, state.edits] = await Promise.all([backend.stores(), backend.edits()]);
      toast(approve ? '✅ تم اعتماد التعديل وصار ظاهر في المنصة' : 'تم رفض التعديل');
      openDrawer(id);
    } else if (action === 'note') {
      const note = $('adminNote').value.trim() || null;
      await backend.update(id, { admin_note: note });
      store.admin_note = note;
      toast('💾 تم حفظ الملاحظة');
    } else if (action === 'entity') {
      const entity = $('entitySelect').value;
      await backend.update(id, { entity_type: entity });
      store.entity_type = entity;
      toast('💾 تم تحديث نوع النشاط والرسوم');
      openDrawer(id);
    } else if (action === 'paid-until') {
      const value = $('paidUntil').value || null;
      await backend.update(id, { paid_until: value });
      store.paid_until = value;
      toast(value ? `💾 الاشتراك مدفوع حتى ${formatDate(value)}` : '💾 تم مسح تاريخ الاشتراك');
      openDrawer(id);
    } else if (action === 'payment') {
      const amount = Number($('payAmount').value);
      if (!(amount >= 0) || $('payAmount').value === '') return toast('اكتب مبلغ الدفعة', 'error');
      const until = await backend.recordPayment(id, amount, $('payNote').value.trim());
      [state.stores, state.payments] = await Promise.all([backend.stores(), backend.payments()]);
      toast(`✅ تم تسجيل الدفعة، الاشتراك مدفوع حتى ${formatDate(until)}`);
      openDrawer(id);
    } else if (STATUS_ACTIONS[action]) {
      const { status, message } = STATUS_ACTIONS[action];
      if (action === 'suspend' && !confirm(`إيقاف ظهور «${store.name}» في الموقع؟ تقدر ترجعه في أي وقت.`)) return;
      const patch = { status };
      if (status === 'approved' && (action === 'approve' || !store.approved_at)) patch.approved_at = new Date().toISOString();
      await backend.update(id, patch);
      Object.assign(store, patch);
      toast(message);
      if (state.openId === id) openDrawer(id);
    }
    renderAll();
  } catch (err) {
    toast(`تعذر تنفيذ العملية: ${err.message}`, 'error');
  }
}

// ---------- تفاصيل المتجر ----------

function infoRow(label, value) {
  return value ? `<div class="info-row"><dt>${label}</dt><dd>${value}</dd></div>` : '';
}

function subscriptionSection(s) {
  const info = billingInfo(s);
  const payments = state.payments.filter(p => String(p.store_id) === s.id);
  const mail = paymentEmailLink(s);
  const options = Object.entries(ENTITY_TYPES)
    .map(([k, v]) => `<option value="${k}"${s.entity_type === k ? ' selected' : ''}>${v.icon} ${v.label}</option>`).join('');
  const state_ = billable(s)
    ? `<span class="bill bill-${info.key}${info.soon ? ' soon' : ''}">${BILLING_LABELS[info.key].icon} ${BILLING_LABELS[info.key].label} · ${info.short}</span>`
    : '<span class="muted">يبدأ احتساب الاشتراك بعد اعتماد المتجر</span>';
  return `
    <section class="drawer-section">
      <h3>💳 الاشتراك السنوي</h3>
      <dl>
        ${infoRow('الحالة', state_)}
        ${infoRow('نوع النشاط', `<span class="inline-edit"><select id="entitySelect">${options}</select><button type="button" class="btn btn-ghost btn-sm" data-action="entity">حفظ</button></span>`)}
        ${infoRow('الرسوم', `${formatNumber(info.fee)} ر.س سنويًا · مهلة السداد ${graceLabel(info.grace)}`)}
        ${infoRow('تاريخ التسجيل', formatDate(info.registered))}
        ${infoRow('تاريخ الاستحقاق', formatDate(info.due))}
        ${infoRow('آخر موعد للسداد', `${formatDate(info.graceEnd)} · ${graceRemainingText(info)}`)}
      </dl>

      ${mail ? `<a class="btn btn-primary btn-sm mail-btn" href="${escapeHtml(mail)}">✉️ إيميل بيانات السداد / تذكير</a>` : ''}
      ${bankMissing() ? '<p class="hint warn-hint">⚠️ أضف بيانات الحساب البنكي من <a href="#admin/settings">الإعدادات</a> حتى تظهر في الإيميل.</p>' : ''}

      <div class="sub-box">
        <h4>تسجيل دفعة (حوالة مستلمة)</h4>
        <div class="pay-row">
          <label><span>المبلغ (ر.س)</span><input id="payAmount" type="number" min="0" step="1" value="${info.fee}" dir="ltr"></label>
          <label class="grow"><span>ملاحظة</span><input id="payNote" maxlength="200" placeholder="مثال: حوالة الراجحي 12/7"></label>
        </div>
        <button type="button" class="btn btn-primary btn-sm" data-action="payment">✓ تسجيل الدفعة وتمديد سنة</button>
        <p class="hint">تُمدَّد السنة من تاريخ الاستحقاق (${escapeHtml(formatDate(info.due))})، وإذا كان المتجر موقوفًا يرجع للظهور.</p>
      </div>

      <div class="sub-box">
        <h4>تعديل نهاية الاشتراك يدويًا</h4>
        <span class="inline-edit"><input id="paidUntil" type="date" value="${escapeHtml(s.paid_until || '')}" dir="ltr"><button type="button" class="btn btn-ghost btn-sm" data-action="paid-until">حفظ</button></span>
      </div>

      ${payments.length ? `<h4 class="pay-title">سجل المدفوعات</h4><ul class="pay-list">${payments.map(p => `
        <li><strong>${formatNumber(Number(p.amount))} ر.س</strong><span>${escapeHtml(formatDate(p.period_start))} ← ${escapeHtml(formatDate(p.period_end))}</span><small>${escapeHtml(DATE.format(new Date(p.created_at)))}${p.note ? ` · ${escapeHtml(p.note)}` : ''}</small></li>`).join('')}</ul>` : ''}
    </section>`;
}

// ---------- طلبات التعديل والأداء ----------

function editFor(id) {
  return state.edits.find(e => String(e.store_id) === id);
}

function editSection(s) {
  const edit = editFor(s.id);
  if (!edit) return '';
  const d = edit.data;
  const o = s.owner || {};
  const show = v => (v === null || v === undefined || v === '' ? '—' : escapeHtml(String(v)));
  const list = arr => (arr || []).map(x => DELIVERY[x]).filter(Boolean).join('، ');
  const locText = locs => (locs || []).map(l => `${l.city}${l.district ? ` · ${l.district}` : ''}`).join(' / ');
  const rows = [
    ['الاسم', s.name, d.name],
    ['الرابط', s.url, d.url || null],
    ['المجالات', storeCategories(s).join('، '), (d.categories || [d.category]).join('، ')],
    ['نوع النشاط', ENTITY_TYPES[s.entity_type]?.label, ENTITY_TYPES[d.entity_type]?.label],
    ['النبذة', s.description, d.description],
    ['الشعار', s.logo_url, d.logo_url],
    ['التوصيل', list(s.delivery), list(d.delivery)],
    ['انستقرام', s.instagram, d.instagram],
    ['سناب شات', s.snapchat, d.snapchat],
    ['تيك توك', s.tiktok, d.tiktok],
    ['إكس', s.x_handle, d.x_handle],
    ['واتساب المتجر', localPhone(s.whatsapp), localPhone(d.whatsapp)],
    ['المواقع', locText(storeLocations(s)), locText(d.locations)],
    ['موقع تقريبي', s.approximate ? 'نعم' : 'لا', d.approximate ? 'نعم' : 'لا'],
    ['اسم المسجل', o.owner_name, d.owner?.owner_name],
    ['جوال المسجل', localPhone(o.phone), localPhone(d.owner?.phone)],
    ['السجل / الوثيقة', o.cr_number, d.owner?.cr_number],
    ['الصفة', REGISTRANT_ROLES[o.registrant_role], REGISTRANT_ROLES[d.owner?.registrant_role]],
    ['المسمى', o.registrant_title, d.owner?.registrant_role === 'employee' ? d.owner?.registrant_title : null],
  ].filter(([, before, after]) => (before || null) !== (after || null) && !(before == null && after === undefined));
  return `
    <section class="drawer-section edit-review">
      <h3>✏️ طلب تعديل بانتظار مراجعتك <small>${escapeHtml(DATE.format(new Date(edit.created_at)))}</small></h3>
      ${rows.length ? `<table class="diff-table"><thead><tr><th>الحقل</th><th>الحالي</th><th>المطلوب</th></tr></thead><tbody>
        ${rows.map(([label, before, after]) => `<tr><td>${label}</td><td class="old">${show(before)}</td><td class="new">${show(after)}</td></tr>`).join('')}
      </tbody></table>` : '<p class="muted">ما فيه تغييرات عن البيانات الحالية.</p>'}
      <label class="field"><span>ملاحظة لصاحب المتجر <small>(تظهر له، خصوصًا عند الرفض)</small></span><textarea id="editNote" rows="2" maxlength="300"></textarea></label>
      <div class="drawer-actions inline">
        <button type="button" class="btn btn-primary btn-sm" data-action="edit-approve">✓ اعتماد التعديل</button>
        <button type="button" class="btn btn-ghost btn-sm" data-action="edit-reject">✕ رفض</button>
      </div>
    </section>`;
}

async function loadDrawerPerformance(id) {
  let perf;
  try {
    perf = await backend.performance(id, 30);
  } catch {
    if (state.openId === id) $('drawerPerf').innerHTML = '<span class="muted">الإحصائيات تتوفر بعد تشغيل ترحيل قاعدة البيانات 003.</span>';
    return;
  }
  if (state.openId !== id) return;
  const impressions = perf.daily.reduce((n, d) => n + d.impressions, 0);
  const clicks = perf.daily.reduce((n, d) => n + d.clicks, 0);
  $('drawerPerf').innerHTML = `
    <dl>
      ${infoRow('الظهور في البحث', formatNumber(impressions))}
      ${infoRow('النقرات', formatNumber(clicks))}
      ${infoRow('أكثر الكلمات', perf.terms.slice(0, 6).map(t => `${escapeHtml(t.term)} (${formatNumber(t.hits)})`).join('، ') || '—')}
      ${infoRow('مدن الباحثين', perf.cities.slice(0, 6).map(c => `${escapeHtml(c.city)} (${formatNumber(c.hits)})`).join('، ') || '—')}
    </dl>`;
}

function openDrawer(id) {
  const s = state.stores.find(x => x.id === id);
  if (!s) return;
  state.openId = id;
  const url = safeUrl(s.url);
  const logo = s.logo_url && safeUrl(s.logo_url);
  const o = s.owner || {};
  const socials = [
    s.instagram && ['انستقرام', `https://instagram.com/${encodeURIComponent(s.instagram)}`, `@${s.instagram}`],
    s.x_handle && ['إكس', `https://x.com/${encodeURIComponent(s.x_handle)}`, `@${s.x_handle}`],
    s.tiktok && ['تيك توك', `https://www.tiktok.com/@${encodeURIComponent(s.tiktok)}`, `@${s.tiktok}`],
    s.snapchat && ['سناب شات', `https://www.snapchat.com/add/${encodeURIComponent(s.snapchat)}`, s.snapchat],
    s.whatsapp && ['واتساب المتجر', `https://wa.me/${encodeURIComponent(s.whatsapp)}`, localPhone(s.whatsapp)],
  ].filter(Boolean);
  const role = o.registrant_role === 'employee'
    ? `${REGISTRANT_ROLES.employee}${o.registrant_title ? ` · ${escapeHtml(o.registrant_title)}` : ''}`
    : REGISTRANT_ROLES.owner;
  const btn = (action, label, primary = false) =>
    `<button type="button" class="btn ${primary ? 'btn-primary' : 'btn-ghost'} btn-sm" data-action="${action}">${label}</button>`;

  $('drawer').innerHTML = `
    <header class="drawer-head">
      <button type="button" class="close" data-close aria-label="إغلاق">✕</button>
      <div class="drawer-title">
        <span class="mini-avatar big">${logo ? `<img src="${escapeHtml(logo)}" alt="" referrerpolicy="no-referrer">` : escapeHtml([...s.name.trim()][0] || '؟')}</span>
        <div>
          <h2>${escapeHtml(s.name)}</h2>
          ${url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener" dir="ltr">${escapeHtml(s.url)} ↗</a>` : '<span class="muted">بدون متجر إلكتروني (حسابات تواصل فقط)</span>'}
        </div>
      </div>
      <div class="drawer-status">${statusPill(s.status)} <span class="muted">سُجّل ${relative(s.created_at)}</span></div>
    </header>

    <div class="drawer-actions">
      ${s.status === 'pending' || s.status === 'rejected' ? btn('approve', '✓ اعتماد ونشر', true) : ''}
      ${s.status === 'suspended' ? btn('resume', '▶️ إعادة الظهور', true) : ''}
      ${s.status === 'approved' ? btn('suspend', '⏸ إيقاف الظهور') : ''}
      ${s.status === 'pending' ? btn('reject', '✕ رفض') : ''}
      ${s.status !== 'pending' ? btn('pending', '⏳ إرجاع للمراجعة') : ''}
    </div>

    ${editSection(s)}
    ${subscriptionSection(s)}

    <section class="drawer-section">
      <h3>📈 أداء المتجر <small>آخر 30 يوم</small></h3>
      <div id="drawerPerf" class="drawer-perf"><span class="muted">جارٍ التحميل…</span></div>
    </section>

    <section class="drawer-section">
      <h3>👤 المسجّل <small>خاص</small></h3>
      <dl>
        ${infoRow('الاسم', escapeHtml(o.owner_name || '—'))}
        ${infoRow('الصفة', role)}
        ${infoRow('الجوال', o.phone ? `<span dir="ltr">${escapeHtml(localPhone(o.phone))}</span> · <a href="https://wa.me/${escapeHtml(o.phone)}" target="_blank" rel="noopener">واتساب</a> · <a href="tel:+${escapeHtml(o.phone)}">اتصال</a>` : '')}
        ${infoRow('الإيميل', o.email ? `<a href="mailto:${escapeHtml(o.email)}" dir="ltr">${escapeHtml(o.email)}</a>` : '')}
        ${infoRow(s.entity_type === 'company' ? 'السجل التجاري' : 'وثيقة العمل الحر', o.cr_number ? `<span dir="ltr">${escapeHtml(o.cr_number)}</span>` : 'لم يُدخل')}
      </dl>
    </section>

    <section class="drawer-section">
      <h3>🏪 بيانات المتجر</h3>
      <dl>
        ${infoRow(storeCategories(s).length > 1 ? 'المجالات' : 'المجال', storeCategories(s).map((c, i) => `${i === 0 ? '⭐ ' : ''}${CATEGORY_ICONS[c] || '🛍️'} ${escapeHtml(c)}`).join('<br>'))}
        ${infoRow('النبذة', escapeHtml(s.description || ''))}
        ${infoRow('التوصيل', (s.delivery || []).map(d => `${DELIVERY_ICONS[d]} ${DELIVERY[d]}`).join('، '))}
        ${infoRow('التواصل', socials.map(([label, href, text]) => `<a href="${escapeHtml(href)}" target="_blank" rel="noopener">${label}: <span dir="ltr">${escapeHtml(text)}</span></a>`).join('<br>'))}
        ${infoRow('النقرات', `${formatNumber(state.clicks.get(s.id) || 0)} خلال آخر ${state.range} يوم`)}
      </dl>
    </section>

    <section class="drawer-section">
      <h3>📍 الموقع</h3>
      <dl>
        ${storeLocations(s).map((l, i) => infoRow(storeLocations(s).length > 1 ? `الموقع ${i + 1}` : 'العنوان',
          `${escapeHtml(l.region)} · ${escapeHtml(l.city)}${l.district ? ` · ${escapeHtml(l.district)}` : ''} · <a href="https://www.google.com/maps?q=${l.lat},${l.lng}" target="_blank" rel="noopener">قوقل ↗</a>`)).join('')}
        ${s.approximate ? infoRow('الدقة', 'موقع تقريبي (ضمن 1 كم)') : ''}
      </dl>
      <div class="drawer-map" id="drawerMap"></div>
    </section>

    <section class="drawer-section">
      <h3>📝 ملاحظات المشرف <small>لا تظهر للزوار</small></h3>
      <textarea id="adminNote" rows="3" placeholder="مثال: تواصلت معه وطلبت تعديل الشعار">${escapeHtml(s.admin_note || '')}</textarea>
      <button type="button" class="btn btn-ghost btn-sm" data-action="note">حفظ الملاحظة</button>
    </section>

    <footer class="drawer-foot">
      <button type="button" class="danger-link" data-action="delete">🗑️ حذف المتجر نهائيًا</button>
    </footer>`;

  $('drawer').querySelector('.mini-avatar img')?.addEventListener('error', e => {
    e.target.parentElement.textContent = [...s.name.trim()][0] || '؟';
  }, { once: true });

  const wasOpen = $('drawer').classList.contains('open');
  $('drawerBackdrop').hidden = false;
  $('drawer').classList.add('open');
  $('drawer').setAttribute('aria-hidden', 'false');
  if (!wasOpen) $('drawer').focus();

  loadDrawerPerformance(s.id);

  drawerMap?.remove();
  drawerMap = createMap('drawerMap');
  const locs = storeLocations(s);
  locs.forEach((l, i) => {
    L.marker([l.lat, l.lng], { icon: pinIcon('store', locs.length > 1 ? String(i + 1) : CATEGORY_ICONS[s.category]) }).addTo(drawerMap);
    if (s.approximate) L.circle([l.lat, l.lng], { radius: 800, color: '#ff5a3c', weight: 1 }).addTo(drawerMap);
  });
  if (locs.length > 1) drawerMap.fitBounds(L.latLngBounds(locs.map(l => [l.lat, l.lng])), { padding: [30, 30], maxZoom: 14 });
  else drawerMap.setView([locs[0].lat, locs[0].lng], s.approximate ? 13 : 15);
  setTimeout(() => drawerMap?.invalidateSize(), 250);
}

function closeDrawer() {
  state.openId = null;
  $('drawer').classList.remove('open');
  $('drawer').setAttribute('aria-hidden', 'true');
  $('drawerBackdrop').hidden = true;
  drawerMap?.remove();
  drawerMap = null;
}

$('drawer').addEventListener('click', e => {
  if (e.target.closest('[data-close]')) return closeDrawer();
  if (e.target.closest('a[href="#admin/settings"]')) return closeDrawer();
  const action = e.target.closest('[data-action]')?.dataset.action;
  if (action && state.openId) act(state.openId, action);
});
$('drawerBackdrop').addEventListener('click', closeDrawer);
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && state.openId) closeDrawer();
});

// ---------- المساحة والصيانة ----------

const TABLE_LABELS = {
  events: 'سجل الزيارات والنقرات',
  stores: 'المتاجر',
  store_owners: 'بيانات أصحاب المتاجر',
  store_locations: 'مواقع المتاجر',
  store_stats_daily: 'أداء المتاجر اليومي',
  store_search_terms: 'كلمات البحث اليومية',
  store_viewer_cities: 'مدن الباحثين اليومية',
  store_stats_monthly: 'أداء المتاجر الشهري',
  store_search_terms_monthly: 'كلمات البحث الشهرية',
  store_viewer_cities_monthly: 'مدن الباحثين الشهرية',
  site_stats_daily: 'مجاميع الزيارات اليومية',
  payments: 'المدفوعات',
  store_edits: 'طلبات التعديل',
};
const FREE_PLAN_BYTES = 500 * 1024 * 1024;
const mb = bytes => `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;

async function renderStorage() {
  const panel = $('storagePanel');
  let st;
  try {
    st = await backend.storageStats();
  } catch {
    panel.innerHTML = '<h2>🗄️ المساحة والصيانة</h2><p class="muted">تتوفر بعد تشغيل ترحيل قاعدة البيانات 004.</p>';
    return;
  }
  const pct = Math.min(100, Math.round((st.db_bytes / FREE_PLAN_BYTES) * 100));
  const last = st.last_run;
  const lastText = last
    ? `${DATETIME.format(new Date(last.ran_at))} · ضُغط ${formatNumber((last.result.events || 0) + (last.result.daily || 0) + (last.result.terms || 0) + (last.result.cities || 0))} سجل`
    : 'لم يُشغَّل بعد';
  panel.innerHTML = `
    <h2>🗄️ المساحة والصيانة</h2>
    <div class="storage-meter${pct >= 80 ? ' warn' : ''}" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}">
      <span style="width:${Math.max(pct, 1)}%"></span>
    </div>
    <p class="storage-text"><strong><bdi dir="ltr">${mb(st.db_bytes)}</bdi></strong> من <bdi dir="ltr">500 MB</bdi> (الخطة المجانية) · <bdi dir="ltr">${pct}%</bdi></p>
    <table class="fields-table storage-table">
      <thead><tr><th>الجدول</th><th>السجلات</th><th>الحجم</th></tr></thead>
      <tbody>${st.tables.slice(0, 6).map(t => `<tr><td>${escapeHtml(TABLE_LABELS[t.name] || t.name)}</td><td>${formatNumber(t.rows)}</td><td dir="ltr">${mb(t.bytes)}</td></tr>`).join('')}</tbody>
    </table>
    <p class="hint">🧹 التنظيف التلقائي ${st.cron ? '<b>مفعّل</b> يوميًا الساعة 3:15 فجرًا' : '<b class="warn-text">غير مفعّل</b>: فعّل <b>Cron</b> من Supabase ← Integrations ثم أعد تشغيل ملف الترحيل 004'}. آخر تشغيل: ${escapeHtml(lastText)}.</p>
    <p class="hint">يحفظ سجل الزيارات الخام 200 يوم ثم يجمعه يوميًا، وأداء المتاجر اليومي 13 شهر ثم يجمعه شهريًا (أعلى 50 كلمة ومدينة لكل متجر بالشهر)، فما تضيع الأرقام الإجمالية.</p>
    <button type="button" class="btn btn-ghost btn-sm" id="compactBtn">🧹 تنظيف الإحصائيات القديمة الآن</button>`;
}

$('storagePanel').addEventListener('click', async e => {
  if (!e.target.closest('#compactBtn')) return;
  const btn = e.target.closest('#compactBtn');
  btn.disabled = true;
  try {
    const r = await backend.compactStats();
    const total = (r.events || 0) + (r.daily || 0) + (r.terms || 0) + (r.cities || 0);
    toast(total ? `🧹 تم ضغط ${formatNumber(total)} سجل قديم` : '🧹 ما فيه بيانات قديمة تحتاج تنظيف');
    renderStorage();
  } catch (err) {
    toast(`تعذر التنظيف: ${err.message}`, 'error');
    btn.disabled = false;
  }
});

// ---------- الإعدادات ----------

function input(name, value, attrs = '') {
  return `<input name="${name}" value="${escapeHtml(value ?? '')}" ${attrs}>`;
}

function categoryRow(c = { name: '', icon: '' }) {
  return `<div class="cat-row">
    <input name="cat_icon" value="${escapeHtml(c.icon)}" maxlength="4" class="cat-icon" aria-label="أيقونة">
    <input name="cat_name" value="${escapeHtml(c.name)}" maxlength="40" placeholder="اسم التصنيف" aria-label="اسم التصنيف">
    <button type="button" class="mini-btn reject" data-remove-cat title="حذف">✕</button>
  </div>`;
}

function renderSettings() {
  const p = SETTINGS.pricing;
  const fm = SETTINGS.form;
  const ft = SETTINGS.footer;
  const a = state.adminSettings;
  $('settingsForm').innerHTML = `
    <article class="panel">
      <h2>💳 الأسعار والاشتراك</h2>
      <div class="settings-grid">
        <label class="field"><span>نهاية فترة الافتتاح المجانية</span>${input('launch_end', p.launch_end, 'type="date" required dir="ltr"')}</label>
        <span></span>
        <label class="field"><span>🏢 رسوم الشركات والمؤسسات (ر.س سنويًا)</span>${input('price_company', p.price_company, 'type="number" min="0" required dir="ltr"')}</label>
        <label class="field"><span>🏠 رسوم الأعمال الحرة والأسر المنتجة (ر.س سنويًا)</span>${input('price_freelance', p.price_freelance, 'type="number" min="0" required dir="ltr"')}</label>
        <label class="field"><span>مهلة السداد للشركات (أيام)</span>${input('grace_days_company', p.grace_days_company, 'type="number" min="0" required dir="ltr"')}</label>
        <label class="field"><span>مهلة السداد للأعمال الحرة (أيام)</span>${input('grace_days_freelance', p.grace_days_freelance, 'type="number" min="0" required dir="ltr"')}</label>
      </div>
      <p class="hint">30 يوم = شهر · 120 يوم = 4 شهور. الاشتراك يبدأ من يوم التسجيل، ولمن سجّل خلال فترة الافتتاح من نهايتها.</p>
    </article>

    <article class="panel">
      <h2>🏦 بيانات الحوالة البنكية <small class="private">🔒 خاصة، لا تظهر في الموقع</small></h2>
      <div class="settings-grid">
        <label class="field"><span>اسم البنك</span>${input('bank_name', a.bank.bank_name, 'placeholder="مثال: مصرف الراجحي"')}</label>
        <label class="field"><span>اسم المستفيد</span>${input('account_name', a.bank.account_name)}</label>
        <label class="field full"><span>رقم الآيبان (IBAN)</span>${input('iban', a.bank.iban, 'dir="ltr" placeholder="SA00 0000 0000 0000 0000 0000"')}</label>
      </div>
    </article>

    <article class="panel">
      <h2>✉️ قالب إيميل السداد والتذكير</h2>
      <label class="field"><span>العنوان</span>${input('email_subject', a.email.subject)}</label>
      <label class="field"><span>النص</span><textarea name="email_body" rows="12">${escapeHtml(a.email.body)}</textarea></label>
      <p class="hint">المتغيرات: <code>{store}</code> <code>{owner}</code> <code>{amount}</code> <code>{due_date}</code> <code>{grace_end}</code> <code>{days_left}</code> <code>{bank_name}</code> <code>{account_name}</code> <code>{iban}</code></p>
      <button type="button" class="btn btn-ghost btn-sm" id="resetEmailTpl">↺ استرجاع القالب الافتراضي</button>
    </article>

    <article class="panel">
      <h2>📝 نموذج التسجيل</h2>
      <label class="field"><span>العنوان الرئيسي</span>${input('form_title', fm.title, 'maxlength="80"')}</label>
      <label class="field"><span>الوصف تحت العنوان</span><textarea name="form_subtitle" rows="2" maxlength="300">${escapeHtml(fm.subtitle)}</textarea></label>
      <label class="field"><span>شارة العرض <small>(اتركها فارغة ليظهر نص تلقائي حسب فترة الافتتاح)</small></span>${input('form_badge', fm.badge, 'maxlength="80" placeholder="تلقائي"')}</label>
      <label class="field"><span>نص الإقرار قبل الإرسال</span><textarea name="form_terms" rows="2" maxlength="400">${escapeHtml(fm.terms)}</textarea></label>
      <label class="field"><span>رسالة النجاح بعد الإرسال</span><textarea name="form_success" rows="2" maxlength="300">${escapeHtml(fm.success)}</textarea></label>
      <h3 class="sub-title">الحقول الاختيارية</h3>
      <table class="fields-table">
        <thead><tr><th>الحقل</th><th>يظهر</th><th>مطلوب</th></tr></thead>
        <tbody>${Object.entries(FIELD_LABELS).map(([k, label]) => `
          <tr><td>${label}</td>
            <td><input type="checkbox" name="show_${k}"${fm.fields[k]?.visible !== false ? ' checked' : ''} aria-label="${label} يظهر"></td>
            <td><input type="checkbox" name="req_${k}"${fm.fields[k]?.required ? ' checked' : ''} aria-label="${label} مطلوب"></td></tr>`).join('')}
        </tbody>
      </table>
    </article>

    <article class="panel">
      <h2>🏷️ التصنيفات</h2>
      <div class="cat-list" id="catList">${fm.categories.map(categoryRow).join('')}</div>
      <button type="button" class="btn btn-ghost btn-sm" id="addCat">+ إضافة تصنيف</button>
      <p class="hint">تغيير اسم تصنيف أو حذفه لا يغيّر المتاجر المسجلة به سابقًا.</p>
    </article>

    <article class="panel">
      <h2>🔻 تذييل الموقع وإخلاء المسؤولية</h2>
      <label class="field"><span>نبذة عن المنصة</span><textarea name="footer_about" rows="4" maxlength="600">${escapeHtml(ft.about)}</textarea></label>
      <label class="field"><span>بيان إخلاء المسؤولية <small>(يظهر في نموذج التسجيل وفي التذييل)</small></span><textarea name="legal_disclaimer" rows="3" maxlength="600">${escapeHtml(SETTINGS.legal.disclaimer)}</textarea></label>
      <div class="settings-grid">
        <label class="field"><span>العنوان</span>${input('footer_address', ft.address)}</label>
        <label class="field"><span>البريد الإلكتروني</span>${input('footer_email', ft.email, 'type="email" dir="ltr"')}</label>
        <label class="field"><span>واتساب (بالصيغة الدولية)</span>${input('footer_whatsapp', ft.whatsapp, 'dir="ltr" placeholder="9665xxxxxxxx"')}</label>
      </div>
    </article>

    <div class="save-bar">
      <p class="error" id="settingsError" hidden></p>
      <a class="btn btn-ghost" href="#add" target="_blank">👁️ معاينة النموذج</a>
      <button type="submit" class="btn btn-primary btn-pop" id="saveSettingsBtn">💾 حفظ الإعدادات</button>
    </div>`;
}

$('settingsForm').addEventListener('click', e => {
  if (e.target.closest('#addCat')) {
    $('catList').insertAdjacentHTML('beforeend', categoryRow());
    $('catList').lastElementChild.querySelector('[name="cat_name"]').focus();
  } else if (e.target.closest('[data-remove-cat]')) {
    e.target.closest('.cat-row').remove();
  } else if (e.target.closest('#resetEmailTpl')) {
    const f = $('settingsForm').elements;
    f.email_subject.value = DEFAULT_ADMIN_SETTINGS.email.subject;
    f.email_body.value = DEFAULT_ADMIN_SETTINGS.email.body;
  }
});

$('settingsForm').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target.elements;
  const err = msg => {
    $('settingsError').textContent = msg;
    $('settingsError').hidden = !msg;
  };
  err('');
  const num = name => Number(f[name].value);
  for (const name of ['price_company', 'price_freelance', 'grace_days_company', 'grace_days_freelance']) {
    if (f[name].value === '' || !(num(name) >= 0)) return err('تأكد من الأسعار ومدد السداد (أرقام موجبة).');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.launch_end.value)) return err('اختر تاريخ نهاية فترة الافتتاح.');
  const categories = [...$('catList').querySelectorAll('.cat-row')]
    .map(r => ({ icon: r.querySelector('[name="cat_icon"]').value.trim() || '🛍️', name: r.querySelector('[name="cat_name"]').value.trim() }))
    .filter(c => c.name);
  if (!categories.length) return err('أضف تصنيفًا واحدًا على الأقل.');
  if (new Set(categories.map(c => c.name)).size !== categories.length) return err('فيه تصنيفات مكررة.');
  const whatsapp = f.footer_whatsapp.value.replace(/\D/g, '');

  const publicSettings = {
    pricing: {
      launch_end: f.launch_end.value,
      price_company: num('price_company'),
      price_freelance: num('price_freelance'),
      grace_days_company: num('grace_days_company'),
      grace_days_freelance: num('grace_days_freelance'),
    },
    form: {
      title: f.form_title.value.trim() || DEFAULT_SETTINGS.form.title,
      subtitle: f.form_subtitle.value.trim(),
      badge: f.form_badge.value.trim(),
      terms: f.form_terms.value.trim() || DEFAULT_SETTINGS.form.terms,
      success: f.form_success.value.trim() || DEFAULT_SETTINGS.form.success,
      fields: Object.fromEntries(Object.keys(FIELD_LABELS).map(k => [k, {
        visible: f[`show_${k}`].checked,
        required: f[`show_${k}`].checked && f[`req_${k}`].checked,
      }])),
      categories,
    },
    legal: {
      disclaimer: f.legal_disclaimer.value.trim() || DEFAULT_SETTINGS.legal.disclaimer,
    },
    footer: {
      about: f.footer_about.value.trim(),
      address: f.footer_address.value.trim(),
      email: f.footer_email.value.trim(),
      whatsapp,
    },
  };
  const adminSettings = {
    bank: { bank_name: f.bank_name.value.trim(), account_name: f.account_name.value.trim(), iban: f.iban.value.replace(/\s+/g, ' ').trim() },
    email: { subject: f.email_subject.value.trim(), body: f.email_body.value },
  };

  const btn = $('saveSettingsBtn');
  btn.disabled = true;
  try {
    await Promise.all([backend.saveSettings(publicSettings), backend.saveAdminSettings(adminSettings)]);
    applySettings(publicSettings);
    state.adminSettings = deepMerge(structuredClone(DEFAULT_ADMIN_SETTINGS), adminSettings);
    renderFooters();
    fillCategoryFilter();
    renderSettings();
    renderAll();
    toast('💾 تم حفظ الإعدادات، وتظهر للزوار مباشرة');
  } catch (error) {
    err(`تعذر الحفظ: ${error.message}`);
  } finally {
    btn.disabled = false;
  }
});

// ---------- تصدير ----------

function csvCell(v) {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // منع تنفيذ الصيغ في Excel
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

$('exportBtn').addEventListener('click', () => {
  const bill = s => (billable(s) ? billingInfo(s) : null);
  const cols = [
    ['اسم المتجر', s => s.name], ['الرابط', s => s.url], ['المجال الرئيسي', s => s.category], ['كل المجالات', s => storeCategories(s).join(' / ')],
    ['نوع النشاط', s => ENTITY_TYPES[s.entity_type]?.label],
    ['المنطقة', s => s.region], ['المدينة', s => s.city], ['الحي', s => s.district],
    ['عدد المواقع', s => storeLocations(s).length], ['تقريبي', s => (s.approximate ? 'نعم' : 'لا')],
    ['خط العرض', s => s.lat], ['خط الطول', s => s.lng],
    ['كل المواقع', s => storeLocations(s).map(l => `${l.city}${l.district ? ` - ${l.district}` : ''} (${l.lat}, ${l.lng})`).join(' | ')],
    ['التوصيل', s => (s.delivery || []).map(d => DELIVERY[d]).join(' / ')],
    ['انستقرام', s => s.instagram], ['إكس', s => s.x_handle], ['تيك توك', s => s.tiktok], ['سناب شات', s => s.snapchat], ['واتساب المتجر', s => localPhone(s.whatsapp)],
    ['اسم المسجل', s => s.owner?.owner_name], ['صفة المسجل', s => REGISTRANT_ROLES[s.owner?.registrant_role]],
    ['المسمى الوظيفي', s => s.owner?.registrant_title], ['جوال المسجل', s => localPhone(s.owner?.phone)],
    ['إيميل المسجل', s => s.owner?.email], ['السجل / الوثيقة', s => s.owner?.cr_number],
    ['الحالة', s => STATUS[s.status]?.label],
    ['الرسوم السنوية', s => bill(s)?.fee], ['حالة الاشتراك', s => (bill(s) ? BILLING_LABELS[bill(s).key].label : '')],
    ['تاريخ الاستحقاق', s => bill(s)?.due], ['آخر موعد للسداد', s => bill(s)?.graceEnd], ['مدفوع حتى', s => s.paid_until],
    ['النقرات', s => state.clicks.get(s.id) || 0],
    ['ملاحظة المشرف', s => s.admin_note], ['تاريخ التسجيل', s => new Date(s.created_at).toLocaleString('en-GB')],
  ];
  const rows = filteredStores();
  const csv = [cols.map(c => c[0]), ...rows.map(s => cols.map(c => c[1](s)))]
    .map(r => r.map(csvCell).join(',')).join('\r\n');
  const blob = new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `dukkan-stores-${dayKey()}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast(`⬇️ تم تصدير ${formatNumber(rows.length)} متجر`);
});

// ---------- التنقل ----------

const TABS = { '#admin/stores': 'stores', '#admin/settings': 'settings' };

function route() {
  if (!location.hash.startsWith('#admin')) return;
  const tab = TABS[location.hash] || 'overview';
  document.querySelectorAll('.view').forEach(v => { v.hidden = v.dataset.tab !== tab; });
  document.querySelectorAll('.tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === tab);
    t.setAttribute('aria-selected', String(t.dataset.tab === tab));
  });
}
window.addEventListener('hashchange', route);

// ---------- البداية ----------

(async () => {
  const session = await backend.session();
  if (session) enter(session);
  else showLogin();
})();

// عند الرجوع للوحة من قسم آخر نحدّث البيانات
let shown = false;
export function onShow() {
  if (!shown) {
    shown = true;
    return;
  }
  route();
  if (!$('appView').hidden) loadAll();
}

