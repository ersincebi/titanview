import { tt } from '../state/i18n';
import { formatCrosshairTime, setActiveTimezone, setTimeAxisDisplay, tickMarkFormatter } from './timezone';
import type { ChartSettings } from '../state/chartSettings';
import { isSecondsInterval } from '../state/intervals';
import {
  AreaSeries,
  BarSeries,
  BaselineSeries,
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineType,
  PriceScaleMode,
  createChart,
  createSeriesMarkers,
  createTextWatermark,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type ITextWatermarkPluginApi,
  type SeriesDefinition,
  type SeriesMarker,
  type SeriesPartialOptionsMap,
  type SeriesType,
  type Time,
} from 'lightweight-charts';
import { LANG_NAME } from '../script/brand';
import {
  calcBollingerBands,
  calcEMA,
  calcIchimoku,
  calcLatestBollinger,
  calcLatestEMA,
  calcLatestSMA,
  calcLatestSuperTrend,
  calcLatestVWAP,
  calcMACD,
  calcParabolicSAR,
  calcRSI,
  calcSMA,
  calcSuperTrend,
  calcVWAP,
  cleanLineData,
} from '../indicators/taEngine';
import { alignToBars, barIndexAtOrBefore, deriveCandles, isDerivedStyle, DEFAULT_STYLE_PARAMS, type DerivedBar, type DerivedStyle, type StyleParams } from './chartTypes';
import { createView, isCustomStyle, type CustomStyle, type OhlcvData } from './customSeries';
import { FootprintLayer, SessionProfiles, TpoLayer, VisibleRangeProfile } from './profilePrimitives';
import { niceStep, splitSessions, type FootprintBar } from './profile';
import { toHeikinAshi } from './heikinAshi';
import { ScriptLayer, type LayerMapper } from './ScriptLayer';
import { TradeLayer, type TradeLayerOptions } from './TradeLayer';
import { EventLayer, type EventLayerOptions } from './EventLayer';
import {
  compareScaleId,
  defaultStretch,
  dropPane,
  lockedPriceRange,
  maximizedStretch,
  movePane,
  reconcileOrder,
  scaleIdFor,
  type CompareScale,
  type PaneId,
  type ScaleSide,
} from './panes';
import { PaneChrome, type PaneChromeHooks } from './PaneChrome';
import { formatStudyValue, valueAt } from '../state/studyModel';
import type {
  BacktestTrade,
  Candle,
  ChartStyleMode,
  ScriptExecutionResult,
  PriceScaleKind,
  MarketType,
} from '../types/market';

/**
 * Faz 24: kapanmış işlemlerin giriş/çıkış işaretçilerini TradeLayer (ok + bağlantı çizgisi + etiket) çizer;
 * yinelenmesin diye bu zamanlardaki emir dolumu işaretçileri düşer (açık pozisyonun girişi kalır).
 */
export function withoutTradeLayerMarkers(res: ScriptExecutionResult): ScriptExecutionResult['markers'] {
  const trades = res.backtest?.trades;
  if (!trades || trades.length === 0) return res.markers;
  const entries = new Set(trades.map((t) => t.entryTime));
  const exits = new Set(trades.map((t) => t.exitTime));
  return res.markers.filter((m) => !(m.source === 'broker' && (m.shape === 'circle' ? exits.has(m.time) : entries.has(m.time))));
}

/** '#rrggbb' / 'rgb(a)' rengine alfa uygular (area dolgusu için). */
export function withAlpha(color: string, alpha: number): string {
  const hex = /^#([0-9a-f]{6})$/i.exec(color);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
  }
  const rgb = /^rgba?\(([^)]+)\)$/i.exec(color);
  if (rgb) {
    const [r, g, b] = rgb[1].split(',').map((x) => x.trim());
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  return color;
}

/** Faz 20: `state/studies.ts` çizim listesinin denetleyici görünümü (durum katmanına bağımlılık yok). */
export interface StudyRenderInput {
  uid: string;
  pane: string;
  label: string;
  result: ScriptExecutionResult;
  scale: 'right' | 'left' | 'none';
  priceLabels: boolean;
  /** durum satırında değer göster */
  statusValues?: boolean;
  /** -1 = otomatik */
  precision?: number;
}

interface StudyEntry {
  pane: PaneId;
  sig: string;
  series: ISeriesApi<SeriesType>[];
  priceLines: Array<{ series: ISeriesApi<SeriesType>; line: IPriceLine }>;
  update: (r: ScriptExecutionResult) => void;
  layer?: ScriptLayer;
}

const visiblePlots = (r: ScriptExecutionResult) => r.plots.filter((p) => !p.hidden && p.data.length > 0);
const hasDrawings = (r: ScriptExecutionResult) => {
  const d = r.drawings;
  return !!d && d.lines.length + d.boxes.length + d.labels.length + d.tables.length + (d.linefills?.length ?? 0) + (d.polylines?.length ?? 0) > 0;
};

/** Seri yapısının parmak izi: aynıysa seriler korunur, yalnızca veri güncellenir. */
export function studySignature(it: StudyRenderInput): string {
  const r = it.result;
  return JSON.stringify([
    it.pane,
    it.scale,
    it.priceLabels,
    visiblePlots(r).map((p) => [p.id, p.title, p.style, p.color, p.lineWidth]),
    (r.ohlcPlots ?? []).filter((o) => o.data.length > 0).map((o) => [o.id, o.kind]),
    r.hlines.map((h) => [h.price, h.color]),
    (r.fills?.length ?? 0) > 0 || (r.bgcolors?.length ?? 0) > 0 || hasDrawings(r),
  ]);
}

export interface ActiveQuickIndicators {
  ema9: boolean;
  ema21: boolean;
  ema55: boolean;
  sma200: boolean;
  bb: boolean;
  supertrend: boolean;
  vwap: boolean;
  ichimoku: boolean;
  psar: boolean;
  vpvr: boolean;
  rsi?: boolean;
  macd?: boolean;
}

export interface CrosshairHoverData {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  changePct: number;
}

/** Aynı bar içi tick'lerde gösterge hesaplama alt sınırı (ms). */
const LIVE_IND_MIN_MS = 250;
/**
 * Faz 30: plot/OHLC noktası eşitliği — önce referans (yama protokolü öneki paylaşır), sonra değer
 * (tam yeniden hesap sonrası yeni nesneler). Eşitse seriye yeniden basılmaz.
 */
function samePoint(a: any, b: any): boolean {
  if (a === b) return true;
  if (!a || !b || a.time !== b.time || a.color !== b.color) return false;
  if ('value' in a) return Object.is(a.value, b.value);
  return a.open === b.open && a.high === b.high && a.low === b.low && a.close === b.close && a.wickColor === b.wickColor && a.borderColor === b.borderColor;
}
/** lightweight-charts v5 pane ayracı yüksekliği (px). */
const PANE_SEPARATOR_PX = 1;

export interface ControllerHooks {
  /** ✕ ile pane kaldırıldı: gösterge kapatılmalı (rsi/macd) ya da Betik alt paneli gizlenmeli. */
  onPaneClose?: (id: PaneId) => void;
  /** ⚙: ölçek menüsü isteği (ekran koordinatı). */
  onPaneMenu?: (id: PaneId, x: number, y: number) => void;
  /** Pane sırası / büyütme durumu değişti. */
  onPanesChange?: () => void;
  /** Faz 25: imleç zamanı değişti (çoklu grafik imleç eşitlemesi). */
  onCrosshairTime?: (timeSec: number | null) => void;
  /** Faz 25: grafikte bir bar tıklandı (çoklu grafik zaman eşitlemesi). */
  onTimeClick?: (timeSec: number) => void;
  /** Faz 25: görünür [from, to] zaman aralığı değişti (tarih aralığı eşitlemesi). */
  onVisibleTimeRange?: (range: { from: number; to: number } | null) => void;
}

const MAIN_MARGINS = { top: 0.08, bottom: 0.22 };

export class TitanChartController {
  private mainContainer: HTMLElement;
  private mainChart: IChartApi;

  private candleSeries!: ISeriesApi<'Candlestick'>;
  private markersApi?: ISeriesMarkersPluginApi<Time>;
  private watermark?: ITextWatermarkPluginApi<Time>;
  private focusPending = false;
  /** Yeni veri yüklenirken setData aralığı geçici olarak 0'a çeker; eski veri isteği tetiklenmesin. */
  private settling = false;
  private settleTimer: ReturnType<typeof setTimeout> | undefined;
  /** Yükleme sonrası ilk Betik çizimi (projeksiyon geleceğe bar ekler) görünümü kaydırabilir: bir kez yeniden odakla. */
  private focusAfterScript = false;
  private lastIndAt = 0;
  private indTimer: ReturnType<typeof setTimeout> | undefined;
  private pendingInd: Candle | undefined;
  private barSeries!: ISeriesApi<'Bar'>;
  private lineSeries!: ISeriesApi<'Line'>;
  private areaSeries!: ISeriesApi<'Area'>;
  private baselineSeries!: ISeriesApi<'Baseline'>;
  private volumeSeries!: ISeriesApi<'Histogram'>;
  private compareSeries: ISeriesApi<'Line'> | null = null;
  private extraCompareSeries: Array<ISeriesApi<'Line'>> = [];
  private compareScale: CompareScale = 'same';

  // ---- pane yönetimi (v5 yerel pane'ler)
  /** Her mantıksal pane'in izlenen serileri (hacim hariç: kendi örtü ölçeği var). */
  private paneSeries = new Map<PaneId, ISeriesApi<SeriesType>[]>();
  /** Kullanıcının tercih ettiği sıra (aktif olmayanlar da hatırlanır). */
  private paneOrderPref: PaneId[] = ['main', 'rsi', 'macd', 'script'];
  private paneSide = new Map<PaneId, ScaleSide>();
  private paneLabels = new Map<PaneId, string>();
  private stretchInit = new Set<PaneId>();
  private savedStretch = new Map<PaneId, number>();
  private maximized: PaneId | null = null;
  private scriptSubHidden = false;
  private chrome?: PaneChrome;
  private paneObserver?: ResizeObserver;
  private observed = new Set<Element>();
  private scaleLocked = false;
  private lockRatio: { b0: number; span0: number } | null = null;
  private hooks: ControllerHooks;
  /** Faz 25: çoklu grafik eşitlemesinde yankı döngüsünü engelleyen bayraklar. */
  private extCrosshair = false;
  private extRange = false;
  private showSeconds = false;

  private quickSeriesMap = new Map<string, ISeriesApi<'Line'>>();
  private scriptOverlaySeries: Array<ISeriesApi<'Line' | 'Histogram'>> = [];
  private scriptSubSeries: Array<ISeriesApi<'Line' | 'Histogram'>> = [];
  private scriptPriceLines: IPriceLine[] = [];
  private scriptMainLayer?: ScriptLayer;
  private tradeLayer?: TradeLayer;
  private eventLayer?: EventLayer;
  private scriptSubLayer?: ScriptLayer;
  private barColors = new Map<number, string>();

  private rsiSeries: ISeriesApi<'Line'> | null = null;
  private macdLineSeries: ISeriesApi<'Line'> | null = null;
  private macdSignalSeries: ISeriesApi<'Line'> | null = null;
  private macdHistSeries: ISeriesApi<'Histogram'> | null = null;

  private rawCandles: Candle[] = [];
  /** Renko/Range/Line Break açıkken görüntülenen türetilmiş çubuklar (aksi halde boş). */
  private derivedBars: DerivedBar[] = [];
  private derivedBasis: Candle[] = [];
  private rawTimesCache: { src: Candle[]; n: number; last: number; times: number[] } | null = null;
  /** Ham mum zamanları (artan); yalnız mum dizisi/uzunluğu değişince yeniden kurulur. */
  private rawTimes(): number[] {
    const rc = this.rawCandles;
    const n = rc.length;
    const c = this.rawTimesCache;
    if (c && c.src === rc && c.n === n && c.last === (n ? rc[n - 1].time : 0)) return c.times;
    const times = rc.map((x) => x.time);
    this.rawTimesCache = { src: rc, n, last: n ? rc[n - 1].time : 0, times };
    return times;
  }

  /** Türetilmiş stillerin kutu/dönüş boyutunun hesaplandığı (yüklemede sabitlenen) mumlar. */
  public derivedBasisCandles(): Candle[] {
    return this.derivedBasis.length >= 2 ? this.derivedBasis : this.rawCandles;
  }
  /** Faz 16: grafik tipi parametreleri, özel seri (Volume candles, HLC area, Columns, High-low, Kagi, P&F) */
  private styleParams: StyleParams = DEFAULT_STYLE_PARAMS;
  private customSeries: ISeriesApi<'Custom', Time, OhlcvData> | null = null;
  private customStyle: CustomStyle | null = null;
  private market: string | undefined;
  /** Görünür aralık hacim profili (VPVR) — canvas primitive */
  private vrvp: VisibleRangeProfile | null = null;
  /** Seans VP / TPO / Footprint katmanı (grafik tipi olarak) */
  private profileLayer: SessionProfiles | TpoLayer | FootprintLayer | null = null;
  private footprintData = new Map<number, FootprintBar>();
  private footprintRow = 1;
  private tpoRow = 1;
  private savedBarSpacing: number | null = null;
  private lastPriceLine: IPriceLine | null = null;
  /** Faz 23: aktif fiyat alarmlarının yatay çizgileri (görünür ana seride) */
  private alertLineDefs: Array<{ price: number; title: string }> = [];
  private alertLineColor = '#FF9800';
  private alertLinesVisible = true;
  private showHighLowLines = false;
  private highLowLines: IPriceLine[] = [];
  private showSessionBreaks = false;
  private sessionBreakColor = '#0284C7';
  private sessionBreakSvg: SVGSVGElement | null = null;
  private watermarkColor = 'rgba(255, 255, 255, 0.035)';
  private lastWatermarkText = '';
  private alertLines: Array<{ series: ISeriesApi<SeriesType>; line: IPriceLine }> = [];
  private lastScript: ScriptExecutionResult | null = null;
  private styleMode: ChartStyleMode = 'candles';
  private scaleKind: PriceScaleKind = 'normal';
  private isLoadingOlder = false;
  private quickFlags: ActiveQuickIndicators = {
    ema9: true,
    ema21: true,
    ema55: false,
    sma200: false,
    bb: false,
    supertrend: false,
    vwap: false,
    ichimoku: false,
    psar: false,
    vpvr: true,
    rsi: false,
    macd: false,
  };

  // ---- Faz 20: grafikteki gösterge örnekleri (study)
  private studyEntries = new Map<string, StudyEntry>();
  private lastStudies: StudyRenderInput[] = [];
  private scriptMarkers: SeriesMarker<Time>[] = [];
  private studyMarkers: SeriesMarker<Time>[] = [];

  private onHoverCallback?: (data: CrosshairHoverData | null) => void;
  private onViewportChangeCallback?: () => void;
  private onLoadOlderHistoryCallback?: (oldestTime: number) => Promise<void> | void;

  constructor(
    mainContainer: HTMLElement,
    onHover?: (data: CrosshairHoverData | null) => void,
    onViewportChange?: () => void,
    onLoadOlderHistory?: (oldestTime: number) => Promise<void> | void,
    hooks: ControllerHooks = {}
  ) {
    this.mainContainer = mainContainer;
    this.onHoverCallback = onHover;
    this.onViewportChangeCallback = onViewportChange;
    this.onLoadOlderHistoryCallback = onLoadOlderHistory;
    this.hooks = hooks;

    this.mainChart = createChart(mainContainer, {
      layout: {
        background: { type: ColorType.Solid, color: '#0B0E14' },
        textColor: '#8795AA',
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, Ubuntu, sans-serif",
        fontSize: 12,
        attributionLogo: false, // atıf Hakkında penceresinde (Apache-2.0)
        panes: { enableResize: true, separatorColor: '#263144', separatorHoverColor: 'rgba(2, 132, 199, 0.35)' },
      },
      grid: {
        vertLines: { color: '#171E2C', style: 2 },
        horzLines: { color: '#171E2C', style: 2 },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: '#8C8C8C', width: 1, style: 2, labelBackgroundColor: '#0284C7' },
        horzLine: { color: '#8C8C8C', width: 1, style: 2, labelBackgroundColor: '#0284C7' },
      },
      rightPriceScale: {
        borderColor: '#303030',
        scaleMargins: MAIN_MARGINS,
      },
      leftPriceScale: {
        visible: false,
        borderColor: '#303030',
        scaleMargins: MAIN_MARGINS,
      },
      timeScale: {
        borderColor: '#303030',
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 16,
        tickMarkFormatter: (t: unknown, type: number) => tickMarkFormatter(t, type),
      },
      localization: {
        timeFormatter: (t: unknown) => (typeof t === 'number' ? formatCrosshairTime(t, undefined, this.showSeconds) : ''),
      },
    });

