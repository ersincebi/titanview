import { Show, type JSX } from 'solid-js';
import { lang, tt } from '../state/i18n';
import { feedHealth, meta } from '../state/store';
import { FEED_LABEL } from './Lab';

/** Standart legend durum çipleri: "Kapalı / Canlı" (EN: "Closed / Live") + "15 dk gecikmeli" / "15m delayed". */
export function FeedChips(): JSX.Element {
  const en = () => lang() === 'en';
  const state = () => feedHealth().state;
  const statusText = () => {
    if (!meta()) return en() ? 'NO DATA' : 'VERİ YOK';
    const s = state();
    if (en()) {
      return s === 'closed' ? 'Closed' : s === 'live' ? 'Live' : s === 'delayed' ? 'Open' : s === 'reconnecting' ? 'Reconnecting…' : 'Offline';
    }
    return s === 'closed' ? tt("Kapalı") : s === 'live' ? tt("Canlı") : s === 'delayed' ? tt("Açık") : FEED_LABEL[s];
  };
  const source = () => {
    const m = meta();
    if (!m) return '';
    return m.provider === 'BINANCE' ? (en() ? 'BINANCE (Live WS)' : 'BINANCE (Canlı WS)') : `YAHOO ${m.market}`;
  };
  return (
    <span class="leg-chips" id="pill-feed">
      <span
        id="lbl-feed-status"
        class={`leg-chip leg-chip-${meta() ? state() : 'none'}`}
        title={`${source()} · ${FEED_LABEL[state()] ?? ''}`}
      >
        <span class="leg-chip-dot" />
        {statusText()}
      </span>
      <Show when={(meta()?.delayMinutes ?? 0) > 0}>
        <span id="lbl-feed-delay" class="leg-chip leg-chip-delay">
          {en() ? `${meta()!.delayMinutes}m delayed` : `${meta()!.delayMinutes} dk gecikmeli`}
        </span>
      </Show>
    </span>
  );
}
