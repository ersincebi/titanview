import { localeTag } from './i18n';
import type { BacktestReport, BacktestTrade, Candle } from '../types/market';

export interface SideStats {
  n: number;
  wins: number;
  losses: number;
  net: number;
  grossProfit: number;
  grossLoss: number; // pozitif sayı
  profitFactor: number | null; // zarar yoksa null
  winRate: number | null; // %
  avgTrade: number | null;
  avgWin: number | null;
  avgLoss: number | null; // pozitif
  payoff: number | null; // ort. kazanç / ort. kayıp
  largestWin: number;
  largestLoss: number; // pozitif
  maxConsecWins: number;
  maxConsecLosses: number;
  avgBarsHeld: number | null;
}

export function sideStats(trades: BacktestTrade[], stepSec: number): SideStats {
  const wins = trades.filter((t) => t.pnlCash > 0);
  const losses = trades.filter((t) => t.pnlCash < 0);
  const gp = wins.reduce((s, t) => s + t.pnlCash, 0);
  const gl = -losses.reduce((s, t) => s + t.pnlCash, 0);
  let cw = 0;
  let cl = 0;
  let maxW = 0;
  let maxL = 0;
  for (const t of trades) {
    if (t.pnlCash > 0) {
      cw++;
      cl = 0;
    } else if (t.pnlCash < 0) {
      cl++;
      cw = 0;
    } else {
      cw = 0;
      cl = 0;
    }
    maxW = Math.max(maxW, cw);
    maxL = Math.max(maxL, cl);
  }
  const n = trades.length;
  const held = trades.filter((t) => t.exitTime > t.entryTime && t.entryTime > 0);
  const avgWin = wins.length ? gp / wins.length : null;
  const avgLoss = losses.length ? gl / losses.length : null;
  return {
    n,
    wins: wins.length,
    losses: losses.length,
    net: gp - gl,
    grossProfit: gp,
    grossLoss: gl,
    profitFactor: gl > 0 ? gp / gl : null,
    winRate: n ? (wins.length / n) * 100 : null,
    avgTrade: n ? (gp - gl) / n : null,
    avgWin,
    avgLoss,
    payoff: avgWin !== null && avgLoss !== null && avgLoss > 0 ? avgWin / avgLoss : null,
    largestWin: wins.length ? Math.max(...wins.map((t) => t.pnlCash)) : 0,
    largestLoss: losses.length ? -Math.min(...losses.map((t) => t.pnlCash)) : 0,
    maxConsecWins: maxW,
    maxConsecLosses: maxL,
    avgBarsHeld: held.length && stepSec > 0 ? held.reduce((s, t) => s + (t.exitTime - t.entryTime) / stepSec, 0) / held.length : null,
  };
}

export interface RiskStats {
  maxDrawdownCash: number;
  maxDrawdownPct: number;
  sharpe: number | null;
  sortino: number | null;
  returnOnMaxDD: number | null; // net kâr / max düşüş ("Ret/DD")
}

/** Bar bazlı özsermaye eğrisinden risk ölçüleri. Yıllıklandırma: bar sayısı / yıl. */
export function riskStats(bt: BacktestReport, stepSec: number): RiskStats {
  const curve = bt.equityCurve ?? [];
  let peak = -Infinity;
  let maxDDc = 0;
  let maxDDp = 0;
  for (const p of curve) {
    peak = Math.max(peak, p.value);
    const dd = peak - p.value;
    if (dd > maxDDc) maxDDc = dd;
    if (peak > 0 && (dd / peak) * 100 > maxDDp) maxDDp = (dd / peak) * 100;
  }
  const rets: number[] = [];
  for (let i = 1; i < curve.length; i++) if (curve[i - 1].value > 0) rets.push(curve[i].value / curve[i - 1].value - 1);
  let sharpe: number | null = null;
  let sortino: number | null = null;
  if (rets.length >= 10 && stepSec > 0) {
    const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
    const sd = Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1));
    const down = Math.sqrt(rets.reduce((a, b) => a + Math.min(b, 0) ** 2, 0) / rets.length);
    const ann = Math.sqrt((365 * 86400) / stepSec);
    sharpe = sd > 0 ? (mean / sd) * ann : null;
    sortino = down > 0 ? (mean / down) * ann : null;
  }
  return {
    maxDrawdownCash: maxDDc,
    maxDrawdownPct: maxDDp,
    sharpe,
    sortino,
    returnOnMaxDD: maxDDc > 0 ? bt.netProfitCash / maxDDc : null,
  };
}

