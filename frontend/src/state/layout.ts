import { tt } from './i18n';
import type { ChartStyleMode, Timeframe } from '../types/market';

/** Tek grafik hücresi yapılandırması (16 grafiğe kadar her hücre bağımsız sembol/aralık/stil tutabilir). */
export interface ChartSlotConfig {
  symbol: string;
  interval: Timeframe;
  chartStyle?: ChartStyleMode;
}

/** Çizim eşitleme kapsamı: kapalı (yalnız o grafik), düzen içi, genel (tüm düzenler). */
export type DrawingSyncMode = 'off' | 'layout' | 'global';

/** Standart çoklu grafik + sekmeler arası eşitleme seçenekleri. */
export interface LayoutSyncOptions {
  symbol: boolean;
  interval: boolean;
  crosshair: boolean;
  time: boolean;
  dateRange: boolean;
  drawings: DrawingSyncMode;
  crossTab: boolean;
}

export const DEFAULT_SYNC: LayoutSyncOptions = {
  symbol: false,
  interval: false,
  crosshair: true,
  time: false,
  dateRange: false,
  drawings: 'layout',
  crossTab: false,
};

export interface LayoutTemplate {
  id: ChartLayout;
  count: number;
  cols: number;
  rows: number;
  /** 1-indeksli [colStart, colEnd, rowStart, rowEnd] CSS Grid alanları. */
  cells: ReadonlyArray<readonly [number, number, number, number]>;
  label: string;
}

function gridCells(cols: number, rows: number): Array<[number, number, number, number]> {
  const out: Array<[number, number, number, number]> = [];
  for (let r = 1; r <= rows; r++) {
    for (let c = 1; c <= cols; c++) {
      out.push([c, c + 1, r, r + 1]);
    }
  }
  return out;
}

