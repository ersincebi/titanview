import { createSignal } from 'solid-js';
import { APP_NAME, LANG_NAME } from '../script/brand';
import { EN } from './i18n_en';

export type Lang = 'tr' | 'en';

const LANG_KEY = 'titanview_lang_v1';

function detectInitialLang(): Lang {
  try {
    if (typeof window !== 'undefined') {
      const urlLang = new URLSearchParams(window.location.search).get('lang');
      if (urlLang === 'en' || urlLang === 'tr') return urlLang;
    }
    const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(LANG_KEY) : null;
    if (saved === 'en' || saved === 'tr') return saved;
  } catch {
    // ignore storage errors
  }
  return 'tr';
}

/** URL `?lang=` veya kalıcı tercih varsa çalışma alanındaki dil onu ezmez (yeniden yükleme döngüsü/karışık dil önlenir). */
export function langExplicit(): boolean {
  try {
    if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('lang')) return true;
    return typeof localStorage !== 'undefined' && !!localStorage.getItem(LANG_KEY);
  } catch {
    return false;
  }
}

const [lang, setLangSignal] = createSignal<Lang>(detectInitialLang());
export { lang };

// Sekme başlığı da dile uyar (index.html varsayılanı Türkçe).
if (typeof document !== 'undefined' && lang() === 'en') {
  document.title = `${APP_NAME} — Crypto, BIST (.IS) & US Charting & ${LANG_NAME} Terminal`;
  document.documentElement.lang = 'en';
}

export function setLang(next: Lang, opts: { reload?: boolean } = {}): void {
  const prev = lang();
  setLangSignal(next);
  if (typeof document !== 'undefined') {
    document.documentElement.lang = next;
  }
  try {
    localStorage.setItem(LANG_KEY, next);
  } catch {
    // ignore storage errors
  }
  // Faz 30: varsayılan olarak dil değişince sayfa yeniden yüklenir; modül düzeyindeki etiket tabloları
  // (araç adları, tarayıcı filtreleri, düzen şablonları…) böylece yeni dilde kurulur.
  // Çalışma alanı otomatik kaydedildiği için grafik durumu korunur. Testlerde yeniden yükleme yok.
  if (opts.reload !== false && prev !== next && typeof window !== 'undefined' && !import.meta.env?.VITEST && import.meta.env?.MODE !== 'test') {
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.has('lang')) url.searchParams.set('lang', next);
      window.setTimeout(() => window.location.replace(url.toString()), 60);
    } catch {
      // ignore
    }
  }
}

export function toggleLang(): Lang {
  const next: Lang = lang() === 'tr' ? 'en' : 'tr';
  setLang(next);
  return next;
}

export function localeTag(l: Lang = lang()): string {
  return l === 'en' ? 'en-US' : 'tr-TR';
}

