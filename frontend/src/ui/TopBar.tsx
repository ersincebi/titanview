import { tfmt, lang, t, toggleLang, tt } from '../state/i18n';
import { For, Show, createSignal, type JSX } from 'solid-js';
import { openPriceAlert } from '../state/alertStore';
import {
  INTERVAL_GROUPS,
  UNIT_LABELS_TR,
  intervalLabelEn,
  intervalLabelTr,
  sortIntervals,
  tvIntervalLabel,
  type IntervalUnit,
} from '../state/format';
import { canRedo, canUndo, peekRedo, peekUndo } from '../state/history';
import { getLayoutTemplate, layoutIconSvg } from '../state/layout';
import { rt } from '../state/runtime';
import { activeLayoutName, layoutDirty, layoutIsShared, readOnlyLayout } from '../state/savedLayouts';
import {
  activeChartInterval,
  activeChartSymbol,
  addCustomTimeframe,
  openQuickSearch,
  redoAction,
  removeCustomTimeframe,
  saveLayout,
  setChartStyle,
  setUi,
  switchSymbol,
  toggleCompare,
  toggleFavTimeframe,
  toggleReplay,
  toggleSimpleMode,
  ui,
  undoAction,
} from '../state/store';
import { theme, toggleTheme } from '../state/theme';
import { ICONS } from '../styles/icons';
import type { ChartStyleMode, Timeframe } from '../types/market';
import { Icon } from './Icon';
import { FavoriteIndicatorsMenu } from './Indicators';
import { setSettingsTab } from './Modals';

export const STYLE_ITEMS: Array<{ mode: ChartStyleMode; label: string; labelEn: string; icon: keyof typeof ICONS; group: number }> = [
  { mode: 'bar', label: tt("Çubuklar"), labelEn: 'Bars', icon: 'bars', group: 0 },
  { mode: 'candles', label: 'Mumlar', labelEn: 'Candles', icon: 'candles', group: 0 },
  { mode: 'hollow', label: tt("İçi boş mumlar"), labelEn: 'Hollow candles', icon: 'hollow', group: 0 },
  { mode: 'volcandles', label: tt("Hacim mumları"), labelEn: 'Volume candles', icon: 'volcandles', group: 0 },
  { mode: 'line', label: tt("Çizgi"), labelEn: 'Line', icon: 'line', group: 1 },
  { mode: 'linemarkers', label: tt("İşaretli çizgi"), labelEn: 'Line with markers', icon: 'linemarkers', group: 1 },
  { mode: 'stepline', label: tt("Basamak çizgisi"), labelEn: 'Step line', icon: 'stepline', group: 1 },
  { mode: 'area', label: 'Alan', labelEn: 'Area', icon: 'area', group: 2 },
  { mode: 'hlcarea', label: tt("HLC alanı"), labelEn: 'HLC area', icon: 'hlcarea', group: 2 },
  { mode: 'baseline', label: tt("Taban çizgisi"), labelEn: 'Baseline', icon: 'baseline', group: 2 },
  { mode: 'columns', label: tt("Sütunlar"), labelEn: 'Columns', icon: 'columns', group: 3 },
  { mode: 'highlow', label: tt("Yüksek-düşük"), labelEn: 'High-low', icon: 'highlow', group: 3 },
  { mode: 'footprint', label: 'Hacim footprint', labelEn: 'Volume footprint', icon: 'footprint', group: 4 },
  { mode: 'tpo', label: 'TPO', labelEn: 'Time price opportunity', icon: 'tpo', group: 4 },
  { mode: 'svp', label: 'Seans hacim profili', labelEn: 'Session volume profile', icon: 'svp', group: 4 },
  { mode: 'heikin', label: 'Heikin Ashi', labelEn: 'Heikin Ashi', icon: 'heikin', group: 5 },
  { mode: 'renko', label: 'Renko', labelEn: 'Renko', icon: 'renko', group: 5 },
  { mode: 'linebreak', label: tt("Çizgi kırılımı"), labelEn: 'Line break', icon: 'linebreak', group: 5 },
  { mode: 'kagi', label: 'Kagi', labelEn: 'Kagi', icon: 'kagi', group: 5 },
  { mode: 'pnf', label: tt("Nokta ve şekil"), labelEn: 'Point & figure', icon: 'pnf', group: 5 },
  { mode: 'range', label: 'Range', labelEn: 'Range', icon: 'rangebars', group: 5 },
];

