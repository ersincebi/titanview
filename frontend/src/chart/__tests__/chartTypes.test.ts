import { describe, expect, it } from 'vitest';
import type { Candle } from '../../types/market';
import { alignToBars, atrOf, barIndexAtOrBefore, deriveCandles, isDerivedStyle, toLineBreak, toRange, toRenko } from '../chartTypes';

function mk(closes: number[], spread = 0): Candle[] {
  return closes.map((c, i) => ({
    time: 1000 + i * 600,
    open: i === 0 ? c : closes[i - 1],
    high: Math.max(c, i === 0 ? c : closes[i - 1]) + spread,
    low: Math.min(c, i === 0 ? c : closes[i - 1]) - spread,
    close: c,
    volume: 100,
  }));
}

describe('Renko', () => {
  it('emits a brick per box moved, continuation opens at previous close', () => {
    const r = toRenko(mk([100, 103, 108, 111]), 5);
    // 100 → 108 crosses 105 (brick 100-105) ; 108 < 110 no ; 111 crosses 110 (brick 105-110)
    expect(r.map((b) => [b.open, b.close])).toEqual([[100, 105], [105, 110]]);
  });

  it('needs a two-box move to reverse, and the reversal brick opens at the previous OPEN', () => {
    const r = toRenko(mk([100, 106, 104, 99, 94]), 5);
    // up 100-105; 104 no reversal; 99 <= 105-... reversal threshold = lastOpen(100)-5 = 95 → 99 no; 94 <= 95 → down brick 100→95
    expect(r.map((b) => [b.open, b.close])).toEqual([[100, 105], [100, 95]]);
  });

  it('a down-trend reverses up only after a full two-box move from the last open', () => {
    expect(toRenko(mk([100, 94, 102]), 5).map((b) => [b.open, b.close])).toEqual([[100, 95]]);
    expect(toRenko(mk([100, 94, 106]), 5).map((b) => [b.open, b.close])).toEqual([[100, 95], [100, 105]]);
  });

  it('several bricks from one candle get strictly increasing unique times inside the bar', () => {
    const c = mk([100, 130]);
    const r = toRenko(c, 5);
    expect(r).toHaveLength(6);
    const times = r.map((b) => b.time);
    expect(new Set(times).size).toBe(6);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    expect(times[0]).toBe(c[1].time);
    expect(times[5]).toBeLessThan(c[1].time + 600);
    // volume of the source candle is split, not duplicated
    expect(r.reduce((a, b) => a + b.volume, 0)).toBeCloseTo(100, 6);
  });

  it('defaults the box to ATR(14) and returns nothing for flat data', () => {
    const c = mk([100, 101, 102, 103, 104, 105], 1);
    expect(atrOf(c)).toBeGreaterThan(0);
    expect(toRenko(c).length).toBeGreaterThan(0);
    expect(toRenko(mk([100, 100, 100]))).toEqual([]);
    expect(toRenko([])).toEqual([]);
  });
});

describe('Line Break', () => {
  it('draws continuation lines from the previous close', () => {
    const r = toLineBreak(mk([100, 102, 105, 104, 108]));
    expect(r.map((l) => [l.open, l.close])).toEqual([[100, 102], [102, 105], [105, 108]]);
  });

  it('reverses only when the close breaks the extreme of the last 3 lines', () => {
    // lines: 100-102, 102-105, 105-108. 106 stays inside; 101 is above the 3-line low (100): no reversal
    const noRev = toLineBreak(mk([100, 102, 105, 108, 106, 101]));
    expect(noRev).toHaveLength(3);
    // 99 < 100 → down line opening at the previous (up) line's open (105)
    const rev = toLineBreak(mk([100, 102, 105, 108, 106, 99]));
    expect(rev).toHaveLength(4);
    expect([rev[3].open, rev[3].close]).toEqual([105, 99]);
  });
});

