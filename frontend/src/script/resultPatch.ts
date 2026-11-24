import type { ScriptExecutionResult } from '../types/market';

/**
 * Faz 30 — worker → ana thread sonuç yaması. Aynı oturumda (kapanmış barlar aynı) art arda gelen
 * sonuçlarda plot / OHLC plot noktalarının yalnız değişen kuyruğu gönderilir; ana thread önceki
 * sonucun önekini paylaşarak tam sonucu yeniden kurar. 22 betik × 5000 nokta tick başına yeniden
 * kopyalanmaz (tick → ekran ve yeniden hesap süresi).
 */
export interface SeriesPatch {
  from: number;
  tail: unknown[];
}
export interface ResultPatch {
  key: string;
  plots: SeriesPatch[];
  ohlc: SeriesPatch[];
}

// Betik kimliği başına tek sonuç (oturum anahtarı mumlardan bağımsız); worker ve ana thread aynı sırayla tutar
const LRU = 24;

function tailPatch(prev: unknown[], next: unknown[]): SeriesPatch {
  const m = Math.min(prev.length, next.length);
  let k = 0;
  while (k < m && prev[k] === next[k]) k++; // worker'da önek noktalar aynı nesne (çatal paylaşımı)
  return { from: k, tail: next.slice(k) };
}

/** Worker tarafı: son gönderilen sonuçlar (ana thread'deki önbellekle aynı sırada tutulur). */
export class PatchEncoder {
  private last = new Map<string, ScriptExecutionResult>();

  encode(key: string, r: ScriptExecutionResult): { result: ScriptExecutionResult; patch?: ResultPatch } {
    const prev = this.last.get(key);
    this.last.delete(key);
    if (r.ok) {
      this.last.set(key, r);
      while (this.last.size > LRU) this.last.delete(this.last.keys().next().value as string);
    }
    if (
      !prev ||
      !prev.ok ||
      !r.ok ||
      prev.plots.length !== r.plots.length ||
      (prev.ohlcPlots?.length ?? 0) !== (r.ohlcPlots?.length ?? 0)
    ) {
      return { result: r };
    }
    const plots = r.plots.map((p, i) => tailPatch(prev.plots[i].data, p.data));
    const ohlc = (r.ohlcPlots ?? []).map((p, i) => tailPatch(prev.ohlcPlots![i].data, p.data));
    return {
      result: {
        ...r,
        plots: r.plots.map((p) => ({ ...p, data: [] })),
        ...(r.ohlcPlots ? { ohlcPlots: r.ohlcPlots.map((p) => ({ ...p, data: [] })) } : {}),
      },
      patch: { key, plots, ohlc },
    };
  }
}

/** Ana thread tarafı: yamayı önceki tam sonuçla birleştirir. */
export class PatchDecoder {
  private last = new Map<string, ScriptExecutionResult>();

  decode(key: string | undefined, r: ScriptExecutionResult, patch?: ResultPatch): ScriptExecutionResult {
    let out = r;
    if (patch) {
      const prev = this.last.get(patch.key);
      if (!prev) throw new Error('betik yama tabanı yok');
      out = {
        ...r,
        plots: r.plots.map((p, i) => ({ ...p, data: prev.plots[i].data.slice(0, patch.plots[i].from).concat(patch.plots[i].tail as typeof p.data) })),
        ...(r.ohlcPlots
          ? {
              ohlcPlots: r.ohlcPlots.map((p, i) => ({
                ...p,
                data: prev.ohlcPlots![i].data.slice(0, patch.ohlc[i].from).concat(patch.ohlc[i].tail as typeof p.data),
              })),
            }
          : {}),
      };
    }
    if (key) {
      this.last.delete(key);
      if (out.ok) {
        this.last.set(key, out);
        while (this.last.size > LRU) this.last.delete(this.last.keys().next().value as string);
      }
    }
    return out;
  }
}
