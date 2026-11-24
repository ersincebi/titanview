import { For, Show, createEffect, createSignal, onCleanup, type JSX } from 'solid-js';
import { fetchSourcesStatus, updateSourcesStatus, type SourcesStatus } from '../api/client';
import { normalizeStyleParams, type StyleParams } from '../chart/chartTypes';
import { TIMEZONE_CHOICES } from '../chart/timezone';
import {
  DEFAULT_CHART_SETTINGS,
  cloneChartSettings,
  deleteSettingsTemplate,
  loadSettingsTemplates,
  saveSettingsTemplate,
  type BackgroundMode,
  type ChartSettings,
  type CrosshairStyleOption,
  type PnlDisplayMode,
  type PrecisionOption,
  type SettingsTabId,
  type SettingsTemplate,
  type TitleMode,
} from '../state/chartSettings';
import { lang, t, tt } from '../state/i18n';
import {
  applyChartSettingsAll,
  loadErrorUnofficial,
  loadSymbolData,
  setScale,
  setUi,
  switchColorTheme,
  toast,
  toggleInvertScale,
  toggleScaleLock,
  ui,
} from '../state/store';
import {
  addCustomColorTheme,
  availableColorThemes,
  colorThemeId,
  removeCustomColorTheme,
} from '../state/theme';
import type { PriceScaleKind } from '../types/market';
import { Modal } from './Modal';

/** Ayarlar penceresinin açık sekmesi (grafik tipi menüsü doğrudan "Sembol"e, ölçek menüsü "Ölçekler"e açar). */
export const [settingsTab, setSettingsTab] = createSignal<SettingsTabId>('symbol');

type NumField = { kind: 'num'; key: string; labelTr: string; labelEn: string; step?: number; min?: number };
type SelField = { kind: 'sel'; key: string; labelTr: string; labelEn: string; options: Array<[string, string, string]> };

const STYLE_FIELDS: Array<{ id: keyof StyleParams; titleTr: string; titleEn: string; fields: Array<NumField | SelField> }> = [
  {
    id: 'renko', titleTr: 'Renko', titleEn: 'Renko',
    fields: [
      { kind: 'sel', key: 'mode', labelTr: 'Kutu boyutu', labelEn: 'Box size assignment', options: [['atr', 'ATR', 'ATR'], ['fixed', tt("Sabit"), 'Traditional']] },
      { kind: 'num', key: 'atrLen', labelTr: 'ATR uzunluğu', labelEn: 'ATR length', min: 1, step: 1 },
      { kind: 'num', key: 'box', labelTr: 'Sabit kutu', labelEn: 'Box size', min: 0, step: 0.01 },
    ],
  },
  {
    id: 'kagi', titleTr: 'Kagi', titleEn: 'Kagi',
    fields: [
      { kind: 'sel', key: 'mode', labelTr: 'Dönüş miktarı', labelEn: 'Reversal amount', options: [['atr', 'ATR', 'ATR'], ['percent', tt("Yüzde"), 'Percent'], ['fixed', tt("Sabit"), 'Traditional']] },
      { kind: 'num', key: 'atrLen', labelTr: 'ATR uzunluğu', labelEn: 'ATR length', min: 1, step: 1 },
      { kind: 'num', key: 'value', labelTr: 'Değer (yüzde/sabit)', labelEn: 'Value', min: 0, step: 0.01 },
    ],
  },
  {
    id: 'pnf', titleTr: 'Nokta ve şekil', titleEn: 'Point & figure',
    fields: [
      { kind: 'sel', key: 'mode', labelTr: 'Kutu boyutu', labelEn: 'Box size assignment', options: [['atr', 'ATR', 'ATR'], ['percent', tt("Yüzde"), 'Percent'], ['fixed', tt("Sabit"), 'Traditional']] },
      { kind: 'num', key: 'atrLen', labelTr: 'ATR uzunluğu', labelEn: 'ATR length', min: 1, step: 1 },
      { kind: 'num', key: 'box', labelTr: 'Kutu (yüzde/sabit)', labelEn: 'Box size', min: 0, step: 0.01 },
      { kind: 'num', key: 'reversal', labelTr: 'Dönüş (kutu)', labelEn: 'Reversal', min: 1, step: 1 },
      { kind: 'sel', key: 'source', labelTr: 'Kaynak', labelEn: 'Source', options: [['close', tt("Kapanış"), 'Close'], ['hl', tt("Yüksek/Düşük"), 'High/Low']] },
    ],
  },
  {
    id: 'range', titleTr: 'Range', titleEn: 'Range',
    fields: [
      { kind: 'sel', key: 'mode', labelTr: 'Aralık', labelEn: 'Range mode', options: [['atr', 'ATR/2', 'ATR/2'], ['fixed', tt("Sabit"), 'Fixed']] },
      { kind: 'num', key: 'atrLen', labelTr: 'ATR uzunluğu', labelEn: 'ATR length', min: 1, step: 1 },
      { kind: 'num', key: 'range', labelTr: 'Sabit aralık', labelEn: 'Fixed range', min: 0, step: 0.01 },
    ],
  },
  {
    id: 'linebreak', titleTr: 'Çizgi kırılımı', titleEn: 'Line break',
    fields: [{ kind: 'num', key: 'lines', labelTr: 'Çizgi sayısı', labelEn: 'Number of lines', min: 1, step: 1 }],
  },
  {
    id: 'profile', titleTr: 'Hacim profili (seans / görünür)', titleEn: 'Volume profile (session / visible)',
    fields: [
      { kind: 'num', key: 'rows', labelTr: 'Satır sayısı', labelEn: 'Row size', min: 4, step: 1 },
      { kind: 'num', key: 'vaPct', labelTr: 'Değer alanı %', labelEn: 'Value area %', min: 1, step: 1 },
    ],
  },
  {
    id: 'tpo', titleTr: 'TPO', titleEn: 'TPO',
    fields: [{ kind: 'num', key: 'periodMin', labelTr: 'Periyot (dk)', labelEn: 'Block size (min)', min: 1, step: 1 }],
  },
  {
    id: 'footprint', titleTr: 'Footprint', titleEn: 'Volume footprint',
    fields: [{ kind: 'num', key: 'row', labelTr: 'Satır yüksekliği (0 = oto)', labelEn: 'Row height (0 = auto)', min: 0, step: 0.01 }],
  },
];

