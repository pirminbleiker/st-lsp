/** IEC 61131-3 Structured Text recursive-descent parser */

import {
  ActionDeclaration,
  AliasDeclaration,
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
  ContinueStatement,
  ElsifClause,
  EmptyStatement,
  EnumDeclaration,
  EnumValue,
  ExitStatement,
  Expression,
  ForStatement,
  FunctionBlockDeclaration,
  FunctionDeclaration,
  GvlDeclaration,
  IfStatement,
  IntegerLiteral,
  InterfaceDeclaration,
  MemberExpression,
  MethodDeclaration,
  NameExpression,
  ParseError,
  Position,
  Pragma,
  ProgramDeclaration,
  PropertyDeclaration,
  Range,
  RealLiteral,
  RepeatStatement,
  ReturnStatement,
  SourceFile,
  Statement,
  StringLiteral,
  StructDeclaration,
  SubscriptExpression,
  TopLevelDeclaration,
  TypeDeclaration,
  TypeDeclarationBlock,
  TypeRef,
  UnaryExpression,
  UnionDeclaration,
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

  /** Accept any identifier-like token (IDENTIFIER or a keyword usable as a name) as a declaration name. */
  private expectName(message: string): Token {
    const tok = this.peek();
    if (tok.kind === TokenKind.IDENTIFIER || isKeywordUsableAsIdentifier(tok.kind)) {
      return this.advance();
    }
    this.addError(message, tok.range);
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

  // ---- Pragmas -----------------------------------------------------------

  /**
   * Consume any consecutive PRAGMA tokens and parse them into Pragma nodes.
   * Called before parsing declarations that can be annotated.
   */
  private parsePragmas(): Pragma[] {
    const pragmas: Pragma[] = [];
    while (this.check(TokenKind.PRAGMA)) {
      const tok = this.advance();
      pragmas.push(this.parsePragmaToken(tok));
    }
    return pragmas;
  }

  /**
   * Parse the text of a PRAGMA token into a Pragma AST node.
   * Expected format: `{attribute 'name'}` or `{attribute 'name' := 'value'}`
   */
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
    // Collect leading pragma annotations before the declaration keyword
    const pragmas = this.parsePragmas();
    const tok = this.peek();
    switch (tok.kind) {
      case TokenKind.PROGRAM:
        return this.parseProgramDeclaration(pragmas);
      case TokenKind.FUNCTION_BLOCK:
        return this.parseFunctionBlockDeclaration(pragmas);
      case TokenKind.FUNCTION:
        return this.parseFunctionDeclaration(pragmas);
      case TokenKind.TYPE:
        return this.parseTypeDeclarationBlock();
      case TokenKind.INTERFACE:
        return this.parseInterfaceDeclaration();
      case TokenKind.VAR_GLOBAL:
        return this.parseGvlDeclaration();
      case TokenKind.NAMESPACE:
        this.skipNamespaceBlock();
        return null;
      default:
        this.addError(`Unexpected token '${tok.text}' at top level`, tok.range);
        this.advance();
        return null;
    }
  }

  // ---- PROGRAM ----------------------------------------------------------

  private parseProgramDeclaration(pragmas: Pragma[] = []): ProgramDeclaration {
    const start = pragmas.length > 0 ? pragmas[0].range.start : this.startRange();
    this.advance(); // PROGRAM
    const nameTok = this.expect(TokenKind.IDENTIFIER, 'Expected program name');
    const name = nameTok.text;

    const varBlocks = this.parseVarBlocks();
    const body = this.parseStatementList(TokenKind.END_PROGRAM);
    this.expect(TokenKind.END_PROGRAM, "Expected 'END_PROGRAM'");

    return { kind: 'ProgramDeclaration', name, pragmas, varBlocks, body, range: this.endRange(start) };
  }

  // ---- FUNCTION_BLOCK ---------------------------------------------------

  private parseFunctionBlockDeclaration(pragmas: Pragma[] = []): FunctionBlockDeclaration {
    const start = pragmas.length > 0 ? pragmas[0].range.start : this.startRange();
    this.advance(); // FUNCTION_BLOCK
    // Skip optional modifiers before the name (e.g. ABSTRACT, FINAL)
    while (this.check(TokenKind.ABSTRACT) || this.check(TokenKind.FINAL_KW)) {
      this.advance();
    }
    const nameTok = this.expectName('Expected function block name');
    const name = nameTok.text;

    // Optional EXTENDS <name>
    let extendsName: string | undefined;
    if (this.check(TokenKind.EXTENDS)) {
      this.advance();
      const extTok = this.expect(TokenKind.IDENTIFIER, 'Expected base function block name after EXTENDS');
      extendsName = extTok.text;
    }

    // Optional IMPLEMENTS <name>, <name>, ...
    const implementsList: string[] = [];
    if (this.check(TokenKind.IMPLEMENTS)) {
      this.advance();
      do {
        const implTok = this.expect(TokenKind.IDENTIFIER, 'Expected interface name after IMPLEMENTS');
        implementsList.push(implTok.text);
      } while (this.match(TokenKind.COMMA));
    }

    const varBlocks = this.parseVarBlocks();

    // Parse body statements, methods, and properties
    const body: Statement[] = [];
    const methods: MethodDeclaration[] = [];
    const properties: PropertyDeclaration[] = [];

    while (!this.check(TokenKind.END_FUNCTION_BLOCK) && !this.check(TokenKind.EOF)) {
      if (this.check(TokenKind.METHOD)) {
        methods.push(this.parseMethodDeclaration());
      } else if (this.check(TokenKind.PROPERTY)) {
        properties.push(this.parsePropertyDeclaration());
      } else if (this.check(TokenKind.ACTION)) {
        // ACTION blocks may follow the FB body in TwinCAT XML extracted source
        // (when there is no explicit END_FUNCTION_BLOCK in the extracted text).
        // Stop body parsing here; they are collected in the loop below.
        break;
      } else {
        try {
          const stmt = this.parseStatement();
          if (stmt) body.push(stmt);
        } catch {
          this.skipToSemicolon();
        }
      }
    }

    this.expect(TokenKind.END_FUNCTION_BLOCK, "Expected 'END_FUNCTION_BLOCK'");

    // Parse any trailing ACTION...END_ACTION blocks belonging to this FB.
    const actions: ActionDeclaration[] = [];
    while (this.check(TokenKind.ACTION)) {
      actions.push(this.parseActionDeclaration());
    }

    return {
      kind: 'FunctionBlockDeclaration',
      name,
      pragmas,
      extends: extendsName,
      implements: implementsList,
      varBlocks,
      body,
      methods,
      properties,
      actions,
      range: this.endRange(start),
    };
  }

  // ---- FUNCTION ---------------------------------------------------------

  private parseFunctionDeclaration(pragmas: Pragma[] = []): FunctionDeclaration {
    const start = pragmas.length > 0 ? pragmas[0].range.start : this.startRange();
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

    return { kind: 'FunctionDeclaration', name, pragmas, returnType, varBlocks, body, range: this.endRange(start) };
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

  private parseVarBlocks(): VarBlock[] {
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
      try {
        declarations.push(this.parseVarDeclaration());
      } catch {
        // Skip to next semicolon for recovery
        this.skipToSemicolon();
      }
    }
    this.expect(TokenKind.END_VAR, "Expected 'END_VAR'");

    return { kind: 'VarBlock', varKind, constant, retain, persistent, declarations, range: this.endRange(start) };
  }

  private parseVarDeclaration(): VarDeclaration {
    const pragmas = this.parsePragmas();
    const start = pragmas.length > 0 ? pragmas[0].range.start : this.startRange();
    const nameTok = this.expect(TokenKind.IDENTIFIER, 'Expected variable name');
    const name = nameTok.text;

    this.expect(TokenKind.COLON, "Expected ':' after variable name");
    const type = this.parseTypeRef();

    let initialValue: Expression | undefined;
    if (this.match(TokenKind.ASSIGN)) {
      initialValue = this.parseExpression();
    }

    this.expect(TokenKind.SEMICOLON, "Expected ';'");

    return { kind: 'VarDeclaration', name, nameRange: nameTok.range, pragmas, type, initialValue, range: this.endRange(start) };
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
        nameRange: inner.nameRange,
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

    // Simple type name (identifier or keyword used as type)
    const nameTok = this.advance();
    const nameRange = this.endRange(start);
    return {
      kind: 'TypeRef',
      name: nameTok.text.toUpperCase(),
      nameRange,
      range: nameRange,
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

  private skipToSemicolon(): void {
    // End keywords also serve as recovery boundaries
    const endKeywords = new Set([
      TokenKind.END_IF, TokenKind.END_FOR, TokenKind.END_WHILE,
      TokenKind.END_REPEAT, TokenKind.END_CASE, TokenKind.END_VAR,
      TokenKind.END_PROGRAM, TokenKind.END_FUNCTION, TokenKind.END_FUNCTION_BLOCK,
      TokenKind.END_TYPE, TokenKind.END_STRUCT, TokenKind.END_ENUM,
      TokenKind.END_METHOD, TokenKind.END_PROPERTY, TokenKind.END_INTERFACE,
      TokenKind.ACTION, TokenKind.END_ACTION,
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
   *   - Plain identifiers:      IDENT : / IDENT .. / IDENT ,
   *   - Enum-qualified idents:  IDENT . IDENT : / IDENT . IDENT .. / IDENT . IDENT ,
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

    // Identifier: plain or enum-qualified
    if (tok0.kind === TokenKind.IDENTIFIER) {
      const tok1 = this.peek(1);
      // Plain identifier: IDENT : or IDENT .. or IDENT ,
      if (tok1.kind === TokenKind.COLON ||
          tok1.kind === TokenKind.DOTDOT ||
          tok1.kind === TokenKind.COMMA) return true;
      // Enum-qualified: IDENT . IDENT : or IDENT . IDENT .. or IDENT . IDENT ,
      if (tok1.kind === TokenKind.DOT) {
        const tok2 = this.peek(2);
        if (tok2.kind === TokenKind.IDENTIFIER) {
          const tok3 = this.peek(3);
          return tok3.kind === TokenKind.COLON ||
            tok3.kind === TokenKind.DOTDOT ||
            tok3.kind === TokenKind.COMMA;
        }
      }
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

      default:
        // Many keywords can be used as identifiers in context (e.g. type names)
        if (isKeywordUsableAsIdentifier(tok.kind)) {
          this.advance();
          return { kind: 'NameExpression', name: tok.text, range: tok.range } as NameExpression;
        }

        this.addError(`Unexpected token '${tok.text}' in expression`, tok.range);
        // Advance to prevent infinite loops in statement parsing loops
        this.advance();
        return { kind: 'NameExpression', name: '', range: tok.range } as NameExpression;
    }
  }

  // ---- TYPE...END_TYPE --------------------------------------------------

  private parseTypeDeclarationBlock(): TypeDeclarationBlock {
    const start = this.startRange();
    this.advance(); // TYPE
    const declarations: TypeDeclaration[] = [];

    while (!this.check(TokenKind.END_TYPE) && !this.check(TokenKind.EOF)) {
      try {
        const nameTok = this.expect(TokenKind.IDENTIFIER, 'Expected type name');
        const name = nameTok.text;
        this.expect(TokenKind.COLON, "Expected ':' after type name");

        let decl: TypeDeclaration;
        if (this.check(TokenKind.STRUCT)) {
          decl = this.parseStructBody(name, start);
          this.match(TokenKind.SEMICOLON);
        } else if (this.check(TokenKind.UNION)) {
          decl = this.parseUnionBody(name, start);
          this.match(TokenKind.SEMICOLON);
        } else if (this.check(TokenKind.ENUM)) {
          this.advance(); // ENUM
          decl = this.parseEnumBlock(name, start);
          this.match(TokenKind.SEMICOLON);
        } else if (this.check(TokenKind.LPAREN)) {
          decl = this.parseEnumBody(name, start);
          // RPAREN and SEMICOLON are consumed inside parseEnumBody
        } else if (
          this.check(TokenKind.IDENTIFIER) &&
          this.peek(1).kind === TokenKind.ASSIGN
        ) {
          // TYPE Color : INT := (Red:=1, Green:=2); — typed enum, baseType before :=
          const baseType = this.parseTypeRef();
          this.expect(TokenKind.ASSIGN, "Expected ':='");
          // parseEnumBody expects to be positioned at '(' and consumes it internally
          decl = this.parseEnumBody(name, start, baseType);
          // RPAREN and SEMICOLON are consumed inside parseEnumBody
        } else {
          decl = this.parseAliasBody(name, start);
          // SEMICOLON consumed inside parseAliasBody
        }

        declarations.push(decl);
      } catch {
        this.skipToSemicolon();
      }
    }

    this.expect(TokenKind.END_TYPE, "Expected 'END_TYPE'");

    return {
      kind: 'TypeDeclarationBlock',
      declarations,
      range: this.endRange(start),
    };
  }

  private parseStructBody(name: string, blockStart: Position): StructDeclaration {
    const start = blockStart;
    this.advance(); // STRUCT

    // Optional EXTENDS
    let extendsName: string | undefined;
    if (this.check(TokenKind.EXTENDS)) {
      this.advance();
      const extTok = this.expect(TokenKind.IDENTIFIER, 'Expected base struct name after EXTENDS');
      extendsName = extTok.text;
    }

    const fields: VarDeclaration[] = [];
    while (!this.check(TokenKind.END_STRUCT) && !this.check(TokenKind.EOF)) {
      try {
        fields.push(this.parseVarDeclaration());
      } catch {
        this.skipToSemicolon();
      }
    }

    this.expect(TokenKind.END_STRUCT, "Expected 'END_STRUCT'");

    return {
      kind: 'StructDeclaration',
      name,
      extends: extendsName,
      fields,
      range: this.endRange(start),
    };
  }

  private parseUnionBody(name: string, blockStart: Position): UnionDeclaration {
    const start = blockStart;
    this.advance(); // UNION

    const fields: VarDeclaration[] = [];
    while (!this.check(TokenKind.END_UNION) && !this.check(TokenKind.EOF)) {
      try {
        fields.push(this.parseVarDeclaration());
      } catch {
        this.skipToSemicolon();
      }
    }

    this.expect(TokenKind.END_UNION, "Expected 'END_UNION'");

    return {
      kind: 'UnionDeclaration',
      name,
      fields,
      range: this.endRange(start),
    };
  }

  private skipNamespaceBlock(): void {
    this.advance(); // NAMESPACE
    // Skip name identifier if present
    if (this.check(TokenKind.IDENTIFIER)) {
      this.advance();
    }
    // Skip all content until END_NAMESPACE
    let depth = 1;
    while (!this.check(TokenKind.EOF)) {
      if (this.check(TokenKind.NAMESPACE)) {
        depth++;
      } else if (this.check(TokenKind.END_NAMESPACE)) {
        depth--;
        if (depth === 0) {
          this.advance(); // consume END_NAMESPACE
          return;
        }
      }
      this.advance();
    }
  }

  /** Parse ( Val1, Val2 := 5 ) [TrailingType] enum syntax */
  private parseEnumBody(name: string, blockStart: Position, baseType?: TypeRef): EnumDeclaration {
    const start = blockStart;
    this.advance(); // (
    const values: EnumValue[] = [];

    while (!this.check(TokenKind.RPAREN) && !this.check(TokenKind.EOF)) {
      const valStart = this.startRange();
      const valTok = this.expect(TokenKind.IDENTIFIER, 'Expected enum member name');
      let value: Expression | undefined;
      if (this.match(TokenKind.ASSIGN)) {
        value = this.parseExpression();
      }
      values.push({ name: valTok.text, value, range: this.endRange(valStart) });
      if (!this.match(TokenKind.COMMA)) break;
    }

    this.expect(TokenKind.RPAREN, "Expected ')'");

    // TYPE Color : (Red:=1) INT; — trailing base type after )
    if (!baseType && this.check(TokenKind.IDENTIFIER)) {
      baseType = this.parseTypeRef();
    }

    this.match(TokenKind.SEMICOLON);

    return {
      kind: 'EnumDeclaration',
      name,
      baseType,
      values,
      range: this.endRange(start),
    };
  }

  /** Parse ENUM...END_ENUM block-style syntax */
  private parseEnumBlock(name: string, blockStart: Position): EnumDeclaration {
    const start = blockStart;
    // Optional base type: ENUM : INT
    let baseType: TypeRef | undefined;
    if (this.check(TokenKind.COLON)) {
      this.advance();
      baseType = this.parseTypeRef();
    }

    const values: EnumValue[] = [];
    while (!this.check(TokenKind.END_ENUM) && !this.check(TokenKind.EOF)) {
      const valStart = this.startRange();
      const valTok = this.expect(TokenKind.IDENTIFIER, 'Expected enum member name');
      let value: Expression | undefined;
      if (this.match(TokenKind.ASSIGN)) {
        value = this.parseExpression();
      }
      values.push({ name: valTok.text, value, range: this.endRange(valStart) });
      this.match(TokenKind.SEMICOLON);
      this.match(TokenKind.COMMA);
    }

    this.expect(TokenKind.END_ENUM, "Expected 'END_ENUM'");

    return {
      kind: 'EnumDeclaration',
      name,
      baseType,
      values,
      range: this.endRange(start),
    };
  }

  private parseAliasBody(name: string, blockStart: Position): AliasDeclaration {
    const start = blockStart;
    const type = this.parseTypeRef();
    this.expect(TokenKind.SEMICOLON, "Expected ';' after alias type");

    return {
      kind: 'AliasDeclaration',
      name,
      type,
      range: this.endRange(start),
    };
  }

  // ---- INTERFACE --------------------------------------------------------

  private parseInterfaceDeclaration(): InterfaceDeclaration {
    const start = this.startRange();
    this.advance(); // INTERFACE
    const nameTok = this.expect(TokenKind.IDENTIFIER, 'Expected interface name');
    const name = nameTok.text;

    // Optional EXTENDS <name>, <name>, ...
    const extendsList: string[] = [];
    if (this.check(TokenKind.EXTENDS)) {
      this.advance();
      do {
        const extTok = this.expect(TokenKind.IDENTIFIER, 'Expected interface name after EXTENDS');
        extendsList.push(extTok.text);
      } while (this.match(TokenKind.COMMA));
    }

    const methods: MethodDeclaration[] = [];
    const properties: PropertyDeclaration[] = [];

    while (!this.check(TokenKind.END_INTERFACE) && !this.check(TokenKind.EOF)) {
      if (this.check(TokenKind.METHOD)) {
        methods.push(this.parseMethodDeclaration());
      } else if (this.check(TokenKind.PROPERTY)) {
        properties.push(this.parsePropertyDeclaration());
      } else {
        // Skip unknown tokens with error recovery
        this.addError(`Unexpected token '${this.peek().text}' inside INTERFACE`, this.peek().range);
        this.advance();
      }
    }

    this.expect(TokenKind.END_INTERFACE, "Expected 'END_INTERFACE'");

    return {
      kind: 'InterfaceDeclaration',
      name,
      extends: extendsList,
      methods,
      properties,
      range: this.endRange(start),
    };
  }

  // ---- GLOBAL VARIABLE LIST (GVL) ----------------------------------------

  private parseGvlDeclaration(): GvlDeclaration {
    const start = this.startRange();
    const varBlocks = this.parseVarBlocks();
    return { kind: 'GvlDeclaration', varBlocks, range: this.endRange(start) };
  }

  // ---- METHOD -----------------------------------------------------------

  /** Modifier keywords that can appear before or after METHOD keyword */
  private readonly METHOD_MODIFIERS: ReadonlySet<TokenKind> = new Set([
    TokenKind.ABSTRACT,
    TokenKind.OVERRIDE,
    TokenKind.FINAL_KW,
    TokenKind.PUBLIC,
    TokenKind.PRIVATE,
    TokenKind.PROTECTED,
    TokenKind.INTERNAL,
  ]);

  private parseMethodDeclaration(): MethodDeclaration {
    const start = this.startRange();
    this.advance(); // METHOD

    // Collect modifiers (can appear before name)
    const modifiers: string[] = [];
    while (this.METHOD_MODIFIERS.has(this.peek().kind)) {
      modifiers.push(this.advance().text.toUpperCase());
    }

    const nameTok = this.expect(TokenKind.IDENTIFIER, 'Expected method name');
    const name = nameTok.text;

    // Optional return type: METHOD Name : TypeRef
    let returnType: TypeRef | undefined;
    if (this.match(TokenKind.COLON)) {
      returnType = this.parseTypeRef();
    }

    const varBlocks = this.parseVarBlocks();
    const body = this.parseStatementList(TokenKind.END_METHOD);
    this.expect(TokenKind.END_METHOD, "Expected 'END_METHOD'");

    return {
      kind: 'MethodDeclaration',
      name,
      returnType,
      modifiers,
      varBlocks,
      body,
      range: this.endRange(start),
    };
  }

  // ---- PROPERTY ---------------------------------------------------------

  private parsePropertyDeclaration(): PropertyDeclaration {
    const start = this.startRange();
    this.advance(); // PROPERTY

    // Collect modifiers
    const modifiers: string[] = [];
    while (this.METHOD_MODIFIERS.has(this.peek().kind)) {
      modifiers.push(this.advance().text.toUpperCase());
    }

    const nameTok = this.expect(TokenKind.IDENTIFIER, 'Expected property name');
    const name = nameTok.text;

    this.expect(TokenKind.COLON, "Expected ':' after property name");
    const type = this.parseTypeRef();

    // Skip optional GET/SET blocks until END_PROPERTY
    while (!this.check(TokenKind.END_PROPERTY) && !this.check(TokenKind.EOF)) {
      this.advance();
    }
    this.expect(TokenKind.END_PROPERTY, "Expected 'END_PROPERTY'");

    return {
      kind: 'PropertyDeclaration',
      name,
      type,
      modifiers,
      range: this.endRange(start),
    };
  }

  // ---- ACTION -----------------------------------------------------------

  private parseActionDeclaration(): ActionDeclaration {
    const start = this.startRange();
    this.advance(); // ACTION

    const nameTok = this.expect(TokenKind.IDENTIFIER, 'Expected action name');
    const name = nameTok.text;

    // Optional colon after name (TwinCAT inline ST uses 'ACTION Name:')
    this.match(TokenKind.COLON);

    const body = this.parseStatementList(TokenKind.END_ACTION);
    this.expect(TokenKind.END_ACTION, "Expected 'END_ACTION'");

    return {
      kind: 'ActionDeclaration',
      name,
      body,
      range: this.endRange(start),
    };
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
  // Type names and modifiers that happen to be keywords — can appear as identifiers
  const keywordIdents = new Set<TokenKind>([
    TokenKind.OF, TokenKind.TO, TokenKind.BY, TokenKind.DO,
    TokenKind.MOD,
    // Access modifiers and OOP qualifiers — frequently used as identifier names
    TokenKind.PUBLIC, TokenKind.PRIVATE, TokenKind.PROTECTED, TokenKind.INTERNAL,
    TokenKind.ABSTRACT, TokenKind.OVERRIDE, TokenKind.FINAL_KW,
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
