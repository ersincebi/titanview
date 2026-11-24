/**
 * Strategy broker emulator (standard bar-by-bar model).
 *  - Market orders issued on bar b fill at the open of bar b+1
 *    (or at the close of bar b when `process_orders_on_close=true`).
 *  - Limit/stop orders (entry + exit) are resolved inside the bar along the O-H-L-C path
 *    (heuristic: if the high is closer to the open than the low, path is O-H-L-C else O-L-H-C);
 *    gaps through a level fill at the open.
 *  - Commission, pyramiding, reversals, partial exits (qty / qty_percent), profit/loss/trail ticks.
 */
import type { BacktestReport, BacktestTrade, ScriptMarker } from '../types/market';

export type Dir = 1 | -1;
export type QtyType = 'fixed' | 'percent_of_equity' | 'cash';
export type CommissionType = 'percent' | 'cash_per_order' | 'cash_per_contract';

export interface BrokerConfig {
  initialCapital: number;
  commissionType: CommissionType;
  commissionValue: number;
  pyramiding: number;
  defaultQtyType: QtyType;
  defaultQtyValue: number;
  processOrdersOnClose: boolean;
  mintick: number;
}

export const DEFAULT_BROKER_CONFIG: BrokerConfig = {
  initialCapital: 10000,
  commissionType: 'percent',
  commissionValue: 0,
  pyramiding: 1,
  defaultQtyType: 'fixed',
  defaultQtyValue: 1,
  processOrdersOnClose: false,
  mintick: 0.01,
};

/** Bar büyüteci: ana barın içindeki alt zaman dilimi mumu (zamana göre sıralı). */
export interface SubBar {
  open: number;
  high: number;
  low: number;
  close: number;
}

/**
 * Bar içi fiyat yolu. Alt bar yoksa Standart sezgisi (açılışa yakın uç önce); varsa her alt barın kendi
 * O-H-L-C yolu sırayla izlenir ("Bar Magnifier").
 */
export function intrabarPath(bar: SubBar, subBars?: SubBar[]): number[] {
  if (!subBars || subBars.length === 0) {
    const highFirst = Math.abs(bar.open - bar.high) <= Math.abs(bar.open - bar.low);
    return highFirst ? [bar.high, bar.low, bar.close] : [bar.low, bar.high, bar.close];
  }
  const pts: number[] = [];
  let prev = bar.open;
  for (const sb of subBars) {
    const highFirst = Math.abs(sb.open - sb.high) <= Math.abs(sb.open - sb.low);
    if (sb.open !== prev) pts.push(sb.open);
    if (highFirst) pts.push(sb.high, sb.low, sb.close);
    else pts.push(sb.low, sb.high, sb.close);
    prev = sb.close;
  }
  return pts;
}

export interface BrokerBar {
  open: number;
  high: number;
  low: number;
  close: number;
  /** seconds */
  time: number;
  index: number;
}

interface OpenTrade {
  id: string;
  dir: Dir;
  qty: number;
  qty0: number;
  entryPrice: number;
  entryTime: number;
  entryBar: number;
  entryComment: string;
  entryCommissionLeft: number;
  /** trailing-stop state per exit order id */
  trail: Map<string, { extreme: number; active: boolean }>;
  /** quantity already closed by each exit order id (an exit order fires once per entry) */
  exitFilled: Map<string, number>;
}

interface ClosedTrade {
  id: string;
  dir: Dir;
  qty: number;
  entryPrice: number;
  entryTime: number;
  exitPrice: number;
  exitTime: number;
  profit: number;
  commission: number;
  entryComment: string;
  exitComment: string;
}

interface EntryOrder {
  kind: 'entry' | 'order';
  id: string;
  dir: Dir;
  qty?: number;
  limit?: number;
  stop?: number;
  comment: string;
  issuedBar: number;
}

interface CloseOrder {
  id: string | null; // null = close all
  qty?: number;
  qtyPercent?: number;
  comment: string;
  issuedBar: number;
}

