import type { Timeframe } from '../types/market';
import {
  PRESET_INTERVALS,
  intervalLabelTr,
  intervalSeconds,
  isValidInterval,
  parseInterval,
} from '../state/intervals';

export const SUPPORTED_TIMEFRAMES: readonly Timeframe[] = PRESET_INTERVALS;

export const DEFAULT_TIMEFRAME: Timeframe = '15m';

/**
 * Validates whether the given string is a supported Timeframe.
 */
export function isValidTimeframe(tf: string): tf is Timeframe {
  return isValidInterval(tf);
}

/**
 * Converts a timeframe string to its duration in seconds.
 */
export function timeframeToSeconds(tf: Timeframe): number {
  return intervalSeconds(tf);
}

/**
 * Converts a timeframe string to its duration in minutes.
 */
export function timeframeToMinutes(tf: Timeframe): number {
  return timeframeToSeconds(tf) / 60;
}

/**
 * Converts a timeframe string to its duration in milliseconds.
 */
export function timeframeToMilliseconds(tf: Timeframe): number {
  return timeframeToSeconds(tf) * 1000;
}

/**
 * Returns formatted uppercase ticker resolution label (e.g., '15M', '1D').
 */
export function formatTimeframe(tf: Timeframe): string {
  return tf.toUpperCase();
}

/**
 * Returns a human-friendly localized description.
 */
export function getTimeframeLabel(tf: Timeframe): string {
  return intervalLabelTr(tf);
}

/**
 * Returns true if the timeframe is smaller than daily (intraday).
 */
export function isIntraday(tf: Timeframe): boolean {
  const u = parseInterval(tf)?.unit;
  return u === 's' || u === 'm' || u === 'h';
}

/**
 * Returns true if the timeframe is daily, weekly or monthly.
 */
export function isDailyOrHigher(tf: Timeframe): boolean {
  return !isIntraday(tf);
}

/**
 * Rounds down a Unix timestamp (seconds) to the start boundary of the timeframe bar.
 */
export function alignTimestampToTimeframe(timestampSec: number, tf: Timeframe): number {
  const step = timeframeToSeconds(tf);
  return Math.floor(timestampSec / step) * step;
}

/**
 * Computes the next expected candle timestamp given a current timestamp and timeframe.
 */
export function getNextCandleTimestamp(currentSec: number, tf: Timeframe): number {
  return alignTimestampToTimeframe(currentSec, tf) + timeframeToSeconds(tf);
}

/**
 * Estimates the theoretical bar count between two timestamps for a given timeframe.
 */
export function calculateCandleCountForRange(
  fromSec: number,
  toSec: number,
  tf: Timeframe
): number {
  if (toSec <= fromSec) return 0;
  const step = timeframeToSeconds(tf);
  return Math.floor((toSec - fromSec) / step);
}
