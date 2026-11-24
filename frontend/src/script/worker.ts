/// <reference lib="webworker" />
import type { Candle, ScriptExecutionResult } from '../types/market';
import { metricsFromBacktest, type Metrics } from '../state/optimizer';
import { LANG_NAME } from './brand';
import { executeScript, executeScriptSession } from './runtime';
import { PatchEncoder, type ResultPatch } from './resultPatch';
import type { RunOptions } from './vm';

export interface ScriptWorkerRequest {
  id: number;
  code: string;
  bars: Candle[];
  opts: RunOptions;
  /** Faz 30: verilirse artımlı oturum (kapanmış barlar saklanır, tick'te yalnız son bar) */
  sessionKey?: string;
  /** Faz 30: veri seti kimliği; worker son 6 seti tutar. `lastBar` gelirse `bars` boştur (yama). */
  datasetKey?: string;
  lastBar?: Candle;
}

const datasets = new Map<string, Candle[]>();
export interface ScriptWorkerResponse {
  id: number;
  result: ScriptExecutionResult;
  /** Faz 30: plot verisinin yalnız değişen kuyruğu (ana thread önceki sonuçla birleştirir) */
  patch?: ResultPatch;
}

const encoder = new PatchEncoder();

/** Faz 24: optimizasyon oturumu — mumlar/betik bir kez yüklenir, her değerlendirme yalnız girdi geçersiz kılmaları taşır. */
export interface OptInitMessage {
  type: 'opt-init';
  code: string;
  bars: Candle[];
  opts: RunOptions;
  stepSec: number;
}
export interface OptEvalMessage {
  type: 'opt-eval';
  id: number;
  overrides: Record<string, number>;
}
export interface OptEvalResponse {
  type: 'opt-eval';
  id: number;
  metrics: Metrics | null;
  error?: string;
}

let session: OptInitMessage | null = null;

// TitanScript yorumlayıcısı ana iş parçacığını (grafik/UI) kilitlemesin diye ayrı thread'de çalışır.
self.onmessage = (ev: MessageEvent<ScriptWorkerRequest | OptInitMessage | OptEvalMessage>) => {
  const d = ev.data;
  if ('type' in d) {
    if (d.type === 'opt-init') {
      session = d;
      return;
    }
    const s = session;
    let resp: OptEvalResponse;
    if (!s) resp = { type: 'opt-eval', id: d.id, metrics: null, error: 'oturum yok' };
    else {
      const res = executeScript(s.code, s.bars, { ...s.opts, inputOverrides: { ...(s.opts.inputOverrides ?? {}), ...d.overrides } });
      resp = res.ok && res.backtest ? { type: 'opt-eval', id: d.id, metrics: metricsFromBacktest(res.backtest, s.stepSec) } : { type: 'opt-eval', id: d.id, metrics: null, error: res.error ?? 'strateji sonucu yok' };
    }
    (self as unknown as Worker).postMessage(resp);
    return;
  }
  const { id, code, opts, sessionKey, datasetKey, lastBar } = d;
  let bars = d.bars;
  if (lastBar && datasetKey) {
    const base = datasets.get(datasetKey);
    if (!base) {
      // olmaması gerekir (istemci LRU ile eşit); güvenli tarafta hata sonucu dön, istemci tam veriyle yeniden dener
      (self as unknown as Worker).postMessage({ id, result: { ok: false, scriptTitle: LANG_NAME, isStrategy: false, isOverlay: true, plots: [], markers: [], hlines: [], executionMs: 0, error: 'veri seti yok' } } satisfies ScriptWorkerResponse);
      return;
    }
    bars = base.slice();
    bars[bars.length - 1] = lastBar;
  } else if (datasetKey) {
    datasets.set(datasetKey, bars);
    while (datasets.size > 6) datasets.delete(datasets.keys().next().value as string);
  }
  if (sessionKey) {
    const enc = encoder.encode(sessionKey, executeScriptSession(sessionKey, code, bars, opts));
    (self as unknown as Worker).postMessage({ id, result: enc.result, ...(enc.patch ? { patch: enc.patch } : {}) } satisfies ScriptWorkerResponse);
    return;
  }
  const result = executeScript(code, bars, opts);
  (self as unknown as Worker).postMessage({ id, result } satisfies ScriptWorkerResponse);
};
