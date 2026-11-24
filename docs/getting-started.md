# Getting Started with TitanView

Welcome to **TitanView** — an open-source, local-first charting and market analysis terminal. Everything runs on your own machine (or your own home server) with an embedded SQLite cache.

---

## 1. Install

### Pre-built binaries (Recommended)

Download the latest release for your OS from **[GitHub Releases](https://github.com/ersincebi/titanview/releases/latest)**:

| Platform | Download | Notes |
|---|---|---|
| **macOS (Apple Silicon)** | `TitanView_*_aarch64.dmg` | Or via Homebrew (below) |
| **macOS (Intel)** | `TitanView_*_x64.dmg` | Or via Homebrew (below) |
| **Windows 10/11** | `TitanView_*_x64-setup.exe` or `.msi` | Per-user installer |
| **Linux** | `.AppImage`, `.deb`, or `.rpm` | x86_64 |
| **Android 7.0+** | `TitanView-*-release.apk` | Sideload APK; see [mobile.md](mobile.md) |

> **First-launch OS warning:** Release binaries are not yet signed with paid Apple Developer / Windows Authenticode certificates. On macOS, right-click the app → **Open** (or allow it in *System Settings → Privacy & Security*). On Windows, click **More info → Run anyway** in SmartScreen.

### macOS via Homebrew

```bash
brew tap ersincebi/titanview https://github.com/ersincebi/titanview
brew install --cask titanview
```

### Docker (Self-hosted Web Terminal)

```bash
git clone https://github.com/ersincebi/titanview.git
cd titanview
docker compose up -d --build
# Open http://127.0.0.1:8098
```

### Build from Source

Requirements: **Node.js 20+**, **pnpm 10**, **Go 1.26+**, and **Rust stable** (only needed for WASM / Tauri desktop builds).

```bash
git clone https://github.com/ersincebi/titanview.git
cd titanview
pnpm install
make build
./backend/titanview-server --port 8080 --db data/titanview.db --static dist
# Open http://localhost:8080
```

For hot-reloading UI development, run `pnpm dev` alongside the Go server and open `http://localhost:5173`.

---

## 2. Official vs. Opt-In Data Sources

TitanView **never** runs a central data proxy and never redistributes market data. Requests go directly from your machine:

### Enabled by default (Official Public APIs)
- **Binance** — spot candles (including sub-minute intervals), live WebSocket ticks, trade tape, and order-flow volume footprint. TitanView opens on `BTCUSDT` out of the box.
- **Deribit** — public BTC & ETH crypto option chains.
- **Official Economic & IPO Calendars** — TCMB, TÜİK, Federal Reserve, BLS, ECB, BEA, and SPK.
- **Alert Channels** — user-configured webhooks, Telegram Bot API, ntfy push, and Web Push.

### Disabled by default (Opt-In Unofficial Endpoints)
Endpoints for **Yahoo Finance** (`yahoo.com`), **Google News** (`news.google.com`), and **İş Yatırım** (`isyatirim.com.tr`) — used for BIST/US equities, FX conversion, fundamentals, corporate events, and news — are **blocked at the Go HTTP transport layer by default**. Zero requests are sent to them unless you opt in:

- **In the UI:** Open **Menu → Data sources** (or **Settings ⚙ → Data sources**), read the third-party terms & responsibility notice, check the confirmation box, and click **Accept & Enable**.
- **On headless/Docker servers:** Set `TITAN_UNOFFICIAL_SOURCES=1` (or `0` to hard-lock off) or pass `--unofficial-sources` to `titanview-server`.

---

## 3. Remote Server Mode (Phone + Desktop Sync)

Run one always-on TitanView server on your home PC/VPS so your phone and laptop share the same SQLite database, watchlists, scripts, and server-side alerts:

```bash
./backend/titanview-server -remote -port 8080 -db data/titanview.db -static dist -public-url https://titan.example.com
```

On first start, TitanView generates a persistent random token in `data/remote_token` (mode `0600`) and prints a `titanview://pair?...` URI to `stderr`. Paste that URI into **Menu → Server** on your Android or desktop app to pair. See [mobile.md](mobile.md) for full details and `ntfy` push setup.

---

## 4. Keyboard Shortcuts

Press **`?`** anywhere in the terminal to view all keyboard shortcuts. Common essentials:

| Shortcut | Action |
|---|---|
| `⌘K` / `Ctrl+K` | Quick Search (symbols, indicators, tools, commands) |
| `⌘/` / `Ctrl+/` or `` ` `` | Command Bar (`DES`, `GP`, `HEAT`, `CORR`, `SCR`) |
| `⌘,` / `Ctrl+,` | Chart & Data Sources Settings |
| `Alt+D` | Toggle Dark / Light theme |
| `Alt+X` | Toggle Clean / Pro mode |
| `Alt+G` | Go to Date / Custom Range |
| `Cmd+Enter` / `Ctrl+Enter` | Apply TitanScript in editor to chart |
| `CmdOrCtrl+Shift+T` | Global show/hide window (Desktop app) |

---

## 5. Paper & Live Trading

- **Paper Trading** is built in with a local $100,000 simulated account, market/limit/stop/stop-limit orders, and draggable TP/SL brackets directly on the chart.
- **Live Orders (Binance)** are strictly opt-in: enter your own API key/secret in the Trade panel (encrypted locally at rest with a `0600` master key), preview every order, and confirm each execution explicitly.

---

## Türkçe Özet

- **Kurulum:** [GitHub Releases](https://github.com/ersincebi/titanview/releases/latest) sayfasından işletim sistemine uygun paketi (`.dmg`, `.exe`/`.msi`, `.AppImage`/`.deb`/`.rpm`, `.apk`) indir veya macOS'ta `brew install --cask titanview` ile kur.
- **Veri Kaynakları:** Binance, Deribit ve resmî ekonomik takvimler varsayılan açıktır; uygulama doğrudan canlı `BTCUSDT` ile açılır. BIST/ABD hisseleri ve haberler için kullanılan resmî olmayan uç noktalar (`yahoo.com`, `news.google.com`, `isyatirim.com.tr`) varsayılan kapalıdır; **Ayarlar → Veri Kaynakları** üzerinden sorumluluk onayını işaretleyerek açabilirsin.
- **Uzak Sunucu:** `titanview-server -remote` ile kendi sunucunda çalıştırıp telefon ve masaüstü uygulamalarını `titanview://pair?...` bağlantısıyla eşleştirebilirsin.
