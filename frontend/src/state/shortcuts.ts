import { tt } from './i18n';
import type { DrawingToolType, Timeframe } from '../types/market';
import { normalizeInterval } from './format';

export type ShortcutCategory =
  | 'chart'
  | 'scales'
  | 'drawings'
  | 'history_layout'
  | 'trading_alerts'
  | 'replay_watchlist'
  | 'panels';

export interface ShortcutDef {
  id: string;
  category: ShortcutCategory;
  keys: string[];
  labelTr: string;
  labelEn: string;
  action: string;
}

/** Geriye dönük: Alt+tuş çizim/aksiyon kısayolları (klavye düzeninden bağımsız: KeyboardEvent.code). */
export const ALT_SHORTCUTS: Record<string, DrawingToolType | 'fit'> = {
  KeyT: 'trendline',
  KeyH: 'hline',
  KeyJ: 'hray',
  KeyV: 'vline',
  KeyC: 'cross_line',
  KeyF: 'fib',
  KeyE: 'extended',
  KeyB: 'brush',
  KeyN: 'text',
  KeyR: 'fit',
};

/** Shift+Alt+tuş çizim araçları (genişletilmiş çizim kısayolları). */
export const ALT_SHIFT_DRAWINGS: Record<string, DrawingToolType> = {
  KeyI: 'info_line',
  KeyP: 'pitchfork',
  KeyC: 'channel',
  KeyR: 'rect',
  KeyE: 'ellipse',
  KeyM: 'ruler',
  KeyL: 'long_pos',
  KeyS: 'short_pos',
  KeyA: 'arrow',
  KeyF: 'fib_ext',
  KeyG: 'gann_box',
  KeyW: 'anchored_vwap',
  KeyV: 'fixed_vp',
  KeyT: 'triangle',
  KeyH: 'highlighter',
  KeyN: 'callout',
  KeyD: 'date_price_range',
  KeyX: 'xabcd',
};

/** Alt+1..9 hızlı zaman aralıkları. */
export const ALT_DIGIT_INTERVALS: Record<string, Timeframe> = {
  Digit1: '1m',
  Digit2: '5m',
  Digit3: '15m',
  Digit4: '30m',
  Digit5: '1h',
  Digit6: '4h',
  Digit7: '1d',
  Digit8: '1w',
  Digit9: '1M',
};

export const SHORTCUT_CATEGORIES: Array<{ id: ShortcutCategory; titleTr: string; titleEn: string }> = [
  { id: 'chart', titleTr: 'Grafik ve Gezinme', titleEn: 'Chart & Navigation' },
  { id: 'scales', titleTr: tt("Ölçekler ve Görünüm"), titleEn: 'Scales & Display' },
  { id: 'drawings', titleTr: tt("Çizim Araçları"), titleEn: 'Drawing Tools' },
  { id: 'history_layout', titleTr: tt("Geri Al, Yinele ve Düzen"), titleEn: 'Undo, Redo & Layout' },
  { id: 'trading_alerts', titleTr: tt("İşlem ve Alarmlar"), titleEn: 'Trading & Alerts' },
  { id: 'replay_watchlist', titleTr: tt("Bar Replay ve İzleme Listesi"), titleEn: 'Bar Replay & Watchlist' },
  { id: 'panels', titleTr: 'Paneller ve Kabuk', titleEn: 'Panels & Shell' },
];

