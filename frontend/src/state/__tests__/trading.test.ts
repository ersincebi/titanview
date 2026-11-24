import { describe, expect, it } from 'vitest';
import {
  EMPTY_SNAPSHOT,
  bracketFieldForDrop,
  bracketFromPct,
  defaultTicket,
  dragPatch,
  entryPrice,
  fmtMoney,
  lineText,
  markSnapshot,
  orderLines,
  priceDecimals,
  roundPrice,
  ticketRisk,
  ticketToRequest,
  validateTicket,
  type PaperOrder,
  type PaperSnapshot,
  type Ticket,
} from '../trading';

const t = (over: Partial<Ticket>): Ticket => ({ ...defaultTicket(100), ...over });

const order = (over: Partial<PaperOrder>): PaperOrder => ({
  id: 'o1', symbol: 'BTCUSDT', side: 'buy', type: 'limit', qty: 1, role: 'entry', status: 'working', createdAt: 1, updatedAt: 1, ...over,
});

const snap = (over: Partial<PaperSnapshot>): PaperSnapshot => ({ ...EMPTY_SNAPSHOT, ...over });

describe('Faz 28 emir bileti', () => {
  it('validates every order type and bracket side', () => {
    expect(validateTicket(t({ type: 'market' }), 100)).toEqual([]);
    expect(validateTicket(t({ type: 'market' }), 0)).toContain('Güncel fiyat yok');
    expect(validateTicket(t({ qty: 0 }), 100)).toContain('Adet sıfırdan büyük olmalı');
    expect(validateTicket(t({ type: 'limit', limitPrice: 0 }), 100)).toContain('Limit fiyatı gerekli');
    expect(validateTicket(t({ type: 'stop', stopPrice: 90 }), 100)).toContain('Alış stop fiyatı piyasanın üzerinde olmalı');
    expect(validateTicket(t({ type: 'stop', side: 'sell', stopPrice: 110 }), 100)).toContain('Satış stop fiyatı piyasanın altında olmalı');
    expect(validateTicket(t({ type: 'stop_limit', stopPrice: 105, limitPrice: 106 }), 100)).toEqual([]);
    expect(validateTicket(t({ tpOn: true, takeProfit: 99 }), 100)).toContain('Kâr al girişin üzerinde olmalı');
    expect(validateTicket(t({ side: 'sell', slOn: true, stopLoss: 99 }), 100)).toContain('Zarar durdur girişin üzerinde olmalı');
    expect(validateTicket(t({ side: 'sell', tpOn: true, takeProfit: 90, slOn: true, stopLoss: 105 }), 100)).toEqual([]);
  });

  it('computes entry price, % brackets, risk/reward and the request body', () => {
    expect(entryPrice(t({ type: 'limit', limitPrice: 95 }), 100)).toBe(95);
    expect(entryPrice(t({ type: 'stop', stopPrice: 105 }), 100)).toBe(105);
    expect(entryPrice(t({ type: 'market' }), 100)).toBe(100);
    expect(bracketFromPct('buy', 100, 2, 1)).toEqual({ takeProfit: 102, stopLoss: 99 });
    expect(bracketFromPct('sell', 100, 2, 1)).toEqual({ takeProfit: 98, stopLoss: 101 });
    const r = ticketRisk(t({ qty: 2, tpOn: true, takeProfit: 106, slOn: true, stopLoss: 98 }), 100);
    expect(r).toEqual({ notional: 200, reward: 12, risk: 4, rr: 3 });
    expect(ticketToRequest(t({ type: 'stop_limit', stopPrice: 105, limitPrice: 106, tpOn: true, takeProfit: 120 }), 'ETHUSDT')).toEqual({
      symbol: 'ETHUSDT', side: 'buy', type: 'stop_limit', qty: 1, limitPrice: 106, stopPrice: 105, takeProfit: 120,
    });
    expect(ticketToRequest(t({ type: 'market', limitPrice: 5, tpOn: false, takeProfit: 200 }), 'X')).toEqual({ symbol: 'X', side: 'buy', type: 'market', qty: 1 });
  });

  it('rounds prices by magnitude', () => {
    expect(priceDecimals(65000)).toBe(2);
    expect(priceDecimals(1.2345)).toBe(4);
    expect(priceDecimals(0.05)).toBe(6);
    expect(priceDecimals(0.00001)).toBe(8);
    expect(roundPrice(65000.12345)).toBe(65000.12);
    expect(roundPrice(Number.NaN)).toBe(0);
    expect(fmtMoney(12.5)).toBe('+$12.50');
    expect(fmtMoney(-3)).toBe('−$3.00');
    expect(fmtMoney(0)).toBe('$0.00');
  });
});

