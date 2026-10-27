import { SA_CENTER, SA_ZOOM } from './constants.js';
import { escapeHtml } from './utils.js';

export function createMap(elementId) {
  const map = L.map(elementId, { zoomControl: false, attributionControl: false }).setView(SA_CENTER, SA_ZOOM);
  L.control.zoom({ position: 'topleft', zoomInTitle: 'تكبير', zoomOutTitle: 'تصغير' }).addTo(map);
  L.control.attribution({ position: 'topright', prefix: false }).addTo(map);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    className: 'soft-tiles',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);
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
