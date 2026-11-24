// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { Candle, DrawingObject, DrawingToolType } from '../../../types/market';
import { DrawingManager } from '../DrawingManager';
import {
  anchoredVwap,
  forecastControl,
  barsBetween,
  barsPatternExtra,
  barSpacingPx,
  forecastStatus,
  formatVolumeShort,
  ghostBars,
  projectionRatio,
  rangeStats,
  snapshotBars,
  MAX_PATTERN_BARS,
} from '../forecast';
import { ALL_ICON_KEYS, EMOJI_CATEGORIES, ICON_CATEGORIES, iconDef, iconPreviewSvg, resolveIcon } from '../iconSet';
import { effectiveMagnet, findBar, nearestOhlc, snapPrice, WEAK_MAGNET_PX } from '../magnet';
import {
  boxSize,
  calloutTail,
  DEFAULT_TEXT,
  parseTable,
  screenPoint,
  SCREEN_ANCHORED,
  tableLayout,
  textLines,
  textWidth,
} from '../notes';
import {
  cyclicXs,
  harmonicRatios,
  intersect,
  isPeak,
  neckline,
  PATTERN_LABELS,
  retrace,
  sinePoints,
  timeCyclePaths,
  trianglePatternGeometry,
} from '../patterns';
import { TOOL_DEFS } from '../registry';
import { MIN_VARIABLE_POINTS, POINTS_REQUIRED, TEXT_TOOLS, TOOL_LABELS } from '../toolSpec';
import { isVisibleOn, normalizeVisibility, onlyThisTimeframe, parseTimeframe } from '../visibility';

