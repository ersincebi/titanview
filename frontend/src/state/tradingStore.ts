import { tfmt, tt } from './i18n';
/**
 * Faz 28 — işlem arayüz durumu: sunucu paper hesabı (SSE), emir bileti, grafik çizgisi eylemleri,
 * Binance anahtar durumu ve iki adımlı onaylı gerçek emir.
 */
import { createMemo, createSignal } from 'solid-js';
import { createStore } from 'solid-js/store';
import {
  cancelBinanceOrder,
  cancelPaperOrder,
  closePaperPosition,
  confirmBinanceOrder,
  deleteBinanceKeys,
  fetchBinanceBalances,
  fetchBinanceOpenOrders,
  fetchBinanceStatus,
  fetchPaper,
  modifyPaperOrder,
  placePaperOrder,
  previewBinanceOrder,
  resetPaper,
  reversePaperPosition,
  saveBinanceKeys,
  setPaperBrackets,
  type BinanceBalance,
  type BinancePreview,
  type BinanceStatus,
  type OrderResult,
} from '../api/trading';
import {
  EMPTY_SNAPSHOT,
  defaultTicket,
  dragPatch,
  markSnapshot,
  roundPrice,
  ticketToRequest,
  validateTicket,
  type DragTarget,
  type OrderLine,
  type OrderSide,
  type PaperSnapshot,
  type Ticket,
  type TradingEvent,
} from './trading';
import { lastCandle, scheduleResize, setUi, toast, ui } from './store';

export const [paperSnap, setPaperSnap] = createSignal<PaperSnapshot>(EMPTY_SNAPSHOT);
export const [tradingError, setTradingError] = createSignal<string | null>(null);
export const [tradingBusy, setTradingBusy] = createSignal(false);
export type Broker = 'paper' | 'binance';
export const [broker, setBroker] = createSignal<Broker>('paper');
export const [ticket, setTicket] = createStore<Ticket>(defaultTicket(0));
export const [binanceStatus, setBinanceStatus] = createSignal<BinanceStatus | null>(null);
export const [binanceBalances, setBinanceBalances] = createSignal<BinanceBalance[]>([]);
export const [binanceOrders, setBinanceOrders] = createSignal<Array<Record<string, unknown>>>([]);
export const [binancePreview, setBinancePreview] = createSignal<BinancePreview | null>(null);
export const [binanceNote, setBinanceNote] = createSignal<string>('');

const livePrice = (): number => lastCandle()?.close ?? 0;

/** Grafik canlı fiyatıyla işaretlenmiş anlık durum (aktif sembolün K/Z'si her tikte güncel). */
export const paperView = createMemo(() => markSnapshot(paperSnap(), ui.symbol, livePrice()));

function apply(res: { snapshot: PaperSnapshot } | PaperSnapshot): void {
  const snap = 'snapshot' in res ? res.snapshot : res;
  // Sürüm sunucu yeniden başlayınca sıfırlanır; bu yüzden her anlık durum kabul edilir (sonraki olay düzeltir).
  setPaperSnap(snap);
}

function announce(evs: TradingEvent[]): void {
  const important = evs.filter((e) => e.kind === 'filled' || e.kind === 'rejected');
  const last = important[important.length - 1] ?? evs[evs.length - 1];
  if (last) toast(`${last.kind === 'rejected' ? '✗' : last.kind === 'filled' ? '✓' : '•'} ${last.message}`);
}

async function run(fn: () => Promise<OrderResult | PaperSnapshot>): Promise<boolean> {
  setTradingBusy(true);
  try {
    const res = await fn();
    apply(res);
    if ('events' in res) announce(res.events);
    setTradingError(null);
    return true;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    setTradingError(msg);
    toast(`✗ ${msg}`);
    return false;
  } finally {
    setTradingBusy(false);
  }
}

export async function refreshPaper(): Promise<void> {
  try {
    apply(await fetchPaper());
    setTradingError(null);
  } catch (e) {
    setTradingError(e instanceof Error ? e.message : String(e));
  }
}

