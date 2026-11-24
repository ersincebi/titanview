<div align="center">

# TitanView

**An open-source, local-first charting and analysis terminal with the TitanScript (`.titan`) engine,
a strategy tester, server-side alerts, and paper trading.**

Desktop (macOS · Windows · Linux) and browser · Your data stays on your machine · AGPL-3.0-or-later

[Download](https://github.com/ersincebi/titanview/releases) ·
[Build from source](#build-from-source) ·
[Contributing](CONTRIBUTING.md) ·
[Roadmap](#roadmap) ·
[Türkçe](#türkçe)

</div>

> **Not affiliated with TradingView.** TradingView® and Pine Script® are registered trademarks of
> TradingView, Inc. TitanView is an independent project and is not sponsored or endorsed by them. See [NOTICE](NOTICE).

---

## Why TitanView?

Charting platforms keep moving core features behind paywalls: indicator limits, alert limits, intraday
Renko/Kagi, footprint charts, and multi-chart layouts. TitanView is a complete, self-hosted alternative
that anyone can run, inspect, and improve:

- **Local-first.** A Go server with an SQLite cache runs next to the UI. No account, no cloud, no tracking.
- **Ergonomic.** Keyboard-driven workspace, fast shortcuts, and multi-pane layouts designed for active chart analysis.
- **Programmable.** Real bar-by-bar **TitanScript** (`.titan`) runtime supporting `//@version=5/6`, `indicator()`, `strategy()`, and `library()`. Compatible scripts from other charting platforms run with little or no modification.
- **Hackable.** TypeScript + SolidJS front end, Go back end, Rust/WASM hot core, Tauri v2 desktop shell. All tested.

## Features

| Area | What you get |
|---|---|
| **Charts** | 21 chart types: bars, candles, hollow and volume candles, line/step/area/HLC area/baseline, columns, high-low, Heikin Ashi, Renko, line break, Kagi, Point & Figure, range, **volume footprint** (real order flow for crypto), **TPO**, **session volume profile** |
| **TitanScript engine** | Bar-by-bar `.titan` runtime: `var`/`varip`, UDTs, methods, enums, `map`, `matrix`, libraries (`import`/`export`), `request.security` without repainting, drawings (lines, boxes, labels, tables, polylines, linefills), `log.*` console; compatible syntax with scripts from other charting platforms |
| **Script editor** | Monaco-based TitanScript editor with syntax highlighting, completion, signature help, hover docs, error markers, script library, and version history |
| **Indicators** | 194 built-in clean-room indicators written in TitanScript (`.titan`), 45 candlestick patterns, auto Fib/pivots/trendlines, indicator-on-indicator, visible/fixed/session volume profiles |
| **Drawing tools** | Lines, channels, pitchforks, the full Fibonacci and Gann families, shapes, XABCD/harmonic patterns, Elliott waves, forecasting and measuring tools, notes, icons, templates, magnet modes |
| **Strategy tester** | Realistic bar-by-bar broker emulation, deep backtest over full history, bar magnifier, trade list linked to the chart, CSV/XLSX export, parameter optimisation (grid search, WASM workers) |
| **Alerts** | Server-side engine that keeps running when the UI is closed: price, indicator, strategy, and drawing conditions; once / once per bar / on bar close; webhook, Telegram, and Web Push |
| **Layouts** | Up to 16 charts per layout with symbol, interval, crosshair, time, and drawing sync; saved layouts; custom intervals |
| **Symbols & data** | Symbol expressions (`BTCUSDT/ETHUSDT`, spreads, baskets), currency conversion, dividends/splits/earnings on chart, fundamentals, calendars, crypto options (Deribit) |
| **Watchlists & screeners** | Multiple and flagged watchlists, custom columns, import/export, advanced screener, and TitanScript screener |
| **Trading** | Paper trading with every order type and draggable orders/TP/SL on the chart; opt-in live orders on Binance (your own keys, encrypted locally, confirmation on every order) |
| **Extras** | Command-bar terminal (`DES`, `GP`, `FA`, `OVME`), market heatmap, correlation matrix, multi-factor analysis panel, whale tape, offline mode, English and Turkish UI |

## Install

Download the package for your platform from **[Releases](https://github.com/ersincebi/titanview/releases)**.

| Platform | Package |
|---|---|
| macOS (Apple Silicon and Intel) | `.dmg` |
| Windows 10/11 | `.exe` installer or `.msi` |
| Linux | `.AppImage`, `.deb`, `.rpm` |
| Android 7+ | `.apk` (install from the release page; allow "install unknown apps" for your browser) |

The Android app runs the whole engine on the phone, or connects to your own TitanView server
(`titanview-server -remote`, see [docs/mobile.md](docs/mobile.md)). It is not published on app stores.

**macOS with Homebrew** (from the first signed release):

```bash
brew tap ersincebi/titanview https://github.com/ersincebi/titanview
brew install --cask titanview
```

> Release builds are not yet signed with Apple or Microsoft certificates. macOS Gatekeeper and Windows
> SmartScreen may show a warning on first launch. Signing is on the [roadmap](#roadmap).

## Build from source

**Requirements:** Node.js 20+ and pnpm 10, Go 1.26+, Rust stable (for the WASM core and the desktop shell).

```bash
git clone https://github.com/ersincebi/titanview.git
cd titanview
pnpm install

# Web: build the UI and start the local server
make build
./backend/titanview-server --port 8080 --db data/titanview.db --static dist
# open http://localhost:8080

# Frontend dev server with hot reload (needs the Go server on :8080)
pnpm dev

# Desktop app (Tauri v2)
pnpm desktop:build

# Android APK (needs Android SDK + NDK; see docs/mobile.md)
node scripts/android-init.mjs
pnpm tauri android build --apk
```

Run every check that CI runs: `make verify` (Go tests with `-race`, typecheck, frontend tests, build, smoke test).

## Architecture

```
┌────────────────────────────── Desktop shell (Tauri v2, Rust) ──────────────────────────────┐
│  tray · notifications · global shortcuts · auto-update · starts/stops the Go sidecar       │
│ ┌──────────────── UI (SolidJS + TypeScript) ────────────────┐   ┌──── Go server ─────────┐ │
│ │ chart/   lightweight-charts v5, custom series, primitives │   │ api/       REST + WS   │ │
│ │ script/  TitanScript: lexer → parser → typecheck → VM     │◄─►│ provider/  Binance,    │ │
│ │          (Web Worker; hot paths in Rust/WASM: wasm/)      │   │            Yahoo, …    │ │
│ │ state/   stores, workspace, layouts                       │   │ storage/   SQLite      │ │
│ │ ui/      shell, panels, modals, editor (Monaco)           │   │ alerts/    alert engine│ │
│ └───────────────────────────────────────────────────────────┘   │ scriptjs/  server VM   │ │
│                                                                  │ trading/   paper+live  │ │
│                                                                  │ footprint/ order flow  │ │
│                                                                  └────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
```

| Path | Contents |
|---|---|
| `frontend/src/chart` | Chart controller, panes, custom series (Kagi, P&F, footprint…), drawing tools |
| `frontend/src/script` | TitanScript language: lexer, parser, type checker, VM, `ta.*`, broker emulation, editor, built-ins (`builtins/*.titan`) |
| `frontend/src/state`, `frontend/src/ui` | Application state and SolidJS components |
| `backend/internal` | Go packages: `api`, `provider`, `storage`, `alerts`, `scriptjs`, `trading`, `footprint`, `analytics`, `hub`, … |
| `wasm/titan-core` | Rust core compiled to WASM for the strategy optimiser and heavy indicator paths |
| `src-tauri` | Desktop and Android shell (Tauri v2) |
| `backend/mobile`, `backend/cmd/libtitan` | Go server as an in-process library for the Android app |

## Roadmap

| Status | Item |
|---|---|
| ✅ | Charts, TitanScript engine and editor, 194 built-in indicators, drawing tools, strategy tester, alerts, layouts, watchlists, paper trading |
| ✅ | Desktop packages for every platform (Tauri), signed auto-update |
| ✅ | Android app (local engine or remote server), phone push via ntfy |
| 📋 | Data providers as plugins, signed macOS/Windows builds, more languages |

Ideas and help are welcome: see [good first issues](https://github.com/ersincebi/titanview/labels/good%20first%20issue) and [CONTRIBUTING.md](CONTRIBUTING.md).

## Contributing

Bug reports, script compatibility test cases, new indicators, drawing tools, data providers,
translations, and documentation are all welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md).
By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md). Security issues: [SECURITY.md](SECURITY.md).

## Disclaimer

- **Not financial advice.** TitanView is a charting and research tool. Signals, analysis, backtests, and
  paper results are not investment advice. Trading carries risk of loss; you alone are responsible for your decisions.
- **Market data.** TitanView does not provide or redistribute market data. It connects directly from your machine:
  - **Official public APIs (enabled by default):** Binance (spot candles, live WebSocket, order-flow footprint), Deribit (crypto options), and official statistical/central-bank calendars (TCMB, TÜİK, Fed, BLS, ECB, BEA, SPK).
  - **Unofficial endpoints (disabled by default — opt-in):** Yahoo Finance, Google News, and İş Yatırım (used for BIST/US equities, FX conversion, fundamentals, corporate events, and news) are **OFF by default** and no requests are sent to them until you explicitly review and accept responsibility for third-party terms of use in **Settings → Data sources** (or set `TITAN_UNOFFICIAL_SOURCES=1` / `-unofficial-sources` on headless servers). BIST data is ~15 minutes delayed.
- **Live orders** are opt-in, use your own API keys, and need explicit confirmation for each order. Use at your own risk.
- The software is provided "as is", without warranty of any kind (AGPL-3.0, sections 15 and 16).

## License

TitanView is free software under the **GNU Affero General Public License v3.0 or later** ([LICENSE](LICENSE)).
You may use, study, modify, and share it. If you distribute it, or run a modified version as a network service,
you must make your source code available under the same license. Third-party notices: [NOTICE](NOTICE).

---

## Türkçe

TitanView; **TitanScript** (`.titan`) betik motoru, strateji test cihazı, sunucu tarafı alarmları ve
paper trading'i olan **açık kaynak, yerel öncelikli** bir grafik ve analiz terminalidir. Masaüstünde
(macOS / Windows / Linux), Android'de ya da tarayıcıda çalışır; veriler senin bilgisayarında, SQLite'ta durur.

- **Betik uyumluluğu:** Başka platformlardan gelen uyumlu söz dizimindeki betikler (`//@version=5/6`, `indicator()`, `strategy()`, `library()`) az değişiklikle ya da hiç değişiklik yapmadan çalışır.
- **Kurulum:** [Releases](https://github.com/ersincebi/titanview/releases) sayfasından platformuna uygun paketi indir
  (`.dmg`, `.exe` / `.msi`, `.AppImage` / `.deb` / `.rpm`, Android için `.apk`). macOS'ta Homebrew komutları yukarıda.
  Android uygulaması mağazada değildir; APK sürüm sayfasından kurulur. Telefon motoru kendisi çalıştırır ya da
  kendi sunucuna (`titanview-server -remote`) bağlanır: [docs/mobile.md](docs/mobile.md).
- **Katkı:** Hata bildirimi, betik uyumluluk testleri, yeni gösterge/çizim aracı, veri
  sağlayıcısı ve çeviri katkılarına açığız. Başlangıç: [CONTRIBUTING.md](CONTRIBUTING.md) (Türkçe bölümü de var).
- **Bağımsızlık bildirimi:** TitanView'ın TradingView ile bağlantısı yoktur. TradingView® ve Pine Script®, TradingView, Inc.'in tescilli markalarıdır; bkz. [NOTICE](NOTICE).
- **Yatırım tavsiyesi değildir.** Gösterilen sinyal, analiz ve backtest sonuçları yatırım tavsiyesi değildir.
- **Veri:** TitanView veri dağıtmaz; üçüncü tarafların uç noktalarına senin bilgisayarından bağlanır.
  Resmî açık API'ler (Binance, Deribit, TCMB/TÜİK/Fed/BLS/ECB takvimleri) varsayılan açıktır. Resmî olmayan
  üçüncü taraf uç noktaları (Yahoo Finance, Google News, İş Yatırım — BIST/ABD hisseleri, kurlar, temel veriler,
  haberler) **varsayılan olarak kapalıdır**; **Ayarlar → Veri Kaynakları** üzerinden kullanım şartları
  sorumluluğunu onaylayarak (veya sunucuda `TITAN_UNOFFICIAL_SOURCES=1` ile) açılabilir. BIST verisi ~15 dk gecikmelidir.
- **Lisans:** AGPL-3.0 veya sonrası.
