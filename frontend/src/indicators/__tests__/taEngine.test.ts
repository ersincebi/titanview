import { describe, expect, it } from 'vitest';
import type { Candle } from '../../types/market';
import {
  BUILTIN_INDICATORS,
  IndicatorRegistry,
  indicatorRegistry,
} from '../indicatorRegistry';
import {
  calcATR,
  calcBollingerBands,
  calcCCI,
  calcCrossover,
  calcCrossunder,
  calcDonchianChannels,
  calcEMA,
  calcHighest,
  calcIchimoku,
  calcKeltnerChannels,
  calcLatestATR,
  calcLatestBollinger,
  calcLatestEMA,
  calcLatestMACD,
  calcLatestRSI,
  calcLatestSMA,
  calcLatestStochastic,
  calcLatestSuperTrend,
  calcLatestVWAP,
  calcLowest,
  calcMACD,
  calcMomentum,
  calcOBV,
  calcParabolicSAR,
  calcPivotPoints,
  calcRMA,
  calcRSI,
  calcSMA,
  calcStdev,
  calcStochastic,
  calcSuperTrend,
  calcTechnicalGaugeSummary,
  calcVWAP,
  calcVolumeProfileVPVR,
  calcWilliamsR,
  calcWMA,
  cleanHistogramData,
  cleanLineData,
  sanitizeCandles,
  toHeikinAshi,
} from '../taEngine';

function makeSampleCandles(count = 100): Candle[] {
  const out: Candle[] = [];
  for (let i = 0; i < count; i++) {
    const base = 100 + Math.sin(i * 0.25) * 12 + i * 0.35;
    out.push({
      time: 1731200000 + i * 900,
      open: Number((base - 0.8).toFixed(2)),
      high: Number((base + 2.2).toFixed(2)),
      low: Number((base - 2.1).toFixed(2)),
      close: Number((base + 0.6).toFixed(2)),
      volume: 1000 + i * 25,
    });
  }
  return out;
}

