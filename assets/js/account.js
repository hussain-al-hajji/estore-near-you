// صفحة «متجري»: دخول صاحب المتجر، أداء متجره، طلبات التعديل، واشتراكه
import { CATEGORY_ICONS, ENTITY_TYPES, graceLabel } from './settings.js';
import { createOwnerBackend } from './owner-data.js';
import { columnChart, barList, formatNumber, formatCompact } from './charts.js';
import { billingInfo, BILLING_LABELS, formatDate } from './billing.js';
import { escapeHtml, storage, storeCategories } from './utils.js';

const $ = id => document.getElementById(id);
const backend = await createOwnerBackend();
const DATE = new Intl.DateTimeFormat('ar-u-ca-gregory-nu-latn', { day: 'numeric', month: 'short', year: 'numeric' });
const STATUS_TEXT = {
  pending: { icon: '⏳', title: 'متجرك قيد المراجعة', text: 'بنراجع بيانات متجرك، ويتفعّل حسابك بالكامل بعد الاعتماد. بعدها تشوف هنا أداء متجرك وتقدر تعدّل بياناته.' },
  approved: { icon: '✅', title: 'متجرك ظاهر على المنصة', text: '' },
  suspended: { icon: '⏸', title: 'ظهور متجرك موقوف حاليًا', text: 'غالبًا بسبب الاشتراك. سدّد الاشتراك أو تواصل معنا، ويرجع متجرك للظهور.' },
  rejected: { icon: '❌', title: 'ما اعتُمد متجرك', text: 'تواصل معنا لمعرفة السبب وتعديل البيانات.' },
};

const state = { items: [], current: null, range: 30 };

// ---- الدخول ----

function show(view) {
  for (const id of ['ownerLogin', 'ownerReset', 'ownerApp']) $(id).hidden = id !== view;
}

function loginMessage(error = '', ok = '') {
  $('ownerLoginError').textContent = error;
  $('ownerLoginError').hidden = !error;
  $('ownerLoginOk').textContent = ok;
  $('ownerLoginOk').hidden = !ok;
}

function showLogin(error = '') {
  show('ownerLogin');
  loginMessage(error);
  $('ownerDemo').hidden = !backend.demo;
  if (backend.demo) $('ownerLoginBtn').textContent = 'دخول (أو اتركها فارغة للدخول التجريبي)';
}

$('ownerLogin').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target.elements;
  const email = f.email.value.trim();
  if (!backend.demo && (!email || !f.password.value)) return loginMessage('اكتب الإيميل وكلمة المرور.');
  $('ownerLoginBtn').disabled = true;
  try {
    await backend.signIn(email, f.password.value);
    f.password.value = '';
    await enter();
  } catch (err) {
    loginMessage(err.message);
  } finally {
    $('ownerLoginBtn').disabled = false;
  }
});

$('forgotBtn').addEventListener('click', async () => {
  const email = $('ownerLogin').elements.email.value.trim();
  if (!email) return loginMessage('اكتب إيميلك أولًا، وبعدها اضغط «نسيت كلمة المرور؟».');
  try {
    await backend.resetPassword(email);
    loginMessage('', '📧 أرسلنا لك رابط تعيين كلمة مرور جديدة على إيميلك. افتحه من نفس الجهاز أو أي جهاز.');
  } catch (err) {
    loginMessage(err.message);
  }
});

const STRONG = p => p.length >= 8 && /[A-Z]/.test(p) && /[a-z]/.test(p) && /\d/.test(p) && /[^A-Za-z0-9\s]/.test(p);

$('ownerReset').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target.elements;
  const err = msg => {
    $('ownerResetError').textContent = msg;
    $('ownerResetError').hidden = !msg;
  };
  if (!STRONG(f.password.value)) return err('كلمة المرور لازم تكون 8 أحرف على الأقل، فيها حرف إنجليزي كبير وصغير ورقم ورمز.');
  if (f.password.value !== f.password2.value) return err('التأكيد ما يطابق كلمة المرور.');
  try {
    await backend.updatePassword(f.password.value);
    window.dukkanRecovery = false;
    history.replaceState(null, '', '#account');
    await enter();
  } catch (error) {
    err(error.message);
  }
});

$('ownerLogout').addEventListener('click', async () => {
  await backend.signOut();
  showLogin();
});

// ---- البيانات ----

