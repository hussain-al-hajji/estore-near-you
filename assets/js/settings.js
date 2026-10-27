// إعدادات المنصة القابلة للتعديل من لوحة التحكم (نصوص النموذج، التصنيفات، الأسعار، التذييل).
// تُحمَّل مرة قبل فتح أي قسم، والتصنيفات تُصدَّر كروابط حية تتحدث عند تغيير الإعدادات.
import { DEFAULT_SETTINGS } from './default-settings.js';
import { fetchSettings } from './api.js';

export const SETTINGS = structuredClone(DEFAULT_SETTINGS);
export let CATEGORIES = [];
export let CATEGORY_ICONS = {};

export const ENTITY_TYPES = {
  company: { label: 'شركة / مؤسسة', icon: '🏢' },
  freelance: { label: 'عمل حر / أسر منتجة', icon: '🏠' },
};
export const REGISTRANT_ROLES = {
  owner: 'مالك المشروع',
  employee: 'موظف في المشروع',
};

const LONG_DATE = new Intl.DateTimeFormat('ar-u-ca-gregory-nu-latn', { day: 'numeric', month: 'long', year: 'numeric' });

export function deepMerge(target, source) {
  for (const [k, v] of Object.entries(source || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && target[k] && typeof target[k] === 'object' && !Array.isArray(target[k])) {
      deepMerge(target[k], v);
    } else if (v !== undefined && v !== null) {
      target[k] = v;
    }
  }
  return target;
}

export function applySettings(data) {
  const fresh = deepMerge(structuredClone(DEFAULT_SETTINGS), data);
  for (const key of Object.keys(SETTINGS)) delete SETTINGS[key];
  Object.assign(SETTINGS, fresh);
  CATEGORIES = SETTINGS.form.categories.map(c => c.name);
  CATEGORY_ICONS = Object.fromEntries(SETTINGS.form.categories.map(c => [c.name, c.icon || '🛍️']));
}

export async function loadSettings() {
  try {
    applySettings(await fetchSettings());
  } catch (err) {
    console.warn('تعذر تحميل الإعدادات، نستخدم الافتراضية', err);
    applySettings({});
  }
}

applySettings({});

// ---- مساعدات الأسعار والاشتراك ----

export function todayKey() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' });
}

export function formatDate(key) {
  if (!key) return '';
  const [y, m, d] = key.split('-').map(Number);
  return LONG_DATE.format(new Date(y, m - 1, d));
}

export function isLaunchPeriod() {
  return todayKey() < SETTINGS.pricing.launch_end;
}

export function priceFor(entityType) {
  return entityType === 'company' ? SETTINGS.pricing.price_company : SETTINGS.pricing.price_freelance;
}

export function badgeText() {
  if (SETTINGS.form.badge) return SETTINGS.form.badge;
  return isLaunchPeriod() ? `🎉 عرض الافتتاح: التسجيل مجاني حتى ${formatDate(SETTINGS.pricing.launch_end)}` : '';
}

export function graceFor(entityType) {
  return entityType === 'company' ? SETTINGS.pricing.grace_days_company : SETTINGS.pricing.grace_days_freelance;
}

// 30 → شهر، 120 → 4 شهور، وغيرها بالأيام
export function graceLabel(days) {
  const months = days / 30;
  if (Number.isInteger(months) && months >= 1 && months <= 12) {
    return months === 1 ? 'شهر' : months === 2 ? 'شهرين' : months <= 10 ? `${months} شهور` : `${months} شهرًا`;
  }
  return `${days} يوم`;
}

export function pricingText() {
  const p = SETTINGS.pricing;
  const yearly = `اشتراك سنوي: ${p.price_company} ر.س للشركات والمؤسسات (مهلة السداد ${graceLabel(p.grace_days_company)})، و${p.price_freelance} ر.س للأعمال الحرة والأسر المنتجة (مهلة السداد ${graceLabel(p.grace_days_freelance)}). السداد بحوالة بنكية، ونرسل لك بيانات الحساب على إيميلك.`;
  return isLaunchPeriod()
    ? `التسجيل مجاني خلال فترة الافتتاح حتى ${formatDate(p.launch_end)}، وبعدها ${yearly}`
    : `${yearly} يبدأ الاشتراك من يوم التسجيل.`;
}
