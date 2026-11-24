import { describe, expect, it } from 'vitest';
import { DEFAULT_STYLE_PARAMS, deriveCandles, normalizeStyleParams, toKagi, toPnF } from '../chartTypes';
import { approxFootprint, autoFootprintRow, footprintRowForView, computeProfile, computeTPO, imbalances, niceStep, splitSessions, valueArea } from '../profile';

const bar = (time: number, o: number, h: number, l: number, c: number, v = 100) => ({ time, open: o, high: h, low: l, close: c, volume: v });
const closes = (xs: number[], step = 60) => xs.map((c, i) => bar(i * step, c, c, c, c, 10));

describe('Kagi', () => {
  it('dönüş miktarında yeni çizgi açar; omuz kırılınca kalınlaşır', () => {
    const k = toKagi(closes([100, 103, 106, 102, 101, 104, 108, 103]), { mode: 'fixed', atrLen: 14, value: 3 });
    expect(k.map((b) => [b.open, b.close])).toEqual([[100, 106], [106, 101], [101, 108], [108, 103]]);
    // ilk yükseliş yang; düşüş önceki bel yok → yang kalır; 101→108 omuz(106) kırılımı; 108→103 bel(101) kırılmaz
    expect(k[0].kagi).toEqual([{ from: 100, to: 106, yang: true }]);
    expect(k[1].kagi![0].yang).toBe(true);
    expect(k[2].kagi!.every((p) => p.yang)).toBe(true);
    expect(k[3].kagi!.every((p) => p.yang)).toBe(true);
  });
  it('bel kırılınca ince (yin) olur ve geçiş noktasında bölünür', () => {
    const k = toKagi(closes([100, 106, 102, 105, 99]), { mode: 'fixed', atrLen: 14, value: 3 });
    // 100→106 yang, 106→102 yang (bel=102), 102→105, 105→99: 102 altı yin
    const last = k[k.length - 1].kagi!;
    expect(last).toEqual([{ from: 105, to: 102, yang: true }, { from: 102, to: 99, yang: false }]);
  });
  it('zamanlar artan ve benzersiz', () => {
    const k = toKagi(closes([100, 110, 95, 112, 90, 115]), { mode: 'fixed', atrLen: 14, value: 2 });
    for (let i = 1; i < k.length; i++) expect(k[i].time).toBeGreaterThan(k[i - 1].time);
  });
});

describe('Nokta-Şekil', () => {
  it('kutu=1, dönüş=3: X sütunu, 3 kutu dönüşte O sütunu', () => {
    const p = toPnF(closes([100, 101, 102, 103, 102, 101, 100, 99, 100]), { mode: 'fixed', atrLen: 14, box: 1, reversal: 3, source: 'close' });
    expect(p.map((b) => [b.pnf!.kind, b.low, b.high])).toEqual([['X', 101, 103], ['O', 99, 102]]);
  });
  it('dönüş eşiğinin altı yeni sütun açmaz', () => {
    const p = toPnF(closes([100, 101, 102, 103, 102, 101]), { mode: 'fixed', atrLen: 14, box: 1, reversal: 3, source: 'close' });
    expect(p).toHaveLength(1);
  });
  it('hl kaynağı yüksek/düşükleri kullanır', () => {
    const c = [bar(0, 100, 100, 100, 100), bar(60, 100, 104, 100, 100.5)];
    const p = toPnF(c, { mode: 'fixed', atrLen: 14, box: 1, reversal: 3, source: 'hl' });
    expect(p[0].high).toBe(104);
  });
});

describe('Renko/Range parametreleri', () => {
  it('sabit kutu boyutu ATR yerine kullanılır', () => {
    const src = closes([100, 101, 102, 103, 104]);
    const fixed = deriveCandles('renko', src, { ...DEFAULT_STYLE_PARAMS, renko: { mode: 'fixed', atrLen: 14, box: 2 } });
    expect(fixed.map((b) => b.close)).toEqual([102, 104]);
  });
  it('normalizeStyleParams bozuk alanı varsayılana çeker', () => {
    const p = normalizeStyleParams({ renko: { mode: 'fixed', box: -3 }, pnf: { reversal: 2 } });
    expect(p.renko.mode).toBe('fixed');
    expect(p.renko.box).toBe(1);
    expect(p.pnf.reversal).toBe(2);
  });
});

