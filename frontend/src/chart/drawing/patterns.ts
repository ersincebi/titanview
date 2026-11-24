import { tt } from '../../state/i18n';
import type { DrawingObject, DrawingToolType, TimePricePoint } from '../../types/market';
import { FONT, line, mk, poly, text, toPx, type Px, type ToolMapper } from './svg';

/** Faz 22: grafik formasyonları, Elliott dalgaları, döngüler. Taslakta eksik noktalarla da kısmen çizilir. */

const visiblePx = (m: ToolMapper, pts: TimePricePoint[]): Px[] => {
  const out: Px[] = [];
  for (const p of pts) {
    const q = toPx(m, p);
    if (!q) break;
    out.push(q);
  }
  return out;
};

const pathOf = (ps: Px[]) => ps.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

/** Formasyon nokta etiketleri (sırası). */
export const PATTERN_LABELS: Partial<Record<DrawingToolType, string[]>> = {
  xabcd: ['X', 'A', 'B', 'C', 'D'],
  cypher: ['X', 'A', 'B', 'C', 'D'],
  abcd: ['A', 'B', 'C', 'D'],
  triangle_pattern: ['A', 'B', 'C', 'D'],
  three_drives: ['', '1', 'A', '2', 'B', '3', ''],
  head_shoulders: ['', 'Sol Omuz', '', tt("Baş"), '', tt("Sağ Omuz"), ''],
  elliott_impulse: ['0', '(1)', '(2)', '(3)', '(4)', '(5)'],
  elliott_correction: ['0', '(A)', '(B)', '(C)'],
  elliott_triangle: ['0', '(A)', '(B)', '(C)', '(D)', '(E)'],
  elliott_double: ['0', '(W)', '(X)', '(Y)'],
  elliott_triple: ['0', '(W)', '(X)', '(Y)', '(X)', '(Z)'],
};

/** Fiyat farkı oranı |b-c| / |a-b| (harmonik oran). a=b ise NaN. */
export function retrace(a: number, b: number, c: number): number {
  const base = Math.abs(b - a);
  return base < 1e-12 ? NaN : Math.abs(c - b) / base;
}

export interface RatioLabel {
  /** kesikli çizginin uçları (nokta indeksleri) */
  from: number;
  to: number;
  value: number;
}

/**
 * Harmonik formasyon oranları (gösterimi):
 * XABCD: AB/XA (X–B), BC/AB (A–C), CD/BC (B–D), AD/XA (X–D).
 * Cypher: AB/XA (X–B), XC/XA (A–C, C'nin XA'ya göre uzatması), CD/XC (X–D).
 * ABCD: BC/AB (A–C), CD/BC (B–D).
 */
export function harmonicRatios(tool: DrawingToolType, p: number[]): RatioLabel[] {
  const out: RatioLabel[] = [];
  const add = (from: number, to: number, value: number) => {
    if (Number.isFinite(value)) out.push({ from, to, value });
  };
  if (tool === 'xabcd') {
    if (p.length >= 3) add(0, 2, retrace(p[0], p[1], p[2]));
    if (p.length >= 4) add(1, 3, retrace(p[1], p[2], p[3]));
    if (p.length >= 5) add(2, 4, retrace(p[2], p[3], p[4]));
    if (p.length >= 5) add(0, 4, retrace(p[0], p[1], p[4]));
  } else if (tool === 'cypher') {
    if (p.length >= 3) add(0, 2, retrace(p[0], p[1], p[2]));
    if (p.length >= 4) add(1, 3, Math.abs(p[3] - p[0]) / Math.max(1e-12, Math.abs(p[1] - p[0])));
    if (p.length >= 5) add(0, 4, retrace(p[0], p[3], p[4]));
  } else if (tool === 'abcd') {
    if (p.length >= 3) add(0, 2, retrace(p[0], p[1], p[2]));
    if (p.length >= 4) add(1, 3, retrace(p[1], p[2], p[3]));
  } else if (tool === 'three_drives') {
    // sürüş düzeltmeleri ve uzatmaları: A/1, 2/A, B/2, 3/B
    for (let i = 2; i < p.length && i <= 5; i++) add(i - 1, i, retrace(p[i - 2], p[i - 1], p[i]));
  }
  return out;
}

