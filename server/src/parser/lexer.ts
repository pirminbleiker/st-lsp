/** IEC 61131-3 Structured Text lexer */

import { Position, Range } from './ast';

// ---------------------------------------------------------------------------
// Token kinds
// ---------------------------------------------------------------------------

export enum TokenKind {
  // Keywords
  PROGRAM = 'PROGRAM',
  END_PROGRAM = 'END_PROGRAM',
  FUNCTION_BLOCK = 'FUNCTION_BLOCK',
  END_FUNCTION_BLOCK = 'END_FUNCTION_BLOCK',
  FUNCTION = 'FUNCTION',
  END_FUNCTION = 'END_FUNCTION',
  VAR = 'VAR',
  VAR_INPUT = 'VAR_INPUT',
  VAR_OUTPUT = 'VAR_OUTPUT',
  VAR_IN_OUT = 'VAR_IN_OUT',
  VAR_GLOBAL = 'VAR_GLOBAL',
  VAR_EXTERNAL = 'VAR_EXTERNAL',
  END_VAR = 'END_VAR',
  IF = 'IF',
  THEN = 'THEN',
  ELSE = 'ELSE',
  ELSIF = 'ELSIF',
  END_IF = 'END_IF',
  FOR = 'FOR',
  TO = 'TO',
  BY = 'BY',
  DO = 'DO',
  END_FOR = 'END_FOR',
  WHILE = 'WHILE',
  END_WHILE = 'END_WHILE',
  REPEAT = 'REPEAT',
  UNTIL = 'UNTIL',
  END_REPEAT = 'END_REPEAT',
  CASE = 'CASE',
  OF = 'OF',
  END_CASE = 'END_CASE',
  RETURN = 'RETURN',
  EXIT = 'EXIT',
  NOT = 'NOT',
  AND = 'AND',
  OR = 'OR',
  XOR = 'XOR',
  MOD = 'MOD',
  TRUE = 'TRUE',
  FALSE = 'FALSE',
  TYPE = 'TYPE',
  END_TYPE = 'END_TYPE',
  STRUCT = 'STRUCT',
  END_STRUCT = 'END_STRUCT',
  ENUM = 'ENUM',
  END_ENUM = 'END_ENUM',
  METHOD = 'METHOD',
  END_METHOD = 'END_METHOD',
  PROPERTY = 'PROPERTY',
  END_PROPERTY = 'END_PROPERTY',
  INTERFACE = 'INTERFACE',
  END_INTERFACE = 'END_INTERFACE',
  EXTENDS = 'EXTENDS',
  IMPLEMENTS = 'IMPLEMENTS',
  ABSTRACT = 'ABSTRACT',
  OVERRIDE = 'OVERRIDE',
  FINAL_KW = 'FINAL',
  CONTINUE = 'CONTINUE',
  VAR_TEMP = 'VAR_TEMP',
  VAR_STAT = 'VAR_STAT',
  VAR_CONFIG = 'VAR_CONFIG',
  NAMESPACE = 'NAMESPACE',
  END_NAMESPACE = 'END_NAMESPACE',
  UNION = 'UNION',
  END_UNION = 'END_UNION',
  SUPER = 'SUPER',
  PUBLIC = 'PUBLIC',
  PRIVATE = 'PRIVATE',
  PROTECTED = 'PROTECTED',
  INTERNAL = 'INTERNAL',

  // Literals
  INTEGER = 'INTEGER',
  REAL = 'REAL',
  STRING = 'STRING',

  // Identifiers
  IDENTIFIER = 'IDENTIFIER',

  // Operators
  ASSIGN = ':=',         // :=
  OUTPUT_ASSIGN = '=>',  // =>
  EQ = '=',
  NEQ = '<>',
  LT = '<',
  GT = '>',
  LTE = '<=',
  GTE = '>=',
  PLUS = '+',
  MINUS = '-',
  STAR = '*',
  SLASH = '/',
  POWER = '**',

  // Punctuation
  LPAREN = '(',
  RPAREN = ')',
  LBRACKET = '[',
  RBRACKET = ']',
  COMMA = ',',
  SEMICOLON = ';',
  COLON = ':',
  DOT = '.',
  DOTDOT = '..',

