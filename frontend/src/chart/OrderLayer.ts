import { tt } from '../state/i18n';
/**
 * Faz 28 — grafikte emir/pozisyon çizgileri ("Trading panel" çizgileri):
 * etiket dikey sürüklenince fiyat değişir, ✕ iptal eder/kapatır, pozisyon etiketindeki
 * TP / SL tutamaçlarından sürükleyerek köprü emirleri oluşturulur.
 */
import { lineText, priceDecimals, type OrderLine } from '../state/trading';

export interface PriceMapper {
  priceToY(price: number): number | null;
  yToPrice(y: number): number | null;
}

export interface OrderLayerHandlers {
  /** Bırakma; dönen söz bitince katman sunucunun son durumuyla yeniden çizilir (ret → çizgi geri döner). */
  onDrop(line: OrderLine, price: number): void | Promise<unknown>;
  onCancel(line: OrderLine): void;
  /** Pozisyondan TP/SL tutamacı bırakıldı. */
  onBracket(symbol: string, field: 'takeProfit' | 'stopLoss', price: number): void | Promise<unknown>;
}

/** Sağ fiyat ekseni genişliği (çizgi bu noktada biter, fiyat etiketi eksene oturur). */
const AXIS_W = 64;
/** İki etiket arası en az dikey mesafe (etiket yüksekliği 20 + 2). */
const LABEL_GAP = 22;

export class OrderLayer {
  readonly el: HTMLDivElement;
  private lines: OrderLine[] = [];
  private dragging: { id: string; y: number } | null = null;

  constructor(
    host: HTMLElement,
    private mapper: PriceMapper,
    private handlers: OrderLayerHandlers
  ) {
    this.el = document.createElement('div');
    this.el.className = 'tv-order-layer';
    host.appendChild(this.el);
  }

  setLines(lines: OrderLine[]): void {
    this.lines = lines;
    if (!this.dragging) this.render();
  }

  getLines(): OrderLine[] {
    return this.lines;
  }

  destroy(): void {
    this.el.remove();
  }

  render(): void {
    if (this.dragging) return;
    this.el.replaceChildren();
    const placed: Array<{ l: OrderLine; y: number }> = [];
    for (const l of this.lines) {
      const y = this.mapper.priceToY(l.price);
      if (y === null || !Number.isFinite(y)) continue;
      placed.push({ l, y });
    }
    // Etiket çakışma önleme: çizgi fiyatında kalır, yakın etiketler aşağı kaydırılır (yukarıdan aşağı).
    placed.sort((a, b) => a.y - b.y);
    let prev = -Infinity;
    for (const { l, y } of placed) {
      const labelY = Math.max(y, prev + LABEL_GAP);
      prev = labelY;
      const row = this.buildLine(l, y);
      if (labelY !== y) row.querySelector<HTMLDivElement>('.tv-order-label')!.style.top = `${labelY - y - 10}px`;
      this.el.appendChild(row);
    }
  }

  private buildLine(l: OrderLine, y: number): HTMLDivElement {
    const row = document.createElement('div');
    row.className = `tv-order-line tv-order-${l.kind}`;
    row.dataset.line = l.id;
    row.style.top = `${Math.round(y)}px`;
    row.style.right = `${AXIS_W}px`;
    row.style.setProperty('--ol-color', l.color);

    const label = document.createElement('div');
    label.className = 'tv-order-label';
    if (l.drag) label.classList.add('draggable');
    const qty = document.createElement('span');
    qty.className = 'tv-order-qty';
    qty.textContent = String(Math.abs(l.qty));
    const text = document.createElement('span');
    text.className = 'tv-order-text';
    text.textContent = lineText(l);
    if (l.kind === 'position' && l.pnl !== undefined) text.classList.add(l.pnl >= 0 ? 'pos' : 'neg');
    label.append(qty, text);

    if (l.kind === 'position') {
      const sym = l.id.slice(4);
      for (const field of ['takeProfit', 'stopLoss'] as const) {
        const h = document.createElement('button');
        h.type = 'button';
        h.className = `tv-order-handle ${field === 'takeProfit' ? 'tp' : 'sl'}`;
        h.dataset.bracket = field;
        h.textContent = field === 'takeProfit' ? 'TP' : 'SL';
        h.title = field === 'takeProfit' ? tt("Sürükle: Kâr Al ekle") : tt("Sürükle: Zarar Durdur ekle");
        h.addEventListener('pointerdown', (ev) => this.startBracketDrag(ev, sym, field, l));
        label.appendChild(h);
      }
    }
    if (l.cancel) {
      const x = document.createElement('button');
      x.type = 'button';
      x.className = 'tv-order-x';
      x.dataset.cancelLine = l.id;
      x.title = l.kind === 'position' ? 'Pozisyonu kapat' : 'Emri iptal et';
      x.textContent = '✕';
      x.addEventListener('pointerdown', (ev) => ev.stopPropagation());
      x.addEventListener('click', (ev) => {
        ev.stopPropagation();
        this.handlers.onCancel(l);
      });
      label.appendChild(x);
    }
    if (l.drag) label.addEventListener('pointerdown', (ev) => this.startDrag(ev, l, row, text));
    row.appendChild(label);

    const tag = document.createElement('div');
    tag.className = 'tv-order-price';
    tag.style.right = `${-AXIS_W}px`;
    tag.textContent = l.price.toFixed(priceDecimals(l.price));
    row.appendChild(tag);
    return row;
  }

