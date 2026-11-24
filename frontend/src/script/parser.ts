import {
  dottedNameOf,
  type CallArg,
  type DeclarationStmt,
  type EnumDefStmt,
  type EnumFieldDef,
  type Expression,
  type ExpressionStmt,
  type ForInStatement,
  type ForStatement,
  type FunctionCall,
  type FunctionDefStmt,
  type IfStatement,
  type ImportStmt,
  type MemberAssignStmt,
  type ParamDef,
  type Program,
  type Qualifier,
  type SourceLocation,
  type Statement,
  type SwitchCase,
  type SwitchStatement,
  type TupleAssignStmt,
  type TypeDefStmt,
  type TypeFieldDef,
  type TypeRef,
  type VarAssignStmt,
  type WhileStatement,
} from './ast';
import type { Token, TokenType } from './lexer';

const QUALIFIERS = new Set<string>(['const', 'input', 'simple', 'series']);
const COMPOUND_OPS = new Set(['+=', '-=', '*=', '/=', '%=']);
const MAX_EXPR_DEPTH = 400;

export class ScriptParseError extends Error {
  constructor(
    public readonly line: number,
    public readonly column: number,
    public readonly details: string
  ) {
    super(`Satır ${line}, Sütun ${column}: ${details}`);
    this.name = 'ScriptParseError';
  }
}

export class ScriptParser {
  private current = 0;
  private depth = 0;

  constructor(private readonly tokens: Token[]) {}

  public parse(): Program {
    const startLoc: SourceLocation = this.peek().loc;
    let version = 5;
    const statements: Statement[] = [];

    this.skipNewlines();

    if (this.peek().type === 'DIRECTIVE') {
      const dirTok = this.advance();
      const v = Number(dirTok.value);
      if (!Number.isNaN(v)) version = v;
      this.skipNewlines();
    }

    while (!this.isAtEnd()) {
      if (this.match('NEWLINE') || this.matchPunctuation(',')) continue;
      const stmt = this.parseStatement();
      if (stmt) {
        statements.push(stmt);
      }
      this.skipStmtSeparators();
    }

    return {
      type: 'Program',
      version,
      statements,
      loc: startLoc,
    };
  }

  private parseStatement(): Statement {
    this.skipNewlines();
    const tok = this.peek();

    // 1. Control flow
    if (tok.type === 'KEYWORD' && tok.value === 'if') return this.parseIfStatement();
    if (tok.type === 'KEYWORD' && tok.value === 'for') return this.parseForStatement();
    if (tok.type === 'KEYWORD' && tok.value === 'while') return this.parseWhileStatement();
    if (tok.type === 'KEYWORD' && tok.value === 'switch') return this.parseSwitchStatement();
    if (tok.type === 'KEYWORD' && tok.value === 'break') {
      this.advance();
      return { type: 'BreakStmt', loc: tok.loc };
    }
    if (tok.type === 'KEYWORD' && tok.value === 'continue') {
      this.advance();
      return { type: 'ContinueStmt', loc: tok.loc };
    }

    // 2. Declaration: indicator(...), strategy(...), study(...), library(...)
    if (
      ((tok.type === 'KEYWORD' &&
        (tok.value === 'indicator' || tok.value === 'strategy' || tok.value === 'study')) ||
        (tok.type === 'IDENTIFIER' && tok.value === 'library')) &&
      this.peekNext().type === 'PUNCTUATION' &&
      this.peekNext().value === '('
    ) {
      return this.parseDeclaration();
    }

    // 2.0 Import statement: `import user/libName/version [as alias]`
    if (tok.type === 'IDENTIFIER' && tok.value === 'import' && this.isImportStatement()) {
      return this.parseImport();
    }

    // 2.0a Exported definition: `export <fn|method|type|enum|const var>`
    if (tok.type === 'IDENTIFIER' && tok.value === 'export' && this.isExportStatement()) {
      return this.parseExport();
    }

    // 2a. User-defined type: `type Name` + indented field block
    if (tok.type === 'IDENTIFIER' && tok.value === 'type' && this.isBlockDefHeader()) {
      return this.parseTypeDef();
    }

    // 2b. Enum definition: `enum Name` + indented member block
    if (tok.type === 'IDENTIFIER' && tok.value === 'enum' && this.isBlockDefHeader()) {
      return this.parseEnumDef();
    }

    // 2c. Method definition: `method name(Type this, ...) =>`
    if (
      tok.type === 'IDENTIFIER' &&
      tok.value === 'method' &&
      this.isFunctionDefAt(this.current + 1)
    ) {
      this.advance(); // consume 'method'
      return this.parseFunctionDef(true);
    }

    // 2d. User-defined function definition: `func(params) =>`
    if (this.isFunctionDefAt(this.current)) {
      return this.parseFunctionDef(false);
    }

    // 3. Tuple assignment: [a, b, c] = expr or [a, b, c] := expr
    if (tok.type === 'PUNCTUATION' && tok.value === '[' && this.isTupleAssignment()) {
      return this.parseTupleAssignment();
    }

    // 4. `var` / `varip` declaration: `var|varip [qualifier] [type] name = expr`
    if (tok.type === 'KEYWORD' && (tok.value === 'var' || tok.value === 'varip')) {
      return this.parseVarDecl();
    }

    // 5. Typed / qualified declaration: `[qualifier] TypeRef name = expr`
    const typed = this.tryParseTypedVarAssign();
    if (typed) return typed;

    // 6. Expression, simple assignment, reassignment, member assignment, or compound assignment
    const exprLoc = this.peek().loc;
    const expr = this.parseExpression();
    const nxt = this.peek();

    if (nxt.type === 'ASSIGN') {
      if (expr.type === 'Identifier') {
        this.advance();
        const val = this.parseExpression();
        return {
          type: 'VarAssign',
          name: expr.name,
          value: val,
          isReassign: false,
          isVar: false,
          loc: expr.loc,
        };
      }
      if (expr.type === 'MemberAccess') {
        throw new ScriptParseError(
          nxt.loc.line,
          nxt.loc.column,
          `Cannot use '=' to modify field '${expr.property}'; use ':=' instead.`
        );
      }
      throw new ScriptParseError(nxt.loc.line, nxt.loc.column, "Geçersiz atama hedefi.");
    }

    if (nxt.type === 'REASSIGN') {
      if (expr.type === 'Identifier') {
        this.advance();
        const val = this.parseExpression();
        return {
          type: 'VarAssign',
          name: expr.name,
          value: val,
          isReassign: true,
          isVar: false,
          loc: expr.loc,
        };
      }
      if (expr.type === 'MemberAccess') {
        this.advance();
        const val = this.parseExpression();
        const stmt: MemberAssignStmt = {
          type: 'MemberAssign',
          object: expr.object,
          property: expr.property,
          value: val,
          loc: expr.loc,
        };
        return stmt;
      }
      throw new ScriptParseError(nxt.loc.line, nxt.loc.column, "Geçersiz ':=' atama hedefi.");
    }

    if (nxt.type === 'OPERATOR' && COMPOUND_OPS.has(nxt.value)) {
      if (expr.type === 'Identifier') {
        const opTok = this.advance();
        const rhs = this.parseExpression();
        return {
          type: 'VarAssign',
          name: expr.name,
          value: {
            type: 'BinaryExpr',
            operator: opTok.value[0],
            left: expr,
            right: rhs,
            loc: opTok.loc,
          },
          isReassign: true,
          isVar: false,
          loc: expr.loc,
        };
      }
      if (expr.type === 'MemberAccess') {
        const opTok = this.advance();
        const rhs = this.parseExpression();
        return {
          type: 'MemberAssign',
          object: expr.object,
          property: expr.property,
          operator: opTok.value[0],
          value: rhs,
          loc: expr.loc,
        };
      }
      throw new ScriptParseError(nxt.loc.line, nxt.loc.column, `Geçersiz '${nxt.value}' atama hedefi.`);
    }

    return {
      type: 'ExpressionStmt',
      expr,
      loc: exprLoc,
    };
  }

