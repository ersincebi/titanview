# TitanScript (`.titan`) Guide

**TitanScript** is TitanView's built-in bar-by-bar technical analysis and strategy scripting language (`frontend/src/script/`). It supports `//@version=5` and `//@version=6` compatible syntax so scripts written for other charting platforms run locally with little or no modification.

---

## Highlights

- **Real bar-by-bar execution** in Web Workers (UI stays responsive), with hot `ta.*` paths accelerated in **Rust/WASM** (`wasm/titan-core/`).
- **Server-side execution** via Goja (`backend/internal/scriptjs/`) for always-on server alerts and the **Script Screener**.
- **Incremental tick updates**: live ticks recalculate only the active bar rather than re-running full history.
- **194 clean-room built-in indicators** (`frontend/src/script/builtins/*.titan`), including 45 candlestick patterns — all derived from published technical analysis literature under `AGPL-3.0-or-later`.
- **Monaco Editor** with syntax highlighting, autocomplete, signature help, hover docs, inline diagnostics, script library, and version history.

---

## Supported Language Features

| Category | Features |
|---|---|
| **Declarations** | `//@version=5`, `//@version=6`, `indicator()`, `strategy()`, `library()` (`export` / `import`) |
| **State & Types** | `var`, `varip`, `type` (UDTs), `method`, `enum`, tuples, `array.*`, `map.*`, `matrix.*`, `na` / `nz()` |
| **Technical Analysis** | `ta.sma`, `ta.ema`, `ta.rma`, `ta.wma`, `ta.vwma`, `ta.rsi`, `ta.macd`, `ta.bb`, `ta.atr`, `ta.supertrend`, `ta.stoch`, `ta.cci`, `ta.dmi`, `ta.linreg`, `ta.pivothigh/low`, `ta.crossover/under`, `ta.highest/lowest`, `ta.stdev`, and more |
| **Multi-Timeframe** | `request.security()`, `request.security_lower_tf()`, `request.currency_rate()` with non-repainting defaults |
| **Visuals & Drawings** | `plot`, `plotshape`, `plotchar`, `plotcandle`, `plotbar`, `hline`, `fill`, `bgcolor`, `barcolor`, `line.*`, `box.*`, `label.*`, `table.*`, `polyline.*`, `linefill.*` |
| **Strategy Broker** | `strategy.entry`, `strategy.exit`, `strategy.close`, `strategy.close_all`, `strategy.order`, `strategy.cancel`, pyramiding, percentage/fixed/equity sizing, commissions, slippage, bar magnifier |
| **Inputs & Debugging** | `input.int`, `input.float`, `input.bool`, `input.string`, `input.source`, `input.color`, `input.timeframe`, `input.symbol`, `input.price`, `input.time` (interactive chart pick), `group` / `inline` / `tooltip`; `log.info`, `log.warning`, `log.error` |
| **Alerts** | `alert()`, `alertcondition()` wired directly into the server-side alert engine |

---

## Examples

### 1. Custom Indicator

```titan
//@version=5
indicator("RSI + Volatility Envelope", overlay=false)

len   = input.int(14, "RSI Length", minval=2)
ob    = input.int(70, "Overbought")
os    = input.int(30, "Oversold")

r = ta.rsi(close, len)
basis = ta.sma(r, 14)
dev   = ta.stdev(r, 14)

plot(r, "RSI", color=color.aqua, linewidth=2)
pUp = plot(basis + dev, "Upper", color=color.new(color.gray, 60))
pDn = plot(basis - dev, "Lower", color=color.new(color.gray, 60))
fill(pUp, pDn, color=color.new(color.aqua, 90))

hline(ob, "Overbought", color=color.red, linestyle=hline.style_dashed)
hline(os, "Oversold",   color=color.green, linestyle=hline.style_dashed)
```

### 2. Backtestable Strategy

```titan
//@version=5
strategy("SuperTrend Momentum", overlay=true, initial_capital=10000, commission_value=0.1)

atrLen = input.int(10, "ATR Length")
mult   = input.float(3.0, "Multiplier", step=0.1)

[st, dir] = ta.supertrend(mult, atrLen)
plot(st, "SuperTrend", color = dir < 0 ? color.green : color.red, linewidth=2)

if ta.crossunder(dir, 0)
    strategy.entry("Long", strategy.long)

if ta.crossover(dir, 0)
    strategy.entry("Short", strategy.short)
```

Apply a strategy from the **Script Editor** (`Cmd/Ctrl+Enter`), then open the **Strategy Tester** tab to inspect:
- **Overview** (equity curve, drawdown, buy & hold comparison, Sharpe/Sortino)
- **Performance Summary** & **List of Trades** (click any trade to jump to that bar on the chart)
- **Deep Backtest** over custom date ranges and **Bar Magnifier** (lower-timeframe intrabar fills)
- **Optimization** (grid search across input ranges using parallel WASM workers)
- **CSV / Excel** export

---

## Contributing Built-In Indicators

All built-in indicators live in `frontend/src/script/builtins/*.titan` and are enforced by CI (`scripts/check-licenses.mjs`):

1. Implement strictly from published mathematical or financial literature (clean-room rule — never copy proprietary scripts).
2. Include `// SPDX-License-Identifier: AGPL-3.0-or-later` at the top of the file.
3. Register metadata in `frontend/src/script/builtins/catalog.ts` and ensure `pnpm test` passes `builtins.test.ts`.
