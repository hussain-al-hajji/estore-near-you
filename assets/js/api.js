import { CONFIG } from './config.js';
import { storage, dayKey, riyadhDay } from './utils.js';
import { getClient, authErrorMessage } from './supabase-client.js';
import { searchLocal } from './search.js';

const LIVE = Boolean(CONFIG.supabaseUrl && CONFIG.supabaseAnonKey);
const DEMO = {
  submissions: 'dukkan.demoSubmissions',
  owners: 'dukkan.demoOwners',
  admin: 'dukkan.demoAdmin',
  events: 'dukkan.demoEvents',
  settings: 'dukkan.demoSettings',
  adminSettings: 'dukkan.demoAdminSettings',
  payments: 'dukkan.demoPayments',
  edits: 'dukkan.demoEdits',
  accounts: 'dukkan.demoAccounts',
  ownerSession: 'dukkan.demoOwnerSession',
  impressions: 'dukkan.demoImpressions',
  reports: 'dukkan.demoReports',
  banners: 'dukkan.demoBanners',
  pins: 'dukkan.demoPins',
};

export const isDemo = !LIVE;
export const DEMO_KEYS = DEMO;

const PUBLIC_COLUMNS = [
  'id', 'name', 'url', 'category', 'description', 'logo_url', 'instagram', 'x_handle', 'tiktok',
  'whatsapp', 'delivery', 'region', 'city', 'district', 'lat', 'lng', 'approximate',
  'entity_type', 'snapchat', 'store_locations(lat,lng,region,city,district,position)', 'categories',
].join(',');
// أعمدة قاعدة البيانات قبل الترحيل 002، حتى لا يتعطل الموقع إذا لم يُشغَّل الترحيل بعد
const LEGACY_COLUMNS = PUBLIC_COLUMNS.split(',').slice(0, 17).join(',');

function headers() {
  const key = CONFIG.supabaseAnonKey;
  const h = { apikey: key, 'Content-Type': 'application/json' };
  // المفاتيح القديمة (JWT) تُرسل أيضًا في Authorization، والمفاتيح الجديدة sb_publishable_ لا تحتاجها
  if (key.startsWith('eyJ')) h.Authorization = `Bearer ${key}`;
  return h;
}

// ---- الوضع التجريبي: كل البيانات في متصفحك فقط ----

function daysAgo(n, hour = 10) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(hour, (n * 17) % 60, 0, 0);
  return d.toISOString();
}

// كل المتاجر التجريبية بكل حالاتها، مع تعديلات المشرف التجريبية
export async function demoAllStores() {
  const demo = await (await fetch('data/demo-stores.json')).json();
  const admin = storage(DEMO.admin) || {};
  const deleted = new Set(admin.deleted || []);
  const submitted = (storage(DEMO.submissions) || []).map(s => ({ status: 'pending', ...s }));
  const base = demo.map((s, i) => ({ status: 'approved', created_at: daysAgo(i * 4 + 2, 9 + (i % 8)), ...s }));
  return [...submitted, ...base]
    .filter(s => !deleted.has(s.id))
    .map(s => ({
      ...s,
      status: admin.status?.[s.id] || s.status,
      admin_note: admin.notes?.[s.id] ?? null,
      ...(admin.patch?.[s.id] || {}),
    }));
}

export async function fetchSettings() {
  if (LIVE) {
    const res = await fetch(`${CONFIG.supabaseUrl}/rest/v1/site_settings?select=data&id=eq.1`, { headers: headers() });
    if (!res.ok) throw new Error(`تعذر تحميل الإعدادات (${res.status})`);
    return (await res.json())[0]?.data || {};
  }
  return storage(DEMO.settings) || {};
}

