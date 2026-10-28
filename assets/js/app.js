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
window.dukkanRecovery = /type=recovery/.test(location.hash);

function viewFor(hash) {
  if (hash === '#add' || hash === '#edit') return 'add';
  if (hash === '#privacy' || hash === '#terms') return 'legal';
  if (hash === '#account' || /access_token=|type=recovery/.test(hash)) return 'account';
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

window.addEventListener('hashchange', route);
await loadSettings();
renderFooters();
route();
