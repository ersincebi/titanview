#!/usr/bin/env bash
# Uçtan uca duman testi: gerçek ikili + gerçek statik dosyalar, ağ gerektirmeyen uçlar.
# Kullanım: scripts/smoke.sh   (önce `pnpm build` ve `go build` gerekmez; script kendisi derler)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
PORT="${SMOKE_PORT:-8097}"
trap 'kill "${PID:-0}" 2>/dev/null || true; rm -rf "$TMP"' EXIT

[ -f "$ROOT/dist/index.html" ] || (cd "$ROOT" && pnpm build >/dev/null)
(cd "$ROOT/backend" && go build -o "$TMP/tv-server" ./cmd/server)
"$TMP/tv-server" -static "$ROOT/dist" -db "$TMP/x.db" -port "$PORT" >"$TMP/log" 2>&1 &
PID=$!
for _ in $(seq 1 50); do curl -sf "http://127.0.0.1:$PORT/api/cache-stats" >/dev/null && break; sleep 0.1; done

B="http://127.0.0.1:$PORT"
fail=0
check() { # ad, beklenen, gerçek
  if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FAIL $1: beklenen '$2', gelen '$3'"; fail=1; fi
}
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }

check "index.html"            200 "$(code "$B/")"
check "manifest"              200 "$(code "$B/manifest.webmanifest")"
check "service worker"        200 "$(code "$B/sw.js")"
check "sw.js no-cache"        "no-cache" "$(curl -sI "$B/sw.js" | tr -d '\r' | awk -F': ' 'tolower($1)=="cache-control"{print $2}' | cut -d, -f1)"
check "cache-stats"           200 "$(code "$B/api/cache-stats")"
check "symbols"               200 "$(code "$B/api/symbols?market=BIST")"
check "scripts list"          200 "$(code "$B/api/scripts")"
check "healthz"               200 "$(code "$B/healthz")"
check "sources kapalı (varsayılan)" 1 "$(curl -s "$B/api/sources" | grep -c '"unofficial":false')"
check "sources onaysız 400"   400 "$(code -X PUT -H 'Content-Type: application/json' -d '{"unofficial":true,"acceptTerms":false}' "$B/api/sources")"
check "unofficial kapalı 403" 403 "$(code "$B/api/history?symbol=THYAO.IS&interval=15m")"
check "sources onaylı 200"    200 "$(code -X PUT -H 'Content-Type: application/json' -d '{"unofficial":true,"acceptTerms":true}' "$B/api/sources")"
check "sources kapat 200"     200 "$(code -X PUT -H 'Content-Type: application/json' -d '{"unofficial":false}' "$B/api/sources")"
check "analysis sembolsüz 400" 400 "$(code "$B/api/analysis")"
check "quotes sembolsüz 400"   400 "$(code "$B/api/quotes")"
check "bilinmeyen api 404"    404 "$(code "$B/api/nope")"
# Go mux yolu temizleyip 307 verir; 400/404 de güvenli. Önemli olan: asla 200 + dosya içeriği olmaması.
tc="$(code --path-as-is "$B/../etc/passwd")"
if [ "$tc" = 200 ] || curl -s --path-as-is -L "$B/../../../etc/passwd" | grep -q '^root:'; then echo "FAIL yol gezintisi ($tc)"; fail=1; else echo "ok   yol gezintisi engelli ($tc)"; fi
check "history yanlış yöntem" 405 "$(code -X POST "$B/api/history")"
check "footprint satırsız 400"  400 "$(code "$B/api/footprint?symbol=BTCUSDT&interval=1m&times=60")"
check "footprint BIST desteklenmez" 1 "$(curl -s "$B/api/footprint?symbol=THYAO.IS&interval=15m&row=1&times=900" | grep -c '"supported":false')"

# yazma -> okuma -> silme turu (gerçek SQLite)
curl -sf -X POST "$B/api/scripts" -H 'Content-Type: application/json' -d '{"id":"smoke","name":"S","code":"x","isOverlay":true}' >/dev/null
check "script kaydedildi" 1 "$(curl -s "$B/api/scripts" | grep -c '"id":"smoke"')"
curl -sf -X DELETE "$B/api/scripts?id=smoke" >/dev/null
check "script silindi"    0 "$(curl -s "$B/api/scripts" | grep -c '"id":"smoke"' || true)"