/** Tam klavye kısayol kataloğu (~82 kısayol). */
export const SHORTCUT_CATALOG: ShortcutDef[] = [
  // ---- Chart & Navigation (19) ----
  { id: 'quick_search', category: 'chart', keys: ['⌘/Ctrl', 'K'], labelTr: 'Hızlı Arama (Sembol, Gösterge, Araç, Ayar)', labelEn: 'Quick Search (Symbols, Indicators, Tools, Settings)', action: 'modal:search' },
  { id: 'type_symbol', category: 'chart', keys: ['A–Z'], labelTr: 'Sembol yazarak hemen ara', labelEn: 'Start typing to search symbol', action: 'quick:symbol' },
  { id: 'type_interval', category: 'chart', keys: ['0–9', ','], labelTr: 'Zaman aralığını değiştir', labelEn: 'Change interval', action: 'quick:interval' },
  { id: 'indicators', category: 'chart', keys: ['/'], labelTr: 'Göstergeler ve Stratejiler (fx)', labelEn: 'Open Indicators & Strategies', action: 'modal:fx' },
  { id: 'command_bar', category: 'chart', keys: ['⌘/Ctrl', '/'], labelTr: 'Komut Çubuğu (`)', labelEn: 'Command Bar (`)', action: 'modal:command' },
  { id: 'go_to_date', category: 'chart', keys: ['Alt', 'G'], labelTr: 'Tarihe git', labelEn: 'Go to Date', action: 'modal:goto' },
  { id: 'reset_view', category: 'chart', keys: ['Alt', 'R'], labelTr: 'Grafik görünümünü sıfırla / sığdır', labelEn: 'Reset chart view', action: 'chart:reset' },
  { id: 'scroll_left', category: 'chart', keys: ['←'], labelTr: '1 bar sola kaydır', labelEn: 'Move 1 bar left', action: 'chart:left' },
  { id: 'scroll_right', category: 'chart', keys: ['→'], labelTr: '1 bar sağa kaydır', labelEn: 'Move 1 bar right', action: 'chart:right' },
  { id: 'scroll_left_fast', category: 'chart', keys: ['Shift', '←'], labelTr: '10 bar sola kaydır', labelEn: 'Move 10 bars left', action: 'chart:left10' },
  { id: 'scroll_right_fast', category: 'chart', keys: ['Shift', '→'], labelTr: '10 bar sağa kaydır', labelEn: 'Move 10 bars right', action: 'chart:right10' },
  { id: 'page_left', category: 'chart', keys: ['PageUp'], labelTr: 'Bir ekran sola kaydır', labelEn: 'Scroll one screen left', action: 'chart:pageLeft' },
  { id: 'page_right', category: 'chart', keys: ['PageDown'], labelTr: 'Bir ekran sağa kaydır', labelEn: 'Scroll one screen right', action: 'chart:pageRight' },
  { id: 'jump_start', category: 'chart', keys: ['Home'], labelTr: 'İlk bara git (⌘←)', labelEn: 'Jump to first bar (⌘←)', action: 'chart:start' },
  { id: 'jump_end', category: 'chart', keys: ['End'], labelTr: 'Son bara git (⌘→)', labelEn: 'Jump to latest bar (⌘→)', action: 'chart:end' },
  { id: 'zoom_in', category: 'chart', keys: ['⌘/Ctrl', '↑'], labelTr: 'Yakınlaştır (+ / ↑)', labelEn: 'Zoom in (+ / ↑)', action: 'chart:zoomIn' },
  { id: 'zoom_out', category: 'chart', keys: ['⌘/Ctrl', '↓'], labelTr: 'Uzaklaştır (- / ↓)', labelEn: 'Zoom out (- / ↓)', action: 'chart:zoomOut' },
  { id: 'zoom_box', category: 'chart', keys: ['Alt', 'Z'], labelTr: 'Kutu ile yakınlaştır aracı', labelEn: 'Zoom in box tool', action: 'tool:zoom' },
  { id: 'snapshot_dl', category: 'chart', keys: ['Alt', 'S'], labelTr: 'Grafik ekran görüntüsü indir', labelEn: 'Download chart snapshot', action: 'snap:download' },
  { id: 'snapshot_copy', category: 'chart', keys: ['⌘/Ctrl', 'Alt', 'S'], labelTr: 'Ekran görüntüsünü panoya kopyala', labelEn: 'Copy chart snapshot to clipboard', action: 'snap:copy' },
  { id: 'fullscreen', category: 'chart', keys: ['Shift', 'F'], labelTr: 'Tam ekranı aç / kapat', labelEn: 'Toggle fullscreen', action: 'shell:fullscreen' },

  // ---- Scales & Display (11) ----
  { id: 'scale_log', category: 'scales', keys: ['Alt', 'L'], labelTr: 'Logaritmik ölçek aç / kapat', labelEn: 'Toggle logarithmic scale', action: 'scale:log' },
  { id: 'scale_pct', category: 'scales', keys: ['Alt', 'P'], labelTr: 'Yüzde ölçeği aç / kapat', labelEn: 'Toggle percentage scale', action: 'scale:percent' },
  { id: 'scale_idx', category: 'scales', keys: ['Alt', 'O'], labelTr: "100'e indeksli ölçek aç / kapat", labelEn: 'Toggle indexed to 100 scale', action: 'scale:indexed' },
  { id: 'scale_invert', category: 'scales', keys: ['Alt', 'I'], labelTr: 'Ters fiyat ölçeği aç / kapat', labelEn: 'Invert price scale', action: 'scale:invert' },
  { id: 'scale_lock', category: 'scales', keys: ['Alt', 'K'], labelTr: 'Fiyat / bar oranını kilitle', labelEn: 'Lock price to bar ratio', action: 'scale:lock' },
  { id: 'magnet_toggle', category: 'scales', keys: ['Alt', 'M'], labelTr: 'Mıknatıs modu (Zayıf / Güçlü / Kapalı)', labelEn: 'Cycle magnet mode', action: 'draw:magnet' },
  { id: 'hide_drawings', category: 'scales', keys: ['⌘/Ctrl', 'Alt', 'H'], labelTr: 'Tüm çizimleri gizle / göster', labelEn: 'Hide / Show all drawings', action: 'draw:hideAll' },
  { id: 'lock_drawings', category: 'scales', keys: ['⌘/Ctrl', 'Alt', 'L'], labelTr: 'Tüm çizimleri kilitle / aç', labelEn: 'Lock / Unlock all drawings', action: 'draw:lockAll' },
  { id: 'toggle_theme', category: 'scales', keys: ['Alt', 'D'], labelTr: 'Açık / Koyu tema değiştir', labelEn: 'Toggle Light / Dark theme', action: 'shell:theme' },
  { id: 'toggle_simple', category: 'scales', keys: ['Alt', 'X'], labelTr: 'Sade modu aç / kapat', labelEn: 'Toggle clean mode', action: 'shell:simple' },
  { id: 'toggle_lang', category: 'scales', keys: ['Alt', 'Shift', 'Y'], labelTr: 'Dil değiştir (TR / EN)', labelEn: 'Switch language (TR / EN)', action: 'shell:lang' },

  // ---- Drawing Tools (30) ----
  { id: 'draw_trendline', category: 'drawings', keys: ['Alt', 'T'], labelTr: 'Trend çizgisi', labelEn: 'Trend line', action: 'tool:trendline' },
  { id: 'draw_hline', category: 'drawings', keys: ['Alt', 'H'], labelTr: 'Yatay çizgi', labelEn: 'Horizontal line', action: 'tool:hline' },
  { id: 'draw_hray', category: 'drawings', keys: ['Alt', 'J'], labelTr: 'Yatay ışın', labelEn: 'Horizontal ray', action: 'tool:hray' },
  { id: 'draw_vline', category: 'drawings', keys: ['Alt', 'V'], labelTr: 'Dikey çizgi', labelEn: 'Vertical line', action: 'tool:vline' },
  { id: 'draw_cross', category: 'drawings', keys: ['Alt', 'C'], labelTr: 'Çapraz çizgi', labelEn: 'Cross line', action: 'tool:cross_line' },
  { id: 'draw_fib', category: 'drawings', keys: ['Alt', 'F'], labelTr: 'Fibonacci düzeltmesi', labelEn: 'Fib retracement', action: 'tool:fib' },
  { id: 'draw_extended', category: 'drawings', keys: ['Alt', 'E'], labelTr: 'Uzatılmış çizgi', labelEn: 'Extended line', action: 'tool:extended' },
  { id: 'draw_brush', category: 'drawings', keys: ['Alt', 'B'], labelTr: 'Fırça', labelEn: 'Brush', action: 'tool:brush' },
  { id: 'draw_text', category: 'drawings', keys: ['Alt', 'N'], labelTr: 'Metin / Not', labelEn: 'Text / Note', action: 'tool:text' },
  { id: 'draw_infoline', category: 'drawings', keys: ['Alt', 'Shift', 'I'], labelTr: 'Bilgi çizgisi', labelEn: 'Info line', action: 'tool:info_line' },
  { id: 'draw_pitchfork', category: 'drawings', keys: ['Alt', 'Shift', 'P'], labelTr: 'Andrews Pitchfork', labelEn: 'Pitchfork', action: 'tool:pitchfork' },
  { id: 'draw_channel', category: 'drawings', keys: ['Alt', 'Shift', 'C'], labelTr: 'Paralel kanal', labelEn: 'Parallel channel', action: 'tool:channel' },
  { id: 'draw_rect', category: 'drawings', keys: ['Alt', 'Shift', 'R'], labelTr: 'Dikdörtgen', labelEn: 'Rectangle', action: 'tool:rect' },
  { id: 'draw_ellipse', category: 'drawings', keys: ['Alt', 'Shift', 'E'], labelTr: 'Elips', labelEn: 'Ellipse', action: 'tool:ellipse' },
  { id: 'draw_measure', category: 'drawings', keys: ['Alt', 'Shift', 'M'], labelTr: 'Cetvel / Ölçüm aracı', labelEn: 'Measure tool (Ruler)', action: 'tool:ruler' },
  { id: 'draw_long', category: 'drawings', keys: ['Alt', 'Shift', 'L'], labelTr: 'Alış (Long) pozisyon aracı', labelEn: 'Long position tool', action: 'tool:long_pos' },
  { id: 'draw_short', category: 'drawings', keys: ['Alt', 'Shift', 'S'], labelTr: 'Satış (Short) pozisyon aracı', labelEn: 'Short position tool', action: 'tool:short_pos' },
  { id: 'draw_arrow', category: 'drawings', keys: ['Alt', 'Shift', 'A'], labelTr: 'Ok aracı', labelEn: 'Arrow tool', action: 'tool:arrow' },
  { id: 'draw_fib_ext', category: 'drawings', keys: ['Alt', 'Shift', 'F'], labelTr: 'Trend tabanlı Fib uzatması', labelEn: 'Trend-based Fib extension', action: 'tool:fib_ext' },
  { id: 'draw_gann', category: 'drawings', keys: ['Alt', 'Shift', 'G'], labelTr: 'Gann kutusu', labelEn: 'Gann box', action: 'tool:gann_box' },
  { id: 'draw_avwap', category: 'drawings', keys: ['Alt', 'Shift', 'W'], labelTr: 'Çapalı VWAP', labelEn: 'Anchored VWAP', action: 'tool:anchored_vwap' },
  { id: 'draw_frvp', category: 'drawings', keys: ['Alt', 'Shift', 'V'], labelTr: 'Sabit aralık hacim profili', labelEn: 'Fixed range volume profile', action: 'tool:fixed_vp' },
  { id: 'draw_tri', category: 'drawings', keys: ['Alt', 'Shift', 'T'], labelTr: 'Üçgen şekli', labelEn: 'Triangle', action: 'tool:triangle' },
  { id: 'draw_hl', category: 'drawings', keys: ['Alt', 'Shift', 'H'], labelTr: 'Vurgulayıcı', labelEn: 'Highlighter', action: 'tool:highlighter' },
  { id: 'draw_callout', category: 'drawings', keys: ['Alt', 'Shift', 'N'], labelTr: 'Açıklama balonu', labelEn: 'Callout', action: 'tool:callout' },
  { id: 'draw_dup', category: 'drawings', keys: ['⌘/Ctrl', 'D'], labelTr: 'Seçili çizimi çoğalt', labelEn: 'Duplicate selected drawing', action: 'draw:duplicate' },
  { id: 'draw_copy', category: 'drawings', keys: ['⌘/Ctrl', 'C'], labelTr: 'Seçili çizimi kopyala', labelEn: 'Copy selected drawing', action: 'draw:copy' },
  { id: 'draw_paste', category: 'drawings', keys: ['⌘/Ctrl', 'V'], labelTr: 'Kopyalanan çizimi yapıştır', labelEn: 'Paste drawing', action: 'draw:paste' },
  { id: 'draw_del', category: 'drawings', keys: ['Del', '⌫'], labelTr: 'Seçili çizimi sil', labelEn: 'Delete selected drawing', action: 'draw:delete' },
  { id: 'draw_finish', category: 'drawings', keys: ['Enter'], labelTr: 'Çok noktalı çizimi bitir', labelEn: 'Finish polyline / path draft', action: 'draw:finish' },

  // ---- Undo, Redo & Layout (12) ----
  { id: 'undo', category: 'history_layout', keys: ['⌘/Ctrl', 'Z'], labelTr: 'Geri al (tüm kabuk işlemleri)', labelEn: 'Undo (full shell history)', action: 'history:undo' },
  { id: 'redo', category: 'history_layout', keys: ['⌘/Ctrl', 'Y'], labelTr: 'Yinele (⌘⇧Z)', labelEn: 'Redo (⌘⇧Z)', action: 'history:redo' },
  { id: 'save_layout', category: 'history_layout', keys: ['⌘/Ctrl', 'S'], labelTr: 'Düzeni kaydet', labelEn: 'Save layout', action: 'layout:save' },
  { id: 'next_slot', category: 'history_layout', keys: ['Tab'], labelTr: 'Çoklu grafikte sonraki hücre', labelEn: 'Next chart in multi-chart layout', action: 'layout:nextSlot' },
  { id: 'prev_slot', category: 'history_layout', keys: ['Shift', 'Tab'], labelTr: 'Çoklu grafikte önceki hücre', labelEn: 'Previous chart in multi-chart layout', action: 'layout:prevSlot' },
  { id: 'max_slot', category: 'history_layout', keys: ['Alt', 'Enter'], labelTr: 'Aktif grafiği büyüt / ızgaraya dön', labelEn: 'Maximize / Restore active chart', action: 'layout:maxSlot' },
  { id: 'layout_1', category: 'history_layout', keys: ['Alt', 'Shift', '1'], labelTr: 'Tek grafik düzeni (1)', labelEn: 'Single chart layout (1)', action: 'layout:single' },
  { id: 'layout_2', category: 'history_layout', keys: ['Alt', 'Shift', '2'], labelTr: '2 grafik yatay (2×1)', labelEn: '2 charts side-by-side (2×1)', action: 'layout:2x1' },
  { id: 'layout_3', category: 'history_layout', keys: ['Alt', 'Shift', '3'], labelTr: '2 grafik dikey (1×2)', labelEn: '2 charts stacked (1×2)', action: 'layout:1x2' },
  { id: 'layout_4', category: 'history_layout', keys: ['Alt', 'Shift', '4'], labelTr: '4 grafik ızgara (2×2)', labelEn: '4 charts grid (2×2)', action: 'layout:2x2' },
  { id: 'tf_digits', category: 'history_layout', keys: ['Alt', '1–9'], labelTr: 'Hızlı aralıklar (1m · 5m · 15m · 30m · 1h · 4h · 1d · 1w · 1M)', labelEn: 'Quick intervals (1m–1M)', action: 'tf:quick' },
  { id: 'escape', category: 'history_layout', keys: ['Esc'], labelTr: 'İmlece dön / menüyü veya pencereyi kapat', labelEn: 'Return to cursor / close dialog', action: 'shell:escape' },

  // ---- Trading & Alerts (6) ----
  { id: 'add_alert', category: 'trading_alerts', keys: ['Alt', 'A'], labelTr: 'Fiyat alarmı oluştur', labelEn: 'Create alert', action: 'alert:new' },
  { id: 'order_ticket', category: 'trading_alerts', keys: ['Shift', 'T'], labelTr: 'Emir biletini aç / kapat', labelEn: 'Toggle Order Panel', action: 'trade:ticket' },
  { id: 'quick_buy', category: 'trading_alerts', keys: ['Shift', 'B'], labelTr: 'Hızlı piyasa ALIŞ emri (Paper)', labelEn: 'Quick market BUY (Paper)', action: 'trade:buy' },
  { id: 'quick_sell', category: 'trading_alerts', keys: ['Shift', 'S'], labelTr: 'Hızlı piyasa SATIŞ emri (Paper)', labelEn: 'Quick market SELL (Paper)', action: 'trade:sell' },
  { id: 'paper_panel', category: 'trading_alerts', keys: ['Shift', 'P'], labelTr: 'Paper Trading alt panelini aç', labelEn: 'Open Trading Panel', action: 'wb:paper' },
  { id: 'compare_sym', category: 'trading_alerts', keys: ['Alt', 'Shift', 'O'], labelTr: 'Karşılaştır veya sembol ekle', labelEn: 'Compare or add symbol', action: 'modal:compare' },

  // ---- Replay & Watchlist (6) ----
  { id: 'replay_toggle', category: 'replay_watchlist', keys: ['Shift', 'R'], labelTr: 'Bar Replay aç / kapat', labelEn: 'Toggle Bar Replay', action: 'replay:toggle' },
  { id: 'replay_play', category: 'replay_watchlist', keys: ['Space'], labelTr: 'Replay oynat/duraklat · normalde sonraki izleme sembolü', labelEn: 'Replay play/pause · next watchlist symbol', action: 'space' },
  { id: 'wl_prev', category: 'replay_watchlist', keys: ['Shift', 'Space'], labelTr: 'Önceki izleme listesi sembolü', labelEn: 'Previous watchlist symbol', action: 'wl:prev' },
  { id: 'replay_step', category: 'replay_watchlist', keys: ['Shift', '↓'], labelTr: 'Bar Replay: 1 mum ileri', labelEn: 'Bar Replay: step 1 bar forward', action: 'replay:step' },
  { id: 'wl_toggle', category: 'replay_watchlist', keys: ['Alt', 'W'], labelTr: 'İzleme listesini aç / kapat', labelEn: 'Toggle Watchlist drawer', action: 'drawer:watchlist' },
  { id: 'wl_add', category: 'replay_watchlist', keys: ['Alt', 'Shift', 'U'], labelTr: 'Aktif sembolü izleme listesine ekle', labelEn: 'Add active symbol to watchlist', action: 'wl:addCurrent' },

  // ---- Panels & Shell (7) ----
  { id: 'open_settings', category: 'panels', keys: ['⌘/Ctrl', ','], labelTr: 'Grafik Ayarları penceresini aç', labelEn: 'Open Chart Settings', action: 'modal:settings' },
  { id: 'open_shortcuts', category: 'panels', keys: ['?'], labelTr: 'Klavye kısayolları penceresini aç', labelEn: 'Open Keyboard Shortcuts', action: 'modal:shortcuts' },
  { id: 'open_script', category: 'panels', keys: ['Alt', 'Shift', 'K'], labelTr: 'Betik Editörü alt panelini aç / kapat', labelEn: 'Toggle Script Editor', action: 'wb:script' },
  { id: 'open_screener', category: 'panels', keys: ['Alt', 'Shift', 'B'], labelTr: 'Tarayıcı alt panelini aç / kapat', labelEn: 'Toggle Screener', action: 'wb:screener' },
  { id: 'open_objtree', category: 'panels', keys: ['Alt', 'Shift', 'J'], labelTr: 'Nesne Ağacı çekmecesini aç / kapat', labelEn: 'Toggle Object Tree', action: 'drawer:objecttree' },
  { id: 'open_datawin', category: 'panels', keys: ['Alt', 'Shift', 'D'], labelTr: 'Veri Penceresini aç / kapat', labelEn: 'Toggle Data Window', action: 'drawer:datawindow' },
  { id: 'toggle_drawer', category: 'panels', keys: ['Alt', 'Shift', 'Z'], labelTr: 'Sağ çekmeceyi gizle / göster', labelEn: 'Collapse / Expand right drawer', action: 'drawer:toggle' },
];

