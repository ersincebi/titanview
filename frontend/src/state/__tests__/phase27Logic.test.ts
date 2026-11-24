import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BUILTIN_SCREENER_PRESETS,
  SCRIPT_SCREENER_TEMPLATES,
  SCREENER_COLUMN_SETS,
  SCREENER_FILTERS,
  applyScreenerFilters,
  evaluateScreenerFilterRule,
  sortScreenerRows,
} from '../screenerConfig';
import {
  FLAG_COLORS,
  WATCHLIST_COLUMNS,
  buildCustomWatchlistSections,
  exportWatchlistCsv,
  exportWatchlistTxt,
  nextWatchlistSort,
  normalizeImportedSymbol,
  parseWatchlistImportText,
  sortWatchlistRows,
  toExchangeSymbol,
  type WatchlistSortState,
} from '../watchlist';
import {
  activeFlagFilter,
  activeWatchlist,
  addSectionToWatchlist,
  addSymbolToWatchlist,
  createWatchlist,
  cycleSymbolFlag,
  cycleWatchlistSort,
  deleteSymbolNote,
  duplicateWatchlist,
  flagCountsByColor,
  flaggedSymbolsByColor,
  importWatchlistFromText,
  removeSectionFromWatchlist,
  removeSymbolFromWatchlist,
  removeWatchlist,
  renameSectionInWatchlist,
  renameWatchlist,
  saveSymbolNote,
  selectCustomWatchlist,
  selectFlaggedList,
  selectMarketTabMode,
  setSymbolFlag,
  symbolFlags,
  symbolNotes,
  toggleSectionCollapsed,
  toggleWatchlistColumn,
  useCustomWatchlist,
  watchlists,
  wlColumns,
  wlSort,
} from '../watchlistStore';
import type { ScreenerRow, SymbolQuoteSummary } from '../../types/market';

const SAMPLE_SYMBOLS: SymbolQuoteSummary[] = [
  {
    symbol: 'THYAO.IS',
    displayName: 'Türk Hava Yolları',
    market: 'BIST',
    exchange: 'BIST',
    currency: 'TRY',
    provider: 'YAHOO',
    delayMinutes: 15,
    lastPrice: 295.5,
    changeAbs: 5.5,
    changePercent: 1.9,
    volume24h: 45_000_000,
    techRating: 'STRONG_BUY',
    techScore: 4,
  },
  {
    symbol: 'GARAN.IS',
    displayName: 'Garanti BBVA',
    market: 'BIST',
    exchange: 'BIST',
    currency: 'TRY',
    provider: 'YAHOO',
    delayMinutes: 15,
    lastPrice: 118.2,
    changeAbs: -1.8,
    changePercent: -1.5,
    volume24h: 82_000_000,
    techRating: 'SELL',
    techScore: -2,
  },
  {
    symbol: 'AAPL',
    displayName: 'Apple Inc.',
    market: 'US',
    exchange: 'NASDAQ',
    currency: 'USD',
    provider: 'YAHOO',
    delayMinutes: 15,
    lastPrice: 228.4,
    changeAbs: 2.1,
    changePercent: 0.93,
    volume24h: 38_000_000,
    extPrice: 229.8,
    extChangePct: 0.61,
    techRating: 'BUY',
    techScore: 2,
  },
  {
    symbol: 'EMPTY.IS',
    displayName: 'Verisiz Sembol',
    market: 'BIST',
    exchange: 'BIST',
    currency: 'TRY',
    provider: 'YAHOO',
    delayMinutes: 15,
    lastPrice: null,
    changePercent: null,
  },
];

