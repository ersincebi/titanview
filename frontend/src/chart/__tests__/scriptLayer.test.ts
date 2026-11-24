// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { ScriptExecutionResult } from '../../types/market';
import {
  ScriptLayer,
  buildFillRuns,
  buildLineFillPolygon,
  buildPolylinePath,
  clipLine,
  mergeBgRuns,
  tableOrigin,
  type LayerMapper,
} from '../ScriptLayer';
import { withAlpha } from '../ChartController';

const T0 = 1_000_000;
const DT = 60;

/** 10px/bar, x = 10*logical; price 100..200 maps linearly to y 400..0. */
function mapper(): LayerMapper {
  return {
    timeToLogical: (t) => (t - T0) / DT,
    logicalToX: (l) => l * 10,
    priceToY: (p) => 400 - (p - 100) * 4,
    barSpacing: () => 10,
    barRange: (t) => (t === T0 + 5 * DT ? { high: 150, low: 140 } : null),
    size: () => ({ width: 500, height: 400 }),
  };
}

function base(over: Partial<ScriptExecutionResult>): ScriptExecutionResult {
  return {
    ok: true,
    scriptTitle: 't',
    isStrategy: false,
    isOverlay: true,
    executionMs: 0,
    plots: [],
    markers: [],
    hlines: [],
    ...over,
  };
}

function mount(res: ScriptExecutionResult, pane: 'main' | 'sub' = 'main') {
  const host = document.createElement('div');
  const layer = new ScriptLayer(host, mapper(), pane);
  layer.setResult(res);
  return { host, svg: host.querySelector('svg')!, layer };
}

describe('ScriptLayer geometry helpers', () => {
  it('clipLine honours extend', () => {
    const a = { x: 100, y: 100 };
    const b = { x: 200, y: 150 };
    const none = clipLine(a, b, 'none', 500)!;
    expect(none[0].x).toBe(100);
    expect(none[1].x).toBe(200);
    const right = clipLine(a, b, 'right', 500)!;
    expect(right[1].x).toBeGreaterThanOrEqual(500);
    // slope preserved
    expect((right[1].y - right[0].y) / (right[1].x - right[0].x)).toBeCloseTo(0.5, 6);
    const both = clipLine(a, b, 'both', 500)!;
    expect(both[0].x).toBeLessThanOrEqual(0);
    expect(both[1].x).toBeGreaterThanOrEqual(500);
  });

  it('clipLine keeps vertical lines intact instead of dividing by zero', () => {
    const seg = clipLine({ x: 50, y: 10 }, { x: 50, y: 90 }, 'both', 500)!;
    expect(seg).toEqual([{ x: 50, y: 10 }, { x: 50, y: 90 }]);
  });

  it('mergeBgRuns joins adjacent same-color bars only', () => {
    const idx = (t: number) => (t - T0) / DT;
    const runs = mergeBgRuns(
      [
        { time: T0, color: 'red' },
        { time: T0 + DT, color: 'red' },
        { time: T0 + 2 * DT, color: 'blue' },
        { time: T0 + 4 * DT, color: 'blue' }, // gap → new run
      ],
      idx
    );
    expect(runs).toEqual([
      { from: 0, to: 1, color: 'red' },
      { from: 2, to: 2, color: 'blue' },
      { from: 4, to: 4, color: 'blue' },
    ]);
  });

  it('buildFillRuns splits on color change/gaps and uses hline constants', () => {
    const plots = [
      { id: 'p1', title: '', color: '', lineWidth: 1, style: 'line' as const, isOverlay: true, data: [0, 1, 2, 3].map((i) => ({ time: T0 + i * DT, value: 110 + i })) },
    ];
    const runs = buildFillRuns(
      {
        title: 'f',
        isOverlay: true,
        a: { plot: 'p1' },
        b: { price: 100 },
        points: [
          { time: T0, color: 'green' },
          { time: T0 + DT, color: 'green' },
          { time: T0 + 2 * DT, color: 'red' },
          { time: T0 + 3 * DT, color: 'red' },
        ],
      },
      plots
    );
    expect(runs.map((r) => r.color)).toEqual(['green', 'red']);
    expect(runs[0].top.map((p) => p.v)).toEqual([110, 111]);
    expect(runs[0].bottom.every((p) => p.v === 100)).toBe(true);
    // red run starts on the previous point so there is no visual gap
    expect(runs[1].top[0].v).toBe(111);
  });

  it('tableOrigin places by position', () => {
    expect(tableOrigin('top_left', 500, 400, 100, 50)).toEqual({ x: 6, y: 6 });
    expect(tableOrigin('top_right', 500, 400, 100, 50).x).toBe(394);
    expect(tableOrigin('middle_center', 500, 400, 100, 50)).toEqual({ x: 200, y: 175 });
  });

  it('withAlpha converts hex / rgb colors', () => {
    expect(withAlpha('#0284C7', 0.5)).toBe('rgba(2, 132, 199, 0.5)');
    expect(withAlpha('rgb(1,2,3)', 0.3)).toBe('rgba(1, 2, 3, 0.3)');
  });
});

