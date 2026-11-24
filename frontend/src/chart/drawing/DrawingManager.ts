import { tt } from '../../state/i18n';
import {
  clearSymbolDrawings,
  deleteDrawingById,
  fetchDrawings,
  persistDrawing,
} from '../../api/client';
import type {
  Candle,
  DrawingObject,
  DrawingToolType,
  TimePricePoint,
} from '../../types/market';
import {
  renderChannel,
  renderDateRange,
  renderFixedVP,
  renderEllipse,
  renderFibExtension,
  renderExtendedOrArrow,
  renderHRay,
  renderInfoLine,
  renderPitchfork,
  renderPriceLabel,
  renderPriceRange,
} from './ExtraTools';
import { FibRetracementTool } from './FibRetracementTool';
import { HorizontalLineTool } from './HorizontalLineTool';
import { RiskRewardTool } from './RiskRewardTool';
import { SupplyDemandBoxTool } from './SupplyDemandBoxTool';
import { effectiveMagnet, snapPrice, type MagnetMode } from './magnet';
import { DEFAULT_TEXT, SCREEN_ANCHORED } from './notes';
import { FREEHAND_TOOLS, TOOL_DEFS } from './registry';
import { DEFAULT_TOOL_COLOR, LINE_DASH, MIN_VARIABLE_POINTS, POINTS_REQUIRED } from './toolSpec';
import { isVisibleOn } from './visibility';
import {
  type CoordinateMapper,
  TrendlineTool,
} from './TrendlineTool';

export interface DrawingManagerOptions {
  svg?: SVGSVGElement;
  mapper: CoordinateMapper & { getCandles?: () => Candle[] };
  onDrawingCompleted?: (drawing: DrawingObject) => void;
  onToolReset?: () => void;
  onSelectionChanged?: (drawing: DrawingObject | null) => void;
  /** sürükleme / stil / metin değişimi bittiğinde (kalıcılık için) */
  onDrawingChanged?: (drawing: DrawingObject) => void;
  autoPersist?: boolean;
  /** Çizim modunda iki parmak: ölçek (1 = değişmez), merkez x (svg'ye göre px) ve yatay kayma (px). */
  onPinch?: (g: PinchDelta) => void;
  /** araç başına stil hafızası / varsayılan şablon: yeni çizime uygulanır */
  toolStyle?: (tool: DrawingToolType) => ToolStyle | undefined;
  /** Faz 29: birleşik kabuk geri al / yinele yığınına kayıt */
  onHistoryCommit?: (prev: DrawingObject[], next: DrawingObject[], labelTr: string, labelEn: string) => void;
}

/** Araç başına hatırlanan stil (varsayılan: son kullanılan stil + "varsayılan şablon"). */
export type ToolStyle = Partial<Pick<DrawingObject, 'color' | 'width' | 'lineStyle' | 'fontSize'>>;

export interface PinchDelta {
  scale: number;
  centerX: number;
  dx: number;
}

export type DrawingPatch = Partial<
  Pick<DrawingObject, 'color' | 'width' | 'lineStyle' | 'label' | 'locked' | 'hidden' | 'fontSize' | 'icon' | 'visibility'>
>;

interface DragState {
  id: string;
  /** 'body' veya nokta indeksi ('0','1'...) veya dikdörtgen köşesi ('c01') */
  anchor: string;
  startClientX: number;
  startClientY: number;
  origPts: TimePricePoint[];
  origPx: Array<{ x: number; y: number }>;
  moved: boolean;
}

/** Çizimin görünür çizgilerine kalınlık / kesik çizgi tercihini uygular. */
export function applyStrokeOverrides(g: SVGElement, d: DrawingObject): void {
  if (d.width === undefined && d.lineStyle === undefined) return;
  g.querySelectorAll('line, path, rect, polyline').forEach((e) => {
    if (e.getAttribute('fill') === '#1E222D') return; // rozetler
    const stroke = e.getAttribute('stroke');
    if (!stroke || stroke === 'none') return;
    if (e.getAttribute('data-keep-style') !== null) return;
    if (d.width !== undefined) e.setAttribute('stroke-width', String(d.width));
    if (d.lineStyle !== undefined) {
      const dash = LINE_DASH[d.lineStyle];
      if (dash) e.setAttribute('stroke-dasharray', dash);
      else e.removeAttribute('stroke-dasharray');
    }
  });
}

export function formatVolume(val: number): string {
  if (val >= 1e9) return (val / 1e9).toFixed(2) + 'B';
  if (val >= 1e6) return (val / 1e6).toFixed(2) + 'M';
  if (val >= 1e3) return (val / 1e3).toFixed(1) + 'K';
  return val.toFixed(0);
}

/**
 * Snaps a target price to the nearest OHLC value of a candle at the given time.
 */
export function snapPriceToCandle(
  price: number,
  time: number,
  candles: Candle[]
): number {
  if (!candles || candles.length === 0) return price;
  const bar = candles.find((c) => c.time === time);
  if (!bar) return price;

  const candidates = [bar.open, bar.high, bar.low, bar.close];
  let best = candidates[0];
  let minDiff = Math.abs(price - best);

  for (let i = 1; i < candidates.length; i++) {
    const d = Math.abs(price - candidates[i]);
    if (d < minDiff) {
      minDiff = d;
      best = candidates[i];
    }
  }
  return best;
}

export class DrawingManager {
  private svg?: SVGSVGElement;
  private mapper: CoordinateMapper & { getCandles?: () => Candle[] };
  private activeTool: DrawingToolType = 'cursor';
  private activeColor = '#0284C7';
  private currentSymbol = 'THYAO.IS';
  private currentTimeframe = '15m';
  private magnetMode: MagnetMode = 'off';
  /** Ctrl/⌘ basılıyken mıknatıs tersine döner */
  private magnetInvert = false;
  private stayInDrawing = false;
  private iconChoice = 'i:star';
  private toolStyle?: (tool: DrawingToolType) => ToolStyle | undefined;
  private hidden = false;
  private autoPersist = true;

  private drawings: DrawingObject[] = [];
  private draftPoints: TimePricePoint[] = [];
  private hoverPoint: TimePricePoint | null = null;
  private brushPoints: TimePricePoint[] = [];
  private isBrushing = false;
  private selectedDrawingId: string | null = null;
  private undoStack: DrawingObject[][] = [];
  private redoStack: DrawingObject[][] = [];

