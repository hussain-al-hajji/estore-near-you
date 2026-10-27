// موجّه الصفحة الواحدة: # للتصفح، ‎#add لإضافة متجر، ‎#admin للوحة التحكم.
// كل قسم يُحمَّل كوده عند أول فتح فقط، فالزائر العادي لا يحمّل كود لوحة التحكم.
import { isDemo } from './api.js';
import { loadSettings } from './settings.js';
import { renderFooters } from './footer.js';

const SUPABASE_JS = {
  src: 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.112.4/dist/umd/supabase.js',
  integrity: 'sha384-ysv13JVP3fufiEXfjML9OdCa/rRbMJvUBOWyor82wfuK8INNZAvmbxHgKIHi+oqz',
};

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
  admin: {
    title: 'لوحة التحكم | دكان الحي',
    theme: '#1c1240',
    load: async () => {
      if (!isDemo) await loadScript(SUPABASE_JS);
      return import('./admin.js');
    },
  },
};

function loadScript({ src, integrity }) {
  if (window.supabase) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.integrity = integrity;
    s.crossOrigin = 'anonymous';
    s.onload = resolve;
    s.onerror = () => reject(new Error('تعذر تحميل مكتبة تسجيل الدخول'));
    document.head.append(s);
  });
}

function viewFor(hash) {
  if (hash === '#add') return 'add';
  if (hash === '#admin' || hash.startsWith('#admin/')) return 'admin';
  return 'browse';
}

let current = null;

async function route() {
  const name = viewFor(location.hash);
  const view = VIEWS[name];
  const changed = name !== current;
  current = name;

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
    if (changed && current === name) mod.onShow?.();
  } catch (err) {
    console.error(err);
    alert(`تعذر فتح الصفحة: ${err.message}`);
  }
}

window.addEventListener('hashchange', route);
await loadSettings();
renderFooters();
route();