    this.initCoreSeries();
    this.syncVrvp();
    this.setupSynchronizationAndResize();
    this.initScriptLayers();
    const host = this.mainContainer.parentElement;
    if (host) {
      this.chrome = new PaneChrome(host, {
        onAction: (id, act, ev) => this.paneAction(id, act, ev),
        onDrop: (id, target) => this.dropPaneOn(id, target),
      });
    }
    if (typeof ResizeObserver !== 'undefined') this.paneObserver = new ResizeObserver(() => this.layoutChrome());
  }

  private initScriptLayers(): void {
    const host = this.mainContainer.parentElement;
    if (!host) return;
    this.scriptMainLayer = new ScriptLayer(host, this.layerMapper('main'), 'main');
    this.scriptSubLayer = new ScriptLayer(host, this.layerMapper('sub'), 'sub');
    this.tradeLayer = new TradeLayer(host, this.layerMapper('main'));
    this.eventLayer = new EventLayer(host, this.layerMapper('main'));
  }

  /** Faz 26: grafikte Yahoo kurumsal olay işaretleri (D: temettü, S: bölünme, E: bilanço). */
  public setCorporateEvents(
    events: import('../types/market').CorporateEventsData | null,
    currency = 'USD',
    opts?: Partial<EventLayerOptions>
  ): void {
    this.eventLayer?.setEvents(events, currency, opts);
  }

  public setEventOptions(opts: Partial<EventLayerOptions>): void {
    this.eventLayer?.setOptions(opts);
  }

  public eventOverlayCount(): number {
    return this.eventLayer?.count() ?? 0;
  }

  /** Faz 24: strateji işlem okları + bağlantı çizgileri + etiketler (null/boş = temizle). */
  public setTradeOverlay(trades: BacktestTrade[], opts: Partial<TradeLayerOptions> = {}): void {
    this.tradeLayer?.setTrades(trades, opts);
  }

  public tradeOverlayCount(): number {
    return this.tradeLayer?.count() ?? 0;
  }

  /** Faz 24: işlemin giriş-çıkış aralığını (kenar boşluğuyla) görünür yapar; veri yoksa false. */
  public focusRange(fromTime: number, toTime: number): boolean {
    if (this.rawCandles.length === 0) return false;
    const first = this.rawCandles[0].time;
    const last = this.rawCandles[this.rawCandles.length - 1].time;
    if (fromTime < first || fromTime > last) return false;
    const a = Math.max(0, this.rawCandles.findIndex((c) => c.time >= fromTime));
    let bIdx = toTime > 0 ? this.rawCandles.findIndex((c) => c.time >= toTime) : -1;
    if (bIdx === -1) bIdx = Math.min(this.rawCandles.length - 1, a + 10);
    const span = Math.max(bIdx - a, 8);
    const pad = Math.max(10, Math.round(span * 0.35));
    const fromIdx = Math.max(0, a - pad);
    const toIdx = Math.min(this.rawCandles.length - 1, bIdx + pad);
    try {
      this.mainChart.timeScale().setVisibleRange({ from: this.rawCandles[fromIdx].time as Time, to: this.rawCandles[toIdx].time as Time });
    } catch {
      return false;
    }
    this.fireViewport();
    this.scheduleViewportSync(true);
    return true;
  }

  private vpRaf = 0;

  /** Lightweight-charts Y ekseni autoScale'i sonraki animasyon karesinde uygular; katmanları ardından yeniden hizala. */
  private scheduleViewportSync(doubleFrame = false): void {
    if (typeof requestAnimationFrame === 'undefined') return;
    if (this.vpRaf) cancelAnimationFrame(this.vpRaf);
    this.vpRaf = requestAnimationFrame(() => {
      this.vpRaf = 0;
      this.fireViewport();
      if (doubleFrame) {
        this.vpRaf = requestAnimationFrame(() => {
          this.vpRaf = 0;
          this.fireViewport();
        });
      }
    });
  }

  private fireViewport(): void {
    this.scriptMainLayer?.render();
    this.scriptSubLayer?.render();
    this.tradeLayer?.render();
    this.eventLayer?.render();
    this.renderSessionBreaks();
    if (this.showHighLowLines) this.syncHighLowLines();
    for (const e of this.studyEntries.values()) e.layer?.render();
    this.layoutChrome();
    this.onViewportChangeCallback?.();
  }

  // ------------------------------------------------------------------ panes

  private activeIds(): PaneId[] {
    const fixed = (['main', 'rsi', 'macd', 'script'] as PaneId[]).filter((id) => (this.paneSeries.get(id)?.length ?? 0) > 0);
    const studies = [...this.paneSeries.keys()].filter((id) => id.startsWith('study:') && (this.paneSeries.get(id)?.length ?? 0) > 0);
    return [...fixed, ...studies];
  }

  /** Şu an çizilen pane sırası (main her zaman ilk). */
  public getPaneOrder(): PaneId[] {
    return reconcileOrder(this.paneOrderPref, this.activeIds());
  }

  public getMaximizedPane(): PaneId | null {
    return this.maximized;
  }

  private paneOf(id: PaneId) {
    for (const s of this.paneSeries.get(id) ?? []) {
      try {
        return s.getPane();
      } catch {
        // seri henüz/artık grafikte değil: sıradaki
      }
    }
    return null;
  }

  /** Fiyat ekseni genişliği; görünmeyen eksen (özellikle sol) v5'te null fırlatır → 0. */
  private axisWidth(side: 'left' | 'right'): number {
    try {
      return this.mainChart.priceScale(side).width();
    } catch {
      return 0;
    }
  }

  /** Mantıksal pane'e seri ekler; pane yoksa sona açar, sonra tercih edilen sıraya taşır. */
  private addSeriesTo<T extends SeriesType>(
    id: PaneId,
    def: SeriesDefinition<T>,
    opts: SeriesPartialOptionsMap[T] = {} as SeriesPartialOptionsMap[T]
  ): ISeriesApi<T> {
    const list = this.paneSeries.get(id) ?? [];
    const existingPane = id === 'main' ? null : this.paneOf(id);
    const paneIndex = id === 'main' ? 0 : existingPane ? existingPane.paneIndex() : this.mainChart.panes().length;
    const side: ScaleSide = id === 'main' ? (this.paneSide.get('main') === 'left' ? 'left' : 'right') : this.paneSide.get(id) ?? 'right';
    const scaleId = scaleIdFor(side, list.length);
    const o = { ...(opts as object) } as { priceScaleId?: string };
    if (o.priceScaleId === undefined) o.priceScaleId = scaleId;
    const series = this.mainChart.addSeries(def, o as SeriesPartialOptionsMap[T], paneIndex);
    list.push(series as ISeriesApi<SeriesType>);
    this.paneSeries.set(id, list);
    if (id !== 'main' && !existingPane) this.onPaneCreated(id);
    this.syncLeftScale();
    return series;
  }

  private removeSeriesFrom(id: PaneId, series: ISeriesApi<SeriesType> | null | undefined): void {
    if (!series) return;
    try {
      this.mainChart.removeSeries(series);
    } catch {
      // ignore
    }
    const list = (this.paneSeries.get(id) ?? []).filter((s) => s !== series);
    if (list.length > 0) this.paneSeries.set(id, list);
    else {
      this.paneSeries.delete(id);
      this.stretchInit.delete(id);
      this.savedStretch.delete(id);
      if (this.maximized === id) this.maximized = null;
      this.hooks.onPanesChange?.();
    }
    this.syncLeftScale();
    this.layoutChrome();
  }

  private onPaneCreated(id: PaneId): void {
    this.applyOrder();
    this.normalizeSubScales();
    const pane = this.paneOf(id);
    if (pane && !this.stretchInit.has(id)) {
      this.stretchInit.add(id);
      try {
        pane.setStretchFactor(defaultStretch(id));
        const main = this.paneOf('main');
        if (main && id !== 'main') main.setStretchFactor(defaultStretch('main'));
      } catch {
        // ignore
      }
    }
    if (this.maximized) this.setMaximized(null);
    this.hooks.onPanesChange?.();
    this.layoutChrome();
  }

  /** Mantıksal sırayı v5 pane indekslerine uygular. */
  private applyOrder(): void {
    const order = this.getPaneOrder();
    order.forEach((id, i) => {
      const p = this.paneOf(id);
      if (p && p.paneIndex() !== i) {
        try {
          p.moveTo(i);
        } catch {
          // ignore
        }
      }
    });
  }

  private commitOrder(next: PaneId[]): void {
    this.paneOrderPref = [...next, ...this.paneOrderPref.filter((x) => !next.includes(x))];
    this.applyOrder();
    this.hooks.onPanesChange?.();
    this.fireViewport();
  }

  public movePaneBy(id: PaneId, dir: -1 | 1): void {
    this.commitOrder(movePane(this.getPaneOrder(), id, dir));
  }

  private dropPaneOn(id: PaneId, target: PaneId): void {
    this.commitOrder(dropPane(this.getPaneOrder(), id, target));
  }

  /** Pane'i büyüt (diğerleri ~0) ya da `null` ile eski boyutlara dön. */
  public setMaximized(id: PaneId | null): void {
    const order = this.getPaneOrder();
    if (id && (!order.includes(id) || order.length < 2)) id = null;
    if (id === this.maximized) return;
    if (!this.maximized && id) {
      this.savedStretch.clear();
      for (const pid of order) {
        const p = this.paneOf(pid);
        if (p) this.savedStretch.set(pid, p.getStretchFactor());
      }
    }
    const target = maximizedStretch(order, id);
    for (const pid of order) {
      const p = this.paneOf(pid);
      if (!p) continue;
      const v = target ? target.get(pid) : this.savedStretch.get(pid) ?? defaultStretch(pid);
      try {
        p.setStretchFactor(v ?? 1);
      } catch {
        // ignore
      }
    }
    this.maximized = id;
    if (!id) this.savedStretch.clear();
    this.hooks.onPanesChange?.();
    this.fireViewport();
  }

  public toggleMaximize(id: PaneId): void {
    this.setMaximized(this.maximized === id ? null : id);
  }

  /** ✕: pane'in tüm serilerini kaldırır; gösterge/betik durumu hook üzerinden kapatılır. */
  public closePane(id: PaneId): void {
    if (id === 'main') return;
    this.hooks.onPaneClose?.(id);
  }

  private paneAction(id: PaneId, act: 'up' | 'down' | 'max' | 'menu' | 'close', ev: MouseEvent): void {
    if (act === 'up') this.movePaneBy(id, -1);
    else if (act === 'down') this.movePaneBy(id, 1);
    else if (act === 'max') this.toggleMaximize(id);
    else if (act === 'close') this.closePane(id);
    else this.hooks.onPaneMenu?.(id, ev.clientX, ev.clientY);
  }

  public setPaneLabel(id: PaneId, text: string): void {
    if (this.paneLabels.get(id) === text) return;
    this.paneLabels.set(id, text);
    this.layoutChrome();
  }

  private defaultLabel(id: PaneId): string {
    const t = this.paneLabels.get(id);
    if (t) return t;
    return id === 'rsi' ? 'RSI (14, close)' : id === 'macd' ? 'MACD (12, 26, 9)' : id === 'script' ? this.lastScript?.scriptTitle ?? LANG_NAME : '';
  }

  /** Pane başlıklarını pane DOM kutularına göre konumlandırır. */
  private layoutChrome(): void {
    const chrome = this.chrome;
    const host = this.mainContainer.parentElement;
    if (!chrome || !host) return;
    const order = this.getPaneOrder();
    const boxes = order.flatMap((id, i) => {
      const pane = this.paneOf(id);
      const el = pane?.getHTMLElement();
      if (!pane || !el) return [];
      if (this.paneObserver && !this.observed.has(el)) {
        this.observed.add(el);
        this.paneObserver.observe(el);
      }
      // Faz 30: DOM ölçümü yerine LWC düzeni (her kaydırma karesinde reflow yok)
      const g = this.paneGeometry(id);
      return [
        {
          id,
          label: this.defaultLabel(id),
          top: g.top,
          height: g.height,
          maximized: this.maximized === id,
          canUp: id !== 'main' && i > 1,
          canDown: id !== 'main' && i < order.length - 1,
          showMax: order.length > 1,
          ...(id.startsWith('study:') ? { values: this.studyPaneValues(id) } : {}),
        },
      ];
    });
    chrome.update(boxes, this.axisWidth('left'), this.axisWidth('right'));
  }

  // ------------------------------------------------------------------ ölçek tarafları

  private mainScaleId(): 'right' | 'left' {
    return this.paneSide.get('main') === 'left' ? 'left' : 'right';
  }

  private syncLeftScale(): void {
    let left = this.compareSeries !== null && this.compareScale === 'left';
    for (const s of this.extraCompareSeries) {
      if (s.options().priceScaleId === 'left') left = true;
    }
    for (const [id, list] of this.paneSeries) {
      for (const s of list) if (s.options().priceScaleId === 'left') left = true;
      void id;
    }
    this.mainChart.applyOptions({ leftPriceScale: { visible: left } });
  }

  /** Bir pane'in ölçek tarafı: sağ / sol / split (ilk seri sağ, kalanlar sol). */
  public setPaneScaleSide(id: PaneId, side: ScaleSide): void {
    this.paneSide.set(id, id === 'main' && side === 'split' ? 'right' : side);
    const effective = this.paneSide.get(id)!;
    (this.paneSeries.get(id) ?? []).forEach((s, i) => {
      // "ölçeksiz" gösterge serisi kendi gizli ölçeğinde kalır
      if (!String(s.options().priceScaleId ?? '').startsWith('study-')) s.applyOptions({ priceScaleId: scaleIdFor(effective, i) });
    });
    if (id === 'main') this.applyScaleMode();
    this.syncLeftScale();
    this.fireViewport();
  }

  public getPaneScaleSide(id: PaneId): ScaleSide {
    return this.paneSide.get(id) ?? 'right';
  }

  public setCompareScale(mode: CompareScale): void {
    this.compareScale = mode;
    this.compareSeries?.applyOptions({ priceScaleId: compareScaleId(mode) });
    if (mode === 'own') this.mainChart.priceScale('cmp-own').applyOptions({ scaleMargins: MAIN_MARGINS });
    this.syncLeftScale();
    this.fireViewport();
  }

  public getCompareScale(): CompareScale {
    return this.compareScale;
  }

  // ------------------------------------------------------------------ ölçek kilidi

  /** Fiyat/bar oranını kilitler: zaman ekseni yakınlaşınca fiyat aralığı orantılı değişir. */
  public setScaleLocked(on: boolean): void {
    this.scaleLocked = on;
    const ps = this.mainChart.priceScale(this.mainScaleId());
    if (on) {
      const r = ps.getVisibleRange();
      const b = this.currentBarSpacing();
      if (r && b > 0 && r.to > r.from) {
        this.lockRatio = { b0: b, span0: r.to - r.from };
        ps.setAutoScale(false);
      } else {
        this.lockRatio = null;
      }
    } else {
      this.lockRatio = null;
      ps.setAutoScale(true);
    }
  }

  public isScaleLocked(): boolean {
    return this.scaleLocked;
  }

  /** px / bar: görünür mantıksal aralıktan türetilir (options().barSpacing yakınlaştırmada güncellenmez). */
  private currentBarSpacing(): number {
    const ts = this.mainChart.timeScale();
    const r = ts.getVisibleLogicalRange();
    const w = ts.width();
    return r && r.to > r.from && w > 0 ? w / (r.to - r.from) : 0;
  }

  private enforceScaleLock(): void {
    if (!this.scaleLocked || !this.lockRatio) return;
    const ps = this.mainChart.priceScale(this.mainScaleId());
    const cur = ps.getVisibleRange();
    if (!cur) return;
    const next = lockedPriceRange(this.lockRatio, this.currentBarSpacing(), (cur.from + cur.to) / 2);
    if (next) ps.setVisibleRange(next);
  }

  /** Test/kanıt: kilit oranı. */
  public getLockRatio(): { b0: number; span0: number } | null {
    return this.lockRatio;
  }

  // ------------------------------------------------------------------ eksen eşleme

  /** Zaman ekseni çubukları: türetilmiş stilde tuğlalar, aksi halde ham mumlar. */
  private axisBars(): Candle[] {
    return isDerivedStyle(this.styleMode) ? this.derivedBars : this.rawCandles;
  }

  /** Kaynak-zamanlı seri noktalarını (gösterge/betik) çizilen eksene hizalar; normal stilde olduğu gibi döner. */
  private align<T extends { time: number }>(pts: T[]): T[] {
    return isDerivedStyle(this.styleMode) ? alignToBars(pts, this.derivedBars.map((b) => b.time)) : pts;
  }

  /** İşaretçiler aynı tuğlaya düşebilir (LWC tolere eder); yalnızca zamanı hizalar, sırayı korur. */
  private alignMarkers<T extends { time: number }>(ms: T[]): T[] {
    if (!isDerivedStyle(this.styleMode)) return ms;
    const bt = this.derivedBars.map((b) => b.time);
    return ms.flatMap((m) => {
      const i = barIndexAtOrBefore(bt, m.time);
      return i < 0 ? [] : [{ ...m, time: bt[i] }];
    });
  }

  /** Mantıksal bar indeksi; veri dışındaki zamanlar son/ilk bar aralığıyla ekstrapole edilir. */
  public timeToLogical(t: number): number | null {
    const c = this.axisBars();
    const n = c.length;
    if (n === 0) return null;
    if (isDerivedStyle(this.styleMode)) {
      // türetilmiş eksende zaman -> önceki tuğlanın indeksi (Betik değerleri tuğlaya oturur)
      const i = barIndexAtOrBefore(c.map((b) => b.time), t);
      if (i < 0) return t < c[0].time ? 0 : null;
      return i === n - 1 && t > c[n - 1].time ? n - 1 + (t - c[n - 1].time) / (n >= 2 ? c[n - 1].time - c[n - 2].time || 60 : 60) : i;
    }
    const dt = n >= 2 ? c[n - 1].time - c[n - 2].time || 60 : 60;
    if (t >= c[n - 1].time) return n - 1 + (t - c[n - 1].time) / dt;
    if (t <= c[0].time) return (t - c[0].time) / (n >= 2 ? c[1].time - c[0].time || 60 : 60);
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (c[mid].time <= t) lo = mid;
      else hi = mid;
    }
    if (c[lo].time === t) return lo;
    return lo + (t - c[lo].time) / (c[hi].time - c[lo].time);
  }

  private layerMapper(pane: 'main' | 'sub'): LayerMapper {
    return this.layerMapperFor(pane === 'main' ? 'main' : 'script', () => (pane === 'main' ? this.candleSeries : this.scriptSubSeries[0]));
  }

  /** Herhangi bir pane için Betik görsel katmanı eşleyicisi; fiyat→y dönüşümü `host` serisinin ölçeğiyle. */
  /** Sol eksen + pane + (sağ eksen varsa 1 px kenarlık) = container genişliği − sağ eksen, DOM okumadan. */
  private paneDrawWidth(): number {
    return this.mainChart.paneSize(0).width + this.axisWidth('left') + (this.axisWidth('right') > 0 ? 1 : 0);
  }

  /** Pane'in üst kenarı ve yüksekliği (ana tablo içinde, px) — DOM ölçmeden. */
  private paneGeometry(id: PaneId): { top: number; height: number } {
    const api = this.paneOf(id);
    if (!api) return { top: 0, height: 0 };
    const idx = api.paneIndex();
    const panes = this.mainChart.panes();
    let top = 0;
    for (let i = 0; i < idx && i < panes.length; i++) top += panes[i].getHeight() + PANE_SEPARATOR_PX;
    return { top, height: api.getHeight() };
  }

  /** Test/kanıt: LWC'den hesaplanan geometri ile DOM ölçümü (Faz 30 doğrulaması). */
  public debugPaneGeometry(): Array<{ id: string; api: { top: number; height: number }; dom: { top: number; height: number }; width: { api: number; dom: number } }> {
    const host = this.mainContainer.parentElement;
    return this.getPaneOrder().map((id) => {
      const el = this.paneOf(id)?.getHTMLElement();
      const dom = el && host ? { top: el.getBoundingClientRect().top - host.getBoundingClientRect().top, height: el.getBoundingClientRect().height } : { top: -1, height: -1 };
      return {
        id,
        api: this.paneGeometry(id),
        dom,
        width: { api: this.paneDrawWidth(), dom: this.mainContainer.clientWidth - this.axisWidth('right') },
      };
    });
  }

  private layerMapperFor(id: PaneId, host: () => ISeriesApi<SeriesType> | undefined): LayerMapper {
    const pane: 'main' | 'sub' = id === 'main' ? 'main' : 'sub';
    const chart = () => this.mainChart;
    const container = () => this.mainContainer;
    // Faz 30: pane geometrisi DOM ölçümü (getBoundingClientRect → zorunlu reflow) yerine
    // lightweight-charts düzeninden: üstteki panelerin yükseklikleri + 1 px ayraç. Her kaydırma karesinde
    // katman başına reflow 100k barda kare takılmalarının ana nedeniydi.
    const paneEl = (): { top: number; height: number } => this.paneGeometry(id);
    return {
      timeToLogical: (t) => this.timeToLogical(t),
      logicalToX: (l) => {
        const x = chart().timeScale().logicalToCoordinate(l as never);
        return x === null ? null : Number(x);
      },
      priceToY: (p) => {
        const h = host();
        if (!h) return null;
        const y = h.priceToCoordinate(p);
        return y === null ? null : Number(y);
      },
      barSpacing: () => {
        const b = this.currentBarSpacing();
        return b > 0 ? b : chart().timeScale().options().barSpacing;
      },
      barRange: (t) => {
        const c = this.axisBars();
        let lo = 0;
        let hi = c.length - 1;
        while (lo <= hi) {
          const mid = (lo + hi) >> 1;
          if (c[mid].time === t) return { high: c[mid].high, low: c[mid].low };
          if (c[mid].time < t) lo = mid + 1;
          else hi = mid - 1;
        }
        return null;
      },
      size: () => {
        const h = pane === 'main' ? this.mainChart.paneSize(0).height : paneEl().height;
        return {
          // container.clientWidth - sağ eksen = sol eksen + pane genişliği (DOM okumadan)
          width: Math.max(0, this.paneDrawWidth()),
          height: Math.max(0, h),
        };
      },
      top: () => (pane === 'main' ? 0 : paneEl().top),
      clipLeft: () => this.axisWidth('left'),
    };
  }

  private initCoreSeries(): void {
    const reg = <T extends SeriesType>(s: ISeriesApi<T>): ISeriesApi<T> => {
      const list = this.paneSeries.get('main') ?? [];
      list.push(s as ISeriesApi<SeriesType>);
      this.paneSeries.set('main', list);
      return s;
    };
    this.candleSeries = reg(
      this.mainChart.addSeries(CandlestickSeries, {
        upColor: '#089981',
        downColor: '#F23645',
        borderUpColor: '#089981',
        borderDownColor: '#F23645',
        wickUpColor: '#089981',
        wickDownColor: '#F23645',
      })
    );
    this.markersApi = createSeriesMarkers(this.candleSeries, []);

    this.barSeries = reg(this.mainChart.addSeries(BarSeries, { upColor: '#089981', downColor: '#F23645', visible: false }));

    this.lineSeries = reg(this.mainChart.addSeries(LineSeries, { color: '#0284C7', lineWidth: 2, visible: false }));

    this.areaSeries = reg(
      this.mainChart.addSeries(AreaSeries, {
        lineColor: '#0284C7',
        topColor: 'rgba(2, 132, 199, 0.32)',
        bottomColor: 'rgba(2, 132, 199, 0.02)',
        lineWidth: 2,
        visible: false,
      })
    );

    this.baselineSeries = reg(
      this.mainChart.addSeries(BaselineSeries, {
        baseValue: { type: 'price', price: 100 },
        topLineColor: '#089981',
        topFillColor1: 'rgba(8, 153, 129, 0.28)',
        topFillColor2: 'rgba(8, 153, 129, 0.04)',
        bottomLineColor: '#F23645',
        bottomFillColor1: 'rgba(242, 54, 69, 0.04)',
        bottomFillColor2: 'rgba(242, 54, 69, 0.28)',
        lineWidth: 2,
        visible: false,
      })
    );

    this.volumeSeries = this.mainChart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: '',
    });
    this.volumeSeries.priceScale().applyOptions({
      scaleMargins: { top: 0.82, bottom: 0 },
    });
  }

  private setupSynchronizationAndResize(): void {
    this.mainChart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
      if (range) {
        this.enforceScaleLock();
        if (
          range.from < 25 &&
          this.rawCandles.length > 0 &&
          !this.settling &&
          !this.isLoadingOlder &&
          this.onLoadOlderHistoryCallback
        ) {
          this.isLoadingOlder = true;
          const oldestTime = this.rawCandles[0].time;
          Promise.resolve(this.onLoadOlderHistoryCallback(oldestTime))
            .catch(() => {})
            .finally(() => {
              this.isLoadingOlder = false;
            });
        }
        if (!this.extRange && !this.settling && this.hooks.onVisibleTimeRange) {
          this.hooks.onVisibleTimeRange(this.getVisibleTimeRange());
        }
      }
      this.fireViewport();
      this.scheduleViewportSync();
    });

    this.mainChart.subscribeCrosshairMove((param) => {
      this.hoverTime = param.time ? Number(param.time) : null;
      this.fireViewport();
      if (!this.extCrosshair) {
        this.hooks.onCrosshairTime?.(this.hoverTime);
      }
      if (!param.time || this.rawCandles.length === 0) {
        this.onHoverCallback?.(null);
        return;
      }
      const ts = Number(param.time);
      // Faz 30: 100k barda her imleç hareketinde doğrusal arama yerine ikili arama
      const rc = this.rawCandles;
      const bi = barIndexAtOrBefore(this.rawTimes(), ts);
      const found = bi >= 0 && rc[bi]?.time === ts ? rc[bi] : undefined;
      if (found) {
        const changePct =
          found.open > 0 ? ((found.close - found.open) / found.open) * 100 : 0;
        this.onHoverCallback?.({
          ...found,
          changePct,
        });
      }
    });

    this.mainChart.subscribeClick?.((param) => {
      if (param?.time && this.hooks.onTimeClick) {
        const ts = Number(param.time);
        if (Number.isFinite(ts) && ts > 0) this.hooks.onTimeClick(ts);
      }
    });

    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => {
        this.resize();
      });
      ro.observe(this.mainContainer);
    }
  }

  /** Faz 25: saniyelik aralıklarda zaman ekseninde ve imleç etiketinde saniyeleri (HH:MM:SS) açar. */
  public setIntervalDisplay(tf: string): void {
    const sec = isSecondsInterval(tf);
    if (this.showSeconds === sec) return;
    this.showSeconds = sec;
    this.mainChart.applyOptions({
      timeScale: { secondsVisible: sec },
      localization: {
        timeFormatter: (t: unknown) => (typeof t === 'number' ? formatCrosshairTime(t, undefined, sec) : ''),
      },
    });
  }

  /** Faz 25: görünür ana seriyi döndürür (dış imleç eşitlemesi için). */
  private visiblePrimarySeries(): ISeriesApi<SeriesType> {
    const all: ISeriesApi<SeriesType>[] = [this.candleSeries, this.barSeries, this.lineSeries, this.areaSeries, this.baselineSeries];
    if (this.customSeries) all.unshift(this.customSeries as unknown as ISeriesApi<SeriesType>);
    return all.find((x) => x && x.options().visible) ?? this.candleSeries;
  }

  /** Faz 25: başka grafikten/sekmeden gelen imleç zamanını bu grafiğe yansıtır (döngü korumalı). */
  public setExternalCrosshair(timeSec: number | null): void {
    this.extCrosshair = true;
    try {
      if (timeSec === null || this.rawCandles.length === 0) {
        this.mainChart.clearCrosshairPosition?.();
        return;
      }
      const idx = this.findBarIndexAtOrBefore(timeSec);
      if (idx < 0) {
        this.mainChart.clearCrosshairPosition?.();
        return;
      }
      const bar = this.rawCandles[idx];
      this.mainChart.setCrosshairPosition?.(bar.close, bar.time as Time, this.visiblePrimarySeries());
    } catch {
      // ignore if chart unmounted
    } finally {
      this.extCrosshair = false;
    }
  }

  /** Faz 25: zaman eşitlemesi — bu grafiğin yakınlaştırmasını koruyarak verilen zaman damgasını ortalar. */
  public alignToTime(timeSec: number): boolean {
    if (this.rawCandles.length === 0) return false;
    const idx = this.findBarIndexAtOrBefore(timeSec);
    if (idx < 0) return false;
    const cur = this.mainChart.timeScale().getVisibleLogicalRange();
    const span = cur && Number.isFinite(cur.to - cur.from) && cur.to - cur.from > 4 ? cur.to - cur.from : 120;
    this.extRange = true;
    try {
      this.mainChart.timeScale().setVisibleLogicalRange({ from: idx - span / 2, to: idx + span / 2 });
    } catch {
      this.extRange = false;
      return false;
    }
    this.fireViewport();
    this.scheduleViewportSync();
    queueMicrotask(() => {
      this.extRange = false;
    });
    return true;
  }

  /** Faz 25: görünür [from, to] UTC saniye aralığını döndürür. */
  public getVisibleTimeRange(): { from: number; to: number } | null {
    if (this.rawCandles.length === 0) return null;
    try {
      const vr = this.mainChart.timeScale().getVisibleRange?.();
      if (vr && typeof vr.from === 'number' && typeof vr.to === 'number' && vr.to > vr.from) {
        return { from: vr.from, to: vr.to };
      }
    } catch {
      // fallback to logical range
    }
    const lr = this.mainChart.timeScale().getVisibleLogicalRange();
    if (!lr) return null;
    const a = Math.max(0, Math.min(this.rawCandles.length - 1, Math.floor(lr.from)));
    const b = Math.max(0, Math.min(this.rawCandles.length - 1, Math.ceil(lr.to)));
    if (b <= a) return null;
    return { from: this.rawCandles[a].time, to: this.rawCandles[b].time };
  }

  /** Faz 25: tarih aralığı eşitlemesi — verilen [from, to] zaman aralığını bu grafiğe uygular (döngü korumalı). */
  public setVisibleTimeRange(from: number, to: number): boolean {
    if (this.rawCandles.length < 2 || to <= from) return false;
    const first = this.rawCandles[0].time;
    const last = this.rawCandles[this.rawCandles.length - 1].time;
    const f = Math.max(first, Math.min(last, from));
    const t = Math.max(first, Math.min(last, to));
    if (t <= f) return false;
    this.extRange = true;
    try {
      this.mainChart.timeScale().setVisibleRange({ from: f as Time, to: t as Time });
    } catch {
      this.extRange = false;
      return false;
    }
    this.fireViewport();
    this.scheduleViewportSync();
    queueMicrotask(() => {
      this.extRange = false;
    });
    return true;
  }

  private findBarIndexAtOrBefore(timeSec: number): number {
    const arr = this.rawCandles;
    if (arr.length === 0) return -1;
    if (timeSec <= arr[0].time) return 0;
    if (timeSec >= arr[arr.length - 1].time) return arr.length - 1;
    let lo = 0;
    let hi = arr.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (arr[mid].time === timeSec) return mid;
      if (arr[mid].time < timeSec) lo = mid + 1;
      else hi = mid - 1;
    }
    return Math.max(0, hi);
  }

  public resize(): void {
    if (this.mainContainer.clientWidth > 0 && this.mainContainer.clientHeight > 0) {
      this.mainChart.applyOptions({
        width: this.mainContainer.clientWidth,
        height: this.mainContainer.clientHeight,
      });
    }
    if (this.focusPending && this.mainContainer.clientWidth > 0) {
      this.focusPending = false;
      this.showRecentBars();
    }
    this.fireViewport();
  }

  public setHistoryData(candles: Candle[]): void {
    this.rawCandles = [...candles].sort((a, b) => a.time - b.time);
    // Varsayılan: Renko/Range/Kagi/P&F kutu boyutu veri yüklenirken sabitlenir; canlı tick'ler kaydırmaz
    this.derivedBasis = this.rawCandles.slice();
    this.renderPrimaryPriceAndVolume();
    this.renderQuickIndicators();
    this.showRecentBars();
    this.settling = true;
    this.focusAfterScript = true;
    if (this.settleTimer !== undefined) clearTimeout(this.settleTimer);
    this.settleTimer = setTimeout(() => {
      this.settling = false;
      this.settleTimer = undefined;
    }, 600);
    // Kapsayıcı henüz ölçülmemişse (ilk açılış) aralık yanlış genişlikte hesaplanır; ölçülünce yeniden uygula
    this.focusPending = true;
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => {
        if (this.focusPending && this.mainContainer.clientWidth > 0) {
          this.focusPending = false;
          this.showRecentBars();
        }
      });
    }
  }

  /** Son muma odaklan (son ~160 bar + sağ boşluk). */
  public focusLast(): void {
    this.showRecentBars();
  }

  /**
   * İlk görünüm: son ~160 bar + sağda boşluk (Betik projeksiyonu / gelecek bar çizimleri için yer).
   * fitContent() tüm geçmişi sığdırıp mumları iğne inceliğine indiriyordu ve sağ boşluğu yok sayıyordu.
   */
  private showRecentBars(): void {
    const n = this.axisBars().length;
    if (n === 0) return;
    // Footprint: hücreler okunabilsin diye ~110 px/bar; diğer tiplerde son ~160 bar
    const fp = this.styleMode === 'footprint';
    const bars = fp ? Math.max(6, Math.floor((this.mainContainer.clientWidth || 1100) / 110)) : 160;
    const future = fp ? 2 : 18;
    this.mainChart.timeScale().setVisibleLogicalRange({ from: Math.max(-2, n - 1 - bars), to: n - 1 + future });
  }

  public prependHistoryData(olderCandles: Candle[]): void {
    if (!olderCandles || olderCandles.length === 0) return;
    const existingTimes = new Set(this.rawCandles.map((c) => c.time));
    const newItems = olderCandles.filter((c) => !existingTimes.has(c.time));
    if (newItems.length === 0) return;
    // Eski veri başa eklenince mantıksal indeksler kayar; görünüm kaymasın (grafik "kaçıp kaybolmasın")
    const ts = this.mainChart.timeScale();
    const before = ts.getVisibleLogicalRange();
    const nBefore = this.axisBars().length;
    this.rawCandles = [...newItems, ...this.rawCandles].sort((a, b) => a.time - b.time);
    this.renderPrimaryPriceAndVolume();
    this.renderQuickIndicators();
    const shift = this.axisBars().length - nBefore;
    if (before && shift > 0) {
      const want = { from: before.from + shift, to: before.to + shift };
      const now = ts.getVisibleLogicalRange();
      // Kütüphane aralığı zaten kaydırdıysa tekrar kaydırma (çift kayma = son mum sağa kaçar)
      if (!now || Math.abs(now.from - want.from) > 0.5) ts.setVisibleLogicalRange(want);
    }
  }

  public setOnLoadOlderHistory(cb?: (oldestTime: number) => Promise<void> | void): void {
    this.onLoadOlderHistoryCallback = cb;
  }

  public updateLiveCandle(incoming: Candle): void {
    const n = this.rawCandles.length;
    if (n === 0) {
      this.setHistoryData([incoming]);
      return;
    }

    const last = this.rawCandles[n - 1];
    if (incoming.time < last.time) {
      return;
    }
    const newBar = incoming.time !== last.time;
    if (!newBar) {
      this.rawCandles[n - 1] = incoming;
    } else {
      this.rawCandles.push(incoming);
    }

    if (isDerivedStyle(this.styleMode)) {
      // Faz 30: önek tuğlalar değişmediyse yalnız son tuğla(lar) güncellenir (tick → ekran < 16 ms);
      // göstergeler tuğla ekseninde ~4/sn yeniden hizalanır. Önek değiştiyse (ör. ATR kutusu) tam yeniden kurulum.
      if (this.tryIncrementalDerived(newBar)) return;
      this.renderPrimaryPriceAndVolume();
      this.renderQuickIndicators(); // kaynak-zamanlı artımlı güncelleme tuğla ekseninde geçersiz; yeniden hizala
      return;
    }

    const displayCandle =
      this.styleMode === 'heikin'
        ? toHeikinAshi(this.rawCandles)[this.rawCandles.length - 1]
        : incoming;

    const t = displayCandle.time as Time;
    const bc = this.barColors.get(displayCandle.time);
    this.candleSeries.update({
      time: t,
      open: displayCandle.open,
      high: displayCandle.high,
      low: displayCandle.low,
      close: displayCandle.close,
      ...(bc ? { color: bc, borderColor: bc, wickColor: bc } : {}),
    });
    const m = this.styleMode;
    if (m === 'bar') {
      this.barSeries.update({
        time: t,
        open: displayCandle.open,
        high: displayCandle.high,
        low: displayCandle.low,
        close: displayCandle.close,
      });
    } else if (m === 'line' || m === 'stepline' || m === 'linemarkers') {
      this.lineSeries.update({ time: t, value: displayCandle.close });
    } else if (m === 'area') {
      this.areaSeries.update({ time: t, value: displayCandle.close });
    } else if (m === 'baseline') {
      this.baselineSeries.update({ time: t, value: displayCandle.close });
    }
    if (this.customSeries) {
      const n2 = this.rawCandles.length;
      this.customSeries.update(this.toCustomPoint(displayCandle, n2 >= 2 ? this.rawCandles[n2 - 2].close : undefined));
    }
    if (this.isGhostStyle(m)) this.syncLastPriceLine();
    this.profileLayer?.update();
    this.vrvp?.update();
    this.volumeSeries.update({
      time: t,
      value: incoming.volume,
      color:
        incoming.close >= incoming.open
          ? 'rgba(8, 153, 129, 0.5)'
          : 'rgba(242, 54, 69, 0.5)',
    });

    this.scheduleLiveIndicators(incoming, newBar);
  }

  private derivedIndTimer: ReturnType<typeof setTimeout> | undefined;

  /** Türetilmiş stilde artımlı güncelleme; mümkün değilse false (çağıran tam kurulum yapar). */
  private tryIncrementalDerived(newBar: boolean): boolean {
    const prev = this.derivedBars;
    if (prev.length === 0) return false;
    const next = deriveCandles(this.styleMode as DerivedStyle, this.rawCandles, this.styleParams, this.derivedBasisCandles()) as DerivedBar[];
    if (next.length < prev.length) return false;
    const same = (a: DerivedBar, b: DerivedBar) =>
      a.time === b.time && a.open === b.open && a.high === b.high && a.low === b.low && a.close === b.close && a.volume === b.volume;
    // Son kaynak mum birden çok tuğla doğurabilir: değişen ilk tuğla son 32 içindeyse yerinde güncellenir
    // (LWC v5 `update(bar, historicalUpdate)`), daha geriden değişiklik → tam yeniden kurulum.
    let k = 0;
    while (k < prev.length && same(prev[k], next[k])) k++;
    if (k < prev.length - 32) return false;
    this.derivedBars = next;
    const ghost = this.isGhostStyle(this.styleMode);
    const m = this.styleMode;
    const isLine = m === 'line' || m === 'stepline' || m === 'linemarkers';
    for (let i = k; i < next.length; i++) {
      const c = next[i];
      if (i < prev.length && same(prev[i], c)) continue;
      const hist = i < prev.length - 1;
      const t = c.time as Time;
      const col = ghost ? undefined : this.barColors.get(c.time);
      const o = { time: t, open: c.open, high: c.high, low: c.low, close: c.close };
      this.candleSeries.update(col ? { ...o, color: col, borderColor: col, wickColor: col } : o, hist);
      if (m === 'bar') this.barSeries.update(o, hist);
      else if (isLine) this.lineSeries.update({ time: t, value: c.close }, hist);
      else if (m === 'area') this.areaSeries.update({ time: t, value: c.close }, hist);
      else if (m === 'baseline') this.baselineSeries.update({ time: t, value: c.close }, hist);
      if (this.customSeries) this.customSeries.update(this.toCustomPoint(c, i > 0 ? next[i - 1].close : undefined), hist);
      this.volumeSeries.update({ time: t, value: c.volume, color: c.close >= c.open ? 'rgba(8, 153, 129, 0.5)' : 'rgba(242, 54, 69, 0.5)' }, hist);
    }
    this.syncLastPriceLine();
    this.profileLayer?.update();
    this.vrvp?.update();
    // Göstergeler tuğla ekseninde yalnız yeni tuğla oluşunca ve çizimden sonra yeniden hizalanır
    // (her tick'te tüm geçmişi yeniden hesaplamak 100k barda ~1 sn takılma yapıyordu).
    if (next.length > prev.length && this.derivedIndTimer === undefined) {
      this.derivedIndTimer = setTimeout(() => {
        this.derivedIndTimer = undefined;
        this.renderQuickIndicators();
      }, LIVE_IND_MIN_MS);
    }
    void newBar;
    return true;
  }

  /** Göstergeler yeni barda hemen, aynı bar güncellemelerinde en fazla ~4/sn hesaplanır (tick fırtınası). */
  private scheduleLiveIndicators(incoming: Candle, immediate: boolean): void {
    const now = Date.now();
    if (immediate || now - this.lastIndAt >= LIVE_IND_MIN_MS) {
      if (this.indTimer !== undefined) {
        clearTimeout(this.indTimer);
        this.indTimer = undefined;
      }
      this.lastIndAt = now;
      this.updateLiveIndicators(incoming);
      return;
    }
    this.pendingInd = incoming;
    if (this.indTimer === undefined) {
      this.indTimer = setTimeout(() => {
        this.indTimer = undefined;
        this.lastIndAt = Date.now();
        const c = this.pendingInd;
        this.pendingInd = undefined;
        if (c) this.updateLiveIndicators(c);
      }, LIVE_IND_MIN_MS - (now - this.lastIndAt));
    }
  }

  public updateLiveIndicators(incoming: Candle): void {
    const f = this.quickFlags;
    const overlayOn = ['ema9', 'ema21', 'ema55', 'sma200', 'vwap', 'bb', 'supertrend', 'ichimoku', 'psar'].some((k) => (f as unknown as Record<string, boolean>)[k]);
    // Seri henüz kurulmamışsa bir kez kur. (Eskiden yalnız RSI/MACD açıkken quickSeriesMap boş kaldığı için
    // her tick'te tüm göstergeler baştan hesaplanıyordu — 100k barda tick başına ~1,5 sn.)
    if ((overlayOn && this.quickSeriesMap.size === 0) || (f.rsi && !this.rsiSeries) || (f.macd && !this.macdLineSeries)) {
      this.renderQuickIndicators();
      return;
    }

    const t = incoming.time as Time;
    const n = this.rawCandles.length;
    // Faz 30: RSI / MACD son değeri kuyruk penceresiyle (RMA/EMA sönümü: 600 barda (13/14)^600 ≈ e^-44,
    // 1000 barda (25/27)^1000 ≈ e^-77 — tam hesapla çift duyarlıkta aynı).
    const tailCloses = (w: number): number[] => {
      const k = Math.min(n, w);
      const out = new Array<number>(k);
      for (let i = 0; i < k; i++) out[i] = this.rawCandles[n - k + i].close;
      return out;
    };
    if (f.rsi && this.rsiSeries && !isDerivedStyle(this.styleMode)) {
      const r = calcRSI(tailCloses(600), 14);
      const v = r[r.length - 1];
      if (Number.isFinite(v)) {
        this.rsiSeries.update({ time: t, value: v });
        this.setPaneLabel('rsi', `RSI (14, close): ${v.toFixed(2)}`);
      }
    }
    if (f.macd && this.macdLineSeries && this.macdSignalSeries && this.macdHistSeries && !isDerivedStyle(this.styleMode)) {
      const m = calcMACD(tailCloses(1000), 12, 26, 9);
      const L = m.macdLine.length - 1;
      const ml = m.macdLine[L];
      const sl = m.signalLine[L];
      const hl = m.histLine[L];
      if (Number.isFinite(ml)) this.macdLineSeries.update({ time: t, value: ml });
      if (Number.isFinite(sl)) this.macdSignalSeries.update({ time: t, value: sl });
      if (Number.isFinite(hl)) this.macdHistSeries.update({ time: t, value: hl, color: hl >= 0 ? 'rgba(8, 153, 129, 0.75)' : 'rgba(242, 54, 69, 0.75)' });
      if (Number.isFinite(ml) && Number.isFinite(sl)) this.setPaneLabel('macd', `MACD (12, 26, 9): ${ml.toFixed(2)} | ${tt('Sinyal')}: ${sl.toFixed(2)}`);
    }
    if (!overlayOn) return;
    // EMA yalnız kuyruk penceresiyle: eski değerlerin etkisi (1-α)^k ile sönümlenir (10×periyot ≈ 1e-6 hata)
    const emaLast = (period: number): number => {
      const w = Math.min(n, period * 10);
      const tail = new Array<number>(w);
      for (let i = 0; i < w; i++) tail[i] = this.rawCandles[n - w + i].close;
      return calcEMA(tail, period)[w - 1];
    };

    const updateSeries = (key: string, val: number) => {
      const s = this.quickSeriesMap.get(key);
      if (s && !Number.isNaN(val) && Number.isFinite(val)) {
        s.update({ time: t, value: val });
      }
    };

    if (this.quickFlags.ema9) {
      updateSeries('ema9', emaLast(9));
    }
    if (this.quickFlags.ema21) {
      updateSeries('ema21', emaLast(21));
    }
    if (this.quickFlags.ema55) {
      updateSeries('ema55', emaLast(55));
    }
    if (this.quickFlags.sma200) {
      updateSeries('sma200', calcLatestSMA(this.rawCandles, Math.min(200, n)));
    }
    if (this.quickFlags.vwap) {
      updateSeries('vwap', calcLatestVWAP(this.rawCandles));
    }
    if (this.quickFlags.bb) {
      const bb = calcLatestBollinger(this.rawCandles, 20, 2.0);
      updateSeries('bb_upper', bb.upper);
      updateSeries('bb_mid', bb.middle);
      updateSeries('bb_lower', bb.lower);
    }
    if (this.quickFlags.supertrend) {
      const st = calcLatestSuperTrend(this.rawCandles, 3.0, 10);
      updateSeries('supertrend', st.supertrend);
    }
    if (this.quickFlags.ichimoku) {
      const ichi = calcIchimoku(this.rawCandles);
      updateSeries('ichi_tenkan', ichi.tenkan[n - 1]);
      updateSeries('ichi_kijun', ichi.kijun[n - 1]);
      updateSeries('ichi_spanA', ichi.spanA[n - 1]);
      updateSeries('ichi_spanB', ichi.spanB[n - 1]);
    }
    if (this.quickFlags.psar) {
      const sar = calcParabolicSAR(this.rawCandles);
      updateSeries('psar', sar[n - 1]);
    }
  }

  public setChartStyleMode(mode: ChartStyleMode): void {
    const prevMode = this.styleMode;
    this.styleMode = mode;
    const custom = isCustomStyle(mode) ? mode : null;
    const ghost = this.isGhostStyle(mode);
    const isCandleLike =
      mode === 'candles' || mode === 'hollow' || mode === 'heikin' || mode === 'svp' || ghost || (isDerivedStyle(mode) && !custom);
    const T = 'rgba(0, 0, 0, 0)';
    this.candleSeries.applyOptions({
      visible: isCandleLike,
      upColor: ghost || mode === 'hollow' ? T : '#089981',
      downColor: ghost ? T : '#F23645',
      borderUpColor: ghost ? T : '#089981',
      borderDownColor: ghost ? T : '#F23645',
      wickUpColor: ghost ? T : '#089981',
      wickDownColor: ghost ? T : '#F23645',
      lastValueVisible: !ghost,
      priceLineVisible: !ghost,
    });
    this.barSeries.applyOptions({ visible: mode === 'bar' });
    this.lineSeries.applyOptions({
      visible: mode === 'line' || mode === 'stepline' || mode === 'linemarkers',
      lineType: mode === 'stepline' ? LineType.WithSteps : LineType.Simple,
      pointMarkersVisible: mode === 'linemarkers',
    });
    this.areaSeries.applyOptions({ visible: mode === 'area' });
    this.baselineSeries.applyOptions({ visible: mode === 'baseline' });
    this.syncCustomSeries(custom);
    this.syncProfileLayer(mode);
    this.syncFootprintSpacing(mode, prevMode);
    this.syncAlertLines();
    this.renderPrimaryPriceAndVolume();
    // Renko/Range/Line Break <-> normal geçişinde göstergeler ve TitanScript yeni eksene yeniden hizalanır
    this.renderQuickIndicators();
    if (this.lastScript) this.renderScriptExecution(this.lastScript);
    if (this.lastStudies.length) this.renderStudies(this.lastStudies, true);
  }

  /** TPO ve Footprint: ana mum serisi görünmez ama referans (ölçek, çizim, betik) olarak kalır. */
  private isGhostStyle(mode: ChartStyleMode): boolean {
    return mode === 'tpo' || mode === 'footprint';
  }

  private syncCustomSeries(custom: CustomStyle | null): void {
    if (this.customStyle === custom && (custom === null || this.customSeries)) return;
    if (this.customSeries) this.removeSeriesFrom('main', this.customSeries as unknown as ISeriesApi<SeriesType>);
    this.customSeries = null;
    this.customStyle = custom;
    if (!custom) return;
    const scaleId = (this.candleSeries.options() as { priceScaleId?: string }).priceScaleId ?? 'right';
    const series = this.mainChart.addCustomSeries(createView(custom), { priceScaleId: scaleId, priceLineVisible: true, lastValueVisible: true } as never, 0) as unknown as ISeriesApi<'Custom', Time, OhlcvData>;
    const list = this.paneSeries.get('main') ?? [];
    list.push(series as unknown as ISeriesApi<SeriesType>);
    this.paneSeries.set('main', list);
    this.customSeries = series;
  }

  private syncProfileLayer(mode: ChartStyleMode): void {
    const want = mode === 'svp' ? 'svp' : mode === 'tpo' ? 'tpo' : mode === 'footprint' ? 'footprint' : null;
    const have = this.profileLayer instanceof SessionProfiles ? 'svp' : this.profileLayer instanceof TpoLayer ? 'tpo' : this.profileLayer instanceof FootprintLayer ? 'footprint' : null;
    if (want === have) return;
    if (this.profileLayer) {
      try {
        this.candleSeries.detachPrimitive(this.profileLayer);
      } catch {
        // seri yeniden kurulmuş olabilir
      }
    }
    this.profileLayer = null;
    const prm = () => ({ rows: this.styleParams.profile.rows, vaPct: this.styleParams.profile.vaPct });
    const mk = () => this.market as MarketType | undefined;
    if (want === 'svp') this.profileLayer = new SessionProfiles(() => this.rawCandles, mk, prm);
    else if (want === 'tpo')
      this.profileLayer = new TpoLayer(() => this.rawCandles, mk, () => ({
        periodSec: Math.max(this.styleParams.tpo.periodMin * 60, this.barStepSec()),
        vaPct: this.styleParams.profile.vaPct,
        rowSize: this.tpoRow,
      }));
    else if (want === 'footprint') this.profileLayer = new FootprintLayer(() => this.rawCandles, () => this.footprintData, () => this.footprintRow);
    if (this.profileLayer) this.candleSeries.attachPrimitive(this.profileLayer);
    this.syncLastPriceLine();
  }

  /** Footprint hücreleri okunabilsin diye bar aralığı genişler (varsayılan olarak); çıkınca eski aralık geri gelir. */
  private syncFootprintSpacing(mode: ChartStyleMode, prev: ChartStyleMode): void {
    const ts = this.mainChart.timeScale();
    if (mode === 'footprint' && prev !== 'footprint') {
      this.savedBarSpacing = ts.options().barSpacing;
      ts.applyOptions({ barSpacing: 110 });
      this.showRecentBars();
    } else if (mode !== 'footprint' && prev === 'footprint' && this.savedBarSpacing !== null) {
      ts.applyOptions({ barSpacing: this.savedBarSpacing });
      this.savedBarSpacing = null;
    }
  }

  /** Faz 23: sunucu alarmlarının fiyat çizgileri (varsayılan: turuncu kesikli çizgi + saat ikonu etiketi). */
  setAlertLines(lines: Array<{ price: number; title: string }>): void {
    this.alertLineDefs = lines.filter((l) => Number.isFinite(l.price));
    this.syncAlertLines();
  }

  /** Test/denetim: grafikteki alarm çizgisi fiyatları. */
  alertLinePrices(): number[] {
    return this.alertLines.map((l) => l.line.options().price);
  }

  private syncAlertLines(): void {
    for (const { series, line } of this.alertLines) {
      try {
        series.removePriceLine(line);
      } catch {
        // seri yeniden kuruldu
      }
    }
    this.alertLines = [];
    const all: ISeriesApi<SeriesType>[] = [this.candleSeries, this.barSeries, this.lineSeries, this.areaSeries, this.baselineSeries];
    if (this.customSeries) all.unshift(this.customSeries as unknown as ISeriesApi<SeriesType>);
    const host = all.find((x) => x && x.options().visible) ?? this.candleSeries;
    if (!host || !this.alertLinesVisible) return;
    for (const d of this.alertLineDefs) {
      const line = host.createPriceLine({ price: d.price, color: this.alertLineColor, lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: d.title });
      this.alertLines.push({ series: host, line });
    }
  }

  /** Hayalet ana seride son fiyat etiketi ayrı fiyat çizgisiyle gösterilir. */
  private syncLastPriceLine(): void {
    const ghost = this.isGhostStyle(this.styleMode);
    const last = this.rawCandles[this.rawCandles.length - 1];
    if (!ghost || !last) {
      if (this.lastPriceLine) {
        try {
          this.candleSeries.removePriceLine(this.lastPriceLine);
        } catch {
          // ignore
        }
        this.lastPriceLine = null;
      }
      return;
    }
    const color = last.close >= last.open ? '#089981' : '#F23645';
    if (!this.lastPriceLine) {
      this.lastPriceLine = this.candleSeries.createPriceLine({ price: last.close, color, lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: '' });
    } else this.lastPriceLine.applyOptions({ price: last.close, color });
  }

  private barStepSec(): number {
    const c = this.rawCandles;
    const n = c.length;
    return n >= 2 ? Math.max(60, c[n - 1].time - c[n - 2].time) : 60;
  }

  /** Grafik tipi parametreleri (Renko/Range/Line Break/Kagi/P&F kutuları, profil satırları, TPO periyodu). */
  public setStyleParams(p: StyleParams): void {
    this.styleParams = p;
    this.setChartStyleMode(this.styleMode);
  }

  public setMarket(market: string | undefined): void {
    this.market = market;
    this.vrvp?.update();
    this.profileLayer?.update();
  }

  /** Footprint verisi (Binance gerçek akış ya da yaklaşık) + satır yüksekliği. */
  public setFootprintData(data: Map<number, FootprintBar>, row: number): void {
    this.footprintData = data;
    this.footprintRow = row > 0 ? row : 1;
    this.profileLayer?.update();
  }

  /** Ana pane yüksekliği (px). */
  public chartHeight(): number {
    return this.mainContainer.clientHeight || 600;
  }

  public getStyleMode(): ChartStyleMode {
    return this.styleMode;
  }

  /** Görünür bar açılış zamanları (footprint isteği için). */
  public visibleBarTimes(): number[] {
    const r = this.mainChart.timeScale().getVisibleLogicalRange();
    const c = this.rawCandles;
    if (!r || c.length === 0) return [];
    const a = Math.max(0, Math.floor(r.from));
    const b = Math.min(c.length - 1, Math.ceil(r.to));
    const out: number[] = [];
    for (let i = a; i <= b; i++) out.push(c[i].time);
    return out;
  }

  private syncVrvp(): void {
    const on = !!this.quickFlags.vpvr;
    if (on && !this.vrvp) {
      this.vrvp = new VisibleRangeProfile(() => this.axisBars(), () => ({ rows: this.styleParams.profile.rows, vaPct: this.styleParams.profile.vaPct }));
      this.candleSeries.attachPrimitive(this.vrvp);
    } else if (!on && this.vrvp) {
      try {
        this.candleSeries.detachPrimitive(this.vrvp);
      } catch {
        // ignore
      }
      this.vrvp = null;
    }
  }

  /** İki parmakla yakınlaştırma (merkez x etrafında) ve kaydırma; çizim modunda grafik dokunuşu svg'ye gittiği için elle yürütülür. */
  public pinchView(scale: number, centerX: number, dxPx: number): void {
    const ts = this.mainChart.timeScale();
    const range = ts.getVisibleLogicalRange();
    if (!range || !(scale > 0)) return;
    const c = ts.coordinateToLogical(centerX as never) ?? (range.from + range.to) / 2;
    const span = range.to - range.from;
    const factor = Math.min(Math.max(scale, 0.2), 5);
    const newSpan = Math.min(Math.max(span / factor, 5), 5000);
    const k = (c - range.from) / span;
    let from = c - newSpan * k;
    // parmaklar yana kayarsa içerik onlarla gider: dx px -> mantıksal bar
    const barPx = this.mainContainer.clientWidth > 0 ? this.mainContainer.clientWidth / newSpan : 0;
    if (barPx > 0) from -= dxPx / barPx;
    ts.setVisibleLogicalRange({ from, to: from + newSpan });
  }

  private invert = false;

  /** Ana pane'in fiyat ölçekleri (sağ+sol) tür ve ters ayarını uygular. */
  private applyScaleMode(): void {
    const kind = this.scaleKind;
    const mode =
      kind === 'log'
        ? PriceScaleMode.Logarithmic
        : kind === 'percent'
        ? PriceScaleMode.Percentage
        : kind === 'indexed'
        ? PriceScaleMode.IndexedTo100
        : PriceScaleMode.Normal;
    for (const id of ['right', 'left']) {
      this.mainChart.priceScale(id, 0).applyOptions({ mode, invertScale: this.invert });
    }
    this.normalizeSubScales();
  }

  /** Tür/ters ayarı yalnız ana pane'e aittir; alt panelerin ölçekleri (RSI/MACD/Betik) her zaman normal kalır. */
  private normalizeSubScales(): void {
    const n = this.mainChart.panes().length;
    for (let i = 1; i < n; i++) {
      for (const id of ['right', 'left']) {
        try {
          this.mainChart.priceScale(id, i).applyOptions({ mode: PriceScaleMode.Normal, invertScale: false });
        } catch {
          // görünmeyen eksen
        }
      }
    }
  }

  public setPriceScaleKind(kind: PriceScaleKind): void {
    this.scaleKind = kind;
    this.applyScaleMode();
    this.fireViewport();
  }

  public setInvertScale(invert: boolean): void {
    this.invert = invert;
    this.applyScaleMode();
    this.fireViewport();
  }

  /** Betik alt paneli ✕ ile gizlendi mi (▶ Grafiğe Uygula geri getirir). */
  public setScriptSubHidden(hidden: boolean): void {
    if (this.scriptSubHidden === hidden) return;
    this.scriptSubHidden = hidden;
    if (this.lastScript) this.renderScriptExecution(this.lastScript);
  }

  public getPriceScaleKind(): PriceScaleKind {
    return this.scaleKind;
  }

  public fitContent(): void {
    this.mainChart.timeScale().fitContent();
    if (this.scaleLocked) this.setScaleLocked(false);
    this.mainChart.priceScale(this.mainScaleId(), 0).applyOptions({ autoScale: true });
    this.fireViewport();
  }

  public focusTime(targetTime: number): void {
    if (this.rawCandles.length === 0) return;
    const idx = this.rawCandles.findIndex((c) => c.time >= targetTime);
    const targetIdx = idx === -1 ? this.rawCandles.length - 1 : idx;
    const windowBars = 35;
    const fromIdx = Math.max(0, targetIdx - windowBars);
    const toIdx = Math.min(this.rawCandles.length - 1, targetIdx + windowBars);
    const fromTime = this.rawCandles[fromIdx].time as Time;
    const toTime = this.rawCandles[toIdx].time as Time;
    try {
      this.mainChart.timeScale().setVisibleRange({ from: fromTime, to: toTime });
      this.fireViewport();
    } catch {
      // ignore
    }
  }

  /** Faz 29: özel tarih aralığına atlar (Alt+G → Özel Aralık). */
  public jumpToTimeRange(fromSec: number, toSec: number): void {
    if (this.rawCandles.length === 0) return;
    const lo = Math.min(fromSec, toSec);
    const hi = Math.max(fromSec, toSec);
    const first = this.rawCandles[0].time;
    const last = this.rawCandles[this.rawCandles.length - 1].time;
    const f = Math.max(first, Math.min(last, lo));
    const t = Math.max(f + 1, Math.min(last, hi));
    try {
      this.mainChart.timeScale().setVisibleRange({ from: f as Time, to: t as Time });
      this.fireViewport();
    } catch {
      // ignore
    }
  }

  /** Faz 29: klavyeyle bar kaydırma (←/→, Shift+←/→, PageUp/PageDown). */
  public scrollBars(delta: number): void {
    const ts = this.mainChart.timeScale();
    const lr = ts.getVisibleLogicalRange();
    if (!lr) return;
    try {
      ts.setVisibleLogicalRange({ from: lr.from + delta, to: lr.to + delta });
      this.fireViewport();
    } catch {
      // ignore
    }
  }

  /** Faz 29: ekran boyutu kadar kaydır (PageUp/PageDown). */
  public scrollPage(dir: -1 | 1): void {
    const lr = this.mainChart.timeScale().getVisibleLogicalRange();
    if (!lr) return;
    const span = Math.max(10, Math.round((lr.to - lr.from) * 0.8));
    this.scrollBars(dir * span);
  }

  /** Faz 29: merkezli yakınlaştır / uzaklaştır (factor > 1 yakınlaşır, < 1 uzaklaşır). */
  public zoomBy(factor: number): void {
    const ts = this.mainChart.timeScale();
    const lr = ts.getVisibleLogicalRange();
    if (!lr || factor <= 0) return;
    const mid = (lr.from + lr.to) / 2;
    const half = Math.max(5, Math.min(5000, ((lr.to - lr.from) / 2) / factor));
    try {
      ts.setVisibleLogicalRange({ from: mid - half, to: mid + half });
      this.fireViewport();
    } catch {
      // ignore
    }
  }

  /** Faz 29: ilk veya son bara atla (Home / End / ⌘← / ⌘→). */
  public jumpToStart(): void {
    const ts = this.mainChart.timeScale();
    const lr = ts.getVisibleLogicalRange();
    const span = lr ? Math.max(20, lr.to - lr.from) : 120;
    try {
      ts.setVisibleLogicalRange({ from: 0, to: span });
      this.fireViewport();
    } catch {
      // ignore
    }
  }

  public jumpToEnd(): void {
    try {
      this.mainChart.timeScale().scrollToRealTime();
      this.fireViewport();
    } catch {
      // ignore
    }
  }

  /** Faz 29: kutu sürükleyerek o yatay zaman aralığına yakınlaş (Sol çubuk Yakınlaştır aracı). */
  public zoomToPixelRange(x1: number, x2: number): boolean {
    const ts = this.mainChart.timeScale();
    const a = ts.coordinateToLogical(Math.min(x1, x2));
    const b = ts.coordinateToLogical(Math.max(x1, x2));
    if (a === null || b === null || Math.abs(b - a) < 2) return false;
    try {
      ts.setVisibleLogicalRange({ from: Math.min(a, b), to: Math.max(a, b) });
      this.fireViewport();
      return true;
    } catch {
      return false;
    }
  }

  /** Faz 29: tıklanan X koordinatı fiyat ölçeği şeridinde mi? (sağ tık → Fiyat Ölçeği Menüsü). */
  public isPriceScaleX(localX: number, side: 'right' | 'left' = 'right'): boolean {
    const totalW = this.mainContainer.clientWidth || 0;
    if (totalW <= 0) return false;
    const scaleW = Math.max(58, this.mainChart.priceScale(side, 0).width?.() || 68);
    if (side === 'left') return localX >= 0 && localX <= scaleW;
    return localX >= totalW - scaleW && localX <= totalW;
  }

  private clearCompareSeries(): void {
    if (this.compareSeries) {
      try {
        this.mainChart.removeSeries(this.compareSeries);
      } catch {
        // ignore
      }
      this.compareSeries = null;
    }
    for (const s of this.extraCompareSeries) {
      try {
        this.mainChart.removeSeries(s);
      } catch {
        // ignore
      }
    }
    this.extraCompareSeries = [];
    this.syncLeftScale();
  }

  public setComparisonSeries(symbol: string | null, candles: Candle[]): void {
    this.clearCompareSeries();
    if (!symbol || candles.length === 0) return;

    this.compareSeries = this.mainChart.addSeries(
      LineSeries,
      {
        color: '#FF9800',
        lineWidth: 2,
        title: symbol,
        priceScaleId: compareScaleId(this.compareScale),
      },
      0
    );
    this.syncLeftScale();
    this.compareSeries.setData(
      candles.map((c) => ({
        time: c.time as Time,
        value: c.close,
      }))
    );
  }

  /** Faz 26: çoklu karşılaştırma / üst üste bindirme serileri (% aynı ölçek, sol ölçek, kendi ölçeği). */
  public setComparisonItems(
    items: Array<{ symbol: string; color: string; scaleMode: CompareScale; visible: boolean; candles: Candle[] }>
  ): void {
    this.clearCompareSeries();
    const valid = items.filter((it) => it.visible && it.symbol && it.candles.length > 0);
    if (valid.length === 0) return;

    valid.forEach((it, idx) => {
      const scaleId =
        it.scaleMode === 'own'
          ? idx === 0
            ? 'cmp-own'
            : `cmp-own-${idx}`
          : compareScaleId(it.scaleMode);
      const ser = this.mainChart.addSeries(
        LineSeries,
        {
          color: it.color || '#FF9800',
          lineWidth: 2,
          title: it.symbol,
          priceScaleId: scaleId,
        },
        0
      );
      if (it.scaleMode === 'own') {
        try {
          this.mainChart.priceScale(scaleId).applyOptions({ scaleMargins: MAIN_MARGINS });
        } catch {
          // ignore
        }
      }
      ser.setData(
        it.candles.map((c) => ({
          time: c.time as Time,
          value: c.close,
        }))
      );
      if (idx === 0) {
        this.compareSeries = ser;
        this.compareScale = it.scaleMode;
      } else {
        this.extraCompareSeries.push(ser);
      }
    });
    this.syncLeftScale();
    this.fireViewport();
  }

  public setQuickIndicators(flags: Partial<ActiveQuickIndicators>): void {
    this.quickFlags = { ...this.quickFlags, ...flags };
    this.syncVrvp();
    this.renderQuickIndicators();
    this.fireViewport();
  }

  public getQuickIndicators(): ActiveQuickIndicators {
    return { ...this.quickFlags };
  }

  public getCandles(): Candle[] {
    return this.rawCandles;
  }

  public setWatermark(text: string, visible = true, color?: string): void {
    this.lastWatermarkText = text;
    if (color) this.watermarkColor = color;
    // v5: filigran eklentisi; kapalıyken hiç kurulmaz
    if (!visible) {
      this.watermark?.detach();
      this.watermark = undefined;
      return;
    }
    const lines = [
      {
        text,
        color: this.watermarkColor,
        fontSize: 48,
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, Ubuntu, sans-serif",
        fontStyle: 'bold',
      },
    ];
    if (this.watermark) this.watermark.applyOptions({ lines });
    else {
      const pane = this.mainChart.panes()[0];
      if (pane) this.watermark = createTextWatermark(pane, { horzAlign: 'center', vertAlign: 'center', lines });
    }
  }

  public takeScreenshot(): HTMLCanvasElement {
    return this.mainChart.takeScreenshot();
  }

  /** Açık/koyu veya özel renk teması: grafik tuvali, grid, eksen ve mum renkleri. */
  public applyTheme(
    light: boolean,
    custom?: { bg: string; text: string; grid: string; border: string; upColor?: string; downColor?: string }
  ): void {
    const bg = custom?.bg ?? (light ? '#FFFFFF' : '#0B0E14');
    const text = custom?.text ?? (light ? '#5A6A80' : '#8795AA');
    const grid = custom?.grid ?? (light ? '#EEF2F7' : '#171E2C');
    const border = custom?.border ?? (light ? '#D8E2EE' : '#263144');
    this.mainChart.applyOptions({
      layout: { background: { type: ColorType.Solid, color: bg }, textColor: text, panes: { separatorColor: border } },
      grid: { vertLines: { color: grid }, horzLines: { color: grid } },
      rightPriceScale: { borderColor: border },
      leftPriceScale: { borderColor: border },
      timeScale: { borderColor: border },
    });
    if (custom?.upColor && custom?.downColor) {
      this.applyVisualSettings({ upColor: custom.upColor, downColor: custom.downColor });
    }
  }

  /** Faz 29: 7 sekmeli Standart Ayarlar penceresinin tüm görsel ve ölçek ayarlarını canlı uygular. */
  public applyChartSettings(cfg: ChartSettings, symbolText?: string): void {
    const s = cfg.symbol;
    const sc = cfg.scales;
    const cv = cfg.canvas;

    // 1. Sembol (mum gövde/kenarlık/fitil + hassasiyet + zaman dilimi)
    const bodyUp = s.showBody ? s.upColor : 'transparent';
    const bodyDown = s.showBody ? s.downColor : 'transparent';
    const borderUp = s.showBorders ? s.borderUpColor : 'transparent';
    const borderDown = s.showBorders ? s.borderDownColor : 'transparent';
    const wickUp = s.showWick ? s.wickUpColor : 'transparent';
    const wickDown = s.showWick ? s.wickDownColor : 'transparent';

    const precNum = s.precision === 'default' ? null : Number(s.precision);
    const precision = precNum ? Math.round(Math.log10(precNum)) : undefined;
    const minMove = precNum ? 1 / precNum : undefined;
    const priceFormat = precision !== undefined && minMove !== undefined
      ? { type: 'price' as const, precision, minMove }
      : undefined;

    this.candleSeries.applyOptions({
      upColor: bodyUp,
      downColor: bodyDown,
      borderUpColor: borderUp,
      borderDownColor: borderDown,
      wickUpColor: wickUp,
      wickDownColor: wickDown,
      priceLineVisible: sc.showLastPriceLine && !this.isGhostStyle(this.styleMode),
      lastValueVisible: sc.showLastPriceLabel,
      ...(priceFormat ? { priceFormat } : {}),
    });
    this.barSeries.applyOptions({
      upColor: s.upColor,
      downColor: s.downColor,
      priceLineVisible: sc.showLastPriceLine,
      lastValueVisible: sc.showLastPriceLabel,
      ...(priceFormat ? { priceFormat } : {}),
    });
    this.lineSeries.applyOptions({ priceLineVisible: sc.showLastPriceLine, lastValueVisible: sc.showLastPriceLabel });
    this.areaSeries.applyOptions({ priceLineVisible: sc.showLastPriceLine, lastValueVisible: sc.showLastPriceLabel });
    this.baselineSeries.applyOptions({ priceLineVisible: sc.showLastPriceLine, lastValueVisible: sc.showLastPriceLabel });

    // Zaman dilimi ve saat biçimi
    setActiveTimezone(s.timezone);
    setTimeAxisDisplay({ hour12: sc.timeFormat === '12h', dayOfWeek: sc.showDayOfWeek });

    // 2. Tuval & Ölçekler (arka plan, ayrı dikey/yatay ızgara, crosshair, punto, marj, sağ boşluk)
    const bg =
      cv.bgMode === 'gradient'
        ? { type: ColorType.VerticalGradient, topColor: cv.bgColor, bottomColor: cv.bgColor2 }
        : { type: ColorType.Solid, color: cv.bgColor };
    const chStyle = cv.crosshairStyle === 'solid' ? 0 : cv.crosshairStyle === 'dotted' ? 1 : 2;
    const topM = Math.min(0.4, Math.max(0, cv.marginTop / 100));
    const botM = Math.min(0.4, Math.max(0, cv.marginBottom / 100));

    this.mainChart.applyOptions({
      layout: {
        background: bg,
        textColor: cv.scaleTextColor,
        fontSize: cv.scaleFontSize,
        panes: { separatorColor: cv.scaleLineColor },
      },
      grid: {
        vertLines: { visible: cv.showVertGrid, color: cv.showVertGrid ? cv.vertGridColor : 'transparent' },
        horzLines: { visible: cv.showHorzGrid, color: cv.showHorzGrid ? cv.horzGridColor : 'transparent' },
      },
      crosshair: {
        vertLine: { color: cv.crosshairColor, style: chStyle },
        horzLine: { color: cv.crosshairColor, style: chStyle },
      },
      rightPriceScale: {
        borderColor: cv.scaleLineColor,
        scaleMargins: { top: topM, bottom: botM },
      },
      leftPriceScale: {
        borderColor: cv.scaleLineColor,
        scaleMargins: { top: topM, bottom: botM },
      },
      timeScale: {
        borderColor: cv.scaleLineColor,
        rightOffset: cv.rightOffset,
        tickMarkFormatter: (t: unknown, type: number) => tickMarkFormatter(t, type),
      },
      localization: {
        timeFormatter: (t: unknown) => (typeof t === 'number' ? formatCrosshairTime(t, undefined, this.showSeconds) : ''),
      },
    });

    // 3. Filigran
    this.setWatermark(symbolText || this.lastWatermarkText || '', cv.showWatermark, cv.watermarkColor);

    // 4. Alarmlar çizgi rengi / görünürlük
    this.alertLinesVisible = cfg.alerts.showAlertLines;
    this.alertLineColor = cfg.alerts.alertLineColor || '#FF9800';
    this.syncAlertLines();

    // 5. Yüksek/Düşük fiyat çizgileri & Seans/Gün sonu ayırıcıları
    this.showHighLowLines = sc.showHighLowLines;
    this.syncHighLowLines();
    this.showSessionBreaks = sc.showSessionBreaks;
    this.sessionBreakColor = sc.sessionBreakColor || '#0284C7';
    this.renderSessionBreaks();
  }

  private syncHighLowLines(): void {
    for (const line of this.highLowLines) {
      try {
        this.candleSeries.removePriceLine(line);
      } catch {
        // ignore
      }
    }
    this.highLowLines = [];
    if (!this.showHighLowLines || this.rawCandles.length === 0) return;
    let hi = -Infinity;
    let lo = Infinity;
    const lr = this.mainChart.timeScale().getVisibleLogicalRange();
    const start = lr ? Math.max(0, Math.floor(lr.from)) : 0;
    const end = lr ? Math.min(this.rawCandles.length - 1, Math.ceil(lr.to)) : this.rawCandles.length - 1;
    for (let i = start; i <= end; i++) {
      const c = this.rawCandles[i];
      if (!c) continue;
      if (c.high > hi) hi = c.high;
      if (c.low < lo) lo = c.low;
    }
    if (!Number.isFinite(hi) || !Number.isFinite(lo)) return;
    this.highLowLines.push(
      this.candleSeries.createPriceLine({ price: hi, color: '#089981', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: 'H' }),
      this.candleSeries.createPriceLine({ price: lo, color: '#F23645', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: 'L' })
    );
  }

  private renderSessionBreaks(): void {
    const host = this.mainContainer.parentElement;
    if (!this.showSessionBreaks || !host || this.rawCandles.length < 2) {
      if (this.sessionBreakSvg) {
        this.sessionBreakSvg.remove();
        this.sessionBreakSvg = null;
      }
      return;
    }
    if (!this.sessionBreakSvg) {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('class', 'session-breaks-svg');
      svg.style.position = 'absolute';
      svg.style.inset = '0';
      svg.style.width = '100%';
      svg.style.height = '100%';
      svg.style.pointerEvents = 'none';
      svg.style.zIndex = '4';
      host.appendChild(svg);
      this.sessionBreakSvg = svg;
    }
    const svg = this.sessionBreakSvg;
    svg.innerHTML = '';
    const h = this.mainContainer.clientHeight || 400;
    const ts = this.mainChart.timeScale();
    let prevDay = -1;
    for (let i = 0; i < this.rawCandles.length; i++) {
      const day = Math.floor(this.rawCandles[i].time / 86400);
      if (prevDay !== -1 && day !== prevDay) {
        const x = ts.timeToCoordinate(this.rawCandles[i].time as Time);
        if (x !== null && x > 0 && x < (this.mainContainer.clientWidth || 2000)) {
          const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
          line.setAttribute('x1', String(Math.round(x)));
          line.setAttribute('x2', String(Math.round(x)));
          line.setAttribute('y1', '0');
          line.setAttribute('y2', String(h));
          line.setAttribute('stroke', this.sessionBreakColor);
          line.setAttribute('stroke-opacity', '0.35');
          line.setAttribute('stroke-width', '1');
          line.setAttribute('stroke-dasharray', '4,4');
          svg.appendChild(line);
        }
      }
      prevDay = day;
    }
  }

  public applyVisualSettings(options: {
    upColor?: string;
    downColor?: string;
    bgColor?: string;
    showGrid?: boolean;
  }): void {
    if (options.upColor || options.downColor) {
      const up = options.upColor || '#089981';
      const down = options.downColor || '#F23645';
      this.candleSeries.applyOptions({
        upColor: up,
        borderUpColor: up,
        wickUpColor: up,
        downColor: down,
        borderDownColor: down,
        wickDownColor: down,
      });
      this.barSeries.applyOptions({
        upColor: up,
        downColor: down,
      });
    }
    if (options.bgColor) {
      this.mainChart.applyOptions({
        layout: {
          background: { type: ColorType.Solid, color: options.bgColor },
        },
      });
    }
    if (options.showGrid !== undefined) {
      const gridColor = options.showGrid ? '#171E2C' : 'transparent';
      this.mainChart.applyOptions({
        grid: {
          vertLines: { color: gridColor },
          horzLines: { color: gridColor },
        },
      });
    }
  }

  private renderPrimaryPriceAndVolume(): void {
    const derived = isDerivedStyle(this.styleMode);
    const source =
      this.styleMode === 'heikin'
        ? toHeikinAshi(this.rawCandles)
        : isDerivedStyle(this.styleMode)
        ? deriveCandles(this.styleMode, this.rawCandles, this.styleParams, this.derivedBasisCandles())
        : this.rawCandles;

    this.derivedBars = derived ? (source as DerivedBar[]) : [];
    const ghost = this.isGhostStyle(this.styleMode);

    if (source.length > 0) {
      const midPrice = source[Math.floor(source.length / 2)].close;
      this.baselineSeries.applyOptions({
        baseValue: { type: 'price', price: midPrice },
      });
    }

    const ohlcData = source.map((c) => ({
      time: c.time as Time,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));

    this.candleSeries.setData(
      source.map((c, i) => {
        const col = ghost ? undefined : this.barColors.get(c.time);
        return col ? { ...ohlcData[i], color: col, borderColor: col, wickColor: col } : ohlcData[i];
      })
    );
    // Yalnız görünen stilin serisi doldurulur (görünmeyen 4 seriye 10k+ nokta basmak ana maliyetti).
    // candleSeries referans seri (çizim/betik koordinatları) olduğu için her zaman dolu kalır.
    const m = this.styleMode;
    const isLine = m === 'line' || m === 'stepline' || m === 'linemarkers';
    this.barSeries.setData(
      m === 'bar'
        ? source.map((c, i) => {
            const col = this.barColors.get(c.time);
            return col ? { ...ohlcData[i], color: col } : ohlcData[i];
          })
        : []
    );

    const linePts = source.map((c) => ({
      time: c.time as Time,
      value: c.close,
    }));

    this.lineSeries.setData(isLine ? linePts : []);
    this.areaSeries.setData(m === 'area' ? linePts : []);
    this.baselineSeries.setData(m === 'baseline' ? linePts : []);
    if (this.customSeries) this.customSeries.setData(source.map((c, i) => this.toCustomPoint(c as DerivedBar, i > 0 ? source[i - 1].close : undefined)));
    if (this.styleMode === 'tpo') this.tpoRow = this.autoTpoRow();
    this.syncLastPriceLine();

    // Varsayılan: türetilmiş tiplerde (Renko/Kagi/P&F…) hacim türetilmiş çubuğun toplam hacmidir
    this.volumeSeries.setData(
      (derived ? source : this.rawCandles).map((c) => ({
        time: c.time as Time,
        value: c.volume,
        color:
          c.close >= c.open
            ? 'rgba(8, 153, 129, 0.5)'
            : 'rgba(242, 54, 69, 0.5)',
      }))
    );
  }

  private toCustomPoint(c: DerivedBar, prevClose?: number): OhlcvData {
    return {
      time: c.time as Time,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume,
      prevClose,
      ...(c.kagi ? { kagi: c.kagi } : {}),
      ...(c.pnf ? { pnf: c.pnf } : {}),
    };
  }

  /** TPO satır yüksekliği: son seansların ortalama aralığı / 25, güzel sayıya yuvarlı. */
  private autoTpoRow(): number {
    const sess = splitSessions(this.rawCandles, this.market as MarketType | undefined).slice(-10);
    if (sess.length === 0) return 1;
    let sum = 0;
    for (const s of sess) {
      let lo = Infinity;
      let hi = -Infinity;
      for (let i = s.from; i <= s.to; i++) {
        lo = Math.min(lo, this.rawCandles[i].low);
        hi = Math.max(hi, this.rawCandles[i].high);
      }
      sum += hi - lo;
    }
    return niceStep(sum / sess.length / 25);
  }

  private renderQuickIndicators(): void {
    for (const s of this.quickSeriesMap.values()) this.removeSeriesFrom('main', s);
    this.quickSeriesMap.clear();

    if (this.rawCandles.length === 0) return;
    const closes = this.rawCandles.map((c) => c.close);

    const addOverlayLine = (
      key: string,
      title: string,
      values: number[],
      color: string,
      lineWidth = 1
    ) => {
      const s = this.addSeriesTo('main', LineSeries, {
        color,
        title,
        lineWidth: lineWidth as 1 | 2 | 3 | 4,
        priceLineVisible: false,
        lastValueVisible: false,
      });
      const times = this.rawCandles.map((c) => c.time);
      const clean = this.align(cleanLineData(times, values));
      s.setData(clean.map((pt) => ({ time: pt.time as Time, value: pt.value })));
      this.quickSeriesMap.set(key, s);
    };

    if (this.quickFlags.ema9) addOverlayLine('ema9', 'EMA 9', calcEMA(closes, 9), '#00BCD4', 1);
    if (this.quickFlags.ema21) addOverlayLine('ema21', 'EMA 21', calcEMA(closes, 21), '#FF9800', 1);
    if (this.quickFlags.ema55) addOverlayLine('ema55', 'EMA 55', calcEMA(closes, 55), '#AB47BC', 2);
    if (this.quickFlags.sma200)
      addOverlayLine('sma200', 'SMA 200', calcSMA(closes, Math.min(200, closes.length)), '#FFD54F', 2);
    if (this.quickFlags.vwap)
      addOverlayLine('vwap', 'VWAP', calcVWAP(this.rawCandles), '#E040FB', 1);

    if (this.quickFlags.bb) {
      const bb = calcBollingerBands(closes, 20, 2);
      addOverlayLine('bb_upper', 'BB Upper', bb.upper, 'rgba(2, 132, 199, 0.75)', 1);
      addOverlayLine('bb_mid', 'BB Basis', bb.middle, 'rgba(255, 213, 79, 0.75)', 1);
      addOverlayLine('bb_lower', 'BB Lower', bb.lower, 'rgba(2, 132, 199, 0.75)', 1);
    }

    if (this.quickFlags.supertrend) {
      const st = calcSuperTrend(this.rawCandles, 3.0, 10);
      addOverlayLine('supertrend', 'SuperTrend', st.supertrend, '#00E676', 2);
    }

    if (this.quickFlags.ichimoku) {
      const ichi = calcIchimoku(this.rawCandles);
      addOverlayLine('ichi_tenkan', 'Tenkan 9', ichi.tenkan, '#0284C7', 1);
      addOverlayLine('ichi_kijun', 'Kijun 26', ichi.kijun, '#F23645', 1);
      addOverlayLine('ichi_spanA', 'Span A', ichi.spanA, 'rgba(8, 153, 129, 0.8)', 1);
      addOverlayLine('ichi_spanB', 'Span B', ichi.spanB, 'rgba(242, 54, 69, 0.8)', 1);
    }

    if (this.quickFlags.psar) {
      const sar = calcParabolicSAR(this.rawCandles);
      addOverlayLine('psar', 'Parabolic SAR', sar, '#00E5FF', 1);
    }

    // Sub-chart Oscillator: RSI (14)
    if (this.quickFlags.rsi) {
      if (!this.rsiSeries) {
        this.rsiSeries = this.addSeriesTo('rsi', LineSeries, {
          color: '#AB47BC',
          title: 'RSI 14',
          lineWidth: 2,
          priceLineVisible: false,
        });
        this.rsiSeries.createPriceLine({
          price: 70,
          color: '#F23645',
          lineWidth: 1,
          lineStyle: 2,
          axisLabelVisible: true,
          title: '70',
        });
        this.rsiSeries.createPriceLine({
          price: 30,
          color: '#089981',
          lineWidth: 1,
          lineStyle: 2,
          axisLabelVisible: true,
          title: '30',
        });
        this.rsiSeries.createPriceLine({
          price: 50,
          color: '#8C8C8C',
          lineWidth: 1,
          lineStyle: 1,
          axisLabelVisible: false,
        });
      }
      const rsiVals = calcRSI(closes, 14);
      const times = this.rawCandles.map((c) => c.time);
      const clean = this.align(cleanLineData(times, rsiVals));
      this.rsiSeries.setData(clean.map((pt) => ({ time: pt.time as Time, value: pt.value })));
      const lastRsi = rsiVals[rsiVals.length - 1];
      if (!Number.isNaN(lastRsi)) this.setPaneLabel('rsi', `RSI (14, close): ${lastRsi.toFixed(2)}`);
    } else if (this.rsiSeries) {
      this.removeSeriesFrom('rsi', this.rsiSeries);
      this.rsiSeries = null;
      this.paneLabels.delete('rsi');
    }

    // Sub-chart Oscillator: MACD (12, 26, 9)
    if (this.quickFlags.macd) {
      if (!this.macdLineSeries) {
        this.macdHistSeries = this.addSeriesTo('macd', HistogramSeries, {
          title: 'MACD Hist',
          priceLineVisible: false,
        });
        this.macdLineSeries = this.addSeriesTo('macd', LineSeries, {
          color: '#0284C7',
          title: 'MACD',
          lineWidth: 2,
          priceLineVisible: false,
        });
        this.macdSignalSeries = this.addSeriesTo('macd', LineSeries, {
          color: '#FF9800',
          title: tt('Sinyal'),
          lineWidth: 1,
          priceLineVisible: false,
        });
      }
      const macdRes = calcMACD(closes, 12, 26, 9);
      const times = this.rawCandles.map((c) => c.time);
      const cleanMacd = this.align(cleanLineData(times, macdRes.macdLine));
      const cleanSignal = this.align(cleanLineData(times, macdRes.signalLine));
      const cleanHist = this.align(cleanLineData(times, macdRes.histLine));

      this.macdLineSeries!.setData(cleanMacd.map((pt) => ({ time: pt.time as Time, value: pt.value })));
      this.macdSignalSeries!.setData(cleanSignal.map((pt) => ({ time: pt.time as Time, value: pt.value })));
      this.macdHistSeries!.setData(
        cleanHist.map((pt) => ({
          time: pt.time as Time,
          value: pt.value,
          color: pt.value >= 0 ? 'rgba(8, 153, 129, 0.75)' : 'rgba(242, 54, 69, 0.75)',
        }))
      );
      const lastM = macdRes.macdLine[macdRes.macdLine.length - 1] || 0;
      const lastS = macdRes.signalLine[macdRes.signalLine.length - 1] || 0;
      this.setPaneLabel('macd', `MACD (12, 26, 9): ${lastM.toFixed(2)} | ${tt('Sinyal')}: ${lastS.toFixed(2)}`);
    } else if (this.macdLineSeries) {
      this.removeSeriesFrom('macd', this.macdLineSeries);
      this.removeSeriesFrom('macd', this.macdSignalSeries);
      this.removeSeriesFrom('macd', this.macdHistSeries);
      this.paneLabels.delete('macd');
      this.macdLineSeries = null;
      this.macdSignalSeries = null;
      this.macdHistSeries = null;
    }

    this.resize();
  }

  /** Plot noktası → seri noktası (setData ve artımlı update ortak). */
  private scriptPoint(p: ScriptExecutionResult['plots'][number], pt: ScriptExecutionResult['plots'][number]['data'][number]): any {
    if (p.style === 'histogram') return { time: pt.time as Time, value: pt.value, color: pt.color || p.color };
    if (p.style === 'area') {
      return {
        time: pt.time as Time,
        value: pt.value,
        ...(pt.color ? { lineColor: pt.color, topColor: withAlpha(pt.color, 0.32), bottomColor: withAlpha(pt.color, 0.02) } : {}),
      };
    }
    return { time: pt.time as Time, value: pt.value, ...(pt.color ? { color: pt.color } : {}) };
  }

  private scriptOhlcPoint(o: NonNullable<ScriptExecutionResult['ohlcPlots']>[number], d: NonNullable<ScriptExecutionResult['ohlcPlots']>[number]['data'][number]): any {
    return o.kind === 'candle'
      ? { time: d.time as Time, open: d.open, high: d.high, low: d.low, close: d.close, ...(d.color ? { color: d.color, borderColor: d.borderColor ?? d.color, wickColor: d.wickColor ?? d.color } : {}) }
      : { time: d.time as Time, open: d.open, high: d.high, low: d.low, close: d.close, ...(d.color ? { color: d.color } : {}) };
  }

  /** Plot listesinin yapısal imzası (seri yeniden kullanımı için). */
  private scriptShape(res: ScriptExecutionResult): string {
    return [
      res.isOverlay,
      this.scriptSubHidden,
      res.plots.map((p) => `${p.hidden ? 1 : 0}${p.data.length > 0 ? 1 : 0}${p.style}|${p.isOverlay}|${p.color}|${p.lineWidth}|${p.title}`).join(';'),
      (res.ohlcPlots ?? []).map((o) => `${o.kind}|${o.isOverlay}|${o.title}|${o.data.length > 0 ? 1 : 0}`).join(';'),
      res.hlines.map((h) => `${h.price}|${h.color}|${h.title}`).join(';'),
    ].join('#');
  }

  private scriptPlotSeries: Array<ISeriesApi<SeriesType> | null> = [];
  private scriptOhlcSeriesList: Array<ISeriesApi<SeriesType> | null> = [];
  private scriptShapeKey = '';

  /**
   * Faz 30: aynı yapıdaki ardışık Betik sonuçlarında seriler korunur; veri, yama protokolünün paylaştığı
   * önek nokta referanslarıyla karşılaştırılıp yalnız değişen kuyruk `update` edilir (100k barda setData yok).
   */
  private tryIncrementalScript(res: ScriptExecutionResult): boolean {
    const prev = this.lastScript;
    // Aynı nesneyle yeniden çizim (stil/ölçek değişimi) her zaman tam yoldan geçer
    if (!prev || prev === res || !prev.ok || !res.ok || this.focusAfterScript || isDerivedStyle(this.styleMode)) return false;
    if (this.scriptShape(res) !== this.scriptShapeKey) return false;
    const sameBarColors =
      (prev.barcolors?.length ?? 0) === (res.barcolors?.length ?? 0) &&
      (res.barcolors ?? []).every((b, i) => b === prev.barcolors![i] || (b.time === prev.barcolors![i].time && b.color === prev.barcolors![i].color));
    if (!sameBarColors) return false;
    const plan: Array<() => void> = [];
    const diff = <T,>(a: T[], b: T[]): number => {
      if (b.length < a.length) return -1;
      let k = 0;
      const m = a.length;
      while (k < m && samePoint(a[k], b[k])) k++;
      // Yalnız son nokta / sona ekleme: LWC `historicalUpdate` 100k barda ~1 sn sürüyordu (tam setData daha ucuz)
      return k >= m - 1 && b.length - k <= 64 ? k : -1;
    };
    for (let i = 0; i < res.plots.length; i++) {
      const ser = this.scriptPlotSeries[i];
      if (!ser) continue;
      const p = res.plots[i];
      const a = prev.plots[i].data;
      const b = p.data;
      const k = diff(a, b);
      if (k < 0) plan.push(() => ser.setData(b.map((pt) => this.scriptPoint(p, pt))));
      else for (let j = k; j < b.length; j++) plan.push(() => ser.update(this.scriptPoint(p, b[j])));
    }
    const ro = res.ohlcPlots ?? [];
    for (let i = 0; i < ro.length; i++) {
      const ser = this.scriptOhlcSeriesList[i];
      if (!ser) continue;
      const o = ro[i];
      const a = prev.ohlcPlots![i].data;
      const b = o.data;
      const k = diff(a, b);
      if (k < 0) plan.push(() => ser.setData(b.map((d) => this.scriptOhlcPoint(o, d))));
      else for (let j = k; j < b.length; j++) plan.push(() => ser.update(this.scriptOhlcPoint(o, b[j])));
    }
    for (const f of plan) f();
    this.lastScript = res;
    const pm = prev.markers;
    const rm = res.markers;
    const sameMarkers =
      pm.length === rm.length &&
      (rm.length === 0 || (rm[rm.length - 1].time === pm[pm.length - 1].time && rm[rm.length - 1].text === pm[pm.length - 1].text && rm[0].time === pm[0].time));
    if (!sameMarkers) {
      this.scriptMarkers = this.alignMarkers(withoutTradeLayerMarkers(res)).map((m) => ({ time: m.time as Time, position: m.position, color: m.color, shape: m.shape, text: m.text }));
      this.applyMarkers();
    }
    this.scriptMainLayer?.setResult(res);
    this.scriptSubLayer?.setResult(res);
    return true;
  }

  public renderScriptExecution(res: ScriptExecutionResult): void {
    if (this.tryIncrementalScript(res)) return;
    this.lastScript = res;
    this.scriptPlotSeries = [];
    this.scriptOhlcSeriesList = [];
    this.scriptShapeKey = res.ok ? this.scriptShape(res) : '';
    for (const s of this.scriptOverlaySeries) this.removeSeriesFrom('main', s);
    this.scriptOverlaySeries = [];

    for (const s of this.scriptSubSeries) this.removeSeriesFrom('script', s);
    this.scriptSubSeries = [];
    this.scriptPriceLines = [];

    // barcolor(): mum rengi (başarısız çalıştırmada temizlenir)
    const hadColors = this.barColors.size > 0;
    this.barColors = new Map(res.ok ? (res.barcolors ?? []).map((p) => [p.time, p.color]) : []);
    // Birincil seri yalnız bar rengi ya da bar kümesi değiştiyse yeniden kurulur (TitanScript her koşuda 6 setData yapmasın)
    if (hadColors || this.barColors.size > 0) this.renderPrimaryPriceAndVolume();

    if (this.focusAfterScript) {
      this.focusAfterScript = false;
      this.showRecentBars();
    }

    if (!res.ok) {
      this.scriptMarkers = [];
      this.applyMarkers();
      this.scriptMainLayer?.setResult(null);
      this.scriptSubLayer?.setResult(null);
      return;
    }

    const track = (overlay: boolean, s: ISeriesApi<'Line' | 'Histogram' | 'Area' | 'Candlestick' | 'Bar'>) =>
      (overlay ? this.scriptOverlaySeries : this.scriptSubSeries).push(s as ISeriesApi<'Line' | 'Histogram'>);

    for (const p of res.plots) {
      this.scriptPlotSeries.push(null);
      if (p.hidden || p.data.length === 0) continue;
      if (!p.isOverlay && this.scriptSubHidden) continue;
      const pid: PaneId = p.isOverlay ? 'main' : 'script';
      if (p.style === 'histogram') {
        const hist = this.addSeriesTo(pid, HistogramSeries, {
          color: p.color,
          title: p.title,
          priceLineVisible: false,
        });
        hist.setData(
          this.align(p.data).map((pt) => ({
            time: pt.time as Time,
            value: pt.value,
            color: pt.color || p.color,
          }))
        );
        track(p.isOverlay, hist);
        this.scriptPlotSeries[this.scriptPlotSeries.length - 1] = hist as ISeriesApi<SeriesType>;
      } else if (p.style === 'area') {
        const area = this.addSeriesTo(pid, AreaSeries, {
          lineColor: p.color,
          topColor: withAlpha(p.color, 0.32),
          bottomColor: withAlpha(p.color, 0.02),
          lineWidth: Math.min(4, Math.max(1, p.lineWidth)) as 1 | 2 | 3 | 4,
          title: p.title,
          priceLineVisible: false,
        });
        area.setData(
          this.align(p.data).map((pt) => ({
            time: pt.time as Time,
            value: pt.value,
            ...(pt.color ? { lineColor: pt.color, topColor: withAlpha(pt.color, 0.32), bottomColor: withAlpha(pt.color, 0.02) } : {}),
          }))
        );
        track(p.isOverlay, area);
        this.scriptPlotSeries[this.scriptPlotSeries.length - 1] = area as ISeriesApi<SeriesType>;
      } else {
        // line / stepline / circles / cross (son ikisi ScriptLayer'da çizilir; seri ölçek için kalır)
        const pointStyle = p.style === 'circles' || p.style === 'cross';
        const line = this.addSeriesTo(pid, LineSeries, {
          color: p.color,
          lineWidth: Math.min(4, Math.max(1, p.lineWidth)) as 1 | 2 | 3 | 4,
          title: p.title,
          priceLineVisible: false,
          lineType: p.style === 'stepline' ? LineType.WithSteps : LineType.Simple,
          lineVisible: !pointStyle,
          crosshairMarkerVisible: !pointStyle,
          lastValueVisible: !pointStyle,
        });
        line.setData(
          this.align(p.data).map((pt) => ({
            time: pt.time as Time,
            value: pt.value,
            ...(pt.color ? { color: pt.color } : {}),
          }))
        );
        track(p.isOverlay, line);
        this.scriptPlotSeries[this.scriptPlotSeries.length - 1] = line as ISeriesApi<SeriesType>;
      }
    }

    for (const o of res.ohlcPlots ?? []) {
      this.scriptOhlcSeriesList.push(null);
      if (o.data.length === 0) continue;
      if (!o.isOverlay && this.scriptSubHidden) continue;
      const pid: PaneId = o.isOverlay ? 'main' : 'script';
      if (o.kind === 'candle') {
        const cs = this.addSeriesTo(pid, CandlestickSeries, { title: o.title, priceLineVisible: false });
        cs.setData(
          this.align(o.data).map((d) => ({
            time: d.time as Time,
            open: d.open,
            high: d.high,
            low: d.low,
            close: d.close,
            ...(d.color ? { color: d.color, borderColor: d.borderColor ?? d.color, wickColor: d.wickColor ?? d.color } : {}),
          }))
        );
        track(o.isOverlay, cs);
        this.scriptOhlcSeriesList[this.scriptOhlcSeriesList.length - 1] = cs as ISeriesApi<SeriesType>;
      } else {
        const bs = this.addSeriesTo(pid, BarSeries, { title: o.title, priceLineVisible: false });
        bs.setData(
          this.align(o.data).map((d) => ({
            time: d.time as Time,
            open: d.open,
            high: d.high,
            low: d.low,
            close: d.close,
            ...(d.color ? { color: d.color } : {}),
          }))
        );
        track(o.isOverlay, bs);
        this.scriptOhlcSeriesList[this.scriptOhlcSeriesList.length - 1] = bs as ISeriesApi<SeriesType>;
      }
    }

    if (this.scriptSubSeries.length > 0) this.setPaneLabel('script', res.scriptTitle ?? LANG_NAME);
    else this.paneLabels.delete('script');
    this.resize();

    const lineHost =
      !res.isOverlay && this.scriptSubSeries.length > 0
        ? this.scriptSubSeries[0]
        : this.candleSeries;
    for (const hl of res.hlines) {
      const pl = lineHost.createPriceLine({
        price: hl.price,
        color: hl.color,
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: hl.title,
      });
      this.scriptPriceLines.push(pl);
    }

    const chartMarkers: SeriesMarker<Time>[] = this.alignMarkers(withoutTradeLayerMarkers(res)).map((m) => ({
      time: m.time as Time,
      position: m.position,
      color: m.color,
      shape: m.shape,
      text: m.text,
    }));
    this.scriptMarkers = chartMarkers;
    this.applyMarkers();
    this.scriptMainLayer?.setResult(res);
    this.scriptSubLayer?.setResult(res);
  }

  /** İmleçteki (yoksa son) barın gösterge değerleri: Standart pane durum satırı. */
  private studyPaneValues(id: PaneId): Array<{ text: string; color: string }> {
    const out: Array<{ text: string; color: string }> = [];
    for (const it of this.lastStudies) {
      if (it.pane !== id || it.statusValues === false) continue;
      for (const p of it.result.plots) {
        if (p.hidden) continue;
        const v = valueAt(p, this.hoverTime);
        if (v) out.push({ text: formatStudyValue(v.value, it.precision ?? -1), color: v.color });
      }
    }
    return out.slice(0, 12);
  }

  /** Crosshair zamanı (sn) — pane durum satırları için; null = son bar. */
  private hoverTime: number | null = null;
  public setStudyHoverTime(t: number | null): void {
    if (this.hoverTime === t) return;
    this.hoverTime = t;
    if (this.lastStudies.some((s) => s.pane !== 'main')) this.layoutChrome();
  }

  /** TitanScript (editör) + ana paneldeki göstergelerin işaretçileri tek eklentide, zaman sıralı. */
  private markersKey = '';
  private applyMarkers(): void {
    const all = [...this.scriptMarkers, ...this.studyMarkers].sort((a, b) => Number(a.time) - Number(b.time));
    // Faz 30: içerik aynıysa (canlı tick'lerde çoğunlukla) eklenti yeniden kurulmaz
    let key = String(all.length);
    for (const m of all) key += `|${m.time}${m.position}${m.shape}${m.color}${m.text ?? ''}`;
    if (key === this.markersKey) return;
    this.markersKey = key;
    this.markersApi?.setMarkers(all);
  }

  // ------------------------------------------------------------------ Faz 20: gösterge örnekleri

  /**
   * Grafikteki göstergeleri çizer. Yapı (pane/ölçek/çizim kümesi/stil) değişmediyse seriler korunur ve yalnızca
   * veri güncellenir — tick başına pane yeniden kurulmaz, kullanıcının pane yüksekliği/sırası korunur.
   */
  public renderStudies(items: StudyRenderInput[], force = false): void {
    this.lastStudies = items;
    const host = this.mainContainer.parentElement;
    const seen = new Set<string>();
    const labels = new Map<PaneId, string[]>();
    const markers: SeriesMarker<Time>[] = [];
    for (const it of items) {
      seen.add(it.uid);
      const pane = it.pane as PaneId;
      const sig = studySignature(it);
      let entry = this.studyEntries.get(it.uid);
      if (!entry || entry.sig !== sig || force) {
        const old = entry;
        entry = this.buildStudy(it, sig, host);
        // yeni seriler eklendikten sonra eskiler kalkar: paylaşılan pane yeniden yaratılmaz
        if (old) this.dropStudy(old);
        this.studyEntries.set(it.uid, entry);
      } else {
        entry.update(it.result);
      }
      entry.layer?.setResult(it.result);
      if (pane === 'main') markers.push(...this.studyMarkersOf(it.result));
      else {
        const l = labels.get(pane) ?? [];
        l.push(it.label);
        labels.set(pane, l);
      }
    }
    for (const [uid, e] of [...this.studyEntries]) {
      if (!seen.has(uid)) {
        this.dropStudy(e);
        this.studyEntries.delete(uid);
      }
    }
    for (const id of [...this.paneLabels.keys()]) if (id.startsWith('study:') && !labels.has(id)) this.paneLabels.delete(id);
    for (const [id, l] of labels) this.setPaneLabel(id, l.join(' · '));
    this.studyMarkers = markers;
    this.applyMarkers();
    this.resize();
  }

  /** Test/kanıt: gösterge uid → pane ve seri sayısı. */
  public getStudyPanes(): Record<string, { pane: PaneId; series: number }> {
    const out: Record<string, { pane: PaneId; series: number }> = {};
    for (const [uid, e] of this.studyEntries) out[uid] = { pane: e.pane, series: e.series.length };
    return out;
  }

  private studyMarkersOf(res: ScriptExecutionResult): SeriesMarker<Time>[] {
    return this.alignMarkers(res.markers).map((m) => ({ time: m.time as Time, position: m.position, color: m.color, shape: m.shape, text: m.text }));
  }

  private dropStudy(e: StudyEntry): void {
    for (const { series, line } of e.priceLines) {
      try {
        series.removePriceLine(line);
      } catch {
        // seri zaten kaldırıldı
      }
    }
    for (const s of e.series) this.removeSeriesFrom(e.pane, s);
    e.layer?.destroy();
  }

  /** Faz 30: kaynak nokta dizisinin yalnız değişen kuyruğu `update` edilir (önek referansları aynıysa); aksi halde setData. */
  private lastSeriesSrc = new WeakMap<object, unknown[]>();
  private smartSetData<T extends { time: number }>(s: ISeriesApi<SeriesType>, src: T[], map: (x: T) => any): void {
    if (isDerivedStyle(this.styleMode)) {
      this.lastSeriesSrc.delete(s);
      s.setData(this.align(src).map(map));
      return;
    }
    const prev = this.lastSeriesSrc.get(s) as T[] | undefined;
    this.lastSeriesSrc.set(s, src);
    if (prev && prev !== src && src.length >= prev.length) {
      let k = 0;
      const m = prev.length;
      while (k < m && samePoint(prev[k], src[k])) k++;
      if (k >= m - 1 && src.length - k <= 64) {
        for (let j = k; j < src.length; j++) s.update(map(src[j]));
        return;
      }
    } else if (prev === src) {
      return;
    }
    s.setData(src.map(map));
  }

  private buildStudy(it: StudyRenderInput, sig: string, host: HTMLElement | null): StudyEntry {
    const pane = it.pane as PaneId;
    const res = it.result;
    const scaleId = it.scale === 'none' ? `study-${it.uid}` : it.scale === 'left' ? 'left' : undefined;
    const series: ISeriesApi<SeriesType>[] = [];
    const setters: Array<(r: ScriptExecutionResult) => void> = [];
    const base = (title: string) => ({
      title,
      priceLineVisible: false,
      lastValueVisible: it.priceLabels,
      ...(scaleId ? { priceScaleId: scaleId } : {}),
    });
    const plots = visiblePlots(res);
    plots.forEach((p, idx) => {
      const pick = (r: ScriptExecutionResult) => visiblePlots(r)[idx] ?? p;
      if (p.style === 'histogram') {
        const s = this.addSeriesTo(pane, HistogramSeries, { ...base(p.title), color: p.color });
        const set = (r: ScriptExecutionResult) => {
          const q = pick(r);
          this.smartSetData(s, q.data, (pt) => ({ time: pt.time as Time, value: pt.value, color: pt.color || q.color }));
        };
        series.push(s as ISeriesApi<SeriesType>);
        setters.push(set);
      } else if (p.style === 'area') {
        const s = this.addSeriesTo(pane, AreaSeries, {
          ...base(p.title),
          lineColor: p.color,
          topColor: withAlpha(p.color, 0.32),
          bottomColor: withAlpha(p.color, 0.02),
          lineWidth: Math.min(4, Math.max(1, p.lineWidth)) as 1 | 2 | 3 | 4,
        });
        const set = (r: ScriptExecutionResult) => {
          const q = pick(r);
          this.smartSetData(s, q.data, (pt) => ({
              time: pt.time as Time,
              value: pt.value,
              ...(pt.color ? { lineColor: pt.color, topColor: withAlpha(pt.color, 0.32), bottomColor: withAlpha(pt.color, 0.02) } : {}),
            }));
        };
        series.push(s as ISeriesApi<SeriesType>);
        setters.push(set);
      } else {
        const pointStyle = p.style === 'circles' || p.style === 'cross';
        const s = this.addSeriesTo(pane, LineSeries, {
          ...base(p.title),
          color: p.color,
          lineWidth: Math.min(4, Math.max(1, p.lineWidth)) as 1 | 2 | 3 | 4,
          lineType: p.style === 'stepline' ? LineType.WithSteps : LineType.Simple,
          lineVisible: !pointStyle,
          crosshairMarkerVisible: !pointStyle,
          ...(pointStyle ? { lastValueVisible: false } : {}),
        });
        const set = (r: ScriptExecutionResult) => {
          const q = pick(r);
          this.smartSetData(s, q.data, (pt) => ({ time: pt.time as Time, value: pt.value, ...(pt.color ? { color: pt.color } : {}) }));
        };
        series.push(s as ISeriesApi<SeriesType>);
        setters.push(set);
      }
    });
    const ohlc = (res.ohlcPlots ?? []).filter((o) => o.data.length > 0);
    ohlc.forEach((o, idx) => {
      const pick = (r: ScriptExecutionResult) => (r.ohlcPlots ?? []).filter((x) => x.data.length > 0)[idx] ?? o;
      const def = o.kind === 'candle' ? CandlestickSeries : BarSeries;
      const s = this.addSeriesTo(pane, def as typeof CandlestickSeries, { ...base(o.title) });
      const set = (r: ScriptExecutionResult) => {
        const q = pick(r);
        this.smartSetData(s, q.data, (d) => ({
            time: d.time as Time,
            open: d.open,
            high: d.high,
            low: d.low,
            close: d.close,
            ...(d.color ? { color: d.color, borderColor: d.borderColor ?? d.color, wickColor: d.wickColor ?? d.color } : {}),
          }));
      };
      series.push(s as ISeriesApi<SeriesType>);
      setters.push(set);
    });
    // yalnızca hline/çizim/arka plan üreten osilatör: pane'i taşıyacak görünmez seri
    if (series.length === 0 && pane !== 'main') {
      const s = this.addSeriesTo(pane, LineSeries, { ...base(''), lineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
      const set = () => s.setData(this.axisBars().map((c) => ({ time: c.time as Time })));
      series.push(s as ISeriesApi<SeriesType>);
      setters.push(set);
    }
    const update = (r: ScriptExecutionResult) => setters.forEach((f) => f(r));
    update(res);

    const lineHost: ISeriesApi<SeriesType> = series[0] ?? this.candleSeries;
    const priceLines: StudyEntry['priceLines'] = [];
    for (const hl of res.hlines) {
      // Varsayılan: hline ölçekte etiket göstermez
      const line = lineHost.createPriceLine({ price: hl.price, color: hl.color, lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: '' });
      priceLines.push({ series: lineHost, line });
    }
    const needsLayer =
      (res.fills?.length ?? 0) > 0 ||
      (res.bgcolors?.length ?? 0) > 0 ||
      hasDrawings(res) ||
      res.plots.some((p) => !p.hidden && (p.style === 'circles' || p.style === 'cross'));
    const hostSeries = (): ISeriesApi<SeriesType> | undefined =>
      pane === 'main' && !scaleId ? this.candleSeries : this.studyEntries.get(it.uid)?.series[0] ?? series[0];
    const layer = needsLayer && host ? new ScriptLayer(host, this.layerMapperFor(pane, hostSeries), pane === 'main' ? 'main' : 'sub') : undefined;
    return { pane, sig, series, priceLines, update, layer };
  }

  public timeToX(timeSec: number): number | null {
    const coord = this.mainChart.timeScale().timeToCoordinate(timeSec as Time);
    if (coord !== null) return Number(coord);
    const l = this.timeToLogical(timeSec);
    if (l === null) return null;
    const x = this.mainChart.timeScale().logicalToCoordinate(l as never);
    return x === null ? null : Number(x);
  }

  public xToTime(x: number): number | null {
    const t = this.mainChart.timeScale().coordinateToTime(x);
    if (t !== null && typeof t === 'number') return t;
    const l = this.mainChart.timeScale().coordinateToLogical(x);
    if (l !== null) {
      const tt = this.logicalToTime(Number(l));
      if (tt !== null) return tt;
    }
    if (this.rawCandles.length > 0) {
      return this.rawCandles[this.rawCandles.length - 1].time;
    }
    return null;
  }

  /** timeToLogical'ın tersi: veri dışı mantıksal indeksler son/ilk bar aralığıyla ekstrapole edilir. */
  public logicalToTime(l: number): number | null {
    const c = this.axisBars();
    const n = c.length;
    if (n === 0) return null;
    if (l >= n - 1) {
      const dt = n >= 2 ? c[n - 1].time - c[n - 2].time || 60 : 60;
      return Math.round(c[n - 1].time + (l - (n - 1)) * dt);
    }
    if (l <= 0) {
      const dt = n >= 2 ? c[1].time - c[0].time || 60 : 60;
      return Math.round(c[0].time + l * dt);
    }
    const lo = Math.floor(l);
    return Math.round(c[lo].time + (l - lo) * (c[lo + 1].time - c[lo].time));
  }

  public priceToY(price: number): number | null {
    const coord = this.candleSeries.priceToCoordinate(price);
    return coord !== null ? Number(coord) : null;
  }

  public yToPrice(y: number): number | null {
    const p = this.candleSeries.coordinateToPrice(y);
    return p !== null ? Number(p) : null;
  }

  public getMainChart(): IChartApi {
    return this.mainChart;
  }

  public destroy(): void {
    if (this.settleTimer !== undefined) clearTimeout(this.settleTimer);
    this.settleTimer = undefined;
    if (this.indTimer !== undefined) clearTimeout(this.indTimer);
    this.indTimer = undefined;
    if (this.vpRaf && typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(this.vpRaf);
    this.vpRaf = 0;
    this.scriptMainLayer?.destroy();
    this.scriptSubLayer?.destroy();
    this.tradeLayer?.destroy();
    this.eventLayer?.destroy();
    if (this.sessionBreakSvg) {
      this.sessionBreakSvg.remove();
      this.sessionBreakSvg = null;
    }
    this.highLowLines = [];
    for (const e of this.studyEntries.values()) e.layer?.destroy();
    this.studyEntries.clear();
    try {
      this.paneObserver?.disconnect();
      this.chrome?.destroy();
      this.mainChart.remove();
    } catch {
      // ignore
    }
    this.rawCandles = [];
    this.quickSeriesMap.clear();
    this.scriptOverlaySeries = [];
    this.scriptSubSeries = [];
    this.scriptPriceLines = [];
    this.compareSeries = null;
    this.extraCompareSeries = [];
    this.onHoverCallback = undefined;
    this.onViewportChangeCallback = undefined;
    this.onLoadOlderHistoryCallback = undefined;
  }
}
