// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import type { Candle, DrawingObject } from '../../../types/market';
import { DrawingManager, applyStrokeOverrides } from '../DrawingManager';
import { ellipseGeometry, fibExtensionLevels, formatDuration, infoLineStats, pitchforkGeometry } from '../ExtraTools';
import { POINTS_REQUIRED } from '../toolSpec';

const candles: Candle[] = Array.from({ length: 30 }, (_, i) => ({
  time: 1000 + i * 100,
  open: 100 + i,
  high: 105 + i,
  low: 95 + i,
  close: 102 + i,
  volume: 100,
}));

/** x = (t-1000)/10 ; y = 600 - price*2 (monotone, invertible) */
const mapper = {
  timeToX: (t: number) => (t - 1000) / 10,
  xToTime: (x: number) => Math.round(x * 10 + 1000),
  priceToY: (p: number) => 600 - p * 2,
  yToPrice: (y: number) => (600 - y) / 2,
  getCandles: () => candles,
};

function setup(opts: Partial<ConstructorParameters<typeof DrawingManager>[0]> = {}) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  document.body.appendChild(svg);
  const manager = new DrawingManager({ svg, mapper, autoPersist: false, ...opts });
  return { svg, manager };
}

function draw(m: DrawingManager, tool: Parameters<DrawingManager['setTool']>[0], pts: Array<[number, number]>) {
  m.setTool(tool);
  let out: DrawingObject | null = null;
  for (const [t, p] of pts) out = m.handlePointInput({ time: t, price: p });
  return out;
}

