// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BarReplay } from '../../chart/BarReplay';
import { clearHistory } from '../../state/history';
import { lang, setLang } from '../../state/i18n';
import { rt } from '../../state/runtime';
import {
  applyChartSettingsAll,
  redoAction,
  resetStore,
  setCandles,
  setChartStyle,
  setCtxMenu,
  setScale,
  setUi,
  toggleIndicator,
  ui,
  undoAction,
} from '../../state/store';
import { addStudy, clearStudies, studies } from '../../state/studies';
import { applyColorTheme, colorThemeId } from '../../state/theme';
import { handleGlobalKey } from '../App';
import { AxisFooter } from '../AxisFooter';
import { ContextMenu } from '../ContextMenu';
import { LeftBar } from '../LeftBar';
import { Modals } from '../Modals';
import { ReplayBar } from '../ReplayBar';
import { MainMenuPopover, SnapshotMenu } from '../ShellModals';
import { TopBar } from '../TopBar';

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

function mockChart() {
  return {
    fitContent: vi.fn(),
    focusTime: vi.fn(),
    jumpToTimeRange: vi.fn(),
    jumpToStart: vi.fn(),
    jumpToEnd: vi.fn(),
    scrollBars: vi.fn(),
    scrollPage: vi.fn(),
    zoomBy: vi.fn(),
    zoomToPixelRange: vi.fn(() => true),
    setInvertScale: vi.fn(),
    setPriceScaleKind: vi.fn(),
    setScaleLocked: vi.fn(),
    setHistoryData: vi.fn(),
    applyTheme: vi.fn(),
    applyChartSettings: vi.fn(),
    setEventOptions: vi.fn(),
    resize: vi.fn(),
    takeScreenshot: vi.fn(() => ({
      toDataURL: () => 'data:image/png;base64,AAAA',
      toBlob: (cb: (b: Blob | null) => void) => cb(new Blob(['x'], { type: 'image/png' })),
    })),
  };
}

function mockOverlay() {
  const drawings = [
    { id: 'd1', symbol: 'THYAO.IS', timeframe: '15m', toolType: 'trendline', points: [{ time: 1, price: 10 }, { time: 2, price: 20 }], color: '#0284C7', locked: false, hidden: false },
  ];
  let selId: string | null = 'd1';
  let clip = false;
  return {
    getDrawings: vi.fn(() => drawings),
    findDrawingById: vi.fn((id: string) => drawings.find((d) => d.id === id) ?? null),
    getSelectedDrawing: vi.fn(() => drawings.find((d) => d.id === selId) ?? null),
    selectDrawing: vi.fn((id: string | null) => { selId = id; }),
    duplicateSelected: vi.fn(() => ({ ...drawings[0], id: 'd2' })),
    copyDrawing: vi.fn(() => { clip = true; return drawings[0]; }),
    hasClipboard: vi.fn(() => clip),
    pasteDrawing: vi.fn(() => ({ ...drawings[0], id: 'd3' })),
    reorderDrawing: vi.fn(() => true),
    updateSelectedDrawing: vi.fn(async () => {}),
    deleteSelectedDrawing: vi.fn(async () => {}),
    setAllLocked: vi.fn(),
    finishDraft: vi.fn(() => null),
    undo: vi.fn(),
    redo: vi.fn(),
    render: vi.fn(),
  };
}

const memStore = (() => {
  let m = new Map<string, string>();
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
    clear: () => void (m = new Map()),
  };
})();
vi.stubGlobal('localStorage', memStore);

beforeEach(() => {
  localStorage.clear();
  clearHistory();
  clearStudies();
  setLang('tr');
  applyColorTheme('dark');
  resetStore();
  rt.chart = mockChart() as never;
  rt.overlay = mockOverlay() as never;
  setCandles(
    Array.from({ length: 30 }, (_, i) => ({
      time: 1_700_000_000 + i * 900,
      open: 100 + i,
      high: 102 + i,
      low: 99 + i,
      close: 101 + i,
      volume: 1000,
    }))
  );
});

