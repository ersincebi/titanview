import { tfmt, tt } from './i18n';
/**
 * Faz 28 — işlem: sunucu paper motorunun tipleri + saf yardımcılar (emir bileti doğrulama,
 * TP/SL hesap, grafikte emir/pozisyon çizgisi modeli, sürükle → API yaması).
 */

export type OrderSide = 'buy' | 'sell';
export type OrderType = 'market' | 'limit' | 'stop' | 'stop_limit';
export type OrderStatus = 'working' | 'filled' | 'cancelled' | 'rejected';
export type OrderRole = 'entry' | 'tp' | 'sl';

export interface PaperOrder {
  id: string;
  symbol: string;
  side: OrderSide;
  type: OrderType;
  qty: number;
  limitPrice?: number;
  stopPrice?: number;
  takeProfit?: number;
  stopLoss?: number;
  role: OrderRole;
  parentId?: string;
  ocoGroup?: string;
  reduceOnly?: boolean;
  triggered?: boolean;
  status: OrderStatus;
  reason?: string;
  createdAt: number;
  updatedAt: number;
  filledAt?: number;
  fillPrice?: number;
}

export interface PaperPositionNet {
  symbol: string;
  qty: number; // >0 long, <0 short
  avgPrice: number;
  last: number;
  openedAt: number;
  realized: number;
}

export interface PaperFill {
  id: string;
  orderId: string;
  symbol: string;
  side: OrderSide;
  type: OrderType;
  role: OrderRole;
  qty: number;
  price: number;
  commission: number;
  realized: number;
  time: number;
}

export interface PaperSummary {
  balance: number;
  equity: number;
  unrealized: number;
  realized: number;
  marginUsed: number;
  available: number;
  initialBalance: number;
}

export interface PaperSnapshot {
  initialBalance: number;
  balance: number;
  commissionPct: number;
  orders: PaperOrder[];
  positions: PaperPositionNet[];
  fills: PaperFill[];
  closed: PaperOrder[];
  summary: PaperSummary;
  version: number;
}

export interface TradingEvent {
  kind: 'placed' | 'filled' | 'cancelled' | 'rejected' | 'modified' | 'reset';
  orderId?: string;
  symbol?: string;
  message: string;
  time: number;
}

export interface OrderRequest {
  symbol: string;
  side: OrderSide;
  type: OrderType;
  qty: number;
  limitPrice?: number;
  stopPrice?: number;
  takeProfit?: number;
  stopLoss?: number;
  reduceOnly?: boolean;
}

export const EMPTY_SNAPSHOT: PaperSnapshot = {
  initialBalance: 100000,
  balance: 100000,
  commissionPct: 0,
  orders: [],
  positions: [],
  fills: [],
  closed: [],
  summary: { balance: 100000, equity: 100000, unrealized: 0, realized: 0, marginUsed: 0, available: 100000, initialBalance: 100000 },
  version: 0,
};

export const TYPE_LABEL: Record<OrderType, string> = { market: tt("Piyasa"), limit: 'Limit', stop: 'Stop', stop_limit: 'Stop-Limit' };
export const SIDE_LABEL: Record<OrderSide, string> = { buy: 'AL', sell: 'SAT' };
export const ROLE_LABEL: Record<OrderRole, string> = { entry: tt("Giriş"), tp: 'Kâr Al', sl: 'Zarar Durdur' };

/** Emir bileti (sağ çekmece) taslağı. */
export interface Ticket {
  side: OrderSide;
  type: OrderType;
  qty: number;
  limitPrice: number;
  stopPrice: number;
  tpOn: boolean;
  slOn: boolean;
  takeProfit: number;
  stopLoss: number;
}

export function defaultTicket(last: number): Ticket {
  const p = last > 0 ? last : 0;
  return { side: 'buy', type: 'market', qty: 1, limitPrice: p, stopPrice: p, tpOn: false, slOn: false, takeProfit: 0, stopLoss: 0 };
}