// كل المتاجر دفعة وحدة: للوضع التجريبي، أو احتياطًا إذا قاعدة البيانات ما فيها دالة البحث (قبل الترحيل 005)
async function fetchAllStores() {
  if (LIVE) {
    const get = columns => fetch(
      `${CONFIG.supabaseUrl}/rest/v1/stores?select=${columns}&status=eq.approved&order=created_at.desc`,
      { headers: headers() },
    );
    let res = await get(PUBLIC_COLUMNS);
    if (!res.ok) res = await get(LEGACY_COLUMNS);
    if (!res.ok) throw new Error('ما قدرنا نحمّل المتاجر الحين، حدّث الصفحة بعد شوي.');
    return res.json();
  }
  // نعرض الطلبات المعلقة أيضًا (بشارة) حتى تجرب المسار كاملًا
  return (await demoAllStores())
    .filter(s => s.status === 'approved' || s.status === 'pending')
    .map(s => ({ ...s, pending: s.status === 'pending' }));
}

let allStores = null;
let serverSearch = LIVE;

// يُستدعى عند الرجوع لصفحة التصفح حتى تظهر المتاجر المضافة أو المعتمدة حديثًا
export function refreshStores() {
  allStores = null;
}

// البحث: من السيرفر (أقرب 30 متجر في كل صفحة + عدد المتاجر في كل مدينة)
export async function searchStores(params) {
  if (serverSearch) {
    const call = body => fetch(`${CONFIG.supabaseUrl}/rest/v1/rpc/search_stores`, {
      method: 'POST', headers: headers(), body: JSON.stringify(body),
    });
    const base = {
      p_lat: params.lat ?? null, p_lng: params.lng ?? null, p_radius_km: params.radius || null,
      p_region: params.region || null, p_city: params.city || null, p_category: params.category || null,
      p_entity: params.entity || null, p_offset: params.offset || 0,
    };
    let res = await call({
      ...base, p_terms: params.terms || [], p_delivery: params.delivery || null, p_boost: params.boost || [], p_id: params.id || null,
    });
    // قاعدة البيانات قبل الترحيل 007: نرجع للبحث البسيط بالنص
    if (res.status === 404) res = await call({ ...base, p_q: params.q || null });
    if (res.ok) return res.json();
    if (res.status === 429) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.hint === 'day'
        ? 'وصلت للحد اليومي للبحث من جهازك. جرّب مرة ثانية بكرة.'
        : 'بحثت كثير خلال دقيقة 😅 انتظر شوي وجرّب مرة ثانية.');
    }
    if (res.status !== 404) throw new Error('ما قدرنا نحمّل المتاجر الحين، حدّث الصفحة بعد شوي.');
    serverSearch = false;
  }
  allStores ||= fetchAllStores().catch(err => {
    allStores = null;
    throw err;
  });
  return searchLocal(await allStores, params);
}

// بلاغ من زائر عن متجر (معلومات خاطئة، نشاط مغلق...) يروح للوحة التحكم
export async function submitReport({ storeId, reason, details, contact }) {
  if (LIVE) {
    const res = await fetch(`${CONFIG.supabaseUrl}/rest/v1/rpc/submit_report`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ p_store: storeId, p_reason: reason, p_details: details || null, p_contact: contact || null }),
    });
    if (res.ok) return;
    if (res.status === 429) throw new Error('أرسلت بلاغات كثيرة، جرّب بعد شوي.');
    if (res.status === 404) throw new Error('البلاغات تشتغل قريبًا، جرّب لاحقًا.');
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message && /[\u0600-\u06FF]/.test(body.message) ? body.message : 'ما قدرنا نرسل البلاغ، جرّب بعد شوي.');
  }
  const reports = storage(DEMO.reports) || [];
  if (reports.some(r => r.store_id === storeId && r.status === 'open' && r.demo_self)) return;
  reports.push({
    id: Date.now(), store_id: storeId, reason, details: details || null, contact: contact || null,
    status: 'open', created_at: new Date().toISOString(), demo_self: true,
  });
  storage(DEMO.reports, reports);
}

