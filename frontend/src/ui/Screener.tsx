import { tfmt, tt } from '../state/i18n';
import { For, Show, createEffect, createMemo, createSignal, onMount, type JSX } from 'solid-js';
import {
  deleteScreenerPresetApi,
  fetchScreenerPresetsApi,
  runScriptScreenerApi,
  saveScreenerPresetApi,
} from '../api/phase27';
import { LANG_NAME } from '../script/brand';
import { executeScript } from '../script/runtime';
import { formatPrice, formatSigned, formatVolumeShort } from '../state/format';
import {
  BUILTIN_SCREENER_PRESETS,
  SCRIPT_SCREENER_TEMPLATES,
  SCREENER_COLUMN_SETS,
  SCREENER_FILTERS,
  SCREENER_FILTER_MAP,
  applyScreenerFilters,
  sortScreenerRows,
  type ScreenerCategory,
  type ScreenerColumnSetId,
} from '../state/screenerConfig';
import {
  applyScriptToChart,
  candles,
  refreshScreener,
  screenerRows,
  setUi,
  switchSymbol,
  symbols,
  ui,
} from '../state/store';
import { FLAG_COLORS, FLAG_COLOR_MAP, type MarketFilter } from '../state/watchlist';
import {
  activeWatchlist,
  activeWatchlistId,
  flaggedSymbolsByColor,
  setSymbolFlag,
  symbolFlags,
  watchlists,
} from '../state/watchlistStore';
import type {
  FlagColor,
  ScriptScreenerFilter,
  ScriptScreenerPlotCol,
  ScriptScreenerRow,
  SavedScreenerPreset,
  ScreenerFilterRule,
  ScreenerRow,
  TechnicalRating,
} from '../types/market';

const RATING_TR: Record<string, string> = {
  STRONG_BUY: tt("GÜÇLÜ AL"),
  BUY: tt('▲ AL'),
  NEUTRAL: tt("● NÖTR"),
  SELL: tt('▼ SAT'),
  STRONG_SELL: tt("GÜÇLÜ SAT"),
};

const PATTERN_TR: Record<string, string> = {
  BULL_ENGULFING: tt("Boğa Yutan"),
  BEAR_ENGULFING: tt("Ayı Yutan"),
  HAMMER: tt("Çekiç"),
  SHOOTING_STAR: tt("Kayan Yıldız"),
  DOJI: 'Doji',
  MARUBOZU_BULL: tt("Boğa Marubozu"),
  MARUBOZU_BEAR: tt("Ayı Marubozu"),
  INSIDE_BAR: tt("İç Bar"),
  NONE: '—',
};

const SCR_MARKETS: Array<[MarketFilter | 'ETF', string]> = [
  ['ALL', tt("Tüm Piyasalar")],
  ['BIST', '🇹🇷 BIST 100 (.IS)'],
  ['CRYPTO', tt("₿ Kripto (Binance)")],
  ['US', tt('🇺🇸 ABD (NASDAQ/NYSE)')],
  ['FOREX', tt("Döviz & Altın")],
  ['ETF', tt("ETF Fonları")],
];

const CATEGORIES: Array<ScreenerCategory | 'TÜMÜ'> = [
  'TÜMÜ',
  'Fiyat & Hacim',
  'Performans & Aralık',
  'Hareketli Ortalamalar',
  'Osilatörler',
  'Trend & Volatilite',
  'Derecelendirme & Formasyon',
  'Temel & Değerleme',
  'Kârlılık & Bilanço',
];

const pnlColor = (n: number | null | undefined) =>
  n == null ? 'var(--text-secondary)' : n >= 0 ? 'var(--bull)' : 'var(--bear)';
const sgn = (n: number) => (n >= 0 ? '+' : '');

function formatCompactMoney(val: number | null | undefined, cur = ''): string {
  if (val == null || !Number.isFinite(val)) return '—';
  const abs = Math.abs(val);
  const sign = val < 0 ? '-' : '';
  const sym = cur === 'TRY' ? '₺' : cur === 'USD' || cur === 'USDT' ? '$' : cur === 'EUR' ? '€' : '';
  if (abs >= 1e12) return `${sign}${sym}${(abs / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${sign}${sym}${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}${sym}${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}${sym}${(abs / 1e3).toFixed(1)}K`;
  return `${sign}${sym}${abs.toFixed(2)}`;
}

