import { REGIONS, CATEGORIES, CATEGORY_ICONS, DELIVERY, DELIVERY_ICONS, LOCATION_TYPES } from './constants.js';
import { createBackend } from './admin-data.js';
import { createMap, pinIcon } from './map.js';
import { columnChart, barList, formatNumber, formatCompact } from './charts.js';
import { escapeHtml, safeUrl, dayKey } from './utils.js';

const $ = id => document.getElementById(id);
const backend = createBackend();

const STATUS = {
  pending: { label: 'قيد المراجعة', icon: '⏳' },
  approved: { label: 'معتمد', icon: '✓' },
  rejected: { label: 'مرفوض', icon: '✕' },
};
const DATE = new Intl.DateTimeFormat('ar-u-ca-gregory-nu-latn', { day: 'numeric', month: 'short', year: 'numeric' });
const DATETIME = new Intl.DateTimeFormat('ar-u-ca-gregory-nu-latn', { dateStyle: 'full', timeStyle: 'short' });
const RELATIVE = new Intl.RelativeTimeFormat('ar-u-nu-latn', { numeric: 'auto' });

const state = {
  stores: [],
  stats: null,
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
  toast.timer = setTimeout(() => { el.hidden = true; }, 3200);
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
    const [stores, stats] = await Promise.all([backend.stores(), backend.eventStats(state.range * 2)]);
    state.stores = stores;
    setStats(stats);
    renderAll();
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
  const pending = state.stores.filter(s => s.status === 'pending').length;
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
  const signups = state.stores.filter(s => inRange(s.created_at, state.range)).length;
  const prevSignups = state.stores.filter(s => inRange(s.created_at, state.range, state.range)).length;
  const visits = sum(current, 'visits');
  const clicks = sum(current, 'clicks');
  const cities = new Set(approved.map(s => s.city)).size;

  const tiles = [
    { label: 'بانتظار المراجعة', value: pending, sub: pending ? 'اضغط للمراجعة ←' : 'كل الطلبات مراجعة 👌', accent: pending > 0, href: '#admin/stores', status: 'pending' },
    { label: 'متاجر معتمدة', value: approved.length, sub: `في ${formatNumber(cities)} مدينة` },
    { label: 'زيارات الموقع', value: visits, sub: delta(visits, sum(previous, 'visits')) },
    { label: 'نقرات على المتاجر', value: clicks, sub: delta(clicks, sum(previous, 'clicks')) },
    { label: 'تسجيلات جديدة', value: signups, sub: delta(signups, prevSignups) },
    { label: 'نسبة النقر', value: visits ? `${Math.round((clicks / visits) * 100)}%` : '—', sub: 'من الزيارات فتحت متجرًا' },
  ];
  $('tiles').innerHTML = tiles.map(t => `
    <${t.href ? `a href="${t.href}" data-status="${t.status}"` : 'div'} class="tile${t.accent ? ' tile-accent' : ''}">
      <span class="tile-label">${t.label}</span>
      <strong class="tile-value">${typeof t.value === 'number' ? formatCompact(t.value) : t.value}</strong>
      <span class="tile-sub">${t.sub}</span>
    </${t.href ? 'a' : 'div'}>`).join('');

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
  barList($('byCategory'), count('category').map(([label, value]) => ({ label, value, icon: CATEGORY_ICONS[label] })));
}

document.querySelectorAll('input[name="range"]').forEach(r => r.addEventListener('change', () => {
  state.range = Number(r.value);
  loadStats();
}));

$('tiles').addEventListener('click', e => {
  const tile = e.target.closest('a[data-status]');
  if (tile) setStatusFilter(tile.dataset.status);
});

// ---------- جدول المتاجر ----------

for (const r of REGIONS) $('tableRegion').add(new Option(r.name, r.name));
for (const c of CATEGORIES) $('tableCategory').add(new Option(`${CATEGORY_ICONS[c]} ${c}`, c));

function setStatusFilter(status) {
  state.status = status;
  renderTable();
}

