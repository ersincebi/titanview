// Çalışma alanı kalıcılığı: tüm arayüz tercihleri tek JSON'da. Sunucuda (SQLite) tutulur; tarayıcı verisi
// silinse bile geri gelir. localStorage yalnız hızlı önbellek. Saf mantık (kurma/doğrulama) burada, I/O store'da.
import type { ChartStyleMode, DrawingToolType, PaperPosition, PaperClosedTrade, PriceAlert, PriceScaleKind } from '../types/market';
import type { ToolStyle } from '../chart/drawing/DrawingManager';
import { parseFavTools, parseTemplates, parseToolStyles, type DrawingTemplate } from './drawingPrefs';
import {
  MAX_CHARTS,
  isChartLayout,
  normalizeSyncOptions,
  type ChartLayout,
  type ChartSlotConfig,
  type LayoutSyncOptions,
} from './layout';
import type { ScaleSide } from '../chart/panes';
import { isValidInterval, normalizeInterval } from './format';

export const WORKSPACE_KEY = 'workspace';
export const WORKSPACE_VERSION = 1;

const CHART_STYLES: ChartStyleMode[] = [
  'candles', 'hollow', 'heikin', 'bar', 'line', 'area', 'baseline', 'stepline', 'linemarkers', 'renko', 'linebreak', 'range',
  'volcandles', 'hlcarea', 'columns', 'highlow', 'kagi', 'pnf', 'svp', 'tpo', 'footprint',
];
const SCALES: PriceScaleKind[] = ['normal', 'log', 'percent', 'indexed'];
/** Yalnız kendi başına anlamlı sekmeler geri yüklenir (analiz sekmeleri veri ister). */
const WB_TABS = ['script', 'backtest', 'screener', 'paper'] as const;
const MAX_CODE = 200_000;

export interface WorkspaceInput {
  symbol: string;
  interval: string;
  chartStyle: ChartStyleMode;
  scaleKind: PriceScaleKind;
  invertScale: boolean;
  scaleLock: boolean;
  mainScaleSide: 'right' | 'left';
  paneSides: Record<string, ScaleSide>;
  simple: boolean;
  styleParams?: Record<string, unknown>;
  layout: ChartLayout;
  secondarySymbols: string[];
  slots?: ChartSlotConfig[];
  sync?: LayoutSyncOptions;
  favTimeframes?: string[];
  customTimeframes?: string[];
  visual: Record<string, unknown>;
  quick: Record<string, boolean>;
  scriptCode: string;
  scriptCode2: string;
  magnet: boolean;
  magnetMode?: 'weak' | 'strong';
  stayInDrawing?: boolean;
  favTools?: DrawingToolType[];
  favBarVisible?: boolean;
  favBarPos?: { x: number; y: number };
  toolStyles?: Partial<Record<DrawingToolType, ToolStyle>>;
  drawTemplates?: DrawingTemplate[];
  iconChoice?: string;
  hideDrawings: boolean;
  wbTab: string;
  wbCollapsed: boolean;
  drawerTab: string | null;
  marketFilter: string;
  screenerMarket: string;
  quickQty: number;
  alerts: PriceAlert[];
  /** Faz 29: 7 sekmeli grafik ayarları, dil, renk teması, tüm çizim kilidi */
  chartSettings?: Record<string, unknown>;
  lang?: 'tr' | 'en';
  colorTheme?: string;
  allDrawingsLocked?: boolean;
  /** Faz 28 öncesi tarayıcı içi paper hesabı: yalnız eski kayıtları okumak için (artık sunucuda). */
  paper?: { cash: number; positions: PaperPosition[]; history: PaperClosedTrade[] };
}

/** Düzen revizyonu: arttıkça eski kayıtlardaki panel açık/kapalı durumu sıfırlanır. */
export const LAYOUT_REV = 14;

export interface WorkspaceDefaults {
  scriptCode: string;
  scriptCode2: string;
}

/**
 * Betik kodu varsayılanla aynıysa kaydedilmez (null): uygulama güncellenip varsayılan şablon iyileştiğinde
 * eski kopya yeni sürümü gölgelemesin. Kullanıcı düzenlediyse olduğu gibi saklanır.
 */
