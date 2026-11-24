import { tfmt, lang, t, tt, localeTag } from '../state/i18n';
import { For, Show, createMemo, createSignal, onCleanup, onMount, type JSX } from 'solid-js';
import { LANG_NAME } from '../script/brand';
import { BUILTIN_SCRIPT_PRESETS } from '../script/presets';
import { showView } from '../state/terminalStore';
import { ScriptTables, TerminalPanels } from './Terminal';
import { ScriptEditor, diagnostics, goToLine } from './ScriptEditor';
import { ScriptsDialog } from './ScriptsDialog';
import { DeepTestBar, OptimizePanel, TradeNav } from './StrategyDeep';
import { ScreenerPanel } from './Screener';
import { focusTrade } from '../state/deepTestRun';
import { btRange, magnifierCandles, magnifierOn, magnifierTimeframe, selectedTradeId } from '../state/deepTest';
import { wasmEnabled } from '../script/wasmCore';
import { ScriptInputField, groupScriptInputs } from './ScriptInputs';
import { currentScript, isDirty, newScript, saveCurrent, setScriptDialog } from '../state/userScripts';
import { formatMoney } from '../state/format';
import { PaperAccountPanel } from './TradePanel';
import { paperView } from '../state/tradingStore';
import { TF_SECONDS } from '../state/format';
import { buyAndHold, chartGeometry, riskStats, sideStats } from '../state/strategyStats';
import type { ScriptInputDef } from '../types/market';
import {
  applyPreset,
  applySecondary,
  scriptMain,
  candles,
  scriptInputOverrides,
  scriptResult,
  resetScriptInputOverrides,
  applyScriptToChart,
  setScriptInputOverride,
  setWorkbenchTab,
  startScriptChartPick,
  toggleWorkbench,
  ui,
  type WorkbenchTab,
} from '../state/store';

const TABS: Array<[WorkbenchTab, string]> = [
  ['script', tt("Betik Editörü")],
  ['backtest', tt("Strateji Testi")],
  ['screener', tt("Tarayıcı")],
];

const DATA_TABS: Array<[WorkbenchTab, string]> = [
  ['financials', tt("Finansallar")],
  ['calendar', tt("Takvim")],
  ['options', tt("Opsiyonlar")],
];

const TERMINAL_TABS: Array<['market' | 'corr' | 'des' | 'news' | 'whale' | 'insight' | 'ideas', string]> = [
  ['insight', tt("Analiz")],
  ['market', tt("Piyasa")],
  ['corr', tt("Korelasyon")],
  ['des', tt("Künye")],
  ['news', tt("Haber")],
  ['whale', tt("Balina")],
  ['ideas', tt("Fikirler")],
];

const sideColor = (side: string) => (side === 'LONG' ? 'var(--bull)' : 'var(--bear)');
const pnlColor = (n: number) => (n >= 0 ? 'var(--bull)' : 'var(--bear)');
const sgn = (n: number) => (n >= 0 ? '+' : '');

type ScriptSubTab = 'summary' | 'console' | 'inputs';
type LogFilter = 'all' | 'info' | 'warning' | 'error';

function ScriptInputControl(props: { def: ScriptInputDef }): JSX.Element {
  const key = () => props.def.id ?? props.def.title;
  const val = () => {
    const ov = scriptInputOverrides()[key()];
    return ov !== undefined ? ov : props.def.value !== undefined ? props.def.value : props.def.defval;
  };
  return (
    <ScriptInputField
      def={props.def}
      value={val()}
      onChange={(v) => setScriptInputOverride(key(), v)}
      onPick={(kind) => startScriptChartPick({ inputKey: key(), inputTitle: props.def.title, kind })}
    />
  );
}

