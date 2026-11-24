export type MarketType = 'CRYPTO' | 'BIST' | 'US' | 'FOREX';
export type ProviderType = 'BINANCE' | 'YAHOO';
export type StandardTimeframe =
  | '1s' | '5s' | '10s' | '15s' | '30s'
  | '1m' | '3m' | '5m' | '15m' | '30m' | '45m'
  | '1h' | '2h' | '3h' | '4h' | '6h' | '8h' | '12h'
  | '1d' | '2d' | '3d' | '1w' | '1M' | '3M' | '6M' | '12M';
/** Standart + kullanıcı tanımlı özel aralıklar (`7s`, `10m`, `5h`, `4d`, `2M`...). */
export type Timeframe = StandardTimeframe | (string & {});
export type ChartStyleMode =
  | 'candles'
  | 'hollow'
  | 'heikin'
  | 'line'
  | 'area'
  | 'baseline'
  | 'bar'
  | 'stepline'
  | 'linemarkers'
  | 'renko'
  | 'linebreak'
  | 'range'
  | 'volcandles'
  | 'hlcarea'
  | 'columns'
  | 'highlow'
  | 'kagi'
  | 'pnf'
  | 'svp'
  | 'tpo'
  | 'footprint';
export type PriceScaleKind = 'normal' | 'log' | 'percent' | 'indexed';

export interface Candle {
  time: number; // UTC Unix seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface HistoryResponse {
  symbol: string;
  interval: Timeframe;
  displayName: string;
  market: MarketType;
  currency: string;
  nativeCurrency?: string;
  provider: ProviderType;
  delayMinutes: number;
  cacheHit: boolean;
  fetchedGaps: number;
  queryMs: number;
  candles: Candle[];
}

export interface SymbolQuoteSummary {
  symbol: string;
  displayName: string;
  market: MarketType;
  exchange: string;
  currency: string;
  provider: ProviderType;
  delayMinutes: number;
  /** null when no real cached data exists yet — never a fabricated number. */
  lastPrice: number | null;
  changeAbs?: number | null;
  changePercent: number | null;
  high24h?: number | null;
  low24h?: number | null;
  volume24h?: number | null;
  extPrice?: number | null;
  extChangePct?: number | null;
  extSession?: 'pre' | 'post' | '';
  techRating?: 'STRONG_BUY' | 'BUY' | 'NEUTRAL' | 'SELL' | 'STRONG_SELL' | null;
  techScore?: number | null;
}

export type TechnicalRating = 'STRONG_BUY' | 'BUY' | 'NEUTRAL' | 'SELL' | 'STRONG_SELL';

export interface ScreenerRow {
  symbol: string;
  displayName: string;
  market: MarketType;
  exchange: string;
  currency: string;
  lastPrice: number;
  openPrice?: number;
  highPrice?: number;
  lowPrice?: number;
  prevClose?: number;
  changeAbs?: number;
  changePercent: number;
  gapPct?: number;
  volume: number;
  avgVolume10?: number;
  avgVolume20?: number;
  avgVolume30?: number;
  avgVolume60?: number;
  avgVolume90?: number;
  relVolume?: number;
  turnover?: number;
  extPrice?: number | null;
  extChangePct?: number | null;

  // Performance & 52W Range
  perf1w?: number | null;
  perf1m?: number | null;
  perf3m?: number | null;
  perf6m?: number | null;
  perfYtd?: number | null;
  perf1y?: number | null;
  high52w?: number;
  low52w?: number;
  from52wHighPct?: number;
  from52wLowPct?: number;
  high1m?: number;
  low1m?: number;
  high3m?: number;
  low3m?: number;
  posIn52wRange?: number;
  posInDayRange?: number;

  // Moving Averages
  sma5?: number;
  sma10?: number;
  sma20?: number;
  sma30?: number;
  sma50?: number;
  sma100?: number;
  sma200: number;
  ema5?: number;
  ema10?: number;
  ema12?: number;
  ema20: number;
  ema26?: number;
  ema30?: number;
  ema50: number;
  ema100?: number;
  ema200?: number;
  wma20?: number;
  vwma20?: number;
  hma9?: number;
  distSma20Pct?: number;
  distSma50Pct?: number;
  distSma200Pct?: number;

