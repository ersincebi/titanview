import { tfmt, tt } from './i18n';
import { createEffect, createRoot } from 'solid-js';
import {
  copyLayoutApi,
  createLayoutApi,
  deleteLayoutApi,
  getLayoutApi,
  getSharedLayoutApi,
  listLayoutsApi,
  shareLayoutApi,
  updateLayoutApi,
  type SavedLayoutRecord,
} from '../api/layouts';
import { parseDrawingRows } from '../api/client';
import { errorMessage } from './format';
import { getLayoutTemplate } from './layout';
import {
  activeLayoutId,
  activeLayoutName,
  layoutAutosave,
  layoutDirty,
  layoutIsShared,
  layoutShareToken,
  readOnlyLayout,
  savedLayouts,
  setActiveLayoutId,
  setActiveLayoutName,
  setLayoutAutosave,
  setLayoutDirty,
  setLayoutIsShared,
  setLayoutShareToken,
  setReadOnlyLayout,
  setSavedLayouts,
} from './layoutState';
import { rt } from './runtime';
import {
  applyWorkspaceState,
  buildWorkspaceStateObject,
  loadAllSecondaries,
  loadSymbolData,
  registerLayoutHooks,
  scheduleResize,
  setLayoutGrid,
  setUi,
  slotSymbolAt,
  syncLiveSubscriptions,
  toast,
  ui,
  visibleSlotCount,
} from './store';

export {
  activeLayoutId,
  activeLayoutName,
  connectedTabs,
  layoutAutosave,
  layoutDirty,
  layoutIsShared,
  layoutShareToken,
  readOnlyLayout,
  savedLayouts,
  slotInfos,
} from './layoutState';

const ACTIVE_LAYOUT_KEY = 'titanview_active_layout_id';

function currentSymbolsSummary(): string {
  const n = visibleSlotCount();
  const syms: string[] = [];
  for (let i = 0; i < n; i++) {
    const s = slotSymbolAt(i).toUpperCase();
    if (!syms.includes(s)) syms.push(s);
  }
  return syms.join(',');
}

function buildPayload(name = activeLayoutName()) {
  const tpl = getLayoutTemplate(ui.layout);
  return {
    name: name.trim() || tt("Adsız"),
    state: buildWorkspaceStateObject(),
    gridId: tpl.id,
    chartCount: tpl.count,
    symbols: currentSymbolsSummary(),
    autosave: layoutAutosave(),
  };
}

function applyMetaFromRecord(rec: Pick<SavedLayoutRecord, 'id' | 'name' | 'autosave' | 'isShared' | 'shareToken'>): void {
  setActiveLayoutId(rec.id);
  setActiveLayoutName(rec.name);
  setLayoutAutosave(rec.autosave);
  setLayoutIsShared(rec.isShared);
  setLayoutShareToken(rec.shareToken ?? '');
  setLayoutDirty(false);
  try {
    localStorage.setItem(ACTIVE_LAYOUT_KEY, rec.id);
  } catch {
    // ignore storage errors
  }
}

export function shareUrlForToken(token: string): string {
  if (!token) return '';
  if (typeof location === 'undefined') return `/?share=${encodeURIComponent(token)}`;
  return `${location.origin}${location.pathname}?share=${encodeURIComponent(token)}`;
}

export async function refreshSavedLayouts(): Promise<void> {
  try {
    const list = await listLayoutsApi();
    setSavedLayouts(list);
    // Sayfa yenilenince aktif düzen meta bilgisini hatırla (salt-okur modda değilse)
    if (!readOnlyLayout() && !activeLayoutId()) {
      let remembered = '';
      try {
        remembered = localStorage.getItem(ACTIVE_LAYOUT_KEY) ?? '';
      } catch {
        remembered = '';
      }
      const match = list.find((l) => l.id === remembered);
      if (match) applyMetaFromRecord(match);
    }
  } catch {
    // sunucu çevrimdışı olabilir
  }
}

export async function saveCurrentLayout(opts: { silent?: boolean; name?: string } = {}): Promise<SavedLayoutRecord | null> {
  if (readOnlyLayout()) {
    if (!opts.silent) toast(tt("Salt-okur düzen değiştirilemez; önce \"Kopya oluştur\" kullanın"));
    return null;
  }
  const payload = buildPayload(opts.name ?? activeLayoutName());
  try {
    let rec: SavedLayoutRecord;
    const id = activeLayoutId();
    if (id) {
      rec = await updateLayoutApi(id, payload);
    } else {
      rec = await createLayoutApi(payload);
    }
    applyMetaFromRecord(rec);
    await refreshSavedLayouts();
    rt.tabBus?.send({ type: 'layouts_changed' });
    if (!opts.silent) toast(tfmt("💾 \"{0}\" düzeni kaydedildi", rec.name));
    return rec;
  } catch (e) {
    if (!opts.silent) toast(tfmt("Düzen kaydedilemedi: {0}", errorMessage(e)));
    return null;
  }
}