  // ------------------------------------------------------------ import, export, type & enum definitions

  private isImportStatement(): boolean {
    const t1 = this.tokens[this.current + 1];
    const t2 = this.tokens[this.current + 2];
    return Boolean(t1 && t1.type === 'IDENTIFIER' && t2 && t2.type === 'OPERATOR' && t2.value === '/');
  }

  private parseImport(): ImportStmt {
    const kw = this.advance(); // 'import'
    const first = this.consume('IDENTIFIER', "'import' sonrasında kütüphane yolu bekleniyor.");
    this.consumeOperator('/', "'import' yolunda '/' bekleniyor.");

    let user = 'local';
    let name: string;
    let version = 1;

    if (this.peek().type === 'NUMBER') {
      // Shorthand: `import LibName/1 [as alias]`
      name = first.value;
      version = Number(this.advance().value);
    } else {
      user = first.value;
      const nameTok = this.consume('IDENTIFIER', "Kütüphane adı bekleniyor.");
      name = nameTok.value;
      if (this.checkOperator('/')) {
        this.advance();
        const verTok = this.consume('NUMBER', "Kütüphane sürüm numarası bekleniyor.");
        version = Number(verTok.value);
      }
    }
    if (!Number.isInteger(version) || version < 1) {
      throw new ScriptParseError(kw.loc.line, kw.loc.column, `Geçersiz kütüphane sürümü '${version}' (pozitif tam sayı olmalı).`);
    }

    let alias = name;
    if (this.peek().type === 'IDENTIFIER' && this.peek().value === 'as') {
      this.advance();
      alias = this.consume('IDENTIFIER', "'as' sonrasında kütüphane takma adı bekleniyor.").value;
    }

    const path = `${user}/${name}/${version}`;
    return { type: 'Import', user, name, version, alias, path, loc: kw.loc };
  }

  private isExportStatement(): boolean {
    const nxt = this.tokens[this.current + 1];
    if (!nxt) return false;
    if (nxt.type === 'IDENTIFIER' && (nxt.value === 'type' || nxt.value === 'enum' || nxt.value === 'method')) {
      return true;
    }
    if (this.isFunctionDefAt(this.current + 1)) return true;
    if (nxt.type === 'IDENTIFIER' && QUALIFIERS.has(nxt.value)) return true;
    return false;
  }

  private parseExport(): Statement {
    const kw = this.advance(); // 'export'
    const tok = this.peek();
    if (tok.type === 'IDENTIFIER' && tok.value === 'type' && this.isBlockDefHeader()) {
      const td = this.parseTypeDef();
      td.exported = true;
      return td;
    }
    if (tok.type === 'IDENTIFIER' && tok.value === 'enum' && this.isBlockDefHeader()) {
      const en = this.parseEnumDef();
      en.exported = true;
      return en;
    }
    if (tok.type === 'IDENTIFIER' && tok.value === 'method' && this.isFunctionDefAt(this.current + 1)) {
      this.advance();
      const fn = this.parseFunctionDef(true);
      fn.exported = true;
      return fn;
    }
    if (this.isFunctionDefAt(this.current)) {
      const fn = this.parseFunctionDef(false);
      fn.exported = true;
      return fn;
    }
    const typed = this.tryParseTypedVarAssign();
    if (typed) {
      typed.exported = true;
      return typed;
    }
    // `export const NAME = expr` (inferred base type with explicit `const` qualifier)
    if (
      tok.type === 'IDENTIFIER' &&
      QUALIFIERS.has(tok.value) &&
      this.peekNext().type === 'IDENTIFIER' &&
      this.tokens[this.current + 2]?.type === 'ASSIGN'
    ) {
      const qTok = this.advance();
      const nameTok = this.advance();
      this.advance(); // '='
      const value = this.parseExpression();
      return {
        type: 'VarAssign',
        name: nameTok.value,
        value,
        isReassign: false,
        isVar: false,
        exported: true,
        typeRef: { qualifier: qTok.value as Qualifier, name: 'any', loc: qTok.loc },
        loc: kw.loc,
      };
    }
    throw new ScriptParseError(
      kw.loc.line,
      kw.loc.column,
      "'export' yalnızca fonksiyon, metot, tip (type), enum veya 'const' değişken tanımlarında kullanılabilir."
    );
  }

