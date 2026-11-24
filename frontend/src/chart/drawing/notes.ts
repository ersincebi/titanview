import { tt } from '../../state/i18n';
import type { DrawingObject, DrawingToolType, TimePricePoint } from '../../types/market';
import { resolveIcon } from './iconSet';
import { fmtPrice, FONT, line, mk, poly, toPx, type Px, type ToolMapper } from './svg';

/** Faz 22: yazı / not / ikon araçları. Metin `label`'da; çok satır `\n`, tablo hücreleri `|`. */

export const DEFAULT_TEXT: Partial<Record<DrawingToolType, string>> = {
  anchored_text: tt("Metin"),
  note: tt("Not"),
  price_note: '',
  pin: tt("İğne"),
  table: 'Başlık 1|Başlık 2\nDeğer 1|Değer 2',
  callout: tt("Açıklama"),
  comment: tt("Yorum"),
  signpost: 'Tabela',
  flag_mark: '',
};

/** Ekrana sabit (grafik değil) çapalı araçlar: nokta = {time: x/genişlik, price: y/yükseklik}. */
export const SCREEN_ANCHORED: ReadonlySet<DrawingToolType> = new Set<DrawingToolType>(['anchored_text']);

export const DEFAULT_FONT = 14;

export function textLines(s: string | undefined): string[] {
  const t = (s ?? '').replace(/\r/g, '');
  return t.length ? t.split('\n') : [''];
}

/** Yaklaşık metin genişliği (px): sans yazı tipinde karakter ≈ 0.6 em. */
export function textWidth(s: string, size: number): number {
  return Math.ceil([...s].length * size * 0.6);
}

export function parseTable(s: string | undefined): string[][] {
  const rows = textLines(s).map((r) => r.split('|').map((c) => c.trim()));
  const cols = Math.max(1, ...rows.map((r) => r.length));
  return rows.map((r) => Array.from({ length: cols }, (_, i) => r[i] ?? ''));
}

function multiline(g: Element, x: number, y: number, lines: string[], color: string, size: number, anchor = 'start', weight = 400): void {
  lines.forEach((s, i) => {
    const t = mk('text', { x, y: y + i * size * 1.3, fill: color, 'font-size': size, 'font-family': FONT, 'text-anchor': anchor, 'font-weight': weight }, g);
    t.textContent = s;
  });
}

const sizeOf = (d: DrawingObject) => d.fontSize ?? DEFAULT_FONT;

/** Kutu boyutu (padding dahil). */
export function boxSize(lines: string[], size: number, pad = 8): { w: number; h: number } {
  const w = Math.max(24, ...lines.map((l) => textWidth(l, size))) + pad * 2;
  const h = lines.length * size * 1.3 + pad * 2 - size * 0.3;
  return { w, h };
}

/** Ekran kesrinden piksele (çapalı metin). */
export function screenPoint(p: TimePricePoint, w: number, h: number): Px {
  return { x: p.time * w, y: p.price * h };
}

export function renderAnchoredText(d: DrawingObject, _m: ToolMapper, g: SVGElement, w: number, h: number): void {
  if (!d.points[0]) return;
  const p = screenPoint(d.points[0], w, h);
  const size = sizeOf(d);
  const lines = textLines(d.label ?? DEFAULT_TEXT.anchored_text);
  const bs = boxSize(lines, size, 2);
  mk('rect', { x: p.x - 2, y: p.y - size, width: bs.w, height: bs.h, fill: 'transparent', stroke: 'none' }, g);
  multiline(g, p.x, p.y, lines, d.color || '#0284C7', size);
}

