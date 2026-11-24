import { beforeEach, describe, expect, it } from 'vitest';
import type { SymbolQuoteSummary } from '../../types/market';
import { favoriteRows, isFavorite, loadFavorites, saveFavorites, toggleFavorite } from '../favorites';

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  } as Storage;
});

const f = (symbol: string) => ({ symbol, displayName: symbol, market: 'BIST' as const });

describe('favorites', () => {
  it('toggles case-insensitively and keeps order', () => {
    let l = toggleFavorite([], f('thyao.is'));
    l = toggleFavorite(l, f('AAPL'));
    expect(l.map((x) => x.symbol)).toEqual(['THYAO.IS', 'AAPL']);
    expect(isFavorite(l, 'Thyao.IS')).toBe(true);
    l = toggleFavorite(l, f('THYAO.IS'));
    expect(l.map((x) => x.symbol)).toEqual(['AAPL']);
  });
  it('persists and survives corrupt storage', () => {
    saveFavorites([f('A')]);
    expect(loadFavorites()).toHaveLength(1);
    store.set('titanview_favorites_v1', '{oops');
    expect(loadFavorites()).toEqual([]);
    store.set('titanview_favorites_v1', JSON.stringify([{ symbol: 1 }, f('OK')]));
    expect(loadFavorites().map((x) => x.symbol)).toEqual(['OK']);
  });
  it('rows use live quotes when listed, saved info (no fake price) otherwise', () => {
    const live = [{ symbol: 'AAPL', displayName: 'Apple', market: 'US', lastPrice: 10, changePercent: 1 }] as unknown as SymbolQuoteSummary[];
    const rows = favoriteRows([f('AAPL'), f('ZZZ.IS')], live);
    expect(rows[0].lastPrice).toBe(10);
    expect(rows[1].lastPrice).toBeNull();
    expect(rows[1].symbol).toBe('ZZZ.IS');
  });
});

import { mergeFavorites } from '../favorites';
describe('mergeFavorites', () => {
  it('local order kept, server-only entries appended, no duplicates (case-insensitive)', () => {
    const m = mergeFavorites([f('B'), f('a')], [f('A'), f('C')]);
    expect(m.map((x) => x.symbol)).toEqual(['B', 'a', 'C']);
    expect(mergeFavorites([], [f('x')]).map((x) => x.symbol)).toEqual(['X']);
  });
});
