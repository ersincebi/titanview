// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BarReplay } from '../../chart/BarReplay';
import { DrawingManager } from '../../chart/drawing/DrawingManager';
import {
  TIMEZONE_CHOICES,
  formatCrosshairTime,
  setActiveTimezone,
  setTimeAxisDisplay,
  timezoneShortLabel,
} from '../../chart/timezone';
import {
  BUILTIN_COLOR_THEMES,
  DEFAULT_CHART_SETTINGS,
  cloneChartSettings,
  deleteCustomTheme,
  deleteSettingsTemplate,
  findColorTheme,
  loadCustomThemes,
  loadSettingsTemplates,
  normalizeChartSettings,
  saveCustomTheme,
  saveSettingsTemplate,
} from '../chartSettings';
import {
  canRedo,
  canUndo,
  clearHistory,
  isApplyingHistory,
  peekRedo,
  peekUndo,
  pushHistory,
  redoCount,
  redoHistory,
  undoCount,
  undoHistory,
  withoutHistory,
} from '../history';
import { lang, localeTag, setLang, t, toggleLang } from '../i18n';
import { tvIntervalLabel } from '../intervals';
import { buildQuickSearchCatalog, searchQuickItems, toolLabel } from '../quickSearch';
import { rt } from '../runtime';
import {
  ALT_DIGIT_INTERVALS,
  ALT_SHIFT_DRAWINGS,
  ALT_SHORTCUTS,
  SHORTCUT_CATALOG,
  SHORTCUT_CATEGORIES,
  filterShortcuts,
  isTypingTarget,
  parseQuickInterval,
  shortcutLabel,
} from '../shortcuts';
import {
  buildChartShareUrl,
  copyChartLink,
  copySnapshotImage,
  downloadSnapshot,
  openSnapshotInNewTab,
} from '../snapshot';
import { resetStore, setUi, toastMsg } from '../store';
import {
  addCustomColorTheme,
  applyColorTheme,
  availableColorThemes,
  colorThemeId,
  removeCustomColorTheme,
  theme,
} from '../theme';
import type { Candle, DrawingObject } from '../../types/market';

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
  setLang('tr');
  applyColorTheme('dark');
  setActiveTimezone('');
  setTimeAxisDisplay({ hour12: false, dayOfWeek: false });
  resetStore();
});

afterEach(() => {
  rt.chart = undefined;
  setLang('tr');
  applyColorTheme('dark');
});

describe('Faz 29 — i18n (TR / EN)', () => {
  it('switches between Turkish and English reactively and interpolates parameters', () => {
    expect(lang()).toBe('tr');
    expect(localeTag()).toBe('tr-TR');
    expect(t('top.indicators')).toBe('Göstergeler');
    expect(t('ctx.addAlertAt', { sym: 'BTCUSDT', price: '95000.00' })).toContain('BTCUSDT');
    expect(t('unknown.key')).toBe('unknown.key');

    expect(toggleLang()).toBe('en');
    expect(lang()).toBe('en');
    expect(localeTag()).toBe('en-US');
    expect(document.documentElement.lang).toBe('en');
    expect(localStorage.getItem('titanview_lang_v1')).toBe('en');
    expect(t('top.indicators')).toBe('Indicators');
    expect(t('cfg.tab.scales')).toBe('Scales and lines');
    expect(t('leg.open')).toBe('O');
    expect(t('axis.fit')).toBe('Fit');
    expect(tvIntervalLabel('1d')).toBe('1D');
    expect(tvIntervalLabel('1w')).toBe('1W');
    expect(tvIntervalLabel('1M')).toBe('1M');
    expect(tvIntervalLabel('4h')).toBe('4h');
    expect(tvIntervalLabel('5s')).toBe('5s');
    setLang('tr');
    expect(tvIntervalLabel('1d')).toBe('1G');
    expect(tvIntervalLabel('1w')).toBe('1H');
    expect(tvIntervalLabel('1M')).toBe('1A');
  });
});

describe('Faz 29 — Unified Shell Undo/Redo History', () => {
  it('records, undoes, redoes, caps at 100 entries, and honors withoutHistory', () => {
    let val = 0;
    expect(canUndo()).toBe(false);
    expect(canRedo()).toBe(false);
    expect(undoHistory()).toBeNull();
    expect(redoHistory()).toBeNull();

    pushHistory({
      labelTr: 'Adım 1',
      labelEn: 'Step 1',
      undo: () => { val = 0; },
      redo: () => { val = 1; },
    });
    val = 1;
    expect(canUndo()).toBe(true);
    expect(peekUndo()?.labelEn).toBe('Step 1');
    expect(undoCount()).toBe(1);

    // withoutHistory suppresses recording
    withoutHistory(() => {
      expect(isApplyingHistory()).toBe(true);
      pushHistory({ labelTr: 'Yok', labelEn: 'Ignored', undo: () => {}, redo: () => {} });
    });
    expect(undoCount()).toBe(1);

    const undone = undoHistory();
    expect(undone?.labelTr).toBe('Adım 1');
    expect(val).toBe(0);
    expect(canRedo()).toBe(true);
    expect(redoCount()).toBe(1);
    expect(peekRedo()?.labelEn).toBe('Step 1');

    const redone = redoHistory();
    expect(redone?.labelEn).toBe('Step 1');
    expect(val).toBe(1);
    expect(canRedo()).toBe(false);

    // Cap at 100
    for (let i = 0; i < 120; i++) {
      pushHistory({ labelTr: `S${i}`, labelEn: `S${i}`, undo: () => {}, redo: () => {} });
    }
    expect(undoCount()).toBe(100);
  });
});

