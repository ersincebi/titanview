import { tt , localeTag } from '../state/i18n';
import { For, Show, createEffect, createMemo, createSignal, on, type JSX } from 'solid-js';
import { fetchCalendar } from '../api/client';
import { switchSymbol, ui } from '../state/store';
import { symbolAvatarSpec } from '../state/symbolExpr';
import type { CalendarResponse } from '../types/market';

type CalSubTab = 'economic' | 'earnings' | 'dividends' | 'ipo';

const [calState, setCalState] = createSignal<{ loading: boolean; error: string | null; data: CalendarResponse | null }>({
  loading: false,
  error: null,
  data: null,
});

export async function loadCalendar(country = 'ALL', market = 'ALL', force = false): Promise<void> {
  if (!force && calState().data) return;
  setCalState({ loading: true, error: null, data: calState().data });
  try {
    if (typeof fetchCalendar !== 'function') {
      setCalState({ loading: false, error: null, data: null });
      return;
    }
    const data = await fetchCalendar(country, market);
    setCalState({ loading: false, error: null, data });
  } catch (e) {
    setCalState({ loading: false, error: e instanceof Error ? e.message : String(e), data: null });
  }
}

const COUNTRY_FLAGS: Record<string, string> = {
  TR: tt("🇹🇷 Türkiye"),
  US: '🇺🇸 ABD',
  EU: tt("🇪🇺 Euro Bölgesi"),
};

