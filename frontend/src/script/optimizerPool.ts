import type { Candle } from '../types/market';
import { metricsFromBacktest, type Evaluate, type Metrics } from '../state/optimizer';
import { executeScript } from './runtime';
import type { RunOptions } from './vm';
import type { OptEvalResponse } from './worker';

/**
 * Faz 24: optimizasyon değerlendirici havuzu. Web Worker varsa N işçiye (`hardwareConcurrency - 1`, en çok 6) mumlar
 * bir kez gönderilir; yoksa (test / eski tarayıcı) süreç içinde senkron koşar.
 */
export interface OptSession {
  evaluate: Evaluate;
  workers: number;
  dispose(): void;
  /** son hata (ör. betik derlenemedi) */
  lastError(): string | null;
}

export function optWorkerCount(): number {
  const hc = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 2 : 2;
  return Math.max(1, Math.min(6, hc - 1));
}

export function createOptSession(code: string, bars: Candle[], opts: RunOptions, stepSec: number, forceInline = false): OptSession {
  let err: string | null = null;
  const base = opts.inputOverrides ?? {};

  if (forceInline || typeof Worker === 'undefined') {
    return {
      workers: 0,
      lastError: () => err,
      dispose: () => undefined,
      evaluate: async (overrides) => {
        const res = executeScript(code, bars, { ...opts, inputOverrides: { ...base, ...overrides } });
        if (!res.ok || !res.backtest) {
          err = res.error ?? 'strateji sonucu yok';
          return null;
        }
        return metricsFromBacktest(res.backtest, stepSec);
      },
    };
  }

  const n = optWorkerCount();
  const ws: Worker[] = [];
  const idle: Worker[] = [];
  const waiting: Array<(w: Worker) => void> = [];
  const pending = new Map<number, (m: Metrics | null, e?: string) => void>();
  let nextId = 1;
  let broken = false;
  for (let i = 0; i < n; i++) {
    const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (ev: MessageEvent<OptEvalResponse>) => {
      const cb = pending.get(ev.data.id);
      pending.delete(ev.data.id);
      cb?.(ev.data.metrics, ev.data.error);
      const q = waiting.shift();
      if (q) q(w);
      else idle.push(w);
    };
    w.onerror = () => {
      broken = true;
      err = 'Worker hatası';
      for (const cb of pending.values()) cb(null, 'Worker hatası');
      pending.clear();
    };
    w.postMessage({ type: 'opt-init', code, bars, opts, stepSec });
    ws.push(w);
    idle.push(w);
  }
  const acquire = (): Promise<Worker> => {
    const w = idle.pop();
    return w ? Promise.resolve(w) : new Promise((res) => waiting.push(res));
  };
  return {
    workers: n,
    lastError: () => err,
    dispose: () => {
      for (const w of ws) w.terminate();
      ws.length = 0;
      idle.length = 0;
    },
    evaluate: async (overrides) => {
      if (broken) return null;
      const w = await acquire();
      return new Promise<Metrics | null>((resolve) => {
        const id = nextId++;
        pending.set(id, (m, e) => {
          if (e) err = e;
          resolve(m);
        });
        w.postMessage({ type: 'opt-eval', id, overrides });
      });
    },
  };
}
