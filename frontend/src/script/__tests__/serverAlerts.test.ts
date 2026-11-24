import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { executeScript } from '../runtime';
import { run, runForServer } from '../serverEntry';
import type { Candle } from '../../types/market';

const bars = (closes: number[], start = 1_700_000_000, step = 3600): Candle[] =>
  closes.map((c, i) => ({ time: start + i * step, open: c, high: c + 1, low: c - 1, close: c, volume: 100 }));

describe('Faz 23 — betik alarm çıktıları', () => {
  it('alertcondition titles are declared even when false; firing carries kind/title on the last bar only', () => {
    const r = executeScript(
      `//@version=6
indicator("A")
alertcondition(close > 5, "Büyük", "Kapanış {{close}}")
alertcondition(close > 1000, "Asla")
alertcondition(close > 5, title="Büyük")`,
      bars([1, 2, 6, 7])
    );
    expect(r.alertConditions).toEqual([
      { title: 'Büyük', message: 'Kapanış {{close}}' },
      { title: 'Asla', message: 'Asla' },
    ]);
    expect(r.alerts).toEqual([
      { time: bars([1, 2, 6, 7])[3].time, message: 'Kapanış {{close}}', kind: 'alertcondition', title: 'Büyük' },
      { time: bars([1, 2, 6, 7])[3].time, message: 'Büyük', kind: 'alertcondition', title: 'Büyük' },
    ]);
  });

  it('alert() records its freq', () => {
    const r = executeScript(
      `//@version=6
indicator("B")
alert("x", alert.freq_once_per_bar_close)
alert("y")
alert("z", freq=alert.freq_all)`,
      bars([1, 2])
    );
    expect(r.alerts?.map((a) => [a.kind, a.message, a.freq])).toEqual([
      ['alert', 'x', 'once_per_bar_close'],
      ['alert', 'y', 'once_per_bar'],
      ['alert', 'z', 'all'],
    ]);
  });

  it('strategy fills (entry + exit) with position size after each fill', () => {
    const r = executeScript(
      `//@version=6
strategy("C")
if close > 5 and strategy.position_size == 0
    strategy.entry("L", strategy.long, qty=3)
if close < 3 and strategy.position_size > 0
    strategy.close("L", comment="çık")`,
      bars([1, 6, 7, 2, 4, 1])
    );
    expect(r.backtest?.fills?.map((f) => [f.action, f.qty, f.price, f.id, f.comment, f.positionSize])).toEqual([
      ['buy', 3, 7, 'L', '', 3],
      ['sell', 3, 4, 'L', 'çık', 0],
    ]);
  });

  it('hour()/dayofweek() honour an IANA timezone argument', () => {
    const t = Date.UTC(2024, 0, 2, 7, 0) / 1000; // 10:00 Istanbul, Tuesday
    const r = executeScript(
      `//@version=6
indicator("T")
plot(hour(time, "Europe/Istanbul"), "h")
plot(hour(time), "u")
plot(dayofweek(time, "Europe/Istanbul"), "d")
plot(minute(time, "UTC+3"), "m")`,
      bars([1], t)
    );
    const v = (title: string) => r.plots.find((p) => p.title === title)!.data[0].value;
    expect([v('h'), v('u'), v('d'), v('m')]).toEqual([10, 7, 3, 0]);
  });

  it('server entry aligns plots to candles (null = na) and reports errors as data', () => {
    const c = bars([1, 2, 3, 4, 5]);
    const out = runForServer({ code: '//@version=6\nindicator("S")\nplot(ta.sma(close, 3), "m")', candles: c, timeframe: '60' });
    expect(out.ok).toBe(true);
    expect(out.plots[0]).toEqual({ id: expect.any(String), title: 'm', values: [null, null, 2, 3, 4] });
    const bad = JSON.parse(run(JSON.stringify({ code: 'plot(', candles: c })));
    expect(bad.ok).toBe(false);
    expect(bad.error).toBeTruthy();
    const crash = JSON.parse(run('{not json'));
    expect(crash).toMatchObject({ ok: false, plots: [], alerts: [] });
    const lib = runForServer({
      code: '//@version=6\nindicator("U")\nimport user/mylib/1 as m\nplot(m.twice(close), "t")',
      candles: c,
      scripts: [{ name: 'mylib', code: '//@version=6\nlibrary("mylib")\nexport twice(float x) => x * 2' }],
    });
    expect(lib.ok).toBe(true);
    expect(lib.plots[0].values[4]).toBe(10);
  });

  it('the committed Go bundle (backend/internal/scriptjs/script_bundle.js) is up to date', async () => {
    const mod = (await import(resolve(__dirname, '../../../../scripts/build-script-server.mjs'))) as { bundleScriptServer: () => Promise<string>; OUT: string };
    const fresh = await mod.bundleScriptServer();
    const committed = readFileSync(mod.OUT, 'utf8');
    expect(committed === fresh, 'script_bundle.js stale: run node scripts/build-script-server.mjs').toBe(true);
  }, 30_000);
});
