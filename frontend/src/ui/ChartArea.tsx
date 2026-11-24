import { For, Show, createEffect, createMemo, createSignal, on, onCleanup, onMount, type JSX } from 'solid-js';
import { TitanChartController } from '../chart/ChartController';
import { isDerivedStyle, styleTag } from '../chart/chartTypes';
import { DrawingOverlay } from '../chart/DrawingOverlay';
import { OrderLayer } from '../chart/OrderLayer';
import { bracketFieldForDrop, orderLines, roundPrice } from '../state/trading';
import { cancelLine, dropLine, paperView, quickOrder, setBrackets, startTrading } from '../state/tradingStore';
import {
  PRESET_INTERVALS,
  formatPrice,
  formatSigned,
  formatVolumeShort,
  tvIntervalLabel,
} from '../state/format';
import { FeedChips } from './FeedChips';
import { buySellPrices, candleChangePct } from '../state/reports';
import {
  DEFAULT_SLOT_SYMBOLS,
  getLayoutTemplate,
  gridCellStyle,
  gridContainerStyle,
  secondaryCount,
} from '../state/layout';
import { patchSlotInfo, slotInfos } from '../state/layoutState';
import { createLongPress } from '../state/mobile';
import { lang, t, tt } from '../state/i18n';
import { clearRuntime, rt } from '../state/runtime';
import type { PaneId, ScaleSide } from '../chart/panes';
import { TEXT_TOOLS, TOOL_LABELS } from '../chart/drawing/toolSpec';
import { TF_UNITS, TF_UNIT_LABELS, TF_UNIT_LIMITS, onlyThisTimeframe } from '../chart/drawing/visibility';
import { templatesFor } from '../state/drawingPrefs';
import { ICONS } from '../styles/icons';
import type { DrawingToolType, DrawingVisibility, TfUnit } from '../types/market';
import { setSettingsTab } from './SettingsModal';
import { Icon } from './Icon';
import { footprintViewportChanged } from '../state/footprintFeed';
import { OSCILLATOR_ITEMS, OVERLAY_ITEMS } from '../state/templates';
import { applyTheme } from '../state/theme';
import { removeStudiesInPane, removeStudy, setStudySettings, studyRenderList, toggleStudyVisible } from '../state/studies';
import { StudyLegendRows, studiesInPane } from './Indicators';
import { studyShortTitle } from '../state/studies';
import { currencyBadgeLabel } from '../state/symbolExpr';
import { selectedTradeId, tradeLabels, tradeLines } from '../state/deepTest';
import { initAlerts, migrateLegacy, openDrawingAlert, serverAlerts } from '../state/alertStore';
import { ALERTABLE_TOOLS, alertLinePrice, conditionLabel, fmtNum } from '../state/alerts';
import {
  alerts,
  setAlerts,
  applyDrawingTemplate,
  applyFactoryStyle,
  applyScriptChartPick,
  bootstrap,
  comparisons,
  deleteDrawingTemplate,
  removeComparisonSymbol,
  saveDrawingTemplate,
  setDrawingVisibility,
  cancelScriptChartPick,
  candles,
  closePaneById,
  paneMenu,
  scriptPickTarget,
  setCompareScale,
  setPaneMenu,
  setPaneSide,
  toggleComparisonVisible,
  toggleInvertScale,
  toggleScale,
  toggleScaleLock,
  createReplay,
  deleteSelectedDrawing,
  duplicateSelectedDrawing,
  handleSlotCrosshair,
  handleSlotTimeClick,
  handleSlotVisibleRange,
  hover,
  lastCandle,
  loadError,
  loadErrorUnofficial,
  loadOlderHistory,
  loadSecondary,
  loading,
  meta,
  persistCompleted,
  persistSlotDrawing,
  pickColor,
  scriptResult,
  recordDrawingHistory,
  runScript,
  scheduleResize,
  setActiveSlot,
  setSlotInterval,
  setSlotSymbol,
  setWorkbenchTab,
  setZoomMode,
  selectedDrawing,
  setHover,
  setCtxMenu,
  setSelectedDrawing,
  setTool,
  setUi,
  slotIntervalAt,
  slotSymbolAt,
  toggleIndicator,
  toggleMaximizeSlot,
  ui,
  updateSelectedDrawing,
} from '../state/store';

const SWATCHES = ['#0284C7', '#089981', '#F23645', '#FF9800', '#AB47BC', '#FFFFFF'];

/** Standart çizim şablonları: kaydet / uygula / sil / varsayılan. */
function TemplateMenu(props: { tool: DrawingToolType }): JSX.Element {
  const [open, setOpen] = createSignal(false);
  const [name, setName] = createSignal('');
  const list = () => templatesFor(ui.drawTemplates, props.tool);
  return (
    <span style={{ position: 'relative' }}>
      <button id="btn-draw-template" class="btn-secondary" style={{ padding: '2px 6px' }} title={tt("Çizim şablonu")} onClick={() => setOpen(!open())}>
        <Icon svg={ICONS.template} />
      </button>
      <Show when={open()}>
        <div class="draw-pop" id="draw-template-pop">
          <For each={list()} fallback={<div style={{ color: 'var(--text-muted)', padding: '4px 6px' }}>{tt("Bu araç için şablon yok")}</div>}>
            {(t) => (
              <div class="draw-pop-row">
                <button class="draw-pop-item grow" data-tpl={t.id} onClick={() => (applyDrawingTemplate(t.id), setOpen(false))}>
                  <span style={{ display: 'inline-block', width: '10px', height: '10px', background: t.style.color ?? '#0284C7', 'margin-right': '6px', 'border-radius': '2px' }} />
                  {t.name}
                </button>
                <button class="draw-pop-item" data-tpl-del={t.id} title={tt("Sil")} onClick={() => deleteDrawingTemplate(t.id)}>
                  ✕
                </button>
              </div>
            )}
          </For>
          <div class="draw-pop-sep" />
          <div class="draw-pop-row">
            <input
              id="inp-tpl-name"
              class="script-select grow"
              placeholder={tt("Şablon adı")}
              value={name()}
              onInput={(e) => setName(e.currentTarget.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter' && saveDrawingTemplate(name())) (setName(''), setOpen(false));
              }}
            />
            <button id="btn-tpl-save" class="btn-secondary" onClick={() => saveDrawingTemplate(name()) && (setName(''), setOpen(false))}>
              {tt("Kaydet")}
            </button>
          </div>
          <button id="btn-tpl-default" class="draw-pop-item" onClick={() => (applyFactoryStyle(), setOpen(false))}>
            {tt("Varsayılan şablonu uygula")}
          </button>
        </div>
      </Show>
    </span>
  );
}