describe('Hacim profili', () => {
  it('hacmi aralığa düzgün yayar, yukarı/aşağı ayırır, POC ve değer alanı', () => {
    const vp = computeProfile([bar(0, 10, 12, 10, 12, 200), bar(60, 12, 12, 11, 11, 100)], { rowSize: 1 })!;
    expect(vp.rows.map((r) => r.price)).toEqual([10, 11, 12]);
    expect(vp.rows[0].up).toBeCloseTo(100);
    expect(vp.rows[1].up).toBeCloseTo(100);
    expect(vp.rows[1].down).toBeCloseTo(100);
    expect(vp.totalVolume).toBeCloseTo(300);
    expect(vp.poc).toBe(11.5);
  });
  it('değer alanı büyük komşuya genişler', () => {
    expect(valueArea([1, 5, 10, 2, 1], 2, 70)).toEqual({ lo: 1, hi: 2 });
  });
  it('niceStep', () => {
    expect(niceStep(0.37)).toBe(0.5);
    expect(niceStep(13)).toBe(20);
    expect(niceStep(2.2)).toBe(2.5);
  });
});

describe('Seans + TPO', () => {
  it('BIST barlarını İstanbul gününe böler', () => {
    const d1 = Date.parse('2026-11-19T07:00:00Z') / 1000;
    const d2 = Date.parse('2026-11-20T07:00:00Z') / 1000;
    const s = splitSessions([bar(d1, 1, 1, 1, 1), bar(d1 + 1800, 1, 1, 1, 1), bar(d2, 1, 1, 1, 1)], 'BIST');
    expect(s.map((x) => [x.from, x.to, x.day])).toEqual([[0, 1, '2026-11-19'], [2, 2, '2026-11-20']]);
  });
  it('harfler periyot başına bir kez, POC en çok harf', () => {
    const b = [bar(0, 10, 12, 10, 11), bar(1800, 11, 11, 10, 10), bar(3600, 10, 11, 10, 11)];
    const t = computeTPO(b, [{ from: 0, to: 2, day: 'x' }], 1800, 1)[0];
    expect(t.rows.map((r) => r.letters)).toEqual(['ABC', 'ABC', 'A']);
    expect(t.ibHigh).toBe(12);
    expect(t.ibLow).toBe(10);
    expect(t.periods).toBe(3);
  });
});

describe('Footprint', () => {
  it('yaklaşık: toplam hacim korunur, alış payı CLV', () => {
    const fp = approxFootprint(bar(0, 10, 12, 10, 11.5, 400), 1);
    const sum = fp.rows.reduce((a, r) => a + r[1] + r[2], 0);
    expect(sum).toBeCloseTo(400);
    expect(fp.delta).toBeCloseTo(400 * 0.5);
    expect(fp.approx).toBe(true);
  });
  it('otomatik satır yüksekliği güzel sayı', () => {
    expect(autoFootprintRow([bar(0, 100, 112, 100, 110)])).toBe(2);
  });
  it('ekrana göre satır: hücre ≈ 16 px', () => {
    expect(footprintRowForView([bar(0, 100, 120, 100, 110)], 640)).toBe(0.5);
  });
  it('çapraz dengesizlik', () => {
    const im = imbalances([[10, 5, 1], [11, 9, 6], [12, 1, 8]], 3);
    expect(im.buy).toEqual([false, true, false]);
    expect(im.sell).toEqual([false, true, false]);
  });
});

import { niceAtr, styleTag, wilderAtr } from '../chartTypes';
import { niceFloor } from '../profile';
import { letterColor } from '../profilePrimitives';
describe('Grafik tipi değerleri', () => {
  it('ATR kutusu güzel sayıya yuvarlanır ve lejant etiketi standart biçimde', () => {
    const c = closes([100, 103, 99, 104, 98, 105, 97, 106, 96, 107, 95, 108, 94, 109, 93]);
    const box = niceAtr(c, 14);
    expect([1, 2, 2.5, 5, 10, 20, 25]).toContain(box);
    expect(styleTag('kagi', c)).toBe(`Kagi [ATR(14), ${box}]`);
    expect(styleTag('pnf', c)).toBe(`PnF [ATR(14), ${box}, 3]`);
    expect(styleTag('candles', c)).toBe('');
  });
  it('niceFloor ATR kutusu: 3023 → 2500, 2805 → 2500, 0.37 → 0.25', () => {
    expect(niceFloor(3023)).toBe(2500);
    expect(niceFloor(2805)).toBe(2500);
    expect(niceFloor(0.37)).toBe(0.25);
    expect(niceFloor(7)).toBe(5);
  });
  it('Wilder ATR sabit aralıkta aralığa eşit', () => {
    expect(wilderAtr(Array.from({ length: 30 }, (_, i) => ({ time: i, open: 10, high: 11, low: 9, close: 10, volume: 1 })), 14)).toBeCloseTo(2);
  });
  it('TPO harf gradyanı standart renk duraklarıyla başlar ve biter', () => {
    expect(letterColor(0, 10)).toBe('rgb(233, 30, 99)');
    expect(letterColor(9, 10)).toBe('rgb(101, 31, 255)');
  });
});