function ScriptPanel(): JSX.Element {
  const [scriptSubTab, setScriptSubTab] = createSignal<ScriptSubTab>('summary');
  const [logLevel, setLogLevel] = createSignal<LogFilter>('all');
  const [logQuery, setLogQuery] = createSignal('');
  const res = scriptMain; // durum çubuğu: editördeki (birincil) betik
  const bt = () => scriptResult()?.backtest;
  const trades = createMemo(() => [...(bt()?.trades ?? [])].reverse().slice(0, 25));
  const logs = () => scriptResult()?.logs ?? [];
  const inputs = () => scriptMain()?.inputs ?? [];
  const groupedInputs = createMemo(() => groupScriptInputs(inputs()));
  const filteredLogs = createMemo(() => {
    const lvl = logLevel();
    const q = logQuery().trim().toLowerCase();
    return logs().filter((e) => (lvl === 'all' || e.level === lvl) && (!q || e.message.toLowerCase().includes(q)));
  });
  const status = () => {
    if (ui.scriptNote) return { text: ui.scriptNote, ok: !ui.scriptNote.startsWith('✗') };
    const r = res();
    if (!r) return { text: tfmt("✓ {0} Hazır", LANG_NAME), ok: true };
    if (!r.ok) return { text: `✗ Hata: ${r.error}`, ok: false };
    if (r.isLibrary) return { text: tfmt("✓ 📚 {0} (kütüphane)", r.scriptTitle), ok: true };
    return { text: tfmt("✓ {0} ({1} çizim)", r.scriptTitle, r.plots.filter((p) => !p.hidden).length), ok: true };
  };
  return (
    <div id="wb-panel-script" class="wb-panel wb-panel-script" classList={{ active: ui.wbTab === 'script' }}>
      <div class="script-editor-pane">
        <ScriptEditor />
        <div class="script-status-bar">
          <span id="lbl-script-status" style={{ color: status().ok ? 'var(--bull)' : 'var(--bear)' }}>
            {status().text}
          </span>
          <span id="lbl-script-exec-ms">{res() ? `${res()!.executionMs} ms` : '—'}</span>
        </div>
        <Show when={(scriptResult()?.warnings?.length ?? 0) > 0}>
          <ul id="lst-script-warnings" class="script-warnings" style={{ margin: '4px 8px', padding: '0 0 0 16px', color: 'var(--text-secondary)', 'font-size': '11px' }}>
            <For each={scriptResult()!.warnings}>{(w) => <li>⚠ {w}</li>}</For>
          </ul>
        </Show>
        <Show when={diagnostics().length > 0}>
          <ul id="lst-script-diagnostics" class="script-diagnostics">
            <For each={diagnostics()}>
              {(d) => (
                <li>
                  <button onClick={() => goToLine(d.line, d.column)} title={tt("Satıra git")}>
                    <span class="script-diag-loc">{d.line}:{d.column}</span> {d.message}
                  </button>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </div>
      <div class="backtest-pane">
        <div class="script-subtabs">
          <button
            id="tab-script-summary"
            class="chip-btn"
            classList={{ active: scriptSubTab() === 'summary' }}
            onClick={() => setScriptSubTab('summary')}
          >
            {tt("Özet")}
          </button>
          <button
            id="tab-script-console"
            class="chip-btn"
            classList={{ active: scriptSubTab() === 'console' }}
            onClick={() => setScriptSubTab('console')}
          >
            {tt("Konsol (")}{logs().length})
          </button>
          <button
            id="tab-script-inputs"
            class="chip-btn"
            classList={{ active: scriptSubTab() === 'inputs' }}
            onClick={() => setScriptSubTab('inputs')}
          >
            {tt("Girdiler (")}{inputs().length})
          </button>
        </div>

        <Show when={scriptSubTab() === 'summary'}>
          <div class="bt-metrics-grid">
            <div class="bt-card">
              <div class="bt-card-label">{tt("Net Kâr ($10K Baz)")}</div>
              <div id="bt-net-profit" class="bt-card-val" style={{ color: bt() ? pnlColor(bt()!.netProfitCash) : undefined }}>
                {bt()
                  ? `${formatMoney(bt()!.netProfitCash, 0)} (${sgn(bt()!.netProfitPercent)}${bt()!.netProfitPercent.toFixed(1)}%)`
                  : res() ? tt("İndikatör Modu") : '—'}
              </div>
            </div>
            <div class="bt-card">
              <div class="bt-card-label">{tt("Kazanma Oranı (Win%)")}</div>
              <div id="bt-win-rate" class="bt-card-val">{bt() ? `%${bt()!.winRatePercent.toFixed(1)}` : '—'}</div>
            </div>
            <div class="bt-card">
              <div class="bt-card-label">{tt("Toplam İşlem")}</div>
              <div id="bt-total-trades" class="bt-card-val">{bt() ? bt()!.totalTrades : res() ? '0' : '—'}</div>
            </div>
            <div class="bt-card">
              <div class="bt-card-label">Profit Factor</div>
              <div id="bt-profit-factor" class="bt-card-val">{bt() ? bt()!.profitFactor.toFixed(2) : '—'}</div>
            </div>
            <div class="bt-card">
              <div class="bt-card-label">{tt("Maks. Düşüş (DD)")}</div>
              <div id="bt-max-dd" class="bt-card-val" style={{ color: 'var(--bear)' }}>
                {bt() ? `-%${bt()!.maxDrawdownPercent.toFixed(2)}` : '—'}
              </div>
            </div>
          </div>
          <div style={{ 'overflow-y': 'auto', flex: '1' }}>
            <table class="bt-table">
              <thead>
                <tr><th>#</th><th>{tt("Yön")}</th><th>{tt("Giriş")}</th><th>{tt("Çıkış")}</th><th>{tt("Kâr/Zarar %")}</th><th>{tt("Bakiye ($)")}</th></tr>
              </thead>
              <tbody id="bt-trades-tbody">
                <Show
                  when={bt()}
                  fallback={<tr><td colSpan={6} style={{ color: 'var(--text-secondary)' }}>{tt("Strateji testi için strategy() içeren bir şablon seçin.")}</td></tr>}
                >
                  <For each={trades()}>
                    {(t) => (
                      <tr>
                        <td>#{t.id}</td>
                        <td style={{ color: sideColor(t.direction), 'font-weight': '700' }}>{t.direction}</td>
                        <td>{t.entryPrice.toFixed(2)}</td>
                        <td>{t.exitPrice.toFixed(2)}</td>
                        <td style={{ color: pnlColor(t.pnlPercent), 'font-weight': '600' }}>{sgn(t.pnlPercent)}{t.pnlPercent.toFixed(2)}%</td>
                        <td>${t.equityAfter.toFixed(0)}</td>
                      </tr>
                    )}
                  </For>
                </Show>
              </tbody>
            </table>
          </div>
        </Show>

        <Show when={scriptSubTab() === 'console'}>
          <div id="script-console-panel" class="script-console-panel">
            <div class="script-console-bar">
              <For each={[['all', tt("Tümü")], ['info', tt("Bilgi")], ['warning', tt("Uyarı")], ['error', tt("Hata")]] as Array<[LogFilter, string]>}>
                {([lvl, label]) => (
                  <button
                    class="chip-btn"
                    classList={{ active: logLevel() === lvl }}
                    data-log-level={lvl}
                    onClick={() => setLogLevel(lvl)}
                  >
                    {label}
                  </button>
                )}
              </For>
              <input
                id="inp-script-log-search"
                class="script-inp-field"
                style={{ 'margin-left': 'auto', width: '130px' }}
                placeholder={tt("Filtrele…")}
                value={logQuery()}
                onInput={(e) => setLogQuery(e.currentTarget.value)}
              />
            </div>
            <div id="lst-script-logs" class="script-console-list">
              <Show
                when={filteredLogs().length > 0}
                fallback={<div class="term-note">{tt("Henüz konsol çıktısı yok. log.info(), log.warning() veya log.error() kullanın.")}</div>}
              >
                <For each={filteredLogs()}>
                  {(entry) => (
                    <div class={`script-log-row script-log-${entry.level}`} data-log-entry={entry.level}>
                      <span class={`script-log-badge badge-${entry.level}`}>{entry.level.toUpperCase()}</span>
                      <span class="script-log-meta">#{entry.barIndex} L{entry.line}</span>
                      <span class="script-log-time">{dt(entry.time)}</span>
                      <span class="script-log-msg">{entry.message}</span>
                    </div>
                  )}
                </For>
              </Show>
            </div>
          </div>
        </Show>

        <Show when={scriptSubTab() === 'inputs'}>
          <div id="script-inputs-panel" class="script-inputs-panel">
            <div class="script-inputs-head">
              <span class="term-hint">{inputs().length}{' '}{tt("girdi")}</span>
              <button id="btn-script-inputs-reset" class="btn-secondary" style={{ padding: '2px 8px' }} onClick={resetScriptInputOverrides}>
                {tt("Sıfırla")}
              </button>
            </div>
            <div class="script-inputs-scroll">
              <Show
                when={inputs().length > 0}
                fallback={<div class="term-note">{tt("Bu betikte input.* tanımı yok.")}</div>}
              >
                <For each={groupedInputs()}>
                  {(g) => (
                    <div class="script-inp-group" data-inp-group={g.name}>
                      <Show when={g.name}>
                        <div class="script-inp-group-title">{g.name}</div>
                      </Show>
                      <For each={g.rows}>
                        {(row) => (
                          <div class="script-inp-row" classList={{ 'is-inline': row.length > 1 }}>
                            <For each={row}>{(def) => <ScriptInputControl def={def} />}</For>
                          </div>
                        )}
                      </For>
                    </div>
                  )}
                </For>
              </Show>
            </div>
          </div>
        </Show>
      </div>
    </div>
  );
}

