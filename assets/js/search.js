// نفس منطق دالة البحث في قاعدة البيانات (search_stores) لكن داخل المتصفح:
// يُستخدم في الوضع التجريبي، وكاحتياط إذا لم تُشغَّل ملفات الترحيل الجديدة بعد
import { haversineKm, storeLocations, storeCategories, hasPublicAddress } from './utils.js';
import { normalize } from './intent.js';

export const PAGE_SIZE = 30;
export const MAX_OFFSET = 60;

// ثلاثيات الحروف كما في pg_trgm (بحشو مسافتين قبل الكلمة ومسافة بعدها)
function trigrams(word) {
  const padded = `  ${word} `;
  const set = new Set();
  for (let i = 0; i + 3 <= padded.length; i += 1) set.add(padded.slice(i, i + 3));
  return set;
}

function wordSimilarity(a, field) {
  const grams = trigrams(a);
  let best = 0;
  for (const w of field.split(' ')) {
    const other = trigrams(w);
    let common = 0;
    for (const g of grams) if (other.has(g)) common += 1;
    best = Math.max(best, common / grams.size);
  }
  return best;
}

function fieldScore(a, f, w, fuzzy = true) {
  if (!a || !f) return 0;
  if (` ${f} `.includes(` ${a} `)) return w;
  if (a.length >= 3 && ` ${f}`.includes(` ${a}`)) return w * 0.85;
  if (a.length >= 4 && f.includes(a)) return w * 0.6;
  if (fuzzy && a.length >= 4) {
    const sim = wordSimilarity(a, f);
    if (sim >= 0.55) return w * 0.5 * sim;
  }
  return 0;
}

function termScore(alts, doc) {
  let best = 0;
  alts.forEach((a, i) => {
    const fz = i === 0;
    const s = Math.max(fieldScore(a, doc.name, 10, fz), fieldScore(a, doc.tags, 8, fz), fieldScore(a, doc.cats, 6, fz),
      fieldScore(a, doc.places, 5, fz), fieldScore(a, doc.body, 2, fz));
    best = Math.max(best, s * (i === 0 ? 1 : 0.8));
  });
  return best;
}

function docOf(s, locs, cats) {
  return {
    name: normalize(s.name),
    tags: normalize((s.tags || []).join(' ')),
    cats: normalize([...cats, s.category].join(' ')),
    body: normalize(s.description || ''),
    places: normalize(locs.map(l => `${l.city} ${l.district || ''} ${l.region}`).join(' ')),
  };
}

export function searchLocal(stores, p = {}) {
  if (p.id) {
    const s = stores.find(x => String(x.id) === String(p.id) && !x.pending && hasPublicAddress(x));
    return { total: s ? 1 : 0, page_size: PAGE_SIZE, max_offset: 0, relaxed: false, stores: s ? [s] : [], cities: [] };
  }
  const terms = (p.terms ? p.terms : (p.q || '').trim() ? [[p.q.trim().slice(0, 60)]] : [])
    .slice(0, 8).map(alts => alts.map(a => normalize(a).slice(0, 30)).filter(Boolean).slice(0, 12)).filter(a => a.length);
  const geo = p.lat != null && p.lng != null;
  const boost = new Set(p.boost || []);
  const rows = [];
  for (const s of stores) {
    if (!hasPublicAddress(s)) continue;
    if (p.entity && s.entity_type !== p.entity) continue;
    const cats = storeCategories(s);
    if (p.category && !cats.includes(p.category)) continue;
    if (p.delivery) {
      const d = s.delivery || [];
      if (p.delivery === 'delivery' ? !(d.includes('local') || d.includes('national')) : !d.includes(p.delivery)) continue;
    }
    const allLocs = storeLocations(s);
    // النطاق المكاني للمستخدم (المسافة) ونطاق الخريطة الظاهر يتجمعان: المتجر يظهر إذا كان في أحدهما
    const view = p.north != null;
    const radius = geo && p.radius > 0 ? p.radius : 0;
    let locs = allLocs.filter(l => (!p.region || l.region === p.region) && (!p.city || l.city === p.city));
    if (view || radius) {
      locs = locs.filter(l => (view && l.lat >= p.south && l.lat <= p.north && l.lng >= p.west && l.lng <= p.east)
        || (radius && haversineKm(p.lat, p.lng, l.lat, l.lng) <= radius));
    }
    if (!locs.length) continue;
    const km = geo ? Math.min(...locs.map(l => haversineKm(p.lat, p.lng, l.lat, l.lng))) : null;
    const doc = docOf(s, allLocs, cats);
    let hits = 0;
    let score = 0;
    for (const alts of terms) {
      const sc = termScore(alts, doc);
      if (sc > 0) hits += 1;
      score += sc;
    }
    const rank = score + (cats.some(c => boost.has(c)) ? 3 : 0) - (geo ? 0.4 * Math.log(1 + km) : 0);
    rows.push({ s, km, hits, rank, locs });
  }
  // المتاجر التي تطابق كل الكلمات تأتي أولًا، وإذا كانت قليلة (أقل من 10) نكمّل بالأقرب مطابقة
  const n = terms.length;
  const best = rows.reduce((m, r) => Math.max(m, r.hits), 0);
  const full = rows.filter(r => r.hits >= n).length;
  const thr = n === 0 ? 0 : full >= 10 ? n : best >= n ? Math.max(1, n - 1) : Math.max(best, 1);
  const matched = rows.filter(r => r.hits >= thr);
  // نفس ترتيب قاعدة البيانات: عدد الكلمات المطابقة ثم الأهمية ثم الأقرب ثم الأحدث
  const newest = (a, b) => String(b.s.created_at || '').localeCompare(String(a.s.created_at || '')) || String(a.s.id).localeCompare(String(b.s.id));
  matched.sort((a, b) => b.hits - a.hits || (n ? b.rank - a.rank : 0) || (geo ? a.km - b.km : 0) || newest(a, b));

  const counts = new Map();
  for (const { locs } of matched) {
    for (const key of new Set(locs.map(l => `${l.region}|${l.city}`))) counts.set(key, (counts.get(key) || 0) + 1);
  }
  const offset = Math.min(Math.max(Number(p.offset) || 0, 0), MAX_OFFSET);
  return {
    total: matched.length,
    page_size: PAGE_SIZE,
    max_offset: MAX_OFFSET,
    relaxed: thr > 0 && thr < n,
    stores: matched.slice(offset, offset + PAGE_SIZE).map(m => m.s),
    cities: [...counts].map(([key, count]) => {
      const [region, city] = key.split('|');
      return { region, city, count };
    }).sort((a, b) => b.count - a.count),
  };
}
