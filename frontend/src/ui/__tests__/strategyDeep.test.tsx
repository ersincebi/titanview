// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Candle, Timeframe } from '../../types/market';

const STEP = 3600;
const T0 = 1_700_000_000;

function synth(count: number, startIdx = 0, step = STEP): Candle[] {
  let s = 17 + startIdx;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  let p = 100;
  return Array.from({ length: count }, (_, k) => {
    const i = startIdx + k;
    const o = p;
    p = Math.max(20, p + Math.sin(i / 8) * 2.5 + (rnd() - 0.5) * 0.8);
    return { time: T0 + i * step, open: o, high: Math.max(o, p) + 0.5, low: Math.min(o, p) - 0.5, close: p, volume: 100 };
  });
}

const ALL_1H = synth(400, 0, STEP);
const ALL_5M = synth(400 * 12, 0, 300);

const apiState = vi.hoisted(() => ({
  calls: [] as Array<{ symbol: string; interval: string; from?: number; to?: number }>,
  failHistory: false,
}));

vi.mock('../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client');
  return {
    ...actual,
    fetchHistory: vi.fn(async (symbol: string, interval: Timeframe, from?: number, to?: number) => {
      apiState.calls.push({ symbol, interval, from, to });
      if (apiState.failHistory) throw new Error('ağ hatası');
      const src = interval === '5m' ? ALL_5M : ALL_1H;
      const list = src.filter((c) => (from === undefined || c.time >= from) && (to === undefined || c.time <= to));
      return {
        symbol,
        interval,
        displayName: symbol,
        market: 'CRYPTO' as const,
        currency: 'USDT',
        provider: 'BINANCE' as const,
        delayMinutes: 0,
        cacheHit: true,
        fetchedGaps: 0,
        queryMs: 1,
        candles: list,
      };
    }),
  };
});

import { Workbench } from '../Workbench';
import {
  btRange,
  magnifierCandles,
  magnifierOn,
  resetDeepTest,
  selectedTradeId,
  tradeLabels,
  tradeLines,
} from '../../state/deepTest';
import {
  cancelDeep,
  cancelOptimization,
  optResults,
  toggleMagnifier,
} from '../../state/deepTestRun';
import { rt } from '../../state/runtime';
import {
  candles,
  scriptInputOverrides,
  scriptResult,
  resetStore,
  runScript,
  setCandles,
  setUi,
} from '../../state/store';

const STRAT_CODE = `//@version=5
strategy("Test Cross", overlay=true)
fl = input.int(5, "Hızlı", minval=3, maxval=9)
sl = input.int(18, "Yavaş", minval=12, maxval=24)
f = ta.sma(close, fl)
s = ta.sma(close, sl)
if ta.crossover(f, s)
    strategy.entry("L", strategy.long)
if ta.crossunder(f, s)
    strategy.close("L")
plot(f)`;

const $ = (sel: string) => document.querySelector(sel) as HTMLElement;

const chartMock = () => {
  const calls = { prepend: [] as Candle[][], focusRange: [] as Array<[number, number]> };
  let focusOk = true;
  rt.chart = {
    prependHistoryData: vi.fn((c: Candle[]) => calls.prepend.push(c)),
    focusRange: vi.fn((a: number, b: number) => {
      calls.focusRange.push([a, b]);
      return focusOk;
    }),
    focusTime: vi.fn(),
    setTradeOverlay: vi.fn(),
  } as unknown as typeof rt.chart;
  return { calls, setFocusOk: (v: boolean) => (focusOk = v) };
};

beforeEach(() => {
  apiState.calls = [];
  apiState.failHistory = false;
  resetStore();
  resetDeepTest();
  setUi('symbol', 'BTCUSDT');
  setUi('interval', '1h');
  setUi('wbTab', 'backtest');
  setUi('scriptCode', STRAT_CODE);
  setUi('scriptCode2', '');
  setCandles(ALL_1H.slice(200));
  runScript();
});

afterEach(() => {
  cleanup();
  rt.chart = undefined;
  vi.restoreAllMocks();
});

