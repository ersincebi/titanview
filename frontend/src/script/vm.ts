/**
 * TitanScript VM — a real bar-by-bar TitanScript interpreter.
 * Every bar the whole script is executed top-to-bottom; `var` state, series history,
 * ta.* state, user functions, loops and the strategy broker all advance one bar at a time.
 */
import { LANG_NAME } from './brand';
import type {
  Candle,
  CorporateEventsData,
  FxRatePoint,
  ScriptAlert,
  ScriptBgColor,
  ScriptColorPoint,
  ScriptDrawingsData,
  ScriptFill,
  ScriptFillRef,
  ScriptLineFillObj,
  ScriptLineObj,
  ScriptLineStyle,
  ScriptLogEntry,
  ScriptOhlcPlot,
  ScriptPolylineObj,
  ScriptTableObj,
  ScriptHLine,
  ScriptInputDef,
  ScriptMarker,
  ScriptPlotPoint,
  ScriptPlotSeries,
  BacktestReport,
} from '../types/market';
import {
  dottedNameOf,
  type Expression,
  type ForInStatement,
  type ForStatement,
  type FunctionCall,
  type FunctionDefStmt,
  type IfStatement,
  type MemberAssignStmt,
  type Program,
  type Statement,
  type SwitchStatement,
  type TypeDefStmt,
  type WhileStatement,
} from './ast';
import { Broker, type BrokerConfig, type CommissionType, type QtyType } from './broker';
import { MAP_SIGS, MATRIX_SIGS } from './collections';
import {
  NOT_HANDLED,
  calendarBucket,
  datePartsForTz,
  inSession,
  formatString,
  libCall,
  parseTimeframeSeconds,
  parseTimestampArgs,
  timeField,
  timeframeFromSeconds,
} from './lib';
import { scriptTimeframeToApi, type LibraryModule } from './libraries';
import { beginTaRun, endTaRun } from './wasmCore';
import { TA_DEFAULT_SRC, TA_FACTORIES, TA_SIGS, type BarCtx, type Stepper, type TaEnv } from './ta';
import { typeCheckProgram, type TypeCheckResult } from './typecheck';
import {
  SCRIPT_COLORS,
  ScriptArray,
  ScriptEnumValue,
  ScriptMap,
  ScriptMatrix,
  ScriptObject,
  ScriptRuntimeError,
  colorNew,
  isHandle,
  isNa,
  isTruthy,
  makeHandle,
  snapshotValue,
  toNum,
  tostring,
  type ScriptHandle,
} from './values';

// ---------------------------------------------------------------- public types

export interface RunOptions {
  symbol?: string;
  /** TitanScript timeframe string of the chart ("15", "60", "D") */
  timeframe?: string;
  mintick?: number;
  /** override input values by input id or title */
  inputOverrides?: Record<string, unknown>;
  /** Optional realtime intrabar updates for the last bar (`var` rolls back, `varip` persists). */
  intrabarUpdates?: Partial<Candle>[];
  /** Local library registry (from `/api/scripts` or test fixtures), keyed by path/name -> TitanScript source. */
  libraries?: Record<string, string>;
  /** Real lower-timeframe candles for `request.security_lower_tf`, keyed by `"TF"` or `"SYMBOL|TF"`. */
  lowerTfCandles?: Record<string, Candle[]>;
  /** Real Yahoo corporate events (dividends/splits/earnings) keyed by symbol. */
  corporateEvents?: Record<string, CorporateEventsData>;
  /** Real Yahoo daily FX rates keyed by `"FROM/TO"` (e.g. `"EUR/USD"`). */
  currencyRates?: Record<string, FxRatePoint[]>;
  /**
   * Faz 20 gösterge üstüne gösterge: `input.source` geçersiz kılması `"@<anahtar>"` ise bu diziden okunur.
   * Dizi grafik barlarıyla aynı uzunluktadır (bar indeksi hizalı, eksik = NaN).
   */
  externalSources?: Record<string, number[]>;
  /** Faz 24 bar büyüteci: strateji dolumlarını çözmek için gerçek alt zaman dilimi mumları (saniye cinsinden zaman, artan). */
  magnifierCandles?: Candle[];
  /** Faz 20: başka sembolün gerçek mumları (`request.security("XU100.IS", …)`), anahtar sembol (önek yok). */
  symbolCandles?: Record<string, Candle[]>;
}

export interface VmResult {
  scriptTitle: string;
  isStrategy: boolean;
  isOverlay: boolean;
  isLibrary: boolean;
  plots: ScriptPlotSeries[];
  markers: ScriptMarker[];
  hlines: ScriptHLine[];
  bgcolors: ScriptBgColor[];
  barcolors: ScriptColorPoint[];
  fills: ScriptFill[];
  ohlcPlots: ScriptOhlcPlot[];
  backtest?: BacktestReport;
  warnings: string[];
  inputs: ScriptInputDef[];
  alerts: ScriptAlert[];
  alertConditions: { title: string; message: string }[];
  logs: ScriptLogEntry[];
  drawings: ScriptDrawingsData;
  /** `request.security` başka sembol istedi ama `symbolCandles` içinde yok: çağıran çekip yeniden çalıştırır. */
  missingSymbols?: string[];
  /** `request.security_lower_tf` için `lowerTfCandles` içinde olmayan Betik zaman dilimleri */
  missingLowerTfs?: string[];
}

interface LibRuntimeCtx {
  mod: LibraryModule;
  consts: Map<string, any>;
  enums: Map<string, Map<string, ScriptEnumValue>>;
  types: Map<string, TypeDefStmt>;
  functions: Map<string, FunctionDefStmt>;
  methods: Map<string, FunctionDefStmt[]>;
  nestedLibs: Map<string, LibRuntimeCtx>;
}

// ---------------------------------------------------------------- internals

class Cell {
  value: any = NaN;
  hist: any[] = [];
  touched = false;
  initialized = false;
  isVar = false;
  isVarip = false;
}

class Scope {
  vars = new Map<string, Cell>();
  constructor(readonly parent: Scope | null) {}
  lookup(name: string): Cell | undefined {
    let s: Scope | null = this;
    while (s) {
      const c = s.vars.get(name);
      if (c) return c;
      s = s.parent;
    }
    return undefined;
  }
}

type Ctl = 'break' | 'continue' | undefined;

interface PlotAcc {
  title: string;
  color: string;
  lineWidth: number;
  style: ScriptPlotSeries['style'];
  overlay: boolean;
  data: ScriptPlotPoint[];
  colorful: boolean;
  hidden: boolean;
  lineStyle?: ScriptLineStyle;
}

interface FillAcc {
  title: string;
  a: string | number;
  b: string | number;
  overlay: boolean;
  map: Map<number, string>;
}

interface OhlcAcc {
  title: string;
  kind: 'candle' | 'bar';
  overlay: boolean;
  data: ScriptOhlcPlot['data'];
}


interface SecEntry {
  bucketOf: number[];
  res: any[];
}

const CONSTANTS: Record<string, any> = {
  'strategy.long': 'strategy.long',
  'strategy.short': 'strategy.short',
  'strategy.direction.long': 'strategy.direction.long',
  'strategy.direction.short': 'strategy.direction.short',
  'strategy.direction.all': 'strategy.direction.all',
  'strategy.fixed': 'strategy.fixed',
  'strategy.cash': 'strategy.cash',
  'strategy.percent_of_equity': 'strategy.percent_of_equity',
  'strategy.commission.percent': 'strategy.commission.percent',
  'strategy.commission.cash_per_order': 'strategy.commission.cash_per_order',
  'strategy.commission.cash_per_contract': 'strategy.commission.cash_per_contract',
  'strategy.oca.none': 'none',
  'strategy.oca.cancel': 'cancel',
  'strategy.oca.reduce': 'reduce',
  'display.none': 0,
  'display.pane': 1,
  'display.data_window': 2,
  'display.status_line': 4,
  'display.price_scale': 8,
  'display.all': 15,
  'math.pi': Math.PI,
  'math.e': Math.E,
  'math.phi': 1.618033988749895,
  'math.rphi': 0.6180339887498949,
  'plot.style_line': 'line',
  'plot.style_linebr': 'line',
  'plot.style_stepline': 'stepline',
  'plot.style_stepline_diamond': 'stepline',
  'plot.style_histogram': 'histogram',
  'plot.style_columns': 'histogram',
  'plot.style_area': 'area',
  'plot.style_areabr': 'area',
  'plot.style_circles': 'circles',
  'plot.style_cross': 'cross',
  'hline.style_solid': 'solid',
  'hline.style_dashed': 'dashed',
  'hline.style_dotted': 'dotted',
  'line.style_solid': 'solid',
  'line.style_dashed': 'dashed',
  'line.style_dotted': 'dotted',
  'line.style_arrow_left': 'arrow_left',
  'line.style_arrow_right': 'arrow_right',
  'line.style_arrow_both': 'arrow_both',
  'extend.none': 'none',
  'extend.left': 'left',
  'extend.right': 'right',
  'extend.both': 'both',
  'xloc.bar_index': 'bar_index',
  'xloc.bar_time': 'bar_time',
  'yloc.price': 'price',
  'yloc.abovebar': 'abovebar',
  'yloc.belowbar': 'belowbar',
  'format.mintick': 'format.mintick',
  'format.price': 'format.price',
  'format.percent': 'format.percent',
  'format.volume': 'format.volume',
  'format.inherit': 'format.inherit',
  'barmerge.lookahead_on': true,
  'barmerge.lookahead_off': false,
  'barmerge.gaps_on': true,
  'barmerge.gaps_off': false,
  'alert.freq_once_per_bar': 'once_per_bar',
  'alert.freq_once_per_bar_close': 'once_per_bar_close',
  'alert.freq_all': 'all',
  'order.ascending': 'order.ascending',
  'order.descending': 'order.descending',
  'text.align_left': 'left',
  'text.align_center': 'center',
  'text.align_right': 'right',
  'position.top_left': 'top_left',
  'position.top_center': 'top_center',
  'position.top_right': 'top_right',
  'position.middle_left': 'middle_left',
  'position.middle_center': 'middle_center',
  'position.middle_right': 'middle_right',
  'position.bottom_left': 'bottom_left',
  'position.bottom_center': 'bottom_center',
  'position.bottom_right': 'bottom_right',
  'dayofweek.sunday': 1,
  'dayofweek.monday': 2,
  'dayofweek.tuesday': 3,
  'dayofweek.wednesday': 4,
  'dayofweek.thursday': 5,
  'dayofweek.friday': 6,
  'dayofweek.saturday': 7,
  'chart.bg_color': '#131722',
  'chart.fg_color': '#B2B5BE',
  'dividends.gross': 'gross',
  'dividends.net': 'net',
  'splits.numerator': 'numerator',
  'splits.denominator': 'denominator',
  'earnings.actual': 'actual',
  'earnings.estimate': 'estimate',
  'earnings.standardized': 'standardized',
  'currency.USD': 'USD',
  'currency.EUR': 'EUR',
  'currency.TRY': 'TRY',
  'currency.GBP': 'GBP',
  'currency.JPY': 'JPY',
  'currency.CHF': 'CHF',
  'currency.AUD': 'AUD',
  'currency.CAD': 'CAD',
  'currency.BTC': 'BTC',
  'currency.ETH': 'ETH',
  'currency.USDT': 'USDT',
  'currency.NONE': '',
};

for (const [name, hex] of Object.entries(SCRIPT_COLORS)) CONSTANTS[`color.${name}`] = hex;
for (const s of ['tiny', 'small', 'normal', 'large', 'huge', 'auto']) CONSTANTS[`size.${s}`] = s;
for (const s of ['abovebar', 'belowbar', 'top', 'bottom', 'absolute']) CONSTANTS[`location.${s}`] = s;
for (const s of [
  'xcross', 'cross', 'triangleup', 'triangledown', 'flag', 'circle', 'arrowup', 'arrowdown',
  'labelup', 'labeldown', 'square', 'diamond',
]) CONSTANTS[`shape.${s}`] = s;
for (const s of [
  'none', 'xcross', 'cross', 'triangleup', 'triangledown', 'flag', 'circle', 'arrowup', 'arrowdown',
  'label_up', 'label_down', 'label_left', 'label_right', 'label_center', 'label_lower_left',
  'label_lower_right', 'label_upper_left', 'label_upper_right', 'square', 'diamond',
]) CONSTANTS[`label.style_${s}`] = s;

const DRAWING_NS = new Set(['line', 'box', 'label', 'table', 'linefill', 'polyline']);
const NA_FUNCS = new Set(['max_bars_back']);
const BUILTIN_TA_SERIES = new Set(['obv', 'pvt', 'accdist', 'iii', 'nvi', 'pvi', 'wad', 'wvad']);
const BUILTIN_NS = new Set([
  'ta', 'math', 'str', 'array', 'map', 'matrix', 'color', 'input',
  'strategy', 'syminfo', 'barstate', 'timeframe', 'request', 'ticker',
  'line', 'box', 'label', 'table', 'linefill', 'polyline',
  'plot', 'hline', 'shape', 'location', 'size', 'display', 'extend',
  'xloc', 'yloc', 'format', 'barmerge', 'alert', 'order', 'text',
  'position', 'dayofweek', 'chart', 'runtime', 'log',
  'dividends', 'splits', 'earnings', 'currency',
]);
const SOURCE_NAMES = new Set(['open', 'high', 'low', 'close', 'hl2', 'hlc3', 'ohlc4', 'hlcc4', 'volume']);
const MAX_LOGS = 2000;

function isPlainNumber(v: unknown): v is number {
  return typeof v === 'number' && !Number.isNaN(v);
}

// ---------------------------------------------------------------- VM

export class ScriptVM {
  private n: number;
  private b = 0;
  private ops = 0;

  private nodeIds = new WeakMap<object, number>();
  private nextId = 1;
  private cellStore = new Map<object, Map<string, Cell>>();
  private allCells: Cell[] = [];
  private stateStore = new Map<object, Map<string, any>>();
  private nodeHist = new Map<object, Map<string, any[]>>();
  private stack = '';
  private userFns = new Map<string, FunctionDefStmt>();
  private userMethods = new Map<string, FunctionDefStmt[]>();
  private udts = new Map<string, TypeDefStmt>();
  private enums = new Map<string, Map<string, ScriptEnumValue>>();
  private libContexts = new Map<string, LibRuntimeCtx>();
  private importedMethods = new Map<string, Array<{ ctx: LibRuntimeCtx; fn: FunctionDefStmt }>>();
  private activeLib: LibRuntimeCtx | null = null;
  private tc: TypeCheckResult | null = null;
  private lastVal: any = null;
  private lastValSet = false;
  private isRealtimeTick = false;
  private isConfirmedTick = true;
  private isNewTick = true;

  private broker: Broker | null = null;
  private brokerHist = { position_size: [] as number[], equity: [] as number[], netprofit: [] as number[] };

  private scriptTitle = `Custom ${LANG_NAME}`;
  private isStrategy = false;
  private isOverlay = false;
  private isLibrary = false;
  private version = 5;

  private maxLinesCount = 50;
  private maxBoxesCount = 50;
  private maxLabelsCount = 50;
  private maxPolylinesCount = 50;

  private plots = new Map<string, PlotAcc>();
  private markers: ScriptMarker[] = recordArray();
  private hlines: ScriptHLine[] = [];
  private warnings = new Set<string>();
  private inputs: ScriptInputDef[] = [];
  private inputSeen = new Map<object, ScriptInputDef>();
  private alerts: ScriptAlert[] = [];
  /** Faz 23: betikte bildirilen tüm alertcondition() başlıkları (koşul yanlış olsa da) */
  private alertConditions = new Map<string, { title: string; message: string }>();
  private logs: ScriptLogEntry[] = [];
  private bgAcc = new Map<string, { title: string; overlay: boolean; map: Map<number, string> }>();
  private barColorMap = new Map<number, string>();
  private fillAcc = new Map<string, FillAcc>();
  private ohlcAcc = new Map<string, OhlcAcc>();
  private tableHandles: ScriptHandle[] = [];
  private labelHandles: ScriptHandle[] = [];
  private lineHandles: ScriptHandle[] = [];
  private boxHandles: ScriptHandle[] = [];
  private linefillHandles: ScriptHandle[] = [];
  private polylineHandles: ScriptHandle[] = [];
  private builtinTaSeries = new Map<string, { stepper: Stepper; values: number[]; ctx: BarCtx }>();
  private ltfCache = new Map<object, Map<string, any[][]>>();
  private eventCache = new Map<object, Map<string, number[]>>();

  private timeframe: string;
  private tfSeconds: number;
  private mintick: number;
  private symbol: string;

  private hlc3: number[] = [];
  private topScope = new Scope(null);
  private readonly barCtx: BarCtx;
  private env: TaEnv = { bar: () => this.barCtx };

  constructor(
    private readonly program: Program,
    private candles: Candle[],
    private readonly opts: RunOptions = {},
    private readonly isChild = false,
    parentTc: TypeCheckResult | null = null
  ) {
    this.n = candles.length;
    this.version = program.version ?? 5;
    this.symbol = opts.symbol ?? 'SYMBOL';
    this.mintick = opts.mintick ?? 0.01;
    this.tfSeconds = this.inferTfSeconds();
    this.timeframe = opts.timeframe ?? timeframeFromSeconds(this.tfSeconds);
    this.barCtx = { open: NaN, high: NaN, low: NaN, close: NaN, volume: NaN, time: NaN, index: 0 };
    this.tc = parentTc;
  }

  private inferTfSeconds(): number {
    if (this.opts.timeframe) {
      const s = parseTimeframeSeconds(this.opts.timeframe);
      if (Number.isFinite(s)) return s;
    }
    if (this.n < 2) return 86400;
    const diffs: number[] = [];
    for (let i = 1; i < Math.min(this.n, 50); i++) diffs.push(this.candles[i].time - this.candles[i - 1].time);
    diffs.sort((a, b) => a - b);
    return diffs[Math.floor(diffs.length / 2)] || 86400;
  }

  // ------------------------------------------------------------ run

  run(): VmResult {
    if (!this.isChild && !this.tc) {
      this.tc = typeCheckProgram(this.program, this.opts.libraries);
    }
    this.prepass();
    const updates = !this.isChild ? this.opts.intrabarUpdates : undefined;
    if (updates && updates.length > 0 && this.n > 0) {
      for (let b = 0; b < this.n - 1; b++) this.runBar(b);
      this.runRealtimeLastBar(updates);
    } else {
      for (let b = 0; b < this.n; b++) this.runBar(b);
    }
    return this.finish();
  }

  // ------------------------------------------------------------ Faz 30: artımlı oturum

  /** Oturum başlatır: tip denetimi + ön geçiş, ardından [0, upto) kapanmış barları koşar. */
  runConfirmed(upto: number): void {
    if (!this.isChild && !this.tc) this.tc = typeCheckProgram(this.program, this.opts.libraries);
    this.prepass();
    for (let b = 0; b < Math.min(upto, this.n); b++) this.runBar(b);
  }

  /**
   * Bu VM'nin bağımsız bir kopyasını üretir (kapanmış durum korunur). `ta.*` adımlayıcıları çağrı kaydından
   * yeniden oynatılır; kopyalanamayan bir durum varsa `NotForkableError` fırlatılır (çağıran tam koşuya düşer).
   */
  fork(candles: Candle[], atoms: Set<object>): ScriptVM {
    return forkVm(this, candles, atoms);
  }

  /** Son barı (b = n-1) tarihsel bar olarak koşup sonucu döndürür (tam koşunun son adımıyla birebir). */
  runLastAndFinish(): VmResult {
    if (this.n > 0) this.runBar(this.n - 1);
    return this.finish();
  }

  /** @internal forkVm için */
  _forkFields(): Record<string, unknown> {
    return this as unknown as Record<string, unknown>;
  }

