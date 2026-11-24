// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Candle, HistoryResponse, SymbolQuoteSummary } from '../../types/market';

const spy = vi.hoisted(() => ({
  selected: null as unknown,
  update: vi.fn(async () => {}),
  duplicate: vi.fn(() => null),
  finishDraft: vi.fn((): unknown => null),
  addDrawing: vi.fn(async () => {}),
  setInvert: vi.fn(),
  fit: vi.fn(),
  lock: vi.fn(),
  side: vi.fn(),
  maximize: vi.fn(),
  move: vi.fn(),
  footprint: vi.fn(),
  renderStudies: vi.fn(),
}));

// Faz 23: sunucu alarm API'si — bellek içi sahte sunucu
const alertSrv = vi.hoisted(() => ({ list: [] as Array<Record<string, unknown>>, n: 0 }));
vi.mock('../../api/alerts', () => ({
  listAlerts: vi.fn(async () => alertSrv.list.map((a) => ({ ...a }))),
  createAlertApi: vi.fn(async (d: Record<string, unknown>) => {
    const a = { ...d, id: `al_${++alertSrv.n}`, status: 'active', createdAt: alertSrv.n, updatedAt: alertSrv.n, fireCount: 0 };
    alertSrv.list.unshift(a);
    return a;
  }),
  updateAlertApi: vi.fn(async (id: string, d: Record<string, unknown>) => {
    const i = alertSrv.list.findIndex((a) => a.id === id);
    alertSrv.list[i] = { ...alertSrv.list[i], ...d, status: 'active' };
    return alertSrv.list[i];
  }),
  deleteAlertApi: vi.fn(async (id: string) => {
    alertSrv.list = alertSrv.list.filter((a) => a.id !== id);
  }),
  alertAction: vi.fn(async (id: string, act: string) => {
    const a = alertSrv.list.find((x) => x.id === id)!;
    if (act === 'stop') a.status = 'stopped';
    if (act === 'restart') a.status = 'active';
    if (act === 'clone') alertSrv.list.unshift({ ...a, id: `al_${++alertSrv.n}`, name: `${a.name} (kopya)` });
    return a;
  }),
  bulkAlertAction: vi.fn(async () => 0),
  fetchAlertLog: vi.fn(async () => []),
  clearAlertLog: vi.fn(async () => {}),
  fetchAlertConfig: vi.fn(async () => ({ telegram: { enabled: false, chatId: '', tokenSet: false }, pushSubscriptions: 0 })),
  saveAlertConfig: vi.fn(async () => ({ telegram: { enabled: true, chatId: '1', tokenSet: true }, pushSubscriptions: 0 })),
  testAlertChannel: vi.fn(async (ch: string) => ({ channel: ch, ok: true })),
  fetchPushKey: vi.fn(async () => 'k'),
  savePushSubscription: vi.fn(async () => {}),
  deletePushSubscription: vi.fn(async () => {}),
}));

// Faz 28: sunucu paper motoru — bellek içi sahte (piyasa emri + kapat)
const tradeSrv = vi.hoisted(() => {
  const empty = () => ({
    initialBalance: 100000, balance: 100000, commissionPct: 0, orders: [] as Array<Record<string, unknown>>,
    positions: [] as Array<{ symbol: string; qty: number; avgPrice: number; last: number; openedAt: number; realized: number }>,
    fills: [] as Array<Record<string, unknown>>, closed: [], version: 1,
    summary: { balance: 100000, equity: 100000, unrealized: 0, realized: 0, marginUsed: 0, available: 100000, initialBalance: 100000 },
  });
  return { snap: empty(), empty, px: 100 };
});
vi.mock('../../api/trading', () => {
  const res = () => ({ events: [], snapshot: JSON.parse(JSON.stringify(tradeSrv.snap)) });
  return {
    fetchPaper: vi.fn(async () => JSON.parse(JSON.stringify(tradeSrv.snap))),
    placePaperOrder: vi.fn(async (r: { symbol: string; side: string; qty: number }) => {
      const qty = r.side === 'buy' ? r.qty : -r.qty;
      tradeSrv.snap.positions.push({ symbol: r.symbol, qty, avgPrice: tradeSrv.px, last: tradeSrv.px, openedAt: 1, realized: 0 });
      tradeSrv.snap.fills.unshift({ id: 'f1', orderId: 'o1', symbol: r.symbol, side: r.side, type: 'market', role: 'entry', qty: r.qty, price: tradeSrv.px, commission: 0, realized: 0, time: 1 });
      tradeSrv.snap.version++;
      return { ...res(), events: [{ kind: 'filled', message: `${r.symbol} doldu`, time: 1 }] };
    }),
    closePaperPosition: vi.fn(async (sym: string) => {
      const p = tradeSrv.snap.positions.find((x) => x.symbol === sym)!;
      tradeSrv.snap.positions = tradeSrv.snap.positions.filter((x) => x.symbol !== sym);
      tradeSrv.snap.fills.unshift({ id: 'f2', orderId: 'o2', symbol: sym, side: p.qty > 0 ? 'sell' : 'buy', type: 'market', role: 'entry', qty: Math.abs(p.qty), price: tradeSrv.px, commission: 0, realized: 0, time: 2 });
      tradeSrv.snap.version++;
      return res();
    }),
    modifyPaperOrder: vi.fn(async () => res()),
    cancelPaperOrder: vi.fn(async () => res()),
    reversePaperPosition: vi.fn(async () => res()),
    setPaperBrackets: vi.fn(async () => res()),
    resetPaper: vi.fn(async () => tradeSrv.snap),
    fetchFillLog: vi.fn(async () => []),
    fetchBinanceStatus: vi.fn(async () => ({ configured: false, testnet: true })),
    saveBinanceKeys: vi.fn(async () => ({ configured: true, testnet: true, keyHint: 'AKAK…AKAK' })),
    deleteBinanceKeys: vi.fn(async () => ({ configured: false, testnet: false })),
    fetchBinanceBalances: vi.fn(async () => []),
    fetchBinanceOpenOrders: vi.fn(async () => []),
    previewBinanceOrder: vi.fn(),
    confirmBinanceOrder: vi.fn(),
    cancelBinanceOrder: vi.fn(),
  };
});

vi.mock('../../chart/ChartController', () => ({
  TitanChartController: class {
    constructor() {
      return new Proxy(
        {},
        {
          get: (_t, k) => {
            if (k === 'getQuickIndicators') return () => ({});
            if (k === 'getCandles') return () => [];
            if (k === 'yToPrice') return () => 123.45;
            if (k === 'xToTime') return () => 1_700_000_000;
            if (k === 'setInvertScale') return spy.setInvert;
            if (k === 'fitContent') return spy.fit;
            if (k === 'setScaleLocked') return spy.lock;
            if (k === 'setPaneScaleSide') return spy.side;
            if (k === 'toggleMaximize') return spy.maximize;
            if (k === 'movePaneBy') return spy.move;
            if (k === 'setFootprintData') return spy.footprint;
            if (k === 'renderStudies') return spy.renderStudies;
            if (k === 'visibleBarTimes') return () => [];
            return () => undefined;
          },
        }
      );
    }
  },
}));
vi.mock('../../chart/DrawingOverlay', () => ({
  DrawingOverlay: class {
    constructor() {
      return new Proxy(
        {},
        {
          get: (_t, k) => {
            if (k === 'getDrawings') return () => [];
            if (k === 'getSelectedDrawing') return () => spy.selected;
            if (k === 'updateSelectedDrawing') return spy.update;
            if (k === 'duplicateSelected') return spy.duplicate;
            if (k === 'finishDraft') return spy.finishDraft;
            if (k === 'getManager') return () => ({ getContext: () => ({ symbol: 'THYAO.IS', timeframe: '15m' }), addDrawing: spy.addDrawing });
            return () => undefined;
          },
        }
      );
    }
  },
}));
vi.mock('../../api/liveSocket', () => ({
  LiveMarketSocket: class {
    connect() {}
    sendSubscribe() {}
    sendSubscriptions() {}
    destroy() {}
  },
}));
vi.mock('../../api/scripts', () => ({
  listScripts: vi.fn(async () => []),
  saveScript: vi.fn(async () => ({ id: 'x', name: 'x', code: '', isOverlay: false, updatedAt: 0 })),
  deleteScript: vi.fn(async () => {}),
  renameScript: vi.fn(async () => {}),
  listVersions: vi.fn(async () => []),
}));
vi.mock('../../api/layouts', () => ({
  listLayoutsApi: vi.fn(async () => []),
  getLayoutApi: vi.fn(async () => ({})),
  createLayoutApi: vi.fn(async (p: Record<string, unknown>) => ({ ...p, id: 'lay_test', isShared: false, createdAt: 1, updatedAt: 1 })),
  updateLayoutApi: vi.fn(async (id: string, p: Record<string, unknown>) => ({ ...p, id, name: (p.name as string) ?? 'Adsız', gridId: 'single', chartCount: 1, symbols: '', autosave: true, isShared: false, createdAt: 1, updatedAt: 2 })),
  copyLayoutApi: vi.fn(async () => ({ id: 'lay_copy', name: 'Adsız (kopya)', state: {}, gridId: 'single', chartCount: 1, symbols: '', autosave: true, isShared: false, createdAt: 1, updatedAt: 2 })),
  shareLayoutApi: vi.fn(async (id: string, shared: boolean) => ({ id, isShared: shared, shareToken: shared ? 'tok123' : '', updatedAt: 2 })),
  deleteLayoutApi: vi.fn(async () => {}),
  getSharedLayoutApi: vi.fn(async () => ({ layout: {}, drawings: [], readOnly: true })),
}));

vi.mock('../../api/client', () => ({
  fetchHistory: vi.fn(),
  fetchSymbols: vi.fn(),
  fetchScreener: vi.fn(async () => []),
  fetchDrawings: vi.fn(async () => []),
  persistDrawing: vi.fn(async () => {}),
  clearSymbolDrawings: vi.fn(async () => {}),
  saveCustomScript: vi.fn(async () => null),
  fetchSavedScripts: vi.fn(async () => []),
  fetchCorporateEvents: vi.fn(async (symbol: string) => ({ symbol, supported: false, dividends: [], splits: [], earnings: [] })),
  fetchFxRates: vi.fn(async (from: string, to: string) => ({ from, to, pair: `${from}/${to}`, supported: false, rates: [] })),
  fetchOverview: vi.fn(),
  fetchCorrelation: vi.fn(),
  fetchSecurity: vi.fn(),
  fetchAnalysis: vi.fn(() => new Promise(() => {})),
  fetchRelated: vi.fn(async () => ({ positive: [], negative: [], cross: [], note: '' })),
  fetchFlow: vi.fn(async () => ({})),
  fetchIdeas: vi.fn(),
  fetchNews: vi.fn(),
  syncCollectSymbols: vi.fn(async (s: string[]) => s),
  fetchCollectItems: vi.fn(async () => []),
  fetchFootprint: vi.fn(async () => ({ supported: false })),
}));

import * as api from '../../api/client';
import * as scriptsApi from '../../api/scripts';
import { paneMenu, resetStore, setPaneMenu, setSelectedDrawing, setUi, ui } from '../../state/store';
import { App } from '../App';
import { _resetStudies, studies, studyResults } from '../../state/studies';

