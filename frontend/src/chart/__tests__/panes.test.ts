import { describe, expect, it } from 'vitest';
import {
  MAXIMIZED_OTHERS,
  MAXIMIZED_SELF,
  compareScaleId,
  defaultStretch,
  dropPane,
  lockedPriceRange,
  maximizedStretch,
  movePane,
  reconcileOrder,
  scaleIdFor,
  type PaneId,
} from '../panes';

describe('pane sırası', () => {
  it('main her zaman ilk; yeni paneller sona; pasifler düşer', () => {
    expect(reconcileOrder(['main', 'rsi', 'macd', 'script'], ['main', 'macd', 'script'])).toEqual(['main', 'macd', 'script']);
    expect(reconcileOrder(['script', 'rsi'], ['rsi', 'main', 'script'])).toEqual(['main', 'script', 'rsi']);
    expect(reconcileOrder([], ['main', 'macd'])).toEqual(['main', 'macd']);
    expect(reconcileOrder(['main'], ['rsi'])).toEqual(['rsi']);
  });

  it('movePane bir adım taşır; main sabit; sınırda değişmez', () => {
    const o: PaneId[] = ['main', 'rsi', 'macd', 'script'];
    expect(movePane(o, 'macd', -1)).toEqual(['main', 'macd', 'rsi', 'script']);
    expect(movePane(o, 'rsi', 1)).toEqual(['main', 'macd', 'rsi', 'script']);
    expect(movePane(o, 'rsi', -1)).toBe(o); // main'in üstüne çıkamaz
    expect(movePane(o, 'script', 1)).toBe(o);
    expect(movePane(o, 'main', 1)).toBe(o);
  });

  it('dropPane hedef panenin yerine koyar; main\'in üstüne bırakılamaz', () => {
    const o: PaneId[] = ['main', 'rsi', 'macd', 'script'];
    expect(dropPane(o, 'script', 'rsi')).toEqual(['main', 'script', 'rsi', 'macd']);
    expect(dropPane(o, 'rsi', 'script')).toEqual(['main', 'macd', 'script', 'rsi']);
    expect(dropPane(o, 'macd', 'main')).toEqual(['main', 'macd', 'rsi', 'script']);
    expect(dropPane(o, 'main', 'rsi')).toBe(o);
    expect(dropPane(o, 'rsi', 'rsi')).toBe(o);
  });
});

describe('büyütme', () => {
  it('seçili pane tüm alanı alır, diğerleri ~0; seçim yoksa null', () => {
    const m = maximizedStretch(['main', 'rsi'], 'rsi')!;
    expect(m.get('rsi')).toBe(MAXIMIZED_SELF);
    expect(m.get('main')).toBe(MAXIMIZED_OTHERS);
    expect(maximizedStretch(['main', 'rsi'], null)).toBeNull();
    expect(maximizedStretch(['main', 'rsi'], 'script')).toBeNull();
    expect(defaultStretch('main')).toBeGreaterThan(defaultStretch('rsi'));
  });
});

describe('ölçek kilidi (fiyat/bar oranı)', () => {
  const ratio = { b0: 10, span0: 100 };
  it('bar aralığı aynıysa fiyat aralığı değişmez, merkez korunur', () => {
    expect(lockedPriceRange(ratio, 10, 150)).toEqual({ from: 100, to: 200 });
  });
  it('yakınlaşınca (bar aralığı 2x) fiyat aralığı yarıya iner; uzaklaşınca iki katına çıkar', () => {
    expect(lockedPriceRange(ratio, 20, 150)).toEqual({ from: 125, to: 175 });
    expect(lockedPriceRange(ratio, 5, 150)).toEqual({ from: 50, to: 250 });
  });
  it('geçersiz girdi → null', () => {
    expect(lockedPriceRange(ratio, 0, 150)).toBeNull();
    expect(lockedPriceRange({ b0: 0, span0: 100 }, 10, 150)).toBeNull();
    expect(lockedPriceRange(ratio, 10, NaN)).toBeNull();
  });
});

describe('ölçek tarafları', () => {
  it('sağ/sol/split ve karşılaştırma kimlikleri', () => {
    expect(scaleIdFor('right', 3)).toBe('right');
    expect(scaleIdFor('left', 0)).toBe('left');
    expect(scaleIdFor('split', 0)).toBe('right');
    expect(scaleIdFor('split', 2)).toBe('left');
    expect(compareScaleId('same')).toBe('right');
    expect(compareScaleId('left')).toBe('left');
    expect(compareScaleId('own')).toBe('cmp-own');
  });
});
