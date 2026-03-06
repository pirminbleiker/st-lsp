/** Expression parsing — extracted from parser.ts */

import {
  ArrayLiteral,
  BinaryExpression,
  BoolLiteral,
  CallArgument,
  CallExpression,
  Expression,
  IntegerLiteral,
  MemberExpression,
  NameExpression,
  RealLiteral,
  StringLiteral,
  StructInitializer,
  SubscriptExpression,
  UnaryExpression,
} from './ast';
import { TokenKind } from './lexer';
import { isKeywordUsableAsIdentifier, ParserContext } from './core';

// ---------------------------------------------------------------------------
// Structural boundary tokens — expression parser must NOT consume these.
// When parsePrimaryExpression() encounters one of these, it stops without
// advancing so that the enclosing block/statement parser can terminate cleanly.
// ---------------------------------------------------------------------------
export const EXPRESSION_STOP_TOKENS = new Set<TokenKind>([
  TokenKind.END_IF, TokenKind.END_FOR, TokenKind.END_WHILE,
  TokenKind.END_REPEAT, TokenKind.END_CASE, TokenKind.END_VAR,
  TokenKind.END_PROGRAM, TokenKind.END_FUNCTION, TokenKind.END_FUNCTION_BLOCK,
  TokenKind.END_TYPE, TokenKind.END_STRUCT, TokenKind.END_ENUM,
  TokenKind.END_METHOD, TokenKind.END_PROPERTY, TokenKind.END_INTERFACE,
  TokenKind.ACTION, TokenKind.END_ACTION,
]);

// ---------------------------------------------------------------------------
// ExpressionParser — precedence-climbing expression parser
// ---------------------------------------------------------------------------
//   expression
//   or (OR, OR_ELSE, XOR)
//   and (AND, AND_THEN)
//   comparison (=, <>, <, >, <=, >=)
//   addition (+, -)
//   multiplication (*, /, MOD)
//   power (**)
//   unary (NOT, -)
//   postfix (call, subscript, member)
//   primary

export class ExpressionParser extends ParserContext {

  protected parseExpression(): Expression {
    return this.parseOr();
  }

  private parseOr(): Expression {
    let left = this.parseAnd();
    while (this.check(TokenKind.OR) || this.check(TokenKind.OR_ELSE) || this.check(TokenKind.XOR)) {
      const opTok = this.advance();
      const right = this.parseAnd();
      left = this.binary(opTok.kind, left, right);
    }
    return left;
  }

  private parseAnd(): Expression {
    let left = this.parseComparison();
    while (this.check(TokenKind.AND) || this.check(TokenKind.AND_THEN)) {
      const opTok = this.advance();
      const right = this.parseComparison();
      left = this.binary(opTok.kind, left, right);
    }
    return left;
  }

  private parseComparison(): Expression {
    let left = this.parseAddition();
    while (
      this.check(TokenKind.EQ) ||
      this.check(TokenKind.NEQ) ||
      this.check(TokenKind.LT) ||
      this.check(TokenKind.GT) ||
      this.check(TokenKind.LTE) ||
      this.check(TokenKind.GTE)
    ) {
      const opTok = this.advance();
      const right = this.parseAddition();
      left = this.binary(opTok.kind, left, right);
    }
    return left;
  }

  private parseAddition(): Expression {
    let left = this.parseMultiplication();
    while (this.check(TokenKind.PLUS) || this.check(TokenKind.MINUS)) {
      const opTok = this.advance();
      const right = this.parseMultiplication();
      left = this.binary(opTok.kind, left, right);
    }
    return left;
  }

  private parseMultiplication(): Expression {
    let left = this.parsePower();
    while (
      this.check(TokenKind.STAR) ||
      this.check(TokenKind.SLASH) ||
      this.check(TokenKind.MOD)
    ) {
      const opTok = this.advance();
      const right = this.parsePower();
      left = this.binary(opTok.kind, left, right);
    }
    return left;
  }

  private parsePower(): Expression {
    let left = this.parseUnary();
    while (this.check(TokenKind.POWER)) {
      const opTok = this.advance();
      const right = this.parseUnary();
      left = this.binary(opTok.kind, left, right);
    }
    return left;
  }

