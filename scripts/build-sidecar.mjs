#!/usr/bin/env node
// Faz 31: Go sunucusunu Tauri sidecar'ı olarak derler.
// Çıktı: src-tauri/binaries/titanview-server-<hedef-üçlüsü>[.exe]
// Hedef: TAURI_ENV_TARGET_TRIPLE (tauri build verir) > --target > rustc host.
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const argTarget = process.argv.includes('--target') ? process.argv[process.argv.indexOf('--target') + 1] : '';
const host = /host: (\S+)/.exec(execFileSync('rustc', ['-vV'], { encoding: 'utf8' }))?.[1];
const triple = process.env.TAURI_ENV_TARGET_TRIPLE || argTarget || host;
if (!triple) throw new Error('hedef üçlüsü bulunamadı');

const GOOS = triple.includes('apple-darwin') ? 'darwin' : triple.includes('windows') ? 'windows' : triple.includes('linux') ? 'linux' : null;
const GOARCH = triple.startsWith('x86_64') ? 'amd64' : triple.startsWith('aarch64') ? 'arm64' : null;
if (!GOOS || !GOARCH) throw new Error(`desteklenmeyen hedef: ${triple}`);

const ext = GOOS === 'windows' ? '.exe' : '';
const outDir = join(root, 'src-tauri', 'binaries');
mkdirSync(outDir, { recursive: true });
const out = join(outDir, `titanview-server-${triple}${ext}`);
const env = { ...process.env, GOOS, GOARCH, CGO_ENABLED: '1' };
// macOS'ta çapraz mimari (arm64 → amd64) clang -arch ile.
if (GOOS === 'darwin' && !process.env.CC) env.CC = `clang -arch ${GOARCH === 'amd64' ? 'x86_64' : 'arm64'}`;
if (GOOS === 'darwin') env.MACOSX_DEPLOYMENT_TARGET = env.MACOSX_DEPLOYMENT_TARGET || '11.0';
console.log(`sidecar: ${triple} (GOOS=${GOOS} GOARCH=${GOARCH}) → ${out}`);
execFileSync('go', ['build', '-trimpath', '-ldflags', '-s -w', '-o', out, './cmd/server'], {
  cwd: join(root, 'backend'),
  env,
  stdio: 'inherit',
});
