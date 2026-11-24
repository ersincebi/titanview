import type { Candle, Timeframe } from '../types/market';
import { calcATR, calcBollingerBands, calcEMA, calcRSI, calcVWAP } from '../indicators/taEngine';
import { TF_SECONDS } from './format';

export interface LabStats {
  last: number;
  barChangePct: number; // mevcut bar açılışına göre
  rangePct: number; // mevcut bar high-low / open
  rsi: number | null;
  atrPct: number | null;
  ema20DistPct: number | null;
  ema50DistPct: number | null;
  vwapDistPct: number | null;
  bbPos: number | null; // 0 alt band .. 1 üst band
  zScore20: number | null; // kapanışın 20 bar ortalamasından sapması (σ)
  volVsAvg: number | null; // bar hacmi / 20 bar ort.
  realizedVolPct: number | null; // son 30 bar log-getiri σ, yıllıksız
  barProgress: number; // 0..1 mevcut barın tamamlanma oranı
  secondsLeft: number;
  streak: number; // + ardışık yeşil, - ardışık kırmızı
  hi20: number;
  lo20: number;
}

const finite = (v: number | undefined): number | null => (v !== undefined && Number.isFinite(v) ? v : null);

/** Her tick'te yeniden hesaplanır; son ~300 bar yeterli (kuyruk dilimi). Saf fonksiyon. */
export function computeLab(all: Candle[], interval: Timeframe, nowSec: number = Date.now() / 1000): LabStats | null {
  if (all.length < 2) return null;
  const c = all.length > 300 ? all.slice(all.length - 300) : all;
  const n = c.length;
  const cur = c[n - 1];
  const closes = c.map((x) => x.close);
  const step = TF_SECONDS[interval] || 900;

  const rsi = finite(calcRSI(closes, 14)[n - 1]);
  const atr = finite(calcATR(c, 14)[n - 1]);
  const e20 = finite(calcEMA(closes, 20)[n - 1]);
  const e50 = finite(calcEMA(closes, 50)[n - 1]);
  const vwap = finite(calcVWAP(c)[n - 1]);
  const bb = calcBollingerBands(closes, 20, 2);
  const u = finite(bb.upper[n - 1]);
  const l = finite(bb.lower[n - 1]);

  const win = closes.slice(-20);
  const mean = win.reduce((a, b) => a + b, 0) / win.length;
  const sd = Math.sqrt(win.reduce((a, b) => a + (b - mean) ** 2, 0) / win.length);
  const vols = c.slice(-21, -1).map((x) => x.volume);
  const avgVol = vols.length ? vols.reduce((a, b) => a + b, 0) / vols.length : 0;

  const rets: number[] = [];
  for (let i = Math.max(1, n - 30); i < n; i++) if (c[i - 1].close > 0 && c[i].close > 0) rets.push(Math.log(c[i].close / c[i - 1].close));
  const rm = rets.reduce((a, b) => a + b, 0) / (rets.length || 1);
  const rv = rets.length > 2 ? Math.sqrt(rets.reduce((a, b) => a + (b - rm) ** 2, 0) / (rets.length - 1)) * 100 : null;

  let streak = 0;
  for (let i = n - 1; i >= 0; i--) {
    const dir = c[i].close >= c[i].open ? 1 : -1;
    if (streak === 0) streak = dir;
    else if (Math.sign(streak) === dir) streak += dir;
    else break;
  }

  const elapsed = Math.min(Math.max(nowSec - cur.time, 0), step);
  const w20 = c.slice(-20);
  return {
    last: cur.close,
    barChangePct: cur.open > 0 ? ((cur.close - cur.open) / cur.open) * 100 : 0,
    rangePct: cur.open > 0 ? ((cur.high - cur.low) / cur.open) * 100 : 0,
    rsi,
    atrPct: atr !== null && cur.close > 0 ? (atr / cur.close) * 100 : null,
    ema20DistPct: e20 ? ((cur.close - e20) / e20) * 100 : null,
    ema50DistPct: e50 ? ((cur.close - e50) / e50) * 100 : null,
    vwapDistPct: vwap ? ((cur.close - vwap) / vwap) * 100 : null,
    bbPos: u !== null && l !== null && u > l ? (cur.close - l) / (u - l) : null,
    zScore20: sd > 0 ? (cur.close - mean) / sd : null,
    volVsAvg: avgVol > 0 ? cur.volume / avgVol : null,
    realizedVolPct: rv,
    barProgress: elapsed / step,
    secondsLeft: Math.max(0, Math.round(step - elapsed)),
    streak,
    hi20: Math.max(...w20.map((x) => x.high)),
    lo20: Math.min(...w20.map((x) => x.low)),
  };
}
