import { tt } from './i18n';
import { createSignal } from 'solid-js';
import {
  deleteNoteApi,
  deleteWatchlistApi,
  fetchNotesApi,
  fetchWatchlistsApi,
  saveNoteApi,
  saveWatchlistApi,
  setSymbolFlagApi,
} from '../api/phase27';
import type {
  FlagColor,
  SavedWatchlist,
  SymbolNote,
  WatchlistColumnKey,
  WatchlistEntry,
} from '../types/market';
import {
  FLAG_COLORS,
  nextWatchlistSort,
  parseWatchlistImportText,
  type WatchlistSortCol,
  type WatchlistSortState,
} from './watchlist';

const LS_COLS_KEY = 'tv_wl_columns_v27'; // gitleaks:allow (localStorage key name, not a secret)
const LS_ACTIVE_WL_KEY = 'tv_wl_active_v27';
const LS_FLAGS_KEY = 'tv_wl_flags_v27';
const LS_WLS_KEY = 'tv_wl_lists_v27';

export const DEFAULT_WATCHLISTS_LOCAL: SavedWatchlist[] = [
  {
    id: 'wl_main',
    name: tt("Ana İzleme Listesi"),
    isDefault: true,
    items: [
      { type: 'section', id: 'sec_bist', title: tt("BIST LİDERLER") },
      { type: 'symbol', symbol: 'XU100.IS' },
      { type: 'symbol', symbol: 'THYAO.IS' },
      { type: 'symbol', symbol: 'ASELS.IS' },
      { type: 'symbol', symbol: 'GARAN.IS' },
      { type: 'symbol', symbol: 'EREGL.IS' },
      { type: 'symbol', symbol: 'KCHOL.IS' },
      { type: 'symbol', symbol: 'TUPRS.IS' },
      { type: 'symbol', symbol: 'AKBNK.IS' },
      { type: 'symbol', symbol: 'BIMAS.IS' },
      { type: 'symbol', symbol: 'FROTO.IS' },
      { type: 'symbol', symbol: 'SISE.IS' },
      { type: 'section', id: 'sec_crypto', title: tt("KRİPTO ANA") },
      { type: 'symbol', symbol: 'BTCUSDT' },
      { type: 'symbol', symbol: 'ETHUSDT' },
      { type: 'symbol', symbol: 'SOLUSDT' },
      { type: 'symbol', symbol: 'BNBUSDT' },
      { type: 'symbol', symbol: 'XRPUSDT' },
      { type: 'symbol', symbol: 'AVAXUSDT' },
      { type: 'symbol', symbol: 'LINKUSDT' },
      { type: 'symbol', symbol: 'SUIUSDT' },
      { type: 'section', id: 'sec_us', title: tt("ABD TEKNOLOJİ & ETF") },
      { type: 'symbol', symbol: 'NVDA' },
      { type: 'symbol', symbol: 'AAPL' },
      { type: 'symbol', symbol: 'MSFT' },
      { type: 'symbol', symbol: 'TSLA' },
      { type: 'symbol', symbol: 'AMZN' },
      { type: 'symbol', symbol: 'META' },
      { type: 'symbol', symbol: 'GOOGL' },
      { type: 'symbol', symbol: 'AMD' },
      { type: 'symbol', symbol: 'SPY' },
      { type: 'symbol', symbol: 'QQQ' },
      { type: 'section', id: 'sec_fx', title: tt("ALTIN & DÖVİZ") },
      { type: 'symbol', symbol: 'USDTRY=X' },
      { type: 'symbol', symbol: 'EURTRY=X' },
      { type: 'symbol', symbol: 'GC=F' },
      { type: 'symbol', symbol: 'SI=F' },
      { type: 'symbol', symbol: 'BZ=F' },
      { type: 'symbol', symbol: 'DX-Y.NYB' },
    ],
  },
  {
    id: 'wl_bist30',
    name: tt("BIST 30 Sektörel"),
    items: [
      { type: 'section', id: 'sec_bist_bank', title: tt("BANKACILIK & HOLDİNG") },
      { type: 'symbol', symbol: 'GARAN.IS' },
      { type: 'symbol', symbol: 'AKBNK.IS' },
      { type: 'symbol', symbol: 'ISCTR.IS' },
      { type: 'symbol', symbol: 'YKBNK.IS' },
      { type: 'symbol', symbol: 'KCHOL.IS' },
      { type: 'symbol', symbol: 'SAHOL.IS' },
      { type: 'section', id: 'sec_bist_ind', title: tt("SANAYİ, SAVUNMA & ENERJİ") },
      { type: 'symbol', symbol: 'ASELS.IS' },
      { type: 'symbol', symbol: 'TUPRS.IS' },
      { type: 'symbol', symbol: 'EREGL.IS' },
      { type: 'symbol', symbol: 'FROTO.IS' },
      { type: 'symbol', symbol: 'TOASO.IS' },
      { type: 'symbol', symbol: 'SISE.IS' },
      { type: 'symbol', symbol: 'ASTOR.IS' },
      { type: 'symbol', symbol: 'SASA.IS' },
      { type: 'section', id: 'sec_bist_svc', title: tt("ULAŞTIRMA & PERAKENDE") },
      { type: 'symbol', symbol: 'THYAO.IS' },
      { type: 'symbol', symbol: 'PGSUS.IS' },
      { type: 'symbol', symbol: 'BIMAS.IS' },
      { type: 'symbol', symbol: 'MGROS.IS' },
      { type: 'symbol', symbol: 'TCELL.IS' },
      { type: 'symbol', symbol: 'TTKOM.IS' },
    ],
  },
  {
    id: 'wl_crypto_ai',
    name: 'Kripto & Yapay Zeka',
    items: [
      { type: 'section', id: 'sec_l1', title: 'KATMAN-1 (LAYER 1)' },
      { type: 'symbol', symbol: 'BTCUSDT' },
      { type: 'symbol', symbol: 'ETHUSDT' },
      { type: 'symbol', symbol: 'SOLUSDT' },
      { type: 'symbol', symbol: 'BNBUSDT' },
      { type: 'symbol', symbol: 'AVAXUSDT' },
      { type: 'symbol', symbol: 'SUIUSDT' },
      { type: 'symbol', symbol: 'ADAUSDT' },
      { type: 'section', id: 'sec_ai', title: 'YAPAY ZEKA & ALTYAPI' },
      { type: 'symbol', symbol: 'RENDERUSDT' },
      { type: 'symbol', symbol: 'FETUSDT' },
      { type: 'symbol', symbol: 'LINKUSDT' },
      { type: 'symbol', symbol: 'XRPUSDT' },
      { type: 'symbol', symbol: 'DOGEUSDT' },
    ],
  },
];

