import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Candle } from '../../types/market';

const BARS: Candle[] = Array.from({ length: 40 }, (_, i) => ({
  time: 1_700_000_000 + i * 900,
  open: 100 + i * 0.1,
  high: 101 + i * 0.1,
  low: 99 + i * 0.1,
  close: 100.5 + i * 0.1,
  volume: 1000,
}));

const CODE = '//@version=6\nindicator("Test", overlay=true)\nplot(ta.sma(close, 5), "SMA")';

describe('scriptClient worker kurtarma', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('worker onerror tetiklenince bekleyen Promise asılı kalmaz, senkron yoldan çözülür', async () => {
    class FailingWorker {
      onmessage: ((ev: MessageEvent) => void) | null = null;
      onerror: ((ev: Event) => void) | null = null;
      postMessage(): void {
        queueMicrotask(() => this.onerror?.(new Event('error')));
      }
    }
    vi.stubGlobal('Worker', FailingWorker);
    const { runScriptWorker, workerSupported } = await import('../scriptClient');
    expect(workerSupported()).toBe(true);
    const job = runScriptWorker(0, CODE, BARS, { symbol: 'XRPUSDT', timeframe: '15' });
    expect('async' in job).toBe(true);
    const res = await ('async' in job ? job.async : job.sync);
    expect(res.ok).toBe(true);
    expect(res.scriptTitle).toBe('Test');
    expect(res.plots[0].data.length).toBeGreaterThan(30);
    expect(workerSupported()).toBe(false);
  });
});
