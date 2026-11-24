// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Faz 20 — hazır gösterge kütüphanesi. Her gösterge `builtins/*.titan` altında gerçek bir TitanScript betiğidir
 *  Üst bilgi yorumları kataloğu besler:
 *
 *   // @tr <Türkçe ad>
 *   // @category ma | osc | trend | volatility | volume | pattern | auto | other
 *   // @desc <kısa açıklama>
 *
 * Başlık, kısa başlık ve overlay `indicator(...)` çağrısından okunur.
 */

import { lang } from '../../state/i18n';
import { CATEGORY_LABELS_EN, DESC_EN } from './desc_en';

export type BuiltinCategory = 'ma' | 'osc' | 'trend' | 'volatility' | 'volume' | 'pattern' | 'auto' | 'other';

export interface BuiltinIndicator {
  /** dosya adı (uzantısız): kalıcı kimlik */
  id: string;
  /** Standart başlığı (İngilizce, indicator() ilk argümanı) */
  title: string;
  /** lejant kısa başlığı */
  shortTitle: string;
  /** Türkçe ad */
  tr: string;
  category: BuiltinCategory;
  desc: string;
  overlay: boolean;
  code: string;
}

export const CATEGORY_LABELS: Record<BuiltinCategory, string> = {
  ma: 'Hareketli ortalamalar',
  osc: 'Osilatörler',
  trend: 'Trend',
  volatility: 'Volatilite ve bantlar',
  volume: 'Hacim',
  pattern: 'Mum formasyonları',
  auto: 'Otomatik çizimler ve seviyeler',
  other: 'Diğer',
};

/** Faz 30 — EN arayüzde kategori adı İngilizce. */
export function categoryLabel(c: BuiltinCategory): string {
  return lang() === 'en' ? (CATEGORY_LABELS_EN[c] ?? CATEGORY_LABELS[c]) : CATEGORY_LABELS[c];
}

/** Faz 30 — katalogda gösterilen ad: TR'de Türkçe ad, EN'de Standart başlığı (indicator() ilk argümanı). */
export function builtinName(b: BuiltinIndicator): string {
  return lang() === 'en' ? b.title : b.tr;
}

const CDL_EN: Record<string, string> = { 'ayı (düşüş)': 'bearish', 'boğa (yükseliş)': 'bullish', nötr: 'neutral' };

/** Faz 30 — açıklama: EN'de `desc_en.ts` (mum formasyonları kalıptan), yoksa Türkçe `@desc`. */
export function builtinDesc(b: BuiltinIndicator): string {
  if (lang() !== 'en') return b.desc;
  if (DESC_EN[b.id]) return DESC_EN[b.id];
  const m = /^Mum formasyonu — (.+?) sinyali \((.+)\)$/.exec(b.desc);
  if (m) return `Candlestick pattern — ${CDL_EN[m[1]] ?? m[1]} signal (${m[2]})`;
  return b.desc;
}

export const CATEGORY_ORDER: BuiltinCategory[] = ['ma', 'osc', 'trend', 'volatility', 'volume', 'pattern', 'auto', 'other'];

const RAW = import.meta.glob('./*.titan', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

const meta = (code: string, key: string): string => code.match(new RegExp(`^//\\s*@${key}\\s+(.+)$`, 'm'))?.[1].trim() ?? '';

/** `indicator("Başlık", "Kısa", overlay=true …)` başlığını, kısa başlığını ve overlay bayrağını okur. */
export function parseDeclaration(code: string): { title: string; shortTitle: string; overlay: boolean } {
  const m = code.match(/^\s*indicator\s*\(([^\n]*)\)\s*$/m);
  const args = m?.[1] ?? '';
  const strs = [...args.matchAll(/(?:^|,)\s*(?:(\w+)\s*=\s*)?"([^"]*)"/g)];
  let title = '';
  let shortTitle = '';
  let pos = 0;
  for (const s of strs) {
    const name = s[1];
    if (name === 'title' || (!name && pos === 0)) title = s[2];
    else if (name === 'shorttitle' || (!name && pos === 1)) shortTitle = s[2];
    if (!name) pos++;
  }
  const overlay = /\boverlay\s*=\s*true\b/.test(args);
  return { title, shortTitle: shortTitle || title, overlay };
}

function build(): BuiltinIndicator[] {
  const out: BuiltinIndicator[] = [];
  for (const [path, code] of Object.entries(RAW)) {
    const id = path.replace(/^\.\//, '').replace(/\.titan$/, '');
    const d = parseDeclaration(code);
    const cat = meta(code, 'category') as BuiltinCategory;
    out.push({
      id,
      title: d.title || id,
      shortTitle: d.shortTitle || id,
      tr: meta(code, 'tr') || d.title || id,
      category: CATEGORY_ORDER.includes(cat) ? cat : 'other',
      desc: meta(code, 'desc'),
      overlay: d.overlay,
      code,
    });
  }
  return out.sort((a, b) => a.tr.localeCompare(b.tr, 'tr'));
}

export const BUILTINS: BuiltinIndicator[] = build();
const BY_ID = new Map(BUILTINS.map((b) => [b.id, b]));

/** v1.0.0 öncesi kayıtlı çalışma alanlarındaki eski kimlikler. */
const LEGACY_IDS: Record<string, string> = {
  rb_intraday_pivots: 'day_floor_pivots',
  rb_knoxville: 'mom_rsi_divergence',
  rb_missed_pivots: 'untouched_daily_pivots',
  rb_reversal: 'macd_stoch_reversal',
  rb_ziv_ghost: 'weekly_mid_pivots',
};

export function builtinById(id: string): BuiltinIndicator | undefined {
  return BY_ID.get(id) ?? BY_ID.get(LEGACY_IDS[id] ?? '');
}

const fold = (s: string) =>
  s
    .toLocaleLowerCase('tr')
    .replace(/ı/g, 'i')
    .replace(/ş/g, 's')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c');

/** Türkçe/İngilizce ad, kısa başlık, açıklama içinde aksan duyarsız arama; tüm kelimeler eşleşmeli. */
export function searchBuiltins(q: string, list: BuiltinIndicator[] = BUILTINS): BuiltinIndicator[] {
  const words = fold(q).split(/\s+/).filter(Boolean);
  if (words.length === 0) return list;
  return list.filter((b) => {
    const hay = fold(`${b.tr} ${b.title} ${b.shortTitle} ${b.id} ${b.desc} ${DESC_EN[b.id] ?? ''}`);
    return words.every((w) => hay.includes(w));
  });
}
