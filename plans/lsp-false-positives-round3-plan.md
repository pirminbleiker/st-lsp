## Plan: LSP False Positives Round 3

Fix ~3,600 remaining false-positive diagnostics in the mobject-core-src test fixtures. All errors trace back to 5 root causes: missing `REF=` operator support, numeric bit access after dot (`.0`–`.7`), `ENUM` keyword not usable as identifier, multi-dimensional array subscript indexing, and unresolved external library types cascading into hundreds of "Undefined identifier" errors. Fixing these 5 areas eliminates ~99% of the remaining false positives.

**Agent Mail Thread:** `lsp-false-positives-r3`

**Error Breakdown (from Problems.json analysis):**

| Root Cause | Error Messages | Est. Count | Phase |
|-----------|---------------|------------|-------|
| `REF=` reference assignment not parsed | "Expected ';'", "Expected ':' after variable name", "Unexpected expression statement" | ~500+ | Phase 1 |
| Cascading from REF= in Primitive types | "Unexpected expression statement" in method bodies | ~300+ | Phase 1 |
| Bit access via numeric after dot (`pByte^.0`) | "Expected member name", "Expected ';'", "Unexpected expression statement" | ~100+ | Phase 2 |
| `Enum` keyword used as identifier | "Expected variable name", "Unexpected token 'Enum' in expression" | ~10 | Phase 2 |
| Multi-dim array subscript `arr[i, j]` | "Expected ']'", "Unexpected token ','", "Unexpected token 'THEN'" | ~75 | Phase 3 |
| Unresolvable external types (TcUnit, JSON lib) | "Cannot resolve type 'TcUnit.FB_TestSuite'", "'FB_JsonDynDomParser'" | ~25 | Phase 4 |
| Inherited methods from unresolved base | "Undefined identifier 'TEST'/'AssertEquals'/'TEST_FINISHED'/..." | ~700+ | Phase 4 |
| Unresolvable `__SYSTEM.IQueryInterface` | "Cannot resolve type '__SYSTEM.IQueryInterface'" | ~12 | Phase 4 |

---

**Phases (4 phases)**

