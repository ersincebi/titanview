import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Candle, Timeframe } from '../../types/market';
import {
  SUPPORTED_TIMEFRAMES,
  alignTimestampToTimeframe,
  calculateCandleCountForRange,
  formatTimeframe,
  getNextCandleTimestamp,
  getTimeframeLabel,
  isDailyOrHigher,
  isIntraday,
  isValidTimeframe,
  timeframeToMilliseconds,
  timeframeToMinutes,
  timeframeToSeconds,
} from '../timeframe';
import { calculateSingleHeikinAshi, toHeikinAshi } from '../heikinAshi';
import { lwcState, mockPriceScale, resetLwcState, resetScales } from './lwcMock';

// Setup Mock Lightweight Charts (v5) and DOM
vi.mock('lightweight-charts', async () => (await import('./lwcMock')).lwcModule());

beforeAll(() => {
  if (typeof window === 'undefined') {
    const mockElement = (tag = 'div') => {
      const children: any[] = [];
      const listeners = new Map<string, Function[]>();
      const el: any = {
        tagName: tag.toUpperCase(),
        style: {},
        dataset: {},
        classList: {
          _classes: new Set<string>(),
          add: vi.fn((c: string) => el.classList._classes.add(c)),
          remove: vi.fn((c: string) => el.classList._classes.delete(c)),
          toggle: vi.fn((c: string, force?: boolean) => {
            if (force !== undefined) {
              if (force) el.classList._classes.add(c);
              else el.classList._classes.delete(c);
            } else {
              if (el.classList._classes.has(c)) el.classList._classes.delete(c);
              else el.classList._classes.add(c);
            }
          }),
          contains: (c: string) => el.classList._classes.has(c),
        },
        childNodes: children,
        appendChild: vi.fn((child) => {
          children.push(child);
          return child;
        }),
        removeChild: vi.fn((child) => {
          const idx = children.indexOf(child);
          if (idx >= 0) children.splice(idx, 1);
          return child;
        }),
        remove: vi.fn(),
        setAttribute: vi.fn(),
        getAttribute: vi.fn(() => null),
        addEventListener: vi.fn((event: string, fn: Function) => {
          if (!listeners.has(event)) listeners.set(event, []);
          listeners.get(event)!.push(fn);
        }),
        removeEventListener: vi.fn(),
        dispatchEvent: (event: string, ...args: any[]) => {
          listeners.get(event)?.forEach((fn) => fn(...args));
        },
        querySelectorAll: vi.fn((selector: string) => {
          return children;
        }),
        querySelector: vi.fn(() => null),
        clientWidth: 800,
        clientHeight: 600,
        innerHTML: '',
        textContent: '',
      };
      return el;
    };

    (globalThis as any).window = {
      location: { protocol: 'http:', host: 'localhost:8080' },
      setTimeout: (fn: Function) => setTimeout(fn, 0),
      clearTimeout: (id: any) => clearTimeout(id),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };

    (globalThis as any).document = {
      createElement: vi.fn((tag: string) => mockElement(tag)),
      getElementById: vi.fn(() => mockElement('div')),
      querySelectorAll: vi.fn(() => []),
      querySelector: vi.fn(() => null),
      body: mockElement('body'),
    };

    (globalThis as any).ResizeObserver = class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    };

    (globalThis as any).WebSocket = class {
      static OPEN = 1;
      readyState = 1;
      send = vi.fn();
      close = vi.fn();
      onopen = vi.fn();
      onmessage = vi.fn();
      onclose = vi.fn();
      onerror = vi.fn();
    };

    (globalThis as any).fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        symbol: 'THYAO.IS',
        interval: '15m',
        market: 'BIST',
        currency: 'TRY',
        displayName: 'Türk Hava Yolları',
        provider: 'YAHOO',
        delayMinutes: 15,
        cacheHit: true,
        fetchedGaps: 0,
        queryMs: 0.8,
        candles: sampleCandles(5),
      }),
    }));
  }
});

beforeEach(() => {
  resetLwcState();
  resetScales();
});

function sampleCandles(count = 10): Candle[] {
  const out: Candle[] = [];
  const baseTime = 1731200000;
  for (let i = 0; i < count; i++) {
    out.push({
      time: baseTime + i * 900,
      open: 100 + i,
      high: 105 + i,
      low: 98 + i,
      close: 103 + i,
      volume: 1000 + i * 50,
    });
  }
  return out;
}

// Dynamic imports to ensure mocks are registered
import { TitanChartController } from '../ChartController';

