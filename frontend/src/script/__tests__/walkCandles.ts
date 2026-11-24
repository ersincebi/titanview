import type { Candle } from '../../types/market';

/** Tohumlu rastgele yürüyüş: gerçekçi OHLCV (boşluk, fitil, hacim dalgası). */
export function walkCandles(n: number, stepSec = 86_400, start = 1_672_531_200, seed = 7): Candle[] {
  let s = seed;
  const rnd = () => {
    s = (s * 1_103_515_245 + 12_345) % 2_147_483_648;
    return s / 2_147_483_648;
  };
  const out: Candle[] = [];
  let prev = 100;
  for (let i = 0; i < n; i++) {
    const drift = Math.sin(i / 37) * 0.6 + (rnd() - 0.5) * 2.4;
    const open = prev + (rnd() - 0.5) * 0.8;
    const close = Math.max(1, open + drift);
    const high = Math.max(open, close) + rnd() * 1.6;
    const low = Math.max(0.5, Math.min(open, close) - rnd() * 1.6);
    const volume = Math.round(10_000 + rnd() * 9_000 + Math.abs(drift) * 4_000);
    out.push({ time: start + i * stepSec, open: +open.toFixed(4), high: +high.toFixed(4), low: +low.toFixed(4), close: +close.toFixed(4), volume });
    prev = close;
  }
  return out;
}

