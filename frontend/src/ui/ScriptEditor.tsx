/**
 * Betik editörü: Monaco tabanlı — renklendirme, tamamlama, imza yardımı, hover dokümanı,
 * hata işaretleri (sözdizimi/derleme anında, çalışma hatası son çalıştırmadan), ⌘S kaydet, ⌘↵ uygula.
 * Monaco yüklenemezse (test ortamı / eski tarayıcı) düz textarea'ya düşer.
 */
import { createEffect, createSignal, on, onCleanup, onMount, type JSX } from 'solid-js';
import { diagnose, type Diagnostic } from '../script/editor/intel';
import { SCRIPT_LANG_ID, SCRIPT_THEME_DARK, SCRIPT_THEME_LIGHT } from '../script/editor/monacoLanguage';
import { applyScriptToChart, scriptMain, setUi, ui } from '../state/store';
import { saveCurrent } from '../state/userScripts';
import { theme } from '../state/theme';
import '../styles/scriptEditor.css';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Editor = any;

const [diagnostics, setDiagnostics] = createSignal<Diagnostic[]>([]);
export { diagnostics };

/** Editörde belirtilen satıra gider (hata listesi / referans tıklaması). */
let revealLine: ((line: number, column?: number) => void) | null = null;
export function goToLine(line: number, column = 1): void {
  revealLine?.(line, column);
}

/** İmlece metin ekler (referans panelinden "ekle"). */
let insertAtCursor: ((text: string) => void) | null = null;
export function insertText(text: string): void {
  if (insertAtCursor) insertAtCursor(text);
  else setUi('scriptCode', ui.scriptCode + text);
}

export function ScriptEditor(): JSX.Element {
  let host!: HTMLDivElement;
  const [ready, setReady] = createSignal(false);
  let editor: Editor | null = null;
  let monacoNs: any = null;
  let decorations: any = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  // Tanılama: yazarken 300 ms sonra (mum gerekmez); çalışma hatası son çalıştırmadan
  createEffect(
    on([() => ui.scriptCode, () => scriptMain()?.error, () => scriptMain()?.ok], ([code, err, ok]) => {
      clearTimeout(timer);
      timer = setTimeout(() => setDiagnostics(diagnose(code, ok === false ? err : null)), 300);
    })
  );
  onCleanup(() => clearTimeout(timer));

  // Tanılamaları Monaco işaretlerine + satır vurgusuna yansıt
  createEffect(() => {
    const ds = diagnostics();
    if (!ready() || !editor || !monacoNs) return;
    const model = editor.getModel();
    monacoNs.editor.setModelMarkers(
      model,
      'script',
      ds.map((d) => ({
        startLineNumber: d.line,
        endLineNumber: d.line,
        startColumn: d.column,
        endColumn: d.endColumn,
        message: d.message,
        severity: d.severity === 'error' ? monacoNs.MarkerSeverity.Error : monacoNs.MarkerSeverity.Warning,
        source: d.source,
      }))
    );
    decorations?.set(
      ds.map((d) => ({
        range: new monacoNs.Range(d.line, 1, d.line, 1),
        options: { isWholeLine: true, className: 'script-err-line', glyphMarginClassName: 'script-err-glyph', glyphMarginHoverMessage: { value: d.message } },
      }))
    );
  });

  // Dışarıdan kod değişimi (şablon, aç, sürüm geri yükle) → editöre (geri al yığını korunur)
  createEffect(() => {
    const code = ui.scriptCode;
    if (!ready() || !editor) return;
    if (editor.getValue() === code) return;
    const model = editor.getModel();
    editor.pushUndoStop();
    model.pushEditOperations([], [{ range: model.getFullModelRange(), text: code }], () => null);
    editor.pushUndoStop();
  });

  createEffect(() => {
    const t = theme();
    if (ready() && monacoNs) monacoNs.editor.setTheme(t === 'light' ? SCRIPT_THEME_LIGHT : SCRIPT_THEME_DARK);
  });

  onMount(() => {
    if (import.meta.env.MODE === 'test' || typeof window === 'undefined') return;
    void import('./scriptMonaco')
      .then(({ monaco }) => {
        if (!host) return;
        monacoNs = monaco;
        editor = monaco.editor.create(host, {
          value: ui.scriptCode,
          language: SCRIPT_LANG_ID,
          theme: theme() === 'light' ? SCRIPT_THEME_LIGHT : SCRIPT_THEME_DARK,
          automaticLayout: true,
          fontFamily: "'JetBrains Mono', 'SF Mono', Menlo, monospace",
          fontSize: 13,
          tabSize: 4,
          insertSpaces: true,
          minimap: { enabled: false },
          glyphMargin: true,
          scrollBeyondLastLine: false,
          renderLineHighlight: 'all',
          fixedOverflowWidgets: true,
          suggest: { showWords: false },
          quickSuggestions: { other: true, comments: false, strings: false },
          parameterHints: { enabled: true },
          bracketPairColorization: { enabled: true },
        });
        decorations = editor.createDecorationsCollection([]);
        editor.onDidChangeModelContent(() => {
          const v = editor.getValue();
          if (v !== ui.scriptCode) setUi('scriptCode', v);
        });
        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => void saveCurrent());
        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => applyScriptToChart());
        revealLine = (line, column = 1) => {
          editor.revealLineInCenter(line);
          editor.setPosition({ lineNumber: line, column });
          editor.focus();
        };
        insertAtCursor = (text) => {
          const sel = editor.getSelection();
          editor.executeEdits('script-ref', [{ range: sel, text, forceMoveMarkers: true }]);
          editor.focus();
        };
        setReady(true);
      })
      .catch(() => {
        // Monaco yüklenemedi → textarea kalır
      });
  });

  onCleanup(() => {
    revealLine = null;
    insertAtCursor = null;
    editor?.dispose();
    editor = null;
  });

  const onKey = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      void saveCurrent();
    } else if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      applyScriptToChart();
    }
  };

  return (
    <div class="script-code-host" data-editor={ready() ? 'monaco' : 'textarea'}>
      <textarea
        id="txt-script-code"
        class="script-textarea"
        style={{ display: ready() ? 'none' : undefined }}
        spellcheck={false}
        value={ui.scriptCode}
        onInput={(e) => setUi('scriptCode', e.currentTarget.value)}
        onKeyDown={onKey}
      />
      <div ref={host} id="script-monaco" class="script-monaco" style={{ display: ready() ? undefined : 'none' }} />
    </div>
  );
}