export const LAYOUT_TEMPLATES = [
  // 1 grafik
  { id: 'single', count: 1, cols: 1, rows: 1, cells: [[1, 2, 1, 2]], label: 'Tek grafik (1×1)' },
  // 2 grafik
  { id: '2x1', count: 2, cols: 2, rows: 1, cells: [[1, 2, 1, 2], [2, 3, 1, 2]], label: '2 dikey (2×1)' },
  { id: '1x2', count: 2, cols: 1, rows: 2, cells: [[1, 2, 1, 2], [1, 2, 2, 3]], label: '2 yatay (1×2)' },
  // 3 grafik
  { id: '3v', count: 3, cols: 3, rows: 1, cells: gridCells(3, 1), label: '3 dikey' },
  { id: '3h', count: 3, cols: 1, rows: 3, cells: gridCells(1, 3), label: '3 yatay' },
  { id: '3-1l2r', count: 3, cols: 2, rows: 2, cells: [[1, 2, 1, 3], [2, 3, 1, 2], [2, 3, 2, 3]], label: tt("1 sol + 2 sağ") },
  { id: '3-2l1r', count: 3, cols: 2, rows: 2, cells: [[1, 2, 1, 2], [1, 2, 2, 3], [2, 3, 1, 3]], label: tt("2 sol + 1 sağ") },
  { id: '3-1t2b', count: 3, cols: 2, rows: 2, cells: [[1, 3, 1, 2], [1, 2, 2, 3], [2, 3, 2, 3]], label: tt("1 üst + 2 alt") },
  { id: '3-2t1b', count: 3, cols: 2, rows: 2, cells: [[1, 2, 1, 2], [2, 3, 1, 2], [1, 3, 2, 3]], label: tt("2 üst + 1 alt") },
  // 4 grafik
  { id: '2x2', count: 4, cols: 2, rows: 2, cells: gridCells(2, 2), label: tt("2×2 ızgara") },
  { id: '4v', count: 4, cols: 4, rows: 1, cells: gridCells(4, 1), label: '4 dikey' },
  { id: '4h', count: 4, cols: 1, rows: 4, cells: gridCells(1, 4), label: '4 yatay' },
  { id: '4-1l3r', count: 4, cols: 2, rows: 3, cells: [[1, 2, 1, 4], [2, 3, 1, 2], [2, 3, 2, 3], [2, 3, 3, 4]], label: tt("1 sol + 3 sağ") },
  { id: '4-3l1r', count: 4, cols: 2, rows: 3, cells: [[1, 2, 1, 2], [1, 2, 2, 3], [1, 2, 3, 4], [2, 3, 1, 4]], label: tt("3 sol + 1 sağ") },
  { id: '4-1t3b', count: 4, cols: 3, rows: 2, cells: [[1, 4, 1, 2], [1, 2, 2, 3], [2, 3, 2, 3], [3, 4, 2, 3]], label: tt("1 üst + 3 alt") },
  { id: '4-3t1b', count: 4, cols: 3, rows: 2, cells: [[1, 2, 1, 2], [2, 3, 1, 2], [3, 4, 1, 2], [1, 4, 2, 3]], label: tt("3 üst + 1 alt") },
  { id: '4-1l1m2r', count: 4, cols: 3, rows: 2, cells: [[1, 2, 1, 3], [2, 3, 1, 3], [3, 4, 1, 2], [3, 4, 2, 3]], label: tt("2 dikey + 2 sağ") },
  // 5 grafik
  { id: '5-2t3b', count: 5, cols: 6, rows: 2, cells: [[1, 4, 1, 2], [4, 7, 1, 2], [1, 3, 2, 3], [3, 5, 2, 3], [5, 7, 2, 3]], label: tt("2 üst + 3 alt") },
  { id: '5-3t2b', count: 5, cols: 6, rows: 2, cells: [[1, 3, 1, 2], [3, 5, 1, 2], [5, 7, 1, 2], [1, 4, 2, 3], [4, 7, 2, 3]], label: tt("3 üst + 2 alt") },
  { id: '5-1l4r', count: 5, cols: 3, rows: 2, cells: [[1, 2, 1, 3], [2, 3, 1, 2], [3, 4, 1, 2], [2, 3, 2, 3], [3, 4, 2, 3]], label: tt("1 sol + 2×2 sağ") },
  { id: '5-4l1r', count: 5, cols: 3, rows: 2, cells: [[1, 2, 1, 2], [2, 3, 1, 2], [1, 2, 2, 3], [2, 3, 2, 3], [3, 4, 1, 3]], label: tt("2×2 sol + 1 sağ") },
  { id: '5-1t4b', count: 5, cols: 4, rows: 2, cells: [[1, 5, 1, 2], [1, 2, 2, 3], [2, 3, 2, 3], [3, 4, 2, 3], [4, 5, 2, 3]], label: tt("1 üst + 4 alt") },
  { id: '5-2l3r', count: 5, cols: 2, rows: 6, cells: [[1, 2, 1, 4], [1, 2, 4, 7], [2, 3, 1, 3], [2, 3, 3, 5], [2, 3, 5, 7]], label: tt("2 sol + 3 sağ") },
  // 6 grafik
  { id: '3x2', count: 6, cols: 3, rows: 2, cells: gridCells(3, 2), label: tt("3×2 ızgara") },
  { id: '2x3', count: 6, cols: 2, rows: 3, cells: gridCells(2, 3), label: tt("2×3 ızgara") },
  { id: '6v', count: 6, cols: 6, rows: 1, cells: gridCells(6, 1), label: '6 dikey' },
  { id: '6h', count: 6, cols: 1, rows: 6, cells: gridCells(1, 6), label: '6 yatay' },
  { id: '6-1l5r', count: 6, cols: 9, rows: 2, cells: [[1, 4, 1, 3], [4, 7, 1, 2], [7, 10, 1, 2], [4, 6, 2, 3], [6, 8, 2, 3], [8, 10, 2, 3]], label: tt("1 sol + 5 sağ") },
  // 7 grafik
  { id: '7-3t4b', count: 7, cols: 12, rows: 2, cells: [[1, 5, 1, 2], [5, 9, 1, 2], [9, 13, 1, 2], [1, 4, 2, 3], [4, 7, 2, 3], [7, 10, 2, 3], [10, 13, 2, 3]], label: tt("3 üst + 4 alt") },
  { id: '7-4t3b', count: 7, cols: 12, rows: 2, cells: [[1, 4, 1, 2], [4, 7, 1, 2], [7, 10, 1, 2], [10, 13, 1, 2], [1, 5, 2, 3], [5, 9, 2, 3], [9, 13, 2, 3]], label: tt("4 üst + 3 alt") },
  { id: '7-1l6r', count: 7, cols: 4, rows: 2, cells: [[1, 2, 1, 3], [2, 3, 1, 2], [3, 4, 1, 2], [4, 5, 1, 2], [2, 3, 2, 3], [3, 4, 2, 3], [4, 5, 2, 3]], label: tt("1 sol + 3×2 sağ") },
  // 8 grafik
  { id: '4x2', count: 8, cols: 4, rows: 2, cells: gridCells(4, 2), label: tt("4×2 ızgara") },
  { id: '2x4', count: 8, cols: 2, rows: 4, cells: gridCells(2, 4), label: tt("2×4 ızgara") },
  { id: '8v', count: 8, cols: 8, rows: 1, cells: gridCells(8, 1), label: '8 dikey' },
  { id: '8-2t6b', count: 8, cols: 6, rows: 3, cells: [[1, 4, 1, 2], [4, 7, 1, 2], [1, 3, 2, 3], [3, 5, 2, 3], [5, 7, 2, 3], [1, 3, 3, 4], [3, 5, 3, 4], [5, 7, 3, 4]], label: tt("2 üst + 3×2 alt") },
  // 9 grafik
  { id: '3x3', count: 9, cols: 3, rows: 3, cells: gridCells(3, 3), label: tt("3×3 ızgara") },
  // 10 grafik
  { id: '5x2', count: 10, cols: 5, rows: 2, cells: gridCells(5, 2), label: tt("5×2 ızgara") },
  { id: '2x5', count: 10, cols: 2, rows: 5, cells: gridCells(2, 5), label: tt("2×5 ızgara") },
  // 12 grafik
  { id: '4x3', count: 12, cols: 4, rows: 3, cells: gridCells(4, 3), label: tt("4×3 ızgara") },
  { id: '3x4', count: 12, cols: 3, rows: 4, cells: gridCells(3, 4), label: tt("3×4 ızgara") },
  // 14 grafik
  { id: '7x2', count: 14, cols: 7, rows: 2, cells: gridCells(7, 2), label: tt("7×2 ızgara") },
  // 16 grafik
  { id: '4x4', count: 16, cols: 4, rows: 4, cells: gridCells(4, 4), label: tt("4×4 ızgara (16 grafik)") },
] as const;

