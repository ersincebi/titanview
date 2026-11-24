import { describe, expect, it } from 'vitest';
import {
  ALL_LAYOUT_IDS,
  CHART_LAYOUTS,
  DEFAULT_SECONDARY,
  DEFAULT_SLOT_SYMBOLS,
  DEFAULT_SYNC,
  LAYOUT_GROUPS,
  LAYOUT_TEMPLATES,
  MAX_CHARTS,
  defaultSlots,
  getLayoutTemplate,
  gridCellStyle,
  gridContainerStyle,
  isChartLayout,
  layoutIconSvg,
  nextLayout,
  normalizeSyncOptions,
  secondaryCount,
} from '../layout';

describe('layout (Faz 25: 42 Standart şablonu, 1–16 grafik)', () => {
  it('cycles single -> 2x1 -> 2x2 -> single', () => {
    expect(nextLayout('single')).toBe('2x1');
    expect(nextLayout('2x1')).toBe('2x2');
    expect(nextLayout('2x2')).toBe('single');
    expect(nextLayout('4x4')).toBe('single');
  });

  it('contains >= 40 Standart templates spanning 1 to 16 charts with exact non-overlapping grid tiling', () => {
    expect(LAYOUT_TEMPLATES.length).toBeGreaterThanOrEqual(40);
    expect(new Set(ALL_LAYOUT_IDS).size).toBe(LAYOUT_TEMPLATES.length);
    expect(LAYOUT_GROUPS.map((g) => g.count)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 14, 16]);
    expect(MAX_CHARTS).toBe(16);
    expect(DEFAULT_SLOT_SYMBOLS).toHaveLength(16);
    expect(new Set(DEFAULT_SLOT_SYMBOLS).size).toBe(16);

    for (const tpl of LAYOUT_TEMPLATES) {
      expect(tpl.cells).toHaveLength(tpl.count);
      // Her 1x1 grid karesi tam olarak 1 hücre tarafından kaplanmalı (ne boşluk ne çakışma)
      const grid = Array.from({ length: tpl.rows }, () => Array<number>(tpl.cols).fill(0));
      for (const [c1, c2, r1, r2] of tpl.cells) {
        expect(c1).toBeGreaterThanOrEqual(1);
        expect(c2).toBeLessThanOrEqual(tpl.cols + 1);
        expect(c2).toBeGreaterThan(c1);
        expect(r1).toBeGreaterThanOrEqual(1);
        expect(r2).toBeLessThanOrEqual(tpl.rows + 1);
        expect(r2).toBeGreaterThan(r1);
        for (let r = r1 - 1; r < r2 - 1; r++) {
          for (let c = c1 - 1; c < c2 - 1; c++) {
            grid[r][c] += 1;
          }
        }
      }
      for (let r = 0; r < tpl.rows; r++) {
        for (let c = 0; c < tpl.cols; c++) {
          expect(grid[r][c], `${tpl.id} cell (${r},${c})`).toBe(1);
        }
      }
      const svg = layoutIconSvg(tpl);
      expect(svg.startsWith('<svg')).toBe(true);
      expect((svg.match(/<rect /g) ?? []).length).toBe(tpl.count);
    }
  });

  it('pane counts, CSS styles, slot defaults and sync normalization work cleanly', () => {
    expect(CHART_LAYOUTS.map(secondaryCount)).toEqual([0, 1, 3]);
    expect(secondaryCount('4x4')).toBe(15);
    expect(DEFAULT_SECONDARY).toHaveLength(3);
    expect(isChartLayout('4x4')).toBe(true);
    expect(isChartLayout('3-1l2r')).toBe(true);
    expect(isChartLayout('nope')).toBe(false);

    expect(gridContainerStyle(getLayoutTemplate('single'))).toEqual({});
    expect(gridContainerStyle(getLayoutTemplate('4x4'))).toMatchObject({
      display: 'grid',
      'grid-template-columns': 'repeat(4, minmax(0, 1fr))',
      'grid-template-rows': 'repeat(4, minmax(0, 1fr))',
    });
    expect(gridCellStyle(getLayoutTemplate('3-1l2r'), 0)).toEqual({ 'grid-column': '1 / 2', 'grid-row': '1 / 3' });

    const slots = defaultSlots('AAPL', '2h');
    expect(slots).toHaveLength(16);
    expect(slots[0]).toEqual({ symbol: 'AAPL', interval: '2h' });
    expect(slots[1].interval).toBe('2h');

    expect(normalizeSyncOptions(null)).toEqual(DEFAULT_SYNC);
    expect(normalizeSyncOptions({ symbol: true, interval: true, drawings: 'global', crossTab: true, time: true, dateRange: true, crosshair: false })).toEqual({
      symbol: true,
      interval: true,
      crosshair: false,
      time: true,
      dateRange: true,
      drawings: 'global',
      crossTab: true,
    });
  });
});