export function ScreenerPanel(): JSX.Element {
  const [mode, setMode] = createSignal<'standard' | 'script'>('standard');
  const [colSetId, setColSetId] = createSignal<ScreenerColumnSetId>('overview');
  const [scrTimeframe, setScrTimeframe] = createSignal<string>('15m');
  const [searchQuery, setSearchQuery] = createSignal<string>('');
  const [activeFilters, setActiveFilters] = createSignal<ScreenerFilterRule[]>([]);
  const [sortCol, setSortCol] = createSignal<string>('');
  const [sortDir, setSortDir] = createSignal<'asc' | 'desc'>('desc');

  // Filter Drawer state
  const [filterDrawerOpen, setFilterDrawerOpen] = createSignal<boolean>(false);
  const [filterCat, setFilterCat] = createSignal<ScreenerCategory | 'TÜMÜ'>('TÜMÜ');
  const [filterQuery, setFilterQuery] = createSignal<string>('');

  // Saved Screener Presets
  const [userPresets, setUserPresets] = createSignal<SavedScreenerPreset[]>([]);
  const [activePresetId, setActivePresetId] = createSignal<string>('');
  const [savingPreset, setSavingPreset] = createSignal<boolean>(false);
  const [newPresetName, setNewPresetName] = createSignal<string>('');

  // TitanScript Screener state
  const [scriptUniverse, setScriptUniverse] = createSignal<string>('market:ALL');
  const [scriptTf, setScriptTf] = createSignal<string>('15m');
  const [scriptTplId, setScriptTplId] = createSignal<string>(SCRIPT_SCREENER_TEMPLATES[0].id);
  const [scriptCode, setScriptCode] = createSignal<string>(SCRIPT_SCREENER_TEMPLATES[0].code);
  const [showScriptCode, setShowScriptCode] = createSignal<boolean>(false);
  const [scriptFilters, setScriptFilters] = createSignal<ScriptScreenerFilter[]>([]);
  const [scriptOnlyMatched, setScriptOnlyMatched] = createSignal<boolean>(false);
  const [scriptRunning, setScriptRunning] = createSignal<boolean>(false);
  const [scriptError, setScriptError] = createSignal<string>('');
  const [scriptScanTitle, setScriptScanTitle] = createSignal<string>(tfmt("{0} Tarayıcı", LANG_NAME));
  const [scriptColumns, setScriptColumns] = createSignal<ScriptScreenerPlotCol[]>([]);
  const [scriptConditions, setScriptConditions] = createSignal<string[]>([]);
  const [scriptRows, setScriptRows] = createSignal<ScriptScreenerRow[]>([]);
  const [scriptSortCol, setScriptSortCol] = createSignal<string>('');
  const [scriptSortDir, setScriptSortDir] = createSignal<'asc' | 'desc'>('desc');

  onMount(() => {
    void fetchScreenerPresetsApi()
      .then((list) => {
        if (list.length > 0) setUserPresets(list);
      })
      .catch(() => {
        // ignore
      });
  });

  const activeColSet = createMemo(
    () => SCREENER_COLUMN_SETS.find((c) => c.id === colSetId()) ?? SCREENER_COLUMN_SETS[0]
  );

  const allPresets = createMemo(() => [...BUILTIN_SCREENER_PRESETS, ...userPresets()]);

  const catalogFilters = createMemo(() => {
    const cat = filterCat();
    const q = filterQuery().trim().toLowerCase();
    return SCREENER_FILTERS.filter((f) => {
      if (cat !== 'TÜMÜ' && f.category !== cat) return false;
      if (!q) return true;
      return f.label.toLowerCase().includes(q) || f.field.toLowerCase().includes(q) || f.category.toLowerCase().includes(q);
    });
  });

  const filteredAndSortedRows = createMemo(() => {
    const base = applyScreenerFilters(screenerRows(), activeFilters(), searchQuery());
    return sortCol() ? sortScreenerRows(base, sortCol(), sortDir()) : base;
  });

  const handleSortClick = (field: string) => {
    if (sortCol() !== field) {
      setSortCol(field);
      setSortDir(field === 'symbol' ? 'asc' : 'desc');
    } else if (sortDir() === 'desc') {
      setSortDir('asc');
    } else {
      setSortCol('');
    }
  };

  const addFilterRule = (field: string) => {
    const def = SCREENER_FILTER_MAP[field];
    if (!def) return;
    const rule: ScreenerFilterRule = {
      id: `flt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`,
      field: def.field,
      op: def.defaultOp,
      value: def.defaultVal,
      ...(def.defaultVal2 !== undefined ? { value2: def.defaultVal2 } : {}),
    };
    setActiveFilters((prev) => [...prev, rule]);
    if (def.category === 'Temel & Değerleme' || def.category === 'Kârlılık & Bilanço') {
      void refreshScreener(ui.screenerMarket, { timeframe: scrTimeframe(), includeFundamentals: true });
    }
  };

  const updateFilterRule = (id: string, patch: Partial<ScreenerFilterRule>) => {
    setActiveFilters((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  const removeFilterRule = (id: string) => {
    setActiveFilters((prev) => prev.filter((r) => r.id !== id));
  };

  const loadPreset = (presetId: string) => {
    setActivePresetId(presetId);
    const p = allPresets().find((x) => x.id === presetId);
    if (!p) return;
    if (p.columnSet) setColSetId(p.columnSet as ScreenerColumnSetId);
    if (p.timeframe) setScrTimeframe(p.timeframe);
    if (p.config?.filters) setActiveFilters(p.config.filters.map((f) => ({ ...f })));
    if (p.config?.sortCol) {
      setSortCol(p.config.sortCol);
      setSortDir(p.config.sortDir ?? 'desc');
    }
    const mkt = (p.market || 'ALL') as MarketFilter;
    setUi('screenerMarket', mkt);
    const colDef = SCREENER_COLUMN_SETS.find((c) => c.id === p.columnSet);
    void refreshScreener(mkt, {
      timeframe: p.timeframe || scrTimeframe(),
      includeFundamentals: Boolean(colDef?.needsFundamentals),
    });
  };

  const handleSaveCurrentPreset = async () => {
    const name = newPresetName().trim();
    if (!name) return;
    const payload: SavedScreenerPreset = {
      id: `scr_${Date.now().toString(36)}`,
      name,
      market: ui.screenerMarket,
      timeframe: scrTimeframe(),
      columnSet: colSetId(),
      config: {
        filters: activeFilters(),
        sortCol: sortCol() || undefined,
        sortDir: sortDir(),
      },
    };
    setUserPresets((prev) => [payload, ...prev]);
    setActivePresetId(payload.id);
    setSavingPreset(false);
    setNewPresetName('');
    try {
      const saved = await saveScreenerPresetApi(payload);
      if (saved) {
        setUserPresets((prev) => prev.map((x) => (x.id === payload.id ? saved : x)));
        setActivePresetId(saved.id);
      }
    } catch {
      // keep local preset
    }
  };

  const handleDeleteCurrentPreset = async () => {
    const id = activePresetId();
    if (!id || BUILTIN_SCREENER_PRESETS.some((b) => b.id === id)) return;
    setUserPresets((prev) => prev.filter((p) => p.id !== id));
    setActivePresetId('');
    try {
      await deleteScreenerPresetApi(id);
    } catch {
      // ignore
    }
  };

  const exportStandardCsv = () => {
    const cols = activeColSet().columns;
    const header = [tt("Sembol"), 'Ad', tt("Piyasa"), ...cols.map((c) => c.label)].join(',');
    const lines = [header];
    for (const r of filteredAndSortedRows()) {
      const vals = cols.map((c) => {
        const raw = (r as unknown as Record<string, unknown>)[c.field];
        return raw == null ? '' : String(raw);
      });
      lines.push([r.symbol, `"${r.displayName.replace(/"/g, '""')}"`, r.market, ...vals].join(','));
    }
    const blob = new Blob([`\uFEFF${lines.join('\n')}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `titanview_screener_${colSetId()}_${scrTimeframe()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const renderCell = (r: ScreenerRow, field: string, format: string): JSX.Element => {
    if (field === 'rating' || field === 'maRating' || field === 'oscRating') {
      const val = ((r as unknown as Record<string, unknown>)[field] as TechnicalRating | undefined) ?? r.rating;
      return <span class={`rating-badge rating-${val}`}>{RATING_TR[val] || val}</span>;
    }
    if (field === 'candlePattern') {
      const pat = r.candlePattern ?? 'NONE';
      return <span class="scr-pattern-chip">{PATTERN_TR[pat] ?? pat}</span>;
    }
    if (field === 'supertrendDir') {
      const dir = r.supertrendDir ?? 1;
      return (
        <span style={{ color: dir >= 0 ? 'var(--bull)' : 'var(--bear)', 'font-weight': '700' }}>
          {dir >= 0 ? tt("▲ Boğa") : tt("▼ Ayı")}
        </span>
      );
    }

    const raw = (r as unknown as Record<string, unknown>)[field];
    if (raw === null || raw === undefined || (typeof raw === 'number' && !Number.isFinite(raw))) {
      return <span style={{ color: 'var(--text-secondary)' }}>—</span>;
    }
    const num = Number(raw);
    switch (format) {
      case 'price':
        return (
          <span>
            {formatPrice(num)} {field === 'lastPrice' ? r.currency : ''}
          </span>
        );
      case 'pct':
        return (
          <span style={{ color: pnlColor(num), 'font-weight': '600' }}>
            {sgn(num)}
            {num.toFixed(2)}%
          </span>
        );
      case 'vol':
        return <span>{formatVolumeShort(num)}</span>;
      case 'money':
        return <span>{formatCompactMoney(num, r.currency)}</span>;
      case 'num':
      default: {
        if (field === 'rsi14' || field === 'rsi7' || field === 'rsi21') {
          const col = num < 32 ? 'var(--bull)' : num > 70 ? 'var(--bear)' : '#fff';
          return <span style={{ color: col, 'font-weight': '600' }}>{num.toFixed(1)}</span>;
        }
        if (field === 'macd' || field === 'macdHist' || field === 'ao') {
          return <span style={{ color: pnlColor(num) }}>{num.toFixed(2)}</span>;
        }
        if (field === 'relVolume') {
          return <span style={{ color: num >= 1.5 ? 'var(--accent)' : 'inherit' }}>{num.toFixed(2)}x</span>;
        }
        return <span>{num.toFixed(2)}</span>;
      }
    }
  };

  // ---------- TitanScript Tarayıcı ----------

  const runScriptScan = async () => {
    const code = scriptCode().trim();
    if (!code) {
      setScriptError(tt("Betik kodu boş olamaz."));
      return;
    }
    setScriptRunning(true);
    setScriptError('');

    const u = scriptUniverse();
    let market: string | undefined;
    let watchlistId: string | undefined;
    let flagColor: string | undefined;
    let explicitSymbols: string[] | undefined;

    if (u.startsWith('market:')) {
      market = u.slice('market:'.length);
    } else if (u.startsWith('wl:')) {
      watchlistId = u.slice('wl:'.length);
      const localWl = watchlists().find((w) => w.id === watchlistId);
      if (localWl) {
        explicitSymbols = localWl.items.filter((i) => i.type === 'symbol' && i.symbol).map((i) => i.symbol!);
      }
    } else if (u.startsWith('flag:')) {
      flagColor = u.slice('flag:'.length);
      const localFlagged = flaggedSymbolsByColor(flagColor as FlagColor);
      if (localFlagged.length > 0) explicitSymbols = localFlagged;
    }

    try {
      const res = await runScriptScreenerApi({
        code,
        timeframe: scriptTf(),
        market,
        watchlistId,
        flagColor,
        symbols: explicitSymbols,
        filters: scriptFilters(),
        onlyMatched: scriptOnlyMatched(),
      });

      if (!res.ok && res.error) {
        setScriptError(res.error);
        setScriptRunning(false);
        return;
      }

      if (res.rows.length > 0 || res.columns.length > 0) {
        setScriptScanTitle(res.scriptTitle || tfmt("{0} Tarayıcı", LANG_NAME));
        setScriptColumns(res.columns);
        setScriptConditions(res.conditions ?? []);
        setScriptRows(res.rows);
        setScriptRunning(false);
        return;
      }

      // Fallback when running in offline / jsdom test mode with active chart candles
      const localCandles = candles();
      if (localCandles.length >= 5) {
        const exec = executeScript(code, localCandles, { symbol: ui.symbol, timeframe: scriptTf() });
        if (!exec.ok) {
          setScriptError(exec.error || tt("Derleme hatası"));
          setScriptRunning(false);
          return;
        }
        const cols: ScriptScreenerPlotCol[] = exec.plots.map((p, i) => ({
          id: p.id || `plot_${i}`,
          title: p.title || `Çizim ${i + 1}`,
        }));
        const plotsMap: Record<string, number | null> = {};
        for (let i = 0; i < exec.plots.length; i++) {
          const p = exec.plots[i];
          const lastPt = p.data[p.data.length - 1];
          const val = lastPt && Number.isFinite(lastPt.value) ? Math.round(lastPt.value * 1000) / 1000 : null;
          plotsMap[cols[i].id] = val;
          plotsMap[cols[i].title] = val;
        }
        const targetSyms = explicitSymbols?.length
          ? explicitSymbols
          : screenerRows().length
            ? screenerRows().map((r) => r.symbol)
            : [ui.symbol];
        const fallbackRows: ScriptScreenerRow[] = targetSyms.slice(0, 20).map((sym) => {
          const scr = screenerRows().find((r) => r.symbol === sym);
          const symInfo = symbols().find((s) => s.symbol === sym);
          return {
            symbol: sym,
            displayName: scr?.displayName ?? symInfo?.displayName ?? sym,
            market: scr?.market ?? symInfo?.market ?? 'BIST',
            exchange: scr?.exchange ?? symInfo?.exchange ?? 'BIST',
            currency: scr?.currency ?? symInfo?.currency ?? 'TRY',
            lastPrice: scr?.lastPrice ?? localCandles[localCandles.length - 1].close,
            changePercent: scr?.changePercent ?? 0,
            volume: scr?.volume ?? localCandles[localCandles.length - 1].volume,
            plots: plotsMap,
            alertsFired: (exec.alerts ?? []).map((a) => a.title || a.message),
            alertConditions: (exec.alertConditions ?? []).map((c) => c.title),
            matched: true,
            executionMs: exec.executionMs,
          };
        });
        setScriptScanTitle(exec.scriptTitle || tfmt("{0} Tarayıcı", LANG_NAME));
        setScriptColumns(cols);
        setScriptConditions((exec.alertConditions ?? []).map((c) => c.title));
        setScriptRows(fallbackRows);
      } else {
        setScriptRows([]);
      }
    } catch (e) {
      setScriptError(e instanceof Error ? e.message : String(e));
    } finally {
      setScriptRunning(false);
    }
  };

  createEffect(() => {
    if (mode() === 'script' && scriptRows().length === 0 && !scriptRunning()) {
      void runScriptScan();
    }
  });

  const sortedScriptRows = createMemo(() => {
    const list = scriptRows().filter((r) => !scriptOnlyMatched() || r.matched);
    const col = scriptSortCol();
    if (!col || list.length <= 1) return list;
    const mult = scriptSortDir() === 'asc' ? 1 : -1;
    return [...list].sort((a, b) => {
      if (col === 'symbol') return mult * a.symbol.localeCompare(b.symbol, 'tr-TR');
      if (col === 'lastPrice') return mult * (a.lastPrice - b.lastPrice);
      if (col === 'changePercent') return mult * (a.changePercent - b.changePercent);
      const va = a.plots[col];
      const vb = b.plots[col];
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      return mult * (va - vb);
    });
  });

  const addScriptFilter = () => {
    const firstCol = scriptColumns()[0]?.title || 'RSI_14';
    setScriptFilters((prev) => [...prev, { target: firstCol, op: 'gt', value: 50 }]);
  };

  return (
    <div id="wb-panel-screener" class="wb-panel wb-panel-single scr-root" classList={{ active: ui.wbTab === 'screener' }}>
      {/* Üst Mod & Piyasa Çubuğu */}
      <div class="scr-top-bar">
        <div class="scr-mode-switch">
          <button
            id="btn-scr-mode-standard"
            class="chip-btn"
            classList={{ active: mode() === 'standard' }}
            onClick={() => setMode('standard')}
          >
            {tt("📊 Gelişmiş Tarayıcı")}
          </button>
          <button
            id="btn-scr-mode-script"
            class="chip-btn"
            classList={{ active: mode() === 'script' }}
            onClick={() => setMode('script')}
          >
            {tfmt("⚡ {0} Tarayıcı", LANG_NAME)}
          </button>
        </div>

        <Show when={mode() === 'standard'}>
          <div class="scr-market-pills">
            <For each={SCR_MARKETS}>
              {([m, label]) => (
                <button
                  class="chip-btn"
                  classList={{ active: ui.screenerMarket === m }}
                  data-scr-market={m}
                  onClick={() => {
                    setUi('screenerMarket', m as MarketFilter);
                    void refreshScreener(m, {
                      timeframe: scrTimeframe(),
                      includeFundamentals: Boolean(activeColSet().needsFundamentals),
                    });
                  }}
                >
                  {label}
                </button>
              )}
            </For>
          </div>

          <div class="scr-top-actions">
            <select
              id="sel-scr-timeframe"
              class="script-select"
              title={tt("Tarayıcı Zaman Dilimi")}
              value={scrTimeframe()}
              onChange={(e) => {
                const tf = e.currentTarget.value;
                setScrTimeframe(tf);
                void refreshScreener(ui.screenerMarket, {
                  timeframe: tf,
                  includeFundamentals: Boolean(activeColSet().needsFundamentals),
                });
              }}
            >
              <option value="15m">{tt("15 Dakika")}</option>
              <option value="1h">{tt("1 Saat")}</option>
              <option value="4h">{tt("4 Saat")}</option>
              <option value="1d">{tt("1 Gün")}</option>
            </select>

            <select
              id="sel-scr-preset"
              class="script-select"
              title={tt("Kayıtlı Tarayıcı Ekranları")}
              value={activePresetId()}
              onChange={(e) => loadPreset(e.currentTarget.value)}
            >
              <option value="">{tt("★ Kayıtlı Ekranlar (")}{allPresets().length})</option>
              <optgroup label={tt("Hazır Tarayıcı Ekranları")}>
                <For each={BUILTIN_SCREENER_PRESETS}>{(p) => <option value={p.id}>{p.name}</option>}</For>
              </optgroup>
              <Show when={userPresets().length > 0}>
                <optgroup label={tt("Kendi Kaydettiğim Ekranlar")}>
                  <For each={userPresets()}>{(p) => <option value={p.id}>💾 {p.name}</option>}</For>
                </optgroup>
              </Show>
            </select>

            <Show
              when={savingPreset()}
              fallback={
                <button
                  id="btn-scr-save-preset"
                  class="btn-secondary"
                  title={tt("Mevcut filtre ve sütun setini yeni ekran olarak kaydet")}
                  onClick={() => setSavingPreset(true)}
                >
                  {tt("💾 Ekranı Kaydet")}
                </button>
              }
            >
              <div style={{ display: 'inline-flex', gap: '4px', 'align-items': 'center' }}>
                <input
                  id="inp-scr-preset-name"
                  class="script-inp-field"
                  style={{ width: '130px' }}
                  placeholder={tt("Ekran adı…")}
                  value={newPresetName()}
                  onInput={(e) => setNewPresetName(e.currentTarget.value)}
                  onKeyDown={(e) => e.key === 'Enter' && void handleSaveCurrentPreset()}
                />
                <button id="btn-scr-preset-confirm" class="btn-primary" onClick={() => void handleSaveCurrentPreset()}>
                  {tt("Kaydet")}
                </button>
                <button class="btn-secondary" onClick={() => setSavingPreset(false)}>
                  ✕
                </button>
              </div>
            </Show>

            <Show when={activePresetId() && !BUILTIN_SCREENER_PRESETS.some((b) => b.id === activePresetId())}>
              <button
                id="btn-scr-delete-preset"
                class="btn-secondary"
                title={tt("Kayıtlı ekranı sil")}
                onClick={() => void handleDeleteCurrentPreset()}
              >
                🗑
              </button>
            </Show>

            <button
              id="btn-scr-add-filter"
              class="btn-primary"
              onClick={() => setFilterDrawerOpen(!filterDrawerOpen())}
            >
              {tt("+ Filtre (")}{SCREENER_FILTERS.length}) {activeFilters().length > 0 ? `[${activeFilters().length}]` : ''}
            </button>

            <input
              id="inp-scr-search"
              class="script-inp-field"
              style={{ width: '115px' }}
              placeholder={tt("Sembol ara…")}
              value={searchQuery()}
              onInput={(e) => setSearchQuery(e.currentTarget.value)}
            />

            <button id="btn-scr-export-csv" class="btn-secondary" title={tt("Sonuçları CSV indir")} onClick={exportStandardCsv}>
              📤 CSV
            </button>
          </div>
        </Show>
      </div>

      {/* STANDART GELİŞMİŞ TARAYICI GÖRÜNÜMÜ */}
      <Show when={mode() === 'standard'}>
        {/* Sütun Seti Sekmeleri */}
        <div class="scr-colsets-bar" id="scr-colset-tabs">
          <For each={SCREENER_COLUMN_SETS}>
            {(cs) => (
              <button
                class="scr-colset-tab"
                classList={{ active: colSetId() === cs.id }}
                data-colset={cs.id}
                onClick={() => {
                  setColSetId(cs.id);
                  if (cs.needsFundamentals) {
                    void refreshScreener(ui.screenerMarket, {
                      timeframe: scrTimeframe(),
                      includeFundamentals: true,
                    });
                  }
                }}
              >
                {cs.label}
              </button>
            )}
          </For>
          <span class="scr-count-badge" id="scr-count-badge">
            {filteredAndSortedRows().length} / {screenerRows().length}{' '}{tt("sembol ·")}{' '}{SCREENER_FILTERS.length}{' '}{tt("filtre hazır")}
          </span>
        </div>

        {/* Aktif Filtre Yongaları (Chips) */}
        <Show when={activeFilters().length > 0}>
          <div class="scr-active-filters" id="scr-active-filters">
            <For each={activeFilters()}>
              {(rule) => {
                const def = () => SCREENER_FILTER_MAP[rule.field];
                return (
                  <div class="scr-filter-chip" data-active-filter={rule.field}>
                    <span class="scr-filter-chip-lbl">{def()?.label ?? rule.field}</span>
                    <Show
                      when={def()?.kind !== 'enum'}
                      fallback={
                        <select
                          class="scr-filter-op"
                          value={String(rule.value)}
                          onChange={(e) => updateFilterRule(rule.id, { value: e.currentTarget.value })}
                        >
                          <For each={def()?.options ?? []}>
                            {([val, lbl]) => <option value={val}>{lbl}</option>}
                          </For>
                        </select>
                      }
                    >
                      <select
                        class="scr-filter-op"
                        value={rule.op}
                        onChange={(e) => updateFilterRule(rule.id, { op: e.currentTarget.value as ScreenerFilterRule['op'] })}
                      >
                        <option value="gt">{tt("> Büyük")}</option>
                        <option value="gte">{tt("≥ Büyük Eşit")}</option>
                        <option value="lt">{tt("< Küçük")}</option>
                        <option value="lte">{tt("≤ Küçük Eşit")}</option>
                        <option value="between">{tt("↔ Arasında")}</option>
                        <option value="eq">{tt("= Eşit")}</option>
                      </select>
                      <input
                        type="number"
                        step="any"
                        class="scr-filter-val"
                        value={Number(rule.value)}
                        onInput={(e) => updateFilterRule(rule.id, { value: Number(e.currentTarget.value) })}
                      />
                      <Show when={rule.op === 'between'}>
                        <span>–</span>
                        <input
                          type="number"
                          step="any"
                          class="scr-filter-val"
                          value={Number(rule.value2 ?? Number(rule.value) + 10)}
                          onInput={(e) => updateFilterRule(rule.id, { value2: Number(e.currentTarget.value) })}
                        />
                      </Show>
                    </Show>
                    <button
                      class="scr-filter-del"
                      title={tt("Filtreyi kaldır")}
                      onClick={() => removeFilterRule(rule.id)}
                    >
                      ✕
                    </button>
                  </div>
                );
              }}
            </For>
            <button
              id="btn-scr-clear-filters"
              class="btn-secondary"
              style={{ padding: '2px 8px', 'font-size': '10.5px' }}
              onClick={() => setActiveFilters([])}
            >
              {tt("Tüm Filtreleri Temizle")}
            </button>
          </div>
        </Show>

        {/* 125+ Filtre Kataloğu Çekmecesi */}
        <Show when={filterDrawerOpen()}>
          <div class="scr-filter-catalog" id="scr-filter-drawer">
            <div class="scr-filter-catalog-head">
              <div class="scr-filter-cats">
                <For each={CATEGORIES}>
                  {(cat) => (
                    <button
                      class="chip-btn"
                      classList={{ active: filterCat() === cat }}
                      data-filter-cat={cat}
                      onClick={() => setFilterCat(cat)}
                    >
                      {tt(cat)}
                    </button>
                  )}
                </For>
              </div>
              <input
                id="inp-scr-filter-search"
                class="script-inp-field"
                style={{ width: '170px' }}
                placeholder={tfmt("{0} filtre içinde ara…", SCREENER_FILTERS.length)}
                value={filterQuery()}
                onInput={(e) => setFilterQuery(e.currentTarget.value)}
              />
              <button class="btn-secondary" onClick={() => setFilterDrawerOpen(false)}>
                {tt("Kapat ✕")}
              </button>
            </div>
            <div class="scr-filter-grid">
              <For each={catalogFilters()}>
                {(f) => (
                  <button
                    class="scr-filter-item"
                    data-add-filter={f.field}
                    onClick={() => addFilterRule(f.field)}
                  >
                    <span class="scr-filter-item-name">{f.label}</span>
                    <span class="scr-filter-item-cat">{tt(f.category)}</span>
                  </button>
                )}
              </For>
            </div>
          </div>
        </Show>

        {/* Tarayıcı Sonuç Tablosu */}
        <div style={{ 'overflow-y': 'auto', 'overflow-x': 'auto', flex: '1' }}>
          <table class="bt-table scr-table">
            <thead>
              <tr>
                <th style={{ cursor: 'pointer' }} onClick={() => handleSortClick('symbol')}>
                  {tt("Sembol")}{' '}{sortCol() === 'symbol' ? (sortDir() === 'asc' ? '▲' : '▼') : ''}
                </th>
                <th>{tt("Piyasa")}</th>
                <For each={activeColSet().columns}>
                  {(col) => (
                    <th
                      style={{ cursor: 'pointer' }}
                      data-scr-col={col.field}
                      onClick={() => handleSortClick(col.field)}
                    >
                      {col.label} {sortCol() === col.field ? (sortDir() === 'asc' ? '▲' : '▼') : ''}
                    </th>
                  )}
                </For>
              </tr>
            </thead>
            <tbody id="screener-tbody">
              <Show when={filteredAndSortedRows().length === 0}>
                <tr>
                  <td colSpan={activeColSet().columns.length + 2} style={{ color: 'var(--text-secondary)' }}>
                    {screenerRows().length === 0
                      ? tt("Tarayıcı için yeterli gerçek veri yok.")
                      : tt("Seçili filtrelerle eşleşen sembol bulunamadı.")}
                  </td>
                </tr>
              </Show>
              <For each={filteredAndSortedRows()}>
                {(r) => {
                  const flag = () => symbolFlags()[r.symbol.toUpperCase()];
                  return (
                    <tr
                      class="screener-row"
                      data-scr-sym={r.symbol}
                      style={{ cursor: 'pointer' }}
                      onClick={() => void switchSymbol(r.symbol, ui.interval)}
                    >
                      <td>
                        <span
                          class="scr-flag-btn"
                          style={{ color: flag() ? FLAG_COLOR_MAP[flag()!]?.hex : 'var(--text-secondary)', 'margin-right': '5px' }}
                          title={tt("Bayrak işaretle")}
                          onClick={(e) => {
                            e.stopPropagation();
                            const cur = flag();
                            const idx = cur ? FLAG_COLORS.findIndex((c) => c.id === cur) : -1;
                            const next = idx < 0 ? FLAG_COLORS[0].id : idx === FLAG_COLORS.length - 1 ? '' : FLAG_COLORS[idx + 1].id;
                            void setSymbolFlag(r.symbol, next);
                          }}
                        >
                          ⚑
                        </span>
                        <strong>{r.symbol}</strong>{' '}
                        <span style={{ color: 'var(--text-secondary)', 'font-size': '10px' }}>{tt(r.displayName)}</span>
                      </td>
                      <td>
                        <span class={`market-pill market-${r.market}`}>{r.isEtf ? 'ETF' : r.market}</span>
                      </td>
                      <For each={activeColSet().columns}>
                        {(col) => <td>{renderCell(r, col.field, col.format)}</td>}
                      </For>
                    </tr>
                  );
                }}
              </For>
            </tbody>
          </table>
        </div>
      </Show>

      {/* BETİK TARAYICI GÖRÜNÜMÜ */}
      <Show when={mode() === 'script'}>
        <div class="scr-script-view" id="scr-script-view">
          <div class="scr-script-toolbar">
            <label class="scr-script-lbl">
              <span>{tt("Kaynak Liste:")}</span>
              <select
                id="sel-script-scr-universe"
                class="script-select"
                value={scriptUniverse()}
                onChange={(e) => setScriptUniverse(e.currentTarget.value)}
              >
                <optgroup label={tt("Kayıtlı İzleme Listeleri")}>
                  <option value={`wl:${activeWatchlistId()}`}>{tt("📋 Aktif Liste (")}{activeWatchlist().name})</option>
                  <For each={watchlists()}>
                    {(wl) => <option value={`wl:${wl.id}`}>📋 {wl.name} ({wl.items.filter((i) => i.type === 'symbol').length})</option>}
                  </For>
                </optgroup>
                <optgroup label={tt("7 Renkli Bayraklı Listeler")}>
                  <For each={FLAG_COLORS}>
                    {(fc) => <option value={`flag:${fc.id}`}>⚑ {fc.label}</option>}
                  </For>
                </optgroup>
                <optgroup label={tt("Piyasa Katalogları")}>
                  <option value="market:ALL">{tt("Tüm Piyasalar")}</option>
                  <option value="market:BIST">BIST 100 (.IS)</option>
                  <option value="market:CRYPTO">{tt("Kripto (Binance)")}</option>
                  <option value="market:US">{tt("ABD Hisseleri")}</option>
                  <option value="market:FOREX">{tt("Döviz & Emtia")}</option>
                  <option value="market:ETF">{tt("ETF Fonları")}</option>
                </optgroup>
              </select>
            </label>

            <label class="scr-script-lbl">
              <span>{tt("Arama Dilimi:")}</span>
              <select
                id="sel-script-scr-tf"
                class="script-select"
                value={scriptTf()}
                onChange={(e) => setScriptTf(e.currentTarget.value)}
              >
                <option value="5m">{tt("5 Dakika")}</option>
                <option value="15m">{tt("15 Dakika")}</option>
                <option value="1h">{tt("1 Saat")}</option>
                <option value="4h">{tt("4 Saat")}</option>
                <option value="1d">{tt("1 Gün")}</option>
              </select>
            </label>

            <label class="scr-script-lbl">
              <span>{tfmt("{0} Betiği:", LANG_NAME)}</span>
              <select
                id="sel-script-scr-template"
                class="script-select"
                value={scriptTplId()}
                onChange={(e) => {
                  const v = e.currentTarget.value;
                  setScriptTplId(v);
                  if (v === 'editor') {
                    setScriptCode(ui.scriptCode);
                  } else {
                    const tpl = SCRIPT_SCREENER_TEMPLATES.find((t) => t.id === v);
                    if (tpl) setScriptCode(tpl.code);
                  }
                }}
              >
                <For each={SCRIPT_SCREENER_TEMPLATES}>
                  {(tpl) => <option value={tpl.id}>⚡ {tpl.name}</option>}
                </For>
                <option value="editor">{tt("✎ Betik Editöründeki Aktif Betik")}</option>
              </select>
            </label>

            <button
              id="btn-script-scr-code-toggle"
              class="btn-secondary"
              onClick={() => setShowScriptCode(!showScriptCode())}
            >
              {showScriptCode() ? tt("▲ Kodu Gizle") : tt("✎ Betik Kodunu Düzenle")}
            </button>

            <button
              id="btn-script-scr-add-filter"
              class="btn-secondary"
              onClick={addScriptFilter}
            >
              {tt("+ Plot / Koşul Filtresi")}
            </button>

            <label class="study-check" style={{ 'font-size': '11px' }}>
              <input
                id="chk-script-scr-only-matched"
                type="checkbox"
                checked={scriptOnlyMatched()}
                onChange={(e) => setScriptOnlyMatched(e.currentTarget.checked)}
              />
              <span>{tt("Yalnız Eşleşenler")}</span>
            </label>

            <button
              id="btn-script-scr-run"
              class="btn-primary"
              disabled={scriptRunning()}
              onClick={() => void runScriptScan()}
            >
              {scriptRunning() ? tt("⟳ Taranıyor…") : tt("▶ Betik Taramasını Çalıştır")}
            </button>
          </div>

          {/* Satır İçi Betik Kod Düzenleyici */}
          <Show when={showScriptCode()}>
            <div class="scr-script-code-box">
              <textarea
                id="txt-script-scr-code"
                class="scr-script-textarea"
                rows={4}
                value={scriptCode()}
                onInput={(e) => setScriptCode(e.currentTarget.value)}
              />
            </div>
          </Show>

          {/* Betik Plot / Alertcondition Filtre Kuralları */}
          <Show when={scriptFilters().length > 0}>
            <div class="scr-active-filters" id="scr-script-filters">
              <For each={scriptFilters()}>
                {(pf, idx) => (
                  <div class="scr-filter-chip" data-script-filter={idx()}>
                    <select
                      class="scr-filter-op"
                      value={pf.target}
                      onChange={(e) => {
                        const val = e.currentTarget.value;
                        setScriptFilters((prev) => prev.map((x, i) => (i === idx() ? { ...x, target: val } : x)));
                      }}
                    >
                      <For each={scriptColumns()}>
                        {(col) => <option value={col.title}>Plot: {col.title}</option>}
                      </For>
                      <For each={scriptConditions()}>
                        {(c) => <option value={c}>{tt("Koşul:")}{' '}{c}</option>}
                      </For>
                    </select>
                    <select
                      class="scr-filter-op"
                      value={pf.op}
                      onChange={(e) => {
                        const op = e.currentTarget.value as ScriptScreenerFilter['op'];
                        setScriptFilters((prev) => prev.map((x, i) => (i === idx() ? { ...x, op } : x)));
                      }}
                    >
                      <option value="gt">{tt("> Büyük")}</option>
                      <option value="gte">{tt("≥ Büyük Eşit")}</option>
                      <option value="lt">{tt("< Küçük")}</option>
                      <option value="lte">{tt("≤ Küçük Eşit")}</option>
                      <option value="between">{tt("↔ Arasında")}</option>
                      <option value="rising">{tt("↗ Yükseliyor")}</option>
                      <option value="falling">{tt("↘ Düşüyor")}</option>
                      <option value="cross_up">{tt("⤴ Yukarı Keser")}</option>
                      <option value="cross_down">{tt("⤵ Aşağı Keser")}</option>
                      <option value="any_alert">{tt("⚡ Herhangi Bir Uyarı")}</option>
                      <option value="alert_title">{tt("⚡ Bu Alertcondition Tetiklendi")}</option>
                    </select>
                    <Show when={!['rising', 'falling', 'any_alert', 'alert_title', 'not_na', 'truthy'].includes(pf.op)}>
                      <input
                        type="number"
                        step="any"
                        class="scr-filter-val"
                        value={pf.value ?? 0}
                        onInput={(e) => {
                          const v = Number(e.currentTarget.value);
                          setScriptFilters((prev) => prev.map((x, i) => (i === idx() ? { ...x, value: v } : x)));
                        }}
                      />
                    </Show>
                    <button
                      class="scr-filter-del"
                      onClick={() => setScriptFilters((prev) => prev.filter((_, i) => i !== idx()))}
                    >
                      ✕
                    </button>
                  </div>
                )}
              </For>
            </div>
          </Show>

          <Show when={scriptError()}>
            <div class="alert-note" id="script-scr-error" style={{ color: 'var(--bear)', margin: '6px 0' }}>
              {tfmt("✗ {0} Tarayıcı Hatası:", LANG_NAME)}{' '}{scriptError()}
            </div>
          </Show>

          {/* Betik Tarayıcı Sonuç Tablosu */}
          <div style={{ 'overflow-y': 'auto', 'overflow-x': 'auto', flex: '1' }}>
            <table class="bt-table scr-table" id="script-screener-table">
              <thead>
                <tr>
                  <th style={{ cursor: 'pointer' }} onClick={() => { setScriptSortCol('symbol'); setScriptSortDir(scriptSortDir() === 'asc' ? 'desc' : 'asc'); }}>
                    {tt("Sembol")}
                  </th>
                  <th>{tt("Piyasa")}</th>
                  <th style={{ cursor: 'pointer' }} onClick={() => { setScriptSortCol('lastPrice'); setScriptSortDir(scriptSortDir() === 'asc' ? 'desc' : 'asc'); }}>
                    {tt("Son Fiyat")}
                  </th>
                  <th style={{ cursor: 'pointer' }} onClick={() => { setScriptSortCol('changePercent'); setScriptSortDir(scriptSortDir() === 'asc' ? 'desc' : 'asc'); }}>
                    {tt("Değ %")}
                  </th>
                  <th>{tt("Durum / Tetiklenen Sinyal (")}{scriptScanTitle()})</th>
                  <For each={scriptColumns()}>
                    {(col) => (
                      <th
                        style={{ cursor: 'pointer', 'white-space': 'nowrap' }}
                        data-script-plot-col={col.title}
                        onClick={() => {
                          setScriptSortCol(col.title);
                          setScriptSortDir(scriptSortDir() === 'asc' ? 'desc' : 'asc');
                        }}
                      >
                        {col.title}
                      </th>
                    )}
                  </For>
                  <th>{tt("Süre")}</th>
                </tr>
              </thead>
              <tbody id="script-screener-tbody">
                <Show when={sortedScriptRows().length === 0}>
                  <tr>
                    <td colSpan={scriptColumns().length + 6} style={{ color: 'var(--text-secondary)' }}>
                      {scriptRunning() ? tfmt("{0} betiği semboller üzerinde çalıştırılıyor…", LANG_NAME) : tt("Eşleşen betik tarama sonucu bulunamadı.")}
                    </td>
                  </tr>
                </Show>
                <For each={sortedScriptRows()}>
                  {(row) => (
                    <tr
                      class="screener-row"
                      data-script-scr-sym={row.symbol}
                      style={{ cursor: 'pointer' }}
                      onClick={() => {
                        setUi('scriptCode', scriptCode());
                        applyScriptToChart();
                        void switchSymbol(row.symbol, ui.interval);
                      }}
                    >
                      <td>
                        <strong>{row.symbol}</strong>{' '}
                        <span style={{ color: 'var(--text-secondary)', 'font-size': '10px' }}>{tt(row.displayName)}</span>
                      </td>
                      <td>
                        <span class={`market-pill market-${row.market}`}>{row.market}</span>
                      </td>
                      <td>
                        {formatPrice(row.lastPrice)} {row.currency}
                      </td>
                      <td style={{ color: pnlColor(row.changePercent), 'font-weight': '700' }}>
                        {sgn(row.changePercent)}
                        {row.changePercent.toFixed(2)}%
                      </td>
                      <td>
                        <Show
                          when={row.alertsFired.length > 0}
                          fallback={
                            <span class="scr-pattern-chip" style={{ color: row.matched ? 'var(--bull)' : 'var(--text-secondary)' }}>
                              {row.matched ? tt("✓ Koşul Sağlandı") : tt("— Nötr")}
                            </span>
                          }
                        >
                          <For each={row.alertsFired}>
                            {(al) => <span class="rating-badge rating-BUY" style={{ 'margin-right': '4px' }}>⚡ {al}</span>}
                          </For>
                        </Show>
                      </td>
                      <For each={scriptColumns()}>
                        {(col) => {
                          const v = () => row.plots[col.title] ?? row.plots[col.id];
                          return (
                            <td style={{ 'font-family': 'var(--font-mono)', 'font-weight': '600' }}>
                              {v() == null ? '—' : v()!.toFixed(2)}
                            </td>
                          );
                        }}
                      </For>
                      <td style={{ color: 'var(--text-secondary)', 'font-size': '10px' }}>{row.executionMs.toFixed(1)} ms</td>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          </div>
        </div>
      </Show>
    </div>
  );
}
