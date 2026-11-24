import type { Candle, MarketType } from '../types/market';

/**
 * Hacim profili, seans gruplama, TPO ve yaklaşık footprint — saf hesaplar (tuvale bağımsız, testli).
 * Kural: bir barın hacmi [düşük, yüksek] aralığına düzgün yayılır; bar yönü (kapanış ≥ açılış)
 * yukarı/aşağı hacmi belirler. Değer alanı POC'tan başlayıp hacmi büyük komşu satıra genişler.
 */

/** 1, 2, 2.5, 5 × 10^k "güzel" adım. */
export function niceStep(raw: number): number {
  if (!(raw > 0) || !Number.isFinite(raw)) return 1;
  const exp = Math.floor(Math.log10(raw));
  const base = 10 ** exp;
  const f = raw / base;
  const m = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return Number((m * base).toPrecision(6));
}

/** Aşağı yuvarlayan güzel sayı: 1, 2, 2.5, 5 × 10^k (ATR kutusu: 3023 → 2500). */
export function niceFloor(raw: number): number {
  if (!(raw > 0) || !Number.isFinite(raw)) return 1;
  const exp = Math.floor(Math.log10(raw));
  const base = 10 ** exp;
  const f = raw / base;
  const m = f >= 5 ? 5 : f >= 2.5 ? 2.5 : f >= 2 ? 2 : 1;
  return Number((m * base).toPrecision(6));
}

export interface ProfileRow {
  /** satır alt fiyatı */
  price: number;
  up: number;
  down: number;
  total: number;
}

export interface VolumeProfile {
  rowSize: number;
  rows: ProfileRow[];
  /** en çok hacimli satırın orta fiyatı */
  poc: number;
  vah: number;
  val: number;
  maxTotal: number;
  totalVolume: number;
}

/** Satır sayısına göre otomatik satır yüksekliği. */
export function rowSizeFor(bars: Candle[], rows: number): number {
  let lo = Infinity;
  let hi = -Infinity;
  for (const b of bars) {
    if (b.low < lo) lo = b.low;
    if (b.high > hi) hi = b.high;
  }
  if (!(hi > lo)) return niceStep(Math.abs(hi) * 0.001 || 1);
  return (hi - lo) / Math.max(1, rows);
}

/** Değer alanı: POC'tan iki yana, hacmi büyük tarafa genişleyerek toplamın `pct`'sine ulaşır. */
export function valueArea(totals: number[], poc: number, pct: number): { lo: number; hi: number } {
  const sum = totals.reduce((a, b) => a + b, 0);
  const target = sum * Math.min(1, Math.max(0, pct / 100));
  let lo = poc;
  let hi = poc;
  let acc = totals[poc] ?? 0;
  while (acc < target && (lo > 0 || hi < totals.length - 1)) {
    const up = hi < totals.length - 1 ? totals[hi + 1] : -1;
    const dn = lo > 0 ? totals[lo - 1] : -1;
    if (up >= dn) {
      hi++;
      acc += up;
    } else {
      lo--;
      acc += dn;
    }
  }
  return { lo, hi };
}

/**
 * Bar dizisinin hacim profili. `rowSize` verilmezse `rows` satıra bölünür ("Row Size: Number of Rows").
 */
export function computeProfile(bars: Candle[], opts: { rows?: number; rowSize?: number; vaPct?: number } = {}): VolumeProfile | null {
  if (bars.length === 0) return null;
  let lo = Infinity;
  let hi = -Infinity;
  for (const b of bars) {
    if (b.low < lo) lo = b.low;
    if (b.high > hi) hi = b.high;
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null;
  const size = opts.rowSize && opts.rowSize > 0 ? opts.rowSize : hi > lo ? (hi - lo) / Math.max(1, opts.rows ?? 24) : Math.max(Math.abs(hi) * 0.001, 1e-8);
  const base = Math.floor(lo / size + 1e-9);
  const n = Math.max(1, Math.floor(hi / size + 1e-9) - base + 1);
  const up = new Float64Array(n);
  const dn = new Float64Array(n);
  for (const b of bars) {
    const v = b.volume;
    if (!(v > 0)) continue;
    const isUp = b.close >= b.open;
    const tgt = isUp ? up : dn;
    const r0 = Math.min(n - 1, Math.max(0, Math.floor(b.low / size + 1e-9) - base));
    const r1 = Math.min(n - 1, Math.max(0, Math.floor(b.high / size + 1e-9) - base));
    const span = b.high - b.low;
    if (r0 === r1 || !(span > 0)) {
      tgt[r0] += v;
      continue;
    }
    for (let r = r0; r <= r1; r++) {
      const rl = (base + r) * size;
      const ov = Math.min(b.high, rl + size) - Math.max(b.low, rl);
      if (ov > 0) tgt[r] += (v * ov) / span;
    }
  }
  const rows: ProfileRow[] = [];
  const totals: number[] = [];
  let poc = 0;
  let maxTotal = 0;
  let totalVolume = 0;
  for (let r = 0; r < n; r++) {
    const t = up[r] + dn[r];
    rows.push({ price: (base + r) * size, up: up[r], down: dn[r], total: t });
    totals.push(t);
    totalVolume += t;
    if (t > maxTotal) {
      maxTotal = t;
      poc = r;
    }
  }
  const va = valueArea(totals, poc, opts.vaPct ?? 70);
  return {
    rowSize: size,
    rows,
    poc: rows[poc].price + size / 2,
    vah: rows[va.hi].price + size,
    val: rows[va.lo].price,
    maxTotal,
    totalVolume,
  };
}

// ---------- seanslar ----------

export interface Session {
  /** seansın ilk barının indeksi (dahil) */
  from: number;
  /** son barın indeksi (dahil) */
  to: number;
  /** yerel takvim günü (YYYY-MM-DD) */
  day: string;
}

const dayFmt = new Map<string, Intl.DateTimeFormat>();
function fmtFor(tz: string): Intl.DateTimeFormat {
  let f = dayFmt.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
    dayFmt.set(tz, f);
  }
  return f;
}