# Faz 23: sunucu alarm motoru — oluştur → listele → durdur → sil, VAPID anahtarı, SSE akışı
AL=$(curl -sf -X POST "$B/api/alerts" -H 'Content-Type: application/json' -d '{"name":"smoke","symbol":"THYAO.IS","interval":"15m","condition":"crossing_up","target":{"kind":"value","value":1e9}}')
AID=$(printf '%s' "$AL" | sed -n 's/.*"id":"\(al_[0-9a-f]*\)".*/\1/p')
check "alarm oluşturuldu"   1 "$(printf '%s' "$AL" | grep -c '"status":"active"')"
check "alarm listede"       1 "$(curl -s "$B/api/alerts" | grep -c "\"$AID\"")"
check "alarm durdur"        1 "$(curl -s -X POST "$B/api/alerts/action?do=stop&id=$AID" | grep -c '"status":"stopped"')"
check "alarm geçersiz 400"  400 "$(code -X POST "$B/api/alerts" -H 'Content-Type: application/json' -d '{"symbol":"X","condition":"nope"}')"
check "alarm sil"           200 "$(code -X DELETE "$B/api/alerts?id=$AID")"
check "VAPID anahtarı"      1 "$(curl -s "$B/api/alerts/push/key" | grep -c '"publicKey":"B')"
check "alarm SSE akışı"     1 "$(curl -s -m 1 "$B/api/alerts/stream" | grep -c 'connected' || true)"

# Faz 25: çoklu kayıtlı düzen + paylaşılabilir salt-okur bağlantı + özel aralık 422 dürüst yanıtı
LAY=$(curl -sf -X POST "$B/api/layouts" -H 'Content-Type: application/json' -d '{"name":"smoke-4x4","gridId":"4x4","chartCount":16,"symbols":"BTCUSDT,ETHUSDT","state":{"layout":"4x4","symbol":"BTCUSDT","interval":"30s"}}')
LID=$(printf '%s' "$LAY" | sed -n 's/.*"id":"\(lay_[0-9a-f]*\)".*/\1/p')
check "düzen oluşturuldu"   1 "$(printf '%s' "$LAY" | grep -c '"chartCount":16')"
check "düzen listede"       1 "$(curl -s "$B/api/layouts" | grep -c "\"$LID\"")"
check "düzen adlandır"      1 "$(curl -s -X PUT "$B/api/layouts/$LID" -H 'Content-Type: application/json' -d '{"name":"smoke-pro"}' | grep -c '"smoke-pro"')"
CPY=$(curl -sf -X POST "$B/api/layouts/$LID/copy" -H 'Content-Type: application/json' -d '{"name":"smoke-kopya"}')
CID=$(printf '%s' "$CPY" | sed -n 's/.*"id":"\(lay_[0-9a-f]*\)".*/\1/p')
check "düzen kopya"         1 "$(printf '%s' "$CPY" | grep -c '"smoke-kopya"')"
SH=$(curl -sf -X POST "$B/api/layouts/$LID/share" -H 'Content-Type: application/json' -d '{"shared":true}')
STOK=$(printf '%s' "$SH" | sed -n 's/.*"shareToken":"\([^"]*\)".*/\1/p')
check "paylaşım salt-okur"  1 "$(curl -s "$B/api/layouts/shared/$STOK" | grep -c '"readOnly":true')"
curl -sf -X POST "$B/api/layouts/$LID/share" -H 'Content-Type: application/json' -d '{"shared":false}' >/dev/null
check "paylaşım kapalı 404" 404 "$(code "$B/api/layouts/shared/$STOK")"
check "düzen sil"           200 "$(code -X DELETE "$B/api/layouts/$LID")"
check "kopya sil"           200 "$(code -X DELETE "$B/api/layouts/$CID")"
check "Yahoo 5s 422"        422 "$(code "$B/api/history?symbol=THYAO.IS&interval=5s")"

# Faz 26: temel veriler, resmi ekonomik takvim + IPO kaynakları, BIST VİOP dürüst desteklenmiyor yanıtı
check "fundamentals sembolsüz 400" 400 "$(code "$B/api/fundamentals")"
check "fundamentals kripto desteklenmez" 1 "$(curl -s "$B/api/fundamentals?symbol=BTCUSDT" | grep -c '"supported":false')"
check "events kripto desteklenmez" 1 "$(curl -s "$B/api/events?symbol=BTCUSDT" | grep -c '"supported":false')"
check "events ifade desteklenmez" 1 "$(curl -s "$B/api/events?symbol=BTCUSDT/ETHUSDT" | grep -c '"supported":false')"
check "calendar TCMB resmi" 1 "$(curl -s "$B/api/calendar?country=TR" | grep -c '"institution":"TCMB"')"
check "calendar IPO SPK"    1 "$(curl -s "$B/api/calendar?country=TR" | grep -c 'spk.gov.tr')"
check "options BIST VİOP desteklenmez" 1 "$(curl -s "$B/api/options?symbol=THYAO.IS" | grep -c '"supported":false')"

