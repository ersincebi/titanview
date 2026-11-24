/** Pure TitanScript library functions: math.*, str.*, array.*, map.*, matrix.*, time helpers. */
import { COLLECTION_NOT_HANDLED, mapCall, matrixCall } from './collections';
import {
  ScriptArray,
  ScriptRuntimeError,
  colorGradient,
  colorNew,
  colorRgb,
  isNa,
  makeHandle,
  toNum,
  tostring,
} from './values';

export const NOT_HANDLED = Symbol('not-handled');

const NA = NaN;

// ------------------------------------------------------------ time helpers

export function parseTimeframeSeconds(tf: unknown): number {
  if (typeof tf !== 'string' || tf === '') return NaN;
  const m = tf.trim().match(/^(\d*)([SMDWHsmdwh]?)$/);
  if (!m) return NaN;
  const n = m[1] === '' ? 1 : Number(m[1]);
  switch (m[2].toUpperCase()) {
    case '':
      return n * 60; // plain number = minutes
    case 'S':
      return n;
    case 'H':
      return n * 3600;
    case 'D':
      return n * 86400;
    case 'W':
      return n * 7 * 86400;
    case 'M':
      return n * 30 * 86400;
  }
  return NaN;
}

export function timeframeFromSeconds(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return 'D';
  if (sec < 60) return `${Math.round(sec)}S`;
  if (sec < 86400) return String(Math.round(sec / 60));
  if (sec < 7 * 86400) return sec === 86400 ? 'D' : `${Math.round(sec / 86400)}D`;
  if (sec < 28 * 86400) return sec === 7 * 86400 ? 'W' : `${Math.round(sec / (7 * 86400))}W`;
  return 'M';
}

export function parseTimestampArgs(a: any[]): number {
  if (typeof a[0] === 'string') {
    const t = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(a[0]) ? a[0] : `${a[0]}Z`);
    return Number.isNaN(t) ? NA : t;
  }
  // timestamp([tz,] y, m, d, h, mi, s)
  const nums = a.filter((x) => typeof x === 'number');
  const [y, mo, d, h = 0, mi = 0, s = 0] = nums;
  if ([y, mo, d].some((x) => x === undefined || Number.isNaN(x))) return NA;
  return Date.UTC(y, mo - 1, d, h, mi, s);
}

export function timeField(field: string, ms: number): number {
  const d = new Date(ms);
  switch (field) {
    case 'year':
      return d.getUTCFullYear();
    case 'month':
      return d.getUTCMonth() + 1;
    case 'dayofmonth':
      return d.getUTCDate();
    case 'dayofweek':
      return d.getUTCDay() + 1; // TitanScript: Sunday = 1
    case 'hour':
      return d.getUTCHours();
    case 'minute':
      return d.getUTCMinutes();
    case 'second':
      return d.getUTCSeconds();
    case 'weekofyear': {
      const start = Date.UTC(d.getUTCFullYear(), 0, 1);
      return Math.floor((ms - start) / (7 * 86_400_000)) + 1;
    }
  }
  return NA;
}

// ------------------------------------------------------------ math

