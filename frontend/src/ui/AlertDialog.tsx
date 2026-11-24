import { tfmt, tt, localeTag } from '../state/i18n';
import { LANG_NAME } from '../script/brand';
/**
 * Sunucu alarm oluşturma penceresi: Ayarlar (koşul, tetikleme, son kullanma, ad, mesaj) ve
 * Bildirimler (uygulama içi, açılır pencere, ses, Web Push, webhook, Telegram). Alarm sunucuda değerlendirilir.
 */
import { For, Show, createMemo, createSignal, onMount, type JSX } from 'solid-js';
import { createStore, unwrap } from 'solid-js/store';
import {
  alertConfig,
  alertDialog,
  alertPopup,
  dismissPopup,
  disablePush,
  enablePush,
  pushState,
  refreshAlertConfig,
  refreshPushState,
  saveAlertDraft,
  setAlertDialog,
} from '../state/alertStore';
import {
  CONDITIONS,
  SCRIPT_EVENTS,
  PLACEHOLDERS,
  PRICE_FIELDS,
  TRIGGERS,
  fromLocalInput,
  isChannelCond,
  isMovingCond,
  notifySummary,
  studyRef,
  toLocalInput,
  validateDraft,
  type AlertCondition,
  type AlertDraft,
  type AlertOperand,
  type AlertTrigger,
  type ScriptEvent,
  type PriceField,
} from '../state/alerts';
import { saveAlertConfig, testAlertChannel } from '../api/alerts';
import { scriptMain, toast, ui } from '../state/store';
import { studies, studyCode, studyResults, studyShortTitle } from '../state/studies';
import { Modal } from './Modal';
import '../styles/alerts.css';

const INTERVALS = ['1m', '3m', '5m', '15m', '30m', '1h', '4h', '1d', '1w'];

interface SourceOption {
  key: string;
  label: string;
  /** plot başlıkları */
  plots: string[];
  /** alertcondition başlık+mesaj */
  conditions: Array<{ title: string; message: string }>;
  isStrategy: boolean;
  make?: () => { name: string; code: string; inputs?: Record<string, unknown>; id?: string };
}

/** Grafikteki göstergeler + Betik Editörü betiği (+ düzenlenen alarmın kendi betiği). */
function sourceOptions(d: AlertDraft): SourceOption[] {
  const out: SourceOption[] = [{ key: 'price', label: d.symbol, plots: [], conditions: [], isStrategy: false }];
  for (const s of studies.list) {
    const code = studyCode(s);
    const res = studyResults()[s.uid];
    if (!code) continue;
    out.push({
      key: `study:${s.uid}`,
      label: studyShortTitle(s),
      plots: (res?.plots ?? []).map((p) => p.title),
      conditions: res?.alertConditions ?? [],
      isStrategy: !!res?.isStrategy,
      make: () => ({ id: s.uid, name: studyShortTitle(s), code, inputs: s.inputs }),
    });
  }
  const main = scriptMain();
  if (ui.scriptCode.trim()) {
    out.push({
      key: 'script:main',
      label: tfmt("{0}: {1}", LANG_NAME, main?.scriptTitle ?? tt("Editördeki betik")),
      plots: (main?.plots ?? []).map((p) => p.title),
      conditions: main?.alertConditions ?? [],
      isStrategy: !!main?.isStrategy,
      make: () => ({ name: main?.scriptTitle ?? LANG_NAME, code: ui.scriptCode }),
    });
  }
  // düzenlenen alarmın betiği grafikte değilse yine seçilebilir kalsın
  const own = d.kind === 'script' ? d.study : d.source.kind === 'plot' ? d.source.study : undefined;
  if (own && !out.some((o) => o.key === keyOfStudy(own.id, own.code))) {
    out.push({
      key: 'own',
      label: tfmt("{0} (alarmın betiği)", own.name),
      plots: d.source.plot ? [d.source.plot] : [],
      conditions: d.conditionTitle ? [{ title: d.conditionTitle, message: d.message }] : [],
      isStrategy: d.scriptEvent === 'order_fills' || d.scriptEvent === 'order_fills_alerts',
      make: () => ({ id: own.id, name: own.name, code: own.code, inputs: own.inputs }),
    });
  }
  return out;
}