afterEach(() => {
  cleanup();
  setLang('tr');
  applyColorTheme('dark');
});

describe('Faz 29 UI — 7 Sekmeli Ayarlar, Şablonlar ve Özel Renk Temaları', () => {
  it('renders all 7 Standart Settings tabs, edits values, saves templates & custom color themes, and applies', () => {
    setUi('modal', 'settings');
    render(() => <Modals />);
    const tabs = Array.from(document.querySelectorAll('[data-cfg-tab]')).map((e) => e.getAttribute('data-cfg-tab'));
    expect(tabs).toEqual(['symbol', 'status', 'scales', 'canvas', 'trading', 'alerts', 'events', 'sources']);

    // Tab 1: Symbol
    fireEvent.change($('#cfg-sym-precision'), { target: { value: '1000' } });
    fireEvent.change($('#cfg-sym-timezone'), { target: { value: 'UTC' } });
    fireEvent.change($('#cfg-sym-session'), { target: { value: 'extended' } });

    // Tab 2: Status line
    fireEvent.click($('[data-cfg-tab="status"]'));
    fireEvent.change($('#cfg-st-title-mode'), { target: { value: 'ticker' } });
    fireEvent.click($('#cfg-st-ohlc'));

    // Tab 3: Scales and lines
    fireEvent.click($('[data-cfg-tab="scales"]'));
    fireEvent.change($('#cfg-sc-placement'), { target: { value: 'left' } });
    fireEvent.click($('#cfg-sc-highlow'));
    fireEvent.click($('#cfg-sc-session-breaks'));
    fireEvent.change($('#cfg-sc-timefmt'), { target: { value: '12h' } });

    // Tab 4: Canvas + Custom Theme
    fireEvent.click($('[data-cfg-tab="canvas"]'));
    fireEvent.change($('#cfg-bg-mode'), { target: { value: 'gradient' } });
    fireEvent.click($('#cfg-cv-watermark'));
    fireEvent.change($('#cfg-cv-fontsize'), { target: { value: '14' } });
    fireEvent.input($('#inp-custom-theme-name'), { target: { value: 'Aurora' } });
    fireEvent.click($('#btn-save-custom-theme'));
    expect(document.querySelector('#cfg-theme-list')!.textContent).toContain('Aurora');

    // Tab 5: Trading
    fireEvent.click($('[data-cfg-tab="trading"]'));
    fireEvent.change($('#cfg-tr-pnl'), { target: { value: 'percent' } });

    // Tab 6: Alerts
    fireEvent.click($('[data-cfg-tab="alerts"]'));
    fireEvent.input($('#cfg-al-vol'), { target: { value: '45' } });
    fireEvent.click($('#cfg-al-activeonly'));

    // Tab 7: Events
    fireEvent.click($('[data-cfg-tab="events"]'));
    fireEvent.click($('#cfg-events-ebreaks'));

    // Footer Template dropdown: Save as + Apply defaults
    fireEvent.click($('#btn-cfg-template'));
    fireEvent.input($('#inp-cfg-tpl-name'), { target: { value: 'Benim Ayarım' } });
    fireEvent.click($('#btn-cfg-tpl-save'));
    expect(document.querySelector('#cfg-template-menu')!.textContent).toContain('Benim Ayarım');

    // Commit settings
    fireEvent.click($('#btn-save-settings'));
    expect(ui.modal).toBeNull();
    expect(ui.chartSettings.symbol.precision).toBe('1000');
    expect(ui.chartSettings.symbol.timezone).toBe('UTC');
    expect(ui.chartSettings.status.showOhlc).toBe(false);
    expect(ui.chartSettings.scales.placement).toBe('left');
    expect(ui.chartSettings.scales.showSessionBreaks).toBe(true);
    expect(ui.chartSettings.canvas.bgMode).toBe('gradient');
    expect(ui.chartSettings.canvas.scaleFontSize).toBe(14);
    expect(ui.chartSettings.trading.pnlMode).toBe('percent');
    expect(ui.chartSettings.alerts.soundVolume).toBe(45);
    expect(ui.chartSettings.events.earningsBreaks).toBe(true);
    expect((rt.chart as unknown as { applyChartSettings: ReturnType<typeof vi.fn> }).applyChartSettings).toHaveBeenCalled();
  });
});

