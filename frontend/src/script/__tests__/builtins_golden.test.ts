import { describe, expect, it } from 'vitest';
import {
  calcATR,
  calcBollingerBands,
  calcCCI,
  calcDonchianChannels,
  calcEMA,
  calcMACD,
  calcMomentum,
  calcOBV,
  calcRSI,
  calcSMA,
  calcStochastic,
  calcWilliamsR,
  calcWMA,
} from '../../indicators/taEngine';
import type { Candle, ScriptExecutionResult } from '../../types/market';
import { builtinById } from '../builtins';
import { calendarBucket, inSession } from '../lib';
import { executeScript, type RunOptions } from '../runtime';
import { walkCandles } from './walkCandles';

const BARS = walkCandles(420);
const closes = BARS.map((c) => c.close);

function runB(id: string, opts: RunOptions = {}, bars: Candle[] = BARS): ScriptExecutionResult {
  const b = builtinById(id);
  if (!b) throw new Error(`yok: ${id}`);
  const r = executeScript(b.code, bars, { symbol: 'TEST', timeframe: 'D', ...opts });
  if (!r.ok) throw new Error(`${id}: ${r.error}`);
  return r;
}

/** Betik çizimini bar indeksine göre (NaN = yok) dizi olarak verir. */
function series(r: ScriptExecutionResult, title: string, bars: Candle[] = BARS): number[] {
  const p = r.plots.find((x) => x.title === title);
  if (!p) throw new Error(`plot yok: ${title} (${r.plots.map((x) => x.title).join(', ')})`);
  const m = new Map(p.data.map((d) => [d.time, d.value]));
  return bars.map((c) => m.get(c.time) ?? NaN);
}

/**
 * Isınma sonrası son `tail` barda bağıl hata ≤ 1e-6 (standart formül tanım, bağımsız TS uygulaması).
 * RMA/EMA tohumlama farkı (13/14)^n ile söner: özyinelemeli göstergelerde kuyruk 150 bar.
 */
function same(a: number[], b: number[], tail = 250): void {
  let compared = 0;
  for (let i = a.length - tail; i < a.length; i++) {
    if (!Number.isFinite(b[i])) continue;
    expect(Number.isFinite(a[i]), `bar ${i}`).toBe(true);
    expect(Math.abs(a[i] - b[i]) / Math.max(1, Math.abs(b[i])), `bar ${i}: ${a[i]} vs ${b[i]}`).toBeLessThan(1e-6);
    compared++;
  }
  expect(compared).toBeGreaterThan(tail * 0.9);
}

describe('Faz 20 altın değerler: hazır .titan göstergeleri = bağımsız taEngine hesabı', () => {
  it('SMA / EMA / WMA', () => {
    same(series(runB('sma'), 'SMA'), calcSMA(closes, 9));
    same(series(runB('ema'), 'EMA'), calcEMA(closes, 9));
    same(series(runB('wma'), 'WMA'), calcWMA(closes, 9));
  });
  it('RSI 14 (RMA tanımı) ve RSI tabanlı SMA', () => {
    const r = runB('rsi');
    same(series(r, 'RSI'), calcRSI(closes, 14), 150);
    same(series(r, 'RSI-based MA'), calcSMA(calcRSI(closes, 14), 14), 120);
  });
  it('MACD 12/26/9 çizgi, sinyal, histogram', () => {
    const r = runB('macd');
    const m = calcMACD(closes, 12, 26, 9);
    same(series(r, 'MACD'), m.macdLine, 150);
    same(series(r, 'Signal'), m.signalLine, 150);
    same(series(r, 'Histogram'), m.histLine, 150);
  });
  it('Bollinger 20/2', () => {
    const r = runB('bb');
    const bb = calcBollingerBands(closes, 20, 2);
    same(series(r, 'Basis'), bb.middle);
    same(series(r, 'Upper'), bb.upper);
    same(series(r, 'Lower'), bb.lower);
  });
  it('ATR 14 (RMA), Stokastik 14/1/3, CCI 20, Williams %R 14, Momentum 10, OBV, Donchian 20', () => {
    same(series(runB('atr'), 'ATR'), calcATR(BARS, 14), 150);
    const st = calcStochastic(BARS, 14, 1, 3);
    const rs = runB('stoch');
    same(series(rs, '%K'), st.k);
    same(series(rs, '%D'), st.d);
    same(series(runB('cci'), 'CCI'), calcCCI(BARS, 20));
    same(series(runB('wpr'), '%R'), calcWilliamsR(BARS, 14));
    same(series(runB('mom'), 'MOM'), calcMomentum(closes, 10));
    // Standart OBV 0'dan başlar (ta.cum, ilk bar değişimi na); taEngine ilk hacimden: fark sabit
    same(series(runB('obv'), 'OnBalanceVolume'), calcOBV(BARS).map((v) => v - BARS[0].volume));
    const dc = calcDonchianChannels(BARS, 20);
    const rd = runB('donchian');
    same(series(rd, 'Upper'), dc.upper);
    same(series(rd, 'Lower'), dc.lower);
  });
  it('girdi geçersiz kılma: RSI uzunluğu 7 ve kaynak hl2', () => {
    const r = runB('rsi', { inputOverrides: { 'RSI Length': 7, Source: 'hl2' } });
    same(series(r, 'RSI'), calcRSI(BARS.map((c) => (c.high + c.low) / 2), 7), 150);
  });
  it('DEMA/TEMA tanımları EMA zincirinden', () => {
    const e1 = calcEMA(closes, 9);
    const e2 = calcEMA(e1.map((x) => (Number.isFinite(x) ? x : NaN)), 9);
    const dema = series(runB('dema'), 'DEMA');
    // Varsayılan: e2 = ema(e1) e1'in ilk geçerli değerinden başlar; son 200 barda yakınsar
    const ref = e1.map((v, i) => 2 * v - e2[i]);
    for (let i = 300; i < 420; i++) expect(Math.abs(dema[i] - ref[i])).toBeLessThan(1e-3);
  });
});

