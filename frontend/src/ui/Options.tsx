import { tfmt, tt } from '../state/i18n';
import { For, Show, createEffect, createMemo, createSignal, on, type JSX } from 'solid-js';
import { fetchOptionChain } from '../api/client';
import {
  OPTION_STRATEGY_PRESETS,
  buildStrategyFromChain,
  computeStrategyPayoff,
  type OptionStrategyLeg,
  type OptionStrategyPresetId,
} from '../state/optionsMath';
import { ui } from '../state/store';
import type { OptionChainResponse, OptionContractQuote } from '../types/market';

const [optState, setOptState] = createSignal<{ loading: boolean; error: string | null; data: OptionChainResponse | null }>({
  loading: false,
  error: null,
  data: null,
});
const [optSymbolOverride, setOptSymbolOverride] = createSignal<string | null>(null);
const [selectedExpiry, setSelectedExpiry] = createSignal<string>('');
const [strikeBand, setStrikeBand] = createSignal<number>(30); // ±30% default, 0 = all
const [legs, setLegs] = createSignal<OptionStrategyLeg[]>([]);
const [activePreset, setActivePreset] = createSignal<OptionStrategyPresetId>('bull_call_spread');

let lastOptKey = '';

export async function loadOptionChain(symbol: string, expiry = '', force = false): Promise<void> {
  const sym = symbol.trim().toUpperCase();
  const key = `${sym}|${expiry.trim().toUpperCase()}`;
  if (!force && key === lastOptKey && optState().data) return;
  lastOptKey = key;
  setOptState({ loading: true, error: null, data: optState().data });
  try {
    if (typeof fetchOptionChain !== 'function') {
      setOptState({ loading: false, error: null, data: null });
      return;
    }
    const res = await fetchOptionChain(sym, expiry);
    if (lastOptKey === key) {
      setOptState({ loading: false, error: null, data: res });
      if (res.supported && res.selectedExpiry) {
        setSelectedExpiry(res.selectedExpiry);
        if (legs().length === 0 && res.rows?.length) {
          setLegs(buildStrategyFromChain(activePreset(), res.rows, res.spotPrice, res.selectedExpiry, res.daysToExpiry));
        }
      }
    }
  } catch (e) {
    if (lastOptKey === key) {
      setOptState({ loading: false, error: e instanceof Error ? e.message : String(e), data: null });
    }
  }
}