describe('Faz 29 UI — 5 Bağlamlı Sağ Tık Menüleri', () => {
  it('renders and executes actions across Chart, Scale, Drawing, Study, and Series context menus', () => {
    render(() => <ContextMenu />);

    // 1. Chart menu
    setCtxMenu({ kind: 'chart', x: 120, y: 120, price: 295.5, time: 1_700_000_000 });
    expect($('#chart-ctx-menu').getAttribute('data-ctx-kind')).toBe('chart');
    expect($('#ctx-goto')).toBeTruthy();
    expect($('#ctx-settings')).toBeTruthy();
    fireEvent.click($('#ctx-goto'));
    expect(ui.modal).toBe('goto');

    // 2. Price Scale menu
    setCtxMenu({ kind: 'scale', x: 900, y: 200, price: 295.5, time: null });
    expect($('#chart-ctx-menu').getAttribute('data-ctx-kind')).toBe('scale');
    fireEvent.click($('#ctx-scale-log'));
    expect(ui.scaleKind).toBe('log');

    setCtxMenu({ kind: 'scale', x: 900, y: 200, price: 295.5, time: null });
    fireEvent.click($('#ctx-scale-highlow'));
    expect(ui.chartSettings.scales.showHighLowLines).toBe(true);

    // 3. Drawing menu
    setCtxMenu({ kind: 'drawing', x: 200, y: 200, price: 295.5, time: 1_700_000_000, drawingId: 'd1' });
    expect($('#chart-ctx-menu').getAttribute('data-ctx-kind')).toBe('drawing');
    fireEvent.click($('#ctx-draw-copy'));
    expect(rt.overlay!.copyDrawing).toHaveBeenCalledWith('d1');

    setCtxMenu({ kind: 'drawing', x: 200, y: 200, price: 295.5, time: 1_700_000_000, drawingId: 'd1' });
    fireEvent.click($('#ctx-draw-front'));
    expect(rt.overlay!.reorderDrawing).toHaveBeenCalledWith('d1', 'front');

    // 4. Study menu (quick indicator + script study)
    setCtxMenu({ kind: 'study', x: 100, y: 80, price: null, time: null, quickKey: 'bb' });
    expect($('#chart-ctx-menu').getAttribute('data-ctx-kind')).toBe('study');
    expect($('#ctx-quick-del')).toBeTruthy();

    const uid = addStudy({ builtinId: 'rsi' });
    expect(uid).toBeTruthy();
    setCtxMenu({ kind: 'study', x: 100, y: 80, price: null, time: null, studyUid: uid! });
    expect($('#ctx-study-pinRight') || $('#ctx-study-right')).toBeTruthy();
    fireEvent.click($('#ctx-study-del'));
    expect(studies.list).toHaveLength(0);

    // 5. Main Series menu
    setCtxMenu({ kind: 'series', x: 80, y: 30, price: null, time: null });
    expect($('#chart-ctx-menu').getAttribute('data-ctx-kind')).toBe('series');
    fireEvent.click($('#ctx-series-compare'));
    expect(ui.modal).toBe('compare');
  });
});