function filteredStores() {
  const q = $('tableSearch').value.trim().toLowerCase();
  const region = $('tableRegion').value;
  const category = $('tableCategory').value;
  const rows = state.stores.filter(s =>
    (state.status === 'all' || s.status === state.status)
    && (!region || s.region === region)
    && (!category || s.category === category)
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
  $('statusTabs').innerHTML = [['all', 'الكل'], ['pending', 'قيد المراجعة'], ['approved', 'معتمد'], ['rejected', 'مرفوض']]
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
    const host = (() => { try { return new URL(s.url).host.replace(/^www\./, ''); } catch { return s.url; } })();
    const phone = s.owner?.phone;
    return `
      <tr data-id="${escapeHtml(s.id)}" tabindex="0">
        <td>
          <div class="cell-store">
            <span class="mini-avatar">${escapeHtml([...s.name.trim()][0] || '؟')}</span>
            <span><strong>${escapeHtml(s.name)}</strong><small dir="ltr">${escapeHtml(host)}</small></span>
          </div>
        </td>
        <td class="nowrap">${CATEGORY_ICONS[s.category] || ''} ${escapeHtml(s.category)}</td>
        <td class="nowrap"><span>${escapeHtml(s.city)}${s.district ? ` · ${escapeHtml(s.district)}` : ''}</span><small>${s.location_type === 'warehouse' ? '📦 مخزون' : '🏪 متجر'}</small></td>
        <td class="nowrap"><span>${escapeHtml(s.owner?.owner_name || '—')}</span>${phone ? `<small><a href="https://wa.me/${escapeHtml(phone)}" target="_blank" rel="noopener" title="واتساب" dir="ltr">${escapeHtml(localPhone(phone))}</a></small>` : ''}</td>
        <td class="num">${formatNumber(state.clicks.get(s.id) || 0)}</td>
        <td class="nowrap" title="${escapeHtml(DATETIME.format(new Date(s.created_at)))}">${relative(s.created_at)}</td>
        <td>${statusPill(s.status)}</td>
        <td class="nowrap row-actions">
          ${s.status === 'pending'
            ? `<button type="button" class="mini-btn approve" data-action="approve" title="اعتماد">✓</button><button type="button" class="mini-btn reject" data-action="reject" title="رفض">✕</button>`
            : '<span class="open-hint">تفاصيل ←</span>'}
        </td>
      </tr>`;
  }).join('');

  $('tableEmpty').hidden = rows.length > 0;
  $('tableEmpty').innerHTML = state.stores.length
    ? '<span class="big">🔍</span><strong>لا توجد متاجر تطابق البحث</strong>'
    : '<span class="big">🛍️</span><strong>لم يسجل أي متجر بعد</strong><span>شارك رابط «أضف متجرك» مع أصحاب المتاجر.</span>';
}