export const MESSAGES: Record<string, { tr: string; en: string }> = {
  // TopBar
  'top.menu': { tr: 'Ana Menü', en: 'Main Menu' },
  'top.symbolSearch': { tr: 'Sembol Arama (⌘K)', en: 'Symbol Search (⌘K)' },
  'top.quickSearch': { tr: 'Hızlı Arama (⌘K)', en: 'Quick Search (⌘K)' },
  'top.compare': { tr: 'Grafik Üzerine Karşılaştırma Sembolü Ekle (XU100 / BTC)', en: 'Compare or Add Symbol' },
  'top.allTimeframes': { tr: 'Tüm Zaman Dilimleri ve Özel Aralıklar', en: 'All Timeframes & Custom Intervals' },
  'top.chartStyle': { tr: 'Grafik Stili (Mumlar, Çubuklar, HA)', en: 'Chart Style (Candles, Bars, HA)' },
  'top.indicators': { tr: 'Göstergeler', en: 'Indicators' },
  'top.indicatorsTitle': { tr: 'Tüm İndikatörler, Osilatörler ve Stratejiler (/)', en: 'Indicators, Metrics & Strategies (/)' },
  'top.favIndicators': { tr: 'Favori göstergeler', en: 'Favorite indicators' },
  'top.templates': { tr: 'Gösterge Şablonları', en: 'Indicator Templates' },
  'top.alert': { tr: 'Alarm', en: 'Alert' },
  'top.alertTitle': { tr: 'Alarm oluştur (Alt+A)', en: 'Create alert (Alt+A)' },
  'top.replay': { tr: 'Replay', en: 'Replay' },
  'top.replayStop': { tr: 'Durdur ⏹', en: 'Stop ⏹' },
  'top.replayTitle': { tr: 'Geçmiş Mumları Bar-Bar Oynat', en: 'Bar Replay' },
  'top.undo': { tr: 'Geri Al (⌘Z)', en: 'Undo (⌘Z)' },
  'top.redo': { tr: 'Yinele (⌘Y)', en: 'Redo (⌘Y)' },
  'top.layoutSave': { tr: 'Düzeni Kaydet (⌘S)', en: 'Save Layout (⌘S)' },
  'top.layoutManage': { tr: 'Düzenleri yönet (Adlandır, Kopyala, Paylaş, Aç)', en: 'Manage Layouts (Rename, Copy, Share, Open)' },
  'top.simpleMode': { tr: 'Sade', en: 'Clean' },
  'top.proMode': { tr: 'Pro', en: 'Pro' },
  'top.simpleOffTitle': { tr: 'Sade mod: gelişmiş analiz yüzeylerini gizle', en: 'Clean mode: hide advanced analysis surfaces' },
  'top.simpleOnTitle': { tr: 'Sade mod açık — yalın grafik görünümü (kapatmak için tıkla)', en: 'Clean mode active — minimal chart view (click to exit)' },
  'top.settings': { tr: 'Grafik Ayarları (⚙)', en: 'Chart Settings (⚙)' },
  'top.fullscreen': { tr: 'Tam Ekran (Shift+F)', en: 'Fullscreen Mode (Shift+F)' },
  'top.snapshot': { tr: 'Ekran Görüntüsü Al (Alt+S)', en: 'Take a Snapshot (Alt+S)' },
  'top.themeToLight': { tr: 'Açık temaya geç', en: 'Switch to light theme' },
  'top.themeToDark': { tr: 'Koyu temaya geç', en: 'Switch to dark theme' },
  'top.trade': { tr: 'İşlem', en: 'Trade' },
  'top.tradeTitle': { tr: 'İşlem paneli (Paper Trading)', en: 'Trading Panel (Paper & Binance)' },
  'top.langTitle': { tr: 'Dil: Türkçe / English', en: 'Language: English / Türkçe' },
  'top.styleSettings': { tr: 'Grafik tipi ayarları…', en: 'Chart type settings…' },
  'top.customIntervals': { tr: 'ÖZEL ARALIKLAR', en: 'CUSTOM INTERVALS' },
  'top.addCustomInterval': { tr: '+ ÖZEL ARALIK EKLE', en: '+ ADD CUSTOM INTERVAL' },
  'top.add': { tr: 'Ekle', en: 'Add' },

  // Main menu
  'menu.language': { tr: 'Dil / Language', en: 'Language' },
  'menu.colorTheme': { tr: 'Renk Teması', en: 'Color Theme' },
  'menu.darkLight': { tr: 'Koyu / Açık Tema', en: 'Dark / Light Theme' },
  'menu.shortcuts': { tr: 'Klavye Kısayolları', en: 'Keyboard Shortcuts' },
  'menu.settings': { tr: 'Grafik Ayarları…', en: 'Chart Settings…' },
  'menu.goToDate': { tr: 'Tarihe Git…', en: 'Go to Date…' },
  'menu.quickSearch': { tr: 'Hızlı Arama…', en: 'Quick Search…' },
  'menu.about': { tr: 'TitanView Hakkında', en: 'About TitanView' },
  'menu.fullscreen': { tr: 'Tam Ekran', en: 'Fullscreen' },

  // Snapshot menu
  'snap.download': { tr: 'Görüntüyü indir (PNG)', en: 'Download image (PNG)' },
  'snap.copyImage': { tr: 'Grafik görüntüsünü kopyala', en: 'Copy chart image' },
  'snap.copyLink': { tr: 'Grafik bağlantısını kopyala', en: 'Copy link to chart' },
  'snap.openTab': { tr: 'Görüntüyü yeni sekmede aç', en: 'Open image in new tab' },

  // LeftBar
  'left.cursor': { tr: 'İmleç (Crosshair)', en: 'Crosshair' },
  'left.ruler': { tr: 'Cetvel: Fiyat %, Bar Sayısı ve Hacim Ölçer (Shift+Click)', en: 'Measure (Shift+Click)' },
  'left.zoomIn': { tr: 'Yakınlaştır (Kutu sürükle) (Alt+Z)', en: 'Zoom In (Drag box) (Alt+Z)' },
  'left.zoomOut': { tr: 'Uzaklaştır (-)', en: 'Zoom Out (-)' },
  'left.magnet': { tr: 'Mıknatıs', en: 'Magnet Mode' },
  'left.magnetWeak': { tr: 'Zayıf Mıknatıs', en: 'Weak Magnet' },
  'left.magnetStrong': { tr: 'Güçlü Mıknatıs', en: 'Strong Magnet' },
  'left.stayDrawing': { tr: 'Çizim Modunda Kal', en: 'Stay in Drawing Mode' },
  'left.lockAll': { tr: 'Tüm Çizim Araçlarını Kilitle', en: 'Lock All Drawing Tools' },
  'left.hideDrawings': { tr: 'Çizimleri Gizle / Göster', en: 'Hide / Show Drawings' },
  'left.clearDrawings': { tr: 'Çizimleri Temizle', en: 'Remove Drawings' },
  'left.favBar': { tr: 'Favori Çizim Araçları Çubuğunu Göster', en: 'Show Favorite Drawing Tools Toolbar' },
  'left.icons': { tr: 'İkonlar ve Emojiler', en: 'Icons & Emojis' },

  // Legend & ChartArea
  'leg.open': { tr: 'A', en: 'O' },
  'leg.high': { tr: 'Y', en: 'H' },
  'leg.low': { tr: 'D', en: 'L' },
  'leg.close': { tr: 'K', en: 'C' },
  'leg.volume': { tr: 'Hacim', en: 'Vol' },
  'leg.noData': { tr: 'Veri yok', en: 'No data' },
  'leg.sell': { tr: 'SAT', en: 'SELL' },
  'leg.buy': { tr: 'AL', en: 'BUY' },
  'leg.loaded': { tr: 'yüklü', en: 'loaded' },
  'leg.loading': { tr: 'Yükleniyor…', en: 'Loading…' },
  'leg.loadError': { tr: 'Veri alınamadı', en: 'Failed to load data' },

  // AxisFooter
  'axis.fit': { tr: 'Sığdır', en: 'Fit' },
  'axis.fitTitle': { tr: 'Tüm Veriyi Ekrana Sığdır (Alt+R)', en: 'Reset Chart View (Alt+R)' },
  'axis.goToDate': { tr: 'Tarihe Git (Alt+G)', en: 'Go to Date (Alt+G)' },
  'axis.timezone': { tr: 'Zaman Dilimi', en: 'Timezone' },
  'axis.session': { tr: 'Seans (Normal / Uzatılmış)', en: 'Session (Regular / Extended)' },
  'axis.rth': { tr: 'RTH', en: 'RTH' },
  'axis.eth': { tr: 'EXT', en: 'EXT' },
  'axis.auto': { tr: 'oto', en: 'auto' },
  'axis.autoTitle': { tr: 'Otomatik Ölçek', en: 'Auto Scale' },
  'axis.logTitle': { tr: 'Logaritmik Fiyat Ölçeği (Alt+L)', en: 'Logarithmic Scale (Alt+L)' },
  'axis.pctTitle': { tr: 'Yüzdesel Fiyat Ölçeği (Alt+P)', en: 'Percentage Scale (Alt+P)' },
  'axis.idxTitle': { tr: "İndeksli (100'e) Fiyat Ölçeği (Alt+O)", en: 'Indexed to 100 Scale (Alt+O)' },
  'axis.lockTitle': { tr: 'Ölçeği Kilitle (fiyat/bar oranı sabit)', en: 'Lock Price to Bar Ratio' },
  'axis.currencyHead': { tr: 'PARA BİRİMİ DÖNÜŞTÜR', en: 'CONVERT CURRENCY' },
  'axis.rangeAll': { tr: 'Tümü', en: 'All' },

  // Context Menus (all 5)
  'ctx.addAlertAt': { tr: '⏰ {sym} için {price} alarmı ekle…', en: '⏰ Add alert on {sym} at {price}…' },
  'ctx.addOrderAt': { tr: '⚡ {sym} için {price} limit/stop emri…', en: '⚡ Add order on {sym} at {price}…' },
  'ctx.addHLine': { tr: '― {price} seviyesine yatay çizgi', en: '― Add horizontal line at {price}' },
  'ctx.copyPrice': { tr: '⧉ Fiyatı kopyala ({price})', en: '⧉ Copy price ({price})' },
  'ctx.pasteDrawing': { tr: '📋 Çizimi yapıştır', en: '📋 Paste drawing' },
  'ctx.addIndicator': { tr: 'ƒx Gösterge / strateji ekle…', en: 'ƒx Add indicator / strategy…' },
  'ctx.symbolInfo': { tr: 'ℹ Sembol bilgisi (Künye)…', en: 'ℹ Symbol info…' },
  'ctx.goToDate': { tr: '📅 Tarihe git…', en: '📅 Go to date…' },
  'ctx.fit': { tr: '⤢ Grafiği sığdır / sıfırla', en: '⤢ Reset chart view' },
  'ctx.invertOn': { tr: '⇅ Ters ölçek', en: '⇅ Invert scale' },
  'ctx.invertOff': { tr: '⇅ Ters ölçeği kapat', en: '⇅ Disable invert scale' },
  'ctx.hideDrawings': { tr: 'Çizimleri gizle', en: 'Hide drawings' },
  'ctx.showDrawings': { tr: 'Çizimleri göster', en: 'Show drawings' },
  'ctx.objectTree': { tr: '🌳 Nesne ağacı…', en: '🌳 Object tree…' },
  'ctx.addWatchlist': { tr: '★ {sym} izleme listesine ekle', en: '★ Add {sym} to watchlist' },
  'ctx.addNote': { tr: '📝 {sym} için not ekle', en: '📝 Add note for {sym}' },
  'ctx.settings': { tr: '⚙ Ayarlar…', en: '⚙ Settings…' },

  // Price Scale Context Menu
  'ctx.scale.auto': { tr: 'Otomatik (veriyi ekrana sığdır)', en: 'Auto (fits data to screen)' },
  'ctx.scale.lock': { tr: 'Fiyat / bar oranını kilitle', en: 'Lock price to bar ratio' },
  'ctx.scale.invert': { tr: 'Ters ölçek', en: 'Invert scale' },
  'ctx.scale.regular': { tr: 'Normal', en: 'Regular' },
  'ctx.scale.percent': { tr: 'Yüzde', en: 'Percent' },
  'ctx.scale.indexed': { tr: "100'e indeksli", en: 'Indexed to 100' },
  'ctx.scale.log': { tr: 'Logaritmik', en: 'Logarithmic' },
  'ctx.scale.moveLeft': { tr: 'Ölçeği sola taşı', en: 'Move scale to left' },
  'ctx.scale.moveRight': { tr: 'Ölçeği sağa taşı', en: 'Move scale to right' },
  'ctx.scale.countdown': { tr: 'Bar kapanışına geri sayım', en: 'Countdown to bar close' },
  'ctx.scale.highLow': { tr: 'Yüksek / düşük fiyat çizgileri', en: 'High and low price lines' },
  'ctx.scale.lastLine': { tr: 'Son fiyat çizgisi', en: 'Symbol last price line' },
  'ctx.scale.more': { tr: 'Daha fazla ölçek ayarı…', en: 'More settings…' },

  // Drawing Context Menu
  'ctx.draw.settings': { tr: '⚙ Stil / özellikler', en: '⚙ Settings / Style' },
  'ctx.draw.clone': { tr: '⧉ Çoğalt', en: '⧉ Clone' },
  'ctx.draw.copy': { tr: '📋 Kopyala', en: '📋 Copy' },
  'ctx.draw.lock': { tr: '🔒 Kilitle', en: '🔒 Lock' },
  'ctx.draw.unlock': { tr: '🔓 Kilidi aç', en: '🔓 Unlock' },
  'ctx.draw.hide': { tr: '◌ Gizle', en: '◌ Hide' },
  'ctx.draw.show': { tr: '👁 Göster', en: '👁 Show' },
  'ctx.draw.front': { tr: '↑ En öne getir', en: '↑ Bring to front' },
  'ctx.draw.back': { tr: '↓ En arkaya gönder', en: '↓ Send to back' },
  'ctx.draw.forward': { tr: '↗ Bir öne getir', en: '↗ Bring forward' },
  'ctx.draw.backward': { tr: '↘ Bir arkaya gönder', en: '↘ Send backward' },
  'ctx.draw.alert': { tr: '⏰ Bu çizime alarm ekle…', en: '⏰ Add alert on drawing…' },
  'ctx.draw.defaultTpl': { tr: '↺ Varsayılan şablonu uygula', en: '↺ Apply default template' },
  'ctx.draw.remove': { tr: '✕ Çizimi sil', en: '✕ Remove' },

  // Study Context Menu
  'ctx.study.settings': { tr: '⚙ Ayarlar…', en: '⚙ Settings…' },
  'ctx.study.alert': { tr: '⏰ Göstergeye alarm ekle…', en: '⏰ Add alert on indicator…' },
  'ctx.study.hide': { tr: '◌ Gizle', en: '◌ Hide' },
  'ctx.study.show': { tr: '👁 Göster', en: '👁 Show' },
  'ctx.study.duplicate': { tr: '⧉ Çoğalt', en: '⧉ Duplicate' },
  'ctx.study.moveMain': { tr: '⬒ Ana grafiğe taşı', en: '⬒ Move to main pane' },
  'ctx.study.moveNew': { tr: '⬓ Yeni alt panele taşı', en: '⬓ Move to new pane below' },
  'ctx.study.pinRight': { tr: 'Sağ ölçeğe sabitle', en: 'Pin to right scale' },
  'ctx.study.pinLeft': { tr: 'Sol ölçeğe sabitle', en: 'Pin to left scale' },
  'ctx.study.pinNone': { tr: 'Ölçeğe sabitleme (eksensiz)', en: 'No scale (overlay)' },
  'ctx.study.remove': { tr: '✕ Kaldır', en: '✕ Remove' },

  // Series Context Menu
  'ctx.series.settings': { tr: '⚙ Sembol ayarları…', en: '⚙ Symbol settings…' },
  'ctx.series.change': { tr: '🔍 Sembol değiştir…', en: '🔍 Change symbol…' },
  'ctx.series.compare': { tr: '＋ Karşılaştır veya sembol ekle…', en: '＋ Compare or add symbol…' },
  'ctx.series.info': { tr: 'ℹ Sembol bilgisi (Künye)', en: 'ℹ Symbol info' },
  'ctx.series.alert': { tr: '⏰ Alarm ekle…', en: '⏰ Add alert…' },
  'ctx.series.reset': { tr: '⤢ Grafiği sıfırla', en: '⤢ Reset chart view' },

  // Settings Modal (7 tabs)
  'cfg.title': { tr: 'Ayarlar', en: 'Settings' },
  'cfg.tab.symbol': { tr: 'Sembol', en: 'Symbol' },
  'cfg.tab.status': { tr: 'Durum Çizgisi', en: 'Status line' },
  'cfg.tab.scales': { tr: 'Ölçekler ve Çizgiler', en: 'Scales and lines' },
  'cfg.tab.canvas': { tr: 'Tuval', en: 'Canvas' },
  'cfg.tab.trading': { tr: 'İşlem', en: 'Trading' },
  'cfg.tab.alerts': { tr: 'Alarmlar', en: 'Alerts' },
  'cfg.tab.events': { tr: 'Olaylar', en: 'Events' },
  'cfg.tab.sources': { tr: 'Veri Kaynakları', en: 'Data sources' },
  'cfg.sources.openBtn': { tr: 'Veri Kaynaklarını Aç', en: 'Open Data Sources' },
  'cfg.sources.disabledMsg': {
    tr: 'Resmî olmayan veri kaynakları (Yahoo Finance, Google News, İş Yatırım) kapalı. BIST/ABD hisseleri, kurlar ve haberler için Ayarlar → Veri Kaynakları bölümünden kullanım şartlarını onaylayarak açabilirsin.',
    en: 'Unofficial data sources (Yahoo Finance, Google News, İş Yatırım) are disabled. Enable them in Settings → Data sources after reviewing and accepting responsibility for their terms of use.',
  },
  'cfg.template': { tr: 'Şablon', en: 'Template' },
  'cfg.applyDefaults': { tr: 'Varsayılanları uygula', en: 'Apply defaults' },
  'cfg.saveAs': { tr: 'Farklı kaydet…', en: 'Save as…' },
  'cfg.cancel': { tr: 'İptal', en: 'Cancel' },
  'cfg.ok': { tr: 'Tamam', en: 'Ok' },
  'cfg.defaults': { tr: 'Varsayılan', en: 'Defaults' },

  // Modals: Go to Date, Shortcuts, Quick Search, Replay
  'goto.title': { tr: 'Tarihe Git', en: 'Go to' },
  'goto.tabDate': { tr: 'Tarih', en: 'Date' },
  'goto.tabRange': { tr: 'Özel Aralık', en: 'Custom range' },
  'goto.date': { tr: 'Tarih', en: 'Date' },
  'goto.time': { tr: 'Saat', en: 'Time' },
  'goto.from': { tr: 'Başlangıç', en: 'From' },
  'goto.to': { tr: 'Bitiş', en: 'To' },
  'goto.go': { tr: 'Git', en: 'Go to' },
  'shortcuts.title': { tr: 'Klavye Kısayolları', en: 'Keyboard Shortcuts' },
  'shortcuts.search': { tr: 'Kısayol ara (örn. trend, ölçek, geri al, alarm)...', en: 'Search shortcuts (e.g. trend, scale, undo, alert)...' },
  'qsearch.placeholder': {
    tr: 'Sembol, İfade, Gösterge, Araç veya Komut Ara (örn: THYAO.IS, RSI, Trend, Ayarlar)...',
    en: 'Search Symbol, Expression, Indicator, Tool, or Command...',
  },
  'qsearch.all': { tr: 'Hızlı Arama', en: 'Quick Search' },
  'qint.title': { tr: 'Zaman Aralığını Değiştir', en: 'Change interval' },
  'qint.hint': { tr: 'Örn: 15 (15dk), 1h (1 saat), 4h, 1d, 1w, 1M, 30s', en: 'e.g. 15 (15m), 1h, 4h, 1d, 1w, 1M, 30s' },

  // ReplayBar
  'replay.play': { tr: 'Oynat (Space)', en: 'Play (Space)' },
  'replay.pause': { tr: 'Duraklat (Space)', en: 'Pause (Space)' },
  'replay.step': { tr: 'Bir mum ileri (Shift+↓)', en: 'Step forward (Shift+↓)' },
  'replay.speed': { tr: 'Oynatma hızı', en: 'Playback speed' },
  'replay.pickDate': { tr: 'Tarih seç', en: 'Select date' },
  'replay.random': { tr: 'Rastgele bar', en: 'Random bar' },
  'replay.realtime': { tr: 'Gerçek zaman', en: 'Jump to real-time' },
  'replay.close': { tr: "Replay'i kapat", en: 'Exit Replay' },

  // Workbench & Drawer titles
  'wb.script': { tr: 'Betik Editörü', en: 'Script Editor' },
  'wb.backtest': { tr: 'Strateji Testi', en: 'Strategy Tester' },
  'wb.screener': { tr: 'Tarayıcı', en: 'Screener' },
  'wb.financials': { tr: 'Finansallar', en: 'Financials' },
  'wb.calendar': { tr: 'Takvim', en: 'Calendar' },
  'wb.options': { tr: 'Opsiyonlar', en: 'Options' },
  'wb.analysis': { tr: 'Analiz', en: 'Analysis' },
  'wb.market': { tr: 'Piyasa', en: 'Markets' },
  'wb.corr': { tr: 'Korelasyon', en: 'Correlation' },
  'wb.des': { tr: 'Künye', en: 'Overview' },
  'wb.news': { tr: 'Haber', en: 'News' },
  'wb.whale': { tr: 'Balina', en: 'Whales' },
  'wb.ideas': { tr: 'Fikirler', en: 'Ideas' },
  'wb.paper': { tr: 'Paper Trading', en: 'Trading Panel' },
  'drawer.watchlist': { tr: 'İzleme Listesi', en: 'Watchlist' },
  'drawer.alerts': { tr: 'Alarmlar', en: 'Alerts' },
  'drawer.news': { tr: 'Haberler & Gündem', en: 'News' },
  'drawer.datawindow': { tr: 'Veri Penceresi', en: 'Data Window' },
  'drawer.hotlists': { tr: 'Sıcak Listeler', en: 'Top movers' },
  'drawer.calendar': { tr: 'Ekonomik Takvim', en: 'Calendar' },
  'drawer.notes': { tr: 'Notlar & Günlük', en: 'Notes & Journal' },
  'drawer.ideas': { tr: 'Notlar & Günlük', en: 'Notes & Journal' },
  'drawer.chats': { tr: 'Notlar & Günlük', en: 'Notes & Journal' },
  'drawer.notifications': { tr: 'Bildirimler', en: 'Notifications' },
  'drawer.orderpanel': { tr: 'Emir Paneli', en: 'Order Panel' },
  'drawer.objecttree': { tr: 'Nesne Ağacı', en: 'Object Tree' },
  'drawer.help': { tr: 'Yardım & Kısayollar', en: 'Help & Shortcuts' },
  'drawer.details': { tr: 'Detaylar', en: 'Details' },

  // Mobile nav
  'mob.chart': { tr: 'Grafik', en: 'Chart' },
  'mob.tools': { tr: 'Çizim', en: 'Draw' },
  'mob.indicators': { tr: 'fx', en: 'fx' },
  'mob.watchlist': { tr: 'Liste', en: 'Watchlist' },
  'mob.workbench': { tr: 'Panel', en: 'Panel' },
  'mob.more': { tr: 'Daha', en: 'More' },

  // Banners
  'banner.offline': {
    tr: 'Çevrimdışı — canlı veri yok; bağlantı gelince otomatik yenilenir',
    en: 'Offline — no live data; will reconnect automatically',
  },
  'banner.session': {
    tr: 'Oturum süresi doldu (Cloudflare Access) —',
    en: 'Session expired (Cloudflare Access) —',
  },
  'banner.sessionReload': { tr: 'Yenile ve tekrar giriş yap', en: 'Reload and sign in again' },
  'close': { tr: 'Kapat', en: 'Close' },
};

