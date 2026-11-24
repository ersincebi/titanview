import { tfmt, tt } from './i18n';
import { TOOL_LABELS } from '../chart/drawing/toolSpec';
import { BUILTINS } from '../script/builtins';
import { LANG_NAME } from '../script/brand';
import type { ChartStyleMode, DrawingToolType } from '../types/market';
import type { SettingsTabId } from './chartSettings';
import { availableColorThemes } from './theme';

export type QuickItemKind = 'drawing' | 'indicator' | 'style' | 'setting' | 'theme' | 'action';

export interface QuickSearchItem {
  id: string;
  kind: QuickItemKind;
  titleTr: string;
  titleEn: string;
  subtitleTr?: string;
  subtitleEn?: string;
  keywords: string;
  shortcut?: string;
  payload:
    | { type: 'tool'; tool: DrawingToolType }
    | { type: 'indicator'; builtinId: string }
    | { type: 'style'; mode: ChartStyleMode }
    | { type: 'setting'; tab: SettingsTabId }
    | { type: 'theme'; themeId: string }
    | { type: 'action'; actionId: string };
}

const STYLE_LIST: Array<[ChartStyleMode, string, string]> = [
  ['bar', tt("Çubuklar"), 'Bars'],
  ['candles', tt("Mumlar"), 'Candles'],
  ['hollow', tt("İçi boş mumlar"), 'Hollow candles'],
  ['volcandles', tt("Hacim mumları"), 'Volume candles'],
  ['line', tt("Çizgi"), 'Line'],
  ['linemarkers', tt("İşaretli çizgi"), 'Line with markers'],
  ['stepline', tt("Basamak çizgisi"), 'Step line'],
  ['area', tt("Alan"), 'Area'],
  ['hlcarea', tt("HLC alanı"), 'HLC area'],
  ['baseline', tt("Taban çizgisi"), 'Baseline'],
  ['columns', tt("Sütunlar"), 'Columns'],
  ['highlow', tt("Yüksek-düşük"), 'High-low'],
  ['footprint', tt("Hacim footprint"), 'Volume footprint'],
  ['tpo', 'TPO', 'Time Price Opportunity (TPO)'],
  ['svp', tt("Seans hacim profili"), 'Session volume profile'],
  ['heikin', 'Heikin Ashi', 'Heikin Ashi'],
  ['renko', 'Renko', 'Renko'],
  ['linebreak', tt("Çizgi kırılımı"), 'Line break'],
  ['kagi', 'Kagi', 'Kagi'],
  ['pnf', tt("Nokta ve şekil"), 'Point & figure'],
  ['range', 'Range', 'Range'],
];

const SETTING_TABS: Array<[SettingsTabId, string, string, string]> = [
  ['symbol', tt("Ayarlar: Sembol"), 'Settings: Symbol', 'mum renk precision zaman dilimi timezone seans renko kagi'],
  ['status', tt("Ayarlar: Durum Çizgisi"), 'Settings: Status line', 'legend ohlc hacim baslik gosterge'],
  ['scales', tt("Ayarlar: Ölçekler ve Çizgiler"), 'Settings: Scales and lines', 'fiyat ekseni geri sayim countdown seans ayraci log'],
  ['canvas', tt("Ayarlar: Tuval ve Tema"), 'Settings: Canvas & Theme', 'arka plan grid izgara filigran watermark crosshair tema renk'],
  ['trading', tt("Ayarlar: İşlem"), 'Settings: Trading', 'al sat emir pozisyon paper binance buy sell'],
  ['alerts', tt("Ayarlar: Alarmlar"), 'Settings: Alerts', 'alarm cizgi ses bildirim toast popup'],
  ['events', tt("Ayarlar: Olaylar"), 'Settings: Events', 'temettu bolunme bilanco dividend split earnings haber'],
];

