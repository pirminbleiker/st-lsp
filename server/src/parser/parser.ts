/** IEC 61131-3 Structured Text recursive-descent parser */

import {
  ArrayDim,
  AssignmentStatement,
  BinaryExpression,
  BoolLiteral,
  CallArgument,
  CallExpression,
  CallStatement,
  CaseClause,
  CaseStatement,
  CaseValue,
  ElsifClause,
  EmptyStatement,
  ExitStatement,
  Expression,
  ForStatement,
  FunctionBlockDeclaration,
  FunctionDeclaration,
  IfStatement,
  IntegerLiteral,
  MemberExpression,
  NameExpression,
  ParseError,
  Position,
  ProgramDeclaration,
  Range,
  RealLiteral,
  RepeatStatement,
  ReturnStatement,
  SourceFile,
  Statement,
  StringLiteral,
  SubscriptExpression,
  TopLevelDeclaration,
  TypeRef,
  UnaryExpression,
  VarBlock,
  VarDeclaration,
  VarKind,
  WhileStatement,
} from './ast';
import { Lexer, Token, TokenKind } from './lexer';

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

class Parser {
  private tokens: Token[];
  private pos = 0;
  readonly errors: ParseError[] = [];

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  // ---- Token navigation --------------------------------------------------

  private peek(offset = 0): Token {
    const idx = this.pos + offset;
    return idx < this.tokens.length
      ? this.tokens[idx]
      : this.tokens[this.tokens.length - 1]; // EOF
  }

  private advance(): Token {
    const tok = this.tokens[this.pos];
    if (this.pos < this.tokens.length - 1) this.pos++;
    return tok;
  }

  private check(kind: TokenKind): boolean {
    return this.peek().kind === kind;
  }

  private match(...kinds: TokenKind[]): Token | undefined {
    for (const k of kinds) {
      if (this.check(k)) return this.advance();
    }
    return undefined;
  }

  private expect(kind: TokenKind, message?: string): Token {
    if (this.check(kind)) return this.advance();
    const tok = this.peek();
    this.addError(message ?? `Expected '${kind}', got '${tok.kind}'`, tok.range);
    // Return the current token without advancing (allows recovery)
    return tok;
  }

  private addError(message: string, range: Range): void {
    this.errors.push({ message, range });
  }

  private startRange(): Position {
    return this.peek().range.start;
  }

  private endRange(start: Position): Range {
    // End is the end of the previously consumed token
    const prev = this.tokens[Math.max(0, this.pos - 1)];
    return { start, end: prev.range.end };
  }

  // ---- Source file -------------------------------------------------------

