/**
 * Faz 30 — parity.md §13 performans hedeflerinin canlı ölçümü.
 *  - İlk açılış: gezinme başlangıcından (performance.timeOrigin) ana grafiğin ilk mumlarını çizdiği kareye kadar.
 *  - Tick → ekran: WS mesajının alınmasından, grafiğin o tick'i çizdiği animasyon karesine kadar.
 *  - Yeniden hesap: göstergeler + TitanScript betiklerinin tam yeniden hesap süresi (çağıran ölçer, burada toplanır).
 *  - Kaydırma/yakınlaştırma: `scrollBench()` grafiği programatik kaydırıp kare sürelerini ölçer.
 * Sonuçlar `window.__titanPerf` üzerinden okunur (tarayıcı kanıtı + scripts/perf.mjs).
 */

export interface PerfStats {
  n: number;
  p50: number;
  p95: number;
  max: number;
  mean: number;
}

const MAX_SAMPLES = 2000;

function push(arr: number[], v: number): void {
  arr.push(v);
  if (arr.length > MAX_SAMPLES) arr.splice(0, arr.length - MAX_SAMPLES);
}

export function stats(xs: number[]): PerfStats {
  if (!xs.length) return { n: 0, p50: 0, p95: 0, max: 0, mean: 0 };
  const s = [...xs].sort((a, b) => a - b);
  const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))];
  const r = (v: number) => Math.round(v * 100) / 100;
  return { n: s.length, p50: r(q(0.5)), p95: r(q(0.95)), max: r(s[s.length - 1]), mean: r(s.reduce((a, b) => a + b, 0) / s.length) };
}

const raf = (cb: (t: number) => void): void => {
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(cb);
  else setTimeout(() => cb(performance.now()), 0);
};

/** liveSocket son WS mesajının alındığı anı buraya yazar. */
export const tickClock = { lastReceivedAt: 0 };

export const perfState = {
  interactiveMs: null as number | null,
  firstBars: 0,
  tickToFrame: [] as number[],
  tickSync: [] as number[],
  longTasks: [] as number[],
  recalc: [] as Array<{ ms: number; bars: number; scripts: number; label: string }>,
};

/** Ana grafiğe ilk veri basıldığında çağrılır; bir sonraki karede "etkileşime hazır" süresi kaydedilir. */
export function markFirstChartData(bars: number): void {
  if (perfState.interactiveMs !== null || bars <= 0) return;
  raf(() => {
    if (perfState.interactiveMs !== null) return;
    perfState.interactiveMs = Math.round(performance.now());
    perfState.firstBars = bars;
    try {
      performance.mark('titan:interactive');
    } catch {
      // eski tarayıcı
    }
  });
}

/** WS tick'i alındığında t0 ile çağrılır; grafik güncellemesinden sonra çizilen karede süre kaydedilir. */
export function markTickRendered(t0: number): void {
  push(perfState.tickSync, performance.now() - t0);
  raf(() => push(perfState.tickToFrame, performance.now() - t0));
}

if (typeof PerformanceObserver !== 'undefined') {
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) push(perfState.longTasks, e.duration);
    }).observe({ type: 'longtask', buffered: true });
  } catch {
    // longtask desteklenmiyor
  }
}

export function recordRecalc(label: string, ms: number, bars: number, scripts: number): void {
  perfState.recalc.push({ label, ms: Math.round(ms * 100) / 100, bars, scripts });
  if (perfState.recalc.length > 200) perfState.recalc.shift();
}

/**
 * Grafiği `frames` kare boyunca kaydırır (ve her `zoomEvery` karede yakınlaştırır/uzaklaştırır),
 * gerçek rAF kare aralıklarını ölçer. 60 fps = kare aralığı ≤ 16.7 ms.
 */
export async function scrollBench(
  step: (i: number) => void,
  frames = 240
): Promise<{ frames: number; fps: number; frameMs: PerfStats; over20ms: number }> {
  const gaps: number[] = [];
  let last = 0;
  await new Promise<void>((resolve) => {
    let i = 0;
    const tick = (t: number) => {
      if (last) gaps.push(t - last);
      last = t;
      if (i >= frames) return resolve();
      step(i++);
      raf(tick);
    };
    raf(tick);
  });
  const st = stats(gaps);
  return { frames: gaps.length, fps: Math.round((1000 / (st.mean || 1)) * 10) / 10, frameMs: st, over20ms: gaps.filter((g) => g > 20).length };
}

export function perfReport() {
  return {
    interactiveMs: perfState.interactiveMs,
    firstBars: perfState.firstBars,
    tickToFrame: stats(perfState.tickToFrame),
    tickSync: stats(perfState.tickSync),
    longTasks: stats(perfState.longTasks),
    recalc: perfState.recalc.slice(-20),
  };
}

if (typeof window !== 'undefined') {
  (window as unknown as { __titanPerf: unknown }).__titanPerf = { state: perfState, report: perfReport, stats, scrollBench };
}
