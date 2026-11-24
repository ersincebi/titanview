import { tfmt, lang, localeTag, tt } from './i18n';
// Terminal katmanı: saf mantık (komut ayrıştırma, heatmap düzeni, renk skalaları).
import type { IdeaRow } from '../api/client';

export type TerminalView = 'market' | 'corr' | 'des' | 'news' | 'whale' | 'insight' | 'ideas';

export type Command =
  | { kind: 'chart'; symbol: string }
  | { kind: 'des'; symbol: string }
  | { kind: 'news'; symbol: string | null }
  | { kind: 'whale'; symbol: string | null }
  | { kind: 'insight'; symbol: string | null }
  | { kind: 'view'; view: 'market' | 'corr' | 'ideas' }
  | { kind: 'screener' }
  | { kind: 'error'; message: string };

/** Kısa girişi tam sembole çevirir: THYAO -> THYAO.IS (kataloğa göre), BTC -> BTCUSDT. */
export function resolveSymbol(raw: string, known: string[]): string {
  const up = raw.trim().toUpperCase();
  if (!up) return '';
  if (known.includes(up)) return up;
  const exact = known.find((k) => k.split('.')[0] === up || k === `${up}USDT`);
  return exact ?? up;
}

const VERBS: Record<string, 'chart' | 'des' | 'news'> = { GP: 'chart', G: 'chart', DES: 'des', N: 'news', NEWS: 'news' };

/**
 * Terminal komutu: `<SEMBOL> GP|DES|N`, `NEWS [SEMBOL]`, `HEAT`, `CORR`, `SCR`, yalnız `<SEMBOL>` = grafik.
 * Bilinmeyen kalıp hata döner (sessizce yutulmaz).
 */
export function parseCommand(input: string, known: string[] = []): Command {
  const parts = input.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { kind: 'error', message: tt("Komut boş") };
  const first = parts[0].toUpperCase();
  if (parts.length === 1) {
    if (first === 'HEAT' || first === 'MKT') return { kind: 'view', view: 'market' };
    if (first === 'CORR') return { kind: 'view', view: 'corr' };
    if (first === 'SCR') return { kind: 'screener' };
    if (first === 'IDEAS' || first === 'FIKIR') return { kind: 'view', view: 'ideas' };
    if (first === 'INSIGHT' || first === 'INS') return { kind: 'insight', symbol: null };
    if (first === 'WHALE' || first === 'BALINA') return { kind: 'whale', symbol: null };
    if (first === 'NEWS' || first === 'N') return { kind: 'news', symbol: null };
    return { kind: 'chart', symbol: resolveSymbol(first, known) };
  }
  if (parts.length === 2) {
    const second = parts[1].toUpperCase();
    if (first === 'NEWS' || first === 'N') return { kind: 'news', symbol: resolveSymbol(second, known) };
    if (first === 'WHALE' || first === 'BALINA') return { kind: 'whale', symbol: resolveSymbol(second, known) };
    if (first === 'INSIGHT' || first === 'INS') return { kind: 'insight', symbol: resolveSymbol(second, known) };
    if (second === 'INSIGHT' || second === 'INS') return { kind: 'insight', symbol: resolveSymbol(first, known) };
    const verb = VERBS[second];
    if (verb === 'chart') return { kind: 'chart', symbol: resolveSymbol(first, known) };
    if (verb === 'des') return { kind: 'des', symbol: resolveSymbol(first, known) };
    if (verb === 'news') return { kind: 'news', symbol: resolveSymbol(first, known) };
    return { kind: 'error', message: `Bilinmeyen komut: ${parts[1]} (GP, DES, N, INS)` };
  }
  return { kind: 'error', message: tt("Biçim: <SEMBOL> GP|DES|N · HEAT · CORR · NEWS [SEMBOL] · SCR · INS [SEMBOL] · IDEAS") };
}

// ---------- renk skalaları ----------

function lerp(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t);
}
function mix(c1: [number, number, number], c2: [number, number, number], t: number): string {
  return `rgb(${lerp(c1[0], c2[0], t)},${lerp(c1[1], c2[1], t)},${lerp(c1[2], c2[2], t)})`;
}
const NEUTRAL: [number, number, number] = [42, 46, 57];
const GREEN: [number, number, number] = [8, 153, 129];
const RED: [number, number, number] = [242, 54, 69];

/** Değişim % -> renk; ±3% ve üstü tam doygun. null/NaN = nötr gri. */
export function heatColor(pct: number | null | undefined, full = 3): string {
  if (pct == null || !Number.isFinite(pct)) return mix(NEUTRAL, NEUTRAL, 0);
  const t = Math.min(1, Math.abs(pct) / full);
  return mix(NEUTRAL, pct >= 0 ? GREEN : RED, t);
}

