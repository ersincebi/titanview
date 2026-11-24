// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { DrawingObject } from '../../../types/market';
import { RiskRewardTool, calculateRiskReward } from '../RiskRewardTool';
import { SupplyDemandBoxTool, calculateSupplyDemandBounds } from '../SupplyDemandBoxTool';

const mapper = {
  timeToX: (t: number) => (t - 1000) / 10,
  xToTime: (x: number) => x * 10 + 1000,
  priceToY: (p: number) => 600 - p * 2,
  yToPrice: (y: number) => (600 - y) / 2,
};
const NS = 'http://www.w3.org/2000/svg';
const svgEl = () => document.createElementNS(NS, 'svg') as SVGElement;
const d = (toolType: DrawingObject['toolType'], pts: Array<[number, number]>, extra: Partial<DrawingObject> = {}): DrawingObject => ({
  id: 'x', symbol: 'S', timeframe: '1h', toolType, points: pts.map(([time, price]) => ({ time, price })), color: '', ...extra,
});

describe('risk/reward math', () => {
  it('long: default stop is half the reward below entry => 1:2', () => {
    const m = calculateRiskReward({ time: 0, price: 100 }, { time: 1, price: 120 }, true);
    expect(m.stopPrice).toBe(90);
    expect(m.reward).toBe(20);
    expect(m.risk).toBe(10);
    expect(m.ratio).toBe(2);
    expect(m.ratioText).toBe('1 : 2.00');
    expect(m.targetPercent).toBeCloseTo(20);
    expect(m.stopPercent).toBeCloseTo(10);
  });
  it('short: stop goes above entry; custom stop overrides; zero risk gives ratio 0 (no division by zero)', () => {
    expect(calculateRiskReward({ time: 0, price: 100 }, { time: 1, price: 80 }, false).stopPrice).toBe(110);
    expect(calculateRiskReward({ time: 0, price: 100 }, { time: 1, price: 130 }, true, 85).ratio).toBe(2);
    const z = calculateRiskReward({ time: 0, price: 100 }, { time: 1, price: 130 }, true, 100);
    expect(z.ratio).toBe(0);
    expect(RiskRewardTool.calculate({ time: 0, price: 0 }, { time: 1, price: 5 }, true).targetPercent).toBe(0);
  });
});

describe('risk/reward render', () => {
  it('draws target + stop boxes, entry line and a LONG/SHORT badge; boxes sit on the right sides of entry', () => {
    const g = svgEl();
    RiskRewardTool.render(d('long_pos', [[1000, 100], [1500, 120]]), mapper, g);
    const rects = g.querySelectorAll('rect');
    expect(rects).toHaveLength(3); // target, stop, badge bg
    const target = rects[0];
    const stop = rects[1];
    // entry y=400, target y=360 (above), stop(90) y=420 (below)
    expect(Number(target.getAttribute('y')) + Number(target.getAttribute('height'))).toBeCloseTo(400);
    expect(Number(stop.getAttribute('y'))).toBeCloseTo(400);
    expect(g.querySelector('text')!.textContent).toMatch(/^LONG R:R 1 : 2\.00 \| Hedef: 120\.00 \(\+%20\.0\) \| Stop: 90\.00 \(-%10\.0\)$/);

    const s = svgEl();
    RiskRewardTool.render(d('short_pos', [[1000, 100], [1500, 80]]), mapper, s);
    expect(s.querySelector('text')!.textContent).toContain('SHORT');
    expect(s.querySelectorAll('rect')[2].getAttribute('fill')).toBe('#F23645');
  });
  it('renders nothing for incomplete or off-axis drawings', () => {
    const g = svgEl();
    RiskRewardTool.render(d('long_pos', [[1000, 100]]), mapper, g);
    RiskRewardTool.render(d('long_pos', [[1000, 100], [1500, 120]]), { ...mapper, timeToX: () => null }, g);
    RiskRewardTool.render(d('long_pos', [[1000, 100], [1500, 120]]), { ...mapper, priceToY: (p) => (p === 90 ? null : 600 - p * 2) }, g);
    expect(g.childNodes).toHaveLength(0);
  });
});

describe('supply / demand box', () => {
  it('zone type follows drag direction; bounds are order independent', () => {
    const up = calculateSupplyDemandBounds({ time: 1000, price: 100 }, { time: 2000, price: 110 });
    const down = calculateSupplyDemandBounds({ time: 2000, price: 110 }, { time: 1000, price: 100 });
    expect(up.zoneType).toBe('DEMAND');
    expect(down.zoneType).toBe('SUPPLY');
    expect(up.minPrice).toBe(down.minPrice);
    expect(up.maxTime).toBe(2000);
    expect(up.pctHeight).toBeCloseTo(10);
    expect(calculateSupplyDemandBounds({ time: 1, price: 0 }, { time: 2, price: 5 }).pctHeight).toBe(0);
  });
  it('renders a box with a default or custom label, minimum 6px size, custom stroke', () => {
    const g = svgEl();
    SupplyDemandBoxTool.render(d('rect', [[1000, 100], [1000, 100.01]]), mapper, g);
    const r = g.querySelector('rect')!;
    expect(Number(r.getAttribute('width'))).toBe(6);
    expect(Number(r.getAttribute('height'))).toBe(6);
    expect(g.querySelector('text')!.textContent).toMatch(/^Talep Bölgesi \(0\.01 \| %0\.0\)$/);

    const s = svgEl();
    SupplyDemandBoxTool.render(d('rect', [[1000, 110], [2000, 100]], { color: '#123456', label: 'Z' }), mapper, s);
    expect(s.querySelector('rect')!.getAttribute('stroke')).toBe('#123456');
    expect(s.querySelector('text')!.textContent).toBe('Z');
    const sup = svgEl();
    SupplyDemandBoxTool.render(d('rect', [[1000, 110], [2000, 100]]), mapper, sup);
    expect(sup.querySelector('text')!.textContent).toContain('Arz Bölgesi');
    expect(sup.querySelector('rect')!.getAttribute('stroke')).toBe('#F23645');
  });
});
