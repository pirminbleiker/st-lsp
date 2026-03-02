## Phase 6 Complete: Pragmas Before METHOD/PROPERTY in FB/INTERFACE Bodies

Phase 6 is implemented and approved. The parser now consumes pragma tokens before METHOD/PROPERTY detection in FUNCTION_BLOCK and INTERFACE body loops, preventing false "unexpected token" errors for pragma-prefixed members.

**Files created/changed:**
- server/src/parser/parser.ts
- server/src/__tests__/parser.test.ts

**Functions created/changed:**
- `parseFunctionBlockDeclaration()` body member loop
- `parseInterfaceDeclaration()` body member loop

**Tests created/changed:**
- `server/src/__tests__/parser.test.ts`
  - `parses pragma before PROPERTY in FUNCTION_BLOCK`
  - `parses pragma before METHOD in FUNCTION_BLOCK`
  - `parses pragmas before METHOD and PROPERTY in INTERFACE`

**Review Status:** APPROVED

**Git Commit Message:**
fix: handle pragmas before FB/interface members

- consume pragma tokens before METHOD/PROPERTY checks
- support pragma-prefixed member declarations in FB and INTERFACE
- add parser regression tests for pragma/member combinations
