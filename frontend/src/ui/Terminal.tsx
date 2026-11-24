import { lang, tt, tfmt, localeTag } from '../state/i18n';
import { AnalysisView } from './Analysis';
import { CalendarPanel } from './Calendar';
import { FundamentalsPanel } from './Fundamentals';
import { OptionsPanel } from './Options';
import { For, Show, createEffect, createMemo, createSignal, on, onMount, type JSX } from 'solid-js';
import { formatPrice } from '../state/format';
import { CORR_MARKETS, IDEA_TAGS, MONTHS_TR, TONE_ICON, WEEKDAYS_TR, corrColor, filterIdeas, heatColor, heatWeights, scoreColor, timeAgo, topPairs, treemap, volumeSpikes } from '../state/terminal';
import { addHLineAt, candles, scriptResult, setUi, switchSymbol, symbols, ui } from '../state/store';
import {
  corrMarket,
  corrPool,
  corrSymbols,
  ideas,
  ideasMarket,
  ideasTag,
  loadIdeas,
  syncTerminalToSymbol,
  setIdeasMarket,
  setIdeasTag,
  selectCorrMarket,
  correlation,
  loadCorrelation,
  loadNews,
  loadOverview,
  loadSecurity,
  loadWhales,
  news,
  overview,
  overviewMarket,
  runCommand,
  security,
  setOverviewMarket,
  whales,
  type Remote,
} from '../state/terminalStore';

const sgn = (v: number) => (v > 0 ? '+' : '');
const pct = (v: number | null | undefined) => (v == null ? '—' : `${sgn(v)}${v.toFixed(2)}%`);
const pnl = (v: number | null | undefined) => (v == null ? 'inherit' : v >= 0 ? 'var(--bull)' : 'var(--bear)');
const short = (s: string) => s.replace('.IS', '').replace('USDT', '');

function Status<T>(props: { r: Remote<T>; emptyMsg: string; hasData: (d: T) => boolean; children: (d: T) => JSX.Element }): JSX.Element {
  return (
    <>
      <Show when={props.r.loading}><div class="term-note">{tt("Yükleniyor…")}</div></Show>
      <Show when={props.r.error}><div class="term-note term-error" data-term-error>{props.r.error}</div></Show>
      <Show when={!props.r.loading && !props.r.error && props.r.data && !props.hasData(props.r.data)}>
        <div class="term-note">{props.emptyMsg}</div>
      </Show>
      <Show when={!props.r.error && props.r.data && props.hasData(props.r.data)}>{props.children(props.r.data as T)}</Show>
    </>
  );
}

const MARKETS: Array<['ALL' | 'CRYPTO' | 'BIST' | 'US' | 'FOREX', string]> = [
  ['ALL', tt("Tümü")],
  ['BIST', '🇹🇷 BIST'],
  ['US', '🇺🇸 US'],
  ['CRYPTO', tt("₿ Kripto")],
  ['FOREX', 'FX'],
];

function MarketPanel(): JSX.Element {
  const rects = createMemo(() => {
    const rows = overview().data ?? [];
    return treemap(heatWeights(rows.map((r) => ({ symbol: r.symbol, market: r.market, turnover: r.turnover }))), 100, 100);
  });
  const byKey = createMemo(() => new Map((overview().data ?? []).map((r) => [r.symbol, r])));
  return (
    <div id="wb-panel-market" class="wb-panel wb-panel-single" classList={{ active: ui.wbTab === 'market' }}>
      <div class="term-bar">
        <For each={MARKETS}>
          {([m, label]) => (
            <button class="chip-btn" classList={{ active: overviewMarket() === m }} data-heat-market={m} onClick={() => { setOverviewMarket(m); void loadOverview(m); }}>
              {label}
            </button>
          )}
        </For>
        <span class="term-hint">{tt("Kutu boyutu = işlem hacmi (log, piyasa başına eşit pay) · renk = 1 günlük değişim · tıkla → grafik")}</span>
      </div>
      <Status r={overview()} emptyMsg={tt("Günlük veri alınabilen sembol yok.")} hasData={(d) => d.length > 0}>
        {() => (
          <div class="heatmap" id="heatmap">
            <For each={rects()}>
              {(r) => {
                const row = () => byKey().get(r.key)!;
                return (
                  <div
                    class="heat-tile"
                    data-heat-sym={r.key}
                    title={`${tt(row().displayName)} · ${lang() === "en" ? "1W" : "1H"} ${pct(row().change1w)} · ${lang() === "en" ? "1M" : "1A"} ${pct(row().change1m)}`}
                    style={{ left: `${r.x}%`, top: `${r.y}%`, width: `${r.w}%`, height: `${r.h}%`, background: heatColor(row().change1d) }}
                    onClick={() => void switchSymbol(r.key, ui.interval)}
                  >
                    <b>{short(r.key)}</b>
                    <span>{pct(row().change1d)}</span>
                  </div>
                );
              }}
            </For>
          </div>
        )}
      </Status>
    </div>
  );
}