  private parseUnary(): Expression {
    if (this.check(TokenKind.NOT)) {
      const start = this.startRange();
      const opTok = this.advance();
      const operand = this.parseUnary();
      return {
        kind: 'UnaryExpression',
        op: opTok.text,
        operand,
        range: this.endRange(start),
      } as UnaryExpression;
    }
    if (this.check(TokenKind.MINUS)) {
      const start = this.startRange();
      const opTok = this.advance();
      const operand = this.parseUnary();
      return {
        kind: 'UnaryExpression',
        op: opTok.text,
        operand,
        range: this.endRange(start),
      } as UnaryExpression;
    }
    return this.parsePostfixExpression();
  }

  protected parsePostfixExpression(): Expression {
    let expr = this.parsePrimary();

    while (true) {
      if (this.check(TokenKind.LPAREN)) {
        // Function/method call
        const start = expr.range.start;
        const args = this.parseCallArgs();
        expr = {
          kind: 'CallExpression',
          callee: expr,
          args,
          range: this.endRange(start),
        } as CallExpression;
      } else if (this.check(TokenKind.LBRACKET)) {
        // Array subscript — supports multi-dimensional: arr[i,j,k]
        const start = expr.range.start;
        this.advance(); // [
        const indices: Expression[] = [this.parseExpression()];
        while (this.match(TokenKind.COMMA)) {
          indices.push(this.parseExpression());
        }
        this.expect(TokenKind.RBRACKET, "Expected ']'");
        expr = {
          kind: 'SubscriptExpression',
          base: expr,
          indices,
          range: this.endRange(start),
        } as SubscriptExpression;
      } else if (this.check(TokenKind.CARET)) {
        // Pointer dereference — consume '^' transparently.
        // The LSP treats `ptr^.member` the same as `ptr.member` for navigation.
        this.advance();
      } else if (this.check(TokenKind.DOT)) {
        // Member access — also accept integer literals for bit-access syntax
        // (e.g. pByte^.0, myWord.7, varName.0)
        const start = expr.range.start;
        this.advance(); // .
        const memberTok = this.check(TokenKind.INTEGER)
          ? this.advance()
          : this.expect(TokenKind.IDENTIFIER, 'Expected member name');
        expr = {
          kind: 'MemberExpression',
          base: expr,
          member: memberTok.text,
          range: this.endRange(start),
        } as MemberExpression;
      } else {
        break;
      }
    }

    return expr;
  }

  protected parseCallArgs(): CallArgument[] {
    this.advance(); // (
    const args: CallArgument[] = [];

    if (!this.check(TokenKind.RPAREN)) {
      do {
        args.push(this.parseCallArgument());
      } while (this.match(TokenKind.COMMA));
    }

    this.expect(TokenKind.RPAREN, "Expected ')'");
    return args;
  }

  protected parseCallArgument(): CallArgument {
    // Check for named argument: name := value  or  name => value
    if (
      this.check(TokenKind.IDENTIFIER) &&
      (this.peek(1).kind === TokenKind.ASSIGN || this.peek(1).kind === TokenKind.OUTPUT_ASSIGN)
    ) {
      const nameTok = this.advance();
      const assignTok = this.advance();
      const value = this.parseExpression();
      return {
        name: nameTok.text,
        value,
        isOutput: assignTok.kind === TokenKind.OUTPUT_ASSIGN,
      };
    }
    const value = this.parseExpression();
    return { value };
  }

