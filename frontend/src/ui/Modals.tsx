import { For, Show, createEffect, createMemo, createSignal, on, onCleanup, onMount, type JSX } from 'solid-js';
import { fetchSymbols } from '../api/client';
import { openPriceAlert } from '../state/alertStore';
import { formatSigned, marketLabel } from '../state/format';
import { lang, t, toggleLang, tt } from '../state/i18n';
import { searchQuickItems, type QuickItemKind, type QuickSearchItem } from '../state/quickSearch';
import { rt } from '../state/runtime';
import { copyChartLink, copySnapshotImage, downloadSnapshot } from '../state/snapshot';
import { addStudy, applyStudyTemplate, deleteStudyTemplate, saveStudyTemplate, studies, studyTemplates } from '../state/studies';
import {
  addComparisonSymbol,
  applyTemplate,
  clearComparisons,
  comparisons,
  openDrawerTab,
  redoAction,
  removeComparisonSymbol,
  setChartStyle,
  setComparisonItemScale,
  setTool,
  setUi,
  setWorkbenchTab,
  setZoomMode,
  switchColorTheme,
  switchSymbol,
  symbols,
  toggleAllDrawingsLocked,
  toggleComparisonVisible,
  toggleInvertScale,
  toggleReplay,
  toggleScale,
  toggleScaleLock,
  toggleSimpleMode,
  ui,
  undoAction,
  favorites,
  toggleFav,
} from '../state/store';
import {
  PRESET_EXPRESSIONS,
  isSymbolExpression,
  parseSymbolExpr,
  symbolAvatarSpec,
} from '../state/symbolExpr';
import { TEMPLATES } from '../state/templates';
import { toggleTheme } from '../state/theme';
import { isFavorite } from '../state/favorites';
import { filterWatchlistSymbols, type MarketFilter } from '../state/watchlist';
import type { CompareScale } from '../chart/panes';
import type { SymbolQuoteSummary } from '../types/market';
import { APP_NAME, LANG_NAME } from '../script/brand';
import { ICONS } from '../styles/icons';
import { AlertDialog, AlertPopups } from './AlertDialog';
import { Icon } from './Icon';
import { FxModal, StudyMenu, StudySettingsDialog } from './Indicators';
import { LayoutsModal } from './LayoutMenus';
import { Modal } from './Modal';
import { SettingsModal, setSettingsTab, settingsTab } from './SettingsModal';
import { GoToDateModal, MobileMoreSheet, QuickIntervalPopup, ShortcutsModal } from './ShellModals';
import { ServerModal } from './ServerModal';
import { CommandModal } from './Terminal';

export { settingsTab, setSettingsTab };

const close = () => setUi('modal', null);

function TemplatesModal(): JSX.Element {
  const [tplName, setTplName] = createSignal('');
  const en = () => lang() === 'en';
  return (
    <Modal id="modal-templates" title={t('top.templates')} width="460px">
      <div class="tv-modal-body" style={{ padding: '16px', display: 'flex', 'flex-direction': 'column', gap: '10px' }}>
        <For each={TEMPLATES}>
          {(tp) => (
            <div
              class="template-item"
              data-template={tp.key}
              style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-color)', 'border-radius': '6px', padding: '12px', cursor: 'pointer' }}
              onClick={() => {
                applyTemplate(tp.key);
                close();
              }}
            >
              <div style={{ 'font-weight': '700', color: tp.color, 'margin-bottom': '2px' }}>{tp.title}</div>
              <div style={{ 'font-size': '11px', color: 'var(--text-secondary)' }}>{tp.desc}</div>
            </div>
          )}
        </For>
        <div class="fx-list-caption">
          {en() ? `SAVED INDICATOR TEMPLATES (${studies.list.length} active)` : `KAYITLI GÖSTERGE ŞABLONLARIM (${studies.list.length} gösterge grafikte)`}
        </div>
        <div style={{ display: 'flex', gap: '6px' }}>
          <input
            id="inp-study-template-name"
            class="script-select"
            style={{ flex: '1' }}
            placeholder={en() ? 'Template name' : 'Şablon adı'}
            value={tplName()}
            onInput={(e) => setTplName(e.currentTarget.value)}
            onKeyDown={(e) => e.stopPropagation()}
          />
          <button
            id="btn-save-study-template"
            class="btn-primary"
            disabled={!tplName().trim() || studies.list.length === 0}
            onClick={() => {
              if (saveStudyTemplate(tplName())) setTplName('');
            }}
          >
            {en() ? 'Save' : 'Kaydet'}
          </button>
        </div>
        <For each={studyTemplates()}>
          {(tp) => (
            <div class="template-item study-template-item" data-study-template={tp.name}>
              <button class="pane-menu-item" style={{ flex: '1' }} onClick={() => { applyStudyTemplate(tp.name); close(); }}>
                📐 {tp.name} <span class="term-hint">({tp.studies.length} {en() ? 'indicators' : 'gösterge'})</span>
              </button>
              <button class="ind-action-btn" title={en() ? 'Delete' : 'Sil'} data-del-study-template={tp.name} onClick={() => deleteStudyTemplate(tp.name)}>✕</button>
            </div>
          )}
        </For>
      </div>
    </Modal>
  );
}