describe('Faz 27 — Watchlist pure logic (sections, sort, columns, 7 flags, .txt/CSV import-export)', () => {
  it('defines 7 flag colors and 6 selectable watchlist columns', () => {
    expect(FLAG_COLORS).toHaveLength(7);
    expect(FLAG_COLORS.map((f) => f.id)).toEqual([
      'red',
      'blue',
      'green',
      'orange',
      'purple',
      'cyan',
      'pink',
    ]);
    expect(WATCHLIST_COLUMNS.map((c) => c.key)).toEqual([
      'last',
      'chg',
      'chgPct',
      'vol',
      'ext',
      'tech',
    ]);
  });

  it('cycles column sort states and sorts rows while keeping null values at the bottom', () => {
    let s: WatchlistSortState = { col: 'symbol', dir: 'none' };
    s = nextWatchlistSort(s, 'symbol');
    expect(s).toEqual({ col: 'symbol', dir: 'asc' });
    s = nextWatchlistSort(s, 'symbol');
    expect(s).toEqual({ col: 'symbol', dir: 'desc' });
    s = nextWatchlistSort(s, 'symbol');
    expect(s).toEqual({ col: 'symbol', dir: 'none' });

    const numSort = nextWatchlistSort(s, 'chgPct');
    expect(numSort).toEqual({ col: 'chgPct', dir: 'desc' });
    const sortedDesc = sortWatchlistRows(SAMPLE_SYMBOLS, numSort);
    expect(sortedDesc.map((r) => r.symbol)).toEqual(['THYAO.IS', 'AAPL', 'GARAN.IS', 'EMPTY.IS']);

    const sortedAsc = sortWatchlistRows(SAMPLE_SYMBOLS, nextWatchlistSort(numSort, 'chgPct'));
    expect(sortedAsc.map((r) => r.symbol)).toEqual(['GARAN.IS', 'AAPL', 'THYAO.IS', 'EMPTY.IS']);

    // Sort by Volume, Extended Hours, and Technical Rating Score
    const byVol = sortWatchlistRows(SAMPLE_SYMBOLS, { col: 'vol', dir: 'desc' });
    expect(byVol[0].symbol).toBe('GARAN.IS');

    const byExt = sortWatchlistRows(SAMPLE_SYMBOLS, { col: 'ext', dir: 'desc' });
    expect(byExt[0].symbol).toBe('AAPL');

    const byTech = sortWatchlistRows(SAMPLE_SYMBOLS, { col: 'tech', dir: 'desc' });
    expect(byTech[0].symbol).toBe('THYAO.IS');
    expect(byTech[2].symbol).toBe('GARAN.IS');
  });

  it('normalizes EXCHANGE:SYMBOL prefixes and parses/exports .txt and .csv', () => {
    expect(normalizeImportedSymbol('BIST:THYAO')).toBe('THYAO.IS');
    expect(normalizeImportedSymbol('BINANCE:BTCUSDT')).toBe('BTCUSDT');
    expect(normalizeImportedSymbol('NASDAQ:AAPL')).toBe('AAPL');
    expect(normalizeImportedSymbol('FX:USDTRY')).toBe('USDTRY=X');
    expect(normalizeImportedSymbol('COMEX:GC1!')).toBe('GC=F');
    expect(normalizeImportedSymbol('TVC:DXY')).toBe('DX-Y.NYB');

    expect(toExchangeSymbol('THYAO.IS')).toBe('BIST:THYAO');
    expect(toExchangeSymbol('BTCUSDT')).toBe('BINANCE:BTCUSDT');
    expect(toExchangeSymbol('GC=F')).toBe('COMEX:GC1!');
    expect(toExchangeSymbol('USDTRY=X')).toBe('FX:USDTRY');
    expect(toExchangeSymbol('AAPL')).toBe('NASDAQ:AAPL');

    const tvTxt = `###BIST HAVACILIK,BIST:THYAO,BIST:PGSUS\n###KRİPTO ANA\nBINANCE:BTCUSDT,BINANCE:ETHUSDT,NASDAQ:AAPL`;
    const parsed = parseWatchlistImportText(tvTxt);
    expect(parsed).toEqual([
      { type: 'section', id: 'sec_imp_1', title: 'BIST HAVACILIK' },
      { type: 'symbol', symbol: 'THYAO.IS' },
      { type: 'symbol', symbol: 'PGSUS.IS' },
      { type: 'section', id: 'sec_imp_2', title: 'KRİPTO ANA' },
      { type: 'symbol', symbol: 'BTCUSDT' },
      { type: 'symbol', symbol: 'ETHUSDT' },
      { type: 'symbol', symbol: 'AAPL' },
    ]);

    const exportedTxt = exportWatchlistTxt(parsed);
    expect(exportedTxt).toContain('###BIST HAVACILIK');
    expect(exportedTxt).toContain('BIST:THYAO');
    expect(exportedTxt).toContain('BINANCE:BTCUSDT');

    const sections = buildCustomWatchlistSections(
      { id: 'wl_test', name: 'Test', items: parsed },
      SAMPLE_SYMBOLS,
      { col: 'symbol', dir: 'none' }
    );
    expect(sections).toHaveLength(2);
    expect(sections[0].title).toBe('BIST HAVACILIK');
    expect(sections[0].rows.map((r) => r.symbol)).toEqual(['THYAO.IS', 'PGSUS.IS']);

    const csv = exportWatchlistCsv(sections, { 'THYAO.IS': 'red' });
    expect(csv).toContain('Sembol,Ad,Piyasa,Bölüm,Bayrak,Son,Değ,Değ%,Hacim,Uzatılmış Saat%,Teknik Görünüm');
    expect(csv).toContain('THYAO.IS,Türk Hava Yolları,BIST,BIST HAVACILIK,Kırmızı,295.50,5.50,1.90,45000000,,STRONG_BUY');

    // Re-importing exported CSV reconstructs sections and symbols
    const fromCsv = parseWatchlistImportText(csv);
    expect(fromCsv.filter((x) => x.type === 'section').map((x) => x.title)).toEqual([
      'BIST HAVACILIK',
      'KRİPTO ANA',
    ]);
    expect(fromCsv.filter((x) => x.type === 'symbol').map((x) => x.symbol)).toContain('THYAO.IS');
  });
});

