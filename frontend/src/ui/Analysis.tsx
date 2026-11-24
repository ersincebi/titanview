import { tfmt, tt, localeTag } from '../state/i18n';
import { For, Show, createMemo, type JSX } from 'solid-js';
import type { ACone, ATarget, Analysis, RelatedItem } from '../api/client';
import { analysis, flow, loadAnalysis, related, sectionState, toggleSection } from '../state/analysisStore';
import { formatPrice } from '../state/format';
import { MONTHS_TR, TONE_ICON, WEEKDAYS_TR, scoreColor } from '../state/terminal';
import { LabPanel } from './Lab';
import { showView } from '../state/terminalStore';
import { addHLineAt, candles, setWorkbenchTab, switchSymbol, ui } from '../state/store';

const sgn = (v: number) => (v > 0 ? '+' : '');
const pct = (v: number | null | undefined, d = 2) => (v == null ? '—' : `${sgn(v)}${v.toFixed(d)}%`);
const short = (s: string) => s.replace('.IS', '').replace('USDT', '');
const voteColor = (v: number) => (v > 0 ? 'var(--bull)' : v < 0 ? 'var(--bear)' : 'var(--text-secondary)');
const voteIcon = (v: number) => (v > 0 ? '▲' : v < 0 ? '▼' : '●');
const usd = (v: number) => (v >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : v >= 1e3 ? `$${(v / 1e3).toFixed(1)}K` : `$${v.toFixed(0)}`);
const TF_TR: Record<string, string> = { '15m': '15D', '1h': '1S', '4h': '4S', '1d': '1G', '1w': '1H' };
const lastTime = () => {
  const c = candles();
  return c.length ? c[c.length - 1].time : 0;
};

function Section(props: { id: string; title: string; badge?: JSX.Element; defaultOpen?: boolean; children: JSX.Element }): JSX.Element {
  const open = () => sectionState()[props.id] ?? props.defaultOpen ?? true;
  return (
    <section class="an-sec" classList={{ closed: !open() }} data-an-sec={props.id}>
      <button class="an-sec-head" onClick={() => toggleSection(props.id, props.defaultOpen ?? true)} aria-expanded={open()}>
        <span class="an-caret">{open() ? '▾' : '▸'}</span>
        <span class="an-sec-title">{props.title}</span>
        <span class="an-sec-badge">{props.badge}</span>
      </button>
      <Show when={open()}><div class="an-sec-body">{props.children}</div></Show>
    </section>
  );
}

function Line(props: { price: number; label?: string }): JSX.Element {
  return (
    <button class="chip-btn an-line-btn" data-level-line={props.price} title={tt("Grafiğe yatay çizgi ekle")} onClick={() => addHLineAt(props.price, lastTime())}>
      {tt("+ çizgi")}
    </button>
  );
}

