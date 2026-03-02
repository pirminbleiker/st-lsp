# Plan: Fix All False-Positive LSP Errors on mobject-core

**Created:** 2025-01-27
**Status:** Ready for Atlas Execution

## Summary

The st-lsp extension reports hundreds of false-positive errors when parsing the mobject-core TwinCAT project, which compiles without errors in TwinCAT. All errors trace back to **9 distinct root causes** in the parser (`parser.ts`), lexer (`lexer.ts`), and semantic diagnostics (`diagnostics.ts`). Fixing these 9 issues eliminates ~800+ individual false-positive diagnostics. The fixes are ordered by error volume impact (highest first).

## Context & Analysis

**Error Volume Breakdown (from Problems.json):**

| Root Cause | Error Type | Affected Files | Est. Errors |
|-----------|-----------|---------------|-------------|
| Multi-level CASE labels | "Unexpected expression statement" | ~22 TryConvert_*_TO_Destination.TcPOU | ~400 |
| Typed literal suffix bugs | "Expected ';'" / "Expected variable name" | DatatypeLimits.TcGVL | ~260 |
| GVL name not in scope | "Undefined identifier 'DatatypeLimits'" | ~150+ TryConvert_*.TcPOU | ~200 |
| Anonymous inline enum | cascade errors | AsyncCommandStateMachine.TcPOU | ~15 |
| Pragmas before PROPERTY in FB body | "Unexpected token '{attribute...}'" | AsyncCommandStateMachine.TcPOU | ~15 |
| FB constructor-call syntax | "Expected ';'" cascade | OrderedDictionary.TcPOU | ~6 |
| AND_THEN operator | "Expected 'THEN'" | SingleAsyncCommandRunner.TcPOU | ~1 |
| INTERFACE trailing semicolon | "Unexpected token ';' inside INTERFACE" | I_ListNode.TcIO | ~1 |
| PROPERTY GET/SET body skipped | cascade from above | AsyncCommandStateMachine.TcPOU | (secondary) |

**Relevant Files:**

- `server/src/parser/lexer.ts`: Token scanning (typed literals, keywords)
- `server/src/parser/parser.ts`: Recursive-descent parser (CASE labels, VAR declarations, INTERFACE, FB body)
- `server/src/parser/ast.ts`: AST node type definitions
- `server/src/handlers/diagnostics.ts`: Semantic analysis ("Undefined identifier" errors)

**Key Functions/Classes:**

- `readIdentOrKeyword()` in `lexer.ts` ~L460: Typed literal suffix scanning
- `KEYWORDS` map in `lexer.ts` ~L132: Keyword registration
- `isAtCaseLabel()` in `parser.ts` ~L830: CASE clause label lookahead
- `parseVarDeclaration()` in `parser.ts` ~L560: Variable declaration parsing
- `parseTypeRef()` in `parser.ts`: Type reference parsing
- `parseInterfaceDeclaration()` in `parser.ts` ~L1348: INTERFACE body loop
- `parseFunctionBlockDeclaration()` in `parser.ts` ~L256: FB body member loop
- `runSemanticAnalysis()` in `diagnostics.ts` ~L510: Scope building (GVL names)

**Test Fixtures (for verification):**
- `tests/fixtures/mobject-core-src/src/sln/lib/mobject-core/mobject-constants/DatatypeLimits.TcGVL`
- `tests/fixtures/mobject-core-src/src/sln/lib/mobject-core/mobject-converters/Converters/BOOL_TO_/TryConvert_BOOL_TO_Destination.TcPOU`
- `tests/fixtures/mobject-core-src/src/sln/lib/mobject-core/mobject-converters/Converters/BYTE_TO_/TryConvert_BYTE_TO_SINT.TcPOU`
- `tests/fixtures/mobject-core-src/src/sln/lib/mobject-core/mobject-collections/Interfaces/Collections/Nodes/I_ListNode.TcIO`
- `tests/fixtures/mobject-core-src/src/sln/lib/mobject-core/mobject-collections/OrderedDictionary/OrderedDictionary.TcPOU`
- `tests/fixtures/mobject-core-src/src/sln/lib/mobject-core/mobject-commands/_Internal/AsyncCommandStateMachine/AsyncCommandStateMachine.TcPOU`
- `tests/fixtures/mobject-core-src/src/sln/lib/mobject-core/mobject-commands/AsyncCommand/Runners/SingleAsyncCommandRunner.TcPOU`

