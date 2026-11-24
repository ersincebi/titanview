import { tfmt } from './i18n';
import { tt } from './i18n';
/**
 * Faz 20 — grafikteki gösterge örnekleri ("study"): hazır `.titan` göstergeleri ya da kayıtlı betikler,
 * her biri kendi girdi/stil/görünürlük ayarıyla. Gösterge üstüne gösterge: bir girdinin kaynağı başka bir
 * örneğin çıktısıdır ("@uid:plot"); çalıştırma bağımlılık sırasıyla yapılır. Kalıcı (localStorage).
 */
import { batch, createSignal } from 'solid-js';
import { createStore, produce, reconcile } from 'solid-js/store';
import { pushHistory } from './history';
import { fetchHistory } from '../api/client';
import { BUILTINS, builtinById } from '../script/builtins';
import { runScriptWorker } from '../script/scriptClient';
import { executeScript, scriptRunOptions, scriptTimeframeToApi, type RunOptions } from '../script/runtime';
import type { Candle, ScriptExecutionResult, ScriptInputDef, Timeframe } from '../types/market';
import {
  applyStudyStyle,
  dependentsOf,
  newStudyInstance,
  normalizeStudy,
  parseSourceRef,
  plotAsSeries,
  resolvePanes,
  sourceRef,
  topoOrder,
  visibleOnInterval,
  legendLabel,
  type PlotStyleOverride,
  type StudyInstance,
  type StudyPaneId,
  type StudyVisibility,
} from './studyModel';
import { onScriptRun, scriptBars, setScriptPickTarget, setStudyPickHandler, toast, ui, type ScriptPickTarget } from './store';

export const STUDIES_KEY = 'titanview_studies_v1';
export const STUDY_DEFAULTS_KEY = 'titanview_study_defaults_v1';
export const FAV_IND_KEY = 'titanview_fav_indicators_v1';
export const STUDY_TEMPLATES_KEY = 'titanview_study_templates_v1';

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function writeJson(key: string, v: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    // depolama dolu/erişilemez: oturum içinde çalışmaya devam
  }
}

function loadStudies(): StudyInstance[] {
  const raw = readJson<unknown[]>(STUDIES_KEY, []);
  return Array.isArray(raw) ? raw.map(normalizeStudy).filter((x): x is StudyInstance => x !== null) : [];
}

export const [studies, setStudies] = createStore<{ list: StudyInstance[] }>({ list: loadStudies() });
/** uid → son çalıştırma sonucu (stil uygulanmamış ham sonuç) */
export const [studyResults, setStudyResults] = createSignal<Record<string, ScriptExecutionResult>>({});
/** Ayar penceresi: hangi gösterge, hangi sekme */
export const [studySettings, setStudySettings] = createSignal<{ uid: string; tab: 'inputs' | 'style' | 'visibility' } | null>(null);
/** Göstergeler penceresi "gösterge üstüne gösterge" modunda açıldıysa ebeveyn uid */
export const [fxParent, setFxParent] = createSignal<string | null>(null);
export const [favoriteIndicators, setFavoriteIndicators] = createSignal<string[]>(readJson<string[]>(FAV_IND_KEY, []));

const persist = () => writeJson(STUDIES_KEY, studies.list);

function nextUid(): string {
  let n = 1;
  const used = new Set(studies.list.map((s) => s.uid));
  while (used.has(`s${n}`)) n++;
  return `s${n}`;
}

export function studyCode(s: StudyInstance): string | undefined {
  return s.builtinId ? builtinById(s.builtinId)?.code ?? s.code : s.code;
}

export function studyById(uid: string): StudyInstance | undefined {
  return studies.list.find((s) => s.uid === uid);
}

/** Kısa başlık: hazır göstergede katalogdan, değilse son sonuçtan. */
export function studyShortTitle(s: StudyInstance): string {
  const b = s.builtinId ? builtinById(s.builtinId) : undefined;
  return b?.shortTitle ?? studyResults()[s.uid]?.scriptTitle ?? s.uid;
}