const candles = (n: number): Candle[] =>
  Array.from({ length: n }, (_, i) => {
    const p = 100 + Math.sin(i / 4) * 6 + i * 0.05;
    return { time: 1_700_000_000 + i * 900, open: p - 0.2, high: p + 1, low: p - 1, close: p, volume: 500 + i };
  });

const history = (symbol: string, interval: string): HistoryResponse =>
  ({
    symbol,
    displayName: `${symbol} Inc`,
    market: 'BIST',
    currency: 'TRY',
    provider: 'YAHOO',
    delayMinutes: 15,
    interval,
    candles: candles(120),
    queryMs: 0.8,
    cacheHit: true,
  }) as unknown as HistoryResponse;

const quote = (symbol: string, market: SymbolQuoteSummary['market']): SymbolQuoteSummary => ({
  symbol,
  displayName: `${symbol} name`,
  market,
  exchange: 'X',
  currency: 'TRY',
  provider: 'YAHOO',
  delayMinutes: 15,
  lastPrice: 10,
  changePercent: 1.5,
});

// Node 26'nın deneysel global localStorage'ı jsdom'unkini gölgeler; bellek içi sahte depo.
const memStore = (() => {
  let m = new Map<string, string>();
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
    clear: () => void (m = new Map()),
  };
})();
vi.stubGlobal('localStorage', memStore);

const $ = (sel: string) => document.querySelector(sel) as HTMLElement;

beforeEach(() => {
  resetStore();
  _resetStudies();
  spy.renderStudies.mockClear();
  spy.selected = null;
  spy.update.mockClear();
  spy.addDrawing.mockClear();
  spy.setInvert.mockClear();
  spy.lock.mockClear();
  spy.side.mockClear();
  spy.maximize.mockClear();
  spy.move.mockClear();
  localStorage.clear();
  vi.mocked(api.fetchHistory).mockImplementation(async (s, i) => history(s, i));
  vi.mocked(api.fetchSymbols).mockResolvedValue([quote('THYAO.IS', 'BIST'), quote('BTCUSDT', 'CRYPTO')]);
});
afterEach(() => cleanup());

async function boot() {
  render(() => <App />);
  await waitFor(() => expect($('#lbl-feed-status').getAttribute('title')).toContain('YAHOO'));
}

describe('Script panel (bar-by-bar runtime)', () => {
  it('runs a script from the editor, shows plots count and honest warnings', async () => {
    await boot();
    const ta = $('#txt-script-code') as HTMLTextAreaElement;
    fireEvent.input(ta, {
      target: {
        value: `//@version=5
indicator("W", overlay=true)
plot(ta.sma(close, 5), title="m")
x = request.security("OTHERSYM", "D", close)
plot(x, title="x")`,
      },
    });
    fireEvent.click($('#btn-run-script'));
    await waitFor(() => expect($('#lbl-script-status').textContent).toContain('W (2 çizim)'));
    const warnings = $('#lst-script-warnings').textContent ?? '';
    expect(warnings).toContain('OTHERSYM');
    expect(warnings).not.toMatch(/henüz çizilmiyor/);
  });

  it('shows runtime errors with the failing line number', async () => {
    await boot();
    fireEvent.input($('#txt-script-code'), {
      target: { value: '//@version=5\nindicator("E")\nplot(undefinedThing)' },
    });
    fireEvent.click($('#btn-run-script'));
    await waitFor(() => expect($('#lbl-script-status').textContent).toContain("Tanımsız değişken 'undefinedThing'"));
    expect($('#lbl-script-status').textContent).toContain('Satır 3');
    expect(document.querySelector('#lst-script-warnings')).toBeNull();
  });
});

