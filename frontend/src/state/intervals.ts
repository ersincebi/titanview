/**
 * Faz 25: Standart + özel zaman aralıkları (saniye 1s–59s, dakika 1m–59m, çoklu saat 2h–12h,
 * çoklu gün 2d/3d, hafta 1w, ay 1M/3M/6M/12M). Büyük `M` = ay, küçük `m` = dakika.
 */

export type IntervalUnit = 's' | 'm' | 'h' | 'd' | 'w' | 'M';

export interface ParsedInterval {
  n: number;
  unit: IntervalUnit;
}

export interface IntervalGroup {
  id: 'sec' | 'min' | 'hour' | 'day';
  label: string;
  hint?: string;
  items: string[];
}

export const INTERVAL_GROUPS: readonly IntervalGroup[] = [
  { id: 'sec', label: tt("SANİYELER"), hint: tt('Kripto'), items: ['1s', '5s', '10s', '15s', '30s'] },
  { id: 'min', label: tt("DAKİKALAR"), items: ['1m', '3m', '5m', '15m', '30m', '45m'] },
  { id: 'hour', label: tt('SAATLER'), items: ['1h', '2h', '3h', '4h', '6h', '8h', '12h'] },
  { id: 'day', label: tt("GÜNLER / AYLAR"), items: ['1d', '2d', '3d', '1w', '1M', '3M', '6M', '12M'] },
];

export const PRESET_INTERVALS: readonly string[] = INTERVAL_GROUPS.flatMap((g) => g.items);

export const UNIT_LIMITS: Record<IntervalUnit, [number, number]> = {
  s: [1, 59],
  m: [1, 59],
  h: [1, 23],
  d: [1, 365],
  w: [1, 52],
  M: [1, 12],
};

export const UNIT_LABELS_TR: Record<IntervalUnit, string> = {
  s: 'Saniye',
  m: tt("Dakika"),
  h: tt("Saat"),
  d: tt("Gün"),
  w: tt("Hafta"),
  M: 'Ay',
};

const UNIT_SEC: Record<IntervalUnit, number> = {
  s: 1,
  m: 60,
  h: 3600,
  d: 86400,
  w: 604800,
  M: 30 * 86400,
};

/**
 * Bir aralık dizesini ayrıştırır (`15m`, `5s`, `2h`, `2D`, `3M`, `1mo`, `12M`...).
 * Büyük `M` her zaman aydır; sınır dışı değerler (ör. `13M`, `0s`, `7q`) null döner.
 */
export function parseInterval(raw: string): ParsedInterval | null {
  const s = raw.trim();
  if (!s) return null;
  if (s === 'M') return { n: 1, unit: 'M' };
  if (s.endsWith('M') && s.length >= 2) {
    const n = Number(s.slice(0, -1));
    if (Number.isInteger(n) && n >= 1 && n <= 12) return { n, unit: 'M' };
    return null;
  }
  if (s === 'D') return { n: 1, unit: 'd' };
  if (s === 'W') return { n: 1, unit: 'w' };

  const low = s.toLowerCase();
  if (low === 'daily' || low === 'd') return { n: 1, unit: 'd' };
  if (low === 'weekly' || low === 'w') return { n: 1, unit: 'w' };
  if (low === 'monthly') return { n: 1, unit: 'M' };

  const m = /^(\d+)(s|sec|m|min|h|hr|d|day|w|wk|week|mo|y|yr)$/.exec(low);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isInteger(n) || n <= 0) return null;
  const u = m[2];
  if (u === 's' || u === 'sec') {
    if (n === 60) return { n: 1, unit: 'm' };
    return n <= 59 ? { n, unit: 's' } : null;
  }
  if (u === 'm' || u === 'min') {
    if (n === 1440) return { n: 1, unit: 'd' };
    if (n >= 60 && n % 60 === 0 && n / 60 <= 23) return { n: n / 60, unit: 'h' };
    return n <= 1439 ? { n, unit: 'm' } : null;
  }
  if (u === 'h' || u === 'hr') {
    if (n === 24) return { n: 1, unit: 'd' };
    return n <= 23 ? { n, unit: 'h' } : null;
  }
  if (u === 'd' || u === 'day') return n <= 365 ? { n, unit: 'd' } : null;
  if (u === 'w' || u === 'wk' || u === 'week') return n <= 52 ? { n, unit: 'w' } : null;
  if (u === 'mo') return n <= 12 ? { n, unit: 'M' } : null;
  if (u === 'y' || u === 'yr') return n === 1 ? { n: 12, unit: 'M' } : null;
  return null;
}

export function isValidInterval(tf: string): boolean {
  return parseInterval(tf) !== null;
}

export function normalizeInterval(raw: string): string | null {
  const p = parseInterval(raw);
  return p ? `${p.n}${p.unit}` : null;
}

export function buildCustomInterval(n: number, unit: IntervalUnit): string | null {
  const [lo, hi] = UNIT_LIMITS[unit];
  if (!Number.isInteger(n) || n < lo || n > hi) return null;
  return normalizeInterval(`${n}${unit}`);
}

export function intervalSeconds(tf: string): number {
  const p = parseInterval(tf);
  return p ? p.n * UNIT_SEC[p.unit] : 900;
}

export function isSecondsInterval(tf: string): boolean {
  return parseInterval(tf)?.unit === 's';
}

export function intervalLabelTr(tf: string): string {
  const p = parseInterval(tf);
  if (!p) return tf;
  return `${p.n} ${UNIT_LABELS_TR[p.unit]}`;
}

import { lang, tt } from './i18n';

const UNIT_EN: Record<IntervalUnit, string> = { s: 'second', m: 'minute', h: 'hour', d: 'day', w: 'week', M: 'month' };

/** Faz 30 — Standart EN aralık menüsü uzun etiketi: "1 second", "15 minutes", "4 hours", "1 day"… */
export function intervalLabelEn(tf: string): string {
  const p = parseInterval(tf);
  if (!p) return tf;
  return `${p.n} ${UNIT_EN[p.unit]}${p.n === 1 ? '' : 's'}`;
}

/** Kısa aralık etiketi (TR: 5sn/15/4s/1G/1H/1A · EN: 5s/15/4h/1D/1W/1M). */
export function tvIntervalLabel(tf: string): string {
  const p = parseInterval(tf);
  if (!p) return tf.toUpperCase();
  const en = lang() === 'en';
  switch (p.unit) {
    case 's':
      return en ? `${p.n}s` : `${p.n}sn`;
    case 'm':
      return String(p.n);
    case 'h':
      return en ? `${p.n}h` : `${p.n}s`;
    case 'd':
      return en ? `${p.n}D` : `${p.n}G`;
    case 'w':
      return en ? `${p.n}W` : `${p.n}H`;
    case 'M':
      return en ? `${p.n}M` : `${p.n}A`;
  }
}

export function sortIntervals(list: readonly string[]): string[] {
  return [...list].sort((a, b) => intervalSeconds(a) - intervalSeconds(b));
}
