/** IEC 61131-3 Structured Text recursive-descent parser */

import {
  ParseError,
  SourceFile,
  TopLevelDeclaration,
} from './ast';
import { Lexer, TokenKind } from './lexer';
import { DeclarationParser } from './declarations';

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

class Parser extends DeclarationParser {

  // ---- Source file -------------------------------------------------------

  parseSourceFile(): SourceFile {
    const start = this.startRange();
    const declarations: TopLevelDeclaration[] = [];

    while (!this.check(TokenKind.EOF)) {
      try {
        // Collect leading pragma annotations before the declaration keyword
        const pragmas = this.parsePragmas();
        const decl = this.parseTopLevelDeclaration(pragmas);
        if (decl) declarations.push(decl);
      } catch {
        // Should not reach here; errors collected via addError
        this.advance();
      }
    }

    return {
      kind: 'SourceFile',
      declarations,
      range: this.endRange(start),
    };
  }

}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ParseResult {
  ast: SourceFile;
  errors: ParseError[];
}

/**
 * Parse IEC 61131-3 Structured Text source text.
 *
 * @param text - Source text to parse
 * @returns `{ ast, errors }` — AST is always returned even when errors occur;
 *   error recovery ensures as much of the tree is built as possible.
 */
export function parse(text: string): ParseResult {
  const lexer = new Lexer(text);
  const tokens = lexer.tokenize();
  const parser = new Parser(tokens);
  const ast = parser.parseSourceFile();
  return { ast, errors: parser.errors };
}
