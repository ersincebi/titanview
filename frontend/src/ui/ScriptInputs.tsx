import { tt } from '../state/i18n';
import { For, Show, type JSX } from 'solid-js';
import type { ScriptInputDef } from '../types/market';

/** TitanScript `input.*` denetimleri: editördeki betik (Workbench) ve grafikteki göstergenin ayar penceresi ortak kullanır. */

export const SCRIPT_SOURCES = ['close', 'open', 'high', 'low', 'hl2', 'hlc3', 'ohlc4', 'hlcc4', 'volume'];
export const SCRIPT_TFS = ['', '1', '3', '5', '15', '30', '60', '240', 'D', 'W', 'M'];

/** #rgb / #rrggbb / #rrggbbaa / rgb()/rgba() → { hex: #rrggbb, alpha: 0..1 } */
export function parseColor(v: unknown): { hex: string; alpha: number } {
  const s = String(v ?? '').trim();
  const h = s.match(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/);
  if (h) {
    let x = h[1];
    if (x.length === 3) x = x.split('').map((c) => c + c).join('');
    const alpha = x.length === 8 ? parseInt(x.slice(6), 16) / 255 : 1;
    return { hex: `#${x.slice(0, 6).toUpperCase()}`, alpha: Number(alpha.toFixed(3)) };
  }
  const r = s.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/i);
  if (r) {
    const hx = (n: string) => Math.max(0, Math.min(255, Number(n))).toString(16).padStart(2, '0');
    return { hex: `#${hx(r[1])}${hx(r[2])}${hx(r[3])}`.toUpperCase(), alpha: r[4] !== undefined ? Number(r[4]) : 1 };
  }
  return { hex: '#0284C7', alpha: 1 };
}

