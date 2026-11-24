import { describe, expect, it, beforeEach } from 'vitest';
import { BUILTINS } from '../builtins';
import { BUILTIN_SCRIPT_PRESETS } from '../presets';
import { clearScriptSessions, executeScript, executeScriptSession, scriptSessionCount, sessionStats } from '../runtime';
import { walkCandles } from './walkCandles';
import type { Candle, ScriptExecutionResult } from '../../types/market';
import { BENCH_INDICATORS, BENCH_STRATEGIES } from '../../state/perfBench';

// Faz 30 — artımlı (tick) yeniden hesap: saklanan kapanmış durum çatallanıp yalnız son bar koşulur.
// Sonuç her tick ve yeni barda tam koşuyla birebir aynı olmalı (çizimler, işaretler, backtest dahil).

const strip = (r: ScriptExecutionResult) => {
  const { executionMs: _ms, ...rest } = r;
  return JSON.parse(JSON.stringify(rest, (_k, v) => (typeof v === 'number' && Number.isNaN(v) ? 'NaN' : v)));
};

function tickSeq(base: Candle[]): Candle[][] {
  // aynı bar içinde 3 tick, sonra yeni bar + 2 tick
  const n = base.length;
  const last = base[n - 1];
  const t1 = [...base.slice(0, n - 1), { ...last, close: last.close * 1.004, high: Math.max(last.high, last.close * 1.004) }];
  const t2 = [...base.slice(0, n - 1), { ...last, close: last.close * 0.995, low: Math.min(last.low, last.close * 0.995) }];
  const nb: Candle = { time: last.time + 86_400, open: t2[n - 1].close, high: t2[n - 1].close * 1.01, low: t2[n - 1].close * 0.99, close: t2[n - 1].close * 1.002, volume: 12_000 };
  const t3 = [...t2, nb];
  const t4 = [...t2, { ...nb, close: nb.close * 1.006, high: Math.max(nb.high, nb.close * 1.006), volume: 15_000 }];
  return [base, t1, t2, t3, t4];
}

const SCRIPTS: Array<{ id: string; code: string }> = [
  ...BENCH_INDICATORS.map((id) => ({ id, code: BUILTINS.find((b) => b.id === id)!.code })),
  ...BUILTIN_SCRIPT_PRESETS.map((p) => ({ id: p.id, code: p.code })),
  ...BUILTINS.filter((b) => ['zigzag', 'pivots_hl', 'auto_fib', 'candles_all', 'vp_visible', 'linreg', 'alligator', 'ichimoku'].includes(b.id)).map((b) => ({ id: b.id, code: b.code })),
];

describe('Faz 30 — artımlı Betik yeniden hesap', () => {
  beforeEach(() => clearScriptSessions());

  it.each(SCRIPTS.map((s) => [s.id, s.code]))('%s: her tickte tam koşuyla birebir', (_id, code) => {
    const seq = tickSeq(walkCandles(600));
    for (const bars of seq) {
      const inc = executeScriptSession('t', code, bars, { symbol: 'BTCUSDT', timeframe: '1D' });
      const full = executeScript(code, bars, { symbol: 'BTCUSDT', timeframe: '1D' });
      expect(inc.ok).toBe(full.ok);
      expect(strip(inc)).toEqual(strip(full));
    }
  });

  it('tick yolu gerçekten artımlı çalışır (tam koşuya düşmez) ve hızlıdır', () => {
    const before = { ...sessionStats };
    const seq = tickSeq(walkCandles(5000, 900));
    const codes = [
      ...BENCH_INDICATORS.map((id) => BUILTINS.find((b) => b.id === id)!.code),
      ...BENCH_STRATEGIES.map((id) => BUILTIN_SCRIPT_PRESETS.find((p) => p.id === id)!.code),
    ];
    for (const c of codes) executeScriptSession('p', c, seq[0], {});
    const t0 = performance.now();
    for (const c of codes) executeScriptSession('p', c, seq[1], {});
    const tickMs = performance.now() - t0;
    expect(sessionStats.incremental - before.incremental).toBe(codes.length);
    expect(sessionStats.fallback - before.fallback).toBe(0);
    // Tek iş parçacığında 22 betik, 5000 bar: tick başına yeniden hesap (tarayıcıda 4 worker'a dağılır)
    console.info(`[perf30] 22 betik × 5000 bar tick yeniden hesap (tek thread): ${tickMs.toFixed(1)} ms`);
    expect(tickMs).toBeLessThan(400);
  });
});

describe('Faz 30 — worker sonuç yaması', () => {
  it('ardışık tick sonuçları yalnız kuyrukla gönderilir ve birebir yeniden kurulur', async () => {
    const { PatchEncoder, PatchDecoder } = await import('../resultPatch');
    clearScriptSessions();
    const enc = new PatchEncoder();
    const dec = new PatchDecoder();
    const code = BUILTIN_SCRIPT_PRESETS.find((p) => p.id === 'macd_rsi_dual_trend_strategy')!.code;
    const seq = tickSeq(walkCandles(800));
    let patched = 0;
    for (const bars of seq) {
      const key = `k:${bars.length}:${bars[bars.length - 2].time}`;
      const r = executeScriptSession(key, code, bars, {});
      const wire = structuredClone(enc.encode(key, r)); // postMessage benzeri
      if (wire.patch) {
        patched++;
        const sent = wire.patch.plots.reduce((a, p) => a + p.tail.length, 0);
        expect(sent).toBeLessThanOrEqual(wire.patch.plots.length * 2);
      }
      const out = dec.decode(key, wire.result, wire.patch);
      expect(strip(out)).toEqual(strip(executeScript(code, bars, {})));
    }
    expect(patched).toBeGreaterThanOrEqual(3);
  });
});

describe('Faz 30 — oturum belleği sınırlı', () => {
  it('yeni barlar ilerledikçe betik başına tek oturum kalır (bellek birikmez)', () => {
    clearScriptSessions();
    const code = BUILTINS.find((b) => b.id === 'rsi')!.code;
    const all = walkCandles(700);
    for (let n = 500; n <= 700; n += 5) executeScriptSession('stable-key', code, all.slice(0, n), {});
    expect(scriptSessionCount()).toBe(1);
  });
});
