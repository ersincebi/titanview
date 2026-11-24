import { tt } from './i18n';
import type { LiveQuote } from '../api/client';
import type {
  FlagColor,
  MarketType,
  SavedWatchlist,
  ScreenerRow,
  SymbolQuoteSummary,
  TechnicalRating,
  WatchlistColumnKey,
  WatchlistEntry,
} from '../types/market';

export type MarketFilter = MarketType | 'ALL';
/** İzleme listesi sekmesi: piyasa süzgeci veya kullanıcının favorileri. */
export type WatchlistTab = MarketFilter | 'FAV';

export interface FlagColorDef {
  id: FlagColor;
  label: string;
  shortLabel: string;
  hex: string;
}

/** 7 standart bayrak rengi. */
export const FLAG_COLORS: FlagColorDef[] = [
  { id: 'red', label: tt("Kırmızı Liste"), shortLabel: tt("Kırmızı"), hex: '#F23645' },
  { id: 'blue', label: tt(tt("Mavi Liste")), shortLabel: tt("Mavi"), hex: '#0284C7' },
  { id: 'green', label: tt("Yeşil Liste"), shortLabel: tt("Yeşil"), hex: '#089981' },
  { id: 'orange', label: tt(tt("Turuncu Liste")), shortLabel: tt("Turuncu"), hex: '#FF9800' },
  { id: 'purple', label: tt("Mor Liste"), shortLabel: 'Mor', hex: '#9C27B0' },
  { id: 'cyan', label: tt("Camgöbeği Liste"), shortLabel: tt("Camgöbeği"), hex: '#00BCD4' },
  { id: 'pink', label: tt(tt("Pembe Liste")), shortLabel: tt("Pembe"), hex: '#E91E63' },
];

export const FLAG_COLOR_MAP: Record<FlagColor, FlagColorDef> = {
  red: FLAG_COLORS[0],
  blue: FLAG_COLORS[1],
  green: FLAG_COLORS[2],
  orange: FLAG_COLORS[3],
  purple: FLAG_COLORS[4],
  cyan: FLAG_COLORS[5],
  pink: FLAG_COLORS[6],
};

export interface WatchlistColumnDef {
  key: WatchlistColumnKey;
  label: string;
  shortLabel: string;
  defaultOn: boolean;
}

export const WATCHLIST_COLUMNS: WatchlistColumnDef[] = [
  { key: 'last', label: 'Son Fiyat', shortLabel: 'Son', defaultOn: true },
  { key: 'chg', label: tt(tt("Değişim")), shortLabel: tt("Değ"), defaultOn: true },
  { key: 'chgPct', label: tt("Değişim %"), shortLabel: tt("Değ%"), defaultOn: true },
  { key: 'vol', label: tt("Hacim"), shortLabel: tt("Hacim"), defaultOn: false },
  { key: 'ext', label: tt("Uzatılmış Saat"), shortLabel: tt("Uzat."), defaultOn: false },
  { key: 'tech', label: tt("Teknik Puan"), shortLabel: tt("Teknik"), defaultOn: false },
];

export type WatchlistSortCol = 'symbol' | WatchlistColumnKey;
export type WatchlistSortDir = 'none' | 'asc' | 'desc';

export interface WatchlistSortState {
  col: WatchlistSortCol;
  dir: WatchlistSortDir;
}

export interface WatchlistSectionGroup {
  id: string;
  title: string;
  collapsed: boolean;
  isCustom: boolean;
  rows: SymbolQuoteSummary[];
}

export function filterWatchlistSymbols(
  symbols: SymbolQuoteSummary[],
  filter: MarketFilter,
  query = ''
): SymbolQuoteSummary[] {
  const q = query.trim().toUpperCase();
  return symbols.filter((item) => {
    if (filter !== 'ALL' && item.market !== filter) return false;
    if (!q) return true;
    return item.symbol.toUpperCase().includes(q) || item.displayName.toUpperCase().includes(q);
  });
}

/** Canlı tick'i listedeki sembole işler (yeni dizi döner; sembol yoksa aynı dizi). */
export function applyQuote(
  symbols: SymbolQuoteSummary[],
  symbol: string,
  lastPrice: number,
  changePercent?: number
): SymbolQuoteSummary[] {
  const sym = symbol.toUpperCase();
  if (!symbols.some((s) => s.symbol.toUpperCase() === sym)) return symbols;
  return symbols.map((s) =>
    s.symbol.toUpperCase() === sym
      ? { ...s, lastPrice, changePercent: changePercent ?? s.changePercent }
      : s
  );
}

