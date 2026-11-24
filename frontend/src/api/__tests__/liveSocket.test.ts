// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LiveMarketSocket } from '../liveSocket';

class FakeWS {
  static OPEN = 1;
  static instances: FakeWS[] = [];
  readyState = 0;
  sent: string[] = [];
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) {
    FakeWS.instances.push(this);
  }
  send(s: string) { this.sent.push(s); }
  close() { this.closed = true; this.readyState = 3; }
  open() { this.readyState = FakeWS.OPEN; this.onopen?.(); }
}

beforeEach(() => {
  FakeWS.instances = [];
  vi.useFakeTimers();
  vi.stubGlobal('WebSocket', FakeWS);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const candleMsg = { type: 'candle_update', symbol: 'X', interval: '15m', candle: { time: 1, open: 1, high: 2, low: 1, close: 2, volume: 1 } };

describe('LiveMarketSocket', () => {
  it('connects with an encoded url, reports state and subscribes on open', () => {
    const states: boolean[] = [];
    const s = new LiveMarketSocket(() => {}, (c) => states.push(c));
    s.connect('THYAO.IS', '1h');
    const ws = FakeWS.instances[0];
    expect(ws.url).toBe(`ws://${window.location.host}/ws/live?symbol=THYAO.IS&interval=1h`);
    ws.open();
    expect(states).toEqual([true]);
    expect(JSON.parse(ws.sent[0])).toEqual({ action: 'subscribe', symbol: 'THYAO.IS', interval: '1h' });
  });

  it('forwards only candle_update frames; garbage and status frames are ignored', () => {
    const ticks: unknown[] = [];
    const s = new LiveMarketSocket((m) => ticks.push(m), () => {});
    s.connect('X', '15m');
    const ws = FakeWS.instances[0];
    ws.open();
    ws.onmessage?.({ data: JSON.stringify(candleMsg) });
    ws.onmessage?.({ data: 'not json{' });
    ws.onmessage?.({ data: JSON.stringify({ type: 'status', state: 'reconnecting' }) });
    ws.onmessage?.({ data: JSON.stringify({ type: 'candle_update' }) });
    expect(ticks).toEqual([candleMsg]);
  });

  it('re-subscribes over the open socket instead of reconnecting', () => {
    const s = new LiveMarketSocket(() => {}, () => {});
    s.connect('A', '15m');
    FakeWS.instances[0].open();
    s.connect('B', '1d');
    expect(FakeWS.instances).toHaveLength(1);
    expect(JSON.parse(FakeWS.instances[0].sent.at(-1)!)).toEqual({ action: 'subscribe', symbol: 'B', interval: '1d' });
  });

  it('reconnects 2s after close with the latest symbol, and stops after destroy', () => {
    const states: boolean[] = [];
    const s = new LiveMarketSocket(() => {}, (c) => states.push(c));
    s.connect('A', '15m');
    FakeWS.instances[0].open();
    s.sendSubscribe('B', '5m'); // remembered for the reconnect
    FakeWS.instances[0].onclose?.();
    expect(states).toEqual([true, false]);
    vi.advanceTimersByTime(1999);
    expect(FakeWS.instances).toHaveLength(1);
    vi.advanceTimersByTime(2);
    expect(FakeWS.instances).toHaveLength(2);
    expect(FakeWS.instances[1].url).toContain('symbol=B&interval=5m');
    expect(FakeWS.instances[0].closed).toBe(true);

    s.destroy();
    FakeWS.instances[1].onclose?.();
    vi.advanceTimersByTime(10_000);
    expect(FakeWS.instances).toHaveLength(2);
  });

  it('error marks disconnected; sendSubscribe before open sends nothing', () => {
    const states: boolean[] = [];
    const s = new LiveMarketSocket(() => {}, (c) => states.push(c));
    s.connect('A', '15m');
    s.sendSubscribe('A', '1h');
    expect(FakeWS.instances[0].sent).toEqual([]);
    FakeWS.instances[0].onerror?.();
    expect(states).toEqual([false]);
  });
});
