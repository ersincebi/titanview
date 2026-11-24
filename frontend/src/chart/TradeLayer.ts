import type { BacktestTrade } from '../types/market';
import type { LayerMapper } from './ScriptLayer';

/**
 * Faz 24: strateji işlemlerinin grafik katmanı — giriş/çıkış okları, bağlantı çizgileri (kâr yeşil / zarar
 * kırmızı), giriş-çıkış etiketleri, seçili işlem vurgusu. Veri (zaman, fiyat) cinsinden tutulur, her görünüm
 * değişiminde mapper ile piksele çevrilir; yalnız görünen işlemler çizilir. Pointer olaylarını yakalamaz.
 */
export interface TradeLayerOptions {
  lines: boolean;
  labels: boolean;
  selectedId: number | null;
}

export type TradePrim =
  | { kind: 'line'; id: number; x1: number; y1: number; x2: number; y2: number; color: string; selected: boolean }
  | { kind: 'arrow'; id: number; x: number; y: number; up: boolean; color: string; selected: boolean }
  | { kind: 'exit'; id: number; x: number; y: number; color: string; selected: boolean }
  | { kind: 'label'; id: number; x: number; y: number; text: string; color: string; anchor: 'start' | 'end'; selected: boolean };

const WIN = '#089981';
const LOSS = '#F23645';
export const MAX_DRAWN_TRADES = 800;

const fmtPrice = (p: number): string => (Math.abs(p) >= 100 ? p.toFixed(2) : p.toFixed(4).replace(/0+$/, '').replace(/\.$/, ''));
const fmtQty = (q: number | undefined): string => (q === undefined ? '' : ` ×${+q.toPrecision(4)}`);

export function entryLabel(t: BacktestTrade): string {
  return `${t.direction === 'LONG' ? 'Long' : 'Short'}${fmtQty(t.qty)} @ ${fmtPrice(t.entryPrice)}`;
}

export function exitLabel(t: BacktestTrade): string {
  const sgn = t.pnlCash >= 0 ? '+' : '';
  return `${sgn}${t.pnlCash.toFixed(2)} (${sgn}${t.pnlPercent.toFixed(2)}%)${t.exitComment ? ' · ' + t.exitComment : ''}`;
}

/** Görünen işlemler için çizim ilkelleri (saf: mapper dışında durum yok → test edilebilir). */
export function layoutTrades(trades: BacktestTrade[], m: LayerMapper, o: TradeLayerOptions): TradePrim[] {
  const { width, height } = m.size();
  if (width <= 0 || height <= 0 || trades.length === 0) return [];
  const xOf = (t: number): number | null => {
    const l = m.timeToLogical(t);
    return l === null ? null : m.logicalToX(l);
  };
  const vis: Array<{ t: BacktestTrade; x1: number; y1: number; x2: number; y2: number }> = [];
  for (const t of trades) {
    const x1 = xOf(t.entryTime);
    const x2 = t.exitTime > 0 ? xOf(t.exitTime) : x1;
    const y1 = m.priceToY(t.entryPrice);
    const y2 = t.exitTime > 0 ? m.priceToY(t.exitPrice) : y1;
    if (x1 === null || x2 === null || y1 === null || y2 === null) continue;
    if (Math.max(x1, x2) < -40 || Math.min(x1, x2) > width + 40) continue;
    vis.push({ t, x1, y1, x2, y2 });
  }
  // seçili işlem her zaman dahil; kalabalıkta yalnız ilk MAX kadarı
  let list = vis;
  if (list.length > MAX_DRAWN_TRADES) {
    const sel = list.filter((v) => v.t.id === o.selectedId);
    list = [...list.filter((v) => v.t.id !== o.selectedId).slice(0, MAX_DRAWN_TRADES), ...sel];
  }
  const roomy = (m.barSpacing() >= 3.5 && list.length <= 45) || list.length <= 15;
  const out: TradePrim[] = [];
  for (const v of list) {
    const { t } = v;
    const sel = t.id === o.selectedId;
    const color = t.pnlCash >= 0 ? WIN : LOSS;
    const up = t.direction === 'LONG';
    if (o.lines) out.push({ kind: 'line', id: t.id, x1: v.x1, y1: v.y1, x2: v.x2, y2: v.y2, color, selected: sel });
    out.push({ kind: 'arrow', id: t.id, x: v.x1, y: v.y1, up, color: up ? '#00B07C' : LOSS, selected: sel });
    if (t.exitTime > 0) out.push({ kind: 'exit', id: t.id, x: v.x2, y: v.y2, color, selected: sel });
    if (o.labels && (roomy || sel)) {
      out.push({
        kind: 'label',
        id: t.id,
        x: v.x1 + 7,
        y: up ? v.y1 + 18 : v.y1 - 12,
        text: entryLabel(t),
        color: up ? '#00B07C' : LOSS,
        anchor: 'start',
        selected: sel,
      });
      if (t.exitTime > 0) {
        out.push({
          kind: 'label',
          id: t.id,
          x: v.x2 - 7,
          y: up ? v.y2 - 12 : v.y2 + 18,
          text: exitLabel(t),
          color,
          anchor: 'end',
          selected: sel,
        });
      }
    }
  }
  return deconflictLabels(out, height);
}