**Dependencies:**
- `vscode-languageserver` / `vscode-languageserver-textdocument`: LSP protocol
- Vitest for test framework (`server/vitest.config.ts`)

**Patterns & Conventions:**
- Parser is hand-written recursive descent
- Lexer normalizes keywords to uppercase via `KEYWORDS` map lookup
- Error recovery via `skipToSemicolon()` — one parse failure cascades into many errors on the same file
- All tests in `server/src/__tests__/` using Vitest
- Pure function handlers: `parse(text)` returns `{ ast, errors }`

---

## Implementation Phases

### Phase 1: Typed Literal Suffix Scanning (~260 errors fixed)

**Objective:** Fix the lexer to correctly tokenize typed literals with `-`, `+`, `#`, and `:` in suffixes so that `SINT#-128`, `LREAL#1.79E+308`, `DWORD#16#FFFFFFFF`, `DATE#1970-1-1`, `DT#1970-1-1-0:0:0`, `TOD#23:59:59.999`, and `T#49D17H2M47S295MS` are scanned as single tokens.

**Files to Modify:**
- `server/src/parser/lexer.ts`: `readIdentOrKeyword()` suffix loop (~L466-484)

**Problem Detail:**
The current suffix character set is `isIdentContinue(c) || c === '.' || c === '_'`. This excludes:
- `-` needed for `SINT#-128`, `DATE#1970-1-1`, `DT#...`  
- `+` needed for `LREAL#1.79E+308`
- `#` needed for `DWORD#16#FFFFFFFF` (double-hash typed+based literal)
- `:` needed for `TOD#23:59:59.999`, `DT#1970-1-1-0:0:0`

**Tests to Write:**
- `server/src/__tests__/lexer.test.ts`: Add typed literal tokenization tests:
  - `SINT#-128` → single INTEGER token
  - `LREAL#1.79E+308` → single REAL token  
  - `DWORD#16#FFFFFFFF` → single INTEGER token
  - `DATE#1970-1-1` → single token
  - `DT#1970-1-1-0:0:0` → single token
  - `TOD#23:59:59.999` → single token
  - `T#49D17H2M47S295MS` → single token
  - `BYTE#0` → single INTEGER token (already works, regression guard)

**Steps:**
1. Write test cases verifying current broken behavior (e.g., `SINT#-128` produces multiple tokens)
2. Run tests → should fail
3. Modify `readIdentOrKeyword()` suffix loop to include `+`, `-`, `#`, `:` in the allowed suffix character set (but only after `#` has been seen, i.e., inside a typed literal)
4. Run tests → should pass
5. Run `npm run typecheck` and `npm run lint`

**Acceptance Criteria:**
- [ ] All typed literal forms from DatatypeLimits.TcGVL tokenize as single tokens
- [ ] `parse()` of DatatypeLimits.TcGVL content produces 0 errors
- [ ] Existing lexer tests still pass
- [ ] No regressions: `a - b` still tokenizes as 3 tokens (not confused with negative literal)

---

### Phase 2: Multi-Level Dotted CASE Labels (~400 errors fixed)

**Objective:** Fix `isAtCaseLabel()` to recognize arbitrary-depth dotted identifiers like `__SYSTEM.TYPE_CLASS.TYPE_BOOL:` as case labels.

**Files to Modify:**
- `server/src/parser/parser.ts`: `isAtCaseLabel()` (~L830-876)

**Problem Detail:**
Current `isAtCaseLabel()` only checks these patterns:
- `INTEGER :`
- `IDENT :`
- `IDENT . IDENT :` (2-level only)
- `TRUE/FALSE :`
- `-INTEGER :`

