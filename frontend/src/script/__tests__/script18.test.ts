import { describe, expect, it } from 'vitest';
import { deriveCandles, DEFAULT_STYLE_PARAMS } from '../../chart/chartTypes';
import type { Candle, CorporateEventsData, FxRatePoint } from '../../types/market';
import { buildLibraryRegistry, extractScriptRequests, scriptTimeframeToApi } from '../libraries';
import { mergeScriptResults } from '../merge';
import { scriptCacheKey } from '../scriptClient';
import { executeScript, type RunOptions } from '../runtime';

function makeCandles(n: number, startSec = 1_700_000_000, stepSec = 900): Candle[] {
  return Array.from({ length: n }, (_, i) => {
    const base = 100 + Math.sin(i / 4) * 8 + i * 0.4;
    const open = Number((base - 0.5).toFixed(4));
    const close = Number((base + 0.5).toFixed(4));
    const high = Number((Math.max(open, close) + 1.5).toFixed(4));
    const low = Number((Math.min(open, close) - 1.2).toFixed(4));
    const volume = 1000 + (i % 5) * 250 + (i % 2 === 0 ? 100 : -150);
    return { time: startSec + i * stepSec, open, high, low, close, volume };
  });
}

function makeDailyCandles(n: number, startSec = 1_704_067_200 /* 2024-01-01 UTC */): Candle[] {
  return makeCandles(n, startSec, 86_400);
}

const run = (code: string, bars: Candle[], opts: RunOptions = {}) =>
  executeScript(code, bars, { symbol: 'THYAO.IS', timeframe: '15', ...opts });

const lastPlot = (res: ReturnType<typeof run>, idx = 0): number | undefined => {
  const pts = res.plots[idx]?.data ?? [];
  return pts.length ? pts[pts.length - 1].value : undefined;
};

describe('Faz 18A: library() / export / import & /api/scripts registry', () => {
  const mathLib = `//@version=6
library("TitanMath")

export enum Mode
    add = "ADD"
    mul = "MUL"

export type Pair
    float a
    float b

export const float SCALE = 2.5

helper(float x) =>
    x + 1.0

export method sum(Pair this) =>
    this.a + this.b

export combine(float x, float y, Mode m = Mode.add) =>
    float res = m == Mode.add ? helper(x) + y : x * y
    res
`;

  const bars = makeCandles(25);

  it('resolves exported functions, methods, types, enums, consts and private helpers via import', () => {
    const script = `//@version=6
indicator("Lib Consumer", overlay=true)
import local/TitanMath/1 as tm

p = tm.Pair.new(3.0, 4.0)
s = p.sum()
c1 = tm.combine(10.0, 5.0, tm.Mode.add)
c2 = tm.combine(3.0, 4.0, tm.Mode.mul)
plot(s, "sum")
plot(c1, "add")
plot(c2, "mul")
plot(tm.SCALE, "scale")
`;
    const reg = buildLibraryRegistry([
      { name: 'TitanMath', code: mathLib },
      { name: 'NotALib', code: '//@version=6\nindicator("X")\nplot(close)' },
    ]);
    expect(reg['local/TitanMath/1']).toBe(mathLib);
    expect(reg['NotALib']).toBeUndefined();

    const r = run(script, bars, { libraries: reg });
    expect(r.ok).toBe(true);
    expect(lastPlot(r, 0)).toBeCloseTo(7.0, 6);
    expect(lastPlot(r, 1)).toBeCloseTo(16.0, 6); // helper(10)=11 + 5
    expect(lastPlot(r, 2)).toBeCloseTo(12.0, 6);
    expect(lastPlot(r, 3)).toBeCloseTo(2.5, 6);
  });

  it('supports default alias (no as clause) and 2-part shorthand', () => {
    const script = `//@version=6
indicator("Default Alias")
import local/TitanMath/1
plot(TitanMath.SCALE)
`;
    const r = run(script, bars, { libraries: { 'local/TitanMath/1': mathLib } });
    expect(r.ok).toBe(true);
    expect(lastPlot(r, 0)).toBeCloseTo(2.5, 6);
  });

  it('supports transitive imports (libB imports libA)', () => {
    const libA = `//@version=6
library("LibA")
export doubleIt(float x) =>
    x * 2.0
`;
    const libB = `//@version=6
library("LibB")
import local/LibA/1 as a
export quadIt(float x) =>
    a.doubleIt(a.doubleIt(x))
`;
    const script = `//@version=6
indicator("Transitive")
import local/LibB/1 as b
plot(b.quadIt(5.0))
`;
    const r = run(script, bars, {
      libraries: { 'local/LibA/1': libA, 'local/LibB/1': libB },
    });
    expect(r.ok).toBe(true);
    expect(lastPlot(r, 0)).toBeCloseTo(20.0, 6);
  });

  it('executes a library script directly with isLibrary=true', () => {
    const r = run(mathLib, bars);
    expect(r.ok).toBe(true);
    expect(r.isLibrary).toBe(true);
    expect(r.scriptTitle).toBe('TitanMath');
  });

  it('rejects private access, non-library export, missing param type, invalid title, missing lib, duplicate alias, and cycles', () => {
    // 1. Private helper access
    const priv = run(
      `//@version=6\nindicator("Priv")\nimport local/TitanMath/1 as tm\nplot(tm.helper(1.0))`,
      bars,
      { libraries: { 'local/TitanMath/1': mathLib } }
    );
    expect(priv.ok).toBe(false);
    expect(priv.error).toContain('helper');

    // 2. export in non-library
    const badExp = run(`//@version=6\nindicator("Ind")\nexport f(float x) => x\nplot(f(1.0))`, bars);
    expect(badExp.ok).toBe(false);

    // 3. missing explicit param type on exported function
    const badParam = run(`//@version=6\nlibrary("BadParam")\nexport f(x) => x`, bars);
    expect(badParam.ok).toBe(false);

    // 4. invalid library title
    const badTitle = run(`//@version=6\nlibrary("Bad Title")\nexport f(float x) => x`, bars);
    expect(badTitle.ok).toBe(false);

    // 5. missing library
    const missing = run(`//@version=6\nindicator("M")\nimport local/NoSuch/1 as ns\nplot(close)`, bars);
    expect(missing.ok).toBe(false);
    expect(missing.error).toContain('NoSuch');

    // 6. duplicate alias
    const dup = run(
      `//@version=6\nindicator("D")\nimport local/TitanMath/1 as m\nimport local/TitanMath/1 as m\nplot(close)`,
      bars,
      { libraries: { 'local/TitanMath/1': mathLib } }
    );
    expect(dup.ok).toBe(false);

    // 7. circular import
    const cycA = `//@version=6\nlibrary("CycA")\nimport local/CycB/1 as b\nexport f(float x) => b.g(x)`;
    const cycB = `//@version=6\nlibrary("CycB")\nimport local/CycA/1 as a\nexport g(float x) => a.f(x)`;
    const cyc = run(`//@version=6\nindicator("C")\nimport local/CycA/1 as a\nplot(a.f(1.0))`, bars, {
      libraries: { 'local/CycA/1': cycA, 'local/CycB/1': cycB },
    });
    expect(cyc.ok).toBe(false);
    expect(cyc.error).toContain('Circular');
  });

  it('extractScriptRequests scans imports, lower TFs, corporate events, and FX pairs', () => {
    const code = `//@version=6
indicator("ReqScan")
import local/MyLib/1 as ml
a = request.security_lower_tf(syminfo.tickerid, "5", close)
d1 = request.dividends(syminfo.tickerid, dividends.gross)
d2 = request.splits("NASDAQ:AAPL", splits.numerator)
fx = request.currency_rate(currency.EUR, "TRY")
plot(close)
`;
    const h = extractScriptRequests(code);
    expect(h.hasImports).toBe(true);
    expect(h.lowerTimeframes).toEqual(['5']);
    expect(h.needsCurrentEvents).toBe(true);
    expect(h.eventSymbols).toEqual(['AAPL']);
    expect(h.currencyPairs).toEqual([{ from: 'EUR', to: 'TRY' }]);
    expect(scriptTimeframeToApi('5')).toBe('5m');
    expect(scriptTimeframeToApi('D')).toBe('1d');
    expect(scriptTimeframeToApi('999')).toBeNull();
  });
});

