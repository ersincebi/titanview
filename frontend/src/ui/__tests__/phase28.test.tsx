// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => {
  const empty = () => ({
    initialBalance: 100000, balance: 100000, commissionPct: 0, orders: [] as unknown[], positions: [] as unknown[], fills: [] as unknown[], closed: [] as unknown[], version: 1,
    summary: { balance: 100000, equity: 100000, unrealized: 0, realized: 0, marginUsed: 0, available: 100000, initialBalance: 100000 },
  });
  return { empty, snap: empty() as ReturnType<typeof empty>, bnConfigured: false };
});

vi.mock('../../api/trading', () => {
  const res = () => ({ events: [], snapshot: api.snap });
  return {
    fetchPaper: vi.fn(async () => api.snap),
    placePaperOrder: vi.fn(async (r: Record<string, unknown>) => {
      api.snap = {
        ...api.snap,
        orders: [{ id: 'o1', ...r, role: 'entry', status: 'working', createdAt: 1, updatedAt: 1 }],
        version: api.snap.version + 1,
      };
      return { ...res(), order: api.snap.orders[0], events: [{ kind: 'placed', message: 'gönderildi', time: 1 }] };
    }),
    modifyPaperOrder: vi.fn(async () => res()),
    cancelPaperOrder: vi.fn(async () => {
      api.snap = { ...api.snap, orders: [] };
      return res();
    }),
    closePaperPosition: vi.fn(async () => res()),
    reversePaperPosition: vi.fn(async () => res()),
    setPaperBrackets: vi.fn(async () => res()),
    resetPaper: vi.fn(async (initial: number, comm: number) => {
      const e = api.empty();
      api.snap = { ...e, initialBalance: initial, balance: initial, commissionPct: comm, summary: { ...e.summary, balance: initial, equity: initial, available: initial, initialBalance: initial } };
      return api.snap;
    }),
    fetchFillLog: vi.fn(async () => []),
    fetchBinanceStatus: vi.fn(async () => (api.bnConfigured ? { configured: true, testnet: true, keyHint: 'AKAK…AKAK' } : { configured: false, testnet: true })),
    saveBinanceKeys: vi.fn(async () => {
      api.bnConfigured = true;
      return { configured: true, testnet: true, keyHint: 'AKAK…AKAK' };
    }),
    deleteBinanceKeys: vi.fn(async () => ({ configured: false, testnet: false })),
    fetchBinanceBalances: vi.fn(async () => [{ asset: 'USDT', free: 100, locked: 0 }]),
    fetchBinanceOpenOrders: vi.fn(async () => []),
    previewBinanceOrder: vi.fn(async (o: Record<string, unknown>) => ({
      token: 'tok', order: o, params: 'symbol=BTCUSDT&side=BUY&type=LIMIT', notional: 50, testnet: true, expiresAt: Math.floor(Date.now() / 1000) + 60, summary: '[TESTNET] BTCUSDT BUY LIMIT 1 adet',
    })),
    confirmBinanceOrder: vi.fn(async () => ({ orderId: 42, status: 'NEW' })),
    cancelBinanceOrder: vi.fn(async () => ({})),
  };
});

import * as tradingApi from '../../api/trading';
import { setCandles, setUi } from '../../state/store';
import { refreshPaper, setBroker, setTicket } from '../../state/tradingStore';
import { OrderTicket, PaperAccountPanel } from '../TradePanel';

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const input = (sel: string, v: string | number) => fireEvent.input($<HTMLInputElement>(sel), { target: { value: String(v) } });

beforeEach(() => {
  api.snap = api.empty();
  api.bnConfigured = false;
  vi.clearAllMocks();
  setUi('symbol', 'BTCUSDT');
  setCandles([{ time: 1, open: 50, high: 51, low: 49, close: 50, volume: 1 }]);
  setBroker('paper');
  setTicket({ side: 'buy', type: 'market', qty: 1, limitPrice: 50, stopPrice: 50, tpOn: false, slOn: false, takeProfit: 0, stopLoss: 0 });
});
afterEach(cleanup);

