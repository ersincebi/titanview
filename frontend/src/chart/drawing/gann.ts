import type { DrawingObject } from '../../types/market';
import { allPx, extendRay, line, mk, text, type Px, type ToolMapper } from './svg';

/** Standart Gann kutusu / karesi seviyeleri ve renkleri. */
export const GANN_LEVELS: Array<{ level: number; color: string }> = [
  { level: 0, color: '#787B86' },
  { level: 0.25, color: '#FF9800' },
  { level: 0.382, color: '#00BCD4' },
  { level: 0.5, color: '#4CAF50' },
  { level: 0.618, color: '#089981' },
  { level: 0.75, color: '#0284C7' },
  { level: 1, color: '#787B86' },
];

/** Gann yelpazesi oranları (fiyat/zaman); 1/1 = p0→p1. */
export const GANN_FAN_RATIOS: Array<{ label: string; price: number; time: number; color: string }> = [
  { label: '8/1', price: 8, time: 1, color: '#FF9800' },
  { label: '4/1', price: 4, time: 1, color: '#4CAF50' },
  { label: '3/1', price: 3, time: 1, color: '#089981' },
  { label: '2/1', price: 2, time: 1, color: '#00BCD4' },
  { label: '1/1', price: 1, time: 1, color: '#0284C7' },
  { label: '1/2', price: 1, time: 2, color: '#9C27B0' },
  { label: '1/3', price: 1, time: 3, color: '#E91E63' },
  { label: '1/4', price: 1, time: 4, color: '#F23645' },
  { label: '1/8', price: 1, time: 8, color: '#787B86' },
];

export function gannFanDirections(a: Px, b: Px): Array<{ label: string; to: Px; color: string }> {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return GANN_FAN_RATIOS.map((r) => ({ label: r.label, color: r.color, to: { x: a.x + dx * r.time, y: a.y + dy * r.price } }));
}

export function renderGannFan(d: DrawingObject, m: ToolMapper, g: SVGElement, w: number, h: number): void {
  const p = allPx(m, d, Math.min(2, d.points.length));
  if (!p || p.length < 2) return;
  const [a, b] = p;
  const dirs = gannFanDirections(a, b);
  for (let i = 0; i < dirs.length; i++) {
    const r = extendRay(a, dirs[i].to, 'right', w, h);
    if (i > 0) {
      const q = extendRay(a, dirs[i - 1].to, 'right', w, h);
      mk('polygon', { points: `${a.x},${a.y} ${q[1].x},${q[1].y} ${r[1].x},${r[1].y}`, fill: dirs[i].color, 'fill-opacity': 0.08, stroke: 'none' }, g);
    }
    line(g, r[0], r[1], dirs[i].color, 1).setAttribute('data-ratio', dirs[i].label);
    // etiket: yönün kısa bir ilerisine
    const len = Math.hypot(dirs[i].to.x - a.x, dirs[i].to.y - a.y) || 1;
    const k = Math.min(1, 90 / len);
    text(g, a.x + (dirs[i].to.x - a.x) * k + 3, a.y + (dirs[i].to.y - a.y) * k - 3, dirs[i].label, dirs[i].color, 10);
  }
}

/** p0-p1 dikdörtgeninde seviyelerin piksel konumları (x: zaman, y: fiyat). */
export function gannGrid(a: Px, b: Px): { xs: Array<{ level: number; v: number; color: string }>; ys: Array<{ level: number; v: number; color: string }> } {
  return {
    xs: GANN_LEVELS.map((l) => ({ level: l.level, color: l.color, v: a.x + (b.x - a.x) * l.level })),
    ys: GANN_LEVELS.map((l) => ({ level: l.level, color: l.color, v: a.y + (b.y - a.y) * l.level })),
  };
}

export function renderGannBox(d: DrawingObject, m: ToolMapper, g: SVGElement): void {
  const p = allPx(m, d, Math.min(2, d.points.length));
  if (!p || p.length < 2) return;
  drawGannGrid(g, p[0], p[1], true);
}