export function buildWorkspace(s: WorkspaceInput, d: WorkspaceDefaults): Record<string, unknown> {
  return {
    v: WORKSPACE_VERSION,
    symbol: s.symbol,
    interval: s.interval,
    chartStyle: s.chartStyle,
    scaleKind: s.scaleKind,
    invertScale: s.invertScale,
    scaleLock: s.scaleLock,
    mainScaleSide: s.mainScaleSide,
    paneSides: s.paneSides,
    simple: s.simple,
    styleParams: s.styleParams,
    layout: s.layout,
    secondarySymbols: s.secondarySymbols,
    ...(s.slots ? { slots: s.slots } : {}),
    ...(s.sync ? { sync: s.sync } : {}),
    ...(s.favTimeframes ? { favTimeframes: s.favTimeframes } : {}),
    ...(s.customTimeframes ? { customTimeframes: s.customTimeframes } : {}),
    visual: s.visual,
    quick: s.quick,
    scriptCode: s.scriptCode === d.scriptCode ? null : s.scriptCode,
    scriptCode2: s.scriptCode2 === d.scriptCode2 ? null : s.scriptCode2,
    magnet: s.magnet,
    magnetMode: s.magnetMode,
    stayInDrawing: s.stayInDrawing,
    favTools: s.favTools,
    favBarVisible: s.favBarVisible,
    favBarPos: s.favBarPos,
    toolStyles: s.toolStyles,
    drawTemplates: s.drawTemplates,
    iconChoice: s.iconChoice,
    hideDrawings: s.hideDrawings,
    wbTab: s.wbTab,
    wbCollapsed: s.wbCollapsed,
    layoutRev: LAYOUT_REV,
    drawerTab: s.drawerTab,
    marketFilter: s.marketFilter,
    screenerMarket: s.screenerMarket,
    quickQty: s.quickQty,
    alerts: s.alerts,
    ...(s.chartSettings ? { chartSettings: s.chartSettings } : {}),
    ...(s.lang ? { lang: s.lang } : {}),
    ...(s.colorTheme ? { colorTheme: s.colorTheme } : {}),
    ...(s.allDrawingsLocked !== undefined ? { allDrawingsLocked: s.allDrawingsLocked } : {}),
    paper: s.paper,
  };
}

export interface WorkspacePatch {
  symbol?: string;
  interval?: string;
  chartStyle?: ChartStyleMode;
  scaleKind?: PriceScaleKind;
  invertScale?: boolean;
  scaleLock?: boolean;
  mainScaleSide?: 'right' | 'left';
  paneSides?: Record<string, ScaleSide>;
  simple?: boolean;
  styleParams?: Record<string, unknown>;
  layout?: ChartLayout;
  secondarySymbols?: string[];
  slots?: ChartSlotConfig[];
  sync?: LayoutSyncOptions;
  favTimeframes?: string[];
  customTimeframes?: string[];
  visual?: Record<string, unknown>;
  quick?: Record<string, boolean>;
  scriptCode?: string;
  scriptCode2?: string;
  magnet?: boolean;
  magnetMode?: 'weak' | 'strong';
  stayInDrawing?: boolean;
  favTools?: DrawingToolType[];
  favBarVisible?: boolean;
  favBarPos?: { x: number; y: number };
  toolStyles?: Partial<Record<DrawingToolType, ToolStyle>>;
  drawTemplates?: DrawingTemplate[];
  iconChoice?: string;
  hideDrawings?: boolean;
  wbTab?: string;
  wbCollapsed?: boolean;
  drawerTab?: string | null;
  marketFilter?: string;
  screenerMarket?: string;
  quickQty?: number;
  alerts?: PriceAlert[];
  chartSettings?: Record<string, unknown>;
  lang?: 'tr' | 'en';
  colorTheme?: string;
  allDrawingsLocked?: boolean;
  paper?: WorkspaceInput['paper'];
}

