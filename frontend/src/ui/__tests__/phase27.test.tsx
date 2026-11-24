// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  Candle,
  FundamentalsReport,
  HistoryResponse,
  ScreenerRow,
  SymbolQuoteSummary,
} from '../../types/market';

vi.mock('../../api/layouts', () => ({
  listLayoutsApi: vi.fn(async () => []),
  getLayoutApi: vi.fn(),
  createLayoutApi: vi.fn(),
  updateLayoutApi: vi.fn(),
  copyLayoutApi: vi.fn(),
  shareLayoutApi: vi.fn(),
  deleteLayoutApi: vi.fn(),
  getSharedLayoutApi: vi.fn(),
}));

vi.mock('../../api/alerts', () => ({
  listAlerts: vi.fn(async () => []),
  createAlertApi: vi.fn(),
  updateAlertApi: vi.fn(),
  deleteAlertApi: vi.fn(),
  alertAction: vi.fn(),
  bulkAlertAction: vi.fn(async () => 0),
  fetchAlertLog: vi.fn(async () => []),
  clearAlertLog: vi.fn(async () => {}),
  fetchAlertConfig: vi.fn(async () => ({ telegram: { enabled: false, chatId: '', tokenSet: false }, pushSubscriptions: 0 })),
  saveAlertConfig: vi.fn(),
  testAlertChannel: vi.fn(),
  fetchPushKey: vi.fn(async () => 'k'),
  savePushSubscription: vi.fn(async () => {}),
  deletePushSubscription: vi.fn(async () => {}),
}));

vi.mock('../../api/scripts', () => ({
  listScripts: vi.fn(async () => []),
  saveScript: vi.fn(),
  deleteScript: vi.fn(),
  renameScript: vi.fn(),
  listVersions: vi.fn(async () => []),
}));

vi.mock('../../api/phase27', () => ({
  fetchWatchlistsApi: vi.fn(async () => ({ watchlists: [], flags: {} })),
  saveWatchlistApi: vi.fn(async (wl) => ({ ...wl, id: wl.id || 'wl_saved' })),
  deleteWatchlistApi: vi.fn(async () => true),
  setSymbolFlagApi: vi.fn(async () => null),
  fetchNotesApi: vi.fn(async () => []),
  saveNoteApi: vi.fn(async (n) => ({
    ...n,
    id: n.id || 'note_1',
    createdAt: 1700000000,
    updatedAt: 1700000000,
  })),
  deleteNoteApi: vi.fn(async () => true),
  fetchScreenerPresetsApi: vi.fn(async () => []),
  saveScreenerPresetApi: vi.fn(async (p) => ({ ...p, id: p.id || 'scr_saved' })),
  deleteScreenerPresetApi: vi.fn(async () => true),
  runScriptScreenerApi: vi.fn(async () => ({
    ok: true,
    scriptTitle: 'TitanScript Tarayıcı: RSI + EMA + RVOL',
    timeframe: '15m',
    columns: [
      { id: 'plot_0', title: 'RSI_14' },
      { id: 'plot_1', title: 'EMA_20' },
      { id: 'plot_2', title: 'RVOL' },
    ],
    conditions: ['Boğa Trend Uyumu'],
    rows: [
      {
        symbol: 'THYAO.IS',
        displayName: 'Türk Hava Yolları',
        market: 'BIST',
        exchange: 'BIST',
        currency: 'TRY',
        lastPrice: 295.4,
        changePercent: 2.15,
        volume: 42_000_000,
        plots: { RSI_14: 61.4, EMA_20: 288.2, RVOL: 1.45 },
        alertsFired: ['Boğa Trend Uyumu'],
        matched: true,
        executionMs: 1.2,
      },
      {
        symbol: 'BTCUSDT',
        displayName: 'Bitcoin / Tether US',
        market: 'CRYPTO',
        exchange: 'BINANCE',
        currency: 'USDT',
        lastPrice: 91250,
        changePercent: 3.1,
        volume: 18500,
        plots: { RSI_14: 64.8, EMA_20: 89500, RVOL: 1.62 },
        alertsFired: ['Boğa Trend Uyumu'],
        matched: true,
        executionMs: 0.9,
      },
    ],
  })),
  fetchSymbolCardSecurity: vi.fn(async () => ({
    info: { symbol: 'THYAO.IS', displayName: 'Türk Hava Yolları', market: 'BIST', exchange: 'BIST', currency: 'TRY', delayMinutes: 15 },
    stats: {
      last: 295.4,
      change1d: 2.15,
      change1w: 4.8,
      change1m: 11.2,
      change3m: 18.5,
      changeYtd: 34.0,
      change1y: 42.6,
      high52w: 332.0,
      low52w: 215.0,
      fromHighPct: -11.02,
      volAnnualPct: 36.4,
      maxDrawdownPct: -18.2,
      atr14Pct: 2.35,
      bars: 260,
    },
    beta: 1.12,
    benchmark: 'XU100.IS',
  })),
  fetchSymbolCardFundamentals: vi.fn(async (): Promise<FundamentalsReport> => ({
    symbol: 'THYAO.IS',
    displayName: 'Türk Hava Yolları',
    market: 'BIST',
    currency: 'TRY',
    supported: true,
    source: 'KAP / İş Yatırım + Yahoo Finance',
    ratios: {
      marketCap: 407_650_000_000,
      trailingPe: 4.82,
      priceToBook: 0.78,
      trailingEps: 61.28,
      dividendYieldPct: 2.4,
      beta: 1.12,
    },
    annual: [],
    quarterly: [],
    nextEarningsTime: 1740000000,
    earnings: [{ time: 1730000000, actual: 18.4, estimate: 16.9 }],
  })),
}));

