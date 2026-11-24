/**
 * Compile-time type & qualifier checker for TitanScript.
 *
 * Enforces the TitanScript qualifier hierarchy (`const < input < simple < series`),
 * UDT / enum / method / varip / for...in compile-time rules, and resolves
 * overloaded user-defined methods for the VM.
 */
import {
  dottedNameOf,
  type CallArg,
  type DeclarationStmt,
  type EnumDefStmt,
  type Expression,
  type FunctionCall,
  type FunctionDefStmt,
  type Program,
  type Qualifier,
  type Statement,
  type TypeDefStmt,
  type TypeRef,
} from './ast';
import { MAP_SIGS, MATRIX_SIGS } from './collections';
import { isValidLibraryTitle, resolveProgramLibraries, type LibraryModule } from './libraries';
import { TA_SIGS } from './ta';
import { SCRIPT_COLORS, ScriptCompileError } from './values';

// ---------------------------------------------------------------- types

export interface ScriptType {
  qual: Qualifier;
  base: string;
  typeArgs?: ScriptType[];
}

export interface ResolvedLibFn {
  mod: LibraryModule;
  fn: FunctionDefStmt;
}

export interface TypeCheckResult {
  types: Map<string, TypeDefStmt>;
  enums: Map<string, EnumDefStmt>;
  methods: Map<string, FunctionDefStmt[]>;
  libraries: Map<string, LibraryModule>;
  exprTypes: WeakMap<Expression, ScriptType>;
  resolvedCalls: WeakMap<FunctionCall, FunctionDefStmt>;
  resolvedLibFns: WeakMap<FunctionCall, ResolvedLibFn>;
  fnReturnTypes: WeakMap<FunctionDefStmt, ScriptType>;
}

const QUAL_RANK: Record<Qualifier, number> = {
  const: 0,
  input: 1,
  simple: 2,
  series: 3,
};

const PRIMITIVE_TYPES = new Set(['int', 'float', 'bool', 'string', 'color']);
const DRAWING_TYPES = new Set(['line', 'box', 'label', 'table', 'linefill', 'polyline']);
const COLLECTION_TYPES = new Set(['array', 'matrix', 'map']);
const CHART_POINT_FIELDS: Record<string, string> = { time: 'int', index: 'int', price: 'float' };

const BUILTIN_NAMESPACES = new Set([
  'ta', 'math', 'str', 'array', 'map', 'matrix', 'color', 'input',
  'strategy', 'syminfo', 'barstate', 'timeframe', 'request', 'ticker',
  'line', 'box', 'label', 'table', 'linefill', 'polyline',
  'plot', 'hline', 'shape', 'location', 'size', 'display', 'extend',
  'xloc', 'yloc', 'format', 'barmerge', 'alert', 'order', 'text',
  'position', 'dayofweek', 'chart', 'runtime', 'log',
  'dividends', 'splits', 'earnings', 'currency',
]);

function pt(qual: Qualifier, base: string, typeArgs?: ScriptType[]): ScriptType {
  return typeArgs ? { qual, base, typeArgs } : { qual, base };
}

function maxQual(a: Qualifier, b: Qualifier): Qualifier {
  return QUAL_RANK[a] >= QUAL_RANK[b] ? a : b;
}

function qualFits(actual: Qualifier, expected: Qualifier): boolean {
  return QUAL_RANK[actual] <= QUAL_RANK[expected];
}

export function formatType(t: ScriptType): string {
  const baseStr =
    t.typeArgs && t.typeArgs.length > 0
      ? `${t.base}<${t.typeArgs.map((a) => formatBase(a)).join(', ')}>`
      : t.base;
  if (t.base === 'na' || t.base === 'void' || t.base === 'any' || COLLECTION_TYPES.has(t.base)) {
    return baseStr;
  }
  return `${t.qual} ${baseStr}`;
}

function formatBase(t: ScriptType): string {
  return t.typeArgs && t.typeArgs.length > 0
    ? `${t.base}<${t.typeArgs.map(formatBase).join(', ')}>`
    : t.base;
}

function exprSnippet(e: Expression): string {
  switch (e.type) {
    case 'Identifier':
      return e.name;
    case 'NumberLiteral':
      return String(e.value);
    case 'StringLiteral':
      return e.isColorHex ? e.value : `"${e.value}"`;
    case 'BooleanLiteral':
      return String(e.value);
    case 'MemberAccess':
      return `${exprSnippet(e.object)}.${e.property}`;
    case 'FunctionCall':
      return `${e.callee || exprSnippet(e.calleeExpr)}(...)`;
    case 'IndexAccess':
      return `${exprSnippet(e.target)}[${exprSnippet(e.index)}]`;
    case 'UnaryExpr':
      return `${e.operator}${e.operator === 'not' ? ' ' : ''}${exprSnippet(e.argument)}`;
    case 'BinaryExpr':
      return `${exprSnippet(e.left)} ${e.operator} ${exprSnippet(e.right)}`;
    case 'TernaryExpr':
      return `${exprSnippet(e.condition)} ? ... : ...`;
    default:
      return 'expr';
  }
}

// ---------------------------------------------------------------- built-in env

interface ParamSpec {
  name: string;
  qual?: Qualifier;
  base?: string;
}

const SIMPLE_VARS: Record<string, string> = {
  'syminfo.tickerid': 'string',
  'syminfo.ticker': 'string',
  'syminfo.root': 'string',
  'syminfo.prefix': 'string',
  'syminfo.mintick': 'float',
  'syminfo.pointvalue': 'float',
  'syminfo.currency': 'string',
  'syminfo.type': 'string',
  'syminfo.timezone': 'string',
  'timeframe.period': 'string',
  'timeframe.multiplier': 'int',
  'timeframe.isintraday': 'bool',
  'timeframe.isminutes': 'bool',
  'timeframe.isseconds': 'bool',
  'timeframe.isdaily': 'bool',
  'timeframe.isweekly': 'bool',
  'timeframe.ismonthly': 'bool',
  'timeframe.isdwm': 'bool',
  'chart.bg_color': 'color',
  'chart.fg_color': 'color',
  'strategy.initial_capital': 'float',
  'strategy.account_currency': 'string',
};

const SERIES_VARS: Record<string, string> = {
  open: 'float',
  high: 'float',
  low: 'float',
  close: 'float',
  volume: 'float',
  hl2: 'float',
  hlc3: 'float',
  ohlc4: 'float',
  hlcc4: 'float',
  time: 'int',
  time_close: 'int',
  timenow: 'int',
  bar_index: 'int',
  last_bar_index: 'int',
  last_bar_time: 'int',
  year: 'int',
  month: 'int',
  dayofmonth: 'int',
  dayofweek: 'int',
  hour: 'int',
  minute: 'int',
  second: 'int',
  weekofyear: 'int',
  'ta.tr': 'float',
  'ta.obv': 'float',
  'ta.pvt': 'float',
  'ta.accdist': 'float',
  'ta.iii': 'float',
  'ta.nvi': 'float',
  'ta.pvi': 'float',
  'ta.wad': 'float',
  'ta.wvad': 'float',
  'barstate.isfirst': 'bool',
  'barstate.islast': 'bool',
  'barstate.isconfirmed': 'bool',
  'barstate.ishistory': 'bool',
  'barstate.isrealtime': 'bool',
  'barstate.isnew': 'bool',
  'barstate.islastconfirmedhistory': 'bool',
  'strategy.position_size': 'float',
  'strategy.equity': 'float',
  'strategy.netprofit': 'float',
  'strategy.position_avg_price': 'float',
  'strategy.openprofit': 'float',
  'strategy.grossprofit': 'float',
  'strategy.grossloss': 'float',
  'strategy.closedtrades': 'int',
  'strategy.opentrades': 'int',
  'strategy.wintrades': 'int',
  'strategy.losstrades': 'int',
  'strategy.max_drawdown': 'float',
};

const CONST_VARS: Record<string, string> = {
  'math.pi': 'float',
  'math.e': 'float',
  'math.phi': 'float',
  'math.rphi': 'float',
  'barmerge.lookahead_on': 'bool',
  'barmerge.lookahead_off': 'bool',
  'barmerge.gaps_on': 'bool',
  'barmerge.gaps_off': 'bool',
  'display.none': 'int',
  'display.pane': 'int',
  'display.data_window': 'int',
  'display.status_line': 'int',
  'display.price_scale': 'int',
  'display.all': 'int',
  'dayofweek.sunday': 'int',
  'dayofweek.monday': 'int',
  'dayofweek.tuesday': 'int',
  'dayofweek.wednesday': 'int',
  'dayofweek.thursday': 'int',
  'dayofweek.friday': 'int',
  'dayofweek.saturday': 'int',
};

for (const name of Object.keys(SCRIPT_COLORS)) CONST_VARS[`color.${name}`] = 'color';

const DECL_SPECS: Record<string, ParamSpec[]> = {
  indicator: [
    { name: 'title', qual: 'const', base: 'string' },
    { name: 'shorttitle', qual: 'const', base: 'string' },
    { name: 'overlay', qual: 'const', base: 'bool' },
    { name: 'format', qual: 'const', base: 'string' },
    { name: 'precision', qual: 'const', base: 'int' },
    { name: 'max_bars_back', qual: 'const', base: 'int' },
    { name: 'max_lines_count', qual: 'const', base: 'int' },
    { name: 'max_labels_count', qual: 'const', base: 'int' },
    { name: 'max_boxes_count', qual: 'const', base: 'int' },
    { name: 'max_polylines_count', qual: 'const', base: 'int' },
    { name: 'dynamic_requests', qual: 'const', base: 'bool' },
  ],
  strategy: [
    { name: 'title', qual: 'const', base: 'string' },
    { name: 'shorttitle', qual: 'const', base: 'string' },
    { name: 'overlay', qual: 'const', base: 'bool' },
    { name: 'pyramiding', qual: 'const', base: 'int' },
    { name: 'initial_capital', qual: 'const', base: 'float' },
    { name: 'commission_value', qual: 'const', base: 'float' },
    { name: 'default_qty_value', qual: 'const', base: 'float' },
    { name: 'process_orders_on_close', qual: 'const', base: 'bool' },
    { name: 'calc_on_every_tick', qual: 'const', base: 'bool' },
    { name: 'max_lines_count', qual: 'const', base: 'int' },
    { name: 'max_labels_count', qual: 'const', base: 'int' },
    { name: 'max_boxes_count', qual: 'const', base: 'int' },
    { name: 'max_polylines_count', qual: 'const', base: 'int' },
    { name: 'dynamic_requests', qual: 'const', base: 'bool' },
  ],
  library: [
    { name: 'title', qual: 'const', base: 'string' },
    { name: 'overlay', qual: 'const', base: 'bool' },
    { name: 'dynamic_requests', qual: 'const', base: 'bool' },
  ],
};

