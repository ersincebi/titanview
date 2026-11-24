#!/usr/bin/env node
// License & clean-room compliance gate across builtins, npm (runtime), Go, and Rust.
// Usage: node scripts/check-licenses.mjs [--require-go] [--require-rust]
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const args = new Set(process.argv.slice(2));
const requireGo = args.has('--require-go');
const requireRust = args.has('--require-rust');

// Licenses compatible with distributing TitanView under AGPL-3.0-or-later.
const ALLOWED = new Set([
  'MIT',
  'MIT-0',
  'Apache-2.0',
  'Apache-2.0 WITH LLVM-exception',
  'ISC',
  'BSD-2-Clause',
  'BSD-3-Clause',
  '0BSD',
  'Unlicense',
  'CC0-1.0',
  'Zlib',
  'MPL-2.0',
  'LGPL-2.1-or-later',
  'LGPL-3.0-or-later',
  'GPL-3.0-or-later',
  'AGPL-3.0-or-later',
  'Unicode-3.0',
  'CDLA-Permissive-2.0',
  'LicenseRef-MIT-Lucent', // goja/ftoa permissive Lucent/MIT notice
]);

function isAllowedSpdx(expr) {
  if (!expr || typeof expr !== 'string') return false;
  const s = expr.trim();
  if (ALLOWED.has(s)) return true;

  // Strip matching outer parentheses
  if (s.startsWith('(') && s.endsWith(')')) {
    let depth = 0;
    let wrapsWhole = true;
    for (let i = 0; i < s.length - 1; i++) {
      if (s[i] === '(') depth++;
      else if (s[i] === ')') depth--;
      if (depth === 0) {
        wrapsWhole = false;
        break;
      }
    }
    if (wrapsWhole) return isAllowedSpdx(s.slice(1, -1));
  }

  // Split top-level OR / slash alternatives (any branch allowed => compatible)
  const orParts = splitTopLevel(s, /\s+OR\s+|\s*\/\s*/);
  if (orParts.length > 1) return orParts.some(isAllowedSpdx);

  // Split top-level AND conjunctions (all parts must be allowed)
  const andParts = splitTopLevel(s, /\s+AND\s+/);
  if (andParts.length > 1) return andParts.every(isAllowedSpdx);

  return false;
}

function splitTopLevel(str, sepRe) {
  const parts = [];
  let depth = 0;
  let start = 0;
  const g = new RegExp(sepRe.source, 'g');
  for (let i = 0; i < str.length; i++) {
    if (str[i] === '(') depth++;
    else if (str[i] === ')') depth--;
    else if (depth === 0) {
      g.lastIndex = i;
      const m = g.exec(str);
      if (m && m.index === i) {
        parts.push(str.slice(start, i).trim());
        i += m[0].length - 1;
        start = i + 1;
      }
    }
  }
  parts.push(str.slice(start).trim());
  return parts.filter(Boolean);
}

let failures = 0;
function fail(msg) {
  console.error(`FAIL: ${msg}`);
  failures++;
}

// 1. Clean-room builtins check
{
  const dir = join(ROOT, 'frontend/src/script/builtins');
  const files = readdirSync(dir).filter((f) => f.endsWith('.titan') || f.endsWith('.ts'));
  for (const f of files) {
    const content = readFileSync(join(dir, f), 'utf8');
    if (/TradingView|©|TITAN v5\.2/i.test(content)) {
      fail(`builtins/${f} contains forbidden third-party or proprietary marker`);
    }
    if (!content.includes('SPDX-License-Identifier: AGPL-3.0-or-later')) {
      fail(`builtins/${f} missing SPDX-License-Identifier: AGPL-3.0-or-later`);
    }
  }
  console.log(`ok   builtins clean-room & SPDX (${files.length} files)`);
}

// 2. npm runtime licenses
{
  const raw = execFileSync('pnpm', ['licenses', 'list', '--prod', '--json'], { cwd: ROOT, encoding: 'utf8' });
  const byLic = JSON.parse(raw);
  let count = 0;
  for (const [lic, pkgs] of Object.entries(byLic)) {
    for (const p of pkgs) {
      count++;
      if (!isAllowedSpdx(lic)) {
        fail(`npm runtime package ${p.name} has unapproved license: ${lic}`);
      }
    }
  }
  console.log(`ok   npm runtime licenses (${count} packages)`);
}

// 3. Go module licenses (via go-licenses)
{
  let goLicensesBin = 'go-licenses';
  let found = true;
  try {
    execFileSync(goLicensesBin, ['--help'], { stdio: 'ignore' });
  } catch {
    const homeGoBin = join(process.env.HOME || '', 'go/bin/go-licenses');
    try {
      execFileSync(homeGoBin, ['--help'], { stdio: 'ignore' });
      goLicensesBin = homeGoBin;
    } catch {
      found = false;
    }
  }
  if (!found) {
    if (requireGo) fail('go-licenses not found (install github.com/google/go-licenses/v2)');
    else console.log('skip go-licenses not installed (pass --require-go to enforce)');
  } else {
    const out = execFileSync(goLicensesBin, ['report', './...'], {
      cwd: join(ROOT, 'backend'),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let checked = 0;
    for (const line of out.split('\n')) {
      if (!line.trim()) continue;
      const [pkg, , lic] = line.split(',');
      if (pkg.startsWith('github.com/ersincebi/titanview/')) continue;
      checked++;
      if (!isAllowedSpdx(lic)) {
        fail(`Go package ${pkg} has unapproved license: ${lic}`);
      }
    }
    console.log(`ok   Go dependency licenses (${checked} third-party packages)`);
  }
}

// 4. Rust crate licenses (src-tauri + wasm/titan-core)
{
  let hasCargo = true;
  try {
    execFileSync('cargo', ['--version'], { stdio: 'ignore' });
  } catch {
    hasCargo = false;
  }
  if (!hasCargo) {
    if (requireRust) fail('cargo not found');
    else console.log('skip cargo not installed (pass --require-rust to enforce)');
  } else {
    let checked = 0;
    for (const rel of ['src-tauri', 'wasm/titan-core']) {
      const raw = execFileSync('cargo', ['metadata', '--format-version', '1'], {
        cwd: join(ROOT, rel),
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
      });
      const meta = JSON.parse(raw);
      for (const pkg of meta.packages) {
        checked++;
        if (!isAllowedSpdx(pkg.license)) {
          fail(`Rust crate ${pkg.name}@${pkg.version} (${rel}) has unapproved license: ${pkg.license || '(none)'}`);
        }
      }
    }
    console.log(`ok   Rust crate licenses (${checked} packages across src-tauri & wasm/titan-core)`);
  }
}

if (failures > 0) {
  console.error(`\n${failures} license/compliance error(s) found.`);
  process.exit(1);
}
console.log('ALL license & clean-room checks passed.');