describe('1. Timeframe Module (timeframe.ts)', () => {
  it('validates supported timeframes correctly', () => {
    expect(SUPPORTED_TIMEFRAMES).toContain('1s');
    expect(SUPPORTED_TIMEFRAMES).toContain('15m');
    expect(SUPPORTED_TIMEFRAMES).toContain('2h');
    expect(SUPPORTED_TIMEFRAMES).toContain('2d');
    expect(SUPPORTED_TIMEFRAMES).toContain('1M');
    expect(SUPPORTED_TIMEFRAMES).toContain('12M');
    expect(isValidTimeframe('1s')).toBe(true);
    expect(isValidTimeframe('30s')).toBe(true);
    expect(isValidTimeframe('1m')).toBe(true);
    expect(isValidTimeframe('15m')).toBe(true);
    expect(isValidTimeframe('2h')).toBe(true);
    expect(isValidTimeframe('4h')).toBe(true);
    expect(isValidTimeframe('1d')).toBe(true);
    expect(isValidTimeframe('2d')).toBe(true);
    expect(isValidTimeframe('1w')).toBe(true);
    expect(isValidTimeframe('3M')).toBe(true);
    expect(isValidTimeframe('7q')).toBe(false);
    expect(isValidTimeframe('13M')).toBe(false);
  });

  it('converts timeframes to seconds, minutes, and milliseconds', () => {
    expect(timeframeToSeconds('1m')).toBe(60);
    expect(timeframeToSeconds('5m')).toBe(300);
    expect(timeframeToSeconds('15m')).toBe(900);
    expect(timeframeToSeconds('1h')).toBe(3600);
    expect(timeframeToSeconds('4h')).toBe(14400);
    expect(timeframeToSeconds('1d')).toBe(86400);
    expect(timeframeToSeconds('1w')).toBe(604800);

    expect(timeframeToMinutes('1m')).toBe(1);
    expect(timeframeToMinutes('15m')).toBe(15);
    expect(timeframeToMinutes('1h')).toBe(60);
    expect(timeframeToMinutes('4h')).toBe(240);

    expect(timeframeToMilliseconds('1m')).toBe(60000);
    expect(timeframeToMilliseconds('15m')).toBe(900000);
  });

  it('formats timeframes and provides human labels', () => {
    expect(formatTimeframe('1m')).toBe('1M');
    expect(formatTimeframe('15m')).toBe('15M');
    expect(formatTimeframe('1d')).toBe('1D');
    expect(formatTimeframe('1w')).toBe('1W');

    expect(getTimeframeLabel('15m')).toBe('15 Dakika');
    expect(getTimeframeLabel('1d')).toBe('1 Gün');
  });

  it('identifies intraday vs daily/weekly timeframes', () => {
    expect(isIntraday('1m')).toBe(true);
    expect(isIntraday('15m')).toBe(true);
    expect(isIntraday('4h')).toBe(true);
    expect(isIntraday('1d')).toBe(false);
    expect(isIntraday('1w')).toBe(false);

    expect(isDailyOrHigher('1d')).toBe(true);
    expect(isDailyOrHigher('1w')).toBe(true);
    expect(isDailyOrHigher('1h')).toBe(false);
  });

  it('aligns timestamps and calculates expected bar counts', () => {
    const rawTime = 1731200123;
    expect(alignTimestampToTimeframe(rawTime, '1m')).toBe(
      Math.floor(rawTime / 60) * 60
    );
    expect(alignTimestampToTimeframe(rawTime, '15m')).toBe(
      Math.floor(rawTime / 900) * 900
    );

    const nextBar = getNextCandleTimestamp(rawTime, '15m');
    expect(nextBar).toBe(alignTimestampToTimeframe(rawTime, '15m') + 900);

    const count = calculateCandleCountForRange(1731200000, 1731200000 + 900 * 10, '15m');
    expect(count).toBe(10);
    expect(calculateCandleCountForRange(1731200000, 1731200000, '15m')).toBe(0);
    expect(calculateCandleCountForRange(1731200000, 1731100000, '15m')).toBe(0);
  });
});

describe('2. Heikin-Ashi Module (heikinAshi.ts)', () => {
  it('returns empty array when input is empty', () => {
    expect(toHeikinAshi([])).toEqual([]);
  });

  it('calculates Heikin-Ashi formulas accurately for historical candles', () => {
    const raw: Candle[] = [
      { time: 1000, open: 10, high: 15, low: 8, close: 12, volume: 500 },
      { time: 1060, open: 12, high: 18, low: 11, close: 16, volume: 600 },
      { time: 1120, open: 16, high: 17, low: 13, close: 14, volume: 550 },
    ];

    const ha = toHeikinAshi(raw);
    expect(ha.length).toBe(3);

    // Candle 0
    expect(ha[0].close).toBe(11.25);
    expect(ha[0].open).toBe(11.0);
    expect(ha[0].high).toBe(15);
    expect(ha[0].low).toBe(8);

    // Candle 1
    expect(ha[1].close).toBe(14.25);
    expect(ha[1].open).toBe(11.125);
    expect(ha[1].high).toBe(18);
    expect(ha[1].low).toBe(11);
  });

  it('calculates single live Heikin-Ashi candle matching batch computation', () => {
    const raw = sampleCandles(5);
    const batchHA = toHeikinAshi(raw);

    const firstSingle = calculateSingleHeikinAshi(raw[0], null);
    expect(firstSingle.close).toBe(batchHA[0].close);
    expect(firstSingle.open).toBe(batchHA[0].open);

    const secondSingle = calculateSingleHeikinAshi(raw[1], firstSingle);
    expect(secondSingle.close).toBe(batchHA[1].close);
    expect(secondSingle.open).toBe(batchHA[1].open);
  });
});