describe('Faz 18B & 18C: linefill.*, chart.point.*, polyline.*', () => {
  const bars = makeCandles(30);

  it('linefill.new / set_color / get_line1 / get_line2 / delete / all & dynamic line updates', () => {
    const code = `//@version=6
indicator("Linefill Test", overlay=true)
var line l1 = na
var line l2 = na
var line l3 = na
var linefill lf1 = na
var linefill lf2 = na
if bar_index == 5
    l1 := line.new(bar_index, high, bar_index + 10, high + 2, extend=extend.right)
    l2 := line.new(bar_index, low, bar_index + 10, low - 2, extend=extend.right)
    l3 := line.new(bar_index, open, bar_index + 5, open)
    lf1 := linefill.new(l1, l2, color.new(color.blue, 80))
    lf2 := linefill.new(l1, l3, color.new(color.red, 80))
if bar_index == 20
    lf1.set_color(color.new(color.green, 75))
    line.set_y2(lf1.get_line1(), 180.0)
    line.set_y2(linefill.get_line2(lf1), 90.0)
    linefill.delete(lf2)
plot(array.size(linefill.all), "lfCount")
`;
    const r = run(code, bars);
    expect(r.ok).toBe(true);
    expect(lastPlot(r, 0)).toBe(1);
    const lfs = r.drawings?.linefills ?? [];
    expect(lfs).toHaveLength(1);
    expect(lfs[0].l1.p2).toBeCloseTo(180.0, 6);
    expect(lfs[0].l2.p2).toBeCloseTo(90.0, 6);
    expect(lfs[0].l1.extend).toBe('right');
    expect(lfs[0].color).toContain('0.25'); // transp 75 -> alpha 0.25
  });

  it('deleting a line invalidates its attached linefill', () => {
    const code = `//@version=6
indicator("LF Delete Line", overlay=true)
if barstate.islast
    l1 = line.new(bar_index - 5, high, bar_index, high)
    l2 = line.new(bar_index - 5, low, bar_index, low)
    linefill.new(l1, l2, color.blue)
    line.delete(l1)
`;
    const r = run(code, bars);
    expect(r.ok).toBe(true);
    expect(r.drawings?.linefills ?? []).toHaveLength(0);
  });

  it('chart.point.new(time, index, price) / from_index / from_time / now / copy & drawing overloads + polyline', () => {
    const code = `//@version=6
indicator("ChartPoint & Polyline", overlay=true)
if barstate.islast
    p1 = chart.point.new(time[10], bar_index - 10, low[10])
    p2 = chart.point.from_index(bar_index - 5, high[5])
    p3 = chart.point.from_time(time[2], close[2])
    p4 = chart.point.now(close)
    p5 = p4.copy()
    p5.price := p5.price + 3.5

    ln = line.new(p1, p4, color=color.orange, width=2)
    line.set_second_point(ln, p5)
    lnMix = line.new(p3, p4, color=color.green)

    bx = box.new(p2, p4, border_color=color.blue, bgcolor=color.new(color.blue, 85))
    box.set_bottom_right_point(bx, p5)

    lb = label.new(p3, "PT", color=color.purple)
    label.set_point(lb, p5)

    pts = array.new<chart.point>()
    array.push(pts, p1)
    array.push(pts, p2)
    array.push(pts, p5)
    pl = polyline.new(pts, curved=true, closed=true, line_color=color.aqua, fill_color=color.new(color.aqua, 85), line_width=2)
    plot_val = p5.price - p4.price
plot(barstate.islast ? 1.0 : 0.0)
`;
    const r = run(code, bars);
    expect(r.ok).toBe(true);
    const lastBar = bars[bars.length - 1];
    expect(r.drawings?.lines).toHaveLength(2);
    expect(r.drawings!.lines[0].p2).toBeCloseTo(lastBar.close + 3.5, 4);
    expect(r.drawings!.lines[0].t1).toBe(bars[bars.length - 11].time);
    // Mixed from_time + now resolves both coordinates consistently via bar_time
    expect(r.drawings!.lines[1].t1).toBe(bars[bars.length - 3].time);
    expect(r.drawings!.lines[1].t2).toBe(lastBar.time);
    expect(r.drawings?.boxes).toHaveLength(1);
    expect(r.drawings!.boxes[0].bottom).toBeCloseTo(lastBar.close + 3.5, 4);
    expect(r.drawings?.labels).toHaveLength(1);
    expect(r.drawings!.labels[0].p).toBeCloseTo(lastBar.close + 3.5, 4);
    expect(r.drawings?.polylines).toHaveLength(1);
    expect(r.drawings!.polylines![0].curved).toBe(true);
    expect(r.drawings!.polylines![0].closed).toBe(true);
    expect(r.drawings!.polylines![0].points).toHaveLength(3);
  });
});