  private initLibContext(mod: LibraryModule): LibRuntimeCtx {
    const nestedLibs = new Map<string, LibRuntimeCtx>();
    for (const [subAlias, subMod] of mod.imports) {
      nestedLibs.set(subAlias, this.initLibContext(subMod));
    }
    const enums = new Map<string, Map<string, ScriptEnumValue>>();
    for (const [ename, en] of mod.allEnums) {
      const members = new Map<string, ScriptEnumValue>();
      const qualifiedEnumName = mod.exportedEnums.has(ename) ? `${mod.alias}.${ename}` : ename;
      for (const f of en.fields) {
        members.set(f.name, new ScriptEnumValue(qualifiedEnumName, f.name, f.title ?? f.name));
      }
      enums.set(ename, members);
    }
    const ctx: LibRuntimeCtx = {
      mod,
      consts: new Map(),
      enums,
      types: new Map(mod.allTypes),
      functions: new Map(mod.allFunctions),
      methods: new Map(mod.allMethods),
      nestedLibs,
    };
    // Evaluate library const declarations once in the library's own context
    const prevLib = this.activeLib;
    this.activeLib = ctx;
    const libScope = new Scope(null);
    try {
      for (const ls of mod.program.statements) {
        if (ls.type === 'VarAssign' && !ls.isReassign) {
          const val = this.eval(ls.value, libScope);
          ctx.consts.set(ls.name, val);
          const cell = new Cell();
          cell.value = val;
          cell.touched = true;
          libScope.vars.set(ls.name, cell);
        }
      }
    } finally {
      this.activeLib = prevLib;
    }
    return ctx;
  }

  private prepass(): void {
    // Initialize imported libraries first
    if (this.tc?.libraries) {
      for (const [alias, mod] of this.tc.libraries) {
        const ctx = this.initLibContext(mod);
        this.libContexts.set(alias, ctx);
        for (const [tname, td] of mod.exportedTypes) {
          this.udts.set(`${alias}.${tname}`, td);
        }
        for (const [ename] of mod.exportedEnums) {
          const members = ctx.enums.get(ename);
          if (members) this.enums.set(`${alias}.${ename}`, members);
        }
        for (const [mname, list] of mod.exportedMethods) {
          const dest = this.importedMethods.get(mname) ?? [];
          for (const fn of list) dest.push({ ctx, fn });
          this.importedMethods.set(mname, dest);
        }
      }
    }

    for (const s of this.program.statements) {
      if (s.type === 'TypeDef') {
        this.udts.set(s.name, s);
      } else if (s.type === 'EnumDef') {
        const members = new Map<string, ScriptEnumValue>();
        for (const f of s.fields) {
          members.set(f.name, new ScriptEnumValue(s.name, f.name, f.title ?? f.name));
        }
        this.enums.set(s.name, members);
      } else if (s.type === 'FunctionDef') {
        if (s.isMethod) {
          const list = this.userMethods.get(s.name) ?? [];
          list.push(s);
          this.userMethods.set(s.name, list);
        } else {
          this.userFns.set(s.name, s);
        }
      } else if (s.type === 'Declaration') {
        this.scriptTitle =
          s.title ||
          (s.kind === 'strategy'
            ? 'Custom Strategy'
            : s.kind === 'library'
              ? 'CustomLibrary'
              : 'Custom Indicator');
        this.isStrategy = s.kind === 'strategy';
        this.isLibrary = s.kind === 'library';
        this.isOverlay = s.options['overlay'] === true;
        if (isPlainNumber(s.options['max_lines_count'])) {
          this.maxLinesCount = Math.max(1, Math.min(500, Math.round(s.options['max_lines_count'])));
        }
        if (isPlainNumber(s.options['max_boxes_count'])) {
          this.maxBoxesCount = Math.max(1, Math.min(500, Math.round(s.options['max_boxes_count'])));
        }
        if (isPlainNumber(s.options['max_labels_count'])) {
          this.maxLabelsCount = Math.max(1, Math.min(500, Math.round(s.options['max_labels_count'])));
        }
        if (isPlainNumber(s.options['max_polylines_count'])) {
          this.maxPolylinesCount = Math.max(1, Math.min(100, Math.round(s.options['max_polylines_count'])));
        }
        if (this.isStrategy && !this.isChild) this.broker = new Broker(this.brokerConfig(s.options));
      }
    }
  }

  private brokerConfig(o: Record<string, any>): Partial<BrokerConfig> {
    const last = (v: unknown) => (typeof v === 'string' ? v.split('.').pop() ?? '' : '');
    const qtyType = last(o['default_qty_type']) as QtyType;
    const comType = last(o['commission_type']);
    const cfg: Partial<BrokerConfig> = { mintick: this.mintick };
    if (isPlainNumber(o['initial_capital'])) cfg.initialCapital = o['initial_capital'];
    if (isPlainNumber(o['commission_value'])) cfg.commissionValue = o['commission_value'];
    if (comType === 'cash_per_order' || comType === 'cash_per_contract' || comType === 'percent') {
      cfg.commissionType = comType as CommissionType;
    }
    if (isPlainNumber(o['pyramiding'])) cfg.pyramiding = Math.max(1, o['pyramiding']);
    if (qtyType === 'fixed' || qtyType === 'cash' || qtyType === 'percent_of_equity') cfg.defaultQtyType = qtyType;
    if (isPlainNumber(o['default_qty_value'])) cfg.defaultQtyValue = o['default_qty_value'];
    if (o['process_orders_on_close'] === true) cfg.processOrdersOnClose = true;
    return cfg;
  }

  private magPtr = 0;

  /** Bar büyüteci: ana bar aralığına düşen alt mumlar (bar sırası artan çağrılır). */
  private subBarsFor(b: number): Candle[] | undefined {
    const mag = this.opts.magnifierCandles;
    if (!mag || mag.length === 0 || this.isChild) return undefined;
    const t0 = this.candles[b].time;
    const next = this.candles[b + 1]?.time ?? t0 + (b > 0 ? t0 - this.candles[b - 1].time : 0);
    if (b === 0) this.magPtr = 0;
    while (this.magPtr < mag.length && mag[this.magPtr].time < t0) this.magPtr++;
    let j = this.magPtr;
    while (j < mag.length && mag[j].time < next) j++;
    return j > this.magPtr ? mag.slice(this.magPtr, j) : undefined;
  }

  private runBar(b: number): void {
    this.b = b;
    this.isRealtimeTick = false;
    this.isConfirmedTick = true;
    this.isNewTick = true;
    const c = this.candles[b];
    const bc = this.barCtx;
    bc.open = c.open;
    bc.high = c.high;
    bc.low = c.low;
    bc.close = c.close;
    bc.volume = c.volume;
    bc.time = c.time * 1000;
    bc.index = b;

    const brokerBar = { open: c.open, high: c.high, low: c.low, close: c.close, time: c.time, index: b };
    this.broker?.beginBar(brokerBar, this.subBarsFor(b));
    for (const cell of this.allCells) cell.touched = false;

    this.stack = '';
    const scope = new Scope(null);
    this.topScope = scope;
    for (const stmt of this.program.statements) {
      this.execStmt(stmt, scope);
    }

    this.broker?.endBar(brokerBar);
    if (this.broker) {
      this.brokerHist.position_size.push(this.broker.positionSize);
      this.brokerHist.equity.push(this.broker.equity);
      this.brokerHist.netprofit.push(this.broker.netProfit);
    }
    for (const cell of this.allCells) {
      cell.hist.push(cell.touched || cell.isVar ? cell.value : NaN);
    }
  }

  /**
   * Simulates TitanScript realtime intrabar updates on the final bar:
   * before each subsequent intrabar tick, `var` (non-`varip`) cells roll back to their
   * pre-bar confirmed state, whereas `varip` cells preserve every intrabar mutation.
   */
  private runRealtimeLastBar(updates: Partial<Candle>[]): void {
    const b = this.n - 1;
    this.b = b;
    const base = this.candles[b];
    // Snapshot all existing non-varip cells before the realtime bar begins
    const snap = new Map<Cell, { value: any; initialized: boolean }>();
    for (const cell of this.allCells) {
      if (!cell.isVarip) {
        snap.set(cell, { value: snapshotValue(cell.value), initialized: cell.initialized });
      }
    }
    const preBarCells = new Set<Cell>(this.allCells);

    let live: Candle = { ...base };
    for (let t = 0; t < updates.length; t++) {
      // Roll back non-varip cells on ticks after the first
      if (t > 0) {
        for (const cell of this.allCells) {
          if (cell.isVarip) continue;
          const s = snap.get(cell);
          if (s) {
            cell.value = snapshotValue(s.value);
            cell.initialized = s.initialized;
          } else if (!preBarCells.has(cell)) {
            cell.value = NaN;
            cell.initialized = false;
          }
        }
      }
      live = { ...live, ...updates[t] };
      this.isRealtimeTick = true;
      this.isNewTick = t === 0;
      this.isConfirmedTick = t === updates.length - 1;
      const bc = this.barCtx;
      bc.open = live.open;
      bc.high = live.high;
      bc.low = live.low;
      bc.close = live.close;
      bc.volume = live.volume;
      bc.time = live.time * 1000;
      bc.index = b;

      for (const cell of this.allCells) cell.touched = false;
      this.stack = '';
      const scope = new Scope(null);
      this.topScope = scope;
      for (const stmt of this.program.statements) {
        this.execStmt(stmt, scope);
      }
    }

    const brokerBar = { open: live.open, high: live.high, low: live.low, close: live.close, time: live.time, index: b };
    this.broker?.beginBar(brokerBar);
    this.broker?.endBar(brokerBar);
    if (this.broker) {
      this.brokerHist.position_size.push(this.broker.positionSize);
      this.brokerHist.equity.push(this.broker.equity);
      this.brokerHist.netprofit.push(this.broker.netProfit);
    }
    for (const cell of this.allCells) {
      cell.hist.push(cell.touched || cell.isVar ? cell.value : NaN);
    }
    this.isRealtimeTick = false;
    this.isConfirmedTick = true;
    this.isNewTick = true;
  }

  private finish(): VmResult {
    const plots: ScriptPlotSeries[] = [];
    const idOf = new Map<string, string>();
    const refd = new Set<string>();
    for (const f of this.fillAcc.values()) {
      if (typeof f.a === 'string') refd.add(f.a);
      if (typeof f.b === 'string') refd.add(f.b);
    }
    let i = 0;
    for (const [key, acc] of this.plots) {
      if (acc.hidden && !refd.has(key)) continue; // display.none plots only survive as fill() sources
      i++;
      const id = `script_plot_${i}`;
      idOf.set(key, id);
      plots.push({
        id,
        title: acc.title,
        color: acc.color,
        lineWidth: acc.lineWidth,
        style: acc.style,
        isOverlay: acc.overlay,
        data: acc.data,
        ...(acc.lineStyle ? { lineStyle: acc.lineStyle } : {}),
        ...(acc.hidden ? { hidden: true } : {}),
      });
    }
    const markers = [...this.markers];
    let backtest: BacktestReport | undefined;
    if (this.broker) {
      const built = this.broker.buildReport();
      backtest = built.report;
      markers.push(...built.markers);
    }
    markers.sort((a, b) => a.time - b.time);

    const toPoints = (m: Map<number, string>): ScriptColorPoint[] =>
      [...m.entries()].sort((a, b) => a[0] - b[0]).map(([time, color]) => ({ time, color }));
    const bgcolors: ScriptBgColor[] = [...this.bgAcc.values()].map((b) => ({
      title: b.title,
      isOverlay: b.overlay,
      points: toPoints(b.map),
    }));
    const fills: ScriptFill[] = [];
    for (const f of this.fillAcc.values()) {
      const ref = (v: string | number): ScriptFillRef | null =>
        typeof v === 'number' ? { price: v } : idOf.has(v) ? { plot: idOf.get(v)! } : null;
      const a = ref(f.a);
      const b = ref(f.b);
      if (!a || !b) continue;
      fills.push({ title: f.title, a, b, isOverlay: f.overlay, points: toPoints(f.map) });
    }
    const ohlcPlots: ScriptOhlcPlot[] = [...this.ohlcAcc.values()].map((o, k) => ({
      id: `script_ohlc_${k + 1}`,
      title: o.title,
      kind: o.kind,
      isOverlay: o.overlay,
      data: o.data,
    }));

    return {
      scriptTitle: this.scriptTitle,
      isStrategy: this.isStrategy,
      isOverlay: this.isOverlay,
      isLibrary: this.isLibrary,
      plots,
      markers,
      hlines: this.hlines,
      bgcolors,
      barcolors: toPoints(this.barColorMap),
      fills,
      ohlcPlots,
      backtest,
      warnings: [...this.warnings],
      inputs: this.inputs,
      alerts: this.alerts,
      alertConditions: [...this.alertConditions.values()],
      logs: this.logs,
      drawings: this.buildDrawings(),
      ...(this.missingSymbols.size > 0 ? { missingSymbols: [...this.missingSymbols] } : {}),
      ...(this.missingLowerTfs.size > 0 ? { missingLowerTfs: [...this.missingLowerTfs] } : {}),
    };
  }

  // ------------------------------------------------------------ node-keyed storage

  private id(node: object): number {
    let v = this.nodeIds.get(node);
    if (v === undefined) {
      v = this.nextId++;
      this.nodeIds.set(node, v);
    }
    return v;
  }

  private cellFor(node: object, isVar = false, isVarip = false): Cell {
    let m = this.cellStore.get(node);
    if (!m) {
      m = new Map();
      this.cellStore.set(node, m);
    }
    let c = m.get(this.stack);
    if (!c) {
      c = new Cell();
      c.isVar = isVar;
      c.isVarip = isVarip;
      for (let i = 0; i < this.b; i++) c.hist.push(NaN);
      m.set(this.stack, c);
      this.allCells.push(c);
    }
    return c;
  }

  private stateFor<T>(node: object, init: () => T): T {
    let m = this.stateStore.get(node);
    if (!m) {
      m = new Map();
      this.stateStore.set(node, m);
    }
    let s = m.get(this.stack);
    if (s === undefined) {
      s = init();
      m.set(this.stack, s);
    }
    return s as T;
  }

  private warn(msg: string): void {
    this.warnings.add(msg);
  }

  private err(node: { loc: { line: number } } | null, msg: string): never {
    throw new ScriptRuntimeError(node?.loc.line ?? 0, msg);
  }

  private tick(node: { loc: { line: number } }): void {
    if (++this.ops > 4_000_000 + 4000 * this.n) this.err(node, 'Betik çok uzun sürdü (işlem sınırı aşıldı); sonsuz döngü olabilir.');
  }

  // ------------------------------------------------------------ statements

  private execBlock(stmts: Statement[], parent: Scope): Ctl {
    const scope = new Scope(parent);
    this.lastVal = null;
    this.lastValSet = false;
    for (const s of stmts) {
      const ctl = this.execStmt(s, scope);
      if (ctl) return ctl;
    }
    return undefined;
  }

  private execStmt(stmt: Statement, scope: Scope): Ctl {
    switch (stmt.type) {
      case 'Declaration': {
        if (this.b === 0 && stmt.args.length > 0) {
          const titleArg = stmt.args.find((a) => a.name === 'title') ?? (!stmt.args[0].name ? stmt.args[0] : undefined);
          if (titleArg) {
            const tv = this.eval(titleArg.value, scope);
            if (typeof tv === 'string' && tv) this.scriptTitle = tv;
          }
          const ovArg = stmt.args.find((a) => a.name === 'overlay');
          if (ovArg) {
            const ov = this.eval(ovArg.value, scope);
            if (typeof ov === 'boolean') this.isOverlay = ov;
          }
        }
        return undefined;
      }
      case 'Import':
      case 'FunctionDef':
      case 'TypeDef':
      case 'EnumDef':
        return undefined;

      case 'VarAssign': {
        let value: any;
        let cell: Cell;
        if (stmt.isVar && !stmt.isReassign) {
          cell = this.cellFor(stmt, true, Boolean(stmt.isVarip));
          if (!cell.initialized) {
            cell.value = this.eval(stmt.value, scope);
            cell.initialized = true;
          }
          cell.touched = true;
          scope.vars.set(stmt.name, cell);
          this.lastVal = cell.value;
          this.lastValSet = true;
          return undefined;
        }
        value = this.eval(stmt.value, scope);
        if (stmt.isReassign) {
          const existing = scope.lookup(stmt.name);
          if (!existing) this.err(stmt, `'${stmt.name}' tanımlanmadan ':=' ile atandı.`);
          existing.value = value;
          existing.touched = true;
        } else {
          cell = this.cellFor(stmt);
          cell.value = value;
          cell.touched = true;
          scope.vars.set(stmt.name, cell);
        }
        this.lastVal = value;
        this.lastValSet = true;
        return undefined;
      }

      case 'MemberAssign':
        return this.execMemberAssign(stmt, scope);

      case 'TupleAssign': {
        const tuple = this.eval(stmt.value, scope);
        if (!Array.isArray(tuple)) this.err(stmt, 'Tuple ataması için çok değerli bir ifade bekleniyor.');
        if (tuple.length < stmt.names.length) {
          this.err(stmt, `Tuple ataması ${stmt.names.length} değer bekliyor, ${tuple.length} döndü.`);
        }
        stmt.names.forEach((name, i) => {
          if (stmt.isReassign) {
            const ex = scope.lookup(name);
            if (!ex) this.err(stmt, `'${name}' tanımlanmadan ':=' ile atandı.`);
            ex.value = tuple[i];
            ex.touched = true;
          } else {
            const key = this.tupleKey(stmt, i);
            const cell = this.cellFor(key);
            cell.value = tuple[i];
            cell.touched = true;
            scope.vars.set(name, cell);
          }
        });
        this.lastVal = tuple;
        this.lastValSet = true;
        return undefined;
      }

      case 'IfStatement':
        return this.execIf(stmt, scope);

      case 'ForStatement':
        return this.execFor(stmt, scope);

      case 'ForInStatement':
        return this.execForIn(stmt, scope);

      case 'WhileStatement':
        return this.execWhile(stmt, scope);

      case 'SwitchStatement':
        return this.execSwitch(stmt, scope);

      case 'BreakStmt':
        return 'break';

      case 'ContinueStmt':
        return 'continue';

      case 'ExpressionStmt':
        this.lastVal = this.eval(stmt.expr, scope);
        this.lastValSet = true;
        return undefined;
    }
  }

  private execMemberAssign(stmt: MemberAssignStmt, scope: Scope): Ctl {
    const obj = this.eval(stmt.object, scope);
    if (isNa(obj)) {
      this.err(stmt, `Cannot access the '${stmt.property}' field of an undefined object. The object is na.`);
    }
    if (!(obj instanceof ScriptObject)) {
      this.err(stmt, `Nesne olmayan bir değerin '${stmt.property}' alanına atama yapılamaz.`);
    }
    if (!(stmt.property in obj.fields)) {
      this.err(stmt, `The '${obj.typeName}' type does not have a field named '${stmt.property}'.`);
    }
    const rhs = this.eval(stmt.value, scope);
    const next = stmt.operator ? this.applyBinOp(stmt.operator, obj.fields[stmt.property], rhs, stmt) : rhs;
    obj.fields[stmt.property] = next;
    this.lastVal = next;
    this.lastValSet = true;
    return undefined;
  }

  private tupleKeys = new WeakMap<object, object[]>();
  private tupleKey(stmt: object, i: number): object {
    let keys = this.tupleKeys.get(stmt);
    if (!keys) {
      keys = [];
      this.tupleKeys.set(stmt, keys);
    }
    return (keys[i] ??= {});
  }

  private execIf(stmt: IfStatement, scope: Scope): Ctl {
    if (isTruthy(this.eval(stmt.condition, scope))) return this.execBlock(stmt.consequent, scope);
    if (stmt.alternate) return this.execBlock(stmt.alternate, scope);
    this.lastVal = null;
    return undefined;
  }

  private execSwitch(stmt: SwitchStatement, scope: Scope): Ctl {
    const subject = stmt.subject ? this.eval(stmt.subject, scope) : undefined;
    for (const c of stmt.cases) {
      let hit = false;
      if (!c.test) hit = true;
      else if (stmt.subject) hit = this.looseEq(subject, this.eval(c.test, scope));
      else hit = isTruthy(this.eval(c.test, scope));
      if (hit) return this.execBlock(c.body, scope);
    }
    this.lastVal = null;
    return undefined;
  }

  private execFor(stmt: ForStatement, scope: Scope): Ctl {
    const start = toNum(this.eval(stmt.start, scope));
    const end = toNum(this.eval(stmt.end, scope));
    let step = stmt.step ? toNum(this.eval(stmt.step, scope)) : start <= end ? 1 : -1;
    if (Number.isNaN(start) || Number.isNaN(end) || !step) {
      this.lastVal = null;
      return undefined;
    }
    if (stmt.step === undefined) step = start <= end ? 1 : -1;
    const loopScope = new Scope(scope);
    const counter = new Cell();
    loopScope.vars.set(stmt.counter, counter);
    let loopResult: any = null;
    for (let i = start; step > 0 ? i <= end : i >= end; i += step) {
      this.tick(stmt);
      counter.value = i;
      const ctl = this.execBlock(stmt.body, loopScope);
      if (this.lastValSet) loopResult = this.lastVal;
      if (ctl === 'break') break;
    }
    this.lastVal = loopResult;
    this.lastValSet = true;
    return undefined;
  }