/** Güven konisi: 1/5/20 günlük %68 ve %95 aralıkları, son kapanıştan çıkan huni. */
function ConeChart(props: { last: number; cones: ACone[] }): JSX.Element {
  const W = 300, H = 120, PAD = 6;
  const xs = [0, 0.18, 0.55, 1];
  const geo = createMemo(() => {
    const lo = Math.min(...props.cones.map((c) => c.lo95), props.last);
    const hi = Math.max(...props.cones.map((c) => c.hi95), props.last);
    const y = (p: number) => PAD + (1 - (p - lo) / (hi - lo || 1)) * (H - 2 * PAD);
    const x = (i: number) => 4 + xs[i] * (W - 54);
    const band = (u: (c: ACone) => number, l: (c: ACone) => number) => {
      const top = props.cones.map((c, i) => `${x(i + 1)},${y(u(c))}`);
      const bot = props.cones.map((c, i) => `${x(i + 1)},${y(l(c))}`).reverse();
      return `${x(0)},${y(props.last)} ${top.join(' ')} ${bot.join(' ')}`;
    };
    return { y, x, b95: band((c) => c.hi95, (c) => c.lo95), b68: band((c) => c.hi68, (c) => c.lo68) };
  });
  return (
    <svg class="an-cone" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={tt("Fiyat olasılık konisi")}>
      <polygon points={geo().b95} fill="var(--accent)" opacity="0.14" />
      <polygon points={geo().b68} fill="var(--accent)" opacity="0.28" />
      <line x1={geo().x(0)} x2={W - 50} y1={geo().y(props.last)} y2={geo().y(props.last)} stroke="var(--text-secondary)" stroke-dasharray="3 3" />
      <For each={props.cones}>
        {(c, i) => (
          <>
            <line x1={geo().x(i() + 1)} x2={geo().x(i() + 1)} y1={geo().y(c.hi95)} y2={geo().y(c.lo95)} stroke="var(--text-secondary)" opacity="0.5" />
            <text x={geo().x(i() + 1) + 3} y={H - 2} class="an-cone-lbl">{c.days}g</text>
          </>
        )}
      </For>
      <text x={W - 48} y={geo().y(props.cones[2].hi95) + 3} class="an-cone-lbl" fill="var(--bull)">{formatPrice(props.cones[2].hi95)}</text>
      <text x={W - 48} y={geo().y(props.last) + 3} class="an-cone-lbl">{formatPrice(props.last)}</text>
      <text x={W - 48} y={geo().y(props.cones[2].lo95) + 3} class="an-cone-lbl" fill="var(--bear)">{formatPrice(props.cones[2].lo95)}</text>
    </svg>
  );
}

function TargetList(props: { items: ATarget[] }): JSX.Element {
  return (
    <table class="bt-table an-table">
      <tbody>
        <For each={[...props.items].sort((a, b) => b.price - a.price)}>
          {(t) => (
            <tr>
              <td>{t.label}</td>
              <td class="an-num">{formatPrice(t.price)}</td>
              <td class="an-num" style={{ color: voteColor(t.distPct) }}>{pct(t.distPct)}</td>
              <td><Line price={t.price} /></td>
            </tr>
          )}
        </For>
      </tbody>
    </table>
  );
}

function VolProfile(props: { p: NonNullable<Analysis['profile']> }): JSX.Element {
  const max = () => Math.max(1, ...props.p.bins.map((b) => b.volume));
  const inVA = (price: number) => price >= props.p.val && price <= props.p.vah;
  return (
    <div class="an-vp">
      <For each={[...props.p.bins].reverse()}>
        {(b) => (
          <div class="an-vp-row" title={`${formatPrice(b.price)} · hacim ${Math.round(b.volume).toLocaleString(localeTag())}`}>
            <div class="an-vp-bar" classList={{ va: inVA(b.price), poc: Math.abs(b.price - props.p.poc) < 1e-9 }} style={{ width: `${(b.volume / max()) * 100}%` }} />
          </div>
        )}
      </For>
    </div>
  );
}

function RelRow(props: { it: RelatedItem }): JSX.Element {
  const it = () => props.it;
  return (
    <tr class="an-rel-row" data-rel-sym={it().symbol} onClick={() => void switchSymbol(it().symbol, ui.interval)} title={tt(it().displayName)}>
      <td><b>{short(it().symbol)}</b></td>
      <td class="an-num" style={{ color: voteColor(it().r90) }}>{it().r90 > 0 ? '+' : ''}{it().r90.toFixed(2)}</td>
      <td class="an-num term-hint">{it().r30 == null ? '' : `${tt('30g')} ${it().r30! > 0 ? '+' : ''}${it().r30!.toFixed(2)}`}</td>
      <td class="term-hint">{it().delta == null ? '' : Math.abs(it().delta!) < 0.15 ? '' : it().delta! > 0 ? tt("↗ güçleniyor") : tt("↘ zayıflıyor")}</td>
    </tr>
  );
}

