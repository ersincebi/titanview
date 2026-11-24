// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Candle, HistoryResponse } from '../../types/market';

// In-memory mock saved-layouts server
const laySrv = vi.hoisted(() => ({
  rows: [] as Array<{
    id: string;
    name: string;
    state: Record<string, unknown>;
    gridId: string;
    chartCount: number;
    symbols: string;
    autosave: boolean;
    isShared: boolean;
    shareToken: string;
    createdAt: number;
    updatedAt: number;
  }>,
  seq: 0,
}));

vi.mock('../../api/layouts', () => ({
  listLayoutsApi: vi.fn(async () => laySrv.rows.map(({ state: _s, ...sum }) => ({ ...sum }))),
  getLayoutApi: vi.fn(async (id: string) => {
    const f = laySrv.rows.find((x) => x.id === id);
    if (!f) throw new Error('404');
    return { ...f };
  }),
  createLayoutApi: vi.fn(async (p: Record<string, unknown>) => {
    const n = ++laySrv.seq;
    const rec = {
      id: `lay_${n}`,
      name: String(p.name || 'Adsız'),
      state: (p.state as Record<string, unknown>) ?? {},
      gridId: String(p.gridId || 'single'),
      chartCount: Number(p.chartCount || 1),
      symbols: String(p.symbols || ''),
      autosave: p.autosave !== false,
      isShared: false,
      shareToken: '',
      createdAt: 1700000000 + n,
      updatedAt: 1700000000 + n,
    };
    laySrv.rows.unshift(rec);
    return { ...rec };
  }),
  updateLayoutApi: vi.fn(async (id: string, patch: Record<string, unknown>) => {
    const f = laySrv.rows.find((x) => x.id === id);
    if (!f) throw new Error('404');
    Object.assign(f, patch, { updatedAt: f.updatedAt + 1 });
    return { ...f };
  }),
  copyLayoutApi: vi.fn(async (id: string, name?: string) => {
    const src = laySrv.rows.find((x) => x.id === id);
    if (!src) throw new Error('404');
    const n = ++laySrv.seq;
    const rec = { ...src, id: `lay_${n}`, name: name || `${src.name} (kopya)`, isShared: false, shareToken: '', createdAt: 1700000000 + n, updatedAt: 1700000000 + n };
    laySrv.rows.unshift(rec);
    return { ...rec };
  }),
  shareLayoutApi: vi.fn(async (id: string, shared: boolean, regenerate = false) => {
    const f = laySrv.rows.find((x) => x.id === id);
    if (!f) throw new Error('404');
    f.isShared = shared;
    if (shared && (!f.shareToken || regenerate)) f.shareToken = `tok_${id}_${++laySrv.seq}`;
    return { id: f.id, isShared: f.isShared, shareToken: f.isShared ? f.shareToken : '', updatedAt: ++f.updatedAt };
  }),
  deleteLayoutApi: vi.fn(async (id: string) => {
    laySrv.rows = laySrv.rows.filter((x) => x.id !== id);
  }),
  getSharedLayoutApi: vi.fn(async (token: string) => {
    const f = laySrv.rows.find((x) => x.isShared && x.shareToken === token);
    if (!f) throw new Error('Paylaşılan düzen bulunamadı');
    return { layout: { ...f }, drawings: [], readOnly: true as const };
  }),
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
  saveScript: vi.fn(),
  deleteScript: vi.fn(),
  renameScript: vi.fn(),
  listVersions: vi.fn(async () => []),
}));

vi.mock('../../api/client', () => ({
  fetchHistory: vi.fn(),
  fetchSymbols: vi.fn(async () => []),
  fetchScreener: vi.fn(async () => []),
  fetchQuotes: vi.fn(async () => []),
  fetchDrawings: vi.fn(async () => []),
  parseDrawingRows: vi.fn(() => []),
  persistDrawing: vi.fn(async () => {}),
  clearSymbolDrawings: vi.fn(async () => {}),
  saveCustomScript: vi.fn(async () => null),
  fetchSavedScripts: vi.fn(async () => []),
  fetchCorporateEvents: vi.fn(async (symbol: string) => ({ symbol, supported: false, dividends: [], splits: [], earnings: [] })),
  fetchFxRates: vi.fn(async (from: string, to: string) => ({ from, to, pair: `${from}/${to}`, supported: false, rates: [] })),
  fetchSetting: vi.fn(async () => null),
  saveSetting: vi.fn(async () => {}),
  fetchOverview: vi.fn(async () => []),
  fetchCorrelation: vi.fn(),
  fetchSecurity: vi.fn(),
  fetchAnalysis: vi.fn(() => new Promise(() => {})),
  fetchRelated: vi.fn(async () => ({ positive: [], negative: [], cross: [], note: '' })),
  fetchFlow: vi.fn(async () => ({})),
  fetchIdeas: vi.fn(async () => []),
  fetchNews: vi.fn(async () => []),
  syncCollectSymbols: vi.fn(async (s: string[]) => s),
  fetchCollectItems: vi.fn(async () => []),
  fetchFootprint: vi.fn(async () => ({ supported: false })),
}));