export interface ExitSpec {
  id: string;
  fromEntry: string;
  qty?: number;
  qtyPercent?: number;
  limit?: number;
  stop?: number;
  profitTicks?: number;
  lossTicks?: number;
  trailPrice?: number;
  trailPoints?: number;
  trailOffset?: number;
  comment: string;
  commentProfit?: string;
  commentLoss?: string;
  commentTrailing?: string;
}

interface Level {
  price: number;
  /** price must RISE to the level (true) or FALL to it (false) */
  up: boolean;
  fill: (px: number) => void;
}

const num = (v: unknown): v is number => typeof v === 'number' && !Number.isNaN(v);

export class Broker {
  readonly cfg: BrokerConfig;
  private cash: number;
  private open: OpenTrade[] = [];
  private closed: ClosedTrade[] = [];
  private entries: EntryOrder[] = [];
  private closes: CloseOrder[] = [];
  private exits = new Map<string, ExitSpec>();
  private lastPrice = NaN;
  private bar: BrokerBar | null = null;

  readonly markers: ScriptMarker[] = [];
  /** Faz 23: emir dolumları (strateji "emir dolumları" alarmı için; son 200) */
  private fills: StrategyFill[] = [];
  readonly equityCurve: { time: number; value: number }[] = [];
  private peak: number;
  private maxDD = 0;
  private maxDDCash = 0;
  private commissionPaid = 0;

  constructor(cfg: Partial<BrokerConfig> = {}) {
    this.cfg = { ...DEFAULT_BROKER_CONFIG, ...cfg };
    this.cash = this.cfg.initialCapital;
    this.peak = this.cfg.initialCapital;
  }

  // ------------------------------------------------------------ queries

  get positionSize(): number {
    let s = 0;
    for (const t of this.open) s += t.dir * t.qty;
    return s;
  }

  get avgPrice(): number {
    let q = 0;
    let v = 0;
    for (const t of this.open) {
      q += t.qty;
      v += t.qty * t.entryPrice;
    }
    return q > 0 ? v / q : NaN;
  }

  get openProfit(): number {
    if (!num(this.lastPrice)) return 0;
    let p = 0;
    for (const t of this.open) p += (this.lastPrice - t.entryPrice) * t.dir * t.qty;
    return p;
  }

  /** Open P&L minus the entry commission already paid for still-open trades. */
  get openProfitNet(): number {
    return this.openProfit - this.open.reduce((s, t) => s + t.entryCommissionLeft, 0);
  }

  get equity(): number {
    return this.cash + this.openProfit;
  }

  get netProfit(): number {
    return this.closed.reduce((s, t) => s + t.profit, 0);
  }

  get grossProfit(): number {
    return this.closed.reduce((s, t) => s + (t.profit > 0 ? t.profit : 0), 0);
  }

  get grossLoss(): number {
    return this.closed.reduce((s, t) => s + (t.profit < 0 ? -t.profit : 0), 0);
  }

  get closedCount(): number {
    return this.closed.length;
  }

  get openCount(): number {
    return this.open.length;
  }

  get winCount(): number {
    return this.closed.filter((t) => t.profit > 0).length;
  }

  get lossCount(): number {
    return this.closed.filter((t) => t.profit < 0).length;
  }

  get maxDrawdown(): number {
    return this.maxDDCash;
  }

  closedTrade(i: number): ClosedTrade | undefined {
    return this.closed[i];
  }

  openTradeInfo(i: number): { id: string; size: number; entryPrice: number; entryTime: number; profit: number } | undefined {
    const t = this.open[i];
    if (!t) return undefined;
    return {
      id: t.id,
      size: t.dir * t.qty,
      entryPrice: t.entryPrice,
      entryTime: t.entryTime,
      profit: (this.lastPrice - t.entryPrice) * t.dir * t.qty,
    };
  }

  // ------------------------------------------------------------ order API

  entry(id: string, dir: Dir, opts: { qty?: number; limit?: number; stop?: number; comment?: string } = {}, bar = -1): void {
    this.entries = this.entries.filter((o) => o.id !== id);
    this.entries.push({
      kind: 'entry',
      id,
      dir,
      qty: opts.qty,
      limit: opts.limit,
      stop: opts.stop,
      comment: opts.comment ?? '',
      issuedBar: bar,
    });
  }

