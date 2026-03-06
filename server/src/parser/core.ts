/** ParserContext — shared token navigation, error reporting, and recovery. */

import {
  NamedRef,
  ParseError,
  Position,
  Range,
} from './ast';
import { Token, TokenKind } from './lexer';

/** Some keywords can appear as identifiers in certain syntactic positions. */
export function isKeywordUsableAsIdentifier(kind: TokenKind): boolean {
  const keywordIdents = new Set<TokenKind>([
    TokenKind.OF, TokenKind.TO, TokenKind.BY, TokenKind.DO,
    TokenKind.MOD,
    TokenKind.PUBLIC, TokenKind.PRIVATE, TokenKind.PROTECTED, TokenKind.INTERNAL,
    TokenKind.ABSTRACT, TokenKind.OVERRIDE, TokenKind.FINAL_KW,
    TokenKind.ENUM,
  ]);
  return keywordIdents.has(kind);
}

export class ParserContext {
  protected tokens: Token[];
  protected pos = 0;
  readonly errors: ParseError[] = [];

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  // ---- Token navigation --------------------------------------------------

  protected peek(offset = 0): Token {
    const idx = this.pos + offset;
    return idx < this.tokens.length
      ? this.tokens[idx]
      : this.tokens[this.tokens.length - 1]; // EOF
  }

  protected advance(): Token {
    const tok = this.tokens[this.pos];
    if (this.pos < this.tokens.length - 1) this.pos++;
    return tok;
  }

  protected check(kind: TokenKind): boolean {
    return this.peek().kind === kind;
  }

  protected match(...kinds: TokenKind[]): Token | undefined {
    for (const k of kinds) {
      if (this.check(k)) return this.advance();
    }
    return undefined;
  }

  protected expect(kind: TokenKind, message?: string): Token {
    if (this.check(kind)) return this.advance();
    const tok = this.peek();
    this.addError(message ?? `Expected '${kind}', got '${tok.kind}'`, tok.range);
    return tok;
  }

  /** Accept any identifier-like token (IDENTIFIER or a keyword usable as a name) as a declaration name. */
  protected expectName(message: string): Token {
    const tok = this.peek();
    if (tok.kind === TokenKind.IDENTIFIER || isKeywordUsableAsIdentifier(tok.kind)) {
      return this.advance();
    }
    this.addError(message, tok.range);
    return tok;
  }

  protected addError(message: string, range: Range): void {
    this.errors.push({ message, range });
  }

  protected startRange(): Position {
    return this.peek().range.start;
  }

  protected endRange(start: Position): Range {
    const prev = this.tokens[Math.max(0, this.pos - 1)];
    return { start, end: prev.range.end };
  }

  // ---- Recovery ----------------------------------------------------------

  protected skipToSemicolon(): void {
    const endKeywords = new Set([
      TokenKind.END_IF, TokenKind.END_FOR, TokenKind.END_WHILE,
      TokenKind.END_REPEAT, TokenKind.END_CASE, TokenKind.END_VAR,
      TokenKind.END_PROGRAM, TokenKind.END_FUNCTION, TokenKind.END_FUNCTION_BLOCK,
      TokenKind.END_TYPE, TokenKind.END_STRUCT, TokenKind.END_ENUM,
      TokenKind.END_METHOD, TokenKind.END_PROPERTY, TokenKind.END_INTERFACE,
      TokenKind.ACTION, TokenKind.END_ACTION,
      TokenKind.EOF,
    ]);
    let bracketDepth = 0;
    while (!this.check(TokenKind.EOF)) {
      const kind = this.peek().kind;
      if (endKeywords.has(kind)) break;
      if (kind === TokenKind.LBRACKET) { bracketDepth++; this.advance(); continue; }
      if (kind === TokenKind.RBRACKET) {
        if (bracketDepth > 0) { bracketDepth--; this.advance(); continue; }
        break;
      }
      if (kind === TokenKind.SEMICOLON && bracketDepth === 0) break;
      this.advance();
    }
    this.match(TokenKind.SEMICOLON);
  }

  // ---- Qualified name helper ---------------------------------------------

  /**
   * Parse a qualified name of the form `IDENT(.IDENT)*` and return a NamedRef
   * whose name is the dot-joined string (e.g. `__SYSTEM.IQueryInterface`).
   */
  protected parseQualifiedName(errorMessage: string): NamedRef {
    const firstTok = this.expect(TokenKind.IDENTIFIER, errorMessage);
    let name = firstTok.text;
    let endPos = firstTok.range.end;

    while (this.check(TokenKind.DOT)) {
      this.advance(); // consume '.'
      const nextTok = this.expect(TokenKind.IDENTIFIER, "Expected identifier after '.'");
      name += '.' + nextTok.text;
      endPos = nextTok.range.end;
    }

    return { name, range: { start: firstTok.range.start, end: endPos } };
  }
}
