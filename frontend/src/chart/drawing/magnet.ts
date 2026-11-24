import type { Candle } from '../../types/market';

/** Standart mıknatıs modları: kapalı / zayıf (yalnız yakınsa yapışır) / güçlü (her zaman OHLC'ye yapışır). */
export type MagnetMode = 'off' | 'weak' | 'strong';

/** Zayıf mıknatısın yapışma eşiği (ekran px). */
export const WEAK_MAGNET_PX = 18;

/** Mumun OHLC değerlerinden fiyata en yakın olanı. */
export function nearestOhlc(price: number, bar: Candle): number {
  const c = [bar.open, bar.high, bar.low, bar.close];
  let best = c[0];
  for (let i = 1; i < c.length; i++) if (Math.abs(price - c[i]) < Math.abs(price - best)) best = c[i];
  return best;
}

/**
 * Fiyatı mıknatıs moduna göre OHLC'ye yapıştırır.
 * Zayıf: en yakın OHLC ekranda `thresholdPx` içindeyse yapışır, değilse fiyat aynen kalır.
 * priceToY yoksa zayıf mod güçlü gibi davranır (piksel bilgisi olmadan eşik ölçülemez).
 */
export function snapPrice(
  price: number,
  time: number,
  candles: Candle[] | undefined,
  mode: MagnetMode,
  priceToY?: (p: number) => number | null,
  thresholdPx = WEAK_MAGNET_PX
): number {
  if (mode === 'off' || !candles || candles.length === 0) return price;
  const bar = findBar(candles, time);
  if (!bar) return price;
  const best = nearestOhlc(price, bar);
  if (mode === 'strong' || !priceToY) return best;
  const a = priceToY(price);
  const b = priceToY(best);
  if (a === null || b === null) return price;
  return Math.abs(a - b) <= thresholdPx ? best : price;
}

/** Zamanı tam eşleşen mum (ikili arama; mumlar zamana göre sıralı). */
export function findBar(candles: Candle[], time: number): Candle | null {
  let lo = 0;
  let hi = candles.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const t = candles[mid].time;
    if (t === time) return candles[mid];
    if (t < time) lo = mid + 1;
    else hi = mid - 1;
  }
  return null;
}

/** Ctrl/⌘ basılıyken mıknatıs tersine döner (kapalı → güçlü, açık → kapalı). */
export function effectiveMagnet(mode: MagnetMode, invert: boolean): MagnetMode {
  if (!invert) return mode;
  return mode === 'off' ? 'strong' : 'off';
}