$('statusTabs').addEventListener('click', e => {
  const tab = e.target.closest('[data-status]');
  if (tab) setStatusFilter(tab.dataset.status);
});
['tableSearch', 'tableRegion', 'tableCategory'].forEach(id =>
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

// ---------- الإجراءات ----------

async function act(id, action) {
  const store = state.stores.find(s => s.id === id);
  if (!store) return;
  try {
    if (action === 'delete') {
      if (!confirm(`حذف «${store.name}» نهائيًا مع بيانات صاحبه؟ لا يمكن التراجع.`)) return;
      await backend.remove(id);
      state.stores = state.stores.filter(s => s.id !== id);
      closeDrawer();
      toast('🗑️ تم حذف المتجر');
    } else if (action === 'note') {
      const note = $('adminNote').value.trim() || null;
      await backend.update(id, { admin_note: note });
      store.admin_note = note;
      toast('💾 تم حفظ الملاحظة');
    } else {
      const status = { approve: 'approved', reject: 'rejected', pending: 'pending' }[action];
      const patch = { status };
      if (status === 'approved') patch.approved_at = new Date().toISOString();
      await backend.update(id, patch);
      Object.assign(store, patch);
      toast({ approved: '🎉 تم اعتماد المتجر وصار يظهر في الموقع', rejected: 'تم رفض المتجر', pending: 'رجع المتجر لقائمة المراجعة' }[status]);
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
    s.whatsapp && ['واتساب المتجر', `https://wa.me/${encodeURIComponent(s.whatsapp)}`, localPhone(s.whatsapp)],
  ].filter(Boolean);

  $('drawer').innerHTML = `
    <header class="drawer-head">
      <button type="button" class="close" data-close aria-label="إغلاق">✕</button>
      <div class="drawer-title">
        <span class="mini-avatar big">${logo ? `<img src="${escapeHtml(logo)}" alt="" referrerpolicy="no-referrer">` : escapeHtml([...s.name.trim()][0] || '؟')}</span>
        <div>
          <h2>${escapeHtml(s.name)}</h2>
          ${url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener" dir="ltr">${escapeHtml(s.url)} ↗</a>` : ''}
        </div>
      </div>
      <div class="drawer-status">${statusPill(s.status)} <span class="muted">سُجّل ${relative(s.created_at)}</span></div>
    </header>

    <div class="drawer-actions">
      ${s.status !== 'approved' ? '<button type="button" class="btn btn-primary btn-sm" data-action="approve">✓ اعتماد ونشر</button>' : ''}
      ${s.status !== 'rejected' ? '<button type="button" class="btn btn-ghost btn-sm" data-action="reject">✕ رفض</button>' : ''}
      ${s.status !== 'pending' ? '<button type="button" class="btn btn-ghost btn-sm" data-action="pending">⏳ إرجاع للمراجعة</button>' : ''}
    </div>

    <section class="drawer-section">
      <h3>👤 صاحب المتجر <small>خاص</small></h3>
      <dl>
        ${infoRow('الاسم', escapeHtml(o.owner_name || '—'))}
        ${infoRow('الجوال', o.phone ? `<span dir="ltr">${escapeHtml(localPhone(o.phone))}</span> · <a href="https://wa.me/${escapeHtml(o.phone)}" target="_blank" rel="noopener">واتساب</a> · <a href="tel:+${escapeHtml(o.phone)}">اتصال</a>` : '')}
        ${infoRow('الإيميل', o.email ? `<a href="mailto:${escapeHtml(o.email)}" dir="ltr">${escapeHtml(o.email)}</a>` : '')}
        ${infoRow('السجل / الوثيقة', o.cr_number ? `<span dir="ltr">${escapeHtml(o.cr_number)}</span>` : 'لم يُدخل')}
      </dl>
    </section>

    <section class="drawer-section">
      <h3>🏪 بيانات المتجر</h3>
      <dl>
        ${infoRow('التصنيف', `${CATEGORY_ICONS[s.category] || ''} ${escapeHtml(s.category)}`)}
        ${infoRow('النبذة', escapeHtml(s.description || ''))}
        ${infoRow('التوصيل', (s.delivery || []).map(d => `${DELIVERY_ICONS[d]} ${DELIVERY[d]}`).join('، '))}
        ${infoRow('التواصل', socials.map(([label, href, text]) => `<a href="${escapeHtml(href)}" target="_blank" rel="noopener">${label}: <span dir="ltr">${escapeHtml(text)}</span></a>`).join('<br>'))}
        ${infoRow('النقرات', `${formatNumber(state.clicks.get(s.id) || 0)} خلال آخر ${state.range} يوم`)}
      </dl>
    </section>

    <section class="drawer-section">
      <h3>📍 الموقع</h3>
      <dl>
        ${infoRow('النوع', `${LOCATION_TYPES[s.location_type] || ''}${s.approximate ? ' (تقريبي)' : ''}`)}
        ${infoRow('العنوان', `${escapeHtml(s.region)} · ${escapeHtml(s.city)}${s.district ? ` · ${escapeHtml(s.district)}` : ''}`)}
      </dl>
      <div class="drawer-map" id="drawerMap"></div>
      <a class="map-link" href="https://www.google.com/maps?q=${s.lat},${s.lng}" target="_blank" rel="noopener">فتح في خرائط قوقل ↗</a>
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

  $('drawerBackdrop').hidden = false;
  $('drawer').classList.add('open');
  $('drawer').setAttribute('aria-hidden', 'false');
  $('drawer').focus();

  drawerMap?.remove();
  drawerMap = createMap('drawerMap');
  drawerMap.setView([s.lat, s.lng], s.approximate ? 13 : 15);
  L.marker([s.lat, s.lng], { icon: pinIcon(s.location_type, CATEGORY_ICONS[s.category]) }).addTo(drawerMap);
  if (s.approximate) L.circle([s.lat, s.lng], { radius: 800, color: '#ff5a3c', weight: 1 }).addTo(drawerMap);
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
  const action = e.target.closest('[data-action]')?.dataset.action;
  if (action && state.openId) act(state.openId, action);
});
$('drawerBackdrop').addEventListener('click', closeDrawer);
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && state.openId) closeDrawer();
});

// ---------- تصدير ----------

function csvCell(v) {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // منع تنفيذ الصيغ في Excel
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

$('exportBtn').addEventListener('click', () => {
  const cols = [
    ['اسم المتجر', s => s.name], ['الرابط', s => s.url], ['التصنيف', s => s.category],
    ['المنطقة', s => s.region], ['المدينة', s => s.city], ['الحي', s => s.district],
    ['نوع الموقع', s => LOCATION_TYPES[s.location_type]], ['تقريبي', s => (s.approximate ? 'نعم' : 'لا')],
    ['خط العرض', s => s.lat], ['خط الطول', s => s.lng],
    ['التوصيل', s => (s.delivery || []).map(d => DELIVERY[d]).join(' / ')],
    ['انستقرام', s => s.instagram], ['إكس', s => s.x_handle], ['تيك توك', s => s.tiktok], ['واتساب المتجر', s => localPhone(s.whatsapp)],
    ['اسم المالك', s => s.owner?.owner_name], ['جوال المالك', s => localPhone(s.owner?.phone)], ['إيميل المالك', s => s.owner?.email],
    ['السجل التجاري', s => s.owner?.cr_number], ['الحالة', s => STATUS[s.status]?.label], ['النقرات', s => state.clicks.get(s.id) || 0],
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

function route() {
  if (!location.hash.startsWith('#admin')) return;
  const tab = location.hash === '#admin/stores' ? 'stores' : 'overview';
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
