// Faz 24: Rust → WASM çekirdeği (wasm/titan-core) derler ve base64 olarak TS'e gömer.
// Kullanım: node scripts/build-wasm.mjs [--check]
//   (varsayılan) cargo build --release --target wasm32-unknown-unknown → frontend/src/script/wasm/titanCoreWasm.ts
//   --check: cargo gerektirmez; gömülü ikili, Rust kaynaklarının özetiyle eşleşmiyorsa çıkış kodu 1 (build/test tazelik denetimi).
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { homedir } from 'node:os';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const crate = resolve(root, 'wasm/titan-core');
export const OUT = resolve(root, 'frontend/src/script/wasm/titanCoreWasm.ts');

export function sourceDigest() {
  const h = createHash('sha256');
  for (const f of ['Cargo.toml', 'src/lib.rs']) h.update(readFileSync(resolve(crate, f)));
  return h.digest('hex').slice(0, 16);
}

export function render(wasm, digest) {
  const b64 = wasm.toString('base64');
  return `// OTOMATİK ÜRETİLDİ: node scripts/build-wasm.mjs (wasm/titan-core Rust kaynağından). Elle düzenlemeyin.\nexport const TITAN_CORE_SOURCE_DIGEST = '${digest}';\nexport const TITAN_CORE_WASM_BASE64 =\n  '${b64}';\n`;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const digest = sourceDigest();
  if (process.argv.includes('--check')) {
    const cur = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
    if (!cur.includes(`'${digest}'`)) {
      console.error('titanCoreWasm.ts güncel değil: node scripts/build-wasm.mjs çalıştırın (Rust gerekir)');
      process.exit(1);
    }
    console.log('titanCoreWasm.ts güncel');
  } else {
    const env = { ...process.env, PATH: `${resolve(homedir(), '.cargo/bin')}:${process.env.PATH}` };
    const r = spawnSync('cargo', ['build', '--release', '--target', 'wasm32-unknown-unknown'], { cwd: crate, env, stdio: 'inherit' });
    if (r.status !== 0) process.exit(r.status ?? 1);
    const wasm = readFileSync(resolve(crate, 'target/wasm32-unknown-unknown/release/titan_core.wasm'));
    writeFileSync(OUT, render(wasm, digest));
    console.log(`titanCoreWasm.ts yazıldı (${wasm.length} bayt wasm)`);
  }
}
