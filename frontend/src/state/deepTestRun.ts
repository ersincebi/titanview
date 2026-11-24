import { tfmt, tt, localeTag } from './i18n';
import { batch, createSignal, untrack } from 'solid-js';
import type { BacktestTrade, Candle, Timeframe } from '../types/market';
import { scriptRunOptions } from '../script/runtime';
import { createOptSession } from '../script/optimizerPool';
import {
  IDLE_STATUS,
  btRange,
  deepStatus,
  fetchDeepHistory,
  magnifierOn,
  magnifierTimeframe,
  mergeCandles,
  onDeepReset,
  presetDateRange,
  selectedTradeId,
  setBtRange,
  setDeepStatus,
  setMagnifierCandles,
  setMagnifierOn,
  setSelectedTradeId,
  trimRange,
  type DatePreset,
  type DateRange,
} from './deepTest';
import { TF_SECONDS } from './format';
import {
  gridSize,
  optimizeGenetic,
  optimizeGrid,
  type Objective,
  type OptProgress,
  type OptResult,
  type ParamSpec,
  paramSpecsFromInputs,
} from './optimizer';
import { buildScriptOpts, candles, onScriptApplied, scriptBars, scriptInputOverrides, scriptMain, scriptResult, runScript, setCandles, setScriptInputOverrides, toast, ui } from './store';
import { rt } from './runtime';

/** Faz 24 orkestrasyon: derin backtest, bar büyüteci, işleme git, optimizasyon (store'a bağlı). */

let cancelToken = 0;
let optCancelToken = 0;
/** Süren derin yüklemeyi iptal eder. */
export function cancelDeep(): void {
  cancelToken++;
  setDeepStatus({ ...deepStatus(), phase: 'idle', message: tt("İptal edildi") });
}

const MAX_MAGNIFIER_CHUNKS = 60;

function waitApplied(): Promise<void> {
  return new Promise((resolve) => {
    const off = onScriptApplied(() => {
      off();
      resolve();
    });
    runScript();
  });
}

/** Alt TF mumlarını çeker (ana veri aralığı için) ve büyüteç önbelleğine koyar. */
async function loadMagnifier(token: number): Promise<{ tf: Timeframe | null; bars: number; covered: boolean }> {
  const tf = magnifierTimeframe(ui.interval);
  if (!tf) {
    setMagnifierCandles([]);
    return { tf: null, bars: 0, covered: false };
  }
  const bars = trimRange(candles(), btRange());
  if (bars.length === 0) return { tf, bars: 0, covered: false };
  const step = TF_SECONDS[ui.interval] || 900;
  const first = bars[0].time;
  const last = bars[bars.length - 1].time + step;
  setDeepStatus({ ...deepStatus(), phase: 'magnifier', message: tfmt("Bar büyüteci: {0} verisi alınıyor…", tf.toUpperCase()), magnifierTf: tf });
  const r = await fetchDeepHistory({
    symbol: ui.symbol,
    interval: tf,
    from: first,
    to: last,
    chunkBars: tf === '1m' ? 8000 : 5000,
    maxChunks: MAX_MAGNIFIER_CHUNKS,
    isCancelled: () => token !== cancelToken,
    onProgress: (p) => setDeepStatus({ ...deepStatus(), phase: 'magnifier', magnifierBars: p.bars, message: tfmt("Bar büyüteci: {0} · {1} mum", tf.toUpperCase(), p.bars.toLocaleString(localeTag())) }),
  });
  const sub = r.candles.filter((c) => c.time >= first && c.time < last);
  setMagnifierCandles(sub);
  return { tf, bars: sub.length, covered: sub.length > 0 && sub[0].time <= first + (TF_SECONDS[tf] || 60) * 2 };
}

export interface DeepRunOptions {
  /** tüm geçmişi (kaynak tükenene / aralık başına dek) yükle */
  deep: boolean;
}

/**
 * Derin backtest: (tarih aralığı varsa o tarihe, yoksa kaynak tükenene dek) geçmişi çeker, grafiğe ekler,
 * bar büyüteci açıksa alt TF mumlarını alır ve stratejiyi yeniden koşturur.
 */