/** Korelasyon (-1..1) -> renk; null = boş hücre. */
export function corrColor(r: number | null | undefined): string {
  if (r == null || !Number.isFinite(r)) return 'transparent';
  return mix(NEUTRAL, r >= 0 ? GREEN : RED, Math.min(1, Math.abs(r)));
}

// ---------- treemap (squarified) ----------

export interface TreeItem {
  key: string;
  weight: number;
}
export interface TreeRect {
  key: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

function worst(row: number[], side: number): number {
  const s = row.reduce((a, b) => a + b, 0);
  const max = Math.max(...row);
  const min = Math.min(...row);
  return Math.max((side * side * max) / (s * s), (s * s) / (side * side * min));
}

/** Squarified treemap. Alanlar ağırlıkla orantılı; ağırlığı <=0 olanlar atlanır. */
export function treemap(items: TreeItem[], width: number, height: number): TreeRect[] {
  const valid = items.filter((i) => i.weight > 0 && Number.isFinite(i.weight)).sort((a, b) => b.weight - a.weight);
  if (valid.length === 0 || width <= 0 || height <= 0) return [];
  const total = valid.reduce((a, b) => a + b.weight, 0);
  const scale = (width * height) / total;
  const areas = valid.map((i) => i.weight * scale);
  const out: TreeRect[] = [];
  let x = 0;
  let y = 0;
  let w = width;
  let h = height;
  let i = 0;
  while (i < valid.length) {
    const side = Math.min(w, h);
    const row: number[] = [areas[i]];
    let j = i + 1;
    while (j < valid.length && worst([...row, areas[j]], side) <= worst(row, side)) {
      row.push(areas[j]);
      j++;
    }
    const rowArea = row.reduce((a, b) => a + b, 0);
    const thick = rowArea / side;
    let off = 0;
    for (let k = 0; k < row.length; k++) {
      const len = row[k] / thick;
      if (w >= h) out.push({ key: valid[i + k].key, x, y: y + off, w: thick, h: len });
      else out.push({ key: valid[i + k].key, x: x + off, y, w: len, h: thick });
      off += len;
    }
    if (w >= h) {
      x += thick;
      w -= thick;
    } else {
      y += thick;
      h -= thick;
    }
    i = j;
  }
  return out;
}

export interface HeatRow {
  symbol: string;
  market: string;
  turnover: number;
}

/**
 * Isı haritası ağırlıkları. Ham işlem hacmi piyasalar arasında karşılaştırılamaz (altın/ons vs hisse
 * adedi): tek bir dev kutu diğerlerini yok eder. Çözüm: (1) hacmin logaritması, (2) "Tümü"nde her
 * piyasa sembol sayısının karekökü oranında alan alır, kendi içinde logaritmik hacimle bölüşür, (3) her kutu en az ortalamanın %35'i.
 */
export function heatWeights(rows: HeatRow[]): Array<{ key: string; weight: number }> {
  if (rows.length === 0) return [];
  const raw = rows.map((r) => ({ key: r.symbol, market: r.market, w: Math.log10(Math.max(r.turnover, 0) + 10) }));
  const totals = new Map<string, number>();
  for (const r of raw) totals.set(r.market, (totals.get(r.market) ?? 0) + r.w);
  // piyasa payı ~ sqrt(sembol sayısı): 3 emtia kutusu 25 hisseyle aynı alanı kapmaz, ama ezilmez de
  const counts = new Map<string, number>();
  for (const r of raw) counts.set(r.market, (counts.get(r.market) ?? 0) + 1);
  let shareSum = 0;
  for (const n of counts.values()) shareSum += Math.sqrt(n);
  const out = raw.map((r) => ({
    key: r.key,
    weight: (r.w / (totals.get(r.market) as number)) * (Math.sqrt(counts.get(r.market) as number) / shareSum),
  }));
  const mean = 1 / out.length;
  return out.map((o) => ({ key: o.key, weight: Math.max(o.weight, mean * 0.35) }));
}

export interface VolumeSpike {
  time: number;
  volume: number;
  ratio: number; // ortalamaya oranı
  change: number; // bar getirisi %
  up: boolean;
}

/** Kaynak yoksa (BIST/ABD): gerçek mumlardan hacim anomalisi (ortalama hacmin >= k katı). Tahmin/uydurma yok. */
export function volumeSpikes(
  candles: Array<{ time: number; open: number; close: number; volume: number }>,
  lookback = 30,
  k = 2.5,
  max = 12
): VolumeSpike[] {
  const out: VolumeSpike[] = [];
  for (let i = lookback; i < candles.length; i++) {
    let sum = 0;
    for (let j = i - lookback; j < i; j++) sum += candles[j].volume;
    const avg = sum / lookback;
    const c = candles[i];
    if (avg > 0 && c.volume >= avg * k) {
      out.push({ time: c.time, volume: c.volume, ratio: c.volume / avg, change: c.open > 0 ? ((c.close - c.open) / c.open) * 100 : 0, up: c.close >= c.open });
    }
  }
  return out.sort((a, b) => b.ratio - a.ratio).slice(0, max);
}

/** "5 dk önce" gibi göreli zaman (tr). */
export function timeAgo(unixSec: number, nowMs = Date.now()): string {
  if (!unixSec) return '';
  const d = Math.max(0, Math.floor(nowMs / 1000 - unixSec));
  if (d < 60) return tt("az önce");
  if (d < 3600) return tfmt("{0} dk önce", Math.floor(d / 60));
  if (d < 86400) return tfmt("{0} sa önce", Math.floor(d / 3600));
  if (d < 86400 * 30) return tfmt("{0} gün önce", Math.floor(d / 86400));
  return new Date(unixSec * 1000).toLocaleDateString(localeTag());
}

export interface CorrPair {
  a: string;
  b: string;
  r: number;
}

/** Matristen en güçlü pozitif ve en negatif çiftler (köşegen ve boş hücreler hariç, her çift bir kez). */
export function topPairs(symbols: string[], matrix: Array<Array<number | null>>, n = 3): { positive: CorrPair[]; negative: CorrPair[] } {
  const all: CorrPair[] = [];
  for (let i = 0; i < symbols.length; i++) {
    for (let j = i + 1; j < symbols.length; j++) {
      const r = matrix[i]?.[j];
      if (r != null && Number.isFinite(r)) all.push({ a: symbols[i], b: symbols[j], r });
    }
  }
  return {
    positive: all.filter((p) => p.r > 0).sort((x, y) => y.r - x.r).slice(0, n),
    negative: all.filter((p) => p.r < 0).sort((x, y) => x.r - y.r).slice(0, n),
  };
}

export type CorrMarket = 'MIX' | 'BIST' | 'CRYPTO' | 'US' | 'FOREX';
export const CORR_MARKETS: Array<[CorrMarket, string]> = [
  ['MIX', tt("🌍 Karışık")],
  ['BIST', '🇹🇷 BIST'],
  ['CRYPTO', tt("₿ Kripto")],
  ['US', '🇺🇸 ABD'],
  ['FOREX', '🥇 Emtia/FX'],
];

// ---------- içgörü / fikirler ----------


/** Fikirler tablosu filtre etiketleri: [etiket, başlık, açıklama]. */
export const IDEA_TAGS: Array<[string, string, string]> = [
  ['breakout', tt("🚀 Kırılım"), tt("20 günlük kapanış tepesi aşıldı")],
  ['pullback', tt("↩ Trendde geri çekilme"), tt("Yükseliş trendinde RSI ≤ 40")],
  ['squeeze', tt("🗜 Sıkışma"), tt("Bollinger genişliği 120 barın en dar %10'unda")],
  ['oversold', tt("🧊 Aşırı satım"), 'RSI(14) ≤ 30'],
  ['overbought', tt("🔥 Aşırı alım"), 'RSI(14) ≥ 70'],
  ['volspike', tt("📣 Hacim patlaması"), tt("Hacim 20g ortalamanın ≥ 2.5 katı")],
  ['weakening', tt("📉 Zayıflayan"), tt("Düşüş trendi")],
];

export function filterIdeas(rows: IdeaRow[], tag: string | null, market: string | null = null): IdeaRow[] {
  return rows.filter((r) => (tag === null || r.tags.includes(tag)) && (market === null || market === 'ALL' || r.market === market));
}

/** -100..100 skoru → renk (kırmızı ↔ gri ↔ yeşil). */
export function scoreColor(score: number): string {
  const t = Math.max(-1, Math.min(1, score / 60));
  if (t >= 0) return `rgb(${lerp(120, 8, t)},${lerp(130, 153, t)},${lerp(145, 129, t)})`;
  return `rgb(${lerp(120, 242, -t)},${lerp(130, 54, -t)},${lerp(145, 69, -t)})`;
}

// Dil sayfa yüklenirken sabitlenir (dil değişimi sayfayı yeniden yükler).
export const WEEKDAYS_TR =
  lang() === 'en' ? ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] : ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];
export const MONTHS_TR =
  lang() === 'en'
    ? ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    : ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];

export const TONE_ICON: Record<string, string> = { bull: '▲', bear: '▼', warn: '⚠', neutral: '●' };
