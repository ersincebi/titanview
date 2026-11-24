/**
 * Faz 29: 7 sekmeli Ayarlar modeli, Ayar Şablonları ve Özel Renk Temaları.
 * Sekmeler: Symbol, Status line, Scales and lines, Canvas, Trading, Alerts, Events.
 */

export type SettingsTabId = 'symbol' | 'status' | 'scales' | 'canvas' | 'trading' | 'alerts' | 'events' | 'sources';

export type PrecisionOption = 'default' | '1' | '10' | '100' | '1000' | '10000' | '100000';
export type SessionMode = 'regular' | 'extended';
export type TitleMode = 'ticker' | 'description' | 'both';
export type BackgroundMode = 'solid' | 'gradient';
export type CrosshairStyleOption = 'dashed' | 'dotted' | 'solid';
export type PnlDisplayMode = 'money' | 'percent' | 'ticks';

export interface ChartSettings {
  symbol: {
    colorBasedOnPrevClose: boolean;
    showBody: boolean;
    upColor: string;
    downColor: string;
    showBorders: boolean;
    borderUpColor: string;
    borderDownColor: string;
    showWick: boolean;
    wickUpColor: string;
    wickDownColor: string;
    precision: PrecisionOption;
    timezone: string; // '' = browser local
    session: SessionMode;
  };
  status: {
    showTitle: boolean;
    titleMode: TitleMode;
    showOhlc: boolean;
    showBarChange: boolean;
    showVolume: boolean;
    showFeedChips: boolean;
    showBuySell: boolean;
    showIndTitles: boolean;
    showIndValues: boolean;
    bgOpacity: number; // 0..100
  };
  scales: {
    placement: 'right' | 'left';
    noOverlappingLabels: boolean;
    showCountdown: boolean;
    showLastPriceLine: boolean;
    showLastPriceLabel: boolean;
    showHighLowLines: boolean;
    showIndLabels: boolean;
    showSessionBreaks: boolean;
    sessionBreakColor: string;
    timeFormat: '24h' | '12h';
    showDayOfWeek: boolean;
  };
  canvas: {
    bgMode: BackgroundMode;
    bgColor: string;
    bgColor2: string;
    showVertGrid: boolean;
    vertGridColor: string;
    showHorzGrid: boolean;
    horzGridColor: string;
    crosshairColor: string;
    crosshairStyle: CrosshairStyleOption;
    showWatermark: boolean;
    watermarkColor: string;
    scaleTextColor: string;
    scaleFontSize: number; // 10..16
    scaleLineColor: string;
    marginTop: number; // % 0..40
    marginBottom: number; // % 0..40
    rightOffset: number; // bars 0..50
  };
  trading: {
    showQuickTrade: boolean;
    oneClickTrading: boolean;
    executionSound: boolean;
    showPositionsOrders: boolean;
    showReverseBtn: boolean;
    pnlMode: PnlDisplayMode;
    extendedLines: boolean;
    showInSnapshots: boolean;
  };
  alerts: {
    showAlertLines: boolean;
    alertLineColor: string;
    onlyActiveLines: boolean;
    soundVolume: number; // 0..100
    autoHideToasts: boolean;
    toastDurationSec: number; // 2..15
    showPopups: boolean;
  };
  events: {
    dividends: boolean;
    splits: boolean;
    earnings: boolean;
    earningsBreaks: boolean;
    showLatestNews: boolean;
    newsNotifications: boolean;
  };
}