const UNIT_LABELS_EN: Record<IntervalUnit, string> = {
  s: 'Seconds',
  m: 'Minutes',
  h: 'Hours',
  d: 'Days',
  w: 'Weeks',
  M: 'Months',
};

const GROUP_LABELS_EN: Record<string, string> = {
  seconds: 'SECONDS',
  minutes: 'MINUTES',
  hours: 'HOURS',
  days: 'DAYS / WEEKS / MONTHS',
};

/** Üst çubukta yıldızlı favoriler (+ aktif hücrenin aralığı favori değilse); tamamı ▾ menüsünde. */
export function shownTimeframes(): Timeframe[] {
  const favs = ui.favTimeframes.length ? ui.favTimeframes : ['15m', '4h'];
  const cur = activeChartInterval();
  return favs.includes(cur) ? [...favs] : sortIntervals([...favs, cur]);
}

function openMenu(kind: 'tf' | 'style' | 'layoutGrid' | 'layoutManage' | 'mainMenu' | 'snapshot', e: MouseEvent) {
  e.stopPropagation();
  if (ui.menu === kind) {
    setUi('menu', null);
    return;
  }
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  setUi('menuPos', { left: rect.left, top: rect.bottom + 4 });
  setUi('menu', kind);
}

export function TopBar(): JSX.Element {
  const [favMenu, setFavMenu] = createSignal(false);
  const curTpl = () => getLayoutTemplate(ui.layout);
  const en = () => lang() === 'en';

  const undoTitle = () => {
    const nxt = peekUndo();
    if (!nxt) return t('top.undo');
    return en() ? `Undo: ${nxt.labelEn} (⌘Z)` : `Geri Al: ${nxt.labelTr} (⌘Z)`;
  };
  const redoTitle = () => {
    const nxt = peekRedo();
    if (!nxt) return t('top.redo');
    return en() ? `Redo: ${nxt.labelEn} (⌘Y)` : `Yinele: ${nxt.labelTr} (⌘Y)`;
  };

  return (
    <header class="titan-topbar">
      <div class="topbar-left">
        <button
          id="btn-top-burger"
          class="burger-btn"
          classList={{ active: ui.menu === 'mainMenu' }}
          title={t('top.menu')}
          onClick={(e) => openMenu('mainMenu', e)}
        >
          <Icon svg={ICONS.titanLogo} />
        </button>

        <button
          id="btn-symbol-current"
          class="symbol-trigger-btn"
          title={t('top.symbolSearch')}
          onClick={() => openQuickSearch('symbol')}
        >
          <span id="lbl-top-symbol">{activeChartSymbol().replace(/\.IS$/, '')}</span>
        </button>

        <button
          id="btn-compare-symbol"
          class="tv-btn"
          classList={{ active: !!ui.compareSymbol }}
          title={t('top.compare')}
          onClick={toggleCompare}
        >
          <Icon svg={ICONS.plus} />
        </button>

        <div class="topbar-divider" />

        <div class="tf-group" id="tf-group">
          <For each={shownTimeframes()}>
            {(tf) => (
              <button
                class="tf-btn"
                classList={{ active: activeChartInterval() === tf }}
                data-tf={tf}
                onClick={() => void switchSymbol(activeChartSymbol(), tf)}
              >
                {tvIntervalLabel(tf)}
              </button>
            )}
          </For>
          <button
            id="btn-tf-dropdown"
            class="tf-btn"
            classList={{ active: ui.menu === 'tf' }}
            title={t('top.allTimeframes')}
            onClick={(e) => openMenu('tf', e)}
          >
            <Icon svg={ICONS.chevronDown} />
          </button>
        </div>

        <div class="topbar-divider" />

        <button
          id="btn-chart-style-trigger"
          class="tv-btn"
          title={t('top.chartStyle')}
          onClick={(e) => openMenu('style', e)}
        >
          <span id="ico-active-style">
            <Icon svg={ICONS[STYLE_ITEMS.find((s) => s.mode === ui.chartStyle)?.icon ?? 'candles']} />
          </span>
        </button>

        <div class="topbar-divider" />

        <button
          id="btn-open-fx-modal"
          class="fx-btn"
          title={t('top.indicatorsTitle')}
          onClick={() => setUi('modal', 'fx')}
        >
          <Icon svg={ICONS.fx} />
          <span>{t('top.indicators')}</span>
        </button>

        <span class="fav-ind-wrap">
          <button id="btn-fav-indicators" class="icon-btn" title={t('top.favIndicators')} onClick={() => setFavMenu(!favMenu())}>
            ★
          </button>
          <Show when={favMenu()}>
            <FavoriteIndicatorsMenu onClose={() => setFavMenu(false)} />
          </Show>
        </span>
        <button id="btn-templates-modal" class="icon-btn" title={t('top.templates')} onClick={() => setUi('modal', 'templates')}>
          <Icon svg={ICONS.templates} />
        </button>

        <button id="btn-add-alert-top" class="tv-btn" title={t('top.alertTitle')} onClick={() => openPriceAlert()}>
          <Icon svg={ICONS.alert} />
          <span>{t('top.alert')}</span>
        </button>

        <button
          id="btn-replay-toggle"
          class="tv-btn"
          classList={{ active: ui.replayActive }}
          title={t('top.replayTitle')}
          onClick={toggleReplay}
        >
          <Icon svg={ICONS.replay} />
          <span id="lbl-replay-txt">{ui.replayActive ? t('top.replayStop') : t('top.replay')}</span>
        </button>

        <div class="topbar-divider" />

        <button
          id="btn-undo"
          class="icon-btn"
          classList={{ 'is-muted': !canUndo() }}
          title={undoTitle()}
          onClick={() => void undoAction()}
        >
          <Icon svg={ICONS.undo} />
        </button>
        <button
          id="btn-redo"
          class="icon-btn"
          classList={{ 'is-muted': !canRedo() }}
          title={redoTitle()}
          onClick={() => void redoAction()}
        >
          <Icon svg={ICONS.redo} />
        </button>
      </div>

      <div class="topbar-right">
        <button
          id="btn-split-layout"
          class="icon-btn layout-picker-btn"
          classList={{ active: ui.layout !== 'single' || ui.menu === 'layoutGrid' }}
          title={tfmt("{0} ({1})", en() ? 'Layout' : 'Düzen', curTpl().label)}
          onClick={(e) => openMenu('layoutGrid', e)}
        >
          <span class="layout-picker-ico" innerHTML={layoutIconSvg(curTpl(), 18)} />
          <Show when={curTpl().count > 1}>
            <span class="layout-count-badge">{curTpl().count}</span>
          </Show>
        </button>

        <div class="layout-save-split" id="layout-save-split">
          <button
            id="btn-save-layout"
            class="tv-btn layout-save-btn"
            classList={{ dirty: layoutDirty() && !readOnlyLayout() }}
            title={t('top.layoutSave')}
            onClick={saveLayout}
          >
            <Icon svg={ICONS.cloud} />
            <span id="lbl-layout-name" class="layout-name-txt">
              {activeLayoutName()}
            </span>
            <Show when={layoutIsShared()}>
              <span class="layout-shared-dot" title={en() ? 'Read-only sharing enabled' : 'Salt-okur paylaşım açık'}>🔗</span>
            </Show>
          </button>
          <button
            id="btn-layout-menu"
            class="tv-btn layout-caret-btn"
            classList={{ active: ui.menu === 'layoutManage' }}
            title={t('top.layoutManage')}
            onClick={(e) => openMenu('layoutManage', e)}
          >
            <Icon svg={ICONS.chevronDown} />
          </button>
        </div>

        <button
          id="btn-quick-search"
          class="icon-btn"
          title={t('top.quickSearch')}
          onClick={() => openQuickSearch('quick')}
        >
          <Icon svg={ICONS.search} />
        </button>

        <button
          id="btn-simple-mode"
          class="tv-btn simple-toggle"
          classList={{ active: ui.simple }}
          title={ui.simple ? t('top.simpleOnTitle') : t('top.simpleOffTitle')}
          aria-pressed={ui.simple}
          onClick={toggleSimpleMode}
        >
          <span>{ui.simple ? t('top.simpleMode') : t('top.proMode')}</span>
        </button>

        <button
          id="btn-chart-settings"
          class="icon-btn"
          title={t('top.settings')}
          onClick={() => {
            setSettingsTab('symbol');
            setUi('modal', 'settings');
          }}
        >
          <Icon svg={ICONS.gear} />
        </button>

        <button
          id="btn-fullscreen"
          class="icon-btn"
          title={t('top.fullscreen')}
          onClick={() => {
            if (!document.fullscreenElement) void document.documentElement.requestFullscreen?.();
            else void document.exitFullscreen?.();
          }}
        >
          <Icon svg={ICONS.fullscreen} />
        </button>

        <button
          id="btn-snapshot"
          class="icon-btn"
          classList={{ active: ui.menu === 'snapshot' }}
          title={t('top.snapshot')}
          onClick={(e) => openMenu('snapshot', e)}
        >
          <Icon svg={ICONS.camera} />
        </button>

        <button
          id="btn-lang-toggle"
          class="tv-btn lang-toggle-btn"
          title={t('top.langTitle')}
          onClick={toggleLang}
        >
          {lang().toUpperCase()}
        </button>

        <button
          id="btn-theme-toggle"
          class="icon-btn"
          title={theme() === 'dark' ? t('top.themeToLight') : t('top.themeToDark')}
          aria-label={tt("Tema")}
          onClick={toggleTheme}
        >
          <span style={{ 'font-size': '16px', 'line-height': '1' }}>{theme() === 'dark' ? '☀' : '☾'}</span>
        </button>

        <button
          id="btn-publish-action"
          class="btn-trade"
          title={t('top.tradeTitle')}
          onClick={() => {
            setUi('drawerTab', 'orderpanel');
            setTimeout(() => rt.chart?.resize(), 60);
          }}
        >
          {t('top.trade')}
        </button>
      </div>
    </header>
  );
}

