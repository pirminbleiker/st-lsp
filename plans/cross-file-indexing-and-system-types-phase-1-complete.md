## Phase 1 Complete: System Types & Intrinsics Catalog

Created a new `systemTypes.ts` catalog covering TwinCAT system types, compiler intrinsics, and auto-generated IEC type conversion functions. These will be wired into the diagnostics handler in Phase 3 to suppress false-positive "Unknown type" and "Undefined identifier" warnings.

**Files created:**
- server/src/twincat/systemTypes.ts
- server/src/__tests__/systemTypes.test.ts

**Functions created/changed:**
- `SYSTEM_TYPES` — readonly array of TwinCAT system type descriptors (T_MAXSTRING, PVOID, ANY, TIMESTRUCT, AXIS_REF, etc.)
- `SYSTEM_FUNCTIONS` — readonly array of TwinCAT compiler intrinsics and memory functions (__NEW, __DELETE, ADR, SIZEOF, etc.)
- `SYSTEM_TYPE_NAMES` — pre-built uppercase `ReadonlySet<string>` for O(1) lookup
- `SYSTEM_FUNCTION_NAMES` — pre-built uppercase `ReadonlySet<string>` for O(1) lookup
- `TYPE_CONVERSION_NAMES` — auto-generated set of all IEC `xxx_TO_yyy` conversion function names
- `generateTypeConversionNames()` — internal generator for all cross-product type conversions

**Tests created/changed:**
- 24 tests in `systemTypes.test.ts` covering all three exported sets and uppercase invariants

**Review Status:** APPROVED with minor recommendations (non-blocking: alias deduplication in type conversion generator, test assertion wording)

**Git Commit Message:**
```
feat(twincat): add system types and intrinsics catalog

- Add SYSTEM_TYPES array with TwinCAT types (T_MAXSTRING, PVOID, ANY, etc.)
- Add SYSTEM_FUNCTIONS array with compiler intrinsics (__NEW, ADR, SIZEOF, etc.)
- Auto-generate TYPE_CONVERSION_NAMES for all IEC xxx_TO_yyy functions
- Export pre-built uppercase lookup sets for O(1) diagnostic checks
```