function readInitialCols(): Record<WatchlistColumnKey, boolean> {
  const defaults: Record<WatchlistColumnKey, boolean> = {
    last: true,
    chg: true,
    chgPct: true,
    vol: false,
    ext: false,
    tech: false,
  };
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(LS_COLS_KEY) : null;
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Record<WatchlistColumnKey, boolean>>;
      return { ...defaults, ...parsed };
    }
  } catch {
    // ignore storage errors
  }
  return defaults;
}

function readInitialLists(): SavedWatchlist[] {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(LS_WLS_KEY) : null;
    if (raw) {
      const parsed = JSON.parse(raw) as SavedWatchlist[];
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {
    // ignore
  }
  return DEFAULT_WATCHLISTS_LOCAL;
}

function readInitialFlags(): Record<string, FlagColor> {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(LS_FLAGS_KEY) : null;
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, FlagColor>;
      if (parsed && typeof parsed === 'object') return parsed;
    }
  } catch {
    // ignore
  }
  return {};
}

export const [watchlists, setWatchlists] = createSignal<SavedWatchlist[]>(readInitialLists());
export const [activeWatchlistId, setActiveWatchlistIdSignal] = createSignal<string>('wl_main');
export const [activeFlagFilter, setActiveFlagFilter] = createSignal<FlagColor | null>(null);
export const [useCustomWatchlist, setUseCustomWatchlist] = createSignal<boolean>(false);
export const [symbolFlags, setSymbolFlags] = createSignal<Record<string, FlagColor>>(readInitialFlags());
export const [wlColumns, setWlColumns] = createSignal<Record<WatchlistColumnKey, boolean>>(readInitialCols());
export const [wlSort, setWlSort] = createSignal<WatchlistSortState>({ col: 'symbol', dir: 'none' });
export const [wlSearchQuery, setWlSearchQuery] = createSignal<string>('');
export const [symbolNotes, setSymbolNotes] = createSignal<SymbolNote[]>([]);

