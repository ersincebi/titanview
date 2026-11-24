/**
 * TitanScript runtime value model.
 *   number | boolean | string | null (na) | ScriptArray | ScriptMap | ScriptMatrix |
 *   ScriptObject (UDT) | ScriptEnumValue | ScriptHandle | tuple (JS array)
 * `na` is NaN for numbers and `null` for every other type.
 */

export class ScriptRuntimeError extends Error {
  constructor(
    public readonly line: number,
    message: string
  ) {
    super(line > 0 ? `Satır ${line}: ${message}` : message);
    this.name = 'ScriptRuntimeError';
  }
}

export class ScriptCompileError extends Error {
  constructor(
    public readonly line: number,
    public readonly details: string
  ) {
    super(line > 0 ? `Satır ${line}: ${details}` : details);
    this.name = 'ScriptCompileError';
  }
}

export class ScriptArray {
  constructor(
    public items: any[] = [],
    public elemType?: string
  ) {}
}

export class ScriptMap {
  public items = new Map<any, any>();
  constructor(
    public keyType?: string,
    public valueType?: string
  ) {}
}

export class ScriptMatrix {
  public data: any[][];
  public cols: number;
  constructor(
    rows = 0,
    cols = 0,
    initVal: any = NaN,
    public elemType?: string
  ) {
    this.cols = cols;
    this.data = Array.from({ length: rows }, () => Array.from({ length: cols }, () => initVal));
  }
  get rows(): number {
    return this.data.length;
  }
}

export class ScriptObject {
  constructor(
    public readonly typeName: string,
    public readonly fields: Record<string, any>
  ) {}
  copy(): ScriptObject {
    return new ScriptObject(this.typeName, { ...this.fields });
  }
}

export class ScriptEnumValue {
  constructor(
    public readonly enumName: string,
    public readonly memberName: string,
    public readonly title: string
  ) {}
}

/** Drawing / table objects. */
export interface ScriptHandle {
  readonly kind: string;
  props: Record<string, any>;
  deleted: boolean;
}

export function makeHandle(kind: string, props: Record<string, any> = {}): ScriptHandle {
  return { kind, props, deleted: false };
}

export function isHandle(v: unknown): v is ScriptHandle {
  return typeof v === 'object' && v !== null && 'kind' in v && 'deleted' in v;
}

export function isNa(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === 'number' && Number.isNaN(v));
}

export function isTruthy(v: unknown): boolean {
  if (isNa(v)) return false;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  return Boolean(v);
}

export function toNum(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v === null || v === undefined) return NaN;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isNaN(n) ? NaN : n;
  }
  return NaN;
}

/** Deep-clone runtime values for var rollback snapshots (varip is NOT rolled back). */
export function snapshotValue(v: any, seen = new WeakMap<object, any>()): any {
  if (v === null || v === undefined || typeof v !== 'object') return v;
  if (v instanceof ScriptEnumValue) return v;
  if (seen.has(v)) return seen.get(v);
  if (v instanceof ScriptArray) {
    const c = new ScriptArray([], v.elemType);
    seen.set(v, c);
    c.items = v.items.map((x) => snapshotValue(x, seen));
    return c;
  }
  if (v instanceof ScriptMap) {
    const c = new ScriptMap(v.keyType, v.valueType);
    seen.set(v, c);
    for (const [k, val] of v.items) c.items.set(k, snapshotValue(val, seen));
    return c;
  }
  if (v instanceof ScriptMatrix) {
    const c = new ScriptMatrix(0, v.cols, NaN, v.elemType);
    seen.set(v, c);
    c.data = v.data.map((row) => row.map((x) => snapshotValue(x, seen)));
    return c;
  }
  if (v instanceof ScriptObject) {
    const fields: Record<string, any> = {};
    const c = new ScriptObject(v.typeName, fields);
    seen.set(v, c);
    for (const [k, val] of Object.entries(v.fields)) fields[k] = snapshotValue(val, seen);
    return c;
  }
  if (Array.isArray(v)) {
    const c: any[] = [];
    seen.set(v, c);
    for (let i = 0; i < v.length; i++) c[i] = snapshotValue(v[i], seen);
    return c;
  }
  return v;
}

// ---------------------------------------------------------------- colors

/** Built-in TitanScript color palette (`color.*`). */
export const SCRIPT_COLORS: Record<string, string> = {
  aqua: '#00BCD4',
  black: '#363A45',
  blue: '#0284C7',
  fuchsia: '#E040FB',
  gray: '#787B86',
  green: '#4CAF50',
  lime: '#00E676',
  maroon: '#880E4F',
  navy: '#311B92',
  olive: '#808000',
  orange: '#FF9800',
  purple: '#9C27B0',
  red: '#F23645',
  silver: '#B2B5BE',
  teal: '#089981',
  white: '#FFFFFF',
  yellow: '#FDD835',
};