export async function renameActiveLayout(newName: string): Promise<boolean> {
  const trimmed = newName.trim();
  if (!trimmed) return false;
  if (readOnlyLayout()) {
    toast(tt("Salt-okur düzen yeniden adlandırılamaz"));
    return false;
  }
  const id = activeLayoutId();
  if (!id) {
    const rec = await saveCurrentLayout({ name: trimmed });
    return !!rec;
  }
  try {
    const rec = await updateLayoutApi(id, { name: trimmed });
    applyMetaFromRecord(rec);
    await refreshSavedLayouts();
    rt.tabBus?.send({ type: 'layouts_changed' });
    toast(tfmt("Düzen adı güncellendi: \"{0}\"", rec.name));
    return true;
  } catch (e) {
    toast(tfmt("Adlandırılamadı: {0}", errorMessage(e)));
    return false;
  }
}

export async function setAutosaveEnabled(enabled: boolean): Promise<void> {
  setLayoutAutosave(enabled);
  const id = activeLayoutId();
  if (id && !readOnlyLayout()) {
    try {
      await updateLayoutApi(id, { autosave: enabled });
      await refreshSavedLayouts();
    } catch {
      // ignore
    }
  }
  toast(enabled ? tt("Otomatik kaydetme açıldı") : tt("Otomatik kaydetme kapatıldı"));
}

export async function createNewLayout(name = tt("Yeni Düzen")): Promise<SavedLayoutRecord | null> {
  setReadOnlyLayout(null);
  clearShareQueryParam();
  setLayoutGrid('single');
  try {
    const rec = await createLayoutApi(buildPayload(name));
    applyMetaFromRecord(rec);
    await refreshSavedLayouts();
    rt.tabBus?.send({ type: 'layouts_changed' });
    toast(tfmt("Yeni düzen oluşturuldu: \"{0}\"", rec.name));
    return rec;
  } catch (e) {
    toast(tfmt("Yeni düzen oluşturulamadı: {0}", errorMessage(e)));
    return null;
  }
}

export async function duplicateActiveLayout(name?: string): Promise<SavedLayoutRecord | null> {
  if (readOnlyLayout()) {
    return cloneReadOnlyLayout(name);
  }
  let id = activeLayoutId();
  if (!id) {
    const created = await saveCurrentLayout({ silent: true });
    id = created?.id ?? null;
  }
  if (!id) return null;
  try {
    const copy = await copyLayoutApi(id, name);
    applyMetaFromRecord(copy);
    await refreshSavedLayouts();
    rt.tabBus?.send({ type: 'layouts_changed' });
    toast(tfmt("Kopya oluşturuldu: \"{0}\"", copy.name));
    return copy;
  } catch (e) {
    toast(tfmt("Kopyalanamadı: {0}", errorMessage(e)));
    return null;
  }
}

export async function openSavedLayout(id: string): Promise<boolean> {
  try {
    const rec = await getLayoutApi(id);
    setReadOnlyLayout(null);
    clearShareQueryParam();
    applyMetaFromRecord(rec);
    applyWorkspaceState(rec.state);
    await Promise.all([loadSymbolData(ui.symbol, ui.interval), loadAllSecondaries()]);
    syncLiveSubscriptions();
    scheduleResize(60);
    setLayoutDirty(false);
    toast(tfmt("Düzen açıldı: \"{0}\"", rec.name));
    return true;
  } catch (e) {
    toast(tfmt("Düzen açılamadı: {0}", errorMessage(e)));
    return false;
  }
}

export async function deleteSavedLayout(id: string): Promise<boolean> {
  try {
    await deleteLayoutApi(id);
    if (activeLayoutId() === id) {
      setActiveLayoutId(null);
      setActiveLayoutName(tt("Adsız"));
      setLayoutIsShared(false);
      setLayoutShareToken('');
      try {
        localStorage.removeItem(ACTIVE_LAYOUT_KEY);
      } catch {
        // ignore
      }
    }
    await refreshSavedLayouts();
    rt.tabBus?.send({ type: 'layouts_changed' });
    toast(tt("Düzen silindi"));
    return true;
  } catch (e) {
    toast(tfmt("Düzen silinemedi: {0}", errorMessage(e)));
    return false;
  }
}

