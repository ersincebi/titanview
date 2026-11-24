import { describe, expect, it } from 'vitest';
import type { BacktestReport, Candle, ScriptInputDef } from '../../types/market';
import { createOptSession } from '../../script/optimizerPool';
import { executeScript } from '../../script/runtime';
import {
  gridPoints,
  gridSize,
  gridValues,
  metricsFromBacktest,
  optimizeGenetic,
  optimizeGrid,
  paramSpecsFromInputs,
  scoreOf,
  type Evaluate,
  type Metrics,
  type ParamSpec,
} from '../optimizer';

const spec = (over: Partial<ParamSpec> = {}): ParamSpec => ({ key: 'a', title: 'A', type: 'int', min: 1, max: 5, step: 1, current: 3, enabled: true, ...over });
const metrics = (net: number, over: Partial<Metrics> = {}): Metrics => ({ net, netPct: net / 100, trades: 10, winRate: 50, profitFactor: 1.5, maxDDPct: 5, maxDDCash: 50, sharpe: 1, retDD: 2, ...over });

describe('optimizasyon — ızgara', () => {
  it('gridValues: int/float adımları, üst sınır dahil, kayan nokta temiz', () => {
    expect(gridValues(spec())).toEqual([1, 2, 3, 4, 5]);
    expect(gridValues(spec({ type: 'float', min: 0.1, max: 0.5, step: 0.1 }))).toEqual([0.1, 0.2, 0.3, 0.4, 0.5]);
    expect(gridValues(spec({ min: 2, max: 11, step: 3 }))).toEqual([2, 5, 8, 11]);
    expect(gridValues(spec({ min: 5, max: 1 }))).toEqual([5]);
  });

  it('gridSize / gridPoints: kartezyen çarpım yalnız seçili parametreler', () => {
    const specs = [spec({ key: 'a' }), spec({ key: 'b', min: 10, max: 30, step: 10 }), spec({ key: 'c', enabled: false })];
    expect(gridSize(specs)).toBe(15);
    const pts = gridPoints(specs);
    expect(pts).toHaveLength(15);
    expect(new Set(pts.map((p) => JSON.stringify(p))).size).toBe(15);
    expect(pts.every((p) => !('c' in p))).toBe(true);
    expect(gridSize([spec({ enabled: false })])).toBe(0);
    expect(gridPoints([spec({ enabled: false })])).toEqual([]);
  });

  it('gridPoints: sınır aşılırsa eşit aralıklı örnekler (tekrarsız)', () => {
    const specs = [spec({ key: 'a', min: 1, max: 100 }), spec({ key: 'b', min: 1, max: 100 })];
    const pts = gridPoints(specs, 50);
    expect(pts.length).toBeLessThanOrEqual(50);
    expect(pts.length).toBeGreaterThan(40);
    expect(new Set(pts.map((p) => JSON.stringify(p))).size).toBe(pts.length);
  });

  it('optimizeGrid: en iyiyi bulur, sıralı döner, ilerleme bildirir', async () => {
    const specs = [spec({ key: 'a', min: 1, max: 10 }), spec({ key: 'b', min: 1, max: 10 })];
    const ev: Evaluate = async (p) => metrics(-((p.a - 7) ** 2) - (p.b - 3) ** 2);
    const seen: number[] = [];
    const rs = await optimizeGrid(specs, ev, { objective: 'net', concurrency: 3, onProgress: (p) => seen.push(p.done) });
    expect(rs).toHaveLength(100);
    expect(rs[0].params).toEqual({ a: 7, b: 3 });
    expect(rs[0].score).toBeCloseTo(0, 9);
    for (let i = 1; i < rs.length; i++) expect(rs[i - 1].score).toBeGreaterThanOrEqual(rs[i].score);
    expect(seen[seen.length - 1]).toBe(100);
  });

  it('en az işlem şartı: yetersiz işlemli koşu −∞ skor alır', async () => {
    const ev: Evaluate = async (p) => metrics(p.a * 10, { trades: p.a >= 4 ? 2 : 20 });
    const rs = await optimizeGrid([spec()], ev, { objective: 'net', minTrades: 5 });
    expect(rs[0].params.a).toBe(3);
    expect(rs[rs.length - 1].score).toBe(-Infinity);
  });

  it('iptal ve başarısız koşular (null) atlanır', async () => {
    let n = 0;
    const ev: Evaluate = async (p) => (p.a === 2 ? null : metrics(p.a));
    const rs = await optimizeGrid([spec({ max: 20 })], ev, { objective: 'net', concurrency: 1, isCancelled: () => n++ > 5 });
    expect(rs.length).toBeLessThanOrEqual(6);
    expect(rs.find((r) => r.params.a === 2)).toBeUndefined();
  });
});

