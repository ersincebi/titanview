import { beforeEach, describe, expect, it, vi } from 'vitest';
import { lwcModule, lwcState, resetLwcState } from './lwcMock';

vi.mock('lightweight-charts', () => lwcModule());

import { TitanChartController } from '../ChartController';
import type { Candle } from '../../types/market';

function makeCandles(n: number, step = 900): Candle[] {
  return Array.from({ length: n }, (_, i) => ({
    time: 1700000000 + i * step,
    open: 100 + i,
    high: 102 + i,
    low: 99 + i,
    close: 101 + i,
    volume: 1000,
  }));
}

function fakeHost(): HTMLElement {
  return {
    clientWidth: 800,
    clientHeight: 400,
    parentElement: null,
    getBoundingClientRect: () => ({ top: 0, left: 0, width: 800, height: 400 }),
  } as unknown as HTMLElement;
}

describe('TitanChartController Faz 25 sync & seconds display', () => {
  beforeEach(() => {
    resetLwcState();
  });

  it('enables secondsVisible on seconds intervals and disables on minute+ intervals', () => {
    const ctrl = new TitanChartController(fakeHost());
    const chart = (ctrl as unknown as { mainChart: { applyOptions: ReturnType<typeof vi.fn> } }).mainChart;
    chart.applyOptions.mockClear();

    ctrl.setIntervalDisplay('5s');
    expect(chart.applyOptions).toHaveBeenCalledWith(expect.objectContaining({ timeScale: { secondsVisible: true } }));

    chart.applyOptions.mockClear();
    ctrl.setIntervalDisplay('15m');
    expect(chart.applyOptions).toHaveBeenCalledWith(expect.objectContaining({ timeScale: { secondsVisible: false } }));
    ctrl.destroy();
  });

  it('supports external crosshair, time alignment, visible time range sync and emits hooks', () => {
    const onCrosshairTime = vi.fn();
    const onTimeClick = vi.fn();
    const onVisibleTimeRange = vi.fn();
    const ctrl = new TitanChartController(fakeHost(), undefined, undefined, undefined, {
      onCrosshairTime,
      onTimeClick,
      onVisibleTimeRange,
    });
    const data = makeCandles(50, 900);
    ctrl.setHistoryData(data);

    // Trigger crosshair move -> emits hook
    lwcState.crosshairCallbacks[0]({ time: data[10].time });
    expect(onCrosshairTime).toHaveBeenCalledWith(data[10].time);

    // Trigger bar click -> emits onTimeClick
    lwcState.clickCallbacks[0]({ time: data[20].time });
    expect(onTimeClick).toHaveBeenCalledWith(data[20].time);

    // External crosshair sets position on nearest bar without bouncing
    const chart = (ctrl as unknown as { mainChart: { setCrosshairPosition: ReturnType<typeof vi.fn>; clearCrosshairPosition: ReturnType<typeof vi.fn> } }).mainChart;
    ctrl.setExternalCrosshair(data[15].time + 120);
    expect(chart.setCrosshairPosition).toHaveBeenCalledWith(data[15].close, data[15].time, expect.anything());
    ctrl.setExternalCrosshair(null);
    expect(chart.clearCrosshairPosition).toHaveBeenCalled();

    // Time alignment preserves span and centers on timestamp
    expect(ctrl.alignToTime(data[25].time)).toBe(true);

    // Visible time range getter & setter (clamped to available bars)
    expect(ctrl.getVisibleTimeRange()).toEqual(lwcState.timeRange);
    expect(ctrl.setVisibleTimeRange(data[5].time, data[30].time)).toBe(true);
    expect(ctrl.setVisibleTimeRange(data[30].time, data[5].time)).toBe(false);
    ctrl.destroy();
  });
});
