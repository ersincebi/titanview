import { tfmt, tt } from '../state/i18n';
import type { Candle } from '../types/market';
import { niceFloor } from './profile';

/**
 * Zamandan bağımsız grafik türleri (Renko, Line Break, Range). Tuğlalar/çizgiler kaynak mumdan
 * türetilir; lightweight-charts zaman ekseni gerektirdiği için aynı kaynak mumdan çıkan çoklu
 * tuğlalar mumun süresi içine eşit aralıkla yerleştirilir (sıralama ve tekillik korunur).
 */

/** Wilder ATR (son `period` bar); veri azsa mevcut barların ortalaması. */
export function atrOf(candles: Candle[], period = 14): number {
  if (candles.length === 0) return 0;
  let sum = 0;
  let n = 0;
  for (let i = Math.max(1, candles.length - period); i < candles.length; i++) {
    const c = candles[i];
    const pc = candles[i - 1].close;
    sum += Math.max(c.high - c.low, Math.abs(c.high - pc), Math.abs(c.low - pc));
    n++;
  }
  if (n === 0) return candles[0].high - candles[0].low;
  return sum / n;
}

function minStep(candles: Candle[]): number {
  let step = Infinity;
  for (let i = 1; i < candles.length; i++) {
    const d = candles[i].time - candles[i - 1].time;
    if (d > 0 && d < step) step = d;
  }
  return Number.isFinite(step) ? step : 60;
}

interface RawBrick {
  src: number;
  open: number;
  close: number;
  high: number;
  low: number;
  volume: number;
}

/** Aynı kaynak mumdan çıkan tuğlalara benzersiz, artan zaman verir. */
function assignTimes(bricks: RawBrick[], candles: Candle[]): Candle[] {
  const step = minStep(candles);
  const out: Candle[] = [];
  let i = 0;
  while (i < bricks.length) {
    let j = i;
    while (j < bricks.length && bricks[j].src === bricks[i].src) j++;
    const count = j - i;
    const gap = Math.max(1, Math.floor((step - 1) / Math.max(1, count)));
    const base = candles[bricks[i].src].time;
    for (let k = 0; k < count; k++) {
      const b = bricks[i + k];
      // Bir mumda adım saniyesinden çok tuğla çıkarsa (örn. 1m'de Range) zaman sonraki mumun
      // başlangıcını aşabilir; LWC kesin artan zaman ister → öncekinden en az 1 sn ileri.
      const t = base + k * gap;
      out.push({
        time: out.length > 0 && t <= out[out.length - 1].time ? out[out.length - 1].time + 1 : t,
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
        volume: b.volume,
      });
    }
    i = j;
  }
  return out;
}

export function toRenko(candles: Candle[], boxSize?: number): Candle[] {
  if (candles.length === 0) return [];
  const box = boxSize && boxSize > 0 ? boxSize : atrOf(candles, 14);
  if (!(box > 0)) return [];
  const bricks: RawBrick[] = [];
  const base = candles[0].close;
  let lastOpen = base;
  let lastClose = base;
  let dir: 0 | 1 | -1 = 0;
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i].close;
    const startLen = bricks.length;
    for (;;) {
      const upAt = dir === 1 ? lastClose + box : dir === -1 ? lastOpen + box : base + box;
      const downAt = dir === -1 ? lastClose - box : dir === 1 ? lastOpen - box : base - box;
      let nb: { o: number; c: number } | null = null;
      if (c >= upAt - 1e-9) {
        const o = dir === 1 ? lastClose : dir === -1 ? lastOpen : base;
        nb = { o, c: o + box };
        dir = 1;
      } else if (c <= downAt + 1e-9) {
        const o = dir === -1 ? lastClose : dir === 1 ? lastOpen : base;
        nb = { o, c: o - box };
        dir = -1;
      }
      if (!nb) break;
      lastOpen = nb.o;
      lastClose = nb.c;
      bricks.push({ src: i, open: nb.o, close: nb.c, high: Math.max(nb.o, nb.c), low: Math.min(nb.o, nb.c), volume: 0 });
      if (bricks.length - startLen > 5000) break; // koruma
    }
    const made = bricks.length - startLen;
    for (let k = startLen; k < bricks.length; k++) bricks[k].volume = candles[i].volume / made;
  }
  return assignTimes(bricks, candles);
}

