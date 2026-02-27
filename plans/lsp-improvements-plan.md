# Plan: LSP Improvements — 6 Critical Fixes

**Created:** 2026-02-27
**Status:** Ready for Atlas Execution

## Summary

Six improvements for the st-lsp extension covering: (1) greying out XML/CDATA wrappers in TcPOU files, (2) fixing member-access (dot) completion on objects, (3) fixing CASE statement sub-code recognition, (4) typed enum parsing support, (5) VAR CONSTANT / VAR RETAIN recognition, and (6) constant value resolution. These span lexer, parser, AST, handlers, and the client extension.

## Context & Analysis

**Relevant Files:**

- [server/src/parser/lexer.ts](server/src/parser/lexer.ts): Token definitions — missing `CONSTANT`, `RETAIN` keywords
- [server/src/parser/ast.ts](server/src/parser/ast.ts): AST node types — `VarBlock` needs `constant`/`retain` flags; `EnumDeclaration` needs `baseType` for old-style enums
- [server/src/parser/parser.ts](server/src/parser/parser.ts): Recursive-descent parser — CASE lookahead gaps, VAR modifier handling, typed enum parsing
- [server/src/handlers/completion.ts](server/src/handlers/completion.ts): Dot-completion — `getIdentifierBeforeDot` and `getDotAccessMembers` need major improvements
- [server/src/handlers/semanticTokens.ts](server/src/handlers/semanticTokens.ts): Semantic token provider — needs XML-aware classification for TcPOU files
- [server/src/handlers/foldingRange.ts](server/src/handlers/foldingRange.ts): Folding — needs XML region folding for TcPOU
- [server/src/handlers/diagnostics.ts](server/src/handlers/diagnostics.ts): Diagnostics — constant resolution, enum type checking
- [server/src/twincat/tcExtractor.ts](server/src/twincat/tcExtractor.ts): CDATA extraction — needs to expose XML vs code ranges
- [client/src/extension.ts](client/src/extension.ts): VS Code client — potential decoration-based approach for XML dimming

**Key Functions/Classes:**

- `isAtCaseLabel()` in parser.ts (~L790): Conservative 2-token lookahead that misses edge cases
- `parseVarBlock()` in parser.ts (~L370): Consumes VAR keyword but ignores CONSTANT/RETAIN modifiers
- `parseEnumBody()` in parser.ts (~L1140): Old-style enum parser, no base type support
- `parseTypeDeclarationBlock()` in parser.ts (~L1076): TYPE dispatcher doesn't route typed enums correctly
- `getIdentifierBeforeDot()` in completion.ts (~L96): Only extracts simple name before dot, no chain support
- `getDotAccessMembers()` in completion.ts (~L401): Resolves only simple variable types, no chain/interface/inheritance
- `getMembersFromDeclarations()` in completion.ts: Missing interface, enum, alias, union, inherited member support
- `extractTopLevelCDATAs()` in tcExtractor.ts (~L106): Extracts ST but doesn't expose XML range boundaries
- `handleSemanticTokens()` in semanticTokens.ts: Doesn't call tcExtractor, lexes raw XML for TcPOU files

**Dependencies:**

- `vscode-languageserver`: LSP protocol types, SemanticTokensBuilder
- `vscode-languageclient`: Client extension framework
- `vitest`: Test framework

**Patterns & Conventions:**

- All handlers follow `(params, documents, index) → result` pattern
- Case-insensitive identifier comparison via `.toUpperCase()`
- Parser uses `skipToSemicolon()` for error recovery
- Tests use `makeDoc()` / `makeParams()` helpers with vitest
- TDD: write test → run (fail) → implement → run (pass)

---

## Implementation Phases

### Phase 1: VAR CONSTANT and VAR RETAIN Support

**Objective:** Add `CONSTANT` and `RETAIN` as recognized keywords so `VAR CONSTANT`, `VAR RETAIN`, `VAR_GLOBAL CONSTANT`, etc. are parsed correctly.

