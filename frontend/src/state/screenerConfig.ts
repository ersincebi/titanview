import { tt } from './i18n';
import type {
  SavedScreenerPreset,
  ScreenerFilterRule,
  ScreenerRow,
} from '../types/market';

export type ScreenerCategory =
  | 'Fiyat & Hacim'
  | 'Performans & Aralık'
  | 'Hareketli Ortalamalar'
  | 'Osilatörler'
  | 'Trend & Volatilite'
  | 'Derecelendirme & Formasyon'
  | 'Temel & Değerleme'
  | 'Kârlılık & Bilanço';

export interface ScreenerFilterDef {
  field: string;
  label: string;
  category: ScreenerCategory;
  kind: 'number' | 'percent' | 'money' | 'enum';
  defaultOp: ScreenerFilterRule['op'];
  defaultVal: number | string;
  defaultVal2?: number;
  rhsField?: string;
  unit?: string;
  options?: Array<[string, string]>;
}

const RATING_OPTS: Array<[string, string]> = [
  ['STRONG_BUY', tt("GÜÇLÜ AL")],
  ['BUY', 'AL'],
  ['NEUTRAL', tt("NÖTR")],
  ['SELL', 'SAT'],
  ['STRONG_SELL', tt("GÜÇLÜ SAT")],
];

const PATTERN_OPTS: Array<[string, string]> = [
  ['BULL_ENGULFING', tt("Boğa Yutan (Bull Engulfing)")],
  ['BEAR_ENGULFING', tt("Ayı Yutan (Bear Engulfing)")],
  ['HAMMER', tt("Çekiç (Hammer)")],
  ['SHOOTING_STAR', tt("Kayan Yıldız (Shooting Star)")],
  ['DOJI', 'Doji'],
  ['MARUBOZU_BULL', tt("Boğa Marubozu")],
  ['MARUBOZU_BEAR', tt("Ayı Marubozu")],
  ['INSIDE_BAR', tt("İç Bar (Inside Bar)")],
  ['NONE', tt("Formasyon Yok")],
];

/**
 * Faz 27: 125+ gerçek teknik ve temel tarayıcı filtresi.
 */