  // Oscillators
  rsi7?: number;
  rsi14: number;
  rsi21?: number;
  stochK?: number;
  stochD?: number;
  stochRsiK?: number;
  stochRsiD?: number;
  macd: number;
  macdSignal?: number;
  macdHist?: number;
  cci20?: number;
  williamsR14?: number;
  mfi14?: number;
  roc9?: number;
  roc20?: number;
  momentum10?: number;
  ao?: number;
  uo?: number;
  cmo14?: number;
  bullPower13?: number;
  bearPower13?: number;
  zScore20?: number;

  // Trend, Volatility & Flow
  adx14?: number;
  plusDi14?: number;
  minusDi14?: number;
  supertrend?: number;
  supertrendDir?: number;
  psar?: number;
  aroonUp14?: number;
  aroonDown14?: number;
  aroonOsc14?: number;
  ichimokuTenkan?: number;
  ichimokuKijun?: number;
  ichimokuSpanA?: number;
  ichimokuSpanB?: number;
  atr14?: number;
  atr14Pct?: number;
  natr14?: number;
  bbUpper20?: number;
  bbMiddle20?: number;
  bbLower20?: number;
  bbWidthPct?: number;
  bbPercentB?: number;
  kcUpper20?: number;
  kcLower20?: number;
  donchianHigh20?: number;
  donchianLow20?: number;
  volAnnualPct?: number;
  vol30dPct?: number;
  maxDrawdownPct?: number;
  cmf20?: number;
  obvSlopePct?: number;
  vwap?: number;

  // Ratings & Patterns
  rating: TechnicalRating;
  score: number;
  maRating?: TechnicalRating;
  maScore?: number;
  oscRating?: TechnicalRating;
  oscScore?: number;
  candlePattern?: string;
  streak?: number;

  // Fundamentals & Valuation
  isEtf?: boolean;
  marketCap?: number | null;
  enterpriseValue?: number | null;
  trailingPe?: number | null;
  forwardPe?: number | null;
  priceToBook?: number | null;
  priceToSales?: number | null;
  evToEbitda?: number | null;
  trailingEps?: number | null;
  dividendYieldPct?: number | null;
  dividendRate?: number | null;
  grossMarginPct?: number | null;
  operatingMarginPct?: number | null;
  profitMarginPct?: number | null;
  roePct?: number | null;
  roaPct?: number | null;
  debtToEquity?: number | null;
  currentRatio?: number | null;
  quickRatio?: number | null;
  beta?: number | null;
  totalRevenue?: number | null;
  netIncome?: number | null;
  freeCashFlow?: number | null;
}

export type FlagColor = 'red' | 'blue' | 'green' | 'orange' | 'purple' | 'cyan' | 'pink';

export interface WatchlistEntry {
  type: 'symbol' | 'section';
  symbol?: string;
  id?: string;
  title?: string;
  collapsed?: boolean;
}

export interface SavedWatchlist {
  id: string;
  name: string;
  items: WatchlistEntry[];
  isDefault?: boolean;
  createdAt?: number;
  updatedAt?: number;
}

export type WatchlistColumnKey = 'last' | 'chg' | 'chgPct' | 'vol' | 'ext' | 'tech';

