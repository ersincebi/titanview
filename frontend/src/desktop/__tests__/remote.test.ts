import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  browserLogin,
  clearRemote,
  effectiveConfig,
  isInsecure,
  loadRemote,
  nativeNotify,
  normalizeServer,
  parsePairLink,
  probeServer,
  REMOTE_KEY,
  saveRemote,
  setActiveMode,
} from '../remote';

const TOK = 'abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG';

function memKV() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m };
}

afterEach(() => setActiveMode(null));

describe('remote server config', () => {
  it('normalizes and validates server addresses', () => {
    expect(normalizeServer(' https://titan.example.com/ ')).toBe('https://titan.example.com');
    expect(normalizeServer('http://192.168.1.20:8080')).toBe('http://192.168.1.20:8080');
    expect(normalizeServer('https://h.example/titan/')).toBe('https://h.example/titan');
    for (const bad of ['', 'ftp://x', 'titan.example.com', 'https://u:p@x', 'https://x/?a=1', 'javascript:alert(1)']) {
      expect(normalizeServer(bad)).toBeNull();
    }
  });

  it('flags plain http outside loopback', () => {
    expect(isInsecure('http://192.168.1.20:8080')).toBe(true);
    expect(isInsecure('http://127.0.0.1:9')).toBe(false);
    expect(isInsecure('https://x.example')).toBe(false);
  });

  it('parses pair links printed by the server', () => {
    const link = `titanview://pair?server=${encodeURIComponent('https://home.example:8443/')}&token=${TOK}`;
    expect(parsePairLink(link)).toEqual({ server: 'https://home.example:8443', token: TOK });
    expect(parsePairLink('titanview://pair?server=https://x&token=short')).toBeNull();
    expect(parsePairLink('https://x')).toBeNull();
  });

  it('round-trips through storage and rejects junk', () => {
    const kv = memKV();
    expect(loadRemote(kv)).toBeNull();
    saveRemote({ server: 'https://a.example/', token: TOK }, kv);
    expect(loadRemote(kv)).toEqual({ server: 'https://a.example', token: TOK });
    expect(() => saveRemote({ server: 'nope', token: TOK }, kv)).toThrow();
    kv.setItem(REMOTE_KEY, '{bad');
    expect(loadRemote(kv)).toBeNull();
    clearRemote(kv);
    expect(kv.m.size).toBe(0);
  });

  it('picks remote over the shell server only inside a shell', () => {
    const shell = { base: 'http://127.0.0.1:5000', token: 'local', platform: 'android' } as never;
    const remote = { server: 'https://r.example', token: TOK };
    expect(effectiveConfig(null, remote)).toBeNull();
    expect(effectiveConfig(shell, null)).toMatchObject({ base: 'http://127.0.0.1:5000', mode: 'local' });
    expect(effectiveConfig(shell, remote)).toMatchObject({ base: 'https://r.example', token: TOK, mode: 'remote', platform: 'android' });
  });

  it('probes with the token header', async () => {
    const f = vi.fn(async (_u: RequestInfo | URL, init?: RequestInit) => {
      const h = new Headers(init?.headers);
      return new Response('{}', { status: h.get('X-Titan-Token') === TOK ? 200 : 401 });
    }) as unknown as typeof fetch;
    expect(await probeServer({ server: 'https://r.example', token: TOK }, f)).toBe('ok');
    expect(await probeServer({ server: 'https://r.example', token: 'x'.repeat(30) }, f)).toBe('unauthorized');
    const down = (async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    expect(await probeServer({ server: 'https://r.example', token: TOK }, down)).toBe('unreachable');
    const boom = (async () => new Response('', { status: 500 })) as unknown as typeof fetch;
    expect(await probeServer({ server: 'https://r.example', token: TOK }, boom)).toBe('error');
  });

  it('logs a browser in with a cookie request', async () => {
    const f = vi.fn(async () => new Response(null, { status: 204 })) as unknown as typeof fetch;
    expect(await browserLogin(` ${TOK} `, f)).toBe(true);
    const [url, init] = (f as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0];
    expect(url).toBe('/api/remote/login');
    expect(JSON.parse(String(init.body))).toEqual({ token: TOK });
  });

  it('shows native notifications only in remote mode', () => {
    const invoke = vi.fn(async () => undefined);
    const win = { __TAURI_INTERNALS__: { invoke } };
    expect(nativeNotify('a', 'b', win)).toBe(false);
    setActiveMode('local');
    expect(nativeNotify('a', 'b', win)).toBe(false);
    setActiveMode('remote');
    expect(nativeNotify('t', 'm', win)).toBe(true);
    expect(invoke).toHaveBeenCalledWith('notify', { title: 't', body: 'm' });
    expect(nativeNotify('t', 'm', {})).toBe(false);
  });
});
