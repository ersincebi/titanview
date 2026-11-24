import { For, Show, createMemo, createSignal, onCleanup, onMount, type JSX } from 'solid-js';
import { openStudyAlert } from '../state/alertStore';
import { lang, tfmt, tt } from '../state/i18n';
import { BUILTINS, CATEGORY_ORDER, builtinById, builtinDesc, builtinName, categoryLabel, searchBuiltins, type BuiltinCategory, type BuiltinIndicator } from '../script/builtins';
import { OSCILLATOR_ITEMS, OVERLAY_ITEMS, type IndicatorItem } from '../state/templates';
import { savedScripts, setUi, toast, toggleIndicator, ui, hover } from '../state/store';
import {
  addStudy,
  duplicateStudy,
  favoriteIndicators,
  fxParent,
  moveStudyPane,
  removeStudy,
  resetStudy,
  restoreStudy,
  saveStudyDefaults,
  setFillVisible,
  setFxParent,
  setHlineStyle,
  setPlotStyle,
  setStudyInput,
  setStudySettings,
  setStudyVisibility,
  startStudyPick,
  studies,
  studyById,
  studyLabel,
  studyPaneOf,
  studyResults,
  studySettings,
  studyShortTitle,
  toggleFavoriteIndicator,
  toggleStudyVisible,
  updateStudy,
} from '../state/studies';
import { VIS_UNITS, dependentsOf, formatStudyValue, sourceRef, valueAt, type PlotStyleKind, type StudyInstance } from '../state/studyModel';
import { Modal } from './Modal';
import '../styles/indicators.css';
import { SCRIPT_SOURCES, ScriptInputField, composeColor, groupScriptInputs, parseColor } from './ScriptInputs';

// ------------------------------------------------------------------ Göstergeler penceresi (fx)

type FxNav = 'favorites' | 'all' | BuiltinCategory | 'quick' | 'scripts';

const closeFx = () => {
  setUi('modal', null);
  setFxParent(null);
};

function QuickRows(props: { items: IndicatorItem[] }): JSX.Element {
  return (
    <For each={props.items}>
      {(item) => (
        <div
          class="ind-modal-row"
          data-fx-ind={item.key}
          onClick={() => {
            toggleIndicator(item.key);
            toast(tfmt("{0}: {1}", ui.quick[item.key] ? tt('Eklendi') : tt("Kaldırıldı"), item.key.toUpperCase()));
          }}
        >
          <div>
            <div class="fx-row-title">{item.title}</div>
            <div class="fx-row-desc">{item.desc}</div>
          </div>
          <span class={`market-pill ${ui.quick[item.key] ? 'market-FOREX' : 'market-US'}`}>{ui.quick[item.key] ? tt("✓ AKTİF") : tt("+ EKLE")}</span>
        </div>
      )}
    </For>
  );
}

function BuiltinRow(props: { b: BuiltinIndicator }): JSX.Element {
  const count = () => studies.list.filter((s) => s.builtinId === props.b.id).length;
  const fav = () => favoriteIndicators().includes(props.b.id);
  return (
    <div
      class="ind-modal-row fx-builtin-row"
      data-fx-builtin={props.b.id}
      title={builtinDesc(props.b)}
      onClick={() => {
        const uid = addStudy({ builtinId: props.b.id }, fxParent());
        if (uid) toast(tfmt('Eklendi: {0}', builtinName(props.b)));
      }}
    >
      <button
        class="fx-star"
        classList={{ active: fav() }}
        data-fx-fav={props.b.id}
        title={fav() ? tt("Favorilerden çıkar") : tt("Favorilere ekle")}
        onClick={(e) => {
          e.stopPropagation();
          toggleFavoriteIndicator(props.b.id);
        }}
      >
        {fav() ? '★' : '☆'}
      </button>
      <div class="fx-row-main">
        <div class="fx-row-title">{builtinName(props.b)}</div>
        <div class="fx-row-desc">
          <Show when={lang() === 'en'} fallback={<>{props.b.title}<Show when={props.b.title !== props.b.shortTitle}> · {props.b.shortTitle}</Show></>}>
            {props.b.shortTitle} · {builtinDesc(props.b)}
          </Show>
        </div>
      </div>
      <Show when={count() > 0}>
        <span class="fx-count" data-fx-count={props.b.id}>{count()}</span>
      </Show>
    </div>
  );
}

