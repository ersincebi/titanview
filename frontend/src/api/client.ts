import { lang } from '../state/i18n';
import {
  UNOFFICIAL_DISABLED_CODE,
  UnofficialSourcesDisabledError,
  isUnofficialDisabledError,
} from './sourceErrors';
export { UNOFFICIAL_DISABLED_CODE, UnofficialSourcesDisabledError, isUnofficialDisabledError };
import type {
  CalendarResponse,
  CorporateEventsData,
  DrawingObject,
  FlagColor,
  FundamentalsReport,
  FxRatesResponse,
  HistoryResponse,
  OptionChainResponse,
  ScriptScreenerFilter,
  ScriptScreenerResponse,
  SavedScreenerPreset,
  SavedWatchlist,
  ScreenerRow,
  SymbolNote,
  SymbolQuoteSummary,
  Timeframe,
  WatchlistEntry,
} from '../types/market';

/** Ağ hatasını ("Failed to fetch") anlaşılır bir mesaja çevirir; HTTP hataları olduğu gibi kalır. */
export async function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  try {
    const resp = await fetch(input, init);
    // Cloudflare Access oturumu bitti: sunucu 401 döner. Arayüz bunu bannerla "yenile" olarak gösterir.
    if (resp.status === 401 && typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('tv-session-expired'));
    return resp;
  } catch (e) {
    if (e instanceof TypeError) {
      throw new Error(`Sunucuya ulaşılamıyor (${typeof location === "undefined" ? "?" : location.host}). Backend çalışıyor mu? Terminalde: make start (Cloudflare Access oturumu dolduysa sayfayı yenile)`);
    }
    throw e;
  }
}

export interface CacheStatsResponse {
  totalCandles: number;
  totalSymbols: number;
  savedScripts: number;
  savedDrawings: number;
}

export interface SavedScriptItem {
  id: string;
  name: string;
  code: string;
  isOverlay: boolean;
  updatedAt: number;
}

export interface SourcesStatus {
  unofficial: boolean;
  acceptedAt: number;
  envOverride?: boolean;
  hosts: string[];
}

export async function fetchSourcesStatus(): Promise<SourcesStatus> {
  const resp = await apiFetch('/api/sources');
  if (!resp.ok) throw new Error(`Sources API error: ${resp.status}`);
  return resp.json() as Promise<SourcesStatus>;
}

export async function updateSourcesStatus(unofficial: boolean, acceptTerms = false): Promise<SourcesStatus> {
  const resp = await apiFetch('/api/sources', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ unofficial, acceptTerms }),
  });
  if (!resp.ok) {
    let detail = '';
    try {
      detail = ((await resp.json()) as { error?: string }).error ?? '';
    } catch {
      // non-json error body
    }
    throw new Error(detail || `Sources API error: ${resp.status}`);
  }
  return resp.json() as Promise<SourcesStatus>;
}

export async function fetchHistory(
  symbol: string,
  interval: Timeframe,
  from?: number,
  to?: number,
  currency?: string
): Promise<HistoryResponse> {
  const params = new URLSearchParams({
    symbol,
    interval,
  });
  if (from && from > 0) params.set('from', String(Math.floor(from)));
  if (to && to > 0) params.set('to', String(Math.floor(to)));
  if (currency && currency.trim()) params.set('currency', currency.trim().toUpperCase());

  const resp = await apiFetch(`/api/history?${params.toString()}`);
  if (!resp.ok) {
    let detail = '';
    let isUnofficial = false;
    try {
      const body = (await resp.json()) as { error?: string; code?: string; unofficialDisabled?: boolean };
      detail = body.error ?? '';
      isUnofficial = body.code === UNOFFICIAL_DISABLED_CODE || body.unofficialDisabled === true;
    } catch {
      // non-json error body
    }
    if (isUnofficial) throw new UnofficialSourcesDisabledError(detail);
    throw new Error(detail || `History API error: ${resp.status}`);
  }
  return resp.json() as Promise<HistoryResponse>;
}

export async function fetchSymbols(
  market: 'ALL' | 'CRYPTO' | 'BIST' | 'US' | 'FOREX' = 'ALL',
  query = ''
): Promise<SymbolQuoteSummary[]> {
  const params = new URLSearchParams({ market });
  if (query.trim()) params.set('q', query.trim());
  const resp = await apiFetch(`/api/symbols?${params.toString()}`);
  if (!resp.ok) return [];
  const data = (await resp.json()) as { symbols?: SymbolQuoteSummary[] };
  return data.symbols || [];
}

