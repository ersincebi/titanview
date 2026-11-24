import type {
  EnumDefStmt,
  FunctionDefStmt,
  ImportStmt,
  Program,
  TypeDefStmt,
  VarAssignStmt,
} from './ast';
import { tokenize } from './lexer';
import { parse } from './parser';
import { ScriptCompileError } from './values';

export interface LibraryModule {
  path: string;
  alias: string;
  title: string;
  program: Program;
  exportedFunctions: Map<string, FunctionDefStmt>;
  exportedMethods: Map<string, FunctionDefStmt[]>;
  exportedTypes: Map<string, TypeDefStmt>;
  exportedEnums: Map<string, EnumDefStmt>;
  exportedConsts: Map<string, VarAssignStmt>;
  allFunctions: Map<string, FunctionDefStmt>;
  allMethods: Map<string, FunctionDefStmt[]>;
  allTypes: Map<string, TypeDefStmt>;
  allEnums: Map<string, EnumDefStmt>;
  allConsts: Map<string, VarAssignStmt>;
  imports: Map<string, LibraryModule>;
}

const VALID_LIB_TITLE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function isValidLibraryTitle(title: string): boolean {
  return VALID_LIB_TITLE.test(title);
}

/** Looks up library source by exact path `user/name/ver`, then `user/name`, `name/ver`, `name`. */
export function lookupLibrarySource(
  imp: ImportStmt,
  libraries?: Record<string, string>
): string | undefined {
  if (!libraries) return undefined;
  const candidates = [
    imp.path,
    `${imp.user}/${imp.name}/${imp.version}`,
    `${imp.user}/${imp.name}`,
    `${imp.name}/${imp.version}`,
    imp.name,
  ];
  for (const key of candidates) {
    if (key in libraries && typeof libraries[key] === 'string') return libraries[key];
  }
  const suffixWithVer = `/${imp.name}/${imp.version}`;
  const suffixNoVer = `/${imp.name}`;
  for (const [k, v] of Object.entries(libraries)) {
    if (k.endsWith(suffixWithVer) || k.endsWith(suffixNoVer)) return v;
  }
  return undefined;
}

/**
 * Resolves all `import` statements of `program` against the supplied local library registry,
 * recursively resolving transitive imports and checking for cycles.
 */
export function resolveProgramLibraries(
  program: Program,
  libraries?: Record<string, string>,
  visiting = new Set<string>()
): Map<string, LibraryModule> {
  const result = new Map<string, LibraryModule>();

  for (const stmt of program.statements) {
    if (stmt.type !== 'Import') continue;
    if (result.has(stmt.alias)) {
      throw new ScriptCompileError(stmt.loc.line, `Duplicate import alias '${stmt.alias}'.`);
    }
    if (visiting.has(stmt.path) || visiting.has(stmt.name)) {
      throw new ScriptCompileError(stmt.loc.line, `Circular library import detected: '${stmt.path}'.`);
    }
    const src = lookupLibrarySource(stmt, libraries);
    if (src === undefined) {
      throw new ScriptCompileError(
        stmt.loc.line,
        `Could not find library '${stmt.path}'. Save it with library("${stmt.name}") first.`
      );
    }

    let libProg: Program;
    try {
      libProg = parse(tokenize(src));
    } catch (e) {
      throw new ScriptCompileError(
        stmt.loc.line,
        `Failed to parse imported library '${stmt.path}': ${e instanceof Error ? e.message : String(e)}`
      );
    }

    const decl = libProg.statements.find((s) => s.type === 'Declaration');
    if (!decl || decl.type !== 'Declaration' || decl.kind !== 'library') {
      throw new ScriptCompileError(
        stmt.loc.line,
        `Imported script '${stmt.path}' is not a library (missing library() declaration).`
      );
    }
    if (!isValidLibraryTitle(decl.title)) {
      throw new ScriptCompileError(
        decl.loc.line,
        `Invalid library title '${decl.title}': must be a valid identifier.`
      );
    }

    const nextVisiting = new Set(visiting);
    nextVisiting.add(stmt.path);
    nextVisiting.add(stmt.name);
    const nestedImports = resolveProgramLibraries(libProg, libraries, nextVisiting);

    const mod: LibraryModule = {
      path: stmt.path,
      alias: stmt.alias,
      title: decl.title,
      program: libProg,
      exportedFunctions: new Map(),
      exportedMethods: new Map(),
      exportedTypes: new Map(),
      exportedEnums: new Map(),
      exportedConsts: new Map(),
      allFunctions: new Map(),
      allMethods: new Map(),
      allTypes: new Map(),
      allEnums: new Map(),
      allConsts: new Map(),
      imports: nestedImports,
    };

    for (const ls of libProg.statements) {
      if (ls.type === 'FunctionDef') {
        if (ls.isMethod) {
          const allList = mod.allMethods.get(ls.name) ?? [];
          allList.push(ls);
          mod.allMethods.set(ls.name, allList);
          if (ls.exported) {
            const expList = mod.exportedMethods.get(ls.name) ?? [];
            expList.push(ls);
            mod.exportedMethods.set(ls.name, expList);
          }
        } else {
          mod.allFunctions.set(ls.name, ls);
          if (ls.exported) mod.exportedFunctions.set(ls.name, ls);
        }
      } else if (ls.type === 'TypeDef') {
        mod.allTypes.set(ls.name, ls);
        if (ls.exported) mod.exportedTypes.set(ls.name, ls);
      } else if (ls.type === 'EnumDef') {
        mod.allEnums.set(ls.name, ls);
        if (ls.exported) mod.exportedEnums.set(ls.name, ls);
      } else if (ls.type === 'VarAssign' && !ls.isReassign) {
        mod.allConsts.set(ls.name, ls);
        if (ls.exported) mod.exportedConsts.set(ls.name, ls);
      }
    }

    result.set(stmt.alias, mod);
  }

  return result;
}

