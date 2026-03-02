## Phase 8 Complete: INTERFACE Trailing Semicolon Handling

Phase 8 is implemented and approved. The parser now accepts optional semicolons after INTERFACE headers while preserving correctness for incomplete declarations.

**Files created/changed:**
- server/src/parser/parser.ts
- server/src/__tests__/parser.test.ts

**Functions created/changed:**
- `parseInterfaceDeclaration()`

**Tests created/changed:**
- `server/src/__tests__/parser.test.ts`
  - `parses INTERFACE with EXTENDS and trailing semicolon before END_INTERFACE without errors`
  - `parses extracted TcIO-like short form INTERFACE I_Foo; without errors`
  - `reports an error for incomplete INTERFACE I_Foo without semicolon and END_INTERFACE`

**Review Status:** APPROVED

**Git Commit Message:**
fix: allow interface header trailing semicolon

- accept INTERFACE headers ending with semicolon
- support extracted short-form INTERFACE declarations at EOF
- keep missing END_INTERFACE diagnostics for incomplete headers
