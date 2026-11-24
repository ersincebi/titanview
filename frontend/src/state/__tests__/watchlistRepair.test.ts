import { describe, expect, it, vi } from 'vitest';

vi.mock('../../api/phase27', () => ({
  deleteNoteApi: vi.fn(),
  deleteWatchlistApi: vi.fn(),
  fetchNotesApi: vi.fn(async () => []),
  fetchWatchlistsApi: vi.fn(async () => []),
  saveNoteApi: vi.fn(),
  saveWatchlistApi: vi.fn(async (w: unknown) => w),
  setSymbolFlagApi: vi.fn(),
}));
vi.mock('../../api/client', () => ({
  fetchSymbols: vi.fn(async (_m: string, q: string) =>
    q.toUpperCase() === 'EUREN'
      ? [{ symbol: 'EUREN.IS', displayName: 'Europen', market: 'BIST', lastPrice: null }]
      : [{ symbol: q.toUpperCase(), displayName: `${q} (US Equity)`, market: 'US', lastPrice: null }],
  ),
}));

import { addSymbolToWatchlist, activeWatchlist, repairBareWatchlistSymbols, setWatchlists, watchlists } from '../watchlistStore';

describe('watchlist bare symbols', () => {
  it('repairs EUREN → EUREN.IS and resolves new bare additions', async () => {
    const wl = activeWatchlist();
    setWatchlists([{ ...wl, items: [{ type: 'symbol', symbol: 'EUREN' }, { type: 'symbol', symbol: 'THYAO.IS' }, { type: 'symbol', symbol: 'AAPL' }] }]);
    expect(await repairBareWatchlistSymbols([{ symbol: 'AAPL' } as never])).toBe(1);
    expect(watchlists()[0].items.map((i) => i.symbol)).toEqual(['EUREN.IS', 'THYAO.IS', 'AAPL']);
    setWatchlists([{ ...wl, items: [] }]);
    await addSymbolToWatchlist('euren');
    expect(watchlists()[0].items.map((i) => i.symbol)).toEqual(['EUREN.IS']);
  });
});