  private execForIn(stmt: ForInStatement, scope: Scope): Ctl {
    const it = this.eval(stmt.iterable, scope);
    if (isNa(it)) this.err(stmt, "Cannot iterate over an 'na' collection in 'for...in'.");
    const loopScope = new Scope(scope);
    const cells = stmt.names.map((nm) => {
      const c = new Cell();
      loopScope.vars.set(nm, c);
      return c;
    });
    let loopResult: any = null;

    if (it instanceof ScriptArray) {
      const items = [...it.items];
      for (let i = 0; i < items.length; i++) {
        this.tick(stmt);
        if (cells.length === 1) cells[0].value = items[i];
        else {
          cells[0].value = i;
          cells[1].value = items[i];
        }
        const ctl = this.execBlock(stmt.body, loopScope);
        if (this.lastValSet) loopResult = this.lastVal;
        if (ctl === 'break') break;
      }
    } else if (it instanceof ScriptMatrix) {
      const rows = it.data.map((r) => new ScriptArray([...r], it.elemType));
      for (let i = 0; i < rows.length; i++) {
        this.tick(stmt);
        if (cells.length === 1) cells[0].value = rows[i];
        else {
          cells[0].value = i;
          cells[1].value = rows[i];
        }
        const ctl = this.execBlock(stmt.body, loopScope);
        if (this.lastValSet) loopResult = this.lastVal;
        if (ctl === 'break') break;
      }
    } else if (it instanceof ScriptMap) {
      if (cells.length !== 2) {
        this.err(stmt, `Cannot use a single loop variable with a 'map' in a 'for...in' loop; use '[key, value]' instead.`);
      }
      const entries = [...it.items.entries()];
      for (let i = 0; i < entries.length; i++) {
        this.tick(stmt);
        cells[0].value = entries[i][0];
        cells[1].value = entries[i][1];
        const ctl = this.execBlock(stmt.body, loopScope);
        if (this.lastValSet) loopResult = this.lastVal;
        if (ctl === 'break') break;
      }
    } else {
      this.err(stmt, "'for ... in' için dizi, matris veya map bekleniyor.");
    }
    this.lastVal = loopResult;
    this.lastValSet = true;
    return undefined;
  }

  private execWhile(stmt: WhileStatement, scope: Scope): Ctl {
    let loopResult: any = null;
    while (isTruthy(this.eval(stmt.condition, scope))) {
      this.tick(stmt);
      const ctl = this.execBlock(stmt.body, scope);
      if (this.lastValSet) loopResult = this.lastVal;
      if (ctl === 'break') break;
    }
    this.lastVal = loopResult;
    this.lastValSet = true;
    return undefined;
  }

  // ------------------------------------------------------------ expressions

  private looseEq(a: any, b: any): boolean {
    if (isNa(a) || isNa(b)) return false;
    return a === b;
  }

  eval(e: Expression, scope: Scope): any {
    switch (e.type) {
      case 'NumberLiteral':
      case 'StringLiteral':
      case 'BooleanLiteral':
        return e.value;

      case 'ArrayLiteral':
        return e.elements.map((x) => this.eval(x, scope));

      case 'Identifier':
        return this.evalIdent(e.name, e, scope);

      case 'MemberAccess':
        return this.evalMember(e, scope);

      case 'IndexAccess':
        return this.evalIndex(e, scope);

      case 'UnaryExpr': {
        const v = this.eval(e.argument, scope);
        if (e.operator === 'not') return !isTruthy(v);
        const x = toNum(v);
        return e.operator === '-' ? -x : x;
      }

      case 'BinaryExpr':
        return this.evalBinary(e, scope);

      case 'TernaryExpr':
        return isTruthy(this.eval(e.condition, scope))
          ? this.eval(e.consequent, scope)
          : this.eval(e.alternate, scope);

      case 'FunctionCall':
        return this.evalCall(e, scope);

      case 'BlockExpr': {
        this.lastVal = null;
        this.execStmt(e.stmt, scope);
        return this.lastVal;
      }
    }
  }

  private evalBinary(e: Extract<Expression, { type: 'BinaryExpr' }>, scope: Scope): any {
    const op = e.operator;
    if (op === 'and' || op === 'or') {
      const l = isTruthy(this.eval(e.left, scope));
      if (this.version >= 6) {
        if (op === 'and') return l ? isTruthy(this.eval(e.right, scope)) : false;
        return l ? true : isTruthy(this.eval(e.right, scope));
      }
      const r = isTruthy(this.eval(e.right, scope)); // v5: both sides always evaluated
      return op === 'and' ? l && r : l || r;
    }
    const l = this.eval(e.left, scope);
    const r = this.eval(e.right, scope);
    return this.applyBinOp(op, l, r, e);
  }

  private applyBinOp(op: string, l: any, r: any, node: { loc: { line: number } }): any {
    switch (op) {
      case '+':
        if (typeof l === 'string' || typeof r === 'string') return tostring(l) + tostring(r);
        return toNum(l) + toNum(r);
      case '-':
        return toNum(l) - toNum(r);
      case '*':
        return toNum(l) * toNum(r);
      case '/': {
        const d = toNum(r);
        return d === 0 ? NaN : toNum(l) / d;
      }
      case '%': {
        const d = toNum(r);
        return d === 0 ? NaN : toNum(l) % d;
      }
      case '==':
        return this.looseEq(l, r);
      case '!=':
        return isNa(l) || isNa(r) ? true : l !== r;
      case '<':
        return toNum(l) < toNum(r);
      case '<=':
        return toNum(l) <= toNum(r);
      case '>':
        return toNum(l) > toNum(r);
      case '>=':
        return toNum(l) >= toNum(r);
    }
    return this.err(node, `Desteklenmeyen operatör '${op}'.`);
  }

  private activeLibsMap(): Map<string, LibRuntimeCtx> {
    return this.activeLib ? this.activeLib.nestedLibs : this.libContexts;
  }

  private resolveLibCtxByMod(mod: LibraryModule): LibRuntimeCtx | undefined {
    const search = (map: Map<string, LibRuntimeCtx>): LibRuntimeCtx | undefined => {
      for (const ctx of map.values()) {
        if (ctx.mod === mod) return ctx;
        const deep = search(ctx.nestedLibs);
        if (deep) return deep;
      }
      return undefined;
    };
    return search(this.libContexts);
  }

  private evalMember(e: Extract<Expression, { type: 'MemberAccess' }>, scope: Scope): any {
    const dotted = dottedNameOf(e);
    if (dotted) {
      const parts = dotted.split('.');
      const root = parts[0];

      // 0a. Active library enum member (`EnumName.member`)
      if (this.activeLib && parts.length === 2 && !scope.lookup(root)) {
        const libEnum = this.activeLib.enums.get(root);
        if (libEnum) {
          const v = libEnum.get(parts[1]);
          if (!v) this.err(e, `The '${root}' enum does not have a field named '${parts[1]}'.`);
          return v;
        }
      }

      // 0b. Imported enum member (`alias.EnumName.member`)
      if (parts.length === 3 && !scope.lookup(root)) {
        const libs = this.activeLibsMap();
        const libCtx = libs.get(root);
        if (libCtx) {
          const en = libCtx.mod.exportedEnums.has(parts[1]) ? libCtx.enums.get(parts[1]) : undefined;
          if (en) {
            const v = en.get(parts[2]);
            if (!v) this.err(e, `The '${root}.${parts[1]}' enum does not have a field named '${parts[2]}'.`);
            return v;
          }
        }
      }

      // 0c. Imported library constant (`alias.CONST`)
      if (parts.length === 2 && !scope.lookup(root)) {
        const libs = this.activeLibsMap();
        const libCtx = libs.get(root);
        if (libCtx && libCtx.mod.exportedConsts.has(parts[1])) {
          return libCtx.consts.get(parts[1]);
        }
      }

      // 1. Local enum member: EnumName.member
      const enumMap = this.enums.get(root);
      if (enumMap && !scope.lookup(root)) {
        const v = enumMap.get(e.property);
        if (!v) this.err(e, `The '${root}' enum does not have a field named '${e.property}'.`);
        return v;
      }

      // 2. Drawing `*.all` arrays (`line.all`, `box.all`, `label.all`, `table.all`, `linefill.all`, `polyline.all`)
      if (parts.length === 2 && !scope.lookup(root) && DRAWING_NS.has(root) && parts[1] === 'all') {
        return this.drawingAllArray(root);
      }

      // 3. Built-in dotted names (ta.tr, ta.obv, ta.pvt, color.red, syminfo.*, barstate.*, strategy.*, dividends.*, etc.)
      if (!scope.lookup(root) && BUILTIN_NS.has(root)) {
        return this.evalIdent(dotted, e, scope);
      }
    }
    // 4. UDT & chart.point field access
    const obj = this.eval(e.object, scope);
    if (isNa(obj)) {
      this.err(e, `Cannot access the '${e.property}' field of an undefined object. The object is na.`);
    }
    if (obj instanceof ScriptObject) {
      if (!(e.property in obj.fields)) {
        this.err(e, `The '${obj.typeName}' type does not have a field named '${e.property}'.`);
      }
      return obj.fields[e.property];
    }
    this.err(e, `'${e.property}' alanına erişilemiyor (değer bir UDT nesnesi değil).`);
  }

  // ------------------------------------------------------------ identifiers

  private evalIdent(name: string, node: Expression, scope: Scope): any {
    const cell = scope.lookup(name);
    if (cell) return cell.value;
    if (this.activeLib && this.activeLib.consts.has(name)) {
      return this.activeLib.consts.get(name);
    }
    return this.builtinAt(name, this.b, node);
  }

  /** Lazily evaluates built-in stateful OHLCV ta.* series (obv, pvt, accdist, iii, nvi, pvi, wad, wvad) up to `bar`. */
  private builtinTaSeriesAt(taKey: string, bar: number): number {
    if (bar < 0 || bar >= this.n) return NaN;
    let entry = this.builtinTaSeries.get(taKey);
    if (!entry) {
      const ctx: BarCtx = { open: NaN, high: NaN, low: NaN, close: NaN, volume: NaN, time: NaN, index: 0 };
      const stepper = TA_FACTORIES[taKey]({ bar: () => ctx });
      entry = { stepper, values: [], ctx };
      this.builtinTaSeries.set(taKey, entry);
    }
    while (entry.values.length <= bar) {
      const i = entry.values.length;
      const c = this.candles[i];
      entry.ctx.open = c.open;
      entry.ctx.high = c.high;
      entry.ctx.low = c.low;
      entry.ctx.close = c.close;
      entry.ctx.volume = c.volume;
      entry.ctx.time = c.time * 1000;
      entry.ctx.index = i;
      entry.values.push(toNum(entry.stepper()));
    }
    return entry.values[bar];
  }

