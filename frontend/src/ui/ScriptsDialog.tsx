import { tfmt, tt, localeTag } from '../state/i18n';
import { LANG_NAME } from '../script/brand';
/**
 * Betik kütüphanesi penceresi: Betiklerim (aç / yeniden adlandır / sil),
 * Sürüm geçmişi (önizle / geri yükle), Referans kılavuzu (ara / imleçe ekle), Farklı kaydet.
 */
import { For, Show, createMemo, createSignal, onMount, type JSX } from 'solid-js';
import { Modal } from './Modal';
import { insertText } from './ScriptEditor';
import { searchRef, type RefEntry } from '../script/editor/reference';
import {
  currentScript,
  loadVersions,
  openScript,
  refreshScripts,
  removeScript,
  renameScriptById,
  restoreVersion,
  saveAs,
  scriptDialog,
  scriptTitleOf,
  scripts,
  scriptsError,
  setScriptDialog,
  versions,
  type ScriptDialog,
} from '../state/userScripts';
import { ui } from '../state/store';

const fmtTime = (sec: number) =>
  sec > 0 ? new Date(sec * 1000).toLocaleString(localeTag(), { dateStyle: 'short', timeStyle: 'short' }) : '—';

/** Satır bazlı basit fark özeti: eklenen / silinen satır sayısı (çoklu küme). */
export function lineDiffStats(from: string, to: string): { added: number; removed: number } {
  const count = (s: string) => {
    const m = new Map<string, number>();
    for (const l of s.split('\n')) m.set(l, (m.get(l) ?? 0) + 1);
    return m;
  };
  const a = count(from);
  const b = count(to);
  let added = 0;
  let removed = 0;
  for (const [l, n] of b) added += Math.max(0, n - (a.get(l) ?? 0));
  for (const [l, n] of a) removed += Math.max(0, n - (b.get(l) ?? 0));
  return { added, removed };
}

const TITLES: Record<Exclude<ScriptDialog, null>, string> = {
  open: 'Betiklerim',
  versions: tt("Sürüm Geçmişi"),
  reference: tfmt("{0} Referans Kılavuzu", LANG_NAME),
  saveas: tt("Farklı Kaydet"),
};