// ---- البنر الإعلاني تحت الخريطة ----
// إعلان تجريبي واحد في أول مرة، حتى ترى شكل البنر
export function demoBannerList() {
  let list = storage(DEMO.banners);
  if (!list) {
    const start = riyadhDay();
    const end = riyadhDay(Date.now() + 90 * 86400000);
    list = [{
      id: 1, title: 'مساحتك الإعلانية هنا', body: 'بنر مدفوع يظهر تحت الخريطة، وتختار له المنطقة والمدة من لوحة التحكم.',
      button_label: 'اعرف أكثر', link_url: 'https://example.com', image_url: null, theme: 'violet', regions: [],
      starts_on: start, ends_on: end, active: true, priority: 1, advertiser: 'مثال', note: null, created_at: new Date().toISOString(),
    }];
    storage(DEMO.banners, list);
  }
  return list;
}

function demoBanners() {
  const today = riyadhDay();
  return demoBannerList().filter(b => b.active !== false && b.starts_on <= today && b.ends_on >= today);
}

// كل الإعلانات المناسبة لمنطقة الزائر (حتى 6 بالتناوب)، ويحسب ظهورها
export async function getBanners(region) {
  if (LIVE) {
    try {
      const res = await fetch(`${CONFIG.supabaseUrl}/rest/v1/rpc/get_banners`, {
        method: 'POST', headers: headers(), body: JSON.stringify({ p_region: region || null, p_count: !LOCAL_HOST }),
      });
      return res.ok ? await res.json() : [];
    } catch { return []; }
  }
  const list = demoBanners().filter(b => !b.regions?.length || b.regions.includes(region))
    .map(b => ({ b, k: Math.random() ** (1 / (b.priority || 1)) })).sort((x, y) => y.k - x.k).slice(0, 6).map(x => x.b);
  const stats = storage(`${DEMO.banners}Stats`) || {};
  for (const b of list) (stats[b.id] ||= { impressions: 0, clicks: 0 }).impressions += 1;
  storage(`${DEMO.banners}Stats`, stats);
  return list;
}

export function bannerClick(id) {
  if (LIVE) {
    if (LOCAL_HOST) return;
    fetch(`${CONFIG.supabaseUrl}/rest/v1/rpc/banner_click`, {
      method: 'POST', headers: headers(), body: JSON.stringify({ p_id: id }), keepalive: true,
    }).catch(() => {});
    return;
  }
  const stats = storage(`${DEMO.banners}Stats`) || {};
  (stats[id] ||= { impressions: 0, clicks: 0 }).clicks += 1;
  storage(`${DEMO.banners}Stats`, stats);
}

// ---- المتاجر المثبّتة في أعلى القائمة (يحددها المشرف بالمنطقة والمدة) ----
export function demoPinList() {
  let list = storage(DEMO.pins);
  if (!list) {
    list = [{
      id: 1, store_id: 'demo-05', regions: [], starts_on: riyadhDay(), ends_on: riyadhDay(Date.now() + 90 * 86400000),
      active: true, priority: 1, advertiser: 'مثال', note: null, created_at: new Date().toISOString(),
    }];
    storage(DEMO.pins, list);
  }
  return list;
}

export async function getPinnedStores(region) {
  if (LIVE) {
    try {
      const res = await fetch(`${CONFIG.supabaseUrl}/rest/v1/rpc/get_pinned_stores`, {
        method: 'POST', headers: headers(), body: JSON.stringify({ p_region: region || null }),
      });
      return res.ok ? await res.json() : [];
    } catch { return []; }
  }
  const today = riyadhDay();
  const ids = new Set(demoPinList()
    .filter(p => p.active !== false && p.starts_on <= today && p.ends_on >= today && (!p.regions?.length || p.regions.includes(region)))
    .map(p => p.store_id));
  return (await demoAllStores()).filter(s => s.status === 'approved' && ids.has(s.id)).slice(0, 10);
}

