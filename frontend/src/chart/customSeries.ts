import { customSeriesDefaultOptions, type CustomData, type CustomSeriesOptions, type ICustomSeriesPaneRenderer, type ICustomSeriesPaneView, type PaneRendererCustomData, type PriceToCoordinateConverter, type Time } from 'lightweight-charts';
import type { KagiPart } from './chartTypes';

/**
 * Standart grafik tipleri için lightweight-charts v5 özel serileri:
 * Volume candles, HLC area, Columns, High-low, Kagi, Point & Figure.
 * Hepsi bitmap koordinatında çizer (keskin piksel, HiDPI).
 */

/** fancy-canvas hedefinin kullandığımız kısmı (paket doğrudan bağımlılık değil). */
export interface BitmapScope {
  context: CanvasRenderingContext2D;
  horizontalPixelRatio: number;
  verticalPixelRatio: number;
  bitmapSize: { width: number; height: number };
  mediaSize: { width: number; height: number };
}
export interface RenderTarget {
  useBitmapCoordinateSpace<T>(f: (s: BitmapScope) => T): T;
}

export interface TvSeriesOptions extends CustomSeriesOptions {
  upColor: string;
  downColor: string;
  neutralColor: string;
  textColor: string;
}

const BASE_OPTS: TvSeriesOptions = {
  ...customSeriesDefaultOptions,
  upColor: '#089981',
  downColor: '#F23645',
  neutralColor: '#0284C7',
  textColor: '#B8B8B8',
};

export interface OhlcvData extends CustomData<Time> {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  /** önceki kapanış (Columns: renk önceki kapanışa göre) */
  prevClose?: number;
  kagi?: KagiPart[];
  pnf?: { kind: 'X' | 'O'; box: number };
}

type Frame = PaneRendererCustomData<Time, OhlcvData>;

abstract class BaseView implements ICustomSeriesPaneView<Time, OhlcvData, TvSeriesOptions> {
  protected data: Frame | null = null;
  protected opts: TvSeriesOptions = BASE_OPTS;
  renderer(): ICustomSeriesPaneRenderer {
    return {
      draw: (target: unknown, conv: PriceToCoordinateConverter) => {
        const d = this.data;
        if (!d || !d.visibleRange || d.bars.length === 0) return;
        (target as RenderTarget).useBitmapCoordinateSpace((s) => this.drawFrame(s, d, conv));
      },
    };
  }
  update(data: Frame, options: TvSeriesOptions): void {
    this.data = data;
    this.opts = options;
  }
  priceValueBuilder(row: OhlcvData): number[] {
    return [row.low, row.high, row.close];
  }
  isWhitespace(row: OhlcvData | CustomData<Time>): row is CustomData<Time> {
    return (row as OhlcvData).close === undefined || !Number.isFinite((row as OhlcvData).close);
  }
  defaultOptions(): TvSeriesOptions {
    return { ...BASE_OPTS };
  }
  protected abstract drawFrame(s: BitmapScope, d: Frame, conv: PriceToCoordinateConverter): void;
}

/** px (medya) → bitmap, yarım piksele hizalı. */
function yb(conv: PriceToCoordinateConverter, price: number, r: number): number {
  const y = conv(price);
  return y === null ? NaN : Math.round(y * r);
}

function rangeOf(d: Frame): [number, number] {
  return [Math.max(0, d.visibleRange!.from), Math.min(d.bars.length, d.visibleRange!.to)];
}

/** Volume candles: gövde genişliği görünür aralıktaki en büyük hacme oranla. */
export class VolumeCandlesView extends BaseView {
  protected drawFrame(s: BitmapScope, d: Frame, conv: PriceToCoordinateConverter): void {
    const ctx = s.context;
    const hr = s.horizontalPixelRatio;
    const vr = s.verticalPixelRatio;
    const [from, to] = rangeOf(d);
    let maxV = 0;
    for (let i = from; i < to; i++) maxV = Math.max(maxV, d.bars[i].originalData.volume || 0);
    const full = Math.max(1, d.barSpacing * d.conflationFactor * 0.92);
    for (let i = from; i < to; i++) {
      const b = d.bars[i];
      const o = b.originalData;
      const up = o.close >= o.open;
      const w = Math.max(1, full * (maxV > 0 ? Math.max(0.12, (o.volume || 0) / maxV) : 1));
      const x = b.x * hr;
      const yo = yb(conv, o.open, vr);
      const yc = yb(conv, o.close, vr);
      const yh = yb(conv, o.high, vr);
      const yl = yb(conv, o.low, vr);
      ctx.fillStyle = up ? this.opts.upColor : this.opts.downColor;
      const wick = Math.max(1, Math.floor(hr));
      ctx.fillRect(Math.round(x - wick / 2), yh, wick, Math.max(1, yl - yh));
      const bw = Math.max(1, Math.round(w * hr));
      ctx.fillRect(Math.round(x - bw / 2), Math.min(yo, yc), bw, Math.max(1, Math.abs(yc - yo)));
    }
  }
}

