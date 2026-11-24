import { tt } from '../../state/i18n';
import type { Candle, DrawingObject, TimePricePoint } from '../../types/market';
import { computeProfile } from '../profile';
import { VP_COLORS } from '../profilePrimitives';
import { formatDuration } from './ExtraTools';
import { fmtPrice, FONT, line, mk, poly, text, toPx, type Px, type ToolMapper } from './svg';

/** Faz 22: tahmin araçları. Hesaplar gerçek mumlardan yapılır (uydurma veri yok). */

const candlesOf = (m: ToolMapper): Candle[] => m.getCandles?.() ?? [];

export function formatVolumeShort(v: number): string {
  if (v >= 1e9) return (v / 1e9).toFixed(2) + 'B';
  if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M';
  if (v >= 1e3) return (v / 1e3).toFixed(1) + 'K';
  return v.toFixed(0);
}

/** Koyu rozet: çok satırlı metin. */
function infoBox(g: Element, x: number, y: number, lines: string[], color: string, anchor: 'left' | 'center' = 'center'): void {
  const w = Math.max(...lines.map((s) => s.length)) * 6.4 + 16;
  const h = lines.length * 15 + 8;
  const left = anchor === 'center' ? x - w / 2 : x;
  mk('rect', { x: left, y, width: w, height: h, rx: 4, fill: color, 'fill-opacity': 0.92, stroke: 'none', 'data-keep-style': '1' }, g);
  lines.forEach((s, i) => text(g, left + w / 2, y + 16 + i * 15, s, '#FFFFFF', 11, 'middle'));
}

// ---------------------------------------------------------------- Tahmin (Forecast)

export type ForecastStatus = 'pending' | 'success' | 'failure';

/**
 * Standart Forecast: kaynak noktadan sonraki mumlar hedef fiyata hedef zamana kadar ulaştıysa başarılı;
 * hedef zaman geçtiyse ve ulaşılmadıysa başarısız; aksi halde bekliyor.
 */
export function forecastStatus(candles: Candle[], src: TimePricePoint, tgt: TimePricePoint): ForecastStatus {
  const up = tgt.price >= src.price;
  let lastTime = -Infinity;
  for (const c of candles) {
    if (c.time <= src.time) continue;
    lastTime = c.time;
    if (c.time > tgt.time) break;
    if (up ? c.high >= tgt.price : c.low <= tgt.price) return 'success';
  }
  return lastTime >= tgt.time ? 'failure' : 'pending';
}

export function barsBetween(candles: Candle[], t0: number, t1: number): number {
  const lo = Math.min(t0, t1);
  const hi = Math.max(t0, t1);
  let n = 0;
  for (const c of candles) if (c.time > lo && c.time <= hi) n++;
  if (n > 0 || candles.length < 2) return n;
  // gelecek: son iki mumun aralığıyla tahmin
  const step = candles[candles.length - 1].time - candles[candles.length - 2].time;
  return step > 0 ? Math.round((hi - lo) / step) : 0;
}