import * as api from '../../api/client';
import { resetStore, ui } from '../../state/store';
import { activeLayoutName, loadSharedLayoutFromToken, readOnlyLayout } from '../../state/savedLayouts';
import { App } from '../App';

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;

const sampleBars = (n = 20): Candle[] =>
  Array.from({ length: n }, (_, i) => ({
    time: 1700000000 + i * 900,
    open: 100 + i,
    high: 102 + i,
    low: 99 + i,
    close: 101 + i,
    volume: 1000,
  }));

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

describe('Faz 25 UI: 42 düzen (1–16 grafik), tüm eşitlemeler, çoklu kayıtlı düzen, özel aralıklar', () => {
  beforeEach(() => {
    memStore.clear();
    laySrv.rows = [];
    laySrv.seq = 0;
    resetStore();
    vi.mocked(api.fetchHistory).mockImplementation(async (symbol, interval): Promise<HistoryResponse> => ({
      symbol,
      interval,
      displayName: symbol,
      market: symbol.endsWith('USDT') ? 'CRYPTO' : 'BIST',
      currency: symbol.endsWith('USDT') ? 'USDT' : 'TRY',
      provider: symbol.endsWith('USDT') ? 'BINANCE' : 'YAHOO',
      delayMinutes: 0,
      cacheHit: true,
      fetchedGaps: 0,
      queryMs: 1,
      candles: sampleBars(),
    }));
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  async function boot() {
    render(() => <App />);
    await waitFor(() => expect(api.fetchHistory).toHaveBeenCalled());
  }

  it('opens Standart Layout Grid menu with 42 templates, switches up to 16 charts (4x4), and toggles Alt+Enter maximize', async () => {
    await boot();
    fireEvent.click($('#btn-split-layout'));
    expect($('#dropdown-layout-grid')).toBeTruthy();
    expect(document.querySelectorAll('#dropdown-layout-grid .layout-tpl-btn').length).toBeGreaterThanOrEqual(40);

    // 16 grafiğe geç (4x4)
    fireEvent.click($('[data-layout-id="4x4"]'));
    expect(ui.layout).toBe('4x4');
    await waitFor(() => expect(document.querySelectorAll('.secondary-chart-pane').length).toBe(15));
    expect($('#charts-grid-area').classList.contains('dense-grid')).toBe(true);

    // 2. hücreye tıkla ve Alt+Enter ile büyüt / geri al
    const slot2 = $('[data-slot="2"]');
    fireEvent.mouseDown(slot2);
    expect(ui.activeSlot).toBe(2);
    fireEvent.keyDown(window, { key: 'Enter', altKey: true });
    expect(ui.maximizedSlot).toBe(2);
    fireEvent.keyDown(window, { key: 'Enter', altKey: true });
    expect(ui.maximizedSlot).toBeNull();
  });

  it('toggles all 7 sync switches (symbol, interval, crosshair, time, dateRange, drawings, crossTab)', async () => {
    await boot();
    fireEvent.click($('#btn-split-layout'));
    fireEvent.click($('[data-layout-id="2x1"]'));
    await waitFor(() => expect(document.querySelectorAll('.secondary-chart-pane').length).toBe(1));

    // Yeniden aç ve tüm eşitlemeleri kontrol et
    fireEvent.click($('#btn-split-layout'));
    fireEvent.click($('#sync-symbol'));
    fireEvent.click($('#sync-interval'));
    fireEvent.click($('#sync-time'));
    fireEvent.click($('#sync-daterange'));
    fireEvent.click($('#sync-crosstab'));
    fireEvent.click($('[data-sync-drawings="global"]'));

    expect(ui.sync).toEqual({
      symbol: true,
      interval: true,
      crosshair: true,
      time: true,
      dateRange: true,
      drawings: 'global',
      crossTab: true,
    });

    // Sembol eşitlemesi açıkken 2. hücrede sembol değişince ana grafik de BTCUSDT'ye geçer
    fireEvent.change($('#sel-sec-symbol'), { target: { value: 'BTCUSDT' } });
    await waitFor(() => expect(ui.symbol).toBe('BTCUSDT'));
  });

  it('manages multiple saved layouts: save, rename, autosave, copy, share link, open modal, delete, and read-only view', async () => {
    await boot();

    // 1. Kaydet
    fireEvent.click($('#btn-save-layout'));
    await waitFor(() => expect(laySrv.rows).toHaveLength(1));

    // 2. Menüden yeniden adlandır, otomatik kaydet kapat, paylaşım aç
    fireEvent.click($('#btn-layout-menu'));
    fireEvent.click($('#btn-layout-rename'));
    fireEvent.input($('#inp-layout-rename'), { target: { value: 'Kripto Tarama' } });
    fireEvent.click($('#btn-layout-rename-ok'));
    await waitFor(() => expect(activeLayoutName()).toBe('Kripto Tarama'));

    fireEvent.click($('#chk-layout-autosave'));
    fireEvent.click($('#chk-layout-share'));
    await waitFor(() => expect($('#inp-share-url')).toBeTruthy());
    const shareUrl = ($('#inp-share-url') as HTMLInputElement).value;
    expect(shareUrl).toContain('?share=');
    const token = new URL(shareUrl, 'http://localhost').searchParams.get('share')!;

    // 3. Kopya oluştur
    fireEvent.click($('#btn-layout-copy'));
    await waitFor(() => expect(laySrv.rows).toHaveLength(2));
    expect(activeLayoutName()).toBe('Kripto Tarama (kopya)');

    // 4. Düzen yükle modalı: ara, aç, sil
    fireEvent.click($('#btn-layout-menu'));
    fireEvent.click($('#btn-layout-open-modal'));
    await waitFor(() => expect(document.querySelectorAll('[data-saved-layout]').length).toBe(2));

    const firstId = laySrv.rows[0].id;
    fireEvent.click($(`[data-layout-del="${firstId}"]`));
    await waitFor(() => expect(laySrv.rows).toHaveLength(1));

    // 5. Salt-okur paylaşılan bağlantı açma + kopya oluşturarak düzenlenebilir hale getirme
    const ok = await loadSharedLayoutFromToken(token);
    expect(ok).toBe(true);
    expect(readOnlyLayout()?.name).toBe('Kripto Tarama');
    await waitFor(() => expect($('#readonly-layout-banner')).toBeTruthy());

    fireEvent.click($('#btn-clone-shared'));
    await waitFor(() => expect(readOnlyLayout()).toBeNull());
    expect(laySrv.rows).toHaveLength(2);
  });

  it('supports grouped custom intervals (seconds/hours/days/months), favorite stars, and add/remove custom interval', async () => {
    await boot();
    fireEvent.click($('#btn-tf-dropdown'));
    expect($('#dropdown-timeframes').classList.contains('open')).toBe(true);
    expect($('[data-tf-drop="5s"]')).toBeTruthy();
    expect($('[data-tf-drop="2h"]')).toBeTruthy();
    expect($('[data-tf-drop="2d"]')).toBeTruthy();
    expect($('[data-tf-drop="3M"]')).toBeTruthy();

    // 2h'yi favori yıldızla üst çubuğa sabitle
    fireEvent.click($('[data-tf-fav="2h"]'));
    expect(ui.favTimeframes).toContain('2h');
    expect($('[data-tf="2h"]')).toBeTruthy();

    // Özel aralık ekle: 7s
    fireEvent.input($('#inp-custom-tf-val'), { target: { value: '7' } });
    fireEvent.change($('#sel-custom-tf-unit'), { target: { value: 's' } });
    fireEvent.click($('#btn-add-custom-tf'));
    expect(ui.customTimeframes).toContain('7s');
    await waitFor(() => expect(api.fetchHistory).toHaveBeenCalledWith('BTCUSDT', '7s'));

    // Özel aralığı menüden sil
    fireEvent.click($('#btn-tf-dropdown'));
    fireEvent.click($('[data-tf-del="7s"]'));
    expect(ui.customTimeframes).not.toContain('7s');
  });
});
