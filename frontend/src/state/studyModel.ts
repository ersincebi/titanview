import { tt } from './i18n';
/**
 * Faz 20 — grafikteki gösterge örneklerinin (study) saf modeli: stil geçersiz kılma, zaman dilimine göre
 * görünürlük, pane yerleşimi, gösterge üstüne gösterge bağımlılık sırası ve lejant etiketi.
 * Solid/DOM bağımsızdır; `studies.ts` bunu durum + çalıştırma ile birleştirir.
 */
import type { ScriptExecutionResult, ScriptInputDef, ScriptPlotSeries } from '../types/market';

export type PlotStyleKind = ScriptPlotSeries['style'];

export interface PlotStyleOverride {
  visible?: boolean;
  color?: string;
  lineWidth?: number;
  style?: PlotStyleKind;
}

export type VisUnit = 'seconds' | 'minutes' | 'hours' | 'days' | 'weeks' | 'months';
export interface VisRange {
  on: boolean;
  min: number;
  max: number;
}
export type StudyVisibility = Record<VisUnit, VisRange>;

export const VIS_UNITS: Array<{ unit: VisUnit; label: string; max: number }> = [
  { unit: 'seconds', label: tt("Saniye"), max: 59 },
  { unit: 'minutes', label: tt("Dakika"), max: 59 },
  { unit: 'hours', label: tt("Saat"), max: 24 },
  { unit: 'days', label: tt("Gün"), max: 366 },
  { unit: 'weeks', label: tt("Hafta"), max: 52 },
  { unit: 'months', label: 'Ay', max: 12 },
];

export function defaultVisibility(): StudyVisibility {
  const out = {} as StudyVisibility;
  for (const u of VIS_UNITS) out[u.unit] = { on: true, min: 1, max: u.max };
  return out;
}

export type StudyScale = 'right' | 'left' | 'none';

export interface StudyInstance {
  uid: string;
  /** hazır gösterge kimliği (`script/builtins`), yoksa `code` kullanılır (kayıtlı betik) */
  builtinId?: string;
  code?: string;
  /** girdi geçersiz kılmaları (Betik input id veya başlık → değer); kaynak için "@<uid>:<plot>" */
  inputs: Record<string, unknown>;
  plots: Record<string, PlotStyleOverride>;
  hlines: Record<string, { visible?: boolean; color?: string }>;
  fills: Record<string, { visible?: boolean }>;
  bgVisible: boolean;
  visible: boolean;
  /** undefined = otomatik (overlay → ana, değilse kendi pane'i); 'main' = ana panele taşı; 'with:<uid>' = o göstergenin pane'i */
  pane?: string;
  scale: StudyScale;
  /** fiyat ölçeğinde son değer etiketi */
  priceLabels: boolean;
  /** durum satırında (lejant) değerler */
  statusValues: boolean;
  /** -1 = varsayılan */
  precision: number;
  visibility: StudyVisibility;
}

export function newStudyInstance(uid: string, init: Partial<StudyInstance> = {}): StudyInstance {
  return {
    uid,
    inputs: {},
    plots: {},
    hlines: {},
    fills: {},
    bgVisible: true,
    visible: true,
    scale: 'right',
    priceLabels: true,
    statusValues: true,
    precision: -1,
    visibility: defaultVisibility(),
    ...init,
  };
}

/** Bozuk/eski kayıtları güvenli varsayılanlarla tamamlar (localStorage'dan okuma). */
export function normalizeStudy(raw: unknown): StudyInstance | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<StudyInstance>;
  if (typeof r.uid !== 'string' || (!r.builtinId && !r.code)) return null;
  const base = newStudyInstance(r.uid);
  const vis = defaultVisibility();
  for (const u of VIS_UNITS) {
    const v = r.visibility?.[u.unit];
    if (v && typeof v.on === 'boolean') vis[u.unit] = { on: v.on, min: Number(v.min) || 1, max: Number(v.max) || u.max };
  }
  return {
    ...base,
    builtinId: typeof r.builtinId === 'string' ? r.builtinId : undefined,
    code: typeof r.code === 'string' ? r.code : undefined,
    inputs: r.inputs && typeof r.inputs === 'object' ? { ...r.inputs } : {},
    plots: r.plots && typeof r.plots === 'object' ? { ...r.plots } : {},
    hlines: r.hlines && typeof r.hlines === 'object' ? { ...r.hlines } : {},
    fills: r.fills && typeof r.fills === 'object' ? { ...r.fills } : {},
    bgVisible: r.bgVisible !== false,
    visible: r.visible !== false,
    pane: typeof r.pane === 'string' ? r.pane : undefined,
    scale: r.scale === 'left' || r.scale === 'none' ? r.scale : 'right',
    priceLabels: r.priceLabels !== false,
    statusValues: r.statusValues !== false,
    precision: Number.isInteger(r.precision) ? (r.precision as number) : -1,
    visibility: vis,
  };
}

// ------------------------------------------------------------------ zaman dilimi görünürlüğü

