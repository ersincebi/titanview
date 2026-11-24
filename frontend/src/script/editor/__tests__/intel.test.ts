import { describe, expect, it } from 'vitest';
import { completionsAt, diagnose, hoverAt, offsetAt, scanUserSymbols, signatureAt, splitLocation, wordAt } from '../intel';
import { SCRIPT_REFERENCE, lookupRef, namespaceMembers, rootNamespaces, searchRef } from '../reference';

const at = (code: string) => code.indexOf('|');
const strip = (code: string) => code.replace('|', '');

describe('reference', () => {
  it('parses every row and has core entries', () => {
    expect(SCRIPT_REFERENCE.length).toBeGreaterThan(350);
    expect(lookupRef('ta.sma')!.signature).toBe('ta.sma(source, length) → series float');
    expect(lookupRef('ta.vwap')!.kind).toBe('function');
    expect(lookupRef('close')!.kind).toBe('variable');
    expect(lookupRef('color.red')!.kind).toBe('constant');
    expect(lookupRef('array.new')!.signature).toContain('array.new<type>(size?, initial_value?)');
  });
  it('namespaces and search', () => {
    expect(rootNamespaces()).toEqual(expect.arrayContaining(['ta', 'math', 'str', 'request', 'strategy', 'chart', 'log']));
    const chart = namespaceMembers('chart');
    expect(chart.map((m) => m.label)).toEqual(['point']);
    expect(namespaceMembers('chart.point').map((m) => m.label)).toContain('from_index');
    expect(searchRef('rsi')[0].name).toBe('ta.rsi');
    expect(searchRef('Bollinger').some((e) => e.name === 'ta.bb')).toBe(true);
    expect(searchRef('').length).toBeGreaterThan(100);
  });
});

describe('intel', () => {
  const src = `//@version=6
indicator("T")
type Point
    float x
    float y = 1
enum Side
    long = "Uzun"
    short
f(a, b = 2) => a + b
var p = Point.new(1, 2)
[m, s, h] = ta.macd(close, 12, 26, 9)
len = input.int(14, "Uz")
plot(ta.sma(close, len))`;

  it('scans user symbols', () => {
    const s = scanUserSymbols(src);
    expect(s.types.get('Point')!.fields).toEqual(['x', 'y']);
    expect(s.enums.get('Side')!.members).toEqual(['long', 'short']);
    expect(s.functions.get('f')!.params).toEqual(['a', 'b']);
    expect([...s.variables.keys()]).toEqual(expect.arrayContaining(['p', 'm', 's', 'h', 'len']));
  });

  it('completes namespace members, UDT, enum, fields and globals', () => {
    const c1 = completionsAt('x = ta.', 7).map((c) => c.label);
    expect(c1).toEqual(expect.arrayContaining(['sma', 'ema', 'rsi', 'obv']));
    const c2 = strip(src + '\nq = Point.|');
    expect(completionsAt(c2, c2.length).map((c) => c.label)).toEqual(expect.arrayContaining(['new', 'copy']));
    const c3 = src + '\nq = Side.';
    expect(completionsAt(c3, c3.length).map((c) => c.label)).toEqual(['long', 'short']);
    const c4 = src + '\nq = p.';
    expect(completionsAt(c4, c4.length).map((c) => c.label)).toEqual(expect.arrayContaining(['x', 'y']));
    const g = completionsAt(src + '\n', src.length + 1);
    const sma = g.find((c) => c.label === 'plot')!;
    expect(sma.snippet).toBe(true);
    expect(sma.insertText).toBe('plot($0)');
    expect(g.map((c) => c.label)).toEqual(expect.arrayContaining(['f', 'len', 'Point', 'var', 'ta', 'close']));
    expect(completionsAt('// ta.', 6)).toEqual([]);
    expect(completionsAt('s = "ta.', 8)).toEqual([]);
  });

  it('signature help with active param and named args', () => {
    const a = 'x = ta.sma(close, |';
    const s = signatureAt(strip(a), at(a))!;
    expect(s.name).toBe('ta.sma');
    expect(s.activeParam).toBe(1);
    const b = 'plot(ta.sma(close, 3), color=|';
    const s2 = signatureAt(strip(b), at(b))!;
    expect(s2.name).toBe('plot');
    expect(s2.params[s2.activeParam]).toBe('color?');
    const c = 'x = f(1, |';
    expect(signatureAt(src + '\n' + strip(c), src.length + 1 + at(c))!.label).toBe('f(a, b)');
    expect(signatureAt('x = close', 9)).toBeNull();
    const d = 'label.new(bar_index, high, "a, (b", |';
    expect(signatureAt(strip(d), at(d))!.activeParam).toBe(3);
  });

  it('hover docs for builtins, namespaces and user symbols', () => {
    const code = 'plot(ta.sma(close, 14))';
    expect(hoverAt(code, code.indexOf('sma') + 1)!.markdown).toContain('Basit hareketli ortalama');
    expect(hoverAt(code, code.indexOf('ta.') + 1)!.markdown).toContain('isim alanı');
    expect(hoverAt(code, code.indexOf('close') + 2)!.markdown).toContain('kapanış');
    expect(hoverAt(src, src.lastIndexOf('len') + 1)!.markdown).toContain('input.int');
    expect(hoverAt(src, src.indexOf('Point') + 1)!.markdown).toContain('`x`');
    expect(hoverAt(src, src.indexOf('Side') + 1)!.markdown).toContain('`long`');
    expect(hoverAt(src, src.indexOf('f(a') + 0)!.markdown).toContain('kullanıcı fonksiyonu');
    expect(hoverAt('  ', 1)).toBeNull();
  });

  it('diagnoses syntax, compile and runtime errors with positions', () => {
    expect(diagnose(src)).toEqual([]);
    const bad = '//@version=6\nindicator("x")\nplot(close +)';
    const d = diagnose(bad);
    expect(d).toHaveLength(1);
    expect(d[0].source).toBe('syntax');
    expect(d[0].line).toBe(3);
    const ce = diagnose('//@version=6\nindicator("t")\ntype Item\n    float price = 1.0\nx = Item.new()\nplot(x.nope)');
    expect(ce[0]?.source).toBe('compile');
    expect(ce[0].line).toBe(6);
    const rt = diagnose('//@version=6\nindicator("x")\nplot(close)', 'Satır 3: patladı');
    expect(rt[0]).toMatchObject({ line: 3, source: 'runtime', message: 'patladı' });
    expect(diagnose('')).toEqual([]);
  });

  it('helpers', () => {
    expect(offsetAt('ab\ncd', 2, 2)).toBe(4);
    expect(offsetAt('ab', 5, 1)).toBe(2);
    expect(wordAt('x = ta.sma(', 8)).toMatchObject({ word: 'ta.sma' });
    expect(wordAt('  ', 1)).toBeNull();
    expect(splitLocation('Satır 4, Sütun 7: hata')).toEqual({ line: 4, column: 7, text: 'hata' });
    expect(splitLocation('hata')).toBeNull();
  });
});
