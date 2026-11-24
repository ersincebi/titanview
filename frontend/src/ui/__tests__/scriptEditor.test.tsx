// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  scripts: new Map<string, { id: string; name: string; code: string; isOverlay: boolean; updatedAt: number }>(),
  versions: new Map<string, Array<{ scriptId: string; version: number; name: string; code: string; createdAt: number }>>(),
  seq: 0,
  fail: false,
}));

vi.mock('../../api/scripts', () => ({
  listScripts: vi.fn(async () => {
    if (db.fail) throw new Error('HTTP 500');
    return [...db.scripts.values()].sort((a, b) => b.updatedAt - a.updatedAt);
  }),
  saveScript: vi.fn(async (s: { id?: string; name: string; code: string; isOverlay: boolean }) => {
    if (db.fail) throw new Error('HTTP 500');
    const id = s.id ?? `script_${++db.seq}`;
    const item = { id, name: s.name, code: s.code, isOverlay: s.isOverlay, updatedAt: ++db.seq };
    db.scripts.set(id, item);
    const vs = db.versions.get(id) ?? [];
    if (vs[0]?.code !== s.code) vs.unshift({ scriptId: id, version: (vs[0]?.version ?? 0) + 1, name: s.name, code: s.code, createdAt: 1_700_000_000 + db.seq });
    db.versions.set(id, vs);
    return item;
  }),
  renameScript: vi.fn(async (id: string, name: string) => {
    const s = db.scripts.get(id);
    if (!s) throw new Error('script not found');
    s.name = name;
  }),
  deleteScript: vi.fn(async (id: string) => {
    db.scripts.delete(id);
    db.versions.delete(id);
  }),
  listVersions: vi.fn(async (id: string) => db.versions.get(id) ?? []),
}));

import { resetStore, setUi, ui } from '../../state/store';
import {
  _resetUserScripts,
  currentScript,
  isDirty,
  isOverlayCode,
  newScript,
  removeScript,
  renameScriptById,
  saveAs,
  saveCurrent,
  scriptTitleOf,
  scriptsError,
  setScriptDialog,
  refreshScripts,
} from '../../state/userScripts';
import { ScriptsDialog, lineDiffStats } from '../ScriptsDialog';
import { ScriptEditor, diagnostics, insertText } from '../ScriptEditor';

const CODE = '//@version=6\nindicator("Benim", overlay=true)\nplot(close)';
const $ = (s: string) => document.querySelector(s) as HTMLElement;
const $$ = (s: string) => [...document.querySelectorAll(s)] as HTMLElement[];

beforeEach(() => {
  resetStore();
  _resetUserScripts();
  db.scripts.clear();
  db.versions.clear();
  db.seq = 0;
  db.fail = false;
  setUi('scriptCode', CODE);
});
afterEach(() => cleanup());

