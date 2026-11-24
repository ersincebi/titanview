import type { Candle } from '../types/market';

/**
 * Simple Moving Average (ta.sma)
 */
export function calcSMA(src: number[], length: number): number[] {
  const n = src.length;
  const out = new Array<number>(n).fill(NaN);
  if (length <= 0 || n === 0) return out;

  let sum = 0;
  let validCount = 0;
  for (let i = 0; i < n; i++) {
    const v = src[i];
    if (!Number.isNaN(v)) {
      sum += v;
      validCount++;
    }
    if (i >= length) {
      const old = src[i - length];
      if (!Number.isNaN(old)) {
        sum -= old;
        validCount--;
      }
    }
    if (i >= length - 1 && validCount === length) {
      out[i] = sum / length;
    }
  }
  return out;
}

/**
 * Exponential Moving Average (ta.ema)
 */
export function calcEMA(src: number[], length: number): number[] {
  const n = src.length;
  const out = new Array<number>(n).fill(NaN);
  if (length <= 0 || n === 0) return out;

  const alpha = 2 / (length + 1);
  let prev = NaN;

  for (let i = 0; i < n; i++) {
    const val = src[i];
    if (Number.isNaN(val)) continue;
    if (Number.isNaN(prev)) {
      prev = val;
      out[i] = prev;
    } else {
      prev = alpha * val + (1 - alpha) * prev;
      out[i] = prev;
    }
  }
  return out;
}

/**
 * Wilder's Moving Average (ta.rma) used in RSI and ATR
 */
export function calcRMA(src: number[], length: number): number[] {
  const n = src.length;
  const out = new Array<number>(n).fill(NaN);
  if (length <= 0 || n === 0) return out;

  const alpha = 1 / length;
  let prev = NaN;
  for (let i = 0; i < n; i++) {
    const val = src[i];
    if (Number.isNaN(val)) continue;
    if (Number.isNaN(prev)) {
      prev = val;
      out[i] = prev;
    } else {
      prev = alpha * val + (1 - alpha) * prev;
      out[i] = prev;
    }
  }
  return out;
}

/**
 * Weighted Moving Average (ta.wma)
 */
export function calcWMA(src: number[], length: number): number[] {
  const n = src.length;
  const out = new Array<number>(n).fill(NaN);
  if (length <= 0 || n < length) return out;

  const denom = (length * (length + 1)) / 2;
  for (let i = length - 1; i < n; i++) {
    let weightedSum = 0;
    let ok = true;
    for (let j = 0; j < length; j++) {
      const v = src[i - j];
      if (Number.isNaN(v)) {
        ok = false;
        break;
      }
      weightedSum += v * (length - j);
    }
    if (ok) {
      out[i] = weightedSum / denom;
    }
  }
  return out;
}

/**
 * Rolling Standard Deviation (ta.stdev)
 */
export function calcStdev(src: number[], length: number): number[] {
  const n = src.length;
  const out = new Array<number>(n).fill(NaN);
  const sma = calcSMA(src, length);

  for (let i = length - 1; i < n; i++) {
    const mean = sma[i];
    if (Number.isNaN(mean)) continue;
    let sqDiff = 0;
    for (let j = 0; j < length; j++) {
      const d = src[i - j] - mean;
      sqDiff += d * d;
    }
    out[i] = Math.sqrt(sqDiff / length);
  }
  return out;
}

/**
 * Bollinger Bands (ta.bb) -> [middle, upper, lower]
 */
export function calcBollingerBands(
  src: number[],
  length = 20,
  mult = 2.0
): { middle: number[]; upper: number[]; lower: number[] } {
  const middle = calcSMA(src, length);
  const stdev = calcStdev(src, length);
  const n = src.length;
  const upper = new Array<number>(n).fill(NaN);
  const lower = new Array<number>(n).fill(NaN);

  for (let i = 0; i < n; i++) {
    if (!Number.isNaN(middle[i]) && !Number.isNaN(stdev[i])) {
      upper[i] = middle[i] + mult * stdev[i];
      lower[i] = middle[i] - mult * stdev[i];
    }
  }
  return { middle, upper, lower };
}

/**
 * Relative Strength Index (ta.rsi)
 */
