import { describe, expect, it } from 'vitest';
import type { Candle } from '../../types/market';
import { executeScript } from '../runtime';

/**
 * Altın değerler: (1) literatürdeki yayımlanmış örnekler (Wilder RSI, EMA-10) ve
 * (2) testin içinde, motordan bağımsız, düz döngüyle yazılmış referans uygulamalar.
 * Yorumlayıcıdaki bir ta.* sapması burada yakalanır.
 */
const mk = (closes: number[]): Candle[] =>
  closes.map((c, i) => ({ time: 1_700_000_000 + i * 3600, open: c, high: c, low: c, close: c, volume: 100 }));

function series(code: string, candles: Candle[], idx = 0): number[] {
  const res = executeScript(`//@version=5\nindicator("g", overlay=false)\n${code}`, candles);
  expect(res.error).toBeUndefined();
  // na barlar plot verisinde yer almaz: zamana göre tam uzunlukta diziye yerleştir
  const byTime = new Map(res.plots[idx].data.map((d) => [d.time, d.value]));
  return candles.map((c) => byTime.get(c.time) ?? NaN);
}

// StockCharts "RSI" çalışma sayfası (Wilder, 14)
const RSI_CLOSES = [44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28, 46.0, 46.03, 46.41, 46.22, 45.64, 46.21, 46.25, 45.71, 46.45, 45.78, 45.35, 44.03, 44.18, 44.22, 44.57, 43.42, 42.66, 43.13];
const RSI_EXPECT = [70.53, 66.32, 66.55, 69.41, 66.36, 57.97, 62.93, 63.26, 56.06, 62.38, 54.71, 50.42, 39.99, 41.46, 41.87, 45.46, 37.3, 33.08, 37.77];

// StockCharts "Moving Averages" çalışma sayfası (10 günlük)
const EMA_CLOSES = [22.27, 22.19, 22.08, 22.17, 22.18, 22.13, 22.23, 22.43, 22.24, 22.29, 22.15, 22.39, 22.38, 22.61, 23.36, 24.05, 23.75, 23.83, 23.95, 23.63, 23.82, 23.87, 23.65, 23.19, 23.1, 23.33, 22.68, 23.1, 22.4, 22.17];
const SMA10_EXPECT = [22.22, 22.21, 22.23, 22.26, 22.31, 22.42, 22.61, 22.77, 22.91];
const EMA10_EXPECT = [22.22, 22.21, 22.24, 22.27, 22.33, 22.52, 22.8, 22.97, 23.13, 23.28, 23.34, 23.43, 23.51, 23.54, 23.47, 23.4, 23.39, 23.26, 23.23, 23.08, 22.92];

describe('golden: published reference values', () => {
  it('ta.rsi(close, 14) reproduces Wilder\'s worksheet (worksheet rounds averages to 2 decimals => +-0.2)', () => {
    const out = series('plot(ta.rsi(close, 14))', mk(RSI_CLOSES));
    expect(out.slice(0, 14).every(Number.isNaN)).toBe(true);
    RSI_EXPECT.forEach((e, i) => expect(Math.abs(out[14 + i] - e)).toBeLessThan(0.2));
  });

  it('ta.ema(close, 10) seeds with the SMA and matches the worksheet', () => {
    const out = series('plot(ta.ema(close, 10))', mk(EMA_CLOSES));
    expect(out.slice(0, 9).every(Number.isNaN)).toBe(true);
    EMA10_EXPECT.forEach((e, i) => expect(out[9 + i]).toBeCloseTo(e, 1));
  });

  it('ta.sma(close, 10)', () => {
    const out = series('plot(ta.sma(close, 10))', mk(EMA_CLOSES));
    SMA10_EXPECT.forEach((e, i) => expect(out[9 + i]).toBeCloseTo(e, 1));
  });
});

// ---- bağımsız referans uygulamalar ----
const rnd = (seed: number) => () => (seed = (seed * 16807) % 2147483647) / 2147483647;
function ohlc(n: number): Candle[] {
  const r = rnd(7);
  let p = 50;
  return Array.from({ length: n }, (_, i) => {
    const o = p;
    p = Math.max(1, p * (1 + (r() - 0.5) * 0.06));
    const hi = Math.max(o, p) * (1 + r() * 0.02);
    const lo = Math.min(o, p) * (1 - r() * 0.02);
    return { time: 1_700_000_000 + i * 900, open: o, high: hi, low: lo, close: p, volume: 100 + Math.floor(r() * 900) };
  });
}
const C = ohlc(160);
const close = C.map((c) => c.close);
const high = C.map((c) => c.high);
const low = C.map((c) => c.low);