describe('Faz 28 UI: emir bileti, paper paneli, Binance onayı', () => {
  it('sends a limit order with TP/SL from the ticket', async () => {
    render(() => <OrderTicket />);
    fireEvent.click($('[data-otype="limit"]'));
    input('#inp-ticket-limit', 48);
    input('#inp-ticket-qty', 2);
    fireEvent.click($('#chk-ticket-tp'));
    fireEvent.click($('#chk-ticket-sl'));
    // % kısayolu: TP %2, SL %1 → 48.96 / 47.52
    expect($<HTMLInputElement>('#inp-ticket-tp').value).toBe('48.96');
    expect($<HTMLInputElement>('#inp-ticket-sl').value).toBe('47.52');
    expect($('#btn-ticket-send').textContent).toContain('AL 2 BTCUSDT · Limit');
    fireEvent.click($('#btn-ticket-send'));
    await waitFor(() => expect(tradingApi.placePaperOrder).toHaveBeenCalled());
    expect(vi.mocked(tradingApi.placePaperOrder).mock.calls[0][0]).toEqual({
      symbol: 'BTCUSDT', side: 'buy', type: 'limit', qty: 2, limitPrice: 48, takeProfit: 48.96, stopLoss: 47.52,
    });
  });

  it('blocks invalid tickets with an explanation', () => {
    render(() => <OrderTicket />);
    fireEvent.click($('[data-otype="stop"]'));
    input('#inp-ticket-stop', 40);
    expect($('#ticket-errors').textContent).toContain('Alış stop fiyatı piyasanın üzerinde olmalı');
    expect($<HTMLButtonElement>('#btn-ticket-send').disabled).toBe(true);
    fireEvent.click($('#btn-ticket-sell'));
    expect(document.querySelector('#ticket-errors')).toBeNull();
  });

  it('shows working orders in the account panel and cancels them', async () => {
    api.snap = {
      ...api.empty(),
      orders: [{ id: 'o9', symbol: 'BTCUSDT', side: 'sell', type: 'stop_limit', qty: 1, stopPrice: 45, limitPrice: 44, role: 'entry', status: 'working', createdAt: 1, updatedAt: 1 }],
    };
    await refreshPaper();
    render(() => <PaperAccountPanel active />);
    fireEvent.click($('[data-ptab="orders"]'));
    expect($('#paper-orders-tbody').textContent).toContain('Stop-Limit');
    expect($('#paper-orders-tbody').textContent).toContain('45.00 → 44.00');
    fireEvent.click($('[data-cancel-order="o9"]'));
    await waitFor(() => expect(document.querySelectorAll('.paper-order-row')).toHaveLength(0));
    fireEvent.click($('[data-ptab="account"]'));
    input('#inp-paper-initial', 5000);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    fireEvent.click($('#btn-paper-reset'));
    await waitFor(() => expect($('#lbl-paper-cash').textContent).toBe('$5000.00'));
  });

  it('Binance: saves keys, previews (order/test) and only sends after explicit confirmation', async () => {
    render(() => <OrderTicket />);
    fireEvent.click($('#btn-broker-binance'));
    await waitFor(() => expect($('#binance-keys')).toBeTruthy());
    expect($<HTMLButtonElement>('#btn-ticket-send').disabled).toBe(true); // anahtar yok
    input('#inp-bn-key', 'AKAKAKAKAKAKAKAKAK');
    input('#inp-bn-secret', 'SECRETSECRETSECRET');
    fireEvent.click($('#btn-bn-save'));
    await waitFor(() => expect($('#binance-keys').textContent).toContain('AKAK…AKAK'));
    expect(vi.mocked(tradingApi.saveBinanceKeys)).toHaveBeenCalledWith('AKAKAKAKAKAKAKAKAK', 'SECRETSECRETSECRET', true);
    await waitFor(() => expect($('#bn-balances').textContent).toContain('USDT'));

    fireEvent.click($('[data-otype="limit"]'));
    fireEvent.click($('#btn-ticket-send'));
    await waitFor(() => expect($('#binance-confirm')).toBeTruthy());
    expect(tradingApi.confirmBinanceOrder).not.toHaveBeenCalled();
    expect($('#binance-confirm').textContent).toContain('TESTNET');
    fireEvent.click($('#btn-bn-confirm'));
    await waitFor(() => expect(tradingApi.confirmBinanceOrder).toHaveBeenCalledWith('tok'));
    await waitFor(() => expect($('#bn-note').textContent).toContain('#42'));
    expect(document.querySelector('#binance-confirm')).toBeNull();

    // Vazgeç: hiçbir şey gönderilmez
    fireEvent.click($('#btn-ticket-send'));
    await waitFor(() => expect($('#binance-confirm')).toBeTruthy());
    fireEvent.click($('#btn-bn-cancel'));
    expect(document.querySelector('#binance-confirm')).toBeNull();
    expect(tradingApi.confirmBinanceOrder).toHaveBeenCalledTimes(1);
  });
});
