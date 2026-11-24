import { tt } from './i18n';
import type { BacktestReport, ScriptInputDef } from '../types/market';
import { riskStats, sideStats } from './strategyStats';

/**
 * Faz 24: parametre optimizasyonu (Varsayılan olarak yok — TitanView farkı). Izgara (grid) ve genetik algoritma;
 * değerlendirici soyut (`evaluate`) olduğundan saf mantık test edilir, gerçek koşular Web Worker havuzunda yapılır.
 */

export interface ParamSpec {
  /** girdi kimliği (id ?? title) — `inputOverrides` anahtarı */
  key: string;
  title: string;
  type: 'int' | 'float';
  min: number;
  max: number;
  step: number;
  /** girdinin mevcut/varsayılan değeri */
  current: number;
  enabled: boolean;
}

export type Objective = 'net' | 'profitFactor' | 'sharpe' | 'retDD' | 'winRate' | 'netPerDD';

export const OBJECTIVES: Array<[Objective, string]> = [
  ['net', 'Net Kâr'],
  ['profitFactor', 'Profit Factor'],
  ['sharpe', 'Sharpe'],
  ['retDD', tt("Getiri / Maks. Düşüş")],
  ['winRate', tt("Kazanma Oranı")],
  ['netPerDD', tt("Net Kâr − Maks. Düşüş")],
];

export interface Metrics {
  net: number;
  netPct: number;
  trades: number;
  winRate: number;
  profitFactor: number;
  maxDDPct: number;
  maxDDCash: number;
  sharpe: number;
  retDD: number;
}

export interface OptResult {
  params: Record<string, number>;
  score: number;
  metrics: Metrics;
}

/** Sayısal girdileri (int/float, min/max'lı ya da değerinden türetilmiş) optimizasyon parametresine çevirir. */
export function paramSpecsFromInputs(inputs: ScriptInputDef[] | undefined, overrides: Record<string, unknown> = {}): ParamSpec[] {
  const out: ParamSpec[] = [];
  for (const d of inputs ?? []) {
    if (d.type !== 'int' && d.type !== 'float') continue;
    const key = d.id ?? d.title;
    const raw = overrides[key] ?? d.value ?? d.defval;
    const cur = Number(raw);
    if (!Number.isFinite(cur)) continue;
    const isInt = d.type === 'int';
    const step = d.step && d.step > 0 ? d.step : isInt ? 1 : Math.max(0.1, +(Math.abs(cur) / 10).toPrecision(1)) || 0.1;
    let min = d.min ?? (isInt ? Math.max(1, Math.round(cur / 2)) : +(cur / 2).toPrecision(3));
    let max = d.max ?? (isInt ? Math.round(cur * 2) || 2 : +(cur * 2).toPrecision(3));
    if (d.min === undefined && d.max !== undefined) max = d.max;
    if (min > max) [min, max] = [max, min];
    if (max === min) max = min + step;
    out.push({ key, title: d.title, type: d.type, min, max, step, current: cur, enabled: false });
  }
  return out;
}

const roundTo = (v: number, step: number, min: number, type: 'int' | 'float'): number => {
  const n = Math.round((v - min) / step);
  const r = min + n * step;
  const dec = Math.max(0, Math.min(8, (String(step).split('.')[1] ?? '').length));
  return type === 'int' ? Math.round(r) : +r.toFixed(dec);
};

/** Bir parametrenin ızgara değerleri [min, max] adım `step` (üst sınır dahil, 1e-9 toleransla). */
export function gridValues(s: ParamSpec): number[] {
  const out: number[] = [];
  if (!(s.step > 0) || s.max < s.min) return [s.min];
  const n = Math.floor((s.max - s.min) / s.step + 1e-9);
  for (let i = 0; i <= n; i++) out.push(roundTo(s.min + i * s.step, s.step, s.min, s.type));
  return out;
}

export function gridSize(specs: ParamSpec[]): number {
  const on = specs.filter((s) => s.enabled);
  if (on.length === 0) return 0;
  return on.reduce((p, s) => p * gridValues(s).length, 1);
}

