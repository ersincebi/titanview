// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const srv = vi.hoisted(() => ({
  created: [] as Array<Record<string, any>>,
  updated: [] as Array<[string, Record<string, any>]>,
  config: { telegram: { enabled: false, chatId: '', tokenSet: false }, pushSubscriptions: 0 },
  savedCfg: [] as unknown[],
  tests: [] as string[],
  fail: false,
}));

vi.mock('../../api/alerts', () => ({
  listAlerts: vi.fn(async () => []),
  createAlertApi: vi.fn(async (d: Record<string, any>) => {
    if (srv.fail) throw new Error('symbol is required');
    srv.created.push(d);
    return { ...d, id: 'al_1', status: 'active', createdAt: 1, updatedAt: 1, fireCount: 0 };
  }),
  updateAlertApi: vi.fn(async (id: string, d: Record<string, any>) => {
    srv.updated.push([id, d]);
    return { ...d, id, status: 'active', createdAt: 1, updatedAt: 2, fireCount: 0 };
  }),
  deleteAlertApi: vi.fn(async () => {}),
  alertAction: vi.fn(async () => ({})),
  bulkAlertAction: vi.fn(async () => 2),
  fetchAlertLog: vi.fn(async () => []),
  clearAlertLog: vi.fn(async () => {}),
  fetchAlertConfig: vi.fn(async () => srv.config),
  saveAlertConfig: vi.fn(async (t: unknown, ntfy?: unknown) => {
    srv.savedCfg.push(ntfy ? { telegram: t, ntfy } : t);
    return { ...srv.config, telegram: { enabled: true, chatId: '42', tokenSet: true } };
  }),
  testAlertChannel: vi.fn(async (ch: string) => {
    srv.tests.push(ch);
    return { channel: ch, ok: ch !== 'push', detail: ch === 'push' ? 'abone tarayıcı yok' : undefined };
  }),
  fetchPushKey: vi.fn(async () => 'BAAA'),
  savePushSubscription: vi.fn(async () => {}),
  deletePushSubscription: vi.fn(async () => {}),
}));

import { AlertDialog, AlertPopups } from '../AlertDialog';
import {
  alertDialog,
  alertLog,
  alertPopup,
  bulkAlerts,
  dismissPopup,
  editAlert,
  enablePush,
  handleAlertEvent,
  migrateLegacy,
  openDrawingAlert,
  openScriptAlert,
  openPriceAlert,
  openStudyAlert,
  onSwMessage,
  pushState,
  refreshPushState,
  saveAlertDraft,
  setAlertDialog,
  setAlertLog,
  setAlertPopup,
} from '../../state/alertStore';
import { priceAlertDraft, type AlertLogEntry, type ServerAlert } from '../../state/alerts';
import { resetStore, setCandles, setUi, ui } from '../../state/store';
import { _resetStudies, setStudies, setStudyResults } from '../../state/studies';
import { newStudyInstance } from '../../state/studyModel';
import type { Candle, DrawingObject, ScriptExecutionResult } from '../../types/market';

const $ = (sel: string) => document.querySelector(sel) as HTMLElement;
const candles = (n: number): Candle[] =>
  Array.from({ length: n }, (_, i) => ({ time: 1_700_000_000 + i * 900, open: 100 + i, high: 101 + i, low: 99 + i, close: 100 + i, volume: 10 }));

function mountDialog() {
  render(() => (
    <>
      <AlertDialog />
      <AlertPopups />
    </>
  ));
}

beforeEach(() => {
  resetStore();
  _resetStudies();
  setCandles(candles(40));
  setAlertDialog(null);
  setAlertPopup([]);
  setAlertLog([]);
  srv.created = [];
  srv.updated = [];
  srv.savedCfg = [];
  srv.tests = [];
  srv.fail = false;
});
afterEach(() => cleanup());