// يدخل بحساب صاحب المتجر أو ينشئه، حتى يرتبط المتجر بحسابه
async function ensureAccount(sb, account) {
  const { data: current } = await sb.auth.getSession();
  if (current.session) return current.session;
  if (!account) throw new Error('أنشئ حساب الدخول لمتجرك أولًا.');
  let { data, error } = await sb.auth.signUp({ email: account.email, password: account.password });
  if (error && /already registered|already exists/i.test(error.message)) {
    ({ data, error } = await sb.auth.signInWithPassword({ email: account.email, password: account.password }));
    if (error) throw new Error('هذا الإيميل مسجل مسبقًا بكلمة مرور مختلفة. ادخل من «متجري» ثم أضف متجرك، أو استخدم إيميل آخر.');
  }
  if (error) throw new Error(authErrorMessage(error.message));
  if (!data.session) throw new Error('أرسلنا رابط تفعيل على إيميلك. فعّل الحساب، ثم ادخل من «متجري» وأكمل التسجيل.');
  return data.session;
}

export async function submitStore(payload, account = null) {
  if (LIVE) {
    const sb = await getClient();
    await ensureAccount(sb, account);
    const { data, error } = await sb.rpc('submit_store', { payload });
    if (error) throw new Error(error.message || 'تعذر إرسال الطلب');
    return data;
  }
  const { owner_name, phone, email, cr_number, registrant_role, registrant_title, ...publicFields } = payload;
  const id = `demo-${Date.now()}`;
  const { locations = [], ...rest } = publicFields;
  const round = v => (rest.approximate ? Math.round(v * 100) / 100 : v);
  const storeLocations = locations.map((l, position) => ({ ...l, lat: round(l.lat), lng: round(l.lng), position }));
  const [main] = storeLocations;
  // الوضع التجريبي: الحساب يُحفظ في متصفحك فقط
  let ownerEmail = storage(DEMO.ownerSession);
  if (!ownerEmail && account) {
    const accounts = storage(DEMO.accounts) || {};
    if (accounts[account.email] && accounts[account.email] !== account.password) {
      throw new Error('هذا الإيميل مسجل مسبقًا بكلمة مرور مختلفة.');
    }
    storage(DEMO.accounts, { ...accounts, [account.email]: account.password });
    storage(DEMO.ownerSession, account.email);
    ownerEmail = account.email;
  }
  const record = {
    id, ...rest, created_at: new Date().toISOString(), owner_email: ownerEmail,
    lat: main.lat, lng: main.lng, region: main.region, city: main.city, district: main.district,
    store_locations: storeLocations,
  };
  storage(DEMO.submissions, [record, ...(storage(DEMO.submissions) || [])]);
  storage(DEMO.owners, {
    ...(storage(DEMO.owners) || {}),
    [id]: { owner_name, phone, email, cr_number, registrant_role, registrant_title },
  });
  return id;
}

// ---- إحصائيات أداء كل متجر (تجريبي) ----

function seeded(text) {
  let h = 2166136261;
  for (const ch of text) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295;
}

const DEMO_TERMS = ['هدايا', 'قهوة', 'حلويات', 'عطور', 'توصيل', 'قريب مني', 'أسر منتجة', 'ورد'];
const DEMO_CITIES = ['القطيف', 'الدمام', 'الخبر', 'الأحساء', 'الرياض', 'جدة'];

