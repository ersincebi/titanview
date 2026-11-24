#!/usr/bin/env node
// Faz 30 — performans hedeflerinin gerçek tarayıcıda ölçümü (tekrarlanabilir kanıt).
// Kurulu Google Chrome'u başsız (headless=new) açar, CDP ile uygulamanın window.__titanPerf kancalarını koşar.
// Kullanım: node scripts/perf30.mjs [http://127.0.0.1:8121] [--out perf.json]
// Ön koşul: sunucu çalışıyor (make start veya tv-server -static dist).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const BASE = args.find((a) => a.startsWith('http')) ?? 'http://127.0.0.1:8121';
const outIdx = args.indexOf('--out');
const OUT = outIdx >= 0 ? args[outIdx + 1] : null;
const CHROME =
  process.env.CHROME_BIN ??
  ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((p) => fs.existsSync(p));
if (!CHROME) throw new Error('Chrome bulunamadı (CHROME_BIN ayarlayın)');

const PORT = 9300 + Math.floor(Math.random() * 500);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'titan-perf-'));
const chrome = spawn(CHROME, [
  '--headless=new', '--js-flags=--max-old-space-size=1536', '--disk-cache-size=67108864', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--window-size=1440,900', '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
  'about:blank',
], { stdio: 'ignore' });

