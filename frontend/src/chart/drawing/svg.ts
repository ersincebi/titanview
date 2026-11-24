import type { Candle, DrawingObject, TimePricePoint } from '../../types/market';
import type { CoordinateMapper } from './TrendlineTool';

/** Faz 21 çizim araçlarının ortak SVG yardımcıları. */
export const NS = 'http://www.w3.org/2000/svg';
export const FONT = "-apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, Ubuntu, sans-serif";

export type ToolMapper = CoordinateMapper & { getCandles?: () => Candle[] };

export interface Px {
  x: number;
  y: number;
}

export function mk<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number>,
  parent: Element
): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  parent.appendChild(e);
  return e;
}

export function toPx(m: CoordinateMapper, p: TimePricePoint): Px | null {
  const x = m.timeToX(p.time);
  const y = m.priceToY(p.price);
  return x === null || y === null ? null : { x, y };
}

/** Tüm noktaları piksele çevirir; biri bile eksenden düşerse null. */
export function allPx(m: CoordinateMapper, d: DrawingObject, n = d.points.length): Px[] | null {
  if (d.points.length < n) return null;
  const out: Px[] = [];
  for (let i = 0; i < n; i++) {
    const p = toPx(m, d.points[i]);
    if (!p) return null;
    out.push(p);
  }
  return out;
}

export function line(g: Element, a: Px, b: Px, color: string, width = 1, dash?: string): SVGLineElement {
  const attrs: Record<string, string | number> = { x1: a.x, y1: a.y, x2: b.x, y2: b.y, stroke: color, 'stroke-width': width };
  if (dash) attrs['stroke-dasharray'] = dash;
  return mk('line', attrs, g);
}

export function text(g: Element, x: number, y: number, s: string, color: string, size = 11, anchor = 'start'): SVGTextElement {
  const t = mk('text', { x, y, fill: color, 'font-size': size, 'font-family': FONT, 'text-anchor': anchor }, g);
  t.textContent = s;
  return t;
}

export function poly(g: Element, pts: Px[], attrs: Record<string, string | number>): SVGPolygonElement {
  return mk('polygon', { points: pts.map((p) => `${p.x},${p.y}`).join(' '), ...attrs }, g);
}

/** a→b doğrusunu ekrana kadar uzatır (dir: 'right' = yalnız b yönü, 'both' = iki yön). */
export function extendRay(a: Px, b: Px, dir: 'right' | 'both', w: number, h: number): [Px, Px] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return [a, b];
  const far = (Math.hypot(w, h) + Math.hypot(a.x, a.y) + 10) / len;
  const end = { x: a.x + dx * far, y: a.y + dy * far };
  const start = dir === 'both' ? { x: a.x - dx * far, y: a.y - dy * far } : a;
  return [start, end];
}

export function fmtPrice(n: number): string {
  const a = Math.abs(n);
  return a >= 1000 ? n.toFixed(1) : a >= 1 ? n.toFixed(2) : n.toFixed(4);
}

/** Standart Fib çizimlerinin varsayılan seviye renkleri. */
export const TV_FIB_COLORS: Record<string, string> = {
  '0': '#787B86',
  '0.236': '#F23645',
  '0.382': '#FF9800',
  '0.5': '#4CAF50',
  '0.618': '#089981',
  '0.786': '#00BCD4',
  '1': '#787B86',
  '1.618': '#0284C7',
  '2.618': '#F23645',
  '3.618': '#9C27B0',
  '4.236': '#E91E63',
};
const EXTRA = ['#0284C7', '#089981', '#FF9800', '#9C27B0', '#00BCD4', '#F23645', '#4CAF50', '#E91E63'];

export function fibColor(level: number, i = 0): string {
  return TV_FIB_COLORS[String(level)] ?? EXTRA[i % EXTRA.length];
}

/** Şeffaf, kalın tıklama yüzeyi (ince çizgiler/açık şekiller için). */
export function hitPath(g: Element, dPath: string): void {
  const e = mk('path', { d: dPath, stroke: 'transparent', 'stroke-width': 10, fill: 'none', 'data-keep-style': '1', class: 'drawing-hit' }, g);
  (e as SVGElement).style.pointerEvents = 'stroke';
}
