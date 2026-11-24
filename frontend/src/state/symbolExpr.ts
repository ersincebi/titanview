import { tt } from './i18n';
import type { Candle, MarketType } from '../types/market';

const ALIAS_MAP: Record<string, string> = {
  USDTRY: 'USDTRY=X',
  'USD/TRY': 'USDTRY=X',
  EURTRY: 'EURTRY=X',
  'EUR/TRY': 'EURTRY=X',
  EURUSD: 'EURUSD=X',
  'EUR/USD': 'EURUSD=X',
  GBPUSD: 'GBPUSD=X',
  'GBP/USD': 'GBPUSD=X',
  GBPTRY: 'GBPTRY=X',
  'GBP/TRY': 'GBPTRY=X',
  USDJPY: 'USDJPY=X',
  'USD/JPY': 'USDJPY=X',
  XAUUSD: 'GC=F',
  GOLD: 'GC=F',
  XAGUSD: 'SI=F',
  SILVER: 'SI=F',
  BRENT: 'BZ=F',
  DXY: 'DX-Y.NYB',
  BIST100: 'XU100.IS',
  XU100: 'XU100.IS',
};

/** Kısa döviz/endeks takma adlarını kanonik sembole dönüştürür (`USDTRY` → `USDTRY=X`). */
export function normalizeAliasSymbol(raw: string): string {
  const s = raw.trim().toUpperCase();
  return ALIAS_MAP[s] ?? s;
}

export type ExprAstNode =
  | { kind: 'number'; value: number }
  | { kind: 'symbol'; symbol: string }
  | { kind: 'unary'; op: '+' | '-'; arg: ExprAstNode }
  | { kind: 'binary'; op: '+' | '-' | '*' | '/'; left: ExprAstNode; right: ExprAstNode };

export interface ParsedSymbolExpr {
  raw: string;
  canonical: string;
  root: ExprAstNode;
  symbols: string[];
  isComplex: boolean;
  kindLabel: 'Tek Sembol' | 'Oran (Parite)' | 'Çarpım / Kur' | 'Fark (Spread)' | 'Ağırlıklı Sepet';
}

export const PRESET_EXPRESSIONS: Array<{ expr: string; title: string; kind: string }> = [
  { expr: 'BTCUSDT/ETHUSDT', title: tt("Bitcoin / Ethereum Oranı"), kind: 'Oran' },
  { expr: 'THYAO.IS/USDTRY', title: tt("Türk Hava Yolları (USD Bazlı)"), kind: 'Kur Oranı' },
  { expr: 'THYAO.IS*USDTRY', title: tt("THYAO × USDTRY Çarpım İfadesi"), kind: 'Çarpım' },
  { expr: 'XU100.IS/USDTRY', title: tt("BIST 100 Endeksi (Dolar Bazlı)"), kind: 'Kur Oranı' },
  { expr: 'GC=F/SI=F', title: tt("Altın / Gümüş Rasyosu (XAU/XAG)"), kind: 'Oran' },
  { expr: '0.5*BTCUSDT+0.5*ETHUSDT', title: tt("%50 BTC + %50 ETH Kripto Sepeti"), kind: 'Sepet' },
  { expr: '(THYAO.IS+GARAN.IS+ASELS.IS)/3', title: tt("BIST 3 Eşit Ağırlıklı Sepet"), kind: 'Sepet' },
  { expr: 'AAPL-MSFT', title: tt("Apple − Microsoft Fiyat Farkı (Spread)"), kind: 'Spread' },
];

function isHyphenatedTicker(s: string): boolean {
  if (s === 'DX-Y.NYB') return true;
  return /^[A-Z]{1,5}-[A-Z](\.[A-Z]+)?$/.test(s);
}

interface Token {
  type: 'num' | 'sym' | 'op' | 'lparen' | 'rparen' | 'eof';
  text: string;
  num?: number;
}

