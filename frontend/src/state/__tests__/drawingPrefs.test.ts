import { describe, expect, it } from 'vitest';
import {
  clampBarPos,
  cleanStyle,
  MAX_FAV_TOOLS,
  parseFavTools,
  parseTemplates,
  parseToolStyles,
  removeTemplate,
  saveTemplate,
  styleOf,
  templatesFor,
  toggleFavTool,
} from '../drawingPrefs';
import { buildWorkspace, parseWorkspace, type WorkspaceInput } from '../workspace';

describe('çizim tercihleri (Faz 22)', () => {
  it('stil doğrulama: bozuk alanlar atılır', () => {
    expect(cleanStyle({ color: '#FF9800', width: 3, lineStyle: 'dashed', fontSize: 18 })).toEqual({ color: '#FF9800', width: 3, lineStyle: 'dashed', fontSize: 18 });
    expect(cleanStyle({ color: 'red', width: 99, lineStyle: 'wavy', fontSize: 2 })).toEqual({});
    expect(cleanStyle(null)).toEqual({});
    expect(styleOf({ color: '#0284C7', width: undefined, lineStyle: 'dotted' })).toEqual({ color: '#0284C7', lineStyle: 'dotted' });
  });

  it('favori araçlar: ekle / çıkar, tekrar ve geçersiz araç atılır, üst sınır', () => {
    let f = toggleFavTool([], 'xabcd');
    f = toggleFavTool(f, 'note');
    expect(f).toEqual(['xabcd', 'note']);
    expect(toggleFavTool(f, 'xabcd')).toEqual(['note']);
    expect(parseFavTools(['xabcd', 'xabcd', 'nope', 'cursor', 3, 'pin'])).toEqual(['xabcd', 'pin']);
    expect(parseFavTools('x')).toEqual([]);
    let many: Parameters<typeof toggleFavTool>[0] = [];
    for (const t of ['trendline', 'ray', 'hline', 'vline', 'fib', 'rect'] as const) many = toggleFavTool(many, t);
    expect(many.length).toBeLessThanOrEqual(MAX_FAV_TOOLS);
  });

  it('şablonlar: kaydet, aynı adla üzerine yaz, araca göre filtre, sil, ayrıştır', () => {
    let l = saveTemplate([], 'trendline', ' Kırmızı ', { color: '#F23645', width: 2 }, 't1');
    l = saveTemplate(l, 'trendline', 'Kırmızı', { color: '#F23645', width: 4 }, 't2');
    l = saveTemplate(l, 'fib', 'Fib', { color: '#0284C7' }, 't3');
    expect(saveTemplate(l, 'fib', '   ', {})).toBe(l);
    expect(l).toHaveLength(2);
    expect(templatesFor(l, 'trendline')).toEqual([{ id: 't1', name: 'Kırmızı', tool: 'trendline', style: { color: '#F23645', width: 4 } }]);
    expect(removeTemplate(l, 't1').map((t) => t.id)).toEqual(['t3']);
    expect(parseTemplates([...l, { id: 'x', name: '', tool: 'fib' }, { id: 'y', name: 'a', tool: 'zzz' }, 7])).toEqual(l);
    expect(parseTemplates({})).toEqual([]);
  });

  it('stil hafızası ayrıştırma; favori çubuğu ekran içinde kalır', () => {
    expect(parseToolStyles({ trendline: { color: '#FF9800' }, bogus: { color: '#000000' }, fib: { width: 99 } })).toEqual({ trendline: { color: '#FF9800' } });
    expect(parseToolStyles([1])).toEqual({});
    expect(clampBarPos({ x: -20, y: 5000 }, 1000, 800)).toEqual({ x: 0, y: 760 });
  });

  it('çalışma alanı gidiş-dönüş: mıknatıs modu, çizimde kal, favoriler, şablonlar, stil hafızası, ikon', () => {
    const input = {
      symbol: 'BTCUSDT', interval: '4h', chartStyle: 'candles', scaleKind: 'normal', invertScale: false, scaleLock: false, mainScaleSide: 'right', paneSides: {}, simple: false, layout: 'single',
      secondarySymbols: ['A', 'B', 'C'], visual: {}, quick: {}, scriptCode: 'X', scriptCode2: 'Y',
      magnet: true, magnetMode: 'weak', stayInDrawing: true, favTools: ['xabcd', 'note'], favBarVisible: false, favBarPos: { x: 300, y: 120 },
      toolStyles: { trendline: { color: '#FF9800', width: 2 } }, drawTemplates: [{ id: 't', name: 'A', tool: 'fib', style: { color: '#0284C7' } }], iconChoice: '🚀',
      hideDrawings: false, wbTab: 'script', wbCollapsed: true, drawerTab: null, marketFilter: 'ALL', screenerMarket: 'ALL', quickQty: 1, alerts: [], paper: { cash: 1, positions: [], history: [] },
    } as WorkspaceInput;
    const p = parseWorkspace(JSON.parse(JSON.stringify(buildWorkspace(input, { scriptCode: '', scriptCode2: '' }))))!;
    expect(p.magnetMode).toBe('weak');
    expect(p.stayInDrawing).toBe(true);
    expect(p.favTools).toEqual(['xabcd', 'note']);
    expect(p.favBarVisible).toBe(false);
    expect(p.favBarPos).toEqual({ x: 300, y: 120 });
    expect(p.toolStyles).toEqual({ trendline: { color: '#FF9800', width: 2 } });
    expect(p.drawTemplates).toHaveLength(1);
    expect(p.iconChoice).toBe('🚀');
    const bad = parseWorkspace({ magnetMode: 'mega', favBarPos: { x: 'a' }, iconChoice: '' })!;
    expect(bad.magnetMode).toBeUndefined();
    expect(bad.favBarPos).toBeUndefined();
    expect(bad.iconChoice).toBeUndefined();
  });
});