const BUILTIN_SPECS: Record<string, { params: ParamSpec[]; ret: (args: ScriptType[]) => ScriptType }> = {
  'ta.ema': {
    params: [
      { name: 'source', qual: 'series', base: 'float' },
      { name: 'length', qual: 'simple', base: 'int' },
    ],
    ret: () => pt('series', 'float'),
  },
  'ta.rma': {
    params: [
      { name: 'source', qual: 'series', base: 'float' },
      { name: 'length', qual: 'simple', base: 'int' },
    ],
    ret: () => pt('series', 'float'),
  },
  'ta.rsi': {
    params: [
      { name: 'source', qual: 'series', base: 'float' },
      { name: 'length', qual: 'simple', base: 'int' },
    ],
    ret: () => pt('series', 'float'),
  },
  'ta.atr': {
    params: [{ name: 'length', qual: 'simple', base: 'int' }],
    ret: () => pt('series', 'float'),
  },
  'ta.dmi': {
    params: [
      { name: 'diLength', qual: 'simple', base: 'int' },
      { name: 'adxSmoothing', qual: 'simple', base: 'int' },
    ],
    ret: () => pt('series', 'tuple', [pt('series', 'float'), pt('series', 'float'), pt('series', 'float')]),
  },
  'ta.supertrend': {
    params: [
      { name: 'factor', qual: 'simple', base: 'float' },
      { name: 'atrPeriod', qual: 'simple', base: 'int' },
    ],
    ret: () => pt('series', 'tuple', [pt('series', 'float'), pt('series', 'float')]),
  },
  'ta.macd': {
    params: [
      { name: 'source', qual: 'series', base: 'float' },
      { name: 'fastlen', qual: 'simple', base: 'int' },
      { name: 'slowlen', qual: 'simple', base: 'int' },
      { name: 'siglen', qual: 'simple', base: 'int' },
    ],
    ret: () => pt('series', 'tuple', [pt('series', 'float'), pt('series', 'float'), pt('series', 'float')]),
  },
  'ta.bb': {
    params: [
      { name: 'series', qual: 'series', base: 'float' },
      { name: 'length', qual: 'simple', base: 'int' },
      { name: 'mult', qual: 'simple', base: 'float' },
    ],
    ret: () => pt('series', 'tuple', [pt('series', 'float'), pt('series', 'float'), pt('series', 'float')]),
  },
  'ta.kc': {
    params: [
      { name: 'series', qual: 'series', base: 'float' },
      { name: 'length', qual: 'simple', base: 'int' },
      { name: 'mult', qual: 'simple', base: 'float' },
    ],
    ret: () => pt('series', 'tuple', [pt('series', 'float'), pt('series', 'float'), pt('series', 'float')]),
  },
  plot: {
    params: [
      { name: 'series', qual: 'series', base: 'float' },
      { name: 'title', qual: 'const', base: 'string' },
      { name: 'color', qual: 'series', base: 'color' },
      { name: 'linewidth', qual: 'input', base: 'int' },
      { name: 'style', qual: 'input', base: 'string' },
      { name: 'trackprice', qual: 'input', base: 'bool' },
      { name: 'histbase', qual: 'input', base: 'float' },
      { name: 'offset', qual: 'simple', base: 'int' },
      { name: 'join', qual: 'input', base: 'bool' },
      { name: 'editable', qual: 'const', base: 'bool' },
      { name: 'show_last', qual: 'input', base: 'int' },
      { name: 'display', qual: 'input', base: 'int' },
    ],
    ret: () => pt('series', 'plot'),
  },
  hline: {
    params: [
      { name: 'price', qual: 'input', base: 'float' },
      { name: 'title', qual: 'const', base: 'string' },
      { name: 'color', qual: 'input', base: 'color' },
      { name: 'linestyle', qual: 'input', base: 'string' },
      { name: 'linewidth', qual: 'input', base: 'int' },
      { name: 'editable', qual: 'const', base: 'bool' },
    ],
    ret: () => pt('series', 'hline'),
  },
  plotshape: {
    params: [
      { name: 'series', qual: 'series', base: 'any' },
      { name: 'title', qual: 'const', base: 'string' },
      { name: 'style', qual: 'input', base: 'string' },
      { name: 'location', qual: 'input', base: 'string' },
      { name: 'color', qual: 'series', base: 'color' },
      { name: 'offset', qual: 'simple', base: 'int' },
      { name: 'text', qual: 'const', base: 'string' },
      { name: 'textcolor', qual: 'series', base: 'color' },
      { name: 'editable', qual: 'const', base: 'bool' },
      { name: 'size', qual: 'input', base: 'string' },
    ],
    ret: () => pt('series', 'void'),
  },
  'input.int': {
    params: [
      { name: 'defval', qual: 'const', base: 'int' },
      { name: 'title', qual: 'const', base: 'string' },
      { name: 'minval', qual: 'const', base: 'int' },
      { name: 'maxval', qual: 'const', base: 'int' },
      { name: 'step', qual: 'const', base: 'int' },
      { name: 'tooltip', qual: 'const', base: 'string' },
      { name: 'inline', qual: 'const', base: 'string' },
      { name: 'group', qual: 'const', base: 'string' },
      { name: 'confirm', qual: 'const', base: 'bool' },
      { name: 'display', qual: 'const', base: 'int' },
      { name: 'active', qual: 'input', base: 'bool' },
      { name: 'options', qual: 'const', base: 'any' },
    ],
    ret: () => pt('input', 'int'),
  },
  'input.float': {
    params: [
      { name: 'defval', qual: 'const', base: 'float' },
      { name: 'title', qual: 'const', base: 'string' },
      { name: 'minval', qual: 'const', base: 'float' },
      { name: 'maxval', qual: 'const', base: 'float' },
      { name: 'step', qual: 'const', base: 'float' },
      { name: 'tooltip', qual: 'const', base: 'string' },
      { name: 'inline', qual: 'const', base: 'string' },
      { name: 'group', qual: 'const', base: 'string' },
      { name: 'confirm', qual: 'const', base: 'bool' },
      { name: 'display', qual: 'const', base: 'int' },
      { name: 'active', qual: 'input', base: 'bool' },
      { name: 'options', qual: 'const', base: 'any' },
    ],
    ret: () => pt('input', 'float'),
  },
  'input.bool': {
    params: [
      { name: 'defval', qual: 'const', base: 'bool' },
      { name: 'title', qual: 'const', base: 'string' },
      { name: 'tooltip', qual: 'const', base: 'string' },
      { name: 'inline', qual: 'const', base: 'string' },
      { name: 'group', qual: 'const', base: 'string' },
      { name: 'confirm', qual: 'const', base: 'bool' },
      { name: 'display', qual: 'const', base: 'int' },
      { name: 'active', qual: 'input', base: 'bool' },
    ],
    ret: () => pt('input', 'bool'),
  },
  'input.string': {
    params: [
      { name: 'defval', qual: 'const', base: 'string' },
      { name: 'title', qual: 'const', base: 'string' },
      { name: 'options', qual: 'const', base: 'any' },
      { name: 'tooltip', qual: 'const', base: 'string' },
      { name: 'inline', qual: 'const', base: 'string' },
      { name: 'group', qual: 'const', base: 'string' },
      { name: 'confirm', qual: 'const', base: 'bool' },
      { name: 'display', qual: 'const', base: 'int' },
      { name: 'active', qual: 'input', base: 'bool' },
    ],
    ret: () => pt('input', 'string'),
  },
  'input.timeframe': {
    params: [
      { name: 'defval', qual: 'const', base: 'string' },
      { name: 'title', qual: 'const', base: 'string' },
      { name: 'options', qual: 'const', base: 'any' },
      { name: 'tooltip', qual: 'const', base: 'string' },
      { name: 'inline', qual: 'const', base: 'string' },
      { name: 'group', qual: 'const', base: 'string' },
      { name: 'confirm', qual: 'const', base: 'bool' },
      { name: 'display', qual: 'const', base: 'int' },
      { name: 'active', qual: 'input', base: 'bool' },
    ],
    ret: () => pt('input', 'string'),
  },
  'input.symbol': {
    params: [
      { name: 'defval', qual: 'const', base: 'string' },
      { name: 'title', qual: 'const', base: 'string' },
      { name: 'tooltip', qual: 'const', base: 'string' },
      { name: 'inline', qual: 'const', base: 'string' },
      { name: 'group', qual: 'const', base: 'string' },
      { name: 'confirm', qual: 'const', base: 'bool' },
      { name: 'display', qual: 'const', base: 'int' },
      { name: 'active', qual: 'input', base: 'bool' },
    ],
    ret: () => pt('input', 'string'),
  },
  'input.color': {
    params: [
      { name: 'defval', qual: 'const', base: 'color' },
      { name: 'title', qual: 'const', base: 'string' },
      { name: 'tooltip', qual: 'const', base: 'string' },
      { name: 'inline', qual: 'const', base: 'string' },
      { name: 'group', qual: 'const', base: 'string' },
      { name: 'confirm', qual: 'const', base: 'bool' },
      { name: 'display', qual: 'const', base: 'int' },
      { name: 'active', qual: 'input', base: 'bool' },
    ],
    ret: () => pt('input', 'color'),
  },
  'input.source': {
    params: [
      { name: 'defval', qual: 'series', base: 'float' },
      { name: 'title', qual: 'const', base: 'string' },
      { name: 'tooltip', qual: 'const', base: 'string' },
      { name: 'inline', qual: 'const', base: 'string' },
      { name: 'group', qual: 'const', base: 'string' },
      { name: 'display', qual: 'const', base: 'int' },
      { name: 'active', qual: 'input', base: 'bool' },
    ],
    ret: () => pt('series', 'float'),
  },
  'input.time': {
    params: [
      { name: 'defval', qual: 'const', base: 'int' },
      { name: 'title', qual: 'const', base: 'string' },
      { name: 'tooltip', qual: 'const', base: 'string' },
      { name: 'inline', qual: 'const', base: 'string' },
      { name: 'group', qual: 'const', base: 'string' },
      { name: 'confirm', qual: 'const', base: 'bool' },
      { name: 'display', qual: 'const', base: 'int' },
      { name: 'active', qual: 'input', base: 'bool' },
    ],
    ret: () => pt('input', 'int'),
  },
  'input.price': {
    params: [
      { name: 'defval', qual: 'const', base: 'float' },
      { name: 'title', qual: 'const', base: 'string' },
      { name: 'tooltip', qual: 'const', base: 'string' },
      { name: 'inline', qual: 'const', base: 'string' },
      { name: 'group', qual: 'const', base: 'string' },
      { name: 'confirm', qual: 'const', base: 'bool' },
      { name: 'display', qual: 'const', base: 'int' },
      { name: 'active', qual: 'input', base: 'bool' },
    ],
    ret: () => pt('input', 'float'),
  },
  'input.session': {
    params: [
      { name: 'defval', qual: 'const', base: 'string' },
      { name: 'title', qual: 'const', base: 'string' },
      { name: 'options', qual: 'const', base: 'any' },
      { name: 'tooltip', qual: 'const', base: 'string' },
      { name: 'inline', qual: 'const', base: 'string' },
      { name: 'group', qual: 'const', base: 'string' },
      { name: 'confirm', qual: 'const', base: 'bool' },
      { name: 'display', qual: 'const', base: 'int' },
      { name: 'active', qual: 'input', base: 'bool' },
    ],
    ret: () => pt('input', 'string'),
  },
  'input.text_area': {
    params: [
      { name: 'defval', qual: 'const', base: 'string' },
      { name: 'title', qual: 'const', base: 'string' },
      { name: 'tooltip', qual: 'const', base: 'string' },
      { name: 'group', qual: 'const', base: 'string' },
      { name: 'display', qual: 'const', base: 'int' },
      { name: 'active', qual: 'input', base: 'bool' },
    ],
    ret: () => pt('input', 'string'),
  },
  'request.security': {
    params: [
      { name: 'symbol', qual: 'simple', base: 'string' },
      { name: 'timeframe', qual: 'simple', base: 'string' },
      { name: 'expression', qual: 'series', base: 'any' },
      { name: 'gaps', qual: 'const', base: 'bool' },
      { name: 'lookahead', qual: 'const', base: 'bool' },
    ],
    ret: (args) => (args[2] ? pt('series', args[2].base, args[2].typeArgs) : pt('series', 'any')),
  },
  'request.security_lower_tf': {
    params: [
      { name: 'symbol', qual: 'simple', base: 'string' },
      { name: 'timeframe', qual: 'simple', base: 'string' },
      { name: 'expression', qual: 'series', base: 'any' },
      { name: 'ignore_invalid_symbol', qual: 'input', base: 'bool' },
      { name: 'currency', qual: 'simple', base: 'string' },
      { name: 'ignore_invalid_timeframe', qual: 'input', base: 'bool' },
      { name: 'calc_bars_count', qual: 'input', base: 'int' },
    ],
    ret: (args) => {
      const exprT = args[2];
      if (exprT?.base === 'tuple' && exprT.typeArgs) {
        return pt(
          'series',
          'tuple',
          exprT.typeArgs.map((e) => pt('series', 'array', [e]))
        );
      }
      return pt('series', 'array', [exprT ?? pt('series', 'any')]);
    },
  },
  'request.dividends': {
    params: [
      { name: 'ticker', qual: 'simple', base: 'string' },
      { name: 'field', qual: 'simple', base: 'string' },
      { name: 'gaps', qual: 'simple', base: 'bool' },
      { name: 'lookahead', qual: 'simple', base: 'bool' },
      { name: 'ignore_invalid_symbol', qual: 'input', base: 'bool' },
      { name: 'currency', qual: 'simple', base: 'string' },
    ],
    ret: () => pt('series', 'float'),
  },
  'request.splits': {
    params: [
      { name: 'ticker', qual: 'simple', base: 'string' },
      { name: 'field', qual: 'simple', base: 'string' },
      { name: 'gaps', qual: 'simple', base: 'bool' },
      { name: 'lookahead', qual: 'simple', base: 'bool' },
      { name: 'ignore_invalid_symbol', qual: 'input', base: 'bool' },
    ],
    ret: () => pt('series', 'float'),
  },
  'request.earnings': {
    params: [
      { name: 'ticker', qual: 'simple', base: 'string' },
      { name: 'field', qual: 'simple', base: 'string' },
      { name: 'gaps', qual: 'simple', base: 'bool' },
      { name: 'lookahead', qual: 'simple', base: 'bool' },
      { name: 'ignore_invalid_symbol', qual: 'input', base: 'bool' },
      { name: 'currency', qual: 'simple', base: 'string' },
    ],
    ret: () => pt('series', 'float'),
  },
  'request.currency_rate': {
    params: [
      { name: 'from', qual: 'simple', base: 'string' },
      { name: 'to', qual: 'simple', base: 'string' },
      { name: 'ignore_invalid_currency', qual: 'input', base: 'bool' },
    ],
    ret: () => pt('series', 'float'),
  },
  'ta.alma': {
    params: [
      { name: 'series', qual: 'series', base: 'float' },
      { name: 'length', qual: 'series', base: 'int' },
      { name: 'offset', qual: 'simple', base: 'float' },
      { name: 'sigma', qual: 'simple', base: 'float' },
      { name: 'floor', qual: 'simple', base: 'bool' },
    ],
    ret: () => pt('series', 'float'),
  },
  'ta.tsi': {
    params: [
      { name: 'source', qual: 'series', base: 'float' },
      { name: 'short_length', qual: 'simple', base: 'int' },
      { name: 'long_length', qual: 'simple', base: 'int' },
    ],
    ret: () => pt('series', 'float'),
  },
  'ta.wpr': {
    params: [{ name: 'length', qual: 'simple', base: 'int' }],
    ret: () => pt('series', 'float'),
  },
  'ta.kcw': {
    params: [
      { name: 'series', qual: 'series', base: 'float' },
      { name: 'length', qual: 'simple', base: 'int' },
      { name: 'mult', qual: 'simple', base: 'float' },
      { name: 'useTrueRange', qual: 'simple', base: 'bool' },
    ],
    ret: () => pt('series', 'float'),
  },
  'ta.sar': {
    params: [
      { name: 'start', qual: 'simple', base: 'float' },
      { name: 'inc', qual: 'simple', base: 'float' },
      { name: 'max', qual: 'simple', base: 'float' },
    ],
    ret: () => pt('series', 'float'),
  },
  'ta.cog': {
    params: [
      { name: 'source', qual: 'series', base: 'float' },
      { name: 'length', qual: 'simple', base: 'int' },
    ],
    ret: () => pt('series', 'float'),
  },
  'ta.percentrank': {
    params: [
      { name: 'source', qual: 'series', base: 'float' },
      { name: 'length', qual: 'series', base: 'int' },
    ],
    ret: () => pt('series', 'float'),
  },
  'ta.percentile_linear_interpolation': {
    params: [
      { name: 'source', qual: 'series', base: 'float' },
      { name: 'length', qual: 'simple', base: 'int' },
      { name: 'percentage', qual: 'simple', base: 'float' },
    ],
    ret: () => pt('series', 'float'),
  },
  'ta.percentile_nearest_rank': {
    params: [
      { name: 'source', qual: 'series', base: 'float' },
      { name: 'length', qual: 'simple', base: 'int' },
      { name: 'percentage', qual: 'simple', base: 'float' },
    ],
    ret: () => pt('series', 'float'),
  },
  'ta.correlation': {
    params: [
      { name: 'source1', qual: 'series', base: 'float' },
      { name: 'source2', qual: 'series', base: 'float' },
      { name: 'length', qual: 'simple', base: 'int' },
    ],
    ret: () => pt('series', 'float'),
  },
  'ta.mode': {
    params: [
      { name: 'source', qual: 'series', base: 'float' },
      { name: 'length', qual: 'simple', base: 'int' },
    ],
    ret: () => pt('series', 'float'),
  },
  'ta.rci': {
    params: [
      { name: 'source', qual: 'series', base: 'float' },
      { name: 'length', qual: 'simple', base: 'int' },
    ],
    ret: () => pt('series', 'float'),
  },
  'ta.pivot_point_levels': {
    params: [
      { name: 'type', qual: 'series', base: 'string' },
      { name: 'anchor', qual: 'series', base: 'any' },
      { name: 'developing', qual: 'series', base: 'bool' },
    ],
    ret: () => pt('series', 'array', [pt('series', 'float')]),
  },
  'chart.point.new': {
    params: [
      { name: 'time', qual: 'series', base: 'int' },
      { name: 'index', qual: 'series', base: 'int' },
      { name: 'price', qual: 'series', base: 'float' },
    ],
    ret: () => pt('series', 'chart.point'),
  },
  'chart.point.from_index': {
    params: [
      { name: 'index', qual: 'series', base: 'int' },
      { name: 'price', qual: 'series', base: 'float' },
    ],
    ret: () => pt('series', 'chart.point'),
  },
  'chart.point.from_time': {
    params: [
      { name: 'time', qual: 'series', base: 'int' },
      { name: 'price', qual: 'series', base: 'float' },
    ],
    ret: () => pt('series', 'chart.point'),
  },
  'chart.point.now': {
    params: [{ name: 'price', qual: 'series', base: 'float' }],
    ret: () => pt('series', 'chart.point'),
  },
  'chart.point.copy': {
    params: [{ name: 'id', qual: 'series', base: 'chart.point' }],
    ret: () => pt('series', 'chart.point'),
  },
  'linefill.new': {
    params: [
      { name: 'line1', qual: 'series', base: 'line' },
      { name: 'line2', qual: 'series', base: 'line' },
      { name: 'color', qual: 'series', base: 'color' },
    ],
    ret: () => pt('series', 'linefill'),
  },
  'linefill.delete': {
    params: [{ name: 'id', qual: 'series', base: 'linefill' }],
    ret: () => pt('series', 'void'),
  },
  'linefill.set_color': {
    params: [
      { name: 'id', qual: 'series', base: 'linefill' },
      { name: 'color', qual: 'series', base: 'color' },
    ],
    ret: () => pt('series', 'void'),
  },
  'linefill.get_line1': {
    params: [{ name: 'id', qual: 'series', base: 'linefill' }],
    ret: () => pt('series', 'line'),
  },
  'linefill.get_line2': {
    params: [{ name: 'id', qual: 'series', base: 'linefill' }],
    ret: () => pt('series', 'line'),
  },
};