describe('userScripts state', () => {
  it('title / overlay detection', () => {
    expect(scriptTitleOf(CODE)).toBe('Benim');
    expect(scriptTitleOf("strategy(title='S 1')")).toBe('S 1');
    expect(scriptTitleOf('library("Lib")')).toBe('Lib');
    expect(scriptTitleOf('plot(close)')).toBeNull();
    expect(isOverlayCode(CODE)).toBe(true);
    expect(isOverlayCode('indicator("x")')).toBe(false);
  });

  it('save → dirty tracking → save creates new version on same id; save-as forks', async () => {
    expect(isDirty()).toBe(false);
    expect(await saveCurrent()).toBe(true);
    expect(currentScript()).toEqual({ id: 'script_1', name: 'Benim' });
    expect(ui.scriptNote).toContain('kaydedildi');
    expect(isDirty()).toBe(false);
    setUi('scriptCode', CODE + '\nplot(open)');
    expect(isDirty()).toBe(true);
    await saveCurrent();
    expect(currentScript()!.id).toBe('script_1');
    expect(db.versions.get('script_1')!.map((v) => v.version)).toEqual([2, 1]);
    expect(isDirty()).toBe(false);
    // kalıcılık
    // kalıcılık (jsdom'da depolama yoksa userScripts sessizce geçer)
    const ls = (globalThis as { localStorage?: Storage }).localStorage;
    if (ls?.getItem) expect(JSON.parse(ls.getItem('titanview_script_current_v1')!)).toMatchObject({ id: 'script_1', name: 'Benim' });

    expect(await saveAs('  ')).toBe(false);
    expect(await saveAs('Kopya')).toBe(true);
    expect(currentScript()!.name).toBe('Kopya');
    expect(currentScript()!.id).not.toBe('script_1');
    expect(db.scripts.size).toBe(2);
  });

  it('save failure is reported honestly', async () => {
    db.fail = true;
    expect(await saveCurrent()).toBe(false);
    expect(ui.scriptNote).toBe('✗ Kaydedilemedi: HTTP 500');
    expect(currentScript()).toBeNull();
    await refreshScripts();
    expect(scriptsError()).toBe('HTTP 500');
  });

  it('untitled code saves as "Adsız betik"; new script templates detach', async () => {
    setUi('scriptCode', 'plot(close)');
    await saveCurrent();
    expect(currentScript()!.name).toBe('Adsız betik');
    newScript('library');
    expect(currentScript()).toBeNull();
    expect(ui.scriptCode).toContain('library("YeniKutuphane")');
    newScript('strategy');
    expect(ui.scriptCode).toContain('strategy.entry');
    newScript('indicator');
    expect(ui.scriptCode).toContain('indicator("Yeni Gösterge"');
  });

  it('rename / delete current', async () => {
    await saveCurrent();
    expect(await renameScriptById('script_1', ' Yeni ')).toBe(true);
    expect(currentScript()!.name).toBe('Yeni');
    expect(await renameScriptById('script_1', '')).toBe(false);
    expect(await renameScriptById('nope', 'x')).toBe(false);
    expect(await removeScript('script_1')).toBe(true);
    expect(currentScript()).toBeNull();
  });
});

