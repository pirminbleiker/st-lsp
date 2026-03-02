## Phase 7 Complete: FB Constructor-Call Syntax in VAR Declarations

Phase 7 is implemented and approved. The parser now supports FB constructor-call argument syntax in VAR declarations while avoiding regression for sized intrinsic string types like `STRING(80)` and `WSTRING(80)`.

**Files created/changed:**
- server/src/parser/parser.ts
- server/src/__tests__/parser.test.ts

**Functions created/changed:**
- `parseVarDeclaration()`
- `isSizedStringType()`

**Tests created/changed:**
- `server/src/__tests__/parser.test.ts`
  - `parses VAR x : MyFB(Param := 42); END_VAR without errors` (with AST `initArgs` assertions)
  - `parses VAR x : MyFB(A := 1, B := TRUE); END_VAR without errors` (with AST `initArgs` assertions)
  - `parses VAR x : MyFB(Target := THIS^); END_VAR without errors` (with AST `initArgs` assertions)
  - `does not treat STRING(80) as constructor initArgs`
  - `does not treat WSTRING(80) as constructor initArgs`

**Review Status:** APPROVED

**Git Commit Message:**
fix: parse FB init args in VAR declarations

- support constructor-call argument syntax after FB type refs
- preserve STRING/WSTRING sized type parsing without initArgs
- add parser AST-shape and regression tests for Phase 7
