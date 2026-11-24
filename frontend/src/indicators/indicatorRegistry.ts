import type { Candle } from '../types/market';
import {
  calcATR,
  calcBollingerBands,
  calcCCI,
  calcDonchianChannels,
  calcEMA,
  calcIchimoku,
  calcKeltnerChannels,
  calcLatestATR,
  calcLatestBollinger,
  calcLatestEMA,
  calcLatestMACD,
  calcLatestRMA,
  calcLatestRSI,
  calcLatestSMA,
  calcLatestStochastic,
  calcLatestSuperTrend,
  calcLatestVWAP,
  calcMACD,
  calcMomentum,
  calcOBV,
  calcParabolicSAR,
  calcPivotPoints,
  calcRMA,
  calcRSI,
  calcSMA,
  calcStochastic,
  calcSuperTrend,
  calcVWAP,
  calcWilliamsR,
  calcWMA,
  cleanHistogramData,
  cleanLineData,
  type CleanSeriesPoint,
} from './taEngine';

export type IndicatorType = 'overlay' | 'oscillator';
export type IndicatorCategory = 'trend' | 'oscillator' | 'volatility' | 'volume';

export interface IndicatorParamSchema {
  id: string;
  name: string;
  type: 'number' | 'boolean' | 'string';
  default: any;
  min?: number;
  max?: number;
  step?: number;
}

export interface IndicatorPlotDef {
  id: string;
  name: string;
  type: 'line' | 'histogram';
  color: string;
  lineWidth?: 1 | 2 | 3 | 4;
}

export interface IndicatorHLineDef {
  price: number;
  color: string;
  title?: string;
  lineStyle?: number;
}

export interface IndicatorMarker {
  time: number;
  position: 'aboveBar' | 'belowBar' | 'inBar';
  color: string;
  shape: 'circle' | 'square' | 'arrowUp' | 'arrowDown';
  text: string;
}

export interface IndicatorOutput {
  lines: Array<{
    id: string;
    name: string;
    color: string;
    lineWidth: 1 | 2 | 3 | 4;
    data: CleanSeriesPoint[];
  }>;
  histograms?: Array<{
    id: string;
    name: string;
    data: CleanSeriesPoint[];
  }>;
  hlines?: IndicatorHLineDef[];
  markers?: IndicatorMarker[];
}

export interface LatestIndicatorPoint {
  id: string;
  type: 'line' | 'histogram';
  point: CleanSeriesPoint;
}

export interface IndicatorDefinition {
  id: string;
  name: string;
  shortName: string;
  category: IndicatorCategory;
  type: IndicatorType;
  description: string;
  params: IndicatorParamSchema[];
  defaultInputs: Record<string, any>;
  plots: IndicatorPlotDef[];
  hlines?: IndicatorHLineDef[];
  calculate: (candles: Candle[], inputs?: Record<string, any>) => IndicatorOutput;
  calculateLatest?: (candles: Candle[], inputs?: Record<string, any>) => LatestIndicatorPoint[];
}

