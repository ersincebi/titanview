/**
 * Yalın sembolün (ör. "EUREN") hangi borsada olduğunu bulur.
 *
 * Arama penceresinde Enter'a, "+Sembol"e ya da ☆'a yalın bir kod yazılınca sembol olduğu gibi
 * kalıyordu. Katalogda olmayan bir BIST kâğıdı da böylece ABD hissesi sanılıyor ve Yahoo'dan
 * `EUREN` (404) isteniyordu; doğrusu `EUREN.IS`. Çözüm: katalogda yoksa sunucunun sembol
 * aramasına (Yahoo araması dahil) sorup tam eşleşeni, yoksa kökü tutan ilk sonucu almak.
 */
import { fetchSymbols } from '../api/client';
import type { MarketType, SymbolQuoteSummary } from '../types/market';

export interface ResolvedSymbol {
  symbol: string;
  displayName: string;
  market: MarketType;
}

/** Ek gerektirmeyen semboller: sonekli, kripto çiftleri, döviz/vadeli, ifadeler. */
export function isBareTicker(sym: string): boolean {
  const s = sym.trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9]{1,9}$/.test(s)) return false;
  if (/(USDT|USDC|FDUSD|BUSD)$/.test(s) && s.length > 5) return false;
  return true;
}

/**
 * Arama sonuçlarından en iyi eşleşme: gerçek bir tam eşleşme (katalog ya da Yahoo araması)
 * > kökü tutan ilk sonuç (ör. EUREN → EUREN.IS) > yok. Sunucunun "bulunamadı" yedeği
 * (`X (US Equity)` adıyla dönen tahmin) gerçek eşleşme sayılmaz.
 */
export function pickResolution(raw: string, results: SymbolQuoteSummary[]): ResolvedSymbol | null {
  const q = raw.trim().toUpperCase();
  const guess = (r: SymbolQuoteSummary) => / \(US Equity\)$/.test(r.displayName ?? '');
  const as = (r: SymbolQuoteSummary): ResolvedSymbol => ({ symbol: r.symbol.toUpperCase(), displayName: r.displayName, market: r.market });
  const exact = results.find((r) => r.symbol.toUpperCase() === q && !guess(r));
  if (exact) return as(exact);
  const base = results.find((r) => r.symbol.toUpperCase() !== q && r.symbol.toUpperCase().split('.')[0] === q);
  return base ? as(base) : null;
}

const cache = new Map<string, ResolvedSymbol | null>();

/** Sunucuya sorulması gerekiyor mu? (yalın ve yüklü katalogda yok) — eşzamanlı, await gerektirmez. */
export function needsResolve(raw: string, known: SymbolQuoteSummary[]): boolean {
  const sym = raw.trim().toUpperCase();
  return !!sym && isBareTicker(sym) && !known.some((k) => k.symbol.toUpperCase() === sym);
}

/**
 * `known` (yüklü katalog) içindeyse ya da yalın değilse dokunmaz; değilse sunucuya sorar.
 * Ağ yoksa ya da bir şey bulunmazsa sembol olduğu gibi döner.
 */
export async function resolveSymbol(raw: string, known: SymbolQuoteSummary[]): Promise<string> {
  const sym = raw.trim().toUpperCase();
  if (!needsResolve(sym, known)) return sym;
  if (!cache.has(sym)) {
    try {
      cache.set(sym, pickResolution(sym, await fetchSymbols('ALL', sym)));
    } catch {
      return sym;
    }
  }
  return cache.get(sym)?.symbol ?? sym;
}

export function resolvedInfo(sym: string): ResolvedSymbol | null {
  return cache.get(sym.trim().toUpperCase()) ?? null;
}

export function clearResolveCache(): void {
  cache.clear();
}
