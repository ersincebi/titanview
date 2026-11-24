import { tfmt, tt } from './i18n';
import { LANG_NAME } from '../script/brand';
/**
 * Faz 23 — sunucu alarm modeli (saf). Değerlendirme Go'da (`backend/internal/alerts`) yapılır; bu dosya
 * arayüzün kurduğu alarm tanımını, etiketleri, çizim → çizgi/kanal dönüşümünü ve eski yerel alarm göçünü taşır.
 */
import type { Candle, DrawingObject, PriceAlert, TimePricePoint } from '../types/market';
import { regression, REGRESSION_DEV } from '../chart/drawing/channels';

export type AlertCondition =
  | 'crossing'
  | 'crossing_up'
  | 'crossing_down'
  | 'greater_than'
  | 'less_than'
  | 'entering_channel'
  | 'exiting_channel'
  | 'inside_channel'
  | 'outside_channel'
  | 'moving_up'
  | 'moving_down'
  | 'moving_up_pct'
  | 'moving_down_pct';

export type AlertTrigger = 'once' | 'once_per_bar' | 'once_per_bar_close' | 'once_per_minute';
export type ScriptEvent = 'alertcondition' | 'alert_calls' | 'order_fills' | 'order_fills_alerts';
export type AlertStatus = 'active' | 'stopped' | 'triggered' | 'expired' | 'error';
export type PriceField = 'close' | 'open' | 'high' | 'low' | 'hl2' | 'hlc3' | 'ohlc4' | 'volume';

export interface AlertPoint {
  time: number;
  price: number;
}

export interface AlertLine {
  a: AlertPoint;
  b: AlertPoint;
  extendLeft?: boolean;
  extendRight?: boolean;
}

export interface AlertStudy {
  id?: string;
  name: string;
  code: string;
  inputs?: Record<string, unknown>;
}

export interface AlertOperand {
  kind: 'price' | 'value' | 'plot' | 'line';
  field?: PriceField;
  value?: number;
  study?: AlertStudy;
  plot?: string;
  line?: AlertLine;
}

export interface AlertNotify {
  app: boolean;
  popup: boolean;
  sound: boolean;
  push: boolean;
  webhook?: string;
  telegram: boolean;
  /** Faz 33: telefona push (ntfy) */
  ntfy?: boolean;
}

export interface ServerAlert {
  id: string;
  name: string;
  symbol: string;
  interval: string;
  kind: 'condition' | 'script';
  source: AlertOperand;
  condition?: AlertCondition;
  target?: AlertOperand;
  upper?: AlertOperand;
  lower?: AlertOperand;
  amount?: number;
  bars?: number;
  study?: AlertStudy;
  scriptEvent?: ScriptEvent;
  conditionTitle?: string;
  trigger: AlertTrigger;
  expiresAt?: number;
  message: string;
  notify: AlertNotify;
  drawingId?: string;
  status: AlertStatus;
  statusMsg?: string;
  createdAt: number;
  updatedAt: number;
  lastFiredAt?: number;
  fireCount: number;
}

/** Oluşturma/düzenleme gövdesi (sunucu çalışma alanlarını kendisi doldurur). */
export type AlertDraft = Omit<ServerAlert, 'id' | 'status' | 'statusMsg' | 'createdAt' | 'updatedAt' | 'lastFiredAt' | 'fireCount'>;

export interface AlertDelivery {
  channel: string;
  ok: boolean;
  detail?: string;
}

export interface AlertLogEntry {
  id: number;
  alertId: string;
  name: string;
  symbol: string;
  interval: string;
  time: number;
  barTime: number;
  price: number;
  message: string;
  notify: AlertNotify;
  deliveries?: AlertDelivery[];
}