describe('Faz 24 UI — Derin Backtest, Bar Büyüteci, İşleme Git, Dışa Aktarım, Optimizasyon', () => {
  it('derin geçmiş yükler, eski mumları grafiğe ekler ve stratejiyi daha fazla barla yeniden çalıştırır', async () => {
    const cm = chartMock();
    render(() => <Workbench />);
    const beforeBars = scriptResult()!.backtest!.equityCurve!.length;
    expect(beforeBars).toBe(200);

    fireEvent.click($('#btn-deep-history'));
    await waitFor(() => expect($('#deep-status')?.getAttribute('data-phase')).toBe('done'));
    expect(candles().length).toBe(400);
    expect(cm.calls.prepend.length).toBeGreaterThan(0);
    expect(scriptResult()!.backtest!.equityCurve!.length).toBe(400);
    expect($('#deep-status').textContent).toContain('400 bar');
  });

  it('tarih aralığı: özel tarih + hızlı kısayol uygular ve temizler', async () => {
    chartMock();
    render(() => <Workbench />);
    const fromEl = $('#deep-from') as HTMLInputElement;
    const toEl = $('#deep-to') as HTMLInputElement;
    // son 100 barın yaklaşık aralığı
    const d1 = new Date(ALL_1H[250].time * 1000).toISOString().slice(0, 10);
    const d2 = new Date(ALL_1H[350].time * 1000).toISOString().slice(0, 10);
    fromEl.value = d1;
    toEl.value = d2;
    fireEvent.click($('#btn-deep-apply'));
    await waitFor(() => expect(btRange()).not.toBeNull());
    await waitFor(() => expect(scriptResult()!.backtest!.equityCurve!.length).toBeLessThan(150));

    // temizle
    fireEvent.click($('#btn-deep-clear'));
    await waitFor(() => expect(btRange()).toBeNull());
    expect(scriptResult()!.backtest!.equityCurve!.length).toBe(200);

    // hızlı kısayol (1M, ALL)
    fireEvent.change($('#deep-preset'), { target: { value: '1M' } });
    await waitFor(() => expect(btRange()).not.toBeNull());
    await waitFor(() => expect($('#deep-status')?.getAttribute('data-phase')).toBe('done'));
    fireEvent.change($('#deep-preset'), { target: { value: 'ALL' } });
    await waitFor(() => expect(btRange()).toBeNull());
    await waitFor(() => expect($('#deep-status')?.getAttribute('data-phase')).toBe('done'));
  });

  it('bar büyüteci açılınca alt TF (5m) verisi çekilir ve Özellikler sekmesinde görünür; 1m için kapalı', async () => {
    chartMock();
    render(() => <Workbench />);
    const chk = $('#chk-magnifier') as HTMLInputElement;
    expect(chk.disabled).toBe(false);
    fireEvent.change(chk, { target: { checked: true } });
    await waitFor(() => expect(magnifierCandles().length).toBeGreaterThan(100));
    expect(magnifierOn()).toBe(true);
    expect(apiState.calls.some((c) => c.interval === '5m')).toBe(true);

    // Özellikler sekmesinde Bar Büyüteci + Rust→WASM görünür
    fireEvent.click($('[data-strat-tab="props"]'));
    expect($('#prop-magnifier').textContent).toContain('Açık (5M');
    expect($('#prop-wasm').textContent).toContain('Rust→WASM');

    // kapat
    fireEvent.change(chk, { target: { checked: false } });
    expect(magnifierOn()).toBe(false);
    expect(magnifierCandles()).toHaveLength(0);

    // 1m için kullanılamaz
    setUi('interval', '1m');
    toggleMagnifier(true);
    expect(magnifierOn()).toBe(false);
  });

  it('işlem listesinden tıkla → grafikte focusRange + satır seçimi + ◀/▶ gezinme + çizgi/etiket anahtarları', async () => {
    const cm = chartMock();
    render(() => <Workbench />);
    fireEvent.click($('[data-strat-tab="trades"]'));
    const rows = document.querySelectorAll('#bt-full-trades-tbody tr');
    expect(rows.length).toBeGreaterThan(2);

    fireEvent.click(rows[0]);
    expect(cm.calls.focusRange).toHaveLength(1);
    const id1 = Number(rows[0].getAttribute('data-trade-id'));
    expect(selectedTradeId()).toBe(id1);
    expect(rows[0].classList.contains('trade-row-selected')).toBe(true);

    fireEvent.click($('#btn-trade-prev'));
    expect(cm.calls.focusRange).toHaveLength(2);
    expect(selectedTradeId()).not.toBe(id1);

    fireEvent.click($('#btn-trade-next'));
    expect(selectedTradeId()).toBe(id1);

    // aralık dışı işlem uyarısı çökmez
    cm.setFocusOk(false);
    fireEvent.click(rows[1]);
    expect(cm.calls.focusRange).toHaveLength(4);

    // çizgi & etiket aç-kapa
    fireEvent.change($('#chk-trade-lines'), { target: { checked: false } });
    fireEvent.change($('#chk-trade-labels'), { target: { checked: false } });
    expect(tradeLines()).toBe(false);
    expect(tradeLabels()).toBe(false);
  });

  it('CSV ve Excel (.xlsx) dışa aktarım butonları geçerli dosya indirir', () => {
    chartMock();
    const blobs: Blob[] = [];
    const origCreate = URL.createObjectURL;
    const origRevoke = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn((b: Blob) => {
      blobs.push(b);
      return 'blob:test';
    });
    URL.revokeObjectURL = vi.fn();
    const clicks: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicks.push(this.download);
    });

    render(() => <Workbench />);
    fireEvent.click($('#btn-export-csv'));
    fireEvent.click($('#btn-export-xlsx'));

    expect(clicks).toEqual(['Test_Cross_BTCUSDT_1h_islemler.csv', 'Test_Cross_BTCUSDT_1h_islemler.xlsx']);
    expect(blobs).toHaveLength(2);
    expect(blobs[0].size).toBeGreaterThan(50);
    expect(blobs[1].size).toBeGreaterThan(500);

    URL.createObjectURL = origCreate;
    URL.revokeObjectURL = origRevoke;
  });

  it('optimizasyon sekmesi: ızgara + genetik koşar, sonuçları listeler ve Uygula girdiyi günceller', async () => {
    chartMock();
    render(() => <Workbench />);
    fireEvent.click($('[data-strat-tab="optimize"]'));

    // parametre seçmeden çalıştırmak uyarı verir
    const checks = document.querySelectorAll('#opt-params input.opt-enable');
    expect(checks.length).toBe(2);
    fireEvent.change(checks[0], { target: { checked: true } });
    fireEvent.change($('#opt-method'), { target: { value: 'grid' } });
    fireEvent.change($('#opt-objective'), { target: { value: 'net' } });
    fireEvent.change($('#opt-mintrades'), { target: { value: '1' } });
    fireEvent.change($('#opt-budget'), { target: { value: '20' } });
    fireEvent.click($('#btn-opt-run'));

    await waitFor(() => expect(optResults().length).toBeGreaterThan(0));
    const applyBtns = document.querySelectorAll('#opt-results button.opt-apply');
    expect(applyBtns.length).toBeGreaterThan(0);
    const bestVal = optResults()[0].params.Hızlı;
    fireEvent.click(applyBtns[0]);
    expect(scriptInputOverrides().Hızlı).toBe(bestVal);

    // genetik yöntemle de çalışır
    fireEvent.change($('#opt-method'), { target: { value: 'genetic' } });
    fireEvent.change($('#opt-budget'), { target: { value: '16' } });
    fireEvent.click($('#btn-opt-run'));
    await waitFor(() => expect(optResults().length).toBeGreaterThan(0));
    cancelOptimization();
    cancelDeep();
  });

  it('derin test ağ hatasında hata durumunu gösterir', async () => {
    apiState.failHistory = true;
    chartMock();
    render(() => <Workbench />);
    fireEvent.click($('[data-strat-tab="overview"]'));
    fireEvent.click($('#btn-deep-history'));
    await waitFor(() => expect($('#deep-status')?.getAttribute('data-phase')).toBe('error'));
    expect($('#deep-status').textContent).toContain('ağ hatası');
  });
});