export function calcRSI(src: number[], length = 14): number[] {
  const n = src.length;
  const out = new Array<number>(n).fill(NaN);
  if (n < 2 || length <= 0) return out;

  const gains = new Array<number>(n).fill(0);
  const losses = new Array<number>(n).fill(0);

  for (let i = 1; i < n; i++) {
    const diff = src[i] - src[i - 1];
    if (Number.isNaN(diff)) continue;
    gains[i] = diff > 0 ? diff : 0;
    losses[i] = diff < 0 ? -diff : 0;
  }

  const avgGain = calcRMA(gains, length);
  const avgLoss = calcRMA(losses, length);

  for (let i = length; i < n; i++) {
    const g = avgGain[i];
    const l = avgLoss[i];
    if (Number.isNaN(g) || Number.isNaN(l)) continue;
    if (l === 0) {
      out[i] = 100;
    } else {
      const rs = g / l;
      out[i] = 100 - 100 / (1 + rs);
    }
  }
  return out;
}

/**
 * MACD (ta.macd) -> [macdLine, signalLine, histLine]
 */
export function calcMACD(
  src: number[],
  fastLen = 12,
  slowLen = 26,
  sigLen = 9
): { macdLine: number[]; signalLine: number[]; histLine: number[] } {
  const fast = calcEMA(src, fastLen);
  const slow = calcEMA(src, slowLen);
  const n = src.length;
  const macdLine = new Array<number>(n).fill(NaN);

  for (let i = 0; i < n; i++) {
    if (!Number.isNaN(fast[i]) && !Number.isNaN(slow[i])) {
      macdLine[i] = fast[i] - slow[i];
    }
  }

  const signalLine = calcEMA(macdLine, sigLen);
  const histLine = new Array<number>(n).fill(NaN);
  for (let i = 0; i < n; i++) {
    if (!Number.isNaN(macdLine[i]) && !Number.isNaN(signalLine[i])) {
      histLine[i] = macdLine[i] - signalLine[i];
    }
  }

  return { macdLine, signalLine, histLine };
}

/**
 * Average True Range (ta.atr)
 */
export function calcATR(candles: Candle[], length = 14): number[] {
  const n = candles.length;
  const tr = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    const c = candles[i];
    if (i === 0) {
      tr[i] = c.high - c.low;
    } else {
      const prevClose = candles[i - 1].close;
      tr[i] = Math.max(
        c.high - c.low,
        Math.abs(c.high - prevClose),
        Math.abs(c.low - prevClose)
      );
    }
  }
  return calcRMA(tr, length);
}

/**
 * Stochastic Oscillator (ta.stoch) -> { k, d }
 * Standard stochastic: %K = SMA(rawK, kSma), %D = SMA(%K, dSma)
 */
export interface StochasticResult {
  k: number[];
  d: number[];
}

export function calcStochastic(
  candles: Candle[],
  kPeriod = 14,
  kSma = 3,
  dSma = 3
): StochasticResult {
  const n = candles.length;
  const rawK = new Array<number>(n).fill(NaN);
  if (n === 0 || kPeriod <= 0) {
    return { k: new Array<number>(n).fill(NaN), d: new Array<number>(n).fill(NaN) };
  }

  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const closes = candles.map((c) => c.close);

  const highest = calcHighest(highs, kPeriod);
  const lowest = calcLowest(lows, kPeriod);

  for (let i = 0; i < n; i++) {
    const hi = highest[i];
    const lo = lowest[i];
    if (!Number.isNaN(hi) && !Number.isNaN(lo)) {
      const range = hi - lo;
      if (range === 0) {
        rawK[i] = 50;
      } else {
        rawK[i] = ((closes[i] - lo) / range) * 100;
      }
    }
  }

  const k = calcSMA(rawK, kSma);
  const d = calcSMA(k, dSma);

  return { k, d };
}

/**
 * SuperTrend (ta.supertrend)
 */
