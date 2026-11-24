import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../api/client', () => ({
  fetchHistory: vi.fn(),
  fetchSymbols: vi.fn(async () => []),
  fetchScreener: vi.fn(async () => []),
  fetchDrawings: vi.fn(async () => []),
  persistDrawing: vi.fn(async () => {}),
  clearSymbolDrawings: vi.fn(async () => {}),
  syncCollectSymbols: vi.fn(async (s: string[]) => s),
  fetchCollectItems: vi.fn(async () => []),
  saveCustomScript: vi.fn(async () => null),
  fetchSavedScripts: vi.fn(async () => []),
  fetchCorporateEvents: vi.fn(async (symbol: string) => ({ symbol, supported: false, dividends: [], splits: [], earnings: [] })),
  fetchFxRates: vi.fn(async (from: string, to: string) => ({ from, to, pair: `${from}/${to}`, supported: false, rates: [] })),
  fetchSetting: vi.fn(async () => null),
  saveSetting: vi.fn(async () => {}),
}));
vi.mock('../../api/liveSocket', () => ({
  LiveMarketSocket: class {
    connect() {}
    sendSubscribe() {}
    destroy() {}
  },
}));

const mem = (() => {
  let m = new Map<string, string>();
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
    clear: () => void (m = new Map()),
  };
})();
vi.stubGlobal('localStorage', mem);

import * as api from '../../api/client';
import { walkCandles } from '../../script/__tests__/walkCandles';
import { applyScriptChartPick, scriptPickTarget, resetStore, setCandles, setUi } from '../store';
import {
  FAV_IND_KEY,
  STUDIES_KEY,
  _resetStudies,
  addStudy,
  applyStudyTemplate,
  deleteStudyTemplate,
  removeStudy,
  resetStudy,
  runStudies,
  saveStudyDefaults,
  saveStudyTemplate,
  setStudyInput,
  studies,
  studyLabel,
  studyRenderList,
  studyResults,
  studyTemplates,
  toggleFavoriteIndicator,
  favoriteBuiltins,
  setHlineStyle,
  setFillVisible,
  setPlotStyle,
  moveStudyPane,
  studyById,
} from '../studies';

const BARS = walkCandles(260, 900, 1_700_000_000);

beforeEach(() => {
  resetStore();
  _resetStudies();
  localStorage.clear();
  setUi('symbol', 'THYAO.IS');
  setUi('interval', '15m');
  setCandles(BARS);
  vi.mocked(api.fetchHistory).mockReset();
});