function CorrPanel(): JSX.Element {
  const [picked, setPicked] = createSignal<string[]>([]);
  const pool = () => (corrMarket() === 'MIX' || corrPool().length === 0 ? symbols().slice(0, 24).map((s) => s.symbol) : corrPool());
  createEffect(on(corrMarket, () => setPicked([]), { defer: true }));
  const chosen = () => (picked().length ? picked() : corrSymbols());
  const toggle = (s: string) => {
    const cur = chosen();
    setPicked(cur.includes(s) ? cur.filter((x) => x !== s) : cur.length >= 12 ? cur : [...cur, s]);
  };
  return (
    <div id="wb-panel-corr" class="wb-panel wb-panel-single" classList={{ active: ui.wbTab === 'corr' }}>
      <div class="term-bar">
        <For each={CORR_MARKETS}>
          {([m, label]) => (
            <button class="chip-btn corr-market" classList={{ active: corrMarket() === m }} data-corr-market={m} onClick={() => void selectCorrMarket(m)}>
              {label}
            </button>
          )}
        </For>
      </div>
      <div class="term-bar">
        <For each={pool()}>
          {(s) => (
            <button class="chip-btn" classList={{ active: chosen().includes(s) }} data-corr-pick={s} onClick={() => toggle(s)}>
              {short(s)}
            </button>
          )}
        </For>
        <button id="btn-corr-run" class="btn-primary" disabled={chosen().length < 2} onClick={() => void loadCorrelation(chosen())}>{tt("Hesapla (günlük getiri)")}</button>
      </div>
      <Status r={correlation()} emptyMsg={tt("Korelasyon için yeterli veri yok.")} hasData={(d) => d.symbols.length > 0}>
        {(d) => (
          <div style={{ overflow: 'auto', flex: '1' }}>
            <table class="bt-table corr-table" id="corr-table">
              <thead>
                <tr><th /><For each={d.symbols}>{(s) => <th>{short(s)}</th>}</For></tr>
              </thead>
              <tbody>
                <For each={d.symbols}>
                  {(rowSym, i) => (
                    <tr>
                      <th>{short(rowSym)}</th>
                      <For each={d.matrix[i()]}>
                        {(v) => (
                          <td class="corr-cell" data-corr-val={v == null ? 'na' : v} style={{ background: corrColor(v) }}>
                            {v == null ? '—' : v.toFixed(2)}
                          </td>
                        )}
                      </For>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
            {(() => {
              const tp = topPairs(d.symbols, d.matrix, 3);
              const chip = (p: { a: string; b: string; r: number }) => (
                <span class="pair-chip" style={{ color: p.r >= 0 ? 'var(--bull)' : 'var(--bear)' }}>
                  {short(p.a)}–{short(p.b)} <b>{p.r > 0 ? '+' : ''}{p.r.toFixed(2)}</b>
                </span>
              );
              return (
                <div class="corr-pairs" id="corr-pairs">
                  <div><span class="term-hint">{tt("En birlikte hareket eden:")}</span> <For each={tp.positive}>{chip}</For></div>
                  <div><span class="term-hint">{tt("En ters hareket eden (çeşitlendirme):")}</span> <For each={tp.negative}>{chip}</For></div>
                </div>
              );
            })()}
            <div class="term-hint" style={{ padding: '6px' }}>{d.days}{' '}{tt("gün · günlük log getiri · ortak tarihlerde Pearson · —: yetersiz ortak veri")}</div>
          </div>
        )}
      </Status>
    </div>
  );
}

function NewsList(props: { items: Array<{ title: string; publisher: string; link: string; time: number }> }): JSX.Element {
  return (
    <ul class="news-list news-cards">
      <For each={props.items}>
        {(n) => (
          <li class="news-card">
            <a href={n.link} target="_blank" rel="noopener noreferrer" class="news-title">{n.title}</a>
            <div class="news-meta">
              <Show when={n.publisher}><span class="news-pub">{n.publisher}</span></Show>
              <span title={n.time ? new Date(n.time * 1000).toLocaleString(localeTag()) : ''}>{timeAgo(n.time)}</span>
            </div>
          </li>
        )}
      </For>
    </ul>
  );
}

const en = () => lang() === 'en';

function DesPanel(): JSX.Element {
  const rows = (s: NonNullable<ReturnType<typeof security>['data']>['stats']): Array<[string, string, string?]> => [
    [tt('Son'), formatPrice(s.last)],
    [en() ? '1D' : '1G', pct(s.change1d), pnl(s.change1d)],
    [en() ? '1W' : '1H', pct(s.change1w), pnl(s.change1w)],
    [en() ? '1M' : '1A', pct(s.change1m), pnl(s.change1m)],
    [en() ? '3M' : '3A', pct(s.change3m), pnl(s.change3m)],
    [en() ? 'YTD' : 'YBB', pct(s.changeYtd), pnl(s.changeYtd)],
    ['1Y', pct(s.change1y), pnl(s.change1y)],
    [tt("52h Yüksek"), formatPrice(s.high52w)],
    [tt("52h Düşük"), formatPrice(s.low52w)],
    [tt('Zirveden'), pct(s.fromHighPct), pnl(s.fromHighPct)],
    [tt("Yıllık Vol"), s.volAnnualPct == null ? '—' : `${s.volAnnualPct.toFixed(2)}%`],
    [tt('Maks. Düşüş'), pct(s.maxDrawdownPct), pnl(s.maxDrawdownPct)],
    [tt("ATR14 / Fiyat"), s.atr14Pct == null ? '—' : `${s.atr14Pct.toFixed(2)}%`],
    [tt("Veri (gün)"), String(s.bars)],
  ];
  return (
    <div id="wb-panel-des" class="wb-panel wb-panel-single" classList={{ active: ui.wbTab === 'des' }}>
      <div class="term-bar">
        <b>{ui.symbol}</b>
        <button class="btn-secondary" id="btn-des-refresh" onClick={() => { void loadSecurity(ui.symbol); void loadNews(ui.symbol); }}>{tt("↻ Güncelle")}</button>
      </div>
      <Status r={security()} emptyMsg={tt("Künye için veri yok.")} hasData={(d) => !!d.stats}>
        {(d) => (
          <div class="des-grid">
            <div>
              <div class="term-title">{tt(d.info.displayName)} <span class="term-hint">{d.info.exchange} · {d.info.currency}{' '}{tfmt("· gecikme {0} dk", d.info.delayMinutes)}</span></div>
              <table class="bt-table" id="des-table">
                <tbody>
                  <For each={rows(d.stats)}>{([k, v, c]) => <tr><td>{k}</td><td style={{ color: c ?? 'inherit', 'font-weight': '700' }}>{v}</td></tr>}</For>
                  <Show when={d.beta !== undefined}>
                    <tr><td>Beta ({d.benchmark})</td><td style={{ 'font-weight': '700' }}>{d.beta!.toFixed(2)}</td></tr>
                  </Show>
                </tbody>
              </table>
            </div>
            <div>
              <div class="term-title">{tt("Haberler")}</div>
              <Status r={news()} emptyMsg={tt("Haber yok.")} hasData={(n) => n.items.length > 0}>{(n) => <NewsList items={n.items.slice(0, 6)} />}</Status>
            </div>
          </div>
        )}
      </Status>
    </div>
  );
}

function NewsPanel(): JSX.Element {
  // Haber sekmesi açıkken sembol değişince haber kendiliğinden yenilenir
  const scope = () => news().data?.symbol ?? null;
  return (
    <div id="wb-panel-news" class="wb-panel wb-panel-single" classList={{ active: ui.wbTab === 'news' }}>
      <div class="term-bar">
        <button class="chip-btn" classList={{ active: scope() === null }} id="btn-news-general" onClick={() => void loadNews(null)}>{tt("Genel")}</button>
        <button class="chip-btn" classList={{ active: scope() !== null }} id="btn-news-symbol" onClick={() => void loadNews(ui.symbol)}>{ui.symbol}</button>
        <button class="chip-btn" id="btn-news-refresh" onClick={() => void loadNews(scope())}>{tt("↻ Yenile")}</button>
        <span class="term-hint">{news().data ? `${news().data!.items.length} haber · kaynak: Yahoo / Google Haberler` : ''}</span>
      </div>
      <Status r={news()} emptyMsg={tt("Haber bulunamadı.")} hasData={(n) => n.items.length > 0}>
        {(n) => <div style={{ 'overflow-y': 'auto', flex: '1' }}><NewsList items={n.items} /></div>}
      </Status>
    </div>
  );
}

const usd = (v: number) => (v >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : v >= 1e3 ? `$${(v / 1e3).toFixed(1)}K` : `$${v.toFixed(0)}`);
const WHALE_USD = 100_000;

function WhalePanel(): JSX.Element {
  return (
    <div id="wb-panel-whale" class="wb-panel wb-panel-single" classList={{ active: ui.wbTab === 'whale' }}>
      <div class="term-bar">
        <b>{ui.symbol}</b>
        <button class="chip-btn" id="btn-whale-refresh" onClick={() => void loadWhales(ui.symbol)}>{tt("↻ Yenile")}</button>
        <span class="term-hint">{tt("Kripto: borsa işlem akışındaki en büyük emirler (🐋 ≥ $100K) · BIST/ABD: ücretsiz işlem akışı yok, hacim anomalisi gösterilir")}</span>
      </div>
      <Status r={whales()} emptyMsg={tt("Veri yok.")} hasData={() => true}>
        {(w) => (
          <Show
            when={w.supported}
            fallback={
              <div class="whale-wrap">
                <div class="term-note" id="whale-unsupported">{(w as { reason: string }).reason}{' '}{tt("Aşağıda mumlardan hesaplanan")}{' '}<b>{tt("hacim anomalileri")}</b>{' '}{tt("(son 30 bar ortalamasının ≥2.5 katı) var — bu kurumsal alım değil, yalnız olağandışı hacimdir.")}</div>
                <SpikeTable />
              </div>
            }
          >
            {(() => {
              const r = (w as { report: import('../api/client').WhaleReport }).report;
              const total = r.buyVolume + r.sellVolume;
              const buyPct = total > 0 ? (r.buyVolume / total) * 100 : 50;
              return (
                <div class="whale-wrap">
                  <div class="whale-pressure" id="whale-pressure">
                    <div class="whale-bar"><span style={{ width: `${buyPct}%` }} /></div>
                    <div class="whale-bar-legend">
                      <span style={{ color: 'var(--bull)' }}>{tt("Alım baskısı")}{' '}{usd(r.buyVolume)} ({buyPct.toFixed(0)}%)</span>
                      <span class="term-hint">{tt("son")}{' '}{r.sampled}{' '}{tt("işlem ·")}{' '}{Math.max(1, Math.round((r.toTime - r.fromTime) / 60))} dk</span>
                      <span style={{ color: 'var(--bear)' }}>{tt("Satış baskısı")}{' '}{usd(r.sellVolume)} ({(100 - buyPct).toFixed(0)}%)</span>
                    </div>
                  </div>
                  <table class="bt-table" id="whale-table">
                    <thead><tr><th></th><th>{tt("Zaman")}</th><th>{tt("Yön")}</th><th>{tt("Fiyat")}</th><th>{tt("Miktar")}</th><th>{tt("Tutar")}</th></tr></thead>
                    <tbody>
                      <For each={r.trades}>
                        {(t) => (
                          <tr>
                            <td>{t.notional >= WHALE_USD ? '🐋' : ''}</td>
                            <td>{new Date(t.time * 1000).toLocaleTimeString(localeTag())}</td>
                            <td style={{ color: t.side === 'BUY' ? 'var(--bull)' : 'var(--bear)', 'font-weight': '700' }}>{t.side === 'BUY' ? tt("ALIŞ") : tt("SATIŞ")}</td>
                            <td>{formatPrice(t.price)}</td>
                            <td>{t.qty.toFixed(4)}</td>
                            <td style={{ 'font-weight': '700' }}>{usd(t.notional)}</td>
                          </tr>
                        )}
                      </For>
                    </tbody>
                  </table>
                </div>
              );
            })()}
          </Show>
        )}
      </Status>
    </div>
  );
}

function SpikeTable(): JSX.Element {
  const spikes = createMemo(() => volumeSpikes(candles()));
  return (
    <Show when={spikes().length > 0} fallback={<div class="term-note">{tt("Bu grafikte olağandışı hacimli bar yok.")}</div>}>
      <table class="bt-table" id="spike-table">
        <thead><tr><th>{tt("Zaman")}</th><th>{tt("Hacim")}</th><th>{tt("Ortalamaya oranı")}</th><th>{tt("Bar getirisi")}</th></tr></thead>
        <tbody>
          <For each={spikes()}>
            {(s) => (
              <tr>
                <td>{new Date(s.time * 1000).toLocaleString(localeTag())}</td>
                <td>{Math.round(s.volume).toLocaleString(localeTag())}</td>
                <td style={{ 'font-weight': '700' }}>{s.ratio.toFixed(1)}x</td>
                <td style={{ color: s.up ? 'var(--bull)' : 'var(--bear)' }}>{pct(s.change)}</td>
              </tr>
            )}
          </For>
        </tbody>
      </table>
    </Show>
  );
}

function AnalysisPanel(): JSX.Element {
  return (
    <div id="wb-panel-insight" class="wb-panel wb-panel-single wb-panel-analysis" classList={{ active: ui.wbTab === 'insight' }}>
      <AnalysisView wide />
    </div>
  );
}

function IdeasPanel(): JSX.Element {
  const rows = createMemo(() => filterIdeas(ideas().data ?? [], ideasTag()));
  const counts = createMemo(() => {
    const m = new Map<string, number>();
    for (const r of ideas().data ?? []) for (const t of r.tags) m.set(t, (m.get(t) ?? 0) + 1);
    return m;
  });
  return (
    <div id="wb-panel-ideas" class="wb-panel wb-panel-single" classList={{ active: ui.wbTab === 'ideas' }}>
      <div class="term-bar">
        <For each={MARKETS}>
          {([m, label]) => (
            <button class="chip-btn" classList={{ active: ideasMarket() === m }} data-ideas-market={m} onClick={() => { setIdeasMarket(m); void loadIdeas(m); }}>
              {label}
            </button>
          )}
        </For>
        <span class="term-hint">{tt("Katalog günlük verisinden taranır (3 dk önbellek) · skor −100..+100 · tıkla → grafik + İçgörü")}</span>
      </div>
      <div class="term-bar">
        <button class="chip-btn" classList={{ active: ideasTag() === null }} data-idea-tag="" onClick={() => setIdeasTag(null)}>{tt("Tümü (")}{ideas().data?.length ?? 0})</button>
        <For each={IDEA_TAGS}>
          {([tag, label, hint]) => (
            <button class="chip-btn" classList={{ active: ideasTag() === tag }} data-idea-tag={tag} title={hint} onClick={() => setIdeasTag(ideasTag() === tag ? null : tag)}>
              {label} ({counts().get(tag) ?? 0})
            </button>
          )}
        </For>
      </div>
      <Status r={ideas()} emptyMsg={tt("Taranabilen sembol yok.")} hasData={(d) => d.length > 0}>
        {() => (
          <div style={{ 'overflow-y': 'auto', flex: '1' }}>
            <Show when={rows().length > 0} fallback={<div class="term-note">{tt("Bu etikette sembol yok.")}</div>}>
              <table class="bt-table" id="ideas-table">
                <thead><tr><th>{tt("Sembol")}</th><th>{tt("Eğilim")}</th><th>{tt("Skor")}</th><th>1G</th><th>RSI</th><th>{tt("Başlıca sinyaller")}</th></tr></thead>
                <tbody>
                  <For each={rows()}>
                    {(r) => (
                      <tr class="idea-row" data-idea-sym={r.symbol} onClick={() => { void switchSymbol(r.symbol, ui.interval); setUi('wbTab', 'insight'); }}>
                        <td><b>{short(r.symbol)}</b> <span class="term-hint">{r.market}</span></td>
                        <td>{r.bias}</td>
                        <td style={{ color: scoreColor(r.score), 'font-weight': '700' }}>{r.score > 0 ? '+' : ''}{r.score}</td>
                        <td style={{ color: pnl(r.change1d) }}>{pct(r.change1d)}</td>
                        <td>{r.rsi14 == null ? '—' : r.rsi14.toFixed(0)}</td>
                        <td class="term-hint">{r.signals.map((x) => x.label).join(' · ')}</td>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </Show>
          </div>
        )}
      </Status>
    </div>
  );
}

/** Betik `table.*` çıktıları (örn. strateji özet tablosu): grafiğin üstünde değil, aşağıda sekmede. */
export function ScriptTables(): JSX.Element {
  const tables = () => scriptResult()?.drawings?.tables ?? [];
  return (
    <div id="script-tables-view">
      <Show when={tables().length > 0} fallback={<div class="term-note">{tt("Yüklü betik tablo üretmiyor.")}</div>}>
        <div style={{ 'overflow-y': 'auto', flex: '1', display: 'flex', gap: '14px', 'flex-wrap': 'wrap', 'align-items': 'flex-start' }}>
          <For each={tables()}>
            {(t) => {
              const grid = () => {
                const rows: Array<Array<(typeof t.cells)[number] | null>> = Array.from({ length: t.rows }, () => Array(t.columns).fill(null));
                for (const c of t.cells) if (c.row >= 0 && c.row < t.rows && c.col >= 0 && c.col < t.columns) rows[c.row][c.col] = c;
                return rows;
              };
              return (
                <div class="pt-card" data-script-table style={{ '--pt-cols': String(t.columns) }}>
                  <For each={grid()}>
                    {(row, ri) => (
                      <For each={row}>
                        {(c) => (
                          <div
                            class="pt-cell"
                            classList={{ 'pt-head': ri() === 0, 'pt-empty': !c || (!c.text && !c.bgColor), 'pt-tint': !!c?.bgColor }}
                            style={{ '--pt-bg': c?.bgColor || 'transparent', color: c?.textColor || undefined, 'text-align': c?.halign ?? 'left' }}
                          >
                            {c?.text ?? ''}
                          </div>
                        )}
                      </For>
                    )}
                  </For>
                </div>
              );
            }}
          </For>
        </div>
      </Show>
    </div>
  );
}

export function TerminalPanels(): JSX.Element {
  // Sembol ya da sekme değişince aktif analiz sekmesi yeni sembolle güncellenir
  createEffect(on(() => [ui.symbol, ui.wbTab] as const, () => syncTerminalToSymbol()));
  return (
    <>
      <FundamentalsPanel />
      <CalendarPanel />
      <OptionsPanel />
      <AnalysisPanel />
      <IdeasPanel />
      <MarketPanel />
      <CorrPanel />
      <DesPanel />
      <NewsPanel />
      <WhalePanel />
    </>
  );
}

export function CommandModal(): JSX.Element {
  let input!: HTMLInputElement;
  const [err, setErr] = createSignal<string | null>(null);
  onMount(() => input.focus());
  const close = () => setUi('modal', null);
  const submit = () => {
    const e = runCommand(input.value);
    setErr(e);
    if (!e) close();
  };
  return (
    <div id="titan-command-modal" class="tv-modal-backdrop" onClick={(e) => e.target === e.currentTarget && close()}>
      <div class="tv-modal" style={{ 'max-width': '560px' }}>
        <div class="tv-modal-header" style={{ padding: '12px 16px' }}>
          <input
            id="command-input"
            ref={input}
            class="tv-input"
            style={{ width: '100%' }}
            placeholder="THYAO GP · AAPL DES · NEWS BTC · HEAT · CORR · SCR"
            autocomplete="off"
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); submit(); }
              else if (e.key === 'Escape') { e.preventDefault(); close(); }
            }}
          />
        </div>
        <div class="tv-modal-body" style={{ padding: '10px 16px', 'font-size': '11px', color: 'var(--text-secondary)' }}>
          <Show when={err()}><div id="command-error" class="term-error">{err()}</div></Show>
          <div>{tt("GP = grafik · DES = künye · N = haber · HEAT = piyasa haritası · CORR = korelasyon · SCR = tarayıcı")}</div>
        </div>
      </div>
    </div>
  );
}