export interface LiveQuote {
  symbol: string;
  last: number;
  prevClose: number;
  change: number;
  changePct: number;
  volume?: number;
  dayHigh?: number;
  dayLow?: number;
  extPrice?: number;
  extChangePct?: number;
  extSession?: 'pre' | 'post' | '';
}

/** Canlı son fiyat + günlük değişim (önceki kapanışa göre). Alınamayan semboller yanıtta yoktur. */
export async function fetchQuotes(symbols: string[]): Promise<LiveQuote[]> {
  if (symbols.length === 0) return [];
  const resp = await apiFetch(`/api/quotes?symbols=${encodeURIComponent(symbols.join(','))}`);
  if (!resp.ok) return [];
  const data = (await resp.json()) as { quotes?: LiveQuote[] };
  return data.quotes ?? [];
}

export async function fetchScreener(
  market: 'ALL' | 'CRYPTO' | 'BIST' | 'US' | 'FOREX' | 'ETF' = 'ALL',
  opts?: { timeframe?: string; includeFundamentals?: boolean; warm?: boolean }
): Promise<ScreenerRow[]> {
  const params = new URLSearchParams({ market });
  if (opts?.timeframe) params.set('timeframe', opts.timeframe);
  if (opts?.includeFundamentals) params.set('fundamentals', '1');
  if (opts?.warm) params.set('warm', '1');
  const resp = await apiFetch(`/api/screener?${params.toString()}`);
  if (!resp.ok) return [];
  const data = (await resp.json()) as { rows?: ScreenerRow[] };
  return data.rows || [];
}

export async function fetchCacheStats(): Promise<CacheStatsResponse> {
  const resp = await apiFetch('/api/cache-stats');
  if (!resp.ok) {
    return { totalCandles: 0, totalSymbols: 0, savedScripts: 0, savedDrawings: 0 };
  }
  return resp.json() as Promise<CacheStatsResponse>;
}

export async function fetchSavedScripts(): Promise<SavedScriptItem[]> {
  const resp = await apiFetch('/api/scripts');
  if (!resp.ok) return [];
  const data = (await resp.json()) as { scripts?: SavedScriptItem[] };
  return data.scripts || [];
}

export async function saveCustomScript(script: {
  id?: string;
  name: string;
  code: string;
  isOverlay: boolean;
}): Promise<SavedScriptItem | null> {
  const resp = await apiFetch('/api/scripts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(script),
  });
  if (!resp.ok) return null;
  return resp.json() as Promise<SavedScriptItem>;
}

export interface DrawingFetchScope {
  layoutId?: string;
  scope?: 'global' | 'layout' | 'local';
}

export async function fetchDrawings(symbol: string, opts?: DrawingFetchScope): Promise<DrawingObject[]> {
  let url = `/api/drawings?symbol=${encodeURIComponent(symbol)}`;
  if (opts?.layoutId) url += `&layoutId=${encodeURIComponent(opts.layoutId)}`;
  if (opts?.scope) url += `&scope=${encodeURIComponent(opts.scope)}`;
  const resp = await apiFetch(url);
  if (!resp.ok) return [];
  const data = (await resp.json()) as {
    drawings?: Array<{
      id: string;
      symbol: string;
      timeframe: string;
      toolType: DrawingObject['toolType'];
      pointsJson: string;
      styleJson: string;
      layoutId?: string;
    }>;
  };
  return parseDrawingRows(data.drawings || []);
}