**Files to Modify:**

- `server/src/parser/lexer.ts`: Add `CONSTANT` and `RETAIN` to `TokenKind` enum and `KEYWORDS` map
- `server/src/parser/ast.ts`: Add `constant?: boolean` and `retain?: boolean` flags to `VarBlock` interface
- `server/src/parser/parser.ts`: In `parseVarBlock()`, after consuming the VAR keyword, check for and consume `CONSTANT`/`RETAIN` tokens and set flags on the VarBlock node
- `server/src/handlers/hover.ts`: Show `CONSTANT`/`RETAIN` qualifier in hover info for variables
- `server/src/handlers/semanticTokens.ts`: Classify `CONSTANT`/`RETAIN` tokens as keywords

**Tests to Write:**

- `parser.test.ts`: Parse `VAR CONSTANT x : INT; END_VAR` → assert `varBlock.constant === true`
- `parser.test.ts`: Parse `VAR RETAIN y : REAL; END_VAR` → assert `varBlock.retain === true`
- `parser.test.ts`: Parse `VAR_GLOBAL CONSTANT GC : INT := 42; END_VAR` → assert both `varKind === 'VAR_GLOBAL'` and `constant === true`
- `parser.test.ts`: Parse `VAR CONSTANT RETAIN` (combined) → verify behavior
- `diagnostics.test.ts`: Ensure no false "undeclared variable" errors for vars in `VAR CONSTANT` blocks

**Steps:**

1. Write parser tests for `VAR CONSTANT` / `VAR RETAIN` var blocks (should fail)
2. Add `CONSTANT = 'CONSTANT'` and `RETAIN = 'RETAIN'` to `TokenKind` enum in lexer.ts
3. Add `['CONSTANT', TokenKind.CONSTANT]` and `['RETAIN', TokenKind.RETAIN]` to `KEYWORDS` map
4. Add `constant?: boolean` and `retain?: boolean` to `VarBlock` interface in ast.ts
5. In `parseVarBlock()`, after `const kindTok = this.advance()`, add:
   ```ts
   let constant = false;
   let retain = false;
   if (this.match(TokenKind.CONSTANT)) constant = true;
   if (this.match(TokenKind.RETAIN)) retain = true;
   // Also handle reverse order: RETAIN CONSTANT
   if (!constant && this.match(TokenKind.CONSTANT)) constant = true;
   ```
6. Pass `constant` and `retain` to the returned `VarBlock` object
7. Run tests (should pass)
8. Update hover handler to show qualifier info
9. Lint/format

**Acceptance Criteria:**

- [ ] `VAR CONSTANT`, `VAR RETAIN`, `VAR_GLOBAL CONSTANT`, `VAR_GLOBAL RETAIN` parse without errors
- [ ] `VarBlock.constant` / `VarBlock.retain` flags are set correctly in AST
- [ ] Variables inside CONSTANT/RETAIN blocks are recognized in completion and diagnostics
- [ ] No regression in existing VAR block parsing
- [ ] All tests pass

---

### Phase 2: Typed Enum Parsing Support

**Objective:** Support the common TwinCAT typed enum syntax: `TYPE Color : (Red := 1, Green := 2) INT; END_TYPE` and `TYPE Color : INT := (Red := 1, Green := 2); END_TYPE`.

**Files to Modify:**

- `server/src/parser/ast.ts`: Ensure `EnumDeclaration` has `baseType?: TypeRef` (may already exist for block-style)
- `server/src/parser/parser.ts`:
  - In `parseTypeDeclarationBlock()`: After the `:`, detect typed enum patterns:
    - `<TypeName> := (...)` pattern → route to modified `parseEnumBody` with baseType
    - `(...) <TypeName>` pattern → route to modified `parseEnumBody` with trailing baseType
  - In `parseEnumBody()`: Accept optional `baseType` parameter and support trailing type after `)`
