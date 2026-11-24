/**
 * Faz 25: Sekmeler / pencereler arası canlı eşitleme (BroadcastChannel).
 * Açık diğer TitanView sekmeleriyle sembol, aralık, imleç, zaman, tarih aralığı, çizimler ve
 * kayıtlı düzen listesi değişikliklerini gerçek zamanlı paylaşır.
 */

export const TAB_SYNC_CHANNEL = 'titanview_sync_v1';

export type TabSyncPayload =
  | { type: 'hello' }
  | { type: 'ack' }
  | { type: 'bye' }
  | { type: 'symbol'; symbol: string }
  | { type: 'interval'; interval: string }
  | { type: 'crosshair'; time: number | null }
  | { type: 'time'; time: number }
  | { type: 'dateRange'; from: number; to: number }
  | { type: 'drawings'; symbol: string; layoutId: string }
  | { type: 'layouts_changed' };

export type TabSyncMessage = TabSyncPayload & { sender: string; ts: number };

export interface BroadcastLike {
  postMessage(data: unknown): void;
  close(): void;
  onmessage: ((ev: MessageEvent<unknown>) => void) | null;
}

export type TabSyncListener = (msg: TabSyncMessage) => void;

export class TabSyncBus {
  public readonly tabId: string;
  private channel: BroadcastLike | null = null;
  private listeners = new Set<TabSyncListener>();
  private peers = new Map<string, number>();
  private peerCallbacks = new Set<(count: number) => void>();
  private lastSentAt = new Map<string, number>();
  private pingTimer: ReturnType<typeof setInterval> | undefined;

  constructor(factory?: () => BroadcastLike | null, tabId?: string) {
    this.tabId = tabId ?? `tab_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
    if (factory) {
      this.channel = factory();
    } else if (typeof BroadcastChannel !== 'undefined') {
      try {
        this.channel = new BroadcastChannel(TAB_SYNC_CHANNEL);
      } catch {
        this.channel = null;
      }
    }
    if (this.channel) {
      this.channel.onmessage = (ev) => this.handleIncoming(ev.data);
      this.send({ type: 'hello' });
      this.pingTimer = setInterval(() => this.prunePeers(), 15_000);
      if (typeof window !== 'undefined') {
        window.addEventListener('beforeunload', this.onUnload);
      }
    }
  }

  private onUnload = () => {
    this.send({ type: 'bye' });
  };

  public isSupported(): boolean {
    return this.channel !== null;
  }

  public peerCount(): number {
    this.prunePeers(false);
    return this.peers.size;
  }

  public onPeersChange(fn: (count: number) => void): () => void {
    this.peerCallbacks.add(fn);
    fn(this.peers.size);
    return () => this.peerCallbacks.delete(fn);
  }

  public subscribe(fn: TabSyncListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  public send(payload: TabSyncPayload, throttleMs = 0): void {
    if (!this.channel) return;
    const now = Date.now();
    if (throttleMs > 0) {
      const prev = this.lastSentAt.get(payload.type) ?? 0;
      if (now - prev < throttleMs) return;
      this.lastSentAt.set(payload.type, now);
    }
    const msg: TabSyncMessage = { ...payload, sender: this.tabId, ts: now };
    try {
      this.channel.postMessage(msg);
    } catch {
      // kanal kapalı olabilir
    }
  }

  private handleIncoming(raw: unknown): void {
    if (!raw || typeof raw !== 'object') return;
    const msg = raw as TabSyncMessage;
    if (!msg.sender || msg.sender === this.tabId || typeof msg.type !== 'string') return;
    if (msg.type === 'bye') {
      if (this.peers.delete(msg.sender)) this.emitPeers();
      return;
    }
    const had = this.peers.has(msg.sender);
    this.peers.set(msg.sender, Date.now());
    if (!had) this.emitPeers();
    if (msg.type === 'hello') {
      this.send({ type: 'ack' });
      return;
    }
    if (msg.type === 'ack') return;
    for (const fn of this.listeners) fn(msg);
  }

  private prunePeers(notify = true): void {
    const cutoff = Date.now() - 45_000;
    let changed = false;
    for (const [id, at] of this.peers) {
      if (at < cutoff) {
        this.peers.delete(id);
        changed = true;
      }
    }
    if (changed && notify) this.emitPeers();
  }

  private emitPeers(): void {
    const n = this.peers.size;
    for (const fn of this.peerCallbacks) fn(n);
  }

  public destroy(): void {
    if (this.pingTimer !== undefined) clearInterval(this.pingTimer);
    this.pingTimer = undefined;
    if (typeof window !== 'undefined') {
      window.removeEventListener('beforeunload', this.onUnload);
    }
    this.send({ type: 'bye' });
    try {
      this.channel?.close();
    } catch {
      // ignore
    }
    this.channel = null;
    this.listeners.clear();
    this.peerCallbacks.clear();
    this.peers.clear();
  }
}
