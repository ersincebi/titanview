import { describe, expect, it } from 'vitest';
import type { BacktestReport, Candle, ScreenerRow, SymbolQuoteSummary } from '../../types/market';
import { RANGE_JUMP_TF, formatPrice, formatQuotePrice, marketLabel } from '../format';
import { buySellPrices, dayRange, equityPolyline, hotlists, ratingClass, tradeBreakdown } from '../reports';
import { NO_INDICATORS, TEMPLATES, templateFlags } from '../templates';
import { applyQuote, filterWatchlistSymbols } from '../watchlist';

const sym = (over: Partial<SymbolQuoteSummary>): SymbolQuoteSummary => ({
  symbol: 'X',
  displayName: 'X Corp',
  market: 'US',
  exchange: 'NASDAQ',
  currency: 'USD',
  provider: 'YAHOO',
  delayMinutes: 15,
  lastPrice: 1,
  changePercent: 0,
  ...over,
});

describe('format', () => {
  it('formats prices by magnitude', () => {
    expect(formatPrice(1.23456)).toBe('1.2346');
    expect(formatPrice(292.4)).toBe('292.40');
    expect(formatQuotePrice(0)).toBe('0.00');
    expect(formatQuotePrice(0.0005)).toBe('0.000500');
    expect(formatQuotePrice(5.5)).toBe('5.50');
  });
  it('labels markets and maps range jumps', () => {
    expect(marketLabel('BIST')).toBe('BIST 15d');
    expect(marketLabel('CRYPTO')).toBe('BINANCE');
    expect(marketLabel('US')).toBe('US');
    expect(RANGE_JUMP_TF['1Y']).toBe('1d');
  });
});

describe('watchlist', () => {
  const list = [
    sym({ symbol: 'THYAO.IS', displayName: 'Türk Hava Yolları', market: 'BIST' }),
    sym({ symbol: 'BTCUSDT', displayName: 'Bitcoin / Tether', market: 'CRYPTO' }),
    sym({ symbol: 'NVDA', displayName: 'NVIDIA Corporation', market: 'US' }),
  ];
  it('filters by market and query', () => {
    expect(filterWatchlistSymbols(list, 'ALL')).toHaveLength(3);
    expect(filterWatchlistSymbols(list, 'BIST')).toHaveLength(1);
    expect(filterWatchlistSymbols(list, 'ALL', 'thy')).toHaveLength(1);
    expect(filterWatchlistSymbols(list, 'ALL', 'tether')).toHaveLength(1);
    expect(filterWatchlistSymbols(list, 'BIST', 'btc')).toHaveLength(0);
  });
  it('applies a live quote immutably', () => {
    const next = applyQuote(list, 'btcusdt', 93500, 10);
    expect(next).not.toBe(list);
    expect(next.find((s) => s.symbol === 'BTCUSDT')).toMatchObject({ lastPrice: 93500, changePercent: 10 });
    expect(list.find((s) => s.symbol === 'BTCUSDT')?.lastPrice).toBe(1);
    expect(applyQuote(list, 'NOPE', 1)).toBe(list);
  });
});

describe('templates', () => {
  it('trend template turns exactly its indicators on', () => {
    const f = templateFlags(TEMPLATES.find((t) => t.key === 'trend')!)!;
    expect(f).toMatchObject({ ema9: true, ema21: true, ema55: true, supertrend: true, vpvr: true, rsi: false, bb: false });
  });
  it('titan template is a script template (no flags)', () => {
    expect(Object.values(NO_INDICATORS).every((v) => v === false)).toBe(true);
  });
});

describe('reports', () => {
  const c = (time: number, o: number, h: number, l: number, cl: number): Candle => ({ time, open: o, high: h, low: l, close: cl, volume: 1 });
  it('computes buy/sell spread with a floor', () => {
    expect(buySellPrices(1000)).toEqual({ sell: 999.5, buy: 1000.5 });
    const tiny = buySellPrices(1);
    expect(tiny.buy - tiny.sell).toBeCloseTo(0.02);
  });
  it('computes day range and the last-close position', () => {
    expect(dayRange([])).toBeNull();
    const r = dayRange([c(1, 10, 20, 5, 10), c(2, 10, 15, 8, 15)])!;
    expect(r.low).toBe(5);
    expect(r.high).toBe(20);
    expect(r.pct).toBeCloseTo(66.67, 1);
  });
  it('classifies ratings', () => {
    expect(ratingClass('GÜÇLÜ AL')).toBe('rating-BUY');
    expect(ratingClass('SAT')).toBe('rating-SELL');
    expect(ratingClass('NÖTR')).toBe('rating-NEUTRAL');
  });
  it('ranks hotlists', () => {
    const rows = [3, -2, 8, 0.5].map((p, i) => ({ symbol: `S${i}`, changePercent: p }) as ScreenerRow);
    const { gainers, losers } = hotlists(rows, 2);
    expect(gainers.map((r) => r.symbol)).toEqual(['S2', 'S0']);
    expect(losers.map((r) => r.symbol)).toEqual(['S1', 'S3']);
  });
  const bt = {
    initialCapital: 10000,
    trades: [
      { id: 1, direction: 'LONG', entryTime: 1, entryPrice: 1, exitTime: 2, exitPrice: 2, pnlPercent: 5, pnlCash: 500, equityAfter: 10500 },
      { id: 2, direction: 'SHORT', entryTime: 3, entryPrice: 2, exitTime: 4, exitPrice: 3, pnlPercent: -2, pnlCash: -210, equityAfter: 10290 },
    ],
  } as unknown as BacktestReport;
  it('builds an equity polyline only with 2+ trades', () => {
    expect(equityPolyline({ ...bt, trades: [bt.trades[0]] })).toBeNull();
    const p = equityPolyline(bt)!;
    expect(p.points.split(' ')).toHaveLength(3);
    expect(p.viewBox).toBe('0 0 420 135');
  });
  it('breaks trades down by direction from real trades', () => {
    const rows = tradeBreakdown(bt);
    expect(rows[0]).toEqual({ label: 'İşlem Sayısı', all: '2', long: '1', short: '1' });
    expect(rows[1]).toMatchObject({ all: '+$290', long: '+$500', short: '-$210' });
    expect(rows[2]).toMatchObject({ all: '%50.0', long: '%100.0', short: '%0.0' });
  });
});