function clamp255(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

export function parseColor(c: unknown): { r: number; g: number; b: number; a: number } | null {
  if (typeof c !== 'string') return null;
  const s = c.trim();
  const rgba = s.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i);
  if (rgba) {
    return { r: +rgba[1], g: +rgba[2], b: +rgba[3], a: rgba[4] === undefined ? 1 : +rgba[4] };
  }
  const hex = s.match(/^#([0-9a-f]{3,8})$/i);
  if (hex) {
    let h = hex[1];
    if (h.length === 3 || h.length === 4) h = h.split('').map((x) => x + x).join('');
    if (h.length === 6 || h.length === 8) {
      return {
        r: parseInt(h.slice(0, 2), 16),
        g: parseInt(h.slice(2, 4), 16),
        b: parseInt(h.slice(4, 6), 16),
        a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1,
      };
    }
  }
  return null;
}

/** color.new(base, transp 0..100) -> rgba() string. */
export function colorNew(base: unknown, transp: unknown): string | null {
  const p = parseColor(base);
  if (!p) return null;
  const t = isNa(transp) ? 0 : Math.max(0, Math.min(100, toNum(transp)));
  const a = Number(((1 - t / 100) * p.a).toFixed(3));
  return `rgba(${clamp255(p.r)}, ${clamp255(p.g)}, ${clamp255(p.b)}, ${a})`;
}

export function colorRgb(r: unknown, g: unknown, b: unknown, t: unknown): string {
  const a = isNa(t) ? 1 : 1 - Math.max(0, Math.min(100, toNum(t))) / 100;
  return `rgba(${clamp255(toNum(r))}, ${clamp255(toNum(g))}, ${clamp255(toNum(b))}, ${Number(a.toFixed(3))})`;
}

export function colorGradient(value: unknown, lo: unknown, hi: unknown, c1: unknown, c2: unknown): string | null {
  const v = toNum(value);
  const a = toNum(lo);
  const b = toNum(hi);
  const p1 = parseColor(c1);
  const p2 = parseColor(c2);
  if (!p1 || !p2 || Number.isNaN(v) || b === a) return null;
  const t = Math.max(0, Math.min(1, (v - a) / (b - a)));
  const mix = (x: number, y: number) => x + (y - x) * t;
  return `rgba(${clamp255(mix(p1.r, p2.r))}, ${clamp255(mix(p1.g, p2.g))}, ${clamp255(mix(p1.b, p2.b))}, ${Number(mix(p1.a, p2.a).toFixed(3))})`;
}

// ---------------------------------------------------------------- strings

export function tostring(v: unknown, fmt?: unknown, mintick?: number): string {
  if (isNa(v)) return 'NaN';
  if (v instanceof ScriptEnumValue) return v.title;
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'string') return v;
  if (typeof v === 'number') {
    if (typeof fmt === 'string') {
      const m = fmt.match(/^[#0]*\.?([#0]*)$/);
      if (m) {
        const dec = fmt.includes('.') ? (fmt.split('.')[1] ?? '').length : 0;
        const minDec = fmt.includes('.') ? ((fmt.split('.')[1] ?? '').match(/0/g) ?? []).length : 0;
        let out = v.toFixed(dec);
        if (dec > minDec && out.includes('.')) {
          out = out.replace(/0+$/, '');
          const decPart = out.split('.')[1] ?? '';
          if (decPart.length < minDec) out = Number(out).toFixed(minDec);
          if (out.endsWith('.')) out = out.slice(0, -1);
        }
        return out;
      }
      if ((fmt === 'format.mintick' || fmt === 'format.price') && mintick && mintick > 0) {
        // Varsayılan: değer mintick katına yuvarlanır, mintick'in ondalık sayısıyla sabit yazılır (BIST 0.01 → "1.70")
        const dec = (mintick.toFixed(10).replace(/0+$/, '').split('.')[1] ?? '').length;
        return (Math.round(v / mintick) * mintick).toFixed(dec);
      }
      if (fmt === 'format.percent') return `${(v * 100).toFixed(2)}%`;
      if (fmt === 'format.volume') return formatVolume(v);
    }
    if (Number.isInteger(v)) return String(v);
    return String(Number(v.toFixed(10)));
  }
  if (v instanceof ScriptArray) return `[${v.items.map((x) => tostring(x)).join(', ')}]`;
  if (v instanceof ScriptMatrix) {
    return v.data.map((row) => `[${row.map((x) => tostring(x)).join(', ')}]`).join('\n');
  }
  if (v instanceof ScriptMap) {
    const entries: string[] = [];
    for (const [k, val] of v.items) entries.push(`${tostring(k)}: ${tostring(val)}`);
    return `{${entries.join(', ')}}`;
  }
  if (v instanceof ScriptObject) {
    const entries = Object.entries(v.fields).map(([k, val]) => `${k}=${tostring(val)}`);
    return `${v.typeName}(${entries.join(', ')})`;
  }
  return String(v);
}

function formatVolume(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${(v / 1e3).toFixed(2)}K`;
  return v.toFixed(2);
}
