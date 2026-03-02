## Phase 2 Complete: Multi-Level Dotted CASE Labels

Phase 2 is implemented and approved. CASE clause detection now supports arbitrary-depth dotted identifiers (e.g. `__SYSTEM.TYPE_CLASS.TYPE_BOOL:`), while preserving prior label behavior and guarding against accidental `:=` misclassification.

**Files created/changed:**
- server/src/parser/parser.ts
- server/src/__tests__/parser.test.ts

**Functions created/changed:**
- `Parser.isAtCaseLabel()`

**Tests created/changed:**
- `server/src/__tests__/parser.test.ts`
  - `parses CASE labels with three-level dotted identifiers (A.B.C:)`
  - `parses CASE labels with four-level dotted identifiers (A.B.C.D:)`
  - `regression: still parses one-level and two-level labels (A: and A.B:)`
  - `guard: assignment-like ':=' inside clause is not treated as a CASE label`
  - `parses CASE clause label with explicit __SYSTEM.TYPE_CLASS.TYPE_BOOL:`
  - `regression: parses realistic mobject-style CASE labels and assignments`

**Review Status:** APPROVED

**Git Commit Message:**
fix: support deep dotted CASE labels

- detect IDENT(.IDENT)* case labels at arbitrary depth
- keep existing scalar and boolean case-label handling intact
- add explicit __SYSTEM TYPE_CLASS regression coverage
