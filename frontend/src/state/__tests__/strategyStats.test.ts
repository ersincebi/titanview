import { describe, expect, it } from 'vitest';
import type { BacktestReport, BacktestTrade, Candle } from '../../types/market';
import { buyAndHold, chartGeometry, riskStats, sideStats } from '../strategyStats';

const tr = (id: number, pnl: number, dir: 'LONG' | 'SHORT' = 'LONG', entry = 0, exit = 0): BacktestTrade => ({
  id, direction: dir, entryTime: entry, entryPrice: 1, exitTime: exit, exitPrice: 1, pnlPercent: pnl / 100, pnlCash: pnl, equityAfter: 0,
});

describe('sideStats', () => {
  const trades = [tr(1, 100), tr(2, 50), tr(3, -30), tr(4, -20), tr(5, -10), tr(6, 200), tr(7, 0)];
  const s = sideStats(trades, 3600);
  it('counts and money add up', () => {
    expect(s.n).toBe(7);
    expect([s.wins, s.losses]).toEqual([3, 3]);
    expect(s.grossProfit).toBe(350);
    expect(s.grossLoss).toBe(60);
    expect(s.net).toBe(290);
    expect(s.profitFactor).toBeCloseTo(350 / 60);
    expect(s.winRate).toBeCloseTo((3 / 7) * 100);
    expect(s.avgTrade).toBeCloseTo(290 / 7);
    expect(s.avgWin).toBeCloseTo(350 / 3);
    expect(s.avgLoss).toBeCloseTo(20);
    expect(s.payoff).toBeCloseTo(350 / 3 / 20);
    expect([s.largestWin, s.largestLoss]).toEqual([200, 30]);
  });
  it('streaks: breakeven resets both', () => {
    expect([s.maxConsecWins, s.maxConsecLosses]).toEqual([2, 3]);
  });
  it('no losses -> profit factor null (not Infinity/NaN); empty is all null', () => {
    expect(sideStats([tr(1, 5)], 60).profitFactor).toBeNull();
    const e = sideStats([], 60);
    expect([e.n, e.winRate, e.avgTrade, e.payoff]).toEqual([0, null, null, null]);
  });
  it('average bars held from timestamps', () => {
    expect(sideStats([tr(1, 1, 'LONG', 1000, 1000 + 3600 * 4), tr(2, 1, 'LONG', 0, 0)], 3600).avgBarsHeld).toBe(4);
  });
});

const report = (vals: number[], net = 0): BacktestReport => ({
  initialCapital: vals[0], finalEquity: vals[vals.length - 1], netProfitCash: net, netProfitPercent: 0, totalTrades: 0, winningTrades: 0,
  losingTrades: 0, winRatePercent: 0, profitFactor: 0, maxDrawdownPercent: 0, trades: [],
  equityCurve: vals.map((value, i) => ({ time: 1000 + i * 3600, value })),
});

describe('riskStats', () => {
  it('max drawdown from the bar equity curve', () => {
    const r = riskStats(report([100, 120, 90, 110, 80, 130], 30), 3600);
    expect(r.maxDrawdownCash).toBe(40); // 120 -> 80
    expect(r.maxDrawdownPct).toBeCloseTo((40 / 120) * 100);
    expect(r.returnOnMaxDD).toBeCloseTo(30 / 40);
  });
  it('sharpe needs enough bars, is positive for a rising curve with noise, null for flat', () => {
    expect(riskStats(report([100, 101, 102]), 3600).sharpe).toBeNull();
    const rising = Array.from({ length: 60 }, (_, i) => 100 + i + (i % 3));
    expect(riskStats(report(rising), 86400).sharpe!).toBeGreaterThan(0);
    expect(riskStats(report(Array(30).fill(100)), 3600).sharpe).toBeNull();
  });
});

describe('buyAndHold + chart geometry', () => {
  const candles: Candle[] = Array.from({ length: 6 }, (_, i) => ({ time: 1000 + i * 3600, open: 10, high: 12, low: 9, close: 10 + i, volume: 1 }));
  const bt = report([1000, 1010, 1005, 1100, 1090, 1200], 200);
  it('buy&hold spans first->last curve bar with initial capital', () => {
    const b = buyAndHold(bt, candles)!;
    expect(b.pct).toBeCloseTo(50);
    expect(b.cash).toBeCloseTo(500);
    expect(buyAndHold(report([1000]), candles)).toBeNull();
    expect(buyAndHold(bt, [])).toBeNull();
  });
  it('geometry: time axis proportional, everything inside the viewBox, drawdown polygon closes on the curve', () => {
    const g = chartGeometry(bt, candles, 760, 190)!;
    const xs = g.equity.split(' ').map((p) => Number(p.split(',')[0]));
    expect(xs[0]).toBeCloseTo(46);
    expect(xs[xs.length - 1]).toBeCloseTo(752);
    for (const p of [...g.equity.split(' '), ...g.buyHold!.split(' '), ...g.drawdown.split(' ')]) {
      const [x, y] = p.split(',').map(Number);
      expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThanOrEqual(760);
      expect(y).toBeGreaterThanOrEqual(0); expect(y).toBeLessThanOrEqual(190);
    }
    expect(g.drawdown.split(' ')).toHaveLength(bt.equityCurve!.length * 2);
    expect(g.yTicks).toHaveLength(5);
    expect(g.xTicks).toHaveLength(5);
    expect(g.zeroY).not.toBeNull();
    expect(chartGeometry(report([1000]), candles)).toBeNull();
    expect(chartGeometry(bt, [])!.buyHold).toBeNull();
  });
});
