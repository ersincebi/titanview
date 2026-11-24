import { describe, expect, it } from 'vitest';
import type { ScriptExecutionResult, ScriptPlotSeries } from '../../types/market';
import {
  applyStudyStyle,
  defaultVisibility,
  dependentsOf,
  formatStudyValue,
  intervalUnit,
  legendLabel,
  newStudyInstance,
  normalizeStudy,
  parseSourceRef,
  plotAsSeries,
  resolvePanes,
  sourceRef,
  studyDeps,
  topoOrder,
  valueAt,
  visibleOnInterval,
} from '../studyModel';

const plot = (title: string, extra: Partial<ScriptPlotSeries> = {}): ScriptPlotSeries => ({
  id: title,
  title,
  color: '#0284C7',
  lineWidth: 1,
  style: 'line',
  isOverlay: false,
  data: [
    { time: 10, value: 1, color: '#00FF00' },
    { time: 20, value: 2 },
  ],
  ...extra,
});

const res = (over: Partial<ScriptExecutionResult> = {}): ScriptExecutionResult => ({
  ok: true,
  scriptTitle: 'X',
  isStrategy: false,
  isOverlay: false,
  executionMs: 1,
  plots: [plot('A'), plot('B')],
  markers: [{ time: 10, position: 'aboveBar', color: '#f00', shape: 'circle', text: 'x' }],
  hlines: [{ price: 70, title: 'Up', color: '#787B86' }, { price: 30, title: 'Dn', color: '#787B86' }],
  fills: [{ title: 'F', a: { price: 70 }, b: { price: 30 }, isOverlay: false, points: [] }],
  bgcolors: [{ title: 'bg', isOverlay: false, points: [{ time: 10, color: '#111' }] }],
  barcolors: [{ time: 10, color: '#222' }],
  ...over,
});

