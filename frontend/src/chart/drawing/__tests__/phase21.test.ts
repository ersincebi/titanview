// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { Candle, DrawingObject, DrawingToolType } from '../../../types/market';
import { DrawingManager } from '../DrawingManager';
import {
  disjointGeometry,
  flatChannelGeometry,
  pitchforkGeo,
  pitchforkOrigin,
  regression,
  regressionHandles,
  screenAngle,
} from '../channels';
import {
  fibChannelOffsets,
  fibCircles,
  fibSpiralPoints,
  fibTimezoneXs,
  FIB_ARC_LEVELS,
  FIB_CIRCLE_LEVELS,
  pitchfanTargets,
  speedArcs,
  speedFanTargets,
  trendTimeXs,
  wedgeArcs,
} from '../fibFamily';
import { gannFanDirections, gannGrid, GANN_FAN_RATIOS, squareFixedCorner } from '../gann';
import { FREEHAND_TOOLS, TOOL_DEFS } from '../registry';
import {
  arcControl,
  arrowMarkerPolygon,
  circleRadius,
  curvePath,
  deriveCurveControls,
  markArrowPolygon,
  rotatedRectCorners,
} from '../shapes';
import { extendRay, fibColor } from '../svg';
import { POINTS_REQUIRED, TOOL_LABELS } from '../toolSpec';

const candles: Candle[] = Array.from({ length: 30 }, (_, i) => ({
  time: 1000 + i * 100,
  open: 100 + i,
  high: 105 + i,
  low: 95 + i,
  close: 102 + i * 2,
  volume: 100,
}));

const mapper = {
  timeToX: (t: number) => (t - 1000) / 10,
  xToTime: (x: number) => Math.round(x * 10 + 1000),
  priceToY: (p: number) => 600 - p * 2,
  yToPrice: (y: number) => (600 - y) / 2,
  getCandles: () => candles,
};
const NS = 'http://www.w3.org/2000/svg';
const svgEl = () => document.createElementNS(NS, 'svg') as SVGElement;
const obj = (toolType: DrawingToolType, pts: Array<[number, number]>): DrawingObject => ({
  id: 'x',
  symbol: 'S',
  timeframe: '1h',
  toolType,
  points: pts.map(([time, price]) => ({ time, price })),
  color: '',
});

const PHASE21: DrawingToolType[] = [
  'trend_angle', 'cross_line', 'regression', 'flat_channel', 'disjoint_channel',
  'schiff_pitchfork', 'mod_schiff_pitchfork', 'inside_pitchfork',
  'fib_channel', 'fib_timezone', 'fib_speed_fan', 'fib_trend_time', 'fib_circles', 'fib_spiral', 'fib_speed_arcs', 'fib_wedge', 'fib_pitchfan',
  'gann_box', 'gann_square_fixed', 'gann_square', 'gann_fan',
  'highlighter', 'arrow_marker', 'arrow_up', 'arrow_down', 'rotated_rect', 'path', 'circle', 'polyline', 'triangle', 'arc', 'curve', 'double_curve',
];

