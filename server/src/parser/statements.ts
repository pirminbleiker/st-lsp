/** Statement parsing — extracted from parser.ts */

import {
  AssignmentStatement,
  CallExpression,
  CallStatement,
  CaseClause,
  CaseStatement,
  CaseValue,
  ContinueStatement,
  ElsifClause,
  EmptyStatement,
  ExitStatement,
  Expression,
  ForStatement,
  IfStatement,
  Range,
  RepeatStatement,
  ReturnStatement,
  Statement,
  WhileStatement,
} from './ast';
import { TokenKind } from './lexer';
import { ExpressionParser, EXPRESSION_STOP_TOKENS } from './expressions';

// ---------------------------------------------------------------------------
// StatementParser — recursive-descent statement parser
// ---------------------------------------------------------------------------

export class StatementParser extends ExpressionParser {

  protected parseStatementList(...endKinds: TokenKind[]): Statement[] {
    const stmts: Statement[] = [];
    while (!this.check(TokenKind.EOF) && !endKinds.some(k => this.check(k))) {
      // Guard against infinite loops: if a parse cycle makes no progress
      // (e.g. a structural end keyword the caller wasn't expecting), break.
      const before = this.pos;
      try {
        const stmt = this.parseStatement();
        if (stmt) stmts.push(stmt);
      } catch {
        this.skipToSemicolon();
      }
      if (this.pos === before) {
        // No token was consumed — we're stuck on an unexpected token.
        // If it's a structural boundary, let the parent parser deal with it.
        if (EXPRESSION_STOP_TOKENS.has(this.peek().kind)) break;
        // Otherwise skip one token to avoid an infinite loop.
        this.advance();
      }
    }
    return stmts;
  }

  protected parseStatement(): Statement | null {
    const tok = this.peek();

    switch (tok.kind) {
      case TokenKind.SEMICOLON:
        this.advance();
        return this.emptyStatement(tok.range);

      case TokenKind.IF:
        return this.parseIfStatement();

      case TokenKind.FOR:
        return this.parseForStatement();

      case TokenKind.WHILE:
        return this.parseWhileStatement();

      case TokenKind.REPEAT:
        return this.parseRepeatStatement();

      case TokenKind.CASE:
        return this.parseCaseStatement();

      case TokenKind.RETURN: {
        const start = this.startRange();
        this.advance();
        this.match(TokenKind.SEMICOLON);
        return { kind: 'ReturnStatement', range: this.endRange(start) };
      }

      case TokenKind.EXIT: {
        const start = this.startRange();
        this.advance();
        this.match(TokenKind.SEMICOLON);
        return { kind: 'ExitStatement', range: this.endRange(start) };
      }

      case TokenKind.CONTINUE: {
        const start = this.startRange();
        this.advance();
        this.match(TokenKind.SEMICOLON);
        return { kind: 'ContinueStatement', range: this.endRange(start) } as ContinueStatement;
      }

      default:
        // Assignment or call statement
        return this.parseAssignmentOrCall();
    }
  }

  private emptyStatement(range: Range): EmptyStatement {
    return { kind: 'EmptyStatement', range };
  }

  private parseAssignmentOrCall(): Statement | null {
    const start = this.startRange();
    const left = this.parsePostfixExpression();

    // Assignment (:= or REF=)
    const assignTok = this.match(TokenKind.ASSIGN) ?? this.match(TokenKind.REF_ASSIGN);
    if (assignTok) {
      const right = this.parseExpression();
      this.expect(TokenKind.SEMICOLON, "Expected ';'");
      return {
        kind: 'AssignmentStatement',
        left,
        right,
        isRefAssign: assignTok.kind === TokenKind.REF_ASSIGN || undefined,
        range: this.endRange(start),
      } as AssignmentStatement;
    }

    // Function/method call as statement
    if (left.kind === 'CallExpression') {
      this.expect(TokenKind.SEMICOLON, "Expected ';'");
      const callExpr = left as CallExpression;
      return {
        kind: 'CallStatement',
        callee: callExpr.callee,
        args: callExpr.args,
        range: callExpr.range,
      } as CallStatement;
    }

    // Recovery: if we have a name followed by '(' it was a call parsed above.
    // Otherwise emit an error and skip.
    const curTok = this.peek();
    this.addError(`Unexpected expression statement`, curTok.range);
    this.skipToSemicolon();
    return null;
  }

  // ---- IF ---------------------------------------------------------------

  private parseIfStatement(): IfStatement {
    const start = this.startRange();
    this.advance(); // IF
    const condition = this.parseExpression();
    this.expect(TokenKind.THEN, "Expected 'THEN'");

    const then = this.parseStatementList(
      TokenKind.ELSIF, TokenKind.ELSE, TokenKind.END_IF
    );

    const elsifs: ElsifClause[] = [];
    while (this.match(TokenKind.ELSIF)) {
      const ec = this.parseExpression();
      this.expect(TokenKind.THEN, "Expected 'THEN'");
      const eb = this.parseStatementList(TokenKind.ELSIF, TokenKind.ELSE, TokenKind.END_IF);
      elsifs.push({ condition: ec, body: eb });
    }

    let elseBranch: Statement[] | undefined;
    if (this.match(TokenKind.ELSE)) {
      elseBranch = this.parseStatementList(TokenKind.END_IF);
    }

    this.expect(TokenKind.END_IF, "Expected 'END_IF'");

    return {
      kind: 'IfStatement',
      condition,
      then,
      elsifs,
      else: elseBranch,
      range: this.endRange(start),
    };
  }

  // ---- FOR --------------------------------------------------------------

