import { CONFIG } from './config.js';
import { storage } from './utils.js';

const LIVE = Boolean(CONFIG.supabaseUrl && CONFIG.supabaseAnonKey);
const DEMO_KEY = 'dukkan.demoSubmissions';

export const isDemo = !LIVE;

const PUBLIC_COLUMNS = [
  'id', 'name', 'url', 'category', 'description', 'logo_url', 'instagram', 'x_handle', 'tiktok',
  'whatsapp', 'delivery', 'location_type', 'region', 'city', 'district', 'lat', 'lng', 'approximate',
].join(',');

function headers() {
  const key = CONFIG.supabaseAnonKey;
  const h = { apikey: key, 'Content-Type': 'application/json' };
  // المفاتيح القديمة (JWT) تُرسل أيضًا في Authorization، والمفاتيح الجديدة sb_publishable_ لا تحتاجها
  if (key.startsWith('eyJ')) h.Authorization = `Bearer ${key}`;
  return h;
}

export async function fetchStores() {
  if (LIVE) {
    const res = await fetch(
      `${CONFIG.supabaseUrl}/rest/v1/stores?select=${PUBLIC_COLUMNS}&status=eq.approved&order=created_at.desc`,
      { headers: headers() },
    );
    if (!res.ok) throw new Error(`تعذر تحميل المتاجر (${res.status})`);
    return res.json();
  }
  const res = await fetch('data/demo-stores.json');
  const demo = await res.json();
  const submitted = (storage(DEMO_KEY) || []).map(s => ({ ...s, pending: true }));
  return [...submitted, ...demo];
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
  // الوضع التجريبي: يُحفظ الطلب في متصفحك فقط (بدون بيانات المالك)
  const { owner_name, phone, email, cr_number, ...publicFields } = payload;
  const id = `demo-${Date.now()}`;
  const record = { id, ...publicFields };
  if (record.approximate) {
    record.lat = Math.round(record.lat * 100) / 100;
    record.lng = Math.round(record.lng * 100) / 100;
  }
  storage(DEMO_KEY, [record, ...(storage(DEMO_KEY) || [])]);
  return id;
}
