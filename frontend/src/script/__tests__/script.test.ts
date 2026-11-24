import { describe, expect, it } from 'vitest';
import type { Candle } from '../../types/market';
import { BUILTIN_SCRIPT_PRESETS } from '../presets';
import {
  executeScript,
  parse,
  ScriptParseError,
  tokenize,
} from '../runtime';

function generateOscillatingCandles(count = 140): Candle[] {
  const out: Candle[] = [];
  for (let i = 0; i < count; i++) {
    const wave = Math.sin(i * 0.22) * 15 + Math.cos(i * 0.08) * 8;
    const price = 250 + wave;
    out.push({
      time: 1731000000 + i * 3600,
      open: Number((price - 1.2).toFixed(2)),
      high: Number((price + 2.5).toFixed(2)),
      low: Number((price - 2.4).toFixed(2)),
      close: Number((price + 1.1).toFixed(2)),
      volume: 50000 + i * 200,
    });
  }
  return out;
}

describe('TitanScript — Lexer & Tokenizer', () => {
  it('tokenizes TitanScript keywords, operators, directives, numbers and strings', () => {
    const code = `//@version=5
indicator("My Script", overlay=true)
var float x = 12.50
x := x + 1.5
if x > 10 and true
    plot(close, color=color.aqua)
`;
    const tokens = tokenize(code);
    expect(tokens.length).toBeGreaterThan(0);

    const directive = tokens.find((t) => t.type === 'DIRECTIVE');
    expect(directive).toBeDefined();
    expect(directive!.value).toBe('5');

    const indKw = tokens.find((t) => t.type === 'KEYWORD' && t.value === 'indicator');
    expect(indKw).toBeDefined();

    const reassignTok = tokens.find((t) => t.type === 'REASSIGN');
    expect(reassignTok).toBeDefined();

    const indentTok = tokens.find((t) => t.type === 'INDENT');
    expect(indentTok).toBeDefined();
  });
});

describe('TitanScript — Parser & Syntax Error Reporting', () => {
  it('parses declarations, tuple assignments, and expressions into AST', () => {
    const code = `//@version=5
strategy("Test Strategy", overlay=true, initial_capital=50000, commission_value=0.05)
[m, s, h] = ta.macd(close, 12, 26, 9)
fast = ta.ema(close, 9)
slow = ta.ema(close, 21)
cond = ta.crossover(fast, slow)
if cond
    strategy.entry("Long", strategy.long)
plot(fast, color=color.blue)
`;
    const tokens = tokenize(code);
    const ast = parse(tokens);

    expect(ast.type).toBe('Program');
    expect(ast.version).toBe(5);
    expect(ast.statements.length).toBeGreaterThan(4);

    const decl = ast.statements[0];
    expect(decl.type).toBe('Declaration');
    if (decl.type === 'Declaration') {
      expect(decl.kind).toBe('strategy');
      expect(decl.title).toBe('Test Strategy');
      expect(decl.options['initial_capital']).toBe(50000);
    }

    const tupleStmt = ast.statements[1];
    expect(tupleStmt.type).toBe('TupleAssign');
    if (tupleStmt.type === 'TupleAssign') {
      expect(tupleStmt.names).toEqual(['m', 's', 'h']);
    }
  });

  it('reports syntax errors with line number and clear Turkish error message', () => {
    const invalidCode = `//@version=5
indicator("Broken Script")
val = 10 +
`;
    const tokens = tokenize(invalidCode);
    expect(() => parse(tokens)).toThrow(ScriptParseError);

    const res = executeScript(invalidCode, generateOscillatingCandles(20));
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/Satır \d+/);
    expect(res.error).toMatch(/Beklenmeyen token/);
  });
});

