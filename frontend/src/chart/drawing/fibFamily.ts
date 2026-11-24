import type { DrawingObject } from '../../types/market';
import { allPx, extendRay, fibColor, line, mk, poly, text, type Px, type ToolMapper } from './svg';

/** Standart Fib çizimleri seviye kümeleri (varsayılan görünen seviyeler). */
export const FIB_CHANNEL_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.618, 2.618, 3.618, 4.236];
export const FIB_TIMEZONE_STEPS = [0, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89];
export const FIB_SPEED_LEVELS = [0, 0.25, 0.382, 0.5, 0.618, 0.75, 1];
export const FIB_TREND_TIME_LEVELS = [0, 0.382, 0.5, 0.618, 1, 1.382, 1.618, 2, 2.382, 2.618, 3, 3.618, 4.236];
export const FIB_CIRCLE_LEVELS = [0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.618, 2.618, 3.618, 4.236];
export const FIB_ARC_LEVELS = [0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.618, 2.618, 3.618, 4.236, 4.618];
export const FIB_WEDGE_LEVELS = [0.236, 0.382, 0.5, 0.618, 0.786, 1];
export const FIB_PITCHFAN_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];

const lvlText = (l: number) => String(l);

// ---------------------------------------------------------------- Fib kanal

/** Taban p0-p1; genişlik vektörü = p2'nin tabana göre dikey (y) kayması. Seviye k → taban + k·kayma. */
export function fibChannelOffsets(p: Px[]): { dy: number } {
  const [a, b, c] = p;
  const slope = b.x !== a.x ? (b.y - a.y) / (b.x - a.x) : 0;
  return { dy: c.y - (a.y + slope * (c.x - a.x)) };
}

export function renderFibChannel(d: DrawingObject, m: ToolMapper, g: SVGElement): void {
  const p = allPx(m, d, Math.min(3, d.points.length));
  if (!p || p.length < 2) return;
  const [a, b] = p;
  if (p.length < 3) {
    line(g, a, b, '#787B86', 1);
    return;
  }
  const { dy } = fibChannelOffsets(p);
  let prev: [Px, Px] | null = null;
  FIB_CHANNEL_LEVELS.forEach((lv, i) => {
    const s = { x: a.x, y: a.y + dy * lv };
    const e = { x: b.x, y: b.y + dy * lv };
    const col = fibColor(lv, i);
    if (prev) poly(g, [prev[0], prev[1], e, s], { fill: col, 'fill-opacity': 0.08, stroke: 'none' });
    line(g, s, e, col, 1).setAttribute('data-level', lvlText(lv));
    text(g, Math.min(s.x, e.x) - 4, (s.x <= e.x ? s.y : e.y) + 4, lvlText(lv), col, 10, 'end');
    prev = [s, e];
  });
}

// ---------------------------------------------------------------- Fib zaman bölgesi

export function fibTimezoneXs(x0: number, x1: number): Array<{ step: number; x: number }> {
  const unit = x1 - x0;
  return FIB_TIMEZONE_STEPS.map((step) => ({ step, x: x0 + unit * step }));
}

export function renderFibTimezone(d: DrawingObject, m: ToolMapper, g: SVGElement, w: number, h: number): void {
  const p = allPx(m, d, Math.min(2, d.points.length));
  if (!p || p.length < 2) return;
  fibTimezoneXs(p[0].x, p[1].x).forEach(({ step, x }, i) => {
    if (x < -2 || x > w + 2) return;
    const col = i === 0 ? '#787B86' : '#0284C7';
    line(g, { x, y: 0 }, { x, y: h }, col, 1).setAttribute('data-step', String(step));
    text(g, x + 4, h - 8, String(step), col, 10);
  });
}

// ---------------------------------------------------------------- Fib hız direnci yelpazesi

export function speedFanTargets(a: Px, b: Px, levels = FIB_SPEED_LEVELS): { price: Px[]; time: Px[] } {
  return {
    price: levels.map((l) => ({ x: b.x, y: a.y + (b.y - a.y) * l })),
    time: levels.map((l) => ({ x: a.x + (b.x - a.x) * l, y: b.y })),
  };
}