export function t(key: string, params?: Record<string, string | number>): string {
  const entry = MESSAGES[key];
  let out = entry ? entry[lang()] : key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      out = out.replaceAll(`{${k}}`, String(v));
    }
  }
  return out;
}

/**
 * Faz 30 — Türkçe metni anahtar alan reaktif çeviri. TR'de metni aynen döndürür;
 * EN'de `i18n_en.ts` sözlüğüne bakar, sözlükte yoksa sonu/başı noktalama farkını dener.
 * Solid JSX içinde `{tt('…')}` reaktiftir (lang() sinyalini okur).
 */
export function tt(trText: string): string {
  if (lang() !== 'en' || !trText) return trText;
  const hit = EN[trText];
  if (hit !== undefined) return hit;
  const m = /^(\s*)(.*?)([\s:…·(]*)$/.exec(trText);
  if (m && m[2] && EN[m[2]] !== undefined) return m[1] + EN[m[2]] + m[3];
  return trText;
}

/** Faz 30 — yer tutuculu çeviri: `tfmt("{0} gün önce", n)`; anahtar Türkçe kalıp, EN'de sözlükten. */
export function tfmt(trPattern: string, ...args: unknown[]): string {
  const pat = lang() === 'en' ? (EN[trPattern] ?? trPattern) : trPattern;
  return pat.replace(/\{(\d+)\}/g, (_, i) => String(args[Number(i)] ?? ''));
}
