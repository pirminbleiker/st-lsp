/** Variable declaration parsing — extracted from parser.ts */

import {
  CallArgument,
  Expression,
  Pragma,
  TypeRef,
  VarBlock,
  VarDeclaration,
  VarKind,
} from './ast';
import { Token, TokenKind } from './lexer';
import { TypeParser } from './types';

// ---------------------------------------------------------------------------
// VariableParser — VAR block and declaration parsing
// ---------------------------------------------------------------------------

export class VariableParser extends TypeParser {

  // ---- Pragmas -----------------------------------------------------------

  protected parsePragmas(): Pragma[] {
    const pragmas: Pragma[] = [];
    while (this.check(TokenKind.PRAGMA)) {
      const tok = this.advance();
      pragmas.push(this.parsePragmaToken(tok));
    }
    return pragmas;
  }

  private parsePragmaToken(tok: Token): Pragma {
    const raw = tok.text;
    // Extract content between braces
    const inner = raw.slice(1, raw.endsWith('}') ? raw.length - 1 : raw.length).trim();
    // Match: attribute 'name' or attribute 'name' := 'value'
    const m = inner.match(/^attribute\s+'([^']+)'(?:\s*:=\s*'([^']*)')?/i);
    if (m) {
      return { kind: 'Pragma', name: m[1], value: m[2], raw, range: tok.range };
    }
    // Unknown pragma form — use the inner text as name
    return { kind: 'Pragma', name: inner, raw, range: tok.range };
  }

  // ---- VAR blocks -------------------------------------------------------

  private readonly VAR_KEYWORDS: ReadonlySet<TokenKind> = new Set([
    TokenKind.VAR,
    TokenKind.VAR_INPUT,
    TokenKind.VAR_OUTPUT,
    TokenKind.VAR_IN_OUT,
    TokenKind.VAR_GLOBAL,
    TokenKind.VAR_EXTERNAL,
    TokenKind.VAR_TEMP,
    TokenKind.VAR_STAT,
    TokenKind.VAR_CONFIG,
  ]);

  protected parseVarBlocks(): VarBlock[] {
    const blocks: VarBlock[] = [];
    while (this.VAR_KEYWORDS.has(this.peek().kind) || this.check(TokenKind.PRAGMA)) {
      // Skip pragmas that appear before a VAR keyword (rare but valid)
      while (this.check(TokenKind.PRAGMA)) this.advance();
      if (this.VAR_KEYWORDS.has(this.peek().kind)) {
        blocks.push(this.parseVarBlock());
      }
    }
    return blocks;
  }

  private parseVarBlock(): VarBlock {
    const start = this.startRange();
    const kindTok = this.advance();
    const varKind = kindTok.kind as VarKind;

    // Consume optional qualifier: CONSTANT, RETAIN, or PERSISTENT
    let constant: boolean | undefined;
    let retain: boolean | undefined;
    let persistent: boolean | undefined;
    if (this.check(TokenKind.CONSTANT)) { this.advance(); constant = true; }
    else if (this.check(TokenKind.RETAIN)) { this.advance(); retain = true; }
    else if (this.check(TokenKind.PERSISTENT)) { this.advance(); persistent = true; }

    const declarations: VarDeclaration[] = [];
    while (!this.check(TokenKind.END_VAR) && !this.check(TokenKind.EOF)) {
      // Check for trailing/unnecessary semicolon before END_VAR
      if (this.check(TokenKind.SEMICOLON)) {
        const semiTok = this.advance();
        // Consume the extra semicolon and log a warning
        this.errors.push({
          message: 'Unnecessary semicolon in VAR block',
          range: semiTok.range,
          severity: 'warning',
          code: 'unnecessary-semicolon',
        });
        // Continue the loop to check for more issues
        continue;
      }

      const before = this.pos;
      try {
        declarations.push(...this.parseVarDeclarations());
      } catch {
        // Skip to next semicolon for recovery
        this.skipToSemicolon();
      }
      if (this.pos === before) {
        // No progress — break to avoid infinite loop (the END_VAR check
        // above should catch this, but guard against other stuck states).
        break;
      }
    }
    this.expect(TokenKind.END_VAR, "Expected 'END_VAR'");

    return { kind: 'VarBlock', varKind, constant, retain, persistent, declarations, range: this.endRange(start) };
  }

  /**
   * Parse one or more VarDeclarations. Multi-variable declarations like
   * `a, b, c : BOOL;` are valid IEC 61131-3 but bad practice — each variable
   * is emitted as its own VarDeclaration and a warning is reported.
   */
  protected parseVarDeclarations(): VarDeclaration[] {
    const pragmas = this.parsePragmas();
    const start = pragmas.length > 0 ? pragmas[0].range.start : this.startRange();
    const nameTok = this.expectName('Expected variable name');

    // Check for multi-variable declaration: name, name, name : Type;
    const names: Token[] = [nameTok];
    while (this.match(TokenKind.COMMA)) {
      names.push(this.expectName('Expected variable name after comma'));
    }

    this.expect(TokenKind.COLON, "Expected ':' after variable name");
    const type = this.parseTypeRef();

    let initArgs: CallArgument[] | undefined;
    if (this.check(TokenKind.LPAREN)) {
      if (this.isSizedStringType(type)) {
        // STRING(80) / WSTRING(80) are sized type suffixes, not constructor init args.
        this.parseCallArgs();
      } else {
        initArgs = this.parseCallArgs();
      }
    }

    let initialValue: Expression | undefined;
    if (this.match(TokenKind.ASSIGN) || this.match(TokenKind.REF_ASSIGN)) {
      initialValue = this.parseExpression();
    }

    this.expect(TokenKind.SEMICOLON, "Expected ';'");
    const endPos = this.endRange(start);

    // Multi-variable: emit warning and split into individual declarations
    if (names.length > 1) {
      this.errors.push({
        message: `Multi-variable declaration '${names.map(n => n.text).join(', ')}' — consider splitting into separate lines`,
        range: { start: names[0].range.start, end: names[names.length - 1].range.end },
        severity: 'warning' as const,
        code: 'multi-variable-declaration',
      });
      return names.map(n => ({
        kind: 'VarDeclaration' as const,
        name: n.text,
        nameRange: n.range,
        pragmas,
        type,
        initArgs,
        initialValue,
        range: endPos,
      }));
    }

    return [{ kind: 'VarDeclaration', name: nameTok.text, nameRange: nameTok.range, pragmas, type, initArgs, initialValue, range: endPos }];
  }

  private isSizedStringType(type: TypeRef): boolean {
    const upper = type.name.toUpperCase();
    return upper === 'STRING' || upper === 'WSTRING';
  }
}
