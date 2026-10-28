// فهم نية الباحث: يحوّل جملة مثل «ابي بخور فاخر بالقطيف يوصل» إلى فلاتر وكلمات ومرادفات
// المطابقة والترتيب نفسها تتم في قاعدة البيانات (search_stores)، وهنا فقط نفسّر الجملة
import { REGIONS } from './constants.js';

// نفس دالة ar_norm في قاعدة البيانات: توحيد الهمزات والتاء المربوطة والألف المقصورة، وإزالة التشكيل و«ال»
export function normalize(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[أإآٱىةؤئ٠-٩ـ]/g, ch => ({ أ: 'ا', إ: 'ا', آ: 'ا', ٱ: 'ا', ى: 'ي', ة: 'ه', ؤ: 'و', ئ: 'ي', ـ: '' }[ch] ?? String(ch.charCodeAt(0) - 0x0660)))
    .replace(/[ً-ٰٟ]/g, '')
    .replace(/[^a-z0-9ء-ي]+/g, ' ')
    .replace(/(^| )ال(?=[^ ]{2})/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---- مرادفات المنتجات: كل مجموعة = كلمات بمعنى متقارب (تُفكّ كبدائل) + المجال الذي تُرفع متاجره ----
const CLUSTERS = [
  ['عطور وتجميل', 'عطر,عطور,برفيوم,بخور,عود,دهن عود,مسك,معطر,عنبر,perfume,oud'],
  ['عطور وتجميل', 'مكياج,ميكب,مكيج,بودره,كريم,سيروم,تجميل,رموش,اظافر,حنا,عنايه بالبشره,makeup'],
  ['ملابس وأزياء', 'ثوب,ثياب,قميص,شماغ,غتره,بشت,مشلح,تفصيل,خياط,خياطه'],
  ['ملابس وأزياء', 'عبايه,عبايات,جلابيه,فستان,فساتين,حجاب,طرحه,شيله,نقاب,abaya,dress'],
  ['ملابس وأزياء', 'ملابس,لبس,ازياء,موضه,ماركات,قطعه'],
  ['ملابس وأزياء', 'حذاء,احذيه,جزمه,شنطه,شنط,حقائب,حقيبه,صندل,نعال'],
  ['إلكترونيات وإكسسوارات', 'جوال,جوالات,ايفون,سماعه,سماعات,شاحن,كفر,لابتوب,حاسب,كمبيوتر,الكترونيات,كيبل,ساعه ذكيه,بلايستيشن'],
  ['أغذية وحلويات', 'حلويات,حلا,حلى,كيك,كعك,معمول,تمر,شوكولاته,شوكلاته,بسكويت,كوكيز,دونات,بقلاوه,ايس كريم,sweets,cake'],
  ['أغذية وحلويات', 'اكل,اكلات,وجبات,طبخ,سمبوسه,مندي,كبسه,مجبوس,مطبق,مخبوزات,معجنات,فطائر,خبز,لحم,دجاج,سمك'],
  ['أغذية وحلويات', 'عسل,سمن,بهارات,مكسرات,مربى,صلصه,مخلل,دبس,طحين'],
  ['قهوة ومشروبات', 'قهوه,بن,كوفي,كافيه,محموصه,مختصه,اسبريسو,لاتيه,قهوه عربيه,هيل,coffee,cafe'],
  ['قهوة ومشروبات', 'شاي,كرك,عصير,عصائر,مشروبات,سموذي,زعفران'],
  ['هدايا وورود', 'هديه,هدايا,ورد,ورود,بوكيه,تغليف,بالونات,توزيعات,مناسبات,حفلات,تخرج,gift,flowers'],
  ['منزل وديكور', 'ديكور,اثاث,مفروشات,شمع,شموع,سجاد,ستائر,اواني,اضاءه,نباتات,زرع,مزهريه,تحف'],
  ['أطفال وألعاب', 'العاب,لعبه,اطفال,طفل,رضع,مواليد,حفاضات,مكعبات,kids,toys'],
  ['رياضة ولياقة', 'رياضه,جيم,لياقه,مكملات,بروتين,دراجه,دراجات,كره,يوجا,تمارين'],
  ['كتب وقرطاسية', 'كتاب,كتب,قرطاسيه,دفتر,دفاتر,اقلام,مكتبه,روايات,طباعه,ملصقات,ستيكرز'],
  ['صحة وعناية', 'صحه,اعشاب,عشاب,عطاره,زيوت,زيت,فيتامينات,طبيعي,عضوي,مساج,صابون'],
  ['حرف ومنتجات يدوية', 'يدوي,يدويه,حرف,حرفه,كروشيه,تطريز,سدو,خوص,فخار,خزف,خرز,هاند ميد,هاندميد,handmade'],
].map(([cat, words]) => ({ cat, words: words.split(',').map(normalize) }));

const STOP = new Set(`ابي ابغي ابغا اريد ابحث دور ودي عن لي علي من في الي الي الي علي مع او هل وش ايش شو وين فين كيف
  يوجد فيه عندكم عندك لو سمحت ممكن تكفي محل محلات متجر متاجر مكان اماكن احسن افضل ارخص رخيص جيد ممتاز حلو زين مره جدا
  شي شيء نفس مثل كل بعض ابيه ابغاه تبي تبغي يبي هذا هذي ذا ذي هو هي مني الى
  اشتري اشتريه اشوف القى الاقي ادور اطلب اجيب لكل مملكه`.split(/\s+/).filter(Boolean).map(normalize));

const NEAR = new Set('قريب قريبه قريبين اقرب جنبي حولي بجنبي بالقرب قربي عندي جنب قرب'.split(' ').map(normalize));
const DELIVERY_WORDS = {
  delivery: ['توصيل', 'يوصل', 'يوصلون', 'توصل', 'توصلون', 'ديليفري', 'delivery'],
  national: ['شحن', 'يشحن', 'يشحنون', 'شحنات'],
  pickup: ['استلام', 'استلم', 'pickup'],
};
const ENTITY_PHRASES = {
  freelance: ['اسر منتجه', 'اسره منتجه', 'اسر', 'عمل حر', 'اعمال حره', 'فريلانس', 'منتجه'],
  company: ['شركه', 'شركات', 'موسسه', 'موسسات'],
};
const LOCATION_ALIASES = { مدينه: ['المدينة المنورة'], مكه: ['مكة المكرمة'], حفر: ['حفر الباطن'], شرقيه: ['المنطقة الشرقية'] };

// ---- المدن والمناطق ----
const PLACES = [];
for (const r of REGIONS) {
  PLACES.push({ kind: 'region', name: r.name, region: r.name, norm: normalize(r.name).replace(/^منطقه /, '') });
  for (const c of r.cities) PLACES.push({ kind: 'city', name: c.name, region: r.name, norm: normalize(c.name) });
}
// المدينة تتقدم على المنطقة إذا تطابق الاسم (الرياض مثلًا)
const PLACE_ORDER = [...PLACES.filter(p => p.kind === 'city'), ...PLACES.filter(p => p.kind === 'region')];

function editDistance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j += 1) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      rowMin = Math.min(rowMin, cur[j]);
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