/** Sütun başlığına tıklanınca bir sonraki sıralama durumunu döndürür. */
export function nextWatchlistSort(cur: WatchlistSortState, col: WatchlistSortCol): WatchlistSortState {
  if (cur.col !== col || cur.dir === 'none') {
    return { col, dir: col === 'symbol' ? 'asc' : 'desc' };
  }
  if (cur.col === 'symbol') {
    return cur.dir === 'asc' ? { col, dir: 'desc' } : { col, dir: 'none' };
  }
  return cur.dir === 'desc' ? { col, dir: 'asc' } : { col, dir: 'none' };
}

const RATING_ORDER: Record<TechnicalRating, number> = {
  STRONG_BUY: 2,
  BUY: 1,
  NEUTRAL: 0,
  SELL: -1,
  STRONG_SELL: -2,
};

export function resolveRowMetrics(
  item: SymbolQuoteSummary,
  quotesMap: Record<string, LiveQuote> = {},
  screenerMap: Record<string, ScreenerRow> = {}
): {
  last: number | null;
  chg: number | null;
  chgPct: number | null;
  vol: number | null;
  ext: number | null;
  techScore: number | null;
  techRating: TechnicalRating | null;
} {
  const sym = item.symbol.toUpperCase();
  const q = quotesMap[sym];
  const scr = screenerMap[sym];
  const last = q?.last ?? item.lastPrice ?? scr?.lastPrice ?? null;
  const chg = q?.change ?? item.changeAbs ?? scr?.changeAbs ?? null;
  const chgPct = q?.changePct ?? item.changePercent ?? scr?.changePercent ?? null;
  const vol = q?.volume ?? item.volume24h ?? scr?.volume ?? null;
  const ext = q?.extChangePct ?? item.extChangePct ?? scr?.extChangePct ?? null;
  const techRating = (scr?.rating ?? item.techRating ?? null) as TechnicalRating | null;
  const techScore =
    scr?.score ?? item.techScore ?? (techRating ? RATING_ORDER[techRating] : null);
  return { last, chg, chgPct, vol, ext, techScore, techRating };
}

/** Satırları seçili sütun ve yöne göre sıralar; null değerler her zaman en altta kalır. */
export function sortWatchlistRows(
  rows: SymbolQuoteSummary[],
  sort: WatchlistSortState,
  quotesMap: Record<string, LiveQuote> = {},
  screenerMap: Record<string, ScreenerRow> = {}
): SymbolQuoteSummary[] {
  if (sort.dir === 'none' || rows.length <= 1) return rows;
  const mult = sort.dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (sort.col === 'symbol') {
      return mult * a.symbol.localeCompare(b.symbol, 'tr-TR');
    }
    const ma = resolveRowMetrics(a, quotesMap, screenerMap);
    const mb = resolveRowMetrics(b, quotesMap, screenerMap);
    let va: number | null = null;
    let vb: number | null = null;
    switch (sort.col) {
      case 'last':
        va = ma.last;
        vb = mb.last;
        break;
      case 'chg':
        va = ma.chg;
        vb = mb.chg;
        break;
      case 'chgPct':
        va = ma.chgPct;
        vb = mb.chgPct;
        break;
      case 'vol':
        va = ma.vol;
        vb = mb.vol;
        break;
      case 'ext':
        va = ma.ext;
        vb = mb.ext;
        break;
      case 'tech':
        va = ma.techScore;
        vb = mb.techScore;
        break;
    }
    if (va == null && vb == null) return a.symbol.localeCompare(b.symbol, 'tr-TR');
    if (va == null) return 1;
    if (vb == null) return -1;
    if (va === vb) return a.symbol.localeCompare(b.symbol, 'tr-TR');
    return mult * (va - vb);
  });
}

/** Sembol kodunu katalogdan veya dinamik kurallardan SymbolQuoteSummary nesnesine çözümler. */
export function resolveWatchlistSymbolInfo(
  rawSymbol: string,
  catalogMap: Map<string, SymbolQuoteSummary>
): SymbolQuoteSummary {
  const sym = normalizeImportedSymbol(rawSymbol);
  const existing = catalogMap.get(sym);
  if (existing) return existing;

  let market: MarketType = 'US';
  let exchange = 'NASDAQ';
  let currency = 'USD';
  let provider: 'BINANCE' | 'YAHOO' = 'YAHOO';
  let delayMinutes = 15;
  let displayName = sym;

  if (sym.endsWith('.IS')) {
    market = 'BIST';
    exchange = 'BIST';
    currency = 'TRY';
    displayName = `${sym.replace(/\.IS$/, '')} (BIST)`;
  } else if (sym.endsWith('USDT') || sym.endsWith('USDC') || sym.endsWith('FDUSD') || sym.endsWith('BTC')) {
    market = 'CRYPTO';
    exchange = 'BINANCE';
    currency = 'USDT';
    provider = 'BINANCE';
    delayMinutes = 0;
    displayName = `${sym} Spot`;
  } else if (sym.endsWith('=X') || sym.endsWith('=F') || sym.endsWith('.NYB')) {
    market = 'FOREX';
    exchange = 'FX';
    currency = sym.endsWith('TRY=X') ? 'TRY' : 'USD';
    delayMinutes = 10;
    displayName = `${sym} (FX/Emtia)`;
  }

  return {
    symbol: sym,
    displayName,
    market,
    exchange,
    currency,
    provider,
    delayMinutes,
    lastPrice: null,
    changePercent: null,
  };
}

