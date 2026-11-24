import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { canRegister } from '../register';

const root = resolve(import.meta.dirname, '../../../..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

describe('manifest', () => {
  const m = JSON.parse(read('public/manifest.webmanifest'));
  it('is installable: name, standalone display, start_url inside scope, dark theme', () => {
    expect(m.name).toBeTruthy();
    expect(m.short_name).toBeTruthy();
    expect(m.display).toBe('standalone');
    expect(m.start_url.startsWith(m.scope)).toBe(true);
    expect(m.theme_color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(m.background_color).toMatch(/^#[0-9a-f]{6}$/i);
  });
  it('declares 192 + 512 + maskable icons that exist on disk with matching size', () => {
    const sizes = m.icons.map((i: { sizes: string; purpose?: string }) => `${i.sizes}:${i.purpose}`);
    expect(sizes).toContain('192x192:any');
    expect(sizes).toContain('512x512:any');
    expect(sizes).toContain('512x512:maskable');
    for (const icon of m.icons as Array<{ src: string; sizes: string }>) {
      const f = resolve(root, 'public', icon.src.replace(/^\//, ''));
      expect(existsSync(f)).toBe(true);
      expect(statSync(f).size).toBeGreaterThan(500);
      const png = readFileSync(f);
      expect(png.subarray(1, 4).toString()).toBe('PNG');
      const [w, h] = icon.sizes.split('x').map(Number);
      expect(png.readUInt32BE(16)).toBe(w);
      expect(png.readUInt32BE(20)).toBe(h);
    }
  });
});

describe('index.html', () => {
  const html = read('index.html');
  it('links manifest, apple touch icon, theme color and safe-area viewport', () => {
    expect(html).toContain('rel="manifest" href="/manifest.webmanifest"');
    expect(html).toContain('rel="apple-touch-icon"');
    expect(html).toContain('name="theme-color"');
    expect(html).toContain('viewport-fit=cover');
    expect(existsSync(resolve(root, 'public/icons/apple-touch-icon.png'))).toBe(true);
  });
});

type Handler = (e: unknown) => void;

/** Sahte Cache API + fetch ile sw.js'i gerçekten çalıştırır. */
function loadSw(network: { online: boolean; calls: string[] }) {
  const listeners: Record<string, Handler> = {};
  const stores = new Map<string, Map<string, { body: string; ok: boolean }>>();
  const keyOf = (r: unknown) => {
    const u = typeof r === 'string' ? r : (r as { url: string }).url;
    return u.startsWith('http') ? new URL(u).pathname + new URL(u).search : u;
  };
  const mkResp = (body: string, ok = true) => ({ body, ok, clone() { return mkResp(body, ok); } });
  const caches = {
    open: async (name: string) => {
      if (!stores.has(name)) stores.set(name, new Map());
      const m = stores.get(name)!;
      return {
        addAll: async (urls: string[]) => urls.forEach((u) => m.set(u, mkResp('precached:' + u))),
        put: async (r: unknown, res: { body: string; ok: boolean }) => void m.set(keyOf(r), res),
        match: async (r: unknown) => m.get(keyOf(r)),
      };
    },
    keys: async () => [...stores.keys()],
    delete: async (n: string) => stores.delete(n),
  };
  const fetchFn = async (r: unknown) => {
    network.calls.push(keyOf(r));
    if (!network.online) throw new TypeError('offline');
    return mkResp('net:' + keyOf(r));
  };
  const self: Record<string, unknown> = {
    location: { origin: 'https://t.example' },
    addEventListener: (t: string, fn: Handler) => (listeners[t] = fn),
    skipWaiting: async () => {},
    clients: { claim: async () => {} },
  };
  vm.runInNewContext(read('public/sw.js'), { self, URL, caches, fetch: fetchFn, Promise });
  const sw = self.__titanSw as { decide: (...a: string[]) => string; PRECACHE: string[] };
  const fire = async (url: string, mode: string, method = 'GET') => {
    let p: Promise<{ body: string }> | undefined;
    listeners.fetch({
      request: { method, url: `https://t.example${url}`, mode },
      respondWith: (x: Promise<{ body: string }>) => (p = x),
    });
    return p ? await p : undefined;
  };
  return { sw, listeners, stores, fire };
}

describe('service worker policy', () => {
  const O = 'https://t.example';
  const { sw } = loadSw({ online: true, calls: [] });
  it('never touches market data: /api, /ws, non-GET, cross-origin', () => {
    expect(sw.decide('GET', `${O}/api/history?symbol=BTCUSDT`, 'cors', O)).toBe('bypass');
    expect(sw.decide('GET', `${O}/api/overview`, 'cors', O)).toBe('bypass');
    expect(sw.decide('GET', `${O}/ws/live`, 'websocket', O)).toBe('bypass');
    expect(sw.decide('POST', `${O}/api/drawings`, 'cors', O)).toBe('bypass');
    expect(sw.decide('GET', 'https://fonts.googleapis.com/css2', 'no-cors', O)).toBe('bypass');
    expect(sw.decide('GET', `${O}/sw.js`, 'same-origin', O)).toBe('bypass');
  });
  it('navigations are network-first, hashed assets cache-first, other static stale-while-revalidate', () => {
    expect(sw.decide('GET', `${O}/`, 'navigate', O)).toBe('navigate');
    expect(sw.decide('GET', `${O}/chart/x`, 'navigate', O)).toBe('navigate');
    expect(sw.decide('GET', `${O}/assets/index-abc.js`, 'cors', O)).toBe('asset');
    expect(sw.decide('GET', `${O}/icons/icon-192.png`, 'no-cors', O)).toBe('static');
    expect(sw.decide('GET', `${O}/manifest.webmanifest`, 'cors', O)).toBe('static');
  });
  it('precaches only shell files (no API urls)', () => {
    expect(sw.PRECACHE).toContain('/');
    expect(sw.PRECACHE.some((p) => p.startsWith('/api'))).toBe(false);
  });
});

describe('service worker behaviour (fake Cache API)', () => {
  it('install precaches the shell; activate drops old cache versions', async () => {
    const net = { online: true, calls: [] as string[] };
    const { listeners, stores } = loadSw(net);
    stores.set('titanview-shell-v0', new Map());
    let done: Promise<unknown> | undefined;
    listeners.install({ waitUntil: (p: Promise<unknown>) => (done = p) });
    await done;
    expect(stores.get('titanview-shell-v1')!.has('/')).toBe(true);
    listeners.activate({ waitUntil: (p: Promise<unknown>) => (done = p) });
    await done;
    expect(stores.has('titanview-shell-v0')).toBe(false);
    expect(stores.has('titanview-shell-v1')).toBe(true);
  });

  it('API requests are never intercepted nor cached', async () => {
    const net = { online: true, calls: [] as string[] };
    const { fire, stores } = loadSw(net);
    expect(await fire('/api/history?symbol=BTCUSDT', 'cors')).toBeUndefined();
    expect(await fire('/ws/live', 'websocket')).toBeUndefined();
    expect(net.calls).toEqual([]);
    for (const m of stores.values()) expect([...m.keys()].some((k) => k.startsWith('/api'))).toBe(false);
  });

  it('offline navigation serves the cached shell; online navigation refreshes it', async () => {
    const net = { online: true, calls: [] as string[] };
    const { fire, listeners } = loadSw(net);
    let done: Promise<unknown> | undefined;
    listeners.install({ waitUntil: (p: Promise<unknown>) => (done = p) });
    await done;
    expect((await fire('/', 'navigate'))!.body).toBe('net:/');
    net.online = false;
    expect((await fire('/', 'navigate'))!.body).toBe('net:/'); // son başarılı ağ yanıtı önbellekte
    expect((await fire('/chart/BTC', 'navigate'))!.body).toBe('net:/');
  });

  it('hashed assets are served from cache without hitting the network twice', async () => {
    const net = { online: true, calls: [] as string[] };
    const { fire } = loadSw(net);
    await fire('/assets/index-abc.js', 'cors');
    net.online = false;
    expect((await fire('/assets/index-abc.js', 'cors'))!.body).toBe('net:/assets/index-abc.js');
    expect(net.calls.filter((c) => c === '/assets/index-abc.js')).toHaveLength(1);
  });
});

describe('registration guard', () => {
  it('registers only in production, with SW support, on a secure context', () => {
    expect(canRegister({ prod: true, hasSW: true, secure: true })).toBe(true);
    expect(canRegister({ prod: false, hasSW: true, secure: true })).toBe(false);
    expect(canRegister({ prod: true, hasSW: false, secure: true })).toBe(false);
    expect(canRegister({ prod: true, hasSW: true, secure: false })).toBe(false);
  });
});

describe('service worker Web Push (Faz 23 alarm motoru)', () => {
  function pushSw() {
    const listeners: Record<string, (e: any) => void> = {};
    const shown: Array<[string, any]> = [];
    const focused: string[] = [];
    const opened: string[] = [];
    let windows: Array<{ focus: () => Promise<void> }> = [];
    const self: Record<string, any> = {
      location: { origin: 'https://t.example' },
      addEventListener: (t: string, fn: (e: any) => void) => (listeners[t] = fn),
      skipWaiting: async () => {},
      registration: { showNotification: async (t: string, o: any) => void shown.push([t, o]) },
      clients: {
        claim: async () => {},
        matchAll: async () => windows,
        openWindow: async (u: string) => void opened.push(u),
      },
    };
    vm.runInNewContext(read('public/sw.js'), { self, URL, caches: {}, fetch: async () => ({}), Promise });
    const wait = async (fire: (w: (p: Promise<unknown>) => void) => void) => {
      let p: Promise<unknown> | undefined;
      fire((x) => (p = x));
      await p;
    };
    return { listeners, shown, focused, opened, setWindows: (w: typeof windows) => (windows = w), wait };
  }

  it('shows the alert payload as a notification (title, body, tag, symbol)', async () => {
    const sw = pushSw();
    const data = { title: 'BTC 65k', body: 'BTCUSDT 65001 üstünde', tag: 'alert-a1', symbol: 'BTCUSDT', alertId: 'a1', time: 5 };
    await sw.wait((w) => sw.listeners.push({ data: { json: () => data, text: () => '' }, waitUntil: w }));
    expect(sw.shown).toHaveLength(1);
    const [title, opts] = sw.shown[0];
    expect(title).toBe('BTC 65k');
    expect(opts).toMatchObject({ body: 'BTCUSDT 65001 üstünde', tag: 'alert-a1', renotify: true, requireInteraction: true, timestamp: 5, data: { symbol: 'BTCUSDT', alertId: 'a1' } });
  });

  it('falls back to text / default title for malformed payloads', async () => {
    const sw = pushSw();
    await sw.wait((w) => sw.listeners.push({ data: { json: () => { throw new Error('x'); }, text: () => 'düz metin' }, waitUntil: w }));
    await sw.wait((w) => sw.listeners.push({ data: null, waitUntil: w }));
    expect(sw.shown.map(([t, o]) => [t, o.body])).toEqual([
      ['TitanView alarmı', 'düz metin'],
      ['TitanView alarmı', ''],
    ]);
  });

  it('notification click focuses an open window, otherwise opens the symbol', async () => {
    const sw = pushSw();
    const close = () => {};
    await sw.wait((w) => sw.listeners.notificationclick({ notification: { close, data: { symbol: 'THYAO.IS' } }, waitUntil: w }));
    expect(sw.opened).toEqual(['/?symbol=THYAO.IS']);
    let focusedCount = 0;
    const posted: unknown[] = [];
    sw.setWindows([{ focus: async () => void focusedCount++, postMessage: (m: unknown) => void posted.push(m) } as never]);
    await sw.wait((w) => sw.listeners.notificationclick({ notification: { close, data: { symbol: 'BTCUSDT' } }, waitUntil: w }));
    expect(focusedCount).toBe(1);
    expect(posted).toEqual([{ type: 'titan-alert-open', symbol: 'BTCUSDT' }]);
    expect(sw.opened).toHaveLength(1);
  });
});