  /** Checks `<kw> <Name> NEWLINE+ INDENT` for `type` and `enum` headers. */
  private isBlockDefHeader(): boolean {
    const nameTok = this.tokens[this.current + 1];
    if (!nameTok || nameTok.type !== 'IDENTIFIER') return false;
    let i = this.current + 2;
    while (i < this.tokens.length && this.tokens[i].type === 'NEWLINE') i++;
    return this.tokens[i]?.type === 'INDENT';
  }

  private parseTypeDef(): TypeDefStmt {
    const kw = this.advance(); // 'type'
    const nameTok = this.consume('IDENTIFIER', "'type' bildiriminde tip adı bekleniyor.");
    this.skipNewlines();
    this.consume('INDENT', `'type ${nameTok.value}' gövdesi (girintili alanlar) bekleniyor.`);
    const fields: TypeFieldDef[] = [];
    while (!this.check('DEDENT') && !this.isAtEnd()) {
      if (this.match('NEWLINE')) continue;
      const fieldLoc = this.peek().loc;
      const typeRef = this.tryParseTypeRef(false);
      if (!typeRef) {
        const t = this.peek();
        throw new ScriptParseError(t.loc.line, t.loc.column, `'type ${nameTok.value}' içinde alan tipi bekleniyor.`);
      }
      const fieldNameTok = this.consumeName("Alan adı bekleniyor.");
      let defaultValue: Expression | undefined;
      if (this.match('ASSIGN')) {
        defaultValue = this.parseExpression();
      }
      fields.push({ typeRef, name: fieldNameTok.value, defaultValue, loc: fieldLoc });
      this.skipNewlines();
    }
    this.consume('DEDENT', `'type ${nameTok.value}' bloğu bitiminde DEDENT bekleniyor.`);
    if (fields.length === 0) {
      throw new ScriptParseError(kw.loc.line, kw.loc.column, `'type ${nameTok.value}' en az bir alan içermelidir.`);
    }
    return { type: 'TypeDef', name: nameTok.value, fields, loc: kw.loc };
  }

  private parseEnumDef(): EnumDefStmt {
    const kw = this.advance(); // 'enum'
    const nameTok = this.consume('IDENTIFIER', "'enum' bildiriminde enum adı bekleniyor.");
    this.skipNewlines();
    this.consume('INDENT', `'enum ${nameTok.value}' gövdesi (girintili üyeler) bekleniyor.`);
    const fields: EnumFieldDef[] = [];
    while (!this.check('DEDENT') && !this.isAtEnd()) {
      if (this.match('NEWLINE')) continue;
      const fieldTok = this.consumeName("Enum üye adı bekleniyor.");
      let title: string | undefined;
      if (this.match('ASSIGN')) {
        const strTok = this.peek();
        if (strTok.type !== 'STRING') {
          throw new ScriptParseError(
            strTok.loc.line,
            strTok.loc.column,
            `The title of an enum field must be a 'const string' literal.`
          );
        }
        title = this.advance().value;
      }
      fields.push({ name: fieldTok.value, title, loc: fieldTok.loc });
      this.skipNewlines();
    }
    this.consume('DEDENT', `'enum ${nameTok.value}' bloğu bitiminde DEDENT bekleniyor.`);
    if (fields.length === 0) {
      throw new ScriptParseError(kw.loc.line, kw.loc.column, `'enum ${nameTok.value}' en az bir üye içermelidir.`);
    }
    return { type: 'EnumDef', name: nameTok.value, fields, loc: kw.loc };
  }

  // ------------------------------------------------------------ TypeRef & var decls

  private tryParseTypeRef(allowQualifier: boolean): TypeRef | null {
    const saved = this.current;
    const startLoc = this.peek().loc;
    let qualifier: Qualifier | undefined;

    if (
      allowQualifier &&
      this.peek().type === 'IDENTIFIER' &&
      QUALIFIERS.has(this.peek().value) &&
      this.peekNext().type === 'IDENTIFIER'
    ) {
      qualifier = this.advance().value as Qualifier;
    }

    if (this.peek().type !== 'IDENTIFIER') {
      this.current = saved;
      return null;
    }

    const baseTok = this.advance();
    let baseName = baseTok.value;
    // Dotted type names: `chart.point`, `libAlias.MyType`, `libAlias.MyEnum`
    if (this.checkPunctuation('.') && this.peekNext().type === 'IDENTIFIER') {
      this.advance(); // '.'
      const subTok = this.advance();
      baseName = `${baseName}.${subTok.value}`;
    }
    let typeArgs: TypeRef[] | undefined;

    if (this.checkOperator('<')) {
      this.advance();
      typeArgs = [];
      while (!this.checkOperator('>') && !this.isAtEnd()) {
        if (typeArgs.length > 0) {
          if (!this.checkPunctuation(',')) {
            this.current = saved;
            return null;
          }
          this.advance();
        }
        const arg = this.tryParseTypeRef(false);
        if (!arg) {
          this.current = saved;
          return null;
        }
        typeArgs.push(arg);
      }
      if (!this.checkOperator('>')) {
        this.current = saved;
        return null;
      }
      this.advance();
    }

    let ref: TypeRef = { qualifier, name: baseName, typeArgs, loc: startLoc };

    // Legacy `type[]` array shorthand -> array<type>
    if (this.checkPunctuation('[') && this.peekNext().type === 'PUNCTUATION' && this.peekNext().value === ']') {
      this.advance();
      this.advance();
      ref = {
        qualifier,
        name: 'array',
        typeArgs: [{ name: baseName, typeArgs, loc: baseTok.loc }],
        loc: startLoc,
      };
    }

    return ref;
  }