/** Lejant etiketi ("RSI 14 close", kaynak başka göstergeyse "RSI 14 EMA: EMA"). */
export function studyLabel(s: StudyInstance): string {
  const res = studyResults()[s.uid];
  return legendLabel(studyShortTitle(s), res?.inputs, (ref) => {
    const host = studyById(ref.uid);
    return host ? `${studyShortTitle(host)}: ${ref.plot}` : `${ref.uid}: ${ref.plot}`;
  });
}

// ------------------------------------------------------------------ çalıştırma

let runSeq = 0;
const symbolCache = new Map<string, Candle[]>();
const lowerTfCache = new Map<string, Candle[]>();

function errorResult(title: string, msg: string): ScriptExecutionResult {
  return { ok: false, scriptTitle: title, isStrategy: false, isOverlay: true, executionMs: 0, error: msg, plots: [], markers: [], hlines: [] };
}

async function exec(i: number, code: string, bars: Candle[], opts: RunOptions): Promise<ScriptExecutionResult> {
  const j = runScriptWorker(2 + i, code, bars, opts);
  return 'sync' in j ? j.sync : j.async;
}

/** request.security / security_lower_tf ile istenip verilmeyen gerçek veriyi çeker (hata → boş dizi, döngü yok). */
async function fetchMissing(res: ScriptExecutionResult, bars: Candle[]): Promise<void> {
  const tasks: Promise<unknown>[] = [];
  for (const sym of res.missingSymbols ?? []) {
    const key = `${sym}|${ui.interval}`;
    if (symbolCache.has(key)) continue;
    tasks.push(
      fetchHistory(sym, ui.interval)
        .then((r) => symbolCache.set(key, r.candles ?? []))
        .catch(() => symbolCache.set(key, []))
    );
  }
  const from = bars.length ? bars[0].time : undefined;
  const to = bars.length ? bars[bars.length - 1].time + 86_400 : undefined;
  for (const tf of res.missingLowerTfs ?? []) {
    const key = `${ui.symbol}|${tf}`;
    if (lowerTfCache.has(key)) continue;
    const api = scriptTimeframeToApi(tf);
    if (!api) {
      lowerTfCache.set(key, []);
      continue;
    }
    tasks.push(
      fetchHistory(ui.symbol, api as Timeframe, from, to)
        .then((r) => lowerTfCache.set(key, r.candles ?? []))
        .catch(() => lowerTfCache.set(key, []))
    );
  }
  await Promise.all(tasks);
}

function symbolCandles(): Record<string, Candle[]> | undefined {
  const out: Record<string, Candle[]> = {};
  const suffix = `|${ui.interval}`;
  for (const [k, v] of symbolCache) if (k.endsWith(suffix)) out[k.slice(0, -suffix.length)] = v;
  return Object.keys(out).length ? out : undefined;
}

function lowerTfCandles(): Record<string, Candle[]> | undefined {
  const out: Record<string, Candle[]> = {};
  const prefix = `${ui.symbol}|`;
  for (const [k, v] of lowerTfCache) if (k.startsWith(prefix)) out[k.slice(prefix.length)] = v;
  return Object.keys(out).length ? out : undefined;
}

