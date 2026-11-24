import { tfmt, lang, t, tt } from '../state/i18n';
import { For, Show, createSignal, type JSX } from 'solid-js';
import { EMOJI_CATEGORIES, ICON_CATEGORIES, iconPreviewSvg, resolveIcon } from '../chart/drawing/iconSet';
import { toolLabel } from '../state/quickSearch';
import { rt } from '../state/runtime';
import { clampBarPos } from '../state/drawingPrefs';
import {
  chooseIcon,
  clearDrawings,
  pickSubTool,
  setMagnetMode,
  setTool,
  setUi,
  setZoomMode,
  toggleAllDrawingsLocked,
  toggleFavoriteTool,
  toggleStayInDrawing,
  ui,
  type GROUP_DEFAULTS,
} from '../state/store';
import { ICONS } from '../styles/icons';
import type { DrawingToolType } from '../types/market';
import { Icon } from './Icon';

/** Mobilde bir çizim aracı seçilince panel kapanır; grafik tam görünür kalır. */
function chooseTool(tool: DrawingToolType): void {
  setTool(tool);
  if (ui.mobile && tool !== 'cursor') setUi('toolsOpen', false);
}

type GroupKey = keyof typeof GROUP_DEFAULTS;

type ToolItem = { tool: DrawingToolType; label: string };