/** Standart "Görünürlük" sekmesi: aralık birimi başına aç/kapa + [min, max]. */
function VisibilityMenu(props: { visibility: DrawingVisibility | undefined }): JSX.Element {
  const [open, setOpen] = createSignal(false);
  const range = (u: TfUnit): [number, number] | null => {
    const v = props.visibility;
    if (!v || !(u in v)) return [...TF_UNIT_LIMITS[u]];
    return v[u] ?? null;
  };
  const edit = (u: TfUnit, r: [number, number] | null) => {
    const next: DrawingVisibility = {};
    for (const k of TF_UNITS) next[k] = k === u ? r : range(k);
    setDrawingVisibility(next);
  };
  return (
    <span style={{ position: 'relative' }}>
      <button
        id="btn-draw-visibility"
        class="btn-secondary"
        classList={{ active: !!props.visibility }}
        style={{ padding: '2px 6px' }}
        title={tt("Aralıklara göre görünürlük")}
        onClick={() => setOpen(!open())}
      >
        <Icon svg={ICONS.eye} />
      </button>
      <Show when={open()}>
        <div class="draw-pop" id="draw-visibility-pop">
          <For each={TF_UNITS}>
            {(u) => (
              <div class="draw-pop-row" data-vis-unit={u}>
                <input
                  type="checkbox"
                  checked={range(u) !== null}
                  onChange={(e) => edit(u, e.currentTarget.checked ? [...TF_UNIT_LIMITS[u]] : null)}
                />
                <span class="grow">{TF_UNIT_LABELS[u]}</span>
                <input
                  type="number"
                  class="script-select"
                  data-vis-min={u}
                  min={TF_UNIT_LIMITS[u][0]}
                  max={TF_UNIT_LIMITS[u][1]}
                  disabled={range(u) === null}
                  value={range(u)?.[0] ?? TF_UNIT_LIMITS[u][0]}
                  onChange={(e) => edit(u, [Number(e.currentTarget.value), range(u)?.[1] ?? TF_UNIT_LIMITS[u][1]])}
                  onKeyDown={(e) => e.stopPropagation()}
                />
                <input
                  type="number"
                  class="script-select"
                  data-vis-max={u}
                  min={TF_UNIT_LIMITS[u][0]}
                  max={TF_UNIT_LIMITS[u][1]}
                  disabled={range(u) === null}
                  value={range(u)?.[1] ?? TF_UNIT_LIMITS[u][1]}
                  onChange={(e) => edit(u, [range(u)?.[0] ?? TF_UNIT_LIMITS[u][0], Number(e.currentTarget.value)])}
                  onKeyDown={(e) => e.stopPropagation()}
                />
              </div>
            )}
          </For>
          <div class="draw-pop-sep" />
          <button id="btn-vis-only" class="draw-pop-item" onClick={() => setDrawingVisibility(onlyThisTimeframe(ui.interval))}>
            {tt("Yalnız bu aralıkta göster (")}{ui.interval})
          </button>
          <button id="btn-vis-all" class="draw-pop-item" onClick={() => setDrawingVisibility(undefined)}>
            {tt("Tüm aralıklarda göster")}
          </button>
        </div>
      </Show>
    </span>
  );
}

/** Faz 23: sunucu alarm motoru — liste/günlük/SSE + eski yerel alarmların bir kez taşınması. */
async function startServerAlerts(): Promise<void> {
  initAlerts();
  const legacy = alerts();
  if (legacy.length) {
    setAlerts([]);
    await migrateLegacy(legacy);
  }
}

export function DrawingPropsBar(): JSX.Element {
  const visible = () => ui.tool !== 'cursor' || !!selectedDrawing();
  const sel = () => selectedDrawing();
  return (
    <Show when={visible()}>
      <div id="drawing-props-bar" class="drawing-props-toolbar" style={{ display: 'flex' }}>
        <span style={{ 'font-size': '11px', color: 'var(--text-secondary)', 'font-weight': '600' }}>
          {sel() ? TOOL_LABELS[sel()!.toolType] : tt("Çizim Rengi")}:
        </span>
        <For each={SWATCHES}>
          {(c) => (
            <div
              class="color-dot-picker"
              data-color={c}
              style={{
                background: c,
                outline: (sel()?.color ?? ui.drawColor) === c ? '2px solid #0284C7' : 'none',
              }}
              onClick={() => pickColor(c)}
            />
          )}
        </For>
        <Show when={sel()}>
          {(d) => (
            <>
              <div class="topbar-divider" style={{ height: '16px' }} />
              <select
                id="sel-draw-width"
                class="script-select"
                title={tt("Çizgi kalınlığı")}
                value={String(d().width ?? 0)}
                onChange={(e) => {
                  const v = Number(e.currentTarget.value);
                  updateSelectedDrawing({ width: v > 0 ? v : undefined });
                }}
              >
                <option value="0">{tt("Kalınlık: otomatik")}</option>
                <For each={[1, 2, 3, 4]}>{(w) => <option value={String(w)}>{w}px</option>}</For>
              </select>
              <select
                id="sel-draw-style"
                class="script-select"
                title={tt("Çizgi tipi")}
                value={d().lineStyle ?? ''}
                onChange={(e) => {
                  const v = e.currentTarget.value as '' | 'solid' | 'dashed' | 'dotted';
                  updateSelectedDrawing({ lineStyle: v || undefined });
                }}
              >
                <option value="">{tt("Tip: otomatik")}</option>
                <option value="solid">{tt("Düz")}</option>
                <option value="dashed">{tt("Kesikli")}</option>
                <option value="dotted">{tt("Noktalı")}</option>
              </select>
              <Show
                when={TEXT_TOOLS.has(d().toolType)}
                fallback={
                  <input
                    id="inp-draw-label"
                    class="script-select"
                    style={{ width: '120px' }}
                    placeholder={tt("Metin / etiket")}
                    value={d().label ?? ''}
                    onChange={(e) => updateSelectedDrawing({ label: e.currentTarget.value })}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === 'Enter') e.currentTarget.blur();
                    }}
                  />
                }
              >
                <textarea
                  id="inp-draw-text"
                  class="script-select draw-textarea"
                  rows={2}
                  style={{ width: '170px', resize: 'vertical', 'font-family': 'inherit' }}
                  placeholder={d().toolType === 'table' ? tt("Hücreler | ile, satırlar Enter ile") : tt("Metin (çok satır)")}
                  value={d().label ?? ''}
                  onChange={(e) => updateSelectedDrawing({ label: e.currentTarget.value })}
                  onKeyDown={(e) => e.stopPropagation()}
                />
              </Show>
              <Show when={TEXT_TOOLS.has(d().toolType) || d().toolType === 'icon'}>
                <select
                  id="sel-draw-font"
                  class="script-select"
                  title={d().toolType === 'icon' ? tt("İkon boyutu") : tt("Yazı boyutu")}
                  value={String(d().fontSize ?? 0)}
                  onChange={(e) => {
                    const v = Number(e.currentTarget.value);
                    updateSelectedDrawing({ fontSize: v > 0 ? v : undefined });
                  }}
                >
                  <option value="0">{d().toolType === 'icon' ? tt("Boyut") : tt("Punto")}: otomatik</option>
                  <For each={d().toolType === 'icon' ? [16, 20, 28, 36, 48, 64] : [10, 12, 14, 16, 20, 24, 28, 36]}>
                    {(n) => <option value={String(n)}>{n}</option>}
                  </For>
                </select>
              </Show>
              <button
                id="btn-draw-lock"
                class="btn-secondary"
                classList={{ active: !!d().locked }}
                style={{ padding: '2px 6px' }}
                title={tt("Kilitle (sürüklemeyi engelle)")}
                onClick={() => updateSelectedDrawing({ locked: !d().locked })}
              >
                {d().locked ? '🔒' : '🔓'}
              </button>
              <button
                id="btn-draw-dup"
                class="btn-secondary"
                style={{ padding: '2px 6px' }}
                title={tt("Kopyala (Ctrl+D)")}
                onClick={duplicateSelectedDrawing}
              >
                ⧉
              </button>
              <Show when={ALERTABLE_TOOLS.has(d().toolType)}>
                <button
                  id="btn-draw-alert"
                  class="btn-secondary"
                  style={{ padding: '2px 6px' }}
                  title={tt("Bu çizime alarm ekle (sunucuda değerlendirilir)")}
                  onClick={() => openDrawingAlert(d())}
                >
                  ⏰
                </button>
              </Show>
              <TemplateMenu tool={d().toolType} />
              <VisibilityMenu visibility={d().visibility} />
            </>
          )}
        </Show>
        <div class="topbar-divider" style={{ height: '16px' }} />
        <button
          id="btn-delete-active-drawing"
          class="btn-secondary"
          style={{ padding: '2px 6px', color: 'var(--bear)' }}
          onClick={() => {
            if (!deleteSelectedDrawing()) setTool('cursor');
          }}
        >
          {tt("Sil ✕")}
        </button>
      </div>
    </Show>
  );
}

