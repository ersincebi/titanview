import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Candle, HistoryResponse } from '../../types/market';

vi.mock('../../api/client', () => ({
  fetchHistory: vi.fn(),
  fetchSymbols: vi.fn(async () => []),
  fetchScreener: vi.fn(async () => []),
  fetchDrawings: vi.fn(async () => []),
  persistDrawing: vi.fn(async () => {}),
  clearSymbolDrawings: vi.fn(async () => {}),
  syncCollectSymbols: vi.fn(async (s: string[]) => s),
  fetchCollectItems: vi.fn(async () => []),
  saveCustomScript: vi.fn(async () => null),
  fetchSavedScripts: vi.fn(async () => []),
  fetchCorporateEvents: vi.fn(async (symbol: string) => ({ symbol, supported: false, dividends: [], splits: [], earnings: [] })),
  fetchFxRates: vi.fn(async (from: string, to: string) => ({ from, to, pair: `${from}/${to}`, supported: false, rates: [] })),
  fetchSetting: vi.fn(async () => null),
  saveSetting: vi.fn(async () => {}),
}));
vi.mock('../../api/liveSocket', () => ({
  LiveMarketSocket: class {
    connect() {}
    sendSubscribe() {}
    destroy() {}
  },
}));

import * as api from '../../api/client';
import { deriveCandles } from '../../chart/chartTypes';
import {
  alerts,
  applyScriptChartPick,
  applyScriptToChart,
  applyTemplate,
  cancelScriptChartPick,
  candles,
  handleLiveTick,
  loadError,
  loadSavedScript,
  meta,
  scriptInputOverrides,
  scriptMain,
  scriptPickTarget,
  scriptResult,
  refreshSavedScripts,
  resetScriptInputOverrides,
  resetStore,
  loadOlderHistory,
  loadWorkspace,
  saveScript,
  savedScripts,
  setScriptInputOverride,
  startScriptChartPick,
  startWorkspaceAutosave,
  olderLimitNote,
  runScript,
  setSymbols,
  switchSymbol,
  symbols,
  toastMsg,
  ui,
  setUi,
  setWorkbenchTab,
  toggleScale,
} from '../store';

const mkCandles = (n: number, start = 100): Candle[] =>
  Array.from({ length: n }, (_, i) => {
    const p = start + Math.sin(i / 5) * 5 + i * 0.1;
    return { time: 1_700_000_000 + i * 900, open: p - 0.3, high: p + 1, low: p - 1, close: p, volume: 1000 + i };
  });

const resp = (symbol: string, interval: string, list: Candle[]): HistoryResponse =>
  ({
    symbol,
    displayName: `${symbol} Corp`,
    market: 'BIST',
    currency: 'TRY',
    provider: 'YAHOO',
    delayMinutes: 15,
    interval,
    candles: list,
    queryMs: 1.2,
    cacheHit: true,
  }) as unknown as HistoryResponse;

beforeEach(() => {
  resetStore();
  vi.clearAllMocks();
});

describe('store: symbol / timeframe switching', () => {
  it('loads history, meta and runs the active TitanScript', async () => {
    vi.mocked(api.fetchHistory).mockResolvedValue(resp('SASA.IS', '1h', mkCandles(150)));
    await switchSymbol('sasa.is', '1h');
    expect(api.fetchHistory).toHaveBeenCalledWith('SASA.IS', '1h');
    expect(ui.symbol).toBe('SASA.IS');
    expect(ui.interval).toBe('1h');
    expect(candles()).toHaveLength(150);
    expect(meta()?.displayName).toBe('SASA.IS Corp');
    expect(loadError()).toBeNull();
    expect(scriptResult()).not.toBeNull();
  });

  it('surfaces upstream failure instead of fake data', async () => {
    vi.mocked(api.fetchHistory).mockRejectedValue(new Error('History API error: 502'));
    await switchSymbol('THYAO.IS', '15m');
    expect(loadError()).toContain('History API error: 502');
    expect(loadError()).toContain('THYAO.IS');
    expect(candles()).toHaveLength(0);
    expect(meta()).toBeNull();
  });

  it('clears a previous error after a successful load', async () => {
    vi.mocked(api.fetchHistory).mockRejectedValueOnce(new Error('down'));
    await switchSymbol('THYAO.IS', '15m');
    expect(loadError()).not.toBeNull();
    vi.mocked(api.fetchHistory).mockResolvedValue(resp('THYAO.IS', '15m', mkCandles(60)));
    await switchSymbol('THYAO.IS', '15m');
    expect(loadError()).toBeNull();
  });
});

