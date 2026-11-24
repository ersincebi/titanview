import { describe, expect, it, vi } from 'vitest';
import {
  drawingScopeFor,
  propagateCrosshair,
  propagateDateRange,
  propagateDrawings,
  propagateTimeClick,
  type SyncChartLike,
  type SyncOverlayLike,
} from '../chartSync';
import { DEFAULT_SYNC, type LayoutSyncOptions } from '../layout';
import { TabSyncBus, type BroadcastLike } from '../tabSync';
import type { DrawingObject } from '../../types/market';

function createMockChannelPair(): [BroadcastLike, BroadcastLike] {
  const chA: BroadcastLike = {
    onmessage: null,
    postMessage: (data) => chB.onmessage?.({ data } as MessageEvent<unknown>),
    close: vi.fn(),
  };
  const chB: BroadcastLike = {
    onmessage: null,
    postMessage: (data) => chA.onmessage?.({ data } as MessageEvent<unknown>),
    close: vi.fn(),
  };
  return [chA, chB];
}

function mockChart(): SyncChartLike {
  return {
    setExternalCrosshair: vi.fn(),
    alignToTime: vi.fn(() => true),
    setVisibleTimeRange: vi.fn(() => true),
  };
}

describe('chartSync + tabSync (Faz 25)', () => {
  it('computes drawing persistence scope for global, layout, and off (local slot)', () => {
    expect(drawingScopeFor('global', 'lay_1', 2)).toEqual({ layoutId: '', scope: 'global' });
    expect(drawingScopeFor('layout', 'lay_1', 2)).toEqual({ layoutId: 'lay_1', scope: 'layout' });
    expect(drawingScopeFor('off', 'lay_1', 2)).toEqual({ layoutId: 'lay_1#slot:2', scope: 'local' });
  });

  it('propagates crosshair, time click, and date range to peer charts and cross-tab bus', () => {
    const [chA, chB] = createMockChannelPair();
    const busA = new TabSyncBus(() => chA, 'tab_a');
    const busB = new TabSyncBus(() => chB, 'tab_b');
    const received: unknown[] = [];
    busB.subscribe((m) => received.push(m));

    expect(busA.peerCount()).toBe(1);
    expect(busB.peerCount()).toBe(1);

    const charts = [mockChart(), mockChart(), mockChart()];
    const getChart = (i: number) => charts[i];
    const allOn: LayoutSyncOptions = { ...DEFAULT_SYNC, crosshair: true, time: true, dateRange: true, crossTab: true };

    propagateCrosshair(0, 1700001000, 3, allOn, getChart, busA);
    expect(charts[0].setExternalCrosshair).not.toHaveBeenCalled();
    expect(charts[1].setExternalCrosshair).toHaveBeenCalledWith(1700001000);
    expect(charts[2].setExternalCrosshair).toHaveBeenCalledWith(1700001000);

    propagateTimeClick(1, 1700005000, 3, allOn, getChart, busA);
    expect(charts[0].alignToTime).toHaveBeenCalledWith(1700005000);
    expect(charts[1].alignToTime).not.toHaveBeenCalled();
    expect(charts[2].alignToTime).toHaveBeenCalledWith(1700005000);

    propagateDateRange(2, { from: 1700000000, to: 1700050000 }, 3, allOn, getChart, busA);
    expect(charts[0].setVisibleTimeRange).toHaveBeenCalledWith(1700000000, 1700050000);
    expect(charts[1].setVisibleTimeRange).toHaveBeenCalledWith(1700000000, 1700050000);
    expect(charts[2].setVisibleTimeRange).not.toHaveBeenCalled();

    expect(received.map((m) => (m as { type: string }).type)).toEqual(['crosshair', 'time', 'dateRange']);

    // Off toggles do not propagate
    const allOff: LayoutSyncOptions = { ...DEFAULT_SYNC, crosshair: false, time: false, dateRange: false, crossTab: false };
    const c2 = [mockChart(), mockChart()];
    propagateCrosshair(0, 100, 2, allOff, (i) => c2[i]);
    propagateTimeClick(0, 100, 2, allOff, (i) => c2[i]);
    propagateDateRange(0, { from: 1, to: 10 }, 2, allOff, (i) => c2[i]);
    expect(c2[1].setExternalCrosshair).not.toHaveBeenCalled();
    expect(c2[1].alignToTime).not.toHaveBeenCalled();
    expect(c2[1].setVisibleTimeRange).not.toHaveBeenCalled();

    busA.destroy();
    expect(busB.peerCount()).toBe(0);
    busB.destroy();
  });

  it('propagates drawings only to peer charts displaying the same symbol', () => {
    const syms = ['BTCUSDT', 'ETHUSDT', 'BTCUSDT'];
    const ovs: SyncOverlayLike[] = [
      { setDrawings: vi.fn(), render: vi.fn() },
      { setDrawings: vi.fn(), render: vi.fn() },
      { setDrawings: vi.fn(), render: vi.fn() },
    ];
    const sample: DrawingObject[] = [
      { id: 'd1', symbol: 'BTCUSDT', timeframe: '15m', toolType: 'hline', points: [{ time: 100, price: 65000 }], color: '#0284C7' },
    ];
    propagateDrawings(0, 'BTCUSDT', sample, 3, { ...DEFAULT_SYNC, drawings: 'layout' }, (i) => syms[i], (i) => ovs[i], 'lay_1');
    expect(ovs[0].setDrawings).not.toHaveBeenCalled();
    expect(ovs[1].setDrawings).not.toHaveBeenCalled(); // different symbol
    expect(ovs[2].setDrawings).toHaveBeenCalledTimes(1);
    expect(ovs[2].render).toHaveBeenCalledTimes(1);
  });
});
