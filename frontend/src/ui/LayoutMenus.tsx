import { tfmt, tt, localeTag } from '../state/i18n';
import { For, Show, createMemo, createSignal, type JSX } from 'solid-js';
import {
  LAYOUT_GROUPS,
  LAYOUT_MAP,
  getLayoutTemplate,
  layoutIconSvg,
  type ChartLayout,
  type DrawingSyncMode,
} from '../state/layout';
import {
  activeLayoutId,
  activeLayoutName,
  cloneReadOnlyLayout,
  connectedTabs,
  copyShareLink,
  createNewLayout,
  deleteSavedLayout,
  duplicateActiveLayout,
  exitReadOnlyLayout,
  layoutAutosave,
  layoutDirty,
  layoutIsShared,
  layoutShareToken,
  openSavedLayout,
  readOnlyLayout,
  renameActiveLayout,
  saveCurrentLayout,
  savedLayouts,
  setAutosaveEnabled,
  shareUrlForToken,
  toggleLayoutSharing,
} from '../state/savedLayouts';
import { setLayoutGrid, setSyncOption, setUi, ui } from '../state/store';
import { Modal } from './Modal';

const DRAWING_SYNC_MODES: Array<{ value: DrawingSyncMode; label: string }> = [
  { value: 'off', label: tt("Kapalı") },
  { value: 'layout', label: tt("Düzen içi") },
  { value: 'global', label: tt('Genel (tüm düzenler)') },
];

function SyncToggleRow(props: {
  id: string;
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}): JSX.Element {
  return (
    <label class="sync-toggle-row" for={props.id}>
      <span class="sync-toggle-text">
        <span>{props.label}</span>
        <Show when={props.hint}>
          <span class="sync-toggle-hint">{props.hint}</span>
        </Show>
      </span>
      <input
        id={props.id}
        type="checkbox"
        class="tv-switch"
        checked={props.checked}
        onChange={(e) => props.onChange(e.currentTarget.checked)}
      />
    </label>
  );
}

/** Standart "Düzen seç" açılır menüsü: 1–16 grafik (42 şablon) + tüm eşitleme türleri + sekmeler arası eşitleme. */
export function LayoutGridMenu(): JSX.Element {
  const pos = () => {
    const w = 368;
    const left = typeof window !== 'undefined' ? Math.max(8, Math.min(ui.menuPos.left, window.innerWidth - w - 12)) : ui.menuPos.left;
    return { left: `${left}px`, top: `${ui.menuPos.top}px` };
  };
  const peersLabel = () => {
    const n = connectedTabs();
    return n > 0 ? tfmt("{0} açık sekme bağlı", n) : tt("Diğer açık sekmelerle eşitle");
  };
  return (
    <Show when={ui.menu === 'layoutGrid'}>
      <div
        id="dropdown-layout-grid"
        class="tool-flyout layout-grid-menu open"
        style={{ position: 'fixed', ...pos() }}
        onClick={(e) => e.stopPropagation()}
      >
        <div class="layout-menu-sec-title">{tt("DÜZEN SEÇ (1–16 GRAFİK)")}</div>
        <div class="layout-groups-scroll">
          <For each={LAYOUT_GROUPS}>
            {(grp) => (
              <div class="layout-group-row" data-layout-count={grp.count}>
                <span class="layout-group-num">{grp.count}</span>
                <div class="layout-group-icons">
                  <For each={grp.items}>
                    {(tpl) => (
                      <button
                        class="layout-tpl-btn"
                        classList={{ active: ui.layout === tpl.id }}
                        data-layout-id={tpl.id}
                        title={tpl.label}
                        aria-label={tpl.label}
                        onClick={() => {
                          setLayoutGrid(tpl.id);
                          setUi('menu', null);
                        }}
                        innerHTML={layoutIconSvg(tpl, 18)}
                      />
                    )}
                  </For>
                </div>
              </div>
            )}
          </For>
        </div>

        <div class="flyout-sep" />
        <div class="layout-menu-sec-title">{tt("DÜZENDE EŞİTLE")}</div>
        <div class="layout-sync-list">
          <SyncToggleRow id="sync-symbol" label={tt("Sembol")} checked={ui.sync.symbol} onChange={(v) => setSyncOption('symbol', v)} />
          <SyncToggleRow id="sync-interval" label={tt("Aralık")} checked={ui.sync.interval} onChange={(v) => setSyncOption('interval', v)} />
          <SyncToggleRow id="sync-crosshair" label={tt("İmleç")} checked={ui.sync.crosshair} onChange={(v) => setSyncOption('crosshair', v)} />
          <SyncToggleRow id="sync-time" label={tt("Zaman")} hint={tt("Tıklanan bara hizala")} checked={ui.sync.time} onChange={(v) => setSyncOption('time', v)} />
          <SyncToggleRow id="sync-daterange" label={tt("Tarih aralığı")} checked={ui.sync.dateRange} onChange={(v) => setSyncOption('dateRange', v)} />
          <div class="sync-drawings-row">
            <span class="sync-toggle-text">{tt("Çizimler")}</span>
            <div class="sync-seg" role="group" aria-label={tt("Çizim eşitleme")}>
              <For each={DRAWING_SYNC_MODES}>
                {(m) => (
                  <button
                    class="sync-seg-btn"
                    classList={{ active: ui.sync.drawings === m.value }}
                    data-sync-drawings={m.value}
                    onClick={() => setSyncOption('drawings', m.value)}
                  >
                    {m.label}
                  </button>
                )}
              </For>
            </div>
          </div>
        </div>

        <div class="flyout-sep" />
        <SyncToggleRow
          id="sync-crosstab"
          label={tt("Sekmeler arası eşitleme")}
          hint={peersLabel()}
          checked={ui.sync.crossTab}
          onChange={(v) => setSyncOption('crossTab', v)}
        />
      </div>
    </Show>
  );
}