/** Standart sol araç çubuğu düzeni: her grup bölümlere (alt başlık) ayrılır. */
export const GROUPS: Array<{
  key: GroupKey;
  title: string;
  sections: Array<{ title: string; items: ToolItem[] }>;
}> = [
  {
    key: 'trend',
    title: tt("Trend Çizgisi Araçları"),
    sections: [
      {
        title: tt("Çizgiler"),
        items: [
          { tool: 'trendline', label: tt("Trend Çizgisi") },
          { tool: 'ray', label: tt("Trend Işını") },
          { tool: 'info_line', label: tt("Bilgi Çizgisi") },
          { tool: 'extended', label: tt("Uzatılmış Çizgi") },
          { tool: 'trend_angle', label: tt("Trend Açısı") },
          { tool: 'hline', label: tt("Yatay Destek / Direnç") },
          { tool: 'hray', label: tt("Yatay Işın") },
          { tool: 'vline', label: tt("Dikey Çizgi") },
          { tool: 'cross_line', label: tt("Çapraz Çizgi") },
        ],
      },
      {
        title: tt("Kanallar"),
        items: [
          { tool: 'channel', label: tt("Paralel Trend Kanalı") },
          { tool: 'regression', label: tt("Regresyon Trendi") },
          { tool: 'flat_channel', label: tt("Düz Üst/Alt") },
          { tool: 'disjoint_channel', label: tt("Ayrık Kanal") },
        ],
      },
      {
        title: 'Pitchfork',
        items: [
          { tool: 'pitchfork', label: 'Andrews Pitchfork' },
          { tool: 'schiff_pitchfork', label: 'Schiff Pitchfork' },
          { tool: 'mod_schiff_pitchfork', label: tt("Değiştirilmiş Schiff Pitchfork") },
          { tool: 'inside_pitchfork', label: tt("İç Pitchfork") },
        ],
      },
    ],
  },
  {
    key: 'fib',
    title: tt("Gann ve Fibonacci Araçları"),
    sections: [
      {
        title: 'Fibonacci',
        items: [
          { tool: 'fib', label: tt("Fib Düzeltmesi") },
          { tool: 'fib_ext', label: tt("Trend Tabanlı Fib Uzatması") },
          { tool: 'fib_channel', label: tt("Fib Kanalı") },
          { tool: 'fib_timezone', label: tt("Fib Zaman Bölgesi") },
          { tool: 'fib_speed_fan', label: tt("Fib Hız Direnci Yelpazesi") },
          { tool: 'fib_trend_time', label: tt("Trend Tabanlı Fib Zaman") },
          { tool: 'fib_circles', label: 'Fib Daireleri' },
          { tool: 'fib_spiral', label: tt("Fib Sarmalı") },
          { tool: 'fib_speed_arcs', label: tt("Fib Hız Direnci Yayları") },
          { tool: 'fib_wedge', label: 'Fib Kama' },
          { tool: 'fib_pitchfan', label: 'Pitchfan' },
        ],
      },
      {
        title: 'Gann',
        items: [
          { tool: 'gann_box', label: tt("Gann Kutusu") },
          { tool: 'gann_square_fixed', label: tt("Gann Karesi (Sabit)") },
          { tool: 'gann_square', label: tt("Gann Karesi") },
          { tool: 'gann_fan', label: tt("Gann Yelpazesi") },
        ],
      },
    ],
  },
  {
    key: 'patterns',
    title: tt("Formasyonlar"),
    sections: [
      {
        title: tt("Grafik Formasyonları"),
        items: [
          { tool: 'xabcd', label: 'XABCD Formasyonu' },
          { tool: 'cypher', label: tt("Cypher Formasyonu") },
          { tool: 'head_shoulders', label: tt("Omuz Baş Omuz") },
          { tool: 'abcd', label: 'ABCD Formasyonu' },
          { tool: 'triangle_pattern', label: tt("Üçgen Formasyonu") },
          { tool: 'three_drives', label: tt("Üç Sürüş Formasyonu") },
        ],
      },
      {
        title: tt("Elliott Dalgaları"),
        items: [
          { tool: 'elliott_impulse', label: tt("Elliott İtki Dalgası (12345)") },
          { tool: 'elliott_correction', label: tt("Elliott Düzeltme Dalgası (ABC)") },
          { tool: 'elliott_triangle', label: tt("Elliott Üçgen Dalgası (ABCDE)") },
          { tool: 'elliott_double', label: tt("Elliott İkili Kombinasyon Dalgası (WXY)") },
          { tool: 'elliott_triple', label: tt("Elliott Üçlü Kombinasyon Dalgası (WXYXZ)") },
        ],
      },
      {
        title: tt("Döngüler"),
        items: [
          { tool: 'cyclic_lines', label: tt("Döngüsel Çizgiler") },
          { tool: 'time_cycles', label: tt("Zaman Döngüleri") },
          { tool: 'sine_line', label: tt("Sinüs Çizgisi") },
        ],
      },
    ],
  },
  {
    key: 'measure',
    title: tt("Tahmin ve Ölçüm Araçları"),
    sections: [
      {
        title: tt("Tahmin"),
        items: [
          { tool: 'long_pos', label: tt("Alış (Long) Pozisyon") },
          { tool: 'short_pos', label: tt("Satış (Short) Pozisyon") },
          { tool: 'forecast', label: tt("Pozisyon Tahmini") },
          { tool: 'bars_pattern', label: tt("Çubuk Deseni") },
          { tool: 'ghost_feed', label: tt("Hayalet Akış") },
          { tool: 'projection', label: tt("Sektör (Projeksiyon)") },
        ],
      },
      {
        title: tt("Hacim Tabanlı"),
        items: [
          { tool: 'anchored_vwap', label: tt("Çapalı VWAP") },
          { tool: 'fixed_vp', label: tt("Sabit Aralık Hacim Profili") },
          { tool: 'anchored_vp', label: tt("Çapalı Hacim Profili") },
        ],
      },
      {
        title: tt("Ölçüm"),
        items: [
          { tool: 'price_range', label: tt("Fiyat Aralığı") },
          { tool: 'date_range', label: tt("Tarih Aralığı") },
          { tool: 'date_price_range', label: tt("Tarih ve Fiyat Aralığı") },
        ],
      },
    ],
  },
  {
    key: 'shapes',
    title: tt("Geometrik Şekiller"),
    sections: [
      {
        title: tt("Fırçalar"),
        items: [
          { tool: 'brush', label: tt("Fırça") },
          { tool: 'highlighter', label: tt("Vurgulayıcı") },
        ],
      },
      {
        title: tt("Oklar"),
        items: [
          { tool: 'arrow_marker', label: tt("Ok İşareti") },
          { tool: 'arrow', label: 'Ok' },
          { tool: 'arrow_up', label: tt("Yukarı Ok İşareti") },
          { tool: 'arrow_down', label: tt("Aşağı Ok İşareti") },
        ],
      },
      {
        title: tt("Şekiller"),
        items: [
          { tool: 'rect', label: tt("Dikdörtgen") },
          { tool: 'rotated_rect', label: tt("Döndürülmüş Dikdörtgen") },
          { tool: 'path', label: 'Yol' },
          { tool: 'circle', label: tt("Daire") },
          { tool: 'ellipse', label: tt("Elips") },
          { tool: 'polyline', label: tt("Çoklu Çizgi") },
          { tool: 'triangle', label: tt("Üçgen") },
          { tool: 'arc', label: tt("Yay") },
          { tool: 'curve', label: tt("Eğri") },
          { tool: 'double_curve', label: tt("Çift Eğri") },
        ],
      },
    ],
  },
  {
    key: 'text',
    title: tt("Yazı ve Not Araçları"),
    sections: [
      {
        title: tt("Yazı ve Notlar"),
        items: [
          { tool: 'text', label: tt("Metin") },
          { tool: 'anchored_text', label: tt("Çapalı Metin") },
          { tool: 'note', label: tt("Not") },
          { tool: 'price_note', label: tt("Fiyat Notu") },
          { tool: 'pin', label: tt("İğne") },
          { tool: 'table', label: tt("Tablo") },
          { tool: 'callout', label: tt("Açıklama Balonu") },
          { tool: 'comment', label: tt("Yorum") },
          { tool: 'price_label', label: tt("Fiyat Etiketi") },
          { tool: 'signpost', label: tt("Tabela") },
          { tool: 'flag_mark', label: tt("Bayrak İşareti") },
        ],
      },
    ],
  },
];