export function calcSuperTrend(
  candles: Candle[],
  factor = 3.0,
  atrPeriod = 10
): { supertrend: number[]; direction: number[] } {
  const n = candles.length;
  const atr = calcATR(candles, atrPeriod);
  const supertrend = new Array<number>(n).fill(NaN);
  const direction = new Array<number>(n).fill(1);

  const upperBand = new Array<number>(n).fill(0);
  const lowerBand = new Array<number>(n).fill(0);

  for (let i = 0; i < n; i++) {
    const hl2 = (candles[i].high + candles[i].low) / 2;
    const a = Number.isNaN(atr[i]) ? candles[i].high - candles[i].low : atr[i];
    const basicUpper = hl2 + factor * a;
    const basicLower = hl2 - factor * a;

    if (i === 0) {
      upperBand[i] = basicUpper;
      lowerBand[i] = basicLower;
      direction[i] = -1;
      supertrend[i] = lowerBand[i];
      continue;
    }

    upperBand[i] =
      basicUpper < upperBand[i - 1] || candles[i - 1].close > upperBand[i - 1]
        ? basicUpper
        : upperBand[i - 1];

    lowerBand[i] =
      basicLower > lowerBand[i - 1] || candles[i - 1].close < lowerBand[i - 1]
        ? basicLower
        : lowerBand[i - 1];

    const prevDir = direction[i - 1];
    if (prevDir === 1 && candles[i].close > upperBand[i]) {
      direction[i] = -1;
    } else if (prevDir === -1 && candles[i].close < lowerBand[i]) {
      direction[i] = 1;
    } else {
      direction[i] = prevDir;
    }

    supertrend[i] = direction[i] === -1 ? lowerBand[i] : upperBand[i];
  }

  return { supertrend, direction };
}

/**
 * Volume Weighted Average Price (ta.vwap)
 */
export function calcVWAP(candles: Candle[]): number[] {
  const n = candles.length;
  const out = new Array<number>(n).fill(NaN);
  let cumPV = 0;
  let cumVol = 0;
  let currentDay = -1;

  for (let i = 0; i < n; i++) {
    const c = candles[i];
    const dayBucket = Math.floor(c.time / 86400);
    if (dayBucket !== currentDay) {
      currentDay = dayBucket;
      cumPV = 0;
      cumVol = 0;
    }
    const typical = (c.high + c.low + c.close) / 3;
    const vol = c.volume > 0 ? c.volume : 1;
    cumPV += typical * vol;
    cumVol += vol;
    out[i] = cumPV / cumVol;
  }
  return out;
}

/**
 * Ichimoku Cloud (Tenkan 9, Kijun 26, Senkou Span A, Senkou Span B 52)
 */
export function calcIchimoku(candles: Candle[]): {
  tenkan: number[];
  kijun: number[];
  spanA: number[];
  spanB: number[];
} {
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const n = candles.length;

  const donchianMid = (len: number) => {
    const hi = calcHighest(highs, len);
    const lo = calcLowest(lows, len);
    return hi.map((h, i) => (h + lo[i]) / 2);
  };

  const tenkan = donchianMid(9);
  const kijun = donchianMid(26);
  const spanA = tenkan.map((t, i) => (t + kijun[i]) / 2);
  const spanB = donchianMid(Math.min(52, Math.max(10, Math.floor(n / 2))));
  return { tenkan, kijun, spanA, spanB };
}

/**
 * Parabolic SAR (ta.sar)
 */
export function calcParabolicSAR(candles: Candle[], step = 0.02, maxAf = 0.2): number[] {
  const n = candles.length;
  const sar = new Array<number>(n).fill(NaN);
  if (n < 2) return sar;

  let isLong = candles[1].close >= candles[0].close;
  let af = step;
  let ep = isLong ? candles[0].high : candles[0].low;
  sar[0] = isLong ? candles[0].low : candles[0].high;

  for (let i = 1; i < n; i++) {
    const prevSar = sar[i - 1];
    let nextSar = prevSar + af * (ep - prevSar);

    if (isLong) {
      if (candles[i].low < nextSar) {
        isLong = false;
        nextSar = ep;
        ep = candles[i].low;
        af = step;
      } else {
        if (candles[i].high > ep) {
          ep = candles[i].high;
          af = Math.min(maxAf, af + step);
        }
      }
    } else {
      if (candles[i].high > nextSar) {
        isLong = true;
        nextSar = ep;
        ep = candles[i].high;
        af = step;
      } else {
        if (candles[i].low < ep) {
          ep = candles[i].low;
          af = Math.min(maxAf, af + step);
        }
      }
    }
    sar[i] = nextSar;
  }
  return sar;
}

