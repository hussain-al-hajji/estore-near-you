// موجّه الصفحة الواحدة: # للتصفح، ‎#add لإضافة متجر (و‎#edit لتعديله)، ‎#account لصاحب المتجر، ‎#admin للوحة التحكم.
// كل قسم يُحمَّل كوده عند أول فتح فقط، فالزائر العادي لا يحمّل كود لوحة التحكم.
import { loadSettings } from './settings.js';
import { renderFooters } from './footer.js';

const VIEWS = {
  browse: {
    title: 'دكان الحي | متاجر إلكترونية قريبة منك',
    theme: '#5b2ee6',
    load: () => import('./browse.js'),
  },
  add: {
    title: 'أضف متجرك | دكان الحي',
    theme: '#5b2ee6',
    load: () => import('./add-store.js'),
  },
  legal: {
    title: 'سياسة الخصوصية وشروط الاستخدام | دكان الحي',
    theme: '#5b2ee6',
    load: () => import('./legal.js'),
  },
  account: {
    title: 'متجري | دكان الحي',
    theme: '#5b2ee6',
    load: () => import('./account.js'),
  },
  admin: {
    title: 'لوحة التحكم | دكان الحي',
    theme: '#1c1240',
    load: () => import('./admin.js'),
  },
};

// رابط استعادة كلمة المرور يصل بالشكل #access_token=…&type=recovery
// الروابط القديمة كانت تصل «#account#access_token=…» فما تقدر مكتبة الدخول تقرأها: نشيل «#account» الزائدة
if (/^#[a-z-]+#/.test(location.hash)) history.replaceState(null, '', location.pathname + location.search + location.hash.replace(/^#[a-z-]+/, ''));
window.dukkanRecovery = /type=recovery/.test(location.hash);
// رابط منتهي أو مستخدم سابقًا يرجع بـ #error=…&error_code=…
window.dukkanAuthError = /error_code=/.test(location.hash) ? new URLSearchParams(location.hash.slice(1)).get('error_code') : null;

function viewFor(hash) {
  // مكتبة الدخول تمسح رمز الاستعادة من الرابط (location.hash = '')، فنبقى في صفحة تعيين كلمة المرور
  if (!hash && window.dukkanRecovery) return 'account';
  if (hash === '#add' || hash === '#edit' || hash === '#admin-edit') return 'add';
  if (hash === '#privacy' || hash === '#terms') return 'legal';
  if (hash === '#account' || /access_token=|type=recovery|error_code=/.test(hash)) return 'account';
  if (hash === '#admin' || hash.startsWith('#admin/')) return 'admin';
  return 'browse';
}

let current = null;

async function route() {
  const name = viewFor(location.hash);
  const view = VIEWS[name];
  // التنقل بين #add و#edit يغيّر وضع النموذج، أما تبويبات اللوحة فيعالجها admin.js
  const key = name === 'add' || name === 'legal' ? location.hash : name;
  const changed = key !== current;
  current = key;

  for (const key of Object.keys(VIEWS)) {
    document.getElementById(`screen-${key}`).hidden = key !== name;
  }
  document.body.dataset.view = name;
  document.title = view.title;
  document.querySelector('meta[name="theme-color"]').content = view.theme;
  if (changed) window.scrollTo(0, 0);

  try {
    const mod = await view.load();
    // onShow عند الدخول للقسم فقط (التنقل بين تبويبات اللوحة يعالجه admin.js)، وقد يتغير المسار أثناء التحميل
    if (changed && current === key) mod.onShow?.();
  } catch (err) {
    console.error(err);
    alert(`تعذر فتح الصفحة: ${err.message}`);
  }
}

// زر «راسلنا» في أي صفحة: نحمّل نموذج المراسلة عند أول ضغطة
document.addEventListener('click', async e => {
  const btn = e.target.closest('[data-open-contact]');
  if (!btn) return;
  e.preventDefault();
  (await import('./contact.js')).openContact(btn.dataset.openContact || 'general');
});

// ---- تثبيت التطبيق (PWA) ----
// أندرويد وكروم: نلتقط حدث التثبيت ونعرضه بزر بالتذييل. آيفون: ما فيه حدث، فنعرض خطوات يدوية.
let installPrompt = null;
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
function syncInstallButtons() {
  const visible = !standalone() && (Boolean(installPrompt) || isIos);
  for (const b of document.querySelectorAll('[data-install-app]')) b.hidden = !visible;
}
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  installPrompt = e;
  syncInstallButtons();
});
window.addEventListener('appinstalled', () => {
  installPrompt = null;
  syncInstallButtons();
});
document.addEventListener('click', async e => {
  if (!e.target.closest('[data-install-app]')) return;
  if (installPrompt) {
    installPrompt.prompt();
    await installPrompt.userChoice.catch(() => {});
    installPrompt = null;
    syncInstallButtons();
  } else if (isIos && navigator.share) {
    // آبل ما تسمح بالتثبيت برمجيًا، فنفتح قائمة المشاركة مباشرة وما يبقى على المستخدم غير اختيار «إضافة إلى الشاشة الرئيسية»
    showInstallHint(true);
    try {
      await navigator.share({ title: 'دكان الحي', url: `${location.origin}/` });
    } catch (err) {
      if (err?.name !== 'AbortError') document.getElementById('installDialog')?.showModal();
    }
    showInstallHint(false);
  } else {
    document.getElementById('installDialog')?.showModal();
  }
});

let hintTimer = 0;
function showInstallHint(show) {
  const hint = document.getElementById('installHint');
  if (!hint) return;
  clearTimeout(hintTimer);
  hint.hidden = !show;
  if (show) hintTimer = setTimeout(() => { hint.hidden = true; }, 45000);
}
document.getElementById('installDialog')?.addEventListener('click', e => {
  if (e.target.id === 'installDialog' || e.target.closest('[data-close]')) e.currentTarget.close();
});

// خدمة العمل بدون اتصال (تعمل على https وlocalhost فقط)
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

window.addEventListener('hashchange', route);
await loadSettings();
renderFooters();
syncInstallButtons();
route();
