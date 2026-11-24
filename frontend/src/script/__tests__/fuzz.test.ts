import { describe, expect, it } from 'vitest';
import type { Candle } from '../../types/market';
import { tokenize } from '../lexer';
import { parse } from '../parser';
import { BUILTIN_SCRIPT_PRESETS } from '../presets';
import { executeScript } from '../runtime';

/**
 * Dayanıklılık: bozuk / mutasyona uğramış kaynak ne olursa olsun yorumlayıcı ASLA fırlatmaz ve
 * asılmaz; ya ok:true ya da açıklayıcı bir `error` döner. "Beklenmeyen hata" = yorumlayıcı hatası.
 */
let seed = 20260611;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const pick = <T,>(a: T[]): T => a[Math.floor(rnd() * a.length)];

const candles: Candle[] = Array.from({ length: 60 }, (_, i) => {
  const p = 100 + Math.sin(i / 4) * 8;
  return { time: 1_700_000_000 + i * 3600, open: p - 0.5, high: p + 1, low: p - 1, close: p, volume: 100 + i };
});

const SNIPPETS = ['(', ')', '[', ']', '{', '}', ',', '=', '==', '=>', '?', ':', '"', "'", '\n', '\n    ', '//', '/*', '*/', '#', '.', '..', '-', '+', '*', '/', '%', 'if', 'else', 'for', 'to', 'while', 'switch', 'var', 'na', 'true', 'ta.', 'math.', 'strategy.', '0', '1e999', '-0', '99999999999', 'close', 'bar_index', 'plot(', 'array.new_float(', 'request.security('];

function mutate(src: string): string {
  let s = src;
  const rounds = 1 + Math.floor(rnd() * 4);
  for (let r = 0; r < rounds; r++) {
    const i = Math.floor(rnd() * (s.length + 1));
    switch (Math.floor(rnd() * 5)) {
      case 0:
        s = s.slice(0, i) + pick(SNIPPETS) + s.slice(i);
        break;
      case 1:
        s = s.slice(0, i) + s.slice(i + 1 + Math.floor(rnd() * 8));
        break;
      case 2: {
        const j = Math.floor(rnd() * s.length);
        const len = Math.floor(rnd() * 40);
        s = s.slice(0, i) + s.slice(j, j + len) + s.slice(i);
        break;
      }
      case 3:
        s = s.slice(0, i); // kesik dosya
        break;
      default:
        s = s.slice(0, i) + String.fromCharCode(Math.floor(rnd() * 0x250)) + s.slice(i);
    }
  }
  return s;
}

describe('script robustness fuzz', () => {
  it('mutated presets: never throws, never an internal error', () => {
    const corpus = BUILTIN_SCRIPT_PRESETS.map((p) => p.code);
    const internal: string[] = [];
    let ok = 0;
    let rejected = 0;
    const N = 400;
    const t0 = performance.now();
    for (let i = 0; i < N; i++) {
      const src = mutate(pick(corpus));
      let res;
      try {
        res = executeScript(src, candles);
      } catch (e) {
        throw new Error(`executeScript threw for:\n${src}\n${String(e)}`);
      }
      if (res.ok) {
        ok++;
      } else {
        rejected++;
        expect(res.error, 'a rejected script must explain itself').toBeTruthy();
        if (res.error!.startsWith('Beklenmeyen hata')) internal.push(`${res.error}\n---\n${src.slice(0, 400)}`);
      }
    }
    expect(internal, internal.slice(0, 2).join('\n=====\n')).toEqual([]);
    expect(rejected).toBeGreaterThan(20); // mutasyonlar gerçekten bozuyor
    expect(ok).toBeGreaterThan(5); // ... ama hepsini değil
    expect(performance.now() - t0).toBeLessThan(60_000);
  }, 90_000);

  it('random token soup: lexer/parser only throw their own typed errors', () => {
    for (let i = 0; i < 1500; i++) {
      const n = 1 + Math.floor(rnd() * 25);
      const src = Array.from({ length: n }, () => pick(SNIPPETS) + (rnd() < 0.5 ? ' ' : '')).join('');
      try {
        parse(tokenize(src));
      } catch (e) {
        const name = (e as Error).constructor.name;
        expect(['ScriptParseError', 'ScriptRuntimeError', 'ScriptLexError'].includes(name) || /Script/.test(name), `untyped ${name}: ${(e as Error).message} <- ${JSON.stringify(src)}`).toBe(true);
      }
    }
  });

  it('runaway loops are cut by the op budget instead of freezing the tab', () => {
    const t0 = performance.now();
    const res = executeScript('//@version=5\nindicator("x")\nvar i = 0\nwhile true\n    i += 1\nplot(i)', candles);
    expect(res.ok).toBe(false);
    expect(res.error).toContain('işlem sınırı');
    expect(performance.now() - t0).toBeLessThan(15_000);
  }, 20_000);

  it('pathological inputs: empty, only comments, huge numbers, deep nesting', () => {
    for (const src of ['', '   \n\n', '//@version=5', '// only a comment', 'plot(1e999)', 'x = ' + '('.repeat(300) + '1' + ')'.repeat(300), '//@version=5\nindicator("n")\nplot(1/0)\nplot(-1/0)\nplot(0/0)']) {
      const res = executeScript(src, candles);
      expect(typeof res.ok).toBe('boolean');
      if (!res.ok) expect(res.error).toBeTruthy();
    }
  });
});