function tokenize(raw: string): Token[] {
  const s = raw.trim().toUpperCase();
  if (!s) throw new Error('Boş sembol ifadesi');
  if (isHyphenatedTicker(s)) {
    return [{ type: 'sym', text: normalizeAliasSymbol(s) }, { type: 'eof', text: '' }];
  }
  const toks: Token[] = [];
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === '(') {
      toks.push({ type: 'lparen', text: '(' });
      i++;
      continue;
    }
    if (ch === ')') {
      toks.push({ type: 'rparen', text: ')' });
      i++;
      continue;
    }
    if (ch === '+' || ch === '-' || ch === '*' || ch === '/') {
      toks.push({ type: 'op', text: ch });
      i++;
      continue;
    }
    if (s.startsWith('DX-Y.NYB', i)) {
      toks.push({ type: 'sym', text: 'DX-Y.NYB' });
      i += 'DX-Y.NYB'.length;
      continue;
    }
    const start = i;
    let hasLetter = false;
    while (i < s.length) {
      const c = s[i];
      if ((c >= 'A' && c <= 'Z') || c === '_' || c === '=') {
        hasLetter = true;
        i++;
      } else if ((c >= '0' && c <= '9') || c === '.') {
        i++;
      } else {
        break;
      }
    }
    if (i === start) {
      throw new Error(`Geçersiz karakter: '${s[i]}'`);
    }
    const part = s.slice(start, i);
    if (!hasLetter) {
      const n = Number(part);
      if (!Number.isFinite(n)) throw new Error(`Geçersiz sayı: '${part}'`);
      toks.push({ type: 'num', text: part, num: n });
    } else {
      toks.push({ type: 'sym', text: normalizeAliasSymbol(part) });
    }
  }
  toks.push({ type: 'eof', text: '' });
  return toks;
}

function formatAst(n: ExprAstNode): string {
  switch (n.kind) {
    case 'number':
      return String(n.value);
    case 'symbol':
      return n.symbol;
    case 'unary':
      return `${n.op}${formatAst(n.arg)}`;
    case 'binary': {
      const l = n.left.kind === 'binary' && (n.op === '*' || n.op === '/') && (n.left.op === '+' || n.left.op === '-')
        ? `(${formatAst(n.left)})`
        : formatAst(n.left);
      const r = n.right.kind === 'binary' && ((n.op === '*' || n.op === '/') || (n.op === '-' && (n.right.op === '+' || n.right.op === '-')))
        ? `(${formatAst(n.right)})`
        : formatAst(n.right);
      return `${l}${n.op}${r}`;
    }
  }
}

function classifyAst(root: ExprAstNode, symbols: string[]): ParsedSymbolExpr['kindLabel'] {
  if (root.kind === 'symbol' && symbols.length === 1) return 'Tek Sembol';
  if (root.kind === 'binary') {
    if (root.op === '/' && root.left.kind === 'symbol' && root.right.kind === 'symbol') return 'Oran (Parite)';
    if (root.op === '*' && root.left.kind === 'symbol' && root.right.kind === 'symbol') return "Çarpım / Kur";
    if (root.op === '-' && root.left.kind === 'symbol' && (root.right.kind === 'symbol' || root.right.kind === 'binary')) return 'Fark (Spread)';
  }
  return "Ağırlıklı Sepet";
}

/** Sembol veya aritmetik sembol ifadesini (`BTCUSDT/ETHUSDT`, `0.5*BTCUSDT+0.5*ETHUSDT`) ayrıştırır. */
export function parseSymbolExpr(raw: string): ParsedSymbolExpr {
  const toks = tokenize(raw);
  let pos = 0;
  const peek = () => toks[pos] ?? { type: 'eof', text: '' };
  const next = () => toks[pos++] ?? { type: 'eof', text: '' };

  function parseAddSub(): ExprAstNode {
    let left = parseMulDiv();
    while (peek().type === 'op' && (peek().text === '+' || peek().text === '-')) {
      const op = next().text as '+' | '-';
      const right = parseMulDiv();
      left = { kind: 'binary', op, left, right };
    }
    return left;
  }

  function parseMulDiv(): ExprAstNode {
    let left = parseUnary();
    while (peek().type === 'op' && (peek().text === '*' || peek().text === '/')) {
      const op = next().text as '*' | '/';
      const right = parseUnary();
      left = { kind: 'binary', op, left, right };
    }
    return left;
  }

  function parseUnary(): ExprAstNode {
    if (peek().type === 'op' && (peek().text === '+' || peek().text === '-')) {
      const op = next().text as '+' | '-';
      const arg = parseUnary();
      return op === '+' ? arg : { kind: 'unary', op: '-', arg };
    }
    return parsePrimary();
  }

  function parsePrimary(): ExprAstNode {
    const t = next();
    if (t.type === 'num') return { kind: 'number', value: t.num! };
    if (t.type === 'sym') return { kind: 'symbol', symbol: t.text };
    if (t.type === 'lparen') {
      const inner = parseAddSub();
      if (peek().type !== 'rparen') throw new Error("Kapanış parantezi ')' eksik");
      next();
      return inner;
    }
    throw new Error(`Beklenmeyen belirteç: '${t.text || 'EOF'}'`);
  }

  const root = parseAddSub();
  if (peek().type !== 'eof') {
    throw new Error(`Beklenmeyen belirteç: '${peek().text}'`);
  }
  const symbols: string[] = [];
  const seen = new Set<string>();
  (function walk(n: ExprAstNode) {
    if (n.kind === 'symbol') {
      if (!seen.has(n.symbol)) {
        seen.add(n.symbol);
        symbols.push(n.symbol);
      }
    } else if (n.kind === 'unary') {
      walk(n.arg);
    } else if (n.kind === 'binary') {
      walk(n.left);
      walk(n.right);
    }
  })(root);

  if (symbols.length === 0) {
    throw new Error('İfade en az bir sembol içermelidir');
  }
  const isComplex = root.kind !== 'symbol' || symbols.length > 1;
  return {
    raw: raw.trim().toUpperCase(),
    canonical: formatAst(root),
    root,
    symbols,
    isComplex,
    kindLabel: classifyAst(root, symbols),
  };
}