describe('App shell (SolidJS)', () => {
  it('renders the terminal and loads the first symbol', async () => {
    await boot();
    expect(api.fetchHistory).toHaveBeenCalledWith('BTCUSDT', '15m');
    expect($('#lbl-top-symbol').textContent).toBe('BTCUSDT');
    expect($('#lbl-feed-delay').textContent).toContain('15 dk gecikmeli');
    expect($('#leg-c').textContent).not.toBe('—');
    expect($('#titan-shell').classList.contains('drawer-collapsed')).toBe(false);
  });

  it('switches timeframe from the top bar', async () => {
    await boot();
    fireEvent.click($('[data-tf-drop="1h"]'));
    await waitFor(() => expect(api.fetchHistory).toHaveBeenCalledWith('BTCUSDT', '1h'));
    await waitFor(() => expect($('[data-tf="1h"]').classList.contains('active')).toBe(true));
    expect($('[data-tf="15m"]').classList.contains('active')).toBe(false);
  });

  it('opens the dropdown timeframe list and picks 30m', async () => {
    await boot();
    fireEvent.click($('#btn-tf-dropdown'));
    expect($('#dropdown-timeframes').classList.contains('open')).toBe(true);
    fireEvent.click($('[data-tf-drop="30m"]'));
    await waitFor(() => expect(api.fetchHistory).toHaveBeenCalledWith('BTCUSDT', '30m'));
    expect($('#dropdown-timeframes').classList.contains('open')).toBe(false);
  });

  it('collapses the drawer by re-clicking the active dock tab and switches tabs', async () => {
    await boot();
    fireEvent.click($('[data-docktab="alerts"]'));
    expect($('#lbl-drawer-title').textContent).toBe('Alarmlar');
    expect($('#drawer-panel-alerts')).toBeTruthy();
    expect(document.querySelector('#drawer-panel-watchlist')).toBeNull();
    fireEvent.click($('[data-docktab="alerts"]'));
    expect($('#titan-shell').classList.contains('drawer-collapsed')).toBe(true);
    fireEvent.click($('[data-docktab="objecttree"]'));
    expect($('#titan-shell').classList.contains('drawer-collapsed')).toBe(false);
    expect($('#obj-tree-list').textContent).toContain('çizim nesnesi yok');
    fireEvent.click($('#btn-close-drawer'));
    expect($('#titan-shell').classList.contains('drawer-collapsed')).toBe(true);
  });

  it('filters the watchlist by market tab', async () => {
    await boot();
    await waitFor(() => expect(document.querySelectorAll('.wl-row')).toHaveLength(2));
    fireEvent.click($('[data-market="CRYPTO"]'));
    await waitFor(() => expect(document.querySelectorAll('.wl-row')).toHaveLength(1));
    expect($('.wl-row').dataset.sym).toBe('BTCUSDT');
  });

  it('opens a paper position from the quick-trade box (server engine) and closes it', async () => {
    tradeSrv.snap = tradeSrv.empty();
    await boot();
    fireEvent.click($('#btn-quick-buy'));
    await waitFor(() => expect($('[data-wbtab="paper"]').classList.contains('active')).toBe(true));
    await waitFor(() => expect(document.querySelectorAll('#paper-positions-tbody tr.paper-pos-row')).toHaveLength(1));
    expect($('#paper-positions-tbody').textContent).toContain('LONG');
    fireEvent.click($('[data-close-pos]'));
    await waitFor(() => expect(document.querySelectorAll('#paper-positions-tbody tr.paper-pos-row')).toHaveLength(0));
    fireEvent.click($('[data-ptab="history"]'));
    expect($('#paper-history-tbody').textContent).toContain('BTCUSDT');
    expect($('#lbl-paper-cash').textContent).toBe('$100000.00');
  });

  it('creates a server price alert through the Standart dialog (no window.prompt) and manages it in the panel', async () => {
    const prompt = vi.spyOn(window, 'prompt');
    alertSrv.list = [];
    await boot();
    fireEvent.click($('#btn-add-alert-top'));
    expect($('#modal-alert .tv-modal-header').textContent).toContain('Alarm oluştur: BTCUSDT, 15m');
    const input = $('#inp-alert-price') as HTMLInputElement;
    fireEvent.input(input, { target: { value: '150.50' } });
    fireEvent.change($('#sel-alert-cond'), { target: { value: 'crossing_up' } });
    fireEvent.click($('#btn-alert-trigger'));
    fireEvent.click($('[data-trigger="once_per_bar_close"]'));
    fireEvent.input($('#inp-alert-name'), { target: { value: 'THY kırılım' } });
    fireEvent.click($('[data-ph="{{close}}"]'));
    fireEvent.click($('[data-alert-tab="notify"]'));
    fireEvent.click($('#chk-alert-webhook'));
    fireEvent.input($('#inp-alert-webhook'), { target: { value: 'https://hooks.example/x' } });
    fireEvent.click($('#btn-alert-create'));
    await waitFor(() => expect(document.querySelector('#modal-alert')).toBeNull());
    const sent = alertSrv.list[0] as Record<string, any>;
    expect(sent.symbol).toBe('BTCUSDT');
    expect(sent.condition).toBe('crossing_up');
    expect(sent.target).toEqual({ kind: 'value', value: 150.5 });
    expect(sent.trigger).toBe('once_per_bar_close');
    expect(sent.message).toBe('{{close}}');
    expect(sent.notify.webhook).toBe('https://hooks.example/x');
    fireEvent.click($('[data-docktab="alerts"]'));
    await waitFor(() => expect($('#alerts-tree-list').textContent).toContain('THY kırılım'));
    expect($('#alerts-tree-list').textContent).toContain('Aktif');
    fireEvent.click($('[data-alert-act="stop"]'));
    await waitFor(() => expect($('#alerts-tree-list').textContent).toContain('Durduruldu'));
    fireEvent.click($('[data-alert-act="clone"]'));
    await waitFor(() => expect(document.querySelectorAll('#alerts-tree-list .alert-item')).toHaveLength(2));
    fireEvent.click($('[data-alert-act="edit"]'));
    expect($('#modal-alert .tv-modal-header').textContent).toContain('Alarmı düzenle');
    fireEvent.click($('#btn-alert-cancel'));
    for (const b of Array.from(document.querySelectorAll('[data-del-alert]'))) fireEvent.click(b);
    await waitFor(() => expect($('#alerts-tree-list').textContent).toContain('Alarm yok'));
    expect(prompt).not.toHaveBeenCalled();
  });

  it('opens symbol search with ⌘K and closes with Escape', async () => {
    await boot();
    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    expect($('#titan-symbol-search-modal')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(document.querySelector('#titan-symbol-search-modal')).toBeNull();
  });

  it('indicator modal toggles chart indicators and the legend follows', async () => {
    await boot();
    expect(document.querySelector('[data-ind-row]')).toBeNull(); // varsayılan: yalnız varsayılan betik
    expect(document.querySelector('[data-ind-row="bb"]')).toBeNull();
    fireEvent.click($('#btn-open-fx-modal'));
    fireEvent.click($('[data-fx-nav="quick"]'));
    fireEvent.click($('[data-fx-ind="bb"]'));
    expect(document.querySelector('[data-ind-row="bb"]')).toBeTruthy();
    fireEvent.click($('[data-ind-remove="bb"]'));
    expect(document.querySelector('[data-ind-row="bb"]')).toBeNull();
  });

  it('save layout persists and a fresh boot restores it', async () => {
    await boot();
    fireEvent.click($('[data-tf-drop="1h"]'));
    await waitFor(() => expect($('[data-tf="1h"]').classList.contains('active')).toBe(true));
    fireEvent.click($('#btn-save-layout'));
    expect(JSON.parse(localStorage.getItem('titanview_layout_v3')!).interval).toBe('1h');
    cleanup();
    resetStore();
    vi.mocked(api.fetchHistory).mockClear();
    render(() => <App />);
    await waitFor(() => expect(api.fetchHistory).toHaveBeenCalledWith('BTCUSDT', '1h'));
  });
});

describe('Chart layouts 1x1 / 2x1 / 2x2 (Faz 7 → Faz 25 seçici)', () => {
  it('switches panes via Standart layout grid menu, each secondary loads its own symbol, symbol change reloads only that pane', async () => {
    await boot();
    const panes = () => document.querySelectorAll('.secondary-chart-pane').length;
    expect(panes()).toBe(0);
    vi.mocked(api.fetchHistory).mockClear();

    fireEvent.click($('#btn-split-layout'));
    fireEvent.click($('[data-layout-id="2x1"]'));
    expect(ui.layout).toBe('2x1');
    await waitFor(() => expect(panes()).toBe(1));
    await waitFor(() => expect(api.fetchHistory).toHaveBeenCalledWith('ETHUSDT', '15m'));
    expect($('.charts-grid-area').classList.contains('split-2x1')).toBe(true);

    fireEvent.click($('#btn-split-layout'));
    fireEvent.click($('[data-layout-id="2x2"]'));
    expect(ui.layout).toBe('2x2');
    await waitFor(() => expect(panes()).toBe(3));
    await waitFor(() => {
      expect(api.fetchHistory).toHaveBeenCalledWith('SOLUSDT', '15m');
      expect(api.fetchHistory).toHaveBeenCalledWith('BNBUSDT', '15m');
    });
    expect($('.charts-grid-area').classList.contains('split-2x2')).toBe(true);

    vi.mocked(api.fetchHistory).mockClear();
    fireEvent.change($('#sel-sec-symbol-3'), { target: { value: 'NVDA' } });
    await waitFor(() => expect(api.fetchHistory).toHaveBeenCalledWith('NVDA', '15m'));
    expect(ui.secondarySymbols).toEqual(['ETHUSDT', 'SOLUSDT', 'NVDA']);
    expect(api.fetchHistory).toHaveBeenCalledTimes(1);

    fireEvent.click($('#btn-split-layout'));
    fireEvent.click($('[data-layout-id="single"]'));
    expect(ui.layout).toBe('single');
    await waitFor(() => expect(panes()).toBe(0));
  });

  it('layout survives save + fresh boot', async () => {
    await boot();
    fireEvent.click($('#btn-split-layout'));
    fireEvent.click($('[data-layout-id="2x2"]'));
    fireEvent.click($('#btn-save-layout'));
    expect(JSON.parse(localStorage.getItem('titanview_layout_v3')!).layout).toBe('2x2');
    cleanup();
    resetStore();
    render(() => <App />);
    await waitFor(() => expect(ui.layout).toBe('2x2'));
  });
});

describe('failure visibility (Faz 0 e2e maddesi)', () => {
  it('shows an explicit error banner when the backend is down, never fake candles', async () => {
    vi.mocked(api.fetchHistory).mockRejectedValue(new Error('History API error: 502'));
    render(() => <App />);
    const banner = await screen.findByRole('alert');
    expect(banner.textContent).toContain('Veri alınamadı');
    expect(banner.textContent).toContain('502');
    expect($('#leg-ohlc').textContent).toContain('Veri yok');
    expect($('#lbl-feed-status').textContent).toBe('VERİ YOK');
  });

  it('recovers once the backend returns', async () => {
    vi.mocked(api.fetchHistory).mockRejectedValueOnce(new Error('down'));
    render(() => <App />);
    await screen.findByRole('alert');
    fireEvent.click($('[data-tf-drop="5m"]'));
    await waitFor(() => expect(document.querySelector('.chart-error')).toBeNull());
    expect($('#leg-c').textContent).not.toBe('—');
  });
});

describe('Faz 4 — shortcuts, properties bar, context menu, chart types', () => {
  it('Alt+T / Alt+H / Alt+J pick tools, Escape returns to the cursor', async () => {
    await boot();
    fireEvent.keyDown(window, { key: 't', code: 'KeyT', altKey: true });
    expect(ui.tool).toBe('trendline');
    fireEvent.keyDown(window, { key: 'h', code: 'KeyH', altKey: true });
    expect(ui.tool).toBe('hline');
    fireEvent.keyDown(window, { key: 'j', code: 'KeyJ', altKey: true });
    expect(ui.tool).toBe('hray');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(ui.tool).toBe('cursor');
  });

  it('Alt+R fits the chart; shortcuts are ignored while typing in an input', async () => {
    await boot();
    spy.fit.mockClear();
    fireEvent.keyDown(window, { key: 'r', code: 'KeyR', altKey: true });
    expect(spy.fit).toHaveBeenCalledTimes(1);
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    fireEvent.keyDown(window, { key: 't', code: 'KeyT', altKey: true });
    expect(ui.tool).toBe('cursor');
    input.remove();
  });

  it('left bar offers the new tools in the flyouts', async () => {
    await boot();
    for (const t of ['extended', 'info_line', 'arrow', 'hray', 'pitchfork', 'price_label', 'price_range', 'date_range']) {
      expect($(`[data-subtool="${t}"]`), t).toBeTruthy();
    }
    fireEvent.click($('[data-subtool="pitchfork"]'));
    expect(ui.tool).toBe('pitchfork');
  });

  it('Faz 21: Standart gruplarında 33 yeni araç seçilebilir; Enter yol taslağını bitirir', async () => {
    await boot();
    const tools = [
      'trend_angle', 'cross_line', 'regression', 'flat_channel', 'disjoint_channel',
      'schiff_pitchfork', 'mod_schiff_pitchfork', 'inside_pitchfork',
      'fib_channel', 'fib_timezone', 'fib_speed_fan', 'fib_trend_time', 'fib_circles', 'fib_spiral', 'fib_speed_arcs', 'fib_wedge', 'fib_pitchfan',
      'gann_box', 'gann_square_fixed', 'gann_square', 'gann_fan',
      'highlighter', 'arrow_marker', 'arrow_up', 'arrow_down', 'rotated_rect', 'path', 'circle', 'polyline', 'triangle', 'arc', 'curve', 'double_curve',
    ];
    for (const t of tools) {
      const btn = $(`[data-subtool="${t}"]`);
      expect(btn, t).toBeTruthy();
      expect(btn.querySelector('svg'), `${t} ikonu`).toBeTruthy();
      fireEvent.click(btn);
      expect(ui.tool).toBe(t);
    }
    const sections = Array.from(document.querySelectorAll('.tool-flyout-section')).map((e) => e.textContent);
    expect(sections).toEqual(expect.arrayContaining(['Çizgiler', 'Kanallar', 'Pitchfork', 'Fibonacci', 'Gann', 'Fırçalar', 'Oklar', 'Şekiller']));
    // Fib grubu seçilen alt aracı gösterir
    expect(ui.groupTool.fib).toBe('gann_fan');
    expect($('[data-subtool="gann_fan"]').classList.contains('active')).toBe(true);
    expect($('.tool-btn[data-tool="gann_fan"]')).toBeTruthy();
    spy.finishDraft.mockReturnValueOnce({ id: 'p' });
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(spy.finishDraft).toHaveBeenCalled();
  });

  it('properties bar edits the selected drawing: width, line style, label, lock', async () => {
    await boot();
    spy.selected = { id: 'd1' };
    setSelectedDrawing({ id: 'd1', symbol: 'THYAO.IS', timeframe: '15m', toolType: 'trendline', points: [], color: '#0284C7' });
    await waitFor(() => expect($('#sel-draw-width')).toBeTruthy());
    fireEvent.change($('#sel-draw-width'), { target: { value: '3' } });
    expect(spy.update).toHaveBeenLastCalledWith({ width: 3 });
    fireEvent.change($('#sel-draw-style'), { target: { value: 'dashed' } });
    expect(spy.update).toHaveBeenLastCalledWith({ lineStyle: 'dashed' });
    fireEvent.change($('#inp-draw-label'), { target: { value: 'Destek' } });
    expect(spy.update).toHaveBeenLastCalledWith({ label: 'Destek' });
    fireEvent.click($('#btn-draw-lock'));
    expect(spy.update).toHaveBeenLastCalledWith({ locked: true });
    // "otomatik" geri döner: undefined → varsayılan stile dönüş
    fireEvent.change($('#sel-draw-width'), { target: { value: '0' } });
    expect(spy.update).toHaveBeenLastCalledWith({ width: undefined });
  });

  it('right-click menu: alert at price, horizontal line at price, invert scale, closes on outside click', async () => {
    await boot();
    fireEvent.contextMenu($('#main-chart-wrap'), { clientX: 200, clientY: 150 });
    await waitFor(() => expect($('#chart-ctx-menu')).toBeTruthy());
    expect($('#ctx-alert').textContent).toContain('123.45');
    fireEvent.click($('#ctx-alert'));
    expect($('#chart-ctx-menu')).toBeNull();
    // Faz 23: varsayılan olarak alarm penceresi o fiyatla açılır (sunucu alarmı)
    expect(($('#inp-alert-price') as HTMLInputElement).value).toBe('123.45');
    fireEvent.click($('#btn-alert-create'));
    await waitFor(() => expect(document.querySelector('#titan-toast')!.textContent).toContain('Alarm kuruldu'));

    fireEvent.contextMenu($('#main-chart-wrap'), { clientX: 200, clientY: 150 });
    await waitFor(() => expect($('#ctx-hline')).toBeTruthy());
    fireEvent.click($('#ctx-hline'));
    expect(spy.addDrawing).toHaveBeenCalledWith(
      expect.objectContaining({ toolType: 'hline', points: [{ time: 1_700_000_000, price: 123.45 }] })
    );

    fireEvent.contextMenu($('#main-chart-wrap'), { clientX: 200, clientY: 150 });
    await waitFor(() => expect($('#ctx-invert')).toBeTruthy());
    fireEvent.click($('#ctx-invert'));
    expect(spy.setInvert).toHaveBeenCalledWith(true);
    expect(ui.invertScale).toBe(true);

    fireEvent.contextMenu($('#main-chart-wrap'), { clientX: 10, clientY: 10 });
    await waitFor(() => expect($('#chart-ctx-menu')).toBeTruthy());
    fireEvent.click(document.body);
    expect($('#chart-ctx-menu')).toBeNull();
  });

  it('chart style menu lists Renko, Line Break, Range, Step line and marker line', async () => {
    await boot();
    fireEvent.click($('#btn-chart-style-trigger'));
    await waitFor(() => expect($('#dropdown-chart-styles')).toBeTruthy());
    const text = $('#dropdown-chart-styles').textContent ?? '';
    for (const label of ['Renko', 'Çizgi kırılımı', 'Range', 'Basamak', 'İşaretli']) expect(text).toContain(label);
  });
});

describe('Faz 16 — grafik tipleri', () => {
  it('menü Standart gruplarıyla 21 tipi listeler ve ayırıcılar koyar', async () => {
    await boot();
    fireEvent.click($('#btn-chart-style-trigger'));
    await waitFor(() => expect($('#dropdown-chart-styles')).toBeTruthy());
    const items = document.querySelectorAll('#dropdown-chart-styles [data-style]');
    expect(items.length).toBe(21);
    for (const m of ['volcandles', 'hlcarea', 'columns', 'highlow', 'kagi', 'pnf', 'svp', 'tpo', 'footprint']) {
      expect(document.querySelector(`#dropdown-chart-styles [data-style="${m}"]`)).toBeTruthy();
    }
    expect(document.querySelectorAll('#dropdown-chart-styles .flyout-sep').length).toBe(6);
  });
  it('footprint (BIST): yaklaşık footprint verisi grafiğe gider (işlem akışı yok)', async () => {
    await boot();
    fireEvent.click($('#btn-chart-style-trigger'));
    fireEvent.click($('#dropdown-chart-styles [data-style="footprint"]'));
    await waitFor(() => expect(spy.footprint).toHaveBeenCalled(), { timeout: 2000 });
    const [map, row] = spy.footprint.mock.calls.at(-1) as [Map<number, { approx?: boolean }>, number];
    expect(row).toBeGreaterThan(0);
    expect(map.size).toBeGreaterThan(0);
    expect([...map.values()][0].approx).toBe(true);
    expect(api.fetchFootprint).not.toHaveBeenCalled();
  });
  it('grafik tipi ayarları: Sembol sekmesi, kaydedince parametre uygulanır', async () => {
    await boot();
    fireEvent.click($('#btn-chart-style-trigger'));
    fireEvent.click($('#btn-style-settings'));
    await waitFor(() => expect($('#style-params-form')).toBeTruthy());
    const sel = $('[data-stp="renko.mode"]') as HTMLSelectElement;
    sel.value = 'fixed';
    fireEvent.change(sel);
    const box = $('[data-stp="renko.box"]') as HTMLInputElement;
    box.value = '2.5';
    fireEvent.change(box);
    fireEvent.click($('#btn-save-settings'));
    await waitFor(() => expect(ui.styleParams.renko).toMatchObject({ mode: 'fixed', box: 2.5 }));
  });
});

describe('Faz 12 — Analiz paneli', () => {
  const analysisResp = () => ({
    info: { symbol: 'THYAO.IS', displayName: 'THY', market: 'BIST', exchange: 'BIST', currency: 'TRY', delayMinutes: 15 },
    benchmark: 'XU100.IS',
    mtfAgreement: 'yukarı uyumlu',
    lastBarTime: 1_700_000_000,
    mtf: [
      { tf: '15m', dir: 'up', score: 3, rsi: 61, bars: 100, detail: 'EMA20 > EMA50' },
      { tf: '1h', dir: 'up', score: 2, rsi: 58, bars: 100, detail: '' },
      { tf: '4h', dir: 'flat', score: 0, rsi: 50, bars: 100, detail: '' },
      { tf: '1d', dir: 'up', score: 3, rsi: 64, bars: 400, detail: '' },
      { tf: '1w', dir: 'na', score: 0, bars: 0, detail: 'Yeterli veri yok' },
    ],
    analysis: {
      score: 55, bias: 'Güçlü yükseliş eğilimi', voteScore: 50, buy: 6, sell: 1, neutral: 2,
      votes: [
        { key: 'ema20', group: 'trend', name: 'EMA 20', value: '290', vote: 1, detail: 'Fiyat EMA20 üstünde' },
        { key: 'rsi', group: 'momentum', name: 'RSI 14', value: '71.0', vote: -1, detail: 'Aşırı alım' },
        { key: 'cmf', group: 'volume', name: 'CMF 20', value: '+0.05', vote: 0, detail: 'nötr' },
      ],
      projection: {
        sigmaDailyPct: 1.8, note: 'Sürüklenmesiz koni',
        cones: [
          { days: 1, lo68: 294, hi68: 306, lo95: 289, hi95: 311 },
          { days: 5, lo68: 285, hi68: 316, lo95: 272, hi95: 330 },
          { days: 20, lo68: 265, hi68: 340, lo95: 240, hi95: 375 },
        ],
        atrTargets: [{ label: '+1 ATR', price: 309, distPct: 3 }, { label: '−1 ATR', price: 291, distPct: -3 }],
        fibTargets: [{ label: 'Fib 0.618 geri çekilme', price: 280, distPct: -6.7 }],
      },
      analog: { condition: 'RSI 71±7', n: 42, note: 'bağlam', h5: { horizon: 5, meanPct: 0.8, medianPct: 0.6, hitPct: 57, p10Pct: -4, p90Pct: 5 }, h20: { horizon: 20, meanPct: 2.1, medianPct: 1.9, hitPct: 61, p10Pct: -8, p90Pct: 11 } },
      profile: { poc: 295, vah: 305, val: 285, bins: [{ price: 285, volume: 10 }, { price: 295, volume: 50 }, { price: 305, volume: 20 }] },
      regime: { trend: 'trend-up', adx: 31.2, volatility: 'sıkışma', rangePos52w: 88 },
      flow: { obvSlopePct: 22, cmf20: 0.05, relVolume: 1.5, divergence: 'bearish' },
      gaps: { days: 400, up: { n: 12, avgPct: 1.1, fillPct: 60 }, down: { n: 9, avgPct: -1.3, fillPct: 55 }, monday: { n: 5, avgPct: 0.9, fillPct: 40 }, lastGapPct: 0.4, thresholdPct: 0.3 },
      insights: {
        bars: 400, last: 300, score: 62, bias: 'Güçlü yükseliş eğilimi', tags: ['uptrend', 'breakout'],
        signals: [
          { key: 'trend', label: 'Güçlü yükseliş trendi', tone: 'bull' as const, detail: 'Fiyat > SMA50 > SMA200', weight: 30 },
          { key: 'squeeze', label: 'Bollinger sıkışması', tone: 'warn' as const, detail: 'dar', weight: 0 },
        ],
        metrics: { rsi14: 61.2, sma50: 280, sma200: 250, z20: 1.1, bbWidthPctile: 8, atrPctile: 40, relVolume: 1.5, momentum121: 22, relStrength3m: 7.5, var95Pct: -2.4, drawdownPct: -3, daysSincePeak: 2, streak: 3 },
        support: [{ price: 285, touches: 3, distPct: -5 }],
        resistance: [{ price: 320, touches: 2, distPct: 6.67 }],
        weekday: [null, null, null, null, null, null, null],
        month: Array(12).fill(null),
      },
    },
  });

  it('sembol açılınca analiz kendiliğinden yüklenir: skor, MTF, projeksiyon, oylar, seviyeler, + çizgi', async () => {
    vi.mocked(api.fetchAnalysis).mockResolvedValue(analysisResp() as never);
    await boot();
    await waitFor(() => expect($('#an-score').textContent).toBe('+55'));
    expect(api.fetchAnalysis).toHaveBeenCalledWith('BTCUSDT');
    expect($('#an-bias').textContent).toContain('Güçlü yükseliş eğilimi');
    expect(document.querySelectorAll('[data-mtf]').length).toBeGreaterThanOrEqual(5);
    expect(($('[data-mtf="4h"]') as HTMLElement).dataset.dir).toBe('flat');
    expect($('#an-cones').textContent).toContain('20 gün');
    expect(document.querySelector('[data-vote="rsi"]')).toBeTruthy();
    expect(document.querySelector('[data-divergence="bearish"]')).toBeTruthy();
    expect($('#an-analog').textContent).toContain('20 gün');
    expect(document.querySelector('#an-gaps')).toBeNull(); // varsayılan kapalı bölüm
    fireEvent.click($('[data-an-sec="gaps"] .an-sec-head'));
    expect($('#an-gaps').textContent).toContain('Pazartesi');
    expect($('#an-root').textContent).toContain('Fiyat > SMA50 > SMA200');
    expect(document.querySelector('[data-level-line="320"]')).toBeTruthy();
    expect(document.querySelector('[data-level-line="295"]')).toBeTruthy(); // POC
  });

  it('sembol değişince analiz yeni sembol için yeniden istenir', async () => {
    vi.mocked(api.fetchAnalysis).mockResolvedValue(analysisResp() as never);
    await boot();
    await waitFor(() => expect(api.fetchAnalysis).toHaveBeenCalledWith('BTCUSDT'));
    fireEvent.click($('[data-sym="THYAO.IS"]'));
    await waitFor(() => expect(api.fetchAnalysis).toHaveBeenCalledWith('THYAO.IS'));
    expect(api.fetchRelated).toHaveBeenCalledWith('THYAO.IS');
    expect(api.fetchFlow).toHaveBeenCalledWith('THYAO.IS');
  });

  it('ilişkiler ve haber/akış bölümleri gelir; satıra tıklamak sembole geçer', async () => {
    vi.mocked(api.fetchAnalysis).mockResolvedValue(analysisResp() as never);
    vi.mocked(api.fetchRelated).mockResolvedValue({
      positive: [{ symbol: 'ASELS.IS', displayName: 'Aselsan', market: 'BIST', r90: 0.82, r30: 0.9, delta: 0.08, n: 90 }],
      negative: [{ symbol: 'GC=F', displayName: 'Altın', market: 'FOREX', r90: -0.4, n: 90 }],
      cross: [], beta: 1.2, benchmark: 'XU100.IS', benchR90: 0.7, note: 'n',
    } as never);
    vi.mocked(api.fetchFlow).mockResolvedValue({
      tone: { pos: 2, neg: 1, neutral: 1, score: 25, label: 'Olumlu ağırlıklı', note: 'n', items: [{ title: 'THY rekor kâr', tone: 1, matched: ['+rekor'] }] },
      news: [{ title: 'THY rekor kâr', publisher: 'P', link: 'https://x/1', time: 1 }],
    } as never);
    await boot();
    await waitFor(() => expect($('#an-rel-pos').textContent).toContain('ASELS'));
    expect($('#an-rel-neg').textContent).toContain('GC=F');
    expect($('#an-bench').textContent).toContain('beta 1.20');
    await waitFor(() => expect($('#an-tone')).toBeTruthy());
    fireEvent.click($('[data-rel-sym="ASELS.IS"]'));
    await waitFor(() => expect(api.fetchHistory).toHaveBeenCalledWith('ASELS.IS', '15m'));
  });

  it('analiz hatası bannerda görünür, sahte skor çizilmez', async () => {
    vi.mocked(api.fetchAnalysis).mockRejectedValue(new Error('Analiz: 502 not enough daily history'));
    await boot();
    await waitFor(() => expect($('[data-term-error]').textContent).toContain('502'));
    expect(document.querySelector('#an-score')).toBeNull();
  });

  it('Analiz sekmesi (geniş görünüm) sağlı sollu sütunlarla açılır; araç kısayolları sekmeleri açar', async () => {
    vi.mocked(api.fetchAnalysis).mockResolvedValue(analysisResp() as never);
    await boot();
    fireEvent.click($('[data-wbtab="insight"]'));
    await waitFor(() => expect($('#an-root-wide #an-score').textContent).toBe('+55'));
    expect($('#an-root-wide').classList.contains('an-wide')).toBe(true);
    const heat = [...document.querySelectorAll('#an-root-wide .an-tools button')].find((b) => b.textContent === 'Isı haritası') as HTMLElement;
    fireEvent.click(heat);
    expect($('[data-wbtab="market"]').classList.contains('active')).toBe(true);
  });

  it('Fikirler: etikete göre süzer, satıra tıklamak grafiği ve içgörüyü açar', async () => {
    const row = (symbol: string, score: number, tags: string[]) => ({
      symbol, displayName: symbol, market: 'BIST', last: 10, change1d: 1.5, score, bias: 'Yükseliş eğilimi', tags, rsi14: 55, relVolume: 1.2,
      signals: [{ key: 'k', label: `${symbol} sinyal`, tone: 'bull' as const, detail: '', weight: 10 }],
    });
    vi.mocked(api.fetchIdeas).mockResolvedValue([row('THYAO.IS', 70, ['breakout']), row('ASELS.IS', 20, ['squeeze'])]);
    await boot();
    fireEvent.click($('[data-wbtab="ideas"]'));
    await waitFor(() => expect(document.querySelectorAll('.idea-row').length).toBe(2));
    expect(api.fetchIdeas).toHaveBeenCalledWith('ALL');
    fireEvent.click($('[data-idea-tag="squeeze"]'));
    expect(document.querySelectorAll('.idea-row').length).toBe(1);
    expect(($('.idea-row') as HTMLElement).dataset.ideaSym).toBe('ASELS.IS');
    fireEvent.click($('.idea-row'));
    await waitFor(() => expect(api.fetchHistory).toHaveBeenCalledWith('ASELS.IS', '15m'));
    expect($('[data-wbtab="insight"]').classList.contains('active')).toBe(true);
  });

  it('Tablo, Strateji içinde alt sekme; üst sekme şeridinde ayrı Tablo yok, analiz sekmeleri menüde', async () => {
    await boot();
    expect($('[data-wbtab="titan"]')).toBeNull();
    fireEvent.click($('[data-wbtab="backtest"]'));
    fireEvent.click($('[data-strat-tab="table"]'));
    await waitFor(() => expect($('#script-tables-view')).toBeTruthy());
    expect(document.querySelector('.script-table')).toBeNull(); // grafik SVG'sinde tablo yok
    expect($('#wb-analysis-menu').querySelectorAll('[data-wbtab]').length).toBe(7);
    expect($('.wb-tabs').querySelectorAll(':scope > [data-wbtab]').length).toBe(4); // betik, strateji, tarayıcı, paper
    expect($('.wb-script-controls').classList.contains('hidden')).toBe(true);
    fireEvent.click($('[data-strat-tab="overview"]')); // modül düzeyi sinyal: sonraki testler için sıfırla
    fireEvent.click($('[data-wbtab="script"]'));
    expect($('.wb-script-controls').classList.contains('hidden')).toBe(false);
  });

  it('komut çubuğu: INS ve IDEAS', async () => {
    vi.mocked(api.fetchIdeas).mockResolvedValue([]);
    await boot();
    fireEvent.keyDown(document, { key: '/', ctrlKey: true });
    const input = $('#command-input') as HTMLInputElement;
    input.value = 'AAPL INS';
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(api.fetchAnalysis).toHaveBeenCalledWith('AAPL'));
    expect($('[data-wbtab="insight"]').classList.contains('active')).toBe(true);
  });
});