/** Izgaranın tüm noktaları (kartezyen çarpım); `cap` aşılırsa eşit aralıklı örneklenir. */
export function gridPoints(specs: ParamSpec[], cap = Infinity): Array<Record<string, number>> {
  const on = specs.filter((s) => s.enabled);
  if (on.length === 0) return [];
  const vals = on.map(gridValues);
  const total = vals.reduce((p, v) => p * v.length, 1);
  const pick = (idx: number): Record<string, number> => {
    const o: Record<string, number> = {};
    let rem = idx;
    for (let i = on.length - 1; i >= 0; i--) {
      o[on[i].key] = vals[i][rem % vals[i].length];
      rem = Math.floor(rem / vals[i].length);
    }
    return o;
  };
  if (total <= cap) return Array.from({ length: total }, (_, i) => pick(i));
  const n = Math.max(1, Math.floor(cap));
  const seen = new Set<number>();
  const out: Array<Record<string, number>> = [];
  for (let i = 0; i < n; i++) {
    const idx = Math.min(total - 1, Math.floor(((i + 0.5) * total) / n));
    if (seen.has(idx)) continue;
    seen.add(idx);
    out.push(pick(idx));
  }
  return out;
}

export function metricsFromBacktest(bt: BacktestReport, stepSec: number): Metrics {
  const risk = riskStats(bt, stepSec);
  const all = sideStats(bt.trades, stepSec);
  return {
    net: bt.netProfitCash,
    netPct: bt.netProfitPercent,
    trades: bt.totalTrades,
    winRate: bt.winRatePercent,
    profitFactor: bt.profitFactor,
    maxDDPct: risk.maxDrawdownPct,
    maxDDCash: risk.maxDrawdownCash,
    sharpe: risk.sharpe ?? 0,
    retDD: risk.returnOnMaxDD ?? (bt.netProfitCash > 0 ? 99.99 : 0),
  };
}

export function scoreOf(obj: Objective, m: Metrics, minTrades = 1): number {
  if (m.trades < minTrades) return -Infinity;
  switch (obj) {
    case 'net':
      return m.net;
    case 'profitFactor':
      return m.profitFactor;
    case 'sharpe':
      return m.sharpe;
    case 'retDD':
      return m.retDD;
    case 'winRate':
      return m.winRate;
    case 'netPerDD':
      return m.net - m.maxDDCash;
  }
}

export type Evaluate = (params: Record<string, number>) => Promise<Metrics | null>;

export interface OptProgress {
  done: number;
  total: number;
  best: OptResult | null;
  generation?: number;
}

export interface OptOptions {
  objective: Objective;
  minTrades?: number;
  concurrency?: number;
  onProgress?: (p: OptProgress) => void;
  isCancelled?: () => boolean;
}

const keyOf = (p: Record<string, number>): string =>
  Object.keys(p)
    .sort()
    .map((k) => `${k}=${p[k]}`)
    .join('&');

