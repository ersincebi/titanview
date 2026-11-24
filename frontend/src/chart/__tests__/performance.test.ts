import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import {
  calcSMA,
  calcEMA,
  calcRSI,
  calcMACD,
  calcBollingerBands,
  calcSuperTrend,
  calcLatestSMA,
  calcLatestEMA,
  calcLatestRSI,
  calcLatestMACD,
  calcLatestBollinger,
} from '../../indicators/taEngine';
import { TitanChartController } from '../ChartController';
import { BarReplay } from '../BarReplay';
import type { Candle } from '../../types/market';

// Setup Mock Lightweight Charts (v5) and minimal DOM for Node/Vitest
vi.mock('lightweight-charts', async () => (await import('./lwcMock')).lwcModule());

function createMockElement(tag = 'div'): any {
  const children: any[] = [];
  const el: any = {
    tagName: tag.toUpperCase(),
    style: {},
    dataset: {},
    innerHTML: '',
    title: '',
    className: '',
    appendChild: vi.fn((child: any) => {
      child.parentElement = el;
      children.push(child);
      return child;
    }),
    removeChild: vi.fn((child: any) => {
      const idx = children.indexOf(child);
      if (idx >= 0) children.splice(idx, 1);
      child.parentElement = null;
      return child;
    }),
    remove: vi.fn(() => {
      if (el.parentElement) {
        el.parentElement.removeChild(el);
      }
    }),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    children,
  };
  return el;
}

beforeAll(() => {
  if (typeof (globalThis as any).ResizeObserver === 'undefined') {
    (globalThis as any).ResizeObserver = class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    };
  }
  if (typeof (globalThis as any).document === 'undefined') {
    (globalThis as any).document = {
      createElement: (tag: string) => createMockElement(tag),
      body: createMockElement('body'),
    };
  }
  if (typeof (globalThis as any).window === 'undefined') {
    (globalThis as any).window = {
      setInterval: vi.fn((cb: Function) => 1),
      clearInterval: vi.fn(),
    };
  }
});

// Generates N synthetic candles
function createBenchCandles(count: number): Candle[] {
  const candles: Candle[] = new Array(count);
  let price = 100;
  const baseTime = 1600000000;
  for (let i = 0; i < count; i++) {
    const open = price;
    const high = open + 1.5;
    const low = open - 1.2;
    const close = open + 0.3;
    const volume = 1000 + (i % 100) * 10;
    candles[i] = {
      time: baseTime + i * 900,
      open,
      high,
      low,
      close,
      volume,
    };
    price = close;
  }
  return candles;
}