function mathCall(fn: string, a: any[], mintick: number): any {
  const n = (i: number) => toNum(a[i]);
  switch (fn) {
    case 'abs':
      return Math.abs(n(0));
    case 'max': {
      let m = -Infinity;
      for (const v of a) {
        const x = toNum(v);
        if (Number.isNaN(x)) return NA;
        if (x > m) m = x;
      }
      return m;
    }
    case 'min': {
      let m = Infinity;
      for (const v of a) {
        const x = toNum(v);
        if (Number.isNaN(x)) return NA;
        if (x < m) m = x;
      }
      return m;
    }
    case 'avg': {
      if (!a.length) return NA;
      let s = 0;
      for (const v of a) s += toNum(v);
      return s / a.length;
    }
    case 'sqrt':
      return Math.sqrt(n(0));
    case 'pow':
      return Math.pow(n(0), n(1));
    case 'exp':
      return Math.exp(n(0));
    case 'log':
      return Math.log(n(0));
    case 'log10':
      return Math.log10(n(0));
    case 'floor':
      return Math.floor(n(0));
    case 'ceil':
      return Math.ceil(n(0));
    case 'round': {
      const x = n(0);
      if (a[1] === undefined) return Math.round(x);
      const f = 10 ** n(1);
      return Math.round(x * f) / f;
    }
    case 'round_to_mintick':
      return Math.round(n(0) / mintick) * mintick;
    case 'sign':
      return Math.sign(n(0));
    case 'sin':
      return Math.sin(n(0));
    case 'cos':
      return Math.cos(n(0));
    case 'tan':
      return Math.tan(n(0));
    case 'asin':
      return Math.asin(n(0));
    case 'acos':
      return Math.acos(n(0));
    case 'atan':
      return Math.atan(n(0));
    case 'todegrees':
      return (n(0) * 180) / Math.PI;
    case 'toradians':
      return (n(0) * Math.PI) / 180;
    case 'random':
      return Math.random();
  }
  return NOT_HANDLED;
}

// ------------------------------------------------------------ str & MessageFormat

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const DAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function parseTzOffsetMinutes(tz?: unknown): number | null {
  if (typeof tz !== 'string' || !tz.trim()) return 0;
  const s = tz.trim().toUpperCase();
  if (s === 'UTC' || s === 'GMT' || s === 'Z') return 0;
  const m = s.match(/^(?:UTC|GMT)?([+-])(\d{1,2})(?::?(\d{2}))?$/);
  if (m) {
    const sign = m[1] === '-' ? -1 : 1;
    return sign * (Number(m[2]) * 60 + Number(m[3] ?? '0'));
  }
  return null; // IANA timezone name
}

export function datePartsForTz(ms: number, tz?: unknown): {
  year: number; month: number; day: number; dow: number;
  hour: number; minute: number; second: number; milli: number; offsetMin: number; tzLabel: string;
} {
  const fixed = parseTzOffsetMinutes(tz);
  if (fixed !== null) {
    const d = new Date(ms + fixed * 60_000);
    const sign = fixed >= 0 ? '+' : '-';
    const abs = Math.abs(fixed);
    const tzLabel = fixed === 0 ? '+0000' : `${sign}${pad2(Math.floor(abs / 60))}${pad2(abs % 60)}`;
    return {
      year: d.getUTCFullYear(),
      month: d.getUTCMonth() + 1,
      day: d.getUTCDate(),
      dow: d.getUTCDay(),
      hour: d.getUTCHours(),
      minute: d.getUTCMinutes(),
      second: d.getUTCSeconds(),
      milli: d.getUTCMilliseconds(),
      offsetMin: fixed,
      tzLabel,
    };
  }
  // IANA timezone via Intl.DateTimeFormat
  try {
    const tzName = String(tz);
    const d = new Date(ms);
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: tzName,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
    const parts = Object.fromEntries(fmt.formatToParts(d).map((p) => [p.type, p.value]));
    const dow = Math.max(0, DAYS_SHORT.indexOf(parts.weekday ?? 'Sun'));
    const hourRaw = Number(parts.hour ?? '0');
    return {
      year: Number(parts.year),
      month: Number(parts.month),
      day: Number(parts.day),
      dow,
      hour: hourRaw === 24 ? 0 : hourRaw,
      minute: Number(parts.minute),
      second: Number(parts.second),
      milli: d.getUTCMilliseconds(),
      offsetMin: 0,
      tzLabel: tzName,
    };
  } catch {
    return datePartsForTz(ms, 'UTC');
  }
}