const CUSTOM_UNITS: IntervalUnit[] = ['s', 'm', 'h', 'd', 'w', 'M'];

export function TimeframeMenu(): JSX.Element {
  const [val, setVal] = createSignal('7');
  const [unit, setUnit] = createSignal<IntervalUnit>('s');
  const en = () => lang() === 'en';

  const pick = (tf: Timeframe) => {
    setUi('menu', null);
    void switchSymbol(activeChartSymbol(), tf);
  };

  const addCustom = () => {
    const n = Number(val());
    const added = addCustomTimeframe(n, unit());
    if (added) pick(added);
  };

  return (
    <div
      id="dropdown-timeframes"
      class="tool-flyout tf-dropdown-menu"
      classList={{ open: ui.menu === 'tf' }}
      style={{ position: 'fixed', left: `${ui.menuPos.left}px`, top: `${ui.menuPos.top}px` }}
      onClick={(e) => e.stopPropagation()}
    >
      <div class="tf-groups-scroll">
        <For each={INTERVAL_GROUPS}>
          {(grp) => (
            <div class="tf-section" data-tf-group={grp.id}>
              <div class="tf-section-head">
                <span>{en() ? (GROUP_LABELS_EN[grp.id] ?? grp.label) : grp.label}</span>
                <Show when={grp.hint}>
                  <span class="tf-section-hint">{grp.hint}</span>
                </Show>
              </div>
              <For each={grp.items}>
                {(tf) => (
                  <div class="tf-drop-row" classList={{ active: activeChartInterval() === tf }}>
                    <button class="tool-flyout-item grow" data-tf-drop={tf} onClick={() => pick(tf)}>
                      <span>{en() ? intervalLabelEn(tf) : intervalLabelTr(tf)}</span>
                      <span class="flyout-hint">{tvIntervalLabel(tf)}</span>
                    </button>
                    <button
                      class="tf-star-btn"
                      classList={{ starred: ui.favTimeframes.includes(tf) }}
                      data-tf-fav={tf}
                      title={en() ? 'Pin to toolbar' : 'Üst çubuğa sabitle'}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleFavTimeframe(tf);
                      }}
                    >
                      {ui.favTimeframes.includes(tf) ? '★' : '☆'}
                    </button>
                  </div>
                )}
              </For>
            </div>
          )}
        </For>

        <Show when={ui.customTimeframes.length > 0}>
          <div class="tf-section" data-tf-group="custom">
            <div class="tf-section-head">
              <span>{t('top.customIntervals')}</span>
            </div>
            <For each={ui.customTimeframes}>
              {(tf) => (
                <div class="tf-drop-row" classList={{ active: activeChartInterval() === tf }}>
                  <button class="tool-flyout-item grow" data-tf-drop={tf} onClick={() => pick(tf)}>
                    <span>{en() ? intervalLabelEn(tf) : intervalLabelTr(tf)}</span>
                    <span class="flyout-hint">{tvIntervalLabel(tf)}</span>
                  </button>
                  <button
                    class="tf-star-btn"
                    classList={{ starred: ui.favTimeframes.includes(tf) }}
                    data-tf-fav={tf}
                    title={en() ? 'Pin to toolbar' : 'Üst çubuğa sabitle'}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleFavTimeframe(tf);
                    }}
                  >
                    {ui.favTimeframes.includes(tf) ? '★' : '☆'}
                  </button>
                  <button
                    class="tf-del-btn"
                    data-tf-del={tf}
                    title={en() ? 'Remove custom interval' : 'Özel aralığı sil'}
                    onClick={(e) => {
                      e.stopPropagation();
                      removeCustomTimeframe(tf);
                    }}
                  >
                    ✕
                  </button>
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>

      <div class="flyout-sep" />
      <div class="tf-custom-add" id="tf-custom-add">
        <div class="tf-section-head">
          <span>{t('top.addCustomInterval')}</span>
        </div>
        <div class="tf-custom-row">
          <input
            id="inp-custom-tf-val"
            class="script-select tf-custom-num"
            type="number"
            min="1"
            max="365"
            value={val()}
            onInput={(e) => setVal(e.currentTarget.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') addCustom();
            }}
          />
          <select
            id="sel-custom-tf-unit"
            class="script-select grow"
            value={unit()}
            onChange={(e) => setUnit(e.currentTarget.value as IntervalUnit)}
          >
            <For each={CUSTOM_UNITS}>{(u) => <option value={u}>{en() ? UNIT_LABELS_EN[u] : UNIT_LABELS_TR[u]}</option>}</For>
          </select>
          <button id="btn-add-custom-tf" class="btn-secondary" onClick={addCustom}>
            {t('top.add')}
          </button>
        </div>
      </div>
    </div>
  );
}