vi.mock('../../chart/ChartController', () => ({
  TitanChartController: class {
    constructor() {
      return new Proxy(
        {},
        {
          get: (_t, k) => {
            if (k === 'getQuickIndicators') return () => ({});
            if (k === 'getCandles') return () => [];
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
      return new Proxy({}, { get: (_t, k) => (k === 'getDrawings' ? () => [] : () => undefined) });
    }
  },
}));

vi.mock('../../api/client', () => ({
  fetchHistory: vi.fn(),
  fetchSymbols: vi.fn(),
  fetchQuotes: vi.fn(async () => []),
  fetchScreener: vi.fn(async () => []),
  fetchCacheStats: vi.fn(async () => ({ totalCandles: 120, totalSymbols: 4, savedScripts: 1, savedDrawings: 0 })),
  fetchSavedScripts: vi.fn(async () => []),
  saveCustomScript: vi.fn(async () => null),
  deleteSavedScript: vi.fn(async () => true),
  fetchDrawings: vi.fn(async () => []),
  persistDrawing: vi.fn(async () => {}),
  clearSymbolDrawings: vi.fn(async () => {}),
  deleteDrawingById: vi.fn(async () => {}),
  fetchOverview: vi.fn(async () => []),
  fetchCorrelation: vi.fn(async () => ({ symbols: [], days: 250, matrix: [] })),
  fetchSecurity: vi.fn(),
  fetchInsights: vi.fn(),
  fetchAnalysis: vi.fn(async () => ({
    info: { symbol: 'THYAO.IS', displayName: 'THY', market: 'BIST', exchange: 'BIST', currency: 'TRY', delayMinutes: 15 },
    analysis: {
      score: 10, bias: 'NÖTR', voteScore: 0, buy: 4, sell: 4, neutral: 6, votes: [],
      regime: { trend: 'range', adx: 18, volatility: 'NORMAL', rangePos52w: 50 },
      flow: { obvSlopePct: 0, cmf20: 0, relVolume: 1, divergence: '' },
      insights: { bars: 60, last: 300, score: 10, bias: 'NÖTR', tags: [], signals: [], metrics: { rsi14: 50, sma50: 295, sma200: 280, z20: 0, bbWidthPctile: 50, atrPctile: 50, relVolume: 1, momentum121: 0, relStrength3m: 0, var95Pct: -2, drawdownPct: -5, daysSincePeak: 3, streak: 1 }, support: null, resistance: null },
    },
    mtf: [],
    mtfAgreement: 'karışık',
    lastBarTime: 1700000000,
  })),
  fetchRelated: vi.fn(async () => ({ positive: [], negative: [], cross: [], note: '' })),
  fetchFlow: vi.fn(async () => ({})),
  fetchIdeas: vi.fn(async () => []),
  fetchNews: vi.fn(async () => []),
  fetchWhales: vi.fn(),
  syncCollectSymbols: vi.fn(async (s: string[]) => s),
  fetchCollectItems: vi.fn(async () => []),
  fetchFootprint: vi.fn(async () => ({ supported: false })),
  fetchSetting: vi.fn(async () => null),
  saveSetting: vi.fn(async () => {}),
  fetchCorporateEvents: vi.fn(async () => ({ symbol: 'THYAO.IS', supported: true, dividends: [], splits: [], earnings: [] })),
  fetchFxRates: vi.fn(async () => ({ from: 'USD', to: 'TRY', pair: 'USD/TRY', supported: false, rates: [] })),
  fetchFundamentals: vi.fn(),
  fetchCalendar: vi.fn(),
  fetchOptionChain: vi.fn(),
}));

vi.mock('../../api/liveSocket', () => ({
  LiveMarketSocket: class {
    connect() {}
    subscribe() {}
    sendSubscribe() {}
    sendSubscriptions() {}
    disconnect() {}
    destroy() {}
  },
}));

import * as api from '../../api/client';
import { App } from '../App';
import { bootstrap, openDrawerTab, setUi, setWorkbenchTab, switchSymbol } from '../../state/store';

function makeCandles(n = 60): Candle[] {
  return Array.from({ length: n }, (_, i) => ({
    time: 1700000000 + i * 900,
    open: 280 + i * 0.25,
    high: 282 + i * 0.25,
    low: 279 + i * 0.25,
    close: 281 + i * 0.25,
    volume: 15000 + i * 100,
  }));
}

const SYMS: SymbolQuoteSummary[] = [
  {
    symbol: 'THYAO.IS',
    displayName: 'Türk Hava Yolları',
    market: 'BIST',
    exchange: 'BIST',
    currency: 'TRY',
    provider: 'YAHOO',
    delayMinutes: 15,
    lastPrice: 295.4,
    changeAbs: 6.2,
    changePercent: 2.15,
    volume24h: 42_000_000,
    techRating: 'STRONG_BUY',
    techScore: 4,
  },
  {
    symbol: 'GARAN.IS',
    displayName: 'Garanti BBVA',
    market: 'BIST',
    exchange: 'BIST',
    currency: 'TRY',
    provider: 'YAHOO',
    delayMinutes: 15,
    lastPrice: 118.2,
    changeAbs: -1.4,
    changePercent: -1.17,
    volume24h: 71_000_000,
    techRating: 'SELL',
    techScore: -2,
  },
  {
    symbol: 'BTCUSDT',
    displayName: 'Bitcoin / Tether US',
    market: 'CRYPTO',
    exchange: 'BINANCE',
    currency: 'USDT',
    provider: 'BINANCE',
    delayMinutes: 0,
    lastPrice: 91250,
    changeAbs: 2750,
    changePercent: 3.1,
    volume24h: 18500,
    techRating: 'STRONG_BUY',
    techScore: 5,
  },
];

const SCR_ROWS: ScreenerRow[] = [
  {
    symbol: 'THYAO.IS',
    displayName: 'Türk Hava Yolları',
    market: 'BIST',
    exchange: 'BIST',
    currency: 'TRY',
    lastPrice: 295.4,
    changePercent: 2.15,
    volume: 42_000_000,
    relVolume: 1.45,
    rsi14: 61.4,
    adx14: 28.2,
    atr14Pct: 2.35,
    ema20: 288.2,
    ema50: 276.0,
    sma50: 274.5,
    sma200: 248.0,
    distSma200Pct: 19.1,
    macd: 3.4,
    rating: 'STRONG_BUY',
    score: 4,
    perf1w: 4.8,
    perf1m: 11.2,
    perf3m: 18.5,
    perf6m: 26.0,
    perfYtd: 34.0,
    perf1y: 42.6,
    marketCap: 407_650_000_000,
    trailingPe: 4.82,
    priceToBook: 0.78,
    roePct: 28.4,
    bbWidthPct: 8.2,
  },
  {
    symbol: 'GARAN.IS',
    displayName: 'Garanti BBVA',
    market: 'BIST',
    exchange: 'BIST',
    currency: 'TRY',
    lastPrice: 118.2,
    changePercent: -1.17,
    volume: 71_000_000,
    relVolume: 0.92,
    rsi14: 36.1,
    adx14: 19.4,
    atr14Pct: 2.8,
    ema20: 120.0,
    ema50: 121.5,
    sma50: 121.0,
    sma200: 104.0,
    distSma200Pct: 13.6,
    macd: -0.85,
    rating: 'SELL',
    score: -2,
    perf1w: -2.1,
    perf1m: 3.4,
    perf3m: 9.1,
    perf6m: 15.0,
    perfYtd: 28.0,
    perf1y: 35.0,
    marketCap: 496_440_000_000,
    trailingPe: 3.95,
    priceToBook: 1.42,
    roePct: 32.1,
    bbWidthPct: 14.5,
  },
];

beforeEach(() => {
  vi.mocked(api.fetchHistory).mockImplementation(async (symbol, interval): Promise<HistoryResponse> => ({
    symbol,
    interval,
    displayName: symbol,
    market: symbol.endsWith('.IS') ? 'BIST' : 'CRYPTO',
    currency: symbol.endsWith('.IS') ? 'TRY' : 'USDT',
    provider: symbol.endsWith('.IS') ? 'YAHOO' : 'BINANCE',
    delayMinutes: 15,
    cacheHit: true,
    fetchedGaps: 0,
    queryMs: 1.0,
    candles: makeCandles(60),
  }));
  vi.mocked(api.fetchSymbols).mockResolvedValue(SYMS);
  vi.mocked(api.fetchScreener).mockResolvedValue(SCR_ROWS);
});

afterEach(() => {
  cleanup();
});

describe('Faz 27 — Watchlist, 7-Color Flags, SymbolCard, Notes/Journal, Advanced Screener & Script Screener UI', () => {
  it('supports multi-watchlist switcher, custom sections, column selection, sorting, 7-color flags, and .txt import', async () => {
    render(() => <App />);
    await bootstrap();
    setUi('drawerTab', 'watchlist');

    // 1. Toggle extra columns (Hacim, Uzatılmış Saat, Teknik Puan)
    const colsBtn = document.getElementById('btn-wl-cols-menu')!;
    fireEvent.click(colsBtn);
    expect(document.getElementById('wl-cols-popover')).toBeTruthy();

    const volToggle = document.querySelector<HTMLInputElement>('[data-wl-col-toggle="vol"]')!;
    const techToggle = document.querySelector<HTMLInputElement>('[data-wl-col-toggle="tech"]')!;
    fireEvent.click(volToggle);
    fireEvent.click(techToggle);
    expect(document.querySelector('[data-wl-sort="vol"]')).toBeTruthy();
    expect(document.querySelector('[data-wl-sort="tech"]')).toBeTruthy();

    // 2. Sort by column header click
    const sortPctHeader = document.querySelector<HTMLElement>('[data-wl-sort="chgPct"]')!;
    fireEvent.click(sortPctHeader);
    expect(sortPctHeader.textContent).toContain('▼');
    fireEvent.click(sortPctHeader);
    expect(sortPctHeader.textContent).toContain('▲');

    // 3. Flag a symbol and switch to Red Flagged List
    const flagBtn = document.querySelector<HTMLElement>('[data-wl-flag="THYAO.IS"]')!;
    fireEvent.click(flagBtn);

    const listMenuBtn = document.getElementById('btn-wl-list-menu')!;
    fireEvent.click(listMenuBtn);
    expect(document.getElementById('wl-dropdown-menu')).toBeTruthy();

    const redListBtn = document.querySelector<HTMLElement>('[data-flag-list="red"]')!;
    fireEvent.click(redListBtn);
    expect(document.getElementById('btn-wl-list-menu')?.textContent).toContain('Kırmızı');

    // 4. Switch to Custom Watchlist mode and import .txt
    fireEvent.click(document.getElementById('btn-wl-list-menu')!);
    fireEvent.click(document.getElementById('btn-wl-import-open')!);
    expect(document.getElementById('wl-import-box')).toBeTruthy();

    const txtArea = document.getElementById('txt-wl-import-raw') as HTMLTextAreaElement;
    fireEvent.input(txtArea, { target: { value: '###HAVACILIK,BIST:THYAO,###KRİPTO,BINANCE:BTCUSDT' } });
    fireEvent.click(document.getElementById('btn-wl-import-confirm')!);

    await waitFor(() => {
      expect(document.getElementById('wl-list')?.textContent).toContain('HAVACILIK');
    });
  });

  it('renders enhanced SymbolCard (1H/1A/3A/YBB/1Y performance tiles, 52W range, key stats, earnings date) and Notes/Journal tab', async () => {
    render(() => <App />);
    await bootstrap();
    await switchSymbol('THYAO.IS', '15m');
    setUi('drawerTab', 'watchlist');

    await waitFor(() => {
      const perfGrid = document.getElementById('sym-card-perf');
      expect(perfGrid).toBeTruthy();
      expect(perfGrid?.textContent).toContain('1H');
      expect(perfGrid?.textContent).toContain('1A');
      expect(perfGrid?.textContent).toContain('3A');
      expect(perfGrid?.textContent).toContain('YBB');
      expect(perfGrid?.textContent).toContain('1Y');
      const statsBox = document.getElementById('sym-card-stats');
      expect(statsBox?.textContent).toContain('Piyasa Değeri');
      expect(statsBox?.textContent).toContain('4.82x');
      expect(document.getElementById('sym-card-earnings')).toBeTruthy();
    });

    // Click Note button on SymbolCard to open Notes/Journal drawer tab
    fireEvent.click(document.getElementById('btn-symcard-note')!);
    expect(document.getElementById('drawer-panel-notes')).toBeTruthy();

    const titleInp = document.getElementById('inp-note-title') as HTMLInputElement;
    const bodyInp = document.getElementById('txt-note-body') as HTMLTextAreaElement;
    fireEvent.input(titleInp, { target: { value: '295 TL Kırılım Notu' } });
    fireEvent.input(bodyInp, { target: { value: 'Hacim ortalamanın %45 üzerinde, hedef 315 TL.' } });
    fireEvent.click(document.getElementById('btn-save-note')!);

    await waitFor(() => {
      expect(document.getElementById('notes-list')?.textContent).toContain('295 TL Kırılım Notu');
    });
  });

  it('renders Advanced Screener (column sets, 125+ filter drawer, presets) and Script Screener (dynamic plot columns & filter conditions)', async () => {
    render(() => <App />);
    await bootstrap();
    setWorkbenchTab('screener');

    // 1. Column set switching
    const perfTab = document.querySelector<HTMLElement>('[data-colset="performance"]')!;
    fireEvent.click(perfTab);
    expect(document.querySelector('[data-scr-col="perf1w"]')).toBeTruthy();
    expect(document.querySelector('[data-scr-col="perfYtd"]')).toBeTruthy();

    const valTab = document.querySelector<HTMLElement>('[data-colset="valuation"]')!;
    fireEvent.click(valTab);
    expect(document.querySelector('[data-scr-col="marketCap"]')).toBeTruthy();
    expect(document.querySelector('[data-scr-col="trailingPe"]')).toBeTruthy();

    // 2. Open 125+ Filter Catalog and add RSI(14) filter
    fireEvent.click(document.getElementById('btn-scr-add-filter')!);
    expect(document.getElementById('scr-filter-drawer')).toBeTruthy();
    const rsiFilterBtn = document.querySelector<HTMLElement>('[data-add-filter="rsi14"]')!;
    fireEvent.click(rsiFilterBtn);
    expect(document.querySelector('[data-active-filter="rsi14"]')).toBeTruthy();

    // 3. Switch to Script Screener (v6)
    fireEvent.click(document.getElementById('btn-scr-mode-script')!);
    await waitFor(() => {
      expect(document.getElementById('scr-script-view')).toBeTruthy();
      expect(document.querySelector('[data-script-plot-col="RSI_14"]')).toBeTruthy();
      expect(document.querySelector('[data-script-plot-col="EMA_20"]')).toBeTruthy();
      expect(document.getElementById('script-screener-tbody')?.textContent).toContain('THYAO.IS');
      expect(document.getElementById('script-screener-tbody')?.textContent).toContain('Boğa Trend Uyumu');
    });

    // Toggle inline TitanScript code editor and add a TitanScript plot filter
    fireEvent.click(document.getElementById('btn-script-scr-code-toggle')!);
    expect(document.getElementById('txt-script-scr-code')).toBeTruthy();
    fireEvent.click(document.getElementById('btn-script-scr-add-filter')!);
    expect(document.getElementById('scr-script-filters')).toBeTruthy();
  });
});