describe('Faz 20: gösterge üstüne gösterge (externalSources)', () => {
  it('RSI kaynağı başka göstergenin çıktısı ("@" anahtarı) olabilir', () => {
    const ema = calcEMA(closes, 20);
    const r = runB('rsi', { inputOverrides: { Source: '@s1:EMA' }, externalSources: { 's1:EMA': ema } });
    same(series(r, 'RSI'), calcRSI(ema, 14), 150);
    expect(r.inputs?.find((d) => d.title === 'Source')?.value).toBe('@s1:EMA');
  });
  it('bağlı çıktı yoksa na + dürüst uyarı', () => {
    const r = runB('rsi', { inputOverrides: { Source: '@yok:X' } });
    expect(r.plots.find((p) => p.title === 'RSI')!.data.length).toBe(0);
    expect(r.warnings?.some((w) => w.includes('bağlı gösterge çıktısı bulunamadı'))).toBe(true);
  });
});

describe('Faz 20: request.security başka sembol (symbolCandles)', () => {
  const other = walkCandles(420, 86_400, 1_672_531_200, 99);
  it('veri yoksa missingSymbols bildirir, verilince oran = close / diğer close', () => {
    const miss = runB('ratio');
    expect(miss.missingSymbols).toEqual(['XU100.IS']);
    const r = runB('ratio', { symbolCandles: { 'XU100.IS': other } });
    expect(r.missingSymbols).toBeUndefined();
    const ratio = series(r, 'Ratio');
    for (let i = 0; i < 420; i++) expect(ratio[i]).toBeCloseTo(BARS[i].close / other[i].close, 8);
  });
  it('korelasyon ve göreli güç diğer sembol verisiyle çizer; önek (BIST:) atılır', () => {
    const r = runB('correlation', { symbolCandles: { 'XU100.IS': other } });
    expect(series(r, 'Correlation').filter(Number.isFinite).length).toBeGreaterThan(390);
    const rs = runB('relative_strength', { inputOverrides: { 'Comparative Symbol': 'BIST:XU100.IS' }, symbolCandles: { 'XU100.IS': other } });
    expect(series(rs, 'RS').filter(Number.isFinite).length).toBe(420);
  });
  it('ileriye bakış yok: diğer sembolün henüz kapanmamış barı kullanılmaz (HTF)', () => {
    const code = `//@version=6
indicator("x")
plot(request.security("OTHER", "W", close), "w")`;
    const r = executeScript(code, BARS, { symbol: 'TEST', timeframe: 'D', symbolCandles: { OTHER: other } });
    const w = series(r, 'w');
    // ilk haftanın günlerinde (hafta kapanmadan) değer yok
    expect(Number.isFinite(w[0])).toBe(false);
    expect(w.filter(Number.isFinite).length).toBeGreaterThan(400);
  });
});