describe('Faz 27 — watchlistStore reactive operations & Notes store', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        json: async () => ({}),
      })
    );
  });

  it('manages multiple watchlists, sections, symbol flags, columns, and notes', async () => {
    const created = await createWatchlist('Portföy Takip', [
      { type: 'section', id: 's1', title: 'HOLDİNGLER' },
      { type: 'symbol', symbol: 'KCHOL.IS' },
    ]);
    expect(useCustomWatchlist()).toBe(true);
    expect(activeWatchlist().name).toBe('Portföy Takip');

    await renameWatchlist(created.id, 'Portföy Ana');
    expect(activeWatchlist().name).toBe('Portföy Ana');

    await addSymbolToWatchlist('SAHOL.IS');
    expect(activeWatchlist().items.some((i) => i.symbol === 'SAHOL.IS')).toBe(true);

    await addSectionToWatchlist('ENERJİ');
    expect(activeWatchlist().items.some((i) => i.type === 'section' && i.title === 'ENERJİ')).toBe(true);

    await renameSectionInWatchlist('s1', 'KOÇ & SABANCI');
    expect(activeWatchlist().items.find((i) => i.id === 's1')?.title).toBe('KOÇ & SABANCI');

    await toggleSectionCollapsed('s1');
    expect(activeWatchlist().items.find((i) => i.id === 's1')?.collapsed).toBe(true);

    await removeSymbolFromWatchlist('SAHOL.IS');
    expect(activeWatchlist().items.some((i) => i.symbol === 'SAHOL.IS')).toBe(false);

    await removeSectionFromWatchlist('s1');
    expect(activeWatchlist().items.some((i) => i.id === 's1')).toBe(false);

    const dup = await duplicateWatchlist(created.id);
    expect(dup?.name).toContain('Kopya');
    if (dup) await removeWatchlist(dup.id);

    // 7-color flags
    await setSymbolFlag('THYAO.IS', 'red');
    await setSymbolFlag('BTCUSDT', 'blue');
    expect(symbolFlags()['THYAO.IS']).toBe('red');
    expect(flaggedSymbolsByColor('red')).toContain('THYAO.IS');
    expect(flagCountsByColor().red).toBeGreaterThanOrEqual(1);

    await cycleSymbolFlag('THYAO.IS');
    expect(symbolFlags()['THYAO.IS']).toBe('blue');

    selectFlaggedList('blue');
    expect(activeFlagFilter()).toBe('blue');
    selectMarketTabMode();
    expect(activeFlagFilter()).toBeNull();

    // Column & Sort toggles
    const prevVol = wlColumns().vol;
    toggleWatchlistColumn('vol');
    expect(wlColumns().vol).toBe(!prevVol);
    cycleWatchlistSort('last');
    expect(wlSort().col).toBe('last');

    // Import text in append / replace / new modes
    const impRes = await importWatchlistFromText('###TEST,BIST:ASELS,BINANCE:SOLUSDT', 'append');
    expect(impRes.count).toBe(2);
    expect(impRes.sections).toBe(1);

    // Notes store
    const savedNote = await saveSymbolNote({
      symbol: 'THYAO.IS',
      title: 'Test Günlük Notu',
      body: 'Hacimli kırılım',
      tags: 'Analiz',
      sentiment: 'bull',
      snapshotPrice: 295,
      pinned: true,
    });
    expect(savedNote?.title).toBe('Test Günlük Notu');
    expect(symbolNotes().some((n) => n.id === savedNote?.id)).toBe(true);
    if (savedNote) {
      await deleteSymbolNote(savedNote.id);
      expect(symbolNotes().some((n) => n.id === savedNote.id)).toBe(false);
    }
    expect(watchlists().length).toBeGreaterThanOrEqual(3);
  });
});