export function parseDrawingRows(
  rows: Array<{
    id: string;
    symbol: string;
    timeframe: string;
    toolType: DrawingObject['toolType'];
    pointsJson: string;
    styleJson: string;
    layoutId?: string;
  }>
): DrawingObject[] {
  const out: DrawingObject[] = [];
  for (const row of rows) {
    try {
      const points = JSON.parse(row.pointsJson);
      const style = JSON.parse(row.styleJson || '{}');
      out.push({
        id: row.id,
        symbol: row.symbol,
        timeframe: row.timeframe,
        toolType: row.toolType,
        points,
        color: style.color || '#0284C7',
        label: style.label,
        ...(typeof style.width === 'number' ? { width: style.width } : {}),
        ...(style.lineStyle ? { lineStyle: style.lineStyle } : {}),
        ...(style.locked ? { locked: true } : {}),
        ...(typeof style.icon === 'string' ? { icon: style.icon } : {}),
        ...(typeof style.fontSize === 'number' ? { fontSize: style.fontSize } : {}),
        ...(style.visibility && typeof style.visibility === 'object' ? { visibility: style.visibility } : {}),
        ...(Array.isArray(style.bars) ? { bars: style.bars } : {}),
        ...(row.layoutId ? { layoutId: row.layoutId } : {}),
      });
    } catch {
      // ignore malformed drawing row
    }
  }
  return out;
}

export async function persistDrawing(drawing: DrawingObject): Promise<void> {
  await apiFetch('/api/drawings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: drawing.id,
      symbol: drawing.symbol,
      timeframe: drawing.timeframe,
      toolType: drawing.toolType,
      layoutId: drawing.layoutId ?? '',
      pointsJson: JSON.stringify(drawing.points),
      styleJson: JSON.stringify({
        color: drawing.color,
        label: drawing.label,
        width: drawing.width,
        lineStyle: drawing.lineStyle,
        locked: drawing.locked,
        icon: drawing.icon,
        fontSize: drawing.fontSize,
        visibility: drawing.visibility,
        bars: drawing.bars,
      }),
    }),
  });
}

export async function clearSymbolDrawings(symbol: string, layoutId?: string): Promise<void> {
  let url = `/api/drawings?symbol=${encodeURIComponent(symbol)}`;
  if (layoutId) url += `&layoutId=${encodeURIComponent(layoutId)}`;
  await apiFetch(url, {
    method: 'DELETE',
  });
}

export async function deleteDrawingById(id: string): Promise<void> {
  await apiFetch(`/api/drawings?id=${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export interface OverviewRow {
  symbol: string;
  displayName: string;
  market: 'CRYPTO' | 'BIST' | 'US' | 'FOREX';
  currency: string;
  lastPrice: number;
  change1d: number | null;
  change1w: number | null;
  change1m: number | null;
  turnover: number;
}

export interface CorrelationResponse {
  symbols: string[];
  days: number;
  matrix: Array<Array<number | null>>;
}

export interface SecurityStats {
  last: number;
  change1d: number | null;
  change1w: number | null;
  change1m: number | null;
  change3m: number | null;
  changeYtd: number | null;
  change1y: number | null;
  high52w: number;
  low52w: number;
  fromHighPct: number;
  volAnnualPct: number | null;
  maxDrawdownPct: number;
  atr14Pct: number | null;
  bars: number;
}

export interface SecurityResponse {
  info: { symbol: string; displayName: string; market: string; exchange: string; currency: string; delayMinutes: number };
  stats: SecurityStats;
  beta?: number;
  benchmark?: string;
}

export interface InsightSignal {
  key: string;
  label: string;
  tone: 'bull' | 'bear' | 'warn' | 'neutral';
  detail: string;
  weight: number;
}
export interface InsightLevel {
  price: number;
  touches: number;
  distPct: number;
}
export interface SeasonCell {
  avgPct: number;
  hitPct: number;
  n: number;
}
export interface Insights {
  bars: number;
  last: number;
  score: number;
  bias: string;
  tags: string[];
  signals: InsightSignal[];
  metrics: {
    rsi14: number | null;
    sma50: number | null;
    sma200: number | null;
    z20: number | null;
    bbWidthPctile: number | null;
    atrPctile: number | null;
    relVolume: number | null;
    momentum121: number | null;
    relStrength3m: number | null;
    var95Pct: number | null;
    drawdownPct: number;
    daysSincePeak: number;
    streak: number;
  };
  support: InsightLevel[] | null;
  resistance: InsightLevel[] | null;
  weekday?: Array<SeasonCell | null>;
  month?: Array<SeasonCell | null>;
}
export interface InsightsResponse {
  info: SecurityResponse['info'];
  insights: Insights;
  benchmark?: string;
}
export interface IdeaRow {
  symbol: string;
  displayName: string;
  market: string;
  last: number;
  change1d: number | null;
  score: number;
  bias: string;
  tags: string[];
  signals: InsightSignal[];
  rsi14: number | null;
  relVolume: number | null;
}

export interface NewsItem {
  title: string;
  publisher: string;
  link: string;
  time: number;
}

export interface WhaleTrade {
  time: number;
  price: number;
  qty: number;
  notional: number;
  side: 'BUY' | 'SELL';
}

export interface WhaleReport {
  symbol: string;
  sampled: number;
  fromTime: number;
  toTime: number;
  buyVolume: number;
  sellVolume: number;
  trades: WhaleTrade[];
}

export type WhaleResponse = { supported: false; reason: string } | { supported: true; report: WhaleReport };

async function getJson<T>(url: string, what: string): Promise<T> {
  const resp = await apiFetch(url);
  if (!resp.ok) {
    let detail = '';
    let isUnofficial = false;
    try {
      const body = (await resp.json()) as { error?: string; code?: string; unofficialDisabled?: boolean };
      detail = body.error ?? '';
      isUnofficial = body.code === UNOFFICIAL_DISABLED_CODE || body.unofficialDisabled === true;
    } catch {
      // gövde JSON değil
    }
    if (isUnofficial) throw new UnofficialSourcesDisabledError(detail);
    throw new Error(`${what}: ${resp.status}${detail ? ` ${detail}` : ''}`);
  }
  return (await resp.json()) as T;
}

/** Sunucuda saklanan ayar (SQLite). Ayar yoksa null; sunucu/ağ hatası fırlatılır (çağıran yerel önbelleğe düşer). */
export async function fetchSetting(key: string): Promise<unknown | null> {
  const resp = await apiFetch(`/api/settings?key=${encodeURIComponent(key)}`);
  if (resp.status === 404) return null;
  if (!resp.ok) throw new Error(`Ayar okunamadı: ${resp.status}`);
  const data = (await resp.json()) as { value?: unknown };
  return data.value ?? null;
}

export async function saveSetting(key: string, value: unknown, keepalive = false): Promise<void> {
  const resp = await apiFetch(`/api/settings?key=${encodeURIComponent(key)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(value),
    keepalive,
  });
  if (!resp.ok) throw new Error(`Ayar kaydedilemedi: ${resp.status}`);
}

