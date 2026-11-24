import { describe, expect, it } from 'vitest';
import type { Candle } from '../../types/market';
import { calcBollingerBands, calcHighest, calcLowest, calcSMA, calcStdev, calcWMA } from '../../indicators/taEngine';
import { tostring } from '../values';
import { chartTimeframeToScript, estimateMintick, executeScript, scriptRunOptions } from '../runtime';

function walk(count: number, seed = 11): Candle[] {
  let s = seed;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  let p = 100;
  const out: Candle[] = [];
  for (let i = 0; i < count; i++) {
    const o = p;
    p = p * (1 + (rnd() - 0.5) * 0.04);
    out.push({
      time: 1_700_000_000 + i * 3600,
      open: o,
      high: Math.max(o, p) * (1 + rnd() * 0.01),
      low: Math.min(o, p) * (1 - rnd() * 0.01),
      close: p,
      volume: 1000 + Math.floor(rnd() * 5000),
    });
  }
  return out;
}

function vals(res: ReturnType<typeof executeScript>, idx = 0): number[] {
  return res.plots[idx].data.map((d) => d.value);
}

function run(body: string, candles = walk(40)) {
  const res = executeScript(`//@version=5\nindicator("t", overlay=true)\n${body}`, candles);
  expect(res.error).toBeUndefined();
  return res;
}

describe('runtime — per-bar state', () => {
  it('var is initialised once and persists; plain variables recompute every bar', () => {
    const r = run(`var int cnt = 0
cnt += 1
var float first = bar_index
plot(cnt, title="cnt")
plot(first, title="first")
plot(bar_index * 2, title="plain")`);
    expect(vals(r, 0)).toEqual(Array.from({ length: 40 }, (_, i) => i + 1));
    expect(new Set(vals(r, 1))).toEqual(new Set([0]));
    expect(vals(r, 2)[5]).toBe(10);
  });

  it('series history of user variables, expressions and calls', () => {
    const r = run(`a = bar_index * 3
plot(a[1], title="a1")
plot((a + 1)[2], title="e2")
plot(ta.sma(close, 3)[1], title="s1")`);
    const a1 = vals(r, 0);
    expect(a1[0]).toBe(0); // bar 1 -> a[1] = 0
    expect(a1[4]).toBe(12); // bar 5 -> 3*4
    expect(vals(r, 1)[0]).toBe(1); // bar 2 -> (a+1)[2] = 0+1
    const c = walk(40);
    const sma3 = calcSMA(c.map((x) => x.close), 3);
    expect(vals(r, 2)[0]).toBeCloseTo(sma3[2], 8); // first non-na of sma[1] lands on bar 3
  });

  it('for / while / break / continue / for-in / compound assignment', () => {
    const r = run(`float s = 0.0
for i = 0 to 9
    if i == 3
        continue
    if i == 7
        break
    s += i
int w = 0
int k = 0
while k < 5
    w += k
    k += 1
arr = array.new_float()
array.push(arr, 2.0)
arr.push(5.0)
float t = 0.0
for v in arr
    t += v
plot(s, title="s")
plot(w, title="w")
plot(t, title="t")
plot(array.size(arr), title="n")`);
    expect(vals(r, 0)[3]).toBe(0 + 1 + 2 + 4 + 5 + 6); // 18
    expect(vals(r, 1)[3]).toBe(10);
    expect(vals(r, 2)[3]).toBe(7);
    expect(vals(r, 3)[3]).toBe(2);
  });

  it('user functions: expression + block bodies, own ta state per call site, tuples', () => {
    const r = run(`avg3(x) => ta.sma(x, 3)
span(a, b) =>
    hi = math.max(a, b)
    lo = math.min(a, b)
    [hi, lo]
f1 = avg3(close)
f2 = avg3(open)
[h, l] = span(high, low)
plot(f1, title="f1")
plot(f2, title="f2")
plot(h - l, title="rng")`);
    const c = walk(40);
    expect(vals(r, 0)[0]).toBeCloseTo(calcSMA(c.map((x) => x.close), 3)[2], 8);
    expect(vals(r, 1)[0]).toBeCloseTo(calcSMA(c.map((x) => x.open), 3)[2], 8);
    expect(vals(r, 2)[5]).toBeCloseTo(c[5].high - c[5].low, 8);
  });

  it('functions can read script-level variables', () => {
    const r = run(`mult = 3.0
scale(x) => x * mult
plot(scale(close), title="x")`);
    expect(vals(r)[0]).toBeCloseTo(walk(40)[0].close * 3, 8);
  });

  it('switch / if as expressions', () => {
    const r = run(`mode = bar_index % 3
v = switch mode
    0 => 10
    1 => 20
    => 30
w = if bar_index > 5
    1
else
    2
plot(v, title="v")
plot(w, title="w")`);
    expect(vals(r, 0).slice(0, 4)).toEqual([10, 20, 30, 10]);
    expect(vals(r, 1)[2]).toBe(2);
    expect(vals(r, 1)[8]).toBe(1);
  });

  it('v6 short-circuits and/or, v5 evaluates both sides', () => {
    const src = (v: number) => `//@version=${v}
indicator("t")
var int calls = 0
f() =>
    calls := calls + 1
    true
x = false and f()
plot(calls)`;
    expect(vals(executeScript(src(6), walk(10)))[9]).toBe(0);
    expect(vals(executeScript(src(5), walk(10)))[9]).toBe(10);
  });

  it('na semantics: comparisons with na are false, nz/na()/arith propagate', () => {
    const r = run(`x = na
plot(x == 1 ? 1 : 0, title="a")
plot(na(x) ? 1 : 0, title="b")
plot(nz(x, 7), title="c")
plot(x + 1, title="d")`);
    expect(vals(r, 0)[0]).toBe(0);
    expect(vals(r, 1)[0]).toBe(1);
    expect(vals(r, 2)[0]).toBe(7);
    expect(r.plots[3].data.length).toBe(0);
  });
});

