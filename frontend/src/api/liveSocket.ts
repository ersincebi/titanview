import { tickClock } from '../state/perf';
import type { LiveCandleMessage, Timeframe } from '../types/market';

export type LiveTickCallback = (msg: LiveCandleMessage) => void;
export type ConnectionStateCallback = (connected: boolean) => void;

export class LiveMarketSocket {
  private ws: WebSocket | null = null;
  private currentSymbol = 'BTCUSDT';
  private currentInterval: Timeframe = '15m';
  private currentStreams: Array<{ symbol: string; interval: Timeframe }> | null = null;
  private onTick: LiveTickCallback;
  private onState: ConnectionStateCallback;
  private reconnectTimer: number | null = null;
  private destroyed = false;

  constructor(onTick: LiveTickCallback, onState: ConnectionStateCallback) {
    this.onTick = onTick;
    this.onState = onState;
  }

  public connect(symbol: string, interval: Timeframe): void {
    this.currentSymbol = symbol;
    this.currentInterval = interval;

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.sendSubscribe(symbol, interval);
      return;
    }

    this.openSocket();
  }

  private openSocket(): void {
    if (this.destroyed) return;
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // ignore
      }
    }

    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${proto}//${window.location.host}/ws/live?symbol=${encodeURIComponent(
      this.currentSymbol
    )}&interval=${encodeURIComponent(this.currentInterval)}`;

    const ws = new WebSocket(wsUrl);
    this.ws = ws;

    ws.onopen = () => {
      this.onState(true);
      if (this.currentStreams && this.currentStreams.length > 0) {
        this.sendSubscriptions(this.currentStreams);
      } else {
        this.sendSubscribe(this.currentSymbol, this.currentInterval);
      }
    };

    ws.onmessage = (ev) => {
      try {
        // Faz 30: tick → ekran ölçümü mesaj alındığı andan başlar (JSON ayrıştırma dahil)
        tickClock.lastReceivedAt = typeof performance !== 'undefined' ? performance.now() : 0;
        const msg = JSON.parse(String(ev.data)) as LiveCandleMessage;
        if (msg && msg.type === 'candle_update' && msg.candle) {
          this.onTick(msg);
        }
      } catch {
        // ignore non-candle frames
      }
    };

    ws.onclose = () => {
      this.onState(false);
      if (!this.destroyed) {
        if (this.reconnectTimer) window.clearTimeout(this.reconnectTimer);
        this.reconnectTimer = window.setTimeout(() => this.openSocket(), 2000);
      }
    };

    ws.onerror = () => {
      this.onState(false);
    };
  }

  public sendSubscribe(symbol: string, interval: Timeframe): void {
    this.currentSymbol = symbol;
    this.currentInterval = interval;
    this.currentStreams = null;
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({
          action: 'subscribe',
          symbol,
          interval,
        })
      );
    }
  }

  /** Faz 25: çoklu grafikte tüm açık (sembol, aralık) akışlarını tek WS bağlantısında abonelikler. */
  public sendSubscriptions(streams: Array<{ symbol: string; interval: Timeframe }>): void {
    if (streams.length <= 1) {
      const first = streams[0];
      if (first) this.sendSubscribe(first.symbol, first.interval);
      return;
    }
    this.currentSymbol = streams[0].symbol;
    this.currentInterval = streams[0].interval;
    this.currentStreams = streams.map((s) => ({ symbol: s.symbol, interval: s.interval }));
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({
          action: 'set_subscriptions',
          streams: this.currentStreams,
        })
      );
    }
  }

  public destroy(): void {
    this.destroyed = true;
    if (this.reconnectTimer) window.clearTimeout(this.reconnectTimer);
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}
