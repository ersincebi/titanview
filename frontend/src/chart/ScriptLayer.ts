import type {
  ScriptBgColor,
  ScriptBoxObj,
  ScriptColorPoint,
  ScriptExecutionResult,
  ScriptFill,
  ScriptLabelObj,
  ScriptLineFillObj,
  ScriptLineObj,
  ScriptPlotSeries,
  ScriptPolylineObj,
  ScriptTableObj,
} from '../types/market';

/**
 * Betik görsel katmanı: bgcolor, fill, circles/cross plot stilleri ve line/box/label/table
 * nesneleri bir SVG üzerine çizilir. Veri (zaman, fiyat) cinsinden tutulur; her görünüm
 * değişiminde mapper ile piksele çevrilir. Pointer olaylarını yakalamaz.
 */
export interface LayerMapper {
  /** mantıksal bar indeksi (veri dışı zamanlar için ekstrapole edilir) */
  timeToLogical(t: number): number | null;
  logicalToX(l: number): number | null;
  priceToY(p: number): number | null;
  barSpacing(): number;
  /** t zamanındaki mumun high/low değeri (yloc.abovebar/belowbar için) */
  barRange(t: number): { high: number; low: number } | null;
  /** katman alanı (price scale genişliğini dışarıda bırakır) */
  size(): { width: number; height: number };
  /** katmanın host içindeki üst ofseti (çoklu pane: alt pane'in tepesi); varsayılan 0 */
  top?(): number;
  /** sol fiyat ölçeğinin genişliği: katman bu bandı kırpar */
  clipLeft?(): number;
}

const NS = 'http://www.w3.org/2000/svg';

function el<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number>,
  parent?: Element
): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  parent?.appendChild(e);
  return e;
}

const DASH: Record<string, string> = { solid: '', dashed: '6,4', dotted: '1.5,3' };

// ------------------------------------------------------------------ pure geometry

export interface Pt {
  x: number;
  y: number;
}

/** İki noktadan geçen doğruyu extend kuralına göre [0,w] aralığına kırpar. */
export function clipLine(
  a: Pt,
  b: Pt,
  extend: 'none' | 'left' | 'right' | 'both',
  width: number
): [Pt, Pt] | null {
  if (a.x === b.x) {
    // dikey çizgi: extend yok sayılır
    return [a, b];
  }
  const slope = (b.y - a.y) / (b.x - a.x);
  const at = (x: number): Pt => ({ x, y: a.y + slope * (x - a.x) });
  const left = a.x <= b.x ? a : b;
  const right = a.x <= b.x ? b : a;
  const p1 = extend === 'left' || extend === 'both' ? at(Math.min(left.x, 0) - 50) : left;
  const p2 = extend === 'right' || extend === 'both' ? at(Math.max(right.x, width) + 50) : right;
  return [p1, p2];
}

/** Aynı renkte ardışık barlar tek dikdörtgen olur (render maliyeti). */
export function mergeBgRuns(
  points: ScriptColorPoint[],
  toIndex: (t: number) => number | null
): Array<{ from: number; to: number; color: string }> {
  const runs: Array<{ from: number; to: number; color: string }> = [];
  for (const p of points) {
    const idx = toIndex(p.time);
    if (idx === null) continue;
    const last = runs[runs.length - 1];
    if (last && last.color === p.color && Math.round(idx - last.to) === 1) last.to = idx;
    else runs.push({ from: idx, to: idx, color: p.color });
  }
  return runs;
}

export interface FillRun {
  color: string;
  top: Array<{ t: number; v: number }>;
  bottom: Array<{ t: number; v: number }>;
}

/** fill(): ardışık, aynı renkli ve iki ucu da tanımlı barlardan çokgen koşuları üretir. */
export function buildFillRuns(
  fill: ScriptFill,
  plots: ScriptPlotSeries[]
): FillRun[] {
  const src = (ref: ScriptFill['a']): ((t: number) => number | undefined) => {
    if ('price' in ref) return () => ref.price;
    const p = plots.find((x) => x.id === ref.plot);
    const m = new Map<number, number>();
    for (const d of p?.data ?? []) m.set(d.time, d.value);
    return (t) => m.get(t);
  };
  const fa = src(fill.a);
  const fb = src(fill.b);
  const runs: FillRun[] = [];
  let cur: FillRun | null = null;
  for (const pt of fill.points) {
    const va = fa(pt.time);
    const vb = fb(pt.time);
    if (va === undefined || vb === undefined) {
      cur = null;
      continue;
    }
    if (!cur || cur.color !== pt.color) {
      const prev: FillRun | null = cur;
      cur = { color: pt.color, top: [], bottom: [] };
      // komşu renk geçişinde boşluk kalmasın diye son noktayı paylaş
      if (prev && prev.top.length) {
        const lt = prev.top[prev.top.length - 1];
        const lb = prev.bottom[prev.bottom.length - 1];
        cur.top.push(lt);
        cur.bottom.push(lb);
      }
      runs.push(cur);
    }
    cur.top.push({ t: pt.time, v: va });
    cur.bottom.push({ t: pt.time, v: vb });
  }
  return runs.filter((r) => r.top.length >= 2);
}