  order(id: string, dir: Dir, opts: { qty?: number; limit?: number; stop?: number; comment?: string } = {}, bar = -1): void {
    this.entries = this.entries.filter((o) => o.id !== id);
    this.entries.push({
      kind: 'order',
      id,
      dir,
      qty: opts.qty,
      limit: opts.limit,
      stop: opts.stop,
      comment: opts.comment ?? '',
      issuedBar: bar,
    });
  }

  close(id: string, opts: { qty?: number; qtyPercent?: number; comment?: string } = {}, bar = -1): void {
    this.closes.push({ id, qty: opts.qty, qtyPercent: opts.qtyPercent, comment: opts.comment ?? '', issuedBar: bar });
  }

  closeAll(comment = '', bar = -1): void {
    this.closes.push({ id: null, comment, issuedBar: bar });
  }

  exit(spec: ExitSpec): void {
    this.exits.set(spec.id, spec);
  }

  cancel(id: string): void {
    this.entries = this.entries.filter((o) => o.id !== id);
    this.exits.delete(id);
  }

  cancelAll(): void {
    this.entries = [];
    this.exits.clear();
  }

  // ------------------------------------------------------------ bar lifecycle

  /** Call before the script runs on `bar`. */
  beginBar(bar: BrokerBar, subBars?: SubBar[]): void {
    this.bar = bar;
    this.lastPrice = bar.open;
    // 1) market orders from previous bar fill at the open
    this.fillMarketOrders(bar, bar.open, (o) => o < bar.index || !this.cfg.processOrdersOnClose);
    // 2) intrabar limit / stop resolution (bar magnifier: gerçek alt zaman dilimi yolu)
    this.simulatePath(bar, subBars);
    this.lastPrice = bar.close;
  }

  /** Call after the script ran on `bar`. */
  endBar(bar: BrokerBar): void {
    if (this.cfg.processOrdersOnClose) {
      this.lastPrice = bar.close;
      this.fillMarketOrders(bar, bar.close, () => true);
    }
    this.lastPrice = bar.close;
    this.pruneExits();
    const eq = this.equity;
    this.equityCurve.push({ time: bar.time, value: eq });
    if (eq > this.peak) this.peak = eq;
    const dd = this.peak > 0 ? ((this.peak - eq) / this.peak) * 100 : 0;
    if (dd > this.maxDD) this.maxDD = dd;
    if (this.peak - eq > this.maxDDCash) this.maxDDCash = this.peak - eq;
  }

  // ------------------------------------------------------------ fills

  private commission(qty: number, price: number): number {
    const v = this.cfg.commissionValue;
    if (!v) return 0;
    switch (this.cfg.commissionType) {
      case 'cash_per_order':
        return v;
      case 'cash_per_contract':
        return v * Math.abs(qty);
      default:
        return (Math.abs(qty) * price * v) / 100;
    }
  }

  private defaultQty(price: number): number {
    const v = this.cfg.defaultQtyValue;
    switch (this.cfg.defaultQtyType) {
      case 'percent_of_equity': {
        const feeFactor =
          this.cfg.commissionType === 'percent' ? 1 + this.cfg.commissionValue / 100 : 1;
        return (this.equity * (v / 100)) / (price * feeFactor);
      }
      case 'cash':
        return v / price;
      default:
        return v;
    }
  }

  private fillMarketOrders(bar: BrokerBar, price: number, ready: (issuedBar: number) => boolean): void {
    // closes first (they were issued before / alongside entries)
    const closes = this.closes.filter((c) => ready(c.issuedBar));
    this.closes = this.closes.filter((c) => !ready(c.issuedBar));
    for (const c of closes) this.applyClose(c, bar, price);

    const entries = this.entries.filter((o) => !num(o.limit) && !num(o.stop) && ready(o.issuedBar));
    this.entries = this.entries.filter((o) => !(!num(o.limit) && !num(o.stop) && ready(o.issuedBar)));
    for (const o of entries) this.applyEntry(o, bar, price);
  }