/**
 * Volume Profile Visible Range (VPVR)
 */
export interface VPVRBucket {
  priceMid: number;
  priceLow: number;
  priceHigh: number;
  bullVolume: number;
  bearVolume: number;
  totalVolume: number;
  widthRatio: number; // 0.0 .. 1.0 relative to POC
  isPOC: boolean;
}

export interface VPVRResult {
  buckets: VPVRBucket[];
  pocPrice: number;
  vahPrice: number;
  valPrice: number;
}

export function calcVolumeProfileVPVR(candles: Candle[], numRows = 24): VPVRResult | null {
  if (candles.length < 5) return null;
  let minP = Infinity;
  let maxP = -Infinity;
  for (const c of candles) {
    if (c.low < minP) minP = c.low;
    if (c.high > maxP) maxP = c.high;
  }
  if (maxP <= minP) return null;

  const step = (maxP - minP) / numRows;
  const buckets: VPVRBucket[] = Array.from({ length: numRows }, (_, idx) => ({
    priceLow: minP + idx * step,
    priceHigh: minP + (idx + 1) * step,
    priceMid: minP + (idx + 0.5) * step,
    bullVolume: 0,
    bearVolume: 0,
    totalVolume: 0,
    widthRatio: 0,
    isPOC: false,
  }));

  for (const c of candles) {
    const idx = Math.min(
      numRows - 1,
      Math.max(0, Math.floor((c.close - minP) / step))
    );
    const isBull = c.close >= c.open;
    if (isBull) buckets[idx].bullVolume += c.volume;
    else buckets[idx].bearVolume += c.volume;
    buckets[idx].totalVolume += c.volume;
  }

  let maxVol = 0;
  let pocIdx = 0;
  for (let i = 0; i < numRows; i++) {
    if (buckets[i].totalVolume > maxVol) {
      maxVol = buckets[i].totalVolume;
      pocIdx = i;
    }
  }

  for (let i = 0; i < numRows; i++) {
    buckets[i].widthRatio = maxVol > 0 ? buckets[i].totalVolume / maxVol : 0;
    buckets[i].isPOC = i === pocIdx;
  }

  // 70% Value Area calculation (VAH, VAL)
  let totalVol = 0;
  for (const b of buckets) totalVol += b.totalVolume;
  const targetAreaVol = totalVol * 0.70;

  let currentAreaVol = buckets[pocIdx].totalVolume;
  let upperIdx = pocIdx;
  let lowerIdx = pocIdx;

  while (currentAreaVol < targetAreaVol && (upperIdx < numRows - 1 || lowerIdx > 0)) {
    const nextUpperVol = upperIdx < numRows - 1 ? buckets[upperIdx + 1].totalVolume : -1;
    const nextLowerVol = lowerIdx > 0 ? buckets[lowerIdx - 1].totalVolume : -1;

    if (nextUpperVol >= nextLowerVol && nextUpperVol >= 0) {
      upperIdx++;
      currentAreaVol += nextUpperVol;
    } else if (nextLowerVol >= 0) {
      lowerIdx--;
      currentAreaVol += nextLowerVol;
    } else if (upperIdx < numRows - 1) {
      upperIdx++;
      currentAreaVol += buckets[upperIdx].totalVolume;
    } else {
      break;
    }
  }

  const pocPrice = buckets[pocIdx].priceMid;
  const vahPrice = buckets[upperIdx].priceHigh;
  const valPrice = buckets[lowerIdx].priceLow;

  return { buckets, pocPrice, vahPrice, valPrice };
}

/**
 * Technical Analysis Gauge Summary
 */
export interface TechnicalGaugeSummary {
  overallLabel: 'GÜÇLÜ AL' | 'AL' | 'NÖTR' | 'SAT' | 'GÜÇLÜ SAT';
  needleAngleDeg: number; // -75 (Strong Sell) .. 0 (Neutral) .. +75 (Strong Buy)
  buyCount: number;
  neutralCount: number;
  sellCount: number;
  rsi14: number;
  macdHist: number;
  ema20: number;
  ema50: number;
  sma200: number;
}

