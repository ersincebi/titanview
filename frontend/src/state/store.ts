import { tfmt } from './i18n';
import { batch, createEffect, createRoot, createSignal } from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import {
  clearSymbolDrawings,
  fetchCorporateEvents,
  fetchDrawings,
  fetchFxRates,
  fetchSavedScripts,
  syncCollectSymbols,
  fetchCollectItems,
  fetchHistory,
  fetchQuotes,
  fetchScreener,
  fetchSymbols,
  type LiveQuote,
  type SavedScriptItem,
  persistDrawing,
  saveCustomScript,
  fetchSetting,
  saveSetting,
} from '../api/client';
import { LiveMarketSocket } from '../api/liveSocket';
import { isUnofficialDisabledError } from '../api/sourceErrors';
import { classifyFeed, isTickForCurrent, lastTickAt, markTick, mergeTail, nowMs, setNowMs, type FeedHealth } from './liveFeed';
import { refreshAnalysisSoft, startAnalysisLive } from './analysisStore';
import { startFootprintFeed } from './footprintFeed';
import { WORKSPACE_KEY, buildWorkspace, parseWorkspace, type WorkspaceInput } from './workspace';
import { BarReplay } from '../chart/BarReplay';
import type { ActiveQuickIndicators, CrosshairHoverData } from '../chart/ChartController';
import type { CompareScale, PaneId, ScaleSide } from '../chart/panes';
import { BUILTIN_SCRIPT_PRESETS } from '../script/presets';
import { DEFAULT_STYLE_PARAMS, deriveCandles, isDerivedStyle, normalizeStyleParams, type StyleParams } from '../chart/chartTypes';
import {
  buildLibraryRegistry,
  executeScript,
  extractScriptRequests,
  scriptRunOptions,
  scriptTimeframeToApi,
  type RunOptions,
} from '../script/runtime';
import { btRange, deepStatus, magnifierCandles, magnifierOn, resetDeepTest, trimRange } from './deepTest';
import { LANG_NAME } from '../script/brand';
import { runScriptWorker } from '../script/scriptClient';
import { mergeScriptResults } from '../script/merge';
import type {
  Candle,
  ChartStyleMode,
  CorporateEventsData,
  DrawingObject,
  DrawingToolType,
  DrawingVisibility,
  FxRatePoint,
  HistoryResponse,
  ScriptExecutionResult,
  PriceAlert,
  PriceScaleKind,
  ScreenerRow,
  SymbolQuoteSummary,
  Timeframe,
} from '../types/market';
import {
  POPULAR_TIMEFRAMES,
  RANGE_JUMP_TF,
  buildCustomInterval,
  errorMessage,
  intervalSeconds,
  isValidInterval,
  normalizeInterval,
  sortIntervals,
  type IntervalUnit,
} from './format';
import { getChartBySlot, getOverlayBySlot, rt } from './runtime';
import { DEFAULT_INDICATORS, TEMPLATES, type TemplateKey, templateFlags } from './templates';
import { candleChangePct } from './reports';
import { applyQuote, type MarketFilter, type WatchlistTab } from './watchlist';
import { needsResolve, resolveSymbol, resolvedInfo } from './symbolResolve';
import { repairBareWatchlistSymbols } from './watchlistStore';
import { favoriteFor, loadFavorites, mergeFavorites, saveFavorites, toggleFavorite, type Favorite } from './favorites';
import { isMobileWidth } from './mobile';
import {
  DEFAULT_SECONDARY,
  DEFAULT_SLOT_SYMBOLS,
  DEFAULT_SYNC,
  MAX_CHARTS,
  defaultSlots,
  getLayoutTemplate,
  isChartLayout,
  nextLayout,
  normalizeSyncOptions,
  secondaryCount,
  type ChartLayout,
  type ChartSlotConfig,
  type LayoutSyncOptions,
} from './layout';
import {
  drawingScopeFor,
  propagateCrosshair,
  propagateDateRange,
  propagateDrawings,
  propagateTimeClick,
} from './chartSync';
import { TabSyncBus, type TabSyncMessage } from './tabSync';
import {
  activeLayoutId,
  patchSlotInfo,
  readOnlyLayout,
  resetLayoutState,
  setConnectedTabs,
  setLayoutDirty,
  slotInfos,
} from './layoutState';
import type { ToolStyle } from '../chart/drawing/DrawingManager';
import type { EventLayerOptions } from '../chart/EventLayer';
import type { DisplayCurrency } from './symbolExpr';
import { DEFAULT_TOOL_COLOR } from '../chart/drawing/toolSpec';
import { normalizeVisibility } from '../chart/drawing/visibility';
import { cleanStyle, removeTemplate, saveTemplate, styleOf, toggleFavTool, type DrawingTemplate } from './drawingPrefs';
import {
  DEFAULT_CHART_SETTINGS,
  cloneChartSettings,
  normalizeChartSettings,
  type ChartSettings,
} from './chartSettings';
import {
  canRedo,
  canUndo,
  clearHistory,
  pushHistory,
  redoHistory,
  undoHistory,
  withoutHistory,
} from './history';
import { lang, langExplicit, setLang, t, tt } from './i18n';
import { markFirstChartData, markTickRendered, tickClock } from './perf';
import { applyColorTheme, colorThemeId } from './theme';

export type RightDrawerTab =
  | 'watchlist'
  | 'alerts'
  | 'news'
  | 'datawindow'
  | 'hotlists'
  | 'calendar'
  | 'notes'
  | 'ideas'
  | 'chats'
  | 'notifications'
  | 'orderpanel'
  | 'objecttree'
  | 'help';

export type WorkbenchTab =
  | 'script'
  | 'backtest'
  | 'screener'
  | 'paper'
  | 'market'
  | 'corr'
  | 'des'
  | 'news'
  | 'whale'
  | 'insight'
  | 'ideas'
  | 'financials'
  | 'calendar'
  | 'options';
export type ModalKind =
  | 'fx'
  | 'settings'
  | 'templates'
  | 'search'
  | 'compare'
  | 'alert'
  | 'about'
  | 'command'
  | 'layouts'
  | 'goto'
  | 'shortcuts'
  | 'mobileMore'
  | 'server'
  | null;
export type MenuKind = 'tf' | 'style' | 'layoutGrid' | 'layoutManage' | 'currency' | 'mainMenu' | 'snapshot' | 'timezone' | null;

export interface VisualSettings {
  upColor: string;
  downColor: string;
  bgColor: string;
  showGrid: boolean;
  showQuickTrade: boolean;
}

export const DEFAULT_VISUAL: VisualSettings = {
  upColor: '#089981',
  downColor: '#F23645',
  bgColor: '#000000',
  showGrid: true,
  showQuickTrade: true,
};

/** Eski kayıtlardaki mavi-gri tuval rengi (#131722) yeni siyah palete çekilir. */
function migrateVisual(v: VisualSettings): VisualSettings {
  return v.bgColor.toLowerCase() === '#131722' ? { ...v, bgColor: DEFAULT_VISUAL.bgColor } : v;
}

export const GROUP_DEFAULTS = {
  trend: 'trendline',
  fib: 'fib',
  patterns: 'xabcd',
  shapes: 'rect',
  measure: 'long_pos',
  text: 'text',
} as const satisfies Record<string, DrawingToolType>;

interface UiState {
  symbol: string;
  interval: Timeframe;
  chartStyle: ChartStyleMode;
  scaleKind: PriceScaleKind;
  invertScale: boolean;
  /** Fiyat/bar oranı kilidi ("ölçeği kilitle"). */
  scaleLock: boolean;
  /** Ana pane fiyat ölçeği tarafı. */
  mainScaleSide: 'right' | 'left';
  /** Karşılaştırma serisinin ölçeği: aynı / sol / kendi (çoklu ölçek). */
  compareScale: CompareScale;
  /** Alt pane ölçek tarafları (rsi/macd/script). */
  paneSides: Record<string, ScaleSide>;
  /** Betik alt paneli ✕ ile gizlendi (▶ Grafiğe Uygula geri getirir). */
  scriptSubHidden: boolean;
  /** Sade mod: gelişmiş analiz yüzeyleri gizlenir, yalın grafik görünümü. */
  simple: boolean;
  /** Faz 16: grafik tipi parametreleri (Renko/Range/Line Break/Kagi/P&F, profil, TPO, footprint) */
  styleParams: StyleParams;
  marketFilter: WatchlistTab;
  searchQuery: string;
  compareSymbol: string | null;
  layout: ChartLayout;
  /** Geriye dönük: ilk 3 ek panel sembolü (slots[1..3] ile senkron). */
  secondarySymbols: string[];
  /** Faz 25: 16 grafiğe kadar her hücrenin sembol/aralık/stil yapılandırması. */
  slots: ChartSlotConfig[];
  /** Faz 25: seçili grafik hücresi (0 = ana grafik, 1..15 = ek grafikler). */
  activeSlot: number;
  /** Faz 25: çoklu düzende tek grafiği tam ekrana büyüt (Alt+Enter); null = ızgara görünümü. */
  maximizedSlot: number | null;
  /** Faz 25: çoklu grafik + sekmeler arası eşitleme seçenekleri. */
  sync: LayoutSyncOptions;
  /** Faz 25: üst çubuğa yıldızla sabitlenen favori zaman aralıkları. */
  favTimeframes: Timeframe[];
  /** Faz 25: kullanıcının eklediği özel aralıklar (ör. 7s, 45m, 5h, 2d, 2M). */
  customTimeframes: Timeframe[];
  /** Faz 26: grafik fiyat dönüştürme para birimi ('' = sembolün doğal para birimi, 'USD' | 'TRY' | 'EUR'). */
  displayCurrency: DisplayCurrency;
  /** Faz 26: grafikte kurumsal olay işaretleri (D: temettü, S: bölünme, E: bilanço). */
  eventFlags: EventLayerOptions;
  drawerTab: RightDrawerTab | null;
  mobile: boolean;
  toolsOpen: boolean;
  online: boolean;
  wbCollapsed: boolean;
  wbTab: WorkbenchTab;
  screenerMarket: MarketFilter;
  modal: ModalKind;
  menu: MenuKind;
  menuPos: { left: number; top: number };
  tool: DrawingToolType;
  groupTool: Record<keyof typeof GROUP_DEFAULTS, DrawingToolType>;
  drawColor: string;
  magnet: boolean;
  /** Faz 22: mıknatıs açıkken zayıf / güçlü */
  magnetMode: 'weak' | 'strong';
  /** Faz 22: çizimde kal (araç bitince imlece dönme) */
  stayInDrawing: boolean;
  /** Faz 22: favori çizim araçları + yüzen çubuk */
  favTools: DrawingToolType[];
  favBarVisible: boolean;
  favBarPos: { x: number; y: number };
  /** Faz 22: araç başına stil hafızası */
  toolStyles: Partial<Record<DrawingToolType, ToolStyle>>;
  /** Faz 22: kayıtlı çizim şablonları */
  drawTemplates: DrawingTemplate[];
  /** Faz 22: ikon aracının yerleştireceği ikon */
  iconChoice: string;
  hideDrawings: boolean;
  /** Faz 29: tüm çizim araçlarını kilitle (sol çubuk kilidi) */
  allDrawingsLocked: boolean;
  /** Faz 29: sol çubuk kutu yakınlaştırma modu */
  zoomMode: boolean;
  /** Faz 29: Sembol Arama vs ⌘K Hızlı Arama kipi ve ön-yazılan harf */
  searchMode: 'symbol' | 'quick';
  searchInitialQuery: string;
  /** Faz 29: rakam / virgül ile açılan hızlı aralık değiştirici */
  quickIntervalOpen: boolean;
  quickIntervalText: string;
  /** Faz 29: 7 sekmeli Standart Ayarlar modeli */
  chartSettings: ChartSettings;
  visual: VisualSettings;
  quick: ActiveQuickIndicators;
  replayActive: boolean;
  wsConnected: boolean;
  scriptCode: string;
  /** İkinci betik (ör. bir gösterge) birincil betik (ör. strateji) ile aynı grafikte çalışır; '' = yok. */
  scriptCode2: string;
  scriptNote: string | null;
  quickQty: number;
  ticketSide: 'LONG' | 'SHORT';
  ticketQty: number;
}

function initialUi(): UiState {
  return {
    symbol: 'BTCUSDT',
    interval: '15m',
    chartStyle: 'candles',
    scaleKind: 'normal',
    invertScale: false,
    scaleLock: false,
    mainScaleSide: 'right',
    compareScale: 'same',
    paneSides: {},
    scriptSubHidden: false,
    simple: false,
    styleParams: normalizeStyleParams(DEFAULT_STYLE_PARAMS),
    marketFilter: 'ALL',
    searchQuery: '',
    compareSymbol: null,
    layout: 'single',
    secondarySymbols: [...DEFAULT_SECONDARY],
    slots: defaultSlots('BTCUSDT', '15m'),
    activeSlot: 0,
    maximizedSlot: null,
    sync: { ...DEFAULT_SYNC },
    favTimeframes: [...POPULAR_TIMEFRAMES],
    customTimeframes: [],
    displayCurrency: '',
    eventFlags: { dividends: true, splits: true, earnings: true },
    drawerTab: 'watchlist',
    mobile: false,
    toolsOpen: false,
    online: true,
    wbCollapsed: true,
    wbTab: 'backtest',
    screenerMarket: 'ALL',
    modal: null,
    menu: null,
    menuPos: { left: 0, top: 0 },
    tool: 'cursor',
    groupTool: { ...GROUP_DEFAULTS },
    drawColor: '#0284C7',
    magnet: false,
    magnetMode: 'strong',
    stayInDrawing: false,
    favTools: [],
    favBarVisible: true,
    favBarPos: { x: 80, y: 90 },
    toolStyles: {},
    drawTemplates: [],
    iconChoice: 'i:star',
    hideDrawings: false,
    allDrawingsLocked: false,
    zoomMode: false,
    searchMode: 'symbol',
    searchInitialQuery: '',
    quickIntervalOpen: false,
    quickIntervalText: '',
    chartSettings: cloneChartSettings(DEFAULT_CHART_SETTINGS),
    visual: { ...DEFAULT_VISUAL },
    quick: { ...DEFAULT_INDICATORS },
    replayActive: false,
    wsConnected: false,
    scriptCode: BUILTIN_SCRIPT_PRESETS[0].code,
    scriptCode2: '',
    scriptNote: null,
    quickQty: 100,
    ticketSide: 'LONG',
    ticketQty: 100,
  };
}

export const [ui, setUi] = createStore<UiState>(initialUi());