export const BUILTIN_INDICATORS: IndicatorDefinition[] = [
  // 1. SMA (Simple Moving Average)
  {
    id: 'sma',
    name: 'Basit Hareketli Ortalama (SMA)',
    shortName: 'SMA',
    category: 'trend',
    type: 'overlay',
    description: 'Fiyatların belirli bir periyottaki aritmetik ortalaması',
    params: [
      { id: 'length', name: 'Uzunluk', type: 'number', default: 20, min: 1, max: 500, step: 1 },
    ],
    defaultInputs: { length: 20 },
    plots: [{ id: 'sma', name: 'SMA', type: 'line', color: '#0284C7', lineWidth: 1 }],
    calculate: (candles, inputs) => {
      const len = inputs?.length ?? 20;
      const times = candles.map((c) => c.time);
      const closes = candles.map((c) => c.close);
      const values = calcSMA(closes, len);
      return {
        lines: [
          {
            id: 'sma',
            name: `SMA ${len}`,
            color: '#0284C7',
            lineWidth: 1,
            data: cleanLineData(times, values),
          },
        ],
      };
    },
    calculateLatest: (candles, inputs) => {
      const len = inputs?.length ?? 20;
      const lastCandle = candles[candles.length - 1];
      const val = calcLatestSMA(candles, len);
      if (Number.isNaN(val) || !lastCandle) return [];
      return [{ id: 'sma', type: 'line', point: { time: lastCandle.time, value: val } }];
    },
  },

  // 2. EMA (Exponential Moving Average)
  {
    id: 'ema',
    name: 'Üstel Hareketli Ortalama (EMA)',
    shortName: 'EMA',
    category: 'trend',
    type: 'overlay',
    description: 'En son fiyatlara daha yüksek ağırlık veren üstel hareketli ortalama',
    params: [
      { id: 'length', name: 'Uzunluk', type: 'number', default: 20, min: 1, max: 500, step: 1 },
    ],
    defaultInputs: { length: 20 },
    plots: [{ id: 'ema', name: 'EMA', type: 'line', color: '#FF9800', lineWidth: 1 }],
    calculate: (candles, inputs) => {
      const len = inputs?.length ?? 20;
      const times = candles.map((c) => c.time);
      const closes = candles.map((c) => c.close);
      const values = calcEMA(closes, len);
      return {
        lines: [
          {
            id: 'ema',
            name: `EMA ${len}`,
            color: '#FF9800',
            lineWidth: 1,
            data: cleanLineData(times, values),
          },
        ],
      };
    },
    calculateLatest: (candles, inputs) => {
      const len = inputs?.length ?? 20;
      const n = candles.length;
      if (n === 0) return [];
      const closes = candles.map((c) => c.close);
      const full = calcEMA(closes, len);
      const lastVal = full[n - 1];
      if (Number.isNaN(lastVal)) return [];
      return [
        { id: 'ema', type: 'line', point: { time: candles[n - 1].time, value: lastVal } },
      ];
    },
  },

  // 3. WMA (Weighted Moving Average)
  {
    id: 'wma',
    name: 'Ağırlıklı Hareketli Ortalama (WMA)',
    shortName: 'WMA',
    category: 'trend',
    type: 'overlay',
    description: 'Son fiyatlara doğrusal olarak artan ağırlık veren hareketli ortalama',
    params: [
      { id: 'length', name: 'Uzunluk', type: 'number', default: 20, min: 1, max: 500, step: 1 },
    ],
    defaultInputs: { length: 20 },
    plots: [{ id: 'wma', name: 'WMA', type: 'line', color: '#AB47BC', lineWidth: 1 }],
    calculate: (candles, inputs) => {
      const len = inputs?.length ?? 20;
      const times = candles.map((c) => c.time);
      const closes = candles.map((c) => c.close);
      const values = calcWMA(closes, len);
      return {
        lines: [
          {
            id: 'wma',
            name: `WMA ${len}`,
            color: '#AB47BC',
            lineWidth: 1,
            data: cleanLineData(times, values),
          },
        ],
      };
    },
  },

  // 4. RMA (Wilder's Moving Average)
  {
    id: 'rma',
    name: "Wilder's Smoothing (RMA)",
    shortName: 'RMA',
    category: 'trend',
    type: 'overlay',
    description: "J. Welles Wilder'ın RSI ve ATR hesaplamalarında kullandığı yumuşatma",
    params: [
      { id: 'length', name: 'Uzunluk', type: 'number', default: 14, min: 1, max: 500, step: 1 },
    ],
    defaultInputs: { length: 14 },
    plots: [{ id: 'rma', name: 'RMA', type: 'line', color: '#00BCD4', lineWidth: 1 }],
    calculate: (candles, inputs) => {
      const len = inputs?.length ?? 14;
      const times = candles.map((c) => c.time);
      const closes = candles.map((c) => c.close);
      const values = calcRMA(closes, len);
      return {
        lines: [
          {
            id: 'rma',
            name: `RMA ${len}`,
            color: '#00BCD4',
            lineWidth: 1,
            data: cleanLineData(times, values),
          },
        ],
      };
    },
  },

  // 5. Bollinger Bands (BB 20, 2)
  {
    id: 'bb',
    name: 'Bollinger Bantları (Bollinger Bands)',
    shortName: 'BB',
    category: 'volatility',
    type: 'overlay',
    description: '20 periyotluk SMA ve ±2 standart sapma kanalları',
    params: [
      { id: 'length', name: 'Uzunluk', type: 'number', default: 20, min: 1, max: 200, step: 1 },
      { id: 'mult', name: 'Çarpan', type: 'number', default: 2.0, min: 0.1, max: 10, step: 0.1 },
    ],
    defaultInputs: { length: 20, mult: 2.0 },
    plots: [
      { id: 'bb_upper', name: 'BB Üst', type: 'line', color: 'rgba(2, 132, 199, 0.75)', lineWidth: 1 },
      { id: 'bb_mid', name: 'BB Orta (Baz)', type: 'line', color: 'rgba(255, 213, 79, 0.75)', lineWidth: 1 },
      { id: 'bb_lower', name: 'BB Alt', type: 'line', color: 'rgba(2, 132, 199, 0.75)', lineWidth: 1 },
    ],
    calculate: (candles, inputs) => {
      const len = inputs?.length ?? 20;
      const mult = inputs?.mult ?? 2.0;
      const times = candles.map((c) => c.time);
      const closes = candles.map((c) => c.close);
      const bb = calcBollingerBands(closes, len, mult);
      return {
        lines: [
          {
            id: 'bb_upper',
            name: `BB Üst (${len}, ${mult})`,
            color: 'rgba(2, 132, 199, 0.75)',
            lineWidth: 1,
            data: cleanLineData(times, bb.upper),
          },
          {
            id: 'bb_mid',
            name: `BB Orta (${len})`,
            color: 'rgba(255, 213, 79, 0.75)',
            lineWidth: 1,
            data: cleanLineData(times, bb.middle),
          },
          {
            id: 'bb_lower',
            name: `BB Alt (${len}, ${mult})`,
            color: 'rgba(2, 132, 199, 0.75)',
            lineWidth: 1,
            data: cleanLineData(times, bb.lower),
          },
        ],
      };
    },
    calculateLatest: (candles, inputs) => {
      const len = inputs?.length ?? 20;
      const mult = inputs?.mult ?? 2.0;
      const n = candles.length;
      if (n === 0) return [];
      const t = candles[n - 1].time;
      const res = calcLatestBollinger(candles, len, mult);
      if (Number.isNaN(res.middle)) return [];
      return [
        { id: 'bb_upper', type: 'line', point: { time: t, value: res.upper } },
        { id: 'bb_mid', type: 'line', point: { time: t, value: res.middle } },
        { id: 'bb_lower', type: 'line', point: { time: t, value: res.lower } },
      ];
    },
  },

  // 6. SuperTrend (10, 3.0)
  {
    id: 'supertrend',
    name: 'SuperTrend',
    shortName: 'SuperTrend',
    category: 'trend',
    type: 'overlay',
    description: 'ATR tabanlı dinamik iz süren stop ve trend dönüş sinyalleri',
    params: [
      { id: 'factor', name: 'Çarpan', type: 'number', default: 3.0, min: 0.5, max: 10, step: 0.1 },
      { id: 'atrPeriod', name: 'ATR Periyodu', type: 'number', default: 10, min: 1, max: 100, step: 1 },
    ],
    defaultInputs: { factor: 3.0, atrPeriod: 10 },
    plots: [
      { id: 'supertrend', name: 'SuperTrend', type: 'line', color: '#00E676', lineWidth: 2 },
    ],
    calculate: (candles, inputs) => {
      const factor = inputs?.factor ?? 3.0;
      const atrPeriod = inputs?.atrPeriod ?? 10;
      const times = candles.map((c) => c.time);
      const st = calcSuperTrend(candles, factor, atrPeriod);

      const markers: IndicatorMarker[] = [];
      for (let i = 1; i < candles.length; i++) {
        if (st.direction[i - 1] === 1 && st.direction[i] === -1) {
          // Bullish flip (BUY)
          markers.push({
            time: candles[i].time,
            position: 'belowBar',
            color: '#089981',
            shape: 'arrowUp',
            text: 'AL (BUY)',
          });
        } else if (st.direction[i - 1] === -1 && st.direction[i] === 1) {
          // Bearish flip (SELL)
          markers.push({
            time: candles[i].time,
            position: 'aboveBar',
            color: '#F23645',
            shape: 'arrowDown',
            text: 'SAT (SELL)',
          });
        }
      }

      return {
        lines: [
          {
            id: 'supertrend',
            name: `SuperTrend (${atrPeriod}, ${factor})`,
            color: st.direction[st.direction.length - 1] === -1 ? '#00E676' : '#FF5252',
            lineWidth: 2,
            data: cleanLineData(times, st.supertrend),
          },
        ],
        markers,
      };
    },
    calculateLatest: (candles, inputs) => {
      const factor = inputs?.factor ?? 3.0;
      const atrPeriod = inputs?.atrPeriod ?? 10;
      const n = candles.length;
      if (n === 0) return [];
      const res = calcLatestSuperTrend(candles, factor, atrPeriod);
      if (Number.isNaN(res.supertrend)) return [];
      return [
        {
          id: 'supertrend',
          type: 'line',
          point: { time: candles[n - 1].time, value: res.supertrend },
        },
      ];
    },
  },

  // 7. VWAP (Volume Weighted Average Price)
  {
    id: 'vwap',
    name: 'Hacim Ağırlıklı Ortalama Fiyat (VWAP)',
    shortName: 'VWAP',
    category: 'volume',
    type: 'overlay',
    description: 'Gün içi kümülatif işlem hacmi ağırlıklı ortalama fiyat',
    params: [],
    defaultInputs: {},
    plots: [{ id: 'vwap', name: 'VWAP', type: 'line', color: '#E040FB', lineWidth: 1 }],
    calculate: (candles) => {
      const times = candles.map((c) => c.time);
      const values = calcVWAP(candles);
      return {
        lines: [
          {
            id: 'vwap',
            name: 'VWAP',
            color: '#E040FB',
            lineWidth: 1,
            data: cleanLineData(times, values),
          },
        ],
      };
    },
    calculateLatest: (candles) => {
      const n = candles.length;
      if (n === 0) return [];
      const val = calcLatestVWAP(candles);
      if (Number.isNaN(val)) return [];
      return [{ id: 'vwap', type: 'line', point: { time: candles[n - 1].time, value: val } }];
    },
  },

  // 8. RSI (Relative Strength Index)
  {
    id: 'rsi',
    name: 'Göreceli Güç Endeksi (RSI)',
    shortName: 'RSI',
    category: 'oscillator',
    type: 'oscillator',
    description: "J. Welles Wilder'ın momentum osilatörü (0-100 bandı, 70/30 seviyeleri)",
    params: [
      { id: 'length', name: 'Uzunluk', type: 'number', default: 14, min: 1, max: 100, step: 1 },
    ],
    defaultInputs: { length: 14 },
    plots: [{ id: 'rsi', name: 'RSI', type: 'line', color: '#7E57C2', lineWidth: 1 }],
    hlines: [
      { price: 70, color: '#F23645', title: 'Aşırı Alım (70)', lineStyle: 2 },
      { price: 50, color: '#505666', title: 'Orta (50)', lineStyle: 1 },
      { price: 30, color: '#089981', title: 'Aşırı Satım (30)', lineStyle: 2 },
    ],
    calculate: (candles, inputs) => {
      const len = inputs?.length ?? 14;
      const times = candles.map((c) => c.time);
      const closes = candles.map((c) => c.close);
      const values = calcRSI(closes, len);
      return {
        lines: [
          {
            id: 'rsi',
            name: `RSI ${len}`,
            color: '#7E57C2',
            lineWidth: 1,
            data: cleanLineData(times, values),
          },
        ],
        hlines: [
          { price: 70, color: '#F23645', title: '70', lineStyle: 2 },
          { price: 50, color: '#505666', title: '50', lineStyle: 1 },
          { price: 30, color: '#089981', title: '30', lineStyle: 2 },
        ],
      };
    },
    calculateLatest: (candles, inputs) => {
      const len = inputs?.length ?? 14;
      const n = candles.length;
      if (n === 0) return [];
      const val = calcLatestRSI(candles, len);
      if (Number.isNaN(val)) return [];
      return [{ id: 'rsi', type: 'line', point: { time: candles[n - 1].time, value: val } }];
    },
  },

  // 9. MACD (Moving Average Convergence Divergence)
  {
    id: 'macd',
    name: 'MACD (Hareketli Ortalama Yakınsama/Iraksama)',
    shortName: 'MACD',
    category: 'oscillator',
    type: 'oscillator',
    description: 'EMA(12)-EMA(26) MACD çizgisi, 9 periyotluk sinyal ve sıfır çizgisi histogramı',
    params: [
      { id: 'fast', name: 'Hızlı EMA', type: 'number', default: 12, min: 1, max: 100, step: 1 },
      { id: 'slow', name: 'Yavaş EMA', type: 'number', default: 26, min: 1, max: 200, step: 1 },
      { id: 'signal', name: 'Sinyal EMA', type: 'number', default: 9, min: 1, max: 50, step: 1 },
    ],
    defaultInputs: { fast: 12, slow: 26, signal: 9 },
    plots: [
      { id: 'macd_line', name: 'MACD', type: 'line', color: '#0284C7', lineWidth: 1 },
      { id: 'macd_signal', name: 'Sinyal', type: 'line', color: '#FF6D00', lineWidth: 1 },
      { id: 'macd_hist', name: 'Histogram', type: 'histogram', color: '#089981' },
    ],
    hlines: [{ price: 0, color: '#505666', title: '0', lineStyle: 1 }],
    calculate: (candles, inputs) => {
      const fast = inputs?.fast ?? 12;
      const slow = inputs?.slow ?? 26;
      const signal = inputs?.signal ?? 9;
      const times = candles.map((c) => c.time);
      const closes = candles.map((c) => c.close);
      const res = calcMACD(closes, fast, slow, signal);

      return {
        lines: [
          {
            id: 'macd_line',
            name: `MACD (${fast}, ${slow})`,
            color: '#0284C7',
            lineWidth: 1,
            data: cleanLineData(times, res.macdLine),
          },
          {
            id: 'macd_signal',
            name: `Sinyal (${signal})`,
            color: '#FF6D00',
            lineWidth: 1,
            data: cleanLineData(times, res.signalLine),
          },
        ],
        histograms: [
          {
            id: 'macd_hist',
            name: 'Histogram',
            data: cleanHistogramData(times, res.histLine, (v) =>
              v >= 0 ? 'rgba(8, 153, 129, 0.75)' : 'rgba(242, 54, 69, 0.75)'
            ),
          },
        ],
        hlines: [{ price: 0, color: '#505666', title: '0', lineStyle: 1 }],
      };
    },
    calculateLatest: (candles, inputs) => {
      const fast = inputs?.fast ?? 12;
      const slow = inputs?.slow ?? 26;
      const signal = inputs?.signal ?? 9;
      const n = candles.length;
      if (n === 0) return [];
      const t = candles[n - 1].time;
      const res = calcLatestMACD(candles, fast, slow, signal);
      if (Number.isNaN(res.macdLine)) return [];
      return [
        { id: 'macd_line', type: 'line', point: { time: t, value: res.macdLine } },
        { id: 'macd_signal', type: 'line', point: { time: t, value: res.signalLine } },
        {
          id: 'macd_hist',
          type: 'histogram',
          point: {
            time: t,
            value: res.histLine,
            color:
              res.histLine >= 0 ? 'rgba(8, 153, 129, 0.75)' : 'rgba(242, 54, 69, 0.75)',
          },
        },
      ];
    },
  },

  // 10. Stochastic Oscillator (14, 3, 3)
  {
    id: 'stoch',
    name: 'Stokastik Osilatör (Stochastic 14, 3, 3)',
    shortName: 'Stoch',
    category: 'oscillator',
    type: 'oscillator',
    description: 'En yüksek-en düşük fiyat aralığına göre momentum ölçen %K ve %D çizgileri',
    params: [
      { id: 'kPeriod', name: '%K Periyodu', type: 'number', default: 14, min: 1, max: 100, step: 1 },
      { id: 'kSma', name: '%K Düzeltme (SMA)', type: 'number', default: 3, min: 1, max: 50, step: 1 },
      { id: 'dSma', name: '%D Periyodu (SMA)', type: 'number', default: 3, min: 1, max: 50, step: 1 },
    ],
    defaultInputs: { kPeriod: 14, kSma: 3, dSma: 3 },
    plots: [
      { id: 'stoch_k', name: '%K', type: 'line', color: '#0284C7', lineWidth: 1 },
      { id: 'stoch_d', name: '%D', type: 'line', color: '#FF6D00', lineWidth: 1 },
    ],
    hlines: [
      { price: 80, color: '#F23645', title: '80', lineStyle: 2 },
      { price: 50, color: '#505666', title: '50', lineStyle: 1 },
      { price: 20, color: '#089981', title: '20', lineStyle: 2 },
    ],
    calculate: (candles, inputs) => {
      const kPeriod = inputs?.kPeriod ?? 14;
      const kSma = inputs?.kSma ?? 3;
      const dSma = inputs?.dSma ?? 3;
      const times = candles.map((c) => c.time);
      const res = calcStochastic(candles, kPeriod, kSma, dSma);

      return {
        lines: [
          {
            id: 'stoch_k',
            name: `%K (${kPeriod}, ${kSma})`,
            color: '#0284C7',
            lineWidth: 1,
            data: cleanLineData(times, res.k),
          },
          {
            id: 'stoch_d',
            name: `%D (${dSma})`,
            color: '#FF6D00',
            lineWidth: 1,
            data: cleanLineData(times, res.d),
          },
        ],
        hlines: [
          { price: 80, color: '#F23645', title: '80', lineStyle: 2 },
          { price: 50, color: '#505666', title: '50', lineStyle: 1 },
          { price: 20, color: '#089981', title: '20', lineStyle: 2 },
        ],
      };
    },
    calculateLatest: (candles, inputs) => {
      const kPeriod = inputs?.kPeriod ?? 14;
      const kSma = inputs?.kSma ?? 3;
      const dSma = inputs?.dSma ?? 3;
      const n = candles.length;
      if (n === 0) return [];
      const t = candles[n - 1].time;
      const res = calcLatestStochastic(candles, kPeriod, kSma, dSma);
      if (Number.isNaN(res.k)) return [];
      return [
        { id: 'stoch_k', type: 'line', point: { time: t, value: res.k } },
        { id: 'stoch_d', type: 'line', point: { time: t, value: res.d } },
      ];
    },
  },

  // 11. ATR (Average True Range)
  {
    id: 'atr',
    name: 'Ortalama Gerçek Aralık (ATR)',
    shortName: 'ATR',
    category: 'volatility',
    type: 'oscillator',
    description: "J. Welles Wilder'ın piyasa oynaklığı (volatilite) ölçer indikatörü",
    params: [
      { id: 'length', name: 'Uzunluk', type: 'number', default: 14, min: 1, max: 100, step: 1 },
    ],
    defaultInputs: { length: 14 },
    plots: [{ id: 'atr', name: 'ATR', type: 'line', color: '#FF7043', lineWidth: 1 }],
    calculate: (candles, inputs) => {
      const len = inputs?.length ?? 14;
      const times = candles.map((c) => c.time);
      const values = calcATR(candles, len);
      return {
        lines: [
          {
            id: 'atr',
            name: `ATR ${len}`,
            color: '#FF7043',
            lineWidth: 1,
            data: cleanLineData(times, values),
          },
        ],
      };
    },
    calculateLatest: (candles, inputs) => {
      const len = inputs?.length ?? 14;
      const n = candles.length;
      if (n === 0) return [];
      const val = calcLatestATR(candles, len);
      if (Number.isNaN(val)) return [];
      return [{ id: 'atr', type: 'line', point: { time: candles[n - 1].time, value: val } }];
    },
  },

  // 12. Ichimoku Cloud (9, 26, 52)
  {
    id: 'ichimoku',
    name: 'Ichimoku Bulutu (Ichimoku Kinko Hyo)',
    shortName: 'Ichimoku',
    category: 'trend',
    type: 'overlay',
    description: 'Tenkan-sen (9), Kijun-sen (26), Senkou Span A ve Senkou Span B (52)',
    params: [],
    defaultInputs: {},
    plots: [
      { id: 'ichi_tenkan', name: 'Tenkan-sen (9)', type: 'line', color: '#0284C7', lineWidth: 1 },
      { id: 'ichi_kijun', name: 'Kijun-sen (26)', type: 'line', color: '#F23645', lineWidth: 1 },
      { id: 'ichi_spanA', name: 'Senkou Span A', type: 'line', color: 'rgba(8, 153, 129, 0.8)', lineWidth: 1 },
      { id: 'ichi_spanB', name: 'Senkou Span B', type: 'line', color: 'rgba(242, 54, 69, 0.8)', lineWidth: 1 },
    ],
    calculate: (candles) => {
      const times = candles.map((c) => c.time);
      const res = calcIchimoku(candles);
      return {
        lines: [
          {
            id: 'ichi_tenkan',
            name: 'Tenkan 9',
            color: '#0284C7',
            lineWidth: 1,
            data: cleanLineData(times, res.tenkan),
          },
          {
            id: 'ichi_kijun',
            name: 'Kijun 26',
            color: '#F23645',
            lineWidth: 1,
            data: cleanLineData(times, res.kijun),
          },
          {
            id: 'ichi_spanA',
            name: 'Span A',
            color: 'rgba(8, 153, 129, 0.8)',
            lineWidth: 1,
            data: cleanLineData(times, res.spanA),
          },
          {
            id: 'ichi_spanB',
            name: 'Span B',
            color: 'rgba(242, 54, 69, 0.8)',
            lineWidth: 1,
            data: cleanLineData(times, res.spanB),
          },
        ],
      };
    },
  },

  // 13. Parabolic SAR (0.02, 0.20)
  {
    id: 'psar',
    name: 'Parabolik SAR (Stop and Reverse)',
    shortName: 'SAR',
    category: 'trend',
    type: 'overlay',
    description: 'Trend yönü ve potansiyel dönüş noktalarını belirleyen parabolik noktalar',
    params: [
      { id: 'step', name: 'Adım (Step)', type: 'number', default: 0.02, min: 0.005, max: 0.1, step: 0.005 },
      { id: 'maxAf', name: 'Maks Hızlanma', type: 'number', default: 0.2, min: 0.05, max: 0.5, step: 0.05 },
    ],
    defaultInputs: { step: 0.02, maxAf: 0.2 },
    plots: [{ id: 'psar', name: 'Parabolic SAR', type: 'line', color: '#00E5FF', lineWidth: 1 }],
    calculate: (candles, inputs) => {
      const step = inputs?.step ?? 0.02;
      const maxAf = inputs?.maxAf ?? 0.2;
      const times = candles.map((c) => c.time);
      const values = calcParabolicSAR(candles, step, maxAf);
      return {
        lines: [
          {
            id: 'psar',
            name: `SAR (${step}, ${maxAf})`,
            color: '#00E5FF',
            lineWidth: 1,
            data: cleanLineData(times, values),
          },
        ],
      };
    },
  },

  // 14. Donchian Channels (20)
  {
    id: 'donchian',
    name: 'Donchian Kanalları (20)',
    shortName: 'Donchian',
    category: 'volatility',
    type: 'overlay',
    description: 'Son N periyottaki en yüksek ve en düşük fiyat kanalı',
    params: [
      { id: 'length', name: 'Uzunluk', type: 'number', default: 20, min: 2, max: 200, step: 1 },
    ],
    defaultInputs: { length: 20 },
    plots: [
      { id: 'dc_upper', name: 'Üst Kanal', type: 'line', color: '#00E5FF', lineWidth: 1 },
      { id: 'dc_mid', name: 'Orta Kanal', type: 'line', color: '#B0BEC5', lineWidth: 1 },
      { id: 'dc_lower', name: 'Alt Kanal', type: 'line', color: '#00E5FF', lineWidth: 1 },
    ],
    calculate: (candles, inputs) => {
      const len = inputs?.length ?? 20;
      const times = candles.map((c) => c.time);
      const res = calcDonchianChannels(candles, len);
      return {
        lines: [
          { id: 'dc_upper', name: `DC Üst ${len}`, color: '#00E5FF', lineWidth: 1, data: cleanLineData(times, res.upper) },
          { id: 'dc_mid', name: `DC Orta ${len}`, color: '#B0BEC5', lineWidth: 1, data: cleanLineData(times, res.middle) },
          { id: 'dc_lower', name: `DC Alt ${len}`, color: '#00E5FF', lineWidth: 1, data: cleanLineData(times, res.lower) },
        ],
      };
    },
  },

  // 15. Keltner Channels (20, 1.5)
  {
    id: 'keltner',
    name: 'Keltner Kanalları (20, 1.5)',
    shortName: 'Keltner',
    category: 'volatility',
    type: 'overlay',
    description: 'EMA ve ATR tabanlı volatilite bantları',
    params: [
      { id: 'length', name: 'Uzunluk', type: 'number', default: 20, min: 2, max: 200, step: 1 },
      { id: 'mult', name: 'ATR Çarpanı', type: 'number', default: 1.5, min: 0.1, max: 10, step: 0.1 },
    ],
    defaultInputs: { length: 20, mult: 1.5 },
    plots: [
      { id: 'kc_upper', name: 'KC Üst', type: 'line', color: '#FF7043', lineWidth: 1 },
      { id: 'kc_mid', name: 'KC Orta', type: 'line', color: '#FFA726', lineWidth: 1 },
      { id: 'kc_lower', name: 'KC Alt', type: 'line', color: '#FF7043', lineWidth: 1 },
    ],
    calculate: (candles, inputs) => {
      const len = inputs?.length ?? 20;
      const mult = inputs?.mult ?? 1.5;
      const times = candles.map((c) => c.time);
      const res = calcKeltnerChannels(candles, len, mult);
      return {
        lines: [
          { id: 'kc_upper', name: `KC Üst (${len}, ${mult})`, color: '#FF7043', lineWidth: 1, data: cleanLineData(times, res.upper) },
          { id: 'kc_mid', name: `KC Orta (${len})`, color: '#FFA726', lineWidth: 1, data: cleanLineData(times, res.middle) },
          { id: 'kc_lower', name: `KC Alt (${len}, ${mult})`, color: '#FF7043', lineWidth: 1, data: cleanLineData(times, res.lower) },
        ],
      };
    },
  },

  // 16. Automatic Pivot Points (Classic)
  {
    id: 'pivots',
    name: 'Otomatik Pivot Noktaları (P, R1/R2, S1/S2)',
    shortName: 'Pivots',
    category: 'trend',
    type: 'overlay',
    description: 'Klasik Pivot Noktası ve Destek / Direnç seviyeleri',
    params: [],
    defaultInputs: {},
    plots: [
      { id: 'pivot_p', name: 'Pivot (P)', type: 'line', color: '#FFD54F', lineWidth: 1 },
      { id: 'pivot_r1', name: 'Direnç 1 (R1)', type: 'line', color: '#F23645', lineWidth: 1 },
      { id: 'pivot_s1', name: 'Destek 1 (S1)', type: 'line', color: '#089981', lineWidth: 1 },
      { id: 'pivot_r2', name: 'Direnç 2 (R2)', type: 'line', color: '#D32F2F', lineWidth: 1 },
      { id: 'pivot_s2', name: 'Destek 2 (S2)', type: 'line', color: '#00897B', lineWidth: 1 },
    ],
    calculate: (candles) => {
      const times = candles.map((c) => c.time);
      const res = calcPivotPoints(candles);
      return {
        lines: [
          { id: 'pivot_p', name: 'P (Pivot)', color: '#FFD54F', lineWidth: 1, data: cleanLineData(times, res.p) },
          { id: 'pivot_r1', name: 'R1', color: '#F23645', lineWidth: 1, data: cleanLineData(times, res.r1) },
          { id: 'pivot_s1', name: 'S1', color: '#089981', lineWidth: 1, data: cleanLineData(times, res.s1) },
          { id: 'pivot_r2', name: 'R2', color: '#D32F2F', lineWidth: 1, data: cleanLineData(times, res.r2) },
          { id: 'pivot_s2', name: 'S2', color: '#00897B', lineWidth: 1, data: cleanLineData(times, res.s2) },
        ],
      };
    },
  },

  // 17. Commodity Channel Index (CCI)
  {
    id: 'cci',
    name: 'Emtia Kanal Endeksi (CCI 20)',
    shortName: 'CCI',
    category: 'oscillator',
    type: 'oscillator',
    description: 'İstatistiki ortalamadan sapmayı ölçen momentum osilatörü',
    params: [
      { id: 'length', name: 'Uzunluk', type: 'number', default: 20, min: 2, max: 100, step: 1 },
    ],
    defaultInputs: { length: 20 },
    plots: [{ id: 'cci', name: 'CCI', type: 'line', color: '#AB47BC', lineWidth: 1 }],
    hlines: [
      { price: 100, color: 'rgba(242, 54, 69, 0.5)', title: 'Aşırı Alım (+100)' },
      { price: -100, color: 'rgba(8, 153, 129, 0.5)', title: 'Aşırı Satım (-100)' },
    ],
    calculate: (candles, inputs) => {
      const len = inputs?.length ?? 20;
      const times = candles.map((c) => c.time);
      const values = calcCCI(candles, len);
      return {
        lines: [
          { id: 'cci', name: `CCI ${len}`, color: '#AB47BC', lineWidth: 1, data: cleanLineData(times, values) },
        ],
        hlines: [
          { price: 100, color: 'rgba(242, 54, 69, 0.5)', title: 'Aşırı Alım' },
          { price: -100, color: 'rgba(8, 153, 129, 0.5)', title: 'Aşırı Satım' },
        ],
      };
    },
  },

  // 18. Momentum Oscillator (10)
  {
    id: 'momentum',
    name: 'Momentum Osilatörü (10)',
    shortName: 'Mom',
    category: 'oscillator',
    type: 'oscillator',
    description: 'Fiyatın değişim hızını gösteren osilatör',
    params: [
      { id: 'length', name: 'Uzunluk', type: 'number', default: 10, min: 1, max: 100, step: 1 },
    ],
    defaultInputs: { length: 10 },
    plots: [{ id: 'mom', name: 'Momentum', type: 'line', color: '#00BCD4', lineWidth: 1 }],
    hlines: [{ price: 0, color: 'rgba(255, 255, 255, 0.3)', title: 'Sıfır Çizgisi' }],
    calculate: (candles, inputs) => {
      const len = inputs?.length ?? 10;
      const times = candles.map((c) => c.time);
      const closes = candles.map((c) => c.close);
      const values = calcMomentum(closes, len);
      return {
        lines: [
          { id: 'mom', name: `Mom ${len}`, color: '#00BCD4', lineWidth: 1, data: cleanLineData(times, values) },
        ],
        hlines: [{ price: 0, color: 'rgba(255, 255, 255, 0.3)', title: '0' }],
      };
    },
  },

  // 19. Williams %R (14)
  {
    id: 'williams_r',
    name: 'Williams %R (14)',
    shortName: 'Williams %R',
    category: 'oscillator',
    type: 'oscillator',
    description: 'Aşırı alım ve aşırı satım seviyelerini ölçen momentum göstergesi',
    params: [
      { id: 'length', name: 'Uzunluk', type: 'number', default: 14, min: 2, max: 100, step: 1 },
    ],
    defaultInputs: { length: 14 },
    plots: [{ id: 'williams_r', name: 'Williams %R', type: 'line', color: '#089981', lineWidth: 1 }],
    hlines: [
      { price: -20, color: 'rgba(242, 54, 69, 0.5)', title: '-20 Aşırı Alım' },
      { price: -80, color: 'rgba(8, 153, 129, 0.5)', title: '-80 Aşırı Satım' },
    ],
    calculate: (candles, inputs) => {
      const len = inputs?.length ?? 14;
      const times = candles.map((c) => c.time);
      const values = calcWilliamsR(candles, len);
      return {
        lines: [
          { id: 'williams_r', name: `Williams %R ${len}`, color: '#089981', lineWidth: 1, data: cleanLineData(times, values) },
        ],
        hlines: [
          { price: -20, color: 'rgba(242, 54, 69, 0.5)', title: '-20' },
          { price: -80, color: 'rgba(8, 153, 129, 0.5)', title: '-80' },
        ],
      };
    },
  },

  // 20. On-Balance Volume (OBV)
  {
    id: 'obv',
    name: 'Denge Hacmi (On-Balance Volume - OBV)',
    shortName: 'OBV',
    category: 'volume',
    type: 'oscillator',
    description: 'Hacim akışını fiyattaki yön değişimlerine göre kümülatif toplayan indikatör',
    params: [],
    defaultInputs: {},
    plots: [{ id: 'obv', name: 'OBV', type: 'line', color: '#0284C7', lineWidth: 1 }],
    calculate: (candles) => {
      const times = candles.map((c) => c.time);
      const values = calcOBV(candles);
      return {
        lines: [
          { id: 'obv', name: 'OBV', color: '#0284C7', lineWidth: 1, data: cleanLineData(times, values) },
        ],
      };
    },
  },
];

