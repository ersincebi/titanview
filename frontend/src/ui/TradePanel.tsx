import { tt , localeTag } from '../state/i18n';
/**
 * Faz 28 — emir bileti (sağ çekmece) + paper hesap paneli (alt çalışma alanı) + Binance onay penceresi.
 */
import { For, Show, createEffect, createSignal, on, onCleanup, type JSX } from 'solid-js';
import { lastCandle, switchSymbol, ui } from '../state/store';
import {
  SIDE_LABEL,
  TYPE_LABEL,
  ROLE_LABEL,
  bracketFromPct,
  entryPrice,
  fmtMoney,
  priceDecimals,
  roundPrice,
  ticketRisk,
  type OrderType,
  type PaperOrder,
} from '../state/trading';
import {
  binanceBalances,
  binanceNote,
  binanceOrders,
  binancePreview,
  binanceStatus,
  broker,
  cancelBinance,
  cancelOrder,
  closePosition,
  confirmBinance,
  dismissBinancePreview,
  paperView,
  refreshBinance,
  removeBinance,
  resetAccount,
  reversePosition,
  saveBinance,
  setBrackets,
  setBroker,
  setTicket,
  submitTicket,
  syncTicketPrices,
  ticket,
  ticketErrors,
  tradingBusy,
  tradingError,
} from '../state/tradingStore';
import '../styles/trading.css';

const TYPES: OrderType[] = ['market', 'limit', 'stop', 'stop_limit'];

function fmtP(p: number | undefined): string {
  if (!p) return '—';
  return p.toLocaleString('en-US', { minimumFractionDigits: Math.min(priceDecimals(p), 2), maximumFractionDigits: priceDecimals(p) });
}

const pnlClass = (v: number) => (v > 0 ? 'pos' : v < 0 ? 'neg' : '');

function num(e: Event & { currentTarget: HTMLInputElement }): number {
  const v = Number(e.currentTarget.value);
  return Number.isFinite(v) ? v : 0;
}

function orderPrice(o: PaperOrder): string {
  if (o.type === 'market') return tt("Piyasa");
  if (o.type === 'limit') return fmtP(o.limitPrice);
  if (o.type === 'stop') return fmtP(o.stopPrice);
  return `${fmtP(o.stopPrice)} → ${fmtP(o.limitPrice)}${o.triggered ? ' (tetiklendi)' : ''}`;
}