// Güvenlik: betik nasıl biterse bitsin (hata, Ctrl+C, zaman aşımı) Chrome kapanır ve profil silinir.
// (Faz 30 sırasında zaman aşımıyla öldürülen koşulardan kalan başsız Chrome'lar belleği doldurmuştu.)
let cleaned = false;
function cleanup() {
  if (cleaned) return;
  cleaned = true;
  try {
    chrome.kill('SIGKILL');
  } catch {}
  try {
    fs.rmSync(profile, { recursive: true, force: true });
  } catch {}
}
process.on('exit', cleanup);
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { cleanup(); process.exit(130); });
process.on('uncaughtException', (e) => { console.error(e); cleanup(); process.exit(1); });
const HARD_LIMIT_MS = Number(process.env.PERF_HARD_LIMIT_MS ?? 480_000);
setTimeout(() => { console.error(`perf30: ${HARD_LIMIT_MS} ms sınırı aşıldı, Chrome kapatılıyor`); cleanup(); process.exit(2); }, HARD_LIMIT_MS).unref();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function wsUrl() {
  for (let i = 0; i < 100; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      const page = list.find((t) => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(100);
  }
  throw new Error('CDP açılmadı');
}

let ws;
let seq = 0;
const waiters = new Map();
const events = [];
function send(method, params = {}) {
  const id = ++seq;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((res, rej) => waiters.set(id, { res, rej }));
}
async function evaluate(expr, timeoutMs = 180_000) {
  const r = await Promise.race([
    send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }),
    sleep(timeoutMs).then(() => ({ exceptionDetails: { text: 'zaman aşımı' } })),
  ]);
  if (r.exceptionDetails) throw new Error(`${expr.slice(0, 60)}: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
  return r.result.value;
}
async function load(url) {
  await send('Page.navigate', { url });
  for (let i = 0; i < 200; i++) {
    await sleep(100);
    const ok = await evaluate('!!(window.__titanPerf && window.__titanPerf.report && window.__titanPerf.report().interactiveMs)').catch(() => false);
    if (ok) return;
  }
  throw new Error('grafik yüklenmedi');
}
const report = () => evaluate('window.__titanPerf.report()');

try {
  ws = new WebSocket(await wsUrl());
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  ws.addEventListener('message', (m) => {
    const d = JSON.parse(m.data);
    if (d.id && waiters.has(d.id)) {
      waiters.get(d.id).res(d.result ?? { exceptionDetails: { text: d.error?.message } });
      waiters.delete(d.id);
    } else if (d.method) events.push(d.method);
  });
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });

  const result = { when: new Date().toISOString(), base: BASE, chrome: CHROME, cores: os.cpus().length };

  // 1) İlk açılış (önbellekli): ilk ziyaret önbelleği/SW'yi ısıtır, sonraki 5 yükleme ölçülür
  await load(`${BASE}/?lang=tr&symbol=BTCUSDT&interval=15m`);
  await evaluate("window.__titanPerf.style('candles')"); // §13 ölçümleri varsayılan mum stilinde
  await sleep(1500);
  const opens = [];
  for (let i = 0; i < 5; i++) {
    await load(`${BASE}/?lang=tr&symbol=BTCUSDT&interval=15m`);
    const r = await report();
    opens.push({ interactiveMs: r.interactiveMs, bars: r.firstBars });
  }
  result.firstOpen = { runs: opens, p50: [...opens.map((o) => o.interactiveMs)].sort((a, b) => a - b)[2], targetMs: 800 };

  // 2) 20 gösterge + 2 TitanScript strateji: tam hesap ve gerçek zamanlı tick yeniden hesabı
  await sleep(1500);
  const full = await evaluate('window.__titanPerf.recalc()');
  await evaluate('window.__titanPerf.recalcTick(1)');
  const ticks = [];
  for (let k = 2; k <= 21; k++) ticks.push((await evaluate(`window.__titanPerf.recalcTick(${k})`)).wallMs);
  const tickStats = await evaluate(`window.__titanPerf.stats(${JSON.stringify(ticks)})`);
  result.recalc = { bars: full.bars, scripts: full.scripts, fullMs: full.wallMs, tickMs: tickStats, targetMs: 50 };

  // 3) Tick → ekran: canlı Binance WS tick'leri (60 sn)
  await evaluate('(window.__titanPerf.state.tickToFrame.length = 0, window.__titanPerf.state.tickSync.length = 0, true)');
  await sleep(60_000);
  const r3 = await report();
  result.tickToScreen = { tickToFrame: r3.tickToFrame, tickSync: r3.tickSync, targetMs: 16 };

  // 4) 100k bar kaydırma / yakınlaştırma: gerçek BTCUSDT 1m geçmişi
  await load(`${BASE}/?lang=tr&symbol=BTCUSDT&interval=1m`);
  await evaluate("window.__titanPerf.open('BTCUSDT','1m')");
  await evaluate("window.__titanPerf.style('candles')"); // §13: varsayılan mum stili
  const bars = await evaluate('window.__titanPerf.loadBars(100000)', 300_000);
  await sleep(2000);
  const rounds = [];
  for (let i = 0; i < 3; i++) rounds.push(await evaluate('window.__titanPerf.scroll(300)'));
  await send('Performance.enable');
  const met = Object.fromEntries((await send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
  result.memory = { jsHeapUsedMB: Math.round(met.JSHeapUsedSize / 1048576), jsHeapTotalMB: Math.round(met.JSHeapTotalSize / 1048576), bars };
  const shot = await send('Page.captureScreenshot', { format: 'jpeg', quality: 70 });
  const sc = [...rounds].sort((a, b) => a.fps - b.fps)[1]; // ortanca tur
  result.scroll100k = {
    bars, fps: sc.fps, frameMs: sc.frameMs, framesOver20ms: sc.over20ms, frames: sc.frames, targetFps: 60,
    rounds: rounds.map((r) => ({ fps: r.fps, p95: r.frameMs.p95, max: r.frameMs.max, over20ms: r.over20ms })),
  };

  result.pass = {
    firstOpen: result.firstOpen.p50 < 800,
    recalcTick: result.recalc.tickMs.p95 < 50,
    tickToScreen: result.tickToScreen.tickToFrame.p50 < 16 && result.tickToScreen.tickToFrame.n > 0,
    scroll100k: bars >= 100_000 && sc.fps >= 55,
    memory: result.memory.jsHeapUsedMB < 1024,
  };
  const json = JSON.stringify(result, null, 2);
  console.log(json);
  if (OUT) {
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, json);
    fs.writeFileSync(OUT.replace(/\.json$/, '_100k.jpg'), Buffer.from(shot.data, 'base64'));
  }
} catch (e) {
  console.error('perf30 hata:', e);
  process.exitCode = 1;
} finally {
  try {
    ws?.close();
  } catch {}
  cleanup();
  process.exit(process.exitCode ?? 0);
}
