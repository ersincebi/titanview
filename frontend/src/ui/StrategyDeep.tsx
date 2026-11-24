import { tfmt, tt, localeTag } from '../state/i18n';
import { For, Index, Show, createEffect, createMemo, on, type JSX } from 'solid-js';
import {
  DATE_PRESETS,
  btRange,
  deepStatus,
  formatDateInput,
  magnifierOn,
  magnifierTimeframe,
  parseDateInput,
  selectedTradeId,
  setTradeLabels,
  setTradeLines,
  tradeLabels,
  tradeLines,
  type DatePreset,
} from '../state/deepTest';
import {
  applyDateRange,
  applyOptResult,
  applyPresetRange,
  cancelDeep,
  cancelOptimization,
  optBudget,
  optElapsed,
  optError,
  optMethod,
  optMinTrades,
  optObjective,
  optPlannedRuns,
  optProgress,
  optResults,
  optRunning,
  optSpecs,
  refreshOptSpecs,
  runDeepBacktest,
  setOptBudget,
  setOptMethod,
  setOptMinTrades,
  setOptObjective,
  startOptimization,
  stepTrade,
  toggleMagnifier,
  updateOptSpec,
} from '../state/deepTestRun';
import { OBJECTIVES, gridSize, type Objective } from '../state/optimizer';
import { TF_SECONDS } from '../state/format';
import { downloadBytes, exportFileName, tradesToCsv, tradesToXlsx } from '../state/tradeExport';
import { candles, scriptMain, scriptResult, ui } from '../state/store';