function ratioText(v: number): string {
  return v.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}

/** Etiket kutusu: dolgu = formasyon rengi, beyaz yazı (formasyon etiketleri). */
function pointLabel(g: Element, p: Px, s: string, color: string, above: boolean): void {
  if (!s) return;
  const w = Math.max(16, s.length * 6.6 + 8);
  const y = above ? p.y - 22 : p.y + 6;
  mk('rect', { x: p.x - w / 2, y, width: w, height: 16, rx: 3, fill: color, stroke: 'none', 'data-keep-style': '1' }, g);
  const t = mk('text', { x: p.x, y: y + 12, fill: '#FFFFFF', 'font-size': 11, 'font-family': FONT, 'text-anchor': 'middle', 'font-weight': 600 }, g);
  t.textContent = s;
}

/** Elliott etiketi: yalnız yazı (kutu yok), dalga tepesinde yukarı / dibinde aşağı. */
function waveLabel(g: Element, p: Px, s: string, color: string, above: boolean): void {
  if (!s) return;
  const t = text(g, p.x, above ? p.y - 8 : p.y + 16, s, color, 12, 'middle');
  t.setAttribute('font-weight', '600');
}

/** i. nokta yerel tepe mi (komşularına göre ekranda yukarıda)? */
export function isPeak(ps: Px[], i: number): boolean {
  const prev = ps[i - 1];
  const next = ps[i + 1];
  const ref = prev && next ? (prev.y + next.y) / 2 : (prev ?? next)?.y;
  return ref === undefined ? true : ps[i].y <= ref;
}

function fillAlpha(color: string): Record<string, string | number> {
  return { fill: color, 'fill-opacity': 0.2, stroke: 'none' };
}

/** XABCD / Cypher: XAB ve BCD üçgenleri dolu, oran kesikli çizgileri, etiketler. */
export function renderHarmonic(d: DrawingObject, m: ToolMapper, g: SVGElement): void {
  const ps = visiblePx(m, d.points);
  if (ps.length < 2) return;
  const color = d.color || '#0284C7';
  if (ps.length >= 3) poly(g, ps.slice(0, 3), fillAlpha(color));
  if (ps.length >= 5) poly(g, ps.slice(2, 5), fillAlpha(color));
  mk('path', { d: pathOf(ps), stroke: color, 'stroke-width': 2, fill: 'none' }, g);
  ratioLines(d, ps, g, color);
  const labels = PATTERN_LABELS[d.toolType] ?? [];
  ps.forEach((p, i) => pointLabel(g, p, labels[i] ?? '', color, isPeak(ps, i)));
}

function ratioLines(d: DrawingObject, ps: Px[], g: Element, color: string): void {
  const prices = d.points.slice(0, ps.length).map((p) => p.price);
  for (const r of harmonicRatios(d.toolType, prices)) {
    const a = ps[r.from];
    const b = ps[r.to];
    if (!a || !b) continue;
    line(g, a, b, color, 1, '4,4');
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const s = ratioText(r.value);
    const w = s.length * 6.4 + 10;
    mk('rect', { x: mx - w / 2, y: my - 9, width: w, height: 18, rx: 3, fill: color, stroke: 'none', 'data-keep-style': '1' }, g);
    text(g, mx, my + 4, s, '#FFFFFF', 11, 'middle');
  }
}

/** ABCD: zikzak, iki oran çizgisi; dolgu yok. */
export function renderAbcd(d: DrawingObject, m: ToolMapper, g: SVGElement): void {
  const ps = visiblePx(m, d.points);
  if (ps.length < 2) return;
  const color = d.color || '#089981';
  mk('path', { d: pathOf(ps), stroke: color, 'stroke-width': 2, fill: 'none' }, g);
  ratioLines(d, ps, g, color);
  const labels = PATTERN_LABELS.abcd!;
  ps.forEach((p, i) => pointLabel(g, p, labels[i], color, isPeak(ps, i)));
}

