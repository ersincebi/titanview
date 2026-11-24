// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CalendarResponse,
  Candle,
  CorporateEventsData,
  FundamentalsReport,
  HistoryResponse,
  OptionChainResponse,
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
    mtfAgreement: '',
    lastBarTime: 1_700_000_000,
  })),
  fetchRelated: vi.fn(async () => ({ positive: [], negative: [], cross: [], note: '' })),
  fetchFlow: vi.fn(async () => ({})),
  fetchIdeas: vi.fn(async () => []),
  fetchNews: vi.fn(async () => []),
  fetchWhales: vi.fn(),
  fetchFootprint: vi.fn(async () => ({ supported: false })),
  fetchCorporateEvents: vi.fn(async (symbol: string): Promise<CorporateEventsData> => ({
    symbol,
    supported: true,
    dividends: [{ time: 1_700_000_000, amount: 6.85 }],
    splits: [{ time: 1_700_009_000, numerator: 4, denominator: 1, ratio: '4:1' }],
    earnings: [{ time: 1_700_018_000, actual: 12.4, estimate: 11.5 }],
  })),
  fetchFxRates: vi.fn(async (from: string, to: string) => ({ from, to, pair: `${from}/${to}`, supported: false, rates: [] })),
  fetchFundamentals: vi.fn(),
  fetchCalendar: vi.fn(),
  fetchOptionChain: vi.fn(),
  syncCollectSymbols: vi.fn(async (s: string[]) => s),
  fetchCollectItems: vi.fn(async () => []),
  fetchSetting: vi.fn(async () => null),
  saveSetting: vi.fn(async () => {}),
  apiFetch: vi.fn(),
}));

vi.mock('../../api/liveSocket', () => ({
  LiveMarketSocket: class {
    connect() {}
    sendSubscribe() {}
    sendSubscriptions() {}
    destroy() {}
  },
}));

import * as api from '../../api/client';
import { clearRuntime } from '../../state/runtime';
import { comparisons, resetStore, switchSymbol, ui } from '../../state/store';
import { App } from '../App';

const mkCandles = (n = 40, base = 300): Candle[] =>
  Array.from({ length: n }, (_, i) => ({
    time: 1_700_000_000 + i * 900,
    open: base + i,
    high: base + i + 2,
    low: base + i - 2,
    close: base + i + 1,
    volume: 1000 + i * 10,
  }));

const SYMBOLS: SymbolQuoteSummary[] = [
  { symbol: 'THYAO.IS', displayName: 'Türk Hava Yolları', market: 'BIST', exchange: 'BIST', currency: 'TRY', provider: 'YAHOO', delayMinutes: 15, lastPrice: 312.5, changePercent: 2.15 },
  { symbol: 'XU100.IS', displayName: 'BIST 100 Endeksi', market: 'BIST', exchange: 'BIST', currency: 'TRY', provider: 'YAHOO', delayMinutes: 15, lastPrice: 9850.0, changePercent: 1.4 },
  { symbol: 'BTCUSDT', displayName: 'Bitcoin / Tether US', market: 'CRYPTO', exchange: 'BINANCE', currency: 'USDT', provider: 'BINANCE', delayMinutes: 0, lastPrice: 60500, changePercent: 3.1 },
  { symbol: 'ETHUSDT', displayName: 'Ethereum / Tether US', market: 'CRYPTO', exchange: 'BINANCE', currency: 'USDT', provider: 'BINANCE', delayMinutes: 0, lastPrice: 3150, changePercent: 1.8 },
  { symbol: 'USDTRY=X', displayName: 'ABD Doları / Türk Lirası', market: 'FOREX', exchange: 'FX', currency: 'TRY', provider: 'YAHOO', delayMinutes: 0, lastPrice: 34.4, changePercent: 0.2 },
  { symbol: 'AAPL', displayName: 'Apple Inc.', market: 'US', exchange: 'NASDAQ', currency: 'USD', provider: 'YAHOO', delayMinutes: 15, lastPrice: 228.5, changePercent: 0.9 },
];

