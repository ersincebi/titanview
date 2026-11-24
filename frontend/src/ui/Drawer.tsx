import { tfmt, lang, t, tt, localeTag } from '../state/i18n';
import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount, type JSX } from 'solid-js';
import {
  alertLog,
  alertsError,
  bulkAlerts,
  clearLog,
  cloneAlert,
  deleteAlert,
  editAlert,
  openPriceAlert,
  restartAlert,
  serverAlerts,
  stopAlert,
} from '../state/alertStore';
import { STATUS_LABELS, describeAlert, triggerLabel } from '../state/alerts';
import '../styles/alerts.css';
import { formatPrice, formatQuotePrice, formatSigned, formatVolumeShort, marketLabel } from '../state/format';
import type { FlagColor, MarketType, ScreenerRow, SymbolNote, SymbolQuoteSummary, TechnicalRating } from '../types/market';
import { hotlists } from '../state/reports';
import { rt } from '../state/runtime';
import { favoriteRows, isFavorite } from '../state/favorites';
import {
  FLAG_COLORS,
  FLAG_COLOR_MAP,
  WATCHLIST_COLUMNS,
  buildCustomWatchlistSections,
  exportWatchlistCsv,
  exportWatchlistTxt,
  filterWatchlistSymbols,
  normalizeImportedSymbol,
  resolveRowMetrics,
  resolveWatchlistSymbolInfo,
  sortWatchlistRows,
  type MarketFilter,
  type WatchlistSectionGroup,
  type WatchlistTab,
} from '../state/watchlist';
import {
  activeFlagFilter,
  activeWatchlist,
  activeWatchlistId,
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
  loadSymbolNotes,
  loadWatchlistsAndFlags,
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
  wlSearchQuery,
  setWlSearchQuery,
  wlSort,
} from '../state/watchlistStore';
import {
  clearDrawings,
  closeDrawer,
  drawings,
  favorites,
  hover,
  lastCandle,
  openDrawerTab,
  quotes,
  refreshWatchlist,
  removeDrawing,
  screenerRows,
  setUi,
  switchSymbol,
  symbols,
  toggleFav,
  toggleToolsPanel,
  toggleWorkbenchMobile,
  ui,
  type RightDrawerTab,
} from '../state/store';
import { ICONS } from '../styles/icons';
import { Icon } from './Icon';
import { AnalysisView } from './Analysis';
import { CalendarView } from './Calendar';
import { SymbolCard } from './SymbolCard';
import { OrderTicket } from './TradePanel';

const TITLES: Record<RightDrawerTab, string> = {
  watchlist: tt("İzleme Listesi"),
  alerts: 'Alarmlar',
  news: tt("Piyasa Haberleri & Gündem"),
  datawindow: tt("Veri Penceresi (İmleç)"),
  hotlists: tt("Günün En Çok Artan/Düşenleri"),
  calendar: tt("Ekonomik Takvim"),
  notes: tt("Notlar & İşlem Günlüğü"),
  ideas: tt("Notlar & İşlem Günlüğü"),
  chats: tt("Notlar & İşlem Günlüğü"),
  notifications: 'Bildirim Merkezi',
  orderpanel: tt("Emir İletim Paneli"),
  objecttree: tt("Nesne Ağacı & Katmanlar"),
  help: tt("Klavye Kısayolları & Yardım"),
};

const DOCK: Array<[RightDrawerTab, keyof typeof ICONS, string]> = [
  ['watchlist', 'watchlist', tt("İzleme Listesi & Detaylar")],
  ['alerts', 'alertsTab', 'Alarmlar'],
  ['news', 'newsTab', tt("Haberler & Gündem")],
  ['datawindow', 'dataWindow', tt("Veri Penceresi")],
  ['hotlists', 'hotlists', tt("Günün Enleri")],
  ['calendar', 'calendarTab', tt("Ekonomik Takvim")],
  ['notes', 'ideasTab', tt("Notlar & İşlem Günlüğü")],
  ['chats', 'chatsTab', tt("Günlük & Yorumlar")],
  ['notifications', 'notificationsTab', 'Bildirimler'],
  ['orderpanel', 'orderPanel', tt("Emir Paneli")],
  ['objecttree', 'objectTree', tt("Nesne Ağacı & Katmanlar")],
];

const WL_TABS: Array<[WatchlistTab, string]> = [
  ['FAV', '★'],
  ['ALL', tt("TÜMÜ")],
  ['BIST', 'BIST'],
  ['CRYPTO', tt("KRİPTO")],
  ['US', 'ABD'],
  ['FOREX', 'FX'],
];

const RATING_SHORT_TR: Record<TechnicalRating, string> = {
  STRONG_BUY: 'G.AL',
  BUY: 'AL',
  NEUTRAL: tt("NÖTR"),
  SELL: 'SAT',
  STRONG_SELL: 'G.SAT',
};

const TOOL_NAME_TR: Record<string, string> = {
  trendline: tt("Trend Çizgisi"),
  ray: tt("Trend Işını"),
  hline: tt("Yatay Çizgi"),
  vline: tt("Dikey Çizgi"),
  channel: tt("Paralel Kanal"),
  fib: tt("Fibonacci Düzeltmesi"),
  rect: 'Arz/Talep Kutusu',
  long_pos: tt("Alış (Long) Cetveli"),
  short_pos: tt("Satış (Short) Cetveli"),
  ruler: tt("Cetvel Ölçümü"),
  brush: tt("Serbest Çizim"),
  text: tt("Metin Notu"),
};

const muted = { color: 'var(--text-secondary)', 'font-size': '10.5px', padding: '6px 0' } as const;

export function DockStrip(): JSX.Element {
  const btn = (tab: RightDrawerTab, icon: keyof typeof ICONS, title: string) => (
    <button
      class="dock-btn"
      classList={{ active: ui.drawerTab === tab }}
      data-docktab={tab}
      title={lang() === 'en' ? t(`drawer.${tab}`) : title}
      onClick={() => openDrawerTab(tab)}
    >
      <Icon svg={ICONS[icon]} />
    </button>
  );
  return (
    <nav class="titan-dock-strip">
      <Show when={ui.mobile}>
        <button
          class="dock-btn mobile-nav-btn"
          classList={{ active: !ui.toolsOpen && ui.drawerTab === null && ui.wbCollapsed }}
          data-mobile-nav="chart"
          title={t('mob.chart')}
          onClick={() => {
            setUi('toolsOpen', false);
            setUi('drawerTab', null);
            setUi('wbCollapsed', true);
          }}
        >
          <span>📈</span>
          <span class="mob-lbl">{t('mob.chart')}</span>
        </button>
        <button
          class="dock-btn mobile-nav-btn"
          classList={{ active: ui.toolsOpen }}
          data-mobile-nav="tools"
          title={t('mob.tools')}
          onClick={toggleToolsPanel}
        >
          <span>✎</span>
          <span class="mob-lbl">{t('mob.tools')}</span>
        </button>
        <button
          class="dock-btn mobile-nav-btn"
          classList={{ active: ui.modal === 'fx' }}
          data-mobile-nav="fx"
          title={t('top.indicators')}
          onClick={() => setUi('modal', 'fx')}
        >
          <span>ƒx</span>
          <span class="mob-lbl">{t('mob.indicators')}</span>
        </button>
        <button
          class="dock-btn mobile-nav-btn"
          classList={{ active: !ui.wbCollapsed }}
          data-mobile-nav="workbench"
          title={t('mob.workbench')}
          onClick={toggleWorkbenchMobile}
        >
          <span>ƒ</span>
          <span class="mob-lbl">{t('mob.workbench')}</span>
        </button>
        <button
          class="dock-btn mobile-nav-btn"
          classList={{ active: ui.modal === 'mobileMore' }}
          data-mobile-nav="more"
          title={t('mob.more')}
          onClick={() => setUi('modal', 'mobileMore')}
        >
          <span>⋯</span>
          <span class="mob-lbl">{t('mob.more')}</span>
        </button>
      </Show>
      <For each={DOCK}>{([tab, icon, title]) => btn(tab, icon, title)}</For>
      <div class="dock-strip-bottom">{btn('help', 'helpTab', t('drawer.help'))}</div>
    </nav>
  );
}

