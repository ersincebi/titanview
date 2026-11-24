import { tfmt, tt } from '../state/i18n';
import { For, Show, createEffect, createMemo, createSignal, on, type JSX } from 'solid-js';
import { fetchFundamentals } from '../api/client';
import { switchSymbol, ui } from '../state/store';
import { symbolAvatarSpec } from '../state/symbolExpr';
import type { FinancialPeriodRow, FundamentalsReport } from '../types/market';

type FinSubTab = 'overview' | 'income' | 'balance' | 'cashflow';

const [finData, setFinData] = createSignal<{ loading: boolean; error: string | null; report: FundamentalsReport | null }>({
  loading: false,
  error: null,
  report: null,
});
let lastFinSym = '';

export async function loadFundamentals(symbol = ui.symbol, force = false): Promise<void> {
  const sym = symbol.trim().toUpperCase();
  if (!sym) return;
  if (!force && lastFinSym === sym && finData().report) return;
  lastFinSym = sym;
  setFinData({ loading: true, error: null, report: finData().report });
  try {
    if (typeof fetchFundamentals !== 'function') {
      setFinData({ loading: false, error: null, report: null });
      return;
    }
    const rep = await fetchFundamentals(sym);
    if (lastFinSym === sym) {
      setFinData({ loading: false, error: null, report: rep });
    }
  } catch (e) {
    if (lastFinSym === sym) {
      setFinData({ loading: false, error: e instanceof Error ? e.message : String(e), report: null });
    }
  }
}

export function fmtFinBig(val: number | null | undefined, currency = 'USD'): string {
  if (val == null || !Number.isFinite(val)) return '—';
  const sign = val < 0 ? '-' : '';
  const abs = Math.abs(val);
  const sym = currency === 'TRY' ? '₺' : currency === 'EUR' ? '€' : '$';
  if (abs >= 1e12) return `${sign}${sym}${(abs / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${sign}${sym}${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}${sym}${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}${sym}${(abs / 1e3).toFixed(1)}K`;
  return `${sign}${sym}${abs.toFixed(2)}`;
}

const fmtNum = (val: number | null | undefined, digits = 2, suffix = ''): string => {
  if (val == null || !Number.isFinite(val)) return '—';
  return `${val.toFixed(digits)}${suffix}`;
};

const INCOME_ROWS: Array<[keyof FinancialPeriodRow, string, boolean?]> = [
  ['totalRevenue', tt("Satış Gelirleri (Hasılat)")],
  ['grossProfit', tt("Brüt Kâr / Zarar")],
  ['operatingIncome', tt("Esas Faaliyet Kârı (EBIT)")],
  ['ebitda', tt("FAVÖK (EBITDA)")],
  ['pretaxIncome', tt("Vergi Öncesi Kâr / Zarar")],
  ['netIncome', tt("Net Dönem Kârı / Zararı")],
  ['dilutedEps', tt("Seyreltilmiş Hisse Başı Kazanç (HBK)"), true],
];

const BALANCE_ROWS: Array<[keyof FinancialPeriodRow, string]> = [
  ['totalAssets', tt("Toplam Varlıklar (Aktifler)")],
  ['currentAssets', tt("Dönen Varlıklar")],
  ['cashAndEquivalents', tt("Nakit ve Nakit Benzerleri")],
  ['nonCurrentAssets', tt("Duran Varlıklar")],
  ['totalLiabilities', tt("Toplam Yükümlülükler")],
  ['currentLiabilities', tt("Kısa Vadeli Yükümlülükler")],
  ['nonCurrentLiabilities', tt("Uzun Vadeli Yükümlülükler")],
  ['totalDebt', tt("Toplam Finansal Borç")],
  ['netDebt', tt("Net Finansal Borç")],
  ['stockholdersEquity', tt("Ana Ortaklık Özkaynakları")],
];

const CASHFLOW_ROWS: Array<[keyof FinancialPeriodRow, string]> = [
  ['operatingCashFlow', tt("İşletme Faaliyetlerinden Nakit Akışı")],
  ['capitalExpenditure', tt("Sabit Sermaye Yatırımları (CapEx)")],
  ['freeCashFlow', tt("Serbest Nakit Akışı (FCF)")],
  ['investingCashFlow', tt("Yatırım Faaliyetlerinden Nakit Akışı")],
  ['financingCashFlow', tt("Finansman Faaliyetlerinden Nakit Akışı")],
];