export function demoPerformance(id, days) {
  const local = storage(DEMO.impressions)?.[id] || { days: {}, terms: {}, cities: {} };
  const clicks = storage(DEMO.events)?.stores?.[id] || 0;
  const daily = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const day = dayKey(d);
    const base = Math.round(8 + seeded(`${id}${day}`) * 30);
    const imp = base + (local.days[day] || 0);
    daily.push({ day, impressions: imp, clicks: Math.round(imp * (0.08 + seeded(`${day}${id}c`) * 0.12)) + (i === 0 ? clicks : 0) });
  }
  const scale = days / 30;
  const terms = DEMO_TERMS.map(term => ({ term, hits: Math.round(seeded(`${id}${term}`) * 60 * scale) + (local.terms[term] || 0) }))
    .concat(Object.entries(local.terms).filter(([t]) => !DEMO_TERMS.includes(t)).map(([term, hits]) => ({ term, hits })))
    .filter(t => t.hits > 0).sort((a, b) => b.hits - a.hits).slice(0, 10);
  const cities = DEMO_CITIES.map(city => ({ city, hits: Math.round(seeded(`${id}${city}`) ** 2 * 120 * scale) + (local.cities[city] || 0) }))
    .filter(c => c.hits > 0).sort((a, b) => b.hits - a.hits);
  return { daily, terms, cities };
}

// تطبيق طلب تعديل في الوضع التجريبي (نفس ما تفعله admin_review_edit)
export async function demoApplyEdit(edit) {
  const { owner, locations, ...fields } = edit.data;
  const round = v => (fields.approximate ? Math.round(v * 100) / 100 : v);
  const locs = locations.map((l, position) => ({ ...l, lat: round(l.lat), lng: round(l.lng), position }));
  const patch = {
    ...fields, url: fields.url || null, store_locations: locs,
    lat: locs[0].lat, lng: locs[0].lng, region: locs[0].region, city: locs[0].city, district: locs[0].district,
  };
  const admin = storage(DEMO.admin) || {};
  (admin.patch ||= {})[edit.store_id] = { ...(admin.patch[edit.store_id] || {}), ...patch };
  storage(DEMO.admin, admin);
  if (owner) {
    const owners = storage(DEMO.owners) || {};
    owners[edit.store_id] = { ...(owners[edit.store_id] || {}), ...owner };
    storage(DEMO.owners, owners);
  }
}

// تسجيل زيارة أو نقرة لإحصائيات لوحة التحكم (لا يُرسل أي بيانات شخصية)
// التجربة على جهاز المطوّر لا تُحسب في إحصائيات المنصة الحقيقية
const LOCAL_HOST = location.protocol === 'file:' || /^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(location.hostname);

export function logEvent(type, storeId = null) {
  if (LIVE) {
    if (LOCAL_HOST) return;
    fetch(`${CONFIG.supabaseUrl}/rest/v1/rpc/log_event`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ p_type: type, p_store: storeId }),
      keepalive: true,
    }).catch(() => {});
    return;
  }
  const day = dayKey();
  const events = storage(DEMO.events) || { days: {}, stores: {} };
  events.days[day] = events.days[day] || { visits: 0, clicks: 0 };
  if (type === 'visit') events.days[day].visits += 1;
  if (type === 'store_click') {
    events.days[day].clicks += 1;
    events.stores[storeId] = (events.stores[storeId] || 0) + 1;
  }
  storage(DEMO.events, events);
}

// ظهور المتاجر في نتائج البحث (لإحصائيات أصحاب المتاجر): الكلمة ومدينة الباحث فقط، بدون بيانات شخصية
export function logImpressions(storeIds, term, city) {
  if (!storeIds.length) return;
  if (LIVE) {
    if (LOCAL_HOST) return;
    fetch(`${CONFIG.supabaseUrl}/rest/v1/rpc/log_impressions`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ p_store_ids: storeIds, p_term: term || null, p_city: city || null }),
      keepalive: true,
    }).catch(() => {});
    return;
  }
  const all = storage(DEMO.impressions) || {};
  const day = dayKey();
  for (const id of storeIds) {
    const rec = all[id] ||= { days: {}, terms: {}, cities: {} };
    rec.days[day] = (rec.days[day] || 0) + 1;
    if (term) rec.terms[term] = (rec.terms[term] || 0) + 1;
    if (city) rec.cities[city] = (rec.cities[city] || 0) + 1;
  }
  storage(DEMO.impressions, all);
}