/** Piyasanın seans saat dilimi ve gün kayması (FX: New York 17:00'de gün döner). */
export function sessionClock(market: MarketType | undefined): { tz: string; shiftSec: number } {
  if (market === 'BIST') return { tz: 'Europe/Istanbul', shiftSec: 0 };
  if (market === 'US') return { tz: 'America/New_York', shiftSec: 0 };
  if (market === 'FOREX') return { tz: 'America/New_York', shiftSec: 7 * 3600 };
  return { tz: 'UTC', shiftSec: 0 };
}

/** Barları yerel güne göre seanslara böler ("Session" = işlem günü). */
export function splitSessions(bars: Candle[], market: MarketType | undefined): Session[] {
  const { tz, shiftSec } = sessionClock(market);
  const f = fmtFor(tz);
  const hourCache = new Map<number, string>();
  const dayOf = (t: number) => {
    const h = Math.floor((t + shiftSec) / 3600);
    let d = hourCache.get(h);
    if (d === undefined) {
      d = f.format(new Date(h * 3600 * 1000));
      hourCache.set(h, d);
    }
    return d;
  };
  const out: Session[] = [];
  for (let i = 0; i < bars.length; i++) {
    const d = dayOf(bars[i].time);
    const last = out[out.length - 1];
    if (last && last.day === d) last.to = i;
    else out.push({ from: i, to: i, day: d });
  }
  return out;
}

// ---------- TPO (Market Profile) ----------

export const TPO_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

export interface TpoRow {
  price: number;
  letters: string;
}

export interface TpoSession {
  day: string;
  start: number;
  end: number;
  rowSize: number;
  rows: TpoRow[];
  poc: number;
  vah: number;
  val: number;
  /** ilk iki periyodun aralığı (Initial Balance) */
  ibHigh: number;
  ibLow: number;
  open: number;
  close: number;
  periods: number;
}

/**
 * Seans başına TPO: her `periodSec` dilimi bir harf; dilimde fiyatın dokunduğu her satıra o harf yazılır.
 * POC = en çok harf; değer alanı harf sayısıyla (%vaPct).
 */
export function computeTPO(bars: Candle[], sessions: Session[], periodSec: number, rowSize: number, vaPct = 70): TpoSession[] {
  const out: TpoSession[] = [];
  if (!(rowSize > 0)) return out;
  for (const s of sessions) {
    const sb = bars.slice(s.from, s.to + 1);
    if (sb.length === 0) continue;
    const start = sb[0].time;
    let lo = Infinity;
    let hi = -Infinity;
    for (const b of sb) {
      lo = Math.min(lo, b.low);
      hi = Math.max(hi, b.high);
    }
    const base = Math.floor(lo / rowSize + 1e-9);
    const n = Math.max(1, Math.floor(hi / rowSize + 1e-9) - base + 1);
    const letters: string[] = new Array(n).fill('');
    const seen: Array<Set<number>> = Array.from({ length: n }, () => new Set<number>());
    let ibHigh = -Infinity;
    let ibLow = Infinity;
    let periods = 0;
    for (const b of sb) {
      const p = Math.floor((b.time - start) / periodSec);
      periods = Math.max(periods, p + 1);
      if (p < 2) {
        ibHigh = Math.max(ibHigh, b.high);
        ibLow = Math.min(ibLow, b.low);
      }
      const r0 = Math.max(0, Math.floor(b.low / rowSize + 1e-9) - base);
      const r1 = Math.min(n - 1, Math.floor(b.high / rowSize + 1e-9) - base);
      for (let r = r0; r <= r1; r++) {
        if (seen[r].has(p)) continue;
        seen[r].add(p);
        letters[r] += TPO_LETTERS[p % TPO_LETTERS.length];
      }
    }
    const counts = letters.map((l) => l.length);
    let poc = 0;
    const mid = (n - 1) / 2;
    for (let r = 1; r < n; r++) {
      if (counts[r] > counts[poc] || (counts[r] === counts[poc] && Math.abs(r - mid) < Math.abs(poc - mid))) poc = r;
    }
    const va = valueArea(counts, poc, vaPct);
    out.push({
      day: s.day,
      start,
      end: sb[sb.length - 1].time,
      rowSize,
      rows: letters.map((l, r) => ({ price: (base + r) * rowSize, letters: l })),
      poc: (base + poc) * rowSize + rowSize / 2,
      vah: (base + va.hi + 1) * rowSize,
      val: (base + va.lo) * rowSize,
      ibHigh,
      ibLow,
      open: sb[0].open,
      close: sb[sb.length - 1].close,
      periods,
    });
  }
  return out;
}