  private onDrawingCompleted?: (drawing: DrawingObject) => void;
  private onToolReset?: () => void;
  private onSelectionChanged?: (drawing: DrawingObject | null) => void;
  private onDrawingChanged?: (drawing: DrawingObject) => void;
  private onPinch?: (g: PinchDelta) => void;
  private onHistoryCommit?: (prev: DrawingObject[], next: DrawingObject[], labelTr: string, labelEn: string) => void;
  private allLocked = false;
  private clipboard: DrawingObject | null = null;
  private dragBeforeSnap: DrawingObject[] | null = null;
  private drag: DragState | null = null;

  constructor(options: DrawingManagerOptions) {
    this.svg = options.svg;
    // Faz 30: boyut her çizimde clientWidth ile okunmasın (zorunlu reflow); ResizeObserver ile önbellek
    if (this.svg && typeof ResizeObserver !== 'undefined') {
      const svg = this.svg;
      new ResizeObserver(() => {
        this.sizeCache = { w: svg.clientWidth || 1000, h: svg.clientHeight || 600 };
      }).observe(svg);
    }
    this.mapper = options.mapper;
    this.onDrawingCompleted = options.onDrawingCompleted;
    this.onToolReset = options.onToolReset;
    this.onSelectionChanged = options.onSelectionChanged;
    this.onDrawingChanged = options.onDrawingChanged;
    this.onPinch = options.onPinch;
    this.onHistoryCommit = options.onHistoryCommit;
    this.toolStyle = options.toolStyle;
    if (options.autoPersist !== undefined) {
      this.autoPersist = options.autoPersist;
    }

    if (this.svg) {
      this.bindSvgEvents();
    }
  }

  public setContext(symbol: string, timeframe: string): void {
    this.currentSymbol = symbol;
    this.currentTimeframe = timeframe;
    this.draftPoints = [];
    this.hoverPoint = null;
  }

  public getContext(): { symbol: string; timeframe: string } {
    return { symbol: this.currentSymbol, timeframe: this.currentTimeframe };
  }

  public setTool(tool: DrawingToolType, color = '#0284C7'): void {
    this.activeTool = tool;
    this.activeColor = color;
    this.draftPoints = [];
    this.hoverPoint = null;

    if (this.svg) {
      this.svg.style.pointerEvents = tool === 'cursor' ? 'none' : 'auto';
      this.svg.style.cursor = tool === 'cursor' ? 'default' : 'crosshair';
      this.svg.style.touchAction = tool === 'cursor' ? 'auto' : 'none';
    }
    this.render();
  }

  public getTool(): DrawingToolType {
    return this.activeTool;
  }

  /** true → güçlü, false → kapalı (eski API); veya doğrudan mod. */
  public setMagnet(mode: boolean | MagnetMode): void {
    this.magnetMode = mode === true ? 'strong' : mode === false ? 'off' : mode;
  }

  public getMagnetMode(): MagnetMode {
    return this.magnetMode;
  }

  public isMagnetEnabled(): boolean {
    return this.magnetMode !== 'off';
  }

  /** Ctrl/⌘ geçici ters çevirme (fare olaylarından). */
  public setMagnetInvert(on: boolean): void {
    this.magnetInvert = on;
  }

  /** Çizimde kal: araç tamamlanınca imlece dönülmez. */
  public setStayInDrawing(on: boolean): void {
    this.stayInDrawing = on;
  }

  public isStayInDrawing(): boolean {
    return this.stayInDrawing;
  }

  /** İkon aracının bir sonraki yerleştireceği ikon (`i:anahtar` veya emoji). */
  public setIconChoice(icon: string): void {
    this.iconChoice = icon;
  }

  public setToolStyleProvider(fn: ((tool: DrawingToolType) => ToolStyle | undefined) | undefined): void {
    this.toolStyle = fn;
  }

  private snap(price: number, time: number): number {
    const mode = effectiveMagnet(this.magnetMode, this.magnetInvert);
    if (mode === 'off' || !this.mapper.getCandles) return price;
    return snapPrice(price, time, this.mapper.getCandles(), mode, (p) => this.mapper.priceToY(p));
  }

  public setHidden(hidden: boolean): void {
    this.hidden = hidden;
    this.render();
  }

  public isHidden(): boolean {
    return this.hidden;
  }

  public getDrawings(): DrawingObject[] {
    return [...this.drawings];
  }

  public setDrawings(drawings: DrawingObject[]): void {
    this.drawings = [...drawings];
    this.render();
  }

  public async loadFromSQLite(symbol: string): Promise<DrawingObject[]> {
    this.currentSymbol = symbol;
    try {
      const list = await fetchDrawings(symbol);
      this.drawings = list;
      this.render();
      return list;
    } catch {
      return this.drawings;
    }
  }

  public selectDrawing(id: string | null): void {
    if (this.selectedDrawingId === id) return;
    this.selectedDrawingId = id;
    this.render();
    this.onSelectionChanged?.(this.getSelectedDrawing());
  }

  public getSelectedDrawing(): DrawingObject | null {
    if (!this.selectedDrawingId) return null;
    return this.drawings.find((d) => d.id === this.selectedDrawingId) || null;
  }

  public getSelectedDrawingId(): string | null {
    return this.selectedDrawingId;
  }

  public setAllLocked(locked: boolean): void {
    this.allLocked = locked;
  }

  public isAllLocked(): boolean {
    return this.allLocked;
  }

  public setHistoryHook(
    fn: ((prev: DrawingObject[], next: DrawingObject[], labelTr: string, labelEn: string) => void) | undefined
  ): void {
    this.onHistoryCommit = fn;
  }

  public applyDrawingsSnapshot(list: DrawingObject[]): void {
    this.drawings = JSON.parse(JSON.stringify(list));
    this.selectedDrawingId = null;
    this.render();
    this.onSelectionChanged?.(null);
  }

  public findDrawingById(id: string): DrawingObject | null {
    return this.drawings.find((d) => d.id === id) ?? null;
  }

  public copyDrawing(id?: string): DrawingObject | null {
    const src = id ? this.findDrawingById(id) : this.getSelectedDrawing();
    if (!src) return null;
    this.clipboard = JSON.parse(JSON.stringify(src));
    return this.clipboard;
  }

  public hasClipboard(): boolean {
    return this.clipboard !== null;
  }