1. **Phase 1: REF= Reference Assignment Operator**
    - **Objective:** Add `REF=` as a recognized operator in both variable declaration initializers and assignment statements. This single fix eliminates ~800+ cascading errors (~50% of all false positives) across all Primitive type files (`_BOOL`, `_BYTE`, `_DINT`, `_DT`, `_DWORD`, `_INT`, `_LINT`, `_LREAL`, `_LWORD`, `_PVOID`, `_REAL`, `_SINT`, `_STRING`, `_TIME_OF_DAY`, `_TOD`, `_UDINT`, `_UINT`, `_ULINT`, `_USINT`, `_WORD`) and `WriteBitToBoolOperation`/`WriteBoolToBitOperation`.
    - **Files/Functions to Modify/Create:**
        - [server/src/parser/lexer.ts](server/src/parser/lexer.ts) — Add `REF_ASSIGN = 'REF='` to `TokenKind` enum. In the tokenizer, when encountering the identifier `REF` followed by `=`, emit a single `REF_ASSIGN` token instead of separate `IDENTIFIER('REF')` + `EQ` tokens.
        - [server/src/parser/parser.ts](server/src/parser/parser.ts) — `parseVarDeclaration()` (~L430-457): After parsing the type, check for `TokenKind.REF_ASSIGN` in addition to `TokenKind.ASSIGN` as an initialization operator. The AST node should carry a flag or the initializer should be stored the same way.
        - [server/src/parser/parser.ts](server/src/parser/parser.ts) — `parseAssignmentOrCall()` (~L708-720): After parsing the LHS expression, check for `TokenKind.REF_ASSIGN` in addition to `TokenKind.ASSIGN`. Produce an `AssignmentStatement` (possibly with an `isRefAssign: true` flag) or a new `RefAssignmentStatement` node.
        - [server/src/parser/ast.ts](server/src/parser/ast.ts) — If needed, add `isRefAssign?: boolean` to `AssignmentStatement` or add a new `RefAssignmentStatement` node. Alternatively, reuse existing `AssignmentStatement` since the semantic meaning is similar for LSP purposes.
    - **File Reservations:**
        - server/src/parser/lexer.ts (exclusive)
        - server/src/parser/parser.ts (exclusive)
        - server/src/parser/ast.ts (exclusive)
        - server/src/__tests__/parser.test.ts (exclusive)
    - **Tests to Write:**
        - `refAssign_varDecl_init`: `VAR x : REFERENCE TO INT REF= myInt; END_VAR` → 0 parse errors
        - `refAssign_statement`: `METHOD FB_init ... THIS^.dest REF= Source;` → 0 parse errors
        - `refAssign_clearRef`: `activeData REF= localData;` → 0 parse errors, AST has assignment node
        - `refAssign_regression_assign`: `x := 5;` still works, `:=` assignment unaffected
        - `refAssign_fixture_BOOL`: Parse `_BOOL.TcPOU` fixture content → error count drops from ~8 to 0
        - `refAssign_fixture_WriteBitToBool`: Parse `WriteBitToBoolOperation.TcPOU` → 0 errors
    - **Steps:**
        1. Add `REF_ASSIGN` token kind to `TokenKind` enum in lexer.ts
        2. In the lexer tokenizer, when an IDENTIFIER `REF` is followed by `=`, produce a `REF_ASSIGN` token (lookahead required, similar to `**` power operator handling)
        3. In `parseVarDeclaration()`, after type parsing, accept both `ASSIGN` and `REF_ASSIGN` as initialization operators
        4. In `parseAssignmentOrCall()`, accept `REF_ASSIGN` as assignment operator alongside `ASSIGN`
        5. Write tests covering var declaration init, statement assignment, regression
        6. Run full test suite
    - **Depends On:** none

2. **Phase 2: Bit Access via Numeric Literal + ENUM Keyword as Identifier**
    - **Objective:** (A) Support TwinCAT's numeric bit/byte field access syntax (`pByte^.0`, `pByte^.7`) by accepting `INTEGER` tokens after DOT in member access expressions. (B) Add `ENUM` (and other missing keywords) to the `isKeywordUsableAsIdentifier()` set so `Enum` can be used as a variable/parameter name. Together these fixes eliminate ~110+ errors.
    - **Files/Functions to Modify/Create:**
        - [server/src/parser/parser.ts](server/src/parser/parser.ts) — `parsePostfixExpression()` (~L1101-1111): In the DOT member access branch, after the DOT token, check for both `IDENTIFIER` and `INTEGER` tokens. If `INTEGER`, create a `MemberExpression` with the numeric string as the `member` field (e.g., `"0"`, `"7"`).
        - [server/src/parser/parser.ts](server/src/parser/parser.ts) — `isKeywordUsableAsIdentifier()` (~L1732-1740): Add `TokenKind.ENUM` to the allowed set. Consider also adding other commonly-used-as-identifier keywords from real TwinCAT code: `END_ENUM`, `TYPE`, `END_TYPE`, `STRUCT`, `END_STRUCT`, `UNION`, `END_UNION`, `ACTION`, `END_ACTION`.
        - [server/src/parser/parser.ts](server/src/parser/parser.ts) — `parseVarDeclaration()`: Currently checks `IDENTIFIER` for variable name; also accept tokens where `isKeywordUsableAsIdentifier()` is true.
    - **File Reservations:**
        - server/src/parser/parser.ts (exclusive)
        - server/src/__tests__/parser.test.ts (exclusive)
    - **Tests to Write:**
        - `bitAccess_dot_zero`: `val := pByte^.0;` → 0 parse errors, MemberExpression with member `"0"`
        - `bitAccess_dot_seven`: `val := pByte^.7;` → 0 parse errors
        - `bitAccess_in_case`: `CASE n OF 0: result := p^.0; ... END_CASE` → 0 errors
        - `enum_as_identifier_varInput`: `VAR_INPUT Enum : T_MAXSTRING; END_VAR` → 0 errors
        - `enum_as_identifier_namedParam`: `Func(EnumString := Enum);` → 0 errors
        - `enum_keyword_regression`: `TYPE MyEnum : (A, B, C); END_TYPE` still parsed correctly for ENUM type declarations
        - `bitAccess_fixture_BIT`: Parse `_BIT.TcPOU` fixture → error count drops from ~50+ to near 0
        - `enumIdent_fixture_EnumDatatypeBase`: Parse `EnumDatatypeBase.TcPOU` → error count drops from 5 to 0
    - **Steps:**
        1. In `parsePostfixExpression()` DOT branch, accept `INTEGER` in addition to `IDENTIFIER` after DOT
        2. Create `MemberExpression` with the integer's text as the member name
        3. Add `TokenKind.ENUM` to `isKeywordUsableAsIdentifier()`
        4. Ensure `parseVarDeclaration()` accepts keyword-as-identifier tokens for variable names
        5. Write tests for bit access, keyword-as-identifier, regressions
        6. Run full test suite
    - **Depends On:** Phase 1