describe('runtime — ta.* match reference implementations', () => {
  const candles = walk(120);
  const close = candles.map((c) => c.close);

  const refEma = (src: number[], len: number) => {
    const out = new Array(src.length).fill(NaN);
    const a = 2 / (len + 1);
    for (let i = len - 1; i < src.length; i++) {
      if (i === len - 1) out[i] = src.slice(0, len).reduce((x, y) => x + y, 0) / len;
      else out[i] = a * src[i] + (1 - a) * out[i - 1];
    }
    return out;
  };
  const refRma = (src: number[], len: number) => {
    const out = new Array(src.length).fill(NaN);
    for (let i = len - 1; i < src.length; i++) {
      if (i === len - 1) out[i] = src.slice(0, len).reduce((x, y) => x + y, 0) / len;
      else out[i] = (src[i] + (len - 1) * out[i - 1]) / len;
    }
    return out;
  };

  function plotOf(code: string, idx = 0): { time: number; value: number }[] {
    const r = executeScript(`//@version=5\nindicator("t", overlay=true)\n${code}`, candles);
    expect(r.error).toBeUndefined();
    return r.plots[idx].data;
  }

  function expectSeries(got: { time: number; value: number }[], ref: number[]) {
    const first = ref.findIndex((v) => !Number.isNaN(v));
    expect(got.length).toBe(ref.length - first);
    got.forEach((p, i) => expect(p.value).toBeCloseTo(ref[first + i], 6));
  }

  it('sma / wma / stdev / highest / lowest equal the batch engine', () => {
    expectSeries(plotOf('plot(ta.sma(close, 10))'), calcSMA(close, 10));
    expectSeries(plotOf('plot(ta.wma(close, 7))'), calcWMA(close, 7));
    expectSeries(plotOf('plot(ta.stdev(close, 12))'), calcStdev(close, 12));
    expectSeries(plotOf('plot(ta.highest(high, 9))'), calcHighest(candles.map((c) => c.high), 9));
    expectSeries(plotOf('plot(ta.lowest(low, 9))'), calcLowest(candles.map((c) => c.low), 9));
  });

  it('ema / rma are SMA-seeded (TitanScript definition)', () => {
    expectSeries(plotOf('plot(ta.ema(close, 10))'), refEma(close, 10));
    expectSeries(plotOf('plot(ta.rma(close, 10))'), refRma(close, 10));
  });

  it('rsi matches the TitanScript RMA definition', () => {
    const up = close.map((c, i) => (i ? Math.max(c - close[i - 1], 0) : NaN));
    const dn = close.map((c, i) => (i ? Math.max(close[i - 1] - c, 0) : NaN));
    const ru = refRma(up.slice(1), 14);
    const rd = refRma(dn.slice(1), 14);
    const ref = [NaN, ...ru.map((u, i) => 100 - 100 / (1 + u / rd[i]))];
    expectSeries(plotOf('plot(ta.rsi(close, 14))'), ref);
  });

  it('atr = rma(tr)', () => {
    const tr = candles.map((c, i) =>
      i ? Math.max(c.high - c.low, Math.abs(c.high - close[i - 1]), Math.abs(c.low - close[i - 1])) : c.high - c.low
    );
    expectSeries(plotOf('plot(ta.atr(14))'), refRma(tr, 14));
  });

  it('bb / macd tuples', () => {
    const ref = calcBollingerBands(close, 20, 2);
    expectSeries(plotOf('[m, u, l] = ta.bb(close, 20, 2)\nplot(u)'), ref.upper);
    const fast = refEma(close, 12);
    const slow = refEma(close, 26);
    const macd = close.map((_, i) => fast[i] - slow[i]);
    const sig = new Array(close.length).fill(NaN);
    const a = 2 / 10;
    const start = macd.findIndex((v) => !Number.isNaN(v));
    for (let i = start + 8; i < close.length; i++) {
      sig[i] =
        i === start + 8
          ? macd.slice(start, start + 9).reduce((x, y) => x + y, 0) / 9
          : a * macd[i] + (1 - a) * sig[i - 1];
    }
    expectSeries(plotOf('[m, s, h] = ta.macd(close, 12, 26, 9)\nplot(s)'), sig);
  });

  it('crossover / change / cum / barssince / valuewhen / pivothigh', () => {
    const r = executeScript(
      `//@version=5
indicator("t", overlay=true)
up = ta.crossover(close, ta.sma(close, 5))
plot(up ? 1 : 0, title="up")
plot(ta.change(close), title="chg")
plot(ta.cum(1), title="cum")
plot(ta.barssince(up), title="since")
plot(ta.valuewhen(up, close, 0), title="vw")
plot(ta.pivothigh(high, 3, 3), title="pv")`,
      candles
    );
    expect(r.error).toBeUndefined();
    const sma5 = calcSMA(close, 5);
    const ups = close.map((c, i) => i >= 5 && c > sma5[i] && close[i - 1] <= sma5[i - 1]);
    const upPlot = r.plots[0].data.map((d) => d.value === 1);
    expect(upPlot.slice(5)).toEqual(ups.slice(5));
    expect(r.plots[1].data[0].value).toBeCloseTo(close[1] - close[0], 8);
    expect(r.plots[2].data[9].value).toBe(10);
    const firstUp = ups.findIndex(Boolean);
    const since = r.plots[3].data.find((d) => d.time === candles[firstUp + 2].time)!;
    expect(since.value).toBe(2);
    // pivot is reported `right` bars late, at the right price
    const highs = candles.map((c) => c.high);
    for (const pt of r.plots[5].data) {
      const bar = candles.findIndex((c) => c.time === pt.time);
      const center = highs[bar - 3];
      expect(pt.value).toBe(Number(center.toPrecision(12)));
      for (let k = 1; k <= 3; k++) {
        expect(highs[bar - 3 - k]).toBeLessThan(center);
        expect(highs[bar - 3 + k]).toBeLessThanOrEqual(center);
      }
    }
    expect(r.plots[5].data.length).toBeGreaterThan(0);
  });

  it('supertrend direction: -1 while price is above the line', () => {
    const r = executeScript(
      `//@version=5
indicator("t", overlay=true)
[st, dir] = ta.supertrend(3.0, 10)
plot(st, title="st")
plot(dir, title="dir")`,
      walk(300, 3)
    );
    expect(r.error).toBeUndefined();
    const dirs = r.plots[1].data;
    const closes = walk(300, 3).map((c) => c.close);
    r.plots[0].data.forEach((p, i) => {
      const bar = walk(300, 3).findIndex((c) => c.time === p.time);
      if (dirs[i].value === -1) expect(p.value).toBeLessThanOrEqual(closes[bar] + 1e-9);
      else expect(p.value).toBeGreaterThanOrEqual(closes[bar] - 1e-9);
    });
    expect(new Set(dirs.map((d) => d.value)).size).toBe(2);
  });
});