export function renderFibSpeedFan(d: DrawingObject, m: ToolMapper, g: SVGElement, w: number, h: number): void {
  const p = allPx(m, d, Math.min(2, d.points.length));
  if (!p || p.length < 2) return;
  const [a, b] = p;
  const t = speedFanTargets(a, b);
  FIB_SPEED_LEVELS.forEach((lv, i) => {
    const col = fibColor(lv, i);
    // ızgara
    line(g, { x: a.x, y: t.price[i].y }, { x: b.x, y: t.price[i].y }, col, 1, '2,3').setAttribute('data-keep-style', '1');
    line(g, { x: t.time[i].x, y: a.y }, { x: t.time[i].x, y: b.y }, col, 1, '2,3').setAttribute('data-keep-style', '1');
    if (lv === 0) return;
    const r1 = extendRay(a, t.price[i], 'right', w, h);
    line(g, r1[0], r1[1], col, 1).setAttribute('data-fan', `p${lv}`);
    if (lv !== 1) {
      const r2 = extendRay(a, t.time[i], 'right', w, h);
      line(g, r2[0], r2[1], col, 1).setAttribute('data-fan', `t${lv}`);
    }
    text(g, b.x + 4, t.price[i].y + 4, lvlText(lv), col, 10);
  });
}

// ---------------------------------------------------------------- trend tabanlı Fib zaman

export function trendTimeXs(p: Px[], levels = FIB_TREND_TIME_LEVELS): Array<{ level: number; x: number }> {
  const unit = p[1].x - p[0].x;
  return levels.map((level) => ({ level, x: p[2].x + unit * level }));
}

export function renderFibTrendTime(d: DrawingObject, m: ToolMapper, g: SVGElement, w: number, h: number): void {
  const p = allPx(m, d, Math.min(3, d.points.length));
  if (!p || p.length < 2) return;
  line(g, p[0], p[1], '#787B86', 1, '4,3');
  if (p.length < 3) return;
  line(g, p[1], p[2], '#787B86', 1, '4,3');
  trendTimeXs(p).forEach(({ level, x }, i) => {
    if (x < -2 || x > w + 2) return;
    const col = fibColor(level, i);
    line(g, { x, y: 0 }, { x, y: h }, col, 1).setAttribute('data-level', lvlText(level));
    text(g, x + 4, h - 8, lvlText(level), col, 10);
  });
}

// ---------------------------------------------------------------- Fib daireler

/** Merkez = p0-p1 orta noktası; seviye 1 dairesi iki noktadan geçer (çap = |p0p1|). */
export function fibCircles(a: Px, b: Px): Array<{ level: number; cx: number; cy: number; r: number }> {
  const cx = (a.x + b.x) / 2;
  const cy = (a.y + b.y) / 2;
  const r1 = Math.hypot(b.x - a.x, b.y - a.y) / 2;
  return FIB_CIRCLE_LEVELS.map((level) => ({ level, cx, cy, r: r1 * level }));
}

export function renderFibCircles(d: DrawingObject, m: ToolMapper, g: SVGElement): void {
  const p = allPx(m, d, Math.min(2, d.points.length));
  if (!p || p.length < 2) return;
  const circles = fibCircles(p[0], p[1]);
  // Varsayılan: halkalar arası seviye rengiyle dolu bantlar (dıştan içe çizilir ki içteki üstte kalsın)
  for (let i = circles.length - 1; i >= 0; i--) {
    const c = circles[i];
    mk('circle', { cx: c.cx, cy: c.cy, r: Math.max(0.5, c.r), fill: fibColor(c.level, i), 'fill-opacity': 0.12, stroke: 'none' }, g);
  }
  circles.forEach((c, i) => {
    const col = fibColor(c.level, i);
    mk('circle', { cx: c.cx, cy: c.cy, r: Math.max(0.5, c.r), fill: 'none', stroke: col, 'stroke-width': 1, 'data-level': lvlText(c.level) }, g);
    if (c.level >= 1) text(g, c.cx, c.cy + c.r - 4, lvlText(c.level), col, 10, 'middle');
  });
  line(g, p[0], p[1], '#787B86', 1, '4,3');
}

// ---------------------------------------------------------------- Fib sarmal

