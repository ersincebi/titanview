import { tt } from './i18n';
import { createSignal } from 'solid-js';
import { fetchHistory } from '../api/client';
import type { Candle, Timeframe } from '../types/market';
import { intervalSeconds, parseInterval } from './format';

/**
 * Faz 24: derin backtest yardımcıları — tüm geçmişi parça parça çekme, tarih aralığı, bar büyüteci için alt
 * zaman dilimi seçimi. Saf mantık + küçük sinyaller (store'a bağımlı değil; orkestrasyon `deepTestRun.ts`).
 */

export interface DateRange {
  /** saniye (dahil); null = başlangıç yok */
  from: number | null;
  /** saniye (dahil); null = son bar */
  to: number | null;
}

export const [btRange, setBtRange] = createSignal<DateRange | null>(null);
export const [magnifierOn, setMagnifierOn] = createSignal(false);
export const [magnifierCandles, setMagnifierCandles] = createSignal<Candle[]>([]);
export const [tradeLines, setTradeLines] = createSignal(true);
export const [tradeLabels, setTradeLabels] = createSignal(true);
export const [selectedTradeId, setSelectedTradeId] = createSignal<number | null>(null);

const resetHooks = new Set<() => void>();
export function onDeepReset(fn: () => void): () => void {
  resetHooks.add(fn);
  return () => resetHooks.delete(fn);
}

/** Sembol/aralık değişince derin test durumunu sıfırlar (tarih aralığı, büyüteç, seçili işlem). */
export function resetDeepTest(): void {
  setBtRange(null);
  setMagnifierOn(false);
  setMagnifierCandles([]);
  setSelectedTradeId(null);
  setDeepStatus(IDLE_STATUS);
  for (const h of resetHooks) h();
}

export type DatePreset = 'ALL' | '1M' | '3M' | '6M' | 'YTD' | '1Y' | '3Y';

export const DATE_PRESETS: Array<[DatePreset, string]> = [
  ['ALL', tt("Tümü")],
  ['1M', '1A'],
  ['3M', '3A'],
  ['6M', '6A'],
  ['YTD', 'YTD'],
  ['1Y', '1Y'],
  ['3Y', '3Y'],
];

/** Hızlı tarih aralığı kısayolu (anchorSec = son mum zamanı veya şimdi, saniye). */
export function presetDateRange(preset: DatePreset, anchorSec: number): DateRange | null {
  if (preset === 'ALL') return null;
  const d = new Date(anchorSec * 1000);
  if (preset === 'YTD') {
    const from = Math.floor(Date.UTC(d.getUTCFullYear(), 0, 1) / 1000);
    return { from, to: null };
  }
  const days: Record<Exclude<DatePreset, 'ALL' | 'YTD'>, number> = { '1M': 30, '3M': 90, '6M': 180, '1Y': 365, '3Y': 1095 };
  return { from: anchorSec - days[preset] * 86400, to: null };
}

export interface DeepStatus {
  phase: 'idle' | 'history' | 'magnifier' | 'run' | 'done' | 'error';
  message: string;
  bars: number;
  chunks: number;
  oldest: number;
  newest: number;
  magnifierBars: number;
  magnifierTf: Timeframe | null;
}

export const IDLE_STATUS: DeepStatus = { phase: 'idle', message: '', bars: 0, chunks: 0, oldest: 0, newest: 0, magnifierBars: 0, magnifierTf: null };
export const [deepStatus, setDeepStatus] = createSignal<DeepStatus>(IDLE_STATUS);

/** Bar büyüteci için alt zaman dilimi (varsayılan: grafik aralığından küçük, makul sayıda alt mum). */
const MAGNIFIER_TF: Record<string, Timeframe> = {
  '12M': '1w',
  '6M': '1d',
  '3M': '1d',
  '1M': '1d',
  '1w': '1d',
  '3d': '4h',
  '2d': '1h',
  '1d': '1h',
  '12h': '1h',
  '8h': '30m',
  '6h': '30m',
  '4h': '15m',
  '3h': '15m',
  '2h': '15m',
  '1h': '5m',
  '45m': '5m',
  '30m': '5m',
  '15m': '1m',
  '5m': '1m',
  '3m': '1m',
};

export function magnifierTimeframe(interval: Timeframe): Timeframe | null {
  if (interval in MAGNIFIER_TF) return MAGNIFIER_TF[interval];
  const p = parseInterval(interval);
  if (!p) return null;
  if (p.unit === 'M') return '1d';
  if (p.unit === 'w') return '1d';
  if (p.unit === 'd' && p.n > 1) return '1h';
  if (p.unit === 'h' && p.n > 1) return '15m';
  if (p.unit === 'm' && p.n > 1) return '1m';
  return null;
}