function Legend(): JSX.Element {
  const view = createMemo(() => {
    const h = hover();
    if (h) return h;
    const c = lastCandle();
    return c ? { ...c, changePct: candleChangePct(c) } : null;
  });
  const cls = () => {
    const v = view();
    return v && v.close >= v.open ? 'val-up' : 'val-down';
  };
  const activeInd = () => [...OVERLAY_ITEMS, ...OSCILLATOR_ITEMS].filter((i) => ui.quick[i.key]);
  const prices = () => {
    const c = lastCandle();
    return c ? buySellPrices(c.close) : null;
  };

  /** Varsayılan: türetilmiş tiplerde lejantta parametre etiketi ("Kagi [ATR(14), 2500]"). */
  const styleLabel = createMemo(() => (isDerivedStyle(ui.chartStyle) ? styleTag(ui.chartStyle, candles(), ui.styleParams, rt.chart?.derivedBasisCandles?.()) : ''));
  const exchange = () => {
    const m = meta();
    if (!m) return '';
    return m.provider === 'BINANCE' ? 'BINANCE' : m.market;
  };
  /** Varsayılan: değişim önceki barın kapanışına göre (yoksa açılışa göre). */
  const chg = () => {
    const v = view();
    if (!v) return { abs: 0, pct: 0 };
    const list = candles();
    let lo = 0;
    let hi = list.length - 1;
    let idx = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (list[mid].time === v.time) { idx = mid; break; }
      if (list[mid].time < v.time) lo = mid + 1;
      else hi = mid - 1;
    }
    const base = idx > 0 ? list[idx - 1].close : v.open;
    return { abs: v.close - base, pct: base > 0 ? ((v.close - base) / base) * 100 : 0 };
  };

  const st = () => ui.chartSettings.status;
  const titleText = () => {
    const mode = st().titleMode;
    const sym = meta()?.symbol || ui.symbol;
    const desc = meta()?.displayName || sym;
    if (mode === 'ticker') return sym;
    if (mode === 'both' && desc !== sym) return `${sym} · ${desc}`;
    return desc;
  };
  const showQuick = () => ui.visual.showQuickTrade && st().showBuySell && ui.chartSettings.trading.showQuickTrade;

  return (
    <div
      class="ohlc-legend"
      style={st().bgOpacity > 0 ? { background: `rgba(19, 19, 19, ${(st().bgOpacity / 100).toFixed(2)})`, 'border-radius': '6px', padding: '4px 6px' } : undefined}
    >
      <div class="ohlc-title-row">
        <Show when={st().showTitle}>
          <span id="leg-symbol" class="leg-sym" title={meta()?.symbol ?? ui.symbol}>
            {titleText()}
          </span>
          <span class="leg-dot">·</span>
          <span id="leg-tf">{tvIntervalLabel(ui.interval)}</span>
          <span class="leg-dot">·</span>
          <span id="leg-name">{exchange()}</span>
        </Show>
        <Show when={ui.displayCurrency}>
          <span class="leg-dot">·</span>
          <span id="leg-currency" class="exchange-badge">
            {currencyBadgeLabel(meta()?.nativeCurrency ?? meta()?.currency, ui.displayCurrency)}
          </span>
        </Show>
        <Show when={styleLabel()}>
          <span class="leg-dot">·</span>
          <span id="leg-style">{styleLabel()}</span>
        </Show>
        <Show when={!ui.simple && st().showFeedChips}>
          <FeedChips />
        </Show>
        <Show when={st().showOhlc || st().showBarChange}>
          <span class="ohlc-values-row" id="leg-ohlc">
            <Show when={view()} fallback={<span class="ohlc-item"><span>{t('leg.noData')}</span></span>}>
              {(v) => (
                <>
                  <Show when={st().showOhlc}>
                    <span class="ohlc-item"><span>{t('leg.open')}</span><strong id="leg-o" class={cls()}>{formatPrice(v().open)}</strong></span>
                    <span class="ohlc-item"><span>{t('leg.high')}</span><strong id="leg-h" class={cls()}>{formatPrice(v().high)}</strong></span>
                    <span class="ohlc-item"><span>{t('leg.low')}</span><strong id="leg-l" class={cls()}>{formatPrice(v().low)}</strong></span>
                    <span class="ohlc-item"><span>{t('leg.close')}</span><strong id="leg-c" class={cls()}>{formatPrice(v().close)}</strong></span>
                  </Show>
                  <Show when={st().showBarChange}>
                    <strong id="leg-chg" class={`ohlc-item ${chg().abs >= 0 ? 'val-up' : 'val-down'}`}>
                      {formatSigned(chg().abs, (v().close < 2 ? 4 : 2), '')} ({formatSigned(chg().pct, 2, '%')})
                    </strong>
                  </Show>
                </>
              )}
            </Show>
          </span>
        </Show>
      </div>
      <Show when={showQuick()}>
        <div class="tv-trade-boxes" id="tv-quick-trade-widget">
          <button
            id="btn-quick-sell"
            class="tv-sell-btn"
            title={lang() === 'en' ? 'One-click Market SELL (Paper)' : 'Tek Tıkla Sanal SHORT (Satış) Pozisyonu Aç'}
            onClick={() => void quickOrder('sell', ui.quickQty > 0 ? ui.quickQty : 1)}
          >
            <span class="tv-box-lbl">{t('leg.sell')}</span>
            <span id="lbl-sell-price" class="tv-box-prc">{prices() ? formatPrice(prices()!.sell) : '—'}</span>
          </button>
          <div class="tv-spread-box">
            <input
              id="inp-quick-qty"
              class="tv-qty-input"
              type="number"
              min="1"
              step="10"
              title={lang() === 'en' ? 'Quantity' : 'Miktar (Adet)'}
              value={ui.quickQty}
              onInput={(e) => setUi('quickQty', Number(e.currentTarget.value))}
            />
          </div>
          <button
            id="btn-quick-buy"
            class="tv-buy-btn"
            title={lang() === 'en' ? 'One-click Market BUY (Paper)' : 'Tek Tıkla Sanal LONG (Alış) Pozisyonu Aç'}
            onClick={() => void quickOrder('buy', ui.quickQty > 0 ? ui.quickQty : 1)}
          >
            <span class="tv-box-lbl">{t('leg.buy')}</span>
            <span id="lbl-buy-price" class="tv-box-prc">{prices() ? formatPrice(prices()!.buy) : '—'}</span>
          </button>
        </div>
      </Show>
      <Show when={st().showVolume ? view() : null}>
        {(v) => (
          <div class="ind-legend-row vol-legend-row">
            <span class="ind-name">{t('leg.volume')}</span>
            <strong id="leg-v" class={cls()}>{formatVolumeShort(v().volume)}</strong>
          </div>
        )}
      </Show>
      <Show when={st().showIndTitles}>
      <div class="chart-indicators-legend" id="chart-indicators-legend">
        <Show when={scriptResult()?.ok}>
          <div class="ind-legend-row script-legend-row" id="script-legend-row" data-script-active>
            <span style={{ color: '#38bdf8' }}>⚔ {scriptResult()!.scriptTitle}</span>
            <span class="term-hint">{t('leg.loaded')}</span>
            <div class="ind-actions">
              <button class="ind-action-btn" id="btn-script-legend-edit" title={lang() === 'en' ? 'Open Script Editor' : 'Betik editörünü aç'} onClick={() => setWorkbenchTab('script')}>⚙</button>
            </div>
          </div>
        </Show>
        <StudyLegendRows />
        <For each={comparisons()}>
          {(c) => (
            <div class="ind-legend-row cmp-legend-row" data-cmp-legend={c.symbol}>
              <span style={{ color: c.color, 'font-weight': '600', opacity: c.visible ? 1 : 0.45 }}>
                ● {c.symbol} <span class="term-hint">({c.scaleMode === 'same' ? '%' : c.scaleMode === 'left' ? (lang() === 'en' ? 'Left' : 'Sol') : (lang() === 'en' ? 'Own' : 'Kendi')})</span>
              </span>
              <Show when={c.lastClose != null}>
                <strong style={{ color: c.color, 'font-family': 'var(--font-mono)', 'font-size': '11px' }}>
                  {formatPrice(c.lastClose!)} {c.changePct != null ? `(${formatSigned(c.changePct, 2, '%')})` : ''}
                </strong>
              </Show>
              <div class="ind-actions">
                <button
                  class="ind-action-btn"
                  data-cmp-leg-vis={c.symbol}
                  title={c.visible ? (lang() === 'en' ? 'Hide' : 'Gizle') : (lang() === 'en' ? 'Show' : 'Göster')}
                  onClick={() => toggleComparisonVisible(c.symbol)}
                >
                  {c.visible ? '👁' : '🚫'}
                </button>
                <button
                  class="ind-action-btn"
                  data-cmp-leg-del={c.symbol}
                  title={lang() === 'en' ? 'Remove comparison' : 'Karşılaştırmayı kaldır'}
                  onClick={() => removeComparisonSymbol(c.symbol)}
                >
                  ✕
                </button>
              </div>
            </div>
          )}
        </For>
        <For each={activeInd()}>
          {(it) => (
            <div class="ind-legend-row" data-ind-row={it.key}>
              <span style={{ color: it.color }}>● {it.legend}</span>
              <div class="ind-actions">
                <button class="ind-action-btn" data-ind-cfg={it.key} title={t('cfg.title')} onClick={() => setUi('modal', 'fx')}>⚙</button>
                <button class="ind-action-btn" data-ind-remove={it.key} title={lang() === 'en' ? 'Remove' : 'Kaldır'} onClick={() => toggleIndicator(it.key)}>✕</button>
              </div>
            </div>
          )}
        </For>
      </div>
      </Show>
    </div>
  );
}

