import type { DrawingObject, TimePricePoint } from '../../types/market';
import { allPx, hitPath, mk, poly, toPx, type Px, type ToolMapper } from './svg';

const pts = (ps: Px[]) => ps.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

/** Vurgulayıcı: geniş, yarı saydam serbest el çizgisi (Highlighter). */
export const HIGHLIGHTER_WIDTH = 20;

export function renderHighlighter(d: DrawingObject, m: ToolMapper, g: SVGElement): void {
  const ps = d.points.map((p) => toPx(m, p)).filter((p): p is Px => p !== null);
  if (ps.length < 2) return;
  mk(
    'polyline',
    {
      points: pts(ps),
      fill: 'none',
      stroke: d.color || '#FFEB3B',
      'stroke-opacity': 0.4,
      'stroke-width': d.width ?? HIGHLIGHTER_WIDTH,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      'data-keep-style': '1',
    },
    g
  );
}

/** Ok işareti (Arrow Marker): p0 kuyruk, p1 uç; kalın dolu ok gövdesi. */
export function arrowMarkerPolygon(a: Px, b: Px, thick = 10): Px[] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return [a];
  const ux = dx / len;
  const uy = dy / len;
  const nx = -uy;
  const ny = ux;
  const head = Math.min(len * 0.45, thick * 3);
  const hw = thick * 1.4;
  const sw = thick / 2;
  const base = { x: b.x - ux * head, y: b.y - uy * head };
  return [
    { x: a.x + nx * sw * 0.4, y: a.y + ny * sw * 0.4 },
    { x: base.x + nx * sw, y: base.y + ny * sw },
    { x: base.x + nx * hw, y: base.y + ny * hw },
    b,
    { x: base.x - nx * hw, y: base.y - ny * hw },
    { x: base.x - nx * sw, y: base.y - ny * sw },
    { x: a.x - nx * sw * 0.4, y: a.y - ny * sw * 0.4 },
  ];
}

export function renderArrowMarker(d: DrawingObject, m: ToolMapper, g: SVGElement): void {
  const p = allPx(m, d, Math.min(2, d.points.length));
  if (!p || p.length < 2) return;
  const color = d.color || '#0284C7';
  poly(g, arrowMarkerPolygon(p[0], p[1]), { fill: color, stroke: color, 'stroke-width': 1, 'stroke-linejoin': 'round' });
}

/** Yukarı / aşağı ok işareti: noktanın altında (yukarı) / üstünde (aşağı) dolu ok, Standart yeşil/kırmızı. */
export function markArrowPolygon(a: Px, up: boolean): Px[] {
  const s = up ? 1 : -1;
  const tip = { x: a.x, y: a.y + s * 4 };
  return [
    tip,
    { x: a.x + 10, y: tip.y + s * 11 },
    { x: a.x + 4, y: tip.y + s * 11 },
    { x: a.x + 4, y: tip.y + s * 24 },
    { x: a.x - 4, y: tip.y + s * 24 },
    { x: a.x - 4, y: tip.y + s * 11 },
    { x: a.x - 10, y: tip.y + s * 11 },
  ];
}

export function renderMarkArrow(up: boolean) {
  return (d: DrawingObject, m: ToolMapper, g: SVGElement): void => {
    const a = d.points[0] && toPx(m, d.points[0]);
    if (!a) return;
    const color = d.color || (up ? '#089981' : '#F23645');
    poly(g, markArrowPolygon(a, up), { fill: color, stroke: color, 'stroke-width': 1, 'stroke-linejoin': 'round' });
    if (d.label) {
      const t = mk('text', { x: a.x, y: up ? a.y + 42 : a.y - 34, fill: color, 'font-size': 12, 'text-anchor': 'middle' }, g);
      t.textContent = d.label;
    }
  };
}

