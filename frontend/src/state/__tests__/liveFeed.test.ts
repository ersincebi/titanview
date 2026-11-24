import { describe, expect, it } from 'vitest';
import { classifyFeed, isSessionOpen, mergeTail } from '../liveFeed';
import { computeLab } from '../lab';
import { formatAxisTime, tickMarkFormatter } from '../../chart/timezone';

const c = (time: number, close: number) => ({ time, open: close, high: close + 1, low: close - 1, close, volume: 10 });
const base = { online: true, wsConnected: true, interval: '15m' as const, lastTickAt: 1_000_000, now: 1_010_000 };

describe('classifyFeed', () => {
  it('çevrimdışı / bağlanıyor önceliklidir', () => {
    expect(classifyFeed({ ...base, online: false, lastBarTime: 0 })).toBe('offline');
    expect(classifyFeed({ ...base, wsConnected: false, lastBarTime: 0 })).toBe('reconnecting');
  });
  it('kripto: güncel bar canlı, 1+ bar geride gecikmeli', () => {
    const now = 1_000_000_000;
    expect(classifyFeed({ ...base, market: 'CRYPTO', now, lastTickAt: now - 2000, lastBarTime: now / 1000 - 300 })).toBe('live');
    expect(classifyFeed({ ...base, market: 'CRYPTO', now, lastTickAt: now - 2000, lastBarTime: now / 1000 - 3600 })).toBe('delayed');
  });
  it('hisse: son bar çok eskiyse seans kapalı', () => {
    const now = 1_000_000_000;
    expect(classifyFeed({ ...base, market: 'BIST', now, lastTickAt: now - 2000, lastBarTime: now / 1000 - 6 * 3600 })).toBe('closed');
  });
});

describe('isSessionOpen', () => {
  const at = (iso: string) => Date.parse(iso);
  it('BIST: hafta içi 10:00–18:10 İstanbul', () => {
    expect(isSessionOpen('BIST', at('2026-11-20T08:00:00Z'))).toBe(true); // Cuma 11:00
    expect(isSessionOpen('BIST', at('2026-11-20T15:30:00Z'))).toBe(false); // Cuma 18:30
    expect(isSessionOpen('BIST', at('2026-11-21T09:00:00Z'))).toBe(false); // Cumartesi
  });
  it('ABD: 09:30–16:00 New York (kış saati)', () => {
    expect(isSessionOpen('US', at('2026-11-20T15:00:00Z'))).toBe(true); // 10:00 EST
    expect(isSessionOpen('US', at('2026-11-20T21:30:00Z'))).toBe(false);
  });
  it('kripto hep açık; hafta sonu BIST "closed" sınıflanır', () => {
    expect(isSessionOpen('CRYPTO', at('2026-11-21T09:00:00Z'))).toBe(true);
    const now = at('2026-11-21T18:00:00Z');
    expect(classifyFeed({ ...base, interval: '1d', market: 'BIST', now, lastTickAt: now - 1000, lastBarTime: now / 1000 - 40000 })).toBe('closed');
  });
});

describe('mergeTail', () => {
  it('yeni barı ekler, aynı barı yerinde günceller', () => {
    const list = [c(0, 1), c(900, 2)];
    const r = mergeTail(list, [c(900, 5), c(1800, 3), c(2700, 4)]);
    expect(r.appended.map((x) => x.time)).toEqual([1800, 2700]);
    expect(list[1].close).toBe(5);
    expect(r.changed).toBe(true);
  });
  it('değişiklik yoksa changed=false', () => {
    const list = [c(0, 1), c(900, 2)];
    expect(mergeTail(list, [c(900, 2)]).changed).toBe(false);
  });
});

describe('computeLab', () => {
  it('<2 bar null', () => expect(computeLab([c(0, 1)], '15m')).toBeNull());
  it('ölçümleri üretir', () => {
    const bars = Array.from({ length: 80 }, (_, i) => c(i * 900, 100 + Math.sin(i / 5) * 3));
    const l = computeLab(bars, '15m', 79 * 900 + 450)!;
    expect(l.barProgress).toBeCloseTo(0.5, 2);
    expect(l.secondsLeft).toBe(450);
    expect(l.rsi).not.toBeNull();
    expect(l.hi20).toBeGreaterThan(l.lo20);
  });
});

describe('timezone', () => {
  it('UTC 14:45 → İstanbul 17:45', () => {
    const t = Date.UTC(2026, 10, 18, 14, 45) / 1000;
    expect(formatAxisTime(t, 'time', 'Europe/Istanbul')).toBe('17:45');
    expect(formatAxisTime(t, 'time', 'UTC')).toBe('14:45');
    expect(tickMarkFormatter(t, 3, 'Europe/Istanbul')).toBe('17:45');
  });
});

import { isTickForCurrent } from '../liveFeed';
describe('isTickForCurrent', () => {
  it('drops ticks of another symbol or interval (USDTRY=X tick must not hit THYAO.IS)', () => {
    expect(isTickForCurrent({ symbol: 'USDTRY=X', interval: '15m' }, 'THYAO.IS', '15m')).toBe(false);
    expect(isTickForCurrent({ symbol: 'THYAO.IS', interval: '1m' }, 'THYAO.IS', '15m')).toBe(false);
    expect(isTickForCurrent({ symbol: 'THYAO.IS', interval: '15m' }, 'THYAO.IS', '15m')).toBe(true);
    expect(isTickForCurrent({}, 'THYAO.IS', '15m')).toBe(true);
  });
});
