// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  CURRENCY_CHOICES,
  PRESET_EXPRESSIONS,
  currencyBadgeLabel,
  evalSymbolExpr,
  isSymbolExpression,
  mergeExpressionCandles,
  normalizeAliasSymbol,
  parseSymbolExpr,
  symbolAvatarSpec,
} from '../symbolExpr';
import {
  OPTION_STRATEGY_PRESETS,
  blackScholesGreeks,
  blackScholesPrice,
  buildStrategyFromChain,
  computeStrategyPayoff,
  normCDF,
  normPDF,
  type OptionStrategyPresetId,
} from '../optionsMath';
import { EventLayer, layoutCorporateEvents } from '../../chart/EventLayer';
import type { CorporateEventsData, OptionChainStrikeRow } from '../../types/market';

describe('Faz 26: symbolExpr (aritmetik ifade ayrıştırıcı, hizalı mum birleştirme, avatar, kur rozeti)', () => {
  it('normalizes aliases and parses ratio, product, spread, and weighted basket expressions', () => {
    expect(normalizeAliasSymbol('usdtry')).toBe('USDTRY=X');
    expect(normalizeAliasSymbol('eurusd')).toBe('EURUSD=X');
    expect(normalizeAliasSymbol('xauusd')).toBe('GC=F');
    expect(normalizeAliasSymbol('bist100')).toBe('XU100.IS');

    const single = parseSymbolExpr('THYAO.IS');
    expect(single.isComplex).toBe(false);
    expect(single.symbols).toEqual(['THYAO.IS']);
    expect(single.kindLabel).toBe('Tek Sembol');

    const dxy = parseSymbolExpr('DX-Y.NYB');
    expect(dxy.isComplex).toBe(false);
    expect(dxy.symbols).toEqual(['DX-Y.NYB']);

    const ratio = parseSymbolExpr('BTCUSDT/ETHUSDT');
    expect(ratio.isComplex).toBe(true);
    expect(ratio.kindLabel).toBe('Oran (Parite)');
    expect(ratio.symbols).toEqual(['BTCUSDT', 'ETHUSDT']);
    expect(evalSymbolExpr(ratio.root, { BTCUSDT: 60000, ETHUSDT: 3000 })).toBe(20);
    expect(evalSymbolExpr(ratio.root, { BTCUSDT: 60000, ETHUSDT: 0 })).toBeNull();

    const prod = parseSymbolExpr('THYAO.IS*USDTRY');
    expect(prod.isComplex).toBe(true);
    expect(prod.kindLabel).toBe('Çarpım / Kur');
    expect(prod.symbols).toEqual(['THYAO.IS', 'USDTRY=X']);
    expect(evalSymbolExpr(prod.root, { 'THYAO.IS': 300, 'USDTRY=X': 34.5 })).toBe(10350);

    const spread = parseSymbolExpr('AAPL - MSFT');
    expect(spread.isComplex).toBe(true);
    expect(spread.kindLabel).toBe('Fark (Spread)');
    expect(evalSymbolExpr(spread.root, { AAPL: 220, MSFT: 420 })).toBe(-200);

    const basket = parseSymbolExpr('(0.5*BTCUSDT + 0.5*ETHUSDT) - (-10)');
    expect(basket.isComplex).toBe(true);
    expect(basket.kindLabel).toBe('Ağırlıklı Sepet');
    expect(evalSymbolExpr(basket.root, { BTCUSDT: 60000, ETHUSDT: 3000 })).toBe(31510);

    expect(isSymbolExpression('BTCUSDT/ETHUSDT')).toBe(true);
    expect(isSymbolExpression('BTCUSDT')).toBe(false);
    expect(isSymbolExpression('')).toBe(false);
    expect(() => parseSymbolExpr('100 + 200')).toThrow();
    expect(() => parseSymbolExpr('(BTCUSDT+ETHUSDT')).toThrow();
    expect(PRESET_EXPRESSIONS.length).toBeGreaterThanOrEqual(6);
  });

  it('merges aligned expression candles with exact match and carry-forward', () => {
    const expr = parseSymbolExpr('THYAO.IS/USDTRY');
    const merged = mergeExpressionCandles(expr, {
      'THYAO.IS': [
        { time: 1700000000, open: 340, high: 357, low: 323, close: 340, volume: 1000 },
        { time: 1700086400, open: 340, high: 374, low: 340, close: 374, volume: 1200 },
      ],
      'USDTRY=X': [
        { time: 1700000000, open: 34, high: 34, low: 34, close: 34, volume: 10 },
      ],
    });
    expect(merged).toHaveLength(2);
    expect(merged[0].close).toBeCloseTo(10.0, 5);
    expect(merged[0].high).toBeCloseTo(10.5, 5);
    expect(merged[1].close).toBeCloseTo(11.0, 5);
  });

  it('produces deterministic avatars, exchange badges, and currency labels without external CDN', () => {
    const a1 = symbolAvatarSpec('THYAO.IS', 'BIST');
    expect(a1.initials).toBe('TH');
    expect(a1.exchange).toBe('BIST');
    expect(a1.assetType).toBe('hisse');

    const a2 = symbolAvatarSpec('BTCUSDT', 'CRYPTO');
    expect(a2.initials).toBe('BT');
    expect(a2.exchange).toBe('BINANCE');
    expect(a2.assetType).toBe('spot kripto');

    const a3 = symbolAvatarSpec('BTCUSDT/ETHUSDT');
    expect(a3.exchange).toBe('EXPR');
    expect(a3.assetType).toBe('sentetik ifade');

    expect(currencyBadgeLabel('TRY', '')).toBe('TRY');
    expect(currencyBadgeLabel('TRY', 'USD')).toBe('TRY → USD');
    expect(currencyBadgeLabel('USDT', 'USD')).toBe('USDT');
    expect(CURRENCY_CHOICES).toHaveLength(4);
  });
});