export function FxModal(): JSX.Element {
  const [q, setQ] = createSignal('');
  const [nav, setNav] = createSignal<FxNav>(favoriteIndicators().length > 0 ? 'favorites' : 'all');
  const parentLabel = () => {
    const p = fxParent();
    const s = p ? studyById(p) : undefined;
    return s ? studyLabel(s) : null;
  };
  const list = createMemo<BuiltinIndicator[]>(() => {
    const n = nav();
    // Varsayılan: arama yazılınca kategori yok sayılır, tüm kütüphanede aranır
    if (q().trim()) return searchBuiltins(q(), BUILTINS);
    let base: BuiltinIndicator[] = BUILTINS;
    if (n === 'favorites') base = BUILTINS.filter((b) => favoriteIndicators().includes(b.id));
    else if (n !== 'all' && n !== 'quick' && n !== 'scripts') base = BUILTINS.filter((b) => b.category === n);
    return searchBuiltins(q(), base);
  });
  const userScripts = () =>
    savedScripts().filter((s) => !/\blibrary\s*\(/.test(s.code) && (!q().trim() || s.name.toLowerCase().includes(q().trim().toLowerCase())));
  const NAV: Array<[FxNav, string]> = [
    ['favorites', tt('★ Favoriler')],
    ['all', tfmt("Tümü ({0})", BUILTINS.length)],
    ...CATEGORY_ORDER.map((c): [FxNav, string] => [c, `${categoryLabel(c)} (${BUILTINS.filter((b) => b.category === c).length})`]),
    ['quick', tt("Hızlı göstergeler")],
    ['scripts', tt('Betiklerim')],
  ];
  const en = () => lang() === 'en';
  return (
    <Modal
      id="modal-fx"
      width="840px"
      className="tv-modal-fx"
      title={
        parentLabel()
          ? en() ? `Indicator on indicator: ${parentLabel()}` : `Gösterge üstüne gösterge: ${parentLabel()}`
          : en() ? 'Indicators, metrics, and strategies' : 'Göstergeler, metrikler ve stratejiler'
      }
      onClose={closeFx}
    >
      <div class="fx-search">
        <input
          id="inp-fx-search"
          class="fx-search-input"
          type="text"
          placeholder={en() ? 'Search (e.g. rsi, bollinger, macd, hammer)' : 'Ara (ör. rsi, bollinger, göreceli güç, çekiç)'}
          value={q()}
          onInput={(e) => setQ(e.currentTarget.value)}
          onKeyDown={(e) => e.stopPropagation()}
        />
      </div>
      <div class="fx-layout">
        <nav class="fx-nav">
          <div class="fx-nav-caption">{tt("YERLEŞİK")}</div>
          <For each={NAV}>
            {([id, label]) => (
              <button class="fx-nav-item" data-fx-nav={id} classList={{ active: nav() === id }} onClick={() => setNav(id)}>
                {label}
              </button>
            )}
          </For>
        </nav>
        <div class="tv-modal-body fx-list" id="fx-modal-body">
          <Show when={nav() === 'quick' && !q().trim()}>
            <div class="fx-list-caption">{tt("ÜST KATMAN (OVERLAY)")}</div>
            <QuickRows items={OVERLAY_ITEMS} />
            <div class="fx-list-caption">{tt("ALT PANEL (OSİLATÖR)")}</div>
            <QuickRows items={OSCILLATOR_ITEMS} />
          </Show>
          <Show when={nav() === 'scripts'}>
            <div class="fx-list-caption">{tt("KAYITLI BETİKLER (SQLite)")}</div>
            <Show when={userScripts().length > 0} fallback={<div class="fx-empty">{tt("Kayıtlı gösterge betiği yok (Betik editöründe ⌘S).")}</div>}>
              <For each={userScripts()}>
                {(s) => (
                  <div class="ind-modal-row fx-builtin-row" data-fx-script={s.id} onClick={() => addStudy({ code: s.code }, fxParent()) && toast(`Eklendi: ${s.name}`)}>
                    <span class="fx-star">📄</span>
                    <div class="fx-row-main">
                      <div class="fx-row-title">{s.name}</div>
                      <div class="fx-row-desc">{/\bstrategy\s*\(/.test(s.code) ? 'Strateji' : tt("Gösterge")}</div>
                    </div>
                  </div>
                )}
              </For>
            </Show>
          </Show>
          <Show when={(nav() !== 'quick' && nav() !== 'scripts') || q().trim()}>
            <Show when={list().length > 0} fallback={<div class="fx-empty">{nav() === 'favorites' && !q() ? tt("☆ ile favori ekleyin.") : tt("Eşleşen gösterge yok.")}</div>}>
              <For each={list()}>{(b) => <BuiltinRow b={b} />}</For>
            </Show>
          </Show>
        </div>
      </div>
    </Modal>
  );
}

/** Üst çubuktaki ★ menüsü: favori göstergeleri tek tıkla ekler. */
export function FavoriteIndicatorsMenu(props: { onClose: () => void }): JSX.Element {
  let el!: HTMLDivElement;
  const onDoc = (e: MouseEvent) => {
    if (!el.contains(e.target as Node) && !(e.target as HTMLElement).closest('#btn-fav-indicators')) props.onClose();
  };
  onMount(() => document.addEventListener('mousedown', onDoc));
  onCleanup(() => document.removeEventListener('mousedown', onDoc));
  const favs = () => BUILTINS.filter((b) => favoriteIndicators().includes(b.id));
  return (
    <div id="fav-indicators-menu" class="pane-menu fav-ind-menu" ref={el}>
      <div class="pane-menu-head">{tt("Favori göstergeler")}</div>
      <Show when={favs().length > 0} fallback={<div class="fx-empty">{tt("Göstergeler penceresinde ☆ ile ekleyin.")}</div>}>
        <For each={favs()}>
          {(b) => (
            <button
              class="pane-menu-item"
              data-fav-add={b.id}
              onClick={() => {
                addStudy({ builtinId: b.id });
                toast(tfmt('Eklendi: {0}', builtinName(b)));
                props.onClose();
              }}
            >
              <span class="pane-menu-check">★</span>
              {builtinName(b)}
            </button>
          )}
        </For>
      </Show>
    </div>
  );
}

// ------------------------------------------------------------------ lejant satırları

export const [studyMenu, setStudyMenu] = createSignal<{ uid: string; x: number; y: number } | null>(null);

function StudyRow(props: { s: StudyInstance }): JSX.Element {
  const res = () => studyResults()[props.s.uid];
  const values = createMemo(() => {
    const r = res();
    if (!r?.ok || !props.s.statusValues || !props.s.visible) return [];
    const t = hover()?.time ?? null;
    const out: Array<{ text: string; color: string }> = [];
    for (const p of r.plots) {
      if (p.hidden || props.s.plots[p.title]?.visible === false) continue;
      const v = valueAt(p, t);
      if (v) out.push({ text: formatStudyValue(v.value, props.s.precision), color: props.s.plots[p.title]?.color ?? v.color });
      if (out.length >= 8) break;
    }
    return out;
  });
  const color = () => {
    const r = res();
    const p = r?.plots.find((x) => !x.hidden);
    return props.s.plots[p?.title ?? '']?.color ?? p?.color ?? '#38bdf8';
  };
  return (
    <div class="ind-legend-row study-legend-row" classList={{ 'study-hidden': !props.s.visible, 'study-error': res()?.ok === false }} data-study-row={props.s.uid}>
      <span class="study-name" style={{ color: props.s.visible ? color() : 'var(--text-secondary)' }} onDblClick={() => setStudySettings({ uid: props.s.uid, tab: 'inputs' })}>
        {studyLabel(props.s)}
      </span>
      <Show when={res()?.ok === false}>
        <span class="study-err" title={res()?.error}>⚠ {res()?.error}</span>
      </Show>
      <For each={values()}>{(v) => <strong class="study-val" style={{ color: v.color }}>{v.text}</strong>}</For>
      <div class="ind-actions">
        <button class="ind-action-btn" data-study-eye={props.s.uid} title={props.s.visible ? tt("Gizle") : tt("Göster")} onClick={() => toggleStudyVisible(props.s.uid)}>
          {props.s.visible ? '👁' : '◌'}
        </button>
        <button class="ind-action-btn" data-study-cfg={props.s.uid} title={tt("Ayarlar")} onClick={() => setStudySettings({ uid: props.s.uid, tab: 'inputs' })}>⚙</button>
        <button class="ind-action-btn" data-study-remove={props.s.uid} title={tt("Kaldır")} onClick={() => removeStudy(props.s.uid)}>✕</button>
        <button
          class="ind-action-btn"
          data-study-more={props.s.uid}
          title={tt("Diğer")}
          onClick={(e) => {
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
            setStudyMenu({ uid: props.s.uid, x: r.left, y: r.bottom });
          }}
        >
          ⋯
        </button>
      </div>
    </div>
  );
}

/** Ana fiyat panelindeki göstergeler + gizli/hatalı tüm göstergeler (varsayılan: lejantta kalır). */
export function StudyLegendRows(): JSX.Element {
  const rows = () =>
    studies.list.filter((s) => {
      const pane = studyPaneOf(s.uid);
      return !s.visible || studyResults()[s.uid]?.ok === false || pane === 'main' || pane === undefined;
    });
  return <For each={rows()}>{(s) => <StudyRow s={s} />}</For>;
}

/** Bir gösterge pane'indeki göstergeler (pane ⚙ menüsü). */
export function studiesInPane(paneId: string): StudyInstance[] {
  return studies.list.filter((s) => studyPaneOf(s.uid) === paneId);
}

export function StudyMenu(): JSX.Element {
  let el!: HTMLDivElement;
  const m = () => studyMenu();
  const close = () => setStudyMenu(null);
  const onDoc = (e: MouseEvent) => {
    if (el && !el.contains(e.target as Node) && !(e.target as HTMLElement).closest('[data-study-more]')) close();
  };
  onMount(() => document.addEventListener('mousedown', onDoc));
  onCleanup(() => document.removeEventListener('mousedown', onDoc));
  const s = () => (m() ? studyById(m()!.uid) : undefined);
  const otherPanes = createMemo(() => {
    const cur = s();
    if (!cur) return [];
    const seen = new Set<string>();
    const out: Array<{ uid: string; label: string }> = [];
    for (const o of studies.list) {
      if (o.uid === cur.uid) continue;
      const p = studyPaneOf(o.uid);
      if (!p || p === 'main' || seen.has(p) || p === studyPaneOf(cur.uid)) continue;
      seen.add(p);
      out.push({ uid: o.uid, label: studyShortTitle(o) });
    }
    return out;
  });
  const item = (label: string, id: string, fn: () => void, active = false) => (
    <button id={id} class="pane-menu-item" classList={{ active }} onClick={() => { fn(); close(); }}>
      <span class="pane-menu-check">{active ? '✓' : ''}</span>
      {label}
    </button>
  );
  return (
    <Show when={m() && s()}>
      <div id="study-menu" class="pane-menu" ref={el} style={{ left: `${Math.min(m()!.x, window.innerWidth - 240)}px`, top: `${m()!.y + 4}px` }}>
        <div class="pane-menu-head">{studyShortTitle(s()!)}</div>
        {item(tt("Ayarlar…"), 'study-menu-settings', () => setStudySettings({ uid: s()!.uid, tab: 'inputs' }))}
        {item(tt("⏰ Alarm ekle…"), 'study-menu-alert', () => openStudyAlert(s()!.uid))}
        {item(tt("Gösterge üstüne gösterge ekle…"), 'study-menu-onstudy', () => {
          setFxParent(s()!.uid);
          setUi('modal', 'fx');
        })}
        {item('Kopyala', 'study-menu-dup', () => duplicateStudy(s()!.uid))}
        {item(s()!.visible ? tt("Gizle") : tt("Göster"), 'study-menu-eye', () => toggleStudyVisible(s()!.uid))}
        <div class="pane-menu-sep" />
        <div class="pane-menu-head">{tt("Taşı")}</div>
        {item(tt("Ana grafiğe (fiyat paneli)"), 'study-move-main', () => moveStudyPane(s()!.uid, 'main'), studyPaneOf(s()!.uid) === 'main')}
        {item(tt("Yeni panele (aşağıda)"), 'study-move-new', () => moveStudyPane(s()!.uid, 'new'), s()!.pane === 'new')}
        <For each={otherPanes()}>{(o) => item(tfmt("{0} paneline birleştir", o.label), `study-move-with-${o.uid}`, () => moveStudyPane(s()!.uid, `with:${o.uid}`))}</For>
        {item(tt("Otomatik yerleşim"), 'study-move-auto', () => moveStudyPane(s()!.uid, undefined), s()!.pane === undefined)}
        <div class="pane-menu-sep" />
        <div class="pane-menu-head">{tt("Ölçeğe sabitle")}</div>
        {item(tt("Sağ ölçek"), 'study-scale-right', () => updateStudy(s()!.uid, { scale: 'right' }), s()!.scale === 'right')}
        {item(tt("Sol ölçek"), 'study-scale-left', () => updateStudy(s()!.uid, { scale: 'left' }), s()!.scale === 'left')}
        {item(tt("Ölçeksiz"), 'study-scale-none', () => updateStudy(s()!.uid, { scale: 'none' }), s()!.scale === 'none')}
        <div class="pane-menu-sep" />
        {item(tt("Kaldır"), 'study-menu-remove', () => removeStudy(s()!.uid))}
      </div>
    </Show>
  );
}

// ------------------------------------------------------------------ ayar penceresi

const STYLE_OPTS: Array<[PlotStyleKind, string]> = [
  ['line', tt("Çizgi")],
  ['stepline', tt("Basamak")],
  ['histogram', 'Histogram'],
  ['area', tt("Alan")],
  ['circles', tt("Daireler")],
  ['cross', tt("Artılar")],
];

function ColorField(props: { value: string; onChange: (c: string) => void; attr: Record<string, string> }): JSX.Element {
  const c = () => parseColor(props.value);
  return (
    <span class="study-color" {...props.attr}>
      <input type="color" value={c().hex} onInput={(e) => props.onChange(composeColor(e.currentTarget.value, c().alpha))} />
      <input
        type="range"
        min="0"
        max="100"
        title={tt("Opaklık")}
        value={Math.round(c().alpha * 100)}
        onInput={(e) => props.onChange(composeColor(c().hex, Number(e.currentTarget.value) / 100))}
      />
    </span>
  );
}

function InputsTab(props: { s: StudyInstance }): JSX.Element {
  const res = () => studyResults()[props.s.uid];
  const groups = createMemo(() => groupScriptInputs(res()?.inputs ?? []));
  /** Kaynak seçenekleri: yerleşik seriler + (döngü oluşturmayan) diğer göstergelerin çizimleri */
  const sources = createMemo<Array<[string, string]>>(() => {
    const deps = dependentsOf(studies.list, props.s.uid);
    const out: Array<[string, string]> = SCRIPT_SOURCES.map((x) => [x, x]);
    for (const o of studies.list) {
      if (o.uid === props.s.uid || deps.has(o.uid)) continue;
      for (const p of studyResults()[o.uid]?.plots ?? []) out.push([sourceRef(o.uid, p.title), `${studyShortTitle(o)}: ${p.title}`]);
    }
    return out;
  });
  const valueOf = (key: string, def: { value?: unknown; defval: unknown }) => (props.s.inputs[key] !== undefined ? props.s.inputs[key] : def.value !== undefined ? def.value : def.defval);
  return (
    <div class="study-tab study-inputs" id="study-tab-inputs">
      <Show when={(res()?.inputs?.length ?? 0) > 0} fallback={<div class="fx-empty">{tt("Bu göstergenin girdisi yok.")}</div>}>
        <For each={groups()}>
          {(g) => (
            <div class="script-inp-group">
              <Show when={g.name}>
                <div class="script-inp-group-title">{g.name}</div>
              </Show>
              <For each={g.rows}>
                {(row) => (
                  <div class="script-inp-row" classList={{ inline: row.length > 1 }}>
                    <For each={row}>
                      {(def) => {
                        const key = def.id ?? def.title;
                        return (
                          <ScriptInputField
                            def={def}
                            attr="data-study-input"
                            value={valueOf(key, def)}
                            sources={sources()}
                            onChange={(v) => setStudyInput(props.s.uid, key, v)}
                            onPick={() => {
                              startStudyPick(props.s.uid, def);
                              setStudySettings(null);
                            }}
                          />
                        );
                      }}
                    </For>
                  </div>
                )}
              </For>
            </div>
          )}
        </For>
      </Show>
    </div>
  );
}

function StyleTab(props: { s: StudyInstance }): JSX.Element {
  const res = () => studyResults()[props.s.uid];
  const plots = () => res()?.plots ?? [];
  const hasShapes = () => (res()?.markers.length ?? 0) > 0;
  return (
    <div class="study-tab study-style" id="study-tab-style">
      <For each={plots()}>
        {(p) => {
          const st = () => props.s.plots[p.title] ?? {};
          return (
            <div class="study-style-row" data-style-plot={p.title}>
              <label class="study-check">
                <input type="checkbox" checked={st().visible !== false && !p.hidden} onChange={(e) => setPlotStyle(props.s.uid, p.title, { visible: e.currentTarget.checked })} />
                <span>{p.title}</span>
              </label>
              <ColorField value={st().color ?? p.color} attr={{ 'data-style-color': p.title }} onChange={(c) => setPlotStyle(props.s.uid, p.title, { color: c })} />
              <select class="script-select" data-style-width={p.title} value={String(st().lineWidth ?? p.lineWidth)} onChange={(e) => setPlotStyle(props.s.uid, p.title, { lineWidth: Number(e.currentTarget.value) })}>
                <For each={[1, 2, 3, 4]}>{(w) => <option value={String(w)}>{w}px</option>}</For>
              </select>
              <select class="script-select" data-style-kind={p.title} value={st().style ?? p.style} onChange={(e) => setPlotStyle(props.s.uid, p.title, { style: e.currentTarget.value as PlotStyleKind })}>
                <For each={STYLE_OPTS}>{([v, l]) => <option value={v}>{l}</option>}</For>
              </select>
            </div>
          );
        }}
      </For>
      <For each={res()?.hlines ?? []}>
        {(h) => (
          <div class="study-style-row" data-style-hline={h.title}>
            <label class="study-check">
              <input type="checkbox" checked={props.s.hlines[h.title]?.visible !== false} onChange={(e) => setHlineStyle(props.s.uid, h.title, { visible: e.currentTarget.checked })} />
              <span>{h.title}</span>
            </label>
            <ColorField value={props.s.hlines[h.title]?.color ?? h.color} attr={{ 'data-style-hcolor': h.title }} onChange={(c) => setHlineStyle(props.s.uid, h.title, { color: c })} />
            <span class="study-hint">{h.price}</span>
          </div>
        )}
      </For>
      <For each={res()?.fills ?? []}>
        {(f) => (
          <div class="study-style-row" data-style-fill={f.title}>
            <label class="study-check">
              <input type="checkbox" checked={props.s.fills[f.title]?.visible !== false} onChange={(e) => setFillVisible(props.s.uid, f.title, e.currentTarget.checked)} />
              <span>{f.title}{' '}{tt("(dolgu)")}</span>
            </label>
          </div>
        )}
      </For>
      <Show when={(res()?.bgcolors?.length ?? 0) > 0}>
        <div class="study-style-row">
          <label class="study-check">
            <input type="checkbox" data-style-bg checked={props.s.bgVisible} onChange={(e) => updateStudy(props.s.uid, { bgVisible: e.currentTarget.checked })} />
            <span>{tt("Arka plan renklendirme")}</span>
          </label>
        </div>
      </Show>
      <Show when={hasShapes()}>
        <div class="study-style-row">
          <label class="study-check">
            <input type="checkbox" data-style-shapes checked={props.s.plots['__shapes']?.visible !== false} onChange={(e) => setPlotStyle(props.s.uid, '__shapes', { visible: e.currentTarget.checked })} />
            <span>{tt("Şekiller / işaretler")}</span>
          </label>
        </div>
      </Show>
      <div class="pane-menu-sep" />
      <div class="study-style-row">
        <span class="settings-label">{tt("Hassasiyet")}</span>
        <select class="script-select" id="study-precision" value={String(props.s.precision)} onChange={(e) => updateStudy(props.s.uid, { precision: Number(e.currentTarget.value) })}>
          <option value="-1">{tt("Varsayılan")}</option>
          <For each={[0, 1, 2, 3, 4, 5, 6, 7, 8]}>{(n) => <option value={String(n)}>{n}</option>}</For>
        </select>
      </div>
      <div class="study-style-row">
        <span class="settings-label">{tt("Ölçek")}</span>
        <select class="script-select" id="study-scale" value={props.s.scale} onChange={(e) => updateStudy(props.s.uid, { scale: e.currentTarget.value as StudyInstance['scale'] })}>
          <option value="right">{tt("Sağ ölçek")}</option>
          <option value="left">{tt("Sol ölçek")}</option>
          <option value="none">{tt("Ölçeksiz")}</option>
        </select>
      </div>
      <label class="study-check">
        <input type="checkbox" id="study-price-labels" checked={props.s.priceLabels} onChange={(e) => updateStudy(props.s.uid, { priceLabels: e.currentTarget.checked })} />
        <span>{tt("Fiyat ölçeğinde etiketler")}</span>
      </label>
      <label class="study-check">
        <input type="checkbox" id="study-status-values" checked={props.s.statusValues} onChange={(e) => updateStudy(props.s.uid, { statusValues: e.currentTarget.checked })} />
        <span>{tt("Durum satırında değerler")}</span>
      </label>
    </div>
  );
}

function VisibilityTab(props: { s: StudyInstance }): JSX.Element {
  const set = (unit: (typeof VIS_UNITS)[number]['unit'], patch: Partial<{ on: boolean; min: number; max: number }>) => {
    const next = JSON.parse(JSON.stringify(props.s.visibility));
    next[unit] = { ...next[unit], ...patch };
    setStudyVisibility(props.s.uid, next);
  };
  return (
    <div class="study-tab study-visibility" id="study-tab-visibility">
      <For each={VIS_UNITS}>
        {(u) => {
          const r = () => props.s.visibility[u.unit];
          return (
            <div class="study-vis-row" data-vis={u.unit}>
              <label class="study-check">
                <input type="checkbox" checked={r().on} onChange={(e) => set(u.unit, { on: e.currentTarget.checked })} />
                <span>{u.label}</span>
              </label>
              <input type="number" class="script-inp-field" min="1" max={u.max} value={r().min} disabled={!r().on} data-vis-min={u.unit} onChange={(e) => set(u.unit, { min: Math.max(1, Math.min(u.max, Number(e.currentTarget.value) || 1)) })} />
              <span class="study-hint">—</span>
              <input type="number" class="script-inp-field" min="1" max={u.max} value={r().max} disabled={!r().on} data-vis-max={u.unit} onChange={(e) => set(u.unit, { max: Math.max(1, Math.min(u.max, Number(e.currentTarget.value) || u.max)) })} />
            </div>
          );
        }}
      </For>
    </div>
  );
}

const TABS: Array<['inputs' | 'style' | 'visibility', string]> = [
  ['inputs', tt("Girdiler")],
  ['style', tt("Stil")],
  ['visibility', tt("Görünürlük")],
];

/** Standart gösterge ayar penceresi: değişiklik canlı uygulanır; İptal açılıştaki duruma döner. */
export function StudySettingsDialog(): JSX.Element {
  return (
    <Show when={studySettings() && studyById(studySettings()!.uid)}>
      <SettingsBody uid={studySettings()!.uid} />
    </Show>
  );
}

function SettingsBody(props: { uid: string }): JSX.Element {
  const snapshot: StudyInstance = JSON.parse(JSON.stringify(studyById(props.uid)));
  const s = () => studyById(props.uid);
  const tab = () => studySettings()?.tab ?? 'inputs';
  const [defOpen, setDefOpen] = createSignal(false);
  const cancel = () => {
    restoreStudy(snapshot);
    setStudySettings(null);
  };
  const title = () => {
    const st = s();
    if (!st) return '';
    const b = st.builtinId ? builtinById(st.builtinId) : undefined;
    return b ? `${builtinName(b)} (${b.shortTitle})` : studyShortTitle(st);
  };
  return (
    <Show when={s()}>
      <Modal id="study-settings" title={title()} width="460px" onClose={cancel}>
        <div class="study-tabs" role="tablist">
          <For each={TABS}>
            {([id, label]) => (
              <button class="study-tab-btn" role="tab" data-study-tab={id} classList={{ active: tab() === id }} onClick={() => setStudySettings({ uid: props.uid, tab: id })}>
                {label}
              </button>
            )}
          </For>
        </div>
        <div class="study-tab-body">
          <Show when={tab() === 'inputs'}><InputsTab s={s()!} /></Show>
          <Show when={tab() === 'style'}><StyleTab s={s()!} /></Show>
          <Show when={tab() === 'visibility'}><VisibilityTab s={s()!} /></Show>
        </div>
        <div class="study-footer">
          <div class="study-defaults">
            <button id="btn-study-defaults" class="btn-secondary" onClick={() => setDefOpen(!defOpen())}>{tt("Varsayılanlar ▾")}</button>
            <Show when={defOpen()}>
              <div class="pane-menu study-defaults-menu">
                <button id="btn-study-reset" class="pane-menu-item" onClick={() => { resetStudy(props.uid); setDefOpen(false); }}>{tt("Ayarları sıfırla")}</button>
                <Show when={s()!.builtinId}>
                  <button id="btn-study-save-default" class="pane-menu-item" onClick={() => { saveStudyDefaults(props.uid); setDefOpen(false); }}>{tt("Varsayılan olarak kaydet")}</button>
                </Show>
              </div>
            </Show>
          </div>
          <span style={{ flex: '1' }} />
          <button id="btn-study-cancel" class="btn-secondary" onClick={cancel}>{tt("İptal")}</button>
          <button id="btn-study-ok" class="btn-primary" onClick={() => setStudySettings(null)}>{tt("Tamam")}</button>
        </div>
      </Modal>
    </Show>
  );
}