/** standart satır: fiyat değişince kısa yeşil/kırmızı flaş, 7 renk bayrak, seçilebilir sütunlar. */
function WatchRow(props: {
  item: SymbolQuoteSummary;
  screenerMap: Record<string, ScreenerRow>;
  canRemove?: boolean;
}): JSX.Element {
  const item = () => props.item;
  const sym = () => item().symbol.toUpperCase();
  const metrics = createMemo(() => resolveRowMetrics(item(), quotes(), props.screenerMap));
  const price = () => metrics().last;
  const pct = () => metrics().chgPct;
  const chg = () => metrics().chg;
  const vol = () => metrics().vol;
  const ext = () => metrics().ext;
  const techRating = () => metrics().techRating;

  const [flash, setFlash] = createSignal<'up' | 'down' | null>(null);
  const [flagPopover, setFlagPopover] = createSignal(false);
  let prev: number | null = null;
  let t: ReturnType<typeof setTimeout> | undefined;
  createEffect(() => {
    const p = price();
    if (p != null && prev != null && p !== prev) {
      setFlash(p > prev ? 'up' : 'down');
      clearTimeout(t);
      t = setTimeout(() => setFlash(null), 700);
    }
    prev = p ?? prev;
  });
  onCleanup(() => clearTimeout(t));

  const color = () => (pct() == null ? 'var(--text-secondary)' : pct()! >= 0 ? 'var(--bull)' : 'var(--bear)');
  const extColor = () => (ext() == null ? 'var(--text-secondary)' : ext()! >= 0 ? 'var(--bull)' : 'var(--bear)');
  const fav = () => isFavorite(favorites(), item().symbol);
  const flag = () => symbolFlags()[sym()];
  const cols = wlColumns;

  return (
    <div
      class="wl-row"
      classList={{
        active: sym() === ui.symbol,
        'flash-up': flash() === 'up',
        'flash-down': flash() === 'down',
      }}
      data-sym={item().symbol}
      onClick={() => void switchSymbol(item().symbol, ui.interval)}
    >
      <div class="wl-row-pins">
        <button
          class="wl-flag-btn"
          classList={{ flagged: Boolean(flag()) }}
          data-wl-flag={item().symbol}
          title={flag() ? tfmt("{0} (Sağ tık: renk seç, Sol tık: değiştir)", FLAG_COLOR_MAP[flag()!]?.label) : tt("Bayrak işaretle (7 renk)")}
          style={{ color: flag() ? FLAG_COLOR_MAP[flag()!]?.hex : undefined }}
          onClick={(e) => {
            e.stopPropagation();
            void cycleSymbolFlag(item().symbol);
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setFlagPopover(!flagPopover());
          }}
        >
          ⚑
        </button>
        <button
          class="wl-star"
          classList={{ on: fav() }}
          data-fav={item().symbol}
          title={fav() ? tt("Favorilerden çıkar") : tt("Favorilere ekle")}
          onClick={(e) => {
            e.stopPropagation();
            toggleFav({ symbol: item().symbol, displayName: item().displayName, market: item().market });
          }}
        >
          {fav() ? '★' : '☆'}
        </button>
      </div>

      <Show when={flagPopover()}>
        <div
          class="wl-row-flag-palette"
          onClick={(e) => e.stopPropagation()}
        >
          <For each={FLAG_COLORS}>
            {(fc) => (
              <button
                class="sym-flag-dot"
                style={{ background: fc.hex }}
                title={fc.label}
                onClick={() => {
                  void setSymbolFlag(item().symbol, fc.id);
                  setFlagPopover(false);
                }}
              />
            )}
          </For>
          <button
            class="sym-flag-clear"
            onClick={() => {
              void setSymbolFlag(item().symbol, '');
              setFlagPopover(false);
            }}
          >
            ✕
          </button>
        </div>
      </Show>

      <div class="wl-sym-col" title={tt(item().displayName)}>
        <span class={`wl-logo market-bg-${item().market}`}>{item().symbol.replace('.IS', '').slice(0, 1)}</span>
        <span class="wl-sym-code">{item().symbol.replace('.IS', '').replace('USDT', '')}</span>
        <span class={`wl-mkt-dot market-${item().market}`} title={marketLabel(item().market)} />
      </div>

      <Show when={cols().last}>
        <span class="wl-c wl-price">{price() == null ? '—' : formatQuotePrice(price()!)}</span>
      </Show>
      <Show when={cols().chg}>
        <span class="wl-c wl-chgabs" style={{ color: color() }}>
          {chg() == null ? '' : formatSigned(chg()!, Math.abs(chg()!) >= 100 ? 1 : 2, '')}
        </span>
      </Show>
      <Show when={cols().chgPct}>
        <span class="wl-c wl-chg" style={{ color: color() }}>
          {pct() == null ? '—' : formatSigned(pct()!, 2, '%')}
        </span>
      </Show>
      <Show when={cols().vol}>
        <span class="wl-c wl-vol">{vol() == null ? '—' : formatVolumeShort(vol()!)}</span>
      </Show>
      <Show when={cols().ext}>
        <span class="wl-c wl-ext" style={{ color: extColor() }}>
          {ext() == null ? '—' : formatSigned(ext()!, 2, '%')}
        </span>
      </Show>
      <Show when={cols().tech}>
        <span class="wl-c wl-tech">
          <Show when={techRating()} fallback={<span style={{ color: 'var(--text-secondary)' }}>—</span>}>
            {(tr) => <span class={`wl-tech-pill rating-${tr()}`}>{RATING_SHORT_TR[tr()] ?? tr()}</span>}
          </Show>
        </span>
      </Show>

      <Show when={props.canRemove}>
        <button
          class="wl-row-del"
          data-wl-remove-sym={item().symbol}
          title={tt("Listeden çıkar")}
          onClick={(e) => {
            e.stopPropagation();
            void removeSymbolFromWatchlist(item().symbol);
          }}
        >
          ✕
        </button>
      </Show>
    </div>
  );
}

const MARKET_ORDER: MarketType[] = ['BIST', 'US', 'CRYPTO', 'FOREX'];
const MARKET_TITLE: Record<string, string> = { BIST: 'BIST', US: tt("ABD HİSSE"), CRYPTO: tt("KRİPTO"), FOREX: 'ALTIN / FX' };