function AboutModal(): JSX.Element {
  const en = () => lang() === 'en';
  return (
    <Modal id="modal-about" title={APP_NAME} width="440px">
      <div class="tv-modal-body" style={{ padding: '16px', 'font-size': '12.5px', 'line-height': '1.6' }}>
        <div class="about-hero">
          <span class="about-logo" innerHTML={ICONS.titanLogo} />
          <div>
            <div class="about-title">{APP_NAME}</div>
            <div class="about-sub">{en() ? `Local-first charting & ${LANG_NAME} terminal` : `Yerel öncelikli grafik ve ${LANG_NAME} terminali`}</div>
          </div>
        </div>
        {en()
          ? `Offline-First SQLite WAL cache engine, ${LANG_NAME} runtime, Crypto + BIST (15m delayed) + US market data.`
          : `Offline-First SQLite WAL önbellek motoru, ${LANG_NAME} motoru ve editörü, Kripto + BIST (15 dk gecikmeli) + ABD verisi.`}
        <div class="about-attr">
          {en() ? 'Chart engine: ' : 'Grafik motoru: '}Lightweight Charts™ © TradingView, Inc. — Apache-2.0.{' '}
          <a href="https://www.tradingview.com/" target="_blank" rel="noreferrer">tradingview.com</a>
        </div>
      </div>
    </Modal>
  );
}

type SearchFilterTab = MarketFilter | 'INDEX' | 'EXPR' | 'QUICK';

const QUICK_KIND_LABELS: Record<QuickItemKind, { tr: string; en: string }> = {
  action: { tr: tt("İŞLEVLER VE KOMUTLAR"), en: 'FUNCTIONS & COMMANDS' },
  drawing: { tr: tt("ÇİZİM ARAÇLARI"), en: 'DRAWING TOOLS' },
  indicator: { tr: tt("GÖSTERGELER"), en: 'INDICATORS' },
  style: { tr: tt("GRAFİK TİPLERİ"), en: 'CHART TYPES' },
  setting: { tr: 'AYARLAR', en: 'SETTINGS' },
  theme: { tr: 'RENK TEMALARI', en: 'COLOR THEMES' },
};

function executeQuickItem(item: QuickSearchItem): void {
  const p = item.payload;
  close();
  switch (p.type) {
    case 'tool':
      setTool(p.tool);
      return;
    case 'indicator':
      addStudy({ builtinId: p.builtinId });
      return;
    case 'style':
      setChartStyle(p.mode);
      return;
    case 'setting':
      setSettingsTab(p.tab);
      setUi('modal', 'settings');
      return;
    case 'theme':
      switchColorTheme(p.themeId);
      return;
    case 'action':
      switch (p.actionId) {
        case 'goto': setUi('modal', 'goto'); break;
        case 'shortcuts': setUi('modal', 'shortcuts'); break;
        case 'alert': openPriceAlert(); break;
        case 'replay': toggleReplay(); break;
        case 'compare': setUi('modal', 'compare'); break;
        case 'snap_dl': downloadSnapshot(); break;
        case 'snap_copy': void copySnapshotImage(); break;
        case 'snap_link': void copyChartLink(); break;
        case 'reset_view': rt.chart?.fitContent(); break;
        case 'scale_log': toggleScale('log'); break;
        case 'scale_pct': toggleScale('percent'); break;
        case 'scale_idx': toggleScale('indexed'); break;
        case 'scale_invert': toggleInvertScale(); break;
        case 'scale_lock': toggleScaleLock(); break;
        case 'undo': undoAction(); break;
        case 'redo': redoAction(); break;
        case 'toggle_theme': toggleTheme(); break;
        case 'toggle_lang': toggleLang(); break;
        case 'fullscreen':
          if (!document.fullscreenElement) void document.documentElement.requestFullscreen?.();
          else void document.exitFullscreen?.();
          break;
        case 'zoom_in': setZoomMode(true); break;
        case 'zoom_out': rt.chart?.zoomBy(0.67); break;
        case 'lock_drawings': toggleAllDrawingsLocked(); break;
        case 'hide_drawings': setUi('hideDrawings', !ui.hideDrawings); break;
        case 'wb_script': setWorkbenchTab('script'); break;
        case 'wb_screener': setWorkbenchTab('screener'); break;
        case 'wb_paper': setWorkbenchTab('paper'); break;
        case 'order_ticket': openDrawerTab('orderpanel'); break;
        case 'layouts': setUi('modal', 'layouts'); break;
        case 'templates': setUi('modal', 'templates'); break;
        case 'simple': toggleSimpleMode(); break;
      }
  }
}

