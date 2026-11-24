import { describe, expect, it } from 'vitest';
import { buildWorkspace, parseWorkspace, type WorkspaceInput } from '../workspace';

const base = (): WorkspaceInput => ({
  symbol: 'BTCUSDT', interval: '4h', chartStyle: 'heikin', scaleKind: 'log', invertScale: false, scaleLock: true, mainScaleSide: 'left', paneSides: { rsi: 'split' }, simple: true, layout: '2x1',
  secondarySymbols: ['A', 'B', 'C'], visual: { upColor: '#0f0' }, quick: { ema9: true }, scriptCode: 'CUSTOM', scriptCode2: 'DEF2',
  magnet: true, hideDrawings: false, wbTab: 'script', wbCollapsed: true, drawerTab: 'alerts', marketFilter: 'BIST', screenerMarket: 'US',
  quickQty: 250, alerts: [{ id: 'a1', symbol: 'AAPL', targetPrice: 1, condition: 'CROSS_UP', triggered: false, note: '' }],
  paper: { cash: 5, positions: [], history: [] },
});
const DEF = { scriptCode: 'DEF1', scriptCode2: 'DEF2' };

describe('workspace kalıcılığı', () => {
  it('gidiş-dönüş: kurulan çalışma alanı aynen geri okunur', () => {
    const p = parseWorkspace(JSON.parse(JSON.stringify(buildWorkspace(base(), DEF))))!;
    expect(p.symbol).toBe('BTCUSDT');
    expect(p.interval).toBe('4h');
    expect(p.chartStyle).toBe('heikin');
    expect(p.layout).toBe('2x1');
    expect(p.quick).toEqual({ ema9: true });
    expect(p.scriptCode).toBe('CUSTOM');
    expect(p.quickQty).toBe(250);
    expect(p.alerts).toHaveLength(1);
    expect(p.paper?.cash).toBe(5);
    expect(p.wbTab).toBe('script');
    expect(p.drawerTab).toBe('alerts');
    // Faz 15: ölçek kilidi, sol ölçek, pane tarafları ve sade mod kalıcı
    expect(p.scaleLock).toBe(true);
    expect(p.mainScaleSide).toBe('left');
    expect(p.paneSides).toEqual({ rsi: 'split' });
    expect(p.simple).toBe(true);
  });

  it('indeksli ölçek geçerli; bozuk ölçek/yan değerleri atılır', () => {
    expect(parseWorkspace({ scaleKind: 'indexed' })?.scaleKind).toBe('indexed');
    const bad = parseWorkspace({ scaleKind: 'weird', mainScaleSide: 'top', paneSides: { rsi: 'x', macd: 'left', evil: 'left' }, simple: 'yes' })!;
    expect(bad.scaleKind).toBeUndefined();
    expect(bad.mainScaleSide).toBeUndefined();
    expect(bad.paneSides).toEqual({ macd: 'left' });
    expect(bad.simple).toBeUndefined();
  });

  it('varsayılan Betik kodu saklanmaz (uygulama güncellenince eski kopya yeni şablonu gölgelemez)', () => {
    const w = buildWorkspace({ ...base(), scriptCode: 'DEF1' }, DEF);
    expect(w.scriptCode).toBeNull();
    expect(w.scriptCode2).toBeNull();
    const p = parseWorkspace(JSON.parse(JSON.stringify(w)))!;
    expect(p.scriptCode).toBeUndefined();
  });

  it('bozuk / yabancı alanlar atılır, geçerliler korunur', () => {
    const p = parseWorkspace({
      symbol: 'x'.repeat(99), interval: '7q', chartStyle: 'spiral', layout: '9x9', secondarySymbols: ['a'], quick: { ema9: 'yes', rsi: true },
      wbTab: 'insight', quickQty: -4, alerts: [{ id: 'ok', symbol: 'A', targetPrice: 2, triggered: false }, { nope: 1 }], paper: { cash: 'x' }, magnet: true,
    })!;
    expect(p.symbol).toBeUndefined();
    expect(p.interval).toBeUndefined();
    expect(p.chartStyle).toBeUndefined();
    expect(p.layout).toBeUndefined();
    expect(p.secondarySymbols).toBeUndefined();
    expect(p.quick).toEqual({ rsi: true });
    expect(p.wbTab).toBeUndefined(); // analiz sekmeleri veri ister, geri yüklenmez
    expect(p.quickQty).toBeUndefined();
    expect(p.alerts).toHaveLength(1);
    expect(p.paper).toBeUndefined();
    expect(p.magnet).toBe(true);
  });

  it('nesne olmayan gövde null döner', () => {
    expect(parseWorkspace(null)).toBeNull();
    expect(parseWorkspace('x')).toBeNull();
    expect(parseWorkspace([1])).toBeNull();
  });
});
