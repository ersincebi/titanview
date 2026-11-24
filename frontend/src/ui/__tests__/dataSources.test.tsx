// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  UnofficialSourcesDisabledError,
  fetchHistory,
  isUnofficialDisabledError,
  type SourcesStatus,
} from '../../api/client';
import { setLang } from '../../state/i18n';
import { loadError, loadErrorUnofficial, loadSymbolData, setLoadError, setLoadErrorUnofficial, setUi } from '../../state/store';
import { SettingsModal, setSettingsTab } from '../SettingsModal';

const $ = (s: string) => document.querySelector(s) as HTMLElement;

const memStore = (() => {
  let m = new Map<string, string>();
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
    clear: () => void (m = new Map()),
  };
})();

const jsonResp = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

beforeEach(() => {
  vi.stubGlobal('localStorage', memStore);
  localStorage.clear();
  setLang('tr');
  setLoadError(null);
  setLoadErrorUnofficial(false);
  setUi('modal', 'settings');
  setSettingsTab('sources');
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Settings → Data Sources (opt-in gate)', () => {
  it('requires explicit consent checkbox before enabling unofficial sources and allows disabling', async () => {
    const state: SourcesStatus = {
      unofficial: false,
      acceptedAt: 0,
      hosts: ['yahoo.com', 'news.google.com', 'isyatirim.com.tr'],
    };
    const calls: Array<{ url: string; method: string; body?: unknown }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? 'GET';
        const body = init?.body ? JSON.parse(String(init.body)) : undefined;
        calls.push({ url, method, body });
        if (url === '/api/sources' && method === 'GET') return jsonResp(state);
        if (url === '/api/sources' && method === 'PUT') {
          const b = body as { unofficial: boolean; acceptTerms: boolean };
          if (b.unofficial && !b.acceptTerms) return jsonResp({ error: 'acceptTerms required' }, 400);
          state.unofficial = b.unofficial;
          state.acceptedAt = b.unofficial ? 1730000000 : 0;
          return jsonResp(state);
        }
        return jsonResp({ error: 'not found' }, 404);
      })
    );

    render(() => <SettingsModal />);
    await waitFor(() => expect($('#sources-unofficial-status').textContent).toContain('Kapalı'));
    expect(document.querySelector('#sources-consent-box')).toBeNull();

    // Open consent box
    fireEvent.click($('#btn-sources-request-enable'));
    expect($('#sources-consent-box')).toBeTruthy();
    const confirmBtn = $('#btn-sources-confirm-enable') as HTMLButtonElement;
    expect(confirmBtn.disabled).toBe(true);

    // Check consent checkbox -> confirm button activates
    fireEvent.click($('#chk-sources-accept'));
    expect(confirmBtn.disabled).toBe(false);

    // Confirm -> PUT /api/sources with acceptTerms=true
    fireEvent.click(confirmBtn);
    await waitFor(() => expect($('#sources-unofficial-status').textContent).toContain('Açık'));
    expect(calls.some((c) => c.url === '/api/sources' && c.method === 'PUT' && (c.body as { acceptTerms: boolean }).acceptTerms === true)).toBe(true);

    // Disable -> PUT /api/sources with unofficial=false
    fireEvent.click($('#btn-sources-disable'));
    await waitFor(() => expect($('#sources-unofficial-status').textContent).toContain('Kapalı'));
    expect(calls[calls.length - 1]).toMatchObject({ url: '/api/sources', method: 'PUT', body: { unofficial: false, acceptTerms: false } });
  });

  it('hides toggle buttons and displays lock notice when envOverride is active', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResp({
          unofficial: false,
          acceptedAt: 0,
          envOverride: false,
          hosts: ['yahoo.com', 'news.google.com', 'isyatirim.com.tr'],
        })
      )
    );

    render(() => <SettingsModal />);
    await waitFor(() => expect($('#sources-env-lock')).toBeTruthy());
    expect(document.querySelector('#btn-sources-request-enable')).toBeNull();
    expect(document.querySelector('#btn-sources-disable')).toBeNull();
  });

  it('flags UnofficialSourcesDisabledError on 403 history response and populates loadErrorUnofficial', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResp(
          {
            error: 'unofficial data sources (Yahoo Finance, Google News, İş Yatırım) are disabled',
            code: 'unofficial_sources_disabled',
            unofficialDisabled: true,
          },
          403
        )
      )
    );

    await expect(fetchHistory('THYAO.IS', '15m')).rejects.toBeInstanceOf(UnofficialSourcesDisabledError);
    await loadSymbolData('THYAO.IS', '15m');
    expect(loadErrorUnofficial()).toBe(true);
    expect(loadError()).toContain('Veri Kaynakları');
    expect(isUnofficialDisabledError(new UnofficialSourcesDisabledError())).toBe(true);
  });
});
