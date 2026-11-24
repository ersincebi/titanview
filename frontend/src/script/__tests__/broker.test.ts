import { describe, expect, it } from 'vitest';
import type { Candle } from '../../types/market';
import { executeScript } from '../runtime';

type Bar = [number, number, number, number]; // o h l c
const T0 = 1_700_000_000;

function bars(list: Bar[]): Candle[] {
  return list.map(([open, high, low, close], i) => ({ time: T0 + i * 3600, open, high, low, close, volume: 1000 }));
}

function strat(decl: string, body: string, list: Bar[], mintick = 1) {
  const res = executeScript(`//@version=5\nstrategy("t", overlay=true${decl ? ', ' + decl : ''})\n${body}`, bars(list), {
    mintick,
  });
  expect(res.error).toBeUndefined();
  return res;
}

const FLAT: Bar[] = [
  [100, 101, 99, 100],
  [100, 102, 99, 101],
  [105, 106, 104, 105],
  [105, 108, 104, 107],
  [107, 109, 106, 108],
  [110, 111, 109, 110],
  [110, 111, 109, 110],
];

describe('broker — fill timing', () => {
  const body = `if bar_index == 1
    strategy.entry("L", strategy.long, qty=2)
if bar_index == 4
    strategy.close("L")
plot(strategy.position_size, title="pos")`;

  it('market orders fill at the NEXT bar open', () => {
    const r = strat('', body, FLAT);
    const t = r.backtest!.trades;
    expect(t).toHaveLength(1);
    expect(t[0].entryPrice).toBe(105); // open of bar 2, not close of bar 1
    expect(t[0].entryTime).toBe(T0 + 2 * 3600);
    expect(t[0].exitPrice).toBe(110); // open of bar 5
    expect(t[0].exitTime).toBe(T0 + 5 * 3600);
    expect(t[0].pnlCash).toBe(10);
    expect(r.backtest!.finalEquity).toBe(10010);
  });

  it('process_orders_on_close fills at the same bar close', () => {
    const r = strat('process_orders_on_close=true', body, FLAT);
    const t = r.backtest!.trades[0];
    expect(t.entryPrice).toBe(101); // close of bar 1
    expect(t.exitPrice).toBe(108); // close of bar 4
    expect(t.pnlCash).toBe(14);
  });

  it('strategy.position_size reflects fills before the script runs on that bar', () => {
    const r = strat('', body, FLAT);
    const pos = r.plots[0].data.map((d) => d.value);
    expect(pos).toEqual([0, 0, 2, 2, 2, 0, 0]);
  });

  it('strategy.equity includes open profit', () => {
    const r = strat('', `if bar_index == 1
    strategy.entry("L", strategy.long, qty=2)
plot(strategy.equity, title="eq")`, FLAT);
    const eq = r.plots[0].data.map((d) => d.value);
    expect(eq[2]).toBeCloseTo(10000 + (105 - 105) * 2, 6); // bar 2: filled at open 105, close 105
    expect(eq[3]).toBeCloseTo(10000 + (107 - 105) * 2, 6);
    expect(eq[5]).toBeCloseTo(10000 + (110 - 105) * 2, 6);
  });
});

