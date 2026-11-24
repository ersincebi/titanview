import type { Candle, DrawingObject, TimePricePoint } from '../../types/market';
import { allPx, extendRay, fmtPrice, line, mk, poly, text, toPx, type Px, type ToolMapper } from './svg';

// ---------------------------------------------------------------- regresyon trendi

export interface RegressionResult {
  /** fiyat = intercept + slope * i (i: aralıktaki bar sırası, 0..n-1) */
  slope: number;
  intercept: number;
  /** kalıntıların standart sapması */
  stdev: number;
  pearsonR: number;
  n: number;
  t0: number;
  t1: number;
  startPrice: number;
  endPrice: number;
}

/**
 * Standart "Regression Trend": iki noktanın zaman aralığındaki kapanışlara en küçük kareler doğrusu,
 * üst/alt bant = taban ± sapma × kalıntı standart sapması. Bar sayısı < 2 → null.
 */
export function regression(candles: Candle[], tA: number, tB: number): RegressionResult | null {
  const t0 = Math.min(tA, tB);
  const t1 = Math.max(tA, tB);
  const bars = candles.filter((c) => c.time >= t0 && c.time <= t1);
  const n = bars.length;
  if (n < 2) return null;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  bars.forEach((c, i) => {
    sx += i;
    sy += c.close;
    sxx += i * i;
    sxy += i * c.close;
    syy += c.close * c.close;
  });
  const den = n * sxx - sx * sx;
  const slope = den !== 0 ? (n * sxy - sx * sy) / den : 0;
  const intercept = (sy - slope * sx) / n;
  let ss = 0;
  bars.forEach((c, i) => {
    const r = c.close - (intercept + slope * i);
    ss += r * r;
  });
  const stdev = Math.sqrt(ss / n);
  const vy = n * syy - sy * sy;
  const pearsonR = den > 0 && vy > 0 ? (n * sxy - sx * sy) / Math.sqrt(den * vy) : 0;
  return {
    slope,
    intercept,
    stdev,
    pearsonR,
    n,
    t0: bars[0].time,
    t1: bars[n - 1].time,
    startPrice: intercept,
    endPrice: intercept + slope * (n - 1),
  };
}

export const REGRESSION_DEV = 2;

export function renderRegression(d: DrawingObject, m: ToolMapper, g: SVGElement): void {
  if (d.points.length < 2) return;
  const r = regression(m.getCandles?.() ?? [], d.points[0].time, d.points[1].time);
  const color = d.color || '#0284C7';
  if (!r) {
    const p = allPx(m, d, 2);
    if (p) line(g, p[0], p[1], color, 1, '4,3');
    return;
  }
  const x0 = m.timeToX(r.t0);
  const x1 = m.timeToX(r.t1);
  if (x0 === null || x1 === null) return;
  const off = r.stdev * REGRESSION_DEV;
  const y = (p: number) => m.priceToY(p);
  const ys = [r.startPrice + off, r.endPrice + off, r.startPrice, r.endPrice, r.startPrice - off, r.endPrice - off].map(y);
  if (ys.some((v) => v === null)) return;
  const [u0, u1, b0, b1, l0, l1] = ys as number[];
  poly(g, [{ x: x0, y: u0 }, { x: x1, y: u1 }, { x: x1, y: b1 }, { x: x0, y: b0 }], { fill: '#0284C7', 'fill-opacity': 0.12, stroke: 'none' });
  poly(g, [{ x: x0, y: b0 }, { x: x1, y: b1 }, { x: x1, y: l1 }, { x: x0, y: l0 }], { fill: '#F23645', 'fill-opacity': 0.12, stroke: 'none' });
  line(g, { x: x0, y: u0 }, { x: x1, y: u1 }, '#0284C7', 1).setAttribute('data-reg', 'upper');
  line(g, { x: x0, y: b0 }, { x: x1, y: b1 }, '#F23645', 1, '6,4').setAttribute('data-reg', 'base');
  line(g, { x: x0, y: l0 }, { x: x1, y: l1 }, '#0284C7', 1).setAttribute('data-reg', 'lower');
}

/** Regresyon tutamakları: taban çizgisinin uçları (fiyat noktaları yalnız zaman içindir). */
export function regressionHandles(d: DrawingObject, m: ToolMapper): Px[] | null {
  if (d.points.length < 2) return null;
  const r = regression(m.getCandles?.() ?? [], d.points[0].time, d.points[1].time);
  if (!r) return null;
  const first = d.points[0].time <= d.points[1].time;
  const pts: TimePricePoint[] = first
    ? [{ time: r.t0, price: r.startPrice }, { time: r.t1, price: r.endPrice }]
    : [{ time: r.t1, price: r.endPrice }, { time: r.t0, price: r.startPrice }];
  const out = pts.map((p) => toPx(m, p));
  return out.every((p) => p !== null) ? (out as Px[]) : null;
}

