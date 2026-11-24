import { describe, expect, it } from 'vitest';
import type { Candle } from '../../types/market';
import { executeScript } from '../runtime';

function bars(n: number): Candle[] {
  return Array.from({ length: n }, (_, i) => {
    const base = 100 + i;
    return {
      time: 1_700_000_000 + i * 3600,
      open: base,
      high: base + 2,
      low: base - 2,
      close: base + (i % 2 === 0 ? 1 : -1),
      volume: 1000,
    };
  });
}

function run(body: string, n = 20, overlay = true) {
  const res = executeScript(`//@version=5\nindicator("v", overlay=${overlay})\n${body}`, bars(n));
  expect(res.error).toBeUndefined();
  return res;
}

describe('script visuals — bgcolor / barcolor / fill / plotcandle', () => {
  it('bgcolor records one color per bar, skips na, honours conditions', () => {
    const r = run(`bgcolor(close > open ? color.new(color.green, 80) : na, title="up")`);
    expect(r.bgcolors).toHaveLength(1);
    const pts = r.bgcolors![0].points;
    expect(pts.length).toBe(10); // even bars close > open
    expect(pts.every((p) => typeof p.color === 'string')).toBe(true);
    expect(r.bgcolors![0].title).toBe('up');
    expect(r.bgcolors![0].isOverlay).toBe(true);
  });

  it('barcolor records candle recolors by time; last call per bar wins', () => {
    const r = run(`barcolor(color.red)
barcolor(bar_index % 2 == 0 ? color.blue : na)`);
    expect(r.barcolors).toHaveLength(20);
    const byTime = new Map(r.barcolors!.map((p) => [p.time, p.color]));
    const first = bars(20)[0].time;
    const second = bars(20)[1].time;
    expect(byTime.get(first)).not.toBe(byTime.get(second));
  });

  it('fill links two plots (series ids resolve) and two hlines (constant prices)', () => {
    const r = run(`p1 = plot(close, title="a")
p2 = plot(open, title="b")
fill(p1, p2, color = color.new(color.blue, 80), title="band")
h1 = hline(105)
h2 = hline(110)
fill(h1, h2, color = color.new(color.red, 90))`);
    expect(r.fills).toHaveLength(2);
    const plotFill = r.fills![0];
    expect(plotFill).toMatchObject({ title: 'band', isOverlay: true });
    expect('plot' in plotFill.a && r.plots.some((p) => p.id === (plotFill.a as { plot: string }).plot)).toBe(true);
    expect(plotFill.points).toHaveLength(20);
    expect(r.fills![1].a).toEqual({ price: 105 });
    expect(r.fills![1].b).toEqual({ price: 110 });
  });

  it('display.none plot survives only as a fill source (flagged hidden)', () => {
    const r = run(`a = plot(close, title="src", display=display.none)
b = plot(open, title="ref", display=display.none)
fill(a, b, color=color.gray)
plot(close, title="drawn")`);
    expect(r.plots.filter((p) => !p.hidden).map((p) => p.title)).toEqual(['drawn']);
    expect(r.plots.filter((p) => p.hidden).map((p) => p.title).sort()).toEqual(['ref', 'src']);
    expect(r.fills).toHaveLength(1);
  });

  it('fill with a non-plot argument is a line-numbered error, not a silent skip', () => {
    const res = executeScript(`//@version=5\nindicator("e")\nfill(close, open, color.red)`, bars(5));
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/Satır 3.*fill/);
  });

  it('plotcandle / plotbar produce OHLC series with per-bar color', () => {
    const r = run(
      `plotcandle(open, high, low, close, title="c", color = close > open ? color.green : color.red)
plotbar(open, high, low, close, title="b")`,
      10,
      false
    );
    expect(r.ohlcPlots).toHaveLength(2);
    expect(r.ohlcPlots![0]).toMatchObject({ kind: 'candle', title: 'c', isOverlay: false });
    expect(r.ohlcPlots![0].data).toHaveLength(10);
    expect(r.ohlcPlots![0].data[0].color).toBeTruthy();
    expect(r.ohlcPlots![1].kind).toBe('bar');
  });

  it('plot styles are carried through (area, circles, cross, stepline, histogram)', () => {
    const r = run(`plot(close, title="a", style=plot.style_area)
plot(close, title="c", style=plot.style_circles)
plot(close, title="x", style=plot.style_cross)
plot(close, title="s", style=plot.style_stepline)
plot(close, title="h", style=plot.style_histogram)`);
    expect(r.plots.map((p) => p.style)).toEqual(['area', 'circles', 'cross', 'stepline', 'histogram']);
  });

  it('no script produces a "not drawn yet" warning any more', () => {
    const r = run(`bgcolor(color.red)
barcolor(color.blue)
p = plot(close)
q = plot(open)
fill(p, q)
plotcandle(open, high, low, close)
label.new(bar_index, high, "x")
line.new(bar_index - 1, low, bar_index, high)
box.new(bar_index - 2, high, bar_index, low)
t = table.new(position.top_right, 1, 1)
table.cell(t, 0, 0, "hi")`);
    expect((r.warnings ?? []).join('|')).not.toMatch(/henüz çizilmiyor/);
  });
});