// ---------------------------------------------------------------- scope & checker

interface VarBinding {
  type: ScriptType;
  explicitQual?: Qualifier;
  explicitType?: boolean;
  isVar: boolean;
  isVarip: boolean;
}

class TypeScope {
  vars = new Map<string, VarBinding>();
  constructor(readonly parent: TypeScope | null) {}
  lookup(name: string): VarBinding | undefined {
    let s: TypeScope | null = this;
    while (s) {
      const b = s.vars.get(name);
      if (b) return b;
      s = s.parent;
    }
    return undefined;
  }
}

class ScriptTypeChecker {
  readonly types = new Map<string, TypeDefStmt>();
  readonly enums = new Map<string, EnumDefStmt>();
  readonly functions = new Map<string, FunctionDefStmt>();
  readonly methods = new Map<string, FunctionDefStmt[]>();
  readonly libraries = new Map<string, LibraryModule>();
  readonly libChecks = new Map<string, TypeCheckResult>();
  readonly importedMethods = new Map<string, Array<{ mod: LibraryModule; fn: FunctionDefStmt; recvType: ScriptType }>>();
  readonly exprTypes = new WeakMap<Expression, ScriptType>();
  readonly resolvedCalls = new WeakMap<FunctionCall, FunctionDefStmt>();
  readonly resolvedLibFns = new WeakMap<FunctionCall, ResolvedLibFn>();
  readonly fnReturnTypes = new WeakMap<FunctionDefStmt, ScriptType>();

  private topScope = new TypeScope(null);
  private version = 5;
  private isLibrary = false;
  private inFunction = false;
  private inLoop = false;
  private callDepth = 0;
  private changed = false;
  private strictPass = false;

  constructor(
    private readonly program: Program,
    private readonly rawLibraries?: Record<string, string>,
    private readonly preResolvedLibs?: Map<string, LibraryModule>
  ) {
    this.version = program.version ?? 5;
  }

  check(): TypeCheckResult {
    this.resolveImports();
    this.registerDefinitions();
    this.validateDefinitions();

    // Pass 1: infer & propagate variable qualifiers through mutations (var/reassign promotion)
    this.strictPass = false;
    this.topScope = new TypeScope(null);
    for (let pass = 0; pass < 3; pass++) {
      this.changed = false;
      this.checkStmts(this.program.statements, this.topScope, 'const');
      if (!this.changed) break;
    }

    // Pass 2: enforce strict qualifier & type rules using converged variable bindings
    this.strictPass = true;
    const saved = this.topScope;
    this.checkStmts(this.program.statements, saved, 'const');

    return {
      types: this.types,
      enums: this.enums,
      methods: this.methods,
      libraries: this.libraries,
      exprTypes: this.exprTypes,
      resolvedCalls: this.resolvedCalls,
      resolvedLibFns: this.resolvedLibFns,
      fnReturnTypes: this.fnReturnTypes,
    };
  }

  private resolveImports(): void {
    const resolved = this.preResolvedLibs ?? resolveProgramLibraries(this.program, this.rawLibraries);
    for (const [alias, mod] of resolved) {
      this.libraries.set(alias, mod);
      // Recursively typecheck each library module once
      const libChecker = new ScriptTypeChecker(mod.program, this.rawLibraries, mod.imports);
      const libRes = libChecker.check();
      this.libChecks.set(alias, libRes);

      // Register exported UDTs & enums under `alias.Name`
      for (const [tname, td] of mod.exportedTypes) {
        this.types.set(`${alias}.${tname}`, td);
      }
      for (const [ename, en] of mod.exportedEnums) {
        this.enums.set(`${alias}.${ename}`, en);
      }
      // Register exported methods for receiver-based dispatch
      for (const [mname, list] of mod.exportedMethods) {
        const dest = this.importedMethods.get(mname) ?? [];
        for (const fn of list) {
          const recvRef = fn.params[0]?.typeRef;
          if (!recvRef) continue;
          const qualifiedRef = this.qualifyLibTypeRef(recvRef, alias, mod);
          const recvType = this.resolveTypeRef(qualifiedRef, 'series');
          dest.push({ mod, fn, recvType });
        }
        this.importedMethods.set(mname, dest);
      }
    }
  }

  private qualifyLibTypeRef(ref: TypeRef, alias: string, mod: LibraryModule): TypeRef {
    const mappedName =
      mod.exportedTypes.has(ref.name) || mod.exportedEnums.has(ref.name)
        ? `${alias}.${ref.name}`
        : ref.name;
    return {
      ...ref,
      name: mappedName,
      typeArgs: ref.typeArgs?.map((a) => this.qualifyLibTypeRef(a, alias, mod)),
    };
  }

  private err(line: number, msg: string): never {
    throw new ScriptCompileError(line, msg);
  }

  // ------------------------------------------------------------ definitions