/** İki doğrunun kesişimi (paralelse null). */
export function intersect(a1: Px, a2: Px, b1: Px, b2: Px): Px | null {
  const d = (a1.x - a2.x) * (b1.y - b2.y) - (a1.y - a2.y) * (b1.x - b2.x);
  if (Math.abs(d) < 1e-9) return null;
  const t = ((a1.x - b1.x) * (b1.y - b2.y) - (a1.y - b1.y) * (b1.x - b2.x)) / d;
  return { x: a1.x + t * (a2.x - a1.x), y: a1.y + t * (a2.y - a1.y) };
}

/** Üçgen formasyonu: A–C ve B–D kenarları tepe noktasına (kesişim) kadar uzar; alan dolu. */
export function trianglePatternGeometry(ps: Px[]): { apex: Px | null; upper: [Px, Px]; lower: [Px, Px] } {
  const [a, b, c, dd] = ps;
  const apex = intersect(a, c, b, dd);
  // tepe noktası sağda değilse son noktalarda kes
  const ok = apex && apex.x > Math.max(c.x, dd.x);
  return { apex: ok ? apex : null, upper: [a, ok ? apex! : c], lower: [b, ok ? apex! : dd] };
}

export function renderTrianglePattern(d: DrawingObject, m: ToolMapper, g: SVGElement): void {
  const ps = visiblePx(m, d.points);
  if (ps.length < 2) return;
  const color = d.color || '#9C27B0';
  if (ps.length >= 4) {
    const geo = trianglePatternGeometry(ps);
    poly(g, geo.apex ? [ps[0], geo.apex, ps[1]] : [ps[0], ps[2], ps[3], ps[1]], fillAlpha(color));
    line(g, geo.upper[0], geo.upper[1], color, 1, '4,4');
    line(g, geo.lower[0], geo.lower[1], color, 1, '4,4');
  }
  mk('path', { d: pathOf(ps), stroke: color, 'stroke-width': 2, fill: 'none' }, g);
  const labels = PATTERN_LABELS.triangle_pattern!;
  ps.forEach((p, i) => pointLabel(g, p, labels[i], color, isPeak(ps, i)));
}

export function renderThreeDrives(d: DrawingObject, m: ToolMapper, g: SVGElement): void {
  const ps = visiblePx(m, d.points);
  if (ps.length < 2) return;
  const color = d.color || '#0284C7';
  mk('path', { d: pathOf(ps), stroke: color, 'stroke-width': 2, fill: 'none' }, g);
  ratioLines(d, ps, g, color);
  const labels = PATTERN_LABELS.three_drives!;
  ps.forEach((p, i) => pointLabel(g, p, labels[i], color, isPeak(ps, i)));
}

/** Omuz-Baş-Omuz: 7 nokta, omuz/baş bölgeleri boyunduruk çizgisine kadar dolu, boyun çizgisi uzatılmış. */
export function neckline(ps: Px[]): [Px, Px] | null {
  if (ps.length < 5) return null;
  const n1 = ps[2];
  const n2 = ps[4];
  const dx = n2.x - n1.x;
  if (Math.abs(dx) < 1e-9) return [n1, n2];
  const k = (n2.y - n1.y) / dx;
  const x0 = ps[0].x;
  const x1 = ps[ps.length - 1].x;
  return [
    { x: x0, y: n1.y + k * (x0 - n1.x) },
    { x: x1, y: n1.y + k * (x1 - n1.x) },
  ];
}

export function renderHeadShoulders(d: DrawingObject, m: ToolMapper, g: SVGElement): void {
  const ps = visiblePx(m, d.points);
  if (ps.length < 2) return;
  const color = d.color || '#089981';
  const nl = neckline(ps);
  if (nl) {
    const onNeck = (x: number): Px => {
      const [a, b] = nl;
      const dx = b.x - a.x;
      return { x, y: Math.abs(dx) < 1e-9 ? a.y : a.y + ((b.y - a.y) * (x - a.x)) / dx };
    };
    // Varsayılan: formasyon çizgisi ile boyun çizgisi arasındaki alan tek poligon
    if (ps.length >= 3) poly(g, [onNeck(ps[0].x), ...ps.slice(1, -1), onNeck(ps[ps.length - 1].x)], fillAlpha(color));
    line(g, nl[0], nl[1], color, 1.5, '1.5,3');
  }
  mk('path', { d: pathOf(ps), stroke: color, 'stroke-width': 2, fill: 'none' }, g);
  const labels = PATTERN_LABELS.head_shoulders!;
  ps.forEach((p, i) => pointLabel(g, p, labels[i], color, isPeak(ps, i)));
}