/**
 * Ölçülü Sembol Arama (`840×680px`, `58px` satır, `28px` filtre hapları)
 * + Birleşik ⌘K Hızlı Arama (Semboller + Çizim Araçları + Göstergeler + İşlevler + Ayarlar + Temalar).
 */
function SymbolSearchModal(): JSX.Element {
  let input!: HTMLInputElement;
  const en = () => lang() === 'en';
  const [query, setQuery] = createSignal(ui.searchInitialQuery || '');
  const [filter, setFilter] = createSignal<SearchFilterTab>(ui.searchMode === 'quick' ? 'QUICK' : 'ALL');
  const [remote, setRemote] = createSignal<SymbolQuoteSummary[] | null>(null);
  const [sel, setSel] = createSignal(0);

  onMount(() => {
    input?.focus();
    if (ui.searchInitialQuery) {
      input?.setSelectionRange(ui.searchInitialQuery.length, ui.searchInitialQuery.length);
      setUi('searchInitialQuery', '');
    }
  });

  let timer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(timer));
  createEffect(
    on([query, filter], ([q, f]) => {
      clearTimeout(timer);
      setSel(0);
      if (!q.trim() || f === 'EXPR' || f === 'QUICK' || isSymbolExpression(q)) {
        setRemote(null);
        return;
      }
      const mktFilter: MarketFilter = f === 'INDEX' ? 'ALL' : f;
      timer = setTimeout(() => {
        fetchSymbols(mktFilter, q).then(setRemote).catch(() => setRemote(null));
      }, 200);
    })
  );

  const parsedExpr = createMemo(() => {
    const q = query().trim();
    if (!q) return null;
    try {
      const p = parseSymbolExpr(q);
      return p.isComplex ? p : null;
    } catch {
      return null;
    }
  });

  const list = createMemo(() => {
    const f = filter();
    if (f === 'EXPR') return [];
    const mktFilter: MarketFilter = f === 'INDEX' || f === 'QUICK' ? 'ALL' : f;
    const base = remote() ?? filterWatchlistSymbols(symbols(), mktFilter, query());
    if (f === 'INDEX') {
      return base.filter((x) => x.symbol === 'XU100.IS' || x.symbol === 'SPY' || x.symbol === 'QQQ' || x.symbol === 'DX-Y.NYB');
    }
    return f === 'QUICK' ? (query().trim() ? base.slice(0, 6) : []) : base;
  });

  const quickItems = createMemo(() => {
    const f = filter();
    const q = query().trim();
    if (f === 'QUICK') return searchQuickItems(q, 'all', 36);
    if (f === 'ALL' && q.length >= 2) return searchQuickItems(q, 'all', 6);
    return [];
  });

  const groupedQuick = createMemo(() => {
    const items = quickItems();
    const order: QuickItemKind[] = ['action', 'drawing', 'indicator', 'style', 'setting', 'theme'];
    return order
      .map((kind) => ({ kind, items: items.filter((i) => i.kind === kind) }))
      .filter((g) => g.items.length > 0);
  });

  const pick = (sym: string) => {
    const s = sym.trim().toUpperCase();
    if (!s) return;
    close();
    void switchSymbol(s, ui.interval);
  };

  const insertOperator = (op: string) => {
    const cur = query().trim();
    const base = cur || ui.symbol;
    const next = op === '(' && !cur ? '(' : `${base}${op}`;
    setQuery(next);
    input.focus();
  };

  const onKey = (e: KeyboardEvent) => {
    const f = filter();
    const qList = quickItems();
    const sList = list();
    const total = f === 'QUICK' ? sList.length + qList.length : sList.length;
    if (e.key === 'ArrowDown' && total) {
      e.preventDefault();
      setSel((sel() + 1) % total);
    } else if (e.key === 'ArrowUp' && total) {
      e.preventDefault();
      setSel((sel() - 1 + total) % total);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (parsedExpr()) {
        pick(query());
      } else if (f === 'QUICK') {
        if (sel() < sList.length) pick(sList[sel()].symbol);
        else if (qList[sel() - sList.length]) executeQuickItem(qList[sel() - sList.length]);
        else if (qList[0]) executeQuickItem(qList[0]);
      } else if (sList.length && sel() < sList.length) {
        pick(sList[sel()].symbol);
      } else if (qList.length > 0 && sList.length === 0) {
        executeQuickItem(qList[0]);
      } else {
        pick(query());
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  };

  const FILTERS = createMemo<Array<[SearchFilterTab, string]>>(() => [
    ['ALL', en() ? 'All' : 'Tümü'],
    ['QUICK', en() ? '⌘K Quick Search' : '⌘K Hızlı Ara'],
    ['BIST', 'BIST'],
    ['CRYPTO', en() ? 'Crypto' : 'Kripto'],
    ['US', en() ? 'US Stocks' : 'ABD'],
    ['FOREX', en() ? 'Gold / FX' : 'Altın / FX'],
    ['INDEX', en() ? 'Indices / ETF' : 'Endeks / ETF'],
    ['EXPR', en() ? 'ƒ Expression' : 'ƒ İfade (Oran/Sepet)'],
  ]);

  return (
    <div id="titan-symbol-search-modal" class="tv-modal-backdrop" onClick={(e) => e.target === e.currentTarget && close()}>
      <div
        class="tv-modal tv-modal-search"
        classList={{ 'is-quick-mode': filter() === 'QUICK' }}
        style={{
          width: filter() === 'QUICK' ? '620px' : '840px',
          'max-width': '94vw',
          'max-height': '680px',
          display: 'flex',
          'flex-direction': 'column',
          'align-self': 'flex-start',
          'margin-top': '72px',
        }}
      >
        <div class="tv-modal-header" style={{ 'border-bottom': 'none', padding: '16px 20px 6px' }}>
          <div style={{ display: 'flex', 'align-items': 'center', gap: '8px', width: '100%' }}>
            <span class="search-ico"><Icon svg={ICONS.search} /></span>
            <input
              id="modal-symbol-search-input"
              class="wl-search-input"
              type="text"
              ref={input}
              placeholder={
                filter() === 'QUICK'
                  ? t('qsearch.placeholder')
                  : en()
                  ? 'Search symbol or expression (e.g. THYAO.IS, BTCUSDT/ETHUSDT)...'
                  : 'Sembol veya İfade Ara (örn: THYAO.IS, BTCUSDT/ETHUSDT, THYAO.IS*USDTRY)...'
              }
              style={{ flex: '1', height: '40px', 'font-size': '15px' }}
              value={query()}
              onInput={(e) => setQuery(e.currentTarget.value)}
              onKeyDown={onKey}
            />
            <Show when={filter() !== 'QUICK'}>
              <div class="expr-op-group" id="symbol-expr-operators">
                {['/', '*', '-', '+', '(', ')'].map((op) => (
                  <button
                    type="button"
                    class="expr-op-btn"
                    data-expr-op={op}
                    title={en() ? `Insert '${op}' operator` : `İfadeye '${op}' operatörü ekle`}
                    onClick={() => insertOperator(op)}
                  >
                    {op}
                  </button>
                ))}
              </div>
            </Show>
            <button id="modal-symbol-search-close" class="btn-secondary" style={{ padding: '4px 10px' }} onClick={close}>✕</button>
          </div>
        </div>
        <div class="search-pills" style={{ display: 'flex', gap: '6px', padding: '4px 20px 10px', 'border-bottom': '1px solid var(--border-color)', 'flex-wrap': 'wrap' }}>
          <For each={FILTERS()}>
            {([m, label]) => (
              <button class="chip-btn search-pill-btn" classList={{ active: filter() === m }} data-modal-filter={m} onClick={() => setFilter(m)}>
                {label}
              </button>
            )}
          </For>
        </div>

        <Show when={parsedExpr()}>
          {(pe) => (
            <div id="symbol-expr-preview" class="expr-preview-card">
              <div>
                <div style={{ display: 'flex', 'align-items': 'center', gap: '8px', 'margin-bottom': '3px' }}>
                  <span class="sym-avatar" style={{ background: '#1E3A8A', color: '#93C5FD' }}>ƒx</span>
                  <b style={{ color: 'var(--text-strong)', 'font-size': '14px', 'font-family': 'var(--font-mono)' }}>{pe().raw}</b>
                  <span class="exchange-badge">{pe().kindLabel}</span>
                </div>
                <div class="term-hint">
                  {en() ? 'Legs: ' : 'Bacaklar: '}<b>{pe().symbols.join(' · ')}</b> ({en() ? 'Canonical' : 'Kanonik'}: <code>{pe().canonical}</code>)
                </div>
              </div>
              <button id="btn-open-symbol-expr" class="btn-primary" onClick={() => pick(pe().raw)}>
                {en() ? 'Open Synthetic Expression ↵' : 'Sentetik İfadeyi Aç ↵'}
              </button>
            </div>
          )}
        </Show>

        <div id="modal-symbol-search-results" style={{ flex: '1', 'overflow-y': 'auto', padding: '6px 0' }}>
          {/* Hazır sentetik ifadeler */}
          <Show when={filter() === 'EXPR' || (filter() !== 'QUICK' && !list().length && !query().trim())}>
            <div style={{ padding: '8px 20px' }}>
              <div class="fx-list-caption" style={{ 'margin-bottom': '6px' }}>
                {en() ? 'PRESET SYNTHETIC EXPRESSIONS (RATIO / FX / SPREAD / BASKET)' : 'HAZIR SENTETİK SEMBOL İFADELERİ (ORAN / KUR / SPREAD / AĞIRLIKLI SEPET)'}
              </div>
              <For each={PRESET_EXPRESSIONS}>
                {(p) => (
                  <div
                    class="modal-sym-row"
                    data-preset-expr={p.expr}
                    style={{ display: 'flex', 'align-items': 'center', 'justify-content': 'space-between', padding: '8px 12px', cursor: 'pointer', 'border-radius': '6px' }}
                    onClick={() => pick(p.expr)}
                  >
                    <div style={{ display: 'flex', 'align-items': 'center', gap: '10px' }}>
                      <span class="sym-avatar" style={{ background: '#581C87', color: '#D8B4FE' }}>ƒx</span>
                      <div>
                        <div style={{ 'font-weight': '700', color: 'var(--accent)', 'font-family': 'var(--font-mono)', 'font-size': '13.5px' }}>{p.expr}</div>
                        <div style={{ 'font-size': '11.5px', color: 'var(--text-secondary)' }}>{p.title}</div>
                      </div>
                    </div>
                    <span class="exchange-badge">{tt(p.kind)}</span>
                  </div>
                )}
              </For>
            </div>
          </Show>

          {/* Sembol sonuçları */}
          <Show when={list().length > 0}>
            <Show when={filter() === 'QUICK'}>
              <div class="quick-cat-head">{en() ? 'SYMBOLS' : 'SEMBOLLER'}</div>
            </Show>
            <For each={list()}>
              {(item, i) => {
                const av = symbolAvatarSpec(item.symbol, item.market, item.exchange);
                return (
                  <div
                    class="modal-sym-row tv-sym-row"
                    classList={{ selected: i() === sel() }}
                    data-modal-sym={item.symbol}
                    style={{
                      background: i() === sel() ? 'var(--bg-hover)' : 'transparent',
                    }}
                    onClick={() => pick(item.symbol)}
                    onMouseEnter={() => setSel(i())}
                  >
                    <div style={{ display: 'flex', 'align-items': 'center', gap: '10px' }}>
                      <span class="sym-avatar" style={{ background: av.bg, color: av.fg }}>{av.initials}</span>
                      <div>
                        <div style={{ display: 'flex', 'align-items': 'center', gap: '6px' }}>
                          <span style={{ 'font-weight': '700', color: 'var(--text-strong)', 'font-family': 'var(--font-sans)', 'font-size': '13.5px' }}>{item.symbol}</span>
                          <span class="sym-type-tag">{tt(av.assetType)}</span>
                        </div>
                        <div style={{ 'font-size': '11.5px', color: 'var(--text-secondary)' }}>{tt(item.displayName)}</div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', 'align-items': 'center', gap: '12px' }}>
                      <button
                        type="button"
                        class="sym-fav-btn"
                        classList={{ on: isFavorite(favorites(), item.symbol) }}
                        data-search-fav={item.symbol}
                        title={isFavorite(favorites(), item.symbol) ? tt('Favorilerden çıkar') : tt('Favorilere ekle')}
                        aria-pressed={isFavorite(favorites(), item.symbol)}
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleFav({ symbol: item.symbol, displayName: item.displayName, market: item.market });
                        }}
                      >
                        {isFavorite(favorites(), item.symbol) ? '★' : '☆'}
                      </button>
                      <div style={{ 'text-align': 'right', 'font-family': 'var(--font-mono)', 'font-size': '12px' }}>
                        <div style={{ 'font-weight': '600', color: 'var(--text-strong)' }}>{item.lastPrice == null ? '—' : `${item.lastPrice.toFixed(2)} ${item.currency}`}</div>
                        <div style={{ 'font-size': '11px', 'font-weight': '700', color: item.changePercent == null ? 'var(--text-secondary)' : item.changePercent >= 0 ? 'var(--bull)' : 'var(--bear)' }}>
                          {item.changePercent == null ? '—' : formatSigned(item.changePercent, 2, '%')}
                        </div>
                      </div>
                      <div style={{ display: 'flex', 'flex-direction': 'column', 'align-items': 'flex-end', gap: '2px', 'min-width': '72px' }}>
                        <span class="exchange-badge">{av.exchange}</span>
                        <span class={`market-pill market-${item.market}`} style={{ 'font-size': '9.5px', padding: '1px 5px' }}>
                          {marketLabel(item.market)} · {item.delayMinutes > 0 ? `${item.delayMinutes}${en() ? 'M' : 'DK'}` : en() ? 'LIVE' : 'CANLI'}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              }}
            </For>
          </Show>

          {/* ⌘K Hızlı Arama: Göstergeler, Çizim Araçları, Grafik Tipleri, Ayarlar, Temalar, Komutlar */}
          <Show when={groupedQuick().length > 0}>
            <div id="quick-search-results">
              <For each={groupedQuick()}>
                {(grp) => (
                  <div class="quick-cat-group" data-quick-cat={grp.kind}>
                    <div class="quick-cat-head">{en() ? QUICK_KIND_LABELS[grp.kind].en : QUICK_KIND_LABELS[grp.kind].tr}</div>
                    <For each={grp.items}>
                      {(qi) => (
                        <button
                          type="button"
                          class="quick-item-row"
                          data-quick-id={qi.id}
                          onClick={() => executeQuickItem(qi)}
                        >
                          <div class="quick-item-main">
                            <span class="quick-item-title">{en() ? qi.titleEn : qi.titleTr}</span>
                            <Show when={qi.subtitleTr}>
                              <span class="quick-item-sub">{en() ? qi.subtitleEn : qi.subtitleTr}</span>
                            </Show>
                          </div>
                          <Show when={qi.shortcut}>
                            <kbd class="kbd-cap">{qi.shortcut}</kbd>
                          </Show>
                        </button>
                      )}
                    </For>
                  </div>
                )}
              </For>
            </div>
          </Show>

          {/* Sonuç yok → doğrudan açma düğmesi */}
          <Show when={filter() !== 'EXPR' && filter() !== 'QUICK' && list().length === 0 && groupedQuick().length === 0}>
            <div style={{ padding: '24px 16px', 'text-align': 'center' }}>
              <div style={{ 'font-size': '13px', 'font-weight': '600', color: 'var(--text-strong)', 'margin-bottom': '4px' }}>
                {query().trim()
                  ? en() ? `"${query().trim().toUpperCase()}" not in catalog` : `"${query().trim().toUpperCase()}" katalogda bulunamadı`
                  : en() ? 'No symbols found' : 'Sembol bulunamadı'}
              </div>
              <Show when={query().trim()}>
                <button id="btn-modal-custom-go" class="btn-primary" style={{ 'margin-top': '8px' }} onClick={() => pick(query())}>
                  {en()
                    ? `Open "${query().trim().toUpperCase()}" directly on chart ↵`
                    : `"${query().trim().toUpperCase()}" Sembolünü / İfadesini Doğrudan Grafikte Aç ↵`}
                </button>
              </Show>
            </div>
          </Show>
        </div>

        <div style={{ padding: '8px 20px', 'border-top': '1px solid var(--border-color)', display: 'flex', 'justify-content': 'space-between', 'font-size': '11px', color: 'var(--text-secondary)' }}>
          <span>{en() ? '↑↓ navigate · Enter open · ⌘K search tools/indicators/settings' : '↑↓ ile gezin · Enter ile aç · ⌘K araç/gösterge/ayar ara'}</span>
          <span style={{ 'font-family': 'var(--font-mono)' }}>BTCUSDT/ETHUSDT · THYAO.IS*USDTRY</span>
        </div>
      </div>
    </div>
  );
}

