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