const ACTIONS: Array<{
  id: string;
  tr: string;
  en: string;
  subTr: string;
  subEn: string;
  kw: string;
  shortcut?: string;
}> = [
  { id: 'goto', tr: 'Tarihe Git', en: 'Go to Date', subTr: tt("Belirli tarih veya aralığa atla"), subEn: 'Jump to date or custom range', kw: 'tarih git date jump calendar', shortcut: 'Alt+G' },
  { id: 'shortcuts', tr: tt("Klavye Kısayolları"), en: 'Keyboard Shortcuts', subTr: tt("Tüm klavye kısayol listesi (~80)"), subEn: 'Full keyboard shortcuts reference (~80)', kw: 'klavye kisayol keyboard shortcuts help yardim', shortcut: '?' },
  { id: 'alert', tr: tt("Yeni Alarm Oluştur"), en: 'Create Alert', subTr: tt("Sunucu tarafı fiyat/gösterge alarmı"), subEn: 'Server-side price or indicator alert', kw: 'alarm alert bildirim', shortcut: 'Alt+A' },
  { id: 'replay', tr: tt("Bar Replay Başlat / Durdur"), en: 'Toggle Bar Replay', subTr: tt("Geçmiş mumları bar-bar oynat"), subEn: 'Replay historical bars step by step', kw: 'replay bar oynat gecmis', shortcut: 'Shift+R' },
  { id: 'compare', tr: tt("Karşılaştır veya Sembol Ekle"), en: 'Compare or Add Symbol', subTr: tt("Çoklu sembol üst üste bindir"), subEn: 'Overlay comparison symbol', kw: 'karsilastir compare overlay', shortcut: 'Alt+Shift+O' },
  { id: 'snap_dl', tr: tt("Ekran Görüntüsü İndir (PNG)"), en: 'Download Chart Snapshot', subTr: tt("Grafiği PNG olarak kaydet"), subEn: 'Save chart image as PNG', kw: 'ekran goruntu snapshot png indir download', shortcut: 'Alt+S' },
  { id: 'snap_copy', tr: tt("Grafik Görüntüsünü Panoya Kopyala"), en: 'Copy Chart Image', subTr: tt("PNG görüntüsünü panoya kopyala"), subEn: 'Copy chart PNG to clipboard', kw: 'kopyala copy snapshot image pano', shortcut: '⌘Alt+S' },
  { id: 'snap_link', tr: tt("Grafik Bağlantısını Kopyala"), en: 'Copy Chart Link', subTr: tt("Paylaşılabilir grafik URL kopyala"), subEn: 'Copy shareable chart URL', kw: 'baglanti link paylas share url' },
  { id: 'reset_view', tr: tt("Grafik Görünümünü Sıfırla"), en: 'Reset Chart View', subTr: tt("Tüm veriyi ekrana sığdır"), subEn: 'Fit chart content to screen', kw: 'sifirla sigdir reset fit view', shortcut: 'Alt+R' },
  { id: 'scale_log', tr: tt("Logaritmik Ölçek Aç / Kapat"), en: 'Toggle Logarithmic Scale', subTr: 'Fiyat ekseni log modu', subEn: 'Logarithmic price scale', kw: 'log logaritmik olcek scale', shortcut: 'Alt+L' },
  { id: 'scale_pct', tr: tt("Yüzde Ölçeği Aç / Kapat"), en: 'Toggle Percentage Scale', subTr: 'Fiyat ekseni % modu', subEn: 'Percentage price scale', kw: 'yuzde percent olcek scale', shortcut: 'Alt+P' },
  { id: 'scale_idx', tr: tt("100'e İndeksli Ölçek"), en: 'Toggle Indexed to 100 Scale', subTr: tt("100 bazlı göreceli ölçek"), subEn: 'Indexed to 100 scale', kw: 'indeksli indexed 100 olcek scale', shortcut: 'Alt+O' },
  { id: 'scale_invert', tr: tt("Ters Ölçek Aç / Kapat"), en: 'Invert Price Scale', subTr: tt("Fiyat eksenini ters çevir"), subEn: 'Flip price axis vertically', kw: 'ters invert flip scale', shortcut: 'Alt+I' },
  { id: 'scale_lock', tr: tt("Ölçeği Kilitle (Fiyat/Bar)"), en: 'Lock Price to Bar Ratio', subTr: tt("Fiyat/bar oranını sabitle"), subEn: 'Fix price-to-bar ratio', kw: 'kilitle lock ratio olcek', shortcut: 'Alt+K' },
  { id: 'undo', tr: 'Geri Al', en: 'Undo', subTr: tt("Son kabuk işlemini geri al"), subEn: 'Undo last shell action', kw: 'geri al undo', shortcut: '⌘Z' },
  { id: 'redo', tr: 'Yinele', en: 'Redo', subTr: tt("Geri alınan işlemi yinele"), subEn: 'Redo undone action', kw: 'yinele redo', shortcut: '⌘Y' },
  { id: 'toggle_theme', tr: tt("Açık / Koyu Tema Değiştir"), en: 'Toggle Light / Dark Theme', subTr: tt("Karanlık ve aydınlık mod arası geç"), subEn: 'Switch between light and dark mode', kw: 'tema theme dark light acik koyu', shortcut: 'Alt+D' },
  { id: 'toggle_lang', tr: tt("Dil Değiştir (TR ↔ EN)"), en: 'Switch Language (EN ↔ TR)', subTr: tt("Türkçe / English arayüz dili"), subEn: 'Toggle English / Turkish UI language', kw: 'dil language english turkce tr en', shortcut: 'Alt+Shift+Y' },
  { id: 'fullscreen', tr: 'Tam Ekran', en: 'Toggle Fullscreen', subTr: tt("Tarayıcı tam ekran modu"), subEn: 'Enter or exit fullscreen', kw: 'tam ekran fullscreen', shortcut: 'Shift+F' },
  { id: 'zoom_in', tr: tt("Yakınlaştır (Kutu Aracı)"), en: 'Zoom In Box Tool', subTr: tt("Grafikte bölge seçerek yakınlaş"), subEn: 'Drag box on chart to zoom in', kw: 'yakinlastir zoom in box', shortcut: 'Alt+Z' },
  { id: 'zoom_out', tr: tt("Uzaklaştır"), en: 'Zoom Out', subTr: tt("Görünümü 1.5x uzaklaştır"), subEn: 'Zoom out 1.5x', kw: 'uzaklastir zoom out', shortcut: '-' },
  { id: 'lock_drawings', tr: tt("Tüm Çizimleri Kilitle / Aç"), en: 'Lock / Unlock All Drawings', subTr: tt("Çizimlerin kazara taşınmasını önle"), subEn: 'Prevent accidental drawing edits', kw: 'kilitle lock cizim drawing', shortcut: '⌘Alt+L' },
  { id: 'hide_drawings', tr: tt("Tüm Çizimleri Gizle / Göster"), en: 'Hide / Show All Drawings', subTr: tt("Çizim katmanı görünürlüğü"), subEn: 'Toggle drawing layer visibility', kw: 'gizle goster hide show drawing', shortcut: '⌘Alt+H' },
  { id: 'wb_script', tr: tt("Betik Editörünü Aç"), en: 'Open Script Editor', subTr: tfmt("{0} kod editörü", LANG_NAME), subEn: `Open ${LANG_NAME} editor`, kw: 'betik titanscript editor script kod', shortcut: 'Alt+Shift+K' },
  { id: 'wb_screener', tr: tt("Tarayıcıyı Aç (Screener)"), en: 'Open Screener', subTr: tfmt("Gelişmiş & {0} tarayıcı", LANG_NAME), subEn: `Advanced & ${LANG_NAME} Screener`, kw: 'tarayici screener filtre', shortcut: 'Alt+Shift+B' },
  { id: 'wb_paper', tr: tt("İşlem Panelini Aç (Paper Trading)"), en: 'Open Trading Panel', subTr: tt("Pozisyonlar, emirler ve geçmiş"), subEn: 'Positions, orders & history', kw: 'islem paper trading emir pozisyon', shortcut: 'Shift+P' },
  { id: 'order_ticket', tr: tt("Emir Biletini Aç"), en: 'Open Order Ticket', subTr: tt("Sağ panelde emir girişi"), subEn: 'Order entry panel', kw: 'emir bileti ticket buy sell al sat', shortcut: 'Shift+T' },
  { id: 'layouts', tr: tt("Kayıtlı Düzenleri Yönet"), en: 'Load / Manage Layouts', subTr: tt("Çoklu kayıtlı düzenler"), subEn: 'Saved multi-chart layouts', kw: 'duzen layout kayitli yukle' },
  { id: 'templates', tr: tt("Gösterge Şablonları"), en: 'Indicator Templates', subTr: tt("Kayıtlı gösterge şablonları"), subEn: 'Saved indicator templates', kw: 'sablon template gosterge' },
  { id: 'simple', tr: 'Sade Mod', en: 'Toggle Clean Mode', subTr: tt("Yalın grafik kabuğu"), subEn: 'Hide advanced analysis panels', kw: 'sade simple clean mode', shortcut: 'Alt+X' },
];