The mobject-core CASE statements use 3-level: `__SYSTEM.TYPE_CLASS.TYPE_BOOL:`. After parsing the first clause, the parser doesn't detect the next clause's label and tries to parse it as a statement → "Unexpected expression statement".

**Tests to Write:**
- `server/src/__tests__/parser.test.ts`: Add CASE label tests:
  - CASE with `A.B.C:` (3-level dotted)
  - CASE with `A.B.C.D:` (4-level dotted, for robustness)
  - CASE with `A.B:` (2-level, regression)
  - CASE with `A:` (1-level, regression)

**Steps:**
1. Write test with 3-level dotted CASE label, expect 0 parse errors
2. Run test → should fail
3. Modify `isAtCaseLabel()`: replace the fixed 2-level check with a loop that scans `IDENT(.IDENT)*` followed by `:` (but not `:=`)
4. Run test → should pass
5. Verify TryConvert_BOOL_TO_Destination.TcPOU CASE body parses correctly
6. Run `npm run typecheck`

**Acceptance Criteria:**
- [ ] `__SYSTEM.TYPE_CLASS.TYPE_BOOL:` recognized as a valid case label
- [ ] All TryConvert_*_TO_Destination.TcPOU files parse without "Unexpected expression statement"
- [ ] Existing CASE tests still pass
- [ ] 2-level and 1-level dotted labels still work

---

### Phase 3: GVL Container Name in Scope (~200 errors fixed)

**Objective:** Add GVL declaration names (like `DatatypeLimits`) to the semantic analysis scope so `DatatypeLimits.MAX_VALUE_...` is recognized.

**Files to Modify:**
- `server/src/handlers/diagnostics.ts`: `runSemanticAnalysis()` (~L510-556)
- Possibly `server/src/parser/parser.ts`: `parseGvlDeclaration()` (~L1401) if `GvlDeclaration.name` isn't populated

**Problem Detail:**
When the diagnostics handler builds the scope for semantic analysis, it adds GVL *variable names* to `globalNames` but not the GVL *container name* itself. Code like `DatatypeLimits.MAX_VALUE_OF_BYTE` references `DatatypeLimits` as a `NameExpression`, which isn't found in scope → "Undefined identifier 'DatatypeLimits'".

The GVL name comes from two sources:
1. The `GvlDeclaration.name` field in the AST (may need to be populated from the .TcGVL filename or XML attribute)
2. Cross-file: the workspace index should register GVL names as known symbols

**Tests to Write:**
- `server/src/__tests__/diagnostics.test.ts` (or relevant test file): 
  - Parse a GVL with `VAR_GLOBAL` and verify the GVL name is in scope
  - Parse code referencing `GVLName.VarName` — should produce 0 "Undefined identifier" errors

**Steps:**
1. Examine how `GvlDeclaration.name` is populated in the parser (check if TcGVL files set it)
2. Write test: parse `DatatypeLimits.TcGVL` content + code referencing `DatatypeLimits.BYTE_MAX_VALUE`
3. Run test → should fail with "Undefined identifier"
4. In `runSemanticAnalysis()`, when iterating GVL declarations (both local and cross-file), add `gvl.name` to `globalNames` if it's not already there
5. If `GvlDeclaration.name` isn't set for TcGVL files, fix `parseGvlDeclaration()` or the TcGVL extraction path to set it from the file name
6. Run test → should pass
7. Run `npm run typecheck`

**Acceptance Criteria:**
- [ ] `DatatypeLimits.BYTE_MAX_VALUE` resolves without "Undefined identifier"
- [ ] All TryConvert_*.TcPOU files that reference `DatatypeLimits` produce 0 "Undefined identifier" errors
- [ ] Other GVL references in the workspace still work correctly

---

### Phase 4: AND_THEN / OR_ELSE Short-Circuit Operators (~1 error + correctness)

**Objective:** Add `AND_THEN` and `OR_ELSE` as compound keywords in the lexer and handle them in the expression parser.

