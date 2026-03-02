# Plan: Cross-File Indexing for Diagnostics & System Types Catalog

**Created:** 2026-03-02
**Status:** Ready for Atlas Execution

## Summary

The LSP's semantic diagnostics (`runSemanticAnalysis()` in `diagnostics.ts`) currently only knows about types/identifiers from the **same file**. Cross-file POU names, interfaces, FBs, methods, and type declarations from the workspace index are never consulted, producing massive false positives ("Unknown type", "Undefined identifier"). Additionally, TwinCAT system-level types (`T_MAXSTRING`, `PVOID`, `ANY`, etc.), compiler intrinsics (`__NEW`, `__DELETE`, `__QUERYINTERFACE`, `__ISVALIDREF`), and standard type-conversion functions (`DINT_TO_UDINT`, etc.) have no catalog, producing more false positives. This plan fixes both issues.

## Context & Analysis

**Relevant Files:**
- `server/src/handlers/diagnostics.ts`: Core semantic analysis — builds `knownTypes` and `scope` sets but only from same-file declarations. `validateDocument()` receives `workspaceIndex` but only uses it for `getLibraryRefs()`. Must be extended to pass workspace index to `runSemanticAnalysis()` and use cross-file names.
- `server/src/twincat/workspaceIndex.ts`: Stores parsed ASTs per source file URI. Provides `getProjectFiles()` and `getAst(uri)`. Already works for definition handler — needs to be leveraged by diagnostics.
- `server/src/twincat/types.ts`: Built-in IEC types (BOOL, INT, etc.) — needs extended with TwinCAT system types.
- `server/src/twincat/libraryRegistry.ts`: Library FB/function catalog. Functions (MAX, MIN, LEN, etc.) are defined but never added to the diagnostics scope.
- `server/src/twincat/stdlib.ts`: Re-exports `STANDARD_FBS` from libraryRegistry. Referenced by diagnostics.
- `server/src/server.ts`: Wires `validateDocument()` with `workspaceIndex` — no changes needed.
- `server/src/parser/ast.ts`: AST types — `FunctionBlockDeclaration` has `methods`, `properties`, `actions`; `InterfaceDeclaration` has `methods`, `properties`.

**Key Functions/Classes:**
- `runSemanticAnalysis(ast, libraryRefs?)` in diagnostics.ts: Main function to modify — needs `workspaceIndex` param
- `validateDocument(connection, document, workspaceIndex?)` in diagnostics.ts: Needs to pass `workspaceIndex` to `runSemanticAnalysis()`
- `collectPouVarNames()` in diagnostics.ts: Collects var names from a POU
- `isAllowedName()` in diagnostics.ts: Checks static always-allowed names — will be extended
- `WorkspaceIndex.getProjectFiles()` / `getAst()`: Cross-file AST access
- `getLibraryFunctions()` in libraryRegistry.ts: Returns library functions (MAX, MIN, LEN, etc.) — currently unused by diagnostics

**Dependencies:**
- `vscode-languageserver`: LSP protocol types
- `WorkspaceIndex`: Already initialized and passed to `validateDocument()`
- `libraryRegistry.ts`: Already imported in diagnostics.ts for `getLibraryFBs()`

**Patterns & Conventions:**
- Case-insensitive: All comparisons use `.toUpperCase()`
- Sets for lookups: `knownTypes`, `scope`, `ALWAYS_ALLOWED` are `Set<string>`
- Diagnostics are Warnings (severity 2) for semantic issues, Errors (severity 1) for syntax
- Handlers receive `WorkspaceIndex` as optional parameter
- The definition handler already has `loadWorkspaceDeclarations()` pattern for cross-file walking

## Root Cause Analysis

The Problems.json errors fall into categories:

1. **Cross-file types** (workspace-resolvable): `I_DICTIONARYTREENODE`, `LINKEDLIST`, `DICTIONARYFORWARDENUMERATOR`, `DICTIONARYTREENODE`, `EVENTEMITTER`, `I_EVENTHANDLER`, `I_COLLECTION`, `KEYVALUECOLLECTIONCHANGEDEVENT`, `KEYVALUECOLLECTIONDISPOSEDEVENT` → These exist in other `.TcPOU`/`.TcDUT` files in the same project. Fix: add cross-file names to `knownTypes` and `scope`.

2. **Cross-file identifiers** (methods/actions/properties): `EmitChangedEvent`, `RightRotate`, `LeftRotate`, `EmitDisposedEvent`, `Clear`, `ContainsKey`, `TryGetValueTo`, `FindMinimum`, `balance` → These are methods/actions of the FB itself or inherited methods. Fix: add FB's own methods, properties, and actions to scope. Also add inherited methods once EXTENDS is resolved cross-file.

3. **TwinCAT system types**: `T_MAXSTRING`, `PVOID`, `ANY` → Not in any library or builtin list. Fix: add a system types catalog.

4. **Compiler intrinsics**: `__NEW`, `__DELETE`, `__QUERYINTERFACE`, `__ISVALIDREF` → Compiler-level functions not in any library. Fix: add to a system identifiers catalog.

5. **Type conversion functions**: `DINT_TO_UDINT` → IEC standard conversion functions. Fix: auto-generate or catalog all `xxx_TO_yyy` conversion function names.

6. **Standard library functions not in scope**: `MAX` → Defined in `getLibraryFunctions()` but never added to the identifier scope. Fix: add library function names to scope.

## Implementation Phases

### Phase 1: Create TwinCAT System Types & Intrinsics Catalog

**Objective:** Add a new file `server/src/twincat/systemTypes.ts` with TwinCAT-specific system types, compiler intrinsics, and auto-generated type conversion function names that are always available in any TwinCAT project.

**Files to Create:**
- `server/src/twincat/systemTypes.ts`: System type catalog with types, intrinsics, conversion functions, and sub-element definitions