export function shortcutLabel(code: string): string {
  return `Alt+${code.replace('Key', '')}`;
}

export function isTypingTarget(el: Element | null = typeof document !== 'undefined' ? document.activeElement : null): boolean {
  if (!el) return false;
  const tag = (el.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  if ((el as HTMLElement).isContentEditable) return true;
  if (el.closest?.('.monaco-editor')) return true;
  return false;
}

/**
 * Standart hızlı zaman aralığı girişi ayrıştırıcısı:
 * "15" -> "15m", "60" -> "1h", "240" -> "4h", "4h" -> "4h", "1d" -> "1d", "1w" -> "1w", "1M" -> "1M", "30s" -> "30s".
 */
export function parseQuickInterval(raw: string): Timeframe | null {
  const s = raw.trim();
  if (!s) return null;
  if (/^\d+$/.test(s)) {
    const mins = Number(s);
    if (mins <= 0 || mins > 10080) return null;
    if (mins === 60) return '1h';
    if (mins === 120) return '2h';
    if (mins === 180) return '3h';
    if (mins === 240) return '4h';
    if (mins === 360) return '6h';
    if (mins === 480) return '8h';
    if (mins === 720) return '12h';
    if (mins === 1440) return '1d';
    return normalizeInterval(`${mins}m`);
  }
  // Büyük M = ay, küçük m = dakika, büyük D/W/H/S -> normalize
  if (/^\d+M$/.test(s)) return normalizeInterval(s);
  const lower = s.toLowerCase();
  if (/^\d+[smhdw]$/.test(lower)) return normalizeInterval(lower);
  if (lower === 'd' || lower === 'g') return '1d';
  if (lower === 'w' || lower === 'h') return lower === 'w' ? '1w' : '1h';
  if (s === 'M') return '1M';
  return normalizeInterval(s);
}

export function filterShortcuts(query: string, l: 'tr' | 'en'): ShortcutDef[] {
  const q = query.trim().toLowerCase();
  if (!q) return SHORTCUT_CATALOG;
  return SHORTCUT_CATALOG.filter((s) => {
    const lbl = (l === 'en' ? s.labelEn : s.labelTr).toLowerCase();
    const altLbl = (l === 'en' ? s.labelTr : s.labelEn).toLowerCase();
    const keys = s.keys.join(' ').toLowerCase();
    return lbl.includes(q) || altLbl.includes(q) || keys.includes(q) || s.category.includes(q);
  });
}
