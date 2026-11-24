import type { SourceLocation } from './ast';

export type TokenType =
  | 'DIRECTIVE'     // //@version=6
  | 'KEYWORD'       // if, else, var, varip, and, or, not, true, false, indicator, strategy, study
  | 'IDENTIFIER'    // close, ta, sma, color, etc.
  | 'NUMBER'        // 10, 3.14, 1e-5
  | 'STRING'        // "Title", 'Short'
  | 'COLOR'         // #ff0000, #0284C780
  | 'ASSIGN'        // =
  | 'REASSIGN'      // :=
  | 'OPERATOR'      // +, -, *, /, %, ==, !=, <, >, <=, >=, ?, :, =>, +=, -=, *=, /=, %=
  | 'PUNCTUATION'   // (, ), [, ], ,, .
  | 'NEWLINE'
  | 'INDENT'
  | 'DEDENT'
  | 'EOF';

export interface Token {
  type: TokenType;
  value: string;
  loc: SourceLocation;
}

const KEYWORDS = new Set([
  'if',
  'else',
  'var',
  'varip',
  'for',
  'in',
  'break',
  'continue',
  'switch',
  'to',
  'by',
  'while',
  'and',
  'or',
  'not',
  'true',
  'false',
  'indicator',
  'strategy',
  'study',
]);

export class ScriptLexer {
  private pos = 0;
  private line = 1;
  private column = 1;
  private parenDepth = 0;
  private indentStack = [0];
  private pendingTokens: Token[] = [];
  private atLineStart = true;

  constructor(private readonly source: string) {}

  public tokenize(): Token[] {
    const tokens: Token[] = [];
    while (true) {
      const tok = this.nextToken();
      tokens.push(tok);
      if (tok.type === 'EOF') break;
    }
    return tokens;
  }