export async function runDeepBacktest(o: DeepRunOptions = { deep: true }): Promise<void> {
  const token = ++cancelToken;
  const t0 = performance.now();
  try {
    if (o.deep) {
      const existing = candles();
      const range = btRange();
      setDeepStatus({ ...IDLE_STATUS, phase: 'history', message: tt("Geçmiş yükleniyor…"), bars: existing.length });
      const r = await fetchDeepHistory({
        symbol: ui.symbol,
        interval: ui.interval,
        from: range?.from ?? undefined,
        existing,
        chunkBars: ui.interval === '1m' ? 8000 : 5000,
        isCancelled: () => token !== cancelToken,
        onProgress: (p) => setDeepStatus({ ...deepStatus(), phase: 'history', bars: p.bars, chunks: p.chunks, oldest: p.oldest, message: tfmt("Geçmiş yükleniyor… {0} bar", p.bars.toLocaleString(localeTag())) }),
      });
      if (token !== cancelToken) return;
      const known = new Set(existing.map((c) => c.time));
      const older = r.candles.filter((c) => !known.has(c.time));
      if (older.length > 0) {
        rt.chart?.prependHistoryData(older);
        setCandles(mergeCandles(older, candles()));
      }
      setDeepStatus({ ...deepStatus(), bars: candles().length, chunks: r.chunks, oldest: candles()[0]?.time ?? 0, newest: candles()[candles().length - 1]?.time ?? 0 });
    }
    let mag = { tf: null as Timeframe | null, bars: 0, covered: false };
    if (magnifierOn()) {
      mag = await loadMagnifier(token);
      if (token !== cancelToken) return;
    } else setMagnifierCandles([]);
    setDeepStatus({ ...deepStatus(), phase: 'run', message: tt("Strateji çalıştırılıyor…") });
    await waitApplied();
    if (token !== cancelToken) return;
    const bt = scriptResult()?.backtest;
    const used = scriptBars();
    const ms = Math.round(performance.now() - t0);
    const note = magnifierOn()
      ? mag.tf
        ? mag.bars > 0
          ? tfmt(" · büyüteç {0} ({1} mum{2})", mag.tf.toUpperCase(), mag.bars.toLocaleString(localeTag()), mag.covered ? '' : tt(", kısmi kapsam"))
          : tfmt(" · büyüteç {0} verisi yok", mag.tf.toUpperCase())
        : tt(" · bu aralık için alt TF yok")
      : '';
    setDeepStatus({
      ...deepStatus(),
      phase: bt ? 'done' : 'error',
      bars: used.length,
      newest: used[used.length - 1]?.time ?? 0,
      oldest: used[0]?.time ?? 0,
      magnifierBars: mag.bars,
      message: bt
        ? tfmt("{0} bar · {1} işlem · {2} ms{3}", used.length.toLocaleString(localeTag()), bt.totalTrades, ms, note)
        : tt("Strateji sonucu yok: strategy() içeren bir betik uygulayın."),
    });
  } catch (e) {
    if (token !== cancelToken) return;
    setDeepStatus({ ...deepStatus(), phase: 'error', message: `Hata: ${e instanceof Error ? e.message : String(e)}` });
  }
}

/** Tarih aralığını uygular (eski veri gerekiyorsa derin yükler) ve yeniden koşturur. */
export async function applyDateRange(range: DateRange | null): Promise<void> {
  setBtRange(range && (range.from !== null || range.to !== null) ? range : null);
  const first = candles()[0]?.time ?? 0;
  const needOlder = range?.from != null && range.from < first;
  await runDeepBacktest({ deep: needOlder });
}

/** Hızlı tarih kısayolu (1A/3A/6A/YTD/1Y/3Y/Tümü) uygular. */
export async function applyPresetRange(preset: DatePreset): Promise<void> {
  const cs = candles();
  const anchor = cs.length > 0 ? cs[cs.length - 1].time : Math.floor(Date.now() / 1000);
  await applyDateRange(presetDateRange(preset, anchor));
}

export function toggleMagnifier(on: boolean): void {
  setMagnifierOn(on);
  if (!on) {
    setMagnifierCandles([]);
    setDeepStatus({ ...deepStatus(), message: '' });
    runScript();
    return;
  }
  if (!magnifierTimeframe(ui.interval)) {
    setMagnifierOn(false);
    toast(tfmt("Bar büyüteci {0} aralığı için kullanılamaz (alt zaman dilimi yok)", ui.interval.toUpperCase()));
    return;
  }
  void runDeepBacktest({ deep: false });
}

// ------------------------------------------------------------------ işleme git

export function focusTrade(t: BacktestTrade): boolean {
  batch(() => setSelectedTradeId(t.id));
  const ok = rt.chart?.focusRange(t.entryTime, t.exitTime) ?? false;
  if (!ok) toast(tt("Bu işlem grafikteki veri aralığının dışında: \"Tüm geçmişi yükle\" ile derin test çalıştırın"));
  return ok;
}

export function stepTrade(dir: 1 | -1): void {
  const trades = scriptResult()?.backtest?.trades ?? [];
  if (trades.length === 0) return;
  const cur = trades.findIndex((t) => t.id === selectedTradeId());
  const next = cur === -1 ? (dir === 1 ? 0 : trades.length - 1) : (cur + dir + trades.length) % trades.length;
  focusTrade(trades[next]);
}