/** Not: küçük not kâğıdı ikonu; metin üzerine gelince / seçiliyken görünür. */
export function renderNote(d: DrawingObject, m: ToolMapper, g: SVGElement): void {
  const a = d.points[0] && toPx(m, d.points[0]);
  if (!a) return;
  const color = d.color || '#0284C7';
  mk('path', { d: `M${a.x - 9},${a.y - 9} h13 l5,5 v13 h-18 z`, fill: color, stroke: '#FFFFFF', 'stroke-width': 1, 'data-keep-style': '1' }, g);
  mk('path', { d: `M${a.x - 5},${a.y - 2} h10 M${a.x - 5},${a.y + 2} h10 M${a.x - 5},${a.y + 6} h6`, stroke: '#FFFFFF', 'stroke-width': 1.2, fill: 'none', 'data-keep-style': '1' }, g);
  bubble(g, { x: a.x, y: a.y - 14 }, textLines(d.label ?? DEFAULT_TEXT.note), color, sizeOf(d), true);
}

/** Gizlenebilir balon (çizim seçili değilse ve imleç üzerinde değilse CSS ile gizli). */
function bubble(g: Element, tip: Px, lines: string[], color: string, size: number, reveal: boolean): void {
  const grp = mk('g', { class: reveal ? 'drawing-reveal' : 'drawing-bubble' }, g);
  const bs = boxSize(lines, size);
  const x = tip.x - bs.w / 2;
  const y = tip.y - bs.h - 6;
  mk('rect', { x, y, width: bs.w, height: bs.h, rx: 4, fill: '#1E222D', stroke: color, 'stroke-width': 1, 'data-keep-style': '1' }, grp);
  poly(grp, [{ x: tip.x - 5, y: tip.y - 6 }, { x: tip.x + 5, y: tip.y - 6 }, tip], { fill: color, stroke: 'none' });
  multiline(grp, x + 8, y + 8 + size * 0.85, lines, '#D1D4DC', size);
}

/** Fiyat notu: p0 fiyat noktası, p1 etiket; etikette p0 fiyatı (+ isteğe bağlı metin). */
export function renderPriceNote(d: DrawingObject, m: ToolMapper, g: SVGElement): void {
  const a = d.points[0] && toPx(m, d.points[0]);
  if (!a) return;
  const color = d.color || '#0284C7';
  mk('circle', { cx: a.x, cy: a.y, r: 3.5, fill: color, stroke: '#FFFFFF' }, g);
  const b = d.points[1] && toPx(m, d.points[1]);
  if (!b) return;
  line(g, a, b, color, 1);
  const size = sizeOf(d) - 2;
  const label = [fmtPrice(d.points[0].price), ...(d.label ? textLines(d.label) : [])];
  const bs = boxSize(label, size, 6);
  const left = b.x >= a.x ? b.x : b.x - bs.w;
  mk('rect', { x: left, y: b.y - bs.h / 2, width: bs.w, height: bs.h, rx: 3, fill: color, stroke: 'none', 'data-keep-style': '1' }, g);
  multiline(g, left + 6, b.y - bs.h / 2 + 6 + size * 0.85, label, '#FFFFFF', size, 'start', 600);
}

/** İğne: harita iğnesi; balon her zaman görünür (pin metni). */
export function renderPin(d: DrawingObject, m: ToolMapper, g: SVGElement): void {
  const a = d.points[0] && toPx(m, d.points[0]);
  if (!a) return;
  const color = d.color || '#F23645';
  mk('path', { d: `M${a.x},${a.y} c-6,-8 -9,-12 -9,-17 a9,9 0 1 1 18,0 c0,5 -3,9 -9,17 z`, fill: color, stroke: '#FFFFFF', 'stroke-width': 1, 'data-keep-style': '1' }, g);
  mk('circle', { cx: a.x, cy: a.y - 17, r: 3.2, fill: '#FFFFFF', stroke: 'none' }, g);
  const lines = textLines(d.label ?? DEFAULT_TEXT.pin);
  if (lines.join('').length) bubble(g, { x: a.x, y: a.y - 28 }, lines, color, sizeOf(d), true);
}