  private registerDefinitions(): void {
    for (const s of this.program.statements) {
      if (s.type === 'Declaration' && s.kind === 'library') {
        this.isLibrary = true;
      }
    }
    for (const s of this.program.statements) {
      if (
        (s.type === 'TypeDef' || s.type === 'EnumDef' || s.type === 'FunctionDef' || s.type === 'VarAssign') &&
        s.exported &&
        !this.isLibrary
      ) {
        this.err(s.loc.line, `The 'export' keyword can only be used in a library script.`);
      }
      if (s.type === 'TypeDef') {
        if (this.types.has(s.name) || this.enums.has(s.name) || PRIMITIVE_TYPES.has(s.name)) {
          this.err(s.loc.line, `The '${s.name}' type is already declared.`);
        }
        this.types.set(s.name, s);
      } else if (s.type === 'EnumDef') {
        if (this.enums.has(s.name) || this.types.has(s.name) || PRIMITIVE_TYPES.has(s.name)) {
          this.err(s.loc.line, `The '${s.name}' enum is already declared.`);
        }
        this.enums.set(s.name, s);
      } else if (s.type === 'FunctionDef') {
        if (s.exported) {
          for (const p of s.params) {
            if (!p.typeRef || p.typeRef.name === 'any') {
              this.err(
                p.loc.line,
                `Cannot export ${s.isMethod ? 'method' : 'function'} '${s.name}': parameter '${p.name}' must specify an explicit type.`
              );
            }
          }
        }
        if (s.isMethod) {
          if (s.params.length === 0) {
            this.err(s.loc.line, `Method '${s.name}' must have at least one parameter.`);
          }
          if (!s.params[0].typeRef) {
            this.err(s.loc.line, `The first parameter of method '${s.name}' must specify a type.`);
          }
          const list = this.methods.get(s.name) ?? [];
          list.push(s);
          this.methods.set(s.name, list);
        } else {
          this.functions.set(s.name, s);
        }
      } else if (s.type === 'VarAssign' && s.exported) {
        if (s.typeRef?.qualifier !== 'const') {
          this.err(s.loc.line, `Cannot export variable '${s.name}': only 'const' variables can be exported.`);
        }
      }
    }
  }

  private validateDefinitions(): void {
    // Validate enums
    for (const en of this.enums.values()) {
      const seen = new Set<string>();
      for (const f of en.fields) {
        if (seen.has(f.name)) {
          this.err(f.loc.line, `Duplicate field '${f.name}' in enum '${en.name}'.`);
        }
        seen.add(f.name);
      }
    }

    // Validate UDTs (skip imported UDTs which were already validated inside their own library module)
    for (const [key, td] of this.types) {
      if (key.includes('.')) continue;
      const seen = new Set<string>();
      for (const f of td.fields) {
        if (seen.has(f.name)) {
          this.err(f.loc.line, `Duplicate field '${f.name}' in type '${td.name}'.`);
        }
        seen.add(f.name);
        const ft = this.resolveTypeRef(f.typeRef, 'series');
        if (f.defaultValue) {
          const dt = this.inferExpr(f.defaultValue, new TypeScope(null));
          if (!this.baseFits(dt, ft)) {
            this.err(
              f.loc.line,
              `Cannot assign default value of type '${formatType(dt)}' to field '${f.name}' of type '${formatBase(ft)}'.`
            );
          }
        }
      }
    }

    // Validate method receiver types & duplicate overloads
    for (const [name, overloads] of this.methods) {
      const seenRecv = new Set<string>();
      for (const fn of overloads) {
        const recvType = this.resolveTypeRef(fn.params[0].typeRef!, 'series');
        const key = formatBase(recvType);
        if (seenRecv.has(key)) {
          this.err(fn.loc.line, `Method '${name}' is already defined for type '${key}'.`);
        }
        seenRecv.add(key);
        for (const p of fn.params) {
          if (p.typeRef) this.resolveTypeRef(p.typeRef, 'series');
        }
      }
    }

    // Validate plain function param types
    for (const fn of this.functions.values()) {
      for (const p of fn.params) {
        if (p.typeRef) this.resolveTypeRef(p.typeRef, 'series');
      }
    }
  }

  private isKnownType(name: string): boolean {
    return (
      name === 'any' ||
      name === 'chart.point' ||
      PRIMITIVE_TYPES.has(name) ||
      DRAWING_TYPES.has(name) ||
      COLLECTION_TYPES.has(name) ||
      this.types.has(name) ||
      this.enums.has(name)
    );
  }

  private resolveTypeRef(ref: TypeRef, defaultQual: Qualifier): ScriptType {
    if (!this.isKnownType(ref.name)) {
      this.err(ref.loc.line, `Unknown type '${ref.name}'.`);
    }
    const qual = ref.qualifier ?? defaultQual;
    if (ref.name === 'array' || ref.name === 'matrix') {
      if (ref.typeArgs && ref.typeArgs.length !== 1) {
        this.err(ref.loc.line, `'${ref.name}' requires exactly 1 type argument.`);
      }
      const args = ref.typeArgs ? ref.typeArgs.map((a) => this.resolveTypeRef(a, 'series')) : [pt('series', 'any')];
      return pt(qual, ref.name, args);
    }
    if (ref.name === 'map') {
      if (ref.typeArgs && ref.typeArgs.length !== 2) {
        this.err(ref.loc.line, `'map' requires exactly 2 type arguments <keyType, valueType>.`);
      }
      const args = ref.typeArgs
        ? ref.typeArgs.map((a) => this.resolveTypeRef(a, 'series'))
        : [pt('series', 'any'), pt('series', 'any')];
      return pt(qual, 'map', args);
    }
    if (ref.typeArgs && ref.typeArgs.length > 0) {
      this.err(ref.loc.line, `Type '${ref.name}' does not accept generic type arguments.`);
    }
    return pt(qual, ref.name);
  }

  private baseFits(actual: ScriptType, expected: ScriptType): boolean {
    if (expected.base === 'any' || actual.base === 'any') return true;
    if (actual.base === 'na') {
      if (this.version >= 6 && expected.base === 'bool') return false;
      return true;
    }
    if (actual.base === expected.base) {
      if (COLLECTION_TYPES.has(actual.base)) {
        const aArgs = actual.typeArgs ?? [];
        const eArgs = expected.typeArgs ?? [];
        if (aArgs.length === 0 || eArgs.length === 0) return true;
        if (aArgs.length !== eArgs.length) return false;
        return aArgs.every((a, i) => this.collectionArgFits(a, eArgs[i]));
      }
      return true;
    }
    // TitanScript implicit widening: int -> float
    if (actual.base === 'int' && expected.base === 'float') return true;
    return false;
  }

  private collectionArgFits(actual: ScriptType, expected: ScriptType): boolean {
    if (actual.base === 'any' || expected.base === 'any' || actual.base === 'na') return true;
    if (actual.base !== expected.base) return false;
    if (actual.typeArgs || expected.typeArgs) {
      const a = actual.typeArgs ?? [];
      const e = expected.typeArgs ?? [];
      if (a.length === 0 || e.length === 0) return true;
      return a.length === e.length && a.every((x, i) => this.collectionArgFits(x, e[i]));
    }
    return true;
  }

  private typeFits(actual: ScriptType, expected: ScriptType): boolean {
    return qualFits(actual.qual, expected.qual) && this.baseFits(actual, expected);
  }

  // ------------------------------------------------------------ statements

  private checkStmts(stmts: Statement[], scope: TypeScope, branchQual: Qualifier): ScriptType {
    let last: ScriptType = pt('const', 'void');
    for (const s of stmts) {
      last = this.checkStmt(s, scope, branchQual);
    }
    return last;
  }

  private checkStmt(stmt: Statement, scope: TypeScope, branchQual: Qualifier): ScriptType {
    switch (stmt.type) {
      case 'Import':
      case 'TypeDef':
      case 'EnumDef':
      case 'BreakStmt':
      case 'ContinueStmt':
        return pt('const', 'void');

      case 'FunctionDef': {
        // Check body with declared parameter types once so obvious body errors are caught
        if (this.strictPass) {
          const retT = this.checkFunctionBody(stmt, undefined);
          this.fnReturnTypes.set(stmt, retT);
        }
        return pt('const', 'void');
      }

      case 'Declaration': {
        if (this.strictPass) this.checkDeclaration(stmt, scope);
        return pt('const', 'void');
      }

      case 'VarAssign':
        return this.checkVarAssign(stmt, scope, branchQual);

      case 'MemberAssign':
        return this.checkMemberAssign(stmt, scope, branchQual);

      case 'TupleAssign': {
        const rhs = this.inferExpr(stmt.value, scope);
        const elems = rhs.base === 'tuple' && rhs.typeArgs ? rhs.typeArgs : [];
        stmt.names.forEach((nm, i) => {
          const elemT = elems[i] ?? pt(maxQual(branchQual, rhs.qual), 'any');
          const effT = pt(maxQual(branchQual, elemT.qual), elemT.base, elemT.typeArgs);
          if (stmt.isReassign) {
            const ex = scope.lookup(nm);
            if (ex) {
              if (this.strictPass && ex.explicitQual && !qualFits(effT.qual, ex.explicitQual)) {
                this.err(
                  stmt.loc.line,
                  `Cannot assign '${formatType(effT)}' to a variable of type '${formatType(ex.type)}'.`
                );
              }
              if (!ex.explicitQual) ex.type = pt(maxQual(ex.type.qual, effT.qual), ex.type.base, ex.type.typeArgs);
            }
          } else {
            const prev = scope.vars.get(nm);
            const qual = prev ? maxQual(prev.type.qual, effT.qual) : effT.qual;
            scope.vars.set(nm, {
              type: pt(qual, effT.base, effT.typeArgs),
              isVar: false,
              isVarip: false,
            });
          }
        });
        return rhs;
      }

      case 'IfStatement': {
        const condT = this.inferExpr(stmt.condition, scope);
        const q = maxQual(branchQual, condT.qual);
        const t1 = this.checkStmts(stmt.consequent, new TypeScope(scope), q);
        const t2 = stmt.alternate ? this.checkStmts(stmt.alternate, new TypeScope(scope), q) : pt(q, 'na');
        return this.mergeBranchTypes(t1, t2, q);
      }

      case 'SwitchStatement': {
        let q = branchQual;
        const subjT = stmt.subject ? this.inferExpr(stmt.subject, scope) : undefined;
        if (subjT) q = maxQual(q, subjT.qual);
        let acc: ScriptType | null = null;
        for (const c of stmt.cases) {
          if (c.test) {
            const ct = this.inferExpr(c.test, scope);
            q = maxQual(q, ct.qual);
            if (this.strictPass && subjT && this.enums.has(subjT.base) && ct.base !== 'na' && ct.base !== 'any' && ct.base !== subjT.base) {
              this.err(
                stmt.loc.line,
                `Cannot compare enum '${subjT.base}' with '${formatType(ct)}' in 'switch'.`
              );
            }
          }
          const bt = this.checkStmts(c.body, new TypeScope(scope), q);
          acc = acc ? this.mergeBranchTypes(acc, bt, q) : pt(maxQual(q, bt.qual), bt.base, bt.typeArgs);
        }
        return acc ?? pt(q, 'na');
      }

      case 'ForStatement': {
        const sT = this.inferExpr(stmt.start, scope);
        const eT = this.inferExpr(stmt.end, scope);
        const stT = stmt.step ? this.inferExpr(stmt.step, scope) : pt('const', 'int');
        const q = maxQual(branchQual, maxQual(sT.qual, maxQual(eT.qual, stT.qual)));
        const loopScope = new TypeScope(scope);
        loopScope.vars.set(stmt.counter, { type: pt(q, 'int'), isVar: false, isVarip: false });
        const prevLoop = this.inLoop;
        this.inLoop = true;
        try {
          const bodyT = this.checkStmts(stmt.body, loopScope, q);
          return pt(maxQual(q, bodyT.qual), bodyT.base, bodyT.typeArgs);
        } finally {
          this.inLoop = prevLoop;
        }
      }

      case 'ForInStatement': {
        const itT = this.inferExpr(stmt.iterable, scope);
        const q = maxQual(branchQual, itT.qual);
        const loopScope = new TypeScope(scope);
        if (itT.base === 'map') {
          if (stmt.names.length !== 2) {
            this.err(
              stmt.loc.line,
              `Cannot use a single loop variable with a 'map' in a 'for...in' loop; use '[key, value]' instead.`
            );
          }
          const kT = itT.typeArgs?.[0] ?? pt('series', 'any');
          const vT = itT.typeArgs?.[1] ?? pt('series', 'any');
          loopScope.vars.set(stmt.names[0], { type: pt(maxQual(q, 'series'), kT.base, kT.typeArgs), isVar: false, isVarip: false });
          loopScope.vars.set(stmt.names[1], { type: pt(maxQual(q, 'series'), vT.base, vT.typeArgs), isVar: false, isVarip: false });
        } else if (itT.base === 'matrix') {
          const elemT = itT.typeArgs?.[0] ?? pt('series', 'any');
          const rowT = pt('series', 'array', [elemT]);
          if (stmt.names.length === 1) {
            loopScope.vars.set(stmt.names[0], { type: rowT, isVar: false, isVarip: false });
          } else if (stmt.names.length === 2) {
            loopScope.vars.set(stmt.names[0], { type: pt('series', 'int'), isVar: false, isVarip: false });
            loopScope.vars.set(stmt.names[1], { type: rowT, isVar: false, isVarip: false });
          } else {
            this.err(stmt.loc.line, `'for...in' loop expects 1 or 2 loop variables.`);
          }
        } else if (itT.base === 'array' || itT.base === 'any') {
          const elemT = itT.typeArgs?.[0] ?? pt('series', 'any');
          if (stmt.names.length === 1) {
            loopScope.vars.set(stmt.names[0], { type: pt('series', elemT.base, elemT.typeArgs), isVar: false, isVarip: false });
          } else if (stmt.names.length === 2) {
            loopScope.vars.set(stmt.names[0], { type: pt('series', 'int'), isVar: false, isVarip: false });
            loopScope.vars.set(stmt.names[1], { type: pt('series', elemT.base, elemT.typeArgs), isVar: false, isVarip: false });
          } else {
            this.err(stmt.loc.line, `'for...in' loop expects 1 or 2 loop variables.`);
          }
        } else {
          this.err(
            stmt.loc.line,
            `Cannot iterate over an expression of type '${formatType(itT)}' in a 'for...in' loop.`
          );
        }
        const prevLoop = this.inLoop;
        this.inLoop = true;
        try {
          const bodyT = this.checkStmts(stmt.body, loopScope, maxQual(q, 'series'));
          return pt(maxQual(q, bodyT.qual), bodyT.base, bodyT.typeArgs);
        } finally {
          this.inLoop = prevLoop;
        }
      }

      case 'WhileStatement': {
        const condT = this.inferExpr(stmt.condition, scope);
        const q = maxQual(branchQual, condT.qual);
        const prevLoop = this.inLoop;
        this.inLoop = true;
        try {
          const bodyT = this.checkStmts(stmt.body, new TypeScope(scope), q);
          return pt(maxQual(q, bodyT.qual), bodyT.base, bodyT.typeArgs);
        } finally {
          this.inLoop = prevLoop;
        }
      }

      case 'ExpressionStmt':
        return this.inferExpr(stmt.expr, scope);
    }
  }