function BinanceKeys(): JSX.Element {
  const [key, setKey] = createSignal('');
  const [secret, setSecret] = createSignal('');
  const [testnet, setTestnet] = createSignal(true);
  return (
    <div class="tk-box" id="binance-keys">
      <Show
        when={binanceStatus()?.configured}
        fallback={
          <>
            <div class="tk-note">
              {tt("Anahtar sunucuda AES-256-GCM ile şifreli saklanır; gizli anahtar tarayıcıya geri dönmez. Yalnız")}{' '}<b>Spot &amp; Margin Trading</b>{' '}{tt("izni verin,")}
              <b>{' '}{tt("çekim iznini kapalı")}</b>{' '}{tt("tutun. Önce testnet ile deneyin.")}
            </div>
            <input id="inp-bn-key" class="wl-search-input" placeholder="API Key" autocomplete="off" value={key()} onInput={(e) => setKey(e.currentTarget.value)} />
            <input id="inp-bn-secret" class="wl-search-input" type="password" placeholder="Secret Key" autocomplete="new-password" value={secret()} onInput={(e) => setSecret(e.currentTarget.value)} />
            <label class="tk-check"><input id="chk-bn-testnet" type="checkbox" checked={testnet()} onChange={(e) => setTestnet(e.currentTarget.checked)} /> Testnet (testnet.binance.vision)</label>
            <button
              id="btn-bn-save"
              class="btn-primary"
              onClick={async () => {
                if (await saveBinance(key(), secret(), testnet())) {
                  setKey('');
                  setSecret('');
                }
              }}
            >
              {tt("Anahtarı kaydet")}
            </button>
          </>
        }
      >
        <div class="tk-row">
          <span>
            <b class={binanceStatus()!.testnet ? 'tk-env-test' : 'tk-env-live'}>{binanceStatus()!.testnet ? 'TESTNET' : 'CANLI'}</b> · {binanceStatus()!.keyHint}
          </span>
          <span style={{ display: 'flex', gap: '4px' }}>
            <button class="btn-secondary" id="btn-bn-refresh" onClick={() => void refreshBinance()}>↻</button>
            <button class="btn-secondary" id="btn-bn-delete" onClick={() => void removeBinance()}>{tt("Anahtarı sil")}</button>
          </span>
        </div>
        <Show when={binanceBalances().length > 0}>
          <table class="bt-table tk-mini" id="bn-balances">
            <thead><tr><th>{tt("Varlık")}</th><th>{tt("Serbest")}</th><th>{tt("Kilitli")}</th></tr></thead>
            <tbody>
              <For each={binanceBalances()}>{(b) => <tr><td>{b.asset}</td><td>{b.free}</td><td>{b.locked}</td></tr>}</For>
            </tbody>
          </table>
        </Show>
        <Show when={binanceOrders().length > 0}>
          <div class="tk-sub">{tt("Açık Binance emirleri")}</div>
          <table class="bt-table tk-mini" id="bn-orders">
            <tbody>
              <For each={binanceOrders()}>
                {(o) => (
                  <tr>
                    <td>{String(o.symbol)}</td>
                    <td>{String(o.side)} {String(o.type)}</td>
                    <td>{String(o.origQty)} @ {String(o.price)}</td>
                    <td><button class="btn-secondary" onClick={() => void cancelBinance(String(o.symbol), Number(o.orderId))}>✕</button></td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </Show>
      </Show>
      <Show when={binanceNote()}>
        <div class="tk-note" id="bn-note">{binanceNote()}</div>
      </Show>
    </div>
  );
}

/** Gerçek emir onay penceresi (sunucuda saklanan önizlenmiş emri gönderir). */
export function BinanceConfirm(): JSX.Element {
  const [left, setLeft] = createSignal(0);
  createEffect(
    on(binancePreview, (p) => {
      if (!p) return;
      const tick = () => setLeft(Math.max(0, p.expiresAt - Math.floor(Date.now() / 1000)));
      tick();
      const t = setInterval(tick, 1000);
      onCleanup(() => clearInterval(t));
    })
  );
  return (
    <Show when={binancePreview()}>
      {(p) => (
        <div class="tk-modal-backdrop" id="binance-confirm">
          <div class="tk-modal" role="dialog" aria-modal="true">
            <div class="tk-modal-title">
              {tt("Gerçek emir onayı")}{' '}<b class={p().testnet ? 'tk-env-test' : 'tk-env-live'}>{p().testnet ? 'TESTNET' : tt("CANLI HESAP")}</b>
            </div>
            <div class="tk-modal-body">
              <div class="tk-sum">{p().summary}</div>
              <div>{tt("Tahmini tutar:")}{' '}<b>{p().notional > 0 ? p().notional.toFixed(2) : '—'}</b></div>
              <code class="tk-params">{p().params}</code>
              <Show when={!p().testnet}>
                <div class="tk-warn">{tt("Bu emir gerçek parayla Binance'e gönderilecek ve geri alınamaz (yalnız açık emir iptal edilebilir).")}</div>
              </Show>
              <div class="tk-note">{tt("Onay süresi:")}{' '}{left()} sn</div>
            </div>
            <div class="tk-modal-actions">
              <button class="btn-secondary" id="btn-bn-cancel" onClick={dismissBinancePreview}>{tt("Vazgeç")}</button>
              <button class="btn-primary" id="btn-bn-confirm" disabled={tradingBusy() || left() <= 0} onClick={() => void confirmBinance()}>
                {tt("Onayla ve gönder")}
              </button>
            </div>
          </div>
        </div>
      )}
    </Show>
  );
}

/** Sağ çekmece: emir bileti. */
export function OrderTicket(): JSX.Element {
  const last = () => lastCandle()?.close ?? 0;
  const [tpPct, setTpPct] = createSignal(2);
  const [slPct, setSlPct] = createSignal(1);
  // sembol değişince bilet fiyatlarını yeni sembolün son fiyatına çek
  createEffect(on(() => ui.symbol, () => queueMicrotask(syncTicketPrices)));
  createEffect(on(broker, (b) => b === 'binance' && void refreshBinance(), { defer: true }));
  const risk = () => ticketRisk(ticket, last());
  const errs = () => ticketErrors();
  const applyPct = () => {
    const e = entryPrice(ticket, last());
    if (!(e > 0)) return;
    const b = bracketFromPct(ticket.side, e, tpPct(), slPct());
    setTicket({ takeProfit: b.takeProfit, stopLoss: b.stopLoss });
  };
  return (
    <div id="drawer-panel-orderpanel" class="drawer-subpanel tk-panel">
      <div class="tk-brokers">
        <button id="btn-broker-paper" classList={{ active: broker() === 'paper' }} onClick={() => setBroker('paper')}>Paper Trading</button>
        <button id="btn-broker-binance" classList={{ active: broker() === 'binance' }} onClick={() => setBroker('binance')}>{tt("Binance (gerçek)")}</button>
      </div>
      <Show when={broker() === 'binance'}>
        <BinanceKeys />
      </Show>
      <div class="tk-symbol">
        <b>{ui.symbol}</b>
        <span>{tt("Son:")}{' '}{fmtP(last())}</span>
      </div>
      <Show when={broker() === 'binance' && ui.symbol.includes('.')}>
        <div class="tk-warn">{tt("BIST aracı kurumlarının açık API'si yok; gerçek emir yalnız Binance spot sembollerinde.")}</div>
      </Show>
      <div class="tk-sides">
        <button id="btn-ticket-buy" class="tk-buy" classList={{ active: ticket.side === 'buy' }} onClick={() => setTicket('side', 'buy')}>
          {tt("AL")}{' '}<small>{fmtP(last())}</small>
        </button>
        <button id="btn-ticket-sell" class="tk-sell" classList={{ active: ticket.side === 'sell' }} onClick={() => setTicket('side', 'sell')}>
          {tt("SAT")}{' '}<small>{fmtP(last())}</small>
        </button>
      </div>
      <div class="tk-types">
        <For each={TYPES}>
          {(t) => (
            <button data-otype={t} classList={{ active: ticket.type === t }} onClick={() => setTicket('type', t)}>
              {TYPE_LABEL[t]}
            </button>
          )}
        </For>
      </div>
      <label class="tk-field">
        <span>{tt("Adet")}</span>
        <input id="inp-ticket-qty" type="number" min="0" step="any" value={ticket.qty} onInput={(e) => setTicket('qty', num(e))} />
      </label>
      <Show when={ticket.type === 'stop' || ticket.type === 'stop_limit'}>
        <label class="tk-field">
          <span>{tt("Stop fiyatı")}</span>
          <input id="inp-ticket-stop" type="number" step="any" value={ticket.stopPrice} onInput={(e) => setTicket('stopPrice', num(e))} />
        </label>
      </Show>
      <Show when={ticket.type === 'limit' || ticket.type === 'stop_limit'}>
        <label class="tk-field">
          <span>{tt("Limit fiyatı")}</span>
          <input id="inp-ticket-limit" type="number" step="any" value={ticket.limitPrice} onInput={(e) => setTicket('limitPrice', num(e))} />
        </label>
      </Show>
      <Show when={ticket.type !== 'market'}>
        <button class="tk-link" id="btn-ticket-sync" onClick={syncTicketPrices}>{tt("Son fiyatı kullan")}</button>
      </Show>
      <Show when={broker() === 'paper'}>
        <div class="tk-brackets">
          <label class="tk-check">
            <input id="chk-ticket-tp" type="checkbox" checked={ticket.tpOn} onChange={(e) => { setTicket('tpOn', e.currentTarget.checked); if (e.currentTarget.checked && !ticket.takeProfit) applyPct(); }} />
            {tt("Kâr Al")}
          </label>
          <input id="inp-ticket-tp" type="number" step="any" disabled={!ticket.tpOn} value={ticket.takeProfit || ''} onInput={(e) => setTicket('takeProfit', num(e))} />
          <label class="tk-check">
            <input id="chk-ticket-sl" type="checkbox" checked={ticket.slOn} onChange={(e) => { setTicket('slOn', e.currentTarget.checked); if (e.currentTarget.checked && !ticket.stopLoss) applyPct(); }} />
            {tt("Zarar Durdur")}
          </label>
          <input id="inp-ticket-sl" type="number" step="any" disabled={!ticket.slOn} value={ticket.stopLoss || ''} onInput={(e) => setTicket('stopLoss', num(e))} />
          <div class="tk-pct">
            <span>%</span>
            <input id="inp-ticket-tp-pct" type="number" step="0.1" value={tpPct()} onInput={(e) => setTpPct(num(e))} title={tt("Kâr al %")} />
            <input id="inp-ticket-sl-pct" type="number" step="0.1" value={slPct()} onInput={(e) => setSlPct(num(e))} title={tt("Zarar durdur %")} />
            <button class="btn-secondary" id="btn-ticket-pct" onClick={applyPct}>{tt("Uygula")}</button>
          </div>
        </div>
      </Show>
      <div class="tk-summary">
        <span>{tt("Tutar:")}{' '}<b>{risk().notional > 0 ? risk().notional.toFixed(2) : '—'}</b></span>
        <Show when={risk().rr !== null}>
          <span>{tt("Risk/Ödül:")}{' '}<b>1 : {risk().rr!.toFixed(2)}</b></span>
        </Show>
      </div>
      <Show when={errs().length > 0}>
        <div class="tk-errors" id="ticket-errors"><For each={errs()}>{(e) => <div>{e}</div>}</For></div>
      </Show>
      <button
        id="btn-ticket-send"
        class={`tk-send ${ticket.side === 'buy' ? 'tk-buy' : 'tk-sell'}`}
        disabled={tradingBusy() || errs().length > 0 || (broker() === 'binance' && !binanceStatus()?.configured)}
        onClick={() => void submitTicket()}
      >
        {broker() === 'binance' ? tt("Önizle (Binance) · ") : ''}
        {tt(SIDE_LABEL[ticket.side])} {ticket.qty} {ui.symbol} · {TYPE_LABEL[ticket.type]}
      </button>
      <Show when={tradingError()}>
        <div class="tk-errors">{tradingError()}</div>
      </Show>
      <BinanceConfirm />
    </div>
  );
}

/** Alt çalışma alanı: paper hesabı (pozisyonlar / emirler / geçmiş / hesap). */
export function PaperAccountPanel(props: { active: boolean }): JSX.Element {
  const [tab, setTab] = createSignal<'positions' | 'orders' | 'history' | 'account'>('positions');
  const [initial, setInitial] = createSignal(100000);
  const [comm, setComm] = createSignal(0);
  const [bracketEdit, setBracketEdit] = createSignal<{ symbol: string; tp: number; sl: number } | null>(null);
  const v = paperView;
  const s = () => v().summary;
  const tpOf = (sym: string) => v().orders.find((o) => o.symbol === sym && o.role === 'tp');
  const slOf = (sym: string) => v().orders.find((o) => o.symbol === sym && o.role === 'sl');
  return (
    <div id="wb-panel-paper" class="wb-panel wb-panel-single tk-account" classList={{ active: props.active }}>
      <div class="tk-acct-head">
        <span>{tt("Bakiye")}{' '}<b id="lbl-paper-cash">${s().balance.toFixed(2)}</b></span>
        <span>{tt("Özsermaye")}{' '}<b id="lbl-paper-total">${s().equity.toFixed(2)}</b></span>
        <span>{tt("Gerçekleşmemiş K/Z")}{' '}<b id="lbl-paper-open-pnl" class={pnlClass(s().unrealized)}>{fmtMoney(s().unrealized)}</b></span>
        <span>{tt("Gerçekleşen K/Z")}{' '}<b class={pnlClass(s().realized)}>{fmtMoney(s().realized)}</b></span>
        <span>{tt("Kullanılabilir")}{' '}<b>${s().available.toFixed(2)}</b></span>
      </div>
      <div class="tk-acct-tabs">
        <button data-ptab="positions" classList={{ active: tab() === 'positions' }} onClick={() => setTab('positions')}>{tt("Pozisyonlar (")}{v().positions.length})</button>
        <button data-ptab="orders" classList={{ active: tab() === 'orders' }} onClick={() => setTab('orders')}>{tt("Emirler (")}{v().orders.length})</button>
        <button data-ptab="history" classList={{ active: tab() === 'history' }} onClick={() => setTab('history')}>{tt("Geçmiş")}</button>
        <button data-ptab="account" classList={{ active: tab() === 'account' }} onClick={() => setTab('account')}>{tt("Hesap")}</button>
      </div>
      <div class="tk-acct-body">
        <Show when={tab() === 'positions'}>
          <table class="bt-table">
            <thead><tr><th>{tt("Sembol")}</th><th>{tt("Yön")}</th><th>{tt("Adet")}</th><th>{tt("Ort. Fiyat")}</th><th>{tt("Son")}</th><th>K/Z</th><th>K/Z %</th><th>{tt("Kâr Al")}</th><th>{tt("Zarar Durdur")}</th><th></th></tr></thead>
            <tbody id="paper-positions-tbody">
              <Show when={v().positions.length === 0}>
                <tr><td colSpan={10} class="tk-muted">{tt("Açık pozisyon yok. Grafikteki AL/SAT kutusu veya sağdaki Emir Paneli ile işlem açın.")}</td></tr>
              </Show>
              <For each={v().positions}>
                {(p) => {
                  const pnl = () => (p.last - p.avgPrice) * p.qty;
                  const pct = () => (p.avgPrice > 0 ? (((p.last - p.avgPrice) / p.avgPrice) * 100 * Math.sign(p.qty)) : 0);
                  return (
                    <tr class="paper-pos-row" data-pos={p.symbol}>
                      <td><a class="tk-sym" onClick={() => switchSymbol(p.symbol)}>{p.symbol}</a></td>
                      <td class={p.qty > 0 ? 'pos' : 'neg'}><b>{p.qty > 0 ? 'LONG' : 'SHORT'}</b></td>
                      <td>{Math.abs(p.qty)}</td>
                      <td>{fmtP(p.avgPrice)}</td>
                      <td>{fmtP(p.last)}</td>
                      <td class={pnlClass(pnl())}><b>{fmtMoney(pnl())}</b></td>
                      <td class={pnlClass(pnl())}>{pct().toFixed(2)}%</td>
                      <td>{fmtP(tpOf(p.symbol)?.limitPrice)}</td>
                      <td>{fmtP(slOf(p.symbol)?.stopPrice)}</td>
                      <td class="tk-actions">
                        <button class="btn-secondary" data-bracket-pos={p.symbol} onClick={() => setBracketEdit({ symbol: p.symbol, tp: tpOf(p.symbol)?.limitPrice ?? 0, sl: slOf(p.symbol)?.stopPrice ?? 0 })}>TP/SL</button>
                        <button class="btn-secondary" data-reverse-pos={p.symbol} onClick={() => void reversePosition(p.symbol)}>{tt("Ters çevir")}</button>
                        <button class="btn-secondary" data-close-pos={p.symbol} onClick={() => void closePosition(p.symbol)}>{tt("✕ Kapat")}</button>
                      </td>
                    </tr>
                  );
                }}
              </For>
            </tbody>
          </table>
          <Show when={bracketEdit()}>
            {(b) => (
              <div class="tk-bracket-edit" id="paper-bracket-edit">
                <b>{b().symbol}</b>
                <label>{tt("Kâr Al")}{' '}<input id="inp-pos-tp" type="number" step="any" value={b().tp || ''} onInput={(e) => setBracketEdit({ ...b(), tp: num(e) })} /></label>
                <label>{tt("Zarar Durdur")}{' '}<input id="inp-pos-sl" type="number" step="any" value={b().sl || ''} onInput={(e) => setBracketEdit({ ...b(), sl: num(e) })} /></label>
                <button
                  class="btn-primary"
                  id="btn-pos-bracket-save"
                  onClick={async () => {
                    const x = b();
                    // boş alan → mevcut köprüyü kaldır
                    if (await setBrackets(x.symbol, x.tp > 0 ? roundPrice(x.tp) : -1, x.sl > 0 ? roundPrice(x.sl) : -1)) setBracketEdit(null);
                  }}
                >
                  {tt("Kaydet")}
                </button>
                <button class="btn-secondary" onClick={() => setBracketEdit(null)}>{tt("Vazgeç")}</button>
              </div>
            )}
          </Show>
        </Show>
        <Show when={tab() === 'orders'}>
          <table class="bt-table">
            <thead><tr><th>{tt("Sembol")}</th><th>{tt("Yön")}</th><th>{tt("Tür")}</th><th>{tt("Rol")}</th><th>{tt("Adet")}</th><th>{tt("Fiyat")}</th><th>{tt("Kâr Al")}</th><th>{tt("Zarar Durdur")}</th><th></th></tr></thead>
            <tbody id="paper-orders-tbody">
              <Show when={v().orders.length === 0}>
                <tr><td colSpan={9} class="tk-muted">{tt("Çalışan emir yok.")}</td></tr>
              </Show>
              <For each={v().orders}>
                {(o) => (
                  <tr class="paper-order-row" data-order={o.id}>
                    <td>{o.symbol}</td>
                    <td class={o.side === 'buy' ? 'pos' : 'neg'}><b>{tt(SIDE_LABEL[o.side])}</b></td>
                    <td>{TYPE_LABEL[o.type]}</td>
                    <td>{ROLE_LABEL[o.role]}{o.reduceOnly ? tt(" · yalnız azalt") : ''}</td>
                    <td>{o.qty}</td>
                    <td>{orderPrice(o)}</td>
                    <td>{fmtP(o.takeProfit)}</td>
                    <td>{fmtP(o.stopLoss)}</td>
                    <td><button class="btn-secondary" data-cancel-order={o.id} onClick={() => void cancelOrder(o.id)}>{tt("✕ İptal")}</button></td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </Show>
        <Show when={tab() === 'history'}>
          <table class="bt-table">
            <thead><tr><th>{tt("Zaman")}</th><th>{tt("Sembol")}</th><th>{tt("Yön")}</th><th>{tt("Tür")}</th><th>{tt("Adet")}</th><th>{tt("Fiyat")}</th><th>{tt("Komisyon")}</th><th>{tt("Gerçekleşen K/Z")}</th></tr></thead>
            <tbody id="paper-history-tbody">
              <Show when={v().fills.length === 0}>
                <tr><td colSpan={8} class="tk-muted">{tt("Henüz dolum yok.")}</td></tr>
              </Show>
              <For each={v().fills.slice(0, 200)}>
                {(f) => (
                  <tr>
                    <td class="tk-muted">{new Date(f.time * 1000).toLocaleString(localeTag())}</td>
                    <td>{f.symbol}</td>
                    <td class={f.side === 'buy' ? 'pos' : 'neg'}><b>{tt(SIDE_LABEL[f.side])}</b></td>
                    <td>{TYPE_LABEL[f.type]}{f.role !== 'entry' ? ` (${ROLE_LABEL[f.role]})` : ''}</td>
                    <td>{f.qty}</td>
                    <td>{fmtP(f.price)}</td>
                    <td>{f.commission ? f.commission.toFixed(2) : '—'}</td>
                    <td class={pnlClass(f.realized)}>{f.realized ? fmtMoney(f.realized) : '—'}</td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
          <Show when={v().closed.some((o) => o.status === 'rejected')}>
            <div class="tk-sub">{tt("Reddedilen emirler")}</div>
            <For each={v().closed.filter((o) => o.status === 'rejected').slice(0, 20)}>
              {(o) => <div class="tk-muted">{o.symbol} {tt(SIDE_LABEL[o.side])} {o.qty}: {o.reason}</div>}
            </For>
          </Show>
        </Show>
        <Show when={tab() === 'account'}>
          <div class="tk-reset" id="paper-reset">
            <label>{tt("Başlangıç bakiyesi")}{' '}<input id="inp-paper-initial" type="number" min="1" value={initial()} onInput={(e) => setInitial(num(e))} /></label>
            <label>{tt("Komisyon %")}{' '}<input id="inp-paper-comm" type="number" min="0" max="10" step="0.01" value={comm()} onInput={(e) => setComm(num(e))} /></label>
            <button
              class="btn-secondary"
              id="btn-paper-reset"
              onClick={() => {
                if (typeof confirm === 'undefined' || confirm(tt("Paper hesabı sıfırlansın mı? Tüm emir, pozisyon ve geçmiş silinir."))) void resetAccount(initial(), comm());
              }}
            >
              {tt("Hesabı sıfırla")}
            </button>
            <div class="tk-muted">{tt("Şu an: başlangıç $")}{v().initialBalance.toFixed(2)}{' '}{tt("· komisyon %")}{v().commissionPct}{tt(". Emirler sunucuda değerlendirilir; tarayıcı kapalıyken de dolar.")}</div>
          </div>
        </Show>
      </div>
    </div>
  );
}