describe('Stage 8 — 60 FPS Grafik Akıcılığı & Bellek Sızıntısı (Performance & Leak) Denetimi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('50.000 mumluk büyük veri setinde TA Motoru hesaplama hızını ve 60 FPS bütçesini doğrulamalıdır', () => {
    const candles = createBenchCandles(50000);
    expect(candles.length).toBe(50000);
    const closePrices = candles.map((c) => c.close);

    const tStart = performance.now();
    const sma20 = calcSMA(closePrices, 20);
    const ema50 = calcEMA(closePrices, 50);
    const rsi14 = calcRSI(closePrices, 14);
    const macd = calcMACD(closePrices, 12, 26, 9);
    const bb = calcBollingerBands(closePrices, 20, 2);
    const st = calcSuperTrend(candles, 10, 3.0);
    const elapsed = performance.now() - tStart;

    expect(sma20.length).toBe(50000);
    expect(ema50.length).toBe(50000);
    expect(rsi14.length).toBe(50000);
    expect(macd.macdLine.length).toBe(50000);
    expect(bb.upper.length).toBe(50000);
    expect(st.supertrend.length).toBe(50000);

    // 60 FPS (16.6ms frame) için 50.000 mumluk tam indikatör hesaplaması < 150ms olmalıdır
    expect(elapsed).toBeLessThan(150);
  });

  it('Canlı WebSocket güncellemelerinde anlık O(1) rekalkülasyon 60 FPS (16.6ms) frame sınırını asla aşmamalıdır', () => {
    const candles = createBenchCandles(100);
    const ticks = 100;
    let liveCandle: Candle = { ...candles[candles.length - 1] };

    const tStart = performance.now();
    for (let i = 0; i < ticks; i++) {
      liveCandle.close += (i % 2 === 0 ? 0.05 : -0.05);
      liveCandle.high = Math.max(liveCandle.high, liveCandle.close);
      liveCandle.low = Math.min(liveCandle.low, liveCandle.close);

      // Perform all active live single-bar recalculations
      calcLatestSMA(candles, 20);
      calcLatestEMA(100.0, liveCandle.close, 21);
      calcLatestRSI(candles, 14);
      calcLatestMACD(candles, 12, 26, 9);
      calcLatestBollinger(candles, 20, 2);
    }
    const totalElapsed = performance.now() - tStart;
    const avgPerTick = totalElapsed / ticks;

    // Her bir tick güncellemesi < 1.0 ms sürmeli (60 FPS için 16.6 ms frame bütçesinin çok altında)
    expect(avgPerTick).toBeLessThan(1.0);
  });

  it('ChartController destroy edildiğinde serileri, dizileri ve callback referanslarını bellek sızıntısız temizlemelidir', () => {
    const mainEl = createMockElement('div');

    const controller = new TitanChartController(mainEl);
    const candles = createBenchCandles(500);
    controller.setHistoryData(candles);

    // Set callbacks
    const olderSpy = vi.fn();
    controller.setOnLoadOlderHistory(olderSpy);

    expect(controller.getCandles().length).toBe(500);

    // Destroy
    expect(() => controller.destroy()).not.toThrow();

    // Verify state after destruction
    expect(controller.getCandles().length).toBe(0);

    // Repeated destroy should be safe (idempotent)
    expect(() => controller.destroy()).not.toThrow();
  });

  it('BarReplay 10.000 barlık geçmişte hızlı ileri/geri sarıldığında stabil çalışmalıdır', () => {
    const candles = createBenchCandles(10000);
    const onStep = vi.fn();
    const replay = new BarReplay({ onStep });

    // Start replay at index 5000
    const initialCut = replay.start(candles, 5000);
    expect(replay.isActive()).toBe(true);
    expect(initialCut.length).toBe(5000);

    // Step forward 50 bars
    for (let i = 0; i < 50; i++) {
      replay.step();
    }
    expect(onStep).toHaveBeenCalledTimes(50);
    expect(replay.getCurrentCandles().length).toBe(5050);

    // Stop and restore full history
    replay.stop();
    expect(replay.isActive()).toBe(false);
  });

  describe('Faz 8 — canlı tick ve çizim maliyeti', () => {
    const mk = () => {
      const c = new TitanChartController(createMockElement('div'));
      const bars = createBenchCandles(400);
      c.setHistoryData(bars);
      const series = (c as any).mainChart._seriesList as any[];
      return { c, bars, series };
    };

    it('gösterge kapalıyken tick, göstergeleri yeniden kurmaz (removeSeries/resize yok)', () => {
      const { c, bars } = mk();
      const chart = (c as any).mainChart;
      chart.removeSeries.mockClear();
      chart.applyOptions.mockClear();
      for (let i = 0; i < 50; i++) c.updateLiveCandle({ ...bars[bars.length - 1], close: bars[bars.length - 1].close + i * 0.01 });
      expect(chart.removeSeries).not.toHaveBeenCalled();
      expect(chart.applyOptions).not.toHaveBeenCalled();
      c.destroy();
    });

    it('yalnız aktif stilin serisi doldurulur; stil değişince yeni seri dolar, eskisi boşalır', () => {
      const { c } = mk();
      const by = (t: string) => ((c as any).mainChart._seriesList as any[]).filter((s) => s._type === t);
      const lineS = by('Line')[0];
      const barS = by('Bar')[0];
      const areaS = by('Area')[0];
      expect(lineS._data.length).toBe(0);
      expect(barS._data.length).toBe(0);
      expect(areaS._data.length).toBe(0);
      c.setChartStyleMode('line');
      expect(lineS._data.length).toBe(400);
      c.setChartStyleMode('area');
      expect(areaS._data.length).toBe(400);
      expect(lineS._data.length).toBe(0);
      c.destroy();
    });

    it('aynı bar içi tick fırtınasında göstergeler ≤ birkaç kez hesaplanır, yeni barda hemen', () => {
      vi.useFakeTimers();
      try {
        const { c, bars } = mk();
        c.setQuickIndicators({ ema9: true, ema21: true } as any);
        const spy = vi.spyOn(c as any, 'updateLiveIndicators');
        const last = bars[bars.length - 1];
        for (let i = 0; i < 100; i++) c.updateLiveCandle({ ...last, close: last.close + i * 0.01 });
        expect(spy.mock.calls.length).toBeLessThanOrEqual(2);
        vi.advanceTimersByTime(300);
        expect(spy.mock.calls.length).toBeLessThanOrEqual(3);
        const before = spy.mock.calls.length;
        c.updateLiveCandle({ ...last, time: last.time + 900, close: last.close });
        expect(spy.mock.calls.length).toBe(before + 1);
        c.destroy();
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