const fmtDateTr = (ts: number): string => {
  try {
    return new Date(ts * 1000).toLocaleDateString(localeTag(), {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return String(ts);
  }
};

export function CalendarView(props: { compact?: boolean }): JSX.Element {
  const [subTab, setSubTab] = createSignal<CalSubTab>('economic');
  const [country, setCountry] = createSignal<'ALL' | 'TR' | 'US' | 'EU'>('ALL');
  const [onlyHigh, setOnlyHigh] = createSignal(false);
  const [eqMarket, setEqMarket] = createSignal<'ALL' | 'BIST' | 'US'>('ALL');

  createEffect(
    on(
      () => [ui.wbTab, ui.drawerTab] as const,
      ([wb, dr]) => {
        if (wb === 'calendar' || dr === 'calendar') void loadCalendar('ALL', 'ALL');
      }
    )
  );

  const econRows = createMemo(() => {
    const list = calState().data?.economic ?? [];
    const c = country();
    const hi = onlyHigh();
    return list.filter((e) => (c === 'ALL' || e.country === c) && (!hi || e.importance === 'HIGH'));
  });

  const earnRows = createMemo(() => {
    const list = calState().data?.earnings ?? [];
    const m = eqMarket();
    return list.filter((e) => m === 'ALL' || e.market === m);
  });

  const divRows = createMemo(() => {
    const list = calState().data?.dividends ?? [];
    const m = eqMarket();
    return list.filter((d) => m === 'ALL' || d.market === m);
  });

  return (
    <div class="cal-view" classList={{ 'cal-compact': !!props.compact }} style={{ display: 'flex', 'flex-direction': 'column', height: '100%' }}>
      <div class="term-bar" style={{ 'flex-wrap': 'wrap', gap: '6px' }}>
        {(
          [
            ['economic', tt("Ekonomik Takvim")],
            ['earnings', tt("Kazanç (Bilanço)")],
            ['dividends', tt("Temettü")],
            ['ipo', tt("Halka Arz (IPO)")],
          ] as const
        ).map(([id, label]) => (
          <button
            class="chip-btn"
            classList={{ active: subTab() === id }}
            data-cal-tab={id}
            onClick={() => setSubTab(id)}
          >
            {label}
          </button>
        ))}

        <Show when={subTab() === 'economic'}>
          <div style={{ display: 'flex', gap: '4px', 'margin-left': props.compact ? '0' : 'auto', 'flex-wrap': 'wrap' }}>
            {(
              [
                ['ALL', tt("Tümü")],
                ['TR', tt("🇹🇷 TCMB/TÜİK")],
                ['US', '🇺🇸 FED/BLS'],
                ['EU', '🇪🇺 ECB'],
              ] as const
            ).map(([c, label]) => (
              <button
                class="chip-btn"
                classList={{ active: country() === c }}
                data-cal-country={c}
                onClick={() => setCountry(c)}
              >
                {label}
              </button>
            ))}
            <button
              class="chip-btn"
              classList={{ active: onlyHigh() }}
              data-cal-high="1"
              onClick={() => setOnlyHigh(!onlyHigh())}
              title={tt("Yalnız Yüksek Önemli Veriler")}
            >
              {tt("●●● Yüksek")}
            </button>
          </div>
        </Show>

        <Show when={subTab() === 'earnings' || subTab() === 'dividends'}>
          <div style={{ display: 'flex', gap: '4px', 'margin-left': props.compact ? '0' : 'auto' }}>
            {(
              [
                ['ALL', tt("Tümü")],
                ['BIST', '🇹🇷 BIST'],
                ['US', '🇺🇸 ABD'],
              ] as const
            ).map(([m, label]) => (
              <button
                class="chip-btn"
                classList={{ active: eqMarket() === m }}
                data-cal-market={m}
                onClick={() => setEqMarket(m)}
              >
                {label}
              </button>
            ))}
          </div>
        </Show>

        <button class="chip-btn" data-cal-refresh="1" onClick={() => void loadCalendar('ALL', 'ALL', true)}>
          ↻
        </button>
      </div>

      <Show when={calState().loading && !calState().data}>
        <div class="term-note">{tt("Takvim verileri yükleniyor…")}</div>
      </Show>
      <Show when={calState().error}>
        <div class="term-note term-error">{calState().error}</div>
      </Show>

      <div style={{ 'overflow-y': 'auto', flex: '1', padding: props.compact ? '6px' : '8px 12px' }}>
        <Show when={subTab() === 'economic'}>
          <div class="term-hint" style={{ 'margin-bottom': '6px' }}>
            {tt("Resmi Merkez Bankası ve İstatistik Kurumu yayın takvimleri (TCMB, TÜİK, FED, BLS, BEA, ECB) · Saatler UTC+3 İstanbul")}
          </div>
          <table class="bt-table cal-econ-table" id={props.compact ? 'drawer-cal-econ-table' : 'cal-econ-table'}>
            <thead>
              <tr>
                <th>{tt("Tarih / Saat")}</th>
                <th>{tt("Ülke / Kurum")}</th>
                <th>{tt("Önem")}</th>
                <th>{tt("Ekonomik Veri / Toplantı")}</th>
                <Show when={!props.compact}><th>{tt("Kategori")}</th></Show>
                <th>{tt("Resmi Kaynak")}</th>
              </tr>
            </thead>
            <tbody>
              <For each={econRows()}>
                {(ev) => (
                  <tr data-econ-id={ev.id} data-econ-country={ev.country}>
                    <td style={{ 'font-family': 'var(--font-mono)', 'white-space': 'nowrap' }}>
                      <b>{ev.dateStr}</b> <span class="term-hint">{ev.timeStr}</span>
                    </td>
                    <td style={{ 'white-space': 'nowrap' }}>
                      <span>{COUNTRY_FLAGS[ev.country] ?? ev.country}</span>{' '}
                      <span class="exchange-badge">{ev.institution}</span>
                    </td>
                    <td>
                      <span
                        class={`imp-dots imp-${ev.importance.toLowerCase()}`}
                        title={ev.importance === 'HIGH' ? tt("Yüksek Önem") : tt("Orta Önem")}
                        style={{ color: ev.importance === 'HIGH' ? '#F23645' : '#FF9800', 'font-weight': '700' }}
                      >
                        {ev.importance === 'HIGH' ? '●●●' : '●●○'}
                      </span>
                    </td>
                    <td style={{ 'font-weight': '600', color: '#fff' }}>{ev.title}</td>
                    <Show when={!props.compact}>
                      <td><span class="term-hint">{tt(ev.category)}</span></td>
                    </Show>
                    <td>
                      <a href={ev.sourceUrl} target="_blank" rel="noopener noreferrer" class="cal-src-link">
                        {ev.institution} ↗
                      </a>
                    </td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </Show>

        <Show when={subTab() === 'earnings'}>
          <div class="term-hint" style={{ 'margin-bottom': '6px' }}>
            {tt("Kaynak: Yahoo Finance Kurumsal Bilanço / Kazanç Takvimi · Satıra tıklayarak hisse grafiğini açın")}
          </div>
          <Show when={earnRows().length > 0} fallback={<div class="term-note">{tt("Bu filtre için kayıtlı bilanço tarihi bulunamadı.")}</div>}>
            <table class="bt-table" id="cal-earnings-table">
              <thead>
                <tr>
                  <th>{tt("Sembol")}</th>
                  <th>{tt("Bilanço Tarihi")}</th>
                  <th>{tt("Durum")}</th>
                  <th style={{ 'text-align': 'right' }}>{tt("HBK Beklenti")}</th>
                  <th style={{ 'text-align': 'right' }}>{tt("HBK Gerçekleşen")}</th>
                  <th style={{ 'text-align': 'right' }}>{tt("Sürpriz %")}</th>
                </tr>
              </thead>
              <tbody>
                <For each={earnRows()}>
                  {(item) => {
                    const av = symbolAvatarSpec(item.symbol, item.market);
                    const curSym = item.currency === 'TRY' ? '₺' : '$';
                    return (
                      <tr
                        class="idea-row"
                        data-cal-earn-sym={item.symbol}
                        onClick={() => void switchSymbol(item.symbol, ui.interval)}
                      >
                        <td>
                          <div style={{ display: 'flex', 'align-items': 'center', gap: '8px' }}>
                            <span class="sym-avatar" style={{ background: av.bg, color: av.fg }}>{av.initials}</span>
                            <div>
                              <b>{item.symbol}</b>
                              <div class="term-hint" style={{ 'font-size': '10px' }}>{tt(item.displayName)}</div>
                            </div>
                          </div>
                        </td>
                        <td style={{ 'font-family': 'var(--font-mono)' }}>{fmtDateTr(item.time)}</td>
                        <td>
                          <span class="exchange-badge" style={{ color: item.status === 'UPCOMING' ? '#AB47BC' : 'var(--bull)' }}>
                            {item.status === 'UPCOMING' ? tt("Yaklaşan") : tt("Açıklandı")}
                          </span>
                        </td>
                        <td style={{ 'text-align': 'right', 'font-family': 'var(--font-mono)' }}>
                          {item.epsEstimate == null ? '—' : `${curSym}${item.epsEstimate.toFixed(2)}`}
                        </td>
                        <td style={{ 'text-align': 'right', 'font-family': 'var(--font-mono)', 'font-weight': '700' }}>
                          {item.epsActual == null ? '—' : `${curSym}${item.epsActual.toFixed(2)}`}
                        </td>
                        <td
                          style={{
                            'text-align': 'right',
                            'font-family': 'var(--font-mono)',
                            'font-weight': '700',
                            color: item.surprisePct == null ? 'var(--text-secondary)' : item.surprisePct >= 0 ? 'var(--bull)' : 'var(--bear)',
                          }}
                        >
                          {item.surprisePct == null ? '—' : `${item.surprisePct >= 0 ? '+' : ''}${item.surprisePct.toFixed(2)}%`}
                        </td>
                      </tr>
                    );
                  }}
                </For>
              </tbody>
            </table>
          </Show>
        </Show>

        <Show when={subTab() === 'dividends'}>
          <div class="term-hint" style={{ 'margin-bottom': '6px' }}>
            {tt("Kaynak: Yahoo Finance Nakit Temettü Takvimi · Satıra tıklayarak hisse grafiğini açın")}
          </div>
          <Show when={divRows().length > 0} fallback={<div class="term-note">{tt("Bu filtre için kayıtlı temettü ödemesi bulunamadı.")}</div>}>
            <table class="bt-table" id="cal-dividends-table">
              <thead>
                <tr>
                  <th>{tt("Sembol")}</th>
                  <th>{tt("Piyasa")}</th>
                  <th>{tt("Hak Kullanım (Ex-Div) Tarihi")}</th>
                  <th style={{ 'text-align': 'right' }}>{tt("Hisse Başı Brüt Tutar")}</th>
                </tr>
              </thead>
              <tbody>
                <For each={divRows()}>
                  {(item) => {
                    const av = symbolAvatarSpec(item.symbol, item.market);
                    const curSym = item.currency === 'TRY' ? '₺' : '$';
                    return (
                      <tr
                        class="idea-row"
                        data-cal-div-sym={item.symbol}
                        onClick={() => void switchSymbol(item.symbol, ui.interval)}
                      >
                        <td>
                          <div style={{ display: 'flex', 'align-items': 'center', gap: '8px' }}>
                            <span class="sym-avatar" style={{ background: av.bg, color: av.fg }}>{av.initials}</span>
                            <div>
                              <b>{item.symbol}</b>
                              <div class="term-hint" style={{ 'font-size': '10px' }}>{tt(item.displayName)}</div>
                            </div>
                          </div>
                        </td>
                        <td><span class={`market-pill market-${item.market}`}>{item.market}</span></td>
                        <td style={{ 'font-family': 'var(--font-mono)' }}>{fmtDateTr(item.exTime)}</td>
                        <td style={{ 'text-align': 'right', 'font-family': 'var(--font-mono)', 'font-weight': '700', color: '#0284C7' }}>
                          {curSym}{item.amount.toFixed(4).replace(/0+$/, '').replace(/\.$/, '')} ({item.currency})
                        </td>
                      </tr>
                    );
                  }}
                </For>
              </tbody>
            </table>
          </Show>
        </Show>

        <Show when={subTab() === 'ipo'}>
          <div class="term-note" id="cal-ipo-note" style={{ 'margin-bottom': '10px' }}>
            {calState().data?.ipoNote ?? tt("Halka arz (IPO) duyuruları için resmi düzenleyici kurum kaynakları aşağıda listelenmiştir.")}
          </div>
          <div class="ipo-sources-grid" id="cal-ipo-sources">
            <For each={calState().data?.ipoSources ?? []}>
              {(src) => (
                <div class="fin-card ipo-source-card" data-ipo-inst={src.institution}>
                  <div style={{ display: 'flex', 'justify-content': 'space-between', 'align-items': 'center', 'margin-bottom': '6px' }}>
                    <span class={`market-pill market-${src.market}`}>{src.market}</span>
                    <span class="exchange-badge">{src.institution}</span>
                  </div>
                  <div style={{ 'font-weight': '700', color: '#fff', 'margin-bottom': '4px' }}>{src.title}</div>
                  <div class="term-hint" style={{ 'margin-bottom': '8px' }}>{src.description}</div>
                  <a href={src.url} target="_blank" rel="noopener noreferrer" class="cal-src-link">
                    {tt("Resmi Duyuru Sayfasını Aç (")}{src.institution}) ↗
                  </a>
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>
    </div>
  );
}

export function CalendarPanel(): JSX.Element {
  return (
    <div id="wb-panel-calendar" class="wb-panel wb-panel-single" classList={{ active: ui.wbTab === 'calendar' }}>
      <CalendarView />
    </div>
  );
}