const SEC_OPTIONS: Array<[string, string]> = [
  ['THYAO.IS', 'THYAO.IS'],
  ['XU100.IS', 'XU100.IS'],
  ['BTCUSDT', 'BTCUSDT'],
  ['ETHUSDT', 'ETHUSDT'],
  ['USDTRY=X', 'USDTRY=X'],
  ['GC=F', 'GC=F'],
  ['NVDA', 'NVDA'],
  ['AAPL', 'AAPL'],
  ['MSFT', 'MSFT'],
  ['SOLUSDT', 'SOLUSDT'],
  ['BNBUSDT', 'BNBUSDT'],
  ['GARAN.IS', 'GARAN.IS'],
  ['AKBNK.IS', 'AKBNK.IS'],
  ['EREGL.IS', 'EREGL.IS'],
  ['SISE.IS', 'SISE.IS'],
  ['EURUSD=X', 'EURUSD=X'],
];

function SecondaryPane(props: { index: number }): JSX.Element {
  let wrapEl!: HTMLDivElement;
  let canvas!: HTMLDivElement;
  const slot = () => props.index + 1;
  const sym = () => slotSymbolAt(slot());
  const iv = () => slotIntervalAt(slot());
  const tpl = () => getLayoutTemplate(ui.layout);
  const dense = () => tpl().count >= 9;
  const isMax = () => ui.maximizedSlot === slot();
  const isHiddenByMax = () => ui.maximizedSlot !== null && ui.maximizedSlot !== slot();
  const info = () => slotInfos()[slot()];
  const view = () => {
    const inf = info();
    if (inf?.hover) return inf.hover;
    const c = inf?.lastCandle;
    return c ? { ...c, changePct: candleChangePct(c) } : null;
  };
  const chgPct = () => {
    const v = view();
    if (!v) return 0;
    const prev = info()?.prevClose;
    const base = prev && prev > 0 ? prev : v.open;
    return base > 0 ? ((v.close - base) / base) * 100 : 0;
  };
  const symOptions = () => {
    const cur = sym();
    if (SEC_OPTIONS.some(([v]) => v === cur)) return SEC_OPTIONS;
    return [[cur, cur] as [string, string], ...SEC_OPTIONS];
  };
  const ivOptions = () => {
    const base = [...PRESET_INTERVALS, ...ui.customTimeframes];
    const cur = iv();
    return base.includes(cur) ? base : [...base, cur];
  };

  onMount(() => {
    const idx = props.index;
    const s = slot();
    const chart = new TitanChartController(
      canvas,
      (h) => patchSlotInfo(s, { hover: h }),
      () => {
        rt.secondaryOverlays[idx]?.render();
      },
      undefined,
      {
        onCrosshairTime: (t) => handleSlotCrosshair(s, t),
        onTimeClick: (t) => handleSlotTimeClick(s, t),
        onVisibleTimeRange: (r) => handleSlotVisibleRange(s, r),
      }
    );
    chart.applyVisualSettings({
      upColor: ui.visual.upColor,
      downColor: ui.visual.downColor,
      bgColor: ui.visual.bgColor,
      showGrid: ui.visual.showGrid,
    });
    rt.secondaries[idx] = chart;

    const ov = new DrawingOverlay(
      wrapEl,
      chart,
      (d) => persistSlotDrawing(s, d),
      () => setUi('tool', 'cursor'),
      undefined,
      (d) => persistSlotDrawing(s, d)
    );
    ov.setToolStyleProvider((tool) => ui.toolStyles[tool]);
    ov.setMagnet(ui.magnet ? ui.magnetMode : 'off');
    ov.setStayInDrawing(ui.stayInDrawing);
    ov.setIconChoice(ui.iconChoice);
    ov.setTool(ui.tool, ui.drawColor);
    ov.setHidden(ui.hideDrawings);
    rt.secondaryOverlays[idx] = ov;

    void loadSecondary(idx);
    scheduleResize(30);
  });

  onCleanup(() => {
    const idx = props.index;
    rt.secondaries[idx]?.destroy();
    rt.secondaries[idx] = undefined;
    rt.secondaryOverlays[idx] = undefined;
  });

  createEffect(on(() => [ui.tool, ui.drawColor] as const, ([t, c]) => rt.secondaryOverlays[props.index]?.setTool(t, c), { defer: true }));
  createEffect(on(() => [ui.magnet, ui.magnetMode] as const, ([m, mode]) => rt.secondaryOverlays[props.index]?.setMagnet(m ? mode : 'off'), { defer: true }));
  createEffect(on(() => ui.stayInDrawing, (v) => rt.secondaryOverlays[props.index]?.setStayInDrawing(v), { defer: true }));
  createEffect(on(() => ui.hideDrawings, (h) => rt.secondaryOverlays[props.index]?.setHidden(h), { defer: true }));
  createEffect(
    on(
      () => ({ ...ui.visual }),
      (v) =>
        rt.secondaries[props.index]?.applyVisualSettings({
          upColor: v.upColor,
          downColor: v.downColor,
          bgColor: v.bgColor,
          showGrid: v.showGrid,
        }),
      { defer: true }
    )
  );

  const id = props.index === 0 ? '' : `-${props.index + 1}`;
  const cellCss = () => {
    if (isHiddenByMax()) return { display: 'none' };
    if (isMax()) return { 'grid-column': '1 / -1', 'grid-row': '1 / -1' };
    return gridCellStyle(tpl(), slot());
  };

  return (
    <div
      id={`secondary-chart-pane${id}`}
      class="secondary-chart-pane"
      classList={{ 'slot-active': ui.activeSlot === slot(), 'slot-dense': dense(), 'slot-max': isMax() }}
      data-pane={props.index}
      data-slot={slot()}
      style={cellCss()}
      ref={wrapEl}
      onMouseDown={() => setActiveSlot(slot())}
    >
      <div class="ohlc-legend sec-legend">
        <div class="ohlc-title-row">
          <span id={`sec-symbol${id}`} class="leg-sym">
            {sym().replace(/\.IS$/, '')}
          </span>
          <span class="leg-dot">·</span>
          <span class="sec-tf-lbl">{tvIntervalLabel(iv())}</span>
          <Show when={view()}>
            {(v) => (
              <span class="sec-price-chip">
                <strong class={v().close >= v().open ? 'val-up' : 'val-down'}>{formatPrice(v().close)}</strong>
                <Show when={!dense()}>
                  <span class={chgPct() >= 0 ? 'val-up' : 'val-down'}> ({formatSigned(chgPct(), 2, '%')})</span>
                </Show>
              </span>
            )}
          </Show>
          <div class="sec-slot-controls">
            <select
              id={`sel-sec-symbol${id}`}
              class="script-select sec-mini-sel"
              title={tt("Hücre sembolü")}
              value={sym()}
              onChange={(e) => void setSlotSymbol(slot(), e.currentTarget.value)}
            >
              <For each={symOptions()}>{([v, label]) => <option value={v}>{label}</option>}</For>
            </select>
            <select
              class="script-select sec-mini-sel sec-tf-sel"
              data-slot-tf={slot()}
              title={tt("Hücre aralığı")}
              value={iv()}
              onChange={(e) => void setSlotInterval(slot(), e.currentTarget.value)}
            >
              <For each={ivOptions()}>{(t) => <option value={t}>{tvIntervalLabel(t)}</option>}</For>
            </select>
            <button
              class="sec-max-btn"
              data-slot-max={slot()}
              title={isMax() ? tt("Izgaraya dön (Alt+Enter)") : tt("Grafiği büyüt (Alt+Enter)")}
              onClick={(e) => {
                e.stopPropagation();
                toggleMaximizeSlot(slot());
              }}
            >
              {isMax() ? '⤡' : '⤢'}
            </button>
          </div>
        </div>
      </div>
      <Show when={info()?.error}>
        <div class="chart-error sec-chart-error" role="alert">
          <strong>{tt("⚠ Veri alınamadı")}</strong>
          <span>{info()!.error}</span>
        </div>
      </Show>
      <Show when={info()?.loading && !info()?.error}>
        <div class="chart-loading">{tt("Yükleniyor…")}</div>
      </Show>
      <div id={`sec-chart-canvas${id}`} class="main-chart-canvas" style={{ flex: '1' }} ref={canvas} />
    </div>
  );
}