const PHI = (1 + Math.sqrt(5)) / 2;

/** Altın sarmal: merkez p0, p1'de r0; her çeyrek turda yarıçap φ katı (saat yönünün tersine büyür). */
export function fibSpiralPoints(a: Px, b: Px, turnsIn = 3, turnsOut = 2, step = Math.PI / 32): Px[] {
  const r0 = Math.hypot(b.x - a.x, b.y - a.y);
  if (r0 < 1e-9) return [a];
  const th0 = Math.atan2(b.y - a.y, b.x - a.x);
  const pts: Px[] = [];
  for (let t = -turnsIn * 2 * Math.PI; t <= turnsOut * 2 * Math.PI + 1e-9; t += step) {
    const r = r0 * Math.pow(PHI, t / (Math.PI / 2));
    // ekranda y aşağı → saat yönünün tersi için açıyı azalt
    const ang = th0 - t;
    pts.push({ x: a.x + r * Math.cos(ang), y: a.y + r * Math.sin(ang) });
  }
  return pts;
}

export function renderFibSpiral(d: DrawingObject, m: ToolMapper, g: SVGElement, w: number, h: number): void {
  const p = allPx(m, d, Math.min(2, d.points.length));
  if (!p || p.length < 2) return;
  const color = d.color || '#F23645';
  const lim = Math.hypot(w, h) * 2;
  const pts = fibSpiralPoints(p[0], p[1]).filter((q) => Math.hypot(q.x - p[0].x, q.y - p[0].y) < lim);
  line(g, p[0], p[1], color, 1, '4,3');
  if (pts.length > 1) mk('polyline', { points: pts.map((q) => `${q.x.toFixed(1)},${q.y.toFixed(1)}`).join(' '), fill: 'none', stroke: color, 'stroke-width': 1 }, g);
}

// ---------------------------------------------------------------- Fib hız direnci yayları

/** Merkez p0, yarıçap seviye·|p0p1|; yaylar p1'in bulunduğu dikey yarıda (yukarı/aşağı). */
export function speedArcs(a: Px, b: Px): Array<{ level: number; r: number; d: string }> {
  const R = Math.hypot(b.x - a.x, b.y - a.y);
  const up = b.y <= a.y;
  return FIB_ARC_LEVELS.map((level) => {
    const r = R * level;
    const sweep = up ? 1 : 0;
    return { level, r, d: `M${a.x - r},${a.y} A${r},${r} 0 0 ${sweep} ${a.x + r},${a.y}` };
  });
}

export function renderFibSpeedArcs(d: DrawingObject, m: ToolMapper, g: SVGElement): void {
  const p = allPx(m, d, Math.min(2, d.points.length));
  if (!p || p.length < 2) return;
  const arcs = speedArcs(p[0], p[1]);
  const up = p[1].y <= p[0].y;
  for (let i = arcs.length - 1; i >= 0; i--) {
    mk('path', { d: `${arcs[i].d} Z`, fill: fibColor(arcs[i].level, i), 'fill-opacity': 0.12, stroke: 'none' }, g);
  }
  arcs.forEach((arc, i) => {
    const col = fibColor(arc.level, i);
    mk('path', { d: arc.d, fill: 'none', stroke: col, 'stroke-width': 1, 'data-level': lvlText(arc.level) }, g);
    text(g, p[0].x, p[0].y + (up ? -arc.r + 11 : arc.r - 3), lvlText(arc.level), col, 9, 'middle');
  });
  line(g, p[0], p[1], '#787B86', 1, '4,3');
}

// ---------------------------------------------------------------- Fib kama