/** Tablo: hücre ızgarası; ilk satır başlık (koyu). */
export function tableLayout(rows: string[][], size: number): { colW: number[]; rowH: number; w: number; h: number } {
  const cols = rows[0]?.length ?? 1;
  const colW = Array.from({ length: cols }, (_, c) => Math.max(30, ...rows.map((r) => textWidth(r[c] ?? '', size))) + 12);
  const rowH = Math.round(size * 1.3 + 8);
  return { colW, rowH, w: colW.reduce((a, b) => a + b, 0), h: rowH * rows.length };
}

export function renderTable(d: DrawingObject, m: ToolMapper, g: SVGElement): void {
  const a = d.points[0] && toPx(m, d.points[0]);
  if (!a) return;
  const color = d.color || '#787B86';
  const size = sizeOf(d) - 2;
  const rows = parseTable(d.label ?? DEFAULT_TEXT.table);
  const L = tableLayout(rows, size);
  // Standart tablosu: başlık vurgusu yok, ince çerçeveli düz ızgara
  mk('rect', { x: a.x, y: a.y, width: L.w, height: L.h, fill: '#131722', 'fill-opacity': 0.85, stroke: color, 'stroke-width': 1 }, g);
  rows.forEach((r, ri) => {
    let x = a.x;
    r.forEach((cell, ci) => {
      const t = mk('text', { x: x + 6, y: a.y + ri * L.rowH + L.rowH / 2 + size * 0.35, fill: '#D1D4DC', 'font-size': size, 'font-family': FONT }, g);
      t.textContent = cell;
      x += L.colW[ci];
      if (ri === 0 && ci < r.length - 1) line(g, { x, y: a.y }, { x, y: a.y + L.h }, color, 1);
    });
    if (ri > 0) line(g, { x: a.x, y: a.y + ri * L.rowH }, { x: a.x + L.w, y: a.y + ri * L.rowH }, color, 1);
  });
}

/** Açıklama balonu: p0 işaret edilen yer (kuyruk ucu), p1 kutunun sol üstü. */
export function calloutTail(box: { x: number; y: number; w: number; h: number }, tip: Px): Px[] {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const horiz = Math.abs(tip.x - cx) / box.w > Math.abs(tip.y - cy) / box.h;
  const half = Math.min(10, (horiz ? box.h : box.w) / 4);
  if (horiz) {
    const x = tip.x < cx ? box.x : box.x + box.w;
    return [{ x, y: cy - half }, tip, { x, y: cy + half }];
  }
  const y = tip.y < cy ? box.y : box.y + box.h;
  return [{ x: cx - half, y }, tip, { x: cx + half, y }];
}

export function renderCallout(d: DrawingObject, m: ToolMapper, g: SVGElement): void {
  const tip = d.points[0] && toPx(m, d.points[0]);
  if (!tip) return;
  const b = d.points[1] && toPx(m, d.points[1]);
  if (!b) {
    mk('circle', { cx: tip.x, cy: tip.y, r: 3, fill: d.color || '#0284C7' }, g);
    return;
  }
  const color = d.color || '#0284C7';
  const size = sizeOf(d);
  const lines = textLines(d.label ?? DEFAULT_TEXT.callout);
  const bs = boxSize(lines, size);
  const box = { x: b.x, y: b.y, w: bs.w, h: bs.h };
  poly(g, calloutTail(box, tip), { fill: color, stroke: color, 'stroke-width': 1 });
  mk('rect', { x: box.x, y: box.y, width: box.w, height: box.h, rx: 5, fill: color, stroke: color, 'stroke-width': 1 }, g);
  multiline(g, box.x + 8, box.y + 8 + size * 0.85, lines, '#FFFFFF', size);
}