describe('Faz 21 kayıt tablosu', () => {
  it('her yeni araç: render, etiket ve nokta sayısı tanımlı (parity §2: 3+3+9+4+10 ve 2 çizgi)', () => {
    expect(PHASE21).toHaveLength(33);
    for (const t of PHASE21) {
      expect(TOOL_DEFS[t], t).toBeTruthy();
      expect(TOOL_LABELS[t], t).toBeTruthy();
      expect(POINTS_REQUIRED[t], t).not.toBeUndefined();
    }
    expect(POINTS_REQUIRED.path).toBe(-1);
    expect(POINTS_REQUIRED.polyline).toBe(-1);
    expect(POINTS_REQUIRED.highlighter).toBe(0);
    expect(FREEHAND_TOOLS.has('highlighter')).toBe(true);
  });

  it('her araç tam noktalarla bir şey çizer; eksik/eksen dışı noktada patlamaz', () => {
    const full: Array<[number, number]> = [[1200, 130], [1800, 150], [2200, 120], [2500, 140]];
    for (const t of PHASE21) {
      const n = POINTS_REQUIRED[t] <= 0 ? 4 : POINTS_REQUIRED[t];
      const g = svgEl();
      TOOL_DEFS[t]!.render(obj(t, full.slice(0, n)), mapper, g, 800, 600);
      expect(g.childNodes.length, t).toBeGreaterThan(0);
      // önizleme (1 eksik nokta) ve eksen dışı
      const g2 = svgEl();
      expect(() => TOOL_DEFS[t]!.render(obj(t, full.slice(0, Math.max(1, n - 1))), mapper, g2, 800, 600)).not.toThrow();
      const g3 = svgEl();
      TOOL_DEFS[t]!.render(obj(t, full.slice(0, n)), { ...mapper, timeToX: () => null }, g3, 800, 600);
      if (t !== 'regression') expect(g3.childNodes.length, t).toBe(0);
      const g4 = svgEl();
      TOOL_DEFS[t]!.render(obj(t, []), mapper, g4, 800, 600);
      expect(g4.childNodes.length, t).toBe(0);
    }
  });
});

describe('kanallar', () => {
  it('regresyon: doğrusal kapanışlarda sapma 0, R = 1, eğim bar başına 2', () => {
    const r = regression(candles, 1500, 1000)!;
    expect(r.n).toBe(6);
    expect(r.slope).toBeCloseTo(2);
    expect(r.startPrice).toBeCloseTo(102);
    expect(r.endPrice).toBeCloseTo(112);
    expect(r.stdev).toBeCloseTo(0);
    expect(r.pearsonR).toBeCloseTo(1);
    expect(regression(candles, 1000, 1050)).toBeNull();
  });

  it('regresyon: gürültülü veride kalıntı std ve ±2σ bant; tutamaklar taban çizgisi uçlarında', () => {
    const noisy = candles.map((c, i) => ({ ...c, close: 100 + (i % 2 === 0 ? 1 : -1) }));
    const r = regression(noisy, 1000, 1300)!;
    expect(r.slope).toBeCloseTo(-0.4);
    expect(r.stdev).toBeGreaterThan(0.5);
    const g = svgEl();
    TOOL_DEFS.regression!.render(obj('regression', [[1000, 0], [1300, 0]]), { ...mapper, getCandles: () => noisy }, g, 800, 600);
    expect(g.querySelectorAll('[data-reg]')).toHaveLength(3);
    const up = g.querySelector('[data-reg="upper"]')!;
    const base = g.querySelector('[data-reg="base"]')!;
    expect(Number(base.getAttribute('y1')) - Number(up.getAttribute('y1'))).toBeCloseTo(2 * r.stdev * 2);
    const h = regressionHandles(obj('regression', [[1300, 0], [1000, 0]]), { ...mapper, getCandles: () => noisy })!;
    expect(h[0].x).toBe(30);
    expect(h[1].x).toBe(0);
    expect(regressionHandles(obj('regression', [[1000, 0]]), mapper)).toBeNull();
  });

  it('düz üst/alt ve ayrık kanal geometrisi', () => {
    const f = flatChannelGeometry([{ x: 0, y: 100 }, { x: 100, y: 50 }, { x: 40, y: 200 }]);
    expect(f.flat).toEqual([{ x: 0, y: 200 }, { x: 100, y: 200 }]);
    const d = disjointGeometry([{ x: 0, y: 100 }, { x: 100, y: 50 }, { x: 50, y: 200 }]);
    // ters eğim: ilk çizgi -0.5, ikinci +0.5 ve p2'den geçer
    expect(d.second[0]).toEqual({ x: 0, y: 175 });
    expect(d.second[1]).toEqual({ x: 100, y: 225 });
  });

  it('pitchfork başlangıçları: Andrews p0, Schiff (p0.x, orta y), Değiştirilmiş Schiff ve İç orta nokta', () => {
    const p0 = { x: 0, y: 100 };
    const p1 = { x: 100, y: 0 };
    expect(pitchforkOrigin('original', p0, p1)).toEqual(p0);
    expect(pitchforkOrigin('schiff', p0, p1)).toEqual({ x: 0, y: 50 });
    expect(pitchforkOrigin('mod_schiff', p0, p1)).toEqual({ x: 50, y: 50 });
    expect(pitchforkOrigin('inside', p0, p1)).toEqual({ x: 50, y: 50 });
    const p2 = { x: 100, y: 100 };
    const orig = pitchforkGeo('original', p0, p1, p2, [1]);
    expect(orig.prongs[0].a).toEqual(p1);
    expect(orig.prongs[0].b).toEqual(p2);
    const ins = pitchforkGeo('inside', p0, p1, p2, [1]);
    expect(ins.prongs[0].a).toEqual({ x: 100, y: 25 });
    expect(ins.dir).toEqual({ x: 50, y: 0 });
  });

  it('trend açısı ekran açısını derece olarak verir; ışın uzatma', () => {
    expect(screenAngle({ x: 0, y: 100 }, { x: 100, y: 0 })).toBeCloseTo(45);
    expect(screenAngle({ x: 0, y: 0 }, { x: 100, y: 100 })).toBeCloseTo(-45);
    const g = svgEl();
    TOOL_DEFS.trend_angle!.render(obj('trend_angle', [[1000, 50], [2000, 100]]), mapper, g, 800, 600);
    expect(g.querySelector('text')!.textContent).toBe('45.00°');
    const [s, e] = extendRay({ x: 0, y: 0 }, { x: 10, y: 0 }, 'both', 800, 600);
    expect(s.x).toBeLessThan(-800);
    expect(e.x).toBeGreaterThan(800);
    expect(extendRay({ x: 5, y: 5 }, { x: 5, y: 5 }, 'right', 800, 600)[1]).toEqual({ x: 5, y: 5 });
  });
});

