export interface ScriptPreset {
  id: string;
  name: string;
  category: 'strategy' | 'indicator';
  description: string;
  isOverlay: boolean;
  code: string;
}

export const BUILTIN_SCRIPT_PRESETS: ScriptPreset[] = [
  {
    id: 'ema_golden_cross_strategy',
    name: '⚡ EMA 9/21 Kesişimi + RSI Filtreli Strateji (Backtest)',
    category: 'strategy',
    description: 'EMA 9 yukarı/aşağı EMA 21 kestiğinde Long/Short açan, grafiğe BUY/SELL sinyalleri ve tam Backtest tablosu üreten TitanScript stratejisi.',
    isOverlay: true,
    code: `//@version=5
strategy("Titan EMA 9/21 Cross Strategy", overlay=true, initial_capital=10000, commission_value=0.1)

fastLen = input.int(9, title="Hızlı EMA")
slowLen = input.int(21, title="Yavaş EMA")
trendLen = input.int(55, title="Ana Trend EMA")

fastEMA = ta.ema(close, fastLen)
slowEMA = ta.ema(close, slowLen)
trendEMA = ta.ema(close, trendLen)

plot(fastEMA, title="EMA 9 (Hızlı)", color=color.aqua, linewidth=2)
plot(slowEMA, title="EMA 21 (Yavaş)", color=color.orange, linewidth=2)
plot(trendEMA, title="EMA 55 (Trend)", color=color.purple, linewidth=1)

longCond = ta.crossover(fastEMA, slowEMA)
shortCond = ta.crossunder(fastEMA, slowEMA)

if longCond
    strategy.entry("EMA-Long", strategy.long)

if shortCond
    strategy.entry("EMA-Short", strategy.short)
`,
  },
  {
    id: 'supertrend_pro_strategy',
    name: '🔥 SuperTrend (10, 3.0) Algoritmik Al-Sat Stratejisi',
    category: 'strategy',
    description: 'ATR tabanlı SuperTrend kırılımlarında otomatik pozisyon değiştiren BIST ve Kripto uyumlu trend takip stratejisi.',
    isOverlay: true,
    code: `//@version=5
strategy("Titan SuperTrend Pro", overlay=true, initial_capital=10000, commission_value=0.08)

factor = input.float(3.0, title="ATR Çarpanı")
atrLen = input.int(10, title="ATR Periyodu")

[stLine, dir] = ta.supertrend(factor, atrLen)

plot(stLine, title="SuperTrend", color=color.teal, linewidth=2)

buySignal = ta.crossunder(dir, 0)
sellSignal = ta.crossover(dir, 0)

if buySignal
    strategy.entry("ST-Long", strategy.long)

if sellSignal
    strategy.entry("ST-Short", strategy.short)
`,
  },
  {
    id: 'bollinger_breakout_indicator',
    name: '🎯 Bollinger Bandı Sıkışma & Kırılım (20, 2)',
    category: 'indicator',
    description: '20 periyotluk Bollinger Üst/Orta/Alt bantlarını ve aşırı taşma dönüş sinyallerini mum grafiği üzerine çizer.',
    isOverlay: true,
    code: `//@version=5
indicator("Titan Bollinger Bands & Signals", overlay=true)

length = input.int(20, title="BB Periyodu")
mult = input.float(2.0, title="Standart Sapma")

[middle, upper, lower] = ta.bb(close, length, mult)

plot(upper, title="Üst Bant", color=color.red, linewidth=1)
plot(middle, title="Orta SMA 20", color=color.yellow, linewidth=2)
plot(lower, title="Alt Bant", color=color.green, linewidth=1)

dipAlim = ta.crossover(close, lower)
tepeSatim = ta.crossunder(close, upper)

plotshape(dipAlim, title="BB Dip Al", location=location.belowbar, color=color.lime, text="BB AL")
plotshape(tepeSatim, title="BB Tepe Sat", location=location.abovebar, color=color.red, text="BB SAT")
`,
  },
  {
    id: 'bist_volume_momentum_indicator',
    name: '🚀 BIST Hacim Patlaması & Momentum Tarayıcı',
    category: 'indicator',
    description: 'Hacmin 20 periyotluk ortalamasının 2 katını aştığı ve fiyatın EMA 20 üzerinde kapandığı anomalileri tespit eder.',
    isOverlay: true,
    code: `//@version=5
indicator("BIST Hacim Patlaması & Momentum Tarayıcı", overlay=true)

volLen = input.int(20, title="Hacim SMA")
volMult = input.float(2.0, title="Hacim Katı")
trendLen = input.int(20, title="Trend EMA")

avgVol = ta.sma(volume, volLen)
trendEMA = ta.ema(close, trendLen)

volBreakout = volume > avgVol * volMult and close > open and close > trendEMA

plot(trendEMA, title="EMA 20", color=color.aqua, linewidth=2)
plotshape(volBreakout, title="Hacim Patlaması", location=location.belowbar, color=color.yellow, text="BIST HACİM")
`,
  },
  {
    id: 'macd_rsi_dual_trend_strategy',
    name: '📈 MACD + RSI Çift Onaylı Trend Stratejisi (Backtest)',
    category: 'strategy',
    description: 'MACD kesişimini RSI > 50 / RSI < 50 momentum filtresiyle onaylayarak güvenilir al-sat işlemleri üreten strateji.',
    isOverlay: true,
    code: `//@version=5
strategy("MACD + RSI Çift Onaylı Trend Stratejisi", overlay=true, initial_capital=10000, commission_value=0.08)

rsiLen = input.int(14, title="RSI Periyodu")
fastLen = input.int(12, title="MACD Hızlı")
slowLen = input.int(26, title="MACD Yavaş")
sigLen = input.int(9, title="MACD Sinyal")

r = ta.rsi(close, rsiLen)
[macdLine, signalLine, histLine] = ta.macd(close, fastLen, slowLen, sigLen)

trendEMA = ta.ema(close, 20)
plot(trendEMA, title="Trend EMA 20", color=color.aqua, linewidth=2)

longCond = ta.crossover(macdLine, signalLine) and r > 50
shortCond = ta.crossunder(macdLine, signalLine) and r < 50

if longCond
    strategy.entry("MACD-RSI-Long", strategy.long)

if shortCond
    strategy.entry("MACD-RSI-Short", strategy.short)
`,
  },
  {
    id: 'rsi_oversold_oscillator',
    name: '📊 RSI (14) + EMA Sinyal Alt Paneli (Sub-Pane)',
    category: 'indicator',
    description: 'Alt panelde (overlay=false) RSI 14 çizgisini, 9 periyotluk RSI EMA ortalamasını ve 70/30 seviyelerini çalıştırır.',
    isOverlay: false,
    code: `//@version=5
indicator("Titan RSI 14 + EMA 9", overlay=false)

rsiLen = input.int(14, title="RSI Periyodu")
emaLen = input.int(9, title="Sinyal EMA")

r = ta.rsi(close, rsiLen)
rSignal = ta.ema(r, emaLen)

plot(r, title="RSI 14", color=color.purple, linewidth=2)
plot(rSignal, title="RSI EMA 9", color=color.yellow, linewidth=1)

hline(70, title="Aşırı Alım (70)", color=color.red)
hline(50, title="Orta Seviye (50)", color=color.gray)
hline(30, title="Aşırı Satım (30)", color=color.green)
`,
  },
  {
    id: 'macd_histogram_oscillator',
    name: '📉 MACD (12, 26, 9) Histogram & Kesişim Alt Paneli',
    category: 'indicator',
    description: 'Alt panelde MACD çizgisi, Sinyal çizgisi ve renkli Momentum Histogramını hesaplar.',
    isOverlay: false,
    code: `//@version=5
indicator("Titan MACD (12, 26, 9)", overlay=false)

[macdLine, signalLine, histLine] = ta.macd(close, 12, 26, 9)

plot(histLine, title="MACD Histogram", style=plot.style_histogram, color=color.teal, linewidth=2)
plot(macdLine, title="MACD", color=color.blue, linewidth=2)
plot(signalLine, title="Signal", color=color.orange, linewidth=2)
hline(0, title="Sıfır Çizgisi", color=color.gray)
`,
  },
];
