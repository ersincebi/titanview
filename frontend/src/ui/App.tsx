import { Show, createEffect, createSignal, on, onCleanup, onMount, type JSX } from 'solid-js';
import { openPriceAlert } from '../state/alertStore';
import { scheduleAnalysis } from '../state/analysisStore';
import { lang, t, toggleLang, tt } from '../state/i18n';
import { rt } from '../state/runtime';
import { ALT_DIGIT_INTERVALS, ALT_SHIFT_DRAWINGS, ALT_SHORTCUTS, isTypingTarget } from '../state/shortcuts';
import { copySnapshotImage, downloadSnapshot } from '../state/snapshot';
import {
  applyViewport,
  closeQuickInterval,
  copySelectedDrawing,
  cycleActiveSlot,
  cycleWatchlistSymbol,
  deleteSelectedDrawing,
  duplicateSelectedDrawing,
  openDrawerTab,
  openQuickInterval,
  openQuickSearch,
  pasteCopiedDrawing,
  redoAction,
  saveLayout,
  scheduleResize,
  setCtxMenu,
  setLayoutGrid,
  setMagnetMode,
  setTool,
  setUi,
  setWorkbenchTab,
  setZoomMode,
  switchSymbol,
  toastMsg,
  toggleAllDrawingsLocked,
  toggleInvertScale,
  toggleMaximizeSlot,
  toggleReplay,
  toggleScale,
  toggleScaleLock,
  toggleSimpleMode,
  ui,
  undoAction,
} from '../state/store';
import { applyTheme, toggleTheme } from '../state/theme';
import { quickOrder } from '../state/tradingStore';
import { addSymbolToWatchlist } from '../state/watchlistStore';
import { AxisFooter } from './AxisFooter';
import { ChartGrid, DrawingPropsBar } from './ChartArea';
import { ContextMenu } from './ContextMenu';
import { DockStrip, Drawer } from './Drawer';
import { LayoutGridMenu, LayoutManageMenu, ReadOnlyBanner } from './LayoutMenus';
import { FavToolsBar, LeftBar } from './LeftBar';
import { Modals, setSettingsTab } from './Modals';
import { ReplayBar } from './ReplayBar';
import { MainMenuPopover, SnapshotMenu } from './ShellModals';
import { StyleMenu, TimeframeMenu, TopBar } from './TopBar';
import { Workbench } from './Workbench';

