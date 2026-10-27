import { REGIONS, SA_BOUNDS } from './constants.js';

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

// يقبل روابط http/https فقط حتى لا تُحقن روابط javascript:
export function safeUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

export function normalizeUrl(value) {
  const v = value.trim();
  if (!v) return '';
  return /^https?:\/\//i.test(v) ? v : `https://${v}`;
}

// يحوّل "@name" أو رابط الحساب إلى اسم المستخدم فقط
export function normalizeHandle(value) {
  let v = (value || '').trim();
  if (!v) return '';
  v = v.replace(/^https?:\/\/(www\.)?[^/]+\//i, '').replace(/^@/, '');
  return v.split(/[/?#]/)[0].replace(/^@/, '');
}

// يحوّل رقم الجوال السعودي إلى صيغة دولية بدون +
export function normalizePhone(value) {
  let d = (value || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('05') && d.length === 10) d = `966${d.slice(1)}`;
  else if (d.startsWith('5') && d.length === 9) d = `966${d}`;
  return d;
}

export function haversineKm(lat1, lng1, lat2, lng2) {
  const toRad = x => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}

export function formatDistance(km) {
  if (km < 1) return `${Math.max(50, Math.round((km * 1000) / 50) * 50)} م`;
  return `${km < 10 ? km.toFixed(1) : Math.round(km)} كم`;
}

export function storesCountLabel(n) {
  if (n === 0) return 'لا توجد متاجر';
  if (n === 1) return 'متجر واحد';
  if (n === 2) return 'متجران';
  if (n <= 10) return `${n} متاجر`;
  return `${n} متجرًا`;
}

export function inSaudi(lat, lng) {
  return lat >= SA_BOUNDS.minLat && lat <= SA_BOUNDS.maxLat
    && lng >= SA_BOUNDS.minLng && lng <= SA_BOUNDS.maxLng;
}

export function nearestCity(lat, lng) {
  let best = null;
  for (const region of REGIONS) {
    for (const city of region.cities) {
      const km = haversineKm(lat, lng, city.lat, city.lng);
      if (!best || km < best.km) best = { region: region.name, city: city.name, km };
    }
  }
  return best;
}

// يستخرج الإحداثيات من رابط خرائط قوقل/أبل أو من نص "lat, lng"
export function parseLocation(text) {
  const raw = (text || '').trim();
  if (!raw) return { error: 'الصق رابط الموقع أو الإحداثيات أولًا.' };
  let t = raw;
  try { t = decodeURIComponent(raw); } catch { /* نستخدم النص كما هو */ }

  const patterns = [
    /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/,             // دبوس المكان في روابط قوقل
    /[?&](?:q|query|ll|sll|destination|daddr|center)=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/,
    /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/,                 // مركز الخريطة في الرابط
    /^(-?\d+(?:\.\d+)?)\s*[,،]\s*(-?\d+(?:\.\d+)?)$/,         // إحداثيات مباشرة
  ];
  for (const re of patterns) {
    const m = t.match(re);
    if (m) {
      const lat = parseFloat(m[1]);
      const lng = parseFloat(m[2]);
      if (inSaudi(lat, lng)) return { lat, lng };
      if (inSaudi(lng, lat)) return { lat: lng, lng: lat };
      return { error: 'الموقع في الرابط يقع خارج المملكة.' };
    }
  }
  if (/goo\.gl|maps\.app/i.test(t)) {
    return { error: 'الروابط المختصرة لا تحتوي على الإحداثيات. افتح الرابط في المتصفح ثم انسخ الرابط الكامل، أو اضغط مطولًا على الموقع في خرائط قوقل وانسخ الإحداثيات.' };
  }
  return { error: 'لم نتمكن من قراءة الموقع من هذا الرابط. جرّب نسخ الإحداثيات مثل: 26.5196, 50.0115' };
}

export function storage(key, value) {
  try {
    if (value === undefined) return JSON.parse(localStorage.getItem(key) || 'null');
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    return null;
  }
  return value;
}
