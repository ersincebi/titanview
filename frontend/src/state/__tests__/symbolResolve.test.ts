import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../api/client', () => ({
  fetchSymbols: vi.fn(async (_m: string, q: string) => {
    const Q = q.toUpperCase();
    if (Q === 'EUREN') return [{ symbol: 'EUREN.IS', displayName: 'Europen Endustri', market: 'BIST', lastPrice: null }];
    if (Q === 'AAPL') return [{ symbol: 'AAPL', displayName: 'Apple Inc.', market: 'US', lastPrice: 230 }];
    // sunucunun "bulunamadı" yedeği
    return [{ symbol: Q, displayName: `${Q} (US Equity)`, market: 'US', lastPrice: null }];
  }),
}));

import { fetchSymbols } from '../../api/client';
import { clearResolveCache, isBareTicker, needsResolve, pickResolution, resolveSymbol, resolvedInfo } from '../symbolResolve';

beforeEach(() => {
  clearResolveCache();
  vi.mocked(fetchSymbols).mockClear();
});

describe('bare ticker resolution (EUREN → EUREN.IS)', () => {
  it('classifies what needs a lookup', () => {
    expect(isBareTicker('EUREN')).toBe(true);
    expect(isBareTicker('EUREN.IS')).toBe(false);
    expect(isBareTicker('BTCUSDT')).toBe(false);
    expect(isBareTicker('EURUSD=X')).toBe(false);
    expect(isBareTicker('BTCUSDT/ETHUSDT')).toBe(false);
    expect(needsResolve('THYAO', [{ symbol: 'THYAO' } as never])).toBe(false);
    expect(needsResolve('euren', [])).toBe(true);
  });

  it('prefers a real exact hit, then the exchange-suffixed listing, ignores the server guess', () => {
    expect(pickResolution('EUREN', [{ symbol: 'EUREN.IS', displayName: 'X', market: 'BIST' } as never])?.symbol).toBe('EUREN.IS');
    expect(pickResolution('AAPL', [{ symbol: 'AAPL', displayName: 'Apple', market: 'US' } as never])?.symbol).toBe('AAPL');
    expect(pickResolution('ZZZZ', [{ symbol: 'ZZZZ', displayName: 'ZZZZ (US Equity)', market: 'US' } as never])).toBeNull();
  });

  it('resolves through the server once and caches', async () => {
    expect(await resolveSymbol('euren', [])).toBe('EUREN.IS');
    expect(resolvedInfo('EUREN')).toEqual({ symbol: 'EUREN.IS', displayName: 'Europen Endustri', market: 'BIST' });
    expect(await resolveSymbol('EUREN', [])).toBe('EUREN.IS');
    expect(fetchSymbols).toHaveBeenCalledTimes(1);
    expect(await resolveSymbol('AAPL', [])).toBe('AAPL');
    expect(await resolveSymbol('ZZZZ', [])).toBe('ZZZZ');
    expect(await resolveSymbol('THYAO.IS', [])).toBe('THYAO.IS');
    expect(fetchSymbols).toHaveBeenCalledTimes(3);
  });
});
