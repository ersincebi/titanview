import type { LiveMarketSocket } from '../api/liveSocket';
import type { BarReplay } from '../chart/BarReplay';
import type { TitanChartController } from '../chart/ChartController';
import type { DrawingOverlay } from '../chart/DrawingOverlay';
import type { OrderLayer } from '../chart/OrderLayer';
import type { TabSyncBus } from './tabSync';

/**
 * İmperatif grafik nesneleri (lightweight-charts, SVG overlay, WS, replay, BroadcastChannel).
 * Reaktif değildir; bileşenler onMount'ta doldurur, onCleanup'ta boşaltır.
 */
export interface Runtime {
  chart?: TitanChartController;
  /** Ek grafikler (1..15 adet = toplam 16 grafik); indeks = panel sırası (slot - 1). */
  secondaries: Array<TitanChartController | undefined>;
  overlay?: DrawingOverlay;
  /** Ana grafikte emir/pozisyon çizgileri (Faz 28). */
  orders?: OrderLayer;
  /** Ek grafiklerin çizim katmanları (çizim eşitlemesi için). */
  secondaryOverlays: Array<DrawingOverlay | undefined>;
  socket?: LiveMarketSocket;
  replay?: BarReplay;
  tabBus?: TabSyncBus;
}

export const rt: Runtime = { secondaries: [], secondaryOverlays: [] };

/** Slot numarasından (0 = ana grafik, 1..15 = ek grafik) denetleyiciye erişir. */
export function getChartBySlot(slot: number): TitanChartController | undefined {
  return slot === 0 ? rt.chart : rt.secondaries[slot - 1];
}

/** Slot numarasından (0 = ana, 1..15 = ek) çizim katmanına erişir. */
export function getOverlayBySlot(slot: number): DrawingOverlay | undefined {
  return slot === 0 ? rt.overlay : rt.secondaryOverlays[slot - 1];
}

export function clearRuntime(): void {
  rt.socket?.destroy();
  rt.tabBus?.destroy();
  rt.chart = undefined;
  rt.secondaries = [];
  rt.orders?.destroy();
  rt.orders = undefined;
  rt.overlay = undefined;
  rt.secondaryOverlays = [];
  rt.socket = undefined;
  rt.replay = undefined;
  rt.tabBus = undefined;
}
