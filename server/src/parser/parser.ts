/** IEC 61131-3 Structured Text recursive-descent parser */

import {
  ActionDeclaration,
  AliasDeclaration,
  ArrayDim,
  CallArgument,
  EnumDeclaration,
  EnumValue,
  Expression,
  FunctionBlockDeclaration,
  FunctionDeclaration,
  GvlDeclaration,
  InterfaceDeclaration,
  MethodDeclaration,
  NamedRef,
  ParseError,
  Position,
  Pragma,
  ProgramDeclaration,
  PropertyDeclaration,
  SourceFile,
  Statement,
  StructDeclaration,
  TopLevelDeclaration,
  TypeDeclaration,
  TypeDeclarationBlock,
  TypeRef,
  UnionDeclaration,
  VarBlock,
  VarDeclaration,
  VarKind,
} from './ast';
import { Lexer, Token, TokenKind } from './lexer';
import { StatementParser } from './statements';

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

class Parser extends StatementParser {

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
    // Skip optional modifiers before the name (e.g. ABSTRACT, FINAL, INTERNAL, PUBLIC, etc.)
    // Only consume as modifier if the NEXT token is an IDENTIFIER or another modifier,
    // otherwise the modifier keyword IS the name (e.g., FUNCTION_BLOCK Internal).
    while ((this.check(TokenKind.ABSTRACT) || this.check(TokenKind.FINAL_KW) ||
            this.check(TokenKind.INTERNAL) || this.check(TokenKind.PUBLIC) ||
            this.check(TokenKind.PRIVATE) || this.check(TokenKind.PROTECTED)) &&
           (this.peek(1).kind === TokenKind.IDENTIFIER ||
            this.peek(1).kind === TokenKind.ABSTRACT || this.peek(1).kind === TokenKind.FINAL_KW ||
            this.peek(1).kind === TokenKind.INTERNAL || this.peek(1).kind === TokenKind.PUBLIC ||
            this.peek(1).kind === TokenKind.PRIVATE || this.peek(1).kind === TokenKind.PROTECTED)) {
      this.advance();
    }
    const nameTok = this.expectName('Expected function block name');
    const name = nameTok.text;

    // Optional EXTENDS <qualified-name>
    let extendsRef: NamedRef | undefined;
    if (this.check(TokenKind.EXTENDS)) {
      this.advance();
      extendsRef = this.parseQualifiedName('Expected base function block name after EXTENDS');
    }

    // Optional IMPLEMENTS <qualified-name>, <qualified-name>, ...
    const implementsRefs: NamedRef[] = [];
    if (this.check(TokenKind.IMPLEMENTS)) {
      this.advance();
      do {
        implementsRefs.push(this.parseQualifiedName('Expected interface name after IMPLEMENTS'));
      } while (this.match(TokenKind.COMMA));
    }

    // Optional trailing semicolon after declaration header (bad practice but valid)
    if (this.check(TokenKind.SEMICOLON)) {
      const semiTok = this.peek();
      this.errors.push({
        message: 'Unnecessary semicolon after FUNCTION_BLOCK declaration',
        range: semiTok.range,
        severity: 'warning' as const,
        code: 'unnecessary-semicolon',
      });
      this.advance();
    }

    const varBlocks = this.parseVarBlocks();

    // Parse body statements, methods, and properties
    const body: Statement[] = [];
    const methods: MethodDeclaration[] = [];
    const properties: PropertyDeclaration[] = [];