let stream: EventSource | null = null;

/** Sunucu işlem akışı: her olayda tam anlık durum gelir; EventSource kendiliğinden yeniden bağlanır. */
export function connectTradingStream(): void {
  if (stream || typeof EventSource === 'undefined') return;
  stream = new EventSource('/api/trading/stream');
  stream.addEventListener('trading', (ev) => {
    try {
      const m = JSON.parse((ev as MessageEvent<string>).data) as { events: TradingEvent[]; snapshot: PaperSnapshot };
      apply(m.snapshot);
      // Kendi isteklerimizin sonucu zaten bildirildi; burada yalnız arka planda dolanlar (tarayıcı dışı tetik) duyurulur.
      const bg = m.events.filter((e) => e.kind === 'filled' || e.kind === 'rejected' || (e.kind === 'cancelled' && e.message.includes('OCO')));
      if (bg.length && !tradingBusy()) announce(bg);
    } catch {
      /* bozuk olay */
    }
  });
}

export function disconnectTradingStream(): void {
  stream?.close();
  stream = null;
}

function revealPanel(): void {
  setUi('wbTab', 'paper');
  if (ui.wbCollapsed) {
    setUi('wbCollapsed', false);
    scheduleResize();
  }
}

/** Tek tık AL/SAT (grafik hızlı işlem kutusu): aktif sembolde piyasa emri. */
export async function quickOrder(side: OrderSide, qty: number): Promise<boolean> {
  const ok = await run(() => placePaperOrder({ symbol: ui.symbol, side, type: 'market', qty: qty > 0 ? qty : 1 }));
  if (ok) revealPanel();
  return ok;
}

export function ticketErrors(): string[] {
  return validateTicket(ticket, livePrice());
}

/** Bileti aktif aracıya gönderir (paper: doğrudan; Binance: önce önizleme + onay). */
export async function submitTicket(): Promise<boolean> {
  const errs = ticketErrors();
  if (errs.length) {
    setTradingError(errs.join(' · '));
    toast(`✗ ${errs[0]}`);
    return false;
  }
  if (broker() === 'binance') return previewTicketOnBinance();
  const ok = await run(() => placePaperOrder(ticketToRequest(ticket, ui.symbol)));
  if (ok) revealPanel();
  return ok;
}

/** Bilet fiyatlarını son fiyata hizalar (sembol değişince / "Son fiyat" düğmesi). */
export function syncTicketPrices(): void {
  const p = roundPrice(livePrice());
  if (!(p > 0)) return;
  setTicket({ limitPrice: p, stopPrice: p });
}

export async function cancelOrder(id: string): Promise<boolean> {
  return run(() => cancelPaperOrder(id));
}

export async function closePosition(symbol: string): Promise<boolean> {
  return run(() => closePaperPosition(symbol));
}

export async function reversePosition(symbol: string): Promise<boolean> {
  return run(() => reversePaperPosition(symbol));
}

export async function resetAccount(initial: number, commissionPct: number): Promise<boolean> {
  return run(() => resetPaper(initial, commissionPct));
}

/** Grafikte sürüklenen çizgi bırakıldı. */
export async function dropLine(target: DragTarget, price: number): Promise<boolean> {
  const p = dragPatch(target, price);
  if (p.orderId) return run(() => modifyPaperOrder(p.orderId!, p.body));
  return run(() => setPaperBrackets(p.symbol!, p.body.takeProfit ?? 0, p.body.stopLoss ?? 0));
}

/** Çizginin ✕ düğmesi. */
export async function cancelLine(l: OrderLine): Promise<boolean> {
  const c = l.cancel;
  if (!c) return false;
  if (c.kind === 'order') return cancelOrder(c.orderId);
  if (c.kind === 'position') return closePosition(c.symbol);
  return run(() => modifyPaperOrder(c.orderId, { [c.field]: -1 }));
}