export const SCREENER_FILTERS: ScreenerFilterDef[] = [
  // 1. Fiyat & Hacim (20)
  { field: 'lastPrice', label: tt('Son Fiyat'), category: 'Fiyat & Hacim', kind: 'number', defaultOp: 'gt', defaultVal: 10 },
  { field: 'openPrice', label: tt("Açılış Fiyatı"), category: 'Fiyat & Hacim', kind: 'number', defaultOp: 'gt', defaultVal: 0 },
  { field: 'highPrice', label: tt("Günlük Yüksek"), category: 'Fiyat & Hacim', kind: 'number', defaultOp: 'gt', defaultVal: 0 },
  { field: 'lowPrice', label: tt("Günlük Düşük"), category: 'Fiyat & Hacim', kind: 'number', defaultOp: 'gt', defaultVal: 0 },
  { field: 'prevClose', label: tt("Önceki Kapanış"), category: 'Fiyat & Hacim', kind: 'number', defaultOp: 'gt', defaultVal: 0 },
  { field: 'changePercent', label: tt("Değişim %"), category: 'Fiyat & Hacim', kind: 'percent', unit: '%', defaultOp: 'gt', defaultVal: 0 },
  { field: 'changeAbs', label: tt("Değişim (Mutlak)"), category: 'Fiyat & Hacim', kind: 'number', defaultOp: 'gt', defaultVal: 0 },
  { field: 'gapPct', label: tt("Açılış Boşluğu (Gap) %"), category: 'Fiyat & Hacim', kind: 'percent', unit: '%', defaultOp: 'gt', defaultVal: 0.5 },
  { field: 'volume', label: tt("Hacim (Son Bar)"), category: 'Fiyat & Hacim', kind: 'money', defaultOp: 'gt', defaultVal: 1000 },
  { field: 'avgVolume10', label: tt("Ortalama Hacim (10)"), category: 'Fiyat & Hacim', kind: 'money', defaultOp: 'gt', defaultVal: 1000 },
  { field: 'avgVolume20', label: tt("Ortalama Hacim (20)"), category: 'Fiyat & Hacim', kind: 'money', defaultOp: 'gt', defaultVal: 1000 },
  { field: 'avgVolume30', label: tt("Ortalama Hacim (30)"), category: 'Fiyat & Hacim', kind: 'money', defaultOp: 'gt', defaultVal: 1000 },
  { field: 'avgVolume60', label: tt("Ortalama Hacim (60)"), category: 'Fiyat & Hacim', kind: 'money', defaultOp: 'gt', defaultVal: 1000 },
  { field: 'avgVolume90', label: tt("Ortalama Hacim (90)"), category: 'Fiyat & Hacim', kind: 'money', defaultOp: 'gt', defaultVal: 1000 },
  { field: 'relVolume', label: tt("Bağıl Hacim (RVOL)"), category: 'Fiyat & Hacim', kind: 'number', unit: 'x', defaultOp: 'gt', defaultVal: 1.2 },
  { field: 'turnover', label: tt("İşlem Tutarı (Fiyat × Hacim)"), category: 'Fiyat & Hacim', kind: 'money', defaultOp: 'gt', defaultVal: 10000 },
  { field: 'extPrice', label: tt("Uzatılmış Saat Fiyatı"), category: 'Fiyat & Hacim', kind: 'number', defaultOp: 'gt', defaultVal: 0 },
  { field: 'extChangePct', label: tt("Uzatılmış Saat Değişim %"), category: 'Fiyat & Hacim', kind: 'percent', unit: '%', defaultOp: 'gt', defaultVal: 0 },
  { field: 'exchange', label: tt("Borsa"), category: 'Fiyat & Hacim', kind: 'enum', defaultOp: 'eq', defaultVal: 'BIST', options: [['BIST', 'BIST'], ['BINANCE', 'BINANCE'], ['NASDAQ', 'NASDAQ'], ['NYSE', 'NYSE'], ['COMEX', 'COMEX'], ['FX', 'FX']] },
  { field: 'currency', label: tt("Para Birimi"), category: 'Fiyat & Hacim', kind: 'enum', defaultOp: 'eq', defaultVal: 'TRY', options: [['TRY', 'TRY'], ['USD', 'USD'], ['USDT', 'USDT'], ['EUR', 'EUR']] },

  // 2. Performans & Aralık (16)
  { field: 'perf1w', label: tt("Haftalık Performans (1H %)"), category: 'Performans & Aralık', kind: 'percent', unit: '%', defaultOp: 'gt', defaultVal: 0 },
  { field: 'perf1m', label: tt("Aylık Performans (1A %)"), category: 'Performans & Aralık', kind: 'percent', unit: '%', defaultOp: 'gt', defaultVal: 0 },
  { field: 'perf3m', label: tt("3 Aylık Performans (3A %)"), category: 'Performans & Aralık', kind: 'percent', unit: '%', defaultOp: 'gt', defaultVal: 0 },
  { field: 'perf6m', label: tt("6 Aylık Performans (6A %)"), category: 'Performans & Aralık', kind: 'percent', unit: '%', defaultOp: 'gt', defaultVal: 0 },
  { field: 'perfYtd', label: tt("YBB Performans (YTD %)"), category: 'Performans & Aralık', kind: 'percent', unit: '%', defaultOp: 'gt', defaultVal: 0 },
  { field: 'perf1y', label: tt("Yıllık Performans (1Y %)"), category: 'Performans & Aralık', kind: 'percent', unit: '%', defaultOp: 'gt', defaultVal: 0 },
  { field: 'high52w', label: tt("52 Haftalık Yüksek"), category: 'Performans & Aralık', kind: 'number', defaultOp: 'gt', defaultVal: 0 },
  { field: 'low52w', label: tt("52 Haftalık Düşük"), category: 'Performans & Aralık', kind: 'number', defaultOp: 'gt', defaultVal: 0 },
  { field: 'from52wHighPct', label: tt("52H Zirveden Uzaklık %"), category: 'Performans & Aralık', kind: 'percent', unit: '%', defaultOp: 'gt', defaultVal: -15 },
  { field: 'from52wLowPct', label: tt("52H Dipten Uzaklık %"), category: 'Performans & Aralık', kind: 'percent', unit: '%', defaultOp: 'gt', defaultVal: 10 },
  { field: 'high1m', label: tt("1 Aylık Yüksek"), category: 'Performans & Aralık', kind: 'number', defaultOp: 'gt', defaultVal: 0 },
  { field: 'low1m', label: tt("1 Aylık Düşük"), category: 'Performans & Aralık', kind: 'number', defaultOp: 'gt', defaultVal: 0 },
  { field: 'high3m', label: tt("3 Aylık Yüksek"), category: 'Performans & Aralık', kind: 'number', defaultOp: 'gt', defaultVal: 0 },
  { field: 'low3m', label: tt("3 Aylık Düşük"), category: 'Performans & Aralık', kind: 'number', defaultOp: 'gt', defaultVal: 0 },
  { field: 'posIn52wRange', label: tt("52H Kanal Konumu (0-100%)"), category: 'Performans & Aralık', kind: 'percent', unit: '%', defaultOp: 'gt', defaultVal: 50 },
  { field: 'posInDayRange', label: tt("Günlük Kanal Konumu (0-100%)"), category: 'Performans & Aralık', kind: 'percent', unit: '%', defaultOp: 'gt', defaultVal: 50 },

  // 3. Hareketli Ortalamalar (26)
  { field: 'sma5', label: tt('SMA (5)'), category: 'Hareketli Ortalamalar', kind: 'number', defaultOp: 'gt', defaultVal: 0 },
  { field: 'sma10', label: tt('SMA (10)'), category: 'Hareketli Ortalamalar', kind: 'number', defaultOp: 'gt', defaultVal: 0 },
  { field: 'sma20', label: tt('SMA (20)'), category: 'Hareketli Ortalamalar', kind: 'number', defaultOp: 'gt', defaultVal: 0 },
  { field: 'sma30', label: tt('SMA (30)'), category: 'Hareketli Ortalamalar', kind: 'number', defaultOp: 'gt', defaultVal: 0 },
  { field: 'sma50', label: tt('SMA (50)'), category: 'Hareketli Ortalamalar', kind: 'number', defaultOp: 'gt', defaultVal: 0 },
  { field: 'sma100', label: tt('SMA (100)'), category: 'Hareketli Ortalamalar', kind: 'number', defaultOp: 'gt', defaultVal: 0 },
  { field: 'sma200', label: tt('SMA (200)'), category: 'Hareketli Ortalamalar', kind: 'number', defaultOp: 'gt', defaultVal: 0 },
  { field: 'ema5', label: tt('EMA (5)'), category: 'Hareketli Ortalamalar', kind: 'number', defaultOp: 'gt', defaultVal: 0 },
  { field: 'ema10', label: tt('EMA (10)'), category: 'Hareketli Ortalamalar', kind: 'number', defaultOp: 'gt', defaultVal: 0 },
  { field: 'ema12', label: tt('EMA (12)'), category: 'Hareketli Ortalamalar', kind: 'number', defaultOp: 'gt', defaultVal: 0 },
  { field: 'ema20', label: tt('EMA (20)'), category: 'Hareketli Ortalamalar', kind: 'number', defaultOp: 'gt', defaultVal: 0 },
  { field: 'ema26', label: tt('EMA (26)'), category: 'Hareketli Ortalamalar', kind: 'number', defaultOp: 'gt', defaultVal: 0 },
  { field: 'ema30', label: tt('EMA (30)'), category: 'Hareketli Ortalamalar', kind: 'number', defaultOp: 'gt', defaultVal: 0 },
  { field: 'ema50', label: tt('EMA (50)'), category: 'Hareketli Ortalamalar', kind: 'number', defaultOp: 'gt', defaultVal: 0 },
  { field: 'ema100', label: tt('EMA (100)'), category: 'Hareketli Ortalamalar', kind: 'number', defaultOp: 'gt', defaultVal: 0 },
  { field: 'ema200', label: tt('EMA (200)'), category: 'Hareketli Ortalamalar', kind: 'number', defaultOp: 'gt', defaultVal: 0 },
  { field: 'wma20', label: tt('WMA (20)'), category: 'Hareketli Ortalamalar', kind: 'number', defaultOp: 'gt', defaultVal: 0 },
  { field: 'vwma20', label: tt('VWMA (20)'), category: 'Hareketli Ortalamalar', kind: 'number', defaultOp: 'gt', defaultVal: 0 },
  { field: 'hma9', label: tt('Hull MA (9)'), category: 'Hareketli Ortalamalar', kind: 'number', defaultOp: 'gt', defaultVal: 0 },
  { field: 'distSma20Pct', label: tt("Fiyat - SMA(20) Uzaklık %"), category: 'Hareketli Ortalamalar', kind: 'percent', unit: '%', defaultOp: 'gt', defaultVal: 0 },
  { field: 'distSma50Pct', label: tt("Fiyat - SMA(50) Uzaklık %"), category: 'Hareketli Ortalamalar', kind: 'percent', unit: '%', defaultOp: 'gt', defaultVal: 0 },
  { field: 'distSma200Pct', label: tt("Fiyat - SMA(200) Uzaklık %"), category: 'Hareketli Ortalamalar', kind: 'percent', unit: '%', defaultOp: 'gt', defaultVal: 0 },
  { field: 'ema20_vs_ema50', label: tt('EMA(20) - EMA(50) Fark %'), category: 'Hareketli Ortalamalar', kind: 'percent', unit: '%', defaultOp: 'gt', defaultVal: 0 },
  { field: 'sma50_vs_sma200', label: tt("SMA(50) - SMA(200) Altın Oran %"), category: 'Hareketli Ortalamalar', kind: 'percent', unit: '%', defaultOp: 'gt', defaultVal: 0 },
  { field: 'price_vs_ema20', label: tt("Fiyat - EMA(20) Fark %"), category: 'Hareketli Ortalamalar', kind: 'percent', unit: '%', defaultOp: 'gt', defaultVal: 0 },
  { field: 'price_vs_vwap', label: tt("Fiyat - VWAP Fark %"), category: 'Hareketli Ortalamalar', kind: 'percent', unit: '%', defaultOp: 'gt', defaultVal: 0 },

  // 4. Osilatörler (22)
  { field: 'rsi7', label: tt('RSI (7)'), category: 'Osilatörler', kind: 'number', defaultOp: 'lt', defaultVal: 30 },
  { field: 'rsi14', label: tt('RSI (14)'), category: 'Osilatörler', kind: 'number', defaultOp: 'between', defaultVal: 30, defaultVal2: 70 },
  { field: 'rsi21', label: tt('RSI (21)'), category: 'Osilatörler', kind: 'number', defaultOp: 'gt', defaultVal: 50 },
  { field: 'stochK', label: tt('Stochastic %K (14,3,3)'), category: 'Osilatörler', kind: 'number', defaultOp: 'lt', defaultVal: 20 },
  { field: 'stochD', label: tt('Stochastic %D (14,3,3)'), category: 'Osilatörler', kind: 'number', defaultOp: 'lt', defaultVal: 20 },
  { field: 'stochRsiK', label: tt('Stochastic RSI %K (14,14,3,3)'), category: 'Osilatörler', kind: 'number', defaultOp: 'lt', defaultVal: 20 },
  { field: 'stochRsiD', label: tt('Stochastic RSI %D (14,14,3,3)'), category: 'Osilatörler', kind: 'number', defaultOp: 'lt', defaultVal: 20 },
  { field: 'macd', label: tt('MACD Seviyesi (12,26)'), category: 'Osilatörler', kind: 'number', defaultOp: 'gt', defaultVal: 0 },
  { field: 'macdSignal', label: tt('MACD Sinyali (9)'), category: 'Osilatörler', kind: 'number', defaultOp: 'gt', defaultVal: 0 },
  { field: 'macdHist', label: tt('MACD Histogram'), category: 'Osilatörler', kind: 'number', defaultOp: 'gt', defaultVal: 0 },
  { field: 'cci20', label: tt('CCI (20)'), category: 'Osilatörler', kind: 'number', defaultOp: 'lt', defaultVal: -100 },
  { field: 'williamsR14', label: tt('Williams %R (14)'), category: 'Osilatörler', kind: 'number', defaultOp: 'lt', defaultVal: -80 },
  { field: 'mfi14', label: tt("Para Akışı Endeksi MFI (14)"), category: 'Osilatörler', kind: 'number', defaultOp: 'between', defaultVal: 20, defaultVal2: 80 },
  { field: 'roc9', label: tt("Değişim Hızı ROC (9) %"), category: 'Osilatörler', kind: 'percent', unit: '%', defaultOp: 'gt', defaultVal: 0 },
  { field: 'roc20', label: tt("Değişim Hızı ROC (20) %"), category: 'Osilatörler', kind: 'percent', unit: '%', defaultOp: 'gt', defaultVal: 0 },
  { field: 'momentum10', label: tt('Momentum (10)'), category: 'Osilatörler', kind: 'number', defaultOp: 'gt', defaultVal: 0 },
  { field: 'ao', label: tt('Awesome Oscillator (AO)'), category: 'Osilatörler', kind: 'number', defaultOp: 'gt', defaultVal: 0 },
  { field: 'uo', label: tt('Ultimate Oscillator (7,14,28)'), category: 'Osilatörler', kind: 'number', defaultOp: 'gt', defaultVal: 50 },
  { field: 'cmo14', label: tt('Chande Momentum CMO (14)'), category: 'Osilatörler', kind: 'number', defaultOp: 'gt', defaultVal: 0 },
  { field: 'bullPower13', label: tt("Elder Boğa Gücü (13)"), category: 'Osilatörler', kind: 'number', defaultOp: 'gt', defaultVal: 0 },
  { field: 'bearPower13', label: tt("Elder Ayı Gücü (13)"), category: 'Osilatörler', kind: 'number', defaultOp: 'gt', defaultVal: 0 },
  { field: 'zScore20', label: tt('Z-Skor (20)'), category: 'Osilatörler', kind: 'number', defaultOp: 'lt', defaultVal: -1.5 },

  // 5. Trend, Volatilite & Akış (31)
  { field: 'adx14', label: tt('ADX (14)'), category: 'Trend & Volatilite', kind: 'number', defaultOp: 'gt', defaultVal: 25 },
  { field: 'plusDi14', label: tt("Pozitif Yönsel Gösterge (+DI 14)"), category: 'Trend & Volatilite', kind: 'number', defaultOp: 'gt', defaultVal: 20 },
  { field: 'minusDi14', label: tt("Negatif Yönsel Gösterge (-DI 14)"), category: 'Trend & Volatilite', kind: 'number', defaultOp: 'lt', defaultVal: 20 },
  { field: 'supertrend', label: tt("Supertrend Seviyesi (10,3)"), category: 'Trend & Volatilite', kind: 'number', defaultOp: 'gt', defaultVal: 0 },
  { field: 'supertrendDir', label: tt("Supertrend Yönü (+1 Boğa / -1 Ayı)"), category: 'Trend & Volatilite', kind: 'number', defaultOp: 'eq', defaultVal: 1 },
  { field: 'psar', label: tt('Parabolic SAR'), category: 'Trend & Volatilite', kind: 'number', defaultOp: 'gt', defaultVal: 0 },
  { field: 'aroonUp14', label: tt('Aroon Up (14)'), category: 'Trend & Volatilite', kind: 'percent', unit: '%', defaultOp: 'gt', defaultVal: 70 },
  { field: 'aroonDown14', label: tt('Aroon Down (14)'), category: 'Trend & Volatilite', kind: 'percent', unit: '%', defaultOp: 'lt', defaultVal: 30 },
  { field: 'aroonOsc14', label: tt('Aroon Oscillator (14)'), category: 'Trend & Volatilite', kind: 'number', defaultOp: 'gt', defaultVal: 0 },
  { field: 'ichimokuTenkan', label: tt('Ichimoku Tenkan-sen (9)'), category: 'Trend & Volatilite', kind: 'number', defaultOp: 'gt', defaultVal: 0 },
  { field: 'ichimokuKijun', label: tt('Ichimoku Kijun-sen (26)'), category: 'Trend & Volatilite', kind: 'number', defaultOp: 'gt', defaultVal: 0 },
  { field: 'ichimokuSpanA', label: tt('Ichimoku Senkou Span A'), category: 'Trend & Volatilite', kind: 'number', defaultOp: 'gt', defaultVal: 0 },
  { field: 'ichimokuSpanB', label: tt('Ichimoku Senkou Span B'), category: 'Trend & Volatilite', kind: 'number', defaultOp: 'gt', defaultVal: 0 },
  { field: 'atr14', label: tt('ATR (14)'), category: 'Trend & Volatilite', kind: 'number', defaultOp: 'gt', defaultVal: 0 },
  { field: 'atr14Pct', label: tt('ATR (14) %'), category: 'Trend & Volatilite', kind: 'percent', unit: '%', defaultOp: 'gt', defaultVal: 1.5 },
  { field: 'natr14', label: tt('Normalize ATR (NATR 14) %'), category: 'Trend & Volatilite', kind: 'percent', unit: '%', defaultOp: 'gt', defaultVal: 1.5 },
  { field: 'bbUpper20', label: tt("Bollinger Üst Bant (20,2)"), category: 'Trend & Volatilite', kind: 'number', defaultOp: 'gt', defaultVal: 0 },
  { field: 'bbMiddle20', label: tt("Bollinger Orta Bant (20)"), category: 'Trend & Volatilite', kind: 'number', defaultOp: 'gt', defaultVal: 0 },
  { field: 'bbLower20', label: tt("Bollinger Alt Bant (20,2)"), category: 'Trend & Volatilite', kind: 'number', defaultOp: 'gt', defaultVal: 0 },
  { field: 'bbWidthPct', label: tt("Bollinger Bant Genişliği %"), category: 'Trend & Volatilite', kind: 'percent', unit: '%', defaultOp: 'lt', defaultVal: 10 },
  { field: 'bbPercentB', label: tt('Bollinger %B (0-1)'), category: 'Trend & Volatilite', kind: 'number', defaultOp: 'between', defaultVal: 0, defaultVal2: 1 },
  { field: 'kcUpper20', label: tt("Keltner Kanalı Üst (20)"), category: 'Trend & Volatilite', kind: 'number', defaultOp: 'gt', defaultVal: 0 },
  { field: 'kcLower20', label: tt("Keltner Kanalı Alt (20)"), category: 'Trend & Volatilite', kind: 'number', defaultOp: 'gt', defaultVal: 0 },
  { field: 'donchianHigh20', label: tt("Donchian Kanalı Üst (20)"), category: 'Trend & Volatilite', kind: 'number', defaultOp: 'gt', defaultVal: 0 },
  { field: 'donchianLow20', label: tt("Donchian Kanalı Alt (20)"), category: 'Trend & Volatilite', kind: 'number', defaultOp: 'gt', defaultVal: 0 },
  { field: 'volAnnualPct', label: tt("Yıllık Volatilite %"), category: 'Trend & Volatilite', kind: 'percent', unit: '%', defaultOp: 'gt', defaultVal: 20 },
  { field: 'vol30dPct', label: tt("30 Günlük Volatilite %"), category: 'Trend & Volatilite', kind: 'percent', unit: '%', defaultOp: 'gt', defaultVal: 20 },
  { field: 'maxDrawdownPct', label: tt("Maks. Düşüş (Drawdown) %"), category: 'Trend & Volatilite', kind: 'percent', unit: '%', defaultOp: 'gt', defaultVal: -30 },
  { field: 'cmf20', label: tt('Chaikin Money Flow CMF (20)'), category: 'Trend & Volatilite', kind: 'number', defaultOp: 'gt', defaultVal: 0 },
  { field: 'obvSlopePct', label: tt("OBV Hacim Eğimi (14) %"), category: 'Trend & Volatilite', kind: 'percent', unit: '%', defaultOp: 'gt', defaultVal: 0 },
  { field: 'vwap', label: tt("Hacim Ağırlıklı Ort. Fiyat (VWAP)"), category: 'Trend & Volatilite', kind: 'number', defaultOp: 'gt', defaultVal: 0 },

  // 6. Derecelendirme & Formasyon (8)
  { field: 'rating', label: tt("Teknik Görünüm (Özet)"), category: 'Derecelendirme & Formasyon', kind: 'enum', defaultOp: 'eq', defaultVal: 'STRONG_BUY', options: RATING_OPTS },
  { field: 'score', label: tt("Toplam Teknik Puan"), category: 'Derecelendirme & Formasyon', kind: 'number', defaultOp: 'gte', defaultVal: 1 },
  { field: 'maRating', label: tt("Hareketli Ortalamalar Görünümü"), category: 'Derecelendirme & Formasyon', kind: 'enum', defaultOp: 'eq', defaultVal: 'STRONG_BUY', options: RATING_OPTS },
  { field: 'maScore', label: tt("Hareketli Ortalamalar Puanı"), category: 'Derecelendirme & Formasyon', kind: 'number', defaultOp: 'gte', defaultVal: 2 },
  { field: 'oscRating', label: tt("Osilatörler Görünümü"), category: 'Derecelendirme & Formasyon', kind: 'enum', defaultOp: 'eq', defaultVal: 'BUY', options: RATING_OPTS },
  { field: 'oscScore', label: tt("Osilatörler Puanı"), category: 'Derecelendirme & Formasyon', kind: 'number', defaultOp: 'gte', defaultVal: 1 },
  { field: 'candlePattern', label: tt('Mum Formasyonu'), category: 'Derecelendirme & Formasyon', kind: 'enum', defaultOp: 'eq', defaultVal: 'BULL_ENGULFING', options: PATTERN_OPTS },
  { field: 'streak', label: tt("Ardışık Bar Serisi (+Yükseliş / -Düşüş)"), category: 'Derecelendirme & Formasyon', kind: 'number', defaultOp: 'gte', defaultVal: 2 },

  // 7. Temel & Değerleme (11)
  { field: 'marketCap', label: tt("Piyasa Değeri"), category: 'Temel & Değerleme', kind: 'money', defaultOp: 'gt', defaultVal: 1_000_000_000 },
  { field: 'enterpriseValue', label: tt("Firma Değeri (EV)"), category: 'Temel & Değerleme', kind: 'money', defaultOp: 'gt', defaultVal: 1_000_000_000 },
  { field: 'trailingPe', label: tt("Fiyat / Kazanç (F/K)"), category: 'Temel & Değerleme', kind: 'number', unit: 'x', defaultOp: 'between', defaultVal: 1, defaultVal2: 25 },
  { field: 'forwardPe', label: tt("İleri F/K (Forward P/E)"), category: 'Temel & Değerleme', kind: 'number', unit: 'x', defaultOp: 'lt', defaultVal: 20 },
  { field: 'priceToBook', label: tt("Piyasa Değeri / Defter Değeri (PD/DD)"), category: 'Temel & Değerleme', kind: 'number', unit: 'x', defaultOp: 'lt', defaultVal: 5 },
  { field: 'priceToSales', label: tt("Fiyat / Satışlar (F/S)"), category: 'Temel & Değerleme', kind: 'number', unit: 'x', defaultOp: 'lt', defaultVal: 5 },
  { field: 'evToEbitda', label: tt("FD / FAVÖK (EV/EBITDA)"), category: 'Temel & Değerleme', kind: 'number', unit: 'x', defaultOp: 'lt', defaultVal: 15 },
  { field: 'trailingEps', label: tt("Hisse Başı Kazanç (HBK / EPS)"), category: 'Temel & Değerleme', kind: 'number', defaultOp: 'gt', defaultVal: 0 },
  { field: 'dividendYieldPct', label: tt("Temettü Verimi %"), category: 'Temel & Değerleme', kind: 'percent', unit: '%', defaultOp: 'gt', defaultVal: 1 },
  { field: 'dividendRate', label: tt("Hisse Başı Temettü"), category: 'Temel & Değerleme', kind: 'number', defaultOp: 'gt', defaultVal: 0 },
  { field: 'beta', label: tt("Beta (Endeks Hassasiyeti)"), category: 'Temel & Değerleme', kind: 'number', defaultOp: 'between', defaultVal: 0.5, defaultVal2: 1.8 },

  // 8. Kârlılık & Bilanço (11)
  { field: 'grossMarginPct', label: tt("Brüt Kâr Marjı %"), category: 'Kârlılık & Bilanço', kind: 'percent', unit: '%', defaultOp: 'gt', defaultVal: 20 },
  { field: 'operatingMarginPct', label: tt("Faaliyet Kâr Marjı %"), category: 'Kârlılık & Bilanço', kind: 'percent', unit: '%', defaultOp: 'gt', defaultVal: 10 },
  { field: 'profitMarginPct', label: tt("Net Kâr Marjı %"), category: 'Kârlılık & Bilanço', kind: 'percent', unit: '%', defaultOp: 'gt', defaultVal: 8 },
  { field: 'roePct', label: tt("Özsermaye Kârlılığı (ROE) %"), category: 'Kârlılık & Bilanço', kind: 'percent', unit: '%', defaultOp: 'gt', defaultVal: 15 },
  { field: 'roaPct', label: tt("Aktif Kârlılığı (ROA) %"), category: 'Kârlılık & Bilanço', kind: 'percent', unit: '%', defaultOp: 'gt', defaultVal: 5 },
  { field: 'debtToEquity', label: tt("Borç / Özsermaye %"), category: 'Kârlılık & Bilanço', kind: 'percent', unit: '%', defaultOp: 'lt', defaultVal: 150 },
  { field: 'currentRatio', label: tt('Cari Oran'), category: 'Kârlılık & Bilanço', kind: 'number', unit: 'x', defaultOp: 'gt', defaultVal: 1.2 },
  { field: 'quickRatio', label: tt("Asit-Test (Likidite) Oranı"), category: 'Kârlılık & Bilanço', kind: 'number', unit: 'x', defaultOp: 'gt', defaultVal: 1.0 },
  { field: 'totalRevenue', label: tt("Toplam Gelir (Yıllık)"), category: 'Kârlılık & Bilanço', kind: 'money', defaultOp: 'gt', defaultVal: 100_000_000 },
  { field: 'netIncome', label: tt("Net Kâr (Yıllık)"), category: 'Kârlılık & Bilanço', kind: 'money', defaultOp: 'gt', defaultVal: 10_000_000 },
  { field: 'freeCashFlow', label: tt("Serbest Nakit Akışı (FCF)"), category: 'Kârlılık & Bilanço', kind: 'money', defaultOp: 'gt', defaultVal: 0 },
];