  private applyClose(c: CloseOrder, bar: BrokerBar, price: number): void {
    const targets = c.id === null ? [...this.open] : this.open.filter((t) => t.id === c.id);
    for (const t of targets) {
      let q = t.qty;
      if (num(c.qty)) q = Math.min(t.qty, c.qty);
      else if (num(c.qtyPercent)) q = Math.min(t.qty, (t.qty0 * c.qtyPercent) / 100);
      this.closeTrade(t, q, price, bar, c.comment || (c.id === null ? 'close_all' : `close ${c.id}`));
    }
  }

  private applyEntry(o: EntryOrder, bar: BrokerBar, price: number): void {
    const qty = num(o.qty) ? o.qty : this.defaultQty(price);
    if (!(qty > 0)) return;

    if (o.kind === 'order') {
      // net-position order: offset opposite trades FIFO, remainder opens a new trade
      let left = qty;
      for (const t of [...this.open]) {
        if (t.dir === o.dir || left <= 0) continue;
        const q = Math.min(t.qty, left);
        this.closeTrade(t, q, price, bar, o.comment || `order ${o.id}`);
        left -= q;
      }
      if (left > 0) this.openTrade(o, left, price, bar);
      return;
    }

    const posDir = this.open.length ? this.open[0].dir : 0;
    if (posDir !== 0 && posDir !== o.dir) {
      for (const t of [...this.open]) this.closeTrade(t, t.qty, price, bar, o.comment || `reverse ${o.id}`);
    } else if (posDir === o.dir && this.open.length >= this.cfg.pyramiding) {
      return; // pyramiding limit
    }
    this.openTrade(o, qty, price, bar);
  }

  private openTrade(o: EntryOrder, qty: number, price: number, bar: BrokerBar): void {
    const fee = this.commission(qty, price);
    this.cash -= fee;
    this.commissionPaid += fee;
    this.open.push({
      id: o.id,
      dir: o.dir,
      qty,
      qty0: qty,
      entryPrice: price,
      entryTime: bar.time,
      entryBar: bar.index,
      entryComment: o.comment,
      entryCommissionLeft: fee,
      trail: new Map(),
      exitFilled: new Map(),
    });
    this.recordFill(bar.time, o.dir === 1 ? 'buy' : 'sell', qty, price, o.id, o.comment);
    this.markers.push({
      time: bar.time,
      position: o.dir === 1 ? 'belowBar' : 'aboveBar',
      color: o.dir === 1 ? '#00E676' : '#F23645',
      shape: o.dir === 1 ? 'arrowUp' : 'arrowDown',
      text: o.comment || o.id,
      source: 'broker',
    });
  }

  private recordFill(time: number, action: 'buy' | 'sell', qty: number, price: number, id: string, comment: string): void {
    this.fills.push({ time, action, qty, price, id, comment, positionSize: this.positionSize });
    if (this.fills.length > 200) this.fills.shift();
  }

  private closeTrade(t: OpenTrade, qty: number, price: number, bar: BrokerBar, comment: string): void {
    const q = Math.min(qty, t.qty);
    if (!(q > 0)) return;
    const gross = (price - t.entryPrice) * t.dir * q;
    const exitFee = this.commission(q, price);
    const entryFeePart = t.entryCommissionLeft * (q / t.qty);
    t.entryCommissionLeft -= entryFeePart;
    this.cash += gross - exitFee;
    this.commissionPaid += exitFee;
    this.closed.push({
      id: t.id,
      dir: t.dir,
      qty: q,
      entryPrice: t.entryPrice,
      entryTime: t.entryTime,
      exitPrice: price,
      exitTime: bar.time,
      profit: gross - exitFee - entryFeePart,
      commission: exitFee + entryFeePart,
      entryComment: t.entryComment,
      exitComment: comment,
    });
    t.qty -= q;
    if (t.qty <= 1e-12) this.open = this.open.filter((x) => x !== t);
    this.recordFill(bar.time, t.dir === 1 ? 'sell' : 'buy', q, price, t.id, comment);
    this.markers.push({
      time: bar.time,
      position: t.dir === 1 ? 'aboveBar' : 'belowBar',
      color: '#FFB300',
      shape: 'circle',
      text: comment || 'exit',
      source: 'broker',
    });
  }