// ------------------------------------------------------------------ optimizasyon

export type OptMethod = 'grid' | 'genetic';
export const [optSpecs, setOptSpecs] = createSignal<ParamSpec[]>([]);
export const [optMethod, setOptMethod] = createSignal<OptMethod>('genetic');
export const [optObjective, setOptObjective] = createSignal<Objective>('net');
export const [optMinTrades, setOptMinTrades] = createSignal(5);
export const [optBudget, setOptBudget] = createSignal(200);
export const [optRunning, setOptRunning] = createSignal(false);
export const [optProgress, setOptProgress] = createSignal<OptProgress | null>(null);
export const [optResults, setOptResults] = createSignal<OptResult[]>([]);
export const [optError, setOptError] = createSignal<string | null>(null);
export const [optElapsed, setOptElapsed] = createSignal(0);

/** Mevcut betiğin sayısal girdilerinden parametre listesini yeniler (kullanıcının aralık/seçimlerini korur). */
export function refreshOptSpecs(): void {
  const fresh = paramSpecsFromInputs(scriptMain()?.inputs, scriptInputOverrides());
  const old = new Map(untrack(optSpecs).map((s) => [s.key, s]));
  setOptSpecs(fresh.map((f) => (old.has(f.key) ? { ...f, ...old.get(f.key)!, current: f.current } : f)));
}

export function updateOptSpec(key: string, patch: Partial<ParamSpec>): void {
  setOptSpecs(optSpecs().map((s) => (s.key === key ? { ...s, ...patch } : s)));
}

export function optPlannedRuns(): number {
  const g = gridSize(optSpecs());
  return optMethod() === 'grid' ? Math.min(g, optBudget()) : Math.min(optBudget(), Math.max(g, 0));
}

export async function startOptimization(): Promise<void> {
  if (optRunning()) return;
  const specs = optSpecs().filter((s) => s.enabled);
  if (specs.length === 0) {
    setOptError(tt("En az bir parametre seçin."));
    return;
  }
  if (!scriptMain()?.isStrategy) {
    setOptError('Optimizasyon için strategy() içeren bir betik uygulayın.');
    return;
  }
  const token = ++optCancelToken;
  const bars = scriptBars();
  const base = scriptRunOptions(ui.symbol, ui.interval, bars);
  const opts = buildScriptOpts(bars, base);
  const session = createOptSession(ui.scriptCode, bars, opts, TF_SECONDS[ui.interval] || 900);
  setOptError(null);
  setOptResults([]);
  setOptProgress({ done: 0, total: optPlannedRuns(), best: null });
  setOptRunning(true);
  const t0 = performance.now();
  try {
    const common = {
      objective: optObjective(),
      minTrades: optMinTrades(),
      concurrency: Math.max(1, session.workers || 1),
      isCancelled: () => token !== optCancelToken,
      onProgress: (p: OptProgress) => {
        setOptProgress(p);
        setOptElapsed(performance.now() - t0);
      },
    };
    const pop = Math.max(6, Math.min(40, Math.round(Math.sqrt(optBudget()) * 1.6)));
    const gens = Math.max(2, Math.round(optBudget() / pop));
    const results =
      optMethod() === 'grid'
        ? await optimizeGrid(optSpecs(), session.evaluate, { ...common, maxRuns: optBudget() })
        : await optimizeGenetic(optSpecs(), session.evaluate, { ...common, population: pop, generations: gens });
    if (token !== optCancelToken) return;
    setOptResults(results.slice(0, 100));
    setOptElapsed(performance.now() - t0);
    if (results.length === 0) setOptError(session.lastError() ? tfmt("Koşu başarısız: {0}", session.lastError()) : tt("Sonuç yok."));
  } catch (e) {
    setOptError(e instanceof Error ? e.message : String(e));
  } finally {
    session.dispose();
    if (token === optCancelToken) setOptRunning(false);
  }
}

export function cancelOptimization(): void {
  optCancelToken++;
  setOptRunning(false);
}

onDeepReset(() => {
  cancelToken++;
  optCancelToken++;
  setOptRunning(false);
  setOptResults([]);
  setOptProgress(null);
  setOptError(null);
});

/** Bir optimizasyon sonucunu girdilere uygular ve grafikte yeniden koşturur. */
export function applyOptResult(r: OptResult): void {
  setScriptInputOverrides({ ...scriptInputOverrides(), ...r.params });
  runScript(true);
  toast(tfmt("✓ Parametreler uygulandı ({0})", Object.entries(r.params).map(([k, v]) => `${k}=${v}`).join(', ')));
}

export type { Candle };