    while (!this.check(TokenKind.END_FUNCTION_BLOCK) && !this.check(TokenKind.EOF)) {
      const before = this.pos;
      // Pragmas may appear before METHOD/PROPERTY declarations in FB bodies.
      if (this.check(TokenKind.PRAGMA)) {
        this.parsePragmas();
        continue;
      }

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
      // Guard: if no progress was made, skip one token to prevent infinite loop
      if (this.pos === before) {
        this.advance();
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
      extendsRef,
      implementsRefs,
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
      this.match(TokenKind.SEMICOLON); // standard semicolon after return type (normal practice)
    } else if (this.check(TokenKind.SEMICOLON)) {
      // Semicolon after function name without return type (bad practice but valid)
      const semiTok = this.peek();
      this.errors.push({
        message: 'Unnecessary semicolon after FUNCTION declaration',
        range: semiTok.range,
        severity: 'warning' as const,
        code: 'unnecessary-semicolon',
      });
      this.advance();
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
  private parseVarDeclarations(): VarDeclaration[] {
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
    
    // Anonymous inline enum in VAR declarations: (A, B, C) or (A := 1, B := 2)
    if (this.check(TokenKind.LPAREN)) {
      return this.parseInlineEnumTypeRef(start);
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

  // ---- TYPE...END_TYPE --------------------------------------------------

  private parseTypeDeclarationBlock(): TypeDeclarationBlock {
    const start = this.startRange();
    this.advance(); // TYPE
    const declarations: TypeDeclaration[] = [];

    while (!this.check(TokenKind.END_TYPE) && !this.check(TokenKind.EOF)) {
      const before = this.pos;
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
      if (this.pos === before) this.advance();
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
    let extendsRef: NamedRef | undefined;
    if (this.check(TokenKind.EXTENDS)) {
      this.advance();
      extendsRef = this.parseQualifiedName('Expected base struct name after EXTENDS');
    }

    const fields: VarDeclaration[] = [];
    while (!this.check(TokenKind.END_STRUCT) && !this.check(TokenKind.EOF)) {
      const before = this.pos;
      try {
        fields.push(...this.parseVarDeclarations());
      } catch {
        this.skipToSemicolon();
      }
      if (this.pos === before) this.advance();
    }

    this.expect(TokenKind.END_STRUCT, "Expected 'END_STRUCT'");

    return {
      kind: 'StructDeclaration',
      name,
      extendsRef,
      fields,
      range: this.endRange(start),
    };
  }

  private parseUnionBody(name: string, blockStart: Position): UnionDeclaration {
    const start = blockStart;
    this.advance(); // UNION

    const fields: VarDeclaration[] = [];
    while (!this.check(TokenKind.END_UNION) && !this.check(TokenKind.EOF)) {
      const before = this.pos;
      try {
        fields.push(...this.parseVarDeclarations());
      } catch {
        this.skipToSemicolon();
      }
      if (this.pos === before) this.advance();
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

    // TcIO-like extracted snippets may contain only `INTERFACE Name;`.
    // Accept EOF only for this exact short form.
    if (this.check(TokenKind.SEMICOLON) && this.peek(1).kind === TokenKind.EOF) {
      this.advance();
      return {
        kind: 'InterfaceDeclaration',
        name,
        extendsRefs: [],
        methods: [],
        properties: [],
        range: this.endRange(start),
      };
    }

    // Optional EXTENDS <qualified-name>, <qualified-name>, ...
    const extendsRefs: NamedRef[] = [];
    if (this.check(TokenKind.EXTENDS)) {
      this.advance();
      do {
        extendsRefs.push(this.parseQualifiedName('Expected interface name after EXTENDS'));
      } while (this.match(TokenKind.COMMA));
    }

    const methods: MethodDeclaration[] = [];
    const properties: PropertyDeclaration[] = [];

    while (!this.check(TokenKind.END_INTERFACE) && !this.check(TokenKind.EOF)) {
      // Pragmas may appear before METHOD/PROPERTY declarations in INTERFACE bodies.
      if (this.check(TokenKind.PRAGMA)) {
        this.parsePragmas();
        continue;
      }

      if (this.check(TokenKind.METHOD)) {
        methods.push(this.parseMethodDeclaration());
      } else if (this.check(TokenKind.PROPERTY)) {
        properties.push(this.parsePropertyDeclaration());
      } else if (this.check(TokenKind.SEMICOLON)) {
        // TwinCAT allows a trailing semicolon after INTERFACE declaration/EXTENDS.
        this.advance();
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
      extendsRefs,
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
      this.match(TokenKind.SEMICOLON); // standard semicolon after return type (normal practice)
    } else if (this.check(TokenKind.SEMICOLON)) {
      // Semicolon after method name without return type (bad practice but valid)
      const semiTok = this.peek();
      this.errors.push({
        message: 'Unnecessary semicolon after METHOD declaration',
        range: semiTok.range,
        severity: 'warning' as const,
        code: 'unnecessary-semicolon',
      });
      this.advance();
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

    let getAccessor: { varBlocks: VarBlock[]; body: Statement[] } | undefined;
    let setAccessor: { varBlocks: VarBlock[]; body: Statement[] } | undefined;

    while (!this.check(TokenKind.END_PROPERTY) && !this.check(TokenKind.EOF)) {
      if (this.isIdentifierText('GET')) {
        this.advance(); // GET (context-sensitive keyword in PROPERTY)
        getAccessor = this.parsePropertyAccessor('END_GET', 'SET');
        if (this.isIdentifierText('END_GET')) this.advance();
        continue;
      }

      if (this.isIdentifierText('SET')) {
        this.advance(); // SET (context-sensitive keyword in PROPERTY)
        setAccessor = this.parsePropertyAccessor('END_SET', 'GET');
        if (this.isIdentifierText('END_SET')) this.advance();
        continue;
      }

      // Recovery for unknown tokens inside PROPERTY.
      this.advance();
    }

    this.expect(TokenKind.END_PROPERTY, "Expected 'END_PROPERTY'");

    return {
      kind: 'PropertyDeclaration',
      name,
      type,
      modifiers,
      getAccessor,
      setAccessor,
      range: this.endRange(start),
    };
  }

  private parsePropertyAccessor(endMarker: 'END_GET' | 'END_SET', nextAccessor: 'GET' | 'SET'): { varBlocks: VarBlock[]; body: Statement[] } {
    const varBlocks: VarBlock[] = [];

    while (!this.check(TokenKind.EOF) && !this.check(TokenKind.END_PROPERTY)) {
      if (this.isIdentifierText(endMarker) || this.isIdentifierText(nextAccessor)) {
        break;
      }

      const blocks = this.parseVarBlocks();
      if (blocks.length > 0) {
        varBlocks.push(...blocks);
        continue;
      }
      break;
    }

    const body: Statement[] = [];
    while (!this.check(TokenKind.EOF) && !this.check(TokenKind.END_PROPERTY)) {
      if (this.isIdentifierText(endMarker) || this.isIdentifierText(nextAccessor)) {
        break;
      }

      const before = this.pos;
      try {
        const stmt = this.parseStatement();
        if (stmt) body.push(stmt);
      } catch {
        this.skipToSemicolon();
      }
      if (this.pos === before) this.advance();
    }

    return { varBlocks, body };
  }

  private isIdentifierText(text: string): boolean {
    const tok = this.peek();
    return tok.kind === TokenKind.IDENTIFIER && tok.text.toUpperCase() === text;
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