/** Verilen dizgenin geçerli bir aritmetik sembol ifadesi (2+ sembol veya operatörlü) olup olmadığını döndürür. */
export function isSymbolExpression(raw: string): boolean {
  try {
    return parseSymbolExpr(raw).isComplex;
  } catch {
    return false;
  }
}

/** Ayrıştırılmış AST'yi verilen sembol fiyat haritasıyla değerlendirir. */
export function evalSymbolExpr(node: ExprAstNode, vars: Record<string, number>): number | null {
  switch (node.kind) {
    case 'number':
      return node.value;
    case 'symbol': {
      const v = vars[node.symbol];
      return typeof v === 'number' && Number.isFinite(v) ? v : null;
    }
    case 'unary': {
      const v = evalSymbolExpr(node.arg, vars);
      return v === null ? null : node.op === '-' ? -v : v;
    }
    case 'binary': {
      const l = evalSymbolExpr(node.left, vars);
      const r = evalSymbolExpr(node.right, vars);
      if (l === null || r === null) return null;
      let res = 0;
      if (node.op === '+') res = l + r;
      else if (node.op === '-') res = l - r;
      else if (node.op === '*') res = l * r;
      else if (node.op === '/') {
        if (r === 0) return null;
        res = l / r;
      }
      return Number.isFinite(res) ? res : null;
    }
  }
}

/** Çoklu bacak mum serilerini zaman damgasına göre hizalayarak sentetik ifade mumlarını üretir. */
export function mergeExpressionCandles(expr: ParsedSymbolExpr, series: Record<string, Candle[]>): Candle[] {
  if (!expr.symbols.length) return [];
  const primarySym = expr.symbols[0];
  const primary = series[primarySym];
  if (!primary || !primary.length) return [];

  const sorted: Record<string, Candle[]> = {};
  for (const sym of expr.symbols) {
    const leg = series[sym];
    if (!leg || !leg.length) return [];
    sorted[sym] = [...leg].sort((a, b) => a.time - b.time);
  }

  const cursors: Record<string, number> = {};
  for (const sym of expr.symbols) cursors[sym] = 0;

  const out: Candle[] = [];
  for (const pBar of primary) {
    const ts = pBar.time;
    const oVars: Record<string, number> = { [primarySym]: pBar.open };
    const hVars: Record<string, number> = { [primarySym]: pBar.high };
    const lVars: Record<string, number> = { [primarySym]: pBar.low };
    const cVars: Record<string, number> = { [primarySym]: pBar.close };

    let ok = true;
    for (let i = 1; i < expr.symbols.length; i++) {
      const sym = expr.symbols[i];
      const leg = sorted[sym];
      let idx = cursors[sym];
      while (idx + 1 < leg.length && leg[idx + 1].time <= ts) idx++;
      cursors[sym] = idx;
      const bar = leg[idx];
      const sameDay = Math.floor(bar.time / 86400) === Math.floor(ts / 86400);
      if (bar.time > ts && !sameDay) {
        ok = false;
        break;
      }
      if (bar.time === ts || sameDay) {
        oVars[sym] = bar.open;
        hVars[sym] = bar.high;
        lVars[sym] = bar.low;
        cVars[sym] = bar.close;
      } else {
        oVars[sym] = bar.close;
        hVars[sym] = bar.close;
        lVars[sym] = bar.close;
        cVars[sym] = bar.close;
      }
    }
    if (!ok) continue;

    const vO = evalSymbolExpr(expr.root, oVars);
    const vC = evalSymbolExpr(expr.root, cVars);
    const vH = evalSymbolExpr(expr.root, hVars);
    const vL = evalSymbolExpr(expr.root, lVars);
    if (vO === null || vC === null || vH === null || vL === null) continue;

    out.push({
      time: ts,
      open: vO,
      high: Math.max(vO, vC, vH, vL),
      low: Math.min(vO, vC, vH, vL),
      close: vC,
      volume: pBar.volume,
    });
  }
  return out;
}