describe('TitanScript — Series Arithmetic, Indexing & Logic Operators', () => {
  it('correctly computes historical series indexing (close[1], high[2]) and binary operations', () => {
    const candles = generateOscillatingCandles(50);
    const code = `//@version=5
indicator("Series Test", overlay=true)
prevClose = close[1]
diff = close - prevClose
isUp = close > prevClose and high >= high[1]
ternaryVal = isUp ? 100 : 50
plot(diff, title="Diff")
plot(ternaryVal, title="Ternary")
`;
    const res = executeScript(code, candles);
    expect(res.ok).toBe(true);
    expect(res.plots.length).toBe(2);

    const diffPlot = res.plots[0];
    // First bar should be NaN due to close[1]
    expect(diffPlot.data.length).toBe(49);
    const expectedDiff = Number((candles[1].close - candles[0].close).toFixed(4));
    expect(diffPlot.data[0].value).toBeCloseTo(expectedDiff, 2);
  });

  it('supports built-in OHLCV variables, hl2, hlc3, ohlc4, bar_index and time', () => {
    const candles = generateOscillatingCandles(30);
    const code = `//@version=5
indicator("Builtin Vars", overlay=true)
hl2Series = hl2
hlc3Series = hlc3
ohlc4Series = ohlc4
barIdx = bar_index
plot(hl2Series, title="HL2")
plot(hlc3Series, title="HLC3")
plot(ohlc4Series, title="OHLC4")
plot(barIdx, title="BarIndex")
`;
    const res = executeScript(code, candles);
    expect(res.ok).toBe(true);
    expect(res.plots.length).toBe(4);

    const lastBar = candles[29];
    const expectedHL2 = Number(((lastBar.high + lastBar.low) / 2).toFixed(4));
    expect(res.plots[0].data[29].value).toBeCloseTo(expectedHL2, 2);
    expect(res.plots[3].data[29].value).toBe(29);
  });
});

describe('TitanScript — Technical Analysis (ta.*) and Math Namespace', () => {
  it('evaluates ta.sma, ta.ema, ta.rsi, ta.macd, ta.bb, ta.atr, ta.supertrend, ta.vwap, ta.stoch', () => {
    const candles = generateOscillatingCandles(80);
    const code = `//@version=5
indicator("TA Suite", overlay=true)
s = ta.sma(close, 10)
e = ta.ema(close, 10)
r = ta.rsi(close, 14)
[mLine, sLine, hLine] = ta.macd(close, 12, 26, 9)
[bbMid, bbUp, bbLow] = ta.bb(close, 20, 2.0)
[stLine, stDir] = ta.supertrend(3.0, 10)
v = ta.vwap(close)
stk = ta.stoch(close, high, low, 14)
chg = ta.change(close, 1)
trVal = ta.tr

plot(s, title="SMA")
plot(e, title="EMA")
plot(bbUp, title="BB Upper")
plot(stLine, title="SuperTrend")
plot(v, title="VWAP")
`;
    const res = executeScript(code, candles);
    expect(res.ok).toBe(true);
    expect(res.plots.length).toBe(5);
    for (const p of res.plots) {
      expect(p.data.length).toBeGreaterThan(0);
    }
  });

  it('evaluates math functions: math.abs, math.max, math.min, math.sqrt, nz, na', () => {
    const candles = generateOscillatingCandles(40);
    const code = `//@version=5
indicator("Math Suite", overlay=true)
val1 = math.abs(-42)
val2 = math.max(10, 25)
val3 = math.min(10, 25)
val4 = math.sqrt(144)
val5 = nz(na, 99)
plot(val1, title="Abs")
plot(val2, title="Max")
plot(val3, title="Min")
plot(val4, title="Sqrt")
plot(val5, title="NZ")
`;
    const res = executeScript(code, candles);
    expect(res.ok).toBe(true);
    expect(res.plots[0].data[0].value).toBe(42);
    expect(res.plots[1].data[0].value).toBe(25);
    expect(res.plots[2].data[0].value).toBe(10);
    expect(res.plots[3].data[0].value).toBe(12);
    expect(res.plots[4].data[0].value).toBe(99);
  });
});