  parseSourceFile(): SourceFile {
    const start = this.startRange();
    const declarations: TopLevelDeclaration[] = [];

    while (!this.check(TokenKind.EOF)) {
      try {
        const decl = this.parseTopLevelDeclaration();
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

  private parseTopLevelDeclaration(): TopLevelDeclaration | null {
    const tok = this.peek();
    switch (tok.kind) {
      case TokenKind.PROGRAM:
        return this.parseProgramDeclaration();
      case TokenKind.FUNCTION_BLOCK:
        return this.parseFunctionBlockDeclaration();
      case TokenKind.FUNCTION:
        return this.parseFunctionDeclaration();
      default:
        this.addError(`Unexpected token '${tok.text}' at top level`, tok.range);
        this.advance();
        return null;
    }
  }

  // ---- PROGRAM ----------------------------------------------------------

  private parseProgramDeclaration(): ProgramDeclaration {
    const start = this.startRange();
    this.advance(); // PROGRAM
    const nameTok = this.expect(TokenKind.IDENTIFIER, 'Expected program name');
    const name = nameTok.text;

    const varBlocks = this.parseVarBlocks();
    const body = this.parseStatementList(TokenKind.END_PROGRAM);
    this.expect(TokenKind.END_PROGRAM, "Expected 'END_PROGRAM'");

    return { kind: 'ProgramDeclaration', name, varBlocks, body, range: this.endRange(start) };
  }

  // ---- FUNCTION_BLOCK ---------------------------------------------------

  private parseFunctionBlockDeclaration(): FunctionBlockDeclaration {
    const start = this.startRange();
    this.advance(); // FUNCTION_BLOCK
    const nameTok = this.expect(TokenKind.IDENTIFIER, 'Expected function block name');
    const name = nameTok.text;

    const varBlocks = this.parseVarBlocks();
    const body = this.parseStatementList(TokenKind.END_FUNCTION_BLOCK);
    this.expect(TokenKind.END_FUNCTION_BLOCK, "Expected 'END_FUNCTION_BLOCK'");

    return { kind: 'FunctionBlockDeclaration', name, varBlocks, body, range: this.endRange(start) };
  }

  // ---- FUNCTION ---------------------------------------------------------

  private parseFunctionDeclaration(): FunctionDeclaration {
    const start = this.startRange();
    this.advance(); // FUNCTION
    const nameTok = this.expect(TokenKind.IDENTIFIER, 'Expected function name');
    const name = nameTok.text;

    // Optional return type: FUNCTION foo : INT
    let returnType: TypeRef | null = null;
    if (this.match(TokenKind.COLON)) {
      returnType = this.parseTypeRef();
    }

    const varBlocks = this.parseVarBlocks();
    const body = this.parseStatementList(TokenKind.END_FUNCTION);
    this.expect(TokenKind.END_FUNCTION, "Expected 'END_FUNCTION'");

    return { kind: 'FunctionDeclaration', name, returnType, varBlocks, body, range: this.endRange(start) };
  }

  // ---- VAR blocks -------------------------------------------------------

  private readonly VAR_KEYWORDS: ReadonlySet<TokenKind> = new Set([
    TokenKind.VAR,
    TokenKind.VAR_INPUT,
    TokenKind.VAR_OUTPUT,
    TokenKind.VAR_IN_OUT,
    TokenKind.VAR_GLOBAL,
    TokenKind.VAR_EXTERNAL,
  ]);

  private parseVarBlocks(): VarBlock[] {
    const blocks: VarBlock[] = [];
    while (this.VAR_KEYWORDS.has(this.peek().kind)) {
      blocks.push(this.parseVarBlock());
    }
    return blocks;
  }

  private parseVarBlock(): VarBlock {
    const start = this.startRange();
    const kindTok = this.advance();
    const varKind = kindTok.kind as VarKind;

    const declarations: VarDeclaration[] = [];
    while (!this.check(TokenKind.END_VAR) && !this.check(TokenKind.EOF)) {
      try {
        declarations.push(this.parseVarDeclaration());
      } catch {
        // Skip to next semicolon for recovery
        this.skipToSemicolon();
      }
    }
    this.expect(TokenKind.END_VAR, "Expected 'END_VAR'");

    return { kind: 'VarBlock', varKind, declarations, range: this.endRange(start) };
  }

  private parseVarDeclaration(): VarDeclaration {
    const start = this.startRange();
    const nameTok = this.expect(TokenKind.IDENTIFIER, 'Expected variable name');
    const name = nameTok.text;

    this.expect(TokenKind.COLON, "Expected ':' after variable name");
    const type = this.parseTypeRef();

    let initialValue: Expression | undefined;
    if (this.match(TokenKind.ASSIGN)) {
      initialValue = this.parseExpression();
    }

    this.expect(TokenKind.SEMICOLON, "Expected ';'");

    return { kind: 'VarDeclaration', name, type, initialValue, range: this.endRange(start) };
  }

  // ---- Type references --------------------------------------------------

  private parseTypeRef(): TypeRef {
    const start = this.startRange();

    // POINTER TO <type>
    if (this.peek().text.toUpperCase() === 'POINTER') {
      const pointerTok = this.advance();
      this.expectIdentifier('TO', "Expected 'TO' after 'POINTER'");
      const inner = this.parseTypeRef();
      return {
        kind: 'TypeRef',
        name: inner.name,
        isPointer: true,
        range: this.endRange(start),
      };
    }

    // REFERENCE TO <type>
    if (this.peek().text.toUpperCase() === 'REFERENCE') {
      this.advance();
      this.expectIdentifier('TO', "Expected 'TO' after 'REFERENCE'");
      const inner = this.parseTypeRef();
      return {
        kind: 'TypeRef',
        name: inner.name,
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
        isArray: true,
        arrayDims: dims,
        range: this.endRange(start),
      };
    }

    // Simple type name (identifier or keyword used as type)
    const nameTok = this.advance();
    return {
      kind: 'TypeRef',
      name: nameTok.text.toUpperCase(),
      range: this.endRange(start),
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

  private expectIdentifier(text: string, message: string): Token {
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

  // ---- Statements -------------------------------------------------------

  /** Parse a statement list until we see one of the end tokens. */
  private parseStatementList(...endKinds: TokenKind[]): Statement[] {
    const stmts: Statement[] = [];
    while (!this.check(TokenKind.EOF) && !endKinds.some(k => this.check(k))) {
      try {
        const stmt = this.parseStatement();
        if (stmt) stmts.push(stmt);
      } catch {
        this.skipToSemicolon();
      }
    }
    return stmts;
  }

  private parseStatement(): Statement | null {
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

      default:
        // Assignment or call statement
        return this.parseAssignmentOrCall();
    }
  }

  private emptyStatement(range: Range): EmptyStatement {
    return { kind: 'EmptyStatement', range };
  }

  private skipToSemicolon(): void {
    // End keywords also serve as recovery boundaries
    const endKeywords = new Set([
      TokenKind.END_IF, TokenKind.END_FOR, TokenKind.END_WHILE,
      TokenKind.END_REPEAT, TokenKind.END_CASE, TokenKind.END_VAR,
      TokenKind.END_PROGRAM, TokenKind.END_FUNCTION, TokenKind.END_FUNCTION_BLOCK,
      TokenKind.EOF,
    ]);
    while (!this.check(TokenKind.SEMICOLON) && !endKeywords.has(this.peek().kind)) {
      this.advance();
    }
    this.match(TokenKind.SEMICOLON);
  }

  private parseAssignmentOrCall(): Statement | null {
    const start = this.startRange();
    const left = this.parsePostfixExpression();

    // Assignment
    if (this.match(TokenKind.ASSIGN)) {
      const right = this.parseExpression();
      this.expect(TokenKind.SEMICOLON, "Expected ';'");
      return {
        kind: 'AssignmentStatement',
        left,
        right,
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
    this.expect(TokenKind.SEMICOLON, "Expected ';'");

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
   * A case label is an expression-like token (INTEGER, MINUS INTEGER,
   * IDENTIFIER) followed eventually by COLON (not COLON EQUALS).
   * We use a conservative 2-token lookahead.
   */
  private isAtCaseLabel(): boolean {
    const tok0 = this.peek(0);
    // Negative integer: - INTEGER
    if (tok0.kind === TokenKind.MINUS) {
      const tok1 = this.peek(1);
      const tok2 = this.peek(2);
      return tok1.kind === TokenKind.INTEGER &&
        tok2.kind === TokenKind.COLON;
    }
    // Integer or identifier
    if (tok0.kind === TokenKind.INTEGER || tok0.kind === TokenKind.IDENTIFIER) {
      const tok1 = this.peek(1);
      // Direct: N :
      if (tok1.kind === TokenKind.COLON) return true;
      // Range or comma list: N .. or N ,
      if (tok1.kind === TokenKind.DOTDOT || tok1.kind === TokenKind.COMMA) return true;
    }
    return false;
  }

  // ---- Expressions ------------------------------------------------------
  // Precedence (low → high):
  //   OR, XOR
  //   AND
  //   comparison (=, <>, <, >, <=, >=)
  //   addition (+, -)
  //   multiplication (*, /, MOD)
  //   power (**)
  //   unary (NOT, -)
  //   postfix (call, subscript, member)
  //   primary

  private parseExpression(): Expression {
    return this.parseOr();
  }

  private parseOr(): Expression {
    let left = this.parseAnd();
    while (this.check(TokenKind.OR) || this.check(TokenKind.XOR)) {
      const opTok = this.advance();
      const right = this.parseAnd();
      left = this.binary(opTok.kind, left, right);
    }
    return left;
  }

  private parseAnd(): Expression {
    let left = this.parseComparison();
    while (this.check(TokenKind.AND)) {
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

  private parsePostfixExpression(): Expression {
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
        // Array subscript
        const start = expr.range.start;
        this.advance(); // [
        const index = this.parseExpression();
        this.expect(TokenKind.RBRACKET, "Expected ']'");
        expr = {
          kind: 'SubscriptExpression',
          base: expr,
          index,
          range: this.endRange(start),
        } as SubscriptExpression;
      } else if (this.check(TokenKind.DOT)) {
        // Member access
        const start = expr.range.start;
        this.advance(); // .
        const memberTok = this.expect(TokenKind.IDENTIFIER, 'Expected member name');
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

  private parseCallArgs(): CallArgument[] {
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

  private parseCallArgument(): CallArgument {
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

      case TokenKind.LPAREN: {
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

      default:
        // Many keywords can be used as identifiers in context (e.g. type names)
        if (isKeywordUsableAsIdentifier(tok.kind)) {
          this.advance();
          return { kind: 'NameExpression', name: tok.text, range: tok.range } as NameExpression;
        }

        this.addError(`Unexpected token '${tok.text}' in expression`, tok.range);
        // Return a placeholder so the parse can continue
        return { kind: 'NameExpression', name: '', range: tok.range } as NameExpression;
    }
  }

  // ---- Helpers ----------------------------------------------------------

  private binary(op: string, left: Expression, right: Expression): BinaryExpression {
    return {
      kind: 'BinaryExpression',
      op,
      left,
      right,
      range: { start: left.range.start, end: right.range.end },
    };
  }
}

/** Some keywords can appear as identifiers in certain syntactic positions. */
function isKeywordUsableAsIdentifier(kind: TokenKind): boolean {
  // Type names that happen to be keywords
  const keywordIdents = new Set<TokenKind>([
    TokenKind.OF, TokenKind.TO, TokenKind.BY, TokenKind.DO,
    TokenKind.MOD,
  ]);
  return keywordIdents.has(kind);
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
