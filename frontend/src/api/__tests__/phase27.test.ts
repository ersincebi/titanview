import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  deleteNoteApi,
  deleteScreenerPresetApi,
  deleteWatchlistApi,
  fetchNotesApi,
  fetchScreenerPresetsApi,
  fetchSymbolCardFundamentals,
  fetchSymbolCardSecurity,
  fetchWatchlistsApi,
  runScriptScreenerApi,
  saveNoteApi,
  saveScreenerPresetApi,
  saveWatchlistApi,
  setSymbolFlagApi,
} from '../phase27';

describe('api/phase27', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('calls watchlists, flags, notes, screener presets, script screener, and symbol card endpoints', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        watchlists: [{ id: 'wl_1', name: 'Ana', items: [] }],
        flags: { 'THYAO.IS': 'red' },
      }),
    });
    const wlRes = await fetchWatchlistsApi();
    expect(wlRes.watchlists).toHaveLength(1);
    expect(wlRes.flags['THYAO.IS']).toBe('red');

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'wl_2', name: 'Yeni', items: [] }),
    });
    const savedWl = await saveWatchlistApi({ name: 'Yeni', items: [] });
    expect(savedWl?.id).toBe('wl_2');

    fetchMock.mockResolvedValueOnce({ ok: true });
    expect(await deleteWatchlistApi('wl_2')).toBe(true);

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ flags: { BTCUSDT: 'blue' } }),
    });
    const flags = await setSymbolFlagApi('BTCUSDT', 'blue');
    expect(flags?.BTCUSDT).toBe('blue');

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ notes: [{ id: 'n1', symbol: 'THYAO.IS', title: 'T', body: 'B' }] }),
    });
    const notes = await fetchNotesApi('THYAO.IS');
    expect(notes).toHaveLength(1);

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'n1', symbol: 'THYAO.IS', title: 'T', body: 'B' }),
    });
    const savedNote = await saveNoteApi({ symbol: 'THYAO.IS', title: 'T', body: 'B' });
    expect(savedNote?.id).toBe('n1');

    fetchMock.mockResolvedValueOnce({ ok: true });
    expect(await deleteNoteApi('n1')).toBe(true);

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ presets: [{ id: 'p1', name: 'P' }] }),
    });
    const presets = await fetchScreenerPresetsApi();
    expect(presets).toHaveLength(1);

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'p1', name: 'P' }),
    });
    const savedPreset = await saveScreenerPresetApi({ name: 'P' });
    expect(savedPreset?.id).toBe('p1');

    fetchMock.mockResolvedValueOnce({ ok: true });
    expect(await deleteScreenerPresetApi('p1')).toBe(true);

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        scriptTitle: 'Test',
        timeframe: '15m',
        columns: [{ id: 'plot_0', title: 'RSI' }],
        conditions: [],
        rows: [],
      }),
    });
    const scriptRes = await runScriptScreenerApi({ code: 'indicator("t")\nplot(close)', timeframe: '15m' });
    expect(scriptRes.ok).toBe(true);
    expect(scriptRes.columns).toHaveLength(1);

    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 422,
      json: async () => ({ error: 'syntax error' }),
    });
    const scriptErr = await runScriptScreenerApi({ code: 'bad', timeframe: '15m' });
    expect(scriptErr.ok).toBe(false);
    expect(scriptErr.error).toBe('syntax error');

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ stats: { last: 100 } }),
    });
    expect((await fetchSymbolCardSecurity('THYAO.IS'))?.stats.last).toBe(100);

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ supported: true, symbol: 'THYAO.IS' }),
    });
    expect((await fetchSymbolCardFundamentals('THYAO.IS'))?.supported).toBe(true);
  });
});
