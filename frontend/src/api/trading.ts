import { apiFetch } from './client';
import type { OrderRequest, OrderType, OrderSide, PaperFill, PaperOrder, PaperSnapshot, TradingEvent } from '../state/trading';

async function json<T>(resp: Response): Promise<T> {
  const body = (await resp.json().catch(() => ({}))) as T & { error?: string };
  if (!resp.ok) throw new Error(body?.error || `HTTP ${resp.status}`);
  return body;
}

const send = (method: string, url: string, body?: unknown) =>
  apiFetch(url, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

export interface OrderResult {
  order?: PaperOrder;
  events: TradingEvent[];
  snapshot: PaperSnapshot;
}

const q = encodeURIComponent;

export async function fetchPaper(): Promise<PaperSnapshot> {
  return json<PaperSnapshot>(await apiFetch('/api/trading/paper'));
}

export async function placePaperOrder(r: OrderRequest): Promise<OrderResult> {
  return json<OrderResult>(await send('POST', '/api/trading/paper/orders', r));
}

export async function modifyPaperOrder(id: string, patch: Record<string, number>): Promise<OrderResult> {
  return json<OrderResult>(await send('PUT', `/api/trading/paper/orders?id=${q(id)}`, patch));
}

export async function cancelPaperOrder(id: string): Promise<OrderResult> {
  return json<OrderResult>(await send('DELETE', `/api/trading/paper/orders?id=${q(id)}`));
}

export async function closePaperPosition(symbol: string): Promise<OrderResult> {
  return json<OrderResult>(await send('POST', `/api/trading/paper/close?symbol=${q(symbol)}`));
}

export async function reversePaperPosition(symbol: string): Promise<OrderResult> {
  return json<OrderResult>(await send('POST', `/api/trading/paper/reverse?symbol=${q(symbol)}`));
}

/** takeProfit/stopLoss: >0 ayarla/taşı, <0 kaldır, 0/undefined dokunma. */
export async function setPaperBrackets(symbol: string, takeProfit = 0, stopLoss = 0): Promise<OrderResult> {
  return json<OrderResult>(await send('PUT', '/api/trading/positions/brackets', { symbol, takeProfit, stopLoss }));
}

export async function resetPaper(initialBalance: number, commissionPct: number): Promise<PaperSnapshot> {
  return json<PaperSnapshot>(await send('POST', '/api/trading/paper/reset', { initialBalance, commissionPct }));
}

export async function fetchFillLog(limit = 1000): Promise<PaperFill[]> {
  return (await json<{ fills: PaperFill[] }>(await apiFetch(`/api/trading/paper/fills?limit=${limit}`))).fills ?? [];
}

// ---------- Binance ----------

export interface BinanceStatus {
  configured: boolean;
  testnet: boolean;
  keyHint?: string;
  baseUrl?: string;
}

export interface BinanceBalance {
  asset: string;
  free: number;
  locked: number;
}

export interface BinanceOrderReq {
  symbol: string;
  side: OrderSide;
  type: OrderType;
  qty: number;
  limitPrice?: number;
  stopPrice?: number;
}

export interface BinancePreview {
  token: string;
  order: BinanceOrderReq;
  params: string;
  notional: number;
  testnet: boolean;
  expiresAt: number;
  summary: string;
}

export async function fetchBinanceStatus(): Promise<BinanceStatus> {
  return json<BinanceStatus>(await apiFetch('/api/trading/binance'));
}

export async function saveBinanceKeys(apiKey: string, secret: string, testnet: boolean): Promise<BinanceStatus> {
  return json<BinanceStatus>(await send('PUT', '/api/trading/binance', { apiKey, secret, testnet }));
}

export async function deleteBinanceKeys(): Promise<BinanceStatus> {
  return json<BinanceStatus>(await send('DELETE', '/api/trading/binance'));
}

export async function fetchBinanceBalances(): Promise<BinanceBalance[]> {
  return (await json<{ balances: BinanceBalance[] }>(await apiFetch('/api/trading/binance/account'))).balances ?? [];
}

export async function fetchBinanceOpenOrders(symbol = ''): Promise<Array<Record<string, unknown>>> {
  return (await json<{ orders: Array<Record<string, unknown>> }>(await apiFetch(`/api/trading/binance/orders?symbol=${q(symbol)}`))).orders ?? [];
}

export async function previewBinanceOrder(o: BinanceOrderReq): Promise<BinancePreview> {
  return json<BinancePreview>(await send('POST', '/api/trading/binance/preview', o));
}

export async function confirmBinanceOrder(token: string): Promise<Record<string, unknown>> {
  return json<Record<string, unknown>>(await send('POST', '/api/trading/binance/order', { token, confirm: true }));
}

export async function cancelBinanceOrder(symbol: string, orderId: number): Promise<Record<string, unknown>> {
  return json<Record<string, unknown>>(await send('DELETE', `/api/trading/binance/order?symbol=${q(symbol)}&orderId=${orderId}`));
}
