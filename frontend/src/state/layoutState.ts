import { tt } from './i18n';
import { createSignal } from 'solid-js';
import type { LayoutSummary } from '../api/layouts';
import type { Candle, DrawingObject } from '../types/market';
import type { CrosshairHoverData } from '../chart/ChartController';

export interface ReadOnlyLayoutInfo {
  name: string;
  shareToken: string;
  drawings: DrawingObject[];
}

export interface SlotRuntimeInfo {
  lastCandle: Candle | null;
  prevClose: number | null;
  hover: CrosshairHoverData | null;
  loading: boolean;
  error: string | null;
  exchange: string;
  /** Grafikte gerçekten yüklü olan `SYM|IV` anahtarı (yükleme sırasında yanlış sembol tick'i karışmasın). */
  loadedKey: string;
}

export const [savedLayouts, setSavedLayouts] = createSignal<LayoutSummary[]>([]);
export const [activeLayoutId, setActiveLayoutId] = createSignal<string | null>(null);
export const [activeLayoutName, setActiveLayoutName] = createSignal<string>(tt("Adsız"));
export const [layoutAutosave, setLayoutAutosave] = createSignal<boolean>(true);
export const [layoutIsShared, setLayoutIsShared] = createSignal<boolean>(false);
export const [layoutShareToken, setLayoutShareToken] = createSignal<string>('');
export const [layoutDirty, setLayoutDirty] = createSignal<boolean>(false);
export const [readOnlyLayout, setReadOnlyLayout] = createSignal<ReadOnlyLayoutInfo | null>(null);
/** BroadcastChannel üzerinden bağlı diğer açık TitanView sekme sayısı. */
export const [connectedTabs, setConnectedTabs] = createSignal<number>(0);

/** Ek grafik hücrelerinin (1..15) canlı özet/hover/hata durumu. */
export const [slotInfos, setSlotInfos] = createSignal<Record<number, SlotRuntimeInfo>>({});

export function patchSlotInfo(slot: number, patch: Partial<SlotRuntimeInfo>): void {
  setSlotInfos((prev) => {
    const cur: SlotRuntimeInfo = prev[slot] ?? {
      lastCandle: null,
      prevClose: null,
      hover: null,
      loading: false,
      error: null,
      exchange: '',
      loadedKey: '',
    };
    return { ...prev, [slot]: { ...cur, ...patch } };
  });
}

export function resetLayoutState(): void {
  setSavedLayouts([]);
  setActiveLayoutId(null);
  setActiveLayoutName(tt("Adsız"));
  setLayoutAutosave(true);
  setLayoutIsShared(false);
  setLayoutShareToken('');
  setLayoutDirty(false);
  setReadOnlyLayout(null);
  setConnectedTabs(0);
  setSlotInfos({});
}