function StyleParamsForm(props: { value: StyleParams; onChange: (v: StyleParams) => void }): JSX.Element {
  const en = () => lang() === 'en';
  const set = (id: keyof StyleParams, key: string, v: string | number) =>
    props.onChange(normalizeStyleParams({ ...props.value, [id]: { ...(props.value[id] as object), [key]: v } }));
  return (
    <div class="stp-grid" id="style-params-form">
      <For each={STYLE_FIELDS}>
        {(g) => (
          <>
            <div class="stp-title">{en() ? g.titleEn : g.titleTr}</div>
            <For each={g.fields}>
              {(f) => {
                const cur = () => (props.value[g.id] as unknown as Record<string, string | number>)[f.key];
                return (
                  <>
                    <span class="settings-label">{en() ? f.labelEn : f.labelTr}</span>
                    {f.kind === 'sel' ? (
                      <select data-stp={`${g.id}.${f.key}`} value={String(cur())} onChange={(e) => set(g.id, f.key, e.currentTarget.value)}>
                        <For each={f.options}>{([v, lTr, lEn]) => <option value={v}>{en() ? lEn : lTr}</option>}</For>
                      </select>
                    ) : (
                      <input
                        type="number"
                        data-stp={`${g.id}.${f.key}`}
                        min={f.min}
                        step={f.step ?? 1}
                        value={Number(cur())}
                        onChange={(e) => {
                          const n = Number(e.currentTarget.value);
                          if (Number.isFinite(n)) set(g.id, f.key, n);
                        }}
                      />
                    )}
                  </>
                );
              }}
            </For>
          </>
        )}
      </For>
    </div>
  );
}

const TAB_LIST: Array<{ id: SettingsTabId; key: string; icon: string }> = [
  { id: 'symbol', key: 'cfg.tab.symbol', icon: '🕯' },
  { id: 'status', key: 'cfg.tab.status', icon: '☰' },
  { id: 'scales', key: 'cfg.tab.scales', icon: '⇅' },
  { id: 'canvas', key: 'cfg.tab.canvas', icon: '◫' },
  { id: 'trading', key: 'cfg.tab.trading', icon: '⚡' },
  { id: 'alerts', key: 'cfg.tab.alerts', icon: '⏰' },
  { id: 'events', key: 'cfg.tab.events', icon: '📅' },
  { id: 'sources', key: 'cfg.tab.sources', icon: '🌐' },
];

/**
 * Faz 29: 7 Sekmeli Ayarlar Penceresi (`750 × 612px`, `206px` sol sekme sütunu,
 * `40px` sekme satırı, alt solda Template açılır menüsü, alt sağda Cancel / Ok).
 */