describe('Fib ailesi', () => {
  it('kanal kayması, zaman bölgeleri, trend tabanlı zaman', () => {
    expect(fibChannelOffsets([{ x: 0, y: 100 }, { x: 100, y: 50 }, { x: 50, y: 125 }]).dy).toBe(50);
    expect(fibTimezoneXs(10, 20).map((z) => z.x)).toEqual([10, 20, 30, 40, 60, 90, 140, 220, 350, 560, 900]);
    const tt = trendTimeXs([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 200, y: 0 }], [0, 0.618, 1.618]);
    expect(tt.map((t) => t.x)).toEqual([200, 261.8, 361.8]);
  });

  it('hız yelpazesi hedefleri, daireler, yaylar, kama ve pitchfan', () => {
    const t = speedFanTargets({ x: 0, y: 100 }, { x: 100, y: 0 }, [0.5]);
    expect(t.price[0]).toEqual({ x: 100, y: 50 });
    expect(t.time[0]).toEqual({ x: 50, y: 0 });
    const c = fibCircles({ x: 0, y: 0 }, { x: 100, y: 0 });
    expect(c).toHaveLength(FIB_CIRCLE_LEVELS.length);
    expect(c.find((x) => x.level === 1)).toMatchObject({ cx: 50, cy: 0, r: 50 });
    const arcs = speedArcs({ x: 100, y: 100 }, { x: 100, y: 50 });
    expect(arcs).toHaveLength(FIB_ARC_LEVELS.length);
    expect(arcs.find((a) => a.level === 1)!.r).toBe(50);
    expect(arcs[0].d).toContain(' 0 0 1 '); // yukarı yarım
    expect(speedArcs({ x: 0, y: 0 }, { x: 0, y: 10 })[0].d).toContain(' 0 0 0 ');
    const w = wedgeArcs({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 100 });
    const last = w[w.length - 1];
    expect(last.from.x).toBeCloseTo(100);
    expect(last.to.y).toBeCloseTo(100);
    expect(last.sweep).toBe(1);
    expect(wedgeArcs({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: -100 })[0].sweep).toBe(0);
    const pf = pitchfanTargets([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }], [0, 1]);
    expect(pf[0].up).toEqual({ x: 100, y: 50 });
    expect(pf[1].up).toEqual({ x: 100, y: 0 });
    expect(pf[1].down).toEqual({ x: 100, y: 100 });
  });

  it('altın sarmal: çeyrek turda yarıçap φ katı; sıfır yarıçapta tek nokta', () => {
    const pts = fibSpiralPoints({ x: 0, y: 0 }, { x: 10, y: 0 }, 0, 1, Math.PI / 2);
    const r = pts.map((p) => Math.hypot(p.x, p.y));
    expect(r[0]).toBeCloseTo(10);
    expect(r[1] / r[0]).toBeCloseTo((1 + Math.sqrt(5)) / 2);
    expect(fibSpiralPoints({ x: 1, y: 1 }, { x: 1, y: 1 })).toHaveLength(1);
  });

  it('Fib renkleri Standart paletinden, bilinmeyen seviyeler döngüsel', () => {
    expect(fibColor(0.618)).toBe('#089981');
    expect(fibColor(9.99, 1)).toMatch(/^#/);
  });
});

