/**
 * Faz 24: TitanScript VM sıcak yolu — Rust/WASM ta.* çekirdeği yükleyicisi (`wasm/titan-core`).
 * Senkron örneklenir (worker + Node'da sorunsuz); WebAssembly yoksa (goja sunucu, eski tarayıcı) ya da
 * örnekleme başarısızsa `null` döner ve TS adımlayıcılar kullanılır. Anlamlar bit-özdeştir.
 */
import { TITAN_CORE_WASM_BASE64 } from './wasm/titanCoreWasm';

export type WasmKind = 'sma' | 'ema' | 'rma' | 'wma' | 'highest' | 'lowest' | 'stdev' | 'dev' | 'linreg' | 'cci';
const KIND_ID: Record<WasmKind, number> = {
  sma: 0,
  ema: 1,
  rma: 2,
  wma: 3,
  highest: 4,
  lowest: 5,
  stdev: 6,
  dev: 7,
  linreg: 8,
  cci: 9,
};

interface Exports {
  tc_reset(): void;
  tc_new(kind: number): number;
  tc_step(h: number, v: number, len: number, extra: number): number;
  tc_count(): number;
}

export interface WasmCore {
  make(kind: WasmKind): (v: number, len: number, extra?: boolean | number) => number;
  reset(): void;
  count(): number;
}

/**
 * WebKit / JavaScriptCore (macOS WKWebView, Safari, iOS WebKit, WebKitGTK) tespit eder.
 * Apple Silicon WKWebView'de JSC JIT, JS→WASM sınırında f64 argümanlarını (v/len) bozabildiği
 * için bu motorlarda bit-özdeş TypeScript adımlayıcılarına düşülür. V8 (Chrome, WebView2,
 * Android WebView, Node, jsdom) ve SpiderMonkey (Firefox) WASM sıcak yolunu kullanır.
 */
export function isWebKitJsc(ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''): boolean {
  if (!ua || !/AppleWebKit\//i.test(ua)) return false;
  if (/iPhone|iPad|iPod/i.test(ua)) return true;
  return !/\b(?:Chrome|Chromium|jsdom)\//i.test(ua);
}

let core: WasmCore | null | undefined;
let enabled = !isWebKitJsc();
let depth = 0;

function decodeBase64(b64: string): Uint8Array {
  if (typeof atob === 'function') {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  const B = (globalThis as { Buffer?: { from(s: string, e: string): Uint8Array } }).Buffer;
  return B ? B.from(b64, 'base64') : new Uint8Array(0);
}

function load(): WasmCore | null {
  try {
    if (typeof WebAssembly === 'undefined' || !TITAN_CORE_WASM_BASE64) return null;
    const bytes = decodeBase64(TITAN_CORE_WASM_BASE64);
    if (bytes.length === 0) return null;
    const mod = new WebAssembly.Module(bytes as BufferSource);
    const ex = new WebAssembly.Instance(mod, {}).exports as unknown as Exports;
    return {
      reset: () => ex.tc_reset(),
      count: () => ex.tc_count(),
      make(kind) {
        const h = ex.tc_new(KIND_ID[kind]);
        if (kind === 'stdev') return (v, len, biased) => ex.tc_step(h, v, len, biased === false ? 0 : 1);
        if (kind === 'linreg') return (v, len, offset) => ex.tc_step(h, v, len, typeof offset === 'number' ? offset : 0);
        return (v, len) => ex.tc_step(h, v, len, 0);
      },
    };
  } catch {
    return null; // ör. ana iş parçacığında eşzamanlı derleme sınırı → TS yoluna düş
  }
}

/** WASM çekirdeği (varsa ve açıksa). */
export function getWasmCore(): WasmCore | null {
  if (!enabled) return null;
  if (core === undefined) core = load();
  return core;
}

/** Test / kıyaslama: WASM yolunu aç-kapat (kapalıyken saf TS). */
export function setWasmEnabled(on: boolean): void {
  enabled = on;
}

export function wasmEnabled(): boolean {
  return enabled && getWasmCore() !== null;
}

/** En dıştaki koşu başlarken adımlayıcı arenasını boşaltır (iç içe koşularda — kütüphane/security — dokunmaz). */
export function beginTaRun(): void {
  if (depth === 0) {
    const c = getWasmCore();
    if (c) {
      try {
        c.reset();
      } catch {
        // WASM örneği bir trap sonrası bozulduysa kapat; sonraki koşular TS yolundan sürsün
        core = null;
      }
    }
  }
  depth++;
}

export function endTaRun(): void {
  if (depth > 0) depth--;
}