describe('TitanScript — Visual Outputs: plot, plotshape, hline', () => {
  it('correctly creates plot styles (line vs histogram) and hlines', () => {
    const candles = generateOscillatingCandles(50);
    const code = `//@version=5
indicator("Visuals", overlay=false)
r = ta.rsi(close, 14)
plot(r, title="RSI Line", color=color.purple, linewidth=2)
plot(r - 50, title="RSI Hist", style=plot.style_histogram, color=color.teal)
hline(70, title="Overbought", color=color.red)
hline(30, title="Oversold", color=color.green)
`;
    const res = executeScript(code, candles);
    expect(res.ok).toBe(true);
    expect(res.isOverlay).toBe(false);
    expect(res.plots.length).toBe(2);
    expect(res.plots[0].style).toBe('line');
    expect(res.plots[1].style).toBe('histogram');
    expect(res.hlines.length).toBe(2);
    expect(res.hlines[0].price).toBe(70);
    expect(res.hlines[1].price).toBe(30);
  });

  it('correctly generates plotshape markers with location and shape', () => {
    const candles = generateOscillatingCandles(50);
    const code = `//@version=5
indicator("Signals", overlay=true)
bull = ta.crossover(close, ta.sma(close, 10))
bear = ta.crossunder(close, ta.sma(close, 10))
plotshape(bull, title="Buy Signal", location=location.belowbar, color=color.green, text="AL")
plotshape(bear, title="Sell Signal", location=location.abovebar, color=color.red, text="SAT")
`;
    const res = executeScript(code, candles);
    expect(res.ok).toBe(true);
    expect(res.markers.length).toBeGreaterThan(0);
    const upMarkers = res.markers.filter((m) => m.position === 'belowBar');
    const downMarkers = res.markers.filter((m) => m.position === 'aboveBar');
    expect(upMarkers.length).toBeGreaterThan(0);
    expect(downMarkers.length).toBeGreaterThan(0);
  });
});

describe('TitanScript — Strategy runtime (bar-by-bar broker)', () => {
  it('executes strategy.entry on EMA cross and reports consistent backtest metrics', () => {
    const candles = generateOscillatingCandles(120);
    const code = `//@version=5
strategy("EMA Trend Strategy", overlay=true, initial_capital=10000, commission_value=0.1, default_qty_type=strategy.percent_of_equity, default_qty_value=100)
fast = ta.ema(close, 8)
slow = ta.ema(close, 20)
if ta.crossover(fast, slow)
    strategy.entry("Long", strategy.long)
if ta.crossunder(fast, slow)
    strategy.entry("Short", strategy.short)
`;
    const res = executeScript(code, candles);
    expect(res.ok).toBe(true);
    expect(res.isStrategy).toBe(true);
    const bt = res.backtest!;
    expect(bt.initialCapital).toBe(10000);
    expect(bt.totalTrades).toBeGreaterThan(0);
    expect(bt.trades.length).toBe(bt.totalTrades);
    expect(bt.winRatePercent).toBeGreaterThanOrEqual(0);
    expect(bt.winRatePercent).toBeLessThanOrEqual(100);
    expect(bt.maxDrawdownPercent).toBeGreaterThanOrEqual(0);
    // net profit == sum of trade pnl + open profit
    const sum = bt.trades.reduce((s, t) => s + t.pnlCash, 0);
    expect(bt.finalEquity).toBeCloseTo(bt.initialCapital + sum + (bt.openProfitCash ?? 0), 0);
    for (const t of bt.trades) {
      expect(t.exitTime).toBeGreaterThanOrEqual(t.entryTime);
      expect(t.entryPrice).toBeGreaterThan(0);
    }
    expect(bt.equityCurve!.length).toBe(candles.length);
  });
});

describe('TitanScript — Built-in Presets', () => {
  it('runs every preset to completion without error', () => {
    const candles = generateOscillatingCandles(300);
    expect(BUILTIN_SCRIPT_PRESETS.length).toBeGreaterThanOrEqual(5);
    for (const preset of BUILTIN_SCRIPT_PRESETS) {
      const res = executeScript(preset.code, candles);
      expect(res.error, preset.id).toBeUndefined();
      expect(res.ok, preset.id).toBe(true);
      expect(res.plots.length + res.markers.length, preset.id).toBeGreaterThan(0);
      if (preset.category === 'strategy') {
        expect(res.isStrategy).toBe(true);
        expect(res.backtest).toBeDefined();
      }
    }
  });

});
