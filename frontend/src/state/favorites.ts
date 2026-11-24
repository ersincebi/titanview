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
