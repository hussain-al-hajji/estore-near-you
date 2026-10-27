import { CONFIG } from './config.js';
import { storage, dayKey } from './utils.js';

const LIVE = Boolean(CONFIG.supabaseUrl && CONFIG.supabaseAnonKey);
const DEMO = {
  submissions: 'dukkan.demoSubmissions',
  owners: 'dukkan.demoOwners',
  admin: 'dukkan.demoAdmin',
  events: 'dukkan.demoEvents',
  settings: 'dukkan.demoSettings',
  adminSettings: 'dukkan.demoAdminSettings',
  payments: 'dukkan.demoPayments',
};

export const isDemo = !LIVE;
export const DEMO_KEYS = DEMO;

const PUBLIC_COLUMNS = [
  'id', 'name', 'url', 'category', 'description', 'logo_url', 'instagram', 'x_handle', 'tiktok',
  'whatsapp', 'delivery', 'region', 'city', 'district', 'lat', 'lng', 'approximate',
  'entity_type', 'snapchat', 'store_locations(lat,lng,region,city,district,position)',
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

export async function fetchStores() {
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

export async function submitStore(payload) {
  if (LIVE) {
    const res = await fetch(`${CONFIG.supabaseUrl}/rest/v1/rpc/submit_store`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ payload }),
    });
    if (!res.ok) {
      let message = `تعذر إرسال الطلب (${res.status})`;
      try { message = (await res.json()).message || message; } catch { /* نبقي الرسالة العامة */ }
      throw new Error(message);
    }
    return res.json();
  }
  const { owner_name, phone, email, cr_number, registrant_role, registrant_title, ...publicFields } = payload;
  const id = `demo-${Date.now()}`;
  const { locations = [], ...rest } = publicFields;
  const round = v => (rest.approximate ? Math.round(v * 100) / 100 : v);
  const storeLocations = locations.map((l, position) => ({ ...l, lat: round(l.lat), lng: round(l.lng), position }));
  const [main] = storeLocations;
  const record = {
    id, ...rest, created_at: new Date().toISOString(),
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