describe('Faz 5 — terminal katmanı', () => {
  const ov = (symbol: string, change1d: number | null, turnover: number) => ({
    symbol, displayName: `${symbol} name`, market: 'BIST' as const, currency: 'TRY', lastPrice: 10,
    change1d, change1w: 2, change1m: 3, turnover,
  });

  it('Piyasa sekmesi ısı haritası çizer; kutuya tıklamak grafiği değiştirir', async () => {
    vi.mocked(api.fetchOverview).mockResolvedValue([ov('THYAO.IS', 2.5, 900), ov('ASELS.IS', -1.2, 300)]);
    await boot();
    fireEvent.click($('[data-wbtab="market"]'));
    await waitFor(() => expect(document.querySelectorAll('.heat-tile').length).toBe(2));
    expect(api.fetchOverview).toHaveBeenCalledWith('ALL');
    const tiles = [...document.querySelectorAll<HTMLElement>('.heat-tile')];
    const big = tiles.find((t) => t.dataset.heatSym === 'THYAO.IS')!;
    const small = tiles.find((t) => t.dataset.heatSym === 'ASELS.IS')!;
    const area = (t: HTMLElement) => parseFloat(t.style.width) * parseFloat(t.style.height);
    expect(area(big)).toBeGreaterThan(area(small)); // log ağırlık: büyük hacim hâlâ daha büyük kutu
    expect(area(small)).toBeGreaterThan(100); // ama küçük olan yok olmaz
    expect(big.textContent).toContain('+2.50%');
    expect(small.textContent).toContain('-1.20%');
    fireEvent.click(small);
    await waitFor(() => expect(api.fetchHistory).toHaveBeenCalledWith('ASELS.IS', '15m'));
  });

  it('piyasa özeti hatası bannerda görünür, sahte kutu çizilmez', async () => {
    vi.mocked(api.fetchOverview).mockRejectedValue(new Error('Piyasa özeti: 502'));
    await boot();
    fireEvent.click($('[data-wbtab="market"]'));
    await waitFor(() => expect($('[data-term-error]').textContent).toContain('502'));
    expect(document.querySelectorAll('.heat-tile').length).toBe(0);
  });

  it('Korelasyon matrisi renkli hücreleri ve boş hücreyi gösterir', async () => {
    vi.mocked(api.fetchCorrelation).mockResolvedValue({ symbols: ['THYAO.IS', 'BTCUSDT'], days: 250, matrix: [[1, -0.42], [-0.42, null]] });
    await boot();
    fireEvent.click($('[data-wbtab="corr"]'));
    await waitFor(() => expect(document.querySelectorAll('.corr-cell').length).toBe(4));
    const cells = [...document.querySelectorAll<HTMLElement>('.corr-cell')].map((c) => c.textContent);
    expect(cells).toEqual(['1.00', '-0.42', '-0.42', '—']);
    expect(api.fetchCorrelation).toHaveBeenCalled();
  });

  it('Künye paneli istatistik + beta + haberleri listeler', async () => {
    vi.mocked(api.fetchSecurity).mockResolvedValue({
      info: { symbol: 'THYAO.IS', displayName: 'Türk Hava Yolları', market: 'BIST', exchange: 'BIST', currency: 'TRY', delayMinutes: 15 },
      stats: { last: 300, change1d: 1.5, change1w: null, change1m: -2, change3m: 5, changeYtd: 10, change1y: 40, high52w: 320, low52w: 200, fromHighPct: -6.25, volAnnualPct: 32.1, maxDrawdownPct: -18, atr14Pct: 2.2, bars: 250 },
      beta: 1.12,
      benchmark: 'XU100.IS',
    });
    vi.mocked(api.fetchNews).mockResolvedValue([{ title: 'THY rekor', publisher: 'Reuters', link: 'https://x/1', time: 1_700_000_000 }]);
    await boot();
    fireEvent.click($('[data-wbtab="des"]'));
    await waitFor(() => expect($('#des-table').textContent).toContain('Beta (XU100.IS)'));
    const t = $('#des-table').textContent ?? '';
    expect(t).toContain('+1.50%');
    expect(t).toContain('-18.00%');
    expect(t).toContain('1.12');
    await waitFor(() => expect(document.querySelector('.news-list a')?.getAttribute('href')).toBe('https://x/1'));
    expect(document.querySelector('.news-list a')?.getAttribute('rel')).toContain('noopener');
  });

  it('komut çubuğu: Ctrl+/ açar, "AAPL DES" künyeyi açar, bilinmeyen komut hata gösterir', async () => {
    vi.mocked(api.fetchSecurity).mockResolvedValue({
      info: { symbol: 'AAPL', displayName: 'Apple', market: 'US', exchange: 'NASDAQ', currency: 'USD', delayMinutes: 15 },
      stats: { last: 200, change1d: 0.5, change1w: 1, change1m: 2, change3m: 3, changeYtd: 4, change1y: 5, high52w: 210, low52w: 150, fromHighPct: -4, volAnnualPct: 25, maxDrawdownPct: -10, atr14Pct: 1.5, bars: 250 },
    });
    vi.mocked(api.fetchNews).mockResolvedValue([]);
    await boot();
    fireEvent.keyDown(document, { key: '/', ctrlKey: true });
    const input = $('#command-input') as HTMLInputElement;
    expect(input).toBeTruthy();
    fireEvent.input(input, { target: { value: 'AAPL XYZ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect($('#command-error').textContent).toContain('Bilinmeyen komut');
    expect(ui.modal).toBe('command');
    input.value = 'AAPL DES';
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(api.fetchSecurity).toHaveBeenCalledWith('AAPL'));
    await waitFor(() => expect(api.fetchHistory).toHaveBeenCalledWith('AAPL', '15m'));
    expect(ui.modal).toBeNull();
    expect(ui.wbTab).toBe('des');
  });

  it('komut çubuğu Escape ile kapanır', async () => {
    await boot();
    fireEvent.keyDown(document, { key: '/', metaKey: true });
    fireEvent.keyDown($('#command-input'), { key: 'Escape' });
    expect(ui.modal).toBeNull();
  });
});

describe('Mobile layout (Faz 6)', () => {
  const setWidth = (w: number) => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: w });
  };
  afterEach(() => setWidth(1024));

  it('narrow viewport collapses side panels and shows the bottom-bar extras', async () => {
    setWidth(390);
    await boot();
    expect($('#titan-shell').classList.contains('is-mobile')).toBe(true);
    expect($('#titan-shell').classList.contains('drawer-collapsed')).toBe(true);
    expect($('#script-workbench').classList.contains('collapsed')).toBe(true);
    expect($('[data-mobile-nav="tools"]')).toBeTruthy();
    expect($('[data-mobile-nav="workbench"]')).toBeTruthy();
  });

  it('desktop width has no mobile nav and keeps the watchlist open', async () => {
    setWidth(1280);
    await boot();
    expect($('#titan-shell').classList.contains('is-mobile')).toBe(false);
    expect(document.querySelector('[data-mobile-nav]')).toBeNull();
    expect($('#titan-shell').classList.contains('drawer-collapsed')).toBe(false);
  });

  it('tools panel opens from the bottom bar and closes after picking a drawing tool', async () => {
    setWidth(390);
    await boot();
    fireEvent.click($('[data-mobile-nav="tools"]'));
    expect($('#titan-shell').classList.contains('tools-open')).toBe(true);
    fireEvent.click($('.titan-leftbar [data-tool="fib"]'));
    expect(ui.tool).toBe('fib');
    expect($('#titan-shell').classList.contains('tools-open')).toBe(false);
  });

  it('tapping the active tool group again opens its sub-tool flyout (no hover on touch)', async () => {
    setWidth(390);
    await boot();
    fireEvent.click($('[data-mobile-nav="tools"]'));
    const btn = $('.titan-leftbar [data-tool="trendline"]');
    fireEvent.click(btn);
    fireEvent.click($('[data-mobile-nav="tools"]'));
    fireEvent.click(btn); // etkin grup → flyout
    const flyout = btn.parentElement!.querySelector('.tool-flyout')!;
    expect(flyout.classList.contains('open')).toBe(true);
    fireEvent.click(flyout.querySelector('[data-subtool="ray"]')!);
    expect(ui.tool).toBe('ray');
    expect(flyout.classList.contains('open')).toBe(false);
  });

  it('opening a dock panel closes tools/workbench overlays; picking a symbol closes the panel', async () => {
    setWidth(390);
    await boot();
    fireEvent.click($('[data-mobile-nav="workbench"]'));
    expect($('#script-workbench').classList.contains('collapsed')).toBe(false);
    fireEvent.click($('[data-docktab="watchlist"]'));
    expect($('#script-workbench').classList.contains('collapsed')).toBe(true);
    expect($('#titan-shell').classList.contains('drawer-collapsed')).toBe(false);
    fireEvent.click($('[data-tf-drop="1h"]'));
    await waitFor(() => expect($('#titan-shell').classList.contains('drawer-collapsed')).toBe(true));
  });

  it('resizing between breakpoints toggles layout state', async () => {
    setWidth(1280);
    await boot();
    setWidth(400);
    window.dispatchEvent(new Event('resize'));
    expect($('#titan-shell').classList.contains('is-mobile')).toBe(true);
    setWidth(1280);
    window.dispatchEvent(new Event('resize'));
    expect($('#titan-shell').classList.contains('is-mobile')).toBe(false);
    expect($('#titan-shell').classList.contains('drawer-collapsed')).toBe(false);
  });

  it('shows an offline banner and hides it when the network returns', async () => {
    await boot();
    expect(document.querySelector('#offline-banner')).toBeNull();
    window.dispatchEvent(new Event('offline'));
    await waitFor(() => expect(document.querySelector('#offline-banner')).toBeTruthy());
    window.dispatchEvent(new Event('online'));
    await waitFor(() => expect(document.querySelector('#offline-banner')).toBeNull());
  });
});