const candles: Candle[] = Array.from({ length: 30 }, (_, i) => ({
  time: 1000 + i * 100,
  open: 100 + i,
  high: 105 + i,
  low: 95 + i,
  close: 102 + i * 2,
  volume: i === 3 ? 0 : 100,
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
const obj = (toolType: DrawingToolType, pts: Array<[number, number]>, extra: Partial<DrawingObject> = {}): DrawingObject => ({
  id: 'x',
  symbol: 'S',
  timeframe: '1h',
  toolType,
  points: pts.map(([time, price]) => ({ time, price })),
  color: '',
  ...extra,
});

const PATTERNS: DrawingToolType[] = ['xabcd', 'cypher', 'head_shoulders', 'abcd', 'triangle_pattern', 'three_drives'];
const ELLIOTT: DrawingToolType[] = ['elliott_impulse', 'elliott_correction', 'elliott_triangle', 'elliott_double', 'elliott_triple'];
const CYCLES: DrawingToolType[] = ['cyclic_lines', 'time_cycles', 'sine_line'];
const FORECAST: DrawingToolType[] = ['forecast', 'date_price_range', 'bars_pattern', 'ghost_feed', 'projection', 'anchored_vwap', 'anchored_vp'];
const NOTES: DrawingToolType[] = ['anchored_text', 'note', 'price_note', 'pin', 'table', 'callout', 'comment', 'signpost', 'flag_mark'];
const PHASE22 = [...PATTERNS, ...ELLIOTT, ...CYCLES, ...FORECAST, ...NOTES, 'icon' as DrawingToolType];

describe('Faz 22 kayıt tablosu', () => {
  it('parity §2: 11 formasyon + 3 döngü, 7 tahmin, 9 yazı/not, ikon — hepsi kayıtlı', () => {
    expect(PATTERNS.length + ELLIOTT.length).toBe(11);
    expect(FORECAST).toHaveLength(7);
    expect(NOTES).toHaveLength(9);
    for (const t of PHASE22) {
      expect(TOOL_DEFS[t], t).toBeTruthy();
      expect(TOOL_LABELS[t], t).toBeTruthy();
      expect(POINTS_REQUIRED[t], t).not.toBeUndefined();
    }
    expect(POINTS_REQUIRED.xabcd).toBe(5);
    expect(POINTS_REQUIRED.head_shoulders).toBe(7);
    expect(POINTS_REQUIRED.three_drives).toBe(7);
    expect(POINTS_REQUIRED.elliott_impulse).toBe(6);
    expect(POINTS_REQUIRED.elliott_triple).toBe(6);
    expect(POINTS_REQUIRED.ghost_feed).toBe(-1);
    expect(MIN_VARIABLE_POINTS.ghost_feed).toBe(2);
    expect(TEXT_TOOLS.has('table')).toBe(true);
    expect(SCREEN_ANCHORED.has('anchored_text')).toBe(true);
  });

  it('her araç tam noktalarla çizer; eksik noktada (önizleme) ve boş listede patlamaz', () => {
    const full: Array<[number, number]> = [[1200, 130], [1500, 150], [1800, 120], [2000, 145], [2200, 125], [2400, 140], [2600, 128]];
    for (const t of PHASE22) {
      const need = POINTS_REQUIRED[t] < 0 ? 4 : POINTS_REQUIRED[t];
      const g = svgEl();
      TOOL_DEFS[t]!.render(obj(t, full.slice(0, need), { label: DEFAULT_TEXT[t] }), mapper, g, 800, 600);
      expect(g.childNodes.length, t).toBeGreaterThan(0);
      expect(() => TOOL_DEFS[t]!.render(obj(t, full.slice(0, Math.max(1, need - 1))), mapper, svgEl(), 800, 600)).not.toThrow();
      const g4 = svgEl();
      TOOL_DEFS[t]!.render(obj(t, []), mapper, g4, 800, 600);
      expect(g4.childNodes.length, t).toBe(0);
      // eksen dışı (ekran çapalı metin hariç)
      if (t === 'anchored_text') continue;
      const g3 = svgEl();
      TOOL_DEFS[t]!.render(obj(t, full.slice(0, need)), { ...mapper, timeToX: () => null }, g3, 800, 600);
      expect(g3.childNodes.length, t).toBe(0);
    }
  });
});

describe('formasyonlar', () => {
  it('harmonik oranlar: XABCD AB/XA, BC/AB, CD/BC, AD/XA', () => {
    // X=100 A=200 B=138.2 C=176.4 D=121.4
    const r = harmonicRatios('xabcd', [100, 200, 138.2, 176.4, 121.4]);
    expect(r.map((x) => [x.from, x.to])).toEqual([[0, 2], [1, 3], [2, 4], [0, 4]]);
    expect(r[0].value).toBeCloseTo(0.618, 3);
    expect(r[1].value).toBeCloseTo(0.618, 3);
    expect(r[2].value).toBeCloseTo(1.44, 2);
    expect(r[3].value).toBeCloseTo(0.786, 3);
    expect(harmonicRatios('xabcd', [100, 200])).toEqual([]);
    expect(retrace(5, 5, 9)).toBeNaN();
  });

  it('Cypher: XC/XA uzatması ve CD/XC; ABCD ve üç sürüş oranları', () => {
    const c = harmonicRatios('cypher', [100, 200, 150, 230, 136.4]);
    expect(c[1].value).toBeCloseTo(1.3, 5);
    expect(c[2].value).toBeCloseTo(0.72, 5);
    const a = harmonicRatios('abcd', [100, 200, 138.2, 238.2]);
    expect(a[0].value).toBeCloseTo(0.618, 3);
    expect(a[1].value).toBeCloseTo(1.618, 3);
    expect(harmonicRatios('three_drives', [100, 150, 130, 170, 150, 190, 170])).toHaveLength(4);
    expect(harmonicRatios('elliott_impulse', [1, 2, 3])).toEqual([]);
  });

  it('etiketler Standart sırası; tepe/dip tespiti; boyun çizgisi uzatılır', () => {
    expect(PATTERN_LABELS.elliott_impulse).toEqual(['0', '(1)', '(2)', '(3)', '(4)', '(5)']);
    expect(PATTERN_LABELS.elliott_triple).toEqual(['0', '(W)', '(X)', '(Y)', '(X)', '(Z)']);
    expect(PATTERN_LABELS.head_shoulders![3]).toBe('Baş');
    const zig = [{ x: 0, y: 100 }, { x: 10, y: 50 }, { x: 20, y: 90 }];
    expect(isPeak(zig, 1)).toBe(true);
    expect(isPeak(zig, 2)).toBe(false);
    expect(isPeak([{ x: 0, y: 1 }], 0)).toBe(true);
    const hs = [{ x: 0, y: 100 }, { x: 10, y: 60 }, { x: 20, y: 90 }, { x: 30, y: 30 }, { x: 40, y: 80 }, { x: 50, y: 60 }, { x: 60, y: 100 }];
    const nl = neckline(hs)!;
    expect(nl[0]).toEqual({ x: 0, y: 100 });
    expect(nl[1]).toEqual({ x: 60, y: 70 });
    expect(neckline(hs.slice(0, 4))).toBeNull();
  });

  it('üçgen formasyonu: kenarlar sağdaki tepe noktasında birleşir; paralelse kesişim yok', () => {
    const ps = [{ x: 0, y: 0 }, { x: 10, y: 100 }, { x: 40, y: 20 }, { x: 50, y: 80 }];
    const g = trianglePatternGeometry(ps);
    expect(g.apex).not.toBeNull();
    expect(g.apex!.x).toBeGreaterThan(50);
    expect(intersect({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 })).toBeNull();
    const par = trianglePatternGeometry([{ x: 0, y: 0 }, { x: 0, y: 10 }, { x: 10, y: 0 }, { x: 10, y: 10 }]);
    expect(par.apex).toBeNull();
  });

  it('XABCD render: iki dolu üçgen + 4 oran kutusu + 5 etiket', () => {
    const g = svgEl();
    TOOL_DEFS.xabcd!.render(obj('xabcd', [[1000, 100], [1200, 200], [1400, 138.2], [1600, 176.4], [1800, 121.4]]), mapper, g, 800, 600);
    expect(g.querySelectorAll('polygon').length).toBe(2);
    const texts = Array.from(g.querySelectorAll('text')).map((t) => t.textContent);
    expect(texts).toEqual(expect.arrayContaining(['X', 'A', 'B', 'C', 'D', '0.618', '0.786']));
  });

  it('Omuz-Baş-Omuz: formasyon ile boyun arasında tek dolgu poligonu, noktalı boyun', () => {
    const g = svgEl();
    TOOL_DEFS.head_shoulders!.render(obj('head_shoulders', [[1000, 100], [1100, 130], [1200, 110], [1300, 150], [1400, 112], [1500, 128], [1600, 100]]), mapper, g, 800, 600);
    const polys = g.querySelectorAll('polygon');
    expect(polys.length).toBe(1);
    expect(polys[0].getAttribute('points')!.split(' ')).toHaveLength(7);
    expect(g.querySelector('line')!.getAttribute('stroke-dasharray')).toBe('1.5,3');
  });

  it('Elliott render: dalga etiketleri, 0 noktası etiketsiz', () => {
    const g = svgEl();
    TOOL_DEFS.elliott_correction!.render(obj('elliott_correction', [[1000, 200], [1200, 150], [1400, 180], [1600, 120]]), mapper, g, 800, 600);
    expect(Array.from(g.querySelectorAll('text')).map((t) => t.textContent)).toEqual(['(A)', '(B)', '(C)']);
  });
});

describe('döngüler', () => {
  it('döngüsel çizgiler ekranı eşit aralıkla doldurur; çok dar aralıkta tek çizgi', () => {
    expect(cyclicXs(100, 150, 300)).toEqual([0, 50, 100, 150, 200, 250, 300]);
    expect(cyclicXs(100, 101, 300)).toEqual([100]);
    expect(cyclicXs(0, 1000, 300, 2)).toEqual([0]);
  });

  it('zaman döngüleri yarım elips yayları; sinüs a ve b noktalarından geçer', () => {
    const p = timeCyclePaths({ x: 100, y: 200 }, { x: 160, y: 150 }, 400);
    expect(p.length).toBeGreaterThan(3);
    expect(p[0]).toMatch(/A30\.0,50\.0 0 0 0/);
    expect(timeCyclePaths({ x: 0, y: 0 }, { x: 1, y: 0 }, 400)).toEqual([]);
    const s = sinePoints({ x: 100, y: 100 }, { x: 160, y: 200 }, 300, 1);
    expect(s.find((q) => q.x === 100)!.y).toBeCloseTo(100);
    expect(s.find((q) => q.x === 160)!.y).toBeCloseTo(200);
    expect(sinePoints({ x: 5, y: 1 }, { x: 6, y: 2 }, 300)).toHaveLength(2);
  });
});

describe('tahmin araçları', () => {
  it('tahmin durumu: hedefe ulaştı / zamanı geçti / bekliyor', () => {
    const src = { time: 1000, price: 102 };
    expect(forecastStatus(candles, src, { time: 1500, price: 108 })).toBe('success');
    expect(forecastStatus(candles, src, { time: 1300, price: 200 })).toBe('failure');
    expect(forecastStatus(candles, src, { time: 99999, price: 500 })).toBe('pending');
    expect(forecastStatus(candles, src, { time: 1500, price: 50 })).toBe('failure');
  });

  it('pozisyon tahmini: eğri yukarı kavisli; kaynak/hedef etiketleri ve durum rozeti', () => {
    const c = forecastControl({ x: 0, y: 100 }, { x: 200, y: 150 });
    expect(c.x).toBe(100);
    expect(c.y).toBeLessThan(100);
    const g = svgEl();
    TOOL_DEFS.forecast!.render(obj('forecast', [[1000, 102], [1500, 108]]), mapper, g, 800, 600);
    expect(g.querySelector('path')!.getAttribute('d')).toContain('Q');
    expect(g.textContent).toContain('✓ BAŞARILI');
    expect(g.textContent).toContain('+6.00 (+5.88%) 5 barda');
  });

  it('aralık istatistikleri: fark, %, bar, süre, hacim; gelecekte bar sayısı aralıktan tahmin edilir', () => {
    const st = rangeStats(candles, { time: 1000, price: 100 }, { time: 1500, price: 110 });
    expect(st.diff).toBe(10);
    expect(st.pct).toBeCloseTo(10);
    expect(st.bars).toBe(5);
    expect(st.secs).toBe(500);
    expect(st.volume).toBe(500); // 6 bar, biri hacimsiz
    expect(barsBetween(candles, 5000, 6000)).toBe(10);
    expect(barsBetween([], 0, 100)).toBe(0);
    expect(formatVolumeShort(2_500_000_000)).toBe('2.50B');
    expect(formatVolumeShort(1500)).toBe('1.5K');
    expect(formatVolumeShort(12)).toBe('12');
  });

  it('çubuk deseni: aralıktaki mumların anlık görüntüsü; noktalar ilk açılış / son kapanışa çekilir', () => {
    const snap = snapshotBars(candles, 1200, 1000);
    expect(snap).toHaveLength(3);
    expect(snap[0]).toEqual([0, 5, -5, 2]);
    const ex = barsPatternExtra([{ time: 1000, price: 1 }, { time: 1200, price: 2 }], candles);
    expect(ex.points[0]).toEqual({ time: 1000, price: 100 });
    expect(ex.points[1].price).toBe(100 + snap[2][3]);
    expect(barsPatternExtra([{ time: 9000, price: 1 }, { time: 9900, price: 2 }], candles).bars).toEqual([]);
    const many = Array.from({ length: MAX_PATTERN_BARS + 50 }, (_, i) => ({ ...candles[0], time: i }));
    expect(snapshotBars(many, 0, 1e9)).toHaveLength(MAX_PATTERN_BARS);
  });

  it('çubuk deseni render: kopya mumlar p0 hizasında; taslakta seçim kutusu', () => {
    const d = obj('bars_pattern', [[1000, 100], [1200, 104]], { bars: snapshotBars(candles, 1000, 1200) });
    const g = svgEl();
    TOOL_DEFS.bars_pattern!.render(d, mapper, g, 800, 600);
    expect(g.querySelectorAll('line').length).toBe(3);
    const g2 = svgEl();
    TOOL_DEFS.bars_pattern!.render(obj('bars_pattern', [[1000, 100], [1200, 104]]), mapper, g2, 800, 600);
    expect(g2.querySelector('rect')!.getAttribute('stroke-dasharray')).toBe('4,4');
  });

  it('hayalet akış: parça başına bar aralığı kadar mum, açılış = önceki kapanış', () => {
    const bars = ghostBars([{ x: 0, y: 100 }, { x: 40, y: 60 }, { x: 60, y: 80 }], 10);
    expect(bars).toHaveLength(6);
    expect(bars[0].o).toBe(100);
    expect(bars[1].o).toBe(bars[0].c);
    expect(bars[3].c).toBeCloseTo(60);
    expect(bars[0].h).toBeLessThan(Math.min(bars[0].o, bars[0].c));
    expect(ghostBars([{ x: 0, y: 0 }], 10)).toEqual([]);
    expect(barSpacingPx(mapper)).toBe(10);
    expect(barSpacingPx({ ...mapper, getCandles: () => [] })).toBe(8);
  });

  it('projeksiyon oranı; çapalı VWAP hacim ağırlıklı, hacimsiz barları ağırlıksız sayar', () => {
    expect(projectionRatio([{ time: 0, price: 100 }, { time: 1, price: 200 }, { time: 2, price: 150 }])).toBeCloseTo(0.5);
    expect(projectionRatio([{ time: 0, price: 100 }, { time: 1, price: 100 }, { time: 2, price: 150 }])).toBeNaN();
    expect(projectionRatio([])).toBeNaN();
    const v = anchoredVwap(candles, 1000);
    expect(v).toHaveLength(30);
    const tp = (c: Candle) => (c.high + c.low + c.close) / 3;
    expect(v[0].value).toBeCloseTo(tp(candles[0]));
    expect(v[1].value).toBeCloseTo((tp(candles[0]) + tp(candles[1])) / 2);
    expect(v[3].value).toBeCloseTo(v[2].value); // hacimsiz bar VWAP'ı değiştirmez
    const z = anchoredVwap([{ ...candles[0], volume: 0 }, { ...candles[1], volume: 0 }], 0);
    expect(z[1].value).toBeCloseTo((tp(candles[0]) + tp(candles[1])) / 2);
  });

  it('çapalı VP: çapadan sonraki barların profili + POC', () => {
    const g = svgEl();
    TOOL_DEFS.anchored_vp!.render(obj('anchored_vp', [[2000, 130]]), mapper, g, 800, 600);
    expect(g.querySelectorAll('[data-vp-row]').length).toBeGreaterThan(3);
  });
});

describe('yazı / not / ikon', () => {
  it('metin satırları, genişlik, tablo ayrıştırma ve yerleşim', () => {
    expect(textLines('a\nb\r')).toEqual(['a', 'b']);
    expect(textLines('')).toEqual(['']);
    expect(textWidth('abcd', 10)).toBe(24);
    expect(parseTable('a|b|c\nd')).toEqual([['a', 'b', 'c'], ['d', '', '']]);
    const L = tableLayout(parseTable('Başlık|x\n1|2'), 12);
    expect(L.colW).toHaveLength(2);
    expect(L.h).toBe(L.rowH * 2);
    const bs = boxSize(['abc', 'abcdef'], 10);
    expect(bs.w).toBe(36 + 16);
  });

  it('açıklama balonu kuyruğu kutunun uca bakan kenarından çıkar', () => {
    const box = { x: 100, y: 100, w: 80, h: 40 };
    const left = calloutTail(box, { x: 20, y: 120 });
    expect(left[0].x).toBe(100);
    expect(left[1]).toEqual({ x: 20, y: 120 });
    const below = calloutTail(box, { x: 140, y: 300 });
    expect(below[0].y).toBe(140);
  });

  it('çapalı metin ekran kesrinden piksele; tablo varsayılan olarak düz ızgara (başlık vurgusu yok)', () => {
    expect(screenPoint({ time: 0.5, price: 0.25 }, 800, 600)).toEqual({ x: 400, y: 150 });
    const g = svgEl();
    TOOL_DEFS.table!.render(obj('table', [[1200, 130]], { label: 'A|B\n1|2' }), mapper, g, 800, 600);
    const t = Array.from(g.querySelectorAll('text'));
    expect(t.map((x) => x.textContent)).toEqual(['A', 'B', '1', '2']);
    expect(t[0].getAttribute('font-weight')).toBeNull();
    expect(g.querySelectorAll('line').length).toBe(2);
  });

  it('not / iğne balonları gizlenebilir sınıfta; fiyat notu p0 fiyatını yazar', () => {
    const g = svgEl();
    TOOL_DEFS.note!.render(obj('note', [[1200, 130]], { label: 'Önemli' }), mapper, g, 800, 600);
    expect(g.querySelector('.drawing-reveal')!.textContent).toContain('Önemli');
    const g2 = svgEl();
    TOOL_DEFS.price_note!.render(obj('price_note', [[1200, 130.5], [1500, 140]]), mapper, g2, 800, 600);
    expect(g2.textContent).toContain('130.50');
    const g3 = svgEl();
    TOOL_DEFS.pin!.render(obj('pin', [[1200, 130]], { label: '' }), mapper, g3, 800, 600);
    expect(g3.querySelector('.drawing-reveal')).toBeNull();
  });

  it('ikon seti: benzersiz anahtarlar, emoji kategorileri; çözümleme ve render', () => {
    expect(new Set(ALL_ICON_KEYS).size).toBe(ALL_ICON_KEYS.length);
    expect(ALL_ICON_KEYS.length).toBeGreaterThanOrEqual(60);
    expect(ICON_CATEGORIES.length).toBe(5);
    expect(EMOJI_CATEGORIES.flatMap((c) => c.items).length).toBeGreaterThanOrEqual(80);
    expect(resolveIcon('i:bull')).toMatchObject({ kind: 'svg' });
    expect(resolveIcon('🚀')).toEqual({ kind: 'emoji', char: '🚀' });
    expect(resolveIcon('i:yok')).toMatchObject({ kind: 'svg', def: { key: 'star' } });
    expect(resolveIcon(undefined)).toMatchObject({ kind: 'svg' });
    expect(iconPreviewSvg(iconDef('bolt')!)).toContain('fill="currentColor"');
    expect(iconPreviewSvg(iconDef('check')!)).toContain('stroke="currentColor"');
    const g = svgEl();
    TOOL_DEFS.icon!.render(obj('icon', [[1200, 130]], { icon: 'i:rocket', fontSize: 48 }), mapper, g, 800, 600);
    expect(g.querySelector('[data-icon="rocket"]')!.getAttribute('transform')).toContain('scale(2)');
    const g2 = svgEl();
    TOOL_DEFS.icon!.render(obj('icon', [[1200, 130]], { icon: '🐂' }), mapper, g2, 800, 600);
    expect(g2.querySelector('text')!.textContent).toBe('🐂');
  });
});

describe('mıknatıs', () => {
  const p2y = (p: number) => 600 - p * 2;
  it('güçlü: her zaman en yakın OHLC; zayıf: yalnız eşik içinde', () => {
    // bar 1000: o100 h105 l95 c102
    expect(nearestOhlc(103.4, candles[0])).toBe(102);
    expect(snapPrice(103.4, 1000, candles, 'strong', p2y)).toBe(102);
    expect(snapPrice(103.4, 1000, candles, 'weak', p2y)).toBe(102); // 2.8px
    expect(snapPrice(120, 1000, candles, 'weak', p2y)).toBe(120); // 30px > eşik
    expect(snapPrice(120, 1000, candles, 'strong', p2y)).toBe(105);
    expect(snapPrice(120, 1000, candles, 'weak')).toBe(105); // piksel yoksa güçlü gibi
    expect(snapPrice(120, 1000, candles, 'off', p2y)).toBe(120);
    expect(snapPrice(120, 1050, candles, 'strong', p2y)).toBe(120); // bar yok
    expect(snapPrice(120, 1000, [], 'strong', p2y)).toBe(120);
    expect(snapPrice(120, 1000, candles, 'weak', () => null)).toBe(120);
    expect(WEAK_MAGNET_PX).toBeGreaterThan(0);
    expect(findBar(candles, 2900)?.time).toBe(2900);
    expect(findBar(candles, 2901)).toBeNull();
  });

  it('Ctrl/⌘ ters çevirme', () => {
    expect(effectiveMagnet('off', true)).toBe('strong');
    expect(effectiveMagnet('weak', true)).toBe('off');
    expect(effectiveMagnet('weak', false)).toBe('weak');
  });
});

describe('aralıklara göre görünürlük', () => {
  it('zaman dilimi ayrıştırma ve filtre', () => {
    expect(parseTimeframe('15m')).toEqual({ unit: 'min', n: 15 });
    expect(parseTimeframe('4h')).toEqual({ unit: 'hour', n: 4 });
    expect(parseTimeframe('1M')).toEqual({ unit: 'month', n: 1 });
    expect(parseTimeframe('30s')).toEqual({ unit: 'sec', n: 30 });
    expect(parseTimeframe('x')).toBeNull();
    expect(parseTimeframe('0m')).toBeNull();
    expect(isVisibleOn({}, '15m')).toBe(true);
    const v = { min: [5, 30] as [number, number], hour: null, day: [1, 1] as [number, number] };
    expect(isVisibleOn({ visibility: v }, '15m')).toBe(true);
    expect(isVisibleOn({ visibility: v }, '1m')).toBe(false);
    expect(isVisibleOn({ visibility: v }, '4h')).toBe(false);
    expect(isVisibleOn({ visibility: v }, '1d')).toBe(true);
    expect(isVisibleOn({ visibility: v }, '1w')).toBe(true); // tanımsız birim görünür
    expect(isVisibleOn({ visibility: v }, '??')).toBe(true);
  });

  it('yalnız bu aralık + normalize (kırpma, takas, varsayılan → undefined)', () => {
    const o = onlyThisTimeframe('4h')!;
    expect(o.hour).toEqual([4, 4]);
    expect(o.min).toBeNull();
    expect(isVisibleOn({ visibility: o }, '4h')).toBe(true);
    expect(isVisibleOn({ visibility: o }, '1h')).toBe(false);
    expect(onlyThisTimeframe('bozuk')).toBeUndefined();
    expect(normalizeVisibility({ min: [1, 59], hour: [1, 24] })).toBeUndefined();
    expect(normalizeVisibility({ min: [40, 5] })).toEqual({ min: [5, 40] });
    expect(normalizeVisibility({ day: [0, 999] })).toBeUndefined();
    expect(normalizeVisibility({ week: null })).toEqual({ week: null });
    expect(normalizeVisibility(undefined)).toBeUndefined();
  });
});

describe('DrawingManager — Faz 22 etkileşimleri', () => {
  function setup(opts: Partial<ConstructorParameters<typeof DrawingManager>[0]> = {}) {
    const svg = document.createElementNS(NS, 'svg') as SVGSVGElement;
    document.body.appendChild(svg);
    const manager = new DrawingManager({ svg, mapper, autoPersist: false, ...opts });
    return { svg, manager };
  }

  it('XABCD 5 tıkta biter; taslakta kısmi önizleme', () => {
    const { manager, svg } = setup();
    manager.setTool('xabcd');
    const pts: Array<[number, number]> = [[1000, 100], [1200, 200], [1400, 140], [1600, 180]];
    for (const [t, p] of pts) expect(manager.handlePointInput({ time: t, price: p })).toBeNull();
    expect(svg.querySelector('[data-drawing-id="draft_preview"] path')).toBeTruthy();
    const d = manager.handlePointInput({ time: 1800, price: 120 })!;
    expect(d.points).toHaveLength(5);
    expect(manager.getTool()).toBe('cursor');
  });

  it('çizimde kal: araç tamamlanınca imleç seçilmez, ikinci çizim hemen başlar', () => {
    let resets = 0;
    const { manager } = setup({ onToolReset: () => resets++ });
    manager.setStayInDrawing(true);
    expect(manager.isStayInDrawing()).toBe(true);
    manager.setTool('hline');
    manager.handlePointInput({ time: 1000, price: 100 });
    manager.handlePointInput({ time: 1100, price: 110 });
    expect(manager.getDrawings()).toHaveLength(2);
    expect(manager.getTool()).toBe('hline');
    expect(resets).toBe(0);
    manager.setStayInDrawing(false);
    manager.handlePointInput({ time: 1200, price: 120 });
    expect(manager.getTool()).toBe('cursor');
    expect(resets).toBe(1);
  });

  it('mıknatıs modları: güçlü yapıştırır, zayıf uzakta bırakır; eski boolean API', () => {
    const { manager } = setup();
    manager.setMagnet('weak');
    expect(manager.getMagnetMode()).toBe('weak');
    manager.setTool('hline');
    expect(manager.handlePointInput({ time: 1000, price: 120 })!.points[0].price).toBe(120);
    manager.setMagnet(true);
    expect(manager.getMagnetMode()).toBe('strong');
    manager.setTool('hline');
    expect(manager.handlePointInput({ time: 1000, price: 120 })!.points[0].price).toBe(105);
    manager.setMagnetInvert(true);
    manager.setTool('hline');
    expect(manager.handlePointInput({ time: 1000, price: 120 })!.points[0].price).toBe(120);
    manager.setMagnetInvert(false);
    manager.setMagnet(false);
    expect(manager.isMagnetEnabled()).toBe(false);
  });

  it('stil hafızası: yeni çizim aracın hatırlanan rengini/kalınlığını alır; kullanıcı rengi önceliklidir', () => {
    const styles: Record<string, object> = { trendline: { color: '#FF9800', width: 3, lineStyle: 'dashed' }, note: { fontSize: 20 } };
    const { manager } = setup({ toolStyle: (t) => styles[t] });
    manager.setTool('trendline');
    manager.handlePointInput({ time: 1000, price: 100 });
    const d = manager.handlePointInput({ time: 1200, price: 110 })!;
    expect(d.color).toBe('#FF9800');
    expect(d.width).toBe(3);
    expect(d.lineStyle).toBe('dashed');
    manager.setTool('trendline', '#AB47BC');
    manager.handlePointInput({ time: 1000, price: 100 });
    expect(manager.handlePointInput({ time: 1200, price: 110 })!.color).toBe('#AB47BC');
    manager.setTool('note');
    const n = manager.handlePointInput({ time: 1000, price: 100 })!;
    expect(n.fontSize).toBe(20);
    expect(n.label).toBe('Not');
    manager.setToolStyleProvider(undefined);
    manager.setTool('pin');
    expect(manager.handlePointInput({ time: 1000, price: 100 })!.color).toBe('#F23645');
  });

  it('ikon aracı seçili ikonu yerleştirir; çubuk deseni anlık görüntü alır', () => {
    const { manager } = setup();
    manager.setIconChoice('🚀');
    manager.setTool('icon');
    expect(manager.handlePointInput({ time: 1000, price: 100 })!.icon).toBe('🚀');
    manager.setTool('bars_pattern');
    manager.handlePointInput({ time: 1000, price: 1 });
    const b = manager.handlePointInput({ time: 1300, price: 2 })!;
    expect(b.bars).toHaveLength(4);
    expect(b.points[0].price).toBe(100);
  });

  it('hayalet akış değişken noktalı; çapalı metin ekran kesri olarak saklanır ve sürüklenir', () => {
    const { manager, svg } = setup();
    manager.setTool('ghost_feed');
    manager.handlePointInput({ time: 1000, price: 100 });
    expect(manager.finishDraft()).toBeNull();
    manager.handlePointInput({ time: 1400, price: 120 });
    expect(manager.finishDraft()!.toolType).toBe('ghost_feed');

    manager.setTool('anchored_text');
    svg.getBoundingClientRect = () => ({ left: 0, top: 0, right: 1000, bottom: 600, width: 1000, height: 600, x: 0, y: 0, toJSON: () => ({}) });
    svg.dispatchEvent(new MouseEvent('mousedown', { clientX: 250, clientY: 150, bubbles: true }));
    const t = manager.getDrawings().find((d) => d.toolType === 'anchored_text')!;
    expect(t.points[0]).toEqual({ time: 0.25, price: 0.25 });
    expect(t.label).toBe('Metin');
    // sürükle: 100px sağa → kesir 0.35
    expect(manager.beginDrag(t.id, 'body', 0, 0)).toBe(true);
    manager.dragTo(100, 60);
    manager.endDrag();
    const moved = manager.getDrawings().find((d) => d.id === t.id)!;
    expect(moved.points[0].time).toBeCloseTo(0.35);
    expect(moved.points[0].price).toBeCloseTo(0.35);
    // seçilince tutamak ekrandaki konumda
    manager.selectDrawing(t.id);
    const h = svg.querySelector(`[data-drawing-id="${t.id}"] [data-anchor="0"] circle`)!;
    expect(Number(h.getAttribute('cx'))).toBeCloseTo(350);
  });

  it('görünürlük: geçerli aralıkta gizli çizim render edilmez', () => {
    const { manager, svg } = setup();
    manager.setContext('S', '15m');
    manager.setDrawings([
      obj('hline', [[1000, 100]], { id: 'a', visibility: { min: [1, 5] } }),
      obj('hline', [[1000, 110]], { id: 'b', visibility: { min: [15, 15] } }),
    ]);
    expect(svg.querySelector('[data-drawing-id="a"]')).toBeNull();
    expect(svg.querySelector('[data-drawing-id="b"]')).toBeTruthy();
    manager.setContext('S', '1m');
    manager.render();
    expect(svg.querySelector('[data-drawing-id="a"]')).toBeTruthy();
    expect(svg.querySelector('[data-drawing-id="b"]')).toBeNull();
  });
});