/** İki line nesnesi arasındaki linefill dörtgenini (extend dahil) piksel koordinatlarıyla üretir. */
export function buildLineFillPolygon(
  a1: Pt,
  b1: Pt,
  ext1: 'none' | 'left' | 'right' | 'both',
  a2: Pt,
  b2: Pt,
  ext2: 'none' | 'left' | 'right' | 'both',
  width: number
): Pt[] | null {
  const s1 = clipLine(a1, b1, ext1, width);
  const s2 = clipLine(a2, b2, ext2, width);
  if (!s1 || !s2) return null;
  const ord = (s: [Pt, Pt]): [Pt, Pt] =>
    s[0].x < s[1].x || (s[0].x === s[1].x && s[0].y <= s[1].y) ? s : [s[1], s[0]];
  const [p1a, p1b] = ord(s1);
  const [p2a, p2b] = ord(s2);
  if (Math.max(p1b.x, p2b.x) < 0 || Math.min(p1a.x, p2a.x) > width) return null;
  return [p1a, p1b, p2b, p2a];
}

/** polyline.new(): noktaları düz veya Catmull-Rom eğrisi olarak SVG path `d` dizesine çevirir. */
export function buildPolylinePath(pts: Pt[], curved: boolean, closed: boolean): string {
  const n = pts.length;
  if (n < 2) return '';
  const fmt = (p: Pt) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
  if (!curved || n < 3) {
    return `M${fmt(pts[0])}${pts.slice(1).map((p) => ` L${fmt(p)}`).join('')}${closed ? ' Z' : ''}`;
  }
  const segs = closed ? n : n - 1;
  const parts = [`M${fmt(pts[0])}`];
  for (let i = 0; i < segs; i++) {
    const p0 = pts[i === 0 ? (closed ? n - 1 : 0) : i - 1];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const p3 = pts[i + 2 < n ? i + 2 : closed ? (i + 2) % n : n - 1];
    const c1: Pt = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
    const c2: Pt = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
    parts.push(`C${fmt(c1)} ${fmt(c2)} ${fmt(p2)}`);
  }
  if (closed) parts.push('Z');
  return parts.join(' ');
}

export function tableOrigin(
  position: string,
  w: number,
  h: number,
  tw: number,
  th: number
): Pt {
  const pad = 6;
  const x = position.endsWith('left') ? pad : position.endsWith('center') ? (w - tw) / 2 : w - tw - pad;
  const y = position.startsWith('top') ? pad : position.startsWith('middle') ? (h - th) / 2 : h - th - pad - 18;
  return { x, y };
}

// ------------------------------------------------------------------ layer

export class ScriptLayer {
  private svg: SVGSVGElement;
  private res: ScriptExecutionResult | null = null;

  constructor(
    host: HTMLElement,
    private mapper: LayerMapper,
    private pane: 'main' | 'sub'
  ) {
    this.svg = document.createElementNS(NS, 'svg');
    this.svg.setAttribute('class', `titan-script-svg script-layer-${pane}`);
    host.appendChild(this.svg);
  }

  public setResult(res: ScriptExecutionResult | null): void {
    this.res = res && res.ok ? res : null;
    this.render();
  }

  public destroy(): void {
    this.svg.remove();
    this.res = null;
  }

  private mine(isOverlay: boolean): boolean {
    return this.pane === 'main' ? isOverlay : !isOverlay;
  }