/** Uygulama aralığı ("15m", "4h", "1d", "1w", "1M", "30s") → birim + çarpan. */
export function intervalUnit(interval: string): { unit: VisUnit; n: number } | null {
  const m = interval.trim().match(/^(\d+)\s*([smhdwM])$/);
  if (!m) return null;
  const n = Number(m[1]);
  const u: Record<string, VisUnit> = { s: 'seconds', m: 'minutes', h: 'hours', d: 'days', w: 'weeks', M: 'months' };
  return { unit: u[m[2]], n };
}

/** Standart "Görünürlük" sekmesi: göstergenin bu aralıkta çizilip çizilmeyeceği. */
export function visibleOnInterval(vis: StudyVisibility, interval: string): boolean {
  const iu = intervalUnit(interval);
  if (!iu) return true;
  const r = vis[iu.unit];
  return r.on && iu.n >= r.min && iu.n <= r.max;
}

// ------------------------------------------------------------------ bağımlılık (gösterge üstüne gösterge)

export const EXT_PREFIX = '@';

/** "@s3:RSI" → { uid: 's3', plot: 'RSI' } */
export function parseSourceRef(v: unknown): { uid: string; plot: string } | null {
  if (typeof v !== 'string' || !v.startsWith(EXT_PREFIX)) return null;
  const body = v.slice(1);
  const i = body.indexOf(':');
  if (i <= 0) return null;
  return { uid: body.slice(0, i), plot: body.slice(i + 1) };
}

export function sourceRef(uid: string, plot: string): string {
  return `${EXT_PREFIX}${uid}:${plot}`;
}

export function studyDeps(s: StudyInstance): string[] {
  const out = new Set<string>();
  for (const v of Object.values(s.inputs)) {
    const r = parseSourceRef(v);
    if (r && r.uid !== s.uid) out.add(r.uid);
  }
  return [...out];
}

/**
 * Bağımlıları önce gelecek şekilde sıralar. Döngüye giren ya da var olmayan kaynağa bağlı göstergeler
 * `broken` listesine düşer (çağıran kaynak bağlantısını na ile çalıştırır).
 */
export function topoOrder(list: StudyInstance[]): { order: StudyInstance[]; broken: Set<string> } {
  const byId = new Map(list.map((s) => [s.uid, s]));
  const state = new Map<string, 0 | 1 | 2>();
  const order: StudyInstance[] = [];
  const broken = new Set<string>();
  const visit = (s: StudyInstance, stack: string[]): boolean => {
    const st = state.get(s.uid);
    if (st === 2) return !broken.has(s.uid);
    if (st === 1) {
      for (const id of stack.slice(stack.indexOf(s.uid))) broken.add(id);
      return false;
    }
    state.set(s.uid, 1);
    let ok = true;
    for (const d of studyDeps(s)) {
      const dep = byId.get(d);
      if (!dep || !visit(dep, [...stack, s.uid])) ok = false;
    }
    state.set(s.uid, 2);
    if (!ok) broken.add(s.uid);
    order.push(s);
    return ok;
  };
  for (const s of list) visit(s, []);
  return { order, broken };
}

/** `uid`'ye (doğrudan ya da dolaylı) bağlı göstergeler: kaynak seçiminde döngüyü önlemek için hariç tutulur. */
export function dependentsOf(list: StudyInstance[], uid: string): Set<string> {
  const out = new Set<string>();
  let grew = true;
  while (grew) {
    grew = false;
    for (const s of list) {
      if (out.has(s.uid) || s.uid === uid) continue;
      if (studyDeps(s).some((d) => d === uid || out.has(d))) {
        out.add(s.uid);
        grew = true;
      }
    }
  }
  return out;
}

/** Sonuç çizimini grafik barlarına (indeks hizalı) dizi olarak verir: bağlı göstergenin kaynağı. */
export function plotAsSeries(res: ScriptExecutionResult | undefined, plotTitle: string, barTimes: number[]): number[] | undefined {
  const p = res?.ok ? res.plots.find((x) => x.title === plotTitle) : undefined;
  if (!p) return undefined;
  const m = new Map(p.data.map((d) => [d.time, d.value]));
  return barTimes.map((t) => m.get(t) ?? NaN);
}

// ------------------------------------------------------------------ pane yerleşimi

export type StudyPaneId = 'main' | `study:${string}`;

/** Her görünür göstergenin çizileceği pane. `results` overlay bayrağını verir. */
export function resolvePanes(list: StudyInstance[], overlayOf: (uid: string) => boolean | undefined): Map<string, StudyPaneId> {
  const byId = new Map(list.map((s) => [s.uid, s]));
  const out = new Map<string, StudyPaneId>();
  const resolve = (s: StudyInstance, depth: number): StudyPaneId => {
    const hit = out.get(s.uid);
    if (hit) return hit;
    let pane: StudyPaneId;
    if (s.pane === 'main') pane = 'main';
    else if (s.pane === 'new') pane = `study:${s.uid}`;
    else if (s.pane?.startsWith('with:') && depth < 8) {
      const host = byId.get(s.pane.slice(5));
      pane = host && host.uid !== s.uid ? resolve(host, depth + 1) : overlayOf(s.uid) ? 'main' : `study:${s.uid}`;
    } else pane = overlayOf(s.uid) ? 'main' : `study:${s.uid}`;
    out.set(s.uid, pane);
    return pane;
  };
  for (const s of list) resolve(s, 0);
  return out;
}

