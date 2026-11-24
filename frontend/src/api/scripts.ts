/** TitanScript betik kütüphanesi + sürüm geçmişi istemcisi (Faz 19). */
import { apiFetch, type SavedScriptItem } from './client';

export interface ScriptVersionItem {
  scriptId: string;
  version: number;
  name: string;
  code: string;
  createdAt: number;
}

async function failText(resp: Response): Promise<string> {
  try {
    const j = (await resp.json()) as { error?: string };
    return j.error || `HTTP ${resp.status}`;
  } catch {
    return `HTTP ${resp.status}`;
  }
}

export async function listScripts(): Promise<SavedScriptItem[]> {
  const resp = await apiFetch('/api/scripts');
  if (!resp.ok) throw new Error(await failText(resp));
  const data = (await resp.json()) as { scripts?: SavedScriptItem[] };
  return data.scripts ?? [];
}

export async function saveScript(s: { id?: string; name: string; code: string; isOverlay: boolean }): Promise<SavedScriptItem> {
  const resp = await apiFetch('/api/scripts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(s),
  });
  if (!resp.ok) throw new Error(await failText(resp));
  return (await resp.json()) as SavedScriptItem;
}

export async function deleteScript(id: string): Promise<void> {
  const resp = await apiFetch(`/api/scripts?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!resp.ok) throw new Error(await failText(resp));
}

export async function renameScript(id: string, name: string): Promise<void> {
  const resp = await apiFetch('/api/scripts/rename', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, name }),
  });
  if (!resp.ok) throw new Error(await failText(resp));
}

export async function listVersions(id: string): Promise<ScriptVersionItem[]> {
  const resp = await apiFetch(`/api/scripts/versions?id=${encodeURIComponent(id)}`);
  if (!resp.ok) throw new Error(await failText(resp));
  const data = (await resp.json()) as { versions?: ScriptVersionItem[] };
  return data.versions ?? [];
}
