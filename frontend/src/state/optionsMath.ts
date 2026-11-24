import { tt } from './i18n';
import type { OptionChainStrikeRow } from '../types/market';

export interface OptionStrategyLeg {
  id: string;
  side: 'BUY' | 'SELL';
  type: 'C' | 'P';
  strike: number;
  qty: number;
  premiumUSD: number;
  iv: number; // percentage, e.g. 52.5
  expiry: string;
  daysToExpiry: number;
}

export type OptionStrategyPresetId =
  | 'long_call'
  | 'long_put'
  | 'bull_call_spread'
  | 'bear_put_spread'
  | 'straddle'
  | 'strangle'
  | 'iron_condor'
  | 'butterfly';

export interface OptionStrategyPreset {
  id: OptionStrategyPresetId;
  name: string;
  bias: 'Boğa' | 'Ayı' | 'Volatilite' | 'Nötr / Bant';
  desc: string;
}

export const OPTION_STRATEGY_PRESETS: OptionStrategyPreset[] = [
  { id: 'long_call', name: "Long Call (Alım Al)", bias: "Boğa", desc: "Sınırlı prim riskiyle yükselişten sınırsız kâr potansiyeli." },
  { id: 'long_put', name: "Long Put (Satım Al)", bias: "Ayı", desc: "Sınırlı prim riskiyle düşüş yönlü koruma veya spekülasyon." },
  { id: 'bull_call_spread', name: 'Bull Call Spread', bias: "Boğa", desc: "ATM Call al + OTM Call sat; düşük maliyetli hedefli yükseliş." },
  { id: 'bear_put_spread', name: 'Bear Put Spread', bias: "Ayı", desc: "ATM Put al + OTM Put sat; düşük maliyetli hedefli düşüş." },
  { id: 'straddle', name: tt("Long Straddle (Pergel)"), bias: 'Volatilite', desc: "Aynı ATM kullanım fiyatından Call + Put al; sert kırılım stratejisi." },
  { id: 'strangle', name: "Long Strangle (Çanak)", bias: 'Volatilite', desc: "OTM Call + OTM Put al; düşük primli çift yönlü volatilite." },
  { id: 'iron_condor', name: tt("Iron Condor (Demir Kondor)"), bias: "Nötr / Bant", desc: "OTM Put/Call sat + daha dış OTM Put/Call al; yatay piyasada teta geliri." },
  { id: 'butterfly', name: tt("Long Call Butterfly (Kelebek)"), bias: "Nötr / Bant", desc: '1 ITM Call al + 2 ATM Call sat + 1 OTM Call al; dar bant hedefi.' },
];

function erf(x: number): number {
  const sign = x >= 0 ? 1 : -1;
  const ax = Math.abs(x);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const t = 1.0 / (1.0 + p * ax);
  const y = 1.0 - (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t) * Math.exp(-ax * ax);
  return sign * y;
}

export function normCDF(x: number): number {
  return 0.5 * (1.0 + erf(x / Math.SQRT2));
}

export function normPDF(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2.0 * Math.PI);
}

/** Black-76 teorik opsiyon fiyatı (USD). */
export function blackScholesPrice(S: number, K: number, T: number, sigma: number, isCall: boolean): number {
  if (S <= 0 || K <= 0) return 0;
  if (T <= 1e-6 || sigma <= 1e-6) {
    return isCall ? Math.max(0, S - K) : Math.max(0, K - S);
  }
  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + 0.5 * sigma * sigma * T) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;
  if (isCall) {
    return S * normCDF(d1) - K * normCDF(d2);
  }
  return K * normCDF(-d2) - S * normCDF(-d1);
}

/** Black-76 Yunanlıları (Delta, Gamma, Theta USD/gün, Vega USD/%1 IV). */
export function blackScholesGreeks(S: number, K: number, T: number, sigma: number, isCall: boolean) {
  if (S <= 0 || K <= 0 || T <= 1e-6 || sigma <= 1e-6) {
    const delta = isCall ? (S > K ? 1 : 0) : S < K ? -1 : 0;
    return { delta, gamma: 0, theta: 0, vega: 0 };
  }
  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + 0.5 * sigma * sigma * T) / (sigma * sqrtT);
  const nd1 = normPDF(d1);
  const delta = isCall ? normCDF(d1) : normCDF(d1) - 1;
  const gamma = nd1 / (S * sigma * sqrtT);
  const vega = (S * nd1 * sqrtT) / 100.0;
  const theta = -(S * nd1 * sigma) / (2.0 * sqrtT * 365.0);
  return { delta, gamma, theta, vega };
}

export interface PayoffPoint {
  price: number;
  expiryPnl: number;
  currentPnl: number;
}