/** Aralığı [from,to] (saniye) ile kes; sınır null ise açık. */
export function trimRange(candles: Candle[], range: DateRange | null): Candle[] {
  if (!range || (range.from === null && range.to === null)) return candles;
  return candles.filter((c) => (range.from === null || c.time >= range.from) && (range.to === null || c.time <= range.to));
}

/** Tarih girdisi (yyyy-mm-dd) → saniye (UTC gün başı / sonu); geçersizse null. */
export function parseDateInput(v: string, endOfDay = false): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const ms = Date.parse(`${v}T${endOfDay ? '23:59:59' : '00:00:00'}Z`);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

export function formatDateInput(sec: number | null): string {
  return sec === null ? '' : new Date(sec * 1000).toISOString().slice(0, 10);
}

/** Sıralı + tekilleştirilmiş birleşim (aynı zamanda sonraki kaynak kazanır). */
export function mergeCandles(...lists: Candle[][]): Candle[] {
  const m = new Map<number, Candle>();
  for (const l of lists) for (const c of l) m.set(c.time, c);
  return [...m.values()].sort((a, b) => a.time - b.time);
}

export type HistoryFetcher = (symbol: string, interval: Timeframe, from?: number, to?: number) => Promise<{ candles?: Candle[] }>;

export interface DeepFetchOptions {
  symbol: string;
  interval: Timeframe;
  /** bu zamandan (sn) eskiye inme; undefined = kaynak tükenene dek */
  from?: number;
  /** başlangıçta eldeki mumlar (en eskiden geriye doğru devam edilir) */
  existing?: Candle[];
  /** üst sınır (sn) — alt TF için ana verinin sonu */
  to?: number;
  chunkBars?: number;
  maxChunks?: number;
  fetcher?: HistoryFetcher;
  onProgress?: (p: { bars: number; chunks: number; oldest: number }) => void;
  isCancelled?: () => boolean;
}

export interface DeepFetchResult {
  candles: Candle[];
  chunks: number;
  /** kaynak daha eski veri vermedi (tarih başı bulundu) */
  exhausted: boolean;
  /** maxChunks nedeniyle durdu */
  capped: boolean;
}

/**
 * Tüm geçmişi geriye doğru parça parça çeker (her parça `chunkBars` bar). `existing` yoksa son parçadan başlar.
 * Kaynak yeni mum vermeyince (`exhausted`) ya da `from` aşılınca durur. Aynı mumlar tekilleştirilir.
 */
export async function fetchDeepHistory(o: DeepFetchOptions): Promise<DeepFetchResult> {
  const step = intervalSeconds(o.interval) || 900;
  const chunkBars = o.chunkBars ?? 5000;
  const maxChunks = o.maxChunks ?? 400;
  const fetcher: HistoryFetcher = o.fetcher ?? ((s, i, f, t) => fetchHistory(s, i, f, t));
  let all = mergeCandles(o.existing ?? []);
  let chunks = 0;
  let exhausted = false;
  let capped = false;

  if (all.length === 0) {
    const r = await fetcher(o.symbol, o.interval, o.to ? o.to - chunkBars * step : undefined, o.to);
    all = mergeCandles(r.candles ?? []);
    chunks++;
    o.onProgress?.({ bars: all.length, chunks, oldest: all[0]?.time ?? 0 });
    if (all.length === 0) return { candles: all, chunks, exhausted: true, capped: false };
  }
  while (true) {
    if (o.isCancelled?.()) break;
    const oldest = all[0].time;
    if (o.from !== undefined && oldest <= o.from) break;
    if (chunks >= maxChunks) {
      capped = true;
      break;
    }
    let start = oldest - chunkBars * step;
    if (o.from !== undefined) start = Math.max(start, o.from - step);
    const r = await fetcher(o.symbol, o.interval, start, oldest);
    chunks++;
    const known = new Set(all.map((c) => c.time));
    const fresh = (r.candles ?? []).filter((c) => !known.has(c.time) && c.time < oldest);
    if (fresh.length === 0) {
      exhausted = true;
      break;
    }
    all = mergeCandles(fresh, all);
    o.onProgress?.({ bars: all.length, chunks, oldest: all[0].time });
  }
  return { candles: all, chunks, exhausted, capped };
}
