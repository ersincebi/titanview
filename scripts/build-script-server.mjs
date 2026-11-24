// Faz 23: TitanScript VM'i sunucu alarm motoru için tek IIFE paketine derler (goja ile Go içinde çalışır).
// Kullanım: node scripts/build-script-server.mjs [--check]
//   --check: diske yazmaz; paket güncel değilse çıkış kodu 1 (CI/test tazelik denetimi).
import { build } from 'esbuild';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const OUT = resolve(root, 'backend/internal/scriptjs/script_bundle.js');

export async function bundleScriptServer() {
  const res = await build({
    entryPoints: [resolve(root, 'frontend/src/script/serverEntry.ts')],
    bundle: true,
    format: 'iife',
    globalName: 'TitanScriptServer',
    // goja ES5.1 + ES2015'in çoğu: ?. ?? sınıf alanları vb. düşürülür
    target: 'es2017',
    platform: 'neutral',
    minify: true,
    legalComments: 'none',
    write: false,
    logLevel: 'silent',
    plugins: [
      {
        // goja'da WebAssembly yok: gömülü .wasm base64'ünü pakete katma (TS adımlayıcılar kullanılır)
        name: 'no-wasm-blob',
        setup(b) {
          b.onResolve({ filter: /titanCoreWasm$/ }, () => ({ path: resolve(root, 'frontend/src/script/wasm/titanCoreWasmStub.ts') }));
        },
      },
    ],
  });
  return res.outputFiles[0].text;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const code = await bundleScriptServer();
  if (process.argv.includes('--check')) {
    const cur = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
    if (cur !== code) {
      console.error('script_bundle.js güncel değil: node scripts/build-script-server.mjs çalıştırın');
      process.exit(1);
    }
    console.log('script_bundle.js güncel');
  } else {
    writeFileSync(OUT, code);
    console.log(`script_bundle.js yazıldı (${(code.length / 1024).toFixed(0)} KB)`);
  }
}