describe('Faz 18D: xloc.bar_time, set_xloc, get_price, copy/all, and max_*_count FIFO limits', () => {
  const bars = makeCandles(25);

  it('xloc.bar_time converts Unix ms to seconds across line/box/label, set_xloc, get_price, copy, all', () => {
    const code = `//@version=6
indicator("Xloc & Helpers", overlay=true)
var float midPrice = na
if barstate.islast
    l = line.new(time[4], 100.0, time, 120.0, xloc=xloc.bar_time)
    l2 = line.copy(l)
    line.set_xloc(l2, time[2], time, xloc.bar_time)
    // bar_index interpolation check
    lIdx = line.new(bar_index - 4, 100.0, bar_index, 120.0)
    midPrice := line.get_price(lIdx, bar_index - 2)
    b = box.new(time[3], 130.0, time, 110.0, xloc=xloc.bar_time)
    b2 = box.copy(b)
    lb = label.new(time[1], 125.0, "TimeLabel", xloc=xloc.bar_time)
    label.set_xloc(lb, time, xloc.bar_time)
    lb2 = label.copy(lb)
plot(midPrice, "mid")
plot(array.size(line.all), "lc")
plot(array.size(box.all), "bc")
plot(array.size(label.all), "lbc")
`;
    const r = run(code, bars);
    expect(r.ok).toBe(true);
    expect(lastPlot(r, 0)).toBeCloseTo(110.0, 6);
    expect(lastPlot(r, 1)).toBe(3);
    expect(lastPlot(r, 2)).toBe(2);
    expect(lastPlot(r, 3)).toBe(2);
    expect(r.drawings!.lines[0].t1).toBe(bars[bars.length - 5].time);
    expect(r.drawings!.lines[1].t1).toBe(bars[bars.length - 3].time);
    expect(r.drawings!.boxes[0].t1).toBe(bars[bars.length - 4].time);
    expect(r.drawings!.labels[0].t).toBe(bars[bars.length - 1].time);
  });

  it('enforces live FIFO max_*_count limits for lines, boxes, labels, and polylines', () => {
    const code = `//@version=6
indicator("Limits", overlay=true, max_lines_count=3, max_boxes_count=2, max_labels_count=2, max_polylines_count=2)
line.new(bar_index, low, bar_index, high)
box.new(bar_index, high, bar_index, low)
label.new(bar_index, high, str.tostring(bar_index))
pts = array.from(chart.point.from_index(bar_index, low), chart.point.from_index(bar_index, high))
polyline.new(pts)
`;
    const r = run(code, bars);
    expect(r.ok).toBe(true);
    expect(r.drawings!.lines).toHaveLength(3);
    expect(r.drawings!.boxes).toHaveLength(2);
    expect(r.drawings!.labels).toHaveLength(2);
    expect(r.drawings!.polylines).toHaveLength(2);
    // FIFO keeps newest bars (23 and 24)
    expect(r.drawings!.labels.map((l) => l.text)).toEqual(['23', '24']);
  });

  it('rejects out-of-range max_*_count values at compile time', () => {
    expect(run(`//@version=6\nindicator("X", max_lines_count=501)\nplot(close)`, bars).ok).toBe(false);
    expect(run(`//@version=6\nindicator("X", max_boxes_count=0)\nplot(close)`, bars).ok).toBe(false);
    expect(run(`//@version=6\nindicator("X", max_polylines_count=101)\nplot(close)`, bars).ok).toBe(false);
  });
});

describe('Faz 18E: log.info / log.warning / log.error', () => {
  const bars = makeCandles(10);

  it('collects formatted log entries with level, barIndex, time, line and merges across scripts', () => {
    const code1 = `//@version=6
indicator("Logs1", overlay=true)
if bar_index == 0
    log.info("Start close={0,number,0.00}", close)
if bar_index == 5
    log.warning("Mid bar #{0}", bar_index)
if barstate.islast
    log.error("Final bar {0}", syminfo.ticker)
plot(close)
`;
    const code2 = `//@version=6
indicator("Logs2", overlay=true)
if barstate.islast
    log.info("Secondary ok")
plot(open)
`;
    const r1 = run(code1, bars);
    const r2 = run(code2, bars);
    expect(r1.ok).toBe(true);
    expect(r1.logs).toHaveLength(3);
    expect(r1.logs![0]).toMatchObject({ level: 'info', barIndex: 0, time: bars[0].time, line: 4 });
    expect(r1.logs![0].message).toBe(`Start close=${bars[0].close.toFixed(2)}`);
    expect(r1.logs![1]).toMatchObject({ level: 'warning', barIndex: 5, message: 'Mid bar #5' });
    expect(r1.logs![2]).toMatchObject({ level: 'error', barIndex: 9, message: 'Final bar THYAO.IS' });

    const merged = mergeScriptResults(r1, r2);
    expect(merged.logs).toHaveLength(4);
  });
});

