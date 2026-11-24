import { describe, expect, it } from 'vitest';
import type { Candle, Timeframe } from '../../types/market';
import {
  fetchDeepHistory,
  formatDateInput,
  magnifierTimeframe,
  mergeCandles,
  onDeepReset,
  parseDateInput,
  presetDateRange,
  resetDeepTest,
  setBtRange,
  setMagnifierOn,
  setSelectedTradeId,
  btRange,
  magnifierOn,
  selectedTradeId,
  trimRange,
  type HistoryFetcher,
} from '../deepTest';

const STEP = 3600;
const T0 = 1_600_000_000;
const mk = (i: number): Candle => ({ time: T0 + i * STEP, open: 1, high: 2, low: 0.5, close: 1.5, volume: 1 });

/** Kaynağın [firstIdx, lastIdx] aralığında veri tuttuğu sahte API; her çağrıyı kaydeder. */
function fakeApi(firstIdx: number, lastIdx: number): { fetcher: HistoryFetcher; calls: Array<[number | undefined, number | undefined]> } {
  const calls: Array<[number | undefined, number | undefined]> = [];
  const fetcher: HistoryFetcher = async (_s, _i, from, to) => {
    calls.push([from, to]);
    const lo = from === undefined ? lastIdx - 99 : Math.ceil((from - T0) / STEP);
    const hi = to === undefined ? lastIdx : Math.floor((to - T0) / STEP);
    const out: Candle[] = [];
    for (let i = Math.max(lo, firstIdx); i <= Math.min(hi, lastIdx); i++) out.push(mk(i));
    return { candles: out };
  };
  return { fetcher, calls };
}

describe('derin backtest — geçmiş çekme', () => {
  it('kaynak tükenene dek geriye doğru parça parça çeker (tüm geçmiş)', async () => {
    const api = fakeApi(0, 999);
    const prog: number[] = [];
    const r = await fetchDeepHistory({ symbol: 'X', interval: '1h', chunkBars: 100, fetcher: api.fetcher, onProgress: (p) => prog.push(p.bars) });
    expect(r.candles).toHaveLength(1000);
    expect(r.candles[0].time).toBe(T0);
    expect(r.exhausted).toBe(true);
    expect(r.capped).toBe(false);
    expect(r.chunks).toBeGreaterThanOrEqual(10);
    expect(prog[prog.length - 1]).toBe(1000);
    // sıralı + tekil
    for (let i = 1; i < r.candles.length; i++) expect(r.candles[i].time).toBeGreaterThan(r.candles[i - 1].time);
  });

  it('başlangıç tarihi (from) aşılınca durur, gereğinden eski veri çekmez', async () => {
    const api = fakeApi(0, 999);
    const r = await fetchDeepHistory({ symbol: 'X', interval: '1h', chunkBars: 100, from: T0 + 500 * STEP, fetcher: api.fetcher });
    expect(r.candles[0].time).toBeLessThanOrEqual(T0 + 500 * STEP);
    expect(r.candles[0].time).toBeGreaterThan(T0 + 380 * STEP);
    expect(r.exhausted).toBe(false);
    expect(Math.min(...api.calls.map((c) => c[0] ?? Infinity))).toBeGreaterThanOrEqual(T0 + 499 * STEP);
  });

  it('eldeki mumlardan devam eder (existing) ve yinelenen mum eklemez', async () => {
    const api = fakeApi(0, 299);
    const existing = Array.from({ length: 100 }, (_, i) => mk(200 + i));
    const r = await fetchDeepHistory({ symbol: 'X', interval: '1h', chunkBars: 100, existing, fetcher: api.fetcher });
    expect(r.candles).toHaveLength(300);
    expect(new Set(r.candles.map((c) => c.time)).size).toBe(300);
  });

  it('maxChunks sınırı: capped bayrağı', async () => {
    const api = fakeApi(0, 9999);
    const r = await fetchDeepHistory({ symbol: 'X', interval: '1h', chunkBars: 100, maxChunks: 3, fetcher: api.fetcher });
    expect(r.capped).toBe(true);
    expect(r.chunks).toBe(3);
    expect(r.candles.length).toBeLessThan(500);
  });

  it('iptal edilebilir', async () => {
    const api = fakeApi(0, 9999);
    let n = 0;
    const r = await fetchDeepHistory({ symbol: 'X', interval: '1h', chunkBars: 100, fetcher: api.fetcher, isCancelled: () => n++ > 2 });
    expect(r.chunks).toBeLessThan(6);
  });

  it('boş kaynak: tükendi', async () => {
    const r = await fetchDeepHistory({ symbol: 'X', interval: '1h', fetcher: async () => ({ candles: [] }) });
    expect(r.candles).toEqual([]);
    expect(r.exhausted).toBe(true);
  });

  it('üst sınır (to) ile alt TF verisi: son parça to ile biter', async () => {
    const api = fakeApi(0, 999);
    const r = await fetchDeepHistory({ symbol: 'X', interval: '1h', chunkBars: 50, from: T0 + 900 * STEP, to: T0 + 960 * STEP, fetcher: api.fetcher });
    expect(r.candles[r.candles.length - 1].time).toBeLessThanOrEqual(T0 + 960 * STEP);
    expect(r.candles[0].time).toBeLessThanOrEqual(T0 + 900 * STEP);
  });
});

