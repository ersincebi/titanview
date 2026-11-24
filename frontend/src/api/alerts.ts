import { apiFetch } from './client';
import type { AlertDelivery, AlertDraft, AlertLogEntry, ServerAlert } from '../state/alerts';

async function json<T>(resp: Response): Promise<T> {
  const body = (await resp.json().catch(() => ({}))) as T & { error?: string };
  if (!resp.ok) throw new Error(body?.error || `HTTP ${resp.status}`);
  return body;
}

const send = (method: string, url: string, body?: unknown) =>
  apiFetch(url, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

export async function listAlerts(): Promise<ServerAlert[]> {
  return (await json<{ alerts: ServerAlert[] }>(await apiFetch('/api/alerts'))).alerts ?? [];
}

export async function createAlertApi(d: AlertDraft): Promise<ServerAlert> {
  return json<ServerAlert>(await send('POST', '/api/alerts', d));
}

export async function updateAlertApi(id: string, d: AlertDraft): Promise<ServerAlert> {
  return json<ServerAlert>(await send('PUT', `/api/alerts?id=${encodeURIComponent(id)}`, d));
}

export async function deleteAlertApi(id: string): Promise<void> {
  await json(await send('DELETE', `/api/alerts?id=${encodeURIComponent(id)}`));
}

export type AlertAction = 'stop' | 'restart' | 'clone';
export type BulkAction = 'stop_all' | 'restart_all' | 'delete_all' | 'delete_inactive';

export async function alertAction(id: string, action: AlertAction): Promise<ServerAlert> {
  return json<ServerAlert>(await send('POST', `/api/alerts/action?do=${action}&id=${encodeURIComponent(id)}`));
}

export async function bulkAlertAction(action: BulkAction): Promise<number> {
  return (await json<{ affected: number }>(await send('POST', `/api/alerts/action?do=${action}`))).affected;
}

export async function fetchAlertLog(after = 0, limit = 200): Promise<AlertLogEntry[]> {
  return (await json<{ log: AlertLogEntry[] }>(await apiFetch(`/api/alerts/log?after=${after}&limit=${limit}`))).log ?? [];
}

export async function clearAlertLog(): Promise<void> {
  await json(await send('DELETE', '/api/alerts/log'));
}

export interface NtfyConfig {
  enabled: boolean;
  server: string;
  topic: string;
  tokenSet?: boolean;
  token?: string;
}

export interface AlertConfig {
  telegram: { enabled: boolean; chatId: string; tokenSet: boolean };
  ntfy?: NtfyConfig;
  pushSubscriptions: number;
}

export async function fetchAlertConfig(): Promise<AlertConfig> {
  return json<AlertConfig>(await apiFetch('/api/alerts/config'));
}

export async function saveAlertConfig(t: { enabled: boolean; chatId: string; token?: string }, ntfy?: NtfyConfig): Promise<AlertConfig> {
  return json<AlertConfig>(await send('PUT', '/api/alerts/config', ntfy ? { telegram: t, ntfy } : { telegram: t }));
}

export async function testAlertChannel(channel: 'telegram' | 'ntfy' | 'push' | 'webhook', url?: string): Promise<AlertDelivery> {
  const q = url ? `&url=${encodeURIComponent(url)}` : '';
  const resp = await send('POST', `/api/alerts/test?channel=${channel}${q}`);
  const body = (await resp.json().catch(() => ({}))) as AlertDelivery & { error?: string };
  if (body.error) return { channel, ok: false, detail: body.error };
  return body;
}

export async function fetchPushKey(): Promise<string> {
  return (await json<{ publicKey: string }>(await apiFetch('/api/alerts/push/key'))).publicKey;
}

export async function savePushSubscription(sub: PushSubscriptionJSON): Promise<void> {
  await json(await send('POST', '/api/alerts/push/subscribe', sub));
}

export async function deletePushSubscription(endpoint: string): Promise<void> {
  await json(await send('DELETE', `/api/alerts/push/subscribe?endpoint=${encodeURIComponent(endpoint)}`));
}
