import { describe, expect, it } from 'vitest';
import { IDEA_TAGS, corrColor, filterIdeas, heatColor, parseCommand, resolveSymbol, scoreColor, treemap } from '../terminal';
import type { IdeaRow } from '../../api/client';

const KNOWN = ['THYAO.IS', 'BTCUSDT', 'AAPL', 'XU100.IS'];

describe('parseCommand', () => {
  it('sembol + fiil', () => {
    expect(parseCommand('thyao gp', KNOWN)).toEqual({ kind: 'chart', symbol: 'THYAO.IS' });
    expect(parseCommand('AAPL DES', KNOWN)).toEqual({ kind: 'des', symbol: 'AAPL' });
    expect(parseCommand('btc n', KNOWN)).toEqual({ kind: 'news', symbol: 'BTCUSDT' });
  });
  it('tek sözcük: görünümler ve sembol', () => {
    expect(parseCommand('heat')).toEqual({ kind: 'view', view: 'market' });
    expect(parseCommand('CORR')).toEqual({ kind: 'view', view: 'corr' });
    expect(parseCommand('scr')).toEqual({ kind: 'screener' });
    expect(parseCommand('news')).toEqual({ kind: 'news', symbol: null });
    expect(parseCommand('thyao', KNOWN)).toEqual({ kind: 'chart', symbol: 'THYAO.IS' });
  });
  it('NEWS SEMBOL', () => {
    expect(parseCommand('NEWS THYAO', KNOWN)).toEqual({ kind: 'news', symbol: 'THYAO.IS' });
  });
  it('bilinmeyenler hata verir', () => {
    expect(parseCommand('AAPL XYZ', KNOWN).kind).toBe('error');
    expect(parseCommand('a b c', KNOWN).kind).toBe('error');
    expect(parseCommand('   ').kind).toBe('error');
  });
  it('katalog dışı sembol olduğu gibi büyütülür', () => {
    expect(resolveSymbol('pepeusdt', KNOWN)).toBe('PEPEUSDT');
    expect(resolveSymbol('', KNOWN)).toBe('');
  });
});

describe('renk skalaları', () => {
  it('heatColor: işaret ve doygunluk', () => {
    const rgb = (s: string) => s.match(/\d+/g)!.map(Number);
    const up = rgb(heatColor(5));
    const dn = rgb(heatColor(-5));
    const mid = rgb(heatColor(0));
    expect(up[1]).toBeGreaterThan(up[0]); // yeşil baskın
    expect(dn[0]).toBeGreaterThan(dn[1]); // kırmızı baskın
    expect(heatColor(3)).toBe(heatColor(30)); // doygunluk tavanı
    expect(heatColor(1.5)).not.toBe(heatColor(0));
    expect(heatColor(1.5)).not.toBe(heatColor(3));
    expect(heatColor(null)).toBe(heatColor(0));
    expect(mid).toEqual(rgb(heatColor(NaN)));
  });
  it('corrColor: null şeffaf, ±1 doygun, 0 nötr', () => {
    expect(corrColor(null)).toBe('transparent');
    expect(corrColor(1)).toBe(heatColor(3));
    expect(corrColor(-1)).toBe(heatColor(-3));
    expect(corrColor(0)).toBe(heatColor(0));
  });
});

