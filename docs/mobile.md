# Android uygulaması

TitanView'ın Android uygulaması masaüstüyle aynı Tauri v2 kabuğunu ve aynı arayüzü kullanır. Mağazada
yayımlanmaz; imzalı APK GitHub sürüm sayfasından indirilir.

## Kurulum

1. [Releases](https://github.com/ersincebi/titanview/releases) sayfasından `TitanView-universal-release.apk` dosyasını indir.
2. Telefonda indirdiğin tarayıcıya "bilinmeyen uygulamaları yükle" izni ver ve APK'yı aç.
3. İlk açılışta bildirim iznini onayla (alarmlar için).

Gereken: Android 7.0 (API 24) ve üzeri, arm64 ya da x86_64.

## İki çalışma modu

| Mod | Ne olur | Ne zaman |
|---|---|---|
| **Bu cihaz (yerel)**, varsayılan | Go sunucusu uygulamanın içinde (`libtitan.so`), `127.0.0.1` üzerinde rastgele portta ve açılış başına bir belirteçle çalışır. Veriler telefonda SQLite'ta tutulur. | Tek başına kullanım |
| **Uzak sunucu** | Arayüz, kendi makinende `titanview-server -remote` ile çalışan sunucuya bağlanır. Alarmlar, izleme listeleri ve stratejiler orada çalışır. | Masaüstü/ev sunucusuyla ortak veri, telefon kapalıyken de çalışan alarmlar |

Seçim: sol üst menü → **Sunucu**.

### Uzak sunucu kurulumu

```bash
# Ev sunucusunda / VPS'te
./titanview-server -remote -port 8080 -db data/titanview.db -static dist \
  -public-url https://titan.example.com
```

- İlk açılışta `data/remote_token` (0600) oluşturulur ve standart hataya bir eşleştirme bağlantısı yazılır:
  `titanview://pair?server=…&token=…`
- Telefonda Sunucu → Uzak sunucu → bağlantıyı yapıştır → Test → Kaydet.
- Belirteci yenilemek için `-remote-rotate` kullan. Bu, eşleşmiş tüm cihazları çıkarır.
- Tarayıcıdan aynı sunucuya girince açılan Sunucu penceresinde belirteçle oturum açılır (HttpOnly çerez).
- Belirteç `X-Titan-Token` başlığı, `Authorization: Bearer`, `titan_token` sorgusu ya da çerezle kabul edilir.
  Aynı adresten 10 dakikada 10 hatalı denemeden sonra istekler 429 ile reddedilir.
- CORS yalnız Tauri kökenlerine (`tauri://localhost`, `http(s)://tauri.localhost`) ve sunucunun kendi kökenine açıktır.
- Düz `http` yalnız güvendiğin ev ağında kullanılmalı. İnternete açacaksan önüne TLS koy (ör. Caddy, nginx).

## Bildirimler

| Kanal | Uygulama açıkken | Uygulama kapalıyken |
|---|---|---|
| Yerel mod | Rust izleyicisi alarm akışını dinler, Android bildirimi gösterir | Hayır: Android arka plandaki süreci durdurur |
| Uzak mod | Arayüz uzak sunucunun akışını dinler, kabuk Android bildirimi gösterir | ntfy ile evet |
| **ntfy** (alarm → Bildirimler → Telefona bildirim) | Evet | **Evet.** Sunucu `https://ntfy.sh/<konu>` (ya da kendi ntfy sunucun) adresine yollar, telefondaki ntfy uygulaması push olarak gösterir. Firebase ya da Google hesabı gerekmez. |

Konu adı tahmin edilemez olmalı: konuyu bilen herkes bildirimleri okuyabilir. Kendi ntfy sunucunda erişim belirteci kullan.

## Kaynaktan derleme

Gereken: Android SDK (platform 34+), NDK 27, JDK 17+, Rust Android hedefleri, Go, pnpm.

```bash
export ANDROID_HOME=~/Android/Sdk NDK_HOME=$ANDROID_HOME/ndk/27.2.12479018
rustup target add aarch64-linux-android x86_64-linux-android
pnpm install
node scripts/android-init.mjs              # src-tauri/gen/android üretir + ayarlar (gitignore)
pnpm tauri android build --debug --apk --target x86_64     # emülatör
pnpm tauri android build --apk --target aarch64 x86_64     # cihaz (imza: aşağıda)
pnpm tauri android dev                     # bağlı cihaz/emülatörde canlı geliştirme
```

- `scripts/build-mobile-core.mjs`: Go sunucusunu `-buildmode=c-shared` ile `libtitan.so` olarak derler
  (`backend/cmd/libtitan`, 16 KB sayfa hizalı). Tauri derlemesi bunu `beforeBuildCommand` ile kendiliğinden çağırır.
- `scripts/android-init.mjs`: `tauri android init`, simgeler, `src-tauri/android/` şablonları
  (MainActivity: kenardan kenara + sistem çubuğu boşluğu; ağ güvenliği; tema `#0284C7`), manifest izinleri ve imza ayarı.
- Paket kimliği `dev.titanview.mobile`, sürüm kodu `src-tauri/tauri.android.conf.json` içinde.
- `backend/mobile` paketi gomobile uyumludur: `gomobile bind -target=android ./mobile` bir `.aar` üretir.

## İmza

```bash
keytool -genkeypair -v -keystore titanview-release.jks -alias titanview -keyalg RSA -keysize 4096 -validity 10000
base64 -w0 titanview-release.jks   # → ANDROID_KEYSTORE_BASE64
```

GitHub → Settings → Secrets and variables → Actions:

| Sır | Değer |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | jks dosyasının base64 hâli |
| `ANDROID_KEYSTORE_PASSWORD` | anahtar deposu parolası |
| `ANDROID_KEY_ALIAS` | `titanview` |
| `ANDROID_KEY_PASSWORD` | anahtar parolası (boşsa depo parolası) |

Anahtar deposu kaybolursa kurulu uygulamalar yeni APK'yı güncelleme olarak kabul etmez; yedeğini al.
Sır yoksa CI yalnız debug APK üretir ve uyarı yazar.

## CI (`.github/workflows/mobile.yml`)

Her koşu: debug APK → Android 14 emülatörü (x86_64) → kurulum, açılış, dikey/yatay ekran görüntüsü,
uygulama günlüğünde `çekirdek başladı` denetimi. Yapıt: `titanview-android` (APK'lar, `SHA256SUMS-android.txt`,
`shots/`). Sürüm yayımlanınca imzalı release APK sürüme eklenir.