describe('Gann', () => {
  it('yelpaze oranları 1/1 = p0→p1, 2/1 iki kat dik, 1/2 yarım', () => {
    const d = gannFanDirections({ x: 0, y: 100 }, { x: 10, y: 90 });
    expect(d).toHaveLength(GANN_FAN_RATIOS.length);
    expect(d.find((x) => x.label === '1/1')!.to).toEqual({ x: 10, y: 90 });
    expect(d.find((x) => x.label === '2/1')!.to).toEqual({ x: 10, y: 80 });
    expect(d.find((x) => x.label === '1/2')!.to).toEqual({ x: 20, y: 90 });
  });

  it('ızgara seviyeleri ve sabit karenin ekran karesi', () => {
    const gr = gannGrid({ x: 0, y: 0 }, { x: 200, y: 100 });
    expect(gr.xs.find((x) => x.level === 0.5)!.v).toBe(100);
    expect(gr.ys.find((x) => x.level === 0.25)!.v).toBe(25);
    expect(squareFixedCorner({ x: 0, y: 100 }, { x: 50, y: 10 })).toEqual({ x: 50, y: 50 });
    expect(squareFixedCorner({ x: 0, y: 100 }, { x: -50, y: 300 })).toEqual({ x: -50, y: 150 });
    const g = svgEl();
    TOOL_DEFS.gann_square!.render(obj('gann_square', [[1000, 200], [2000, 150]]), mapper, g, 800, 600);
    expect(g.querySelectorAll('[data-sq-arc]').length).toBe(6);
    expect(g.querySelectorAll('[data-sq-fan]').length).toBeGreaterThan(6);
    const h = TOOL_DEFS.gann_square_fixed!.handles!(obj('gann_square_fixed', [[1000, 200], [2000, 150]]), mapper)!;
    expect(h[1]).toEqual({ x: 100, y: 300 });
    expect(TOOL_DEFS.gann_square_fixed!.handles!(obj('gann_square_fixed', [[1000, 200]]), mapper)).toBeNull();
  });
});