export const DEFAULT_CHART_SETTINGS: ChartSettings = {
  symbol: {
    colorBasedOnPrevClose: false,
    showBody: true,
    upColor: '#089981',
    downColor: '#F23645',
    showBorders: true,
    borderUpColor: '#089981',
    borderDownColor: '#F23645',
    showWick: true,
    wickUpColor: '#089981',
    wickDownColor: '#F23645',
    precision: 'default',
    timezone: '',
    session: 'regular',
  },
  status: {
    showTitle: true,
    titleMode: 'description',
    showOhlc: true,
    showBarChange: true,
    showVolume: true,
    showFeedChips: true,
    showBuySell: true,
    showIndTitles: true,
    showIndValues: true,
    bgOpacity: 0,
  },
  scales: {
    placement: 'right',
    noOverlappingLabels: true,
    showCountdown: true,
    showLastPriceLine: true,
    showLastPriceLabel: true,
    showHighLowLines: false,
    showIndLabels: true,
    showSessionBreaks: false,
    sessionBreakColor: '#0284C7',
    timeFormat: '24h',
    showDayOfWeek: false,
  },
  canvas: {
    bgMode: 'solid',
    bgColor: '#0B0E14',
    bgColor2: '#131C2E',
    showVertGrid: true,
    vertGridColor: '#171E2C',
    showHorzGrid: true,
    horzGridColor: '#171E2C',
    crosshairColor: '#758696',
    crosshairStyle: 'dashed',
    showWatermark: false,
    watermarkColor: 'rgba(255, 255, 255, 0.04)',
    scaleTextColor: '#8795AA',
    scaleFontSize: 12,
    scaleLineColor: '#263144',
    marginTop: 8,
    marginBottom: 22,
    rightOffset: 10,
  },
  trading: {
    showQuickTrade: true,
    oneClickTrading: true,
    executionSound: true,
    showPositionsOrders: true,
    showReverseBtn: true,
    pnlMode: 'money',
    extendedLines: true,
    showInSnapshots: true,
  },
  alerts: {
    showAlertLines: true,
    alertLineColor: '#FF9800',
    onlyActiveLines: true,
    soundVolume: 70,
    autoHideToasts: true,
    toastDurationSec: 5,
    showPopups: true,
  },
  events: {
    dividends: true,
    splits: true,
    earnings: true,
    earningsBreaks: false,
    showLatestNews: false,
    newsNotifications: true,
  },
};

export function cloneChartSettings(s: ChartSettings = DEFAULT_CHART_SETTINGS): ChartSettings {
  return JSON.parse(JSON.stringify(s)) as ChartSettings;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, fb: string) => (typeof v === 'string' && v.length <= 64 ? v : fb);