  private nextToken(): Token {
    if (this.pendingTokens.length > 0) {
      return this.pendingTokens.shift()!;
    }

    while (this.pos < this.source.length) {
      // Handle indentation at line start
      if (this.atLineStart) {
        this.atLineStart = false;

        // Count indentation spaces (tabs count as 4 spaces)
        let spaces = 0;
        let p = this.pos;
        while (p < this.source.length) {
          const c = this.source[p];
          if (c === ' ') spaces += 1;
          else if (c === '\t') spaces += 4;
          else break;
          p++;
        }

        // Check if line is empty or just a comment
        const isComment =
          p + 1 < this.source.length &&
          this.source[p] === '/' &&
          this.source[p + 1] === '/';
        const isNewline = p < this.source.length && (this.source[p] === '\r' || this.source[p] === '\n');
        const isDirective =
          isComment &&
          this.source.slice(p, p + 11).toLowerCase() === '//@version=';

        if ((isNewline || (isComment && !isDirective)) && p < this.source.length) {
          // Advance past spaces and continue to consume newline/comment
          this.column += p - this.pos;
          this.pos = p;
          continue;
        }

        // Only manage indentation if not inside brackets/parentheses
        if (this.parenDepth === 0 && !isDirective) {
          const currentIndent = this.indentStack[this.indentStack.length - 1];
          if (spaces > currentIndent) {
            this.indentStack.push(spaces);
            this.column += p - this.pos;
            this.pos = p;
            return {
              type: 'INDENT',
              value: `${spaces}`,
              loc: { line: this.line, column: 1 },
            };
          } else if (spaces < currentIndent) {
            while (
              this.indentStack.length > 1 &&
              this.indentStack[this.indentStack.length - 1] > spaces
            ) {
              this.indentStack.pop();
              this.pendingTokens.push({
                type: 'DEDENT',
                value: `${spaces}`,
                loc: { line: this.line, column: 1 },
              });
            }
            this.column += p - this.pos;
            this.pos = p;
            return this.pendingTokens.shift()!;
          }
        }

        this.column += p - this.pos;
        this.pos = p;
        if (this.pos >= this.source.length) break;
      }

      const ch = this.source[this.pos];

      // Whitespace
      if (ch === ' ' || ch === '\t') {
        this.pos++;
        this.column++;
        continue;
      }

      // Newlines
      if (ch === '\r' || ch === '\n') {
        if (ch === '\r' && this.pos + 1 < this.source.length && this.source[this.pos + 1] === '\n') {
          this.pos++;
        }
        this.pos++;
        this.line++;
        this.column = 1;
        this.atLineStart = true;
        if (this.parenDepth === 0) {
          return {
            type: 'NEWLINE',
            value: '\n',
            loc: { line: this.line - 1, column: 1 },
          };
        }
        continue;
      }

      // Comments & Directives
      if (ch === '/' && this.pos + 1 < this.source.length && this.source[this.pos + 1] === '/') {
        const lineStartPos = this.pos;
        const lineStartCol = this.column;
        let commentText = '';
        while (this.pos < this.source.length && this.source[this.pos] !== '\r' && this.source[this.pos] !== '\n') {
          commentText += this.source[this.pos];
          this.pos++;
          this.column++;
        }

        // Check compiler directive //@version=5
        const directiveMatch = commentText.match(/^\/\/\s*@version\s*=\s*([0-9]+)/i);
        if (directiveMatch) {
          return {
            type: 'DIRECTIVE',
            value: directiveMatch[1],
            loc: { line: this.line, column: lineStartCol },
          };
        }
        // Normal comment is skipped
        continue;
      }

      const startLoc: SourceLocation = { line: this.line, column: this.column };

      // Strings ("..." or '...')
      if (ch === '"' || ch === "'") {
        return this.readString(ch, startLoc);
      }

      // Numbers: digits or dot followed by digit
      if (
        (ch >= '0' && ch <= '9') ||
        (ch === '.' && this.pos + 1 < this.source.length && this.source[this.pos + 1] >= '0' && this.source[this.pos + 1] <= '9')
      ) {
        return this.readNumber(startLoc);
      }

      // Hex color literals: #0d1117, #161b22, #fff, #0284C780
      if (ch === '#') {
        let p = this.pos + 1;
        while (p < this.source.length && /[0-9a-fA-F]/.test(this.source[p])) {
          p++;
        }
        if (p > this.pos + 1) {
          const hex = this.source.slice(this.pos, p);
          this.column += (p - this.pos);
          this.pos = p;
          return { type: 'COLOR', value: hex, loc: startLoc };
        }
      }

      if (ch === ':' && this.pos + 1 < this.source.length && this.source[this.pos + 1] === '=') {
        this.pos += 2;
        this.column += 2;
        return { type: 'REASSIGN', value: ':=', loc: startLoc };
      }

      if (ch === '=') {
        if (this.pos + 1 < this.source.length && this.source[this.pos + 1] === '=') {
          this.pos += 2;
          this.column += 2;
          return { type: 'OPERATOR', value: '==', loc: startLoc };
        }
        if (this.pos + 1 < this.source.length && this.source[this.pos + 1] === '>') {
          this.pos += 2;
          this.column += 2;
          return { type: 'OPERATOR', value: '=>', loc: startLoc };
        }
        this.pos++;
        this.column++;
        return { type: 'ASSIGN', value: '=', loc: startLoc };
      }

      // Compound assignment: +=, -=, *=, /=, %=
      if (
        (ch === '+' || ch === '-' || ch === '*' || ch === '/' || ch === '%') &&
        this.pos + 1 < this.source.length &&
        this.source[this.pos + 1] === '='
      ) {
        this.pos += 2;
        this.column += 2;
        return { type: 'OPERATOR', value: ch + '=', loc: startLoc };
      }

      // Operators: !=, <=, >=
      if (ch === '!' && this.pos + 1 < this.source.length && this.source[this.pos + 1] === '=') {
        this.pos += 2;
        this.column += 2;
        return { type: 'OPERATOR', value: '!=', loc: startLoc };
      }
      if (ch === '<' && this.pos + 1 < this.source.length && this.source[this.pos + 1] === '=') {
        this.pos += 2;
        this.column += 2;
        return { type: 'OPERATOR', value: '<=', loc: startLoc };
      }
      if (ch === '>' && this.pos + 1 < this.source.length && this.source[this.pos + 1] === '=') {
        this.pos += 2;
        this.column += 2;
        return { type: 'OPERATOR', value: '>=', loc: startLoc };
      }

      // Single-character operators
      if (ch === '<' || ch === '>' || ch === '+' || ch === '-' || ch === '*' || ch === '/' || ch === '%' || ch === '?' || ch === ':') {
        this.pos++;
        this.column++;
        return { type: 'OPERATOR', value: ch, loc: startLoc };
      }

      // Punctuation: (, ), [, ], ,, .
      if (ch === '(' || ch === '[' || ch === ')' || ch === ']' || ch === ',' || ch === '.') {
        if (ch === '(' || ch === '[') this.parenDepth++;
        if (ch === ')' || ch === ']') this.parenDepth = Math.max(0, this.parenDepth - 1);
        this.pos++;
        this.column++;
        return { type: 'PUNCTUATION', value: ch, loc: startLoc };
      }

      // Identifiers & Keywords
      if (this.isIdentifierStart(ch)) {
        return this.readIdentifier(startLoc);
      }

      // Unknown character fallback
      this.pos++;
      this.column++;
      return { type: 'OPERATOR', value: ch, loc: startLoc };
    }

    // Emit remaining DEDENT tokens at EOF
    if (this.indentStack.length > 1) {
      this.indentStack.pop();
      return {
        type: 'DEDENT',
        value: '0',
        loc: { line: this.line, column: this.column },
      };
    }

    return {
      type: 'EOF',
      value: '',
      loc: { line: this.line, column: this.column },
    };
  }