function downloadTextFile(filename: string, content: string, mime = 'text/plain;charset=utf-8'): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function WatchlistPanel(): JSX.Element {
  const [listMenuOpen, setListMenuOpen] = createSignal(false);
  const [colsMenuOpen, setColsMenuOpen] = createSignal(false);
  const [addMode, setAddMode] = createSignal<'none' | 'symbol' | 'section' | 'newlist' | 'rename' | 'import'>('none');
  const [inputVal, setInputVal] = createSignal('');
  const [importText, setImportText] = createSignal('');
  const [importMode, setImportMode] = createSignal<'replace' | 'append' | 'new'>('replace');
  const [importStatus, setImportStatus] = createSignal('');
  const [collapsedMarketSecs, setCollapsedMarketSecs] = createSignal<Record<string, boolean>>({});
  const [editingSecId, setEditingSecId] = createSignal<string | null>(null);
  const [editingSecTitle, setEditingSecTitle] = createSignal('');

  onMount(() => {
    void loadWatchlistsAndFlags();
  });

  const screenerMap = createMemo(() => {
    const m: Record<string, ScreenerRow> = {};
    for (const r of screenerRows()) {
      m[r.symbol.toUpperCase()] = r;
    }
    return m;
  });

  const catalogMap = createMemo(() => {
    const m = new Map<string, SymbolQuoteSummary>();
    for (const s of symbols()) {
      m.set(s.symbol.toUpperCase(), s);
    }
    return m;
  });

  /** Market-filter tab rows (when not viewing a custom list or flagged list). */
  const marketList = createMemo(() => {
    const q = wlSearchQuery();
    if (ui.marketFilter === 'FAV') {
      return filterWatchlistSymbols(favoriteRows(favorites(), symbols()), 'ALL', q);
    }
    return filterWatchlistSymbols(symbols(), ui.marketFilter, q);
  });

  /** Sections to render depending on active mode: Flagged List, Custom Watchlist, or Market Filter Tabs. */
  const sections = createMemo<WatchlistSectionGroup[]>(() => {
    const flagCol = activeFlagFilter();
    const sort = wlSort();
    const qMap = quotes();
    const sMap = screenerMap();
    const query = wlSearchQuery().trim().toUpperCase();

    if (flagCol) {
      const syms = flaggedSymbolsByColor(flagCol);
      const rows = syms
        .map((sym) => resolveWatchlistSymbolInfo(sym, catalogMap()))
        .filter((r) => !query || r.symbol.toUpperCase().includes(query) || r.displayName.toUpperCase().includes(query));
      return [
        {
          id: `flag_${flagCol}`,
          title: `${FLAG_COLOR_MAP[flagCol]?.label ?? flagCol} (${rows.length})`,
          collapsed: Boolean(collapsedMarketSecs()[`flag_${flagCol}`]),
          isCustom: false,
          rows: sortWatchlistRows(rows, sort, qMap, sMap),
        },
      ];
    }

    if (useCustomWatchlist()) {
      return buildCustomWatchlistSections(activeWatchlist(), symbols(), sort, qMap, sMap, query);
    }

    const rows = marketList();
    if (ui.marketFilter !== 'FAV' && ui.marketFilter !== 'ALL') {
      return [
        {
          id: `mkt_${ui.marketFilter}`,
          title: '',
          collapsed: false,
          isCustom: false,
          rows: sortWatchlistRows(rows, sort, qMap, sMap),
        },
      ];
    }

    return MARKET_ORDER.map((m) => {
      const secId = `mkt_${m}`;
      const mRows = rows.filter((r) => r.market === m);
      return {
        id: secId,
        title: MARKET_TITLE[m],
        collapsed: Boolean(collapsedMarketSecs()[secId]),
        isCustom: false,
        rows: sortWatchlistRows(mRows, sort, qMap, sMap),
      };
    }).filter((x) => x.rows.length > 0);
  });

  const totalRowCount = createMemo(() => sections().reduce((acc, s) => acc + s.rows.length, 0));

  const selectorTitle = () => {
    const fc = activeFlagFilter();
    if (fc) return `⚑ ${FLAG_COLOR_MAP[fc]?.label}`;
    if (useCustomWatchlist()) return `📋 ${activeWatchlist().name}`;
    return tfmt("İzleme Listesi ({0})", ui.marketFilter);
  };

  const sortArrow = (col: string) => {
    const s = wlSort();
    if (s.col !== col || s.dir === 'none') return '';
    return s.dir === 'asc' ? ' ▲' : ' ▼';
  };

  const handleActionSubmit = async () => {
    const val = inputVal().trim();
    const mode = addMode();
    if (!val) return;
    if (mode === 'symbol') {
      selectCustomWatchlist(activeWatchlist().id);
      for (const part of val.split(',')) {
        const norm = normalizeImportedSymbol(part);
        if (norm) await addSymbolToWatchlist(norm);
      }
    } else if (mode === 'section') {
      selectCustomWatchlist(activeWatchlist().id);
      await addSectionToWatchlist(val);
    } else if (mode === 'newlist') {
      await createWatchlist(val);
    } else if (mode === 'rename') {
      await renameWatchlist(activeWatchlist().id, val);
    }
    setInputVal('');
    setAddMode('none');
  };

  const handleFileImport = (e: Event) => {
    const file = (e.currentTarget as HTMLInputElement).files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setImportText(String(reader.result ?? ''));
    };
    reader.readAsText(file);
  };

  const handleRunImport = async () => {
    const res = await importWatchlistFromText(
      importText(),
      importMode(),
      inputVal().trim() || tt("İçe Aktarılan Liste")
    );
    setImportStatus(`✓ ${res.count} sembol ve ${res.sections} bölüm içe aktarıldı.`);
    setTimeout(() => {
      setAddMode('none');
      setImportStatus('');
      setImportText('');
    }, 1100);
  };

  const handleExportTxt = () => {
    if (useCustomWatchlist()) {
      downloadTextFile(`${activeWatchlist().name.replace(/\s+/g, '_')}.txt`, exportWatchlistTxt(activeWatchlist().items));
      return;
    }
    const entries = sections().flatMap((sec) => [
      ...(sec.title ? [{ type: 'section' as const, title: sec.title }] : []),
      ...sec.rows.map((r) => ({ type: 'symbol' as const, symbol: r.symbol })),
    ]);
    downloadTextFile(`titanview_watchlist_${ui.marketFilter}.txt`, exportWatchlistTxt(entries));
  };

  const handleExportCsv = () => {
    const csv = exportWatchlistCsv(sections(), symbolFlags(), quotes(), screenerMap());
    const name = useCustomWatchlist() ? activeWatchlist().name.replace(/\s+/g, '_') : `watchlist_${ui.marketFilter}`;
    downloadTextFile(`${name}.csv`, csv, 'text/csv;charset=utf-8');
  };

  return (
    <div id="drawer-panel-watchlist" class="drawer-subpanel" style={{ display: 'flex', 'flex-direction': 'column', height: '100%' }}>
      {/* Faz 27: Çoklu Liste Seçici, +Sembol, +Bölüm, Sütun Seçimi Çubuğu */}
      <div class="wl-top-toolbar">
        <div class="wl-selector-wrap">
          <button
            id="btn-wl-list-menu"
            class="wl-selector-btn"
            title={tt("İzleme Listesi Değiştir / Bayraklı Listeler / İçe-Dışa Aktar")}
            onClick={() => {
              setListMenuOpen(!listMenuOpen());
              setColsMenuOpen(false);
            }}
          >
            <span class="wl-selector-lbl">{selectorTitle()}</span>
            <span class="wl-selector-chev">▾</span>
          </button>

          <Show when={listMenuOpen()}>
            <div class="pane-menu wl-dropdown-menu" id="wl-dropdown-menu">
              <div class="wl-menu-heading">{tt("7 RENKLİ BAYRAKLI LİSTELER")}</div>
              <div class="wl-flag-menu-grid">
                <For each={FLAG_COLORS}>
                  {(fc) => {
                    const cnt = () => flagCountsByColor()[fc.id] ?? 0;
                    return (
                      <button
                        class="wl-flag-menu-item"
                        classList={{ active: activeFlagFilter() === fc.id }}
                        data-flag-list={fc.id}
                        onClick={() => {
                          selectFlaggedList(activeFlagFilter() === fc.id ? null : fc.id);
                          setListMenuOpen(false);
                        }}
                      >
                        <span class="sym-flag-dot" style={{ background: fc.hex }} />
                        <span>{fc.shortLabel}</span>
                        <span class="wl-flag-cnt">{cnt()}</span>
                      </button>
                    );
                  }}
                </For>
              </div>

              <div class="wl-menu-heading">{tt("KAYITLI İZLEME LİSTELERİ")}</div>
              <For each={watchlists()}>
                {(wl) => (
                  <div
                    class="wl-saved-item"
                    classList={{ active: useCustomWatchlist() && activeWatchlistId() === wl.id }}
                  >
                    <button
                      class="wl-saved-item-btn"
                      data-select-wl={wl.id}
                      onClick={() => {
                        selectCustomWatchlist(wl.id);
                        setListMenuOpen(false);
                      }}
                    >
                      <span>📋 {wl.name}</span>
                      <span class="wl-flag-cnt">{wl.items.filter((i) => i.type === 'symbol').length}</span>
                    </button>
                    <button
                      class="wl-saved-act"
                      title={tt("Yeniden Adlandır")}
                      data-rename-wl={wl.id}
                      onClick={() => {
                        selectCustomWatchlist(wl.id);
                        setInputVal(wl.name);
                        setAddMode('rename');
                        setListMenuOpen(false);
                      }}
                    >
                      ✎
                    </button>
                    <button
                      class="wl-saved-act"
                      title={tt("Kopyala")}
                      data-dup-wl={wl.id}
                      onClick={() => {
                        void duplicateWatchlist(wl.id);
                        setListMenuOpen(false);
                      }}
                    >
                      ⧉
                    </button>
                    <Show when={watchlists().length > 1}>
                      <button
                        class="wl-saved-act"
                        title={tt("Listeyi Sil")}
                        data-del-wl={wl.id}
                        onClick={() => {
                          void removeWatchlist(wl.id);
                        }}
                      >
                        ✕
                      </button>
                    </Show>
                  </div>
                )}
              </For>

              <div class="wl-menu-divider" />
              <button
                id="btn-wl-create-new"
                class="pane-menu-item"
                onClick={() => {
                  setInputVal('');
                  setAddMode('newlist');
                  setListMenuOpen(false);
                }}
              >
                {tt("＋ Yeni İzleme Listesi Oluştur…")}
              </button>
              <button
                id="btn-wl-import-open"
                class="pane-menu-item"
                onClick={() => {
                  setAddMode('import');
                  setListMenuOpen(false);
                }}
              >
                {tt("📥 İçe Aktar (.txt / CSV)…")}
              </button>
              <button
                id="btn-wl-export-txt"
                class="pane-menu-item"
                onClick={() => {
                  handleExportTxt();
                  setListMenuOpen(false);
                }}
              >
                {tt("📤 Dışa Aktar (.txt — BORSA:SEMBOL)")}
              </button>
              <button
                id="btn-wl-export-csv"
                class="pane-menu-item"
                onClick={() => {
                  handleExportCsv();
                  setListMenuOpen(false);
                }}
              >
                {tt("📤 Dışa Aktar (.csv — Tablo)")}
              </button>
            </div>
          </Show>
        </div>

        <div class="wl-toolbar-btns">
          <button
            id="btn-wl-add-sym-toggle"
            class="wl-tool-btn"
            title={tt("Listeye Sembol Ekle")}
            onClick={() => {
              setInputVal('');
              setAddMode(addMode() === 'symbol' ? 'none' : 'symbol');
            }}
          >
            {tt("＋Sembol")}
          </button>
          <button
            id="btn-wl-add-sec-toggle"
            class="wl-tool-btn"
            title={tt("Listeye Bölüm Başlığı (###BÖLÜM) Ekle")}
            onClick={() => {
              setInputVal('');
              setAddMode(addMode() === 'section' ? 'none' : 'section');
            }}
          >
            {tt("＋Bölüm")}
          </button>
          <div style={{ position: 'relative' }}>
            <button
              id="btn-wl-cols-menu"
              class="wl-tool-btn"
              title={tt("Sütun Seçimi (Son, Değ, Değ%, Hacim, Uzatılmış Saat, Teknik Puan)")}
              onClick={() => {
                setColsMenuOpen(!colsMenuOpen());
                setListMenuOpen(false);
              }}
            >
              ⚙
            </button>
            <Show when={colsMenuOpen()}>
              <div class="pane-menu wl-cols-popover" id="wl-cols-popover">
                <div class="wl-menu-heading">{tt("SÜTUNLAR")}</div>
                <For each={WATCHLIST_COLUMNS}>
                  {(col) => (
                    <label class="wl-col-check">
                      <input
                        type="checkbox"
                        data-wl-col-toggle={col.key}
                        checked={wlColumns()[col.key]}
                        onChange={() => toggleWatchlistColumn(col.key)}
                      />
                      <span>{col.label}</span>
                    </label>
                  )}
                </For>
              </div>
            </Show>
          </div>
        </div>
      </div>

      {/* Satır İçi Sembol / Bölüm / Yeni Liste / Yeniden Adlandır / İçe Aktar Kutusu */}
      <Show when={addMode() !== 'none' && addMode() !== 'import'}>
        <div class="wl-inline-form" id="wl-inline-form">
          <input
            id="inp-wl-inline"
            class="wl-search-input"
            placeholder={
              addMode() === 'symbol'
                ? tt("Sembol ekle (örn. ASTOR.IS, BIST:GARAN, SOLUSDT)…")
                : addMode() === 'section'
                  ? tt("Bölüm başlığı (örn. BANKALAR, ENERJİ)…")
                  : addMode() === 'newlist'
                    ? tt("Yeni izleme listesi adı…")
                    : tt("Yeni liste adı…")
            }
            value={inputVal()}
            onInput={(e) => setInputVal(e.currentTarget.value)}
            onKeyDown={(e) => e.key === 'Enter' && void handleActionSubmit()}
          />
          <button id="btn-wl-inline-ok" class="btn-primary" onClick={() => void handleActionSubmit()}>
            {tt("Ekle")}
          </button>
          <button class="btn-secondary" onClick={() => setAddMode('none')}>
            ✕
          </button>
        </div>
      </Show>

      <Show when={addMode() === 'import'}>
        <div class="wl-import-box" id="wl-import-box">
          <div style={{ display: 'flex', 'justify-content': 'space-between', 'align-items': 'center' }}>
            <strong style={{ 'font-size': '11px', color: '#fff' }}>{tt("📥 İzleme Listesi İçe Aktar (.txt / CSV)")}</strong>
            <button class="btn-secondary" style={{ padding: '1px 6px' }} onClick={() => setAddMode('none')}>
              ✕
            </button>
          </div>
          <input
            id="inp-wl-import-file"
            type="file"
            accept=".txt,.csv"
            style={{ 'font-size': '10.5px' }}
            onChange={handleFileImport}
          />
          <textarea
            id="txt-wl-import-raw"
            class="scr-script-textarea"
            rows={4}
            placeholder={tt("###BIST BANKALAR,BIST:GARAN,BIST:AKBNK,###KRİPTO,BINANCE:BTCUSDT,NASDAQ:AAPL")}
            value={importText()}
            onInput={(e) => setImportText(e.currentTarget.value)}
          />
          <div style={{ display: 'flex', gap: '6px', 'align-items': 'center', 'flex-wrap': 'wrap' }}>
            <select
              id="sel-wl-import-mode"
              class="script-select"
              value={importMode()}
              onChange={(e) => setImportMode(e.currentTarget.value as 'replace' | 'append' | 'new')}
            >
              <option value="replace">{tt("Aktif Listeyi Değiştir")}</option>
              <option value="append">{tt("Aktif Listeye Ekle")}</option>
              <option value="new">{tt("Yeni Liste Oluştur")}</option>
            </select>
            <Show when={importMode() === 'new'}>
              <input
                id="inp-wl-import-name"
                class="wl-search-input"
                style={{ flex: '1', 'min-width': '100px' }}
                placeholder={tt("Liste adı…")}
                value={inputVal()}
                onInput={(e) => setInputVal(e.currentTarget.value)}
              />
            </Show>
            <button id="btn-wl-import-confirm" class="btn-primary" onClick={() => void handleRunImport()}>
              {tt("İçe Aktar")}
            </button>
          </div>
          <Show when={importStatus()}>
            <div id="wl-import-status" style={{ color: 'var(--bull)', 'font-size': '11px' }}>
              {importStatus()}
            </div>
          </Show>
        </div>
      </Show>

      {/* Piyasa Sekmeleri + Özel Liste Sekmesi + Hızlı Arama */}
      <div class="wl-header">
        <div class="wl-market-tabs">
          <For each={WL_TABS}>
            {([m, label]) => (
              <button
                class="wl-tab"
                classList={{ active: !useCustomWatchlist() && !activeFlagFilter() && ui.marketFilter === m }}
                data-market={m}
                onClick={() => {
                  selectMarketTabMode();
                  setUi('marketFilter', m);
                  void refreshWatchlist();
                }}
              >
                {label}
              </button>
            )}
          </For>
          <button
            id="btn-wl-custom-mode"
            class="wl-tab"
            classList={{ active: useCustomWatchlist() }}
            title={tt("Çoklu / Bölümlü Özel İzleme Listesi")}
            onClick={() => selectCustomWatchlist(activeWatchlist().id)}
          >
            {tt("LİSTEM")}
          </button>
        </div>
      </div>

      <Show when={!useCustomWatchlist() && !activeFlagFilter() && ui.marketFilter === 'FAV' && favorites().length > 0}>
        <div class="wl-fav-note" id="wl-fav-note">
          {tt("★ Favorilerin 15dk ve 1sa mumları sunucuda arka planda kaydedilir.")}
        </div>
      </Show>

      {/* Sütun Başlığıyla Sıralama + Bölümlü & Sıralanabilir Sembol Listesi (yatay/dikey kaydırmalı) */}
      <div class="wl-scroll-wrap">
      <div class="wl-colhead">
        <span />
        <span
          class="wl-col-sortable"
          data-wl-sort="symbol"
          title={lang() === 'en' ? 'Sort by symbol' : 'Sembole göre sırala'}
          onClick={() => cycleWatchlistSort('symbol')}
        >
          {lang() === 'en' ? 'Symbol' : 'Sembol'}{sortArrow('symbol')}
        </span>
        <Show when={wlColumns().last}>
          <span
            class="wl-col-sortable"
            data-wl-sort="last"
            title={lang() === 'en' ? 'Sort by last price' : 'Son fiyata göre sırala'}
            onClick={() => cycleWatchlistSort('last')}
          >
            {lang() === 'en' ? 'Last' : 'Son'}{sortArrow('last')}
          </span>
        </Show>
        <Show when={wlColumns().chg}>
          <span
            class="wl-col-sortable"
            data-wl-sort="chg"
            title={lang() === 'en' ? 'Sort by change' : 'Değişime göre sırala'}
            onClick={() => cycleWatchlistSort('chg')}
          >
            {lang() === 'en' ? 'Chg' : 'Değ'}{sortArrow('chg')}
          </span>
        </Show>
        <Show when={wlColumns().chgPct}>
          <span
            class="wl-col-sortable"
            data-wl-sort="chgPct"
            title={lang() === 'en' ? 'Sort by % change' : 'Yüzde değişime göre sırala'}
            onClick={() => cycleWatchlistSort('chgPct')}
          >
            {lang() === 'en' ? 'Chg%' : 'Değ%'}{sortArrow('chgPct')}
          </span>
        </Show>
        <Show when={wlColumns().vol}>
          <span
            class="wl-col-sortable"
            data-wl-sort="vol"
            title={lang() === 'en' ? 'Sort by volume' : 'Hacme göre sırala'}
            onClick={() => cycleWatchlistSort('vol')}
          >
            {lang() === 'en' ? 'Vol' : 'Hacim'}{sortArrow('vol')}
          </span>
        </Show>
        <Show when={wlColumns().ext}>
          <span
            class="wl-col-sortable"
            data-wl-sort="ext"
            title={lang() === 'en' ? 'Sort by extended hours' : 'Uzatılmış saat değişimine göre sırala'}
            onClick={() => cycleWatchlistSort('ext')}
          >
            {lang() === 'en' ? 'Ext.' : 'Uzat.'}{sortArrow('ext')}
          </span>
        </Show>
        <Show when={wlColumns().tech}>
          <span
            class="wl-col-sortable"
            data-wl-sort="tech"
            title={lang() === 'en' ? 'Sort by technical rating' : 'Teknik puana göre sırala'}
            onClick={() => cycleWatchlistSort('tech')}
          >
            {lang() === 'en' ? 'Tech' : 'Teknik'}{sortArrow('tech')}
          </span>
        </Show>
      </div>

      {/* Bölümlü & Sıralanabilir Sembol Listesi */}
      <div id="wl-list" class="wl-list">
        <Show
          when={totalRowCount() > 0 || (useCustomWatchlist() && sections().length > 0)}
          fallback={
            <div style={{ padding: '16px', 'text-align': 'center', color: 'var(--text-secondary)', 'font-size': '11px' }} id="wl-empty">
              {activeFlagFilter()
                ? tt("Bu renkte bayraklı sembol yok. Satırlardaki ⚑ simgesine tıklayarak bayrak ekleyin.")
                : ui.marketFilter === 'FAV'
                  ? tt("Henüz favori yok. ⌘K ile sembol ara, ☆ ile ekle.")
                  : tt("Eşleşen sembol bulunamadı.")}
            </div>
          }
        >
          <For each={sections()}>
            {(sec) => (
              <>
                <Show when={sec.title}>
                  <div
                    class="wl-section"
                    data-wl-section={sec.id}
                    onClick={() => {
                      if (sec.isCustom) {
                        void toggleSectionCollapsed(sec.id);
                      } else {
                        setCollapsedMarketSecs((prev) => ({ ...prev, [sec.id]: !prev[sec.id] }));
                      }
                    }}
                  >
                    <span class="wl-sec-chev">{sec.collapsed ? '›' : '⌄'}</span>
                    <Show
                      when={editingSecId() === sec.id}
                      fallback={<span class="wl-sec-title">{sec.title}</span>}
                    >
                      <input
                        class="wl-sec-rename-inp"
                        value={editingSecTitle()}
                        onClick={(e) => e.stopPropagation()}
                        onInput={(e) => setEditingSecTitle(e.currentTarget.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            void renameSectionInWatchlist(sec.id, editingSecTitle());
                            setEditingSecId(null);
                          }
                        }}
                      />
                    </Show>
                    <span class="wl-sec-count">{sec.rows.length}</span>
                    <Show when={sec.isCustom}>
                      <span class="wl-sec-acts" onClick={(e) => e.stopPropagation()}>
                        <button
                          title={tt("Bölümü Yeniden Adlandır")}
                          data-rename-sec={sec.id}
                          onClick={() => {
                            if (editingSecId() === sec.id) {
                              void renameSectionInWatchlist(sec.id, editingSecTitle());
                              setEditingSecId(null);
                            } else {
                              setEditingSecId(sec.id);
                              setEditingSecTitle(sec.title);
                            }
                          }}
                        >
                          ✎
                        </button>
                        <button
                          title={tt("Bölüm Başlığını Sil")}
                          data-del-sec={sec.id}
                          onClick={() => void removeSectionFromWatchlist(sec.id)}
                        >
                          ✕
                        </button>
                      </span>
                    </Show>
                  </div>
                </Show>
                <Show when={!sec.collapsed}>
                  <For each={sec.rows}>
                    {(item) => (
                      <WatchRow
                        item={item}
                        screenerMap={screenerMap()}
                        canRemove={useCustomWatchlist()}
                      />
                    )}
                  </For>
                </Show>
              </>
            )}
          </For>
        </Show>
      </div>
      </div>

      <div class="wl-analysis" id="wl-analysis">
        <SymbolCard />
        <Show when={!ui.simple}>
          <AnalysisView />
        </Show>
      </div>
    </div>
  );
}