const SAMPLE_FUNDAMENTALS: FundamentalsReport = {
  symbol: 'THYAO.IS',
  displayName: 'Türk Hava Yolları A.O.',
  market: 'BIST',
  currency: 'TRY',
  supported: true,
  source: 'KAP / İş Yatırım + Yahoo Finance',
  ratios: {
    marketCap: 431250000000,
    enterpriseValue: 685000000000,
    trailingPe: 3.85,
    forwardPe: 4.1,
    priceToBook: 0.39,
    enterpriseToEbitda: 4.2,
    priceToSales: 0.36,
    trailingEps: 81.2,
    dividendYieldPct: 2.19,
    grossMarginPct: 16.28,
    operatingMarginPct: 9.43,
    profitMarginPct: 12.37,
    roePct: 12.97,
    roaPct: 5.92,
    currentRatio: 0.99,
    quickRatio: 0.85,
    debtToEquity: 83.8,
    beta: 0.92,
  },
  annual: [
    {
      period: '2025',
      date: '2025-12-31',
      totalRevenue: 1187816196737,
      grossProfit: 193387862297,
      operatingIncome: 112045864239,
      ebitda: 229751891354,
      pretaxIncome: 171033140390,
      netIncome: 146952895515,
      dilutedEps: 106.48,
      totalAssets: 2482297808574,
      currentAssets: 542535251740,
      cashAndEquivalents: 106956317387,
      nonCurrentAssets: 1939762556834,
      totalLiabilities: 1349449712373,
      currentLiabilities: 549576578894,
      nonCurrentLiabilities: 799873133479,
      totalDebt: 950098058138,
      netDebt: 843141740751,
      stockholdersEquity: 1132848096201,
      operatingCashFlow: 230997549865,
      capitalExpenditure: -95495513179,
      freeCashFlow: 51149075639,
      investingCashFlow: -179848474226,
      financingCashFlow: -61206338470,
    },
  ],
  quarterly: [
    {
      period: '2025-Q3',
      date: '2025-09-30',
      totalRevenue: 340000000000,
      grossProfit: 68000000000,
      netIncome: 51000000000,
    },
  ],
};

const SAMPLE_CALENDAR: CalendarResponse = {
  economic: [
    {
      id: 'tcmb_ppk_cur',
      time: 1_795_345_200,
      dateStr: '2026-11-21',
      timeStr: '14:00',
      country: 'TR',
      institution: 'TCMB',
      category: 'Faiz',
      title: 'TCMB Para Politikası Kurulu (PPK) Faiz Kararı',
      importance: 'HIGH',
      unit: '%',
      sourceUrl: 'https://www.tcmb.gov.tr',
    },
    {
      id: 'fed_fomc_cur',
      time: 1_795_460_400,
      dateStr: '2026-12-16',
      timeStr: '22:00',
      country: 'US',
      institution: 'FED',
      category: 'Faiz',
      title: 'FED FOMC Federal Fonlama Faiz Kararı',
      importance: 'HIGH',
      unit: '%',
      sourceUrl: 'https://www.federalreserve.gov',
    },
  ],
  earnings: [
    {
      symbol: 'THYAO.IS',
      displayName: 'Türk Hava Yolları A.O.',
      market: 'BIST',
      currency: 'TRY',
      time: 1_793_800_000,
      epsEstimate: 32.5,
      epsActual: 36.1,
      surprisePct: 11.08,
      status: 'REPORTED',
    },
  ],
  dividends: [
    {
      symbol: 'THYAO.IS',
      displayName: 'Türk Hava Yolları A.O.',
      market: 'BIST',
      currency: 'TRY',
      exTime: 1_792_000_000,
      amount: 6.85,
    },
  ],
  ipoNote: 'Halka arz duyuruları SPK Haftalık Bülten ve KAP üzerinden yayınlanır.',
  ipoSources: [
    {
      market: 'BIST',
      institution: 'SPK (Sermaye Piyasası Kurulu)',
      title: 'SPK Haftalık Bülten',
      description: 'Onaylanan halka arz izahnameleri.',
      url: 'https://spk.gov.tr/spk-bultenleri',
    },
  ],
};