describe('Faz 18F: request.* expansion (lower TF, dividends/splits/earnings, currency_rate, honest na)', () => {
  it('request.security_lower_tf buckets lower-TF bars into chart bars for scalar and tuple expressions', () => {
    const t0 = 1_700_000_400; // multiple of 900
    const chart15m = makeCandles(6, t0, 900);
    // 3 x 5m bars inside each 15m bar
    const ltf5m: Candle[] = [];
    for (let i = 0; i < chart15m.length; i++) {
      for (let k = 0; k < 3; k++) {
        const c = 100 + i * 10 + k;
        ltf5m.push({
          time: t0 + i * 900 + k * 300,
          open: c - 0.1,
          high: c + 0.5,
          low: c - 0.5,
          close: c,
          volume: 100,
        });
      }
    }
    const code = `//@version=6
indicator("LTF Test")
closes = request.security_lower_tf(syminfo.tickerid, "5", close)
[oArr, cArr] = request.security_lower_tf(syminfo.tickerid, "5", [open, close])
plot(array.size(closes), "cnt")
plot(array.size(closes) > 0 ? array.get(closes, 0) : na, "first")
plot(array.size(cArr) > 0 ? array.get(cArr, array.size(cArr) - 1) : na, "last")
`;
    const r = run(code, chart15m, {
      timeframe: '15',
      lowerTfCandles: { 'THYAO.IS|5m': ltf5m },
    });
    expect(r.ok).toBe(true);
    expect(lastPlot(r, 0)).toBe(3);
    expect(lastPlot(r, 1)).toBeCloseTo(150, 6); // i=5, k=0 -> 150
    expect(lastPlot(r, 2)).toBeCloseTo(152, 6); // i=5, k=2 -> 152

    // Higher TF in security_lower_tf errors unless ignore_invalid_timeframe=true
    const errRes = run(
      `//@version=6\nindicator("LTF Err")\na = request.security_lower_tf(syminfo.tickerid, "60", close)\nplot(array.size(a))`,
      chart15m,
      { timeframe: '15' }
    );
    expect(errRes.ok).toBe(false);

    const ignRes = run(
      `//@version=6\nindicator("LTF Ign")\na = request.security_lower_tf(syminfo.tickerid, "60", close, ignore_invalid_timeframe=true)\nplot(array.size(a))`,
      chart15m,
      { timeframe: '15' }
    );
    expect(ignRes.ok).toBe(true);
    expect(lastPlot(ignRes, 0)).toBe(0);
    expect(ignRes.warnings?.length).toBeGreaterThan(0);

    // Missing lower-TF data returns empty array + honest warning
    const noData = run(code, chart15m, { timeframe: '15' });
    expect(noData.ok).toBe(true);
    expect(lastPlot(noData, 0)).toBe(0);
    expect(noData.warnings?.some((w) => w.includes('request.security_lower_tf'))).toBe(true);
  });

  it('request.dividends, request.splits, request.earnings align Yahoo events honestly', () => {
    const daily = makeDailyCandles(10);
    const ev: CorporateEventsData = {
      symbol: 'AAPL',
      supported: true,
      dividends: [{ time: daily[3].time, amount: 0.25 }],
      splits: [{ time: daily[5].time, numerator: 4, denominator: 1, ratio: '4:1' }],
      earnings: [{ time: daily[7].time, actual: 2.18, estimate: 2.1 }],
    };
    const code = `//@version=6
indicator("Corp Events")
dGapsOn = request.dividends("AAPL", dividends.gross, gaps=barmerge.gaps_on)
dGapsOff = request.dividends("AAPL", dividends.gross, gaps=barmerge.gaps_off)
dNet = request.dividends("AAPL", dividends.net)
sNum = request.splits("AAPL", splits.numerator, gaps=barmerge.gaps_on)
sDen = request.splits("AAPL", splits.denominator, gaps=barmerge.gaps_on)
eAct = request.earnings("AAPL", earnings.actual, gaps=barmerge.gaps_on)
eEst = request.earnings("AAPL", earnings.estimate, gaps=barmerge.gaps_off)
eStd = request.earnings("AAPL", earnings.standardized)
plot(dGapsOn, "dOn")
plot(dGapsOff, "dOff")
plot(sNum, "sNum")
plot(sDen, "sDen")
plot(eAct, "eAct")
plot(eEst, "eEst")
plot(dNet, "dNet")
plot(eStd, "eStd")
`;
    const r = run(code, daily, { symbol: 'AAPL', timeframe: 'D', corporateEvents: { AAPL: ev } });
    expect(r.ok).toBe(true);
    // dividends.gross gaps_on hits only bar 3
    expect(r.plots[0].data).toEqual([{ time: daily[3].time, value: 0.25 }]);
    // dividends.gross gaps_off carries forward from bar 3..9
    expect(r.plots[1].data.length).toBe(7);
    expect(lastPlot(r, 1)).toBeCloseTo(0.25, 6);
    // 4-for-1 split: numerator=4, denominator=1 on bar 5
    expect(r.plots[2].data).toEqual([{ time: daily[5].time, value: 4 }]);
    expect(r.plots[3].data).toEqual([{ time: daily[5].time, value: 1 }]);
    // earnings actual on bar 7, estimate carried forward from bar 7..9
    expect(r.plots[4].data).toEqual([{ time: daily[7].time, value: 2.18 }]);
    expect(lastPlot(r, 5)).toBeCloseTo(2.1, 6);
    // net dividend & standardized earnings honestly return na + warning
    expect(r.plots[6].data).toHaveLength(0);
    expect(r.plots[7].data).toHaveLength(0);
    expect(r.warnings?.some((w) => w.includes('dividends.net'))).toBe(true);
    expect(r.warnings?.some((w) => w.includes('earnings.standardized'))).toBe(true);
  });

  it('request.currency_rate resolves direct, inverse, same-currency=1, and honest na for missing / unsupported feeds', () => {
    const daily = makeDailyCandles(5);
    const fxRates: FxRatePoint[] = daily.map((c, i) => ({ time: c.time, rate: 1.08 + i * 0.01 }));
    const code = `//@version=6
indicator("FX & Unsupported")
direct = request.currency_rate(currency.EUR, currency.USD)
inv = request.currency_rate("USD", "EUR")
same = request.currency_rate("TRY", "TRY")
miss = request.currency_rate("JPY", "CHF")
fin = request.financial("AAPL", "TOTAL_REVENUE", "FQ")
qd = request.quandl("FRED/GDP", barmerge.gaps_off, 0)
eco = request.economic("US", "GDP")
sd = request.seed("user", "repo", close)
plot(direct, "direct")
plot(inv, "inv")
plot(same, "same")
plot(miss, "miss")
plot(fin, "fin")
plot(qd, "qd")
plot(eco, "eco")
plot(sd, "sd")
`;
    const r = run(code, daily, {
      symbol: 'AAPL',
      timeframe: 'D',
      currencyRates: { 'EUR/USD': fxRates },
    });
    expect(r.ok).toBe(true);
    expect(lastPlot(r, 0)).toBeCloseTo(1.12, 6);
    expect(lastPlot(r, 1)).toBeCloseTo(1 / 1.12, 6);
    expect(lastPlot(r, 2)).toBe(1.0);
    // All missing/unsupported feeds return honest na (no plot points) + warnings
    for (const idx of [3, 4, 5, 6, 7]) expect(r.plots[idx].data).toHaveLength(0);
    expect(r.warnings?.some((w) => w.includes('currency_rate'))).toBe(true);
    expect(r.warnings?.some((w) => w.includes('request.financial'))).toBe(true);
    expect(r.warnings?.some((w) => w.includes('request.quandl'))).toBe(true);
    expect(r.warnings?.some((w) => w.includes('request.economic'))).toBe(true);
    expect(r.warnings?.some((w) => w.includes('request.seed'))).toBe(true);
  });
});

