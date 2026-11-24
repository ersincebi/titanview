/**
 * Faz 31 — Masaüstü köprüsü.
 *
 * Tauri kabuğu `dist/`'i kendi kökeninden (`tauri://localhost`, Windows'ta
 * `http://tauri.localhost`) yükler; Go sunucusu ise rastgele bir loopback
 * portunda sidecar olarak çalışır. Kabuk, pencere oluşmadan önce
 * `window.__TITAN_DESKTOP__ = { base, token }` enjekte eder. Bu modül göreli
 * `/api`, `/ws`, `/healthz` isteklerini o adrese yönlendirir ve oturum
 * belirtecini ekler (fetch: başlık, EventSource/WebSocket: sorgu parametresi).
 */

export interface DesktopConfig {
  /** Sidecar kökü, ör. `http://127.0.0.1:53111` */
  base: string;
  /** Açılış başına rastgele oturum belirteci */
  token: string;
  /** Uygulama sürümü (Tauri paketinden) */
  version?: string;
  /** Kabuk platformu: macos | windows | linux | android */
  platform?: string;
}

export const TOKEN_HEADER = 'X-Titan-Token';
export const TOKEN_PARAM = 'titan_token';

const BACKEND_PREFIXES = ['/api/', '/api?', '/ws/', '/healthz'];

declare global {
  interface Window {
    __TITAN_DESKTOP__?: DesktopConfig;
  }
}

/** Masaüstü yapılandırması (yalnız Tauri içinde enjekte edilir). */
export function desktopConfig(win: { __TITAN_DESKTOP__?: DesktopConfig } | undefined = typeof window === 'undefined' ? undefined : window): DesktopConfig | null {
  const c = win?.__TITAN_DESKTOP__;
  if (!c || typeof c.base !== 'string' || typeof c.token !== 'string' || !c.base || !c.token) return null;
  return { ...c, base: c.base.replace(/\/+$/, '') };
}

export function isDesktop(win?: { __TITAN_DESKTOP__?: DesktopConfig }): boolean {
  return desktopConfig(win) !== null;
}

/** Yol arka uca mı gidiyor? (`/api/...`, `/ws/...`, `/healthz`) */
export function isBackendPath(path: string): boolean {
  return BACKEND_PREFIXES.some((p) => path === p.replace(/[/?]$/, '') || path.startsWith(p));
}

/**
 * Bir istek URL'sini sidecar'a çevirir. Göreli arka uç yolları ile sayfa
 * kökenine (tauri://localhost) mutlak verilmiş arka uç yolları çevrilir;
 * başka her şey (CDN, Binance, data:, blob:) olduğu gibi kalır.
 * `scheme`: 'http' (fetch/EventSource) veya 'ws' (WebSocket).
 */
export function rewriteUrl(raw: string, cfg: DesktopConfig, pageOrigin: string, scheme: 'http' | 'ws' = 'http', withToken = false): string {
  let path: string | null = null;
  if (raw.startsWith('/') && !raw.startsWith('//')) {
    path = raw;
  } else {
    try {
      const u = new URL(raw, pageOrigin);
      if (u.host === new URL(pageOrigin).host) path = u.pathname + u.search + u.hash;
    } catch {
      return raw;
    }
  }
  if (path === null || !isBackendPath(path)) return raw;
  let base = cfg.base;
  if (scheme === 'ws') base = base.replace(/^http/, 'ws');
  const out = new URL(base + path);
  if (withToken) out.searchParams.set(TOKEN_PARAM, cfg.token);
  return out.toString();
}

type FetchFn = typeof fetch;

/** fetch sarmalayıcı: arka uç isteklerini sidecar'a yönlendirir + belirteç başlığı ekler. */
export function wrapFetch(orig: FetchFn, cfg: DesktopConfig, pageOrigin: string): FetchFn {
  return (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const target = rewriteUrl(raw, cfg, pageOrigin);
    if (target === raw) return orig(input, init);
    if (typeof input === 'string' || input instanceof URL) {
      const headers = new Headers(init?.headers);
      headers.set(TOKEN_HEADER, cfg.token);
      return orig(target, { ...init, headers });
    }
    const req = new Request(target, input);
    const headers = new Headers(init?.headers ?? req.headers);
    headers.set(TOKEN_HEADER, cfg.token);
    return orig(req, { ...init, headers });
  };
}

type Ctor<T> = { new (url: string | URL, arg?: any): T; prototype: T };

function wrapCtor<T>(Orig: Ctor<T>, cfg: DesktopConfig, pageOrigin: string, scheme: 'http' | 'ws'): Ctor<T> {
  const Wrapped = function (this: unknown, url: string | URL, arg?: any) {
    const target = rewriteUrl(String(url), cfg, pageOrigin, scheme, true);
    return arg === undefined ? new Orig(target) : new Orig(target, arg);
  } as unknown as Ctor<T>;
  Wrapped.prototype = Orig.prototype;
  // CONNECTING/OPEN/CLOSED gibi statik sabitler korunur.
  for (const k of Object.getOwnPropertyNames(Orig)) {
    if (!(k in Wrapped)) {
      try {
        Object.defineProperty(Wrapped, k, Object.getOwnPropertyDescriptor(Orig, k)!);
      } catch {
        /* salt okunur yerleşik özellik */
      }
    }
  }
  return Wrapped;
}

export interface BridgeTarget {
  fetch: FetchFn;
  EventSource?: any;
  WebSocket?: any;
  location: { origin: string };
}

/**
 * Köprüyü kurar. Masaüstü değilse hiçbir şey yapmaz; kurulduysa true döner.
 * `override`: uzak sunucu modu (Faz 33) için kabuğun yerel sunucusu yerine kullanılacak yapılandırma.
 */
export function installDesktopBridge(win: BridgeTarget & { __TITAN_DESKTOP__?: DesktopConfig }, override?: DesktopConfig | null): boolean {
  const cfg = override ?? desktopConfig(win);
  if (!cfg) return false;
  const origin = win.location.origin;
  win.fetch = wrapFetch(win.fetch.bind(win), cfg, origin);
  if (win.EventSource) win.EventSource = wrapCtor(win.EventSource, cfg, origin, 'http');
  if (win.WebSocket) win.WebSocket = wrapCtor(win.WebSocket, cfg, origin, 'ws');
  return true;
}