/** Etiketlerin üst üste binmesini önler: yaklaşık kutu çakışmasında dikey olarak kaydırır. */
function deconflictLabels(prims: TradePrim[], height: number): TradePrim[] {
  const placed: Array<{ l: number; r: number; t: number; b: number }> = [];
  const labelH = 15;
  // seçili etiketler önce yerleşsin ki yerlerini korusunlar
  const idxs = prims
    .map((p, i) => (p.kind === 'label' ? i : -1))
    .filter((i) => i >= 0)
    .sort((a, b) => Number(prims[b].selected) - Number(prims[a].selected));
  for (const i of idxs) {
    const p = prims[i] as Extract<TradePrim, { kind: 'label' }>;
    const w = Math.max(40, p.text.length * 6.2 + 8);
    const l = p.anchor === 'end' ? p.x - w : p.x;
    const r = l + w;
    let y = Math.max(14, Math.min(height - 6, p.y));
    const hits = (cy: number) => placed.some((b) => !(r < b.l || l > b.r || cy < b.t || cy - labelH > b.b));
    if (hits(y)) {
      for (let step = 1; step <= 8; step++) {
        const upY = y - step * labelH;
        const dnY = y + step * labelH;
        if (upY >= 14 && !hits(upY)) {
          y = upY;
          break;
        }
        if (dnY <= height - 6 && !hits(dnY)) {
          y = dnY;
          break;
        }
      }
    }
    p.y = y;
    placed.push({ l, r, t: y - labelH, b: y });
  }
  return prims;
}

const NS = 'http://www.w3.org/2000/svg';

function el(tag: string, attrs: Record<string, string | number>, parent: Element): SVGElement {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  parent.appendChild(e);
  return e as SVGElement;
}

export class TradeLayer {
  private svg: SVGSVGElement;
  private trades: BacktestTrade[] = [];
  private opts: TradeLayerOptions = { lines: true, labels: true, selectedId: null };

  constructor(
    host: HTMLElement,
    private mapper: LayerMapper
  ) {
    this.svg = document.createElementNS(NS, 'svg');
    this.svg.setAttribute('class', 'titan-script-svg trade-layer');
    host.appendChild(this.svg);
  }

  public setTrades(trades: BacktestTrade[], opts: Partial<TradeLayerOptions> = {}): void {
    this.trades = trades;
    this.opts = { ...this.opts, ...opts };
    this.render();
  }

  public count(): number {
    return this.trades.length;
  }

  public destroy(): void {
    this.svg.remove();
    this.trades = [];
  }

  public render(): void {
    while (this.svg.firstChild) this.svg.removeChild(this.svg.firstChild);
    if (this.trades.length === 0) return;
    const { width, height } = this.mapper.size();
    if (width <= 0 || height <= 0) return;
    this.svg.style.width = `${width}px`;
    this.svg.style.height = `${height}px`;
    this.svg.style.top = `${this.mapper.top?.() ?? 0}px`;
    const cl = this.mapper.clipLeft?.() ?? 0;
    this.svg.style.clipPath = cl > 0 ? `inset(0 0 0 ${cl}px)` : '';
    const prims = layoutTrades(this.trades, this.mapper, this.opts);
    // seçili işlem üstte çizilsin
    prims.sort((a, b) => Number(a.selected) - Number(b.selected));
    const light = typeof document !== 'undefined' && document.documentElement.dataset.theme === 'light';
    const halo = light ? 'rgba(255,255,255,0.92)' : 'rgba(19,23,34,0.85)';
    for (const p of prims) {
      const cls = `trade-${p.kind}${p.selected ? ' trade-selected' : ''}`;
      if (p.kind === 'line') {
        if (p.selected) el('line', { x1: p.x1, y1: p.y1, x2: p.x2, y2: p.y2, stroke: light ? '#131722' : '#fff', 'stroke-width': 4.5, opacity: 0.45, class: 'trade-halo' }, this.svg);
        el('line', { x1: p.x1, y1: p.y1, x2: p.x2, y2: p.y2, stroke: p.color, 'stroke-width': p.selected ? 2.2 : 1.2, 'stroke-dasharray': p.selected ? '' : '4,3', class: cls, 'data-trade-id': p.id }, this.svg);
      } else if (p.kind === 'arrow') {
        const s = p.selected ? 7 : 5;
        const d = p.up ? `M${p.x},${p.y + 1} l${-s},${s * 1.6} l${s * 2},0 z` : `M${p.x},${p.y - 1} l${-s},${-s * 1.6} l${s * 2},0 z`;
        el('path', { d, fill: p.color, stroke: p.selected ? '#fff' : 'none', 'stroke-width': 1, class: cls, 'data-trade-id': p.id }, this.svg);
      } else if (p.kind === 'exit') {
        el('circle', { cx: p.x, cy: p.y, r: p.selected ? 5.5 : 3.5, fill: p.color, stroke: '#fff', 'stroke-width': p.selected ? 1.5 : 1, class: cls, 'data-trade-id': p.id }, this.svg);
      } else {
        const t = el('text', { x: p.x, y: p.y, fill: p.color, 'font-size': p.selected ? 12 : 10.5, 'font-weight': p.selected ? 700 : 600, 'text-anchor': p.anchor, class: cls, 'data-trade-id': p.id, 'paint-order': 'stroke', stroke: halo, 'stroke-width': 3 }, this.svg);
        t.textContent = p.text;
      }
    }
  }
}