describe('Script legend row', () => {
  it('shows the loaded default script on the chart and opens the editor', async () => {
    await boot();
    await waitFor(() => expect($('#script-legend-row')).toBeTruthy()); // TitanScript mumlardan sonra çalışır
    const row = $('#script-legend-row');
    expect(row.textContent).toContain('EMA 9/21');
    expect(row.textContent).toContain('yüklü');
    fireEvent.click($('#btn-script-legend-edit'));
    expect(ui.wbTab).toBe('script');
  });
});

describe('Strategy tester report (standard broker model)', () => {
  it('opens with the default script and no leftover EMA/VPVR rows; report tabs show real stats', async () => {
    await boot();
    expect(document.querySelector('[data-ind-row]')).toBeNull(); // EMA9/EMA21/VPVR kaldırıldı
    await waitFor(() => expect($('#script-legend-row')).toBeTruthy());
    expect($('#script-legend-row').textContent).toContain('EMA 9/21');
    fireEvent.click($('[data-wbtab="backtest"]'));
    // sentetik mumlarda strateji işlem üretmeyebilir: o zaman açık boş-durum mesajı olmalı
    const hasReport = document.querySelector('#strat-kpis');
    if (!hasReport) {
      expect($('#strat-empty').textContent).toBeTruthy();
      return;
    }
    for (const tab of ['perf', 'trades', 'props', 'overview']) {
      fireEvent.click($(`[data-strat-tab="${tab}"]`));
    }
    expect($('#kpi-net')).toBeTruthy();
  });

  it('old saved layouts (v2 with EMA flags) are ignored', async () => {
    localStorage.setItem('titanview_layout_v2', JSON.stringify({ quickFlags: { ema9: true, ema21: true, vpvr: true } }));
    await boot();
    expect(document.querySelector('[data-ind-row="ema9"]')).toBeNull();
  });
});

