import { describe, expect, it, vi } from 'vitest';
import {
  desktopConfig,
  installDesktopBridge,
  isBackendPath,
  isDesktop,
  rewriteUrl,
  TOKEN_HEADER,
  wrapFetch,
} from '../bridge';

const cfg = { base: 'http://127.0.0.1:53111', token: 'tok' };
const mac = 'tauri://localhost';
const win = 'http://tauri.localhost';

describe('desktopConfig', () => {
  it('returns null outside Tauri or with incomplete config', () => {
    expect(desktopConfig(undefined)).toBeNull();
    expect(desktopConfig({})).toBeNull();
    expect(desktopConfig({ __TITAN_DESKTOP__: { base: '', token: 'x' } })).toBeNull();
    expect(desktopConfig({ __TITAN_DESKTOP__: { base: 'http://a', token: '' } })).toBeNull();
    expect(isDesktop({})).toBe(false);
  });
  it('trims trailing slashes', () => {
    expect(desktopConfig({ __TITAN_DESKTOP__: { base: 'http://127.0.0.1:1/', token: 't' } })?.base).toBe('http://127.0.0.1:1');
    expect(isDesktop({ __TITAN_DESKTOP__: cfg })).toBe(true);
  });
  it('reads window by default', () => {
    expect(desktopConfig()).toBeNull();
  });
});

describe('rewriteUrl', () => {
  it('detects backend paths', () => {
    expect(isBackendPath('/api/history?x=1')).toBe(true);
    expect(isBackendPath('/api')).toBe(true);
    expect(isBackendPath('/ws/live')).toBe(true);
    expect(isBackendPath('/healthz')).toBe(true);
    expect(isBackendPath('/assets/app.js')).toBe(false);
    expect(isBackendPath('/apiary')).toBe(false);
  });
  it('rewrites relative backend paths', () => {
    expect(rewriteUrl('/api/history?symbol=BTCUSDT', cfg, mac)).toBe('http://127.0.0.1:53111/api/history?symbol=BTCUSDT');
    expect(rewriteUrl('/api/alerts/stream', cfg, mac, 'http', true)).toBe('http://127.0.0.1:53111/api/alerts/stream?titan_token=tok');
  });
  it('rewrites same-origin absolute websocket urls (liveSocket builds ws://<host>/ws/live)', () => {
    expect(rewriteUrl('ws://localhost/ws/live?symbol=A', cfg, mac, 'ws', true)).toBe('ws://127.0.0.1:53111/ws/live?symbol=A&titan_token=tok');
    expect(rewriteUrl('ws://tauri.localhost/ws/live', cfg, win, 'ws', true)).toBe('ws://127.0.0.1:53111/ws/live?titan_token=tok');
  });
  it('leaves static assets, foreign hosts and junk alone', () => {
    expect(rewriteUrl('/assets/x.js', cfg, mac)).toBe('/assets/x.js');
    expect(rewriteUrl('https://api.binance.com/api/v3/klines', cfg, mac)).toBe('https://api.binance.com/api/v3/klines');
    expect(rewriteUrl('//cdn.example/api/x', cfg, mac)).toBe('//cdn.example/api/x');
    expect(rewriteUrl('http://[bad', cfg, mac)).toBe('http://[bad');
    expect(rewriteUrl('data:text/plain,hi', cfg, mac)).toBe('data:text/plain,hi');
  });
});

describe('wrapFetch', () => {
  it('routes backend calls with the token header and passes others through', async () => {
    const orig = vi.fn(async () => new Response('ok'));
    const f = wrapFetch(orig as unknown as typeof fetch, cfg, mac);
    await f('/api/symbols', { headers: { Accept: 'application/json' } });
    const [url, init] = orig.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:53111/api/symbols');
    const h = new Headers(init.headers);
    expect(h.get(TOKEN_HEADER)).toBe('tok');
    expect(h.get('Accept')).toBe('application/json');

    await f(new URL('tauri://localhost/api/quotes?s=A'));
    expect((orig.mock.calls[1] as unknown as [string])[0]).toBe('http://127.0.0.1:53111/api/quotes?s=A');

    await f('https://example.com/x');
    expect((orig.mock.calls[2] as unknown as [string])[0]).toBe('https://example.com/x');
  });
  it('rebuilds Request objects', async () => {
    const orig = vi.fn(async () => new Response('ok'));
    const f = wrapFetch(orig as unknown as typeof fetch, cfg, 'http://tauri.localhost');
    await f(new Request('http://tauri.localhost/api/layouts', { method: 'POST', body: '{}' }));
    const [req, init] = orig.mock.calls[0] as unknown as [Request, RequestInit];
    expect(req.url).toBe('http://127.0.0.1:53111/api/layouts');
    expect(req.method).toBe('POST');
    expect(new Headers(init.headers).get(TOKEN_HEADER)).toBe('tok');
  });
});

describe('installDesktopBridge', () => {
  it('is a no-op without config', () => {
    const t = { fetch: vi.fn() as unknown as typeof fetch, location: { origin: mac } };
    const before = t.fetch;
    expect(installDesktopBridge(t)).toBe(false);
    expect(t.fetch).toBe(before);
  });
  it('patches fetch, EventSource and WebSocket', () => {
    const seen: string[] = [];
    class FakeES {
      static CLOSED = 2;
      constructor(public url: string) {
        seen.push(url);
      }
    }
    class FakeWS {
      static OPEN = 1;
      constructor(public url: string, public proto?: string) {
        seen.push(url + (proto ? '|' + proto : ''));
      }
    }
    const t: any = { fetch: vi.fn(), EventSource: FakeES, WebSocket: FakeWS, location: { origin: mac }, __TITAN_DESKTOP__: cfg };
    expect(installDesktopBridge(t)).toBe(true);
    const es = new t.EventSource('/api/alerts/stream');
    const ws = new t.WebSocket('ws://localhost/ws/live?symbol=A', 'p1');
    new t.WebSocket('wss://stream.binance.com/ws');
    expect(es).toBeInstanceOf(FakeES);
    expect(ws).toBeInstanceOf(FakeWS);
    expect(t.WebSocket.OPEN).toBe(1);
    expect(t.EventSource.CLOSED).toBe(2);
    expect(seen).toEqual([
      'http://127.0.0.1:53111/api/alerts/stream?titan_token=tok',
      'ws://127.0.0.1:53111/ws/live?symbol=A&titan_token=tok|p1',
      'wss://stream.binance.com/ws',
    ]);
  });
});
