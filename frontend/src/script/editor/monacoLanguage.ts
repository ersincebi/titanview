/**
 * Monaco için TitanScript dili: Monarch renklendirme, dil yapılandırması, tema ve
 * tamamlama / imza / hover sağlayıcıları. Monaco nesnesi parametre olarak gelir
 * (bu dosya monaco'yu import etmez → testte sahte nesneyle denenebilir).
 */
import { LANG_EXT, LANG_ID, LANG_NAME } from '../brand';
import { SCRIPT_KEYWORDS, SCRIPT_TYPES, rootNamespaces } from './reference';
import { completionsAt, hoverAt, signatureAt, type CompletionKind } from './intel';

export const SCRIPT_LANG_ID = LANG_ID;
export const SCRIPT_THEME_DARK = `${LANG_ID}-dark`;
export const SCRIPT_THEME_LIGHT = `${LANG_ID}-light`;

/* eslint-disable @typescript-eslint/no-explicit-any */
type Monaco = any;

export const SCRIPT_MONARCH = {
  defaultToken: '',
  keywords: SCRIPT_KEYWORDS.filter((k) => !['true', 'false', 'and', 'or', 'not'].includes(k)),
  operatorsWords: ['and', 'or', 'not'],
  typeKeywords: SCRIPT_TYPES.filter((t) => !t.includes('.')),
  namespaces: rootNamespaces(),
  builtinVars: ['open', 'high', 'low', 'close', 'volume', 'hl2', 'hlc3', 'ohlc4', 'hlcc4', 'time', 'time_close', 'timenow', 'bar_index', 'last_bar_index', 'na'],
  tokenizer: {
    root: [
      [/\/\/\s*[@]version=\d+/, 'annotation'],
      [/\/\/\s*[@](?:description|function|param|returns|type|field|enum|variable|strategy_alert_message)\b.*$/, 'annotation'],
      [/\/\/.*$/, 'comment'],
      [/#[0-9a-fA-F]{8}\b|#[0-9a-fA-F]{6}\b/, 'number.hex'],
      [/\b(true|false)\b/, 'constant'],
      [/\d+\.\d*(?:[eE][-+]?\d+)?|\.\d+(?:[eE][-+]?\d+)?|\d+(?:[eE][-+]?\d+)?/, 'number'],
      [/"/, { token: 'string.quote', next: '@dstring' }],
      [/'/, { token: 'string.quote', next: '@sstring' }],
      [/([a-zA-Z_]\w*)(\s*)(\()/, [{ cases: { '@keywords': 'keyword', '@typeKeywords': 'type', '@default': 'function' } }, '', 'delimiter.parenthesis']],
      [/[a-zA-Z_]\w*(?=\.)/, { cases: { '@namespaces': 'namespace', '@default': 'identifier' } }],
      [
        /[a-zA-Z_]\w*/,
        {
          cases: {
            '@keywords': 'keyword',
            '@operatorsWords': 'keyword.operator',
            '@typeKeywords': 'type',
            '@builtinVars': 'variable.predefined',
            '@default': 'identifier',
          },
        },
      ],
      [/:=|=>|==|!=|<=|>=|\+=|-=|\*=|\/=|%=|[-+*/%<>=?:]/, 'operator'],
      [/[()[\]{}]/, '@brackets'],
      [/[,.]/, 'delimiter'],
    ],
    dstring: [
      [/[^\\"]+/, 'string'],
      [/\\./, 'string.escape'],
      [/"/, { token: 'string.quote', next: '@pop' }],
    ],
    sstring: [
      [/[^\\']+/, 'string'],
      [/\\./, 'string.escape'],
      [/'/, { token: 'string.quote', next: '@pop' }],
    ],
  },
};

export const SCRIPT_LANG_CONFIG = {
  comments: { lineComment: '//' },
  brackets: [['(', ')'], ['[', ']'], ['{', '}']],
  autoClosingPairs: [
    { open: '(', close: ')' },
    { open: '[', close: ']' },
    { open: '{', close: '}' },
    { open: '"', close: '"', notIn: ['string', 'comment'] },
    { open: "'", close: "'", notIn: ['string', 'comment'] },
  ],
  surroundingPairs: [{ open: '(', close: ')' }, { open: '[', close: ']' }, { open: '"', close: '"' }, { open: "'", close: "'" }],
  // `if`, `for`, `=>` vb. satır sonunda Enter → 4 boşluk girinti (bloklar girintiyle)
  onEnterRules: [
    {
      beforeText: /^\s*(?:if|else|for|while|switch|type|enum)\b.*$|=>\s*$|^\s*(?:export\s+)?(?:method\s+)?\w+\s*\(.*\)\s*=>\s*$/,
      action: { indentAction: 1 /* Indent */ },
    },
  ],
  indentationRules: {
    increaseIndentPattern: /^\s*(?:if|else|for|while|switch|type|enum)\b.*$|=>\s*$/,
    decreaseIndentPattern: /^\s*else\b/,
  },
  wordPattern: /[a-zA-Z_]\w*/,
};

/** TitanView koyu/açık kod editörü temaları. */
export const SCRIPT_THEMES = {
  dark: {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'keyword', foreground: 'f06292' },
      { token: 'keyword.operator', foreground: 'f06292' },
      { token: 'type', foreground: '4dd0e1' },
      { token: 'function', foreground: '64b5f6' },
      { token: 'namespace', foreground: '81c784' },
      { token: 'variable.predefined', foreground: 'ce93d8' },
      { token: 'number', foreground: 'ffb74d' },
      { token: 'number.hex', foreground: 'ffb74d' },
      { token: 'constant', foreground: 'ffb74d' },
      { token: 'string', foreground: 'a5d6a7' },
      { token: 'string.quote', foreground: 'a5d6a7' },
      { token: 'comment', foreground: '6a737d', fontStyle: 'italic' },
      { token: 'annotation', foreground: '9e9e9e', fontStyle: 'bold' },
    ],
    colors: {
      'editor.background': '#0b0e14',
      'editor.lineHighlightBackground': '#181f2e',
      'editorLineNumber.foreground': '#4f5d75',
      'editorGutter.background': '#0b0e14',
    },
  },
  light: {
    base: 'vs',
    inherit: true,
    rules: [
      { token: 'keyword', foreground: 'c2185b' },
      { token: 'keyword.operator', foreground: 'c2185b' },
      { token: 'type', foreground: '00838f' },
      { token: 'function', foreground: '1565c0' },
      { token: 'namespace', foreground: '2e7d32' },
      { token: 'variable.predefined', foreground: '7b1fa2' },
      { token: 'number', foreground: 'e65100' },
      { token: 'number.hex', foreground: 'e65100' },
      { token: 'constant', foreground: 'e65100' },
      { token: 'string', foreground: '388e3c' },
      { token: 'string.quote', foreground: '388e3c' },
      { token: 'comment', foreground: '9e9e9e', fontStyle: 'italic' },
      { token: 'annotation', foreground: '757575', fontStyle: 'bold' },
    ],
    colors: { 'editor.background': '#ffffff' },
  },
};

function kindOf(monaco: Monaco, k: CompletionKind): number {
  const K = monaco.languages.CompletionItemKind;
  switch (k) {
    case 'function':
    case 'user-function':
      return K.Function;
    case 'variable':
    case 'user-variable':
      return K.Variable;
    case 'constant':
      return K.Constant;
    case 'keyword':
      return K.Keyword;
    case 'type':
    case 'user-type':
      return K.Class;
    case 'field':
      return K.Field;
    case 'enumMember':
      return K.EnumMember;
    default:
      return K.Module;
  }
}

let registered = false;

/** Dili, temaları ve sağlayıcıları bir kez kaydeder. */
export function registerScriptLanguage(monaco: Monaco): void {
  if (registered) return;
  registered = true;
  monaco.languages.register({ id: SCRIPT_LANG_ID, extensions: [LANG_EXT], aliases: [LANG_NAME, LANG_ID] });
  monaco.languages.setMonarchTokensProvider(SCRIPT_LANG_ID, SCRIPT_MONARCH);
  monaco.languages.setLanguageConfiguration(SCRIPT_LANG_ID, SCRIPT_LANG_CONFIG);
  monaco.editor.defineTheme(SCRIPT_THEME_DARK, SCRIPT_THEMES.dark);
  monaco.editor.defineTheme(SCRIPT_THEME_LIGHT, SCRIPT_THEMES.light);

  monaco.languages.registerCompletionItemProvider(SCRIPT_LANG_ID, {
    triggerCharacters: ['.'],
    provideCompletionItems(model: any, position: any) {
      const code = model.getValue();
      const offset = model.getOffsetAt(position);
      const word = model.getWordUntilPosition(position);
      const range = { startLineNumber: position.lineNumber, endLineNumber: position.lineNumber, startColumn: word.startColumn, endColumn: word.endColumn };
      const suggestions = completionsAt(code, offset).map((c, i) => ({
        label: c.label,
        kind: kindOf(monaco, c.kind),
        detail: c.detail,
        documentation: c.doc ? { value: c.doc } : undefined,
        insertText: c.insertText,
        insertTextRules: c.snippet ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet : undefined,
        // kullanıcı sembolleri önce
        sortText: (c.kind.startsWith('user-') ? '0' : '1') + String(i).padStart(4, '0'),
        command: c.snippet ? { id: 'editor.action.triggerParameterHints', title: '' } : undefined,
        range,
      }));
      return { suggestions };
    },
  });

  monaco.languages.registerSignatureHelpProvider(SCRIPT_LANG_ID, {
    signatureHelpTriggerCharacters: ['(', ','],
    signatureHelpRetriggerCharacters: [',', '='],
    provideSignatureHelp(model: any, position: any) {
      const sig = signatureAt(model.getValue(), model.getOffsetAt(position));
      if (!sig) return null;
      return {
        value: {
          signatures: [
            {
              label: sig.label,
              documentation: { value: sig.doc },
              parameters: sig.params.map((p) => ({ label: p })),
            },
          ],
          activeSignature: 0,
          activeParameter: sig.activeParam,
        },
        dispose() {},
      };
    },
  });

  monaco.languages.registerHoverProvider(SCRIPT_LANG_ID, {
    provideHover(model: any, position: any) {
      const h = hoverAt(model.getValue(), model.getOffsetAt(position));
      if (!h) return null;
      const s = model.getPositionAt(h.start);
      const e = model.getPositionAt(h.end);
      return {
        range: { startLineNumber: s.lineNumber, startColumn: s.column, endLineNumber: e.lineNumber, endColumn: e.column },
        contents: [{ value: h.markdown }],
      };
    },
  });
}

/** Test yardımcısı. */
export function _resetScriptLanguage(): void {
  registered = false;
}