describe('Faz 18G: input.* complete metadata, types, clamping, source override & cache key', () => {
  const bars = makeCandles(15);

  it('captures all 14 input types, group/inline/tooltip/confirm/display/active and applies overrides', () => {
    const code = `//@version=6
indicator("All Inputs", overlay=true)
enum MaType
    sma = "SMA"
    ema = "EMA"

en = input.bool(true, "Aktif", group="Genel", inline="r1", tooltip="Filtreyi aç")
len = input.int(14, "Uzunluk", minval=2, maxval=50, step=1, group="Genel", inline="r1", active=en, display=display.all)
mult = input.float(2.0, "Çarpan", minval=0.5, maxval=5.0, step=0.5, group="Genel", active=en)
src = input.source(close, "Kaynak", group="Veri")
lbl = input.string("TV", "Etiket", options=["TV", "PRO"], group="Veri")
col = input.color(color.blue, "Renk", group="Stil")
sym = input.symbol("THYAO.IS", "Sembol", group="Veri")
tf = input.timeframe("60", "Zaman Dilimi", group="Veri")
ses = input.session("0930-1800", "Seans", group="Veri")
tm = input.time(1700000000000, "Başlangıç", confirm=true, group="Grafik")
pr = input.price(105.5, "Seviye", confirm=true, group="Grafik")
note = input.text_area("Not", "Açıklama", group="Notlar")
mtype = input.enum(MaType.ema, "Tip", group="Genel")
rawIn = input(7, "Kısa")
plot(len, "len")
plot(src, "src")
plot(pr, "pr")
plot(rawIn, "raw")
`;
    const r = run(code, bars, {
      inputOverrides: {
        Uzunluk: 999, // clamped to maxval=50
        Kaynak: 'hl2',
        Seviye: 123.45,
      },
    });
    expect(r.ok).toBe(true);
    expect(r.inputs).toHaveLength(14);
    const lenDef = r.inputs!.find((d) => d.title === 'Uzunluk')!;
    expect(lenDef).toMatchObject({
      type: 'int',
      group: 'Genel',
      inline: 'r1',
      active: true,
      min: 2,
      max: 50,
      value: 50,
    });
    const tmDef = r.inputs!.find((d) => d.title === 'Başlangıç')!;
    expect(tmDef.confirm).toBe(true);
    const enDef = r.inputs!.find((d) => d.title === 'Aktif')!;
    expect(enDef.tooltip).toBe('Filtreyi aç');

    expect(lastPlot(r, 0)).toBe(50);
    const lastBar = bars[bars.length - 1];
    expect(lastPlot(r, 1)).toBeCloseTo((lastBar.high + lastBar.low) / 2, 6);
    expect(lastPlot(r, 2)).toBeCloseTo(123.45, 6);
    expect(lastPlot(r, 3)).toBe(7);

    // Cache key distinguishes overrides and libraries
    const k1 = scriptCacheKey(code, bars, { inputOverrides: { Uzunluk: 14 } });
    const k2 = scriptCacheKey(code, bars, { inputOverrides: { Uzunluk: 20 } });
    const k3 = scriptCacheKey(code, bars, { libraries: { 'local/A/1': 'library("A")' } });
    expect(k1).not.toBe(k2);
    expect(k1).not.toBe(k3);
  });
});

