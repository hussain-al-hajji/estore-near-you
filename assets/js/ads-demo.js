// محاكاة طلبات الإعلان في الوضع التجريبي (نفس قواعد قاعدة البيانات، والبيانات في متصفحك فقط)
import { demoAllStores, demoBannerList, demoPinList, DEMO_KEYS } from './api.js';
import { storage, riyadhDay } from './utils.js';
import { adPrice, addDays } from './ads-common.js';
import { REGIONS } from './constants.js';

const KEY = 'dukkan.demoAds';
const load = () => storage(KEY) || [];
const save = list => storage(KEY, list);
const clone = v => JSON.parse(JSON.stringify(v));

function addMessage(r, sender, kind, body) {
  r.messages.push({ id: Date.now() + Math.random(), sender, kind, body: body || null, created_at: new Date().toISOString() });
}

function validate(d) {
  const names = REGIONS.map(r => r.name);
  if (!['banner', 'pin'].includes(d.kind)) throw new Error('اختر نوع الإعلان');
  if (!d.regions?.length || new Set(d.regions).size !== d.regions.length || d.regions.some(r => !names.includes(r))) throw new Error('اختر منطقة واحدة على الأقل');
  if (!(d.days >= 1 && d.days <= 365)) throw new Error('مدة الإعلان من يوم إلى 365 يوم');
  if (!d.starts_on || d.starts_on < riyadhDay()) throw new Error('تاريخ البداية لازم يكون من اليوم فصاعدًا');
  if (d.kind === 'banner' && !d.image) throw new Error('ارفع صورة البنر');
}

const fields = d => ({
  kind: d.kind, regions: d.regions, starts_on: d.starts_on, days: d.days, ends_on: addDays(d.starts_on, d.days - 1),
  price: adPrice(d.regions.length, d.days), link_url: d.link_url || null, image: d.kind === 'banner' ? d.image : null,
});

export async function demoOwnerAds(storeId) {
  return clone(load().filter(r => r.store_id === storeId).sort((a, b) => b.created_at.localeCompare(a.created_at)));
}

export async function demoSubmitAd(storeId, d) {
  validate(d);
  const list = load();
  const r = { id: Date.now(), store_id: storeId, status: 'pending', created_at: new Date().toISOString(), updated_at: new Date().toISOString(), messages: [], ...fields(d) };
  addMessage(r, 'owner', 'submit', d.note || 'طلب إعلان جديد');
  list.push(r);
  save(list);
  return r.id;
}

function find(list, id) {
  const r = list.find(x => x.id === id);
  if (!r) throw new Error('الطلب غير موجود');
  return r;
}

export async function demoUpdateAd(id, d) {
  validate(d);
  const list = load();
  const r = find(list, id);
  if (!['pending', 'changes'].includes(r.status)) throw new Error('ما تقدر تعدّل الطلب في حالته الحالية');
  Object.assign(r, fields(d), { status: 'pending', updated_at: new Date().toISOString() });
  addMessage(r, 'owner', 'update', d.note || 'عدّلت الطلب وأعدت إرساله');
  save(list);
}

export async function demoAdMessage(id, body) {
  if (!body?.trim()) throw new Error('اكتب رسالتك');
  const list = load();
  addMessage(find(list, id), 'owner', 'message', body.trim());
  save(list);
}

export async function demoCancelAd(id) {
  const list = load();
  const r = find(list, id);
  if (!['pending', 'changes', 'approved'].includes(r.status)) throw new Error('ما تقدر تلغي الطلب في حالته الحالية، تواصل معنا');
  r.status = 'cancelled';
  addMessage(r, 'owner', 'cancel', 'ألغيت الطلب');
  save(list);
}

export async function demoAdminAds() {
  const stores = new Map((await demoAllStores()).map(s => [s.id, s]));
  return clone(load()).map(r => ({ ...r, stores: { name: stores.get(r.store_id)?.name || 'متجر', city: stores.get(r.store_id)?.city || '' } }))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export async function demoAdReply(id, action, body) {
  const list = load();
  const r = find(list, id);
  const name = (await demoAllStores()).find(s => s.id === r.store_id)?.name || 'متجر';
  const text = (body || '').trim();
  if (action === 'message') {
    if (!text) throw new Error('اكتب الرسالة');
    addMessage(r, 'admin', 'message', text);
  } else if (action === 'changes') {
    if (!['pending', 'approved', 'changes'].includes(r.status)) throw new Error('ما تقدر تطلب تعديلًا في هذه الحالة');
    if (text.length < 3) throw new Error('اكتب التعديل المطلوب');
    r.status = 'changes';
    addMessage(r, 'admin', 'changes', text);
  } else if (action === 'approve') {
    if (!['pending', 'changes'].includes(r.status)) throw new Error('الطلب ليس بانتظار المراجعة');
    if (text.length < 3) throw new Error('اكتب طريقة السداد');
    r.status = 'approved';
    addMessage(r, 'admin', 'approve', text);
  } else if (action === 'reject') {
    if (['paid', 'cancelled', 'rejected'].includes(r.status)) throw new Error('ما تقدر ترفض الطلب في هذه الحالة');
    r.status = 'rejected';
    addMessage(r, 'admin', 'reject', text);
  } else if (action === 'paid') {
    if (r.status !== 'approved') throw new Error('اعتمد الطلب أولًا ثم أكّد السداد');
    const base = { regions: r.regions, starts_on: r.starts_on, ends_on: r.ends_on, active: true, priority: 1, advertiser: name, note: `طلب إعلان #${r.id}`, created_at: new Date().toISOString() };
    if (r.kind === 'banner') {
      const banners = demoBannerList();
      r.banner_id = Date.now();
      banners.push({ id: r.banner_id, title: name, body: null, button_label: null, link_url: r.link_url, image_url: r.image, image_only: true, theme: 'violet', ...base });
      storage(DEMO_KEYS.banners, banners);
    } else {
      const pins = demoPinList();
      r.pin_id = Date.now();
      pins.push({ id: r.pin_id, store_id: r.store_id, ...base });
      storage(DEMO_KEYS.pins, pins);
    }
    r.status = 'paid';
    addMessage(r, 'admin', 'paid', text || 'تم استلام السداد، وسيظهر إعلانك في الموعد المحدد');
  } else if (action === 'cancel') {
    if (['cancelled', 'rejected'].includes(r.status)) throw new Error('الطلب مغلق');
    if (r.banner_id) storage(DEMO_KEYS.banners, demoBannerList().map(b => (b.id === r.banner_id ? { ...b, active: false } : b)));
    if (r.pin_id) storage(DEMO_KEYS.pins, demoPinList().map(p => (p.id === r.pin_id ? { ...p, active: false } : p)));
    r.status = 'cancelled';
    addMessage(r, 'admin', 'cancel', text);
  } else {
    throw new Error('إجراء غير معروف');
  }
  r.updated_at = new Date().toISOString();
  save(list);
}