export const [candles, setCandles] = createSignal<Candle[]>([], { equals: false });
export const [meta, setMeta] = createSignal<Omit<HistoryResponse, 'candles'> | null>(null);
export const [symbols, setSymbols] = createSignal<SymbolQuoteSummary[]>([]);
export const [screenerRows, setScreenerRows] = createSignal<ScreenerRow[]>([]);
export const [drawings, setDrawings] = createSignal<DrawingObject[]>([]);
export const [selectedDrawing, setSelectedDrawing] = createSignal<DrawingObject | null>(null);
export const [hover, setHover] = createSignal<CrosshairHoverData | null>(null);
export const [scriptResult, setScriptResult] = createSignal<ScriptExecutionResult | null>(null);
/** Yalnız birincil (editördeki) betiğin sonucu: durum çubuğu/hata bunu gösterir. */
export const [scriptMain, setScriptMain] = createSignal<ScriptExecutionResult | null>(null);
/** Yerel `/api/scripts` deposundan yüklenen kayıtlı betikler ve `library(...)` modülleri. */
export const [savedScripts, setSavedScripts] = createSignal<SavedScriptItem[]>([]);
/** Kullanıcı tarafından Betik Girdileri sekmesinden değiştirilen `input.*` değerleri. */
export const [scriptInputOverrides, setScriptInputOverrides] = createSignal<Record<string, unknown>>({});

export interface ComparisonSeriesItem {
  symbol: string;
  color: string;
  scaleMode: CompareScale;
  visible: boolean;
  candles: Candle[];
  lastClose?: number | null;
  changePct?: number | null;
}

export const COMPARE_COLORS = ['#FF9800', '#0284C7', '#E91E63', '#00BCD4', '#AB47BC', '#4CAF50'];
/** Faz 26: çoklu karşılaştır / üst üste bindir serileri. */
export const [comparisons, setComparisons] = createSignal<ComparisonSeriesItem[]>([]);
/** Faz 26: aktif sembolün Yahoo kurumsal olayları (temettü, bölünme, bilanço). */
export const [chartEvents, setChartEvents] = createSignal<CorporateEventsData | null>(null);

export interface ScriptPickTarget {
  inputKey: string;
  inputTitle: string;
  kind: 'time' | 'price' | 'both';
  pairedKey?: string;
  /** Faz 20: grafikteki gösterge örneğinin girdisi (editördeki betik değil) */
  studyUid?: string;
}

type StudyPickHandler = (target: ScriptPickTarget, timeSec: number | null, price: number | null) => boolean;
let studyPickHandler: StudyPickHandler | null = null;
/** studies.ts kaydeder: gösterge girdisi grafikten seçilince store yerine o güncellenir (döngüsel import yok). */
export function setStudyPickHandler(fn: StudyPickHandler | null): void {
  studyPickHandler = fn;
}

const scriptRunHooks: Array<() => void> = [];
/** Faz 24: TitanScript sonucu uygulanınca (eskimiş değil) çağrılır — derin backtest / optimizasyon akışı bekler. */
const scriptAppliedHooks = new Set<() => void>();
export function onScriptApplied(fn: () => void): () => void {
  scriptAppliedHooks.add(fn);
  return () => scriptAppliedHooks.delete(fn);
}
/** Betik yeniden çalıştığında (veri/sembol/aralık/tick) grafikteki göstergeler de yeniden hesaplanır. */
export function onScriptRun(fn: () => void): () => void {
  scriptRunHooks.push(fn);
  return () => {
    const i = scriptRunHooks.indexOf(fn);
    if (i >= 0) scriptRunHooks.splice(i, 1);
  };
}
/** `input.time` / `input.price` için grafikten tıklayarak seçim modu. */
export const [scriptPickTarget, setScriptPickTarget] = createSignal<ScriptPickTarget | null>(null);

/** Eski (Faz 2) yerel fiyat alarmları — yalnız göç için (bkz. `migrateLegacy`). */
export const [alerts, setAlerts] = createSignal<PriceAlert[]>([]);
export const [toastMsg, setToastMsg] = createSignal('');
export const [loadError, setLoadError] = createSignal<string | null>(null);
export const [loadErrorUnofficial, setLoadErrorUnofficial] = createSignal(false);
export const [loading, setLoading] = createSignal(false);

/** Grafik ve kabuk sağ-tık menüsü (5 bağlam: chart, scale, drawing, study, series). */
export type CtxMenuKind = 'chart' | 'scale' | 'drawing' | 'study' | 'series';
export interface CtxMenuState {
  kind?: CtxMenuKind;
  x: number;
  y: number;
  price: number | null;
  time: number | null;
  drawingId?: string;
  studyUid?: string;
  quickKey?: keyof ActiveQuickIndicators;
}
export const [ctxMenu, setCtxMenu] = createSignal<CtxMenuState | null>(null);

export function resetStore(): void {
  if (notifyTimer !== undefined) clearTimeout(notifyTimer);
  notifyTimer = undefined;
  clearHistory();
  savedScriptsLoaded = false;
  lowerTfCache.clear();
  eventsCache.clear();
  fxCache.clear();
  symbolCache.clear();
  secLoadSeq.clear();
  batch(() => {
    setUi(reconcile(initialUi()));
    resetLayoutState();
    setCandles([]);
    setMeta(null);
    setSymbols([]);
    setScreenerRows([]);
    setDrawings([]);
    setSelectedDrawing(null);
    setHover(null);
    setScriptResult(null);
    setScriptMain(null);
    setSavedScripts([]);
    setScriptInputOverrides({});
    setScriptPickTarget(null);
    lastCompareInterval = '';
    setComparisons([]);
    setChartEvents(null);
    setAlerts([]);
    setToastMsg('');
    setLoadError(null);
    setLoading(false);
  });
}

// ---------- yardımcılar ----------

let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function toast(msg: string): void {
  setToastMsg(msg);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => setToastMsg(''), 2600);
}

export function scheduleResize(ms = 50): void {
  setTimeout(() => {
    rt.chart?.resize();
    for (const c of rt.secondaries) c?.resize();
  }, ms);
}

export function syncDrawings(): void {
  setDrawings(rt.overlay ? [...rt.overlay.getDrawings()] : []);
}

export function visibleSlotCount(): number {
  return getLayoutTemplate(ui.layout).count;
}

export function slotSymbolAt(slot: number): string {
  if (slot <= 0) return ui.symbol;
  return ui.slots[slot]?.symbol ?? ui.secondarySymbols[slot - 1] ?? DEFAULT_SLOT_SYMBOLS[slot] ?? 'BTCUSDT';
}

export function slotIntervalAt(slot: number): Timeframe {
  if (slot <= 0) return ui.interval;
  return ui.slots[slot]?.interval ?? ui.interval;
}

export function activeChartSymbol(): string {
  return slotSymbolAt(ui.activeSlot);
}

export function activeChartInterval(): Timeframe {
  return slotIntervalAt(ui.activeSlot);
}