- `server/src/handlers/completion.ts`: Ensure enum type-name completion includes typed enums
- `server/src/handlers/hover.ts`: Show base type in enum hover info

**Tests to Write:**

- `parser.test.ts`: Parse `TYPE Color : INT := (Red := 1, Green := 2); END_TYPE` → assert `baseType.name === 'INT'` and 2 enum values
- `parser.test.ts`: Parse `TYPE Color : (Red := 1, Green := 2) INT; END_TYPE` → same assertions
- `parser.test.ts`: Parse `TYPE Color : DINT := (Red, Green, Blue); END_TYPE` → assert baseType + 3 values
- `parser.test.ts`: Verify old-style `TYPE Color : (Red, Green); END_TYPE` still works (regression)
- `parser.test.ts`: Verify block-style `TYPE Color : ENUM : INT ... END_ENUM; END_TYPE` still works

**Steps:**

1. Write parser tests for both typed enum syntaxes (should fail)
2. Ensure `EnumDeclaration` in ast.ts has `baseType?: TypeRef` — it should already exist from block-style support
3. Modify `parseTypeDeclarationBlock()` dispatcher:
   - After consuming `name` and `:`, if the next token is an IDENTIFIER (potential base type) and the token after that is `:=`:
     - Parse the base type reference
     - Consume `:=`
     - Expect `(`
     - Call `parseEnumBody(name, start)` with the parsed baseType
   - In `parseEnumBody()`: After consuming `)`, check if next token is an IDENTIFIER (trailing type) and consume it as baseType
4. Set `baseType` on the returned `EnumDeclaration`
5. Run tests (should pass)
6. Update hover to show base type information
7. Lint/format

**Acceptance Criteria:**

- [ ] `TYPE X : INT := (A := 1, B := 2); END_TYPE` parses correctly with `baseType === 'INT'`
- [ ] `TYPE X : (A := 1, B := 2) INT; END_TYPE` parses correctly with `baseType === 'INT'`
- [ ] Old-style enums without base type still work
- [ ] Block-style ENUM...END_ENUM still works
- [ ] All tests pass

---

### Phase 3: CASE Statement Sub-Code Recognition

**Objective:** Fix the `isAtCaseLabel()` lookahead to correctly distinguish new case labels from statements inside case branches, especially for edge cases with boolean labels, negative numbers, and enum-qualified labels.

**Files to Modify:**

- `server/src/parser/parser.ts`:
  - `isAtCaseLabel()` (~L790): Expand lookahead to handle:
    - `TRUE:` / `FALSE:` as valid case labels
    - Negative ranges: `-1..5:`
    - Negative comma lists: `-1, 0, 1:`
    - Enum-qualified labels: `E_State.Running:`
  - `parseCaseClause()`: Verify nested statements (IF, FOR, WHILE, CASE) work within case body

**Tests to Write:**

- `parser.test.ts`: CASE with nested IF statement inside a branch
- `parser.test.ts`: CASE with nested FOR loop inside a branch
- `parser.test.ts`: CASE with nested WHILE loop inside a branch
- `parser.test.ts`: CASE with multiple statements per branch (assignments, calls, etc.)
- `parser.test.ts`: CASE with `TRUE:` / `FALSE:` labels
- `parser.test.ts`: CASE with negative integer labels: `-1:`
- `parser.test.ts`: CASE with range labels: `1..10:`
- `parser.test.ts`: CASE with enum-qualified labels: `E_State.Running:`
- `parser.test.ts`: CASE with ELSE branch containing nested control flow
- `regression.data-and-control.test.ts`: Regression test for complex CASE scenarios

**Steps:**