/** Pozisyon TP/SL (tablodan veya pozisyon çizgisinden sürükleyerek). */
export async function setBrackets(symbol: string, takeProfit: number, stopLoss: number): Promise<boolean> {
  return run(() => setPaperBrackets(symbol, takeProfit, stopLoss));
}

// ---------- Binance ----------

export async function refreshBinance(): Promise<void> {
  try {
    const st = await fetchBinanceStatus();
    setBinanceStatus(st);
    if (st.configured) {
      const [bal, orders] = await Promise.all([fetchBinanceBalances(), fetchBinanceOpenOrders('')]);
      setBinanceBalances(bal);
      setBinanceOrders(orders);
    } else {
      setBinanceBalances([]);
      setBinanceOrders([]);
    }
    setBinanceNote('');
  } catch (e) {
    setBinanceNote(`✗ ${e instanceof Error ? e.message : String(e)}`);
  }
}

export async function saveBinance(apiKey: string, secret: string, testnet: boolean): Promise<boolean> {
  try {
    setBinanceStatus(await saveBinanceKeys(apiKey, secret, testnet));
    setBinanceNote(tt("✓ Anahtar sunucuda şifreli kaydedildi"));
    void refreshBinance();
    return true;
  } catch (e) {
    setBinanceNote(`✗ ${e instanceof Error ? e.message : String(e)}`);
    return false;
  }
}

export async function removeBinance(): Promise<void> {
  try {
    setBinanceStatus(await deleteBinanceKeys());
    setBinanceBalances([]);
    setBinanceOrders([]);
    setBinancePreview(null);
    setBinanceNote('Anahtar silindi');
  } catch (e) {
    setBinanceNote(`✗ ${e instanceof Error ? e.message : String(e)}`);
  }
}

async function previewTicketOnBinance(): Promise<boolean> {
  setTradingBusy(true);
  try {
    const r = ticketToRequest(ticket, ui.symbol);
    const p = await previewBinanceOrder({ symbol: r.symbol, side: r.side, type: r.type, qty: r.qty, limitPrice: r.limitPrice, stopPrice: r.stopPrice });
    setBinancePreview(p);
    setBinanceNote(tt("Binance emri doğruladı (/order/test). Göndermek için onaylayın."));
    return true;
  } catch (e) {
    setBinanceNote(`✗ ${e instanceof Error ? e.message : String(e)}`);
    return false;
  } finally {
    setTradingBusy(false);
  }
}

/** Kullanıcı onay penceresinde "Onayla ve gönder"e bastı. */
export async function confirmBinance(): Promise<boolean> {
  const p = binancePreview();
  if (!p) return false;
  setTradingBusy(true);
  try {
    const res = await confirmBinanceOrder(p.token);
    setBinancePreview(null);
    setBinanceNote(`✓ Binance emri gönderildi: #${String(res.orderId ?? '?')} ${String(res.status ?? '')}`);
    toast(tfmt("✓ Binance emri gönderildi (#{0})", String(res.orderId ?? '?')));
    void refreshBinance();
    return true;
  } catch (e) {
    setBinancePreview(null);
    setBinanceNote(`✗ ${e instanceof Error ? e.message : String(e)}`);
    return false;
  } finally {
    setTradingBusy(false);
  }
}

export function dismissBinancePreview(): void {
  setBinancePreview(null);
  setBinanceNote(tt("Emir gönderilmedi."));
}

export async function cancelBinance(symbol: string, orderId: number): Promise<void> {
  try {
    await cancelBinanceOrder(symbol, orderId);
    setBinanceNote(`✓ #${orderId} iptal edildi`);
    void refreshBinance();
  } catch (e) {
    setBinanceNote(`✗ ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** Uygulama açılışı: hesabı oku, akışa bağlan, Binance durumunu öğren. */
export function startTrading(): void {
  void refreshPaper();
  connectTradingStream();
  void fetchBinanceStatus().then(setBinanceStatus, () => setBinanceStatus(null));
}
