import { tfmt } from './i18n';
import { tt } from './i18n';
/**
 * Betik editörü betik kütüphanesi durumu (Faz 19): aç / kaydet / farklı kaydet / yeniden adlandır /
 * sil / sürüm geçmişi. Kaynak gerçeği SQLite (`/api/scripts*`); açık betik kimliği tarayıcıda kalıcı.
 */
import { createSignal } from 'solid-js';
import type { SavedScriptItem } from '../api/client';
import * as api from '../api/scripts';
import type { ScriptVersionItem } from '../api/scripts';
import { errorMessage } from './format';
import { runScript, setSavedScripts, setUi, toast, ui } from './store';

export type ScriptDialog = 'open' | 'versions' | 'reference' | 'saveas' | null;
export interface CurrentScript {
  id: string;
  name: string;
}

const KEY = 'titanview_script_current_v1';

function loadCurrent(): { cur: CurrentScript | null; saved: string | null } {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as { id?: string; name?: string; saved?: string } | null;
    if (raw?.id && raw.name) return { cur: { id: raw.id, name: raw.name }, saved: raw.saved ?? null };
  } catch {
    // bozuk/erişilemez depolama → boş
  }
  return { cur: null, saved: null };
}

const init = loadCurrent();
const [currentScript, setCurrentScript] = createSignal<CurrentScript | null>(init.cur);
const [savedCode, setSavedCode] = createSignal<string | null>(init.saved);
const [scripts, setScripts] = createSignal<SavedScriptItem[]>([]);
const [versions, setVersions] = createSignal<ScriptVersionItem[]>([]);
const [scriptDialog, setScriptDialog] = createSignal<ScriptDialog>(null);
const [scriptsError, setScriptsError] = createSignal<string | null>(null);

export { currentScript, savedCode, scripts, versions, scriptDialog, setScriptDialog, scriptsError };

function persist(): void {
  try {
    const c = currentScript();
    localStorage.setItem(KEY, JSON.stringify(c ? { ...c, saved: savedCode() } : null));
  } catch {
    // depolama yoksa yok sayılır
  }
}

/** Editördeki kod son kaydedilenden farklı mı? Kaydedilmemiş yeni betik: kod boş değilse kirli. */
export function isDirty(): boolean {
  const s = savedCode();
  return s === null ? false : ui.scriptCode !== s;
}

/** `indicator("Ad")` / `strategy(title="Ad")` / `library("Ad")` → "Ad". */
export function scriptTitleOf(code: string): string | null {
  const m = /\b(?:indicator|strategy|library)\s*\(\s*(?:title\s*=\s*)?(["'])((?:(?!\1).)+)\1/.exec(code);
  return m ? m[2] : null;
}

export function isOverlayCode(code: string): boolean {
  return /\boverlay\s*=\s*true\b/.test(code);
}

const TEMPLATES: Record<'indicator' | 'strategy' | 'library', string> = {
  indicator: `//@version=6
indicator("Yeni Gösterge", overlay=true)
len = input.int(20, "Uzunluk", minval=1)
plot(ta.sma(close, len), "SMA", color=color.blue)
`,
  strategy: `//@version=6
strategy("Yeni Strateji", overlay=true, initial_capital=10000)
fast = ta.ema(close, 9)
slow = ta.ema(close, 21)
if ta.crossover(fast, slow)
    strategy.entry("Al", strategy.long)
if ta.crossunder(fast, slow)
    strategy.close("Al")
plot(fast, "Hızlı", color.teal)
plot(slow, "Yavaş", color.orange)
`,
  library: `//@version=6
// @description Yeni kütüphane
library("YeniKutuphane")

// @function İki değerin ortalaması
export avg2(float a, float b) =>
    (a + b) / 2
`,
};

/** Yeni betik: şablonu editöre koyar, kayıtlı betik bağını koparır. */
export function newScript(kind: keyof typeof TEMPLATES): void {
  setCurrentScript(null);
  setSavedCode(null);
  persist();
  setUi('scriptCode', TEMPLATES[kind]);
  runScript();
}

export async function refreshScripts(): Promise<void> {
  try {
    const list = await api.listScripts();
    setScripts(list);
    // Faz 18 library() çözümleyicisi store.savedScripts'i okur: kayıt/silme sonrası eşitle.
    setSavedScripts(list);
    setScriptsError(null);
  } catch (e) {
    setScriptsError(errorMessage(e));
  }
}

async function doSave(id: string | undefined, name: string): Promise<boolean> {
  const code = ui.scriptCode;
  try {
    const saved = await api.saveScript({ id, name, code, isOverlay: isOverlayCode(code) });
    setCurrentScript({ id: saved.id, name: saved.name });
    setSavedCode(code);
    persist();
    setUi('scriptNote', `💾 "${saved.name}" kaydedildi`);
    void refreshScripts();
    return true;
  } catch (e) {
    setUi('scriptNote', `✗ Kaydedilemedi: ${errorMessage(e)}`);
    return false;
  }
}

/** Kaydet (⌘S): açık betiğin üzerine yazar (yeni sürüm); yoksa betik başlığıyla yeni kayıt. */
export function saveCurrent(): Promise<boolean> {
  const cur = currentScript();
  if (cur) return doSave(cur.id, cur.name);
  return doSave(undefined, scriptTitleOf(ui.scriptCode) ?? tt("Adsız betik"));
}

/** Farklı kaydet: her zaman yeni kayıt. */
export function saveAs(name: string): Promise<boolean> {
  const n = name.trim();
  if (!n) return Promise.resolve(false);
  return doSave(undefined, n);
}

export function openScript(item: SavedScriptItem): void {
  setCurrentScript({ id: item.id, name: item.name });
  setSavedCode(item.code);
  persist();
  setUi('scriptCode', item.code);
  setUi('scriptSubHidden', false);
  setScriptDialog(null);
  runScript();
}

export async function renameScriptById(id: string, name: string): Promise<boolean> {
  const n = name.trim();
  if (!n) return false;
  try {
    await api.renameScript(id, n);
    if (currentScript()?.id === id) {
      setCurrentScript({ id, name: n });
      persist();
    }
    await refreshScripts();
    return true;
  } catch (e) {
    toast(tfmt("Yeniden adlandırılamadı: {0}", errorMessage(e)));
    return false;
  }
}

export async function removeScript(id: string): Promise<boolean> {
  try {
    await api.deleteScript(id);
    if (currentScript()?.id === id) {
      setCurrentScript(null);
      setSavedCode(null);
      persist();
    }
    await refreshScripts();
    return true;
  } catch (e) {
    toast(`Silinemedi: ${errorMessage(e)}`);
    return false;
  }
}

export async function loadVersions(): Promise<void> {
  const cur = currentScript();
  if (!cur) {
    setVersions([]);
    return;
  }
  try {
    setVersions(await api.listVersions(cur.id));
    setScriptsError(null);
  } catch (e) {
    setScriptsError(errorMessage(e));
  }
}

/** Eski sürümü editöre getirir (kaydedilene kadar kirli; Kaydet yeni sürüm oluşturur). */
export function restoreVersion(v: ScriptVersionItem): void {
  setUi('scriptCode', v.code);
  setScriptDialog(null);
  runScript();
}

/** Test yardımcısı. */
export function _resetUserScripts(): void {
  setCurrentScript(null);
  setSavedCode(null);
  setScripts([]);
  setVersions([]);
  setScriptDialog(null);
  setScriptsError(null);
  persist();
}