const isStr = (v: unknown, max = 60): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;
const isBool = (v: unknown): v is boolean => typeof v === 'boolean';
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Bozuk/yabancı alanlar sessizce atılır; geçerli olanlar yama olarak döner. Geçersiz gövde → null. */
export function parseWorkspace(raw: unknown): WorkspacePatch | null {
  if (!isObj(raw)) return null;
  const p: WorkspacePatch = {};
  if (isStr(raw.symbol, 30)) p.symbol = raw.symbol.toUpperCase();
  if (isStr(raw.interval, 8) && isValidInterval(raw.interval)) {
    const norm = normalizeInterval(raw.interval);
    if (norm) p.interval = norm;
  }
  if (CHART_STYLES.includes(raw.chartStyle as ChartStyleMode)) p.chartStyle = raw.chartStyle as ChartStyleMode;
  if (SCALES.includes(raw.scaleKind as PriceScaleKind)) p.scaleKind = raw.scaleKind as PriceScaleKind;
  if (isBool(raw.invertScale)) p.invertScale = raw.invertScale;
  if (isBool(raw.scaleLock)) p.scaleLock = raw.scaleLock;
  if (raw.mainScaleSide === 'left' || raw.mainScaleSide === 'right') p.mainScaleSide = raw.mainScaleSide;
  if (isObj(raw.paneSides)) {
    const ps: Record<string, ScaleSide> = {};
    for (const id of ['rsi', 'macd', 'script']) {
      const v = raw.paneSides[id];
      if (v === 'left' || v === 'right' || v === 'split') ps[id] = v;
    }
    p.paneSides = ps;
  }
  if (isBool(raw.simple)) p.simple = raw.simple;
  if (isObj(raw.styleParams)) p.styleParams = raw.styleParams;
  if (isChartLayout(raw.layout)) p.layout = raw.layout;
  if (Array.isArray(raw.secondarySymbols) && raw.secondarySymbols.length >= 3 && raw.secondarySymbols.every((x) => isStr(x, 30))) {
    p.secondarySymbols = [...(raw.secondarySymbols as string[])];
  }
  if (Array.isArray(raw.slots) && raw.slots.length > 0 && raw.slots.length <= MAX_CHARTS) {
    const parsed: ChartSlotConfig[] = [];
    for (const it of raw.slots) {
      if (!isObj(it) || !isStr(it.symbol, 30)) continue;
      const iv = isStr(it.interval, 8) ? normalizeInterval(it.interval) : null;
      const st = CHART_STYLES.includes(it.chartStyle as ChartStyleMode) ? (it.chartStyle as ChartStyleMode) : undefined;
      parsed.push({ symbol: it.symbol.toUpperCase(), interval: iv ?? '15m', ...(st ? { chartStyle: st } : {}) });
    }
    if (parsed.length > 0) p.slots = parsed;
  }
  if (isObj(raw.sync)) p.sync = normalizeSyncOptions(raw.sync);
  if (Array.isArray(raw.favTimeframes)) {
    const favs = [...new Set(raw.favTimeframes.filter((x): x is string => isStr(x, 8)).map(normalizeInterval).filter((x): x is string => !!x))];
    if (favs.length > 0) p.favTimeframes = favs;
  }
  if (Array.isArray(raw.customTimeframes)) {
    p.customTimeframes = [...new Set(raw.customTimeframes.filter((x): x is string => isStr(x, 8)).map(normalizeInterval).filter((x): x is string => !!x))];
  }
  if (isObj(raw.visual)) p.visual = raw.visual;
  if (isObj(raw.quick)) {
    const q: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(raw.quick)) if (isBool(v)) q[k] = v;
    p.quick = q;
  }
  if (typeof raw.scriptCode === 'string' && raw.scriptCode.length <= MAX_CODE) p.scriptCode = raw.scriptCode;
  if (typeof raw.scriptCode2 === 'string' && raw.scriptCode2.length <= MAX_CODE) p.scriptCode2 = raw.scriptCode2;
  if (isBool(raw.magnet)) p.magnet = raw.magnet;
  if (isBool(raw.hideDrawings)) p.hideDrawings = raw.hideDrawings;
  if (raw.magnetMode === 'weak' || raw.magnetMode === 'strong') p.magnetMode = raw.magnetMode;
  if (isBool(raw.stayInDrawing)) p.stayInDrawing = raw.stayInDrawing;
  if (Array.isArray(raw.favTools)) p.favTools = parseFavTools(raw.favTools);
  if (isBool(raw.favBarVisible)) p.favBarVisible = raw.favBarVisible;
  if (isObj(raw.favBarPos) && num(raw.favBarPos.x) && num(raw.favBarPos.y)) p.favBarPos = { x: raw.favBarPos.x, y: raw.favBarPos.y };
  if (isObj(raw.toolStyles)) p.toolStyles = parseToolStyles(raw.toolStyles);
  if (Array.isArray(raw.drawTemplates)) p.drawTemplates = parseTemplates(raw.drawTemplates);
  if (typeof raw.iconChoice === 'string' && raw.iconChoice.length > 0 && raw.iconChoice.length <= 40) p.iconChoice = raw.iconChoice;
  if ((WB_TABS as readonly unknown[]).includes(raw.wbTab)) p.wbTab = raw.wbTab as string;
  // Faz 14: Standart düzeninde alt panel varsayılan kapalı; eski kayıtlardaki açık durum bir kez yok sayılır.
  if (isBool(raw.wbCollapsed) && num(raw.layoutRev) && raw.layoutRev >= LAYOUT_REV) p.wbCollapsed = raw.wbCollapsed;
  if (raw.drawerTab === null || isStr(raw.drawerTab, 30)) p.drawerTab = raw.drawerTab as string | null;
  if (isStr(raw.marketFilter, 12)) p.marketFilter = raw.marketFilter;
  if (isStr(raw.screenerMarket, 12)) p.screenerMarket = raw.screenerMarket;
  if (num(raw.quickQty) && raw.quickQty > 0) p.quickQty = raw.quickQty;
  if (Array.isArray(raw.alerts)) {
    p.alerts = raw.alerts.filter(
      (a): a is PriceAlert => isObj(a) && isStr(a.id, 80) && isStr(a.symbol, 30) && num(a.targetPrice) && isBool(a.triggered)
    );
  }
  if (isObj(raw.chartSettings)) p.chartSettings = raw.chartSettings;
  if (raw.lang === 'tr' || raw.lang === 'en') p.lang = raw.lang;
  if (isStr(raw.colorTheme, 40)) p.colorTheme = raw.colorTheme;
  if (isBool(raw.allDrawingsLocked)) p.allDrawingsLocked = raw.allDrawingsLocked;
  if (isObj(raw.paper) && num(raw.paper.cash) && Array.isArray(raw.paper.positions) && Array.isArray(raw.paper.history)) {
    p.paper = raw.paper as unknown as WorkspaceInput['paper'];
  }
  return p;
}
