import { createSignal } from 'solid-js';
import type { Candle, Timeframe } from '../types/market';
import { TF_SECONDS } from './format';

/** Besleme durumu: canlı | gecikmeli (kaynak yavaş) | seans kapalı (BIST/US) | yeniden bağlanıyor | çevrimdışı. */
export type FeedState = 'live' | 'delayed' | 'closed' | 'reconnecting' | 'offline';

export interface FeedHealth {
  state: FeedState;
  lastTickAt: number; // ms
  lastBarTime: number; // sn (bar açılış zamanı)
  ageSec: number; // son tick'ten beri
}

export interface FeedInput {
  online: boolean;
  wsConnected: boolean;
  market?: string;
  interval: Timeframe;
  lastBarTime: number;
  lastTickAt: number;
  now: number; // ms
}

/** Saf karar fonksiyonu (test edilebilir). */
/** Borsanın yerel saatinde gün (0=Paz) ve dakika. */
function localClock(tz: string, nowMs: number): { dow: number; min: number } {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(nowMs));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
  return { dow, min: Number(get('hour')) * 60 + Number(get('minute')) };
}

/**
 * Seans açık mı? BIST 10:00–18:10 (İstanbul), ABD 09:30–16:00 (New York, DST dahil),
 * FX/altın Paz 17:00 – Cum 17:00 (New York). Kripto 7/24. Resmî tatiller kapsam dışı (bar yaşı yakalar).
 */
export function isSessionOpen(market: string | undefined, nowMs: number): boolean {
  if (!market || market === 'CRYPTO') return true;
  if (market === 'BIST') {
    const { dow, min } = localClock('Europe/Istanbul', nowMs);
    return dow >= 1 && dow <= 5 && min >= 600 && min < 1090;
  }
  if (market === 'US') {
    const { dow, min } = localClock('America/New_York', nowMs);
    return dow >= 1 && dow <= 5 && min >= 570 && min < 960;
  }
  if (market === 'FOREX') {
    const { dow, min } = localClock('America/New_York', nowMs);
    if (dow === 6) return false;
    if (dow === 0) return min >= 1020;
    if (dow === 5) return min < 1020;
    return true;
  }
  return true;
}

export function classifyFeed(i: FeedInput): FeedState {
  if (!i.online) return 'offline';
  if (i.market && i.market !== 'CRYPTO' && !isSessionOpen(i.market, i.now)) return 'closed';
  if (!i.wsConnected) return 'reconnecting';
  const step = TF_SECONDS[i.interval] || 900;
  const barAge = i.now / 1000 - (i.lastBarTime + step); // son barın kapanışından beri
  if (i.market && i.market !== 'CRYPTO') {
    // Hisse: son bar kapanışı 2 bar+ geride ise seans kapalı say (poll de yeni bar getirmiyor)
    return barAge > step * 2 ? 'closed' : i.now - i.lastTickAt > 90_000 ? 'delayed' : 'live';
  }
  // Kripto 7/24: son bar en fazla 1 bar geride olabilir (bar açılışı + 2 adım)
  if (barAge > step) return 'delayed';
  return i.now - i.lastTickAt > 60_000 && i.lastTickAt > 0 ? 'delayed' : 'live';
}

export const [lastTickAt, setLastTickAt] = createSignal(0);
/** Saniyede bir tazelenen saat: yaş göstergeleri bunu okur. */
export const [nowMs, setNowMs] = createSignal(Date.now());

export function markTick(_candle?: Candle): void {
  setLastTickAt(Date.now());
}

/**
 * Sunucudan gelen taze mumları listeye yerinde işler. `appended` yeni barlar (grafiğe tek tek
 * `updateLiveCandle` ile verilir: görünüm sıfırlanmaz), `changed` herhangi bir değişiklik var mı.
 */
export function mergeTail(list: Candle[], fresh: Candle[]): { list: Candle[]; appended: Candle[]; changed: boolean } {
  let changed = false;
  const appended: Candle[] = [];
  const sorted = [...fresh].sort((a, b) => a.time - b.time);
  for (const c of sorted) {
    const n = list.length;
    if (n === 0 || c.time > list[n - 1].time) {
      list.push(c);
      appended.push(c);
      changed = true;
      continue;
    }
    // aynı bar mı? (son 50 barda ara)
    for (let k = n - 1; k >= Math.max(0, n - 50); k--) {
      if (list[k].time === c.time) {
        const o = list[k];
        if (o.close !== c.close || o.high !== c.high || o.low !== c.low || o.volume !== c.volume || o.open !== c.open) {
          list[k] = c;
          changed = true;
        }
        break;
      }
      if (list[k].time < c.time) break;
    }
  }
  return { list, appended, changed };
}

/** Canlı mesaj şu an gösterilen sembol/zaman dilimine mi ait? (abonelik değişiminde eski tick'ler atılır) */
export function isTickForCurrent(msg: { symbol?: string; interval?: string }, symbol: string, interval: string): boolean {
  if (msg.symbol && msg.symbol !== symbol) return false;
  if (msg.interval && msg.interval !== interval) return false;
  return true;
}
