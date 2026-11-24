import { Show, createSignal, onCleanup, onMount, type JSX } from 'solid-js';
import type { ReplaySpeed } from '../chart/BarReplay';
import { lang, localeTag, t } from '../state/i18n';
import { rt } from '../state/runtime';
import { runScript, setCandles, stopReplay, toast, ui } from '../state/store';

const SPEEDS: ReplaySpeed[] = ['0.5x', '1x', '2x', '5x', '10x'];

/** Yüzen Replay çubuğu: oynat/duraklat, adım, hız (0.5x–10x), tarih seç, rastgele bar, ilerleme, kapat. */
export function ReplayBar(): JSX.Element {
  const [playing, setPlaying] = createSignal(false);
  const [speed, setSpeed] = createSignal<ReplaySpeed>('2x');
  const [progress, setProgress] = createSignal({ current: 0, total: 0 });
  const [curTime, setCurTime] = createSignal<number | null>(null);
  const [pickOpen, setPickOpen] = createSignal(false);
  const [pickDate, setPickDate] = createSignal('');

  let timer: ReturnType<typeof setInterval> | undefined;
  const syncFromReplay = () => {
    const r = rt.replay;
    if (!r) return;
    setPlaying(r.isPlaying());
    setSpeed(r.getSpeed());
    const p = r.getProgress();
    setProgress({ current: p.current, total: p.total });
    setCurTime(r.getCurrentTime());
  };

  onMount(() => {
    timer = setInterval(syncFromReplay, 200);
  });
  onCleanup(() => timer && clearInterval(timer));

  const applySliced = (bars: ReturnType<NonNullable<typeof rt.replay>['jumpToRandom']>) => {
    if (!bars || bars.length === 0) return;
    setCandles(bars);
    rt.chart?.setHistoryData(bars);
    runScript();
    syncFromReplay();
  };

  const toggle = () => {
    const r = rt.replay;
    if (!r) return;
    if (r.isPlaying()) r.pause();
    else r.play(speed());
    syncFromReplay();
  };

  const nextSpeed = () => {
    const r = rt.replay;
    const n = SPEEDS[(SPEEDS.indexOf(speed()) + 1) % SPEEDS.length];
    r?.setSpeed(n);
    setSpeed(n);
  };

  const jumpRandom = () => {
    const r = rt.replay;
    if (!r) return;
    const bars = r.jumpToRandom();
    applySliced(bars);
    toast(lang() === 'en' ? 'Jumped to random bar' : 'Rastgele bara atlandı');
  };

  const openDatePick = () => {
    const tSec = rt.replay?.getCurrentTime();
    if (tSec && !pickDate()) setPickDate(new Date(tSec * 1000).toISOString().slice(0, 10));
    setPickOpen(!pickOpen());
  };

  const submitDate = () => {
    const r = rt.replay;
    if (!r || !pickDate()) return;
    const ts = Math.floor(new Date(`${pickDate()}T00:00:00`).getTime() / 1000);
    if (Number.isFinite(ts) && ts > 0) {
      applySliced(r.jumpToTimestamp(ts));
      setPickOpen(false);
    }
  };

  const curDateLabel = () => {
    const ts = curTime();
    if (!ts) return '';
    return new Date(ts * 1000).toLocaleDateString(localeTag(), { day: '2-digit', month: 'short', year: '2-digit' });
  };

  return (
    <Show when={ui.replayActive}>
      <div id="replay-bar" class="replay-bar" role="toolbar" aria-label="Replay">
        <button id="btn-replay-pick-date" class="replay-btn replay-txt-btn" title={t('replay.pickDate')} onClick={openDatePick}>
          📅 {t('replay.pickDate')}
        </button>
        <button id="btn-replay-random" class="replay-btn replay-txt-btn" title={t('replay.random')} onClick={jumpRandom}>
          🎲 {t('replay.random')}
        </button>
        <span class="replay-sep" />
        <button id="btn-replay-play" class="replay-btn" title={playing() ? t('replay.pause') : t('replay.play')} onClick={toggle}>
          {playing() ? '❚❚' : '▶'}
        </button>
        <button id="btn-replay-step" class="replay-btn" title={t('replay.step')} onClick={() => { rt.replay?.step(); syncFromReplay(); }}>
          ▶|
        </button>
        <button id="btn-replay-speed" class="replay-speed" title={t('replay.speed')} onClick={nextSpeed}>
          {speed()}
        </button>
        <Show when={progress().total > 0}>
          <span id="lbl-replay-progress" class="replay-progress">
            {progress().current}/{progress().total}
            <Show when={curDateLabel()}> · {curDateLabel()}</Show>
          </span>
        </Show>
        <button id="btn-replay-realtime" class="replay-btn replay-txt-btn" title={t('replay.realtime')} onClick={() => stopReplay()}>
          ⏭
        </button>
        <button id="btn-replay-close" class="replay-btn" title={t('replay.close')} onClick={() => stopReplay()}>
          ✕
        </button>
        <Show when={pickOpen()}>
          <div id="replay-date-pop" class="replay-date-pop">
            <input
              id="inp-replay-date"
              type="date"
              class="script-select"
              value={pickDate()}
              onInput={(e) => setPickDate(e.currentTarget.value)}
            />
            <button id="btn-replay-date-go" class="btn-primary" style={{ padding: '3px 10px' }} onClick={submitDate}>
              {t('goto.go')}
            </button>
          </div>
        </Show>
      </div>
    </Show>
  );
}
