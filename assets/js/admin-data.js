import { isDemo, demoAllStores, DEMO_KEYS, demoPerformance, demoApplyEdit } from './api.js';
import { getClient, authErrorMessage } from './supabase-client.js';
import { storage, dayKey } from './utils.js';
import { SETTINGS } from './settings.js';
import { registrationDay } from './billing.js';

export async function createBackend() {
  return isDemo ? demoBackend() : liveBackend(await getClient());
}

function flattenOwner(s) {
  const { store_owners: o, ...rest } = s;
  return { ...rest, owner: (Array.isArray(o) ? o[0] : o) || null };
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
    isAdmin: async () => check(await sb.rpc('is_admin')) === true,
    stores: async () => check(await sb.from('stores').select('*, store_owners(*), store_locations(*)')
      .order('created_at', { ascending: false })).map(flattenOwner),
    eventStats: async days => check(await sb.rpc('admin_event_stats', { p_days: days })),
    update: async (id, patch) => { check(await sb.from('stores').update(patch).eq('id', id)); },
    remove: async id => { check(await sb.from('stores').delete().eq('id', id)); },
    payments: async () => check(await sb.from('payments').select('*').order('created_at', { ascending: false })),
    recordPayment: async (id, amount, note) =>
      check(await sb.rpc('admin_record_payment', { p_store: id, p_amount: amount, p_note: note || null })),
    saveSettings: async data => {
      check(await sb.from('site_settings').update({ data, updated_at: new Date().toISOString() }).eq('id', 1));
    },
    edits: async () => check(await sb.from('store_edits').select('*').eq('status', 'pending')),
    reviewEdit: async (id, approve, note) => {
      check(await sb.rpc('admin_review_edit', { p_edit: id, p_approve: approve, p_note: note || null }));
    },
    performance: async (id, days) => check(await sb.rpc('store_performance', { p_store: id, p_days: days })),
    adminSettings: async () => check(await sb.from('admin_settings').select('data').eq('id', 1).maybeSingle())?.data || {},
    saveAdminSettings: async data => {
      check(await sb.from('admin_settings').update({ data, updated_at: new Date().toISOString() }).eq('id', 1));
    },
  };
}

// ---- الوضع التجريبي ----

const DEMO_NAMES = ['نورة', 'فهد', 'ريم', 'عبدالله', 'سارة', 'محمد', 'لمى', 'خالد', 'هيا', 'علي', 'مريم', 'حسن', 'أمل', 'زينب'];

// رقم شبه عشوائي ثابت لنفس النص، حتى تبقى الأرقام التجريبية ثابتة بين التحديثات
function seeded(text) {
  let h = 2166136261;
  for (const ch of text) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295;
}

function fakeOwner(s, i) {
  const r = seeded(s.id);
  return {
    owner_name: DEMO_NAMES[Math.floor(r * DEMO_NAMES.length)],
    phone: `9665${String(Math.floor(r * 1e8)).padStart(8, '0')}`,
    email: `owner${i + 1}@example.com`,
    cr_number: r > 0.5 ? `FL-${Math.floor(r * 1e6)}` : null,
    registrant_role: r > 0.7 ? 'employee' : 'owner',
    registrant_title: r > 0.7 ? 'مسؤول المبيعات' : null,
  };
}

function demoStats(days, stores) {
  const real = storage(DEMO_KEYS.events) || { days: {}, stores: {} };
  const daily = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const day = dayKey(d);
    const weekend = d.getDay() === 4 || d.getDay() === 5 ? 1.3 : 1;
    const visits = Math.round((70 + (120 - Math.min(i, 120)) * 0.7 + seeded(day) * 40) * weekend);
    const clicks = Math.round(visits * (0.14 + seeded(`${day}c`) * 0.1));
    daily.push({
      day,
      visits: visits + (real.days[day]?.visits || 0),
      clicks: clicks + (real.days[day]?.clicks || 0),
    });
  }
  const totalClicks = daily.reduce((n, d) => n + d.clicks, 0);
  const approved = stores.filter(s => s.status === 'approved');
  const weights = approved.map(s => seeded(`${s.id}w`) ** 2);
  const sum = weights.reduce((a, b) => a + b, 0) || 1;
  const store_clicks = approved
    .map((s, i) => ({ store_id: s.id, clicks: Math.round((totalClicks * weights[i]) / sum) + (real.stores[s.id] || 0) }))
    .sort((a, b) => b.clicks - a.clicks);
  return { daily, store_clicks };
}

function demoBackend() {
  const SESSION = 'dukkan.demoSession';
  const updateAdmin = fn => {
    const admin = storage(DEMO_KEYS.admin) || {};
    fn(admin);
    storage(DEMO_KEYS.admin, admin);
  };
  return {
    demo: true,
    session: async () => storage(SESSION),
    signIn: async () => storage(SESSION, { email: 'admin@demo' }),
    async signOut() {
      try { localStorage.removeItem(SESSION); } catch { /* لا شيء */ }
    },
    isAdmin: async () => true,
    async stores() {
      const owners = storage(DEMO_KEYS.owners) || {};
      return (await demoAllStores()).map((s, i) => ({ ...s, owner: owners[s.id] || fakeOwner(s, i) }));
    },
    async eventStats(days) {
      return demoStats(days, await this.stores());
    },
    async update(id, patch) {
      updateAdmin(admin => {
        (admin.patch ||= {})[id] = { ...(admin.patch[id] || {}), ...patch };
      });
    },
    async remove(id) {
      updateAdmin(admin => { (admin.deleted ||= []).push(id); });
    },
    payments: async () => storage(DEMO_KEYS.payments) || [],
    // نفس منطق admin_record_payment في قاعدة البيانات
    async recordPayment(id, amount, note) {
      const s = (await this.stores()).find(x => x.id === id);
      const launch = SETTINGS.pricing.launch_end;
      const registered = registrationDay(s.created_at);
      const start = s.paid_until || (registered > launch ? registered : launch);
      const end = `${Number(start.slice(0, 4)) + 1}${start.slice(4)}`;
      const payments = storage(DEMO_KEYS.payments) || [];
      payments.unshift({
        id: Date.now(), store_id: id, amount, period_start: start, period_end: end,
        note: note || null, created_at: new Date().toISOString(),
      });
      storage(DEMO_KEYS.payments, payments);
      const patch = { paid_until: end };
      if (s.status === 'suspended') Object.assign(patch, { status: 'approved', approved_at: new Date().toISOString() });
      await this.update(id, patch);
      return end;
    },
    edits: async () => (storage(DEMO_KEYS.edits) || []).filter(e => e.status === 'pending'),
    async reviewEdit(id, approve, note) {
      const edits = storage(DEMO_KEYS.edits) || [];
      const edit = edits.find(e => e.id === id);
      if (approve) await demoApplyEdit(edit);
      Object.assign(edit, { status: approve ? 'approved' : 'rejected', admin_note: note || null, reviewed_at: new Date().toISOString() });
      storage(DEMO_KEYS.edits, edits);
    },
    performance: async (id, days) => demoPerformance(id, days),
    saveSettings: async data => { storage(DEMO_KEYS.settings, data); },
    adminSettings: async () => storage(DEMO_KEYS.adminSettings) || {},
    saveAdminSettings: async data => { storage(DEMO_KEYS.adminSettings, data); },
  };
}
