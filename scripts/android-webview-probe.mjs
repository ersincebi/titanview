#!/usr/bin/env node
// Faz 33: Android debug APK'nın WebView'ine DevTools protokolüyle bağlanır,
// sayfa durumunu (köprü yapılandırması, arayüz kabuğu, bekleyen kaynaklar,
// çekirdek /healthz) yazdırır. Önce: adb forward tcp:<port> localabstract:webview_devtools_remote_<pid>
// Kullanım: node scripts/android-webview-probe.mjs <port>
const port = process.argv[2] || '9222';
const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = list.find((p) => p.type === 'page' && String(p.url).includes('tauri.localhost')) ?? list[0];
if (!page) throw new Error('WebView sayfası yok');
console.log('sayfa:', page.url);
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r, j) => ((ws.onopen = r), (ws.onerror = j)));
let id = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const m = JSON.parse(String(ev.data));
  if (m.id && pending.has(m.id)) pending.get(m.id)(m);
};
const call = (method, params = {}) =>
  new Promise((res) => {
    const i = ++id;
    pending.set(i, res);
    ws.send(JSON.stringify({ id: i, method, params }));
  });
const expr = `(async () => {
  const c = window.__TITAN_DESKTOP__;
  let health = 'yok';
  if (c) { try { health = String((await fetch(c.base + '/healthz', { headers: { 'X-Titan-Token': c.token } })).status); } catch (e) { health = 'hata: ' + e; } }
  const res = performance.getEntriesByType('resource').map((e) => ({ n: e.name.slice(0, 90), ms: Math.round(e.duration) }));
  return JSON.stringify({
    readyState: document.readyState,
    platform: c && c.platform,
    base: c && c.base,
    healthz: health,
    shell: !!document.querySelector('#titan-shell'),
    shellTop: Math.round(document.querySelector('#titan-shell')?.getBoundingClientRect().top ?? -1),
    splash: !!document.querySelector('.titan-splash'),
    classes: document.documentElement.className,
    width: innerWidth, height: innerHeight,
    ua: navigator.userAgent,
    slowest: res.sort((a, b) => b.ms - a.ms).slice(0, 6),
  }, null, 2);
})()`;
const r = await call('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
console.log(r.result?.result?.value ?? JSON.stringify(r.result ?? r.error));
ws.close();