describe('Range bars', () => {
  it('every closed bar spans exactly the range and bars chain open=previous close', () => {
    const c: Candle[] = [
      { time: 1000, open: 100, high: 112, low: 99, close: 111, volume: 50 },
      { time: 1600, open: 111, high: 125, low: 110, close: 124, volume: 50 },
    ];
    const r = toRange(c, 5);
    expect(r.length).toBeGreaterThan(3);
    for (const bar of r) expect(bar.high - bar.low).toBeCloseTo(5, 6);
    for (let i = 1; i < r.length; i++) expect(r[i].open).toBeCloseTo(r[i - 1].close, 6);
    const times = r.map((b) => b.time);
    expect(new Set(times).size).toBe(times.length);
  });

  it('derive helpers dispatch by mode', () => {
    expect(isDerivedStyle('renko')).toBe(true);
    expect(isDerivedStyle('candles')).toBe(false);
    expect(deriveCandles('linebreak', mk([1, 2, 3, 4]))).toHaveLength(3);
  });
});


describe('alignToBars (Betik/gösterge hizası)', () => {
  const bars = [100, 200, 250, 400];
  it('barIndexAtOrBefore', () => {
    expect(barIndexAtOrBefore(bars, 50)).toBe(-1);
    expect(barIndexAtOrBefore(bars, 100)).toBe(0);
    expect(barIndexAtOrBefore(bars, 199)).toBe(0);
    expect(barIndexAtOrBefore(bars, 250)).toBe(2);
    expect(barIndexAtOrBefore(bars, 9999)).toBe(3);
  });
  it('noktaları önceki çubuğa taşır, aynı çubukta sonuncuyu tutar, öncesini atar', () => {
    const pts = [
      { time: 50, value: 0 },
      { time: 100, value: 1 },
      { time: 130, value: 2 },
      { time: 210, value: 3 },
      { time: 260, value: 4 },
      { time: 399, value: 5 },
      { time: 500, value: 6 },
    ];
    expect(alignToBars(pts, bars)).toEqual([
      { time: 100, value: 2 },
      { time: 200, value: 3 },
      { time: 250, value: 5 },
      { time: 400, value: 6 },
    ]);
  });
  it('çıktı strictly artan ve ekstra alanları korur', () => {
    const pts = Array.from({ length: 30 }, (_, i) => ({ time: i * 40, value: i, color: 'c' }));
    const out = alignToBars(pts, bars);
    for (let i = 1; i < out.length; i++) expect(out[i].time).toBeGreaterThan(out[i - 1].time);
    expect(out.every((p) => p.color === 'c')).toBe(true);
  });
  it('çubuk yoksa boş', () => {
    expect(alignToBars([{ time: 1, value: 1 }], [])).toEqual([]);
  });
});

import { deriveCandles as derive16, DEFAULT_STYLE_PARAMS as DSP16 } from '../chartTypes';
describe('derived bars: strictly ascending times even when one candle yields > step bricks', () => {
  it('1m Range with a tiny fixed range never produces equal/descending times (BTCUSDT 1m crash)', () => {
    const cs = [];
    let p = 60000;
    for (let i = 0; i < 200; i++) {
      const o = p;
      const c = o + (i % 2 ? -1 : 1) * (150 + (i % 7) * 40);
      cs.push({ time: 1700000000 + i * 60, open: o, high: Math.max(o, c) + 20, low: Math.min(o, c) - 20, close: c, volume: 5 });
      p = c;
    }
    for (const mode of ['range', 'renko', 'linebreak', 'kagi', 'pnf'] as const) {
      const params = { ...DSP16, range: { mode: 'fixed' as const, atrLen: 14, range: 2 }, renko: { mode: 'fixed' as const, atrLen: 14, box: 2 } };
      const out = derive16(mode, cs, params);
      for (let i = 1; i < out.length; i++) expect(out[i].time).toBeGreaterThan(out[i - 1].time);
    }
    const r = derive16('range', cs, { ...DSP16, range: { mode: 'fixed', atrLen: 14, range: 2 } });
    expect(r.length).toBeGreaterThan(60 * 3);
  });
});