**Files to Modify:**
- `server/src/parser/lexer.ts`: `KEYWORDS` map, `TokenKind` enum, `readIdentOrKeyword()` (or compound keyword scanning)
- `server/src/parser/parser.ts`: Binary expression precedence handling
- `server/src/parser/ast.ts`: Add to binary op types if needed

**Problem Detail:**
`AND_THEN` is tokenized as `AND` + `THEN`. In `IF currentCommand <> 0 AND_THEN currentCommand.Busy THEN`, the parser sees `AND` keyword and then `THEN` — which it interprets as the IF's `THEN` keyword, consuming it prematurely. The actual `THEN` later becomes orphaned.

IEC 61131-3 defines `AND_THEN` and `OR_ELSE` as short-circuit Boolean operators. They should tokenize as single compound keywords (like `END_IF`, `END_FOR`).

**Tests to Write:**
- `server/src/__tests__/lexer.test.ts`: `AND_THEN` → single token, `OR_ELSE` → single token
- `server/src/__tests__/parser.test.ts`: 
  - `IF a AND_THEN b THEN ... END_IF` → parses without errors
  - `IF a OR_ELSE b THEN ... END_IF` → parses without errors

**Steps:**
1. Write lexer test for `AND_THEN` as single token
2. Run test → should fail (tokenized as two tokens)
3. Add `AND_THEN` and `OR_ELSE` to the `KEYWORDS` map and `TokenKind` enum
4. Handle them in the expression parser at the same precedence level as `AND`/`OR`
5. Run tests → should pass
6. Run `npm run typecheck`

**Acceptance Criteria:**
- [ ] `AND_THEN` and `OR_ELSE` recognized as single compound keywords
- [ ] IF statements using `AND_THEN` parse correctly
- [ ] SingleAsyncCommandRunner.TcPOU parses without "Expected 'THEN'" error
- [ ] Existing AND/OR expression tests still pass

---

### Phase 5: Anonymous Inline Enum in VAR Declarations (~15 errors fixed)

**Objective:** Support `varName : (VALUE1, VALUE2, VALUE3);` anonymous enum type syntax in variable declarations.

**Files to Modify:**
- `server/src/parser/parser.ts`: `parseVarDeclaration()` or `parseTypeRef()` (~L560-600)
- `server/src/parser/ast.ts`: May need an `InlineEnumType` variant in `TypeRef`

**Problem Detail:**
In `AsyncCommandStateMachine.TcPOU`:
```st
VAR
    state : (IDLE, INITIALIZING, EXECUTING, COMPLETING, COMPLETED, ABORTING, ABORTED, ERRORED);
END_VAR
```
After parsing `state :`, `parseTypeRef()` expects an identifier-based type name but encounters `(`. IEC 61131-3 allows anonymous enumerated types in variable declarations. The parser's TYPE block parser already handles enum syntax — this parsing logic needs to be reachable from `parseTypeRef()`.

**Tests to Write:**
- `server/src/__tests__/parser.test.ts`:
  - `VAR x : (A, B, C); END_VAR` → parses without errors
  - `VAR x : (A, B, C) := A; END_VAR` → parses with initializer
  - `VAR x : (A := 1, B := 2); END_VAR` → parses with explicit values

**Steps:**
1. Write test for inline enum in VAR block
2. Run test → should fail
3. In `parseTypeRef()` (or `parseVarDeclaration()`), detect `(` token after `:` and delegate to inline enum parsing (reuse logic from TYPE enum parser)
4. Add `InlineEnumType` to AST if needed, or represent as an anonymous TypeDeclaration
5. Run test → should pass
6. Run `npm run typecheck`

**Acceptance Criteria:**
- [ ] `state : (IDLE, INITIALIZING, ...)` parses without errors
- [ ] AsyncCommandStateMachine.TcPOU line 9 no longer produces parse errors
- [ ] Existing VAR declaration tests still pass

---

### Phase 6: Pragmas Before PROPERTY/METHOD in FB/INTERFACE Body (~15 cascade errors fixed)