/** Tüm gösterge örneklerini bağımlılık sırasıyla çalıştırır; yalnızca en son istek sonucu yazar. */
export function runStudies(): Promise<void> {
  const my = ++runSeq;
  const list: StudyInstance[] = JSON.parse(JSON.stringify(studies.list));
  if (list.length === 0) {
    setStudyResults({});
    return Promise.resolve();
  }
  const bars = scriptBars();
  if (bars.length === 0) return Promise.resolve();
  const base = scriptRunOptions(ui.symbol, ui.interval, bars);
  const times = bars.map((b) => b.time);
  const { order, broken } = topoOrder(list);
  const out: Record<string, ScriptExecutionResult> = {};

  const optsFor = (s: StudyInstance): RunOptions => {
    const ext: Record<string, number[]> = {};
    const inputs: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(s.inputs)) {
      const ref = parseSourceRef(v);
      if (ref) {
        const ser = broken.has(s.uid) ? undefined : plotAsSeries(out[ref.uid], ref.plot, times);
        if (ser) ext[`${ref.uid}:${ref.plot}`] = ser;
      }
      inputs[k] = v;
    }
    const o: RunOptions = { ...base };
    if (Object.keys(inputs).length) o.inputOverrides = inputs;
    if (Object.keys(ext).length) o.externalSources = ext;
    const sc = symbolCandles();
    if (sc) o.symbolCandles = sc;
    const lc = lowerTfCandles();
    if (lc) o.lowerTfCandles = lc;
    return o;
  };

  return (async () => {
    for (let i = 0; i < order.length; i++) {
      const s = order[i];
      const code = studyCode(s);
      if (!code) {
        out[s.uid] = errorResult(s.builtinId ?? s.uid, `Gösterge bulunamadı: ${s.builtinId ?? s.uid}`);
        continue;
      }
      let r = await exec(i, code, bars, optsFor(s));
      if (my !== runSeq) return;
      if (r.ok && ((r.missingSymbols?.length ?? 0) > 0 || (r.missingLowerTfs?.length ?? 0) > 0)) {
        await fetchMissing(r, bars);
        if (my !== runSeq) return;
        r = await exec(i, code, bars, optsFor(s));
        if (my !== runSeq) return;
      }
      if (broken.has(s.uid) && r.ok) r = { ...r, warnings: [...(r.warnings ?? []), 'Kaynak gösterge döngüsü ya da silinmiş kaynak: bağlantı na olarak çalıştı.'] };
      out[s.uid] = r;
    }
    if (my === runSeq) setStudyResults(out);
  })();
}

onScriptRun(() => void runStudies());

// ------------------------------------------------------------------ çizim listesi

export interface StudyRenderItem {
  uid: string;
  pane: StudyPaneId;
  label: string;
  result: ScriptExecutionResult;
  scale: StudyInstance['scale'];
  priceLabels: boolean;
  statusValues: boolean;
  precision: number;
}

/** Görünür + bu aralıkta görünür + başarılı göstergeler, stil uygulanmış ve pane'i çözülmüş. */
export function studyRenderList(): StudyRenderItem[] {
  const res = studyResults();
  const panes = resolvePanes(studies.list, (uid) => res[uid]?.isOverlay);
  const out: StudyRenderItem[] = [];
  for (const s of studies.list) {
    const r = res[s.uid];
    if (!r?.ok || !s.visible || !visibleOnInterval(s.visibility, ui.interval)) continue;
    const pane = panes.get(s.uid) ?? 'main';
    out.push({
      uid: s.uid,
      pane,
      label: studyLabel(s),
      result: applyStudyStyle(r, s, pane === 'main'),
      scale: s.scale,
      priceLabels: s.priceLabels,
      statusValues: s.statusValues,
      precision: s.precision,
    });
  }
  return out;
}

export function studyPaneOf(uid: string): StudyPaneId | undefined {
  const res = studyResults();
  return resolvePanes(studies.list, (u) => res[u]?.isOverlay).get(uid);
}

// ------------------------------------------------------------------ değişiklikler

function mutate(uid: string, fn: (s: StudyInstance) => void, rerun = true): void {
  setStudies(
    'list',
    (s) => s.uid === uid,
    produce((s) => fn(s))
  );
  persist();
  if (rerun) void runStudies();
}

function defaultsFor(builtinId: string): Partial<StudyInstance> {
  const all = readJson<Record<string, Partial<StudyInstance>>>(STUDY_DEFAULTS_KEY, {});
  const d = all[builtinId];
  return d ? JSON.parse(JSON.stringify(d)) : {};
}