3. **Phase 3: Multi-Dimensional Array Subscript Indexing**
    - **Objective:** Support comma-separated indices in array subscript expressions (`arr[i, j]`, `arr[i, j, k]`), matching TwinCAT's multi-dimensional array access syntax. This fixes ~75 errors from 2D/3D array test fixtures.
    - **Files/Functions to Modify/Create:**
        - [server/src/parser/ast.ts](server/src/parser/ast.ts) — `SubscriptExpression` interface: Change `index: Expression` to `indices: Expression[]` (array of expressions for each dimension). Update all references to `SubscriptExpression.index` throughout the codebase.
        - [server/src/parser/parser.ts](server/src/parser/parser.ts) — `parsePostfixExpression()` (~L1085-1096): In the LBRACKET branch, parse comma-separated list of expressions (`parseExpression()` + while COMMA, repeat) before expecting RBRACKET.
        - All handler files that reference `SubscriptExpression.index` — Update to use `indices[0]` or iterate `indices` as appropriate. Likely: [server/src/handlers/completion.ts](server/src/handlers/completion.ts), [server/src/handlers/hover.ts](server/src/handlers/hover.ts), [server/src/handlers/definition.ts](server/src/handlers/definition.ts), [server/src/handlers/diagnostics.ts](server/src/handlers/diagnostics.ts).
    - **File Reservations:**
        - server/src/parser/ast.ts (exclusive)
        - server/src/parser/parser.ts (exclusive)
        - server/src/handlers/completion.ts (shared)
        - server/src/handlers/hover.ts (shared)
        - server/src/handlers/definition.ts (shared)
        - server/src/handlers/diagnostics.ts (shared)
        - server/src/__tests__/parser.test.ts (exclusive)
    - **Tests to Write:**
        - `subscript_single_dim`: `arr[5]` → SubscriptExpression with single index, regression
        - `subscript_two_dim`: `arr[i, j]` → SubscriptExpression with 2 indices
        - `subscript_three_dim`: `arr[i, j, k]` → SubscriptExpression with 3 indices
        - `subscript_expression_indices`: `arr[i+1, j*2]` → indices are BinaryExpressions
        - `subscript_fixture_2D`: Parse `_ArrayDatatype_2D_TestSuite.TcPOU` → error count drops to near 0
    - **Steps:**
        1. Change `SubscriptExpression.index` to `indices: Expression[]` in ast.ts
        2. Update parser to collect comma-separated expressions in subscript brackets
        3. Search all usages of `SubscriptExpression` / `.index` across handlers and update
        4. Write tests
        5. Run full test suite
    - **Depends On:** Phase 2