const toolIcon = (t: DrawingToolType) => ICONS[t as keyof typeof ICONS];

/** Alt menü ekranın altından taşarsa yukarı kaydırılır (sol çubuğun alt grupları için). */
export function fitFlyout(wrapper: HTMLElement): void {
  const fly = wrapper.querySelector<HTMLElement>('.tool-flyout');
  if (!fly) return;
  fly.style.top = '';
  const r = fly.getBoundingClientRect();
  const vh = window.innerHeight;
  if (r.height === 0 || r.bottom <= vh - 8) return;
  const shift = Math.min(r.bottom - (vh - 8), Math.max(0, r.top - 8));
  fly.style.top = `${-shift}px`;
}

function FavStar(props: { tool: DrawingToolType }): JSX.Element {
  const on = () => ui.favTools.includes(props.tool);
  return (
    <span
      class="tool-fav-star"
      classList={{ on: on() }}
      data-fav={props.tool}
      title={on() ? tt("Favorilerden çıkar") : tt("Favorilere ekle")}
      onClick={(e) => {
        e.stopPropagation();
        toggleFavoriteTool(props.tool);
      }}
    >
      <Icon svg={on() ? ICONS.starFilled : ICONS.star} />
    </span>
  );
}

function ToolGroup(props: { group: (typeof GROUPS)[number] }): JSX.Element {
  const current = () => ui.groupTool[props.group.key];
  // dokunmatikte :hover yok → etkin gruba tekrar dokununca alt araç menüsü açılır
  const [open, setOpen] = createSignal(false);
  return (
    <div class="tool-group-wrapper" data-group={props.group.key} onMouseEnter={(e) => fitFlyout(e.currentTarget)}>
      <button
        class="tool-btn"
        classList={{ active: ui.tool === current() }}
        data-tool={current()}
        title={props.group.title}
        onClick={() => {
          if (ui.mobile && ui.tool === current()) {
            setOpen(!open());
            return;
          }
          setOpen(false);
          chooseTool(current());
        }}
      >
        <Icon svg={toolIcon(current())} />
        <div class="tool-arrow" />
      </button>
      <div class="tool-flyout" classList={{ open: open() }}>
        <For each={props.group.sections}>
          {(sec) => (
            <>
              <div class="tool-flyout-section">{sec.title}</div>
              <For each={sec.items}>
                {(it) => (
                  <button
                    class="tool-flyout-item"
                    classList={{ active: current() === it.tool }}
                    data-subtool={it.tool}
                    onClick={(e) => {
                      e.stopPropagation();
                      pickSubTool(props.group.key, it.tool);
                      setOpen(false);
                      if (ui.mobile) setUi('toolsOpen', false);
                    }}
                  >
                    <Icon svg={toolIcon(it.tool)} /> <span class="tool-flyout-label">{lang() === 'en' ? toolLabel(it.tool, 'en') : it.label}</span>
                    <FavStar tool={it.tool} />
                  </button>
                )}
              </For>
            </>
          )}
        </For>
      </div>
    </div>
  );
}