export interface SymbolNote {
  id: string;
  symbol: string;
  title: string;
  body: string;
  tags: string;
  sentiment: 'bull' | 'bear' | 'neutral';
  snapshotPrice: number;
  timeframe: string;
  pinned: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface ScreenerFilterRule {
  id: string;
  field: string;
  op: 'gt' | 'gte' | 'lt' | 'lte' | 'between' | 'eq' | 'neq' | 'above_field' | 'below_field';
  value: number | string;
  value2?: number;
  rhsField?: string;
}

export interface SavedScreenerPreset {
  id: string;
  name: string;
  market: string;
  timeframe: string;
  columnSet: string;
  config: {
    filters: ScreenerFilterRule[];
    sortCol?: string;
    sortDir?: 'asc' | 'desc';
  };
  createdAt?: number;
  updatedAt?: number;
}

export interface ScriptScreenerFilter {
  target: string;
  op:
    | 'any_alert'
    | 'alert_title'
    | 'gt'
    | 'gte'
    | 'lt'
    | 'lte'
    | 'eq'
    | 'neq'
    | 'between'
    | 'cross_up'
    | 'cross_down'
    | 'rising'
    | 'falling'
    | 'truthy'
    | 'not_na';
  value?: number;
  value2?: number;
  rhsPlot?: string;
}

export interface ScriptScreenerPlotCol {
  id: string;
  title: string;
}

export interface ScriptScreenerRow {
  symbol: string;
  displayName: string;
  market: MarketType;
  exchange: string;
  currency: string;
  lastPrice: number;
  changePercent: number;
  volume: number;
  plots: Record<string, number | null>;
  prevPlots?: Record<string, number | null>;
  alertsFired: string[];
  alertConditions?: string[];
  matched: boolean;
  executionMs: number;
}

export interface ScriptScreenerResponse {
  ok: boolean;
  error?: string;
  scriptTitle: string;
  timeframe: string;
  columns: ScriptScreenerPlotCol[];
  conditions: string[];
  rows: ScriptScreenerRow[];
}

export interface LiveCandleMessage {
  type: 'candle_update';
  symbol: string;
  interval: Timeframe;
  provider: ProviderType;
  delayMinutes: number;
  isClosed: boolean;
  candle: Candle;
}

export type DrawingToolType =
  | 'cursor'
  | 'trendline'
  | 'ray'
  | 'extended'
  | 'arrow'
  | 'info_line'
  | 'hray'
  | 'price_label'
  | 'price_range'
  | 'date_range'
  | 'fixed_vp'
  | 'pitchfork'
  | 'hline'
  | 'vline'
  | 'channel'
  | 'fib'
  | 'fib_ext'
  | 'ellipse'
  | 'rect'
  | 'long_pos'
  | 'short_pos'
  | 'ruler'
  | 'text'
  | 'brush'
  | 'trend_angle'
  | 'cross_line'
  | 'regression'
  | 'flat_channel'
  | 'disjoint_channel'
  | 'schiff_pitchfork'
  | 'mod_schiff_pitchfork'
  | 'inside_pitchfork'
  | 'fib_channel'
  | 'fib_timezone'
  | 'fib_speed_fan'
  | 'fib_trend_time'
  | 'fib_circles'
  | 'fib_spiral'
  | 'fib_speed_arcs'
  | 'fib_wedge'
  | 'fib_pitchfan'
  | 'gann_box'
  | 'gann_square_fixed'
  | 'gann_square'
  | 'gann_fan'
  | 'highlighter'
  | 'arrow_marker'
  | 'arrow_up'
  | 'arrow_down'
  | 'rotated_rect'
  | 'path'
  | 'circle'
  | 'polyline'
  | 'triangle'
  | 'arc'
  | 'curve'
  | 'double_curve'
  // Faz 22: formasyonlar + Elliott + döngüler
  | 'xabcd'
  | 'cypher'
  | 'head_shoulders'
  | 'abcd'
  | 'triangle_pattern'
  | 'three_drives'
  | 'elliott_impulse'
  | 'elliott_correction'
  | 'elliott_triangle'
  | 'elliott_double'
  | 'elliott_triple'
  | 'cyclic_lines'
  | 'time_cycles'
  | 'sine_line'
  // Faz 22: tahmin
  | 'forecast'
  | 'date_price_range'
  | 'bars_pattern'
  | 'ghost_feed'
  | 'projection'
  | 'anchored_vwap'
  | 'anchored_vp'
  // Faz 22: yazı / not / ikon
  | 'anchored_text'
  | 'note'
  | 'price_note'
  | 'pin'
  | 'table'
  | 'callout'
  | 'comment'
  | 'signpost'
  | 'flag_mark'
  | 'icon';

/** Zaman dilimi birimleri ("Görünürlük" sekmesi). */
export type TfUnit = 'sec' | 'min' | 'hour' | 'day' | 'week' | 'month';
/** Birim başına görünür aralık [min, max]; null = o birimde gizli; anahtar yoksa görünür. */
export type DrawingVisibility = Partial<Record<TfUnit, [number, number] | null>>;

export interface TimePricePoint {
  time: number;
  price: number;
}

export interface DrawingObject {
  id: string;
  symbol: string;
  timeframe: string;
  toolType: DrawingToolType;
  points: TimePricePoint[];
  color: string;
  label?: string;
  /** çizgi kalınlığı (px); tanımsızsa aracın varsayılanı */
  width?: number;
  lineStyle?: 'solid' | 'dashed' | 'dotted';
  locked?: boolean;
  hidden?: boolean;
  /** ikon aracı: `iconSet.ts` anahtarı veya emoji */
  icon?: string;
  /** yazı araçları: punto */
  fontSize?: number;
  /** aralıklara göre görünürlük */
  visibility?: DrawingVisibility;
  /** çubuk deseni: [o, h, l, c] ilk açılışa göre fark (anlık görüntü) */
  bars?: Array<[number, number, number, number]>;
  /** Faz 25: çizim eşitleme kapsamı ('' = genel, 'lay_...' = düzen içi, 'lay_...#slot:N' = grafik yerel) */
  layoutId?: string;
}

export interface ScriptPlotPoint {
  time: number;
  value: number;
  color?: string;
}

export interface ScriptPlotSeries {
  id: string;
  title: string;
  color: string;
  lineWidth: number;
  style: 'line' | 'histogram' | 'area' | 'circles' | 'cross' | 'stepline';
  /** hline-style dash for line plots */
  lineStyle?: ScriptLineStyle;
  isOverlay: boolean;
  hidden?: boolean;
  data: ScriptPlotPoint[];
}

export interface ScriptColorPoint {
  time: number;
  color: string;
}

/** bgcolor(): per-bar background shading (one entry per call site). */
export interface ScriptBgColor {
  title: string;
  isOverlay: boolean;
  points: ScriptColorPoint[];
}

/** fill() endpoint: a plot series id or a constant hline price. */
export type ScriptFillRef = { plot: string } | { price: number };

export interface ScriptFill {
  title: string;
  a: ScriptFillRef;
  b: ScriptFillRef;
  isOverlay: boolean;
  /** per-bar fill color (na bars are absent) */
  points: ScriptColorPoint[];
}

/** plotcandle()/plotbar(): OHLC series drawn on top of / below the chart. */
export interface ScriptOhlcPlot {
  id: string;
  title: string;
  kind: 'candle' | 'bar';
  isOverlay: boolean;
  data: {
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
    color?: string;
    wickColor?: string;
    borderColor?: string;
  }[];
}

export type ScriptLineStyle = 'solid' | 'dashed' | 'dotted';

export interface ScriptLineObj {
  t1: number;
  p1: number;
  t2: number;
  p2: number;
  extend: 'none' | 'left' | 'right' | 'both';
  color: string;
  style: ScriptLineStyle;
  width: number;
  arrow: 'none' | 'left' | 'right' | 'both';
}

export interface ScriptBoxObj {
  t1: number;
  t2: number;
  top: number;
  bottom: number;
  extend: 'none' | 'left' | 'right' | 'both';
  borderColor: string;
  borderStyle: ScriptLineStyle;
  borderWidth: number;
  bgColor: string;
  text: string;
  textColor: string;
  textSize: number;
}

export interface ScriptLabelObj {
  t: number;
  p: number;
  /** 'price' = at p; 'abovebar' / 'belowbar' = relative to bar high/low */
  yloc: 'price' | 'abovebar' | 'belowbar';
  text: string;
  color: string;
  textColor: string;
  style: string;
  size: number;
  tooltip: string;
}

export interface ScriptTableCell {
  col: number;
  row: number;
  text: string;
  textColor: string;
  bgColor: string;
  textSize: number;
  halign: 'left' | 'center' | 'right';
}

export interface ScriptTableObj {
  position: string;
  columns: number;
  rows: number;
  bgColor: string;
  frameColor: string;
  frameWidth: number;
  borderColor: string;
  borderWidth: number;
  cells: ScriptTableCell[];
}

export interface ScriptLineFillObj {
  l1: { t1: number; p1: number; t2: number; p2: number; extend: 'none' | 'left' | 'right' | 'both' };
  l2: { t1: number; p1: number; t2: number; p2: number; extend: 'none' | 'left' | 'right' | 'both' };
  color: string;
}

export interface ScriptPolylineObj {
  points: Array<{ t: number; p: number }>;
  curved: boolean;
  closed: boolean;
  lineColor: string;
  fillColor: string;
  lineStyle: ScriptLineStyle;
  lineWidth: number;
}

export interface ScriptDrawingsData {
  lines: ScriptLineObj[];
  boxes: ScriptBoxObj[];
  labels: ScriptLabelObj[];
  tables: ScriptTableObj[];
  linefills?: ScriptLineFillObj[];
  polylines?: ScriptPolylineObj[];
}

export interface ScriptMarker {
  time: number;
  position: 'aboveBar' | 'belowBar';
  color: string;
  shape: 'arrowUp' | 'arrowDown' | 'circle';
  text: string;
  /** Faz 24: strateji emir dolumu işaretçisi (işlem katmanı çizdiğinde yinelenmesin diye) */
  source?: 'broker';
}

export interface ScriptHLine {
  price: number;
  title: string;
  color: string;
}

export interface BacktestTrade {
  id: number;
  direction: 'LONG' | 'SHORT';
  entryTime: number;
  entryPrice: number;
  exitTime: number;
  exitPrice: number;
  pnlPercent: number;
  pnlCash: number;
  equityAfter: number;
  qty?: number;
  entryId?: string;
  entryComment?: string;
  exitComment?: string;
  commission?: number;
}

export interface BacktestReport {
  initialCapital: number;
  finalEquity: number;
  netProfitCash: number;
  netProfitPercent: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRatePercent: number;
  profitFactor: number;
  maxDrawdownPercent: number;
  trades: BacktestTrade[];
  openTrades?: number;
  /** Faz 23: son emir dolumları (zaman, al/sat, miktar, fiyat, emir kimliği, sonraki pozisyon) */
  fills?: { time: number; action: 'buy' | 'sell'; qty: number; price: number; id: string; comment: string; positionSize: number }[];
  openProfitCash?: number;
  commissionPaid?: number;
  equityCurve?: { time: number; value: number }[];
}

export interface ScriptInputDef {
  id?: string;
  title: string;
  type: string;
  defval: unknown;
  value?: unknown;
  group?: string;
  inline?: string;
  tooltip?: string;
  confirm?: boolean;
  display?: number;
  active?: boolean;
  min?: number;
  max?: number;
  step?: number;
  options?: unknown[];
}

export interface ScriptLogEntry {
  level: 'info' | 'warning' | 'error';
  time: number;
  barIndex: number;
  line: number;
  message: string;
}

export interface DividendEvent {
  time: number;
  amount: number;
}

export interface SplitEvent {
  time: number;
  numerator: number;
  denominator: number;
  ratio?: string;
}

export interface EarningsEvent {
  time: number;
  actual?: number | null;
  estimate?: number | null;
}

export interface CorporateEventsData {
  symbol: string;
  supported: boolean;
  reason?: string;
  dividends: DividendEvent[];
  splits: SplitEvent[];
  earnings: EarningsEvent[];
}

export interface FxRatePoint {
  time: number;
  rate: number;
}

export interface FxRatesResponse {
  from: string;
  to: string;
  pair: string;
  supported: boolean;
  reason?: string;
  rates: FxRatePoint[];
}

export interface FinancialPeriodRow {
  period: string;
  date: string;
  totalRevenue?: number | null;
  grossProfit?: number | null;
  operatingIncome?: number | null;
  ebitda?: number | null;
  pretaxIncome?: number | null;
  netIncome?: number | null;
  dilutedEps?: number | null;
  totalAssets?: number | null;
  currentAssets?: number | null;
  cashAndEquivalents?: number | null;
  nonCurrentAssets?: number | null;
  totalLiabilities?: number | null;
  currentLiabilities?: number | null;
  nonCurrentLiabilities?: number | null;
  totalDebt?: number | null;
  netDebt?: number | null;
  stockholdersEquity?: number | null;
  operatingCashFlow?: number | null;
  capitalExpenditure?: number | null;
  freeCashFlow?: number | null;
  investingCashFlow?: number | null;
  financingCashFlow?: number | null;
}

export interface FinancialRatios {
  marketCap?: number | null;
  enterpriseValue?: number | null;
  trailingPe?: number | null;
  forwardPe?: number | null;
  priceToBook?: number | null;
  priceToSales?: number | null;
  enterpriseToEbitda?: number | null;
  trailingEps?: number | null;
  dividendYieldPct?: number | null;
  dividendRate?: number | null;
  grossMarginPct?: number | null;
  operatingMarginPct?: number | null;
  profitMarginPct?: number | null;
  roePct?: number | null;
  roaPct?: number | null;
  debtToEquity?: number | null;
  currentRatio?: number | null;
  quickRatio?: number | null;
  beta?: number | null;
}

export interface FundamentalsReport {
  symbol: string;
  displayName: string;
  market: string;
  currency: string;
  supported: boolean;
  reason?: string;
  source: string;
  ratios: FinancialRatios;
  annual: FinancialPeriodRow[];
  quarterly: FinancialPeriodRow[];
  earnings?: EarningsEvent[];
  nextEarningsTime?: number | null;
  exDividendTime?: number | null;
}

export interface EconomicCalendarEvent {
  id: string;
  time: number;
  dateStr: string;
  timeStr: string;
  country: 'TR' | 'US' | 'EU' | string;
  institution: string;
  category: string;
  title: string;
  importance: 'HIGH' | 'MEDIUM' | 'LOW';
  actual?: string | null;
  previous?: string | null;
  unit?: string;
  sourceUrl: string;
}

export interface EarningsCalendarItem {
  symbol: string;
  displayName: string;
  market: string;
  currency: string;
  time: number;
  epsEstimate?: number | null;
  epsActual?: number | null;
  surprisePct?: number | null;
  status: 'UPCOMING' | 'REPORTED';
}

export interface DividendCalendarItem {
  symbol: string;
  displayName: string;
  market: string;
  currency: string;
  exTime: number;
  amount: number;
  yieldPct?: number | null;
}

export interface IPOCalendarSource {
  market: string;
  institution: string;
  title: string;
  description: string;
  url: string;
}

export interface CalendarResponse {
  economic: EconomicCalendarEvent[];
  earnings: EarningsCalendarItem[];
  dividends: DividendCalendarItem[];
  ipoNote: string;
  ipoSources: IPOCalendarSource[];
}

export interface OptionContractQuote {
  instrument: string;
  type: 'C' | 'P';
  strike: number;
  markCoin: number;
  markUsd: number;
  bidUsd: number;
  askUsd: number;
  lastUsd: number;
  markIv: number;
  openInterest: number;
  volume: number;
  volumeUsd: number;
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  itm: boolean;
}

export interface OptionChainStrikeRow {
  strike: number;
  distancePct: number;
  call?: OptionContractQuote | null;
  put?: OptionContractQuote | null;
}

export interface OptionExpirySummary {
  code: string;
  date: string;
  expiryTime: number;
  daysToExpiry: number;
  strikeCount: number;
  totalOi: number;
}

export interface OptionChainStats {
  totalCallOi: number;
  totalPutOi: number;
  putCallOiRatio: number;
  totalVolumeUsd: number;
  atmIv: number;
  maxPainStrike: number;
}

export interface OptionChainResponse {
  supported: boolean;
  reason?: string;
  market: string;
  symbol: string;
  underlying?: string;
  provider?: string;
  spotPrice: number;
  expiries: OptionExpirySummary[];
  selectedExpiry: string;
  daysToExpiry: number;
  summary: OptionChainStats;
  rows: OptionChainStrikeRow[];
}

export interface ScriptAlert {
  time: number;
  message: string;
  /** Faz 23: `alert()` çağrısı mı, `alertcondition()` mı */
  kind?: 'alert' | 'alertcondition';
  /** alertcondition başlığı */
  title?: string;
  /** alert() sıklığı: all | once_per_bar | once_per_bar_close */
  freq?: string;
}

export interface ScriptExecutionResult {
  ok: boolean;
  scriptTitle: string;
  isStrategy: boolean;
  isOverlay: boolean;
  isLibrary?: boolean;
  executionMs: number;
  error?: string;
  plots: ScriptPlotSeries[];
  markers: ScriptMarker[];
  hlines: ScriptHLine[];
  bgcolors?: ScriptBgColor[];
  /** barcolor(): per-bar candle recolor (last call per bar wins) */
  barcolors?: ScriptColorPoint[];
  fills?: ScriptFill[];
  ohlcPlots?: ScriptOhlcPlot[];
  drawings?: ScriptDrawingsData;
  backtest?: BacktestReport;
  /** Unsupported / unrendered features the script used (honest runtime) */
  warnings?: string[];
  inputs?: ScriptInputDef[];
  alerts?: ScriptAlert[];
  /** Faz 23: bildirilen alertcondition() başlıkları ve varsayılan mesajları */
  alertConditions?: { title: string; message: string }[];
  logs?: ScriptLogEntry[];
  /** request.security başka sembol istedi, veri verilmedi (çağıran çekip yeniden çalıştırır) */
  missingSymbols?: string[];
  /** request.security_lower_tf alt TF verisi verilmedi */
  missingLowerTfs?: string[];
}

export interface PriceAlert {
  id: string;
  symbol: string;
  targetPrice: number;
  condition: 'CROSS_UP' | 'CROSS_DOWN';
  triggered: boolean;
  triggeredAt?: string;
  note: string;
}

export interface PaperPosition {
  id: string;
  symbol: string;
  side: 'LONG' | 'SHORT';
  qty: number;
  entryPrice: number;
  currentPrice: number;
  takeProfit?: number;
  stopLoss?: number;
  openedAt: string;
}

export interface PaperClosedTrade {
  id: string;
  symbol: string;
  side: 'LONG' | 'SHORT';
  qty: number;
  entryPrice: number;
  exitPrice: number;
  pnlCash: number;
  pnlPct: number;
  closedAt: string;
}