export function calcTechnicalGaugeSummary(candles: Candle[]): TechnicalGaugeSummary {
  if (candles.length < 15) {
    return {
      overallLabel: 'NÖTR',
      needleAngleDeg: 0,
      buyCount: 4,
      neutralCount: 4,
      sellCount: 4,
      rsi14: 50,
      macdHist: 0,
      ema20: 0,
      ema50: 0,
      sma200: 0,
    };
  }

  const closes = candles.map((c) => c.close);
  const last = closes[closes.length - 1];
  const ema9 = calcEMA(closes, 9)[closes.length - 1];
  const ema20 = calcEMA(closes, 20)[closes.length - 1];
  const ema50 = calcEMA(closes, 50)[closes.length - 1];
  const sma100 = calcSMA(closes, Math.min(100, closes.length))[closes.length - 1];
  const sma200 = calcSMA(closes, Math.min(200, closes.length))[closes.length - 1];
  const rsi14 = calcRSI(closes, 14)[closes.length - 1] || 50;
  const macd = calcMACD(closes, 12, 26, 9);
  const macdHist = macd.histLine[closes.length - 1] || 0;
  const st = calcSuperTrend(candles, 3, 10);
  const stBull = st.direction[closes.length - 1] === -1;

  let buyCount = 0;
  let sellCount = 0;
  let neutralCount = 2;

  const checkMA = (maVal: number) => {
    if (Number.isNaN(maVal)) {
      neutralCount++;
    } else if (last > maVal) {
      buyCount++;
    } else {
      sellCount++;
    }
  };

  checkMA(ema9);
  checkMA(ema20);
  checkMA(ema50);
  checkMA(sma100);
  checkMA(sma200);

  if (stBull) buyCount += 2;
  else sellCount += 2;

  if (macdHist > 0) buyCount += 2;
  else sellCount += 2;

  if (rsi14 < 32) buyCount += 2;
  else if (rsi14 > 70) sellCount += 2;
  else if (rsi14 >= 52) buyCount += 1;
  else sellCount += 1;

  const total = Math.max(1, buyCount + sellCount + neutralCount);
  const netRatio = (buyCount - sellCount) / total; // -1 .. +1
  const needleAngleDeg = Math.max(-75, Math.min(75, netRatio * 95));

  let overallLabel: TechnicalGaugeSummary['overallLabel'] = 'NÖTR';
  if (netRatio >= 0.42) overallLabel = 'GÜÇLÜ AL';
  else if (netRatio >= 0.14) overallLabel = 'AL';
  else if (netRatio <= -0.42) overallLabel = 'GÜÇLÜ SAT';
  else if (netRatio <= -0.14) overallLabel = 'SAT';

  return {
    overallLabel,
    needleAngleDeg,
    buyCount,
    neutralCount,
    sellCount,
    rsi14,
    macdHist,
    ema20,
    ema50,
    sma200,
  };
}

/**
 * Rolling Highest & Lowest (ta.highest, ta.lowest)
 */
export function calcHighest(src: number[], length: number): number[] {
  const n = src.length;
  const out = new Array<number>(n).fill(NaN);
  for (let i = 0; i < n; i++) {
    const start = Math.max(0, i - length + 1);
    let maxVal = -Infinity;
    for (let j = start; j <= i; j++) {
      if (!Number.isNaN(src[j]) && src[j] > maxVal) maxVal = src[j];
    }
    if (maxVal > -Infinity) out[i] = maxVal;
  }
  return out;
}

export function calcLowest(src: number[], length: number): number[] {
  const n = src.length;
  const out = new Array<number>(n).fill(NaN);
  for (let i = 0; i < n; i++) {
    const start = Math.max(0, i - length + 1);
    let minVal = Infinity;
    for (let j = start; j <= i; j++) {
      if (!Number.isNaN(src[j]) && src[j] < minVal) minVal = src[j];
    }
    if (minVal < Infinity) out[i] = minVal;
  }
  return out;
}

/**
 * Crossover & Crossunder (ta.crossover, ta.crossunder) -> boolean series (1 or 0)
 */