describe('runtime — request.security (HTF)', () => {
  it('daily close on 1h chart equals the completed day aggregate at day end', () => {
    const c = walk(24 * 6);
    // align to UTC midnight
    const base = Math.floor(c[0].time / 86400) * 86400;
    c.forEach((x, i) => (x.time = base + i * 3600));
    const r = executeScript(
      `//@version=5
indicator("t", overlay=true)
d = request.security(syminfo.tickerid, "D", close)
dh = request.security(syminfo.tickerid, "D", high)
plot(d, title="d")
plot(dh, title="dh")`,
      c,
      { timeframe: '60' }
    );
    expect(r.error).toBeUndefined();
    const d = r.plots[0].data;
    // last bar of day 2 (index 47): value == close of that bar (completed)
    expect(d.find((p) => p.time === c[47].time)!.value).toBeCloseTo(c[47].close, 8);
    // mid-day bars show previous completed day's close (no repaint)
    expect(d.find((p) => p.time === c[30].time)!.value).toBeCloseTo(c[23].close, 8);
    const dayHigh = Math.max(...c.slice(24, 48).map((x) => x.high));
    expect(r.plots[1].data.find((p) => p.time === c[47].time)!.value).toBeCloseTo(dayHigh, 8);
    expect(r.warnings!.join(' ')).toMatch(/HTF/);
  });

  it('other symbols / lower timeframes return na with a warning (never fake data)', () => {
    const r = executeScript(
      `//@version=5
indicator("t")
x = request.security("NASDAQ:AAPL", "D", close)
plot(x)`,
      walk(30),
      { symbol: 'BINANCE:BTCUSDT', timeframe: '60' }
    );
    expect(r.error).toBeUndefined();
    expect(r.plots[0].data.length).toBe(0);
    expect(r.warnings!.join(' ')).toMatch(/başka sembol/);
  });
});