  /** Built-in series/constants evaluated for bar `bar` (used for history too). */
  private builtinAt(name: string, bar: number, node: Expression | null): any {
    if (name.startsWith('ta.') && BUILTIN_TA_SERIES.has(name.slice(3))) {
      return this.builtinTaSeriesAt(name.slice(3), bar);
    }
    const c = this.candles[bar];
    switch (name) {
      case 'open':
        return c ? c.open : NaN;
      case 'high':
        return c ? c.high : NaN;
      case 'low':
        return c ? c.low : NaN;
      case 'close':
        return c ? c.close : NaN;
      case 'volume':
        return c ? c.volume : NaN;
      case 'hl2':
        return c ? (c.high + c.low) / 2 : NaN;
      case 'hlc3':
        return c ? (c.high + c.low + c.close) / 3 : NaN;
      case 'ohlc4':
        return c ? (c.open + c.high + c.low + c.close) / 4 : NaN;
      case 'hlcc4':
        return c ? (c.high + c.low + 2 * c.close) / 4 : NaN;
      case 'time':
      case 'time_close':
        return c ? c.time * 1000 + (name === 'time_close' ? this.tfSeconds * 1000 : 0) : NaN;
      case 'timenow':
        return Date.now();
      case 'bar_index':
        return c ? bar : NaN;
      case 'last_bar_index':
        return this.n - 1;
      case 'last_bar_time':
        return this.candles[this.n - 1].time * 1000;
      case 'na':
        return NaN;
      case 'ta.tr': {
        if (!c) return NaN;
        const p = this.candles[bar - 1];
        return p
          ? Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close))
          : c.high - c.low;
      }
      case 'year':
      case 'month':
      case 'dayofmonth':
      case 'dayofweek':
      case 'hour':
      case 'minute':
      case 'second':
      case 'weekofyear':
        return c ? timeField(name, c.time * 1000) : NaN;
      case 'barstate.isfirst':
        return bar === 0;
      case 'barstate.islast':
        return bar === this.n - 1;
      case 'barstate.isconfirmed':
        return bar === this.b ? this.isConfirmedTick : true;
      case 'barstate.ishistory':
        return bar === this.b ? !this.isRealtimeTick : true;
      case 'barstate.isrealtime':
        return bar === this.b ? this.isRealtimeTick : false;
      case 'barstate.isnew':
        return bar === this.b ? this.isNewTick : true;
      case 'barstate.islastconfirmedhistory':
        return this.isRealtimeTick ? bar === this.n - 2 : bar === this.n - 1;
      case 'syminfo.tickerid':
        return this.symbol;
      case 'syminfo.ticker':
      case 'syminfo.root':
        return this.symbol.includes(':') ? this.symbol.split(':')[1] : this.symbol;
      case 'syminfo.prefix':
        return this.symbol.includes(':') ? this.symbol.split(':')[0] : '';
      case 'syminfo.mintick':
        return this.mintick;
      case 'syminfo.pointvalue':
        return 1;
      case 'syminfo.currency':
        return 'USD';
      case 'syminfo.type':
        return 'stock';
      case 'syminfo.timezone':
        return 'UTC';
      case 'timeframe.period':
        return this.timeframe;
      case 'timeframe.multiplier': {
        const s = this.tfSeconds;
        return s < 86400 ? Math.max(1, Math.round(s / 60)) : Math.round(s / 86400);
      }
      case 'timeframe.isintraday':
        return this.tfSeconds < 86400;
      case 'timeframe.isminutes':
        return this.tfSeconds >= 60 && this.tfSeconds < 86400;
      case 'timeframe.isseconds':
        return this.tfSeconds < 60;
      case 'timeframe.isdaily':
        return this.tfSeconds >= 86400 && this.tfSeconds < 7 * 86400;
      case 'timeframe.isweekly':
        return this.tfSeconds >= 7 * 86400 && this.tfSeconds < 28 * 86400;
      case 'timeframe.ismonthly':
        return this.tfSeconds >= 28 * 86400;
      case 'timeframe.isdwm':
        return this.tfSeconds >= 86400;
    }

    if (name.startsWith('strategy.')) {
      const v = this.strategyValue(name, bar);
      if (v !== NOT_HANDLED) return v;
    }
    if (name in CONSTANTS) return CONSTANTS[name];
    return this.err(node, `Tanımsız değişken '${name}'.`);
  }

  private strategyValue(name: string, bar: number): any {
    const bk = this.broker;
    if (!bk) return NOT_HANDLED;
    const live = bar === this.b;
    const hist = (k: 'position_size' | 'equity' | 'netprofit') =>
      live ? NOT_HANDLED : (this.brokerHist[k][bar] ?? NaN);
    switch (name) {
      case 'strategy.position_size': {
        const h = hist('position_size');
        return h === NOT_HANDLED ? bk.positionSize : h;
      }
      case 'strategy.equity': {
        const h = hist('equity');
        return h === NOT_HANDLED ? bk.equity : h;
      }
      case 'strategy.netprofit': {
        const h = hist('netprofit');
        return h === NOT_HANDLED ? bk.netProfit : h;
      }
      case 'strategy.position_avg_price':
        return bk.avgPrice;
      case 'strategy.openprofit':
        return bk.openProfit;
      case 'strategy.initial_capital':
        return bk.cfg.initialCapital;
      case 'strategy.grossprofit':
        return bk.grossProfit;
      case 'strategy.grossloss':
        return bk.grossLoss;
      case 'strategy.closedtrades':
        return bk.closedCount;
      case 'strategy.opentrades':
        return bk.openCount;
      case 'strategy.wintrades':
        return bk.winCount;
      case 'strategy.losstrades':
        return bk.lossCount;
      case 'strategy.max_drawdown':
        return bk.maxDrawdown;
      case 'strategy.account_currency':
        return 'USD';
    }
    return NOT_HANDLED;
  }

  private evalIndex(e: Extract<Expression, { type: 'IndexAccess' }>, scope: Scope): any {
    const k = toNum(this.eval(e.index, scope));
    if (Number.isNaN(k)) return NaN;
    const target = e.target;

    if (target.type === 'Identifier' || (target.type === 'MemberAccess' && dottedNameOf(target) !== null && !scope.lookup(dottedNameOf(target)!.split('.')[0]) && BUILTIN_NS.has(dottedNameOf(target)!.split('.')[0]))) {
      const tname = target.type === 'Identifier' ? target.name : dottedNameOf(target)!;
      const cell = scope.lookup(tname);
      if (cell) {
        if (k === 0) return cell.value;
        const v = cell.hist[this.b - k];
        return v === undefined ? NaN : v;
      }
      if (k === 0) return this.builtinAt(tname, this.b, target);
      const bar = this.b - k;
      if (bar < 0) return NaN;
      return this.builtinAt(tname, bar, target);
    }

    // generic series expression: remember its value on every bar it is evaluated
    const cur = this.eval(target, scope);
    let perStack = this.nodeHist.get(e);
    if (!perStack) {
      perStack = new Map();
      this.nodeHist.set(e, perStack);
    }
    let h = perStack.get(this.stack);
    if (!h) {
      h = [];
      perStack.set(this.stack, h);
    }
    h[this.b] = cur;
    if (k === 0) return cur;
    const v = h[this.b - k];
    return v === undefined ? NaN : v;
  }

  // ------------------------------------------------------------ calls

  private evalArgs(call: FunctionCall, scope: Scope): { pos: any[]; named: Record<string, any> } {
    const pos: any[] = [];
    const named: Record<string, any> = {};
    for (const a of call.args) {
      const v = this.eval(a.value, scope);
      if (a.name) named[a.name] = v;
      else pos.push(v);
    }
    return { pos, named };
  }

  private bind(pos: any[], named: Record<string, any>, names: string[]): any[] {
    const out: any[] = [];
    for (let i = 0; i < names.length; i++) {
      out.push(named[names[i]] !== undefined ? named[names[i]] : pos[i]);
    }
    return out;
  }

  private bindObj(pos: any[], named: Record<string, any>, names: string[]): Record<string, any> {
    const out: Record<string, any> = {};
    names.forEach((nm, i) => {
      out[nm] = named[nm] !== undefined ? named[nm] : pos[i];
    });
    return out;
  }

  private evalCall(call: FunctionCall, scope: Scope): any {
    this.tick(call);
    const name = call.callee;
    const typeArgNames = call.typeArgs?.map((t) => t.name);

    // 0a. Active library UDT constructor/copy: `LocalType.new(...)` / `LocalType.copy(...)`
    if (this.activeLib && call.calleeExpr.type === 'MemberAccess' && call.calleeExpr.object.type === 'Identifier') {
      const head = call.calleeExpr.object.name;
      const prop = call.calleeExpr.property;
      const td = this.activeLib.types.get(head);
      if (td && !scope.lookup(head)) {
        const runtimeTypeName = this.activeLib.mod.exportedTypes.has(head)
          ? `${this.activeLib.mod.alias}.${head}`
          : head;
        if (prop === 'new') return this.udtNew(td, call, scope, runtimeTypeName);
        if (prop === 'copy') {
          const { pos } = this.evalArgs(call, scope);
          if (isNa(pos[0])) return null;
          if (pos[0] instanceof ScriptObject) return pos[0].copy();
          this.err(call, `${head}.copy(): '${head}' nesnesi bekleniyor.`);
        }
      }
    }

    // 0b. Imported library static UDT constructor/copy & library functions: `alias.Type.new(...)` / `alias.fn(...)`
    if (name) {
      const parts = name.split('.');
      const libs = this.activeLibsMap();
      if (parts.length === 3 && !scope.lookup(parts[0]) && libs.has(parts[0])) {
        const libCtx = libs.get(parts[0])!;
        const td = libCtx.mod.exportedTypes.get(parts[1]);
        if (td) {
          const runtimeTypeName = `${parts[0]}.${parts[1]}`;
          if (parts[2] === 'new') return this.udtNew(td, call, scope, runtimeTypeName, libCtx);
          if (parts[2] === 'copy') {
            const { pos } = this.evalArgs(call, scope);
            if (isNa(pos[0])) return null;
            if (pos[0] instanceof ScriptObject) return pos[0].copy();
            this.err(call, `${runtimeTypeName}.copy(): '${runtimeTypeName}' nesnesi bekleniyor.`);
          }
        }
      }
      if (parts.length === 2 && !scope.lookup(parts[0]) && libs.has(parts[0])) {
        const libCtx = libs.get(parts[0])!;
        const expFn = libCtx.mod.exportedFunctions.get(parts[1]);
        if (expFn) return this.callLibFn(libCtx, expFn, call, scope);
        const expMethods = libCtx.mod.exportedMethods.get(parts[1]);
        if (expMethods && call.args.length > 0) {
          const firstVal = this.eval(call.args[0].value, scope);
          const matched = this.matchRuntimeMethod(expMethods, firstVal, libCtx.mod.alias);
          if (matched) return this.callLibFn(libCtx, matched, call, scope, firstVal, true);
        }
      }
    }

    // 0c. Statically resolved library call/method
    const resolvedLib = this.tc?.resolvedLibFns.get(call);
    if (resolvedLib && call.calleeExpr.type !== 'MemberAccess') {
      const ctx = this.resolveLibCtxByMod(resolvedLib.mod);
      if (ctx) return this.callLibFn(ctx, resolvedLib.fn, call, scope);
    }

    // 1. Local UDT static constructor/copy: `TypeName.new(...)` / `TypeName.copy(obj)`
    if (call.calleeExpr.type === 'MemberAccess' && call.calleeExpr.object.type === 'Identifier') {
      const head = call.calleeExpr.object.name;
      const prop = call.calleeExpr.property;
      const td = this.udts.get(head);
      if (td && !scope.lookup(head)) {
        if (prop === 'new') return this.udtNew(td, call, scope);
        if (prop === 'copy') {
          const { pos } = this.evalArgs(call, scope);
          if (isNa(pos[0])) return null;
          if (pos[0] instanceof ScriptObject) return pos[0].copy();
          this.err(call, `${head}.copy(): '${head}' nesnesi bekleniyor.`);
        }
      }
    }

    // 2. Method-style call: `recv.methodName(args)` when recv is not a built-in namespace
    if (call.calleeExpr.type === 'MemberAccess') {
      const root = name ? name.split('.')[0] : null;
      const isNamespace = root !== null && !scope.lookup(root) && BUILTIN_NS.has(root);
      if (!isNamespace) {
        return this.evalMethodCall(call.calleeExpr.object, call.calleeExpr.property, call, scope);
      }
    }

    // 3. Active library private/exported functions when running inside a library
    if (this.activeLib) {
      const libFn = this.activeLib.functions.get(name);
      if (libFn) return this.callLibFn(this.activeLib, libFn, call, scope);
      const libMethods = this.activeLib.methods.get(name);
      if (libMethods && call.args.length > 0) {
        const firstVal = this.eval(call.args[0].value, scope);
        const matched = this.matchRuntimeMethod(libMethods, firstVal, this.activeLib.mod.alias);
        if (matched) return this.callLibFn(this.activeLib, matched, call, scope, firstVal, true);
      }
    }

    // 4. Resolved user function or method (in direct call form `fn(args)`)
    const resolved = this.tc?.resolvedCalls.get(call);
    if (resolved) return this.callUser(resolved, call, scope);
    const user = this.userFns.get(name);
    if (user) return this.callUser(user, call, scope);
    const methodList = this.userMethods.get(name);
    if (methodList && call.args.length > 0) {
      const firstVal = this.eval(call.args[0].value, scope);
      const matched = this.matchRuntimeMethod(methodList, firstVal);
      if (matched) return this.callUser(matched, call, scope, firstVal, true);
    }

    if (name === 'request.security') return this.securityCall(call, scope);
    if (name === 'request.security_lower_tf') return this.securityLowerTfCall(call, scope);

    const { pos, named } = this.evalArgs(call, scope);

    // ta.* (and bare v4 names); math.sum = ta.sum (TitanScript eşanlamlısı)
    const taName = name === 'math.sum' ? 'sum' : name.startsWith('ta.') ? name.slice(3) : name;
    if (TA_FACTORIES[taName] && (name.startsWith('ta.') || name === 'math.sum' || !name.includes('.'))) {
      return this.callTa(taName, call, pos, named);
    }

    const direct = this.callBuiltin(name, call, pos, named);
    if (direct !== NOT_HANDLED) return direct;

    // bare legacy aliases: abs(), max(), round() ...
    if (!name.includes('.')) {
      const m = libCall(`math.${name}`, pos, call.loc.line, this.mintick);
      if (m !== NOT_HANDLED) return m;
    }
    const lib = libCall(name, this.bindLib(name, pos, named), call.loc.line, this.mintick, typeArgNames);
    if (lib !== NOT_HANDLED) return lib;

    const ns = name.split('.')[0];
    if (DRAWING_NS.has(ns)) return this.drawingCall(name, call, pos, named);
    if (NA_FUNCS.has(name)) {
      return null;
    }
    return this.err(call, `Desteklenmeyen fonksiyon '${name || dottedNameOf(call.calleeExpr) || '?'}'.`);
  }

  private evalMethodCall(
    receiverExpr: Expression,
    methodName: string,
    call: FunctionCall,
    scope: Scope
  ): any {
    const receiver = this.eval(receiverExpr, scope);

    // 1a. Statically resolved library method
    const resolvedLib = this.tc?.resolvedLibFns.get(call);
    if (resolvedLib) {
      const ctx = this.resolveLibCtxByMod(resolvedLib.mod);
      if (ctx) return this.callLibFn(ctx, resolvedLib.fn, call, scope, receiver);
    }

    // 1b. Statically resolved user-defined method
    const resolved = this.tc?.resolvedCalls.get(call);
    if (resolved) return this.callUser(resolved, call, scope, receiver);

    // 2a. Active library internal methods
    if (this.activeLib) {
      const libMethods = this.activeLib.methods.get(methodName);
      if (libMethods) {
        const matched = this.matchRuntimeMethod(libMethods, receiver, this.activeLib.mod.alias);
        if (matched) return this.callLibFn(this.activeLib, matched, call, scope, receiver);
      }
    }

    // 2b. Runtime user-defined method dispatch fallback
    const overloads = this.userMethods.get(methodName);
    if (overloads) {
      const matched = this.matchRuntimeMethod(overloads, receiver);
      if (matched) return this.callUser(matched, call, scope, receiver);
    }

    // 2c. Imported library exported methods fallback
    const impMethods = this.importedMethods.get(methodName);
    if (impMethods) {
      for (const entry of impMethods) {
        if (this.matchRuntimeMethod([entry.fn], receiver, entry.ctx.mod.alias)) {
          return this.callLibFn(entry.ctx, entry.fn, call, scope, receiver);
        }
      }
    }

    // 3. Built-in UDT & chart.point `.copy()`
    if (methodName === 'copy') {
      if (receiver instanceof ScriptObject) return receiver.copy();
      if (isNa(receiver)) {
        const st = this.tc?.exprTypes.get(receiverExpr);
        if (
          st &&
          (this.udts.has(st.base) ||
            st.base === 'chart.point' ||
            st.base === 'array' ||
            st.base === 'map' ||
            st.base === 'matrix')
        ) {
          return null;
        }
      }
    }

    // 4. Built-in namespace method dispatch (array, map, matrix, str, drawings)
    const { pos, named } = this.evalArgs(call, scope);
    const fullPos = [receiver, ...pos];
    if (receiver instanceof ScriptArray) {
      const fnName = `array.${methodName}`;
      const r = libCall(fnName, this.bindLib(fnName, fullPos, named), call.loc.line, this.mintick);
      if (r !== NOT_HANDLED) return r;
    } else if (receiver instanceof ScriptMap) {
      const fnName = `map.${methodName}`;
      const r = libCall(fnName, this.bindLib(fnName, fullPos, named), call.loc.line, this.mintick);
      if (r !== NOT_HANDLED) return r;
    } else if (receiver instanceof ScriptMatrix) {
      const fnName = `matrix.${methodName}`;
      const r = libCall(fnName, this.bindLib(fnName, fullPos, named), call.loc.line, this.mintick);
      if (r !== NOT_HANDLED) return r;
    } else if (typeof receiver === 'string') {
      const fnName = `str.${methodName}`;
      const r = libCall(fnName, this.bindLib(fnName, fullPos, named), call.loc.line, this.mintick);
      if (r !== NOT_HANDLED) return r;
    } else if (isHandle(receiver) && DRAWING_NS.has(receiver.kind)) {
      return this.drawingCall(`${receiver.kind}.${methodName}`, call, fullPos, named);
    }

    return this.err(call, `Desteklenmeyen metot '${methodName}'.`);
  }

  private matchRuntimeMethod(
    overloads: FunctionDefStmt[],
    val: any,
    libAlias?: string
  ): FunctionDefStmt | undefined {
    const rtType =
      val instanceof ScriptObject
        ? val.typeName
        : val instanceof ScriptEnumValue
          ? val.enumName
          : val instanceof ScriptArray
            ? 'array'
            : val instanceof ScriptMap
              ? 'map'
              : val instanceof ScriptMatrix
                ? 'matrix'
                : isHandle(val)
                  ? val.kind
                  : typeof val === 'boolean'
                    ? 'bool'
                    : typeof val === 'string'
                      ? 'string'
                      : typeof val === 'number'
                        ? Number.isInteger(val) ? 'int' : 'float'
                        : null;
    if (!rtType) return overloads[0];
    let widening: FunctionDefStmt | undefined;
    for (const fn of overloads) {
      const expected = fn.params[0]?.typeRef?.name;
      if (expected === rtType || (libAlias && `${libAlias}.${expected}` === rtType)) return fn;
      if (!widening && rtType === 'int' && expected === 'float') widening = fn;
      if (!widening && rtType === 'string' && expected === 'color') widening = fn;
    }
    return widening;
  }

  private udtNew(
    td: TypeDefStmt,
    call: FunctionCall,
    scope: Scope,
    typeName = td.name,
    evalCtx?: LibRuntimeCtx
  ): ScriptObject {
    const { pos, named } = this.evalArgs(call, scope);
    const fields: Record<string, any> = {};
    const prevLib = this.activeLib;
    if (evalCtx) this.activeLib = evalCtx;
    try {
      td.fields.forEach((f, i) => {
        let val: any;
        if (f.name in named) {
          val = named[f.name];
        } else if (i < pos.length) {
          val = pos[i];
        } else if (f.defaultValue) {
          val = this.eval(f.defaultValue, this.topScope);
        } else {
          val =
            f.typeRef.name === 'bool'
              ? false
              : f.typeRef.name === 'int' || f.typeRef.name === 'float'
                ? NaN
                : null;
        }
        fields[f.name] = val;
      });
    } finally {
      if (evalCtx) this.activeLib = prevLib;
    }
    return new ScriptObject(typeName, fields);
  }

  private callLibFn(
    ctx: LibRuntimeCtx,
    fn: FunctionDefStmt,
    call: FunctionCall,
    scope: Scope,
    receiver?: any,
    firstAlreadyEval = false
  ): any {
    const prevLib = this.activeLib;
    // Evaluate arguments in the CALLER's context first, then switch activeLib to `ctx` for body execution
    const vals: any[] = new Array(fn.params.length).fill(undefined);
    let p = 0;
    const hasReceiver =
      receiver !== undefined || (fn.isMethod && call.calleeExpr.type === 'MemberAccess' && !firstAlreadyEval);
    if (hasReceiver || firstAlreadyEval) {
      vals[0] = receiver;
      p = 1;
    }
    const startIdx = firstAlreadyEval ? 1 : 0;
    for (let i = startIdx; i < call.args.length; i++) {
      const a = call.args[i];
      const v = this.eval(a.value, scope);
      if (a.name) {
        const idx = fn.params.findIndex((pr) => pr.name === a.name);
        if (idx < 0) this.err(call, `'${ctx.mod.alias}.${fn.name}' fonksiyonunda '${a.name}' parametresi yok.`);
        vals[idx] = v;
      } else {
        vals[p++] = v;
      }
    }

    const fnScope = new Scope(null);
    const prevStack = this.stack;
    const prevLast = this.lastVal;
    const prevLastSet = this.lastValSet;
    this.stack = `${prevStack}/${this.id(call)}`;
    this.activeLib = ctx;
    try {
      fn.params.forEach((param, i) => {
        const cell = this.cellFor(this.paramKey(fn, i));
        let v = vals[i];
        if (v === undefined) {
          v = param.defaultValue ? this.eval(param.defaultValue, fnScope) : NaN;
        }
        cell.value = v;
        cell.touched = true;
        fnScope.vars.set(param.name, cell);
      });
      if (Array.isArray(fn.body)) {
        this.lastVal = null;
        this.lastValSet = false;
        const body = new Scope(fnScope);
        for (const s of fn.body) this.execStmt(s, body);
        return this.lastVal;
      }
      return this.eval(fn.body, fnScope);
    } finally {
      this.activeLib = prevLib;
      this.stack = prevStack;
      this.lastVal = prevLast;
      this.lastValSet = prevLastSet;
    }
  }

  private bindLib(name: string, pos: any[], named: Record<string, any>): any[] {
    const hasNamed = Object.keys(named).length > 0;
    if (!hasNamed) return pos;
    const dot = name.indexOf('.');
    if (dot > 0) {
      const ns = name.slice(0, dot);
      const fn = name.slice(dot + 1);
      if (ns === 'map' && fn in MAP_SIGS) return this.bind(pos, named, MAP_SIGS[fn]);
      if (ns === 'matrix' && fn in MATRIX_SIGS) return this.bind(pos, named, MATRIX_SIGS[fn]);
    }
    const sigs: Record<string, string[]> = {
      'color.new': ['color', 'transp'],
      'color.rgb': ['red', 'green', 'blue', 'transp'],
      'str.tostring': ['value', 'format'],
      'math.round': ['number', 'precision'],
      'array.new': ['size', 'initial_value'],
      'array.new_float': ['size', 'initial_value'],
      'array.new_int': ['size', 'initial_value'],
      'array.new_bool': ['size', 'initial_value'],
      'array.new_string': ['size', 'initial_value'],
      'array.fill': ['id', 'value', 'index_from', 'index_to'],
      'array.slice': ['id', 'index_from', 'index_to'],
      'array.sort': ['id', 'order'],
      'array.join': ['id', 'separator'],
    };
    const sig = sigs[name];
    return sig ? this.bind(pos, named, sig) : pos;
  }

  // ------------------------------------------------------------ user functions & methods

  private callUser(
    fn: FunctionDefStmt,
    call: FunctionCall,
    scope: Scope,
    receiver?: any,
    firstAlreadyEval = false
  ): any {
    const fnScope = new Scope(this.topScope);
    const prevStack = this.stack;
    const prevLast = this.lastVal;
    const prevLastSet = this.lastValSet;
    const newStack = `${prevStack}/${this.id(call)}`;

    const vals: any[] = new Array(fn.params.length).fill(undefined);
    let p = 0;
    const hasReceiver = receiver !== undefined || (fn.isMethod && call.calleeExpr.type === 'MemberAccess' && !firstAlreadyEval);
    if (hasReceiver) {
      vals[0] = receiver;
      p = 1;
    }
    const startIdx = firstAlreadyEval ? 1 : 0;
    if (firstAlreadyEval) {
      vals[0] = receiver;
      p = 1;
    }
    for (let i = startIdx; i < call.args.length; i++) {
      const a = call.args[i];
      const v = this.eval(a.value, scope);
      if (a.name) {
        const idx = fn.params.findIndex((pr) => pr.name === a.name);
        if (idx < 0) this.err(call, `'${fn.name}' fonksiyonunda '${a.name}' parametresi yok.`);
        vals[idx] = v;
      } else {
        vals[p++] = v;
      }
    }
    this.stack = newStack;
    try {
      fn.params.forEach((param, i) => {
        const cell = this.cellFor(this.paramKey(fn, i));
        let v = vals[i];
        if (v === undefined) {
          v = param.defaultValue ? this.eval(param.defaultValue, fnScope) : NaN;
        }
        cell.value = v;
        cell.touched = true;
        fnScope.vars.set(param.name, cell);
      });
      let result: any;
      if (Array.isArray(fn.body)) {
        this.lastVal = null;
        this.lastValSet = false;
        const body = new Scope(fnScope);
        for (const s of fn.body) this.execStmt(s, body);
        result = this.lastVal;
      } else {
        result = this.eval(fn.body, fnScope);
      }
      return result;
    } finally {
      this.stack = prevStack;
      this.lastVal = prevLast;
      this.lastValSet = prevLastSet;
    }
  }

  private paramKeys = new WeakMap<object, object[]>();
  private paramKey(fn: object, i: number): object {
    let keys = this.paramKeys.get(fn);
    if (!keys) {
      keys = [];
      this.paramKeys.set(fn, keys);
    }
    return (keys[i] ??= {});
  }

  // ------------------------------------------------------------ ta.*

  private callTa(name: string, call: FunctionCall, pos: any[], named: Record<string, any>): any {
    const sig = TA_SIGS[name];
    let vals: any[];
    let twoArgPivot = false;
    if ((name === 'pivothigh' || name === 'pivotlow') && pos.length === 2 && !Object.keys(named).length) {
      vals = [pos[0], pos[1]];
      twoArgPivot = true;
    } else {
      vals = this.bind(pos, named, sig);
      if (
        ['highest', 'lowest', 'highestbars', 'lowestbars', 'range'].includes(name) &&
        vals[1] === undefined &&
        vals[0] !== undefined
      ) {
        const src = name.startsWith('lowest') ? 'low' : 'high';
        vals = [this.barCtx[src], vals[0]];
      }
      if (vals[0] === undefined && TA_DEFAULT_SRC[name]) vals[0] = this.builtinAt(TA_DEFAULT_SRC[name], this.b, null);
      if (vals[0] === undefined && ['sma', 'ema', 'rma', 'wma', 'rsi', 'stdev', 'cum', 'change'].includes(name)) {
        vals[0] = this.barCtx.close;
      }
      if (name === 'stoch') {
        if (vals[1] === undefined) vals[1] = this.barCtx.high;
        if (vals[2] === undefined) vals[2] = this.barCtx.low;
      }
    }
    const stepper = this.stateFor<Stepper>(call, () => recordedStepper(TA_FACTORIES[name], this.env, this));
    const args = vals.map((v) =>
      typeof v === 'boolean' || typeof v === 'string' ? v : v === undefined ? undefined : toNum(v)
    );
    const defaults = TA_ARG_DEFAULTS[name];
    if (defaults) defaults.forEach((d, i) => (args[i] = args[i] === undefined ? d : args[i]));
    for (let i = 0; i < sig.length && !twoArgPivot; i++) {
      if (args[i] === undefined && TA_REQUIRED.has(`${name}.${sig[i]}`)) {
        this.err(call, `ta.${name}: '${sig[i]}' argümanı eksik.`);
      }
    }
    return stepper(...args);
  }

  // ------------------------------------------------------------ builtins (stateful / VM-aware)

  private callBuiltin(name: string, call: FunctionCall, pos: any[], named: Record<string, any>): any {
    switch (name) {
      case 'indicator':
      case 'strategy':
      case 'study':
      case 'library':
        return null;

      case 'na':
      case 'nz':
      case 'fixnan':
      case 'int':
      case 'float':
      case 'bool':
      case 'string':
        return this.coreFn(name, pos);

      case 'log.info':
        return this.logCall('info', call, pos);
      case 'log.warning':
        return this.logCall('warning', call, pos);
      case 'log.error':
        return this.logCall('error', call, pos);

      case 'chart.point.new': {
        const [time, index, price] = this.bind(pos, named, ['time', 'index', 'price']);
        return new ScriptObject('chart.point', {
          time: isNa(time) ? NaN : Math.trunc(toNum(time)),
          index: isNa(index) ? NaN : Math.trunc(toNum(index)),
          price: toNum(price),
        });
      }
      case 'chart.point.from_index': {
        const [index, price] = this.bind(pos, named, ['index', 'price']);
        return new ScriptObject('chart.point', {
          time: NaN,
          index: isNa(index) ? NaN : Math.trunc(toNum(index)),
          price: toNum(price),
        });
      }
      case 'chart.point.from_time': {
        const [time, price] = this.bind(pos, named, ['time', 'price']);
        return new ScriptObject('chart.point', {
          time: isNa(time) ? NaN : Math.trunc(toNum(time)),
          index: NaN,
          price: toNum(price),
        });
      }
      case 'chart.point.now': {
        const [price] = this.bind(pos, named, ['price']);
        return new ScriptObject('chart.point', {
          time: this.barCtx.time,
          index: this.barCtx.index,
          price: toNum(price),
        });
      }
      case 'chart.point.copy': {
        const [id] = this.bind(pos, named, ['id']);
        if (isNa(id)) return null;
        if (id instanceof ScriptObject && id.typeName === 'chart.point') return id.copy();
        return this.err(call, `chart.point.copy: 'chart.point' nesnesi bekleniyor.`);
      }

      case 'input':
      case 'input.int':
      case 'input.float':
      case 'input.bool':
      case 'input.string':
      case 'input.color':
      case 'input.source':
      case 'input.timeframe':
      case 'input.symbol':
      case 'input.time':
      case 'input.price':
      case 'input.session':
      case 'input.text_area':
      case 'input.enum':
        return this.inputCall(name, call, pos, named);

      case 'plot':
        return this.plotCall(call, pos, named);
      case 'plotshape':
      case 'plotchar':
      case 'plotarrow':
        return this.plotShapeCall(name, call, pos, named);
      case 'hline': {
        const [price, title, color] = this.bind(pos, named, ['price', 'title', 'color', 'linestyle', 'linewidth']);
        if (this.b === 0 && isPlainNumber(price)) {
          this.hlines.push({ price, title: title ? String(title) : `${price}`, color: this.color(color, '#787B86') });
        }
        return Object.freeze(makeHandle('hline', Object.freeze({ price }))); // değişmez: çatallanmada paylaşılır
      }
      case 'bgcolor':
        return this.bgcolorCall(call, pos, named);
      case 'barcolor':
        return this.barcolorCall(pos, named);
      case 'fill':
      case 'hline.fill':
        return this.fillCall(call, pos, named);
      case 'plotcandle':
      case 'plotbar':
        return this.plotOhlcCall(name, call, pos, named);
      case 'alert': {
        const [msg, freq] = this.bind(pos, named, ['message', 'freq']);
        this.pushAlert(msg, 'alert', undefined, typeof freq === 'string' ? freq : 'once_per_bar');
        return null;
      }
      case 'alertcondition': {
        const [cond, title, msg] = this.bind(pos, named, ['condition', 'title', 'message']);
        const t = isNa(title) || title === undefined ? `Alarm ${this.alertConditions.size + 1}` : String(title);
        if (!this.alertConditions.has(t)) {
          this.alertConditions.set(t, { title: t, message: isNa(msg) || msg === undefined ? t : String(msg) });
        }
        if (isTruthy(cond)) this.pushAlert(msg ?? title, 'alertcondition', t);
        return null;
      }
      case 'timestamp':
        return parseTimestampArgs(pos);
      case 'time':
      case 'time_close': {
        // time(timeframe, session, timezone): seans dışındaki barlarda na
        const [, session, tz] = this.bind(pos, named, ['timeframe', 'session', 'timezone', 'bars_back']);
        const t = this.barCtx.time + (name === 'time_close' ? this.tfSeconds * 1000 : 0);
        if (typeof session !== 'string' || !session.trim()) return t;
        const p = datePartsForTz(this.barCtx.time, typeof tz === 'string' && tz ? tz : 'UTC');
        return inSession(session, p.hour * 60 + p.minute, p.dow) ? t : NaN;
      }
      case 'year':
      case 'month':
      case 'dayofmonth':
      case 'dayofweek':
      case 'hour':
      case 'minute':
      case 'second':
      case 'weekofyear': {
        const ms = toNum(pos[0] ?? this.barCtx.time);
        const tz = pos[1] ?? named.timezone;
        // hour(time, "Europe/Istanbul"): saat dilimi verilirse o bölgenin takvim alanı
        if (typeof tz === 'string' && tz.trim() && name !== 'weekofyear' && Number.isFinite(ms)) {
          const p = datePartsForTz(ms, tz);
          const byName: Record<string, number> = {
            year: p.year, month: p.month, dayofmonth: p.day, dayofweek: p.dow + 1, hour: p.hour, minute: p.minute, second: p.second,
          };
          return byName[name];
        }
        return timeField(name, ms);
      }
      case 'timeframe.change': {
        const sec = parseTimeframeSeconds(pos[0]);
        if (!Number.isFinite(sec)) return false;
        const cur = calendarBucket(this.barCtx.time / 1000, sec);
        const prev = this.b > 0 ? calendarBucket(this.candles[this.b - 1].time, sec) : -1;
        return cur !== prev;
      }
      case 'timeframe.in_seconds':
        return pos[0] === undefined ? this.tfSeconds : parseTimeframeSeconds(pos[0]);
      case 'timeframe.from_seconds':
        return timeframeFromSeconds(toNum(pos[0]));
      case 'runtime.error':
        return this.err(call, String(pos[0] ?? 'runtime.error'));
      case 'request.dividends':
        return this.corporateEventCall('dividends', call, pos, named);
      case 'request.splits':
        return this.corporateEventCall('splits', call, pos, named);
      case 'request.earnings':
        return this.corporateEventCall('earnings', call, pos, named);
      case 'request.currency_rate':
        return this.currencyRateCall(call, pos, named);
      case 'request.economic':
      case 'request.financial':
      case 'request.quandl':
      case 'request.seed':
        this.warn(`${name}(): ücretsiz veri kaynağı yok; dürüst na döner.`);
        return NaN;
      case 'ticker.new':
      case 'ticker.modify':
      case 'ticker.heikinashi':
      case 'ticker.renko':
        return String(pos[1] ?? pos[0] ?? this.symbol);
    }

    if (name.startsWith('strategy.risk.')) {
      this.warn(`${name}(): risk kuralları uygulanmıyor; atlandı.`);
      return null;
    }
    if (name.startsWith('strategy.')) return this.strategyCall(name, call, pos, named);
    return NOT_HANDLED;
  }

  private logCall(level: ScriptLogEntry['level'], call: FunctionCall, pos: any[]): null {
    if (this.isChild) return null;
    const msg =
      pos.length > 1
        ? formatString(tostring(pos[0], undefined, this.mintick), pos.slice(1), this.mintick)
        : tostring(pos[0], undefined, this.mintick);
    if (this.logs.length >= MAX_LOGS) this.logs.shift();
    this.logs.push({
      level,
      time: this.candles[this.b].time,
      barIndex: this.b,
      line: call.loc.line,
      message: msg,
    });
    return null;
  }

  private coreFn(name: string, pos: any[]): any {
    const v = pos[0];
    switch (name) {
      case 'na':
        return isNa(v);
      case 'nz':
        return isNa(v) ? (pos[1] === undefined ? 0 : pos[1]) : v;
      case 'fixnan':
        return v;
      case 'int': {
        const x = toNum(v);
        return Number.isNaN(x) ? NaN : Math.trunc(x);
      }
      case 'float':
        return toNum(v);
      case 'bool':
        return isTruthy(v);
      case 'string':
        return tostring(v);
    }
    return null;
  }

  private pushAlert(msg: unknown, kind: 'alert' | 'alertcondition', title?: string, freq?: string): void {
    // by default, alerts only fire live: historical bars are silent
    if (this.b !== this.n - 1 || this.alerts.length >= 500) return;
    this.alerts.push({
      time: this.candles[this.b].time,
      message: isNa(msg) || msg === undefined ? title ?? 'alert' : String(msg),
      kind,
      ...(title !== undefined ? { title } : {}),
      ...(freq !== undefined ? { freq } : {}),
    });
  }

  private color(raw: unknown, fallback: string): string {
    return typeof raw === 'string' && raw ? raw : fallback;
  }

  // ------------------------------------------------------------ input

  private inputOverrideOf(id: string, title: string): unknown {
    const ov = this.opts.inputOverrides;
    if (!ov) return undefined;
    if (id in ov) return ov[id];
    if (title in ov) return ov[title];
    return undefined;
  }

  private inputCall(name: string, call: FunctionCall, pos: any[], named: Record<string, any>): any {
    const attachMeta = (
      def: ScriptInputDef,
      meta: { tooltip?: unknown; inline?: unknown; group?: unknown; confirm?: unknown; display?: unknown; active?: unknown }
    ) => {
      if (typeof meta.group === 'string' && meta.group) def.group = meta.group;
      if (typeof meta.inline === 'string' && meta.inline) def.inline = meta.inline;
      if (typeof meta.tooltip === 'string' && meta.tooltip) def.tooltip = meta.tooltip;
      if (typeof meta.confirm === 'boolean') def.confirm = meta.confirm;
      if (isPlainNumber(meta.display)) def.display = meta.display;
      if (typeof meta.active === 'boolean') def.active = meta.active;
    };

    const nextDupId = (label: string): string | undefined => {
      const existingSame = this.inputs.filter((d) => d.title === label).length;
      return existingSame === 0 ? undefined : `${label}#${existingSame + 1}`;
    };

    if (name === 'input.enum') {
      const o = this.bindObj(pos, named, [
        'defval', 'title', 'options', 'tooltip', 'inline', 'group', 'display', 'active',
      ]);
      if (!(o.defval instanceof ScriptEnumValue)) {
        this.err(call, `input.enum: 'defval' bir enum üyesi olmalıdır.`);
      }
      const label = o.title ? String(o.title) : `input ${this.inputs.length + 1}`;
      const enumMembers = this.enums.get(o.defval.enumName);
      const allowed: ScriptEnumValue[] = Array.isArray(o.options)
        ? o.options.filter((x): x is ScriptEnumValue => x instanceof ScriptEnumValue)
        : o.options instanceof ScriptArray
          ? o.options.items.filter((x): x is ScriptEnumValue => x instanceof ScriptEnumValue)
          : enumMembers
            ? [...enumMembers.values()]
            : [o.defval];
      let def = this.inputSeen.get(call);
      if (!def) {
        const dupId = nextDupId(label);
        def = {
          ...(dupId ? { id: dupId } : {}),
          title: label,
          type: 'enum',
          defval: o.defval.title,
          options: allowed.map((m) => m.title),
        };
        attachMeta(def, o);
        this.inputSeen.set(call, def);
        this.inputs.push(def);
      }
      const ov = this.inputOverrideOf(def.id ?? label, label);
      let chosen: ScriptEnumValue = o.defval;
      if (ov !== undefined) {
        if (ov instanceof ScriptEnumValue) chosen = ov;
        else if (typeof ov === 'string') {
          const hit = allowed.find((m) => m.title === ov || m.memberName === ov);
          if (hit) chosen = hit;
        }
        def.value = chosen.title;
      }
      return chosen;
    }

    const sigByName: Record<string, string[]> = {
      input: ['defval', 'title', 'tooltip', 'inline', 'group', 'display', 'active'],
      'input.int': ['defval', 'title', 'minval', 'maxval', 'step', 'tooltip', 'inline', 'group', 'confirm', 'display', 'active'],
      'input.float': ['defval', 'title', 'minval', 'maxval', 'step', 'tooltip', 'inline', 'group', 'confirm', 'display', 'active'],
      'input.bool': ['defval', 'title', 'tooltip', 'inline', 'group', 'confirm', 'display', 'active'],
      'input.string': ['defval', 'title', 'options', 'tooltip', 'inline', 'group', 'confirm', 'display', 'active'],
      'input.color': ['defval', 'title', 'tooltip', 'inline', 'group', 'confirm', 'display', 'active'],
      'input.source': ['defval', 'title', 'tooltip', 'inline', 'group', 'display', 'active'],
      'input.timeframe': ['defval', 'title', 'options', 'tooltip', 'inline', 'group', 'confirm', 'display', 'active'],
      'input.symbol': ['defval', 'title', 'tooltip', 'inline', 'group', 'confirm', 'display', 'active'],
      'input.time': ['defval', 'title', 'tooltip', 'inline', 'group', 'confirm', 'display', 'active'],
      'input.price': ['defval', 'title', 'tooltip', 'inline', 'group', 'confirm', 'display', 'active'],
      'input.session': ['defval', 'title', 'options', 'tooltip', 'inline', 'group', 'confirm', 'display', 'active'],
      'input.text_area': ['defval', 'title', 'tooltip', 'group', 'display', 'active'],
    };
    const o = this.bindObj(pos, named, sigByName[name] ?? ['defval', 'title', 'tooltip', 'inline', 'group', 'confirm', 'display', 'active']);
    // Support named `options` on `input.int` / `input.float` too
    const rawOpts = named['options'] !== undefined ? named['options'] : o.options;
    const numLike = ['input.int', 'input.float', 'input.price', 'input.time'].includes(name);
    const firstArgNode = call.args.find((a) => a.name === 'defval')?.value ?? (!call.args[0]?.name ? call.args[0]?.value : undefined);
    const sourceDefaultName =
      name === 'input.source' && firstArgNode?.type === 'Identifier' && SOURCE_NAMES.has(firstArgNode.name)
        ? firstArgNode.name
        : 'close';

    // input(close) / input(hl2, "Kaynak"): Standart bunu kaynak (source) girdisi sayar
    if (name === 'input' && firstArgNode?.type === 'Identifier' && SOURCE_NAMES.has(firstArgNode.name)) {
      return this.inputCall('input.source', call, pos, named);
    }
    let type = name === 'input' ? typeof o.defval : name.slice(6);
    if (name === 'input' && type === 'number') {
      type = Number.isInteger(o.defval) ? 'int' : 'float';
    }
    const label = o.title ? String(o.title) : `input ${this.inputs.length + 1}`;
    let def = this.inputSeen.get(call);
    if (!def) {
      const dupId = nextDupId(label);
      def = {
        ...(dupId ? { id: dupId } : {}),
        title: label,
        type,
        defval: name === 'input.source' ? sourceDefaultName : o.defval,
      };
      attachMeta(def, o);
      if (numLike || name === 'input') {
        if (isPlainNumber(o.minval)) def.min = o.minval;
        if (isPlainNumber(o.maxval)) def.max = o.maxval;
        if (isPlainNumber(o.step)) def.step = o.step;
      }
      if (Array.isArray(rawOpts)) def.options = rawOpts;
      else if (rawOpts instanceof ScriptArray) def.options = [...rawOpts.items];
      this.inputSeen.set(call, def);
      this.inputs.push(def);
    }

    const ov = this.inputOverrideOf(def.id ?? label, label);
    if (name === 'input.source') {
      if (typeof ov === 'string' && SOURCE_NAMES.has(ov)) {
        def.value = ov;
        return this.builtinAt(ov, this.b, null);
      }
      if (typeof ov === 'string' && ov.startsWith('@')) {
        const ext = this.opts.externalSources?.[ov.slice(1)];
        def.value = ov;
        if (ext) {
          const v = ext[this.b];
          return v === undefined || !Number.isFinite(v) ? NaN : v;
        }
        if (this.b === 0) this.warn(`input.source(${label}): bağlı gösterge çıktısı bulunamadı; na döner.`);
        return NaN;
      }
      return o.defval === undefined ? NaN : o.defval;
    }

    let val: any = ov !== undefined ? ov : o.defval === undefined ? NaN : o.defval;
    if (name === 'input.int' || name === 'input.time') {
      let n = toNum(val);
      if (Number.isFinite(n)) {
        n = Math.trunc(n);
        if (def.min !== undefined) n = Math.max(def.min, n);
        if (def.max !== undefined) n = Math.min(def.max, n);
      }
      val = n;
    } else if (name === 'input.float' || name === 'input.price') {
      let n = toNum(val);
      if (Number.isFinite(n)) {
        if (def.min !== undefined) n = Math.max(def.min, n);
        if (def.max !== undefined) n = Math.min(def.max, n);
      }
      val = n;
    } else if (name === 'input.bool') {
      val = isTruthy(val);
    }
    if (ov !== undefined) def.value = val;
    return val;
  }

  // ------------------------------------------------------------ request.security

  private secCache = new Map<object, Map<string, SecEntry>>();
  private missingSymbols = new Set<string>();
  private missingLowerTfs = new Set<string>();

  private bucketKey(timeSec: number, tfSec: number): number {
    return calendarBucket(timeSec, tfSec);
  }

  private securityCall(call: FunctionCall, scope: Scope): any {
    const names = ['symbol', 'timeframe', 'expression', 'gaps', 'lookahead'];
    const nodes: (Expression | undefined)[] = [];
    let p = 0;
    for (const a of call.args) {
      const idx = a.name ? names.indexOf(a.name) : p++;
      if (idx >= 0) nodes[idx] = a.value;
    }
    const exprNode = nodes[2];
    if (!exprNode) return this.err(call, 'request.security: ifade (expression) argümanı eksik.');
    const sym = nodes[0] ? this.eval(nodes[0], scope) : '';
    const tf = nodes[1] ? this.eval(nodes[1], scope) : '';
    const lookahead = nodes[4] ? isTruthy(this.eval(nodes[4], scope)) : false;

    const here = this.symbol.includes(':') ? this.symbol.split(':')[1] : this.symbol;
    const symStr = typeof sym === 'string' ? sym : '';
    const symOk = !symStr || symStr === this.symbol || symStr === here;
    const tfSec = parseTimeframeSeconds(tf);
    const sameTf = tf === '' || tf === undefined || tf === this.timeframe || tfSec === this.tfSeconds;

    const nanOf = (v: any) => (Array.isArray(v) ? v.map(() => NaN) : NaN);
    if (!symOk) {
      const key = symStr.includes(':') ? symStr.split(':').pop()! : symStr;
      const other = this.opts.symbolCandles?.[key];
      if (!other || other.length === 0) {
        if (!other) this.missingSymbols.add(key);
        this.warn(`request.security(${symStr}): başka sembol verisi yok; na döner.`);
        return nanOf(this.safeShape(exprNode, scope));
      }
      let perStack = this.secCache.get(call);
      if (!perStack) {
        perStack = new Map();
        this.secCache.set(call, perStack);
      }
      const ck = `${this.stack}|${key}|${String(tf)}`;
      let entry = perStack.get(ck);
      if (!entry) {
        entry = this.buildOtherSymbol(exprNode, scope, other, key, sameTf ? this.tfSeconds : tfSec, sameTf ? this.timeframe : String(tf));
        perStack.set(ck, entry);
      }
      const j = entry.bucketOf[this.b];
      if (j < 0) return nanOf(entry.res[0]);
      return entry.res[j];
    }
    if (sameTf) return this.eval(exprNode, scope);
    if (!Number.isFinite(tfSec) || tfSec < this.tfSeconds) {
      this.warn(`request.security(${String(tf)}): grafik zaman diliminden küçük/geçersiz zaman dilimi; na döner.`);
      return nanOf(this.safeShape(exprNode, scope));
    }
    this.warn('request.security: HTF değerleri tamamlanmış HTF mumlarından hesaplanır (repaint yok).');

    let perStack = this.secCache.get(call);
    if (!perStack) {
      perStack = new Map();
      this.secCache.set(call, perStack);
    }
    let entry = perStack.get(this.stack);
    if (!entry) {
      entry = this.buildSecurity(exprNode, scope, tfSec, String(tf));
      perStack.set(this.stack, entry);
    }
    const j = entry.bucketOf[this.b];
    const lastOfBucket = this.b === this.n - 1 || entry.bucketOf[this.b + 1] !== j;
    const idx = lookahead || lastOfBucket ? j : j - 1;
    if (idx < 0) return nanOf(entry.res[0]);
    return entry.res[idx];
  }

  /**
   * Başka sembol: (gerekirse HTF'ye toplanmış) barlarında ifadeyi çalıştırır; her grafik barı, zamanı
   * o barın kapanışından sonra olmayan son tamamlanmış diğer-sembol barına eşlenir (ileriye bakış yok).
   */
  private buildOtherSymbol(expr: Expression, scope: Scope, other: Candle[], sym: string, tfSec: number, tf: string): SecEntry {
    const src = [...other].sort((a, b) => a.time - b.time);
    let bars: Candle[] = src;
    if (Number.isFinite(tfSec) && tfSec > this.tfSeconds) {
      bars = [];
      let lastKey = NaN;
      for (const c of src) {
        const key = this.bucketKey(c.time, tfSec);
        if (key !== lastKey) {
          bars.push({ ...c });
          lastKey = key;
        } else {
          const h = bars[bars.length - 1];
          h.high = Math.max(h.high, c.high);
          h.low = Math.min(h.low, c.low);
          h.close = c.close;
          h.volume += c.volume;
        }
      }
    }
    const child = new ScriptVM(this.program, bars, { ...this.opts, timeframe: tf, symbol: sym }, true, this.tc);
    child.prepass();
    const res = child.evalSeriesOver(expr, scope);
    const span = Number.isFinite(tfSec) && tfSec > 0 ? tfSec : this.tfSeconds;
    const bucketOf: number[] = new Array(this.n);
    let k = -1;
    for (let i = 0; i < this.n; i++) {
      // grafik barı i'nin kapanışı: diğer barın kapanışı (time+span) <= bu barın kapanışı olmalı
      const closeT = this.candles[i].time + this.tfSeconds;
      while (k + 1 < bars.length && bars[k + 1].time + span <= closeT) k++;
      bucketOf[i] = k;
    }
    return { bucketOf, res };
  }

  /** Shape probe (tuple vs scalar) without trusting values. */
  private safeShape(node: Expression, scope: Scope): any {
    return node.type === 'ArrayLiteral' ? node.elements.map(() => NaN) : NaN;
    void scope;
  }

  private buildSecurity(expr: Expression, scope: Scope, tfSec: number, tf: string): SecEntry {
    const htf: Candle[] = [];
    const bucketOf: number[] = new Array(this.n);
    let lastKey = NaN;
    for (let i = 0; i < this.n; i++) {
      const c = this.candles[i];
      const key = this.bucketKey(c.time, tfSec);
      if (key !== lastKey) {
        htf.push({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume });
        lastKey = key;
      } else {
        const h = htf[htf.length - 1];
        h.high = Math.max(h.high, c.high);
        h.low = Math.min(h.low, c.low);
        h.close = c.close;
        h.volume += c.volume;
      }
      bucketOf[i] = htf.length - 1;
    }
    const child = new ScriptVM(this.program, htf, { ...this.opts, timeframe: tf, symbol: this.symbol }, true, this.tc);
    child.prepass();
    return { bucketOf, res: child.evalSeriesOver(expr, scope) };
  }

  private emptyLowerTfOf(exprNode: Expression): any {
    if (exprNode.type === 'ArrayLiteral') {
      return exprNode.elements.map(() => new ScriptArray([]));
    }
    return new ScriptArray([]);
  }

  private lookupLowerTfCandles(symStr: string, tfStr: string): Candle[] | undefined {
    const map = this.opts.lowerTfCandles;
    if (!map) return undefined;
    const stripped = symStr.includes(':') ? symStr.split(':').pop()! : symStr;
    const apiTf = scriptTimeframeToApi(tfStr) ?? tfStr;
    const keys = [
      `${symStr}|${tfStr}`,
      `${symStr}|${apiTf}`,
      `${stripped}|${tfStr}`,
      `${stripped}|${apiTf}`,
      tfStr,
      apiTf,
    ];
    for (const k of keys) {
      if (k in map && Array.isArray(map[k])) return map[k];
    }
    return undefined;
  }

  private securityLowerTfCall(call: FunctionCall, scope: Scope): any {
    const names = [
      'symbol',
      'timeframe',
      'expression',
      'ignore_invalid_symbol',
      'currency',
      'ignore_invalid_timeframe',
      'calc_bars_count',
    ];
    const nodes: (Expression | undefined)[] = [];
    let p = 0;
    for (const a of call.args) {
      const idx = a.name ? names.indexOf(a.name) : p++;
      if (idx >= 0) nodes[idx] = a.value;
    }
    const exprNode = nodes[2];
    if (!exprNode) return this.err(call, 'request.security_lower_tf: ifade (expression) argümanı eksik.');
    const sym = nodes[0] ? this.eval(nodes[0], scope) : '';
    const tf = nodes[1] ? this.eval(nodes[1], scope) : '';
    const ignoreInvalidSym = nodes[3] ? isTruthy(this.eval(nodes[3], scope)) : false;
    const ignoreInvalidTf = nodes[5] ? isTruthy(this.eval(nodes[5], scope)) : false;
    const calcBarsCount = nodes[6] ? toNum(this.eval(nodes[6], scope)) : NaN;

    const symStr = typeof sym === 'string' && sym ? sym : this.symbol;
    const tfStr = typeof tf === 'string' ? tf : String(tf ?? '');
    const tfSec = parseTimeframeSeconds(tfStr);

    if (!Number.isFinite(tfSec) || tfSec >= this.tfSeconds) {
      if (ignoreInvalidTf) {
        this.warn(`request.security_lower_tf(${tfStr}): grafik zaman diliminden küçük değil; boş dizi döner.`);
        return this.emptyLowerTfOf(exprNode);
      }
      return this.err(
        call,
        `request.security_lower_tf: requested timeframe '${tfStr}' must be lower than chart timeframe '${this.timeframe}'.`
      );
    }

    const ltfCandles = this.lookupLowerTfCandles(symStr, tfStr);
    if (!ltfCandles) this.missingLowerTfs.add(tfStr);
    if (!ltfCandles || ltfCandles.length === 0) {
      const here = this.symbol.includes(':') ? this.symbol.split(':').pop()! : this.symbol;
      const reqBare = symStr.includes(':') ? symStr.split(':').pop()! : symStr;
      if (!ignoreInvalidSym && reqBare && reqBare !== here && symStr !== this.symbol) {
        this.warn(`request.security_lower_tf(${symStr}, ${tfStr}): başka sembol için alt TF verisi yok; boş dizi döner.`);
      } else {
        this.warn(`request.security_lower_tf(${tfStr}): alt zaman dilimi verisi yok; boş dizi döner.`);
      }
      return this.emptyLowerTfOf(exprNode);
    }

    let perStack = this.ltfCache.get(call);
    if (!perStack) {
      perStack = new Map();
      this.ltfCache.set(call, perStack);
    }
    let buckets = perStack.get(this.stack);
    if (!buckets) {
      const child = new ScriptVM(
        this.program,
        ltfCandles,
        { ...this.opts, timeframe: tfStr, symbol: symStr },
        true,
        this.tc
      );
      child.prepass();
      const series = child.evalSeriesOver(exprNode, scope);
      buckets = Array.from({ length: this.n }, () => []);
      let bIdx = 0;
      for (let k = 0; k < ltfCandles.length; k++) {
        const lt = ltfCandles[k].time;
        while (bIdx + 1 < this.n && this.candles[bIdx + 1].time <= lt) bIdx++;
        if (bIdx < this.n && lt >= this.candles[bIdx].time) {
          const endT = bIdx + 1 < this.n ? this.candles[bIdx + 1].time : this.candles[bIdx].time + this.tfSeconds;
          if (lt < endT) {
            buckets[bIdx].push(series[k]);
          }
        }
      }
      perStack.set(this.stack, buckets);
    }

    if (Number.isFinite(calcBarsCount) && calcBarsCount > 0 && this.b < this.n - Math.trunc(calcBarsCount)) {
      return this.emptyLowerTfOf(exprNode);
    }

    const vals = buckets[this.b] ?? [];
    if (exprNode.type === 'ArrayLiteral') {
      const tupleLen = exprNode.elements.length;
      const out: ScriptArray[] = Array.from({ length: tupleLen }, () => new ScriptArray([]));
      for (const row of vals) {
        if (Array.isArray(row)) {
          for (let i = 0; i < tupleLen; i++) out[i].items.push(row[i]);
        }
      }
      return out;
    }
    return new ScriptArray([...vals]);
  }

  private lookupCorporateEvents(ticker: string): CorporateEventsData | undefined {
    const map = this.opts.corporateEvents;
    if (!map) return undefined;
    const raw = ticker || this.symbol;
    const bare = raw.includes(':') ? raw.split(':').pop()! : raw;
    const upper = bare.toUpperCase();
    return map[raw] ?? map[bare] ?? map[upper] ?? map[this.symbol] ?? map[this.symbol.toUpperCase()];
  }

  private alignEventsSeries(
    points: Array<{ time: number; value: number }>,
    gaps: boolean,
    lookahead: boolean
  ): number[] {
    const out = new Array<number>(this.n).fill(NaN);
    if (points.length === 0 || this.n === 0) return out;
    const sorted = [...points].sort((a, b) => a.time - b.time);

    // Map each event to its chart bar index
    const eventByBar = new Map<number, number>();
    let preChartVal = NaN;
    for (const ev of sorted) {
      if (ev.time < this.candles[0].time) {
        if (!gaps) preChartVal = ev.value;
        continue;
      }
      let target = -1;
      for (let i = 0; i < this.n; i++) {
        const startT = this.candles[i].time;
        const endT = i + 1 < this.n ? this.candles[i + 1].time : startT + this.tfSeconds;
        if (ev.time >= startT && ev.time < endT) {
          target = i;
          break;
        }
        if (startT >= ev.time) {
          target = lookahead && i > 0 ? i - 1 : i;
          break;
        }
      }
      if (target >= 0) eventByBar.set(target, ev.value);
    }

    let running = gaps ? NaN : preChartVal;
    for (let i = 0; i < this.n; i++) {
      if (eventByBar.has(i)) {
        const v = eventByBar.get(i)!;
        out[i] = v;
        if (!gaps) running = v;
      } else if (!gaps) {
        out[i] = running;
      }
    }
    return out;
  }

  private corporateEventCall(
    kind: 'dividends' | 'splits' | 'earnings',
    call: FunctionCall,
    pos: any[],
    named: Record<string, any>
  ): number {
    const o = this.bindObj(pos, named, [
      'ticker',
      'field',
      'gaps',
      'lookahead',
      'ignore_invalid_symbol',
      'currency',
    ]);
    const ticker = typeof o.ticker === 'string' && o.ticker ? o.ticker : this.symbol;
    const field =
      typeof o.field === 'string' && o.field
        ? o.field
        : kind === 'dividends'
          ? 'gross'
          : kind === 'splits'
            ? 'numerator'
            : 'actual';
    const gaps = o.gaps === true;
    const lookahead = o.lookahead === true;

    const ev = this.lookupCorporateEvents(ticker);
    if (!ev || !ev.supported) {
      this.warn(
        `request.${kind}(${ticker}): ${ev?.reason || 'veri kaynağı yok veya enstrüman desteklenmiyor; dürüst na döner.'}`
      );
      return NaN;
    }

    if (kind === 'dividends' && field === 'net') {
      this.warn(`request.dividends(${ticker}, dividends.net): Yahoo yalnız brüt temettü sağlar; dürüst na döner.`);
      return NaN;
    }
    if (kind === 'earnings' && field === 'standardized') {
      this.warn(`request.earnings(${ticker}, earnings.standardized): Yahoo bu alanı sağlamıyor; dürüst na döner.`);
      return NaN;
    }

    let perStack = this.eventCache.get(call);
    if (!perStack) {
      perStack = new Map();
      this.eventCache.set(call, perStack);
    }
    const cacheKey = `${this.stack}|${ticker}|${field}|${gaps}|${lookahead}`;
    let aligned = perStack.get(cacheKey);
    if (!aligned) {
      const pts: Array<{ time: number; value: number }> = [];
      if (kind === 'dividends') {
        for (const d of ev.dividends) {
          if (Number.isFinite(d.amount)) pts.push({ time: d.time, value: d.amount });
        }
      } else if (kind === 'splits') {
        for (const s of ev.splits) {
          const val = field === 'denominator' ? s.denominator : s.numerator;
          if (Number.isFinite(val)) pts.push({ time: s.time, value: val });
        }
      } else {
        for (const e of ev.earnings) {
          const raw = field === 'estimate' ? e.estimate : e.actual;
          if (typeof raw === 'number' && Number.isFinite(raw)) pts.push({ time: e.time, value: raw });
        }
        if (pts.length === 0) {
          this.warn(`request.earnings(${ticker}, earnings.${field}): Yahoo bu sembol için sayısal EPS verisi döndürmedi; dürüst na döner.`);
        }
      }
      aligned = this.alignEventsSeries(pts, gaps, lookahead);
      perStack.set(cacheKey, aligned);
    }
    return aligned[this.b] ?? NaN;
  }

  private currencyRateCall(call: FunctionCall, pos: any[], named: Record<string, any>): number {
    void call;
    const o = this.bindObj(pos, named, ['from', 'to', 'ignore_invalid_currency']);
    const from = String(o.from ?? '').trim().toUpperCase();
    const to = String(o.to ?? '').trim().toUpperCase();
    if (!from || !to) {
      this.warn('request.currency_rate(): geçersiz para birimi kodu; dürüst na döner.');
      return NaN;
    }
    if (from === to) return 1.0;

    const map = this.opts.currencyRates;
    const direct = map?.[`${from}/${to}`];
    const inverse = !direct ? map?.[`${to}/${from}`] : undefined;
    const series = direct ?? inverse;
    const invert = !direct && Boolean(inverse);

    if (!series || series.length === 0) {
      this.warn(`request.currency_rate(${from}, ${to}): kur verisi yok; dürüst na döner.`);
      return NaN;
    }
    const t = this.candles[this.b].time;
    let best = series[0].rate;
    for (let i = 0; i < series.length; i++) {
      if (series[i].time <= t) best = series[i].rate;
      else break;
    }
    if (!Number.isFinite(best) || best === 0) return NaN;
    return invert ? 1 / best : best;
  }

  evalSeriesOver(expr: Expression, parent: Scope): any[] {
    const out: any[] = [];
    const scope = new Scope(parent);
    this.topScope = scope;
    for (let j = 0; j < this.n; j++) {
      this.b = j;
      const c = this.candles[j];
      const bc = this.barCtx;
      bc.open = c.open;
      bc.high = c.high;
      bc.low = c.low;
      bc.close = c.close;
      bc.volume = c.volume;
      bc.time = c.time * 1000;
      bc.index = j;
      this.stack = '';
      out.push(this.eval(expr, scope));
    }
    return out;
  }

  // ------------------------------------------------------------ plot family

  private hidden(display: unknown): boolean {
    if (display === undefined) return false;
    const d = toNum(display);
    return !Number.isNaN(d) && (d & 1) === 0;
  }

  private plotCall(call: FunctionCall, pos: any[], named: Record<string, any>): any {
    const o = this.bindObj(pos, named, [
      'series', 'title', 'color', 'linewidth', 'style', 'trackprice', 'histbase', 'editable',
      'show_last', 'join', 'offset', 'format', 'display', 'precision', 'force_overlay',
    ]);
    const hidden = this.hidden(o.display);
    let a = this.stateFor<PlotAcc | null>(call, () => null);
    if (!a) {
      const style = typeof o.style === 'string' ? o.style : 'line';
      a = {
        title: o.title ? String(o.title) : `Plot ${this.plots.size + 1}`,
        color: this.color(o.color, PLOT_PALETTE[this.plots.size % PLOT_PALETTE.length]),
        lineWidth: isPlainNumber(o.linewidth) ? o.linewidth : 1, // varsayılan 1px
        style: (['line', 'histogram', 'area', 'circles', 'cross', 'stepline'].includes(style)
          ? style
          : 'line') as PlotAcc['style'],
        overlay: o.force_overlay === true ? true : this.isOverlay,
        data: recordArray(),
        colorful: false,
        hidden,
      };
      this.setState(call, a);
      this.plots.set(`${this.id(call)}${this.stack}`, a);
    }
    const handle = Object.freeze(makeHandle('plot', Object.freeze({ key: `${this.id(call)}${this.stack}` }))); // değişmez
    const v = toNum(o.series);
    if (Number.isFinite(v)) {
      const off = isPlainNumber(o.offset) ? o.offset : 0;
      const target = this.candles[this.b + off];
      if (target) {
        const pt: ScriptPlotPoint = { time: target.time, value: Number(v.toPrecision(12)) };
        const c = typeof o.color === 'string' && o.color ? o.color : undefined;
        if (a.style === 'histogram') {
          pt.color = c ?? (v >= 0 ? 'rgba(8, 153, 129, 0.75)' : 'rgba(242, 54, 69, 0.75)');
        } else if (c && c !== a.color) {
          pt.color = c;
        }
        if (a.data.length > 0 && a.data[a.data.length - 1].time === pt.time) {
          a.data[a.data.length - 1] = pt;
        } else {
          a.data.push(pt);
        }
      }
    }
    return handle;
  }

  private setState(node: object, v: any): void {
    let m = this.stateStore.get(node);
    if (!m) {
      m = new Map();
      this.stateStore.set(node, m);
    }
    m.set(this.stack, v);
  }

  private bgcolorCall(call: FunctionCall, pos: any[], named: Record<string, any>): any {
    const o = this.bindObj(pos, named, [
      'color', 'offset', 'editable', 'show_last', 'title', 'display', 'force_overlay',
    ]);
    if (this.hidden(o.display)) return null;
    const key = `${this.id(call)}${this.stack}`;
    let acc = this.bgAcc.get(key);
    if (!acc) {
      acc = {
        title: o.title ? String(o.title) : `bgcolor ${this.bgAcc.size + 1}`,
        overlay: o.force_overlay === true ? true : this.isOverlay,
        map: new Map(),
      };
      this.bgAcc.set(key, acc);
    }
    const col = typeof o.color === 'string' && o.color ? o.color : null;
    const off = isPlainNumber(o.offset) ? o.offset : 0;
    const target = this.candles[this.b + off];
    if (col && target) acc.map.set(target.time, col);
    return null;
  }

  private barcolorCall(pos: any[], named: Record<string, any>): any {
    const o = this.bindObj(pos, named, ['color', 'offset', 'editable', 'show_last', 'title', 'display']);
    if (this.hidden(o.display)) return null;
    const col = typeof o.color === 'string' && o.color ? o.color : null;
    const off = isPlainNumber(o.offset) ? o.offset : 0;
    const target = this.candles[this.b + off];
    if (col && target) this.barColorMap.set(target.time, col);
    return null;
  }

  private fillCall(call: FunctionCall, pos: any[], named: Record<string, any>): any {
    const o = this.bindObj(pos, named, [
      'plot1', 'plot2', 'color', 'title', 'editable', 'show_last', 'fillgaps', 'display',
    ]);
    const src = (h: unknown): string | number | null => {
      if (isHandle(h) && h.kind === 'plot') return String(h.props['key']);
      if (isHandle(h) && h.kind === 'hline' && isPlainNumber(h.props['price'])) return h.props['price'];
      return null;
    };
    const a = src(o.plot1);
    const b = src(o.plot2);
    if (a === null || b === null) {
      return this.err(call, 'fill(): plot() veya hline() ile üretilmiş iki nesne gerekir.');
    }
    if (this.hidden(o.display)) return null;
    const key = `${this.id(call)}${this.stack}`;
    let acc = this.fillAcc.get(key);
    if (!acc) {
      const pa = typeof a === 'string' ? this.plots.get(a) : undefined;
      acc = {
        title: o.title ? String(o.title) : `fill ${this.fillAcc.size + 1}`,
        a,
        b,
        overlay: pa ? pa.overlay : this.isOverlay,
        map: new Map(),
      };
      this.fillAcc.set(key, acc);
    }
    const col = typeof o.color === 'string' && o.color ? o.color : null;
    if (col) acc.map.set(this.candles[this.b].time, col);
    return null;
  }

  private plotOhlcCall(kind: string, call: FunctionCall, pos: any[], named: Record<string, any>): any {
    const o = this.bindObj(
      pos,
      named,
      kind === 'plotcandle'
        ? ['open', 'high', 'low', 'close', 'title', 'color', 'wickcolor', 'editable', 'show_last', 'bordercolor', 'display', 'force_overlay']
        : ['open', 'high', 'low', 'close', 'title', 'color', 'editable', 'show_last', 'display', 'force_overlay']
    );
    if (this.hidden(o.display)) return null;
    const key = `${this.id(call)}${this.stack}`;
    let acc = this.ohlcAcc.get(key);
    if (!acc) {
      acc = {
        title: o.title ? String(o.title) : kind,
        kind: kind === 'plotcandle' ? 'candle' : 'bar',
        overlay: o.force_overlay === true ? true : this.isOverlay,
        data: recordArray(),
      };
      this.ohlcAcc.set(key, acc);
    }
    const [op, hi, lo, cl] = [toNum(o.open), toNum(o.high), toNum(o.low), toNum(o.close)];
    if ([op, hi, lo, cl].every(Number.isFinite)) {
      const pt: ScriptOhlcPlot['data'][number] = { time: this.candles[this.b].time, open: op, high: hi, low: lo, close: cl };
      if (typeof o.color === 'string' && o.color) pt.color = o.color;
      if (typeof o.wickcolor === 'string' && o.wickcolor) pt.wickColor = o.wickcolor;
      if (typeof o.bordercolor === 'string' && o.bordercolor) pt.borderColor = o.bordercolor;
      acc.data.push(pt);
    }
    return null;
  }

  private plotShapeCall(kind: string, call: FunctionCall, pos: any[], named: Record<string, any>): any {
    void call;
    if (kind === 'plotarrow') {
      const o = this.bindObj(pos, named, [
        'series', 'title', 'colorup', 'colordown', 'offset', 'minheight', 'maxheight', 'editable', 'show_last', 'display',
      ]);
      const v = toNum(o.series);
      if (Number.isNaN(v) || v === 0 || this.hidden(o.display)) return null;
      this.addMarker(
        v > 0 ? 'belowBar' : 'aboveBar',
        v > 0 ? this.color(o.colorup, '#00E676') : this.color(o.colordown, '#F23645'),
        v > 0 ? 'arrowUp' : 'arrowDown',
        ''
      );
      return null;
    }
    const o =
      kind === 'plotshape'
        ? this.bindObj(pos, named, [
            'series', 'title', 'style', 'location', 'color', 'offset', 'text', 'textcolor', 'editable', 'size', 'show_last', 'display',
          ])
        : this.bindObj(pos, named, [
            'series', 'title', 'char', 'location', 'color', 'offset', 'text', 'textcolor', 'editable', 'size', 'show_last', 'display',
          ]);
    if (this.hidden(o.display) || !isTruthy(o.series)) return null;
    const loc = String(o.location ?? 'abovebar').toLowerCase();
    const style = String(o.style ?? 'circle').toLowerCase();
    const above = loc.includes('above') || loc === 'top';
    const shape: ScriptMarker['shape'] =
      style.includes('up') ? 'arrowUp' : style.includes('down') ? 'arrowDown' : 'circle';
    const dflt = shape === 'arrowDown' || above ? '#F23645' : '#00E676';
    const text = !isNa(o.text) && o.text !== undefined ? String(o.text) : kind === 'plotchar' ? String(o.char ?? '') : '';
    this.addMarker(above ? 'aboveBar' : 'belowBar', this.color(o.color, dflt), shape, text);
    return null;
  }

  private addMarker(position: ScriptMarker['position'], color: string, shape: ScriptMarker['shape'], text: string): void {
    if (this.markers.length >= 20000) return;
    this.markers.push({ time: this.candles[this.b].time, position, color, shape, text });
  }

  // ------------------------------------------------------------ drawings (line / box / label / table / linefill / polyline)

  private drawingAllArray(ns: string): ScriptArray {
    const src =
      ns === 'line'
        ? this.lineHandles
        : ns === 'box'
          ? this.boxHandles
          : ns === 'label'
            ? this.labelHandles
            : ns === 'table'
              ? this.tableHandles
              : ns === 'linefill'
                ? this.linefillHandles
                : ns === 'polyline'
                  ? this.polylineHandles
                  : [];
    return new ScriptArray(
      src.filter((h) => !h.deleted),
      ns
    );
  }

  private pushDrawing(list: ScriptHandle[], h: ScriptHandle, cap: number): void {
    list.push(h);
    let active = 0;
    for (const item of list) if (!item.deleted) active++;
    while (active > cap) {
      const oldest = list.find((item) => !item.deleted);
      if (!oldest) break;
      oldest.deleted = true;
      active--;
    }
    // Compact leading deleted handles periodically to bound memory
    if (list.length > cap * 3) {
      let cut = 0;
      while (cut < list.length && list[cut].deleted) cut++;
      if (cut > 0) list.splice(0, cut);
    }
  }

  private isChartPoint(v: unknown): v is ScriptObject {
    return v instanceof ScriptObject && v.typeName === 'chart.point';
  }

  private resolvePointsXloc(explicitXloc: unknown, ...pts: unknown[]): 'bar_time' | 'bar_index' {
    if (explicitXloc === 'bar_time') return 'bar_time';
    if (explicitXloc === 'bar_index') return 'bar_index';
    for (const pt of pts) {
      if (!this.isChartPoint(pt)) continue;
      const idx = toNum(pt.fields['index']);
      const tm = toNum(pt.fields['time']);
      if (!Number.isFinite(idx) && Number.isFinite(tm)) return 'bar_time';
    }
    return 'bar_index';
  }

  private extractPointCoords(
    pt: unknown,
    explicitXloc: unknown
  ): { x: number; y: number; xloc: string } {
    if (!this.isChartPoint(pt)) {
      return { x: NaN, y: NaN, xloc: explicitXloc === 'bar_time' ? 'bar_time' : 'bar_index' };
    }
    const idx = toNum(pt.fields['index']);
    const tm = toNum(pt.fields['time']);
    const price = toNum(pt.fields['price']);
    if (explicitXloc === 'bar_time') {
      const fallbackSec = Number.isFinite(idx) ? this.xToTime(idx, 'bar_index') : null;
      const x = Number.isFinite(tm) ? tm : fallbackSec !== null ? fallbackSec * 1000 : NaN;
      return { x, y: price, xloc: 'bar_time' };
    }
    if (explicitXloc === 'bar_index') {
      return { x: idx, y: price, xloc: 'bar_index' };
    }
    if (Number.isFinite(idx)) {
      return { x: idx, y: price, xloc: 'bar_index' };
    }
    if (Number.isFinite(tm)) {
      return { x: tm, y: price, xloc: 'bar_time' };
    }
    return { x: NaN, y: price, xloc: 'bar_index' };
  }

  private drawingCall(name: string, call: FunctionCall, pos: any[], named: Record<string, any>): any {
    const [ns, fn] = name.split('.');
    if (fn === 'new') {
      if (ns === 'linefill') {
        const [line1, line2, color] = this.bind(pos, named, ['line1', 'line2', 'color']);
        const h = makeHandle('linefill', {
          line1: isHandle(line1) && line1.kind === 'line' ? line1 : null,
          line2: isHandle(line2) && line2.kind === 'line' ? line2 : null,
          color,
          bar: this.b,
          time: this.candles[this.b].time,
        });
        this.pushDrawing(this.linefillHandles, h, 500);
        return h;
      }
      if (ns === 'polyline') {
        const o = this.bindObj(pos, named, [
          'points',
          'curved',
          'closed',
          'xloc',
          'line_color',
          'fill_color',
          'line_style',
          'line_width',
          'force_overlay',
        ]);
        const pts: ScriptObject[] =
          o.points instanceof ScriptArray
            ? o.points.items.filter((p): p is ScriptObject => this.isChartPoint(p)).map((p) => p.copy())
            : [];
        const h = makeHandle('polyline', {
          points: pts,
          curved: Boolean(o.curved),
          closed: Boolean(o.closed),
          xloc: o.xloc,
          line_color: o.line_color,
          fill_color: o.fill_color,
          line_style: o.line_style,
          line_width: o.line_width,
          bar: this.b,
          time: this.candles[this.b].time,
        });
        this.pushDrawing(this.polylineHandles, h, this.maxPolylinesCount);
        return h;
      }

      // chart.point overloads for line.new / box.new / label.new
      if (ns === 'line' && (this.isChartPoint(pos[0]) || 'first_point' in named || 'second_point' in named)) {
        const o = this.bindObj(pos, named, [
          'first_point', 'second_point', 'xloc', 'extend', 'color', 'style', 'width', 'force_overlay',
        ]);
        const effXloc = this.resolvePointsXloc(o.xloc, o.first_point, o.second_point);
        const p1 = this.extractPointCoords(o.first_point, effXloc);
        const p2 = this.extractPointCoords(o.second_point, effXloc);
        const h = makeHandle('line', {
          x1: p1.x,
          y1: p1.y,
          x2: p2.x,
          y2: p2.y,
          xloc: effXloc,
          extend: o.extend,
          color: o.color,
          style: o.style,
          width: o.width,
          bar: this.b,
          time: this.candles[this.b].time,
        });
        this.pushDrawing(this.lineHandles, h, this.maxLinesCount);
        return h;
      }
      if (ns === 'box' && (this.isChartPoint(pos[0]) || 'top_left' in named || 'bottom_right' in named)) {
        const o = this.bindObj(pos, named, [
          'top_left', 'bottom_right', 'border_color', 'border_width', 'border_style', 'extend', 'xloc',
          'bgcolor', 'text', 'text_size', 'text_color', 'text_halign', 'text_valign', 'text_wrap',
          'text_font_family', 'force_overlay', 'text_formatting',
        ]);
        const effXloc = this.resolvePointsXloc(o.xloc, o.top_left, o.bottom_right);
        const tl = this.extractPointCoords(o.top_left, effXloc);
        const br = this.extractPointCoords(o.bottom_right, effXloc);
        const h = makeHandle('box', {
          left: tl.x,
          top: tl.y,
          right: br.x,
          bottom: br.y,
          border_color: o.border_color,
          border_width: o.border_width,
          border_style: o.border_style,
          extend: o.extend,
          xloc: effXloc,
          bgcolor: o.bgcolor,
          text: o.text,
          text_size: o.text_size,
          text_color: o.text_color,
          bar: this.b,
          time: this.candles[this.b].time,
        });
        this.pushDrawing(this.boxHandles, h, this.maxBoxesCount);
        return h;
      }
      if (ns === 'label' && (this.isChartPoint(pos[0]) || 'point' in named)) {
        const o = this.bindObj(pos, named, [
          'point', 'text', 'xloc', 'yloc', 'color', 'style', 'textcolor', 'size', 'textalign', 'tooltip',
          'text_font_family', 'force_overlay', 'text_formatting',
        ]);
        const pt = this.extractPointCoords(o.point, o.xloc);
        const effXloc = o.xloc ?? pt.xloc;
        const h = makeHandle('label', {
          x: pt.x,
          y: pt.y,
          text: o.text,
          xloc: effXloc,
          yloc: o.yloc,
          color: o.color,
          style: o.style,
          textcolor: o.textcolor,
          size: o.size,
          textalign: o.textalign,
          tooltip: o.tooltip,
          bar: this.b,
          time: this.candles[this.b].time,
        });
        this.pushDrawing(this.labelHandles, h, this.maxLabelsCount);
        return h;
      }

      const nameSets: Record<string, string[]> = {
        line: ['x1', 'y1', 'x2', 'y2', 'xloc', 'extend', 'color', 'style', 'width', 'force_overlay'],
        box: ['left', 'top', 'right', 'bottom', 'border_color', 'border_width', 'border_style', 'extend', 'xloc', 'bgcolor', 'text', 'text_size', 'text_color'],
        label: ['x', 'y', 'text', 'xloc', 'yloc', 'color', 'style', 'textcolor', 'size', 'textalign', 'tooltip'],
        table: ['position', 'columns', 'rows', 'bgcolor', 'frame_color', 'frame_width', 'border_color', 'border_width'],
      };
      const keys = nameSets[ns] ?? [];
      const vals = this.bind(pos, named, keys);
      const props: Record<string, any> = {};
      keys.forEach((k, i) => (props[k] = vals[i]));
      props['bar'] = this.b;
      props['time'] = this.candles[this.b].time;
      if (ns === 'table') props['cells'] = new Map<string, Record<string, any>>();
      const h = makeHandle(ns, props);
      if (ns === 'label') this.pushDrawing(this.labelHandles, h, this.maxLabelsCount);
      else if (ns === 'line') this.pushDrawing(this.lineHandles, h, this.maxLinesCount);
      else if (ns === 'box') this.pushDrawing(this.boxHandles, h, this.maxBoxesCount);
      else if (ns === 'table') this.tableHandles.push(h);
      return h;
    }

    const target = pos[0] ?? named['id'];
    if (fn === 'delete') {
      if (isHandle(target)) target.deleted = true;
      return null;
    }
    if (fn === 'copy') {
      if (isNa(target)) return null;
      if (isHandle(target)) {
        const cloned = makeHandle(target.kind, { ...target.props });
        if (target.kind === 'line') this.pushDrawing(this.lineHandles, cloned, this.maxLinesCount);
        else if (target.kind === 'box') this.pushDrawing(this.boxHandles, cloned, this.maxBoxesCount);
        else if (target.kind === 'label') this.pushDrawing(this.labelHandles, cloned, this.maxLabelsCount);
        return cloned;
      }
      return null;
    }

    if (ns === 'linefill' && isHandle(target) && target.kind === 'linefill') {
      if (fn === 'set_color') {
        target.props['color'] = pos[1] ?? named['color'];
        return null;
      }
      if (fn === 'get_line1') return target.props['line1'] ?? null;
      if (fn === 'get_line2') return target.props['line2'] ?? null;
    }

    if (ns === 'line' && isHandle(target) && target.kind === 'line' && fn === 'get_price') {
      if (target.deleted || target.props['xloc'] === 'bar_time') return NaN;
      const x = toNum(pos[1] ?? named['x']);
      const x1 = toNum(target.props['x1']);
      const y1 = toNum(target.props['y1']);
      const x2 = toNum(target.props['x2']);
      const y2 = toNum(target.props['y2']);
      if (![x, x1, y1, x2, y2].every(Number.isFinite) || x1 === x2) return NaN;
      return y1 + ((y2 - y1) * (x - x1)) / (x2 - x1);
    }

    if (ns === 'table' && isHandle(target) && target.kind === 'table') {
      if (fn === 'cell') {
        const [, col, row, text, , , textColor, halign, , size, bg] = this.bind(pos, named, [
          'table_id', 'column', 'row', 'text', 'width', 'height', 'text_color', 'text_halign', 'text_valign', 'text_size', 'bgcolor', 'tooltip',
        ]);
        (target.props['cells'] as Map<string, Record<string, any>>).set(`${col},${row}`, {
          col, row, text, textColor, halign, size, bg,
        });
        return null;
      }
      if (fn === 'clear') {
        (target.props['cells'] as Map<string, unknown>).clear();
        return null;
      }
    }
    if (isHandle(target) && fn.startsWith('set_')) {
      const key = fn.slice(4);
      const v = pos[1];
      if (key === 'xloc') {
        if (target.kind === 'line') {
          const [, x1, x2, xloc] = this.bind(pos, named, ['id', 'x1', 'x2', 'xloc']);
          if (x1 !== undefined) target.props['x1'] = x1;
          if (x2 !== undefined) target.props['x2'] = x2;
          if (xloc !== undefined) target.props['xloc'] = xloc;
        } else if (target.kind === 'label') {
          const [, x, xloc] = this.bind(pos, named, ['id', 'x', 'xloc']);
          if (x !== undefined) target.props['x'] = x;
          if (xloc !== undefined) target.props['xloc'] = xloc;
        } else {
          target.props['xloc'] = v;
        }
      } else if (key === 'first_point' && target.kind === 'line') {
        const pt = this.extractPointCoords(pos[1] ?? named['point'], target.props['xloc']);
        target.props['x1'] = pt.x;
        target.props['y1'] = pt.y;
        if (!target.props['xloc']) target.props['xloc'] = pt.xloc;
      } else if (key === 'second_point' && target.kind === 'line') {
        const pt = this.extractPointCoords(pos[1] ?? named['point'], target.props['xloc']);
        target.props['x2'] = pt.x;
        target.props['y2'] = pt.y;
        if (!target.props['xloc']) target.props['xloc'] = pt.xloc;
      } else if (key === 'top_left_point' && target.kind === 'box') {
        const pt = this.extractPointCoords(pos[1] ?? named['point'], target.props['xloc']);
        target.props['left'] = pt.x;
        target.props['top'] = pt.y;
        if (!target.props['xloc']) target.props['xloc'] = pt.xloc;
      } else if (key === 'bottom_right_point' && target.kind === 'box') {
        const pt = this.extractPointCoords(pos[1] ?? named['point'], target.props['xloc']);
        target.props['right'] = pt.x;
        target.props['bottom'] = pt.y;
        if (!target.props['xloc']) target.props['xloc'] = pt.xloc;
      } else if (key === 'point' && target.kind === 'label') {
        const pt = this.extractPointCoords(pos[1] ?? named['point'], target.props['xloc']);
        target.props['x'] = pt.x;
        target.props['y'] = pt.y;
        if (!target.props['xloc']) target.props['xloc'] = pt.xloc;
      } else if (key === 'xy') {
        const [, x, y] = this.bind(pos, named, ['id', 'x', 'y']);
        target.props['x'] = x;
        target.props['y'] = y;
      } else if (key === 'xy1') {
        const [, x, y] = this.bind(pos, named, ['id', 'x', 'y']);
        target.props['x1'] = x;
        target.props['y1'] = y;
      } else if (key === 'xy2') {
        const [, x, y] = this.bind(pos, named, ['id', 'x', 'y']);
        target.props['x2'] = x;
        target.props['y2'] = y;
      } else if (key === 'lefttop') {
        const [, left, top] = this.bind(pos, named, ['id', 'left', 'top']);
        target.props['left'] = left;
        target.props['top'] = top;
      } else if (key === 'rightbottom') {
        const [, right, bottom] = this.bind(pos, named, ['id', 'right', 'bottom']);
        target.props['right'] = right;
        target.props['bottom'] = bottom;
      } else if (key === 'cell_bgcolor' || key === 'cell_text_color' || key === 'cell_text') {
        const cell = (target.props['cells'] as Map<string, Record<string, any>> | undefined)?.get(`${pos[1]},${pos[2]}`);
        if (cell) {
          if (key === 'cell_bgcolor') cell['bg'] = pos[3];
          else if (key === 'cell_text_color') cell['textColor'] = pos[3];
          else cell['text'] = pos[3];
        }
      } else if (key === 'text_color' && target.kind === 'label') target.props['textcolor'] = v;
      else target.props[key] = v;
      return null;
    }
    if (isHandle(target) && fn.startsWith('get_')) {
      const v = target.props[fn.slice(4)];
      return v === undefined ? NaN : v;
    }
    void call;
    return null;
  }

  /** bar_index / bar_time x coordinate → unix seconds (extrapolated beyond the data). */
  private xToTime(x: unknown, xloc: unknown): number | null {
    const v = toNum(x);
    if (!Number.isFinite(v)) return null;
    if (xloc === 'bar_time') return Math.round(v / 1000);
    const n = this.n;
    const idx = Math.round(v);
    if (idx >= 0 && idx < n) return this.candles[idx].time;
    const dt = n >= 2 ? this.candles[n - 1].time - this.candles[n - 2].time : 60;
    return idx < 0 ? this.candles[0].time + idx * dt : this.candles[n - 1].time + (idx - (n - 1)) * dt;
  }

  private resolveLineGeom(h: ScriptHandle | null): ScriptLineFillObj['l1'] | null {
    if (!h || h.deleted || h.kind !== 'line') return null;
    const p = h.props;
    const t1 = this.xToTime(p['x1'], p['xloc']);
    const t2 = this.xToTime(p['x2'], p['xloc']);
    const p1 = toNum(p['y1']);
    const p2 = toNum(p['y2']);
    if (t1 === null || t2 === null || !Number.isFinite(p1) || !Number.isFinite(p2)) return null;
    const rawExt = p['extend'];
    const extend: ScriptLineObj['extend'] =
      rawExt === 'left' || rawExt === 'right' || rawExt === 'both' ? rawExt : 'none';
    return { t1, p1, t2, p2, extend };
  }

  private buildDrawings(): ScriptDrawingsData {
    const out: ScriptDrawingsData = { lines: [], boxes: [], labels: [], tables: [], linefills: [], polylines: [] };
    const styleOf = (raw: unknown): { style: ScriptLineStyle; arrow: ScriptLineObj['arrow'] } => {
      const t = String(raw ?? 'solid');
      const style: ScriptLineStyle = t === 'dashed' ? 'dashed' : t === 'dotted' ? 'dotted' : 'solid';
      const arrow = t === 'arrow_left' ? 'left' : t === 'arrow_right' ? 'right' : t === 'arrow_both' ? 'both' : 'none';
      return { style, arrow };
    };
    const ext = (raw: unknown): ScriptLineObj['extend'] =>
      raw === 'left' || raw === 'right' || raw === 'both' ? raw : 'none';
    for (const h of this.lineHandles.filter((x) => !x.deleted).slice(-this.maxLinesCount)) {
      const p = h.props;
      const t1 = this.xToTime(p['x1'], p['xloc']);
      const t2 = this.xToTime(p['x2'], p['xloc']);
      const p1 = toNum(p['y1']);
      const p2 = toNum(p['y2']);
      if (t1 === null || t2 === null || !Number.isFinite(p1) || !Number.isFinite(p2)) continue;
      const st = styleOf(p['style']);
      out.lines.push({
        t1, p1, t2, p2,
        extend: ext(p['extend']),
        color: this.color(p['color'], '#0284C7'),
        style: st.style,
        arrow: st.arrow,
        width: isPlainNumber(p['width']) ? p['width'] : 1,
      });
    }
    for (const h of this.linefillHandles.filter((x) => !x.deleted).slice(-500)) {
      const l1 = this.resolveLineGeom(h.props['line1'] as ScriptHandle | null);
      const l2 = this.resolveLineGeom(h.props['line2'] as ScriptHandle | null);
      if (!l1 || !l2) continue;
      out.linefills!.push({
        l1,
        l2,
        color: this.color(h.props['color'], 'rgba(2, 132, 199,0.2)'),
      });
    }
    for (const h of this.polylineHandles.filter((x) => !x.deleted).slice(-this.maxPolylinesCount)) {
      const p = h.props;
      const rawPts = (p['points'] as ScriptObject[]) ?? [];
      const points: ScriptPolylineObj['points'] = [];
      for (const cp of rawPts) {
        const c = this.extractPointCoords(cp, p['xloc']);
        const t = this.xToTime(c.x, c.xloc);
        if (t !== null && Number.isFinite(c.y)) points.push({ t, p: c.y });
      }
      if (points.length < 2) continue;
      out.polylines!.push({
        points,
        curved: Boolean(p['curved']),
        closed: Boolean(p['closed']),
        lineColor: this.color(p['line_color'], '#0284C7'),
        fillColor: typeof p['fill_color'] === 'string' ? p['fill_color'] : '',
        lineStyle: styleOf(p['line_style']).style,
        lineWidth: isPlainNumber(p['line_width']) ? p['line_width'] : 1,
      });
    }
    for (const h of this.boxHandles.filter((x) => !x.deleted).slice(-this.maxBoxesCount)) {
      const p = h.props;
      const t1 = this.xToTime(p['left'], p['xloc']);
      const t2 = this.xToTime(p['right'], p['xloc']);
      const top = toNum(p['top']);
      const bottom = toNum(p['bottom']);
      if (t1 === null || t2 === null || !Number.isFinite(top) || !Number.isFinite(bottom)) continue;
      const size = String(p['text_size'] ?? 'normal');
      out.boxes.push({
        t1, t2, top, bottom,
        extend: ext(p['extend']),
        borderColor: this.color(p['border_color'], '#0284C7'),
        borderStyle: styleOf(p['border_style']).style,
        borderWidth: isPlainNumber(p['border_width']) ? p['border_width'] : 1,
        bgColor: this.color(p['bgcolor'], 'rgba(2, 132, 199,0.15)'),
        text: isNa(p['text']) ? '' : String(p['text'] ?? ''),
        textColor: this.color(p['text_color'], '#D1D4DC'),
        textSize: sizePx(size),
      });
    }
    for (const h of this.labelHandles.filter((x) => !x.deleted).slice(-this.maxLabelsCount)) {
      const p = h.props;
      const t = this.xToTime(p['x'], p['xloc']);
      if (t === null) continue;
      const yloc = p['yloc'] === 'abovebar' || p['yloc'] === 'belowbar' ? p['yloc'] : 'price';
      const y = toNum(p['y']);
      if (yloc === 'price' && !Number.isFinite(y)) continue;
      out.labels.push({
        t,
        p: Number.isFinite(y) ? y : 0,
        yloc,
        text: isNa(p['text']) ? '' : String(p['text'] ?? ''),
        color: this.color(p['color'], '#0284C7'),
        textColor: this.color(p['textcolor'], '#FFFFFF'),
        style: String(p['style'] ?? 'label_down'),
        size: sizePx(String(p['size'] ?? 'normal')),
        tooltip: isNa(p['tooltip']) ? '' : String(p['tooltip'] ?? ''),
      });
    }
    for (const h of this.tableHandles.filter((x) => !x.deleted)) {
      const p = h.props;
      const cells = [...(p['cells'] as Map<string, Record<string, any>>).values()]
        .filter((c) => isPlainNumber(c['col']) && isPlainNumber(c['row']))
        .map((c) => ({
          col: c['col'] as number,
          row: c['row'] as number,
          text: isNa(c['text']) ? '' : String(c['text'] ?? ''),
          textColor: this.color(c['textColor'], '#D1D4DC'),
          bgColor: typeof c['bg'] === 'string' ? (c['bg'] as string) : '',
          textSize: sizePx(String(c['size'] ?? 'normal')),
          halign: (c['halign'] === 'left' || c['halign'] === 'right' ? c['halign'] : 'center') as 'left' | 'center' | 'right',
        }));
      out.tables.push({
        position: String(p['position'] ?? 'top_right'),
        columns: isPlainNumber(p['columns']) ? p['columns'] : 1,
        rows: isPlainNumber(p['rows']) ? p['rows'] : 1,
        bgColor: typeof p['bgcolor'] === 'string' ? p['bgcolor'] : '',
        frameColor: typeof p['frame_color'] === 'string' ? p['frame_color'] : '',
        frameWidth: isPlainNumber(p['frame_width']) ? p['frame_width'] : 0,
        borderColor: typeof p['border_color'] === 'string' ? p['border_color'] : '',
        borderWidth: isPlainNumber(p['border_width']) ? p['border_width'] : 0,
        cells,
      } satisfies ScriptTableObj);
    }
    return out;
  }

  // ------------------------------------------------------------ strategy.*

  private strategyCall(name: string, call: FunctionCall, pos: any[], named: Record<string, any>): any {
    const bk = this.broker;
    if (!bk) {
      return this.err(call, `${name}(): strateji fonksiyonları yalnızca strategy() betiğinde kullanılabilir.`);
    }
    const dirOf = (v: unknown): 1 | -1 => (String(v).includes('short') ? -1 : 1);
    const optNum = (v: unknown) => (isPlainNumber(v) ? v : undefined);
    const when = named['when'];
    if (when !== undefined && !isTruthy(when)) return null;
    const cmt = (v: unknown) => (isNa(v) || v === undefined ? '' : String(v));

    switch (name) {
      case 'strategy.entry':
      case 'strategy.order': {
        const [id, dir, qty, limit, stop, , , comment] = this.bind(pos, named, [
          'id', 'direction', 'qty', 'limit', 'stop', 'oca_name', 'oca_type', 'comment',
        ]);
        const o = { qty: optNum(qty), limit: optNum(limit), stop: optNum(stop), comment: cmt(comment) };
        if (name === 'strategy.entry') bk.entry(String(id), dirOf(dir), o, this.b);
        else bk.order(String(id), dirOf(dir), o, this.b);
        return null;
      }
      case 'strategy.close': {
        const [id, comment, qty, qtyPercent] = this.bind(pos, named, ['id', 'comment', 'qty', 'qty_percent']);
        bk.close(String(id), { qty: optNum(qty), qtyPercent: optNum(qtyPercent), comment: cmt(comment) }, this.b);
        return null;
      }
      case 'strategy.close_all': {
        const [comment] = this.bind(pos, named, ['comment']);
        bk.closeAll(cmt(comment), this.b);
        return null;
      }
      case 'strategy.exit': {
        const v = this.bind(pos, named, [
          'id', 'from_entry', 'qty', 'qty_percent', 'profit', 'limit', 'loss', 'stop', 'trail_price',
          'trail_points', 'trail_offset', 'oca_name', 'comment', 'comment_profit', 'comment_loss', 'comment_trailing',
        ]);
        bk.exit({
          id: String(v[0]),
          fromEntry: isNa(v[1]) || v[1] === undefined ? '' : String(v[1]),
          qty: optNum(v[2]),
          qtyPercent: optNum(v[3]),
          profitTicks: optNum(v[4]),
          limit: optNum(v[5]),
          lossTicks: optNum(v[6]),
          stop: optNum(v[7]),
          trailPrice: optNum(v[8]),
          trailPoints: optNum(v[9]),
          trailOffset: optNum(v[10]),
          comment: cmt(v[12]),
          commentProfit: cmt(v[13]) || undefined,
          commentLoss: cmt(v[14]) || undefined,
          commentTrailing: cmt(v[15]) || undefined,
        });
        return null;
      }
      case 'strategy.cancel':
        bk.cancel(String(pos[0] ?? named['id']));
        return null;
      case 'strategy.cancel_all':
        bk.cancelAll();
        return null;
      case 'strategy.closedtrades.profit':
        return bk.closedTrade(toNum(pos[0]))?.profit ?? NaN;
      case 'strategy.closedtrades.entry_price':
        return bk.closedTrade(toNum(pos[0]))?.entryPrice ?? NaN;
      case 'strategy.closedtrades.exit_price':
        return bk.closedTrade(toNum(pos[0]))?.exitPrice ?? NaN;
      case 'strategy.closedtrades.size': {
        const t = bk.closedTrade(toNum(pos[0]));
        return t ? t.dir * t.qty : NaN;
      }
      case 'strategy.opentrades.entry_price':
        return bk.openTradeInfo(toNum(pos[0]))?.entryPrice ?? NaN;
      case 'strategy.opentrades.size':
        return bk.openTradeInfo(toNum(pos[0]))?.size ?? NaN;
      case 'strategy.opentrades.profit':
        return bk.openTradeInfo(toNum(pos[0]))?.profit ?? NaN;
    }
    return this.err(call, `Desteklenmeyen strateji fonksiyonu '${name}'.`);
  }
}