  public render(): void {
    while (this.svg.firstChild) this.svg.removeChild(this.svg.firstChild);
    const res = this.res;
    if (!res) return;
    const { width, height } = this.mapper.size();
    if (width <= 0 || height <= 0) return;
    this.svg.style.width = `${width}px`;
    this.svg.style.height = `${height}px`;
    this.svg.style.top = `${this.mapper.top?.() ?? 0}px`;
    const cl = this.mapper.clipLeft?.() ?? 0;
    this.svg.style.clipPath = cl > 0 ? `inset(0 0 0 ${cl}px)` : '';

    for (const bg of res.bgcolors ?? []) if (this.mine(bg.isOverlay)) this.drawBg(bg, width, height);
    for (const f of res.fills ?? []) if (this.mine(f.isOverlay)) this.drawFill(f, res.plots, width);
    for (const p of res.plots) {
      if (p.hidden || !this.mine(p.isOverlay)) continue;
      if (p.style === 'circles' || p.style === 'cross') this.drawPoints(p, width, height);
    }
    if (this.mine(res.isOverlay) && res.drawings) {
      const d = res.drawings;
      for (const lf of d.linefills ?? []) this.drawLineFill(lf, width);
      for (const pl of d.polylines ?? []) this.drawPolyline(pl, width);
      for (const b of d.boxes) this.drawBox(b, width, height);
      for (const l of d.lines) this.drawLine(l, width);
      for (const l of d.labels) this.drawLabel(l, width, height);
      // Betik tabloları grafiği kapatıyordu: artık alttaki 🧮 Tablo sekmesinde gösterilir
    }
  }

  private x(t: number): number | null {
    const l = this.mapper.timeToLogical(t);
    return l === null ? null : this.mapper.logicalToX(l);
  }

  private drawBg(bg: ScriptBgColor, w: number, h: number): void {
    const bw = Math.max(1, this.mapper.barSpacing());
    const runs = mergeBgRuns(bg.points, (t) => this.mapper.timeToLogical(t));
    for (const r of runs) {
      const x1 = this.mapper.logicalToX(r.from);
      const x2 = this.mapper.logicalToX(r.to);
      if (x1 === null || x2 === null) continue;
      const left = Math.min(x1, x2) - bw / 2;
      const right = Math.max(x1, x2) + bw / 2;
      if (right < 0 || left > w) continue;
      el('rect', { x: left, y: 0, width: right - left, height: h, fill: r.color, class: 'script-bg' }, this.svg);
    }
  }

  private drawFill(fill: ScriptFill, plots: ScriptPlotSeries[], w: number): void {
    for (const run of buildFillRuns(fill, plots)) {
      const top: Pt[] = [];
      const bottom: Pt[] = [];
      let ok = true;
      for (let i = 0; i < run.top.length; i++) {
        const x = this.x(run.top[i].t);
        const ya = this.mapper.priceToY(run.top[i].v);
        const yb = this.mapper.priceToY(run.bottom[i].v);
        if (x === null || ya === null || yb === null) {
          ok = false;
          break;
        }
        top.push({ x, y: ya });
        bottom.push({ x, y: yb });
      }
      if (!ok || top.length < 2) continue;
      if (top[top.length - 1].x < 0 || top[0].x > w) continue;
      const pts = [...top, ...bottom.reverse()].map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
      el('polygon', { points: pts, fill: run.color, stroke: 'none', class: 'script-fill' }, this.svg);
    }
  }

  private drawPoints(p: ScriptPlotSeries, w: number, h: number): void {
    const r = Math.max(1.5, p.lineWidth * 1.2);
    for (const d of p.data) {
      const x = this.x(d.time);
      const y = this.mapper.priceToY(d.value);
      if (x === null || y === null || x < -5 || x > w + 5 || y < -5 || y > h + 5) continue;
      const color = d.color ?? p.color;
      if (p.style === 'circles') {
        el('circle', { cx: x, cy: y, r, fill: color, class: 'script-point' }, this.svg);
      } else {
        const s = r + 1;
        el('path', { d: `M${x - s},${y} H${x + s} M${x},${y - s} V${y + s}`, stroke: color, 'stroke-width': Math.max(1, p.lineWidth), class: 'script-point' }, this.svg);
      }
    }
  }

  private drawLineFill(lf: ScriptLineFillObj, w: number): void {
    const x1a = this.x(lf.l1.t1);
    const x1b = this.x(lf.l1.t2);
    const y1a = this.mapper.priceToY(lf.l1.p1);
    const y1b = this.mapper.priceToY(lf.l1.p2);
    const x2a = this.x(lf.l2.t1);
    const x2b = this.x(lf.l2.t2);
    const y2a = this.mapper.priceToY(lf.l2.p1);
    const y2b = this.mapper.priceToY(lf.l2.p2);
    if (
      x1a === null || x1b === null || y1a === null || y1b === null ||
      x2a === null || x2b === null || y2a === null || y2b === null
    ) return;
    const poly = buildLineFillPolygon(
      { x: x1a, y: y1a },
      { x: x1b, y: y1b },
      lf.l1.extend,
      { x: x2a, y: y2a },
      { x: x2b, y: y2b },
      lf.l2.extend,
      w
    );
    if (!poly) return;
    const pts = poly.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    el('polygon', { points: pts, fill: lf.color, stroke: 'none', class: 'script-linefill' }, this.svg);
  }

