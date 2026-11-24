// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { REMOTE_KEY } from '../../desktop/remote';
import { ServerModal } from '../ServerModal';

const TOK = 'abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG';
const $ = (s: string) => document.querySelector(s) as HTMLElement;
const reload = vi.fn();

// Node 26'nın deneysel global localStorage'ı jsdom'unkini gölgeler; bellek içi sahte depo.
const memStore = (() => {
  let m = new Map<string, string>();
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
    clear: () => void (m = new Map()),
  };
})();

beforeEach(() => {
  vi.stubGlobal('localStorage', memStore);
  localStorage.clear();
  Object.defineProperty(window, 'location', { configurable: true, value: { ...window.location, reload, origin: 'http://tauri.localhost' } });
  reload.mockReset();
});
afterEach(() => {
  cleanup();
  delete (window as { __TITAN_DESKTOP__?: unknown }).__TITAN_DESKTOP__;
  vi.unstubAllGlobals();
});

describe('ServerModal', () => {
  it('shell: pair link fills the form, test + save only after a good probe', async () => {
    (window as { __TITAN_DESKTOP__?: unknown }).__TITAN_DESKTOP__ = { base: 'http://127.0.0.1:5', token: 'l'.repeat(64), platform: 'android' };
    const fetchMock = vi.fn(async (_u: string, init?: RequestInit) => new Response('{}', { status: new Headers(init?.headers).get('X-Titan-Token') === TOK ? 200 : 401 }));
    vi.stubGlobal('fetch', fetchMock);
    render(() => <ServerModal />);
    expect(($('#radio-server-local') as HTMLInputElement).checked).toBe(true);
    fireEvent.click($('#radio-server-remote'));
    fireEvent.input($('#inp-server-pair'), { target: { value: `titanview://pair?server=${encodeURIComponent('http://192.168.1.20:8080')}&token=${TOK}` } });
    expect(($('#inp-server-url') as HTMLInputElement).value).toBe('http://192.168.1.20:8080');
    expect($('#modal-server').textContent).toContain('Düz http');
    fireEvent.click($('#btn-server-test'));
    await waitFor(() => expect($('#server-status').textContent).toContain('Bağlantı başarılı'));
    fireEvent.click($('#btn-server-save'));
    await waitFor(() => expect(reload).toHaveBeenCalled());
    expect(JSON.parse(localStorage.getItem(REMOTE_KEY)!)).toEqual({ server: 'http://192.168.1.20:8080', token: TOK });
  });

  it('shell: rejected token is not saved; local mode clears the remote', async () => {
    (window as { __TITAN_DESKTOP__?: unknown }).__TITAN_DESKTOP__ = { base: 'http://127.0.0.1:5', token: 'l'.repeat(64) };
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 401 })));
    localStorage.setItem(REMOTE_KEY, JSON.stringify({ server: 'https://r.example', token: TOK }));
    render(() => <ServerModal />);
    expect(($('#radio-server-remote') as HTMLInputElement).checked).toBe(true);
    fireEvent.input($('#inp-server-token'), { target: { value: 'x'.repeat(30) } });
    fireEvent.click($('#btn-server-save'));
    await waitFor(() => expect($('#server-status').textContent).toContain('Belirteç reddedildi'));
    expect(reload).not.toHaveBeenCalled();
    fireEvent.click($('#radio-server-local'));
    fireEvent.click($('#btn-server-save'));
    await waitFor(() => expect(reload).toHaveBeenCalled());
    expect(localStorage.getItem(REMOTE_KEY)).toBeNull();
  });

  it('browser: token login posts to /api/remote/login', async () => {
    const fetchMock = vi.fn(async (u: string) => new Response(null, { status: u === '/api/remote/login' ? 204 : 404 }));
    vi.stubGlobal('fetch', fetchMock);
    render(() => <ServerModal />);
    expect($('#radio-server-local')).toBeNull();
    fireEvent.input($('#inp-server-login'), { target: { value: TOK } });
    fireEvent.click($('#btn-server-login'));
    await waitFor(() => expect(reload).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0][0]).toBe('/api/remote/login');
  });
});
