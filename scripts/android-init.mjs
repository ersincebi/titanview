#!/usr/bin/env node
// Faz 33: Android projesini (src-tauri/gen/android, gitignore) üretir ve
// TitanView ayarlarını uygular. İdempotent; CI ve yerelde aynı.
//   - `tauri android init --ci` (yoksa)
//   - src-tauri/android/ şablonları: MainActivity (kenardan kenara + iç boşluk),
//     ağ güvenliği (127.0.0.1 + LAN http), tema/renkler (#0284C7)
//   - AndroidManifest: POST_NOTIFICATIONS, networkSecurityConfig, Android TV kaldırılır
//   - İmza: src-tauri/gen/android/keystore.properties varsa release APK imzalanır
//     (CI: ANDROID_KEYSTORE_BASE64 / ANDROID_KEYSTORE_PASSWORD / ANDROID_KEY_ALIAS / ANDROID_KEY_PASSWORD)
//   - Simgeler: `tauri icon src-tauri/icons/icon.png`
import { execFileSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const tauriDir = join(root, 'src-tauri');
const gen = join(tauriDir, 'gen', 'android');
const app = join(gen, 'app');
const run = (cmd, args) => execFileSync(cmd, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });

if (!existsSync(join(gen, 'app', 'build.gradle.kts'))) run('pnpm', ['tauri', 'android', 'init', '--ci']);
// Masaüstü simgelerine dokunmamak için çıktı geçici dizine; Android mipmap'leri gen/android'e yazılır.
const iconTmp = mkdtempSync(join(tmpdir(), 'titan-icons-'));
run('pnpm', ['tauri', 'icon', join('src-tauri', 'icons', 'icon.png'), '-o', iconTmp]);
rmSync(iconTmp, { recursive: true, force: true });

const tpl = join(tauriDir, 'android');
const javaDir = join(app, 'src', 'main', 'java', 'dev', 'titanview', 'mobile');
mkdirSync(javaDir, { recursive: true });
copyFileSync(join(tpl, 'MainActivity.kt'), join(javaDir, 'MainActivity.kt'));
cpSync(join(tpl, 'res'), join(app, 'src', 'main', 'res'), { recursive: true });

export function patchManifest(xml) {
  let out = xml.replace(/\s*<!-- AndroidTV support -->\s*<uses-feature android:name="android\.software\.leanback"[^>]*\/>/g, '');
  out = out.replace(/\s*<!-- AndroidTV support -->\s*<category android:name="android\.intent\.category\.LEANBACK_LAUNCHER" \/>/g, '');
  if (!out.includes('android.permission.POST_NOTIFICATIONS')) {
    out = out.replace(
      '<uses-permission android:name="android.permission.INTERNET" />',
      '<uses-permission android:name="android.permission.INTERNET" />\n    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />',
    );
  }
  if (!out.includes('android:networkSecurityConfig')) {
    out = out.replace('<application', '<application\n        android:networkSecurityConfig="@xml/network_security_config"');
  }
  return out;
}

const SIGNING = `
    signingConfigs {
        create("release") {
            val ks = rootProject.file("keystore.properties")
            if (ks.exists()) {
                val p = Properties().apply { ks.inputStream().use { load(it) } }
                keyAlias = p.getProperty("keyAlias")
                keyPassword = p.getProperty("keyPassword")
                storeFile = file(p.getProperty("storeFile"))
                storePassword = p.getProperty("storePassword")
            }
        }
    }
`;

export function patchGradle(kts) {
  if (kts.includes('signingConfigs {')) return kts;
  let out = kts.replace('    buildTypes {', `${SIGNING}    buildTypes {`);
  out = out.replace(
    '        getByName("release") {',
    '        getByName("release") {\n            if (rootProject.file("keystore.properties").exists()) {\n                signingConfig = signingConfigs.getByName("release")\n            }',
  );
  return out;
}

const manifest = join(app, 'src', 'main', 'AndroidManifest.xml');
writeFileSync(manifest, patchManifest(readFileSync(manifest, 'utf8')));
const gradle = join(app, 'build.gradle.kts');
writeFileSync(gradle, patchGradle(readFileSync(gradle, 'utf8')));

// CI imza sırları → keystore.properties (depoya girmez: gen/ gitignore)
const ksB64 = process.env.ANDROID_KEYSTORE_BASE64;
if (ksB64) {
  const ksPath = join(gen, 'titanview-release.jks');
  writeFileSync(ksPath, Buffer.from(ksB64, 'base64'));
  writeFileSync(
    join(gen, 'keystore.properties'),
    [
      `storeFile=${ksPath}`,
      `storePassword=${process.env.ANDROID_KEYSTORE_PASSWORD ?? ''}`,
      `keyAlias=${process.env.ANDROID_KEY_ALIAS ?? 'titanview'}`,
      `keyPassword=${process.env.ANDROID_KEY_PASSWORD ?? process.env.ANDROID_KEYSTORE_PASSWORD ?? ''}`,
      '',
    ].join('\n'),
  );
  console.log('android-init: release imzası etkin (keystore.properties)');
} else {
  console.log('android-init: UYARI ANDROID_KEYSTORE_BASE64 yok; release APK imzasız kalır (yalnız debug APK kurulabilir)');
}
console.log('android-init: tamam →', gen);