// Varsayılan sembol tablosu import'u derleyici uyarısını önlemek için korunsun
void DEFAULT_SLOT_SYMBOLS;

export function ChartGrid(): JSX.Element {
  let mainEl!: HTMLDivElement;
  let wrapEl!: HTMLDivElement;
  const [zoomDrag, setZoomDrag] = createSignal<{ startX: number; curX: number } | null>(null);

  const openCtxAt = (clientX: number, clientY: number, target?: EventTarget | null) => {
    const r = wrapEl.getBoundingClientRect();
    const localX = clientX - r.left;
    const localY = clientY - r.top;
    const price = rt.chart?.yToPrice(localY) ?? null;
    const time = rt.chart?.xToTime(localX) ?? null;
    const el = target instanceof Element ? target : null;

    // 1. Çizim üzerine sağ tık → Çizim menüsü
    const drawEl = el?.closest?.('[data-drawing-id]');
    const drawId = drawEl?.getAttribute('data-drawing-id');
    if (drawId && drawId !== 'draft_preview' && drawId !== 'draft_brush_preview') {
      rt.overlay?.selectDrawing(drawId);
      setCtxMenu({ kind: 'drawing', x: clientX, y: clientY, price, time, drawingId: drawId });
      return;
    }
    // 2. Gösterge (Study) satırı → Study menüsü
    const studyEl = el?.closest?.('[data-study-row]');
    const studyUid = studyEl?.getAttribute('data-study-row');
    if (studyUid) {
      setCtxMenu({ kind: 'study', x: clientX, y: clientY, price, time, studyUid });
      return;
    }
    // 3. Hızlı gösterge satırı → Study menüsü
    const quickEl = el?.closest?.('[data-ind-row]');
    const quickKey = quickEl?.getAttribute('data-ind-row') as keyof import('../chart/ChartController').ActiveQuickIndicators | null;
    if (quickKey) {
      setCtxMenu({ kind: 'study', x: clientX, y: clientY, price, time, quickKey });
      return;
    }
    // 4. Ana sembol başlığı → Ana Seri menüsü
    if (el?.closest?.('.ohlc-title-row')) {
      setCtxMenu({ kind: 'series', x: clientX, y: clientY, price, time });
      return;
    }
    // 5. Fiyat ölçeği şeridi → Fiyat Ölçeği menüsü
    if (rt.chart?.isPriceScaleX?.(localX, ui.mainScaleSide)) {
      setCtxMenu({ kind: 'scale', x: clientX, y: clientY, price, time });
      return;
    }
    // 6. Grafik tuvali → Grafik menüsü
    setCtxMenu({ kind: 'chart', x: clientX, y: clientY, price, time });
  };
  // dokunmatikte sağ tık yok: imleç modunda uzun basma bağlam menüsünü açar
  const lp = createLongPress({ onLongPress: (x, y) => openCtxAt(x, y, null) });

  onMount(() => {
    const chart = new TitanChartController(
      mainEl,
      (h) => setHover(h),
      () => {
        rt.overlay?.render();
        footprintViewportChanged();
      },
      (oldest) => loadOlderHistory(oldest),
      {
        onPaneClose: (id) => (id.startsWith('study:') ? removeStudiesInPane(id) : closePaneById(id)),
        onPaneMenu: (id, x, y) => setPaneMenu({ id, x, y }),
        onCrosshairTime: (t) => handleSlotCrosshair(0, t),
        onTimeClick: (t) => handleSlotTimeClick(0, t),
        onVisibleTimeRange: (r) => handleSlotVisibleRange(0, r),
      }
    );
    rt.chart = chart;
    applyTheme();
    rt.overlay = new DrawingOverlay(
      wrapEl,
      chart,
      persistCompleted,
      () => setUi('tool', 'cursor'),
      (d) => setSelectedDrawing(d ? { ...d } : null),
      persistCompleted
    );
    rt.overlay.setToolStyleProvider((tool) => ui.toolStyles[tool]);
    rt.overlay.setMagnet(ui.magnet ? ui.magnetMode : 'off');
    rt.overlay.setStayInDrawing(ui.stayInDrawing);
    rt.overlay.setIconChoice(ui.iconChoice);
    rt.overlay.setAllLocked(ui.allDrawingsLocked);
    rt.overlay.setHistoryHook(recordDrawingHistory);
    // Faz 28: emir/pozisyon çizgileri (sürükle → fiyat değiştir, ✕ → iptal/kapat, TP/SL tutamaçları)
    rt.orders = new OrderLayer(wrapEl, chart, {
      onDrop: (line, price) => (line.drag ? dropLine(line.drag, price) : undefined),
      onCancel: (line) => void cancelLine(line),
      onBracket: (symbol, field, price) => {
        const pos = paperView().positions.find((p) => p.symbol === symbol);
        // Tutamaç yanlış tarafa bırakılırsa (ör. long'da TP fiyatın altına) doğru köprü türüne çevrilir.
        const f = pos ? bracketFieldForDrop(pos.qty, pos.last, price) : field;
        // f yalnızca bu alanı değiştirir; diğer köprü olduğu gibi kalır (0 = dokunma)
        return setBrackets(symbol, f === 'takeProfit' ? roundPrice(price) : 0, f === 'stopLoss' ? roundPrice(price) : 0);
      },
    });
    rt.overlay.onAfterRender(() => rt.orders?.render());
    rt.replay = createReplay();
    void bootstrap().then(startServerAlerts);
    startTrading();
  });
  onCleanup(() => {
    rt.chart?.destroy();
    clearRuntime();
  });

  // Faz 23/29: bu sembolün sabit değerli fiyat alarmları (Ayarlar → Alarmlar'a göre)
  createEffect(() => {
    const sym = ui.symbol.toUpperCase();
    const onlyAct = ui.chartSettings.alerts.onlyActiveLines;
    const lines = serverAlerts()
      .filter((a) => a.symbol === sym && (!onlyAct || a.status === 'active'))
      .map((a) => ({ price: alertLinePrice(a), title: `⏰ ${a.name || `${conditionLabel(a.condition)} ${fmtNum(a.target?.value)}`}` }))
      .filter((l): l is { price: number; title: string } => l.price !== null);
    rt.chart?.setAlertLines(lines);
  });

  // store → imperatif denetleyici köprüsü (ilk değer controller varsayılanıdır; yalnızca değişimde uygula)
  createEffect(
    on(
      () => ui.chartStyle,
      (m, prev) => {
        rt.chart?.setChartStyleMode(m);
        // TitanScript tuğla/normal çubuk kümesi değiştiyse yeniden hesaplanmalı
        if (isDerivedStyle(m) || (prev !== undefined && isDerivedStyle(prev))) runScript();
      },
      { defer: true }
    )
  );
  createEffect(
    on(
      () => JSON.stringify(ui.styleParams),
      () => {
        rt.chart?.setStyleParams(JSON.parse(JSON.stringify(ui.styleParams)));
        if (isDerivedStyle(ui.chartStyle)) runScript();
      },
      { defer: true }
    )
  );
  createEffect(() => rt.chart?.setMarket(meta()?.market));
  createEffect(on(() => ui.invertScale, (v) => rt.chart?.setInvertScale(v), { defer: true }));
  createEffect(on(() => ui.scaleKind, (k) => rt.chart?.setPriceScaleKind(k), { defer: true }));
  createEffect(on(() => ui.mainScaleSide, (s) => rt.chart?.setPaneScaleSide('main', s), { defer: true }));
  createEffect(on(() => ui.compareScale, (m) => rt.chart?.setCompareScale(m), { defer: true }));
  createEffect(on(() => ({ ...ui.paneSides }), (m) => {
    for (const id of ['rsi', 'macd', 'script'] as const) rt.chart?.setPaneScaleSide(id, m[id] ?? 'right');
    for (const id of Object.keys(m)) if (id.startsWith('study:')) rt.chart?.setPaneScaleSide(id as PaneId, m[id] ?? 'right');
  }, { defer: true }));
  createEffect(on(() => ui.scriptSubHidden, (h) => rt.chart?.setScriptSubHidden(h), { defer: true }));
  createEffect(on(() => ui.scaleLock, (l) => rt.chart?.setScaleLocked(l), { defer: true }));
  createEffect(
    on(
      () => ({ ...ui.visual }),
      (v) =>
        rt.chart?.applyVisualSettings({
          upColor: v.upColor,
          downColor: v.downColor,
          bgColor: v.bgColor,
          showGrid: v.showGrid,
        }),
      { defer: true }
    )
  );
  createEffect(on(() => ({ ...ui.quick }), (q) => rt.chart?.setQuickIndicators(q), { defer: true }));
  createEffect(on(() => [ui.tool, ui.drawColor] as const, ([t, c]) => rt.overlay?.setTool(t, c), { defer: true }));
  createEffect(on(() => [ui.magnet, ui.magnetMode] as const, ([m, mode]) => rt.overlay?.setMagnet(m ? mode : 'off')));
  createEffect(on(() => ui.stayInDrawing, (v) => rt.overlay?.setStayInDrawing(v)));
  createEffect(on(() => ui.iconChoice, (v) => rt.overlay?.setIconChoice(v)));
  createEffect(on(() => ui.hideDrawings, (h) => rt.overlay?.setHidden(h), { defer: true }));
  createEffect(on(() => ui.allDrawingsLocked, (l) => rt.overlay?.setAllLocked(l), { defer: true }));
  createEffect(
    on(
      () => JSON.stringify(ui.chartSettings),
      () => rt.chart?.applyChartSettings?.(ui.chartSettings, ui.symbol),
      { defer: true }
    )
  );
  createEffect(() =>
    rt.orders?.setLines(
      ui.chartSettings.trading.showPositionsOrders ? orderLines(paperView(), ui.symbol, lastCandle()?.close) : []
    )
  );
  createEffect(() => {
    const res = scriptResult();
    if (!res) return;
    rt.chart?.renderScriptExecution(res);
    scheduleResize(20);
  });
  // Faz 24: strateji işlem okları + bağlantı çizgileri + etiketler
  createEffect(() => {
    const trades = scriptResult()?.backtest?.trades ?? [];
    rt.chart?.setTradeOverlay(trades, { lines: tradeLines(), labels: tradeLabels(), selectedId: selectedTradeId() });
  });
  createEffect(on(() => candles().length === 0, () => rt.overlay?.render(), { defer: true }));
  // Faz 20: grafikteki göstergeler (stil/pane/görünürlük değişince ya da yeni sonuçta)
  createEffect(() => {
    const items = studyRenderList();
    rt.chart?.renderStudies(items);
    scheduleResize(20);
  });

  const tpl = () => getLayoutTemplate(ui.layout);
  const isMulti = () => tpl().count > 1;
  const mainHidden = () => ui.maximizedSlot !== null && ui.maximizedSlot !== 0;
  const mainCellCss = () => {
    if (mainHidden()) return { display: 'none' };
    if (ui.maximizedSlot === 0) return { 'grid-column': '1 / -1', 'grid-row': '1 / -1' };
    return gridCellStyle(tpl(), 0);
  };

  return (
    <div
      id="charts-grid-area"
      class="charts-grid-area"
      data-layout={ui.layout}
      classList={{
        'multi-grid': isMulti(),
        'dense-grid': tpl().count >= 9,
        'split-2x1': ui.layout === '2x1',
        'split-2x2': ui.layout === '2x2',
      }}
      style={gridContainerStyle(tpl())}
    >
      <div
        class="chart-stack"
        classList={{ 'slot-active': isMulti() && ui.activeSlot === 0 }}
        data-slot="0"
        style={mainCellCss()}
        onMouseDown={() => setActiveSlot(0)}
      >
        <div
          class="main-chart-wrap"
          classList={{ 'script-picking': !!scriptPickTarget() }}
          id="main-chart-wrap"
          ref={wrapEl}
          onClick={(e) => {
            if (!scriptPickTarget()) return;
            if ((e.target as HTMLElement | null)?.closest?.('#script-pick-banner, .ohlc-legend, button, input, select')) return;
            const r = wrapEl.getBoundingClientRect();
            const time = rt.chart?.xToTime(e.clientX - r.left) ?? null;
            const price = rt.chart?.yToPrice(e.clientY - r.top) ?? null;
            applyScriptChartPick(time, price);
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            openCtxAt(e.clientX, e.clientY, e.target);
          }}
          onTouchStart={(e) => {
            if (e.touches.length === 1 && ui.tool === 'cursor') lp.start(e.touches[0].clientX, e.touches[0].clientY);
            else lp.end();
          }}
          onTouchMove={(e) => {
            if (e.touches.length !== 1) lp.end();
            else lp.move(e.touches[0].clientX, e.touches[0].clientY);
          }}
          onTouchEnd={() => lp.end()}
          onTouchCancel={() => lp.end()}
        >
          <Legend />
          <Show when={isMulti()}>
            <button
              class="main-slot-max-btn"
              data-slot-max="0"
              title={ui.maximizedSlot === 0 ? tt("Izgaraya dön (Alt+Enter)") : tt("Grafiği büyüt (Alt+Enter)")}
              onClick={(e) => {
                e.stopPropagation();
                toggleMaximizeSlot(0);
              }}
            >
              {ui.maximizedSlot === 0 ? '⤡' : '⤢'}
            </button>
          </Show>
          <Show when={scriptPickTarget()}>
            {(t) => (
              <div id="script-pick-banner" class="script-pick-banner">
                <span>{tt("🎯 Grafikte tıklayarak")}{' '}<strong>{t().inputTitle}</strong>{' '}{tt("seçin")}</span>
                <button
                  id="btn-cancel-script-pick"
                  class="btn-secondary"
                  style={{ padding: '2px 8px' }}
                  onClick={(e) => {
                    e.stopPropagation();
                    cancelScriptChartPick();
                  }}
                >
                  {tt("İptal")}
                </button>
              </div>
            )}
          </Show>
          <Show when={ui.zoomMode}>
            <div
              id="zoom-box-overlay"
              class="zoom-box-overlay"
              onMouseDown={(e) => {
                const r = wrapEl.getBoundingClientRect();
                const x = e.clientX - r.left;
                setZoomDrag({ startX: x, curX: x });
              }}
              onMouseMove={(e) => {
                const d = zoomDrag();
                if (!d) return;
                const r = wrapEl.getBoundingClientRect();
                setZoomDrag({ ...d, curX: e.clientX - r.left });
              }}
              onMouseUp={() => {
                const d = zoomDrag();
                setZoomDrag(null);
                if (d && Math.abs(d.curX - d.startX) > 12) {
                  rt.chart?.zoomToPixelRange(d.startX, d.curX);
                }
                setZoomMode(false);
              }}
            >
              <Show when={zoomDrag()}>
                {(d) => (
                  <div
                    class="zoom-box-selection"
                    style={{
                      left: `${Math.min(d().startX, d().curX)}px`,
                      width: `${Math.abs(d().curX - d().startX)}px`,
                    }}
                  />
                )}
              </Show>
            </div>
          </Show>
          <Show when={loadError()}>
            <div class="chart-error" role="alert">
              <strong>⚠ {t('leg.loadError')}</strong>
              <span>{loadError()}</span>
              <Show when={loadErrorUnofficial()}>
                <button
                  id="btn-open-sources-settings"
                  class="btn-primary"
                  style={{ 'margin-top': '8px', 'align-self': 'flex-start' }}
                  onClick={() => {
                    setSettingsTab('sources');
                    setUi('modal', 'settings');
                  }}
                >
                  🌐 {t('cfg.sources.openBtn')}
                </button>
              </Show>
            </div>
          </Show>
          <Show when={loading() && !loadError()}>
            <div class="chart-loading">{t('leg.loading')}</div>
          </Show>
          <div id="main-chart-canvas" class="main-chart-canvas" ref={mainEl} />
        </div>
      </div>
      <For each={Array.from({ length: secondaryCount(ui.layout) }, (_, i) => i)}>{(i) => <SecondaryPane index={i} />}</For>
      <PaneMenu />
    </div>
  );
}