describe('Faz 18H: §4 missing ta.* golden-value tests (TitanScript math)', () => {
  const bars = makeCandles(40);

  it('ta.alma matches exact Gaussian-weighted moving average formula (floor=false & floor=true)', () => {
    const code = `//@version=6
indicator("ALMA")
plot(ta.alma(close, 9, 0.85, 6), "def")
plot(ta.alma(close, 9, 0.85, 6, true), "flr")
`;
    const r = run(code, bars);
    expect(r.ok).toBe(true);
    const calcAlma = (floorFlag: boolean) => {
      const len = 9;
      const m = floorFlag ? Math.floor(0.85 * (len - 1)) : 0.85 * (len - 1);
      const s = len / 6;
      const slice = bars.slice(bars.length - len).map((b) => b.close);
      let num = 0;
      let den = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.exp(-((i - m) * (i - m)) / (2 * s * s));
        num += w * slice[i];
        den += w;
      }
      return num / den;
    };
    expect(lastPlot(r, 0)).toBeCloseTo(calcAlma(false), 6);
    expect(lastPlot(r, 1)).toBeCloseTo(calcAlma(true), 6);
  });

  it('ta.wpr, ta.tsi (-1..+1), ta.kcw, ta.cog, ta.max, ta.min match exact Standart formulas', () => {
    const code = `//@version=6
indicator("TA Core")
plot(ta.wpr(14), "wpr")
plot(ta.tsi(close, 5, 13), "tsi")
plot(ta.kcw(close, 10, 1.5), "kcw")
plot(ta.cog(close, 5), "cog")
plot(ta.max(close), "allMax")
plot(ta.min(close), "allMin")
`;
    const r = run(code, bars);
    expect(r.ok).toBe(true);
    // WPR(14) on last bar
    const w14 = bars.slice(-14);
    const hh = Math.max(...w14.map((b) => b.high));
    const ll = Math.min(...w14.map((b) => b.low));
    const expectedWpr = (-100 * (hh - bars[bars.length - 1].close)) / (hh - ll);
    expect(lastPlot(r, 0)).toBeCloseTo(expectedWpr, 6);

    // TSI in [-1, 1]
    const tsi = lastPlot(r, 1)!;
    expect(tsi).toBeGreaterThanOrEqual(-1);
    expect(tsi).toBeLessThanOrEqual(1);

    // KCW > 0
    expect(lastPlot(r, 2)!).toBeGreaterThan(0);

    // COG(close, 5) = -sum((i+1)*close[i]) / sum(close[i]) for i=0..4 (0 is current)
    let cogNum = 0;
    let cogDen = 0;
    for (let i = 0; i < 5; i++) {
      const v = bars[bars.length - 1 - i].close;
      cogNum += (i + 1) * v;
      cogDen += v;
    }
    expect(lastPlot(r, 3)).toBeCloseTo(-cogNum / cogDen, 6);

    // ta.max / ta.min all-time close
    expect(lastPlot(r, 4)).toBeCloseTo(Math.max(...bars.map((b) => b.close)), 6);
    expect(lastPlot(r, 5)).toBeCloseTo(Math.min(...bars.map((b) => b.close)), 6);
  });

  it('ta.sar tracks rising uptrend below lows and flips above highs on reversal', () => {
    const trend: Candle[] = Array.from({ length: 20 }, (_, i) => {
      const p = i < 10 ? 100 + i * 3 : 127 - (i - 10) * 4;
      return { time: 1_700_000_000 + i * 900, open: p, high: p + 1, low: p - 1, close: p, volume: 1000 };
    });
    const r = run(`//@version=6\nindicator("SAR")\nplot(ta.sar(0.02, 0.02, 0.2))`, trend);
    expect(r.ok).toBe(true);
    const pts = r.plots[0].data;
    // Bar 0 is na (Wilder SAR starts at bar 1 after determining initial direction)
    expect(pts.length).toBe(19);
    // During uptrend (bar 8 -> pts[7]), SAR sits below bar low
    expect(pts[7].value).toBeLessThan(trend[8].low);
    // After sustained downtrend (bar 18 -> pts[17]), SAR flips above bar high
    expect(pts[17].value).toBeGreaterThan(trend[18].high);
  });

  it('OHLCV built-in series ta.pvt, ta.accdist, ta.iii, ta.nvi, ta.pvi, ta.wad, ta.wvad and [1] history', () => {
    const seq: Candle[] = [
      { time: 1000, open: 10, high: 12, low: 8, close: 11, volume: 100 },
      { time: 1900, open: 11, high: 14, low: 10, close: 13, volume: 150 }, // vol up -> PVI moves, NVI flat
      { time: 2800, open: 13, high: 15, low: 11, close: 12, volume: 90 },  // vol down -> NVI moves, PVI flat
    ];
    const code = `//@version=6
indicator("VolSeries")
plot(ta.pvt, "pvt")
plot(ta.accdist, "accdist")
plot(ta.iii, "iii")
plot(ta.nvi, "nvi")
plot(ta.pvi, "pvi")
plot(ta.wad, "wad")
plot(ta.wvad, "wvad")
plot(ta.nvi[1], "nviPrev")
`;
    const r = run(code, seq);
    expect(r.ok).toBe(true);
    // PVT: bar0=0, bar1=(13-11)/11*150, bar2 += (12-13)/13*90
    const expPvt = ((13 - 11) / 11) * 150 + ((12 - 13) / 13) * 90;
    expect(lastPlot(r, 0)).toBeCloseTo(expPvt, 6);
    // ACCDIST: bar0=((11-8)-(12-11))/(12-8)*100=50, bar1=((13-10)-(14-13))/4*150=75, bar2=((12-11)-(15-12))/4*90=-45 -> sum=80
    expect(lastPlot(r, 1)).toBeCloseTo(80, 6);
    // III bar2: (2*12 - 15 - 11) / ((15-11)*90) = -2 / 360
    expect(lastPlot(r, 2)).toBeCloseTo(-2 / 360, 6);
    // NVI: bar0=1, bar1=1 (vol up), bar2=1 + (12-13)/13
    expect(lastPlot(r, 3)).toBeCloseTo(1 + (12 - 13) / 13, 6);
    // PVI: bar0=1, bar1=1 + (13-11)/11, bar2 unchanged (vol down)
    expect(lastPlot(r, 4)).toBeCloseTo(1 + (13 - 11) / 11, 6);
    // WAD: bar0=0, bar1=(13>11 ? 13-min(10,11)=3), bar2=(12<13 ? 12-max(15,13)=-3) -> sum=0
    expect(lastPlot(r, 5)).toBeCloseTo(0, 6);
    // WVAD bar2: ((12-13)/(15-11))*90 = -22.5
    expect(lastPlot(r, 6)).toBeCloseTo(-22.5, 6);
    // Historical indexing ta.nvi[1] == 1.0
    expect(lastPlot(r, 7)).toBeCloseTo(1.0, 6);
  });

  it('ta.percentrank, percentile_linear_interpolation, percentile_nearest_rank, correlation, mode (tie->smallest), rci', () => {
    // 6 bars with known closes: [10, 20, 20, 30, 30, 25]
    const closes = [10, 20, 20, 30, 30, 25];
    const seq: Candle[] = closes.map((c, i) => ({
      time: 1000 + i * 900,
      open: c,
      high: c * 2, // perfectly correlated with close
      low: 100 - c, // perfectly negatively correlated with close
      close: c,
      volume: 100,
    }));
    const code = `//@version=6
indicator("Stats")
plot(ta.percentrank(close, 5), "prank")
plot(ta.percentile_linear_interpolation(close, 5, 50), "plin")
plot(ta.percentile_nearest_rank(close, 5, 80), "pnr")
plot(ta.correlation(close, high, 5), "corrPos")
plot(ta.correlation(close, low, 5), "corrNeg")
plot(ta.mode(close, 5), "mode")
`;
    const r = run(code, seq);
    expect(r.ok).toBe(true);
    // percentrank(25, prev 5 = [10,20,20,30,30]): 3 of 5 are <= 25 -> 60%
    expect(lastPlot(r, 0)).toBeCloseTo(60, 6);
    // last 5 sorted = [20, 20, 25, 30, 30]: 50th percentile = 25
    expect(lastPlot(r, 1)).toBeCloseTo(25, 6);
    // nearest rank 80% of 5 = ceil(4) = 4th (1-based) = 30
    expect(lastPlot(r, 2)).toBeCloseTo(30, 6);
    expect(lastPlot(r, 3)).toBeCloseTo(1.0, 6);
    expect(lastPlot(r, 4)).toBeCloseTo(-1.0, 6);
    // mode([20,20,30,30,25]): tie between 20 and 30 -> Standart returns smallest (20)
    expect(lastPlot(r, 5)).toBeCloseTo(20, 6);

    // RCI: strictly rising -> +100, strictly falling -> -100
    const up = Array.from({ length: 6 }, (_, i) => ({
      time: 1000 + i * 900,
      open: i,
      high: i + 1,
      low: i,
      close: 10 + i * 2,
      volume: 100,
    }));
    const down = up.map((c, i) => ({ ...c, close: 30 - i * 2 }));
    const rUp = run(`//@version=6\nindicator("RCI+")\nplot(ta.rci(close, 5))`, up);
    const rDn = run(`//@version=6\nindicator("RCI-")\nplot(ta.rci(close, 5))`, down);
    expect(lastPlot(rUp, 0)).toBeCloseTo(100, 5);
    expect(lastPlot(rDn, 0)).toBeCloseTo(-100, 5);
  });

  it('ta.pivot_point_levels computes all 6 Standart pivot types + developing mode', () => {
    // Anchor on bar 3: prior period bars 0..2 have H=120, L=100, C=110, O=105
    const seq: Candle[] = [
      { time: 1000, open: 105, high: 112, low: 100, close: 108, volume: 100 },
      { time: 1900, open: 108, high: 120, low: 104, close: 115, volume: 100 },
      { time: 2800, open: 115, high: 118, low: 106, close: 110, volume: 100 },
      { time: 3700, open: 112, high: 116, low: 109, close: 114, volume: 100 },
      { time: 4600, open: 114, high: 117, low: 111, close: 115, volume: 100 },
    ];
    const code = `//@version=6
indicator("Pivots")
anc = bar_index == 3
trad = ta.pivot_point_levels("Traditional", anc)
fib  = ta.pivot_point_levels("Fibonacci", anc)
wood = ta.pivot_point_levels("Woodie", anc)
clas = ta.pivot_point_levels("Classic", anc)
dm   = ta.pivot_point_levels("DM", anc)
cam  = ta.pivot_point_levels("Camarilla", anc)
dev  = ta.pivot_point_levels("Traditional", anc, true)
plot(array.get(trad, 0), "tradP")
plot(array.get(trad, 1), "tradR1")
plot(array.get(trad, 2), "tradS1")
plot(array.get(fib, 1),  "fibR1")
plot(array.get(wood, 0), "woodP")
plot(array.get(clas, 3), "clasR2")
plot(array.get(dm, 1),   "dmR1")
plot(array.get(cam, 1),  "camR1")
plot(array.size(trad),   "len")
plot(array.get(dev, 0),  "devP")
`;
    const r = run(code, seq);
    expect(r.ok).toBe(true);
    // H=120, L=100, C=110 -> P=110, range=20
    expect(lastPlot(r, 0)).toBeCloseTo(110, 6); // Traditional P
    expect(lastPlot(r, 1)).toBeCloseTo(120, 6); // Traditional R1 = 2*110 - 100
    expect(lastPlot(r, 2)).toBeCloseTo(100, 6); // Traditional S1 = 2*110 - 120
    expect(lastPlot(r, 3)).toBeCloseTo(110 + 0.382 * 20, 6); // Fibonacci R1
    expect(lastPlot(r, 4)).toBeCloseTo((120 + 100 + 2 * 112) / 4, 6); // Woodie P (curOpen=112)
    expect(lastPlot(r, 5)).toBeCloseTo(110 + 20, 6); // Classic R2 = P + (H-L)
    // DM: C=110 > O=105 -> X = 2*H + L + C = 450, P=112.5, R1 = X/2 - L = 125
    expect(lastPlot(r, 6)).toBeCloseTo(125, 6);
    // Camarilla R1 = C + 20 * 1.1 / 12
    expect(lastPlot(r, 7)).toBeCloseTo(110 + (20 * 1.1) / 12, 6);
    expect(lastPlot(r, 8)).toBe(11);
    // developing P on bars 3..4: H=117, L=109, C=115 -> (117+109+115)/3
    expect(lastPlot(r, 9)).toBeCloseTo((117 + 109 + 115) / 3, 6);
  });
});

