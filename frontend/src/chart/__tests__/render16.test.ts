import { describe, expect, it, vi } from 'vitest';

vi.mock('lightweight-charts', async () => (await import('./lwcMock')).lwcModule());

import { createView } from '../customSeries';
import { FootprintLayer, SessionProfiles, TpoLayer, VisibleRangeProfile } from '../profilePrimitives';
import { toKagi, toPnF } from '../chartTypes';
import { approxFootprint } from '../profile';

/** Çağrıları sayan sahte 2D bağlam. */
function fakeCtx() {
  const calls: Record<string, number> = {};
  const ctx = new Proxy({} as Record<string, unknown>, {
    get(t, k: string) {
      if (k in t) return t[k];
      return (..._a: unknown[]) => {
        calls[k] = (calls[k] ?? 0) + 1;
      };
    },
    set(t, k: string, v) {
      t[k] = v;
      return true;
    },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}
function target(ctx: CanvasRenderingContext2D) {
  return {
    useBitmapCoordinateSpace: (f: (s: unknown) => void) =>
      f({ context: ctx, horizontalPixelRatio: 2, verticalPixelRatio: 2, bitmapSize: { width: 1600, height: 800 }, mediaSize: { width: 800, height: 400 } }),
  };
}

const bars = Array.from({ length: 120 }, (_, i) => {
  const o = 100 + Math.sin(i / 5) * 5;
  const c = o + Math.cos(i / 3) * 2;
  return { time: 1_700_000_000 + i * 1800, open: o, close: c, high: Math.max(o, c) + 1, low: Math.min(o, c) - 1, volume: 100 + (i % 7) * 30 };
});
const conv = (p: number) => 400 - (p - 90) * 20;

describe('özel seri çizimleri', () => {
  const frame = (data: Array<Record<string, unknown>>) => ({
    bars: data.map((d, i) => ({ x: i * 8, time: d.time, originalData: d, barColor: '' })),
    barSpacing: 8,
    visibleRange: { from: 0, to: data.length },
    conflationFactor: 1,
  });
  for (const style of ['volcandles', 'hlcarea', 'columns', 'highlow'] as const) {
    it(`${style} çizer`, () => {
      const v = createView(style);
      v.update(frame(bars.map((b, i) => ({ ...b, prevClose: i ? bars[i - 1].close : undefined }))) as never, v.defaultOptions());
      const { ctx, calls } = fakeCtx();
      v.renderer().draw(target(ctx) as never, conv as never, false as never);
      expect((calls.fillRect ?? 0) + (calls.stroke ?? 0) + (calls.fill ?? 0)).toBeGreaterThan(0);
    });
  }
  it('kagi ve p&f çizer', () => {
    for (const [style, data] of [['kagi', toKagi(bars, { mode: 'fixed', atrLen: 14, value: 1 })], ['pnf', toPnF(bars, { mode: 'fixed', atrLen: 14, box: 1, reversal: 3, source: 'close' })]] as const) {
      expect(data.length).toBeGreaterThan(2);
      const v = createView(style);
      v.update(frame(data as never) as never, v.defaultOptions());
      const { ctx, calls } = fakeCtx();
      v.renderer().draw(target(ctx) as never, conv as never, false as never);
      expect(calls.stroke).toBeGreaterThan(0);
    }
  });
});

describe('profil katmanları', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function attach(p: any) {
    const chart = {
      timeScale: () => ({
        getVisibleLogicalRange: () => ({ from: 0, to: bars.length - 1 }),
        timeToCoordinate: (t: number) => ((t - bars[0].time) / 1800) * 8,
        options: () => ({ barSpacing: 8 }),
      }),
    };
    const series = { priceToCoordinate: (p: number) => conv(p) };
    p.attached({ chart, series, requestUpdate: () => {} } as never);
    const { ctx, calls } = fakeCtx();
    p.paneViews()[0].renderer()!.draw(target(ctx));
    return calls;
  }
  it('VPVR, seans VP, TPO, footprint çizer', () => {
    const prm = () => ({ rows: 24, vaPct: 70 });
    expect(attach(new VisibleRangeProfile(() => bars, prm)).fillRect).toBeGreaterThan(10);
    expect(attach(new SessionProfiles(() => bars, () => 'CRYPTO', prm)).fillRect).toBeGreaterThan(10);
    const tpo = attach(new TpoLayer(() => bars, () => 'CRYPTO', () => ({ periodSec: 1800, vaPct: 70, rowSize: 0.5 })));
    expect((tpo.fillText ?? 0) + (tpo.fillRect ?? 0)).toBeGreaterThan(20);
    const fpMap = new Map(bars.map((b) => [b.time, approxFootprint(b, 0.5)]));
    const fp = attach(new FootprintLayer(() => bars, () => fpMap, () => 0.5));
    expect(fp.fillRect).toBeGreaterThan(bars.length);
  });
  it('TPO autoscale görünür barların aralığını verir', () => {
    const t = new TpoLayer(() => bars, () => 'CRYPTO', () => ({ periodSec: 1800, vaPct: 70, rowSize: 0.5 }));
    const info = t.autoscaleInfo(0 as never, 10 as never)!;
    expect(info.priceRange!.minValue).toBe(Math.min(...bars.slice(0, 11).map((b) => b.low)));
  });
});