1. Write parser tests for CASE with nested sub-code (should fail for some edge cases)
2. Expand `isAtCaseLabel()`:
   ```ts
   private isAtCaseLabel(): boolean {
     const tok0 = this.peek(0);
     
     // Boolean labels: TRUE : or FALSE :
     if (tok0.kind === TokenKind.TRUE || tok0.kind === TokenKind.FALSE) {
       const tok1 = this.peek(1);
       if (tok1.kind === TokenKind.COLON) return true;
       if (tok1.kind === TokenKind.COMMA || tok1.kind === TokenKind.DOTDOT) return true;
     }
     
     // Negative integer: - INTEGER (: or .. or ,)
     if (tok0.kind === TokenKind.MINUS) {
       const tok1 = this.peek(1);
       if (tok1.kind === TokenKind.INTEGER) {
         const tok2 = this.peek(2);
         return tok2.kind === TokenKind.COLON 
             || tok2.kind === TokenKind.DOTDOT 
             || tok2.kind === TokenKind.COMMA;
       }
     }
     
     // Integer or identifier: N : or N .. or N , or N.member :
     if (tok0.kind === TokenKind.INTEGER || tok0.kind === TokenKind.IDENTIFIER) {
       const tok1 = this.peek(1);
       if (tok1.kind === TokenKind.COLON) return true;
       if (tok1.kind === TokenKind.DOTDOT || tok1.kind === TokenKind.COMMA) return true;
       // Enum-qualified: IDENT.IDENT :
       if (tok0.kind === TokenKind.IDENTIFIER && tok1.kind === TokenKind.DOT) {
         const tok2 = this.peek(2);
         if (tok2.kind === TokenKind.IDENTIFIER) {
           const tok3 = this.peek(3);
           return tok3.kind === TokenKind.COLON 
               || tok3.kind === TokenKind.COMMA 
               || tok3.kind === TokenKind.DOTDOT;
         }
       }
     }
     
     return false;
   }
   ```
3. Run tests (should pass)
4. Verify no regressions in existing CASE tests
5. Lint/format

**Acceptance Criteria:**

- [ ] Nested IF/FOR/WHILE/REPEAT inside CASE branches parse correctly
- [ ] Multiple statements per CASE branch are recognized
- [ ] Boolean labels `TRUE:` / `FALSE:` work
- [ ] Negative and range labels work
- [ ] Enum-qualified labels `E_State.Running:` work
- [ ] No regressions in existing CASE parsing
- [ ] All tests pass

---

### Phase 4: Member-Access (Dot) Completion on Objects

**Objective:** Fix dot-completion so it works for object instances. The current implementation only handles simple `varName.` patterns but fails for chained access, interface types, inherited members, and more.

**Files to Modify:**

- `server/src/handlers/completion.ts`:
  - `getIdentifierBeforeDot()` → Replace with AST-based approach or improve text scanning
  - `getDotAccessMembers()` → Add support for:
    - Interface types
    - Inherited members (EXTENDS chain)
    - Chained member access (`a.b.c.`)
    - Alias type resolution
  - `getMembersFromDeclarations()` → Add InterfaceDeclaration support
- `server/src/parser/ast.ts`: No changes expected (MemberExpression already exists)

**Tests to Write:**

- `completion.test.ts`: `myFb.` on FB with VAR_OUTPUT, methods, properties → lists all public members
- `completion.test.ts`: `myFb.` on FB that EXTENDS another → lists inherited members
- `completion.test.ts`: `myItf.` on interface variable → lists interface methods/properties
- `completion.test.ts`: `myStruct.` on struct variable → lists struct fields
- `completion.test.ts`: `myFb.innerStruct.` on chained access → lists inner struct fields
- `completion.test.ts`: Enum dot access `E_Color.` → lists enum values
- `crossFileCompletion.test.ts`: Cross-file type resolution for dot completion

**Steps:**

1. Write completion tests for the failing scenarios (should fail)
2. **Improve type resolution chain**: Create a `resolveExpressionType()` helper that:
   - For `NameExpression`: look up variable type from scope
   - For `MemberExpression`: resolve base type, then find member's type in that type
   - For `CallExpression`: resolve callee → find return type
   - Supports recursive chain resolution