export async function toggleLayoutSharing(shared: boolean, regenerate = false): Promise<string | null> {
  if (readOnlyLayout()) return null;
  let id = activeLayoutId();
  if (!id) {
    const created = await saveCurrentLayout({ silent: true });
    id = created?.id ?? null;
  }
  if (!id) return null;
  try {
    const res = await shareLayoutApi(id, shared, regenerate);
    setLayoutIsShared(res.isShared);
    setLayoutShareToken(res.shareToken ?? '');
    await refreshSavedLayouts();
    if (res.isShared && res.shareToken) {
      const url = shareUrlForToken(res.shareToken);
      toast(tt("🔗 Salt-okur paylaşım bağlantısı etkinleştirildi"));
      return url;
    }
    toast(tt("Paylaşım kapatıldı"));
    return null;
  } catch (e) {
    toast(tfmt("Paylaşım güncellenemedi: {0}", errorMessage(e)));
    return null;
  }
}

export async function copyShareLink(): Promise<boolean> {
  const token = layoutShareToken();
  if (!layoutIsShared() || !token) return false;
  const url = shareUrlForToken(token);
  try {
    await navigator.clipboard?.writeText(url);
    toast(tt("🔗 Salt-okur bağlantı panoya kopyalandı"));
    return true;
  } catch {
    toast(tfmt("Bağlantı: {0}", url));
    return false;
  }
}

export async function loadSharedLayoutFromToken(token: string): Promise<boolean> {
  try {
    const resp = await getSharedLayoutApi(token);
    const drawings = parseDrawingRows(resp.drawings ?? []);
    setReadOnlyLayout({ name: resp.layout.name, shareToken: token, drawings });
    setActiveLayoutId(null);
    setActiveLayoutName(resp.layout.name);
    setLayoutIsShared(true);
    setLayoutShareToken(token);
    setLayoutDirty(false);
    applyWorkspaceState(resp.layout.state);
    toast(tfmt("👁 Salt-okur paylaşılan düzen: \"{0}\"", resp.layout.name));
    return true;
  } catch (e) {
    toast(tfmt("Paylaşılan düzen açılamadı: {0}", errorMessage(e)));
    return false;
  }
}

export async function cloneReadOnlyLayout(customName?: string): Promise<SavedLayoutRecord | null> {
  const ro = readOnlyLayout();
  if (!ro) return null;
  const name = customName?.trim() || `${ro.name} (kopya)`;
  try {
    const rec = await createLayoutApi(buildPayload(name));
    setReadOnlyLayout(null);
    clearShareQueryParam();
    applyMetaFromRecord(rec);
    await refreshSavedLayouts();
    rt.tabBus?.send({ type: 'layouts_changed' });
    toast(tfmt("Düzen kopyalandı: \"{0}\"", rec.name));
    return rec;
  } catch (e) {
    toast(tfmt("Kopyalanamadı: {0}", errorMessage(e)));
    return null;
  }
}

export function exitReadOnlyLayout(): void {
  setReadOnlyLayout(null);
  clearShareQueryParam();
  setActiveLayoutId(null);
  setActiveLayoutName(tt("Adsız"));
  setLayoutIsShared(false);
  setLayoutShareToken('');
  setUi('menu', null);
  toast(tt("Salt-okur görünümden çıkıldı"));
}

function clearShareQueryParam(): void {
  if (typeof window === 'undefined' || !window.history?.replaceState) return;
  try {
    const url = new URL(window.location.href);
    if (url.searchParams.has('share')) {
      url.searchParams.delete('share');
      window.history.replaceState({}, '', url.pathname + url.search + url.hash);
    }
  } catch {
    // ignore
  }
}

// store.ts bootstrap & ⌘S kancalarını kaydet + otomatik kaydetme zamanlayıcısı
let autoTimer: ReturnType<typeof setTimeout> | undefined;
let initialized = false;

export function initSavedLayouts(): void {
  if (initialized) return;
  initialized = true;
  registerLayoutHooks({
    loadShared: loadSharedLayoutFromToken,
    refreshList: refreshSavedLayouts,
    saveActive: async () => {
      await saveCurrentLayout();
    },
  });
  createRoot(() => {
    createEffect(() => {
      const dirty = layoutDirty();
      const auto = layoutAutosave();
      const id = activeLayoutId();
      const ro = readOnlyLayout();
      if (!dirty || !auto || !id || ro) return;
      if (autoTimer !== undefined) clearTimeout(autoTimer);
      autoTimer = setTimeout(() => {
        autoTimer = undefined;
        if (layoutDirty() && layoutAutosave() && activeLayoutId() && !readOnlyLayout()) {
          void saveCurrentLayout({ silent: true });
        }
      }, 1500);
    });
  });
}

// Modül yüklendiğinde kancaları bağla
initSavedLayouts();
