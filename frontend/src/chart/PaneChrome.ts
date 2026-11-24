import { tt } from '../state/i18n';
import type { PaneId } from './panes';

/** Pane başlığı (etiket + taşı/büyüt/ölçek/sil düğmeleri) ve sürükle-bırak sıralama. Saf DOM; grafik motorundan bağımsız. */
export type PaneAction = 'up' | 'down' | 'max' | 'menu' | 'close';

export interface PaneChromeHooks {
  onAction(id: PaneId, act: PaneAction, ev: MouseEvent): void;
  onDrop(id: PaneId, target: PaneId): void;
}

export interface PaneBox {
  id: PaneId;
  label: string;
  /** host'a göre piksel */
  top: number;
  height: number;
  maximized: boolean;
  canUp: boolean;
  canDown: boolean;
  /** yalnız ≥2 pane varken anlamlı olan düğmeler (main için büyüt) */
  showMax: boolean;
  /** Faz 20: gösterge pane'i durum satırı değerleri (imleçteki bar, renkli) */
  values?: Array<{ text: string; color: string }>;
}

const BTNS: Array<[PaneAction, string, string]> = [
  ['up', '▲', tt("Yukarı taşı")],
  ['down', '▼', tt("Aşağı taşı")],
  ['max', '⤢', tt("Büyüt / geri al")],
  ['menu', '⚙', tt("Ölçek ve ayarlar")],
  ['close', '✕', tt("Paneli kaldır")],
];

export class PaneChrome {
  private root: HTMLDivElement;
  private els = new Map<PaneId, HTMLDivElement>();
  private boxes: PaneBox[] = [];
  private dropLine: HTMLDivElement;
  private dragging: PaneId | null = null;

  constructor(host: HTMLElement, private hooks: PaneChromeHooks) {
    this.root = document.createElement('div');
    this.root.className = 'pane-chrome-layer';
    this.dropLine = document.createElement('div');
    this.dropLine.className = 'pane-drop-line';
    this.dropLine.style.display = 'none';
    this.root.appendChild(this.dropLine);
    host.appendChild(this.root);
    this.root.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-pane-act]');
      const id = b?.closest<HTMLElement>('[data-pane]')?.dataset.pane as PaneId | undefined;
      if (!b || !id) return;
      e.stopPropagation();
      this.hooks.onAction(id, b.dataset.paneAct as PaneAction, e);
    });
    this.root.addEventListener('pointerdown', (e) => {
      const g = (e.target as HTMLElement).closest<HTMLElement>('.pane-grip');
      const id = g?.closest<HTMLElement>('[data-pane]')?.dataset.pane as PaneId | undefined;
      if (!g || !id || id === 'main') return;
      e.preventDefault();
      this.dragging = id;
      const move = (ev: PointerEvent) => this.dragMove(ev);
      const up = (ev: PointerEvent) => {
        document.removeEventListener('pointermove', move);
        document.removeEventListener('pointerup', up);
        this.dragEnd(ev);
      };
      document.addEventListener('pointermove', move);
      document.addEventListener('pointerup', up);
    });
  }

  private targetAt(clientY: number): PaneBox | null {
    const top = this.root.getBoundingClientRect().top;
    const y = clientY - top;
    return this.boxes.find((b) => y >= b.top && y < b.top + b.height) ?? null;
  }

  private dragMove(ev: PointerEvent): void {
    const t = this.targetAt(ev.clientY);
    if (!t || !this.dragging || t.id === this.dragging) {
      this.dropLine.style.display = 'none';
      return;
    }
    this.dropLine.style.display = 'block';
    this.dropLine.style.top = `${Math.max(t.top, 1)}px`;
  }

  private dragEnd(ev: PointerEvent): void {
    const id = this.dragging;
    this.dragging = null;
    this.dropLine.style.display = 'none';
    const t = this.targetAt(ev.clientY);
    if (id && t && t.id !== id) this.hooks.onDrop(id, t.id);
  }

  /** Düzeni günceller: yeni paneler eklenir, gidenler silinir, konum/etiket değişirse yazılır. */
  public update(boxes: PaneBox[], leftInset: number, rightInset: number): void {
    this.boxes = boxes;
    const seen = new Set<PaneId>();
    for (const b of boxes) {
      seen.add(b.id);
      let el = this.els.get(b.id);
      if (!el) {
        el = this.build(b.id);
        this.els.set(b.id, el);
        this.root.appendChild(el);
      }
      el.style.top = `${b.top + 4}px`;
      if (b.id === 'main' || b.maximized) {
        // büyütülmüş pane başlığı sağa yaslanır: sol üstteki legend'in altında kalmasın
        el.style.right = `${rightInset + 8}px`;
        el.style.left = 'auto';
      } else {
        el.style.left = `${leftInset + 8}px`;
      }
      el.classList.toggle('maximized', b.maximized);
      // tek pane varken main düğmesi anlamsız; başka pane büyütülünce sıkışmış (<24px) panelerin başlığı gizlenir
      el.style.display = (b.id === 'main' && !b.showMax) || (b.height < 24 && !b.maximized) ? 'none' : '';
      const lbl = el.querySelector<HTMLElement>('.pane-label');
      if (lbl && lbl.textContent !== b.label) lbl.textContent = b.label;
      const vals = el.querySelector<HTMLElement>('.pane-values');
      if (vals) {
        const key = JSON.stringify(b.values ?? []);
        if (vals.dataset.key !== key) {
          vals.dataset.key = key;
          vals.replaceChildren(
            ...(b.values ?? []).map((v) => {
              const sp = document.createElement('span');
              sp.className = 'pane-value';
              sp.style.color = v.color;
              sp.textContent = v.text;
              return sp;
            })
          );
        }
      }
      const set = (act: PaneAction, disabled: boolean, hidden = false) => {
        const btn = el!.querySelector<HTMLButtonElement>(`[data-pane-act="${act}"]`);
        if (btn) {
          btn.disabled = disabled;
          btn.style.display = hidden ? 'none' : '';
        }
      };
      set('up', !b.canUp, b.id === 'main');
      set('down', !b.canDown, b.id === 'main');
      set('max', false, !b.showMax);
      set('menu', false);
      set('close', false, b.id === 'main');
      const maxBtn = el.querySelector<HTMLElement>('[data-pane-act="max"]');
      if (maxBtn) maxBtn.textContent = b.maximized ? '⤡' : '⤢';
    }
    for (const [id, el] of this.els) {
      if (!seen.has(id)) {
        el.remove();
        this.els.delete(id);
      }
    }
  }

  private build(id: PaneId): HTMLDivElement {
    const el = document.createElement('div');
    el.className = `pane-chrome pane-chrome-${id}`;
    el.dataset.pane = id;
    if (id !== 'main') {
      const grip = document.createElement('span');
      grip.className = 'pane-grip';
      grip.title = tt('Sürükleyerek sırala');
      grip.textContent = '⋮⋮';
      el.appendChild(grip);
      const lbl = document.createElement('span');
      lbl.className = 'pane-label';
      el.appendChild(lbl);
      const vals = document.createElement('span');
      vals.className = 'pane-values';
      el.appendChild(vals);
    }
    const btns = document.createElement('span');
    btns.className = 'pane-btns';
    for (const [act, glyph, title] of BTNS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'pane-btn';
      b.dataset.paneAct = act;
      b.title = title;
      b.textContent = glyph;
      btns.appendChild(b);
    }
    el.appendChild(btns);
    return el;
  }

  public destroy(): void {
    this.root.remove();
    this.els.clear();
    this.boxes = [];
  }
}