4. **Phase 4: External Type Resolution and Inherited Member Suppression**
    - **Objective:** Suppress false "Cannot resolve type" errors for external library types and suppress "Undefined identifier" errors for method/property calls on FBs that extend unresolvable base types. This eliminates ~700+ errors from test suite files. The approach is deliberately conservative: suppress diagnostics rather than attempt to resolve external library types.
    - **Files/Functions to Modify/Create:**
        - [server/src/handlers/diagnostics.ts](server/src/handlers/diagnostics.ts) — "Cannot resolve type" checks (~L930-984): Change severity from Error to Warning for unresolved EXTENDS/IMPLEMENTS references. External types like `TcUnit.FB_TestSuite`, `__SYSTEM.IQueryInterface`, `FB_JsonDynDomParser` can't be resolved without external library indexing, so they should be warnings, not errors.
        - [server/src/handlers/diagnostics.ts](server/src/handlers/diagnostics.ts) — "Undefined identifier" checks (~L737-864): When a POU (FB, PROGRAM) has an EXTENDS clause whose type cannot be resolved, **skip** the undefined identifier check entirely for that POU's body. The rationale: if we can't resolve the base type, we can't know its inherited methods/properties, so flagging identifiers as "undefined" produces only false positives.
        - [server/src/handlers/diagnostics.ts](server/src/handlers/diagnostics.ts) — Add known external library namespaces to a suppressions set: `TCUNIT`, `__SYSTEM`, `TC3_JSONXML`, and suppress "Cannot resolve type" for any type whose namespace prefix matches.
    - **File Reservations:**
        - server/src/handlers/diagnostics.ts (exclusive)
        - server/src/__tests__/diagnostics.test.ts (exclusive)
    - **Tests to Write:**
        - `externalType_warning_not_error`: FB extending `TcUnit.FB_TestSuite` → "Cannot resolve type" is Warning severity, not Error
        - `unresolvableBase_skipIdentCheck`: FB extending unresolvable type, calling methods `TEST()`, `AssertEquals()` → 0 "Undefined identifier" errors
        - `resolvableBase_stillChecked`: FB extending a known/resolved type → "Undefined identifier" still reported for genuinely undefined names
        - `systemInterface_suppressed`: Interface extending `__SYSTEM.IQueryInterface` → warning, not error
        - `fixture_TestSuite`: Parse a `*_TestSuite.TcPOU` file → errors drop from hundreds to near 0
    - **Steps:**
        1. Change "Cannot resolve type" diagnostics for EXTENDS/IMPLEMENTS from Error to Warning severity
        2. In the "Undefined identifier" walking logic, detect when the current POU has an unresolvable EXTENDS; if so, skip the undefined-identifier walk for that POU
        3. Add a known external namespace set for qualified-name suppressions
        4. Write tests
        5. Run full test suite, verify mobject-core fixtures
    - **Depends On:** Phase 3

---

**Open Questions**
1. **REF= lexer strategy:** Should `REF=` be lexed as a single token (lookahead from `REF` + `=`) or handled in the parser by matching IDENTIFIER("REF") + EQ? Single token is cleaner. May need to handle `REF =` with whitespace between as well — TwinCAT likely allows this. Test with and without whitespace.
2. **SubscriptExpression breaking change:** Changing `index` to `indices` is a breaking change for all handler code. Alternative: keep `index` for single dimension (backward compat) and add optional `additionalIndices`? Recommendation: clean break to `indices: Expression[]` is better long-term.
3. **Granularity of inherited-member suppression:** Should we suppress ALL undefined identifier checks when EXTENDS is unresolvable, or only suppress identifiers that look like method calls (i.e., followed by `(`)? Option A: suppress all (simpler, fewer false positives) / Option B: suppress only calls (more precise, might miss property access). Recommendation: Option A, suppress all for the POU body.
4. **Additional keywords as identifiers:** Beyond `ENUM`, should `TYPE`, `STRUCT`, `UNION`, `ACTION` etc. also be added to `isKeywordUsableAsIdentifier()`? Real TwinCAT code may use these as parameter names. Check fixture files for other keyword-as-identifier usage before deciding scope.
