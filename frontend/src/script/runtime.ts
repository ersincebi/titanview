import type { Candle, ScriptExecutionResult } from '../types/market';
import { LANG_NAME } from './brand';
import { tokenize } from './lexer';
import { parse, ScriptParseError } from './parser';
import { typeCheckProgram } from './typecheck';
import { ScriptCompileError, ScriptRuntimeError } from './values';
import { runVm, ScriptVM, collectAstAtoms, setStepperRecording, NotForkableError, type RunOptions, type VmResult } from './vm';
import { beginTaRun, endTaRun } from './wasmCore';

export { tokenize, ScriptLexer } from './lexer';
export { parse, ScriptParser, ScriptParseError } from './parser';
export { typeCheckProgram } from './typecheck';
export { buildLibraryRegistry, extractScriptRequests, scriptTimeframeToApi } from './libraries';
export { ScriptVM, runVm } from './vm';
export type { RunOptions } from './vm';
export { ScriptCompileError, ScriptRuntimeError } from './values';

/**
 * TitanScript — bar-by-bar scripting runtime.
 * Tokenizes, parses and executes indicator()/strategy() scripts over OHLCV candles.
 */
export function executeScript(
  code: string,
  candles: Candle[],
  opts: RunOptions = {}
): ScriptExecutionResult {
  const startMs = performance.now();
  const base = {
    scriptTitle: LANG_NAME,
    isStrategy: false,
    isOverlay: true,
    plots: [],
    markers: [],
    hlines: [],
  };

  if (candles.length === 0) {
    return {
      ...base,
      ok: false,
      scriptTitle: 'Boş Veri',
      executionMs: 0,
      error: 'Grafikte henüz mum verisi yok.',
    };
  }

  try {
    const program = parse(tokenize(code));
    const res = runVm(program, candles, opts);
    return wrapResult(res, startMs);
  } catch (e) {
    return errorResult(e, startMs);
  }
}

function wrapResult(res: VmResult, startMs: number): ScriptExecutionResult {
    return {
      ok: true,
      scriptTitle: res.scriptTitle,
      isStrategy: res.isStrategy,
      isOverlay: res.isOverlay,
      isLibrary: res.isLibrary,
      executionMs: Number((performance.now() - startMs).toFixed(2)),
      plots: res.plots,
      markers: res.markers,
      hlines: res.hlines,
      bgcolors: res.bgcolors,
      barcolors: res.barcolors,
      fills: res.fills,
      ohlcPlots: res.ohlcPlots,
      drawings: res.drawings,
      backtest: res.backtest,
      warnings: res.warnings,
      inputs: res.inputs,
      alerts: res.alerts,
      alertConditions: res.alertConditions,
      logs: res.logs,
      ...(res.missingSymbols ? { missingSymbols: res.missingSymbols } : {}),
      ...(res.missingLowerTfs ? { missingLowerTfs: res.missingLowerTfs } : {}),
    };
}

function errorResult(e: unknown, startMs: number): ScriptExecutionResult {
  const base = { isStrategy: false, isOverlay: true, plots: [], markers: [], hlines: [] };
    const message =
      e instanceof ScriptParseError || e instanceof ScriptCompileError || e instanceof ScriptRuntimeError
        ? e.message
        : `Beklenmeyen hata: ${e instanceof Error ? e.message : String(e)}`;
    const title =
      e instanceof ScriptParseError
        ? 'Sözdizimi Hatası'
        : e instanceof ScriptCompileError
          ? 'Derleme Hatası'
          : 'Çalışma Hatası';
    return {
      ...base,
      ok: false,
      scriptTitle: title,
      executionMs: Number((performance.now() - startMs).toFixed(2)),
      error: message,
    };
}

// ------------------------------------------------------------ Faz 30: artımlı (tick) yeniden hesap

interface ScriptSession {
  key: string;
  program: ReturnType<typeof parse>;
  atoms: Set<object>;
  committed: ScriptVM;
  n: number;
  firstTime: number;
  prevTime: number;
  prevClose: number;
}

const SESSIONS = new Map<string, ScriptSession>();
// Worker başına betik sayısı kadar (≈ 22 betik / 2–4 worker); her betik için yalnız en son oturum tutulur
const SESSION_MAX = 24;
const SESSION_MAX_BARS = 50_000;
export const sessionStats = { full: 0, incremental: 0, fallback: 0 };