/** Girdileri (ilk birkaç barla) okur: kaynak girdisini bulmak için ucuz ön çalıştırma. */
export function probeInputs(code: string): ScriptInputDef[] {
  const bars = scriptBars().slice(-60);
  if (bars.length === 0) return [];
  const r = executeScript(code, bars, scriptRunOptions(ui.symbol, ui.interval, bars));
  return r.inputs ?? [];
}

/**
 * Gösterge ekler (varsayılan: her tıklama yeni örnek). `parentUid` verilirse ilk `input.source` girdisi ebeveynin
 * ilk çizimine bağlanır ve aynı pane'e yerleşir (gösterge üstüne gösterge).
 */
export function addStudy(src: { builtinId: string } | { code: string }, parentUid?: string | null): string | null {
  const uid = nextUid();
  const init: Partial<StudyInstance> = 'builtinId' in src ? { builtinId: src.builtinId, ...defaultsFor(src.builtinId) } : { code: src.code };
  const code = 'builtinId' in src ? builtinById(src.builtinId)?.code : src.code;
  if (!code) return null;
  const s = newStudyInstance(uid, init);
  if (parentUid) {
    const parent = studyById(parentUid);
    const pres = studyResults()[parentUid];
    const plot = pres?.plots.find((p) => !p.hidden && p.data.length > 0) ?? pres?.plots[0];
    const srcInput = probeInputs(code).find((d) => d.type === 'source');
    if (parent && plot && srcInput) {
      s.inputs[srcInput.id ?? srcInput.title] = sourceRef(parentUid, plot.title);
      s.pane = `with:${parentUid}`;
    } else {
      toast(tt("Bu göstergenin kaynak (source) girdisi yok; ayrı eklendi"));
    }
  }
  const prevSnap = JSON.parse(JSON.stringify(studies.list)) as StudyInstance[];
  batch(() => {
    setStudies('list', (l) => [...l, s]);
  });
  const nextSnap = JSON.parse(JSON.stringify(studies.list)) as StudyInstance[];
  const lbl = studyLabel(s);
  pushHistory({
    labelTr: `Gösterge ekle (${lbl})`,
    labelEn: `Add indicator (${lbl})`,
    undo: () => {
      setStudies('list', reconcile(JSON.parse(JSON.stringify(prevSnap))));
      persist();
      void runStudies();
    },
    redo: () => {
      setStudies('list', reconcile(JSON.parse(JSON.stringify(nextSnap))));
      persist();
      void runStudies();
    },
  });
  persist();
  void runStudies().then(() => armConfirmPick(uid));
  return uid;
}

/** input.time/price `confirm=true` ise varsayılan olarak eklenir eklenmez grafikten seçim ister (ör. Çapalı VWAP). */
function armConfirmPick(uid: string): void {
  const s = studyById(uid);
  const res = studyResults()[uid];
  if (!s || !res?.inputs) return;
  const pending = res.inputs.find((d) => d.confirm && (d.type === 'time' || d.type === 'price') && s.inputs[d.id ?? d.title] === undefined);
  if (pending) startStudyPick(uid, pending);
}

export function startStudyPick(uid: string, def: ScriptInputDef): void {
  const key = def.id ?? def.title;
  const target: ScriptPickTarget = { inputKey: key, inputTitle: def.title, kind: def.type === 'time' ? 'time' : 'price', studyUid: uid };
  setScriptPickTarget(target);
  toast(tfmt("🎯 Grafikte tıklayarak \"{0}\" seçin", def.title));
}

setStudyPickHandler((target, timeSec, price) => {
  const uid = target.studyUid!;
  if (!studyById(uid)) return false;
  if (target.kind === 'time' && timeSec !== null && Number.isFinite(timeSec)) {
    setStudyInput(uid, target.inputKey, Math.round(timeSec * 1000));
  } else if (target.kind === 'price' && price !== null && Number.isFinite(price)) {
    setStudyInput(uid, target.inputKey, Number(price.toFixed(4)));
  } else return false;
  toast(tfmt("✓ \"{0}\" grafikten seçildi", target.inputTitle));
  return true;
});