function OpenView(): JSX.Element {
  const [q, setQ] = createSignal('');
  const [editing, setEditing] = createSignal<string | null>(null);
  const [draft, setDraft] = createSignal('');
  const [confirmDel, setConfirmDel] = createSignal<string | null>(null);
  onMount(() => void refreshScripts());
  const list = createMemo(() => {
    const n = q().trim().toLowerCase();
    return n ? scripts().filter((s) => s.name.toLowerCase().includes(n)) : scripts();
  });
  const kindOf = (code: string) => (/\bstrategy\s*\(/.test(code) ? 'Strateji' : /\blibrary\s*\(/.test(code) ? tt("Kütüphane") : tt("Gösterge"));
  return (
    <div class="script-lib">
      <input id="inp-script-search" class="script-lib-search" placeholder={tt("Betik ara…")} value={q()} onInput={(e) => setQ(e.currentTarget.value)} />
      <Show when={scriptsError()}>
        <div class="script-lib-error">✗ {scriptsError()}</div>
      </Show>
      <div class="script-lib-list" id="lst-scripts">
        <Show when={list().length > 0} fallback={<div class="script-lib-empty">{tt("Kayıtlı betik yok. Editörde ⌘S ile kaydedin.")}</div>}>
          <For each={list()}>
            {(s) => (
              <div class="script-lib-row" classList={{ active: currentScript()?.id === s.id }} data-script-id={s.id}>
                <Show
                  when={editing() === s.id}
                  fallback={
                    <button class="script-lib-name" onClick={() => openScript(s)} title={tt("Editörde aç")}>
                      {s.name}
                    </button>
                  }
                >
                  <input
                    class="script-lib-rename"
                    value={draft()}
                    onInput={(e) => setDraft(e.currentTarget.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void renameScriptById(s.id, draft()).then(() => setEditing(null));
                      if (e.key === 'Escape') setEditing(null);
                    }}
                    ref={(el) => queueMicrotask(() => el.focus())}
                  />
                </Show>
                <span class="script-lib-kind">{kindOf(s.code)}</span>
                <span class="script-lib-time">{fmtTime(s.updatedAt)}</span>
                <button class="icon-text-btn" title={tt("Yeniden adlandır")} onClick={() => { setDraft(s.name); setEditing(s.id); }}>✎</button>
                <button
                  class="icon-text-btn"
                  classList={{ danger: confirmDel() === s.id }}
                  title={tt("Sil (betik ve tüm sürümleri; geri alınamaz)")}
                  data-del={s.id}
                  onClick={() => {
                    if (confirmDel() === s.id) {
                      setConfirmDel(null);
                      void removeScript(s.id);
                    } else setConfirmDel(s.id);
                  }}
                >
                  {confirmDel() === s.id ? 'Silinsin mi?' : '🗑'}
                </button>
              </div>
            )}
          </For>
        </Show>
      </div>
    </div>
  );
}

function VersionsView(): JSX.Element {
  const [sel, setSel] = createSignal<number | null>(null);
  onMount(() => void loadVersions());
  const selected = () => versions().find((v) => v.version === sel()) ?? versions()[0];
  return (
    <Show
      when={currentScript()}
      fallback={<div class="script-lib-empty">{tt("Sürüm geçmişi için önce betiği kaydedin (⌘S).")}</div>}
    >
      <div class="script-versions">
        <div class="script-versions-list" id="lst-versions">
          <For each={versions()} fallback={<div class="script-lib-empty">{tt("Henüz sürüm yok.")}</div>}>
            {(v, i) => {
              const d = () => lineDiffStats(versions()[i() + 1]?.code ?? '', v.code);
              return (
                <button class="script-version-row" classList={{ active: selected()?.version === v.version }} onClick={() => setSel(v.version)}>
                  <span class="script-version-no">v{v.version}{i() === 0 ? tt(" · son") : ''}</span>
                  <span class="script-version-time">{fmtTime(v.createdAt)}</span>
                  <span class="script-version-diff">
                    <span style={{ color: 'var(--bull)' }}>+{d().added}</span> <span style={{ color: 'var(--bear)' }}>−{d().removed}</span>
                  </span>
                </button>
              );
            }}
          </For>
        </div>
        <div class="script-version-preview">
          <Show when={selected()}>
            <div class="script-version-bar">
              <span>
                v{selected()!.version}{' '}{tt("· editördekine göre")}{' '}
                {(() => {
                  const d = lineDiffStats(ui.scriptCode, selected()!.code);
                  return tfmt("+{0} −{1} satır", d.added, d.removed);
                })()}
              </span>
              <button id="btn-restore-version" class="btn-primary" onClick={() => restoreVersion(selected()!)}>
                {tt("Bu sürümü geri yükle")}
              </button>
            </div>
            <pre class="script-version-code">{selected()!.code}</pre>
          </Show>
        </div>
      </div>
    </Show>
  );
}

function ReferenceView(): JSX.Element {
  const [q, setQ] = createSignal('');
  const [sel, setSel] = createSignal<RefEntry | null>(null);
  const results = createMemo(() => searchRef(q(), 300));
  const cur = () => sel() ?? results()[0] ?? null;
  const kindTr: Record<string, string> = { function: 'fonksiyon', variable: tt("değişken"), constant: 'sabit', keyword: tt("anahtar sözcük"), type: 'tip', namespace: tt("isim alanı") };
  return (
    <div class="script-ref">
      <input
        id="inp-ref-search"
        class="script-lib-search"
        placeholder="ta.sma, request.security, color…"
        value={q()}
        onInput={(e) => { setQ(e.currentTarget.value); setSel(null); }}
      />
      <div class="script-ref-body">
        <div class="script-ref-list" id="lst-ref">
          <For each={results()}>
            {(e) => (
              <button class="script-ref-row" classList={{ active: cur()?.name === e.name && cur()?.kind === e.kind }} onClick={() => setSel(e)}>
                {e.name}
                {e.kind === 'function' ? '()' : ''}
              </button>
            )}
          </For>
        </div>
        <div class="script-ref-doc" id="script-ref-doc">
          <Show when={cur()}>
            <code class="script-ref-sig">{cur()!.signature}</code>
            <div class="script-ref-kind">{kindTr[cur()!.kind]}</div>
            <p>{cur()!.doc}</p>
            <Show when={cur()!.params.length > 0}>
              <div class="script-ref-params-title">{tt("Parametreler")}</div>
              <ul class="script-ref-params">
                <For each={cur()!.params}>{(p) => <li><code>{p.name}</code>{p.optional ? tt(" — isteğe bağlı") : ''}</li>}</For>
              </ul>
            </Show>
            <button
              id="btn-ref-insert"
              class="btn-secondary"
              onClick={() => {
                const e = cur()!;
                insertText(e.kind === 'function' ? `${e.name}(${e.params.filter((p) => !p.optional).map((p) => p.name).join(', ')})` : e.name);
              }}
            >
              {tt("Editöre ekle")}
            </button>
          </Show>
        </div>
      </div>
    </div>
  );
}

function SaveAsView(): JSX.Element {
  const [name, setName] = createSignal(currentScript()?.name ? `${currentScript()!.name} (kopya)` : scriptTitleOf(ui.scriptCode) ?? tt("Adsız betik"));
  const submit = () => void saveAs(name()).then((ok) => ok && setScriptDialog(null));
  return (
    <div class="script-saveas">
      <label>
        {tt("Betik adı")}
        <input
          id="inp-saveas-name"
          class="script-lib-search"
          value={name()}
          onInput={(e) => setName(e.currentTarget.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          ref={(el) => queueMicrotask(() => el.select())}
        />
      </label>
      <div class="script-saveas-actions">
        <button class="btn-secondary" onClick={() => setScriptDialog(null)}>{tt("Vazgeç")}</button>
        <button id="btn-saveas-ok" class="btn-primary" disabled={!name().trim()} onClick={submit}>{tt("Kaydet")}</button>
      </div>
    </div>
  );
}

export function ScriptsDialog(): JSX.Element {
  return (
    <Show when={scriptDialog()}>
      {(d) => (
        <Modal id="scripts-dialog" title={TITLES[d()]} width={d() === 'saveas' ? '380px' : '760px'} onClose={() => setScriptDialog(null)}>
          <Show when={d() !== 'saveas'}>
            <div class="script-lib-tabs">
              <For each={['open', 'versions', 'reference'] as const}>
                {(t) => (
                  <button class="script-lib-tab" classList={{ active: d() === t }} data-scripttab={t} onClick={() => setScriptDialog(t)}>
                    {TITLES[t]}
                  </button>
                )}
              </For>
            </div>
          </Show>
          <Show when={d() === 'open'}><OpenView /></Show>
          <Show when={d() === 'versions'}><VersionsView /></Show>
          <Show when={d() === 'reference'}><ReferenceView /></Show>
          <Show when={d() === 'saveas'}><SaveAsView /></Show>
        </Modal>
      )}
    </Show>
  );
}