**Objective:** Consume pragma tokens before checking for METHOD/PROPERTY keywords inside FUNCTION_BLOCK and INTERFACE body loops.

**Files to Modify:**
- `server/src/parser/parser.ts`: FB body loop in `parseFunctionBlockDeclaration()` (~L256-290), INTERFACE body loop in `parseInterfaceDeclaration()` (~L1348-1392)

**Problem Detail:**
In `AsyncCommandStateMachine.TcPOU`:
```st
{attribute 'monitoring' := 'call'}
PROPERTY PUBLIC ErrorId : UDINT
```
The FB body loop checks `this.check(TokenKind.METHOD)` and `this.check(TokenKind.PROPERTY)` to detect member declarations. But the pragma `{attribute ...}` comes first as a `PRAGMA` token. The loop doesn't consume pragmas before these checks, so it hits the error fallback → "Unexpected token '{attribute ...}'".

The parser already has `parsePragmas()` / `parsePragmaToken()` — the fix is to call it at the right place.

**Tests to Write:**
- `server/src/__tests__/parser.test.ts`:
  - FB with `{attribute 'monitoring' := 'call'} PROPERTY ...` → parses without errors
  - FB with `{attribute 'test'} METHOD ...` → parses without errors

**Steps:**
1. Write test for pragma before PROPERTY in FB
2. Run test → should fail
3. In the FB body loop, call `parsePragmas()` before the METHOD/PROPERTY checks, attach collected pragmas to the subsequent member declaration
4. Do the same for the INTERFACE body loop
5. Run test → should pass
6. Run `npm run typecheck`

**Acceptance Criteria:**
- [ ] Pragma + PROPERTY combinations parse without errors
- [ ] Pragma + METHOD combinations parse without errors
- [ ] AsyncCommandStateMachine.TcPOU line 53 no longer produces "Unexpected token" error
- [ ] Existing pragma tests still pass

---

### Phase 7: FB Constructor-Call Syntax in VAR Declarations (~6 errors fixed)

**Objective:** Support `varName : FBType(Param := Value);` FB initialization syntax.

**Files to Modify:**
- `server/src/parser/parser.ts`: `parseVarDeclaration()` (~L560-600)
- `server/src/parser/ast.ts`: May need `initArgs` field on `VarDeclaration`

**Problem Detail:**
In `OrderedDictionary.TcPOU`:
```st
VAR
    dictionaryChangedEvent : KeyValueCollectionChangedEvent(Target := THIS^);
END_VAR
```
After parsing `dictionaryChangedEvent : KeyValueCollectionChangedEvent`, the parser expects `:=` or `;`. Instead it sees `(Target := THIS^)` — TwinCAT's FB_init parameter passing syntax. This is distinct from function calls; it's part of the variable declaration.

**Tests to Write:**
- `server/src/__tests__/parser.test.ts`:
  - `VAR x : MyFB(Param := 42); END_VAR` → parses without errors
  - `VAR x : MyFB(A := 1, B := TRUE); END_VAR` → multiple params
  - `VAR x : MyFB(Target := THIS^); END_VAR` → with THIS^

**Steps:**
1. Write test for FB constructor syntax
2. Run test → should fail
3. In `parseVarDeclaration()`, after parsing the type reference, check for `(` and if found, parse named argument list `(ident := expr, ...)` as initialization arguments
4. Store init args in the AST node
5. Run test → should pass
6. Run `npm run typecheck`

**Acceptance Criteria:**
- [ ] `KeyValueCollectionChangedEvent(Target := THIS^)` parses as part of VAR declaration
- [ ] OrderedDictionary.TcPOU lines 209/218 no longer produce parse errors
- [ ] Existing VAR declaration tests still pass

---

### Phase 8: INTERFACE Trailing Semicolon (~1 error fixed)

**Objective:** Allow optional `;` after INTERFACE declaration (and after EXTENDS clause).

**Files to Modify:**
- `server/src/parser/parser.ts`: `parseInterfaceDeclaration()` (~L1348-1392)

