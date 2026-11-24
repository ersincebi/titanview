import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearSymbolDrawings,
  deleteDrawingById,
  deleteSavedScript,
  fetchCacheStats,
  fetchCorporateEvents,
  fetchCorrelation,
  fetchDrawings,
  fetchFxRates,
  fetchHistory,
  fetchNews,
  fetchOverview,
  fetchSavedScripts,
  fetchScreener,
  fetchSecurity,
  fetchInsights,
  fetchSetting,
  saveSetting,
  fetchIdeas,
  fetchSymbols,
  persistDrawing,
  saveCustomScript,
  syncCollectSymbols,
} from '../client';

const fx = vi.fn();
const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as Response;
const fail = (status: number, body?: unknown) =>
  ({ ok: false, status, json: async () => { if (body === undefined) throw new Error('not json'); return body; } }) as Response;

beforeEach(() => {
  fx.mockReset();
  vi.stubGlobal('fetch', fx);
});
afterEach(() => vi.unstubAllGlobals());

const lastUrl = () => String(fx.mock.calls[fx.mock.calls.length - 1][0]);

describe('api/client', () => {
  it('fetchHistory builds the query, floors from/to, drops non-positive bounds', async () => {
    fx.mockResolvedValue(ok({ candles: [] }));
    await fetchHistory('THYAO.IS', '1h', 1000.9, 2000.2);
    expect(lastUrl()).toBe('/api/history?symbol=THYAO.IS&interval=1h&from=1000&to=2000');
    await fetchHistory('BTCUSDT', '15m', 0, -5);
    expect(lastUrl()).toBe('/api/history?symbol=BTCUSDT&interval=15m');
  });

  it('network failure becomes an actionable message instead of "Failed to fetch"', async () => {
    fx.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(fetchHistory('X', '15m')).rejects.toThrow(/Sunucuya ulaşılamıyor.*make start/);
    await expect(fetchNews(null)).rejects.toThrow(/Sunucuya ulaşılamıyor/);
  });

  it('fetchHistory throws with the HTTP status (UI shows it, never fakes data)', async () => {
    fx.mockResolvedValue(fail(502));
    await expect(fetchHistory('X', '15m')).rejects.toThrow('History API error: 502');
  });

  it('list endpoints degrade to empty on error and unwrap their envelope on success', async () => {
    fx.mockResolvedValue(fail(500));
    expect(await fetchSymbols()).toEqual([]);
    expect(await fetchScreener()).toEqual([]);
    expect(await fetchSavedScripts()).toEqual([]);
    expect(await fetchDrawings('X')).toEqual([]);
    expect(await fetchCacheStats()).toEqual({ totalCandles: 0, totalSymbols: 0, savedScripts: 0, savedDrawings: 0 });
    fx.mockResolvedValue(ok({}));
    expect(await fetchSymbols('BIST', '  thy ')).toEqual([]);
    expect(lastUrl()).toBe('/api/symbols?market=BIST&q=thy');
    fx.mockResolvedValue(ok({ symbols: [{ symbol: 'A' }], rows: [{ symbol: 'R' }], scripts: [{ id: 's' }] }));
    expect(await fetchSymbols()).toEqual([{ symbol: 'A' }]);
    expect(lastUrl()).toBe('/api/symbols?market=ALL');
    expect(await fetchScreener('US')).toEqual([{ symbol: 'R' }]);
    expect(await fetchSavedScripts()).toEqual([{ id: 's' }]);
  });

  it('saveCustomScript posts JSON and returns null on failure', async () => {
    fx.mockResolvedValue(ok({ id: 'n', name: 'N' }));
    const r = await saveCustomScript({ name: 'N', code: 'c', isOverlay: true });
    expect(r).toEqual({ id: 'n', name: 'N' });
    const [url, init] = fx.mock.calls[0];
    expect(url).toBe('/api/scripts');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ name: 'N', code: 'c', isOverlay: true });
    fx.mockResolvedValue(fail(500));
    expect(await saveCustomScript({ name: 'N', code: 'c', isOverlay: false })).toBeNull();
  });

  it('drawings round-trip: persist serialises points+style, fetch restores them and skips corrupt rows', async () => {
    fx.mockResolvedValue(ok({}));
    await persistDrawing({
      id: 'd1', symbol: 'X', timeframe: '1h', toolType: 'fib_ext',
      points: [{ time: 1, price: 2 }], color: '#fff', width: 3, lineStyle: 'dashed', locked: true, label: 'L',
    });
    const body = JSON.parse(fx.mock.calls[0][1].body);
    expect(body.toolType).toBe('fib_ext');
    expect(JSON.parse(body.pointsJson)).toEqual([{ time: 1, price: 2 }]);

    fx.mockResolvedValue(ok({
      drawings: [
        { id: 'd1', symbol: 'X', timeframe: '1h', toolType: 'fib_ext', pointsJson: body.pointsJson, styleJson: body.styleJson },
        { id: 'bad', symbol: 'X', timeframe: '1h', toolType: 'trendline', pointsJson: '{oops', styleJson: '{}' },
        { id: 'd2', symbol: 'X', timeframe: '1h', toolType: 'hline', pointsJson: '[]', styleJson: '' },
      ],
    }));
    const out = await fetchDrawings('X Y');
    expect(lastUrl()).toBe('/api/drawings?symbol=X%20Y');
    expect(out.map((d) => d.id)).toEqual(['d1', 'd2']);
    expect(out[0]).toMatchObject({ color: '#fff', width: 3, lineStyle: 'dashed', locked: true, label: 'L' });
    expect(out[1].color).toBe('#0284C7'); // default when style is empty
    expect('width' in out[1]).toBe(false);
  });

  it('syncCollectSymbols PUTs the favourites list and surfaces failures', async () => {
    fx.mockResolvedValue(ok({ symbols: ['A'] }));
    expect(await syncCollectSymbols(['a'])).toEqual(['A']);
    const [url, init] = fx.mock.calls[0];
    expect(url).toBe('/api/collect');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body)).toEqual({ symbols: ['a'] });
    fx.mockResolvedValue(fail(500));
    await expect(syncCollectSymbols([])).rejects.toThrow('Toplama listesi: 500');
  });

  it('insights + ideas: URL kodlama, boş satır toleransı, okunur hata', async () => {
    fx.mockResolvedValue(ok({ info: {}, insights: { score: 1 } }));
    await fetchInsights('BRK-B');
    expect(lastUrl()).toBe('/api/insights?symbol=BRK-B');
    fx.mockResolvedValue(ok({}));
    expect(await fetchIdeas('BIST')).toEqual([]);
    expect(lastUrl()).toBe('/api/ideas?market=BIST');
    fx.mockResolvedValue(fail(502, { error: 'not enough daily history' }));
    await expect(fetchInsights('X')).rejects.toThrow('İçgörü: 502 not enough daily history');
    fx.mockResolvedValue(fail(500));
    await expect(fetchIdeas()).rejects.toThrow('Fikirler: 500');
  });

  it('ayarlar: 404 = yok (null), değer okunur, yazma gövdeyi PUT eder, hata fırlatır', async () => {
    fx.mockResolvedValue(fail(404, { error: 'setting not set' }));
    expect(await fetchSetting('workspace')).toBeNull();
    fx.mockResolvedValue(ok({ value: { symbol: 'AAPL' } }));
    expect(await fetchSetting('workspace')).toEqual({ symbol: 'AAPL' });
    expect(lastUrl()).toBe('/api/settings?key=workspace');
    fx.mockResolvedValue(fail(500));
    await expect(fetchSetting('workspace')).rejects.toThrow('500');
    fx.mockResolvedValue(ok({}));
    await saveSetting('workspace', { a: 1 }, true);
    const init = fx.mock.calls[fx.mock.calls.length - 1][1] as RequestInit;
    expect(init.method).toBe('PUT');
    expect(init.body).toBe('{"a":1}');
    expect(init.keepalive).toBe(true);
    fx.mockResolvedValue(fail(413));
    await expect(saveSetting('workspace', {})).rejects.toThrow('413');
  });

  it('delete helpers hit the right verbs and encode ids', async () => {
    fx.mockResolvedValue(ok({}));
    await clearSymbolDrawings('A B');
    expect(fx.mock.calls[0]).toEqual(['/api/drawings?symbol=A%20B', { method: 'DELETE' }]);
    await deleteDrawingById('a/b');
    expect(fx.mock.calls[1]).toEqual(['/api/drawings?id=a%2Fb', { method: 'DELETE' }]);
  });

  it('terminal endpoints throw readable errors with server detail, tolerate non-JSON bodies', async () => {
    fx.mockResolvedValue(fail(502, { error: 'upstream down' }));
    await expect(fetchSecurity('AAPL')).rejects.toThrow('Künye: 502 upstream down');
    fx.mockResolvedValue(fail(500));
    await expect(fetchOverview()).rejects.toThrow('Piyasa özeti: 500');
    await expect(fetchCorrelation(['A', 'B'])).rejects.toThrow('Korelasyon: 500');
    fx.mockResolvedValue(ok({ items: [{ title: 'T' }] }));
    expect(await fetchNews('THYAO.IS', 5)).toEqual([{ title: 'T' }]);
    expect(lastUrl()).toBe('/api/news?limit=5&symbol=THYAO.IS');
    expect(await fetchNews(null)).toEqual([{ title: 'T' }]);
    expect(lastUrl()).toBe('/api/news?limit=12');
    fx.mockResolvedValue(ok({}));
    expect(await fetchNews(null)).toEqual([]);
    expect(await fetchOverview('BIST')).toEqual([]);
    expect(lastUrl()).toBe('/api/overview?market=BIST');
    await fetchCorrelation(['A', 'B'], 90);
    expect(lastUrl()).toBe('/api/correlation?symbols=A%2CB&days=90');
  });

  it('fetchCorporateEvents, fetchFxRates & deleteSavedScript encode params and degrade honestly on HTTP failure', async () => {
    fx.mockResolvedValueOnce(ok({ symbol: 'AAPL', supported: true, dividends: [{ time: 100, amount: 0.25 }], splits: [], earnings: [] }));
    const ev = await fetchCorporateEvents('AAPL', 1000, 2000);
    expect(lastUrl()).toBe('/api/events?symbol=AAPL&from=1000&to=2000');
    expect(ev.supported).toBe(true);
    expect(ev.dividends).toHaveLength(1);

    fx.mockResolvedValueOnce(fail(502));
    const evFail = await fetchCorporateEvents('BTCUSDT');
    expect(evFail.supported).toBe(false);
    expect(evFail.dividends).toEqual([]);

    fx.mockResolvedValueOnce(ok({ from: 'EUR', to: 'USD', pair: 'EUR/USD', supported: true, rates: [{ time: 100, rate: 1.09 }] }));
    const fxOk = await fetchFxRates('EUR', 'USD', 100, 200);
    expect(lastUrl()).toBe('/api/fx?from=EUR&to=USD&fromTs=100&toTs=200');
    expect(fxOk.rates[0].rate).toBe(1.09);

    fx.mockResolvedValueOnce(fail(500));
    const fxFail = await fetchFxRates('EUR', 'TRY');
    expect(fxFail.supported).toBe(false);
    expect(fxFail.rates).toEqual([]);

    fx.mockResolvedValueOnce(ok({}));
    expect(await deleteSavedScript('sc_1')).toBe(true);
    expect(fx.mock.calls[fx.mock.calls.length - 1]).toEqual(['/api/scripts?id=sc_1', { method: 'DELETE' }]);
  });
});