function SeasonBars(props: { title: string; cells: Array<{ avgPct: number; hitPct: number; n: number } | null>; labels: string[] }): JSX.Element {
  const max = () => Math.max(0.01, ...props.cells.map((c) => Math.abs(c?.avgPct ?? 0)));
  return (
    <div class="season">
      <div class="term-title">{props.title}</div>
      <div class="season-row">
        <For each={props.cells}>
          {(c, i) => (
            <div class="season-cell" title={c ? `${props.labels[i()]}: ort. ${pct(c.avgPct)} · pozitif %${c.hitPct.toFixed(0)} · n=${c.n}` : tt("veri yok")}>
              <div class="season-bar-wrap">
                <div class="season-bar" style={{ height: `${c ? (Math.abs(c.avgPct) / max()) * 100 : 0}%`, background: c && c.avgPct >= 0 ? 'var(--bull)' : 'var(--bear)', 'align-self': c && c.avgPct >= 0 ? 'flex-end' : 'flex-start' }} />
              </div>
              <span>{props.labels[i()]}</span>
            </div>
          )}
        </For>
      </div>
    </div>
  );
}

const METRICS: Array<[string, string, (m: Analysis['insights']['metrics']) => string]> = [
  ['Z-skoru (20g)', tt("Fiyatın 20g ortalamadan standart sapma uzaklığı"), (m) => (m.z20 == null ? '—' : m.z20.toFixed(2))],
  [tt("Sıkışma %"), tt("Bollinger genişliğinin son 120 barlık sırası (düşük = dar)"), (m) => (m.bbWidthPctile == null ? '—' : `%${m.bbWidthPctile.toFixed(0)}`)],
  [tt("Oynaklık %"), tt("ATR%’nin kendi 1 yıllık sırası"), (m) => (m.atrPctile == null ? '—' : `%${m.atrPctile.toFixed(0)}`)],
  ['Momentum 12-1', tt("Son 21 gün hariç 1 yıllık getiri"), (m) => pct(m.momentum121)],
  [tt("Göreli güç 3A"), tt("Benchmark’a göre 3 aylık fazla getiri (puan)"), (m) => (m.relStrength3m == null ? '—' : `${sgn(m.relStrength3m)}${m.relStrength3m.toFixed(1)}`)],
  [tt("Zirveden düşüş"), tt("Mevcut kapanışın tepeye uzaklığı"), (m) => `${m.drawdownPct.toFixed(1)}% · ${m.daysSincePeak} bar`],
  ['VaR %95 (1g)', tt("Tarihsel: günlerin %95’inde kayıp bundan küçük"), (m) => pct(m.var95Pct)],
  ['Seri', tt("Üst üste aynı yönde kapanış"), (m) => (m.streak === 0 ? '—' : `${m.streak > 0 ? '+' : ''}${m.streak}`)],
];

const REGIME_TR: Record<string, string> = { 'trend-up': tt("Yükselen trend"), 'trend-down': tt("Düşen trend"), range: 'Yatay / trendsiz' };
const GROUP_TR: Record<string, string> = { trend: 'Trend', momentum: 'Momentum', volume: tt('Hacim') };