/** Faz 27: Notlar / İşlem Günlüğü Sekmesi */
function NotesPanel(): JSX.Element {
  const [onlyCurrentSym, setOnlyCurrentSym] = createSignal(false);
  const [tagFilter, setTagFilter] = createSignal<string>('TÜMÜ');
  const [query, setQuery] = createSignal('');
  const [editingId, setEditingId] = createSignal<string>('');
  const [title, setTitle] = createSignal('');
  const [body, setBody] = createSignal('');
  const [tag, setTag] = createSignal(tt("Analiz"));
  const [sentiment, setSentiment] = createSignal<'bull' | 'bear' | 'neutral'>('bull');
  const [pinned, setPinned] = createSignal(false);

  onMount(() => {
    void loadSymbolNotes();
  });

  const currentPrice = () => {
    const q = quotes()[ui.symbol.toUpperCase()];
    return q?.last ?? lastCandle()?.close ?? 0;
  };

  const filteredNotes = createMemo(() => {
    const sym = ui.symbol.toUpperCase();
    const tf = tagFilter();
    const q = query().trim().toLowerCase();
    return symbolNotes().filter((n) => {
      if (onlyCurrentSym() && n.symbol.toUpperCase() !== sym) return false;
      if (tf !== 'TÜMÜ' && !n.tags.toLowerCase().includes(tf.toLowerCase())) return false;
      if (!q) return true;
      return (
        n.symbol.toLowerCase().includes(q) ||
        n.title.toLowerCase().includes(q) ||
        n.body.toLowerCase().includes(q) ||
        n.tags.toLowerCase().includes(q)
      );
    });
  });

  const handleSubmit = async () => {
    if (!title().trim() && !body().trim()) return;
    await saveSymbolNote({
      id: editingId() || undefined,
      symbol: ui.symbol,
      title: title().trim(),
      body: body().trim(),
      tags: tag(),
      sentiment: sentiment(),
      snapshotPrice: currentPrice(),
      timeframe: ui.interval,
      pinned: pinned(),
    });
    setEditingId('');
    setTitle('');
    setBody('');
    setPinned(false);
  };

  const startEdit = (n: SymbolNote) => {
    setEditingId(n.id);
    setTitle(n.title);
    setBody(n.body);
    setTag(n.tags || tt("Analiz"));
    setSentiment(n.sentiment || 'neutral');
    setPinned(n.pinned);
  };

  return (
    <div id="drawer-panel-notes" class="drawer-subpanel" style={{ display: 'flex', 'flex-direction': 'column', padding: '12px', 'overflow-y': 'auto', gap: '10px' }}>
      <div style={{ display: 'flex', 'justify-content': 'space-between', 'align-items': 'center' }}>
        <strong style={{ color: '#fff', 'font-size': '12.5px' }}>{tt("📝 Notlar & İşlem Günlüğü")}</strong>
        <label class="study-check" style={{ 'font-size': '11px' }}>
          <input
            id="chk-notes-only-sym"
            type="checkbox"
            checked={onlyCurrentSym()}
            onChange={(e) => setOnlyCurrentSym(e.currentTarget.checked)}
          />
          <span>{tt("Yalnız")}{' '}{ui.symbol}</span>
        </label>
      </div>

      {/* Yeni Not / Günlük Kaydı Formu */}
      <div class="note-editor-card" id="form-symbol-note">
        <div style={{ display: 'flex', 'justify-content': 'space-between', 'align-items': 'center', 'font-size': '10.5px', color: 'var(--text-secondary)' }}>
          <span>
            {tt("Aktif Sembol:")}{' '}<strong style={{ color: 'var(--accent)' }}>{ui.symbol}</strong> ({ui.interval})
          </span>
          <span>
            {tt("Anlık Fiyat:")}{' '}<strong>{currentPrice() > 0 ? formatQuotePrice(currentPrice()) : '—'}</strong>
          </span>
        </div>

        <input
          id="inp-note-title"
          class="wl-search-input"
          placeholder={tt("Not başlığı (örn. 290 TL destek testi / bilanço notu)…")}
          value={title()}
          onInput={(e) => setTitle(e.currentTarget.value)}
        />
        <textarea
          id="txt-note-body"
          class="scr-script-textarea"
          rows={3}
          placeholder={tt("Teknik analiz gözlemi, giriş/çıkış seviyesi, risk yönetimi notu…")}
          value={body()}
          onInput={(e) => setBody(e.currentTarget.value)}
        />
        <div style={{ display: 'flex', gap: '6px', 'align-items': 'center', 'flex-wrap': 'wrap' }}>
          <select
            id="sel-note-tag"
            class="script-select"
            value={tag()}
            onChange={(e) => setTag(e.currentTarget.value)}
          >
            <option value="Analiz">{tt("📊 Analiz")}</option>
            <option value="İşlem Planı">{tt("🎯 İşlem Planı")}</option>
            <option value="Bilanço">{tt("📑 Bilanço")}</option>
            <option value="Risk">{tt("🛡 Risk")}</option>
            <option value="Günlük">{tt("📓 Günlük")}</option>
          </select>

          <select
            id="sel-note-sentiment"
            class="script-select"
            value={sentiment()}
            onChange={(e) => setSentiment(e.currentTarget.value as 'bull' | 'bear' | 'neutral')}
          >
            <option value="bull">{tt("▲ Boğa (Alış)")}</option>
            <option value="neutral">{tt("● Nötr")}</option>
            <option value="bear">{tt("▼ Ayı (Satış)")}</option>
          </select>

          <label class="study-check" style={{ 'font-size': '11px' }}>
            <input
              id="chk-note-pin"
              type="checkbox"
              checked={pinned()}
              onChange={(e) => setPinned(e.currentTarget.checked)}
            />
            <span>{tt("📌 Sabitle")}</span>
          </label>

          <span style={{ flex: '1' }} />
          <Show when={editingId()}>
            <button
              class="btn-secondary"
              onClick={() => {
                setEditingId('');
                setTitle('');
                setBody('');
              }}
            >
              {tt("İptal")}
            </button>
          </Show>
          <button id="btn-save-note" class="btn-primary" onClick={() => void handleSubmit()}>
            {editingId() ? tt("💾 Güncelle") : tt("＋ Not Kaydet")}
          </button>
        </div>
      </div>

      {/* Etiket ve Arama Filtresi */}
      <div style={{ display: 'flex', gap: '4px', 'flex-wrap': 'wrap', 'align-items': 'center' }}>
        <For each={['TÜMÜ', 'Analiz', 'İşlem Planı', 'Bilanço', 'Risk', 'Günlük']}>
          {(t) => (
            <button
              class="chip-btn"
              classList={{ active: tagFilter() === t }}
              data-note-tag={t}
              onClick={() => setTagFilter(t)}
            >
              {t}
            </button>
          )}
        </For>
        <input
          id="inp-notes-search"
          class="script-inp-field"
          style={{ flex: '1', 'min-width': '90px' }}
          placeholder={tt("Notlarda ara…")}
          value={query()}
          onInput={(e) => setQuery(e.currentTarget.value)}
        />
      </div>

      {/* Kayıtlı Notlar Listesi */}
      <div id="notes-list" class="notes-list">
        <Show
          when={filteredNotes().length > 0}
          fallback={
            <div style={muted} id="notes-empty">
              {tt("Henüz kayıtlı not yok. Yukarıdan")}{' '}{ui.symbol}{' '}{tt("için analiz veya işlem günlüğü notu ekleyebilirsiniz.")}
            </div>
          }
        >
          <For each={filteredNotes()}>
            {(n) => (
              <div class="note-item-card" data-note-id={n.id}>
                <div class="note-item-head">
                  <button
                    class="note-sym-badge"
                    onClick={() => void switchSymbol(n.symbol, (n.timeframe || ui.interval) as typeof ui.interval)}
                  >
                    {n.symbol} {n.timeframe ? `· ${n.timeframe}` : ''}
                  </button>
                  <span
                    class="note-sentiment-badge"
                    style={{
                      color:
                        n.sentiment === 'bull'
                          ? 'var(--bull)'
                          : n.sentiment === 'bear'
                            ? 'var(--bear)'
                            : 'var(--text-secondary)',
                    }}
                  >
                    {n.sentiment === 'bull' ? tt("▲ Boğa") : n.sentiment === 'bear' ? tt("▼ Ayı") : tt("● Nötr")}
                  </span>
                  <Show when={n.tags}>
                    <span class="note-tag-pill">{n.tags}</span>
                  </Show>
                  <Show when={n.pinned}>
                    <span title={tt("Sabitlenmiş Not")}>📌</span>
                  </Show>
                  <span style={{ flex: '1' }} />
                  <button class="wl-saved-act" title={tt("Düzenle")} onClick={() => startEdit(n)}>
                    ✎
                  </button>
                  <button
                    class="wl-saved-act"
                    title={tt("Sil")}
                    data-del-note={n.id}
                    onClick={() => void deleteSymbolNote(n.id)}
                  >
                    ✕
                  </button>
                </div>
                <div class="note-item-title">{n.title}</div>
                <Show when={n.body}>
                  <div class="note-item-body">{n.body}</div>
                </Show>
                <div class="note-item-foot">
                  <span>
                    {n.snapshotPrice > 0 ? tfmt("Not Fiyatı: {0}", formatQuotePrice(n.snapshotPrice)) : ''}
                  </span>
                  <span>
                    {n.updatedAt > 0 ? new Date(n.updatedAt * 1000).toLocaleString(localeTag(), { dateStyle: 'short', timeStyle: 'short' }) : ''}
                  </span>
                </div>
              </div>
            )}
          </For>
        </Show>
      </div>
    </div>
  );
}