describe('optimizasyon — genetik', () => {
  it('ızgaranın küçük bir kısmını koşup optimuma yaklaşır (deterministik tohum)', async () => {
    const specs = [spec({ key: 'a', min: 1, max: 50 }), spec({ key: 'b', min: 1, max: 50 }), spec({ key: 'c', min: 1, max: 20 })];
    let runs = 0;
    const ev: Evaluate = async (p) => {
      runs++;
      return metrics(100 - Math.abs(p.a - 37) - Math.abs(p.b - 12) - 2 * Math.abs(p.c - 9));
    };
    const rs = await optimizeGenetic(specs, ev, { objective: 'net', population: 20, generations: 12, seed: 7, concurrency: 4 });
    const total = gridSize(specs);
    expect(total).toBe(50 * 50 * 20);
    expect(runs).toBeLessThanOrEqual(20 * 12);
    expect(runs / total).toBeLessThan(0.01);
    expect(rs[0].score).toBeGreaterThanOrEqual(92); // optimum 100
    // aynı birey iki kez koşmaz
    const keys = rs.map((r) => JSON.stringify(r.params));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('aynı tohum aynı sonuç', async () => {
    const specs = [spec({ key: 'a', min: 1, max: 30 }), spec({ key: 'b', min: 1, max: 30 })];
    const ev: Evaluate = async (p) => metrics(-((p.a - 20) ** 2) - (p.b - 5) ** 2);
    const a = await optimizeGenetic(specs, ev, { objective: 'net', population: 10, generations: 5, seed: 99 });
    const b = await optimizeGenetic(specs, ev, { objective: 'net', population: 10, generations: 5, seed: 99 });
    expect(a.map((r) => r.params)).toEqual(b.map((r) => r.params));
  });

  it('seçili parametre yoksa boş; mevcut değer ilk topluluğa tohumlanır', async () => {
    expect(await optimizeGenetic([spec({ enabled: false })], async () => metrics(1), { objective: 'net' })).toEqual([]);
    const first: number[] = [];
    await optimizeGenetic([spec({ min: 1, max: 9, current: 4 })], async (p) => (first.push(p.a), metrics(0)), { objective: 'net', population: 6, generations: 1, concurrency: 1 });
    expect(first).toContain(4);
  });
});

describe('optimizasyon — hedefler ve girdiler', () => {
  it('scoreOf hedefleri', () => {
    const m = metrics(100, { profitFactor: 3, sharpe: 2, retDD: 4, winRate: 61, maxDDCash: 30 });
    expect(scoreOf('net', m)).toBe(100);
    expect(scoreOf('profitFactor', m)).toBe(3);
    expect(scoreOf('sharpe', m)).toBe(2);
    expect(scoreOf('retDD', m)).toBe(4);
    expect(scoreOf('winRate', m)).toBe(61);
    expect(scoreOf('netPerDD', m)).toBe(70);
    expect(scoreOf('net', { ...m, trades: 0 }, 1)).toBe(-Infinity);
  });

  it('paramSpecsFromInputs: yalnız int/float, aralık türetir, geçersiz kılmayı kullanır', () => {
    const inputs: ScriptInputDef[] = [
      { id: 'len', title: 'Uzunluk', type: 'int', defval: 14 },
      { id: 'mult', title: 'Çarpan', type: 'float', defval: 2, min: 0.5, max: 4, step: 0.5 },
      { id: 'src', title: 'Kaynak', type: 'source', defval: 'close' },
      { title: 'Açık', type: 'bool', defval: true },
    ];
    const s = paramSpecsFromInputs(inputs, { len: 20 });
    expect(s.map((x) => x.key)).toEqual(['len', 'mult']);
    expect(s[0]).toMatchObject({ type: 'int', current: 20, min: 10, max: 40, step: 1, enabled: false });
    expect(s[1]).toMatchObject({ type: 'float', min: 0.5, max: 4, step: 0.5, current: 2 });
    expect(paramSpecsFromInputs(undefined)).toEqual([]);
  });

  it('metricsFromBacktest', () => {
    const bt: BacktestReport = {
      initialCapital: 1000, finalEquity: 1100, netProfitCash: 100, netProfitPercent: 10, totalTrades: 4, winningTrades: 3, losingTrades: 1,
      winRatePercent: 75, profitFactor: 3, maxDrawdownPercent: 5, trades: [],
      equityCurve: [1000, 1050, 990, 1100].map((value, i) => ({ time: i * 60, value })),
    };
    const m = metricsFromBacktest(bt, 60);
    expect(m).toMatchObject({ net: 100, trades: 4, winRate: 75, profitFactor: 3 });
    expect(m.maxDDCash).toBe(60);
    expect(m.retDD).toBeCloseTo(100 / 60, 6);
  });
});

describe('optimizasyon — gerçek TitanScript koşuları', () => {
  function bars(n: number): Candle[] {
    let s = 5;
    const r = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
    let p = 100;
    return Array.from({ length: n }, (_, i) => {
      const o = p;
      p += Math.sin(i / 9) * 2 + (r() - 0.5) * 1.2;
      return { time: 1_700_000_000 + i * 3600, open: o, high: Math.max(o, p) + 0.4, low: Math.min(o, p) - 0.4, close: p, volume: 10 };
    });
  }
  const code = `//@version=5
strategy("opt", overlay=true)
fl = input.int(5, "Hızlı", minval=2, maxval=20)
sl = input.int(20, "Yavaş", minval=10, maxval=60)
f = ta.sma(close, fl)
s = ta.sma(close, sl)
if ta.crossover(f, s)
    strategy.entry("L", strategy.long)
if ta.crossunder(f, s)
    strategy.close("L")`;

  it('oturum (satır içi) farklı girdilerle farklı sonuç verir ve doğrudan koşuyla birebir aynıdır', async () => {
    const data = bars(900);
    const session = createOptSession(code, data, { mintick: 0.01 }, 3600, true);
    const a = await session.evaluate({ Hızlı: 3, Yavaş: 15 });
    const b = await session.evaluate({ Hızlı: 8, Yavaş: 40 });
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a!.trades).toBeGreaterThan(3);
    expect(a!.net).not.toBe(b!.net);
    const direct = executeScript(code, data, { mintick: 0.01, inputOverrides: { Hızlı: 3, Yavaş: 15 } });
    expect(a!.net).toBe(direct.backtest!.netProfitCash);
    expect(a!.trades).toBe(direct.backtest!.totalTrades);
    session.dispose();
  });

  it('genetik + ızgara gerçek strateji üzerinde çalışır; genetik en iyisi ızgara en iyisine yakındır', async () => {
    const data = bars(700);
    const session = createOptSession(code, data, { mintick: 0.01 }, 3600, true);
    const res = executeScript(code, data, { mintick: 0.01 });
    const specs = paramSpecsFromInputs(res.inputs).map((s) => ({ ...s, enabled: true }));
    expect(specs.map((s) => s.title)).toEqual(['Hızlı', 'Yavaş']);
    const small = specs.map((s) => ({ ...s, step: s.key === 'Hızlı' ? 3 : 10 }));
    const grid = await optimizeGrid(small, session.evaluate, { objective: 'net', minTrades: 3, concurrency: 1 });
    expect(grid.length).toBe(gridSize(small));
    const ga = await optimizeGenetic(small, session.evaluate, { objective: 'net', minTrades: 3, population: 8, generations: 4, seed: 3, concurrency: 1 });
    expect(ga[0].score).toBeGreaterThanOrEqual(grid[0].score * 0.6 - 1e-9);
    expect(grid[0].score).toBeGreaterThanOrEqual(ga[0].score - 1e-9);
    session.dispose();
  });

  it('derlenmeyen betik: null + hata', async () => {
    const s = createOptSession('plot(', bars(30), {}, 3600, true);
    expect(await s.evaluate({})).toBeNull();
    expect(s.lastError()).toBeTruthy();
  });
});