describe('Faz 23 — alarm penceresi', () => {
  it('price alert defaults to Standart "Crossing / Only once" at the last price; channel + moving inputs switch', async () => {
    openPriceAlert();
    mountDialog();
    expect(($('#inp-alert-price') as HTMLInputElement).value).toBe('139');
    expect($('#btn-alert-trigger').textContent).toContain('Yalnız bir kez');
    fireEvent.change($('#sel-alert-cond'), { target: { value: 'entering_channel' } });
    expect($('#inp-alert-price')).toBeNull();
    fireEvent.input($('#inp-alert-upper'), { target: { value: '150' } });
    fireEvent.input($('#inp-alert-lower'), { target: { value: '130' } });
    fireEvent.change($('#sel-alert-field'), { target: { value: 'high' } });
    fireEvent.click($('#chk-alert-open'));
    expect(($('#inp-alert-expiry') as HTMLInputElement).value).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d$/);
    fireEvent.click($('#btn-alert-create'));
    await waitFor(() => expect(srv.created).toHaveLength(1));
    const d = srv.created[0];
    expect(d.condition).toBe('entering_channel');
    expect(d.source).toEqual({ kind: 'price', field: 'high' });
    expect(d.upper).toEqual({ kind: 'value', value: 150 });
    expect(d.lower).toEqual({ kind: 'value', value: 130 });
    expect(d.expiresAt).toBeGreaterThan(Date.now() / 1000);
    expect(d.notify.webhook).toBeUndefined();
    await waitFor(() => expect(alertDialog()).toBeNull());

    openPriceAlert(10);
    await waitFor(() => expect($('#sel-alert-cond')).toBeTruthy());
    fireEvent.change($('#sel-alert-cond'), { target: { value: 'moving_down_pct' } });
    fireEvent.input($('#inp-alert-amount'), { target: { value: '2.5' } });
    fireEvent.input($('#inp-alert-bars'), { target: { value: '4' } });
    fireEvent.change($('#sel-alert-interval'), { target: { value: '1h' } });
    fireEvent.click($('#btn-alert-create'));
    await waitFor(() => expect(srv.created).toHaveLength(2));
    expect(srv.created[1]).toMatchObject({ condition: 'moving_down_pct', amount: 2.5, bars: 4, interval: '1h' });
    expect(srv.created[1].upper).toBeUndefined();
  });

  it('drawing alert: trend line → crossing a line, parallel channel → exiting channel', async () => {
    const d: DrawingObject = { id: 'dr1', symbol: 'THYAO.IS', timeframe: '15m', toolType: 'trendline', color: '#fff', points: [{ time: 1_700_000_000, price: 100 }, { time: 1_700_009_000, price: 110 }] };
    openDrawingAlert(d);
    mountDialog();
    expect(($('#sel-alert-target') as HTMLSelectElement).value).toBe('line');
    fireEvent.click($('#btn-alert-create'));
    await waitFor(() => expect(srv.created).toHaveLength(1));
    expect(srv.created[0]).toMatchObject({ drawingId: 'dr1', condition: 'crossing', target: { kind: 'line', line: { a: { time: 1_700_000_000, price: 100 } } } });
    openDrawingAlert({ ...d, toolType: 'channel', points: [...d.points, { time: 1_700_004_500, price: 95 }] });
    await waitFor(() => expect($('#sel-alert-cond')).toBeTruthy());
    expect(($('#sel-alert-cond') as HTMLSelectElement).value).toBe('exiting_channel');
    expect($('#modal-alert').textContent).toContain('seçili çizim');
    fireEvent.click($('#btn-alert-create'));
    await waitFor(() => expect(srv.created).toHaveLength(2));
    expect(srv.created[1].upper.kind).toBe('line');
    expect(srv.created[1].lower.line.a.price).toBeCloseTo(90);
    // unsupported tool → toast, no dialog
    setAlertDialog(null);
    openDrawingAlert({ ...d, toolType: 'fib' });
    expect(alertDialog()).toBeNull();
  });

  it('indicator alerts: alertcondition preselected; switching to a plot and to alert() calls', async () => {
    setStudies('list', [newStudyInstance('s1', { code: '//@version=6\nindicator("Mine")', inputs: { len: 9, src: '@s9:EMA' } })]);
    const res: ScriptExecutionResult = {
      ok: true, scriptTitle: 'Mine', isStrategy: false, isOverlay: false, executionMs: 1, markers: [], hlines: [],
      plots: [{ id: 'p0', title: 'Sinyal', color: '#fff', lineWidth: 1, style: 'line', isOverlay: false, data: [{ time: 1, value: 55.123456 }] }],
      alertConditions: [{ title: 'Al', message: 'Al {{close}}' }],
    };
    setStudyResults({ s1: res });
    openStudyAlert('s1');
    mountDialog();
    expect($('#modal-alert').textContent).toContain('src');
    expect(($('#sel-alert-what') as HTMLSelectElement).value).toBe('cond:Al');
    expect(($('#inp-alert-message') as HTMLTextAreaElement).value).toBe('Al {{close}}');
    expect($('#btn-alert-trigger').textContent).toContain('Bar kapanışında bir kez');
    fireEvent.change($('#sel-alert-what'), { target: { value: 'plot:Sinyal' } });
    fireEvent.change($('#sel-alert-cond'), { target: { value: 'greater_than' } });
    fireEvent.input($('#inp-alert-price'), { target: { value: '70' } });
    fireEvent.click($('#btn-alert-create'));
    await waitFor(() => expect(srv.created).toHaveLength(1));
    expect(srv.created[0]).toMatchObject({ kind: 'condition', source: { kind: 'plot', plot: 'Sinyal', study: { id: 's1', name: 'Mine', inputs: { len: 9 } } }, condition: 'greater_than' });
    expect(srv.created[0].study).toBeUndefined();

    openStudyAlert('s1');
    await waitFor(() => expect($('#sel-alert-what')).toBeTruthy());
    fireEvent.change($('#sel-alert-what'), { target: { value: 'event:alert_calls' } });
    expect($('#modal-alert').textContent).toContain('Sıklık betikteki');
    fireEvent.click($('#btn-alert-create'));
    await waitFor(() => expect(srv.created).toHaveLength(2));
    expect(srv.created[1]).toMatchObject({ kind: 'script', scriptEvent: 'alert_calls' });
    expect(srv.created[1].condition).toBeUndefined();
    expect(srv.created[1].target).toBeUndefined();

    // plot-only indicator → condition on its first plot with the last value
    setStudyResults({ s1: { ...res, alertConditions: [] } });
    openStudyAlert('s1');
    expect(alertDialog()!.draft.source).toMatchObject({ kind: 'plot', plot: 'Sinyal' });
    expect(alertDialog()!.draft.target?.value).toBe(55.1235);
    openStudyAlert('nope');
  });

  it('source switch: price ↔ TitanScript editor strategy (order fills); target can be another plot', async () => {
    setUi('scriptCode', '//@version=6\nstrategy("S")');
    openScriptAlert(ui.scriptCode, 'S', true, []);
    expect(alertDialog()!.draft.scriptEvent).toBe('order_fills_alerts');
    openScriptAlert('c', 'I', false, [{ title: 'X', message: 'm' }]);
    expect(alertDialog()!.draft).toMatchObject({ scriptEvent: 'alertcondition', conditionTitle: 'X', message: 'm' });
    setStudies('list', [newStudyInstance('s1', { code: 'x' })]);
    setStudyResults({ s1: { ok: true, scriptTitle: 'MA', isStrategy: false, isOverlay: true, executionMs: 1, markers: [], hlines: [], plots: [{ id: 'p', title: 'MA', color: '', lineWidth: 1, style: 'line', isOverlay: true, data: [] }] } });
    openPriceAlert(5);
    mountDialog();
    fireEvent.change($('#sel-alert-target'), { target: { value: (Array.from(($('#sel-alert-target') as HTMLSelectElement).options).find((o) => o.textContent === 'MA') as HTMLOptionElement).value } });
    expect($('#inp-alert-price')).toBeNull();
    fireEvent.change($('#sel-alert-source'), { target: { value: 'script:main' } });
    expect(alertDialog()).not.toBeNull();
    fireEvent.change($('#sel-alert-source'), { target: { value: 'price' } });
    fireEvent.change($('#sel-alert-target'), { target: { value: 'field:open' } });
    fireEvent.click($('#btn-alert-create'));
    await waitFor(() => expect(srv.created).toHaveLength(1));
    expect(srv.created[0].target).toEqual({ kind: 'price', field: 'open' });
  });

  it('edit keeps the id; notifications tab: webhook, Telegram config (token write-only), tests, push', async () => {
    const a = { ...priceAlertDraft('BTCUSDT', '1m', 1), id: 'al_9', status: 'stopped', createdAt: 1, updatedAt: 1, fireCount: 3, name: 'eski' } as ServerAlert;
    editAlert(a);
    mountDialog();
    expect($('#modal-alert .tv-modal-header').textContent).toContain('Alarmı düzenle');
    fireEvent.click($('[data-alert-tab="notify"]'));
    await waitFor(() => expect($('#inp-tg-token')).toBeTruthy());
    fireEvent.click($('#chk-alert-telegram'));
    fireEvent.click($('#chk-alert-push'));
    fireEvent.click($('#chk-alert-sound'));
    fireEvent.input($('#inp-tg-token'), { target: { value: '123:ABC' } });
    fireEvent.input($('#inp-tg-chat'), { target: { value: '42' } });
    fireEvent.click($('#btn-tg-save'));
    await waitFor(() => expect(srv.savedCfg).toEqual([{ enabled: true, chatId: '42', token: '123:ABC' }]));
    expect(($('#inp-tg-token') as HTMLInputElement).value).toBe('');
    fireEvent.click($('#chk-alert-webhook'));
    fireEvent.input($('#inp-alert-webhook'), { target: { value: 'https://h.example/a' } });
    for (const b of Array.from(document.querySelectorAll('.alert-notify .btn-secondary')).filter((x) => x.textContent === 'Test')) fireEvent.click(b);
    await waitFor(() => expect(srv.tests.sort()).toEqual(['ntfy', 'push', 'telegram', 'webhook']));
    expect($('#push-state').textContent).toContain('desteklenmiyor');
    fireEvent.click($('[data-alert-tab="settings"]'));
    fireEvent.click($('[data-ph="{{ticker}}"]'));
    fireEvent.click($('#btn-alert-create'));
    await waitFor(() => expect(srv.updated).toHaveLength(1));
    const [id, d] = srv.updated[0];
    expect(id).toBe('al_9');
    expect(d).toMatchObject({ name: 'eski', message: '{{ticker}}', notify: { telegram: true, push: true, sound: false, webhook: 'https://h.example/a' } });
    expect(d.status).toBeUndefined();
  });

  it('ntfy phone push: config saved with write-only token, channel selectable', async () => {
    openPriceAlert(1);
    mountDialog();
    fireEvent.click($('[data-alert-tab="notify"]'));
    await waitFor(() => expect($('#inp-ntfy-topic')).toBeTruthy());
    fireEvent.click($('#chk-alert-ntfy'));
    fireEvent.input($('#inp-ntfy-server'), { target: { value: ' https://ntfy.example ' } });
    fireEvent.input($('#inp-ntfy-topic'), { target: { value: 'titan-abc123' } });
    fireEvent.input($('#inp-ntfy-token'), { target: { value: 'tk_1' } });
    fireEvent.click($('#btn-ntfy-save'));
    await waitFor(() => expect(srv.savedCfg).toHaveLength(1));
    expect(srv.savedCfg[0]).toEqual({
      telegram: { enabled: false, chatId: '' },
      ntfy: { enabled: true, server: 'https://ntfy.example', topic: 'titan-abc123', token: 'tk_1' },
    });
    expect(($('#inp-ntfy-token') as HTMLInputElement).value).toBe('');
    fireEvent.click($('[data-alert-tab="settings"]'));
    fireEvent.click($('#btn-alert-create'));
    await waitFor(() => expect(srv.created).toHaveLength(1));
    expect(srv.created[0].notify.ntfy).toBe(true);
  });

  it('validation and server errors keep the dialog open', async () => {
    openPriceAlert(1);
    mountDialog();
    fireEvent.input($('#inp-alert-price'), { target: { value: '' } });
    expect(($('#btn-alert-create') as HTMLButtonElement).disabled).toBe(true);
    expect($('.study-footer').textContent).toContain('Değer sayı olmalı');
    fireEvent.input($('#inp-alert-price'), { target: { value: '3' } });
    srv.fail = true;
    fireEvent.click($('#btn-alert-create'));
    await waitFor(() => expect(document.querySelector('#titan-toast')?.textContent ?? '').toBeDefined());
    expect(alertDialog()).not.toBeNull();
    expect(await saveAlertDraft({ ...priceAlertDraft('', '1m', 1) })).toBeNull();
    fireEvent.click($('#btn-alert-cancel'));
    expect(alertDialog()).toBeNull();
    setCandles([]);
    openPriceAlert();
    expect(alertDialog()).toBeNull();
  });
});