export function handleGlobalKey(ev: KeyboardEvent): void {
  const mod = ev.metaKey || ev.ctrlKey;
  const key = ev.key.toLowerCase();
  const typing = isTypingTarget();

  // ---- Escape her zaman çalışır ----
  if (ev.key === 'Escape') {
    rt.overlay?.selectDrawing(null);
    setCtxMenu(null);
    if (ui.zoomMode) setZoomMode(false);
    if (ui.quickIntervalOpen) closeQuickInterval();
    if (ui.tool !== 'cursor') setTool('cursor');
    setUi('modal', null);
    setUi('menu', null);
    return;
  }

  // ---- Modifier (⌘ / Ctrl) küresel kısayolları ----
  if (mod && !ev.altKey && key === 'k') {
    ev.preventDefault();
    if (ui.modal === 'search') setUi('modal', null);
    else openQuickSearch('quick');
    return;
  }
  if (((mod && key === '/') || (ev.key === '`' && !mod && !typing)) && !ui.simple) {
    ev.preventDefault();
    setUi('modal', ui.modal === 'command' ? null : 'command');
    return;
  }
  if (mod && !ev.altKey && key === 's') {
    ev.preventDefault();
    saveLayout();
    return;
  }
  if (mod && !ev.altKey && ev.key === ',') {
    ev.preventDefault();
    setSettingsTab('canvas');
    setUi('modal', ui.modal === 'settings' ? null : 'settings');
    return;
  }
  if (mod && ev.altKey && !typing) {
    if (ev.code === 'KeyS') {
      ev.preventDefault();
      void copySnapshotImage();
      return;
    }
    if (ev.code === 'KeyH') {
      ev.preventDefault();
      setUi('hideDrawings', !ui.hideDrawings);
      return;
    }
    if (ev.code === 'KeyL') {
      ev.preventDefault();
      toggleAllDrawingsLocked();
      return;
    }
  }

  if (typing) return;

  // ---- Geri Al / Yinele (tüm kabuk) ----
  if (mod && !ev.shiftKey && !ev.altKey && key === 'z') {
    ev.preventDefault();
    undoAction();
    return;
  }
  if (((mod && key === 'y') || (mod && ev.shiftKey && key === 'z')) && !ev.altKey) {
    ev.preventDefault();
    redoAction();
    return;
  }

  // ---- Çizim Kopyala / Yapıştır / Çoğalt ----
  if (mod && !ev.altKey && key === 'd' && rt.overlay?.getSelectedDrawing()) {
    ev.preventDefault();
    duplicateSelectedDrawing();
    return;
  }
  if (mod && !ev.altKey && key === 'c' && rt.overlay?.getSelectedDrawing()) {
    ev.preventDefault();
    copySelectedDrawing();
    return;
  }
  if (mod && !ev.altKey && key === 'v' && rt.overlay?.hasClipboard()) {
    ev.preventDefault();
    pasteCopiedDrawing();
    return;
  }

  // ---- ⌘ + Ok tuşları: başa/sona git ve yakınlaştır/uzaklaştır ----
  if (mod && !ev.altKey) {
    if (ev.key === 'ArrowLeft') { ev.preventDefault(); rt.chart?.jumpToStart(); return; }
    if (ev.key === 'ArrowRight') { ev.preventDefault(); rt.chart?.jumpToEnd(); return; }
    if (ev.key === 'ArrowUp') { ev.preventDefault(); rt.chart?.zoomBy(1.35); return; }
    if (ev.key === 'ArrowDown') { ev.preventDefault(); rt.chart?.zoomBy(0.74); return; }
  }

  // ---- Alt + Shift + tuşlar ----
  if (ev.altKey && ev.shiftKey && !mod) {
    if (ALT_SHIFT_DRAWINGS[ev.code]) {
      ev.preventDefault();
      setTool(ALT_SHIFT_DRAWINGS[ev.code]);
      return;
    }
    if (ev.code === 'Digit1') { ev.preventDefault(); setLayoutGrid('single'); return; }
    if (ev.code === 'Digit2') { ev.preventDefault(); setLayoutGrid('2x1'); return; }
    if (ev.code === 'Digit3') { ev.preventDefault(); setLayoutGrid('1x2'); return; }
    if (ev.code === 'Digit4') { ev.preventDefault(); setLayoutGrid('2x2'); return; }
    if (ev.code === 'KeyO') { ev.preventDefault(); setUi('modal', 'compare'); return; }
    if (ev.code === 'KeyK') { ev.preventDefault(); setWorkbenchTab('script'); return; }
    if (ev.code === 'KeyB') { ev.preventDefault(); setWorkbenchTab('screener'); return; }
    if (ev.code === 'KeyJ') { ev.preventDefault(); openDrawerTab('objecttree'); return; }
    if (ev.code === 'KeyD') { ev.preventDefault(); openDrawerTab('datawindow'); return; }
    if (ev.code === 'KeyZ') { ev.preventDefault(); setUi('drawerTab', ui.drawerTab ? null : 'watchlist'); scheduleResize(60); return; }
    if (ev.code === 'KeyU') { ev.preventDefault(); void addSymbolToWatchlist(ui.symbol); return; }
    if (ev.code === 'KeyY') { ev.preventDefault(); toggleLang(); return; }
  }

  // ---- Alt + tuşlar ----
  if (ev.altKey && !ev.shiftKey && !mod) {
    if (ev.key === 'Enter') { ev.preventDefault(); toggleMaximizeSlot(); return; }
    if (ev.code === 'KeyA') { ev.preventDefault(); openPriceAlert(); return; }
    if (ev.code === 'KeyG') { ev.preventDefault(); setUi('modal', 'goto'); return; }
    if (ev.code === 'KeyI') { ev.preventDefault(); toggleInvertScale(); return; }
    if (ev.code === 'KeyL') { ev.preventDefault(); toggleScale('log'); return; }
    if (ev.code === 'KeyP') { ev.preventDefault(); toggleScale('percent'); return; }
    if (ev.code === 'KeyO') { ev.preventDefault(); toggleScale('indexed'); return; }
    if (ev.code === 'KeyK') { ev.preventDefault(); toggleScaleLock(); return; }
    if (ev.code === 'KeyS') { ev.preventDefault(); downloadSnapshot(); return; }
    if (ev.code === 'KeyZ') { ev.preventDefault(); setZoomMode(!ui.zoomMode); return; }
    if (ev.code === 'KeyD') { ev.preventDefault(); toggleTheme(); return; }
    if (ev.code === 'KeyX') { ev.preventDefault(); toggleSimpleMode(); return; }
    if (ev.code === 'KeyW') { ev.preventDefault(); openDrawerTab('watchlist'); return; }
    if (ev.code === 'KeyM') {
      ev.preventDefault();
      if (!ui.magnet) setMagnetMode('weak');
      else if (ui.magnetMode === 'weak') setMagnetMode('strong');
      else setUi('magnet', false);
      return;
    }
    if (ALT_DIGIT_INTERVALS[ev.code]) {
      ev.preventDefault();
      void switchSymbol(ui.symbol, ALT_DIGIT_INTERVALS[ev.code]);
      return;
    }
    if (ALT_SHORTCUTS[ev.code]) {
      ev.preventDefault();
      const action = ALT_SHORTCUTS[ev.code];
      if (action === 'fit') rt.chart?.fitContent();
      else setTool(action);
      return;
    }
  }

  // ---- Sil / Taslak bitir ----
  if ((ev.key === 'Delete' || ev.key === 'Backspace') && !mod && rt.overlay?.getSelectedDrawing()) {
    ev.preventDefault();
    deleteSelectedDrawing();
    return;
  }
  if (ev.key === 'Enter' && !mod && !ev.altKey && rt.overlay?.finishDraft()) {
    ev.preventDefault();
    return;
  }

  // Modal açıksa alttaki tek-tuş kısayollarını yutma
  if (ui.modal || ui.quickIntervalOpen) return;

  // ---- Shift + tek tuş kısayolları (İşlem, Replay, Tam ekran, Kaydırma) ----
  if (ev.shiftKey && !mod && !ev.altKey) {
    if (ev.key === '?') { ev.preventDefault(); setUi('modal', 'shortcuts'); return; }
    if (ev.key === 'ArrowLeft') { ev.preventDefault(); rt.chart?.scrollBars(-10); return; }
    if (ev.key === 'ArrowRight') { ev.preventDefault(); rt.chart?.scrollBars(10); return; }
    if (ev.key === 'ArrowDown' && ui.replayActive) { ev.preventDefault(); rt.replay?.step(); return; }
    if (ev.key === ' ') { ev.preventDefault(); cycleWatchlistSymbol(-1); return; }
    if (ev.key === 'Tab') { ev.preventDefault(); cycleActiveSlot(-1); return; }
    if (ev.code === 'KeyF') {
      ev.preventDefault();
      if (!document.fullscreenElement) void document.documentElement.requestFullscreen?.();
      else void document.exitFullscreen?.();
      return;
    }
    if (ev.code === 'KeyT') { ev.preventDefault(); openDrawerTab('orderpanel'); return; }
    if (ev.code === 'KeyB') { ev.preventDefault(); void quickOrder('buy', ui.quickQty > 0 ? ui.quickQty : 1); return; }
    if (ev.code === 'KeyS') { ev.preventDefault(); void quickOrder('sell', ui.quickQty > 0 ? ui.quickQty : 1); return; }
    if (ev.code === 'KeyP') { ev.preventDefault(); setWorkbenchTab('paper'); return; }
    if (ev.code === 'KeyR') { ev.preventDefault(); toggleReplay(); return; }
  }

  // ---- Tek tuş gezinme / Standart kısayolları ----
  if (!mod && !ev.altKey && !ev.shiftKey) {
    if (ev.key === '?') { ev.preventDefault(); setUi('modal', 'shortcuts'); return; }
    if (ev.key === '/') { ev.preventDefault(); setUi('modal', 'fx'); return; }
    if (ev.key === ',') { ev.preventDefault(); openQuickInterval(''); return; }
    if (ev.key === 'Tab') { ev.preventDefault(); cycleActiveSlot(1); return; }
    if (ev.key === 'ArrowLeft') { ev.preventDefault(); rt.chart?.scrollBars(-1); return; }
    if (ev.key === 'ArrowRight') { ev.preventDefault(); rt.chart?.scrollBars(1); return; }
    if (ev.key === 'ArrowUp' || ev.key === '+' || ev.key === '=') { ev.preventDefault(); rt.chart?.zoomBy(1.25); return; }
    if (ev.key === 'ArrowDown' || ev.key === '-') { ev.preventDefault(); rt.chart?.zoomBy(0.8); return; }
    if (ev.key === 'PageUp') { ev.preventDefault(); rt.chart?.scrollPage(-1); return; }
    if (ev.key === 'PageDown') { ev.preventDefault(); rt.chart?.scrollPage(1); return; }
    if (ev.key === 'Home') { ev.preventDefault(); rt.chart?.jumpToStart(); return; }
    if (ev.key === 'End') { ev.preventDefault(); rt.chart?.jumpToEnd(); return; }
    if (ev.key === ' ') {
      ev.preventDefault();
      if (ui.replayActive && rt.replay) {
        if (rt.replay.isPlaying()) rt.replay.pause();
        else rt.replay.play();
      } else {
        cycleWatchlistSymbol(1);
      }
      return;
    }
    // Varsayılan: grafikte doğrudan rakam yazınca Hızlı Aralık değiştirici açılır
    if (/^[0-9]$/.test(ev.key)) {
      ev.preventDefault();
      openQuickInterval(ev.key);
      return;
    }
    // Varsayılan: grafikte doğrudan harf yazınca Sembol Arama o harfle açılır
    if (/^[a-zA-Z]$/.test(ev.key)) {
      ev.preventDefault();
      openQuickSearch('symbol', ev.key.toUpperCase());
      return;
    }
  }
}

