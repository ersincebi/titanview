import { render } from 'solid-js/web';
import { desktopConfig, installDesktopBridge } from './desktop/bridge';
import { effectiveConfig, loadRemote, setActiveMode } from './desktop/remote';
import { registerServiceWorker } from './pwa/register';
import { App } from './ui/App';

// Faz 31: Tauri içinde arka uç istekleri rastgele portlu Go sidecar'a gider; servis işçisi yok.
// Faz 33: Android'de aynı köprü süreç içi Go çekirdeğine; uzak sunucu seçildiyse oraya gider.
const cfg = effectiveConfig(desktopConfig(), loadRemote());
const desktop = installDesktopBridge(window, cfg);
setActiveMode(cfg?.mode ?? null);
if (cfg?.platform === 'android') document.documentElement.classList.add('platform-android');

const root = document.getElementById('app');
if (root) {
  // index.html'deki açılış logosu kaldırılır; yoksa %100 yüksekliğiyle arayüzü aşağı iter (dar ekranlarda görünmez kalır).
  root.querySelector('.titan-splash')?.remove();
  render(() => <App />, root);
}
if (!desktop) registerServiceWorker();
