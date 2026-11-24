import { createSignal } from 'solid-js';
import {
  BUILTIN_COLOR_THEMES,
  allColorThemes,
  deleteCustomTheme,
  findColorTheme,
  loadCustomThemes,
  saveCustomTheme,
  type ColorThemePreset,
} from './chartSettings';
import { rt } from './runtime';

export type Theme = 'dark' | 'light';
const KEY = 'titanview_theme_v1';
const PRESET_KEY = 'titanview_color_theme_v1';

function loadPresetId(): string {
  try {
    const p = localStorage.getItem(PRESET_KEY);
    if (p) return p;
    return localStorage.getItem(KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

const initialPreset = findColorTheme(loadPresetId());
const [theme, setThemeSignal] = createSignal<Theme>(initialPreset.base);
const [colorThemeId, setColorThemeIdSignal] = createSignal<string>(initialPreset.id);
const [customThemes, setCustomThemesSignal] = createSignal<ColorThemePreset[]>(loadCustomThemes());

export { theme, colorThemeId, customThemes };

export function availableColorThemes(): ColorThemePreset[] {
  return [...BUILTIN_COLOR_THEMES, ...customThemes()];
}

const CSS_VARS = [
  '--bg-canvas',
  '--bg-panel',
  '--bg-elevated',
  '--bg-hover',
  '--border-color',
  '--text-primary',
  '--text-secondary',
  '--text-strong',
  '--accent',
  '--bull',
  '--bear',
] as const;

function applyCssVars(preset: ColorThemePreset): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.dataset.theme = preset.base;
  root.dataset.colorTheme = preset.id;
  if (preset.id === 'dark' || preset.id === 'light') {
    for (const v of CSS_VARS) root.style.removeProperty(v);
    return;
  }
  root.style.setProperty('--bg-canvas', preset.bgCanvas);
  root.style.setProperty('--bg-panel', preset.bgPanel);
  root.style.setProperty('--bg-elevated', preset.bgElevated);
  root.style.setProperty('--bg-hover', preset.bgHover);
  root.style.setProperty('--border-color', preset.borderColor);
  root.style.setProperty('--text-primary', preset.textPrimary);
  root.style.setProperty('--text-secondary', preset.textSecondary);
  root.style.setProperty('--text-strong', preset.textStrong);
  root.style.setProperty('--accent', preset.accent);
  root.style.setProperty('--bull', preset.bull);
  root.style.setProperty('--bear', preset.bear);
}

/** Özel veya hazır renk temasını uygular (CSS değişkenleri + grafik tuvali + kalıcılık). */
export function applyColorTheme(id: string): ColorThemePreset {
  const preset = findColorTheme(id);
  setColorThemeIdSignal(preset.id);
  setThemeSignal(preset.base);
  applyCssVars(preset);
  rt.chart?.applyTheme?.(preset.base === 'light', preset.id === 'dark' || preset.id === 'light' ? undefined : {
    bg: preset.bgCanvas,
    text: preset.textSecondary,
    grid: preset.gridColor,
    border: preset.borderColor,
    upColor: preset.bull,
    downColor: preset.bear,
  });
  for (const s of rt.secondaries) {
    s?.applyTheme?.(preset.base === 'light', preset.id === 'dark' || preset.id === 'light' ? undefined : {
      bg: preset.bgCanvas,
      text: preset.textSecondary,
      grid: preset.gridColor,
      border: preset.borderColor,
      upColor: preset.bull,
      downColor: preset.bear,
    });
  }
  try {
    localStorage.setItem(KEY, preset.base);
    localStorage.setItem(PRESET_KEY, preset.id);
  } catch {
    // ignore
  }
  return preset;
}

/** Temayı uygular: <html data-theme>, grafik renkleri ve kalıcılık (mevcut API ile %100 uyumlu). */
export function applyTheme(t?: Theme): void {
  if (t === 'dark' || t === 'light') {
    applyColorTheme(t);
    return;
  }
  const cur = allColorThemes().find((x) => x.id === colorThemeId());
  applyColorTheme(cur ? cur.id : theme());
}

export function toggleTheme(): void {
  applyColorTheme(theme() === 'dark' ? 'light' : 'dark');
}

export function addCustomColorTheme(preset: Omit<ColorThemePreset, 'id' | 'builtin'> & { id?: string }): ColorThemePreset {
  const list = saveCustomTheme(preset);
  setCustomThemesSignal(list);
  const created = list[list.length - 1];
  applyColorTheme(created.id);
  return created;
}

export function removeCustomColorTheme(id: string): void {
  const list = deleteCustomTheme(id);
  setCustomThemesSignal(list);
  if (colorThemeId() === id) applyColorTheme('dark');
}
