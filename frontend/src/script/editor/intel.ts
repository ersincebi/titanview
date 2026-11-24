/**
 * Betik editörü dil servisleri — Monaco'dan bağımsız, saf fonksiyonlar (test edilebilir).
 * Tamamlama, imza yardımı, hover dokümanı, tanılama (hata işaretleri) ve kullanıcı sembolleri.
 */
import { LANG_ID } from '../brand';
import { tokenize } from '../lexer';
import { parse, ScriptParseError } from '../parser';
import { typeCheckProgram } from '../typecheck';
import { ScriptCompileError, ScriptRuntimeError } from '../values';
import {
  SCRIPT_KEYWORDS,
  SCRIPT_REFERENCE,
  SCRIPT_TYPES,
  lookupRef,
  namespaceMembers,
  rootNamespaces,
  type RefEntry,
  type RefKind,
} from './reference';

export type CompletionKind = RefKind | 'field' | 'enumMember' | 'user-function' | 'user-variable' | 'user-type';

export interface CompletionItem {
  label: string;
  kind: CompletionKind;
  detail: string;
  doc: string;
  /** Fonksiyonlarda `ad($0)` gibi yerleştirme ipucu. */
  insertText: string;
  snippet: boolean;
}

export interface UserSymbols {
  functions: Map<string, { params: string[]; line: number; text: string }>;
  variables: Map<string, { line: number; text: string }>;
  types: Map<string, { fields: string[]; line: number }>;
  enums: Map<string, { members: string[]; line: number }>;
  imports: Map<string, { path: string; line: number }>;
}

/** Kod satır/sütun (1 tabanlı) → karakter ofseti. */
export function offsetAt(code: string, line: number, column: number): number {
  let off = 0;
  for (let l = 1; l < line; l++) {
    const nl = code.indexOf('\n', off);
    if (nl < 0) return code.length;
    off = nl + 1;
  }
  return Math.min(code.length, off + column - 1);
}

/** Satır içi `//` yorumu ve metin dizgileri dışında mı? (basit tarama, tek satır). */
function stripStringsAndComments(line: string): string {
  let out = '';
  let q: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '\\') { out += '  '; i++; continue; }
      if (c === q) { q = null; out += c; continue; }
      out += ' ';
      continue;
    }
    if (c === '"' || c === "'") { q = c; out += c; continue; }
    if (c === '/' && line[i + 1] === '/') { out += ' '.repeat(line.length - i); break; }
    out += c;
  }
  return out;
}

/** Sözdizimi hatası olsa bile çalışan, regex tabanlı kullanıcı sembolü tarayıcı. */
export function scanUserSymbols(code: string): UserSymbols {
  const res: UserSymbols = { functions: new Map(), variables: new Map(), types: new Map(), enums: new Map(), imports: new Map() };
  const lines = code.split('\n');
  let block: { kind: 'type' | 'enum'; name: string } | null = null;
  lines.forEach((rawLine, idx) => {
    const lineNo = idx + 1;
    const line = stripStringsAndComments(rawLine);
    const indented = /^\s+\S/.test(line);
    if (block && indented) {
      const t = line.trim();
      if (block.kind === 'type') {
        const m = /^(?:[\w.]+(?:<[^>]*>)?\s+)?(\w+)\s*(?:=|$)/.exec(t);
        if (m) res.types.get(block.name)!.fields.push(m[1]);
      } else {
        const m = /^(\w+)/.exec(t);
        if (m) res.enums.get(block.name)!.members.push(m[1]);
      }
      return;
    }
    if (!indented) block = null;
    let m = /^\s*(?:export\s+)?type\s+(\w+)/.exec(line);
    if (m) { res.types.set(m[1], { fields: [], line: lineNo }); block = { kind: 'type', name: m[1] }; return; }
    m = /^\s*(?:export\s+)?enum\s+(\w+)/.exec(line);
    if (m) { res.enums.set(m[1], { members: [], line: lineNo }); block = { kind: 'enum', name: m[1] }; return; }
    m = /^\s*import\s+([\w/.]+)(?:\s+as\s+(\w+))?/.exec(line);
    if (m) {
      const alias = m[2] ?? m[1].split('/')[1] ?? m[1];
      res.imports.set(alias, { path: m[1], line: lineNo });
      return;
    }
    m = /^\s*(?:export\s+)?(?:method\s+)?(\w+)\s*\(([^)]*)\)\s*=>/.exec(line);
    if (m) {
      const params = m[2]
        .split(',')
        .map((p) => p.trim().split('=')[0].trim().split(/\s+/).pop() ?? '')
        .filter(Boolean);
      res.functions.set(m[1], { params, line: lineNo, text: rawLine.trim() });
      return;
    }
    // var/varip/niteleyici/tip önekli atama, tuple ayrıştırma, for sayacı
    const tuple = /^\s*\[([\w\s,]+)\]\s*=/.exec(line);
    if (tuple) {
      for (const n of tuple[1].split(',').map((s) => s.trim()).filter(Boolean)) {
        if (!res.variables.has(n)) res.variables.set(n, { line: lineNo, text: rawLine.trim() });
      }
      return;
    }
    const forM = /^\s*for\s+(?:\[(\w+)\s*,\s*(\w+)\]|(\w+))/.exec(line);
    if (forM) {
      for (const n of [forM[1], forM[2], forM[3]].filter(Boolean) as string[]) {
        if (!res.variables.has(n)) res.variables.set(n, { line: lineNo, text: rawLine.trim() });
      }
    }
    const asg = /^\s*(?:(?:var|varip|const|export|simple|series|input)\s+)*(?:[\w.]+(?:<[^>]*>)?\s+)?(\w+)\s*=(?!=)/.exec(line);
    if (asg && !SCRIPT_KEYWORDS.includes(asg[1])) {
      if (!res.variables.has(asg[1])) res.variables.set(asg[1], { line: lineNo, text: rawLine.trim() });
    }
  });
  return res;
}