// ------------------------------------------------------------------ stil uygulama

/**
 * Stil sekmesindeki geçersiz kılmaları sonuca uygular. `onMain` = gösterge ana fiyat paneline çiziliyor
 * (overlay olmayan bir gösterge ana panele taşınmış olabilir) → tüm görseller overlay işaretlenir.
 */
export function applyStudyStyle(res: ScriptExecutionResult, s: StudyInstance, onMain: boolean): ScriptExecutionResult {
  if (!res.ok) return res;
  // pane yerleşimi kararı overlay bayrağını belirler: ana pane'deyse her şey overlay, kendi pane'indeyse hiçbiri
  const ov = (isOverlay: boolean) => (void isOverlay, onMain);
  const plots = res.plots.map((p) => {
    const st = s.plots[p.title] ?? {};
    const recolor = st.color !== undefined;
    return {
      ...p,
      isOverlay: ov(p.isOverlay),
      hidden: p.hidden || st.visible === false,
      color: st.color ?? p.color,
      lineWidth: st.lineWidth ?? p.lineWidth,
      style: st.style ?? p.style,
      data: recolor ? p.data.map((d) => (d.color ? { time: d.time, value: d.value } : d)) : p.data,
    };
  });
  const hlines = res.hlines
    .filter((h) => s.hlines[h.title]?.visible !== false)
    .map((h) => ({ ...h, color: s.hlines[h.title]?.color ?? h.color }));
  const fills = (res.fills ?? []).filter((f) => s.fills[f.title]?.visible !== false).map((f) => ({ ...f, isOverlay: ov(f.isOverlay) }));
  const bgcolors = s.bgVisible ? (res.bgcolors ?? []).map((b) => ({ ...b, isOverlay: ov(b.isOverlay) })) : [];
  const ohlcPlots = (res.ohlcPlots ?? [])
    .filter((o) => s.plots[o.title]?.visible !== false)
    .map((o) => ({ ...o, isOverlay: ov(o.isOverlay) }));
  const markers = res.markers.filter((m) => {
    // plotshape başlıkları marker metninde yok; tümü "Şekiller" görünürlüğüne bağlı
    void m;
    return s.plots['__shapes']?.visible !== false;
  });
  return {
    ...res,
    isOverlay: onMain,
    plots,
    hlines,
    fills,
    bgcolors,
    ohlcPlots,
    markers,
    barcolors: s.plots['__barcolor']?.visible === false ? [] : res.barcolors,
    drawings: s.plots['__drawings']?.visible === false ? undefined : res.drawings,
  };
}

// ------------------------------------------------------------------ lejant

/** Standart lejantı: "RSI 14 close" — görüntülenen (display ≠ none) girdi değerleri kısa başlığın ardından. */
export function legendLabel(shortTitle: string, inputs: ScriptInputDef[] | undefined, titleOf: (ref: { uid: string; plot: string }) => string): string {
  const parts: string[] = [];
  for (const d of inputs ?? []) {
    // Varsayılan: yalnız durum satırında gösterilmesi istenen girdiler (display.status_line = 4; varsayılan display.all)
    if (d.display !== undefined && (d.display & 4) === 0) continue;
    if (d.type === 'bool' || d.type === 'color' || d.type === 'text_area' || d.type === 'time') continue;
    const v = d.value !== undefined ? d.value : d.defval;
    if (v === undefined || v === null || v === '') continue;
    const ref = parseSourceRef(v);
    if (ref) parts.push(titleOf(ref));
    else if (typeof v === 'number') parts.push(String(Number(v.toFixed(6))));
    else parts.push(String(v));
    if (parts.length >= 6) break;
  }
  return parts.length ? `${shortTitle} ${parts.join(' ')}` : shortTitle;
}

/** Hover zamanındaki (yoksa son) değer. */
export function valueAt(p: ScriptPlotSeries, time: number | null): { value: number; color: string } | null {
  if (p.data.length === 0) return null;
  if (time === null) {
    const d = p.data[p.data.length - 1];
    return { value: d.value, color: d.color ?? p.color };
  }
  let lo = 0;
  let hi = p.data.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const t = p.data[mid].time;
    if (t === time) return { value: p.data[mid].value, color: p.data[mid].color ?? p.color };
    if (t < time) lo = mid + 1;
    else hi = mid - 1;
  }
  return null;
}

export function formatStudyValue(v: number, precision: number): string {
  if (!Number.isFinite(v)) return '∅';
  if (precision >= 0) return v.toFixed(precision);
  const a = Math.abs(v);
  // Varsayılan: fiyat ölçeğindeki değerler tam yazılır; yalnız hacim büyüklüğündeki değerler kısaltılır
  if (a >= 1e9) return `${(v / 1e9).toFixed(3)}B`;
  if (a >= 1e7) return `${(v / 1e6).toFixed(3)}M`;
  return v.toFixed(a >= 1 ? 2 : a >= 0.01 ? 4 : 6);
}
