## Phase 2 Complete: __SYSTEM Namespace + Inline Enum Scoping

Three targeted suppressions eliminate false positive diagnostics for `__SYSTEM` namespace references, inline enum member identifiers, and the synthetic `__INLINE_ENUM` type name.

**Beads Issue:** `bd-1ba` (closed)

**Files created/changed:**
- [server/src/handlers/diagnostics.ts](../server/src/handlers/diagnostics.ts)
- [server/src/__tests__/diagnostics.test.ts](../server/src/__tests__/diagnostics.test.ts)

**Functions created/changed:**
- `ALWAYS_ALLOWED` set: added `'__SYSTEM'`
- `runSemanticAnalysis()`: added inline enum value extraction into POU scope (after `collectPouVarNames`)
- Part A unknown-type check (POU varBlocks): `if (typeName === '__INLINE_ENUM') continue`
- Part A unknown-type check (method varBlocks): `if (typeName === '__INLINE_ENUM') continue`

**Tests created/changed:**
- `__SYSTEM_not_flagged`: CASE on `__SYSTEM.TYPE_CLASS.TYPE_BOOL` → 0 "Undefined identifier '__SYSTEM'" errors
- `__SYSTEM used as assignment RHS`: `myClass := __SYSTEM.nTypeClass` → 0 errors
- `inlineEnum_membersInScope`: `state : (IDLE, RUNNING, STOPPED)` + CASE → 0 "Undefined identifier" errors
- `inline enum values are usable in IF conditions`: `mode : (OFF, ON)` + IF → 0 errors
- `inline enum in FUNCTION_BLOCK`: inline enum in FB VAR block + CASE → 0 errors
- `__INLINE_ENUM_suppressed`: `state : (IDLE, RUNNING)` → no "Unknown type: '__INLINE_ENUM'" warning
- `inline enum in method var blocks`: inline enum in METHOD VAR → no "Unknown type" warning

**Review Status:** APPROVED

**Beads Status:** Issue `bd-1ba` closed, synced to JSONL.

**Agent Mail Status:** Phase ticket reply attempted (MCP server temporarily unreachable). File reservations to be released on next session.

**Git Commit Message:**
```
fix(diagnostics): suppress __SYSTEM, inline enum, and __INLINE_ENUM false positives (bd-1ba)

- Add '__SYSTEM' to ALWAYS_ALLOWED to suppress namespace identifier errors
- Extract inline enum member names into POU scope for CASE/IF body checks
- Skip '__INLINE_ENUM' synthetic type in unknown-type warnings (POU + method)
- Add 7 tests covering all three fixes
```