export function OptionsPanel(): JSX.Element {
  const effectiveSymbol = () => optSymbolOverride() ?? ui.symbol;

  createEffect(
    on(
      () => [ui.symbol, ui.wbTab] as const,
      ([sym, tab]) => {
        if (tab === 'options') {
          setOptSymbolOverride(null);
          setSelectedExpiry('');
          setLegs([]);
          void loadOptionChain(sym, '', true);
        }
      }
    )
  );

  const pickUnderlying = (sym: string | null) => {
    setOptSymbolOverride(sym);
    setSelectedExpiry('');
    setLegs([]);
    void loadOptionChain(sym ?? ui.symbol, '', true);
  };

  const pickExpiry = (code: string) => {
    setSelectedExpiry(code);
    setLegs([]);
    void loadOptionChain(effectiveSymbol(), code, true);
  };

  const applyStrategyPreset = (id: OptionStrategyPresetId) => {
    setActivePreset(id);
    const d = optState().data;
    if (d && d.supported && d.rows.length > 0) {
      setLegs(buildStrategyFromChain(id, d.rows, d.spotPrice, d.selectedExpiry, d.daysToExpiry));
    }
  };

  const addLegFromContract = (q: OptionContractQuote | null | undefined, side: 'BUY' | 'SELL') => {
    const d = optState().data;
    if (!q || !d) return;
    const next: OptionStrategyLeg = {
      id: `${d.selectedExpiry}_${q.strike}_${q.type}_${side}_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
      side,
      type: q.type,
      strike: q.strike,
      qty: 1,
      premiumUSD: q.markUsd,
      iv: q.markIv || d.summary.atmIv || 55,
      expiry: d.selectedExpiry,
      daysToExpiry: d.daysToExpiry,
    };
    setLegs([...legs(), next]);
  };

  const removeLeg = (id: string) => {
    setLegs(legs().filter((l) => l.id !== id));
  };

  const updateLegQty = (id: string, delta: number) => {
    setLegs(
      legs().map((l) => (l.id === id ? { ...l, qty: Math.max(1, Math.min(50, l.qty + delta)) } : l))
    );
  };

  const filteredRows = createMemo(() => {
    const d = optState().data;
    if (!d || !d.supported) return [];
    const band = strikeBand();
    if (band <= 0) return d.rows;
    const rows = d.rows.filter((r) => Math.abs(r.distancePct) <= band);
    return rows.length >= 4 ? rows : d.rows;
  });

  const payoff = createMemo(() => {
    const d = optState().data;
    if (!d || !d.supported) return null;
    return computeStrategyPayoff(legs(), d.spotPrice);
  });

  const isChartBist = () => ui.symbol.toUpperCase().endsWith('.IS');

  return (
    <div id="wb-panel-options" class="wb-panel wb-panel-single" classList={{ active: ui.wbTab === 'options' }}>
      <div class="term-bar" style={{ 'flex-wrap': 'wrap', gap: '6px' }}>
        <span style={{ 'font-weight': '700', color: '#fff' }}>{tt("Opsiyon Zinciri & Strateji Kurucu")}</span>
        <div style={{ display: 'flex', gap: '4px' }}>
          <button
            id="btn-opt-active"
            class="chip-btn"
            classList={{ active: optSymbolOverride() === null }}
            onClick={() => pickUnderlying(null)}
          >
            {tt("Aktif (")}{ui.symbol})
          </button>
          <button
            id="btn-opt-btc"
            class="chip-btn"
            classList={{ active: effectiveSymbol().startsWith('BTC') }}
            onClick={() => pickUnderlying('BTCUSDT')}
          >
            ₿ BTC (Deribit)
          </button>
          <button
            id="btn-opt-eth"
            class="chip-btn"
            classList={{ active: effectiveSymbol().startsWith('ETH') }}
            onClick={() => pickUnderlying('ETHUSDT')}
          >
            Ξ ETH (Deribit)
          </button>
        </div>

        <Show when={optState().data?.supported}>
          {(() => {
            const d = () => optState().data!;
            return (
              <div style={{ display: 'flex', gap: '10px', 'align-items': 'center', 'font-size': '11.5px', 'margin-left': 'auto', 'flex-wrap': 'wrap' }}>
                <span class="exchange-badge">DERIBIT PUBLIC API</span>
                <span>Spot: <b style={{ color: '#fff', 'font-family': 'var(--font-mono)' }}>${d().spotPrice.toLocaleString('en-US')}</b></span>
                <span>ATM IV: <b style={{ color: '#FF9800', 'font-family': 'var(--font-mono)' }}>{d().summary.atmIv.toFixed(1)}%</b></span>
                <span>P/C OI: <b style={{ 'font-family': 'var(--font-mono)' }}>{d().summary.putCallOiRatio.toFixed(2)}</b></span>
                <span>Max Pain: <b style={{ color: '#0284C7', 'font-family': 'var(--font-mono)' }}>${d().summary.maxPainStrike.toLocaleString('en-US')}</b></span>
                <button id="btn-opt-refresh" class="chip-btn" onClick={() => void loadOptionChain(effectiveSymbol(), selectedExpiry(), true)}>
                  ↻
                </button>
              </div>
            );
          })()}
        </Show>
      </div>

      <Show when={isChartBist() && optState().data?.supported}>
        <div class="viop-honest-banner" id="viop-unsupported-banner">
          ⚠ <b>{tt("BIST VİOP Notu:")}</b> {ui.symbol}{' '}{tt("(Borsa İstanbul VİOP) için ücretsiz açık opsiyon zinciri API'si bulunmamaktadır. Şu anda")}{' '}<b>Deribit Public API ({optState().data?.underlying})</b>{' '}{tt("canlı kripto opsiyon zincirini görüntülüyorsunuz.")}
        </div>
      </Show>

      <Show when={optState().loading && !optState().data}>
        <div class="term-note">{tt("Deribit opsiyon zinciri yükleniyor…")}</div>
      </Show>
      <Show when={optState().error}>
        <div class="term-note term-error" id="opt-error">{optState().error}</div>
      </Show>

      <Show when={optState().data}>
        {(d) => (
          <Show
            when={d().supported}
            fallback={
              <div class="term-note" id="opt-unsupported" style={{ padding: '16px' }}>
                <div style={{ 'font-weight': '700', color: '#fff', 'margin-bottom': '6px' }}>
                  {d().symbol} ({d().market}{tt(") Opsiyon Zinciri Desteklenmiyor")}
                </div>
                <div style={{ 'margin-bottom': '12px', 'max-width': '740px', 'line-height': '1.5' }}>
                  {d().reason}
                </div>
                <div style={{ display: 'flex', gap: '8px', 'align-items': 'center' }}>
                  <button id="btn-opt-switch-btc" class="btn-primary" onClick={() => pickUnderlying('BTCUSDT')}>
                    {tt("₿ Deribit BTC Opsiyon Zincirini Aç")}
                  </button>
                  <button id="btn-opt-switch-eth" class="btn-secondary" onClick={() => pickUnderlying('ETHUSDT')}>
                    {tt("Ξ Deribit ETH Opsiyon Zincirini Aç")}
                  </button>
                </div>
              </div>
            }
          >
            <div class="term-bar" style={{ 'flex-wrap': 'wrap', gap: '4px' }}>
              <span class="term-hint">{tt("Vade:")}</span>
              <For each={d().expiries.slice(0, 10)}>
                {(exp) => (
                  <button
                    class="chip-btn"
                    classList={{ active: d().selectedExpiry === exp.code }}
                    data-opt-expiry={exp.code}
                    onClick={() => pickExpiry(exp.code)}
                  >
                    {exp.code} <span class="term-hint">({Math.round(exp.daysToExpiry)}g)</span>
                  </button>
                )}
              </For>
              <div style={{ 'margin-left': 'auto', display: 'flex', gap: '4px', 'align-items': 'center' }}>
                <span class="term-hint">{tt("Greve Aralığı:")}</span>
                {[
                  [20, '±20%'],
                  [35, '±35%'],
                  [0, tt("Tümü")],
                ].map(([v, lbl]) => (
                  <button
                    class="chip-btn"
                    classList={{ active: strikeBand() === v }}
                    data-opt-band={v}
                    onClick={() => setStrikeBand(Number(v))}
                  >
                    {lbl}
                  </button>
                ))}
              </div>
            </div>

            <div class="opt-workspace-grid">
              {/* LEFT: T-Table Option Chain */}
              <div class="opt-chain-pane">
                <table class="bt-table opt-t-table" id="options-chain-table">
                  <thead>
                    <tr class="opt-group-head">
                      <th colSpan={6} style={{ 'text-align': 'center', color: 'var(--bull)', 'border-bottom': '1px solid var(--border-color)' }}>
                        {tt("ALIM OPSİYONLARI (CALLS)")}
                      </th>
                      <th style={{ 'text-align': 'center', background: 'var(--bg-elevated)', 'border-bottom': '1px solid var(--border-color)' }}>
                        {tt("VADE:")}{' '}{d().selectedExpiry}
                      </th>
                      <th colSpan={6} style={{ 'text-align': 'center', color: 'var(--bear)', 'border-bottom': '1px solid var(--border-color)' }}>
                        {tt("SATIM OPSİYONLARI (PUTS)")}
                      </th>
                    </tr>
                    <tr>
                      <th>OI</th>
                      <th>Δ Delta</th>
                      <th>IV%</th>
                      <th>Bid $</th>
                      <th>Mark $</th>
                      <th>{tt("İnşa")}</th>
                      <th style={{ 'text-align': 'center', background: 'var(--bg-elevated)' }}>STRIKE ($)</th>
                      <th>{tt("İnşa")}</th>
                      <th>Mark $</th>
                      <th>Bid $</th>
                      <th>IV%</th>
                      <th>Δ Delta</th>
                      <th>OI</th>
                    </tr>
                  </thead>
                  <tbody>
                    <For each={filteredRows()}>
                      {(row) => {
                        const isAtm = () => Math.abs(row.distancePct) < 2.2;
                        return (
                          <tr classList={{ 'opt-row-atm': isAtm() }} data-opt-strike={row.strike}>
                            {/* CALL SIDE */}
                            <td classList={{ 'opt-itm-call': !!row.call?.itm }}>{row.call ? row.call.openInterest.toFixed(0) : '—'}</td>
                            <td classList={{ 'opt-itm-call': !!row.call?.itm }}>{row.call ? row.call.delta.toFixed(2) : '—'}</td>
                            <td classList={{ 'opt-itm-call': !!row.call?.itm }} style={{ color: '#FF9800' }}>{row.call ? `${row.call.markIv.toFixed(1)}%` : '—'}</td>
                            <td classList={{ 'opt-itm-call': !!row.call?.itm }}>{row.call && row.call.bidUsd > 0 ? `$${row.call.bidUsd.toFixed(0)}` : '—'}</td>
                            <td classList={{ 'opt-itm-call': !!row.call?.itm }} style={{ 'font-weight': '700', color: 'var(--bull)' }}>
                              {row.call ? `$${row.call.markUsd.toFixed(0)}` : '—'}
                            </td>
                            <td classList={{ 'opt-itm-call': !!row.call?.itm }}>
                              <Show when={row.call}>
                                <div class="opt-act-btns">
                                  <button
                                    class="opt-mini-btn buy"
                                    title={tt("Stratejiye Call Al (+1) ekle")}
                                    data-add-leg={`C-BUY-${row.strike}`}
                                    onClick={() => addLegFromContract(row.call, 'BUY')}
                                  >
                                    +A
                                  </button>
                                  <button
                                    class="opt-mini-btn sell"
                                    title={tt("Stratejiye Call Sat (-1) ekle")}
                                    data-add-leg={`C-SELL-${row.strike}`}
                                    onClick={() => addLegFromContract(row.call, 'SELL')}
                                  >
                                    -S
                                  </button>
                                </div>
                              </Show>
                            </td>

                            {/* CENTER STRIKE */}
                            <td class="opt-strike-cell">
                              <b>{row.strike.toLocaleString('en-US')}</b>
                              <span class="opt-dist-sub">{row.distancePct >= 0 ? `+${row.distancePct.toFixed(1)}%` : `${row.distancePct.toFixed(1)}%`}</span>
                            </td>

                            {/* PUT SIDE */}
                            <td classList={{ 'opt-itm-put': !!row.put?.itm }}>
                              <Show when={row.put}>
                                <div class="opt-act-btns">
                                  <button
                                    class="opt-mini-btn buy"
                                    title={tt("Stratejiye Put Al (+1) ekle")}
                                    data-add-leg={`P-BUY-${row.strike}`}
                                    onClick={() => addLegFromContract(row.put, 'BUY')}
                                  >
                                    +A
                                  </button>
                                  <button
                                    class="opt-mini-btn sell"
                                    title={tt("Stratejiye Put Sat (-1) ekle")}
                                    data-add-leg={`P-SELL-${row.strike}`}
                                    onClick={() => addLegFromContract(row.put, 'SELL')}
                                  >
                                    -S
                                  </button>
                                </div>
                              </Show>
                            </td>
                            <td classList={{ 'opt-itm-put': !!row.put?.itm }} style={{ 'font-weight': '700', color: 'var(--bear)' }}>
                              {row.put ? `$${row.put.markUsd.toFixed(0)}` : '—'}
                            </td>
                            <td classList={{ 'opt-itm-put': !!row.put?.itm }}>{row.put && row.put.bidUsd > 0 ? `$${row.put.bidUsd.toFixed(0)}` : '—'}</td>
                            <td classList={{ 'opt-itm-put': !!row.put?.itm }} style={{ color: '#FF9800' }}>{row.put ? `${row.put.markIv.toFixed(1)}%` : '—'}</td>
                            <td classList={{ 'opt-itm-put': !!row.put?.itm }}>{row.put ? row.put.delta.toFixed(2) : '—'}</td>
                            <td classList={{ 'opt-itm-put': !!row.put?.itm }}>{row.put ? row.put.openInterest.toFixed(0) : '—'}</td>
                          </tr>
                        );
                      }}
                    </For>
                  </tbody>
                </table>
              </div>

              {/* RIGHT: Strategy Builder & Payoff Diagram */}
              <div class="opt-builder-pane" id="options-strategy-builder">
                <div class="term-title" style={{ display: 'flex', 'justify-content': 'space-between', 'align-items': 'center' }}>
                  <span>{tt("Strateji Kurucu & Vade Sonu K/Z")}</span>
                  <button id="btn-opt-clear-legs" class="chip-btn" onClick={() => setLegs([])}>{tt("Temizle")}</button>
                </div>

                <div class="opt-presets-wrap">
                  <For each={OPTION_STRATEGY_PRESETS}>
                    {(p) => (
                      <button
                        class="chip-btn"
                        classList={{ active: activePreset() === p.id }}
                        data-opt-preset={p.id}
                        title={p.desc}
                        onClick={() => applyStrategyPreset(p.id)}
                      >
                        {p.name}
                      </button>
                    )}
                  </For>
                </div>

                <div class="opt-legs-list" id="opt-legs-list">
                  <Show when={legs().length > 0} fallback={<div class="term-hint">{tt("Soldaki opsiyon zincirinden +A / -S tıklayın veya yukarıdan bir hazır strateji şablonu seçin.")}</div>}>
                    <For each={legs()}>
                      {(leg) => (
                        <div class="opt-leg-chip" data-leg-id={leg.id}>
                          <span class={`leg-side ${leg.side === 'BUY' ? 'buy' : 'sell'}`}>
                            {leg.side === 'BUY' ? tt("AL") : tt("SAT")}
                          </span>
                          <b>{leg.qty}× {leg.type === 'C' ? 'CALL' : 'PUT'} ${leg.strike.toLocaleString('en-US')}</b>
                          <span class="term-hint">@ ${leg.premiumUSD.toFixed(0)} (IV {leg.iv.toFixed(0)}%)</span>
                          <div style={{ 'margin-left': 'auto', display: 'flex', gap: '3px' }}>
                            <button class="opt-mini-btn" onClick={() => updateLegQty(leg.id, -1)}>−</button>
                            <button class="opt-mini-btn" onClick={() => updateLegQty(leg.id, 1)}>+</button>
                            <button class="opt-mini-btn" data-del-leg={leg.id} onClick={() => removeLeg(leg.id)}>✕</button>
                          </div>
                        </div>
                      )}
                    </For>
                  </Show>
                </div>

                <Show when={payoff() && payoff()!.points.length > 0}>
                  {(() => {
                    const pf = () => payoff()!;
                    return (
                      <>
                        <div class="opt-metrics-strip" id="opt-strategy-metrics">
                          <div>
                            <span class="term-hint">{tt("Net Prim:")}</span>{' '}
                            <b>{pf().netPremiumUSD >= 0 ? tfmt("Borç ${0}", pf().netPremiumUSD.toFixed(0)) : `Alacak $${Math.abs(pf().netPremiumUSD).toFixed(0)}`}</b>
                          </div>
                          <div>
                            <span class="term-hint">{tt("Maks. Kâr:")}</span>{' '}
                            <b style={{ color: 'var(--bull)' }}>
                              {pf().maxProfitUSD === 'UNLIMITED' ? tt("Sınırsız ∞") : `$${Number(pf().maxProfitUSD).toFixed(0)}`}
                            </b>
                          </div>
                          <div>
                            <span class="term-hint">{tt("Maks. Zarar:")}</span>{' '}
                            <b style={{ color: 'var(--bear)' }}>
                              {pf().maxLossUSD === 'UNLIMITED' ? tt("Sınırsız ∞") : `$${Number(pf().maxLossUSD).toFixed(0)}`}
                            </b>
                          </div>
                          <div>
                            <span class="term-hint">{tt("Başabaş:")}</span>{' '}
                            <b>{pf().breakevens.length ? pf().breakevens.map((b) => `$${b.toFixed(0)}`).join(' · ') : '—'}</b>
                          </div>
                          <div>
                            <span class="term-hint">Net Δ / Θ:</span>{' '}
                            <b>Δ {pf().netDelta.toFixed(2)} · Θ ${pf().netTheta.toFixed(1)}/g</b>
                          </div>
                        </div>

                        <PayoffSvg points={pf().points} spotPrice={d().spotPrice} breakevens={pf().breakevens} />
                      </>
                    );
                  })()}
                </Show>
              </div>
            </div>
          </Show>
        )}
      </Show>
    </div>
  );
}

function PayoffSvg(props: {
  points: Array<{ price: number; expiryPnl: number; currentPnl: number }>;
  spotPrice: number;
  breakevens: number[];
}): JSX.Element {
  const W = 440;
  const H = 175;
  const padL = 48;
  const padR = 14;
  const padT = 14;
  const padB = 24;

  const geom = createMemo(() => {
    const pts = props.points;
    if (pts.length < 2) return null;
    const minX = pts[0].price;
    const maxX = pts[pts.length - 1].price;
    const allY = pts.flatMap((p) => [p.expiryPnl, p.currentPnl, 0]);
    let minY = Math.min(...allY);
    let maxY = Math.max(...allY);
    if (maxY - minY < 10) {
      maxY += 50;
      minY -= 50;
    }
    const spanX = Math.max(1, maxX - minX);
    const spanY = Math.max(1, maxY - minY);
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;

    const xOf = (p: number) => padL + ((p - minX) / spanX) * plotW;
    const yOf = (v: number) => padT + (1 - (v - minY) / spanY) * plotH;

    const expPath = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${xOf(p.price).toFixed(1)},${yOf(p.expiryPnl).toFixed(1)}`).join(' ');
    const curPath = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${xOf(p.price).toFixed(1)},${yOf(p.currentPnl).toFixed(1)}`).join(' ');
    const zeroY = yOf(0);
    const spotX = xOf(props.spotPrice);

    return { minX, maxX, minY, maxY, expPath, curPath, zeroY, spotX, xOf, yOf };
  });

  return (
    <Show when={geom()}>
      {(g) => (
        <div class="opt-payoff-wrap">
          <svg id="options-payoff-svg" viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: '175px', background: 'var(--bg-elevated)', 'border-radius': '6px', border: '1px solid var(--border-color)' }}>
            {/* Zero P&L horizontal line */}
            <line x1={padL} y1={g().zeroY} x2={W - padR} y2={g().zeroY} stroke="rgba(255,255,255,0.25)" stroke-dasharray="3,3" />
            {/* Spot vertical line */}
            <line x1={g().spotX} y1={padT} x2={g().spotX} y2={H - padB} stroke="#0284C7" stroke-dasharray="4,3" />
            <text x={g().spotX + 4} y={padT + 10} fill="#0284C7" font-size="9.5" font-weight="700">
              Spot ${props.spotPrice.toFixed(0)}
            </text>

            {/* Mid-term Black-Scholes curve */}
            <path d={g().curPath} fill="none" stroke="#FF9800" stroke-width="1.5" stroke-dasharray="4,2" />
            {/* Expiration Payoff curve */}
            <path d={g().expPath} fill="none" stroke="#089981" stroke-width="2.2" />

            {/* Breakeven circles */}
            <For each={props.breakevens}>
              {(be) => <circle cx={g().xOf(be)} cy={g().zeroY} r="3.5" fill="#FFD54F" stroke="#000" stroke-width="1" />}
            </For>

            {/* Y Axis labels */}
            <text x={padL - 4} y={padT + 8} fill="#8C8C8C" font-size="9" text-anchor="end">
              +${Math.round(g().maxY)}
            </text>
            <text x={padL - 4} y={g().zeroY + 3} fill="#8C8C8C" font-size="9" text-anchor="end">
              $0
            </text>
            <text x={padL - 4} y={H - padB} fill="#8C8C8C" font-size="9" text-anchor="end">
              ${Math.round(g().minY)}
            </text>

            {/* X Axis labels */}
            <text x={padL} y={H - 6} fill="#8C8C8C" font-size="9">
              ${Math.round(g().minX)}
            </text>
            <text x={W - padR} y={H - 6} fill="#8C8C8C" font-size="9" text-anchor="end">
              ${Math.round(g().maxX)}
            </text>
          </svg>
          <div class="term-hint" style={{ display: 'flex', 'justify-content': 'space-between', 'margin-top': '3px', 'font-size': '10px' }}>
            <span><b style={{ color: '#089981' }}>━</b>{' '}{tt("Vade Sonu K/Z ·")}{' '}<b style={{ color: '#FF9800' }}>┅</b>{' '}{tt("Yarı Vade (Black-Scholes) ·")}{' '}<b style={{ color: '#FFD54F' }}>●</b>{' '}{tt("Başabaş")}</span>
            <span>{tt("Birim: USD / 1 Kontrat")}</span>
          </div>
        </div>
      )}
    </Show>
  );
}
