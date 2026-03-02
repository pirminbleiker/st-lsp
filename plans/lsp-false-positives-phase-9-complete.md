## Phase 9 Complete: PROPERTY GET/SET Body Parsing

Phase 9 is implemented and approved. `PROPERTY` declarations now parse `GET` and `SET` accessors into the AST instead of blindly skipping tokens until `END_PROPERTY`.

**Files created/changed:**
- server/src/parser/parser.ts
- server/src/parser/ast.ts
- server/src/__tests__/parser.test.ts

**Functions created/changed:**
- `parsePropertyDeclaration()`
- `parsePropertyAccessor()`
- `isIdentifierText()`
- `PropertyDeclaration` AST shape (`getAccessor`, `setAccessor`)

**Tests created/changed:**
- `server/src/__tests__/parser.test.ts`
  - `parses PROPERTY with GET accessor var blocks and body`
  - `parses PROPERTY with SET accessor var blocks and body`
  - `parses PROPERTY with both GET and SET accessors`

**Review Status:** APPROVED

**Git Commit Message:**
fix: parse property GET and SET accessor bodies

- replace PROPERTY token-skip with accessor-aware parsing
- capture GET/SET var blocks and statements in AST
- add parser tests for GET-only, SET-only, and combined accessors
