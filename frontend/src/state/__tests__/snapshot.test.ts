// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { rt } from '../runtime';
import { takeSnapshot } from '../snapshot';
import { setUi, toastMsg, ui } from '../store';

function fakeCanvas() {
  return { toDataURL: vi.fn(() => 'data:image/png;base64,AAAA'), toBlob: vi.fn((cb: (b: Blob | null) => void) => cb(new Blob(['x'], { type: 'image/png' }))) };
}

beforeEach(() => {
  rt.chart = undefined;
  setUi('symbol', 'THYAO.IS');
  setUi('interval', '1h');
});

describe('takeSnapshot', () => {
  it('does nothing when there is no chart or canvas', () => {
    takeSnapshot();
    rt.chart = { takeScreenshot: () => undefined } as never;
    takeSnapshot();
    expect(toastMsg()).not.toContain('kaydedildi');
  });

  it('downloads a PNG named after symbol+interval and copies it to the clipboard', async () => {
    const canvas = fakeCanvas();
    rt.chart = { takeScreenshot: () => canvas } as never;
    const write = vi.fn(async () => {});
    vi.stubGlobal('ClipboardItem', class { constructor(public items: unknown) {} });
    Object.defineProperty(navigator, 'clipboard', { value: { write }, configurable: true });
    const clicks: HTMLAnchorElement[] = [];
    const orig = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) { clicks.push(this); };
    try {
      takeSnapshot();
    } finally {
      HTMLAnchorElement.prototype.click = orig;
    }
    expect(clicks).toHaveLength(1);
    expect(clicks[0].download).toBe(`TitanView_${ui.symbol}_${ui.interval}.png`);
    expect(clicks[0].href).toContain('data:image/png');
    expect(write).toHaveBeenCalledTimes(1);
    expect(toastMsg()).toContain('THYAO.IS');
  });

  it('a failing screenshot shows an explicit message, never throws', () => {
    rt.chart = { takeScreenshot: () => { throw new Error('boom'); } } as never;
    expect(() => takeSnapshot()).not.toThrow();
    expect(toastMsg()).toBe('Ekran görüntüsü alınamadı');
  });
});
