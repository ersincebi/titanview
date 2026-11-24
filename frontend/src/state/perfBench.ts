/**
 * Faz 30 — §13 "20 gösterge + 2 TitanScript strateji yeniden hesap" ölçümü. Uygulamanın gerçek yolunu kullanır:
 * `runScriptWorker` (Web Worker havuzu, WASM ta.* çekirdeği) + mevcut grafiğin gerçek mumları.
 * Tembel yüklenir (`import('./perfBench')`), ana pakete girmez.
 */
import { BUILTINS } from '../script/builtins';
import { BUILTIN_SCRIPT_PRESETS } from '../script/presets';
import { clearScriptCache, runScriptWorker } from '../script/scriptClient';
import type { Candle, ScriptExecutionResult } from '../types/market';
import { recordRecalc } from './perf';

/** Standart en çok kullanılan 20 hazır göstergesi. */
export const BENCH_INDICATORS = [
  'sma', 'ema', 'bb', 'rsi', 'macd', 'stoch', 'atr', 'supertrend', 'vwap', 'ichimoku',
  'psar', 'donchian', 'kc', 'cci', 'mom', 'wpr', 'obv', 'adx', 'mfi', 'stoch_rsi',
];
export const BENCH_STRATEGIES = ['supertrend_pro_strategy', 'macd_rsi_dual_trend_strategy'];

export interface RecalcResult {
  bars: number;
  scripts: number;
  wallMs: number;
  perScript: Array<{ id: string; ms: number; ok: boolean }>;
}

export async function recalcBench(bars: Candle[], label = 'full', clearCache = true): Promise<RecalcResult> {
  const codes: Array<{ id: string; code: string }> = [
    ...BENCH_INDICATORS.map((id) => {
      const b = BUILTINS.find((x) => x.id === id);
      if (!b) throw new Error(`bench: ${id} yok`);
      return { id, code: b.code };
    }),
    ...BENCH_STRATEGIES.map((id) => {
      const p = BUILTIN_SCRIPT_PRESETS.find((x) => x.id === id);
      if (!p) throw new Error(`bench: ${id} yok`);
      return { id, code: p.code };
    }),
  ];
  if (clearCache) clearScriptCache();
  const t0 = performance.now();
  const results = await Promise.all(
    codes.map(async ({ id, code }, i) => {
      const r = runScriptWorker(2 + i, code, bars, {});
      const res: ScriptExecutionResult = 'sync' in r ? r.sync : await r.async;
      return { id, ms: res.executionMs ?? 0, ok: res.ok };
    })
  );
  const wallMs = performance.now() - t0;
  recordRecalc(label, wallMs, bars.length, codes.length);
  return { bars: bars.length, scripts: codes.length, wallMs: Math.round(wallMs * 100) / 100, perScript: results };
}