describe('şekiller', () => {
  it('ok poligonları, döndürülmüş dikdörtgen, daire yarıçapı', () => {
    const am = arrowMarkerPolygon({ x: 0, y: 0 }, { x: 100, y: 0 });
    expect(am).toHaveLength(7);
    expect(am[3]).toEqual({ x: 100, y: 0 });
    expect(arrowMarkerPolygon({ x: 1, y: 1 }, { x: 1, y: 1 })).toHaveLength(1);
    expect(markArrowPolygon({ x: 10, y: 10 }, true)[0]).toEqual({ x: 10, y: 14 });
    expect(markArrowPolygon({ x: 10, y: 10 }, false)[0]).toEqual({ x: 10, y: 6 });
    const rr = rotatedRectCorners({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 30 });
    expect(rr[2].x).toBeCloseTo(100);
    expect(rr[2].y).toBeCloseTo(30);
    expect(circleRadius({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });

  it('yay kontrol noktası: ikinci derece Bézier t=0.5 noktası tepe noktasından geçer', () => {
    const a = { x: 0, y: 100 };
    const b = { x: 100, y: 100 };
    const c = { x: 50, y: 20 };
    const k = arcControl(a, b, c);
    const mid = { x: 0.25 * a.x + 0.5 * k.x + 0.25 * b.x, y: 0.25 * a.y + 0.5 * k.y + 0.25 * b.y };
    expect(mid).toEqual(c);
  });

  it('eğri / çift eğri kontrol noktaları türetilir ve yol verisi Q / C kullanır', () => {
    const a = { time: 1000, price: 100 };
    const b = { time: 2000, price: 120 };
    expect(deriveCurveControls('curve', a, b)).toEqual([{ time: 1500, price: 120 }]);
    const dc = deriveCurveControls('double_curve', a, b);
    expect(dc).toHaveLength(2);
    expect(dc[0].price).toBeGreaterThan(dc[1].price - 10);
    expect(deriveCurveControls('curve', { time: 0, price: 0 }, { time: 10, price: 0 })[0].price).toBe(1);
    expect(curvePath([{ x: 0, y: 0 }, { x: 10, y: 0 }], 'curve')).toMatch(/^M0,0 Q/);
    expect(curvePath([{ x: 0, y: 0 }, { x: 10, y: 0 }], 'double_curve')).toMatch(/^M0,0 C/);
    const g = svgEl();
    TOOL_DEFS.curve!.render(obj('curve', [[1000, 100], [2000, 100], [1500, 130]]), mapper, g, 800, 600);
    expect(g.querySelectorAll('.curve-guide')).toHaveLength(2);
  });

  it('yukarı ok işareti etiketi gösterir', () => {
    const g = svgEl();
    TOOL_DEFS.arrow_up!.render({ ...obj('arrow_up', [[1000, 100]]), label: 'Al' }, mapper, g, 800, 600);
    expect(g.querySelector('text')!.textContent).toBe('Al');
  });
});

describe('DrawingManager — Faz 21 etkileşimleri', () => {
  function setup() {
    const svg = document.createElementNS(NS, 'svg') as SVGSVGElement;
    document.body.appendChild(svg);
    const manager = new DrawingManager({ svg, mapper, autoPersist: false });
    return { svg, manager };
  }

  it('yol: tıklamalar birikir, Enter (finishDraft) bitirir; tek noktada bitmez', () => {
    const { manager, svg } = setup();
    manager.setTool('path');
    expect(manager.finishDraft()).toBeNull();
    manager.handlePointInput({ time: 1000, price: 100 });
    expect(manager.finishDraft()).toBeNull();
    manager.handlePointInput({ time: 1500, price: 120 });
    manager.handlePointInput({ time: 2000, price: 110 });
    expect(manager.getDraftPoints()).toHaveLength(3);
    // taslak önizleme fare olmadan da görünür
    expect(svg.querySelector('[data-drawing-id="draft_preview"]')).toBeTruthy();
    const d = manager.finishDraft();
    expect(d?.toolType).toBe('path');
    expect(d?.points).toHaveLength(3);
    expect(manager.getTool()).toBe('cursor');
    // sabit noktalı araçta finishDraft etkisiz
    manager.setTool('trendline');
    manager.handlePointInput({ time: 1000, price: 100 });
    expect(manager.finishDraft()).toBeNull();
  });

  it('yol: aynı yere ikinci tık (çift tık) bitirir; dblclick olayı da bitirir', () => {
    const { manager, svg } = setup();
    manager.setTool('path');
    manager.handlePointInput({ time: 1000, price: 100 });
    manager.handlePointInput({ time: 1500, price: 120 });
    const d = manager.handlePointInput({ time: 1500, price: 120 });
    expect(d?.points).toHaveLength(2);
    manager.setTool('path');
    manager.handlePointInput({ time: 1000, price: 100 });
    manager.handlePointInput({ time: 1500, price: 120 });
    svg.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(manager.getTool()).toBe('cursor');
    expect(manager.getDrawings().filter((x) => x.toolType === 'path')).toHaveLength(2);
  });

  it('çoklu çizgi: ilk noktaya dönünce kapanır (en az 3 nokta)', () => {
    const { manager } = setup();
    manager.setTool('polyline');
    manager.handlePointInput({ time: 1000, price: 100 });
    manager.handlePointInput({ time: 1500, price: 120 });
    expect(manager.finishDraft()).toBeNull();
    manager.handlePointInput({ time: 2000, price: 100 });
    const d = manager.handlePointInput({ time: 1010, price: 101 });
    expect(d?.toolType).toBe('polyline');
    expect(d?.points).toHaveLength(3);
  });

  it('eğri: iki tıkta biter, kontrol noktası eklenir; yay 3 tık ister', () => {
    const { manager } = setup();
    manager.setTool('curve');
    manager.handlePointInput({ time: 1000, price: 100 });
    const d = manager.handlePointInput({ time: 2000, price: 120 });
    expect(d?.points).toHaveLength(3);
    manager.setTool('double_curve');
    manager.handlePointInput({ time: 1000, price: 100 });
    expect(manager.handlePointInput({ time: 2000, price: 120 })?.points).toHaveLength(4);
    manager.setTool('arc');
    manager.handlePointInput({ time: 1000, price: 100 });
    expect(manager.handlePointInput({ time: 2000, price: 100 })).toBeNull();
    expect(manager.handlePointInput({ time: 1500, price: 130 })?.toolType).toBe('arc');
  });

  it('araç varsayılan rengi: ok işaretleri yeşil/kırmızı; kullanıcı rengi seçtiyse onun rengi', () => {
    const { manager } = setup();
    manager.setTool('arrow_up');
    expect(manager.handlePointInput({ time: 1000, price: 100 })?.color).toBe('#089981');
    manager.setTool('arrow_down', '#FF9800');
    expect(manager.handlePointInput({ time: 1000, price: 100 })?.color).toBe('#F23645');
    manager.setTool('circle', '#FF9800');
    manager.handlePointInput({ time: 1000, price: 100 });
    expect(manager.handlePointInput({ time: 1200, price: 100 })?.color).toBe('#FF9800');
  });

  it('vurgulayıcı sürükleyerek çizilir, varsayılan sarı; tutamaksız; seçilince gövde sürüklenir', () => {
    const { manager, svg } = setup();
    svg.getBoundingClientRect = () => ({ left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, x: 0, y: 0, toJSON: () => ({}) });
    manager.setTool('highlighter');
    svg.dispatchEvent(new MouseEvent('mousedown', { clientX: 10, clientY: 400, bubbles: true }));
    svg.dispatchEvent(new MouseEvent('mousemove', { clientX: 20, clientY: 380, bubbles: true }));
    svg.dispatchEvent(new MouseEvent('mousemove', { clientX: 30, clientY: 390, bubbles: true }));
    expect(svg.querySelector('[data-drawing-id="draft_brush_preview"] polyline')).toBeTruthy();
    window.dispatchEvent(new MouseEvent('mouseup'));
    const hl = manager.getDrawings().find((x) => x.toolType === 'highlighter')!;
    expect(hl.points).toHaveLength(3);
    expect(hl.color).toBe('#FFEB3B');
    manager.selectDrawing(hl.id);
    expect(svg.querySelectorAll('.drawing-anchor-handle')).toHaveLength(0);
  });

  it('regresyon seçilince tutamaklar taban çizgisinde; sürükleme zamanı değiştirir', () => {
    const { manager, svg } = setup();
    manager.setTool('regression');
    manager.handlePointInput({ time: 1000, price: 0 });
    const d = manager.handlePointInput({ time: 1500, price: 0 })!;
    manager.selectDrawing(d.id);
    const hs = svg.querySelectorAll('.drawing-anchor-handle circle:last-child');
    expect(hs).toHaveLength(2);
    expect(Number(hs[0].getAttribute('cy'))).toBeCloseTo(600 - 102 * 2);
    expect(manager.beginDrag(d.id, '1', 0, 0)).toBe(true);
    manager.dragTo(10, 0);
    manager.endDrag();
    expect(manager.getDrawings().find((x) => x.id === d.id)!.points[1].time).toBe(1600);
  });
});
