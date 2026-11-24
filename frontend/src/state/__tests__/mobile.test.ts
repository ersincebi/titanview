import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MOBILE_MAX_WIDTH, createLongPress, isMobileWidth } from '../mobile';

describe('isMobileWidth', () => {
  it('breakpoint is inclusive at the CSS threshold', () => {
    expect(isMobileWidth(MOBILE_MAX_WIDTH)).toBe(true);
    expect(isMobileWidth(MOBILE_MAX_WIDTH + 1)).toBe(false);
    expect(isMobileWidth(390)).toBe(true);
    expect(isMobileWidth(1440)).toBe(false);
  });
  it('0/unknown width is not treated as mobile', () => {
    expect(isMobileWidth(0)).toBe(false);
  });
});

describe('createLongPress', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('fires after the delay at the press point', () => {
    const cb = vi.fn();
    const lp = createLongPress({ onLongPress: cb });
    lp.start(10, 20);
    vi.advanceTimersByTime(499);
    expect(cb).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2);
    expect(cb).toHaveBeenCalledWith(10, 20);
    expect(lp.fired()).toBe(true);
  });
  it('is cancelled by release before the delay', () => {
    const cb = vi.fn();
    const lp = createLongPress({ onLongPress: cb });
    lp.start(0, 0);
    vi.advanceTimersByTime(200);
    lp.end();
    vi.advanceTimersByTime(1000);
    expect(cb).not.toHaveBeenCalled();
    expect(lp.fired()).toBe(false);
  });
  it('is cancelled by moving past the tolerance (pan), but not by small jitter', () => {
    const cb = vi.fn();
    const lp = createLongPress({ onLongPress: cb, tolerance: 10 });
    lp.start(0, 0);
    lp.move(4, 4);
    vi.advanceTimersByTime(600);
    expect(cb).toHaveBeenCalledTimes(1);
    cb.mockClear();
    lp.start(0, 0);
    lp.move(30, 0);
    vi.advanceTimersByTime(600);
    expect(cb).not.toHaveBeenCalled();
  });
  it('a new press restarts the timer and resets fired()', () => {
    const cb = vi.fn();
    const lp = createLongPress({ onLongPress: cb });
    lp.start(0, 0);
    vi.advanceTimersByTime(600);
    expect(lp.fired()).toBe(true);
    lp.start(5, 5);
    expect(lp.fired()).toBe(false);
  });
});