function AlertsPanel(): JSX.Element {
  const [seg, setSeg] = createSignal<'alerts' | 'log'>('alerts');
  const [onlySym, setOnlySym] = createSignal(false);
  const [menu, setMenu] = createSignal(false);
  const list = () => serverAlerts().filter((a) => !onlySym() || a.symbol === ui.symbol.toUpperCase());
  const delivText = (ok: boolean, ch: string, detail?: string) => `${ok ? '✓' : '✗'} ${ch}${detail ? ` (${detail})` : ''}`;
  return (
    <div id="drawer-panel-alerts" class="drawer-subpanel" style={{ display: 'flex', 'flex-direction': 'column', padding: '12px', 'overflow-y': 'auto' }}>
      <div class="seg-control">
        <button class="seg-btn" data-alert-seg="alerts" classList={{ active: seg() === 'alerts' }} onClick={() => setSeg('alerts')}>{tt("Alarmlar")}</button>
        <button class="seg-btn" data-alert-seg="log" classList={{ active: seg() === 'log' }} onClick={() => setSeg('log')}>{tt("Günlük")}</button>
      </div>
      <Show when={seg() === 'alerts'}>
        <div style={{ display: 'flex', 'align-items': 'center', gap: '6px', margin: '8px 0 10px', position: 'relative' }}>
          <label class="study-check" style={{ 'font-size': '11px' }}>
            <input id="chk-alerts-only-sym" type="checkbox" checked={onlySym()} onChange={(e) => setOnlySym(e.currentTarget.checked)} />
            <span>{tt("Yalnız")}{' '}{ui.symbol}</span>
          </label>
          <span style={{ flex: '1' }} />
          <button id="btn-alerts-more" class="btn-secondary" style={{ padding: '2px 8px' }} title={tt("Tümü…")} onClick={() => setMenu(!menu())}>⋯</button>
          <button id="btn-add-alert-drawer" class="btn-primary" onClick={() => openPriceAlert()}>{tt("+ Alarm")}</button>
          <Show when={menu()}>
            <div class="pane-menu" style={{ position: 'absolute', top: '100%', right: '0', 'z-index': '30', 'min-width': '200px' }}>
              {(
                [
                  ['stop_all', tt("Tümünü durdur")],
                  ['restart_all', tt("Tümünü yeniden başlat")],
                  ['delete_inactive', tt("Pasif alarmları sil")],
                  ['delete_all', tt("Tümünü sil")],
                ] as const
              ).map(([a, label]) => (
                <button class="pane-menu-item" data-bulk={a} onClick={() => { setMenu(false); void bulkAlerts(a); }}>{label}</button>
              ))}
            </div>
          </Show>
        </div>
        <Show when={alertsError()}>
          <div class="alert-note">{tt("Alarm motoruna ulaşılamadı:")}{' '}{alertsError()}</div>
        </Show>
        <div id="alerts-tree-list" class="alert-tree-list">
          <Show when={list().length > 0} fallback={<div style={muted}>{onlySym() ? tfmt("{0} için alarm yok.", ui.symbol) : tt("Alarm yok. Grafikte sağ tık → \"Alarm ekle\" veya ⏰.")}</div>}>
            <For each={list()}>
              {(a) => (
                <div class="alert-item" data-alert-id={a.id} classList={{ inactive: a.status !== 'active' }}>
                  <div class="alert-item-main" onDblClick={() => editAlert(a)}>
                    <div class="alert-item-title">
                      {a.name || describeAlert(a)}
                      <span class={`alert-status s-${a.status}`} title={a.statusMsg}>{STATUS_LABELS[a.status]}</span>
                    </div>
                    <div class="alert-item-desc" title={a.statusMsg || describeAlert(a)}>
                      {a.symbol} · {a.interval} · {a.name ? describeAlert(a) : triggerLabel(a.trigger)}
                      {a.fireCount ? ` · ${a.fireCount}×` : ''}
                    </div>
                    <Show when={a.status === 'error'}>
                      <div class="alert-item-desc" style={{ color: 'var(--bear)' }}>{a.statusMsg}</div>
                    </Show>
                  </div>
                  <div class="alert-item-acts">
                    <button title={tt("Düzenle")} data-alert-act="edit" onClick={() => editAlert(a)}>✎</button>
                    <Show when={a.status === 'active'} fallback={<button title={tt("Yeniden başlat")} data-alert-act="restart" onClick={() => void restartAlert(a.id)}>▶</button>}>
                      <button title={tt("Durdur")} data-alert-act="stop" onClick={() => void stopAlert(a.id)}>❚❚</button>
                    </Show>
                    <button title={tt("Klonla")} data-alert-act="clone" onClick={() => void cloneAlert(a.id)}>⧉</button>
                    <button title={tt("Sil")} data-del-alert={a.id} data-alert-act="delete" onClick={() => void deleteAlert(a.id)}>✕</button>
                  </div>
                </div>
              )}
            </For>
          </Show>
        </div>
      </Show>
      <Show when={seg() === 'log'}>
        <div style={{ display: 'flex', 'justify-content': 'flex-end', margin: '8px 0' }}>
          <button id="btn-alert-log-clear" class="btn-secondary" disabled={!alertLog().length} onClick={() => void clearLog()}>{tt("Günlüğü temizle")}</button>
        </div>
        <div id="alert-log-list">
          <Show when={alertLog().length} fallback={<div style={muted}>{tt("Henüz tetiklenen alarm yok.")}</div>}>
            <For each={alertLog()}>
              {(e) => (
                <div class="alert-log-item" data-log-id={e.id}>
                  <div class="alert-item-title">{e.name || e.symbol} <span class="alert-mini">{new Date(e.time).toLocaleString(localeTag())}</span></div>
                  <div class="alert-item-desc">{e.message}</div>
                  <div>
                    <For each={e.deliveries ?? []}>{(dv) => <span class={`alert-deliv ${dv.ok ? 'ok' : 'fail'}`}>{delivText(dv.ok, dv.channel, dv.detail)}</span>}</For>
                  </div>
                </div>
              )}
            </For>
          </Show>
        </div>
      </Show>
    </div>
  );
}

