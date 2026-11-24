import { describe, expect, it } from 'vitest';
import type { Candle, ScriptExecutionResult } from '../../types/market';
import { mergeScriptResults } from '../merge';
import { BUILTIN_SCRIPT_PRESETS } from '../presets';
import { executeScript } from '../runtime';

const base = (over: Partial<ScriptExecutionResult> = {}): ScriptExecutionResult => ({
  ok: true, scriptTitle: 'A', isStrategy: false, isOverlay: true, executionMs: 1, plots: [], markers: [], hlines: [], ...over,
});
const plot = (id: string, title: string, last = 1) => ({
  id, title, color: '#fff', lineWidth: 1, style: 'line' as const, isOverlay: true, data: [{ time: 1, value: 1 }, { time: 2, value: last }],
});

describe('mergeScriptResults', () => {
  it('null second = unchanged; failing primary stays visible; failing second becomes a warning', () => {
    const a = base();
    expect(mergeScriptResults(a, null)).toBe(a);
    const bad = base({ ok: false, error: 'boom' });
    expect(mergeScriptResults(bad, base())).toBe(bad);
    const m = mergeScriptResults(a, base({ ok: false, error: 'x kırıldı' }));
    expect(m.ok).toBe(true);
    expect(m.warnings!.join()).toContain('x kırıldı');
  });

  it('keeps both scripts: unique plots added with namespaced ids, identical ones not drawn twice', () => {
    const a = base({ scriptTitle: 'Strat', isStrategy: true, plots: [plot('p0', 'EMA 20'), plot('p1', 'Stop')] });
    const b = base({ scriptTitle: 'Ind', plots: [plot('p0', 'EMA 20'), plot('p1', 'Trend', 7)] });
    const m = mergeScriptResults(a, b);
    expect(m.plots.map((p) => p.title)).toEqual(['EMA 20', 'Stop', 'Trend']);
    expect(m.plots[2].id).toBe('s2:p1');
    expect(m.scriptTitle).toBe('Strat + Ind');
    expect(m.isStrategy).toBe(true);
  });

  it('fill refs follow the id remap (dup -> primary id, unique -> s2:)', () => {
    const a = base({ plots: [plot('p0', 'EMA 20')] });
    const b = base({
      plots: [plot('p0', 'EMA 20'), plot('p1', 'Band', 5)],
      fills: [{ title: 'f', a: { plot: 'p0' }, b: { plot: 'p1' }, isOverlay: true, points: [] }],
    });
    const m = mergeScriptResults(a, b);
    expect(m.fills![0].a).toEqual({ plot: 'p0' });
    expect(m.fills![0].b).toEqual({ plot: 's2:p1' });
  });

  it('backtest comes from whichever side is the strategy; markers/hlines are de-duplicated', () => {
    const bt = { initialCapital: 1, finalEquity: 1, netProfitCash: 0, netProfitPercent: 0, totalTrades: 0, winningTrades: 0, losingTrades: 0, winRatePercent: 0, profitFactor: 0, maxDrawdownPercent: 0, trades: [] };
    const mk = { time: 1, position: 'belowBar' as const, color: 'g', shape: 'arrowUp' as const, text: 'AL' };
    const a = base({ markers: [mk], hlines: [{ price: 1, title: 'h', color: 'r' }] });
    const b = base({ isStrategy: true, backtest: bt, markers: [mk, { ...mk, time: 2 }], hlines: [{ price: 1, title: 'h', color: 'r' }] });
    const m = mergeScriptResults(a, b);
    expect(m.backtest).toBe(bt);
    expect(m.markers).toHaveLength(2);
    expect(m.hlines).toHaveLength(1);
  });

  it('a real strategy + a real indicator preset run together on the same bars', () => {
    const candles: Candle[] = Array.from({ length: 400 }, (_, i) => {
      const p = 100 + Math.sin(i / 20) * 15 + i * 0.05;
      return { time: 1_700_000_000 + i * 3600, open: p - 0.4, high: p + 1, low: p - 1, close: p, volume: 1000 + (i % 7) * 100 };
    });
    const strat = BUILTIN_SCRIPT_PRESETS.find((p) => p.id === 'ema_golden_cross_strategy')!;
    const ind = BUILTIN_SCRIPT_PRESETS.find((p) => p.id === 'bollinger_breakout_indicator')!;
    const a = executeScript(strat.code, candles);
    const b = executeScript(ind.code, candles);
    expect(a.ok, a.error).toBe(true);
    expect(b.ok, b.error).toBe(true);
    const m = mergeScriptResults(a, b);
    expect(m.ok).toBe(true);
    expect(m.backtest).toBeTruthy();
    expect(m.plots.length).toBeGreaterThanOrEqual(a.plots.length);
    expect(m.plots.length).toBeLessThanOrEqual(a.plots.length + b.plots.length);
    expect(new Set(m.plots.map((p) => p.id)).size).toBe(m.plots.length); // id çakışması yok
  });
});

