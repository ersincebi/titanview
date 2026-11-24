import type { IChartApi, IPrimitivePaneRenderer, IPrimitivePaneView, ISeriesApi, ISeriesPrimitive, PrimitivePaneViewZOrder, SeriesAttachedParameter, SeriesType, Time, AutoscaleInfo, Logical } from 'lightweight-charts';
import type { Candle, MarketType } from '../types/market';
import type { BitmapScope, RenderTarget } from './customSeries';
import { computeProfile, computeTPO, imbalances, splitSessions, type FootprintBar, type TpoSession, type VolumeProfile } from './profile';

/**
 * Grafik üstü profil katmanları (series primitive): Görünür Aralık Hacim Profili (VRVP),
 * Seans Hacim Profili (SVP), TPO ve Footprint. Hepsi ana (referans) seriye bağlanır.
 */

const FONT = "-apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, Ubuntu, sans-serif";

/** Varsayılan değerler (chartStyleProperties(20) — Seans hacim profili). */
export const VP_COLORS = {
  up: 'rgba(38, 198, 218, 0.5)',
  down: 'rgba(236, 64, 122, 0.5)',
  vaUp: 'rgba(38, 198, 218, 0.75)',
  vaDown: 'rgba(236, 64, 122, 0.75)',
  poc: '#DBDBDB',
  box: 'rgba(38, 198, 218, 0.05)',
};

/** Standart TPO harf gradyanı (chartStyleProperties(18).tpo.colors.gradientColors). */
const TPO_GRADIENT = ['#e91e63', '#00c853', '#00bcd4', '#651FFF'];
/** Standart footprint arka planı: hücre hacminin bardaki en büyük hücreye oranına göre 4 kademe. */
const FP_BUY = ['#082621', '#004D40', '#06806B', '#22AB94'];
const FP_SELL = ['#331F20', '#991F29', '#CC2F3C', '#F7525F'];

interface Ctx {
  chart: IChartApi;
  series: ISeriesApi<SeriesType>;
  requestUpdate: () => void;
}

abstract class BasePrimitive implements ISeriesPrimitive<Time> {
  protected ctx: Ctx | null = null;
  private readonly view: IPrimitivePaneView;
  constructor(private readonly z: PrimitivePaneViewZOrder) {
    const self = this;
    this.view = {
      zOrder: () => self.z,
      renderer(): IPrimitivePaneRenderer {
        return {
          draw: (target: unknown) => {
            if (!self.ctx) return;
            (target as RenderTarget).useBitmapCoordinateSpace((s) => self.draw(s));
          },
        };
      },
    };
  }
  attached(p: SeriesAttachedParameter<Time>): void {
    this.ctx = { chart: p.chart as IChartApi, series: p.series as ISeriesApi<SeriesType>, requestUpdate: p.requestUpdate };
  }
  detached(): void {
    this.ctx = null;
  }
  paneViews(): readonly IPrimitivePaneView[] {
    return [this.view];
  }
  update(): void {
    this.ctx?.requestUpdate();
  }
  protected y(price: number, r: number): number {
    const v = this.ctx!.series.priceToCoordinate(price);
    return v === null ? NaN : v * r;
  }
  protected x(time: number, r: number): number {
    const v = this.ctx!.chart.timeScale().timeToCoordinate(time as Time);
    return v === null ? NaN : v * r;
  }
  protected spacing(): number {
    return this.ctx!.chart.timeScale().options().barSpacing;
  }
  protected abstract draw(s: BitmapScope): void;
}