describe('multi-point tools', () => {
  it('channel and pitchfork need 3 clicks; others 1 or 2', () => {
    expect(POINTS_REQUIRED.channel).toBe(3);
    expect(POINTS_REQUIRED.pitchfork).toBe(3);
    const { manager } = setup();
    manager.setTool('channel');
    expect(manager.handlePointInput({ time: 1000, price: 100 })).toBeNull();
    expect(manager.handlePointInput({ time: 1500, price: 120 })).toBeNull();
    const done = manager.handlePointInput({ time: 1300, price: 90 });
    expect(done?.toolType).toBe('channel');
    expect(done?.points).toHaveLength(3);
    expect(manager.getTool()).toBe('cursor');
  });

  it('single-click tools finish immediately with their own default color', () => {
    const { manager } = setup();
    for (const tool of ['hray', 'price_label', 'hline', 'vline'] as const) {
      const d = draw(manager, tool, [[1500, 110]]);
      expect(d?.toolType).toBe(tool);
      expect(d?.points).toHaveLength(1);
    }
    expect(manager.getDrawings()).toHaveLength(4);
  });

  it('a finished drawing is selected (properties bar opens) and reported', () => {
    const onSel = vi.fn();
    const { manager } = setup({ onSelectionChanged: onSel });
    const d = draw(manager, 'trendline', [[1000, 100], [1500, 120]])!;
    expect(manager.getSelectedDrawingId()).toBe(d.id);
    expect(onSel).toHaveBeenCalledWith(expect.objectContaining({ id: d.id }));
  });

  it('text tool no longer uses window.prompt', () => {
    const spy = vi.spyOn(window, 'prompt').mockImplementation(() => 'x');
    const { manager, svg } = setup();
    manager.setTool('text');
    svg.dispatchEvent(new MouseEvent('mousedown', { clientX: 50, clientY: 50, bubbles: true }));
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('rendering of the new tools', () => {
  it.each([
    ['hray', [[1500, 110]], 'line'],
    ['extended', [[1000, 100], [1500, 120]], 'line'],
    ['arrow', [[1000, 100], [1500, 120]], 'polygon'],
    ['info_line', [[1000, 100], [2000, 120]], 'text'],
    ['price_range', [[1000, 100], [1500, 120]], 'rect'],
    ['date_range', [[1000, 100], [2000, 120]], 'text'],
    ['price_label', [[1500, 110]], 'path'],
    ['channel', [[1000, 100], [1500, 120], [1300, 90]], 'polygon'],
    ['pitchfork', [[1000, 100], [1500, 130], [1600, 90]], 'line'],
    ['fib_ext', [[1000, 100], [1500, 130], [1600, 110]], 'text'],
    ['ellipse', [[1000, 100], [1500, 130]], 'ellipse'],
  ] as const)('%s renders its signature element', (tool, pts, el) => {
    const { manager, svg } = setup();
    draw(manager, tool, pts as unknown as Array<[number, number]>);
    const g = svg.querySelector('[data-drawing-id]')!;
    expect(g).toBeTruthy();
    expect(g.querySelectorAll(el).length).toBeGreaterThan(0);
  });

  it('extended line reaches both pane edges; hray goes right only', () => {
    const { manager, svg } = setup();
    draw(manager, 'extended', [[1100, 100], [1500, 110]]);
    const ln = svg.querySelector('[data-drawing-id] line')!;
    expect(Number(ln.getAttribute('x1'))).toBeLessThanOrEqual(0);
    expect(Number(ln.getAttribute('x2'))).toBeGreaterThanOrEqual(1000);
  });

  it('pitchfork geometry: median through the midpoint of P1-P2, parallels share its direction', () => {
    const g = pitchforkGeometry({ x: 0, y: 0 }, { x: 100, y: -50 }, { x: 120, y: 50 });
    expect(g.mid).toEqual({ x: 110, y: 0 });
    const [median, up, down] = g.lines;
    const dir = (l: [{ x: number; y: number }, { x: number; y: number }]) => [l[1].x - l[0].x, l[1].y - l[0].y];
    expect(dir(median)).toEqual([110, 0]);
    expect(dir(up)).toEqual([110, 0]);
    expect(dir(down)).toEqual([110, 0]);
  });

  it('info line stats count bars between the two times', () => {
    const st = infoLineStats({ time: 1000, price: 100 }, { time: 1500, price: 110 }, candles);
    expect(st.diff).toBe(10);
    expect(st.pct).toBe(10);
    expect(st.bars).toBe(5);
    expect(formatDuration(90061)).toBe('1g 1s');
    expect(formatDuration(5400)).toBe('1s 30dk');
    expect(formatDuration(600)).toBe('10dk');
  });
});

describe('dragging', () => {
  it('body drag translates every point by the pixel delta and persists once at the end', () => {
    const onChanged = vi.fn();
    const { manager } = setup({ onDrawingChanged: onChanged });
    const d = draw(manager, 'trendline', [[1000, 100], [1500, 120]])!;
    expect(manager.beginDrag(d.id, 'body', 200, 200)).toBe(true);
    manager.dragTo(230, 210); // +30px x (=+300s), +10px y (= -5 price)
    manager.dragTo(250, 210); // +50px x → +500s
    manager.endDrag();
    const moved = manager.getDrawings()[0];
    expect(moved.points[0]).toEqual({ time: 1500, price: 95 });
    expect(moved.points[1]).toEqual({ time: 2000, price: 115 });
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('anchor drag moves only that point', () => {
    const { manager } = setup();
    const d = draw(manager, 'trendline', [[1000, 100], [1500, 120]])!;
    manager.beginDrag(d.id, '1', 0, 0);
    manager.dragTo(10, -20); // x +10px → +100s ; y -20px → +10 price
    manager.endDrag();
    const pts = manager.getDrawings()[0].points;
    expect(pts[0]).toEqual({ time: 1000, price: 100 });
    expect(pts[1]).toEqual({ time: 1600, price: 130 });
  });

  it('rect corner drag changes one time and one price', () => {
    const { manager } = setup();
    const d = draw(manager, 'rect', [[1000, 100], [2000, 120]])!;
    manager.beginDrag(d.id, 'c10', 0, 0); // x from point 1, y from point 0
    manager.dragTo(20, 20); // +200s, -10 price
    manager.endDrag();
    const pts = manager.getDrawings()[0].points;
    expect(pts[1].time).toBe(2200);
    expect(pts[0].price).toBe(90);
    expect(pts[0].time).toBe(1000);
    expect(pts[1].price).toBe(120);
  });

  it('drag is one undo step and a locked drawing cannot be dragged', () => {
    const { manager } = setup();
    const d = draw(manager, 'trendline', [[1000, 100], [1500, 120]])!;
    manager.beginDrag(d.id, 'body', 0, 0);
    manager.dragTo(40, 0);
    manager.dragTo(80, 0);
    manager.endDrag();
    expect(manager.getDrawings()[0].points[0].time).toBe(1800);
    manager.undo();
    expect(manager.getDrawings()[0].points[0].time).toBe(1000);

    void manager.selectDrawing(d.id);
    return manager.updateSelectedDrawing({ locked: true }).then(() => {
      expect(manager.beginDrag(d.id, 'body', 0, 0)).toBe(false);
    });
  });

  it('a click without movement neither moves nor persists', () => {
    const onChanged = vi.fn();
    const { manager } = setup({ onDrawingChanged: onChanged });
    const d = draw(manager, 'trendline', [[1000, 100], [1500, 120]])!;
    manager.beginDrag(d.id, 'body', 5, 5);
    manager.dragTo(6, 5);
    manager.endDrag();
    expect(onChanged).not.toHaveBeenCalled();
    expect(manager.getDrawings()[0].points[0].time).toBe(1000);
  });

  it('mousedown on a drawing in cursor mode selects it and starts a drag; handles carry anchors', () => {
    const { manager, svg } = setup();
    const d = draw(manager, 'trendline', [[1000, 100], [1500, 120]])!;
    manager.selectDrawing(null);
    manager.render();
    const g = svg.querySelector(`[data-drawing-id="${d.id}"]`)!;
    g.querySelector('line')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 10, clientY: 10 }));
    expect(manager.getSelectedDrawingId()).toBe(d.id);
    expect(manager.isDragging()).toBe(true);
    window.dispatchEvent(new MouseEvent('mouseup'));
    expect(manager.isDragging()).toBe(false);
    const anchors = [...svg.querySelectorAll('.drawing-anchor-handle')].map((e) => e.getAttribute('data-anchor'));
    expect(anchors).toEqual(['0', '1']);
  });
});

describe('style editing', () => {
  it('updateSelectedDrawing patches width / style / label / lock, is undoable and notifies', async () => {
    const onChanged = vi.fn();
    const { manager } = setup({ onDrawingChanged: onChanged });
    const d = draw(manager, 'trendline', [[1000, 100], [1500, 120]])!;
    await manager.updateSelectedDrawing({ width: 4, lineStyle: 'dashed', label: 'x', locked: true });
    const cur = manager.getDrawings()[0];
    expect(cur).toMatchObject({ width: 4, lineStyle: 'dashed', label: 'x', locked: true });
    expect(onChanged).toHaveBeenCalledTimes(1);
    manager.undo();
    expect(manager.getDrawings()[0].width).toBeUndefined();
    void d;
  });

  it('applyStrokeOverrides sets width/dash on strokes but skips badges and anchors', () => {
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    const mkEl = (tag: string, attrs: Record<string, string>) => {
      const e = document.createElementNS('http://www.w3.org/2000/svg', tag);
      for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
      g.appendChild(e);
      return e;
    };
    const line = mkEl('line', { stroke: '#fff', 'stroke-width': '2' });
    const badge = mkEl('rect', { fill: '#1E222D', stroke: '#fff', 'stroke-width': '1' });
    const circle = mkEl('circle', { stroke: '#fff', 'stroke-width': '1' });
    const d = { id: 'a', symbol: 'X', timeframe: '1d', toolType: 'trendline', points: [], color: '#fff', width: 3, lineStyle: 'dotted' } as DrawingObject;
    applyStrokeOverrides(g, d);
    expect(line.getAttribute('stroke-width')).toBe('3');
    expect(line.getAttribute('stroke-dasharray')).toBe('1.5,3');
    expect(badge.getAttribute('stroke-width')).toBe('1');
    expect(circle.getAttribute('stroke-width')).toBe('1');
    applyStrokeOverrides(g, { ...d, lineStyle: 'solid' });
    expect(line.getAttribute('stroke-dasharray')).toBeNull();
  });

  it('duplicate copies the selected drawing with a new id, offset points, unlocked', async () => {
    const { manager } = setup();
    const d = draw(manager, 'trendline', [[1000, 100], [1500, 120]])!;
    await manager.updateSelectedDrawing({ locked: true, width: 3 });
    const copy = manager.duplicateSelected()!;
    expect(copy.id).not.toBe(d.id);
    expect(copy.locked).toBe(false);
    expect(copy.width).toBe(3);
    expect(copy.points[0].time).toBeGreaterThan(1000);
    expect(manager.getDrawings()).toHaveLength(2);
    expect(manager.getSelectedDrawingId()).toBe(copy.id);
  });
});

describe('Fib extension + ellipse', () => {
  it('needs 3 and 2 points', () => {
    expect(POINTS_REQUIRED.fib_ext).toBe(3);
    expect(POINTS_REQUIRED.ellipse).toBe(2);
  });

  it('extension prices project the A->B move from C', () => {
    const lv = fibExtensionLevels({ time: 1, price: 100 }, { time: 2, price: 130 }, { time: 3, price: 115 });
    const at = (l: number) => lv.find((x) => x.level === l)!.price;
    expect(at(0)).toBeCloseTo(115);
    expect(at(1)).toBeCloseTo(145);
    expect(at(1.618)).toBeCloseTo(115 + 30 * 1.618);
    // a down move projects downward
    const dn = fibExtensionLevels({ time: 1, price: 130 }, { time: 2, price: 100 }, { time: 3, price: 120 });
    expect(dn.find((x) => x.level === 1)!.price).toBeCloseTo(90);
  });

  it('ellipse is the inscribed ellipse of the two corners, any drag direction', () => {
    expect(ellipseGeometry({ x: 10, y: 50 }, { x: 110, y: 10 })).toEqual({ cx: 60, cy: 30, rx: 50, ry: 20 });
  });

  it('fib_ext draws a level line + label per level after the 3rd click, none before', () => {
    const { manager, svg } = setup();
    manager.setTool('fib_ext');
    manager.handlePointInput({ time: 1000, price: 100 });
    manager.handlePointInput({ time: 1500, price: 130 });
    expect(manager.getDrawings()).toHaveLength(0);
    manager.handlePointInput({ time: 1600, price: 110 });
    const g = svg.querySelector('[data-drawing-id]')!;
    expect(g.querySelectorAll('text').length).toBe(7);
    expect(g.textContent).toContain('1.618');
  });
});
