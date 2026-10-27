import { SA_CENTER, SA_ZOOM } from './constants.js';

export function createMap(elementId) {
  const map = L.map(elementId, { zoomControl: false }).setView(SA_CENTER, SA_ZOOM);
  L.control.zoom({ position: 'topleft' }).addTo(map);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);
  return map;
}

export function pinIcon(kind = 'store') {
  return L.divIcon({
    className: `pin pin-${kind}`,
    html: '<span></span>',
    iconSize: [28, 36],
    iconAnchor: [14, 34],
    popupAnchor: [0, -30],
  });
}

export const userIcon = L.divIcon({
  className: 'user-dot',
  html: '<span></span>',
  iconSize: [20, 20],
  iconAnchor: [10, 10],
});