function drawProfile(s: BitmapScope, vp: VolumeProfile, y: (p: number) => number, xRight: number, maxW: number, anchorLeft: boolean, showPoc: boolean, pocFrom?: number, pocTo?: number): void {
  const ctx = s.context;
  for (const row of vp.rows) {
    if (row.total <= 0) continue;
    const y1 = y(row.price);
    const y0 = y(row.price + vp.rowSize);
    if (!Number.isFinite(y0) || !Number.isFinite(y1)) continue;
    const top = Math.round(Math.min(y0, y1));
    const h = Math.max(1, Math.round(Math.abs(y1 - y0)) - 1);
    const inVa = row.price + vp.rowSize / 2 >= vp.val && row.price + vp.rowSize / 2 <= vp.vah;
    const wUp = (row.up / vp.maxTotal) * maxW;
    const wDn = (row.down / vp.maxTotal) * maxW;
    ctx.fillStyle = inVa ? VP_COLORS.vaUp : VP_COLORS.up;
    if (anchorLeft) ctx.fillRect(Math.round(xRight), top, Math.round(wUp), h);
    else ctx.fillRect(Math.round(xRight - wUp - wDn), top, Math.round(wUp), h);
    ctx.fillStyle = inVa ? VP_COLORS.vaDown : VP_COLORS.down;
    if (anchorLeft) ctx.fillRect(Math.round(xRight + wUp), top, Math.round(wDn), h);
    else ctx.fillRect(Math.round(xRight - wDn), top, Math.round(wDn), h);
  }
  if (showPoc) {
    const yp = Math.round(y(vp.poc));
    ctx.fillStyle = VP_COLORS.poc;
    const a = pocFrom ?? (anchorLeft ? xRight : xRight - maxW);
    const b = pocTo ?? (anchorLeft ? xRight + maxW : xRight);
    const lw = Math.max(1, Math.round(2 * s.verticalPixelRatio)); // Standart POC 2 px
    ctx.fillRect(Math.round(a), yp - Math.floor(lw / 2), Math.round(b - a), lw);
  }
}

/** Görünür aralık hacim profili: sağ kenara yaslı, genişlik pane'in %30'u (VRVP). */
export class VisibleRangeProfile extends BasePrimitive {
  private cacheKey = '';
  private cache: VolumeProfile | null = null;
  constructor(private bars: () => Candle[], private params: () => { rows: number; vaPct: number }) {
    super('normal');
  }
  protected draw(s: BitmapScope): void {
    const { chart } = this.ctx!;
    const bars = this.bars();
    const r = chart.timeScale().getVisibleLogicalRange();
    if (!r || bars.length === 0) return;
    const a = Math.max(0, Math.floor(r.from));
    const b = Math.min(bars.length - 1, Math.ceil(r.to));
    if (b < a) return;
    const p = this.params();
    const key = `${a}|${b}|${bars.length}|${bars[b].close}|${p.rows}|${p.vaPct}`;
    if (key !== this.cacheKey) {
      this.cache = computeProfile(bars.slice(a, b + 1), { rows: p.rows || 24, vaPct: p.vaPct });
      this.cacheKey = key;
    }
    if (!this.cache) return;
    const vr = s.verticalPixelRatio;
    drawProfile(s, this.cache, (pr) => this.y(pr, vr), s.bitmapSize.width, s.bitmapSize.width * 0.3, false, true); // POC yalnız histogram genişliğinde (varsayılan: extendPocRight=false)
  }
}