/** Faz 24: Strateji Testi araç çubuğu — derin test, tarih aralığı, bar büyüteci, dışa aktarım, grafik görünümü. */
export function DeepTestBar(): JSX.Element {
  let fromEl: HTMLInputElement | undefined;
  let toEl: HTMLInputElement | undefined;
  const busy = () => ['history', 'magnifier', 'run'].includes(deepStatus().phase);
  const magTf = () => magnifierTimeframe(ui.interval);
  const meta = () => ({ symbol: ui.symbol, interval: ui.interval, script: scriptResult()?.scriptTitle ?? 'strateji', stepSec: TF_SECONDS[ui.interval] || 900 });
  const first = () => candles()[0]?.time ?? null;
  const exportCsv = () => {
    const bt = scriptResult()?.backtest;
    if (!bt) return;
    downloadBytes(exportFileName(meta(), 'csv'), tradesToCsv(bt.trades), 'text/csv;charset=utf-8');
  };
  const exportXlsx = () => {
    const bt = scriptResult()?.backtest;
    if (!bt) return;
    downloadBytes(exportFileName(meta(), 'xlsx'), tradesToXlsx(bt, meta()) as unknown as BlobPart, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  };
  const apply = () => {
    const from = parseDateInput(fromEl?.value ?? '');
    const to = parseDateInput(toEl?.value ?? '', true);
    void applyDateRange(from === null && to === null ? null : { from, to });
  };
  const clear = () => {
    if (fromEl) fromEl.value = '';
    if (toEl) toEl.value = '';
    void applyDateRange(null);
  };
  createEffect(() => {
    const r = btRange();
    if (fromEl) fromEl.value = formatDateInput(r?.from ?? null);
    if (toEl) toEl.value = formatDateInput(r?.to ?? null);
  });
  return (
    <div class="deep-bar" id="deep-bar">
      <div class="deep-row">
        <button class="btn-secondary" id="btn-deep-history" disabled={busy()} onClick={() => void runDeepBacktest({ deep: true })} title={tt("Kaynak tükenene (ya da seçili başlangıç tarihine) dek tüm geçmişi çekip stratejiyi yeniden çalıştırır")}>
          {tt("⏬ Tüm geçmiş")}
        </button>
        <Show when={busy()}>
          <button class="btn-secondary" id="btn-deep-cancel" onClick={cancelDeep}>{tt("✕ İptal")}</button>
        </Show>
        <select
          id="deep-preset"
          disabled={busy()}
          aria-label={tt("Hızlı tarih aralığı")}
          title={tt("Hızlı tarih aralığı seç")}
          value=""
          onChange={(e) => {
            const v = e.currentTarget.value as DatePreset | '';
            if (v) void applyPresetRange(v);
            e.currentTarget.value = '';
          }}
        >
          <option value="">{tt("Aralık…")}</option>
          <For each={DATE_PRESETS}>{([id, label]) => <option value={id}>{label}</option>}</For>
        </select>
        <label class="deep-date">
          <input type="date" id="deep-from" ref={fromEl} aria-label={tt("Başlangıç tarihi")} min="1990-01-01" max="2100-01-01" title={first() ? tfmt("Başlangıç (yüklü: {0})", formatDateInput(first())) : tt("Başlangıç tarihi")} />
        </label>
        <span class="term-hint">→</span>
        <label class="deep-date">
          <input type="date" id="deep-to" ref={toEl} aria-label={tt("Bitiş tarihi")} min="1990-01-01" max="2100-01-01" title={tt("Bitiş tarihi")} />
        </label>
        <button class="btn-secondary" id="btn-deep-apply" disabled={busy()} onClick={apply}>{tt("Uygula")}</button>
        <Show when={btRange()}>
          <button class="btn-secondary" id="btn-deep-clear" disabled={busy()} onClick={clear} title={tt("Tarih filtresini kaldır")}>✕</button>
        </Show>
        <label class="deep-check" title={magTf() ? tfmt("Stop/limit dolumları {0} mumlarıyla çözülür (Bar Büyüteci)", magTf()!.toUpperCase()) : tt("Bu zaman diliminin alt aralığı yok")}>
          <input type="checkbox" id="chk-magnifier" checked={magnifierOn()} disabled={busy() || !magTf()} onChange={(e) => toggleMagnifier(e.currentTarget.checked)} />
          {tt("🔍 Büyüteç")}{magTf() ? ` (${magTf()!.toUpperCase()})` : ''}
        </label>
        <span class="deep-spacer" />
        <label class="deep-check" title={tt("Grafikte giriş–çıkış bağlantı çizgilerini göster")}><input type="checkbox" id="chk-trade-lines" checked={tradeLines()} onChange={(e) => setTradeLines(e.currentTarget.checked)} />{' '}{tt("Çizgi")}</label>
        <label class="deep-check" title={tt("Grafikte giriş/çıkış etiketlerini göster")}><input type="checkbox" id="chk-trade-labels" checked={tradeLabels()} onChange={(e) => setTradeLabels(e.currentTarget.checked)} />{' '}{tt("Etiket")}</label>
        <button class="btn-secondary" id="btn-export-csv" disabled={!scriptResult()?.backtest} onClick={exportCsv} title={tt("İşlem listesini CSV olarak indir")}>⬇ CSV</button>
        <button class="btn-secondary" id="btn-export-xlsx" disabled={!scriptResult()?.backtest} onClick={exportXlsx} title={tt("İşlemler + Özet sayfalarıyla Excel (.xlsx) indir")}>⬇ Excel</button>
      </div>
      <Show when={deepStatus().message}>
        <div class="deep-status" id="deep-status" classList={{ err: deepStatus().phase === 'error' }} data-phase={deepStatus().phase}>
          <Show when={busy()}><span class="deep-spin" /></Show>
          {deepStatus().message}
          <Show when={deepStatus().oldest > 0 && deepStatus().phase === 'done'}>
            {' '}· {formatDateInput(deepStatus().oldest)} → {formatDateInput(deepStatus().newest)}
          </Show>
        </div>
      </Show>
    </div>
  );
}

/** İşlem listesi üstündeki gezinme (önceki/sonraki işlem, grafikte göster). */
export function TradeNav(props: { count: number }): JSX.Element {
  createEffect(() => {
    const id = selectedTradeId();
    if (id === null || typeof document === 'undefined') return;
    const tr = document.querySelector(`tr[data-trade-id="${id}"]`);
    if (tr && typeof tr.scrollIntoView === 'function') tr.scrollIntoView({ block: 'nearest' });
  });
  return (
    <span class="trade-nav">
      <button class="btn-secondary" id="btn-trade-prev" onClick={() => stepTrade(-1)} title={tt("Önceki işleme git")}>◀</button>
      <button class="btn-secondary" id="btn-trade-next" onClick={() => stepTrade(1)} title={tt("Sonraki işleme git")}>▶</button>
      <span class="term-hint" id="trade-sel-info">
        {selectedTradeId() === null ? tfmt("{0} işlem", props.count) : tfmt("#{0} seçili · {1} işlem", selectedTradeId(), props.count)}
      </span>
    </span>
  );
}

const fmt = (v: number, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : '—');

/** Faz 24: parametre optimizasyonu (grid / genetik). */
export function OptimizePanel(): JSX.Element {
  createEffect(on(() => [scriptMain()?.inputs, scriptMain()?.scriptTitle] as const, () => refreshOptSpecs()));
  const total = createMemo(() => gridSize(optSpecs()));
  const pct = () => {
    const p = optProgress();
    return p && p.total > 0 ? Math.min(100, Math.round((p.done / p.total) * 100)) : 0;
  };
  const nSel = () => optSpecs().filter((s) => s.enabled).length;
  return (
    <div class="strat-scroll opt-panel" id="opt-panel">
      <Show when={scriptMain()?.isStrategy} fallback={<div class="term-note" id="opt-empty">{tt("Optimizasyon için strategy() içeren bir betik uygulayın.")}</div>}>
        <div class="term-hint">{tt("Optimize edilecek sayısal girdileri seçin; her kombinasyon gerçek bir strateji koşusudur (")}{ui.symbol} · {ui.interval}, {candles().length.toLocaleString(localeTag())}{' '}{tt("bar).")}</div>
        <table class="bt-table" id="opt-params">
          <thead><tr><th></th><th>{tt("Girdi")}</th><th>{tt("Şimdiki")}</th><th>Min</th><th>{tt("Maks")}</th><th>{tt("Adım")}</th><th>{tt("Değer sayısı")}</th></tr></thead>
          <tbody>
            <Index each={optSpecs()} fallback={<tr><td colSpan={7} class="term-hint">{tt("Bu betikte sayısal (int/float) girdi yok.")}</td></tr>}>
              {(s) => (
                <tr data-opt-key={s().key}>
                  <td><input type="checkbox" class="opt-enable" checked={s().enabled} onChange={(e) => updateOptSpec(s().key, { enabled: e.currentTarget.checked })} /></td>
                  <td>{s().title}</td>
                  <td>{s().current}</td>
                  <td><input type="number" class="opt-min" value={s().min} step={s().step} onChange={(e) => updateOptSpec(s().key, { min: Number(e.currentTarget.value) })} /></td>
                  <td><input type="number" class="opt-max" value={s().max} step={s().step} onChange={(e) => updateOptSpec(s().key, { max: Number(e.currentTarget.value) })} /></td>
                  <td><input type="number" class="opt-step" value={s().step} min={s().type === 'int' ? 1 : 0.0001} step={s().type === 'int' ? 1 : 0.1} onChange={(e) => updateOptSpec(s().key, { step: Math.max(s().type === 'int' ? 1 : 1e-4, Number(e.currentTarget.value)) })} /></td>
                  <td>{gridSizeOf(s())}</td>
                </tr>
              )}
            </Index>
          </tbody>
        </table>
        <div class="deep-row">
          <label class="deep-check">{tt("Yöntem")}
            <select id="opt-method" value={optMethod()} onChange={(e) => setOptMethod(e.currentTarget.value as 'grid' | 'genetic')}>
              <option value="genetic">{tt("Genetik")}</option>
              <option value="grid">{tt("Izgara (grid)")}</option>
            </select>
          </label>
          <label class="deep-check">{tt("Hedef")}
            <select id="opt-objective" value={optObjective()} onChange={(e) => setOptObjective(e.currentTarget.value as Objective)}>
              <For each={OBJECTIVES}>{([id, label]) => <option value={id}>{label}</option>}</For>
            </select>
          </label>
          <label class="deep-check">{tt("Maks. koşu")}{' '}<input type="number" id="opt-budget" value={optBudget()} min={4} max={5000} onChange={(e) => setOptBudget(Math.max(4, Math.min(5000, Math.round(Number(e.currentTarget.value) || 200))))} /></label>
          <label class="deep-check">{tt("En az işlem")}{' '}<input type="number" id="opt-mintrades" value={optMinTrades()} min={0} onChange={(e) => setOptMinTrades(Math.max(0, Math.round(Number(e.currentTarget.value) || 0)))} /></label>
          <Show when={!optRunning()} fallback={<button class="btn-secondary" id="btn-opt-cancel" onClick={cancelOptimization}>{tt("■ Durdur")}</button>}>
            <button class="btn-primary" id="btn-opt-run" disabled={nSel() === 0} onClick={() => void startOptimization()}>{tt("▶ Optimizasyonu başlat")}</button>
          </Show>
          <span class="term-hint" id="opt-plan">{nSel() === 0 ? tt("Parametre seçin") : tfmt("{0} kombinasyon · {1} koşu", total().toLocaleString(localeTag()), optPlannedRuns().toLocaleString(localeTag()))}</span>
        </div>
        <Show when={optRunning() || optProgress()}>
          <div class="opt-progress" id="opt-progress">
            <div class="opt-bar"><i style={{ width: `${pct()}%` }} /></div>
            <span class="term-hint">
              {optProgress()?.done ?? 0}/{optProgress()?.total ?? 0}
              {optProgress()?.generation ? ` · nesil ${optProgress()!.generation}` : ''} · {(optElapsed() / 1000).toFixed(1)} sn
              {optProgress()?.best ? ` · en iyi ${fmt(optProgress()!.best!.score)}` : ''}
            </span>
          </div>
        </Show>
        <Show when={optError()}><div class="term-note" id="opt-error" style={{ color: 'var(--bear)' }}>{optError()}</div></Show>
        <Show when={optResults().length > 0}>
          <table class="bt-table" id="opt-results">
            <thead>
              <tr>
                <th>#</th>
                <For each={optSpecs().filter((s) => s.enabled)}>{(s) => <th>{s.title}</th>}</For>
                <th>{tt("Skor")}</th><th>{tt("Net Kâr")}</th><th>Net %</th><th>{tt("İşlem")}</th><th>{tt("Kazanma %")}</th><th>PF</th><th>{tt("Maks. Düşüş %")}</th><th>Sharpe</th><th></th>
              </tr>
            </thead>
            <tbody>
              <For each={optResults().slice(0, 50)}>
                {(r, i) => (
                  <tr class="opt-row">
                    <td>{i() + 1}</td>
                    <For each={optSpecs().filter((s) => s.enabled)}>{(s) => <td>{r.params[s.key]}</td>}</For>
                    <td><b>{fmt(r.score)}</b></td>
                    <td style={{ color: r.metrics.net >= 0 ? 'var(--bull)' : 'var(--bear)' }}>{fmt(r.metrics.net, 0)}</td>
                    <td>{fmt(r.metrics.netPct)}%</td>
                    <td>{r.metrics.trades}</td>
                    <td>{fmt(r.metrics.winRate, 1)}</td>
                    <td>{fmt(r.metrics.profitFactor)}</td>
                    <td>{fmt(r.metrics.maxDDPct)}</td>
                    <td>{fmt(r.metrics.sharpe)}</td>
                    <td><button class="btn-secondary opt-apply" onClick={() => { applyOptResult(r); }}>{tt("Uygula")}</button></td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </Show>
      </Show>
    </div>
  );
}

function gridSizeOf(s: { min: number; max: number; step: number; type: 'int' | 'float'; key: string; title: string; current: number; enabled: boolean }): number {
  return gridSize([{ ...s, enabled: true }]);
}