describe('4. Chart Controller Module (ChartController.ts)', () => {
  it('initializes chart and handles history data and lazy prepending', () => {
    const mainEl = document.createElement('div');
    const hoverFn = vi.fn();
    const lazyFn = vi.fn();

    const ctrl = new TitanChartController(
      mainEl,
      hoverFn,
      undefined,
      lazyFn
    );

    const initialCandles = sampleCandles(5);
    ctrl.setHistoryData(initialCandles);
    expect(ctrl.getCandles().length).toBe(5);

    // Prepend older candles (simulating lazy scroll backwards)
    const olderCandles: Candle[] = [
      {
        time: initialCandles[0].time - 1800,
        open: 90,
        high: 95,
        low: 88,
        close: 92,
        volume: 800,
      },
      {
        time: initialCandles[0].time - 900,
        open: 92,
        high: 98,
        low: 91,
        close: 96,
        volume: 900,
      },
      // Duplicate of initialCandles[0] to test deduplication
      initialCandles[0],
    ];

    ctrl.prependHistoryData(olderCandles);
    expect(ctrl.getCandles().length).toBe(7);
    expect(ctrl.getCandles()[0].time).toBe(initialCandles[0].time - 1800);

    // Chart style modes (candles, hollow, heikin, line, area, baseline, bar)
    ctrl.setChartStyleMode('bar');
    ctrl.setChartStyleMode('heikin');
    ctrl.setChartStyleMode('line');
    ctrl.setChartStyleMode('area');
    ctrl.setChartStyleMode('baseline');
    ctrl.setChartStyleMode('candles');

    // Price scale modes
    ctrl.setPriceScaleKind('log');
    expect(ctrl.getPriceScaleKind()).toBe('log');
    ctrl.setPriceScaleKind('percent');
    expect(ctrl.getPriceScaleKind()).toBe('percent');
    ctrl.setPriceScaleKind('normal');
    expect(ctrl.getPriceScaleKind()).toBe('normal');

    // Quick indicators toggling
    ctrl.setQuickIndicators({ ema9: true, sma200: true, bb: true });
    const flags = ctrl.getQuickIndicators();
    expect(flags.ema9).toBe(true);
    expect(flags.sma200).toBe(true);
    expect(flags.bb).toBe(true);

    // Comparison series
    ctrl.setComparisonSeries('XU100.IS', sampleCandles(5));
    ctrl.setComparisonSeries(null, []);

    // Live candle updates
    const currentLast = ctrl.getCandles()[ctrl.getCandles().length - 1];

    // Same timestamp update (tick inside same candle)
    ctrl.updateLiveCandle({
      ...currentLast,
      close: currentLast.close + 2.5,
      high: Math.max(currentLast.high, currentLast.close + 2.5),
    });
    expect(ctrl.getCandles()[ctrl.getCandles().length - 1].close).toBe(
      currentLast.close + 2.5
    );

    // New timestamp update (new candle opening)
    const newCandle: Candle = {
      time: currentLast.time + 900,
      open: currentLast.close,
      high: currentLast.close + 3,
      low: currentLast.close - 1,
      close: currentLast.close + 2,
      volume: 1200,
    };
    ctrl.updateLiveCandle(newCandle);
    expect(ctrl.getCandles().length).toBe(8);
    expect(ctrl.getCandles()[7].time).toBe(newCandle.time);

    // Stale timestamp update (should be ignored)
    ctrl.updateLiveCandle({
      time: currentLast.time - 5000,
      open: 50,
      high: 55,
      low: 45,
      close: 52,
      volume: 10,
    });
    expect(ctrl.getCandles().length).toBe(8);

    // Coordinate conversions
    expect(ctrl.timeToX(newCandle.time)).toBeDefined();
    expect(ctrl.priceToY(100)).toBeDefined();

    ctrl.destroy();
  });
});

