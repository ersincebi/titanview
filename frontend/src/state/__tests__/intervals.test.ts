import { describe, expect, it } from 'vitest';
import {
  INTERVAL_GROUPS,
  PRESET_INTERVALS,
  buildCustomInterval,
  intervalLabelTr,
  intervalSeconds,
  isSecondsInterval,
  isValidInterval,
  normalizeInterval,
  parseInterval,
  sortIntervals,
  tvIntervalLabel,
} from '../intervals';
import { formatAxisTime, formatCrosshairTime, tickMarkFormatter } from '../../chart/timezone';

describe('intervals (Faz 25: saniye/çoklu saat/çoklu gün/ay özel aralıklar)', () => {
  it('parses and normalizes all standard + custom intervals without confusing 1m and 1M', () => {
    expect(normalizeInterval('1s')).toBe('1s');
    expect(normalizeInterval('59s')).toBe('59s');
    expect(normalizeInterval('60s')).toBe('1m');
    expect(normalizeInterval('1m')).toBe('1m');
    expect(normalizeInterval('45m')).toBe('45m');
    expect(normalizeInterval('60m')).toBe('1h');
    expect(normalizeInterval('120m')).toBe('2h');
    expect(normalizeInterval('3h')).toBe('3h');
    expect(normalizeInterval('6h')).toBe('6h');
    expect(normalizeInterval('8h')).toBe('8h');
    expect(normalizeInterval('12h')).toBe('12h');
    expect(normalizeInterval('24h')).toBe('1d');
    expect(normalizeInterval('2D')).toBe('2d');
    expect(normalizeInterval('3d')).toBe('3d');
    expect(normalizeInterval('1W')).toBe('1w');
    expect(normalizeInterval('1M')).toBe('1M');
    expect(normalizeInterval('M')).toBe('1M');
    expect(normalizeInterval('3M')).toBe('3M');
    expect(normalizeInterval('6M')).toBe('6M');
    expect(normalizeInterval('12M')).toBe('12M');
    expect(normalizeInterval('1y')).toBe('12M');
    expect(normalizeInterval('1mo')).toBe('1M');

    // Invalid cases must return null
    expect(normalizeInterval('')).toBeNull();
    expect(normalizeInterval('0s')).toBeNull();
    expect(normalizeInterval('13M')).toBeNull();
    expect(normalizeInterval('7q')).toBeNull();
    expect(normalizeInterval('100s')).toBeNull();
    expect(isValidInterval('30s')).toBe(true);
    expect(isValidInterval('13M')).toBe(false);
  });

  it('builds custom intervals, computes seconds, formats Turkish & Standart labels, and sorts', () => {
    expect(buildCustomInterval(7, 's')).toBe('7s');
    expect(buildCustomInterval(0, 's')).toBeNull();
    expect(buildCustomInterval(60, 's')).toBeNull();
    expect(buildCustomInterval(2, 'M')).toBe('2M');
    expect(buildCustomInterval(13, 'M')).toBeNull();

    expect(isSecondsInterval('5s')).toBe(true);
    expect(isSecondsInterval('1m')).toBe(false);
    expect(intervalSeconds('15s')).toBe(15);
    expect(intervalSeconds('2h')).toBe(7200);
    expect(intervalSeconds('3d')).toBe(259200);
    expect(intervalSeconds('3M')).toBe(90 * 86400);

    expect(tvIntervalLabel('5s')).toBe('5sn');
    expect(tvIntervalLabel('15m')).toBe('15');
    expect(tvIntervalLabel('2h')).toBe('2s');
    expect(tvIntervalLabel('2d')).toBe('2G');
    expect(tvIntervalLabel('1w')).toBe('1H');
    expect(tvIntervalLabel('3M')).toBe('3A');
    expect(intervalLabelTr('12M')).toBe('12 Ay');
    expect(intervalLabelTr('30s')).toBe('30 Saniye');

    expect(sortIntervals(['1M', '5s', '2h', '15m', '2d'])).toEqual(['5s', '15m', '2h', '2d', '1M']);
    expect(INTERVAL_GROUPS).toHaveLength(4);
    expect(PRESET_INTERVALS.length).toBeGreaterThanOrEqual(24);
    expect(parseInterval('daily')).toEqual({ n: 1, unit: 'd' });
    expect(parseInterval('weekly')).toEqual({ n: 1, unit: 'w' });
    expect(parseInterval('monthly')).toEqual({ n: 1, unit: 'M' });
  });

  it('formats seconds on chart axis and crosshair when on seconds intervals', () => {
    const ts = 1731283245; // :45 seconds
    const axSec = formatAxisTime(ts, 'seconds', 'UTC');
    expect(axSec).toContain(':45');
    expect(tickMarkFormatter(ts, 4, 'UTC')).toContain(':45');
    expect(formatCrosshairTime(ts, 'UTC', true)).toContain(':45');
    expect(formatCrosshairTime(ts, 'UTC', false)).not.toContain(':45');
  });
});