describe('runtime — honesty & safety', () => {
  it('undefined variables and unsupported functions are errors, not silent NaN', () => {
    const a = executeScript('//@version=5\nindicator("t")\nplot(nope)', walk(5));
    expect(a.ok).toBe(false);
    expect(a.error).toMatch(/Tanımsız değişken 'nope'/);
    expect(a.error).toMatch(/Satır 3/);
    const b = executeScript('//@version=5\nindicator("t")\nplot(ta.nonsense(close, 3))', walk(5));
    expect(b.ok).toBe(false);
    expect(b.error).toMatch(/Desteklenmeyen fonksiyon/);
  });

  it('infinite loops are stopped', () => {
    const r = executeScript('//@version=5\nindicator("t")\nwhile true\n    x = 1\nplot(1)', walk(5));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/işlem sınırı/);
  });

  it('strategy functions inside an indicator are rejected', () => {
    const r = executeScript('//@version=5\nindicator("t")\nstrategy.entry("x", strategy.long)', walk(5));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/strategy\(\) betiğinde/);
  });

  it('inputs are listed and can be overridden by title', () => {
    const code = `//@version=5
indicator("t")
len = input.int(5, "Length", minval=1, maxval=50)
plot(len, title="len")`;
    const r = executeScript(code, walk(5));
    expect(r.inputs).toEqual([{ title: 'Length', type: 'int', defval: 5, min: 1, max: 50 }]);
    expect(vals(r)[0]).toBe(5);
    const o = executeScript(code, walk(5), { inputOverrides: { Length: 9 } });
    expect(vals(o)[0]).toBe(9);
  });

  it('plot display=none / data_window is not drawn; per-bar colors are kept', () => {
    const r = run(`plot(close, title="hidden", display=display.none)
plot(close, title="dw", display=display.data_window)
plot(close, title="shown", color = close > open ? color.green : color.red)`);
    expect(r.plots.map((p) => p.title)).toEqual(['shown']);
    const colors = new Set(r.plots[0].data.map((d) => d.color));
    expect(colors.size).toBeGreaterThan(0);
  });

  it('plotshape makes markers; label/line are resolved into drawings (no "not drawn" warning)', () => {
    const r = run(`plotshape(close > open, style=shape.triangleup, location=location.belowbar, text="U")
if bar_index == 10
    label.new(bar_index, high, "hello", style=label.style_label_down)
    line.new(bar_index, low, bar_index + 3, low)`);
    expect(r.markers.some((m) => m.text === 'U' && m.shape === 'arrowUp' && m.position === 'belowBar')).toBe(true);
    expect(r.drawings!.labels).toHaveLength(1);
    expect(r.drawings!.labels[0]).toMatchObject({ text: 'hello', style: 'label_down', yloc: 'price' });
    expect(r.drawings!.lines).toHaveLength(1);
    expect(r.drawings!.lines[0].t2).toBeGreaterThan(r.drawings!.lines[0].t1);
    expect((r.warnings ?? []).join(' ')).not.toMatch(/henüz çizilmiyor/);
  });

  it('alerts only fire on the live (last) bar', () => {
    const r = run(`alert("go")`);
    expect(r.alerts!.length).toBe(1);
    expect(r.alerts![0].message).toBe('go');
  });
});