  public pasteDrawing(): DrawingObject | null {
    const src = this.clipboard;
    if (!src) return null;
    const pts = src.points.map((p) => {
      const x = this.mapper.timeToX(p.time);
      const y = this.mapper.priceToY(p.price);
      if (x === null || y === null) return { ...p };
      const t = this.mapper.xToTime(x + 24);
      const pr = this.mapper.yToPrice(y + 24);
      return { time: t ?? p.time, price: pr ?? p.price };
    });
    const copy: DrawingObject = {
      ...JSON.parse(JSON.stringify(src)),
      id: this.newId(),
      symbol: this.currentSymbol,
      timeframe: this.currentTimeframe,
      points: pts,
      locked: false,
    };
    void this.addDrawing(copy);
    return copy;
  }

  public reorderDrawing(id: string, dir: 'front' | 'back' | 'forward' | 'backward'): boolean {
    const idx = this.drawings.findIndex((d) => d.id === id);
    if (idx === -1) return false;
    const prev = this.cloneAll();
    const list = [...this.drawings];
    const [item] = list.splice(idx, 1);
    if (dir === 'front') list.push(item);
    else if (dir === 'back') list.unshift(item);
    else if (dir === 'forward') list.splice(Math.min(list.length, idx + 1), 0, item);
    else list.splice(Math.max(0, idx - 1), 0, item);
    this.saveToUndo();
    this.drawings = list;
    this.render();
    this.onHistoryCommit?.(prev, this.cloneAll(), tt("Çizim sırası"), 'Drawing order');
    return true;
  }

  private cloneAll(): DrawingObject[] {
    return JSON.parse(JSON.stringify(this.drawings));
  }

  public async updateSelectedDrawingColor(color: string): Promise<void> {
    await this.updateSelectedDrawing({ color });
  }

  /** Seçili çizimin stilini / metnini / kilidini günceller (geri alınabilir, kalıcı). */
  public async updateSelectedDrawing(patch: DrawingPatch): Promise<void> {
    if (!this.selectedDrawingId) return;
    const d = this.drawings.find((x) => x.id === this.selectedDrawingId);
    if (!d) return;
    const prev = this.cloneAll();
    this.saveToUndo();
    Object.assign(d, patch);
    this.render();
    this.onHistoryCommit?.(prev, this.cloneAll(), tt("Çizim stili"), 'Drawing style');
    await this.persistChanged(d);
    this.onSelectionChanged?.(d);
  }

  /** Seçili çizimin kopyasını ~24px kaydırarak ekler ve seçer. */
  public duplicateSelected(): DrawingObject | null {
    const src = this.getSelectedDrawing();
    if (!src) return null;
    const pts = src.points.map((p) => {
      const x = this.mapper.timeToX(p.time);
      const y = this.mapper.priceToY(p.price);
      if (x === null || y === null) return { ...p };
      const t = this.mapper.xToTime(x + 24);
      const pr = this.mapper.yToPrice(y + 24);
      return { time: t ?? p.time, price: pr ?? p.price };
    });
    const copy: DrawingObject = {
      ...JSON.parse(JSON.stringify(src)),
      id: this.newId(),
      points: pts,
      locked: false,
    };
    void this.addDrawing(copy);
    return copy;
  }

