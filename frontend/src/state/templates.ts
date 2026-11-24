import { tt } from './i18n';
import type { ActiveQuickIndicators } from '../chart/ChartController';

export type IndicatorKey = keyof ActiveQuickIndicators;

export const NO_INDICATORS: ActiveQuickIndicators = {
  ema9: false,
  ema21: false,
  ema55: false,
  sma200: false,
  bb: false,
  supertrend: false,
  vwap: false,
  ichimoku: false,
  psar: false,
  vpvr: false,
  rsi: false,
  macd: false,
};

/** Varsayılan: hiçbir hızlı gösterge yok; grafik varsayılan betikle açılır. */
export const DEFAULT_INDICATORS: ActiveQuickIndicators = { ...NO_INDICATORS };

export interface IndicatorItem {
  key: IndicatorKey;
  title: string;
  desc: string;
  color: string;
  legend: string;
}

export const OVERLAY_ITEMS: IndicatorItem[] = [
  { key: 'ema9', title: tt("EMA 9 (Üstel Hareketli Ortalama)"), desc: tt("Kısa vadeli momentum"), color: '#00BCD4', legend: 'EMA 9' },
  { key: 'ema21', title: tt("EMA 21 (Dinamik Trend Sınırı)"), desc: tt("Trend desteği"), color: '#FF9800', legend: 'EMA 21' },
  { key: 'ema55', title: tt('EMA 55 (Orta Vadeli Trend)'), desc: tt("Ana dalga yönü"), color: '#AB47BC', legend: 'EMA 55' },
  { key: 'sma200', title: tt('SMA 200 (Kurumsal Trend)'), desc: tt("Boğa/Ayı ana sınırı"), color: '#E91E63', legend: 'SMA 200' },
  { key: 'bb', title: tt("Bollinger Bantları (20, 2.0)"), desc: tt("Volatilite sıkışması"), color: '#0284C7', legend: 'BB 20,2' },
  { key: 'supertrend', title: tt("SuperTrend (ATR 10, Çarpan 3.0)"), desc: tt("İz süren trend stopu"), color: '#089981', legend: 'SuperTrend' },
  { key: 'ichimoku', title: tt("Ichimoku Bulutu (9, 26, 52)"), desc: tt("Tenkan, Kijun ve Senkou Span"), color: '#8BC34A', legend: 'Ichimoku' },
  { key: 'psar', title: 'Parabolic SAR (0.02, 0.20)', desc: tt("Dönüş sinyalleri"), color: '#FFEB3B', legend: 'PSAR' },
  { key: 'vwap', title: 'VWAP', desc: tt("Hacim ağırlıklı ortalama fiyat"), color: '#FFFFFF', legend: 'VWAP' },
  { key: 'vpvr', title: tt("VPVR & POC (Yatay Hacim Profili)"), desc: tt("Fiyat kademelerine göre hacim yoğunluğu"), color: '#0284C7', legend: 'VPVR (Hacim Profili & POC)' },
];

export const OSCILLATOR_ITEMS: IndicatorItem[] = [
  { key: 'rsi', title: tt("RSI (14, close) — Göreceli Güç Endeksi"), desc: tt("Aşırı alım (70) ve aşırı satım (30) seviyeleri"), color: '#7E57C2', legend: 'RSI 14' },
  { key: 'macd', title: 'MACD (12, 26, 9) — Momentum & Sinyal', desc: tt("MACD hattı, sinyal hattı ve histogram dalgaları"), color: '#0284C7', legend: 'MACD' },
];

export type TemplateKey = 'trend' | 'momentum' | 'institutional';

export interface IndicatorTemplate {
  key: TemplateKey;
  title: string;
  desc: string;
  color: string;
  toast: string;
  flags?: Partial<ActiveQuickIndicators>;
}

export const TEMPLATES: IndicatorTemplate[] = [
  {
    key: 'trend',
    title: tt("⚔️ Titan Trend Master"),
    desc: tt("EMA 9, EMA 21, EMA 55, SuperTrend ve VPVR Hacim Profili"),
    color: 'var(--bull)',
    toast: tt("✨ \"Titan Trend Master\" şablonu uygulandı!"),
    flags: { ema9: true, ema21: true, ema55: true, supertrend: true, vpvr: true },
  },
  {
    key: 'momentum',
    title: tt("🌊 Momentum & Salınım"),
    desc: tt("Bollinger Bantları, RSI 14 ve MACD Osilatörü"),
    color: 'var(--accent)',
    toast: tt("✨ \"Momentum & Salınım\" şablonu uygulandı!"),
    flags: { bb: true, rsi: true, macd: true, vpvr: true },
  },
  {
    key: 'institutional',
    title: tt("🏛️ Kurumsal Akış & Rejim"),
    desc: tt("SMA 200, Ichimoku Bulutu, VWAP ve POC Seviyesi"),
    color: 'var(--amber)',
    toast: tt("✨ \"Kurumsal Akış & Rejim\" şablonu uygulandı!"),
    flags: { sma200: true, ichimoku: true, vwap: true, vpvr: true },
  },
];

/** Şablonun tam bayrak kümesi (belirtilmeyenler kapalı). Betik şablonu için null. */
export function templateFlags(t: IndicatorTemplate): ActiveQuickIndicators | null {
  return t.flags ? { ...NO_INDICATORS, ...t.flags } : null;
}
