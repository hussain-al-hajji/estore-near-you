// حساب حالة اشتراك المتجر: الاستحقاق يبدأ من يوم التسجيل (أو نهاية فترة الافتتاح لمن سجّل قبلها)،
// ثم من نهاية آخر سنة مدفوعة، وبعده مهلة سداد حسب نوع النشاط.
import { SETTINGS, todayKey, formatDate, priceFor, graceFor } from './settings.js';

function parseKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function addDays(key, n) {
  const d = parseKey(key);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// b - a بالأيام
export function daysBetween(a, b) {
  return Math.round((parseKey(b) - parseKey(a)) / 86400000);
}

export function daysLabel(n) {
  if (n <= 0) return 'أقل من يوم';
  if (n === 1) return 'يوم واحد';
  if (n === 2) return 'يومين';
  if (n <= 10) return `${n} أيام`;
  return `${n} يومًا`;
}

export function registrationDay(iso) {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' });
}

/**
 * key: launch (مجاني لفترة الافتتاح) | paid (مدفوع) | grace (مستحق وفي المهلة) | overdue (انتهت المهلة)
 * soon: الاستحقاق خلال 30 يومًا (وقت مناسب للتذكير)
 */
export function billingInfo(store, today = todayKey()) {
  const fee = priceFor(store.entity_type);
  const grace = graceFor(store.entity_type);
  const registered = registrationDay(store.created_at);
  const launchEnd = SETTINGS.pricing.launch_end;
  const due = store.paid_until || (registered > launchEnd ? registered : launchEnd);
  const graceEnd = addDays(due, grace);
  const base = {
    fee, grace, registered, due, graceEnd,
    applicable: store.status !== 'rejected',
    toGraceEnd: daysBetween(today, graceEnd),
  };

  if (today < due) {
    const daysLeft = daysBetween(today, due);
    return {
      ...base,
      key: store.paid_until ? 'paid' : 'launch',
      daysLeft,
      soon: daysLeft <= 30,
      label: store.paid_until ? `مدفوع حتى ${formatDate(due)}` : `مجاني حتى ${formatDate(due)}`,
      short: `السداد القادم بعد ${daysLabel(daysLeft)}`,
    };
  }
  if (today <= graceEnd) {
    const daysLeft = daysBetween(today, graceEnd);
    return {
      ...base,
      key: 'grace',
      daysLeft,
      soon: true,
      label: `مستحق منذ ${formatDate(due)}`,
      short: `باقي على نهاية المهلة ${daysLabel(daysLeft)}`,
    };
  }
  const late = daysBetween(graceEnd, today);
  return {
    ...base,
    key: 'overdue',
    daysLeft: -late,
    soon: true,
    label: `انتهت المهلة في ${formatDate(graceEnd)}`,
    short: `متأخر ${daysLabel(late)}`,
  };
}

export const BILLING_LABELS = {
  launch: { label: 'فترة الافتتاح', icon: '🎉' },
  paid: { label: 'مدفوع', icon: '✅' },
  grace: { label: 'في مهلة السداد', icon: '⏳' },
  overdue: { label: 'متأخر السداد', icon: '⚠️' },
};

// نص {days_left} في قالب الإيميل يقيس المسافة لآخر موعد للسداد
export function graceRemainingText(info) {
  return info.toGraceEnd >= 0 ? `متبقي ${daysLabel(info.toGraceEnd)}` : `متأخر ${daysLabel(-info.toGraceEnd)}`;
}

export function fillTemplate(text, vars) {
  return text.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k] ?? '') : m));
}

export { formatDate };
