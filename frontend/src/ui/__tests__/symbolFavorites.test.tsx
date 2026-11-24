// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from 'vitest';
import { favoriteFor, inferMarket } from '../../state/favorites';
import { favorites, setFavorites, toggleFavSymbol } from '../../state/store';

describe('symbol favorites from anywhere (search, top bar)', () => {
  beforeEach(() => {
    localStorage.clear();
    setFavorites([]);
  });

  it('infers the market for symbols that are not in the loaded list', () => {
    expect(inferMarket('THYAO.IS')).toBe('BIST');
    expect(inferMarket('PEPEUSDT')).toBe('CRYPTO');
    expect(inferMarket('EURUSD=X')).toBe('FOREX');
    expect(inferMarket('AAPL')).toBe('US');
    expect(favoriteFor('thyao.is', [])).toEqual({ symbol: 'THYAO.IS', displayName: 'THYAO', market: 'BIST' });
    expect(favoriteFor('btcusdt', [{ symbol: 'BTCUSDT', displayName: 'Bitcoin / Tether', market: 'CRYPTO' } as never])).toEqual({
      symbol: 'BTCUSDT',
      displayName: 'Bitcoin / Tether',
      market: 'CRYPTO',
    });
  });

  it('toggles and persists a searched crypto and BIST symbol', () => {
    toggleFavSymbol('PEPEUSDT');
    toggleFavSymbol('ASELS.IS');
    expect(favorites().map((f) => f.symbol)).toEqual(['PEPEUSDT', 'ASELS.IS']);
    expect(JSON.parse(localStorage.getItem('titanview_favorites_v1')!)).toHaveLength(2);
    toggleFavSymbol('pepeusdt');
    expect(favorites().map((f) => f.symbol)).toEqual(['ASELS.IS']);
    toggleFavSymbol('  ');
    expect(favorites()).toHaveLength(1);
  });
});