function keyOfStudy(id: string | undefined, code: string): string {
  if (id && studies.list.some((s) => s.uid === id)) return `study:${id}`;
  if (code === ui.scriptCode) return 'script:main';
  return 'own';
}

function currentSourceKey(d: AlertDraft): string {
  if (d.kind === 'script' && d.study) return keyOfStudy(d.study.id, d.study.code);
  if (d.source.kind === 'plot' && d.source.study) return keyOfStudy(d.source.study.id, d.source.study.code);
  return 'price';
}

/** İkinci açılır liste değerleri: "plot:<başlık>" | "cond:<başlık>" | "event:<scriptEvent>". */
function currentWhat(d: AlertDraft): string {
  if (d.kind === 'script') return d.scriptEvent === 'alertcondition' ? `cond:${d.conditionTitle ?? ''}` : `event:${d.scriptEvent}`;
  return d.source.kind === 'plot' ? `plot:${d.source.plot ?? ''}` : 'price';
}

export function AlertDialog(): JSX.Element {
  return (
    <Show when={alertDialog()} keyed>
      {(st) => <AlertDialogBody draft={st.draft} editId={st.editId} tab={st.tab} note={st.note} />}
    </Show>
  );
}

function AlertDialogBody(props: { draft: AlertDraft; editId?: string; tab?: 'settings' | 'notify'; note?: string }): JSX.Element {
  const [d, setD] = createStore<AlertDraft>(JSON.parse(JSON.stringify(props.draft)));
  const [tab, setTab] = createSignal<'settings' | 'notify'>(props.tab ?? 'settings');
  const [busy, setBusy] = createSignal(false);
  const [trigOpen, setTrigOpen] = createSignal(false);
  const [webhookOn, setWebhookOn] = createSignal(!!props.draft.notify.webhook);
  const [tgToken, setTgToken] = createSignal('');
  const [tgChat, setTgChat] = createSignal('');
  const [tgEnabled, setTgEnabled] = createSignal(true);
  const [nfServer, setNfServer] = createSignal('');
  const [nfTopic, setNfTopic] = createSignal('');
  const [nfToken, setNfToken] = createSignal('');
  const [nfEnabled, setNfEnabled] = createSignal(true);
  let msgEl!: HTMLTextAreaElement;
  onMount(() => {
    void refreshPushState();
    void refreshAlertConfig().then(() => {
      const c = alertConfig();
      if (c) {
        setTgChat(c.telegram.chatId);
        setTgEnabled(c.telegram.enabled || !c.telegram.tokenSet);
        if (c.ntfy) {
          setNfServer(c.ntfy.server);
          setNfTopic(c.ntfy.topic);
          setNfEnabled(c.ntfy.enabled || !c.ntfy.topic);
        }
      }
    });
  });
  const close = () => setAlertDialog(null);
  const sources = createMemo(() => sourceOptions(d));
  const srcKey = () => currentSourceKey(d);
  const src = () => sources().find((o) => o.key === srcKey()) ?? sources()[0];
  const scriptEventFixed = () => d.kind === 'script' && d.scriptEvent !== 'alertcondition';

  const pickSource = (key: string) => {
    const o = sources().find((x) => x.key === key);
    if (!o || key === 'price') {
      setD({ kind: 'condition', source: { kind: 'price', field: 'close' }, study: undefined, scriptEvent: undefined, conditionTitle: undefined });
      if (!d.condition) setD('condition', 'crossing');
      return;
    }
    const st = o.make!();
    const { study } = studyRef(st.name, st.code, st.inputs ?? {}, st.id);
    if (o.conditions.length) {
      setD({ kind: 'script', study, scriptEvent: 'alertcondition', conditionTitle: o.conditions[0].title, message: d.message || o.conditions[0].message });
    } else if (o.plots.length) {
      setD({ kind: 'condition', source: { kind: 'plot', study, plot: o.plots[0] }, study: undefined, scriptEvent: undefined });
      if (!d.condition) setD('condition', 'crossing');
    } else {
      setD({ kind: 'script', study, scriptEvent: o.isStrategy ? 'order_fills_alerts' : 'alert_calls', conditionTitle: undefined });
    }
  };

  const pickWhat = (v: string) => {
    const o = src();
    const st = o.make?.();
    if (!st) return;
    const { study } = studyRef(st.name, st.code, st.inputs ?? {}, st.id);
    if (v.startsWith('plot:')) {
      setD({ kind: 'condition', source: { kind: 'plot', study, plot: v.slice(5) }, study: undefined, scriptEvent: undefined, conditionTitle: undefined });
      if (!d.condition) setD('condition', 'crossing');
    } else if (v.startsWith('cond:')) {
      const title = v.slice(5);
      const msg = o.conditions.find((c) => c.title === title)?.message ?? '';
      setD({ kind: 'script', study, scriptEvent: 'alertcondition', conditionTitle: title, message: msg });
    } else if (v.startsWith('event:')) {
      setD({ kind: 'script', study, scriptEvent: v.slice(6) as ScriptEvent, conditionTitle: undefined });
    }
  };

  const setTargetKind = (k: string) => {
    if (k === 'value') setD({ target: { kind: 'value', value: d.target?.value ?? 0 } });
    else if (k.startsWith('field:')) setD({ target: { kind: 'price', field: k.slice(6) as PriceField } });
    else if (k.startsWith('plot:')) {
      const o = src();
      const st = o.make?.();
      if (st) setD({ target: { kind: 'plot', study: studyRef(st.name, st.code, st.inputs ?? {}, st.id).study, plot: k.slice(5) } });
    } else if (k.startsWith('other:')) {
      const [, key, plot] = k.split('\u0001');
      const o = sources().find((x) => x.key === key);
      const st = o?.make?.();
      if (st) setD({ target: { kind: 'plot', study: studyRef(st.name, st.code, st.inputs ?? {}, st.id).study, plot } });
    }
  };

  const targetKey = (): string => {
    const t = d.target;
    if (!t) return 'value';
    if (t.kind === 'line') return 'line';
    if (t.kind === 'price') return `field:${t.field ?? 'close'}`;
    if (t.kind === 'plot') {
      const k = t.study ? keyOfStudy(t.study.id, t.study.code) : '';
      return k === srcKey() ? `plot:${t.plot}` : `other:\u0001${k}\u0001${t.plot}`;
    }
    return 'value';
  };

  const setBound = (which: 'upper' | 'lower', v: number) => setD({ [which]: { kind: 'value', value: v } as AlertOperand });

  const insertPlaceholder = (p: string) => {
    const el = msgEl;
    const cur = d.message ?? '';
    const at = el?.selectionStart ?? cur.length;
    setD('message', cur.slice(0, at) + p + cur.slice(el?.selectionEnd ?? at));
  };

  const submit = async () => {
    const draft = JSON.parse(JSON.stringify(unwrap(d))) as AlertDraft;
    if (!webhookOn()) delete draft.notify.webhook;
    if (draft.kind === 'script') {
      delete (draft as Partial<AlertDraft>).condition;
      delete draft.target;
    }
    if (!isChannelCond(draft.condition)) {
      delete draft.upper;
      delete draft.lower;
    }
    const err = validateDraft(draft);
    if (err) {
      toast(`Alarm: ${err}`);
      return;
    }
    setBusy(true);
    const ok = await saveAlertDraft(draft, props.editId);
    setBusy(false);
    if (ok) close();
  };

  const saveTelegram = async () => {
    try {
      await saveAlertConfig({ enabled: tgEnabled(), chatId: tgChat(), ...(tgToken() ? { token: tgToken() } : {}) });
      setTgToken('');
      await refreshAlertConfig();
      toast(tt("Telegram ayarları kaydedildi"));
    } catch (e) {
      toast(`Telegram: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const saveNtfy = async () => {
    const c = alertConfig();
    try {
      await saveAlertConfig(
        { enabled: c?.telegram.enabled ?? false, chatId: c?.telegram.chatId ?? '' },
        { enabled: nfEnabled(), server: nfServer().trim(), topic: nfTopic().trim(), ...(nfToken() ? { token: nfToken() } : {}) },
      );
      setNfToken('');
      await refreshAlertConfig();
      toast(tt('ntfy ayarları kaydedildi'));
    } catch (e) {
      toast(`ntfy: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const test = async (ch: 'telegram' | 'ntfy' | 'push' | 'webhook') => {
    const r = await testAlertChannel(ch, ch === 'webhook' ? d.notify.webhook : undefined);
    toast(r.ok ? tfmt("✅ {0} testi gönderildi {1}", ch, r.detail ?? '') : tfmt("❌ {0}: {1}", ch, r.detail ?? tt("başarısız")));
  };

  const title = () => `${props.editId ? tt("Alarmı düzenle") : tt("Alarm oluştur")}: ${d.symbol}, ${d.interval}`;
  const err = () => validateDraft(d);

  return (
    <Modal id="modal-alert" title={title()} width="520px" onClose={close}>
      <div class="study-tabs" role="tablist">
        <button class="study-tab-btn" role="tab" data-alert-tab="settings" classList={{ active: tab() === 'settings' }} onClick={() => setTab('settings')}>
          {tt("Ayarlar")}
        </button>
        <button class="study-tab-btn" role="tab" data-alert-tab="notify" classList={{ active: tab() === 'notify' }} onClick={() => setTab('notify')}>
          {tt("Bildirimler")}
        </button>
      </div>
      <div class="study-tab-body alert-dialog">
        <Show when={tab() === 'settings'}>
          <Show when={props.note}>
            <div class="alert-note">{props.note}</div>
          </Show>
          <div class="alert-row">
            <label class="alert-label">{tt("Koşul")}</label>
            <div class="alert-fields">
              <div class="alert-line">
                <select id="sel-alert-source" class="script-select alert-grow" value={srcKey()} onChange={(e) => pickSource(e.currentTarget.value)}>
                  <For each={sources()}>{(o) => <option value={o.key}>{o.label}</option>}</For>
                </select>
                <select id="sel-alert-interval" class="script-select" value={d.interval} title={tt("Değerlendirme aralığı")} onChange={(e) => setD('interval', e.currentTarget.value)}>
                  <For each={INTERVALS.includes(d.interval) ? INTERVALS : [d.interval, ...INTERVALS]}>{(tf) => <option value={tf}>{tf}</option>}</For>
                </select>
              </div>
              <Show when={srcKey() !== 'price'}>
                <select id="sel-alert-what" class="script-select" value={currentWhat(d)} onChange={(e) => pickWhat(e.currentTarget.value)}>
                  <Show when={src().plots.length}>
                    <optgroup label={tt("Çizimler (plot)")}>
                      <For each={src().plots}>{(p) => <option value={`plot:${p}`}>{p}</option>}</For>
                    </optgroup>
                  </Show>
                  <Show when={src().conditions.length}>
                    <optgroup label="alertcondition()">
                      <For each={src().conditions}>{(c) => <option value={`cond:${c.title}`}>{c.title}</option>}</For>
                    </optgroup>
                  </Show>
                  <optgroup label={tfmt("{0} olayları", LANG_NAME)}>
                    <For each={SCRIPT_EVENTS.filter((p) => p.id !== 'alertcondition' && (!p.strategyOnly || src().isStrategy))}>
                      {(p) => <option value={`event:${p.id}`}>{p.label}</option>}
                    </For>
                  </optgroup>
                </select>
              </Show>
              <Show when={d.kind === 'condition'}>
                <Show when={d.source.kind === 'price'}>
                  <select id="sel-alert-field" class="script-select" value={d.source.field ?? 'close'} onChange={(e) => setD('source', 'field', e.currentTarget.value as PriceField)}>
                    <For each={PRICE_FIELDS}>{(f) => <option value={f.id}>{f.label}</option>}</For>
                  </select>
                </Show>
                <select id="sel-alert-cond" class="script-select" value={d.condition ?? 'crossing'} onChange={(e) => setD('condition', e.currentTarget.value as AlertCondition)}>
                  <For each={CONDITIONS}>{(c) => <option value={c.id}>{c.label}</option>}</For>
                </select>
                <Show when={!isChannelCond(d.condition) && !isMovingCond(d.condition)}>
                  <div class="alert-line">
                    <select id="sel-alert-target" class="script-select" value={targetKey()} onChange={(e) => setTargetKind(e.currentTarget.value)}>
                      <option value="value">{tt("Değer")}</option>
                      <Show when={d.target?.kind === 'line'}>
                        <option value="line">{tt("Çizim (çizgi)")}</option>
                      </Show>
                      <optgroup label={tt("Fiyat")}>
                        <For each={PRICE_FIELDS}>{(f) => <option value={`field:${f.id}`}>{f.label}</option>}</For>
                      </optgroup>
                      <For each={sources().filter((o) => o.key !== 'price' && o.plots.length)}>
                        {(o) => (
                          <optgroup label={o.label}>
                            <For each={o.plots}>
                              {(p) => <option value={o.key === srcKey() ? `plot:${p}` : `other:\u0001${o.key}\u0001${p}`}>{p}</option>}
                            </For>
                          </optgroup>
                        )}
                      </For>
                    </select>
                    <Show when={(d.target?.kind ?? 'value') === 'value'}>
                      <input
                        id="inp-alert-price"
                        class="script-select alert-grow"
                        type="number"
                        step="any"
                        value={String(d.target?.value ?? '')}
                        onInput={(e) => setD({ target: { kind: 'value', value: parseFloat(e.currentTarget.value) } })}
                        onKeyDown={(e) => {
                          e.stopPropagation();
                          if (e.key === 'Enter') void submit();
                        }}
                      />
                    </Show>
                  </div>
                </Show>
                <Show when={isChannelCond(d.condition)}>
                  <Show
                    when={d.upper?.kind === 'line'}
                    fallback={
                      <div class="alert-line">
                        <span class="alert-mini">{tt("Üst")}</span>
                        <input id="inp-alert-upper" class="script-select alert-grow" type="number" step="any" value={String(d.upper?.value ?? '')} onInput={(e) => setBound('upper', parseFloat(e.currentTarget.value))} />
                        <span class="alert-mini">Alt</span>
                        <input id="inp-alert-lower" class="script-select alert-grow" type="number" step="any" value={String(d.lower?.value ?? '')} onInput={(e) => setBound('lower', parseFloat(e.currentTarget.value))} />
                      </div>
                    }
                  >
                    <div class="alert-hint">{tt("Kanal sınırları: seçili çizim (üst + alt çizgi)")}</div>
                  </Show>
                </Show>
                <Show when={isMovingCond(d.condition)}>
                  <div class="alert-line">
                    <input id="inp-alert-amount" class="script-select alert-grow" type="number" step="any" min="0" value={String(d.amount ?? 1)} onInput={(e) => setD('amount', parseFloat(e.currentTarget.value))} />
                    <span class="alert-mini">{d.condition?.endsWith('_pct') ? '%' : ''}{' '}{tt("içinde")}</span>
                    <input id="inp-alert-bars" class="script-select" style={{ width: '70px' }} type="number" min="1" step="1" value={String(d.bars ?? 1)} onInput={(e) => setD('bars', parseInt(e.currentTarget.value, 10))} />
                    <span class="alert-mini">bar</span>
                  </div>
                </Show>
              </Show>
            </div>
          </div>

          <div class="alert-row">
            <label class="alert-label">{tt("Tetikleme")}</label>
            <div class="alert-fields">
              <Show
                when={!scriptEventFixed()}
                fallback={<div class="alert-hint">{tt("Sıklık betikteki alert(…, freq) / emir dolumu ile belirlenir.")}</div>}
              >
                <div class="alert-trigger">
                  <button id="btn-alert-trigger" class="alert-trigger-btn" aria-haspopup="listbox" aria-expanded={trigOpen()} onClick={() => setTrigOpen(!trigOpen())}>
                    {TRIGGERS.find((t) => t.id === d.trigger)?.label ?? tt("Yalnız bir kez")} <span class="alert-caret">{trigOpen() ? '▴' : '▾'}</span>
                  </button>
                  <Show when={trigOpen()}>
                    <div class="alert-trigger-menu" role="listbox">
                      <For each={TRIGGERS}>
                        {(t) => (
                          <button
                            class="alert-trigger-item"
                            role="option"
                            aria-selected={d.trigger === t.id}
                            data-trigger={t.id}
                            classList={{ active: d.trigger === t.id }}
                            onClick={() => {
                              setD('trigger', t.id as AlertTrigger);
                              setTrigOpen(false);
                            }}
                          >
                            <span class="alert-trigger-label">{t.label}</span>
                            <span class="alert-trigger-hint">{t.hint}</span>
                          </button>
                        )}
                      </For>
                    </div>
                  </Show>
                </div>
              </Show>
            </div>
          </div>

          <div class="alert-row">
            <label class="alert-label">{tt("Son kullanma")}</label>
            <div class="alert-fields alert-line">
              <label class="study-check">
                <input id="chk-alert-open" type="checkbox" checked={!d.expiresAt} onChange={(e) => setD('expiresAt', e.currentTarget.checked ? undefined : Math.floor(Date.now() / 1000) + 30 * 86400)} />
                <span>{tt("Süresiz alarm")}</span>
              </label>
              <Show when={d.expiresAt}>
                <input id="inp-alert-expiry" class="script-select alert-grow" type="datetime-local" value={toLocalInput(d.expiresAt!)} onChange={(e) => setD('expiresAt', fromLocalInput(e.currentTarget.value))} />
              </Show>
            </div>
          </div>

          <div class="alert-row">
            <label class="alert-label">{tt("Alarm adı")}</label>
            <div class="alert-fields">
              <input id="inp-alert-name" class="script-select" placeholder={tt("İsteğe bağlı")} value={d.name} onInput={(e) => setD('name', e.currentTarget.value)} onKeyDown={(e) => e.stopPropagation()} />
            </div>
          </div>

          <div class="alert-row">
            <label class="alert-label">{tt("Mesaj")}</label>
            <div class="alert-fields">
              <textarea
                id="inp-alert-message"
                ref={msgEl}
                class="script-select alert-message"
                rows={3}
                placeholder={tt("Boş: otomatik ({{ticker}} Kesişim 65000)")}
                value={d.message}
                onInput={(e) => setD('message', e.currentTarget.value)}
                onKeyDown={(e) => e.stopPropagation()}
              />
              <div class="alert-placeholders">
                <For each={PLACEHOLDERS}>{(p) => <button class="alert-ph" data-ph={p} onClick={() => insertPlaceholder(p)}>{p}</button>}</For>
              </div>
            </div>
          </div>
          <div class="alert-row">
            <label class="alert-label">{tt("Bildirimler")}</label>
            <div class="alert-fields">
              <button id="btn-alert-notify-row" class="alert-trigger-btn" onClick={() => setTab('notify')}>
                {notifySummary(d.notify)} <span class="alert-caret">›</span>
              </button>
            </div>
          </div>
        </Show>

        <Show when={tab() === 'notify'}>
          <div class="alert-notify">
            <label class="study-check">
              <input id="chk-alert-app" type="checkbox" checked={d.notify.app} onChange={(e) => setD('notify', 'app', e.currentTarget.checked)} />
              <span>{tt("Uygulama içinde bildir")}</span>
            </label>
            <label class="study-check">
              <input id="chk-alert-popup" type="checkbox" checked={d.notify.popup} onChange={(e) => setD('notify', 'popup', e.currentTarget.checked)} />
              <span>{tt("Açılır pencere göster")}</span>
            </label>
            <label class="study-check">
              <input id="chk-alert-sound" type="checkbox" checked={d.notify.sound} onChange={(e) => setD('notify', 'sound', e.currentTarget.checked)} />
              <span>{tt("Ses çal")}</span>
            </label>

            <div class="alert-notify-block">
              <label class="study-check">
                <input id="chk-alert-push" type="checkbox" checked={d.notify.push} onChange={(e) => setD('notify', 'push', e.currentTarget.checked)} />
                <span>{tt("Web Push (tarayıcı kapalıyken de)")}</span>
              </label>
              <div class="alert-line alert-sub">
                <span class="alert-hint" id="push-state">
                  {pushState() === 'on'
                    ? tt("✓ Bu tarayıcı abone")
                    : pushState() === 'denied'
                      ? tt("Bildirim izni engellendi (tarayıcı ayarlarından açın)")
                      : pushState() === 'unsupported'
                        ? tt("Bu tarayıcıda desteklenmiyor")
                        : tt("Bu tarayıcı abone değil")}
                  {alertConfig() ? tfmt(" · {0} abone tarayıcı", alertConfig()!.pushSubscriptions) : ''}
                </span>
                <Show when={pushState() !== 'on'} fallback={<button class="btn-secondary" onClick={() => void disablePush()}>{tt("Aboneliği kaldır")}</button>}>
                  <button id="btn-push-enable" class="btn-secondary" disabled={pushState() === 'busy' || pushState() === 'unsupported'} onClick={() => void enablePush()}>
                    {tt("Bu tarayıcıyı abone et")}
                  </button>
                </Show>
                <button class="btn-secondary" onClick={() => void test('push')}>Test</button>
              </div>
            </div>

            <div class="alert-notify-block">
              <label class="study-check">
                <input id="chk-alert-webhook" type="checkbox" checked={webhookOn()} onChange={(e) => setWebhookOn(e.currentTarget.checked)} />
                <span>Webhook URL</span>
              </label>
              <Show when={webhookOn()}>
                <div class="alert-line alert-sub">
                  <input id="inp-alert-webhook" class="script-select alert-grow" placeholder="https://…" value={d.notify.webhook ?? ''} onInput={(e) => setD('notify', 'webhook', e.currentTarget.value.trim())} onKeyDown={(e) => e.stopPropagation()} />
                  <button class="btn-secondary" disabled={!d.notify.webhook} onClick={() => void test('webhook')}>Test</button>
                </div>
                <div class="alert-hint alert-sub">{tt("Mesaj geçerli JSON ise application/json, değilse text/plain olarak POST edilir.")}</div>
              </Show>
            </div>

            <div class="alert-notify-block">
              <label class="study-check">
                <input id="chk-alert-telegram" type="checkbox" checked={d.notify.telegram} onChange={(e) => setD('notify', 'telegram', e.currentTarget.checked)} />
                <span>Telegram</span>
              </label>
              <div class="alert-sub alert-tg">
                <input
                  id="inp-tg-token"
                  class="script-select"
                  type="password"
                  autocomplete="off"
                  placeholder={alertConfig()?.telegram.tokenSet ? tt("Bot anahtarı kayıtlı (değiştirmek için yazın)") : tt("Bot anahtarı (BotFather)")}
                  value={tgToken()}
                  onInput={(e) => setTgToken(e.currentTarget.value)}
                  onKeyDown={(e) => e.stopPropagation()}
                />
                <input id="inp-tg-chat" class="script-select" placeholder={tt("Sohbet kimliği (chat_id)")} value={tgChat()} onInput={(e) => setTgChat(e.currentTarget.value)} onKeyDown={(e) => e.stopPropagation()} />
                <div class="alert-line">
                  <label class="study-check">
                    <input type="checkbox" checked={tgEnabled()} onChange={(e) => setTgEnabled(e.currentTarget.checked)} />
                    <span>{tt("Etkin")}</span>
                  </label>
                  <span style={{ flex: '1' }} />
                  <button id="btn-tg-save" class="btn-secondary" onClick={() => void saveTelegram()}>{tt("Kaydet")}</button>
                  <button class="btn-secondary" onClick={() => void test('telegram')}>Test</button>
                </div>
                <div class="alert-hint">{tt("Anahtar yalnız sunucuda saklanır, arayüze geri gönderilmez.")}</div>
              </div>
            </div>

            <div class="alert-notify-block">
              <label class="study-check">
                <input id="chk-alert-ntfy" type="checkbox" checked={!!d.notify.ntfy} onChange={(e) => setD('notify', 'ntfy', e.currentTarget.checked)} />
                <span>{tt('Telefona bildirim (ntfy)')}</span>
              </label>
              <div class="alert-sub alert-tg">
                <input id="inp-ntfy-server" class="script-select" inputmode="url" placeholder="https://ntfy.sh" value={nfServer()} onInput={(e) => setNfServer(e.currentTarget.value)} onKeyDown={(e) => e.stopPropagation()} />
                <input id="inp-ntfy-topic" class="script-select" placeholder={tt('Konu (uzun ve tahmin edilemez)')} value={nfTopic()} onInput={(e) => setNfTopic(e.currentTarget.value)} onKeyDown={(e) => e.stopPropagation()} />
                <input
                  id="inp-ntfy-token"
                  class="script-select"
                  type="password"
                  autocomplete="off"
                  placeholder={alertConfig()?.ntfy?.tokenSet ? tt('Erişim belirteci kayıtlı (değiştirmek için yazın)') : tt('Erişim belirteci (isteğe bağlı)')}
                  value={nfToken()}
                  onInput={(e) => setNfToken(e.currentTarget.value)}
                  onKeyDown={(e) => e.stopPropagation()}
                />
                <div class="alert-line">
                  <label class="study-check">
                    <input type="checkbox" checked={nfEnabled()} onChange={(e) => setNfEnabled(e.currentTarget.checked)} />
                    <span>{tt("Etkin")}</span>
                  </label>
                  <span style={{ flex: '1' }} />
                  <button id="btn-ntfy-save" class="btn-secondary" onClick={() => void saveNtfy()}>{tt("Kaydet")}</button>
                  <button class="btn-secondary" onClick={() => void test('ntfy')}>Test</button>
                </div>
                <div class="alert-hint">{tt('Telefondaki ntfy uygulamasında aynı konuya abone ol: TitanView kapalıyken de bildirim gelir.')}</div>
              </div>
            </div>
          </div>
        </Show>
      </div>
      <div class="study-footer">
        <span class="alert-hint alert-err">{err() ?? tt("Sunucuda değerlendirilir: tarayıcı kapalıyken de çalışır")}</span>
        <span style={{ flex: '1' }} />
        <button id="btn-alert-cancel" class="btn-secondary" onClick={close}>{tt("İptal")}</button>
        <button id="btn-alert-create" class="btn-primary" disabled={busy() || !!err()} onClick={() => void submit()}>
          {props.editId ? tt("Kaydet") : tt("Oluştur")}
        </button>
      </div>
    </Modal>
  );
}

/** Standart alarm açılır penceresi (tetiklenince; "Açılır pencere göster" seçiliyse). */
export function AlertPopups(): JSX.Element {
  return (
    <Show when={alertPopup().length}>
      <div id="alert-popups" class="alert-popups" role="alertdialog" aria-live="assertive">
        <For each={alertPopup()}>
          {(e) => (
            <div class="alert-popup" data-log-id={e.id}>
              <div class="alert-popup-head">
                <span>⏰ {e.name || `Alarm: ${e.symbol}`}</span>
                <button class="icon-btn" aria-label={tt("Kapat")} onClick={() => dismissPopup(e.id)}>✕</button>
              </div>
              <div class="alert-popup-msg">{e.message}</div>
              <div class="alert-popup-meta">
                {e.symbol} · {e.interval} · {new Date(e.time).toLocaleString(localeTag())}
              </div>
              <div class="alert-popup-foot">
                <button class="btn-primary" onClick={() => dismissPopup(e.id)}>{tt("Tamam")}</button>
              </div>
            </div>
          )}
        </For>
      </div>
    </Show>
  );
}