  private hostY(ev: PointerEvent): number {
    const r = this.el.getBoundingClientRect();
    return Math.max(0, Math.min(r.height, ev.clientY - r.top));
  }

  private track(ev: PointerEvent, move: (y: number) => void, done: (y: number, moved: boolean) => void): void {
    ev.preventDefault();
    ev.stopPropagation();
    const startY = ev.clientY;
    let moved = false;
    let lastY = this.hostY(ev);
    const onMove = (e: PointerEvent) => {
      if (Math.abs(e.clientY - startY) > 2) moved = true;
      lastY = this.hostY(e);
      move(lastY);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      done(lastY, moved);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }

  private startDrag(ev: PointerEvent, l: OrderLine, row: HTMLDivElement, text: HTMLSpanElement): void {
    if (ev.button !== 0) return;
    this.dragging = { id: l.id, y: this.hostY(ev) };
    row.classList.add('dragging');
    const tag = row.querySelector<HTMLDivElement>('.tv-order-price');
    this.track(
      ev,
      (y) => {
        row.style.top = `${Math.round(y)}px`;
        const p = this.mapper.yToPrice(y);
        if (p !== null) {
          text.textContent = lineText({ ...l, price: p });
          if (tag) tag.textContent = p.toFixed(priceDecimals(p));
        }
      },
      (y, moved) => {
        this.dragging = null;
        row.classList.remove('dragging');
        const p = this.mapper.yToPrice(y);
        if (moved && p !== null && p > 0) void Promise.resolve(this.handlers.onDrop(l, p)).finally(() => this.render());
        else this.render();
      }
    );
  }

  private startBracketDrag(ev: PointerEvent, symbol: string, field: 'takeProfit' | 'stopLoss', pos: OrderLine): void {
    if (ev.button !== 0) return;
    this.dragging = { id: `ghost:${field}`, y: this.hostY(ev) };
    const ghost = this.buildLine(
      { ...pos, id: `ghost:${field}`, kind: field === 'takeProfit' ? 'tp' : 'sl', label: field === 'takeProfit' ? 'KÂR AL' : 'ZARAR DURDUR', color: field === 'takeProfit' ? '#089981' : '#F23645', drag: null, cancel: null, pnl: undefined },
      this.hostY(ev)
    );
    ghost.classList.add('dragging', 'ghost');
    this.el.appendChild(ghost);
    const text = ghost.querySelector<HTMLSpanElement>('.tv-order-text');
    this.track(
      ev,
      (y) => {
        ghost.style.top = `${Math.round(y)}px`;
        const p = this.mapper.yToPrice(y);
        if (p !== null && text) text.textContent = `${field === 'takeProfit' ? 'KÂR AL' : 'ZARAR DURDUR'} @ ${p.toFixed(priceDecimals(p))}`;
      },
      (y, moved) => {
        this.dragging = null;
        ghost.remove();
        const p = this.mapper.yToPrice(y);
        if (moved && p !== null && p > 0) void Promise.resolve(this.handlers.onBracket(symbol, field, p)).finally(() => this.render());
        else this.render();
      }
    );
  }
}