function sizePx(size: string): number {
  switch (size) {
    case 'tiny': return 8;
    case 'small': return 10;
    case 'large': return 14;
    case 'huge': return 18;
    default: return 12;
  }
}

const PLOT_PALETTE = ['#0284C7', '#FF9800', '#00E676', '#E040FB', '#00BCD4', '#FFD54F'];

/** Defaults for omitted optional ta args (indexes follow TA_SIGS). */
const TA_ARG_DEFAULTS: Record<string, any[]> = {
  macd: [undefined, 12, 26, 9],
  bb: [undefined, 20, 2],
  bbw: [undefined, 20, 2],
  supertrend: [3, 10],
  dmi: [14, 14],
  change: [undefined, 1],
  mom: [undefined, 10],
  roc: [undefined, 10],
  valuewhen: [undefined, undefined, 0],
  linreg: [undefined, undefined, 0],
  stdev: [undefined, undefined, true],
  kc: [undefined, 20, 1.5, true],
  kcw: [undefined, 20, 1.5, true],
  alma: [undefined, undefined, 0.85, 6, false],
  sar: [0.02, 0.02, 0.2],
  pivot_point_levels: ['Traditional', false, false],
};

const TA_REQUIRED = new Set([
  'sma.length', 'ema.length', 'rma.length', 'wma.length', 'vwma.length', 'hma.length', 'rsi.length',
  'atr.length', 'stdev.length', 'highest.length', 'lowest.length', 'sum.length', 'cci.length',
  'mfi.length', 'linreg.length', 'stoch.length', 'median.length', 'dev.length', 'rising.length', 'falling.length',
  'cmo.length', 'range.length', 'highestbars.length', 'lowestbars.length', 'variance.length',
  'pivothigh.leftbars', 'pivothigh.rightbars', 'pivotlow.leftbars', 'pivotlow.rightbars',
  'alma.length', 'wpr.length', 'tsi.short_length', 'tsi.long_length', 'cog.length',
  'percentrank.length', 'percentile_linear_interpolation.length', 'percentile_linear_interpolation.percentage',
  'percentile_nearest_rank.length', 'percentile_nearest_rank.percentage',
  'correlation.length', 'mode.length', 'rci.length',
]);

