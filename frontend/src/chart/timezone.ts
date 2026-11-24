/** Grafik zaman ekseni yerel saatte (varsayılan: tarayıcı dilimi). lightweight-charts varsayılanı UTC'dir. */
import { createSignal } from 'solid-js';
import { localeTag, tt } from '../state/i18n';

export interface TimezoneChoice {
  id: string; // '' = browser local
  labelTr: string;
  labelEn: string;
  short: string;
}

export const TIMEZONE_CHOICES: TimezoneChoice[] = [
  { id: '', labelTr: tt("Yerel (Tarayıcı)"), labelEn: 'Local (Browser)', short: 'Local' },
  { id: 'UTC', labelTr: 'UTC (Evrensel)', labelEn: 'UTC (Exchange)', short: 'UTC' },
  { id: 'Europe/Istanbul', labelTr: tt("UTC+3 İstanbul (BIST)"), labelEn: 'UTC+3 Istanbul (BIST)', short: tt("UTC+3 İstanbul") },
  { id: 'America/New_York', labelTr: 'UTC-5 New York (NYSE/NASDAQ)', labelEn: 'UTC-5 New York (NYSE/NASDAQ)', short: 'UTC-5 New York' },
  { id: 'America/Chicago', labelTr: 'UTC-6 Chicago (CME)', labelEn: 'UTC-6 Chicago (CME)', short: 'UTC-6 Chicago' },
  { id: 'Europe/London', labelTr: 'UTC+0 Londra (LSE)', labelEn: 'UTC+0 London (LSE)', short: 'UTC+0 London' },
  { id: 'Europe/Berlin', labelTr: 'UTC+1 Frankfurt (XETRA)', labelEn: 'UTC+1 Frankfurt (XETRA)', short: 'UTC+1 Berlin' },
  { id: 'Asia/Dubai', labelTr: 'UTC+4 Dubai', labelEn: 'UTC+4 Dubai', short: 'UTC+4 Dubai' },
  { id: 'Asia/Hong_Kong', labelTr: 'UTC+8 Hong Kong', labelEn: 'UTC+8 Hong Kong', short: 'UTC+8 HK' },
  { id: 'Asia/Tokyo', labelTr: 'UTC+9 Tokyo (TSE)', labelEn: 'UTC+9 Tokyo (TSE)', short: 'UTC+9 Tokyo' },
];

const [activeTimezone, setActiveTimezoneSignal] = createSignal<string>('');
const [hour12Mode, setHour12Mode] = createSignal<boolean>(false);
const [dayOfWeekMode, setDayOfWeekMode] = createSignal<boolean>(false);

export { activeTimezone, hour12Mode, dayOfWeekMode };

export function setActiveTimezone(tz: string): void {
  setActiveTimezoneSignal(tz);
}

export function setTimeAxisDisplay(opts: { hour12?: boolean; dayOfWeek?: boolean }): void {
  if (opts.hour12 !== undefined) setHour12Mode(opts.hour12);
  if (opts.dayOfWeek !== undefined) setDayOfWeekMode(opts.dayOfWeek);
}

export function timezoneShortLabel(tz: string = activeTimezone()): string {
  const found = TIMEZONE_CHOICES.find((c) => c.id === tz);
  if (found && tz !== '') return found.short;
  const resolved = resolveTimeZone(tz);
  if (resolved === 'Europe/Istanbul') return tt("UTC+3 İstanbul");
  return resolved;
}

export function resolveTimeZone(pref?: string): string {
  const tz = pref !== undefined && pref !== '' ? pref : activeTimezone() || Intl.DateTimeFormat().resolvedOptions().timeZone;
  try {
    new Intl.DateTimeFormat(localeTag(), { timeZone: tz });
    return tz;
  } catch {
    return 'UTC';
  }
}

export type AxisKind = 'year' | 'month' | 'day' | 'time' | 'seconds';

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(key: string, tz: string, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const loc = localeTag();
  const h12 = hour12Mode();
  const k = `${key}|${tz}|${loc}|${h12 ? '12' : '24'}`;
  let f = fmtCache.get(k);
  if (!f) {
    f = new Intl.DateTimeFormat(loc, { timeZone: tz, hour12: h12, ...opts });
    fmtCache.set(k, f);
  }
  return f;
}

export function formatAxisTime(unixSec: number, kind: AxisKind, tz: string = resolveTimeZone()): string {
  const d = new Date(unixSec * 1000);
  switch (kind) {
    case 'year':
      return fmt('y', tz, { year: 'numeric' }).format(d);
    case 'month':
      return fmt('m', tz, { month: 'short' }).format(d);
    case 'day':
      return fmt('d', tz, { day: 'numeric' }).format(d);
    case 'seconds':
      return fmt('ts', tz, { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(d);
    default:
      return fmt('t', tz, { hour: '2-digit', minute: '2-digit' }).format(d);
  }
}

export function formatCrosshairTime(unixSec: number, tz: string = resolveTimeZone(), withSeconds = false): string {
  const dow = dayOfWeekMode();
  return fmt(`${withSeconds ? 'cs' : 'c'}${dow ? 'w' : ''}`, tz, {
    ...(dow ? { weekday: 'short' } : {}),
    day: '2-digit',
    month: 'short',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    ...(withSeconds ? { second: '2-digit' } : {}),
  }).format(new Date(unixSec * 1000));
}

const TICK_KINDS: AxisKind[] = ['year', 'month', 'day', 'time', 'seconds'];
/** Faz 30: kaydırma/yakınlaştırmada aynı eksen etiketleri her karede yeniden Intl ile biçimlenmesin. */
const tickCache = new Map<string, string>();

/** lightweight-charts TickMarkType: 0 Year, 1 Month, 2 DayOfMonth, 3 Time, 4 TimeWithSeconds. */
export function tickMarkFormatter(time: unknown, type: number, tz?: string): string {
  const t = typeof time === 'number' ? time : 0;
  const zone = tz ?? resolveTimeZone();
  const key = `${t}|${type}|${zone}|${localeTag()}|${hour12Mode() ? 1 : 0}`;
  const hit = tickCache.get(key);
  if (hit !== undefined) return hit;
  const out = formatAxisTime(t, TICK_KINDS[type] ?? 'time', zone);
  if (tickCache.size > 4000) tickCache.clear();
  tickCache.set(key, out);
  return out;
}
