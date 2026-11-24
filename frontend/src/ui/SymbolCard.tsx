import { lang, tt, localeTag } from '../state/i18n';
import { For, Show, createEffect, createMemo, createSignal, type JSX } from 'solid-js';
import type { SecurityResponse } from '../api/client';
import { fetchSymbolCardFundamentals, fetchSymbolCardSecurity } from '../api/phase27';
import { formatQuotePrice, formatSigned, formatVolumeShort } from '../state/format';
import { candles, feedHealth, lastCandle, meta, openDrawerTab, quotes, ui } from '../state/store';
import { FLAG_COLORS, FLAG_COLOR_MAP } from '../state/watchlist';
import { setSymbolFlag, symbolFlags } from '../state/watchlistStore';
import type { FundamentalsReport } from '../types/market';

function formatCompactMoney(val: number | null | undefined, cur = ''): string {
  if (val == null || !Number.isFinite(val)) return '—';
  const abs = Math.abs(val);
  const sign = val < 0 ? '-' : '';
  const sym = cur === 'TRY' ? '₺' : cur === 'USD' || cur === 'USDT' ? '$' : cur === 'EUR' ? '€' : '';
  if (abs >= 1e12) return `${sign}${sym}${(abs / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${sign}${sym}${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}${sym}${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}${sym}${(abs / 1e3).toFixed(1)}K`;
  return `${sign}${sym}${abs.toFixed(2)}`;
}