const IDENT_CHAR = /[\w.]/;

/** Ofsetteki noktalı tanımlayıcı (`ta.sma`, `color.red`) ve aralığı. */
export function wordAt(code: string, offset: number): { word: string; start: number; end: number } | null {
  let s = offset;
  let e = offset;
  while (s > 0 && IDENT_CHAR.test(code[s - 1])) s--;
  while (e < code.length && /\w/.test(code[e])) e++;
  if (s === e) return null;
  let word = code.slice(s, e);
  while (word.startsWith('.')) { word = word.slice(1); s++; }
  return word ? { word, start: s, end: e } : null;
}

function refItem(label: string, e: RefEntry | undefined, fallbackKind: CompletionKind = 'namespace'): CompletionItem {
  if (!e) return { label, kind: fallbackKind, detail: 'isim alanı', doc: '', insertText: label, snippet: false };
  const isFn = e.kind === 'function';
  return {
    label,
    kind: e.kind,
    detail: e.signature,
    doc: e.doc,
    insertText: isFn ? `${label}($0)` : label,
    snippet: isFn,
  };
}

/** İmleç ofsetindeki tamamlama önerileri. */
export function completionsAt(code: string, offset: number): CompletionItem[] {
  const before = code.slice(0, offset);
  const lineStart = before.lastIndexOf('\n') + 1;
  const linePrefix = stripStringsAndComments(before.slice(lineStart));
  // yorum ya da kapanmamış metin içindeyse öneri yok
  const rawLine = before.slice(lineStart);
  if (rawLine.trim() && linePrefix.trimEnd().length < rawLine.trimEnd().length) return [];
  const sym = scanUserSymbols(code);
  const dotted = /([\w.]+)\.(\w*)$/.exec(linePrefix);
  if (dotted) {
    const ns = dotted[1];
    const out: CompletionItem[] = [];
    for (const { label, entry } of namespaceMembers(ns)) out.push(refItem(label, entry));
    const t = sym.types.get(ns);
    if (t) {
      out.push({ label: 'new', kind: 'function', detail: `${ns}.new(${t.fields.join(', ')}) → ${ns}`, doc: `${ns} nesnesi oluşturur.`, insertText: 'new($0)', snippet: true });
      out.push({ label: 'copy', kind: 'function', detail: `${ns}.copy(id) → ${ns}`, doc: 'Yüzeysel kopya.', insertText: 'copy($0)', snippet: true });
    }
    const en = sym.enums.get(ns);
    if (en) for (const m of en.members) out.push({ label: m, kind: 'enumMember', detail: `${ns}.${m}`, doc: `${ns} enum üyesi.`, insertText: m, snippet: false });
    // UDT tipli değişken → alanlar (`p = Point.new()` / `Point p = ...`)
    const v = sym.variables.get(ns);
    if (v) {
      for (const [tn, td] of sym.types) {
        if (new RegExp(`\\b${tn}\\.new\\b|^\\s*(?:var\\s+|varip\\s+)?${tn}\\s+${ns}\\b`).test(v.text)) {
          for (const f of td.fields) out.push({ label: f, kind: 'field', detail: `${tn}.${f}`, doc: `${tn} alanı.`, insertText: f, snippet: false });
        }
      }
    }
    return out;
  }
  const out: CompletionItem[] = [];
  const seen = new Set<string>();
  const add = (c: CompletionItem) => { if (!seen.has(c.label)) { seen.add(c.label); out.push(c); } };
  for (const [name, f] of sym.functions) add({ label: name, kind: 'user-function', detail: `${name}(${f.params.join(', ')})`, doc: `Satır ${f.line}: ${f.text}`, insertText: `${name}($0)`, snippet: true });
  for (const [name, v] of sym.variables) add({ label: name, kind: 'user-variable', detail: 'değişken', doc: `Satır ${v.line}: ${v.text}`, insertText: name, snippet: false });
  for (const [name] of sym.types) add({ label: name, kind: 'user-type', detail: 'type', doc: 'Kullanıcı tanımlı tip.', insertText: name, snippet: false });
  for (const [name] of sym.enums) add({ label: name, kind: 'user-type', detail: 'enum', doc: 'Kullanıcı tanımlı enum.', insertText: name, snippet: false });
  for (const [name, im] of sym.imports) add({ label: name, kind: 'namespace', detail: `import ${im.path}`, doc: 'Kütüphane takma adı.', insertText: name, snippet: false });
  for (const k of SCRIPT_KEYWORDS) add({ label: k, kind: 'keyword', detail: 'anahtar sözcük', doc: lookupRef(k)?.doc ?? '', insertText: k, snippet: false });
  for (const t of SCRIPT_TYPES) if (!t.includes('.')) add({ label: t, kind: 'type', detail: 'tip', doc: '', insertText: t, snippet: false });
  // fonksiyon/değişken önce: `plot`, `color`, `line` hem fonksiyon hem isim alanı
  for (const e of SCRIPT_REFERENCE) if (!e.name.includes('.') && (e.kind === 'function' || e.kind === 'variable')) add(refItem(e.name, e));
  for (const ns of rootNamespaces()) add(refItem(ns, undefined));
  return out;
}