describe('ScriptsDialog', () => {
  it('lists, opens, renames and two-click deletes scripts', async () => {
    await saveCurrent();
    setUi('scriptCode', '//@version=6\nstrategy("Strat")\nplot(close)');
    await saveAs('Strat');
    render(() => <ScriptsDialog />);
    setScriptDialog('open');
    await waitFor(() => expect($$('#lst-scripts .script-lib-row')).toHaveLength(2));
    expect($('#lst-scripts').textContent).toContain('Strateji');
    // ara
    fireEvent.input($('#inp-script-search'), { target: { value: 'ben' } });
    await waitFor(() => expect($$('#lst-scripts .script-lib-row')).toHaveLength(1));
    fireEvent.input($('#inp-script-search'), { target: { value: '' } });
    // aç
    fireEvent.click($('[data-script-id="script_1"] .script-lib-name'));
    expect(ui.scriptCode).toBe(CODE);
    expect(currentScript()!.id).toBe('script_1');
    expect($('#scripts-dialog')).toBeNull();
    // yeniden adlandır
    setScriptDialog('open');
    await waitFor(() => expect($('[data-script-id="script_1"]')).not.toBeNull());
    fireEvent.click($('[data-script-id="script_1"] [title="Yeniden adlandır"]'));
    const inp = $('.script-lib-rename') as HTMLInputElement;
    fireEvent.input(inp, { target: { value: 'Adı Değişti' } });
    fireEvent.keyDown(inp, { key: 'Enter' });
    await waitFor(() => expect($('[data-script-id="script_1"] .script-lib-name').textContent).toBe('Adı Değişti'));
    // sil: ilk tık onay ister, ikinci siler
    const del = () => $('[data-del="script_1"]');
    fireEvent.click(del());
    expect(del().textContent).toBe('Silinsin mi?');
    expect(db.scripts.has('script_1')).toBe(true);
    fireEvent.click(del());
    await waitFor(() => expect($('[data-script-id="script_1"]')).toBeNull());
    expect(currentScript()).toBeNull();
  });

  it('version history: preview with diff and restore', async () => {
    render(() => <ScriptsDialog />);
    setScriptDialog('versions');
    await waitFor(() => expect($('#scripts-dialog').textContent).toContain('önce betiği kaydedin'));
    await saveCurrent();
    setUi('scriptCode', CODE + '\nplot(open)');
    await saveCurrent();
    setScriptDialog('open');
    setScriptDialog('versions');
    await waitFor(() => expect($$('#lst-versions .script-version-row')).toHaveLength(2));
    expect($$('#lst-versions .script-version-row')[0].textContent).toContain('v2 · son');
    expect($$('#lst-versions .script-version-row')[0].textContent).toContain('+1');
    fireEvent.click($$('#lst-versions .script-version-row')[1]);
    expect($('.script-version-code').textContent).toBe(CODE);
    expect($('.script-version-bar').textContent).toContain('+0 −1 satır');
    fireEvent.click($('#btn-restore-version'));
    expect(ui.scriptCode).toBe(CODE);
    expect(isDirty()).toBe(true);
  });

  it('reference manual search, docs and insert', async () => {
    render(() => <ScriptsDialog />);
    setScriptDialog('reference');
    await waitFor(() => expect($('#inp-ref-search')).not.toBeNull());
    fireEvent.input($('#inp-ref-search'), { target: { value: 'ta.rsi' } });
    await waitFor(() => expect($('#script-ref-doc').textContent).toContain('ta.rsi(source, length) → series float'));
    expect($('#script-ref-doc').textContent).toContain('Göreceli güç');
    setUi('scriptCode', 'x = ');
    fireEvent.click($('#btn-ref-insert'));
    expect(ui.scriptCode).toBe('x = ta.rsi(source, length)');
    fireEvent.click($$('[data-scripttab]').find((b) => b.dataset.scripttab === 'open')!);
    expect($('#inp-script-search')).not.toBeNull();
  });

  it('save-as dialog', async () => {
    render(() => <ScriptsDialog />);
    setScriptDialog('saveas');
    await waitFor(() => expect($('#inp-saveas-name')).not.toBeNull());
    expect(($('#inp-saveas-name') as HTMLInputElement).value).toBe('Benim');
    fireEvent.input($('#inp-saveas-name'), { target: { value: 'Farklı' } });
    fireEvent.click($('#btn-saveas-ok'));
    await waitFor(() => expect($('#scripts-dialog')).toBeNull());
    expect(currentScript()!.name).toBe('Farklı');
  });

  it('lineDiffStats', () => {
    expect(lineDiffStats('a\nb', 'a\nc\nd')).toEqual({ added: 2, removed: 1 });
    expect(lineDiffStats('', '')).toEqual({ added: 0, removed: 0 });
  });
});

describe('ScriptEditor (textarea fallback in tests)', () => {
  it('edits code, ⌘S saves, diagnostics show syntax errors', async () => {
    render(() => <ScriptEditor />);
    const ta = $('#txt-script-code') as HTMLTextAreaElement;
    expect($('.script-code-host').dataset.editor).toBe('textarea');
    fireEvent.input(ta, { target: { value: '//@version=6\nindicator("D")\nplot(close +)' } });
    expect(ui.scriptCode).toContain('plot(close +)');
    await waitFor(() => expect(diagnostics()).toHaveLength(1), { timeout: 2000 });
    expect(diagnostics()[0]).toMatchObject({ line: 3, source: 'syntax' });
    fireEvent.keyDown(ta, { key: 's', metaKey: true });
    await waitFor(() => expect(currentScript()?.name).toBe('D'));
    fireEvent.input(ta, { target: { value: CODE } });
    await waitFor(() => expect(diagnostics()).toHaveLength(0), { timeout: 2000 });
    fireEvent.keyDown(ta, { key: 'Enter', ctrlKey: true });
    insertText('\n// son');
    expect(ui.scriptCode.endsWith('// son')).toBe(true);
  });
});