describe('script drawings — line / box / label / table resolve to time & price', () => {
  it('lines: bar_index → candle time, future index extrapolates, extend/style/width kept', () => {
    const r = run(`if barstate.islast
    line.new(bar_index - 5, low, bar_index + 3, high, extend=extend.right, color=color.orange, style=line.style_dashed, width=3)`);
    const c = bars(20);
    const ln = r.drawings!.lines[0];
    expect(ln.t1).toBe(c[14].time);
    expect(ln.t2).toBe(c[19].time + 3 * 3600);
    expect(ln).toMatchObject({ extend: 'right', style: 'dashed', width: 3 });
  });

  it('setters mutate (set_xy2, set_color), delete removes', () => {
    const r = run(`var l1 = line.new(0, 100, 5, 110)
var l2 = line.new(0, 90, 5, 95)
if barstate.islast
    line.set_xy2(l1, bar_index, 120)
    line.set_color(l1, color.red)
    line.delete(l2)`);
    expect(r.drawings!.lines).toHaveLength(1);
    expect(r.drawings!.lines[0].p2).toBe(120);
    expect(r.drawings!.lines[0].t2).toBe(bars(20)[19].time);
  });

  it('boxes carry corners, bg/border and text; xloc.bar_time takes ms', () => {
    const c = bars(20);
    const r = run(`if barstate.islast
    box.new(bar_index - 4, high, bar_index, low, border_color=color.red, bgcolor=color.new(color.red, 80), text="Z")
    box.new(${c[3].time * 1000}, 130, ${c[8].time * 1000}, 120, xloc=xloc.bar_time)`);
    expect(r.drawings!.boxes).toHaveLength(2);
    expect(r.drawings!.boxes[0]).toMatchObject({ text: 'Z', t1: c[15].time, t2: c[19].time });
    expect(r.drawings!.boxes[1]).toMatchObject({ t1: c[3].time, t2: c[8].time, top: 130, bottom: 120 });
  });

  it('labels: yloc.abovebar needs no price; text/style/color preserved', () => {
    const r = run(`if bar_index == 4
    label.new(bar_index, na, "buy", yloc=yloc.belowbar, style=label.style_label_up, color=color.green, textcolor=color.white)`);
    expect(r.drawings!.labels).toHaveLength(1);
    expect(r.drawings!.labels[0]).toMatchObject({ text: 'buy', yloc: 'belowbar', style: 'label_up', t: bars(20)[4].time });
  });

  it('tables collect cells and position', () => {
    const r = run(`var t = table.new(position.bottom_left, 2, 2, bgcolor=color.gray)
if barstate.islast
    table.cell(t, 0, 0, "A", text_color=color.white)
    table.cell(t, 1, 1, "B", bgcolor=color.red)`);
    expect(r.drawings!.tables).toHaveLength(1);
    const t = r.drawings!.tables[0];
    expect(t).toMatchObject({ position: 'bottom_left', columns: 2, rows: 2 });
    expect(t.cells.map((x) => x.text).sort()).toEqual(['A', 'B']);
    expect(t.cells.find((x) => x.text === 'B')!.bgColor).toBeTruthy();
  });

  it('object count defaults to 50 and caps at max_lines_count=500 by default', () => {
    const def = run(`line.new(bar_index, low, bar_index + 1, high)`, 120);
    expect(def.drawings!.lines).toHaveLength(50);
    const maxCap = executeScript(
      `//@version=5\nindicator("v", overlay=true, max_lines_count=500)\nline.new(bar_index, low, bar_index + 1, high)`,
      bars(600)
    );
    expect(maxCap.drawings!.lines).toHaveLength(500);
  });
});