export function StyleMenu(): JSX.Element {
  const en = () => lang() === 'en';
  return (
    <div
      id="dropdown-chart-styles"
      class="tool-flyout"
      classList={{ open: ui.menu === 'style' }}
      style={{ position: 'fixed', left: `${ui.menuPos.left}px`, top: `${ui.menuPos.top}px` }}
    >
      <For each={STYLE_ITEMS}>
        {(s, i) => (
          <>
            <Show when={i() > 0 && STYLE_ITEMS[i() - 1].group !== s.group}>
              <div class="flyout-sep" />
            </Show>
            <button
              class="tool-flyout-item"
              classList={{ active: ui.chartStyle === s.mode }}
              data-style={s.mode}
              onClick={() => {
                setChartStyle(s.mode);
                setUi('menu', null);
              }}
            >
              <Icon svg={ICONS[s.icon]} /> <span>{en() ? s.labelEn : s.label}</span>
            </button>
          </>
        )}
      </For>
      <div class="flyout-sep" />
      <button
        class="tool-flyout-item"
        id="btn-style-settings"
        onClick={() => {
          setUi('menu', null);
          setSettingsTab('symbol');
          setUi('modal', 'settings');
        }}
      >
        <Icon svg={ICONS.gear} /> <span>{t('top.styleSettings')}</span>
      </button>
    </div>
  );
}