  private drawPolyline(pl: ScriptPolylineObj, w: number): void {
    const pts: Pt[] = [];
    let minX = Infinity;
    let maxX = -Infinity;
    for (const pt of pl.points) {
      const x = this.x(pt.t);
      const y = this.mapper.priceToY(pt.p);
      if (x === null || y === null) continue;
      pts.push({ x, y });
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
    }
    if (pts.length < 2 || maxX < 0 || minX > w) return;
    const d = buildPolylinePath(pts, pl.curved, pl.closed);
    if (!d) return;
    const hasFill = pl.fillColor && pl.fillColor !== 'transparent' && pl.fillColor !== 'none';
    el(
      'path',
      {
        d,
        fill: hasFill ? pl.fillColor : 'none',
        stroke: pl.lineColor || 'none',
        'stroke-width': Math.max(1, pl.lineWidth),
        'stroke-linejoin': 'round',
        'stroke-linecap': 'round',
        class: 'script-polyline',
        ...(DASH[pl.lineStyle] ? { 'stroke-dasharray': DASH[pl.lineStyle] } : {}),
      },
      this.svg
    );
  }

  private drawLine(l: ScriptLineObj, w: number): void {
    const x1 = this.x(l.t1);
    const x2 = this.x(l.t2);
    const y1 = this.mapper.priceToY(l.p1);
    const y2 = this.mapper.priceToY(l.p2);
    if (x1 === null || x2 === null || y1 === null || y2 === null) return;
    const seg = clipLine({ x: x1, y: y1 }, { x: x2, y: y2 }, l.extend, w);
    if (!seg) return;
    el(
      'line',
      {
        x1: seg[0].x, y1: seg[0].y, x2: seg[1].x, y2: seg[1].y,
        stroke: l.color, 'stroke-width': Math.max(1, l.width), class: 'script-line',
        ...(DASH[l.style] ? { 'stroke-dasharray': DASH[l.style] } : {}),
      },
      this.svg
    );
    if (l.arrow !== 'none') {
      const arrow = (from: Pt, to: Pt) => {
        const ang = Math.atan2(to.y - from.y, to.x - from.x);
        const s = 8 + l.width;
        const pts = [
          to,
          { x: to.x - s * Math.cos(ang - 0.4), y: to.y - s * Math.sin(ang - 0.4) },
          { x: to.x - s * Math.cos(ang + 0.4), y: to.y - s * Math.sin(ang + 0.4) },
        ];
        el('polygon', { points: pts.map((p) => `${p.x},${p.y}`).join(' '), fill: l.color, class: 'script-arrow' }, this.svg);
      };
      if (l.arrow === 'right' || l.arrow === 'both') arrow({ x: x1, y: y1 }, { x: x2, y: y2 });
      if (l.arrow === 'left' || l.arrow === 'both') arrow({ x: x2, y: y2 }, { x: x1, y: y1 });
    }
  }

  private drawBox(b: ScriptBoxObj, w: number, h: number): void {
    let x1 = this.x(b.t1);
    let x2 = this.x(b.t2);
    const yt = this.mapper.priceToY(b.top);
    const yb = this.mapper.priceToY(b.bottom);
    if (x1 === null || x2 === null || yt === null || yb === null) return;
    if (x1 > x2) [x1, x2] = [x2, x1];
    if (b.extend === 'left' || b.extend === 'both') x1 = -10;
    if (b.extend === 'right' || b.extend === 'both') x2 = w + 10;
    const y = Math.min(yt, yb);
    const hh = Math.max(1, Math.abs(yb - yt));
    if (x2 < 0 || x1 > w || y > h || y + hh < 0) return;
    el(
      'rect',
      {
        x: x1, y, width: Math.max(1, x2 - x1), height: hh,
        fill: b.bgColor, stroke: b.borderColor, 'stroke-width': Math.max(0, b.borderWidth), class: 'script-box',
        ...(DASH[b.borderStyle] ? { 'stroke-dasharray': DASH[b.borderStyle] } : {}),
      },
      this.svg
    );
    if (b.text) {
      const t = el(
        'text',
        { x: (x1 + x2) / 2, y: y + hh / 2, 'text-anchor': 'middle', 'dominant-baseline': 'middle', fill: b.textColor, 'font-size': b.textSize, class: 'script-box-text' },
        this.svg
      );
      t.textContent = b.text;
    }
  }