export function calcCrossover(a: number[], b: number[]): number[] {
  const n = Math.min(a.length, b.length);
  const out = new Array<number>(n).fill(0);
  for (let i = 1; i < n; i++) {
    if (a[i - 1] <= b[i - 1] && a[i] > b[i]) {
      out[i] = 1;
    }
  }
  return out;
}

export function calcCrossunder(a: number[], b: number[]): number[] {
  const n = Math.min(a.length, b.length);
  const out = new Array<number>(n).fill(0);
  for (let i = 1; i < n; i++) {
    if (a[i - 1] >= b[i - 1] && a[i] < b[i]) {
      out[i] = 1;
    }
  }
  return out;
}

/**
 * Converts standard OHLC candles to Heikin-Ashi candles
 */
export function toHeikinAshi(candles: Candle[]): Candle[] {
  const out: Candle[] = [];
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const haClose = (c.open + c.high + c.low + c.close) / 4;
    const haOpen =
      i === 0 ? (c.open + c.close) / 2 : (out[i - 1].open + out[i - 1].close) / 2;
    const haHigh = Math.max(c.high, haOpen, haClose);
    const haLow = Math.min(c.low, haOpen, haClose);
    out.push({
      time: c.time,
      open: Number(haOpen.toFixed(4)),
      high: Number(haHigh.toFixed(4)),
      low: Number(haLow.toFixed(4)),
      close: Number(haClose.toFixed(4)),
      volume: c.volume,
    });
  }
  return out;
}

/**
 * Lightweight Charts Data Point with clean number guarantees
 */
export interface CleanSeriesPoint {
  time: number;
  value: number;
  color?: string;
}

/**
 * Strips out NaN, null, undefined, and non-finite values so Lightweight Charts does not crash or hide lines.
 */
export function cleanLineData(
  times: number[],
  values: (number | null | undefined)[]
): CleanSeriesPoint[] {
  const n = Math.min(times.length, values.length);
  const out: CleanSeriesPoint[] = [];
  for (let i = 0; i < n; i++) {
    const v = values[i];
    const t = times[i];
    if (
      typeof v === 'number' &&
      !Number.isNaN(v) &&
      Number.isFinite(v) &&
      typeof t === 'number' &&
      !Number.isNaN(t)
    ) {
      out.push({ time: t, value: v });
    }
  }
  return out;
}

/**
 * Strips out NaN/invalid values for histogram series, applying an optional color callback.
 */
export function cleanHistogramData(
  times: number[],
  values: (number | null | undefined)[],
  colorFn?: (val: number, i: number) => string
): CleanSeriesPoint[] {
  const n = Math.min(times.length, values.length);
  const out: CleanSeriesPoint[] = [];
  for (let i = 0; i < n; i++) {
    const v = values[i];
    const t = times[i];
    if (
      typeof v === 'number' &&
      !Number.isNaN(v) &&
      Number.isFinite(v) &&
      typeof t === 'number' &&
      !Number.isNaN(t)
    ) {
      const pt: CleanSeriesPoint = { time: t, value: v };
      if (colorFn) {
        pt.color = colorFn(v, i);
      }
      out.push(pt);
    }
  }
  return out;
}

/**
 * Validates candle series, discarding invalid bars and repairing minor inconsistencies.
 */
export function sanitizeCandles(candles: Candle[]): Candle[] {
  const out: Candle[] = [];
  for (const c of candles) {
    if (!c || Number.isNaN(c.time) || c.time <= 0) continue;
    if (
      Number.isNaN(c.open) ||
      Number.isNaN(c.high) ||
      Number.isNaN(c.low) ||
      Number.isNaN(c.close)
    ) {
      continue;
    }
    const open = c.open > 0 ? c.open : 1;
    const close = c.close > 0 ? c.close : open;
    const high = Math.max(c.high, c.low, open, close);
    const low = Math.min(c.high, c.low, open, close);
    const volume = Number.isNaN(c.volume) || c.volume < 0 ? 0 : c.volume;

    out.push({
      time: c.time,
      open,
      high,
      low,
      close,
      volume,
    });
  }
  return out.sort((a, b) => a.time - b.time);
}

/**
 * Efficient single-bar recalculations for real-time WebSocket updates
 */