  // ------------------------------------------------------------ intrabar simulation

  private simulatePath(bar: BrokerBar, subBars?: SubBar[]): void {
    const pts = intrabarPath(bar, subBars);
    let cursor = bar.open;
    let reachedHi = bar.open;
    let reachedLo = bar.open;
    for (const target of pts) {
      let guard = 0;
      while (guard++ < 2000) {
        const levels = this.collectLevels(bar, Math.max(reachedHi, cursor), Math.min(reachedLo, cursor));
        const rising = target > cursor;
        const falling = target < cursor;
        let best: Level | null = null;
        let bestDist = Infinity;
        for (const lv of levels) {
          // triggered immediately (gap / already beyond) or reached along this segment
          const beyond = lv.up ? cursor >= lv.price : cursor <= lv.price;
          const reached = lv.up ? rising && target >= lv.price : falling && target <= lv.price;
          if (!beyond && !reached) continue;
          const dist = beyond ? -1 : Math.abs(lv.price - cursor);
          if (dist < bestDist) {
            best = lv;
            bestDist = dist;
          }
        }
        if (!best) break;
        const px = lv_px(best, cursor);
        best.fill(px);
        cursor = px;
      }
      cursor = target;
      reachedHi = Math.max(reachedHi, target);
      reachedLo = Math.min(reachedLo, target);
    }
  }

  /** hi / lo = extremes the intrabar path has reached so far (trailing stops follow them). */
  private collectLevels(bar: BrokerBar, hi: number, lo: number): Level[] {
    const out: Level[] = [];
    const tick = this.cfg.mintick;

    // pending entry orders with limit / stop
    for (const o of this.entries) {
      const mk = (price: number, up: boolean) =>
        out.push({
          price,
          up,
          fill: (px) => {
            this.entries = this.entries.filter((x) => x !== o);
            this.applyEntry(o, bar, px);
          },
        });
      if (num(o.limit) && num(o.stop)) {
        // stop-limit: stop triggers, then limit is the fill price (approximation: fill at limit)
        mk(o.stop, o.dir === 1);
        continue;
      }
      if (num(o.limit)) mk(o.limit, o.dir === -1); // buy limit: falls to level; sell limit: rises
      else if (num(o.stop)) mk(o.stop, o.dir === 1); // buy stop: rises; sell stop: falls
    }

    // exit orders
    for (const ex of this.exits.values()) {
      const targets = this.open.filter((t) => (!ex.fromEntry || t.id === ex.fromEntry) && t.entryBar <= bar.index);
      if (!targets.length) continue;
      for (const t of targets) {
        const limit = num(ex.limit) ? ex.limit : num(ex.profitTicks) ? t.entryPrice + t.dir * ex.profitTicks * tick : NaN;
        let stop = num(ex.stop) ? ex.stop : num(ex.lossTicks) ? t.entryPrice - t.dir * ex.lossTicks * tick : NaN;
        let trailing = false;

        if (num(ex.trailPrice) || num(ex.trailPoints)) {
          const st = t.trail.get(ex.id) ?? { extreme: t.entryPrice, active: false };
          t.trail.set(ex.id, st);
          const act = num(ex.trailPrice) ? ex.trailPrice : t.entryPrice + t.dir * (ex.trailPoints as number) * tick;
          const favorable = t.dir === 1 ? hi : lo;
          if (!st.active && (t.dir === 1 ? favorable >= act : favorable <= act)) st.active = true;
          if (st.active) {
            st.extreme = t.dir === 1 ? Math.max(st.extreme, favorable) : Math.min(st.extreme, favorable);
            const off = (ex.trailOffset ?? 0) * tick;
            const trailStop = st.extreme - t.dir * off;
            if (!num(stop) || (t.dir === 1 ? trailStop > stop : trailStop < stop)) {
              stop = trailStop;
              trailing = true;
            }
          }
        }

        const requested = num(ex.qty) ? ex.qty : num(ex.qtyPercent) ? (t.qty0 * ex.qtyPercent) / 100 : t.qty;
        const allowed = Math.min(t.qty, requested - (t.exitFilled.get(ex.id) ?? 0));
        if (!(allowed > 1e-12)) continue;
        const doExit = (px: number, cmt: string) => {
          const q = Math.min(t.qty, allowed);
          t.exitFilled.set(ex.id, (t.exitFilled.get(ex.id) ?? 0) + q);
          this.closeTrade(t, q, px, bar, cmt);
        };
        const profitCmt = ex.commentProfit || ex.comment || 'TP';
        const lossCmt = trailing ? ex.commentTrailing || ex.commentLoss || ex.comment || 'TRAIL' : ex.commentLoss || ex.comment || 'SL';

        if (num(limit)) {
          out.push({
            price: limit,
            up: t.dir === 1,
            fill: (px) => doExit(px, profitCmt),
          });
        }
        if (num(stop)) {
          out.push({
            price: stop,
            up: t.dir === -1,
            fill: (px) => doExit(px, lossCmt),
          });
        }
      }
    }
    return out;
  }

