// تحديد موقع المستخدم بأفضل دقة ممكنة.
// أول قراءة يعطيها المتصفح غالبًا تقريبية (من الشبكة أو IP، وقد تبعد عشرات الكيلومترات)،
// ثم تتحسن مع GPS خلال ثوانٍ؛ لذلك نراقب القراءات ونحتفظ بالأدق حتى تصبح جيدة أو تنتهي المهلة.
export function locate({ onUpdate, timeout = 12000, goodEnough = 40 } = {}) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(Object.assign(new Error('unsupported'), { code: 0 }));
      return;
    }
    let best = null;
    let done = false;
    let watchId = null;
    const stop = () => {
      done = true;
      clearTimeout(timer);
      if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    };
    const finish = () => {
      if (done) return;
      stop();
      if (best) resolve(best);
      else reject(Object.assign(new Error('timeout'), { code: 3 }));
    };
    const timer = setTimeout(finish, timeout);
    watchId = navigator.geolocation.watchPosition(pos => {
      if (done) return;
      const p = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy || 0 };
      if (!best || p.accuracy < best.accuracy) {
        best = p;
        onUpdate?.(p);
      }
      if (p.accuracy <= goodEnough) finish();
    }, err => {
      // خطأ بعد قراءة سابقة لا يلغيها
      if (done || best) return;
      stop();
      reject(err);
    }, { enableHighAccuracy: true, maximumAge: 0, timeout });
  });
}

export function accuracyLabel(meters) {
  if (meters < 1000) return `±${Math.max(5, Math.round(meters / 5) * 5)} م`;
  return `±${(meters / 1000).toFixed(meters < 10000 ? 1 : 0)} كم`;
}

export function geoErrorMessage(err) {
  if (err?.code === 1) return 'المتصفح ما سمح بالوصول لموقعك. فعّل إذن الموقع للموقع من إعدادات المتصفح وجرّب مرة ثانية.';
  if (err?.code === 0) return 'متصفحك لا يدعم تحديد الموقع.';
  return 'ما قدرنا نحدد موقعك. تأكد إن خدمة الموقع (GPS) شغّالة في جهازك وجرّب مرة ثانية.';
}

// ---- البحث عن الأماكن واسم المكان (Nominatim من OpenStreetMap، مجاني بدون مفتاح) ----
const NOMINATIM = 'https://nominatim.openstreetmap.org';

async function nominatimSearch(q) {
  const url = `${NOMINATIM}/search?format=jsonv2&countrycodes=sa&accept-language=ar&limit=6&q=${encodeURIComponent(q)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('تعذر البحث الآن، جرّب بعد قليل.');
  return res.json();
}

// أسماء الأحياء في الخريطة بدون كلمة «حي»، فنحذفها ونجرب صيغًا أوسع إذا لم نجد نتائج
export async function searchPlaces(query) {
  const words = query.replace(/[،,]/g, ' ').split(/\s+/).filter(w => w && !/^(حي|حى|الحي)$/.test(w));
  if (!words.length) return [];
  const attempts = [words.join(' ')];
  if (words.length > 1) attempts.push(`${words.slice(0, -1).join(' ')}, ${words.at(-1)}`, words[0]);
  let found = [];
  for (const q of attempts) {
    found = await nominatimSearch(q);
    if (found.length) break;
  }
  return found.map(r => ({
    lat: Number(r.lat),
    lng: Number(r.lon),
    label: r.display_name.split(/[,،]\s*/).slice(0, 3).join('، '),
  }));
}

// اسم الحي والمدينة لنقطة على الخريطة، حتى يتأكد المستخدم أن الموقع صحيح
export async function reverseGeocode(lat, lng) {
  try {
    const res = await fetch(`${NOMINATIM}/reverse?format=jsonv2&accept-language=ar&zoom=16&lat=${lat}&lon=${lng}`);
    if (!res.ok) return null;
    const a = (await res.json()).address || {};
    const district = a.suburb || a.neighbourhood || a.quarter || a.city_district || a.residential || '';
    const city = a.city || a.town || a.village || a.municipality || a.county || '';
    return { district, city, label: [district, city].filter(Boolean).join('، ') };
  } catch {
    return null;
  }
}