describe('5. Chart controller — Faz 4 (chart types, script visuals, logical time)', () => {
  function make() {
    const mainEl = document.createElement('div');
    const ctrl = new TitanChartController(mainEl);
    ctrl.setHistoryData(sampleCandles(40));
    return ctrl as any;
  }

  it('initial view = last 160 bars + 18 bars of right margin (room for the TitanScript projection)', () => {
    const mainEl = document.createElement('div');
    const ctrl = new TitanChartController(mainEl) as any;
    ctrl.setHistoryData(sampleCandles(400));
    expect(lwcState.range.from).toBe(400 - 1 - 160);
    expect(lwcState.range.to).toBe(400 - 1 + 18);
    ctrl.setHistoryData(sampleCandles(50)); // short history: starts at the first bar
    expect(lwcState.range.from).toBe(-2);
  });

  it('pinchView zooms around the finger centre and drags with the fingers (draw-mode pinch)', () => {
    const ctrl = make();
    lwcState.range = { from: 10, to: 100 };
    ctrl.pinchView(2, 500, 0); // centre logical = 50 (mock x/10); span 90 -> 45, centre keeps its screen position
    expect(lwcState.range.from).toBeCloseTo(30);
    expect(lwcState.range.to).toBeCloseTo(75);

    lwcState.range = { from: 10, to: 100 };
    ctrl.pinchView(1, 500, 80); // pure pan: 80px = 80 / (800/90) = 9 bars to the left of the content
    expect(lwcState.range.from).toBeCloseTo(1);
    expect(lwcState.range.to).toBeCloseTo(91);

    lwcState.range = { from: 10, to: 100 };
    ctrl.pinchView(1000, 500, 0); // absurd spread is clamped (x5)
    expect(lwcState.range.to - lwcState.range.from).toBeCloseTo(18);
    lwcState.range = { from: 10, to: 100 };
    ctrl.pinchView(0, 500, 0); // degenerate -> ignored
    expect(lwcState.range).toEqual({ from: 10, to: 100 });
  });

  it('Renko / Line Break / Range feed derived bricks to the candle series; volume follows the bricks', () => {
    const ctrl = make();
    const raw = ctrl.getCandles();
    ctrl.setChartStyleMode('renko');
    const renko = ctrl.candleSeries._data as Candle[];
    expect(renko.length).toBeGreaterThan(0);
    expect(renko.length).not.toBe(raw.length);
    const times = renko.map((b: any) => b.time);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    expect(new Set(times).size).toBe(times.length);
    expect(ctrl.volumeSeries._data).toHaveLength(ctrl.derivedBars.length);

    ctrl.setChartStyleMode('linebreak');
    expect(ctrl.candleSeries._data.length).toBeLessThan(raw.length);
    ctrl.setChartStyleMode('range');
    expect(ctrl.candleSeries._data.length).toBeGreaterThan(0);

    ctrl.setChartStyleMode('candles');
    expect(ctrl.candleSeries._data).toHaveLength(raw.length);
    expect(ctrl.volumeSeries._data).toHaveLength(raw.length);
  });

  it('live ticks rebuild derived bricks instead of appending raw candles', () => {
    const ctrl = make();
    ctrl.setChartStyleMode('renko');
    const last = ctrl.getCandles().at(-1)!;
    ctrl.updateLiveCandle({ ...last, time: last.time + 900, close: last.close + 500, high: last.close + 500 });
    // setData was used (full rebuild): data must still be strictly increasing
    const times = ctrl.candleSeries._data.map((b: any) => b.time);
    expect([...times].sort((a: number, b: number) => a - b)).toEqual(times);
  });

  it('step / marker line styles configure the line series', () => {
    const ctrl = make();
    ctrl.setChartStyleMode('stepline');
    expect(ctrl.lineSeries.applyOptions).toHaveBeenLastCalledWith(
      expect.objectContaining({ visible: true, lineType: 1, pointMarkersVisible: false })
    );
    ctrl.setChartStyleMode('linemarkers');
    expect(ctrl.lineSeries.applyOptions).toHaveBeenLastCalledWith(
      expect.objectContaining({ visible: true, lineType: 0, pointMarkersVisible: true })
    );
  });

  it('barcolor recolors matching candles and a failed run clears it', () => {
    const ctrl = make();
    const t = ctrl.getCandles()[3].time;
    const base: any = { ok: true, scriptTitle: 't', isStrategy: false, isOverlay: true, executionMs: 0, plots: [], markers: [], hlines: [] };
    ctrl.renderScriptExecution({ ...base, barcolors: [{ time: t, color: '#ff00ff' }] });
    const colored = ctrl.candleSeries._data.find((d: any) => d.time === t);
    expect(colored).toMatchObject({ color: '#ff00ff', borderColor: '#ff00ff', wickColor: '#ff00ff' });
    expect(ctrl.candleSeries._data.filter((d: any) => d.color)).toHaveLength(1);
    ctrl.renderScriptExecution({ ...base, ok: false, error: 'x' });
    expect(ctrl.candleSeries._data.filter((d: any) => d.color)).toHaveLength(0);
  });

  it('plot styles map to the right series: area, stepline, circles(no line), histogram, plotcandle', () => {
    const ctrl = make();
    const times = ctrl.getCandles().slice(0, 3).map((c: Candle) => c.time);
    const data = times.map((time: number, i: number) => ({ time, value: 100 + i }));
    const plot = (id: string, style: string, extra: object = {}) => ({ id, title: id, color: '#0284C7', lineWidth: 2, style, isOverlay: true, data, ...extra });
    const main = ctrl.mainChart;
    ctrl.renderScriptExecution({
      ok: true, scriptTitle: 't', isStrategy: false, isOverlay: true, executionMs: 0, markers: [], hlines: [],
      plots: [plot('a', 'area'), plot('s', 'stepline'), plot('c', 'circles'), plot('x', 'cross'), plot('h', 'histogram'), plot('hid', 'line', { hidden: true })],
      ohlcPlots: [{ id: 'o', title: 'o', kind: 'candle', isOverlay: true, data: times.map((time: number) => ({ time, open: 1, high: 3, low: 0, close: 2, color: '#0f0' })) }],
    });
    const calls = (t: string) => main.addSeries.mock.calls.filter((c: any[]) => c[0] === t);
    expect(calls('Area')).toHaveLength(2); // core area + script area
    const scriptLines = calls('Line').map((c: any[]) => c[1]).slice(-3); // stepline, circles, cross (hidden one skipped)
    expect(scriptLines[0]).toMatchObject({ lineType: 1, lineVisible: true });
    expect(scriptLines[1]).toMatchObject({ lineVisible: false, crosshairMarkerVisible: false });
    expect(scriptLines[2]).toMatchObject({ lineVisible: false });
    expect(calls('Candlestick')).toHaveLength(2); // core + plotcandle
  });

  it('timeToLogical / logicalToTime are inverse and extrapolate past the data', () => {
    const ctrl = make();
    const c = ctrl.getCandles();
    const dt = c[39].time - c[38].time;
    expect(ctrl.timeToLogical(c[10].time)).toBe(10);
    expect(ctrl.timeToLogical(c[39].time + 5 * dt)).toBeCloseTo(44, 6);
    expect(ctrl.timeToLogical(c[0].time - 2 * (c[1].time - c[0].time))).toBeCloseTo(-2, 6);
    expect(ctrl.timeToLogical(c[10].time + dt / 2)).toBeCloseTo(10.5, 6);
    for (const l of [-3, 0, 7.5, 39, 45]) {
      expect(ctrl.timeToLogical(ctrl.logicalToTime(l))).toBeCloseTo(l, 3);
    }
  });

  it('invert scale is applied to the price axis', () => {
    const ctrl = make();
    expect(() => ctrl.setInvertScale(true)).not.toThrow();
  });
});