  private parseForStatement(): ForStatement {
    const start = this.startRange();
    this.advance(); // FOR
    const varTok = this.expect(TokenKind.IDENTIFIER, 'Expected loop variable');
    this.expect(TokenKind.ASSIGN, "Expected ':='");
    const from = this.parseExpression();
    this.expect(TokenKind.TO, "Expected 'TO'");
    const to = this.parseExpression();

    let by: Expression | undefined;
    if (this.match(TokenKind.BY)) {
      by = this.parseExpression();
    }

    this.expect(TokenKind.DO, "Expected 'DO'");
    const body = this.parseStatementList(TokenKind.END_FOR);
    this.expect(TokenKind.END_FOR, "Expected 'END_FOR'");

    return {
      kind: 'ForStatement',
      variable: varTok.text,
      variableRange: varTok.range,
      from,
      to,
      by,
      body,
      range: this.endRange(start),
    };
  }

  // ---- WHILE ------------------------------------------------------------

  private parseWhileStatement(): WhileStatement {
    const start = this.startRange();
    this.advance(); // WHILE
    const condition = this.parseExpression();
    this.expect(TokenKind.DO, "Expected 'DO'");
    const body = this.parseStatementList(TokenKind.END_WHILE);
    this.expect(TokenKind.END_WHILE, "Expected 'END_WHILE'");

    return { kind: 'WhileStatement', condition, body, range: this.endRange(start) };
  }

  // ---- REPEAT -----------------------------------------------------------

  private parseRepeatStatement(): RepeatStatement {
    const start = this.startRange();
    this.advance(); // REPEAT
    const body = this.parseStatementList(TokenKind.UNTIL);
    this.expect(TokenKind.UNTIL, "Expected 'UNTIL'");
    const condition = this.parseExpression();
    this.expect(TokenKind.END_REPEAT, "Expected 'END_REPEAT'");

    return { kind: 'RepeatStatement', body, condition, range: this.endRange(start) };
  }

  // ---- CASE -------------------------------------------------------------

  private parseCaseStatement(): CaseStatement {
    const start = this.startRange();
    this.advance(); // CASE
    const expression = this.parseExpression();
    this.expect(TokenKind.OF, "Expected 'OF'");

    const cases: CaseClause[] = [];
    while (
      !this.check(TokenKind.ELSE) &&
      !this.check(TokenKind.END_CASE) &&
      !this.check(TokenKind.EOF)
    ) {
      cases.push(this.parseCaseClause());
    }

    let elseBranch: Statement[] | undefined;
    if (this.match(TokenKind.ELSE)) {
      elseBranch = this.parseStatementList(TokenKind.END_CASE);
    }

    this.expect(TokenKind.END_CASE, "Expected 'END_CASE'");

    return {
      kind: 'CaseStatement',
      expression,
      cases,
      else: elseBranch,
      range: this.endRange(start),
    };
  }

  private parseCaseClause(): CaseClause {
    const values: CaseValue[] = [];
    do {
      const low = this.parseExpression();
      if (this.match(TokenKind.DOTDOT)) {
        const high = this.parseExpression();
        values.push({ kind: 'range', low, high });
      } else {
        values.push({ kind: 'single', value: low });
      }
    } while (this.match(TokenKind.COMMA));

    this.expect(TokenKind.COLON, "Expected ':' after case values");

    // Parse the body, stopping when we see the start of a new case clause,
    // ELSE, or END_CASE. A new case clause starts with an expression followed
    // by ':' (COLON, not ASSIGN ':=').
    const body: Statement[] = [];
    while (
      !this.check(TokenKind.ELSE) &&
      !this.check(TokenKind.END_CASE) &&
      !this.check(TokenKind.EOF) &&
      !this.isAtCaseLabel()
    ) {
      try {
        const stmt = this.parseStatement();
        if (stmt) body.push(stmt);
      } catch {
        this.skipToSemicolon();
      }
    }

    return { values, body };
  }

  /**
   * Lookahead: are we at the start of a new CASE label?
   * Handles:
   *   - Boolean literals:       TRUE : / FALSE :
   *   - Negative integers:      - INTEGER : / - INTEGER .. / - INTEGER ,
   *   - Integers:               INTEGER : / INTEGER .. / INTEGER ,
   *   - Identifiers:            IDENT(.IDENT)* : / .. / ,
   */
  private isAtCaseLabel(): boolean {
    const tok0 = this.peek(0);

    // Boolean labels: TRUE : or FALSE :
    if (tok0.kind === TokenKind.TRUE || tok0.kind === TokenKind.FALSE) {
      return this.peek(1).kind === TokenKind.COLON;
    }

    // Negative integer: - INTEGER followed by : or .. or ,
    if (tok0.kind === TokenKind.MINUS) {
      const tok1 = this.peek(1);
      if (tok1.kind !== TokenKind.INTEGER) return false;
      const tok2 = this.peek(2);
      return tok2.kind === TokenKind.COLON ||
        tok2.kind === TokenKind.DOTDOT ||
        tok2.kind === TokenKind.COMMA;
    }

    // Integer: N : or N .. or N ,
    if (tok0.kind === TokenKind.INTEGER) {
      const tok1 = this.peek(1);
      return tok1.kind === TokenKind.COLON ||
        tok1.kind === TokenKind.DOTDOT ||
        tok1.kind === TokenKind.COMMA;
    }

    // Identifier: plain or dotted (arbitrary depth)
    if (tok0.kind === TokenKind.IDENTIFIER) {
      let offset = 1;
      while (
        this.peek(offset).kind === TokenKind.DOT &&
        this.peek(offset + 1).kind === TokenKind.IDENTIFIER
      ) {
        offset += 2;
      }

      const next = this.peek(offset);
      return next.kind === TokenKind.COLON ||
        next.kind === TokenKind.DOTDOT ||
        next.kind === TokenKind.COMMA;
    }

    return false;
  }
}
