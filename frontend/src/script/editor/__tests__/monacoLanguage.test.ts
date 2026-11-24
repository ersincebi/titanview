import { describe, expect, it } from 'vitest';
import { LANG_EXT, LANG_ID, LANG_NAME } from '../../brand';
import { SCRIPT_LANG_CONFIG, SCRIPT_MONARCH, SCRIPT_THEME_DARK, SCRIPT_THEME_LIGHT, _resetScriptLanguage, registerScriptLanguage } from '../monacoLanguage';

function fakeMonaco() {
  const calls: Record<string, any[]> = {};
  const rec = (k: string) => (...a: any[]) => { (calls[k] ??= []).push(a); };
  const monaco = {
    languages: {
      register: rec('register'),
      setMonarchTokensProvider: rec('monarch'),
      setLanguageConfiguration: rec('config'),
      registerCompletionItemProvider: rec('completion'),
      registerSignatureHelpProvider: rec('signature'),
      registerHoverProvider: rec('hover'),
      CompletionItemKind: { Function: 1, Variable: 2, Constant: 3, Keyword: 4, Class: 5, Field: 6, EnumMember: 7, Module: 8 },
      CompletionItemInsertTextRule: { InsertAsSnippet: 4 },
    },
    editor: { defineTheme: rec('theme') },
  };
  return { monaco, calls };
}

function model(code: string) {
  return {
    getValue: () => code,
    getOffsetAt: (p: { lineNumber: number; column: number }) => {
      const lines = code.split('\n');
      let o = 0;
      for (let i = 0; i < p.lineNumber - 1; i++) o += lines[i].length + 1;
      return o + p.column - 1;
    },
    getPositionAt: (off: number) => {
      const before = code.slice(0, off).split('\n');
      return { lineNumber: before.length, column: before[before.length - 1].length + 1 };
    },
    getWordUntilPosition: (p: { column: number }) => ({ startColumn: p.column, endColumn: p.column }),
  };
}

describe('monaco script language', () => {
  it('registers once with providers that delegate to intel', () => {
    _resetScriptLanguage();
    const { monaco, calls } = fakeMonaco();
    registerScriptLanguage(monaco);
    registerScriptLanguage(monaco);
    expect(calls.register).toHaveLength(1);
    expect(calls.register[0][0]).toEqual({ id: LANG_ID, extensions: [LANG_EXT], aliases: [LANG_NAME, LANG_ID] });
    expect(calls.theme.map((c) => c[0])).toEqual([SCRIPT_THEME_DARK, SCRIPT_THEME_LIGHT]);

    const code = 'x = ta.';
    const comp = calls.completion[0][1].provideCompletionItems(model(code), { lineNumber: 1, column: 8 });
    const sma = comp.suggestions.find((s: any) => s.label === 'sma');
    expect(sma).toMatchObject({ kind: 1, insertText: 'sma($0)', insertTextRules: 4 });
    expect(sma.command.id).toBe('editor.action.triggerParameterHints');

    const code2 = 'f(a) => a\ny = ';
    const comp2 = calls.completion[0][1].provideCompletionItems(model(code2), { lineNumber: 2, column: 5 });
    const f = comp2.suggestions.find((s: any) => s.label === 'f');
    expect(f.sortText.startsWith('0')).toBe(true);
    expect(comp2.suggestions.find((s: any) => s.label === 'var').kind).toBe(4);

    const sig = calls.signature[0][1].provideSignatureHelp(model('ta.ema(close, '), { lineNumber: 1, column: 15 });
    expect(sig.value.activeParameter).toBe(1);
    expect(sig.value.signatures[0].label).toContain('ta.ema');
    expect(calls.signature[0][1].provideSignatureHelp(model('close'), { lineNumber: 1, column: 3 })).toBeNull();

    const hov = calls.hover[0][1].provideHover(model('plot(close)'), { lineNumber: 1, column: 8 });
    expect(hov.contents[0].value).toContain('kapanış');
    expect(hov.range).toEqual({ startLineNumber: 1, startColumn: 6, endLineNumber: 1, endColumn: 11 });
    expect(calls.hover[0][1].provideHover(model('   '), { lineNumber: 1, column: 2 })).toBeNull();
  });

  it('monarch / config regexes are valid and match TitanScript constructs', () => {
    const rules = SCRIPT_MONARCH.tokenizer.root.map((r) => r[0] as RegExp);
    const matches = (s: string) => rules.findIndex((re) => new RegExp('^(?:' + re.source + ')').test(s));
    expect(matches('//@version=6')).toBe(0);
    expect(matches('// yorum')).toBe(2);
    expect(matches('#ff0000')).toBe(3);
    expect(matches('3.14')).toBe(5);
    expect(SCRIPT_MONARCH.namespaces).toContain('ta');
    // Monarch `@ad` dizgisini öznitelik başvurusu sayar: regex içinde çıplak @harf olmamalı
    for (const re of rules) expect(re.source).not.toMatch(/(?<!\[)@[a-z]/);
    const rule = SCRIPT_LANG_CONFIG.onEnterRules[0].beforeText;
    expect(rule.test('if close > open')).toBe(true);
    expect(rule.test('f(x) =>')).toBe(true);
    expect(rule.test('plot(close)')).toBe(false);
  });
});
