## Phase 4 Complete: AND_THEN / OR_ELSE Short-Circuit Operators

Phase 4 is implemented and approved. The lexer now recognizes `AND_THEN` and `OR_ELSE` as compound single tokens, and the parser accepts these operators in boolean IF conditions without misinterpreting `THEN`.

**Files created/changed:**
- server/src/parser/lexer.ts
- server/src/parser/parser.ts
- server/src/__tests__/lexer.test.ts
- server/src/__tests__/parser.test.ts

**Functions created/changed:**
- `Lexer.TokenKind` enum (added `AND_THEN`, `OR_ELSE`)
- `KEYWORDS` map in lexer (added `AND_THEN`, `OR_ELSE`)
- `Parser.parseAnd()`
- `Parser.parseOr()`

**Tests created/changed:**
- `server/src/__tests__/lexer.test.ts`
  - `tokenizes AND_THEN as a single AND_THEN token`
  - `tokenizes OR_ELSE as a single OR_ELSE token`
- `server/src/__tests__/parser.test.ts`
  - `parses IF condition with AND_THEN without errors (Phase 4)`
  - `parses IF condition with OR_ELSE without errors (Phase 4)`

**Review Status:** APPROVED

**Git Commit Message:**
fix: support AND_THEN and OR_ELSE parsing

- tokenize AND_THEN and OR_ELSE as compound keywords
- parse short-circuit operators in boolean expression stages
- add lexer and parser regression tests for IF conditions
