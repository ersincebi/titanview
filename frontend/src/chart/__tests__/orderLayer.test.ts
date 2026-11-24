// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { OrderLayer } from '../OrderLayer';
import type { OrderLine } from '../../state/trading';

// y = 1000 - price (basit doğrusal eşleme)
const mapper = { priceToY: (p: number) => 1000 - p, yToPrice: (y: number) => 1000 - y };

function setup() {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const handlers = { onDrop: vi.fn(), onCancel: vi.fn(), onBracket: vi.fn() };
  const layer = new OrderLayer(host, mapper, handlers);
  // jsdom'da düzen yok: katman kutusunu elle ver
  layer.el.getBoundingClientRect = () => ({ top: 0, left: 0, right: 800, bottom: 1000, width: 800, height: 1000, x: 0, y: 0, toJSON: () => ({}) });
  return { host, layer, handlers };
}

const limit: OrderLine = {
  id: 'o:e1:limit', kind: 'entry-limit', price: 600, qty: 1, label: 'LİMİT AL 1', color: '#0284C7',
  drag: { kind: 'order', orderId: 'e1', field: 'limitPrice' }, cancel: { kind: 'order', orderId: 'e1' },
};
const pos: OrderLine = {
  id: 'pos:BTCUSDT', kind: 'position', price: 500, qty: 2, label: 'LONG 2', color: '#089981', drag: null,
  cancel: { kind: 'position', symbol: 'BTCUSDT' }, pnl: 20,
};

const pe = (type: string, clientY: number) => {
  const e = new MouseEvent(type, { bubbles: true, clientY, button: 0 });
  return e as unknown as PointerEvent;
};

describe('OrderLayer (Faz 28)', () => {
  it('renders lines at their price with label, qty and axis tag', () => {
    const { layer } = setup();
    layer.setLines([limit, pos]);
    const rows = layer.el.querySelectorAll<HTMLDivElement>('.tv-order-line');
    expect(rows).toHaveLength(2);
    expect(rows[0].style.top).toBe('400px');
    expect(rows[0].querySelector('.tv-order-text')!.textContent).toBe('LİMİT AL 1 @ 600.00');
    expect(rows[0].querySelector('.tv-order-price')!.textContent).toBe('600.0000');
    expect(rows[1].querySelector('.tv-order-text')!.classList.contains('pos')).toBe(true);
    expect(rows[1].querySelectorAll('[data-bracket]')).toHaveLength(2);
    expect(layer.getLines()).toHaveLength(2);
  });

  it('drags an order label to a new price and reports the drop', () => {
    const { layer, handlers } = setup();
    layer.setLines([limit]);
    const label = layer.el.querySelector<HTMLDivElement>('.tv-order-label')!;
    label.dispatchEvent(pe('pointerdown', 400));
    window.dispatchEvent(pe('pointermove', 350));
    const row = layer.el.querySelector<HTMLDivElement>('.tv-order-line')!;
    expect(row.style.top).toBe('350px');
    expect(row.querySelector('.tv-order-text')!.textContent).toContain('@ 650');
    layer.setLines([limit]); // sürükleme sırasında yeniden çizim ertelenir
    expect(layer.el.querySelector('.dragging')).not.toBeNull();
    window.dispatchEvent(pe('pointerup', 350));
    expect(handlers.onDrop).toHaveBeenCalledWith(limit, 650);
  });

  it('nudges overlapping labels down while lines stay at their price', () => {
    const { layer } = setup();
    const near = { ...limit, id: 'o:e2:limit', price: 595 };
    layer.setLines([near, limit]);
    const rows = [...layer.el.querySelectorAll<HTMLDivElement>('.tv-order-line')];
    expect(rows.map((r) => r.style.top)).toEqual(['400px', '405px']);
    expect(rows[0].querySelector<HTMLDivElement>('.tv-order-label')!.style.top).toBe('');
    expect(rows[1].querySelector<HTMLDivElement>('.tv-order-label')!.style.top).toBe('7px'); // 422 - 405 - 10
  });

  it('snaps back to the server price when the drop is rejected', async () => {
    const { layer, handlers } = setup();
    handlers.onDrop.mockResolvedValue(false); // sunucu reddetti, anlık durum değişmedi
    layer.setLines([limit]);
    layer.el.querySelector<HTMLDivElement>('.tv-order-label')!.dispatchEvent(pe('pointerdown', 400));
    window.dispatchEvent(pe('pointermove', 300));
    window.dispatchEvent(pe('pointerup', 300));
    expect(layer.el.querySelector<HTMLDivElement>('.tv-order-line')!.style.top).toBe('300px');
    await Promise.resolve();
    await Promise.resolve();
    expect(layer.el.querySelector<HTMLDivElement>('.tv-order-line')!.style.top).toBe('400px');
  });

  it('a click without movement does not modify the order', () => {
    const { layer, handlers } = setup();
    layer.setLines([limit]);
    layer.el.querySelector<HTMLDivElement>('.tv-order-label')!.dispatchEvent(pe('pointerdown', 400));
    window.dispatchEvent(pe('pointerup', 400));
    expect(handlers.onDrop).not.toHaveBeenCalled();
  });

  it('✕ cancels the order / closes the position', () => {
    const { layer, handlers } = setup();
    layer.setLines([limit, pos]);
    layer.el.querySelector<HTMLButtonElement>('[data-cancel-line="pos:BTCUSDT"]')!.click();
    expect(handlers.onCancel).toHaveBeenCalledWith(pos);
  });

  it('drags TP / SL out of the position label', () => {
    const { layer, handlers } = setup();
    layer.setLines([pos]);
    layer.el.querySelector<HTMLButtonElement>('[data-bracket="takeProfit"]')!.dispatchEvent(pe('pointerdown', 500));
    expect(layer.el.querySelector('.ghost')).not.toBeNull();
    window.dispatchEvent(pe('pointermove', 450));
    window.dispatchEvent(pe('pointerup', 450));
    expect(handlers.onBracket).toHaveBeenCalledWith('BTCUSDT', 'takeProfit', 550);
    expect(layer.el.querySelector('.ghost')).toBeNull();
    layer.destroy();
    expect(layer.el.isConnected).toBe(false);
  });
});