# Faz 27: çoklu izleme listesi, 7 renk bayrak, notlar/günlük, kayıtlı tarayıcı ekranları, betik tarayıcı
check "watchlists varsayılan tohum" 1 "$(curl -s "$B/api/watchlists" | grep -c '"id":"wl_main"')"
WL=$(curl -sf -X POST "$B/api/watchlists" -H 'Content-Type: application/json' -d '{"name":"smoke-wl","items":[{"type":"section","title":"BANKA"},{"type":"symbol","symbol":"GARAN.IS"}]}')
WID=$(printf '%s' "$WL" | sed -n 's/.*"id":"\(wl_[0-9a-f]*\)".*/\1/p')
check "watchlist oluşturuldu" 1 "$(printf '%s' "$WL" | grep -c '"smoke-wl"')"
check "watchlist sil"         200 "$(code -X DELETE "$B/api/watchlists?id=$WID")"
check "bayrak 7 renk ata"     1 "$(curl -s -X PUT "$B/api/watchlists/flag" -H 'Content-Type: application/json' -d '{"symbol":"THYAO.IS","color":"red"}' | grep -c '"color":"red"')"
check "bayrak geçersiz 400"   400 "$(code -X PUT "$B/api/watchlists/flag" -H 'Content-Type: application/json' -d '{"symbol":"THYAO.IS","color":"neon"}')"
NT=$(curl -sf -X POST "$B/api/notes" -H 'Content-Type: application/json' -d '{"symbol":"THYAO.IS","title":"Smoke Not","body":"295 destek","tags":"Analiz","sentiment":"bull"}')
NID=$(printf '%s' "$NT" | sed -n 's/.*"id":"\(note_[0-9a-f]*\)".*/\1/p')
check "not oluşturuldu"       1 "$(curl -s "$B/api/notes?symbol=THYAO.IS" | grep -c "\"$NID\"")"
check "not sil"               200 "$(code -X DELETE "$B/api/notes?id=$NID")"
SP=$(curl -sf -X POST "$B/api/screener/presets" -H 'Content-Type: application/json' -d '{"name":"Smoke Tarayıcı","market":"BIST","timeframe":"1d","columnSet":"oscillators","config":{"filters":[]}}')
SPID=$(printf '%s' "$SP" | sed -n 's/.*"id":"\(scr_[0-9a-f]*\)".*/\1/p')
check "tarayıcı ekranı kayıt" 1 "$(curl -s "$B/api/screener/presets" | grep -c "\"$SPID\"")"
check "tarayıcı ekranı sil"   200 "$(code -X DELETE "$B/api/screener/presets?id=$SPID")"
check "betik tarayıcı boş kod 400" 400 "$(code -X POST "$B/api/screener/script" -H 'Content-Type: application/json' -d '{"code":""}')"
check "betik tarayıcı çalışır" 1 "$(curl -s -X POST "$B/api/screener/script" -H 'Content-Type: application/json' -d '{"code":"//@version=6\nindicator(\"s\")\nplot(close, \"Kapanış\")","timeframe":"15m","market":"BIST"}' | grep -c '"ok":true')"

# Cloudflare Access: yapılandırılınca belirteçsiz her şey 401, /healthz muaf; yarım yapılandırma açılışta reddedilir
# Faz 28: işlem uçları (ağ gerektirmeyenler)
J='Content-Type: application/json'
check "paper hesabı"             200 "$(code "$B/api/trading/paper")"
check "paper bakiye 100000"      1   "$(curl -s "$B/api/trading/paper" | grep -c '"balance":100000')"
check "paper geçersiz emir 400"  400 "$(code -X POST -H "$J" -d '{"symbol":"BTCUSDT","side":"buy","type":"limit","qty":1}' "$B/api/trading/paper/orders")"
check "paper bilinmeyen iptal 404" 404 "$(code -X DELETE "$B/api/trading/paper/orders?id=nope")"
check "paper sıfırla"            200 "$(code -X POST -H "$J" -d '{"initialBalance":25000,"commissionPct":0.1}' "$B/api/trading/paper/reset")"
check "paper sıfır sonrası"      1   "$(curl -s "$B/api/trading/paper" | grep -c '"balance":25000')"
check "binance anahtarsız"       1   "$(curl -s "$B/api/trading/binance" | grep -c '"configured":false')"
check "binance onaysız emir 400" 400 "$(code -X POST -H "$J" -d '{"token":"x"}' "$B/api/trading/binance/order")"
check "binance anahtarsız bakiye 412" 412 "$(code "$B/api/trading/binance/account")"
check "gizli ana anahtar 0600"   "600" "$(stat -c '%a' "$TMP/.titan_secret" 2>/dev/null || stat -f '%Lp' "$TMP/.titan_secret")"

