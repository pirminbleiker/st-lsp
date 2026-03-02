## Plan: LSP False Positives Round 2

Fix the remaining 5270 false-positive diagnostics reported by st-lsp on the mobject-core test fixtures. All errors trace back to 5 root causes: missing array literal parsing, unrecognized `__SYSTEM` namespace, unscoped inline enum values, unsupported qualified EXTENDS names, and missing system type aliases. Fixing these 5 areas eliminates ~99% of false positives.

**Beads Parent:** `bd-39b`
**Agent Mail Thread:** `bd-39b`

**Error Breakdown (from Problems.json analysis):**

| Root Cause | Error Messages | Count | Phase |
|-----------|---------------|-------|-------|
| Array literal `[1,2,3]` not parsed | "Expected ';'", "Expected ':' after variable name", "Expected variable name", "Unexpected token '[' in expression", "Expected ']'" | ~3535 | Phase 1 |
| `__SYSTEM` namespace not in scope | "Undefined identifier '__SYSTEM'" | ~437 | Phase 2 |
| Inline enum values not scoped | "Undefined identifier 'IDLE'/'ABORTING'/etc." | ~30 | Phase 2 |
| `__INLINE_ENUM` flagged as unknown | "Unknown type: '__INLINE_ENUM'" | ~4 | Phase 2 |
| INTERFACE EXTENDS dotted name fails | "Unexpected token '.' inside INTERFACE" | ~28 | Phase 3 |
| Missing system type aliases | "Unknown type: 'DCTIME'/'FILETIME'/'SJSONVALUE'" | ~25 | Phase 4 |
| External/test-suite types unresolved | "Unknown type: '*_TESTSUITE'" etc. | ~15 | Phase 4 |
| Cascading END_VAR/END_METHOD errors | "Unexpected token 'END_VAR'/'END_METHOD' in expression" | ~344 | Phase 5 |
| Other cascading errors | "Unexpected expression statement", misc | ~852 | Phase 5 |

---

**Phases (5 phases)**