/** Tüm görünür grafiklerin tekilleştirilmiş canlı WS akış listesi. */
export function activeStreams(): Array<{ symbol: string; interval: Timeframe }> {
  const n = visibleSlotCount();
  const seen = new Set<string>();
  const out: Array<{ symbol: string; interval: Timeframe }> = [];
  for (let i = 0; i < n; i++) {
    const sym = slotSymbolAt(i).toUpperCase();
    const iv = slotIntervalAt(i);
    const key = `${sym}|${iv}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push({ symbol: sym, interval: iv });
    }
  }
  return out;
}

export function syncLiveSubscriptions(): void {
  const list = activeStreams();
  if (list.length <= 1) rt.socket?.sendSubscribe(ui.symbol, ui.interval);
  else if (typeof rt.socket?.sendSubscriptions === 'function') rt.socket.sendSubscriptions(list);
  else rt.socket?.sendSubscribe(ui.symbol, ui.interval);
}

/** savedLayouts.ts tarafından kaydedilen kancalar (döngüsel import yok). */
let sharedLayoutHook: ((token: string) => Promise<boolean>) | null = null;
let layoutsRefreshHook: (() => Promise<void>) | null = null;
let saveActiveLayoutHook: (() => Promise<void>) | null = null;

export function registerLayoutHooks(hooks: {
  loadShared?: (token: string) => Promise<boolean>;
  refreshList?: () => Promise<void>;
  saveActive?: () => Promise<void>;
}): void {
  if (hooks.loadShared) sharedLayoutHook = hooks.loadShared;
  if (hooks.refreshList) layoutsRefreshHook = hooks.refreshList;
  if (hooks.saveActive) saveActiveLayoutHook = hooks.saveActive;
}

export function lastCandle(): Candle | null {
  const c = candles();
  return c.length ? c[c.length - 1] : null;
}

// ---------- veri yükleme ----------

async function loadDrawingsForSlot(slot: number, symbol: string): Promise<DrawingObject[]> {
  const ro = readOnlyLayout();
  if (ro) {
    const sym = symbol.toUpperCase();
    return ro.drawings.filter((d) => d.symbol.toUpperCase() === sym).map((d) => ({ ...d, points: d.points.map((p) => ({ ...p })) }));
  }
  const scope = drawingScopeFor(ui.sync.drawings, activeLayoutId() ?? '', slot);
  try {
    return await fetchDrawings(symbol, scope.layoutId ? scope : undefined);
  } catch {
    return [];
  }
}

export async function reloadDrawingsForAllSlots(): Promise<void> {
  const n = visibleSlotCount();
  const mainSaved = await loadDrawingsForSlot(0, ui.symbol);
  rt.overlay?.setDrawings(mainSaved);
  syncDrawings();
  await Promise.all(
    Array.from({ length: Math.max(0, n - 1) }, async (_, i) => {
      const ov = rt.secondaryOverlays[i];
      if (!ov) return;
      const sym = slotSymbolAt(i + 1);
      const saved = await loadDrawingsForSlot(i + 1, sym);
      ov.setDrawings(saved);
      ov.render();
    })
  );
}

export async function loadSymbolData(symbol: string, interval: Timeframe): Promise<void> {
  setLoading(true);
  setHover(null);
  historyExhausted = '';
  lowerTfCache.clear();
  symbolCache.clear();
  try {
    const resp = ui.displayCurrency
      ? await fetchHistory(symbol, interval, undefined, undefined, ui.displayCurrency)
      : await fetchHistory(symbol, interval);
    const list = resp.candles || [];
    batch(() => {
      setLoadError(null);
      setLoadErrorUnofficial(false);
      setCandles(list);
      setMeta(resp);
    });
    rt.chart?.setIntervalDisplay(resp.interval);
    rt.chart?.setHistoryData(list);
    markFirstChartData(list.length);
    rt.chart?.setWatermark(`${resp.symbol} • ${resp.interval.toUpperCase()}`, false);
    rt.overlay?.setContext(resp.symbol, resp.interval);
    const saved = await loadDrawingsForSlot(0, resp.symbol);
    rt.overlay?.setDrawings(saved);
    syncDrawings();
    // TitanScript artık Web Worker'da: mumlar hemen çizilir, betik sonucu hazır olunca eklenir
    runScript();
    void refreshChartEvents(resp.symbol, resp.currency, resp.provider, resp.market);
    if (comparisons().length > 0) void refreshComparisonCandles(resp.interval);
  } catch (e) {
    const unofficialOff = isUnofficialDisabledError(e);
    batch(() => {
      setCandles([]);
      setMeta(null);
      setLoadErrorUnofficial(unofficialOff);
      setLoadError(unofficialOff ? t('cfg.sources.disabledMsg') : `${symbol} / ${interval} verisi alınamadı: ${errorMessage(e)}`);
    });
    rt.chart?.setHistoryData([]);
  } finally {
    setLoading(false);
  }
}

let suppressReplayReload = false;

export async function switchSymbol(
  symbol: string,
  interval?: Timeframe,
  opts: { fromTab?: boolean; targetSlot?: number } = {}
): Promise<void> {
  // Yalın ve katalogda olmayan kod (ör. EUREN) önce borsasına çözülür (EUREN.IS); yoksa ABD hissesi sanılıyordu.
  if (needsResolve(symbol, symbols())) symbol = await resolveSymbol(symbol, symbols());
  const sym = symbol.toUpperCase();
  const target = opts.targetSlot ?? ui.activeSlot;
  const curSym = slotSymbolAt(target);
  const curIv = slotIntervalAt(target);
  const iv = interval ?? curIv;
  const symChanged = sym !== curSym.toUpperCase();
  const ivChanged = iv !== curIv;

  if (!opts.fromTab && (symChanged || ivChanged)) {
    const prevSym = curSym;
    const prevIv = curIv;
    const labelTr = symChanged && ivChanged ? tfmt("Sembol/Aralık ({0} {1})", sym, iv) : symChanged ? `Sembol (${sym})` : tfmt("Aralık ({0})", iv);
    const labelEn = symChanged && ivChanged ? `Symbol/Interval (${sym} ${iv})` : symChanged ? `Symbol (${sym})` : `Interval (${iv})`;
    pushHistory({
      labelTr,
      labelEn,
      undo: () => void switchSymbol(prevSym, prevIv, { targetSlot: target }),
      redo: () => void switchSymbol(sym, iv, { targetSlot: target }),
    });
  }

  if (target > 0 && target < visibleSlotCount()) {
    // Ek grafik hücresi seçili: eşitleme açıksa tümünü, kapalıysa yalnız bu hücreyi değiştir.
    if (symChanged && ui.sync.symbol) {
      await setAllSlotsSymbol(sym, opts.fromTab);
      if (ivChanged && ui.sync.interval) await setAllSlotsInterval(iv, opts.fromTab);
      else if (ivChanged) await setSlotInterval(target, iv, opts.fromTab);
      return;
    }
    if (ivChanged && ui.sync.interval) {
      await setAllSlotsInterval(iv, opts.fromTab);
      if (symChanged) await setSlotSymbol(target, sym, opts.fromTab);
      return;
    }
    if (symChanged) await setSlotSymbol(target, sym, opts.fromTab);
    if (ivChanged) await setSlotInterval(target, iv, opts.fromTab);
    if (ui.mobile) setUi('drawerTab', null);
    return;
  }

  suppressReplayReload = true;
  stopReplay();
  suppressReplayReload = false;
  const syncSym = ui.sync.symbol && ui.layout !== 'single';
  const syncIv = ui.sync.interval && ui.layout !== 'single';
  batch(() => {
    // Faz 24: derin backtest durumu sembole/aralığa bağlıdır
    if (sym !== ui.symbol || iv !== ui.interval) resetDeepTest();
    setUi('symbol', sym);
    setUi('interval', iv);
    setUi('slots', 0, { symbol: sym, interval: iv, chartStyle: ui.slots[0]?.chartStyle });
    if (syncSym) {
      const vis = visibleSlotCount();
      for (let i = 1; i < vis; i++) {
        setUi('slots', i, 'symbol', sym);
        if (i <= 3) setUi('secondarySymbols', i - 1, sym);
      }
    }
    if (syncIv) {
      const vis = visibleSlotCount();
      for (let i = 1; i < vis; i++) setUi('slots', i, 'interval', iv);
    }
    if (ui.mobile) setUi('drawerTab', null); // mobilde panel grafiği örter: sembol seçilince kapat
  });
  await loadSymbolData(ui.symbol, ui.interval);
  if (ui.layout !== 'single' && (syncSym || syncIv || symChanged || ivChanged)) {
    if (syncSym || syncIv) await loadAllSecondaries();
  }
  syncLiveSubscriptions();
  if (!opts.fromTab && ui.sync.crossTab) {
    if (symChanged) rt.tabBus?.send({ type: 'symbol', symbol: sym });
    if (ivChanged) rt.tabBus?.send({ type: 'interval', interval: iv });
  }
}

export async function setSlotSymbol(slot: number, rawSymbol: string, fromTab = false): Promise<void> {
  const sym = rawSymbol.toUpperCase();
  if (slot <= 0) {
    await switchSymbol(sym, ui.interval, { fromTab, targetSlot: 0 });
    return;
  }
  if (ui.sync.symbol) {
    await setAllSlotsSymbol(sym, fromTab);
    return;
  }
  batch(() => {
    setUi('slots', slot, 'symbol', sym);
    if (slot <= 3) setUi('secondarySymbols', slot - 1, sym);
  });
  await loadSecondary(slot - 1);
  syncLiveSubscriptions();
  if (!fromTab && ui.sync.crossTab) rt.tabBus?.send({ type: 'symbol', symbol: sym });
}

export async function setSlotInterval(slot: number, rawInterval: Timeframe, fromTab = false): Promise<void> {
  const iv = normalizeInterval(rawInterval) ?? rawInterval;
  if (slot <= 0) {
    await switchSymbol(ui.symbol, iv, { fromTab, targetSlot: 0 });
    return;
  }
  if (ui.sync.interval) {
    await setAllSlotsInterval(iv, fromTab);
    return;
  }
  setUi('slots', slot, 'interval', iv);
  await loadSecondary(slot - 1);
  syncLiveSubscriptions();
  if (!fromTab && ui.sync.crossTab) rt.tabBus?.send({ type: 'interval', interval: iv });
}

export async function setAllSlotsSymbol(rawSymbol: string, fromTab = false): Promise<void> {
  const sym = rawSymbol.toUpperCase();
  const vis = visibleSlotCount();
  batch(() => {
    if (sym !== ui.symbol) resetDeepTest();
    setUi('symbol', sym);
    for (let i = 0; i < vis; i++) {
      setUi('slots', i, 'symbol', sym);
      if (i >= 1 && i <= 3) setUi('secondarySymbols', i - 1, sym);
    }
  });
  await Promise.all([loadSymbolData(ui.symbol, ui.interval), loadAllSecondaries()]);
  syncLiveSubscriptions();
  if (!fromTab && ui.sync.crossTab) rt.tabBus?.send({ type: 'symbol', symbol: sym });
}

export async function setAllSlotsInterval(rawInterval: Timeframe, fromTab = false): Promise<void> {
  const iv = normalizeInterval(rawInterval) ?? rawInterval;
  const vis = visibleSlotCount();
  batch(() => {
    if (iv !== ui.interval) resetDeepTest();
    setUi('interval', iv);
    for (let i = 0; i < vis; i++) setUi('slots', i, 'interval', iv);
  });
  await Promise.all([loadSymbolData(ui.symbol, ui.interval), loadAllSecondaries()]);
  syncLiveSubscriptions();
  if (!fromTab && ui.sync.crossTab) rt.tabBus?.send({ type: 'interval', interval: iv });
}

const secLoadSeq = new Map<number, number>();

export async function loadSecondary(index = 0): Promise<void> {
  const chart = rt.secondaries[index];
  if (!chart) return;
  const slot = index + 1;
  const sym = slotSymbolAt(slot).toUpperCase();
  const iv = slotIntervalAt(slot);
  const seq = (secLoadSeq.get(index) ?? 0) + 1;
  secLoadSeq.set(index, seq);
  patchSlotInfo(slot, { loading: true, error: null, hover: null, loadedKey: '' });
  try {
    const resp = await fetchHistory(sym, iv);
    if (secLoadSeq.get(index) !== seq || rt.secondaries[index] !== chart) return;
    const list = resp.candles || [];
    chart.setIntervalDisplay(resp.interval);
    chart.setHistoryData(list);
    const last = list.length ? list[list.length - 1] : null;
    const prev = list.length >= 2 ? list[list.length - 2].close : last?.open ?? null;
    patchSlotInfo(slot, {
      lastCandle: last,
      prevClose: prev,
      loading: false,
      error: null,
      exchange: resp.provider === 'BINANCE' ? 'BINANCE' : resp.market,
      loadedKey: `${resp.symbol.toUpperCase()}|${resp.interval}`,
    });
    const ov = rt.secondaryOverlays[index];
    if (ov) {
      ov.setContext(resp.symbol, resp.interval);
      const saved = await loadDrawingsForSlot(slot, resp.symbol);
      if (secLoadSeq.get(index) !== seq) return;
      ov.setDrawings(saved);
      ov.render();
    }
  } catch (e) {
    if (secLoadSeq.get(index) !== seq) return;
    chart.setHistoryData([]);
    patchSlotInfo(slot, {
      lastCandle: null,
      loading: false,
      loadedKey: '',
      error: `${sym} / ${iv}: ${errorMessage(e)}`,
    });
  }
}

export async function loadAllSecondaries(): Promise<void> {
  const n = secondaryCount(ui.layout);
  await Promise.all(Array.from({ length: n }, (_, i) => loadSecondary(i)));
}

// ---------- Faz 25: çoklu grafik düzeni, eşitleme, özel aralıklar ----------

export function setLayoutGrid(next: ChartLayout): void {
  if (!isChartLayout(next)) return;
  const prev = ui.layout;
  if (prev !== next) {
    pushHistory({
      labelTr: `Düzen (${next})`,
      labelEn: `Layout (${next})`,
      undo: () => setLayoutGrid(prev),
      redo: () => setLayoutGrid(next),
    });
  }
  const count = getLayoutTemplate(next).count;
  batch(() => {
    setUi('layout', next);
    setUi('maximizedSlot', null);
    if (ui.activeSlot >= count) setUi('activeSlot', 0);
    if (ui.sync.symbol) {
      for (let i = 1; i < count; i++) {
        setUi('slots', i, 'symbol', ui.symbol);
        if (i <= 3) setUi('secondarySymbols', i - 1, ui.symbol);
      }
    }
    if (ui.sync.interval) {
      for (let i = 1; i < count; i++) setUi('slots', i, 'interval', ui.interval);
    }
  });
  setLayoutDirty(true);
  syncLiveSubscriptions();
  scheduleResize(40);
}

export function setActiveSlot(slot: number): void {
  const max = visibleSlotCount() - 1;
  const clamped = Math.max(0, Math.min(max, slot));
  if (ui.activeSlot !== clamped) setUi('activeSlot', clamped);
}

export function toggleMaximizeSlot(slot = ui.activeSlot): void {
  if (visibleSlotCount() <= 1) return;
  const target = Math.max(0, Math.min(visibleSlotCount() - 1, slot));
  setUi('maximizedSlot', ui.maximizedSlot === target ? null : target);
  scheduleResize(40);
}

export function setSyncOption<K extends keyof LayoutSyncOptions>(key: K, value: LayoutSyncOptions[K]): void {
  setUi('sync', key, value);
  setLayoutDirty(true);
  if (key === 'symbol' && value === true && visibleSlotCount() > 1) {
    void setAllSlotsSymbol(activeChartSymbol());
  } else if (key === 'interval' && value === true && visibleSlotCount() > 1) {
    void setAllSlotsInterval(activeChartInterval());
  } else if (key === 'drawings') {
    void reloadDrawingsForAllSlots();
  }
}

export function handleSlotCrosshair(slot: number, timeSec: number | null): void {
  propagateCrosshair(slot, timeSec, visibleSlotCount(), ui.sync, getChartBySlot, rt.tabBus);
}

export function handleSlotTimeClick(slot: number, timeSec: number): void {
  propagateTimeClick(slot, timeSec, visibleSlotCount(), ui.sync, getChartBySlot, rt.tabBus);
}

export function handleSlotVisibleRange(slot: number, range: { from: number; to: number } | null): void {
  propagateDateRange(slot, range, visibleSlotCount(), ui.sync, getChartBySlot, rt.tabBus);
}

export function toggleFavTimeframe(tf: Timeframe): void {
  const norm = normalizeInterval(tf);
  if (!norm) return;
  const cur = [...ui.favTimeframes];
  const idx = cur.indexOf(norm);
  if (idx >= 0) {
    if (cur.length <= 1) return; // en az 1 favori kalsın
    cur.splice(idx, 1);
  } else {
    cur.push(norm);
  }
  setUi('favTimeframes', sortIntervals(cur));
}

export function addCustomTimeframe(n: number, unit: IntervalUnit): string | null {
  const built = buildCustomInterval(n, unit);
  if (!built) {
    toast(tt("Geçersiz aralık değeri"));
    return null;
  }
  if (!ui.customTimeframes.includes(built)) {
    setUi('customTimeframes', sortIntervals([...ui.customTimeframes, built]));
  }
  toast(tfmt("Özel aralık eklendi: {0}", built));
  return built;
}

export function removeCustomTimeframe(tf: Timeframe): void {
  setUi('customTimeframes', ui.customTimeframes.filter((x) => x !== tf));
  if (ui.favTimeframes.includes(tf) && ui.favTimeframes.length > 1) {
    setUi('favTimeframes', ui.favTimeframes.filter((x) => x !== tf));
  }
}

/** Kaynak daha eski veri vermediğinde (sembol|zaman dilimi) tekrar tekrar istek atılmasın. */
let historyExhausted = '';
const OLDER_CHUNK_BARS = 1000;

export async function loadOlderHistory(oldestTime: number): Promise<void> {
  if (oldestTime <= 0) return;
  const key = `${ui.symbol}|${ui.interval}`;
  if (historyExhausted === key) return;
  const step = intervalSeconds(ui.interval) || 900;
  try {
    // Faz 30: kaynakta veri boşluğu (ör. borsa bakım aralığı) varsa bir pencere boş gelebilir; tükendi
    // demeden önce 4 pencere daha geriye bakılır (de boşlukların ötesini yükler).
    let resp = await fetchHistory(ui.symbol, ui.interval, oldestTime - OLDER_CHUNK_BARS * step, oldestTime);
    const existing = new Set(candles().map((c) => c.time));
    let fresh = (resp.candles ?? []).filter((c) => !existing.has(c.time));
    for (let k = 2; fresh.length === 0 && k <= 5; k++) {
      resp = await fetchHistory(ui.symbol, ui.interval, oldestTime - k * OLDER_CHUNK_BARS * step, oldestTime - (k - 1) * OLDER_CHUNK_BARS * step);
      fresh = (resp.candles ?? []).filter((c) => !existing.has(c.time));
    }
    if (fresh.length === 0) {
      historyExhausted = key;
      toast(olderLimitNote(resp.market, ui.interval));
      return;
    }
    rt.chart?.prependHistoryData(fresh);
    setCandles([...fresh, ...candles()].sort((a, b) => a.time - b.time));
  } catch {
    // eski veri alınamazsa grafik mevcut hâliyle kalır
  }
}

/** Neden daha geriye gidilemediğini açıklar (kaynak sınırı, hata değil). */
export function olderLimitNote(market: string | undefined, interval: string): string {
  const intraday = !['1d', '1w'].includes(interval);
  if (market !== 'CRYPTO' && intraday) {
    return tfmt("Daha eski veri yok: Yahoo {0} verisini sınırlı veriyor (≈60 gün; 1sa/4sa ≈2 yıl). Daha geriye gitmek için 1G veya 1H seç.", interval);
  }
  return tt("Bu sembolün kaynakta daha eski verisi yok.");
}

export async function refreshWatchlist(): Promise<void> {
  try {
    setSymbols(await fetchSymbols(ui.marketFilter === 'FAV' ? 'ALL' : ui.marketFilter, ui.searchQuery));
    void refreshQuotes();
  } catch (e) {
    toast(tfmt("Sembol listesi alınamadı: {0}", errorMessage(e)));
  }
}

// ---------- canlı fiyat (izleme listesi) ----------

/** Sembol -> canlı fiyat. Liste satırları buradan okur; yoksa `/api/symbols` özetine düşer. */
export const [quotes, setQuotes] = createSignal<Record<string, LiveQuote>>({});

const QUOTE_POLL_MS = 10_000;
let quoteTimer: ReturnType<typeof setInterval> | undefined;

/** Görünen satırlar: favoriler + aktif sembol + listenin ilk 40'ı (tekrarsız). */
export function quoteTargets(): string[] {
  const out: string[] = [ui.symbol.toUpperCase()];
  for (const f of favorites()) out.push(f.symbol.toUpperCase());
  for (const s of symbols().slice(0, 40)) out.push(s.symbol.toUpperCase());
  return [...new Set(out)].slice(0, 60);
}

export async function refreshQuotes(): Promise<void> {
  try {
    const got = await fetchQuotes(quoteTargets());
    if (got.length === 0) return;
    setQuotes((prev) => {
      const next = { ...prev };
      for (const q of got) next[q.symbol.toUpperCase()] = q;
      return next;
    });
  } catch {
    // ağ hatası: önceki değerler kalır
  }
}

export function startQuotePolling(): void {
  if (quoteTimer !== undefined) return;
  void refreshQuotes();
  quoteTimer = setInterval(() => {
    if (typeof document !== 'undefined' && document.hidden) return;
    void refreshQuotes();
  }, QUOTE_POLL_MS);
}

export async function refreshScreener(
  market: MarketFilter | 'ETF' = ui.screenerMarket,
  opts?: { timeframe?: string; includeFundamentals?: boolean; warm?: boolean }
): Promise<void> {
  try {
    setScreenerRows(await fetchScreener(market, opts));
  } catch (e) {
    setScreenerRows([]);
    toast(tfmt("Tarayıcı verisi alınamadı: {0}", errorMessage(e)));
  }
}

// ---------- canlı tick ----------

/**
 * `candles` sinyalini dinleyen ağır memo'lar (teknik gösterge özeti, hacim sıçraması, künye) tick başına
 * tüm seriyi yeniden hesaplıyordu. Yeni bar hemen, aynı bar güncellemesi en fazla ~4/sn bildirilir;
 * dizi yerinde güncellendiği için okuyanlar her zaman son değeri görür.
 */
const NOTIFY_MIN_MS = 250;
let notifyAt = 0;
let notifyTimer: ReturnType<typeof setTimeout> | undefined;
let notifyQueued = false;
function notifyCandles(list: Candle[], immediate: boolean): void {
  const now = Date.now();
  if (immediate || now - notifyAt >= NOTIFY_MIN_MS) {
    if (notifyTimer !== undefined) {
      clearTimeout(notifyTimer);
      notifyTimer = undefined;
    }
    notifyAt = now;
    // Faz 30: grafik tick'i doğrudan çizdi; mum sinyaline bağlı türetmeler (lejant, Lab, strateji
    // geometrisi) çizimden hemen sonra çalışır → tick → ekran yolunu bloklamaz. Yeni bar anında.
    if (immediate || typeof requestAnimationFrame !== 'function') setCandles(list);
    else if (!notifyQueued) {
      notifyQueued = true;
      requestAnimationFrame(() =>
        setTimeout(() => {
          notifyQueued = false;
          setCandles(candles());
        }, 0)
      );
    }
    return;
  }
  if (notifyTimer === undefined) {
    notifyTimer = setTimeout(() => {
      notifyTimer = undefined;
      notifyAt = Date.now();
      setCandles(candles());
    }, NOTIFY_MIN_MS - (now - notifyAt));
  }
}

const SCRIPT_MIN_MS = 1000;
/** Bir sonraki karenin çiziminden hemen sonra çalıştırır (rAF + makro görev). */
function afterPaint(fn: () => void): void {
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => setTimeout(fn, 0));
  else setTimeout(fn, 0);
}
let scriptAt = 0;
let scriptTimer: ReturnType<typeof setTimeout> | undefined;
/**
 * Canlı tick sonrası betiği güncel mumlarla yeniden çalıştırır (projeksiyon/etiket/çizgiler geride kalmasın).
 * Yeni barda hemen, aynı bar güncellemesinde en fazla saniyede bir.
 */
export function scheduleScript(newBar: boolean): void {
  const hasScript = ui.scriptCode.trim() !== '' || ui.scriptCode2.trim() !== '';
  if (!hasScript) return;
  const now = Date.now();
  if (newBar || now - scriptAt >= SCRIPT_MIN_MS) {
    if (scriptTimer !== undefined) {
      clearTimeout(scriptTimer);
      scriptTimer = undefined;
    }
    scriptAt = now;
    // Faz 30: tick'in kendisi önce çizilsin (tick → ekran < 16 ms); TitanScript sonucu zaten worker'dan eşzamansız gelir
    afterPaint(runScript);
    return;
  }
  if (scriptTimer === undefined) {
    scriptTimer = setTimeout(() => {
      scriptTimer = undefined;
      scriptAt = Date.now();
      runScript();
    }, SCRIPT_MIN_MS - (now - scriptAt));
  }
}

export function handleLiveTick(candle: Candle): void {
  if (ui.replayActive) return;
  markTick(candle);
  rt.chart?.updateLiveCandle(candle);
  const list = candles();
  const n = list.length;
  let newBar = false;
  if (n > 0 && list[n - 1].time === candle.time) {
    list[n - 1] = candle;
  } else if (n === 0 || candle.time > list[n - 1].time) {
    list.push(candle);
    newBar = true;
  }
  scheduleScript(newBar);
  if (newBar) void refreshAnalysisSoft();
  batch(() => {
    notifyCandles(list, newBar);
    setSymbols((s) => applyQuote(s, ui.symbol, candle.close, candleChangePct(candle)));
    setQuotes((prev) => {
      const q = prev[ui.symbol.toUpperCase()];
      if (!q || q.prevClose <= 0) return prev;
      const change = candle.close - q.prevClose;
      return { ...prev, [q.symbol.toUpperCase()]: { ...q, last: candle.close, change, changePct: (change / q.prevClose) * 100 } };
    });
  });
}

// ---------- besleme sağlığı & kuyruk onarımı ----------

export function feedHealth(): FeedHealth {
  const last = lastCandle();
  const t = lastTickAt();
  const now = nowMs();
  return {
    state: classifyFeed({
      online: ui.online,
      wsConnected: ui.wsConnected,
      market: meta()?.market,
      interval: ui.interval,
      lastBarTime: last?.time ?? 0,
      lastTickAt: t,
      now,
    }),
    lastTickAt: t,
    lastBarTime: last?.time ?? 0,
    ageSec: t > 0 ? Math.max(0, Math.round((now - t) / 1000)) : 0,
  };
}

let healing = false;
/**
 * Kaçan mumları doldurur: sekme gizliyken/WS koptuğunda oluşan boşluk. Grafiğin görünümünü bozmadan
 * yalnızca son birkaç barı çeker; yeni bar olduysa TitanScript + analiz tazelenir.
 */
export async function healTail(): Promise<void> {
  if (healing || ui.replayActive) return;
  const last = lastCandle();
  if (!last) return;
  healing = true;
  const key = `${ui.symbol}|${ui.interval}`;
  try {
    const step = intervalSeconds(ui.interval) || 900;
    const resp = await fetchHistory(ui.symbol, ui.interval, last.time - 5 * step);
    if (key !== `${ui.symbol}|${ui.interval}`) return; // sembol değişti
    const { list, appended, changed } = mergeTail(candles(), resp.candles ?? []);
    if (!changed) return;
    for (const c of appended) rt.chart?.updateLiveCandle(c);
    const tip = list[list.length - 1];
    if (tip && appended.length === 0) rt.chart?.updateLiveCandle(tip);
    setCandles(list);
    scheduleScript(appended.length > 0);
    if (appended.length > 0) void refreshAnalysisSoft();
  } catch {
    // ağ yok: watchdog bir sonraki turda tekrar dener
  } finally {
    healing = false;
  }
}

let watchdogStop: (() => void) | undefined;
/** Saat + sekme/ağ dönüşünde onarım + WS yeniden aboneliği. Tek örnek. */
export function startFeedWatchdog(): () => void {
  if (watchdogStop) return watchdogStop;
  const tick = setInterval(() => {
    setNowMs(Date.now());
    // WS sağlıklı görünüp tick gelmiyorsa (kripto) kuyruğu REST ile kontrol et
    const h = feedHealth();
    if (h.state === 'delayed' && !document.hidden) void healTail();
  }, 5000);
  const wake = () => {
    if (typeof document !== 'undefined' && document.hidden) return;
    setNowMs(Date.now());
    rt.socket?.sendSubscribe(ui.symbol, ui.interval);
    void healTail();
    void refreshQuotes();
  };
  document.addEventListener('visibilitychange', wake);
  window.addEventListener('online', wake);
  window.addEventListener('focus', wake);
  watchdogStop = () => {
    clearInterval(tick);
    document.removeEventListener('visibilitychange', wake);
    window.removeEventListener('online', wake);
    window.removeEventListener('focus', wake);
    watchdogStop = undefined;
  };
  return watchdogStop;
}

// ---------- script ----------

/**
 * Betikler grafikte çizilen çubuklarla çalışır: Renko/Range/Line Break'te kaynak
 * mumlar değil türetilmiş tuğlalar (ta.*, strateji, bar_index hepsi tuğla üstünde).
 */
/**
 * Faz 30: varsayılan olarak TitanScript betikleri/göstergeler en fazla son 20.000 bar üzerinde hesaplanır (grafik daha fazlasını
 * gösterebilir). 100k barlık grafikte her tick/saniye tüm geçmişi yeniden koşmak kaydırmayı ve belleği çökertiyordu.
 * Derin backtest (Faz 24) açıkken sınır uygulanmaz — kullanıcı açıkça tüm geçmişi istemiştir.
 */
export const SCRIPT_MAX_BARS = 20_000;

export function scriptBars(): Candle[] {
  // Faz 24: strateji testi tarih aralığı (varsa) betiğe verilen mumları kısıtlar
  const src = trimRange(candles(), btRange());
  const bars = isDerivedStyle(ui.chartStyle) ? deriveCandles(ui.chartStyle, src, ui.styleParams, rt.chart?.derivedBasisCandles?.() ?? src) : src;
  return deepStatus().phase === 'idle' && bars.length > SCRIPT_MAX_BARS ? bars.slice(-SCRIPT_MAX_BARS) : bars;
}

let scriptRunSeq = 0;
let savedScriptsLoaded = false;
const lowerTfCache = new Map<string, Candle[]>();
const eventsCache = new Map<string, CorporateEventsData>();
const fxCache = new Map<string, FxRatePoint[]>();
/** Faz 20: request.security başka sembol — "SYM|interval" → gerçek mumlar (hata → boş, tekrar denenmez) */
const symbolCache = new Map<string, Candle[]>();

export async function refreshSavedScripts(): Promise<SavedScriptItem[]> {
  try {
    const list = await fetchSavedScripts();
    savedScriptsLoaded = true;
    setSavedScripts(list);
    return list;
  } catch {
    return savedScripts();
  }
}

export function loadSavedScript(id: string): void {
  const found = savedScripts().find((s) => s.id === id);
  if (!found) return;
  batch(() => {
    setUi('scriptCode', found.code);
    setUi('scriptSubHidden', false);
    setScriptInputOverrides({});
    setScriptPickTarget(null);
  });
  runScript();
}

export function setScriptInputOverride(key: string, value: unknown): void {
  setScriptInputOverrides((prev) => ({ ...prev, [key]: value }));
  runScript();
}

export function resetScriptInputOverrides(): void {
  setScriptInputOverrides({});
  setScriptPickTarget(null);
  runScript();
}

export function startScriptChartPick(target: ScriptPickTarget): void {
  setScriptPickTarget(target);
  toast(tfmt("🎯 Grafikte tıklayarak \"{0}\" seçin", target.inputTitle));
}

export function cancelScriptChartPick(): void {
  setScriptPickTarget(null);
}

export function applyScriptChartPick(timeSec: number | null, price: number | null): boolean {
  const target = scriptPickTarget();
  if (!target) return false;
  if (target.studyUid) {
    setScriptPickTarget(null);
    return studyPickHandler ? studyPickHandler(target, timeSec, price) : false;
  }
  const next = { ...scriptInputOverrides() };
  let updated = false;
  if ((target.kind === 'time' || target.kind === 'both') && timeSec !== null && Number.isFinite(timeSec)) {
    next[target.inputKey] = Math.round(timeSec * 1000);
    updated = true;
  }
  if (target.kind === 'price' && price !== null && Number.isFinite(price)) {
    next[target.inputKey] = Number(price.toFixed(4));
    updated = true;
  } else if (target.kind === 'both' && target.pairedKey && price !== null && Number.isFinite(price)) {
    next[target.pairedKey] = Number(price.toFixed(4));
    updated = true;
  }
  setScriptPickTarget(null);
  if (!updated) return false;
  setScriptInputOverrides(next);
  runScript();
  toast(tfmt("✓ \"{0}\" grafikten seçildi", target.inputTitle));
  return true;
}

export function buildScriptOpts(bars: Candle[], base: RunOptions): RunOptions {
  const opts: RunOptions = { ...base };
  if (magnifierOn() && magnifierCandles().length > 0) opts.magnifierCandles = magnifierCandles();
  const ov = scriptInputOverrides();
  if (Object.keys(ov).length > 0) opts.inputOverrides = ov;
  const libs = buildLibraryRegistry(savedScripts());
  if (Object.keys(libs).length > 0) opts.libraries = libs;
  if (lowerTfCache.size > 0) {
    const ltf: Record<string, Candle[]> = {};
    for (const [k, v] of lowerTfCache) ltf[k] = v;
    opts.lowerTfCandles = ltf;
  }
  if (eventsCache.size > 0) {
    const ev: Record<string, CorporateEventsData> = {};
    for (const [k, v] of eventsCache) ev[k] = v;
    opts.corporateEvents = ev;
  }
  if (fxCache.size > 0) {
    const fx: Record<string, FxRatePoint[]> = {};
    for (const [k, v] of fxCache) fx[k] = v;
    opts.currencyRates = fx;
  }
  const suffix = `|${ui.interval}`;
  const sc: Record<string, Candle[]> = {};
  for (const [k, v] of symbolCache) if (k.endsWith(suffix)) sc[k.slice(0, -suffix.length)] = v;
  if (Object.keys(sc).length > 0) opts.symbolCandles = sc;
  void bars;
  return opts;
}

function armConfirmPickIfNeeded(res: ScriptExecutionResult): void {
  if (!res.ok || !res.inputs?.length) return;
  const ov = scriptInputOverrides();
  const pending = res.inputs.filter(
    (d) =>
      d.confirm &&
      (d.type === 'time' || d.type === 'price') &&
      ov[d.id ?? d.title] === undefined
  );
  if (pending.length === 0) return;
  const timeIn = pending.find((d) => d.type === 'time');
  const priceIn = pending.find((d) => d.type === 'price');
  if (timeIn && priceIn) {
    startScriptChartPick({
      inputKey: timeIn.id ?? timeIn.title,
      inputTitle: `${timeIn.title} & ${priceIn.title}`,
      kind: 'both',
      pairedKey: priceIn.id ?? priceIn.title,
    });
  } else {
    const first = pending[0];
    startScriptChartPick({
      inputKey: first.id ?? first.title,
      inputTitle: first.title,
      kind: first.type === 'time' ? 'time' : 'price',
    });
  }
}

/**
 * betiği Web Worker'da çalıştırır (UI donmaz), sonuçları önbellekler. Art arda çağrılırsa
 * yalnızca en son istek uygulanır. Worker yoksa (test) senkron çalışır.
 * Kütüphane import, `request.security_lower_tf`, temettü/bölünme/bilanço veya FX kur
 * bağımlılığı varsa önce gerçek veriyi çeker, sonra çalıştırır.
 */
export function runScript(fromUserApply = false): void {
  for (const h of scriptRunHooks) h();
  const seq = ++scriptRunSeq;
  const bars = scriptBars();
  const baseOpts = scriptRunOptions(ui.symbol, ui.interval, bars);
  const codes = [ui.scriptCode, ui.scriptCode2.trim() ? ui.scriptCode2 : null];

  const apply = (main: ScriptExecutionResult, second: ScriptExecutionResult | null) => {
    if (seq !== scriptRunSeq) return; // eskimiş sonuç
    batch(() => {
      setScriptMain(main);
      setScriptResult(mergeScriptResults(main, second));
      setUi('scriptNote', null);
    });
    for (const h of [...scriptAppliedHooks]) h();
    if (fromUserApply) armConfirmPickIfNeeded(main);
    // başka sembol verisi istendiyse gerçek mumları çek ve bir kez yeniden çalıştır
    const missing = [...new Set([...(main.missingSymbols ?? []), ...(second?.missingSymbols ?? [])])].filter(
      (sym) => !symbolCache.has(`${sym}|${ui.interval}`)
    );
    if (missing.length > 0) {
      const iv = ui.interval;
      void Promise.all(
        missing.map((sym) =>
          fetchHistory(sym, iv)
            .then((r) => symbolCache.set(`${sym}|${iv}`, r.candles ?? []))
            .catch(() => symbolCache.set(`${sym}|${iv}`, []))
        )
      ).then(() => {
        if (seq === scriptRunSeq && iv === ui.interval) runScript();
      });
    }
  };

  const dispatch = () => {
    if (seq !== scriptRunSeq) return;
    const opts = buildScriptOpts(bars, baseOpts);
    const jobs = codes.map((c, i) => (c === null ? null : runScriptWorker(i, c, bars, opts)));
    const pick = (j: (typeof jobs)[number]) => (j === null ? Promise.resolve(null) : 'sync' in j ? j.sync : j.async);
    if (jobs.every((j) => j === null || 'sync' in j)) {
      apply((jobs[0] as { sync: ScriptExecutionResult }).sync, jobs[1] ? (jobs[1] as { sync: ScriptExecutionResult }).sync : null);
      return;
    }
    void Promise.all([pick(jobs[0]), pick(jobs[1])]).then(([m, s]) => apply(m as ScriptExecutionResult, s));
  };

  // Bağımlılık ön-taraması: yalnızca eksik harici veri/kütüphane varsa async çek
  const activeCodes = codes.filter((c): c is string => c !== null);
  let needScripts = false;
  const missingTfs: string[] = [];
  const missingEvents = new Set<string>();
  const missingFx = new Map<string, { from: string; to: string }>();
  const curTfSec = intervalSeconds(ui.interval) || 900;

  for (const code of activeCodes) {
    const h = extractScriptRequests(code);
    if (h.hasImports && !savedScriptsLoaded) needScripts = true;
    for (const tf of h.lowerTimeframes) {
      const apiTf = scriptTimeframeToApi(tf);
      if (apiTf && isValidInterval(apiTf) && intervalSeconds(apiTf) < curTfSec) {
        const key = `${ui.symbol}|${apiTf}`;
        if (!lowerTfCache.has(key) && !missingTfs.includes(apiTf)) missingTfs.push(apiTf);
      }
    }
    if (h.needsCurrentEvents && !eventsCache.has(ui.symbol)) missingEvents.add(ui.symbol);
    for (const sym of h.eventSymbols) {
      if (!eventsCache.has(sym)) missingEvents.add(sym);
    }
    for (const pair of h.currencyPairs) {
      const k = `${pair.from}/${pair.to}`;
      if (!fxCache.has(k)) missingFx.set(k, pair);
    }
  }

  if (!needScripts && missingTfs.length === 0 && missingEvents.size === 0 && missingFx.size === 0) {
    dispatch();
    return;
  }

  const fromTs = bars.length > 0 ? bars[0].time : undefined;
  const toTs = bars.length > 0 ? bars[bars.length - 1].time + curTfSec : undefined;
  const tasks: Promise<unknown>[] = [];

  if (needScripts) {
    tasks.push(refreshSavedScripts());
  }
  for (const apiTf of missingTfs) {
    const key = `${ui.symbol}|${apiTf}`;
    tasks.push(
      fetchHistory(ui.symbol, apiTf as Timeframe, fromTs, toTs)
        .then((r) => lowerTfCache.set(key, r.candles ?? []))
        .catch(() => lowerTfCache.set(key, []))
    );
  }
  for (const sym of missingEvents) {
    tasks.push(
      fetchCorporateEvents(sym, fromTs, toTs)
        .then((ev) => eventsCache.set(sym, ev))
        .catch(() =>
          eventsCache.set(sym, { symbol: sym, supported: false, reason: 'İstek başarısız', dividends: [], splits: [], earnings: [] })
        )
    );
  }
  for (const [k, pair] of missingFx) {
    tasks.push(
      fetchFxRates(pair.from, pair.to, fromTs, toTs)
        .then((fx) => fxCache.set(k, fx.supported ? fx.rates : []))
        .catch(() => fxCache.set(k, []))
    );
  }

  void Promise.all(tasks).then(() => dispatch());
}

/** ▶ Grafiğe Uygula: ✕ ile gizlenmiş Betik alt paneli de geri gelir. */
export function applyScriptToChart(): void {
  setUi('scriptSubHidden', false);
  runScript(true);
}

/** İkinci betiği seçer ('' = kaldır) ve yeniden çalıştırır. */
export function applySecondary(id: string): void {
  const found = BUILTIN_SCRIPT_PRESETS.find((p) => p.id === id);
  setUi('scriptCode2', found ? found.code : '');
  setUi('scriptSubHidden', false);
  runScript();
}

export function applyPreset(id: string): void {
  const found = BUILTIN_SCRIPT_PRESETS.find((p) => p.id === id);
  if (!found) return;
  batch(() => {
    setUi('scriptCode', found.code);
    setUi('scriptSubHidden', false);
    setScriptInputOverrides({});
    setScriptPickTarget(null);
  });
  runScript();
}

export async function saveScript(): Promise<void> {
  const bars = scriptBars();
  const opts = buildScriptOpts(bars, scriptRunOptions(ui.symbol, ui.interval, bars));
  const res = executeScript(ui.scriptCode, bars, opts);
  try {
    await saveCustomScript({
      name: res.scriptTitle || `Custom ${LANG_NAME}`,
      code: ui.scriptCode,
      isOverlay: res.isOverlay,
    });
    await refreshSavedScripts();
    setUi(
      'scriptNote',
      res.isLibrary
        ? tfmt("📚 \"{0}\" kütüphanesi yerel SQLite'a kaydedildi!", res.scriptTitle)
        : `💾 "${res.scriptTitle}" yerel SQLite'a kaydedildi!`
    );
  } catch (e) {
    setUi('scriptNote', `✗ Kaydedilemedi: ${errorMessage(e)}`);
  }
}