export function calcLatestSMA(candles: Candle[], length: number): number {
  const n = candles.length;
  if (n < length || length <= 0) return NaN;
  let sum = 0;
  for (let i = n - length; i < n; i++) {
    sum += candles[i].close;
  }
  return sum / length;
}

export function calcLatestEMA(prevEMA: number, currentClose: number, length: number): number {
  if (Number.isNaN(prevEMA)) return currentClose;
  const alpha = 2 / (length + 1);
  return alpha * currentClose + (1 - alpha) * prevEMA;
}

export function calcLatestRMA(prevRMA: number, currentVal: number, length: number): number {
  if (Number.isNaN(prevRMA)) return currentVal;
  const alpha = 1 / length;
  return alpha * currentVal + (1 - alpha) * prevRMA;
}

export function calcLatestBollinger(
  candles: Candle[],
  length = 20,
  mult = 2.0
): { middle: number; upper: number; lower: number } {
  const n = candles.length;
  if (n < length) {
    return { middle: NaN, upper: NaN, lower: NaN };
  }
  const mid = calcLatestSMA(candles, length);
  let sqSum = 0;
  for (let i = n - length; i < n; i++) {
    const diff = candles[i].close - mid;
    sqSum += diff * diff;
  }
  const stdev = Math.sqrt(sqSum / length);
  return {
    middle: mid,
    upper: mid + mult * stdev,
    lower: mid - mult * stdev,
  };
}

export function calcLatestRSI(candles: Candle[], length = 14): number {
  const n = candles.length;
  if (n <= length) return NaN;
  const closes = candles.map((c) => c.close);
  const rsiSeries = calcRSI(closes, length);
  return rsiSeries[n - 1];
}

export function calcLatestMACD(
  candles: Candle[],
  fastLen = 12,
  slowLen = 26,
  sigLen = 9
): { macdLine: number; signalLine: number; histLine: number } {
  const n = candles.length;
  if (n < slowLen) {
    return { macdLine: NaN, signalLine: NaN, histLine: NaN };
  }
  const closes = candles.map((c) => c.close);
  const res = calcMACD(closes, fastLen, slowLen, sigLen);
  return {
    macdLine: res.macdLine[n - 1],
    signalLine: res.signalLine[n - 1],
    histLine: res.histLine[n - 1],
  };
}

export function calcLatestSuperTrend(
  candles: Candle[],
  factor = 3.0,
  atrPeriod = 10
): { supertrend: number; direction: number } {
  const n = candles.length;
  if (n < atrPeriod) {
    return { supertrend: NaN, direction: 1 };
  }
  const res = calcSuperTrend(candles, factor, atrPeriod);
  return {
    supertrend: res.supertrend[n - 1],
    direction: res.direction[n - 1],
  };
}

export function calcLatestVWAP(candles: Candle[]): number {
  const n = candles.length;
  if (n === 0) return NaN;
  const vwapSeries = calcVWAP(candles);
  return vwapSeries[n - 1];
}

export function calcLatestStochastic(
  candles: Candle[],
  kPeriod = 14,
  kSma = 3,
  dSma = 3
): { k: number; d: number } {
  const n = candles.length;
  if (n < kPeriod) {
    return { k: NaN, d: NaN };
  }
  const res = calcStochastic(candles, kPeriod, kSma, dSma);
  return {
    k: res.k[n - 1],
    d: res.d[n - 1],
  };
}

export function calcLatestATR(candles: Candle[], length = 14): number {
  const n = candles.length;
  if (n < 2) return NaN;
  const atrSeries = calcATR(candles, length);
  return atrSeries[n - 1];
}

/**
 * Donchian Channels (20)
 */
export function calcDonchianChannels(
  candles: Candle[],
  length = 20
): { upper: number[]; middle: number[]; lower: number[] } {
  const n = candles.length;
  const upper = new Array<number>(n);
  const lower = new Array<number>(n);
  const middle = new Array<number>(n);

  for (let i = 0; i < n; i++) {
    if (i < length - 1) {
      upper[i] = NaN;
      lower[i] = NaN;
      middle[i] = NaN;
      continue;
    }
    let hi = -Infinity;
    let lo = Infinity;
    for (let j = i - length + 1; j <= i; j++) {
      if (candles[j].high > hi) hi = candles[j].high;
      if (candles[j].low < lo) lo = candles[j].low;
    }
    upper[i] = hi;
    lower[i] = lo;
    middle[i] = (hi + lo) / 2;
  }
  return { upper, middle, lower };
}