export interface SignatureInfo {
  name: string;
  label: string;
  doc: string;
  params: string[];
  activeParam: number;
}

/** İmleç bir çağrının parantezi içindeyse imza ve etkin parametre. */
export function signatureAt(code: string, offset: number): SignatureInfo | null {
  let depth = 0;
  let commas = 0;
  let namedArg: string | null = null;
  let argStart = offset;
  // metin dizgilerini yok sayarak geriye tara (çok satırlı çağrılar dahil)
  const src = code.slice(0, offset);
  const masked = src.split('\n').map(stripStringsAndComments).join('\n');
  for (let i = masked.length - 1; i >= 0; i--) {
    const c = masked[i];
    if (c === ')' || c === ']') depth++;
    else if (c === '[' && depth > 0) depth--;
    else if (c === '(') {
      if (depth === 0) {
        const m = /([\w.]+)(?:<[^>]*>)?\s*$/.exec(masked.slice(0, i));
        if (!m) return null;
        const name = m[1];
        const cur = masked.slice(argStart, offset);
        const nm = /^\s*(\w+)\s*=(?!=)/.exec(cur);
        if (nm) namedArg = nm[1];
        return buildSig(name, commas, namedArg, code);
      }
      depth--;
    } else if (c === ',' && depth === 0) {
      if (commas === 0) argStart = i + 1;
      commas++;
    } else if (c === '[' && depth === 0) return null;
  }
  return null;
}

function buildSig(name: string, commas: number, namedArg: string | null, code: string): SignatureInfo | null {
  const e = lookupRef(name);
  if (e && e.kind === 'function') {
    const params = e.params.map((p) => p.name + (p.optional ? '?' : ''));
    let active = Math.min(commas, Math.max(0, params.length - 1));
    if (namedArg) {
      const idx = e.params.findIndex((p) => p.name === namedArg);
      if (idx >= 0) active = idx;
    }
    return { name, label: e.signature, doc: e.doc, params, activeParam: active };
  }
  const u = scanUserSymbols(code).functions.get(name);
  if (u) {
    let active = Math.min(commas, Math.max(0, u.params.length - 1));
    if (namedArg && u.params.includes(namedArg)) active = u.params.indexOf(namedArg);
    return { name, label: `${name}(${u.params.join(', ')})`, doc: `Satır ${u.line}`, params: u.params, activeParam: active };
  }
  return null;
}