  private checkDeclaration(stmt: DeclarationStmt, scope: TypeScope): void {
    const specs = DECL_SPECS[stmt.kind] ?? [];
    this.checkCallAgainstSpecs(stmt.kind, stmt.args, specs, scope, stmt.loc.line);
    if (stmt.kind === 'library' && !isValidLibraryTitle(stmt.title)) {
      this.err(stmt.loc.line, `Invalid library title '${stmt.title}': must be a valid identifier.`);
    }
    const checkCap = (name: string, max: number) => {
      const v = stmt.options[name];
      if (typeof v === 'number' && (!Number.isInteger(v) || v < 1 || v > max)) {
        this.err(stmt.loc.line, `The '${name}' argument must be between 1 and ${max}.`);
      }
    };
    checkCap('max_lines_count', 500);
    checkCap('max_labels_count', 500);
    checkCap('max_boxes_count', 500);
    checkCap('max_polylines_count', 100);
  }

  private checkVarAssign(
    stmt: Extract<Statement, { type: 'VarAssign' }>,
    scope: TypeScope,
    branchQual: Qualifier
  ): ScriptType {
    // varip restrictions
    if (stmt.isVarip) {
      if (this.inFunction) {
        this.err(stmt.loc.line, `Cannot use 'varip' inside a function or method.`);
      }
      if (this.inLoop) {
        this.err(stmt.loc.line, `Cannot use 'varip' inside a loop.`);
      }
      if (stmt.typeRef && DRAWING_TYPES.has(stmt.typeRef.name)) {
        this.err(stmt.loc.line, `Cannot use 'varip' with the '${stmt.typeRef.name}' type.`);
      }
    }

    if (stmt.isVar && stmt.typeRef?.qualifier === 'const') {
      this.err(stmt.loc.line, `Cannot use the 'const' qualifier with '${stmt.isVarip ? 'varip' : 'var'}'.`);
    }

    const rhs = this.inferExpr(stmt.value, scope);

    if (stmt.isVarip && DRAWING_TYPES.has(rhs.base)) {
      this.err(stmt.loc.line, `Cannot use 'varip' with the '${rhs.base}' type.`);
    }

    if (stmt.isReassign) {
      const existing = scope.lookup(stmt.name);
      if (existing) {
        if (existing.explicitQual === 'const' || existing.explicitQual === 'input') {
          this.err(
            stmt.loc.line,
            `Cannot reassign a '${existing.explicitQual}' variable '${stmt.name}'.`
          );
        }
        const effQual = maxQual(branchQual, rhs.qual);
        if (this.strictPass) {
          if (existing.explicitQual && !qualFits(effQual, existing.explicitQual)) {
            this.err(
              stmt.loc.line,
              `Cannot assign '${formatType(pt(effQual, rhs.base, rhs.typeArgs))}' to variable '${stmt.name}' of type '${formatType(existing.type)}'.`
            );
          }
          if (!this.baseFits(rhs, existing.type)) {
            // Allow int -> float promotion on untyped variable
            if (!existing.explicitType && existing.type.base === 'int' && rhs.base === 'float') {
              existing.type = pt(maxQual(existing.type.qual, effQual), 'float');
            } else {
              this.err(
                stmt.loc.line,
                `Cannot assign '${formatType(rhs)}' to variable '${stmt.name}' of type '${formatType(existing.type)}'.`
              );
            }
          }
        } else {
          // Pass 1: promote qualifier & widen int -> float if unannotated
          const nextQual = maxQual(existing.type.qual, effQual);
          const nextBase =
            !existing.explicitType && existing.type.base === 'int' && rhs.base === 'float'
              ? 'float'
              : existing.type.base === 'na' && rhs.base !== 'na'
                ? rhs.base
                : existing.type.base;
          const nextArgs = existing.type.base === 'na' ? rhs.typeArgs : existing.type.typeArgs;
          if (nextQual !== existing.type.qual || nextBase !== existing.type.base) {
            existing.type = pt(nextQual, nextBase, nextArgs);
            this.changed = true;
          }
        }
      }
      return rhs;
    }

    // Declaration (`=`)
    const existing = scope.vars.get(stmt.name);
    if (stmt.typeRef) {
      const declared = this.resolveTypeRef(stmt.typeRef, rhs.qual);
      const explicitQual = stmt.typeRef.qualifier;
      const effQual = maxQual(branchQual, rhs.qual);
      if (this.strictPass) {
        if (explicitQual && !qualFits(effQual, explicitQual)) {
          this.err(
            stmt.loc.line,
            `Cannot assign '${formatType(pt(effQual, rhs.base, rhs.typeArgs))}' to a variable of type '${formatType(declared)}'.`
          );
        }
        if (!this.baseFits(rhs, declared)) {
          this.err(
            stmt.loc.line,
            `Cannot assign '${formatType(rhs)}' to a variable of type '${formatType(declared)}'.`
          );
        }
      }
      const finalQual = explicitQual
        ? explicitQual
        : existing
          ? maxQual(existing.type.qual, effQual)
          : effQual;
      scope.vars.set(stmt.name, {
        type: pt(finalQual, declared.base, declared.typeArgs),
        explicitQual,
        explicitType: true,
        isVar: stmt.isVar,
        isVarip: Boolean(stmt.isVarip),
      });
      return declared;
    }

    // Untyped declaration
    const effQual = maxQual(branchQual, rhs.qual);
    const mergedQual = existing ? maxQual(existing.type.qual, effQual) : effQual;
    const mergedBase =
      existing && existing.type.base === 'float' && rhs.base === 'int'
        ? 'float'
        : rhs.base;
    scope.vars.set(stmt.name, {
      type: pt(mergedQual, mergedBase, rhs.typeArgs),
      isVar: stmt.isVar,
      isVarip: Boolean(stmt.isVarip),
    });
    return pt(mergedQual, mergedBase, rhs.typeArgs);
  }

  private checkMemberAssign(
    stmt: Extract<Statement, { type: 'MemberAssign' }>,
    scope: TypeScope,
    branchQual: Qualifier
  ): ScriptType {
    const objT = this.inferExpr(stmt.object, scope);
    const valT = this.inferExpr(stmt.value, scope);
    if (this.strictPass && objT.base !== 'any' && objT.base !== 'na') {
      if (objT.base === 'chart.point') {
        const expectedBase = CHART_POINT_FIELDS[stmt.property];
        if (!expectedBase) {
          this.err(stmt.loc.line, `The 'chart.point' type does not have a field named '${stmt.property}'.`);
        }
        const ft = pt('series', expectedBase);
        if (!this.baseFits(valT, ft)) {
          this.err(
            stmt.loc.line,
            `Cannot assign '${formatType(valT)}' to field '${stmt.property}' of type '${expectedBase}'.`
          );
        }
        return valT;
      }
      const td = this.types.get(objT.base);
      if (!td) {
        this.err(stmt.loc.line, `Cannot modify field '${stmt.property}' on value of type '${formatBase(objT)}'.`);
      }
      const field = td.fields.find((f) => f.name === stmt.property);
      if (!field) {
        this.err(stmt.loc.line, `The '${td.name}' type does not have a field named '${stmt.property}'.`);
      }
      const ft = this.resolveFieldType(objT.base, field.typeRef);
      if (!this.baseFits(valT, ft)) {
        this.err(
          stmt.loc.line,
          `Cannot assign '${formatType(valT)}' to field '${stmt.property}' of type '${formatBase(ft)}'.`
        );
      }
    }
    void branchQual;
    return valT;
  }

  private mergeBranchTypes(a: ScriptType, b: ScriptType, q: Qualifier): ScriptType {
    const qual = maxQual(q, maxQual(a.qual, b.qual));
    if (a.base === 'na' || a.base === 'void') return pt(qual, b.base, b.typeArgs);
    if (b.base === 'na' || b.base === 'void') return pt(qual, a.base, a.typeArgs);
    if (a.base === b.base) return pt(qual, a.base, a.typeArgs ?? b.typeArgs);
    if ((a.base === 'int' && b.base === 'float') || (a.base === 'float' && b.base === 'int')) {
      return pt(qual, 'float');
    }
    return pt(qual, 'any');
  }

  // ------------------------------------------------------------ expressions

  private inferExpr(e: Expression, scope: TypeScope): ScriptType {
    const res = this.inferExprInner(e, scope);
    this.exprTypes.set(e, res);
    return res;
  }

  private inferExprInner(e: Expression, scope: TypeScope): ScriptType {
    switch (e.type) {
      case 'NumberLiteral':
        return pt('const', e.isFloat ? 'float' : 'int');
      case 'StringLiteral':
        return pt('const', e.isColorHex ? 'color' : 'string');
      case 'BooleanLiteral':
        return pt('const', 'bool');

      case 'ArrayLiteral': {
        const elems = e.elements.map((x) => this.inferExpr(x, scope));
        let q: Qualifier = 'const';
        for (const t of elems) q = maxQual(q, t.qual);
        return pt(q, 'tuple', elems);
      }

      case 'Identifier':
        return this.inferIdent(e.name, scope);

      case 'MemberAccess':
        return this.inferMember(e, scope);

      case 'IndexAccess': {
        const t = this.inferExpr(e.target, scope);
        this.inferExpr(e.index, scope);
        return pt('series', t.base, t.typeArgs);
      }

      case 'UnaryExpr': {
        const v = this.inferExpr(e.argument, scope);
        if (e.operator === 'not') return pt(v.qual, 'bool');
        return pt(v.qual, v.base === 'int' ? 'int' : 'float');
      }

      case 'BinaryExpr':
        return this.inferBinary(e, scope);

      case 'TernaryExpr': {
        const c = this.inferExpr(e.condition, scope);
        const a = this.inferExpr(e.consequent, scope);
        const b = this.inferExpr(e.alternate, scope);
        return this.mergeBranchTypes(a, b, c.qual);
      }

      case 'FunctionCall':
        return this.inferCall(e, scope);

      case 'BlockExpr':
        return this.checkStmt(e.stmt, scope, 'const');
    }
  }

