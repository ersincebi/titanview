import { tfmt, tt } from './i18n';
import { nativeNotify } from '../desktop/remote';
/**
 * Faz 23 — sunucu alarmlarının arayüz durumu: liste, günlük, SSE akışı, açılır pencere/ses/Bildirim,
 * Web Push aboneliği ve alarm penceresi taslağı. Değerlendirme sunucuda; tarayıcı kapalıyken de çalışır.
 */
import { createSignal } from 'solid-js';
import {
  alertAction,
  bulkAlertAction,
  clearAlertLog,
  createAlertApi,
  deleteAlertApi,
  deletePushSubscription,
  fetchAlertConfig,
  fetchAlertLog,
  fetchPushKey,
  listAlerts,
  savePushSubscription,
  updateAlertApi,
  type AlertConfig,
  type BulkAction,
} from '../api/alerts';
import {
  drawingGeometry,
  migrateLegacyAlerts,
  priceAlertDraft,
  studyRef,
  validateDraft,
  type AlertDraft,
  type AlertLogEntry,
  type ServerAlert,
} from './alerts';
import { candles, lastCandle, switchSymbol, toast, ui } from './store';
import { studyById, studyCode, studyResults, studyShortTitle } from './studies';
import type { DrawingObject, PriceAlert } from '../types/market';
import { TOOL_LABELS } from '../chart/drawing/toolSpec';

export const [serverAlerts, setServerAlerts] = createSignal<ServerAlert[]>([]);
export const [alertLog, setAlertLog] = createSignal<AlertLogEntry[]>([]);
export const [alertConfig, setAlertConfig] = createSignal<AlertConfig | null>(null);
export const [alertsError, setAlertsError] = createSignal<string | null>(null);
/** Açık alarm penceresi: taslak + düzenlenen alarm kimliği. */
export const [alertDialog, setAlertDialog] = createSignal<{ draft: AlertDraft; editId?: string; tab?: 'settings' | 'notify'; note?: string } | null>(null);
/** "Açılır pencere" bildirimi (alarm popup'ı). */
export const [alertPopup, setAlertPopup] = createSignal<AlertLogEntry[]>([]);
export type PushState = 'unsupported' | 'off' | 'on' | 'denied' | 'busy';
export const [pushState, setPushState] = createSignal<PushState>('off');

const STEP: Record<string, number> = { '1m': 60, '3m': 180, '5m': 300, '15m': 900, '30m': 1800, '1h': 3600, '4h': 14400, '1d': 86400, '1w': 604800 };
export const intervalSeconds = (tf: string): number => STEP[tf] ?? 900;

export async function refreshAlerts(): Promise<void> {
  try {
    setServerAlerts(await listAlerts());
    setAlertsError(null);
  } catch (e) {
    setAlertsError(e instanceof Error ? e.message : String(e));
  }
}

export async function refreshAlertLog(): Promise<void> {
  try {
    setAlertLog(await fetchAlertLog(0, 200));
  } catch {
    /* liste hatası refreshAlerts'te görünür */
  }
}

export async function refreshAlertConfig(): Promise<void> {
  try {
    setAlertConfig(await fetchAlertConfig());
  } catch {
    setAlertConfig(null);
  }
}

// ---------------------------------------------------------------- tetiklenme bildirimi

const seen = new Set<number>();

/** Kısa "ding" (WebAudio; tarayıcı izin vermezse sessiz). */
export function playAlertSound(): void {
  try {
    const AC = (window as unknown as { AudioContext?: typeof AudioContext }).AudioContext;
    if (!AC) return;
    const ctx = new AC();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(880, ctx.currentTime);
    o.frequency.setValueAtTime(1320, ctx.currentTime + 0.12);
    g.gain.setValueAtTime(0.15, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.5);
  } catch {
    /* ses yok */
  }
}