describe('Faz 28 grafikte emir çizgileri', () => {
  const s = snap({
    positions: [{ symbol: 'BTCUSDT', qty: 0.5, avgPrice: 60000, last: 61000, openedAt: 1, realized: 0 }],
    orders: [
      order({ id: 'e1', type: 'limit', limitPrice: 59000, takeProfit: 62000, stopLoss: 58000 }),
      order({ id: 'e2', type: 'stop_limit', side: 'sell', stopPrice: 57000, limitPrice: 56900 }),
      order({ id: 'e3', type: 'stop_limit', stopPrice: 63000, limitPrice: 63100, triggered: true }),
      order({ id: 'tp', type: 'limit', side: 'sell', role: 'tp', limitPrice: 65000, reduceOnly: true, ocoGroup: 'g' }),
      order({ id: 'sl', type: 'stop', side: 'sell', role: 'sl', stopPrice: 55000, reduceOnly: true, ocoGroup: 'g' }),
      order({ id: 'other', symbol: 'ETHUSDT', limitPrice: 3000 }),
    ],
  });

  it('builds position, entry, pending bracket and TP/SL lines for the symbol only', () => {
    const lines = orderLines(s, 'btcusdt', 62000);
    const kinds = lines.map((l) => `${l.kind}:${l.price}`);
    expect(kinds).toEqual([
      'position:60000',
      'entry-limit:59000',
      'pending-tp:62000',
      'pending-sl:58000',
      'entry-stop:57000',
      'entry-limit:56900',
      'entry-limit:63100', // tetiklenmiş stop-limit yalnız limit çizgisi
      'tp:65000',
      'sl:55000',
    ]);
    const pos = lines[0];
    expect(pos.pnl).toBe(1000); // canlı fiyatla
    expect(pos.drag).toBeNull();
    expect(pos.cancel).toEqual({ kind: 'position', symbol: 'BTCUSDT' });
    expect(lineText(pos)).toBe('LONG 0.5 @ 60,000.00 | +$1000.00');
    expect(lines[2].cancel).toEqual({ kind: 'pending', orderId: 'e1', field: 'takeProfit' });
    expect(lines[7].drag).toEqual({ kind: 'order', orderId: 'tp', field: 'limitPrice' });
    expect(lines[8].drag).toEqual({ kind: 'order', orderId: 'sl', field: 'stopPrice' });
    expect(orderLines(s, 'NOPE')).toEqual([]);
  });

  it('maps a drop to the right API patch and bracket side', () => {
    expect(dragPatch({ kind: 'order', orderId: 'e1', field: 'limitPrice' }, 59123.456)).toEqual({ orderId: 'e1', body: { limitPrice: 59123.46 } });
    expect(dragPatch({ kind: 'position-bracket', symbol: 'BTCUSDT', field: 'stopLoss' }, 1.23456)).toEqual({ symbol: 'BTCUSDT', body: { stopLoss: 1.2346 } });
    expect(bracketFieldForDrop(1, 100, 110)).toBe('takeProfit');
    expect(bracketFieldForDrop(1, 100, 90)).toBe('stopLoss');
    expect(bracketFieldForDrop(-1, 100, 90)).toBe('takeProfit');
    expect(bracketFieldForDrop(-1, 100, 110)).toBe('stopLoss');
  });

  it('marks the snapshot to the live price', () => {
    const m = markSnapshot(s, 'BTCUSDT', 62000);
    expect(m.positions[0].last).toBe(62000);
    expect(m.summary.unrealized).toBe(1000);
    expect(m.summary.equity).toBe(EMPTY_SNAPSHOT.balance + 1000);
    expect(markSnapshot(s, 'ETHUSDT', 1)).toBe(s);
    expect(markSnapshot(s, 'BTCUSDT', 0)).toBe(s);
  });
});