describe('broker — intrabar limit / stop resolution', () => {
  const entry = `if bar_index == 0
    strategy.entry("L", strategy.long, qty=1)
strategy.exit("X", "L", stop=95, limit=110)`;

  it('limit fills at the limit price', () => {
    const r = strat('', entry, [
      [100, 101, 99, 100],
      [100, 103, 99, 102],
      [102, 111, 101, 109],
      [109, 110, 108, 109],
    ]);
    const t = r.backtest!.trades[0];
    expect(t.entryPrice).toBe(100);
    expect(t.exitPrice).toBe(110);
  });

  it('gap above the limit fills at the open (better), gap below the stop fills at the open (worse)', () => {
    const up = strat('', entry, [
      [100, 101, 99, 100],
      [100, 103, 99, 102],
      [113, 115, 112, 114],
    ]);
    expect(up.backtest!.trades[0].exitPrice).toBe(113);
    const down = strat('', entry, [
      [100, 101, 99, 100],
      [100, 103, 99, 102],
      [90, 92, 88, 91],
    ]);
    expect(down.backtest!.trades[0].exitPrice).toBe(90);
  });

  it('when both levels are inside one bar the O-H-L-C / O-L-H-C path decides', () => {
    // high closer to open -> O,H,L,C : limit(110) first
    const hi = strat('', entry, [
      [100, 101, 99, 100],
      [108, 111, 94, 100],
    ]);
    expect(hi.backtest!.trades[0].exitPrice).toBe(110);
    // low closer to open -> O,L,H,C : stop(95) first
    const lo = strat('', entry, [
      [100, 101, 99, 100],
      [100, 112, 94, 100],
    ]);
    expect(lo.backtest!.trades[0].exitPrice).toBe(95);
  });

  it('qty_percent exits fire once each and sum to the entry quantity', () => {
    const r = strat(
      '',
      `if bar_index == 0
    strategy.entry("L", strategy.long, qty=10)
strategy.exit("T1", "L", limit=110, qty_percent=40, comment_profit="TP1")
strategy.exit("T2", "L", limit=120, qty_percent=60, comment_profit="TP2")`,
      [
        [100, 101, 99, 100],
        [100, 112, 99, 111],
        [111, 113, 110, 112],
        [112, 121, 111, 120],
      ]
    );
    const t = r.backtest!.trades;
    expect(t).toHaveLength(2);
    expect(t.map((x) => [x.qty, x.exitPrice, x.exitComment])).toEqual([
      [4, 110, 'TP1'],
      [6, 120, 'TP2'],
    ]);
    expect(r.backtest!.finalEquity).toBe(10000 + 4 * 10 + 6 * 20);
  });

  it('trailing stop follows the extreme after activation', () => {
    const r = strat(
      '',
      `if bar_index == 0
    strategy.entry("L", strategy.long, qty=1)
strategy.exit("X", "L", trail_price=105, trail_offset=5)`,
      [
        [100, 101, 99, 100],
        [100, 104, 99, 103],
        [103, 120, 102, 118],
        [118, 119, 112, 113],
      ]
    );
    const t = r.backtest!.trades[0];
    expect(t.exitPrice).toBe(115); // 120 - 5 ticks
  });

  it('profit/loss in ticks', () => {
    const r = strat(
      '',
      `if bar_index == 0
    strategy.entry("L", strategy.long, qty=1)
strategy.exit("X", "L", profit=7, loss=3)`,
      [
        [100, 101, 99, 100],
        [100, 104, 99, 103],
        [103, 108, 102, 107],
      ],
      1
    );
    expect(r.backtest!.trades[0].exitPrice).toBe(107);
  });

  it('short exits mirror long ones', () => {
    const r = strat(
      '',
      `if bar_index == 0
    strategy.entry("S", strategy.short, qty=1)
strategy.exit("X", "S", stop=105, limit=90)`,
      [
        [100, 101, 99, 100],
        [100, 102, 91, 95],
        [95, 96, 89, 90],
      ]
    );
    const t = r.backtest!.trades[0];
    expect(t.direction).toBe('SHORT');
    expect(t.exitPrice).toBe(90);
    expect(t.pnlCash).toBe(10);
  });

  it('stop / limit entry orders wait for the level', () => {
    const r = strat(
      '',
      `if bar_index == 0
    strategy.entry("B", strategy.long, qty=1, stop=105)
    strategy.entry("D", strategy.long, qty=1, limit=95)`,
      [
        [100, 101, 99, 100],
        [100, 103, 99, 102],
        [102, 107, 101, 106],
        [106, 107, 94, 96],
      ],
    );
    // pyramiding=1 -> second long is rejected, first (stop 105) wins
    const trades = r.backtest!.trades;
    const open = r.backtest!.openTrades;
    expect(trades.length + (open ?? 0)).toBe(1);
    expect(r.markers.find((m) => m.text === 'B')).toBeDefined();
  });
});