/** Elliott dalgaları: zikzak + dalga numaraları; noktalarda küçük daire. */
export function renderElliott(d: DrawingObject, m: ToolMapper, g: SVGElement): void {
  const ps = visiblePx(m, d.points);
  if (ps.length < 2) return;
  const color = d.color || '#0284C7';
  mk('path', { d: pathOf(ps), stroke: color, 'stroke-width': 2, fill: 'none' }, g);
  const labels = PATTERN_LABELS[d.toolType] ?? [];
  ps.forEach((p, i) => {
    if (i > 0) waveLabel(g, p, labels[i] ?? '', color, isPeak(ps, i));
  });
}

// ---------------------------------------------------------------- döngüler

/** Döngüsel çizgiler: x0'dan başlayarak |x1-x0| aralıkla ekran sonuna kadar dikey çizgiler. */
export function cyclicXs(x0: number, x1: number, width: number, max = 400): number[] {
  const step = Math.abs(x1 - x0);
  if (step < 2) return [x0];
  const out: number[] = [];
  let x = Math.min(x0, x1);
  // ekranın solundan da tekrarla
  while (x - step >= 0 && out.length < max) x -= step;
  for (; x <= width && out.length < max; x += step) out.push(x);
  return out;
}

export function renderCyclicLines(d: DrawingObject, m: ToolMapper, g: SVGElement, w: number, h: number): void {
  const ps = visiblePx(m, d.points);
  if (ps.length < 2) return;
  const color = d.color || '#0284C7';
  for (const x of cyclicXs(ps[0].x, ps[1].x, w)) line(g, { x, y: 0 }, { x, y: h }, color, 1);
  line(g, ps[0], ps[1], color, 1, '4,4');
}

/** Zaman döngüleri: taban çizgisi üzerinde |x1-x0| çaplı ardışık yarım elipsler (yükseklik |y1-y0|). */
export function timeCyclePaths(a: Px, b: Px, width: number, max = 200): string[] {
  const dia = Math.abs(b.x - a.x);
  if (dia < 2) return [];
  const rx = dia / 2;
  const ry = Math.max(4, Math.abs(b.y - a.y));
  const up = b.y <= a.y ? 0 : 1;
  const out: string[] = [];
  for (const x of cyclicXs(a.x, b.x, width, max)) {
    out.push(`M${x.toFixed(1)},${a.y.toFixed(1)} A${rx.toFixed(1)},${ry.toFixed(1)} 0 0 ${up} ${(x + dia).toFixed(1)},${a.y.toFixed(1)}`);
  }
  return out;
}

export function renderTimeCycles(d: DrawingObject, m: ToolMapper, g: SVGElement, w: number): void {
  const ps = visiblePx(m, d.points);
  if (ps.length < 2) return;
  const color = d.color || '#0284C7';
  for (const p of timeCyclePaths(ps[0], ps[1], w)) mk('path', { d: p, stroke: color, 'stroke-width': 1.5, fill: color, 'fill-opacity': 0.08 }, g);
}

/** Sinüs çizgisi: a tepe/dip, b yarım periyot sonraki karşı uç. Ekran boyunca örneklenir. */
export function sinePoints(a: Px, b: Px, width: number, step = 3): Px[] {
  const half = b.x - a.x;
  if (Math.abs(half) < 2) return [a, b];
  const mid = (a.y + b.y) / 2;
  const amp = (a.y - b.y) / 2;
  const out: Px[] = [];
  for (let x = 0; x <= width; x += step) out.push({ x, y: mid + amp * Math.cos((Math.PI * (x - a.x)) / half) });
  return out;
}

export function renderSineLine(d: DrawingObject, m: ToolMapper, g: SVGElement, w: number): void {
  const ps = visiblePx(m, d.points);
  if (ps.length < 2) return;
  const color = d.color || '#0284C7';
  mk('path', { d: pathOf(sinePoints(ps[0], ps[1], w)), stroke: color, 'stroke-width': 1.5, fill: 'none' }, g);
}
