# Masaüstü uygulaması (Tauri v2)

TitanView masaüstü uygulaması bir Tauri v2 kabuğu (`src-tauri/`) ve onun yönettiği Go sunucusundan (sidecar) oluşur.

## Mimari

- Kabuk `dist/` arayüzünü WebView'da açar; `frontend/src/desktop/bridge.ts` göreli `/api`, `/ws`, `/healthz` isteklerini
  sidecar'ın `http://127.0.0.1:<port>` adresine yönlendirir ve oturum belirtecini (`X-Titan-Token`) ekler.
- Sidecar `titanview-server -desktop -addr 127.0.0.1:0 -exit-on-stdin-eof` ile başlar; dinlediği adresi stdout'a
  `TITAN_LISTEN=127.0.0.1:P` satırıyla yazar. Ebeveyn kapanınca (stdin EOF) kendini kapatır; kabuk çıkışta çocuğu durdurur.
- Veri dizini (SQLite + `.titan_secret`):
  - macOS: `~/Library/Application Support/dev.titanview.desktop`
  - Windows: `%APPDATA%\dev.titanview.desktop`
  - Linux: `~/.local/share/dev.titanview.desktop`
- Günlük: macOS `~/Library/Logs/dev.titanview.desktop/desktop.log` (diğer platformlarda Tauri `app_log_dir()`).
- Tepsi menüsü: Göster/Gizle, Güncellemeleri denetle, Veri klasörünü aç, Çık. Pencere kapatma tepsiye gizler.
- Genel kısayol: `CmdOrCtrl+Shift+T` pencereyi göster/gizle.
- Alarm bildirimleri: kabuk sidecar'ın `/api/alerts/stream` SSE akışını dinler, her yeni alarm için bir işletim sistemi bildirimi gösterir.

## Kurulum

| Platform | Paket |
|---|---|
| macOS (Apple Silicon / Intel) | `.dmg` |
| Windows 10/11 | `.exe` (NSIS) veya `.msi` |
| Linux | `.AppImage`, `.deb`, `.rpm` |

Homebrew (macOS, ilk sürümden itibaren):

```bash
brew tap ersincebi/titanview https://github.com/ersincebi/titanview
brew install --cask titanview
```

Cask tanımı depo kökünde `Casks/titanview.rb`. Her sürümde `version` ve iki `sha256` (arm64 / x64 dmg) güncellenir;
değerler CI yapıtındaki `SHA256SUMS-<hedef>.txt` dosyasından alınır.

## Kaynaktan derleme

```bash
pnpm install
pnpm tauri build            # dist/ + Go sidecar (scripts/build-sidecar.mjs) + paket
pnpm tauri dev              # geliştirme
```

## CI (`.github/workflows/desktop.yml`)

Matris: `macos-latest` (aarch64 + x86_64), `windows-latest`, `ubuntu-22.04`. Faz 32 tamamlanana kadar yalnızca elle
(`gh workflow run desktop.yml`) koşar; `v*` etiketi itildiğinde taslak sürüm + `latest.json` üretir.

## İmza, notarization ve güncelleme sırları

Depoda hiçbir sır tutulmaz. Hepsi GitHub → Settings → Secrets and variables → Actions altında tanımlanır.
Bir sır yoksa ilgili adım uyarıyla atlanır ve imzasız (macOS'ta ad-hoc) paket üretilir.

| Sır | Amaç |
|---|---|
| `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Güncelleme paketlerinin minisign imzası |
| `APPLE_CERTIFICATE` (p12, base64), `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY` | macOS Developer ID kod imzası |
| `APPLE_ID`, `APPLE_PASSWORD` (uygulamaya özel parola), `APPLE_TEAM_ID` | macOS notarization |
| `WINDOWS_CERTIFICATE` (pfx, base64), `WINDOWS_CERTIFICATE_PASSWORD` | Windows Authenticode |

Güncelleme anahtarı üretimi (yalnızca bir kez, yerelde):

```bash
pnpm tauri signer generate -w ~/.tauri/titanview.key
```

Çıktıdaki açık anahtar `src-tauri/tauri.conf.json` → `plugins.updater.pubkey` alanına yazılır; özel anahtar ve parolası
GitHub Secrets'a girilir. Özel anahtar kaybolursa mevcut kurulumlar yeni sürümleri doğrulayamaz.

Sertifikaları base64'e çevirme:

```bash
base64 -i DeveloperID.p12 | pbcopy
```

## Otomatik güncelleme

Uç nokta GitHub Releases `latest.json`; `TITAN_UPDATE_URL` ortam değişkeniyle geçersiz kılınabilir (yalnız `https`).
Uygulama imzayı açık anahtarla doğrular; imzası tutmayan paket reddedilir.
