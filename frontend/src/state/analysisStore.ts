import { createSignal } from 'solid-js';
import {
  fetchAnalysis,
  fetchFlow,
  fetchRelated,
  type AnalysisResponse,
  type FlowResponse,
  type RelatedResponse,
} from '../api/client';
import { ui } from './store';

export interface Remote<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}
const idle = <T,>(): Remote<T> => ({ data: null, loading: false, error: null });
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export const [analysis, setAnalysis] = createSignal<Remote<AnalysisResponse>>(idle());
export const [related, setRelated] = createSignal<Remote<RelatedResponse>>(idle());
export const [flow, setFlow] = createSignal<Remote<FlowResponse>>(idle());

let token = 0;
let timer: ReturnType<typeof setTimeout> | undefined;

type Setter<T> = (v: Remote<T> | ((p: Remote<T>) => Remote<T>)) => void;

/** Yarış koşulu yok: sonradan başlayan istek, eskisinin sonucunu çöpe atar. Sembol değişince eski veri anında silinir. */
function track<T>(my: number, symbol: string, set: Setter<T>, pick: (d: T) => string | undefined, job: () => Promise<T>): Promise<void> {
  set((p) => ({ data: p.data && pick(p.data) === symbol ? p.data : null, loading: true, error: null }));
  let pending: Promise<T>;
  try {
    pending = Promise.resolve(job());
  } catch (e) {
    pending = Promise.reject(e);
  }
  return pending.then(
    (data) => {
      if (my === token) set({ data, loading: false, error: null });
    },
    (e) => {
      if (my === token) set({ data: null, loading: false, error: msg(e) });
    }
  );
}

export function loadAnalysis(symbol: string = ui.symbol): Promise<unknown> {
  const my = ++token;
  softAt = 0;
  const norm = symbol.toUpperCase();
  return Promise.all([
    track(my, norm, setAnalysis as Setter<AnalysisResponse>, (d) => d.info?.symbol?.toUpperCase(), () => fetchAnalysis(symbol)),
    track(my, norm, setRelated as Setter<RelatedResponse>, () => norm, () => fetchRelated(symbol)),
    track(my, norm, setFlow as Setter<FlowResponse>, () => norm, () => fetchFlow(symbol)),
  ]).then((v) => {
    if (my === token) setAnalysisUpdatedAt(Date.now());
    return v;
  });
}

export const [analysisUpdatedAt, setAnalysisUpdatedAt] = createSignal(0);

const SOFT_MIN_MS = 10_000;
const LIVE_EVERY_MS = 30_000;
let softBusy = false;
let softAt = 0;

/**
 * Sessiz yenileme: ekran yanıp sönmez (yükleniyor durumuna geçmez, eski veri yerinde kalır), hata
 * eskiyi silmez. Sembol değiştiyse sonuç atılır. En fazla 10 sn'de bir.
 */
export async function refreshAnalysisSoft(symbol: string = ui.symbol): Promise<void> {
  const now = Date.now();
  if (softBusy || !symbol || now - softAt < SOFT_MIN_MS) return;
  softBusy = true;
  softAt = now;
  const norm = symbol.toUpperCase();
  const my = token;
  try {
    const [a, r, f] = await Promise.allSettled([
      (async () => fetchAnalysis(symbol))(),
      (async () => fetchRelated(symbol))(),
      (async () => fetchFlow(symbol))(),
    ]);
    if (my !== token || ui.symbol.toUpperCase() !== norm) return;
    if (a.status === 'fulfilled') setAnalysis({ data: a.value, loading: false, error: null });
    if (r.status === 'fulfilled') setRelated({ data: r.value, loading: false, error: null });
    if (f.status === 'fulfilled') setFlow({ data: f.value, loading: false, error: null });
    if (a.status === 'fulfilled') setAnalysisUpdatedAt(Date.now());
  } finally {
    softBusy = false;
  }
}

let liveStop: (() => void) | undefined;
/** 30 sn döngü + sekme görünür olunca tazele. Tek örnek. */
export function startAnalysisLive(): () => void {
  if (liveStop) return liveStop;
  const id = setInterval(() => {
    if (!document.hidden) void refreshAnalysisSoft();
  }, LIVE_EVERY_MS);
  const vis = () => {
    if (!document.hidden) void refreshAnalysisSoft();
  };
  document.addEventListener('visibilitychange', vis);
  liveStop = () => {
    clearInterval(id);
    document.removeEventListener('visibilitychange', vis);
    liveStop = undefined;
  };
  return liveStop;
}

/** Sembol değişince (250 ms sakinleşince) analiz kendiliğinden yenilenir. */
export function scheduleAnalysis(symbol: string): void {
  clearTimeout(timer);
  if (!symbol) return;
  timer = setTimeout(() => void loadAnalysis(symbol), 250);
}

// ---------- bölüm açık/kapalı (yerel tercih) ----------
const KEY = 'titanview_analysis_sections_v1';
function readOpen(): Record<string, boolean> {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return raw && typeof raw === 'object' ? raw : {};
  } catch {
    return {};
  }
}
export const [sectionState, setSectionState] = createSignal<Record<string, boolean>>(readOpen());
export function toggleSection(id: string, defaultOpen: boolean): void {
  const cur = sectionState()[id] ?? defaultOpen;
  const next = { ...sectionState(), [id]: !cur };
  setSectionState(next);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // depolama kapalı
  }
}