export const SCREENER_FILTER_MAP: Record<string, ScreenerFilterDef> = Object.fromEntries(
  SCREENER_FILTERS.map((f) => [f.field, f])
);

export function extractScreenerField(r: ScreenerRow, field: string): number | string | null | undefined {
  switch (field) {
    case 'ema20_vs_ema50':
      return r.ema50 ? ((r.ema20 - r.ema50) / r.ema50) * 100 : null;
    case 'sma50_vs_sma200':
      return r.sma200 && r.sma50 ? ((r.sma50 - r.sma200) / r.sma200) * 100 : null;
    case 'price_vs_ema20':
      return r.ema20 ? ((r.lastPrice - r.ema20) / r.ema20) * 100 : null;
    case 'price_vs_vwap':
      return r.vwap ? ((r.lastPrice - r.vwap) / r.vwap) * 100 : null;
    default:
      return (r as unknown as Record<string, number | string | null | undefined>)[field];
  }
}

export type ScreenerColumnSetId =
  | 'overview'
  | 'performance'
  | 'oscillators'
  | 'trend'
  | 'valuation'
  | 'dividends'
  | 'profitability'
  | 'hours';

export interface ScreenerColumnSetDef {
  id: ScreenerColumnSetId;
  label: string;
  needsFundamentals?: boolean;
  columns: Array<{ field: string; label: string; format: 'price' | 'pct' | 'num' | 'vol' | 'money' | 'rating' | 'pattern' | 'dir' }>;
}