const TOOL_EN: Partial<Record<DrawingToolType, string>> = {
  cursor: 'Cursor / Crosshair',
  trendline: 'Trend Line',
  ray: 'Ray',
  info_line: 'Info Line',
  extended: 'Extended Line',
  trend_angle: 'Trend Angle',
  hline: 'Horizontal Line',
  hray: 'Horizontal Ray',
  vline: 'Vertical Line',
  cross_line: 'Cross Line',
  channel: 'Parallel Channel',
  regression: 'Regression Trend',
  flat_channel: 'Flat Top/Bottom',
  disjoint_channel: 'Disjoint Channel',
  pitchfork: 'Andrews Pitchfork',
  schiff_pitchfork: 'Schiff Pitchfork',
  mod_schiff_pitchfork: 'Modified Schiff Pitchfork',
  inside_pitchfork: 'Inside Pitchfork',
  fib: 'Fib Retracement',
  fib_ext: 'Trend-Based Fib Extension',
  fib_channel: 'Fib Channel',
  fib_timezone: 'Fib Time Zone',
  fib_speed_fan: 'Fib Speed Resistance Fan',
  fib_trend_time: 'Trend-Based Fib Time',
  fib_circles: 'Fib Circles',
  fib_spiral: 'Fib Spiral',
  fib_speed_arcs: 'Fib Speed Resistance Arcs',
  fib_wedge: 'Fib Wedge',
  fib_pitchfan: 'Pitchfan',
  gann_box: 'Gann Box',
  gann_square_fixed: 'Gann Square Fixed',
  gann_square: 'Gann Square',
  gann_fan: 'Gann Fan',
  brush: 'Brush',
  highlighter: 'Highlighter',
  arrow_marker: 'Arrow Marker',
  arrow: 'Arrow',
  arrow_up: 'Arrow Mark Up',
  arrow_down: 'Arrow Mark Down',
  rect: 'Rectangle',
  rotated_rect: 'Rotated Rectangle',
  path: 'Path',
  circle: 'Circle',
  ellipse: 'Ellipse',
  polyline: 'Polyline',
  triangle: 'Triangle',
  arc: 'Arc',
  curve: 'Curve',
  double_curve: 'Double Curve',
  xabcd: 'XABCD Pattern',
  cypher: 'Cypher Pattern',
  head_shoulders: 'Head and Shoulders',
  abcd: 'ABCD Pattern',
  triangle_pattern: 'Triangle Pattern',
  three_drives: 'Three Drives Pattern',
  elliott_impulse: 'Elliott Impulse Wave (12345)',
  elliott_correction: 'Elliott Correction Wave (ABC)',
  elliott_triangle: 'Elliott Triangle Wave (ABCDE)',
  elliott_double: 'Elliott Double Combo (WXY)',
  elliott_triple: 'Elliott Triple Combo (WXYXZ)',
  cyclic_lines: 'Cyclic Lines',
  time_cycles: 'Time Cycles',
  sine_line: 'Sine Line',
  long_pos: 'Long Position',
  short_pos: 'Short Position',
  forecast: 'Forecast',
  bars_pattern: 'Bars Pattern',
  ghost_feed: 'Ghost Feed',
  projection: 'Projection',
  anchored_vwap: 'Anchored VWAP',
  fixed_vp: 'Fixed Range Volume Profile',
  anchored_vp: 'Anchored Volume Profile',
  price_range: 'Price Range',
  date_range: 'Date Range',
  date_price_range: 'Date and Price Range',
  ruler: 'Measure (Ruler)',
  text: 'Text',
  anchored_text: 'Anchored Text',
  note: 'Note',
  price_note: 'Price Note',
  pin: 'Pin',
  table: 'Table',
  callout: 'Callout',
  comment: 'Comment',
  price_label: 'Price Label',
  signpost: 'Signpost',
  flag_mark: 'Flag Mark',
  icon: 'Icons & Emojis',
};