/** Seçilen ikonun küçük önizlemesi (sol çubuk düğmesi ve favori çubuğu). */
function IconGlyph(props: { value: string; size?: number }): JSX.Element {
  const r = () => resolveIcon(props.value);
  return (
    <Show when={r().kind === 'svg'} fallback={<span class="icon-emoji">{(r() as { char: string }).char}</span>}>
      <Icon svg={iconPreviewSvg((r() as { def: Parameters<typeof iconPreviewSvg>[0] }).def, props.size ?? 18)} />
    </Show>
  );
}

/** İkon / emoji seçici ("Icons" grubu, kendi setimiz). */
function IconGroup(): JSX.Element {
  const [tab, setTab] = createSignal<'icons' | 'emoji'>('icons');
  const [open, setOpen] = createSignal(false);
  const pick = (v: string) => {
    chooseIcon(v);
    setOpen(false);
    if (ui.mobile) setUi('toolsOpen', false);
  };
  return (
    <div class="tool-group-wrapper" data-group="icons" onMouseEnter={(e) => fitFlyout(e.currentTarget)}>
      <button
        class="tool-btn"
        classList={{ active: ui.tool === 'icon' }}
        data-tool="icon"
        title={tt("İkonlar ve Emojiler")}
        onClick={() => {
          if (ui.mobile && ui.tool === 'icon') {
            setOpen(!open());
            return;
          }
          chooseTool('icon');
        }}
      >
        <IconGlyph value={ui.iconChoice} />
        <div class="tool-arrow" />
      </button>
      <div class="tool-flyout icon-picker" classList={{ open: open() }}>
        <div class="icon-picker-tabs">
          <button class="seg-btn" classList={{ active: tab() === 'icons' }} data-icon-tab="icons" onClick={(e) => (e.stopPropagation(), setTab('icons'))}>
            {tt("İkonlar")}
          </button>
          <button class="seg-btn" classList={{ active: tab() === 'emoji' }} data-icon-tab="emoji" onClick={(e) => (e.stopPropagation(), setTab('emoji'))}>
            {tt("Emojiler")}
          </button>
        </div>
        <Show
          when={tab() === 'icons'}
          fallback={
            <For each={EMOJI_CATEGORIES}>
              {(c) => (
                <>
                  <div class="tool-flyout-section">{c.title}</div>
                  <div class="icon-grid">
                    <For each={c.items}>
                      {(ch) => (
                        <button class="icon-cell emoji" data-icon={ch} classList={{ active: ui.iconChoice === ch }} onClick={(e) => (e.stopPropagation(), pick(ch))}>
                          {ch}
                        </button>
                      )}
                    </For>
                  </div>
                </>
              )}
            </For>
          }
        >
          <For each={ICON_CATEGORIES}>
            {(c) => (
              <>
                <div class="tool-flyout-section">{c.title}</div>
                <div class="icon-grid">
                  <For each={c.icons}>
                    {(ic) => (
                      <button
                        class="icon-cell"
                        data-icon={`i:${ic.key}`}
                        title={ic.label}
                        classList={{ active: ui.iconChoice === `i:${ic.key}` }}
                        onClick={(e) => (e.stopPropagation(), pick(`i:${ic.key}`))}
                      >
                        <Icon svg={iconPreviewSvg(ic, 20)} />
                      </button>
                    )}
                  </For>
                </div>
              </>
            )}
          </For>
        </Show>
      </div>
    </div>
  );
}