**Design:**
```typescript
// System types always available in TwinCAT
export interface SystemType {
  name: string;
  description: string;
}

export interface SystemFunction {
  name: string;
  description: string;
}

// Allow users to define system elements with optional members
export interface SystemElement {
  name: string;
  kind: 'type' | 'functionBlock' | 'interface' | 'function';
  description: string;
  members?: SystemMember[];
}

export interface SystemMember {
  name: string;
  kind: 'method' | 'property' | 'action';
  description: string;
}

export const SYSTEM_TYPES: readonly SystemType[] = [
  { name: 'T_MAXSTRING', description: 'TwinCAT alias for STRING(255) — maximum-length string.' },
  { name: 'PVOID', description: 'Pointer to VOID — generic untyped pointer (TwinCAT system type).' },
  { name: 'ANY', description: 'IEC 61131-3 generic type placeholder — matches any data type.' },
  { name: 'ANY_NUM', description: 'IEC generic numeric type — matches any numeric type.' },
  { name: 'ANY_INT', description: 'IEC generic integer type — matches any integer type.' },
  { name: 'ANY_REAL', description: 'IEC generic real type — matches REAL or LREAL.' },
  { name: 'ANY_BIT', description: 'IEC generic bit type — matches BOOL, BYTE, WORD, DWORD, LWORD.' },
  { name: 'ANY_STRING', description: 'IEC generic string type — matches STRING or WSTRING.' },
  { name: 'ANY_DATE', description: 'IEC generic date type — matches DATE, DT, TOD.' },
  { name: 'T_AmsNetId', description: 'TwinCAT AMS Net ID — STRING(23) type alias.' },
  { name: 'T_AmsPort', description: 'TwinCAT AMS port number (UINT).' },
  { name: 'TIMESTRUCT', description: 'TwinCAT time structure (year, month, day, hour, minute, second, ms).' },
  { name: 'AMSADDR', description: 'TwinCAT AMS address structure (NetId + Port).' },
  { name: 'AXIS_REF', description: 'TwinCAT NC reference to a motion axis.' },
  { name: 'POINTER', description: 'IEC pointer base keyword.' },
  { name: 'REFERENCE', description: 'IEC reference base keyword.' },
  { name: 'T_DCTIME64', description: 'TwinCAT distributed clock 64-bit timestamp.' },
  { name: 'T_FILETIME', description: 'Windows FILETIME — 64-bit value (100ns intervals since 1601).' },
  { name: 'XINT', description: 'TwinCAT extended integer type.' },
  { name: 'XWORD', description: 'TwinCAT extended word type.' },
  { name: 'LDATE', description: 'TwinCAT 64-bit DATE type.' },
  { name: 'LDATE_AND_TIME', description: 'TwinCAT 64-bit DATE_AND_TIME.' },
  { name: 'LDT', description: 'Alias for LDATE_AND_TIME.' },
  { name: 'LTOD', description: 'TwinCAT 64-bit TIME_OF_DAY.' },
  { name: 'LTIME_OF_DAY', description: 'TwinCAT 64-bit TIME_OF_DAY.' },
  { name: 'NCTOPLC_AXIS_REF', description: 'NC-to-PLC axis data structure.' },
  { name: 'PLCTONC_AXIS_REF', description: 'PLC-to-NC axis data structure.' },
  // ... more as needed
];

export const SYSTEM_FUNCTIONS: readonly SystemFunction[] = [
  { name: '__NEW', description: 'TwinCAT compiler intrinsic — dynamically allocates a new instance of a function block or structure.' },
  { name: '__DELETE', description: 'TwinCAT compiler intrinsic — frees a dynamically allocated instance.' },
  { name: '__QUERYINTERFACE', description: 'TwinCAT compiler intrinsic — queries whether an interface pointer supports a given interface.' },
  { name: '__ISVALIDREF', description: 'TwinCAT compiler intrinsic — checks if a REFERENCE is valid (not NULL).' },
  { name: '__VARINFO', description: 'TwinCAT compiler intrinsic — returns variable info (address and size).' },
  { name: 'ADR', description: 'Returns the address (PVOID) of the given variable.' },
  { name: 'SIZEOF', description: 'Returns the size in bytes of the given variable or type.' },
  { name: 'MEMCPY', description: 'Copies n bytes from source to destination.' },
  { name: 'MEMSET', description: 'Fills n bytes of memory with a constant byte value.' },
  { name: 'MEMMOVE', description: 'Moves n bytes from source to destination (handles overlap).' },
  { name: 'MEMCMP', description: 'Compares n bytes of two memory areas.' },
  // ... more as needed
];

// Pre-built uppercase sets for fast lookup
export const SYSTEM_TYPE_NAMES: ReadonlySet<string>;
export const SYSTEM_FUNCTION_NAMES: ReadonlySet<string>;

// Auto-generated type conversion functions (xxx_TO_yyy)
export const TYPE_CONVERSION_NAMES: ReadonlySet<string>;
```

The type conversion function generator should auto-generate all valid `xxx_TO_yyy` combinations from the IEC base types (BOOL, BYTE, SINT, INT, DINT, LINT, USINT, UINT, UDINT, ULINT, REAL, LREAL, WORD, DWORD, LWORD, STRING, WSTRING, TIME, LTIME, TOD, DATE, DT).

**Tests to Write:**
- `server/src/__tests__/systemTypes.test.ts`:
  - `SYSTEM_TYPE_NAMES` contains expected entries (T_MAXSTRING, PVOID, ANY)
  - `SYSTEM_FUNCTION_NAMES` contains expected entries (__NEW, __DELETE, ADR, SIZEOF)
  - `TYPE_CONVERSION_NAMES` contains expected entries (DINT_TO_UDINT, BOOL_TO_INT, etc.)
  - Names are uppercase