  private inferIdent(name: string, scope: TypeScope): ScriptType {
    const b = scope.lookup(name);
    if (b) return b.type;
    if (name === 'na') return pt('const', 'na');
    if (name in SERIES_VARS) return pt('series', SERIES_VARS[name]);
    if (name in SIMPLE_VARS) return pt('simple', SIMPLE_VARS[name]);
    if (name in CONST_VARS) return pt('const', CONST_VARS[name]);
    return pt('series', 'any');
  }

  private resolveFieldType(ownerTypeKey: string, fieldRef: TypeRef): ScriptType {
    const dot = ownerTypeKey.indexOf('.');
    if (dot > 0) {
      const alias = ownerTypeKey.slice(0, dot);
      const mod = this.libraries.get(alias);
      if (mod) {
        return this.resolveTypeRef(this.qualifyLibTypeRef(fieldRef, alias, mod), 'series');
      }
    }
    return this.resolveTypeRef(fieldRef, 'series');
  }

  private inferMember(e: Extract<Expression, { type: 'MemberAccess' }>, scope: TypeScope): ScriptType {
    const dotted = dottedNameOf(e);
    if (dotted) {
      const parts = dotted.split('.');
      const root = parts[0];

      // 1a. Imported enum member access: `alias.EnumName.member`
      if (parts.length === 3 && !scope.lookup(root)) {
        const libKey = `${parts[0]}.${parts[1]}`;
        const impEnum = this.enums.get(libKey);
        if (impEnum) {
          const member = impEnum.fields.find((f) => f.name === parts[2]);
          if (!member) {
            this.err(e.loc.line, `The '${libKey}' enum does not have a field named '${parts[2]}'.`);
          }
          return pt('const', libKey);
        }
        const mod = this.libraries.get(root);
        if (mod && mod.allEnums.has(parts[1]) && !mod.exportedEnums.has(parts[1])) {
          this.err(e.loc.line, `'${libKey}' is not exported by library '${mod.path}'.`);
        }
      }

      // 1b. Imported library constant access: `alias.CONST_NAME`
      if (parts.length === 2 && !scope.lookup(root) && this.libraries.has(root)) {
        const mod = this.libraries.get(root)!;
        const prop = parts[1];
        const expConst = mod.exportedConsts.get(prop);
        if (expConst) {
          if (expConst.typeRef && expConst.typeRef.name !== 'any') {
            const ct = this.resolveTypeRef(this.qualifyLibTypeRef(expConst.typeRef, root, mod), 'const');
            return pt('const', ct.base, ct.typeArgs);
          }
          const libCheck = this.libChecks.get(root);
          const inferred = libCheck?.exprTypes.get(expConst.value);
          return inferred ? pt('const', inferred.base, inferred.typeArgs) : pt('const', 'any');
        }
        if (mod.allConsts.has(prop)) {
          this.err(e.loc.line, `'${dotted}' is not exported by library '${mod.path}'.`);
        }
        if (mod.exportedEnums.has(prop) || mod.exportedTypes.has(prop)) {
          return pt('const', dotted);
        }
        if (mod.allEnums.has(prop) || mod.allTypes.has(prop)) {
          this.err(e.loc.line, `'${dotted}' is not exported by library '${mod.path}'.`);
        }
        if (this.strictPass) {
          this.err(e.loc.line, `Library '${mod.path}' does not export '${prop}'.`);
        }
        return pt('series', 'any');
      }

      // 1c. Local enum member access: `EnumName.member`
      const en = this.enums.get(root);
      if (en && !scope.lookup(root)) {
        if (e.object.type !== 'Identifier') {
          this.err(e.loc.line, `Invalid enum member access '${dotted}'.`);
        }
        const member = en.fields.find((f) => f.name === e.property);
        if (!member) {
          this.err(e.loc.line, `The '${en.name}' enum does not have a field named '${e.property}'.`);
        }
        return pt('const', en.name);
      }

      // 2. Built-in dotted vars & constants (only when root is a built-in namespace and not shadowed)
      if (!scope.lookup(root)) {
        if (parts.length === 2 && DRAWING_TYPES.has(root) && parts[1] === 'all') {
          return pt('series', 'array', [pt('series', root)]);
        }
        if (dotted in CONST_VARS) return pt('const', CONST_VARS[dotted]);
        if (dotted in SIMPLE_VARS) return pt('simple', SIMPLE_VARS[dotted]);
        if (dotted in SERIES_VARS) return pt('series', SERIES_VARS[dotted]);
        if (BUILTIN_NAMESPACES.has(root)) {
          // Other built-in string/enum-like constants: plot.style_*, label.style_*, order.*, etc.
          if (root === 'color') return pt('const', 'color');
          return pt('const', 'string');
        }
      }
    }

    // 3. UDT & chart.point field access
    const objT = this.inferExpr(e.object, scope);
    if (objT.base === 'any' || objT.base === 'na') return pt(objT.qual, 'any');
    if (objT.base === 'chart.point') {
      const fBase = CHART_POINT_FIELDS[e.property];
      if (!fBase) {
        this.err(e.loc.line, `The 'chart.point' type does not have a field named '${e.property}'.`);
      }
      return pt(maxQual(objT.qual, 'series'), fBase);
    }
    const td = this.types.get(objT.base);
    if (td) {
      const field = td.fields.find((f) => f.name === e.property);
      if (!field) {
        this.err(e.loc.line, `The '${td.name}' type does not have a field named '${e.property}'.`);
      }
      const ft = this.resolveFieldType(objT.base, field.typeRef);
      return pt(maxQual(objT.qual, 'series'), ft.base, ft.typeArgs);
    }
    if (this.strictPass && (PRIMITIVE_TYPES.has(objT.base) || this.enums.has(objT.base))) {
      this.err(e.loc.line, `Type '${formatBase(objT)}' does not have a field named '${e.property}'.`);
    }
    return pt('series', 'any');
  }

  private inferBinary(e: Extract<Expression, { type: 'BinaryExpr' }>, scope: TypeScope): ScriptType {
    const l = this.inferExpr(e.left, scope);
    const r = this.inferExpr(e.right, scope);
    const q = maxQual(l.qual, r.qual);
    const op = e.operator;

    if (op === 'and' || op === 'or') return pt(q, 'bool');
    if (op === '==' || op === '!=') {
      if (this.strictPass) {
        const lEnum = this.enums.has(l.base);
        const rEnum = this.enums.has(r.base);
        if ((lEnum || rEnum) && l.base !== 'na' && r.base !== 'na' && l.base !== 'any' && r.base !== 'any' && l.base !== r.base) {
          this.err(
            e.loc.line,
            `Cannot call 'operator ${op}' with arguments of type '${formatType(l)}' and '${formatType(r)}'.`
          );
        }
      }
      return pt(q, 'bool');
    }
    if (op === '<' || op === '<=' || op === '>' || op === '>=') return pt(q, 'bool');
    if (op === '+') {
      if (l.base === 'string' || r.base === 'string') return pt(q, 'string');
      if (l.base === 'int' && r.base === 'int') return pt(q, 'int');
      return pt(q, 'float');
    }
    if (op === '/') {
      if (this.version < 6 && l.base === 'int' && r.base === 'int') return pt(q, 'int');
      return pt(q, 'float');
    }
    if (op === '-' || op === '*' || op === '%') {
      if (l.base === 'int' && r.base === 'int') return pt(q, 'int');
      return pt(q, 'float');
    }
    return pt(q, 'any');
  }

  // ------------------------------------------------------------ calls & methods

  private inferCall(call: FunctionCall, scope: TypeScope): ScriptType {
    const dotted = call.callee;

    // 0a. Imported library static UDT constructor/copy: `alias.TypeName.new(...)` / `alias.TypeName.copy(obj)`
    if (dotted) {
      const parts = dotted.split('.');
      if (parts.length === 3 && !scope.lookup(parts[0]) && this.libraries.has(parts[0])) {
        const mod = this.libraries.get(parts[0])!;
        const typeKey = `${parts[0]}.${parts[1]}`;
        const prop = parts[2];
        const td = this.types.get(typeKey);
        if (td) {
          if (prop === 'new') return this.checkUdtNew(td, call, scope, typeKey);
          if (prop === 'copy') return this.checkUdtCopy(td, call, scope, typeKey);
        } else if (mod.allTypes.has(parts[1]) && !mod.exportedTypes.has(parts[1])) {
          this.err(call.loc.line, `'${typeKey}' is not exported by library '${mod.path}'.`);
        }
      }

      // 0b. Imported library function or method call: `alias.fn(...)`
      if (parts.length === 2 && !scope.lookup(parts[0]) && this.libraries.has(parts[0])) {
        const mod = this.libraries.get(parts[0])!;
        const fnName = parts[1];
        const expFn = mod.exportedFunctions.get(fnName);
        if (expFn) {
          this.resolvedLibFns.set(call, { mod, fn: expFn });
          return this.checkLibraryCall(mod, expFn, call.args, scope, call.loc.line);
        }
        const expMethods = mod.exportedMethods.get(fnName);
        if (expMethods && call.args.length > 0) {
          const firstT = this.inferExpr(call.args[0].value, scope);
          const matched = this.matchLibMethod(mod, expMethods, firstT);
          if (matched) {
            this.resolvedLibFns.set(call, { mod, fn: matched });
            return this.checkLibraryCall(mod, matched, call.args, scope, call.loc.line, firstT);
          }
        }
        if (mod.allFunctions.has(fnName) || mod.allMethods.has(fnName)) {
          this.err(call.loc.line, `'${dotted}' is not exported by library '${mod.path}'.`);
        }
        this.err(call.loc.line, `Library '${mod.path}' does not export '${fnName}'.`);
      }
    }

    // 1. Local UDT static methods: `TypeName.new(...)` and `TypeName.copy(obj)`
    if (call.calleeExpr.type === 'MemberAccess' && call.calleeExpr.object.type === 'Identifier') {
      const head = call.calleeExpr.object.name;
      const prop = call.calleeExpr.property;
      const td = this.types.get(head);
      if (td && !scope.lookup(head)) {
        if (prop === 'new') return this.checkUdtNew(td, call, scope, td.name);
        if (prop === 'copy') return this.checkUdtCopy(td, call, scope, td.name);
      }
    }

    // 2. Method-style call: `recv.methodName(args)` where recv is NOT a built-in namespace
    if (call.calleeExpr.type === 'MemberAccess') {
      const root = dotted ? dotted.split('.')[0] : null;
      const isNamespace = root !== null && !scope.lookup(root) && BUILTIN_NAMESPACES.has(root);
      if (!isNamespace) {
        return this.inferMethodCall(call.calleeExpr.object, call.calleeExpr.property, call, scope);
      }
    }

    // 3. Direct user function OR method called in function syntax `fn(args)`
    const userFn = this.functions.get(dotted);
    if (userFn) {
      this.resolvedCalls.set(call, userFn);
      return this.checkUserCall(userFn, call.args, scope, call.loc.line);
    }
    const methodList = this.methods.get(dotted);
    if (methodList && call.args.length > 0) {
      const firstT = this.inferExpr(call.args[0].value, scope);
      const matched = this.matchMethod(methodList, firstT);
      if (matched) {
        this.resolvedCalls.set(call, matched);
        return this.checkUserCall(matched, call.args, scope, call.loc.line);
      }
    }

    // 4. Special built-ins: input.enum, array/map/matrix constructors & methods, math/str/color/ta
    if (dotted === 'input.enum') return this.checkInputEnum(call, scope);

    if (dotted === 'array.new' || dotted.startsWith('array.new_')) {
      for (const a of call.args) this.inferExpr(a.value, scope);
      const elem =
        call.typeArgs?.[0]
          ? this.resolveTypeRef(call.typeArgs[0], 'series')
          : dotted.startsWith('array.new_')
            ? pt('series', dotted.slice(10))
            : pt('series', 'float');
      return pt('series', 'array', [elem]);
    }
    if (dotted === 'array.from') {
      const ts = call.args.map((a) => this.inferExpr(a.value, scope));
      const elem = ts[0] ? pt('series', ts[0].base, ts[0].typeArgs) : pt('series', 'any');
      return pt('series', 'array', [elem]);
    }
    if (dotted === 'map.new') {
      for (const a of call.args) this.inferExpr(a.value, scope);
      const k = call.typeArgs?.[0] ? this.resolveTypeRef(call.typeArgs[0], 'series') : pt('series', 'any');
      const v = call.typeArgs?.[1] ? this.resolveTypeRef(call.typeArgs[1], 'series') : pt('series', 'any');
      return pt('series', 'map', [k, v]);
    }
    if (dotted === 'matrix.new') {
      for (const a of call.args) this.inferExpr(a.value, scope);
      const elem = call.typeArgs?.[0] ? this.resolveTypeRef(call.typeArgs[0], 'series') : pt('series', 'float');
      return pt('series', 'matrix', [elem]);
    }

    // 5. Built-in specs with qualifier checks
    const spec = BUILTIN_SPECS[dotted];
    if (spec) {
      const argTypes = this.checkCallAgainstSpecs(dotted, call.args, spec.params, scope, call.loc.line);
      return spec.ret(argTypes);
    }

    // 6. Infer args for remaining built-ins
    const argTypes = call.args.map((a) => this.inferExpr(a.value, scope));
    if (dotted === 'input') {
      // input(title="…", defval=25): tür `defval`'dan (adlandırılmışsa) ya da ilk konumsal argümandan gelir
      const di = call.args.findIndex((a) => a.name === 'defval');
      const pi = call.args.findIndex((a) => !a.name);
      const t = argTypes[di >= 0 ? di : pi];
      return pt('input', t?.base ?? 'any');
    }
    return this.inferBuiltinReturn(dotted, argTypes);
  }