export async function fetchOverview(market = 'ALL'): Promise<OverviewRow[]> {
  const data = await getJson<{ rows?: OverviewRow[] }>(`/api/overview?market=${market}`, 'Piyasa özeti');
  return data.rows ?? [];
}

export function fetchCorrelation(symbols: string[], days = 250): Promise<CorrelationResponse> {
  const p = new URLSearchParams({ symbols: symbols.join(','), days: String(days) });
  return getJson<CorrelationResponse>(`/api/correlation?${p}`, 'Korelasyon');
}

export function fetchSecurity(symbol: string): Promise<SecurityResponse> {
  return getJson<SecurityResponse>(`/api/security?symbol=${encodeURIComponent(symbol)}`, 'Künye');
}

// ---------- Derin analiz (/api/analysis*) ----------
/** Faz 30: EN arayüzde analiz metinleri sunucuda İngilizceye çevrilir. */
const langQS = (): string => (lang() === 'en' ? '&lang=en' : '');

export interface AVote { key: string; group: 'trend' | 'momentum' | 'volume'; name: string; value: string; vote: number; detail: string }
export interface ACone { days: number; lo68: number; hi68: number; lo95: number; hi95: number }
export interface ATarget { label: string; price: number; distPct: number }
export interface ADist { horizon: number; meanPct: number; medianPct: number; hitPct: number; p10Pct: number; p90Pct: number }
export interface TFTrend { tf: string; dir: 'up' | 'down' | 'flat' | 'na'; score: number; rsi?: number | null; bars: number; detail: string }
export interface GapSlice { n: number; avgPct: number; fillPct: number }
export interface Analysis {
  insights: Insights;
  score: number;
  bias: string;
  voteScore: number;
  buy: number;
  sell: number;
  neutral: number;
  votes: AVote[];
  projection?: { sigmaDailyPct: number; cones: ACone[]; atrTargets: ATarget[]; fibTargets: ATarget[]; note: string };
  analog?: { condition: string; n: number; h5: ADist | null; h20: ADist | null; note: string };
  profile?: { poc: number; vah: number; val: number; bins: Array<{ price: number; volume: number }> };
  regime: { trend: 'trend-up' | 'trend-down' | 'range'; adx: number | null; volatility: string; rangePos52w: number | null };
  flow: { obvSlopePct: number; cmf20: number | null; relVolume: number | null; divergence: '' | 'bullish' | 'bearish' };
  gaps?: { days: number; up: GapSlice; down: GapSlice; monday: GapSlice; lastGapPct: number | null; thresholdPct: number };
}
export interface AnalysisResponse {
  info: SecurityResponse['info'];
  analysis: Analysis;
  mtf: TFTrend[];
  mtfAgreement: string;
  benchmark?: string;
  lastBarTime: number;
}
export interface RelatedItem { symbol: string; displayName: string; market: string; r90: number; r30?: number; delta?: number; n: number }
export interface RelatedResponse {
  positive: RelatedItem[] | null;
  negative: RelatedItem[] | null;
  cross: RelatedItem[] | null;
  benchmark?: string;
  beta?: number;
  benchR90?: number;
  benchR30?: number;
  relStrengthBTC30d?: number;
  note: string;
}
export interface FlowResponse {
  tone?: { pos: number; neg: number; neutral: number; score: number; label: string; items: Array<{ title: string; tone: number; matched?: string[] }>; note: string };
  news?: NewsItem[];
  whales?: WhaleReport;
  depth?: { mid: number; bid1Pct: number; ask1Pct: number; bid5Pct: number; ask5Pct: number; imbalance1Pct: number; imbalance5Pct: number; spreadPct: number; largestBid: number; largestAsk: number };
}