/** Girişin beklenen dolum fiyatı (piyasa → son fiyat). */
export function entryPrice(t: Pick<Ticket, 'type' | 'limitPrice' | 'stopPrice'>, last: number): number {
  if (t.type === 'limit' || t.type === 'stop_limit') return t.limitPrice;
  if (t.type === 'stop') return t.stopPrice;
  return last;
}

/** Giriş fiyatından yüzdeyle TP/SL (alışta TP yukarı, SL aşağı; satışta tersi). */
export function bracketFromPct(side: OrderSide, entry: number, tpPct: number, slPct: number): { takeProfit: number; stopLoss: number } {
  const dir = side === 'buy' ? 1 : -1;
  return { takeProfit: roundPrice(entry * (1 + (dir * tpPct) / 100)), stopLoss: roundPrice(entry * (1 - (dir * slPct) / 100)) };
}

/** Fiyat büyüklüğüne göre makul ondalık. */
export function priceDecimals(p: number): number {
  const a = Math.abs(p);
  if (a >= 1000) return 2;
  if (a >= 1) return 4;
  if (a >= 0.01) return 6;
  return 8;
}

export function roundPrice(p: number): number {
  if (!Number.isFinite(p)) return 0;
  const f = 10 ** priceDecimals(p);
  return Math.round(p * f) / f;
}

/** Bileti sunucuya gitmeden doğrular (sunucu aynı kuralları yeniden uygular). Hata yoksa []. */
export function validateTicket(t: Ticket, last: number): string[] {
  const errs: string[] = [];
  if (!(t.qty > 0)) errs.push(tt("Adet sıfırdan büyük olmalı"));
  if ((t.type === 'limit' || t.type === 'stop_limit') && !(t.limitPrice > 0)) errs.push(tt("Limit fiyatı gerekli"));
  if (t.type === 'stop' || t.type === 'stop_limit') {
    if (!(t.stopPrice > 0)) errs.push(tt("Stop fiyatı gerekli"));
    else if (last > 0 && t.side === 'buy' && t.stopPrice <= last) errs.push(tt("Alış stop fiyatı piyasanın üzerinde olmalı"));
    else if (last > 0 && t.side === 'sell' && t.stopPrice >= last) errs.push(tt("Satış stop fiyatı piyasanın altında olmalı"));
  }
  if (t.type === 'market' && !(last > 0)) errs.push(tt("Güncel fiyat yok"));
  const e = entryPrice(t, last);
  if (e > 0) {
    const buy = t.side === 'buy';
    if (t.tpOn && (!(t.takeProfit > 0) || (buy ? t.takeProfit <= e : t.takeProfit >= e))) errs.push(buy ? tt("Kâr al girişin üzerinde olmalı") : tt("Kâr al girişin altında olmalı"));
    if (t.slOn && (!(t.stopLoss > 0) || (buy ? t.stopLoss >= e : t.stopLoss <= e))) errs.push(buy ? tt("Zarar durdur girişin altında olmalı") : tt("Zarar durdur girişin üzerinde olmalı"));
  }
  return errs;
}

export function ticketToRequest(t: Ticket, symbol: string): OrderRequest {
  const r: OrderRequest = { symbol, side: t.side, type: t.type, qty: t.qty };
  if (t.type === 'limit' || t.type === 'stop_limit') r.limitPrice = t.limitPrice;
  if (t.type === 'stop' || t.type === 'stop_limit') r.stopPrice = t.stopPrice;
  if (t.tpOn && t.takeProfit > 0) r.takeProfit = t.takeProfit;
  if (t.slOn && t.stopLoss > 0) r.stopLoss = t.stopLoss;
  return r;
}

/** Risk/ödül özeti (bilet altı). */
export function ticketRisk(t: Ticket, last: number): { notional: number; reward: number | null; risk: number | null; rr: number | null } {
  const e = entryPrice(t, last);
  const notional = e > 0 ? e * t.qty : 0;
  const reward = t.tpOn && t.takeProfit > 0 && e > 0 ? Math.abs(t.takeProfit - e) * t.qty : null;
  const risk = t.slOn && t.stopLoss > 0 && e > 0 ? Math.abs(e - t.stopLoss) * t.qty : null;
  return { notional, reward, risk, rr: reward !== null && risk !== null && risk > 0 ? reward / risk : null };
}

