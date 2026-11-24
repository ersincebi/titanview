import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { executeScript } from '../runtime';
import { TA_FACTORIES, type TaEnv } from '../ta';
import { beginTaRun, endTaRun, getWasmCore, isWebKitJsc, setWasmEnabled, wasmEnabled } from '../wasmCore';
import type { Candle } from '../../types/market';

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const env: TaEnv = { bar: () => ({ open: 1, high: 2, low: 0.5, close: 1.5, volume: 10, time: 0, index: 0 }) };

function series(n: number, seed: number, naRate: number): number[] {
  const r = rng(seed);
  let p = 100;
  return Array.from({ length: n }, () => {
    p += (r() - 0.5) * 4;
    return r() < naRate ? NaN : p;
  });
}

function run(name: string, xs: number[], lens: number[], extra?: boolean | number): number[] {
  const st = TA_FACTORIES[name](env);
  return xs.map((v, i) => (extra === undefined ? st(v, lens[i % lens.length]) : st(v, lens[i % lens.length], extra)));
}

const same = (a: number[], b: number[]) => {
  expect(a.length).toBe(b.length);
  for (let i = 0; i < a.length; i++) {
    if (Number.isNaN(a[i])) expect(Number.isNaN(b[i]), `i=${i}`).toBe(true);
    else expect(Object.is(a[i], b[i]) || a[i] === b[i], `i=${i} ${a[i]} vs ${b[i]}`).toBe(true);
  }
};

