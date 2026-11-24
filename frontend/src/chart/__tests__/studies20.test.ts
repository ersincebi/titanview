// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('lightweight-charts', async () => (await import('./lwcMock')).lwcModule());

import { TitanChartController, studySignature, type StudyRenderInput } from '../ChartController';
import { builtinById } from '../../script/builtins';
import { executeScript } from '../../script/runtime';
import { walkCandles } from '../../script/__tests__/walkCandles';
import { applyStudyStyle, newStudyInstance } from '../../state/studyModel';
import type { ScriptExecutionResult } from '../../types/market';

beforeAll(() => {
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

const BARS = walkCandles(300, 900, 1_700_000_000);
const run = (id: string, inputs: Record<string, unknown> = {}): ScriptExecutionResult => {
  const r = executeScript(builtinById(id)!.code, BARS, { symbol: 'T', timeframe: '15', inputOverrides: inputs });
  if (!r.ok) throw new Error(r.error);
  return r;
};

function controller() {
  const host = document.createElement('div');
  const el = document.createElement('div');
  host.appendChild(el);
  document.body.appendChild(host);
  const c = new TitanChartController(el);
  c.setHistoryData(BARS);
  return c;
}

const item = (uid: string, id: string, pane: string, extra: Partial<StudyRenderInput> = {}): StudyRenderInput => {
  const s = newStudyInstance(uid, { builtinId: id });
  return { uid, pane, label: id, result: applyStudyStyle(run(id), s, pane === 'main'), scale: 'right', priceLabels: true, statusValues: true, precision: -1, ...extra };
};

describe('Faz 20: ChartController.renderStudies', () => {
  it('overlay ana pane, osilatör kendi pane, birleştirilmiş iki gösterge tek pane', () => {
    const c = controller();
    c.renderStudies([item('s1', 'sma', 'main'), item('s2', 'rsi', 'study:s2'), item('s3', 'mfi', 'study:s2')]);
    const panes = c.getStudyPanes();
    expect(panes.s1.pane).toBe('main');
    expect(panes.s2.pane).toBe('study:s2');
    expect(panes.s3.pane).toBe('study:s2');
    expect(c.getPaneOrder()).toEqual(['main', 'study:s2']);
    expect(panes.s2.series).toBe(2); // RSI + RSI MA
  });

  it('yapı aynıysa seriler korunur (yalnız veri güncellenir); yapı değişince yeniden kurulur; kaldırılan gösterge pane\'i kapatır', () => {
    const c = controller();
    const chart = c.getMainChart() as unknown as { addSeries: { mock: { calls: unknown[] } }; removeSeries: { mock: { calls: unknown[] } } };
    c.renderStudies([item('s1', 'rsi', 'study:s1')]);
    const added = chart.addSeries.mock.calls.length;
    c.renderStudies([item('s1', 'rsi', 'study:s1')]);
    expect(chart.addSeries.mock.calls.length).toBe(added);
    const recolored = item('s1', 'rsi', 'study:s1');
    recolored.result = { ...recolored.result, plots: recolored.result.plots.map((p) => ({ ...p, color: '#FF0000' })) };
    expect(studySignature(recolored)).not.toBe(studySignature(item('s1', 'rsi', 'study:s1')));
    c.renderStudies([recolored]);
    expect(chart.addSeries.mock.calls.length).toBeGreaterThan(added);
    c.renderStudies([]);
    expect(c.getStudyPanes()).toEqual({});
    expect(c.getPaneOrder()).toEqual(['main']);
  });

  it('pane durum satırı: imleçteki değerler; ölçeksiz/sol ölçek seçenekleri; hline + bgcolor + çizim katmanı', () => {
    const c = controller();
    c.renderStudies([
      item('s1', 'rsi', 'study:s1'),
      item('s2', 'ema', 'main', { scale: 'none' }),
      item('s3', 'sma', 'main', { scale: 'left' }),
      item('s4', 'linreg_channel', 'main'),
      item('s5', 'cdl_all', 'main'),
    ]);
    c.setStudyHoverTime(BARS[200].time);
    const chrome = document.querySelector('.pane-chrome-study\\:s1');
    void chrome;
    const panes = c.getStudyPanes();
    expect(Object.keys(panes)).toEqual(['s1', 's2', 's3', 's4', 's5']);
    expect(panes.s4.series).toBe(0); // yalnız line.new çizimleri: SVG katmanı
    c.setChartStyleMode('renko');
    expect(Object.keys(c.getStudyPanes())).toHaveLength(5);
    c.destroy();
  });
});
