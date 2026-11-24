import { Show, type JSX } from 'solid-js';
import { openDrawingAlert, openPriceAlert, openStudyAlert } from '../state/alertStore';
import { cloneChartSettings } from '../state/chartSettings';
import { lang, t } from '../state/i18n';
import { rt } from '../state/runtime';
import {
  addHLineAt,
  applyChartSettingsAll,
  copySelectedDrawing,
  ctxMenu,
  deleteSelectedDrawing,
  duplicateSelectedDrawing,
  openDrawerTab,
  openQuickSearch,
  pasteCopiedDrawing,
  reorderDrawingById,
  setCtxMenu,
  setMainScaleSide,
  setScale,
  setUi,
  toast,
  toggleIndicator,
  toggleInvertScale,
  toggleScale,
  toggleScaleLock,
  ui,
} from '../state/store';
import {
  duplicateStudy,
  moveStudyPane,
  removeStudy,
  setStudySettings,
  studyById,
  toggleStudyVisible,
  updateStudy,
} from '../state/studies';
import { showView } from '../state/terminalStore';
import { ALERTABLE_TOOLS } from '../state/alerts';
import { addSymbolToWatchlist } from '../state/watchlistStore';
import { setSettingsTab } from './Modals';

/**
 * Faz 29: 5 bağlam sağ-tık menüsü
 * (chart ~296px, scale ~255px, drawing ~245px, study ~245px, series ~255px).
 * Satır yüksekliği 32px, ayırıcı 13px, sağa hizalı klavye kısayolu ipuçları.
 */