describe('store: live ticks', () => {
  beforeEach(async () => {
    vi.mocked(api.fetchHistory).mockResolvedValue(resp('THYAO.IS', '15m', mkCandles(60)));
    await switchSymbol('THYAO.IS', '15m');
  });

  it('updates the last candle in place and appends a newer one', () => {
    const last = candles()[candles().length - 1];
    handleLiveTick({ ...last, close: last.close + 1 });
    expect(candles()).toHaveLength(60);
    expect(candles()[59].close).toBe(last.close + 1);
    handleLiveTick({ ...last, time: last.time + 900, close: 200 });
    expect(candles()).toHaveLength(61);
  });

  it('aynı bar tick fırtınası candles sinyalini ≤ birkaç kez tetikler, yeni bar hemen', async () => {
    vi.useFakeTimers();
    try {
      let runs = 0;
      const { createRoot, createEffect } = await import('solid-js');
      const dispose = createRoot((d) => {
        createEffect(() => {
          candles();
          runs++;
        });
        return d;
      });
      const base = runs;
      const last = candles()[candles().length - 1];
      for (let i = 0; i < 200; i++) handleLiveTick({ ...last, close: last.close + i * 0.01 });
      expect(runs - base).toBeLessThanOrEqual(2);
      vi.advanceTimersByTime(400);
      expect(runs - base).toBeLessThanOrEqual(3);
      const before = runs;
      handleLiveTick({ ...last, time: last.time + 900, close: 1 });
      expect(runs).toBe(before + 1);
      expect(candles()[candles().length - 1].close).toBe(1);
      dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('ignores ticks during bar replay', () => {
    setUi('replayActive', true);
    const n = candles().length;
    handleLiveTick({ ...candles()[n - 1], time: candles()[n - 1].time + 900 });
    expect(candles()).toHaveLength(n);
  });

  it('pushes the live quote into the symbol list', () => {
    setSymbols([{ symbol: 'THYAO.IS', displayName: 'THY', market: 'BIST', exchange: 'BIST', currency: 'TRY', provider: 'YAHOO', delayMinutes: 15, lastPrice: 1, changePercent: 0 }]);
    const last = candles()[candles().length - 1];
    handleLiveTick({ ...last, close: 321 });
    expect(symbols()[0].lastPrice).toBe(321);
  });

});

describe('store: UI state', () => {
  it('applies indicator templates and toggles scale', () => {
    applyTemplate('momentum');
    expect(ui.quick).toMatchObject({ bb: true, rsi: true, macd: true, ema9: false });
    toggleScale('log');
    expect(ui.scaleKind).toBe('log');
    toggleScale('log');
    expect(ui.scaleKind).toBe('normal');
    setWorkbenchTab('backtest');
    expect(ui.wbTab).toBe('backtest');
  });
});

describe('store: TitanScript on derived (Renko) bars', () => {
  const trend = (): Candle[] =>
    Array.from({ length: 80 }, (_, i) => {
      const p = 100 + i * 1.5 + (i % 2) * 0.4;
      return { time: 1_700_000_000 + i * 900, open: p - 0.5, high: p + 1, low: p - 1, close: p, volume: 10 };
    });

  it('runs the script on bricks, not on source candles', async () => {
    vi.mocked(api.fetchHistory).mockResolvedValue(resp('THYAO.IS', '15m', trend()));
    await switchSymbol('THYAO.IS', '15m');
    setUi('scriptCode', '//@version=5\nindicator("n", overlay=true)\nplot(bar_index, "bi")');

    runScript();
    const normal = scriptResult()!.plots[0].data;
    expect(normal).toHaveLength(80);

    setUi('chartStyle', 'renko');
    runScript();
    const bricks = deriveCandles('renko', candles());
    const renko = scriptResult()!.plots[0].data;
    expect(bricks.length).not.toBe(80);
    expect(renko).toHaveLength(bricks.length);
    expect(renko.map((p) => p.time)).toEqual(bricks.map((b) => b.time));
    expect(renko[renko.length - 1].value).toBe(bricks.length - 1);
  });

  it('ta.* values come from brick closes', async () => {
    vi.mocked(api.fetchHistory).mockResolvedValue(resp('THYAO.IS', '15m', trend()));
    await switchSymbol('THYAO.IS', '15m');
    setUi('scriptCode', '//@version=5\nindicator("n", overlay=true)\nplot(close, "c")');
    setUi('chartStyle', 'renko');
    runScript();
    const bricks = deriveCandles('renko', candles());
    expect(scriptResult()!.plots[0].data.map((p) => p.value)).toEqual(bricks.map((b) => b.close));
  });
});

describe('store: older history on scroll', () => {
  const base = () => mkCandles(100);
  it('prepends older bars, asks for 1000 bars before the oldest, and stops asking once the source is exhausted', async () => {
    vi.mocked(api.fetchHistory).mockResolvedValue(resp('THYAO.IS', '15m', base()));
    await switchSymbol('THYAO.IS', '15m');
    const oldest = candles()[0].time;
    const older = Array.from({ length: 50 }, (_, i) => ({ ...base()[0], time: oldest - (50 - i) * 900 }));
    vi.mocked(api.fetchHistory).mockResolvedValueOnce({ ...resp('THYAO.IS', '15m', older) });
    await loadOlderHistory(oldest);
    expect(api.fetchHistory).toHaveBeenLastCalledWith('THYAO.IS', '15m', oldest - 1000 * 900, oldest);
    expect(candles()).toHaveLength(150);
    expect(candles()[0].time).toBe(older[0].time);

    // source returns nothing new: explain once, then no more requests
    vi.mocked(api.fetchHistory).mockResolvedValue(resp('THYAO.IS', '15m', []));
    const first = candles()[0].time;
    await loadOlderHistory(first);
    expect(toastMsg()).toContain('Yahoo 15m');
    const calls = vi.mocked(api.fetchHistory).mock.calls.length;
    await loadOlderHistory(first);
    expect(vi.mocked(api.fetchHistory).mock.calls.length).toBe(calls);

    // switching symbol re-arms it
    vi.mocked(api.fetchHistory).mockResolvedValue(resp('SASA.IS', '15m', base()));
    await switchSymbol('SASA.IS', '15m');
    await loadOlderHistory(candles()[0].time);
    expect(vi.mocked(api.fetchHistory).mock.calls.length).toBeGreaterThan(calls);
  });

  it('limit note: Yahoo intraday explains the source cap, crypto/daily do not blame Yahoo', () => {
    expect(olderLimitNote('BIST', '15m')).toContain('1G veya 1H');
    expect(olderLimitNote('CRYPTO', '15m')).not.toContain('Yahoo');
    expect(olderLimitNote('BIST', '1d')).not.toContain('Yahoo');
  });
});

describe('store: favourites sync to the collector', () => {
  it('toggling a favourite pushes the full list to the server', async () => {
    const { toggleFav, favorites, setFavorites } = await import('../store');
    setFavorites([]);
    vi.mocked(api.syncCollectSymbols).mockClear();
    toggleFav({ symbol: 'THYAO.IS', displayName: 'THY', market: 'BIST' });
    toggleFav({ symbol: 'BTCUSDT', displayName: 'BTC', market: 'CRYPTO' });
    expect(api.syncCollectSymbols).toHaveBeenLastCalledWith(['THYAO.IS', 'BTCUSDT']);
    toggleFav({ symbol: 'THYAO.IS', displayName: 'THY', market: 'BIST' });
    expect(api.syncCollectSymbols).toHaveBeenLastCalledWith(['BTCUSDT']);
    expect(favorites()).toHaveLength(1);
  });
});

describe('store: favourites survive a wiped browser', () => {
  it('restores from the server list and never pushes an empty list over it', async () => {
    const { restoreFavorites, favorites, setFavorites } = await import('../store');
    setFavorites([]);
    vi.mocked(api.syncCollectSymbols).mockClear();
    vi.mocked(api.fetchCollectItems).mockResolvedValueOnce([{ symbol: 'THYAO.IS', displayName: 'THY', market: 'BIST' }]);
    await restoreFavorites();
    expect(favorites().map((x) => x.symbol)).toEqual(['THYAO.IS']);
    expect(api.syncCollectSymbols).toHaveBeenLastCalledWith(['THYAO.IS']);

    // server unreachable: local list untouched and NOTHING written (an empty PUT would wipe the server copy)
    setFavorites([]);
    vi.mocked(api.syncCollectSymbols).mockClear();
    vi.mocked(api.fetchCollectItems).mockRejectedValueOnce(new Error('down'));
    await restoreFavorites();
    expect(api.syncCollectSymbols).not.toHaveBeenCalled();
  });
});

describe('store: çalışma alanı kalıcılığı (sunucu esas, tarayıcı verisi silinse de geri gelir)', () => {
  beforeEach(() => {
    resetStore();
    vi.mocked(api.fetchSetting).mockReset();
    vi.mocked(api.saveSetting).mockReset();
    vi.mocked(api.saveSetting).mockResolvedValue(undefined);
  });

  it('sunucudaki çalışma alanı arayüze uygulanır', async () => {
    vi.mocked(api.fetchSetting).mockResolvedValue({ symbol: 'btcusdt', interval: '4h', chartStyle: 'heikin', quickQty: 250, wbTab: 'paper', alerts: [], magnet: true });
    await loadWorkspace();
    expect(ui.symbol).toBe('BTCUSDT');
    expect(ui.interval).toBe('4h');
    expect(ui.chartStyle).toBe('heikin');
    expect(ui.quickQty).toBe(250);
    expect(ui.wbTab).toBe('paper');
    expect(ui.magnet).toBe(true);
  });

  it('sunucu yoksa/erişilemezse yerel önbelleğe düşer; ikisi de yoksa varsayılan kalır', async () => {
    vi.mocked(api.fetchSetting).mockRejectedValue(new Error('down'));
    const before = ui.symbol;
    await loadWorkspace();
    expect(ui.symbol).toBe(before);
    const mem = new Map<string, string>([['titanview_workspace_v1', JSON.stringify({ symbol: 'AAPL', interval: '1h' })]]);
    vi.stubGlobal('localStorage', { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) });
    try {
      await loadWorkspace();
      expect(ui.symbol).toBe('AAPL');
      expect(ui.interval).toBe('1h');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('tercih değişince 1 sn sonra sunucuya yazılır (varsayılan Betik kodu hariç)', async () => {
    vi.useFakeTimers();
    try {
      startWorkspaceAutosave();
      setUi('interval', '1h');
      setUi('quickQty', 321);
      await vi.advanceTimersByTimeAsync(1200);
      const calls = vi.mocked(api.saveSetting).mock.calls;
      expect(calls.length).toBeGreaterThanOrEqual(1);
      const last = calls[calls.length - 1][1] as Record<string, unknown>;
      expect(last.interval).toBe('1h');
      expect(last.quickQty).toBe(321);
      expect(last.scriptCode).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('store: Faz 18 TitanScript libraries, async request.* prefetch, input overrides & chart picking', () => {
  it('resolves imported library from /api/scripts and prefetches lowerTf/events/fx asynchronously', async () => {
    const bars15 = mkCandles(10);
    const bars5: Candle[] = bars15.flatMap((b) => [
      { ...b, time: b.time, close: b.close - 0.2 },
      { ...b, time: b.time + 300, close: b.close + 0.3 },
    ]);
    vi.mocked(api.fetchHistory).mockImplementation(async (_sym, tf) =>
      tf === '5m' ? resp('AAPL', '5m', bars5) : resp('AAPL', '15m', bars15)
    );
    vi.mocked(api.fetchSavedScripts).mockResolvedValue([
      {
        id: 'lib_1',
        name: 'StoreMath',
        code: '//@version=6\nlibrary("StoreMath")\nexport bump(float x) => x + 10.0',
        isOverlay: false,
        updatedAt: 1_700_000_000,
      },
    ]);
    vi.mocked(api.fetchCorporateEvents).mockResolvedValue({
      symbol: 'AAPL',
      supported: true,
      dividends: [{ time: bars15[2].time, amount: 0.5 }],
      splits: [],
      earnings: [],
    });
    vi.mocked(api.fetchFxRates).mockResolvedValue({
      from: 'EUR',
      to: 'USD',
      pair: 'EUR/USD',
      supported: true,
      rates: bars15.map((b) => ({ time: b.time, rate: 1.1 })),
    });

    await switchSymbol('AAPL', '15m');
    setUi('scriptCode2', '');
    setUi(
      'scriptCode',
      `//@version=6
indicator("Async18")
import local/StoreMath/1 as sm
ltf = request.security_lower_tf(syminfo.tickerid, "5", close)
dv = request.dividends(syminfo.tickerid, dividends.gross, gaps=barmerge.gaps_off)
fx = request.currency_rate("EUR", "USD")
plot(sm.bump(fx), "bumped")
plot(array.size(ltf), "ltfN")
plot(dv, "div")
`
    );
    runScript();
    await vi.waitFor(() => expect(scriptMain()?.scriptTitle).toBe('Async18'));
    const r = scriptMain()!;
    expect(r.ok).toBe(true);
    expect(r.plots[0].data.at(-1)?.value).toBeCloseTo(11.1, 6);
    expect(r.plots[1].data.at(-1)?.value).toBe(2);
    expect(r.plots[2].data.at(-1)?.value).toBeCloseTo(0.5, 6);
  });

  it('saves library scripts, loads saved scripts, overrides inputs, and applies chart-click picks', async () => {
    vi.mocked(api.fetchHistory).mockResolvedValue(resp('THYAO.IS', '15m', mkCandles(20)));
    await switchSymbol('THYAO.IS', '15m');
    setUi('scriptCode2', '');

    const libCode = '//@version=6\nlibrary("MySavedLib")\nexport id(float x) => x';
    setUi('scriptCode', libCode);
    vi.mocked(api.fetchSavedScripts).mockResolvedValue([
      { id: 'sc_lib', name: 'MySavedLib', code: libCode, isOverlay: false, updatedAt: 1_700_000_000 },
    ]);
    await saveScript();
    expect(ui.scriptNote).toContain('kütüphanesi');
    expect(savedScripts()).toHaveLength(1);

    // Load saved script + refreshSavedScripts error resilience
    setUi('scriptCode', '//@version=6\nindicator("Tmp")\nplot(close)');
    loadSavedScript('sc_lib');
    expect(ui.scriptCode).toBe(libCode);
    vi.mocked(api.fetchSavedScripts).mockRejectedValueOnce(new Error('offline'));
    expect(await refreshSavedScripts()).toHaveLength(1);

    // Input overrides + confirm=true auto-pick + manual chart pick
    setUi(
      'scriptCode',
      `//@version=6
indicator("PickTest")
t0 = input.time(1700000000000, "AnchorTime", confirm=true)
p0 = input.price(100.0, "AnchorPrice", confirm=true)
len = input.int(5, "Len")
plot(p0, "p")
plot(len, "l")
`
    );
    applyScriptToChart();
    expect(scriptPickTarget()).toMatchObject({ kind: 'both', inputKey: 'AnchorTime', pairedKey: 'AnchorPrice' });
    expect(applyScriptChartPick(1_700_005_000, 142.75)).toBe(true);
    expect(scriptPickTarget()).toBeNull();
    expect(scriptInputOverrides().AnchorTime).toBe(1_700_005_000_000);
    expect(scriptInputOverrides().AnchorPrice).toBe(142.75);
    expect(scriptMain()?.plots[0].data.at(-1)?.value).toBeCloseTo(142.75, 4);

    setScriptInputOverride('Len', 12);
    expect(scriptMain()?.plots[1].data.at(-1)?.value).toBe(12);

    startScriptChartPick({ inputKey: 'AnchorPrice', inputTitle: 'AnchorPrice', kind: 'price' });
    cancelScriptChartPick();
    expect(scriptPickTarget()).toBeNull();
    expect(applyScriptChartPick(100, 200)).toBe(false);

    resetScriptInputOverrides();
    expect(scriptInputOverrides()).toEqual({});
    expect(scriptMain()?.plots[1].data.at(-1)?.value).toBe(5);
  });
});