/** SSE'den gelen bir günlük kaydını işler (ilk geliş: bildirim; ikinci geliş: teslim sonuçları). */
export function handleAlertEvent(e: AlertLogEntry): void {
  setAlertLog((list) => {
    const i = list.findIndex((x) => x.id === e.id);
    if (i >= 0) {
      const next = list.slice();
      next[i] = e;
      return next;
    }
    return [e, ...list].slice(0, 500);
  });
  if (seen.has(e.id)) return;
  seen.add(e.id);
  if (e.notify.app) toast(`🔔 ${e.name || e.symbol}: ${e.message}`);
  // Faz 33: uzak sunucu modunda işletim sistemi bildirimi kabuktan (yerel modda Rust izleyicisi gösterir).
  nativeNotify(`🔔 ${e.name || e.symbol} · ${e.symbol} ${e.interval}`, e.message);
  if (e.notify.popup) setAlertPopup((l) => [...l, e].slice(-5));
  if (e.notify.sound) playAlertSound();
  void refreshAlerts();
}

let stream: EventSource | null = null;

/** Sunucu alarm akışına bağlanır (EventSource kendiliğinden yeniden bağlanır). */
export function connectAlertStream(): void {
  if (stream || typeof EventSource === 'undefined') return;
  stream = new EventSource('/api/alerts/stream');
  stream.addEventListener('alert', (ev) => {
    try {
      handleAlertEvent(JSON.parse((ev as MessageEvent<string>).data) as AlertLogEntry);
    } catch {
      /* bozuk olay */
    }
  });
  stream.onopen = () => void refreshAlerts();
}

export function disconnectAlertStream(): void {
  stream?.close();
  stream = null;
}

export function dismissPopup(id?: number): void {
  setAlertPopup((l) => (id === undefined ? [] : l.filter((x) => x.id !== id)));
}

// ---------------------------------------------------------------- CRUD