export function App(): JSX.Element {
  const onClick = (e: MouseEvent) => {
    const tEl = e.target as HTMLElement;
    if (!tEl.closest('#chart-ctx-menu')) setCtxMenu(null);
    if (
      ui.menu &&
      !tEl.closest(
        '#btn-chart-style-trigger, #btn-tf-dropdown, #btn-split-layout, #btn-layout-menu, #btn-top-burger, #btn-snapshot, #btn-timezone-trigger, .tool-flyout'
      )
    ) {
      setUi('menu', null);
    }
  };
  const onResize = () => {
    applyViewport(window.innerWidth);
    scheduleResize(0);
  };
  const [sessionExpired, setSessionExpired] = createSignal(false);
  const onExpired = () => setSessionExpired(true);
  const onOnline = () => setUi('online', true);
  const onOffline = () => setUi('online', false);
  // Her sembol seçiminde sağ paneldeki analiz kendiliğinden yenilenir (250 ms sakinleşince)
  createEffect(on(() => [ui.symbol, ui.simple] as const, ([sym, simple]) => !simple && scheduleAnalysis(sym)));
  createEffect(() => {
    if (typeof document !== 'undefined') document.documentElement.lang = lang();
  });
  onMount(() => {
    window.addEventListener('keydown', handleGlobalKey);
    window.addEventListener('click', onClick);
    window.addEventListener('resize', onResize);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    window.addEventListener('tv-session-expired', onExpired);
    setUi('online', navigator.onLine !== false);
    applyViewport(window.innerWidth);
    applyTheme();
  });
  onCleanup(() => {
    window.removeEventListener('keydown', handleGlobalKey);
    window.removeEventListener('click', onClick);
    window.removeEventListener('resize', onResize);
    window.removeEventListener('online', onOnline);
    window.removeEventListener('offline', onOffline);
    window.removeEventListener('tv-session-expired', onExpired);
  });

  return (
    <div
      id="titan-shell"
      class="titan-shell"
      data-lang={lang()}
      classList={{
        'drawer-collapsed': ui.drawerTab === null,
        'is-mobile': ui.mobile,
        'tools-open': ui.toolsOpen,
        'wb-open': !ui.wbCollapsed,
        'simple-mode': ui.simple,
      }}
    >
      <Show when={!ui.online}>
        <div id="offline-banner" class="offline-banner" role="status">
          {t('banner.offline')}
        </div>
      </Show>
      <Show when={sessionExpired()}>
        <div id="session-banner" class="offline-banner" role="alert">
          {t('banner.session')}{' '}
          <button class="chip-btn" onClick={() => window.location.reload()}>{t('banner.sessionReload')}</button>{' '}
          <button id="btn-session-server" class="chip-btn" onClick={() => setUi('modal', 'server')}>{tt('Sunucu')}</button>
        </div>
      </Show>
      <ReadOnlyBanner />
      <TopBar />
      <LeftBar />
      <main class="titan-center">
        <DrawingPropsBar />
        <FavToolsBar />
        <ChartGrid />
        <ReplayBar />
        <AxisFooter />
        <Workbench />
      </main>
      <Drawer />
      <DockStrip />
      <Modals />
      <ContextMenu />
      <div id="titan-toast" class="titan-toast" classList={{ show: !!toastMsg() }}>
        {toastMsg()}
      </div>
      <TimeframeMenu />
      <StyleMenu />
      <LayoutGridMenu />
      <LayoutManageMenu />
      <MainMenuPopover />
      <SnapshotMenu />
      <Show when={false}>{null}</Show>
    </div>
  );
}
