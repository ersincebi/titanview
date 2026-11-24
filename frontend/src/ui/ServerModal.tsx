/**
 * Faz 33 — Ayarlar → Sunucu.
 * Kabukta (masaüstü/Android): bu cihazın yerel sunucusu ya da uzak bir TitanView sunucusu.
 * Tarayıcıda (uzak sunucunun kendi sayfası): belirteçle oturum aç.
 */
import { Show, createSignal, type JSX } from 'solid-js';
import { desktopConfig } from '../desktop/bridge';
import { activeBackendMode, browserLogin, clearRemote, isInsecure, loadRemote, normalizeServer, parsePairLink, probeServer, saveRemote, validToken, type ProbeResult } from '../desktop/remote';
import { tt } from '../state/i18n';
import { setUi, toast } from '../state/store';
import { Modal } from './Modal';

const PROBE_TEXT: Record<ProbeResult, string> = {
  ok: 'Bağlantı başarılı',
  unauthorized: 'Belirteç reddedildi',
  unreachable: 'Sunucuya ulaşılamıyor',
  error: 'Sunucu hata döndürdü',
};

export function ServerModal(): JSX.Element {
  const shell = desktopConfig() !== null;
  const saved = loadRemote();
  const [mode, setMode] = createSignal<'local' | 'remote'>(saved ? 'remote' : 'local');
  const [server, setServer] = createSignal(saved?.server ?? '');
  const [token, setToken] = createSignal(saved?.token ?? '');
  const [pair, setPair] = createSignal('');
  const [status, setStatus] = createSignal<ProbeResult | null>(null);
  const [busy, setBusy] = createSignal(false);
  const close = () => setUi('modal', null);
  const norm = () => normalizeServer(server());
  const formOk = () => norm() !== null && validToken(token().trim());

  const applyPair = (text: string) => {
    setPair(text);
    const c = parsePairLink(text);
    if (c) {
      setServer(c.server);
      setToken(c.token);
      setMode('remote');
      setStatus(null);
    }
  };

  const test = async () => {
    const s = norm();
    if (!s) return;
    setBusy(true);
    setStatus(await probeServer({ server: s, token: token().trim() }));
    setBusy(false);
  };

  const save = async () => {
    if (mode() === 'local') {
      clearRemote();
      location.reload();
      return;
    }
    const s = norm();
    if (!s || !validToken(token().trim())) return;
    setBusy(true);
    const r = await probeServer({ server: s, token: token().trim() });
    setBusy(false);
    setStatus(r);
    if (r !== 'ok') return;
    saveRemote({ server: s, token: token().trim() });
    location.reload();
  };

  const login = async () => {
    setBusy(true);
    const ok = await browserLogin(token()).catch(() => false);
    setBusy(false);
    if (ok) location.reload();
    else setStatus('unauthorized');
  };

  return (
    <Modal id="modal-server" title={tt('Sunucu')} width="460px" onClose={close}>
      <div class="server-modal">
        <Show
          when={shell}
          fallback={
            <>
              <p class="alert-hint">{tt('Bu sunucu belirteç istiyor. Sunucuyu başlatan kişiden belirteci al (sunucu günlüğündeki eşleştirme bağlantısının sonu).')}</p>
              <input id="inp-server-login" class="script-select" type="password" autocomplete="current-password" placeholder={tt('Belirteç')} value={token()} onInput={(e) => setToken(e.currentTarget.value)} onKeyDown={(e) => e.stopPropagation()} />
              <div class="alert-line">
                <span class="alert-hint alert-err">{status() ? tt(PROBE_TEXT[status()!]) : ''}</span>
                <span style={{ flex: '1' }} />
                <button id="btn-server-login" class="btn-primary" disabled={busy() || !validToken(token().trim())} onClick={() => void login()}>{tt('Oturum aç')}</button>
              </div>
            </>
          }
        >
          <label class="study-check">
            <input type="radio" name="server-mode" id="radio-server-local" checked={mode() === 'local'} onChange={() => setMode('local')} />
            <span>{tt('Bu cihaz (yerel)')}</span>
          </label>
          <p class="alert-hint alert-sub">{tt('Veriler ve alarmlar bu cihazda çalışır.')}</p>
          <label class="study-check">
            <input type="radio" name="server-mode" id="radio-server-remote" checked={mode() === 'remote'} onChange={() => setMode('remote')} />
            <span>{tt('Uzak sunucu')}</span>
          </label>
          <p class="alert-hint alert-sub">{tt('Evdeki ya da kendi sunucunda `titanview-server -remote` ile çalışan TitanView. Alarmlar orada değerlendirilir.')}</p>
          <Show when={mode() === 'remote'}>
            <div class="alert-sub server-fields">
              <input id="inp-server-pair" class="script-select" placeholder={tt('Eşleştirme bağlantısı (titanview://pair?…)')} value={pair()} onInput={(e) => applyPair(e.currentTarget.value)} onKeyDown={(e) => e.stopPropagation()} />
              <input id="inp-server-url" class="script-select" inputmode="url" placeholder="https://titan.example.com" value={server()} onInput={(e) => { setServer(e.currentTarget.value); setStatus(null); }} onKeyDown={(e) => e.stopPropagation()} />
              <input id="inp-server-token" class="script-select" type="password" autocomplete="off" placeholder={tt('Belirteç')} value={token()} onInput={(e) => { setToken(e.currentTarget.value); setStatus(null); }} onKeyDown={(e) => e.stopPropagation()} />
              <Show when={norm() && isInsecure(norm()!)}>
                <div class="alert-hint alert-err">{tt('Düz http: belirteç ağda şifresiz gider. Yalnız güvendiğin ev ağında kullan; mümkünse https.')}</div>
              </Show>
            </div>
          </Show>
          <div class="alert-line">
            <span id="server-status" class="alert-hint" classList={{ 'alert-err': !!status() && status() !== 'ok' }}>
              {status() ? tt(PROBE_TEXT[status()!]) : activeBackendMode() === 'remote' ? tt('Şu an: uzak sunucu') : tt('Şu an: bu cihaz')}
            </span>
            <span style={{ flex: '1' }} />
            <Show when={mode() === 'remote'}>
              <button id="btn-server-test" class="btn-secondary" disabled={busy() || !formOk()} onClick={() => void test()}>Test</button>
            </Show>
            <button id="btn-server-save" class="btn-primary" disabled={busy() || (mode() === 'remote' && !formOk())} onClick={() => void save().catch((e) => toast(String(e)))}>
              {tt('Kaydet ve yeniden yükle')}
            </button>
          </div>
        </Show>
      </div>
    </Modal>
  );
}