const bool = (v: unknown, fb: boolean) => (typeof v === 'boolean' ? v : fb);
const clamp = (v: unknown, min: number, max: number, fb: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fb;

export function normalizeChartSettings(raw: unknown): ChartSettings {
  const d = cloneChartSettings(DEFAULT_CHART_SETTINGS);
  if (!isObj(raw)) return d;

  if (isObj(raw.symbol)) {
    const x = raw.symbol;
    d.symbol.colorBasedOnPrevClose = bool(x.colorBasedOnPrevClose, d.symbol.colorBasedOnPrevClose);
    d.symbol.showBody = bool(x.showBody, d.symbol.showBody);
    d.symbol.upColor = str(x.upColor, d.symbol.upColor);
    d.symbol.downColor = str(x.downColor, d.symbol.downColor);
    d.symbol.showBorders = bool(x.showBorders, d.symbol.showBorders);
    d.symbol.borderUpColor = str(x.borderUpColor, d.symbol.borderUpColor);
    d.symbol.borderDownColor = str(x.borderDownColor, d.symbol.borderDownColor);
    d.symbol.showWick = bool(x.showWick, d.symbol.showWick);
    d.symbol.wickUpColor = str(x.wickUpColor, d.symbol.wickUpColor);
    d.symbol.wickDownColor = str(x.wickDownColor, d.symbol.wickDownColor);
    if (['default', '1', '10', '100', '1000', '10000', '100000'].includes(String(x.precision))) {
      d.symbol.precision = x.precision as PrecisionOption;
    }
    d.symbol.timezone = typeof x.timezone === 'string' && x.timezone.length <= 64 ? x.timezone : d.symbol.timezone;
    if (x.session === 'regular' || x.session === 'extended') d.symbol.session = x.session;
  }

  if (isObj(raw.status)) {
    const x = raw.status;
    d.status.showTitle = bool(x.showTitle, d.status.showTitle);
    if (x.titleMode === 'ticker' || x.titleMode === 'description' || x.titleMode === 'both') d.status.titleMode = x.titleMode;
    d.status.showOhlc = bool(x.showOhlc, d.status.showOhlc);
    d.status.showBarChange = bool(x.showBarChange, d.status.showBarChange);
    d.status.showVolume = bool(x.showVolume, d.status.showVolume);
    d.status.showFeedChips = bool(x.showFeedChips, d.status.showFeedChips);
    d.status.showBuySell = bool(x.showBuySell, d.status.showBuySell);
    d.status.showIndTitles = bool(x.showIndTitles, d.status.showIndTitles);
    d.status.showIndValues = bool(x.showIndValues, d.status.showIndValues);
    d.status.bgOpacity = clamp(x.bgOpacity, 0, 100, d.status.bgOpacity);
  }

  if (isObj(raw.scales)) {
    const x = raw.scales;
    if (x.placement === 'left' || x.placement === 'right') d.scales.placement = x.placement;
    d.scales.noOverlappingLabels = bool(x.noOverlappingLabels, d.scales.noOverlappingLabels);
    d.scales.showCountdown = bool(x.showCountdown, d.scales.showCountdown);
    d.scales.showLastPriceLine = bool(x.showLastPriceLine, d.scales.showLastPriceLine);
    d.scales.showLastPriceLabel = bool(x.showLastPriceLabel, d.scales.showLastPriceLabel);
    d.scales.showHighLowLines = bool(x.showHighLowLines, d.scales.showHighLowLines);
    d.scales.showIndLabels = bool(x.showIndLabels, d.scales.showIndLabels);
    d.scales.showSessionBreaks = bool(x.showSessionBreaks, d.scales.showSessionBreaks);
    d.scales.sessionBreakColor = str(x.sessionBreakColor, d.scales.sessionBreakColor);
    if (x.timeFormat === '12h' || x.timeFormat === '24h') d.scales.timeFormat = x.timeFormat;
    d.scales.showDayOfWeek = bool(x.showDayOfWeek, d.scales.showDayOfWeek);
  }

  if (isObj(raw.canvas)) {
    const x = raw.canvas;
    if (x.bgMode === 'solid' || x.bgMode === 'gradient') d.canvas.bgMode = x.bgMode;
    d.canvas.bgColor = str(x.bgColor, d.canvas.bgColor);
    d.canvas.bgColor2 = str(x.bgColor2, d.canvas.bgColor2);
    d.canvas.showVertGrid = bool(x.showVertGrid, d.canvas.showVertGrid);
    d.canvas.vertGridColor = str(x.vertGridColor, d.canvas.vertGridColor);
    d.canvas.showHorzGrid = bool(x.showHorzGrid, d.canvas.showHorzGrid);
    d.canvas.horzGridColor = str(x.horzGridColor, d.canvas.horzGridColor);
    d.canvas.crosshairColor = str(x.crosshairColor, d.canvas.crosshairColor);
    if (x.crosshairStyle === 'dashed' || x.crosshairStyle === 'dotted' || x.crosshairStyle === 'solid') {
      d.canvas.crosshairStyle = x.crosshairStyle;
    }
    d.canvas.showWatermark = bool(x.showWatermark, d.canvas.showWatermark);
    d.canvas.watermarkColor = str(x.watermarkColor, d.canvas.watermarkColor);
    d.canvas.scaleTextColor = str(x.scaleTextColor, d.canvas.scaleTextColor);
    d.canvas.scaleFontSize = clamp(x.scaleFontSize, 10, 16, d.canvas.scaleFontSize);
    d.canvas.scaleLineColor = str(x.scaleLineColor, d.canvas.scaleLineColor);
    d.canvas.marginTop = clamp(x.marginTop, 0, 40, d.canvas.marginTop);
    d.canvas.marginBottom = clamp(x.marginBottom, 0, 40, d.canvas.marginBottom);
    d.canvas.rightOffset = clamp(x.rightOffset, 0, 50, d.canvas.rightOffset);
  }

  if (isObj(raw.trading)) {
    const x = raw.trading;
    d.trading.showQuickTrade = bool(x.showQuickTrade, d.trading.showQuickTrade);
    d.trading.oneClickTrading = bool(x.oneClickTrading, d.trading.oneClickTrading);
    d.trading.executionSound = bool(x.executionSound, d.trading.executionSound);
    d.trading.showPositionsOrders = bool(x.showPositionsOrders, d.trading.showPositionsOrders);
    d.trading.showReverseBtn = bool(x.showReverseBtn, d.trading.showReverseBtn);
    if (x.pnlMode === 'money' || x.pnlMode === 'percent' || x.pnlMode === 'ticks') d.trading.pnlMode = x.pnlMode;
    d.trading.extendedLines = bool(x.extendedLines, d.trading.extendedLines);
    d.trading.showInSnapshots = bool(x.showInSnapshots, d.trading.showInSnapshots);
  }

  if (isObj(raw.alerts)) {
    const x = raw.alerts;
    d.alerts.showAlertLines = bool(x.showAlertLines, d.alerts.showAlertLines);
    d.alerts.alertLineColor = str(x.alertLineColor, d.alerts.alertLineColor);
    d.alerts.onlyActiveLines = bool(x.onlyActiveLines, d.alerts.onlyActiveLines);
    d.alerts.soundVolume = clamp(x.soundVolume, 0, 100, d.alerts.soundVolume);
    d.alerts.autoHideToasts = bool(x.autoHideToasts, d.alerts.autoHideToasts);
    d.alerts.toastDurationSec = clamp(x.toastDurationSec, 2, 15, d.alerts.toastDurationSec);
    d.alerts.showPopups = bool(x.showPopups, d.alerts.showPopups);
  }

  if (isObj(raw.events)) {
    const x = raw.events;
    d.events.dividends = bool(x.dividends, d.events.dividends);
    d.events.splits = bool(x.splits, d.events.splits);
    d.events.earnings = bool(x.earnings, d.events.earnings);
    d.events.earningsBreaks = bool(x.earningsBreaks, d.events.earningsBreaks);
    d.events.showLatestNews = bool(x.showLatestNews, d.events.showLatestNews);
    d.events.newsNotifications = bool(x.newsNotifications, d.events.newsNotifications);
  }

  return d;
}

// ---------- Ayar Şablonları (Footer → Template ▾) ----------

export interface SettingsTemplate {
  id: string;
  name: string;
  settings: ChartSettings;
}

const TPL_KEY = 'titanview_settings_templates_v1';

export function loadSettingsTemplates(): SettingsTemplate[] {
  try {
    const raw = localStorage.getItem(TPL_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((x): x is { id: string; name: string; settings: unknown } => isObj(x) && typeof x.id === 'string' && typeof x.name === 'string')
      .map((x) => ({ id: x.id, name: x.name, settings: normalizeChartSettings(x.settings) }));
  } catch {
    return [];
  }
}

export function saveSettingsTemplate(name: string, settings: ChartSettings): SettingsTemplate[] {
  const clean = name.trim().slice(0, 48);
  if (!clean) return loadSettingsTemplates();
  const list = loadSettingsTemplates().filter((x) => x.name.toLowerCase() !== clean.toLowerCase());
  const next: SettingsTemplate[] = [
    ...list,
    { id: `ctpl_${Date.now().toString(36)}`, name: clean, settings: cloneChartSettings(settings) },
  ];
  try {
    localStorage.setItem(TPL_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
  return next;
}

export function deleteSettingsTemplate(id: string): SettingsTemplate[] {
  const next = loadSettingsTemplates().filter((x) => x.id !== id);
  try {
    localStorage.setItem(TPL_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
  return next;
}

// ---------- Renk Temaları (Hazır + Kullanıcı Özel Temaları) ----------

export interface ColorThemePreset {
  id: string;
  nameTr: string;
  nameEn: string;
  base: 'dark' | 'light';
  builtin?: boolean;
  bgCanvas: string;
  bgPanel: string;
  bgElevated: string;
  bgHover: string;
  borderColor: string;
  textPrimary: string;
  textSecondary: string;
  textStrong: string;
  accent: string;
  bull: string;
  bear: string;
  gridColor: string;
}

export const BUILTIN_COLOR_THEMES: ColorThemePreset[] = [
  {
    id: 'dark',
    nameTr: 'TitanView Koyu',
    nameEn: 'TitanView Dark',
    base: 'dark',
    builtin: true,
    bgCanvas: '#0b0e14',
    bgPanel: '#111622',
    bgElevated: '#181f2e',
    bgHover: '#1e2738',
    borderColor: '#263144',
    textPrimary: '#c8d1e0',
    textSecondary: '#8795aa',
    textStrong: '#f4f7fb',
    accent: '#0284c7',
    bull: '#089981',
    bear: '#f23645',
    gridColor: '#171e2c',
  },
  {
    id: 'light',
    nameTr: 'TitanView Açık',
    nameEn: 'TitanView Light',
    base: 'light',
    builtin: true,
    bgCanvas: '#ffffff',
    bgPanel: '#f4f7fb',
    bgElevated: '#ffffff',
    bgHover: '#e8eff7',
    borderColor: '#d8e2ee',
    textPrimary: '#141c2b',
    textSecondary: '#5a6a80',
    textStrong: '#090e17',
    accent: '#0284c7',
    bull: '#089981',
    bear: '#f23645',
    gridColor: '#eef2f7',
  },
  {
    id: 'classic',
    nameTr: 'Klasik Slate',
    nameEn: 'Classic Slate',
    base: 'dark',
    builtin: true,
    bgCanvas: '#131722',
    bgPanel: '#1e222d',
    bgElevated: '#2a2e39',
    bgHover: '#363a45',
    borderColor: '#363a45',
    textPrimary: '#d1d4dc',
    textSecondary: '#787b86',
    textStrong: '#ffffff',
    accent: '#0284c7',
    bull: '#26a69a',
    bear: '#ef5350',
    gridColor: '#1f2433',
  },
  {
    id: 'midnight',
    nameTr: 'Gece Okyanusu',
    nameEn: 'Midnight Ocean',
    base: 'dark',
    builtin: true,
    bgCanvas: '#0b1020',
    bgPanel: '#11182c',
    bgElevated: '#18223d',
    bgHover: '#202d4f',
    borderColor: '#27365e',
    textPrimary: '#cbd5e1',
    textSecondary: '#7c8db5',
    textStrong: '#f8fafc',
    accent: '#38bdf8',
    bull: '#00c896',
    bear: '#ff4d6d',
    gridColor: '#16203a',
  },
  {
    id: 'contrast',
    nameTr: 'Yüksek Kontrast',
    nameEn: 'High Contrast',
    base: 'dark',
    builtin: true,
    bgCanvas: '#000000',
    bgPanel: '#0a0a0a',
    bgElevated: '#141414',
    bgHover: '#242424',
    borderColor: '#4a4a4a',
    textPrimary: '#f0f0f0',
    textSecondary: '#a8a8a8',
    textStrong: '#ffffff',
    accent: '#38bdf8',
    bull: '#00e676',
    bear: '#ff1744',
    gridColor: '#222222',
  },
  {
    id: 'amber',
    nameTr: 'Terminal Amber',
    nameEn: 'Terminal Amber',
    base: 'dark',
    builtin: true,
    bgCanvas: '#080808',
    bgPanel: '#121212',
    bgElevated: '#1a1a1a',
    bgHover: '#262626',
    borderColor: '#332914',
    textPrimary: '#e6d8c3',
    textSecondary: '#9c8b70',
    textStrong: '#fff3e0',
    accent: '#ff9800',
    bull: '#00d26a',
    bear: '#ff3b30',
    gridColor: '#1f1b14',
  },
];

const CUSTOM_THEME_KEY = 'titanview_custom_themes_v1';

export function loadCustomThemes(): ColorThemePreset[] {
  try {
    const raw = localStorage.getItem(CUSTOM_THEME_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter((x): x is ColorThemePreset => isObj(x) && typeof x.id === 'string' && typeof x.bgCanvas === 'string');
  } catch {
    return [];
  }
}

export function allColorThemes(): ColorThemePreset[] {
  return [...BUILTIN_COLOR_THEMES, ...loadCustomThemes()];
}

export function saveCustomTheme(preset: Omit<ColorThemePreset, 'id' | 'builtin'> & { id?: string }): ColorThemePreset[] {
  const existing = loadCustomThemes();
  const id = preset.id && !BUILTIN_COLOR_THEMES.some((b) => b.id === preset.id) ? preset.id : `custom_${Date.now().toString(36)}`;
  const item: ColorThemePreset = { ...preset, id, builtin: false };
  const next = [...existing.filter((x) => x.id !== id && x.nameTr.toLowerCase() !== item.nameTr.toLowerCase()), item];
  try {
    localStorage.setItem(CUSTOM_THEME_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
  return next;
}

export function deleteCustomTheme(id: string): ColorThemePreset[] {
  const next = loadCustomThemes().filter((x) => x.id !== id);
  try {
    localStorage.setItem(CUSTOM_THEME_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
  return next;
}

export function findColorTheme(id: string): ColorThemePreset {
  return allColorThemes().find((x) => x.id === id) ?? BUILTIN_COLOR_THEMES[0];
}