function formatDateTR(tsSec: number | null | undefined): string {
  if (!tsSec || tsSec <= 0) return '—';
  return new Date(tsSec * 1000).toLocaleDateString(localeTag(), {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

/** Standart sağ panel gelişmiş "Sembol Detay Kartı": fiyat, uzatılmış saat, 1H/1A/3A/YBB/1Y performans, anahtar istatistikler ve bilanço tarihi. */
export function SymbolCard(): JSX.Element {
  const activeSym = () => (meta()?.symbol ?? ui.symbol).toUpperCase();
  const q = () => quotes()[activeSym()];
  const last = () => q()?.last ?? lastCandle()?.close ?? null;
  const chg = () => q()?.change ?? null;
  const pct = () => q()?.changePct ?? null;
  const tone = () => (pct() == null ? '' : pct()! >= 0 ? 'val-up' : 'val-down');

  const [secData, setSecData] = createSignal<SecurityResponse | null>(null);
  const [fundData, setFundData] = createSignal<FundamentalsReport | null>(null);
  const [flagMenuOpen, setFlagMenuOpen] = createSignal(false);

  createEffect(() => {
    const sym = activeSym();
    let cancelled = false;
    setSecData(null);
    setFundData(null);

    void fetchSymbolCardSecurity(sym)
      .then((res) => {
        if (!cancelled && res && res.stats) setSecData(res);
      })
      .catch(() => {
        // fallback to local candle computation
      });

    const isEquity = sym.endsWith('.IS') || (!sym.endsWith('USDT') && !sym.endsWith('=X') && !sym.endsWith('=F') && !sym.endsWith('.NYB'));
    if (isEquity && sym !== 'XU100.IS') {
      void fetchSymbolCardFundamentals(sym)
        .then((rep) => {
          if (!cancelled && rep && rep.supported) setFundData(rep);
        })
        .catch(() => {
          // ignore
        });
    }

    return () => {
      cancelled = true;
    };
  });

  const status = () => {
    const s = feedHealth().state;
    return s === 'closed' ? tt("Piyasa kapalı") : s === 'live' ? tt("Piyasa açık · canlı") : s === 'delayed' ? tt("Piyasa açık") : tt("Bağlantı bekleniyor");
  };

  /** Son 30 barın ortalama hacmine göre son bar hacmi (gerçek mumlardan). */
  const vol = createMemo(() => {
    const list = candles();
    if (list.length === 0) return null;
    const cur = list[list.length - 1].volume;
    const win = list.slice(-31, -1);
    const avg = win.length ? win.reduce((a, c) => a + c.volume, 0) / win.length : 0;
    return { cur, avg, ratio: avg > 0 ? Math.min(1, cur / (cur + avg)) : 0.5 };
  });

  /** Yerel mum yedekli performans ve 52H aralık hesaplaması. */
  const perfTiles = createMemo(() => {
    const st = secData()?.stats;
    const list = candles();
    const pctBackLocal = (bars: number): number | null => {
      if (list.length <= bars) return null;
      const base = list[list.length - 1 - bars]?.close;
      const cur = list[list.length - 1]?.close;
      if (!base || base <= 0 || !cur) return null;
      return ((cur - base) / base) * 100;
    };
    // Standart EN: 1W / 1M / 3M / YTD / 1Y / 52W High (kısa TR etiketler sözlükte belirsiz: 1H = 1 saat)
    const en = lang() === 'en';
    return [
      { key: '1H', label: en ? '1W' : '1H', val: st?.change1w ?? pctBackLocal(5) },
      { key: '1A', label: en ? '1M' : '1A', val: st?.change1m ?? pctBackLocal(21) },
      { key: '3A', label: en ? '3M' : '3A', val: st?.change3m ?? pctBackLocal(63) },
      { key: 'YBB', label: en ? 'YTD' : 'YBB', val: st?.changeYtd ?? pctBackLocal(Math.min(120, Math.max(1, list.length - 1))) },
      { key: '1Y', label: '1Y', val: st?.change1y ?? pctBackLocal(Math.min(252, Math.max(1, list.length - 1))) },
      { key: '52H', label: en ? '52W High' : tt("52H Zirve"), val: st?.fromHighPct ?? null },
    ];
  });

  const range52w = createMemo(() => {
    const st = secData()?.stats;
    if (st && st.high52w > 0 && st.low52w > 0 && st.high52w >= st.low52w) {
      const cur = last() ?? st.last;
      const pos = st.high52w > st.low52w ? Math.max(0, Math.min(100, ((cur - st.low52w) / (st.high52w - st.low52w)) * 100)) : 50;
      return { low: st.low52w, high: st.high52w, pos };
    }
    const list = candles();
    if (list.length < 2) return null;
    let hi = list[0].high;
    let lo = list[0].low;
    for (const c of list) {
      if (c.high > hi) hi = c.high;
      if (c.low < lo) lo = c.low;
    }
    const cur = last() ?? list[list.length - 1].close;
    const pos = hi > lo ? Math.max(0, Math.min(100, ((cur - lo) / (hi - lo)) * 100)) : 50;
    return { low: lo, high: hi, pos };
  });

  const earningsInfo = createMemo(() => {
    const fd = fundData();
    if (!fd || !fd.supported) return null;
    const nextTs = fd.nextEarningsTime;
    const list = fd.earnings ?? [];
    const latest = list.length > 0 ? list[list.length - 1] : null;
    if (!nextTs && !latest) return null;
    return {
      dateStr: formatDateTR(nextTs || latest?.time),
      isUpcoming: Boolean(nextTs && nextTs * 1000 > Date.now()),
      actual: latest?.actual ?? null,
      estimate: latest?.estimate ?? null,
      exDivStr: fd.exDividendTime ? formatDateTR(fd.exDividendTime) : null,
    };
  });

  const curFlag = () => symbolFlags()[activeSym()];
  const initials = () => activeSym().replace(/\.IS$|USDT$|=X$|=F$/, '').slice(0, 2);
  const currency = () => meta()?.currency ?? fundData()?.currency ?? '';

  return (
    <section class="sym-card" id="sym-card">
      <div class="sym-card-head">
        <span class={`sym-logo market-bg-${meta()?.market ?? 'BIST'}`}>{initials()}</span>
        <span class="sym-card-code">{activeSym().replace(/\.IS$/, '')}</span>
        <span class="sym-card-ex-badge">{meta()?.provider === 'BINANCE' ? 'BINANCE' : meta()?.market ?? ''}</span>
        <span style={{ flex: '1' }} />
        <button
          id="btn-symcard-flag"
          class="sym-card-act-btn"
          title={tt("Renkli Bayrak Ata (7 Renk)")}
          style={{ color: curFlag() ? FLAG_COLOR_MAP[curFlag()!]?.hex : 'var(--text-secondary)' }}
          onClick={() => setFlagMenuOpen(!flagMenuOpen())}
        >
          ⚑
        </button>
        <button
          id="btn-symcard-note"
          class="sym-card-act-btn"
          title={tt("Bu Sembol İçin Not / Günlük Aç")}
          onClick={() => openDrawerTab('notes')}
        >
          📝
        </button>
      </div>

      <Show when={flagMenuOpen()}>
        <div class="sym-flag-picker" id="sym-card-flag-picker">
          <For each={FLAG_COLORS}>
            {(fc) => (
              <button
                class="sym-flag-dot"
                classList={{ active: curFlag() === fc.id }}
                data-flag-pick={fc.id}
                title={fc.label}
                style={{ background: fc.hex }}
                onClick={() => {
                  void setSymbolFlag(activeSym(), curFlag() === fc.id ? '' : fc.id);
                  setFlagMenuOpen(false);
                }}
              />
            )}
          </For>
          <Show when={curFlag()}>
            <button
              class="sym-flag-clear"
              onClick={() => {
                void setSymbolFlag(activeSym(), '');
                setFlagMenuOpen(false);
              }}
            >
              ✕
            </button>
          </Show>
        </div>
      </Show>

      <div class="sym-card-name">
        {meta()?.displayName ?? ''} <span class="sym-card-ex">· {meta()?.provider === 'BINANCE' ? 'BINANCE' : meta()?.market ?? ''}</span>
      </div>

      <div class="sym-card-price">
        <span class="sym-card-last" id="sym-card-last">{last() == null ? '—' : formatQuotePrice(last()!)}</span>
        <span class="sym-card-cur">{currency()}</span>
        <Show when={chg() != null}>
          <span class={`sym-card-chg ${tone()}`}>
            {formatSigned(chg()!, Math.abs(chg()!) >= 100 ? 1 : 2, '')} {formatSigned(pct()!, 2, '%')}
          </span>
        </Show>
      </div>

      <Show when={q()?.extChangePct != null || q()?.extPrice != null}>
        <div class="sym-card-ext" id="sym-card-ext">
          <span class="sym-ext-tag">{q()?.extSession === 'pre' ? tt("☀ Seans Öncesi") : tt("☾ Seans Sonrası")}</span>
          <Show when={q()?.extPrice != null}>
            <strong>{formatQuotePrice(q()!.extPrice!)}</strong>
          </Show>
          <Show when={q()?.extChangePct != null}>
            <span class={q()!.extChangePct! >= 0 ? 'val-up' : 'val-down'}>
              {formatSigned(q()!.extChangePct!, 2, '%')}
            </span>
          </Show>
        </div>
      </Show>

      <div class="sym-card-status"><span class={`sym-dot sym-dot-${feedHealth().state}`} />{status()}</div>

      {/* 1H / 1A / 3A / YBB / 1Y / 52H Performans Kutucukları */}
      <div class="sym-perf-grid" id="sym-card-perf">
        <For each={perfTiles()}>
          {(t) => {
            const cls = () => (t.val == null ? 'neutral' : t.val >= 0 ? 'bull' : 'bear');
            return (
              <div class={`sym-perf-tile ${cls()}`} data-perf-tile={t.key}>
                <span class="sym-perf-lbl">{t.label}</span>
                <strong class="sym-perf-val">{t.val == null ? '—' : formatSigned(t.val, 2, '%')}</strong>
              </div>
            );
          }}
        </For>
      </div>

      {/* 52 Haftalık Aralık Çubuğu */}
      <Show when={range52w()}>
        {(r) => (
          <div class="sym-card-vol" id="sym-card-52w">
            <div class="sym-card-vol-lbl"><span>{tt("52H Düşük:")}{' '}{formatQuotePrice(r().low)}</span><span>{tt("52H Yüksek:")}{' '}{formatQuotePrice(r().high)}</span></div>
            <div class="sym-card-range-bar">
              <div class="sym-card-range-fill" style={{ width: `${r().pos.toFixed(1)}%` }} />
              <span class="sym-card-range-thumb" style={{ left: `${r().pos.toFixed(1)}%` }} />
            </div>
          </div>
        )}
      </Show>

      {/* Hacim Çubuğu */}
      <Show when={vol()}>
        {(v) => (
          <div class="sym-card-vol">
            <div class="sym-card-vol-lbl"><span>{tt("Hacim (son bar)")}</span><span>{tt("Ort. hacim (30 bar)")}</span></div>
            <div class="sym-card-vol-lbl sym-card-vol-val"><span>{formatVolumeShort(v().cur)}</span><span>{formatVolumeShort(v().avg)}</span></div>
            <div class="sym-card-vol-bar"><i style={{ width: `${(v().ratio * 100).toFixed(1)}%` }} /></div>
          </div>
        )}
      </Show>

      {/* Anahtar İstatistikler & Bilanço Tarihi */}
      <div class="sym-key-stats" id="sym-card-stats">
        <div class="sym-key-stats-title">{tt("Anahtar İstatistikler")}</div>
        <div class="sym-key-stats-grid">
          <div class="sym-stat-row">
            <span>{tt("Piyasa Değeri")}</span>
            <strong>{formatCompactMoney(fundData()?.ratios?.marketCap, currency())}</strong>
          </div>
          <div class="sym-stat-row">
            <span>F/K (P/E)</span>
            <strong>{fundData()?.ratios?.trailingPe != null ? `${fundData()!.ratios.trailingPe!.toFixed(2)}x` : '—'}</strong>
          </div>
          <div class="sym-stat-row">
            <span>PD/DD (P/B)</span>
            <strong>{fundData()?.ratios?.priceToBook != null ? `${fundData()!.ratios.priceToBook!.toFixed(2)}x` : '—'}</strong>
          </div>
          <div class="sym-stat-row">
            <span>{tt("HBK (EPS)")}</span>
            <strong>{fundData()?.ratios?.trailingEps != null ? fundData()!.ratios.trailingEps!.toFixed(2) : '—'}</strong>
          </div>
          <div class="sym-stat-row">
            <span>{tt("Temettü Verimi")}</span>
            <strong>{fundData()?.ratios?.dividendYieldPct != null ? `%${fundData()!.ratios.dividendYieldPct!.toFixed(2)}` : '—'}</strong>
          </div>
          <div class="sym-stat-row">
            <span>Beta</span>
            <strong>{secData()?.beta != null ? secData()!.beta!.toFixed(2) : fundData()?.ratios?.beta != null ? fundData()!.ratios.beta!.toFixed(2) : '—'}</strong>
          </div>
          <div class="sym-stat-row">
            <span>{tt("Yıllık Volatilite")}</span>
            <strong>{secData()?.stats?.volAnnualPct != null ? `%${secData()!.stats.volAnnualPct!.toFixed(1)}` : '—'}</strong>
          </div>
          <div class="sym-stat-row">
            <span>ATR (14) %</span>
            <strong>{secData()?.stats?.atr14Pct != null ? `%${secData()!.stats.atr14Pct!.toFixed(2)}` : '—'}</strong>
          </div>
        </div>

        <Show when={earningsInfo()}>
          {(ei) => (
            <div class="sym-earnings-box" id="sym-card-earnings">
              <div class="sym-stat-row">
                <span>{ei().isUpcoming ? tt("📅 Sonraki Bilanço") : tt("📊 Son Bilanço Tarihi")}</span>
                <strong style={{ color: 'var(--accent)' }}>{ei().dateStr}</strong>
              </div>
              <Show when={ei().actual != null || ei().estimate != null}>
                <div class="sym-stat-row">
                  <span>{tt("HBK (Gerçek / Tahmin)")}</span>
                  <strong>
                    {ei().actual != null ? ei().actual!.toFixed(2) : '—'} / {ei().estimate != null ? ei().estimate!.toFixed(2) : '—'}
                  </strong>
                </div>
              </Show>
              <Show when={ei().exDivStr}>
                <div class="sym-stat-row">
                  <span>{tt("Temettü Tarihi")}</span>
                  <strong>{ei().exDivStr}</strong>
                </div>
              </Show>
            </div>
          )}
        </Show>
      </div>
    </section>
  );
}