  private checkUdtNew(td: TypeDefStmt, call: FunctionCall, scope: TypeScope, typeKey = td.name): ScriptType {
    let pos = 0;
    for (const a of call.args) {
      const vt = this.inferExpr(a.value, scope);
      const field = a.name ? td.fields.find((f) => f.name === a.name) : td.fields[pos++];
      if (this.strictPass) {
        if (!field) {
          this.err(
            call.loc.line,
            a.name
              ? `The '${typeKey}.new' constructor does not have a parameter named '${a.name}'.`
              : `Too many arguments for '${typeKey}.new' (expected at most ${td.fields.length}).`
          );
        }
        const ft = this.resolveFieldType(typeKey, field.typeRef);
        if (!this.baseFits(vt, ft)) {
          this.err(
            call.loc.line,
            `Cannot call '${typeKey}.new' with argument '${field.name}'='${exprSnippet(a.value)}'. An argument of '${formatType(vt)}' type was used but a '${formatBase(ft)}' is expected.`
          );
        }
      }
    }
    return pt('series', typeKey);
  }

  private checkUdtCopy(td: TypeDefStmt, call: FunctionCall, scope: TypeScope, typeKey = td.name): ScriptType {
    const argTs = call.args.map((a) => this.inferExpr(a.value, scope));
    if (this.strictPass) {
      if (argTs.length !== 1) {
        this.err(call.loc.line, `'${typeKey}.copy' expects exactly 1 argument.`);
      }
      if (!this.baseFits(argTs[0], pt('series', typeKey))) {
        this.err(
          call.loc.line,
          `Cannot call '${typeKey}.copy' with argument 'id'='${exprSnippet(call.args[0].value)}'. An argument of '${formatType(argTs[0])}' type was used but a '${typeKey}' is expected.`
        );
      }
    }
    return pt('series', typeKey);
  }

  private checkInputEnum(call: FunctionCall, scope: TypeScope): ScriptType {
    const argNames = ['defval', 'title', 'options', 'tooltip', 'inline', 'group', 'display', 'active'];
    const bound: { expr?: Expression; type?: ScriptType }[] = [];
    let p = 0;
    for (const a of call.args) {
      const t = this.inferExpr(a.value, scope);
      const idx = a.name ? argNames.indexOf(a.name) : p++;
      if (idx >= 0) bound[idx] = { expr: a.value, type: t };
    }
    const def = bound[0];
    if (!def?.type) {
      if (this.strictPass) this.err(call.loc.line, `Cannot call 'input.enum': missing required 'defval' argument.`);
      return pt('input', 'any');
    }
    if (this.strictPass) {
      if (!this.enums.has(def.type.base)) {
        this.err(
          call.loc.line,
          `Cannot call 'input.enum' with argument 'defval'='${exprSnippet(def.expr!)}'. An argument of '${formatType(def.type)}' type was used but an 'enum' value is expected.`
        );
      }
      if (!qualFits(def.type.qual, 'const')) {
        this.err(
          call.loc.line,
          `Cannot call 'input.enum' with argument 'defval'='${exprSnippet(def.expr!)}'. An argument of '${formatType(def.type)}' type was used but a 'const ${def.type.base}' is expected.`
        );
      }
      const title = bound[1];
      if (title?.type && (!qualFits(title.type.qual, 'const') || !this.baseFits(title.type, pt('const', 'string')))) {
        this.err(
          call.loc.line,
          `Cannot call 'input.enum' with argument 'title'='${exprSnippet(title.expr!)}'. An argument of '${formatType(title.type)}' type was used but a 'const string' is expected.`
        );
      }
      const opts = bound[2];
      if (opts?.type && opts.type.base === 'tuple' && opts.type.typeArgs) {
        for (const elem of opts.type.typeArgs) {
          if (elem.base !== def.type.base) {
            this.err(
              call.loc.line,
              `Cannot call 'input.enum': all 'options' elements must be of enum type '${def.type.base}', got '${formatBase(elem)}'.`
            );
          }
        }
      }
    }
    return pt('input', def.type.base);
  }

  private inferMethodCall(
    receiver: Expression,
    methodName: string,
    call: FunctionCall,
    scope: TypeScope
  ): ScriptType {
    const recvT = this.inferExpr(receiver, scope);

    // 1. Local user-defined methods matching receiver type
    const overloads = this.methods.get(methodName);
    if (overloads) {
      const matched = this.matchMethod(overloads, recvT);
      if (matched) {
        this.resolvedCalls.set(call, matched);
        const allArgs: CallArg[] = [{ value: receiver }, ...call.args];
        return this.checkUserCall(matched, allArgs, scope, call.loc.line, recvT);
      }
    }

    // 1b. Imported library exported methods matching receiver type
    const impOverloads = this.importedMethods.get(methodName);
    if (impOverloads) {
      const matchedImp = this.matchImportedMethod(impOverloads, recvT);
      if (matchedImp) {
        this.resolvedLibFns.set(call, { mod: matchedImp.mod, fn: matchedImp.fn });
        const allArgs: CallArg[] = [{ value: receiver }, ...call.args];
        return this.checkLibraryCall(matchedImp.mod, matchedImp.fn, allArgs, scope, call.loc.line, recvT);
      }
    }

    // 2. Built-in UDT & chart.point `.copy()`
    if (methodName === 'copy' && (this.types.has(recvT.base) || recvT.base === 'chart.point')) {
      for (const a of call.args) this.inferExpr(a.value, scope);
      if (this.strictPass && call.args.length > 0) {
        this.err(call.loc.line, `'${recvT.base}.copy()' takes no additional arguments.`);
      }
      return pt('series', recvT.base);
    }

    // 3. Built-in collection / string / drawing namespace methods
    const argTs = [recvT, ...call.args.map((a) => this.inferExpr(a.value, scope))];
    const ns =
      recvT.base === 'array'
        ? 'array'
        : recvT.base === 'map'
          ? 'map'
          : recvT.base === 'matrix'
            ? 'matrix'
            : recvT.base === 'string'
              ? 'str'
              : DRAWING_TYPES.has(recvT.base)
                ? recvT.base
                : null;
    if (ns) {
      return this.inferBuiltinReturn(`${ns}.${methodName}`, argTs);
    }

    // If user declared method overloads with this name, but none matched the receiver type -> clear compile error
    if (this.strictPass && overloads && recvT.base !== 'any' && recvT.base !== 'na') {
      this.err(
        call.loc.line,
        `Cannot call method '${methodName}' on receiver of type '${formatType(recvT)}'.`
      );
    }
    return pt('series', 'any');
  }

  private matchMethod(overloads: FunctionDefStmt[], recvT: ScriptType): FunctionDefStmt | undefined {
    // Prefer exact base match first (so `int` hits `method f(int this)` before `method f(float this)`)
    let widening: FunctionDefStmt | undefined;
    for (const fn of overloads) {
      const expected = this.resolveTypeRef(fn.params[0].typeRef!, 'series');
      if (recvT.base === expected.base) {
        if (!COLLECTION_TYPES.has(recvT.base) || this.baseFits(recvT, expected)) return fn;
      } else if (!widening && this.baseFits(recvT, expected)) {
        widening = fn;
      }
    }
    return widening;
  }

  private matchImportedMethod(
    overloads: Array<{ mod: LibraryModule; fn: FunctionDefStmt; recvType: ScriptType }>,
    recvT: ScriptType
  ): { mod: LibraryModule; fn: FunctionDefStmt } | undefined {
    let widening: { mod: LibraryModule; fn: FunctionDefStmt } | undefined;
    for (const entry of overloads) {
      if (recvT.base === entry.recvType.base) {
        if (!COLLECTION_TYPES.has(recvT.base) || this.baseFits(recvT, entry.recvType)) {
          return { mod: entry.mod, fn: entry.fn };
        }
      } else if (!widening && this.baseFits(recvT, entry.recvType)) {
        widening = { mod: entry.mod, fn: entry.fn };
      }
    }
    return widening;
  }

  private matchLibMethod(mod: LibraryModule, overloads: FunctionDefStmt[], recvT: ScriptType): FunctionDefStmt | undefined {
    let widening: FunctionDefStmt | undefined;
    for (const fn of overloads) {
      const expected = this.resolveTypeRef(this.qualifyLibTypeRef(fn.params[0].typeRef!, mod.alias, mod), 'series');
      if (recvT.base === expected.base) {
        if (!COLLECTION_TYPES.has(recvT.base) || this.baseFits(recvT, expected)) return fn;
      } else if (!widening && this.baseFits(recvT, expected)) {
        widening = fn;
      }
    }
    return widening;
  }

  private checkLibraryCall(
    mod: LibraryModule,
    fn: FunctionDefStmt,
    args: CallArg[],
    scope: TypeScope,
    line: number,
    precomputedFirst?: ScriptType
  ): ScriptType {
    const argExprs: (Expression | undefined)[] = new Array(fn.params.length);
    const argVals: (ScriptType | undefined)[] = new Array(fn.params.length);

    let p = 0;
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      const t = i === 0 && precomputedFirst ? precomputedFirst : this.inferExpr(a.value, scope);
      if (a.name) {
        const idx = fn.params.findIndex((pr) => pr.name === a.name);
        if (idx < 0 && this.strictPass) {
          this.err(line, `Function '${mod.alias}.${fn.name}' has no parameter named '${a.name}'.`);
        }
        if (idx >= 0) {
          argExprs[idx] = a.value;
          argVals[idx] = t;
        }
      } else {
        if (p < fn.params.length) {
          argExprs[p] = a.value;
          argVals[p] = t;
        }
        p++;
      }
    }

    for (let i = 0; i < fn.params.length; i++) {
      const param = fn.params[i];
      const actual = argVals[i];
      if (!actual) continue;
      if (param.typeRef) {
        const expected = this.resolveTypeRef(this.qualifyLibTypeRef(param.typeRef, mod.alias, mod), 'series');
        if (this.strictPass) {
          if (param.typeRef.qualifier && !qualFits(actual.qual, param.typeRef.qualifier)) {
            const snippet = argExprs[i] ? exprSnippet(argExprs[i]!) : param.name;
            this.err(
              line,
              `Cannot call '${mod.alias}.${fn.name}' with argument '${param.name}'='${snippet}'. An argument of '${formatType(actual)}' type was used but a '${formatType(expected)}' is expected.`
            );
          }
          if (!this.baseFits(actual, expected)) {
            const snippet = argExprs[i] ? exprSnippet(argExprs[i]!) : param.name;
            this.err(
              line,
              `Cannot call '${mod.alias}.${fn.name}' with argument '${param.name}'='${snippet}'. An argument of '${formatType(actual)}' type was used but a '${formatType(expected)}' is expected.`
            );
          }
        }
      }
    }