  private parseVarDecl(): VarAssignStmt {
    const varTok = this.advance();
    const isVarip = varTok.value === 'varip';
    let typeRef: TypeRef | undefined;
    let nameTok: Token;

    // Try `[qualifier] TypeRef name =|:=`
    const saved = this.current;
    const tr = this.tryParseTypeRef(true);
    if (
      tr &&
      this.peek().type === 'IDENTIFIER' &&
      (this.peekNext().type === 'ASSIGN' || this.peekNext().type === 'REASSIGN')
    ) {
      typeRef = tr;
      nameTok = this.advance();
    } else {
      this.current = saved;
      nameTok = this.consume('IDENTIFIER', `'${varTok.value}' anahtar kelimesinden sonra değişken adı bekleniyor.`);
    }

    const isReassign = this.check('REASSIGN');
    if (!this.match('ASSIGN') && !this.match('REASSIGN')) {
      throw new ScriptParseError(nameTok.loc.line, nameTok.loc.column, "Değişken tanımlamasında '=' bekleniyor.");
    }
    const val = this.parseExpression();
    return {
      type: 'VarAssign',
      name: nameTok.value,
      value: val,
      isReassign,
      isVar: true,
      isVarip,
      typeRef,
      loc: varTok.loc,
    };
  }

  private tryParseTypedVarAssign(): VarAssignStmt | null {
    const saved = this.current;
    const tr = this.tryParseTypeRef(true);
    if (!tr) {
      this.current = saved;
      return null;
    }
    if (this.peek().type === 'IDENTIFIER' && this.peekNext().type === 'ASSIGN') {
      const idTok = this.advance();
      this.advance(); // consume '='
      const val = this.parseExpression();
      return {
        type: 'VarAssign',
        name: idTok.value,
        value: val,
        isReassign: false,
        isVar: false,
        typeRef: tr,
        loc: tr.loc,
      };
    }
    this.current = saved;
    return null;
  }

  // ------------------------------------------------------------ tuple & functions/methods

  /** `[a, b] = expr` (vs. a tuple/array literal used as an expression). */
  private isTupleAssignment(): boolean {
    let depth = 0;
    for (let i = this.current; i < this.tokens.length; i++) {
      const t = this.tokens[i];
      if (t.type === 'PUNCTUATION' && t.value === '[') depth++;
      else if (t.type === 'PUNCTUATION' && t.value === ']') {
        depth--;
        if (depth === 0) {
          const nxt = this.tokens[i + 1];
          return Boolean(nxt && (nxt.type === 'ASSIGN' || nxt.type === 'REASSIGN'));
        }
      } else if (t.type === 'NEWLINE' || t.type === 'EOF') {
        return false;
      }
    }
    return false;
  }

  private isFunctionDefAt(start: number): boolean {
    const first = this.tokens[start];
    const open = this.tokens[start + 1];
    if (!first || first.type !== 'IDENTIFIER' || !open || open.type !== 'PUNCTUATION' || open.value !== '(') {
      return false;
    }
    let depth = 0;
    let idx = start + 1;
    while (idx < this.tokens.length) {
      const t = this.tokens[idx];
      if (t.type === 'PUNCTUATION' && t.value === '(') depth++;
      else if (t.type === 'PUNCTUATION' && t.value === ')') {
        depth--;
        if (depth === 0) {
          const nextTok = this.tokens[idx + 1];
          return Boolean(nextTok && nextTok.type === 'OPERATOR' && nextTok.value === '=>');
        }
      } else if (t.type === 'NEWLINE' || t.type === 'EOF') {
        break;
      }
      idx++;
    }
    return false;
  }

  private parseFunctionDef(isMethod: boolean): FunctionDefStmt {
    const nameTok = this.advance();
    this.consumePunctuation('(', "Fonksiyon parametreleri için '(' bekleniyor.");
    const params: ParamDef[] = [];
    while (!this.checkPunctuation(')') && !this.isAtEnd()) {
      if (params.length > 0) {
        this.consumePunctuation(',', "Parametreler arasında ',' bekleniyor.");
      }
      params.push(this.parseParamDef());
    }
    this.consumePunctuation(')', "Parametre listesi sonunda ')' bekleniyor.");
    this.consumeOperator('=>', "Fonksiyon gövdesinden önce '=>' operatörü bekleniyor.");

    this.skipNewlines();
    if (this.match('INDENT')) {
      const body: Statement[] = [];
      while (!this.check('DEDENT') && !this.isAtEnd()) {
        if (this.match('NEWLINE') || this.matchPunctuation(',')) continue;
        const stmt = this.parseStatement();
        if (stmt) body.push(stmt);
        this.skipStmtSeparators();
      }
      this.consume('DEDENT', "Fonksiyon bloğu bitiminde DEDENT bekleniyor.");
      return {
        type: 'FunctionDef',
        name: nameTok.value,
        isMethod,
        params,
        body,
        loc: nameTok.loc,
      };
    }
    const expr = this.parseExpression();
    return {
      type: 'FunctionDef',
      name: nameTok.value,
      isMethod,
      params,
      body: expr,
      loc: nameTok.loc,
    };
  }