async function enter() {
  const session = await backend.session();
  if (!session) return showLogin();
  if (window.dukkanRecovery) return show('ownerReset');
  show('ownerApp');
  $('ownerEmail').textContent = session.email;
  try {
    state.items = await backend.dashboard();
  } catch (err) {
    $('ownerStore').innerHTML = `<div class="panel"><p class="error">تعذر تحميل بيانات متجرك: ${escapeHtml(err.message)}</p></div>`;
    return;
  }
  const select = $('ownerStoreSelect');
  select.hidden = state.items.length < 2;
  select.innerHTML = state.items.map(x => `<option value="${escapeHtml(x.store.id)}">${escapeHtml(x.store.name)}</option>`).join('');
  const saved = storage('dukkan.ownerStore');
  state.current = state.items.find(x => x.store.id === saved)?.store.id || state.items[0]?.store.id || null;
  if (state.current) select.value = state.current;
  render();
}

$('ownerStoreSelect').addEventListener('change', e => {
  state.current = e.target.value;
  storage('dukkan.ownerStore', state.current);
  render();
});

function currentItem() {
  return state.items.find(x => x.store.id === state.current);
}

// ---- العرض ----

function editStatus(edit) {
  if (!edit) return '';
  if (edit.status === 'pending') {
    return `<p class="edit-state pending">⏳ طلب تعديل قيد المراجعة منذ ${escapeHtml(DATE.format(new Date(edit.created_at)))}</p>`;
  }
  if (edit.status === 'rejected') {
    return `<p class="edit-state rejected">❌ آخر طلب تعديل ما اعتُمد${edit.admin_note ? `: ${escapeHtml(edit.admin_note)}` : ''}</p>`;
  }
  return `<p class="edit-state approved">✅ آخر تعديل اعتُمد${edit.reviewed_at ? ` في ${escapeHtml(DATE.format(new Date(edit.reviewed_at)))}` : ''}</p>`;
}

function render() {
  const item = currentItem();
  if (!item) {
    $('ownerStore').innerHTML = `<div class="panel owner-empty">
      <span class="big">🛍️</span><strong>ما فيه متجر مرتبط بحسابك</strong>
      <span>سجّل متجرك وأنت داخل بهذا الحساب، ويرتبط فيه تلقائيًا.</span>
      <a class="btn btn-primary btn-pop" href="#add">+ سجّل متجرك</a></div>`;
    return;
  }
  const { store: s, locations, edit, payments } = item;
  const st = STATUS_TEXT[s.status] || STATUS_TEXT.pending;
  const active = s.status === 'approved' || s.status === 'suspended';
  const entity = ENTITY_TYPES[s.entity_type];

  let html = `
    <div class="owner-status status-${s.status}">
      <span class="owner-status-icon">${st.icon}</span>
      <div><strong>${escapeHtml(s.name)} · ${st.title}</strong>${st.text ? `<p>${st.text}</p>` : ''}</div>
    </div>`;

  if (active) {
    const info = billingInfo(s);
    const locs = (locations?.length ? locations : [s]).map(l => `${escapeHtml(l.city)}${l.district ? ` · ${escapeHtml(l.district)}` : ''}`);
    html += `
      <article class="panel">
        <div class="panel-head">
          <h2>📈 أداء متجرك</h2>
          <div class="segmented range" role="radiogroup" aria-label="الفترة">
            ${[7, 30, 90].map(d => `<label><input type="radio" name="ownerRange" value="${d}"${state.range === d ? ' checked' : ''}><span>${d === 7 ? '7 أيام' : `${d} يوم`}</span></label>`).join('')}
          </div>
        </div>
        <div class="tiles owner-tiles" id="ownerTiles"><p class="muted">جارٍ التحميل…</p></div>
        <h3 class="sub-title">ظهور متجرك في نتائج البحث يوميًا</h3>
        <div class="chart" id="ownerChart"></div>
        <div class="owner-bars">
          <div><h3 class="sub-title">🔎 الكلمات اللي ظهر فيها متجرك</h3><div class="bars" id="ownerTerms"></div></div>
          <div><h3 class="sub-title">📍 مدن الباحثين</h3><div class="bars" id="ownerCities"></div></div>
        </div>
        <p class="hint">الأرقام تُحسب من داخل المنصة بدون أي بيانات شخصية عن الزوار. «الظهور» = مرة ظهر فيها متجرك في قائمة النتائج.</p>
      </article>

      <article class="panel">
        <div class="panel-head">
          <h2>🏪 بيانات متجرك</h2>
          <a class="btn btn-primary btn-sm" href="#edit" data-edit="${escapeHtml(s.id)}">✏️ تعديل البيانات</a>
        </div>
        ${editStatus(edit)}
        <dl class="owner-info">
          <div><dt>المجالات</dt><dd>${storeCategories(s).map(c => `${CATEGORY_ICONS[c] || '🛍️'} ${escapeHtml(c)}`).join('، ')}</dd></div>
          <div><dt>نوع النشاط</dt><dd>${entity ? `${entity.icon} ${entity.label}` : '—'}</dd></div>
          <div><dt>الرابط</dt><dd dir="ltr">${s.url ? escapeHtml(s.url) : '—'}</dd></div>
          <div><dt>${locs.length > 1 ? `المواقع (${locs.length})` : 'الموقع'}</dt><dd>${locs.join('<br>')}</dd></div>
        </dl>
        <p class="hint">أي تعديل يطلع على المنصة بعد مراجعته من فريق دكان الحي.</p>
      </article>

      <article class="panel">
        <h2>💳 اشتراكك السنوي</h2>
        <p><span class="bill bill-${info.key}${info.soon ? ' soon' : ''}">${BILLING_LABELS[info.key].icon} ${BILLING_LABELS[info.key].label} · ${info.short}</span></p>
        <dl class="owner-info">
          <div><dt>الرسوم</dt><dd>${formatNumber(info.fee)} ر.س سنويًا · مهلة السداد ${graceLabel(info.grace)}</dd></div>
          <div><dt>تاريخ الاستحقاق</dt><dd>${formatDate(info.due)}</dd></div>
          <div><dt>آخر موعد للسداد</dt><dd>${formatDate(info.graceEnd)}</dd></div>
        </dl>
        ${payments?.length ? `<h3 class="sub-title">مدفوعاتك</h3><ul class="pay-list">${payments.map(p => `
          <li><strong>${formatNumber(Number(p.amount))} ر.س</strong><span>${escapeHtml(formatDate(p.period_start))} ← ${escapeHtml(formatDate(p.period_end))}</span></li>`).join('')}</ul>` : ''}
        <p class="hint">السداد بحوالة بنكية، ونرسل لك بيانات الحساب على إيميلك قبل موعد الاستحقاق.</p>
      </article>`;
  }
  $('ownerStore').innerHTML = html;
  if (active) loadPerformance(s.id);
}

