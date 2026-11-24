// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { BacktestTrade, ScriptExecutionResult } from '../../types/market';
import type { LayerMapper } from '../ScriptLayer';
import { MAX_DRAWN_TRADES, TradeLayer, entryLabel, exitLabel, layoutTrades } from '../TradeLayer';
import { withoutTradeLayerMarkers } from '../ChartController';

const T0 = 1_000_000;
const DT = 60;
function mapper(width = 500): LayerMapper {
  return {
    timeToLogical: (t) => (t - T0) / DT,
    logicalToX: (l) => l * 10,
    priceToY: (p) => 400 - (p - 100) * 4,
    barSpacing: () => 10,
    barRange: () => null,
    size: () => ({ width, height: 400 }),
  };
}
const trade = (id: number, e: number, x: number, over: Partial<BacktestTrade> = {}): BacktestTrade => ({
  id, direction: 'LONG', entryTime: T0 + e * DT, entryPrice: 110, exitTime: T0 + x * DT, exitPrice: 120, pnlPercent: 9.09, pnlCash: 100, equityAfter: 10100, qty: 10, exitComment: 'TP', ...over,
});

describe('TradeLayer (Faz 24)', () => {
  it('kâr yeşil / zarar kırmızı bağlantı çizgisi, giriş oku, çıkış noktası, etiketler', () => {
    const prims = layoutTrades([trade(1, 5, 12), trade(2, 20, 25, { direction: 'SHORT', pnlCash: -30, pnlPercent: -2, exitPrice: 118 })], mapper(), { lines: true, labels: true, selectedId: null });
    const kinds = (k: string) => prims.filter((p) => p.kind === k);
    expect(kinds('line')).toHaveLength(2);
    expect(kinds('arrow')).toHaveLength(2);
    expect(kinds('exit')).toHaveLength(2);
    expect(kinds('label')).toHaveLength(4);
    const l1 = kinds('line')[0] as Extract<(typeof prims)[number], { kind: 'line' }>;
    expect([l1.x1, l1.x2, l1.color]).toEqual([50, 120, '#089981']);
    expect((kinds('line')[1] as { color: string }).color).toBe('#F23645');
    expect((kinds('arrow')[1] as { up: boolean }).up).toBe(false);
  });

  it('çizgiler/etiketler kapatılabilir; seçili işlemin etiketi kalabalıkta da görünür', () => {
    const many = Array.from({ length: 70 }, (_, i) => trade(i + 1, i % 40, (i % 40) + 3));
    const off = layoutTrades(many, mapper(), { lines: false, labels: true, selectedId: 5 });
    expect(off.filter((p) => p.kind === 'line')).toHaveLength(0);
    const labels = off.filter((p) => p.kind === 'label');
    expect(labels).toHaveLength(2);
    expect(labels.every((l) => l.id === 5 && l.selected)).toBe(true);
  });

  it('görünüm dışı işlemler çizilmez; çok işlemde üst sınır, seçili korunur', () => {
    const out = layoutTrades([trade(1, 100, 110), trade(2, -80, -70), trade(3, 10, 14)], mapper(), { lines: true, labels: false, selectedId: null });
    expect([...new Set(out.map((p) => p.id))]).toEqual([3]);
    const big = Array.from({ length: MAX_DRAWN_TRADES + 200 }, (_, i) => trade(i + 1, 1 + (i % 40), 3 + (i % 40)));
    const lim = layoutTrades(big, mapper(), { lines: true, labels: false, selectedId: MAX_DRAWN_TRADES + 150 });
    expect(new Set(lim.map((p) => p.id)).size).toBeLessThanOrEqual(MAX_DRAWN_TRADES + 1);
    expect(lim.some((p) => p.id === MAX_DRAWN_TRADES + 150)).toBe(true);
  });

  it('etiket metinleri', () => {
    expect(entryLabel(trade(1, 1, 2))).toBe('Long ×10 @ 110.00');
    expect(exitLabel(trade(1, 1, 2))).toBe('+100.00 (+9.09%) · TP');
    expect(exitLabel(trade(1, 1, 2, { pnlCash: -5, pnlPercent: -0.5, exitComment: '' }))).toBe('-5.00 (-0.50%)');
  });

  it('SVG: çizgi/ok/daire/metin düğümleri, seçili işlem halo ile üstte; temizlenir', () => {
    const host = document.createElement('div');
    const layer = new TradeLayer(host, mapper());
    layer.setTrades([trade(1, 5, 12), trade(2, 20, 25)], { selectedId: 2 });
    const svg = host.querySelector('svg')!;
    expect(svg.querySelectorAll('line.trade-line').length).toBe(2);
    expect(svg.querySelectorAll('line.trade-halo').length).toBe(1);
    expect(svg.querySelectorAll('path.trade-arrow').length).toBe(2);
    expect(svg.querySelectorAll('circle.trade-exit').length).toBe(2);
    expect(svg.querySelectorAll('text.trade-label').length).toBe(4);
    expect(svg.querySelector('line.trade-selected')!.getAttribute('data-trade-id')).toBe('2');
    expect(layer.count()).toBe(2);
    layer.setTrades([]);
    expect(svg.childNodes.length).toBe(0);
    layer.destroy();
    expect(host.querySelector('svg')).toBeNull();
  });

  it('broker işaretçileri işlem katmanıyla yinelenmez (açık pozisyon girişi kalır)', () => {
    const t = trade(1, 5, 12);
    const res = {
      ok: true,
      backtest: { trades: [t] },
      markers: [
        { time: t.entryTime, position: 'belowBar', color: '', shape: 'arrowUp', text: 'L', source: 'broker' },
        { time: t.exitTime, position: 'aboveBar', color: '', shape: 'circle', text: 'TP', source: 'broker' },
        { time: T0 + 99 * DT, position: 'belowBar', color: '', shape: 'arrowUp', text: 'açık', source: 'broker' },
        { time: t.entryTime, position: 'belowBar', color: '', shape: 'arrowUp', text: 'kullanıcı plotshape' },
      ],
    } as unknown as ScriptExecutionResult;
    expect(withoutTradeLayerMarkers(res).map((m) => m.text)).toEqual(['açık', 'kullanıcı plotshape']);
    expect(withoutTradeLayerMarkers({ ...res, backtest: undefined } as ScriptExecutionResult)).toHaveLength(4);
  });

  it('aynı bar/fiyattaki ters dönüş etiketleri çakışmaz (dikey ayrıştırma)', () => {
    const t1 = trade(1, 5, 15, { direction: 'SHORT', entryPrice: 120, exitPrice: 130, pnlCash: -100 });
    const t2 = trade(2, 15, 25, { direction: 'LONG', entryPrice: 130, exitPrice: 140, pnlCash: 100 });
    const labels = layoutTrades([t1, t2], mapper(), { lines: true, labels: true, selectedId: 2 }).filter(
      (p): p is Extract<ReturnType<typeof layoutTrades>[number], { kind: 'label' }> => p.kind === 'label'
    );
    const atBar15 = labels.filter((l) => Math.abs(l.x - 150) <= 10);
    expect(atBar15).toHaveLength(2);
    // farklı x tarafında (exit sola, entry sağa) → çakışma yok
    expect(atBar15[0].x).not.toBe(atBar15[1].x);
    // aynı noktada iki aynı yönlü etiket → dikey ayrılır
    const dup = layoutTrades(
      [trade(1, 10, 14), trade(2, 10, 16)],
      mapper(),
      { lines: true, labels: true, selectedId: null }
    ).filter((p): p is Extract<ReturnType<typeof layoutTrades>[number], { kind: 'label' }> => p.kind === 'label' && p.anchor === 'start');
    expect(dup).toHaveLength(2);
    expect(Math.abs(dup[0].y - dup[1].y)).toBeGreaterThanOrEqual(14);
  });
});