/** İzleme listesi girdilerini (bölümler + semboller) sıralı ve katlanabilir bölüm gruplarına dönüştürür. */
export function buildCustomWatchlistSections(
  wl: SavedWatchlist,
  catalog: SymbolQuoteSummary[],
  sort: WatchlistSortState,
  quotesMap: Record<string, LiveQuote> = {},
  screenerMap: Record<string, ScreenerRow> = {},
  query = ''
): WatchlistSectionGroup[] {
  const catalogMap = new Map<string, SymbolQuoteSummary>();
  for (const item of catalog) {
    catalogMap.set(item.symbol.toUpperCase(), item);
  }
  const q = query.trim().toUpperCase();
  const groups: WatchlistSectionGroup[] = [];
  let current: WatchlistSectionGroup = {
    id: 'sec_root',
    title: '',
    collapsed: false,
    isCustom: false,
    rows: [],
  };

  for (const entry of wl.items) {
    if (entry.type === 'section') {
      if (current.title || current.rows.length > 0) {
        groups.push({
          ...current,
          rows: sortWatchlistRows(current.rows, sort, quotesMap, screenerMap),
        });
      }
      current = {
        id: entry.id || `sec_${groups.length + 1}`,
        title: entry.title || 'BÖLÜM',
        collapsed: Boolean(entry.collapsed),
        isCustom: true,
        rows: [],
      };
    } else if (entry.symbol) {
      const info = resolveWatchlistSymbolInfo(entry.symbol, catalogMap);
      if (q && !info.symbol.toUpperCase().includes(q) && !info.displayName.toUpperCase().includes(q)) {
        continue;
      }
      current.rows.push(info);
    }
  }
  if (current.title || current.rows.length > 0) {
    groups.push({
      ...current,
      rows: sortWatchlistRows(current.rows, sort, quotesMap, screenerMap),
    });
  }
  return groups;
}