// ---------- paper trading ----------
// Faz 28: paper hesabı sunucuda (`state/tradingStore.ts`, `/api/trading/*`).

// ---------- alarmlar ----------

// Faz 23: alarmlar sunucuda (`state/alertStore.ts`). `alerts` yalnız eski çalışma alanından gelen
// yerel fiyat alarmlarını bir kez sunucuya taşımak için tutulur (taşınınca boşalır).

// ---------- çizimler ----------

export function persistSlotDrawing(slot: number, d: DrawingObject): void {
  if (readOnlyLayout()) return;
  const scope = drawingScopeFor(ui.sync.drawings, activeLayoutId() ?? '', slot);
  const scoped: DrawingObject = scope.layoutId ? { ...d, layoutId: scope.layoutId } : d;
  void persistDrawing(scoped).catch(() => toast(tt("Çizim kaydedilemedi")));
  const ov = getOverlayBySlot(slot);
  if (slot === 0) syncDrawings();
  if (ov) {
    propagateDrawings(
      slot,
      d.symbol,
      ov.getDrawings(),
      visibleSlotCount(),
      ui.sync,
      slotSymbolAt,
      getOverlayBySlot,
      activeLayoutId() ?? '',
      rt.tabBus
    );
  }
}

export function persistCompleted(d: DrawingObject): void {
  persistSlotDrawing(0, d);
}