const SAMPLE_OPTIONS_BTC: OptionChainResponse = {
  supported: true,
  market: 'CRYPTO',
  symbol: 'BTCUSDT',
  underlying: 'BTC',
  provider: 'DERIBIT',
  spotPrice: 60500,
  selectedExpiry: '29JAN27',
  daysToExpiry: 68,
  expiries: [
    { code: '27DEC26', date: '2026-12-27', expiryTime: 1_798_358_400, daysToExpiry: 35, strikeCount: 18, totalOi: 4200 },
    { code: '29JAN27', date: '2027-01-29', expiryTime: 1_801_209_600, daysToExpiry: 68, strikeCount: 24, totalOi: 6800 },
  ],
  summary: {
    totalCallOi: 3800,
    totalPutOi: 3000,
    putCallOiRatio: 0.79,
    totalVolumeUsd: 45000000,
    atmIv: 52.4,
    maxPainStrike: 60000,
  },
  rows: [
    {
      strike: 56000,
      distancePct: -7.44,
      call: { instrument: 'BTC-29JAN27-56000-C', type: 'C', strike: 56000, markCoin: 0.136, markUsd: 8228, bidUsd: 8100, askUsd: 8350, lastUsd: 8200, markIv: 53.1, openInterest: 140, volume: 12, volumeUsd: 726000, delta: 0.68, gamma: 0.00003, theta: -22, vega: 85, itm: true },
      put: { instrument: 'BTC-29JAN27-56000-P', type: 'P', strike: 56000, markCoin: 0.042, markUsd: 2541, bidUsd: 2480, askUsd: 2600, lastUsd: 2520, markIv: 53.5, openInterest: 210, volume: 18, volumeUsd: 1089000, delta: -0.32, gamma: 0.00003, theta: -21, vega: 85, itm: false },
    },
    {
      strike: 60000,
      distancePct: -0.83,
      call: { instrument: 'BTC-29JAN27-60000-C', type: 'C', strike: 60000, markCoin: 0.088, markUsd: 5324, bidUsd: 5250, askUsd: 5400, lastUsd: 5310, markIv: 52.4, openInterest: 310, volume: 45, volumeUsd: 2722500, delta: 0.54, gamma: 0.00004, theta: -26, vega: 96, itm: true },
      put: { instrument: 'BTC-29JAN27-60000-P', type: 'P', strike: 60000, markCoin: 0.079, markUsd: 4780, bidUsd: 4700, askUsd: 4860, lastUsd: 4750, markIv: 52.4, openInterest: 280, volume: 38, volumeUsd: 2299000, delta: -0.46, gamma: 0.00004, theta: -26, vega: 96, itm: false },
    },
    {
      strike: 65000,
      distancePct: 7.44,
      call: { instrument: 'BTC-29JAN27-65000-C', type: 'C', strike: 65000, markCoin: 0.048, markUsd: 2904, bidUsd: 2840, askUsd: 2960, lastUsd: 2900, markIv: 53.8, openInterest: 420, volume: 30, volumeUsd: 1815000, delta: 0.36, gamma: 0.00003, theta: -23, vega: 88, itm: false },
      put: { instrument: 'BTC-29JAN27-65000-P', type: 'P', strike: 65000, markCoin: 0.122, markUsd: 7381, bidUsd: 7250, askUsd: 7500, lastUsd: 7400, markIv: 54.0, openInterest: 95, volume: 8, volumeUsd: 484000, delta: -0.64, gamma: 0.00003, theta: -23, vega: 88, itm: true },
    },
  ],
};

const $ = <T extends HTMLElement = HTMLElement>(sel: string): T => {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`Element not found: ${sel}`);
  return el;
};