export function fetchAnalysis(symbol: string): Promise<AnalysisResponse> {
  return getJson(`/api/analysis?symbol=${encodeURIComponent(symbol)}${langQS()}`, 'Analiz');
}
export function fetchRelated(symbol: string): Promise<RelatedResponse> {
  return getJson(`/api/analysis/related?symbol=${encodeURIComponent(symbol)}${langQS()}`, 'İlişkiler');
}
export function fetchFlow(symbol: string): Promise<FlowResponse> {
  return getJson(`/api/analysis/flow?symbol=${encodeURIComponent(symbol)}${langQS()}`, 'Akış');
}

export function fetchInsights(symbol: string): Promise<InsightsResponse> {
  return getJson<InsightsResponse>(`/api/insights?symbol=${encodeURIComponent(symbol)}${langQS()}`, 'İçgörü');
}

export async function fetchIdeas(market = 'ALL'): Promise<IdeaRow[]> {
  const data = await getJson<{ rows?: IdeaRow[] }>(`/api/ideas?market=${market}`, 'Fikirler');
  return data.rows ?? [];
}

export async function fetchNews(symbol: string | null, limit = 12): Promise<NewsItem[]> {
  const p = new URLSearchParams({ limit: String(limit) });
  if (symbol) p.set('symbol', symbol);
  const data = await getJson<{ items?: NewsItem[] }>(`/api/news?${p}`, 'Haber');
  return data.items ?? [];
}

export function fetchWhales(symbol: string, top = 25): Promise<WhaleResponse> {
  return getJson<WhaleResponse>(`/api/whales?symbol=${encodeURIComponent(symbol)}&top=${top}`, 'Balina');
}

/** Favorilerin mumları arka planda toplanır (geçmiş birikir); sunucuya tüm listeyi yazar. */
export async function syncCollectSymbols(symbols: string[]): Promise<string[]> {
  const resp = await apiFetch('/api/collect', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ symbols }),
  });
  if (!resp.ok) throw new Error(`Toplama listesi: ${resp.status}`);
  return ((await resp.json()) as { symbols?: string[] }).symbols ?? [];
}

export interface CollectItem {
  symbol: string;
  displayName: string;
  market: 'CRYPTO' | 'BIST' | 'US' | 'FOREX';
}

/** Sunucudaki favori/toplama listesi (tarayıcı verisi silinse bile geri yüklemek için). */
export async function fetchCollectItems(): Promise<CollectItem[]> {
  const resp = await apiFetch('/api/collect');
  if (!resp.ok) throw new Error(`Toplama listesi: ${resp.status}`);
  return ((await resp.json()) as { items?: CollectItem[] }).items ?? [];
}

