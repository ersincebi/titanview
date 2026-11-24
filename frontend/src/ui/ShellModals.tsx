import { For, Show, createMemo, createSignal, onMount, type JSX } from 'solid-js';
import { lang, setLang, t, tt } from '../state/i18n';
import { desktopConfig } from '../desktop/bridge';
import { activeBackendMode } from '../desktop/remote';
import { rt } from '../state/runtime';
import { SHORTCUT_CATEGORIES, filterShortcuts, parseQuickInterval } from '../state/shortcuts';
import { copyChartLink, copySnapshotImage, downloadSnapshot, openSnapshotInNewTab } from '../state/snapshot';
import {
  activeChartSymbol,
  closeQuickInterval,
  openDrawerTab,
  openQuickSearch,
  setUi,
  setWorkbenchTab,
  switchColorTheme,
  switchSymbol,
  toast,
  ui,
} from '../state/store';
import { availableColorThemes, colorThemeId, theme, toggleTheme } from '../state/theme';
import { ICONS } from '../styles/icons';
import { Icon } from './Icon';
import { APP_NAME, LANG_NAME } from '../script/brand';
import { Modal } from './Modal';
import { setSettingsTab } from './Modals';

function todayIso(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Standart "Go to" modalı (Alt+G & alt çubuk takvim ikonu): tek tarih veya özel tarih aralığı. */
export function GoToDateModal(): JSX.Element {
  const [mode, setMode] = createSignal<'date' | 'range'>('date');
  const [dateStr, setDateStr] = createSignal(todayIso());
  const [timeStr, setTimeStr] = createSignal('09:30');
  const [fromDate, setFromDate] = createSignal(new Date(Date.now() - 30 * 86400 * 1000).toISOString().slice(0, 10));
  const [toDate, setToDate] = createSignal(todayIso());
  const close = () => setUi('modal', null);

  const jump = () => {
    if (mode() === 'date') {
      const ts = Math.floor(new Date(`${dateStr()}T${timeStr() || '00:00'}:00`).getTime() / 1000);
      if (Number.isFinite(ts) && ts > 0) {
        rt.chart?.focusTime(ts);
        toast(lang() === 'en' ? `Jumped to ${dateStr()}` : `${dateStr()} tarihine gidildi`);
        close();
      }
      return;
    }
    const f = Math.floor(new Date(`${fromDate()}T00:00:00`).getTime() / 1000);
    const to = Math.floor(new Date(`${toDate()}T23:59:59`).getTime() / 1000);
    if (Number.isFinite(f) && Number.isFinite(to) && to > f) {
      rt.chart?.jumpToTimeRange(f, to);
      toast(lang() === 'en' ? `Range: ${fromDate()} → ${toDate()}` : `Aralık: ${fromDate()} → ${toDate()}`);
      close();
    }
  };

  return (
    <Modal id="modal-goto" title={t('goto.title')} width="380px">
      <div class="tv-modal-body" style={{ padding: '14px 18px', gap: '12px' }}>
        <div class="goto-tabs">
          <button
            class="chip-btn"
            classList={{ active: mode() === 'date' }}
            data-goto-tab="date"
            onClick={() => setMode('date')}
          >
            {t('goto.tabDate')}
          </button>
          <button
            class="chip-btn"
            classList={{ active: mode() === 'range' }}
            data-goto-tab="range"
            onClick={() => setMode('range')}
          >
            {t('goto.tabRange')}
          </button>
        </div>

        <Show
          when={mode() === 'date'}
          fallback={
            <div class="goto-grid">
              <label class="goto-field">
                <span>{t('goto.from')}</span>
                <input
                  id="inp-goto-from"
                  type="date"
                  class="script-select"
                  value={fromDate()}
                  onInput={(e) => setFromDate(e.currentTarget.value)}
                />
              </label>
              <label class="goto-field">
                <span>{t('goto.to')}</span>
                <input
                  id="inp-goto-to"
                  type="date"
                  class="script-select"
                  value={toDate()}
                  onInput={(e) => setToDate(e.currentTarget.value)}
                />
              </label>
            </div>
          }
        >
          <div class="goto-grid">
            <label class="goto-field">
              <span>{t('goto.date')}</span>
              <input
                id="inp-goto-date"
                type="date"
                class="script-select"
                value={dateStr()}
                onInput={(e) => setDateStr(e.currentTarget.value)}
              />
            </label>
            <label class="goto-field">
              <span>{t('goto.time')}</span>
              <input
                id="inp-goto-time"
                type="time"
                class="script-select"
                value={timeStr()}
                onInput={(e) => setTimeStr(e.currentTarget.value)}
              />
            </label>
          </div>
        </Show>

        <div class="modal-footer-right">
          <button class="btn-secondary" onClick={close}>{t('cfg.cancel')}</button>
          <button id="btn-goto-submit" class="btn-primary" onClick={jump}>{t('goto.go')}</button>
        </div>
      </div>
    </Modal>
  );
}

/** Standart Klavye Kısayolları penceresi (`?` veya Ana Menü): 7 kategoride aranabilir ~82 kısayol. */
export function ShortcutsModal(): JSX.Element {
  let inp!: HTMLInputElement;
  const [q, setQ] = createSignal('');
  onMount(() => setTimeout(() => inp?.focus(), 0));

  const filtered = createMemo(() => filterShortcuts(q(), lang()));
  const byCategory = createMemo(() => {
    const list = filtered();
    return SHORTCUT_CATEGORIES.map((cat) => ({
      cat,
      items: list.filter((s) => s.category === cat.id),
    })).filter((g) => g.items.length > 0);
  });

  return (
    <Modal id="modal-shortcuts" title={`${t('shortcuts.title')} (${filtered().length})`} width="760px">
      <div class="tv-modal-body shortcuts-modal-body">
        <div class="shortcuts-search-bar">
          <input
            id="inp-shortcuts-search"
            ref={inp}
            class="wl-search-input"
            style={{ width: '100%', height: '34px' }}
            placeholder={t('shortcuts.search')}
            value={q()}
            onInput={(e) => setQ(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                setUi('modal', null);
                return;
              }
              e.stopPropagation();
            }}
          />
        </div>
        <div class="shortcuts-grid">
          <For each={byCategory()}>
            {(grp) => (
              <div class="shortcuts-section" data-sc-cat={grp.cat.id}>
                <div class="shortcuts-cat-title">{lang() === 'en' ? grp.cat.titleEn : grp.cat.titleTr}</div>
                <For each={grp.items}>
                  {(sc) => (
                    <div class="shortcut-row" data-sc-id={sc.id}>
                      <span class="shortcut-desc">{lang() === 'en' ? sc.labelEn : sc.labelTr}</span>
                      <span class="shortcut-keys">
                        <For each={sc.keys}>{(k) => <kbd class="kbd-cap">{k}</kbd>}</For>
                      </span>
                    </div>
                  )}
                </For>
              </div>
            )}
          </For>
        </div>
      </div>
    </Modal>
  );
}