describe('Correlation per market', () => {
  it('market chips load that market only and show strongest pairs', async () => {
    await boot();
    vi.mocked(api.fetchSymbols).mockResolvedValue([
      { symbol: 'THYAO.IS', displayName: 'THY', market: 'BIST' },
      { symbol: 'GARAN.IS', displayName: 'Garanti', market: 'BIST' },
      { symbol: 'ASELS.IS', displayName: 'Aselsan', market: 'BIST' },
    ] as unknown as SymbolQuoteSummary[]);
    vi.mocked(api.fetchCorrelation).mockResolvedValue({
      symbols: ['THYAO.IS', 'GARAN.IS', 'ASELS.IS'], days: 250,
      matrix: [[1, 0.8, -0.2], [0.8, 1, 0.1], [-0.2, 0.1, 1]],
    });
    fireEvent.click($('[data-wbtab="corr"]'));
    fireEvent.click($('[data-corr-market="BIST"]'));
    await waitFor(() => expect(api.fetchCorrelation).toHaveBeenLastCalledWith(['THYAO.IS', 'GARAN.IS', 'ASELS.IS']));
    expect(api.fetchSymbols).toHaveBeenCalledWith('BIST');
    await waitFor(() => expect($('#corr-pairs').textContent).toContain('THYAO–GARAN'));
    expect($('#corr-pairs').textContent).toContain('+0.80');
    expect($('#corr-pairs').textContent).toContain('THYAO–ASELS');
  });
});

describe('Cloudflare Access oturumu', () => {
  it('401 olayı "oturum doldu" bannerı gösterir', async () => {
    await boot();
    expect(document.querySelector('#session-banner')).toBeNull();
    window.dispatchEvent(new CustomEvent('tv-session-expired'));
    await waitFor(() => expect($('#session-banner').textContent).toContain('Oturum süresi doldu'));
  });
});

describe('Faz 15 — ölçekler, pane menüsü, sade mod', () => {
  it('indeksli (100) ve kilit düğmeleri ölçek durumunu değiştirir; kilit denetleyiciye iner', async () => {
    await boot();
    fireEvent.click($('#btn-scale-indexed'));
    expect(ui.scaleKind).toBe('indexed');
    expect($('#btn-scale-indexed').classList.contains('active')).toBe(true);
    fireEvent.click($('#btn-scale-indexed'));
    expect(ui.scaleKind).toBe('normal');
    fireEvent.click($('#btn-scale-lock'));
    expect(ui.scaleLock).toBe(true);
    await waitFor(() => expect(spy.lock).toHaveBeenCalledWith(true));
    expect($('#btn-scale-lock').getAttribute('aria-pressed')).toBe('true');
    fireEvent.click($('#btn-scale-lock'));
    await waitFor(() => expect(spy.lock).toHaveBeenLastCalledWith(false));
  });

  it('pane menüsü: ölçek tarafı seçilir, karşılaştırma ölçeği ve ana pane seçenekleri görünür', async () => {
    await boot();
    setPaneMenu({ id: 'main', x: 100, y: 100 });
    await waitFor(() => expect($('#pane-menu')).toBeTruthy());
    expect($('#pane-side-split')).toBeNull(); // ana pane: yalnız sağ/sol
    fireEvent.click($('#pane-side-left'));
    expect(ui.mainScaleSide).toBe('left');
    await waitFor(() => expect(spy.side).toHaveBeenCalledWith('main', 'left'));
    fireEvent.click($('#pane-cmp-own'));
    expect(ui.compareScale).toBe('own');
    fireEvent.click($('#pane-indexed'));
    expect(ui.scaleKind).toBe('indexed');
    fireEvent.click($('#pane-lock'));
    expect(ui.scaleLock).toBe(true);
  });

  it('alt pane menüsü: split ölçek, taşı/büyüt, kaldır göstergeyi kapatır', async () => {
    await boot();
    setUi('quick', 'rsi', true);
    setPaneMenu({ id: 'rsi', x: 50, y: 50 });
    await waitFor(() => expect($('#pane-side-split')).toBeTruthy());
    fireEvent.click($('#pane-side-split'));
    expect(ui.paneSides.rsi).toBe('split');
    await waitFor(() => expect(spy.side).toHaveBeenCalledWith('rsi', 'split'));
    fireEvent.click($('#pane-menu-up'));
    expect(spy.move).toHaveBeenCalledWith('rsi', -1);
    setPaneMenu({ id: 'rsi', x: 50, y: 50 });
    await waitFor(() => expect($('#pane-menu-max')).toBeTruthy());
    fireEvent.click($('#pane-menu-max'));
    expect(spy.maximize).toHaveBeenCalledWith('rsi');
    setPaneMenu({ id: 'rsi', x: 50, y: 50 });
    await waitFor(() => expect($('#pane-menu-close')).toBeTruthy());
    fireEvent.click($('#pane-menu-close'));
    expect(ui.quick.rsi).toBe(false);
    expect(paneMenu()).toBeNull();
  });

  it('pane menüsü dışına tıklayınca kapanır', async () => {
    await boot();
    setPaneMenu({ id: 'main', x: 10, y: 10 });
    await waitFor(() => expect($('#pane-menu')).toBeTruthy());
    fireEvent.mouseDown(document.body);
    expect($('#pane-menu')).toBeNull();
  });

  it('Betik alt paneli ✕ ile gizlenir; ▶ Grafiğe Uygula geri getirir', async () => {
    await boot();
    setPaneMenu({ id: 'script', x: 10, y: 10 });
    await waitFor(() => expect($('#pane-menu-close')).toBeTruthy());
    fireEvent.click($('#pane-menu-close'));
    expect(ui.scriptSubHidden).toBe(true);
    fireEvent.click($('[data-wbtab="script"]'));
    fireEvent.click($('#btn-run-script'));
    expect(ui.scriptSubHidden).toBe(false);
  });

  it('sade mod: Analiz paneli, besleme çipleri ve Analiz sekmesi gizlenir; kalıcı; geri açılır', async () => {
    await boot();
    expect($('#lbl-feed-status')).toBeTruthy();
    expect($('#btn-wb-analysis')).toBeTruthy();
    expect($('#an-root')).toBeTruthy();
    fireEvent.click($('#btn-simple-mode'));
    expect(ui.simple).toBe(true);
    expect($('#titan-shell').classList.contains('simple-mode')).toBe(true);
    expect($('#lbl-feed-status')).toBeNull();
    expect($('#btn-wb-analysis')).toBeNull();
    expect($('#an-root')).toBeNull();
    expect($('#btn-simple-mode').getAttribute('aria-pressed')).toBe('true');
    fireEvent.keyDown(window, { key: '/', ctrlKey: true });
    expect($('#command-input')).toBeNull(); // komut çubuğu da kapalı
    fireEvent.click($('#btn-simple-mode'));
    expect(ui.simple).toBe(false);
    expect($('#an-root')).toBeTruthy();
    expect($('#lbl-feed-status')).toBeTruthy();
    fireEvent.keyDown(window, { key: '/', ctrlKey: true });
    await waitFor(() => expect($('#command-input')).toBeTruthy()); // sade kapalıyken çubuk açılır
    expect($('#btn-wb-analysis')).toBeTruthy();
  });

  it('sade mod açılınca açık Analiz sekmesi alt panelden çekilir', async () => {
    await boot();
    setUi('wbTab', 'market');
    fireEvent.click($('#btn-simple-mode'));
    expect(ui.wbTab).toBe('backtest');
  });

  it('Faz 18 Betik Konsolu sekmesi log.info/warning/error satırlarını listeler ve seviyeye/metne göre filtreler', async () => {
    await boot();
    fireEvent.click($('[data-wbtab="script"]'));
    setUi('scriptCode2', '');
    setUi(
      'scriptCode',
      `//@version=6
indicator("ConsoleUI")
if bar_index == 0
    log.info("Baslangic {0}", syminfo.ticker)
if bar_index == 1
    log.warning("Dikkat seviye={0}", 42)
if barstate.islast
    log.error("Kritik alarm")
plot(close)
`
    );
    fireEvent.click($('#btn-run-script'));
    await waitFor(() => expect($('#tab-script-console').textContent).toContain('(3)'));
    fireEvent.click($('#tab-script-console'));
    await waitFor(() => expect($('#script-console-panel')).toBeTruthy());
    expect(document.querySelectorAll('[data-log-entry]').length).toBe(3);

    // Filter to error only
    fireEvent.click($('[data-log-level="error"]'));
    expect(document.querySelectorAll('[data-log-entry]').length).toBe(1);
    expect($('#lst-script-logs').textContent).toContain('Kritik alarm');

    // Back to all + search filter
    fireEvent.click($('[data-log-level="all"]'));
    fireEvent.input($('#inp-script-log-search'), { target: { value: 'Dikkat' } });
    expect(document.querySelectorAll('[data-log-entry]').length).toBe(1);
    expect($('#lst-script-logs').textContent).toContain('seviye=42');
  });

  it('Faz 18 Betik Girdileri sekmesi group/inline/tooltip/active tüm türleri, grafikten seçimi ve kayıtlı kütüphaneleri çalıştırır', async () => {
    const libUi = [
      { id: 'lib_ui', name: 'UiLib', code: '//@version=6\nlibrary("UiLib")\nexport f(float x) => x', isOverlay: false, updatedAt: 1_700_000_000 },
    ];
    vi.mocked(api.fetchSavedScripts).mockResolvedValue(libUi);
    vi.mocked(scriptsApi.listScripts).mockResolvedValue(libUi);
    await boot();
    fireEvent.click($('[data-wbtab="script"]'));
    setUi('scriptCode2', '');
    setUi(
      'scriptCode',
      `//@version=6
indicator("InputsUI")
en = input.bool(false, "Aktif", group="G1", inline="r1", tooltip="Aç/kapa")
len = input.int(10, "Uzunluk", minval=2, maxval=50, group="G1", inline="r1", active=en)
src = input.source(close, "Kaynak", group="G2")
tf = input.timeframe("60", "Dilim", group="G2")
opt = input.string("A", "Secim", options=["A", "B"], group="G2")
col = input.color(color.blue, "Renk", group="G2")
txt = input.text_area("not", "Aciklama", group="G2")
sym = input.symbol("THYAO.IS", "Sembol", group="G2")
pr = input.price(100.0, "Fiyat", group="G3")
tm = input.time(1700000000000, "Zaman", group="G3")
plot(len, "len")
plot(pr, "pr")
`
    );
    fireEvent.click($('#btn-run-script'));
    await waitFor(() => expect($('#tab-script-inputs').textContent).toContain('(10)'));
    fireEvent.click($('#tab-script-inputs'));
    await waitFor(() => expect($('#script-inputs-panel')).toBeTruthy());

    // Group & inline & tooltip & active=false disabled
    expect(document.querySelector('[data-inp-group="G1"]')).toBeTruthy();
    expect(document.querySelector('.script-inp-row.is-inline')).toBeTruthy();
    expect(document.querySelector('.script-tip')?.getAttribute('title')).toBe('Aç/kapa');
    const lenInput = document.querySelector('[data-script-input="Uzunluk"] input') as HTMLInputElement;
    expect(lenInput.disabled).toBe(true);

    // Toggle Aktif -> Uzunluk becomes enabled & editable
    const boolInput = document.querySelector('[data-script-input="Aktif"] input') as HTMLInputElement;
    fireEvent.change(boolInput, { target: { checked: true } });
    await waitFor(() => expect((document.querySelector('[data-script-input="Uzunluk"] input') as HTMLInputElement).disabled).toBe(false));
    fireEvent.change(document.querySelector('[data-script-input="Uzunluk"] input')!, { target: { value: '25' } });
    fireEvent.change(document.querySelector('[data-script-input="Kaynak"] select')!, { target: { value: 'hl2' } });
    fireEvent.change(document.querySelector('[data-script-input="Dilim"] select')!, { target: { value: 'D' } });
    fireEvent.change(document.querySelector('[data-script-input="Secim"] select')!, { target: { value: 'B' } });
    fireEvent.input(document.querySelector('[data-script-input="Renk"] input')!, { target: { value: '#ff0000' } });
    fireEvent.change(document.querySelector('[data-script-input="Aciklama"] textarea')!, { target: { value: 'yeni' } });
    fireEvent.change(document.querySelector('[data-script-input="Sembol"] input')!, { target: { value: 'AAPL' } });

    // Interactive chart-click pick for price input
    fireEvent.click(document.querySelector('[data-pick-input="Fiyat"]')!);
    await waitFor(() => expect($('#script-pick-banner')).toBeTruthy());
    fireEvent.click($('#main-chart-wrap'), { clientX: 120, clientY: 80 });
    await waitFor(() => expect($('#script-pick-banner')).toBeNull());
    // Mocked yToPrice returns 123.45
    expect((document.querySelector('[data-script-input="Fiyat"] input') as HTMLInputElement).value).toBe('123.45');

    // Time pick + cancel button
    fireEvent.click(document.querySelector('[data-pick-input="Zaman"]')!);
    await waitFor(() => expect($('#script-pick-banner')).toBeTruthy());
    fireEvent.click($('#btn-cancel-script-pick'));
    await waitFor(() => expect($('#script-pick-banner')).toBeNull());

    // Reset button restores defaults
    fireEvent.click($('#btn-script-inputs-reset'));
    expect((document.querySelector('[data-script-input="Fiyat"] input') as HTMLInputElement).value).toBe('100');

    // Faz 19 betik kütüphanesi diyaloğundan kayıtlı library() açılır
    fireEvent.click($('#btn-open-script'));
    await waitFor(() => expect(document.querySelector('[data-script-id="lib_ui"] .script-lib-name')).toBeTruthy());
    fireEvent.click(document.querySelector('[data-script-id="lib_ui"] .script-lib-name')!);
    expect(ui.scriptCode).toContain('library("UiLib")');
    expect($('#lbl-script-status').textContent).toContain('kütüphane');
  });
});

