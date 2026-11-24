/**
 * Faz 33 — Uzak sunucu modu.
 *
 * Masaüstü ve Android kabuğu kendi yerel Go sunucusunu `__TITAN_DESKTOP__`
 * ile verir. Kullanıcı Ayarlar → Sunucu'dan başka bir TitanView sunucusu
 * (`titanview-server -remote`) seçerse arka uç istekleri oraya, kalıcı
 * belirteçle gider. Seçim bu cihazda `localStorage`'da tutulur.
 * Tarayıcıda (kabuk yok) sunucunun kendi sayfası belirteci çerezle alır
 * (`POST /api/remote/login`).
 */
import type { DesktopConfig } from './bridge';
import { TOKEN_HEADER } from './bridge';

export const REMOTE_KEY = 'titan_remote_v1';

export interface RemoteConfig {
  /** Ör. `https://titan.example.com` ya da `http://192.168.1.20:8080` */
  server: string;
  token: string;
}

type KV = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function storage(): KV | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** Sunucu adresini doğrular ve sondaki `/` işaretlerini atar; geçersizse null. */
export function normalizeServer(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  try {
    const u = new URL(s);
    if ((u.protocol !== 'http:' && u.protocol !== 'https:') || !u.host || u.username || u.password) return null;
    if (u.search || u.hash) return null;
    return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, '')}`;
  } catch {
    return null;
  }
}

export function validToken(tok: string): boolean {
  return tok.length >= 24 && !/\s/.test(tok);
}

/** Yerel olmayan düz http: belirteç ağda açık gider (arayüz uyarır). */
export function isInsecure(server: string): boolean {
  try {
    const u = new URL(server);
    if (u.protocol !== 'http:') return false;
    return !['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname);
  } catch {
    return true;
  }
}

/** `titanview://pair?server=…&token=…` bağlantısını çözer (sunucu `-remote` ile basar). */
export function parsePairLink(text: string): RemoteConfig | null {
  const s = text.trim();
  const m = /^titanview:\/\/pair\?(.*)$/i.exec(s);
  if (!m) return null;
  const q = new URLSearchParams(m[1]);
  const server = normalizeServer(q.get('server') ?? '');
  const token = (q.get('token') ?? '').trim();
  if (!server || !validToken(token)) return null;
  return { server, token };
}

export function loadRemote(kv: KV | null = storage()): RemoteConfig | null {
  try {
    const raw = kv?.getItem(REMOTE_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as Partial<RemoteConfig>;
    const server = normalizeServer(String(c.server ?? ''));
    const token = String(c.token ?? '');
    return server && validToken(token) ? { server, token } : null;
  } catch {
    return null;
  }
}

export function saveRemote(c: RemoteConfig, kv: KV | null = storage()): void {
  const server = normalizeServer(c.server);
  if (!server || !validToken(c.token)) throw new Error('geçersiz sunucu ya da belirteç');
  kv?.setItem(REMOTE_KEY, JSON.stringify({ server, token: c.token }));
}

export function clearRemote(kv: KV | null = storage()): void {
  kv?.removeItem(REMOTE_KEY);
}

export type BackendMode = 'local' | 'remote';

/**
 * Köprünün kullanacağı yapılandırma: kabuk varsa ve uzak sunucu seçildiyse
 * uzak sunucu, yoksa kabuğun yerel sunucusu. Kabuk yoksa null (aynı köken).
 */
export function effectiveConfig(shell: DesktopConfig | null, remote: RemoteConfig | null): (DesktopConfig & { mode: BackendMode }) | null {
  if (!shell) return null;
  if (remote) return { ...shell, base: remote.server, token: remote.token, mode: 'remote' };
  return { ...shell, mode: 'local' };
}

export type ProbeResult = 'ok' | 'unauthorized' | 'unreachable' | 'error';

/** Sunucuya belirteçle erişilebiliyor mu? (`/api/alerts/config` korumalı uç) */
export async function probeServer(c: RemoteConfig, f: typeof fetch = fetch, timeoutMs = 6000): Promise<ProbeResult> {
  const ctl = typeof AbortController === 'undefined' ? null : new AbortController();
  const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null;
  try {
    const resp = await f(`${c.server}/api/alerts/config`, { headers: { [TOKEN_HEADER]: c.token }, signal: ctl?.signal });
    if (resp.status === 401 || resp.status === 403 || resp.status === 429) return 'unauthorized';
    return resp.ok ? 'ok' : 'error';
  } catch {
    return 'unreachable';
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Tarayıcı oturumu: sunucunun kendi sayfasında belirteci çereze çevirir. */
export async function browserLogin(token: string, f: typeof fetch = fetch): Promise<boolean> {
  const resp = await f('/api/remote/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: token.trim() }) });
  return resp.status === 204 || resp.ok;
}

let activeMode: BackendMode | null = null;
/** main.tsx kurulumda bildirir; arayüz hangi modda olduğunu buradan okur. */
export function setActiveMode(m: BackendMode | null): void {
  activeMode = m;
}
export function activeBackendMode(): BackendMode | null {
  return activeMode;
}

interface TauriInternals {
  invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
}

/**
 * Uzak modda alarm bildirimi kabuktan gösterilir (yerel modda Rust izleyicisi
 * zaten gösterir; çift bildirim olmasın diye yalnız uzak modda).
 */
export function nativeNotify(title: string, body: string, win: { __TAURI_INTERNALS__?: TauriInternals } = (typeof window === 'undefined' ? {} : (window as never))): boolean {
  if (activeMode !== 'remote') return false;
  const inv = win.__TAURI_INTERNALS__?.invoke;
  if (!inv) return false;
  void inv('notify', { title, body }).catch(() => undefined);
  return true;
}