function stripPrefixes(word) {
  const out = new Set([word]);
  const m = word.match(/^(بال|لل|وال|فال|بال)(.+)$/);
  if (m) out.add(m[2]);
  const m2 = word.match(/^[بلوف](.{3,})$/);
  if (m2) out.add(m2[1]);
  return [...out];
}

function matchPlace(text) {
  for (const form of stripPrefixes(text)) {
    if (form.length < 3) continue;
    const alias = LOCATION_ALIASES[form];
    for (const p of PLACE_ORDER) {
      if (p.norm === form || (alias && alias.includes(p.name))) return { place: p, fuzzy: false };
    }
  }
  for (const form of stripPrefixes(text)) {
    if (form.length < 5) continue;
    const max = form.length >= 8 ? 2 : 1;
    for (const p of PLACE_ORDER) {
      if (p.norm.length >= 5 && editDistance(form, p.norm, max) <= max) return { place: p, fuzzy: true };
    }
  }
  return null;
}

// تطابق تام، وإلا تطابق مع خطأ إملائي واحد في الكلمات الطويلة (6 حروف فأكثر)
function matchCluster(text, { fuzzy = true } = {}) {
  const exact = CLUSTERS.filter(c => c.words.includes(text));
  if (exact.length || !fuzzy || text.length < 6) return exact;
  return CLUSTERS.filter(c => c.words.some(w => !w.includes(' ') && w.length >= 5 && editDistance(text, w, 1) <= 1));
}

// الكلمة بدون حروف العطف والجر الملتصقة (وبخور، بالعطور، للعبايات): التطابق التام أولًا ثم التقريبي
function clustersFor(text) {
  const forms = stripPrefixes(text);
  for (const fuzzy of [false, true]) {
    for (const form of forms) {
      const clusters = matchCluster(form, { fuzzy });
      if (clusters.length) return { literal: form, clusters };
    }
  }
  return { literal: text, clusters: [] };
}