  // Special
  EOF = 'EOF',
  COMMENT = 'COMMENT',
}

const KEYWORDS: ReadonlyMap<string, TokenKind> = new Map([
  ['PROGRAM', TokenKind.PROGRAM],
  ['END_PROGRAM', TokenKind.END_PROGRAM],
  ['FUNCTION_BLOCK', TokenKind.FUNCTION_BLOCK],
  ['END_FUNCTION_BLOCK', TokenKind.END_FUNCTION_BLOCK],
  ['FUNCTION', TokenKind.FUNCTION],
  ['END_FUNCTION', TokenKind.END_FUNCTION],
  ['VAR', TokenKind.VAR],
  ['VAR_INPUT', TokenKind.VAR_INPUT],
  ['VAR_OUTPUT', TokenKind.VAR_OUTPUT],
  ['VAR_IN_OUT', TokenKind.VAR_IN_OUT],
  ['VAR_GLOBAL', TokenKind.VAR_GLOBAL],
  ['VAR_EXTERNAL', TokenKind.VAR_EXTERNAL],
  ['END_VAR', TokenKind.END_VAR],
  ['IF', TokenKind.IF],
  ['THEN', TokenKind.THEN],
  ['ELSE', TokenKind.ELSE],
  ['ELSIF', TokenKind.ELSIF],
  ['END_IF', TokenKind.END_IF],
  ['FOR', TokenKind.FOR],
  ['TO', TokenKind.TO],
  ['BY', TokenKind.BY],
  ['DO', TokenKind.DO],
  ['END_FOR', TokenKind.END_FOR],
  ['WHILE', TokenKind.WHILE],
  ['END_WHILE', TokenKind.END_WHILE],
  ['REPEAT', TokenKind.REPEAT],
  ['UNTIL', TokenKind.UNTIL],
  ['END_REPEAT', TokenKind.END_REPEAT],
  ['CASE', TokenKind.CASE],
  ['OF', TokenKind.OF],
  ['END_CASE', TokenKind.END_CASE],
  ['RETURN', TokenKind.RETURN],
  ['EXIT', TokenKind.EXIT],
  ['NOT', TokenKind.NOT],
  ['AND', TokenKind.AND],
  ['OR', TokenKind.OR],
  ['XOR', TokenKind.XOR],
  ['MOD', TokenKind.MOD],
  ['TRUE', TokenKind.TRUE],
  ['FALSE', TokenKind.FALSE],
  ['TYPE', TokenKind.TYPE],
  ['END_TYPE', TokenKind.END_TYPE],
  ['STRUCT', TokenKind.STRUCT],
  ['END_STRUCT', TokenKind.END_STRUCT],
  ['ENUM', TokenKind.ENUM],
  ['END_ENUM', TokenKind.END_ENUM],
  ['METHOD', TokenKind.METHOD],
  ['END_METHOD', TokenKind.END_METHOD],
  ['PROPERTY', TokenKind.PROPERTY],
  ['END_PROPERTY', TokenKind.END_PROPERTY],
  ['INTERFACE', TokenKind.INTERFACE],
  ['END_INTERFACE', TokenKind.END_INTERFACE],
  ['EXTENDS', TokenKind.EXTENDS],
  ['IMPLEMENTS', TokenKind.IMPLEMENTS],
  ['ABSTRACT', TokenKind.ABSTRACT],
  ['OVERRIDE', TokenKind.OVERRIDE],
  ['FINAL', TokenKind.FINAL_KW],
  ['CONTINUE', TokenKind.CONTINUE],
  ['VAR_TEMP', TokenKind.VAR_TEMP],
  ['VAR_STAT', TokenKind.VAR_STAT],
  ['VAR_CONFIG', TokenKind.VAR_CONFIG],
  ['NAMESPACE', TokenKind.NAMESPACE],
  ['END_NAMESPACE', TokenKind.END_NAMESPACE],
  ['UNION', TokenKind.UNION],
  ['END_UNION', TokenKind.END_UNION],
  ['SUPER', TokenKind.SUPER],
  ['PUBLIC', TokenKind.PUBLIC],
  ['PRIVATE', TokenKind.PRIVATE],
  ['PROTECTED', TokenKind.PROTECTED],
  ['INTERNAL', TokenKind.INTERNAL],
]);

