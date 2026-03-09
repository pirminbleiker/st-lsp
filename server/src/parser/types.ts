/** Type reference parsing — extracted from parser.ts */

import {
  ArrayDim,
  EnumValue,
  Expression,
  Position,
  TypeRef,
} from './ast';
import { Token, TokenKind } from './lexer';
import { ExpressionParser } from './expressions';

// ---------------------------------------------------------------------------
// TypeParser — type reference parsing
// ---------------------------------------------------------------------------

export class TypeParser extends ExpressionParser {

  protected parseTypeRef(): TypeRef {
    const start = this.startRange();

    // POINTER TO <type>
    if (this.peek().kind === TokenKind.POINTER) {
      const pointerTok = this.advance();
      this.expectIdentifier('TO', "Expected 'TO' after 'POINTER'");
      const inner = this.parseTypeRef();
      return {
        kind: 'TypeRef',
        name: inner.name,
        nameRange: inner.nameRange,
        isPointer: true,
        range: this.endRange(start),
      };
    }

    // REFERENCE TO <type>
    if (this.peek().kind === TokenKind.REFERENCE) {
      this.advance();
      this.expectIdentifier('TO', "Expected 'TO' after 'REFERENCE'");
      const inner = this.parseTypeRef();
      return {
        kind: 'TypeRef',
        name: inner.name,
        nameRange: inner.nameRange,
        isReference: true,
        range: this.endRange(start),
      };
    }

    // ARRAY[dims] OF <type>
    if (this.peek().text.toUpperCase() === 'ARRAY') {
      this.advance(); // ARRAY
      this.expect(TokenKind.LBRACKET, "Expected '[' after 'ARRAY'");
      const dims = this.parseArrayDims();
      this.expect(TokenKind.RBRACKET, "Expected ']'");
      this.expectIdentifier('OF', "Expected 'OF' after array dimensions");
      const baseType = this.parseTypeRef();
      return {
        kind: 'TypeRef',
        name: baseType.name,
        nameRange: baseType.nameRange,
        isArray: true,
        arrayDims: dims,
        range: this.endRange(start),
      };
    }

    // Anonymous inline enum in VAR declarations: (A, B, C) or (A := 1, B := 2)
    if (this.check(TokenKind.LPAREN)) {
      return this.parseInlineEnumTypeRef(start);
    }

    // Simple type name, possibly qualified (e.g. __SYSTEM.IQueryInterface)
    const nameTok = this.advance();
    let name = nameTok.text;
    while (this.check(TokenKind.DOT) && this.peek(1).kind === TokenKind.IDENTIFIER) {
      this.advance(); // consume '.'
      name += '.' + this.advance().text;
    }
    const nameRange = this.endRange(start);
    return {
      kind: 'TypeRef',
      name: name.toUpperCase(),
      nameRange,
      range: nameRange,
    };
  }

  private parseInlineEnumTypeRef(typeStart: Position): TypeRef {
    const lparen = this.expect(TokenKind.LPAREN, "Expected '(' to start inline enum type");
    const values: EnumValue[] = [];

    while (!this.check(TokenKind.RPAREN) && !this.check(TokenKind.EOF)) {
      const valueStart = this.startRange();
      const valueTok = this.expect(TokenKind.IDENTIFIER, 'Expected enum member name');
      let value: Expression | undefined;
      if (this.match(TokenKind.ASSIGN)) {
        value = this.parseExpression();
      }
      values.push({ name: valueTok.text, value, range: this.endRange(valueStart) });
      if (!this.match(TokenKind.COMMA)) break;
    }

    this.expect(TokenKind.RPAREN, "Expected ')' after inline enum type");

    return {
      kind: 'TypeRef',
      name: '__INLINE_ENUM',
      nameRange: lparen.range,
      inlineEnumValues: values,
      range: this.endRange(typeStart),
    };
  }

  private parseArrayDims(): ArrayDim[] {
    const dims: ArrayDim[] = [];
    do {
      const low = this.parseRangeComponent();
      this.expect(TokenKind.DOTDOT, "Expected '..'");
      const high = this.parseRangeComponent();
      dims.push({ low, high });
    } while (this.match(TokenKind.COMMA));
    return dims;
  }

  /** Parse a dimension bound — may be a numeric literal or identifier. */
  private parseRangeComponent(): string {
    const tok = this.peek();
    if (tok.kind === TokenKind.INTEGER || tok.kind === TokenKind.IDENTIFIER) {
      this.advance();
      return tok.text;
    }
    if (tok.kind === TokenKind.MINUS) {
      this.advance();
      const num = this.peek();
      if (num.kind === TokenKind.INTEGER) {
        this.advance();
        return '-' + num.text;
      }
    }
    this.addError('Expected array dimension bound', tok.range);
    return '0';
  }

  protected expectIdentifier(text: string, message: string): Token {
    const tok = this.peek();
    if (tok.kind === TokenKind.IDENTIFIER && tok.text.toUpperCase() === text.toUpperCase()) {
      return this.advance();
    }
    // Also allow the word as a keyword token (e.g. OF is a keyword)
    if (tok.text.toUpperCase() === text.toUpperCase()) {
      return this.advance();
    }
    this.addError(message, tok.range);
    return tok;
  }
}