/** Al-ve-tut: eğrinin ilk barından son barına, başlangıç sermayesiyle. */
export function buyAndHold(bt: BacktestReport, candles: Candle[]): { cash: number; pct: number } | null {
  const curve = bt.equityCurve ?? [];
  if (curve.length < 2 || candles.length === 0) return null;
  const closeAt = (t: number) => {
    let ans: Candle | null = null;
    for (const c of candles) {
      if (c.time <= t) ans = c;
      else break;
    }
    return ans?.close ?? null;
  };
  const a = closeAt(curve[0].time);
  const b = closeAt(curve[curve.length - 1].time);
  if (a === null || b === null || a <= 0) return null;
  const pct = (b / a - 1) * 100;
  return { pct, cash: (bt.initialCapital * pct) / 100 };
}

export interface ChartGeometry {
  viewBox: string;
  equity: string;
  buyHold: string | null;
  drawdown: string; // dolu çokgen (tepe çizgisinden aşağı)
  yTicks: Array<{ y: number; label: string }>;
  xTicks: Array<{ x: number; time: number }>;
  zeroY: number | null; // başlangıç sermayesi çizgisi
}

/** Özsermaye / al-ve-tut / düşüş grafiği için SVG geometrisi (zaman ekseni gerçek zamana göre). */
export function chartGeometry(bt: BacktestReport, candles: Candle[], w = 760, h = 190): ChartGeometry | null {
  const curve = bt.equityCurve ?? [];
  if (curve.length < 2) return null;
  const padL = 46;
  const padR = 8;
  const padT = 8;
  const padB = 18;
  const t0 = curve[0].time;
  const t1 = curve[curve.length - 1].time;
  const span = Math.max(1, t1 - t0);
  const bhVals: number[] | null = candles.length
    ? (() => {
        const first = candles.find((c) => c.time <= t0) ?? candles[0];
        let ci = 0;
        return curve.map((p) => {
          while (ci + 1 < candles.length && candles[ci + 1].time <= p.time) ci++;
          return first.close > 0 ? bt.initialCapital * (candles[ci].close / first.close) : bt.initialCapital;
        });
      })()
    : null;
  const all = [...curve.map((p) => p.value), ...(bhVals ?? []), bt.initialCapital];
  let lo = Math.min(...all);
  let hi = Math.max(...all);
  if (hi - lo < 1e-9) hi = lo + 1;
  const pad = (hi - lo) * 0.06;
  lo -= pad;
  hi += pad;
  const X = (t: number) => padL + ((t - t0) / span) * (w - padL - padR);
  const Y = (v: number) => padT + (1 - (v - lo) / (hi - lo)) * (h - padT - padB);
  const pts = (arr: Array<{ t: number; v: number }>) => arr.map((p) => `${X(p.t).toFixed(1)},${Y(p.v).toFixed(1)}`).join(' ');
  const equity = pts(curve.map((p) => ({ t: p.time, v: p.value })));
  const buyHold = bhVals ? pts(curve.map((p, i) => ({ t: p.time, v: bhVals[i] }))) : null;
  let peak = -Infinity;
  const peaks = curve.map((p) => (peak = Math.max(peak, p.value)));
  const top = curve.map((p, i) => `${X(p.time).toFixed(1)},${Y(peaks[i]).toFixed(1)}`);
  const bottom = curve.map((p) => `${X(p.time).toFixed(1)},${Y(p.value).toFixed(1)}`).reverse();
  const drawdown = [...top, ...bottom].join(' ');
  const ticks = 4;
  const yTicks = Array.from({ length: ticks + 1 }, (_, i) => {
    const v = lo + ((hi - lo) * i) / ticks;
    return { y: Y(v), label: Math.round(v).toLocaleString(localeTag()) };
  });
  const xTicks = Array.from({ length: 5 }, (_, i) => {
    const t = t0 + (span * i) / 4;
    return { x: X(t), time: t };
  });
  const zeroY = bt.initialCapital >= lo && bt.initialCapital <= hi ? Y(bt.initialCapital) : null;
  return { viewBox: `0 0 ${w} ${h}`, equity, buyHold, drawdown, yTicks, xTicks, zeroY };
}
