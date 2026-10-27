// اتصال Supabase واحد مشترك (تسجيل الدخول للمشرف وأصحاب المتاجر)، يُحمَّل عند الحاجة فقط
import { CONFIG } from './config.js';

const SUPABASE_JS = {
  src: 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.112.4/dist/umd/supabase.js',
  integrity: 'sha384-ysv13JVP3fufiEXfjML9OdCa/rRbMJvUBOWyor82wfuK8INNZAvmbxHgKIHi+oqz',
};

let clientPromise = null;

function loadScript({ src, integrity }) {
  if (window.supabase) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.integrity = integrity;
    s.crossOrigin = 'anonymous';
    s.onload = resolve;
    s.onerror = () => reject(new Error('تعذر تحميل مكتبة تسجيل الدخول، تأكد من الاتصال وحدّث الصفحة.'));
    document.head.append(s);
  });
}

export function getClient() {
  clientPromise ||= loadScript(SUPABASE_JS).then(() =>
    // implicit: روابط استعادة كلمة المرور تعمل حتى لو فُتحت من جهاز آخر
    window.supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey, { auth: { flowType: 'implicit' } }));
  return clientPromise;
}

// رسائل أخطاء الدخول بالعربي
export function authErrorMessage(message = '') {
  if (/invalid login/i.test(message)) return 'الإيميل أو كلمة المرور غير صحيحة.';
  if (/already registered|already exists/i.test(message)) return 'هذا الإيميل مسجل مسبقًا.';
  if (/signups? not allowed|signup.*disabled/i.test(message)) return 'التسجيل مقفل حاليًا، تواصل معنا.';
  if (/password/i.test(message) && /(weak|short|least|characters)/i.test(message)) return 'كلمة المرور ضعيفة، تأكد من الشروط.';
  if (/email.*(confirm|not confirmed)/i.test(message)) return 'فعّل حسابك من الرسالة المرسلة على إيميلك أولًا.';
  if (/rate limit|too many/i.test(message)) return 'محاولات كثيرة، انتظر شوي وجرّب مرة ثانية.';
  return message;
}
