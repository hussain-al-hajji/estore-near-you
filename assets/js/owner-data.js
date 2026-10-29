// بيانات صفحة «متجري» لصاحب المتجر: الدخول، متاجره، أداؤها، وطلبات التعديل
import { isDemo, demoAllStores, DEMO_KEYS, demoPerformance } from './api.js';
import { getClient, authErrorMessage } from './supabase-client.js';
import { storage } from './utils.js';
import { demoOwnerAds, demoSubmitAd, demoUpdateAd, demoAdMessage, demoCancelAd } from './ads-demo.js';

export async function createOwnerBackend() {
  return isDemo ? demoBackend() : liveBackend(await getClient());
}

function liveBackend(sb) {
  const check = ({ data, error }) => {
    if (error) throw new Error(error.message);
    return data;
  };
  return {
    demo: false,
    async session() {
      const { data } = await sb.auth.getSession();
      return data.session ? { email: data.session.user.email } : null;
    },
    async signIn(email, password) {
      const { data, error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw new Error(authErrorMessage(error.message));
      return { email: data.user.email };
    },
    signOut: () => sb.auth.signOut(),
    dashboard: async () => check(await sb.rpc('owner_dashboard')) || [],
    performance: async (id, days) => check(await sb.rpc('store_performance', { p_store: id, p_days: days })),
    submitEdit: async (id, data) => check(await sb.rpc('owner_submit_edit', { p_store: id, p_data: data })),
    ads: async storeId => check(await sb.rpc('owner_ads', { p_store: storeId })) || [],
    submitAd: async (storeId, d) => check(await sb.rpc('owner_submit_ad', {
      p_store: storeId, p_kind: d.kind, p_regions: d.regions, p_starts: d.starts_on, p_days: d.days,
      p_link: d.link_url || null, p_image: d.image || null, p_note: d.note || null,
    })),
    updateAd: async (id, d) => check(await sb.rpc('owner_update_ad', {
      p_id: id, p_kind: d.kind, p_regions: d.regions, p_starts: d.starts_on, p_days: d.days,
      p_link: d.link_url || null, p_image: d.image || null, p_note: d.note || null,
    })),
    adMessage: async (id, body) => check(await sb.rpc('owner_ad_message', { p_id: id, p_body: body })),
    cancelAd: async id => check(await sb.rpc('owner_cancel_ad', { p_id: id })),
    // بدون #account: Supabase يضيف «#access_token=…» للرابط، ووجود # ثانية يخرّب قراءته
    async resetPassword(email) {
      const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}${location.pathname}` });
      if (error) throw new Error(authErrorMessage(error.message));
    },
    async updatePassword(password) {
      const { error } = await sb.auth.updateUser({ password });
      if (error) throw new Error(authErrorMessage(error.message));
    },
    onRecovery(callback) {
      sb.auth.onAuthStateChange(event => {
        if (event === 'PASSWORD_RECOVERY') callback();
      });
    },
  };
}

// ---- الوضع التجريبي ----
// «دخول تجريبي» يدخل كصاحب متجر «حلويات بيت الجدة»، ومن سجّل متجرًا من النموذج يدخل بإيميله

const DEMO_OWNER = 'demo-owner@example.com';

function demoBackend() {
  const sessionEmail = () => storage(DEMO_KEYS.ownerSession);
  return {
    demo: true,
    session: async () => (sessionEmail() ? { email: sessionEmail() } : null),
    async signIn(email, password) {
      if (!email) {
        storage(DEMO_KEYS.ownerSession, DEMO_OWNER);
        return { email: DEMO_OWNER };
      }
      const accounts = storage(DEMO_KEYS.accounts) || {};
      if (accounts[email] !== password) throw new Error('الإيميل أو كلمة المرور غير صحيحة.');
      storage(DEMO_KEYS.ownerSession, email);
      return { email };
    },
    async signOut() {
      try { localStorage.removeItem(DEMO_KEYS.ownerSession); } catch { /* لا شيء */ }
    },
    async dashboard() {
      const email = sessionEmail();
      const owners = storage(DEMO_KEYS.owners) || {};
      const edits = storage(DEMO_KEYS.edits) || [];
      const payments = storage(DEMO_KEYS.payments) || [];
      return (await demoAllStores())
        .filter(s => s.owner_email === email || (email === DEMO_OWNER && s.id === 'demo-01'))
        .map(s => ({
          store: s,
          owner: owners[s.id] || { owner_name: 'صاحب المتجر', phone: '966500000000', email, registrant_role: 'owner' },
          locations: s.store_locations || [{ lat: s.lat, lng: s.lng, region: s.region, city: s.city, district: s.district, position: 0 }],
          edit: edits.filter(e => e.store_id === s.id).at(-1) || null,
          payments: payments.filter(p => p.store_id === s.id),
        }));
    },
    performance: async (id, days) => demoPerformance(id, days),
    ads: demoOwnerAds,
    submitAd: demoSubmitAd,
    updateAd: demoUpdateAd,
    adMessage: demoAdMessage,
    cancelAd: demoCancelAd,
    async submitEdit(id, data) {
      const [item] = (await this.dashboard()).filter(x => x.store.id === id);
      if (!item) throw new Error('غير مصرح');
      if (!['approved', 'suspended'].includes(item.store.status)) throw new Error('تقدر تعدّل بيانات متجرك بعد اعتماده');
      const edits = (storage(DEMO_KEYS.edits) || []).filter(e => !(e.store_id === id && e.status === 'pending'));
      const edit = { id: Date.now(), store_id: id, data, status: 'pending', created_at: new Date().toISOString() };
      storage(DEMO_KEYS.edits, [...edits, edit]);
      return edit.id;
    },
    async resetPassword() {
      throw new Error('استعادة كلمة المرور تعمل بعد ربط المنصة بقاعدة البيانات.');
    },
    async updatePassword(password) {
      const accounts = storage(DEMO_KEYS.accounts) || {};
      storage(DEMO_KEYS.accounts, { ...accounts, [sessionEmail()]: password });
    },
    onRecovery() {},
  };
}