export class IndicatorRegistry {
  private indicators = new Map<string, IndicatorDefinition>();

  constructor() {
    for (const def of BUILTIN_INDICATORS) {
      this.indicators.set(def.id, def);
    }
  }

  public register(def: IndicatorDefinition): void {
    this.indicators.set(def.id, def);
  }

  public get(id: string): IndicatorDefinition | undefined {
    return this.indicators.get(id);
  }

  public getAll(): IndicatorDefinition[] {
    return Array.from(this.indicators.values());
  }

  public getOverlays(): IndicatorDefinition[] {
    return this.getAll().filter((ind) => ind.type === 'overlay');
  }

  public getOscillators(): IndicatorDefinition[] {
    return this.getAll().filter((ind) => ind.type === 'oscillator');
  }

  public calculate(
    id: string,
    candles: Candle[],
    customInputs?: Record<string, any>
  ): IndicatorOutput | null {
    const def = this.indicators.get(id);
    if (!def) return null;
    const inputs = { ...def.defaultInputs, ...customInputs };
    return def.calculate(candles, inputs);
  }

  public calculateLatest(
    id: string,
    candles: Candle[],
    customInputs?: Record<string, any>
  ): LatestIndicatorPoint[] {
    const def = this.indicators.get(id);
    if (!def || !def.calculateLatest) return [];
    const inputs = { ...def.defaultInputs, ...customInputs };
    return def.calculateLatest(candles, inputs);
  }
}

export const indicatorRegistry = new IndicatorRegistry();