  private newId(): string {
    return `draw_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  }

  private async persistChanged(d: DrawingObject): Promise<void> {
    if (this.autoPersist) {
      try {
        await persistDrawing(d);
      } catch {
        // silent
      }
    }
    this.onDrawingChanged?.(d);
  }

  public async deleteSelectedDrawing(): Promise<void> {
    if (!this.selectedDrawingId) return;
    const id = this.selectedDrawingId;
    this.selectedDrawingId = null;
    await this.removeDrawingById(id);
    this.onSelectionChanged?.(null);
  }

  public undo(): void {
    if (this.undoStack.length === 0) return;
    this.redoStack.push(JSON.parse(JSON.stringify(this.drawings)));
    this.drawings = this.undoStack.pop()!;
    this.selectedDrawingId = null;
    this.render();
    this.onSelectionChanged?.(null);
  }

  public redo(): void {
    if (this.redoStack.length === 0) return;
    this.undoStack.push(JSON.parse(JSON.stringify(this.drawings)));
    this.drawings = this.redoStack.pop()!;
    this.selectedDrawingId = null;
    this.render();
    this.onSelectionChanged?.(null);
  }

  private saveToUndo(): void {
    this.undoStack.push(JSON.parse(JSON.stringify(this.drawings)));
    if (this.undoStack.length > 50) this.undoStack.shift();
    this.redoStack = [];
  }

  public async addDrawing(
    drawing: DrawingObject,
    persist = this.autoPersist
  ): Promise<void> {
    const prev = this.cloneAll();
    this.saveToUndo();
    this.drawings.push(drawing);
    this.selectedDrawingId = drawing.id;
    this.render();
    this.onHistoryCommit?.(prev, this.cloneAll(), tt("Çizim eklendi"), 'Add drawing');
    this.onSelectionChanged?.(drawing);
    if (persist) {
      try {
        await persistDrawing(drawing);
      } catch {
        // SQLite persistence fallback/silent
      }
    }
    this.onDrawingCompleted?.(drawing);
  }

  public async removeDrawingById(
    id: string,
    persist = this.autoPersist
  ): Promise<void> {
    const prev = this.cloneAll();
    this.saveToUndo();
    this.drawings = this.drawings.filter((d) => d.id !== id);
    if (this.selectedDrawingId === id) {
      this.selectedDrawingId = null;
    }
    this.render();
    this.onHistoryCommit?.(prev, this.cloneAll(), 'Çizim silindi', 'Remove drawing');
    if (persist) {
      try {
        await deleteDrawingById(id);
      } catch {
        // silent
      }
    }
  }

  public async clearAll(
    symbol = this.currentSymbol,
    persist = this.autoPersist
  ): Promise<void> {
    const prev = this.cloneAll();
    this.saveToUndo();
    this.drawings = this.drawings.filter((d) => d.symbol !== symbol);
    this.selectedDrawingId = null;
    this.draftPoints = [];
    this.hoverPoint = null;
    this.render();
    if (prev.length !== this.drawings.length) {
      this.onHistoryCommit?.(prev, this.cloneAll(), tt("Çizimler temizlendi"), 'Clear drawings');
    }
    this.onSelectionChanged?.(null);
    if (persist) {
      try {
        await clearSymbolDrawings(symbol);
      } catch {
        // silent
      }
    }
  }

  public handlePointInput(pt: TimePricePoint): DrawingObject | null {
    const tool = this.activeTool;
    const price = SCREEN_ANCHORED.has(tool) ? pt.price : this.snap(pt.price, pt.time);
    const finalPt: TimePricePoint = { time: pt.time, price };
    const need = POINTS_REQUIRED[tool] ?? 2;
    if (need === 0) return null;

    if (need < 0) {
      // değişken noktalı (yol / çoklu çizgi): çift tık (aynı noktaya ikinci tık) veya ilk noktaya dönüş biter
      const last = this.draftPoints[this.draftPoints.length - 1];
      if (last && this.samePlace(last, finalPt)) return this.finishDraft();
      const first = this.draftPoints[0];
      if (tool === 'polyline' && first && this.draftPoints.length >= 3 && this.samePlace(first, finalPt, 8)) return this.finishDraft();
      this.draftPoints.push(finalPt);
      this.render();
      return null;
    }

    this.draftPoints.push(finalPt);
    if (this.draftPoints.length < need) {
      this.render();
      return null;
    }
    return this.commitDraft();
  }

  /** İki nokta ekranda tol px'ten yakınsa aynı yer sayılır. */
  private samePlace(a: TimePricePoint, b: TimePricePoint, tol = 3): boolean {
    const ax = this.mapper.timeToX(a.time);
    const bx = this.mapper.timeToX(b.time);
    const ay = this.mapper.priceToY(a.price);
    const by = this.mapper.priceToY(b.price);
    if (ax === null || bx === null || ay === null || by === null) return a.time === b.time && a.price === b.price;
    return Math.hypot(ax - bx, ay - by) <= tol;
  }

  /** Değişken noktalı taslağı bitirir (Enter / çift tık). Yeterli nokta yoksa null. */
  public finishDraft(): DrawingObject | null {
    const tool = this.activeTool;
    if ((POINTS_REQUIRED[tool] ?? 2) >= 0) return null;
    if (this.draftPoints.length < (MIN_VARIABLE_POINTS[tool] ?? 2)) return null;
    return this.commitDraft();
  }

  public getDraftPoints(): TimePricePoint[] {
    return [...this.draftPoints];
  }

  private commitDraft(): DrawingObject {
    const tool = this.activeTool;
    const need = POINTS_REQUIRED[tool] ?? 2;
    const def = TOOL_DEFS[tool];
    const pts = def?.complete ? def.complete([...this.draftPoints]) : [...this.draftPoints];
    const obj: DrawingObject = {
      id: this.newId(),
      symbol: this.currentSymbol,
      timeframe: this.currentTimeframe,
      toolType: tool,
      points: pts,
      color: this.colorFor(tool, need),
      label: tool === 'text' ? tt("Not") : DEFAULT_TEXT[tool] || undefined,
      ...this.styleFor(tool),
      ...(tool === 'icon' ? { icon: this.iconChoice } : {}),
      ...(def?.extra ? def.extra(pts, this.mapper.getCandles?.() ?? []) : {}),
    };
    this.draftPoints = [];
    this.hoverPoint = null;
    void this.addDrawing(obj);
    this.afterCommit();
    return obj;
  }

  /** Çizimde kal kapalıysa imlece döner. */
  private afterCommit(): void {
    if (this.stayInDrawing) {
      this.render();
      return;
    }
    this.setTool('cursor');
    this.onToolReset?.();
  }

  /** Renk önceliği: kullanıcının seçtiği renk > araç stil hafızası > araç varsayılanı. */
  private colorFor(tool: DrawingToolType, need: number): string {
    const remembered = this.toolStyle?.(tool)?.color;
    const dflt = DEFAULT_TOOL_COLOR[tool];
    if (this.activeColor !== '#0284C7') return need === 1 && dflt && !remembered ? dflt : this.activeColor;
    return remembered ?? dflt ?? this.activeColor;
  }

  private styleFor(tool: DrawingToolType): Partial<DrawingObject> {
    const st = this.toolStyle?.(tool);
    if (!st) return {};
    const out: Partial<DrawingObject> = {};
    if (st.width !== undefined) out.width = st.width;
    if (st.lineStyle !== undefined) out.lineStyle = st.lineStyle;
    if (st.fontSize !== undefined) out.fontSize = st.fontSize;
    return out;
  }

  public handleHoverPoint(pt: TimePricePoint | null): void {
    if (this.activeTool === 'cursor' || this.draftPoints.length === 0) return;
    this.hoverPoint = pt;
    this.render();
  }

  // ---------------------------------------------------------------- sürükle-düzenle

  /** Seçili çizimi veya bir bağlantı noktasını sürüklemeye başlar. */
  public beginDrag(id: string, anchor: string, clientX: number, clientY: number): boolean {
    const d = this.drawings.find((x) => x.id === id);
    if (!d || d.locked || this.allLocked) return false;
    const origPx: Array<{ x: number; y: number }> = [];
    const screen = SCREEN_ANCHORED.has(d.toolType);
    const { w, h } = this.size();
    for (const p of d.points) {
      const x = screen ? p.time * w : this.mapper.timeToX(p.time);
      const y = screen ? p.price * h : this.mapper.priceToY(p.price);
      if (x === null || y === null) return false;
      origPx.push({ x, y });
    }
    this.drag = {
      id,
      anchor,
      startClientX: clientX,
      startClientY: clientY,
      origPts: d.points.map((p) => ({ ...p })),
      origPx,
      moved: false,
    };
    return true;
  }

  public isDragging(): boolean {
    return this.drag !== null;
  }

  public dragTo(clientX: number, clientY: number): void {
    const st = this.drag;
    if (!st) return;
    const d = this.drawings.find((x) => x.id === st.id);
    if (!d) return;
    const dx = clientX - st.startClientX;
    const dy = clientY - st.startClientY;
    if (!st.moved && Math.abs(dx) < 2 && Math.abs(dy) < 2) return;
    if (!st.moved) {
      // ilk gerçek harekette geri alma noktası: sürükleme öncesi durum
      const snap = this.drawings.map((x) =>
        x.id === st.id ? { ...x, points: st.origPts.map((p) => ({ ...p })) } : JSON.parse(JSON.stringify(x))
      );
      this.dragBeforeSnap = snap;
      this.undoStack.push(snap);
      if (this.undoStack.length > 50) this.undoStack.shift();
      this.redoStack = [];
      st.moved = true;
    }
    const screen = SCREEN_ANCHORED.has(d.toolType);
    const { w, h } = this.size();
    const move = (i: number): TimePricePoint => {
      if (screen) {
        return {
          time: Math.min(1, Math.max(0, (st.origPx[i].x + dx) / w)),
          price: Math.min(1, Math.max(0, (st.origPx[i].y + dy) / h)),
        };
      }
      const t = this.mapper.xToTime(st.origPx[i].x + dx);
      let pr = this.mapper.yToPrice(st.origPx[i].y + dy);
      if (pr !== null && st.anchor !== 'body' && t !== null) pr = this.snap(pr, t);
      return { time: t ?? st.origPts[i].time, price: pr ?? st.origPts[i].price };
    };
    if (st.anchor === 'body') {
      d.points = st.origPts.map((_, i) => move(i));
    } else if (st.anchor.startsWith('c') && st.anchor.length === 3) {
      // dikdörtgen köşesi: c<xIndex><yIndex>
      const xi = Number(st.anchor[1]);
      const yi = Number(st.anchor[2]);
      const pts = st.origPts.map((p) => ({ ...p }));
      const mv = move(xi);
      const mvY = xi === yi ? mv : move(yi);
      pts[xi].time = mv.time;
      pts[yi].price = mvY.price;
      d.points = pts;
    } else {
      const i = Number(st.anchor);
      if (Number.isInteger(i) && i >= 0 && i < d.points.length) {
        const pts = st.origPts.map((p) => ({ ...p }));
        pts[i] = move(i);
        d.points = pts;
      }
    }
    this.render();
  }

  public endDrag(): void {
    const st = this.drag;
    const before = this.dragBeforeSnap;
    this.drag = null;
    this.dragBeforeSnap = null;
    if (!st || !st.moved) return;
    if (before) this.onHistoryCommit?.(before, this.cloneAll(), tt("Çizim taşındı"), 'Move drawing');
    const d = this.drawings.find((x) => x.id === st.id);
    if (d) void this.persistChanged(d);
  }

  private bindSvgEvents(): void {
    if (!this.svg) return;

    this.svg.addEventListener('mousedown', (ev) => {
      this.magnetInvert = ev.ctrlKey || ev.metaKey;
      // Shift+Click automatically activates Ruler mode
      if (ev.shiftKey && this.activeTool === 'cursor') {
        this.setTool('ruler');
      }
      if (this.pointerDown(ev.clientX, ev.clientY, ev.target as Element)) ev.preventDefault();
      else if (this.lastDownStopped) ev.stopPropagation();
    });

    this.svg.addEventListener('mousemove', (ev) => {
      this.magnetInvert = ev.ctrlKey || ev.metaKey;
      this.pointerMove(ev.clientX, ev.clientY, true);
    });
    this.svg.addEventListener('dblclick', () => {
      if ((POINTS_REQUIRED[this.activeTool] ?? 2) < 0) this.finishDraft();
    });
    window.addEventListener('mousemove', (ev) => {
      if (this.drag) {
        this.magnetInvert = ev.ctrlKey || ev.metaKey;
        this.dragTo(ev.clientX, ev.clientY);
      }
    });
    window.addEventListener('mouseup', () => this.pointerUp(null));

    // Dokunmatik: touchstart/move/end aynı iç mantığı kullanır. preventDefault, tarayıcının
    // sentezlediği fare olaylarını ve çizim sırasında sayfa kaydırmayı engeller.
    const opts = { passive: false } as AddEventListenerOptions;
    this.svg.addEventListener(
      'touchstart',
      (ev) => {
        const t = ev.touches[0];
        if (!t) return;
        this.coarse = true;
        if (ev.touches.length > 1) {
          // iki parmak: çizim değil, grafik yakınlaştırma/kaydırma. Bekleyen ilk dokunuş yok sayılır.
          if (this.activeTool === 'cursor' && !this.drag) return;
          this.cancelPendingDown();
          if (this.drag) this.endDrag();
          this.isBrushing = false;
          this.brushPoints = [];
          this.touchStart = null;
          this.pinch = pinchState(ev.touches[0], ev.touches[1]);
          this.render();
          ev.preventDefault();
          return;
        }
        this.touchStart = { x: t.clientX, y: t.clientY };
        if (this.activeTool !== 'cursor' && !this.drag) {
          // Çizim modunda basma, ikinci parmak gelirse iptal edilebilsin diye kısa süre bekletilir.
          this.pendingDown = { x: t.clientX, y: t.clientY, el: ev.target as Element };
          this.pendingTimer = setTimeout(() => this.flushPendingDown(), DrawingManager.PINCH_GRACE_MS);
          ev.preventDefault();
          return;
        }
        this.pointerDown(t.clientX, t.clientY, ev.target as Element);
        // Bir çizim tutulduysa sayfa/grafik kaydırmasını engelle
        if (this.drag) ev.preventDefault();
      },
      opts
    );
    window.addEventListener(
      'touchmove',
      (ev) => {
        if (this.pinch && ev.touches.length >= 2) {
          ev.preventDefault();
          const next = pinchState(ev.touches[0], ev.touches[1]);
          const rect = this.svg?.getBoundingClientRect();
          if (this.pinch.dist > 0 && next.dist > 0) {
            this.onPinch?.({
              scale: next.dist / this.pinch.dist,
              centerX: next.cx - (rect?.left ?? 0),
              dx: next.cx - this.pinch.cx,
            });
          }
          this.pinch = next;
          return;
        }
        const t = ev.touches[0];
        if (!t || !this.touchStart) return;
        this.flushPendingDown();
        if (this.drag) {
          ev.preventDefault();
          this.dragTo(t.clientX, t.clientY);
          return;
        }
        if (this.activeTool !== 'cursor') {
          ev.preventDefault();
          this.pointerMove(t.clientX, t.clientY, false);
        }
      },
      opts
    );
    const touchEnd = (ev: TouchEvent) => {
      if (this.pinch) {
        // parmaklardan biri kalktı: pinch biter, kalan parmak yeni nokta yerleştirmez
        if (ev.touches.length < 2) this.pinch = null;
        this.touchStart = null;
        return;
      }
      if (!this.touchStart) return;
      this.flushPendingDown();
      const t = ev.changedTouches[0];
      this.pointerUp(t ? { x: t.clientX, y: t.clientY } : null);
      this.touchStart = null;
    };
    window.addEventListener('touchend', touchEnd);
    window.addEventListener('touchcancel', () => {
      this.cancelPendingDown();
      this.pinch = null;
      if (this.drag) this.endDrag();
      this.isBrushing = false;
      this.brushPoints = [];
      this.touchStart = null;
      this.render();
    });
  }

  /** Dokunma sürüklemesi bu eşiği (px) aşarsa, bekleyen ilk noktaya ikinci nokta bırakılan yere konur. */
  private static readonly TOUCH_DRAG_PX = 14;
  /** İkinci parmağın gelip gelmediğini anlamak için çizim modunda ilk dokunuşun bekletilme süresi (ms). */
  private static readonly PINCH_GRACE_MS = 70;
  private coarse = false;
  private pinch: { dist: number; cx: number } | null = null;
  private pendingDown: { x: number; y: number; el: Element } | null = null;
  private pendingTimer: ReturnType<typeof setTimeout> | null = null;

  private cancelPendingDown(): void {
    if (this.pendingTimer) clearTimeout(this.pendingTimer);
    this.pendingTimer = null;
    this.pendingDown = null;
  }

  private flushPendingDown(): void {
    const p = this.pendingDown;
    this.cancelPendingDown();
    if (p) this.pointerDown(p.x, p.y, p.el);
  }

  private touchStart: { x: number; y: number } | null = null;
  private lastDownStopped = false;

  /** Ortak basma mantığı (fare + dokunma). true → varsayılan eylem engellenmeli (sürükleme başladı). */
  private pointerDown(clientX: number, clientY: number, el: Element): boolean {
    this.lastDownStopped = false;
    if (this.activeTool === 'cursor') {
      const target = el.closest('[data-drawing-id]') as HTMLElement | null;
      if (target) {
        const id = target.getAttribute('data-drawing-id');
        if (id && id !== 'draft_preview' && id !== 'draft_brush_preview') {
          this.selectDrawing(id);
          const anchor = el.closest('[data-anchor]')?.getAttribute('data-anchor') ?? 'body';
          this.lastDownStopped = true;
          return this.beginDrag(id, anchor, clientX, clientY);
        }
      }
      this.selectDrawing(null);
      return false;
    }

    if (SCREEN_ANCHORED.has(this.activeTool)) {
      const rect = this.svg!.getBoundingClientRect();
      const { w, h } = this.size();
      this.handlePointInput({
        time: Math.min(1, Math.max(0, (clientX - rect.left) / w)),
        price: Math.min(1, Math.max(0, (clientY - rect.top) / h)),
      });
      return false;
    }

    const pt = this.pxToPoint(clientX, clientY);
    if (!pt) return false;

    if (FREEHAND_TOOLS.has(this.activeTool)) {
      this.isBrushing = true;
      this.brushPoints = [pt];
      return false;
    }

    this.handlePointInput(pt);
    return false;
  }

  private pointerMove(clientX: number, clientY: number, fromSvg: boolean): void {
    if (FREEHAND_TOOLS.has(this.activeTool) && this.isBrushing) {
      const pt = this.pxToPoint(clientX, clientY);
      if (pt) {
        this.brushPoints.push(pt);
        this.render();
      }
      return;
    }
    if (!fromSvg && this.drag) return;
    if (this.activeTool === 'cursor' || this.draftPoints.length === 0) return;
    this.handleHoverPoint(this.pxToPoint(clientX, clientY));
  }

  /** Bırakma. end: dokunma bitiş koordinatı (fare için null). */
  private pointerUp(end: { x: number; y: number } | null): void {
    if (this.drag) this.endDrag();
    // Dokunmatik sürükle-çiz: ilk nokta bekliyorsa ve parmak yeterince kaydıysa ikinci noktayı bırakılan yere koy.
    if (
      end &&
      this.touchStart &&
      this.activeTool !== 'cursor' &&
      !FREEHAND_TOOLS.has(this.activeTool) &&
      (POINTS_REQUIRED[this.activeTool] ?? 2) > 0 &&
      this.draftPoints.length === 1 &&
      Math.hypot(end.x - this.touchStart.x, end.y - this.touchStart.y) > DrawingManager.TOUCH_DRAG_PX
    ) {
      const pt = this.pxToPoint(end.x, end.y);
      if (pt) this.handlePointInput(pt);
    }
    if (FREEHAND_TOOLS.has(this.activeTool) && this.isBrushing) {
      if (this.brushPoints.length > 1) {
        const tool = this.activeTool;
        const obj: DrawingObject = {
          id: this.newId(),
          symbol: this.currentSymbol,
          timeframe: this.currentTimeframe,
          toolType: tool,
          points: [...this.brushPoints],
          color: this.colorFor(tool, 0),
          ...this.styleFor(tool),
        };
        void this.addDrawing(obj);
      }
      this.brushPoints = [];
      this.isBrushing = false;
      this.afterCommit();
    }
  }

  private pxToPoint(clientX: number, clientY: number): TimePricePoint | null {
    if (!this.svg) return null;
    const rect = this.svg.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const time = this.mapper.xToTime(x);
    const price = this.mapper.yToPrice(y);
    if (time === null || price === null) return null;
    return { time, price: this.snap(price, time) };
  }

  public eventToPoint(ev: { clientX: number; clientY: number }): TimePricePoint | null {
    return this.pxToPoint(ev.clientX, ev.clientY);
  }

  public render(): void {
    if (!this.svg) return;

    while (this.svg.firstChild) {
      this.svg.removeChild(this.svg.firstChild);
    }

    if (this.hidden) return;

    const { w: width, h: height } = this.size();

    const itemsToRender = [...this.drawings];

    // If a 2-point drawing is currently being drafted, render preview
    if (this.draftPoints.length >= 1 && (this.hoverPoint || this.draftPoints.length >= 2)) {
      itemsToRender.push({
        id: 'draft_preview',
        symbol: this.currentSymbol,
        timeframe: this.currentTimeframe,
        toolType: this.activeTool,
        points: this.hoverPoint ? [...this.draftPoints, this.hoverPoint] : [...this.draftPoints],
        color: (this.activeColor === '#0284C7' && DEFAULT_TOOL_COLOR[this.activeTool]) || this.activeColor,
      });
    }

    // If brush is being dragged, render live preview
    if (FREEHAND_TOOLS.has(this.activeTool) && this.isBrushing && this.brushPoints.length > 1) {
      itemsToRender.push({
        id: 'draft_brush_preview',
        symbol: this.currentSymbol,
        timeframe: this.currentTimeframe,
        toolType: this.activeTool,
        points: [...this.brushPoints],
        color: (this.activeColor === '#0284C7' && DEFAULT_TOOL_COLOR[this.activeTool]) || this.activeColor,
      });
    }

    for (const d of itemsToRender) {
      if (d.hidden) continue;

      const isPreview = d.id === 'draft_preview' || d.id === 'draft_brush_preview';
      if (!isPreview && !isVisibleOn(d, this.currentTimeframe)) continue;
      const isSelected = !isPreview && d.id === this.selectedDrawingId;

      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('data-drawing-id', d.id);
      g.setAttribute('class', `drawing-item ${isSelected ? 'selected' : ''}`);
      g.style.pointerEvents = isPreview ? 'none' : 'auto';
      g.style.cursor = this.activeTool === 'cursor' ? 'pointer' : 'crosshair';
      g.style.touchAction = 'none';

      const def = TOOL_DEFS[d.toolType];
      if (def) def.render(d, this.mapper, g, width, height);
      else switch (d.toolType) {
        case 'trendline':
        case 'ray':
          TrendlineTool.render(d, this.mapper, g, width, height);
          break;

        case 'hline':
        case 'vline':
          HorizontalLineTool.render(d, this.mapper, g, width, height);
          break;

        case 'fib':
          FibRetracementTool.render(d, this.mapper, g, width);
          break;

        case 'rect':
          SupplyDemandBoxTool.render(d, this.mapper, g);
          break;

        case 'long_pos':
        case 'short_pos':
          RiskRewardTool.render(d, this.mapper, g);
          break;

        case 'channel':
          renderChannel(d, this.mapper, g);
          break;

        case 'hray':
          renderHRay(d, this.mapper, g, width);
          break;

        case 'extended':
        case 'arrow':
          renderExtendedOrArrow(d, this.mapper, g, width);
          break;

        case 'info_line':
          renderInfoLine(d, this.mapper, g);
          break;

        case 'price_range':
          renderPriceRange(d, this.mapper, g, width);
          break;

        case 'date_range':
          renderDateRange(d, this.mapper, g, height);
          break;

        case 'fixed_vp':
          renderFixedVP(d, this.mapper, g, height);
          break;

        case 'pitchfork':
          renderPitchfork(d, this.mapper, g, width);
          break;

        case 'fib_ext':
          renderFibExtension(d, this.mapper, g, width);
          break;

        case 'ellipse':
          renderEllipse(d, this.mapper, g);
          break;

        case 'price_label':
          renderPriceLabel(d, this.mapper, g);
          break;

        case 'ruler':
          this.renderRuler(d, g);
          break;

        case 'text':
          this.renderText(d, g);
          break;

        case 'brush':
          this.renderBrush(d, g);
          break;
      }

      applyStrokeOverrides(g, d);
      if (!isPreview && this.isCoarse()) this.addTouchHitAreas(g);
      if (isSelected) {
        this.renderSelectionHandles(d, g, width, height);
      }

      this.svg.appendChild(g);
    }
  }

  private sizeCache: { w: number; h: number } | null = null;

  private size(): { w: number; h: number } {
    if (this.sizeCache) return this.sizeCache;
    return { w: this.svg?.clientWidth || 1000, h: this.svg?.clientHeight || 600 };
  }

  private isCoarse(): boolean {
    if (this.coarse) return true;
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
  }

  /** İnce çizgileri parmakla yakalamak için her çizgiye şeffaf, kalın bir kopya ekler. */
  private addTouchHitAreas(g: SVGElement): void {
    const NS = 'http://www.w3.org/2000/svg';
    for (const child of Array.from(g.children)) {
      const tag = child.tagName.toLowerCase();
      if (tag !== 'line' && tag !== 'polyline' && tag !== 'path') continue;
      const stroke = child.getAttribute('stroke');
      if (!stroke || stroke === 'none') continue;
      const hit = document.createElementNS(NS, tag);
      for (const a of Array.from(child.attributes)) hit.setAttribute(a.name, a.value);
      hit.setAttribute('stroke', 'transparent');
      hit.setAttribute('stroke-width', '22');
      hit.removeAttribute('stroke-dasharray');
      hit.setAttribute('fill', 'none');
      hit.setAttribute('class', 'drawing-touch-hit');
      (hit as SVGElement).style.pointerEvents = 'stroke';
      g.insertBefore(hit, child);
    }
  }

  private renderSelectionHandles(d: DrawingObject, parent: SVGElement, w: number, h: number): void {
    if (FREEHAND_TOOLS.has(d.toolType)) return; // gövde sürüklenir; tek tek nokta tutamacı yok
    const makeHandle = (cx: number, cy: number, anchor: string) => {
      const NS = 'http://www.w3.org/2000/svg';
      const coarse = this.isCoarse();
      const grp = document.createElementNS(NS, 'g');
      grp.setAttribute('data-anchor', anchor);
      grp.setAttribute('class', 'drawing-anchor-handle');
      // geniş, görünmez tutma alanı (parmak için 44px çap)
      const hit = document.createElementNS(NS, 'circle');
      hit.setAttribute('cx', String(cx));
      hit.setAttribute('cy', String(cy));
      hit.setAttribute('r', coarse ? '22' : '10');
      hit.setAttribute('fill', 'transparent');
      const c = document.createElementNS(NS, 'circle');
      c.setAttribute('cx', String(cx));
      c.setAttribute('cy', String(cy));
      c.setAttribute('r', coarse ? '8' : '4.5');
      c.setAttribute('fill', '#FFFFFF');
      c.setAttribute('stroke', '#0284C7');
      c.setAttribute('stroke-width', '2');
      grp.appendChild(hit);
      grp.appendChild(c);
      grp.style.cursor = 'grab';
      return grp;
    };

    if (d.toolType === 'rect' && d.points.length >= 2) {
      const x = [0, 1].map((i) => this.mapper.timeToX(d.points[i].time));
      const y = [0, 1].map((i) => this.mapper.priceToY(d.points[i].price));
      if (x.every((v) => v !== null) && y.every((v) => v !== null)) {
        for (const xi of [0, 1]) for (const yi of [0, 1]) parent.appendChild(makeHandle(x[xi]!, y[yi]!, `c${xi}${yi}`));
      }
      return;
    }

    const custom = TOOL_DEFS[d.toolType]?.handles?.(d, this.mapper, w, h);
    if (custom) {
      custom.forEach((h, i) => parent.appendChild(makeHandle(h.x, h.y, String(i))));
      return;
    }

    d.points.forEach((pt, i) => {
      const x = this.mapper.timeToX(pt.time);
      const y = this.mapper.priceToY(pt.price);
      if (x !== null && y !== null) {
        parent.appendChild(makeHandle(x, y, String(i)));
      }
    });
  }

  private renderRuler(d: DrawingObject, parent: SVGElement = this.svg!): void {
    if (!this.svg || d.points.length < 2) return;
    const p1 = d.points[0];
    const p2 = d.points[1];
    const x1 = this.mapper.timeToX(p1.time);
    const y1 = this.mapper.priceToY(p1.price);
    const x2 = this.mapper.timeToX(p2.time);
    const y2 = this.mapper.priceToY(p2.price);
    if (x1 === null || y1 === null || x2 === null || y2 === null) return;

    const rx = Math.min(x1, x2);
    const ry = Math.min(y1, y2);
    const rw = Math.max(8, Math.abs(x2 - x1));
    const rh = Math.max(8, Math.abs(y2 - y1));
    const isUp = p2.price >= p1.price;
    const fill = isUp ? 'rgba(2, 132, 199, 0.20)' : 'rgba(242, 54, 69, 0.20)';
    const stroke = isUp ? '#0284C7' : '#F23645';

    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', String(rx));
    rect.setAttribute('y', String(ry));
    rect.setAttribute('width', String(rw));
    rect.setAttribute('height', String(rh));
    rect.setAttribute('fill', fill);
    rect.setAttribute('stroke', stroke);
    rect.setAttribute('stroke-width', '1.2');
    parent.appendChild(rect);

    this.appendLine(x1, y1, x2, y2, stroke, 1.5, '4,3', parent);

    const priceDiff = p2.price - p1.price;
    const pctDiff = p1.price > 0 ? (priceDiff / p1.price) * 100 : 0;
    const sign = priceDiff >= 0 ? '+' : '';

    const candles = this.mapper.getCandles ? this.mapper.getCandles() : [];
    const minT = Math.min(p1.time, p2.time);
    const maxT = Math.max(p1.time, p2.time);
    const rangeCandles = candles.filter((c) => c.time >= minT && c.time <= maxT);
    const barCount = rangeCandles.length > 0 ? rangeCandles.length : Math.max(1, Math.round(rw / 10));
    const totalVolume = rangeCandles.reduce((acc, c) => acc + (c.volume || 0), 0);
    const volStr = formatVolume(totalVolume);

    // Pill badge
    const badgeW = 160;
    const badgeH = 34;
    const badgeX = Math.max(4, rx + rw / 2 - badgeW / 2);
    const badgeY = Math.max(4, ry - badgeH - 6);

    const bgRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    bgRect.setAttribute('x', String(badgeX));
    bgRect.setAttribute('y', String(badgeY));
    bgRect.setAttribute('width', String(badgeW));
    bgRect.setAttribute('height', String(badgeH));
    bgRect.setAttribute('rx', '4');
    bgRect.setAttribute('fill', '#1E222D');
    bgRect.setAttribute('stroke', stroke);
    bgRect.setAttribute('stroke-width', '1');
    parent.appendChild(bgRect);

    const txt1 = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    txt1.setAttribute('x', String(badgeX + badgeW / 2));
    txt1.setAttribute('y', String(badgeY + 14));
    txt1.setAttribute('text-anchor', 'middle');
    txt1.setAttribute('fill', stroke);
    txt1.setAttribute('font-size', '11');
    txt1.setAttribute('font-family', "-apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, Ubuntu, sans-serif");
    txt1.setAttribute('font-weight', '700');
    txt1.textContent = `${sign}${priceDiff.toFixed(2)} (${sign}${pctDiff.toFixed(2)}%)`;
    parent.appendChild(txt1);

    const txt2 = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    txt2.setAttribute('x', String(badgeX + badgeW / 2));
    txt2.setAttribute('y', String(badgeY + 28));
    txt2.setAttribute('text-anchor', 'middle');
    txt2.setAttribute('fill', '#D1D4DC');
    txt2.setAttribute('font-size', '10');
    txt2.setAttribute('font-family', "-apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, Ubuntu, sans-serif");
    txt2.textContent = `${barCount} Bar · Hacim: ${volStr}`;
    parent.appendChild(txt2);
  }

  private renderBrush(d: DrawingObject, parent: SVGElement = this.svg!): void {
    if (!this.svg || d.points.length < 2) return;
    const coords: Array<{ x: number; y: number }> = [];
    for (const p of d.points) {
      const x = this.mapper.timeToX(p.time);
      const y = this.mapper.priceToY(p.price);
      if (x !== null && y !== null) {
        coords.push({ x, y });
      }
    }
    if (coords.length < 2) return;
    let pathD = `M ${coords[0].x.toFixed(1)} ${coords[0].y.toFixed(1)}`;
    for (let i = 1; i < coords.length; i++) {
      pathD += ` L ${coords[i].x.toFixed(1)} ${coords[i].y.toFixed(1)}`;
    }
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', pathD);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', d.color || '#0284C7');
    path.setAttribute('stroke-width', '2.5');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    parent.appendChild(path);
  }

  private renderText(d: DrawingObject, parent: SVGElement = this.svg!): void {
    if (!this.svg || d.points.length < 1) return;
    const x = this.mapper.timeToX(d.points[0].time);
    const y = this.mapper.priceToY(d.points[0].price);
    if (x === null || y === null) return;

    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    const textVal = `📌 ${d.label || tt("Not")}`;
    const w = textVal.length * 7 + 16;

    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', String(x));
    rect.setAttribute('y', String(y - 16));
    rect.setAttribute('rx', '4');
    rect.setAttribute('width', String(w));
    rect.setAttribute('height', '20');
    rect.setAttribute('fill', '#1E222D');
    rect.setAttribute('stroke', d.color || '#00E676');
    rect.setAttribute('stroke-width', '1');
    g.appendChild(rect);

    const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    txt.setAttribute('x', String(x + 8));
    txt.setAttribute('y', String(y - 2));
    txt.setAttribute('fill', d.color || '#00E676');
    txt.setAttribute('font-size', '10.5');
    txt.setAttribute('font-family', "-apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, Ubuntu, sans-serif");
    txt.setAttribute('font-weight', '700');
    txt.textContent = textVal;
    g.appendChild(txt);

    parent.appendChild(g);
  }

  private appendLine(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    stroke: string,
    width: number,
    dash?: string,
    parent: SVGElement = this.svg!
  ): void {
    if (!this.svg) return;
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', String(x1));
    line.setAttribute('y1', String(y1));
    line.setAttribute('x2', String(x2));
    line.setAttribute('y2', String(y2));
    line.setAttribute('stroke', stroke);
    line.setAttribute('stroke-width', String(width));
    if (dash) line.setAttribute('stroke-dasharray', dash);
    parent.appendChild(line);
  }
}

function pinchState(a: { clientX: number; clientY: number }, b: { clientX: number; clientY: number }): { dist: number; cx: number } {
  return { dist: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), cx: (a.clientX + b.clientX) / 2 };
}
