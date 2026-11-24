#!/usr/bin/env node
// Faz 33: Go sunucusunu Android için C kütüphanesi olarak derler
// (backend/cmd/libtitan, -buildmode=c-shared) → src-tauri/binaries/android/<abi>/libtitan.so
// ve varsa src-tauri/gen/android/app/src/main/jniLibs/<abi>/ altına kopyalar.
//
// Hedef: --abi arm64-v8a,x86_64 > TAURI_ENV_TARGET_TRIPLE (Android ise) > varsayılan arm64-v8a,x86_64
// NDK: ANDROID_NDK_HOME | NDK_HOME | $ANDROID_HOME/ndk/<en yeni>
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const API = process.env.TITAN_ANDROID_API || '24'; // minSdk ile aynı

const ABIS = {
  'arm64-v8a': { goarch: 'arm64', cc: 'aarch64-linux-android', triple: 'aarch64-linux-android' },
  x86_64: { goarch: 'amd64', cc: 'x86_64-linux-android', triple: 'x86_64-linux-android' },
  'armeabi-v7a': { goarch: 'arm', goarm: '7', cc: 'armv7a-linux-androideabi', triple: 'armv7-linux-androideabi' },
  x86: { goarch: '386', cc: 'i686-linux-android', triple: 'i686-linux-android' },
};

function ndkDir() {
  const direct = process.env.ANDROID_NDK_HOME || process.env.NDK_HOME;
  if (direct && existsSync(direct)) return direct;
  const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  if (sdk && existsSync(join(sdk, 'ndk'))) {
    const v = readdirSync(join(sdk, 'ndk')).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).pop();
    if (v) return join(sdk, 'ndk', v);
  }
  throw new Error('Android NDK bulunamadı: ANDROID_NDK_HOME ya da ANDROID_HOME/ndk/<sürüm> gerekli');
}

function wantedAbis() {
  const i = process.argv.indexOf('--abi');
  const t = process.env.TAURI_ENV_TARGET_TRIPLE;
  let list;
  if (i > 0) list = process.argv[i + 1].split(',');
  else if (t && t.includes('android')) {
    const hit = Object.entries(ABIS).find(([, v]) => v.triple === t);
    if (!hit) throw new Error(`desteklenmeyen Android hedefi: ${t}`);
    list = [hit[0]];
  } else list = ['arm64-v8a', 'x86_64'];
  for (const a of list) if (!ABIS[a]) throw new Error(`bilinmeyen ABI: ${a}`);
  return list;
}

const ndk = ndkDir();
const hostTag = process.platform === 'darwin' ? 'darwin-x86_64' : process.platform === 'win32' ? 'windows-x86_64' : 'linux-x86_64';
const bin = join(ndk, 'toolchains', 'llvm', 'prebuilt', hostTag, 'bin');

for (const abi of wantedAbis()) {
  const a = ABIS[abi];
  const outDir = join(root, 'src-tauri', 'binaries', 'android', abi);
  mkdirSync(outDir, { recursive: true });
  const out = join(outDir, 'libtitan.so');
  const env = {
    ...process.env,
    GOOS: 'android',
    GOARCH: a.goarch,
    CGO_ENABLED: '1',
    CC: join(bin, `${a.cc}${API}-clang${process.platform === 'win32' ? '.cmd' : ''}`),
  };
  if (a.goarm) env.GOARM = a.goarm;
  console.log(`mobil çekirdek: ${abi} (GOARCH=${a.goarch}) → ${out}`);
  // 16 KB sayfa hizası (Android 15+ cihazlar), soname yükleyici için sabit.
  execFileSync(
    'go',
    ['build', '-trimpath', '-buildmode=c-shared', '-ldflags', '-s -w -extldflags "-Wl,-soname,libtitan.so -Wl,-z,max-page-size=16384"', '-o', out, './cmd/libtitan'],
    { cwd: join(root, 'backend'), env, stdio: 'inherit' },
  );
  const jni = join(root, 'src-tauri', 'gen', 'android', 'app', 'src', 'main', 'jniLibs', abi);
  if (existsSync(join(root, 'src-tauri', 'gen', 'android'))) {
    mkdirSync(jni, { recursive: true });
    copyFileSync(out, join(jni, 'libtitan.so'));
  }
}