function fmtDate(sec: number): string {
  const d = new Date(sec * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

const STATUS_LABEL: Record<ForecastStatus, string> = { pending: 'Bekliyor', success: tt("✓ BAŞARILI"), failure: tt("✗ BAŞARISIZ") };
const STATUS_COLOR: Record<ForecastStatus, string> = { pending: '#787B86', success: '#089981', failure: '#F23645' };

/** Standart Position forecast: kaynaktan hedefe yukarı/aşağı bükülen eğri (ikinci derece Bézier kontrol noktası). */
export function forecastControl(a: Px, b: Px): Px {
  // Varsayılan: eğri her zaman yukarı doğru kavis yapar (kiriş üstünde)
  const bend = Math.min(80, Math.abs(b.x - a.x) * 0.12 + 10);
  return { x: (a.x + b.x) / 2, y: Math.min(a.y, b.y) - bend };
}

function labelBox(g: Element, x: number, y: number, lines: string[], fill: string): void {
  const w = Math.max(...lines.map((s) => s.length)) * 6.2 + 12;
  const h = lines.length * 13 + 6;
  mk('rect', { x: x - w / 2, y, width: w, height: h, rx: 3, fill, stroke: 'none', 'data-keep-style': '1' }, g);
  lines.forEach((s, i) => text(g, x, y + 13 + i * 13, s, '#FFFFFF', i === 0 ? 11 : 10, 'middle'));
}

export function renderForecast(d: DrawingObject, m: ToolMapper, g: SVGElement): void {
  const a = d.points[0] && toPx(m, d.points[0]);
  const b = d.points[1] && toPx(m, d.points[1]);
  if (!a) return;
  const color = d.color || '#0284C7';
  mk('circle', { cx: a.x, cy: a.y, r: 3.5, fill: color, stroke: '#FFFFFF' }, g);
  labelBox(g, a.x, a.y - 36, [fmtPrice(d.points[0].price), fmtDate(d.points[0].time).slice(0, 10)], color);
  if (!b) return;
  const cs = candlesOf(m);
  const st = forecastStatus(cs, d.points[0], d.points[1]);
  const c = forecastControl(a, b);
  mk('path', { d: `M${a.x},${a.y} Q${c.x},${c.y} ${b.x},${b.y}`, stroke: color, 'stroke-width': 2, fill: 'none' }, g);
  mk('circle', { cx: b.x, cy: b.y, r: 3.5, fill: color, stroke: '#FFFFFF' }, g);
  const diff = d.points[1].price - d.points[0].price;
  const pct = d.points[0].price ? (diff / d.points[0].price) * 100 : 0;
  const s = diff >= 0 ? '+' : '';
  const bars = barsBetween(cs, d.points[0].time, d.points[1].time);
  const y = b.y + 8;
  labelBox(g, b.x, y, [`${s}${fmtPrice(diff)} (${s}${pct.toFixed(2)}%) ${bars} barda`, `${fmtPrice(d.points[1].price)} @ ${fmtDate(d.points[1].time).slice(0, 10)}`], color);
  labelBox(g, b.x, y + 34, [STATUS_LABEL[st]], STATUS_COLOR[st]);
}

// ---------------------------------------------------------------- Tarih ve fiyat aralığı

export interface RangeStats {
  diff: number;
  pct: number;
  bars: number;
  secs: number;
  volume: number;
}

export function rangeStats(candles: Candle[], p0: TimePricePoint, p1: TimePricePoint): RangeStats {
  const diff = p1.price - p0.price;
  const lo = Math.min(p0.time, p1.time);
  const hi = Math.max(p0.time, p1.time);
  let volume = 0;
  for (const c of candles) if (c.time >= lo && c.time <= hi) volume += c.volume || 0;
  return {
    diff,
    pct: p0.price ? (diff / p0.price) * 100 : 0,
    bars: barsBetween(candles, p0.time, p1.time),
    secs: hi - lo,
    volume,
  };
}

function arrowHead(g: Element, tip: Px, dir: 'up' | 'down' | 'left' | 'right', color: string): void {
  const s = 6;
  const pts: Record<typeof dir, Px[]> = {
    up: [tip, { x: tip.x - s, y: tip.y + s }, { x: tip.x + s, y: tip.y + s }],
    down: [tip, { x: tip.x - s, y: tip.y - s }, { x: tip.x + s, y: tip.y - s }],
    left: [tip, { x: tip.x + s, y: tip.y - s }, { x: tip.x + s, y: tip.y + s }],
    right: [tip, { x: tip.x - s, y: tip.y - s }, { x: tip.x - s, y: tip.y + s }],
  };
  poly(g, pts[dir], { fill: color, stroke: 'none' });
}

export function renderDatePriceRange(d: DrawingObject, m: ToolMapper, g: SVGElement): void {
  const a = d.points[0] && toPx(m, d.points[0]);
  const b = d.points[1] && toPx(m, d.points[1]);
  if (!a || !b) return;
  const st = rangeStats(candlesOf(m), d.points[0], d.points[1]);
  const color = d.color && d.color !== '#0284C7' ? d.color : st.diff >= 0 ? '#0284C7' : '#F23645';
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const w = Math.abs(b.x - a.x);
  const h = Math.abs(b.y - a.y);
  mk('rect', { x, y, width: w, height: h, fill: color, 'fill-opacity': 0.2, stroke: 'none' }, g);
  const mx = x + w / 2;
  const my = y + h / 2;
  line(g, { x: mx, y: a.y }, { x: mx, y: b.y }, color, 1);
  line(g, { x: a.x, y: my }, { x: b.x, y: my }, color, 1);
  if (h > 8) arrowHead(g, { x: mx, y: b.y }, b.y < a.y ? 'up' : 'down', color);
  if (w > 8) arrowHead(g, { x: b.x, y: my }, b.x > a.x ? 'right' : 'left', color);
  const s = st.diff >= 0 ? '+' : '';
  const lines = [
    `${s}${fmtPrice(st.diff)} (${s}${st.pct.toFixed(2)}%)`,
    `${st.bars} bar, ${formatDuration(st.secs)}`,
    `Hacim ${formatVolumeShort(st.volume)}`,
  ];
  infoBox(g, mx, b.y < a.y ? y - 58 : y + h + 6, lines, color);
}

// ---------------------------------------------------------------- Çubuk deseni

export const MAX_PATTERN_BARS = 500;

/** Seçilen aralıktaki mumların ilk açılışa göre farkı (anlık görüntü). */
export function snapshotBars(candles: Candle[], t0: number, t1: number): Array<[number, number, number, number]> {
  const lo = Math.min(t0, t1);
  const hi = Math.max(t0, t1);
  const sel = candles.filter((c) => c.time >= lo && c.time <= hi).slice(0, MAX_PATTERN_BARS);
  if (sel.length === 0) return [];
  const base = sel[0].open;
  return sel.map((c) => [c.open - base, c.high - base, c.low - base, c.close - base]);
}

/** Tamamlanınca: 0. nokta fiyatı ilk açılışa, 1. nokta son kapanışa çekilir; çubuklar saklanır. */
export function barsPatternExtra(pts: TimePricePoint[], candles: Candle[]): { points: TimePricePoint[]; bars: Array<[number, number, number, number]> } {
  const bars = snapshotBars(candles, pts[0].time, pts[1].time);
  if (bars.length === 0) return { points: pts, bars };
  const lo = Math.min(pts[0].time, pts[1].time);
  const hi = Math.max(pts[0].time, pts[1].time);
  const first = candles.find((c) => c.time >= lo)!;
  const last = bars[bars.length - 1];
  return { points: [{ time: lo, price: first.open }, { time: hi, price: first.open + last[3] }], bars };
}

export function renderBarsPattern(d: DrawingObject, m: ToolMapper, g: SVGElement, _w: number, h: number): void {
  const a = d.points[0] && toPx(m, d.points[0]);
  const b = d.points[1] && toPx(m, d.points[1]);
  if (!a || !b) return;
  const color = d.color || '#0284C7';
  const bars = d.bars ?? [];
  if (bars.length === 0) {
    // taslak: seçim aralığı
    const x = Math.min(a.x, b.x);
    mk('rect', { x, y: 0, width: Math.abs(b.x - a.x), height: h, fill: color, 'fill-opacity': 0.1, stroke: color, 'stroke-dasharray': '4,4' }, g);
    return;
  }
  const n = bars.length;
  const step = n > 1 ? (b.x - a.x) / (n - 1) : 0;
  const bw = Math.max(1, Math.min(12, Math.abs(step) * 0.6));
  const base = d.points[0].price;
  bars.forEach(([o, hi, lo, c], i) => {
    const x = a.x + step * i;
    const yo = m.priceToY(base + o);
    const yc = m.priceToY(base + c);
    const yh = m.priceToY(base + hi);
    const yl = m.priceToY(base + lo);
    if (yo === null || yc === null || yh === null || yl === null) return;
    mk('line', { x1: x, y1: yh, x2: x, y2: yl, stroke: color, 'stroke-width': 1, 'stroke-opacity': 0.8, 'data-keep-style': '1' }, g);
    mk('rect', { x: x - bw / 2, y: Math.min(yo, yc), width: bw, height: Math.max(1, Math.abs(yc - yo)), fill: c >= o ? color : 'none', 'fill-opacity': 0.5, stroke: color, 'stroke-width': 1, 'data-keep-style': '1' }, g);
  });
  // gövde tıklama alanı
  mk('rect', { x: Math.min(a.x, b.x) - bw, y: Math.min(a.y, b.y) - 4, width: Math.abs(b.x - a.x) + 2 * bw, height: Math.abs(b.y - a.y) + 8, fill: 'transparent', stroke: 'none' }, g);
}

// ---------------------------------------------------------------- Hayalet akış

/** Son iki mum arasındaki ekran aralığı (px); bulunamazsa 8. */
export function barSpacingPx(m: ToolMapper): number {
  const cs = candlesOf(m);
  for (let i = cs.length - 1; i > 0; i--) {
    const x1 = m.timeToX(cs[i].time);
    const x0 = m.timeToX(cs[i - 1].time);
    if (x1 !== null && x0 !== null && x1 > x0) return x1 - x0;
  }
  return 8;
}

export interface GhostBar {
  x: number;
  o: number;
  h: number;
  l: number;
  c: number;
}

/**
 * Hayalet akış: kullanıcının yerleştirdiği noktaları izleyen sentetik mumlar (ekran y koordinatlarında).
 * Her parça boyunca bar aralığıyla bölünür; açılış önceki kapanış, fitil gövdenin %35'i (en az 2px).
 */
export function ghostBars(ps: Px[], spacing: number): GhostBar[] {
  const out: GhostBar[] = [];
  if (ps.length < 2 || spacing <= 0) return out;
  let prevC = ps[0].y;
  for (let s = 1; s < ps.length; s++) {
    const a = ps[s - 1];
    const b = ps[s];
    const n = Math.max(1, Math.round(Math.abs(b.x - a.x) / spacing));
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const c = a.y + (b.y - a.y) * t;
      const o = prevC;
      const body = Math.abs(c - o);
      const wick = Math.max(2, body * 0.35);
      out.push({ x: a.x + (b.x - a.x) * t, o, c, h: Math.min(o, c) - wick, l: Math.max(o, c) + wick });
      prevC = c;
    }
  }
  return out;
}

export function renderGhostFeed(d: DrawingObject, m: ToolMapper, g: SVGElement): void {
  const ps = d.points.map((p) => toPx(m, p)).filter((p): p is Px => p !== null);
  if (ps.length < 2) {
    if (ps[0]) mk('circle', { cx: ps[0].x, cy: ps[0].y, r: 3, fill: d.color || '#0284C7' }, g);
    return;
  }
  const sp = barSpacingPx(m);
  const bw = Math.max(1, sp * 0.6);
  for (const b of ghostBars(ps, sp)) {
    const up = b.c <= b.o; // ekran y'si küçükse fiyat yüksek
    const col = up ? '#089981' : '#F23645';
    mk('line', { x1: b.x, y1: b.h, x2: b.x, y2: b.l, stroke: col, 'stroke-width': 1, 'stroke-opacity': 0.6, 'data-keep-style': '1' }, g);
    mk('rect', { x: b.x - bw / 2, y: Math.min(b.o, b.c), width: bw, height: Math.max(1, Math.abs(b.c - b.o)), fill: col, 'fill-opacity': 0.5, stroke: 'none' }, g);
  }
  mk('path', { d: ps.map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`).join(' '), stroke: d.color || '#0284C7', 'stroke-width': 1, 'stroke-dasharray': '3,3', fill: 'none', 'stroke-opacity': 0.5 }, g);
}

// ---------------------------------------------------------------- Projeksiyon

/**
 * Projeksiyon (Projection): p0→p1 ilk hareket, p1→p2 ikinci hareket.
 * p1 merkezli iki yay: |p1p0| ve |p1p2| yarıçap; oran = fiyat farkı oranı |p2-p1| / |p1-p0|.
 */
export function projectionRatio(pts: TimePricePoint[]): number {
  if (pts.length < 3) return NaN;
  const base = Math.abs(pts[1].price - pts[0].price);
  return base < 1e-12 ? NaN : Math.abs(pts[2].price - pts[1].price) / base;
}

function sector(c: Px, from: Px, to: Px): string {
  const r = Math.hypot(from.x - c.x, from.y - c.y);
  const a0 = Math.atan2(from.y - c.y, from.x - c.x);
  const a1 = Math.atan2(to.y - c.y, to.x - c.x);
  let da = a1 - a0;
  while (da > Math.PI) da -= 2 * Math.PI;
  while (da < -Math.PI) da += 2 * Math.PI;
  const end = { x: c.x + r * Math.cos(a1), y: c.y + r * Math.sin(a1) };
  return `M${c.x},${c.y} L${from.x},${from.y} A${r},${r} 0 0 ${da > 0 ? 1 : 0} ${end.x},${end.y} Z`;
}

export function renderProjection(d: DrawingObject, m: ToolMapper, g: SVGElement): void {
  const ps = d.points.map((p) => toPx(m, p));
  const [a, b, c] = ps;
  if (!a || !b) return;
  const color = d.color || '#0284C7';
  line(g, a, b, color, 1.5);
  if (!c) return;
  line(g, b, c, color, 1.5);
  mk('path', { d: sector(b, a, c), fill: '#0284C7', 'fill-opacity': 0.15, stroke: '#0284C7', 'stroke-width': 1 }, g);
  mk('path', { d: sector(b, c, a), fill: '#F23645', 'fill-opacity': 0.12, stroke: '#F23645', 'stroke-width': 1 }, g);
  const r = projectionRatio(d.points);
  if (Number.isFinite(r)) infoBox(g, c.x, c.y + 8, [`${(r * 100).toFixed(1)}%`], color);
}

// ---------------------------------------------------------------- Çapalı VWAP / VP

/** Çapa mumundan itibaren kümülatif VWAP (hlc3·hacim). Hacimsiz barlarda eşit ağırlık. */
export function anchoredVwap(candles: Candle[], anchor: number): Array<{ time: number; value: number }> {
  const out: Array<{ time: number; value: number }> = [];
  let pv = 0;
  let vol = 0;
  let n = 0;
  let sum = 0;
  for (const c of candles) {
    if (c.time < anchor) continue;
    const tp = (c.high + c.low + c.close) / 3;
    const v = c.volume > 0 ? c.volume : 0;
    pv += tp * v;
    vol += v;
    sum += tp;
    n++;
    out.push({ time: c.time, value: vol > 0 ? pv / vol : sum / n });
  }
  return out;
}

export function renderAnchoredVwap(d: DrawingObject, m: ToolMapper, g: SVGElement): void {
  const a = d.points[0] && toPx(m, d.points[0]);
  if (!a) return;
  const color = d.color || '#0284C7';
  const series = anchoredVwap(candlesOf(m), d.points[0].time);
  const ps: Px[] = [];
  for (const s of series) {
    const x = m.timeToX(s.time);
    const y = m.priceToY(s.value);
    if (x !== null && y !== null) ps.push({ x, y });
  }
  mk('circle', { cx: a.x, cy: a.y, r: 4, fill: color, stroke: '#FFFFFF' }, g);
  if (ps.length < 2) return;
  mk('path', { d: ps.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' '), stroke: color, 'stroke-width': 2, fill: 'none' }, g);
  const last = ps[ps.length - 1];
  const t = text(g, last.x + 6, last.y + 4, `VWAP ${fmtPrice(series[series.length - 1].value)}`, color, 11);
  t.setAttribute('font-family', FONT);
}

/** Çapalı hacim profili: çapadan son muma kadar; histogram çapadan sağa uzanır. */
export function renderAnchoredVp(d: DrawingObject, m: ToolMapper, g: SVGElement, w: number, h: number): void {
  const a = d.points[0] && toPx(m, d.points[0]);
  if (!a) return;
  const color = d.color || '#0284C7';
  const bars = candlesOf(m).filter((c) => c.time >= d.points[0].time);
  mk('line', { x1: a.x, y1: 0, x2: a.x, y2: h, stroke: color, 'stroke-width': 1, 'stroke-dasharray': '4,3' }, g);
  const lastX = bars.length ? m.timeToX(bars[bars.length - 1].time) : null;
  const right = Math.min(w, lastX ?? w);
  const width = Math.max(4, right - a.x);
  mk('rect', { x: a.x, y: 0, width, height: h, fill: VP_COLORS.box, stroke: 'none' }, g);
  const vp = computeProfile(bars, { rows: 24, vaPct: 70 });
  if (!vp || vp.maxTotal <= 0) return;
  const maxW = width * 0.6;
  for (const r of vp.rows) {
    if (r.total <= 0) continue;
    const yTop = m.priceToY(r.price + vp.rowSize);
    const yBot = m.priceToY(r.price);
    if (yTop === null || yBot === null) continue;
    const hh = Math.max(1, Math.abs(yBot - yTop) - 1);
    const y = Math.min(yTop, yBot);
    const mid = r.price + vp.rowSize / 2;
    const va = mid >= vp.val && mid <= vp.vah;
    const wu = (r.up / vp.maxTotal) * maxW;
    const wd = (r.down / vp.maxTotal) * maxW;
    mk('rect', { x: a.x, y, width: wu, height: hh, fill: va ? VP_COLORS.vaUp : VP_COLORS.up, stroke: 'none', 'data-vp-row': r.price }, g);
    mk('rect', { x: a.x + wu, y, width: wd, height: hh, fill: va ? VP_COLORS.vaDown : VP_COLORS.down, stroke: 'none' }, g);
  }
  const yp = m.priceToY(vp.poc);
  if (yp !== null) mk('line', { x1: a.x, y1: yp, x2: a.x + width, y2: yp, stroke: VP_COLORS.poc, 'stroke-width': 1.5, 'data-keep-style': '1' }, g);
}
