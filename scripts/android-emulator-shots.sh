#!/usr/bin/env bash
# Faz 33: debug APK'yı çalışan emülatöre kurar, açar, dikey + yatay ekran
# görüntüsü ve uygulama günlüğünü (çekirdek açılışı) toplar.
# Kullanım: scripts/android-emulator-shots.sh <apk> <çıktı-dizini>
set -euo pipefail
APK="$1"; OUT="$2"; PKG=dev.titanview.mobile
mkdir -p "$OUT"
adb wait-for-device
until [ "$(adb shell getprop sys.boot_completed | tr -d '\r')" = "1" ]; do sleep 2; done
# Yavaş CI emülatöründe "System UI yanıt vermiyor" penceresi ekranı kapatmasın
adb shell settings put global hide_error_dialogs 1 || true
sleep 30
adb shell am broadcast -a android.intent.action.CLOSE_SYSTEM_DIALOGS >/dev/null 2>&1 || true
adb install -r -g "$APK"
adb shell pm grant "$PKG" android.permission.POST_NOTIFICATIONS || true
adb logcat -c
adb shell am start -W -n "$PKG/.MainActivity"
# Grafik verisi ağdan gelir; açılışın oturmasını bekle.
sleep 60
adb shell am broadcast -a android.intent.action.CLOSE_SYSTEM_DIALOGS >/dev/null 2>&1 || true
sleep 2
adb exec-out screencap -p > "$OUT/android_portrait.png"
adb shell settings put system accelerometer_rotation 0
adb shell settings put system user_rotation 1
sleep 20
adb shell am broadcast -a android.intent.action.CLOSE_SYSTEM_DIALOGS >/dev/null 2>&1 || true
sleep 2
adb exec-out screencap -p > "$OUT/android_landscape.png"
adb shell settings put system user_rotation 0
sleep 5
# WebView durumu (debug APK'da uzaktan hata ayıklama açık)
PID="$(adb shell pidof "$PKG" | tr -d '\r')"
adb forward tcp:9222 "localabstract:webview_devtools_remote_${PID}" >/dev/null 2>&1 || true
node scripts/android-webview-probe.mjs 9222 > "$OUT/webview_probe.txt" 2>&1 || true
cat "$OUT/webview_probe.txt"
# Uygulama günlüğü (app_log_dir/desktop.log) + çökme izi
adb exec-out run-as "$PKG" cat logs/desktop.log > "$OUT/app_log.txt" 2>&1 || true
adb logcat -d -v time | grep -iE "titan|tauri|RustStdout|AndroidRuntime|FATAL" > "$OUT/logcat.txt" || true
adb shell dumpsys activity activities | grep -E "mResumedActivity|topResumedActivity" > "$OUT/activity.txt" || true
cat "$OUT/app_log.txt"
grep -q "çekirdek başladı" "$OUT/app_log.txt" || { echo "::error::çekirdek başlamadı"; cat "$OUT/logcat.txt" | tail -80; exit 1; }
grep -q "$PKG" "$OUT/activity.txt" || { echo "::error::uygulama önde değil (çöktü?)"; tail -80 "$OUT/logcat.txt"; exit 1; }
echo "ekran görüntüleri: $(ls "$OUT")"