/** HLC area: yüksek, düşük, kapanış çizgileri; yüksek-kapanış yeşil, kapanış-düşük kırmızı dolgu. */
export class HlcAreaView extends BaseView {
  protected drawFrame(s: BitmapScope, d: Frame, conv: PriceToCoordinateConverter): void {
    const ctx = s.context;
    const hr = s.horizontalPixelRatio;
    const vr = s.verticalPixelRatio;
    const [from, to] = rangeOf(d);
    const a = Math.max(0, from - 1);
    const b = Math.min(d.bars.length, to + 1);
    if (b - a < 1) return;
    const pts = d.bars.slice(a, b).map((bar) => ({
      x: bar.x * hr,
      h: yb(conv, bar.originalData.high, vr),
      l: yb(conv, bar.originalData.low, vr),
      c: yb(conv, bar.originalData.close, vr),
    }));
    const band = (top: 'h' | 'c', bot: 'c' | 'l', fill: string) => {
      ctx.beginPath();
      pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p[top]) : ctx.lineTo(p.x, p[top])));
      for (let i = pts.length - 1; i >= 0; i--) ctx.lineTo(pts[i].x, pts[i][bot]);
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
    };
    // Varsayılan değerler (chartStyleProperties(16)): yüksek #00bcd4, düşük #e91e63, kapanış #0284C7, dolgu %25
    band('h', 'c', 'rgba(0, 188, 212, 0.25)');
    band('c', 'l', 'rgba(233, 30, 99, 0.25)');
    const line = (k: 'h' | 'l' | 'c', color: string, w: number) => {
      ctx.beginPath();
      pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p[k]) : ctx.lineTo(p.x, p[k])));
      ctx.strokeStyle = color;
      ctx.lineWidth = w * hr;
      ctx.stroke();
    };
    line('h', '#00bcd4', 2);
    line('l', '#e91e63', 2);
    line('c', '#0284C7', 2);
  }
}

/** Columns: kapanıştan pane tabanına sütun; renk önceki kapanışa göre. */
export class ColumnsView extends BaseView {
  priceValueBuilder(row: OhlcvData): number[] {
    return [row.close];
  }
  protected drawFrame(s: BitmapScope, d: Frame, conv: PriceToCoordinateConverter): void {
    const ctx = s.context;
    const hr = s.horizontalPixelRatio;
    const vr = s.verticalPixelRatio;
    const [from, to] = rangeOf(d);
    const w = Math.max(1, Math.round(d.barSpacing * d.conflationFactor * 0.7 * hr));
    for (let i = from; i < to; i++) {
      const b = d.bars[i];
      const o = b.originalData;
      const ref = o.prevClose ?? o.open;
      // Varsayılan: renk önceki kapanışa göre, %50 saydam
      ctx.fillStyle = o.close >= ref ? 'rgba(8, 153, 129, 0.5)' : 'rgba(242, 54, 69, 0.5)';
      const y = yb(conv, o.close, vr);
      if (!Number.isFinite(y)) continue;
      ctx.fillRect(Math.round(b.x * hr - w / 2), y, w, Math.max(1, s.bitmapSize.height - y));
    }
  }
}

function shortNum(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (a >= 1e4) return `${(v / 1e3).toFixed(1)}K`;
  if (a >= 100) return v.toFixed(0);
  if (a >= 1) return v.toFixed(2);
  return v.toPrecision(3);
}

/** High-low: yüksek-düşük gövdesi; yer varsa üstte yüksek, altta düşük değer etiketi. */
export class HighLowView extends BaseView {
  protected drawFrame(s: BitmapScope, d: Frame, conv: PriceToCoordinateConverter): void {
    const ctx = s.context;
    const hr = s.horizontalPixelRatio;
    const vr = s.verticalPixelRatio;
    const [from, to] = rangeOf(d);
    const w = Math.max(1, Math.round(d.barSpacing * d.conflationFactor * 0.6 * hr));
    const labels = d.barSpacing >= 34;
    ctx.font = `${Math.round(11 * vr)}px -apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, sans-serif`;
    ctx.textAlign = 'center';
    for (let i = from; i < to; i++) {
      const b = d.bars[i];
      const o = b.originalData;
      const yh = yb(conv, o.high, vr);
      const yl = yb(conv, o.low, vr);
      const x = Math.round(b.x * hr);
      ctx.fillStyle = this.opts.neutralColor;
      ctx.fillRect(x - Math.floor(w / 2), yh, w, Math.max(1, yl - yh));
      if (labels) {
        ctx.fillStyle = this.opts.neutralColor; // Standart labelColor #0284C7
        ctx.textBaseline = 'bottom';
        ctx.fillText(shortNum(o.high), x, yh - 2 * vr);
        ctx.textBaseline = 'top';
        ctx.fillText(shortNum(o.low), x, yl + 2 * vr);
      }
    }
  }
}