  private parseParamDef(): ParamDef {
    const loc = this.peek().loc;
    let typeRef: TypeRef | undefined;
    let nameTok: Token;

    // 1. Try `[qualifier] TypeRef paramName`
    const saved = this.current;
    const tr = this.tryParseTypeRef(true);
    if (tr && this.peek().type === 'IDENTIFIER') {
      typeRef = tr;
      nameTok = this.advance();
    } else {
      this.current = saved;
      // 2. Try bare `qualifier paramName` (e.g. `f(simple len) => ...`)
      if (
        this.peek().type === 'IDENTIFIER' &&
        QUALIFIERS.has(this.peek().value) &&
        this.peekNext().type === 'IDENTIFIER'
      ) {
        const qTok = this.advance();
        typeRef = { qualifier: qTok.value as Qualifier, name: 'any', loc: qTok.loc };
        nameTok = this.advance();
      } else {
        nameTok = this.consume('IDENTIFIER', "Parametre adı bekleniyor.");
      }
    }

    let defaultValue: Expression | undefined;
    if (this.match('ASSIGN')) {
      defaultValue = this.parseExpression();
    }
    return { name: nameTok.value, typeRef, defaultValue, loc };
  }

  // ------------------------------------------------------------ loops & switch

  private parseForStatement(): ForStatement | ForInStatement {
    const forTok = this.advance();
    if (this.checkPunctuation('[')) {
      this.advance();
      const names: string[] = [];
      while (!this.checkPunctuation(']') && !this.isAtEnd()) {
        if (names.length > 0) this.consumePunctuation(',', "'for' köşeli sayaç listesinde ',' bekleniyor.");
        names.push(this.consume('IDENTIFIER', "Sayaç adı bekleniyor.").value);
      }
      this.consumePunctuation(']', "']' bekleniyor.");
      return this.finishForIn(forTok, names);
    }
    if (this.tokens[this.current + 1]?.type === 'KEYWORD' && this.tokens[this.current + 1].value === 'in') {
      const nameTok = this.advance();
      return this.finishForIn(forTok, [nameTok.value]);
    }
    const counterTok = this.consume('IDENTIFIER', "'for' döngüsünde sayaç değişkeni bekleniyor.");
    this.consume('ASSIGN', "Sayaç atamasında '=' bekleniyor.");
    const start = this.parseExpression();
    if (this.peek().value !== 'to') {
      throw new ScriptParseError(this.peek().loc.line, this.peek().loc.column, "'for' döngüsünde 'to' bekleniyor.");
    }
    this.advance();
    const end = this.parseExpression();
    let step: Expression | undefined;
    if (this.peek().value === 'by') {
      this.advance();
      step = this.parseExpression();
    }

    const body = this.parseBlockBody('for');
    return {
      type: 'ForStatement',
      counter: counterTok.value,
      start,
      end,
      step,
      body,
      loc: forTok.loc,
    };
  }

  private parseBlockBody(label: string): Statement[] {
    this.skipNewlines();
    const body: Statement[] = [];
    if (this.match('INDENT')) {
      while (!this.check('DEDENT') && !this.isAtEnd()) {
        if (this.match('NEWLINE') || this.matchPunctuation(',')) continue;
        const stmt = this.parseStatement();
        if (stmt) body.push(stmt);
        this.skipStmtSeparators();
      }
      this.consume('DEDENT', `'${label}' bloğu bitiminde DEDENT bekleniyor.`);
    } else {
      const stmt = this.parseStatement();
      if (stmt) body.push(stmt);
      while (this.matchPunctuation(',')) {
        const nextStmt = this.parseStatement();
        if (nextStmt) body.push(nextStmt);
      }
    }
    return body;
  }

  private finishForIn(forTok: Token, names: string[]): ForInStatement {
    if (!(this.peek().type === 'KEYWORD' && this.peek().value === 'in')) {
      throw new ScriptParseError(this.peek().loc.line, this.peek().loc.column, "'for ... in' içinde 'in' bekleniyor.");
    }
    this.advance();
    const iterable = this.parseExpression();
    const body = this.parseBlockBody('for');
    return { type: 'ForInStatement', names, iterable, body, loc: forTok.loc };
  }

  private parseSwitchStatement(): SwitchStatement {
    const swTok = this.advance();
    let subject: Expression | undefined;
    if (this.peek().type !== 'NEWLINE') subject = this.parseExpression();
    this.skipNewlines();
    const cases: SwitchCase[] = [];
    if (!this.match('INDENT')) {
      throw new ScriptParseError(swTok.loc.line, swTok.loc.column, "'switch' gövdesi (girintili dallar) bekleniyor.");
    }
    while (!this.check('DEDENT') && !this.isAtEnd()) {
      if (this.match('NEWLINE')) continue;
      let test: Expression | undefined;
      if (!this.checkOperator('=>')) test = this.parseExpression();
      this.consumeOperator('=>', "'switch' dalında '=>' bekleniyor.");
      const body = this.parseBlockBody('switch');
      cases.push({ test, body });
      this.skipNewlines();
    }
    this.consume('DEDENT', "'switch' bloğu bitiminde DEDENT bekleniyor.");
    return { type: 'SwitchStatement', subject, cases, loc: swTok.loc };
  }

  private parseWhileStatement(): WhileStatement {
    const whileTok = this.advance();
    const condition = this.parseExpression();
    const body = this.parseBlockBody('while');
    return {
      type: 'WhileStatement',
      condition,
      body,
      loc: whileTok.loc,
    };
  }

  private consumeOperator(op: string, errorMsg: string): Token {
    if (this.checkOperator(op)) return this.advance();
    const tok = this.peek();
    throw new ScriptParseError(tok.loc.line, tok.loc.column, errorMsg);
  }