export interface Token {
  kind: TokenKind;
  text: string;
  range: Range;
}

// ---------------------------------------------------------------------------
// Lexer
// ---------------------------------------------------------------------------

export class Lexer {
  private pos = 0;
  private line = 0;
  private character = 0;
  private readonly src: string;

  constructor(src: string) {
    this.src = src;
  }

  tokenize(): Token[] {
    const tokens: Token[] = [];
    while (true) {
      const tok = this.nextToken();
      tokens.push(tok);
      if (tok.kind === TokenKind.EOF) break;
    }
    return tokens;
  }

  private peek(offset = 0): string {
    return this.src[this.pos + offset] ?? '';
  }

  private advance(): string {
    const ch = this.src[this.pos++];
    if (ch === '\n') {
      this.line++;
      this.character = 0;
    } else {
      this.character++;
    }
    return ch;
  }

  private currentPos(): Position {
    return { line: this.line, character: this.character };
  }

  private makeRange(start: Position): Range {
    return { start, end: this.currentPos() };
  }

  private skipWhitespace(): void {
    while (this.pos < this.src.length) {
      const ch = this.peek();
      if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') {
        this.advance();
      } else {
        break;
      }
    }
  }

  private tryReadComment(): Token | null {
    const ch = this.peek();
    if (ch === '(' && this.peek(1) === '*') {
      const startPos = this.currentPos();
      let text = this.advance() + this.advance(); // (*
      while (this.pos < this.src.length) {
        if (this.peek() === '*' && this.peek(1) === ')') {
          text += this.advance() + this.advance(); // *)
          break;
        }
        text += this.advance();
      }
      return { kind: TokenKind.COMMENT, text, range: this.makeRange(startPos) };
    }
    if (ch === '/' && this.peek(1) === '/') {
      const startPos = this.currentPos();
      let text = '';
      while (this.pos < this.src.length && this.peek() !== '\n') {
        text += this.advance();
      }
      return { kind: TokenKind.COMMENT, text, range: this.makeRange(startPos) };
    }
    return null;
  }

  private skipWhitespaceAndComments(): void {
    this.skipWhitespace();
    while (this.pos < this.src.length && this.tryReadComment() !== null) {
      this.skipWhitespace();
    }
  }

  /** Tokenize the source, emitting COMMENT tokens in addition to regular tokens. */
  tokenizeWithTrivia(): Token[] {
    const tokens: Token[] = [];
    while (true) {
      this.skipWhitespace();
      let comment: Token | null;
      while ((comment = this.tryReadComment()) !== null) {
        tokens.push(comment);
        this.skipWhitespace();
      }
      // nextToken() calls skipWhitespaceAndComments() internally; at this point
      // there is no whitespace or comments left, so it is a no-op there.
      const tok = this.nextToken();
      tokens.push(tok);
      if (tok.kind === TokenKind.EOF) break;
    }
    return tokens;
  }

  private nextToken(): Token {
    this.skipWhitespaceAndComments();

    if (this.pos >= this.src.length) {
      const pos = this.currentPos();
      return { kind: TokenKind.EOF, text: '', range: { start: pos, end: pos } };
    }

    const startPos = this.currentPos();
    const ch = this.peek();

    // Number literals
    if (ch >= '0' && ch <= '9') {
      return this.readNumber(startPos);
    }

    // String literals: 'text' or "text"
    if (ch === "'" || ch === '"') {
      return this.readString(startPos, ch);
    }

    // Identifiers and keywords
    if (isIdentStart(ch)) {
      return this.readIdentOrKeyword(startPos);
    }

    // Operators and punctuation
    return this.readSymbol(startPos);
  }

  private readNumber(startPos: Position): Token {
    let raw = '';
    let isReal = false;

    while (this.pos < this.src.length) {
      const c = this.peek();
      if (c >= '0' && c <= '9' || c === '_') {
        raw += this.advance();
      } else {
        break;
      }
    }

    // Check for decimal point (not .. range operator)
    if (this.peek() === '.' && this.peek(1) !== '.') {
      isReal = true;
      raw += this.advance(); // .
      while (this.pos < this.src.length) {
        const c = this.peek();
        if (c >= '0' && c <= '9' || c === '_') {
          raw += this.advance();
        } else {
          break;
        }
      }
    }

    // Exponent
    if (this.peek() === 'E' || this.peek() === 'e') {
      isReal = true;
      raw += this.advance();
      if (this.peek() === '+' || this.peek() === '-') {
        raw += this.advance();
      }
      while (this.pos < this.src.length && this.peek() >= '0' && this.peek() <= '9') {
        raw += this.advance();
      }
    }

    return {
      kind: isReal ? TokenKind.REAL : TokenKind.INTEGER,
      text: raw,
      range: this.makeRange(startPos),
    };
  }

  private readString(startPos: Position, quote: string): Token {
    this.advance(); // opening quote
    let value = quote;
    while (this.pos < this.src.length) {
      const c = this.advance();
      value += c;
      if (c === '$') {
        // escape sequence in ST strings
        if (this.pos < this.src.length) {
          value += this.advance();
        }
        continue;
      }
      if (c === quote) break;
    }
    return {
      kind: TokenKind.STRING,
      text: value,
      range: this.makeRange(startPos),
    };
  }

  private readIdentOrKeyword(startPos: Position): Token {
    let text = '';
    while (this.pos < this.src.length && isIdentContinue(this.peek())) {
      text += this.advance();
    }

    // ST is case-insensitive; normalise to uppercase for keyword lookup
    const upper = text.toUpperCase();
    const kind = KEYWORDS.get(upper) ?? TokenKind.IDENTIFIER;
    return { kind, text, range: this.makeRange(startPos) };
  }

  private readSymbol(startPos: Position): Token {
    const ch = this.advance();

    switch (ch) {
      case '(':
        return this.tok(TokenKind.LPAREN, ch, startPos);
      case ')':
        return this.tok(TokenKind.RPAREN, ch, startPos);
      case '[':
        return this.tok(TokenKind.LBRACKET, ch, startPos);
      case ']':
        return this.tok(TokenKind.RBRACKET, ch, startPos);
      case ',':
        return this.tok(TokenKind.COMMA, ch, startPos);
      case ';':
        return this.tok(TokenKind.SEMICOLON, ch, startPos);
      case '+':
        return this.tok(TokenKind.PLUS, ch, startPos);
      case '/':
        return this.tok(TokenKind.SLASH, ch, startPos);
      case '=':
        if (this.peek() === '>') {
          this.advance();
          return this.tok(TokenKind.OUTPUT_ASSIGN, '=>', startPos);
        }
        return this.tok(TokenKind.EQ, ch, startPos);

      case '-':
        return this.tok(TokenKind.MINUS, ch, startPos);

      case '*':
        if (this.peek() === '*') {
          this.advance();
          return this.tok(TokenKind.POWER, '**', startPos);
        }
        return this.tok(TokenKind.STAR, ch, startPos);

      case ':':
        if (this.peek() === '=') {
          this.advance();
          return this.tok(TokenKind.ASSIGN, ':=', startPos);
        }
        return this.tok(TokenKind.COLON, ch, startPos);

      case '>':
        if (this.peek() === '=') {
          this.advance();
          return this.tok(TokenKind.GTE, '>=', startPos);
        }
        return this.tok(TokenKind.GT, ch, startPos);

      case '<':
        if (this.peek() === '=') {
          this.advance();
          return this.tok(TokenKind.LTE, '<=', startPos);
        }
        if (this.peek() === '>') {
          this.advance();
          return this.tok(TokenKind.NEQ, '<>', startPos);
        }
        return this.tok(TokenKind.LT, ch, startPos);

      case '.':
        if (this.peek() === '.') {
          this.advance();
          return this.tok(TokenKind.DOTDOT, '..', startPos);
        }
        return this.tok(TokenKind.DOT, ch, startPos);

      default:
        // Unknown character — emit as identifier to allow recovery
        return this.tok(TokenKind.IDENTIFIER, ch, startPos);
    }
  }

  private tok(kind: TokenKind, text: string, startPos: Position): Token {
    return { kind, text, range: this.makeRange(startPos) };
  }
}

function isIdentStart(ch: string): boolean {
  return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_';
}

function isIdentContinue(ch: string): boolean {
  return isIdentStart(ch) || (ch >= '0' && ch <= '9');
}