function refRma(src: number[], n: number): number[] {
  const out = Array(src.length).fill(NaN);
  let prev = NaN;
  for (let i = n - 1; i < src.length; i++) {
    prev = i === n - 1 ? src.slice(0, n).reduce((a, b) => a + b, 0) / n : (prev * (n - 1) + src[i]) / n;
    out[i] = prev;
  }
  return out;
}
function refEma(src: number[], n: number): number[] {
  const k = 2 / (n + 1);
  const out = Array(src.length).fill(NaN);
  let prev = NaN;
  for (let i = n - 1; i < src.length; i++) {
    prev = i === n - 1 ? src.slice(0, n).reduce((a, b) => a + b, 0) / n : src[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}
const refSma = (src: number[], n: number) => src.map((_, i) => (i < n - 1 ? NaN : src.slice(i - n + 1, i + 1).reduce((a, b) => a + b, 0) / n));
function refTr(): number[] {
  return C.map((c, i) => (i === 0 ? c.high - c.low : Math.max(c.high - c.low, Math.abs(c.high - C[i - 1].close), Math.abs(c.low - C[i - 1].close))));
}

function expectSeries(actual: number[], ref: number[], tol = 1e-8, from = 0) {
  expect(actual).toHaveLength(ref.length);
  for (let i = from; i < ref.length; i++) {
    if (Number.isNaN(ref[i])) expect(Number.isNaN(actual[i]), `bar ${i} should be na`).toBe(true);
    else expect(Math.abs(actual[i] - ref[i]), `bar ${i}: ${actual[i]} vs ${ref[i]}`).toBeLessThan(tol);
  }
}

describe('golden: independent reference implementations (160 random bars)', () => {
  it('rma / ema / sma / wma', () => {
    expectSeries(series('plot(ta.rma(close, 14))', C), refRma(close, 14));
    expectSeries(series('plot(ta.ema(close, 21))', C), refEma(close, 21));
    expectSeries(series('plot(ta.sma(close, 9))', C), refSma(close, 9));
    const n = 7;
    const wma = close.map((_, i) => {
      if (i < n - 1) return NaN;
      let num = 0;
      for (let j = 0; j < n; j++) num += close[i - n + 1 + j] * (j + 1);
      return num / ((n * (n + 1)) / 2);
    });
    expectSeries(series('plot(ta.wma(close, 7))', C), wma);
  });

  it('rsi', () => {
    const up = close.map((c, i) => (i === 0 ? NaN : Math.max(c - close[i - 1], 0)));
    const dn = close.map((c, i) => (i === 0 ? NaN : Math.max(close[i - 1] - c, 0)));
    const ru = refRma(up.slice(1), 14);
    const rd = refRma(dn.slice(1), 14);
    const ref = [NaN, ...ru.map((u, i) => (Number.isNaN(u) ? NaN : rd[i] === 0 ? 100 : 100 - 100 / (1 + u / rd[i])))];
    expectSeries(series('plot(ta.rsi(close, 14))', C), ref);
  });

  it('tr / atr', () => {
    expectSeries(series('plot(ta.tr)', C), refTr());
    expectSeries(series('plot(ta.atr(14))', C), refRma(refTr(), 14));
  });

  it('macd (line, signal, histogram)', () => {
    const fast = refEma(close, 12);
    const slow = refEma(close, 26);
    const line = close.map((_, i) => fast[i] - slow[i]);
    const firstValid = line.findIndex((v) => !Number.isNaN(v));
    const sigTail = refEma(line.slice(firstValid), 9);
    const signal = [...Array(firstValid).fill(NaN), ...sigTail];
    const code = `[m, s, h] = ta.macd(close, 12, 26, 9)\nplot(m)\nplot(s)\nplot(h)`;
    expectSeries(series(code, C, 0), line);
    expectSeries(series(code, C, 1), signal);
    expectSeries(series(code, C, 2), line.map((v, i) => v - signal[i]));
  });

  it('bollinger bands use the POPULATION standard deviation', () => {
    const n = 20;
    const basis = refSma(close, n);
    const sd = close.map((_, i) => {
      if (i < n - 1) return NaN;
      const w = close.slice(i - n + 1, i + 1);
      const m = w.reduce((a, b) => a + b, 0) / n;
      return Math.sqrt(w.reduce((a, b) => a + (b - m) ** 2, 0) / n);
    });
    const code = `[mid, up, lo] = ta.bb(close, 20, 2)\nplot(mid)\nplot(up)\nplot(lo)`;
    expectSeries(series(code, C, 0), basis);
    expectSeries(series(code, C, 1), basis.map((b, i) => b + 2 * sd[i]));
    expectSeries(series(code, C, 2), basis.map((b, i) => b - 2 * sd[i]));
    expectSeries(series('plot(ta.stdev(close, 20))', C), sd);
  });

  it('stoch %K, highest/lowest, change, cum', () => {
    const n = 14;
    const hh = high.map((_, i) => (i < n - 1 ? NaN : Math.max(...high.slice(i - n + 1, i + 1))));
    const ll = low.map((_, i) => (i < n - 1 ? NaN : Math.min(...low.slice(i - n + 1, i + 1))));
    // Başlangıç barlarındaki kısmi pencere davranışı bilinçli olarak sabitlenmez; dolu pencere eşittir.
    expectSeries(series('plot(ta.highest(high, 14))', C), hh, 1e-8, n - 1);
    expectSeries(series('plot(ta.lowest(low, 14))', C), ll, 1e-8, n - 1);
    expectSeries(series('plot(ta.stoch(close, high, low, 14))', C), close.map((c, i) => (100 * (c - ll[i])) / (hh[i] - ll[i])), 1e-8, n - 1);
    expectSeries(series('plot(ta.change(close))', C), close.map((c, i) => (i === 0 ? NaN : c - close[i - 1])));
    let acc = 0;
    expectSeries(series('plot(ta.cum(close))', C), close.map((c) => (acc += c)), 1e-6); // çıktı 10 ondalığa yuvarlanır
  });
});