function findSeq(tokens, used, phrase) {
  const parts = phrase.split(' ');
  for (let i = 0; i + parts.length <= tokens.length; i += 1) {
    if (parts.every((p, k) => tokens[i + k] === p && !used[i + k])) return i;
  }
  return -1;
}

const unique = list => [...new Set(list.filter(Boolean))];

// ui: القيم المختارة في الواجهة؛ dismissed: مفاتيح التفسيرات اللي ألغاها المستخدم
export function parseIntent(raw, { categories = [], dismissed = new Set() } = {}) {
  const tokens = normalize(raw).split(' ').filter(Boolean);
  const used = tokens.map(() => false);
  const out = { terms: [], region: '', city: '', entity: '', delivery: '', near: false, boost: [], chips: [], interpreted: false };
  const chip = (key, label, info = false) => out.chips.push({ key, label, info });
  const use = (i, n = 1) => { for (let k = 0; k < n; k += 1) used[i + k] = true; };

  // 1) عبارات النوع: أسر منتجة / شركة
  for (const [entity, phrases] of Object.entries(ENTITY_PHRASES)) {
    const key = `entity:${entity}`;
    if (dismissed.has(key)) continue;
    for (const phrase of phrases) {
      const at = findSeq(tokens, used, phrase);
      if (at === -1) continue;
      use(at, phrase.split(' ').length);
      out.entity = entity;
      chip(key, entity === 'freelance' ? '🏠 أعمال حرة وأسر منتجة' : '🏢 شركات ومؤسسات');
      break;
    }
  }

  // 2) القرب، والتوصيل، والكلمات العامة
  tokens.forEach((t, i) => {
    if (used[i]) return;
    if (NEAR.has(t) && !dismissed.has('near')) {
      use(i);
      out.near = true;
      if (!out.chips.some(c => c.key === 'near')) chip('near', '📍 القريبة منك');
      return;
    }
    for (const [type, words] of Object.entries(DELIVERY_WORDS)) {
      const key = `delivery:${type}`;
      if (!dismissed.has(key) && words.map(normalize).includes(t)) {
        use(i);
        out.delivery = type;
        chip(key, type === 'pickup' ? '🤝 استلام من الموقع' : type === 'national' ? '🚚 شحن لكل المملكة' : '🛵 توصيل');
        return;
      }
    }
  });

  // 3) المدينة أو المنطقة (من كلمة أو كلمتين أو ثلاث)
  for (let n = 3; n >= 1 && !out.city && !out.region; n -= 1) {
    for (let i = 0; i + n <= tokens.length && !out.city && !out.region; i += 1) {
      if (used.slice(i, i + n).some(Boolean)) continue;
      const found = matchPlace(tokens.slice(i, i + n).join(' '));
      if (!found) continue;
      const { place } = found;
      const key = `place:${place.name}`;
      if (dismissed.has(key)) continue;
      use(i, n);
      if (place.kind === 'city') Object.assign(out, { city: place.name, region: place.region });
      else out.region = place.region;
      chip(key, `📍 ${place.name}`);
    }
  }

  // 4) الكلمات المتبقية → مجموعات بدائل (الكلمة + مرادفاتها)
  const free = tokens.map((t, i) => ({ t, i })).filter(({ t, i }) => !used[i] && !STOP.has(t) && t.length > 1);
  const seenBoost = new Set();
  const addTerm = (literal, clusters) => {
    const alts = [literal];
    for (const c of clusters) {
      const key = `cat:${c.cat}`;
      if (dismissed.has(key)) continue;
      alts.push(...c.words);
      if (categories.includes(c.cat) && !seenBoost.has(c.cat)) {
        seenBoost.add(c.cat);
        out.boost.push(c.cat);
        chip(key, `🏷️ ${c.cat}`, true);
      }
    }
    const list = unique(alts).slice(0, 12);
    if (!out.terms.some(g => g[0] === list[0])) out.terms.push(list);
  };
  for (let k = 0; k < free.length; k += 1) {
    const { t, i } = free[k];
    const next = free[k + 1];
    if (next && next.i === i + 1) {
      const pair = `${t} ${next.t}`;
      const clusters = matchCluster(pair, { fuzzy: false });
      if (clusters.length) {
        addTerm(pair, clusters);
        k += 1;
        continue;
      }
    }
    const { literal, clusters } = clustersFor(t);
    addTerm(literal, clusters);
  }

  out.interpreted = out.chips.length > 0;
  return out;
}
