import { tfmt } from '../state/i18n';
import { tt } from '../state/i18n';
import { For, Show, createMemo, type JSX } from 'solid-js';
import { analysisUpdatedAt } from '../state/analysisStore';
import { formatPrice } from '../state/format';
import { computeLab, type LabStats } from '../state/lab';
import { feedHealth, candles, ui } from '../state/store';
import { nowMs } from '../state/liveFeed';

const num = (v: number | null, d = 2) => (v === null ? '—' : v.toFixed(d));
const sgnPct = (v: number | null) => (v === null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(2)}%`);
const tone = (v: number | null) => (v === null || v === 0 ? 'var(--text-secondary)' : v > 0 ? 'var(--bull)' : 'var(--bear)');
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

export const FEED_LABEL: Record<string, string> = {
  live: 'CANLI',
  delayed: tt("GECİKMELİ"),
  closed: 'SEANS KAPALI',
  reconnecting: tt("BAĞLANIYOR"),
  offline: tt("ÇEVRİMDIŞI"),
};

/** Laboratuvar: her tick'te (≤4/sn) yeniden hesaplanan canlı ölçüm ızgarası. */
export function LabPanel(): JSX.Element {
  const s = createMemo<LabStats | null>(() => computeLab(candles(), ui.interval, nowMs() / 1000));
  const cell = (label: string, value: () => string, color?: () => string, hint?: string) => (
    <div class="lab-cell" title={hint}>
      <span>{label}</span>
      <b style={{ color: color?.() }}>{value()}</b>
    </div>
  );
  const age = () => {
    const t = analysisUpdatedAt();
    return t ? Math.max(0, Math.round((nowMs() - t) / 1000)) : null;
  };
  return (
    <div class="lab" id="lab-panel">
      <div class="lab-head">
        <span class={`lab-dot lab-${feedHealth().state}`} />
        <b>{FEED_LABEL[feedHealth().state]}</b>
        <span class="term-hint">
          {tt("son tick")}{' '}{feedHealth().lastTickAt ? tfmt("{0}sn önce", feedHealth().ageSec) : '—'}{' '}{tt("· analiz")}{' '}{age() === null ? '—' : tfmt("{0}sn önce", age())}
        </span>
      </div>
      <Show when={s()} fallback={<div class="term-note">{tt("Ölçüm için en az 2 bar gerekir.")}</div>}>
        {(l) => (
          <>
            <div class="lab-bar" title={tt("Mevcut barın tamamlanma oranı")}>
              <span style={{ width: `${Math.min(100, l().barProgress * 100)}%` }} />
              <em>{tt("bar kapanışına")}{' '}{mmss(l().secondsLeft)}</em>
            </div>
            <div class="lab-grid">
              {cell(tt('Son'), () => formatPrice(l().last))}
              {cell('Bar Δ', () => sgnPct(l().barChangePct), () => tone(l().barChangePct))}
              {cell(tt("Bar aralığı"), () => `${l().rangePct.toFixed(2)}%`)}
              {cell('RSI(14)', () => num(l().rsi, 1), () => (l().rsi === null ? '' : l().rsi! >= 70 ? 'var(--bear)' : l().rsi! <= 30 ? 'var(--bull)' : ''), tt("70 üstü aşırı alım, 30 altı aşırı satım"))}
              {cell('ATR %', () => num(l().atrPct))}
              {cell(tt("Gerçekleşen σ"), () => num(l().realizedVolPct, 3) + '%', undefined, tt("Son 30 bar log-getiri standart sapması"))}
              {cell(tt("EMA20 uzaklık"), () => sgnPct(l().ema20DistPct), () => tone(l().ema20DistPct))}
              {cell(tt("EMA50 uzaklık"), () => sgnPct(l().ema50DistPct), () => tone(l().ema50DistPct))}
              {cell(tt("VWAP uzaklık"), () => sgnPct(l().vwapDistPct), () => tone(l().vwapDistPct))}
              {cell(tt('Bollinger konum'), () => (l().bbPos === null ? '—' : `%${(l().bbPos! * 100).toFixed(0)}`), undefined, tt("0 = alt band, 100 = üst band"))}
              {cell('Z-skor (20)', () => num(l().zScore20), () => tone(l().zScore20 === null ? null : -l().zScore20!), tt("|z|>2 ortalamadan aşırı sapma"))}
              {cell(tt('Hacim / ort.'), () => (l().volVsAvg === null ? '—' : `${l().volVsAvg!.toFixed(2)}×`))}
              {cell('Seri', () => `${l().streak > 0 ? '+' : ''}${l().streak}`, () => tone(l().streak), tt("Ardışık yeşil(+)/kırmızı(−) bar"))}
              {cell(tt("20 bar yüksek"), () => formatPrice(l().hi20))}
              {cell(tt("20 bar düşük"), () => formatPrice(l().lo20))}
            </div>
          </>
        )}
      </Show>
    </div>
  );
}
