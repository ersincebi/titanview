import type { DrawingObject } from '../types/market';
import type { DrawingSyncMode, LayoutSyncOptions } from './layout';
import type { TabSyncBus } from './tabSync';

export interface SyncChartLike {
  setExternalCrosshair(timeSec: number | null): void;
  alignToTime(timeSec: number): boolean;
  setVisibleTimeRange(from: number, to: number): boolean;
}

export interface SyncOverlayLike {
  setDrawings(list: DrawingObject[]): void;
  render(): void;
}

export interface DrawingScope {
  layoutId: string;
  scope: 'global' | 'layout' | 'local';
}

/** Çizim eşitleme moduna göre sunucu kayıt kapsamını belirler. */
export function drawingScopeFor(mode: DrawingSyncMode, activeLayoutId: string, slotIndex: number): DrawingScope {
  if (mode === 'global') return { layoutId: '', scope: 'global' };
  const base = activeLayoutId || 'default';
  if (mode === 'layout') return { layoutId: base, scope: 'layout' };
  return { layoutId: `${base}#slot:${slotIndex}`, scope: 'local' };
}

let inCrosshair = false;
let inTime = false;
let inRange = false;

/** İmleç eşitlemesi: kaynak grafikten diğer tüm grafiklere (+ açık sekmelere) yayar. */
export function propagateCrosshair(
  sourceSlot: number,
  timeSec: number | null,
  slotCount: number,
  opts: LayoutSyncOptions,
  getChart: (slot: number) => SyncChartLike | undefined,
  tabBus?: TabSyncBus,
  fromRemote = false
): void {
  if (!opts.crosshair || inCrosshair) return;
  inCrosshair = true;
  try {
    for (let i = 0; i < slotCount; i++) {
      if (i === sourceSlot) continue;
      getChart(i)?.setExternalCrosshair(timeSec);
    }
    if (!fromRemote && opts.crossTab) {
      tabBus?.send({ type: 'crosshair', time: timeSec }, 30);
    }
  } finally {
    inCrosshair = false;
  }
}

/** Zaman eşitlemesi: bir grafikte bara tıklanınca tüm diğer grafikleri yakınlaştırmasını koruyarak o zamana ortalar. */
export function propagateTimeClick(
  sourceSlot: number,
  timeSec: number,
  slotCount: number,
  opts: LayoutSyncOptions,
  getChart: (slot: number) => SyncChartLike | undefined,
  tabBus?: TabSyncBus,
  fromRemote = false
): void {
  if (!opts.time || inTime) return;
  inTime = true;
  try {
    for (let i = 0; i < slotCount; i++) {
      if (i === sourceSlot) continue;
      getChart(i)?.alignToTime(timeSec);
    }
    if (!fromRemote && opts.crossTab) {
      tabBus?.send({ type: 'time', time: timeSec });
    }
  } finally {
    inTime = false;
  }
}

/** Tarih aralığı eşitlemesi: kaynak grafiğin [from, to] görünür zaman aralığını tüm diğer grafiklere uygular. */
export function propagateDateRange(
  sourceSlot: number,
  range: { from: number; to: number } | null,
  slotCount: number,
  opts: LayoutSyncOptions,
  getChart: (slot: number) => SyncChartLike | undefined,
  tabBus?: TabSyncBus,
  fromRemote = false
): void {
  if (!opts.dateRange || !range || range.to <= range.from || inRange) return;
  inRange = true;
  try {
    for (let i = 0; i < slotCount; i++) {
      if (i === sourceSlot) continue;
      getChart(i)?.setVisibleTimeRange(range.from, range.to);
    }
    if (!fromRemote && opts.crossTab) {
      tabBus?.send({ type: 'dateRange', from: range.from, to: range.to }, 50);
    }
  } finally {
    inRange = false;
  }
}

/** Çizim eşitlemesi: aynı sembolü gösteren diğer hücrelerin çizim katmanlarını anında günceller. */
export function propagateDrawings(
  sourceSlot: number,
  symbol: string,
  list: DrawingObject[],
  slotCount: number,
  opts: LayoutSyncOptions,
  slotSymbol: (slot: number) => string,
  getOverlay: (slot: number) => SyncOverlayLike | undefined,
  activeLayoutId: string,
  tabBus?: TabSyncBus,
  fromRemote = false
): void {
  if (opts.drawings === 'off') return;
  const sym = symbol.toUpperCase();
  const cloned = list.map((d) => ({ ...d, points: d.points.map((p) => ({ ...p })) }));
  for (let i = 0; i < slotCount; i++) {
    if (i === sourceSlot) continue;
    if (slotSymbol(i).toUpperCase() !== sym) continue;
    const ov = getOverlay(i);
    if (ov) {
      ov.setDrawings(cloned.map((d) => ({ ...d, points: d.points.map((p) => ({ ...p })) })));
      ov.render();
    }
  }
  if (!fromRemote && (opts.crossTab || opts.drawings === 'global')) {
    const scope = drawingScopeFor(opts.drawings, activeLayoutId, sourceSlot);
    tabBus?.send({ type: 'drawings', symbol: sym, layoutId: scope.layoutId });
  }
}