const COMPARE_BENCHMARKS: Array<{ symbol: string; title: string; market: string }> = [
  { symbol: 'XU100.IS', title: 'BIST 100 Endeksi', market: 'BIST' },
  { symbol: 'BTCUSDT', title: 'Bitcoin / Tether US', market: 'CRYPTO' },
  { symbol: 'ETHUSDT', title: 'Ethereum / Tether US', market: 'CRYPTO' },
  { symbol: 'USDTRY=X', title: tt("ABD Doları / Türk Lirası"), market: 'FOREX' },
  { symbol: 'GC=F', title: tt("Ons Altın (XAU/USD)"), market: 'FOREX' },
  { symbol: 'SPY', title: 'S&P 500 ETF (SPY)', market: 'US' },
  { symbol: 'QQQ', title: 'Nasdaq 100 ETF (QQQ)', market: 'US' },
  { symbol: 'THYAO.IS', title: tt("Türk Hava Yolları A.O."), market: 'BIST' },
  { symbol: 'GARAN.IS', title: 'Garanti BBVA', market: 'BIST' },
  { symbol: 'NVDA', title: 'NVIDIA Corporation', market: 'US' },
];

function CompareModal(): JSX.Element {
  let input!: HTMLInputElement;
  const en = () => lang() === 'en';
  const [query, setQuery] = createSignal('');
  const [scaleMode, setScaleMode] = createSignal<CompareScale>('same');
  const [filter, setFilter] = createSignal<MarketFilter>('ALL');

  onMount(() => input?.focus());

  const results = createMemo(() => {
    const q = query().trim();
    const pool = filterWatchlistSymbols(symbols(), filter(), q);
    return pool.filter((x) => x.symbol.toUpperCase() !== ui.symbol.toUpperCase()).slice(0, 20);
  });

  const isAdded = (sym: string) => comparisons().some((x) => x.symbol.toUpperCase() === sym.toUpperCase());

  const toggleItem = (sym: string) => {
    if (isAdded(sym)) removeComparisonSymbol(sym);
    else void addComparisonSymbol(sym, scaleMode());
  };

  return (
    <Modal id="modal-compare" title={en() ? 'Compare or Add Symbol' : 'Karşılaştır veya Sembol Ekle'} width="640px">
      <div class="tv-modal-body" style={{ padding: '14px 18px', display: 'flex', 'flex-direction': 'column', gap: '12px', 'max-height': '560px' }}>
        <div style={{ display: 'flex', gap: '8px', 'align-items': 'center' }}>
          <input
            id="compare-search-input"
            ref={input}
            class="wl-search-input"
            style={{ flex: '1', height: '36px' }}
            placeholder={en() ? 'Type symbol or expression (e.g. XU100.IS, ETHUSDT, SPY)...' : 'Karşılaştırılacak sembol veya ifade yazın (örn: XU100.IS, ETHUSDT, SPY)...'}
            value={query()}
            onInput={(e) => setQuery(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && query().trim()) {
                e.preventDefault();
                void addComparisonSymbol(query().trim(), scaleMode());
                setQuery('');
              }
            }}
          />
          <Show when={query().trim()}>
            <button
              id="btn-compare-add-custom"
              class="btn-primary"
              onClick={() => {
                void addComparisonSymbol(query().trim(), scaleMode());
                setQuery('');
              }}
            >
              + {t('top.add')}
            </button>
          </Show>
        </div>

        <div style={{ display: 'flex', 'align-items': 'center', gap: '6px', 'flex-wrap': 'wrap' }}>
          <span class="term-hint">{en() ? 'Scale Mode:' : 'Ölçek Modu:'}</span>
          {(
            [
              ['same', en() ? 'Same % Scale' : 'Aynı % Ölçeği'],
              ['left', en() ? 'New Price Scale (Left)' : 'Yeni Fiyat Ölçeği (Sol)'],
              ['own', en() ? 'New Scale (No Axis)' : 'Yeni Ölçek (Eksensiz)'],
            ] as const
          ).map(([mode, label]) => (
            <button
              class="chip-btn"
              classList={{ active: scaleMode() === mode }}
              data-cmp-scale={mode}
              onClick={() => setScaleMode(mode)}
            >
              {label}
            </button>
          ))}
        </div>

        <Show when={comparisons().length > 0}>
          <div id="compare-active-list" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-color)', 'border-radius': '6px', padding: '8px 12px' }}>
            <div style={{ display: 'flex', 'justify-content': 'space-between', 'align-items': 'center', 'margin-bottom': '6px' }}>
              <span class="fx-list-caption" style={{ margin: '0' }}>
                {en() ? `ACTIVE COMPARISONS (${comparisons().length})` : `AKTİF KARŞILAŞTIRMA SERİLERİ (${comparisons().length})`}
              </span>
              <button id="btn-compare-clear-all" class="chip-btn" onClick={clearComparisons}>
                {en() ? 'Clear All' : 'Tümünü Kaldır'}
              </button>
            </div>
            <For each={comparisons()}>
              {(c) => (
                <div class="cmp-active-row" data-cmp-active={c.symbol} style={{ display: 'flex', 'align-items': 'center', gap: '8px', padding: '4px 0' }}>
                  <span style={{ width: '10px', height: '10px', 'border-radius': '50%', background: c.color, display: 'inline-block' }} />
                  <b style={{ color: 'var(--text-strong)', 'min-width': '90px' }}>{c.symbol}</b>
                  <span class="term-hint" style={{ 'font-family': 'var(--font-mono)' }}>
                    {c.changePct != null ? formatSigned(c.changePct, 2, '%') : ''}
                  </span>
                  <select
                    class="script-select"
                    style={{ 'margin-left': 'auto', 'font-size': '11px', padding: '2px 6px' }}
                    data-cmp-item-scale={c.symbol}
                    value={c.scaleMode}
                    onChange={(e) => setComparisonItemScale(c.symbol, e.currentTarget.value as CompareScale)}
                  >
                    <option value="same">{en() ? 'Same % Scale' : 'Aynı % Ölçeği'}</option>
                    <option value="left">{en() ? 'Left Scale' : 'Sol Ölçek'}</option>
                    <option value="own">{en() ? 'Own Scale' : 'Kendi Ölçeği'}</option>
                  </select>
                  <button
                    class="ind-action-btn"
                    title={c.visible ? (en() ? 'Hide' : 'Gizle') : (en() ? 'Show' : 'Göster')}
                    data-cmp-toggle-vis={c.symbol}
                    onClick={() => toggleComparisonVisible(c.symbol)}
                  >
                    {c.visible ? '👁' : '🚫'}
                  </button>
                  <button
                    class="ind-action-btn"
                    title={en() ? 'Remove' : 'Kaldır'}
                    data-cmp-remove={c.symbol}
                    onClick={() => removeComparisonSymbol(c.symbol)}
                  >
                    ✕
                  </button>
                </div>
              )}
            </For>
          </div>
        </Show>

        <div>
          <div class="fx-list-caption" style={{ 'margin-bottom': '6px' }}>
            {en() ? 'POPULAR BENCHMARKS' : 'POPÜLER KIYASLAMA ENSTRÜMANLARI'}
          </div>
          <div style={{ display: 'flex', gap: '6px', 'flex-wrap': 'wrap' }}>
            <For each={COMPARE_BENCHMARKS.filter((b) => b.symbol !== ui.symbol.toUpperCase())}>
              {(b) => (
                <button
                  class="chip-btn"
                  classList={{ active: isAdded(b.symbol) }}
                  data-cmp-bench={b.symbol}
                  onClick={() => toggleItem(b.symbol)}
                >
                  {isAdded(b.symbol) ? '✓ ' : '+ '}
                  {b.symbol}
                </button>
              )}
            </For>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '6px' }}>
          {(['ALL', 'BIST', 'CRYPTO', 'US', 'FOREX'] as MarketFilter[]).map((m) => (
            <button class="chip-btn" classList={{ active: filter() === m }} data-cmp-filter={m} onClick={() => setFilter(m)}>
              {m === 'ALL' ? (en() ? 'All' : 'Tümü') : marketLabel(m)}
            </button>
          ))}
        </div>

        <div id="compare-symbol-results" style={{ 'overflow-y': 'auto', 'max-height': '220px', border: '1px solid var(--border-color)', 'border-radius': '6px' }}>
          <For each={results()}>
            {(item) => {
              const av = symbolAvatarSpec(item.symbol, item.market, item.exchange);
              const added = () => isAdded(item.symbol);
              return (
                <div
                  class="modal-sym-row"
                  data-cmp-row={item.symbol}
                  style={{ display: 'flex', 'align-items': 'center', 'justify-content': 'space-between', padding: '7px 12px', cursor: 'pointer' }}
                  onClick={() => toggleItem(item.symbol)}
                >
                  <div style={{ display: 'flex', 'align-items': 'center', gap: '8px' }}>
                    <span class="sym-avatar" style={{ background: av.bg, color: av.fg }}>{av.initials}</span>
                    <div>
                      <b style={{ color: 'var(--text-strong)', 'font-size': '13px' }}>{item.symbol}</b>
                      <div style={{ 'font-size': '11px', color: 'var(--text-secondary)' }}>{tt(item.displayName)}</div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', 'align-items': 'center', gap: '8px' }}>
                    <span class="exchange-badge">{av.exchange}</span>
                    <button class={added() ? 'btn-secondary' : 'btn-primary'} style={{ padding: '3px 10px', 'font-size': '11px' }}>
                      {added() ? (en() ? '✓ Added' : '✓ Eklendi') : en() ? '+ Add' : '+ Ekle'}
                    </button>
                  </div>
                </div>
              );
            }}
          </For>
        </div>
      </div>
    </Modal>
  );
}

export function Modals(): JSX.Element {
  return (
    <>
      <Show when={ui.modal === 'fx'}><FxModal /></Show>
      <StudySettingsDialog />
      <StudyMenu />
      <Show when={ui.modal === 'templates'}><TemplatesModal /></Show>
      <Show when={ui.modal === 'settings'}><SettingsModal /></Show>
      <AlertDialog />
      <AlertPopups />
      <Show when={ui.modal === 'about'}><AboutModal /></Show>
      <Show when={ui.modal === 'search'}><SymbolSearchModal /></Show>
      <Show when={ui.modal === 'compare'}><CompareModal /></Show>
      <Show when={ui.modal === 'command'}><CommandModal /></Show>
      <Show when={ui.modal === 'layouts'}><LayoutsModal /></Show>
      <Show when={ui.modal === 'goto'}><GoToDateModal /></Show>
      <Show when={ui.modal === 'shortcuts'}><ShortcutsModal /></Show>
      <Show when={ui.modal === 'server'}><ServerModal /></Show>
      <QuickIntervalPopup />
      <MobileMoreSheet />
    </>
  );
}