function persistLocalLists(lists: SavedWatchlist[]): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(LS_WLS_KEY, JSON.stringify(lists));
  } catch {
    // ignore
  }
}

function persistLocalFlags(flags: Record<string, FlagColor>): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(LS_FLAGS_KEY, JSON.stringify(flags));
  } catch {
    // ignore
  }
}

export function selectCustomWatchlist(id: string): void {
  setActiveFlagFilter(null);
  setActiveWatchlistIdSignal(id);
  setUseCustomWatchlist(true);
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(LS_ACTIVE_WL_KEY, id);
  } catch {
    // ignore
  }
}

export function selectFlaggedList(color: FlagColor | null): void {
  setActiveFlagFilter(color);
  if (color) {
    setUseCustomWatchlist(false);
  }
}

export function selectMarketTabMode(): void {
  setActiveFlagFilter(null);
  setUseCustomWatchlist(false);
}

export function activeWatchlist(): SavedWatchlist {
  const list = watchlists();
  const id = activeWatchlistId();
  return list.find((w) => w.id === id) ?? list[0] ?? DEFAULT_WATCHLISTS_LOCAL[0];
}

export function toggleWatchlistColumn(col: WatchlistColumnKey): void {
  const next = { ...wlColumns(), [col]: !wlColumns()[col] };
  setWlColumns(next);
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(LS_COLS_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
}

export function cycleWatchlistSort(col: WatchlistSortCol): void {
  setWlSort((cur) => nextWatchlistSort(cur, col));
}

export async function loadWatchlistsAndFlags(): Promise<void> {
  try {
    const res = await fetchWatchlistsApi();
    if (res.watchlists.length > 0) {
      setWatchlists(res.watchlists);
      persistLocalLists(res.watchlists);
      const curId = activeWatchlistId();
      if (!res.watchlists.some((w) => w.id === curId)) {
        setActiveWatchlistIdSignal(res.watchlists[0].id);
      }
    }
    if (res.flags && Object.keys(res.flags).length > 0) {
      setSymbolFlags(res.flags);
      persistLocalFlags(res.flags);
    }
  } catch {
    // keep local fallback
  }
}

async function saveAndReplaceWatchlist(target: SavedWatchlist): Promise<SavedWatchlist> {
  const updatedList = watchlists().map((w) => (w.id === target.id ? target : w));
  if (!updatedList.some((w) => w.id === target.id)) {
    updatedList.push(target);
  }
  setWatchlists(updatedList);
  persistLocalLists(updatedList);
  try {
    const saved = await saveWatchlistApi(target);
    if (saved) {
      const next = watchlists().map((w) => (w.id === target.id || w.id === saved.id ? saved : w));
      setWatchlists(next);
      persistLocalLists(next);
      return saved;
    }
  } catch {
    // keep optimistic local state
  }
  return target;
}

export async function createWatchlist(name: string, initialItems?: WatchlistEntry[]): Promise<SavedWatchlist> {
  const cleanName = name.trim() || `İzleme Listesi ${watchlists().length + 1}`;
  const tempId = `wl_${Date.now().toString(36)}`;
  const items: WatchlistEntry[] = initialItems ?? [
    { type: 'section', id: 'sec_1', title: tt("ANA TAKİP") },
    { type: 'symbol', symbol: 'THYAO.IS' },
    { type: 'symbol', symbol: 'BTCUSDT' },
    { type: 'symbol', symbol: 'NVDA' },
  ];
  const created = await saveAndReplaceWatchlist({ id: tempId, name: cleanName, items });
  selectCustomWatchlist(created.id);
  return created;
}

export async function renameWatchlist(id: string, newName: string): Promise<void> {
  const target = watchlists().find((w) => w.id === id);
  if (!target || !newName.trim()) return;
  await saveAndReplaceWatchlist({ ...target, name: newName.trim() });
}

export async function duplicateWatchlist(id: string): Promise<SavedWatchlist | null> {
  const target = watchlists().find((w) => w.id === id);
  if (!target) return null;
  return createWatchlist(`${target.name} (Kopya)`, target.items.map((it) => ({ ...it })));
}

export async function removeWatchlist(id: string): Promise<boolean> {
  if (watchlists().length <= 1) return false;
  const remaining = watchlists().filter((w) => w.id !== id);
  setWatchlists(remaining);
  persistLocalLists(remaining);
  if (activeWatchlistId() === id && remaining.length > 0) {
    setActiveWatchlistIdSignal(remaining[0].id);
  }
  try {
    await deleteWatchlistApi(id);
  } catch {
    // ignore
  }
  return true;
}

export async function addSymbolToWatchlist(rawSymbol: string, listId?: string): Promise<void> {
  const sym = rawSymbol.trim().toUpperCase();
  if (!sym) return;
  const wl = (listId ? watchlists().find((w) => w.id === listId) : null) ?? activeWatchlist();
  if (wl.items.some((it) => it.type === 'symbol' && it.symbol?.toUpperCase() === sym)) {
    return;
  }
  const items: WatchlistEntry[] = [...wl.items, { type: 'symbol', symbol: sym }];
  await saveAndReplaceWatchlist({ ...wl, items });
}

export async function removeSymbolFromWatchlist(symbol: string, listId?: string): Promise<void> {
  const sym = symbol.trim().toUpperCase();
  const wl = (listId ? watchlists().find((w) => w.id === listId) : null) ?? activeWatchlist();
  const items = wl.items.filter((it) => !(it.type === 'symbol' && it.symbol?.toUpperCase() === sym));
  await saveAndReplaceWatchlist({ ...wl, items });
}

export async function addSectionToWatchlist(title: string, listId?: string): Promise<void> {
  const clean = title.trim().replace(/^#+/, '').trim() || tt("YENİ BÖLÜM");
  const wl = (listId ? watchlists().find((w) => w.id === listId) : null) ?? activeWatchlist();
  const secId = `sec_${Date.now().toString(36)}`;
  const items: WatchlistEntry[] = [...wl.items, { type: 'section', id: secId, title: clean }];
  await saveAndReplaceWatchlist({ ...wl, items });
}

export async function renameSectionInWatchlist(secId: string, newTitle: string, listId?: string): Promise<void> {
  const clean = newTitle.trim();
  if (!clean) return;
  const wl = (listId ? watchlists().find((w) => w.id === listId) : null) ?? activeWatchlist();
  const items = wl.items.map((it) =>
    it.type === 'section' && it.id === secId ? { ...it, title: clean } : it
  );
  await saveAndReplaceWatchlist({ ...wl, items });
}

export async function toggleSectionCollapsed(secId: string, listId?: string): Promise<void> {
  const wl = (listId ? watchlists().find((w) => w.id === listId) : null) ?? activeWatchlist();
  const items = wl.items.map((it) =>
    it.type === 'section' && it.id === secId ? { ...it, collapsed: !it.collapsed } : it
  );
  await saveAndReplaceWatchlist({ ...wl, items });
}

export async function removeSectionFromWatchlist(secId: string, listId?: string): Promise<void> {
  const wl = (listId ? watchlists().find((w) => w.id === listId) : null) ?? activeWatchlist();
  const items = wl.items.filter((it) => !(it.type === 'section' && it.id === secId));
  await saveAndReplaceWatchlist({ ...wl, items });
}

export async function setSymbolFlag(symbol: string, color: FlagColor | ''): Promise<void> {
  const sym = symbol.trim().toUpperCase();
  if (!sym) return;
  const next = { ...symbolFlags() };
  if (!color) {
    delete next[sym];
  } else {
    next[sym] = color;
  }
  setSymbolFlags(next);
  persistLocalFlags(next);
  try {
    const serverFlags = await setSymbolFlagApi(sym, color);
    if (serverFlags) {
      setSymbolFlags(serverFlags);
      persistLocalFlags(serverFlags);
    }
  } catch {
    // keep optimistic local state
  }
}

export async function cycleSymbolFlag(symbol: string): Promise<void> {
  const sym = symbol.trim().toUpperCase();
  const cur = symbolFlags()[sym];
  if (!cur) {
    await setSymbolFlag(sym, FLAG_COLORS[0].id);
    return;
  }
  const idx = FLAG_COLORS.findIndex((c) => c.id === cur);
  if (idx < 0 || idx === FLAG_COLORS.length - 1) {
    await setSymbolFlag(sym, '');
  } else {
    await setSymbolFlag(sym, FLAG_COLORS[idx + 1].id);
  }
}

export function flaggedSymbolsByColor(color: FlagColor): string[] {
  const flags = symbolFlags();
  return Object.keys(flags).filter((sym) => flags[sym] === color);
}

export function flagCountsByColor(): Record<FlagColor, number> {
  const counts: Record<FlagColor, number> = {
    red: 0,
    blue: 0,
    green: 0,
    orange: 0,
    purple: 0,
    cyan: 0,
    pink: 0,
  };
  const flags = symbolFlags();
  for (const sym of Object.keys(flags)) {
    const c = flags[sym];
    if (c && counts[c] !== undefined) counts[c]++;
  }
  return counts;
}

export async function importWatchlistFromText(
  text: string,
  mode: 'append' | 'replace' | 'new' = 'replace',
  newListName?: string
): Promise<{ count: number; sections: number }> {
  const parsed = parseWatchlistImportText(text);
  const symCount = parsed.filter((e) => e.type === 'symbol').length;
  const secCount = parsed.filter((e) => e.type === 'section').length;
  if (parsed.length === 0) return { count: 0, sections: 0 };

  if (mode === 'new') {
    await createWatchlist(newListName?.trim() || tt("İçe Aktarılan Liste"), parsed);
    return { count: symCount, sections: secCount };
  }

  const wl = activeWatchlist();
  if (mode === 'replace') {
    await saveAndReplaceWatchlist({ ...wl, items: parsed });
    selectCustomWatchlist(wl.id);
    return { count: symCount, sections: secCount };
  }

  // append mode: merge new symbols and sections
  const existingSyms = new Set(
    wl.items.filter((it) => it.type === 'symbol' && it.symbol).map((it) => it.symbol!.toUpperCase())
  );
  const merged: WatchlistEntry[] = [...wl.items];
  for (const entry of parsed) {
    if (entry.type === 'section') {
      merged.push(entry);
    } else if (entry.symbol && !existingSyms.has(entry.symbol.toUpperCase())) {
      existingSyms.add(entry.symbol.toUpperCase());
      merged.push(entry);
    }
  }
  await saveAndReplaceWatchlist({ ...wl, items: merged });
  selectCustomWatchlist(wl.id);
  return { count: symCount, sections: secCount };
}

// ---------- Notlar & İşlem Günlüğü ----------

export async function loadSymbolNotes(symbol = ''): Promise<void> {
  try {
    const list = await fetchNotesApi(symbol);
    setSymbolNotes(list);
  } catch {
    // ignore
  }
}

export async function saveSymbolNote(
  note: Partial<SymbolNote> & { symbol: string; title: string; body: string }
): Promise<SymbolNote | null> {
  try {
    const saved = await saveNoteApi(note);
    if (saved) {
      setSymbolNotes((prev) => {
        const filtered = prev.filter((n) => n.id !== saved.id);
        return [saved, ...filtered].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt);
      });
      return saved;
    }
  } catch {
    // fallback local note for offline/unit test resilience
  }
  const now = Math.floor(Date.now() / 1000);
  const local: SymbolNote = {
    id: note.id || `note_${Date.now().toString(36)}`,
    symbol: note.symbol.toUpperCase(),
    title: note.title.trim() || note.body.trim().slice(0, 32),
    body: note.body.trim(),
    tags: note.tags ?? 'Analiz',
    sentiment: note.sentiment ?? 'neutral',
    snapshotPrice: note.snapshotPrice ?? 0,
    timeframe: note.timeframe ?? '15m',
    pinned: Boolean(note.pinned),
    createdAt: note.createdAt || now,
    updatedAt: now,
  };
  setSymbolNotes((prev) => [local, ...prev.filter((n) => n.id !== local.id)]);
  return local;
}

export async function deleteSymbolNote(id: string): Promise<void> {
  setSymbolNotes((prev) => prev.filter((n) => n.id !== id));
  try {
    await deleteNoteApi(id);
  } catch {
    // ignore
  }
}