    // Infer return type from library's typecheck result and qualify library-local types with `alias.`
    const libRes = this.libChecks.get(mod.alias);
    const ret = libRes?.fnReturnTypes.get(fn) ?? pt('series', 'any');
    return this.qualifyReturnedType(ret, mod);
  }

  private qualifyReturnedType(t: ScriptType, mod: LibraryModule): ScriptType {
    const base =
      mod.exportedTypes.has(t.base) || mod.exportedEnums.has(t.base) ? `${mod.alias}.${t.base}` : t.base;
    return pt(
      t.qual,
      base,
      t.typeArgs?.map((a) => this.qualifyReturnedType(a, mod))
    );
  }

  private checkUserCall(
    fn: FunctionDefStmt,
    args: CallArg[],
    scope: TypeScope,
    line: number,
    precomputedFirst?: ScriptType
  ): ScriptType {
    const paramTypes: ScriptType[] = [];
    const argExprs: (Expression | undefined)[] = new Array(fn.params.length);
    const argVals: (ScriptType | undefined)[] = new Array(fn.params.length);

    let p = 0;
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      const t = i === 0 && precomputedFirst ? precomputedFirst : this.inferExpr(a.value, scope);
      if (a.name) {
        const idx = fn.params.findIndex((pr) => pr.name === a.name);
        if (idx < 0 && this.strictPass) {
          this.err(line, `Function '${fn.name}' has no parameter named '${a.name}'.`);
        }
        if (idx >= 0) {
          argExprs[idx] = a.value;
          argVals[idx] = t;
        }
      } else {
        if (p < fn.params.length) {
          argExprs[p] = a.value;
          argVals[p] = t;
        }
        p++;
      }
    }

    for (let i = 0; i < fn.params.length; i++) {
      const param = fn.params[i];
      let actual = argVals[i];
      if (!actual) {
        actual = param.defaultValue ? this.inferExpr(param.defaultValue, this.topScope) : pt('const', 'na');
      }
      if (param.typeRef) {
        const expected = this.resolveTypeRef(param.typeRef, 'series');
        if (this.strictPass) {
          if (param.typeRef.qualifier && !qualFits(actual.qual, param.typeRef.qualifier)) {
            const snippet = argExprs[i] ? exprSnippet(argExprs[i]!) : param.name;
            this.err(
              line,
              `Cannot call '${fn.name}' with argument '${param.name}'='${snippet}'. An argument of '${formatType(actual)}' type was used but a '${formatType(expected)}' is expected.`
            );
          }
          if (!this.baseFits(actual, expected)) {
            const snippet = argExprs[i] ? exprSnippet(argExprs[i]!) : param.name;
            this.err(
              line,
              `Cannot call '${fn.name}' with argument '${param.name}'='${snippet}'. An argument of '${formatType(actual)}' type was used but a '${formatType(expected)}' is expected.`
            );
          }
        }
        // Keep actual qualifier if weaker, keep declared base type
        const q = param.typeRef.qualifier ? actual.qual : actual.qual;
        paramTypes.push(pt(q, expected.base === 'any' ? actual.base : expected.base, expected.typeArgs ?? actual.typeArgs));
      } else {
        paramTypes.push(actual);
      }
    }

    // Instantiate body type-check with call-site types (bounded depth to guard against recursion)
    return this.checkFunctionBody(fn, paramTypes);
  }

  private checkFunctionBody(fn: FunctionDefStmt, callParamTypes?: ScriptType[]): ScriptType {
    if (this.callDepth > 6) return pt('series', 'any');
    const fnScope = new TypeScope(this.topScope);
    fn.params.forEach((param, i) => {
      let t: ScriptType;
      if (callParamTypes?.[i]) {
        t = callParamTypes[i];
      } else if (param.typeRef) {
        t = this.resolveTypeRef(param.typeRef, param.typeRef.qualifier ?? 'series');
      } else {
        t = pt('series', 'any');
      }
      fnScope.vars.set(param.name, {
        type: t,
        explicitQual: param.typeRef?.qualifier,
        explicitType: Boolean(param.typeRef && param.typeRef.name !== 'any'),
        isVar: false,
        isVarip: false,
      });
    });

    const prevInFn = this.inFunction;
    const prevInLoop = this.inLoop;
    this.inFunction = true;
    this.inLoop = false;
    this.callDepth++;
    try {
      if (Array.isArray(fn.body)) {
        return this.checkStmts(fn.body, new TypeScope(fnScope), 'const');
      }
      return this.inferExpr(fn.body, fnScope);
    } finally {
      this.inFunction = prevInFn;
      this.inLoop = prevInLoop;
      this.callDepth--;
    }
  }

  private checkCallAgainstSpecs(
    fnName: string,
    args: CallArg[],
    specs: ParamSpec[],
    scope: TypeScope,
    line: number
  ): ScriptType[] {
    const out: ScriptType[] = [];
    let pos = 0;
    for (const a of args) {
      const actual = this.inferExpr(a.value, scope);
      const idx = a.name ? specs.findIndex((s) => s.name === a.name) : pos++;
      if (idx >= 0) {
        out[idx] = actual;
        const spec = specs[idx];
        // Tipsiz kullanıcı fonksiyonu parametresi ('any'): Standart niteleyiciyi çağrı yerinden çıkarır; burada reddetme.
        if (this.strictPass && spec && actual.base !== 'any') {
          const expQual = spec.qual ?? 'series';
          const expBase = spec.base ?? 'any';
          const expected = pt(expQual, expBase);
          if (!qualFits(actual.qual, expQual) || !this.baseFits(actual, expected)) {
            this.err(
              line,
              `Cannot call '${fnName}' with argument '${spec.name}'='${exprSnippet(a.value)}'. An argument of '${formatType(actual)}' type was used but a '${formatType(expected)}' is expected.`
            );
          }
        }
      }
    }
    return out;
  }

  private inferBuiltinReturn(name: string, args: ScriptType[]): ScriptType {
    const argMax = args.reduce<Qualifier>((acc, t) => maxQual(acc, t.qual), 'const');
    switch (name) {
      case 'na':
        return pt(argMax, 'bool');
      case 'nz': {
        const a0 = args[0] ?? pt('const', 'float');
        const a1 = args[1];
        if (a0.base === 'na' && a1) return pt(argMax, a1.base, a1.typeArgs);
        return pt(argMax, a0.base === 'na' ? 'float' : a0.base, a0.typeArgs);
      }
      case 'fixnan':
        return pt('series', args[0]?.base ?? 'float');
      case 'int':
        return pt(argMax, 'int');
      case 'float':
        return pt(argMax, 'float');
      case 'bool':
        return pt(argMax, 'bool');
      case 'string':
        return pt(argMax, 'string');
      case 'timestamp':
        return pt(argMax, 'int');
      case 'color.new':
      case 'color.rgb':
      case 'color.from_gradient':
        return pt(argMax, 'color');
      case 'input':
        return pt('input', args[0]?.base ?? 'any');
      case 'timeframe.change':
        return pt('series', 'bool');
      case 'timeframe.in_seconds':
        return pt(args.length ? argMax : 'simple', 'int');
      case 'timeframe.from_seconds':
        return pt(argMax, 'string');
    }

    const dot = name.indexOf('.');
    if (dot < 0) {
      if (TA_SIGS[name]) return pt('series', 'float');
      return pt(argMax, 'any');
    }
    const ns = name.slice(0, dot);
    const fn = name.slice(dot + 1);

    if (ns === 'math') {
      if (fn === 'random') return pt('series', 'float');
      if (fn === 'floor' || fn === 'ceil') return pt(argMax, 'int');
      if (fn === 'round' && args.length <= 1) return pt(argMax, 'int');
      if ((fn === 'abs' || fn === 'max' || fn === 'min' || fn === 'sign') && args.every((t) => t.base === 'int')) {
        return pt(argMax, 'int');
      }
      return pt(argMax, 'float');
    }

    if (ns === 'str') {
      if (fn === 'length' || fn === 'pos') return pt(argMax, 'int');
      if (fn === 'tonumber') return pt(argMax, 'float');
      if (fn === 'contains' || fn === 'startswith' || fn === 'endswith') return pt(argMax, 'bool');
      if (fn === 'split') return pt('series', 'array', [pt('series', 'string')]);
      return pt(argMax, 'string');
    }

    if (ns === 'array') {
      const arrT = args[0];
      const elemT = arrT?.typeArgs?.[0] ?? pt('series', 'any');
      if (fn === 'size' || fn === 'indexof') return pt('series', 'int');
      if (fn === 'includes') return pt('series', 'bool');
      if (fn === 'join') return pt('series', 'string');
      if (fn === 'get' || fn === 'pop' || fn === 'shift' || fn === 'remove' || fn === 'first' || fn === 'last') {
        return pt('series', elemT.base, elemT.typeArgs);
      }
      if (fn === 'copy' || fn === 'slice' || fn === 'concat' || fn === 'abs') {
        return arrT ?? pt('series', 'array', [elemT]);
      }
      if (fn === 'sum' || fn === 'avg' || fn === 'min' || fn === 'max' || fn === 'median' || fn === 'stdev') {
        return pt('series', elemT.base === 'int' && fn !== 'avg' && fn !== 'stdev' ? 'int' : 'float');
      }
      return pt('series', 'void');
    }

    if (ns === 'map' && fn in MAP_SIGS) {
      const mT = args[0];
      const kT = mT?.typeArgs?.[0] ?? pt('series', 'any');
      const vT = mT?.typeArgs?.[1] ?? pt('series', 'any');
      if (fn === 'size') return pt('series', 'int');
      if (fn === 'contains') return pt('series', 'bool');
      if (fn === 'keys') return pt('series', 'array', [kT]);
      if (fn === 'values') return pt('series', 'array', [vT]);
      if (fn === 'copy') return mT ?? pt('series', 'map', [kT, vT]);
      if (fn === 'get' || fn === 'put' || fn === 'remove') return pt('series', vT.base, vT.typeArgs);
      return pt('series', 'void');
    }

    if (ns === 'matrix' && fn in MATRIX_SIGS) {
      const mT = args[0];
      const elemT = mT?.typeArgs?.[0] ?? pt('series', 'any');
      if (fn === 'rows' || fn === 'columns' || fn === 'elements_count' || fn === 'rank') return pt('series', 'int');
      if (fn.startsWith('is_')) return pt('series', 'bool');
      if (fn === 'get') return pt('series', elemT.base, elemT.typeArgs);
      if (fn === 'row' || fn === 'col' || fn === 'remove_row' || fn === 'remove_col') {
        return pt('series', 'array', [elemT]);
      }
      if (fn === 'eigenvalues') return pt('series', 'array', [pt('series', 'float')]);
      if (fn === 'eigenvectors' || fn === 'inv' || fn === 'pinv' || fn === 'pow' || fn === 'kron') {
        return pt('series', 'matrix', [pt('series', 'float')]);
      }
      if (fn === 'mult') {
        if (args[1]?.base === 'array') return pt('series', 'array', [pt('series', 'float')]);
        return pt('series', 'matrix', [pt('series', 'float')]);
      }
      if (fn === 'copy' || fn === 'submatrix' || fn === 'transpose' || fn === 'concat' || fn === 'sum' || fn === 'diff') {
        return mT ?? pt('series', 'matrix', [elemT]);
      }
      if (fn === 'min' || fn === 'max' || fn === 'avg' || fn === 'median' || fn === 'mode' || fn === 'trace' || fn === 'det') {
        return pt('series', 'float');
      }
      return pt('series', 'void');
    }

    if (ns === 'ta') {
      if (fn === 'crossover' || fn === 'crossunder' || fn === 'cross' || fn === 'rising' || fn === 'falling') {
        return pt('series', 'bool');
      }
      if (fn === 'barssince' || fn === 'highestbars' || fn === 'lowestbars') return pt('series', 'int');
      if (fn === 'pivot_point_levels') return pt('series', 'array', [pt('series', 'float')]);
      return pt('series', 'float');
    }

    if (ns === 'log') {
      return pt('series', 'void');
    }

    if (DRAWING_TYPES.has(ns)) {
      if (ns === 'linefill' && (fn === 'get_line1' || fn === 'get_line2')) return pt('series', 'line');
      if (fn === 'new' || fn === 'copy') return pt('series', ns);
      if (fn.startsWith('get_')) return pt('series', fn.includes('text') ? 'string' : 'float');
      return pt('series', 'void');
    }

    return pt('series', 'any');
  }
}

export function typeCheckProgram(
  program: Program,
  libraries?: Record<string, string>
): TypeCheckResult {
  return new ScriptTypeChecker(program, libraries).check();
}
