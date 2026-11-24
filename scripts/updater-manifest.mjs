#!/usr/bin/env node
// Faz 31: tauri-plugin-updater için latest.json üretir.
// Kullanım: node scripts/updater-manifest.mjs <yapıt-dizini> <sürüm> <indirme-kökü> [notlar]
// Yapıt dizininde her platformun güncelleme paketi + .sig dosyası aranır:
//   macOS:   *_aarch64.app.tar.gz / *_x64.app.tar.gz (+ .sig)
//   Windows: *_x64-setup.exe (+ .sig)   (NSIS; MSI yalnız kurulum için)
//   Linux:   *_amd64.AppImage (+ .sig)
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

export function walk(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

/** Dosya adından Tauri platform anahtarı. */
export function platformOf(name) {
  if (/\.app\.tar\.gz$/.test(name)) {
    if (/aarch64|arm64/.test(name)) return 'darwin-aarch64';
    if (/x64|x86_64/.test(name)) return 'darwin-x86_64';
    return null;
  }
  if (/-setup\.exe$/.test(name)) return /arm64|aarch64/.test(name) ? 'windows-aarch64' : 'windows-x86_64';
  if (/\.AppImage$/.test(name)) return /aarch64|arm64/.test(name) ? 'linux-aarch64' : 'linux-x86_64';
  return null;
}

export function buildManifest(files, version, baseUrl, notes = '', now = new Date()) {
  const platforms = {};
  for (const f of files) {
    const name = basename(f);
    const key = platformOf(name);
    if (!key) continue;
    const sig = files.find((x) => x === f + '.sig');
    if (!sig) continue;
    platforms[key] = { signature: readFileSync(sig, 'utf8').trim(), url: `${baseUrl.replace(/\/+$/, '')}/${encodeURIComponent(name)}` };
  }
  if (!Object.keys(platforms).length) throw new Error('imzalı güncelleme paketi bulunamadı');
  return { version: version.replace(/^v/, ''), notes, pub_date: now.toISOString(), platforms };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [dir, version, base, notes = ''] = process.argv.slice(2);
  if (!dir || !version || !base) {
    console.error('kullanım: updater-manifest.mjs <dizin> <sürüm> <indirme-kökü> [notlar]');
    process.exit(2);
  }
  const m = buildManifest(walk(dir), version, base, notes);
  writeFileSync(join(dir, 'latest.json'), JSON.stringify(m, null, 2) + '\n');
  console.log(`latest.json: ${Object.keys(m.platforms).join(', ')}`);
}