export function ContextMenu(): JSX.Element {
  const close = () => setCtxMenu(null);
  const price = () => ctxMenu()?.price ?? null;
  const priceText = () => (price() !== null ? price()!.toFixed(price()! >= 100 ? 2 : 4) : '—');

  const item = (
    label: string,
    run: () => void,
    id: string,
    opts: { disabled?: boolean; shortcut?: string; checked?: boolean; danger?: boolean } = {}
  ) => (
    <button
      id={id}
      class="ctx-item"
      classList={{ 'ctx-danger': !!opts.danger, 'ctx-checked': !!opts.checked }}
      disabled={opts.disabled}
      onClick={() => {
        run();
        close();
      }}
    >
      <span class="ctx-item-check">{opts.checked ? '✓' : ''}</span>
      <span class="ctx-item-label">{label}</span>
      <Show when={opts.shortcut}>
        <span class="ctx-item-kbd">{opts.shortcut}</span>
      </Show>
    </button>
  );

  const toggleScaleFlag = (key: 'showCountdown' | 'showHighLowLines' | 'showLastPriceLine') => {
    const next = cloneChartSettings(ui.chartSettings);
    next.scales[key] = !next.scales[key];
    applyChartSettingsAll(next, false);
  };

  return (
    <Show when={ctxMenu()}>
      {(m) => {
        const kind = () => m().kind ?? 'chart';
        const menuW = () => (kind() === 'chart' ? 316 : kind() === 'scale' ? 286 : 260);
        const estH = () => (kind() === 'chart' ? 520 : kind() === 'scale' ? 430 : 380);
        const drawing = () => (m().drawingId ? rt.overlay?.findDrawingById(m().drawingId!) ?? null : null);
        const study = () => (m().studyUid ? studyById(m().studyUid!) ?? null : null);

        return (
          <div
            id="chart-ctx-menu"
            class="chart-ctx-menu"
            data-ctx-kind={kind()}
            style={{
              width: `${menuW()}px`,
              left: `${Math.max(6, Math.min(m().x, window.innerWidth - menuW() - 8))}px`,
              top: `${Math.max(6, Math.min(m().y, window.innerHeight - estH() - 8))}px`,
            }}
          >
            {/* 1. CHART CONTEXT MENU (~296px) */}
            <Show when={kind() === 'chart'}>
              {item(
                t('ctx.addAlertAt', { sym: ui.symbol, price: priceText() }),
                () => price() !== null && openPriceAlert(price()!),
                'ctx-alert',
                { disabled: price() === null, shortcut: 'Alt+A' }
              )}
              {item(
                t('ctx.addOrderAt', { sym: ui.symbol, price: priceText() }),
                () => openDrawerTab('orderpanel'),
                'ctx-order',
                { disabled: price() === null, shortcut: 'Shift+T' }
              )}
              {item(
                t('ctx.addHLine', { price: priceText() }),
                () => price() !== null && m().time !== null && addHLineAt(price()!, m().time!),
                'ctx-hline',
                { disabled: price() === null || m().time === null, shortcut: 'Alt+H' }
              )}
              {item(
                t('ctx.copyPrice', { price: priceText() }),
                () => {
                  void navigator.clipboard?.writeText(priceText()).then(
                    () => toast(lang() === 'en' ? `Copied: ${priceText()}` : `Kopyalandı: ${priceText()}`),
                    () => toast(lang() === 'en' ? 'Clipboard unavailable' : 'Panoya yazılamadı')
                  );
                },
                'ctx-copy',
                { disabled: price() === null }
              )}
              {item(
                t('ctx.pasteDrawing'),
                () => void pasteCopiedDrawing(),
                'ctx-paste',
                { disabled: !rt.overlay?.hasClipboard(), shortcut: '⌘V' }
              )}
              <div class="ctx-sep" />
              {item(t('ctx.addIndicator'), () => setUi('modal', 'fx'), 'ctx-fx', { shortcut: '/' })}
              {item(t('ctx.symbolInfo'), () => showView('des'), 'ctx-info')}
              {item(t('ctx.goToDate'), () => setUi('modal', 'goto'), 'ctx-goto', { shortcut: 'Alt+G' })}
              <div class="ctx-sep" />
              {item(t('ctx.fit'), () => rt.chart?.fitContent(), 'ctx-fit', { shortcut: 'Alt+R' })}
              {item(ui.invertScale ? t('ctx.invertOff') : t('ctx.invertOn'), toggleInvertScale, 'ctx-invert', {
                checked: ui.invertScale,
                shortcut: 'Alt+I',
              })}
              {item(ui.hideDrawings ? t('ctx.showDrawings') : t('ctx.hideDrawings'), () => setUi('hideDrawings', !ui.hideDrawings), 'ctx-hide', {
                checked: ui.hideDrawings,
                shortcut: '⌘Alt+H',
              })}
              {item(t('ctx.objectTree'), () => openDrawerTab('objecttree'), 'ctx-objtree')}
              <div class="ctx-sep" />
              {item(
                t('ctx.addWatchlist', { sym: ui.symbol }),
                () => void addSymbolToWatchlist(ui.symbol),
                'ctx-add-wl',
                { shortcut: 'Alt+W' }
              )}
              {item(
                t('ctx.addNote', { sym: ui.symbol }),
                () => openDrawerTab('notes'),
                'ctx-add-note'
              )}
              {item(t('ctx.settings'), () => { setSettingsTab('symbol'); setUi('modal', 'settings'); }, 'ctx-settings', { shortcut: '⌘,' })}
            </Show>

            {/* 2. PRICE SCALE CONTEXT MENU (~256px) */}
            <Show when={kind() === 'scale'}>
              {item(t('ctx.scale.auto'), () => setScale('normal'), 'ctx-scale-auto', {
                checked: ui.scaleKind === 'normal',
                shortcut: 'Alt+R',
              })}
              {item(t('ctx.scale.lock'), toggleScaleLock, 'ctx-scale-lock', {
                checked: ui.scaleLock,
                shortcut: 'Alt+K',
              })}
              {item(t('ctx.scale.invert'), toggleInvertScale, 'ctx-scale-invert', {
                checked: ui.invertScale,
                shortcut: 'Alt+I',
              })}
              <div class="ctx-sep" />
              {item(t('ctx.scale.regular'), () => setScale('normal'), 'ctx-scale-regular', {
                checked: ui.scaleKind === 'normal',
              })}
              {item(t('ctx.scale.percent'), () => toggleScale('percent'), 'ctx-scale-percent', {
                checked: ui.scaleKind === 'percent',
                shortcut: 'Alt+P',
              })}
              {item(t('ctx.scale.indexed'), () => toggleScale('indexed'), 'ctx-scale-indexed', {
                checked: ui.scaleKind === 'indexed',
                shortcut: 'Alt+O',
              })}
              {item(t('ctx.scale.log'), () => toggleScale('log'), 'ctx-scale-log', {
                checked: ui.scaleKind === 'log',
                shortcut: 'Alt+L',
              })}
              <div class="ctx-sep" />
              {item(
                ui.mainScaleSide === 'right' ? t('ctx.scale.moveLeft') : t('ctx.scale.moveRight'),
                () => setMainScaleSide(ui.mainScaleSide === 'right' ? 'left' : 'right'),
                'ctx-scale-side'
              )}
              <div class="ctx-sep" />
              {item(t('ctx.scale.countdown'), () => toggleScaleFlag('showCountdown'), 'ctx-scale-countdown', {
                checked: ui.chartSettings.scales.showCountdown,
              })}
              {item(t('ctx.scale.highLow'), () => toggleScaleFlag('showHighLowLines'), 'ctx-scale-highlow', {
                checked: ui.chartSettings.scales.showHighLowLines,
              })}
              {item(t('ctx.scale.lastLine'), () => toggleScaleFlag('showLastPriceLine'), 'ctx-scale-lastline', {
                checked: ui.chartSettings.scales.showLastPriceLine,
              })}
              <div class="ctx-sep" />
              {item(t('ctx.scale.more'), () => { setSettingsTab('scales'); setUi('modal', 'settings'); }, 'ctx-scale-more')}
            </Show>

            {/* 3. DRAWING CONTEXT MENU */}
            <Show when={kind() === 'drawing'}>
              {item(t('ctx.draw.settings'), () => { if (m().drawingId) rt.overlay?.selectDrawing(m().drawingId!); }, 'ctx-draw-cfg')}
              {item(t('ctx.draw.clone'), () => { if (m().drawingId) rt.overlay?.selectDrawing(m().drawingId!); duplicateSelectedDrawing(); }, 'ctx-draw-clone', { shortcut: '⌘D' })}
              {item(t('ctx.draw.copy'), () => void copySelectedDrawing(m().drawingId), 'ctx-draw-copy', { shortcut: '⌘C' })}
              {item(
                drawing()?.locked ? t('ctx.draw.unlock') : t('ctx.draw.lock'),
                () => {
                  if (!m().drawingId) return;
                  rt.overlay?.selectDrawing(m().drawingId!);
                  void rt.overlay?.updateSelectedDrawing({ locked: !drawing()?.locked });
                },
                'ctx-draw-lock'
              )}
              {item(
                drawing()?.hidden ? t('ctx.draw.show') : t('ctx.draw.hide'),
                () => {
                  if (!m().drawingId) return;
                  rt.overlay?.selectDrawing(m().drawingId!);
                  void rt.overlay?.updateSelectedDrawing({ hidden: !drawing()?.hidden });
                },
                'ctx-draw-hide'
              )}
              <div class="ctx-sep" />
              {item(t('ctx.draw.front'), () => m().drawingId && reorderDrawingById(m().drawingId!, 'front'), 'ctx-draw-front')}
              {item(t('ctx.draw.forward'), () => m().drawingId && reorderDrawingById(m().drawingId!, 'forward'), 'ctx-draw-forward')}
              {item(t('ctx.draw.backward'), () => m().drawingId && reorderDrawingById(m().drawingId!, 'backward'), 'ctx-draw-backward')}
              {item(t('ctx.draw.back'), () => m().drawingId && reorderDrawingById(m().drawingId!, 'back'), 'ctx-draw-back')}
              <Show when={drawing() && ALERTABLE_TOOLS.has(drawing()!.toolType)}>
                <div class="ctx-sep" />
                {item(t('ctx.draw.alert'), () => drawing() && openDrawingAlert(drawing()!), 'ctx-draw-alert')}
              </Show>
              <div class="ctx-sep" />
              {item(
                t('ctx.draw.remove'),
                () => {
                  if (m().drawingId) rt.overlay?.selectDrawing(m().drawingId!);
                  deleteSelectedDrawing();
                },
                'ctx-draw-del',
                { danger: true, shortcut: 'Del' }
              )}
            </Show>

            {/* 4. STUDY / INDICATOR CONTEXT MENU */}
            <Show when={kind() === 'study'}>
              <Show
                when={study()}
                fallback={
                  <Show when={m().quickKey}>
                    {(qk) => (
                      <>
                        {item(t('ctx.study.settings'), () => setUi('modal', 'fx'), 'ctx-quick-cfg')}
                        {item(t('ctx.study.remove'), () => toggleIndicator(qk()), 'ctx-quick-del', { danger: true })}
                      </>
                    )}
                  </Show>
                }
              >
                {(st) => (
                  <>
                    {item(t('ctx.study.settings'), () => setStudySettings({ uid: st().uid, tab: 'inputs' }), 'ctx-study-cfg')}
                    {item(t('ctx.study.alert'), () => openStudyAlert(st().uid), 'ctx-study-alert')}
                    {item(st().visible ? t('ctx.study.hide') : t('ctx.study.show'), () => toggleStudyVisible(st().uid), 'ctx-study-vis')}
                    {item(t('ctx.study.duplicate'), () => void duplicateStudy(st().uid), 'ctx-study-dup')}
                    <div class="ctx-sep" />
                    {item(t('ctx.study.moveMain'), () => moveStudyPane(st().uid, 'main'), 'ctx-study-main')}
                    {item(t('ctx.study.moveNew'), () => moveStudyPane(st().uid, 'new'), 'ctx-study-new')}
                    <div class="ctx-sep" />
                    {item(t('ctx.study.pinRight'), () => updateStudy(st().uid, { scale: 'right' }), 'ctx-study-right', { checked: st().scale === 'right' })}
                    {item(t('ctx.study.pinLeft'), () => updateStudy(st().uid, { scale: 'left' }), 'ctx-study-left', { checked: st().scale === 'left' })}
                    {item(t('ctx.study.pinNone'), () => updateStudy(st().uid, { scale: 'none' }), 'ctx-study-none', { checked: st().scale === 'none' })}
                    <div class="ctx-sep" />
                    {item(t('ctx.study.remove'), () => removeStudy(st().uid), 'ctx-study-del', { danger: true })}
                  </>
                )}
              </Show>
            </Show>

            {/* 5. MAIN SYMBOL SERIES CONTEXT MENU */}
            <Show when={kind() === 'series'}>
              {item(t('ctx.series.settings'), () => { setSettingsTab('symbol'); setUi('modal', 'settings'); }, 'ctx-series-cfg')}
              {item(t('ctx.series.change'), () => openQuickSearch('symbol'), 'ctx-series-change', { shortcut: '⌘K' })}
              {item(t('ctx.series.compare'), () => setUi('modal', 'compare'), 'ctx-series-compare')}
              {item(t('ctx.series.info'), () => showView('des'), 'ctx-series-info')}
              <div class="ctx-sep" />
              {item(t('ctx.series.alert'), () => openPriceAlert(), 'ctx-series-alert', { shortcut: 'Alt+A' })}
              {item(t('ctx.series.reset'), () => rt.chart?.fitContent(), 'ctx-series-reset', { shortcut: 'Alt+R' })}
            </Show>
          </div>
        );
      }}
    </Show>
  );
}