describe('6. Chart controller — Faz 15 (v5 çoklu pane, ölçekler)', () => {
  function make(hooks: Record<string, unknown> = {}) {
    const mainEl = document.createElement('div');
    const ctrl = new TitanChartController(mainEl, undefined, undefined, undefined, hooks) as any;
    ctrl.setHistoryData(sampleCandles(60));
    return ctrl;
  }
  const paneOf = (ctrl: any, type: string, i = 0) => ctrl.mainChart._seriesList.filter((s: any) => s._type === type)[i]._pane;
  const mkScript = (plots: any[]) => ({
    ok: true, scriptTitle: 'P', isStrategy: false, isOverlay: false, executionMs: 0, markers: [], hlines: [], plots,
  });
  const plot = (ctrl: any, id: string, isOverlay: boolean) => ({
    id, title: id, color: '#0284C7', lineWidth: 2, style: 'line', isOverlay,
    data: ctrl.getCandles().slice(0, 5).map((c: Candle, i: number) => ({ time: c.time, value: 50 + i })),
  });

  it('RSI/MACD/Betik alt panelleri tek grafikte ayrı pane indekslerine gider (alt chart yok)', () => {
    const ctrl = make();
    expect(ctrl.getPaneOrder()).toEqual(['main']);
    ctrl.setQuickIndicators({ rsi: true });
    expect(ctrl.getPaneOrder()).toEqual(['main', 'rsi']);
    expect(paneOf(ctrl, 'Line', 0)).toBe(0); // çekirdek çizgi serisi ana pane'de
    ctrl.setQuickIndicators({ macd: true });
    ctrl.renderScriptExecution(mkScript([plot(ctrl, 'a', false)]));
    expect(ctrl.getPaneOrder()).toEqual(['main', 'rsi', 'macd', 'script']);
    const panes = new Set(ctrl.mainChart._seriesList.map((s: any) => s._pane));
    expect([...panes].sort()).toEqual([0, 1, 2, 3]);
    expect(ctrl.subChart).toBeUndefined();
  });

  it('gösterge kapanınca pane kalkar, sıra tercihi korunur', () => {
    const ctrl = make();
    ctrl.setQuickIndicators({ rsi: true, macd: true });
    ctrl.movePaneBy('macd', -1);
    expect(ctrl.getPaneOrder()).toEqual(['main', 'macd', 'rsi']);
    ctrl.setQuickIndicators({ macd: false });
    expect(ctrl.getPaneOrder()).toEqual(['main', 'rsi']);
    ctrl.setQuickIndicators({ macd: true });
    expect(ctrl.getPaneOrder()).toEqual(['main', 'macd', 'rsi']); // kullanıcının sırası hatırlandı
  });

  it('taşıma pane.moveTo ile v5 indeksine yansır; main taşınamaz', () => {
    const ctrl = make();
    ctrl.setQuickIndicators({ rsi: true, macd: true });
    ctrl.movePaneBy('macd', -1);
    const rsiPane = ctrl.mainChart._seriesList.find((s: any) => s.options().title === 'RSI 14')._pane;
    const macdPane = ctrl.mainChart._seriesList.find((s: any) => s.options().title === 'MACD')._pane;
    expect(macdPane).toBe(1);
    expect(rsiPane).toBe(2);
    ctrl.movePaneBy('main', 1);
    expect(ctrl.getPaneOrder()[0]).toBe('main');
  });

  it('büyüt: seçili pane stretch alır, diğerleri ~0; geri alınca eski stretch', () => {
    const changes = vi.fn();
    const ctrl = make({ onPanesChange: changes });
    ctrl.setQuickIndicators({ rsi: true });
    const main = ctrl.mainChart.panes()[0];
    const rsi = ctrl.mainChart.panes()[1];
    const before = [main.getStretchFactor(), rsi.getStretchFactor()];
    ctrl.toggleMaximize('rsi');
    expect(ctrl.getMaximizedPane()).toBe('rsi');
    expect(rsi.getStretchFactor()).toBeGreaterThan(100);
    expect(main.getStretchFactor()).toBeLessThan(0.01);
    ctrl.toggleMaximize('rsi');
    expect(ctrl.getMaximizedPane()).toBeNull();
    expect([main.getStretchFactor(), rsi.getStretchFactor()]).toEqual(before);
    expect(changes).toHaveBeenCalled();
  });

  it('tek pane varken büyütme yok sayılır', () => {
    const ctrl = make();
    ctrl.toggleMaximize('main');
    expect(ctrl.getMaximizedPane()).toBeNull();
  });

  it('✕ kancayı çağırır (rsi/macd/script); main silinemez', () => {
    const onPaneClose = vi.fn();
    const ctrl = make({ onPaneClose });
    ctrl.closePane('rsi');
    expect(onPaneClose).toHaveBeenCalledWith('rsi');
    ctrl.closePane('main');
    expect(onPaneClose).toHaveBeenCalledTimes(1);
  });

  it('Betik alt paneli gizlenince yalnız o pane kalkar, overlay çizimler kalır; geri açılınca döner', () => {
    const ctrl = make();
    ctrl.renderScriptExecution(mkScript([plot(ctrl, 'ov', true), plot(ctrl, 'sub', false)]));
    expect(ctrl.getPaneOrder()).toEqual(['main', 'script']);
    ctrl.setScriptSubHidden(true);
    expect(ctrl.getPaneOrder()).toEqual(['main']);
    ctrl.setScriptSubHidden(false);
    expect(ctrl.getPaneOrder()).toEqual(['main', 'script']);
  });

  it('sol/sağ/split ölçek: seriler priceScaleId değiştirir, sol eksen yalnız kullanılınca görünür', () => {
    const ctrl = make();
    const chart = ctrl.mainChart;
    ctrl.setQuickIndicators({ macd: true }); // 3 seri
    chart.applyOptions.mockClear();
    ctrl.setPaneScaleSide('macd', 'split');
    const macd = ctrl.paneSeries.get('macd');
    expect(macd.map((s: any) => s.options().priceScaleId)).toEqual(['right', 'left', 'left']);
    expect(chart.applyOptions).toHaveBeenLastCalledWith({ leftPriceScale: { visible: true } });
    ctrl.setPaneScaleSide('macd', 'right');
    expect(macd.every((s: any) => s.options().priceScaleId === 'right')).toBe(true);
    expect(chart.applyOptions).toHaveBeenLastCalledWith({ leftPriceScale: { visible: false } });
    ctrl.setPaneScaleSide('main', 'left');
    expect(ctrl.candleSeries.options().priceScaleId).toBe('left');
    expect(ctrl.getPaneScaleSide('main')).toBe('left');
  });

  it('yeni eklenen ana pane serileri seçili tarafı izler (Betik overlay sol ölçekte)', () => {
    const ctrl = make();
    ctrl.setPaneScaleSide('main', 'left');
    ctrl.renderScriptExecution(mkScript([plot(ctrl, 'ov', true)]));
    const added = ctrl.mainChart._seriesList.filter((s: any) => s.options().title === 'ov');
    expect(added[0].options().priceScaleId).toBe('left');
  });

  it('çoklu ölçek: karşılaştırma serisi aynı / sol / kendi ölçeğine geçer', () => {
    const ctrl = make();
    ctrl.setComparisonSeries('AAPL', sampleCandles(30));
    const cmp = ctrl.compareSeries;
    expect(cmp.options().priceScaleId).toBe('right');
    ctrl.setCompareScale('left');
    expect(cmp.options().priceScaleId).toBe('left');
    expect(ctrl.mainChart.applyOptions).toHaveBeenLastCalledWith({ leftPriceScale: { visible: true } });
    ctrl.setCompareScale('own');
    expect(cmp.options().priceScaleId).toBe('cmp-own');
    expect(ctrl.getCompareScale()).toBe('own');
  });

  it('indeksli (100\'e) ölçek IndexedTo100 moduna geçer, normale dönülür', () => {
    const ctrl = make();
    ctrl.setPriceScaleKind('indexed');
    expect(ctrl.getPriceScaleKind()).toBe('indexed');
    expect(mockPriceScale('right').applyOptions).toHaveBeenCalledWith({ mode: 3, invertScale: false });
    ctrl.setPriceScaleKind('normal');
    expect(mockPriceScale('right').applyOptions).toHaveBeenLastCalledWith({ mode: 0, invertScale: false });
  });

  it('ölçek kilidi: oran alınır, otomatik ölçek kapanır; bar aralığı değişince fiyat aralığı orantılı ayarlanır', () => {
    const ctrl = make();
    const ps = mockPriceScale('right');
    lwcState.range = { from: 0, to: 90 }; // 900px / 90 bar = 10 px/bar
    ctrl.setScaleLocked(true);
    expect(ctrl.isScaleLocked()).toBe(true);
    expect(ctrl.getLockRatio()).toEqual({ b0: 10, span0: 100 });
    expect(ps.setAutoScale).toHaveBeenCalledWith(false);
    lwcState.range = { from: 0, to: 45 }; // yakınlaştı: 20 px/bar
    lwcState.rangeCallbacks[0](lwcState.range);
    expect(ps.setVisibleRange).toHaveBeenLastCalledWith({ from: 125, to: 175 });
    ctrl.setScaleLocked(false);
    expect(ps.setAutoScale).toHaveBeenLastCalledWith(true);
    expect(ctrl.getLockRatio()).toBeNull();
    ps.setVisibleRange.mockClear();
    lwcState.rangeCallbacks[0]({ from: 0, to: 30 });
    expect(ps.setVisibleRange).not.toHaveBeenCalled();
  });

  it('fitContent kilidi açar ve otomatik ölçeğe döner', () => {
    const ctrl = make();
    ctrl.setScaleLocked(true);
    ctrl.fitContent();
    expect(ctrl.isScaleLocked()).toBe(false);
  });
});