async function loadPerformance(id) {
  let perf;
  try {
    perf = await backend.performance(id, state.range);
  } catch (err) {
    $('ownerTiles').innerHTML = `<p class="error">تعذر تحميل الإحصائيات: ${escapeHtml(err.message)}</p>`;
    return;
  }
  if (id !== state.current) return;
  const sum = k => perf.daily.reduce((n, d) => n + d[k], 0);
  const impressions = sum('impressions');
  const clicks = sum('clicks');
  $('ownerTiles').innerHTML = [
    ['ظهور في نتائج البحث', formatCompact(impressions), `آخر ${state.range} يوم`],
    ['نقرات على متجرك', formatCompact(clicks), 'فتح الرابط أو الحسابات'],
    ['نسبة النقر', impressions ? `${Math.round((clicks / impressions) * 100)}%` : '—', 'من مرات الظهور'],
  ].map(([label, value, sub]) => `<div class="tile"><span class="tile-label">${label}</span><strong class="tile-value">${value}</strong><span class="tile-sub">${sub}</span></div>`).join('');
  columnChart($('ownerChart'), perf.daily.map(d => ({ day: d.day, value: d.impressions })), { unit: 'ظهور', tooltip: $('ownerTooltip') });
  barList($('ownerTerms'), perf.terms.map(t => ({ label: t.term, value: t.hits })), { empty: 'ما فيه كلمات بحث بعد' });
  barList($('ownerCities'), perf.cities.map(c => ({ label: c.city, value: c.hits })), { empty: 'ما فيه بيانات بعد' });
}

$('ownerStore').addEventListener('change', e => {
  if (e.target.name !== 'ownerRange') return;
  state.range = Number(e.target.value);
  loadPerformance(state.current);
});
$('ownerStore').addEventListener('click', e => {
  const link = e.target.closest('[data-edit]');
  if (!link) return;
  try { sessionStorage.setItem('dukkan.editStore', link.dataset.edit); } catch { /* لا شيء */ }
});

// ---- البداية ----

backend.onRecovery(() => {
  window.dukkanRecovery = true;
  show('ownerReset');
});

export async function onShow() {
  await enter();
}
