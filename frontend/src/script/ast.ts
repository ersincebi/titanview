export interface SourceLocation {
  line: number;
  column: number;
}

export type Qualifier = 'const' | 'input' | 'simple' | 'series';

export interface TypeRef {
  qualifier?: Qualifier;
  /** Base type name: int, float, bool, string, color, array, matrix, map, line, box, label, table, or UDT/Enum name */
  name: string;
  /** Generic type arguments, e.g. array<float>, map<string, Point>, matrix<int> */
  typeArgs?: TypeRef[];
  loc: SourceLocation;
}

export type ASTNode =
  | Program
  | Statement
  | Expression;

export interface Program {
  type: 'Program';
  version?: number;
  statements: Statement[];
  loc: SourceLocation;
}

export type Statement =
  | DeclarationStmt
  | ImportStmt
  | TypeDefStmt
  | EnumDefStmt
  | VarAssignStmt
  | MemberAssignStmt
  | TupleAssignStmt
  | IfStatement
  | ForStatement
  | WhileStatement
  | FunctionDefStmt
  | ForInStatement
  | SwitchStatement
  | BreakStmt
  | ContinueStmt
  | ExpressionStmt;

export interface ImportStmt {
  type: 'Import';
  user: string;
  name: string;
  version: number;
  alias: string;
  path: string;
  loc: SourceLocation;
}

export interface TypeFieldDef {
  typeRef: TypeRef;
  name: string;
  defaultValue?: Expression;
  loc: SourceLocation;
}

export interface TypeDefStmt {
  type: 'TypeDef';
  name: string;
  exported?: boolean;
  fields: TypeFieldDef[];
  loc: SourceLocation;
}

export interface EnumFieldDef {
  name: string;
  title?: string;
  loc: SourceLocation;
}

export interface EnumDefStmt {
  type: 'EnumDef';
  name: string;
  exported?: boolean;
  fields: EnumFieldDef[];
  loc: SourceLocation;
}

export interface ParamDef {
  name: string;
  typeRef?: TypeRef;
  defaultValue?: Expression;
  loc: SourceLocation;
}

export interface ForInStatement {
  type: 'ForInStatement';
  /** `for x in arr` -> ['x'];  `for [i, x] in arr` -> ['i', 'x']; `for [k, v] in map` -> ['k', 'v'] */
  names: string[];
  iterable: Expression;
  body: Statement[];
  loc: SourceLocation;
}

export interface SwitchCase {
  /** undefined = default branch */
  test?: Expression;
  body: Statement[];
}

export interface SwitchStatement {
  type: 'SwitchStatement';
  subject?: Expression;
  cases: SwitchCase[];
  loc: SourceLocation;
}

export interface BreakStmt {
  type: 'BreakStmt';
  loc: SourceLocation;
}

export interface ContinueStmt {
  type: 'ContinueStmt';
  loc: SourceLocation;
}

export interface WhileStatement {
  type: 'WhileStatement';
  condition: Expression;
  body: Statement[];
  loc: SourceLocation;
}

export interface ForStatement {
  type: 'ForStatement';
  counter: string;
  start: Expression;
  end: Expression;
  step?: Expression;
  body: Statement[];
  loc: SourceLocation;
}

export interface FunctionDefStmt {
  type: 'FunctionDef';
  name: string;
  isMethod?: boolean;
  exported?: boolean;
  params: ParamDef[];
  body: Expression | Statement[];
  loc: SourceLocation;
}

export interface DeclarationStmt {
  type: 'Declaration';
  kind: 'indicator' | 'strategy' | 'library';
  title: string;
  options: Record<string, any>;
  args: CallArg[];
  loc: SourceLocation;
}

export interface VarAssignStmt {
  type: 'VarAssign';
  name: string;
  value: Expression;
  isReassign: boolean;
  isVar: boolean;
  isVarip?: boolean;
  exported?: boolean;
  typeRef?: TypeRef;
  loc: SourceLocation;
}

export interface MemberAssignStmt {
  type: 'MemberAssign';
  object: Expression;
  property: string;
  value: Expression;
  /** Compound operator ('+', '-', '*', '/', '%') when using +=, -=, etc. */
  operator?: string;
  loc: SourceLocation;
}

export interface TupleAssignStmt {
  type: 'TupleAssign';
  names: string[];
  value: Expression;
  isReassign: boolean;
  loc: SourceLocation;
}

export interface IfStatement {
  type: 'IfStatement';
  condition: Expression;
  consequent: Statement[];
  alternate?: Statement[];
  loc: SourceLocation;
}

export interface ExpressionStmt {
  type: 'ExpressionStmt';
  expr: Expression;
  loc: SourceLocation;
}

export type Expression =
  | NumberLiteral
  | StringLiteral
  | BooleanLiteral
  | Identifier
  | MemberAccess
  | IndexAccess
  | UnaryExpr
  | BinaryExpr
  | TernaryExpr
  | FunctionCall
  | ArrayLiteral
  | BlockExpr;

/** `x = if ...` / `x = switch ...` / `x = for ...` / `x = while ...` — value of the last executed expression. */
export interface BlockExpr {
  type: 'BlockExpr';
  stmt: Statement;
  loc: SourceLocation;
}

export interface ArrayLiteral {
  type: 'ArrayLiteral';
  elements: Expression[];
  loc: SourceLocation;
}

export interface NumberLiteral {
  type: 'NumberLiteral';
  value: number;
  isFloat?: boolean;
  loc: SourceLocation;
}

export interface StringLiteral {
  type: 'StringLiteral';
  value: string;
  isColorHex?: boolean;
  loc: SourceLocation;
}

export interface BooleanLiteral {
  type: 'BooleanLiteral';
  value: boolean;
  loc: SourceLocation;
}

export interface Identifier {
  type: 'Identifier';
  name: string;
  loc: SourceLocation;
}

export interface MemberAccess {
  type: 'MemberAccess';
  object: Expression;
  property: string;
  loc: SourceLocation;
}

export interface IndexAccess {
  type: 'IndexAccess';
  target: Expression;
  index: Expression;
  loc: SourceLocation;
}

export interface UnaryExpr {
  type: 'UnaryExpr';
  operator: '+' | '-' | 'not';
  argument: Expression;
  loc: SourceLocation;
}

export interface BinaryExpr {
  type: 'BinaryExpr';
  operator: string;
  left: Expression;
  right: Expression;
  loc: SourceLocation;
}

export interface TernaryExpr {
  type: 'TernaryExpr';
  condition: Expression;
  consequent: Expression;
  alternate: Expression;
  loc: SourceLocation;
}

export interface CallArg {
  name?: string;
  value: Expression;
}

export interface FunctionCall {
  type: 'FunctionCall';
  /** Dotted path when calleeExpr is Identifier / MemberAccess chain (e.g. 'ta.sma'), else '' */
  callee: string;
  calleeExpr: Expression;
  typeArgs?: TypeRef[];
  args: CallArg[];
  loc: SourceLocation;
}

/** Extract dotted path from Identifier or chained MemberAccess, or null if dynamic receiver. */
export function dottedNameOf(expr: Expression): string | null {
  if (expr.type === 'Identifier') return expr.name;
  if (expr.type === 'MemberAccess') {
    const base = dottedNameOf(expr.object);
    return base !== null ? `${base}.${expr.property}` : null;
  }
  return null;
}