describe('apiFetch — Access oturumu', () => {
  it('401 yanıtında tv-session-expired olayı yayar ve yanıtı olduğu gibi döner', async () => {
    const { apiFetch } = await import('../client');
    const handler = vi.fn();
    const target = new EventTarget();
    vi.stubGlobal('window', target);
    target.addEventListener('tv-session-expired', handler);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 401 })));
    const r = await apiFetch('/api/x');
    expect(r.status).toBe(401);
    expect(handler).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it('Faz 26: fetchHistory currency param, fetchFundamentals, fetchCalendar, fetchOptionChain', async () => {
    const { fetchHistory, fetchFundamentals, fetchCalendar, fetchOptionChain } = await import('../client');
    const mockFetch = vi.fn(async (url: string) => {
      if (url.includes('/api/history')) {
        return new Response(JSON.stringify({ symbol: 'THYAO.IS', interval: '1d', currency: 'USD', nativeCurrency: 'TRY', candles: [] }), { status: 200 });
      }
      if (url.includes('/api/fundamentals')) {
        return new Response(JSON.stringify({ symbol: 'THYAO.IS', supported: true, ratios: {}, annual: [], quarterly: [] }), { status: 200 });
      }
      if (url.includes('/api/calendar')) {
        return new Response(JSON.stringify({ economic: [], earnings: [], dividends: [], ipoNote: '', ipoSources: [] }), { status: 200 });
      }
      if (url.includes('/api/options')) {
        return new Response(JSON.stringify({ supported: true, symbol: 'BTCUSDT', spotPrice: 60000, expiries: [], rows: [] }), { status: 200 });
      }
      return new Response('{}', { status: 200 });
    });
    vi.stubGlobal('fetch', mockFetch);

    const h = await fetchHistory('THYAO.IS', '1d', 1000, 2000, 'USD');
    expect(h.currency).toBe('USD');
    expect(mockFetch).toHaveBeenCalledWith('/api/history?symbol=THYAO.IS&interval=1d&from=1000&to=2000&currency=USD', undefined);

    const f = await fetchFundamentals('THYAO.IS');
    expect(f.supported).toBe(true);

    const c = await fetchCalendar('TR', 'BIST');
    expect(c.economic).toEqual([]);

    const o = await fetchOptionChain('BTCUSDT', '29JAN27');
    expect(o.supported).toBe(true);

    vi.unstubAllGlobals();
  });
});
