import { beforeEach, describe, expect, it, vi } from 'vitest';

const deferred = <T,>() => {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => ((resolve = res), (reject = rej)));
  return { promise, resolve, reject };
};

const calls: Record<string, ReturnType<typeof deferred<any>>> = {};
vi.mock('../../api/client', () => ({
  fetchAnalysis: vi.fn((s: string) => (calls[`a:${s}`] = deferred()).promise),
  fetchRelated: vi.fn((s: string) => (calls[`r:${s}`] = deferred()).promise),
  fetchFlow: vi.fn((s: string) => (calls[`f:${s}`] = deferred()).promise),
}));

import { analysis, flow, loadAnalysis, related, sectionState, toggleSection } from '../analysisStore';

const resp = (sym: string) => ({ info: { symbol: sym }, analysis: {}, mtf: [], mtfAgreement: 'x', lastBarTime: 1 });

describe('analysisStore', () => {
  beforeEach(() => {
    for (const k of Object.keys(calls)) delete calls[k];
  });

  it('eski sembolün geç gelen yanıtı yenisini ezmez (yarış koşulu yok)', async () => {
    const p1 = loadAnalysis('AAA');
    const p2 = loadAnalysis('BBB');
    calls['a:BBB'].resolve(resp('BBB'));
    calls['r:BBB'].resolve({ positive: [], negative: [], cross: [], note: '' });
    calls['f:BBB'].resolve({});
    await p2;
    calls['a:AAA'].resolve(resp('AAA')); // geç geldi
    calls['r:AAA'].resolve({ note: 'old' });
    calls['f:AAA'].resolve({ old: true });
    await p1;
    expect(analysis().data?.info.symbol).toBe('BBB');
    expect(related().data?.note).toBe('');
    expect(flow().data).toEqual({});
  });

  it('hata: veri temizlenir, mesaj saklanır; sonraki başarılı yükleme hatayı siler', async () => {
    const p = loadAnalysis('ERR');
    calls['a:ERR'].reject(new Error('Analiz: 502'));
    calls['r:ERR'].resolve({});
    calls['f:ERR'].resolve({});
    await p;
    expect(analysis().error).toContain('502');
    expect(analysis().data).toBeNull();
    const p2 = loadAnalysis('OK');
    expect(analysis().loading).toBe(true);
    expect(analysis().error).toBeNull();
    calls['a:OK'].resolve(resp('OK'));
    calls['r:OK'].resolve({});
    calls['f:OK'].resolve({});
    await p2;
    expect(analysis().data?.info.symbol).toBe('OK');
  });

  it('sembol değişince eski veri hemen silinir (yanlış sembolün analizi görünmez)', async () => {
    const p = loadAnalysis('CCC');
    calls['a:CCC'].resolve(resp('CCC'));
    calls['r:CCC'].resolve({});
    calls['f:CCC'].resolve({});
    await p;
    void loadAnalysis('DDD');
    expect(analysis().data).toBeNull();
    expect(analysis().loading).toBe(true);
  });

  it('bölüm açık/kapalı tercihi tersine döner ve kalıcıdır', () => {
    toggleSection('proj', true);
    expect(sectionState().proj).toBe(false);
    toggleSection('proj', true);
    expect(sectionState().proj).toBe(true);
  });
});