export function setTool(tool: DrawingToolType): void {
  setUi('tool', tool);
}

export function pickSubTool(group: keyof UiState['groupTool'], tool: DrawingToolType): void {
  batch(() => {
    setUi('groupTool', group, tool);
    setUi('tool', tool);
  });
}

export function pickColor(color: string): void {
  const sel = rt.overlay?.getSelectedDrawing();
  if (sel) {
    void rt.overlay!.updateSelectedDrawingColor(color);
    rememberToolStyle(sel.toolType, { color });
    syncDrawings();
    toast(tt("Çizim rengi güncellendi"));
  } else {
    setUi('drawColor', color);
  }
}

export function updateSelectedDrawing(patch: Parameters<NonNullable<typeof rt.overlay>['updateSelectedDrawing']>[0]): void {
  const sel = rt.overlay?.getSelectedDrawing();
  if (!sel) return;
  const st: ToolStyle = {};
  if ('color' in patch) st.color = patch.color;
  if ('width' in patch) st.width = patch.width;
  if ('lineStyle' in patch) st.lineStyle = patch.lineStyle;
  if ('fontSize' in patch) st.fontSize = patch.fontSize;
  if (Object.keys(st).length) rememberToolStyle(sel.toolType, st);
  void rt.overlay!.updateSelectedDrawing(patch).then(syncDrawings);
}

// ---------- Faz 22: çizim tercihleri ----------

/** Varsayılan: bir çizimin stili değişince aracın sonraki çizimleri aynı stili alır. undefined alan = varsayılana dön. */
export function rememberToolStyle(tool: DrawingToolType, patch: ToolStyle): void {
  const next: ToolStyle = { ...(ui.toolStyles[tool] ?? {}) };
  for (const [k, v] of Object.entries(patch) as Array<[keyof ToolStyle, ToolStyle[keyof ToolStyle]]>) {
    if (v === undefined) delete next[k];
    else (next as Record<string, unknown>)[k] = v;
  }
  setUi('toolStyles', { ...ui.toolStyles, [tool]: cleanStyle(next) });
}

export function setMagnetMode(mode: 'off' | 'weak' | 'strong'): void {
  batch(() => {
    if (mode === 'off') setUi('magnet', false);
    else {
      setUi('magnetMode', mode);
      setUi('magnet', true);
    }
  });
}

export function toggleStayInDrawing(): void {
  setUi('stayInDrawing', !ui.stayInDrawing);
}

export function toggleFavoriteTool(tool: DrawingToolType): void {
  setUi('favTools', toggleFavTool([...ui.favTools], tool));
}

export function chooseIcon(icon: string): void {
  batch(() => {
    setUi('iconChoice', icon);
    setUi('tool', 'icon');
  });
}

export function saveDrawingTemplate(name: string): boolean {
  const sel = rt.overlay?.getSelectedDrawing();
  if (!sel || !name.trim()) return false;
  setUi('drawTemplates', saveTemplate([...ui.drawTemplates], sel.toolType, name, styleOf(sel)));
  toast(tfmt("Şablon kaydedildi: {0}", name.trim()));
  return true;
}

export function applyDrawingTemplate(id: string): void {
  const t = ui.drawTemplates.find((x) => x.id === id);
  if (!t || !rt.overlay?.getSelectedDrawing()) return;
  updateSelectedDrawing({ color: t.style.color ?? DEFAULT_TOOL_COLOR[t.tool] ?? '#0284C7', width: t.style.width, lineStyle: t.style.lineStyle, fontSize: t.style.fontSize });
}

export function deleteDrawingTemplate(id: string): void {
  setUi('drawTemplates', removeTemplate([...ui.drawTemplates], id));
}

/** Standart "Varsayılan şablonu uygula": fabrika stiline döner ve stil hafızasını temizler. */
export function applyFactoryStyle(): void {
  const sel = rt.overlay?.getSelectedDrawing();
  if (!sel) return;
  // store nesneleri birleştirir: anahtarı silmek için undefined atanır
  setUi('toolStyles', sel.toolType, undefined);
  void rt.overlay!.updateSelectedDrawing({ color: DEFAULT_TOOL_COLOR[sel.toolType] ?? '#0284C7', width: undefined, lineStyle: undefined, fontSize: undefined }).then(syncDrawings);
}

export function setDrawingVisibility(v: DrawingVisibility | undefined): void {
  if (!rt.overlay?.getSelectedDrawing()) return;
  void rt.overlay.updateSelectedDrawing({ visibility: normalizeVisibility(v) }).then(syncDrawings);
}

export function duplicateSelectedDrawing(): void {
  const copy = rt.overlay?.duplicateSelected();
  if (!copy) return;
  persistCompleted(copy);
  toast(tt("Çizim kopyalandı"));
}

function mirrorMainDrawings(): void {
  syncDrawings();
  if (!rt.overlay) return;
  propagateDrawings(
    0,
    ui.symbol,
    rt.overlay.getDrawings(),
    visibleSlotCount(),
    ui.sync,
    slotSymbolAt,
    getOverlayBySlot,
    activeLayoutId() ?? '',
    rt.tabBus
  );
}