  private parsePrimary(): Expression {
    const tok = this.peek();

    switch (tok.kind) {
      case TokenKind.INTEGER: {
        this.advance();
        const raw = tok.text.replace(/_/g, '');
        return { kind: 'IntegerLiteral', value: parseInt(raw, 10), raw: tok.text, range: tok.range } as IntegerLiteral;
      }

      case TokenKind.REAL: {
        this.advance();
        const raw = tok.text.replace(/_/g, '');
        return { kind: 'RealLiteral', value: parseFloat(raw), raw: tok.text, range: tok.range } as RealLiteral;
      }

      case TokenKind.STRING: {
        this.advance();
        // Strip surrounding quotes from raw
        const raw = tok.text;
        const inner = raw.length >= 2 ? raw.slice(1, -1) : raw;
        return { kind: 'StringLiteral', value: inner, raw, range: tok.range } as StringLiteral;
      }

      case TokenKind.TRUE:
        this.advance();
        return { kind: 'BoolLiteral', value: true, range: tok.range } as BoolLiteral;

      case TokenKind.FALSE:
        this.advance();
        return { kind: 'BoolLiteral', value: false, range: tok.range } as BoolLiteral;

      case TokenKind.LBRACKET: {
        // Array literal: [expr, expr, ...]
        const start = this.startRange();
        this.advance(); // [
        const elements: Expression[] = [];
        while (!this.check(TokenKind.RBRACKET) && !this.check(TokenKind.EOF)) {
          elements.push(this.parseExpression());
          if (!this.match(TokenKind.COMMA)) break;
          // Allow trailing comma before ]
          if (this.check(TokenKind.RBRACKET)) break;
        }
        this.expect(TokenKind.RBRACKET, "Expected ']'");
        return {
          kind: 'ArrayLiteral',
          elements,
          range: this.endRange(start),
        } as ArrayLiteral;
      }

      case TokenKind.LPAREN: {
        // Check for struct initializer: (field := value, ...)
        if (
          this.peek(1).kind === TokenKind.IDENTIFIER &&
          this.peek(2).kind === TokenKind.ASSIGN
        ) {
          const initStart = this.startRange();
          this.advance(); // (
          const fields: CallArgument[] = [];
          do {
            fields.push(this.parseCallArgument());
          } while (this.match(TokenKind.COMMA));
          this.expect(TokenKind.RPAREN, "Expected ')'");
          return {
            kind: 'StructInitializer',
            fields,
            range: this.endRange(initStart),
          } as StructInitializer;
        }
        this.advance(); // (
        const inner = this.parseExpression();
        this.expect(TokenKind.RPAREN, "Expected ')'");
        return inner;
      }

      case TokenKind.IDENTIFIER: {
        this.advance();
        return {
          kind: 'NameExpression',
          name: tok.text,
          range: tok.range,
        } as NameExpression;
      }

      case TokenKind.SUPER: {
        // SUPER^ — pointer dereference of the parent FB instance.
        // Consume SUPER and the optional '^' that follows it so that
        // the postfix loop can then handle the trailing '.member' access.
        this.advance(); // SUPER
        if (this.peek().kind === TokenKind.CARET) {
          this.advance(); // ^
        }
        return { kind: 'NameExpression', name: 'SUPER', range: tok.range } as NameExpression;
      }

      case TokenKind.THIS: {
        // THIS^ — pointer dereference of the current FB instance.
        // Works identically to SUPER^: consume THIS (and optional ^) so the
        // postfix loop handles the trailing '.member' / '(...)' access.
        this.advance(); // THIS
        if (this.peek().kind === TokenKind.CARET) {
          this.advance(); // ^
        }
        return { kind: 'NameExpression', name: 'THIS', range: tok.range } as NameExpression;
      }

      default:
        // Many keywords can be used as identifiers in context (e.g. type names)
        if (isKeywordUsableAsIdentifier(tok.kind)) {
          this.advance();
          return { kind: 'NameExpression', name: tok.text, range: tok.range } as NameExpression;
        }

        // Structural boundary keywords should NOT be consumed — let the
        // calling statement/block parser see them and break its loop.
        // This prevents cascade errors where e.g. END_VAR is eaten and
        // then the VAR block never finds its terminator.
        if (EXPRESSION_STOP_TOKENS.has(tok.kind)) {
          this.addError(`Unexpected token '${tok.text}' in expression`, tok.range);
          // Do NOT advance — the end keyword stays for the parent parser
          return { kind: 'NameExpression', name: '', range: tok.range } as NameExpression;
        }

        this.addError(`Unexpected token '${tok.text}' in expression`, tok.range);
        // Advance to prevent infinite loops in statement parsing loops
        this.advance();
        return { kind: 'NameExpression', name: '', range: tok.range } as NameExpression;
    }
  }

  protected binary(op: string, left: Expression, right: Expression): BinaryExpression {
    return {
      kind: 'BinaryExpression',
      op,
      left,
      right,
      range: { start: left.range.start, end: right.range.end },
    };
  }
}