export function SettingsModal(): JSX.Element {
  const en = () => lang() === 'en';
  const L = (tr: string, enTxt: string) => (en() ? enTxt : tr);
  const close = () => setUi('modal', null);

  const [draft, setDraft] = createSignal<ChartSettings>(cloneChartSettings(ui.chartSettings));
  const [draftP, setDraftP] = createSignal<StyleParams>(normalizeStyleParams(ui.styleParams));
  const [tplOpen, setTplOpen] = createSignal(false);
  const [tplName, setTplName] = createSignal('');
  const [templates, setTemplates] = createSignal<SettingsTemplate[]>(loadSettingsTemplates());
  const [customThemeName, setCustomThemeName] = createSignal('');
  const [customAccent, setCustomAccent] = createSignal('#0284C7');
  const [customPanel, setCustomPanel] = createSignal('#131313');

  // Veri kaynakları (resmî olmayan uçlar varsayılan kapalı; açık kullanıcı onayı gerektirir)
  const [sourcesStatus, setSourcesStatus] = createSignal<SourcesStatus | null>(null);
  const [sourcesBusy, setSourcesBusy] = createSignal(false);
  const [sourcesErr, setSourcesErr] = createSignal<string | null>(null);
  const [consentOpen, setConsentOpen] = createSignal(false);
  const [consentChecked, setConsentChecked] = createSignal(false);

  const tab = settingsTab;
  const setTab = setSettingsTab;
  onCleanup(() => setSettingsTab('symbol'));

  const refreshSources = async () => {
    setSourcesBusy(true);
    setSourcesErr(null);
    try {
      const st = await fetchSourcesStatus();
      setSourcesStatus(st);
    } catch (e) {
      setSourcesErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSourcesBusy(false);
    }
  };

  createEffect(() => {
    if (tab() === 'sources' && sourcesStatus() === null && !sourcesBusy()) {
      void refreshSources();
    }
  });

  const confirmEnableUnofficial = async () => {
    if (!consentChecked() || sourcesBusy()) return;
    setSourcesBusy(true);
    setSourcesErr(null);
    try {
      const st = await updateSourcesStatus(true, true);
      setSourcesStatus(st);
      setConsentOpen(false);
      setConsentChecked(false);
      toast(L('Resmî olmayan veri kaynakları etkinleştirildi', 'Unofficial data sources enabled'));
      if (loadErrorUnofficial()) {
        void loadSymbolData(ui.symbol, ui.interval);
      }
    } catch (e) {
      setSourcesErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSourcesBusy(false);
    }
  };

  const disableUnofficial = async () => {
    if (sourcesBusy()) return;
    setSourcesBusy(true);
    setSourcesErr(null);
    try {
      const st = await updateSourcesStatus(false, false);
      setSourcesStatus(st);
      setConsentOpen(false);
      setConsentChecked(false);
      toast(L('Resmî olmayan veri kaynakları kapatıldı', 'Unofficial data sources disabled'));
    } catch (e) {
      setSourcesErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSourcesBusy(false);
    }
  };

  const patch = <S extends keyof ChartSettings, K extends keyof ChartSettings[S]>(
    section: S,
    key: K,
    value: ChartSettings[S][K]
  ) => {
    setDraft((prev) => ({
      ...prev,
      [section]: { ...prev[section], [key]: value },
    }));
  };

  const row = (label: string, control: JSX.Element) => (
    <div class="settings-row">
      <span class="settings-label">{label}</span>
      <div class="settings-control">{control}</div>
    </div>
  );

  const section = (title: string) => <div class="settings-section-cap">{title}</div>;

  const resetDefaults = () => {
    setDraft(cloneChartSettings(DEFAULT_CHART_SETTINGS));
    setDraftP(normalizeStyleParams({}));
    setTplOpen(false);
    toast(L('Varsayılan ayarlar yüklendi', 'Defaults applied'));
  };

  const saveTpl = () => {
    if (!tplName().trim()) return;
    setTemplates(saveSettingsTemplate(tplName(), draft()));
    setTplName('');
    toast(L('Ayar şablonu kaydedildi', 'Settings template saved'));
  };

  const saveTheme = () => {
    const nm = customThemeName().trim();
    if (!nm) return;
    const d = draft();
    const isLight = d.canvas.bgColor.toLowerCase() === '#ffffff' || d.canvas.bgColor.toLowerCase().startsWith('#f');
    addCustomColorTheme({
      nameTr: nm,
      nameEn: nm,
      base: isLight ? 'light' : 'dark',
      bgCanvas: d.canvas.bgColor,
      bgPanel: customPanel(),
      bgElevated: customPanel(),
      bgHover: isLight ? '#ebebeb' : '#262626',
      borderColor: d.canvas.scaleLineColor,
      textPrimary: isLight ? '#131722' : '#d1d4dc',
      textSecondary: d.canvas.scaleTextColor,
      textStrong: isLight ? '#000000' : '#ffffff',
      accent: customAccent(),
      bull: d.symbol.upColor,
      bear: d.symbol.downColor,
      gridColor: d.canvas.vertGridColor,
    });
    setCustomThemeName('');
    toast(L(`Özel tema kaydedildi: ${nm}`, `Custom theme saved: ${nm}`));
  };

  const commit = () => {
    applyChartSettingsAll(draft());
    setUi('styleParams', normalizeStyleParams(draftP()));
    close();
  };

  return (
    <Modal id="modal-settings" title={t('cfg.title')} width="750px" className="tv-modal-settings">
      <div class="settings-layout tv-settings-7">
        {/* Sol sekme sütunu: Standart 206px, satır 40px */}
        <div class="modal-tabs-nav settings-sidebar" role="tablist">
          <For each={TAB_LIST}>
            {(tb) => (
              <button
                role="tab"
                aria-selected={tab() === tb.id}
                class="modal-tab-btn settings-tab-item"
                classList={{ active: tab() === tb.id }}
                data-cfg-tab={tb.id}
                onClick={() => setTab(tb.id)}
              >
                <span class="settings-tab-ico">{tb.icon}</span>
                <span>{t(tb.key)}</span>
              </button>
            )}
          </For>
        </div>

        {/* Sağ form gövdesi */}
        <div class="tv-modal-body settings-content-pane" id="settings-modal-body">
          {/* 1. SYMBOL */}
          <Show when={tab() === 'symbol'}>
            {section(L('MUMLAR', 'CANDLES'))}
            {row(
              L('Önceki kapanışa göre renklendir', 'Color bars based on previous close'),
              <input
                type="checkbox"
                id="cfg-sym-prevclose"
                checked={draft().symbol.colorBasedOnPrevClose}
                onChange={(e) => patch('symbol', 'colorBasedOnPrevClose', e.currentTarget.checked)}
              />
            )}
            {row(
              L('Gövde', 'Body'),
              <>
                <input type="checkbox" checked={draft().symbol.showBody} onChange={(e) => patch('symbol', 'showBody', e.currentTarget.checked)} />
                <input type="color" id="cfg-color-up" title={L('Yükseliş', 'Up')} value={draft().symbol.upColor} onInput={(e) => patch('symbol', 'upColor', e.currentTarget.value)} />
                <input type="color" id="cfg-color-down" title={L('Düşüş', 'Down')} value={draft().symbol.downColor} onInput={(e) => patch('symbol', 'downColor', e.currentTarget.value)} />
              </>
            )}
            {row(
              L('Kenarlık', 'Borders'),
              <>
                <input type="checkbox" checked={draft().symbol.showBorders} onChange={(e) => patch('symbol', 'showBorders', e.currentTarget.checked)} />
                <input type="color" value={draft().symbol.borderUpColor} onInput={(e) => patch('symbol', 'borderUpColor', e.currentTarget.value)} />
                <input type="color" value={draft().symbol.borderDownColor} onInput={(e) => patch('symbol', 'borderDownColor', e.currentTarget.value)} />
              </>
            )}
            {row(
              L('Fitil', 'Wick'),
              <>
                <input type="checkbox" checked={draft().symbol.showWick} onChange={(e) => patch('symbol', 'showWick', e.currentTarget.checked)} />
                <input type="color" value={draft().symbol.wickUpColor} onInput={(e) => patch('symbol', 'wickUpColor', e.currentTarget.value)} />
                <input type="color" value={draft().symbol.wickDownColor} onInput={(e) => patch('symbol', 'wickDownColor', e.currentTarget.value)} />
              </>
            )}

            {section(L('VERİ DÜZENLEME', 'DATA MODIFICATION'))}
            {row(
              L('Hassasiyet', 'Precision'),
              <select
                id="cfg-sym-precision"
                class="script-select"
                value={draft().symbol.precision}
                onChange={(e) => patch('symbol', 'precision', e.currentTarget.value as PrecisionOption)}
              >
                <option value="default">{L('Varsayılan', 'Default')}</option>
                <option value="1">1</option>
                <option value="10">1/10</option>
                <option value="100">1/100</option>
                <option value="1000">1/1000</option>
                <option value="10000">1/10000</option>
                <option value="100000">1/100000</option>
              </select>
            )}
            {row(
              L('Zaman dilimi', 'Timezone'),
              <select
                id="cfg-sym-timezone"
                class="script-select"
                value={draft().symbol.timezone}
                onChange={(e) => patch('symbol', 'timezone', e.currentTarget.value)}
              >
                <For each={TIMEZONE_CHOICES}>
                  {(tz) => <option value={tz.id}>{en() ? tz.labelEn : tz.labelTr}</option>}
                </For>
              </select>
            )}
            {row(
              L('Seans', 'Session'),
              <select
                id="cfg-sym-session"
                class="script-select"
                value={draft().symbol.session}
                onChange={(e) => patch('symbol', 'session', e.currentTarget.value as 'regular' | 'extended')}
              >
                <option value="regular">{L('Normal işlem saatleri (RTH)', 'Regular trading hours (RTH)')}</option>
                <option value="extended">{L('Uzatılmış işlem saatleri (ETH)', 'Extended trading hours (ETH)')}</option>
              </select>
            )}

            {section(L('TÜRETİLMİŞ GRAFİK PARAMETRELERİ', 'CHART TYPE PARAMETERS'))}
            <StyleParamsForm value={draftP()} onChange={setDraftP} />
          </Show>

          {/* 2. STATUS LINE */}
          <Show when={tab() === 'status'}>
            {section(L('ENSTRÜMAN', 'INSTRUMENT'))}
            {row(
              L('Sembol başlığı', 'Title'),
              <>
                <input type="checkbox" id="cfg-st-title" checked={draft().status.showTitle} onChange={(e) => patch('status', 'showTitle', e.currentTarget.checked)} />
                <select
                  id="cfg-st-title-mode"
                  class="script-select"
                  value={draft().status.titleMode}
                  onChange={(e) => patch('status', 'titleMode', e.currentTarget.value as TitleMode)}
                >
                  <option value="ticker">{L('Sembol kodu', 'Ticker')}</option>
                  <option value="description">{L('Açıklama (Ad)', 'Description')}</option>
                  <option value="both">{L('Kod ve açıklama', 'Ticker and description')}</option>
                </select>
              </>
            )}
            {row(
              L('OHLC değerleri', 'OHLC values'),
              <input type="checkbox" id="cfg-st-ohlc" checked={draft().status.showOhlc} onChange={(e) => patch('status', 'showOhlc', e.currentTarget.checked)} />
            )}
            {row(
              L('Bar değişim değerleri', 'Bar change values'),
              <input type="checkbox" id="cfg-st-change" checked={draft().status.showBarChange} onChange={(e) => patch('status', 'showBarChange', e.currentTarget.checked)} />
            )}
            {row(
              L('Hacim', 'Volume'),
              <input type="checkbox" id="cfg-st-vol" checked={draft().status.showVolume} onChange={(e) => patch('status', 'showVolume', e.currentTarget.checked)} />
            )}
            {row(
              L('Veri durumu / gecikme çipleri', 'Feed / delay status chips'),
              <input type="checkbox" id="cfg-st-feed" checked={draft().status.showFeedChips} onChange={(e) => patch('status', 'showFeedChips', e.currentTarget.checked)} />
            )}
            {row(
              L('Al / Sat hızlı işlem kutuları', 'Buy/sell buttons'),
              <input type="checkbox" id="cfg-st-buysell" checked={draft().status.showBuySell} onChange={(e) => patch('status', 'showBuySell', e.currentTarget.checked)} />
            )}

            {section(L('GÖSTERGELER', 'INDICATORS'))}
            {row(
              L('Gösterge başlıkları', 'Titles'),
              <input type="checkbox" id="cfg-st-ind-titles" checked={draft().status.showIndTitles} onChange={(e) => patch('status', 'showIndTitles', e.currentTarget.checked)} />
            )}
            {row(
              L('Gösterge değerleri', 'Values'),
              <input type="checkbox" id="cfg-st-ind-vals" checked={draft().status.showIndValues} onChange={(e) => patch('status', 'showIndValues', e.currentTarget.checked)} />
            )}
            {row(
              L('Durum çubuğu arka plan opaklığı', 'Background opacity'),
              <>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={draft().status.bgOpacity}
                  onInput={(e) => patch('status', 'bgOpacity', Number(e.currentTarget.value))}
                />
                <span class="settings-val">{draft().status.bgOpacity}%</span>
              </>
            )}
          </Show>

          {/* 3. SCALES AND LINES */}
          <Show when={tab() === 'scales'}>
            {section(L('FİYAT ÖLÇEĞİ', 'PRICE SCALE'))}
            {row(
              L('Ölçek yerleşimi', 'Scales placement'),
              <select
                id="cfg-sc-placement"
                class="script-select"
                value={draft().scales.placement}
                onChange={(e) => patch('scales', 'placement', e.currentTarget.value as 'right' | 'left')}
              >
                <option value="right">{L('Sağ', 'Right')}</option>
                <option value="left">{L('Sol', 'Left')}</option>
              </select>
            )}
            {row(
              L('Ölçek modu', 'Scale mode'),
              <select
                id="cfg-sc-mode"
                class="script-select"
                value={ui.scaleKind}
                onChange={(e) => setScale(e.currentTarget.value as PriceScaleKind)}
              >
                <option value="normal">{L('Normal', 'Regular')}</option>
                <option value="log">{L('Logaritmik', 'Logarithmic')}</option>
                <option value="percent">{L('Yüzde (%)', 'Percent (%)')}</option>
                <option value="indexed">{L("100'e İndeksli", 'Indexed to 100')}</option>
              </select>
            )}
            {row(
              L('Fiyat / bar oranını kilitle', 'Lock price to bar ratio'),
              <input type="checkbox" id="cfg-sc-lock" checked={ui.scaleLock} onChange={toggleScaleLock} />
            )}
            {row(
              L('Ters fiyat ölçeği', 'Invert scale'),
              <input type="checkbox" id="cfg-sc-invert" checked={ui.invertScale} onChange={toggleInvertScale} />
            )}

            {section(L('FİYAT ETİKETLERİ VE ÇİZGİLER', 'PRICE LABELS & LINES'))}
            {row(
              L('Çakışmayan etiketler', 'No overlapping labels'),
              <input type="checkbox" checked={draft().scales.noOverlappingLabels} onChange={(e) => patch('scales', 'noOverlappingLabels', e.currentTarget.checked)} />
            )}
            {row(
              L('Bar kapanışına geri sayım', 'Countdown to bar close'),
              <input type="checkbox" id="cfg-sc-countdown" checked={draft().scales.showCountdown} onChange={(e) => patch('scales', 'showCountdown', e.currentTarget.checked)} />
            )}
            {row(
              L('Sembol son fiyat çizgisi', 'Symbol last price line'),
              <input type="checkbox" id="cfg-sc-lastline" checked={draft().scales.showLastPriceLine} onChange={(e) => patch('scales', 'showLastPriceLine', e.currentTarget.checked)} />
            )}
            {row(
              L('Sembol son fiyat etiketi', 'Symbol last price label'),
              <input type="checkbox" checked={draft().scales.showLastPriceLabel} onChange={(e) => patch('scales', 'showLastPriceLabel', e.currentTarget.checked)} />
            )}
            {row(
              L('Yüksek ve düşük fiyat çizgileri', 'High and low price lines'),
              <input type="checkbox" id="cfg-sc-highlow" checked={draft().scales.showHighLowLines} onChange={(e) => patch('scales', 'showHighLowLines', e.currentTarget.checked)} />
            )}
            {row(
              L('Gösterge ölçek etiketleri', 'Indicator value labels'),
              <input type="checkbox" checked={draft().scales.showIndLabels} onChange={(e) => patch('scales', 'showIndLabels', e.currentTarget.checked)} />
            )}

            {section(L('ZAMAN ÖLÇEĞİ', 'TIME SCALE'))}
            {row(
              L('Seans arası / gün sonu ayırıcıları', 'Session breaks / end-of-day dividers'),
              <>
                <input
                  type="checkbox"
                  id="cfg-sc-session-breaks"
                  checked={draft().scales.showSessionBreaks}
                  onChange={(e) => patch('scales', 'showSessionBreaks', e.currentTarget.checked)}
                />
                <input
                  type="color"
                  value={draft().scales.sessionBreakColor}
                  onInput={(e) => patch('scales', 'sessionBreakColor', e.currentTarget.value)}
                />
              </>
            )}
            {row(
              L('Saat biçimi', 'Time hours format'),
              <select
                id="cfg-sc-timefmt"
                class="script-select"
                value={draft().scales.timeFormat}
                onChange={(e) => patch('scales', 'timeFormat', e.currentTarget.value as '24h' | '12h')}
              >
                <option value="24h">{L('24 saat', '24-hours')}</option>
                <option value="12h">{L('12 saat (AM/PM)', '12-hours')}</option>
              </select>
            )}
            {row(
              L('Etiketlerde haftanın günü', 'Day of week on labels'),
              <input type="checkbox" id="cfg-sc-dow" checked={draft().scales.showDayOfWeek} onChange={(e) => patch('scales', 'showDayOfWeek', e.currentTarget.checked)} />
            )}
          </Show>

          {/* 4. CANVAS & COLOR THEMES */}
          <Show when={tab() === 'canvas'}>
            {section(L('RENK TEMALARI', 'COLOR THEMES'))}
            <div class="theme-chips-grid" id="cfg-theme-list">
              <For each={availableColorThemes()}>
                {(th) => (
                  <div class="theme-chip-wrap" data-theme-id={th.id}>
                    <button
                      type="button"
                      class="chip-btn theme-chip-btn"
                      classList={{ active: colorThemeId() === th.id }}
                      onClick={() => {
                        switchColorTheme(th.id);
                        patch('canvas', 'bgColor', th.bgCanvas);
                        patch('canvas', 'vertGridColor', th.gridColor);
                        patch('canvas', 'horzGridColor', th.gridColor);
                        patch('canvas', 'scaleTextColor', th.textSecondary);
                        patch('canvas', 'scaleLineColor', th.borderColor);
                        patch('symbol', 'upColor', th.bull);
                        patch('symbol', 'downColor', th.bear);
                      }}
                    >
                      <span class="theme-swatch" style={{ background: th.bgCanvas, 'border-color': th.accent }} />
                      <span>{en() ? th.nameEn : th.nameTr}</span>
                    </button>
                    <Show when={!th.builtin}>
                      <button
                        type="button"
                        class="ind-action-btn"
                        data-del-theme={th.id}
                        title={L('Özel temayı sil', 'Delete custom theme')}
                        onClick={() => removeCustomColorTheme(th.id)}
                      >
                        ✕
                      </button>
                    </Show>
                  </div>
                )}
              </For>
            </div>

            {section(L('GRAFİK TEMEL STİLLERİ', 'CHART BASIC STYLES'))}
            {row(
              L('Arka plan', 'Background'),
              <>
                <select
                  id="cfg-bg-mode"
                  class="script-select"
                  value={draft().canvas.bgMode}
                  onChange={(e) => patch('canvas', 'bgMode', e.currentTarget.value as BackgroundMode)}
                >
                  <option value="solid">{L('Düz', 'Solid')}</option>
                  <option value="gradient">{L('Gradyan', 'Gradient')}</option>
                </select>
                <input type="color" id="cfg-color-bg" value={draft().canvas.bgColor} onInput={(e) => patch('canvas', 'bgColor', e.currentTarget.value)} />
                <Show when={draft().canvas.bgMode === 'gradient'}>
                  <input type="color" value={draft().canvas.bgColor2} onInput={(e) => patch('canvas', 'bgColor2', e.currentTarget.value)} />
                </Show>
              </>
            )}
            {row(
              L('Dikey ızgara çizgileri', 'Vert grid lines'),
              <>
                <input type="checkbox" id="cfg-check-grid" checked={draft().canvas.showVertGrid} onChange={(e) => patch('canvas', 'showVertGrid', e.currentTarget.checked)} />
                <input type="color" value={draft().canvas.vertGridColor} onInput={(e) => patch('canvas', 'vertGridColor', e.currentTarget.value)} />
              </>
            )}
            {row(
              L('Yatay ızgara çizgileri', 'Horz grid lines'),
              <>
                <input type="checkbox" id="cfg-check-hgrid" checked={draft().canvas.showHorzGrid} onChange={(e) => patch('canvas', 'showHorzGrid', e.currentTarget.checked)} />
                <input type="color" value={draft().canvas.horzGridColor} onInput={(e) => patch('canvas', 'horzGridColor', e.currentTarget.value)} />
              </>
            )}
            {row(
              L('Artı işareti (Crosshair)', 'Crosshair'),
              <>
                <input type="color" value={draft().canvas.crosshairColor} onInput={(e) => patch('canvas', 'crosshairColor', e.currentTarget.value)} />
                <select
                  class="script-select"
                  value={draft().canvas.crosshairStyle}
                  onChange={(e) => patch('canvas', 'crosshairStyle', e.currentTarget.value as CrosshairStyleOption)}
                >
                  <option value="dashed">{L('Kesikli', 'Dashed')}</option>
                  <option value="dotted">{L('Noktalı', 'Dotted')}</option>
                  <option value="solid">{L('Düz', 'Solid')}</option>
                </select>
              </>
            )}
            {row(
              L('Filigran (Watermark)', 'Watermark'),
              <>
                <input type="checkbox" id="cfg-cv-watermark" checked={draft().canvas.showWatermark} onChange={(e) => patch('canvas', 'showWatermark', e.currentTarget.checked)} />
                <input
                  type="color"
                  value={draft().canvas.watermarkColor.startsWith('#') ? draft().canvas.watermarkColor : '#444444'}
                  onInput={(e) => patch('canvas', 'watermarkColor', e.currentTarget.value)}
                />
              </>
            )}

            {section(L('ÖLÇEKLER VE KENAR BOŞLUKLARI', 'SCALES & MARGINS'))}
            {row(
              L('Eksen metni / punto', 'Scale text / size'),
              <>
                <input type="color" value={draft().canvas.scaleTextColor} onInput={(e) => patch('canvas', 'scaleTextColor', e.currentTarget.value)} />
                <select
                  id="cfg-cv-fontsize"
                  class="script-select"
                  value={String(draft().canvas.scaleFontSize)}
                  onChange={(e) => patch('canvas', 'scaleFontSize', Number(e.currentTarget.value))}
                >
                  <For each={[10, 11, 12, 13, 14, 16]}>{(sz) => <option value={String(sz)}>{sz}px</option>}</For>
                </select>
              </>
            )}
            {row(
              L('Eksen çizgi rengi', 'Scale lines'),
              <input type="color" value={draft().canvas.scaleLineColor} onInput={(e) => patch('canvas', 'scaleLineColor', e.currentTarget.value)} />
            )}
            {row(
              L('Kenar boşlukları (Üst% / Alt% / Sağ bar)', 'Margins (Top% / Bot% / Right bars)'),
              <div class="settings-margins">
                <input type="number" class="script-select" min="0" max="40" value={draft().canvas.marginTop} onChange={(e) => patch('canvas', 'marginTop', Number(e.currentTarget.value))} />
                <input type="number" class="script-select" min="0" max="40" value={draft().canvas.marginBottom} onChange={(e) => patch('canvas', 'marginBottom', Number(e.currentTarget.value))} />
                <input type="number" class="script-select" min="0" max="50" value={draft().canvas.rightOffset} onChange={(e) => patch('canvas', 'rightOffset', Number(e.currentTarget.value))} />
              </div>
            )}

            {section(L('ÖZEL RENK TEMASI KAYDET', 'SAVE CUSTOM COLOR THEME'))}
            <div class="settings-custom-theme-row">
              <input
                id="inp-custom-theme-name"
                class="script-select"
                style={{ flex: '1' }}
                placeholder={L('Özel tema adı (örn. Gece Neon)', 'Custom theme name')}
                value={customThemeName()}
                onInput={(e) => setCustomThemeName(e.currentTarget.value)}
                onKeyDown={(e) => e.stopPropagation()}
              />
              <input type="color" title={L('Panel rengi', 'Panel color')} value={customPanel()} onInput={(e) => setCustomPanel(e.currentTarget.value)} />
              <input type="color" title={L('Vurgu rengi', 'Accent color')} value={customAccent()} onInput={(e) => setCustomAccent(e.currentTarget.value)} />
              <button id="btn-save-custom-theme" class="btn-secondary" disabled={!customThemeName().trim()} onClick={saveTheme}>
                {L('Kaydet', 'Save')}
              </button>
            </div>
          </Show>

          {/* 5. TRADING */}
          <Show when={tab() === 'trading'}>
            {section(L('GENEL', 'GENERAL'))}
            {row(
              L('Grafik üstü Al / Sat butonları', 'Buy/sell buttons'),
              <input type="checkbox" id="cfg-check-quicktrade" checked={draft().trading.showQuickTrade} onChange={(e) => patch('trading', 'showQuickTrade', e.currentTarget.checked)} />
            )}
            {row(
              L('Tek tıkla emir iletimi', 'Instant orders placement'),
              <input type="checkbox" id="cfg-tr-oneclick" checked={draft().trading.oneClickTrading} onChange={(e) => patch('trading', 'oneClickTrading', e.currentTarget.checked)} />
            )}
            {row(
              L('Emir dolum sesi', 'Execution sound'),
              <input type="checkbox" id="cfg-tr-sound" checked={draft().trading.executionSound} onChange={(e) => patch('trading', 'executionSound', e.currentTarget.checked)} />
            )}

            {section(L('GÖRÜNÜM', 'APPEARANCE'))}
            {row(
              L('Grafikte pozisyonlar ve emirler', 'Positions and orders'),
              <input type="checkbox" id="cfg-tr-posorders" checked={draft().trading.showPositionsOrders} onChange={(e) => patch('trading', 'showPositionsOrders', e.currentTarget.checked)} />
            )}
            {row(
              L('Ters çevir (Reverse) düğmesi', 'Reverse position button'),
              <input type="checkbox" checked={draft().trading.showReverseBtn} onChange={(e) => patch('trading', 'showReverseBtn', e.currentTarget.checked)} />
            )}
            {row(
              L('Kâr / Zarar gösterimi', 'Profit and loss value'),
              <select
                id="cfg-tr-pnl"
                class="script-select"
                value={draft().trading.pnlMode}
                onChange={(e) => patch('trading', 'pnlMode', e.currentTarget.value as PnlDisplayMode)}
              >
                <option value="money">{L('Para ($)', 'Money')}</option>
                <option value="percent">{L('Yüzde (%)', 'Percentage')}</option>
                <option value="ticks">{L('Tik', 'Ticks')}</option>
              </select>
            )}
            {row(
              L('Emir çizgilerini grafik boyunca uzat', 'Extend price lines across chart'),
              <input type="checkbox" checked={draft().trading.extendedLines} onChange={(e) => patch('trading', 'extendedLines', e.currentTarget.checked)} />
            )}
            {row(
              L('Ekran görüntüsünde emirleri göster', 'Orders and positions in snapshots'),
              <input type="checkbox" checked={draft().trading.showInSnapshots} onChange={(e) => patch('trading', 'showInSnapshots', e.currentTarget.checked)} />
            )}
          </Show>

          {/* 6. ALERTS */}
          <Show when={tab() === 'alerts'}>
            {section(L('GRAFİK ÇİZGİ GÖRÜNÜRLÜĞÜ', 'CHART LINE VISIBILITY'))}
            {row(
              L('Grafikte alarm çizgileri', 'Alert lines'),
              <>
                <input type="checkbox" id="cfg-al-lines" checked={draft().alerts.showAlertLines} onChange={(e) => patch('alerts', 'showAlertLines', e.currentTarget.checked)} />
                <input type="color" id="cfg-al-color" value={draft().alerts.alertLineColor} onInput={(e) => patch('alerts', 'alertLineColor', e.currentTarget.value)} />
              </>
            )}
            {row(
              L('Yalnızca aktif alarmlar', 'Only active alerts'),
              <input type="checkbox" id="cfg-al-activeonly" checked={draft().alerts.onlyActiveLines} onChange={(e) => patch('alerts', 'onlyActiveLines', e.currentTarget.checked)} />
            )}

            {section(L('BİLDİRİMLER', 'NOTIFICATIONS'))}
            {row(
              L('Alarm ses düzeyi', 'Alert volume'),
              <>
                <input
                  type="range"
                  id="cfg-al-vol"
                  min="0"
                  max="100"
                  value={draft().alerts.soundVolume}
                  onInput={(e) => patch('alerts', 'soundVolume', Number(e.currentTarget.value))}
                />
                <span class="settings-val">{draft().alerts.soundVolume}%</span>
              </>
            )}
            {row(
              L('Bildirimleri otomatik gizle', 'Automatically hide toasts'),
              <input type="checkbox" id="cfg-al-autohide" checked={draft().alerts.autoHideToasts} onChange={(e) => patch('alerts', 'autoHideToasts', e.currentTarget.checked)} />
            )}
            {row(
              L('Bildirim süresi (sn)', 'Toast duration (sec)'),
              <input
                type="number"
                class="script-select"
                style={{ width: '70px' }}
                min="2"
                max="15"
                value={draft().alerts.toastDurationSec}
                onChange={(e) => patch('alerts', 'toastDurationSec', Number(e.currentTarget.value))}
              />
            )}
            {row(
              L('Açılır pencere (Popup) bildirimleri', 'Show popup notifications'),
              <input type="checkbox" checked={draft().alerts.showPopups} onChange={(e) => patch('alerts', 'showPopups', e.currentTarget.checked)} />
            )}
          </Show>

          {/* 7. EVENTS */}
          <Show when={tab() === 'events'}>
            {section(L('KURUMSAL OLAYLAR', 'CORPORATE EVENTS'))}
            {row(
              L('Grafikte Temettüleri (D) Göster', 'Dividends'),
              <input type="checkbox" id="cfg-events-dividends" checked={draft().events.dividends} onChange={(e) => patch('events', 'dividends', e.currentTarget.checked)} />
            )}
            {row(
              L('Grafikte Hisse Bölünmelerini (S) Göster', 'Splits'),
              <input type="checkbox" id="cfg-events-splits" checked={draft().events.splits} onChange={(e) => patch('events', 'splits', e.currentTarget.checked)} />
            )}
            {row(
              L('Grafikte Bilanço / Kazanç Tarihlerini (E) Göster', 'Earnings'),
              <input type="checkbox" id="cfg-events-earnings" checked={draft().events.earnings} onChange={(e) => patch('events', 'earnings', e.currentTarget.checked)} />
            )}
            {row(
              L('Bilanço kırılım çizgileri', 'Earnings breaks'),
              <input type="checkbox" id="cfg-events-ebreaks" checked={draft().events.earningsBreaks} onChange={(e) => patch('events', 'earningsBreaks', e.currentTarget.checked)} />
            )}

            {section(L('HABERLER', 'NEWS'))}
            {row(
              L('Grafikte son haber işaretleri', 'Latest news on chart'),
              <input type="checkbox" checked={draft().events.showLatestNews} onChange={(e) => patch('events', 'showLatestNews', e.currentTarget.checked)} />
            )}
            {row(
              L('Haber bildirimleri', 'News notifications'),
              <input type="checkbox" checked={draft().events.newsNotifications} onChange={(e) => patch('events', 'newsNotifications', e.currentTarget.checked)} />
            )}
          </Show>

          {/* 8. DATA SOURCES */}
          <Show when={tab() === 'sources'}>
            {section(L('RESMÎ VE AÇIK API KAYNAKLARI (HER ZAMAN AÇIK)', 'OFFICIAL PUBLIC APIS (ALWAYS ON)'))}
            <div class="sources-card">
              <div class="sources-row-head">
                <strong>Binance · Deribit · {L('Resmî Ekonomik Takvimler', 'Official Economic Calendars')}</strong>
                <span class="sources-badge sources-badge-on">{L('Açık', 'Enabled')}</span>
              </div>
              <p class="sources-desc">
                {L(
                  'Kripto spot/akış (Binance), kripto opsiyonları (Deribit) ve merkez bankası / istatistik takvimleri (TCMB, TÜİK, Fed, BLS, ECB, BEA, SPK) varsayılan olarak açıktır.',
                  'Crypto spot/order flow (Binance), crypto options (Deribit), and public statistical calendars (TCMB, TÜİK, Fed, BLS, ECB, BEA, SPK) are enabled by default.'
                )}
              </p>
            </div>

            {section(L('RESMÎ OLMAYAN ÜÇÜNCÜ TARAF UÇ NOKTALARI (İSTEĞE BAĞLI)', 'UNOFFICIAL THIRD-PARTY ENDPOINTS (OPT-IN)'))}
            <div class="sources-card" id="sources-unofficial-card">
              <div class="sources-row-head">
                <strong>Yahoo Finance · Google News · İş Yatırım</strong>
                <span
                  id="sources-unofficial-status"
                  class="sources-badge"
                  classList={{ 'sources-badge-on': !!sourcesStatus()?.unofficial }}
                >
                  {sourcesStatus() === null && sourcesBusy()
                    ? L('Yükleniyor…', 'Loading…')
                    : sourcesStatus()?.unofficial
                      ? L('Açık', 'Enabled')
                      : L('Kapalı (varsayılan)', 'Disabled (default)')}
                </span>
              </div>
              <p class="sources-desc">
                {L(
                  'BIST ve ABD hisse mumları, döviz dönüşümü, şirket temel verileri, temettü/bilanço takvimi ve haber akışı için kullanılır. Varsayılan olarak kapalıdır ve onayınız olmadan bu uçlara hiçbir ağ isteği gönderilmez.',
                  'Used for BIST/US equity candles, FX conversion, company fundamentals, corporate events, and news. Disabled by default; no network requests are sent to these hosts until you explicitly opt in.'
                )}
              </p>
              <Show when={sourcesStatus()?.hosts?.length}>
                <div class="sources-hosts">
                  {L('Kapsanan alan adları:', 'Gated hosts:')} <code>{sourcesStatus()!.hosts.join(', ')}</code>
                </div>
              </Show>
              <Show when={sourcesStatus()?.acceptedAt}>
                <div class="sources-meta">
                  {L('Onay zamanı:', 'Accepted at:')}{' '}
                  {new Date((sourcesStatus()!.acceptedAt ?? 0) * 1000).toLocaleString()}
                </div>
              </Show>
              <Show when={sourcesStatus()?.envOverride !== undefined}>
                <div class="sources-warn" id="sources-env-lock">
                  {L(
                    'Bu ayar ortam değişkeni veya komut satırı bayrağı (TITAN_UNOFFICIAL_SOURCES) ile kilitlenmiştir.',
                    'This setting is locked by environment variable or CLI flag (TITAN_UNOFFICIAL_SOURCES).'
                  )}
                </div>
              </Show>
              <Show when={sourcesErr()}>
                <div class="sources-err" id="sources-error-msg" role="alert">{sourcesErr()}</div>
              </Show>

              <Show when={sourcesStatus()?.envOverride === undefined}>
                <div class="sources-actions">
                  <Show
                    when={sourcesStatus()?.unofficial}
                    fallback={
                      <Show when={!consentOpen()}>
                        <button
                          id="btn-sources-request-enable"
                          class="btn-primary"
                          disabled={sourcesBusy()}
                          onClick={() => {
                            setConsentChecked(false);
                            setConsentOpen(true);
                          }}
                        >
                          {L('Kullanım şartlarını incele ve aç…', 'Review terms & enable…')}
                        </button>
                      </Show>
                    }
                  >
                    <button
                      id="btn-sources-disable"
                      class="btn-secondary"
                      disabled={sourcesBusy()}
                      onClick={() => void disableUnofficial()}
                    >
                      {L('Devre dışı bırak', 'Disable')}
                    </button>
                  </Show>
                </div>
              </Show>

              <Show when={consentOpen() && !sourcesStatus()?.unofficial}>
                <div class="sources-consent" id="sources-consent-box">
                  <strong>{L('Sorumluluk ve Kullanım Şartları Onayı', 'Terms of Use & Responsibility Notice')}</strong>
                  <ul>
                    <li>
                      {L(
                        'Bu uç noktalar resmî değildir; TitanView tarafından işletilmez, desteklenmez ve ilgili sağlayıcılarla herhangi bir bağı yoktur.',
                        'These endpoints are unofficial and are not operated by, affiliated with, or endorsed by TitanView.'
                      )}
                    </li>
                    <li>
                      {L(
                        'İlgili sağlayıcıların kullanım şartları otomatik veya üçüncü taraf erişimi kısıtlayabilir. Kullanım şartlarına ve yerel mevzuata uyum tamamen sizin sorumluluğunuzdadır.',
                        'Provider terms of use may restrict automated or third-party access. Compliance with each provider’s terms and applicable regulations is solely your responsibility.'
                      )}
                    </li>
                    <li>
                      {L(
                        'Veriler gecikmeli (ör. BIST ~15 dk), eksik olabilir veya haber verilmeksizin çalışmayı durdurabilir. Hiçbir veri yatırım tavsiyesi değildir.',
                        'Data may be delayed (e.g. ~15 min for BIST), incomplete, or stop working without notice. Nothing shown is investment advice.'
                      )}
                    </li>
                  </ul>
                  <label class="sources-check">
                    <input
                      type="checkbox"
                      id="chk-sources-accept"
                      checked={consentChecked()}
                      onChange={(e) => setConsentChecked(e.currentTarget.checked)}
                    />
                    <span>
                      {L(
                        'Okudum; resmî olmayan uç noktaların kullanım şartları sorumluluğunu kabul ediyorum.',
                        'I have read and accept sole responsibility for complying with third-party terms of use.'
                      )}
                    </span>
                  </label>
                  <div class="sources-actions">
                    <button
                      id="btn-sources-cancel"
                      class="btn-secondary"
                      disabled={sourcesBusy()}
                      onClick={() => {
                        setConsentOpen(false);
                        setConsentChecked(false);
                      }}
                    >
                      {L('Vazgeç', 'Cancel')}
                    </button>
                    <button
                      id="btn-sources-confirm-enable"
                      class="btn-primary"
                      disabled={!consentChecked() || sourcesBusy()}
                      onClick={() => void confirmEnableUnofficial()}
                    >
                      {L('Onayla ve Etkinleştir', 'Accept & Enable')}
                    </button>
                  </div>
                </div>
              </Show>
            </div>
          </Show>
        </div>
      </div>

      {/* Standart Ayarlar Alt Çubuğu: solda Template ▾, sağda Cancel + Ok */}
      <div class="tv-settings-footer">
        <div class="settings-tpl-wrap">
          <button id="btn-cfg-template" class="btn-secondary" onClick={() => setTplOpen(!tplOpen())}>
            {t('cfg.template')} ▾
          </button>
          <Show when={tplOpen()}>
            <div id="cfg-template-menu" class="draw-pop settings-tpl-pop">
              <button id="btn-cfg-apply-defaults" class="draw-pop-item" onClick={resetDefaults}>
                ↺ {t('cfg.applyDefaults')}
              </button>
              <div class="draw-pop-sep" />
              <div class="draw-pop-row">
                <input
                  id="inp-cfg-tpl-name"
                  class="script-select grow"
                  placeholder={t('cfg.saveAs')}
                  value={tplName()}
                  onInput={(e) => setTplName(e.currentTarget.value)}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === 'Enter') saveTpl();
                  }}
                />
                <button id="btn-cfg-tpl-save" class="btn-secondary" disabled={!tplName().trim()} onClick={saveTpl}>
                  {L('Kaydet', 'Save')}
                </button>
              </div>
              <Show when={templates().length > 0}>
                <div class="draw-pop-sep" />
                <For each={templates()}>
                  {(tp) => (
                    <div class="draw-pop-row" data-cfg-tpl={tp.id}>
                      <button
                        class="draw-pop-item grow"
                        onClick={() => {
                          setDraft(cloneChartSettings(tp.settings));
                          setTplOpen(false);
                          toast(L(`Şablon yüklendi: ${tp.name}`, `Template loaded: ${tp.name}`));
                        }}
                      >
                        {tp.name}
                      </button>
                      <button
                        class="draw-pop-item"
                        data-del-cfg-tpl={tp.id}
                        onClick={() => setTemplates(deleteSettingsTemplate(tp.id))}
                      >
                        ✕
                      </button>
                    </div>
                  )}
                </For>
              </Show>
            </div>
          </Show>
        </div>
        <div class="settings-footer-actions">
          <button class="btn-secondary" onClick={close}>{t('cfg.cancel')}</button>
          <button id="btn-save-settings" class="btn-primary" style={{ padding: '6px 18px' }} onClick={commit}>
            {t('cfg.ok')}
          </button>
        </div>
      </div>
    </Modal>
  );
}