function drawGannGrid(g: SVGElement, a: Px, b: Px, fills: boolean): void {
  const { xs, ys } = gannGrid(a, b);
  const left = Math.min(a.x, b.x);
  const right = Math.max(a.x, b.x);
  const top = Math.min(a.y, b.y);
  const bottom = Math.max(a.y, b.y);
  if (fills) {
    for (let i = 1; i < xs.length; i++) {
      const x0 = Math.min(xs[i - 1].v, xs[i].v);
      mk('rect', { x: x0, y: top, width: Math.abs(xs[i].v - xs[i - 1].v), height: bottom - top, fill: xs[i].color, 'fill-opacity': 0.06, stroke: 'none' }, g);
    }
    for (let i = 1; i < ys.length; i++) {
      const y0 = Math.min(ys[i - 1].v, ys[i].v);
      mk('rect', { x: left, y: y0, width: right - left, height: Math.abs(ys[i].v - ys[i - 1].v), fill: ys[i].color, 'fill-opacity': 0.06, stroke: 'none' }, g);
    }
  }
  for (const x of xs) {
    line(g, { x: x.v, y: top }, { x: x.v, y: bottom }, x.color, 1).setAttribute('data-gx', String(x.level));
    text(g, x.v, bottom + 12, String(x.level), x.color, 9, 'middle');
  }
  for (const y of ys) {
    line(g, { x: left, y: y.v }, { x: right, y: y.v }, y.color, 1).setAttribute('data-gy', String(y.level));
    text(g, left - 4, y.v + 3, String(y.level), y.color, 9, 'end');
  }
}

/** Sabit Gann karesi: ikinci nokta ekranda kare olacak şekilde düzeltilir (kenar = |dx|). */
export function squareFixedCorner(a: Px, b: Px): Px {
  const side = Math.abs(b.x - a.x);
  return { x: b.x, y: a.y + (b.y >= a.y ? side : -side) };
}

export function renderGannSquare(fixed: boolean) {
  return (d: DrawingObject, m: ToolMapper, g: SVGElement): void => {
    const p = allPx(m, d, Math.min(2, d.points.length));
    if (!p || p.length < 2) return;
    const a = p[0];
    const b = fixed ? squareFixedCorner(p[0], p[1]) : p[1];
    drawGannGrid(g, a, b, false);
    const color = d.color || '#0284C7';
    const { xs, ys } = gannGrid(a, b);
    // yelpaze: köşeden karşı kenarlardaki seviye noktalarına
    for (const x of xs) if (x.level > 0) line(g, a, { x: x.v, y: b.y }, x.color, 1).setAttribute('data-sq-fan', `t${x.level}`);
    for (const y of ys) if (y.level > 0 && y.level < 1) line(g, a, { x: b.x, y: y.v }, y.color, 1).setAttribute('data-sq-fan', `p${y.level}`);
    // ters köşegen
    line(g, { x: a.x, y: b.y }, { x: b.x, y: a.y }, color, 1, '4,3');
    // yaylar: köşe a merkezli, yarıçap seviye × kenar (elips: x ve y kenarları ayrı)
    const rx = Math.abs(b.x - a.x);
    const ry = Math.abs(b.y - a.y);
    const sx = Math.sign(b.x - a.x) || 1;
    const sy = Math.sign(b.y - a.y) || 1;
    // yay bantları (dıştan içe dolgu), kare içine kırpılır
    const clipId = `gsq-${Math.round(a.x)}-${Math.round(a.y)}-${Math.round(b.x)}-${Math.round(b.y)}`;
    const cp = mk('clipPath', { id: clipId }, g);
    mk('rect', { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: rx, height: ry }, cp);
    const bands = mk('g', { 'clip-path': `url(#${clipId})` }, g);
    for (let i = GANN_LEVELS.length - 1; i >= 1; i--) {
      const l = GANN_LEVELS[i];
      mk('ellipse', { cx: a.x, cy: a.y, rx: rx * l.level, ry: ry * l.level, fill: l.color, 'fill-opacity': 0.2, stroke: 'none' }, bands);
    }
    for (const l of GANN_LEVELS) {
      if (l.level <= 0) continue;
      const from = { x: a.x + sx * rx * l.level, y: a.y };
      const to = { x: a.x, y: a.y + sy * ry * l.level };
      const sweep = sx * sy > 0 ? 1 : 0;
      mk('path', { d: `M${from.x},${from.y} A${rx * l.level},${ry * l.level} 0 0 ${sweep} ${to.x},${to.y}`, fill: 'none', stroke: l.color, 'stroke-width': 1, 'data-sq-arc': String(l.level) }, g);
    }
  };
}