describe('7. Chart controller — Faz 16 (grafik tipleri)', () => {
  function make(n = 60) {
    const mainEl = document.createElement('div');
    const ctrl = new TitanChartController(mainEl) as any;
    ctrl.setHistoryData(sampleCandles(n));
    return ctrl;
  }

  it('özel seri tipleri (Volume candles, HLC, Columns, High-low) özel seriyle çizilir, ana mum gizlenir', () => {
    const ctrl = make();
    for (const m of ['volcandles', 'hlcarea', 'columns', 'highlow'] as const) {
      ctrl.setChartStyleMode(m);
      const custom = ctrl.customSeries;
      expect(custom._type).toBe('Custom');
      expect(custom._data).toHaveLength(60);
      expect(custom._data[1].prevClose).toBe(ctrl.rawCandles[0].close);
      expect(ctrl.candleSeries.options().visible).toBe(false);
    }
    ctrl.setChartStyleMode('candles');
    expect(ctrl.customSeries).toBeNull();
    expect(ctrl.candleSeries.options().visible).toBe(true);
  });

  it('Kagi ve P&F: türetilmiş barlar + çizim bilgisi; Betik ekseni türetilmiş barlar', () => {
    const ctrl = make(200);
    ctrl.setChartStyleMode('kagi');
    expect(ctrl.derivedBars.length).toBeGreaterThan(0);
    expect(ctrl.customSeries._data[0].kagi).toBeTruthy();
    ctrl.setChartStyleMode('pnf');
    expect(ctrl.customSeries._data.every((d: any) => d.pnf && (d.pnf.kind === 'X' || d.pnf.kind === 'O'))).toBe(true);
    expect(ctrl.volumeSeries._data.map((v: any) => v.time)).toEqual(ctrl.derivedBars.map((b: any) => b.time)); // Varsayılan: hacim türetilmiş çubukta
  });

  it('stil parametreleri (sabit Renko kutusu) tuğlaları değiştirir', () => {
    const ctrl = make(200);
    ctrl.setChartStyleMode('renko');
    const atrBricks = ctrl.derivedBars.length;
    ctrl.setStyleParams({ ...ctrl.styleParams, renko: { mode: 'fixed', atrLen: 14, box: 0.05 } });
    expect(ctrl.derivedBars.length).toBeGreaterThan(atrBricks);
  });

  it('Seans VP primitive bağlanır; TPO/Footprint hayalet ana seri + son fiyat çizgisi; geçişte ayrılır', () => {
    const ctrl = make();
    const cs = ctrl.candleSeries;
    ctrl.setChartStyleMode('svp');
    expect(cs._primitives.some((p: any) => p.constructor.name === 'SessionProfiles')).toBe(true);
    expect(cs.options().visible).toBe(true);
    ctrl.setChartStyleMode('tpo');
    expect(cs._primitives.some((p: any) => p.constructor.name === 'SessionProfiles')).toBe(false);
    expect(cs._primitives.some((p: any) => p.constructor.name === 'TpoLayer')).toBe(true);
    expect(cs.options().upColor).toBe('rgba(0, 0, 0, 0)');
    expect(cs.options().lastValueVisible).toBe(false);
    expect(cs.createPriceLine).toHaveBeenCalled();
    expect(ctrl.tpoRow).toBeGreaterThan(0);
    ctrl.setChartStyleMode('candles');
    expect(cs._primitives.some((p: any) => p.constructor.name === 'TpoLayer')).toBe(false);
    expect(cs.removePriceLine).toHaveBeenCalled();
    expect(cs.options().lastValueVisible).toBe(true);
  });

  it('Footprint: bar aralığı genişler, çıkınca eski aralık geri gelir; veri katmana iletilir', () => {
    const ctrl = make();
    const ts = ctrl.mainChart.timeScale();
    ctrl.setChartStyleMode('footprint');
    expect(ctrl.savedBarSpacing).toBe(10);
    const map = new Map([[ctrl.rawCandles[5].time, { time: ctrl.rawCandles[5].time, rows: [[100, 1, 2]], delta: -1, total: 3, poc: 100, complete: true }]]);
    ctrl.setFootprintData(map, 0.5);
    expect(ctrl.footprintRow).toBe(0.5);
    expect(ctrl.profileLayer.constructor.name).toBe('FootprintLayer');
    ctrl.setChartStyleMode('candles');
    expect(ctrl.savedBarSpacing).toBeNull();
    expect(ts).toBeTruthy();
  });

  it('VPVR artık görünür aralık primitive; bayrak kapanınca ayrılır', () => {
    const ctrl = make();
    expect(ctrl.vrvp).toBeTruthy();
    ctrl.setQuickIndicators({ vpvr: false });
    expect(ctrl.vrvp).toBeNull();
    ctrl.setQuickIndicators({ vpvr: true });
    expect(ctrl.candleSeries._primitives).toContain(ctrl.vrvp);
  });

  it('canlı mum: özel seri + profil katmanı güncellenir', () => {
    const ctrl = make();
    ctrl.setChartStyleMode('hlcarea');
    const last = ctrl.rawCandles[ctrl.rawCandles.length - 1];
    ctrl.updateLiveCandle({ ...last, time: last.time + 900, close: last.close + 1 });
    expect(ctrl.customSeries.update).toHaveBeenCalled();
  });

  it('visibleBarTimes görünür mantıksal aralıktaki bar zamanları', () => {
    const ctrl = make();
    lwcState.range = { from: 50, to: 55 };
    expect(ctrl.visibleBarTimes()).toEqual(ctrl.rawCandles.slice(50, 56).map((c: any) => c.time));
  });

  it('Faz 26: setComparisonItems çoklu karşılaştırma serisi ve setCorporateEvents olay işaretleri', () => {
    const ctrl = make();
    const bars = ctrl.rawCandles.slice(0, 10);
    ctrl.setComparisonItems([
      { symbol: 'XU100.IS', color: '#FF9800', scaleMode: 'same', visible: true, candles: bars },
      { symbol: 'USDTRY=X', color: '#0284C7', scaleMode: 'left', visible: true, candles: bars },
      { symbol: 'GC=F', color: '#E91E63', scaleMode: 'own', visible: true, candles: bars },
    ]);
    expect(ctrl.compareSeries).toBeTruthy();
    expect(ctrl.extraCompareSeries).toHaveLength(2);

    ctrl.setCorporateEvents(
      {
        symbol: 'THYAO.IS',
        supported: true,
        dividends: [{ time: bars[2].time, amount: 6.85 }],
        splits: [{ time: bars[4].time, numerator: 2, denominator: 1, ratio: '2:1' }],
        earnings: [{ time: bars[6].time, actual: 12, estimate: 10 }],
      },
      'TRY',
      { dividends: true, splits: true, earnings: true }
    );
    ctrl.setEventOptions({ splits: false });
    ctrl.setComparisonItems([]);
    expect(ctrl.compareSeries).toBeNull();
    expect(ctrl.extraCompareSeries).toHaveLength(0);
  });
});