describe('Faz 23 — tetiklenme bildirimi', () => {
  const entry = (id: number, n: Partial<AlertLogEntry['notify']> = {}): AlertLogEntry => ({
    id, alertId: 'a', name: 'BTC 65k', symbol: 'BTCUSDT', interval: '1m', time: 1_800_000_000_000, barTime: 1, price: 65001,
    message: 'BTC 65001 üstünde', notify: { app: true, popup: true, sound: true, push: false, telegram: false, ...n },
  });

  it('SSE entry: toast + popup + sound once; the second publish only updates deliveries', async () => {
    const osc = { type: '', frequency: { setValueAtTime: vi.fn() }, connect: vi.fn(() => ({ connect: vi.fn() })), start: vi.fn(), stop: vi.fn() };
    const AC = vi.fn(() => ({ currentTime: 0, destination: {}, createOscillator: () => osc, createGain: () => ({ gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }, connect: vi.fn() }) }));
    vi.stubGlobal('AudioContext', AC);
    mountDialog();
    handleAlertEvent(entry(101));
    handleAlertEvent({ ...entry(101), deliveries: [{ channel: 'webhook', ok: true, detail: 'HTTP 200' }] });
    expect(alertLog()).toHaveLength(1);
    expect(alertLog()[0].deliveries).toHaveLength(1);
    expect(alertPopup()).toHaveLength(1);
    expect(AC).toHaveBeenCalledTimes(1);
    await waitFor(() => expect($('#alert-popups').textContent).toContain('BTC 65001 üstünde'));
    handleAlertEvent(entry(102, { popup: false, sound: false, app: false }));
    expect(alertPopup()).toHaveLength(1);
    fireEvent.click($('#alert-popups .btn-primary'));
    expect(alertPopup()).toHaveLength(0);
    setAlertPopup([entry(1), entry(2)]);
    dismissPopup();
    expect(alertPopup()).toHaveLength(0);
    vi.unstubAllGlobals();
  });

  it('push unsupported in jsdom; legacy migration; bulk', async () => {
    await refreshPushState();
    expect(pushState()).toBe('unsupported');
    expect(await enablePush()).toBe(false);
    const n = await migrateLegacy([{ id: 'x', symbol: 'THYAO.IS', targetPrice: 300, condition: 'CROSS_UP', triggered: false, note: '' }]);
    expect(n).toBe(1);
    expect(srv.created[0]).toMatchObject({ symbol: 'THYAO.IS', condition: 'crossing_up', target: { kind: 'value', value: 300 } });
    expect(await migrateLegacy([])).toBe(0);
    await bulkAlerts('stop_all');
    onSwMessage({ type: 'other' });
    onSwMessage(null);
    onSwMessage({ type: 'titan-alert-open', symbol: ui.symbol });
  });
});