describe('Faz 26: optionsMath (Black-Scholes-Merton, Yunanlılar, Strateji Kurucu & Payoff)', () => {
  const sampleChain: OptionChainStrikeRow[] = [50000, 55000, 60000, 65000, 70000].map((k) => ({
    strike: k,
    distancePct: ((k - 60000) / 60000) * 100,
    call: {
      instrument: `BTC-29JAN27-${k}-C`,
      type: 'C',
      strike: k,
      markCoin: Math.max(0.01, (62000 - k) / 60000),
      markUsd: Math.max(600, 62000 - k + 1500),
      bidUsd: 500,
      askUsd: 700,
      lastUsd: 600,
      markIv: 52,
      openInterest: 100,
      volume: 10,
      volumeUsd: 600000,
      delta: 0.5,
      gamma: 0.00002,
      theta: -25,
      vega: 80,
      itm: k < 60000,
    },
    put: {
      instrument: `BTC-29JAN27-${k}-P`,
      type: 'P',
      strike: k,
      markCoin: Math.max(0.01, (k - 58000) / 60000),
      markUsd: Math.max(600, k - 58000 + 1500),
      bidUsd: 500,
      askUsd: 700,
      lastUsd: 600,
      markIv: 52,
      openInterest: 100,
      volume: 10,
      volumeUsd: 600000,
      delta: -0.5,
      gamma: 0.00002,
      theta: -25,
      vega: 80,
      itm: k > 60000,
    },
  }));

  it('computes Black-Scholes prices, Greeks, and all 8 strategy presets', () => {
    expect(normCDF(0)).toBeCloseTo(0.5, 4);
    expect(normPDF(0)).toBeCloseTo(0.3989, 3);

    const callPrice = blackScholesPrice(60000, 60000, 30 / 365, 0.5, true);
    const putPrice = blackScholesPrice(60000, 60000, 30 / 365, 0.5, false);
    expect(callPrice).toBeGreaterThan(2000);
    expect(callPrice).toBeCloseTo(putPrice, 2);

    const cg = blackScholesGreeks(60000, 60000, 30 / 365, 0.5, true);
    const pg = blackScholesGreeks(60000, 60000, 30 / 365, 0.5, false);
    expect(cg.delta).toBeGreaterThan(0.5);
    expect(pg.delta).toBeLessThan(-0.4);
    expect(cg.gamma).toBeGreaterThan(0);
    expect(cg.theta).toBeLessThan(0);
    expect(cg.vega).toBeGreaterThan(0);

    for (const preset of OPTION_STRATEGY_PRESETS) {
      const legs = buildStrategyFromChain(preset.id as OptionStrategyPresetId, sampleChain, 60000, '29JAN27', 30);
      expect(legs.length).toBeGreaterThan(0);
      const pf = computeStrategyPayoff(legs, 60000, 40);
      expect(pf.points.length).toBe(41);
    }

    const longCall = buildStrategyFromChain('long_call', sampleChain, 60000, '29JAN27', 30);
    const lcPayoff = computeStrategyPayoff(longCall, 60000);
    expect(lcPayoff.maxProfitUSD).toBe('UNLIMITED');
    expect(typeof lcPayoff.maxLossUSD).toBe('number');
    expect(lcPayoff.breakevens.length).toBe(1);
  });
});

describe('Faz 26: EventLayer (grafikte D / S / E olay işaretleri ve detay kartı)', () => {
  const sampleEvents: CorporateEventsData = {
    symbol: 'AAPL',
    supported: true,
    dividends: [{ time: 1700000000, amount: 0.25 }],
    splits: [{ time: 1700086400, numerator: 4, denominator: 1, ratio: '4:1' }],
    earnings: [{ time: 1700172800, actual: 1.64, estimate: 1.6 }],
  };

  const fakeMapper = {
    timeToLogical: (t: number) => (t - 1700000000) / 86400,
    logicalToX: (l: number) => 100 + l * 60,
    priceToY: (p: number) => 200 - p,
    barSpacing: () => 10,
    barRange: () => ({ high: 190, low: 180 }),
    size: () => ({ width: 600, height: 320 }),
  };

  it('lays out D, S, E markers and toggles popover in DOM', () => {
    const markers = layoutCorporateEvents(sampleEvents, fakeMapper, { dividends: true, splits: true, earnings: true }, 'USD');
    expect(markers).toHaveLength(3);
    expect(markers.map((m) => m.letter)).toEqual(['D', 'S', 'E']);
    expect(markers[2].detail).toContain('Sürpriz: +2.50%');

    const host = document.createElement('div');
    const layer = new EventLayer(host, fakeMapper);
    layer.setEvents(sampleEvents, 'USD');
    expect(layer.count()).toBe(3);

    const badge = host.querySelector('[data-event-kind="earnings"]') as HTMLButtonElement;
    expect(badge).toBeTruthy();
    badge.click();
    const pop = host.querySelector('#chart-event-popover') as HTMLElement;
    expect(pop.style.display).toBe('block');
    expect(pop.textContent).toContain('HBK Gerçekleşen');

    // Toggle off dividends
    layer.setOptions({ dividends: false });
    expect(layer.count()).toBe(2);
    expect(layer.getOptions().dividends).toBe(false);
    layer.destroy();
  });
});