/** Formats a Unix-ms timestamp using TitanScript/Java SimpleDateFormat tokens. */
export function formatScriptDateTime(ms: number, pattern?: string, tz?: unknown): string {
  if (!Number.isFinite(ms)) return 'NaN';
  const pat = pattern && pattern.length > 0 ? pattern : "yyyy-MM-dd'T'HH:mm:ssZ";
  const p = datePartsForTz(ms, tz);
  let out = '';
  let i = 0;
  while (i < pat.length) {
    const ch = pat[i];
    if (ch === "'") {
      if (pat[i + 1] === "'") {
        out += "'";
        i += 2;
        continue;
      }
      i++;
      while (i < pat.length) {
        if (pat[i] === "'") {
          if (pat[i + 1] === "'") {
            out += "'";
            i += 2;
          } else {
            i++;
            break;
          }
        } else {
          out += pat[i++];
        }
      }
      continue;
    }
    let j = i;
    while (j < pat.length && pat[j] === ch) j++;
    const run = pat.slice(i, j);
    const len = run.length;
    switch (ch) {
      case 'y':
        out += len === 2 ? String(p.year).slice(-2) : String(p.year).padStart(len, '0');
        break;
      case 'M':
        if (len >= 4) out += MONTHS_LONG[p.month - 1];
        else if (len === 3) out += MONTHS_SHORT[p.month - 1];
        else if (len === 2) out += pad2(p.month);
        else out += String(p.month);
        break;
      case 'd':
        out += len >= 2 ? pad2(p.day) : String(p.day);
        break;
      case 'E':
        out += len >= 4 ? DAYS_LONG[p.dow] : DAYS_SHORT[p.dow];
        break;
      case 'H':
        out += len >= 2 ? pad2(p.hour) : String(p.hour);
        break;
      case 'h': {
        const h12 = p.hour % 12 || 12;
        out += len >= 2 ? pad2(h12) : String(h12);
        break;
      }
      case 'm':
        out += len >= 2 ? pad2(p.minute) : String(p.minute);
        break;
      case 's':
        out += len >= 2 ? pad2(p.second) : String(p.second);
        break;
      case 'S':
        out += String(p.milli).padStart(3, '0').slice(0, len);
        break;
      case 'a':
        out += p.hour < 12 ? 'AM' : 'PM';
        break;
      case 'z':
      case 'Z':
      case 'X':
        out += p.tzLabel;
        break;
      default:
        out += run;
    }
    i = j;
  }
  return out;
}

function groupThousands(intStr: string, groupSize: number): string {
  if (groupSize <= 0 || intStr.length <= groupSize) return intStr;
  let out = '';
  let count = 0;
  for (let i = intStr.length - 1; i >= 0; i--) {
    if (count > 0 && count % groupSize === 0) out = ',' + out;
    out = intStr[i] + out;
    count++;
  }
  return out;
}