export interface StrategyPayoffSummary {
  points: PayoffPoint[];
  netPremiumUSD: number; // >0 net debit paid, <0 net credit received
  maxProfitUSD: number | 'UNLIMITED';
  maxLossUSD: number | 'UNLIMITED';
  breakevens: number[];
  netDelta: number;
  netGamma: number;
  netTheta: number;
  netVega: number;
}

/** Çok bacaklı opsiyon stratejisinin vade sonu + T+0 (yarı vade) kâr/zarar eğrisini ve Yunanlılarını hesaplar. */
export function computeStrategyPayoff(legs: OptionStrategyLeg[], spotPrice: number, steps = 80): StrategyPayoffSummary {
  if (!legs.length || spotPrice <= 0) {
    return {
      points: [],
      netPremiumUSD: 0,
      maxProfitUSD: 0,
      maxLossUSD: 0,
      breakevens: [],
      netDelta: 0,
      netGamma: 0,
      netTheta: 0,
      netVega: 0,
    };
  }

  const strikes = legs.map((l) => l.strike);
  const minK = Math.min(...strikes, spotPrice);
  const maxK = Math.max(...strikes, spotPrice);
  const lo = Math.max(1, Math.min(spotPrice * 0.72, minK * 0.82));
  const hi = Math.max(spotPrice * 1.28, maxK * 1.18);

  let netPremiumUSD = 0;
  let netDelta = 0;
  let netGamma = 0;
  let netTheta = 0;
  let netVega = 0;

  for (const leg of legs) {
    const sign = leg.side === 'BUY' ? 1 : -1;
    const mult = sign * leg.qty;
    netPremiumUSD += mult * leg.premiumUSD;
    const T = Math.max(1 / 365, (leg.daysToExpiry || 14) / 365);
    const sigma = Math.max(0.05, (leg.iv || 50) / 100);
    const g = blackScholesGreeks(spotPrice, leg.strike, T, sigma, leg.type === 'C');
    netDelta += mult * g.delta;
    netGamma += mult * g.gamma;
    netTheta += mult * g.theta;
    netVega += mult * g.vega;
  }

  const evalExpiry = (S: number): number => {
    let pnl = 0;
    for (const leg of legs) {
      const sign = leg.side === 'BUY' ? 1 : -1;
      const intrinsic = leg.type === 'C' ? Math.max(0, S - leg.strike) : Math.max(0, leg.strike - S);
      pnl += sign * leg.qty * (intrinsic - leg.premiumUSD);
    }
    return pnl;
  };

  const evalMidTerm = (S: number): number => {
    let pnl = 0;
    for (const leg of legs) {
      const sign = leg.side === 'BUY' ? 1 : -1;
      const T = Math.max(1 / 3650, ((leg.daysToExpiry || 14) * 0.5) / 365);
      const sigma = Math.max(0.05, (leg.iv || 50) / 100);
      const theo = blackScholesPrice(S, leg.strike, T, sigma, leg.type === 'C');
      pnl += sign * leg.qty * (theo - leg.premiumUSD);
    }
    return pnl;
  };

  const points: PayoffPoint[] = [];
  let minPnl = Infinity;
  let maxPnl = -Infinity;
  for (let i = 0; i <= steps; i++) {
    const price = lo + ((hi - lo) * i) / steps;
    const expiryPnl = evalExpiry(price);
    const currentPnl = evalMidTerm(price);
    if (expiryPnl < minPnl) minPnl = expiryPnl;
    if (expiryPnl > maxPnl) maxPnl = expiryPnl;
    points.push({
      price: Math.round(price * 100) / 100,
      expiryPnl: Math.round(expiryPnl * 100) / 100,
      currentPnl: Math.round(currentPnl * 100) / 100,
    });
  }

  // Detect breakeven crossings on the expiration payoff curve
  const breakevens: number[] = [];
  for (let i = 1; i < points.length; i++) {
    const p0 = points[i - 1];
    const p1 = points[i];
    if ((p0.expiryPnl <= 0 && p1.expiryPnl >= 0) || (p0.expiryPnl >= 0 && p1.expiryPnl <= 0)) {
      const dy = p1.expiryPnl - p0.expiryPnl;
      if (Math.abs(dy) > 1e-6) {
        const be = p0.price + ((0 - p0.expiryPnl) / dy) * (p1.price - p0.price);
        if (!breakevens.some((x) => Math.abs(x - be) < (hi - lo) * 0.01)) {
          breakevens.push(Math.round(be * 100) / 100);
        }
      }
    }
  }

  // Asymptotic slope as S -> infinity (net Call qty) and S -> 0 (net Put qty)
  let highSlope = 0;
  for (const leg of legs) {
    if (leg.type === 'C') {
      highSlope += (leg.side === 'BUY' ? 1 : -1) * leg.qty;
    }
  }
  const farPnl = evalExpiry(maxK * 10);
  const zeroPnl = evalExpiry(0.01);
  if (zeroPnl > maxPnl) maxPnl = zeroPnl;
  if (zeroPnl < minPnl) minPnl = zeroPnl;

  let maxProfitUSD: number | 'UNLIMITED' = Math.round(maxPnl * 100) / 100;
  let maxLossUSD: number | 'UNLIMITED' = Math.round(minPnl * 100) / 100;
  if (highSlope > 1e-6 && farPnl > maxPnl) {
    maxProfitUSD = 'UNLIMITED';
  } else if (highSlope < -1e-6 && farPnl < minPnl) {
    maxLossUSD = 'UNLIMITED';
  }

  return {
    points,
    netPremiumUSD: Math.round(netPremiumUSD * 100) / 100,
    maxProfitUSD,
    maxLossUSD,
    breakevens,
    netDelta: Math.round(netDelta * 1000) / 1000,
    netGamma: Math.round(netGamma * 1000000) / 1000000,
    netTheta: Math.round(netTheta * 100) / 100,
    netVega: Math.round(netVega * 100) / 100,
  };
}