/** Standart koşul listesi (aynı sıra). */
export const CONDITIONS: Array<{ id: AlertCondition; label: string }> = [
  { id: 'crossing', label: tt("Kesişim") },
  { id: 'crossing_up', label: tt("Yukarı kesişim") },
  { id: 'crossing_down', label: tt("Aşağı kesişim") },
  { id: 'greater_than', label: tt("Büyüktür") },
  { id: 'less_than', label: tt("Küçüktür") },
  { id: 'entering_channel', label: tt("Kanala giriyor") },
  { id: 'exiting_channel', label: tt("Kanaldan çıkıyor") },
  { id: 'inside_channel', label: tt("Kanalın içinde") },
  { id: 'outside_channel', label: tt("Kanalın dışında") },
  { id: 'moving_up', label: tt("Yukarı hareket") },
  { id: 'moving_down', label: tt("Aşağı hareket") },
  { id: 'moving_up_pct', label: tt("Yukarı hareket %") },
  { id: 'moving_down_pct', label: tt("Aşağı hareket %") },
];

export const TRIGGERS: Array<{ id: AlertTrigger; label: string; hint: string }> = [
  { id: 'once', label: tt("Yalnız bir kez"), hint: tt("Koşul gerçekleşince bir kez tetiklenir") },
  { id: 'once_per_bar', label: tt("Bar başına bir kez"), hint: tt("Koşul gerçekleştikçe bar başına bir kez tetiklenir") },
  { id: 'once_per_bar_close', label: tt("Bar kapanışında bir kez"), hint: tt("Koşul bar kapanışında her gerçekleştiğinde tetiklenir") },
  { id: 'once_per_minute', label: tt("Dakikada bir kez"), hint: tt("Koşul sürdükçe dakikada bir kez tetiklenir") },
];

export const SCRIPT_EVENTS: Array<{ id: ScriptEvent; label: string; strategyOnly?: boolean }> = [
  { id: 'alertcondition', label: 'alertcondition()' },
  { id: 'alert_calls', label: tt("Herhangi bir alert() çağrısı") },
  { id: 'order_fills', label: tt("Yalnız emir dolumları"), strategyOnly: true },
  { id: 'order_fills_alerts', label: tt("Emir dolumları ve alert() çağrıları"), strategyOnly: true },
];

export const STATUS_LABELS: Record<AlertStatus, string> = {
  active: tt("Aktif"),
  stopped: 'Durduruldu',
  triggered: 'Tetiklendi',
  expired: tt("Süresi doldu"),
  error: tt("Hata"),
};

export const PRICE_FIELDS: Array<{ id: PriceField; label: string }> = [
  { id: 'close', label: tt("Kapanış") },
  { id: 'open', label: tt("Açılış") },
  { id: 'high', label: tt("Yüksek") },
  { id: 'low', label: tt("Düşük") },
  { id: 'hl2', label: '(Y+D)/2' },
  { id: 'hlc3', label: '(Y+D+K)/3' },
  { id: 'ohlc4', label: '(A+Y+D+K)/4' },
  { id: 'volume', label: tt("Hacim") },
];

/** Mesaj yer tutucuları (standart formül). */
export const PLACEHOLDERS = [
  '{{ticker}}', '{{exchange}}', '{{interval}}', '{{close}}', '{{open}}', '{{high}}', '{{low}}', '{{volume}}',
  '{{time}}', '{{timenow}}', '{{plot_0}}', tt("{{plot(\"başlık\")}}"),
  '{{strategy.order.action}}', '{{strategy.order.contracts}}', '{{strategy.order.price}}', '{{strategy.order.id}}',
  '{{strategy.position_size}}', '{{strategy.market_position}}',
];

export const isChannelCond = (c?: string): boolean =>
  c === 'entering_channel' || c === 'exiting_channel' || c === 'inside_channel' || c === 'outside_channel';
export const isMovingCond = (c?: string): boolean =>
  c === 'moving_up' || c === 'moving_down' || c === 'moving_up_pct' || c === 'moving_down_pct';

export const conditionLabel = (c?: string): string => CONDITIONS.find((x) => x.id === c)?.label ?? c ?? '';
export const triggerLabel = (t?: string): string => TRIGGERS.find((x) => x.id === t)?.label ?? t ?? '';

/** Bildirimler satırı özeti (varsayılan: "Uygulama, Açılır pencere, Webhook"). */
export function notifySummary(n: AlertNotify): string {
  const parts = [
    n.app && tt('Uygulama'),
    n.popup && tt("Açılır pencere"),
    n.sound && tt('Ses'),
    n.push && 'Web Push',
    n.webhook && 'Webhook',
    n.telegram && 'Telegram',
    n.ntfy && 'ntfy',
  ].filter(Boolean);
  return parts.length ? parts.join(', ') : tt("Kapalı");
}

