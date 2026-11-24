import { apiFetch } from './client';
import type { DrawingObject } from '../types/market';

export interface LayoutSummary {
  id: string;
  name: string;
  gridId: string;
  chartCount: number;
  symbols: string;
  autosave: boolean;
  isShared: boolean;
  shareToken?: string;
  createdAt: number;
  updatedAt: number;
}

export interface SavedLayoutRecord extends LayoutSummary {
  state: Record<string, unknown>;
}

export interface SharedLayoutResponse {
  layout: SavedLayoutRecord;
  drawings: Array<{
    id: string;
    symbol: string;
    timeframe: string;
    toolType: DrawingObject['toolType'];
    pointsJson: string;
    styleJson: string;
    layoutId?: string;
  }>;
  readOnly: true;
}

export async function listLayoutsApi(): Promise<LayoutSummary[]> {
  const resp = await apiFetch('/api/layouts');
  if (!resp.ok) throw new Error(`Düzenler yüklenemedi: ${resp.status}`);
  const data = (await resp.json()) as { layouts?: LayoutSummary[] };
  return data.layouts ?? [];
}

export async function getLayoutApi(id: string): Promise<SavedLayoutRecord> {
  const resp = await apiFetch(`/api/layouts/${encodeURIComponent(id)}`);
  if (!resp.ok) throw new Error(`Düzen yüklenemedi: ${resp.status}`);
  return (await resp.json()) as SavedLayoutRecord;
}

export async function createLayoutApi(payload: {
  name: string;
  state: Record<string, unknown>;
  gridId: string;
  chartCount: number;
  symbols: string;
  autosave?: boolean;
}): Promise<SavedLayoutRecord> {
  const resp = await apiFetch('/api/layouts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) throw new Error(`Düzen oluşturulamadı: ${resp.status}`);
  return (await resp.json()) as SavedLayoutRecord;
}

export async function updateLayoutApi(
  id: string,
  patch: {
    name?: string;
    state?: Record<string, unknown>;
    gridId?: string;
    chartCount?: number;
    symbols?: string;
    autosave?: boolean;
  },
  keepalive = false
): Promise<SavedLayoutRecord> {
  const resp = await apiFetch(`/api/layouts/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
    keepalive,
  });
  if (!resp.ok) throw new Error(`Düzen güncellenemedi: ${resp.status}`);
  return (await resp.json()) as SavedLayoutRecord;
}

export async function copyLayoutApi(id: string, name?: string): Promise<SavedLayoutRecord> {
  const resp = await apiFetch(`/api/layouts/${encodeURIComponent(id)}/copy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: name ?? '' }),
  });
  if (!resp.ok) throw new Error(`Düzen kopyalanamadı: ${resp.status}`);
  return (await resp.json()) as SavedLayoutRecord;
}

export async function shareLayoutApi(
  id: string,
  shared: boolean,
  regenerate = false
): Promise<{ id: string; isShared: boolean; shareToken?: string; updatedAt: number }> {
  const resp = await apiFetch(`/api/layouts/${encodeURIComponent(id)}/share`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ shared, regenerate }),
  });
  if (!resp.ok) throw new Error(`Paylaşım güncellenemedi: ${resp.status}`);
  return (await resp.json()) as { id: string; isShared: boolean; shareToken?: string; updatedAt: number };
}

export async function deleteLayoutApi(id: string): Promise<void> {
  const resp = await apiFetch(`/api/layouts/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!resp.ok) throw new Error(`Düzen silinemedi: ${resp.status}`);
}

export async function getSharedLayoutApi(token: string): Promise<SharedLayoutResponse> {
  const resp = await apiFetch(`/api/layouts/shared/${encodeURIComponent(token)}`);
  if (!resp.ok) throw new Error(resp.status === 404 ? 'Paylaşılan düzen bulunamadı veya paylaşım kapalı' : `Paylaşılan düzen açılamadı: ${resp.status}`);
  return (await resp.json()) as SharedLayoutResponse;
}