  private parseDeclaration(): DeclarationStmt {
    const kindTok = this.advance();
    const kind =
      kindTok.value === 'strategy'
        ? 'strategy'
        : kindTok.value === 'library'
          ? 'library'
          : 'indicator';
    this.consumePunctuation('(', "Bildirim fonksiyonundan sonra '(' bekleniyor.");

    let title =
      kind === 'strategy' ? 'Custom Strategy' : kind === 'library' ? 'CustomLibrary' : 'Custom Indicator';
    const options: Record<string, any> = {};
    const args: CallArg[] = [];

    let argIdx = 0;
    while (!this.checkPunctuation(')') && !this.isAtEnd()) {
      if (argIdx > 0) {
        this.consumePunctuation(',', "Parametreler arasında ',' bekleniyor.");
      }

      if (this.isNamedArg()) {
        const nameTok = this.advance();
        this.advance(); // consume '='
        const valExpr = this.parseExpression();
        args.push({ name: nameTok.value, value: valExpr });
        const litVal = this.getLiteralValue(valExpr);
        options[nameTok.value] = litVal;
        if (nameTok.value === 'title' && typeof litVal === 'string') {
          title = litVal;
        }
      } else {
        const valExpr = this.parseExpression();
        args.push({ value: valExpr });
        const litVal = this.getLiteralValue(valExpr);
        if (argIdx === 0 && typeof litVal === 'string') {
          title = litVal;
          options['title'] = litVal;
        } else if (kind === 'library' && argIdx === 1 && typeof litVal === 'boolean') {
          options['overlay'] = litVal;
        } else if (argIdx === 1 && typeof litVal === 'string') {
          options['shorttitle'] = litVal;
        } else if (argIdx === 2 && typeof litVal === 'boolean') {
          options['overlay'] = litVal;
        }
      }
      argIdx++;
    }

    this.consumePunctuation(')', "Bildirim parametrelerinin sonunda ')' bekleniyor.");

    return {
      type: 'Declaration',
      kind,
      title,
      options,
      args,
      loc: kindTok.loc,
    };
  }

  private parseTupleAssignment(): TupleAssignStmt {
    const startLoc = this.peek().loc;
    this.consumePunctuation('[', "'[' bekleniyor.");
    const names: string[] = [];

    while (!this.checkPunctuation(']') && !this.isAtEnd()) {
      if (names.length > 0) {
        this.consumePunctuation(',', "Dizi elemanları arasında ',' bekleniyor.");
      }
      const id = this.consume('IDENTIFIER', "Dizi atamasında değişken adı bekleniyor.");
      names.push(id.value);
    }
    this.consumePunctuation(']', "']' bekleniyor.");

    const isReassign = this.check('REASSIGN');
    if (!this.match('ASSIGN') && !this.match('REASSIGN')) {
      throw new ScriptParseError(startLoc.line, startLoc.column, "Dizi atamasında '=' veya ':=' operatörü bekleniyor.");
    }

    const value = this.parseExpression();
    return {
      type: 'TupleAssign',
      names,
      value,
      isReassign,
      loc: startLoc,
    };
  }

  private parseIfStatement(): IfStatement {
    const ifTok = this.advance();
    const condition = this.parseExpression();
    const consequent = this.parseBlockBody('if');
    let alternate: Statement[] | undefined;

    this.skipNewlines();
    if (this.peek().type === 'KEYWORD' && this.peek().value === 'else') {
      this.advance();
      alternate = this.parseBlockBody('else');
    }

    return {
      type: 'IfStatement',
      condition,
      consequent,
      alternate: alternate && alternate.length > 0 ? alternate : undefined,
      loc: ifTok.loc,
    };
  }

  // ------------------------------------------------------------ expressions

  public parseExpression(): Expression {
    if (++this.depth > MAX_EXPR_DEPTH) {
      const tok = this.peek();
      throw new ScriptParseError(tok.loc.line, tok.loc.column, 'İfade iç içe derinlik sınırı aşıldı.');
    }
    try {
      return this.parseTernary();
    } finally {
      this.depth--;
    }
  }

  private parseTernary(): Expression {
    const expr = this.parseLogicalOr();

    if (this.checkOperator('?')) {
      const qTok = this.advance();
      const consequent = this.parseExpression();
      if (!this.checkOperator(':')) {
        throw new ScriptParseError(qTok.loc.line, qTok.loc.column, "Koşul operatöründe (?:) ':' eksik.");
      }
      this.advance();
      const alternate = this.parseExpression();
      return {
        type: 'TernaryExpr',
        condition: expr,
        consequent,
        alternate,
        loc: expr.loc,
      };
    }

    return expr;
  }

  private parseLogicalOr(): Expression {
    let left = this.parseLogicalAnd();

    while (this.peek().type === 'KEYWORD' && this.peek().value === 'or') {
      const opTok = this.advance();
      const right = this.parseLogicalAnd();
      left = { type: 'BinaryExpr', operator: 'or', left, right, loc: opTok.loc };
    }

    return left;
  }

  private parseLogicalAnd(): Expression {
    let left = this.parseEquality();

    while (this.peek().type === 'KEYWORD' && this.peek().value === 'and') {
      const opTok = this.advance();
      const right = this.parseEquality();
      left = { type: 'BinaryExpr', operator: 'and', left, right, loc: opTok.loc };
    }

    return left;
  }

  private parseEquality(): Expression {
    let left = this.parseRelational();

    while (
      this.peek().type === 'OPERATOR' &&
      (this.peek().value === '==' || this.peek().value === '!=')
    ) {
      const opTok = this.advance();
      const right = this.parseRelational();
      left = { type: 'BinaryExpr', operator: opTok.value, left, right, loc: opTok.loc };
    }

    return left;
  }