/** Tepe p0; ışınlar p0→p1 ve p0→p2; yaylar seviye·|p0p1| yarıçapla iki ışın arasında. */
export function wedgeArcs(a: Px, b: Px, c: Px): Array<{ level: number; r: number; from: Px; to: Px; large: 0 | 1; sweep: 0 | 1 }> {
  const R = Math.hypot(b.x - a.x, b.y - a.y);
  const t1 = Math.atan2(b.y - a.y, b.x - a.x);
  const t2 = Math.atan2(c.y - a.y, c.x - a.x);
  let delta = t2 - t1;
  while (delta > Math.PI) delta -= 2 * Math.PI;
  while (delta < -Math.PI) delta += 2 * Math.PI;
  const sweep: 0 | 1 = delta > 0 ? 1 : 0;
  return FIB_WEDGE_LEVELS.map((level) => {
    const r = R * level;
    return {
      level,
      r,
      from: { x: a.x + r * Math.cos(t1), y: a.y + r * Math.sin(t1) },
      to: { x: a.x + r * Math.cos(t2), y: a.y + r * Math.sin(t2) },
      large: 0,
      sweep,
    };
  });
}

export function renderFibWedge(d: DrawingObject, m: ToolMapper, g: SVGElement): void {
  const p = allPx(m, d, Math.min(3, d.points.length));
  if (!p || p.length < 2) return;
  line(g, p[0], p[1], '#787B86', 1);
  if (p.length < 3) return;
  const arcs = wedgeArcs(p[0], p[1], p[2]);
  const R = arcs[arcs.length - 1].r;
  const t2 = Math.atan2(p[2].y - p[0].y, p[2].x - p[0].x);
  line(g, p[0], { x: p[0].x + R * Math.cos(t2), y: p[0].y + R * Math.sin(t2) }, '#787B86', 1);
  let prev: (typeof arcs)[number] | null = null;
  arcs.forEach((a, i) => {
    const col = fibColor(a.level, i);
    const arcD = `M${a.from.x},${a.from.y} A${a.r},${a.r} 0 ${a.large} ${a.sweep} ${a.to.x},${a.to.y}`;
    const fillD = prev
      ? `${arcD} L${prev.to.x},${prev.to.y} A${prev.r},${prev.r} 0 0 ${a.sweep ? 0 : 1} ${prev.from.x},${prev.from.y} Z`
      : `M${p[0].x},${p[0].y} L${a.from.x},${a.from.y} A${a.r},${a.r} 0 0 ${a.sweep} ${a.to.x},${a.to.y} Z`;
    mk('path', { d: fillD, fill: col, 'fill-opacity': 0.2, stroke: 'none' }, g);
    mk('path', { d: arcD, fill: 'none', stroke: col, 'stroke-width': 1, 'data-level': lvlText(a.level) }, g);
    prev = a;
  });
}

// ---------------------------------------------------------------- Pitchfan

export function pitchfanTargets(p: Px[], levels = FIB_PITCHFAN_LEVELS): Array<{ level: number; up: Px; down: Px }> {
  const [, b, c] = p;
  const mid = { x: (b.x + c.x) / 2, y: (b.y + c.y) / 2 };
  return levels.map((level) => ({
    level,
    up: { x: mid.x + (b.x - mid.x) * level, y: mid.y + (b.y - mid.y) * level },
    down: { x: mid.x + (c.x - mid.x) * level, y: mid.y + (c.y - mid.y) * level },
  }));
}

export function renderFibPitchfan(d: DrawingObject, m: ToolMapper, g: SVGElement, w: number, h: number): void {
  const p = allPx(m, d, Math.min(3, d.points.length));
  if (!p || p.length < 2) return;
  if (p.length < 3) {
    line(g, p[0], p[1], '#787B86', 1);
    return;
  }
  line(g, p[1], p[2], '#787B86', 1, '4,3');
  let prevUp: [Px, Px] | null = null;
  let prevDown: [Px, Px] | null = null;
  pitchfanTargets(p).forEach((t, i) => {
    const col = fibColor(t.level, i);
    const ru = extendRay(p[0], t.up, 'right', w, h);
    const rd = extendRay(p[0], t.down, 'right', w, h);
    if (prevUp) poly(g, [p[0], prevUp[1], ru[1]], { fill: col, 'fill-opacity': 0.08, stroke: 'none' });
    if (prevDown) poly(g, [p[0], prevDown[1], rd[1]], { fill: col, 'fill-opacity': 0.08, stroke: 'none' });
    line(g, ru[0], ru[1], col, 1).setAttribute('data-level', lvlText(t.level));
    if (t.level !== 0) line(g, rd[0], rd[1], col, 1);
    prevUp = ru;
    prevDown = rd;
  });
}
