// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { Candle } from '../../../types/market';
import { DrawingManager } from '../DrawingManager';

const candles: Candle[] = Array.from({ length: 30 }, (_, i) => ({
  time: 1000 + i * 100,
  open: 100 + i,
  high: 105 + i,
  low: 95 + i,
  close: 102 + i,
  volume: 100,
}));
const mapper = {
  timeToX: (t: number) => (t - 1000) / 10,
  xToTime: (x: number) => Math.round(x * 10 + 1000),
  priceToY: (p: number) => 600 - p * 2,
  yToPrice: (y: number) => (600 - y) / 2,
  getCandles: () => candles,
};

function setup() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  document.body.appendChild(svg);
  const manager = new DrawingManager({ svg, mapper, autoPersist: false });
  return { svg, manager };
}

function touch(target: EventTarget, type: string, x: number, y: number) {
  const ev = new Event(type, { bubbles: true, cancelable: true });
  const t = { clientX: x, clientY: y };
  Object.defineProperty(ev, 'touches', { value: type === 'touchend' ? [] : [t] });
  Object.defineProperty(ev, 'changedTouches', { value: [t] });
  target.dispatchEvent(ev);
  return ev;
}

describe('touch drawing', () => {
  it('tap-tap places two points of a trendline; touchstart default is prevented', () => {
    const { manager, svg } = setup();
    manager.setTool('trendline');
    const e1 = touch(svg, 'touchstart', 50, 400);
    touch(window, 'touchend', 50, 400);
    expect(e1.defaultPrevented).toBe(true);
    expect(manager.getDrawings()).toHaveLength(0);
    touch(svg, 'touchstart', 150, 300);
    touch(window, 'touchend', 150, 300);
    expect(manager.getDrawings()).toHaveLength(1);
    expect(manager.getDrawings()[0].points).toHaveLength(2);
  });

  it('touch-drag draws: finger release far from start places the second point', () => {
    const { manager, svg } = setup();
    manager.setTool('trendline');
    touch(svg, 'touchstart', 50, 400);
    touch(window, 'touchmove', 120, 350);
    touch(window, 'touchend', 200, 320);
    const d = manager.getDrawings();
    expect(d).toHaveLength(1);
    expect(d[0].points[1].time).toBe(1000 + 200 * 10);
  });

  it('short wiggle (< threshold) keeps the first point pending', () => {
    const { manager, svg } = setup();
    manager.setTool('trendline');
    touch(svg, 'touchstart', 50, 400);
    touch(window, 'touchend', 54, 402);
    expect(manager.getDrawings()).toHaveLength(0);
  });

  it('touch brush records a stroke', () => {
    const { manager, svg } = setup();
    manager.setTool('brush');
    touch(svg, 'touchstart', 10, 400);
    touch(window, 'touchmove', 30, 380);
    touch(window, 'touchmove', 60, 360);
    touch(window, 'touchend', 60, 360);
    expect(manager.getDrawings()).toHaveLength(1);
    expect(manager.getDrawings()[0].toolType).toBe('brush');
  });

  it('touch-dragging a drawing in cursor mode moves it (page scroll blocked)', () => {
    const { manager, svg } = setup();
    manager.setTool('trendline');
    manager.handlePointInput({ time: 1000, price: 100 });
    manager.handlePointInput({ time: 1500, price: 120 });
    manager.selectDrawing(null);
    manager.render();
    const id = manager.getDrawings()[0].id;
    const line = svg.querySelector(`[data-drawing-id="${id}"] line`)!;
    const start = touch(line, 'touchstart', 10, 10);
    expect(start.defaultPrevented).toBe(true);
    expect(manager.isDragging()).toBe(true);
    const mv = touch(window, 'touchmove', 40, 10);
    expect(mv.defaultPrevented).toBe(true);
    touch(window, 'touchend', 40, 10);
    expect(manager.isDragging()).toBe(false);
    expect(manager.getDrawings()[0].points[0].time).toBe(1000 + 30 * 10);
  });

  it('touch use adds wide transparent hit lines and large handles', () => {
    const { manager, svg } = setup();
    manager.setTool('trendline');
    touch(svg, 'touchstart', 50, 400);
    touch(window, 'touchend', 50, 400);
    touch(svg, 'touchstart', 150, 300);
    touch(window, 'touchend', 150, 300);
    manager.render();
    expect(svg.querySelectorAll('.drawing-touch-hit').length).toBeGreaterThan(0);
    const hit = svg.querySelector('.drawing-anchor-handle circle')!;
    expect(Number(hit.getAttribute('r'))).toBeGreaterThanOrEqual(20);
  });
});