**Steps:**
1. Write test file `server/src/__tests__/systemTypes.test.ts`
2. Run tests (should fail — module doesn't exist)
3. Create `server/src/twincat/systemTypes.ts` with system types, intrinsics, and type conversion generator
4. Run tests (should pass)
5. Verify no lint errors

**Acceptance Criteria:**
- [ ] `SYSTEM_TYPE_NAMES` has at least: T_MAXSTRING, PVOID, ANY, ANY_NUM, ANY_INT, ANY_REAL, ANY_BIT, TIMESTRUCT, AXIS_REF
- [ ] `SYSTEM_FUNCTION_NAMES` has at least: __NEW, __DELETE, __QUERYINTERFACE, __ISVALIDREF, ADR, SIZEOF
- [ ] `TYPE_CONVERSION_NAMES` has at least: DINT_TO_UDINT, INT_TO_DINT, BOOL_TO_INT, REAL_TO_LREAL
- [ ] All names stored as uppercase
- [ ] Tests pass

---

### Phase 2: Integrate Cross-File Names into Diagnostics

**Objective:** Pass the `WorkspaceIndex` to `runSemanticAnalysis()` and use it to populate `knownTypes` and `scope` with POU/type/interface names from all project files.

**Files to Modify:**
- `server/src/handlers/diagnostics.ts`:
  1. Change `runSemanticAnalysis(ast, libraryRefs?)` signature to `runSemanticAnalysis(ast, libraryRefs?, workspaceIndex?, currentUri?)`
  2. In `runSemanticAnalysis()`, after building `globalNames` from same-file declarations, iterate `workspaceIndex.getProjectFiles()` / `getAst()` to add cross-file POU names, interface names, type names, and GVL variable names to `globalNames`
  3. In `validateDocument()`, pass `workspaceIndex` and `document.uri` to `runSemanticAnalysis()`

**Detailed change in `runSemanticAnalysis()`:**

After the existing `globalNames` building loop (around line 420-440), add:
```typescript
// Add cross-file names from workspace index
if (workspaceIndex) {
  for (const fileUri of workspaceIndex.getProjectFiles()) {
    if (fileUri === currentUri) continue;
    const cached = workspaceIndex.getAst(fileUri);
    if (!cached) continue;
    for (const decl of cached.ast.declarations) {
      if (
        decl.kind === 'ProgramDeclaration' ||
        decl.kind === 'FunctionBlockDeclaration' ||
        decl.kind === 'FunctionDeclaration' ||
        decl.kind === 'InterfaceDeclaration'
      ) {
        globalNames.add((decl as { name: string }).name.toUpperCase());
      } else if (decl.kind === 'TypeDeclarationBlock') {
        for (const td of (decl as TypeDeclarationBlock).declarations) {
          globalNames.add(td.name.toUpperCase());
        }
      } else if (decl.kind === 'GvlDeclaration') {
        for (const vb of (decl as GvlDeclaration).varBlocks) {
          for (const vd of vb.declarations) {
            globalNames.add(vd.name.toUpperCase());
          }
        }
      }
    }
  }
}
```

**Tests to Write:**
- In existing `server/src/__tests__/diagnostics.test.ts`, add test group:
  - "cross-file type resolution": Create a mock `WorkspaceIndex` with a cached AST containing an FB named `MyOtherFB`. Validate a document that uses `MyOtherFB` as a type → should produce no "Unknown type" warning.
  - "cross-file identifier resolution": Same mock, verify no "Undefined identifier" for cross-file POU names used as identifiers.

**Steps:**
1. Write tests for cross-file type/identifier resolution in diagnostics.test.ts
2. Run tests (should fail — `runSemanticAnalysis` doesn't accept workspaceIndex)
3. Modify `runSemanticAnalysis()` signature to accept `workspaceIndex` and `currentUri`
4. Add cross-file name collection loop
5. Modify `validateDocument()` to pass workspace index and URI
6. Run tests (should pass)
7. Verify no lint errors

**Acceptance Criteria:**
- [ ] `runSemanticAnalysis()` accepts optional `WorkspaceIndex` and `currentUri`
- [ ] Cross-file POU names (PROGRAM, FB, FUNCTION, INTERFACE) are added to `globalNames`
- [ ] Cross-file TYPE declarations are added to `globalNames`
- [ ] Cross-file GVL variable names are added to `globalNames`
- [ ] Current file is excluded from cross-file iteration (no double-counting)
- [ ] Tests pass
- [ ] Existing tests still pass

---

### Phase 3: Add Library Functions & System Types/Intrinsics to Diagnostics Scope

**Objective:** Wire the system types catalog (Phase 1) and library functions (from `libraryRegistry.ts`) into the diagnostics `knownTypes` and `scope` sets.

**Files to Modify:**
- `server/src/handlers/diagnostics.ts`:
  1. Import `SYSTEM_TYPE_NAMES`, `SYSTEM_FUNCTION_NAMES`, `TYPE_CONVERSION_NAMES` from `../twincat/systemTypes`
  2. Import `getLibraryFunctions` from `../twincat/libraryRegistry` (already imported for `getLibraryFBs`)
  3. Add system type names to `knownTypes` set
  4. Add system function names, library function names, and type conversion function names to `isAllowedName()` check (or add them to the scope sets)
  5. Also add library function names to `knownTypes` (some are used as type-like references)

**Specific changes:**

1. Update the static sets at module level:
```typescript
import { SYSTEM_TYPE_NAMES, SYSTEM_FUNCTION_NAMES, TYPE_CONVERSION_NAMES } from '../twincat/systemTypes';
import { getLibraryFBs, getLibraryFunctions } from '../twincat/libraryRegistry';

const LIBRARY_FUNCTION_NAMES = new Set(getLibraryFunctions().map(f => f.name.toUpperCase()));
```

2. Update `isAllowedName()`:
```typescript
function isAllowedName(name: string): boolean {
  const upper = name.toUpperCase();
  return ALWAYS_ALLOWED.has(upper)
    || BUILTIN_TYPE_NAMES.has(upper)
    || STANDARD_FB_NAMES.has(upper)
    || SYSTEM_TYPE_NAMES.has(upper)
    || SYSTEM_FUNCTION_NAMES.has(upper)
    || TYPE_CONVERSION_NAMES.has(upper)
    || LIBRARY_FUNCTION_NAMES.has(upper);
}
```

3. Update `knownTypes` construction in `runSemanticAnalysis()`:
```typescript
const knownTypes = new Set<string>([
  ...BUILTIN_TYPE_NAMES,
  ...STANDARD_FB_NAMES,
  ...SYSTEM_TYPE_NAMES,
  ...globalNames,
]);
```

**Tests to Write:**
- Testing system types don't trigger "Unknown type": `VAR x : T_MAXSTRING; END_VAR` → no warning
- Testing system types don't trigger "Unknown type": `VAR p : PVOID; END_VAR` → no warning
- Testing ANY doesn't trigger "Unknown type": `VAR v : ANY; END_VAR` → no warning
- Testing __NEW doesn't trigger "Undefined identifier": `inst := __NEW(SomeFB);` → no "Undefined identifier '__NEW'" warning
- Testing type conversions: `x := DINT_TO_UDINT(y);` → no "Undefined identifier 'DINT_TO_UDINT'" warning
- Testing library functions: `x := MAX(a, b);` → no "Undefined identifier 'MAX'" warning

**Steps:**
1. Write tests
2. Run tests (should fail)
3. Add imports and update `isAllowedName()`, `knownTypes` construction
4. Run tests (should pass)
5. Verify no lint errors

**Acceptance Criteria:**
- [ ] System types (T_MAXSTRING, PVOID, ANY, etc.) no longer trigger "Unknown type"
- [ ] Compiler intrinsics (__NEW, __DELETE, etc.) no longer trigger "Undefined identifier"
- [ ] Type conversion functions (DINT_TO_UDINT, etc.) no longer trigger "Undefined identifier"
- [ ] Library functions (MAX, MIN, LEN, CONCAT, etc.) no longer trigger "Undefined identifier"
- [ ] All existing tests still pass

---

### Phase 4: Add FB Methods, Properties, and Actions to Scope

**Objective:** When checking a function block's body for undefined identifiers, add its own methods, properties, and actions to the scope. Also add methods/properties/actions inherited from EXTENDS chain (resolved cross-file).

**Files to Modify:**
- `server/src/handlers/diagnostics.ts`:
  1. For `FunctionBlockDeclaration`, add `fb.methods[].name`, `fb.properties[].name`, and `fb.actions[].name` to the POU scope
  2. If the FB has an `extends` field, resolve the parent FB (from same file or workspace index) and add its methods/properties/actions recursively

**Specific changes in the scope-building section (around line ~535):**

After building `scope` for the POU:
```typescript
// For FBs: add own methods, properties, and actions to scope
if (decl.kind === 'FunctionBlockDeclaration') {
  const fb = decl as FunctionBlockDeclaration;
  for (const m of fb.methods) scope.add(m.name.toUpperCase());
  for (const p of fb.properties) scope.add(p.name.toUpperCase());
  for (const a of fb.actions) scope.add(a.name.toUpperCase());
  
  // Walk EXTENDS chain to add inherited members
  addInheritedMembers(fb, ast, workspaceIndex, scope);
}
```

Add helper function:
```typescript
function addInheritedMembers(
  fb: FunctionBlockDeclaration,
  localAst: SourceFile,
  workspaceIndex: WorkspaceIndex | undefined,
  scope: Set<string>,
  depth = 0,
): void {
  if (!fb.extends || depth > 10) return;
  const parentName = fb.extends.toUpperCase();
  
  // Search local file first
  let parentFb: FunctionBlockDeclaration | undefined;
  for (const d of localAst.declarations) {
    if (d.kind === 'FunctionBlockDeclaration' && (d as FunctionBlockDeclaration).name.toUpperCase() === parentName) {
      parentFb = d as FunctionBlockDeclaration;
      break;
    }
  }
  
  // Then search workspace
  if (!parentFb && workspaceIndex) {
    for (const fileUri of workspaceIndex.getProjectFiles()) {
      const cached = workspaceIndex.getAst(fileUri);
      if (!cached) continue;
      for (const d of cached.ast.declarations) {
        if (d.kind === 'FunctionBlockDeclaration' && (d as FunctionBlockDeclaration).name.toUpperCase() === parentName) {
          parentFb = d as FunctionBlockDeclaration;
          break;
        }
      }
      if (parentFb) break;
    }
  }
  
  if (!parentFb) return;
  for (const m of parentFb.methods) scope.add(m.name.toUpperCase());
  for (const p of parentFb.properties) scope.add(p.name.toUpperCase());
  for (const a of parentFb.actions) scope.add(a.name.toUpperCase());
  // Add parent's own vars too (inherited)
  for (const vb of parentFb.varBlocks) {
    for (const vd of vb.declarations) {
      scope.add(vd.name.toUpperCase());
    }
  }
  // Recurse up the chain
  addInheritedMembers(parentFb, localAst, workspaceIndex, scope, depth + 1);
}
```

Also: For **InterfaceDeclaration**, if a FB `IMPLEMENTS` an interface, the interface's method/property names should be considered valid in the FB scope (since they must be implemented). This is lower priority but conceptually similar.

**Tests to Write:**
- FB with methods: calling own method `EmitChangedEvent()` doesn't trigger "Undefined identifier"
- FB with properties: accessing own property doesn't trigger "Undefined identifier"
- FB with actions: referencing own action doesn't trigger "Undefined identifier"
- FB with EXTENDS: calling parent method doesn't trigger "Undefined identifier"

**Steps:**
1. Write tests
2. Run tests (should fail)
3. Add methods/properties/actions to FB scope in `runSemanticAnalysis()`
4. Add `addInheritedMembers()` helper
5. Run tests (should pass)
6. Verify no lint errors

**Acceptance Criteria:**
- [ ] FB's own method names are in scope for its body
- [ ] FB's own property names are in scope for its body
- [ ] FB's own action names are in scope for its body
- [ ] Inherited members (from EXTENDS chain) are in scope, resolved cross-file
- [ ] EXTENDS chain resolution has a depth limit to prevent infinite loops
- [ ] All existing tests still pass

---

### Phase 5: Add FB Methods/Properties/Actions to Method Scope

**Objective:** When checking method bodies within a FB, the method scope should also include the FB's own methods, properties, actions, and inherited members — not just vars.

**Files to Modify:**
- `server/src/handlers/diagnostics.ts`: In the "method bodies" section (around line ~600), the `methodScope` is built from `scope` (which after Phase 4 already includes FB members). Verify this works transitively. If `scope` was extended in Phase 4, `methodScope` inherits it via `new Set<string>(scope)`. 

**This phase may require no code changes** if Phase 4 correctly extends `scope` before the method loop. Verify with tests.

**Tests to Write:**
- Method body references another method of the same FB → no "Undefined identifier"
- Method body references a property of the same FB → no "Undefined identifier"
- Method body references a parent FB method (EXTENDS) → no "Undefined identifier"

**Steps:**
1. Write tests
2. Run tests — should already pass if Phase 4 scope extension works correctly
3. If tests fail, extend `methodScope` construction to include FB members
4. Verify all tests pass

**Acceptance Criteria:**
- [ ] Method bodies can reference sibling methods without "Undefined identifier"
- [ ] Method bodies can reference FB properties without "Undefined identifier"
- [ ] All existing tests still pass

---

### Phase 6: Integration Testing with mobject-core Fixtures

**Objective:** Verify that the real-world mobject-core Dictionary.TcPOU file produces significantly fewer false positive diagnostics when the workspace index is properly connected.

**Files to Modify:**
- `server/src/__tests__/mobjectIntegration.test.ts`: Add test case that:
  1. Creates a `WorkspaceIndex` pointed at the `mobject-core-src` fixtures
  2. Validates `Dictionary.TcPOU` with the workspace index
  3. Asserts that cross-file types like `I_DICTIONARYTREENODE`, `LINKEDLIST`, `DICTIONARYFORWARDENUMERATOR` no longer produce "Unknown type" warnings
  4. Asserts that `T_MAXSTRING`, `PVOID`, `ANY` no longer produce "Unknown type" warnings
  5. Asserts that `__NEW`, `MAX` no longer produce "Undefined identifier" warnings
  6. Asserts that method calls like `EmitChangedEvent`, `RightRotate`, `Clear` no longer produce "Undefined identifier" warnings

**Tests to Write:**
- Integration test: Dictionary.TcPOU with full workspace index → count of "Unknown type" warnings is drastically reduced
- Integration test: system types are recognized
- Integration test: compiler intrinsics are recognized

**Steps:**
1. Write integration test
2. Run test (should pass if Phases 1-5 are complete)
3. If any false positives remain, investigate and fix
4. Document remaining expected warnings (truly unknown external types)

**Acceptance Criteria:**
- [ ] `I_DICTIONARYTREENODE` is resolved from workspace (not flagged as unknown)
- [ ] `T_MAXSTRING`, `PVOID`, `ANY` are not flagged as unknown
- [ ] `__NEW`, `MAX`, `DINT_TO_UDINT` are not flagged as undefined
- [ ] `EmitChangedEvent`, `RightRotate` etc. are not flagged as undefined (FB methods)
- [ ] Test with real mobject-core fixtures passes

## Open Questions

1. **Should the cross-file name collection be cached?**
   - **Option A:** Rebuild the cross-file name set on each `runSemanticAnalysis()` call. Simple, correct, no stale data risk.
   - **Option B:** Cache cross-file names in the `WorkspaceIndex` as a separate set, invalidated when any project file changes.
   - **Recommendation:** Option A for now. Per the CLAUDE.md guidance: "Do not add an AST cache without benchmarking evidence that it is needed." The workspace index already caches ASTs; iterating them to collect names is cheap ($O(n)$ over declarations, not parsing).

2. **How to handle types from external libraries not in the project?**
   - **Option A:** Only suppress warnings for types from libraries explicitly referenced in the `.plcproj` file.
   - **Option B:** Suppress warnings for all known library types regardless of project references.
   - **Recommendation:** Option B for the `knownTypes` check (don't warn about unknown types that are in the library registry). Keep the separate "missing library reference" check as-is (warns when a type *is* known but the library isn't referenced). This matches the current pattern — library FB names already added to `knownTypes` unconditionally.

3. **Depth limit for EXTENDS chain resolution?**
   - **Recommendation:** 10 levels deep. Real TwinCAT inheritance chains rarely exceed 5. A depth limit of 10 prevents infinite loops from circular EXTENDS (which would be invalid ST but could exist in partially-edited code).

## Risks & Mitigation

- **Risk:** Cross-file iteration slows down diagnostics for large projects (hundreds of files).
  - **Mitigation:** The iteration only collects declaration *names* (not full ASTs) — it's $O(n \times d)$ where $n$ is number of files and $d$ is average declarations per file. Most TwinCAT projects have <200 source files. If benchmarking shows issues, add a cached `allNames` set on `WorkspaceIndex`.

- **Risk:** System type catalog becomes out of date with newer TwinCAT versions.
  - **Mitigation:** The catalog covers common types; for project-specific or version-specific types, the user can rely on them being properly declared in project files (which cross-file resolution would pick up). Document the catalog as extensible.

- **Risk:** EXTENDS chain resolution finds wrong FB if multiple FBs share a name across files.
  - **Mitigation:** TwinCAT doesn't allow duplicate POU names within a project. The first match is correct. If duplicates exist, the "Duplicate POU name" diagnostic already warns about it.

## Success Criteria

- [ ] All 6 phases complete with passing tests
- [ ] The Dictionary.TcPOU file from Problems.json has dramatically fewer false positive warnings
- [ ] System types (T_MAXSTRING, PVOID, ANY, etc.) are recognized
- [ ] Compiler intrinsics (__NEW, __DELETE, etc.) are recognized
- [ ] Type conversion functions (DINT_TO_UDINT, etc.) are recognized
- [ ] Cross-file POU/type names are resolved
- [ ] FB's own methods/properties/actions are in scope
- [ ] Inherited members are resolved via EXTENDS chain
- [ ] Library functions (MAX, MIN, LEN, etc.) are in scope
- [ ] No performance regression on normal-sized projects
- [ ] All existing tests continue to pass

## Notes for Atlas

- **Phase execution order matters:** Phases 1-3 can be done first (system types + cross-file + wiring). Phase 4 depends on Phase 2 (needs `workspaceIndex` in `runSemanticAnalysis()`). Phase 5 verifies Phase 4. Phase 6 is the integration verification.
- **The `diagnostics.ts` file is ~775 lines.** Read it fully before making changes. The key sections are: `runSemanticAnalysis()` starting around line 410, the `knownTypes` set construction around line 470, and the `scope` building around line 535.
- **Minimize surface area of changes:** Keep `runSemanticAnalysis()` as a single function. Add workspace-index iteration as a clearly commented block. Don't refactor the existing structure.
- **Testing pattern:** Existing tests in `diagnostics.test.ts` use `makeMockConnection()` and `getDiagnostics()`. For cross-file tests, you'll need a mock `WorkspaceIndex` or a real one pointed at test fixtures.
- **The `getLibraryFBs`/`getLibraryFunctions` imports:** `getLibraryFBs` is already imported. Just add `getLibraryFunctions` to the same import.
- **`isAllowedName()` is the cheapest place** to add system intrinsics and type conversion functions — it's checked before scope lookup. But system *types* need to go into `knownTypes` for the "Unknown type" check (which is a different code path from "Undefined identifier").