describe('Faz 29 — Shortcuts Catalog & Quick Interval Parser', () => {
  it('covers ~80 shortcuts across all 7 categories and supports TR/EN search', () => {
    expect(SHORTCUT_CATALOG.length).toBeGreaterThanOrEqual(75);
    expect(SHORTCUT_CATEGORIES).toHaveLength(7);
    for (const cat of SHORTCUT_CATEGORIES) {
      expect(SHORTCUT_CATALOG.some((s) => s.category === cat.id)).toBe(true);
    }
    expect(ALT_SHORTCUTS.KeyT).toBe('trendline');
    expect(ALT_SHIFT_DRAWINGS.KeyP).toBe('pitchfork');
    expect(ALT_DIGIT_INTERVALS.Digit5).toBe('1h');
    expect(shortcutLabel('KeyH')).toBe('Alt+H');

    expect(filterShortcuts('', 'tr').length).toBe(SHORTCUT_CATALOG.length);
    expect(filterShortcuts('logaritmik', 'tr').some((s) => s.id === 'scale_log')).toBe(true);
    expect(filterShortcuts('fibonacci', 'en').some((s) => s.id === 'draw_fib')).toBe(true);
    expect(filterShortcuts('Alt', 'en').length).toBeGreaterThan(20);
  });

  it('parses quick interval strings accurately', () => {
    expect(parseQuickInterval('15')).toBe('15m');
    expect(parseQuickInterval('60')).toBe('1h');
    expect(parseQuickInterval('120')).toBe('2h');
    expect(parseQuickInterval('180')).toBe('3h');
    expect(parseQuickInterval('240')).toBe('4h');
    expect(parseQuickInterval('360')).toBe('6h');
    expect(parseQuickInterval('480')).toBe('8h');
    expect(parseQuickInterval('720')).toBe('12h');
    expect(parseQuickInterval('1440')).toBe('1d');
    expect(parseQuickInterval('4h')).toBe('4h');
    expect(parseQuickInterval('30s')).toBe('30s');
    expect(parseQuickInterval('1M')).toBe('1M');
    expect(parseQuickInterval('d')).toBe('1d');
    expect(parseQuickInterval('w')).toBe('1w');
    expect(parseQuickInterval('M')).toBe('1M');
    expect(parseQuickInterval('')).toBeNull();
    expect(parseQuickInterval('0')).toBeNull();
  });

  it('detects typing targets including inputs, textareas, and contenteditable', () => {
    const inp = document.createElement('input');
    const div = document.createElement('div');
    expect(isTypingTarget(inp)).toBe(true);
    expect(isTypingTarget(div)).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});

describe('Faz 29 — 7-Tab Chart Settings, Templates & Custom Color Themes', () => {
  it('normalizes valid and malformed settings across all 7 tabs', () => {
    expect(normalizeChartSettings(null)).toEqual(DEFAULT_CHART_SETTINGS);
    const custom = normalizeChartSettings({
      symbol: { upColor: '#00FF00', precision: '1000', session: 'extended', timezone: 'UTC' },
      status: { titleMode: 'ticker', showOhlc: false, bgOpacity: 45 },
      scales: { placement: 'left', showSessionBreaks: true, timeFormat: '12h', showDayOfWeek: true },
      canvas: { bgMode: 'gradient', scaleFontSize: 14, marginTop: 99, crosshairStyle: 'dotted' },
      trading: { pnlMode: 'percent', showPositionsOrders: false },
      alerts: { soundVolume: 150, toastDurationSec: 10, alertLineColor: '#FF00FF' },
      events: { dividends: false, earningsBreaks: true },
    });
    expect(custom.symbol.upColor).toBe('#00FF00');
    expect(custom.symbol.precision).toBe('1000');
    expect(custom.symbol.session).toBe('extended');
    expect(custom.status.titleMode).toBe('ticker');
    expect(custom.status.showOhlc).toBe(false);
    expect(custom.scales.placement).toBe('left');
    expect(custom.scales.showSessionBreaks).toBe(true);
    expect(custom.scales.timeFormat).toBe('12h');
    expect(custom.canvas.bgMode).toBe('gradient');
    expect(custom.canvas.marginTop).toBe(40); // clamped
    expect(custom.canvas.crosshairStyle).toBe('dotted');
    expect(custom.trading.pnlMode).toBe('percent');
    expect(custom.alerts.soundVolume).toBe(100); // clamped
    expect(custom.events.dividends).toBe(false);
    expect(custom.events.earningsBreaks).toBe(true);
  });

  it('persists, lists, and deletes chart settings templates', () => {
    expect(loadSettingsTemplates()).toHaveLength(0);
    const s = cloneChartSettings(DEFAULT_CHART_SETTINGS);
    s.canvas.bgColor = '#101820';
    const saved = saveSettingsTemplate('Gece Şablon', s);
    expect(saved).toHaveLength(1);
    expect(saved[0].settings.canvas.bgColor).toBe('#101820');
    expect(loadSettingsTemplates()).toHaveLength(1);
    const after = deleteSettingsTemplate(saved[0].id);
    expect(after).toHaveLength(0);
  });

  it('supports built-in and custom color themes and updates CSS custom properties', () => {
    expect(BUILTIN_COLOR_THEMES.length).toBeGreaterThanOrEqual(6);
    const classic = applyColorTheme('classic');
    expect(classic.id).toBe('classic');
    expect(colorThemeId()).toBe('classic');
    expect(document.documentElement.style.getPropertyValue('--bg-canvas')).toBe('#131722');

    const created = addCustomColorTheme({
      nameTr: 'Neon Test',
      nameEn: 'Neon Test',
      base: 'dark',
      bgCanvas: '#05080f',
      bgPanel: '#0a101f',
      bgElevated: '#10182b',
      bgHover: '#19233d',
      borderColor: '#253357',
      textPrimary: '#e2e8f0',
      textSecondary: '#94a3b8',
      textStrong: '#ffffff',
      accent: '#00e5ff',
      bull: '#00e676',
      bear: '#ff1744',
      gridColor: '#0e172a',
    });
    expect(loadCustomThemes()).toHaveLength(1);
    expect(availableColorThemes().some((x) => x.id === created.id)).toBe(true);
    expect(findColorTheme(created.id).accent).toBe('#00e5ff');
    expect(colorThemeId()).toBe(created.id);

    removeCustomColorTheme(created.id);
    expect(loadCustomThemes()).toHaveLength(0);
    expect(colorThemeId()).toBe('dark');
    expect(theme()).toBe('dark');
    expect(deleteCustomTheme('nonexistent')).toHaveLength(0);
    expect(saveCustomTheme({ ...BUILTIN_COLOR_THEMES[0], nameTr: 'X', nameEn: 'X' })).toHaveLength(1);
  });
});

describe('Faz 29 — Quick Search, Snapshot, Timezone, Bar Replay & Drawing Ops', () => {
  it('searches across indicators, drawings, styles, settings, themes, and actions', () => {
    const cat = buildQuickSearchCatalog();
    expect(cat.length).toBeGreaterThan(250);
    expect(searchQuickItems('RSI', 'indicator').length).toBeGreaterThan(0);
    expect(searchQuickItems('trend', 'drawing').length).toBeGreaterThan(0);
    expect(searchQuickItems('renko', 'style')[0]?.id).toBe('sty:renko');
    expect(searchQuickItems('alarms', 'all').length).toBeGreaterThanOrEqual(0);
    expect(searchQuickItems('alerts', 'setting')[0]?.id).toBe('set:alerts');
    expect(searchQuickItems('midnight', 'theme')[0]?.id).toBe('thm:midnight');
    expect(searchQuickItems('go to date', 'action')[0]?.id).toBe('act:goto');
    expect(toolLabel('trendline', 'en')).toBe('Trend Line');
    expect(toolLabel('trendline', 'tr')).toBe('Trend Çizgisi');
  });

  it('builds shareable chart URLs and handles snapshot download/copy/link/new-tab', async () => {
    setUi('symbol', 'BTCUSDT');
    setUi('interval', '4h');
    setUi('chartStyle', 'heikin');
    setUi('scaleKind', 'log');
    setLang('en');
    const url = buildChartShareUrl();
    expect(url).toContain('symbol=BTCUSDT');
    expect(url).toContain('interval=4h');
    expect(url).toContain('style=heikin');
    expect(url).toContain('scale=log');
    expect(url).toContain('lang=en');

    const fakeCanvas = {
      toDataURL: vi.fn(() => 'data:image/png;base64,AAAA'),
      toBlob: vi.fn((cb: (b: Blob | null) => void) => cb(new Blob(['x'], { type: 'image/png' }))),
    };
    rt.chart = { takeScreenshot: () => fakeCanvas } as never;
    const write = vi.fn(async () => {});
    const writeText = vi.fn(async () => {});
    vi.stubGlobal('ClipboardItem', class { constructor(public items: unknown) {} });
    Object.defineProperty(navigator, 'clipboard', { value: { write, writeText }, configurable: true });
    const origClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = vi.fn();
    try {
      expect(downloadSnapshot()).toBe(true);
      expect(await copySnapshotImage()).toBe(true);
      expect(await copyChartLink()).toContain('BTCUSDT');
    } finally {
      HTMLAnchorElement.prototype.click = origClick;
    }
    expect(write).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledTimes(1);

    const openSpy = vi.spyOn(window, 'open').mockReturnValue({
      document: { write: vi.fn(), close: vi.fn() },
    } as never);
    expect(openSnapshotInNewTab()).toBe(true);
    openSpy.mockRestore();
    expect(toastMsg()).toContain('copied');
  });

  it('formats timezone labels, 12h/24h, and day-of-week cleanly', () => {
    expect(TIMEZONE_CHOICES.length).toBeGreaterThanOrEqual(8);
    setActiveTimezone('UTC');
    expect(timezoneShortLabel()).toBe('UTC');
    setTimeAxisDisplay({ hour12: true, dayOfWeek: true });
    const formatted = formatCrosshairTime(1_700_000_000, 'UTC', false);
    expect(formatted.length).toBeGreaterThan(5);
  });

  it('BarReplay supports jumpToRandom, getTimeBounds, getCurrentTime, and 0.5x/10x speeds', () => {
    const bars: Candle[] = Array.from({ length: 40 }, (_, i) => ({
      time: 1_700_000_000 + i * 900,
      open: 100 + i,
      high: 102 + i,
      low: 99 + i,
      close: 101 + i,
      volume: 1000,
    }));
    const rep = new BarReplay();
    rep.start(bars, 20);
    rep.setSpeed('10x');
    expect(rep.getSpeed()).toBe('10x');
    rep.setSpeed('0.5x');
    expect(rep.getSpeed()).toBe('0.5x');
    expect(rep.getTimeBounds()).toEqual({ min: bars[0].time, max: bars[39].time });
    expect(rep.getCurrentTime()).toBe(bars[19].time);
    const rnd = rep.jumpToRandom(() => 0.5);
    expect(rnd.length).toBeGreaterThanOrEqual(6);
    expect(rnd.length).toBeLessThan(40);
  });

  it('DrawingManager supports lockAll, copy/paste, reorder, and history commit callback', async () => {
    const commits: Array<{ prev: number; next: number; en: string }> = [];
    const dm = new DrawingManager({
      mapper: {
        timeToX: (t) => t,
        xToTime: (x) => x,
        priceToY: (p) => p,
        yToPrice: (y) => y,
      },
      autoPersist: false,
      onHistoryCommit: (prev, next, _tr, en) => commits.push({ prev: prev.length, next: next.length, en }),
    });
    const d1: DrawingObject = { id: 'd1', symbol: 'THYAO.IS', timeframe: '15m', toolType: 'hline', points: [{ time: 10, price: 100 }], color: '#fff' };
    const d2: DrawingObject = { id: 'd2', symbol: 'THYAO.IS', timeframe: '15m', toolType: 'hline', points: [{ time: 20, price: 110 }], color: '#0f0' };
    await dm.addDrawing(d1);
    await dm.addDrawing(d2);
    expect(commits.length).toBe(2);

    // Reorder
    expect(dm.reorderDrawing('d2', 'back')).toBe(true);
    expect(dm.getDrawings()[0].id).toBe('d2');
    expect(dm.reorderDrawing('d2', 'front')).toBe(true);
    expect(dm.getDrawings()[1].id).toBe('d2');
    expect(dm.reorderDrawing('d2', 'backward')).toBe(true);
    expect(dm.getDrawings()[0].id).toBe('d2');
    expect(dm.reorderDrawing('d2', 'forward')).toBe(true);
    expect(dm.getDrawings()[1].id).toBe('d2');

    // Lock all prevents dragging
    dm.setAllLocked(true);
    expect(dm.isAllLocked()).toBe(true);
    expect(dm.beginDrag('d1', 'body', 10, 100)).toBe(false);
    dm.setAllLocked(false);

    // Copy & Paste
    expect(dm.hasClipboard()).toBe(false);
    expect(dm.copyDrawing('d1')).toBeTruthy();
    expect(dm.hasClipboard()).toBe(true);
    const pasted = dm.pasteDrawing();
    expect(pasted).toBeTruthy();
    expect(dm.getDrawings()).toHaveLength(3);

    // Apply snapshot restores exact list
    dm.applyDrawingsSnapshot([d1]);
    expect(dm.getDrawings()).toHaveLength(1);
  });
});