type StudyItems = Array<{ uid: string; pane: string; label: string; result: { plots: Array<{ title: string; color: string; hidden?: boolean; data: unknown[] }>; hlines: unknown[] } }>;
const lastRender = (): StudyItems => {
  const calls = spy.renderStudies.mock.calls as unknown as StudyItems[][];
  return calls.length ? calls[calls.length - 1][0] : [];
};

describe('Faz 20: hazır göstergeler, ayar penceresi, gösterge üstüne gösterge', () => {
  async function addFromFx(id: string, search?: string) {
    fireEvent.click($('#btn-open-fx-modal'));
    if (search) fireEvent.input($('#inp-fx-search'), { target: { value: search } });
    else fireEvent.click($('[data-fx-nav="all"]'));
    fireEvent.click($(`[data-fx-builtin="${id}"]`));
  }

  it('fx penceresi: kategoriler, Türkçe arama, ekleme sayacı; RSI kendi panesinde, SMA ana panelde', async () => {
    await boot();
    fireEvent.click($('#btn-open-fx-modal'));
    expect(document.querySelectorAll('[data-fx-builtin]').length).toBeGreaterThanOrEqual(150);
    fireEvent.click($('[data-fx-nav="pattern"]'));
    expect(document.querySelectorAll('[data-fx-builtin]').length).toBeGreaterThanOrEqual(40);
    fireEvent.input($('#inp-fx-search'), { target: { value: 'goreceli guc' } });
    expect($('[data-fx-builtin="rsi"]')).toBeTruthy();
    fireEvent.click($('[data-fx-builtin="rsi"]'));
    await waitFor(() => expect($('[data-fx-count="rsi"]').textContent).toBe('1'));
    fireEvent.input($('#inp-fx-search'), { target: { value: 'sma' } });
    fireEvent.click($('[data-fx-builtin="sma"]'));
    await waitFor(() => expect(lastRender().length).toBe(2));
    const items = lastRender();
    expect(items.find((i) => i.label.startsWith('RSI'))!.pane).toMatch(/^study:/);
    expect(items.find((i) => i.label.startsWith('SMA'))!.pane).toBe('main');
    expect(items.find((i) => i.label.startsWith('RSI'))!.label).toBe('RSI 14 close');
    // lejant: ana paneldeki SMA satırı değerle
    await waitFor(() => expect($('[data-study-row="s2"] .study-val')).toBeTruthy());
    expect(JSON.parse(localStorage.getItem('titanview_studies_v1')!).length).toBe(2);
  });

  it('ayar penceresi: Girdiler canlı uygulanır, İptal geri alır, Tamam korur; Stil renk/görünürlük; Görünürlük aralığı', async () => {
    await boot();
    await addFromFx('rsi', 'rsi');
    await waitFor(() => expect(studyResults().s1?.ok).toBe(true));
    // ⚙ ana lejantta değil (osilatör kendi pane'inde): pane menüsünden ya da ⋯ ile; doğrudan sinyal
    const { setStudySettings } = await import('../../state/studies');
    setStudySettings({ uid: 's1', tab: 'inputs' });
    await waitFor(() => expect($('#study-settings')).toBeTruthy());
    const len = document.querySelector('[data-study-input="RSI Length"] input') as HTMLInputElement;
    fireEvent.change(len, { target: { value: '7' } });
    await waitFor(() => expect(lastRender()[0]?.label).toBe('RSI 7 close'));
    fireEvent.click($('#btn-study-cancel'));
    await waitFor(() => expect(lastRender()[0]?.label).toBe('RSI 14 close'));
    setStudySettings({ uid: 's1', tab: 'style' });
    await waitFor(() => expect($('#study-tab-style')).toBeTruthy());
    fireEvent.input($('[data-style-color="RSI"] input[type="color"]'), { target: { value: '#ff0000' } });
    fireEvent.change($('[data-style-hline="RSI Upper Band"] input[type="checkbox"]'), { target: { checked: false } });
    fireEvent.change($('[data-style-plot="RSI-based MA"] input[type="checkbox"]'), { target: { checked: false } });
    await waitFor(() => {
      const r = lastRender()[0].result;
      expect(r.plots.find((p) => p.title === 'RSI')!.color).toBe('#FF0000');
      expect(r.plots.find((p) => p.title === 'RSI-based MA')!.hidden).toBe(true);
      expect(r.hlines.length).toBe(2);
    });
    fireEvent.click($('[data-study-tab="visibility"]'));
    // grafik 15m: dakika aralığını 1–5 yap → gösterge gizlenir
    fireEvent.change($('[data-vis-max="minutes"]'), { target: { value: '5' } });
    await waitFor(() => expect(lastRender().length).toBe(0));
    fireEvent.click($('#btn-study-ok'));
    expect($('#study-settings')).toBeNull();
    expect(studies.list[0].visibility.minutes.max).toBe(5);
    expect(studies.list[0].plots.RSI.color).toBe('#FF0000');
  });

  it('gösterge üstüne gösterge: ⋯ → SMA, RSI çıktısını kaynak alır ve aynı panesine yerleşir; ebeveyn silinince bağlı da gider', async () => {
    await boot();
    await addFromFx('ema', 'ema');
    await waitFor(() => expect($('[data-study-row="s1"]')).toBeTruthy());
    fireEvent.click($('[data-study-more="s1"]'));
    fireEvent.click($('#study-menu-onstudy'));
    expect($('#modal-fx .tv-modal-header').textContent).toContain('Gösterge üstüne gösterge: EMA 9 close');
    fireEvent.input($('#inp-fx-search'), { target: { value: 'rsi' } });
    fireEvent.click($('[data-fx-builtin="rsi"]'));
    await waitFor(() => expect(studies.list.length).toBe(2));
    expect(studies.list[1].inputs.Source).toBe('@s1:EMA');
    expect(studies.list[1].pane).toBe('with:s1');
    await waitFor(() => expect(lastRender().find((i) => i.uid === 's2')?.label).toBe('RSI 14 EMA: EMA'));
    // ebeveyn ana panelde → bağlı RSI da ana panelde (varsayılan: aynı pane)
    expect(lastRender().find((i) => i.uid === 's2')!.pane).toBe('main');
    const rsi = studyResults().s2;
    expect(rsi.ok).toBe(true);
    expect(rsi.plots.find((p) => p.title === 'RSI')!.data.length).toBeGreaterThan(50);
    fireEvent.click($('[data-study-remove="s1"]'));
    await waitFor(() => expect(studies.list.length).toBe(0));
  });

  it('⋯ menüsü: yeni panele taşı, ölçeksiz, kopyala, gizle; pane ✕ paneldeki göstergeleri kaldırır', async () => {
    await boot();
    await addFromFx('sma', 'sma');
    await waitFor(() => expect($('[data-study-more="s1"]')).toBeTruthy());
    fireEvent.click($('[data-study-more="s1"]'));
    fireEvent.click($('#study-move-new'));
    await waitFor(() => expect(lastRender()[0].pane).toBe('study:s1'));
    fireEvent.click($('[data-study-more="s1"]') ?? document.body);
    const { duplicateStudy, toggleStudyVisible, updateStudy, removeStudiesInPane } = await import('../../state/studies');
    updateStudy('s1', { scale: 'none' });
    duplicateStudy('s1');
    await waitFor(() => expect(lastRender().length).toBe(2));
    toggleStudyVisible('s2');
    await waitFor(() => expect(lastRender().length).toBe(1));
    expect($('[data-study-row="s2"]').classList.contains('study-hidden')).toBe(true);
    removeStudiesInPane('study:s1');
    await waitFor(() => expect(studies.list.map((s) => s.uid)).toEqual(['s2']));
  });

  it('favoriler ★ ve gösterge şablonu kaydet/uygula', async () => {
    await boot();
    fireEvent.click($('#btn-open-fx-modal'));
    fireEvent.click($('[data-fx-nav="all"]'));
    fireEvent.click($('[data-fx-fav="macd"]'));
    fireEvent.click($('[data-fx-nav="favorites"]'));
    expect(document.querySelectorAll('[data-fx-builtin]').length).toBe(1);
    fireEvent.click($('#modal-fx .icon-btn'));
    fireEvent.click($('#btn-fav-indicators'));
    fireEvent.click($('[data-fav-add="macd"]'));
    await waitFor(() => expect(studies.list.length).toBe(1));
    fireEvent.click($('#btn-templates-modal'));
    fireEvent.input($('#inp-study-template-name'), { target: { value: 'Momentum seti' } });
    fireEvent.click($('#btn-save-study-template'));
    expect($('[data-study-template="Momentum seti"]')).toBeTruthy();
    const { clearStudies } = await import('../../state/studies');
    clearStudies();
    fireEvent.click($('[data-study-template="Momentum seti"] .pane-menu-item'));
    await waitFor(() => expect(studies.list.map((s) => s.builtinId)).toEqual(['macd']));
  });

  it('çapalı VWAP eklenince grafikten çapa seçimi ister ve tıklanan zaman girdiye yazılır', async () => {
    await boot();
    await addFromFx('vwap_anchored', 'capali vwap');
    await waitFor(() => expect($('#script-pick-banner')).toBeTruthy());
    fireEvent.click($('#main-chart-wrap'), { clientX: 100, clientY: 100 });
    await waitFor(() => expect(studies.list[0].inputs.Anchor).toBe(1_700_000_000_000));
    expect($('#script-pick-banner')).toBeNull();
  });
});