export function defaultNotify(): AlertNotify {
  return { app: true, popup: true, sound: true, push: false, telegram: false };
}

export function fmtNum(v: number | undefined): string {
  if (v === undefined || !Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  return a >= 1000 ? v.toFixed(2) : a >= 1 ? String(+v.toFixed(4)) : String(+v.toPrecision(5));
}

function operandText(o: AlertOperand | undefined): string {
  if (!o) return '';
  switch (o.kind) {
    case 'value':
      return fmtNum(o.value);
    case 'price':
      return PRICE_FIELDS.find((f) => f.id === (o.field ?? 'close'))?.label ?? tt("Fiyat");
    case 'plot':
      return tfmt("{0}: {1}", o.study?.name ?? tt("Gösterge"), o.plot ?? '');
    case 'line':
      return tt("Çizim");
  }
}

/** Liste satırı açıklaması ("BTCUSDT Yukarı kesişim 65000", "RSI: RSI Büyüktür 70"). */
export function describeAlert(a: Pick<ServerAlert, 'kind' | 'symbol' | 'source' | 'condition' | 'target' | 'amount' | 'bars' | 'study' | 'scriptEvent' | 'conditionTitle'>): string {
  if (a.kind === 'script') {
    const ev = a.scriptEvent === 'alertcondition' ? a.conditionTitle ?? '' : SCRIPT_EVENTS.find((p) => p.id === a.scriptEvent)?.label ?? '';
    return `${a.study?.name ?? LANG_NAME}: ${ev}`;
  }
  const src = a.source.kind === 'plot' ? operandText(a.source) : a.symbol;
  if (isChannelCond(a.condition)) return `${src} ${conditionLabel(a.condition)}`;
  if (isMovingCond(a.condition)) {
    const pct = a.condition?.endsWith('_pct') ? '%' : '';
    return `${src} ${conditionLabel(a.condition)} ${fmtNum(a.amount)}${pct} / ${a.bars ?? 1} bar`;
  }
  return `${src} ${conditionLabel(a.condition)} ${operandText(a.target)}`.trim();
}

// ---------------------------------------------------------------- bar indeksi (Go `BarIndex` ile aynı)

/** Zamanı (kesirli) bar indeksine çevirir; aralık dışında adımla uzatır. */
export function barIndex(c: Candle[], t: number, step: number): number {
  const n = c.length;
  if (n === 0) return NaN;
  const s = step > 0 ? step : 60;
  if (t <= c[0].time) return (t - c[0].time) / s;
  if (t >= c[n - 1].time) return n - 1 + (t - c[n - 1].time) / s;
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (c[mid].time <= t) lo = mid;
    else hi = mid;
  }
  return lo + (t - c[lo].time) / (c[hi].time - c[lo].time);
}

/** Çizgi değeri (bar indeksi uzayında, Go `LineValue` ile aynı). */
export function lineValueAt(l: AlertLine, c: Candle[], step: number, x: number): number {
  const xa = barIndex(c, l.a.time, step);
  const xb = barIndex(c, l.b.time, step);
  if (!Number.isFinite(xa) || !Number.isFinite(xb)) return NaN;
  const lo = Math.min(xa, xb);
  const hi = Math.max(xa, xb);
  if ((!l.extendLeft && x < lo - 1e-9) || (!l.extendRight && x > hi + 1e-9)) return NaN;
  if (Math.abs(xb - xa) < 1e-9) return l.a.price === l.b.price ? l.a.price : NaN;
  return l.a.price + ((l.b.price - l.a.price) * (x - xa)) / (xb - xa);
}

const pt = (p: TimePricePoint): AlertPoint => ({ time: p.time, price: p.price });

export type DrawingAlertGeometry =
  | { kind: 'line'; line: AlertLine }
  | { kind: 'channel'; upper: AlertLine; lower: AlertLine };

