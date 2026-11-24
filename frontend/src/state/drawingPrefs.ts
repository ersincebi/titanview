// Faz 22: çizim tercihleri — favori araçlar, çizim şablonları, araç başına stil hafızası.
// Saf mantık (doğrulama + dönüşümler); kalıcılık çalışma alanı JSON'unda (store → workspace).
import type { ToolStyle } from '../chart/drawing/DrawingManager';
import { POINTS_REQUIRED } from '../chart/drawing/toolSpec';
import type { DrawingObject, DrawingToolType } from '../types/market';

export interface DrawingTemplate {
  id: string;
  name: string;
  tool: DrawingToolType;
  style: ToolStyle;
}

export const MAX_FAV_TOOLS = 40;
export const MAX_TEMPLATES = 200;

const isTool = (v: unknown): v is DrawingToolType => typeof v === 'string' && v in POINTS_REQUIRED && v !== 'cursor';
const HEX = /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/;

/** Stil nesnesini doğrular; bilinmeyen/bozuk alanlar atılır. */
export function cleanStyle(raw: unknown): ToolStyle {
  const out: ToolStyle = {};
  if (typeof raw !== 'object' || raw === null) return out;
  const r = raw as Record<string, unknown>;
  if (typeof r.color === 'string' && HEX.test(r.color)) out.color = r.color;
  if (typeof r.width === 'number' && r.width >= 1 && r.width <= 10) out.width = r.width;
  if (r.lineStyle === 'solid' || r.lineStyle === 'dashed' || r.lineStyle === 'dotted') out.lineStyle = r.lineStyle;
  if (typeof r.fontSize === 'number' && r.fontSize >= 8 && r.fontSize <= 72) out.fontSize = r.fontSize;
  return out;
}

/** Çizimden şablon/stil hafızasına alınacak alanlar. */
export function styleOf(d: Pick<DrawingObject, 'color' | 'width' | 'lineStyle' | 'fontSize'>): ToolStyle {
  return cleanStyle({ color: d.color, width: d.width, lineStyle: d.lineStyle, fontSize: d.fontSize });
}

export function toggleFavTool(list: DrawingToolType[], tool: DrawingToolType): DrawingToolType[] {
  if (list.includes(tool)) return list.filter((t) => t !== tool);
  return [...list, tool].slice(-MAX_FAV_TOOLS);
}

export function parseFavTools(raw: unknown): DrawingToolType[] {
  if (!Array.isArray(raw)) return [];
  const out: DrawingToolType[] = [];
  for (const t of raw) if (isTool(t) && !out.includes(t)) out.push(t);
  return out.slice(0, MAX_FAV_TOOLS);
}

export function parseToolStyles(raw: unknown): Partial<Record<DrawingToolType, ToolStyle>> {
  const out: Partial<Record<DrawingToolType, ToolStyle>> = {};
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw)) {
    if (!isTool(k)) continue;
    const st = cleanStyle(v);
    if (Object.keys(st).length) out[k] = st;
  }
  return out;
}

export function parseTemplates(raw: unknown): DrawingTemplate[] {
  if (!Array.isArray(raw)) return [];
  const out: DrawingTemplate[] = [];
  for (const t of raw) {
    if (typeof t !== 'object' || t === null) continue;
    const r = t as Record<string, unknown>;
    if (typeof r.id !== 'string' || typeof r.name !== 'string' || !r.name.trim() || r.name.length > 60 || !isTool(r.tool)) continue;
    out.push({ id: r.id, name: r.name.trim(), tool: r.tool, style: cleanStyle(r.style) });
  }
  return out.slice(0, MAX_TEMPLATES);
}

/** Aynı araç + aynı adla kayıt varsa üzerine yazar ("farklı kaydet" davranışı). */
export function saveTemplate(list: DrawingTemplate[], tool: DrawingToolType, name: string, style: ToolStyle, id = `tpl_${Date.now().toString(36)}`): DrawingTemplate[] {
  const nm = name.trim().slice(0, 60);
  if (!nm) return list;
  const existing = list.find((t) => t.tool === tool && t.name === nm);
  if (existing) return list.map((t) => (t === existing ? { ...t, style: cleanStyle(style) } : t));
  return [...list, { id, name: nm, tool, style: cleanStyle(style) }].slice(-MAX_TEMPLATES);
}

export function templatesFor(list: DrawingTemplate[], tool: DrawingToolType): DrawingTemplate[] {
  return list.filter((t) => t.tool === tool);
}

export function removeTemplate(list: DrawingTemplate[], id: string): DrawingTemplate[] {
  return list.filter((t) => t.id !== id);
}

/** Yüzen favori çubuğu konumu: ekran içinde kalır. */
export function clampBarPos(pos: { x: number; y: number }, vw: number, vh: number, bw = 40, bh = 40): { x: number; y: number } {
  return { x: Math.min(Math.max(0, pos.x), Math.max(0, vw - bw)), y: Math.min(Math.max(0, pos.y), Math.max(0, vh - bh)) };
}