describe('Faz 29 UI — Tam Geri Al / Yinele, Klavye Kısayolları, Hızlı Arama, EN Dili', () => {
  it('undoes and redoes non-drawing shell actions (style, scale, indicator, settings)', () => {
    setChartStyle('heikin');
    setScale('log');
    toggleIndicator('bb');
    expect(ui.chartStyle).toBe('heikin');
    expect(ui.scaleKind).toBe('log');
    expect(ui.quick.bb).toBe(true);

    undoAction();
    expect(ui.quick.bb).toBe(false);
    undoAction();
    expect(ui.scaleKind).toBe('normal');
    undoAction();
    expect(ui.chartStyle).toBe('candles');

    redoAction();
    expect(ui.chartStyle).toBe('heikin');
    redoAction();
    expect(ui.scaleKind).toBe('log');
    redoAction();
    expect(ui.quick.bb).toBe(true);
  });

  it('handles Standart keyboard shortcuts: ?, Alt+G, /, ⌘K Quick Search, digit interval, letter search, scales, pan/zoom', async () => {
    render(() => (
      <>
        <TopBar />
        <LeftBar />
        <AxisFooter />
        <Modals />
        <MainMenuPopover />
        <SnapshotMenu />
      </>
    ));

    // ? -> Shortcuts modal + search
    handleGlobalKey(new KeyboardEvent('keydown', { key: '?' }));
    expect($('#modal-shortcuts')).toBeTruthy();
    fireEvent.input($('#inp-shortcuts-search'), { target: { value: 'Fibonacci' } });
    expect(document.querySelectorAll('.shortcut-row').length).toBeGreaterThan(0);
    handleGlobalKey(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(ui.modal).toBeNull();

    // Alt+G -> Go to Date modal (Date & Custom range)
    handleGlobalKey(new KeyboardEvent('keydown', { key: 'g', code: 'KeyG', altKey: true }));
    expect($('#modal-goto')).toBeTruthy();
    fireEvent.click($('#btn-goto-submit'));
    expect((rt.chart as unknown as { focusTime: ReturnType<typeof vi.fn> }).focusTime).toHaveBeenCalled();

    handleGlobalKey(new KeyboardEvent('keydown', { key: 'g', code: 'KeyG', altKey: true }));
    fireEvent.click($('[data-goto-tab="range"]'));
    fireEvent.click($('#btn-goto-submit'));
    expect((rt.chart as unknown as { jumpToTimeRange: ReturnType<typeof vi.fn> }).jumpToTimeRange).toHaveBeenCalled();

    // / -> Indicators modal
    handleGlobalKey(new KeyboardEvent('keydown', { key: '/' }));
    expect(ui.modal).toBe('fx');
    handleGlobalKey(new KeyboardEvent('keydown', { key: 'Escape' }));

    // ⌘K -> Quick Search mode executing an action
    handleGlobalKey(new KeyboardEvent('keydown', { key: 'k', metaKey: true }));
    expect($('#titan-symbol-search-modal')).toBeTruthy();
    expect(ui.searchMode).toBe('quick');
    fireEvent.input($('#modal-symbol-search-input'), { target: { value: 'renko' } });
    const renkoBtn = document.querySelector<HTMLButtonElement>('[data-quick-id="sty:renko"]');
    expect(renkoBtn).toBeTruthy();
    fireEvent.click(renkoBtn!);
    expect(ui.chartStyle).toBe('renko');

    // Bare digit -> Quick Interval popup
    handleGlobalKey(new KeyboardEvent('keydown', { key: '4' }));
    expect($('#quick-interval-pop')).toBeTruthy();
    expect($<HTMLInputElement>('#inp-quick-interval').value).toBe('4');
    handleGlobalKey(new KeyboardEvent('keydown', { key: 'Escape' }));

    // Bare letter -> Symbol search prefilled
    handleGlobalKey(new KeyboardEvent('keydown', { key: 'b' }));
    expect($('#titan-symbol-search-modal')).toBeTruthy();
    expect($<HTMLInputElement>('#modal-symbol-search-input').value).toBe('B');
    handleGlobalKey(new KeyboardEvent('keydown', { key: 'Escape' }));

    // Scales, Zoom, Lock All, Pan/Zoom arrows
    handleGlobalKey(new KeyboardEvent('keydown', { key: 'l', code: 'KeyL', altKey: true }));
    expect(ui.scaleKind).toBe('log');
    handleGlobalKey(new KeyboardEvent('keydown', { key: 'p', code: 'KeyP', altKey: true }));
    expect(ui.scaleKind).toBe('percent');
    handleGlobalKey(new KeyboardEvent('keydown', { key: 'o', code: 'KeyO', altKey: true }));
    expect(ui.scaleKind).toBe('indexed');
    handleGlobalKey(new KeyboardEvent('keydown', { key: 'k', code: 'KeyK', altKey: true }));
    expect(ui.scaleLock).toBe(true);
    handleGlobalKey(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', altKey: true }));
    expect(ui.zoomMode).toBe(true);
    handleGlobalKey(new KeyboardEvent('keydown', { key: 'l', code: 'KeyL', ctrlKey: true, altKey: true }));
    expect(ui.allDrawingsLocked).toBe(true);
    handleGlobalKey(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    handleGlobalKey(new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true }));
    handleGlobalKey(new KeyboardEvent('keydown', { key: 'Home' }));
    handleGlobalKey(new KeyboardEvent('keydown', { key: 'End' }));
    expect((rt.chart as unknown as { scrollBars: ReturnType<typeof vi.fn> }).scrollBars).toHaveBeenCalledWith(-1);
    expect((rt.chart as unknown as { scrollBars: ReturnType<typeof vi.fn> }).scrollBars).toHaveBeenCalledWith(10);

    // Language switch TR -> EN via TopBar pill & Main Menu
    fireEvent.click($('#btn-lang-toggle'));
    expect(lang()).toBe('en');
    expect($('#btn-open-fx-modal').textContent).toContain('Indicators');
    expect($('#btn-publish-action').textContent).toContain('Trade');
    expect($('#btn-fit-chart').textContent).toBe('Fit');
    expect($('#btn-scale-auto').textContent).toBe('auto');

    // Main Menu & Snapshot Menu & Timezone Picker & Session Mode
    fireEvent.click($('#btn-top-burger'));
    expect($('#dropdown-main-menu')).toBeTruthy();
    fireEvent.change($('#sel-main-theme'), { target: { value: 'amber' } });
    expect(colorThemeId()).toBe('amber');

    fireEvent.click($('#btn-snapshot'));
    expect($('#dropdown-snapshot')).toBeTruthy();
    fireEvent.click($('#btn-snap-download'));

    fireEvent.click($('#btn-timezone-trigger'));
    expect($('#timezone-menu')).toBeTruthy();
    fireEvent.click($('[data-tz-choice="America/New_York"]'));
    expect(ui.chartSettings.symbol.timezone).toBe('America/New_York');

    fireEvent.click($('#btn-session-mode'));
    expect(ui.chartSettings.symbol.session).toBe('extended');
  });

  it('BarReplay toolbar supports random bar, date picker, speeds (0.5x–10x), and Mobile More sheet', () => {
    const rep = new BarReplay();
    rep.start(
      Array.from({ length: 30 }, (_, i) => ({
        time: 1_700_000_000 + i * 900,
        open: 100,
        high: 101,
        low: 99,
        close: 100,
        volume: 10,
      })),
      15
    );
    rt.replay = rep;
    setUi('replayActive', true);
    setUi('modal', 'mobileMore');
    render(() => (
      <>
        <ReplayBar />
        <Modals />
      </>
    ));
    expect($('#replay-bar')).toBeTruthy();
    fireEvent.click($('#btn-replay-random'));
    fireEvent.click($('#btn-replay-pick-date'));
    expect($('#replay-date-pop')).toBeTruthy();
    fireEvent.click($('#btn-replay-speed'));
    expect(rep.getSpeed()).toBe('5x');

    // Mobile More Sheet
    expect($('#modal-mobile-more')).toBeTruthy();
    expect(document.querySelectorAll('.mobile-sheet-tile').length).toBe(12);
    applyChartSettingsAll(ui.chartSettings, false);
  });
});