/** BORSA:SEMBOL formatını TitanView sembol koduna dönüştürür. */
export function normalizeImportedSymbol(raw: string): string {
  let tok = raw.trim().toUpperCase().replace(/^["']+|["']+$/g, '');
  if (!tok) return '';

  let prefix = '';
  if (tok.includes(':')) {
    const parts = tok.split(':');
    prefix = parts[0].trim();
    tok = parts.slice(1).join(':').trim();
  }

  // Known commodity / FX shorthand aliases
  if (tok === 'USDTRY') return 'USDTRY=X';
  if (tok === 'EURTRY') return 'EURTRY=X';
  if (tok === 'EURUSD') return 'EURUSD=X';
  if (tok === 'GBPUSD') return 'GBPUSD=X';
  if (tok === 'XAUUSD' || tok === 'GOLD' || tok === 'GC1!') return 'GC=F';
  if (tok === 'XAGUSD' || tok === 'SILVER' || tok === 'SI1!') return 'SI=F';
  if (tok === 'UKOIL' || tok === 'BRENT' || tok === 'BZ1!') return 'BZ=F';
  if (tok === 'DXY') return 'DX-Y.NYB';

  if (prefix === 'BIST' && !tok.endsWith('.IS')) {
    return `${tok}.IS`;
  }
  if ((prefix === 'FX' || prefix === 'FX_IDC' || prefix === 'OANDA') && !tok.endsWith('=X')) {
    return `${tok}=X`;
  }
  return tok;
}

/** TitanView sembolünü standart BORSA:SEMBOL formatına çevirir. */
export function toExchangeSymbol(sym: string, market?: MarketType): string {
  const s = sym.trim().toUpperCase();
  if (s.endsWith('.IS')) {
    return `BIST:${s.replace(/\.IS$/, '')}`;
  }
  if (s.endsWith('USDT') || s.endsWith('USDC') || s.endsWith('FDUSD') || market === 'CRYPTO') {
    return `BINANCE:${s}`;
  }
  if (s === 'GC=F') return 'COMEX:GC1!';
  if (s === 'SI=F') return 'COMEX:SI1!';
  if (s === 'BZ=F') return 'ICE:BZ1!';
  if (s === 'DX-Y.NYB') return 'TVC:DXY';
  if (s.endsWith('=X')) {
    return `FX:${s.replace(/=X$/, '')}`;
  }
  return `NASDAQ:${s}`;
}

/**
 * BORSA:SEMBOL `.txt` (`###BÖLÜM,BIST:THYAO,BINANCE:BTCUSDT`) veya `.csv` içeriğini
 * `WatchlistEntry[]` dizisine ayrıştırır.
 */
export function parseWatchlistImportText(text: string): WatchlistEntry[] {
  const raw = text.replace(/^\uFEFF/, '').trim();
  if (!raw) return [];

  const entries: WatchlistEntry[] = [];
  const seenSym = new Set<string>();
  let secCount = 0;

  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  // Detect CSV export with header row: "Sembol,Ad,Piyasa,Bölüm,..." or "Symbol,Section,..."
  if (
    lines.length >= 2 &&
    /^(sembol|symbol)\s*[,;]/i.test(lines[0])
  ) {
    const sep = lines[0].includes(';') ? ';' : ',';
    const headers = lines[0].split(sep).map((h) => h.trim().toLowerCase());
    const symIdx = headers.findIndex((h) => h === 'sembol' || h === 'symbol' || h === 'ticker');
    const secIdx = headers.findIndex((h) => h === 'bölüm' || h === 'bolum' || h === 'section');
    let lastSection = '';

    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(sep).map((c) => c.trim().replace(/^"|"$/g, ''));
      const symRaw = cols[symIdx >= 0 ? symIdx : 0] ?? '';
      const secTitle = secIdx >= 0 ? (cols[secIdx] ?? '').trim() : '';
      if (secTitle && secTitle !== lastSection) {
        lastSection = secTitle;
        secCount++;
        entries.push({ type: 'section', id: `sec_imp_${secCount}`, title: secTitle });
      }
      const norm = normalizeImportedSymbol(symRaw);
      if (norm && !seenSym.has(norm)) {
        seenSym.add(norm);
        entries.push({ type: 'symbol', symbol: norm });
      }
    }
    return entries;
  }

  // BORSA:SEMBOL .txt format: comma and/or newline separated tokens, where `###SECTION` starts a section
  const tokens: string[] = [];
  for (const line of lines) {
    if (line.startsWith('###') && !line.includes(',')) {
      tokens.push(line);
      continue;
    }
    for (const part of line.split(',')) {
      const trimmed = part.trim();
      if (trimmed) tokens.push(trimmed);
    }
  }

  for (const tok of tokens) {
    if (tok.startsWith('###')) {
      const title = tok.replace(/^#+/, '').trim() || 'BÖLÜM';
      secCount++;
      entries.push({ type: 'section', id: `sec_imp_${secCount}`, title });
    } else {
      const norm = normalizeImportedSymbol(tok);
      if (norm && !seenSym.has(norm)) {
        seenSym.add(norm);
        entries.push({ type: 'symbol', symbol: norm });
      }
    }
  }
  return entries;
}

/** İzleme listesini BORSA:SEMBOL `.txt` formatında dışa aktarır. */
export function exportWatchlistTxt(items: WatchlistEntry[]): string {
  const parts: string[] = [];
  for (const it of items) {
    if (it.type === 'section') {
      parts.push(`###${(it.title || 'BÖLÜM').trim()}`);
    } else if (it.symbol) {
      parts.push(toExchangeSymbol(it.symbol));
    }
  }
  return parts.join(',\n');
}

/** İzleme listesini UTF-8 BOM CSV formatında dışa aktarır. */
export function exportWatchlistCsv(
  sections: WatchlistSectionGroup[],
  flags: Record<string, FlagColor>,
  quotesMap: Record<string, LiveQuote> = {},
  screenerMap: Record<string, ScreenerRow> = {}
): string {
  const header = 'Sembol,Ad,Piyasa,Bölüm,Bayrak,Son,Değ,Değ%,Hacim,Uzatılmış Saat%,Teknik Görünüm';
  const rows: string[] = [header];
  const esc = (v: string | number | null | undefined) => {
    if (v == null) return '';
    const s = String(v);
    return s.includes(',') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
  };
  for (const sec of sections) {
    for (const item of sec.rows) {
      const sym = item.symbol.toUpperCase();
      const m = resolveRowMetrics(item, quotesMap, screenerMap);
      const flag = flags[sym] ? FLAG_COLOR_MAP[flags[sym]]?.shortLabel ?? flags[sym] : '';
      rows.push(
        [
          esc(item.symbol),
          esc(item.displayName),
          esc(item.market),
          esc(sec.title),
          esc(flag),
          esc(m.last != null ? m.last.toFixed(2) : ''),
          esc(m.chg != null ? m.chg.toFixed(2) : ''),
          esc(m.chgPct != null ? m.chgPct.toFixed(2) : ''),
          esc(m.vol != null ? Math.round(m.vol) : ''),
          esc(m.ext != null ? m.ext.toFixed(2) : ''),
          esc(m.techRating ?? ''),
        ].join(',')
      );
    }
  }
  return `\uFEFF${rows.join('\n')}`;
}