  private isIdentifierStart(ch: string): boolean {
    return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_';
  }

  private isIdentifierPart(ch: string): boolean {
    return (
      (ch >= 'a' && ch <= 'z') ||
      (ch >= 'A' && ch <= 'Z') ||
      (ch >= '0' && ch <= '9') ||
      ch === '_'
    );
  }

  private readIdentifier(loc: SourceLocation): Token {
    let text = '';
    while (this.pos < this.source.length && this.isIdentifierPart(this.source[this.pos])) {
      text += this.source[this.pos];
      this.pos++;
      this.column++;
    }

    if (KEYWORDS.has(text)) {
      return { type: 'KEYWORD', value: text, loc };
    }
    return { type: 'IDENTIFIER', value: text, loc };
  }

  private readNumber(loc: SourceLocation): Token {
    let text = '';
    let hasDot = false;
    while (this.pos < this.source.length) {
      const c = this.source[this.pos];
      if (c >= '0' && c <= '9') {
        text += c;
        this.pos++;
        this.column++;
      } else if (c === '.' && !hasDot) {
        // Don't consume '.' if followed by an identifier start (e.g. `10.toStr()`)
        const nxt = this.source[this.pos + 1];
        if (nxt && this.isIdentifierStart(nxt)) break;
        hasDot = true;
        text += c;
        this.pos++;
        this.column++;
      } else {
        break;
      }
    }
    // Optional scientific notation: e.g. 1e5, 2.5e-3, 1E+9
    if (this.pos < this.source.length && (this.source[this.pos] === 'e' || this.source[this.pos] === 'E')) {
      let p = this.pos + 1;
      if (p < this.source.length && (this.source[p] === '+' || this.source[p] === '-')) p++;
      if (p < this.source.length && this.source[p] >= '0' && this.source[p] <= '9') {
        while (p < this.source.length && this.source[p] >= '0' && this.source[p] <= '9') p++;
        text += this.source.slice(this.pos, p);
        this.column += p - this.pos;
        this.pos = p;
      }
    }
    return { type: 'NUMBER', value: text, loc };
  }

  private readString(quote: string, loc: SourceLocation): Token {
    this.pos++; // skip open quote
    this.column++;
    let text = '';
    while (this.pos < this.source.length) {
      const c = this.source[this.pos];
      if (c === '\\') {
        if (this.pos + 1 < this.source.length) {
          text += this.source[this.pos + 1];
          this.pos += 2;
          this.column += 2;
          continue;
        }
      }
      if (c === quote) {
        this.pos++; // skip closing quote
        this.column++;
        break;
      }
      if (c === '\n') {
        this.line++;
        this.column = 1;
      } else {
        this.column++;
      }
      text += c;
      this.pos++;
    }
    return { type: 'STRING', value: text, loc };
  }
}

export function tokenize(source: string): Token[] {
  return new ScriptLexer(source).tokenize();
}