// ---------- grafikte emir çizgileri ----------

export type LineKind = 'position' | 'entry-limit' | 'entry-stop' | 'pending-tp' | 'pending-sl' | 'tp' | 'sl';

/** Sürükleme sonucu sunucuya gidecek değişiklik. */
export type DragTarget =
  | { kind: 'order'; orderId: string; field: 'limitPrice' | 'stopPrice' | 'takeProfit' | 'stopLoss' }
  | { kind: 'position-bracket'; symbol: string; field: 'takeProfit' | 'stopLoss' };

export interface OrderLine {
  id: string;
  kind: LineKind;
  price: number;
  label: string;
  qty: number;
  color: string;
  /** null → sürüklenemez (pozisyon çizgisi). */
  drag: DragTarget | null;
  /** ✕ düğmesi: emri iptal et / pozisyonu kapat / köprüyü kaldır. */
  cancel: { kind: 'order'; orderId: string } | { kind: 'position'; symbol: string } | { kind: 'pending'; orderId: string; field: 'takeProfit' | 'stopLoss' } | null;
  pnl?: number;
}

export const LINE_COLORS = { buy: '#0284C7', sell: '#F23645', tp: '#089981', sl: '#F23645', posLong: '#089981', posShort: '#F23645' };

function fmt(p: number): string {
  return p.toLocaleString('en-US', { minimumFractionDigits: Math.min(priceDecimals(p), 2), maximumFractionDigits: priceDecimals(p) });
}

/** Sembolün pozisyon + çalışan emir çizgileri (emir çizgileri sırası: pozisyon, giriş emirleri, TP/SL). */
export function orderLines(s: PaperSnapshot, symbol: string, livePrice?: number): OrderLine[] {
  const sym = symbol.toUpperCase();
  const out: OrderLine[] = [];
  for (const p of s.positions) {
    if (p.symbol !== sym) continue;
    const last = livePrice && livePrice > 0 ? livePrice : p.last;
    const pnl = (last - p.avgPrice) * p.qty;
    out.push({
      id: `pos:${p.symbol}`,
      kind: 'position',
      price: p.avgPrice,
      qty: p.qty,
      label: `${p.qty > 0 ? 'LONG' : 'SHORT'} ${Math.abs(p.qty)}`,
      color: p.qty > 0 ? LINE_COLORS.posLong : LINE_COLORS.posShort,
      drag: null,
      cancel: { kind: 'position', symbol: p.symbol },
      pnl,
    });
  }
  for (const o of s.orders) {
    if (o.symbol !== sym) continue;
    const sideLbl = tt(SIDE_LABEL[o.side]);
    if (o.role === 'tp') {
      out.push({ id: `o:${o.id}`, kind: 'tp', price: o.limitPrice ?? 0, qty: o.qty, label: `KÂR AL ${o.qty}`, color: LINE_COLORS.tp,
        drag: { kind: 'order', orderId: o.id, field: 'limitPrice' }, cancel: { kind: 'order', orderId: o.id } });
      continue;
    }
    if (o.role === 'sl') {
      out.push({ id: `o:${o.id}`, kind: 'sl', price: o.stopPrice ?? 0, qty: o.qty, label: `ZARAR DURDUR ${o.qty}`, color: LINE_COLORS.sl,
        drag: { kind: 'order', orderId: o.id, field: 'stopPrice' }, cancel: { kind: 'order', orderId: o.id } });
      continue;
    }
    const color = o.side === 'buy' ? LINE_COLORS.buy : LINE_COLORS.sell;
    if ((o.type === 'stop' || o.type === 'stop_limit') && !o.triggered && o.stopPrice) {
      out.push({ id: `o:${o.id}:stop`, kind: 'entry-stop', price: o.stopPrice, qty: o.qty, label: tfmt("{0} {1} {2}", o.type === 'stop' ? 'STOP' : tt("STOP-LİMİT (stop)"), sideLbl, o.qty), color,
        drag: { kind: 'order', orderId: o.id, field: 'stopPrice' }, cancel: { kind: 'order', orderId: o.id } });
    }
    if ((o.type === 'limit' || o.type === 'stop_limit') && o.limitPrice) {
      out.push({ id: `o:${o.id}:limit`, kind: 'entry-limit', price: o.limitPrice, qty: o.qty, label: tfmt("{0} {1} {2}", o.type === 'limit' ? tt("LİMİT") : tt("STOP-LİMİT (limit)"), sideLbl, o.qty), color,
        drag: { kind: 'order', orderId: o.id, field: 'limitPrice' }, cancel: { kind: 'order', orderId: o.id } });
    }
    if (o.takeProfit) {
      out.push({ id: `o:${o.id}:tp`, kind: 'pending-tp', price: o.takeProfit, qty: o.qty, label: `KÂR AL ${o.qty} (bekleyen)`, color: LINE_COLORS.tp,
        drag: { kind: 'order', orderId: o.id, field: 'takeProfit' }, cancel: { kind: 'pending', orderId: o.id, field: 'takeProfit' } });
    }
    if (o.stopLoss) {
      out.push({ id: `o:${o.id}:sl`, kind: 'pending-sl', price: o.stopLoss, qty: o.qty, label: `ZARAR DURDUR ${o.qty} (bekleyen)`, color: LINE_COLORS.sl,
        drag: { kind: 'order', orderId: o.id, field: 'stopLoss' }, cancel: { kind: 'pending', orderId: o.id, field: 'stopLoss' } });
    }
  }
  return out;
}

