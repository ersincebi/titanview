import { describe, expect, it } from 'vitest';
import { deriveCandles, styleTag, DEFAULT_STYLE_PARAMS } from '../chartTypes';
import { walkCandles } from '../../script/__tests__/walkCandles';

// Faz 30: Varsayılan olarak Renko/Range/Kagi/P&F kutu boyutu yüklemede sabitlenir; canlı tick önek tuğlaları kaydırmaz.
describe('Faz 30 — türetilmiş stiller canlı tick', () => {
  for (const mode of ['range', 'renko', 'kagi', 'pnf'] as const) {
    it(`${mode}: sabit taban ile tick yalnız son tuğlaları etkiler`, () => {
      const hist = walkCandles(3000, 900);
      const basis = hist.slice();
      const a = deriveCandles(mode, hist, DEFAULT_STYLE_PARAMS, basis);
      const last = hist[hist.length - 1];
      const tick = [...hist.slice(0, -1), { ...last, close: last.close * 1.003, high: Math.max(last.high, last.close * 1.003) }];
      const b = deriveCandles(mode, tick, DEFAULT_STYLE_PARAMS, basis);
      const strip = (x: { time: number; open: number; close: number }) => [x.time, x.open, x.close];
      expect(b.slice(0, a.length - 1).map(strip)).toEqual(a.slice(0, a.length - 1).map(strip));
      expect(styleTag(mode, tick, DEFAULT_STYLE_PARAMS, basis)).toBe(styleTag(mode, hist, DEFAULT_STYLE_PARAMS, basis));
    });
  }
});

import { calcMACD, calcRSI } from '../../indicators/taEngine';
describe('Faz 30 — canlı RSI/MACD kuyruk penceresi', () => {
  it('son değer tam geçmişle hesaplananla çift duyarlıkta aynı', () => {
    const closes = walkCandles(20_000, 60).map((c) => c.close);
    const fullR = calcRSI(closes, 14).at(-1)!;
    const tailR = calcRSI(closes.slice(-600), 14).at(-1)!;
    expect(Math.abs(fullR - tailR)).toBeLessThan(1e-9);
    const fm = calcMACD(closes, 12, 26, 9);
    const tm = calcMACD(closes.slice(-1000), 12, 26, 9);
    expect(Math.abs(fm.macdLine.at(-1)! - tm.macdLine.at(-1)!)).toBeLessThan(1e-9);
    expect(Math.abs(fm.signalLine.at(-1)! - tm.signalLine.at(-1)!)).toBeLessThan(1e-9);
  });
});