export function runVm(program: Program, candles: Candle[], opts: RunOptions = {}): VmResult {
  beginTaRun();
  try {
    return new ScriptVM(program, candles, opts).run();
  } finally {
    endTaRun();
  }
}

// ------------------------------------------------------------ Faz 30: artımlı hesap yardımcıları

/** Adımlayıcı çağrılarını (bar, argümanlar) kaydeder; çatallanmada aynı fabrikadan yeniden oynatılır. */
interface StepperRecord {
  factory: (env: TaEnv) => Stepper;
  owner: ScriptVM;
  log: any[];
}
type RecordedStepper = Stepper & { __rec?: StepperRecord };

/**
 * Yalnız eklenen ve öğeleri hiç yerinde değiştirilmeyen kayıt dizileri (plot noktaları, işaretler).
 * Çatallanmada öğeler paylaşılır, dizi sığ kopyalanır (5000 noktalı plotlar için ~10× hızlı).
 */
const RECORD_ARRAYS = new WeakSet<object>();
function recordArray<T>(): T[] {
  const a: T[] = [];
  RECORD_ARRAYS.add(a);
  return a;
}

let recordingSteppers = false;
/** Oturum koşularında true: adımlayıcı çağrıları kaydedilir (tam koşularda ek maliyet yok). */
export function setStepperRecording(on: boolean): void {
  recordingSteppers = on;
}

