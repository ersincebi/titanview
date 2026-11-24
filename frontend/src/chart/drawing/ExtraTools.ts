import type { Candle, DrawingObject, TimePricePoint } from '../../types/market';
import { clipLine } from '../ScriptLayer';
import type { CoordinateMapper } from './TrendlineTool';

const NS = 'http://www.w3.org/2000/svg';

function mk<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number>,
  parent: Element
): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  parent.appendChild(e);
  return e;
}

import { computeProfile } from '../profile';
import { VP_COLORS } from '../profilePrimitives';

export type ExtraMapper = CoordinateMapper & { getCandles?: () => Candle[] };

interface Px {
  x: number;
  y: number;
}

function px(m: CoordinateMapper, p: TimePricePoint): Px | null {
  const x = m.timeToX(p.time);
  const y = m.priceToY(p.price);
  return x === null || y === null ? null : { x, y };
}

function badge(parent: Element, x: number, y: number, text: string, color: string): void {
  const w = text.length * 6.6 + 14;
  mk('rect', { x: x - w / 2, y: y - 10, width: w, height: 20, rx: 4, fill: '#1E222D', stroke: color }, parent);
  const t = mk(
    'text',
    { x, y: y + 4, 'text-anchor': 'middle', fill: color, 'font-size': 10.5, 'font-family': "-apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, Ubuntu, sans-serif", 'font-weight': 700 },
    parent
  );
  t.textContent = text;
}

export function fmt(n: number): string {
  const a = Math.abs(n);
  return a >= 1000 ? n.toFixed(1) : a >= 1 ? n.toFixed(2) : n.toFixed(4);
}

/** Yatay ışın: noktadan sağa doğru sonsuz. */
export function renderHRay(d: DrawingObject, m: CoordinateMapper, g: SVGElement, w: number): void {
  const a = px(m, d.points[0]);
  if (!a) return;
  const color = d.color || '#FFD54F';
  mk('line', { x1: a.x, y1: a.y, x2: w, y2: a.y, stroke: color, 'stroke-width': 1.5 }, g);
  mk('circle', { cx: a.x, cy: a.y, r: 4, fill: color, stroke: '#FFFFFF' }, g);
  badge(g, Math.max(40, w - 50), a.y - 12, fmt(d.points[0].price), color);
}