describe('Faz 18I: str.format, str.match, str.format_time, str.replace vs str.replace_all', () => {
  const bars = makeCandles(5);

  it('evaluates Standart MessageFormat patterns, regex match/na, timezone format_time, and occurrence replace', () => {
    const code = `//@version=6
indicator("Strings")
if barstate.islast
    s1 = str.format("Val={0,number,#.##} Int={1,number,integer} Pct={2,number,percent}", 3.14159, 42.7, 0.256)
    s2 = str.format("Neg={0,number,#,##0.00;(#,##0.00)} Cur={1,number,currency} Esc=''ok'' '{0}'", -1234.5, 99.5)
    s3 = str.format("D={0,date,yyyy-MM-dd} T={0,time,HH:mm:ss}", 1704067200000)
    m1 = str.match("BIST:THYAO.IS", "[A-Z]+\\\\.[A-Z]+")
    m2 = str.match("12345", "[A-Z]+")
    ft = str.format_time(1704067200000, "yyyy-MM-dd HH:mm", "UTC+3")
    r0 = str.replace("a-b-a-b", "a", "X", 0)
    r1 = str.replace("a-b-a-b", "a", "X", 1)
    ra = str.replace_all("a-b-a-b", "a", "X")
    log.info(s1)
    log.info(s2)
    log.info(s3)
    log.info("m1=" + str.tostring(m1) + " m2na=" + str.tostring(na(m2)))
    log.info("ft=" + ft)
    log.info(r0 + "|" + r1 + "|" + ra)
plot(close)
`;
    const r = run(code, bars);
    expect(r.ok).toBe(true);
    const msgs = (r.logs ?? []).map((l) => l.message);
    expect(msgs[0]).toBe('Val=3.14 Int=43 Pct=26%');
    expect(msgs[1]).toBe("Neg=(1,234.50) Cur=$99.50 Esc='ok' {0}");
    expect(msgs[2]).toBe('D=2024-01-01 T=00:00:00');
    expect(msgs[3]).toBe('m1=THYAO.IS m2na=true');
    expect(msgs[4]).toBe('ft=2024-01-01 03:00');
    expect(msgs[5]).toBe('X-b-a-b|a-b-X-b|X-b-X-b');

    // Invalid regex raises clean runtime error
    const badRe = run(`//@version=6\nindicator("BadRe")\nx = str.match("abc", "[unclosed")\nplot(close)`, bars);
    expect(badRe.ok).toBe(false);
  });
});