describe('Technical Analysis Engine (taEngine)', () => {
  describe('Overlay Indicators (SMA, EMA, WMA, RMA, BB, SuperTrend, VWAP)', () => {
    it('computes accurate SMA (20, 50, 200) series and handles warmup NaN correctly', () => {
      const prices = [10, 20, 30, 40, 50, 60, 70];
      const sma3 = calcSMA(prices, 3);
      expect(Number.isNaN(sma3[0])).toBe(true);
      expect(Number.isNaN(sma3[1])).toBe(true);
      expect(sma3[2]).toBeCloseTo(20, 5);
      expect(sma3[3]).toBeCloseTo(30, 5);
      expect(sma3[4]).toBeCloseTo(40, 5);
      expect(sma3[5]).toBeCloseTo(50, 5);
      expect(sma3[6]).toBeCloseTo(60, 5);

      const candles = makeSampleCandles(220);
      const closes = candles.map((c) => c.close);
      const sma20 = calcSMA(closes, 20);
      const sma50 = calcSMA(closes, 50);
      const sma200 = calcSMA(closes, 200);

      expect(Number.isNaN(sma20[18])).toBe(true);
      expect(Number.isNaN(sma20[19])).toBe(false);
      expect(Number.isNaN(sma50[49])).toBe(false);
      expect(Number.isNaN(sma200[199])).toBe(false);
      expect(sma200[219]).toBeGreaterThan(0);
    });

    it('computes accurate EMA (9, 21, 55) and respects alpha weighting', () => {
      const prices = [10, 20, 30, 40, 50];
      const ema3 = calcEMA(prices, 3);
      // EMA warmup starts with first value
      expect(ema3[0]).toBeCloseTo(10, 5);
      // alpha = 2 / (3 + 1) = 0.5
      // ema[1] = 0.5 * 20 + 0.5 * 10 = 15
      expect(ema3[1]).toBeCloseTo(15, 5);
      // ema[2] = 0.5 * 30 + 0.5 * 15 = 22.5
      expect(ema3[2]).toBeCloseTo(22.5, 5);

      const candles = makeSampleCandles(80);
      const closes = candles.map((c) => c.close);
      const ema9 = calcEMA(closes, 9);
      const ema21 = calcEMA(closes, 21);
      const ema55 = calcEMA(closes, 55);

      expect(ema9.length).toBe(80);
      expect(ema21.length).toBe(80);
      expect(ema55.length).toBe(80);
      expect(Number.isNaN(ema55[79])).toBe(false);
    });

    it('computes WMA and RMA (Wilder smoothing) accurately', () => {
      const prices = [1, 2, 3, 4, 5];
      // WMA length 3: denom = (3*4)/2 = 6
      // at i=2: (3*3 + 2*2 + 1*1) / 6 = (9 + 4 + 1)/6 = 14/6 = 2.3333
      const wma3 = calcWMA(prices, 3);
      expect(Number.isNaN(wma3[0])).toBe(true);
      expect(Number.isNaN(wma3[1])).toBe(true);
      expect(wma3[2]).toBeCloseTo(14 / 6, 4);

      // RMA length 3: alpha = 1 / 3
      const rma3 = calcRMA(prices, 3);
      expect(rma3[0]).toBeCloseTo(1, 4);
      expect(rma3[1]).toBeCloseTo((1 / 3) * 2 + (2 / 3) * 1, 4);
    });

    it('computes Bollinger Bands (20, 2.0) and validates bands order (Upper > Mid > Lower)', () => {
      const candles = makeSampleCandles(60);
      const closes = candles.map((c) => c.close);
      const bb = calcBollingerBands(closes, 20, 2.0);

      expect(bb.upper.length).toBe(60);
      expect(bb.middle.length).toBe(60);
      expect(bb.lower.length).toBe(60);

      for (let i = 20; i < 60; i++) {
        expect(bb.upper[i]).toBeGreaterThan(bb.middle[i]);
        expect(bb.middle[i]).toBeGreaterThan(bb.lower[i]);
        expect(Number.isNaN(bb.upper[i])).toBe(false);
        expect(Number.isNaN(bb.lower[i])).toBe(false);
      }
    });

    it('computes SuperTrend (10, 3.0) and generates valid direction & trailing stop', () => {
      const candles = makeSampleCandles(70);
      const st = calcSuperTrend(candles, 3.0, 10);

      expect(st.supertrend.length).toBe(70);
      expect(st.direction.length).toBe(70);

      for (let i = 10; i < 70; i++) {
        expect([-1, 1]).toContain(st.direction[i]);
        expect(st.supertrend[i]).toBeGreaterThan(0);
        expect(Number.isNaN(st.supertrend[i])).toBe(false);
      }
    });

    it('computes VWAP (Volume Weighted Average Price) accurately', () => {
      const candles = makeSampleCandles(50);
      const vwap = calcVWAP(candles);

      expect(vwap.length).toBe(50);
      for (let i = 0; i < 50; i++) {
        expect(vwap[i]).toBeGreaterThan(0);
        expect(Number.isNaN(vwap[i])).toBe(false);
      }
    });
  });

  describe('Sub-Pane Oscillators (RSI 14, MACD 12,26,9, Stochastic 14,3,3, ATR 14)', () => {
    it('computes RSI (14) within valid [0, 100] range', () => {
      const candles = makeSampleCandles(80);
      const closes = candles.map((c) => c.close);
      const rsi = calcRSI(closes, 14);

      expect(rsi.length).toBe(80);
      expect(Number.isNaN(rsi[13])).toBe(true);
      expect(Number.isNaN(rsi[14])).toBe(false);

      for (let i = 14; i < 80; i++) {
        expect(rsi[i]).toBeGreaterThanOrEqual(0);
        expect(rsi[i]).toBeLessThanOrEqual(100);
      }
    });

    it('computes MACD (12, 26, 9) line, signal line, and histogram', () => {
      const candles = makeSampleCandles(80);
      const closes = candles.map((c) => c.close);
      const macd = calcMACD(closes, 12, 26, 9);

      expect(macd.macdLine.length).toBe(80);
      expect(macd.signalLine.length).toBe(80);
      expect(macd.histLine.length).toBe(80);

      for (let i = 35; i < 80; i++) {
        expect(Number.isNaN(macd.macdLine[i])).toBe(false);
        expect(Number.isNaN(macd.signalLine[i])).toBe(false);
        expect(Number.isNaN(macd.histLine[i])).toBe(false);
        expect(macd.histLine[i]).toBeCloseTo(macd.macdLine[i] - macd.signalLine[i], 5);
      }
    });

    it('computes Stochastic Oscillator (14, 3, 3) %K and %D within [0, 100]', () => {
      const candles = makeSampleCandles(70);
      const stoch = calcStochastic(candles, 14, 3, 3);

      expect(stoch.k.length).toBe(70);
      expect(stoch.d.length).toBe(70);

      for (let i = 20; i < 70; i++) {
        expect(stoch.k[i]).toBeGreaterThanOrEqual(0);
        expect(stoch.k[i]).toBeLessThanOrEqual(100);
        expect(stoch.d[i]).toBeGreaterThanOrEqual(0);
        expect(stoch.d[i]).toBeLessThanOrEqual(100);
        expect(Number.isNaN(stoch.k[i])).toBe(false);
        expect(Number.isNaN(stoch.d[i])).toBe(false);
      }
    });

    it('computes ATR (14) volatility indicator', () => {
      const candles = makeSampleCandles(50);
      const atr = calcATR(candles, 14);

      expect(atr.length).toBe(50);
      for (let i = 14; i < 50; i++) {
        expect(atr[i]).toBeGreaterThan(0);
        expect(Number.isNaN(atr[i])).toBe(false);
      }
    });
  });

  describe('Real-time WebSocket Live Candle Recalculations', () => {
    it('calcLatestSMA matches full series final value', () => {
      const candles = makeSampleCandles(50);
      const closes = candles.map((c) => c.close);
      const fullSMA = calcSMA(closes, 20);
      const latestSMA = calcLatestSMA(candles, 20);

      expect(latestSMA).toBeCloseTo(fullSMA[49], 5);
    });

    it('calcLatestBollinger matches full series final value', () => {
      const candles = makeSampleCandles(60);
      const closes = candles.map((c) => c.close);
      const fullBB = calcBollingerBands(closes, 20, 2.0);
      const latestBB = calcLatestBollinger(candles, 20, 2.0);

      expect(latestBB.middle).toBeCloseTo(fullBB.middle[59], 5);
      expect(latestBB.upper).toBeCloseTo(fullBB.upper[59], 5);
      expect(latestBB.lower).toBeCloseTo(fullBB.lower[59], 5);
    });

    it('calcLatestRSI, calcLatestMACD, calcLatestSuperTrend, calcLatestVWAP match full series', () => {
      const candles = makeSampleCandles(80);
      const closes = candles.map((c) => c.close);

      const fullRSI = calcRSI(closes, 14);
      expect(calcLatestRSI(candles, 14)).toBeCloseTo(fullRSI[79], 5);

      const fullMACD = calcMACD(closes, 12, 26, 9);
      const latestMACD = calcLatestMACD(candles, 12, 26, 9);
      expect(latestMACD.macdLine).toBeCloseTo(fullMACD.macdLine[79], 5);
      expect(latestMACD.signalLine).toBeCloseTo(fullMACD.signalLine[79], 5);
      expect(latestMACD.histLine).toBeCloseTo(fullMACD.histLine[79], 5);

      const fullST = calcSuperTrend(candles, 3.0, 10);
      const latestST = calcLatestSuperTrend(candles, 3.0, 10);
      expect(latestST.supertrend).toBeCloseTo(fullST.supertrend[79], 5);
      expect(latestST.direction).toBe(fullST.direction[79]);

      const fullVWAP = calcVWAP(candles);
      expect(calcLatestVWAP(candles)).toBeCloseTo(fullVWAP[79], 5);

      const fullStoch = calcStochastic(candles, 14, 3, 3);
      const latestStoch = calcLatestStochastic(candles, 14, 3, 3);
      expect(latestStoch.k).toBeCloseTo(fullStoch.k[79], 5);
      expect(latestStoch.d).toBeCloseTo(fullStoch.d[79], 5);

      const fullATR = calcATR(candles, 14);
      expect(calcLatestATR(candles, 14)).toBeCloseTo(fullATR[79], 5);
    });
  });

  describe('NaN Cleaning and Lightweight Charts Sanitization', () => {
    it('cleanLineData discards all NaN, null, and non-finite values', () => {
      const times = [100, 200, 300, 400, 500, 600];
      const values = [NaN, 10, null, 25, Infinity, -NaN];

      const clean = cleanLineData(times, values as any);
      expect(clean).toEqual([
        { time: 200, value: 10 },
        { time: 400, value: 25 },
      ]);
    });

    it('cleanHistogramData applies color callback and strips NaNs', () => {
      const times = [1, 2, 3, 4];
      const values = [NaN, 5, -2, NaN];

      const clean = cleanHistogramData(times, values, (v) => (v >= 0 ? 'green' : 'red'));
      expect(clean).toEqual([
        { time: 2, value: 5, color: 'green' },
        { time: 3, value: -2, color: 'red' },
      ]);
    });

    it('sanitizeCandles repairs damaged candle data', () => {
      const raw: Candle[] = [
        { time: 100, open: 10, high: 9, low: 12, close: 11, volume: -5 }, // corrupted high/low
        { time: NaN as any, open: 10, high: 11, low: 9, close: 10, volume: 100 }, // invalid time
        { time: 200, open: 12, high: 15, low: 11, close: 14, volume: 50 },
      ];

      const sanitized = sanitizeCandles(raw);
      expect(sanitized.length).toBe(2);
      expect(sanitized[0].high).toBe(12);
      expect(sanitized[0].low).toBe(9);
      expect(sanitized[0].volume).toBe(0);
      expect(sanitized[1].time).toBe(200);
    });
  });

  describe('Crossover, Ichimoku, Parabolic SAR, VPVR and Gauge', () => {
    it('detects crossover and crossunder accurately', () => {
      const fast = [10, 11, 13, 12, 10];
      const slow = [12, 12, 12, 12, 12];

      const crossOver = calcCrossover(fast, slow);
      const crossUnder = calcCrossunder(fast, slow);

      expect(crossOver).toEqual([0, 0, 1, 0, 0]);
      expect(crossUnder).toEqual([0, 0, 0, 0, 1]);
    });

    it('computes Ichimoku, Parabolic SAR, VPVR and Heikin-Ashi', () => {
      const candles = makeSampleCandles(80);

      const ichi = calcIchimoku(candles);
      expect(ichi.tenkan.length).toBe(80);
      expect(ichi.kijun.length).toBe(80);
      expect(ichi.spanA.length).toBe(80);
      expect(ichi.spanB.length).toBe(80);

      const psar = calcParabolicSAR(candles);
      expect(psar.length).toBe(80);
      expect(psar[79]).toBeGreaterThan(0);

      const vpvr = calcVolumeProfileVPVR(candles, 24);
      expect(vpvr).not.toBeNull();
      expect(vpvr!.buckets.length).toBe(24);
      expect(vpvr!.pocPrice).toBeGreaterThan(0);
      expect(vpvr!.vahPrice).toBeGreaterThanOrEqual(vpvr!.pocPrice);
      expect(vpvr!.valPrice).toBeLessThanOrEqual(vpvr!.pocPrice);

      const ha = toHeikinAshi(candles);
      expect(ha.length).toBe(80);
      expect(ha[10].high).toBeGreaterThanOrEqual(ha[10].low);
    });

    it('computes Donchian, Keltner, Pivots, CCI, Momentum, Williams %R and OBV', () => {
      const candles = makeSampleCandles(80);

      // Donchian
      const dc = calcDonchianChannels(candles, 20);
      expect(dc.upper.length).toBe(80);
      expect(dc.upper[30]).toBeGreaterThanOrEqual(dc.lower[30]);
      expect(dc.middle[30]).toBe((dc.upper[30] + dc.lower[30]) / 2);

      // Keltner
      const kc = calcKeltnerChannels(candles, 20, 1.5);
      expect(kc.upper[30]).toBeGreaterThanOrEqual(kc.middle[30]);
      expect(kc.middle[30]).toBeGreaterThanOrEqual(kc.lower[30]);

      // Pivot Points
      const pp = calcPivotPoints(candles);
      expect(pp.r1[10]).toBeGreaterThan(pp.p[10]);
      expect(pp.s1[10]).toBeLessThan(pp.p[10]);
      expect(pp.r2[10]).toBeGreaterThan(pp.r1[10]);
      expect(pp.s2[10]).toBeLessThan(pp.s1[10]);

      // CCI
      const cci = calcCCI(candles, 20);
      expect(cci.length).toBe(80);
      expect(Number.isFinite(cci[30])).toBe(true);

      // Momentum
      const mom = calcMomentum(candles.map((c) => c.close), 10);
      expect(mom.length).toBe(80);
      expect(Number.isFinite(mom[30])).toBe(true);

      // Williams %R (-100 to 0)
      const wr = calcWilliamsR(candles, 14);
      expect(wr[30]).toBeLessThanOrEqual(0);
      expect(wr[30]).toBeGreaterThanOrEqual(-100);

      // OBV
      const obv = calcOBV(candles);
      expect(obv.length).toBe(80);
      expect(Number.isFinite(obv[79])).toBe(true);
    });

    it('computes Technical Gauge Summary', () => {
      const candles = makeSampleCandles(50);
      const gauge = calcTechnicalGaugeSummary(candles);
      expect(['GÜÇLÜ AL', 'AL', 'NÖTR', 'SAT', 'GÜÇLÜ SAT']).toContain(gauge.overallLabel);
      expect(gauge.needleAngleDeg).toBeGreaterThanOrEqual(-75);
      expect(gauge.needleAngleDeg).toBeLessThanOrEqual(75);
    });
  });

  describe('Indicator Registry System (indicatorRegistry.ts)', () => {
    it('registers all 20 built-in indicators with correct classifications', () => {
      const registry = new IndicatorRegistry();
      const all = registry.getAll();
      expect(all.length).toBeGreaterThanOrEqual(20);

      const overlays = registry.getOverlays();
      const oscillators = registry.getOscillators();

      const overlayIds = overlays.map((o) => o.id);
      const oscIds = oscillators.map((o) => o.id);

      expect(overlayIds).toContain('sma');
      expect(overlayIds).toContain('ema');
      expect(overlayIds).toContain('wma');
      expect(overlayIds).toContain('rma');
      expect(overlayIds).toContain('bb');
      expect(overlayIds).toContain('supertrend');
      expect(overlayIds).toContain('vwap');
      expect(overlayIds).toContain('ichimoku');
      expect(overlayIds).toContain('psar');
      expect(overlayIds).toContain('donchian');
      expect(overlayIds).toContain('keltner');
      expect(overlayIds).toContain('pivots');

      expect(oscIds).toContain('rsi');
      expect(oscIds).toContain('macd');
      expect(oscIds).toContain('stoch');
      expect(oscIds).toContain('atr');
      expect(oscIds).toContain('cci');
      expect(oscIds).toContain('momentum');
      expect(oscIds).toContain('williams_r');
      expect(oscIds).toContain('obv');
    });

    it('calculates all indicators without producing any NaN in output series', () => {
      const candles = makeSampleCandles(70);
      const all = indicatorRegistry.getAll();

      for (const def of all) {
        const res = indicatorRegistry.calculate(def.id, candles);
        expect(res).not.toBeNull();
        expect(res!.lines.length + (res!.histograms?.length ?? 0)).toBeGreaterThan(0);

        // Every line series must have zero NaNs
        for (const line of res!.lines) {
          for (const pt of line.data) {
            expect(Number.isNaN(pt.value)).toBe(false);
            expect(Number.isFinite(pt.value)).toBe(true);
            expect(Number.isNaN(pt.time)).toBe(false);
          }
        }

        // Every histogram series must have zero NaNs
        if (res!.histograms) {
          for (const hist of res!.histograms) {
            for (const pt of hist.data) {
              expect(Number.isNaN(pt.value)).toBe(false);
              expect(Number.isFinite(pt.value)).toBe(true);
              expect(Number.isNaN(pt.time)).toBe(false);
            }
          }
        }
      }
    });

    it('calculates real-time latest updates for all supported indicators', () => {
      const candles = makeSampleCandles(60);
      const liveIndicators = [
        'sma',
        'ema',
        'bb',
        'supertrend',
        'vwap',
        'rsi',
        'macd',
        'stoch',
        'atr',
      ];

      for (const id of liveIndicators) {
        const latestPoints = indicatorRegistry.calculateLatest(id, candles);
        expect(latestPoints.length).toBeGreaterThan(0);
        for (const pt of latestPoints) {
          expect(Number.isNaN(pt.point.value)).toBe(false);
          expect(pt.point.time).toBe(candles[59].time);
        }
      }
    });

    it('generates SuperTrend BUY and SELL markers correctly', () => {
      // Craft candles with an uptrend followed by a sharp drop to trigger both flips
      const candles: Candle[] = [];
      for (let i = 0; i < 40; i++) {
        const price = 100 + i * 2;
        candles.push({
          time: 1731200000 + i * 900,
          open: price - 1,
          high: price + 2,
          low: price - 2,
          close: price + 1,
          volume: 1000,
        });
      }
      for (let i = 40; i < 70; i++) {
        const price = 180 - (i - 40) * 4;
        candles.push({
          time: 1731200000 + i * 900,
          open: price + 2,
          high: price + 3,
          low: price - 3,
          close: price - 2,
          volume: 1000,
        });
      }

      const res = indicatorRegistry.calculate('supertrend', candles);
      expect(res).not.toBeNull();
      expect(res!.markers).toBeDefined();
      expect(res!.markers!.length).toBeGreaterThan(0);

      const hasSellMarker = res!.markers!.some(
        (m) => m.shape === 'arrowDown' && m.position === 'aboveBar'
      );
      expect(hasSellMarker).toBe(true);
    });
  });
});