function DataWindowPanel(): JSX.Element {
  const row = (label: string, id: string, val: () => string) => (
    <div style={{ display: 'flex', 'justify-content': 'space-between' }}>
      <span>{label}</span>
      <strong id={id}>{val()}</strong>
    </div>
  );
  const h = hover;
  return (
    <div id="drawer-panel-datawindow" class="drawer-subpanel" style={{ display: 'flex', 'flex-direction': 'column', padding: '12px', 'overflow-y': 'auto' }}>
      <div style={{ 'font-weight': '700', color: '#fff', 'margin-bottom': '8px' }}>{tt("Veri Penceresi (İmleç Detayı)")}</div>
      <div id="data-window-content" style={{ 'font-family': 'var(--font-mono)', 'font-size': '11px', display: 'flex', 'flex-direction': 'column', gap: '6px' }}>
        <div style={{ background: 'var(--bg-elevated)', padding: '8px', 'border-radius': '4px', border: '1px solid var(--border-color)' }}>
          <div style={{ color: 'var(--text-secondary)', 'font-size': '10px' }}>{tt("SEÇİLİ BAR")}</div>
          {row(tt("Açılış:"), 'dw-o', () => (h() ? formatPrice(h()!.open) : '—'))}
          {row(tt("Yüksek:"), 'dw-h', () => (h() ? formatPrice(h()!.high) : '—'))}
          {row(tt("Düşük:"), 'dw-l', () => (h() ? formatPrice(h()!.low) : '—'))}
          {row(tt("Kapanış:"), 'dw-c', () => (h() ? formatPrice(h()!.close) : '—'))}
          {row(tt("Değişim:"), 'dw-chg', () => (h() ? formatSigned(h()!.changePct, 2, '%') : '—'))}
          {row(tt("Hacim:"), 'dw-v', () => (h() ? Math.round(h()!.volume).toLocaleString(localeTag()) : '—'))}
        </div>
      </div>
    </div>
  );
}