export async function saveAlertDraft(d: AlertDraft, editId?: string): Promise<ServerAlert | null> {
  const err = validateDraft(d);
  if (err) {
    toast(`Alarm: ${err}`);
    return null;
  }
  try {
    const a = editId ? await updateAlertApi(editId, d) : await createAlertApi(d);
    toast(editId ? tfmt("🔔 Alarm güncellendi: {0}", a.symbol) : `🔔 Alarm kuruldu: ${a.symbol} (sunucuda)`);
    await refreshAlerts();
    return a;
  } catch (e) {
    toast(`Alarm kaydedilemedi: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

async function act(run: () => Promise<unknown>, ok: string): Promise<void> {
  try {
    await run();
    toast(ok);
  } catch (e) {
    toast(`Alarm: ${e instanceof Error ? e.message : String(e)}`);
  }
  await refreshAlerts();
}

export const stopAlert = (id: string) => act(() => alertAction(id, 'stop'), tt("Alarm durduruldu"));
export const restartAlert = (id: string) => act(() => alertAction(id, 'restart'), tt("Alarm yeniden başlatıldı"));
export const cloneAlert = (id: string) => act(() => alertAction(id, 'clone'), tt("Alarm kopyalandı"));
export const deleteAlert = (id: string) => act(() => deleteAlertApi(id), tt("Alarm silindi"));
export const bulkAlerts = (a: BulkAction) => act(() => bulkAlertAction(a), tt("Alarmlar güncellendi"));
export async function clearLog(): Promise<void> {
  await act(() => clearAlertLog(), tt("Günlük temizlendi"));
  setAlertLog([]);
}

/** Düzenleme penceresi: mevcut alarmın tanımı taslak olur. */
export function editAlert(a: ServerAlert): void {
  const { id, status, statusMsg, createdAt, updatedAt, lastFiredAt, fireCount, ...draft } = a;
  void status; void statusMsg; void createdAt; void updatedAt; void lastFiredAt; void fireCount;
  setAlertDialog({ draft: draft as AlertDraft, editId: id });
}

// ---------------------------------------------------------------- taslaklar

/** Fiyat alarmı (sağ tık / üst çubuk / izleme listesi). Değer verilmezse son fiyat. */
export function openPriceAlert(price?: number, symbol = ui.symbol): void {
  const last = lastCandle();
  const v = price ?? last?.close;
  if (v === undefined || !Number.isFinite(v)) {
    toast(tt("Alarm için fiyat verisi yok"));
    return;
  }
  setAlertDialog({ draft: priceAlertDraft(symbol, ui.interval, +v.toPrecision(10)) });
}

/** Çizim alarmı: çizgi → Kesişim; kanal/dikdörtgen → Kanaldan çıkıyor (Varsayılan değerler). */
export function openDrawingAlert(d: DrawingObject): void {
  const geo = drawingGeometry(d, candles(), intervalSeconds(ui.interval));
  if (!geo) {
    toast(tfmt("{0} için alarm kurulamaz (çizgi/kanal araçları desteklenir)", TOOL_LABELS[d.toolType] ?? d.toolType));
    return;
  }
  const base = priceAlertDraft(d.symbol || ui.symbol, d.timeframe || ui.interval, 0);
  const label = TOOL_LABELS[d.toolType] ?? tt("Çizim");
  const draft: AlertDraft =
    geo.kind === 'line'
      ? { ...base, target: { kind: 'line', line: geo.line }, drawingId: d.id, name: `${d.symbol}: ${label}` }
      : {
          ...base,
          condition: 'exiting_channel',
          target: undefined,
          upper: { kind: 'line', line: geo.upper },
          lower: { kind: 'line', line: geo.lower },
          drawingId: d.id,
          name: `${d.symbol}: ${label}`,
        };
  setAlertDialog({ draft });
}

/** Gösterge alarmı: kaynak = göstergenin ilk plot'u; alertcondition varsa betik alarmı da seçilebilir. */
export function openStudyAlert(uid: string): void {
  const s = studyById(uid);
  const code = s ? studyCode(s) : undefined;
  if (!s || !code) {
    toast(tt("Gösterge bulunamadı"));
    return;
  }
  const res = studyResults()[uid];
  const { study, dropped } = studyRef(studyShortTitle(s), code, s.inputs, uid);
  const base = priceAlertDraft(ui.symbol, ui.interval, 0);
  const conds = res?.alertConditions ?? [];
  const plot = res?.plots.find((p) => !p.hidden)?.title ?? res?.plots[0]?.title;
  let draft: AlertDraft;
  if (conds.length) {
    draft = { ...base, kind: 'script', study, scriptEvent: 'alertcondition', conditionTitle: conds[0].title, message: conds[0].message, trigger: 'once_per_bar_close' };
  } else if (plot) {
    const last = res?.plots.find((p) => p.title === plot)?.data.at(-1)?.value;
    draft = { ...base, source: { kind: 'plot', study, plot }, target: { kind: 'value', value: last !== undefined ? +last.toFixed(4) : 0 } };
  } else {
    draft = { ...base, kind: 'script', study, scriptEvent: 'alert_calls' };
  }
  setAlertDialog({
    draft,
    note: dropped.length ? tfmt("Başka göstergeye bağlı girdi(ler) sunucuda varsayılanla çalışır: {0}", dropped.join(', ')) : undefined,
  });
}

/** Betik editöründeki betik için alarm (strateji → emir dolumları, aksi halde alertcondition/alert()). */
export function openScriptAlert(code: string, title: string, isStrategy: boolean, conditions: Array<{ title: string; message: string }>): void {
  const base = priceAlertDraft(ui.symbol, ui.interval, 0);
  const { study } = studyRef(title, code);
  const draft: AlertDraft = conditions.length
    ? { ...base, kind: 'script', study, scriptEvent: 'alertcondition', conditionTitle: conditions[0].title, message: conditions[0].message, trigger: 'once_per_bar_close' }
    : { ...base, kind: 'script', study, scriptEvent: isStrategy ? 'order_fills_alerts' : 'alert_calls' };
  setAlertDialog({ draft });
}

/** Eski yerel alarmları sunucuya taşır (bir kez; çalışma alanı alanı sonra boşalır). */
export async function migrateLegacy(list: PriceAlert[]): Promise<number> {
  const drafts = migrateLegacyAlerts(list, ui.interval);
  let n = 0;
  for (const d of drafts) {
    try {
      await createAlertApi(d);
      n++;
    } catch {
      /* geçersiz eski kayıt */
    }
  }
  if (n) {
    toast(tfmt("{0} eski fiyat alarmı sunucu alarm motoruna taşındı", n));
    await refreshAlerts();
  }
  return n;
}

// ---------------------------------------------------------------- Web Push

function urlB64ToBytes(b64: string): Uint8Array {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function pushSupported(): boolean {
  return typeof navigator !== 'undefined' && 'serviceWorker' in navigator && typeof window !== 'undefined' && 'PushManager' in window && 'Notification' in window;
}

export async function refreshPushState(): Promise<void> {
  if (!pushSupported()) return void setPushState('unsupported');
  if (Notification.permission === 'denied') return void setPushState('denied');
  try {
    const reg = await navigator.serviceWorker.getRegistration('/');
    const sub = await reg?.pushManager.getSubscription();
    setPushState(sub ? 'on' : 'off');
  } catch {
    setPushState('off');
  }
}

/** Bu tarayıcıyı Web Push'a abone eder (izin ister; servis işçisi gerekir). */
export async function enablePush(): Promise<boolean> {
  if (!pushSupported()) {
    setPushState('unsupported');
    toast(tt("Bu tarayıcı Web Push desteklemiyor (https veya localhost + servis işçisi gerekir)"));
    return false;
  }
  setPushState('busy');
  try {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') {
      setPushState(perm === 'denied' ? 'denied' : 'off');
      toast('Bildirim izni verilmedi');
      return false;
    }
    const reg = (await navigator.serviceWorker.getRegistration('/')) ?? (await navigator.serviceWorker.register('/sw.js', { scope: '/' }));
    await navigator.serviceWorker.ready;
    const key = await fetchPushKey();
    const sub =
      (await reg.pushManager.getSubscription()) ??
      (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToBytes(key) as BufferSource }));
    await savePushSubscription(sub.toJSON());
    setPushState('on');
    await refreshAlertConfig();
    toast(tt("🔔 Web Push açık: tarayıcı kapalıyken de alarm bildirimi gelir"));
    return true;
  } catch (e) {
    setPushState('off');
    toast(tfmt("Web Push açılamadı: {0}", e instanceof Error ? e.message : String(e)));
    return false;
  }
}

export async function disablePush(): Promise<void> {
  if (!pushSupported()) return;
  try {
    const reg = await navigator.serviceWorker.getRegistration('/');
    const sub = await reg?.pushManager.getSubscription();
    if (sub) {
      await deletePushSubscription(sub.endpoint);
      await sub.unsubscribe();
    }
  } finally {
    setPushState('off');
    await refreshAlertConfig();
  }
}

/** Uygulama açılışı: liste + günlük + akış + push durumu. */
export function initAlerts(): void {
  void refreshAlerts();
  void refreshAlertLog();
  void refreshPushState();
  connectAlertStream();
  if (typeof navigator !== 'undefined' && navigator.serviceWorker) {
    navigator.serviceWorker.addEventListener('message', (ev: MessageEvent) => onSwMessage(ev.data));
  }
}

/** Servis işçisi: açık pencerede bildirime tıklanınca o sembole geç. */
export function onSwMessage(data: unknown): void {
  const d = data as { type?: string; symbol?: string } | null;
  if (d?.type === 'titan-alert-open' && typeof d.symbol === 'string' && d.symbol && d.symbol !== ui.symbol) void switchSymbol(d.symbol);
}
