import type { MarketType, SymbolQuoteSummary } from '../types/market';

export interface Favorite {
  symbol: string;
  displayName: string;
  market: MarketType;
}

const KEY = 'titanview_favorites_v1';

export function toggleFavorite(list: Favorite[], item: Favorite): Favorite[] {
  const sym = item.symbol.toUpperCase();
  return list.some((f) => f.symbol.toUpperCase() === sym)
    ? list.filter((f) => f.symbol.toUpperCase() !== sym)
    : [...list, { ...item, symbol: sym }];
}

export function isFavorite(list: Favorite[], symbol: string): boolean {
  const sym = symbol.toUpperCase();
  return list.some((f) => f.symbol.toUpperCase() === sym);
}

/** Sembolün piyasası, listede yoksa sonekinden tahmin edilir. */
export function inferMarket(symbol: string): MarketType {
  const s = symbol.toUpperCase();
  if (s.endsWith('.IS')) return 'BIST';
  if (/(USDT|USDC|FDUSD|BUSD|BTC|ETH|TRY)$/.test(s) && !s.includes('.') && s.length > 5) return 'CRYPTO';
  if (s.endsWith('=X') || s.endsWith('=F') || /^(XAU|XAG)/.test(s)) return 'FOREX';
  return 'US';
}

/** Herhangi bir sembolden favori künyesi: önce yüklü sembol listesindeki bilgi, yoksa tahmin. */
export function favoriteFor(symbol: string, known: SymbolQuoteSummary[]): Favorite {
  const sym = symbol.trim().toUpperCase();
  const hit = known.find((k) => k.symbol.toUpperCase() === sym);
  return hit
    ? { symbol: sym, displayName: hit.displayName || sym, market: hit.market }
    : { symbol: sym, displayName: sym.replace(/\.IS$/, ''), market: inferMarket(sym) };
}

/** Favori listesi: güncel fiyat varsa listedeki satırdan, yoksa kayıtlı künyeden. */
export function favoriteRows(list: Favorite[], symbols: SymbolQuoteSummary[]): SymbolQuoteSummary[] {
  const bySym = new Map(symbols.map((s) => [s.symbol.toUpperCase(), s]));
  return list.map(
    (f) =>
      bySym.get(f.symbol.toUpperCase()) ??
      ({ symbol: f.symbol, displayName: f.displayName, market: f.market, lastPrice: null, changePercent: null } as unknown as SymbolQuoteSummary)
  );
}

export function loadFavorites(): Favorite[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(raw)
      ? raw.filter((f) => f && typeof f.symbol === 'string' && typeof f.displayName === 'string' && typeof f.market === 'string')
      : [];
  } catch {
    return [];
  }
}

export function saveFavorites(list: Favorite[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // depolama kapalı: oturum boyunca bellekte kalır
  }
}

/** Yerel + sunucu listesinin birleşimi (yerel sıra korunur, sunucudan gelen yeniler sona eklenir). */
export function mergeFavorites(local: Favorite[], remote: Favorite[]): Favorite[] {
  const out = [...local];
  for (const r of remote) if (!isFavorite(out, r.symbol)) out.push({ ...r, symbol: r.symbol.toUpperCase() });
  return out;
}