/** Builds a `RunOptions.libraries` map from saved `/api/scripts` records. */
export function buildLibraryRegistry(
  scripts: ReadonlyArray<{ name: string; code: string }>
): Record<string, string> {
  const reg: Record<string, string> = {};
  for (const sc of scripts) {
    if (!sc.code || !/\blibrary\s*\(/.test(sc.code)) continue;
    const m = sc.code.match(/\blibrary\s*\(\s*(?:title\s*=\s*)?["']([^"']+)["']/);
    const libName = m?.[1]?.trim();
    if (sc.name) reg[sc.name] = sc.code;
    if (libName) {
      reg[libName] = sc.code;
      reg[`local/${libName}/1`] = sc.code;
    }
  }
  return reg;
}

export interface ScriptRequestHints {
  hasImports: boolean;
  lowerTimeframes: string[];
  eventSymbols: string[];
  needsCurrentEvents: boolean;
  currencyPairs: Array<{ from: string; to: string }>;
}

export function scriptTimeframeToApi(tf: string): string | null {
  const raw = tf.trim();
  if (!raw) return null;
  if (raw === 'D' || raw === '1D' || raw === '1d') return '1d';
  if (raw === 'W' || raw === '1W' || raw === '1w') return '1w';
  if (raw === 'M' || raw === '1M') return '1M';
  // Pure numeric string in TitanScript = minutes (1..59, hour multiples 60..720, or 1440 = 1d)
  if (/^\d+$/.test(raw)) {
    const n = Number(raw);
    if (n <= 0 || n > 1440) return null;
    if (n === 1440) return '1d';
    if (n >= 60 && n % 60 === 0 && n <= 720) return `${n / 60}h`;
    if (n <= 59) return `${n}m`;
    return null;
  }
  const mM = /^(\d+)M$/.exec(raw);
  if (mM) {
    const n = Number(mM[1]);
    return n >= 1 && n <= 12 ? `${n}M` : null;
  }
  const mS = /^(\d+)[sS]$/.exec(raw);
  if (mS) {
    const n = Number(mS[1]);
    return n >= 1 && n <= 59 ? `${n}s` : null;
  }
  const mOther = /^(\d+)([mhdw])$/i.exec(raw);
  if (mOther) {
    const n = Number(mOther[1]);
    const u = mOther[2].toLowerCase();
    if (u === 'm' && n >= 1 && n <= 1439) return n >= 60 && n % 60 === 0 ? `${n / 60}h` : `${n}m`;
    if (u === 'h' && n >= 1 && n <= 23) return `${n}h`;
    if (u === 'd' && n >= 1 && n <= 365) return `${n}d`;
    if (u === 'w' && n >= 1 && n <= 52) return `${n}w`;
  }
  return null;
}

/** Lightweight static scanner for pre-fetching libraries, lower-TF bars, corporate events & FX rates. */
export function extractScriptRequests(code: string): ScriptRequestHints {
  const hasImports = /^\s*import\s+[A-Za-z_]\w*\s*\//m.test(code);
  const lowerTfs = new Set<string>();
  const eventSyms = new Set<string>();
  let needsCurrentEvents = false;
  const pairs = new Map<string, { from: string; to: string }>();

  // request.security_lower_tf(sym, "5", ...)
  const ltfRe = /request\.security_lower_tf\s*\(\s*[^,]+,\s*["']([^"']+)["']/g;
  for (const m of code.matchAll(ltfRe)) {
    if (m[1]) lowerTfs.add(m[1]);
  }

  // request.dividends / splits / earnings
  const evRe = /request\.(?:dividends|splits|earnings)\s*\(\s*([^,)]+)/g;
  for (const m of code.matchAll(evRe)) {
    const arg = (m[1] ?? '').trim();
    const strLit = arg.match(/^["']([^"']+)["']$/);
    if (strLit && strLit[1]) {
      const sym = strLit[1].includes(':') ? strLit[1].split(':').pop()! : strLit[1];
      eventSyms.add(sym);
    } else {
      needsCurrentEvents = true;
    }
  }

  // request.currency_rate("EUR", "USD") or currency.EUR
  const fxRe = /request\.currency_rate\s*\(\s*(?:["']([A-Za-z]+)["']|currency\.([A-Za-z]+))\s*,\s*(?:["']([A-Za-z]+)["']|currency\.([A-Za-z]+))/g;
  for (const m of code.matchAll(fxRe)) {
    const from = (m[1] ?? m[2] ?? '').toUpperCase();
    const to = (m[3] ?? m[4] ?? '').toUpperCase();
    if (from && to && from !== to) {
      pairs.set(`${from}/${to}`, { from, to });
    }
  }

  return {
    hasImports,
    lowerTimeframes: [...lowerTfs],
    eventSymbols: [...eventSyms],
    needsCurrentEvents,
    currencyPairs: [...pairs.values()],
  };
}
