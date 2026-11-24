import type { Candle, ScriptExecutionResult } from '../types/market';
import { executeScriptSession } from './runtime';
import type { RunOptions } from './vm';
import type { ScriptWorkerRequest, ScriptWorkerResponse } from './worker';
import { PatchDecoder } from './resultPatch';

// Faz 30: ana + ikinci betik + göstergeler paralel; çekirdek sayısına göre 2–4 worker (oturum yakınlığı: index % SLOTS sabit)
const SLOTS =
  typeof navigator !== 'undefined' && typeof navigator.hardwareConcurrency === 'number'
    ? Math.max(2, Math.min(4, navigator.hardwareConcurrency - 1))
    : 2;
const CACHE_MAX = 12;

type Pending = {
  cb: (r: ScriptExecutionResult) => void;
  key?: string;
  slotIndex: number;
  fallback: () => ScriptExecutionResult;
};
const decoders: PatchDecoder[] = [];
const workers: (Worker | null)[] = [];
/** Faz 30: her worker'a gönderilmiş veri setleri (kapanmış bar parmak izi) — tick'te yalnız son bar gider. */
const sentDatasets: Array<string[]> = [];
const pending = new Map<number, Pending>();
let nextId = 1;
let workerBroken = false;

const cache = new Map<string, ScriptExecutionResult>();

export const workerSupported = (): boolean => typeof Worker !== 'undefined' && !workerBroken;

function slot(i: number): Worker | null {
  if (!workerSupported()) return null;
  if (workers[i]) return workers[i];
  try {
    const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    const dec = (decoders[i] ??= new PatchDecoder());
    w.onmessage = (ev: MessageEvent<ScriptWorkerResponse>) => {
      const p = pending.get(ev.data.id);
      if (p) {
        pending.delete(ev.data.id);
        try {
          p.cb(dec.decode(p.key, ev.data.result, ev.data.patch));
        } catch {
          p.cb(p.fallback());
        }
      }
    };
    w.onerror = () => {
      workerBroken = true; // worker açılamadı/çöktü: senkron yola düş ve bekleyen istekleri kurtar
      workers[i] = null;
      sentDatasets[i] = [];
      for (const [pid, p] of [...pending]) {
        if (p.slotIndex !== i) continue;
        pending.delete(pid);
        p.cb(p.fallback());
      }
    };
    workers[i] = w;
    return w;
  } catch {
    workerBroken = true;
    return null;
  }
}

/** Betik + veri parmak izi: aynı sembol/zaman dilimi/mumlar/kod/girdi/kütüphane için sonuç yeniden kullanılır. */
export function scriptCacheKey(code: string, bars: Candle[], opts: RunOptions): string {
  const n = bars.length;
  const first = n ? bars[0].time : 0;
  const last = n ? bars[n - 1] : null;
  const extra = [
    opts.inputOverrides ? JSON.stringify(opts.inputOverrides) : '',
    opts.libraries ? Object.entries(opts.libraries).map(([k, v]) => `${k}:${hash(v)}`).sort().join(',') : '',
    opts.lowerTfCandles ? Object.entries(opts.lowerTfCandles).map(([k, v]) => `${k}:${v.length}`).sort().join(',') : '',
    opts.magnifierCandles ? `mag:${opts.magnifierCandles.length}:${opts.magnifierCandles.length ? opts.magnifierCandles[0].time + ':' + opts.magnifierCandles[opts.magnifierCandles.length - 1].time : 0}` : '',
    opts.corporateEvents ? Object.keys(opts.corporateEvents).sort().join(',') : '',
    opts.currencyRates ? Object.keys(opts.currencyRates).sort().join(',') : '',
    opts.externalSources
      ? Object.entries(opts.externalSources)
          .map(([k, v]) => `${k}:${v.length}:${hash(v.join(','))}`)
          .sort()
          .join(',')
      : '',
    opts.symbolCandles
      ? Object.entries(opts.symbolCandles)
          .map(([k, v]) => `${k}:${v.length}:${v.length ? v[v.length - 1].time : 0}:${v.length ? v[v.length - 1].close : 0}`)
          .sort()
          .join(',')
      : '',
  ].join('#');
  return [
    opts.symbol, opts.timeframe, n, first, last?.time, last?.close, opts.mintick, code.length, hash(code), hash(extra),
  ].join('|');
}

const hashMemo = new Map<string, number>();
function hash(s: string): number {
  // Faz 30: büyük betik kodları her tick'te yeniden özetlenmesin (~30 KB)
  if (s.length > 256) {
    const m = hashMemo.get(s);
    if (m !== undefined) return m;
    const h = hashRaw(s);
    if (hashMemo.size > 128) hashMemo.clear();
    hashMemo.set(s, h);
    return h;
  }
  return hashRaw(s);
}
function hashRaw(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return h;
}

export function cachedScript(key: string): ScriptExecutionResult | undefined {
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit); // LRU
  }
  return hit;
}

function remember(key: string, r: ScriptExecutionResult): void {
  if (!r.ok) return;
  cache.set(key, r);
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string);
}

export function clearScriptCache(): void {
  cache.clear();
}

/** Worker varsa asenkron, yoksa (test/eski tarayıcı) senkron çalıştırır. */
export function runScriptWorker(
  index: number,
  code: string,
  bars: Candle[],
  opts: RunOptions
): { sync: ScriptExecutionResult } | { async: Promise<ScriptExecutionResult> } {
  const key = scriptCacheKey(code, bars, opts);
  const hit = cachedScript(key);
  if (hit) return { sync: hit };
  // Faz 30: betik kimliği (kod + girdiler + sembol/aralık; mumlardan bağımsız). Worker betik başına TEK oturum
  // tutar ve kapanmış barların aynı olduğunu kendisi doğrular; aynı bar içindeki tick'lerde yalnız son barı hesaplar.
  // (Anahtar her yeni barda değişseydi 100k barlık VM durumları LRU'da birikip GB'larca bellek tutuyordu.)
  const sessionKey = scriptCacheKey(code, [], opts);
  const slotIndex = index % SLOTS;
  const w = slot(slotIndex);
  if (!w) {
    const r = executeScriptSession(sessionKey, code, bars, opts);
    remember(key, r);
    return { sync: r };
  }
  const id = nextId++;
  const p = new Promise<ScriptExecutionResult>((resolve) => {
    pending.set(id, {
      key: sessionKey,
      slotIndex,
      fallback: () => executeScriptSession(sessionKey, code, bars, opts),
      cb: (r) => {
        remember(key, r);
        resolve(r);
      },
    });
    const datasetKey = bars.length > 1 ? `${bars[0].time}:${bars.length}:${bars[bars.length - 2].time}:${bars[bars.length - 2].close}` : '';
    const sent = (sentDatasets[slotIndex] ??= []);
    if (datasetKey && sent.includes(datasetKey)) {
      w.postMessage({ id, code, bars: [], lastBar: bars[bars.length - 1], datasetKey, opts, sessionKey } satisfies ScriptWorkerRequest);
    } else {
      w.postMessage({ id, code, bars, datasetKey, opts, sessionKey } satisfies ScriptWorkerRequest);
      if (datasetKey) {
        sent.push(datasetKey);
        if (sent.length > 6) sent.shift();
      }
    }
  });
  return { async: p };
}