**Problem Detail:**
In `I_ListNode.TcIO`:
```st
INTERFACE I_ListNode EXTENDS I_CollectionNode;
```
The parser expects `METHOD`, `PROPERTY`, or `END_INTERFACE` after the EXTENDS clause. It encounters `;` and reports "Unexpected token ';' inside INTERFACE". This is valid TwinCAT syntax for minimal (empty) interfaces.

Note: `.TcIO` files may extract only the declaration line without `END_INTERFACE` — the parser should also handle graceful EOF after the semicolon.

**Tests to Write:**
- `server/src/__tests__/parser.test.ts`:
  - `INTERFACE I_Foo EXTENDS I_Bar; END_INTERFACE` → parses without errors
  - `INTERFACE I_Foo;` (no END_INTERFACE, as extracted from TcIO) → parses without errors

**Steps:**
1. Write test for interface with trailing `;`
2. Run test → should fail
3. In `parseInterfaceDeclaration()` body loop, add `else if (this.check(TokenKind.SEMICOLON)) { this.advance(); }` before the error fallback
4. Also add pragma consumption in the INTERFACE body loop (if not already done in Phase 6)
5. Run test → should pass
6. Run `npm run typecheck`

**Acceptance Criteria:**
- [ ] `INTERFACE I_ListNode EXTENDS I_CollectionNode;` parses without errors
- [ ] I_ListNode.TcIO no longer produces "Unexpected token ';'" error
- [ ] Existing INTERFACE tests still pass

---

### Phase 9: PROPERTY GET/SET Body Parsing (cleanup / future-proofing)

**Objective:** Replace the blind token-skipping in `parsePropertyDeclaration()` with actual GET/SET accessor parsing.

**Files to Modify:**
- `server/src/parser/parser.ts`: `parsePropertyDeclaration()` (~L1449-1477)
- `server/src/parser/ast.ts`: `PropertyDeclaration` interface (~L394)

**Problem Detail:**
Currently `parsePropertyDeclaration()` parses the name and type, then skips all tokens until `END_PROPERTY`. This means:
- No diagnostics inside PROPERTY GET/SET bodies
- No completion/hover/go-to-definition inside PROPERTYs
- GET/SET var blocks and statements are invisible to all handlers

This phase is lower priority because the cascading errors from PROPERTYs in AsyncCommandStateMachine are caused by Phases 5 and 6 (inline enum + pragma issues), not by this skip behavior. However, proper PROPERTY parsing improves overall LSP quality.

**Tests to Write:**
- `server/src/__tests__/parser.test.ts`:
  - PROPERTY with GET accessor → var blocks + body parsed
  - PROPERTY with SET accessor → var blocks + body parsed
  - PROPERTY with both GET and SET → both parsed

**Steps:**
1. Add GET/SET token handling (lexer may need `GET` and `SET` as context-sensitive keywords or identifiers)
2. Add `getAccessor?: { varBlocks: VarBlock[]; body: Statement[] }` and `setAccessor?` to `PropertyDeclaration` in `ast.ts`
3. Replace the blind-skip loop in `parsePropertyDeclaration()` with:
   - Detect `GET` / `SET` identifiers
   - Parse var blocks and statement body for each accessor
   - Handle `END_GET` / `END_SET` (or just scan for next accessor / `END_PROPERTY`)
4. Write tests
5. Run tests → should pass
6. Run `npm run typecheck`

**Acceptance Criteria:**
- [ ] PROPERTY GET/SET bodies are parsed into the AST
- [ ] Diagnostics, hover, and completion work inside PROPERTY accessors
- [ ] AsyncCommandStateMachine.TcPOU properties parse fully
- [ ] Existing PROPERTY tests still pass

---

## Open Questions

