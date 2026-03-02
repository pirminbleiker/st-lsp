## Plan: LSP Scope & Parser Fixes

Behebt vier zusammenhängende Fehler: der Parser crashed bei `METHOD Foo : BOOL;` (optionales Semikolon ignoriert), Methoden-Scope wird komplett übersprungen (Hover/Definition gehen blind an `methods[]` vorbei), EXTENDS/IMPLEMENTS sind nicht navigierbar (keine Positionsinfo im AST), und undeclared-identifier-Meldungen fehlen oder sind zu mild.

**Phases (5)**

1. **Phase 1: Parser – optionales Semikolon + EXTENDS/IMPLEMENTS Ranges**
   - **Objective:** `METHOD Foo : BOOL;` darf kein Parse-Error erzeugen. EXTENDS/IMPLEMENTS-Namen sollen ihre Quellposition im AST speichern.
   - **Files/Functions to Modify:**
     - `server/src/parser/ast.ts` — `FunctionBlockDeclaration`, `StructDeclaration`, `InterfaceDeclaration`: `extends?` → `extendsRef?: {name:string; range:Range}`, `implements` → `implementsRefs: Array<{name:string; range:Range}>`
     - `server/src/parser/parser.ts` — `parseMethodDeclaration()`, `parseFunctionDeclaration()`: optionally `match(SEMICOLON)` after `parseTypeRef()`; `parseFunctionBlockDeclaration()`, `parseStructDeclaration()`, `parseInterfaceDeclaration()`: capture token range for extends/implements names
     - All usages of `.extends` / `.implements` across codebase — migrate to new format
   - **Tests to Write:**
     - `parser.test.ts`: `METHOD Foo : BOOL;` (with semicolon) parses without error
     - `parser.test.ts`: `FUNCTION_BLOCK Foo EXTENDS Bar` → `extendsRef.name === 'Bar'` with valid range
     - `parser.test.ts`: `IMPLEMENTS I_A, I_B` → `implementsRefs` with 2 entries with correct ranges

2. **Phase 2: Method/Property Body Traversal in hover + definition**
   - **Objective:** `findNodeAtPosition` in hover.ts and the equivalent in definition.ts skip `pou.methods[]` and `pou.properties[]` entirely — cursor in a method or property body is invisible to all lookups.
   - **Files/Functions to Modify:**
     - `server/src/handlers/hover.ts` — `findNodeAtPosition()`: traverse `pou.methods`, `pou.properties`, `pou.actions` in `FunctionBlockDeclaration` case; add new `MethodDeclaration` and `PropertyDeclaration` cases with `varBlocks` + `body`
     - `server/src/handlers/definition.ts` — same fixes in AST traversal
   - **Tests to Write:**
     - `hover.test.ts`: hover on variable in method body → shows type info (not null)
     - `definition.test.ts`: go-to-def on variable in method body → jumps to declaration

3. **Phase 3: Method-Scope Variable Resolution**
   - **Objective:** When cursor is inside a method, method-own `varBlocks` (VAR_INPUT, VAR_OUTPUT, VAR) are checked first, then FB-level `varBlocks` as fallback.
   - **Files/Functions to Modify:**
     - `server/src/handlers/hover.ts` — `collectVarDeclarations()`: after FB vars, also collect `fb.methods.find(m => positionContains(m.range, pos))?.varBlocks`
     - `server/src/handlers/definition.ts` — `collectLocalVars()`: same logic
   - **Tests to Write:**
     - `hover.test.ts`: hover on method-local `VAR_INPUT` → shows declaration
     - `definition.test.ts`: go-to-def on method-local var → correct position
     - `definition.test.ts`: go-to-def on FB-var from method body → FB-level declaration

4. **Phase 4: Go-to-definition for EXTENDS / IMPLEMENTS**
   - **Objective:** Click on `Bar` in `EXTENDS Bar` or `I_Foo` in `IMPLEMENTS I_Foo, I_Bar` jumps to that declaration.
   - **Files/Functions to Modify:**
     - `server/src/handlers/definition.ts` — `handleDefinition()`: check if cursor is within `extendsRef.range` or any `implementsRefs[i].range`, then search workspace index for the type name
   - **Tests to Write:**
     - `definition.test.ts`: go-to-def on EXTENDS name → finds FB declaration
     - `definition.test.ts`: go-to-def on IMPLEMENTS name → finds interface declaration

5. **Phase 5: Undeclared Identifier: Warning → Error + EXTENDS/IMPLEMENTS validation**
   - **Objective:** Undeclared identifiers emit `DiagnosticSeverity.Error` (not Warning). EXTENDS/IMPLEMENTS names that cannot be resolved emit an Error.
   - **Files/Functions to Modify:**
     - `server/src/handlers/diagnostics.ts` — `runSemanticAnalysis()`: change `DiagnosticSeverity.Warning` → `DiagnosticSeverity.Error` for undeclared identifiers; validate EXTENDS/IMPLEMENTS names against workspace index, emit Error if not found  
   - **Tests to Write:**
     - `diagnostics.test.ts`: undeclared identifier → severity is `Error` (not Warning)
     - `diagnostics.test.ts`: `EXTENDS UnknownFB` → Diagnostic Error when not in workspace

**Open Questions — Answered**
1. Unknown EXTENDS/IMPLEMENTS type → always Error ✅
2. PropertyDeclaration Get/Set bodies traversed in Phase 2 ✅
3. Only undeclared identifier diagnostics change from Warning to Error ✅
