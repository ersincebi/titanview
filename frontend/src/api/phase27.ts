import { tfmt, tt } from '../state/i18n';
import { LANG_NAME } from '../script/brand';
import type {
  FlagColor,
  FundamentalsReport,
  ScriptScreenerFilter,
  ScriptScreenerResponse,
  SavedScreenerPreset,
  SavedWatchlist,
  SymbolNote,
  WatchlistEntry,
} from '../types/market';
import type { SecurityResponse } from './client';

async function p27Fetch(input: string, init?: RequestInit): Promise<Response> {
  return fetch(input, init);
}

export async function fetchWatchlistsApi(): Promise<{ watchlists: SavedWatchlist[]; flags: Record<string, FlagColor> }> {
  const resp = await p27Fetch('/api/watchlists');
  if (!resp.ok) return { watchlists: [], flags: {} };
  const data = (await resp.json()) as { watchlists?: SavedWatchlist[]; flags?: Record<string, FlagColor> };
  return {
    watchlists: data.watchlists ?? [],
    flags: data.flags ?? {},
  };
}

export async function saveWatchlistApi(
  wl: Partial<SavedWatchlist> & { name: string; items: WatchlistEntry[] }
): Promise<SavedWatchlist | null> {
  const resp = await p27Fetch('/api/watchlists', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(wl),
  });
  if (!resp.ok) return null;
  return (await resp.json()) as SavedWatchlist;
}

export async function deleteWatchlistApi(id: string): Promise<boolean> {
  const resp = await p27Fetch(`/api/watchlists?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
  return resp.ok;
}

export async function setSymbolFlagApi(
  symbol: string,
  color: FlagColor | ''
): Promise<Record<string, FlagColor> | null> {
  const resp = await p27Fetch('/api/watchlists/flag', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ symbol, color }),
  });
  if (!resp.ok) return null;
  const data = (await resp.json()) as { flags?: Record<string, FlagColor> };
  return data.flags ?? {};
}

export async function fetchNotesApi(symbol = ''): Promise<SymbolNote[]> {
  const q = symbol.trim() ? `?symbol=${encodeURIComponent(symbol.trim())}` : '';
  const resp = await p27Fetch(`/api/notes${q}`);
  if (!resp.ok) return [];
  const data = (await resp.json()) as { notes?: SymbolNote[] };
  return data.notes ?? [];
}

export async function saveNoteApi(
  note: Partial<SymbolNote> & { symbol: string; title: string; body: string }
): Promise<SymbolNote | null> {
  const resp = await p27Fetch('/api/notes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(note),
  });
  if (!resp.ok) return null;
  return (await resp.json()) as SymbolNote;
}

export async function deleteNoteApi(id: string): Promise<boolean> {
  const resp = await p27Fetch(`/api/notes?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
  return resp.ok;
}

export async function fetchScreenerPresetsApi(): Promise<SavedScreenerPreset[]> {
  const resp = await p27Fetch('/api/screener/presets');
  if (!resp.ok) return [];
  const data = (await resp.json()) as { presets?: SavedScreenerPreset[] };
  return data.presets ?? [];
}

export async function saveScreenerPresetApi(
  preset: Partial<SavedScreenerPreset> & { name: string }
): Promise<SavedScreenerPreset | null> {
  const resp = await p27Fetch('/api/screener/presets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(preset),
  });
  if (!resp.ok) return null;
  return (await resp.json()) as SavedScreenerPreset;
}

export async function deleteScreenerPresetApi(id: string): Promise<boolean> {
  const resp = await p27Fetch(`/api/screener/presets?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
  return resp.ok;
}

export interface ScriptScreenerRunParams {
  code: string;
  timeframe: string;
  market?: string;
  watchlistId?: string;
  flagColor?: string;
  symbols?: string[];
  filters?: ScriptScreenerFilter[];
  onlyMatched?: boolean;
}

export async function runScriptScreenerApi(params: ScriptScreenerRunParams): Promise<ScriptScreenerResponse> {
  const resp = await p27Fetch('/api/screener/script', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const data = (await resp.json()) as ScriptScreenerResponse;
  if (!resp.ok) {
    return {
      ok: false,
      error: data.error || `HTTP ${resp.status}`,
      scriptTitle: tfmt("{0} Tarayıcı", LANG_NAME),
      timeframe: params.timeframe,
      columns: [],
      conditions: [],
      rows: [],
    };
  }
  return data;
}

export async function fetchSymbolCardSecurity(symbol: string): Promise<SecurityResponse | null> {
  const resp = await p27Fetch(`/api/security?symbol=${encodeURIComponent(symbol)}`);
  if (!resp.ok) return null;
  return (await resp.json()) as SecurityResponse;
}

export async function fetchSymbolCardFundamentals(symbol: string): Promise<FundamentalsReport | null> {
  const resp = await p27Fetch(`/api/fundamentals?symbol=${encodeURIComponent(symbol)}`);
  if (!resp.ok) return null;
  return (await resp.json()) as FundamentalsReport;
}