describe('broker — position rules, costs, sizing', () => {
  it('commission percent is charged on entry and exit', () => {
    const r = strat(
      'commission_type=strategy.commission.percent, commission_value=1',
      `if bar_index == 0
    strategy.entry("L", strategy.long, qty=1)
if bar_index == 2
    strategy.close("L")`,
      [
        [100, 101, 99, 100],
        [100, 111, 99, 110],
        [110, 111, 109, 110],
        [110, 111, 109, 110],
      ]
    );
    const t = r.backtest!.trades[0];
    expect(t.entryPrice).toBe(100);
    expect(t.exitPrice).toBe(110);
    expect(t.commission).toBeCloseTo(1.0 + 1.1, 6);
    expect(t.pnlCash).toBeCloseTo(10 - 2.1, 6);
    expect(r.backtest!.finalEquity).toBeCloseTo(10000 + 7.9, 6);
  });

  it('opposite entry reverses the position', () => {
    const r = strat(
      '',
      `if bar_index == 0
    strategy.entry("L", strategy.long, qty=1)
if bar_index == 2
    strategy.entry("S", strategy.short, qty=3)
plot(strategy.position_size)`,
      [
        [100, 101, 99, 100],
        [100, 101, 99, 100],
        [100, 101, 99, 100],
        [104, 105, 103, 104],
        [104, 105, 103, 104],
      ]
    );
    const t = r.backtest!.trades;
    expect(t).toHaveLength(1);
    expect(t[0].exitPrice).toBe(104);
    expect(t[0].pnlCash).toBe(4);
    expect(r.plots[0].data.map((d) => d.value)).toEqual([0, 1, 1, -3, -3]);
  });

  it('pyramiding caps same-direction entries', () => {
    const body = `strategy.entry("L" + str.tostring(bar_index), strategy.long, qty=1)
plot(strategy.position_size)`;
    const list = FLAT;
    const p1 = strat('pyramiding=1', body, list);
    expect(p1.plots[0].data.at(-1)!.value).toBe(1);
    const p3 = strat('pyramiding=3', body, list);
    expect(p3.plots[0].data.at(-1)!.value).toBe(3);
  });

  it('default_qty_type=percent_of_equity sizes from equity at fill', () => {
    const r = strat(
      'default_qty_type=strategy.percent_of_equity, default_qty_value=50',
      `if bar_index == 0
    strategy.entry("L", strategy.long)
plot(strategy.position_size)`,
      [
        [100, 101, 99, 100],
        [100, 101, 99, 100],
        [100, 101, 99, 100],
      ]
    );
    expect(r.plots[0].data.at(-1)!.value).toBeCloseTo(50, 6);
  });

  it('strategy.close_all and cancel', () => {
    const r = strat(
      'pyramiding=2',
      `if bar_index == 0
    strategy.entry("A", strategy.long, qty=1)
if bar_index == 1
    strategy.entry("B", strategy.long, qty=1)
if bar_index == 3
    strategy.close_all(comment="bye")
plot(strategy.opentrades, title="open")
plot(strategy.closedtrades, title="closed")`,
      FLAT
    );
    const t = r.backtest!.trades;
    expect(t).toHaveLength(2);
    expect(t.every((x) => x.exitComment === 'bye')).toBe(true);
    expect(r.plots[0].data.at(-1)!.value).toBe(0);
    expect(r.plots[1].data.at(-1)!.value).toBe(2);
  });

  it('report is internally consistent (net = sum of trades + open P&L, win rate, PF)', () => {
    const r = strat(
      'commission_value=0.1, default_qty_type=strategy.percent_of_equity, default_qty_value=100',
      `if ta.crossover(close, ta.sma(close, 3))
    strategy.entry("L", strategy.long)
if ta.crossunder(close, ta.sma(close, 3))
    strategy.close("L")`,
      Array.from({ length: 200 }, (_, i) => {
        const p = 100 + Math.sin(i / 3) * 10;
        return [p, p + 1, p - 1, p + Math.cos(i / 3) * 3] as Bar;
      })
    );
    const bt = r.backtest!;
    expect(bt.totalTrades).toBeGreaterThan(2);
    const sum = bt.trades.reduce((s, t) => s + t.pnlCash, 0);
    expect(bt.finalEquity).toBeCloseTo(10000 + sum + (bt.openProfitCash ?? 0), 1);
    const wins = bt.trades.filter((t) => t.pnlCash > 0);
    expect(bt.winningTrades).toBe(wins.length);
    const gp = wins.reduce((s, t) => s + t.pnlCash, 0);
    const gl = -bt.trades.filter((t) => t.pnlCash < 0).reduce((s, t) => s + t.pnlCash, 0);
    if (gl > 0) expect(bt.profitFactor).toBeCloseTo(gp / gl, 1);
    expect(bt.maxDrawdownPercent).toBeGreaterThan(0);
  });
});