/** Göstergeyi ve ona bağlı (kaynağı bu olan) göstergeleri kaldırır. */
export function removeStudy(uid: string): void {
  const prevSnap = JSON.parse(JSON.stringify(studies.list)) as StudyInstance[];
  const removed = studyById(uid);
  const deps = dependentsOf(studies.list, uid);
  setStudies('list', (l) => l.filter((s) => s.uid !== uid && !deps.has(s.uid)));
  const nextSnap = JSON.parse(JSON.stringify(studies.list)) as StudyInstance[];
  if (removed) {
    const lbl = studyLabel(removed);
    pushHistory({
      labelTr: `Gösterge kaldır (${lbl})`,
      labelEn: `Remove indicator (${lbl})`,
      undo: () => {
        setStudies('list', reconcile(JSON.parse(JSON.stringify(prevSnap))));
        persist();
        void runStudies();
      },
      redo: () => {
        setStudies('list', reconcile(JSON.parse(JSON.stringify(nextSnap))));
        persist();
        void runStudies();
      },
    });
  }
  if (studySettings()?.uid === uid || (studySettings() && deps.has(studySettings()!.uid))) setStudySettings(null);
  persist();
  if (deps.size > 0) toast(tfmt("Bağlı {0} gösterge de kaldırıldı", deps.size));
  void runStudies();
}

export function removeStudiesInPane(paneId: string): void {
  const res = studyResults();
  const panes = resolvePanes(studies.list, (u) => res[u]?.isOverlay);
  for (const s of [...studies.list]) if (panes.get(s.uid) === paneId && studyById(s.uid)) removeStudy(s.uid);
}

export function clearStudies(): void {
  setStudies('list', []);
  setStudySettings(null);
  persist();
  void runStudies();
}

export function setStudyInput(uid: string, key: string, v: unknown): void {
  mutate(uid, (s) => {
    s.inputs[key] = v;
  });
}

export function setPlotStyle(uid: string, title: string, patch: PlotStyleOverride): void {
  mutate(
    uid,
    (s) => {
      s.plots[title] = { ...(s.plots[title] ?? {}), ...patch };
    },
    false
  );
}

export function setHlineStyle(uid: string, title: string, patch: { visible?: boolean; color?: string }): void {
  mutate(uid, (s) => (s.hlines[title] = { ...(s.hlines[title] ?? {}), ...patch }), false);
}

export function setFillVisible(uid: string, title: string, visible: boolean): void {
  mutate(uid, (s) => (s.fills[title] = { visible }), false);
}

export function updateStudy(uid: string, patch: Partial<Pick<StudyInstance, 'bgVisible' | 'scale' | 'priceLabels' | 'statusValues' | 'precision' | 'visible' | 'pane'>>): void {
  mutate(uid, (s) => Object.assign(s, patch), false);
}

export function setStudyVisibility(uid: string, vis: StudyVisibility): void {
  mutate(uid, (s) => (s.visibility = JSON.parse(JSON.stringify(vis))), false);
}

export function toggleStudyVisible(uid: string): void {
  const s = studyById(uid);
  if (s) updateStudy(uid, { visible: !s.visible });
}

/** 'main' | 'new' | 'with:<uid>' | undefined (otomatik) */
export function moveStudyPane(uid: string, pane: string | undefined): void {
  if (pane === `with:${uid}`) return;
  updateStudy(uid, { pane });
}

export function duplicateStudy(uid: string): string | null {
  const s = studyById(uid);
  if (!s) return null;
  const copy: StudyInstance = { ...JSON.parse(JSON.stringify(s)), uid: nextUid() };
  setStudies('list', (l) => [...l, copy]);
  persist();
  void runStudies();
  return copy.uid;
}