/** Alarm kurulabilen çizim araçları. */
export const ALERTABLE_TOOLS = new Set([
  'trendline', 'ray', 'extended', 'info_line', 'arrow', 'trend_angle', 'hline', 'hray',
  'channel', 'flat_channel', 'disjoint_channel', 'regression', 'rect',
]);

/**
 * Çizimi alarm geometrisine çevirir. Kanallarda ikinci çizgi bar-indeksi uzayında hesaplanır
 * (grafik çizimi nasıl gösteriyorsa sunucu da öyle değerlendirir). Desteklenmeyen araç → null.
 */
export function drawingGeometry(d: DrawingObject, candles: Candle[], step: number): DrawingAlertGeometry | null {
  const p = d.points;
  if (!ALERTABLE_TOOLS.has(d.toolType) || p.length === 0) return null;
  switch (d.toolType) {
    case 'hline':
      return { kind: 'line', line: { a: pt(p[0]), b: pt(p[0]), extendLeft: true, extendRight: true } };
    case 'hray':
      return { kind: 'line', line: { a: pt(p[0]), b: pt(p[0]), extendRight: true } };
    case 'trendline':
    case 'info_line':
    case 'arrow':
    case 'trend_angle':
      return p.length >= 2 ? { kind: 'line', line: { a: pt(p[0]), b: pt(p[1]) } } : null;
    case 'ray':
      return p.length >= 2 ? { kind: 'line', line: { a: pt(p[0]), b: pt(p[1]), extendRight: true } } : null;
    case 'extended':
      return p.length >= 2 ? { kind: 'line', line: { a: pt(p[0]), b: pt(p[1]), extendLeft: true, extendRight: true } } : null;
    case 'rect': {
      if (p.length < 2) return null;
      const t0 = Math.min(p[0].time, p[1].time);
      const t1 = Math.max(p[0].time, p[1].time);
      const hi = Math.max(p[0].price, p[1].price);
      const lo = Math.min(p[0].price, p[1].price);
      return {
        kind: 'channel',
        upper: { a: { time: t0, price: hi }, b: { time: t1, price: hi } },
        lower: { a: { time: t0, price: lo }, b: { time: t1, price: lo } },
      };
    }
    case 'regression': {
      if (p.length < 2) return null;
      const r = regression(candles, p[0].time, p[1].time);
      if (!r) return null;
      const off = REGRESSION_DEV * r.stdev;
      return {
        kind: 'channel',
        upper: { a: { time: r.t0, price: r.startPrice + off }, b: { time: r.t1, price: r.endPrice + off } },
        lower: { a: { time: r.t0, price: r.startPrice - off }, b: { time: r.t1, price: r.endPrice - off } },
      };
    }
    case 'channel':
    case 'flat_channel':
    case 'disjoint_channel': {
      if (p.length < 3) return null;
      const a = pt(p[0]);
      const b = pt(p[1]);
      const c = pt(p[2]);
      const first: AlertLine = { a, b };
      let second: AlertLine;
      if (d.toolType === 'flat_channel') {
        second = { a: { time: a.time, price: c.price }, b: { time: b.time, price: c.price } };
      } else {
        const xa = barIndex(candles, a.time, step);
        const xb = barIndex(candles, b.time, step);
        const xc = barIndex(candles, c.time, step);
        const slope = xb !== xa ? (b.price - a.price) / (xb - xa) : 0;
        if (d.toolType === 'channel') {
          const off = c.price - (a.price + slope * (xc - xa));
          second = { a: { time: a.time, price: a.price + off }, b: { time: b.time, price: b.price + off } };
        } else {
          // ayrık kanal: ters eğimle p2'den geçen çizgi
          const yAt = (x: number) => c.price - slope * (x - xc);
          second = { a: { time: a.time, price: yAt(xa) }, b: { time: b.time, price: yAt(xb) } };
        }
      }
      // üst/alt: ilk çapada hangisi yüksekse (sunucu yine de min/max alır)
      return first.a.price >= second.a.price
        ? { kind: 'channel', upper: first, lower: second }
        : { kind: 'channel', upper: second, lower: first };
    }
  }
  return null;
}