// ---------------------------------------------------------------- düz üst/alt, ayrık kanal

/** Düz üst/alt: p0-p1 eğimli çizgi, p2'nin fiyatı yatay sınır (x0..x1). */
export function flatChannelGeometry(p: Px[]): { slanted: [Px, Px]; flat: [Px, Px] } {
  const [a, b] = p;
  const fy = p.length > 2 ? p[2].y : a.y;
  return { slanted: [a, b], flat: [{ x: a.x, y: fy }, { x: b.x, y: fy }] };
}

export function renderFlatChannel(d: DrawingObject, m: ToolMapper, g: SVGElement): void {
  const p = allPx(m, d, Math.min(3, d.points.length));
  if (!p || p.length < 2) return;
  const color = d.color || '#0284C7';
  if (p.length < 3) {
    line(g, p[0], p[1], color, 1);
    return;
  }
  const geo = flatChannelGeometry(p);
  poly(g, [geo.slanted[0], geo.slanted[1], geo.flat[1], geo.flat[0]], { fill: color, 'fill-opacity': 0.15, stroke: 'none' });
  line(g, geo.slanted[0], geo.slanted[1], color, 1);
  line(g, geo.flat[0], geo.flat[1], color, 1);
}

/** Ayrık kanal: p0-p1 çizgisi; ikinci çizgi ters eğimle p2'den geçer (x0..x1). */
export function disjointGeometry(p: Px[]): { first: [Px, Px]; second: [Px, Px] } {
  const [a, b, c] = p;
  const slope = b.x !== a.x ? (b.y - a.y) / (b.x - a.x) : 0;
  const yAt = (x: number) => c.y - slope * (x - c.x);
  return { first: [a, b], second: [{ x: a.x, y: yAt(a.x) }, { x: b.x, y: yAt(b.x) }] };
}

export function renderDisjointChannel(d: DrawingObject, m: ToolMapper, g: SVGElement): void {
  const p = allPx(m, d, Math.min(3, d.points.length));
  if (!p || p.length < 2) return;
  const color = d.color || '#0284C7';
  if (p.length < 3) {
    line(g, p[0], p[1], color, 1);
    return;
  }
  const geo = disjointGeometry(p);
  poly(g, [geo.first[0], geo.first[1], geo.second[1], geo.second[0]], { fill: color, 'fill-opacity': 0.15, stroke: 'none' });
  line(g, geo.first[0], geo.first[1], color, 1);
  line(g, geo.second[0], geo.second[1], color, 1);
}

// ---------------------------------------------------------------- pitchfork türleri

export type PitchforkKind = 'original' | 'schiff' | 'mod_schiff' | 'inside';

/** Standart pitchfork seviyeleri (medyandan uzaklık, P1/P2 = 1). Varsayılan görünenler. */
export const PITCHFORK_LEVELS: Array<{ level: number; color: string }> = [
  { level: 0.25, color: '#FF9800' },
  { level: 0.382, color: '#4CAF50' },
  { level: 0.5, color: '#089981' },
  { level: 0.618, color: '#00BCD4' },
  { level: 0.75, color: '#0284C7' },
  { level: 1, color: '#0284C7' },
];
export const PITCHFORK_VISIBLE = [0.5, 1];

/**
 * Pitchfork türüne göre medyan çizginin başlangıcı.
 * Schiff: P0'ın zamanında, P0-P1 fiyat ortası. Değiştirilmiş Schiff: P0-P1 orta noktası.
 * İç (Inside): Değiştirilmiş Schiff başlangıcı, kollar P1/P2 yerine P1/P2'nin medyana olan
 * yarı uzaklığında ("Inside" — çatal içe kapanır).
 */
