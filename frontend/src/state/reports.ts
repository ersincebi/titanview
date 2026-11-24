import { tt } from './i18n';
import { formatMoney } from './format';
import type { BacktestReport, Candle, ScreenerRow } from '../types/market';

export function candleChangePct(c: Candle): number {
  return c.open > 0 ? ((c.close - c.open) / c.open) * 100 : 0;
}

export function buySellPrices(lastClose: number): { sell: number; buy: number } {
  const spread = Math.max(0.01, lastClose * 0.0005);
  return { sell: lastClose - spread, buy: lastClose + spread };
}

export function dayRange(candles: Candle[], window = 96): { low: number; high: number; pct: number } | null {
  if (candles.length === 0) return null;
  const recent = candles.slice(-Math.min(candles.length, window));
  let low = Infinity;
  let high = -Infinity;
  for (const c of recent) {
    if (c.low < low) low = c.low;
    if (c.high > high) high = c.high;
  }
  const last = candles[candles.length - 1].close;
  const pct = high > low ? Math.max(0, Math.min(100, ((last - low) / (high - low)) * 100)) : 50;
  return { low, high, pct };
}

export function ratingClass(label: string): 'rating-BUY' | 'rating-SELL' | 'rating-NEUTRAL' {
  if (label.includes('AL')) return 'rating-BUY';
  if (label.includes('SAT')) return 'rating-SELL';
  return 'rating-NEUTRAL';
}

export function hotlists(rows: ScreenerRow[], n = 5): { gainers: ScreenerRow[]; losers: ScreenerRow[] } {
  const sorted = [...rows].sort((a, b) => b.changePercent - a.changePercent);
  return { gainers: sorted.slice(0, n), losers: [...sorted].reverse().slice(0, n) };
}

export function equityPolyline(bt: BacktestReport, w = 420, h = 135): { viewBox: string; points: string } | null {
  if (bt.trades.length < 2) return null;
  const pts = [bt.initialCapital, ...bt.trades.map((t) => t.equityAfter)];
  const minE = Math.min(...pts);
  const maxE = Math.max(...pts, minE + 1);
  const points = pts
    .map((val, idx) => {
      const x = (idx / (pts.length - 1)) * w;
      const y = h - 12 - ((val - minE) / (maxE - minE)) * (h - 24);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return { viewBox: `0 0 ${w} ${h}`, points };
}

export interface BreakdownRow {
  label: string;
  all: string;
  long: string;
  short: string;
}

/** Gerçek işlem listesinden Tümü / Long / Short kırılımı. */
export function tradeBreakdown(bt: BacktestReport): BreakdownRow[] {
  const sets = {
    all: bt.trades,
    long: bt.trades.filter((t) => t.direction === 'LONG'),
    short: bt.trades.filter((t) => t.direction === 'SHORT'),
  };
  const stat = (ts: typeof bt.trades) => {
    const wins = ts.filter((t) => t.pnlCash >= 0).length;
    return {
      n: String(ts.length),
      net: ts.reduce((s, t) => s + t.pnlCash, 0),
      win: ts.length ? `%${((wins / ts.length) * 100).toFixed(1)}` : '—',
    };
  };
  const a = stat(sets.all);
  const l = stat(sets.long);
  const s = stat(sets.short);
  const cash = (n: number) => formatMoney(n, 0);
  return [
    { label: tt("İşlem Sayısı"), all: a.n, long: l.n, short: s.n },
    { label: 'Net Kâr', all: cash(a.net), long: cash(l.net), short: cash(s.net) },
    { label: 'Kazanma %', all: a.win, long: l.win, short: s.win },
  ];
}