function Body(props: { a: Analysis; mtf: Array<import('../api/client').TFTrend>; agreement: string; benchmark?: string }): JSX.Element {
  const a = () => props.a;
  const i = () => props.a.insights;
  const topSignals = () => [...i().signals].sort((x, y) => Math.abs(y.weight) - Math.abs(x.weight)).slice(0, 5);
  return (
    <>
      <Show when={topSignals().length > 0}>
        <div class="an-signals">
          <For each={topSignals()}>
            {(sg) => (
              <div class={`sig-card sig-${sg.tone}`} data-sig={sg.key} title={sg.detail}>
                <span class="sig-ic">{TONE_ICON[sg.tone]}</span>
                <div><b>{sg.label}</b><div class="sig-detail">{sg.detail}</div></div>
              </div>
            )}
          </For>
        </div>
      </Show>

      <Section id="mtf" title={tt("Zaman dilimi uyumu")} badge={<span class="an-badge">{props.agreement}</span>}>
        <div class="an-mtf" id="an-mtf">
          <For each={props.mtf}>
            {(t) => (
              <div class="an-mtf-cell" data-mtf={t.tf} data-dir={t.dir} title={t.detail} style={{ color: t.dir === 'up' ? 'var(--bull)' : t.dir === 'down' ? 'var(--bear)' : 'var(--text-secondary)' }}>
                <span>{TF_TR[t.tf] ?? t.tf}</span>
                <b>{t.dir === 'up' ? '▲' : t.dir === 'down' ? '▼' : t.dir === 'flat' ? '◆' : '–'}</b>
                <small>{t.rsi == null ? '' : `RSI ${t.rsi.toFixed(0)}`}</small>
              </div>
            )}
          </For>
        </div>
        <div class="term-hint">{tt("EMA20/50 dizilimi + fiyat/EMA20 + MACD histogramı. Hepsi aynı yöndeyse sinyal güçlüdür.")}</div>
      </Section>

      <Show when={a().projection}>
        {(p) => (
          <Section id="proj" title={tt("Projeksiyon")} badge={<span class="an-badge">σ {p().sigmaDailyPct.toFixed(2)}{tt("%/gün")}</span>}>
            <ConeChart last={i().last} cones={p().cones} />
            <table class="bt-table an-table" id="an-cones">
              <thead><tr><th>{tt("Ufuk")}</th><th>{tt("%68 aralık")}</th><th>{tt("%95 aralık")}</th></tr></thead>
              <tbody>
                <For each={p().cones}>
                  {(c) => (
                    <tr>
                      <td>{c.days}{' '}{tt("gün")}</td>
                      <td class="an-num">{formatPrice(c.lo68)} – {formatPrice(c.hi68)}</td>
                      <td class="an-num">{formatPrice(c.lo95)} – {formatPrice(c.hi95)}</td>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
            <div class="term-title">{tt("ATR hedefleri")}</div>
            <TargetList items={p().atrTargets} />
            <Show when={p().fibTargets.length > 0}>
              <div class="term-title">{tt("Fibonacci (son 120 bar salınımı)")}</div>
              <TargetList items={p().fibTargets} />
            </Show>
            <div class="term-hint">{p().note}</div>
          </Section>
        )}
      </Show>

      <Show when={a().analog}>
        {(an) => (
          <Section id="analog" title={tt("Benzer durumlar")} badge={<span class="an-badge">n={an().n}</span>}>
            <div class="term-hint">{an().condition}</div>
            <table class="bt-table an-table" id="an-analog">
              <thead><tr><th>{tt("Sonraki")}</th><th>{tt("Ort.")}</th><th>{tt("Medyan")}</th><th>{tt("Pozitif")}</th><th>P10 / P90</th></tr></thead>
              <tbody>
                <For each={[an().h5, an().h20].filter((d): d is NonNullable<typeof d> => !!d)}>
                  {(d) => (
                    <tr>
                      <td>{d.horizon}{' '}{tt("gün")}</td>
                      <td class="an-num" style={{ color: voteColor(d.meanPct) }}>{pct(d.meanPct)}</td>
                      <td class="an-num">{pct(d.medianPct)}</td>
                      <td class="an-num">%{d.hitPct.toFixed(0)}</td>
                      <td class="an-num">{pct(d.p10Pct, 1)} / {pct(d.p90Pct, 1)}</td>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
            <div class="term-hint">{an().note}</div>
          </Section>
        )}
      </Show>

      <Section id="levels" title={tt("Seviyeler")} badge={<Show when={a().profile}>{(p) => <span class="an-badge">POC {formatPrice(p().poc)}</span>}</Show>}>
        <table class="bt-table an-table" id="insight-levels">
          <tbody>
            <For each={[...(i().resistance ?? []).slice().reverse().map((l) => ({ ...l, kind: 'D' })), ...(i().support ?? []).map((l) => ({ ...l, kind: 'S' }))]}>
              {(l) => (
                <tr>
                  <td style={{ color: l.kind === 'D' ? 'var(--bear)' : 'var(--bull)', 'font-weight': '700' }}>{l.kind === 'D' ? tt("Direnç") : 'Destek'}</td>
                  <td class="an-num">{formatPrice(l.price)}</td>
                  <td class="an-num">{pct(l.distPct)}</td>
                  <td class="term-hint">{l.touches}{' '}{tt("dokunuş")}</td>
                  <td><Line price={l.price} /></td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
        <Show when={!(i().support?.length || i().resistance?.length)}><div class="term-note">{tt("Yeterli swing noktası yok.")}</div></Show>
        <Show when={a().profile}>
          {(p) => (
            <>
              <div class="term-title">{tt("Hacim profili (son 120 bar)")}</div>
              <VolProfile p={p()} />
              <div class="an-vp-keys">
                <span>VAH <b>{formatPrice(p().vah)}</b> <Line price={p().vah} /></span>
                <span>POC <b>{formatPrice(p().poc)}</b> <Line price={p().poc} /></span>
                <span>VAL <b>{formatPrice(p().val)}</b> <Line price={p().val} /></span>
              </div>
            </>
          )}
        </Show>
      </Section>

      <Section id="votes" title={tt("İndikatör oyları")} badge={<span class="an-badge"><span style={{ color: 'var(--bull)' }}>{tt("AL")}{' '}{a().buy}</span> · {a().neutral} · <span style={{ color: 'var(--bear)' }}>{tt("SAT")}{' '}{a().sell}</span></span>}>
        <For each={['trend', 'momentum', 'volume'] as const}>
          {(g) => (
            <Show when={a().votes.some((v) => v.group === g)}>
              <div class="term-title">{GROUP_TR[g]}</div>
              <table class="bt-table an-table">
                <tbody>
                  <For each={a().votes.filter((v) => v.group === g)}>
                    {(v) => (
                      <tr data-vote={v.key} title={v.detail}>
                        <td>{v.name}</td>
                        <td class="an-num">{v.value}</td>
                        <td style={{ color: voteColor(v.vote), 'font-weight': '700', 'text-align': 'right' }}>{voteIcon(v.vote)} {v.vote > 0 ? tt("AL") : v.vote < 0 ? tt("SAT") : tt("NÖTR")}</td>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </Show>
          )}
        </For>
        <div class="term-hint">{tt("Satıra gelince gerekçe görünür. Bileşik skor = %60 indikatör oyları + %40 sinyal motoru.")}</div>
      </Section>

      <Section id="regime" title={tt("Rejim & hacim akışı")} badge={<span class="an-badge">{REGIME_TR[a().regime.trend]}</span>}>
        <div class="metric-grid">
          <div class="metric-cell" title={tt("ADX ≥ 25 trend var")}><span>ADX</span><b>{a().regime.adx == null ? '—' : a().regime.adx!.toFixed(1)}</b></div>
          <div class="metric-cell" title={tt("Bollinger genişliği sırası")}><span>{tt("Oynaklık")}</span><b>{a().regime.volatility}</b></div>
          <div class="metric-cell" title={tt("52 haftalık aralıkta konum (0 = dip, 100 = tepe)")}><span>{tt("52h aralık")}</span><b>{a().regime.rangePos52w == null ? '—' : `%${a().regime.rangePos52w!.toFixed(0)}`}</b></div>
          <div class="metric-cell" title={tt("Son bar hacmi / 20g ortalama")}><span>{tt("Göreli hacim")}</span><b>{a().flow.relVolume == null ? '—' : `${a().flow.relVolume!.toFixed(2)}x`}</b></div>
          <div class="metric-cell" title={tt("OBV'nin 20 barlık eğimi (ort. hacme göre)")}><span>{tt("OBV eğimi")}</span><b style={{ color: voteColor(a().flow.obvSlopePct) }}>{pct(a().flow.obvSlopePct, 0)}</b></div>
          <div class="metric-cell" title={tt("Chaikin para akışı")}><span>CMF 20</span><b>{a().flow.cmf20 == null ? '—' : a().flow.cmf20!.toFixed(2)}</b></div>
        </div>
        <Show when={a().flow.divergence}>
          <div class={`sig-card sig-${a().flow.divergence === 'bullish' ? 'bull' : 'bear'}`} data-divergence={a().flow.divergence}>
            <span class="sig-ic">{a().flow.divergence === 'bullish' ? '▲' : '▼'}</span>
            <div>
              <b>{a().flow.divergence === 'bullish' ? 'Pozitif uyumsuzluk' : 'Negatif uyumsuzluk'}</b>
              <div class="sig-detail">{a().flow.divergence === 'bullish' ? tt("Fiyat 20 bar dibi yaptı ama OBV yapmadı: satış baskısı azalıyor olabilir.") : tt("Fiyat 20 bar zirvesi yaptı ama OBV yapmadı: yükseliş hacimle desteklenmiyor.")}</div>
            </div>
          </div>
        </Show>
      </Section>

      <Show when={a().gaps}>
        {(g) => (
          <Section id="gaps" title={tt("Açılış boşlukları")} defaultOpen={false} badge={<span class="an-badge">{tt("son")}{' '}{pct(g().lastGapPct)}</span>}>
            <table class="bt-table an-table" id="an-gaps">
              <thead><tr><th /><th>{tt("Adet")}</th><th>{tt("Ort.")}</th><th>{tt("Kapanma")}</th></tr></thead>
              <tbody>
                <tr><td>{tt("Yukarı")}</td><td class="an-num">{g().up.n}</td><td class="an-num">{pct(g().up.avgPct)}</td><td class="an-num">%{g().up.fillPct.toFixed(0)}</td></tr>
                <tr><td>{tt("Aşağı")}</td><td class="an-num">{g().down.n}</td><td class="an-num">{pct(g().down.avgPct)}</td><td class="an-num">%{g().down.fillPct.toFixed(0)}</td></tr>
                <tr><td>{tt("Pazartesi (hafta sonu)")}</td><td class="an-num">{g().monday.n}</td><td class="an-num">{pct(g().monday.avgPct)}</td><td class="an-num">%{g().monday.fillPct.toFixed(0)}</td></tr>
              </tbody>
            </table>
            <div class="term-hint">{tt("|boşluk| ≥ %")}{g().thresholdPct}{tt("; \"kapanma\" = aynı gün önceki kapanışa dönüş.")}{' '}{g().days}{' '}{tt("günlük veri.")}</div>
          </Section>
        )}
      </Show>

      <Section id="risk" title={tt("Risk & mevsimsellik")} defaultOpen={false} badge={<span class="an-badge">{tt("VaR")}{' '}{pct(i().metrics.var95Pct)}</span>}>
        <div class="metric-grid">
          <For each={METRICS}>{([label, hint, fmt]) => <div class="metric-cell" title={hint}><span>{label}</span><b>{fmt(i().metrics)}</b></div>}</For>
        </div>
        <Show when={i().weekday && i().month} fallback={<div class="term-note">{tt("Mevsimsellik için ≥ ~2 yıllık günlük veri gerekir.")}</div>}>
          <SeasonBars title={tt("Haftanın günü (ort. günlük getiri)")} cells={i().weekday!} labels={WEEKDAYS_TR} />
          <SeasonBars title={tt("Ay (ort. aylık getiri)")} cells={i().month!} labels={MONTHS_TR} />
        </Show>
      </Section>
    </>
  );
}

function RelatedSection(): JSX.Element {
  const r = () => related();
  return (
    <Section id="related" title={tt("İlişkiler (korelasyon)")} badge={<Show when={r().data?.beta !== undefined}><span class="an-badge">β {r().data!.beta!.toFixed(2)}</span></Show>}>
      <Show when={r().loading && !r().data}><div class="term-note">{tt("Korelasyonlar hesaplanıyor…")}</div></Show>
      <Show when={r().error}><div class="term-note term-error">{r().error}</div></Show>
      <Show when={r().data}>
        {(d) => (
          <>
            <Show when={d().benchmark}>
              <div class="term-hint" id="an-bench">{d().benchmark}: 90g {d().benchR90 == null ? '—' : d().benchR90!.toFixed(2)} · 30g {d().benchR30 == null ? '—' : d().benchR30!.toFixed(2)} · beta {d().beta == null ? '—' : d().beta!.toFixed(2)}</div>
            </Show>
            <Show when={d().relStrengthBTC30d !== undefined}>
              <div class="term-hint">{tt("BTC'ye göre 30g göreli güç:")}{' '}<b style={{ color: voteColor(d().relStrengthBTC30d!) }}>{pct(d().relStrengthBTC30d!)}{' '}{tt("puan")}</b></div>
            </Show>
            <Show when={d().positive?.length}>
              <div class="term-title">{tt("Birlikte hareket eden")}</div>
              <table class="bt-table an-table" id="an-rel-pos"><tbody><For each={d().positive!}>{(it) => <RelRow it={it} />}</For></tbody></table>
            </Show>
            <Show when={d().negative?.length}>
              <div class="term-title">{tt("Ters hareket eden (çeşitlendirme)")}</div>
              <table class="bt-table an-table" id="an-rel-neg"><tbody><For each={d().negative!}>{(it) => <RelRow it={it} />}</For></tbody></table>
            </Show>
            <Show when={d().cross?.length}>
              <div class="term-title">{tt("Piyasa sürücüleri")}</div>
              <table class="bt-table an-table" id="an-rel-cross"><tbody><For each={d().cross!}>{(it) => <RelRow it={it} />}</For></tbody></table>
            </Show>
            <div class="term-hint">{d().note}</div>
          </>
        )}
      </Show>
    </Section>
  );
}

function FlowSection(): JSX.Element {
  const f = () => flow();
  const tone = () => f().data?.tone;
  return (
    <Section id="flow" title={tt("Haber & akış")} badge={<Show when={tone()}>{(t) => <span class="an-badge" style={{ color: scoreColor(t().score) }}>{t().label}</span>}</Show>}>
      <Show when={f().loading && !f().data}><div class="term-note">{tt("Haber ve akış yükleniyor…")}</div></Show>
      <Show when={f().error}><div class="term-note term-error">{f().error}</div></Show>
      <Show when={tone()}>
        {(t) => (
          <>
            <div class="an-tonebar" id="an-tone" title={tfmt("{0} olumlu · {1} nötr · {2} olumsuz", t().pos, t().neutral, t().neg)}>
              <span style={{ flex: t().pos, background: 'var(--bull)' }} />
              <span style={{ flex: t().neutral, background: 'var(--border-color)' }} />
              <span style={{ flex: t().neg, background: 'var(--bear)' }} />
            </div>
            <ul class="an-news">
              <For each={t().items.slice(0, 6)}>
                {(it, idx) => (
                  <li title={it.matched?.join(', ') ?? ''}>
                    <span style={{ color: voteColor(it.tone) }}>{voteIcon(it.tone)}</span>{' '}
                    <a href={f().data?.news?.[idx()]?.link ?? '#'} target="_blank" rel="noopener noreferrer">{it.title}</a>
                  </li>
                )}
              </For>
            </ul>
            <div class="term-hint">{t().note}</div>
          </>
        )}
      </Show>
      <Show when={f().data?.whales}>
        {(w) => {
          const total = () => w().buyVolume + w().sellVolume;
          const buy = () => (total() > 0 ? (w().buyVolume / total()) * 100 : 50);
          return (
            <>
              <div class="term-title">{tt("Balina baskısı (son")}{' '}{w().sampled}{' '}{tt("işlem)")}</div>
              <div class="an-tonebar" id="an-whale"><span style={{ flex: buy(), background: 'var(--bull)' }} /><span style={{ flex: 100 - buy(), background: 'var(--bear)' }} /></div>
              <div class="an-split"><span style={{ color: 'var(--bull)' }}>{tt("Alım")}{' '}{usd(w().buyVolume)} (%{buy().toFixed(0)})</span><span style={{ color: 'var(--bear)' }}>{tt("Satış")}{' '}{usd(w().sellVolume)}</span></div>
              <Show when={w().trades.length > 0}><div class="term-hint">{tt("En büyük:")}{' '}{w().trades[0].side === 'BUY' ? tt("ALIŞ") : tt("SATIŞ")} {usd(w().trades[0].notional)} @ {formatPrice(w().trades[0].price)}</div></Show>
            </>
          );
        }}
      </Show>
      <Show when={f().data?.depth}>
        {(d) => (
          <>
            <div class="term-title">{tt("Emir defteri (±%1 bandı, ilk 500 seviye)")}</div>
            <div class="metric-grid" id="an-depth">
              <div class="metric-cell"><span>{tt("Dengesizlik")}</span><b style={{ color: voteColor(d().imbalance1Pct) }}>{pct(d().imbalance1Pct, 1)}</b></div>
              <div class="metric-cell"><span>{tt("Alım / Satım")}</span><b>{usd(d().bid1Pct)} / {usd(d().ask1Pct)}</b></div>
              <div class="metric-cell"><span>{tt("Alım duvarı")}</span><b>{formatPrice(d().largestBid)}</b></div>
              <div class="metric-cell"><span>{tt("Satım duvarı")}</span><b>{formatPrice(d().largestAsk)}</b></div>
            </div>
            <div class="term-hint">{tt("Pozitif = alış emirleri ağır. Anlık görüntü; emirler iptal edilebilir.")}</div>
          </>
        )}
      </Show>
    </Section>
  );
}

const TOOLS: Array<[string, () => void]> = [
  [tt("Isı haritası"), () => showView('market')],
  ['Korelasyon matrisi', () => showView('corr')],
  ['Fikirler', () => showView('ideas')],
  [tt("Tarayıcı"), () => setWorkbenchTab('screener')],
  [tt("Künye"), () => showView('des')],
  [tt("Haber"), () => showView('news')],
  ['Balina', () => showView('whale')],
];

export function AnalysisView(props: { wide?: boolean }): JSX.Element {
  const a = () => analysis();
  return (
    <div class="an-root" classList={{ 'an-wide': !!props.wide }} id={props.wide ? 'an-root-wide' : 'an-root'}>
      <div class="an-head">
        <Show when={a().data} fallback={
          <div class="an-head-empty">
            <b>{tt("Analiz ·")}{' '}{short(ui.symbol)}</b>
            <Show when={a().loading}><span class="term-hint">{tt("hesaplanıyor…")}</span></Show>
          </div>
        }>
          {(d) => (
            <>
              <div class="an-score" id="an-score" style={{ color: scoreColor(d().analysis.score) }}>{d().analysis.score > 0 ? '+' : ''}{d().analysis.score}</div>
              <div class="an-bias">
                <b id="an-bias">{short(d().info.symbol)} · {d().analysis.bias}</b>
                <div class="insight-meter"><span style={{ left: `${(d().analysis.score + 100) / 2}%`, background: scoreColor(d().analysis.score) }} /></div>
                <div class="an-votebar" title={tfmt("{0} AL · {1} nötr · {2} SAT", d().analysis.buy, d().analysis.neutral, d().analysis.sell)}>
                  <span style={{ flex: d().analysis.buy, background: 'var(--bull)' }} />
                  <span style={{ flex: d().analysis.neutral, background: 'var(--border-color)' }} />
                  <span style={{ flex: d().analysis.sell, background: 'var(--bear)' }} />
                </div>
              </div>
            </>
          )}
        </Show>
        <button class="chip-btn an-refresh" id="btn-an-refresh" title={tt("Analizi yenile")} onClick={() => void loadAnalysis(ui.symbol)}>↻</button>
      </div>

      <LabPanel />

      <Show when={a().error}>
        <div class="term-note term-error" data-term-error>
          {a().error}
          <button class="chip-btn" onClick={() => void loadAnalysis(ui.symbol)}>{tt("Tekrar dene")}</button>
        </div>
      </Show>
      <Show when={!a().data && a().loading}>
        <div class="an-skel" aria-busy="true"><span /><span /><span /><span /></div>
      </Show>

      <Show when={a().data}>
        {(d) => (
          <div class="an-cols">
            <Body a={d().analysis} mtf={d().mtf} agreement={d().mtfAgreement} benchmark={d().benchmark} />
            <RelatedSection />
            <FlowSection />
          </div>
        )}
      </Show>

      <div class="an-foot">
        <div class="an-tools">
          <For each={TOOLS}>{([label, fn]) => <button class="chip-btn" onClick={fn}>{label}</button>}</For>
        </div>
        <div class="term-hint">{tt("Kural tabanlı karar desteği; yatırım tavsiyesi değildir. Yalnız fiyat/hacim/haber verisi; temel analiz yok.")}</div>
      </div>
    </div>
  );
}