1. **Phase 1: Array Literal Expression Parsing**
    - **Objective:** Add support for array literal expressions `[expr, expr, ...]` in the parser, both as initializers in VAR declarations (`x : ARRAY[0..10] OF BOOL := [FALSE, FALSE, ...];`) and in general expressions. This single fix eliminates ~3535 cascading errors (~67% of all false positives).
    - **Files/Functions to Modify/Create:**
        - [server/src/parser/ast.ts](server/src/parser/ast.ts) — Add `ArrayLiteral` interface to the `Expression` discriminated union. Fields: `kind: 'ArrayLiteral'`, `elements: Expression[]`, `range: Range`.
        - [server/src/parser/parser.ts](server/src/parser/parser.ts) — `parsePrimary()` (~L1093): Add `LBRACKET` case that parses comma-separated expression list terminated by `RBRACKET`. Handle nested arrays `[[1,2],[3,4]]` naturally through recursion.
        - [server/src/parser/parser.ts](server/src/parser/parser.ts) — `skipToSemicolon()` (~L630): Add bracket-depth tracking so `[FALSE,FALSE,...,FALSE];` doesn't consume past the closing `]`.
    - **File Reservations:**
        - server/src/parser/ast.ts (exclusive)
        - server/src/parser/parser.ts (exclusive)
        - server/src/__tests__/parser.test.ts (exclusive)
    - **Tests to Write:**
        - `arrayLiteral_1D`: `VAR x : ARRAY[0..2] OF INT := [1, 2, 3]; END_VAR` → 0 parse errors, AST has ArrayLiteral with 3 IntegerLiteral elements
        - `arrayLiteral_2D`: `VAR x : ARRAY[0..1, 0..1] OF INT := [[1,2],[3,4]]; END_VAR` → 0 parse errors, nested ArrayLiterals
        - `arrayLiteral_3D`: Three-dimensional nested array literal → 0 parse errors
        - `arrayLiteral_booleans`: `[FALSE,FALSE,TRUE,FALSE]` → parsed as ArrayLiteral with BoolLiteral elements
        - `arrayLiteral_empty_regression`: `arr[5]` must still parse as SubscriptExpression, not ArrayLiteral
        - `arrayLiteral_fixtureFile`: Parse `_ArrayDatatype_1D_TestSuite.TcPOU` content → error count drops from 540 to near 0
    - **Steps:**
        1. Add `ArrayLiteral` interface to `ast.ts` Expression union
        2. In `parsePrimary()`, when current token is `LBRACKET`, consume it, parse comma-separated expressions via `parseExpression()`, expect `RBRACKET`
        3. Update `skipToSemicolon()` to track bracket depth (don't skip past `]` that matches an opening `[`)
        4. Write tests verifying 1D, 2D, 3D array literals and SubscriptExpression regression
        5. Run full test suite, verify `_ArrayDatatype_*_TestSuite.TcPOU` fixture files parse clean
    - **Beads Issue:** `bd-36k`
    - **Depends On:** none

2. **Phase 2: __SYSTEM Namespace + Inline Enum Scoping**
    - **Objective:** Eliminate ~471 false "Undefined identifier" diagnostics by (a) adding `__SYSTEM` to the known namespace allowlist, (b) extracting inline enum member names into the diagnostic scope, and (c) suppressing "Unknown type" for `__INLINE_ENUM`.
    - **Files/Functions to Modify/Create:**
        - [server/src/handlers/diagnostics.ts](server/src/handlers/diagnostics.ts) — `ALWAYS_ALLOWED` set (~L47) or `LIBRARY_NAMESPACE_NAMES` (~L55): Add `'__SYSTEM'`
        - [server/src/handlers/diagnostics.ts](server/src/handlers/diagnostics.ts) — `runSemanticAnalysis()` (~L560-610): When building POU scope, iterate VarDeclarations, check if `varDecl.type.inlineEnumValues` is set, and add each value name (uppercased) to `globalNames`/scope
        - [server/src/handlers/diagnostics.ts](server/src/handlers/diagnostics.ts) — Unknown type check (~L698): Add `if (typeName === '__INLINE_ENUM') continue;` to skip the pseudo-type
    - **File Reservations:**
        - server/src/handlers/diagnostics.ts (exclusive)
        - server/src/__tests__/diagnostics.test.ts (exclusive)
    - **Tests to Write:**
        - `__SYSTEM_not_flagged`: Parse code with `CASE __SYSTEM.TYPE_CLASS.TYPE_BOOL:` → 0 "Undefined identifier '__SYSTEM'" errors
        - `inlineEnum_membersInScope`: Parse `VAR state : (IDLE, RUNNING); END_VAR` + `CASE state OF IDLE: ... END_CASE` → 0 "Undefined identifier 'IDLE'" errors
        - `__INLINE_ENUM_suppressed`: Parse variable with inline enum type → no "Unknown type: '__INLINE_ENUM'" warning
        - `asyncCommandStateMachine_fixture`: Parse AsyncCommandStateMachine.TcPOU → enum member errors drop to 0
    - **Steps:**
        1. Add `'__SYSTEM'` to the allowlist in diagnostics.ts
        2. In `runSemanticAnalysis()` scope-building, iterate all VarBlocks → VarDeclarations, if `type.inlineEnumValues` exists, add each value name to the scope set
        3. In the unknown-type diagnostic loop, skip `__INLINE_ENUM` 
        4. Write tests
        5. Run full test suite, verify AsyncCommandStateMachine.TcPOU and TryConvert_*.TcPOU fixtures
    - **Beads Issue:** `bd-1ba`
    - **Depends On:** Phase 1

3. **Phase 3: INTERFACE EXTENDS Qualified Names**
    - **Objective:** Fix the parser to accept dotted/qualified names in INTERFACE EXTENDS clauses (e.g., `INTERFACE I_Foo EXTENDS __SYSTEM.IQueryInterface`) and FUNCTION_BLOCK EXTENDS/IMPLEMENTS. Fixes ~28 errors from `.TcIO` files.
    - **Files/Functions to Modify/Create:**
        - [server/src/parser/parser.ts](server/src/parser/parser.ts) — `parseInterfaceDeclaration()` (~L1420-1429): After parsing the first IDENTIFIER in EXTENDS, loop while DOT follows: `advance()` DOT, `expect(IDENTIFIER)`, concatenate to build qualified name string
        - [server/src/parser/ast.ts](server/src/parser/ast.ts) — `NamedRef` interface (~L20): Either extend `name` to hold qualified "A.B.C" string, or add optional `qualifier: string` field
        - [server/src/parser/parser.ts](server/src/parser/parser.ts) — FB EXTENDS/IMPLEMENTS clause (~L243-246): Apply same qualified-name parsing logic
    - **File Reservations:**
        - server/src/parser/parser.ts (exclusive)
        - server/src/parser/ast.ts (exclusive)
        - server/src/__tests__/parser.test.ts (exclusive)
    - **Tests to Write:**
        - `interface_extends_qualified`: `INTERFACE I_Foo EXTENDS __SYSTEM.IQueryInterface END_INTERFACE` → 0 parse errors
        - `interface_extends_multi_qualified`: `INTERFACE I_Foo EXTENDS A.B, C.D.E END_INTERFACE` → 0 errors, 2 extends refs
        - `interface_extends_simple_regression`: `INTERFACE I_Foo EXTENDS I_Bar END_INTERFACE` → still works
        - `fb_implements_qualified`: `FUNCTION_BLOCK FB_Foo IMPLEMENTS NS.I_Bar END_FUNCTION_BLOCK` → 0 errors
    - **Steps:**
        1. Create helper `parseQualifiedName()` that reads `IDENT(.IDENT)*` and returns concatenated name string + range
        2. Use it in `parseInterfaceDeclaration()` EXTENDS parsing
        3. Use it in FB EXTENDS/IMPLEMENTS parsing
        4. Write tests
        5. Run test suite, verify `.TcIO` fixture files parse clean
    - **Beads Issue:** `bd-2b4`
    - **Depends On:** Phase 2

4. **Phase 4: Unknown Type Suppressions**
    - **Objective:** Reduce "Unknown type" false positives by adding missing TwinCAT system type aliases and handling external library types gracefully. Fixes ~40 errors.
    - **Files/Functions to Modify/Create:**
        - [server/src/twincat/systemTypes.ts](server/src/twincat/systemTypes.ts) — Add `DCTIME`, `FILETIME` as recognized system types (they are standard TwinCAT/Windows types)
        - [server/src/handlers/diagnostics.ts](server/src/handlers/diagnostics.ts) — Unknown type check: If an identifier is POU-defined in the workspace index (cross-file), suppress the error. Also suppress for types matching test suite naming patterns when in test fixture context.
        - [server/src/twincat/workspaceIndex.ts](server/src/twincat/workspaceIndex.ts) — Ensure indexed POU names from `.TcPOU`/`.TcDUT` files are included in the known types set passed to diagnostics
    - **File Reservations:**
        - server/src/twincat/systemTypes.ts (exclusive)
        - server/src/handlers/diagnostics.ts (shared)
        - server/src/twincat/workspaceIndex.ts (shared)
        - server/src/__tests__/diagnostics.test.ts (shared)
    - **Tests to Write:**
        - `dctime_recognized`: Variable with type `DCTIME` → no "Unknown type" warning
        - `filetime_recognized`: Variable with type `FILETIME` → no "Unknown type" warning
        - `crossFile_type_resolved`: POU name from workspace index used as type → no "Unknown type" warning
    - **Steps:**
        1. Add `DCTIME` and `FILETIME` to system type catalog in systemTypes.ts
        2. In diagnostics unknown-type check, also consult the workspace index POU name set before flagging
        3. Write tests
        4. Run test suite
    - **Beads Issue:** `bd-37h`
    - **Depends On:** Phase 3

5. **Phase 5: Diagnostic Cascade Hardening**
    - **Objective:** Reduce cascading "Unexpected token 'END_VAR'/'END_METHOD' in expression" errors (~344) that are secondary effects from Phases 1-4 fixes, plus harden the parser's error recovery so remaining parse failures produce fewer cascade errors.
    - **Files/Functions to Modify/Create:**
        - [server/src/parser/parser.ts](server/src/parser/parser.ts) — `skipToSemicolon()` (~L630): Add awareness of block-end tokens (`END_VAR`, `END_METHOD`, `END_FUNCTION_BLOCK`, `END_PROGRAM`) as valid recovery points instead of erroring on them
        - [server/src/parser/parser.ts](server/src/parser/parser.ts) — `parseVarBlock()`: If `END_VAR` is encountered mid-expression-parse, treat as end of block rather than error
        - [server/src/handlers/diagnostics.ts](server/src/handlers/diagnostics.ts) — Consider limiting max diagnostics per file to avoid flooding (configurable threshold)
    - **File Reservations:**
        - server/src/parser/parser.ts (exclusive)
        - server/src/handlers/diagnostics.ts (shared)
        - server/src/__tests__/parser.test.ts (shared)
    - **Tests to Write:**
        - `errorRecovery_endVarStops`: Malformed VAR block with unknown syntax → parser recovers at END_VAR, no cascade into next method
        - `errorRecovery_endMethodStops`: Malformed statement → parser recovers at END_METHOD, subsequent methods parse clean
        - `cascadeCount_fixtureFile`: Parse a previously-cascading fixture → error count reduced by >80%
    - **Steps:**
        1. Run full test suite after Phases 1-4 to measure remaining errors
        2. Identify remaining cascade patterns (likely most will already be fixed)
        3. Add END_VAR/END_METHOD to `skipToSemicolon()` as recovery stop tokens
        4. Test error recovery with intentionally malformed inputs
        5. Run full test suite
    - **Beads Issue:** `bd-27c`
    - **Depends On:** Phase 4

---

**Open Questions**
1. **Array literal ambiguity with subscript:** `[expr]` after an identifier is a subscript, but `[expr, expr]` after `:=` is an array literal. Should `parsePrimary()` always treat standalone `[` as array literal, relying on postfix `[]` for subscripts? Current parser handles subscript in `parsePostfixExpression()` which takes precedence, so standalone `[` in primary position is safe for array literals.
2. **SJSONVALUE and FB_JsonDynDomParser types:** These come from external Beckhoff libraries. Should we add them to systemTypes or wait for proper library-reference indexing? Option A: add the most common ones now / Option B: improve workspaceIndex to index library references.
3. **Test fixture error count target:** Should we aim for zero diagnostics on mobject-core fixtures, or accept some residual warnings for truly external/unresolvable types? Recommendation: target zero errors (severity 8), allow residual warnings (severity 4) for external library types.
4. **__INLINE_ENUM pseudo-type:** The parser creates this as a type name for inline enums. Should we replace it with a proper AST representation or just suppress the diagnostic? Recommendation: suppress diagnostic now, refactor AST later.
