import { vi } from 'vitest';

/** lightweight-charts v5 için paylaşılan test sahtesi (addSeries + pane + eklentiler). */
export const lwcState = {
  rangeCallbacks: [] as Array<(range: unknown) => void>,
  crosshairCallbacks: [] as Array<(param: unknown) => void>,
  clickCallbacks: [] as Array<(param: unknown) => void>,
  range: { from: 10, to: 100 } as { from: number; to: number },
  timeRange: { from: 1700000000, to: 1700090000 } as { from: number; to: number },
};

export function resetLwcState(): void {
  lwcState.rangeCallbacks = [];
  lwcState.crosshairCallbacks = [];
  lwcState.clickCallbacks = [];
  lwcState.range = { from: 10, to: 100 };
  lwcState.timeRange = { from: 1700000000, to: 1700090000 };
}

type AnyFn = (...a: any[]) => any;

function createMockSeries(type: string, chart: any, opts: any, paneIndex: number) {
  const dataStore: any[] = [];
  let options = { ...opts };
  const s: any = {
    _type: type,
    _data: dataStore,
    _pane: paneIndex,
    setData: vi.fn((data: any[]) => {
      dataStore.length = 0;
      dataStore.push(...data);
    }),
    update: vi.fn((item: any) => {
      dataStore.push(item);
    }),
    applyOptions: vi.fn((o: any) => {
      options = { ...options, ...o };
    }),
    options: vi.fn(() => options),
    priceScale: vi.fn(() => ({ applyOptions: vi.fn() })),
    createPriceLine: vi.fn((o: any) => ({ options: o, applyOptions: vi.fn() })),
    removePriceLine: vi.fn(),
    attachPrimitive: vi.fn((p: any) => s._primitives.push(p)),
    detachPrimitive: vi.fn((p: any) => {
      const i = s._primitives.indexOf(p);
      if (i >= 0) s._primitives.splice(i, 1);
    }),
    _primitives: [] as any[],
    priceToCoordinate: vi.fn(() => 150),
    coordinateToPrice: vi.fn(() => 292.5),
    getPane: vi.fn(() => chart._pane(s._pane)),
  };
  return s;
}

export function createMockChartApi() {
  const seriesList: any[] = [];
  const panes = new Map<number, any>();
  const chart: any = {
    _seriesList: seriesList,
    _pane(i: number) {
      let p = panes.get(i);
      if (!p) {
        let stretch = 1;
        p = {
          _index: i,
          paneIndex: vi.fn(() => p._index),
          moveTo: vi.fn((n: number) => {
            // v5 gibi: pane listeden çıkar, n'e sok, diğerleri kayar; seriler pane nesnesini izler
            const list = [...panes.values()].sort((x, y) => x._index - y._index);
            const from = list.indexOf(p);
            list.splice(from, 1);
            list.splice(n, 0, p);
            const idOf = new Map<any, number>();
            for (const s of seriesList) idOf.set(s, panes.get(s._pane) === undefined ? -1 : list.indexOf(panes.get(s._pane)));
            list.forEach((pp, k) => (pp._index = k));
            panes.clear();
            list.forEach((pp, k) => panes.set(k, pp));
            for (const s of seriesList) s._pane = idOf.get(s) as number;
          }),
          setStretchFactor: vi.fn((v: number) => {
            stretch = v;
          }),
          getStretchFactor: vi.fn(() => stretch),
          getHTMLElement: vi.fn(() => null),
          getHeight: vi.fn(() => 200),
        };
        panes.set(i, p);
      }
      return p;
    },
    applyOptions: vi.fn(),
    resize: vi.fn(),
    remove: vi.fn(),
    addSeries: vi.fn((def: string, opts: any = {}, paneIndex = 0) => {
      const s = createMockSeries(def, chart, opts, paneIndex);
      chart._pane(paneIndex);
      seriesList.push(s);
      return s;
    }),
    addCustomSeries: vi.fn((view: any, opts: any = {}, paneIndex = 0) => {
      const s = createMockSeries('Custom', chart, opts, paneIndex);
      s._view = view;
      chart._pane(paneIndex);
      seriesList.push(s);
      return s;
    }),
    removeSeries: vi.fn((s: any) => {
      const idx = seriesList.indexOf(s);
      if (idx >= 0) seriesList.splice(idx, 1);
    }),
    panes: vi.fn(() => [...panes.values()].sort((a, b) => a._index - b._index)),
    paneSize: vi.fn(() => ({ width: 800, height: 400 })),
    timeScale: vi.fn(() => ({
      fitContent: vi.fn(),
      applyOptions: vi.fn(),
      getVisibleLogicalRange: vi.fn(() => lwcState.range),
      setVisibleLogicalRange: vi.fn((r: any) => {
        lwcState.range = r;
      }),
      getVisibleRange: vi.fn(() => lwcState.timeRange),
      setVisibleRange: vi.fn((r: any) => {
        if (r && typeof r.from === 'number' && typeof r.to === 'number') lwcState.timeRange = r;
      }),
      subscribeVisibleLogicalRangeChange: vi.fn((cb: any) => {
        lwcState.rangeCallbacks.push(cb);
      }),
      timeToCoordinate: vi.fn(() => 120),
      coordinateToTime: vi.fn(() => 1731200000),
      logicalToCoordinate: vi.fn((l: number) => l * 10),
      coordinateToLogical: vi.fn((x: number) => x / 10),
      height: vi.fn(() => 26),
      width: vi.fn(() => 900),
      options: vi.fn(() => ({ barSpacing: 10 })),
    })),
    priceScale: vi.fn((id: string) => priceScale(id)),
    subscribeCrosshairMove: vi.fn((cb: any) => {
      lwcState.crosshairCallbacks.push(cb);
    }),
    subscribeClick: vi.fn((cb: any) => {
      lwcState.clickCallbacks.push(cb);
    }),
    setCrosshairPosition: vi.fn(),
    clearCrosshairPosition: vi.fn(),
    takeScreenshot: vi.fn(),
  };
  return chart;
}

const scales = new Map<string, any>();
function priceScale(id: string) {
  let s = scales.get(id);
  if (!s) {
    s = {
      applyOptions: vi.fn(),
      width: vi.fn(() => 50),
      getVisibleRange: vi.fn(() => ({ from: 100, to: 200 })),
      setVisibleRange: vi.fn(),
      setAutoScale: vi.fn(),
    };
    scales.set(id, s);
  }
  return s;
}
export function mockPriceScale(id: string) {
  return priceScale(id);
}
export function resetScales(): void {
  scales.clear();
}

export function lwcModule(): Record<string, unknown> {
  const f: AnyFn = vi.fn;
  return {
    createChart: f(() => createMockChartApi()),
    createSeriesMarkers: f(() => ({ setMarkers: vi.fn(), detach: vi.fn() })),
    createTextWatermark: f(() => ({ applyOptions: vi.fn(), detach: vi.fn() })),
    ColorType: { Solid: 'solid', VerticalGradient: 'gradient' },
    CrosshairMode: { Normal: 0, Magnet: 1 },
    PriceScaleMode: { Normal: 0, Logarithmic: 1, Percentage: 2, IndexedTo100: 3 },
    LineType: { Simple: 0, WithSteps: 1 },
    CandlestickSeries: 'Candlestick',
    BarSeries: 'Bar',
    LineSeries: 'Line',
    AreaSeries: 'Area',
    BaselineSeries: 'Baseline',
    HistogramSeries: 'Histogram',
    customSeriesDefaultOptions: { color: '#2196f3' },
  };
}
