// @vitest-environment jsdom
import { describe, expect, it, beforeEach, vi } from 'vitest';
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

describe('repairing favorites added as bare codes', () => {
  it('moves EUREN (wrongly US) to EUREN.IS (BIST) and leaves catalog symbols alone', async () => {
    const client = await import('../../api/client');
    const spy = vi.spyOn(client, 'fetchSymbols').mockImplementation(async (_m, q) =>
      String(q).toUpperCase() === 'EUREN'
        ? ([{ symbol: 'EUREN.IS', displayName: 'Europen Endustri', market: 'BIST', lastPrice: null }] as never)
        : ([{ symbol: String(q).toUpperCase(), displayName: `${q} (US Equity)`, market: 'US', lastPrice: null }] as never),
    );
    const { repairBareFavorites } = await import('../../state/store');
    const { clearResolveCache } = await import('../../state/symbolResolve');
    clearResolveCache();
    setFavorites([
      { symbol: 'EUREN', displayName: 'EUREN', market: 'US' },
      { symbol: 'PGSUS.IS', displayName: 'Pegasus', market: 'BIST' },
      { symbol: 'ZZZZ', displayName: 'ZZZZ', market: 'US' },
    ]);
    expect(await repairBareFavorites()).toBe(1);
    expect(favorites()).toEqual([
      { symbol: 'EUREN.IS', displayName: 'Europen Endustri', market: 'BIST' },
      { symbol: 'PGSUS.IS', displayName: 'Pegasus', market: 'BIST' },
      { symbol: 'ZZZZ', displayName: 'ZZZZ', market: 'US' },
    ]);
    spy.mockRestore();
  });
});