function recordedStepper(factory: (env: TaEnv) => Stepper, env: TaEnv, owner: ScriptVM): Stepper {
  const inner = factory(env);
  if (!recordingSteppers) return inner;
  const rec: StepperRecord = { factory, owner, log: [] };
  // Düz kayıt: [bar, argc, ...args] — çağrı başına dizi tutulmaz (100k barda bellek)
  const f: RecordedStepper = (...args: any[]) => {
    rec.log.push((owner as unknown as { b: number }).b, args.length, ...args);
    return inner(...args);
  };
  f.__rec = rec;
  return f;
}

export class NotForkableError extends Error {}

/** Programın (ve kütüphanelerinin) AST düğümleri: çatallanmada paylaşılır, kopyalanmaz. */
export function collectAstAtoms(program: Program, tc?: TypeCheckResult | null): Set<object> {
  const seen = new Set<object>();
  const walk = (v: unknown): void => {
    if (!v || typeof v !== 'object' || seen.has(v as object)) return;
    seen.add(v as object);
    if (Array.isArray(v)) {
      for (const x of v) walk(x);
      return;
    }
    if (v instanceof Map) {
      for (const [k, x] of v) {
        walk(k);
        walk(x);
      }
      return;
    }
    for (const k of Object.keys(v as object)) walk((v as Record<string, unknown>)[k]);
  };
  walk(program);
  if (tc?.libraries) for (const mod of tc.libraries.values()) walk(mod);
  return seen;
}