/** Yorum: noktanın sağ üstünde konuşma balonu, kuyruk noktaya iner. */
export function renderComment(d: DrawingObject, m: ToolMapper, g: SVGElement): void {
  const a = d.points[0] && toPx(m, d.points[0]);
  if (!a) return;
  const color = d.color || '#0284C7';
  const size = sizeOf(d);
  const lines = textLines(d.label ?? DEFAULT_TEXT.comment);
  const bs = boxSize(lines, size);
  const x = a.x;
  const y = a.y - bs.h - 10;
  const r = 10;
  mk(
    'path',
    {
      d: `M${x + r},${y} h${bs.w - 2 * r} a${r},${r} 0 0 1 ${r},${r} v${bs.h - 2 * r} a${r},${r} 0 0 1 -${r},${r} H${x + 14} L${x},${a.y} L${x + 4},${y + bs.h} H${x + r} a${r},${r} 0 0 1 -${r},-${r} V${y + r} a${r},${r} 0 0 1 ${r},-${r} z`,
      fill: color,
      'fill-opacity': 0.9,
      stroke: color,
      'stroke-width': 1,
    },
    g
  );
  multiline(g, x + 8, y + 8 + size * 0.85, lines, '#FFFFFF', size);
}

/** Tabela: noktadan yukarı direk + üstte levha (metin). */
export const SIGNPOST_HEIGHT = 46;

export function renderSignpost(d: DrawingObject, m: ToolMapper, g: SVGElement): void {
  const a = d.points[0] && toPx(m, d.points[0]);
  if (!a) return;
  const color = d.color || '#0284C7';
  const size = sizeOf(d) - 1;
  const lines = textLines(d.label ?? DEFAULT_TEXT.signpost);
  const bs = boxSize(lines, size, 6);
  const top = a.y - SIGNPOST_HEIGHT;
  line(g, a, { x: a.x, y: top }, color, 2);
  mk('circle', { cx: a.x, cy: a.y, r: 3, fill: color, stroke: '#FFFFFF' }, g);
  mk('rect', { x: a.x - bs.w / 2, y: top - bs.h, width: bs.w, height: bs.h, rx: 3, fill: color, stroke: 'none', 'data-keep-style': '1' }, g);
  multiline(g, a.x, top - bs.h + 6 + size * 0.85, lines, '#FFFFFF', size, 'middle', 600);
}

/** Bayrak işareti: direk + dalgalı bayrak. */
export function renderFlagMark(d: DrawingObject, m: ToolMapper, g: SVGElement): void {
  const a = d.points[0] && toPx(m, d.points[0]);
  if (!a) return;
  const color = d.color || '#F23645';
  line(g, a, { x: a.x, y: a.y - 26 }, color, 2);
  mk('path', { d: `M${a.x},${a.y - 26} q6,-4 12,0 t12,0 v11 q-6,4 -12,0 t-12,0 z`, fill: color, stroke: 'none' }, g);
}

/** İkon: SVG ikonumuz (`i:anahtar`) veya emoji; boyut = fontSize (varsayılan 28). */
export const DEFAULT_ICON_SIZE = 28;

export function renderIcon(d: DrawingObject, m: ToolMapper, g: SVGElement): void {
  const a = d.points[0] && toPx(m, d.points[0]);
  if (!a) return;
  const size = d.fontSize ?? DEFAULT_ICON_SIZE;
  const r = resolveIcon(d.icon);
  mk('rect', { x: a.x - size / 2, y: a.y - size / 2, width: size, height: size, fill: 'transparent', stroke: 'none' }, g);
  if (r.kind === 'emoji') {
    const t = mk('text', { x: a.x, y: a.y + size * 0.35, 'font-size': size, 'text-anchor': 'middle', 'data-icon': r.char }, g);
    t.textContent = r.char;
    return;
  }
  const s = size / 24;
  const color = d.color || '#0284C7';
  const paint: Record<string, string | number> = r.def.fill
    ? { fill: color, stroke: 'none' }
    : { fill: 'none', stroke: color, 'stroke-width': 1.8 / 1, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'vector-effect': 'non-scaling-stroke', 'data-keep-style': '1' };
  mk('path', { d: r.def.d, transform: `translate(${a.x - size / 2},${a.y - size / 2}) scale(${s})`, 'data-icon': r.def.key, ...paint }, g);
}