export interface FootprintResponse {
  supported: boolean;
  reason?: string;
  row?: number;
  bars?: Array<{ time: number; rows: Array<[number, number, number]>; delta: number; total: number; poc: number; complete: boolean; trades: number }>;
  pending?: number[];
}

/** Bar başına taker alış/satış (Binance aggTrades). Kripto dışı: supported=false. */
export async function fetchFootprint(symbol: string, interval: string, row: number, times: number[]): Promise<FootprintResponse> {
  const params = new URLSearchParams({ symbol, interval, row: String(row), times: times.join(',') });
  const resp = await apiFetch(`/api/footprint?${params.toString()}`);
  if (!resp.ok) throw new Error(`footprint ${resp.status}`);
  return (await resp.json()) as FootprintResponse;
}

/** Gerçek Yahoo temettü, bölünme ve bilanço etkinlikleri (request.dividends/splits/earnings). */
export async function fetchCorporateEvents(symbol: string, from?: number, to?: number): Promise<CorporateEventsData> {
  const params = new URLSearchParams({ symbol });
  if (from && from > 0) params.set('from', String(Math.floor(from)));
  if (to && to > 0) params.set('to', String(Math.floor(to)));
  const resp = await apiFetch(`/api/events?${params.toString()}`);
  if (!resp.ok) {
    return { symbol, supported: false, reason: `HTTP ${resp.status}`, dividends: [], splits: [], earnings: [] };
  }
  return (await resp.json()) as CorporateEventsData;
}

/** Gerçek Yahoo günlük FX kurları (request.currency_rate). */
export async function fetchFxRates(fromCur: string, toCur: string, fromTs?: number, toTs?: number): Promise<FxRatesResponse> {
  const params = new URLSearchParams({ from: fromCur, to: toCur });
  if (fromTs && fromTs > 0) params.set('fromTs', String(Math.floor(fromTs)));
  if (toTs && toTs > 0) params.set('toTs', String(Math.floor(toTs)));
  const resp = await apiFetch(`/api/fx?${params.toString()}`);
  if (!resp.ok) {
    return { from: fromCur, to: toCur, pair: `${fromCur}/${toCur}`, supported: false, reason: `HTTP ${resp.status}`, rates: [] };
  }
  return (await resp.json()) as FxRatesResponse;
}

export async function deleteSavedScript(id: string): Promise<boolean> {
  const resp = await apiFetch(`/api/scripts?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
  return resp.ok;
}

/** Faz 26: Gelir tablosu, bilanço, nakit akışı ve oranlar (Yahoo + BIST KAP/İş Yatırım). */
export async function fetchFundamentals(symbol: string): Promise<FundamentalsReport> {
  const params = new URLSearchParams({ symbol });
  return getJson<FundamentalsReport>(`/api/fundamentals?${params.toString()}`, 'Temel veriler');
}

/** Faz 26: Ekonomik takvim (TCMB/TÜİK/FED/BLS/ECB) + Kazanç / Temettü / IPO takvimi. */
export async function fetchCalendar(country = 'ALL', market = 'ALL'): Promise<CalendarResponse> {
  const params = new URLSearchParams({ country, market });
  return getJson<CalendarResponse>(`/api/calendar?${params.toString()}`, 'Takvim');
}

/** Faz 26: Deribit Public API kripto opsiyon zinciri (BIST VİOP için dürüst supported=false döner). */
export async function fetchOptionChain(symbol: string, expiry = ''): Promise<OptionChainResponse> {
  const params = new URLSearchParams({ symbol });
  if (expiry.trim()) params.set('expiry', expiry.trim());
  return getJson<OptionChainResponse>(`/api/options?${params.toString()}`, 'Opsiyon zinciri');
}

// ---------- Faz 27: Çoklu İzleme Listesi, 7 Renk Bayrak, Notlar/Günlük, Gelişmiş Tarayıcı & TitanScript Tarayıcı ----------
export {
  deleteNoteApi,
  deleteScreenerPresetApi,
  deleteWatchlistApi,
  fetchNotesApi,
  fetchScreenerPresetsApi,
  fetchSymbolCardFundamentals,
  fetchSymbolCardSecurity,
  fetchWatchlistsApi,
  runScriptScreenerApi,
  saveNoteApi,
  saveScreenerPresetApi,
  saveWatchlistApi,
  setSymbolFlagApi,
  type ScriptScreenerRunParams,
} from './phase27';