/** Gerçek opsiyon zinciri satırlarından seçilen hazır strateji şablonunu (ATM/OTM bacaklarını) kurar. */
export function buildStrategyFromChain(
  preset: OptionStrategyPresetId,
  rows: OptionChainStrikeRow[],
  spotPrice: number,
  expiry: string,
  daysToExpiry: number
): OptionStrategyLeg[] {
  if (!rows.length || spotPrice <= 0) return [];
  // Find ATM index closest to spotPrice
  let atmIdx = 0;
  let bestDist = Infinity;
  for (let i = 0; i < rows.length; i++) {
    const d = Math.abs(rows[i].strike - spotPrice);
    if (d < bestDist) {
      bestDist = d;
      atmIdx = i;
    }
  }
  const clamp = (idx: number) => Math.max(0, Math.min(rows.length - 1, idx));
  const step = Math.max(1, Math.round(rows.length * 0.08));

  const mkLeg = (idx: number, type: 'C' | 'P', side: 'BUY' | 'SELL', qty = 1): OptionStrategyLeg => {
    const r = rows[clamp(idx)];
    const q = type === 'C' ? r.call : r.put;
    const T = Math.max(1 / 365, (daysToExpiry || 14) / 365);
    const iv = q?.markIv && q.markIv > 0 ? q.markIv : 55;
    const fallbackPrem = blackScholesPrice(spotPrice, r.strike, T, iv / 100, type === 'C');
    const prem = q?.markUsd && q.markUsd > 0 ? q.markUsd : Math.round(fallbackPrem * 100) / 100;
    return {
      id: `${expiry}_${r.strike}_${type}_${side}_${Math.random().toString(36).slice(2, 6)}`,
      side,
      type,
      strike: r.strike,
      qty,
      premiumUSD: prem,
      iv,
      expiry,
      daysToExpiry,
    };
  };

  switch (preset) {
    case 'long_call':
      return [mkLeg(atmIdx, 'C', 'BUY')];
    case 'long_put':
      return [mkLeg(atmIdx, 'P', 'BUY')];
    case 'bull_call_spread':
      return [mkLeg(atmIdx, 'C', 'BUY'), mkLeg(atmIdx + step, 'C', 'SELL')];
    case 'bear_put_spread':
      return [mkLeg(atmIdx, 'P', 'BUY'), mkLeg(atmIdx - step, 'P', 'SELL')];
    case 'straddle':
      return [mkLeg(atmIdx, 'C', 'BUY'), mkLeg(atmIdx, 'P', 'BUY')];
    case 'strangle':
      return [mkLeg(atmIdx - step, 'P', 'BUY'), mkLeg(atmIdx + step, 'C', 'BUY')];
    case 'iron_condor':
      return [
        mkLeg(atmIdx - step * 2, 'P', 'BUY'),
        mkLeg(atmIdx - step, 'P', 'SELL'),
        mkLeg(atmIdx + step, 'C', 'SELL'),
        mkLeg(atmIdx + step * 2, 'C', 'BUY'),
      ];
    case 'butterfly':
      return [
        mkLeg(atmIdx - step, 'C', 'BUY', 1),
        mkLeg(atmIdx, 'C', 'SELL', 2),
        mkLeg(atmIdx + step, 'C', 'BUY', 1),
      ];
  }
}