const AVATAR_PALETTE = [
  ['#1E3A8A', '#93C5FD'],
  ['#065F46', '#6EE7B7'],
  ['#7C2D12', '#FDBA74'],
  ['#581C87', '#D8B4FE'],
  ['#831843', '#F9A8D4'],
  ['#155E75', '#67E8F9'],
  ['#3F6212', '#BEF264'],
  ['#92400E', '#FDE68A'],
];

export interface SymbolAvatarSpec {
  initials: string;
  bg: string;
  fg: string;
  exchange: string;
  assetType: string;
}

/** Standart CDN kullanmadan deterministik baş harf avatarı, borsa rozeti ve varlık türü üretir. */
export function symbolAvatarSpec(symbol: string, market?: MarketType | string, exchange?: string): SymbolAvatarSpec {
  const clean = symbol.trim().toUpperCase().replace(/\.IS$/, '').replace(/USDT$/, '').replace(/=[XF]$/, '');
  const initials = (clean.replace(/[^A-Z0-9]/g, '').slice(0, 2) || symbol.slice(0, 2)).toUpperCase();
  let hash = 0;
  for (let i = 0; i < symbol.length; i++) hash = (hash * 31 + symbol.charCodeAt(i)) >>> 0;
  const [bg, fg] = AVATAR_PALETTE[hash % AVATAR_PALETTE.length];

  let ex = exchange || '';
  if (!ex) {
    if (symbol.endsWith('.IS')) ex = 'BIST';
    else if (symbol.endsWith('USDT') || market === 'CRYPTO') ex = 'BINANCE';
    else if (symbol.endsWith('=X')) ex = 'FX';
    else if (symbol.endsWith('=F')) ex = 'COMEX';
    else ex = 'NASDAQ';
  }

  let assetType = 'hisse';
  if (isSymbolExpression(symbol)) {
    ex = 'EXPR';
    assetType = 'sentetik ifade';
  } else if (market === 'CRYPTO' || symbol.endsWith('USDT')) {
    assetType = 'spot kripto';
  } else if (symbol === 'XU100.IS' || symbol === 'DX-Y.NYB') {
    assetType = 'endeks';
  } else if (symbol === 'SPY' || symbol === 'QQQ') {
    assetType = 'etf';
  } else if (symbol.endsWith('=X')) {
    assetType = 'döviz';
  } else if (symbol.endsWith('=F')) {
    assetType = 'vadeli emtia';
  }

  return { initials, bg, fg, exchange: ex, assetType };
}

export type DisplayCurrency = '' | 'USD' | 'TRY' | 'EUR';

export const CURRENCY_CHOICES: Array<{ code: DisplayCurrency; label: string; symbol: string }> = [
  { code: '', label: tt("Orijinal Para Birimi"), symbol: 'Orijinal' },
  { code: 'USD', label: tt("ABD Doları (USD)"), symbol: '$' },
  { code: 'TRY', label: tt("Türk Lirası (TRY)"), symbol: '₺' },
  { code: 'EUR', label: 'Euro (EUR)', symbol: '€' },
];

/** Aktif para birimi rozet metni (`TRY` veya dönüştürüldüğünde `TRY → USD`). */
export function currencyBadgeLabel(nativeCurrency: string | undefined, displayCurrency: DisplayCurrency): string {
  const nat = (nativeCurrency || 'TRY').toUpperCase();
  if (!displayCurrency) return nat;
  const normNat = nat === 'USDT' ? 'USD' : nat;
  if (normNat === displayCurrency) return nat;
  return `${nat} → ${displayCurrency}`;
}
