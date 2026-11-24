import { For, Show, createSignal, onCleanup, type JSX } from 'solid-js';
import { TIMEZONE_CHOICES, activeTimezone, resolveTimeZone, timezoneShortLabel } from '../chart/timezone';
import { lang, localeTag, t, tt } from '../state/i18n';
import { rt } from '../state/runtime';
import {
  meta,
  rangeJump,
  setDisplayCurrency,
  setScale,
  setTimezone,
  setUi,
  toggleScale,
  toggleScaleLock,
  toggleSessionMode,
  ui,
} from '../state/store';
import { CURRENCY_CHOICES, currencyBadgeLabel } from '../state/symbolExpr';

const RANGES: Array<[string, string, string]> = [
  ['1D', '1G', '1D'],
  ['5D', '5G', '5D'],
  ['1M', '1A', '1M'],
  ['3M', '3A', '3M'],
  ['6M', '6A', '6M'],
  ['YTD', 'YTD', 'YTD'],
  ['1Y', '1Y', '1Y'],
  ['5Y', '5Y', '5Y'],
  ['ALL', tt("Tümü"), 'All'],
];

export function AxisFooter(): JSX.Element {
  const en = () => lang() === 'en';
  const formatClock = () => {
    try {
      const tz = resolveTimeZone(ui.chartSettings.symbol.timezone || activeTimezone());
      return new Date().toLocaleTimeString(localeTag(), {
        timeZone: tz,
        hour12: ui.chartSettings.scales.timeFormat === '12h',
      });
    } catch {
      return new Date().toLocaleTimeString(localeTag(), { hour12: false });
    }
  };
  const [now, setNow] = createSignal(formatClock());
  const [curOpen, setCurOpen] = createSignal(false);
  const timer = window.setInterval(() => setNow(formatClock()), 1000);
  onCleanup(() => window.clearInterval(timer));
  const curLabel = () => currencyBadgeLabel(meta()?.nativeCurrency ?? meta()?.currency, ui.displayCurrency);
  const tzLabel = () => timezoneShortLabel(ui.chartSettings.symbol.timezone || activeTimezone());

  return (
    <div class="chart-axis-footer">
      <div class="axis-left">
        <For each={RANGES}>
          {([key, labelTr, labelEn]) => (
            <button class="tv-btn" data-range-jump={key} onClick={() => rangeJump(key)}>
              {en() ? labelEn : labelTr}
            </button>
          )}
        </For>
        <button
          id="btn-goto-date"
          class="tv-btn"
          title={t('axis.goToDate')}
          onClick={() => setUi('modal', 'goto')}
        >
          📅
        </button>
        <button id="btn-fit-chart" class="tv-btn" title={t('axis.fitTitle')} onClick={() => rt.chart?.fitContent()}>
          {t('axis.fit')}
        </button>
      </div>
      <div class="axis-right">
        <span style={{ position: 'relative' }}>
          <button
            id="btn-timezone-trigger"
            class="tv-btn axis-tz-btn"
            title={t('axis.timezone')}
            onClick={(e) => {
              e.stopPropagation();
              setUi('menu', ui.menu === 'timezone' ? null : 'timezone');
            }}
          >
            <span id="lbl-live-clock">{`${now()} (${tzLabel()})`}</span>
          </button>
          <Show when={ui.menu === 'timezone'}>
            <div
              id="timezone-menu"
              class="draw-pop"
              style={{ bottom: '28px', right: '0', 'min-width': '220px', 'z-index': '80' }}
              onClick={(e) => e.stopPropagation()}
            >
              <div class="fx-list-caption" style={{ padding: '4px 8px' }}>{t('axis.timezone').toUpperCase()}</div>
              <For each={TIMEZONE_CHOICES}>
                {(tz) => (
                  <button
                    type="button"
                    class="draw-pop-item"
                    classList={{ active: ui.chartSettings.symbol.timezone === tz.id }}
                    data-tz-choice={tz.id || 'LOCAL'}
                    onClick={() => {
                      setTimezone(tz.id);
                      setNow(formatClock());
                      setUi('menu', null);
                    }}
                  >
                    <span>{en() ? tz.labelEn : tz.labelTr}</span>
                  </button>
                )}
              </For>
            </div>
          </Show>
        </span>
        <button
          id="btn-session-mode"
          class="chip-btn"
          classList={{ active: ui.chartSettings.symbol.session === 'extended' }}
          title={t('axis.session')}
          onClick={toggleSessionMode}
        >
          {ui.chartSettings.symbol.session === 'extended' ? t('axis.eth') : t('axis.rth')}
        </button>
        <span>|</span>
        <span style={{ position: 'relative' }}>
          <button
            id="btn-currency-convert"
            class="chip-btn"
            classList={{ active: !!ui.displayCurrency }}
            title={en() ? 'Convert chart currency (TRY ↔ USD ↔ EUR)' : 'Grafik Para Birimi Dönüştürme (TRY ↔ USD ↔ EUR)'}
            onClick={() => setCurOpen(!curOpen())}
          >
            💱 <span id="lbl-currency-badge">{curLabel()}</span> ▾
          </button>
          <Show when={curOpen()}>
            <div id="currency-convert-menu" class="draw-pop" style={{ bottom: '28px', right: '0', 'min-width': '185px', 'z-index': '80' }}>
              <div class="fx-list-caption" style={{ padding: '4px 8px' }}>{t('axis.currencyHead')}</div>
              <For each={CURRENCY_CHOICES}>
                {(c) => (
                  <button
                    type="button"
                    class="draw-pop-item"
                    classList={{ active: ui.displayCurrency === c.code }}
                    data-currency-choice={c.code || 'ORIGINAL'}
                    onClick={() => {
                      setCurOpen(false);
                      void setDisplayCurrency(c.code);
                    }}
                  >
                    <span>{c.label}</span>
                    <b style={{ 'margin-left': 'auto', 'font-family': 'var(--font-mono)' }}>{c.symbol}</b>
                  </button>
                )}
              </For>
            </div>
          </Show>
        </span>
        <span>|</span>
        <button
          id="btn-scale-indexed"
          class="chip-btn"
          classList={{ active: ui.scaleKind === 'indexed' }}
          title={t('axis.idxTitle')}
          onClick={() => toggleScale('indexed')}
        >
          100
        </button>
        <button
          id="btn-scale-percent"
          class="chip-btn"
          classList={{ active: ui.scaleKind === 'percent' }}
          title={t('axis.pctTitle')}
          onClick={() => toggleScale('percent')}
        >
          %
        </button>
        <button
          id="btn-scale-log"
          class="chip-btn"
          classList={{ active: ui.scaleKind === 'log' }}
          title={t('axis.logTitle')}
          onClick={() => toggleScale('log')}
        >
          log
        </button>
        <button
          id="btn-scale-lock"
          class="chip-btn"
          classList={{ active: ui.scaleLock }}
          title={t('axis.lockTitle')}
          aria-pressed={ui.scaleLock}
          onClick={toggleScaleLock}
        >
          {ui.scaleLock ? '🔒' : '🔓'}
        </button>
        <button
          id="btn-scale-auto"
          class="chip-btn"
          classList={{ active: ui.scaleKind === 'normal' }}
          title={t('axis.autoTitle')}
          onClick={() => setScale('normal')}
        >
          {t('axis.auto')}
        </button>
      </div>
    </div>
  );
}