/** N-line break (varsayılan 3). Her kapanış en fazla bir çizgi üretir. */
export function toLineBreak(candles: Candle[], lines = 3): Candle[] {
  if (candles.length < 2) return [];
  const out: Candle[] = [];
  let first = true;
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i].close;
    if (first) {
      const o = candles[0].close;
      if (c === o) continue;
      out.push({ time: candles[i].time, open: o, close: c, high: Math.max(o, c), low: Math.min(o, c), volume: candles[i].volume });
      first = false;
      continue;
    }
    const last = out[out.length - 1];
    const up = last.close > last.open;
    const recent = out.slice(-lines);
    const hi = Math.max(...recent.map((r) => Math.max(r.open, r.close)));
    const lo = Math.min(...recent.map((r) => Math.min(r.open, r.close)));
    let o: number | null = null;
    if (up) {
      if (c > last.close) o = last.close;
      else if (c < lo) o = last.open; // dönüş: son çizginin açılışından aşağı
    } else if (c < last.close) o = last.close;
    else if (c > hi) o = last.open;
    if (o === null) continue;
    out.push({ time: candles[i].time, open: o, close: c, high: Math.max(o, c), low: Math.min(o, c), volume: candles[i].volume });
  }
  return out;
}

/** Range bars: yüksek-düşük aralığı `range` olunca bar kapanır (O-H-L-C ya da O-L-H-C yolu varsayımıyla). */
export function toRange(candles: Candle[], range?: number): Candle[] {
  if (candles.length === 0) return [];
  const R = range && range > 0 ? range : atrOf(candles, 14) / 2;
  if (!(R > 0)) return [];
  const bricks: RawBrick[] = [];
  let cur = { open: candles[0].open, high: candles[0].open, low: candles[0].open };
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const path = c.close >= c.open ? [c.open, c.low, c.high, c.close] : [c.open, c.high, c.low, c.close];
    const startLen = bricks.length;
    for (const p of path) {
      let price = p;
      for (let guard = 0; guard < 5000; guard++) {
        cur.high = Math.max(cur.high, price);
        cur.low = Math.min(cur.low, price);
        if (cur.high - cur.low < R - 1e-9) break;
        const up = price >= cur.open;
        const close = up ? cur.low + R : cur.high - R;
        const high = up ? close : cur.high;
        const low = up ? cur.low : close;
        bricks.push({ src: i, open: cur.open, close, high, low, volume: 0 });
        cur = { open: close, high: close, low: close };
        if (up ? price <= close : price >= close) break;
      }
    }
    const made = bricks.length - startLen;
    for (let k = startLen; k < bricks.length; k++) bricks[k].volume = c.volume / Math.max(1, made);
  }
  return assignTimes(bricks, candles);
}

/** Grafik tipi parametreleri (varsayılan: Ayarlar → Sembol). Hepsi kalıcı; varsayılanlar standart formül. */
export interface StyleParams {
  renko: { mode: 'atr' | 'fixed'; atrLen: number; box: number };
  range: { mode: 'atr' | 'fixed'; atrLen: number; range: number };
  linebreak: { lines: number };
  kagi: { mode: 'atr' | 'percent' | 'fixed'; atrLen: number; value: number };
  pnf: { mode: 'atr' | 'percent' | 'fixed'; atrLen: number; box: number; reversal: number; source: 'close' | 'hl' };
  /** Seans / görünür aralık hacim profili: satır sayısı (0 = otomatik) ve değer alanı yüzdesi */
  profile: { rows: number; vaPct: number };
  /** TPO periyodu (dakika) */
  tpo: { periodMin: number };
  /** Footprint satır yüksekliği (0 = otomatik, fiyat birimi) */
  footprint: { row: number };
}

export const DEFAULT_STYLE_PARAMS: StyleParams = {
  renko: { mode: 'atr', atrLen: 14, box: 1 },
  range: { mode: 'atr', atrLen: 14, range: 1 },
  linebreak: { lines: 3 },
  kagi: { mode: 'atr', atrLen: 14, value: 1 },
  pnf: { mode: 'atr', atrLen: 14, box: 1, reversal: 3, source: 'close' },
  profile: { rows: 24, vaPct: 70 },
  tpo: { periodMin: 30 },
  footprint: { row: 0 },
};