  private parseRelational(): Expression {
    let left = this.parseAdditive();

    while (
      this.peek().type === 'OPERATOR' &&
      (this.peek().value === '<' ||
        this.peek().value === '<=' ||
        this.peek().value === '>' ||
        this.peek().value === '>=')
    ) {
      const opTok = this.advance();
      const right = this.parseAdditive();
      left = { type: 'BinaryExpr', operator: opTok.value, left, right, loc: opTok.loc };
    }

    return left;
  }

  private parseAdditive(): Expression {
    let left = this.parseMultiplicative();

    while (
      this.peek().type === 'OPERATOR' &&
      (this.peek().value === '+' || this.peek().value === '-')
    ) {
      const opTok = this.advance();
      const right = this.parseMultiplicative();
      left = { type: 'BinaryExpr', operator: opTok.value, left, right, loc: opTok.loc };
    }

    return left;
  }

  private parseMultiplicative(): Expression {
    let left = this.parseUnary();

    while (
      this.peek().type === 'OPERATOR' &&
      (this.peek().value === '*' || this.peek().value === '/' || this.peek().value === '%')
    ) {
      const opTok = this.advance();
      const right = this.parseUnary();
      left = { type: 'BinaryExpr', operator: opTok.value, left, right, loc: opTok.loc };
    }

    return left;
  }

  private parseUnary(): Expression {
    const tok = this.peek();
    if (
      (tok.type === 'OPERATOR' && (tok.value === '+' || tok.value === '-')) ||
      (tok.type === 'KEYWORD' && tok.value === 'not')
    ) {
      const opTok = this.advance();
      const argument = this.parseUnary();
      return {
        type: 'UnaryExpr',
        operator: opTok.value as '+' | '-' | 'not',
        argument,
        loc: opTok.loc,
      };
    }

    return this.parsePostfix();
  }

  private tryParseCallTypeArgs(): TypeRef[] | null {
    if (!this.checkOperator('<')) return null;
    const saved = this.current;
    this.advance(); // '<'
    const typeArgs: TypeRef[] = [];
    while (!this.checkOperator('>') && !this.isAtEnd()) {
      if (typeArgs.length > 0) {
        if (!this.checkPunctuation(',')) {
          this.current = saved;
          return null;
        }
        this.advance();
      }
      const tr = this.tryParseTypeRef(false);
      if (!tr) {
        this.current = saved;
        return null;
      }
      typeArgs.push(tr);
    }
    if (typeArgs.length === 0 || !this.checkOperator('>')) {
      this.current = saved;
      return null;
    }
    this.advance(); // '>'
    if (!this.checkPunctuation('(')) {
      this.current = saved;
      return null;
    }
    return typeArgs;
  }

  private parsePostfix(): Expression {
    let expr = this.parsePrimary();

    while (true) {
      // Member access: expr.prop
      if (this.checkPunctuation('.')) {
        this.advance();
        const propTok = this.consumeName("'.' sonrasında alan veya metot adı bekleniyor.");
        expr = {
          type: 'MemberAccess',
          object: expr,
          property: propTok.value,
          loc: expr.loc,
        };
        continue;
      }

      // Index access: expr[k]
      if (this.checkPunctuation('[')) {
        this.advance();
        const index = this.parseExpression();
        this.consumePunctuation(']', "İndeks erişimi sonrasında ']' bekleniyor.");
        expr = {
          type: 'IndexAccess',
          target: expr,
          index,
          loc: expr.loc,
        };
        continue;
      }

      // Optional generic type arguments before call: `array.new<float>(...)`, `map.new<string, int>()`
      const typeArgs = this.tryParseCallTypeArgs();

      // Function / method call: expr(arg1, arg2, name=expr)
      if (typeArgs !== null || this.checkPunctuation('(')) {
        if (expr.type !== 'Identifier' && expr.type !== 'MemberAccess') {
          throw new ScriptParseError(expr.loc.line, expr.loc.column, "Yalnızca fonksiyon veya metodlar çağrılabilir.");
        }
        this.advance(); // consume '('
        const args: CallArg[] = [];
        while (!this.checkPunctuation(')') && !this.isAtEnd()) {
          if (args.length > 0) {
            this.consumePunctuation(',', "Parametreler arasında ',' bekleniyor.");
          }
          if (this.isNamedArg()) {
            const nameTok = this.advance();
            this.advance(); // consume '='
            const valExpr = this.parseExpression();
            args.push({ name: nameTok.value, value: valExpr });
          } else {
            const valExpr = this.parseExpression();
            args.push({ value: valExpr });
          }
        }
        this.consumePunctuation(')', "Fonksiyon çağrısı sonunda ')' bekleniyor.");
        const call: FunctionCall = {
          type: 'FunctionCall',
          callee: dottedNameOf(expr) ?? '',
          calleeExpr: expr,
          ...(typeArgs ? { typeArgs } : {}),
          args,
          loc: expr.loc,
        };
        expr = call;
        continue;
      }

      break;
    }

    return expr;
  }