describe('Rust/WASM ta çekirdeği (Faz 24)', () => {
  it('WASM yüklenir ve etkindir', () => {
    expect(getWasmCore()).not.toBeNull();
    expect(wasmEnabled()).toBe(true);
  });

  const names = ['sma', 'ema', 'rma', 'wma', 'highest', 'lowest', 'stdev', 'dev', 'linreg', 'cci', 'rsi', 'atr', 'hma', 'variance'];
  for (const name of names) {
    for (const [seed, naRate] of [
      [1, 0],
      [7, 0.04],
      [42, 0.3],
    ] as const) {
      it(`${name}: TS ile bit-özdeş (tohum ${seed}, NaN oranı ${naRate})`, () => {
        const xs = series(600, seed, naRate);
        const lens = [14];
        const args = name === 'atr' ? [] : lens;
        void args;
        setWasmEnabled(false);
        const ts = run(name, xs, [14]);
        setWasmEnabled(true);
        beginTaRun();
        const wa = run(name, xs, [14]);
        endTaRun();
        same(ts, wa);
      });
    }
  }

  it('uzunluk değişimi (sma/wma/stdev/highest/dev/linreg/cci) TS ile aynı davranır', () => {
    const xs = series(300, 5, 0.02);
    const lens = [5, 5, 5, 9, 9, 3, 3, 3, 3, 12];
    for (const name of ['sma', 'ema', 'rma', 'wma', 'highest', 'lowest', 'stdev', 'dev', 'linreg', 'cci']) {
      setWasmEnabled(false);
      const ts = run(name, xs, lens);
      setWasmEnabled(true);
      beginTaRun();
      const wa = run(name, xs, lens);
      endTaRun();
      same(ts, wa);
    }
  });

  it('stdev biased=false (örneklem) ve linreg offset!=0 aynı', () => {
    const xs = series(200, 9, 0);
    setWasmEnabled(false);
    const ts = run('stdev', xs, [10], false);
    const tsLr = run('linreg', xs, [12], 3);
    setWasmEnabled(true);
    beginTaRun();
    const wa = run('stdev', xs, [10], false);
    const waLr = run('linreg', xs, [12], 3);
    endTaRun();
    same(ts, wa);
    same(tsLr, waLr);
  });

  it('geçersiz uzunluk (0, kesirli altı) TS yoluna düşer ve çökmez', () => {
    beginTaRun();
    const st = TA_FACTORIES.sma(env);
    expect(() => st(1, 0)).not.toThrow();
    endTaRun();
  });

  it('en dış koşu başlarken arena boşalır, iç içe koşuda boşalmaz', () => {
    const core = getWasmCore()!;
    beginTaRun();
    TA_FACTORIES.sma(env);
    TA_FACTORIES.ema(env);
    expect(core.count()).toBeGreaterThanOrEqual(2);
    beginTaRun(); // iç içe
    expect(core.count()).toBeGreaterThanOrEqual(2);
    endTaRun();
    endTaRun();
    beginTaRun();
    expect(core.count()).toBe(0);
    endTaRun();
  });

  it('uçtan uca TitanScript: WASM açık/kapalı aynı strateji sonucu', () => {
    const r = rng(11);
    let p = 100;
    const bars: Candle[] = Array.from({ length: 2000 }, (_, i) => {
      const o = p;
      p += (r() - 0.5) * 3;
      return { time: 1_700_000_000 + i * 900, open: o, high: Math.max(o, p) + r(), low: Math.min(o, p) - r(), close: p, volume: 100 + r() * 50 };
    });
    const code = `//@version=5
strategy("x", overlay=true)
fast = ta.ema(close, 9)
slow = ta.sma(close, 30)
r = ta.rsi(close, 14)
sd = ta.stdev(close, 20)
hh = ta.highest(high, 10)
if ta.crossover(fast, slow) and r < 70
    strategy.entry("L", strategy.long)
if ta.crossunder(fast, slow)
    strategy.close("L")
plot(fast)
plot(sd + hh)`;
    setWasmEnabled(false);
    const a = executeScript(code, bars, { mintick: 0.01 });
    setWasmEnabled(true);
    const b = executeScript(code, bars, { mintick: 0.01 });
    expect(a.error).toBeUndefined();
    expect(b.error).toBeUndefined();
    expect(b.backtest!.trades).toEqual(a.backtest!.trades);
    expect(b.backtest!.netProfitCash).toBe(a.backtest!.netProfitCash);
    expect(b.plots.map((x) => x.data)).toEqual(a.plots.map((x) => x.data));
    expect(a.backtest!.totalTrades).toBeGreaterThan(5);
  });

  it('kıyas: ağır ta.* koşusu WASM ile TS’den yavaş değil (ölçüm kaydedilir)', () => {
    const xs = series(60000, 3, 0);
    const time = (on: boolean) => {
      setWasmEnabled(on);
      beginTaRun();
      const t0 = performance.now();
      for (const name of ['sma', 'wma', 'stdev', 'highest', 'rsi']) run(name, xs, [50]);
      const dt = performance.now() - t0;
      endTaRun();
      return dt;
    };
    time(true);
    time(false);
    const wasmMs = Math.min(time(true), time(true), time(true));
    const tsMs = Math.min(time(false), time(false), time(false));
    console.log(`ta bench 60k bar × 5 gösterge (uzunluk 50): TS ${tsMs.toFixed(1)} ms, WASM ${wasmMs.toFixed(1)} ms, ×${(tsMs / wasmMs).toFixed(1)}`);
    expect(wasmMs).toBeLessThan(tsMs * 1.5);
  });

  it('gömülü .wasm Rust kaynağıyla güncel (node scripts/build-wasm.mjs)', async () => {
    const mod = (await import(resolve(__dirname, '../../../../scripts/build-wasm.mjs'))) as { sourceDigest: () => string; OUT: string };
    const cur = readFileSync(mod.OUT, 'utf8');
    expect(cur.includes(`'${mod.sourceDigest()}'`), 'titanCoreWasm.ts stale: run node scripts/build-wasm.mjs').toBe(true);
  });

  it('WebKit/JavaScriptCore tespiti: macOS WKWebView/Safari/iOS/WebKitGTK true; V8/Firefox/Node/jsdom false', () => {
    // macOS Tauri WKWebView (main & worker)
    expect(isWebKitJsc('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)')).toBe(true);
    // macOS Safari
    expect(isWebKitJsc('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15')).toBe(true);
    // iOS Chrome (still WKWebView/JSC)
    expect(isWebKitJsc('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.0.0 Mobile/15E148 Safari/604.1')).toBe(true);
    // Linux WebKitGTK
    expect(isWebKitJsc('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko)')).toBe(true);
    // Blink/V8 (Chrome, Windows WebView2, Android WebView)
    expect(isWebKitJsc('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36')).toBe(false);
    expect(isWebKitJsc('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0')).toBe(false);
    expect(isWebKitJsc('Mozilla/5.0 (Linux; Android 14; sdk_gphone64_x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/113.0.5672.136 Mobile Safari/537.36')).toBe(false);
    // Firefox / Node / jsdom / empty
    expect(isWebKitJsc('Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:131.0) Gecko/20100101 Firefox/131.0')).toBe(false);
    expect(isWebKitJsc('Node.js/26')).toBe(false);
    expect(isWebKitJsc('Mozilla/5.0 (darwin) AppleWebKit/537.36 (KHTML, like Gecko) jsdom/24.1.0')).toBe(false);
    expect(isWebKitJsc('')).toBe(false);
  });

  it('WASM tc_step doğrudan geçersiz uzunluklarla (0, negatif, NaN, aşırı) çağrılsa bile çökmez', () => {
    setWasmEnabled(true);
    beginTaRun();
    const step = getWasmCore()!.make('sma');
    for (const bad of [0, -5, 0.5, NaN, Infinity, 1e15]) {
      expect(Number.isNaN(step(42, bad))).toBe(true);
    }
    expect(step(10, 1)).toBe(10);
    endTaRun();
  });
});