APORT=$((PORT + 1))
CF_ACCESS_TEAM=smoke CF_ACCESS_AUD=smoke-aud "$TMP/tv-server" -static "$ROOT/dist" -db "$TMP/a.db" -port "$APORT" >"$TMP/alog" 2>&1 &
APID=$!
for _ in $(seq 1 50); do curl -sf "http://127.0.0.1:$APORT/healthz" >/dev/null && break; sleep 0.1; done
A="http://127.0.0.1:$APORT"
check "access: healthz muaf"       200 "$(code "$A/healthz")"
check "access: api belirteçsiz 401" 401 "$(code "$A/api/symbols")"
check "access: statik belirteçsiz 401" 401 "$(code "$A/")"
check "access: sahte JWT 401"      401 "$(code -H 'Cf-Access-Jwt-Assertion: a.b.c' "$A/api/symbols")"
kill "$APID" 2>/dev/null || true
if CF_ACCESS_TEAM=only "$TMP/tv-server" -static "$ROOT/dist" -db "$TMP/b.db" -port "$((PORT + 2))" >"$TMP/blog" 2>&1; then echo "FAIL yarım access yapılandırması açıldı"; fail=1; else echo "ok   yarım access yapılandırması reddedildi"; fi

# Faz 33: uzak sunucu modu (telefon/başka bilgisayar)
RPORT=$((PORT + 3))
mkdir -p "$TMP/remote"
"$TMP/tv-server" -remote -static "$ROOT/dist" -db "$TMP/remote/r.db" -port "$RPORT" -collect-interval 0 >"$TMP/rlog" 2>&1 &
RPID=$!
for _ in $(seq 1 50); do curl -sf "http://127.0.0.1:$RPORT/healthz" >/dev/null && break; sleep 0.1; done
R="http://127.0.0.1:$RPORT"
RT="$(tr -d '\n' < "$TMP/remote/remote_token" 2>/dev/null)"
check "remote: belirteç dosyası 0600"  "600" "$(stat -c '%a' "$TMP/remote/remote_token" 2>/dev/null || stat -f '%Lp' "$TMP/remote/remote_token")"
check "remote: eşleştirme bağlantısı"   1   "$(grep -c 'titanview://pair?' "$TMP/rlog")"
check "remote: api belirteçsiz 401"     401 "$(code "$R/api/symbols")"
check "remote: api belirteçle 200"      200 "$(code -H "X-Titan-Token: $RT" "$R/api/alerts/config")"
check "remote: Bearer 200"              200 "$(code -H "Authorization: Bearer $RT" "$R/api/alerts/config")"
check "remote: Android kökeni 200"      200 "$(code -H 'Origin: http://tauri.localhost' -H "X-Titan-Token: $RT" "$R/api/alerts/config")"
check "remote: yabancı köken 403"       403 "$(code -H 'Origin: https://evil.example' -H "X-Titan-Token: $RT" "$R/api/alerts/config")"
check "remote: giriş sayfası açık"      200 "$(code "$R/")"
check "remote: çerezle giriş 204"       204 "$(code -c "$TMP/rjar" -X POST -H "$J" -d "{\"token\":\"$RT\"}" "$R/api/remote/login")"
check "remote: çerezle api 200"         200 "$(code -b "$TMP/rjar" "$R/api/alerts/config")"
check "remote: ntfy yapılandırması"     200 "$(code -X PUT -H "$J" -H "X-Titan-Token: $RT" -d '{"telegram":{"enabled":false,"chatId":""},"ntfy":{"enabled":true,"topic":"titan-smoke-123"}}' "$R/api/alerts/config")"
check "remote: ntfy okunur"             1   "$(curl -s -H "X-Titan-Token: $RT" "$R/api/alerts/config" | grep -c '"topic":"titan-smoke-123"')"
kill "$RPID" 2>/dev/null || true

# derlenmiş paket gerçekten uygulamayı içeriyor
check "bundle JS var" 1 "$(ls "$ROOT"/dist/assets/*.js 2>/dev/null | head -1 | wc -l | tr -d ' ')"
exit $fail