describe('treemap', () => {
  const items = [
    { key: 'a', weight: 50 },
    { key: 'b', weight: 30 },
    { key: 'c', weight: 15 },
    { key: 'd', weight: 5 },
  ];
  it('alanlar ağırlıkla orantılı ve kutuyu tam doldurur', () => {
    const rects = treemap(items, 200, 100);
    expect(rects).toHaveLength(4);
    const area = (k: string) => {
      const r = rects.find((x) => x.key === k)!;
      return r.w * r.h;
    };
    expect(rects.reduce((s, r) => s + r.w * r.h, 0)).toBeCloseTo(20000, 5);
    expect(area('a')).toBeCloseTo(10000, 5);
    expect(area('d')).toBeCloseTo(1000, 5);
  });
  it('dikdörtgenler sınır içinde ve çakışmaz', () => {
    const rects = treemap(items, 200, 100);
    for (const r of rects) {
      expect(r.x).toBeGreaterThanOrEqual(-1e-9);
      expect(r.y).toBeGreaterThanOrEqual(-1e-9);
      expect(r.x + r.w).toBeLessThanOrEqual(200 + 1e-9);
      expect(r.y + r.h).toBeLessThanOrEqual(100 + 1e-9);
    }
    for (let i = 0; i < rects.length; i++)
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i];
        const b = rects[j];
        const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
        const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        expect(ox > 1e-6 && oy > 1e-6).toBe(false);
      }
  });
  it('sıfır/negatif ağırlık ve boş girdi', () => {
    expect(treemap([{ key: 'x', weight: 0 }], 100, 100)).toEqual([]);
    expect(treemap([], 100, 100)).toEqual([]);
    expect(treemap([{ key: 'x', weight: 3 }], 0, 100)).toEqual([]);
    const one = treemap([{ key: 'x', weight: 3 }, { key: 'z', weight: -1 }], 100, 50);
    expect(one).toEqual([{ key: 'x', x: 0, y: 0, w: 100, h: 50 }]);
  });
});

import { heatWeights, timeAgo, volumeSpikes } from '../terminal';

describe('heatWeights', () => {
  const rows = [
    { symbol: 'XAU', market: 'FOREX', turnover: 5e12 },
    { symbol: 'EURUSD', market: 'FOREX', turnover: 1e6 },
    { symbol: 'THYAO.IS', market: 'BIST', turnover: 4e9 },
    { symbol: 'ASELS.IS', market: 'BIST', turnover: 3e8 },
    { symbol: 'AAPL', market: 'US', turnover: 9e9 },
    { symbol: 'DEAD', market: 'US', turnover: 0 },
  ];
  it('a giant-turnover symbol cannot swallow the others (the XAU bug)', () => {
    const w = heatWeights(rows);
    const total = w.reduce((a, b) => a + b.weight, 0);
    for (const x of w) expect(x.weight / total, x.key).toBeGreaterThan(0.02);
    const share = (k: string) => w.find((x) => x.key === k)!.weight / total;
    expect(share('XAU')).toBeLessThan(0.3);
  });
  it('each market gets a comparable share; bigger turnover still means a bigger tile', () => {
    const w = heatWeights(rows);
    const sum = (ks: string[]) => w.filter((x) => ks.includes(x.key)).reduce((a, b) => a + b.weight, 0);
    const fx = sum(['XAU', 'EURUSD']);
    const bist = sum(['THYAO.IS', 'ASELS.IS']);
    expect(Math.abs(fx - bist) / fx).toBeLessThan(0.25);
    const g = (k: string) => w.find((x) => x.key === k)!.weight;
    expect(g('THYAO.IS')).toBeGreaterThan(g('ASELS.IS'));
    expect(g('DEAD')).toBeGreaterThan(0); // zero-volume still visible
    expect(heatWeights([])).toEqual([]);
  });
});

describe('volumeSpikes', () => {
  const bars = Array.from({ length: 50 }, (_, i) => ({ time: i, open: 100, close: 100, volume: 100 }));
  it('finds only real anomalies, biggest first, with direction', () => {
    bars[40] = { time: 40, open: 100, close: 103, volume: 900 };
    bars[45] = { time: 45, open: 100, close: 98, volume: 400 };
    const s = volumeSpikes(bars);
    expect(s.map((x) => x.time)).toEqual([40, 45]);
    expect(s[0].ratio).toBeCloseTo(9);
    expect(s[0].up).toBe(true);
    expect(s[1].up).toBe(false);
    expect(s[1].change).toBeCloseTo(-2);
  });
  it('flat volume and short series give nothing', () => {
    expect(volumeSpikes(bars.map((b) => ({ ...b, volume: 100 })))).toEqual([]);
    expect(volumeSpikes(bars.slice(0, 10))).toEqual([]);
  });
});