function HotlistsPanel(): JSX.Element {
  const lists = createMemo(() => hotlists(screenerRows()));
  const table = (rows: ReturnType<typeof hotlists>['gainers'], up: boolean) => (
    <table class="bt-table" style={{ 'margin-bottom': '10px' }}>
      <tbody>
        <For each={rows}>
          {(r) => (
            <tr data-scr-sym={r.symbol} style={{ cursor: 'pointer' }} onClick={() => void switchSymbol(r.symbol, ui.interval)}>
              <td><strong>{r.symbol}</strong></td>
              <td>{formatPrice(r.lastPrice)}</td>
              <td style={{ color: up ? 'var(--bull)' : 'var(--bear)', 'font-weight': '700' }}>{formatSigned(r.changePercent, 2, '%')}</td>
            </tr>
          )}
        </For>
      </tbody>
    </table>
  );
  return (
    <div id="drawer-panel-hotlists" class="drawer-subpanel" style={{ display: 'flex', 'flex-direction': 'column', padding: '12px', 'overflow-y': 'auto' }}>
      <div style={{ 'font-weight': '700', color: '#fff', 'margin-bottom': '8px' }}>{tt("Günün Enleri")}</div>
      <div id="hotlists-content">
        <Show when={screenerRows().length > 0} fallback={<div style={muted}>{tt("Yeterli gerçek veri yok.")}</div>}>
          <div style={{ 'font-size': '11px', 'font-weight': '700', color: 'var(--bull)', 'margin-bottom': '4px' }}>{tt("En Çok Yükselenler")}</div>
          {table(lists().gainers, true)}
          <div style={{ 'font-size': '11px', 'font-weight': '700', color: 'var(--bear)', 'margin-bottom': '4px' }}>{tt("En Çok Düşenler")}</div>
          {table(lists().losers, false)}
        </Show>
      </div>
    </div>
  );
}

