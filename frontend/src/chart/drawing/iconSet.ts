import { tt } from '../../state/i18n';
/**
 * Faz 22: grafik üzerine konan ikon seti — kendi çizdiğimiz basit 24×24 vektörler (setinin kopyası değil)
 * ve Unicode emojiler. Çizimde `icon` alanı: SVG için `i:<anahtar>`, emoji için karakterin kendisi.
 */

export interface IconDef {
  key: string;
  label: string;
  /** 24×24 viewBox içinde path verisi; `fill` true ise dolu, değilse çizgi */
  d: string;
  fill?: boolean;
}

export interface IconCategory {
  id: string;
  title: string;
  icons: IconDef[];
}

export const ICON_CATEGORIES: IconCategory[] = [
  {
    id: 'arrows',
    title: tt("Oklar"),
    icons: [
      { key: 'arrow-up', label: tt("Yukarı"), d: 'M12 3l7 8h-4v10H9V11H5z', fill: true },
      { key: 'arrow-down', label: tt("Aşağı"), d: 'M12 21l7-8h-4V3H9v10H5z', fill: true },
      { key: 'arrow-left', label: 'Sol', d: 'M3 12l8-7v4h10v6H11v4z', fill: true },
      { key: 'arrow-right', label: tt("Sağ"), d: 'M21 12l-8-7v4H3v6h10v4z', fill: true },
      { key: 'arrow-up-right', label: tt("Sağ üst"), d: 'M6 18L18 6M9 6h9v9' },
      { key: 'arrow-down-right', label: tt("Sağ alt"), d: 'M6 6l12 12M18 9v9H9' },
      { key: 'chevrons-up', label: tt("Çift yukarı"), d: 'M6 13l6-6 6 6M6 19l6-6 6 6' },
      { key: 'chevrons-down', label: tt("Çift aşağı"), d: 'M6 5l6 6 6-6M6 11l6 6 6-6' },
      { key: 'refresh', label: tt("Dönüş"), d: 'M20 12a8 8 0 1 1-2.3-5.7M20 4v4h-4' },
      { key: 'swap', label: tt("Takas"), d: 'M4 8h14l-3-3M20 16H6l3 3' },
      { key: 'trend-up', label: tt("Yükseliş"), d: 'M3 17l6-6 4 4 8-8M15 7h6v6' },
      { key: 'trend-down', label: tt("Düşüş"), d: 'M3 7l6 6 4-4 8 8M15 17h6v-6' },
    ],
  },
  {
    id: 'symbols',
    title: tt("Semboller"),
    icons: [
      { key: 'check', label: tt("Onay"), d: 'M4 12l5 5L20 6' },
      { key: 'cross', label: tt("Çarpı"), d: 'M5 5l14 14M19 5L5 19' },
      { key: 'plus', label: tt("Artı"), d: 'M12 4v16M4 12h16' },
      { key: 'minus', label: tt("Eksi"), d: 'M4 12h16' },
      { key: 'warning', label: tt("Uyarı"), d: 'M12 3L2 20h20zM12 9v5M12 17v.5' },
      { key: 'info', label: tt("Bilgi"), d: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v6M12 7.5v.5' },
      { key: 'question', label: tt("Soru"), d: 'M9 9a3 3 0 1 1 4 2.8c-.7.3-1 .9-1 1.7V15M12 18v.5' },
      { key: 'star', label: tt("Yıldız"), d: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z', fill: true },
      { key: 'heart', label: tt("Kalp"), d: 'M12 20s-8-5-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 9c0 6-8 11-8 11z', fill: true },
      { key: 'circle', label: tt("Daire"), d: 'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16z', fill: true },
      { key: 'square', label: tt("Kare"), d: 'M5 5h14v14H5z', fill: true },
      { key: 'diamond', label: tt("Elmas"), d: 'M12 3l8 9-8 9-8-9z', fill: true },
      { key: 'triangle', label: tt("Üçgen"), d: 'M12 4l9 16H3z', fill: true },
      { key: 'hexagon', label: tt("Altıgen"), d: 'M12 3l8 4.5v9L12 21l-8-4.5v-9z', fill: true },
      { key: 'target', label: tt("Hedef"), d: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10zM12 11v2' },
      { key: 'bolt', label: tt("Şimşek"), d: 'M13 2L4 14h7l-1 8 9-12h-7z', fill: true },
    ],
  },
  {
    id: 'finance',
    title: tt("Finans"),
    icons: [
      { key: 'bull', label: tt("Boğa"), d: 'M4 5c0 3 2 5 4 5h8c2 0 4-2 4-5M8 10l-1 9h3l1-5h2l1 5h3l-1-9' },
      { key: 'bear', label: tt("Ayı"), d: 'M6 7a2 2 0 1 1 3-1.5h6A2 2 0 1 1 18 7v4c0 4-3 8-6 8s-6-4-6-8z' },
      { key: 'dollar', label: tt("Dolar"), d: 'M12 3v18M16 7c-1-1.5-2.5-2-4-2-2.2 0-4 1.3-4 3.2 0 4.3 8 2.6 8 7 0 2-1.8 3.3-4 3.3-1.8 0-3.3-.7-4.2-2' },
      { key: 'coin', label: tt("Jeton"), d: 'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM9 9h4.5a1.5 1.5 0 0 1 0 3H9h5a1.5 1.5 0 0 1 0 3H9z' },
      { key: 'bank', label: tt("Banka"), d: 'M3 9l9-5 9 5M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18' },
      { key: 'chart-bar', label: tt("Sütun"), d: 'M4 20V10M10 20V4M16 20v-7M21 20H3' },
      { key: 'chart-pie', label: tt("Pasta"), d: 'M12 3v9h9A9 9 0 1 1 12 3zM15 3.5A9 9 0 0 1 20.5 9H15z' },
      { key: 'candle-up', label: tt("Yeşil mum"), d: 'M12 2v4M12 18v4M8 6h8v12H8z', fill: true },
      { key: 'wallet', label: tt("Cüzdan"), d: 'M3 7h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM3 7l12-3v3M16 13.5h2' },
      { key: 'percent', label: tt("Yüzde"), d: 'M19 5L5 19M7 5a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM17 15a2 2 0 1 0 0 4 2 2 0 0 0 0-4z' },
      { key: 'rocket', label: tt("Roket"), d: 'M12 2c4 3 5 8 3 13H9C7 10 8 5 12 2zM9 15l-3 4 4-1M15 15l3 4-4-1M12 8v.5' },
      { key: 'scale', label: tt("Terazi"), d: 'M12 3v18M5 21h14M4 7h16M7 7l-3 7a3 3 0 0 0 6 0zM17 7l-3 7a3 3 0 0 0 6 0z' },
    ],
  },
  {
    id: 'objects',
    title: tt("Nesneler"),
    icons: [
      { key: 'flag', label: tt("Bayrak"), d: 'M5 21V4M5 4h12l-3 4 3 4H5', fill: false },
      { key: 'pin', label: tt("İğne"), d: 'M12 22s7-7 7-12a7 7 0 1 0-14 0c0 5 7 12 7 12zM12 7a3 3 0 1 0 0 6 3 3 0 0 0 0-6z' },
      { key: 'bell', label: 'Zil', d: 'M6 17V11a6 6 0 1 1 12 0v6l2 2H4zM10 21h4' },
      { key: 'clock', label: tt("Saat"), d: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 3' },
      { key: 'calendar', label: tt("Takvim"), d: 'M4 6h16v14H4zM4 10h16M8 3v5M16 3v5' },
      { key: 'eye', label: tt("Göz"), d: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z' },
      { key: 'lock', label: tt("Kilit"), d: 'M6 11h12v10H6zM8 11V8a4 4 0 1 1 8 0v3' },
      { key: 'key', label: tt("Anahtar"), d: 'M8 15a4 4 0 1 1 3-6.7L20 8v4h-2v2h-3l-2 1' },
      { key: 'bulb', label: tt("Ampul"), d: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z' },
      { key: 'fire', label: tt("Ateş"), d: 'M12 22c4 0 7-3 7-7 0-5-5-7-4-12-3 2-5 5-5 8-1-1-2-2-2-4-2 2-3 5-3 8 0 4 3 7 7 7z', fill: true },
      { key: 'anchor', label: tt("Çapa"), d: 'M12 6a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM12 6v15M5 13a7 7 0 0 0 14 0M8 10h8' },
      { key: 'magnifier', label: tt("Büyüteç"), d: 'M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM15 15l6 6' },
      { key: 'chat', label: tt("Konuşma"), d: 'M4 5h16v11H9l-5 4z' },
      { key: 'news', label: tt("Haber"), d: 'M4 5h13v14H6a2 2 0 0 1-2-2zM17 9h3v8a2 2 0 0 1-2 2M7 9h7M7 12h7M7 15h4' },
      { key: 'shield', label: tt("Kalkan"), d: 'M12 3l8 3v6c0 5-4 8-8 9-4-1-8-4-8-9V6z' },
      { key: 'trophy', label: tt("Kupa"), d: 'M8 4h8v5a4 4 0 0 1-8 0zM8 6H4c0 3 2 4 4 4M16 6h4c0 3-2 4-4 4M12 13v4M8 21h8M9 17h6v4H9z' },
    ],
  },
  {
    id: 'nature',
    title: tt("Doğa"),
    icons: [
      { key: 'sun', label: tt("Güneş"), d: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2' },
      { key: 'moon', label: 'Ay', d: 'M20 14A8 8 0 1 1 10 4a6.5 6.5 0 0 0 10 10z', fill: true },
      { key: 'cloud', label: tt("Bulut"), d: 'M7 18a4 4 0 0 1-.5-8A6 6 0 0 1 18 9a4.5 4.5 0 0 1-.5 9z' },
      { key: 'rain', label: tt("Yağmur"), d: 'M7 14a4 4 0 0 1-.5-8A6 6 0 0 1 18 5a4.5 4.5 0 0 1-.5 9zM8 17l-1 3M12 17l-1 3M16 17l-1 3' },
      { key: 'snow', label: 'Kar', d: 'M12 2v20M3.3 7l17.4 10M3.3 17L20.7 7' },
      { key: 'leaf', label: tt("Yaprak"), d: 'M5 19C5 9 11 4 20 4c0 9-5 15-15 15zM5 19l8-8' },
      { key: 'tree', label: tt("Ağaç"), d: 'M12 2l6 8h-3l4 6H5l4-6H6zM12 16v6' },
      { key: 'mountain', label: tt("Dağ"), d: 'M2 20l7-12 4 6 3-4 6 10z' },
      { key: 'wave', label: tt("Dalga"), d: 'M2 12c2.5-3 5-3 7.5 0s5 3 7.5 0 3.5-2 5-1M2 17c2.5-3 5-3 7.5 0s5 3 7.5 0 3.5-2 5-1' },
      { key: 'globe', label: tt("Küre"), d: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18' },
    ],
  },
];

/** Emojiler (Unicode karakterleri; tarayıcının emoji yazı tipiyle çizilir). */
export const EMOJI_CATEGORIES: Array<{ id: string; title: string; items: string[] }> = [
  { id: 'faces', title: tt("Yüzler"), items: ['😀', '😃', '😄', '😁', '😆', '😅', '😂', '🙂', '😉', '😊', '😍', '😎', '🤔', '😐', '😑', '😶', '🙄', '😏', '😬', '😮', '😯', '😲', '😱', '😭', '😤', '😡', '🤯', '🥳', '😴', '🤑'] },
  { id: 'hands', title: tt("Eller"), items: ['👍', '👎', '👌', '✌️', '🤞', '👏', '🙌', '🙏', '💪', '👀', '👉', '👈', '👆', '👇', '✋', '🤝'] },
  { id: 'symbols', title: tt("Semboller"), items: ['✅', '❌', '⚠️', '❗', '❓', '💯', '🔥', '⭐', '💥', '💡', '🎯', '🚀', '📈', '📉', '💰', '💵', '💎', '🏦', '⏰', '📅', '📌', '🚩', '🔔', '🔒', '🔑', '⚡', '🌙', '☀️', '🌧️', '❄️'] },
  { id: 'animals', title: tt("Hayvanlar"), items: ['🐂', '🐻', '🐳', '🦈', '🐢', '🐇', '🦅', '🦊', '🐺', '🦁'] },
];

const ICON_MAP: Map<string, IconDef> = new Map(ICON_CATEGORIES.flatMap((c) => c.icons.map((i) => [i.key, i] as const)));

export const ALL_ICON_KEYS: string[] = [...ICON_MAP.keys()];

export function iconDef(key: string): IconDef | undefined {
  return ICON_MAP.get(key);
}

/** Çizimdeki `icon` değerini çözer: `i:anahtar` → SVG ikon; aksi halde emoji metni. */
export function resolveIcon(v: string | undefined): { kind: 'svg'; def: IconDef } | { kind: 'emoji'; char: string } {
  if (v && v.startsWith('i:')) {
    const def = iconDef(v.slice(2));
    if (def) return { kind: 'svg', def };
  }
  if (v && !v.startsWith('i:') && v.length <= 16) return { kind: 'emoji', char: v };
  return { kind: 'svg', def: ICON_MAP.get('star')! };
}

/** Seçici için küçük SVG önizlemesi (HTML). */
export function iconPreviewSvg(def: IconDef, size = 20): string {
  const paint = def.fill ? 'fill="currentColor" stroke="none"' : 'fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"';
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" ${paint}><path d="${def.d}"/></svg>`;
}