describe('studyModel', () => {
  it('stil: gizle/renk/kalınlık/tip, renk değişince bar renkleri düşer, hline/fill/bg/şekil gizleme', () => {
    const s = newStudyInstance('s1', {
      plots: { A: { color: '#FF0000', lineWidth: 3, style: 'histogram' }, B: { visible: false }, __shapes: { visible: false }, __barcolor: { visible: false } },
      hlines: { Up: { visible: false }, Dn: { color: '#00FF00' } },
      fills: { F: { visible: false } },
      bgVisible: false,
    });
    const r = applyStudyStyle(res(), s, false);
    expect(r.plots[0]).toMatchObject({ color: '#FF0000', lineWidth: 3, style: 'histogram', hidden: false });
    expect(r.plots[0].data[0].color).toBeUndefined();
    expect(r.plots[1].hidden).toBe(true);
    expect(r.hlines).toEqual([{ price: 30, title: 'Dn', color: '#00FF00' }]);
    expect(r.fills).toEqual([]);
    expect(r.bgcolors).toEqual([]);
    expect(r.markers).toEqual([]);
    expect(r.barcolors).toEqual([]);
    // ana panele taşınmış osilatör: her şey overlay
    const m = applyStudyStyle(res(), newStudyInstance('s1'), true);
    expect(m.isOverlay).toBe(true);
    expect(m.plots.every((p) => p.isOverlay)).toBe(true);
    expect(applyStudyStyle({ ...res(), ok: false }, s, true).ok).toBe(false);
  });

  it('görünürlük: aralık birimi ve min-max', () => {
    expect(intervalUnit('15m')).toEqual({ unit: 'minutes', n: 15 });
    expect(intervalUnit('4h')).toEqual({ unit: 'hours', n: 4 });
    expect(intervalUnit('1M')).toEqual({ unit: 'months', n: 1 });
    expect(intervalUnit('?')).toBeNull();
    const v = defaultVisibility();
    expect(visibleOnInterval(v, '15m')).toBe(true);
    v.minutes.max = 5;
    expect(visibleOnInterval(v, '15m')).toBe(false);
    expect(visibleOnInterval(v, '5m')).toBe(true);
    v.days.on = false;
    expect(visibleOnInterval(v, '1d')).toBe(false);
    expect(visibleOnInterval(v, 'garip')).toBe(true);
  });

  it('kaynak referansı, bağımlılık sırası, döngü ve silinmiş kaynak', () => {
    expect(parseSourceRef('@s2:RSI')).toEqual({ uid: 's2', plot: 'RSI' });
    expect(parseSourceRef('@x')).toBeNull();
    expect(parseSourceRef('close')).toBeNull();
    expect(sourceRef('a', 'B: c')).toBe('@a:B: c');
    const a = newStudyInstance('a', { builtinId: 'ema' });
    const b = newStudyInstance('b', { builtinId: 'rsi', inputs: { Source: '@a:EMA' } });
    const c = newStudyInstance('c', { builtinId: 'sma', inputs: { Source: '@b:RSI' } });
    expect(studyDeps(c)).toEqual(['b']);
    const { order, broken } = topoOrder([c, b, a]);
    expect(order.map((s) => s.uid)).toEqual(['a', 'b', 'c']);
    expect(broken.size).toBe(0);
    expect([...dependentsOf([a, b, c], 'a')].sort()).toEqual(['b', 'c']);
    const x = newStudyInstance('x', { builtinId: 'rsi', inputs: { Source: '@y:P' } });
    const y = newStudyInstance('y', { builtinId: 'rsi', inputs: { Source: '@x:P' } });
    const z = newStudyInstance('z', { builtinId: 'rsi', inputs: { Source: '@silindi:P' } });
    const t = topoOrder([x, y, z]);
    expect([...t.broken].sort()).toEqual(['x', 'y', 'z']);
    expect(t.order).toHaveLength(3);
  });

  it('pane çözümleme: otomatik, ana, yeni, birleştir (zincir), kendine birleştirme yok', () => {
    const list = [
      newStudyInstance('o', { builtinId: 'sma' }),
      newStudyInstance('r', { builtinId: 'rsi' }),
      newStudyInstance('m', { builtinId: 'mfi', pane: 'with:r' }),
      newStudyInstance('k', { builtinId: 'cci', pane: 'with:m' }),
      newStudyInstance('n', { builtinId: 'sma', pane: 'new' }),
      newStudyInstance('q', { builtinId: 'rsi', pane: 'main' }),
      newStudyInstance('w', { builtinId: 'rsi', pane: 'with:w' }),
      newStudyInstance('g', { builtinId: 'rsi', pane: 'with:yok' }),
    ];
    const p = resolvePanes(list, (uid) => uid === 'o' || uid === 'n');
    expect(Object.fromEntries(p)).toEqual({
      o: 'main',
      r: 'study:r',
      m: 'study:r',
      k: 'study:r',
      n: 'study:n',
      q: 'main',
      w: 'study:w',
      g: 'study:g',
    });
  });

  it('lejant etiketi Standart biçimi; display=data_window ve bool/renk girdileri gizli; kaynak gösterge adı', () => {
    const label = legendLabel(
      'RSI',
      [
        { title: 'Len', type: 'int', defval: 14 },
        { title: 'Src', type: 'source', defval: 'close', value: '@s1:EMA' },
        { title: 'MA', type: 'string', defval: 'SMA', display: 2 },
        { title: 'Show', type: 'bool', defval: true },
        { title: 'Col', type: 'color', defval: '#fff' },
        { title: 'F', type: 'float', defval: 0.123456789 },
        { title: 'E', type: 'string', defval: '' },
      ],
      (r) => `EMA 9: ${r.plot}`
    );
    expect(label).toBe('RSI 14 EMA 9: EMA 0.123457');
    expect(legendLabel('OBV', [], () => '')).toBe('OBV');
  });

  it('değer okuma, seri hizalama, biçimleme, normalize', () => {
    const p = plot('A');
    expect(valueAt(p, 10)).toEqual({ value: 1, color: '#00FF00' });
    expect(valueAt(p, 15)).toBeNull();
    expect(valueAt(p, null)).toEqual({ value: 2, color: '#0284C7' });
    expect(valueAt({ ...p, data: [] }, null)).toBeNull();
    expect(plotAsSeries(res(), 'A', [10, 15, 20])).toEqual([1, NaN, 2]);
    expect(plotAsSeries(res(), 'yok', [10])).toBeUndefined();
    expect(plotAsSeries(undefined, 'A', [10])).toBeUndefined();
    expect(formatStudyValue(NaN, -1)).toBe('∅');
    expect(formatStudyValue(1234.5678, 1)).toBe('1234.6');
    expect(formatStudyValue(2_500_000_000, -1)).toBe('2.500B');
    expect(formatStudyValue(34_000_000, -1)).toBe('34.000M');
    expect(formatStudyValue(3_400_000, -1)).toBe('3400000.00');
    expect(formatStudyValue(70_312.456, -1)).toBe('70312.46');
    expect(formatStudyValue(0.000123, -1)).toBe('0.000123');
    expect(formatStudyValue(0.12345, -1)).toBe('0.1235');
    expect(normalizeStudy(null)).toBeNull();
    expect(normalizeStudy({ uid: 'a' })).toBeNull();
    const n = normalizeStudy({ uid: 'a', builtinId: 'rsi', scale: 'garip', precision: 2.5, visibility: { days: { on: false, min: 2, max: 9 } } })!;
    expect(n.scale).toBe('right');
    expect(n.precision).toBe(-1);
    expect(n.visibility.days).toEqual({ on: false, min: 2, max: 9 });
    expect(n.visibility.minutes.on).toBe(true);
  });
});