  private parsePrimary(): Expression {
    const tok = this.peek();

    // Number
    if (tok.type === 'NUMBER') {
      this.advance();
      return {
        type: 'NumberLiteral',
        value: Number(tok.value),
        isFloat: tok.value.includes('.') || /[eE]/.test(tok.value),
        loc: tok.loc,
      };
    }

    // Hex Color literal
    if (tok.type === 'COLOR') {
      this.advance();
      return {
        type: 'StringLiteral',
        value: tok.value,
        isColorHex: true,
        loc: tok.loc,
      };
    }

    // String
    if (tok.type === 'STRING') {
      this.advance();
      return {
        type: 'StringLiteral',
        value: tok.value,
        loc: tok.loc,
      };
    }

    // Boolean
    if (tok.type === 'KEYWORD' && (tok.value === 'true' || tok.value === 'false')) {
      this.advance();
      return {
        type: 'BooleanLiteral',
        value: tok.value === 'true',
        loc: tok.loc,
      };
    }

    // Block expressions: x = if ... / switch ... / for ... / while ...
    if (
      tok.type === 'KEYWORD' &&
      (tok.value === 'if' || tok.value === 'switch' || tok.value === 'for' || tok.value === 'while')
    ) {
      return { type: 'BlockExpr', stmt: this.parseStatement(), loc: tok.loc };
    }

    // Namespace keywords used as expressions: `strategy.long`, `strategy.entry(...)`, `strategy.position_size`
    if (
      tok.type === 'KEYWORD' &&
      (tok.value === 'strategy' || tok.value === 'indicator' || tok.value === 'study') &&
      this.peekNext().type === 'PUNCTUATION' &&
      this.peekNext().value === '.'
    ) {
      this.advance();
      return {
        type: 'Identifier',
        name: tok.value,
        loc: tok.loc,
      };
    }

    // Identifier
    if (tok.type === 'IDENTIFIER') {
      this.advance();
      return {
        type: 'Identifier',
        name: tok.value,
        loc: tok.loc,
      };
    }

    // Parenthesized: (expr)
    if (tok.type === 'PUNCTUATION' && tok.value === '(') {
      this.advance();
      const expr = this.parseExpression();
      this.consumePunctuation(')', "İfade sonunda kapatıcı ')' parantezi bekleniyor.");
      return expr;
    }

    // Array / tuple literal: [elem1, elem2, ...]
    if (tok.type === 'PUNCTUATION' && tok.value === '[') {
      const startTok = this.advance();
      const elements: Expression[] = [];
      while (!this.checkPunctuation(']') && !this.isAtEnd()) {
        if (elements.length > 0) {
          this.consumePunctuation(',', "Dizi elemanları arasında ',' bekleniyor.");
        }
        elements.push(this.parseExpression());
      }
      this.consumePunctuation(']', "Dizi sonunda ']' bekleniyor.");
      return {
        type: 'ArrayLiteral',
        elements,
        loc: startTok.loc,
      };
    }

    throw new ScriptParseError(
      tok.loc.line,
      tok.loc.column,
      `Beklenmeyen token '${tok.value || tok.type}' (geçerli bir ifade bekleniyordu).`
    );
  }

  private isNamedArg(): boolean {
    const t = this.peek();
    const nxt = this.peekNext();
    if (nxt.type !== 'ASSIGN') return false;
    return t.type === 'IDENTIFIER' || (t.type === 'KEYWORD' && t.value !== 'true' && t.value !== 'false');
  }

  private consumeName(errorMsg: string): Token {
    const tok = this.peek();
    if (tok.type === 'IDENTIFIER' || tok.type === 'KEYWORD') {
      return this.advance();
    }
    throw new ScriptParseError(tok.loc.line, tok.loc.column, errorMsg);
  }

  private getLiteralValue(expr: Expression): any {
    if (expr.type === 'NumberLiteral') return expr.value;
    if (expr.type === 'StringLiteral') return expr.value;
    if (expr.type === 'BooleanLiteral') return expr.value;
    if (expr.type === 'Identifier') return expr.name;
    if (expr.type === 'MemberAccess') return dottedNameOf(expr) ?? undefined;
    if (expr.type === 'ArrayLiteral') return expr.elements.map((e) => this.getLiteralValue(e));
    if (expr.type === 'UnaryExpr' && expr.operator === '-') {
      const inner = this.getLiteralValue(expr.argument);
      return typeof inner === 'number' ? -inner : undefined;
    }
    return undefined;
  }

  private match(type: TokenType): boolean {
    if (this.check(type)) {
      this.advance();
      return true;
    }
    return false;
  }

  private check(type: TokenType): boolean {
    if (this.isAtEnd()) return false;
    return this.peek().type === type;
  }

  private checkOperator(op: string): boolean {
    if (this.isAtEnd()) return false;
    const tok = this.peek();
    return tok.type === 'OPERATOR' && tok.value === op;
  }

  private checkPunctuation(p: string): boolean {
    if (this.isAtEnd()) return false;
    const tok = this.peek();
    return tok.type === 'PUNCTUATION' && tok.value === p;
  }

  private consumePunctuation(p: string, errorMsg: string): Token {
    if (this.checkPunctuation(p)) return this.advance();
    const tok = this.peek();
    throw new ScriptParseError(tok.loc.line, tok.loc.column, errorMsg);
  }

  private consume(type: TokenType, errorMsg: string): Token {
    if (this.check(type)) return this.advance();
    const tok = this.peek();
    throw new ScriptParseError(tok.loc.line, tok.loc.column, errorMsg);
  }

  private advance(): Token {
    if (!this.isAtEnd()) this.current++;
    return this.previous();
  }

  private isAtEnd(): boolean {
    return this.peek().type === 'EOF';
  }

  private peek(): Token {
    return this.tokens[this.current] || { type: 'EOF', value: '', loc: { line: 1, column: 1 } };
  }

  private peekNext(): Token {
    return this.tokens[this.current + 1] || { type: 'EOF', value: '', loc: { line: 1, column: 1 } };
  }

  private previous(): Token {
    return this.tokens[this.current - 1];
  }

  private matchPunctuation(p: string): boolean {
    if (this.checkPunctuation(p)) {
      this.advance();
      return true;
    }
    return false;
  }

  private skipStmtSeparators(): void {
    while (this.peek().type === 'NEWLINE' || this.checkPunctuation(',')) {
      this.advance();
    }
  }

  private skipNewlines(): void {
    while (this.peek().type === 'NEWLINE') {
      this.advance();
    }
  }
}

export function parse(tokens: Token[]): Program {
  return new ScriptParser(tokens).parse();
}