/** Uzatılmış çizgi (iki yönde sonsuz) veya ok. */
export function renderExtendedOrArrow(d: DrawingObject, m: CoordinateMapper, g: SVGElement, w: number): void {
  if (d.points.length < 2) return;
  const a = px(m, d.points[0]);
  const b = px(m, d.points[1]);
  if (!a || !b) return;
  const color = d.color || '#0284C7';
  if (d.toolType === 'extended') {
    const seg = clipLine(a, b, 'both', w);
    if (seg) mk('line', { x1: seg[0].x, y1: seg[0].y, x2: seg[1].x, y2: seg[1].y, stroke: color, 'stroke-width': 2 }, g);
    mk('circle', { cx: a.x, cy: a.y, r: 4, fill: color, stroke: '#FFFFFF' }, g);
    mk('circle', { cx: b.x, cy: b.y, r: 4, fill: color, stroke: '#FFFFFF' }, g);
    return;
  }
  // arrow
  mk('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, stroke: color, 'stroke-width': 3, 'stroke-linecap': 'round' }, g);
  const ang = Math.atan2(b.y - a.y, b.x - a.x);
  const s = 12;
  const p1 = { x: b.x - s * Math.cos(ang - 0.45), y: b.y - s * Math.sin(ang - 0.45) };
  const p2 = { x: b.x - s * Math.cos(ang + 0.45), y: b.y - s * Math.sin(ang + 0.45) };
  mk('polygon', { points: `${b.x},${b.y} ${p1.x},${p1.y} ${p2.x},${p2.y}`, fill: color }, g);
}

/** Bilgi çizgisi: fiyat farkı, %, bar sayısı, açı. */
export function infoLineStats(
  p1: TimePricePoint,
  p2: TimePricePoint,
  candles: Candle[]
): { diff: number; pct: number; bars: number; angle: number } {
  const diff = p2.price - p1.price;
  const pct = p1.price !== 0 ? (diff / p1.price) * 100 : 0;
  const lo = Math.min(p1.time, p2.time);
  const hi = Math.max(p1.time, p2.time);
  const bars = candles.filter((c) => c.time >= lo && c.time <= hi).length;
  return { diff, pct, bars: Math.max(0, bars - 1), angle: 0 };
}

export function renderInfoLine(d: DrawingObject, m: ExtraMapper, g: SVGElement): void {
  if (d.points.length < 2) return;
  const a = px(m, d.points[0]);
  const b = px(m, d.points[1]);
  if (!a || !b) return;
  const color = d.color || '#0284C7';
  mk('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, stroke: color, 'stroke-width': 2 }, g);
  mk('circle', { cx: a.x, cy: a.y, r: 4, fill: color, stroke: '#FFFFFF' }, g);
  mk('circle', { cx: b.x, cy: b.y, r: 4, fill: color, stroke: '#FFFFFF' }, g);
  const st = infoLineStats(d.points[0], d.points[1], m.getCandles?.() ?? []);
  const angle = (-Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
  const sign = st.diff >= 0 ? '+' : '';
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  badge(g, mx, my - 30, `${sign}${fmt(st.diff)} (${sign}${st.pct.toFixed(2)}%)`, color);
  badge(g, mx, my - 8, `${st.bars} bar · ${angle.toFixed(0)}°`, '#B2B5BE');
}

/** Fiyat aralığı: iki fiyat arasında yatay çizgilerle sınırlı dikey ölçüm. */
export function renderPriceRange(d: DrawingObject, m: CoordinateMapper, g: SVGElement, w: number): void {
  if (d.points.length < 2) return;
  const a = px(m, d.points[0]);
  const b = px(m, d.points[1]);
  if (!a || !b) return;
  const up = d.points[1].price >= d.points[0].price;
  const color = d.color || (up ? '#0284C7' : '#F23645');
  const top = Math.min(a.y, b.y);
  const h = Math.max(2, Math.abs(b.y - a.y));
  const x = Math.min(a.x, b.x);
  mk('rect', { x, y: top, width: Math.max(Math.abs(b.x - a.x), 40), height: h, fill: color, 'fill-opacity': 0.14, stroke: 'none' }, g);
  mk('line', { x1: x, y1: a.y, x2: w, y2: a.y, stroke: color, 'stroke-width': 1, 'stroke-dasharray': '4,3' }, g);
  mk('line', { x1: x, y1: b.y, x2: w, y2: b.y, stroke: color, 'stroke-width': 1, 'stroke-dasharray': '4,3' }, g);
  const diff = d.points[1].price - d.points[0].price;
  const pct = d.points[0].price !== 0 ? (diff / d.points[0].price) * 100 : 0;
  const sign = diff >= 0 ? '+' : '';
  badge(g, x + Math.max(Math.abs(b.x - a.x), 40) / 2, top + h / 2, `${sign}${fmt(diff)} (${sign}${pct.toFixed(2)}%)`, color);
}

/** Tarih aralığı: iki zaman arasında bar sayısı ve süre. */
export function renderDateRange(d: DrawingObject, m: ExtraMapper, g: SVGElement, height: number): void {
  if (d.points.length < 2) return;
  const a = px(m, d.points[0]);
  const b = px(m, d.points[1]);
  if (!a || !b) return;
  const color = d.color || '#AB47BC';
  const left = Math.min(a.x, b.x);
  const wd = Math.max(2, Math.abs(b.x - a.x));
  mk('rect', { x: left, y: 0, width: wd, height, fill: color, 'fill-opacity': 0.1, stroke: 'none' }, g);
  mk('line', { x1: a.x, y1: 0, x2: a.x, y2: height, stroke: color, 'stroke-width': 1 }, g);
  mk('line', { x1: b.x, y1: 0, x2: b.x, y2: height, stroke: color, 'stroke-width': 1 }, g);
  const secs = Math.abs(d.points[1].time - d.points[0].time);
  const st = infoLineStats(d.points[0], d.points[1], m.getCandles?.() ?? []);
  badge(g, left + wd / 2, 24, `${st.bars} bar · ${formatDuration(secs)}`, color);
}

export function formatDuration(sec: number): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const mi = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}g ${h}s`;
  if (h > 0) return `${h}s ${mi}dk`;
  return `${mi}dk`;
}

/** Fiyat etiketi: noktada fiyatı gösteren bayrak. */
export function renderPriceLabel(d: DrawingObject, m: CoordinateMapper, g: SVGElement): void {
  const a = px(m, d.points[0]);
  if (!a) return;
  const color = d.color || '#0284C7';
  const text = d.label || fmt(d.points[0].price);
  const w = text.length * 6.8 + 16;
  mk('path', { d: `M${a.x},${a.y} l8,-8 h${w} v16 h-${w} z`, fill: color }, g);
  const t = mk('text', { x: a.x + 14, y: a.y + 4, fill: '#FFFFFF', 'font-size': 11, 'font-family': "-apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, Ubuntu, sans-serif", 'font-weight': 700 }, g);
  t.textContent = text;
}

/**
 * Paralel kanal: 1-2. nokta ana çizgi, 3. nokta çizginin dikey (fiyat) kayması.
 * Üçüncü nokta yokken (önizleme) yalnız ana çizgi çizilir.
 */
export function renderChannel(d: DrawingObject, m: CoordinateMapper, g: SVGElement): void {
  if (d.points.length < 2) return;
  const a = px(m, d.points[0]);
  const b = px(m, d.points[1]);
  if (!a || !b) return;
  const color = d.color || '#00BCD4';
  mk('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, stroke: color, 'stroke-width': 2 }, g);
  if (d.points.length < 3) return;
  const c = px(m, d.points[2]);
  if (!c) return;
  // 3. noktadan geçen paralel: ana doğruya göre dikey kayma
  const slope = b.x !== a.x ? (b.y - a.y) / (b.x - a.x) : 0;
  const yOnMain = a.y + slope * (c.x - a.x);
  const dy = c.y - yOnMain;
  mk('line', { x1: a.x, y1: a.y + dy, x2: b.x, y2: b.y + dy, stroke: color, 'stroke-width': 2 }, g);
  mk('line', { x1: a.x, y1: a.y + dy / 2, x2: b.x, y2: b.y + dy / 2, stroke: color, 'stroke-width': 1, 'stroke-dasharray': '4,4' }, g);
  mk('polygon', { points: `${a.x},${a.y} ${b.x},${b.y} ${b.x},${b.y + dy} ${a.x},${a.y + dy}`, fill: color, 'fill-opacity': 0.08, stroke: 'none' }, g);
}

/**
 * Andrews Pitchfork: P0 = tutma noktası, P1/P2 = karşı pivotlar.
 * Medyan çizgi P0'dan P1-P2 orta noktasına; iki paralel P1 ve P2'den geçer.
 */
export function pitchforkGeometry(p0: Px, p1: Px, p2: Px): { mid: Px; lines: Array<[Px, Px]> } {
  const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
  const vx = mid.x - p0.x;
  const vy = mid.y - p0.y;
  return {
    mid,
    lines: [
      [p0, mid],
      [p1, { x: p1.x + vx, y: p1.y + vy }],
      [p2, { x: p2.x + vx, y: p2.y + vy }],
    ],
  };
}

export function renderPitchfork(d: DrawingObject, m: CoordinateMapper, g: SVGElement, w: number): void {
  if (d.points.length < 2) return;
  const color = d.color || '#FF9800';
  const p0 = px(m, d.points[0]);
  const p1 = px(m, d.points[1]);
  if (!p0 || !p1) return;
  if (d.points.length < 3) {
    mk('line', { x1: p0.x, y1: p0.y, x2: p1.x, y2: p1.y, stroke: color, 'stroke-width': 2 }, g);
    return;
  }
  const p2 = px(m, d.points[2]);
  if (!p2) return;
  const geo = pitchforkGeometry(p0, p1, p2);
  geo.lines.forEach(([s, e], i) => {
    const seg = clipLine(s, e, 'right', w);
    if (!seg) return;
    mk('line', { x1: seg[0].x, y1: seg[0].y, x2: seg[1].x, y2: seg[1].y, stroke: color, 'stroke-width': i === 0 ? 2 : 1.5 }, g);
  });
  mk('line', { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, stroke: color, 'stroke-width': 1, 'stroke-dasharray': '3,3' }, g);
}

/** Trend tabanlı Fib genişletme: A->B hareketi C'den itibaren yansıtılır (price = C + (B-A)*level). */
export const FIB_EXT_LEVELS: Array<{ level: number; color: string }> = [
  { level: 0, color: '#787B86' },
  { level: 0.618, color: '#00BCD4' },
  { level: 1, color: '#089981' },
  { level: 1.272, color: '#FF9800' },
  { level: 1.618, color: '#F23645' },
  { level: 2, color: '#AB47BC' },
  { level: 2.618, color: '#0284C7' },
];

export function fibExtensionLevels(
  a: TimePricePoint,
  b: TimePricePoint,
  c: TimePricePoint
): Array<{ level: number; price: number; color: string }> {
  const move = b.price - a.price;
  return FIB_EXT_LEVELS.map((l) => ({ level: l.level, price: c.price + move * l.level, color: l.color }));
}

export function renderFibExtension(d: DrawingObject, m: CoordinateMapper, g: SVGElement, w: number): void {
  if (d.points.length < 2) return;
  const pa = px(m, d.points[0]);
  const pb = px(m, d.points[1]);
  if (!pa || !pb) return;
  const guide = d.color || '#787B86';
  mk('line', { x1: pa.x, y1: pa.y, x2: pb.x, y2: pb.y, stroke: guide, 'stroke-width': 1.5, 'stroke-dasharray': '4,3' }, g);
  if (d.points.length < 3) return;
  const pc = px(m, d.points[2]);
  if (!pc) return;
  mk('line', { x1: pb.x, y1: pb.y, x2: pc.x, y2: pc.y, stroke: guide, 'stroke-width': 1.5, 'stroke-dasharray': '4,3' }, g);
  const left = Math.min(pa.x, pb.x, pc.x);
  for (const lv of fibExtensionLevels(d.points[0], d.points[1], d.points[2])) {
    const y = m.priceToY(lv.price);
    if (y === null) continue;
    mk('line', { x1: pc.x, y1: y, x2: Math.max(pc.x + 40, w - 80), y2: y, stroke: lv.color, 'stroke-width': 1.2 }, g);
    const t = mk(
      'text',
      { x: Math.max(left, pc.x) + 6, y: y - 4, fill: lv.color, 'font-size': 10, 'font-family': "-apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, Ubuntu, sans-serif", 'font-weight': 600 },
      g
    );
    t.textContent = `${lv.level} (${fmt(lv.price)})`;
  }
}

/** Elips: iki nokta sınırlayıcı kutunun köşeleri. */
export function ellipseGeometry(a: Px, b: Px): { cx: number; cy: number; rx: number; ry: number } {
  return { cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, rx: Math.abs(b.x - a.x) / 2, ry: Math.abs(b.y - a.y) / 2 };
}

export function renderEllipse(d: DrawingObject, m: CoordinateMapper, g: SVGElement): void {
  if (d.points.length < 2) return;
  const a = px(m, d.points[0]);
  const b = px(m, d.points[1]);
  if (!a || !b) return;
  const color = d.color || '#0284C7';
  const e = ellipseGeometry(a, b);
  mk('ellipse', { cx: e.cx, cy: e.cy, rx: Math.max(1, e.rx), ry: Math.max(1, e.ry), fill: color, 'fill-opacity': 0.12, stroke: color, 'stroke-width': 2 }, g);
}

/**
 * Sabit aralık hacim profili ("Fixed Range Volume Profile"): iki noktanın zaman aralığındaki
 * barların profili; aralığın sol kenarına yaslı, POC kırmızı, değer alanı koyu. Fiyat noktaları
 * yalnız tutamak içindir, hesap zaman aralığıyla yapılır.
 */
export function renderFixedVP(d: DrawingObject, m: ExtraMapper, g: SVGElement, height: number): void {
  if (d.points.length < 2) return;
  const a = px(m, d.points[0]);
  const b = px(m, d.points[1]);
  if (!a || !b) return;
  const t0 = Math.min(d.points[0].time, d.points[1].time);
  const t1 = Math.max(d.points[0].time, d.points[1].time);
  const bars = (m.getCandles?.() ?? []).filter((c) => c.time >= t0 && c.time <= t1);
  const left = Math.min(a.x, b.x);
  const width = Math.max(4, Math.abs(b.x - a.x));
  mk('rect', { x: left, y: 0, width, height, fill: d.color || '#0284C7', 'fill-opacity': 0.04, stroke: 'none' }, g);
  mk('line', { x1: left, y1: 0, x2: left, y2: height, stroke: d.color || '#0284C7', 'stroke-width': 1, 'stroke-dasharray': '4,3' }, g);
  mk('line', { x1: left + width, y1: 0, x2: left + width, y2: height, stroke: d.color || '#0284C7', 'stroke-width': 1, 'stroke-dasharray': '4,3' }, g);
  const vp = computeProfile(bars, { rows: 24, vaPct: 70 });
  if (!vp || vp.maxTotal <= 0) return;
  const maxW = width * 0.85;
  for (const r of vp.rows) {
    if (r.total <= 0) continue;
    const yTop = m.priceToY(r.price + vp.rowSize);
    const yBot = m.priceToY(r.price);
    if (yTop === null || yBot === null) continue;
    const h = Math.max(1, Math.abs(yBot - yTop) - 1);
    const y = Math.min(yTop, yBot);
    const mid = r.price + vp.rowSize / 2;
    const va = mid >= vp.val && mid <= vp.vah;
    const wu = (r.up / vp.maxTotal) * maxW;
    const wd = (r.down / vp.maxTotal) * maxW;
    mk('rect', { x: left, y, width: wu, height: h, fill: va ? VP_COLORS.vaUp : VP_COLORS.up, stroke: 'none', 'data-vp-row': r.price }, g);
    mk('rect', { x: left + wu, y, width: wd, height: h, fill: va ? VP_COLORS.vaDown : VP_COLORS.down, stroke: 'none' }, g);
  }
  const yp = m.priceToY(vp.poc);
  if (yp !== null) mk('line', { x1: left, y1: yp, x2: left + width, y2: yp, stroke: VP_COLORS.poc, 'stroke-width': 1.5, 'data-keep-style': '1', 'data-vp-poc': vp.poc }, g);
  badge(g, left + width / 2, 14, `${bars.length} bar · POC ${fmt(vp.poc)}`, d.color || '#0284C7');
}