describe('runtime — chart integration helpers', () => {
  it('maps chart intervals to TitanScript timeframes and exposes them to the script', () => {
    expect(['1m', '15m', '1h', '4h', '1d', '1w'].map(chartTimeframeToScript)).toEqual(['1', '15', '60', '240', 'D', 'W']);
    const c = walk(30);
    const opts = scriptRunOptions('BIST:THYAO', '1h', c);
    const r = executeScript(
      `//@version=5
indicator("t")
plot(timeframe.in_seconds(), title="sec")
plot(syminfo.ticker == "THYAO" ? 1 : 0, title="tick")
plot(timeframe.isintraday ? 1 : 0, title="intra")`,
      c,
      opts
    );
    expect(r.error).toBeUndefined();
    expect(vals(r, 0)[0]).toBe(3600);
    expect(vals(r, 1)[0]).toBe(1);
    expect(vals(r, 2)[0]).toBe(1);
  });

  it('estimates mintick from the decimals the data uses', () => {
    const mk = (v: number): Candle[] => [{ time: 1, open: v, high: v, low: v, close: v, volume: 1 }];
    expect(estimateMintick(mk(123.45))).toBeCloseTo(0.01, 10);
    expect(estimateMintick(mk(0.00012345))).toBeCloseTo(1e-8, 12);
    expect(estimateMintick(mk(250))).toBe(1);
  });

  it('str.tostring(x, format.mintick) rounds to the symbol tick like Standart (8.11 bug)', () => {
    expect(tostring(1.7253823898, 'format.mintick', 0.01)).toBe('1.73');
    expect(tostring(21.5458071919, 'format.price', 0.01)).toBe('21.55');
    expect(tostring(1.7, 'format.mintick', 0.01)).toBe('1.70');
    expect(tostring(101.13, 'format.mintick', 0.25)).toBe('101.25');
    expect(tostring(64012.7, 'format.mintick', 1)).toBe('64013');
    const r = executeScript(
      `//@version=5\nindicator("t", overlay=true)\nvar t = table.new(position.top_right, 1, 1)\nif barstate.islast\n    table.cell(t, 0, 0, "~" + str.tostring(close * 1.0000123, format.mintick) + " yol")\nplot(close)`,
      walk(30),
      { mintick: 0.01 },
    );
    expect(r.error).toBeUndefined();
    const txt = r.drawings!.tables[0].cells[0].text;
    expect(txt).toMatch(/^~\d+\.\d{2} yol$/);
  });
});