  private drawLabel(l: ScriptLabelObj, w: number, h: number): void {
    const x = this.x(l.t);
    if (x === null || x < -40 || x > w + 40) return;
    let price = l.p;
    if (l.yloc !== 'price') {
      const r = this.mapper.barRange(l.t);
      if (!r) return;
      price = l.yloc === 'abovebar' ? r.high : r.low;
    }
    const y = this.mapper.priceToY(price);
    if (y === null || y < -40 || y > h + 40) return;

    const g = el('g', { class: 'script-label', 'data-style': l.style }, this.svg);
    if (l.tooltip) el('title', {}, g).textContent = l.tooltip;
    const fs = l.size;
    const lines = l.text.split('\n');
    const tw = Math.max(...lines.map((s) => s.length), 1) * fs * 0.62 + 10;
    const th = lines.length * (fs + 3) + 6;

    const markerShapes = ['circle', 'square', 'diamond', 'triangleup', 'triangledown', 'arrowup', 'arrowdown', 'cross', 'xcross', 'flag'];
    const style = l.style.replace(/^label\.style_/, '');
    const text = (cx: number, cy: number, anchor = 'middle') => {
      lines.forEach((s, i) => {
        const t = el('text', { x: cx, y: cy + (i - (lines.length - 1) / 2) * (fs + 3), 'text-anchor': anchor, 'dominant-baseline': 'middle', fill: l.textColor, 'font-size': fs }, g);
        t.textContent = s;
      });
    };

    if (style === 'none') {
      text(x, y);
      return;
    }
    if (markerShapes.includes(style)) {
      const s = Math.max(5, fs * 0.55);
      const c = l.color;
      if (style === 'circle') el('circle', { cx: x, cy: y, r: s, fill: c }, g);
      else if (style === 'square') el('rect', { x: x - s, y: y - s, width: s * 2, height: s * 2, fill: c }, g);
      else if (style === 'diamond') el('polygon', { points: `${x},${y - s} ${x + s},${y} ${x},${y + s} ${x - s},${y}`, fill: c }, g);
      else if (style === 'triangleup' || style === 'arrowup') el('polygon', { points: `${x},${y - s} ${x + s},${y + s} ${x - s},${y + s}`, fill: c }, g);
      else if (style === 'triangledown' || style === 'arrowdown') el('polygon', { points: `${x},${y + s} ${x + s},${y - s} ${x - s},${y - s}`, fill: c }, g);
      else if (style === 'flag') el('path', { d: `M${x},${y + s} V${y - s} H${x + s * 1.6} L${x + s * 1.1},${y - s / 2} L${x + s * 1.6},${y} H${x}`, fill: c, stroke: c }, g);
      else el('path', { d: `M${x - s},${y - s} L${x + s},${y + s} M${x + s},${y - s} L${x - s},${y + s}`, stroke: c, 'stroke-width': 2 }, g);
      if (l.text) text(x, style.endsWith('up') ? y + s + fs : y - s - fs);
      return;
    }

    // balon etiketler: (bx,by) balonun sol-üstü; ucu (x,y) noktasına bakar
    const gap = 6;
    let bx = x - tw / 2;
    let by = y - th - gap; // label_down: balon noktanın üstünde, ok aşağı
    let tip = `M${x - 4},${y - gap} L${x},${y} L${x + 4},${y - gap} Z`;
    if (style === 'label_up') {
      by = y + gap;
      tip = `M${x - 4},${y + gap} L${x},${y} L${x + 4},${y + gap} Z`;
    } else if (style === 'label_left') {
      bx = x + gap;
      by = y - th / 2;
      tip = `M${x + gap},${y - 4} L${x},${y} L${x + gap},${y + 4} Z`;
    } else if (style === 'label_right') {
      bx = x - tw - gap;
      by = y - th / 2;
      tip = `M${x - gap},${y - 4} L${x},${y} L${x - gap},${y + 4} Z`;
    } else if (style === 'label_center') {
      by = y - th / 2;
      tip = '';
    } else if (style === 'label_lower_left') {
      bx = x;
      by = y + gap;
      tip = '';
    } else if (style === 'label_lower_right') {
      bx = x - tw;
      by = y + gap;
      tip = '';
    } else if (style === 'label_upper_left') {
      bx = x;
      by = y - th - gap;
      tip = '';
    } else if (style === 'label_upper_right') {
      bx = x - tw;
      by = y - th - gap;
      tip = '';
    }
    el('rect', { x: bx, y: by, width: tw, height: th, rx: 3, fill: l.color }, g);
    if (tip) el('path', { d: tip, fill: l.color }, g);
    text(bx + tw / 2, by + th / 2);
  }
}