/** Hover dokümanı (markdown). */
export function hoverAt(code: string, offset: number): { markdown: string; start: number; end: number } | null {
  const w = wordAt(code, offset);
  if (!w) return null;
  // imleç noktalı adın hangi parçasındaysa o parçaya kadar olan önek (`ta.sma` içinde `ta` → isim alanı)
  const dotAfter = w.word.indexOf('.', Math.max(0, offset - w.start));
  const name = dotAfter > 0 ? w.word.slice(0, dotAfter) : w.word;
  const e = lookupRef(name);
  if (e) {
    const kindTr: Record<RefKind, string> = { function: 'fonksiyon', variable: 'değişken', constant: 'sabit', keyword: 'anahtar sözcük', type: 'tip', namespace: 'isim alanı' };
    const md = ['```' + LANG_ID, e.signature, '```', `*${kindTr[e.kind]}* — ${e.doc}`];
    if (e.params.length) md.push('', ...e.params.map((p) => `- \`${p.name}\`${p.optional ? ' (isteğe bağlı)' : ''}`));
    return { markdown: md.join('\n'), start: w.start, end: w.start + name.length };
  }
  const sym = scanUserSymbols(code);
  const f = sym.functions.get(name);
  if (f) return { markdown: `\`\`\`${LANG_ID}\n${f.text}\n\`\`\`\n*kullanıcı fonksiyonu* — satır ${f.line}`, start: w.start, end: w.start + name.length };
  const t = sym.types.get(name);
  if (t) return { markdown: `\`\`\`${LANG_ID}\ntype ${name}\n\`\`\`\nAlanlar: ${t.fields.map((x) => `\`${x}\``).join(', ') || '—'}`, start: w.start, end: w.start + name.length };
  const en = sym.enums.get(name);
  if (en) return { markdown: `\`\`\`${LANG_ID}\nenum ${name}\n\`\`\`\nÜyeler: ${en.members.map((x) => `\`${x}\``).join(', ')}`, start: w.start, end: w.start + name.length };
  const v = sym.variables.get(name);
  if (v) return { markdown: `\`\`\`${LANG_ID}\n${v.text}\n\`\`\`\n*değişken* — satır ${v.line}`, start: w.start, end: w.start + name.length };
  if (rootNamespaces().includes(name)) return { markdown: `**${name}** isim alanı — \`${name}.\` yazarak üyeleri listeleyin.`, start: w.start, end: w.start + name.length };
  return null;
}

export interface Diagnostic {
  line: number;
  column: number;
  endColumn: number;
  message: string;
  severity: 'error' | 'warning';
  source: 'syntax' | 'compile' | 'runtime';
}

/** Mesajdaki `Satır N, Sütun M: ` / `Satır N: ` önekini ayıklar. */
export function splitLocation(message: string): { line: number; column: number; text: string } | null {
  const m = /^Satır (\d+)(?:, Sütun (\d+))?:\s*([\s\S]*)$/.exec(message);
  if (!m) return null;
  return { line: Number(m[1]), column: m[2] ? Number(m[2]) : 1, text: m[3] };
}

function lineSpan(code: string, line: number, column: number): { column: number; endColumn: number } {
  const text = code.split('\n')[line - 1] ?? '';
  if (column > 1) {
    const rest = text.slice(column - 1);
    const m = /^[\w.]+/.exec(rest);
    return { column, endColumn: column + Math.max(1, m ? m[0].length : 1) };
  }
  const first = text.search(/\S/);
  return { column: first < 0 ? 1 : first + 1, endColumn: Math.max(2, text.length + 1) };
}

/**
 * Derlemeden (mum verisi gerekmeden) sözdizimi + tip/niteleyici hatalarını bulur.
 * Çalışma zamanı hatası (`runtimeError`) verilirse o da işaretlenir.
 */
export function diagnose(code: string, runtimeError?: string | null): Diagnostic[] {
  const out: Diagnostic[] = [];
  if (code.trim()) {
    try {
      typeCheckProgram(parse(tokenize(code)));
    } catch (e) {
      if (e instanceof ScriptParseError) {
        out.push({ line: e.line, ...lineSpan(code, e.line, e.column), message: e.details, severity: 'error', source: 'syntax' });
      } else if (e instanceof ScriptCompileError) {
        const line = e.line > 0 ? e.line : 1;
        out.push({ line, ...lineSpan(code, line, 1), message: e.details, severity: 'error', source: 'compile' });
      } else if (e instanceof ScriptRuntimeError) {
        const line = e.line > 0 ? e.line : 1;
        out.push({ line, ...lineSpan(code, line, 1), message: e.message, severity: 'error', source: 'compile' });
      } else {
        out.push({ line: 1, column: 1, endColumn: 2, message: e instanceof Error ? e.message : String(e), severity: 'error', source: 'compile' });
      }
    }
  }
  if (runtimeError && out.length === 0) {
    const loc = splitLocation(runtimeError);
    if (loc) out.push({ line: loc.line, ...lineSpan(code, loc.line, loc.column), message: loc.text, severity: 'error', source: 'runtime' });
  }
  return out;
}