function ObjectTreePanel(): JSX.Element {
  return (
    <div id="drawer-panel-objecttree" class="drawer-subpanel" style={{ display: 'flex', 'flex-direction': 'column', padding: '12px', 'overflow-y': 'auto' }}>
      <div style={{ display: 'flex', 'justify-content': 'space-between', 'align-items': 'center', 'margin-bottom': '10px' }}>
        <span style={{ 'font-weight': '700', color: '#fff' }}>{tt("Nesne Ağacı & Katmanlar")}</span>
        <button id="btn-clear-drawings-drawer" class="btn-secondary" style={{ padding: '2px 8px', 'font-size': '10px' }} onClick={clearDrawings}>{tt("Tümünü Sil")}</button>
      </div>
      <div id="obj-tree-list" class="obj-tree-list">
        <Show when={drawings().length > 0} fallback={<div style={muted}>{tt("Grafikte çizim nesnesi yok. Sol araç çubuğundan ekleyebilirsiniz.")}</div>}>
          <For each={drawings()}>
            {(d, i) => (
              <div
                class="obj-tree-item"
                data-obj-id={d.id}
                style={{ cursor: 'pointer', display: 'flex', 'justify-content': 'space-between', padding: '5px 8px', background: 'var(--bg-elevated)', 'border-radius': '4px', 'margin-bottom': '4px' }}
                onClick={() => d.points.length > 0 && rt.chart?.focusTime(d.points[0].time)}
              >
                <div style={{ display: 'flex', 'align-items': 'center', gap: '6px' }}>
                  <span style={{ display: 'inline-block', width: '8px', height: '8px', 'border-radius': '50%', background: d.color }} />
                  <span style={{ 'font-weight': '600' }}>{TOOL_NAME_TR[d.toolType] || d.toolType} #{i() + 1}</span>
                </div>
                <button
                  class="btn-secondary"
                  style={{ padding: '1px 6px', 'font-size': '10px' }}
                  data-del-obj={d.id}
                  onClick={(ev) => {
                    ev.stopPropagation();
                    removeDrawing(d.id);
                  }}
                >
                  🗑️
                </button>
              </div>
            )}
          </For>
        </Show>
      </div>
    </div>
  );
}

const SHORTCUTS: Array<[string, string]> = [
  [tt("Sembol Arama:"), '⌘K / Ctrl+K'],
  [tt("Cetvel / Ölçüm:"), tt("Shift + Tıkla")],
  [tt("Düzeni Kaydet:"), '⌘S / Ctrl+S'],
  [tt("Geri Al / Yinele:"), '⌘Z / ⌘⇧Z'],
  [tt("Seçili Çizimi Sil:"), 'Delete / Backspace'],
  [tt("Grafiği Sığdır:"), tt("Çift Tıkla Eksene")],
];

function HelpPanel(): JSX.Element {
  return (
    <div id="drawer-panel-help" class="drawer-subpanel" style={{ display: 'flex', 'flex-direction': 'column', padding: '12px', 'overflow-y': 'auto', gap: '8px' }}>
      <div style={{ display: 'flex', 'justify-content': 'space-between', 'align-items': 'center' }}>
        <span style={{ 'font-weight': '700', color: 'var(--text-strong)' }}>{t('shortcuts.title')}</span>
        <button id="btn-open-all-shortcuts" class="btn-primary" style={{ padding: '3px 9px', 'font-size': '11px' }} onClick={() => setUi('modal', 'shortcuts')}>
          {lang() === 'en' ? 'All (~80) ?' : 'Tümü (~80) ?'}
        </button>
      </div>
      <div style={{ display: 'flex', 'flex-direction': 'column', gap: '6px', 'font-size': '11px', color: 'var(--text-primary)' }}>
        <For each={SHORTCUTS}>
          {([k, v]) => (
            <div style={{ display: 'flex', 'justify-content': 'space-between', 'border-bottom': '1px solid var(--border-color)', 'padding-bottom': '4px' }}>
              <span>{k}</span>
              <strong style={{ color: 'var(--accent)' }}>{v}</strong>
            </div>
          )}
        </For>
      </div>
    </div>
  );
}

function Placeholder(props: { id: string; title: string; note: string }): JSX.Element {
  return (
    <div id={`drawer-panel-${props.id}`} class="drawer-subpanel" style={{ display: 'flex', 'flex-direction': 'column', padding: '12px', 'overflow-y': 'auto' }}>
      <div style={{ 'font-weight': '700', color: '#fff', 'margin-bottom': '8px' }}>{props.title}</div>
      <div style={{ color: 'var(--text-secondary)', 'font-size': '11.5px', 'line-height': '1.5' }}>{props.note}</div>
    </div>
  );
}

export function Drawer(): JSX.Element {
  const tab = () => ui.drawerTab;
  const drawerTitle = () => {
    const cur = tab();
    if (!cur) return t('drawer.details');
    return lang() === 'en' ? t(`drawer.${cur}`) : TITLES[cur];
  };
  return (
    <aside id="titan-drawer" class="titan-drawer">
      <div class="drawer-header">
        <span id="lbl-drawer-title">{drawerTitle()}</span>
        <button id="btn-close-drawer" class="icon-btn" title={t('close')} onClick={closeDrawer}>
          <Icon svg={ICONS.close} />
        </button>
      </div>
      <div class="drawer-content">
        <Show when={tab() === 'watchlist'}><WatchlistPanel /></Show>
        <Show when={tab() === 'alerts'}><AlertsPanel /></Show>
        <Show when={tab() === 'news'}><Placeholder id="news" title={tt("Piyasa Haberleri & Gündem")} note={tt("Haber akışı henüz bağlı değil.")} /></Show>
        <Show when={tab() === 'datawindow'}><DataWindowPanel /></Show>
        <Show when={tab() === 'hotlists'}><HotlistsPanel /></Show>
        <Show when={tab() === 'calendar'}>
          <div id="drawer-panel-calendar" class="drawer-subpanel" style={{ display: 'flex', 'flex-direction': 'column', height: '100%' }}>
            <CalendarView compact />
          </div>
        </Show>
        <Show when={tab() === 'notes' || tab() === 'ideas' || tab() === 'chats'}><NotesPanel /></Show>
        <Show when={tab() === 'notifications'}><Placeholder id="notifications" title={tt("Bildirim Merkezi")} note={tt("Tetiklenen alarmlar anlık bildirim olarak görünür.")} /></Show>
        <Show when={tab() === 'orderpanel'}><OrderTicket /></Show>
        <Show when={tab() === 'objecttree'}><ObjectTreePanel /></Show>
        <Show when={tab() === 'help'}><HelpPanel /></Show>
      </div>
    </aside>
  );
}