/** Standart rakam (`0-9`) veya virgül (`,`) basınca açılan Hızlı Zaman Aralığı Değiştirici. */
export function QuickIntervalPopup(): JSX.Element {
  let inp!: HTMLInputElement;
  const resolved = createMemo(() => parseQuickInterval(ui.quickIntervalText));

  const submit = () => {
    const tf = resolved();
    closeQuickInterval();
    if (tf) void switchSymbol(activeChartSymbol(), tf);
  };

  return (
    <Show when={ui.quickIntervalOpen}>
      <div id="quick-interval-backdrop" class="tv-modal-backdrop" onClick={(e) => e.target === e.currentTarget && closeQuickInterval()}>
        <div id="quick-interval-pop" class="tv-modal quick-interval-modal" style={{ width: '320px' }}>
          <div class="tv-modal-header" style={{ padding: '12px 16px 8px', 'font-size': '15px' }}>
            <span>{t('qint.title')}</span>
            <button class="icon-btn" aria-label={t('close')} onClick={closeQuickInterval}>
              <Icon svg={ICONS.close} />
            </button>
          </div>
          <div class="tv-modal-body" style={{ padding: '8px 16px 14px', gap: '8px' }}>
            <input
              id="inp-quick-interval"
              ref={(el) => {
                inp = el;
                setTimeout(() => {
                  inp?.focus();
                  inp?.setSelectionRange(inp.value.length, inp.value.length);
                }, 0);
              }}
              class="wl-search-input"
              style={{ height: '38px', 'font-size': '16px', 'text-align': 'center', 'font-weight': '600' }}
              value={ui.quickIntervalText}
              onInput={(e) => setUi('quickIntervalText', e.currentTarget.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') {
                  e.preventDefault();
                  submit();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  closeQuickInterval();
                }
              }}
            />
            <div class="term-hint" style={{ 'text-align': 'center' }}>
              {resolved() ? `→ ${resolved()}` : t('qint.hint')}
            </div>
          </div>
        </div>
      </div>
    </Show>
  );
}