/** Eksik/bozuk alanları varsayılanla tamamlar (eski kayıtlar için). */
export function normalizeStyleParams(raw: unknown): StyleParams {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, Record<string, unknown>>;
  const out = JSON.parse(JSON.stringify(DEFAULT_STYLE_PARAMS)) as StyleParams;
  for (const k of Object.keys(out) as Array<keyof StyleParams>) {
    const src = r[k];
    if (!src || typeof src !== 'object') continue;
    const dst = out[k] as unknown as Record<string, unknown>;
    for (const f of Object.keys(dst)) {
      const v = src[f];
      if (typeof v === typeof dst[f] && (typeof v !== 'number' || (Number.isFinite(v) && v >= 0))) dst[f] = v;
    }
  }
  return out;
}

/** Kagi çizgisi parçası: kalın (yang) ya da ince (yin). */
export interface KagiPart {
  from: number;
  to: number;
  yang: boolean;
}

/** Türetilmiş çubuk: Kagi/P&F'te çizim bilgisi taşır; diğerlerinde düz mum. */
export type DerivedBar = Candle & { kagi?: KagiPart[]; pnf?: { kind: 'X' | 'O'; box: number } };

/** Wilder ATR (ta.atr = RMA) son barda. */
export function wilderAtr(candles: Candle[], len: number): number {
  const n = candles.length;
  if (n === 0) return 0;
  const L = Math.max(1, Math.round(len));
  const tr = (i: number) => {
    const c = candles[i];
    if (i === 0) return c.high - c.low;
    const pc = candles[i - 1].close;
    return Math.max(c.high - c.low, Math.abs(c.high - pc), Math.abs(c.low - pc));
  };
  if (n <= L) {
    let s = 0;
    for (let i = 0; i < n; i++) s += tr(i);
    return s / n;
  }
  let r = 0;
  for (let i = 0; i < L; i++) r += tr(i);
  r /= L;
  for (let i = L; i < n; i++) r = (r * (L - 1) + tr(i)) / L;
  return r;
}

/** Standart Kagi/P&F ATR kutusu: Wilder ATR, güzel sayıya aşağı yuvarlı (BTC 1G: 3023 → 2500, standart formül). */
export function niceAtr(candles: Candle[], len: number): number {
  return niceFloor(wilderAtr(candles, len));
}

function reversalAmount(mode: 'atr' | 'percent' | 'fixed', value: number, atrLen: number, candles: Candle[]): number {
  if (mode === 'fixed') return value;
  if (mode === 'percent') return (candles[candles.length - 1].close * value) / 100;
  return niceAtr(candles, atrLen);
}

/** Lejant etiketi: "Kagi [ATR(14), 2500]", "PnF [ATR(14), 2500, 3]", "Renko [ATR(14), 120]". */
export function styleTag(mode: string, all: Candle[], p: StyleParams = DEFAULT_STYLE_PARAMS, basis?: Candle[]): string {
  const candles = basis && basis.length >= 2 ? basis : all;
  if (candles.length < 2) return '';
  const fmt = (v: number) => (v >= 100 ? v.toFixed(0) : v >= 1 ? String(Number(v.toFixed(2))) : String(Number(v.toPrecision(3))));
  const src = (m: string, len: number, v: number, val: number) => (m === 'atr' ? `ATR(${len}), ${fmt(val)}` : m === 'percent' ? `${v}%` : fmt(v));
  switch (mode) {
    case 'renko':
      return `Renko [${src(p.renko.mode, p.renko.atrLen, p.renko.box, atrOf(candles, p.renko.atrLen))}]`;
    case 'range':
      return `Range [${src(p.range.mode, p.range.atrLen, p.range.range, atrOf(candles, p.range.atrLen) / 2)}]`;
    case 'linebreak':
      return tfmt("Çizgi kırılımı [{0}]", p.linebreak.lines);
    case 'kagi':
      return `Kagi [${src(p.kagi.mode, p.kagi.atrLen, p.kagi.value, niceAtr(candles, p.kagi.atrLen))}]`;
    case 'pnf': {
      const box = p.pnf.mode === 'atr' ? niceAtr(candles, p.pnf.atrLen) : p.pnf.box;
      return `PnF [${src(p.pnf.mode, p.pnf.atrLen, p.pnf.box, box)}, ${p.pnf.reversal}]`;
    }
    default:
      return '';
  }
}

