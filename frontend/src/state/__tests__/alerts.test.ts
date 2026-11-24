import { describe, expect, it } from 'vitest';
import {
  ALERTABLE_TOOLS,
  CONDITIONS,
  TRIGGERS,
  alertLinePrice,
  barIndex,
  conditionLabel,
  describeAlert,
  drawingGeometry,
  fmtNum,
  fromLocalInput,
  isChannelCond,
  isMovingCond,
  lineValueAt,
  migrateLegacyAlerts,
  priceAlertDraft,
  studyRef,
  toLocalInput,
  triggerLabel,
  validateDraft,
  type AlertDraft,
  type ServerAlert,
} from '../alerts';
import type { Candle, DrawingObject } from '../../types/market';

const bars = (times: number[], close = (i: number) => 100 + i): Candle[] =>
  times.map((t, i) => ({ time: t, open: close(i), high: close(i) + 1, low: close(i) - 1, close: close(i), volume: 1 }));

const drawing = (toolType: DrawingObject['toolType'], points: Array<[number, number]>): DrawingObject => ({
  id: 'd1',
  symbol: 'BTCUSDT',
  timeframe: '1m',
  toolType,
  points: points.map(([time, price]) => ({ time, price })),
  color: '#0284C7',
});

describe('Faz 23 alarm modeli', () => {
  it('lists alert conditions and triggers in order with Turkish labels', () => {
    expect(CONDITIONS.map((c) => c.id)).toEqual([
      'crossing', 'crossing_up', 'crossing_down', 'greater_than', 'less_than',
      'entering_channel', 'exiting_channel', 'inside_channel', 'outside_channel',
      'moving_up', 'moving_down', 'moving_up_pct', 'moving_down_pct',
    ]);
    expect(TRIGGERS.map((t) => t.id)).toEqual(['once', 'once_per_bar', 'once_per_bar_close', 'once_per_minute']);
    expect(conditionLabel('crossing_up')).toBe('Yukarı kesişim');
    expect(conditionLabel('zzz')).toBe('zzz');
    expect(triggerLabel('once_per_bar_close')).toBe('Bar kapanışında bir kez');
    expect(isChannelCond('inside_channel') && !isChannelCond('crossing')).toBe(true);
    expect(isMovingCond('moving_down_pct') && !isMovingCond('less_than')).toBe(true);
  });

  it('bar index + line value match the Go engine (session gap, extrapolation)', () => {
    const c = bars([0, 60, 120, 1000, 1060]);
    expect(barIndex(c, -60, 60)).toBe(-1);
    expect(barIndex(c, 90, 60)).toBe(1.5);
    expect(barIndex(c, 560, 60)).toBe(2.5);
    expect(barIndex(c, 1180, 60)).toBe(6);
    expect(barIndex([], 1, 60)).toBeNaN();
    const l = { a: { time: 0, price: 100 }, b: { time: 1060, price: 140 } };
    expect(lineValueAt(l, c, 60, 3)).toBeCloseTo(130);
    expect(lineValueAt(l, c, 60, 6)).toBeNaN();
    expect(lineValueAt({ ...l, extendRight: true }, c, 60, 6)).toBeCloseTo(160);
    expect(lineValueAt({ a: { time: 60, price: 5 }, b: { time: 60, price: 5 }, extendLeft: true, extendRight: true }, c, 60, 4)).toBe(5);
    expect(lineValueAt({ a: { time: 60, price: 5 }, b: { time: 60, price: 6 } }, c, 60, 1)).toBeNaN();
  });

  it('converts every alertable drawing to a line or channel', () => {
    const c = bars([0, 60, 120, 180, 240, 300], (i) => 100 + i * 2);
    for (const t of ALERTABLE_TOOLS) {
      const pts: Array<[number, number]> = t === 'hline' || t === 'hray' ? [[60, 105]] : [[0, 100], [240, 110], [120, 90]];
      expect(drawingGeometry(drawing(t as DrawingObject['toolType'], pts), c, 60), t).not.toBeNull();
    }
    expect(drawingGeometry(drawing('hline', [[60, 105]]), c, 60)).toEqual({
      kind: 'line',
      line: { a: { time: 60, price: 105 }, b: { time: 60, price: 105 }, extendLeft: true, extendRight: true },
    });
    const ray = drawingGeometry(drawing('ray', [[0, 1], [60, 2]]), c, 60);
    expect(ray?.kind === 'line' && ray.line.extendRight && !ray.line.extendLeft).toBe(true);
    const ext = drawingGeometry(drawing('extended', [[0, 1], [60, 2]]), c, 60);
    expect(ext?.kind === 'line' && ext.line.extendLeft && ext.line.extendRight).toBe(true);
    // parallel channel: second line through p2, parallel in bar-index space
    const ch = drawingGeometry(drawing('channel', [[0, 100], [240, 120], [120, 90]]), c, 60);
    expect(ch?.kind).toBe('channel');
    if (ch?.kind === 'channel') {
      expect(ch.upper.a.price).toBe(100);
      expect(ch.lower.a.price).toBeCloseTo(80); // 90 - (100 + 5*2)
      expect(ch.lower.b.price).toBeCloseTo(100);
    }
    // flat channel: flat line at p2's price
    const flat = drawingGeometry(drawing('flat_channel', [[0, 100], [240, 120], [120, 130]]), c, 60);
    expect(flat?.kind === 'channel' && flat.upper.a.price === 130 && flat.upper.b.price === 130).toBe(true);
    // disjoint channel: reversed slope through p2
    const dj = drawingGeometry(drawing('disjoint_channel', [[0, 100], [240, 120], [120, 90]]), c, 60);
    expect(dj?.kind === 'channel' && dj.lower.a.price).toBeCloseTo(100);
    // rectangle: high/low bounds over its time span
    const rect = drawingGeometry(drawing('rect', [[240, 95], [0, 105]]), c, 60);
    expect(rect).toEqual({
      kind: 'channel',
      upper: { a: { time: 0, price: 105 }, b: { time: 240, price: 105 } },
      lower: { a: { time: 0, price: 95 }, b: { time: 240, price: 95 } },
    });
    // regression channel from real closes (perfect line → zero deviation)
    const reg = drawingGeometry(drawing('regression', [[0, 0], [300, 0]]), c, 60);
    expect(reg?.kind === 'channel' && reg.upper.a.price).toBeCloseTo(100);
    expect(drawingGeometry(drawing('regression', [[0, 0], [1, 0]]), c, 60)).toBeNull();
    // unsupported / incomplete drawings
    expect(drawingGeometry(drawing('fib', [[0, 1], [60, 2]]), c, 60)).toBeNull();
    expect(drawingGeometry(drawing('trendline', [[0, 1]]), c, 60)).toBeNull();
    expect(drawingGeometry(drawing('channel', [[0, 1], [60, 2]]), c, 60)).toBeNull();
    expect(drawingGeometry(drawing('trendline', []), c, 60)).toBeNull();
  });

  it('describes alerts for the panel', () => {
    const base = priceAlertDraft('btcusdt', '1h', 65000);
    expect(base.symbol).toBe('BTCUSDT');
    expect(describeAlert(base)).toBe('BTCUSDT Kesişim 65000.00');
    expect(describeAlert({ ...base, condition: 'entering_channel' })).toBe('BTCUSDT Kanala giriyor');
    expect(describeAlert({ ...base, condition: 'moving_up_pct', amount: 2, bars: 5 })).toBe('BTCUSDT Yukarı hareket % 2% / 5 bar');
    expect(describeAlert({ ...base, condition: 'less_than', target: { kind: 'price', field: 'open' } })).toBe('BTCUSDT Küçüktür Açılış');
    expect(describeAlert({ ...base, target: { kind: 'line', line: { a: { time: 1, price: 1 }, b: { time: 2, price: 2 } } } })).toBe('BTCUSDT Kesişim Çizim');
    const study = { name: 'RSI', code: 'x' };
    expect(describeAlert({ ...base, source: { kind: 'plot', study, plot: 'RSI' }, condition: 'greater_than', target: { kind: 'value', value: 70 } })).toBe('RSI: RSI Büyüktür 70');
    expect(describeAlert({ ...base, kind: 'script', study, scriptEvent: 'alertcondition', conditionTitle: 'Al' })).toBe('RSI: Al');
    expect(describeAlert({ ...base, kind: 'script', study, scriptEvent: 'order_fills' })).toBe('RSI: Yalnız emir dolumları');
    expect(fmtNum(0.000123456)).toBe('0.00012346');
    expect(fmtNum(12.34567)).toBe('12.3457');
    expect(fmtNum(undefined)).toBe('—');
  });

  it('studyRef drops inputs bound to other indicators (server cannot resolve them)', () => {
    const r = studyRef('RSI', 'code', { length: 14, src: '@s2:EMA' }, 's1');
    expect(r.study).toEqual({ id: 's1', name: 'RSI', code: 'code', inputs: { length: 14 } });
    expect(r.dropped).toEqual(['src']);
    expect(studyRef('X', 'c').study).toEqual({ name: 'X', code: 'c' });
  });

  it('migrates untriggered legacy price alerts', () => {
    const out = migrateLegacyAlerts(
      [
        { id: 'a', symbol: 'THYAO.IS', targetPrice: 300, condition: 'CROSS_UP', triggered: false, note: 'Yukarı Kırılım Alarmı' },
        { id: 'b', symbol: 'BTCUSDT', targetPrice: 50000, condition: 'CROSS_DOWN', triggered: false, note: '' },
        { id: 'c', symbol: 'X', targetPrice: 1, condition: 'CROSS_UP', triggered: true, note: '' },
        { id: 'd', symbol: 'X', targetPrice: -1, condition: 'CROSS_UP', triggered: false, note: '' },
      ],
      '15m'
    );
    expect(out.map((d) => [d.symbol, d.condition, d.target?.value, d.name])).toEqual([
      ['THYAO.IS', 'crossing_up', 300, 'Yukarı Kırılım Alarmı'],
      ['BTCUSDT', 'crossing_down', 50000, ''],
    ]);
  });

  it('validates drafts with Turkish messages', () => {
    const ok = priceAlertDraft('X', '1m', 1);
    expect(validateDraft(ok)).toBeNull();
    const cases: Array<[Partial<AlertDraft>, string]> = [
      [{ symbol: '' }, 'Sembol gerekli'],
      [{ notify: { ...ok.notify, webhook: 'ftp://x' } }, 'Webhook'],
      [{ kind: 'script' }, 'Betik'],
      [{ kind: 'script', study: { name: 'a', code: 'c' }, scriptEvent: 'alertcondition' }, 'alertcondition'],
      [{ source: { kind: 'plot' } }, 'Gösterge çizimi'],
      [{ condition: 'inside_channel' }, 'üst ve alt'],
      [{ condition: 'inside_channel', upper: { kind: 'value', value: NaN }, lower: { kind: 'value', value: 1 } }, 'sayı'],
      [{ condition: 'moving_up', amount: 0 }, 'pozitif'],
      [{ condition: 'moving_up', amount: 1, bars: 0 }, 'en az 1'],
      [{ target: undefined }, 'Hedef'],
      [{ target: { kind: 'value', value: NaN } }, 'sayı'],
      [{ target: { kind: 'plot' } }, 'Hedef gösterge'],
    ];
    for (const [patch, msg] of cases) expect(validateDraft({ ...ok, ...patch } as AlertDraft)).toContain(msg);
    expect(validateDraft({ ...ok, kind: 'script', study: { name: 'a', code: 'c' }, scriptEvent: 'alert_calls' })).toBeNull();
    expect(validateDraft({ ...ok, condition: 'outside_channel', upper: { kind: 'value', value: 2 }, lower: { kind: 'value', value: 1 } })).toBeNull();
  });

  it('alert lines only for active fixed-value price alerts', () => {
    const a = { ...priceAlertDraft('X', '1m', 42), id: 'a', status: 'active', createdAt: 0, updatedAt: 0, fireCount: 0 } as ServerAlert;
    expect(alertLinePrice(a)).toBe(42);
    expect(alertLinePrice({ ...a, status: 'stopped' })).toBeNull();
    expect(alertLinePrice({ ...a, condition: 'inside_channel' })).toBeNull();
    expect(alertLinePrice({ ...a, target: { kind: 'price', field: 'open' } })).toBeNull();
    expect(alertLinePrice({ ...a, source: { kind: 'plot', plot: 'x' } })).toBeNull();
  });

  it('datetime-local round trip', () => {
    const sec = Math.floor(new Date(2026, 10, 22, 14, 30).getTime() / 1000);
    expect(toLocalInput(sec)).toBe('2026-11-22T14:30');
    expect(fromLocalInput('2026-11-22T14:30')).toBe(sec);
    expect(fromLocalInput('')).toBeUndefined();
    expect(fromLocalInput('nope')).toBeUndefined();
  });
});