/** hex + opaklık → LWC'nin anladığı renk (tam opak: #rrggbb, değilse rgba). */
export function composeColor(hex: string, alpha: number): string {
  const { hex: h } = parseColor(hex);
  if (alpha >= 0.999) return h;
  const n = parseInt(h.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${Number(Math.max(0, alpha).toFixed(3))})`;
}

export function toHexColor(v: unknown): string {
  return parseColor(v).hex;
}

export function msToLocalInput(v: unknown): string {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return '';
  const d = new Date(n);
  const pad = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export interface InputGroup {
  name: string;
  rows: ScriptInputDef[][];
}

/** `group` başlıkları altında, aynı `inline` anahtarlı girdiler tek satırda. */
export function groupScriptInputs(list: ScriptInputDef[]): InputGroup[] {
  const groups: InputGroup[] = [];
  const gMap = new Map<string, InputGroup>();
  const inlineMap = new Map<string, ScriptInputDef[]>();
  for (const def of list) {
    const gName = def.group ?? '';
    let g = gMap.get(gName);
    if (!g) {
      g = { name: gName, rows: [] };
      gMap.set(gName, g);
      groups.push(g);
    }
    if (def.inline) {
      const key = `${gName}\0${def.inline}`;
      let row = inlineMap.get(key);
      if (!row) {
        row = [];
        inlineMap.set(key, row);
        g.rows.push(row);
      }
      row.push(def);
    } else {
      g.rows.push([def]);
    }
  }
  return groups;
}

export interface ScriptInputFieldProps {
  def: ScriptInputDef;
  value: unknown;
  onChange: (v: unknown) => void;
  /** `input.source` seçenekleri: [değer, etiket]; verilmezse yerleşik kaynaklar */
  sources?: Array<[string, string]>;
  /** input.time / input.price için grafikten seçim (🎯) */
  onPick?: (kind: 'time' | 'price') => void;
  /** veri özniteliği adı (test seçicileri): varsayılan `data-script-input` */
  attr?: string;
}

export function ScriptInputField(props: ScriptInputFieldProps): JSX.Element {
  const d = () => props.def;
  const key = () => d().id ?? d().title;
  const val = () => props.value;
  const disabled = () => d().active === false;
  const update = (v: unknown) => props.onChange(v);
  const sources = (): Array<[string, string]> => props.sources ?? SCRIPT_SOURCES.map((s) => [s, s]);
  const attrs = () => ({ [props.attr ?? 'data-script-input']: key() });

  return (
    <div class="script-inp-item" classList={{ disabled: disabled() }} {...attrs()}>
      <label class="script-inp-lbl">
        <span>{d().title}</span>
        <Show when={d().tooltip}>
          <span class="script-tip" title={d().tooltip}>ⓘ</span>
        </Show>
      </label>
      <div class="script-inp-ctrl">
        {d().type === 'bool' ? (
          <input type="checkbox" checked={Boolean(val())} disabled={disabled()} onChange={(e) => update(e.currentTarget.checked)} />
        ) : d().type === 'color' ? (
          <input type="color" class="script-inp-color" value={toHexColor(val())} disabled={disabled()} onInput={(e) => update(e.currentTarget.value)} />
        ) : d().type === 'text_area' ? (
          <textarea class="script-inp-textarea" rows={2} value={String(val() ?? '')} disabled={disabled()} onChange={(e) => update(e.currentTarget.value)} />
        ) : d().type === 'source' ? (
          <select class="script-select" value={String(val() ?? 'close')} disabled={disabled()} onChange={(e) => update(e.currentTarget.value)}>
            <For each={sources()}>{([v, l]) => <option value={v}>{l}</option>}</For>
          </select>
        ) : d().type === 'timeframe' ? (
          <select class="script-select" value={String(val() ?? '')} disabled={disabled()} onChange={(e) => update(e.currentTarget.value)}>
            <For each={SCRIPT_TFS.includes(String(val() ?? '')) ? SCRIPT_TFS : [...SCRIPT_TFS, String(val())]}>{(tf) => <option value={tf}>{tf || tt("Grafik")}</option>}</For>
          </select>
        ) : Array.isArray(d().options) && d().options!.length > 0 ? (
          <select
            class="script-select"
            value={String(val() ?? '')}
            disabled={disabled()}
            onChange={(e) => {
              const raw = e.currentTarget.value;
              update(d().type === 'int' || d().type === 'float' ? Number(raw) : raw);
            }}
          >
            <For each={d().options}>{(opt) => <option value={String(opt)}>{String(opt)}</option>}</For>
          </select>
        ) : d().type === 'int' || d().type === 'float' || d().type === 'price' ? (
          <>
            <input
              type="number"
              class="script-inp-field"
              min={d().min}
              max={d().max}
              step={d().step ?? (d().type === 'int' ? 1 : 0.1)}
              value={String(val() ?? '')}
              disabled={disabled()}
              onChange={(e) => {
                const n = Number(e.currentTarget.value);
                if (Number.isFinite(n)) update(n);
              }}
            />
            <Show when={d().type === 'price' && props.onPick}>
              <button class="btn-secondary script-pick-btn" data-pick-input={key()} title={tt("Grafikten fiyat seç")} disabled={disabled()} onClick={() => props.onPick?.('price')}>
                🎯
              </button>
            </Show>
          </>
        ) : d().type === 'time' ? (
          <>
            <input
              type="datetime-local"
              class="script-inp-field"
              value={msToLocalInput(val())}
              disabled={disabled()}
              onChange={(e) => {
                const t = Date.parse(e.currentTarget.value);
                if (Number.isFinite(t)) update(t);
              }}
            />
            <Show when={props.onPick}>
              <button class="btn-secondary script-pick-btn" data-pick-input={key()} title={tt("Grafikten zaman seç")} disabled={disabled()} onClick={() => props.onPick?.('time')}>
                🎯
              </button>
            </Show>
          </>
        ) : (
          <input type="text" class="script-inp-field" value={String(val() ?? '')} disabled={disabled()} onChange={(e) => update(e.currentTarget.value)} />
        )}
      </div>
    </div>
  );
}