const SIDE_LABEL: Record<ScaleSide, string> = { right: tt("Sağ ölçek"), left: tt("Sol ölçek"), split: tt("Sağ + sol (ilk seri sağ)") };

/** Pane ⚙ menüsü: ölçek tarafı, karşılaştırma ölçeği, indeksli/kilit, pane taşı/büyüt/sil. */
export function PaneMenu(): JSX.Element {
  const m = () => paneMenu();
  const side = (): ScaleSide => (m()?.id === 'main' ? ui.mainScaleSide : ui.paneSides[m()?.id ?? ''] ?? 'right');
  const sides = (): ScaleSide[] => (m()?.id === 'main' ? ['right', 'left'] : ['right', 'left', 'split']);
  const close = () => setPaneMenu(null);
  const onDoc = (e: MouseEvent) => {
    if (!(e.target as HTMLElement).closest('#pane-menu, .pane-chrome')) close();
  };
  onMount(() => document.addEventListener('mousedown', onDoc));
  onCleanup(() => document.removeEventListener('mousedown', onDoc));
  const item = (label: string, id: string, onClick: () => void, active: () => boolean = () => false) => (
    <button id={id} class="pane-menu-item" classList={{ active: active() }} onClick={() => { onClick(); }}>
      <span class="pane-menu-check">{active() ? '✓' : ''}</span>
      {label}
    </button>
  );
  return (
    <Show when={m()}>
      {(pm) => (
        <div
          id="pane-menu"
          class="pane-menu"
          style={{ left: `${Math.min(pm().x, window.innerWidth - 230)}px`, top: `${pm().y + 6}px` }}
        >
          <For each={sides()}>{(s) => item(SIDE_LABEL[s], `pane-side-${s}`, () => setPaneSide(pm().id, s), () => side() === s)}</For>
          <Show when={pm().id === 'main'}>
            <div class="pane-menu-sep" />
            <div class="pane-menu-head">{tt("Karşılaştırma ölçeği")}</div>
            {item(tt("Ana ölçekle aynı"), 'pane-cmp-same', () => setCompareScale('same'), () => ui.compareScale === 'same')}
            {item(tt("Sol ölçek"), 'pane-cmp-left', () => setCompareScale('left'), () => ui.compareScale === 'left')}
            {item(tt("Kendi ölçeği (eksensiz)"), 'pane-cmp-own', () => setCompareScale('own'), () => ui.compareScale === 'own')}
            <div class="pane-menu-sep" />
            {item(tt("İndeksli (100'e)"), 'pane-indexed', () => toggleScale('indexed'), () => ui.scaleKind === 'indexed')}
            {item(tt("Ölçeği kilitle (fiyat/bar oranı)"), 'pane-lock', toggleScaleLock, () => ui.scaleLock)}
            {item(tt("Ters ölçek"), 'pane-invert', toggleInvertScale, () => ui.invertScale)}
          </Show>
          <Show when={pm().id.startsWith('study:')}>
            <div class="pane-menu-sep" />
            <div class="pane-menu-head">{tt("Bu paneldeki göstergeler")}</div>
            <For each={studiesInPane(pm().id)}>
              {(st) => (
                <div class="pane-menu-study" data-pane-study={st.uid}>
                  <span class="pane-menu-study-name">{studyShortTitle(st)}</span>
                  <button class="ind-action-btn" title={tt("Ayarlar")} data-pane-study-cfg={st.uid} onClick={() => { setStudySettings({ uid: st.uid, tab: 'inputs' }); close(); }}>⚙</button>
                  <button class="ind-action-btn" title={tt("Gizle/göster")} onClick={() => toggleStudyVisible(st.uid)}>{st.visible ? '👁' : '◌'}</button>
                  <button class="ind-action-btn" title={tt("Kaldır")} data-pane-study-remove={st.uid} onClick={() => removeStudy(st.uid)}>✕</button>
                </div>
              )}
            </For>
          </Show>
          <div class="pane-menu-sep" />
          {item(tt("Büyüt / geri al"), 'pane-menu-max', () => { rt.chart?.toggleMaximize(pm().id); close(); })}
          <Show when={pm().id !== 'main'}>
            {item(tt("Yukarı taşı"), 'pane-menu-up', () => { rt.chart?.movePaneBy(pm().id, -1); close(); })}
            {item(tt("Aşağı taşı"), 'pane-menu-down', () => { rt.chart?.movePaneBy(pm().id, 1); close(); })}
            {item(tt("Paneli kaldır"), 'pane-menu-close', () => {
              if (pm().id.startsWith('study:')) {
                removeStudiesInPane(pm().id);
                setPaneMenu(null);
              } else closePaneById(pm().id);
            })}
          </Show>
        </div>
      )}
    </Show>
  );
}
