// نفس منطق دالة البحث في قاعدة البيانات (search_stores) لكن داخل المتصفح:
// يُستخدم في الوضع التجريبي، وكاحتياط إذا لم يُشغَّل الترحيل 005 بعد
import { haversineKm, storeLocations, storeCategories } from './utils.js';

export const PAGE_SIZE = 30;
export const MAX_OFFSET = 60;

export function searchLocal(stores, p = {}) {
  const q = (p.q || '').trim().toLowerCase().slice(0, 60);
  const geo = p.lat != null && p.lng != null;
  const matched = [];
  for (const s of stores) {
    if (p.entity && s.entity_type !== p.entity) continue;
    const cats = storeCategories(s);
    if (p.category && !cats.includes(p.category)) continue;
    const locs = storeLocations(s).filter(l => (!p.region || l.region === p.region) && (!p.city || l.city === p.city));
    if (!locs.length) continue;
    const km = geo ? Math.min(...locs.map(l => haversineKm(p.lat, p.lng, l.lat, l.lng))) : null;
    if (geo && p.radius > 0 && km > p.radius) continue;
    const text = `${s.name} ${s.description || ''} ${cats.join(' ')} ${locs.map(l => `${l.city} ${l.district || ''}`).join(' ')}`;
    if (q && !text.toLowerCase().includes(q)) continue;
    matched.push({ s, km, locs });
  }
  if (geo) matched.sort((a, b) => a.km - b.km);

  const counts = new Map();
  for (const { locs } of matched) {
    for (const key of new Set(locs.map(l => `${l.region}|${l.city}`))) counts.set(key, (counts.get(key) || 0) + 1);
  }
  const offset = Math.min(Math.max(Number(p.offset) || 0, 0), MAX_OFFSET);
  return {
    total: matched.length,
    page_size: PAGE_SIZE,
    max_offset: MAX_OFFSET,
    stores: matched.slice(offset, offset + PAGE_SIZE).map(m => m.s),
    cities: [...counts].map(([key, count]) => {
      const [region, city] = key.split('|');
      return { region, city, count };
    }).sort((a, b) => b.count - a.count),
  };
}
