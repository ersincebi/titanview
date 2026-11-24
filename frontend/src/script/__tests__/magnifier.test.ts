import { describe, expect, it } from 'vitest';
import type { Candle } from '../../types/market';
import { intrabarPath } from '../broker';
import { executeScript } from '../runtime';

const T0 = 1_700_000_000;
const H = 3600;
const bar = (i: number, o: number, h: number, l: number, c: number): Candle => ({ time: T0 + i * H, open: o, high: h, low: l, close: c, volume: 1 });
// 1sa mumları; bar 2 içinde TP (108) ve SL (92) birlikte görünüyor.
const main: Candle[] = [bar(0, 100, 101, 99, 100), bar(1, 100, 101, 99, 100), bar(2, 100, 110, 90, 105), bar(3, 105, 106, 104, 105)];
const code = `//@version=5
strategy("m", overlay=true)
if bar_index == 0
    strategy.entry("L", strategy.long)
strategy.exit("X", "L", limit=108, stop=92)`;

function sub(i: number, parts: [number, number, number, number][]): Candle[] {
  const step = H / parts.length;
  return parts.map(([o, h, l, c], k) => ({ time: T0 + i * H + k * step, open: o, high: h, low: l, close: c, volume: 1 }));
}

describe('bar büyüteci (alt TF ile dolum)', () => {
  it('büyüteçsiz Standart sezgisi: açılışa yakın uç önce → eşitlikte yüksek önce → TP', () => {
    const r = executeScript(code, main, { mintick: 1 });
    expect(r.error).toBeUndefined();
    const t = r.backtest!.trades;
    expect(t).toHaveLength(1);
    expect(t[0].exitPrice).toBe(108);
  });

  it('alt mumlar önce düşüşü gösteriyorsa SL doldurulur', () => {
    const mag = [
      ...sub(2, [
        [100, 100.5, 94, 95],
        [95, 96, 90, 91],
        [91, 99, 91, 98],
        [98, 110, 98, 105],
      ]),
    ];
    const r = executeScript(code, main, { mintick: 1, magnifierCandles: mag });
    const t = r.backtest!.trades;
    expect(t).toHaveLength(1);
    expect(t[0].exitPrice).toBe(92);
    expect(t[0].exitComment).toBe('SL');
  });

  it('alt mumlar önce yükselişi gösteriyorsa TP doldurulur', () => {
    const mag = sub(2, [
      [100, 109, 100, 109],
      [109, 110, 90, 95],
    ]);
    const r = executeScript(code, main, { mintick: 1, magnifierCandles: mag });
    expect(r.backtest!.trades[0].exitPrice).toBe(108);
  });

  it('alt mum olmayan barlar eski yolu kullanır', () => {
    const r = executeScript(code, main, { mintick: 1, magnifierCandles: sub(0, [[100, 101, 99, 100]]) });
    expect(r.backtest!.trades[0].exitPrice).toBe(108);
  });

  it('intrabarPath: alt barlar sırayla, boşlukta açılış noktası eklenir', () => {
    expect(intrabarPath({ open: 1, high: 3, low: 0, close: 2 })).toEqual([0, 3, 2]);
    expect(
      intrabarPath({ open: 1, high: 5, low: 0, close: 2 }, [
        { open: 1, high: 2, low: 1, close: 2 },
        { open: 3, high: 4, low: 3, close: 4 },
      ])
    ).toEqual([1, 2, 2, 3, 3, 4, 4]);
  });
});
