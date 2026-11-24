import type { Candle } from '../types/market';

export type ReplayState = 'idle' | 'paused' | 'playing';
export type ReplaySpeed = '0.5x' | '1x' | '2x' | '5x' | '10x';

export interface BarReplayOptions {
  onStep?: (currentCandles: Candle[], nextBar: Candle) => void;
  onStateChange?: (state: ReplayState) => void;
  onStop?: (fullCandles: Candle[]) => void;
  defaultSpeed?: ReplaySpeed;
}

export const SPEED_DELAYS: Record<ReplaySpeed, number> = {
  '0.5x': 1800,
  '1x': 1000,
  '2x': 450,
  '5x': 180,
  '10x': 80,
};

export class BarReplay {
  private state: ReplayState = 'idle';
  private speed: ReplaySpeed = '2x';
  private timer: number | null = null;

  private fullCandles: Candle[] = [];
  private currentCandles: Candle[] = [];
  private replayIndex = 0;

  private onStep?: (currentCandles: Candle[], nextBar: Candle) => void;
  private onStateChange?: (state: ReplayState) => void;
  private onStop?: (fullCandles: Candle[]) => void;

  constructor(options: BarReplayOptions = {}) {
    this.onStep = options.onStep;
    this.onStateChange = options.onStateChange;
    this.onStop = options.onStop;
    if (options.defaultSpeed) this.speed = options.defaultSpeed;
  }

  public isActive(): boolean {
    return this.state !== 'idle';
  }

  public isPlaying(): boolean {
    return this.state === 'playing';
  }

  public getState(): ReplayState {
    return this.state;
  }

  public getSpeed(): ReplaySpeed {
    return this.speed;
  }

  public setSpeed(speed: ReplaySpeed): void {
    this.speed = speed;
    if (this.state === 'playing') {
      this.pause();
      this.play(speed);
    }
  }

  public getCurrentCandles(): Candle[] {
    return [...this.currentCandles];
  }

  public getFullCandles(): Candle[] {
    return [...this.fullCandles];
  }

  public getProgress(): { current: number; total: number; percent: number } {
    const total = this.fullCandles.length;
    const current = this.currentCandles.length;
    const percent = total > 0 ? (current / total) * 100 : 0;
    return { current, total, percent };
  }

  /**
   * Starts bar replay mode by slicing candles at the given index
   * (defaults to 65% of the total bars, or minimum 20 bars).
   */
  public start(allCandles: Candle[], startIndex?: number): Candle[] {
    // Yeniden başlatma: onStop (tam veriyi yeniden yükler) tetiklenmemeli, yoksa replay hemen iptal olur
    this.clearTimer();
    this.fullCandles = [];
    this.currentCandles = [];
    this.replayIndex = 0;
    this.state = 'idle';
    if (!allCandles || allCandles.length < 5) {
      return allCandles || [];
    }

    this.fullCandles = [...allCandles].sort((a, b) => a.time - b.time);
    let cutIdx = startIndex;
    if (cutIdx === undefined || cutIdx <= 0) {
      cutIdx = Math.max(10, Math.floor(this.fullCandles.length * 0.65));
    }
    cutIdx = Math.min(cutIdx, this.fullCandles.length - 1);

    this.replayIndex = cutIdx;
    this.currentCandles = this.fullCandles.slice(0, cutIdx);
    this.setState('paused');

    return [...this.currentCandles];
  }

  /**
   * Jumps replay starting position to a specific Unix timestamp.
   */
  public jumpToTimestamp(timestamp: number): Candle[] {
    if (this.fullCandles.length === 0) return [];
    let idx = this.fullCandles.findIndex((c) => c.time >= timestamp);
    if (idx === -1) idx = this.fullCandles.length - 1;
    if (idx < 5) idx = Math.min(5, this.fullCandles.length - 1);

    this.replayIndex = idx;
    this.currentCandles = this.fullCandles.slice(0, idx);
    this.pause();
    return [...this.currentCandles];
  }

  /** Standart Bar Replay: rastgele bir geçmiş bara atlar. */
  public jumpToRandom(rng: () => number = Math.random): Candle[] {
    const n = this.fullCandles.length;
    if (n < 10) return [...this.currentCandles];
    const minIdx = Math.max(5, Math.floor(n * 0.15));
    const maxIdx = Math.max(minIdx + 1, n - 5);
    const idx = minIdx + Math.floor(rng() * (maxIdx - minIdx));
    this.replayIndex = idx;
    this.currentCandles = this.fullCandles.slice(0, idx);
    this.pause();
    return [...this.currentCandles];
  }

  public getCurrentTime(): number | null {
    const cur = this.currentCandles[this.currentCandles.length - 1];
    return cur ? cur.time : null;
  }

  public getTimeBounds(): { min: number; max: number } | null {
    if (this.fullCandles.length === 0) return null;
    return { min: this.fullCandles[0].time, max: this.fullCandles[this.fullCandles.length - 1].time };
  }

  /**
   * Advances replay simulation by 1 bar forward.
   */
  public step(): Candle | null {
    if (this.state === 'idle' || this.replayIndex >= this.fullCandles.length) {
      this.pause();
      return null;
    }

    const nextBar = this.fullCandles[this.replayIndex];
    this.replayIndex++;
    this.currentCandles.push(nextBar);

    this.onStep?.(this.currentCandles, nextBar);

    if (this.replayIndex >= this.fullCandles.length) {
      this.pause();
    }

    return nextBar;
  }

  /**
   * Starts automatic bar playback at the current or specified speed.
   */
  public play(speed?: ReplaySpeed): void {
    if (this.state === 'idle') return;
    if (speed) this.speed = speed;

    this.clearTimer();
    this.setState('playing');

    const delay = SPEED_DELAYS[this.speed] || 450;
    this.timer = window.setInterval(() => {
      const bar = this.step();
      if (!bar) {
        this.pause();
      }
    }, delay);
  }

  /**
   * Pauses automatic bar playback.
   */
  public pause(): void {
    this.clearTimer();
    if (this.state !== 'idle') {
      this.setState('paused');
    }
  }

  /**
   * Exits replay mode and restores full candle history.
   */
  public stop(): Candle[] {
    this.clearTimer();
    const restored = [...this.fullCandles];
    this.fullCandles = [];
    this.currentCandles = [];
    this.replayIndex = 0;
    this.setState('idle');
    this.onStop?.(restored);
    return restored;
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
  }

  private setState(state: ReplayState): void {
    this.state = state;
    this.onStateChange?.(state);
  }
}

