/** Çoklu pane yönetiminin saf mantığı (v5 pane indeksleri ↔ mantıksal kimlikler, ölçek kilidi, büyütme). */

/** Faz 20: grafikteki her osilatör göstergesi kendi pane'ini açar (`study:<uid>`). */
export type PaneId = 'main' | 'rsi' | 'macd' | 'script' | `study:${string}`;
export type ScaleSide = 'right' | 'left' | 'split';
export type CompareScale = 'same' | 'left' | 'own';

/** Fiyat panesi (main) dışındaki kimlikler alt panedir. */
export const SUB_PANES: PaneId[] = ['rsi', 'macd', 'script'];

/**
 * Kullanıcının tercih ettiği sırayı korur; yeni (tercihte olmayan) aktif paneler sona eklenir,
 * artık aktif olmayanlar düşer. `main` her zaman en üsttedir.
 */
export function reconcileOrder(pref: PaneId[], active: PaneId[]): PaneId[] {
  const set = new Set(active);
  const out: PaneId[] = [];
  if (set.has('main')) out.push('main');
  for (const id of pref) if (id !== 'main' && set.has(id) && !out.includes(id)) out.push(id);
  for (const id of active) if (!out.includes(id)) out.push(id);
  return out;
}

/** `id` panesini bir adım yukarı/aşağı taşır; main sabit, sınırda değişmez. */
export function movePane(order: PaneId[], id: PaneId, dir: -1 | 1): PaneId[] {
  const i = order.indexOf(id);
  const j = i + dir;
  if (i < 0 || id === 'main' || j < 1 || j >= order.length) return order;
  const next = [...order];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

/** Sürükle-bırak: `id` panesini `target` panesinin yerine koyar (main'in üstüne bırakılamaz). */
export function dropPane(order: PaneId[], id: PaneId, target: PaneId): PaneId[] {
  if (id === 'main' || id === target) return order;
  const from = order.indexOf(id);
  let to = order.indexOf(target);
  if (from < 0 || to < 0) return order;
  if (to < 1) to = 1;
  const next = order.filter((x) => x !== id);
  next.splice(Math.min(to, next.length), 0, id);
  return next;
}

/** Varsayılan stretch: ana pane 3 birim, her alt pane 1 birim. */
export function defaultStretch(id: PaneId): number {
  return id === 'main' ? 3 : 1;
}

export const MAXIMIZED_OTHERS = 0.0001;
export const MAXIMIZED_SELF = 1000;

/** Büyütülmüş pane için stretch çarpanı; `null` = büyütülmüş pane yok (kayıtlıya dön). */
export function maximizedStretch(order: PaneId[], max: PaneId | null): Map<PaneId, number> | null {
  if (!max || !order.includes(max)) return null;
  return new Map(order.map((id) => [id, id === max ? MAXIMIZED_SELF : MAXIMIZED_OTHERS]));
}

/**
 * Ölçek kilidi (fiyat/bar oranı): kilitleme anındaki bar aralığı `b0` ve fiyat aralığı `span0` sabit orandır.
 * Bar aralığı `b` olunca yeni fiyat aralığı `span0 * b0 / b` (yakınlaşınca aralık daralır); merkez korunur.
 */
export function lockedPriceRange(
  ratio: { b0: number; span0: number },
  barSpacing: number,
  center: number
): { from: number; to: number } | null {
  if (!(barSpacing > 0) || !(ratio.b0 > 0) || !(ratio.span0 > 0) || !Number.isFinite(center)) return null;
  const span = (ratio.span0 * ratio.b0) / barSpacing;
  return { from: center - span / 2, to: center + span / 2 };
}

/** Pane ölçek tarafı → n. seri için priceScaleId ('split': ilk seri sağ, kalanlar sol). */
export function scaleIdFor(side: ScaleSide, seriesIndex: number): 'right' | 'left' {
  if (side === 'left') return 'left';
  if (side === 'split') return seriesIndex === 0 ? 'right' : 'left';
  return 'right';
}

/** Karşılaştırma serisi için priceScaleId. */
export function compareScaleId(mode: CompareScale): string {
  return mode === 'left' ? 'left' : mode === 'own' ? 'cmp-own' : 'right';
}