/** Standart `[☁ Düzen Adı ▾]` kayıtlı düzen yönetim menüsü. */
export function LayoutManageMenu(): JSX.Element {
  const [renaming, setRenaming] = createSignal(false);
  const [nameInput, setNameInput] = createSignal('');
  const pos = () => {
    const w = 276;
    const left = typeof window !== 'undefined' ? Math.max(8, Math.min(ui.menuPos.left, window.innerWidth - w - 12)) : ui.menuPos.left;
    return { left: `${left}px`, top: `${ui.menuPos.top}px` };
  };
  const shareUrl = () => (layoutIsShared() && layoutShareToken() ? shareUrlForToken(layoutShareToken()) : '');

  const submitRename = async () => {
    if (await renameActiveLayout(nameInput())) {
      setRenaming(false);
    }
  };

  return (
    <Show when={ui.menu === 'layoutManage'}>
      <div
        id="dropdown-layout-manage"
        class="tool-flyout layout-manage-menu open"
        style={{ position: 'fixed', ...pos() }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          id="btn-layout-save-now"
          class="tool-flyout-item"
          disabled={!!readOnlyLayout()}
          onClick={() => {
            void saveCurrentLayout();
            setUi('menu', null);
          }}
        >
          <span>{tt("Şimdi kaydet")}{' '}{layoutDirty() ? '•' : ''}</span>
          <span class="flyout-hint">⌘S</span>
        </button>

        <div class="layout-manage-toggle">
          <SyncToggleRow
            id="chk-layout-autosave"
            label={tt("Otomatik kaydet")}
            checked={layoutAutosave()}
            onChange={(v) => void setAutosaveEnabled(v)}
          />
        </div>

        <div class="layout-manage-toggle">
          <SyncToggleRow
            id="chk-layout-share"
            label={tt("Paylaşım (salt-okur)")}
            checked={layoutIsShared()}
            onChange={(v) => void toggleLayoutSharing(v)}
          />
        </div>

        <Show when={shareUrl()}>
          <div class="share-link-box" id="share-link-box">
            <input
              id="inp-share-url"
              class="script-select share-url-inp"
              type="text"
              readonly
              value={shareUrl()}
              onClick={(e) => e.currentTarget.select()}
            />
            <div class="share-link-actions">
              <button id="btn-copy-share-link" class="btn-secondary" onClick={() => void copyShareLink()}>
                {tt("Bağlantıyı kopyala")}
              </button>
              <button
                id="btn-regen-share-link"
                class="btn-secondary"
                title={tt("Yeni bağlantı oluştur (eskisi iptal olur)")}
                onClick={() => void toggleLayoutSharing(true, true)}
              >
                ↻
              </button>
            </div>
          </div>
        </Show>

        <div class="flyout-sep" />

        <Show
          when={renaming()}
          fallback={
            <button
              id="btn-layout-rename"
              class="tool-flyout-item"
              disabled={!!readOnlyLayout()}
              onClick={() => {
                setNameInput(activeLayoutName());
                setRenaming(true);
              }}
            >
              <span>{tt("Yeniden adlandır…")}</span>
              <span class="flyout-hint">{activeLayoutName()}</span>
            </button>
          }
        >
          <div class="layout-rename-row">
            <input
              id="inp-layout-rename"
              class="script-select grow"
              value={nameInput()}
              placeholder={tt("Düzen adı")}
              onInput={(e) => setNameInput(e.currentTarget.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') void submitRename();
                if (e.key === 'Escape') setRenaming(false);
              }}
            />
            <button id="btn-layout-rename-ok" class="btn-secondary" onClick={() => void submitRename()}>
              {tt("Tamam")}
            </button>
          </div>
        </Show>

        <button
          id="btn-layout-copy"
          class="tool-flyout-item"
          onClick={() => {
            void duplicateActiveLayout();
            setUi('menu', null);
          }}
        >
          <span>{tt("Kopya oluştur…")}</span>
        </button>

        <button
          id="btn-layout-new"
          class="tool-flyout-item"
          onClick={() => {
            void createNewLayout();
            setUi('menu', null);
          }}
        >
          <span>{tt("Yeni düzen oluştur")}</span>
        </button>

        <div class="flyout-sep" />

        <button
          id="btn-layout-open-modal"
          class="tool-flyout-item"
          onClick={() => {
            setUi('menu', null);
            setUi('modal', 'layouts');
          }}
        >
          <span>{tt("Düzen yükle…")}</span>
          <span class="flyout-hint">{savedLayouts().length}</span>
        </button>
      </div>
    </Show>
  );
}

function fmtUpdated(ts: number): string {
  if (!ts) return '';
  try {
    return new Date(ts * 1000).toLocaleString(localeTag(), {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

/** Kayıtlı düzenler listesi modalı: ara, aç, yeni oluştur, kopyala, sil. */
export function LayoutsModal(): JSX.Element {
  const [query, setQuery] = createSignal('');
  const [newName, setNewName] = createSignal('');
  const filtered = createMemo(() => {
    const q = query().trim().toLowerCase();
    const list = savedLayouts();
    if (!q) return list;
    return list.filter((l) => l.name.toLowerCase().includes(q) || l.symbols.toLowerCase().includes(q));
  });

  return (
    <Show when={ui.modal === 'layouts'}>
      <Modal id="modal-layouts" title={tt("Kayıtlı Grafik Düzenleri")} onClose={() => setUi('modal', null)}>
      <div class="layouts-modal-bar">
        <input
          id="inp-layouts-search"
          class="script-select grow"
          placeholder={tt("Düzen veya sembol ara…")}
          value={query()}
          onInput={(e) => setQuery(e.currentTarget.value)}
        />
        <input
          id="inp-new-layout-name"
          class="script-select"
          style={{ width: '160px' }}
          placeholder={tt("Yeni düzen adı")}
          value={newName()}
          onInput={(e) => setNewName(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && newName().trim()) {
              void createNewLayout(newName().trim());
              setNewName('');
              setUi('modal', null);
            }
          }}
        />
        <button
          id="btn-modal-new-layout"
          class="btn-primary"
          onClick={() => {
            void createNewLayout(newName().trim() || tt("Yeni Düzen"));
            setNewName('');
            setUi('modal', null);
          }}
        >
          {tt("+ Oluştur")}
        </button>
      </div>

      <div class="layouts-modal-list" id="layouts-modal-list">
        <For
          each={filtered()}
          fallback={
            <div class="layouts-empty">
              {tt("Henüz kayıtlı düzen yok. Mevcut çalışma alanınızı üst çubuktan")}{' '}<strong>{tt("Kaydet")}</strong>{' '}{tt("ile saklayabilirsiniz.")}
            </div>
          }
        >
          {(item) => {
            const tpl = () => getLayoutTemplate((item.gridId in LAYOUT_MAP ? item.gridId : 'single') as ChartLayout);
            const isActive = () => activeLayoutId() === item.id;
            return (
              <div class="layout-row" classList={{ active: isActive() }} data-saved-layout={item.id}>
                <span class="layout-row-icon" innerHTML={layoutIconSvg(tpl(), 22)} />
                <button
                  class="layout-row-main"
                  onClick={() => {
                    void openSavedLayout(item.id);
                    setUi('modal', null);
                  }}
                >
                  <div class="layout-row-title">
                    <strong>{item.name}</strong>
                    <Show when={isActive()}>
                      <span class="layout-badge active">{tt("Açık")}</span>
                    </Show>
                    <Show when={item.isShared}>
                      <span class="layout-badge shared">{tt("🔗 Paylaşılan")}</span>
                    </Show>
                  </div>
                  <div class="layout-row-meta">
                    <span>{item.chartCount}{' '}{tt("grafik (")}{tpl().label})</span>
                    <Show when={item.symbols}>
                      <span>· {item.symbols.split(',').slice(0, 4).join(', ')}</span>
                    </Show>
                    <span>· {fmtUpdated(item.updatedAt)}</span>
                  </div>
                </button>
                <div class="layout-row-actions">
                  <button
                    class="btn-secondary"
                    data-layout-open={item.id}
                    onClick={() => {
                      void openSavedLayout(item.id);
                      setUi('modal', null);
                    }}
                  >
                    {tt("Aç")}
                  </button>
                  <button
                    class="btn-secondary"
                    data-layout-del={item.id}
                    title={tt("Düzeni sil")}
                    onClick={() => void deleteSavedLayout(item.id)}
                  >
                    ✕
                  </button>
                </div>
              </div>
            );
          }}
        </For>
      </div>
      </Modal>
    </Show>
  );
}

/** `?share=<token>` ile açılan salt-okur paylaşım bandı. */
export function ReadOnlyBanner(): JSX.Element {
  return (
    <Show when={readOnlyLayout()}>
      {(ro) => (
        <div id="readonly-layout-banner" class="readonly-layout-banner" role="status">
          <span>
            {tt("👁 Salt-okur paylaşılan düzen:")}{' '}<strong>{ro().name}</strong>
          </span>
          <div class="readonly-banner-actions">
            <button id="btn-clone-shared" class="chip-btn" onClick={() => void cloneReadOnlyLayout()}>
              {tt("Kopya oluştur ve düzenle")}
            </button>
            <button id="btn-exit-shared" class="chip-btn" onClick={exitReadOnlyLayout}>
              {tt("Çıkış")}
            </button>
          </div>
        </div>
      )}
    </Show>
  );
}