/** Verilen fiyatta yatay çizgi ekler (sağ-tık menüsü). */
export function addHLineAt(price: number, time: number): void {
  if (!rt.overlay) return;
  const ctx = rt.overlay.getManager().getContext();
  const scope = drawingScopeFor(ui.sync.drawings, activeLayoutId() ?? '', 0);
  void rt.overlay.getManager().addDrawing({
    id: `draw_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    symbol: ctx.symbol,
    timeframe: ctx.timeframe,
    toolType: 'hline',
    points: [{ time, price }],
    color: '#FFD54F',
    ...(scope.layoutId ? { layoutId: scope.layoutId } : {}),
  });
  mirrorMainDrawings();
}

export function toggleInvertScale(): void {
  const prev = ui.invertScale;
  const next = !prev;
  setUi('invertScale', next);
  rt.chart?.setInvertScale(next);
  pushHistory({
    labelTr: next ? tt("Ters ölçek aç") : tt("Ters ölçek kapat"),
    labelEn: next ? 'Invert scale' : 'Normal scale orientation',
    undo: () => {
      setUi('invertScale', prev);
      rt.chart?.setInvertScale(prev);
    },
    redo: () => {
      setUi('invertScale', next);
      rt.chart?.setInvertScale(next);
    },
  });
}

/** Faz 29: birleşik kabuk geri al (çizim + sembol/aralık + stil + ölçek + gösterge + düzen + ayarlar + tema). */
export function undoAction(): boolean {
  if (canUndo()) {
    const entry = undoHistory();
    if (entry) {
      toast(lang() === 'en' ? `Undo: ${entry.labelEn}` : `Geri alındı: ${entry.labelTr}`);
      return true;
    }
  }
  rt.overlay?.undo();
  mirrorMainDrawings();
  toast(lang() === 'en' ? 'Undone' : 'Geri alındı (Undo)');
  return false;
}

/** Faz 29: birleşik kabuk yinele. */
export function redoAction(): boolean {
  if (canRedo()) {
    const entry = redoHistory();
    if (entry) {
      toast(lang() === 'en' ? `Redo: ${entry.labelEn}` : `Yinelendi: ${entry.labelTr}`);
      return true;
    }
  }
  rt.overlay?.redo();
  mirrorMainDrawings();
  toast(lang() === 'en' ? 'Redone' : 'Yinelendi (Redo)');
  return false;
}

export function undoDrawing(): void {
  undoAction();
}

export function redoDrawing(): void {
  redoAction();
}

/** Faz 29: çizim mutasyonunu birleşik geçmişe bağlar. */
export function recordDrawingHistory(
  prev: DrawingObject[],
  next: DrawingObject[],
  labelTr: string,
  labelEn: string
): void {
  const snapPrev = JSON.parse(JSON.stringify(prev)) as DrawingObject[];
  const snapNext = JSON.parse(JSON.stringify(next)) as DrawingObject[];
  pushHistory({
    labelTr,
    labelEn,
    undo: () => {
      rt.overlay?.applyDrawingsSnapshot(snapPrev);
      mirrorMainDrawings();
    },
    redo: () => {
      rt.overlay?.applyDrawingsSnapshot(snapNext);
      mirrorMainDrawings();
    },
  });
}

export function copySelectedDrawing(id?: string): boolean {
  const copied = rt.overlay?.copyDrawing(id);
  if (!copied) return false;
  toast(lang() === 'en' ? 'Drawing copied' : 'Çizim kopyalandı');
  return true;
}

export function pasteCopiedDrawing(): boolean {
  const pasted = rt.overlay?.pasteDrawing();
  if (!pasted) return false;
  persistCompleted(pasted);
  toast(lang() === 'en' ? 'Drawing pasted' : 'Çizim yapıştırıldı');
  return true;
}

export function reorderDrawingById(id: string, dir: 'front' | 'back' | 'forward' | 'backward'): void {
  if (rt.overlay?.reorderDrawing(id, dir)) mirrorMainDrawings();
}

export function toggleAllDrawingsLocked(): void {
  const next = !ui.allDrawingsLocked;
  setUi('allDrawingsLocked', next);
  rt.overlay?.setAllLocked(next);
  toast(
    lang() === 'en'
      ? next ? 'All drawing tools locked' : 'All drawing tools unlocked'
      : next ? 'Tüm çizim araçları kilitlendi' : 'Çizim kilidi kaldırıldı'
  );
}

export function setZoomMode(on: boolean): void {
  setUi('zoomMode', on);
  if (on && ui.tool !== 'cursor') setTool('cursor');
}

export function openQuickSearch(mode: 'symbol' | 'quick' = 'symbol', initialQuery = ''): void {
  batch(() => {
    setUi('searchMode', mode);
    setUi('searchInitialQuery', initialQuery);
    setUi('modal', 'search');
  });
}

export function openQuickInterval(initial = ''): void {
  batch(() => {
    setUi('quickIntervalText', initial);
    setUi('quickIntervalOpen', true);
  });
}

export function closeQuickInterval(): void {
  setUi('quickIntervalOpen', false);
}

export function cycleActiveSlot(delta: 1 | -1): void {
  const n = visibleSlotCount();
  if (n <= 1) return;
  setActiveSlot((ui.activeSlot + delta + n) % n);
}

export function cycleWatchlistSymbol(delta: 1 | -1): void {
  const list = symbols();
  if (list.length === 0) return;
  const cur = ui.symbol.toUpperCase();
  const idx = list.findIndex((s) => s.symbol.toUpperCase() === cur);
  const nextIdx = idx < 0 ? 0 : (idx + delta + list.length) % list.length;
  void switchSymbol(list[nextIdx].symbol, ui.interval);
}

export function setChartStyle(mode: ChartStyleMode): void {
  const prev = ui.chartStyle;
  if (prev === mode) return;
  setUi('chartStyle', mode);
  pushHistory({
    labelTr: `Grafik stili (${mode})`,
    labelEn: `Chart style (${mode})`,
    undo: () => setUi('chartStyle', prev),
    redo: () => setUi('chartStyle', mode),
  });
}

export function switchColorTheme(id: string): void {
  const prev = colorThemeId();
  if (prev === id) return;
  const preset = applyColorTheme(id);
  pushHistory({
    labelTr: `Tema (${preset.nameTr})`,
    labelEn: `Theme (${preset.nameEn})`,
    undo: () => { applyColorTheme(prev); },
    redo: () => { applyColorTheme(id); },
  });
}

export function setTimezone(tz: string): void {
  const next = cloneChartSettings(ui.chartSettings);
  next.symbol.timezone = tz;
  applyChartSettingsAll(next, false);
}

export function toggleSessionMode(): void {
  const next = cloneChartSettings(ui.chartSettings);
  next.symbol.session = next.symbol.session === 'regular' ? 'extended' : 'regular';
  applyChartSettingsAll(next, false);
}

export function applyChartSettingsAll(nextRaw: ChartSettings, notify = true): void {
  const prev = cloneChartSettings(ui.chartSettings);
  const prevVisual = { ...ui.visual };
  const prevEvents = { ...ui.eventFlags };
  const prevSide = ui.mainScaleSide;
  const next = normalizeChartSettings(nextRaw);

  const applyOne = (cfg: ChartSettings) => {
    batch(() => {
      setUi('chartSettings', reconcile(cfg));
      setUi('visual', {
        upColor: cfg.symbol.upColor,
        downColor: cfg.symbol.downColor,
        bgColor: cfg.canvas.bgColor,
        showGrid: cfg.canvas.showVertGrid || cfg.canvas.showHorzGrid,
        showQuickTrade: cfg.trading.showQuickTrade && cfg.status.showBuySell,
      });
      setUi('eventFlags', {
        dividends: cfg.events.dividends,
        splits: cfg.events.splits,
        earnings: cfg.events.earnings,
      });
      setUi('mainScaleSide', cfg.scales.placement);
    });
    rt.chart?.applyChartSettings(cfg, ui.symbol);
    rt.chart?.setEventOptions({ dividends: cfg.events.dividends, splits: cfg.events.splits, earnings: cfg.events.earnings });
    for (const s of rt.secondaries) s?.applyChartSettings(cfg);
  };

  applyOne(next);
  pushHistory({
    labelTr: 'Grafik ayarları',
    labelEn: 'Chart settings',
    undo: () => {
      applyOne(prev);
      setUi('visual', prevVisual);
      setUi('eventFlags', prevEvents);
      setUi('mainScaleSide', prevSide);
    },
    redo: () => applyOne(next),
  });
  if (notify) toast(lang() === 'en' ? 'Settings applied' : 'Ayarlar uygulandı');
}

export function deleteSelectedDrawing(): boolean {
  if (!rt.overlay?.getSelectedDrawing()) return false;
  void rt.overlay.deleteSelectedDrawing();
  mirrorMainDrawings();
  toast(tt("Çizim silindi"));
  return true;
}

export function removeDrawing(id: string): void {
  rt.overlay?.removeDrawingById(id);
  mirrorMainDrawings();
}

export function clearDrawings(): void {
  rt.overlay?.clearAll();
  const scope = drawingScopeFor(ui.sync.drawings, activeLayoutId() ?? '', 0);
  void clearSymbolDrawings(ui.symbol, scope.layoutId || undefined).catch(() => toast(tt("Çizimler sunucudan silinemedi")));
  mirrorMainDrawings();
  toast(tt("Tüm çizimler temizlendi"));
}

// ---------- grafik / arayüz anahtarları ----------

export async function refreshChartEvents(
  symbol = ui.symbol,
  currency = meta()?.currency ?? 'USD',
  provider = meta()?.provider ?? 'YAHOO',
  market = meta()?.market ?? 'BIST'
): Promise<void> {
  if (provider !== 'YAHOO' || market === 'FOREX' || typeof fetchCorporateEvents !== 'function') {
    setChartEvents(null);
    rt.chart?.setCorporateEvents(null, currency, ui.eventFlags);
    return;
  }
  try {
    const ev = await fetchCorporateEvents(symbol);
    if (ev && symbol.toUpperCase() === ui.symbol.toUpperCase()) {
      setChartEvents(ev);
      rt.chart?.setCorporateEvents(ev, currency, ui.eventFlags);
    }
  } catch {
    // sessiz: olaylar grafiğin çalışmasını bloklamaz
  }
}

export function setEventFlags(patch: Partial<EventLayerOptions>): void {
  const next = { ...ui.eventFlags, ...patch };
  setUi('eventFlags', next);
  rt.chart?.setEventOptions(next);
}

export async function setDisplayCurrency(cur: DisplayCurrency): Promise<void> {
  setUi('displayCurrency', cur);
  setUi('menu', null);
  await loadSymbolData(ui.symbol, ui.interval);
}

function syncChartComparisons(list: ComparisonSeriesItem[]): void {
  setComparisons(list);
  const firstVis = list.find((x) => x.visible);
  setUi('compareSymbol', firstVis?.symbol ?? null);
  rt.chart?.setComparisonItems(list);
}

export async function addComparisonSymbol(rawSymbol: string, scaleMode: CompareScale = 'same'): Promise<boolean> {
  const sym = rawSymbol.trim().toUpperCase();
  if (!sym) return false;
  if (sym === ui.symbol.toUpperCase()) {
    toast(tt("Bu sembol zaten ana grafikte açık"));
    return false;
  }
  try {
    const h = await fetchHistory(sym, ui.interval);
    const list = h.candles || [];
    if (list.length === 0) {
      toast(tfmt("{0} için karşılaştırma verisi bulunamadı", sym));
      return false;
    }
    const first = list[0].close;
    const last = list[list.length - 1].close;
    const chgPct = first > 0 ? ((last - first) / first) * 100 : 0;
    const cur = comparisons();
    const existingIdx = cur.findIndex((x) => x.symbol.toUpperCase() === sym);
    const color = existingIdx >= 0 ? cur[existingIdx].color : COMPARE_COLORS[cur.length % COMPARE_COLORS.length];
    const item: ComparisonSeriesItem = {
      symbol: h.symbol || sym,
      color,
      scaleMode,
      visible: true,
      candles: list,
      lastClose: last,
      changePct: chgPct,
    };
    const next = existingIdx >= 0 ? cur.map((x, i) => (i === existingIdx ? item : x)) : [...cur, item];
    if (scaleMode === 'same' && ui.scaleKind !== 'percent') {
      setScale('percent');
    }
    setUi('compareScale', scaleMode);
    lastCompareInterval = ui.interval;
    syncChartComparisons(next);
    return true;
  } catch (e) {
    toast(tfmt("Karşılaştırma verisi alınamadı: {0}", errorMessage(e)));
    return false;
  }
}

export function removeComparisonSymbol(symbol: string): void {
  const sym = symbol.trim().toUpperCase();
  const next = comparisons().filter((x) => x.symbol.toUpperCase() !== sym);
  syncChartComparisons(next);
}

export function toggleComparisonVisible(symbol: string): void {
  const sym = symbol.trim().toUpperCase();
  const next = comparisons().map((x) => (x.symbol.toUpperCase() === sym ? { ...x, visible: !x.visible } : x));
  syncChartComparisons(next);
}

export function setComparisonItemScale(symbol: string, scaleMode: CompareScale): void {
  const sym = symbol.trim().toUpperCase();
  const next = comparisons().map((x) => (x.symbol.toUpperCase() === sym ? { ...x, scaleMode } : x));
  if (scaleMode === 'same' && ui.scaleKind !== 'percent') {
    setScale('percent');
  }
  setUi('compareScale', scaleMode);
  syncChartComparisons(next);
}

export function clearComparisons(): void {
  syncChartComparisons([]);
}

let lastCompareInterval = '';

async function refreshComparisonCandles(interval: Timeframe): Promise<void> {
  if (interval === lastCompareInterval) return;
  lastCompareInterval = interval;
  const snapshot = comparisons();
  if (snapshot.length === 0) return;
  const bySym = new Map<string, { candles: Candle[]; lastClose: number | null; changePct: number | null }>();
  await Promise.all(
    snapshot.map(async (it) => {
      try {
        const h = await fetchHistory(it.symbol, interval);
        const list = h.candles || [];
        const first = list[0]?.close ?? 0;
        const last = list[list.length - 1]?.close ?? null;
        const chgPct = first > 0 && last !== null ? ((last - first) / first) * 100 : null;
        bySym.set(it.symbol.toUpperCase(), { candles: list, lastClose: last, changePct: chgPct });
      } catch {
        // ignore
      }
    })
  );
  const next = comparisons().map((it) => {
    const up = bySym.get(it.symbol.toUpperCase());
    return up ? { ...it, ...up } : it;
  });
  syncChartComparisons(next);
}

export function toggleCompare(): void {
  setUi('modal', ui.modal === 'compare' ? null : 'compare');
}

export function setScale(kind: PriceScaleKind): void {
  const prev = ui.scaleKind;
  if (prev !== kind) {
    pushHistory({
      labelTr: `Ölçek (${kind})`,
      labelEn: `Scale (${kind})`,
      undo: () => setScale(prev),
      redo: () => setScale(kind),
    });
  }
  setUi('scaleKind', kind);
  if (kind === 'normal') rt.chart?.fitContent();
}

export function toggleScale(kind: 'log' | 'percent' | 'indexed'): void {
  const next: PriceScaleKind = ui.scaleKind === kind ? 'normal' : kind;
  setScale(next);
}

export function toggleScaleLock(): void {
  const prev = ui.scaleLock;
  const next = !prev;
  setUi('scaleLock', next);
  pushHistory({
    labelTr: next ? tt("Ölçek kilidi aç") : tt("Ölçek kilidi kapat"),
    labelEn: next ? 'Lock price-to-bar ratio' : 'Unlock price-to-bar ratio',
    undo: () => setUi('scaleLock', prev),
    redo: () => setUi('scaleLock', next),
  });
}

export function setMainScaleSide(side: 'right' | 'left'): void {
  setUi('mainScaleSide', side);
}

export function setCompareScale(mode: CompareScale): void {
  setUi('compareScale', mode);
  if (comparisons().length > 0) {
    const next = comparisons().map((x) => ({ ...x, scaleMode: mode }));
    syncChartComparisons(next);
  }
}

export function setPaneSide(id: PaneId, side: ScaleSide): void {
  if (id === 'main') setUi('mainScaleSide', side === 'left' ? 'left' : 'right');
  else setUi('paneSides', id, side);
}

const ADVANCED_WB_TABS: WorkbenchTab[] = ['market', 'corr', 'des', 'news', 'whale', 'insight', 'ideas'];

export function toggleSimpleMode(): void {
  const on = !ui.simple;
  batch(() => {
    setUi('simple', on);
    if (on) {
      // Gelişmiş yüzeyler kapanır: açık Analiz sekmesi / komut çubuğu geride kalmasın
      if (ADVANCED_WB_TABS.includes(ui.wbTab)) setUi('wbTab', 'backtest');
      if (ui.modal === 'command') setUi('modal', null);
    }
  });
}

/** Pane menüsü (⚙): ekran konumu + hangi pane. */
export interface PaneMenuState {
  id: PaneId;
  x: number;
  y: number;
}
export const [paneMenu, setPaneMenu] = createSignal<PaneMenuState | null>(null);

/** Pane ✕: rsi/macd göstergesi kapanır; Betik alt paneli gizlenir. */
export function closePaneById(id: PaneId): void {
  if (id === 'rsi' || id === 'macd') {
    if (ui.quick[id]) toggleIndicator(id);
  } else if (id === 'script') {
    setUi('scriptSubHidden', true);
  }
  setPaneMenu(null);
}

export function rangeJump(range: string): void {
  void switchSymbol(ui.symbol, RANGE_JUMP_TF[range] || '15m');
}

export function toggleIndicator(key: keyof ActiveQuickIndicators): void {
  const prev = !!ui.quick[key];
  const next = !prev;
  setUi('quick', key, next);
  pushHistory({
    labelTr: `${key.toUpperCase()} ${next ? 'ekle' : tt("kaldır")}`,
    labelEn: `${next ? 'Add' : 'Remove'} ${key.toUpperCase()}`,
    undo: () => setUi('quick', key, prev),
    redo: () => setUi('quick', key, next),
  });
}

export function applyTemplate(key: TemplateKey): void {
  const t = TEMPLATES.find((x) => x.key === key);
  if (!t) return;
  const flags = templateFlags(t);
  if (flags) {
    setUi('quick', flags);
  } else {
    setUi('scriptCode', BUILTIN_SCRIPT_PRESETS[0].code);
    runScript();
  }
  toast(t.toast);
}

export function openDrawerTab(tab: RightDrawerTab): void {
  if (ui.drawerTab === tab) {
    setUi('drawerTab', null);
  } else {
    setUi('drawerTab', tab);
    if (ui.mobile) {
      setUi('toolsOpen', false);
      setUi('wbCollapsed', true);
    }
    if (tab === 'alerts' || tab === 'hotlists') void refreshScreener('ALL');
  }
  scheduleResize(60);
}

/**
 * Mobil/masaüstü geçişi. Mobile geçerken kenar panelleri kapatır (grafik tam ekran kalsın);
 * masaüstüne dönerken izleme listesini geri açar.
 */
export function applyViewport(width: number): void {
  const mobile = isMobileWidth(width);
  if (mobile === ui.mobile) return;
  batch(() => {
    setUi('mobile', mobile);
    setUi('toolsOpen', false);
    if (mobile) {
      setUi('drawerTab', null);
      setUi('wbCollapsed', true);
    } else {
      setUi('drawerTab', 'watchlist');
      setUi('wbCollapsed', false);
    }
  });
  scheduleResize(60);
}

/** Mobilde alt çubuk sekmeleri: yalnız bir tam ekran panel açık olur. */
export function toggleToolsPanel(): void {
  batch(() => {
    setUi('toolsOpen', !ui.toolsOpen);
    if (ui.toolsOpen) setUi('drawerTab', null);
  });
  scheduleResize(60);
}

export function toggleWorkbenchMobile(): void {
  batch(() => {
    const open = ui.wbCollapsed;
    setUi('wbCollapsed', !open);
    if (open) {
      setUi('drawerTab', null);
      setUi('toolsOpen', false);
    }
  });
  scheduleResize(60);
}

export function closeDrawer(): void {
  setUi('drawerTab', null);
  scheduleResize(60);
}

export function setWorkbenchTab(tab: WorkbenchTab): void {
  batch(() => {
    setUi('wbTab', tab);
    if (ui.wbCollapsed) {
      setUi('wbCollapsed', false);
      scheduleResize();
    }
  });
  if (tab === 'screener') void refreshScreener();
}

export function toggleWorkbench(): void {
  setUi('wbCollapsed', !ui.wbCollapsed);
  scheduleResize();
}

export function toggleSplit(): void {
  setLayoutGrid(nextLayout(ui.layout));
}

export function applyVisual(v: VisualSettings): void {
  setUi('visual', v);
  toast(tt("Ayarlar uygulandı"));
}

// v3: eski kayıtlar EMA9/EMA21/VPVR'yi varsayılan olarak saklıyordu; yeni sürüm varsayılan betikle açılır
const LAYOUT_KEY = 'titanview_layout_v3';

export function saveLayout(): void {
  if (readOnlyLayout()) {
    toast(tt("Salt-okur paylaşılan düzen: düzenlemek için \"Kopya oluştur\" kullanın"));
    return;
  }
  try {
    localStorage.setItem(
      LAYOUT_KEY,
      JSON.stringify({
        symbol: ui.symbol,
        interval: ui.interval,
        chartStyle: ui.chartStyle,
        layout: ui.layout,
        secondarySymbols: [...ui.secondarySymbols],
        slots: ui.slots.map((s) => ({ ...s })),
        sync: { ...ui.sync },
        favTimeframes: [...ui.favTimeframes],
        customTimeframes: [...ui.customTimeframes],
        visualSettings: ui.visual,
        quickFlags: { ...ui.quick },
      })
    );
    if (saveActiveLayoutHook) {
      void saveActiveLayoutHook();
    } else {
      toast(tt("💾 Grafik düzeniniz başarıyla kaydedildi!"));
    }
  } catch {
    toast(tt("Düzen kaydedilemedi (tarayıcı depolaması kapalı)"));
  }
}

export function restoreLayout(): void {
  try {
    const raw = localStorage.getItem(LAYOUT_KEY);
    if (!raw) return;
    const s = JSON.parse(raw) as {
      symbol?: string;
      interval?: Timeframe;
      chartStyle?: ChartStyleMode;
      layout?: ChartLayout;
      secondarySymbols?: string[];
      slots?: ChartSlotConfig[];
      sync?: LayoutSyncOptions;
      favTimeframes?: Timeframe[];
      customTimeframes?: Timeframe[];
      visualSettings?: VisualSettings;
      quickFlags?: ActiveQuickIndicators;
    };
    batch(() => {
      if (s.symbol) setUi('symbol', s.symbol);
      if (s.interval && isValidInterval(s.interval)) {
        const iv = normalizeInterval(s.interval);
        if (iv) setUi('interval', iv);
      }
      if (s.chartStyle) setUi('chartStyle', s.chartStyle);
      if (s.layout && isChartLayout(s.layout) && !ui.mobile) setUi('layout', s.layout);
      if (Array.isArray(s.secondarySymbols) && s.secondarySymbols.length >= 3 && s.secondarySymbols.every((x) => typeof x === 'string' && x)) {
        setUi('secondarySymbols', [...s.secondarySymbols]);
      }
      if (Array.isArray(s.slots) && s.slots.length > 0) {
        const merged = defaultSlots(s.symbol ?? ui.symbol, s.interval ?? ui.interval);
        s.slots.slice(0, MAX_CHARTS).forEach((sl, idx) => {
          if (sl?.symbol) merged[idx] = { symbol: sl.symbol.toUpperCase(), interval: normalizeInterval(sl.interval) ?? ui.interval, ...(sl.chartStyle ? { chartStyle: sl.chartStyle } : {}) };
        });
        setUi('slots', merged);
      }
      if (s.sync) setUi('sync', normalizeSyncOptions(s.sync));
      if (Array.isArray(s.favTimeframes) && s.favTimeframes.length > 0) setUi('favTimeframes', [...s.favTimeframes]);
      if (Array.isArray(s.customTimeframes)) setUi('customTimeframes', [...s.customTimeframes]);
      if (s.visualSettings) setUi('visual', migrateVisual({ ...DEFAULT_VISUAL, ...s.visualSettings }));
      if (s.quickFlags) setUi('quick', { ...DEFAULT_INDICATORS, ...s.quickFlags });
    });
  } catch {
    // bozuk kayıt yok sayılır
  }
}

// ---------- replay ----------

export function createReplay(): BarReplay {
  return new BarReplay({
    onStep: (step) => {
      setCandles(step);
      rt.chart?.setHistoryData(step);
      runScript();
    },
    onStop: () => {
      setUi('replayActive', false);
      if (!suppressReplayReload) void switchSymbol(ui.symbol, ui.interval);
    },
  });
}

export function toggleReplay(): void {
  const replay = rt.replay;
  if (!replay) return;
  if (replay.isActive()) {
    stopReplay();
    return;
  }
  if (candles().length < 10) return;
  setUi('replayActive', true);
  const sliced = replay.start(candles());
  setCandles(sliced);
  rt.chart?.setHistoryData(sliced);
  runScript();
}

export function stopReplay(): void {
  if (!rt.replay?.isActive()) return;
  rt.replay.stop();
  setUi('replayActive', false);
}

// ---------- açılış ----------

// ---------- çalışma alanı kalıcılığı ----------

const WS_LOCAL_KEY = 'titanview_workspace_v1';
let wsReady = false;
let wsStarted = false;
let wsTimer: ReturnType<typeof setTimeout> | undefined;
let wsLast = '';

export function buildWorkspaceStateObject(): Record<string, unknown> {
  const input: WorkspaceInput = {
    symbol: ui.symbol,
    interval: ui.interval,
    chartStyle: ui.chartStyle,
    scaleKind: ui.scaleKind,
    invertScale: ui.invertScale,
    scaleLock: ui.scaleLock,
    mainScaleSide: ui.mainScaleSide,
    paneSides: { ...ui.paneSides },
    simple: ui.simple,
    styleParams: JSON.parse(JSON.stringify(ui.styleParams)) as Record<string, unknown>,
    layout: ui.layout,
    secondarySymbols: [...ui.secondarySymbols],
    slots: ui.slots.map((s) => ({ ...s })),
    sync: { ...ui.sync },
    favTimeframes: [...ui.favTimeframes],
    customTimeframes: [...ui.customTimeframes],
    visual: { ...ui.visual },
    quick: { ...ui.quick } as unknown as Record<string, boolean>,
    scriptCode: ui.scriptCode,
    scriptCode2: ui.scriptCode2,
    magnet: ui.magnet,
    magnetMode: ui.magnetMode,
    stayInDrawing: ui.stayInDrawing,
    favTools: [...ui.favTools],
    favBarVisible: ui.favBarVisible,
    favBarPos: { ...ui.favBarPos },
    toolStyles: JSON.parse(JSON.stringify(ui.toolStyles)),
    drawTemplates: JSON.parse(JSON.stringify(ui.drawTemplates)),
    iconChoice: ui.iconChoice,
    hideDrawings: ui.hideDrawings,
    wbTab: ui.wbTab,
    wbCollapsed: ui.wbCollapsed,
    drawerTab: ui.drawerTab,
    marketFilter: ui.marketFilter,
    screenerMarket: ui.screenerMarket,
    quickQty: ui.quickQty,
    alerts: alerts(),
    chartSettings: JSON.parse(JSON.stringify(ui.chartSettings)) as Record<string, unknown>,
    lang: lang(),
    colorTheme: colorThemeId(),
    allDrawingsLocked: ui.allDrawingsLocked,
  };
  const d = initialUi();
  return buildWorkspace(input, { scriptCode: d.scriptCode, scriptCode2: d.scriptCode2 });
}

function workspaceSnapshot(): string {
  return JSON.stringify(buildWorkspaceStateObject());
}

/** Ayrıştırılmış çalışma alanı veya kayıtlı düzen yamasını store'a uygular. */
export function applyWorkspaceState(raw: unknown): boolean {
  const p = parseWorkspace(raw);
  if (!p) return false;
  batch(() => {
    if (p.symbol) setUi('symbol', p.symbol);
    if (p.interval && isValidInterval(p.interval)) {
      const iv = normalizeInterval(p.interval);
      if (iv) setUi('interval', iv);
    }
    if (p.chartStyle) setUi('chartStyle', p.chartStyle);
    if (p.scaleKind) setUi('scaleKind', p.scaleKind);
    if (p.invertScale !== undefined) setUi('invertScale', p.invertScale);
    if (p.scaleLock !== undefined) setUi('scaleLock', p.scaleLock);
    if (p.mainScaleSide) setUi('mainScaleSide', p.mainScaleSide);
    if (p.paneSides) setUi('paneSides', { ...p.paneSides });
    if (p.simple !== undefined) setUi('simple', p.simple);
    if (p.styleParams) setUi('styleParams', normalizeStyleParams(p.styleParams));
    if (p.layout && !ui.mobile) setUi('layout', p.layout);
    setUi('activeSlot', 0);
    setUi('maximizedSlot', null);
    if (p.secondarySymbols) setUi('secondarySymbols', [...p.secondarySymbols]);
    if (p.slots && p.slots.length > 0) {
      const merged = defaultSlots(p.symbol ?? ui.symbol, (p.interval as Timeframe) ?? ui.interval);
      p.slots.slice(0, MAX_CHARTS).forEach((sl, idx) => {
        merged[idx] = { ...sl };
      });
      setUi('slots', merged);
      setUi('secondarySymbols', [merged[1].symbol, merged[2].symbol, merged[3].symbol]);
    } else if (p.secondarySymbols) {
      const merged = defaultSlots(p.symbol ?? ui.symbol, (p.interval as Timeframe) ?? ui.interval);
      p.secondarySymbols.forEach((sym, i) => {
        if (i + 1 < MAX_CHARTS) merged[i + 1] = { symbol: sym, interval: (p.interval as Timeframe) ?? ui.interval };
      });
      setUi('slots', merged);
    }
    if (p.sync) setUi('sync', normalizeSyncOptions(p.sync));
    if (p.favTimeframes && p.favTimeframes.length > 0) setUi('favTimeframes', [...p.favTimeframes]);
    if (p.customTimeframes) setUi('customTimeframes', [...p.customTimeframes]);
    if (p.visual) setUi('visual', migrateVisual({ ...DEFAULT_VISUAL, ...(p.visual as Partial<VisualSettings>) }));
    if (p.quick) setUi('quick', { ...DEFAULT_INDICATORS, ...(p.quick as Partial<ActiveQuickIndicators>) });
    if (p.scriptCode) setUi('scriptCode', p.scriptCode);
    if (p.scriptCode2 !== undefined) setUi('scriptCode2', p.scriptCode2);
    if (p.magnet !== undefined) setUi('magnet', p.magnet);
    if (p.hideDrawings !== undefined) setUi('hideDrawings', p.hideDrawings);
    if (p.magnetMode) setUi('magnetMode', p.magnetMode);
    if (p.stayInDrawing !== undefined) setUi('stayInDrawing', p.stayInDrawing);
    if (p.favTools) setUi('favTools', p.favTools);
    if (p.favBarVisible !== undefined) setUi('favBarVisible', p.favBarVisible);
    if (p.favBarPos) setUi('favBarPos', p.favBarPos);
    if (p.toolStyles) setUi('toolStyles', reconcile(p.toolStyles));
    if (p.drawTemplates) setUi('drawTemplates', p.drawTemplates);
    if (p.iconChoice) setUi('iconChoice', p.iconChoice);
    if (p.wbTab) setUi('wbTab', p.wbTab as WorkbenchTab);
    // Faz 30: mobilde (varsayılan olarak) açılış her zaman grafikle; kayıtlı alt panel masaüstü durumudur
    if (p.wbCollapsed !== undefined && !ui.mobile) setUi('wbCollapsed', p.wbCollapsed);
    if (p.drawerTab !== undefined && !ui.mobile) setUi('drawerTab', p.drawerTab as RightDrawerTab | null);
    if (p.marketFilter) setUi('marketFilter', p.marketFilter as MarketFilter);
    if (p.screenerMarket) setUi('screenerMarket', p.screenerMarket as MarketFilter);
    if (p.quickQty) setUi('quickQty', p.quickQty);
    if (p.alerts) setAlerts(p.alerts);
    if (p.chartSettings) setUi('chartSettings', reconcile(normalizeChartSettings(p.chartSettings)));
    if (p.allDrawingsLocked !== undefined) setUi('allDrawingsLocked', p.allDrawingsLocked);
    if (p.lang && !langExplicit()) setLang(p.lang, { reload: false });
    if (p.colorTheme) applyColorTheme(p.colorTheme);
  });
  return true;
}

/** Sunucudaki çalışma alanı esas; ulaşılamazsa yerel önbellek. Hiçbiri yoksa varsayılanlar. */
export async function loadWorkspace(): Promise<void> {
  let raw: unknown = null;
  try {
    raw = await fetchSetting(WORKSPACE_KEY);
  } catch {
    raw = null;
  }
  if (raw == null) {
    try {
      raw = JSON.parse(localStorage.getItem(WS_LOCAL_KEY) ?? 'null');
    } catch {
      raw = null;
    }
  }
  applyWorkspaceState(raw);
}

async function flushWorkspace(keepalive = false): Promise<void> {
  if (readOnlyLayout()) return;
  const snap = workspaceSnapshot();
  if (snap === wsLast) return;
  wsLast = snap;
  try {
    localStorage.setItem(WS_LOCAL_KEY, snap);
  } catch {
    // depolama kapalı: sunucu kopyası yeterli
  }
  try {
    await saveSetting(WORKSPACE_KEY, JSON.parse(snap), keepalive);
  } catch {
    wsLast = ''; // yazılamadı: bir sonraki değişiklikte yeniden dene
  }
}

/** Her tercih değişikliğinde (1 sn sessizlikten sonra) sunucuya + yerel önbelleğe yazar; sayfa kapanırken de boşaltır. */
export function startWorkspaceAutosave(): void {
  wsReady = true;
  wsLast = workspaceSnapshot();
  if (wsStarted) return;
  wsStarted = true;
  createRoot(() => {
    createEffect(() => {
      workspaceSnapshot(); // bağımlılıkları izle
      if (!wsReady || readOnlyLayout()) return;
      setLayoutDirty(true);
      if (wsTimer !== undefined) clearTimeout(wsTimer);
      wsTimer = setTimeout(() => void flushWorkspace(), 1000);
    });
  });
  if (typeof window !== 'undefined') window.addEventListener('pagehide', () => void flushWorkspace(true));
}

function handleIncomingTabMessage(msg: TabSyncMessage): void {
  if (msg.type === 'layouts_changed') {
    void layoutsRefreshHook?.();
    return;
  }
  if (!ui.sync.crossTab) {
    // Çizim genel eşitleme açıksa çizim değişikliği crossTab kapalıyken de tazelenir.
    if (msg.type === 'drawings' && ui.sync.drawings === 'global') {
      void reloadDrawingsForAllSlots();
    }
    return;
  }
  const n = visibleSlotCount();
  switch (msg.type) {
    case 'symbol':
      if (ui.sync.symbol && msg.symbol.toUpperCase() !== activeChartSymbol().toUpperCase()) {
        void switchSymbol(msg.symbol, activeChartInterval(), { fromTab: true });
      }
      break;
    case 'interval':
      if (ui.sync.interval && msg.interval !== activeChartInterval()) {
        void switchSymbol(activeChartSymbol(), msg.interval, { fromTab: true });
      }
      break;
    case 'crosshair':
      propagateCrosshair(-1, msg.time, n, ui.sync, getChartBySlot, rt.tabBus, true);
      break;
    case 'time':
      propagateTimeClick(-1, msg.time, n, ui.sync, getChartBySlot, rt.tabBus, true);
      break;
    case 'dateRange':
      propagateDateRange(-1, { from: msg.from, to: msg.to }, n, ui.sync, getChartBySlot, rt.tabBus, true);
      break;
    case 'drawings':
      if (ui.sync.drawings !== 'off') void reloadDrawingsForAllSlots();
      break;
  }
}

export async function bootstrap(): Promise<void> {
  const qs = typeof location !== 'undefined' ? new URLSearchParams(location.search) : null;
  const shareTok = qs?.get('share');
  let openedShared = false;
  if (shareTok && sharedLayoutHook) {
    openedShared = await sharedLayoutHook(shareTok);
  }
  if (!openedShared) {
    withoutHistory(() => {
      restoreLayout();
    });
    await loadWorkspace();
    // Faz 23/29: derin bağlantılar (`?symbol=&interval=&style=&scale=&theme=&lang=`)
    withoutHistory(() => {
      const linked = qs?.get('symbol') ?? null;
      if (linked && /^[A-Za-z0-9.^=_*/()+-]{1,40}$/.test(linked)) {
        setUi('symbol', linked.toUpperCase());
        setUi('slots', 0, 'symbol', linked.toUpperCase());
      }
      const qIv = qs?.get('interval');
      if (qIv && isValidInterval(qIv)) {
        const norm = normalizeInterval(qIv);
        if (norm) {
          setUi('interval', norm);
          setUi('slots', 0, 'interval', norm);
        }
      }
      const qStyle = qs?.get('style') as ChartStyleMode | null;
      if (qStyle) setUi('chartStyle', qStyle);
      const qScale = qs?.get('scale') as PriceScaleKind | null;
      if (qScale && ['normal', 'log', 'percent', 'indexed'].includes(qScale)) setUi('scaleKind', qScale);
      const qTheme = qs?.get('theme');
      if (qTheme) applyColorTheme(qTheme);
      const qLang = qs?.get('lang');
      if (qLang === 'tr' || qLang === 'en') setLang(qLang, { reload: false });
    });
  }
  clearHistory();
  startWorkspaceAutosave();
  void restoreFavorites().then(() => repairBareFavorites()).then(() => repairBareWatchlistSymbols(symbols()))
    .then(async () => {
      // Kayıtlı çalışma alanı yalın bir kodda açıldıysa (EUREN) grafiği de doğru borsaya taşı.
      if (needsResolve(ui.symbol, symbols()) && (await resolveSymbol(ui.symbol, symbols())) !== ui.symbol.toUpperCase()) await switchSymbol(ui.symbol, ui.interval);
    })
    .catch(() => undefined);
  void refreshSavedScripts();
  void layoutsRefreshHook?.();
  await Promise.all([loadSymbolData(ui.symbol, ui.interval), refreshWatchlist(), refreshScreener('ALL')]);
  startQuotePolling();
  startFeedWatchdog();
  startAnalysisLive();
  startFootprintFeed();

  // Faz 25: BroadcastChannel sekmeler arası eşitleme veriyolu
  if (!rt.tabBus) {
    const bus = new TabSyncBus();
    bus.onPeersChange((n) => setConnectedTabs(n));
    bus.subscribe(handleIncomingTabMessage);
    rt.tabBus = bus;
  }

  const socket = new LiveMarketSocket(
    (msg) => {
      // Ana grafik tick'i
      if (isTickForCurrent(msg, ui.symbol, ui.interval)) {
        const t0 = tickClock.lastReceivedAt || performance.now();
        handleLiveTick(msg.candle);
        markTickRendered(t0);
      }
      // Ek grafiklerin canlı tick'leri (yalnız aynı sembol/aralık gerçekten yüklendiyse)
      const count = visibleSlotCount();
      const infos = slotInfos();
      const msgKey = `${msg.symbol.toUpperCase()}|${msg.interval}`;
      for (let s = 1; s < count; s++) {
        if (infos[s]?.loadedKey === msgKey && isTickForCurrent(msg, slotSymbolAt(s), slotIntervalAt(s))) {
          rt.secondaries[s - 1]?.updateLiveCandle(msg.candle);
          patchSlotInfo(s, { lastCandle: msg.candle });
        }
      }
    },
    (connected) => {
      setUi('wsConnected', connected);
      if (connected) {
        syncLiveSubscriptions();
        void healTail(); // yeniden bağlanınca kaçan mumları doldur
      }
    }
  );
  rt.socket = socket;
  socket.connect(ui.symbol, ui.interval);
  if (visibleSlotCount() > 1) syncLiveSubscriptions();
}

// ---------- favoriler ----------

export const [favorites, setFavorites] = createSignal<Favorite[]>(loadFavorites());

export function toggleFav(item: Favorite): void {
  const next = toggleFavorite(favorites(), item);
  setFavorites(next);
  saveFavorites(next);
  void syncFavoritesToServer();
  void refreshQuotes();
}

/** Yalnız sembol adıyla favori aç/kapat (üst çubuk ☆, arama, komutlar). Yalın kod önce borsasına çözülür. */
export async function toggleFavSymbol(symbol: string): Promise<void> {
  if (!symbol.trim()) return;
  const sym = needsResolve(symbol, symbols()) ? await resolveSymbol(symbol, symbols()) : symbol;
  const info = resolvedInfo(symbol);
  toggleFav(info && info.symbol === sym ? info : favoriteFor(sym, symbols()));
}

/**
 * v1.0.1 öncesi yalın kodla eklenmiş favorileri onarır: "EUREN" (ABD sanılan) → "EUREN.IS" (BIST).
 * Yalnız katalogda olmayan, yalın ve ABD olarak işaretli kayıtlara dokunur.
 */
export async function repairBareFavorites(): Promise<number> {
  const list = favorites();
  let changed = 0;
  const next: Favorite[] = [];
  for (const f of list) {
    if (f.market === 'US' && needsResolve(f.symbol, symbols())) {
      const sym = await resolveSymbol(f.symbol, symbols());
      const info = resolvedInfo(f.symbol);
      if (sym !== f.symbol.toUpperCase() && !next.some((n) => n.symbol === sym) && !list.some((o) => o.symbol.toUpperCase() === sym)) {
        next.push(info ? { ...info } : favoriteFor(sym, symbols()));
        changed++;
        continue;
      }
    }
    next.push(f);
  }
  if (changed) {
    setFavorites(next);
    saveFavorites(next);
    void syncFavoritesToServer();
  }
  return changed;
}

/**
 * Açılışta yerel favorileri sunucudakiyle birleştirir: tarayıcı verisi silinmiş, farklı adres
 * (localhost / 127.0.0.1 / port) açılmış olsa bile favoriler geri gelir. Sunucuya yazmadan ÖNCE okur;
 * boş yerel liste sunucudakini asla silmez.
 */
export async function restoreFavorites(): Promise<void> {
  try {
    const remote = await fetchCollectItems();
    const merged = mergeFavorites(favorites(), remote);
    if (merged.length !== favorites().length) {
      setFavorites(merged);
      saveFavorites(merged);
    }
  } catch {
    return; // sunucu yok: yerel liste geçerli, sunucuya yazma (silme riski)
  }
  await syncFavoritesToServer();
}

/** Sunucu, favori sembollerin 15dk/1sa mumlarını arka planda toplar; hata sessizce yutulmaz ama akışı bozmaz. */
export async function syncFavoritesToServer(): Promise<void> {
  try {
    await syncCollectSymbols(favorites().map((f) => f.symbol));
  } catch {
    // sunucu yoksa favoriler yine yerelde saklıdır; bir sonraki açılışta eşitlenir
  }
}

/** Grafik tipi parametresini günceller (ör. setStyleParam('renko', { mode: 'fixed', box: 2 })). */
export function setStyleParam<K extends keyof StyleParams>(key: K, patch: Partial<StyleParams[K]>): void {
  setUi('styleParams', normalizeStyleParams({ ...ui.styleParams, [key]: { ...ui.styleParams[key], ...patch } }));
}

// ---------- Faz 30: §13 performans ölçüm kancaları (window.__titanPerf) ----------
if (typeof window !== 'undefined') {
  const w = window as unknown as { __titanPerf?: Record<string, unknown> };
  w.__titanPerf = {
    ...(w.__titanPerf ?? {}),
    /** 20 hazır gösterge + 2 TitanScript stratejisinin tam yeniden hesabı (gerçek worker yolu). */
    recalc: async (lastN?: number) => {
      const { recalcBench } = await import('./perfBench');
      const list = candles();
      return recalcBench(lastN ? list.slice(-lastN) : list, `recalc:${lastN ?? list.length}`);
    },
    /** Aynı bar içinde gerçek zamanlı tick: son barın kapanışı değişir, kapanmış barlar aynı (artımlı yol). */
    recalcTick: async (k = 1) => {
      const { recalcBench } = await import('./perfBench');
      const list = candles();
      const last = list[list.length - 1];
      const px = last.close * (1 + 0.0001 * k);
      const bars = [...list.slice(0, -1), { ...last, close: px, high: Math.max(last.high, px) }];
      return recalcBench(bars, `tick:${bars.length}`, false);
    },
    /** Ana grafiği kare kare kaydırıp yakınlaştırır; gerçek rAF kare süreleri. */
    scroll: async (frames = 240, mode: 'mix' | 'pan' | 'zoom' = 'mix') => {
      const { scrollBench } = await import('./perf');
      return scrollBench((i) => {
        const pan = mode === 'pan' || (mode === 'mix' && i % 40 < 20);
        if (pan) rt.chart?.scrollBars(i % 80 < 40 ? -25 : 25);
        else rt.chart?.zoomBy(i % 80 < 60 ? 1.04 : 0.96);
      }, frames);
    },
    bars: () => candles().length,
    open: (sym: string, iv: Timeframe) => switchSymbol(sym, iv),
    style: (m: ChartStyleMode) => setChartStyle(m),
    geometry: () => rt.chart?.debugPaneGeometry(),
    /** Gerçek eski geçmişi (1000'erlik parçalar) hedef bar sayısına ulaşana ya da kaynak bitene dek yükler. */
    loadBars: async (target = 100_000) => {
      let guard = 0;
      let stalls = 0;
      while (candles().length < target && guard++ < 400) {
        const before = candles().length;
        await loadOlderHistory(candles()[0]?.time ?? 0);
        if (candles().length === before) {
          // geçici ağ/kaynak hatası: birkaç kez yeniden dene, sonra dur
          if (++stalls > 3) break;
          await new Promise((r) => setTimeout(r, 500));
        } else stalls = 0;
      }
      return candles().length;
    },
  };
}