/**
 * varsayılan olarak: kapanmış barlar (0..n-2) bir kez koşar ve VM durumu saklanır; aynı bar içindeki her tick'te
 * saklanan durum çatallanıp yalnız son bar koşulur. Yeni bar / farklı veri → tam koşu (oturum yenilenir).
 * Sonuç tam koşuyla birebir aynıdır (bkz. script/__tests__/incremental30.test.ts).
 */
export function executeScriptSession(
  sessionKey: string,
  code: string,
  candles: Candle[],
  opts: RunOptions = {}
): ScriptExecutionResult {
  const n = candles.length;
  // Çok uzun geçmişte (>50k bar) artımlı oturum tutulmaz: kayıt + VM durumu worker başına yüzlerce MB olur
  if (n < 2 || n > SESSION_MAX_BARS || opts.intrabarUpdates?.length) return executeScript(code, candles, opts);
  const startMs = performance.now();
  const key = `${sessionKey}|${code.length}|${hashCode(code)}`;
  const s = SESSIONS.get(key);
  let taStarted = false;
  try {
    beginTaRun();
    taStarted = true;
    setStepperRecording(true);
    if (
      s &&
      s.n === n &&
      s.firstTime === candles[0].time &&
      s.prevTime === candles[n - 2].time &&
      s.prevClose === candles[n - 2].close
    ) {
      try {
        const fork = s.committed.fork(candles, s.atoms);
        const res = fork.runLastAndFinish();
        sessionStats.incremental++;
        return wrapResult(res, startMs);
      } catch (e) {
        if (!(e instanceof NotForkableError)) throw e;
        sessionStats.fallback++;
        SESSIONS.delete(key);
        return executeScript(code, candles, opts);
      }
    }
    const program = s && s.n > 0 ? s.program : parse(tokenize(code));
    const committed = new ScriptVM(program, candles, opts);
    committed.runConfirmed(n - 1);
    const atoms = s?.program === program ? s.atoms : collectAstAtoms(program);
    let res: VmResult;
    try {
      const fork = committed.fork(candles, atoms);
      res = fork.runLastAndFinish();
      SESSIONS.delete(key);
      SESSIONS.set(key, { key, program, atoms, committed, n, firstTime: candles[0].time, prevTime: candles[n - 2].time, prevClose: candles[n - 2].close });
      while (SESSIONS.size > SESSION_MAX) SESSIONS.delete(SESSIONS.keys().next().value as string);
    } catch (e) {
      if (!(e instanceof NotForkableError)) throw e;
      sessionStats.fallback++;
      res = committed.runLastAndFinish();
    }
    sessionStats.full++;
    return wrapResult(res, startMs);
  } catch (e) {
    return errorResult(e, startMs);
  } finally {
    setStepperRecording(false);
    if (taStarted) endTaRun();
  }
}

/** Test: worker'daki canlı oturum sayısı (betik başına en fazla 1 olmalı). */
export function scriptSessionCount(): number {
  return SESSIONS.size;
}

export function clearScriptSessions(): void {
  SESSIONS.clear();
}

function hashCode(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  return h;
}

export function chartTimeframeToScript(tf: string): string {
  const s = tf.trim();
  const m = /^(\d+)([smhdwM])$/.exec(s);
  if (!m) return s;
  const n = Number(m[1]);
  const u = m[2];
  if (u === 's') return `${n}S`;
  if (u === 'm') return String(n);
  if (u === 'h') return String(n * 60);
  if (u === 'd') return n === 1 ? 'D' : `${n}D`;
  if (u === 'w') return n === 1 ? 'W' : `${n}W`;
  if (u === 'M') return n === 1 ? 'M' : `${n}M`;
  return s;
}

/** Smallest price increment implied by the data (decimals actually used, max 8). */
export function estimateMintick(candles: Candle[]): number {
  let dec = 0;
  for (const c of candles.slice(-60)) {
    for (const v of [c.open, c.high, c.low, c.close]) {
      const s = v.toFixed(8).replace(/0+$/, '');
      const d = s.includes('.') ? s.split('.')[1].length : 0;
      if (d > dec) dec = d;
    }
  }
  return 10 ** -Math.max(dec, 0) || 0.01;
}

/** Run options derived from the chart: symbol, TitanScript timeframe string and mintick. */
export function scriptRunOptions(symbol: string, interval: string, candles: Candle[]): RunOptions {
  return {
    symbol,
    timeframe: chartTimeframeToScript(interval),
    mintick: estimateMintick(candles),
  };
}