/** Formats a number using a Java/TitanScript DecimalFormat subpattern (supports positive;negative, #, 0, ',', %, prefix/suffix). */
function formatDecimalPattern(val: number, pattern: string): string {
  if (!Number.isFinite(val)) return 'NaN';
  const parts = pattern.split(';');
  const isNeg = val < 0;
  const sub = isNeg && parts.length > 1 ? parts[1] : parts[0];
  const explicitNegSub = isNeg && parts.length > 1;

  // Locate numeric body: first [0#.,] through last [0#.,]
  let bodyStart = -1;
  let bodyEnd = -1;
  for (let i = 0; i < sub.length; i++) {
    const c = sub[i];
    if (c === '0' || c === '#' || c === '.' || c === ',') {
      if (bodyStart < 0) bodyStart = i;
      bodyEnd = i;
    }
  }
  if (bodyStart < 0) return sub;

  const prefix = sub.slice(0, bodyStart).replace(/'([^']*)'/g, '$1');
  const body = sub.slice(bodyStart, bodyEnd + 1);
  const suffix = sub.slice(bodyEnd + 1).replace(/'([^']*)'/g, '$1');

  let mult = 1;
  if (prefix.includes('%') || suffix.includes('%')) mult = 100;
  else if (prefix.includes('‰') || suffix.includes('‰')) mult = 1000;

  const dotIdx = body.indexOf('.');
  const intPat = dotIdx >= 0 ? body.slice(0, dotIdx) : body;
  const fracPat = dotIdx >= 0 ? body.slice(dotIdx + 1) : '';

  const hasGroup = intPat.includes(',');
  const groupSize = hasGroup ? intPat.length - intPat.lastIndexOf(',') - 1 : 0;
  const minIntDigits = Math.max(0, (intPat.match(/0/g) ?? []).length);
  const minFracDigits = (fracPat.match(/0/g) ?? []).length;
  const maxFracDigits = (fracPat.match(/[0#]/g) ?? []).length;

  const scaled = Math.abs(val * mult);
  const factor = 10 ** maxFracDigits;
  // Half-up rounding (matches Java DecimalFormat)
  const rounded = Math.round((scaled + Number.EPSILON * scaled * 4) * factor) / factor;

  const fixed = rounded.toFixed(maxFracDigits);
  let [intStr, fracStr = ''] = fixed.split('.');

  if (minIntDigits === 0 && intStr === '0' && fracStr.length > 0 && maxFracDigits > 0) {
    // Pattern like `.00` or `#.##`: keep `0` before `.` unless pattern has no `#`/`0` before `.`
    if (intPat === '') intStr = '';
  }
  if (intStr.length < minIntDigits) {
    intStr = intStr.padStart(minIntDigits, '0');
  }
  if (hasGroup) {
    intStr = groupThousands(intStr, groupSize || 3);
  }
  while (fracStr.length > minFracDigits && fracStr.endsWith('0')) {
    fracStr = fracStr.slice(0, -1);
  }

  const numOut = fracStr.length > 0 ? `${intStr}.${fracStr}` : intStr;
  const sign = isNeg && !explicitNegSub && rounded !== 0 ? '-' : '';
  return `${sign}${prefix}${numOut}${suffix}`;
}

function formatMessageArg(val: any, type: string | undefined, style: string | undefined, mintick: number): string {
  if (isNa(val)) return 'NaN';
  if (!type) {
    if (typeof val === 'number') {
      return formatDecimalPattern(val, '#,###.###');
    }
    return tostring(val, undefined, mintick);
  }
  const t = type.trim().toLowerCase();
  const st = style?.trim();
  if (t === 'number') {
    const n = toNum(val);
    if (Number.isNaN(n)) return 'NaN';
    if (!st) return formatDecimalPattern(n, '#,###.###');
    if (st === 'integer') return formatDecimalPattern(Math.round(n), '#,##0');
    if (st === 'percent') return formatDecimalPattern(n, '#,##0%');
    if (st === 'currency') return formatDecimalPattern(n, '$#,##0.00');
    return formatDecimalPattern(n, st);
  }
  if (t === 'date') {
    const ms = toNum(val);
    if (Number.isNaN(ms)) return 'NaN';
    const preset: Record<string, string> = {
      short: 'M/d/yy',
      medium: 'MMM d, yyyy',
      long: 'MMMM d, yyyy',
      full: 'EEEE, MMMM d, yyyy',
    };
    return formatScriptDateTime(ms, st ? (preset[st] ?? st) : 'MMM d, yyyy', 'UTC');
  }
  if (t === 'time') {
    const ms = toNum(val);
    if (Number.isNaN(ms)) return 'NaN';
    const preset: Record<string, string> = {
      short: 'HH:mm',
      medium: 'HH:mm:ss',
      long: 'HH:mm:ss Z',
      full: 'HH:mm:ss Z',
    };
    return formatScriptDateTime(ms, st ? (preset[st] ?? st) : 'HH:mm:ss', 'UTC');
  }
  return tostring(val, undefined, mintick);
}

/** TitanScript `str.format` / `log.*` MessageFormat engine. */
export function formatString(template: string, args: any[], mintick = 0.01): string {
  let out = '';
  let i = 0;
  while (i < template.length) {
    const ch = template[i];
    if (ch === "'") {
      if (template[i + 1] === "'") {
        out += "'";
        i += 2;
        continue;
      }
      // Single-quoted literal block
      i++;
      while (i < template.length) {
        if (template[i] === "'") {
          if (template[i + 1] === "'") {
            out += "'";
            i += 2;
          } else {
            i++;
            break;
          }
        } else {
          out += template[i++];
        }
      }
      continue;
    }
    if (ch === '{') {
      const end = template.indexOf('}', i + 1);
      if (end > i) {
        const spec = template.slice(i + 1, end);
        const c1 = spec.indexOf(',');
        const idxStr = c1 >= 0 ? spec.slice(0, c1).trim() : spec.trim();
        const idx = Number(idxStr);
        if (Number.isInteger(idx) && idx >= 0 && idx < args.length) {
          let fmtType: string | undefined;
          let fmtStyle: string | undefined;
          if (c1 >= 0) {
            const rest = spec.slice(c1 + 1);
            const c2 = rest.indexOf(',');
            if (c2 >= 0) {
              fmtType = rest.slice(0, c2);
              fmtStyle = rest.slice(c2 + 1);
            } else {
              fmtType = rest;
            }
          }
          out += formatMessageArg(args[idx], fmtType, fmtStyle, mintick);
          i = end + 1;
          continue;
        }
      }
    }
    out += ch;
    i++;
  }
  return out;
}

function strCall(fn: string, a: any[], mintick: number, line: number): any {
  const s = (i: number) => (isNa(a[i]) ? '' : String(a[i]));
  switch (fn) {
    case 'tostring':
      return tostring(a[0], a[1], mintick);
    case 'tonumber': {
      const x = Number(a[0]);
      return Number.isNaN(x) || a[0] === '' ? NA : x;
    }
    case 'length':
      return s(0).length;
    case 'upper':
      return s(0).toUpperCase();
    case 'lower':
      return s(0).toLowerCase();
    case 'contains':
      return s(0).includes(s(1));
    case 'startswith':
      return s(0).startsWith(s(1));
    case 'endswith':
      return s(0).endsWith(s(1));
    case 'replace': {
      const src = s(0);
      const target = s(1);
      const repl = s(2);
      const occ = a[3] === undefined || isNa(a[3]) ? 0 : Math.trunc(toNum(a[3]));
      if (target === '' || occ < 0) return src;
      let pos = -1;
      let from = 0;
      for (let k = 0; k <= occ; k++) {
        pos = src.indexOf(target, from);
        if (pos < 0) return src;
        from = pos + target.length;
      }
      return src.slice(0, pos) + repl + src.slice(pos + target.length);
    }
    case 'replace_all':
      return s(0).split(s(1)).join(s(2));
    case 'substring':
      return s(0).substring(toNum(a[1]), a[2] === undefined ? undefined : toNum(a[2]));
    case 'trim':
      return s(0).trim();
    case 'repeat':
      return s(0).repeat(Math.max(0, toNum(a[1])));
    case 'pos':
      return s(0).indexOf(s(1));
    case 'split':
      return new ScriptArray(s(0).split(s(1)));
    case 'match': {
      if (isNa(a[0]) || isNa(a[1])) return null;
      const src = String(a[0]);
      const pattern = String(a[1]);
      let re: RegExp;
      try {
        re = new RegExp(pattern);
      } catch (e) {
        throw new ScriptRuntimeError(
          line,
          `str.match: geçersiz düzenli ifade '${pattern}' (${e instanceof Error ? e.message : String(e)}).`
        );
      }
      const m = re.exec(src);
      return m ? m[0] : null;
    }
    case 'format':
      return formatString(s(0), a.slice(1), mintick);
    case 'format_time':
      return formatScriptDateTime(
        toNum(a[0]),
        a[1] === undefined || isNa(a[1]) ? undefined : String(a[1]),
        a[2] === undefined || isNa(a[2]) ? 'UTC' : String(a[2])
      );
  }
  return NOT_HANDLED;
}

// ------------------------------------------------------------ array

function arr(v: any, fn: string, line: number): ScriptArray {
  if (!(v instanceof ScriptArray)) throw new ScriptRuntimeError(line, `array.${fn}: ilk argüman bir dizi olmalı.`);
  return v;
}

function arrayCall(fn: string, a: any[], line: number, typeArgs?: string[]): any {
  if (fn.startsWith('new')) {
    if (fn === 'new' || fn.startsWith('new_')) {
      const elemType = fn === 'new' ? typeArgs?.[0] : fn.slice(4);
      const size = a[0] === undefined || isNa(a[0]) ? 0 : toNum(a[0]);
      if (!Number.isInteger(size) || size < 0) {
        throw new ScriptRuntimeError(line, `array.${fn}: geçersiz boyut (${size}).`);
      }
      const def =
        a[1] !== undefined
          ? a[1]
          : elemType === 'bool'
            ? false
            : elemType === 'float' || elemType === 'int' || !elemType
              ? NA
              : null;
      return new ScriptArray(Array.from({ length: size }, () => def), elemType);
    }
  }
  if (fn === 'from') return new ScriptArray([...a]);
  if (fn === 'copy' && isNa(a[0])) return null;
  const A = arr(a[0], fn, line);
  const items = A.items;
  const idx = (i: number, allowEnd = false) => {
    let k = toNum(i);
    if (Number.isInteger(k) && k < 0) k = items.length + k;
    const limit = allowEnd ? items.length : items.length - 1;
    if (!Number.isInteger(k) || k < 0 || k > limit) {
      throw new ScriptRuntimeError(line, `array.${fn}: indeks ${i} sınır dışı (boyut ${items.length}).`);
    }
    return k;
  };
  switch (fn) {
    case 'push':
      items.push(a[1]);
      return null;
    case 'pop':
      if (!items.length) throw new ScriptRuntimeError(line, 'array.pop: dizi boş.');
      return items.pop();
    case 'shift':
      if (!items.length) throw new ScriptRuntimeError(line, 'array.shift: dizi boş.');
      return items.shift();
    case 'unshift':
      items.unshift(a[1]);
      return null;
    case 'get':
      return items[idx(a[1])];
    case 'set':
      items[idx(a[1])] = a[2];
      return null;
    case 'insert':
      items.splice(idx(a[1], true), 0, a[2]);
      return null;
    case 'remove': {
      const k = idx(a[1]);
      return items.splice(k, 1)[0];
    }
    case 'size':
      return items.length;
    case 'clear':
      items.length = 0;
      return null;
    case 'first':
      if (!items.length) throw new ScriptRuntimeError(line, 'array.first: dizi boş.');
      return items[0];
    case 'last':
      if (!items.length) throw new ScriptRuntimeError(line, 'array.last: dizi boş.');
      return items[items.length - 1];
    case 'includes':
      return items.includes(a[1]);
    case 'indexof':
      return items.indexOf(a[1]);
    case 'copy':
      return new ScriptArray([...items], A.elemType);
    case 'concat':
      items.push(...arr(a[1], fn, line).items);
      return A;
    case 'reverse':
      items.reverse();
      return null;
    case 'sort':
      items.sort((x, y) => (a[1] === 'order.descending' ? toNum(y) - toNum(x) : toNum(x) - toNum(y)));
      return null;
    case 'fill':
      items.fill(a[1]);
      return null;
    case 'join':
      return items.map((x) => tostring(x)).join(a[1] === undefined ? ',' : String(a[1]));
    case 'slice':
      return new ScriptArray(items.slice(toNum(a[1]), toNum(a[2])));
    case 'sum':
      return items.reduce((s, x) => s + toNum(x), 0);
    case 'avg':
      return items.length ? items.reduce((s, x) => s + toNum(x), 0) / items.length : NA;
    case 'min':
      return items.length ? Math.min(...items.map(toNum)) : NA;
    case 'max':
      return items.length ? Math.max(...items.map(toNum)) : NA;
    case 'median': {
      if (!items.length) return NA;
      const s = items.map(toNum).sort((x, y) => x - y);
      const m = Math.floor(s.length / 2);
      return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
    }
    case 'stdev': {
      if (!items.length) return NA;
      const v = items.map(toNum);
      const mean = v.reduce((s, x) => s + x, 0) / v.length;
      return Math.sqrt(v.reduce((s, x) => s + (x - mean) ** 2, 0) / v.length);
    }
    case 'abs':
      return new ScriptArray(items.map((x) => Math.abs(toNum(x))));
  }
  return NOT_HANDLED;
}

// ------------------------------------------------------------ dispatch

/** Library functions that need no VM state. `a` = positional args after named-arg binding. */
export function libCall(name: string, a: any[], line: number, mintick: number, typeArgs?: string[]): any {
  const dot = name.indexOf('.');
  if (dot < 0) return NOT_HANDLED;
  const ns = name.slice(0, dot);
  const fn = name.slice(dot + 1);
  switch (ns) {
    case 'math':
      return mathCall(fn, a, mintick);
    case 'str':
      return strCall(fn, a, mintick, line);
    case 'array':
      return arrayCall(fn, a, line, typeArgs);
    case 'map': {
      const r = mapCall(fn, a, line, typeArgs);
      return r === COLLECTION_NOT_HANDLED ? NOT_HANDLED : r;
    }
    case 'matrix': {
      const r = matrixCall(fn, a, line, typeArgs);
      return r === COLLECTION_NOT_HANDLED ? NOT_HANDLED : r;
    }
    case 'color':
      switch (fn) {
        case 'new':
          return colorNew(a[0], a[1]);
        case 'rgb':
          return colorRgb(a[0], a[1], a[2], a[3]);
        case 'from_gradient':
          return colorGradient(a[0], a[1], a[2], a[3], a[4]);
      }
      return NOT_HANDLED;
    case 'timeframe':
      switch (fn) {
        case 'in_seconds':
          return parseTimeframeSeconds(a[0]);
      }
      return NOT_HANDLED;
  }
  return NOT_HANDLED;
}

export function genericHandle(kind: string, props: Record<string, any>): any {
  return makeHandle(kind, props);
}

/**
 * Betik seans dizesi ("0930-1600", "2200-0200:23456", "0000-0900,1300-1700") içinde mi?
 * `dow0` 0=Pazar; Betik gün rakamları 1=Pazar … 7=Cumartesi. Gece yarısını aşan aralıklar desteklenir.
 */
export function inSession(session: string, minuteOfDay: number, dow0: number): boolean {
  for (const part of session.split(',')) {
    const m = part.trim().match(/^(\d{2})(\d{2})-(\d{2})(\d{2})(?::(\d+))?$/);
    if (!m) continue;
    const start = Number(m[1]) * 60 + Number(m[2]);
    const end = Number(m[3]) * 60 + Number(m[4]);
    const days = m[5];
    // gece yarısını aşan seansta erken kısmı önceki günün seansıdır
    const sessionDow = start > end && minuteOfDay < end ? (dow0 + 6) % 7 : dow0;
    if (days && !days.includes(String(sessionDow + 1))) continue;
    if (start === end) return true; // 24 saat
    if (start < end ? minuteOfDay >= start && minuteOfDay < end : minuteOfDay >= start || minuteOfDay < end) return true;
  }
  return false;
}

/**
 * Takvim kovası: ay tabanlı zaman dilimleri (M, 3M, 12M) yıl·12+ay / n, haftalık Pazartesi başlangıçlı,
 * diğerleri saniye/aralık. `timeframe.change` ve HTF toplama aynı kovayı kullanır.
 */
export function calendarBucket(timeSec: number, tfSec: number): number {
  if (tfSec >= 28 * 86400) {
    const months = Math.max(1, Math.round(tfSec / (30 * 86400)));
    const d = new Date(timeSec * 1000);
    return Math.floor((d.getUTCFullYear() * 12 + d.getUTCMonth()) / months);
  }
  if (tfSec >= 7 * 86400) {
    const weeks = Math.max(1, Math.round(tfSec / (7 * 86400)));
    return Math.floor(Math.floor((timeSec / 86400 + 3) / 7) / weeks);
  }
  return Math.floor(timeSec / tfSec);
}