export function FundamentalsPanel(): JSX.Element {
  const [subTab, setSubTab] = createSignal<FinSubTab>('overview');
  const [periodMode, setPeriodMode] = createSignal<'annual' | 'quarterly'>('annual');

  createEffect(
    on(
      () => [ui.symbol, ui.wbTab] as const,
      ([sym, tab]) => {
        if (tab === 'financials') void loadFundamentals(sym);
      }
    )
  );

  const rep = () => finData().report;
  const rows = createMemo(() => {
    const r = rep();
    if (!r) return [];
    if (periodMode() === 'quarterly' && r.quarterly?.length) return r.quarterly;
    return r.annual ?? [];
  });

  const avatar = () => symbolAvatarSpec(ui.symbol, rep()?.market);

  return (
    <div id="wb-panel-financials" class="wb-panel wb-panel-single" classList={{ active: ui.wbTab === 'financials' }}>
      <div class="term-bar fin-toolbar">
        <div style={{ display: 'flex', 'align-items': 'center', gap: '8px' }}>
          <span class="sym-avatar" style={{ background: avatar().bg, color: avatar().fg }}>{avatar().initials}</span>
          <b>{ui.symbol}</b>
          <Show when={rep()?.supported && rep()?.source}>
            <span class="exchange-badge" id="lbl-fin-source">{tt("Kaynak:")}{' '}{rep()!.source} · {rep()!.currency}</span>
          </Show>
        </div>
        <div style={{ display: 'flex', gap: '4px' }}>
          {(
            [
              ['overview', tt("Genel Bakış & Oranlar")],
              ['income', 'Gelir Tablosu'],
              ['balance', tt("Bilanço")],
              ['cashflow', tt("Nakit Akışı")],
            ] as const
          ).map(([id, label]) => (
            <button
              class="chip-btn"
              classList={{ active: subTab() === id }}
              data-fin-tab={id}
              onClick={() => setSubTab(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: '4px', 'margin-left': 'auto' }}>
          <button
            id="btn-fin-annual"
            class="chip-btn"
            classList={{ active: periodMode() === 'annual' }}
            onClick={() => setPeriodMode('annual')}
          >
            {tt("Yıllık")}
          </button>
          <button
            id="btn-fin-quarterly"
            class="chip-btn"
            classList={{ active: periodMode() === 'quarterly' }}
            onClick={() => setPeriodMode('quarterly')}
          >
            {tt("Çeyreklik")}
          </button>
          <button id="btn-fin-refresh" class="chip-btn" onClick={() => void loadFundamentals(ui.symbol, true)}>
            {tt("↻ Yenile")}
          </button>
        </div>
      </div>

      <Show when={finData().loading && !rep()}>
        <div class="term-note">{tt("Finansal tablolar yükleniyor…")}</div>
      </Show>
      <Show when={finData().error}>
        <div class="term-note term-error" id="fin-error">{finData().error}</div>
      </Show>

      <Show when={rep()}>
        {(r) => (
          <Show
            when={r().supported}
            fallback={
              <div class="term-note" id="fin-unsupported" style={{ padding: '16px' }}>
                <div style={{ 'font-weight': '700', color: '#fff', 'margin-bottom': '6px' }}>
                  {r().symbol}{' '}{tt("için kurumsal finansal tablo bulunmuyor")}
                </div>
                <div style={{ 'margin-bottom': '10px' }}>{r().reason}</div>
                <div style={{ display: 'flex', gap: '6px', 'align-items': 'center', 'flex-wrap': 'wrap' }}>
                  <span class="term-hint">{tt("Gerçek KAP / Yahoo finansal tabloları için hisse seçin:")}</span>
                  {['THYAO.IS', 'ASELS.IS', 'TUPRS.IS', 'AAPL', 'NVDA', 'MSFT'].map((s) => (
                    <button class="chip-btn" data-fin-jump={s} onClick={() => void switchSymbol(s, ui.interval)}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            }
          >
            <div class="fin-body" style={{ 'overflow-y': 'auto', flex: '1', padding: '8px 12px' }}>
              <Show when={subTab() === 'overview'}>
                <div class="fin-overview-grid">
                  <div class="fin-card">
                    <div class="term-title">{tt("Değerleme Çarpanları")}</div>
                    <table class="bt-table" id="fin-ratios-valuation">
                      <tbody>
                        <tr><td>{tt("Piyasa Değeri")}</td><td><b>{fmtFinBig(r().ratios.marketCap, r().currency)}</b></td></tr>
                        <tr><td>{tt("Firma Değeri (EV)")}</td><td><b>{fmtFinBig(r().ratios.enterpriseValue, r().currency)}</b></td></tr>
                        <tr><td>{tt("F/K (Trailing P/E)")}</td><td><b>{fmtNum(r().ratios.trailingPe)}</b></td></tr>
                        <tr><td>{tt("İleri F/K (Forward P/E)")}</td><td><b>{fmtNum(r().ratios.forwardPe)}</b></td></tr>
                        <tr><td>PD/DD (P/B)</td><td><b>{fmtNum(r().ratios.priceToBook)}</b></td></tr>
                        <tr><td>{tt("FD/FAVÖK (EV/EBITDA)")}</td><td><b>{fmtNum(r().ratios.enterpriseToEbitda)}</b></td></tr>
                        <tr><td>{tt("Fiyat / Satış (P/S)")}</td><td><b>{fmtNum(r().ratios.priceToSales)}</b></td></tr>
                        <tr><td>{tt("Hisse Başı Kazanç (HBK)")}</td><td><b>{fmtNum(r().ratios.trailingEps)}</b></td></tr>
                        <tr><td>{tt("Temettü Verimi")}</td><td><b>{fmtNum(r().ratios.dividendYieldPct, 2, '%')}</b></td></tr>
                      </tbody>
                    </table>
                  </div>

                  <div class="fin-card">
                    <div class="term-title">{tt("Kârlılık & Bilanço Sağlığı")}</div>
                    <table class="bt-table" id="fin-ratios-health">
                      <tbody>
                        <tr><td>{tt("Brüt Kâr Marjı")}</td><td><b>{fmtNum(r().ratios.grossMarginPct, 2, '%')}</b></td></tr>
                        <tr><td>{tt("Faaliyet Kâr Marjı")}</td><td><b>{fmtNum(r().ratios.operatingMarginPct, 2, '%')}</b></td></tr>
                        <tr><td>{tt("Net Kâr Marjı")}</td><td><b>{fmtNum(r().ratios.profitMarginPct, 2, '%')}</b></td></tr>
                        <tr><td>{tt("Özkaynak Kârlılığı (ROE)")}</td><td><b>{fmtNum(r().ratios.roePct, 2, '%')}</b></td></tr>
                        <tr><td>{tt("Aktif Kârlılığı (ROA)")}</td><td><b>{fmtNum(r().ratios.roaPct, 2, '%')}</b></td></tr>
                        <tr><td>{tt("Cari Oran")}</td><td><b>{fmtNum(r().ratios.currentRatio)}</b></td></tr>
                        <tr><td>{tt("Asit-Test (Hızlı) Oran")}</td><td><b>{fmtNum(r().ratios.quickRatio)}</b></td></tr>
                        <tr><td>{tt("Finansal Borç / Özkaynak")}</td><td><b>{fmtNum(r().ratios.debtToEquity, 1, '%')}</b></td></tr>
                        <tr><td>Beta</td><td><b>{fmtNum(r().ratios.beta)}</b></td></tr>
                      </tbody>
                    </table>
                  </div>

                  <Show when={rows().length > 0}>
                    <div class="fin-card">
                      <div class="term-title">{tt("Dönemsel Hasılat & Net Kâr Trendi (")}{periodMode() === 'annual' ? tt("Yıllık") : tt("Çeyreklik")})</div>
                      <div class="fin-bars-chart" id="fin-trend-chart">
                        {(() => {
                          const list = [...rows()].reverse();
                          const maxVal = Math.max(
                            1,
                            ...list.flatMap((x) => [Math.abs(x.totalRevenue ?? 0), Math.abs(x.netIncome ?? 0)])
                          );
                          return (
                            <For each={list}>
                              {(item) => {
                                const revH = Math.max(4, Math.round((Math.abs(item.totalRevenue ?? 0) / maxVal) * 95));
                                const netH = Math.max(4, Math.round((Math.abs(item.netIncome ?? 0) / maxVal) * 95));
                                const netPos = (item.netIncome ?? 0) >= 0;
                                return (
                                  <div class="fin-bar-col" data-fin-period={item.period}>
                                    <div class="fin-bar-pair">
                                      <div
                                        class="fin-bar-item rev"
                                        style={{ height: `${revH}px` }}
                                        title={tfmt("Hasılat ({0}): {1}", item.period, fmtFinBig(item.totalRevenue, r().currency))}
                                      />
                                      <div
                                        class="fin-bar-item net"
                                        style={{ height: `${netH}px`, background: netPos ? 'var(--bull)' : 'var(--bear)' }}
                                        title={`Net Kâr (${item.period}): ${fmtFinBig(item.netIncome, r().currency)}`}
                                      />
                                    </div>
                                    <div class="fin-bar-lbl">{item.period}</div>
                                    <div class="fin-bar-sub">{fmtFinBig(item.totalRevenue, r().currency)}</div>
                                  </div>
                                );
                              }}
                            </For>
                          );
                        })()}
                      </div>
                      <div class="term-hint" style={{ 'margin-top': '6px' }}>
                        <span style={{ color: '#0284C7', 'font-weight': '700' }}>■</span>{' '}{tt("Satış Gelirleri ·")}{' '}
                        <span style={{ color: 'var(--bull)', 'font-weight': '700' }}>■</span>{' '}{tt("Net Dönem Kârı")}
                      </div>
                    </div>
                  </Show>
                </div>
              </Show>

              <Show when={subTab() === 'income'}>
                <StatementTable title={tt("Gelir Tablosu")} id="fin-table-income" rows={rows()} specs={INCOME_ROWS} currency={r().currency} />
              </Show>
              <Show when={subTab() === 'balance'}>
                <StatementTable title={tt("Bilanço")} id="fin-table-balance" rows={rows()} specs={BALANCE_ROWS} currency={r().currency} />
              </Show>
              <Show when={subTab() === 'cashflow'}>
                <StatementTable title={tt("Nakit Akış Tablosu")} id="fin-table-cashflow" rows={rows()} specs={CASHFLOW_ROWS} currency={r().currency} />
              </Show>
            </div>
          </Show>
        )}
      </Show>
    </div>
  );
}

function StatementTable(props: {
  title: string;
  id: string;
  rows: FinancialPeriodRow[];
  specs: Array<[keyof FinancialPeriodRow, string, boolean?]>;
  currency: string;
}): JSX.Element {
  return (
    <Show when={props.rows.length > 0} fallback={<div class="term-note">{tt("Bu dönem türü için yayınlanmış tablo verisi yok.")}</div>}>
      <table class="bt-table fin-stmt-table" id={props.id}>
        <thead>
          <tr>
            <th>{props.title} ({props.currency})</th>
            <For each={props.rows}>
              {(p) => (
                <th style={{ 'text-align': 'right' }}>
                  <div>{p.period}</div>
                  <div class="term-hint" style={{ 'font-size': '10px', 'font-weight': '400' }}>{p.date}</div>
                </th>
              )}
            </For>
          </tr>
        </thead>
        <tbody>
          <For each={props.specs}>
            {([key, label, isEps]) => (
              <tr data-fin-row={String(key)}>
                <td style={{ 'font-weight': '600' }}>{label}</td>
                <For each={props.rows}>
                  {(p) => {
                    const v = p[key] as number | null | undefined;
                    const txt = isEps ? fmtNum(v, 2) : fmtFinBig(v, props.currency);
                    const color = v == null ? 'var(--text-secondary)' : v < 0 ? 'var(--bear)' : '#fff';
                    return <td style={{ 'text-align': 'right', 'font-family': 'var(--font-mono)', color }}>{txt}</td>;
                  }}
                </For>
              </tr>
            )}
          </For>
        </tbody>
      </table>
    </Show>
  );
}
