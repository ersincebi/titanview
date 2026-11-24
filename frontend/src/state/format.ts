import type { MarketType, Timeframe } from '../types/market';
import {
  PRESET_INTERVALS,
  intervalLabelTr,
  intervalSeconds,
  tvIntervalLabel as tvIntervalLabelImpl,
} from './intervals';

export {
  INTERVAL_GROUPS,
  PRESET_INTERVALS,
  UNIT_LABELS_TR,
  UNIT_LIMITS,
  buildCustomInterval,
  intervalLabelEn,
  intervalLabelTr,
  intervalSeconds,
  isSecondsInterval,
  isValidInterval,
  normalizeInterval,
  parseInterval,
  sortIntervals,
  type IntervalGroup,
  type IntervalUnit,
  type ParsedInterval,
} from './intervals';

export const POPULAR_TIMEFRAMES: Timeframe[] = ['15m', '4h'];
export const ALL_TIMEFRAMES: Timeframe[] = [...PRESET_INTERVALS];

export const TF_LABEL_TR: Record<string, string> = Object.fromEntries(
  PRESET_INTERVALS.map((tf) => [tf, intervalLabelTr(tf)])
);

export const TF_SECONDS: Record<string, number> = Object.fromEntries(
  PRESET_INTERVALS.map((tf) => [tf, intervalSeconds(tf)])
);

/** Alt eksen aralık düğmesi → grafik zaman dilimi. */
export const RANGE_JUMP_TF: Record<string, Timeframe> = {
  '1D': '1m',
  '5D': '5m',
  '1M': '15m',
  '3M': '1h',
  '6M': '1h',
  YTD: '4h',
  '1Y': '1d',
  '5Y': '1w',
  ALL: '1w',
};

/** Lejant / tablo fiyat biçimi. */
export function formatPrice(val: number): string {
  if (val < 2) return val.toFixed(4);
  return val.toFixed(2);
}

/** İzleme listesi fiyat biçimi (büyük değerlerde binlik ayraç). */
export function formatQuotePrice(price: number): string {
  if (price === 0) return '0.00';
  if (Math.abs(price) >= 1000) {
    return price.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  if (Math.abs(price) >= 1) return price.toFixed(2);
  if (Math.abs(price) >= 0.001) return price.toFixed(4);
  return price.toFixed(6);
}

export function formatSigned(n: number, digits = 2, suffix = ''): string {
  return `${n >= 0 ? '+' : ''}${n.toFixed(digits)}${suffix}`;
}

export function marketLabel(market: MarketType): string {
  if (market === 'BIST') return 'BIST 15d';
  if (market === 'CRYPTO') return 'BINANCE';
  return market;
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** İşaret $'dan önce: +$12.50 / -$3.00 */
export function formatMoney(n: number, digits = 2): string {
  return `${n >= 0 ? '+' : '-'}$${Math.abs(n).toFixed(digits)}`;
}

/** Kısa aralık etiketi: 5s→"5sn", 15m→"15", 1h→"1s", 4h→"4s", 1d→"1G", 1w→"1H", 1M→"1A". */
export function tvIntervalLabel(tf: Timeframe): string {
  return tvIntervalLabelImpl(tf);
}

/** Standart hacim kısaltması: 26.25M, 3.44K, 1.2B. */
export function formatVolumeShort(v: number): string {
  if (!Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${(v / 1e3).toFixed(2)}K`;
  return String(Math.round(v));
}