/**
 * Kagi: fiyat dönüş miktarı kadar ters giderse yeni çizgi açılır. Çizgi önceki omuzun (tepe)
 * üstüne çıkınca kalın (yang), önceki belin (dip) altına inince ince (yin) olur — standart kural.
 */
export function toKagi(candles: Candle[], p: StyleParams['kagi'] = DEFAULT_STYLE_PARAMS.kagi, basis: Candle[] = candles): DerivedBar[] {
  if (candles.length < 2) return [];
  const rev = reversalAmount(p.mode, p.value, p.atrLen, basis.length >= 2 ? basis : candles);
  if (!(rev > 0)) return [];
  interface Seg { src: number; from: number; to: number }
  const segs: Seg[] = [];
  let start = candles[0].close;
  let dir = 0;
  let ext = start;
  let extSrc = 0;
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i].close;
    if (dir === 0) {
      if (Math.abs(c - start) >= rev) {
        dir = c > start ? 1 : -1;
        ext = c;
        extSrc = i;
      }
      continue;
    }
    if ((dir === 1 && c > ext) || (dir === -1 && c < ext)) {
      ext = c;
      extSrc = i;
    } else if ((dir === 1 && ext - c >= rev) || (dir === -1 && c - ext >= rev)) {
      segs.push({ src: extSrc, from: start, to: ext });
      start = ext;
      dir = -dir;
      ext = c;
      extSrc = i;
    }
  }
  if (dir !== 0) segs.push({ src: extSrc, from: start, to: ext });
  // kalınlık: omuz/bel kırılımları
  // Başlangıç noktası ilk bel (yükselişte) ya da ilk omuz (düşüşte) sayılır.
  const firstUp = segs.length > 0 ? segs[0].to > segs[0].from : true;
  let yang = firstUp;
  let shoulder = firstUp ? -Infinity : segs.length > 0 ? segs[0].from : -Infinity;
  let waist = firstUp && segs.length > 0 ? segs[0].from : Infinity;
  const raws: Array<RawBrick & { parts: KagiPart[] }> = [];
  for (const sg of segs) {
    const up = sg.to > sg.from;
    const parts: KagiPart[] = [];
    if (up) {
      if (!yang && sg.to > shoulder && shoulder > sg.from) {
        parts.push({ from: sg.from, to: shoulder, yang: false }, { from: shoulder, to: sg.to, yang: true });
        yang = true;
      } else {
        if (!yang && sg.to > shoulder) yang = true;
        parts.push({ from: sg.from, to: sg.to, yang });
      }
      shoulder = sg.to;
    } else {
      if (yang && sg.to < waist && waist < sg.from) {
        parts.push({ from: sg.from, to: waist, yang: true }, { from: waist, to: sg.to, yang: false });
        yang = false;
      } else {
        if (yang && sg.to < waist) yang = false;
        parts.push({ from: sg.from, to: sg.to, yang });
      }
      waist = sg.to;
    }
    raws.push({ src: sg.src, open: sg.from, close: sg.to, high: Math.max(sg.from, sg.to), low: Math.min(sg.from, sg.to), volume: candles[sg.src].volume, parts });
  }
  const timed = assignTimes(raws, candles);
  return timed.map((b, i) => ({ ...b, kagi: raws[i].parts }));
}

/**
 * Nokta-Şekil (P&F): kutu boyutu + dönüş (kutu sayısı). X sütunu yükseliş, O sütunu düşüş.
 * Kaynak "close" ya da "hl" (yüksek/düşük): X'te önce yüksek, O'da önce düşük denenir.
 */