/** Kagi: dikey çizgi parçaları (yang yeşil, yin kırmızı; Varsayılan olarak iki yön de 1 px) + omuz/bel yatay bağlantıları. */
export class KagiView extends BaseView {
  protected drawFrame(s: BitmapScope, d: Frame, conv: PriceToCoordinateConverter): void {
    const ctx = s.context;
    const hr = s.horizontalPixelRatio;
    const vr = s.verticalPixelRatio;
    const [from, to] = rangeOf(d);
    const thick = Math.max(1, Math.round(1 * hr));
    const thin = thick;
    ctx.lineCap = 'square';
    for (let i = Math.max(0, from - 1); i < to; i++) {
      const b = d.bars[i];
      const parts = b.originalData.kagi ?? [{ from: b.originalData.open, to: b.originalData.close, yang: b.originalData.close >= b.originalData.open }];
      const x = Math.round(b.x * hr);
      if (i > 0) {
        const prev = d.bars[i - 1];
        const pp = prev.originalData.kagi;
        const lastYang = pp && pp.length ? pp[pp.length - 1].yang : prev.originalData.close >= prev.originalData.open;
        const y = yb(conv, b.originalData.open, vr);
        ctx.beginPath();
        ctx.moveTo(Math.round(prev.x * hr), y);
        ctx.lineTo(x, y);
        ctx.strokeStyle = lastYang ? this.opts.upColor : this.opts.downColor;
        ctx.lineWidth = lastYang ? thick : thin;
        ctx.stroke();
      }
      for (const p of parts) {
        ctx.beginPath();
        ctx.moveTo(x, yb(conv, p.from, vr));
        ctx.lineTo(x, yb(conv, p.to, vr));
        ctx.strokeStyle = p.yang ? this.opts.upColor : this.opts.downColor;
        ctx.lineWidth = p.yang ? thick : thin;
        ctx.stroke();
      }
    }
  }
}

/** Nokta-Şekil: her kutuya X (yükseliş) ya da O (düşüş). */
export class PnfView extends BaseView {
  protected drawFrame(s: BitmapScope, d: Frame, conv: PriceToCoordinateConverter): void {
    const ctx = s.context;
    const hr = s.horizontalPixelRatio;
    const vr = s.verticalPixelRatio;
    const [from, to] = rangeOf(d);
    ctx.lineWidth = Math.max(1, Math.round(1.5 * hr));
    for (let i = from; i < to; i++) {
      const b = d.bars[i];
      const o = b.originalData;
      const box = o.pnf?.box ?? 0;
      if (!(box > 0)) continue;
      const isX = (o.pnf?.kind ?? (o.close >= o.open ? 'X' : 'O')) === 'X';
      ctx.strokeStyle = isX ? this.opts.upColor : this.opts.downColor;
      const boxPx = Math.abs((conv(o.low) ?? 0) - (conv(o.low + box) ?? 0)) * vr;
      const cell = Math.max(2, Math.min(d.barSpacing * d.conflationFactor * 0.8 * hr, boxPx * 0.9));
      const half = cell / 2;
      const x = b.x * hr;
      const n = Math.round((o.high - o.low) / box);
      for (let k = 0; k <= n; k++) {
        const yc = yb(conv, o.low + k * box, vr);
        ctx.beginPath();
        if (isX) {
          ctx.moveTo(x - half, yc - half);
          ctx.lineTo(x + half, yc + half);
          ctx.moveTo(x + half, yc - half);
          ctx.lineTo(x - half, yc + half);
        } else {
          ctx.ellipse(x, yc, half * 0.75, half, 0, 0, Math.PI * 2); // Varsayılan: O dikey elips
        }
        ctx.stroke();
      }
    }
  }
}

export type CustomStyle = 'volcandles' | 'hlcarea' | 'columns' | 'highlow' | 'kagi' | 'pnf';

export function isCustomStyle(m: string): m is CustomStyle {
  return m === 'volcandles' || m === 'hlcarea' || m === 'columns' || m === 'highlow' || m === 'kagi' || m === 'pnf';
}

export function createView(style: CustomStyle): BaseView {
  switch (style) {
    case 'volcandles':
      return new VolumeCandlesView();
    case 'hlcarea':
      return new HlcAreaView();
    case 'columns':
      return new ColumnsView();
    case 'highlow':
      return new HighLowView();
    case 'kagi':
      return new KagiView();
    case 'pnf':
      return new PnfView();
  }
}