describe('Faz 18J: Faz 16 derived charts & Faz 17 typecheck preservation', () => {
  it('runs Faz 18 library + chart.point + linefill + log + ta.alma on Renko and Kagi derived bars', () => {
    const raw = makeCandles(80);
    const renko = deriveCandles('renko', raw, { ...DEFAULT_STYLE_PARAMS, renko: { mode: 'fixed', box: 1.5, atrLen: 14 } });
    const kagi = deriveCandles('kagi', raw, { ...DEFAULT_STYLE_PARAMS, kagi: { mode: 'fixed', value: 2, atrLen: 14 } });
    expect(renko.length).toBeGreaterThan(5);
    expect(kagi.length).toBeGreaterThan(3);

    const lib = `//@version=6\nlibrary("DerivedHelper")\nexport spread(float a, float b) => a - b`;
    const script = `//@version=6
indicator("Derived18", overlay=true)
import local/DerivedHelper/1 as dh
a = ta.alma(close, 5, 0.85, 6)
rci = ta.rci(close, 4)
sp = dh.spread(high, low)
if barstate.islast
    p1 = chart.point.from_index(math.max(0, bar_index - 2), high)
    p2 = chart.point.now(high)
    p3 = chart.point.from_index(math.max(0, bar_index - 2), low)
    p4 = chart.point.now(low)
    linefill.new(line.new(p1, p2), line.new(p3, p4), color.new(color.teal, 80))
    log.info("Bars={0} RCI={1,number,0.0}", bar_index + 1, nz(rci))
plot(a, "alma")
plot(sp, "sp")
`;
    const rRenko = run(script, renko, { libraries: { 'local/DerivedHelper/1': lib } });
    const rKagi = run(script, kagi, { libraries: { 'local/DerivedHelper/1': lib } });
    expect(rRenko.ok).toBe(true);
    expect(rRenko.drawings?.linefills).toHaveLength(1);
    expect(rRenko.logs?.[0].message).toContain(`Bars=${renko.length}`);
    expect(rKagi.ok).toBe(true);
    expect(rKagi.drawings?.linefills).toHaveLength(1);
  });
});