describe('Faz 22: çizim araç çubuğu', () => {
  it('formasyon, tahmin ve yazı gruplarındaki tüm yeni araçlar ikonlarıyla seçilebilir', async () => {
    await boot();
    const tools = [
      'xabcd', 'cypher', 'head_shoulders', 'abcd', 'triangle_pattern', 'three_drives',
      'elliott_impulse', 'elliott_correction', 'elliott_triangle', 'elliott_double', 'elliott_triple',
      'cyclic_lines', 'time_cycles', 'sine_line',
      'forecast', 'bars_pattern', 'ghost_feed', 'projection', 'anchored_vwap', 'anchored_vp', 'date_price_range',
      'anchored_text', 'note', 'price_note', 'pin', 'table', 'callout', 'comment', 'signpost', 'flag_mark',
    ];
    for (const t of tools) {
      const btn = $(`[data-subtool="${t}"]`);
      expect(btn, t).toBeTruthy();
      expect(btn.querySelector('svg'), `${t} ikonu`).toBeTruthy();
      fireEvent.click(btn);
      expect(ui.tool).toBe(t);
    }
    const sections = Array.from(document.querySelectorAll('.tool-flyout-section')).map((e) => e.textContent);
    expect(sections).toEqual(expect.arrayContaining(['Grafik Formasyonları', 'Elliott Dalgaları', 'Döngüler', 'Tahmin', 'Hacim Tabanlı', 'Ölçüm', 'Yazı ve Notlar']));
    expect(ui.groupTool.patterns).toBe('sine_line');
    expect(ui.groupTool.text).toBe('flag_mark');
  });

  it('favori yıldızı aracı ekler; yüzen favori çubuğu aracı seçer; çubuk gizlenebilir', async () => {
    await boot();
    expect($('#fav-tools-bar')).toBeNull();
    fireEvent.click($('[data-fav="xabcd"]'));
    fireEvent.click($('[data-fav="note"]'));
    expect(ui.favTools).toEqual(['xabcd', 'note']);
    expect(ui.tool).toBe('cursor'); // yıldız aracı seçmez
    await waitFor(() => expect($('#fav-tools-bar')).toBeTruthy());
    fireEvent.click($('[data-favtool="note"]'));
    expect(ui.tool).toBe('note');
    fireEvent.click($('[data-fav="xabcd"]'));
    expect(ui.favTools).toEqual(['note']);
    fireEvent.click($('#btn-fav-bar'));
    expect(ui.favBarVisible).toBe(false);
    await waitFor(() => expect($('#fav-tools-bar')).toBeNull());
  });

  it('ikon seçici: SVG ikon ve emoji yerleştirme aracını seçer', async () => {
    await boot();
    expect(document.querySelectorAll('.icon-picker .icon-cell').length).toBeGreaterThanOrEqual(60);
    fireEvent.click($('[data-icon="i:bull"]'));
    expect(ui.tool).toBe('icon');
    expect(ui.iconChoice).toBe('i:bull');
    fireEvent.click($('[data-icon-tab="emoji"]'));
    await waitFor(() => expect($('[data-icon="🚀"]')).toBeTruthy());
    fireEvent.click($('[data-icon="🚀"]'));
    expect(ui.iconChoice).toBe('🚀');
  });

  it('mıknatıs zayıf/güçlü menüsü; çizimde kal anahtarı', async () => {
    await boot();
    fireEvent.click($('[data-magnet-mode="weak"]'));
    expect(ui.magnet).toBe(true);
    expect(ui.magnetMode).toBe('weak');
    expect($('#btn-magnet-mode').getAttribute('data-magnet')).toBe('weak');
    fireEvent.click($('#btn-magnet-mode'));
    expect(ui.magnet).toBe(false);
    fireEvent.click($('[data-magnet-mode="strong"]'));
    expect(ui.magnetMode).toBe('strong');
    fireEvent.click($('#btn-stay-drawing'));
    expect(ui.stayInDrawing).toBe(true);
  });

  it('yazı aracı seçiliyken çok satırlı metin + punto; şablon kaydet/uygula/sil; stil hafızası', async () => {
    await boot();
    const d = { id: 'n1', symbol: 'THYAO.IS', timeframe: '15m', toolType: 'note' as const, points: [], color: '#0284C7', label: 'Not' };
    spy.selected = d;
    setSelectedDrawing(d);
    await waitFor(() => expect($('#inp-draw-text')).toBeTruthy());
    fireEvent.change($('#inp-draw-text'), { target: { value: 'a\nb' } });
    expect(spy.update).toHaveBeenCalledWith({ label: 'a\nb' });
    fireEvent.change($('#sel-draw-font'), { target: { value: '20' } });
    expect(spy.update).toHaveBeenCalledWith({ fontSize: 20 });
    expect(ui.toolStyles.note).toEqual({ fontSize: 20 });

    fireEvent.click($('#btn-draw-template'));
    fireEvent.input($('#inp-tpl-name'), { target: { value: 'Büyük not' } });
    fireEvent.click($('#btn-tpl-save'));
    expect(ui.drawTemplates).toHaveLength(1);
    expect(ui.drawTemplates[0]).toMatchObject({ name: 'Büyük not', tool: 'note', style: { color: '#0284C7' } });
    fireEvent.click($('#btn-draw-template'));
    const id = ui.drawTemplates[0].id;
    spy.update.mockClear();
    fireEvent.click($(`[data-tpl="${id}"]`));
    expect(spy.update).toHaveBeenCalledWith(expect.objectContaining({ color: '#0284C7' }));
    fireEvent.click($('#btn-draw-template'));
    fireEvent.click($(`[data-tpl-del="${id}"]`));
    expect(ui.drawTemplates).toHaveLength(0);
    fireEvent.click($('#btn-tpl-default'));
    expect(ui.toolStyles.note).toBeUndefined();
  });

  it('görünürlük penceresi: yalnız bu aralık, birim kapatma, tümünde göster', async () => {
    await boot();
    const d = { id: 't1', symbol: 'THYAO.IS', timeframe: '15m', toolType: 'trendline' as const, points: [], color: '#0284C7' };
    spy.selected = d;
    setSelectedDrawing(d);
    await waitFor(() => expect($('#btn-draw-visibility')).toBeTruthy());
    fireEvent.click($('#btn-draw-visibility'));
    fireEvent.click($('#btn-vis-only'));
    expect(spy.update).toHaveBeenLastCalledWith({ visibility: { sec: null, min: [15, 15], hour: null, day: null, week: null, month: null } });
    const hourBox = $('[data-vis-unit="hour"] input[type="checkbox"]');
    fireEvent.change(hourBox, { target: { checked: false } });
    expect(spy.update).toHaveBeenLastCalledWith({ visibility: { hour: null, sec: [1, 59], min: [1, 59], day: [1, 366], week: [1, 52], month: [1, 12] } });
    fireEvent.change($('[data-vis-min="min"]'), { target: { value: '5' } });
    expect((spy.update.mock.lastCall as unknown as [{ visibility: { min: number[] } }])[0].visibility.min).toEqual([5, 59]);
    fireEvent.click($('#btn-vis-all'));
    expect(spy.update).toHaveBeenLastCalledWith({ visibility: undefined });
  });
});

describe('Faz 22: alt menü ekrana sığar', () => {
  it('fitFlyout taşan menüyü yukarı kaydırır, sığanı olduğu gibi bırakır', async () => {
    const { fitFlyout } = await import('../LeftBar');
    const w = document.createElement('div');
    const f = document.createElement('div');
    f.className = 'tool-flyout';
    w.appendChild(f);
    const rect = (top: number, h: number) => () => ({ top, bottom: top + h, height: h, left: 0, right: 0, width: 0, x: 0, y: top, toJSON: () => ({}) });
    f.getBoundingClientRect = rect(500, 600);
    fitFlyout(w);
    expect(f.style.top).toBe(`-${500 + 600 - (window.innerHeight - 8)}px`);
    f.getBoundingClientRect = rect(10, 100);
    fitFlyout(w);
    expect(f.style.top).toBe('');
    fitFlyout(document.createElement('div'));
  });
});
