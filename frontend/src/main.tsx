// Yazı tipleri uygulamayla gelir (OFL-1.1): açılışta Google'a istek yok, çevrimdışı da çalışır.
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-ext-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-ext-500.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/inter/latin-ext-600.css';
import '@fontsource/inter/latin-700.css';
import '@fontsource/inter/latin-ext-700.css';
import '@fontsource/jetbrains-mono/latin-400.css';
import '@fontsource/jetbrains-mono/latin-ext-400.css';
import '@fontsource/jetbrains-mono/latin-500.css';
import '@fontsource/jetbrains-mono/latin-ext-500.css';
import '@fontsource/jetbrains-mono/latin-600.css';
import '@fontsource/jetbrains-mono/latin-ext-600.css';
import '@fontsource/jetbrains-mono/latin-700.css';
import '@fontsource/jetbrains-mono/latin-ext-700.css';
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