/** Gelişmiş Tarayıcı hazır sütun setleri. */
export const SCREENER_COLUMN_SETS: ScreenerColumnSetDef[] = [
  {
    id: 'overview',
    label: tt("Genel Bakış"),
    columns: [
      { field: 'lastPrice', label: tt('Son Fiyat'), format: 'price' },
      { field: 'changePercent', label: tt("Değişim %"), format: 'pct' },
      { field: 'volume', label: tt("Hacim"), format: 'vol' },
      { field: 'relVolume', label: tt('RVOL'), format: 'num' },
      { field: 'rsi14', label: tt('RSI (14)'), format: 'num' },
      { field: 'adx14', label: tt('ADX (14)'), format: 'num' },
      { field: 'macd', label: tt('MACD'), format: 'num' },
      { field: 'atr14Pct', label: tt('ATR %'), format: 'pct' },
      { field: 'rating', label: tt("Teknik Görünüm"), format: 'rating' },
    ],
  },
  {
    id: 'performance',
    label: tt("Performans"),
    columns: [
      { field: 'lastPrice', label: tt('Son Fiyat'), format: 'price' },
      { field: 'changePercent', label: tt("Günlük %"), format: 'pct' },
      { field: 'perf1w', label: tt('1H %'), format: 'pct' },
      { field: 'perf1m', label: tt('1A %'), format: 'pct' },
      { field: 'perf3m', label: tt('3A %'), format: 'pct' },
      { field: 'perf6m', label: tt('6A %'), format: 'pct' },
      { field: 'perfYtd', label: tt('YBB %'), format: 'pct' },
      { field: 'perf1y', label: tt('1Y %'), format: 'pct' },
      { field: 'from52wHighPct', label: tt('52H Zirveden %'), format: 'pct' },
      { field: 'volAnnualPct', label: tt("Yıllık Vol %"), format: 'pct' },
    ],
  },
  {
    id: 'oscillators',
    label: tt("Osilatörler"),
    columns: [
      { field: 'lastPrice', label: tt('Son Fiyat'), format: 'price' },
      { field: 'oscRating', label: tt("Osilatör Görünümü"), format: 'rating' },
      { field: 'rsi14', label: tt('RSI (14)'), format: 'num' },
      { field: 'stochK', label: tt('Stoch %K'), format: 'num' },
      { field: 'stochRsiK', label: tt('StochRSI %K'), format: 'num' },
      { field: 'cci20', label: tt('CCI (20)'), format: 'num' },
      { field: 'adx14', label: tt('ADX (14)'), format: 'num' },
      { field: 'ao', label: tt('AO'), format: 'num' },
      { field: 'momentum10', label: tt('Mom (10)'), format: 'num' },
      { field: 'macd', label: tt('MACD'), format: 'num' },
      { field: 'williamsR14', label: tt('Will %R'), format: 'num' },
      { field: 'mfi14', label: tt('MFI (14)'), format: 'num' },
    ],
  },
  {
    id: 'trend',
    label: tt("Trend Takip (HO)"),
    columns: [
      { field: 'lastPrice', label: tt('Son Fiyat'), format: 'price' },
      { field: 'maRating', label: tt("HO Görünümü"), format: 'rating' },
      { field: 'ema20', label: tt('EMA 20'), format: 'price' },
      { field: 'ema50', label: tt('EMA 50'), format: 'price' },
      { field: 'sma50', label: tt('SMA 50'), format: 'price' },
      { field: 'sma200', label: tt('SMA 200'), format: 'price' },
      { field: 'distSma200Pct', label: tt('SMA200 Fark %'), format: 'pct' },
      { field: 'supertrendDir', label: tt('Supertrend'), format: 'dir' },
      { field: 'bbPercentB', label: tt('BB %B'), format: 'num' },
      { field: 'vwap', label: tt('VWAP'), format: 'price' },
    ],
  },
  {
    id: 'valuation',
    label: tt("Değerleme & Çarpanlar"),
    needsFundamentals: true,
    columns: [
      { field: 'lastPrice', label: tt('Son Fiyat'), format: 'price' },
      { field: 'marketCap', label: tt("Piyasa Değeri"), format: 'money' },
      { field: 'enterpriseValue', label: tt("Firma Değeri"), format: 'money' },
      { field: 'trailingPe', label: tt('F/K'), format: 'num' },
      { field: 'forwardPe', label: tt("İleri F/K"), format: 'num' },
      { field: 'priceToBook', label: tt('PD/DD'), format: 'num' },
      { field: 'priceToSales', label: tt('F/S'), format: 'num' },
      { field: 'evToEbitda', label: tt("FD/FAVÖK"), format: 'num' },
      { field: 'trailingEps', label: tt('HBK (EPS)'), format: 'num' },
    ],
  },
  {
    id: 'dividends',
    label: tt("Temettü & Bilanço"),
    needsFundamentals: true,
    columns: [
      { field: 'lastPrice', label: tt('Son Fiyat'), format: 'price' },
      { field: 'dividendYieldPct', label: tt("Temettü Verimi %"), format: 'pct' },
      { field: 'dividendRate', label: tt("Hisse Başı Temettü"), format: 'num' },
      { field: 'currentRatio', label: tt('Cari Oran'), format: 'num' },
      { field: 'quickRatio', label: tt("Likidite Oranı"), format: 'num' },
      { field: 'debtToEquity', label: tt("Borç/Özsermaye %"), format: 'pct' },
      { field: 'beta', label: tt('Beta'), format: 'num' },
    ],
  },
  {
    id: 'profitability',
    label: tt("Kârlılık & Marjlar"),
    needsFundamentals: true,
    columns: [
      { field: 'lastPrice', label: tt('Son Fiyat'), format: 'price' },
      { field: 'totalRevenue', label: tt("Toplam Gelir"), format: 'money' },
      { field: 'netIncome', label: tt('Net Kâr'), format: 'money' },
      { field: 'freeCashFlow', label: tt("Serbest Nakit"), format: 'money' },
      { field: 'grossMarginPct', label: tt("Brüt Marj %"), format: 'pct' },
      { field: 'operatingMarginPct', label: tt("Faaliyet Marjı %"), format: 'pct' },
      { field: 'profitMarginPct', label: tt('Net Marj %'), format: 'pct' },
      { field: 'roePct', label: tt('ROE %'), format: 'pct' },
      { field: 'roaPct', label: tt('ROA %'), format: 'pct' },
    ],
  },
  {
    id: 'hours',
    label: tt("Uzatılmış Saat & Volatilite"),
    columns: [
      { field: 'lastPrice', label: tt('Son Fiyat'), format: 'price' },
      { field: 'changePercent', label: tt("Değişim %"), format: 'pct' },
      { field: 'gapPct', label: tt('Gap %'), format: 'pct' },
      { field: 'extPrice', label: tt("Uzat. Saat Fiyat"), format: 'price' },
      { field: 'extChangePct', label: tt("Uzat. Saat %"), format: 'pct' },
      { field: 'atr14Pct', label: tt('ATR (14) %'), format: 'pct' },
      { field: 'bbWidthPct', label: tt("BB Genişlik %"), format: 'pct' },
      { field: 'relVolume', label: tt('RVOL'), format: 'num' },
      { field: 'candlePattern', label: tt('Mum Formasyonu'), format: 'pattern' },
    ],
  },
];