/** Ayar penceresi "İptal": açılıştaki kopyaya döner. */
export function restoreStudy(snapshot: StudyInstance): void {
  setStudies('list', (s) => s.uid === snapshot.uid, JSON.parse(JSON.stringify(snapshot)));
  persist();
  void runStudies();
}

/** "Varsayılanlar → Sıfırla": girdi + stil + görünürlük hazır gösterge tanımına döner. */
export function resetStudy(uid: string): void {
  const s = studyById(uid);
  if (!s) return;
  restoreStudy(newStudyInstance(uid, { builtinId: s.builtinId, code: s.code, pane: s.pane }));
}

/** "Varsayılan olarak kaydet": bu hazır göstergenin yeni örnekleri bu ayarlarla başlar. */
export function saveStudyDefaults(uid: string): void {
  const s = studyById(uid);
  if (!s?.builtinId) return;
  const all = readJson<Record<string, Partial<StudyInstance>>>(STUDY_DEFAULTS_KEY, {});
  const inputs = Object.fromEntries(Object.entries(s.inputs).filter(([, v]) => !parseSourceRef(v)));
  all[s.builtinId] = JSON.parse(
    JSON.stringify({ inputs, plots: s.plots, hlines: s.hlines, fills: s.fills, bgVisible: s.bgVisible, scale: s.scale, priceLabels: s.priceLabels, statusValues: s.statusValues, precision: s.precision, visibility: s.visibility })
  );
  writeJson(STUDY_DEFAULTS_KEY, all);
  toast(tfmt("✓ \"{0}\" varsayılanları kaydedildi", studyShortTitle(s)));
}

// ------------------------------------------------------------------ favoriler ve şablonlar

export function toggleFavoriteIndicator(id: string): void {
  const cur = favoriteIndicators();
  const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
  setFavoriteIndicators(next);
  writeJson(FAV_IND_KEY, next);
}

export function favoriteBuiltins() {
  const fav = new Set(favoriteIndicators());
  return BUILTINS.filter((b) => fav.has(b.id));
}

export interface StudyTemplate {
  name: string;
  studies: StudyInstance[];
}

export const [studyTemplates, setStudyTemplates] = createSignal<StudyTemplate[]>(readJson<StudyTemplate[]>(STUDY_TEMPLATES_KEY, []));

export function saveStudyTemplate(name: string): boolean {
  const n = name.trim();
  if (!n || studies.list.length === 0) return false;
  const next = [...studyTemplates().filter((t) => t.name !== n), { name: n, studies: JSON.parse(JSON.stringify(studies.list)) }];
  setStudyTemplates(next);
  writeJson(STUDY_TEMPLATES_KEY, next);
  toast(tfmt("✓ \"{0}\" gösterge şablonu kaydedildi ({1} gösterge)", n, studies.list.length));
  return true;
}

export function applyStudyTemplate(name: string): void {
  const t = studyTemplates().find((x) => x.name === name);
  if (!t) return;
  setStudies('list', t.studies.map(normalizeStudy).filter((x): x is StudyInstance => x !== null));
  setStudySettings(null);
  persist();
  toast(tfmt("✨ \"{0}\" şablonu uygulandı", name));
  void runStudies();
}

export function deleteStudyTemplate(name: string): void {
  const next = studyTemplates().filter((t) => t.name !== name);
  setStudyTemplates(next);
  writeJson(STUDY_TEMPLATES_KEY, next);
}

/** Test yardımcı: modül durumunu sıfırlar. */
export function _resetStudies(): void {
  runSeq++;
  symbolCache.clear();
  lowerTfCache.clear();
  setStudies('list', []);
  setStudyResults({});
  setStudySettings(null);
  setFxParent(null);
  setFavoriteIndicators([]);
  setStudyTemplates([]);
}