/** Seans başına hacim profili: seansın sol kenarından sağa, genişlik seans genişliği kadar (SVP). */
export class SessionProfiles extends BasePrimitive {
  private cache = new Map<string, VolumeProfile | null>();
  constructor(private bars: () => Candle[], private market: () => MarketType | undefined, private params: () => { rows: number; vaPct: number }) {
    super('bottom');
  }
  protected draw(s: BitmapScope): void {
    const { chart } = this.ctx!;
    const bars = this.bars();
    const r = chart.timeScale().getVisibleLogicalRange();
    if (!r || bars.length === 0) return;
    const hr = s.horizontalPixelRatio;
    const vr = s.verticalPixelRatio;
    const p = this.params();
    const half = (this.spacing() * hr) / 2;
    for (const sess of splitSessions(bars, this.market())) {
      if (sess.to < r.from - 1 || sess.from > r.to + 1) continue;
      const last = bars[sess.to];
      const key = `${sess.day}|${sess.to}|${last.close}|${last.volume}|${p.rows}|${p.vaPct}`;
      let vp = this.cache.get(key);
      if (vp === undefined) {
        vp = computeProfile(bars.slice(sess.from, sess.to + 1), { rows: p.rows || 24, vaPct: p.vaPct });
        this.cache.set(key, vp);
        if (this.cache.size > 400) this.cache.delete(this.cache.keys().next().value as string);
      }
      if (!vp) continue;
      const x0 = this.x(bars[sess.from].time, hr) - half;
      const x1 = this.x(last.time, hr) + half;
      if (!Number.isFinite(x0) || !Number.isFinite(x1)) continue;
      // Varsayılan: seans kutusu zemini (histogramBoxColor) + profil soldan sağa, genişlik %100
      const yTop = this.y(vp.rows[vp.rows.length - 1].price + vp.rowSize, vr);
      const yBot = this.y(vp.rows[0].price, vr);
      s.context.fillStyle = VP_COLORS.box;
      s.context.fillRect(Math.round(x0), Math.round(yTop), Math.round(x1 - x0), Math.round(yBot - yTop));
      drawProfile(s, vp, (pr) => this.y(pr, vr), x0, Math.max(2, x1 - x0), true, true, x0, x1);
    }
  }
}

