import type { Candle } from '../types/market';

/**
 * Transforms an array of standard OHLCV candles into Heikin-Ashi candles.
 *
 * Formulas:
 *  haClose = (Open + High + Low + Close) / 4
 *  haOpen[0] = (Open[0] + Close[0]) / 2
 *  haOpen[i] = (haOpen[i-1] + haClose[i-1]) / 2
 *  haHigh = max(High, haOpen, haClose)
 *  haLow = min(Low, haOpen, haClose)
 */
export function toHeikinAshi(candles: Candle[]): Candle[] {
  if (!candles || candles.length === 0) return [];

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
 * Calculates a single Heikin-Ashi candle given the current raw candle and the previous HA candle.
 * Enables O(1) live WebSocket tick updates without recalculating the entire historical dataset.
 */
export function calculateSingleHeikinAshi(
  current: Candle,
  prevHA: Candle | null
): Candle {
  const haClose = (current.open + current.high + current.low + current.close) / 4;
  const haOpen = prevHA
    ? (prevHA.open + prevHA.close) / 2
    : (current.open + current.close) / 2;
  const haHigh = Math.max(current.high, haOpen, haClose);
  const haLow = Math.min(current.low, haOpen, haClose);

  return {
    time: current.time,
    open: Number(haOpen.toFixed(4)),
    high: Number(haHigh.toFixed(4)),
    low: Number(haLow.toFixed(4)),
    close: Number(haClose.toFixed(4)),
    volume: current.volume,
  };
}
