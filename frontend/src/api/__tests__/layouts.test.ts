import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  copyLayoutApi,
  createLayoutApi,
  deleteLayoutApi,
  getLayoutApi,
  getSharedLayoutApi,
  listLayoutsApi,
  shareLayoutApi,
  updateLayoutApi,
} from '../layouts';

describe('api/layouts', () => {
  const origFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = origFetch;
  });

  it('calls all layout CRUD, copy, share and shared read-only endpoints', async () => {
    const mock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/layouts' && !init?.method) {
        return new Response(JSON.stringify({ layouts: [{ id: 'lay_1', name: 'Test', gridId: '2x2', chartCount: 4, symbols: 'BTCUSDT', autosave: true, isShared: false, createdAt: 1, updatedAt: 2 }] }), { status: 200 });
      }
      if (url === '/api/layouts' && init?.method === 'POST') {
        return new Response(JSON.stringify({ id: 'lay_1', name: 'Test', state: {}, gridId: '2x2', chartCount: 4, symbols: 'BTCUSDT', autosave: true, isShared: false, createdAt: 1, updatedAt: 2 }), { status: 201 });
      }
      if (url === '/api/layouts/lay_1' && !init?.method) {
        return new Response(JSON.stringify({ id: 'lay_1', name: 'Test', state: { layout: '2x2' }, gridId: '2x2', chartCount: 4, symbols: 'BTCUSDT', autosave: true, isShared: false, createdAt: 1, updatedAt: 2 }), { status: 200 });
      }
      if (url === '/api/layouts/lay_1' && init?.method === 'PUT') {
        return new Response(JSON.stringify({ id: 'lay_1', name: 'Renamed', state: {}, gridId: '2x2', chartCount: 4, symbols: 'BTCUSDT', autosave: false, isShared: false, createdAt: 1, updatedAt: 3 }), { status: 200 });
      }
      if (url === '/api/layouts/lay_1/copy') {
        return new Response(JSON.stringify({ id: 'lay_2', name: 'Renamed (kopya)', state: {}, gridId: '2x2', chartCount: 4, symbols: 'BTCUSDT', autosave: false, isShared: false, createdAt: 3, updatedAt: 3 }), { status: 201 });
      }
      if (url === '/api/layouts/lay_1/share') {
        return new Response(JSON.stringify({ id: 'lay_1', isShared: true, shareToken: 'tok_abc', updatedAt: 4 }), { status: 200 });
      }
      if (url === '/api/layouts/shared/tok_abc') {
        return new Response(JSON.stringify({ layout: { id: 'lay_1', name: 'Renamed', state: { layout: '2x2' } }, drawings: [], readOnly: true }), { status: 200 });
      }
      if (url === '/api/layouts/lay_1' && init?.method === 'DELETE') {
        return new Response(JSON.stringify({ deleted: true }), { status: 200 });
      }
      return new Response('not found', { status: 404 });
    });
    globalThis.fetch = mock as unknown as typeof fetch;

    expect(await listLayoutsApi()).toHaveLength(1);
    const created = await createLayoutApi({ name: 'Test', state: {}, gridId: '2x2', chartCount: 4, symbols: 'BTCUSDT' });
    expect(created.id).toBe('lay_1');
    expect((await getLayoutApi('lay_1')).state).toEqual({ layout: '2x2' });
    expect((await updateLayoutApi('lay_1', { name: 'Renamed', autosave: false })).name).toBe('Renamed');
    expect((await copyLayoutApi('lay_1')).id).toBe('lay_2');
    const sh = await shareLayoutApi('lay_1', true);
    expect(sh.shareToken).toBe('tok_abc');
    const ro = await getSharedLayoutApi('tok_abc');
    expect(ro.readOnly).toBe(true);
    await deleteLayoutApi('lay_1');
    await expect(getSharedLayoutApi('bad')).rejects.toThrow(/bulunamadı/);
  });
});