type StratTab = 'overview' | 'perf' | 'trades' | 'props' | 'optimize' | 'table';
const STRAT_TABS: Array<[StratTab, string]> = [
  ['overview', tt("Genel Bakış")],
  ['perf', tt("Performans Özeti")],
  ['trades', tt("İşlem Listesi")],
  ['props', tt("Özellikler")],
  ['optimize', tt("Optimizasyon")],
  ['table', tt("Tablo")],
];
const [stratTab, setStratTab] = createSignal<StratTab>('overview');
const [showBH, setShowBH] = createSignal(true);
const [showDD, setShowDD] = createSignal(true);
const money = (n: number | null | undefined, d = 2) => (n == null ? '—' : formatMoney(n, d));
const num = (n: number | null | undefined, d = 2) => (n == null ? '—' : n.toFixed(d));
const dt = (t: number) => (t > 0 ? new Date(t * 1000).toLocaleString(localeTag(), { dateStyle: 'short', timeStyle: 'short' }) : '—');

function BacktestPanel(): JSX.Element {
  const bt = () => scriptResult()?.backtest;
  const step = () => TF_SECONDS[ui.interval] || 900;
  const sides = createMemo(() => {
    const b = bt();
    if (!b) return null;
    return {
      all: sideStats(b.trades, step()),
      long: sideStats(b.trades.filter((t) => t.direction === 'LONG'), step()),
      short: sideStats(b.trades.filter((t) => t.direction === 'SHORT'), step()),
    };
  });
  const risk = createMemo(() => (bt() ? riskStats(bt()!, step()) : null));
  const bh = createMemo(() => (bt() ? buyAndHold(bt()!, candles()) : null));
  const geo = createMemo(() => (bt() ? chartGeometry(bt()!, candles()) : null));
  const allTrades = createMemo(() => [...(bt()?.trades ?? [])].reverse());
  const pc = (n: number | null | undefined) => (n == null ? 'inherit' : n >= 0 ? 'var(--bull)' : 'var(--bear)');
  const perfRows = (): Array<[string, (s: NonNullable<ReturnType<typeof sides>>['all']) => string, ((s: NonNullable<ReturnType<typeof sides>>['all']) => number | null)?]> => [
    ['Net Kâr', (s) => money(s.net), (s) => s.net],
    [tt("Brüt Kâr"), (s) => money(s.grossProfit), () => 1],
    [tt("Brüt Zarar"), (s) => money(-s.grossLoss), () => -1],
    ['Profit Factor', (s) => num(s.profitFactor)],
    [tt("Toplam İşlem"), (s) => String(s.n)],
    [tt("Kârlı İşlem"), (s) => String(s.wins)],
    [tt("Zararlı İşlem"), (s) => String(s.losses)],
    [tt("Kazanma Oranı"), (s) => (s.winRate == null ? '—' : `%${s.winRate.toFixed(1)}`)],
    [tt("Ort. İşlem K/Z"), (s) => money(s.avgTrade), (s) => s.avgTrade],
    ['Ort. Kazanan', (s) => money(s.avgWin), () => 1],
    ['Ort. Kaybeden', (s) => money(s.avgLoss == null ? null : -s.avgLoss), () => -1],
    [tt("Kazanç / Kayıp Oranı"), (s) => num(s.payoff)],
    [tt("En Büyük Kazanç"), (s) => money(s.largestWin), () => 1],
    [tt("En Büyük Kayıp"), (s) => money(-s.largestLoss), () => -1],
    [tt("Maks. Ardışık Kazanç"), (s) => String(s.maxConsecWins)],
    [tt("Maks. Ardışık Kayıp"), (s) => String(s.maxConsecLosses)],
    [tt("Ort. Bar Süresi"), (s) => (s.avgBarsHeld == null ? '—' : `${s.avgBarsHeld.toFixed(1)} bar`)],
  ];
  return (
    <div id="wb-panel-backtest" class="wb-panel wb-panel-single strat" classList={{ active: ui.wbTab === 'backtest' }}>
      <div class="strat-tabs">
        <For each={STRAT_TABS}>
          {([id, label]) => (
            <button class="chip-btn" classList={{ active: stratTab() === id }} data-strat-tab={id} onClick={() => setStratTab(id)}>{label}</button>
          )}
        </For>
        <span class="term-hint">{scriptResult()?.scriptTitle ?? ''} · {ui.symbol} · {ui.interval}</span>
      </div>
      <Show when={stratTab() !== 'table' && stratTab() !== 'optimize'}>
        <DeepTestBar />
      </Show>
      <Show when={stratTab() === 'table'}>
        <div class="strat-scroll"><ScriptTables /></div>
      </Show>
      <Show when={stratTab() === 'optimize'}>
        <OptimizePanel />
      </Show>
      <Show when={stratTab() !== 'table' && stratTab() !== 'optimize'}>
      <Show
        when={bt()}
        fallback={<div class="term-note" id="strat-empty">{scriptResult()?.ok ? tt("Bu betik bir gösterge; strateji raporu için strategy() içeren bir şablon seçin.") : tt("Strateji sonucu yok. Betik Editörü sekmesinden bir şablon seçip \"Grafiğe Uygula\"ya bas.")}</div>}
      >

        <Show when={stratTab() === 'overview'}>
          <div class="strat-kpis" id="strat-kpis">
            <div class="strat-kpi"><span>{tt("Net Kâr")}</span><b id="kpi-net" style={{ color: pc(bt()!.netProfitCash) }}>{money(bt()!.netProfitCash, 0)}</b><small style={{ color: pc(bt()!.netProfitPercent) }}>{sgn(bt()!.netProfitPercent)}{bt()!.netProfitPercent.toFixed(2)}%</small></div>
            <div class="strat-kpi"><span>{tt("Toplam İşlem")}</span><b>{bt()!.totalTrades}</b><small>{bt()!.openTrades ? tfmt("{0} açık", bt()!.openTrades) : tt("kapalı")}</small></div>
            <div class="strat-kpi"><span>{tt("Kârlı İşlem")}</span><b>%{bt()!.winRatePercent.toFixed(1)}</b><small>{bt()!.winningTrades}/{bt()!.totalTrades}</small></div>
            <div class="strat-kpi"><span>Profit Factor</span><b>{bt()!.profitFactor.toFixed(2)}</b></div>
            <div class="strat-kpi"><span>{tt("Maks. Düşüş")}</span><b style={{ color: 'var(--bear)' }}>-${Math.round(risk()!.maxDrawdownCash).toLocaleString('en-US')}</b><small>-%{risk()!.maxDrawdownPct.toFixed(2)}</small></div>
            <div class="strat-kpi"><span>{tt("Al ve Tut")}</span><b id="kpi-bh" style={{ color: pc(bh()?.pct) }}>{bh() ? `${sgn(bh()!.pct)}${bh()!.pct.toFixed(2)}%` : '—'}</b><small>{bh() ? money(bh()!.cash, 0) : ''}</small></div>
            <div class="strat-kpi"><span>Sharpe / Sortino</span><b>{num(risk()!.sharpe)} / {num(risk()!.sortino)}</b></div>
          </div>
          <div class="strat-chart-bar">
            <label><input type="checkbox" checked={showBH()} onChange={(e) => setShowBH(e.currentTarget.checked)} /> <span style={{ color: '#FF9800' }}>▬</span>{' '}{tt("Al ve Tut")}</label>
            <label><input type="checkbox" checked={showDD()} onChange={(e) => setShowDD(e.currentTarget.checked)} /> <span style={{ color: '#F23645' }}>▬</span>{' '}{tt("Düşüş")}</label>
            <span><span style={{ color: '#089981' }}>▬</span>{' '}{tt("Strateji özsermayesi")}</span>
          </div>
          <Show when={geo()} fallback={<div class="term-note">{tt("Grafik için yeterli veri yok.")}</div>}>
            {(g) => {
              const dims = () => {
                const [, , w, h] = g().viewBox.split(' ').map(Number);
                return { w, h };
              };
              const px = (x: number) => `${(x / dims().w) * 100}%`;
              const py = (y: number) => `${(y / dims().h) * 100}%`;
              return (
                <div class="strat-chart-wrap">
                  <svg id="svg-equity-curve" class="strat-chart" viewBox={g().viewBox} preserveAspectRatio="none">
                    <For each={g().yTicks}>
                      {(t) => <line x1="46" x2="752" y1={t.y} y2={t.y} class="svg-grid" stroke-width="1" vector-effect="non-scaling-stroke" />}
                    </For>
                    <Show when={g().zeroY !== null}><line x1="46" x2="752" y1={g().zeroY!} y2={g().zeroY!} stroke="#8c8c8c" stroke-dasharray="4 3" stroke-width="1" vector-effect="non-scaling-stroke" /></Show>
                    <Show when={showDD()}><polygon points={g().drawdown} fill="rgba(242, 54, 69,0.28)" stroke="none" /></Show>
                    <Show when={showBH() && g().buyHold}><polyline points={g().buyHold!} fill="none" stroke="#FF9800" stroke-width="1.4" vector-effect="non-scaling-stroke" /></Show>
                    <polyline points={g().equity} fill="none" stroke="#089981" stroke-width="2" vector-effect="non-scaling-stroke" />
                  </svg>
                  <For each={g().yTicks}>
                    {(t) => <span class="strat-ylabel" style={{ top: py(t.y), right: `${100 - (42 / dims().w) * 100}%` }}>{t.label}</span>}
                  </For>
                  <For each={g().xTicks.filter((t) => t.x > 70)}>
                    {(t) => <span class="strat-xlabel" style={{ left: px(t.x), top: py(186) }}>{new Date(t.time * 1000).toLocaleDateString(localeTag(), { month: 'short', year: '2-digit' })}</span>}
                  </For>
                </div>
              );
            }}
          </Show>
        </Show>

        <Show when={stratTab() === 'perf'}>
          <div class="strat-scroll">
            <table class="bt-table" id="bt-perf-table">
              <thead><tr><th>{tt("Metrik")}</th><th>{tt("Tümü")}</th><th>Long</th><th>Short</th></tr></thead>
              <tbody id="bt-breakdown-tbody">
                <For each={perfRows()}>
                  {([label, f, color]) => (
                    <tr>
                      <td>{label}</td>
                      <td style={{ color: color ? pc(color(sides()!.all)) : 'inherit', 'font-weight': '600' }}>{f(sides()!.all)}</td>
                      <td style={{ color: color ? pc(color(sides()!.long)) : 'inherit' }}>{f(sides()!.long)}</td>
                      <td style={{ color: color ? pc(color(sides()!.short)) : 'inherit' }}>{f(sides()!.short)}</td>
                    </tr>
                  )}
                </For>
                <tr><td>{tt("Maks. Düşüş (nakit / %)")}</td><td colSpan={3}>{money(risk()!.maxDrawdownCash)} / %{risk()!.maxDrawdownPct.toFixed(2)}</td></tr>
                <tr><td>{tt("Getiri / Maks. Düşüş")}</td><td colSpan={3}>{num(risk()!.returnOnMaxDD)}</td></tr>
                <tr><td>{tt("Sharpe · Sortino (bar bazlı, yıllıklandırılmış)")}</td><td colSpan={3}>{num(risk()!.sharpe)} · {num(risk()!.sortino)}</td></tr>
                <tr><td>{tt("Komisyon")}</td><td colSpan={3}>{money(bt()!.commissionPaid ?? 0)}</td></tr>
                <tr><td>{tt("Açık Pozisyon K/Z")}</td><td colSpan={3} style={{ color: pc(bt()!.openProfitCash) }}>{money(bt()!.openProfitCash ?? 0)}</td></tr>
                <tr><td>{tt("Al ve Tut Getirisi")}</td><td colSpan={3} style={{ color: pc(bh()?.pct) }}>{bh() ? `${money(bh()!.cash)} (${sgn(bh()!.pct)}${bh()!.pct.toFixed(2)}%)` : '—'}</td></tr>
              </tbody>
            </table>
          </div>
        </Show>

        <Show when={stratTab() === 'trades'}>
          <div class="term-hint trade-list-head">{tt("İşleme tıklayınca grafik o işleme gider (giriş → çıkış) ·")}{' '}<TradeNav count={allTrades().length} /></div>
          <div class="strat-scroll">
            <table class="bt-table">
              <thead><tr><th>#</th><th>{tt("Yön")}</th><th>{tt("Giriş Zamanı")}</th><th>{tt("Giriş")}</th><th>{tt("Çıkış Zamanı")}</th><th>{tt("Çıkış")}</th><th>{tt("Sinyal")}</th><th>{tt("Miktar")}</th><th>K/Z %</th><th>K/Z $</th><th>{tt("Bakiye")}</th></tr></thead>
              <tbody id="bt-full-trades-tbody">
                <For each={allTrades()}>
                  {(t) => (
                    <tr data-trade-entry-time={t.entryTime} data-trade-id={t.id} classList={{ 'trade-row-selected': selectedTradeId() === t.id }} style={{ cursor: 'pointer' }} title={tt("Grafikte bu işleme git")} onClick={() => t.entryTime > 0 && focusTrade(t)}>
                      <td>#{t.id}</td>
                      <td style={{ color: sideColor(t.direction), 'font-weight': '700' }}>{t.direction}</td>
                      <td>{dt(t.entryTime)}</td>
                      <td>{t.entryPrice.toFixed(2)}</td>
                      <td>{dt(t.exitTime)}</td>
                      <td>{t.exitPrice.toFixed(2)}</td>
                      <td class="term-hint">{t.exitComment || t.entryComment || t.entryId || ''}</td>
                      <td>{t.qty ?? '—'}</td>
                      <td style={{ color: pnlColor(t.pnlPercent), 'font-weight': '700' }}>{sgn(t.pnlPercent)}{t.pnlPercent.toFixed(2)}%</td>
                      <td style={{ color: pnlColor(t.pnlCash) }}>{formatMoney(t.pnlCash, 1)}</td>
                      <td><strong>${t.equityAfter.toFixed(1)}</strong></td>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          </div>
        </Show>

        <Show when={stratTab() === 'props'}>
          <div class="strat-scroll">
            <table class="bt-table" id="bt-props-table">
              <tbody>
                <tr><td>{tt("Betik")}</td><td>{scriptResult()!.scriptTitle}</td></tr>
                <tr><td>{tt("Sembol / Zaman Dilimi")}</td><td>{ui.symbol} · {ui.interval}</td></tr>
                <tr><td>{tt("Test Aralığı")}</td><td>{dt(bt()!.equityCurve?.[0]?.time ?? 0)} → {dt(bt()!.equityCurve?.[bt()!.equityCurve!.length - 1]?.time ?? 0)}{btRange() ? tt(" (tarih filtresi etkin)") : ''}</td></tr>
                <tr><td>{tt("Bar Sayısı")}</td><td>{bt()!.equityCurve?.length ?? 0}</td></tr>
                <tr><td>{tt("Başlangıç Sermayesi")}</td><td>{money(bt()!.initialCapital, 0)}</td></tr>
                <tr><td>{tt("Son Özsermaye")}</td><td>{money(bt()!.finalEquity, 0)}</td></tr>
                <tr><td>{tt("Ödenen Komisyon")}</td><td>{money(bt()!.commissionPaid ?? 0)}</td></tr>
                <tr>
                  <td>{tt("Bar Büyüteci")}</td>
                  <td id="prop-magnifier">
                    {magnifierOn()
                      ? tfmt("Açık ({0} · {1} alt mum)", (magnifierTimeframe(ui.interval) ?? ui.interval).toUpperCase(), magnifierCandles().length.toLocaleString(localeTag()))
                      : tt("Kapalı (bar içi OHLC sezgisi)")}
                  </td>
                </tr>
                <tr><td>{tt("Dolum Modeli")}</td><td>{tt("Sonraki barın açılışı; bar içi stop/limit")}</td></tr>
                <tr><td>{tfmt("{0} Çekirdeği", LANG_NAME)}</td><td id="prop-wasm">{wasmEnabled() ? tt("Rust→WASM (ta.* sıcak yolu etkin)") : 'TypeScript'}</td></tr>
              </tbody>
            </table>
          </div>
        </Show>
      </Show>
      </Show>
    </div>
  );
}

const [menuOpen, setMenuOpen] = createSignal(false);
const [menuPos, setMenuPos] = createSignal({ left: 0, bottom: 0 });
const [wbExpanded, setWbExpanded] = createSignal(false);

export function Workbench(): JSX.Element {
  // dışarı tıklayınca analiz menüsü kapanır
  const closeOnOutside = (e: MouseEvent) => {
    if (menuOpen() && !(e.target as HTMLElement | null)?.closest?.('.wb-menu')) setMenuOpen(false);
  };
  onMount(() => document.addEventListener('click', closeOnOutside));
  onCleanup(() => document.removeEventListener('click', closeOnOutside));
  return (
    <section
      id="script-workbench"
      class="script-workbench"
      classList={{ collapsed: ui.wbCollapsed, expanded: !ui.wbCollapsed && wbExpanded() }}
    >
      <div class="workbench-header">
        <div class="wb-tabs">
          <For each={TABS}>
            {([id, label]) => (
              <button class="wb-tab" classList={{ active: ui.wbTab === id }} data-wbtab={id} onClick={() => setWorkbenchTab(id)}>
                {lang() === 'en' ? t(`wb.${id}`) : label}
              </button>
            )}
          </For>
          <span class="wb-data-tabs" style={{ display: 'inline-flex', 'align-items': 'center' }}>
            <For each={DATA_TABS}>
              {([id, label]) => (
                <button class="wb-tab" classList={{ active: ui.wbTab === id }} data-wbtab={id} onClick={() => setWorkbenchTab(id)}>
                  {lang() === 'en' ? t(`wb.${id}`) : label}
                </button>
              )}
            </For>
          </span>
          <Show when={!ui.simple}>
          <div class="wb-menu" classList={{ open: menuOpen() }}>
            <button
              class="wb-tab"
              classList={{ active: TERMINAL_TABS.some(([id]) => id === ui.wbTab) }}
              id="btn-wb-analysis"
              onClick={(e) => {
                // Menü, çalışma alanının overflow'u tarafından kırpılmasın: fixed + düğme konumundan hesapla
                const r = e.currentTarget.getBoundingClientRect();
                setMenuPos({ left: r.left, bottom: window.innerHeight - r.top + 4 });
                setMenuOpen(!menuOpen());
              }}
            >
              {(() => {
                const found = TERMINAL_TABS.find(([id]) => id === ui.wbTab);
                if (lang() === 'en') return found ? t(`wb.${found[0] === 'insight' ? 'analysis' : found[0]}`) : t('wb.analysis');
                return found?.[1] ?? tt("Analiz");
              })()}
            </button>
            <div class="wb-menu-pop" id="wb-analysis-menu" style={{ left: `${menuPos().left}px`, bottom: `${menuPos().bottom}px` }}>
              <For each={TERMINAL_TABS}>
                {([id, label]) => (
                  <button class="wb-menu-item" classList={{ active: ui.wbTab === id }} data-wbtab={id} onClick={() => { setMenuOpen(false); showView(id); }}>
                    {lang() === 'en' ? t(`wb.${id === 'insight' ? 'analysis' : id}`) : label}
                  </button>
                )}
              </For>
            </div>
          </div>
          </Show>
          <button class="wb-tab" classList={{ active: ui.wbTab === 'paper' }} data-wbtab="paper" onClick={() => setWorkbenchTab('paper')}>
            {t('wb.paper')} ($<span id="lbl-tab-equity">{Math.round(paperView().summary.equity).toLocaleString('en-US')}</span>)
          </button>
        </div>
        <div class="wb-controls">
          <div class="wb-script-controls" classList={{ hidden: ui.wbTab !== 'script' }}>
          <span id="lbl-script-name" class="script-doc-name" title={currentScript() ? tt("Kayıtlı betik") : tt("Kaydedilmemiş betik")}>
            {currentScript()?.name ?? tt("Adsız betik")}
            <Show when={isDirty() || !currentScript()}><span class="script-dirty" title={tt("Kaydedilmemiş değişiklik")}>●</span></Show>
          </span>
          <select
            id="sel-script-new"
            class="script-select"
            title={tt("Yeni betik")}
            value=""
            onChange={(e) => {
              const v = e.currentTarget.value as 'indicator' | 'strategy' | 'library' | '';
              e.currentTarget.value = '';
              if (v) newScript(v);
            }}
          >
            <option value="">{tt("＋ Yeni")}</option>
            <option value="indicator">{tt("Gösterge")}</option>
            <option value="strategy">{tt("Strateji")}</option>
            <option value="library">{tt("Kütüphane")}</option>
          </select>
          <button id="btn-open-script" class="btn-secondary" title={tt("Betiklerim")} onClick={() => setScriptDialog('open')}>{tt("Aç")}</button>
          <select
            id="sel-script-preset"
            class="script-select"
            title={tfmt("Hazır {0} Şablonları", LANG_NAME)}
            value={BUILTIN_SCRIPT_PRESETS.find((p) => p.code === ui.scriptCode)?.id ?? ''}
            onChange={(e) => {
              if (e.currentTarget.value) applyPreset(e.currentTarget.value);
            }}
          >
            <option value="">{tt("— Şablon seç —")}</option>
            <For each={BUILTIN_SCRIPT_PRESETS}>{(p) => <option value={p.id}>{p.name}</option>}</For>
          </select>
          <select
            id="sel-script-secondary"
            class="script-select"
            title={tt("Aynı grafikte ikinci betik (ör. gösterge + strateji birlikte)")}
            value={BUILTIN_SCRIPT_PRESETS.find((p) => p.code === ui.scriptCode2)?.id ?? ''}
            onChange={(e) => applySecondary(e.currentTarget.value)}
          >
            <option value="">{tt("＋ Ek betik yok")}</option>
            <For each={BUILTIN_SCRIPT_PRESETS}>{(p) => <option value={p.id}>＋ {p.name}</option>}</For>
          </select>
          <button id="btn-run-script" class="btn-primary" title={tt("Grafiğe ekle / güncelle (⌘↵)")} onClick={applyScriptToChart}>{tt("▶ Grafiğe Uygula")}</button>
          <button id="btn-save-script" class="btn-secondary" title={tt("Kaydet (⌘S) — her kayıt yeni sürüm")} onClick={() => void saveCurrent()}>{tt("Kaydet")}</button>
          <button id="btn-saveas-script" class="btn-secondary" title={tt("Farklı kaydet")} onClick={() => setScriptDialog('saveas')}>{tt("Farklı Kaydet")}</button>
          <button id="btn-versions-script" class="btn-secondary" title={tt("Sürüm geçmişi")} onClick={() => setScriptDialog('versions')}>{tt("Sürümler")}</button>
          <button id="btn-ref-script" class="btn-secondary" title={tfmt("{0} referans kılavuzu", LANG_NAME)} onClick={() => setScriptDialog('reference')}>{tt("Referans")}</button>
          </div>
          <Show when={!ui.wbCollapsed}>
            <button
              id="btn-expand-wb"
              class="btn-secondary"
              title={wbExpanded() ? tt("Normal Boyut") : tt("Paneli Genişlet (Tam Ekran Modu)")}
              onClick={() => setWbExpanded(!wbExpanded())}
            >
              {wbExpanded() ? '⤡' : '⤢'}
            </button>
          </Show>
          <button id="btn-toggle-wb" class="btn-secondary" title={tt("Paneli Küçült / Büyüt")} onClick={toggleWorkbench}>
            {ui.wbCollapsed ? '▲' : '▼'}
          </button>
        </div>
      </div>
      <ScriptPanel />
      <BacktestPanel />
      <ScreenerPanel />
      <TerminalPanels />
      <PaperAccountPanel active={ui.wbTab === 'paper'} />
      <ScriptsDialog />
    </section>
  );
}