/** Eşzamanlılık sınırlı havuz: `jobs`'u sırayla başlatır, sonuçları girdi sırasıyla döndürür. */
async function pool<T, R>(items: T[], limit: number, fn: (x: T, i: number) => Promise<R>, stop?: () => boolean): Promise<Array<R | undefined>> {
  const out: Array<R | undefined> = new Array(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      if (stop?.()) return;
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return out;
}

function sortResults(rs: OptResult[]): OptResult[] {
  return rs.sort((a, b) => b.score - a.score);
}

export interface GridOptions extends OptOptions {
  maxRuns?: number;
}

export async function optimizeGrid(specs: ParamSpec[], evaluate: Evaluate, o: GridOptions): Promise<OptResult[]> {
  const points = gridPoints(specs, o.maxRuns ?? 2000);
  const results: OptResult[] = [];
  let done = 0;
  let best: OptResult | null = null;
  await pool(
    points,
    o.concurrency ?? 4,
    async (params) => {
      const m = await evaluate(params);
      done++;
      if (m) {
        const r: OptResult = { params, score: scoreOf(o.objective, m, o.minTrades), metrics: m };
        results.push(r);
        if (!best || r.score > best.score) best = r;
      }
      o.onProgress?.({ done, total: points.length, best });
    },
    o.isCancelled
  );
  return sortResults(results);
}

export interface GeneticOptions extends OptOptions {
  population?: number;
  generations?: number;
  /** gen başına mutasyon olasılığı */
  mutation?: number;
  elite?: number;
  seed?: number;
}

function rngOf(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * Genetik algoritma: ızgara ayrık değerleri üzerinde turnuva seçimi, tek biçimli çaprazlama, komşu-adım/rastgele mutasyon,
 * elitizm. Değerlendirilmiş noktalar önbelleğe alınır (aynı birey iki kez koşmaz).
 */
export async function optimizeGenetic(specs: ParamSpec[], evaluate: Evaluate, o: GeneticOptions): Promise<OptResult[]> {
  const on = specs.filter((s) => s.enabled);
  if (on.length === 0) return [];
  const vals = on.map(gridValues);
  const pop = Math.max(4, o.population ?? 16);
  const gens = Math.max(1, o.generations ?? 8);
  const pm = o.mutation ?? 0.25;
  const eliteN = Math.min(pop - 1, Math.max(1, o.elite ?? 2));
  const rnd = rngOf(o.seed ?? 12345);
  const cache = new Map<string, OptResult | null>();
  const all: OptResult[] = [];
  const total = pop * gens;
  let done = 0;
  let best: OptResult | null = null;

  type Genome = number[]; // her parametrenin ızgara indeksi
  const toParams = (g: Genome): Record<string, number> => Object.fromEntries(on.map((s, i) => [s.key, vals[i][g[i]]]));
  const randomGenome = (): Genome => vals.map((v) => Math.floor(rnd() * v.length));

  const evalGenome = async (g: Genome): Promise<OptResult | null> => {
    const params = toParams(g);
    const k = keyOf(params);
    if (cache.has(k)) return cache.get(k) ?? null;
    const m = await evaluate(params);
    const r = m ? { params, score: scoreOf(o.objective, m, o.minTrades), metrics: m } : null;
    cache.set(k, r);
    if (r) {
      all.push(r);
      if (!best || r.score > best.score) best = r;
    }
    return r;
  };

  const evalAll = async (genomes: Genome[], gen: number): Promise<Array<OptResult | null>> => {
    const uniq = new Map<string, Genome>();
    for (const g of genomes) uniq.set(keyOf(toParams(g)), g);
    await pool([...uniq.values()], o.concurrency ?? 4, async (g) => {
      await evalGenome(g);
    }, o.isCancelled);
    done += genomes.length;
    o.onProgress?.({ done: Math.min(done, total), total, best, generation: gen });
    return genomes.map((g) => cache.get(keyOf(toParams(g))) ?? null);
  };

  const fitness = (r: OptResult | null): number => (r && Number.isFinite(r.score) ? r.score : -Infinity);
  let genomes: Genome[] = Array.from({ length: pop }, randomGenome);
  // mevcut değerleri ilk topluluğa tohumla (varsa)
  genomes[0] = on.map((s, i) => {
    const idx = vals[i].findIndex((x) => x === roundTo(s.current, s.step, s.min, s.type));
    return idx >= 0 ? idx : Math.floor(vals[i].length / 2);
  });

  for (let gen = 1; gen <= gens; gen++) {
    if (o.isCancelled?.()) break;
    const res = await evalAll(genomes, gen);
    if (gen === gens) break;
    const order = genomes.map((_, i) => i).sort((a, b) => fitness(res[b]) - fitness(res[a]));
    const next: Genome[] = order.slice(0, eliteN).map((i) => [...genomes[i]]);
    const tournament = (): Genome => {
      let w = Math.floor(rnd() * pop);
      for (let k = 0; k < 2; k++) {
        const c = Math.floor(rnd() * pop);
        if (fitness(res[c]) > fitness(res[w])) w = c;
      }
      return genomes[w];
    };
    while (next.length < pop) {
      const a = tournament();
      const b = tournament();
      const child = a.map((gene, i) => (rnd() < 0.5 ? gene : b[i]));
      for (let i = 0; i < child.length; i++) {
        if (rnd() < pm) {
          const n = vals[i].length;
          child[i] = rnd() < 0.6 ? Math.max(0, Math.min(n - 1, child[i] + (rnd() < 0.5 ? -1 : 1))) : Math.floor(rnd() * n);
        }
      }
      next.push(child);
    }
    genomes = next;
  }
  return sortResults(all);
}