export function toPnF(candles: Candle[], p: StyleParams['pnf'] = DEFAULT_STYLE_PARAMS.pnf, basis: Candle[] = candles): DerivedBar[] {
  if (candles.length < 2) return [];
  const bs = basis.length >= 2 ? basis : candles;
  const box = p.mode === 'fixed' ? p.box : p.mode === 'percent' ? (bs[bs.length - 1].close * p.box) / 100 : niceAtr(bs, p.atrLen);
  const R = Math.max(1, Math.round(p.reversal));
  if (!(box > 0)) return [];
  const q = (v: number) => Math.round(v / box) * box;
  const fl = (v: number) => Math.floor(v / box + 1e-9) * box;
  const ce = (v: number) => Math.ceil(v / box - 1e-9) * box;
  interface Col { src: number; kind: 'X' | 'O'; top: number; bottom: number; vol: number }
  const cols: Col[] = [];
  const anchor = q(candles[0].close);
  let cur: Col | null = null;
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const hi = p.source === 'hl' ? c.high : c.close;
    const lo = p.source === 'hl' ? c.low : c.close;
    if (!cur) {
      if (fl(hi) >= anchor + box) cur = { src: i, kind: 'X', bottom: anchor + box, top: fl(hi), vol: c.volume };
      else if (ce(lo) <= anchor - box) cur = { src: i, kind: 'O', top: anchor - box, bottom: ce(lo), vol: c.volume };
      if (cur) cols.push(cur);
      continue;
    }
    cur.vol += c.volume;
    if (cur.kind === 'X') {
      if (fl(hi) >= cur.top + box) cur.top = fl(hi);
      else if (ce(lo) <= cur.top - R * box) {
        cur = { src: i, kind: 'O', top: cur.top - box, bottom: ce(lo), vol: c.volume };
        cols.push(cur);
      }
    } else if (ce(lo) <= cur.bottom - box) cur.bottom = ce(lo);
    else if (fl(hi) >= cur.bottom + R * box) {
      cur = { src: i, kind: 'X', bottom: cur.bottom + box, top: fl(hi), vol: c.volume };
      cols.push(cur);
    }
  }
  const raws: RawBrick[] = cols.map((k) => ({
    src: k.src,
    open: k.kind === 'X' ? k.bottom : k.top,
    close: k.kind === 'X' ? k.top : k.bottom,
    high: k.top,
    low: k.bottom,
    volume: k.vol,
  }));
  const timed = assignTimes(raws, candles);
  return timed.map((b, i) => ({ ...b, pnf: { kind: cols[i].kind, box } }));
}

export type DerivedStyle = 'renko' | 'linebreak' | 'range' | 'kagi' | 'pnf';

export function isDerivedStyle(mode: string): mode is DerivedStyle {
  return mode === 'renko' || mode === 'linebreak' || mode === 'range' || mode === 'kagi' || mode === 'pnf';
}

/**
 * `basis`: kutu/dönüş boyutunun (ATR / yüzde) hesaplandığı mumlar. Varsayılan olarak bu boyut veri yüklenirken
 * belirlenir ve canlı tick'lerde sabit kalır (Faz 30); verilmezse `candles`.
 */
export function deriveCandles(mode: DerivedStyle, candles: Candle[], p: StyleParams = DEFAULT_STYLE_PARAMS, basis: Candle[] = candles): DerivedBar[] {
  switch (mode) {
    case 'renko':
      return toRenko(candles, p.renko.mode === 'fixed' ? p.renko.box : atrOf(basis, p.renko.atrLen));
    case 'range':
      return toRange(candles, p.range.mode === 'fixed' ? p.range.range : atrOf(basis, p.range.atrLen) / 2);
    case 'linebreak':
      return toLineBreak(candles, Math.max(1, Math.round(p.linebreak.lines)));
    case 'kagi':
      return toKagi(candles, p.kagi, basis);
    case 'pnf':
      return toPnF(candles, p.pnf, basis);
  }
}

/** `t`'den büyük olmayan son çubuğun indeksi (barTimes artan); yoksa -1. */
export function barIndexAtOrBefore(barTimes: number[], t: number): number {
  let lo = 0;
  let hi = barTimes.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (barTimes[mid] <= t) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

/**
 * Kaynak-zamanlı noktaları türetilmiş (Renko/Range/Line Break) çubuk zamanlarına hizalar:
 * her nokta, kendinden önceki son çubuğa taşınır; aynı çubuğa düşenlerden sonuncusu kalır;
 * ilk çubuktan önceki noktalar atılır. Çıktı strictly artandır (lightweight-charts şartı).
 */
export function alignToBars<T extends { time: number }>(points: T[], barTimes: number[]): T[] {
  if (barTimes.length === 0) return [];
  const out: T[] = [];
  for (const p of points) {
    const i = barIndexAtOrBefore(barTimes, p.time);
    if (i < 0) continue;
    const bt = barTimes[i];
    const aligned = { ...p, time: bt };
    if (out.length > 0 && out[out.length - 1].time === bt) out[out.length - 1] = aligned;
    else out.push(aligned);
  }
  return out;
}