// tupleKeys/paramKeys: AST → sentetik anahtar nesneleri (cellStore anahtarı); kimlik korunmalı, paylaşılır.
const SHARED_VM_FIELDS = new Set(['program', 'candles', 'opts', 'tc', 'nodeIds', 'tupleKeys', 'paramKeys', 'ltfCache', 'eventCache', 'isChild']);
let forkSeq = 0;

function forkVm(src: ScriptVM, candles: Candle[], atoms: Set<object>): ScriptVM {
  const memo = new Map<object, unknown>();
  const pendingReplays: Array<() => void> = [];
  const forkId = ++forkSeq;

  const cloneVmInstance = (vm: ScriptVM, cands: Candle[] | null): ScriptVM => {
    const out = Object.create(Object.getPrototypeOf(vm)) as ScriptVM;
    memo.set(vm, out);
    const sf = vm._forkFields();
    const of = out as unknown as Record<string, unknown>;
    // env/barCtx önce: alan kopyalarken yeniden kurulan adımlayıcılar bu env'i yakalar
    const barCtx = clone(sf.barCtx) as BarCtx;
    of.barCtx = barCtx;
    let replayCtx: BarCtx | null = null;
    of.env = { bar: () => replayCtx ?? barCtx };
    (of as { __setReplayCtx?: (c: BarCtx | null) => void }).__setReplayCtx = (c) => (replayCtx = c);
    for (const k of Object.keys(sf)) {
      if (k === 'barCtx' || k === '__setReplayCtx') continue;
      if (SHARED_VM_FIELDS.has(k)) of[k] = sf[k];
      else if (k === 'env' || k === 'builtinTaSeries') continue;
      else of[k] = clone(sf[k]);
    }
    if (cands) {
      of.candles = cands;
      of.n = cands.length;
    }
    of.builtinTaSeries = new Map(); // tembel: ihtiyaç olunca mumlardan yeniden hesaplanır
    // Yeni düğüm kimlikleri ortak WeakMap'te çakışmasın diye her çatala ayrı aralık
    of.nextId = (sf.nextId as number) + forkId * 1_000_000;
    return out;
  };

  const replayStepper = (fn: RecordedStepper): Stepper => {
    const rec = fn.__rec!;
    const owner = clone(rec.owner) as ScriptVM;
    const of = owner as unknown as { env: TaEnv; candles: Candle[]; __setReplayCtx: (c: BarCtx | null) => void };
    const inner = rec.factory(of.env);
    const nrec: StepperRecord = { factory: rec.factory, owner, log: rec.log.slice() };
    const f: RecordedStepper = (...args: any[]) => {
      nrec.log.push((owner as unknown as { b: number }).b, args.length, ...args);
      return inner(...args);
    };
    f.__rec = nrec;
    // Yeniden oynatma tüm alanlar kopyalandıktan sonra (owner.candles hazır) yapılır
    pendingReplays.push(() => {
      const ctx: BarCtx = { open: NaN, high: NaN, low: NaN, close: NaN, volume: NaN, time: NaN, index: 0 };
      of.__setReplayCtx(ctx);
      const log = rec.log;
      for (let i = 0; i < log.length; ) {
        const b = log[i] as number;
        const argc = log[i + 1] as number;
        const args = log.slice(i + 2, i + 2 + argc);
        i += 2 + argc;
        const c = of.candles[b];
        if (c) {
          ctx.open = c.open;
          ctx.high = c.high;
          ctx.low = c.low;
          ctx.close = c.close;
          ctx.volume = c.volume;
          ctx.time = c.time * 1000;
        }
        ctx.index = b;
        inner(...args);
      }
      of.__setReplayCtx(null);
    });
    return f;
  };

  const clone = (v: unknown): unknown => {
    if (v === null || typeof v !== 'object') {
      if (typeof v === 'function') {
        const hit = memo.get(v as object);
        if (hit) return hit;
        if ((v as RecordedStepper).__rec) {
          const f = replayStepper(v as RecordedStepper);
          memo.set(v as object, f);
          return f;
        }
        throw new NotForkableError('kopyalanamayan işlev');
      }
      return v;
    }
    if (atoms.has(v) || Object.isFrozen(v)) return v;
    const hit = memo.get(v);
    if (hit !== undefined) return hit;
    if (v instanceof ScriptVM) return cloneVmInstance(v, null);
    if (Array.isArray(v)) {
      if (RECORD_ARRAYS.has(v)) {
        const a = v.slice();
        RECORD_ARRAYS.add(a);
        memo.set(v, a);
        return a;
      }
      let prim = true;
      for (let i = 0; i < v.length; i++) {
        const x = v[i];
        if (x !== null && (typeof x === 'object' || typeof x === 'function')) {
          prim = false;
          break;
        }
      }
      if (prim) {
        const a = v.slice();
        memo.set(v, a);
        return a;
      }
      const a: unknown[] = new Array(v.length);
      memo.set(v, a);
      for (let i = 0; i < v.length; i++) a[i] = clone(v[i]);
      return a;
    }
    if (v instanceof Map) {
      const m = new Map();
      memo.set(v, m);
      // Anahtarlar kopyalanmaz: AST düğümleri / sentetik anahtarlar / ilkel değerler (kimlik korunur)
      for (const [k, x] of v) m.set(k, clone(x));
      return m;
    }
    if (v instanceof Set) {
      const st = new Set();
      memo.set(v, st);
      for (const x of v) st.add(clone(x));
      return st;
    }
    if (v instanceof WeakMap || v instanceof WeakSet || v instanceof Promise) throw new NotForkableError('zayıf/eşzamansız nesne');
    if (ArrayBuffer.isView(v)) {
      const t = (v as unknown as { slice(): unknown }).slice();
      memo.set(v, t);
      return t;
    }
    const o = Object.create(Object.getPrototypeOf(v));
    memo.set(v, o);
    for (const k of Object.keys(v)) o[k] = clone((v as Record<string, unknown>)[k]);
    return o;
  };

  const out = cloneVmInstance(src, candles);
  for (const r of pendingReplays) r();
  return out;
}

export { colorNew };