export function toolLabel(tool: DrawingToolType, lang: 'tr' | 'en'): string {
  if (lang === 'en') return TOOL_EN[tool] ?? TOOL_LABELS[tool] ?? tool;
  return TOOL_LABELS[tool] ?? tool;
}

export function buildQuickSearchCatalog(): QuickSearchItem[] {
  const out: QuickSearchItem[] = [];

  for (const a of ACTIONS) {
    out.push({
      id: `act:${a.id}`,
      kind: 'action',
      titleTr: a.tr,
      titleEn: a.en,
      subtitleTr: a.subTr,
      subtitleEn: a.subEn,
      keywords: `${a.tr} ${a.en} ${a.kw}`.toLowerCase(),
      shortcut: a.shortcut,
      payload: { type: 'action', actionId: a.id },
    });
  }

  for (const [tab, tr, en, kw] of SETTING_TABS) {
    out.push({
      id: `set:${tab}`,
      kind: 'setting',
      titleTr: tr,
      titleEn: en,
      subtitleTr: 'Grafik ayarları sekmesi',
      subtitleEn: 'Chart settings tab',
      keywords: `${tr} ${en} ${kw}`.toLowerCase(),
      payload: { type: 'setting', tab },
    });
  }

  for (const th of availableColorThemes()) {
    out.push({
      id: `thm:${th.id}`,
      kind: 'theme',
      titleTr: `Tema: ${th.nameTr}`,
      titleEn: `Theme: ${th.nameEn}`,
      subtitleTr: th.base === 'light' ? tt("Açık renk teması") : tt("Koyu renk teması"),
      subtitleEn: th.base === 'light' ? 'Light color theme' : 'Dark color theme',
      keywords: `tema theme renk color ${th.nameTr} ${th.nameEn} ${th.id}`.toLowerCase(),
      payload: { type: 'theme', themeId: th.id },
    });
  }

  for (const [mode, tr, en] of STYLE_LIST) {
    out.push({
      id: `sty:${mode}`,
      kind: 'style',
      titleTr: `Grafik Tipi: ${tr}`,
      titleEn: `Chart Type: ${en}`,
      subtitleTr: 'Grafik stilini değiştir',
      subtitleEn: 'Switch chart type',
      keywords: `grafik stil chart style type ${tr} ${en} ${mode}`.toLowerCase(),
      payload: { type: 'style', mode },
    });
  }

  for (const [tool, tr] of Object.entries(TOOL_LABELS) as Array<[DrawingToolType, string]>) {
    if (tool === 'cursor') continue;
    const en = TOOL_EN[tool] ?? tr;
    out.push({
      id: `tool:${tool}`,
      kind: 'drawing',
      titleTr: tr,
      titleEn: en,
      subtitleTr: 'Çizim aracı',
      subtitleEn: 'Drawing tool',
      keywords: `cizim drawing tool ${tr} ${en} ${tool}`.toLowerCase(),
      payload: { type: 'tool', tool },
    });
  }

  for (const b of BUILTINS) {
    out.push({
      id: `ind:${b.id}`,
      kind: 'indicator',
      titleTr: b.tr,
      titleEn: b.title,
      subtitleTr: b.shortTitle !== b.title ? `${b.title} (${b.shortTitle})` : b.title,
      subtitleEn: b.shortTitle,
      keywords: `gosterge indicator ${b.tr} ${b.title} ${b.shortTitle} ${b.id} ${b.desc}`.toLowerCase(),
      payload: { type: 'indicator', builtinId: b.id },
    });
  }

  return out;
}

export function searchQuickItems(
  query: string,
  kindFilter: 'all' | QuickItemKind = 'all',
  limit = 40
): QuickSearchItem[] {
  const catalog = buildQuickSearchCatalog();
  const q = query.trim().toLowerCase();
  const pool = kindFilter === 'all' ? catalog : catalog.filter((i) => i.kind === kindFilter);
  if (!q) return pool.slice(0, limit);

  const scored: Array<{ item: QuickSearchItem; score: number }> = [];
  for (const item of pool) {
    const tTr = item.titleTr.toLowerCase();
    const tEn = item.titleEn.toLowerCase();
    let score = 0;
    if (tTr === q || tEn === q) score = 100;
    else if (tTr.startsWith(q) || tEn.startsWith(q)) score = 70;
    else if (tTr.includes(q) || tEn.includes(q)) score = 45;
    else if (item.keywords.includes(q)) score = 20;
    if (score > 0) scored.push({ item, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((x) => x.item);
}