describe('studies: durum ve çalıştırma', () => {
  it('başka sembol: ilk çalıştırma eksik bildirir, gerçek mumlar çekilir ve yeniden çalışır; hata bir kez denenir', async () => {
    const other = walkCandles(260, 900, 1_700_000_000, 77);
    vi.mocked(api.fetchHistory).mockResolvedValue({ candles: other } as never);
    addStudy({ builtinId: 'ratio' });
    await runStudies();
    expect(api.fetchHistory).toHaveBeenCalledWith('XU100.IS', '15m');
    const r = studyResults().s1;
    expect(r.ok).toBe(true);
    expect(r.missingSymbols).toBeUndefined();
    expect(r.plots[0].data.length).toBe(260);
    // aynı sembol önbellekten
    await runStudies();
    expect(api.fetchHistory).toHaveBeenCalledTimes(1);
    vi.mocked(api.fetchHistory).mockRejectedValueOnce(new Error('ağ'));
    setStudyInput('s1', 'Second Symbol', 'NOPE');
    await runStudies();
    expect(studyResults().s1.warnings?.some((w) => w.includes('başka sembol verisi yok'))).toBe(true);
  });

  it('alt zaman dilimi eksikse çekilir (Hacim Deltası)', async () => {
    vi.mocked(api.fetchHistory).mockResolvedValue({ candles: walkCandles(100, 60, 1_700_000_000) } as never);
    addStudy({ builtinId: 'volume_delta' });
    await runStudies();
    expect(api.fetchHistory).toHaveBeenCalledWith('THYAO.IS', '1m', expect.any(Number), expect.any(Number));
    expect(studyResults().s1.ok).toBe(true);
  });

  it('kalıcılık, varsayılan olarak kaydet → yeni örnek bu ayarlarla, sıfırla, kaldır', async () => {
    addStudy({ builtinId: 'rsi' });
    setStudyInput('s1', 'RSI Length', 21);
    setPlotStyle('s1', 'RSI', { color: '#FF0000' });
    setHlineStyle('s1', 'RSI Upper Band', { visible: false });
    setFillVisible('s1', 'RSI Background Fill', false);
    await runStudies();
    expect(studyLabel(studyById('s1')!)).toBe('RSI 21 close');
    expect(JSON.parse(localStorage.getItem(STUDIES_KEY)!)[0].inputs['RSI Length']).toBe(21);
    saveStudyDefaults('s1');
    addStudy({ builtinId: 'rsi' });
    expect(studies.list[1].inputs['RSI Length']).toBe(21);
    expect(studies.list[1].plots.RSI.color).toBe('#FF0000');
    resetStudy('s2');
    expect(studies.list[1].inputs).toEqual({});
    removeStudy('s1');
    expect(studies.list.map((s) => s.uid)).toEqual(['s2']);
  });

  it('çizim listesi pane çözer, görünürlüğü uygular; taşıma ana panele', async () => {
    addStudy({ builtinId: 'sma' });
    addStudy({ builtinId: 'rsi' });
    await runStudies();
    expect(studyRenderList().map((i) => [i.uid, i.pane])).toEqual([
      ['s1', 'main'],
      ['s2', 'study:s2'],
    ]);
    moveStudyPane('s2', 'main');
    expect(studyRenderList()[1].pane).toBe('main');
    expect(studyRenderList()[1].result.isOverlay).toBe(true);
    moveStudyPane('s2', 'with:s2');
    expect(studies.list[1].pane).toBe('main');
  });

  it('favoriler ve şablonlar kalıcı', async () => {
    toggleFavoriteIndicator('rsi');
    expect(JSON.parse(localStorage.getItem(FAV_IND_KEY)!)).toEqual(['rsi']);
    expect(favoriteBuiltins().map((b) => b.id)).toEqual(['rsi']);
    toggleFavoriteIndicator('rsi');
    expect(favoriteBuiltins()).toEqual([]);
    expect(saveStudyTemplate('boş')).toBe(false);
    addStudy({ builtinId: 'macd' });
    expect(saveStudyTemplate('M')).toBe(true);
    removeStudy('s1');
    applyStudyTemplate('M');
    expect(studies.list.map((s) => s.builtinId)).toEqual(['macd']);
    deleteStudyTemplate('M');
    expect(studyTemplates()).toEqual([]);
  });

  it('confirm=true zaman girdisi eklenince grafikten seçim başlar; seçim gösterge girdisine yazılır', async () => {
    addStudy({ builtinId: 'vwap_anchored' });
    await vi.waitFor(() => expect(scriptPickTarget()?.studyUid).toBe('s1'));
    expect(applyScriptChartPick(BARS[100].time, 101)).toBe(true);
    expect(studies.list[0].inputs.Anchor).toBe(BARS[100].time * 1000);
    expect(scriptPickTarget()).toBeNull();
  });

  it('bilinmeyen hazır gösterge eklenemez; kayıtlı betik kodu ile eklenir', async () => {
    expect(addStudy({ builtinId: 'yok-boyle' })).toBeNull();
    const uid = addStudy({ code: '//@version=6\nindicator("Kendi", overlay=true)\nplot(close, "c")' });
    await runStudies();
    expect(studyResults()[uid!].scriptTitle).toBe('Kendi');
  });
});