describe('Faz 27 — Advanced Screener (125+ filters, 8 column sets, presets, Script Screener templates)', () => {
  it('provides 125+ distinct technical and fundamental filters, 8 column sets, 6 presets, and 4 TitanScript templates', () => {
    expect(SCREENER_FILTERS.length).toBeGreaterThanOrEqual(125);
    expect(SCREENER_COLUMN_SETS).toHaveLength(8);
    expect(BUILTIN_SCREENER_PRESETS).toHaveLength(6);
    expect(SCRIPT_SCREENER_TEMPLATES).toHaveLength(4);
  });

  it('filters and sorts ScreenerRow records across numeric, enum, between, and field-vs-field rules', () => {
    const rows: ScreenerRow[] = [
      {
        symbol: 'THYAO.IS',
        displayName: 'Türk Hava Yolları',
        market: 'BIST',
        exchange: 'BIST',
        currency: 'TRY',
        lastPrice: 295,
        changePercent: 2.4,
        volume: 50_000_000,
        rsi14: 61,
        ema20: 285,
        ema50: 272,
        sma200: 250,
        macd: 3.4,
        rating: 'STRONG_BUY',
        score: 4,
        trailingPe: 4.8,
        roePct: 28.5,
        bbWidthPct: 8.5,
      },
      {
        symbol: 'GARAN.IS',
        displayName: 'Garanti BBVA',
        market: 'BIST',
        exchange: 'BIST',
        currency: 'TRY',
        lastPrice: 118,
        changePercent: -1.1,
        volume: 65_000_000,
        rsi14: 34,
        ema20: 120,
        ema50: 122,
        sma200: 105,
        macd: -0.9,
        rating: 'SELL',
        score: -2,
        trailingPe: 3.9,
        roePct: 31.0,
        bbWidthPct: 14.2,
      },
    ];

    expect(
      evaluateScreenerFilterRule(rows[0], {
        id: '1',
        field: 'trailingPe',
        op: 'between',
        value: 2,
        value2: 10,
      })
    ).toBe(true);
    expect(
      evaluateScreenerFilterRule(rows[0], {
        id: '2',
        field: 'rating',
        op: 'eq',
        value: 'STRONG_BUY',
      })
    ).toBe(true);
    expect(
      evaluateScreenerFilterRule(rows[0], {
        id: '3',
        field: 'ema20',
        op: 'above_field',
        value: 0,
        rhsField: 'ema50',
      })
    ).toBe(true);

    const filtered = applyScreenerFilters(
      rows,
      [
        { id: 'f1', field: 'rsi14', op: 'gt', value: 50 },
        { id: 'f2', field: 'roePct', op: 'gt', value: 20 },
      ],
      'THY'
    );
    expect(filtered).toHaveLength(1);
    expect(filtered[0].symbol).toBe('THYAO.IS');

    const sorted = sortScreenerRows(rows, 'rsi14', 'asc');
    expect(sorted.map((r) => r.symbol)).toEqual(['GARAN.IS', 'THYAO.IS']);
  });
});
