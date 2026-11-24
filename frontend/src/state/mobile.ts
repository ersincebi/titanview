/** Mobil görünüm: kırılma noktası, uzun basma ve çevrimdışı algılama (saf mantık, test edilebilir). */

/** CSS `@media (max-width: …)` ile aynı eşik olmalı (terminal.css, mobil bölümü). */
export const MOBILE_MAX_WIDTH = 820;

export function isMobileWidth(width: number): boolean {
  return width > 0 && width <= MOBILE_MAX_WIDTH;
}

export interface LongPressOptions {
  /** Uzun basma süresi (ms). */
  delay?: number;
  /** Bu kadar px kayarsa iptal (kaydırma/pan sanılır). */
  tolerance?: number;
  onLongPress: (x: number, y: number) => void;
}

export interface LongPress {
  start(x: number, y: number): void;
  move(x: number, y: number): void;
  end(): void;
  /** Son basma uzun basma olarak tetiklendi mi (ardından gelen tıklamayı yutmak için). */
  fired(): boolean;
}

export function createLongPress(opts: LongPressOptions): LongPress {
  const delay = opts.delay ?? 500;
  const tol = opts.tolerance ?? 10;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let sx = 0;
  let sy = 0;
  let didFire = false;
  const clear = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  return {
    start(x, y) {
      clear();
      didFire = false;
      sx = x;
      sy = y;
      timer = setTimeout(() => {
        timer = null;
        didFire = true;
        opts.onLongPress(sx, sy);
      }, delay);
    },
    move(x, y) {
      if (timer !== null && Math.hypot(x - sx, y - sy) > tol) clear();
    },
    end: clear,
    fired: () => didFire,
  };
}