export type ChartLayout = (typeof LAYOUT_TEMPLATES)[number]['id'];

export const LAYOUT_MAP: Record<ChartLayout, LayoutTemplate> = Object.fromEntries(
  LAYOUT_TEMPLATES.map((t) => [t.id, t])
) as unknown as Record<ChartLayout, LayoutTemplate>;

export const ALL_LAYOUT_IDS: ChartLayout[] = LAYOUT_TEMPLATES.map((t) => t.id);

/** Hızlı döngü (eski tek tık geçiş davranışı korunur). */
export const CHART_LAYOUTS: ChartLayout[] = ['single', '2x1', '2x2'];

export const MAX_CHARTS = 16;

/** Grafik sayısına göre gruplanmış Standart düzen şablonları (1..16). */
export const LAYOUT_GROUPS: Array<{ count: number; items: LayoutTemplate[] }> = (() => {
  const map = new Map<number, LayoutTemplate[]>();
  for (const t of LAYOUT_TEMPLATES) {
    const arr = map.get(t.count) ?? [];
    arr.push(t);
    map.set(t.count, arr);
  }
  return [...map.entries()].sort((a, b) => a[0] - b[0]).map(([count, items]) => ({ count, items }));
})();

/** 16 hücre için varsayılan semboller (0 = ana grafik, 1..15 = ek grafikler; ilk 4 resmî Binance). */
export const DEFAULT_SLOT_SYMBOLS: readonly string[] = [
  'BTCUSDT',
  'ETHUSDT',
  'SOLUSDT',
  'BNBUSDT',
  'XRPUSDT',
  'AVAXUSDT',
  'THYAO.IS',
  'XU100.IS',
  'USDTRY=X',
  'AAPL',
  'NVDA',
  'GC=F',
  'GARAN.IS',
  'MSFT',
  'EURUSD=X',
  'SISE.IS',
];

