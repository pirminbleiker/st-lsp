/** IEC 61131-3 Structured Text recursive-descent parser */

import {
  ActionDeclaration,
  AliasDeclaration,
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
} from './ast';
import { Lexer, TokenKind } from './lexer';
import { StatementParser } from './statements';

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

class Parser extends StatementParser {

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