describe('ScriptLayer rendering', () => {
  it('bgcolor: one rect per merged run, full height, bar-wide', () => {
    const { svg } = mount(
      base({
        bgcolors: [
          {
            title: 'bg',
            isOverlay: true,
            points: [0, 1, 2].map((i) => ({ time: T0 + i * DT, color: 'rgba(0,255,0,0.2)' })),
          },
        ],
      })
    );
    const rects = svg.querySelectorAll('rect.script-bg');
    expect(rects).toHaveLength(1);
    expect(rects[0].getAttribute('height')).toBe('400');
    expect(Number(rects[0].getAttribute('width'))).toBe(30); // 3 bars * 10px
    expect(Number(rects[0].getAttribute('x'))).toBe(-5);
  });

  it('non-overlay bgcolor goes to the sub layer only', () => {
    const res = base({ bgcolors: [{ title: 'b', isOverlay: false, points: [{ time: T0, color: 'red' }] }] });
    expect(mount(res, 'main').svg.querySelectorAll('rect.script-bg')).toHaveLength(0);
    expect(mount(res, 'sub').svg.querySelectorAll('rect.script-bg')).toHaveLength(1);
  });

  it('fill draws a polygon between two series', () => {
    const { svg } = mount(
      base({
        plots: [
          { id: 'a', title: 'a', color: '#fff', lineWidth: 1, style: 'line', isOverlay: true, data: [0, 1, 2].map((i) => ({ time: T0 + i * DT, value: 120 })) },
          { id: 'b', title: 'b', color: '#fff', lineWidth: 1, style: 'line', isOverlay: true, data: [0, 1, 2].map((i) => ({ time: T0 + i * DT, value: 110 })) },
        ],
        fills: [
          { title: 'f', isOverlay: true, a: { plot: 'a' }, b: { plot: 'b' }, points: [0, 1, 2].map((i) => ({ time: T0 + i * DT, color: 'rgba(0,0,255,0.3)' })) },
        ],
      })
    );
    const poly = svg.querySelector('polygon.script-fill')!;
    expect(poly).toBeTruthy();
    const pts = poly.getAttribute('points')!.split(' ');
    expect(pts).toHaveLength(6);
    expect(pts[0]).toBe('0.0,320.0'); // price 120 → y 320
    expect(pts[3]).toBe('20.0,360.0'); // price 110 → y 360 (reversed bottom edge)
  });

  it('circles and cross plot styles draw point shapes; hidden plots do not', () => {
    const data = [0, 1].map((i) => ({ time: T0 + i * DT, value: 130 }));
    const { svg } = mount(
      base({
        plots: [
          { id: 'c', title: 'c', color: 'red', lineWidth: 2, style: 'circles', isOverlay: true, data },
          { id: 'x', title: 'x', color: 'blue', lineWidth: 2, style: 'cross', isOverlay: true, data },
          { id: 'h', title: 'h', color: 'blue', lineWidth: 2, style: 'circles', isOverlay: true, hidden: true, data },
        ],
      })
    );
    expect(svg.querySelectorAll('circle.script-point')).toHaveLength(2);
    expect(svg.querySelectorAll('path.script-point')).toHaveLength(2);
  });

  it('line: extends right to the pane edge, dashes and arrows', () => {
    const { svg } = mount(
      base({
        drawings: {
          lines: [
            { t1: T0, p1: 110, t2: T0 + 10 * DT, p2: 120, extend: 'right', color: 'orange', style: 'dashed', width: 2, arrow: 'right' },
          ],
          boxes: [], labels: [], tables: [],
        },
      })
    );
    const ln = svg.querySelector('line.script-line')!;
    expect(Number(ln.getAttribute('x2'))).toBeGreaterThanOrEqual(500);
    expect(ln.getAttribute('stroke-dasharray')).toBeTruthy();
    expect(svg.querySelector('polygon.script-arrow')).toBeTruthy();
  });

  it('box: corners in pixels, extend both spans the pane, text centered', () => {
    const { svg } = mount(
      base({
        drawings: {
          lines: [], labels: [], tables: [],
          boxes: [
            { t1: T0 + 10 * DT, t2: T0 + 20 * DT, top: 150, bottom: 130, extend: 'none', borderColor: 'red', borderStyle: 'solid', borderWidth: 1, bgColor: 'rgba(255,0,0,0.2)', text: 'Z', textColor: 'white', textSize: 12 },
            { t1: T0 + 10 * DT, t2: T0 + 20 * DT, top: 190, bottom: 180, extend: 'both', borderColor: 'red', borderStyle: 'solid', borderWidth: 1, bgColor: 'blue', text: '', textColor: 'white', textSize: 12 },
          ],
        },
      })
    );
    const rects = svg.querySelectorAll('rect.script-box');
    expect(rects).toHaveLength(2);
    expect(rects[0].getAttribute('x')).toBe('100');
    expect(rects[0].getAttribute('width')).toBe('100');
    expect(rects[0].getAttribute('y')).toBe('200'); // price 150
    expect(rects[0].getAttribute('height')).toBe('80');
    expect(Number(rects[1].getAttribute('x'))).toBeLessThanOrEqual(0);
    expect(Number(rects[1].getAttribute('width'))).toBeGreaterThanOrEqual(500);
    expect(svg.querySelector('text.script-box-text')!.textContent).toBe('Z');
  });

  it('label: yloc.abovebar resolves via bar high, text drawn, label_up points up', () => {
    const { svg } = mount(
      base({
        drawings: {
          lines: [], boxes: [], tables: [],
          labels: [
            { t: T0 + 5 * DT, p: 0, yloc: 'abovebar', text: 'AL', color: 'green', textColor: 'white', style: 'label_down', size: 12, tooltip: 'tip' },
            { t: T0 + 5 * DT, p: 120, yloc: 'price', text: 'UP', color: 'red', textColor: 'white', style: 'label_up', size: 12, tooltip: '' },
            { t: T0 + 5 * DT, p: 125, yloc: 'price', text: '', color: 'blue', textColor: 'white', style: 'diamond', size: 12, tooltip: '' },
          ],
        },
      })
    );
    const labels = svg.querySelectorAll('g.script-label');
    expect(labels).toHaveLength(3);
    expect(labels[0].querySelector('text')!.textContent).toBe('AL');
    expect(labels[0].querySelector('title')!.textContent).toBe('tip');
    const rectAbove = labels[0].querySelector('rect')!;
    // high=150 → y 200; label_down sits above the point
    expect(Number(rectAbove.getAttribute('y')) + Number(rectAbove.getAttribute('height'))).toBeLessThan(200);
    const rectUp = labels[1].querySelector('rect')!;
    expect(Number(rectUp.getAttribute('y'))).toBeGreaterThan(320); // below price 120 (y=320)
    expect(labels[2].querySelector('polygon')).toBeTruthy();
  });

  it('label at a bar without data and yloc.abovebar is skipped, not drawn at 0', () => {
    const { svg } = mount(
      base({
        drawings: {
          lines: [], boxes: [], tables: [],
          labels: [{ t: T0 + 6 * DT, p: 0, yloc: 'abovebar', text: 'X', color: 'red', textColor: 'white', style: 'label_down', size: 12, tooltip: '' }],
        },
      })
    );
    expect(svg.querySelectorAll('g.script-label')).toHaveLength(0);
  });

  it('table: never drawn on the chart (shown in the bottom Tablo tab instead)', () => {
    const { svg } = mount(
      base({
        drawings: {
          lines: [], boxes: [], labels: [],
          tables: [
            {
              position: 'top_right', columns: 2, rows: 1, bgColor: '#111', frameColor: 'white', frameWidth: 1, borderColor: 'gray', borderWidth: 1,
              cells: [
                { col: 0, row: 0, text: 'RSI', textColor: 'white', bgColor: '', textSize: 12, halign: 'left' },
                { col: 1, row: 0, text: '71.2', textColor: 'red', bgColor: 'blue', textSize: 12, halign: 'right' },
              ],
            },
          ],
        },
      })
    );
    expect(svg.querySelector('g.script-table')).toBeNull();
  });

  it('failed result clears the layer', () => {
    const { svg, layer } = mount(base({ bgcolors: [{ title: 'b', isOverlay: true, points: [{ time: T0, color: 'red' }] }] }));
    expect(svg.children.length).toBeGreaterThan(0);
    layer.setResult(base({ ok: false, error: 'x' }));
    expect(svg.children.length).toBe(0);
  });

  it('drawings of a non-overlay script render in the sub layer, not on the price chart', () => {
    const res = base({
      isOverlay: false,
      drawings: { lines: [{ t1: T0, p1: 110, t2: T0 + DT, p2: 111, extend: 'none', color: 'red', style: 'solid', width: 1, arrow: 'none' }], boxes: [], labels: [], tables: [] },
    });
    expect(mount(res, 'main').svg.querySelectorAll('line.script-line')).toHaveLength(0);
    expect(mount(res, 'sub').svg.querySelectorAll('line.script-line')).toHaveLength(1);
  });

  it('buildLineFillPolygon orders corners and extends lines; buildPolylinePath handles straight/curved/closed', () => {
    const poly = buildLineFillPolygon(
      { x: 100, y: 100 }, { x: 200, y: 100 }, 'right',
      { x: 200, y: 200 }, { x: 100, y: 200 }, 'right',
      500
    )!;
    expect(poly).toHaveLength(4);
    expect(poly[0]).toEqual({ x: 100, y: 100 });
    expect(poly[1].x).toBeGreaterThanOrEqual(500);
    expect(poly[2].x).toBeGreaterThanOrEqual(500);
    expect(poly[3]).toEqual({ x: 100, y: 200 });
    expect(
      buildLineFillPolygon({ x: 600, y: 10 }, { x: 700, y: 10 }, 'none', { x: 600, y: 20 }, { x: 700, y: 20 }, 'none', 500)
    ).toBeNull();

    const pts = [{ x: 10, y: 10 }, { x: 50, y: 40 }, { x: 90, y: 10 }];
    expect(buildPolylinePath(pts, false, false)).toBe('M10.0,10.0 L50.0,40.0 L90.0,10.0');
    expect(buildPolylinePath(pts, false, true)).toContain('Z');
    const curved = buildPolylinePath(pts, true, true);
    expect(curved).toContain('C');
    expect(curved).toContain('Z');
    expect(buildPolylinePath([{ x: 1, y: 1 }], false, false)).toBe('');
  });

  it('linefill and polyline render SVG elements with linefill below lines', () => {
    const { svg } = mount(
      base({
        drawings: {
          lines: [
            { t1: T0 + 2 * DT, p1: 150, t2: T0 + 10 * DT, p2: 160, extend: 'none', color: '#0284C7', style: 'solid', width: 1, arrow: 'none' },
          ],
          boxes: [],
          labels: [],
          tables: [],
          linefills: [
            {
              l1: { t1: T0 + 2 * DT, p1: 150, t2: T0 + 10 * DT, p2: 160, extend: 'right' },
              l2: { t1: T0 + 2 * DT, p1: 120, t2: T0 + 10 * DT, p2: 130, extend: 'right' },
              color: 'rgba(2, 132, 199, 0.25)',
            },
          ],
          polylines: [
            {
              points: [
                { t: T0 + 1 * DT, p: 110 },
                { t: T0 + 5 * DT, p: 145 },
                { t: T0 + 9 * DT, p: 120 },
              ],
              curved: true,
              closed: true,
              lineColor: '#00bcd4',
              fillColor: 'rgba(0, 188, 212, 0.2)',
              lineStyle: 'dashed',
              lineWidth: 2,
            },
          ],
        },
      })
    );
    const lf = svg.querySelector('polygon.script-linefill')!;
    const pl = svg.querySelector('path.script-polyline')!;
    const ln = svg.querySelector('line.script-line')!;
    expect(lf).toBeTruthy();
    expect(lf.getAttribute('fill')).toBe('rgba(2, 132, 199, 0.25)');
    expect(pl).toBeTruthy();
    expect(pl.getAttribute('d')).toContain('C');
    expect(pl.getAttribute('stroke-dasharray')).toBeTruthy();
    const children = Array.from(svg.children);
    expect(children.indexOf(lf)).toBeLessThan(children.indexOf(ln));
  });
});
