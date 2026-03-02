## Phase 1 Complete: Typed Literal Suffix Scanning

Implemented and validated the lexer fix for typed literal suffix scanning, including a follow-up revision to prevent operator swallowing after date/time literals. Phase 1 now tokenizes all required typed literal forms correctly while preserving subtraction/addition token boundaries in arithmetic expressions.

**Files created/changed:**
- server/src/parser/lexer.ts
- server/src/__tests__/lexer.test.ts

**Functions created/changed:**
- `Lexer.readIdentOrKeyword()`

**Tests created/changed:**
- `server/src/__tests__/lexer.test.ts` (`typed literals (Phase 1)` suite)
  - `tokenizes SINT#-128 as a single INTEGER token`
  - `tokenizes LREAL#1.79E+308 as a single REAL token`
  - `tokenizes DWORD#16#FFFFFFFF as a single INTEGER token`
  - `tokenizes DATE#1970-1-1 as a single token`
  - `tokenizes DT#1970-1-1-0:0:0 as a single token`
  - `tokenizes TOD#23:59:59.999 as a single token`
  - `tokenizes T#49D17H2M47S295MS as a single token`
  - `keeps BYTE#0 tokenization working`
  - `does not regress normal subtraction tokenization`
  - `does not swallow subtraction after typed numeric literal`
  - `does not swallow subtraction after TOD typed literal`
  - `does not swallow subtraction after DT typed literal`
  - `does not swallow addition after T typed literal`

**Review Status:** APPROVED

**Git Commit Message:**
fix: handle typed literal suffixes correctly

- support signed/exponent/date-time typed literal suffix scanning
- prevent swallowing arithmetic operators after typed literals
- add comprehensive lexer regression tests for typed literals