  private pruneExits(): void {
    for (const [id, ex] of this.exits) {
      const hasTrade = this.open.some((t) => !ex.fromEntry || t.id === ex.fromEntry);
      const hasPending = this.entries.some((o) => !ex.fromEntry || o.id === ex.fromEntry);
      if (!hasTrade && !hasPending) this.exits.delete(id);
    }
  }

  // ------------------------------------------------------------ report

  buildReport(): { report: BacktestReport; markers: ScriptMarker[] } {
    const trades: BacktestTrade[] = [];
    let running = this.cfg.initialCapital;
    this.closed.forEach((t, i) => {
      running += t.profit;
      const cost = t.entryPrice * t.qty;
      trades.push({
        id: i + 1,
        direction: t.dir === 1 ? 'LONG' : 'SHORT',
        entryTime: t.entryTime,
        entryPrice: round(t.entryPrice, 4),
        exitTime: t.exitTime,
        exitPrice: round(t.exitPrice, 4),
        pnlPercent: round(cost > 0 ? (t.profit / cost) * 100 : 0, 2),
        pnlCash: round(t.profit, 2),
        equityAfter: round(running, 2),
        qty: round(t.qty, 6),
        entryId: t.id,
        entryComment: t.entryComment,
        exitComment: t.exitComment,
        commission: round(t.commission, 4),
      });
    });
    const wins = this.winCount;
    const losses = this.closed.length - wins;
    const gp = this.grossProfit;
    const gl = this.grossLoss;
    const finalEquity = this.equity;
    const net = finalEquity - this.cfg.initialCapital;
    return {
      markers: this.markers,
      report: {
        initialCapital: this.cfg.initialCapital,
        finalEquity: round(finalEquity, 2),
        netProfitCash: round(net, 2),
        netProfitPercent: round(this.cfg.initialCapital > 0 ? (net / this.cfg.initialCapital) * 100 : 0, 2),
        totalTrades: this.closed.length,
        winningTrades: wins,
        losingTrades: losses,
        winRatePercent: round(this.closed.length ? (wins / this.closed.length) * 100 : 0, 1),
        profitFactor: round(gl > 0 ? gp / gl : gp > 0 ? 99.99 : 0, 2),
        maxDrawdownPercent: round(this.maxDD, 2),
        trades,
        openTrades: this.open.length,
        fills: this.fills.slice(-50),
        openProfitCash: round(this.openProfitNet, 2),
        commissionPaid: round(this.commissionPaid, 2),
        equityCurve: this.equityCurve.map((p) => ({ time: p.time, value: round(p.value, 2) })),
      },
    };
  }
}

export interface StrategyFill {
  time: number;
  action: 'buy' | 'sell';
  qty: number;
  price: number;
  id: string;
  comment: string;
  /** dolumdan sonraki net pozisyon (+uzun / -kısa) */
  positionSize: number;
}

function lv_px(lv: Level, cursor: number): number {
  // gap through the level -> fill at the current price, otherwise at the level
  return lv.up ? Math.max(lv.price, cursor) : Math.min(lv.price, cursor);
}

function round(v: number, d: number): number {
  const f = 10 ** d;
  return Math.round(v * f) / f;
}