3. **Replace `getIdentifierBeforeDot()`**: Instead of text scanning, use the AST:
   - Parse the document
   - Find the node at cursor position (or just before the dot)
   - If it's a `MemberExpression` with incomplete member, resolve the base type
   - If it's a `NameExpression` followed by dot, resolve the variable type
4. **Extend `getMembersFromDeclarations()`**:
   - Add `InterfaceDeclaration` handling: return interface method/property signatures
   - Add `EnumDeclaration` handling: return enum values
   - Add `AliasDeclaration` handling: resolve alias to underlying type, recurse
   - Add `UnionDeclaration` handling: return union fields
5. **Add inheritance chain walking**:
   - When resolving FB members, check `extends` field
   - Recursively collect members from parent FBs
   - Filter out PRIVATE members from parent
6. Run tests (should pass)
7. Lint/format

**Implementation Detail — Incremental Approach:**

Given the complexity, implement in sub-steps:
- **4a**: Fix simple `myFb.` to show all members including VAR_INPUT, inherited → most impactful
- **4b**: Add interface resolution
- **4c**: Add chained access (`a.b.c.`) via AST-based approach
- **4d**: Add enum dot access, alias resolution

**Acceptance Criteria:**

- [ ] `myFb.` shows VAR_OUTPUT, VAR_IN_OUT, methods, properties of the FB type
- [ ] `myFb.` on FB with EXTENDS shows inherited public members
- [ ] `myItf.` on interface-typed variable shows interface methods/properties
- [ ] `myStruct.field.` on nested struct access resolves chained types
- [ ] `E_Color.` lists enum values
- [ ] Cross-file type resolution works for dot completion
- [ ] No regression in existing completion behavior
- [ ] All tests pass

---

### Phase 5: Constant Value Resolution

**Objective:** Resolve constant values so that constants defined in `VAR CONSTANT` blocks or as enum values are available with their evaluated values in hover, completion detail, and diagnostics.

**Files to Modify:**

- `server/src/handlers/hover.ts`: Show resolved constant value in hover tooltip (e.g., `MAX_COUNT : INT := 100` → hover shows value `100`)
- `server/src/handlers/completion.ts`: Show constant value in completion detail text
- `server/src/handlers/diagnostics.ts`: Use constant values for basic validation (optional, lower priority)
- `server/src/parser/ast.ts`: No changes needed — `VarDeclaration.initialValue` already stores the expression

**Tests to Write:**

- `hover.test.ts`: Hover over constant variable shows its value
- `hover.test.ts`: Hover over enum member shows its explicit value
- `completion.test.ts`: Completion for constants shows value in detail
- `hover.test.ts`: Hover over constant with expression `2 + 3` shows the expression text (not evaluated)

**Steps:**