/**
 * Keltner Channels (20, mult=1.5)
 */
export function calcKeltnerChannels(
  candles: Candle[],
  length = 20,
  mult = 1.5
): { upper: number[]; middle: number[]; lower: number[] } {
  const n = candles.length;
  const closes = candles.map((c) => c.close);
  const middle = calcEMA(closes, length);
  const atr = calcATR(candles, length);

  const upper = new Array<number>(n);
  const lower = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    if (Number.isNaN(middle[i]) || Number.isNaN(atr[i])) {
      upper[i] = NaN;
      lower[i] = NaN;
    } else {
      upper[i] = middle[i] + mult * atr[i];
      lower[i] = middle[i] - mult * atr[i];
    }
  }
  return { upper, middle, lower };
}

/**
 * Automatic Pivot Points (Classic P, R1, R2, S1, S2)
 */
export function calcPivotPoints(
  candles: Candle[]
): { p: number[]; r1: number[]; s1: number[]; r2: number[]; s2: number[] } {
  const n = candles.length;
  const p = new Array<number>(n);
  const r1 = new Array<number>(n);
  const s1 = new Array<number>(n);
  const r2 = new Array<number>(n);
  const s2 = new Array<number>(n);

  for (let i = 0; i < n; i++) {
    const prev = i > 0 ? candles[i - 1] : candles[0];
    const pivot = (prev.high + prev.low + prev.close) / 3;
    const diff = prev.high - prev.low;
    p[i] = pivot;
    r1[i] = 2 * pivot - prev.low;
    s1[i] = 2 * pivot - prev.high;
    r2[i] = pivot + diff;
    s2[i] = pivot - diff;
  }
  return { p, r1, s1, r2, s2 };
}

/**
 * Commodity Channel Index (CCI 20)
 */
export function calcCCI(candles: Candle[], length = 20): number[] {
  const n = candles.length;
  const tp = candles.map((c) => (c.high + c.low + c.close) / 3);
  const smaTP = calcSMA(tp, length);
  const cci = new Array<number>(n);

  for (let i = 0; i < n; i++) {
    if (i < length - 1 || Number.isNaN(smaTP[i])) {
      cci[i] = NaN;
      continue;
    }
    let meanDev = 0;
    for (let j = i - length + 1; j <= i; j++) {
      meanDev += Math.abs(tp[j] - smaTP[i]);
    }
    meanDev /= length;
    cci[i] = meanDev === 0 ? 0 : (tp[i] - smaTP[i]) / (0.015 * meanDev);
  }
  return cci;
}

/**
 * Momentum Oscillator (10)
 */
export function calcMomentum(src: number[], length = 10): number[] {
  const n = src.length;
  const mom = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    mom[i] = i >= length ? src[i] - src[i - length] : NaN;
  }
  return mom;
}

/**
 * Williams %R (14)
 */
export function calcWilliamsR(candles: Candle[], length = 14): number[] {
  const n = candles.length;
  const wr = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    if (i < length - 1) {
      wr[i] = NaN;
      continue;
    }
    let hh = -Infinity;
    let ll = Infinity;
    for (let j = i - length + 1; j <= i; j++) {
      if (candles[j].high > hh) hh = candles[j].high;
      if (candles[j].low < ll) ll = candles[j].low;
    }
    const range = hh - ll;
    wr[i] = range === 0 ? -50 : ((hh - candles[i].close) / range) * -100;
  }
  return wr;
}

/**
 * On-Balance Volume (OBV)
 */
export function calcOBV(candles: Candle[]): number[] {
  const n = candles.length;
  const obv = new Array<number>(n);
  if (n === 0) return obv;

  obv[0] = candles[0].volume;
  for (let i = 1; i < n; i++) {
    if (candles[i].close > candles[i - 1].close) {
      obv[i] = obv[i - 1] + candles[i].volume;
    } else if (candles[i].close < candles[i - 1].close) {
      obv[i] = obv[i - 1] - candles[i].volume;
    } else {
      obv[i] = obv[i - 1];
    }
  }
  return obv;
}