/** Geriye dönük: ilk 3 ek panelin varsayılan sembolleri. */
export const DEFAULT_SECONDARY = ['ETHUSDT', 'SOLUSDT', 'BNBUSDT'];

export function isChartLayout(v: unknown): v is ChartLayout {
  return typeof v === 'string' && v in LAYOUT_MAP;
}

export function getLayoutTemplate(l: ChartLayout): LayoutTemplate {
  return LAYOUT_MAP[l] ?? LAYOUT_MAP.single;
}

export function nextLayout(l: ChartLayout): ChartLayout {
  const idx = CHART_LAYOUTS.indexOf(l);
  return idx < 0 ? 'single' : CHART_LAYOUTS[(idx + 1) % CHART_LAYOUTS.length];
}

/** Ana grafik dışında kaç ek panel gösterilir (0..15). */
export function secondaryCount(l: ChartLayout): number {
  return Math.max(0, getLayoutTemplate(l).count - 1);
}

export const LAYOUT_LABEL: Record<string, string> = Object.fromEntries(
  LAYOUT_TEMPLATES.map((t) => [t.id, t.id === 'single' ? '1x1' : t.id])
);

export function defaultSlots(mainSymbol = 'BTCUSDT', interval: Timeframe = '15m'): ChartSlotConfig[] {
  return DEFAULT_SLOT_SYMBOLS.map((sym, i) => ({
    symbol: i === 0 ? mainSymbol : sym,
    interval,
  }));
}

export function normalizeSyncOptions(raw: unknown): LayoutSyncOptions {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...DEFAULT_SYNC };
  const o = raw as Record<string, unknown>;
  const drawings: DrawingSyncMode = o.drawings === 'off' || o.drawings === 'layout' || o.drawings === 'global' ? o.drawings : DEFAULT_SYNC.drawings;
  return {
    symbol: typeof o.symbol === 'boolean' ? o.symbol : DEFAULT_SYNC.symbol,
    interval: typeof o.interval === 'boolean' ? o.interval : DEFAULT_SYNC.interval,
    crosshair: typeof o.crosshair === 'boolean' ? o.crosshair : DEFAULT_SYNC.crosshair,
    time: typeof o.time === 'boolean' ? o.time : DEFAULT_SYNC.time,
    dateRange: typeof o.dateRange === 'boolean' ? o.dateRange : DEFAULT_SYNC.dateRange,
    drawings,
    crossTab: typeof o.crossTab === 'boolean' ? o.crossTab : DEFAULT_SYNC.crossTab,
  };
}

/** CSS Grid kapsayıcı stili (1..16 hücre için). */
export function gridContainerStyle(t: LayoutTemplate): Record<string, string> {
  if (t.count <= 1) return {};
  return {
    display: 'grid',
    'grid-template-columns': `repeat(${t.cols}, minmax(0, 1fr))`,
    'grid-template-rows': `repeat(${t.rows}, minmax(0, 1fr))`,
    gap: '1px',
  };
}

/** Hücrenin CSS Grid konumu. */
export function gridCellStyle(t: LayoutTemplate, index: number): Record<string, string> {
  const c = t.cells[index];
  if (!c || t.count <= 1) return {};
  return {
    'grid-column': `${c[0]} / ${c[1]}`,
    'grid-row': `${c[2]} / ${c[3]}`,
  };
}

/** Standart düzen seçici için şablon geometrisinden birebir üretilmiş minyatür SVG ikonu. */
export function layoutIconSvg(t: LayoutTemplate, size = 20): string {
  const pad = 1.5;
  const gap = t.count >= 9 ? 0.9 : 1.2;
  const w = size - pad * 2;
  const h = size - pad * 2;
  const rects = t.cells
    .map(([c1, c2, r1, r2]) => {
      const x = pad + ((c1 - 1) / t.cols) * w + gap / 2;
      const y = pad + ((r1 - 1) / t.rows) * h + gap / 2;
      const rw = Math.max(1.2, ((c2 - c1) / t.cols) * w - gap);
      const rh = Math.max(1.2, ((r2 - r1) / t.rows) * h - gap);
      return `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${rw.toFixed(2)}" height="${rh.toFixed(2)}" rx="1" fill="none" stroke="currentColor" stroke-width="1.2"/>`;
    })
    .join('');
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">${rects}</svg>`;
}