function hex(c: string): [number, number, number] {
  const v = parseInt(c.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
/** Periyot harfinin rengi: Standart 4 duraklı gradyanı periyotlara yayar. */
export function letterColor(i: number, n: number): string {
  const t = n > 1 ? i / (n - 1) : 0;
  const seg = Math.min(TPO_GRADIENT.length - 2, Math.floor(t * (TPO_GRADIENT.length - 1)));
  const f = t * (TPO_GRADIENT.length - 1) - seg;
  const a = hex(TPO_GRADIENT[seg]);
  const b = hex(TPO_GRADIENT[seg + 1]);
  const m = a.map((x, k) => Math.round(x + (b[k] - x) * f));
  return `rgb(${m[0]}, ${m[1]}, ${m[2]})`;
}

/** TPO (Market Profile): seans başına harf blokları, POC, değer alanı, Initial Balance. */
export class TpoLayer extends BasePrimitive {
  private cacheKey = '';
  private sessions: TpoSession[] = [];
  constructor(private bars: () => Candle[], private market: () => MarketType | undefined, private params: () => { periodSec: number; vaPct: number; rowSize: number }) {
    super('top');
  }
  private vpCache = new Map<string, VolumeProfile | null>();
  autoscaleInfo(from: Logical, to: Logical): AutoscaleInfo | null {
    return autoscaleFromBars(this.bars(), from, to);
  }
  /** Seansın TPO satırlarıyla hizalı hacim profili. */
  private sessionVp(t: TpoSession, bars: Candle[]): VolumeProfile | null {
    const key = `${t.start}|${t.end}|${t.close}|${t.rowSize}`;
    let vp = this.vpCache.get(key);
    if (vp === undefined) {
      vp = computeProfile(bars.filter((b) => b.time >= t.start && b.time <= t.end), { rowSize: t.rowSize, vaPct: 70 });
      this.vpCache.set(key, vp);
      if (this.vpCache.size > 300) this.vpCache.delete(this.vpCache.keys().next().value as string);
    }
    return vp;
  }
  protected draw(s: BitmapScope): void {
    const { chart } = this.ctx!;
    const bars = this.bars();
    const r = chart.timeScale().getVisibleLogicalRange();
    if (!r || bars.length === 0) return;
    const p = this.params();
    const key = `${bars.length}|${bars[bars.length - 1].close}|${bars[bars.length - 1].time}|${p.periodSec}|${p.rowSize}|${p.vaPct}`;
    if (key !== this.cacheKey) {
      this.sessions = computeTPO(bars, splitSessions(bars, this.market()), p.periodSec, p.rowSize, p.vaPct);
      this.cacheKey = key;
    }
    const ctx = s.context;
    const hr = s.horizontalPixelRatio;
    const vr = s.verticalPixelRatio;
    const half = (this.spacing() * hr) / 2;
    const firstT = bars[Math.max(0, Math.floor(r.from))]?.time ?? 0;
    const lastT = bars[Math.min(bars.length - 1, Math.ceil(r.to))]?.time ?? Infinity;
    for (const t of this.sessions) {
      if (t.end < firstT || t.start > lastT) continue;
      const x0 = this.x(t.start, hr) - half;
      const x1 = this.x(t.end, hr) + half;
      if (!Number.isFinite(x0) || !Number.isFinite(x1)) continue;
      const rowPx = Math.abs(this.y(t.rows[0].price, vr) - this.y(t.rows[0].price + t.rowSize, vr));
      const maxLetters = Math.max(1, ...t.rows.map((rw) => rw.letters.length));
      const fs = Math.max(7, Math.min(12, rowPx / vr - 1));
      // Varsayılan: harfler bitişik (≈ font genişliği); yer yoksa harf yerine blok
      const cw = Math.max(1, Math.min(fs * 0.72 * hr, (x1 - x0 - 6 * hr) / maxLetters));
      const blocks = rowPx < 7 * vr || cw < 5 * hr;
      ctx.font = `${Math.round(fs * vr)}px ${FONT}`;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      const yVah = this.y(t.vah, vr);
      const yVal = this.y(t.val, vr);
      // Standart TPO: seansın hacim profili (soldan sağa, camgöbeği; değer alanı koyu) harflerin altında
      const vp = this.sessionVp(t, bars);
      if (vp) {
        for (const row of vp.rows) {
          if (row.total <= 0) continue;
          const ya = this.y(row.price + vp.rowSize, vr);
          const yb2 = this.y(row.price, vr);
          const mid = row.price + vp.rowSize / 2;
          ctx.fillStyle = mid >= vp.val && mid <= vp.vah ? 'rgba(38, 198, 218, 0.75)' : 'rgba(38, 198, 218, 0.5)';
          ctx.globalAlpha = 0.35;
          ctx.fillRect(Math.round(x0), Math.round(ya), Math.round(((x1 - x0) * row.total) / vp.maxTotal), Math.max(1, Math.round(yb2 - ya) - 1));
          ctx.globalAlpha = 1;
        }
      }
      for (const rw of t.rows) {
        if (!rw.letters) continue;
        const yc = this.y(rw.price + t.rowSize / 2, vr);
        const isPoc = Math.abs(rw.price + t.rowSize / 2 - t.poc) < t.rowSize / 2;
        const inVa = rw.price >= t.val - 1e-9 && rw.price + t.rowSize <= t.vah + 1e-9;
        for (let k = 0; k < rw.letters.length; k++) {
          const xx = x0 + 3 * hr + k * cw;
          const col = isPoc ? '#DBDBDB' : letterColor(rw.letters.charCodeAt(k) >= 97 ? rw.letters.charCodeAt(k) - 71 : rw.letters.charCodeAt(k) - 65, t.periods);
          if (blocks) {
            ctx.fillStyle = col;
            ctx.globalAlpha = inVa ? 1 : 0.3; // Standart nonVaOpacity 30
            ctx.fillRect(Math.round(xx), Math.round(yc - rowPx / 2 + 1), Math.max(1, Math.round(cw - 1)), Math.max(1, Math.round(rowPx - 1)));
          } else {
            ctx.fillStyle = col;
            ctx.globalAlpha = inVa ? 1 : 0.3;
            ctx.fillText(rw.letters[k], xx, yc);
          }
        }
        ctx.globalAlpha = 1;
      }
      // Initial Balance (mavi dikey çizgi) + açılış/kapanış işaretleri
      ctx.fillStyle = '#0284C7';
      const yIbH = this.y(t.ibHigh, vr);
      const yIbL = this.y(t.ibLow, vr);
      ctx.fillRect(Math.round(x0), Math.round(yIbH), Math.max(2, Math.round(2 * hr)), Math.round(yIbL - yIbH));
      ctx.fillStyle = '#FFD54F';
      ctx.fillRect(Math.round(x0 - 3 * hr), Math.round(this.y(t.open, vr) - hr), Math.round(4 * hr), Math.max(2, Math.round(2 * vr)));
      ctx.fillStyle = '#B2B5BE';
      ctx.fillRect(Math.round(x1 - 4 * hr), Math.round(this.y(t.close, vr) - hr), Math.round(4 * hr), Math.max(2, Math.round(2 * vr)));
      // POC / VAH / VAL (#DBDBDB)
      ctx.fillStyle = '#DBDBDB';
      const lw = Math.max(1, Math.round(vr));
      ctx.fillRect(Math.round(x0), Math.round(this.y(t.poc, vr)), Math.round(x1 - x0), lw * 2);
      ctx.globalAlpha = 0.6;
      ctx.fillRect(Math.round(x0), Math.round(yVah), Math.round(x1 - x0), lw);
      ctx.fillRect(Math.round(x0), Math.round(yVal), Math.round(x1 - x0), lw);
      ctx.globalAlpha = 1;
    }
  }
}

function autoscaleFromBars(bars: Candle[], from: number, to: number): AutoscaleInfo | null {
  const a = Math.max(0, Math.floor(from));
  const b = Math.min(bars.length - 1, Math.ceil(to));
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = a; i <= b; i++) {
    lo = Math.min(lo, bars[i].low);
    hi = Math.max(hi, bars[i].high);
  }
  if (!Number.isFinite(lo)) return null;
  return { priceRange: { minValue: lo, maxValue: hi } };
}

function shortVol(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  if (a >= 10) return v.toFixed(0);
  if (a >= 1) return v.toFixed(1);
  if (a === 0) return '0';
  return v.toFixed(2);
}

/**
 * Footprint: her barda [satış | alış] hücreleri (koyuluk = hacim), çapraz dengesizlik vurgusu,
 * POC çerçevesi, solda ince OHLC mumu, altta delta ve toplam. Dar barda metin yerine ısı hücresi.
 */
export class FootprintLayer extends BasePrimitive {
  constructor(private bars: () => Candle[], private data: () => Map<number, FootprintBar>, private rowSize: () => number) {
    super('top');
  }
  autoscaleInfo(from: Logical, to: Logical): AutoscaleInfo | null {
    const info = autoscaleFromBars(this.bars(), from, to);
    return info ? { ...info, margins: { above: 4, below: 34 } } : null;
  }
  protected draw(s: BitmapScope): void {
    const { chart } = this.ctx!;
    const bars = this.bars();
    const r = chart.timeScale().getVisibleLogicalRange();
    if (!r || bars.length === 0) return;
    const ctx = s.context;
    const hr = s.horizontalPixelRatio;
    const vr = s.verticalPixelRatio;
    const sp = this.spacing() * hr;
    const fpMap = this.data();
    const row = this.rowSize();
    const a = Math.max(0, Math.floor(r.from));
    const b = Math.min(bars.length - 1, Math.ceil(r.to));
    ctx.textBaseline = 'middle';
    for (let i = a; i <= b; i++) {
      const c = bars[i];
      const xc = this.x(c.time, hr);
      if (!Number.isFinite(xc)) continue;
      const total = sp * 0.88;
      const candleW = Math.max(2, Math.min(6 * hr, total * 0.1));
      const left = xc - total / 2;
      const up = c.close >= c.open;
      // ince mum
      ctx.fillStyle = up ? '#089981' : '#F23645';
      const yh = this.y(c.high, vr);
      const yl = this.y(c.low, vr);
      const yo = this.y(c.open, vr);
      const yc = this.y(c.close, vr);
      ctx.fillRect(Math.round(left + candleW / 2 - hr / 2), Math.round(yh), Math.max(1, Math.round(hr)), Math.round(yl - yh));
      ctx.fillRect(Math.round(left), Math.round(Math.min(yo, yc)), Math.round(candleW), Math.max(1, Math.round(Math.abs(yc - yo))));
      const fp = fpMap.get(c.time);
      if (!fp || fp.rows.length === 0) continue;
      const colW = (total - candleW - 2 * hr) / 2;
      const xs = left + candleW + 2 * hr;
      const xb = xs + colW;
      let maxCell = 0;
      for (const rw of fp.rows) maxCell = Math.max(maxCell, rw[1], rw[2]);
      const im = imbalances(fp.rows, 3);
      const rowPx = Math.abs(this.y(fp.rows[0][0], vr) - this.y(fp.rows[0][0] + row, vr));
      const text = rowPx >= 9 * vr && colW >= 24 * hr;
      const fs = Math.max(8, Math.min(11, rowPx / vr - 2));
      ctx.font = `${Math.round(fs * vr)}px ${FONT}`;
      fp.rows.forEach((rw, k) => {
        const yTop = this.y(rw[0] + row, vr);
        const yBot = this.y(rw[0], vr);
        if (!Number.isFinite(yTop) || !Number.isFinite(yBot)) return;
        const h = Math.max(1, Math.round(yBot - yTop) - 1);
        const t = Math.round(yTop);
        const lvl = (v: number) => (maxCell > 0 ? Math.min(3, Math.floor((v / maxCell) * 4 - 1e-9)) : 0);
        ctx.fillStyle = FP_SELL[lvl(rw[2])];
        ctx.fillRect(Math.round(xs), t, Math.max(1, Math.round(colW - hr)), h);
        ctx.fillStyle = FP_BUY[lvl(rw[1])];
        ctx.fillRect(Math.round(xb), t, Math.max(1, Math.round(colW - hr)), h);
        if (text) {
          ctx.textAlign = 'right';
          ctx.fillStyle = im.sell[k] ? (lvl(rw[2]) === 3 ? '#FFFFFF' : '#F23645') : '#DBDBDB';
          ctx.font = `${im.sell[k] ? 'bold ' : ''}${Math.round(fs * vr)}px ${FONT}`;
          ctx.fillText(shortVol(rw[2]), xs + colW - 4 * hr, t + h / 2);
          ctx.textAlign = 'left';
          ctx.fillStyle = im.buy[k] ? (lvl(rw[1]) === 3 ? '#FFFFFF' : '#089981') : '#DBDBDB';
          ctx.font = `${im.buy[k] ? 'bold ' : ''}${Math.round(fs * vr)}px ${FONT}`;
          ctx.fillText(shortVol(rw[1]), xb + 4 * hr, t + h / 2);
        }
        if (Math.abs(rw[0] - fp.poc) < row / 2) {
          ctx.strokeStyle = '#DBDBDB'; // Standart pocColor
          ctx.lineWidth = Math.max(1, Math.round(hr));
          ctx.strokeRect(Math.round(xs) + 0.5, t + 0.5, Math.round(colW * 2 - hr) - 1, h - 1);
        }
      });
      // delta / toplam
      const yBase = this.y(c.low, vr) + 12 * vr;
      ctx.font = `${Math.round(10 * vr)}px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.fillStyle = fp.delta >= 0 ? '#089981' : '#F23645';
      ctx.fillText(`Δ ${shortVol(fp.delta)}`, xs + colW, yBase);
      ctx.fillStyle = '#8C8C8C';
      ctx.fillText(`${shortVol(fp.total)}${fp.approx ? ' ~' : fp.complete ? '' : ' …'}`, xs + colW, yBase + 12 * vr);
    }
  }
}
