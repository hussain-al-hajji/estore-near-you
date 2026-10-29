import { SA_CENTER, SA_ZOOM } from './constants.js';
import { escapeHtml } from './utils.js';
import { logMapUsage } from './api.js';

// نعدّ المربعات المحمّلة ونرسلها دفعة كل دقيقة وعند مغادرة الصفحة (بدل طلب لكل مربع)
let pendingTiles = 0;
let reportedOpen = false;
let flushTimer = 0;
function flushTiles() {
  clearTimeout(flushTimer);
  flushTimer = 0;
  if (!pendingTiles) return;
  logMapUsage(Math.min(pendingTiles, 600), !reportedOpen);
  reportedOpen = true;
  pendingTiles = 0;
}
addEventListener('pagehide', flushTiles);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushTiles(); });
function countTile() {
  pendingTiles += 1;
  flushTimer ||= setTimeout(flushTiles, 60000);
}

export function createMap(elementId, { count = true } = {}) {
  const map = L.map(elementId, { zoomControl: false, attributionControl: false }).setView(SA_CENTER, SA_ZOOM);
  L.control.zoom({ position: 'topleft', zoomInTitle: 'تكبير', zoomOutTitle: 'تصغير' }).addTo(map);
  L.control.attribution({ position: 'topright', prefix: false }).addTo(map);
  const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    className: 'soft-tiles',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  });
  // قبل addTo: أول مربعات الخريطة تبدأ بالتحميل أثناء الإضافة نفسها
  if (count) tiles.on('tileloadstart', countTile);
  tiles.addTo(map);
  return map;
}

export function pinIcon(kind = 'store', icon = '') {
  return L.divIcon({
    className: `pin pin-${kind}`,
    html: `<span class="pin-body"><i>${escapeHtml(icon || '📍')}</i></span>`,
    iconSize: [40, 48],
    iconAnchor: [20, 46],
    popupAnchor: [0, -42],
  });
}

export const userIcon = L.divIcon({
  className: 'user-dot',
  html: '<span></span>',
  iconSize: [22, 22],
  iconAnchor: [11, 11],
});

export function clusterIcon(cluster) {
  const n = cluster.getChildCount();
  const size = n < 10 ? 40 : n < 50 ? 48 : 56;
  return L.divIcon({
    className: 'cluster',
    html: `<span>${n}</span>`,
    iconSize: [size, size],
  });
}
