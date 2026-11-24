/**
 * Monaco yükleyicisi — yalnızca dinamik import ile yüklenir (ayrı parça; ilk açılışı yavaşlatmaz).
 * Dil eklentisi olmayan çekirdek (`edcore.main`): tamamlama, hover, imza, bul/değiştir, katlama dahil.
 */
import * as monaco from 'monaco-editor/esm/vs/editor/edcore.main';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import { registerScriptLanguage } from '../script/editor/monacoLanguage';

(self as unknown as { MonacoEnvironment: unknown }).MonacoEnvironment = {
  getWorker: () => new EditorWorker(),
};

registerScriptLanguage(monaco);

export { monaco };