// ---------- footprint ----------

/** Bir barın footprint'i: satırlar [satır alt fiyatı, alış, satış] artan. */
export interface FootprintBar {
  time: number;
  rows: Array<[number, number, number]>;
  delta: number;
  total: number;
  poc: number;
  complete: boolean;
  /** true: gerçek işlem akışı yok, OHLC'den yaklaşık */
  approx?: boolean;
}

/** Görünür barlara göre footprint satır yüksekliği: ortalama bar aralığı / ~8 satır (hücre metni okunur). */
export function autoFootprintRow(bars: Candle[]): number {
  if (bars.length === 0) return 1;
  const tail = bars.slice(-100);
  const avg = tail.reduce((a, b) => a + (b.high - b.low), 0) / tail.length;
  return niceStep(avg > 0 ? avg / 8 : Math.abs(tail[tail.length - 1].close) * 0.0005);
}

/**
 * İşlem akışı olmayan piyasalar için yaklaşık footprint: hacim [L,H]'ye düzgün yayılır, alış payı
 * kapanışın bar içindeki konumu (CLV) kadardır. Ekranda "yaklaşık" etiketiyle gösterilir.
 */
export function approxFootprint(b: Candle, row: number): FootprintBar {
  const base = Math.floor(b.low / row + 1e-9);
  const top = Math.floor(b.high / row + 1e-9);
  const n = Math.max(1, top - base + 1);
  const span = b.high - b.low;
  const buyShare = span > 0 ? (b.close - b.low) / span : 0.5;
  const rows: Array<[number, number, number]> = [];
  let best = -1;
  let poc = b.close;
  for (let r = 0; r < n; r++) {
    const lo = (base + r) * row;
    const ov = span > 0 ? Math.max(0, Math.min(b.high, lo + row) - Math.max(b.low, lo)) / span : 1 / n;
    const v = b.volume * ov;
    const bv = v * buyShare;
    rows.push([Number(lo.toPrecision(12)), bv, v - bv]);
    if (v > best) {
      best = v;
      poc = lo;
    }
  }
  return { time: b.time, rows, delta: b.volume * (2 * buyShare - 1), total: b.volume, poc, complete: true, approx: true };
}

/** Bar içi "dengesizlik": alış[i] ≥ oran × satış[i-1] (çapraz footprint dengesizliği). */
export function imbalances(rows: Array<[number, number, number]>, ratio = 3): { buy: boolean[]; sell: boolean[] } {
  const buy = rows.map(() => false);
  const sell = rows.map(() => false);
  for (let i = 0; i < rows.length; i++) {
    const below = i > 0 ? rows[i - 1][2] : 0;
    const above = i < rows.length - 1 ? rows[i + 1][1] : 0;
    if (rows[i][1] > 0 && rows[i][1] >= ratio * Math.max(below, 1e-12) && below > 0) buy[i] = true;
    if (rows[i][2] > 0 && rows[i][2] >= ratio * Math.max(above, 1e-12) && above > 0) sell[i] = true;
  }
  return { buy, sell };
}

/**
 * Ekrana göre footprint satırı: görünür fiyat aralığı / (yükseklik / 16 px). Böylece hücre ≥ ~16 px
 * olur ve alış/satış sayıları okunur ("Ticks per row: auto" davranışı). Güzel sayıya yuvarlanır.
 */
export function footprintRowForView(bars: Candle[], heightPx: number): number {
  if (bars.length === 0 || !(heightPx > 0)) return autoFootprintRow(bars);
  let lo = Infinity;
  let hi = -Infinity;
  for (const b of bars) {
    lo = Math.min(lo, b.low);
    hi = Math.max(hi, b.high);
  }
  if (!(hi > lo)) return autoFootprintRow(bars);
  return niceStep((hi - lo) / Math.max(4, heightPx / 16));
}