/** Hazır Tarayıcı Ekran Şablonları (Saved Screens). */
export const BUILTIN_SCREENER_PRESETS: SavedScreenerPreset[] = [
  {
    id: 'preset_oversold',
    name: tt("Aşırı Satım & Tepki Adayları (RSI < 40)"),
    market: 'ALL',
    timeframe: '15m',
    columnSet: 'oscillators',
    config: {
      filters: [{ id: 'f1', field: 'rsi14', op: 'lt', value: 40 }],
      sortCol: 'rsi14',
      sortDir: 'asc',
    },
  },
  {
    id: 'preset_momentum',
    name: tt("Güçlü Momentum & Boğa Trendi"),
    market: 'ALL',
    timeframe: '15m',
    columnSet: 'overview',
    config: {
      filters: [
        { id: 'f1', field: 'score', op: 'gte', value: 1 },
        { id: 'f2', field: 'rsi14', op: 'gt', value: 50 },
      ],
      sortCol: 'score',
      sortDir: 'desc',
    },
  },
  {
    id: 'preset_sma200',
    name: tt("SMA 200 Üstü Uzun Vadeli Yükselenler"),
    market: 'ALL',
    timeframe: '1d',
    columnSet: 'trend',
    config: {
      filters: [{ id: 'f1', field: 'distSma200Pct', op: 'gt', value: 0 }],
      sortCol: 'distSma200Pct',
      sortDir: 'desc',
    },
  },
  {
    id: 'preset_squeeze',
    name: tt("Bollinger Sıkışması & Kırılım Adayları"),
    market: 'ALL',
    timeframe: '15m',
    columnSet: 'hours',
    config: {
      filters: [{ id: 'f1', field: 'bbWidthPct', op: 'lt', value: 12 }],
      sortCol: 'bbWidthPct',
      sortDir: 'asc',
    },
  },
  {
    id: 'preset_value',
    name: tt("Makul F/K & Yüksek Özsermaye Kârlılığı (ROE)"),
    market: 'BIST',
    timeframe: '1d',
    columnSet: 'valuation',
    config: {
      filters: [
        { id: 'f1', field: 'trailingPe', op: 'between', value: 1, value2: 25 },
        { id: 'f2', field: 'roePct', op: 'gt', value: 10 },
      ],
      sortCol: 'trailingPe',
      sortDir: 'asc',
    },
  },
  {
    id: 'preset_dividend',
    name: tt("Temettü Verimi Öne Çıkanlar"),
    market: 'ALL',
    timeframe: '1d',
    columnSet: 'dividends',
    config: {
      filters: [{ id: 'f1', field: 'dividendYieldPct', op: 'gt', value: 0.5 }],
      sortCol: 'dividendYieldPct',
      sortDir: 'desc',
    },
  },
];

