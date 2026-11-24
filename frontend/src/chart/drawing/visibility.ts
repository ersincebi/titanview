import { tt } from '../../state/i18n';
import type { DrawingObject, DrawingVisibility, TfUnit } from '../../types/market';

/** Standart "Görünürlük" sekmesi: birim başına seçilebilir aralık sınırları. */
export const TF_UNIT_LIMITS: Record<TfUnit, [number, number]> = {
  sec: [1, 59],
  min: [1, 59],
  hour: [1, 24],
  day: [1, 366],
  week: [1, 52],
  month: [1, 12],
};

export const TF_UNIT_LABELS: Record<TfUnit, string> = {
  sec: 'Saniye',
  min: tt("Dakika"),
  hour: tt("Saat"),
  day: tt("Gün"),
  week: tt("Hafta"),
  month: 'Ay',
};

export const TF_UNITS: TfUnit[] = ['sec', 'min', 'hour', 'day', 'week', 'month'];

/** "15m" → {unit:'min', n:15}; "4h" → hour 4; "1d" → day 1; "1w" → week 1; "1M" → month 1; "30s" → sec 30. */
export function parseTimeframe(tf: string): { unit: TfUnit; n: number } | null {
  const m = /^(\d+)([smhdwM])$/.exec(tf.trim());
  if (!m) return null;
  const n = Number(m[1]);
  const unit: TfUnit = ({ s: 'sec', m: 'min', h: 'hour', d: 'day', w: 'week', M: 'month' } as const)[m[2] as 's'];
  return n > 0 ? { unit, n } : null;
}

/** Çizim bu zaman diliminde görünür mü? Görünürlük tanımsızsa her yerde görünür. */
export function isVisibleOn(d: Pick<DrawingObject, 'visibility'>, tf: string): boolean {
  const v = d.visibility;
  if (!v) return true;
  const p = parseTimeframe(tf);
  if (!p) return true;
  if (!(p.unit in v)) return true;
  const r = v[p.unit];
  if (r === null || r === undefined) return false;
  return p.n >= r[0] && p.n <= r[1];
}

/** "Yalnız bu aralıkta göster": diğer birimler kapalı, geçerli birim [n, n]. */
export function onlyThisTimeframe(tf: string): DrawingVisibility | undefined {
  const p = parseTimeframe(tf);
  if (!p) return undefined;
  const out: DrawingVisibility = {};
  for (const u of TF_UNITS) out[u] = u === p.unit ? [p.n, p.n] : null;
  return out;
}

/** Girdi doğrulama: sınırlara kırpar, min>max ise yer değiştirir; tümü varsayılan ise undefined döner. */
export function normalizeVisibility(v: DrawingVisibility | undefined): DrawingVisibility | undefined {
  if (!v) return undefined;
  const out: DrawingVisibility = {};
  let restricted = false;
  for (const u of TF_UNITS) {
    if (!(u in v)) continue;
    const r = v[u];
    if (r === null || r === undefined) {
      out[u] = null;
      restricted = true;
      continue;
    }
    const [lo, hi] = TF_UNIT_LIMITS[u];
    let a = Math.round(Math.min(hi, Math.max(lo, Number(r[0]) || lo)));
    let b = Math.round(Math.min(hi, Math.max(lo, Number(r[1]) || hi)));
    if (a > b) [a, b] = [b, a];
    out[u] = [a, b];
    if (a !== lo || b !== hi) restricted = true;
  }
  return restricted ? out : undefined;
}