1. **Typed literal suffix ambiguity:** Including `-` in the suffix scan could conflict with subtraction expressions like `LREAL#1.5 - x`. 
   - **Option A:** Only allow `-` immediately after `E`/`e` (for scientific notation) and after `#` when the prefix is a date/time type.
   - **Option B:** After scanning the typed literal prefix (e.g. `DATE#`), use a type-aware suffix scanner that knows date/time literals can contain `-` and `:`.
   - **Recommendation:** Option B — use the type prefix to select the appropriate suffix scanning mode. Date/time types (`DATE`, `DT`, `DATE_AND_TIME`, `TOD`, `TIME_OF_DAY`, `TIME`, `T`, `LTIME`) get the extended suffix set; numeric types get `+`/`-` only after `E`/`e` for scientific notation. All types get `#` for based literals.

2. **GET/SET as keywords vs identifiers:** The lexer may not have `GET`/`SET` as keywords. TwinCAT treats them as context-sensitive (only keywords inside PROPERTY).
   - **Option A:** Add them as full keywords (may break code using `GET`/`SET` as variable names).
   - **Option B:** Detect them by identifier name inside `parsePropertyDeclaration()` only.
   - **Recommendation:** Option B — check identifier text case-insensitively for "GET"/"SET" inside the property parser. This matches TwinCAT's context-sensitive approach.

3. **GVL name source for TcGVL files:** How does the parser get the GVL name?
   - **Option A:** Parse it from the XML filename (e.g., `DatatypeLimits.TcGVL` → name `DatatypeLimits`).
   - **Option B:** Parse it from the XML `<GVL Name="DatatypeLimits">` attribute (requires projectReader).
   - **Recommendation:** Option A for now (filename-based), consistent with how TcPOU names are extracted. The projectReader already uses the filename.

## Risks & Mitigation

- **Risk:** Typed literal suffix changes break arithmetic expression tokenization (e.g., `SINT#1-2` parsed as one token instead of three).
  - **Mitigation:** Use type-aware suffix scanning; add regression tests for expressions after typed literals.

- **Risk:** Multi-level CASE label lookahead becomes too greedy (false-positive label detection).
  - **Mitigation:** Ensure the lookahead requires `:` (not `:=`) after the dotted chain; add tests for assignment statements that look like labels.

- **Risk:** AND_THEN/OR_ELSE keywords break existing identifier usage (unlikely but possible).
  - **Mitigation:** These are IEC 61131-3 standard keywords; any code using them as identifiers is non-compliant. Add to keyword list confidently.

## Success Criteria

- [ ] All 9 root causes fixed
- [ ] DatatypeLimits.TcGVL parses with 0 errors
- [ ] TryConvert_*_TO_Destination.TcPOU files parse with 0 errors
- [ ] TryConvert_*_TO_*.TcPOU files have 0 "Undefined identifier 'DatatypeLimits'" errors
- [ ] AsyncCommandStateMachine.TcPOU parses with 0 errors
- [ ] SingleAsyncCommandRunner.TcPOU parses with 0 errors
- [ ] OrderedDictionary.TcPOU parses with 0 errors
- [ ] I_ListNode.TcIO parses with 0 errors
- [ ] All existing tests in `server/src/__tests__/` still pass
- [ ] `npm run typecheck` passes
- [ ] `npm run lint` passes
- [ ] mobject-core-src test project shows 0 false-positive errors in VS Code

## Notes for Atlas

- **Execution order matters:** Phases 1-3 fix the most errors (~860 combined). Prioritize these.
- **Phase 1 (typed literals) is the trickiest** — requires careful suffix scanning that doesn't break arithmetic. Pay special attention to the distinction between `SINT#-128` (negative typed literal) and `SINT#128 - x` (subtraction after typed literal). Whitespace can help disambiguate but don't rely on it.
- **Phase 2 (CASE labels)** is straightforward — replace the fixed-depth check with a `while` loop over `IDENT.IDENT` sequences.
- **Phase 3 (GVL names)** may require checking how TcGVL filenames flow into the parser. Look at the workspace index and project reader for how GVL names are registered.
- **Run `npx vitest run` after each phase** to verify no regressions.
- **Use the actual fixture files** from `tests/fixtures/mobject-core-src/` as integration test data — parse them with `parse()` and assert 0 errors.
- **The Problems.json file at project root** can be used as a reference but not as a test oracle (it's a VS Code export, not machine-parseable test data).