/** Çizgi etiketinde gösterilen metin (fiyat + K/Z). */
export function lineText(l: OrderLine): string {
  if (l.kind === 'position') {
    const pnl = l.pnl ?? 0;
    return `${l.label} @ ${fmt(l.price)} | ${pnl >= 0 ? '+' : '−'}$${Math.abs(pnl).toFixed(2)}`;
  }
  return `${l.label} @ ${fmt(l.price)}`;
}

/** Sürüklenen çizginin yeni fiyatı için PUT gövdesi. */
export function dragPatch(target: DragTarget, price: number): { orderId?: string; symbol?: string; body: Record<string, number> } {
  const p = roundPrice(price);
  if (target.kind === 'order') return { orderId: target.orderId, body: { [target.field]: p } };
  return { symbol: target.symbol, body: { [target.field]: p } };
}

/** Pozisyondan TP/SL sürükleme: fiyatın hangi tarafa düştüğüne göre TP mi SL mi? */
export function bracketFieldForDrop(qty: number, last: number, price: number): 'takeProfit' | 'stopLoss' {
  const long = qty > 0;
  return (long && price > last) || (!long && price < last) ? 'takeProfit' : 'stopLoss';
}

export function fmtMoney(v: number): string {
  const s = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${v < 0 ? '−' : v > 0 ? '+' : ''}$${s}`;
}

/** Canlı grafik fiyatıyla pozisyon/özet yeniden hesap (sunucu tiki gelmeden önce). */
export function markSnapshot(s: PaperSnapshot, symbol: string, price: number): PaperSnapshot {
  if (!(price > 0)) return s;
  const sym = symbol.toUpperCase();
  if (!s.positions.some((p) => p.symbol === sym && p.last !== price)) return s;
  const positions = s.positions.map((p) => (p.symbol === sym ? { ...p, last: price } : p));
  let u = 0;
  let used = 0;
  for (const p of positions) {
    u += (p.last - p.avgPrice) * p.qty;
    used += Math.abs(p.qty) * p.last;
  }
  const eq = s.balance + u;
  return { ...s, positions, summary: { ...s.summary, unrealized: u, equity: eq, marginUsed: used, available: eq - used } };
}