export interface ScriptScreenerTemplate {
  id: string;
  name: string;
  description: string;
  code: string;
}

/** TitanScript Tarayıcı için hazır TitanScript tarama betikleri. */
export const SCRIPT_SCREENER_TEMPLATES: ScriptScreenerTemplate[] = [
  {
    id: 'script_tpl_rsi_ema',
    name: tt("RSI + EMA Trend & Bağıl Hacim Tarayıcı"),
    description: tt("RSI(14), EMA(20), EMA(50) ve Bağıl Hacim (RVOL) sütunlarını hesaplar; boğa momentum ve aşırı satım koşullarını tarar."),
    code: `//@version=6
indicator("TitanScript Tarayıcı: RSI + EMA + RVOL")
rsi14 = ta.rsi(close, 14)
ema20 = ta.ema(close, 20)
ema50 = ta.ema(close, 50)
volSma = ta.sma(volume, 20)
rvol = volSma > 0 ? volume / volSma : 1.0
trendScore = (close > ema20 ? 1 : -1) + (ema20 > ema50 ? 1 : -1) + (rsi14 > 50 ? 1 : -1)

plot(rsi14, "RSI_14")
plot(ema20, "EMA_20")
plot(ema50, "EMA_50")
plot(rvol, "RVOL")
plot(trendScore, "Trend_Puanı")

alertcondition(close > ema20 and ema20 > ema50 and rsi14 > 52, "Boğa Trend Uyumu", "Fiyat > EMA20 > EMA50 ve RSI güçlü")
alertcondition(rsi14 < 38 and close >= open, "Aşırı Satım Tepkisi", "RSI düşük bölgede yeşil mum")
`,
  },
  {
    id: 'script_tpl_supertrend_adx',
    name: tt("ATR Volatilite & Donchian Kanal Kırılım Tarayıcı"),
    description: tt("ATR %, Donchian(20) kanal konumu ve ROC(9) momentumunu tarar."),
    code: `//@version=6
indicator("TitanScript Tarayıcı: Kanal & Volatilite")
atr14 = ta.atr(14)
atrPct = close > 0 ? (atr14 / close) * 100 : 0.0
hi20 = ta.highest(high, 20)
lo20 = ta.lowest(low, 20)
kanalKonum = hi20 > lo20 ? ((close - lo20) / (hi20 - lo20)) * 100 : 50.0
roc9 = ta.roc(close, 9)

plot(kanalKonum, "Kanal_Konum_%")
plot(atrPct, "ATR_%")
plot(roc9, "ROC_9_%")
plot(hi20, "Donchian_Üst")

alertcondition(kanalKonum > 75 and roc9 > 0, "Kanal Üst Kırılım", "Donchian üst bölgesinde pozitif momentum")
alertcondition(kanalKonum < 25, "Kanal Dip Bölgesi", "Donchian alt destek bölgesinde")
`,
  },
  {
    id: 'script_tpl_bb_macd',
    name: tt("Bollinger Sıkışması & MACD Histogram Tarayıcı"),
    description: tt("Bollinger Bant Genişliği %, %B ve MACD(12,26,9) histogramını hesaplayıp sıkışma sonrası dönüşleri yakalar."),
    code: `//@version=6
indicator("TitanScript Tarayıcı: BB + MACD")
basis = ta.sma(close, 20)
dev = 2.0 * ta.stdev(close, 20)
upper = basis + dev
lower = basis - dev
bbWidth = basis > 0 ? ((upper - lower) / basis) * 100 : 0.0
pctB = upper > lower ? (close - lower) / (upper - lower) : 0.5
[macdLine, signalLine, histLine] = ta.macd(close, 12, 26, 9)

plot(bbWidth, "BB_Genişlik_%")
plot(pctB, "BB_YüzdeB")
plot(macdLine, "MACD")
plot(histLine, "MACD_Hist")

alertcondition(histLine > 0 and pctB > 0.5, "Pozitif MACD & BB Üst Yarı", "MACD histogram pozitif ve fiyat orta bandın üzerinde")
`,
  },
  {
    id: 'script_tpl_zscore_cci',
    name: tt("İstatistiksel Z-Skor & CCI Ortalamaya Dönüş Tarayıcı"),
    description: tt("20 barlık Z-Skor, CCI(20) ve Williams %R(14) ile ortalamadan aşırı sapmaları tarar."),
    code: `//@version=6
indicator("TitanScript Tarayıcı: Z-Skor & CCI")
mean20 = ta.sma(close, 20)
sd20 = ta.stdev(close, 20)
zScore = sd20 > 0 ? (close - mean20) / sd20 : 0.0
cci20 = ta.cci(close, 20)
wpr14 = ta.wpr(14)

plot(zScore, "Z_Skor_20")
plot(cci20, "CCI_20")
plot(wpr14, "Williams_R14")

alertcondition(zScore < -1.0 or cci20 < -100, "İstatistiksel Ucuzluk (Z < -1)", "Ortalamanın altında aşırı sapma")
alertcondition(zScore > 1.0 or cci20 > 100, "İstatistiksel Güç (Z > +1)", "Ortalamanın üzerinde güçlü momentum")
`,
  },
];