const memStore = (() => {
  let m = new Map<string, string>();
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => { m.set(k, String(v)); },
    removeItem: (k: string) => { m.delete(k); },
    clear: () => { m = new Map(); },
    key: (i: number) => [...m.keys()][i] ?? null,
    get length() { return m.size; },
  };
})();
Object.defineProperty(globalThis, 'localStorage', { value: memStore, configurable: true });

beforeEach(() => {
  memStore.clear();
  resetStore();
  clearRuntime();
  vi.clearAllMocks();
  vi.mocked(api.fetchSymbols).mockResolvedValue(SYMBOLS);
  vi.mocked(api.fetchHistory).mockImplementation(async (symbol: string, interval: string, _f?: number, _t?: number, currency?: string) => ({
    symbol: symbol.toUpperCase(),
    interval,
    displayName: `${symbol.toUpperCase()} Display`,
    market: symbol.toUpperCase().includes('BTC') ? 'CRYPTO' : 'BIST',
    currency: currency || (symbol.toUpperCase().includes('BTC') ? 'USDT' : 'TRY'),
    nativeCurrency: symbol.toUpperCase().includes('BTC') ? 'USDT' : 'TRY',
    provider: symbol.toUpperCase().includes('BTC') ? 'BINANCE' : 'YAHOO',
    delayMinutes: 15,
    cacheHit: true,
    fetchedGaps: 0,
    queryMs: 1.0,
    candles: mkCandles(40, currency === 'USD' ? 10 : 300),
  } as HistoryResponse));
  vi.mocked(api.fetchFundamentals).mockResolvedValue(SAMPLE_FUNDAMENTALS);
  vi.mocked(api.fetchCalendar).mockResolvedValue(SAMPLE_CALENDAR);
  vi.mocked(api.fetchOptionChain).mockImplementation(async (symbol: string) => {
    if (symbol.toUpperCase().startsWith('BTC') || symbol.toUpperCase().startsWith('ETH')) {
      return SAMPLE_OPTIONS_BTC;
    }
    return {
      supported: false,
      market: 'BIST',
      symbol: symbol.toUpperCase(),
      reason: 'BIST VİOP opsiyon zinciri için ücretsiz açık veri kaynağı bulunmamaktadır.',
      spotPrice: 0,
      expiries: [],
      selectedExpiry: '',
      daysToExpiry: 0,
      summary: { totalCallOi: 0, totalPutOi: 0, putCallOiRatio: 0, totalVolumeUsd: 0, atmIv: 0, maxPainStrike: 0 },
      rows: [],
    };
  });
});

afterEach(() => {
  cleanup();
});