/** Göstergeyi sunucuya gidecek betik çalışmasına çevirir; başka göstergeye bağlı (`@uid:plot`) girdiler düşer. */
export function studyRef(name: string, code: string, inputs: Record<string, unknown> = {}, id?: string): { study: AlertStudy; dropped: string[] } {
  const clean: Record<string, unknown> = {};
  const dropped: string[] = [];
  for (const [k, v] of Object.entries(inputs)) {
    if (typeof v === 'string' && v.startsWith('@')) dropped.push(k);
    else clean[k] = v;
  }
  return { study: { ...(id ? { id } : {}), name, code, ...(Object.keys(clean).length ? { inputs: clean } : {}) }, dropped };
}

/** Yeni fiyat alarmı taslağı (varsayılan: Kesişim, bir kez). */
export function priceAlertDraft(symbol: string, interval: string, value: number): AlertDraft {
  return {
    name: '',
    symbol: symbol.toUpperCase(),
    interval,
    kind: 'condition',
    source: { kind: 'price', field: 'close' },
    condition: 'crossing',
    target: { kind: 'value', value },
    amount: 1,
    bars: 1,
    trigger: 'once',
    message: '',
    notify: defaultNotify(),
  };
}

/** Eski (Faz 2) yerel fiyat alarmlarını sunucu taslağına çevirir; tetiklenmiş olanlar taşınmaz. */
export function migrateLegacyAlerts(list: PriceAlert[], interval: string): AlertDraft[] {
  return list
    .filter((a) => !a.triggered && Number.isFinite(a.targetPrice) && a.targetPrice > 0)
    .map((a) => ({
      ...priceAlertDraft(a.symbol, interval, a.targetPrice),
      name: a.note || '',
      condition: a.condition === 'CROSS_DOWN' ? 'crossing_down' : 'crossing_up',
    }));
}

/** Taslak doğrulaması (sunucu da doğrular; burada kullanıcıya anında Türkçe mesaj için). */
export function validateDraft(d: AlertDraft): string | null {
  if (!d.symbol) return tt("Sembol gerekli");
  if (d.notify.webhook && !/^https?:\/\/[^\s/]+/i.test(d.notify.webhook)) return tt("Webhook adresi http(s):// ile başlamalı");
  if (d.kind === 'script') {
    if (!d.study?.code) return tt("Betik seçin");
    if (d.scriptEvent === 'alertcondition' && !d.conditionTitle) return tt("alertcondition seçin");
    return null;
  }
  if (d.source.kind === 'plot' && (!d.source.study || !d.source.plot)) return tt("Gösterge çizimi seçin");
  if (isChannelCond(d.condition)) {
    if (!d.upper || !d.lower) return tt("Kanal için üst ve alt sınır gerekli");
    for (const o of [d.upper, d.lower]) if (o.kind === 'value' && !Number.isFinite(o.value)) return tt("Kanal sınırı sayı olmalı");
    return null;
  }
  if (isMovingCond(d.condition)) {
    if (!(Number(d.amount) > 0)) return tt("Hareket miktarı pozitif olmalı");
    if (!(Number(d.bars) >= 1)) return tt("Bar sayısı en az 1");
    return null;
  }
  if (!d.target) return tt("Hedef değer gerekli");
  if (d.target.kind === 'value' && !Number.isFinite(d.target.value)) return tt("Değer sayı olmalı");
  if (d.target.kind === 'plot' && (!d.target.study || !d.target.plot)) return tt("Hedef gösterge çizimini seçin");
  return null;
}

/** Sağ panel/çizgi için: alarmın grafikte yatay çizgi olarak gösterilecek fiyatı (yalnız sabit değerli fiyat alarmları). */
export function alertLinePrice(a: ServerAlert): number | null {
  if (a.kind !== 'condition' || a.source.kind !== 'price' || a.status !== 'active') return null;
  if (isChannelCond(a.condition) || isMovingCond(a.condition)) return null;
  return a.target?.kind === 'value' && Number.isFinite(a.target.value) ? a.target.value! : null;
}

/** datetime-local değeri ↔ unix saniye. */
export function toLocalInput(sec: number): string {
  const d = new Date(sec * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromLocalInput(v: string): number | undefined {
  if (!v) return undefined;
  const ms = new Date(v).getTime();
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : undefined;
}
