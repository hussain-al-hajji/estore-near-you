// نموذج «راسلنا»: الرسالة تصل للوحة التحكم (تبويب الرسائل)
import { CONTACT_TOPICS } from './constants.js';
import { submitContact } from './api.js';
import { normalizePhone } from './utils.js';

const $ = id => document.getElementById(id);
const dialog = $('contactDialog');
const form = $('contactForm');
const error = $('contactError');

$('contactTopic').innerHTML = Object.entries(CONTACT_TOPICS).map(([k, label]) => `<option value="${k}">${label}</option>`).join('');

export function openContact(topic = 'general') {
  form.reset();
  $('contactTopic').value = topic;
  error.hidden = true;
  form.querySelector('.report-body').hidden = false;
  form.querySelector('.report-done').hidden = true;
  dialog.showModal();
}

dialog.addEventListener('click', e => {
  if (e.target === dialog || e.target.closest('[data-close]')) dialog.close();
});

form.addEventListener('submit', async e => {
  e.preventDefault();
  error.hidden = true;
  const f = form.elements;
  const fail = msg => {
    error.textContent = msg;
    error.hidden = false;
  };
  const name = f.name.value.trim();
  const email = f.email.value.trim();
  const phone = f.phone.value.trim() ? normalizePhone(f.phone.value) : '';
  const message = f.message.value.trim();
  if (name.length < 2) return fail('اكتب اسمك.');
  if (!email && !phone) return fail('اكتب إيميلك أو رقم جوالك حتى نقدر نرد عليك.');
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return fail('الإيميل غير صحيح.');
  if (phone && !/^9665\d{8}$/.test(phone)) return fail('رقم الجوال لازم يكون سعودي، مثل 05xxxxxxxx.');
  if (message.length < 5) return fail('اكتب استفسارك.');
  const btn = form.querySelector('[type="submit"]');
  btn.disabled = true;
  try {
    // الحقل المخفي يعبّيه البوت فقط: نتظاهر بالنجاح بدون إرسال
    if (!f.website.value) await submitContact({ name, email, phone, topic: f.topic.value, message });
    form.querySelector('.report-body').hidden = true;
    form.querySelector('.report-done').hidden = false;
  } catch (err) {
    fail(err.message);
  } finally {
    btn.disabled = false;
  }
  return undefined;
});