describe('Faz 26 UI: Sembol ifadeleri, çoklu karşılaştır, kur dönüştürme, olaylar, temel veriler, takvimler, Deribit opsiyon', () => {
  it('Sembol arama: baş harf avatarı, borsa rozeti, filtre hapları, operatör düğmeleri ve sentetik ifade açma', async () => {
    render(() => <App />);
    await waitFor(() => expect(api.fetchHistory).toHaveBeenCalledWith('BTCUSDT', '15m'));

    fireEvent.click($('#btn-symbol-current'));
    expect($('#titan-symbol-search-modal')).toBeTruthy();
    expect(document.querySelectorAll('.sym-avatar').length).toBeGreaterThan(0);
    expect(document.querySelectorAll('.exchange-badge').length).toBeGreaterThan(0);

    // Filter pills including INDEX and EXPR
    fireEvent.click($('[data-modal-filter="INDEX"]'));
    expect($('[data-modal-sym="XU100.IS"]')).toBeTruthy();

    fireEvent.click($('[data-modal-filter="EXPR"]'));
    expect($('[data-preset-expr="BTCUSDT/ETHUSDT"]')).toBeTruthy();

    // Type/build expression via input + operator buttons
    fireEvent.click($('[data-modal-filter="ALL"]'));
    const inp = $('#modal-symbol-search-input') as HTMLInputElement;
    fireEvent.input(inp, { target: { value: 'BTCUSDT' } });
    fireEvent.click($('[data-expr-op="/"]'));
    expect(inp.value).toBe('BTCUSDT/');
    fireEvent.input(inp, { target: { value: 'BTCUSDT/ETHUSDT' } });

    await waitFor(() => expect($('#symbol-expr-preview')).toBeTruthy());
    expect($('#symbol-expr-preview').textContent).toContain('Oran (Parite)');
    fireEvent.click($('#btn-open-symbol-expr'));

    await waitFor(() => expect(api.fetchHistory).toHaveBeenCalledWith('BTCUSDT/ETHUSDT', '15m'));
    expect(ui.symbol).toBe('BTCUSDT/ETHUSDT');
  });

  it('Çoklu karşılaştır (% modu, sol ölçek, kendi ölçeği, gizle/kaldır) ve para birimi dönüştürme (TRY → USD)', async () => {
    render(() => <App />);
    await waitFor(() => expect(api.fetchHistory).toHaveBeenCalledWith('BTCUSDT', '15m'));
    await switchSymbol('THYAO.IS', '15m');
    await waitFor(() => expect(api.fetchHistory).toHaveBeenCalledWith('THYAO.IS', '15m'));

    // Open Compare Modal
    fireEvent.click($('#btn-compare-symbol'));
    expect($('#modal-compare')).toBeTruthy();

    // Add XU100.IS and BTCUSDT in % mode
    fireEvent.click($('[data-cmp-bench="XU100.IS"]'));
    await waitFor(() => expect(comparisons()).toHaveLength(1));
    expect(ui.scaleKind).toBe('percent');

    fireEvent.click($('[data-cmp-bench="BTCUSDT"]'));
    await waitFor(() => expect(comparisons()).toHaveLength(2));
    expect(document.querySelectorAll('[data-cmp-legend]').length).toBe(2);

    // Change scale mode of XU100.IS to 'left', toggle visibility, and remove one
    fireEvent.change($('[data-cmp-item-scale="XU100.IS"]'), { target: { value: 'left' } });
    expect(comparisons()[0].scaleMode).toBe('left');
    fireEvent.click($('[data-cmp-toggle-vis="XU100.IS"]'));
    expect(comparisons()[0].visible).toBe(false);
    fireEvent.click($('[data-cmp-remove="BTCUSDT"]'));
    expect(comparisons()).toHaveLength(1);
    fireEvent.click($('#btn-compare-clear-all'));
    expect(comparisons()).toHaveLength(0);

    // Close modal & test Currency Conversion TRY -> USD
    fireEvent.click($('#modal-compare button[aria-label="Kapat"]'));
    expect($('#lbl-currency-badge').textContent).toBe('TRY');
    fireEvent.click($('#btn-currency-convert'));
    expect($('#currency-convert-menu')).toBeTruthy();
    fireEvent.click($('[data-currency-choice="USD"]'));

    await waitFor(() => expect(api.fetchHistory).toHaveBeenCalledWith('THYAO.IS', '15m', undefined, undefined, 'USD'));
    expect(ui.displayCurrency).toBe('USD');
    expect($('#lbl-currency-badge').textContent).toBe('TRY → USD');
    expect($('#leg-currency').textContent).toBe('TRY → USD');

    // Settings -> Olaylar tab toggles eventFlags
    fireEvent.click($('#btn-chart-settings'));
    fireEvent.click($('[data-cfg-tab="events"]'));
    const divChk = $('#cfg-events-dividends') as HTMLInputElement;
    expect(divChk.checked).toBe(true);
    fireEvent.click(divChk);
    fireEvent.click($('#btn-save-settings'));
    expect(ui.eventFlags.dividends).toBe(false);
  });

  it('Temel veriler (Finansallar), Takvimler (Ekonomik/Kazanç/Temettü/IPO) ve Deribit Opsiyon Zinciri & Strateji Kurucu', async () => {
    render(() => <App />);
    await waitFor(() => expect(api.fetchHistory).toHaveBeenCalledWith('BTCUSDT', '15m'));
    await switchSymbol('THYAO.IS', '15m');
    await waitFor(() => expect(api.fetchHistory).toHaveBeenCalledWith('THYAO.IS', '15m'));

    // 1. Finansallar tab
    fireEvent.click($('[data-wbtab="financials"]'));
    await waitFor(() => expect(api.fetchFundamentals).toHaveBeenCalledWith('THYAO.IS'));
    expect($('#lbl-fin-source').textContent).toContain('KAP / İş Yatırım + Yahoo Finance');
    expect($('#fin-ratios-valuation').textContent).toContain('3.85');
    expect($('#fin-trend-chart')).toBeTruthy();

    fireEvent.click($('[data-fin-tab="income"]'));
    expect($('#fin-table-income').textContent).toContain('Satış Gelirleri');
    fireEvent.click($('[data-fin-tab="balance"]'));
    expect($('#fin-table-balance').textContent).toContain('Toplam Varlıklar');
    fireEvent.click($('[data-fin-tab="cashflow"]'));
    expect($('#fin-table-cashflow').textContent).toContain('Serbest Nakit Akışı');
    fireEvent.click($('#btn-fin-quarterly'));
    fireEvent.click($('[data-fin-tab="income"]'));
    expect($('#fin-table-income').textContent).toContain('2025-Q3');

    // 2. Takvim tab (Workbench + Right Drawer)
    fireEvent.click($('[data-wbtab="calendar"]'));
    await waitFor(() => expect(api.fetchCalendar).toHaveBeenCalled());
    expect($('#cal-econ-table').textContent).toContain('TCMB');
    fireEvent.click($('[data-cal-country="TR"]'));
    expect(document.querySelectorAll('#cal-econ-table tbody tr').length).toBe(1);

    fireEvent.click($('[data-cal-tab="earnings"]'));
    expect($('#cal-earnings-table').textContent).toContain('THYAO.IS');
    fireEvent.click($('[data-cal-tab="dividends"]'));
    expect($('#cal-dividends-table').textContent).toContain('6.85');
    fireEvent.click($('[data-cal-tab="ipo"]'));
    expect($('#cal-ipo-sources').textContent).toContain('SPK');

    // Also verify Right Drawer Calendar tab
    fireEvent.click($('[data-docktab="calendar"]'));
    expect($('#drawer-panel-calendar')).toBeTruthy();

    // 3. Opsiyonlar tab: starts on THYAO.IS -> shows honest BIST VİOP unsupported notice -> switch to Deribit BTC
    fireEvent.click($('[data-wbtab="options"]'));
    await waitFor(() => expect($('#opt-unsupported')).toBeTruthy());
    expect($('#opt-unsupported').textContent).toContain('BIST VİOP');

    fireEvent.click($('#btn-opt-switch-btc'));
    await waitFor(() => expect($('#options-chain-table')).toBeTruthy());
    expect($('#viop-unsupported-banner').textContent).toContain('BIST VİOP Notu');
    expect($('#options-chain-table').textContent).toContain('60,000');
    expect($('#options-payoff-svg')).toBeTruthy();

    // Switch strategy preset to Iron Condor & add a custom leg from the chain
    fireEvent.click($('[data-opt-preset="iron_condor"]'));
    expect(document.querySelectorAll('#opt-legs-list .opt-leg-chip').length).toBe(4);
    fireEvent.click($('[data-add-leg="C-BUY-60000"]'));
    expect(document.querySelectorAll('#opt-legs-list .opt-leg-chip').length).toBe(5);
    fireEvent.click($('#btn-opt-clear-legs'));
    expect(document.querySelectorAll('#opt-legs-list .opt-leg-chip').length).toBe(0);
  });
});