describe('derin backtest — yardımcılar', () => {
  it('trimRange: sınırlar dahil, null açık', () => {
    const cs = Array.from({ length: 10 }, (_, i) => mk(i));
    expect(trimRange(cs, null)).toBe(cs);
    expect(trimRange(cs, { from: null, to: null })).toBe(cs);
    expect(trimRange(cs, { from: T0 + 2 * STEP, to: T0 + 4 * STEP }).map((c) => c.time)).toEqual([T0 + 2 * STEP, T0 + 3 * STEP, T0 + 4 * STEP]);
    expect(trimRange(cs, { from: T0 + 8 * STEP, to: null })).toHaveLength(2);
    expect(trimRange(cs, { from: null, to: T0 })).toHaveLength(1);
  });

  it('tarih girdisi ↔ saniye', () => {
    expect(parseDateInput('2024-01-01')).toBe(1704067200);
    expect(parseDateInput('2024-01-01', true)).toBe(1704067200 + 86399);
    expect(parseDateInput('bad')).toBeNull();
    expect(parseDateInput('2024-13-45')).toBeNull();
    expect(formatDateInput(1704067200)).toBe('2024-01-01');
    expect(formatDateInput(null)).toBe('');
  });

  it('mergeCandles: sıralı, tekil, sonraki kaynak kazanır', () => {
    const a = [mk(3), mk(1)];
    const b = [{ ...mk(1), close: 9 }, mk(2)];
    const m = mergeCandles(a, b);
    expect(m.map((c) => c.time)).toEqual([T0 + STEP, T0 + 2 * STEP, T0 + 3 * STEP]);
    expect(m[0].close).toBe(9);
  });

  it('bar büyüteci alt zaman dilimleri', () => {
    const cases: Array<[Timeframe, Timeframe | null]> = [
      ['1w', '1d'], ['1d', '1h'], ['4h', '15m'], ['1h', '5m'], ['30m', '5m'], ['15m', '1m'], ['5m', '1m'], ['3m', '1m'], ['1m', null],
    ];
    for (const [tf, sub] of cases) expect(magnifierTimeframe(tf)).toBe(sub);
  });

  it('resetDeepTest her şeyi sıfırlar ve dinleyicileri çağırır', () => {
    let called = 0;
    const off = onDeepReset(() => called++);
    setBtRange({ from: 1, to: 2 });
    setMagnifierOn(true);
    setSelectedTradeId(3);
    resetDeepTest();
    expect(btRange()).toBeNull();
    expect(magnifierOn()).toBe(false);
    expect(selectedTradeId()).toBeNull();
    expect(called).toBe(1);
    off();
  });

  it('presetDateRange hızlı tarih aralıkları', () => {
    const anchor = Date.UTC(2026, 5, 15) / 1000;
    expect(presetDateRange('ALL', anchor)).toBeNull();
    expect(presetDateRange('1M', anchor)).toEqual({ from: anchor - 30 * 86400, to: null });
    expect(presetDateRange('YTD', anchor)).toEqual({ from: Date.UTC(2026, 0, 1) / 1000, to: null });
    expect(presetDateRange('1Y', anchor)).toEqual({ from: anchor - 365 * 86400, to: null });
  });
});
