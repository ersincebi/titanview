import type {
  DrawingObject,
  DrawingToolType,
  TimePricePoint,
} from '../types/market';
import type { TitanChartController } from './ChartController';
import { DrawingManager, type DrawingPatch, type ToolStyle } from './drawing/DrawingManager';
import type { MagnetMode } from './drawing/magnet';

export class DrawingOverlay {
  private svg: SVGSVGElement;
  private chart: TitanChartController;
  private manager: DrawingManager;
  /** Çizimlerden sonra çalışan katmanlar (Faz 28: emir çizgileri) — görünüm değişince yeniden çizilir. */
  private afterRender: Array<() => void> = [];

  constructor(
    hostContainer: HTMLElement,
    chart: TitanChartController,
    onDrawingCompleted?: (drawing: DrawingObject) => void,
    onToolReset?: () => void,
    onSelectionChanged?: (drawing: DrawingObject | null) => void,
    onDrawingChanged?: (drawing: DrawingObject) => void
  ) {
    this.chart = chart;
    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.svg.setAttribute('class', 'titan-drawing-svg');
    hostContainer.appendChild(this.svg);

    this.manager = new DrawingManager({
      svg: this.svg,
      mapper: chart,
      onDrawingCompleted,
      onToolReset,
      onSelectionChanged,
      onDrawingChanged,
      onPinch: (g) => chart.pinchView(g.scale, g.centerX, g.dx),
      autoPersist: false, // persistence can be explicitly triggered by callback or caller
    });
  }

  public getManager(): DrawingManager {
    return this.manager;
  }

  public setContext(symbol: string, timeframe: string): void {
    this.manager.setContext(symbol, timeframe);
  }

  public setMagnet(mode: boolean | MagnetMode): void {
    this.manager.setMagnet(mode);
  }

  public setStayInDrawing(on: boolean): void {
    this.manager.setStayInDrawing(on);
  }

  public setIconChoice(icon: string): void {
    this.manager.setIconChoice(icon);
  }

  public setToolStyleProvider(fn: ((tool: DrawingToolType) => ToolStyle | undefined) | undefined): void {
    this.manager.setToolStyleProvider(fn);
  }

  public isMagnetEnabled(): boolean {
    return this.manager.isMagnetEnabled();
  }

  public setHidden(hidden: boolean): void {
    this.manager.setHidden(hidden);
    this.render();
  }

  public setAllLocked(locked: boolean): void {
    this.manager.setAllLocked(locked);
  }

  public setHistoryHook(
    fn: ((prev: DrawingObject[], next: DrawingObject[], labelTr: string, labelEn: string) => void) | undefined
  ): void {
    this.manager.setHistoryHook(fn);
  }

  public applyDrawingsSnapshot(list: DrawingObject[]): void {
    this.manager.applyDrawingsSnapshot(list);
  }

  public findDrawingById(id: string): DrawingObject | null {
    return this.manager.findDrawingById(id);
  }

  public copyDrawing(id?: string): DrawingObject | null {
    return this.manager.copyDrawing(id);
  }

  public hasClipboard(): boolean {
    return this.manager.hasClipboard();
  }

  public pasteDrawing(): DrawingObject | null {
    return this.manager.pasteDrawing();
  }

  public reorderDrawing(id: string, dir: 'front' | 'back' | 'forward' | 'backward'): boolean {
    return this.manager.reorderDrawing(id, dir);
  }

  public isHidden(): boolean {
    return this.manager.isHidden();
  }

  public setShowVPVR(show: boolean): void {
    void show; // VPVR artık ChartController.setQuickIndicators({ vpvr }) ile yönetilir
    this.render();
  }

  public onAfterRender(fn: () => void): void {
    this.afterRender.push(fn);
  }

  public setTool(tool: DrawingToolType, color = '#0284C7'): void {
    this.manager.setTool(tool, color);
  }

  public getTool(): DrawingToolType {
    return this.manager.getTool();
  }

  /** Yol / çoklu çizgi taslağını bitirir (Enter). */
  public finishDraft(): DrawingObject | null {
    return this.manager.finishDraft();
  }

  public setDrawings(list: DrawingObject[]): void {
    this.manager.setDrawings(list);
  }

  public getDrawings(): DrawingObject[] {
    return this.manager.getDrawings();
  }

  public selectDrawing(id: string | null): void {
    this.manager.selectDrawing(id);
  }

  public getSelectedDrawing(): DrawingObject | null {
    return this.manager.getSelectedDrawing();
  }

  public getSelectedDrawingId(): string | null {
    return this.manager.getSelectedDrawingId();
  }

  public async updateSelectedDrawingColor(color: string): Promise<void> {
    await this.manager.updateSelectedDrawingColor(color);
  }

  public async updateSelectedDrawing(patch: DrawingPatch): Promise<void> {
    await this.manager.updateSelectedDrawing(patch);
  }

  public duplicateSelected(): DrawingObject | null {
    return this.manager.duplicateSelected();
  }

  public async deleteSelectedDrawing(): Promise<void> {
    await this.manager.deleteSelectedDrawing();
  }

  public undo(): void {
    this.manager.undo();
  }

  public redo(): void {
    this.manager.redo();
  }

  public removeDrawingById(id: string): void {
    void this.manager.removeDrawingById(id);
  }

  public clearAll(): void {
    void this.manager.clearAll();
  }

  public render(): void {
    // 1. Let DrawingManager render all active technical drawings
    this.manager.render();

    // 2. VPVR artık tuvalde (VisibleRangeProfile primitive, görünür aralığa göre) çiziliyor.
    // 3. Emir/pozisyon çizgileri ayrı HTML katmanında (OrderLayer, Faz 28).
    for (const fn of this.afterRender) fn();
  }
}