function SingleTool(props: { tool: DrawingToolType; title: string }): JSX.Element {
  return (
    <div class="tool-group-wrapper">
      <button
        class="tool-btn"
        classList={{ active: ui.tool === props.tool }}
        data-tool={props.tool}
        title={props.title}
        onClick={() => chooseTool(props.tool)}
      >
        <Icon svg={toolIcon(props.tool)} />
      </button>
    </div>
  );
}

/** Mıknatıs: tıklayınca aç/kapa; menüden zayıf / güçlü. */
function MagnetGroup(): JSX.Element {
  const [open, setOpen] = createSignal(false);
  return (
    <div class="tool-group-wrapper" data-group="magnet" onMouseEnter={(e) => fitFlyout(e.currentTarget)}>
      <button
        id="btn-magnet-mode"
        class="tool-btn"
        classList={{ active: ui.magnet }}
        data-magnet={ui.magnet ? ui.magnetMode : 'off'}
        title={tfmt("Mıknatıs: {0} (Ctrl/⌘ basılı tutunca geçici ters)", ui.magnet ? (ui.magnetMode === 'weak' ? tt("Zayıf") : tt("Güçlü")) : tt("Kapalı"))}
        onClick={() => {
          if (ui.mobile && ui.magnet) {
            setOpen(!open());
            return;
          }
          setUi('magnet', !ui.magnet);
        }}
      >
        <Icon svg={ui.magnetMode === 'weak' ? ICONS.magnetWeak : ICONS.magnetStrong} />
        <div class="tool-arrow" />
      </button>
      <div class="tool-flyout" classList={{ open: open() }}>
        <div class="tool-flyout-section">{tt("Mıknatıs")}</div>
        <button
          class="tool-flyout-item"
          data-magnet-mode="weak"
          classList={{ active: ui.magnet && ui.magnetMode === 'weak' }}
          onClick={(e) => (e.stopPropagation(), setMagnetMode('weak'), setOpen(false))}
        >
          <Icon svg={ICONS.magnetWeak} /> <span>{tt("Zayıf Mıknatıs")}</span>
        </button>
        <button
          class="tool-flyout-item"
          data-magnet-mode="strong"
          classList={{ active: ui.magnet && ui.magnetMode === 'strong' }}
          onClick={(e) => (e.stopPropagation(), setMagnetMode('strong'), setOpen(false))}
        >
          <Icon svg={ICONS.magnetStrong} /> <span>{tt("Güçlü Mıknatıs")}</span>
        </button>
      </div>
    </div>
  );
}

