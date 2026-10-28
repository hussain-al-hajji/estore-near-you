// ضغط الشعار في المتصفح قبل الرفع: صورة مربعة صغيرة (حوالي 3 إلى 6 كيلوبايت) تُحفظ كنص داخل قاعدة البيانات،
// فلا تحتاج مساحة تخزين ملفات مدفوعة. يطابق حد قاعدة البيانات (12 ألف حرف).
export const MAX_LOGO_CHARS = 8000;
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
  for (const size of [96, 80, 64]) {
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
