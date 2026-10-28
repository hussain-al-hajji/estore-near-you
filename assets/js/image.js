// ضغط الشعار في المتصفح قبل الرفع: صورة مربعة صغيرة 64 بكسل (حوالي 2 إلى 4 كيلوبايت) تُحفظ كنص داخل قاعدة البيانات،
// فلا تحتاج مساحة تخزين ملفات مدفوعة. يطابق حد قاعدة البيانات (12 ألف حرف).
export const MAX_LOGO_CHARS = 5000;
const MAX_FILE_BYTES = 10 * 1024 * 1024;

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('ما قدرنا نقرأ الصورة، جرّب صورة ثانية (PNG أو JPG).')); };
    img.src = url;
  });
}

export async function compressLogo(file) {
  if (!file || !/^image\/(png|jpe?g|webp|gif|bmp)$/i.test(file.type)) throw new Error('اختر صورة بصيغة PNG أو JPG أو WebP.');
  if (file.size > MAX_FILE_BYTES) throw new Error('الصورة كبيرة جدًا (الحد 10 ميجا).');
  const img = await loadImage(file);
  const side = Math.min(img.naturalWidth, img.naturalHeight);
  if (!side) throw new Error('الصورة غير صالحة.');
  const sx = (img.naturalWidth - side) / 2;
  const sy = (img.naturalHeight - side) / 2;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  // نجرّب أحجامًا وجودات أقل حتى نصل للحد (WebP يحفظ الشفافية، وإن لم يدعمه المتصفح نستخدم JPEG)
  for (const size of [64, 56, 48]) {
    canvas.width = size;
    canvas.height = size;
    ctx.clearRect(0, 0, size, size);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
    for (const quality of [0.85, 0.7, 0.55, 0.4]) {
      let data = canvas.toDataURL('image/webp', quality);
      if (!data.startsWith('data:image/webp')) {
        ctx.globalCompositeOperation = 'destination-over';
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, size, size);
        ctx.globalCompositeOperation = 'source-over';
        data = canvas.toDataURL('image/jpeg', quality);
      }
      if (data.length <= MAX_LOGO_CHARS) return data;
    }
  }
  throw new Error('ما قدرنا نصغّر الصورة كفاية، جرّب صورة أبسط.');
}

// صورة بنر إعلاني: عريضة (نحو 3 إلى 1) وتُضغط في المتصفح حتى لا تتجاوز 40 ألف حرف
export const MAX_BANNER_CHARS = 40000;

export async function compressBanner(file) {
  if (!file || !/^image\/(png|jpe?g|webp|gif|bmp)$/i.test(file.type)) throw new Error('اختر صورة بصيغة PNG أو JPG أو WebP.');
  if (file.size > MAX_FILE_BYTES) throw new Error('الصورة كبيرة جدًا (الحد 10 ميجا).');
  const img = await loadImage(file);
  const ratio = 3.2;
  let sw = img.naturalWidth;
  let sh = sw / ratio;
  if (sh > img.naturalHeight) {
    sh = img.naturalHeight;
    sw = sh * ratio;
  }
  const sx = (img.naturalWidth - sw) / 2;
  const sy = (img.naturalHeight - sh) / 2;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  for (const width of [640, 512, 400]) {
    canvas.width = width;
    canvas.height = Math.round(width / ratio);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.8, 0.65, 0.5, 0.4]) {
      let data = canvas.toDataURL('image/webp', quality);
      if (!data.startsWith('data:image/webp')) {
        ctx.globalCompositeOperation = 'destination-over';
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.globalCompositeOperation = 'source-over';
        data = canvas.toDataURL('image/jpeg', quality);
      }
      if (data.length <= MAX_BANNER_CHARS) return data;
    }
  }
  throw new Error('ما قدرنا نصغّر الصورة كفاية، جرّب صورة أبسط.');
}