describe('timeAgo', () => {
  const now = 1_700_000_000_000;
  it('formats relative time in Turkish', () => {
    const s = now / 1000;
    expect(timeAgo(s - 10, now)).toBe('az önce');
    expect(timeAgo(s - 300, now)).toBe('5 dk önce');
    expect(timeAgo(s - 7200, now)).toBe('2 sa önce');
    expect(timeAgo(s - 86400 * 3, now)).toBe('3 gün önce');
    expect(timeAgo(0, now)).toBe('');
  });
});

import { topPairs } from '../terminal';
describe('topPairs', () => {
  const syms = ['A', 'B', 'C', 'D'];
  const m: Array<Array<number | null>> = [
    [1, 0.9, -0.7, null],
    [0.9, 1, 0.1, 0.5],
    [-0.7, 0.1, 1, -0.95],
    [null, 0.5, -0.95, 1],
  ];
  it('lists each pair once, strongest first, skipping diagonal and gaps', () => {
    const t = topPairs(syms, m, 2);
    expect(t.positive.map((p) => `${p.a}${p.b}`)).toEqual(['AB', 'BD']);
    expect(t.negative.map((p) => `${p.a}${p.b}`)).toEqual(['CD', 'AC']);
    expect(topPairs(['A'], [[1]]).positive).toEqual([]);
    expect(topPairs(syms, m, 10).positive).toHaveLength(3);
  });
});

describe('içgörü komutları ve fikir süzgeci', () => {
  it('INS / IDEAS ayrıştırılır', () => {
    expect(parseCommand('ins', KNOWN)).toEqual({ kind: 'insight', symbol: null });
    expect(parseCommand('INSIGHT thyao', KNOWN)).toEqual({ kind: 'insight', symbol: 'THYAO.IS' });
    expect(parseCommand('btc ins', KNOWN)).toEqual({ kind: 'insight', symbol: 'BTCUSDT' });
    expect(parseCommand('ideas')).toEqual({ kind: 'view', view: 'ideas' });
    expect(parseCommand('fikir')).toEqual({ kind: 'view', view: 'ideas' });
  });
  const row = (symbol: string, market: string, tags: string[]): IdeaRow => ({
    symbol, displayName: symbol, market, last: 1, change1d: 0, score: 0, bias: '', tags, signals: [], rsi14: null, relVolume: null,
  });
  it('filterIdeas etiket ve piyasaya göre süzer', () => {
    const rows = [row('A', 'BIST', ['breakout']), row('B', 'US', ['breakout', 'squeeze']), row('C', 'US', [])];
    expect(filterIdeas(rows, null).map((r) => r.symbol)).toEqual(['A', 'B', 'C']);
    expect(filterIdeas(rows, 'breakout').map((r) => r.symbol)).toEqual(['A', 'B']);
    expect(filterIdeas(rows, 'breakout', 'US').map((r) => r.symbol)).toEqual(['B']);
    expect(filterIdeas(rows, 'squeeze', 'ALL').map((r) => r.symbol)).toEqual(['B']);
  });
  it('scoreColor uçlarda doygun, ortada nötr; etiket kimlikleri benzersiz', () => {
    expect(scoreColor(100)).toBe(scoreColor(60));
    expect(scoreColor(-100)).toBe(scoreColor(-60));
    expect(scoreColor(0)).toBe('rgb(120,130,145)');
    expect(scoreColor(60)).not.toBe(scoreColor(-60));
    expect(new Set(IDEA_TAGS.map((t) => t[0])).size).toBe(IDEA_TAGS.length);
  });
});