/** Standart sol üst Burger Ana Menüsü: Dil (TR/EN), Renk Teması, Kısayollar, Ayarlar, Hakkında. */
export function MainMenuPopover(): JSX.Element {
  const close = () => setUi('menu', null);
  return (
    <Show when={ui.menu === 'mainMenu'}>
      <div
        id="dropdown-main-menu"
        class="tool-flyout main-menu-pop open"
        style={{ position: 'fixed', left: '6px', top: '42px', width: '252px' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div class="main-menu-brand">
          <span class="main-menu-brand-left">
            <span class="brand-emblem" innerHTML={ICONS.titanLogo} />
            <strong>{APP_NAME}</strong>
          </span>
          <span class="term-hint">{LANG_NAME}</span>
        </div>
        <div class="flyout-sep" />

        {/* Dil seçici TR / EN */}
        <div class="main-menu-row">
          <span>🌐 {t('menu.language')}</span>
          <div class="seg-inline">
            <button
              id="btn-lang-tr"
              class="chip-btn"
              classList={{ active: lang() === 'tr' }}
              onClick={() => setLang('tr')}
            >
              TR
            </button>
            <button
              id="btn-lang-en"
              class="chip-btn"
              classList={{ active: lang() === 'en' }}
              onClick={() => setLang('en')}
            >
              EN
            </button>
          </div>
        </div>

        {/* Tema seçici */}
        <div class="main-menu-row">
          <span>🎨 {t('menu.colorTheme')}</span>
          <select
            id="sel-main-theme"
            class="script-select"
            style={{ 'max-width': '130px', 'font-size': '11px' }}
            value={colorThemeId()}
            onChange={(e) => switchColorTheme(e.currentTarget.value)}
          >
            <For each={availableColorThemes()}>
              {(th) => <option value={th.id}>{lang() === 'en' ? th.nameEn : th.nameTr}</option>}
            </For>
          </select>
        </div>

        <button
          class="tool-flyout-item"
          id="menu-toggle-darklight"
          onClick={() => {
            toggleTheme();
            close();
          }}
        >
          <span>{theme() === 'dark' ? '☀' : '☾'} {t('menu.darkLight')}</span>
          <span class="flyout-hint">Alt+D</span>
        </button>

        <div class="flyout-sep" />
        <button
          class="tool-flyout-item"
          id="menu-quick-search"
          onClick={() => {
            close();
            openQuickSearch('quick');
          }}
        >
          <span>🔍 {t('menu.quickSearch')}</span>
          <span class="flyout-hint">⌘K</span>
        </button>
        <button
          class="tool-flyout-item"
          id="menu-goto-date"
          onClick={() => {
            close();
            setUi('modal', 'goto');
          }}
        >
          <span>📅 {t('menu.goToDate')}</span>
          <span class="flyout-hint">Alt+G</span>
        </button>
        <button
          class="tool-flyout-item"
          id="menu-chart-settings"
          onClick={() => {
            close();
            setSettingsTab('canvas');
            setUi('modal', 'settings');
          }}
        >
          <span>⚙ {t('menu.settings')}</span>
          <span class="flyout-hint">⌘,</span>
        </button>
        <button
          class="tool-flyout-item"
          id="menu-data-sources"
          onClick={() => {
            close();
            setSettingsTab('sources');
            setUi('modal', 'settings');
          }}
        >
          <span>🌐 {t('cfg.tab.sources')}</span>
        </button>
        <Show when={desktopConfig() !== null}>
          <button
            class="tool-flyout-item"
            id="menu-server"
            onClick={() => {
              close();
              setUi('modal', 'server');
            }}
          >
            <span>🖧 {tt('Sunucu')}</span>
            <span class="flyout-hint">{activeBackendMode() === 'remote' ? tt('uzak') : tt('yerel')}</span>
          </button>
        </Show>
        <button
          class="tool-flyout-item"
          id="menu-shortcuts"
          onClick={() => {
            close();
            setUi('modal', 'shortcuts');
          }}
        >
          <span>⌨ {t('menu.shortcuts')}</span>
          <span class="flyout-hint">?</span>
        </button>
        <div class="flyout-sep" />
        <button
          class="tool-flyout-item"
          id="menu-about"
          onClick={() => {
            close();
            setUi('modal', 'about');
          }}
        >
          <span>ℹ {t('menu.about')}</span>
        </button>
      </div>
    </Show>
  );
}

/** Standart Kamera / Ekran Görüntüsü açılır menüsü: İndir, Panoya Kopyala, Bağlantı Kopyala, Yeni Sekmede Aç. */
export function SnapshotMenu(): JSX.Element {
  const close = () => setUi('menu', null);
  return (
    <Show when={ui.menu === 'snapshot'}>
      <div
        id="dropdown-snapshot"
        class="tool-flyout open"
        style={{
          position: 'fixed',
          left: `${Math.max(8, Math.min(ui.menuPos.left - 190, window.innerWidth - 284))}px`,
          top: `${ui.menuPos.top}px`,
          width: '276px',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          id="btn-snap-download"
          class="tool-flyout-item"
          onClick={() => {
            close();
            downloadSnapshot();
          }}
        >
          <span>⬇ {t('snap.download')}</span>
          <span class="flyout-hint">Alt+S</span>
        </button>
        <button
          id="btn-snap-copy"
          class="tool-flyout-item"
          onClick={() => {
            close();
            void copySnapshotImage();
          }}
        >
          <span>📋 {t('snap.copyImage')}</span>
          <span class="flyout-hint">⌘Alt+S</span>
        </button>
        <button
          id="btn-snap-link"
          class="tool-flyout-item"
          onClick={() => {
            close();
            void copyChartLink();
          }}
        >
          <span>🔗 {t('snap.copyLink')}</span>
        </button>
        <button
          id="btn-snap-open"
          class="tool-flyout-item"
          onClick={() => {
            close();
            openSnapshotInNewTab();
          }}
        >
          <span>↗ {t('snap.openTab')}</span>
        </button>
      </div>
    </Show>
  );
}

/** Standart Mobil "Daha" Alt Sayfası (Bottom Sheet): paneller, ayarlar, dil, tema, ekran görüntüsü, kısayollar. */
export function MobileMoreSheet(): JSX.Element {
  const close = () => setUi('modal', null);
  const go = (fn: () => void) => {
    close();
    fn();
  };
  return (
    <Show when={ui.modal === 'mobileMore'}>
      <div id="modal-mobile-more" class="tv-modal-backdrop mobile-sheet-backdrop" onClick={(e) => e.target === e.currentTarget && close()}>
        <div class="mobile-bottom-sheet">
          <div class="mobile-sheet-handle" />
          <div class="mobile-sheet-head">
            <strong>{t('mob.more')}</strong>
            <button class="icon-btn" aria-label={t('close')} onClick={close}>
              <Icon svg={ICONS.close} />
            </button>
          </div>
          <div class="mobile-sheet-grid">
            <button class="mobile-sheet-tile" onClick={() => go(() => openDrawerTab('alerts'))}>⏰ {t('drawer.alerts')}</button>
            <button class="mobile-sheet-tile" onClick={() => go(() => openDrawerTab('orderpanel'))}>⚡ {t('drawer.orderpanel')}</button>
            <button class="mobile-sheet-tile" onClick={() => go(() => setWorkbenchTab('screener'))}>🔎 {t('wb.screener')}</button>
            <button class="mobile-sheet-tile" onClick={() => go(() => setWorkbenchTab('script'))}>⚔ {t('wb.script')}</button>
            <button class="mobile-sheet-tile" onClick={() => go(() => openDrawerTab('objecttree'))}>🌳 {t('drawer.objecttree')}</button>
            <button class="mobile-sheet-tile" onClick={() => go(() => setUi('modal', 'goto'))}>📅 {t('goto.title')}</button>
            <button class="mobile-sheet-tile" onClick={() => go(() => { setSettingsTab('canvas'); setUi('modal', 'settings'); })}>⚙ {t('cfg.title')}</button>
            <button class="mobile-sheet-tile" onClick={() => go(() => setUi('modal', 'shortcuts'))}>⌨ {t('shortcuts.title')}</button>
            <button class="mobile-sheet-tile" onClick={() => go(() => void downloadSnapshot())}>📸 {t('snap.download')}</button>
            <button class="mobile-sheet-tile" onClick={() => go(() => void copyChartLink())}>🔗 {t('snap.copyLink')}</button>
            <button class="mobile-sheet-tile" onClick={() => go(() => toggleTheme())}>
              {theme() === 'dark' ? '☀' : '☾'} {t('menu.darkLight')}
            </button>
            <button class="mobile-sheet-tile" onClick={() => go(() => setLang(lang() === 'tr' ? 'en' : 'tr'))}>
              🌐 {lang() === 'tr' ? 'English (EN)' : 'Türkçe (TR)'}
            </button>
          </div>
        </div>
      </div>
    </Show>
  );
}
