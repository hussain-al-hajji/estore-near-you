// طلبات الإعلان: التسعير والحالات (مشتركة بين صفحة المتجر ولوحة التحكم)
import { SETTINGS } from './settings.js';

export const AD_KINDS = {
  banner: { icon: '🖼️', label: 'بنر بصورة' },
  pin: { icon: '📌', label: 'تثبيت بطاقة المتجر' },
};

export const AD_STATUS = {
  pending: { icon: '⏳', label: 'بانتظار المراجعة', cls: 'wait' },
  changes: { icon: '✏️', label: 'مطلوب تعديل', cls: 'warn' },
  approved: { icon: '💳', label: 'معتمد بانتظار السداد', cls: 'info' },
  paid: { icon: '✅', label: 'مدفوع ومجدول', cls: 'on' },
  rejected: { icon: '❌', label: 'مرفوض', cls: 'off' },
  cancelled: { icon: '⚪', label: 'ملغي', cls: 'off' },
};

export const MESSAGE_KIND = {
  submit: 'طلب جديد', update: 'تعديل وإعادة إرسال', changes: 'طلب تعديل', approve: 'موافقة وطلب سداد',
  paid: 'تأكيد السداد', reject: 'رفض', cancel: 'إلغاء', message: '',
};

export const OPEN_STATUSES = ['pending', 'changes', 'approved', 'paid'];

// عدد الأيام × (سعر المنطقة الأولى + سعر كل منطقة إضافية)
export function adPrice(regions, days) {
  const { first_region: first, extra_region: extra } = SETTINGS.ads;
  const n = Math.max(0, regions);
  return n ? days * (first + extra * (n - 1)) : 0;
}

export function adBreakdown(regions, days) {
  const { first_region: first, extra_region: extra } = SETTINGS.ads;
  const daily = regions ? first + extra * (regions - 1) : 0;
  return { daily, total: daily * days, first, extra, extraCount: Math.max(0, regions - 1) };
}

export const addDays = (key, n) => {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export const daysBetween = (a, b) => Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 86400000);

// هل يتقاطع طلبان في المدة والمنطقة؟
export function overlaps(a, b) {
  return a.id !== b.id && a.starts_on <= b.ends_on && b.starts_on <= a.ends_on && a.regions.some(r => b.regions.includes(r));
}
