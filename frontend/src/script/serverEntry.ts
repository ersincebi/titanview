/**
 * Faz 23 — sunucu alarm motoru için TitanScript giriş noktası.
 * Bu dosya esbuild ile tek IIFE paketine (`backend/internal/scriptjs/script_bundle.js`) derlenir ve Go içinde
 * goja ile çalışır: tarayıcı kapalıyken gösterge/strateji/alertcondition alarmları aynı TitanScript VM ile değerlendirilir.
 * Girdi/çıktı JSON dizesidir (goja ↔ Go sınırında tek kopya).
 */
import type { Candle } from '../types/market';
import { LANG_NAME } from './brand';
import { executeScript } from './runtime';
import { buildLibraryRegistry } from './libraries';

export interface ServerRunInput {
  code: string;
  candles: Candle[];
  symbol?: string;
  /** Betik zaman dilimi ("15", "60", "D") */
  timeframe?: string;
  mintick?: number;
  inputs?: Record<string, unknown>;
  /** kayıtlı betikler (kütüphane çözümü için) */
  scripts?: Array<{ name: string; code: string }>;
  /** başka sembol mumları (`request.security`) */
  symbolCandles?: Record<string, Candle[]>;
  /** Faz 24 bar büyüteci: strateji dolumları için alt zaman dilimi mumları */
  magnifierCandles?: Candle[];
}

export interface ServerPlot {
  id: string;
  title: string;
  /** mumlarla aynı uzunlukta, eksik = null */
  values: Array<number | null>;
}

export interface ServerRunOutput {
  ok: boolean;
  error?: string;
  title: string;
  isStrategy: boolean;
  plots: ServerPlot[];
  alerts: Array<{ time: number; message: string; kind?: string; title?: string; freq?: string }>;
  alertConditions: Array<{ title: string; message: string }>;
  fills: Array<{ time: number; action: string; qty: number; price: number; id: string; comment: string; positionSize: number }>;
  missingSymbols?: string[];
  executionMs: number;
}

export function runForServer(input: ServerRunInput): ServerRunOutput {
  const candles = input.candles ?? [];
  const res = executeScript(input.code ?? '', candles, {
    symbol: input.symbol,
    timeframe: input.timeframe,
    mintick: input.mintick,
    inputOverrides: input.inputs,
    libraries: input.scripts?.length ? buildLibraryRegistry(input.scripts) : undefined,
    symbolCandles: input.symbolCandles,
    magnifierCandles: input.magnifierCandles,
  });
  const index = new Map<number, number>();
  candles.forEach((c, i) => index.set(c.time, i));
  const plots: ServerPlot[] = (res.plots ?? []).map((p) => {
    const values: Array<number | null> = new Array(candles.length).fill(null);
    for (const pt of p.data) {
      const i = index.get(pt.time);
      if (i !== undefined && Number.isFinite(pt.value)) values[i] = pt.value;
    }
    return { id: p.id, title: p.title, values };
  });
  return {
    ok: res.ok,
    ...(res.error ? { error: res.error } : {}),
    title: res.scriptTitle,
    isStrategy: res.isStrategy,
    plots,
    alerts: res.alerts ?? [],
    alertConditions: res.alertConditions ?? [],
    fills: res.backtest?.fills ?? [],
    ...(res.missingSymbols?.length ? { missingSymbols: res.missingSymbols } : {}),
    executionMs: res.executionMs,
  };
}

/** goja tarafı: JSON dizesi alır, JSON dizesi döndürür. */
export function run(json: string): string {
  let out: ServerRunOutput;
  try {
    out = runForServer(JSON.parse(json) as ServerRunInput);
  } catch (e) {
    out = {
      ok: false,
      error: `Beklenmeyen hata: ${e instanceof Error ? e.message : String(e)}`,
      title: LANG_NAME,
      isStrategy: false,
      plots: [],
      alerts: [],
      alertConditions: [],
      fills: [],
      executionMs: 0,
    };
  }
  return JSON.stringify(out);
}