function multi(target: EventTarget, type: string, pts: Array<[number, number]>) {
  const ev = new Event(type, { bubbles: true, cancelable: true });
  const list = pts.map(([x, y]) => ({ clientX: x, clientY: y }));
  Object.defineProperty(ev, 'touches', { value: type === 'touchend' ? list.slice(0, Math.max(0, list.length - 1)) : list });
  Object.defineProperty(ev, 'changedTouches', { value: list.slice(-1) });
  target.dispatchEvent(ev);
  return ev;
}

describe('pinch while a drawing tool is active', () => {
  function setupPinch() {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    document.body.appendChild(svg);
    const pinches: Array<{ scale: number; centerX: number; dx: number }> = [];
    const manager = new DrawingManager({ svg, mapper, autoPersist: false, onPinch: (g) => pinches.push(g) });
    return { svg, manager, pinches };
  }

  it('two fingers zoom the chart and place nothing, even if the first finger landed first', async () => {
    const { svg, manager, pinches } = setupPinch();
    manager.setTool('hline'); // 1-point tool: a stray first-finger touch would complete it instantly
    touch(svg, 'touchstart', 100, 300);
    const e2 = multi(svg, 'touchstart', [[100, 300], [200, 300]]);
    expect(e2.defaultPrevented).toBe(true);
    multi(window, 'touchmove', [[80, 300], [220, 300]]); // spread 100 -> 140
    expect(pinches).toHaveLength(1);
    expect(pinches[0].scale).toBeCloseTo(1.4);
    expect(pinches[0].centerX).toBeCloseTo(150);
    expect(pinches[0].dx).toBeCloseTo(0);
    multi(window, 'touchmove', [[110, 300], [250, 300]]); // translate +30 px, same spread
    expect(pinches[1].scale).toBeCloseTo(1);
    expect(pinches[1].dx).toBeCloseTo(30);
    multi(window, 'touchend', [[110, 300], [250, 300]]);
    await new Promise((r) => setTimeout(r, 120)); // the cancelled first touch must not fire late
    expect(manager.getDrawings()).toHaveLength(0);
    expect(manager.getTool()).toBe('hline'); // tool stays armed
  });

  it('pinch cancels an in-progress brush stroke', () => {
    const { svg, manager } = setupPinch();
    manager.setTool('brush');
    touch(svg, 'touchstart', 10, 400);
    touch(window, 'touchmove', 30, 380); // flushes the pending down -> stroke begins
    multi(svg, 'touchstart', [[30, 380], [90, 380]]);
    multi(window, 'touchend', [[30, 380], [90, 380]]);
    touch(window, 'touchend', 90, 380);
    expect(manager.getDrawings()).toHaveLength(0);
  });

  it('a one-finger tap still draws after the grace delay logic (no regression)', () => {
    const { svg, manager } = setupPinch();
    manager.setTool('hline');
    touch(svg, 'touchstart', 100, 300);
    touch(window, 'touchend', 100, 300);
    expect(manager.getDrawings()).toHaveLength(1);
  });

  it('a held finger is flushed by the grace timer, so previews do not wait for movement', async () => {
    const { svg, manager } = setupPinch();
    manager.setTool('trendline');
    touch(svg, 'touchstart', 100, 300);
    await new Promise((r) => setTimeout(r, 120));
    expect(manager.getDrawings()).toHaveLength(0);
    touch(window, 'touchend', 100, 300);
    touch(svg, 'touchstart', 200, 250);
    touch(window, 'touchend', 200, 250);
    expect(manager.getDrawings()).toHaveLength(1);
  });
});
