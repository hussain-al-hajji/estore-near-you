// رسوم بيانية خفيفة بدون مكتبات: أعمدة يومية وقوائم أشرطة أفقية
const NUM = new Intl.NumberFormat('en');
const COMPACT = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
const SHORT_DATE = new Intl.DateTimeFormat('ar-u-ca-gregory-nu-latn', { day: 'numeric', month: 'short' });
const LONG_DATE = new Intl.DateTimeFormat('ar-u-ca-gregory-nu-latn', { weekday: 'long', day: 'numeric', month: 'long' });

export const formatNumber = n => NUM.format(n);
export const formatCompact = n => (n >= 10000 ? COMPACT.format(n) : NUM.format(n));

function parseDay(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function niceMax(v) {
  if (v <= 4) return 4;
  const pow = 10 ** Math.floor(Math.log10(v));
  const step = [1, 2, 2.5, 5, 10].find(s => s * pow >= v / 4) * pow;
  return Math.ceil(v / step) * step;
}

function svgEl(tag, attrs = {}) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

function showTooltip(tooltip, event, value, label) {
  tooltip.replaceChildren();
  const strong = document.createElement('strong');
  strong.textContent = value;
  const span = document.createElement('span');
  span.textContent = label;
  tooltip.append(strong, span);
  tooltip.hidden = false;
  const pad = 14;
  const { innerWidth: vw } = window;
  const rect = tooltip.getBoundingClientRect();
  let x = event.clientX - rect.width / 2;
  x = Math.max(8, Math.min(vw - rect.width - 8, x));
  tooltip.style.left = `${x}px`;
  tooltip.style.top = `${event.clientY - rect.height - pad}px`;
}

/**
 * أعمدة يومية لسلسلة واحدة.
 * points: [{ day: 'YYYY-MM-DD', value }]
 */
export function columnChart(el, points, { unit, tooltip }) {
  el._ro?.disconnect();

  const draw = () => {
    const W = Math.max(280, el.clientWidth);
    const H = 220;
    const m = { t: 24, r: 6, b: 28, l: 34 };
    const iw = W - m.l - m.r;
    const ih = H - m.t - m.b;
    const values = points.map(p => p.value);
    const max = niceMax(Math.max(...values, 1));
    const y = v => m.t + ih - (v / max) * ih;
    const band = iw / points.length;
    const bw = Math.max(2, Math.min(24, band * 0.7));

    const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img', 'aria-label': unit });
    const grid = svgEl('g', { class: 'grid' });
    for (const t of [0, max / 2, max]) {
      grid.append(svgEl('line', { x1: m.l, x2: W - m.r, y1: y(t), y2: y(t) }));
      const label = svgEl('text', { x: m.l - 8, y: y(t) + 4, 'text-anchor': 'end' });
      label.textContent = formatCompact(t);
      grid.append(label);
    }
    svg.append(grid);

    const bars = svgEl('g', { class: 'bars' });
    const hits = svgEl('g', { class: 'hits' });
    const maxIndex = values.lastIndexOf(Math.max(...values));
    const step = Math.ceil(points.length / Math.max(2, Math.min(6, Math.floor(iw / 80))));
    const base = y(0);

    points.forEach((p, i) => {
      const cx = m.l + band * i + band / 2;
      const x = cx - bw / 2;
      const top = y(p.value);
      const h = base - top;
      let bar = null;
      if (p.value > 0) {
        const r = Math.min(4, bw / 2, h);
        bar = svgEl('path', {
          d: `M${x},${base}V${top + r}Q${x},${top} ${x + r},${top}H${x + bw - r}Q${x + bw},${top} ${x + bw},${top + r}V${base}Z`,
        });
        bars.append(bar);
      }
      if (i === maxIndex && p.value > 0) {
        const label = svgEl('text', { x: cx, y: top - 6, 'text-anchor': 'middle', class: 'peak' });
        label.textContent = formatCompact(p.value);
        svg.append(label);
      }
      if ((points.length - 1 - i) % step === 0) {
        // نثبّت التسميات القريبة من الحواف حتى لا تُقص
        const anchor = cx > W - m.r - 28 ? 'end' : cx < m.l + 28 ? 'start' : 'middle';
        const lx = anchor === 'end' ? W - m.r : anchor === 'start' ? m.l : cx;
        const label = svgEl('text', { x: lx, y: H - 8, 'text-anchor': anchor, class: 'x' });
        label.textContent = SHORT_DATE.format(parseDay(p.day));
        svg.append(label);
      }
      const hit = svgEl('rect', { x: m.l + band * i, y: m.t, width: band, height: ih, fill: 'transparent' });
      hit.addEventListener('pointermove', e => {
        bar?.classList.add('hover');
        showTooltip(tooltip, e, `${formatNumber(p.value)} ${unit}`, LONG_DATE.format(parseDay(p.day)));
      });
      hit.addEventListener('pointerleave', () => {
        bar?.classList.remove('hover');
        tooltip.hidden = true;
      });
      hits.append(hit);
    });
    svg.append(bars, hits);
    el.querySelector('svg')?.remove();
    el.prepend(svg);
  };

  // جدول بديل لنفس البيانات (للوصولية والقراءة الدقيقة)
  el.replaceChildren();
  const details = document.createElement('details');
  details.className = 'table-view';
  const summary = document.createElement('summary');
  summary.textContent = 'عرض كجدول';
  const table = document.createElement('table');
  for (const p of [...points].reverse()) {
    const tr = table.insertRow();
    tr.insertCell().textContent = LONG_DATE.format(parseDay(p.day));
    tr.insertCell().textContent = formatNumber(p.value);
  }
  details.append(summary, table);
  el.append(details);

  let lastWidth = el.clientWidth;
  draw();
  el._ro = new ResizeObserver(() => {
    if (el.clientWidth === lastWidth) return;
    lastWidth = el.clientWidth;
    draw();
  });
  el._ro.observe(el);
}

/**
 * قائمة أشرطة أفقية مرتبة.
 * rows: [{ label, value, icon? }]
 */
export function barList(el, rows, { empty = 'لا توجد بيانات بعد' } = {}) {
  el.replaceChildren();
  if (!rows.length) {
    const p = document.createElement('p');
    p.className = 'muted empty';
    p.textContent = empty;
    el.append(p);
    return;
  }
  const max = Math.max(...rows.map(r => r.value), 1);
  for (const r of rows) {
    const row = document.createElement('div');
    row.className = 'bar-row';
    const label = document.createElement('span');
    label.className = 'bar-label';
    label.textContent = r.icon ? `${r.icon} ${r.label}` : r.label;
    label.title = r.label;
    const track = document.createElement('span');
    track.className = 'bar-track';
    const fill = document.createElement('span');
    fill.className = 'bar-fill';
    fill.style.width = `${Math.max(2, (r.value / max) * 100)}%`;
    track.append(fill);
    const value = document.createElement('span');
    value.className = 'bar-value';
    value.textContent = formatNumber(r.value);
    row.append(label, track, value);
    el.append(row);
  }
}