/** Döndürülmüş dikdörtgen: p0-p1 bir kenar; p2'nin bu kenara dik uzaklığı genişlik. */
export function rotatedRectCorners(a: Px, b: Px, c: Px): Px[] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const dist = (c.x - a.x) * nx + (c.y - a.y) * ny;
  return [a, b, { x: b.x + nx * dist, y: b.y + ny * dist }, { x: a.x + nx * dist, y: a.y + ny * dist }];
}

const SHAPE_FILL = 0.2;

export function renderRotatedRect(d: DrawingObject, m: ToolMapper, g: SVGElement): void {
  const p = allPx(m, d, Math.min(3, d.points.length));
  if (!p || p.length < 2) return;
  const color = d.color || '#9C27B0';
  if (p.length < 3) {
    mk('line', { x1: p[0].x, y1: p[0].y, x2: p[1].x, y2: p[1].y, stroke: color, 'stroke-width': 2 }, g);
    return;
  }
  poly(g, rotatedRectCorners(p[0], p[1], p[2]), { fill: color, 'fill-opacity': SHAPE_FILL, stroke: color, 'stroke-width': 2 });
}

/** Yol (açık, ok uçlu) ve çoklu çizgi (kapalı, dolgulu). */
export function renderPath(closed: boolean) {
  return (d: DrawingObject, m: ToolMapper, g: SVGElement): void => {
    const ps = d.points.map((p) => toPx(m, p)).filter((p): p is Px => p !== null);
    if (ps.length < 2) return;
    const color = d.color || (closed ? '#0284C7' : '#0284C7');
    if (closed && ps.length >= 3) {
      poly(g, ps, { fill: color, 'fill-opacity': SHAPE_FILL, stroke: color, 'stroke-width': 2, 'stroke-linejoin': 'round' });
      return;
    }
    mk('polyline', { points: pts(ps), fill: 'none', stroke: color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, g);
    hitPath(g, `M${ps.map((p) => `${p.x},${p.y}`).join(' L')}`);
    if (!closed) {
      const a = ps[ps.length - 2];
      const b = ps[ps.length - 1];
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      const s = 10;
      poly(
        g,
        [b, { x: b.x - s * Math.cos(ang - 0.45), y: b.y - s * Math.sin(ang - 0.45) }, { x: b.x - s * Math.cos(ang + 0.45), y: b.y - s * Math.sin(ang + 0.45) }],
        { fill: color, stroke: 'none' }
      );
    }
  };
}

/** Daire: p0 merkez, p1 çember üzerinde (ekranda gerçek daire). */
export function circleRadius(a: Px, b: Px): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function renderCircle(d: DrawingObject, m: ToolMapper, g: SVGElement): void {
  const p = allPx(m, d, Math.min(2, d.points.length));
  if (!p || p.length < 2) return;
  const color = d.color || '#FF9800';
  mk('circle', { cx: p[0].x, cy: p[0].y, r: Math.max(1, circleRadius(p[0], p[1])), fill: color, 'fill-opacity': SHAPE_FILL, stroke: color, 'stroke-width': 2 }, g);
}

export function renderTriangle(d: DrawingObject, m: ToolMapper, g: SVGElement): void {
  const p = allPx(m, d, Math.min(3, d.points.length));
  if (!p || p.length < 2) return;
  const color = d.color || '#F57C00';
  if (p.length < 3) {
    mk('line', { x1: p[0].x, y1: p[0].y, x2: p[1].x, y2: p[1].y, stroke: color, 'stroke-width': 2 }, g);
    return;
  }
  poly(g, p, { fill: color, 'fill-opacity': SHAPE_FILL, stroke: color, 'stroke-width': 2, 'stroke-linejoin': 'round' });
}

/** Yay: p0 başlangıç, p1 bitiş, p2 eğri üzerindeki tepe (t=0.5'te geçer) → ikinci derece Bézier. */
export function arcControl(a: Px, b: Px, c: Px): Px {
  return { x: 2 * c.x - (a.x + b.x) / 2, y: 2 * c.y - (a.y + b.y) / 2 };
}

export function renderArc(d: DrawingObject, m: ToolMapper, g: SVGElement): void {
  const p = allPx(m, d, Math.min(3, d.points.length));
  if (!p || p.length < 2) return;
  const color = d.color || '#9C27B0';
  if (p.length < 3) {
    mk('line', { x1: p[0].x, y1: p[0].y, x2: p[1].x, y2: p[1].y, stroke: color, 'stroke-width': 2 }, g);
    return;
  }
  const k = arcControl(p[0], p[1], p[2]);
  const dPath = `M${p[0].x},${p[0].y} Q${k.x},${k.y} ${p[1].x},${p[1].y}`;
  mk('path', { d: `${dPath} Z`, fill: color, 'fill-opacity': SHAPE_FILL, stroke: 'none' }, g);
  mk('path', { d: dPath, fill: 'none', stroke: color, 'stroke-width': 2 }, g);
}

/**
 * Eğri (2 tık): p0 → p1, kontrol noktası tamamlanınca türetilir (orta noktadan dik %25 kayma).
 * Çift eğri (2 tık): S biçimli kübik, iki kontrol noktası ters yönlerde.
 */
export function deriveCurveControls(tool: 'curve' | 'double_curve', a: TimePricePoint, b: TimePricePoint): TimePricePoint[] {
  const dt = b.time - a.time;
  const dp = b.price - a.price;
  const off = Math.abs(dp) > 0 ? dp * 0.5 : Math.abs(a.price) * 0.01 || 1;
  if (tool === 'curve') return [{ time: Math.round(a.time + dt * 0.5), price: a.price + dp * 0.5 + off }];
  return [
    { time: Math.round(a.time + dt * 0.25), price: a.price + dp * 0.25 + off },
    { time: Math.round(a.time + dt * 0.75), price: a.price + dp * 0.75 - off },
  ];
}

export function curvePath(p: Px[], tool: 'curve' | 'double_curve'): string {
  const [a, b] = p;
  if (tool === 'curve') {
    const c = p[2] ?? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 - Math.abs(b.x - a.x) * 0.25 };
    return `M${a.x},${a.y} Q${c.x},${c.y} ${b.x},${b.y}`;
  }
  const c1 = p[2] ?? { x: a.x + (b.x - a.x) * 0.25, y: a.y + (b.y - a.y) * 0.25 - Math.abs(b.x - a.x) * 0.25 };
  const c2 = p[3] ?? { x: a.x + (b.x - a.x) * 0.75, y: a.y + (b.y - a.y) * 0.75 + Math.abs(b.x - a.x) * 0.25 };
  return `M${a.x},${a.y} C${c1.x},${c1.y} ${c2.x},${c2.y} ${b.x},${b.y}`;
}

export function renderCurve(tool: 'curve' | 'double_curve') {
  return (d: DrawingObject, m: ToolMapper, g: SVGElement): void => {
    const p = allPx(m, d);
    if (!p || p.length < 2) return;
    const color = d.color || '#0284C7';
    const dPath = curvePath(p, tool);
    mk('path', { d: dPath, fill: 'none', stroke: color, 'stroke-width': 2 }, g);
    hitPath(g, dPath);
    // kontrol noktalarına ince kılavuz (yalnız seçiliyken anlamlı ama hafif)
    if (p.length > 2) {
      const guides = tool === 'curve' ? [[0, 2], [2, 1]] : [[0, 2], [3, 1]];
      for (const [i, j] of guides) {
        if (!p[i] || !p[j]) continue;
        mk('line', { x1: p[i].x, y1: p[i].y, x2: p[j].x, y2: p[j].y, stroke: color, 'stroke-width': 0.5, 'stroke-opacity': 0.35, 'stroke-dasharray': '2,3', 'data-keep-style': '1', class: 'curve-guide' }, g);
      }
    }
  };
}