export function LeftBar(): JSX.Element {
  return (
    <aside class="titan-leftbar">
      <SingleTool tool="cursor" title={tt("İmleç (Crosshair)")} />
      <ToolGroup group={GROUPS[0]} />
      <ToolGroup group={GROUPS[1]} />
      <ToolGroup group={GROUPS[2]} />
      <ToolGroup group={GROUPS[3]} />
      <ToolGroup group={GROUPS[4]} />
      <ToolGroup group={GROUPS[5]} />
      <IconGroup />

      <div class="tool-sep" />

      <button
        class="tool-btn"
        classList={{ active: ui.tool === 'ruler' }}
        data-tool="ruler"
        title={t('left.ruler')}
        onClick={() => chooseTool('ruler')}
      >
        <Icon svg={ICONS.ruler} />
      </button>

      <button
        id="btn-zoom-in"
        class="tool-btn"
        classList={{ active: ui.zoomMode }}
        title={t('left.zoomIn')}
        onClick={() => setZoomMode(!ui.zoomMode)}
      >
        <Icon svg={ICONS.search} />
      </button>

      <button
        id="btn-zoom-out"
        class="tool-btn"
        title={t('left.zoomOut')}
        onClick={() => rt.chart?.zoomBy(0.67)}
      >
        <span style={{ 'font-size': '16px', 'font-weight': '600', 'line-height': '1' }}>−</span>
      </button>

      <div class="tool-sep" />

      <MagnetGroup />

      <button
        id="btn-stay-drawing"
        class="tool-btn"
        classList={{ active: ui.stayInDrawing }}
        title={t('left.stayDrawing')}
        onClick={toggleStayInDrawing}
      >
        <Icon svg={ICONS.stayDrawing} />
      </button>

      <button
        id="btn-lock-all-drawings"
        class="tool-btn"
        classList={{ active: ui.allDrawingsLocked }}
        title={t('left.lockAll')}
        onClick={toggleAllDrawingsLocked}
      >
        <span style={{ 'font-size': '14px', 'line-height': '1' }}>{ui.allDrawingsLocked ? '🔒' : '🔓'}</span>
      </button>

      <button
        id="btn-hide-drawings"
        class="tool-btn"
        classList={{ active: ui.hideDrawings }}
        title={t('left.hideDrawings')}
        onClick={() => setUi('hideDrawings', !ui.hideDrawings)}
      >
        <Icon svg={ICONS.eye} />
      </button>

      <button
        id="btn-clear-drawings"
        class="tool-btn"
        title={t('left.clearDrawings')}
        onClick={() => {
          clearDrawings();
          rt.overlay?.render();
        }}
      >
        <Icon svg={ICONS.trash} />
      </button>

      <div class="tool-sep" />

      <button
        id="btn-fav-bar"
        class="tool-btn"
        classList={{ active: ui.favBarVisible }}
        title={t('left.favBar')}
        onClick={() => setUi('favBarVisible', !ui.favBarVisible)}
      >
        <Icon svg={ui.favBarVisible ? ICONS.starFilled : ICONS.star} />
      </button>
    </aside>
  );
}

/** Standart favori çizim araçları çubuğu: yüzen, tutamaktan sürüklenir, konum kalıcı. */
export function FavToolsBar(): JSX.Element {
  let drag: { sx: number; sy: number; ox: number; oy: number } | null = null;
  const move = (e: PointerEvent) => {
    if (!drag) return;
    setUi('favBarPos', clampBarPos({ x: drag.ox + e.clientX - drag.sx, y: drag.oy + e.clientY - drag.sy }, window.innerWidth, window.innerHeight));
  };
  const up = () => {
    drag = null;
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
  };
  return (
    <Show when={ui.favBarVisible && ui.favTools.length > 0 && !ui.mobile}>
      <div id="fav-tools-bar" class="fav-tools-bar" style={{ left: `${ui.favBarPos.x}px`, top: `${ui.favBarPos.y}px` }}>
        <div
          class="fav-bar-grip"
          title={lang() === 'en' ? 'Move' : 'Taşı'}
          onPointerDown={(e) => {
            drag = { sx: e.clientX, sy: e.clientY, ox: ui.favBarPos.x, oy: ui.favBarPos.y };
            window.addEventListener('pointermove', move);
            window.addEventListener('pointerup', up);
          }}
        />
        <For each={ui.favTools}>
          {(tool) => (
            <button
              class="tool-btn"
              classList={{ active: ui.tool === tool }}
              data-favtool={tool}
              title={toolLabel(tool, lang())}
              onClick={() => (tool === 'icon' ? chooseIcon(ui.iconChoice) : setTool(tool))}
            >
              <Show when={tool === 'icon'} fallback={<Icon svg={toolIcon(tool)} />}>
                <IconGlyph value={ui.iconChoice} />
              </Show>
            </button>
          )}
        </For>
      </div>
    </Show>
  );
}