export function pitchforkOrigin(kind: PitchforkKind, p0: Px, p1: Px): Px {
  if (kind === 'schiff') return { x: p0.x, y: (p0.y + p1.y) / 2 };
  if (kind === 'mod_schiff' || kind === 'inside') return { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
  return p0;
}

export interface PitchforkGeo {
  origin: Px;
  mid: Px;
  dir: Px;
  /** seviye → [sol kol başlangıcı, sağ kol başlangıcı] (P1 tarafı, P2 tarafı) */
  prongs: Array<{ level: number; a: Px; b: Px }>;
}

export function pitchforkGeo(kind: PitchforkKind, p0: Px, p1: Px, p2: Px, levels = PITCHFORK_LEVELS.map((l) => l.level)): PitchforkGeo {
  const origin = pitchforkOrigin(kind, p0, p1);
  const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
  const dir = { x: mid.x - origin.x, y: mid.y - origin.y };
  const scale = kind === 'inside' ? 0.5 : 1;
  const prongs = levels.map((level) => {
    const k = level * scale;
    return {
      level,
      a: { x: mid.x + (p1.x - mid.x) * k, y: mid.y + (p1.y - mid.y) * k },
      b: { x: mid.x + (p2.x - mid.x) * k, y: mid.y + (p2.y - mid.y) * k },
    };
  });
  return { origin, mid, dir, prongs };
}

export function renderPitchforkKind(kind: PitchforkKind) {
  return (d: DrawingObject, m: ToolMapper, g: SVGElement, w: number, h: number): void => {
    const n = Math.min(3, d.points.length);
    const p = allPx(m, d, n);
    if (!p || p.length < 2) return;
    const color = d.color || '#F23645';
    if (p.length < 3) {
      line(g, p[0], p[1], color, 1);
      return;
    }
    const geo = pitchforkGeo(kind, p[0], p[1], p[2], PITCHFORK_VISIBLE);
    const ray = (s: Px): [Px, Px] => extendRay(s, { x: s.x + geo.dir.x, y: s.y + geo.dir.y }, 'right', w, h);
    // kollar arasındaki dolgular (varsayılan: medyan ile 0.5 arası, 0.5 ile 1 arası)
    let prevA = geo.mid;
    let prevB = geo.mid;
    for (const pr of geo.prongs) {
      const ra = ray(pr.a);
      const rb = ray(pr.b);
      const pa = ray(prevA);
      const pb = ray(prevB);
      const lv = PITCHFORK_LEVELS.find((l) => l.level === pr.level)?.color ?? color;
      poly(g, [pa[0], pa[1], ra[1], ra[0]], { fill: lv, 'fill-opacity': 0.1, stroke: 'none' });
      poly(g, [pb[0], pb[1], rb[1], rb[0]], { fill: lv, 'fill-opacity': 0.1, stroke: 'none' });
      line(g, ra[0], ra[1], lv, 1);
      line(g, rb[0], rb[1], lv, 1);
      prevA = pr.a;
      prevB = pr.b;
    }
    const med = ray(geo.origin);
    line(g, med[0], med[1], color, 1).setAttribute('data-pf', 'median');
    line(g, p[1], p[2], color, 1);
    if (kind !== 'original') line(g, p[0], geo.origin, color, 1, '4,3');
  };
}

// ---------------------------------------------------------------- trend açısı, çapraz çizgi

/** Ekran açısı (derece, yukarı pozitif) — Standart trend açısı ekrandaki eğimi gösterir. */
export function screenAngle(a: Px, b: Px): number {
  return (-Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
}

export function renderTrendAngle(d: DrawingObject, m: ToolMapper, g: SVGElement): void {
  const p = allPx(m, d, Math.min(2, d.points.length));
  if (!p || p.length < 2) return;
  const [a, b] = p;
  const color = d.color || '#0284C7';
  line(g, a, b, color, 2);
  const ang = screenAngle(a, b);
  const r = 36;
  line(g, a, { x: a.x + r + 14, y: a.y }, color, 1, '3,3');
  const rad = (-ang * Math.PI) / 180;
  const ex = a.x + r * Math.cos(rad);
  const ey = a.y + r * Math.sin(rad);
  const sweep = ang >= 0 ? 0 : 1;
  mk('path', { d: `M${a.x + r},${a.y} A${r},${r} 0 0 ${sweep} ${ex},${ey}`, fill: 'none', stroke: color, 'stroke-width': 1 }, g);
  text(g, a.x + r + 18, a.y + (ang >= 0 ? -4 : 12), `${ang.toFixed(2)}°`, color, 11);
}

export function renderCrossLine(d: DrawingObject, m: ToolMapper, g: SVGElement, w: number, h: number): void {
  const a = d.points[0] && toPx(m, d.points[0]);
  if (!a) return;
  const color = d.color || '#0284C7';
  line(g, { x: 0, y: a.y }, { x: w, y: a.y }, color, 1);
  line(g, { x: a.x, y: 0 }, { x: a.x, y: h }, color, 1);
  text(g, w - 6, a.y - 4, fmtPrice(d.points[0].price), color, 10, 'end');
}
