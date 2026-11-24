import { tt } from './i18n';
import { createSignal } from 'solid-js';
import {
  fetchCorrelation,
  fetchIdeas,
  fetchNews,
  fetchOverview,
  fetchSymbols,
  fetchSecurity,
  fetchWhales,
  type CorrelationResponse,
  type IdeaRow,
  type NewsItem,
  type OverviewRow,
  type SecurityResponse,
  type WhaleResponse,
} from '../api/client';
import { parseCommand, type CorrMarket, type TerminalView } from './terminal';
import { setWorkbenchTab, setUi, switchSymbol, symbols, ui } from './store';

export interface Remote<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}
const idle = <T,>(): Remote<T> => ({ data: null, loading: false, error: null });
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export const [overview, setOverview] = createSignal<Remote<OverviewRow[]>>(idle());
export const [correlation, setCorrelation] = createSignal<Remote<CorrelationResponse>>(idle());
export const [security, setSecurity] = createSignal<Remote<SecurityResponse>>(idle());
export const [news, setNews] = createSignal<Remote<{ symbol: string | null; items: NewsItem[] }>>(idle());
export const [whales, setWhales] = createSignal<Remote<WhaleResponse>>(idle());
export const [ideas, setIdeas] = createSignal<Remote<IdeaRow[]>>(idle());
export const [ideasMarket, setIdeasMarket] = createSignal<'ALL' | 'CRYPTO' | 'BIST' | 'US' | 'FOREX'>('ALL');
export const [ideasTag, setIdeasTag] = createSignal<string | null>(null);
export const [overviewMarket, setOverviewMarket] = createSignal<'ALL' | 'CRYPTO' | 'BIST' | 'US' | 'FOREX'>('ALL');
export const [corrSymbols, setCorrSymbols] = createSignal<string[]>([]);
export const [corrMarket, setCorrMarket] = createSignal<CorrMarket>('MIX');
/** Seçili piyasanın seçilebilir sembolleri (MIX: izleme listesi). */
export const [corrPool, setCorrPool] = createSignal<string[]>([]);

async function run<T>(set: (r: Remote<T>) => void, prev: () => Remote<T>, job: () => Promise<T>): Promise<void> {
  set({ ...prev(), loading: true, error: null });
  try {
    set({ data: await job(), loading: false, error: null });
  } catch (e) {
    set({ data: null, loading: false, error: msg(e) });
  }
}

export const loadOverview = (market = overviewMarket()) =>
  run(setOverview, overview, () => fetchOverview(market));

export function defaultCorrSymbols(): string[] {
  if (corrSymbols().length >= 2) return corrSymbols();
  const picks = symbols().slice(0, 8).map((s) => s.symbol);
  return picks.length >= 2 ? picks : [ui.symbol, 'BTCUSDT', 'AAPL', 'XU100.IS'];
}

export const loadCorrelation = (syms = defaultCorrSymbols()) => {
  setCorrSymbols(syms);
  return run(setCorrelation, correlation, () => fetchCorrelation(syms));
};
/**
 * Piyasaya özel korelasyon: o piyasanın sembolleri kendi aralarında (BIST↔BIST, kripto↔kripto, ABD↔ABD).
 * Farklı piyasalar farklı seans/takvimle işlem gördüğü için karışık matris çoğu zaman yanıltıcıdır.
 */
export async function selectCorrMarket(m: CorrMarket): Promise<void> {
  setCorrMarket(m);
  if (m === 'MIX') {
    setCorrPool(symbols().slice(0, 24).map((s) => s.symbol));
    void loadCorrelation(defaultCorrSymbols());
    return;
  }
  try {
    const pool = (await fetchSymbols(m)).map((s) => s.symbol);
    setCorrPool(pool);
    await loadCorrelation(pool.slice(0, 10));
  } catch (e) {
    setCorrelation({ data: null, loading: false, error: msg(e) });
  }
}

/** Her kaynağın en son hangi sembol için yüklendiği (sembol değişince bayat sekmeyi yenilemek için). */
const loadedFor: { security?: string; news?: string | null; insights?: string; whales?: string } = {};

export const loadSecurity = (symbol = ui.symbol) => {
  loadedFor.security = symbol;
  return run(setSecurity, security, () => fetchSecurity(symbol));
};
export const loadNews = (symbol: string | null = ui.symbol) => {
  loadedFor.news = symbol;
  return run(setNews, news, async () => ({ symbol, items: await fetchNews(symbol) }));
};

export const loadIdeas = (market = ideasMarket()) => run(setIdeas, ideas, () => fetchIdeas(market));

export const loadWhales = (symbol = ui.symbol) => {
  loadedFor.whales = symbol;
  return run(setWhales, whales, () => fetchWhales(symbol));
};

/**
 * Aktif analiz sekmesini güncel sembole eşitler. Sembol değişince ya da başka sekmeden dönünce çağrılır:
 * veri başka bir sembol içinse yeniden yükler. Haber sekmesinde "Genel" (sembolsüz) kapsam korunur.
 */
export function syncTerminalToSymbol(): void {
  const sym = ui.symbol;
  switch (ui.wbTab) {
    case 'des':
      if (loadedFor.security !== sym) void loadSecurity(sym);
      if (loadedFor.news !== sym && loadedFor.news !== null) void loadNews(sym);
      break;
    case 'news':
      if (loadedFor.news !== null && loadedFor.news !== sym) void loadNews(sym);
      break;
    case 'whale':
      if (loadedFor.whales !== sym) void loadWhales(sym);
      break;
    default:
  }
}

export function showView(view: TerminalView, symbol?: string | null): void {
  setWorkbenchTab(view);
  if (view === 'market') void loadOverview();
  else if (view === 'corr') void loadCorrelation();
  else if (view === 'whale') void loadWhales(symbol ?? ui.symbol);
  else if (view === 'insight') { if (symbol) void switchSymbol(symbol, ui.interval); }
  else if (view === 'ideas') void loadIdeas();
  else if (view === 'des') {
    void loadSecurity(symbol ?? ui.symbol);
    void loadNews(symbol ?? ui.symbol);
  }
  else void loadNews(symbol === undefined ? ui.symbol : symbol);
}

/** Komut çubuğu girişini uygular; hata varsa mesaj döner (modal açık kalır). */
export function runCommand(input: string): string | null {
  const cmd = parseCommand(input, symbols().map((s) => s.symbol));
  switch (cmd.kind) {
    case 'error':
      return cmd.message;
    case 'chart':
      if (!cmd.symbol) return tt("Sembol gerekli");
      void switchSymbol(cmd.symbol, ui.interval);
      return null;
    case 'des':
      void switchSymbol(cmd.symbol, ui.interval);
      showView('des', cmd.symbol);
      return null;
    case 'news':
      showView('news', cmd.symbol);
      return null;
    case 'whale':
      showView('whale', cmd.symbol);
      return null;
    case 'insight':
      if (cmd.symbol) void switchSymbol(cmd.symbol, ui.interval);
      showView('insight', cmd.symbol);
      return null;
    case 'view':
      showView(cmd.view);
      return null;
    case 'screener':
      setWorkbenchTab('screener');
      return null;
  }
}

export function openCommandBar(): void {
  setUi('modal', 'command');
}
