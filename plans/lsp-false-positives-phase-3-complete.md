## Phase 3 Complete: GVL Container Name in Semantic Scope

Phase 3 is implemented and approved. Semantic diagnostics now include GVL container names in scope resolution so member-access bases like `DatatypeLimits.MAX_VALUE_*` are recognized in both local and cross-file scenarios.

**Files created/changed:**
- server/src/handlers/diagnostics.ts
- server/src/__tests__/diagnostics.test.ts

**Functions created/changed:**
- `runSemanticAnalysis()`

**Tests created/changed:**
- `server/src/__tests__/diagnostics.test.ts`
  - `cross-file GVL container name is in scope for member access base`
  - `local-file GVL container name is in scope for member access base`

**Review Status:** APPROVED

**Git Commit Message:**
fix: resolve GVL container names in diagnostics

- add GVL container names to semantic global scope
- cover local and cross-file GVL base member access cases
- prevent false undefined-identifier errors for GVL bases
