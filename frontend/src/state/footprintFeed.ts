import { createEffect, createRoot, on } from 'solid-js';
import { fetchFootprint } from '../api/client';
import { approxFootprint, footprintRowForView, type FootprintBar } from '../chart/profile';
import { rt } from './runtime';
import { candles, meta, ui } from './store';

/**
 * Footprint grafik tipi için veri akışı. Kripto: sunucudaki Binance aggTrades footprint'i
 * (görünür barlar, eksikler `pending` ile kademeli; oluşan bar 4 sn'de bir). Diğer piyasalar:
 * işlem akışı ücretsiz değil → bar içi yaklaşık profil (hücrelerde "~").
 */

const cache = new Map<string, Map<number, FootprintBar>>();
let timer: ReturnType<typeof setTimeout> | undefined;
let inflight = false;
let lastSig = '';

export function footprintRow(): number {
  const r = ui.styleParams.footprint.row;
  if (r > 0) return r;
  const times = new Set(rt.chart?.visibleBarTimes() ?? []);
  const vis = candles().filter((c) => times.has(c.time));
  return footprintRowForView(vis.length ? vis : candles().slice(-20), rt.chart?.chartHeight() ?? 600);
}

function keyOf(sym: string, tf: string, row: number): string {
  return `${sym}|${tf}|${row}`;
}

function approxMap(row: number): Map<number, FootprintBar> {
  const m = new Map<number, FootprintBar>();
  const list = candles();
  const times = new Set(rt.chart?.visibleBarTimes() ?? []);
  const from = Math.max(0, list.length - 400);
  for (let i = from; i < list.length; i++) {
    const c = list[i];
    if (times.size === 0 || times.has(c.time)) m.set(c.time, approxFootprint(c, row));
  }
  return m;
}

async function tick(): Promise<void> {
  timer = undefined;
  if (ui.chartStyle !== 'footprint' || !rt.chart) return;
  const m = meta();
  const row = footprintRow();
  if (!m || m.market !== 'CRYPTO') {
    rt.chart.setFootprintData(approxMap(row), row);
    schedule(4000);
    return;
  }
  const sym = m.symbol;
  const key = keyOf(sym, ui.interval, row);
  let store = cache.get(key);
  if (!store) {
    store = new Map();
    cache.set(key, store);
  }
  const vis = rt.chart.visibleBarTimes().slice(-200);
  const lastTime = candles()[candles().length - 1]?.time;
  // eksik ya da tamamlanmamış barlar (oluşan bar dahil) istenir
  const want = vis.filter((t) => !store!.get(t)?.complete || t === lastTime);
  let again = 4000;
  if (want.length > 0 && !inflight) {
    inflight = true;
    try {
      const res = await fetchFootprint(sym, ui.interval, row, want);
      if (res.supported && res.bars) {
        for (const b of res.bars) store.set(b.time, { time: b.time, rows: b.rows, delta: b.delta, total: b.total, poc: b.poc, complete: b.complete });
        if ((res.pending?.length ?? 0) > 0) again = 600; // bütçe bitti: kalanlar hemen ardından
      }
    } catch {
      again = 8000;
    } finally {
      inflight = false;
    }
  }
  if (ui.chartStyle === 'footprint' && meta()?.symbol === sym) rt.chart?.setFootprintData(store, row);
  schedule(again);
}

function schedule(ms: number): void {
  if (timer !== undefined) clearTimeout(timer);
  timer = setTimeout(() => void tick(), ms);
}

/** Görünür aralık değişince (kaydırma/yakınlaştırma) hemen yeniden ister. */
export function footprintViewportChanged(): void {
  if (ui.chartStyle !== 'footprint') return;
  const vis = rt.chart?.visibleBarTimes() ?? [];
  const sig = `${vis[0]}|${vis[vis.length - 1]}`;
  if (sig === lastSig) return;
  lastSig = sig;
  schedule(250);
}

export function startFootprintFeed(): () => void {
  return createRoot((dispose) => {
    createEffect(
      on(
        () => [ui.chartStyle, ui.symbol, ui.interval, ui.styleParams.footprint.row, meta()?.symbol] as const,
        ([style]) => {
          if (style === 'footprint') schedule(50);
          else if (timer !== undefined) {
            clearTimeout(timer);
            timer = undefined;
          }
        }
      )
    );
    return () => {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      dispose();
    };
  });
}