describe('Faz 20: mum formasyonları', () => {
  const mk = (o: number, h: number, l: number, c: number, i: number): Candle => ({ time: 1_700_000_000 + i * 86400, open: o, high: h, low: l, close: c, volume: 1000 });
  /** 60 bar düşüş trendi + son iki bar formasyon */
  const downTrend = (tail: Candle[]): Candle[] => {
    const out: Candle[] = [];
    for (let i = 0; i < 60; i++) {
      const base = 200 - i * 1.5;
      out.push(mk(base + 0.5, base + 1, base - 1, base - 0.5, i));
    }
    return [...out, ...tail.map((c, k) => ({ ...c, time: 1_700_000_000 + (60 + k) * 86400 }))];
  };
  const fires = (id: string, bars: Candle[]) => {
    const r = executeScript(builtinById(id)!.code, bars, { symbol: 'TEST', timeframe: 'D' });
    expect(r.ok, r.error).toBe(true);
    return r.markers.map((m) => m.time);
  };
  it('Yutan Boğa: düşüşte küçük siyah mumu yutan uzun beyaz mum', () => {
    const bars = downTrend([mk(110, 110.5, 109.5, 109.8, 0), mk(109.5, 113, 109.2, 112.8, 1)]);
    expect(fires('cdl_engulfing_bull', bars)).toContain(bars[bars.length - 1].time);
    expect(fires('cdl_engulfing_bear', bars)).not.toContain(bars[bars.length - 1].time);
  });
  it('Çekiç: düşüşte uzun alt gölge, üst gölgesiz küçük gövde', () => {
    const bars = downTrend([mk(108, 108.6, 104, 108.6, 0)]);
    expect(fires('cdl_hammer', bars)).toContain(bars[bars.length - 1].time);
  });
  it('Doji: gövde ≤ %5 aralık, eşit gölgeler', () => {
    const bars = downTrend([mk(108, 110, 106, 108.05, 0)]);
    expect(fires('cdl_doji', bars)).toContain(bars[bars.length - 1].time);
  });
  it('Tüm Mum Formasyonları gerçekçi veride işaret üretir; boğa filtresi kapanınca boğa işaretleri kalkar', () => {
    const all = executeScript(builtinById('cdl_all')!.code, BARS, { symbol: 'TEST', timeframe: 'D' });
    expect(all.markers.length).toBeGreaterThan(20);
    const noBull = executeScript(builtinById('cdl_all')!.code, BARS, { symbol: 'TEST', timeframe: 'D', inputOverrides: { Bullish: false } });
    expect(noBull.markers.every((m) => m.position !== 'belowBar')).toBe(true);
  });
});

describe('Faz 20: seans ve takvim yardımcıları', () => {
  it('inSession: normal, gece yarısını aşan, gün filtresi, çoklu aralık', () => {
    expect(inSession('0930-1600', 600, 1)).toBe(true);
    expect(inSession('0930-1600', 960, 1)).toBe(false);
    expect(inSession('2200-0200', 60, 2)).toBe(true);
    expect(inSession('2200-0200', 1380, 2)).toBe(true);
    expect(inSession('0930-1600:23456', 600, 0)).toBe(false); // pazar
    expect(inSession('0930-1600:23456', 600, 1)).toBe(true); // pazartesi
    expect(inSession('0000-0100,1300-1400', 790, 3)).toBe(true);
    expect(inSession('bozuk', 790, 3)).toBe(false);
    expect(inSession('0000-0000', 5, 3)).toBe(true);
  });
  it('calendarBucket: aylık/çeyrek/yıllık takvim, haftalık Pazartesi', () => {
    const t = (s: string) => Date.parse(s) / 1000;
    expect(calendarBucket(t('2024-03-31T23:00Z'), 30 * 86400)).not.toBe(calendarBucket(t('2024-04-01T00:00Z'), 30 * 86400));
    expect(calendarBucket(t('2024-04-01T00:00Z'), 90 * 86400)).toBe(calendarBucket(t('2024-06-30T00:00Z'), 90 * 86400));
    expect(calendarBucket(t('2024-06-30T00:00Z'), 90 * 86400)).not.toBe(calendarBucket(t('2024-07-01T00:00Z'), 90 * 86400));
    expect(calendarBucket(t('2024-12-31T00:00Z'), 360 * 86400)).not.toBe(calendarBucket(t('2025-01-01T00:00Z'), 360 * 86400));
    expect(calendarBucket(t('2024-01-07T12:00Z'), 7 * 86400)).not.toBe(calendarBucket(t('2024-01-08T00:00Z'), 7 * 86400));
  });
  it('Seanslar göstergesi gün içi barlarda yalnızca seans saatlerini boyar', () => {
    const bars = walkCandles(200, 900, Date.parse('2024-01-08T00:00Z') / 1000);
    const r = executeScript(builtinById('sessions')!.code, bars, { symbol: 'TEST', timeframe: '15' });
    expect(r.ok, r.error).toBe(true);
    const asia = r.bgcolors!.find((b) => b.title === 'Asia')!;
    for (const p of asia.points) expect(new Date(p.time * 1000).getUTCHours()).toBeLessThan(9);
    expect(asia.points.length).toBe(bars.filter((c) => new Date(c.time * 1000).getUTCHours() < 9).length);
    expect(asia.points.length).toBeGreaterThan(70);
  });
});