1. Write hover and completion tests for constant value display (should fail)
2. Create a `formatConstantValue(expr: Expression): string` utility that:
   - For `IntegerLiteral`/`RealLiteral`/`StringLiteral`/`BoolLiteral`: return the literal value
   - For `BinaryExpression`: return formatted text like `2 + 3`
   - For `NameExpression`: return the name (can't resolve cross-references yet)
   - For complex expressions: return a reasonable string representation
3. In `hover.ts`:
   - When hovering a variable from a `VarBlock` with `constant === true`, append `= <value>` to the hover markdown
   - When hovering an enum member with `value`, append `= <value>`
4. In `completion.ts`:
   - For completion items from CONSTANT var blocks, add the value to `detail` field
5. Run tests (should pass)
6. Lint/format

**Acceptance Criteria:**

- [ ] Hovering a `VAR CONSTANT` variable shows its assigned value
- [ ] Hovering an enum member with explicit value shows the value
- [ ] Completion items for constants include value information
- [ ] Expression values are shown as formatted text (not necessarily evaluated)
- [ ] All tests pass

---

### Phase 6: XML/CDATA Dimming in TcPOU Files

**Objective:** Grey out (dim) everything outside `<![CDATA[...]]>` sections in TcPOU/TcGVL/TcDUT/TcIO files so users clearly see what is ST code vs XML wrapper. Also fold XML wrapper regions.

**Files to Modify:**

- `server/src/twincat/tcExtractor.ts`: Add a function to compute XML regions (ranges that are NOT inside CDATA content) with precise line/character positions
- `server/src/handlers/semanticTokens.ts`: For TcPOU file types, emit `comment` semantic tokens for all XML regions (greying them out via theme)
- `server/src/handlers/foldingRange.ts`: For TcPOU file types, add folding ranges for XML wrapper regions (before first CDATA, between CDATAs, after last CDATA)
- `server/src/server.ts`: Ensure semantic tokens and folding work for TcPOU files

**Approach — Semantic Tokens for Greying:**

The most robust approach is to use semantic tokens since they're already supported:
1. In `semanticTokens.ts`, detect if the document is a TcPOU-type file (by URI extension)
2. Use `tcExtractor` to identify CDATA content ranges in the original XML
3. Emit semantic tokens with type `comment` for all lines/characters outside CDATA content
4. The VS Code theme will naturally render `comment` tokens in a dimmed color
5. Inside CDATA, emit normal ST semantic tokens (as currently done for .st files, but with position mapping)

**Alternative Approach — Client Decorations:**

If semantic tokens alone aren't sufficient (e.g., if the user truly wants text to be almost invisible), use VS Code decorations in the client:
1. The server provides a custom notification with XML ranges
2. The client applies `TextEditorDecorationType` with very dim foreground color
3. This gives more control over styling but requires client-side logic

**Recommended: Start with semantic tokens (simpler, server-only), iterate to decorations if needed.**

**Tests to Write:**

- `semanticTokens.test.ts`: For a TcPOU fixture, verify XML lines are classified as `comment`
- `semanticTokens.test.ts`: For a TcPOU fixture, verify CDATA content lines have normal ST tokens
- `foldingRange.test.ts`: For a TcPOU fixture, verify XML wrapper regions are foldable
- `tcExtractor.test.ts`: Test the new `getXmlRanges()` function returns correct non-CDATA regions

**Steps:**

1. Write tests for XML range detection and semantic token classification (should fail)
2. Add `getXmlRanges(text: string): Range[]` to tcExtractor.ts that returns all ranges NOT inside CDATA content
3. In `semanticTokens.ts`:
   - Check if document URI has a TcPOU-type extension
   - If so, compute XML ranges via `getXmlRanges()`
   - Extract ST code and compute ST semantic tokens with line mapping
   - Emit `comment` tokens for XML ranges
   - Emit mapped ST tokens for CDATA content
4. In `foldingRange.ts`:
   - Check if document has TcPOU-type extension
   - Add folding ranges for XML sections (header before first CDATA, sections between CDATAs, footer after last CDATA)
5. Run tests (should pass)
6. Manual testing with real TcPOU files to verify visual appearance
7. Lint/format

**Acceptance Criteria:**

- [ ] XML tags and wrappers in TcPOU files appear dimmed (grey/comment-colored)
- [ ] CDATA content (actual ST code) has normal syntax highlighting
- [ ] XML wrapper regions are foldable
- [ ] Line mapping is correct (clicking on code goes to right position)
- [ ] No regression in .st file handling
- [ ] All tests pass

---

## Open Questions

1. **Member completion depth**: How deep should chained member access go (e.g., `a.b.c.d.`)?
   - **Option A:** Support 1 level of chaining (simple `a.b.`)
   - **Option B:** Support unlimited chaining via recursive resolution
   - **Recommendation:** Option B — implement recursive type resolution from the start. It's not significantly more complex and covers real-world ST patterns better.

2. **Typed enum syntax priority**: Which form is more common in TwinCAT?
   - `TYPE X : INT := (A, B); END_TYPE` (base type before values)
   - `TYPE X : (A, B) INT; END_TYPE` (base type after values)
   - **Recommendation:** Support both, but prioritize `INT := (...)` as it's the standard TwinCAT 3 syntax.

3. **CDATA dimming approach**: Semantic tokens vs client decorations?
   - **Option A:** Semantic tokens (server-only, theme-dependent)
   - **Option B:** Client decorations (more control, requires client changes)
   - **Option C:** Both — semantic tokens for coloring, decorations for additional styling
   - **Recommendation:** Start with Option A. If the visual result isn't strong enough, add Option B later.

4. **Constant evaluation**: Should we evaluate constant expressions (e.g., `2 * 3 + 1` → `7`)?
   - **Option A:** Show raw expression text only
   - **Option B:** Evaluate simple arithmetic expressions
   - **Recommendation:** Option A for now. Expression evaluation is a significant effort and the raw text is already useful.

5. **VAR PERSISTENT**: Should we also support `VAR PERSISTENT` alongside `CONSTANT`/`RETAIN`?
   - **Recommendation:** Yes, add `PERSISTENT` as a keyword too while we're modifying the lexer/parser. It's commonly used in TwinCAT.

## Risks & Mitigation

- **Risk:** Semantic tokens for XML dimming may conflict with existing theme rules for TcPOU files
  - **Mitigation:** Test with multiple VS Code themes; use `comment` token type which is universally styled in all themes

- **Risk:** AST-based dot completion may be slow for large files due to re-parsing
  - **Mitigation:** The current approach already re-parses on every request; the additional type resolution is a tree walk, not a re-parse. Monitor performance.

- **Risk:** `isAtCaseLabel()` expansion might have false positives (treating a statement as a label)
  - **Mitigation:** Comprehensive test cases covering both directions (statements that look like labels, labels that look like statements). The 4-token lookahead for enum-qualified labels is the riskiest — test thoroughly.

- **Risk:** Typed enum parsing changes might break existing enum parsing
  - **Mitigation:** Write regression tests for all currently-supported enum forms before changing anything. Run full test suite after each change.

- **Risk:** Member completion for inherited types could infinite-loop on circular EXTENDS
  - **Mitigation:** Track visited type names in a Set during inheritance chain walking. Bail after reasonable depth (e.g., 20 levels).

## Success Criteria

- [ ] `VAR CONSTANT` and `VAR RETAIN` blocks parse and function correctly
- [ ] Typed enums in both syntaxes parse correctly with base type information
- [ ] CASE branches support arbitrary nested code without parsing errors
- [ ] Dot-completion works on FB instances, struct instances, interface variables, and chained access
- [ ] Constants show their values in hover and completion
- [ ] TcPOU files visually distinguish XML wrappers from ST code
- [ ] All existing tests continue to pass (no regressions)
- [ ] New tests cover all new functionality

## Notes for Atlas

**Recommended execution order:** Phase 1 → Phase 2 → Phase 3 → Phase 5 → Phase 4 → Phase 6

Rationale:
- **Phase 1 (VAR CONSTANT/RETAIN)** is the simplest and unblocks Phase 5 (constant resolution)
- **Phase 2 (Typed Enums)** is standalone parser work
- **Phase 3 (CASE)** is standalone parser work
- **Phase 5 (Constants)** depends on Phase 1 (`VarBlock.constant` flag)
- **Phase 4 (Dot Completion)** is the most complex and benefits from having the parser fixes done first
- **Phase 6 (XML Dimming)** is independent but most complex in terms of cross-cutting concerns

**Testing strategy:** Run `npx vitest run` from the `server/` directory after each phase. Check for regressions before proceeding.

**Important codebase conventions:**
- Use `.toUpperCase()` for all identifier comparisons
- Keep handlers pure — no side effects
- Preserve the `(params, documents, index) → result` handler signature pattern
- Use `skipToSemicolon()` for parser error recovery
- All AST nodes must have `range: Range`