export function evaluateScreenerFilterRule(row: ScreenerRow, rule: ScreenerFilterRule): boolean {
  const raw = extractScreenerField(row, rule.field);
  if (raw === null || raw === undefined) return false;

  if (typeof raw === 'string') {
    const target = String(rule.value).trim().toUpperCase();
    const cur = raw.trim().toUpperCase();
    if (rule.op === 'neq') return cur !== target;
    return cur === target;
  }

  if (typeof raw !== 'number' || Number.isNaN(raw)) return false;

  let rhs = Number(rule.value);
  if ((rule.op === 'above_field' || rule.op === 'below_field') && rule.rhsField) {
    const rhsRaw = extractScreenerField(row, rule.rhsField);
    if (typeof rhsRaw !== 'number' || Number.isNaN(rhsRaw)) return false;
    rhs = rhsRaw;
  }

  switch (rule.op) {
    case 'gt':
    case 'above_field':
      return raw > rhs;
    case 'gte':
      return raw >= rhs;
    case 'lt':
    case 'below_field':
      return raw < rhs;
    case 'lte':
      return raw <= rhs;
    case 'eq':
      return Math.abs(raw - rhs) <= 1e-6;
    case 'neq':
      return Math.abs(raw - rhs) > 1e-6;
    case 'between': {
      const hi = Number(rule.value2 ?? rhs);
      const lo = Math.min(rhs, hi);
      const max = Math.max(rhs, hi);
      return raw >= lo && raw <= max;
    }
    default:
      return true;
  }
}

export function applyScreenerFilters(
  rows: ScreenerRow[],
  filters: ScreenerFilterRule[],
  searchQuery = ''
): ScreenerRow[] {
  const q = searchQuery.trim().toUpperCase();
  return rows.filter((row) => {
    if (q && !row.symbol.toUpperCase().includes(q) && !row.displayName.toUpperCase().includes(q)) {
      return false;
    }
    for (const rule of filters) {
      if (!evaluateScreenerFilterRule(row, rule)) return false;
    }
    return true;
  });
}

export function sortScreenerRows(
  rows: ScreenerRow[],
  sortCol: string,
  sortDir: 'asc' | 'desc'
): ScreenerRow[] {
  if (!sortCol || rows.length <= 1) return rows;
  const mult = sortDir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (sortCol === 'symbol') {
      return mult * a.symbol.localeCompare(b.symbol, 'tr-TR');
    }
    const va = extractScreenerField(a, sortCol);
    const vb = extractScreenerField(b, sortCol);
    if (va == null && vb == null) return a.symbol.localeCompare(b.symbol, 'tr-TR');
    if (va == null) return 1;
    if (vb == null) return -1;
    if (typeof va === 'string' && typeof vb === 'string') {
      return mult * va.localeCompare(vb, 'tr-TR');
    }
    const na = Number(va);
    const nb = Number(vb);
    if (na === nb) return a.symbol.localeCompare(b.symbol, 'tr-TR');
    return mult * (na - nb);
  });
}
