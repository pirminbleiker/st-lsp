# Plan: Interface (TcIO) Indexing & Completion Fix

**Created:** 2025-03-02  
**Status:** Ready for Atlas Execution

## Summary

Interfaces defined in TcIO files are missing method/property extraction, causing empty completion suggestions when typing `myIntf.` for interface-typed variables. The root cause is that `tcExtractor.ts` only extracts methods/properties for `<POU>` containers, silently discarding them for `<Itf>` containers. Additionally, the go-to-definition handler ignores `InterfaceDeclaration` for member access, the references handler doesn't traverse interface members, and interfaces aren't offered as type names in flat completion.

## Context & Analysis

**Relevant Files:**
- `server/src/twincat/tcExtractor.ts`: Root cause — `isPOU` gate at L195 blocks method/property extraction for `<Itf>` containers
- `server/src/handlers/definition.ts`: MemberExpression handler at L401-432 only checks `FunctionBlockDeclaration`, not `InterfaceDeclaration`
- `server/src/handlers/references.ts`: InterfaceDeclaration is a no-op leaf at L261
- `server/src/handlers/completion.ts`: Flat completion (sections 5 & 7 at L960-977, L1028-1070) omits `InterfaceDeclaration`
- `server/src/__tests__/tcExtractor.test.ts`: Tests at L367-390 and L684-720 explicitly assert methods are NOT extracted from TcIO — must be updated
- `server/src/__tests__/completion.test.ts`: Zero interface completion tests
- `server/src/__tests__/crossFileCompletion.test.ts`: Zero interface cross-file tests
- `server/src/__tests__/definition.test.ts`: No interface member go-to-def tests
- `tests/fixtures/mobject-core/I_Disposable.TcIO`: Simple interface fixture (1 method)
- `tests/fixtures/mobject-core/I_LinkedList.TcIO`: Complex interface fixture (8 methods, 2 properties)

**Key Functions/Classes:**
- `extractTopLevelCDATAs()` in `tcExtractor.ts` L167-199: Orchestrates container extraction; the `isPOU` check at L195 gates methods/properties
- `extractMethodCDATAs()` in `tcExtractor.ts` L424-465: Extracts `<Method>` children — works generically, no POU-specific logic
- `extractPropertyCDATAs()` in `tcExtractor.ts` L335-420: Extracts `<Property>` children — works generically
- `buildResult()` in `tcExtractor.ts` L470-631: Assembles extraction into final source; already handles `END_INTERFACE` via regex at L572-579
- `getDotAccessMembers()` in `completion.ts` L656-772: Entry point for dot-member completion
- `findMemberType()` in `completion.ts` L427-498: Resolves nested chain types — already handles InterfaceDeclaration ✅
- `getMembersFromDeclarations()` in `completion.ts` L510-596: Returns CompletionItems for type members — already handles InterfaceDeclaration ✅
- `handleDefinition()` in `definition.ts`: MemberExpression branch at L401-432 only searches FBs

**Patterns & Conventions:**
- All identifier comparisons use `.toUpperCase()` for case insensitivity
- AST nodes use discriminated unions via `kind` string literal
- Handlers are pure functions: `(params, documents, index) → result`
- Tests use Vitest (`describe`/`it`/`expect`) with inline ST source strings
- TcIO `<Method>`/`<Property>` XML structure is identical to TcPOU — same extraction functions work

## Implementation Phases

### Phase 1: Fix TcIO Method/Property Extraction (Root Cause)

**Objective:** Make `tcExtractor.ts` extract methods and properties from `<Itf>` containers, so parsed InterfaceDeclaration ASTs contain their members.

**Files to Modify:**
- `server/src/twincat/tcExtractor.ts`: Change the `isPOU` gate at L195 to also include `ITF` containers

**Steps:**

1. In `extractTopLevelCDATAs()` at line 195, change:
   ```typescript
   // Before:
   const isPOU = containerTagName.toUpperCase() === 'POU';
   const methods = isPOU ? extractMethodCDATAs(xml, body, containerStart) : [];
   const properties = isPOU ? extractPropertyCDATAs(xml, body, containerStart) : [];
   const actions = isPOU ? extractActionCDATAs(xml, body, containerStart) : [];
   ```
   To:
   ```typescript
   // After:
   const isPOU = containerTagName.toUpperCase() === 'POU';
   const isItf = containerTagName.toUpperCase() === 'ITF';
   const hasMembers = isPOU || isItf;
   const methods = hasMembers ? extractMethodCDATAs(xml, body, containerStart) : [];
   const properties = hasMembers ? extractPropertyCDATAs(xml, body, containerStart) : [];
   const actions = isPOU ? extractActionCDATAs(xml, body, containerStart) : [];
   ```
   Note: Actions remain POU-only — interfaces don't have actions in IEC 61131-3.

2. Verify `buildResult()` handles interface methods/properties correctly:
   - It already emits `END_INTERFACE` closer via regex at L572-579 ✅
   - It already emits method declarations + `END_METHOD` for each method ✅
   - It already emits property declarations + `END_PROPERTY` for each property ✅
   - It already skips empty implementation CDATAs (TcIO methods have no implementation) ✅
   - **No changes needed in `buildResult()`**

**Tests to Update:**
- `server/src/__tests__/tcExtractor.test.ts` — Three test blocks must be updated

**Acceptance Criteria:**
- [ ] `extractST()` on I_Disposable.TcIO produces:
  ```
  INTERFACE I_Disposable EXTENDS __System.IQueryInterface
  METHOD PUBLIC Dispose
  END_METHOD
  END_INTERFACE
  ```
- [ ] `extractST()` on I_LinkedList.TcIO produces ST containing all 8 methods and 2 properties with `END_METHOD`/`END_PROPERTY` closers and final `END_INTERFACE`
- [ ] Parsing the extracted ST produces an `InterfaceDeclaration` AST with populated `methods[]` and `properties[]` arrays
- [ ] All existing tcExtractor tests pass (after updating assertions)

---

### Phase 2: Update TcIO Extraction Tests

**Objective:** Update existing tests that explicitly assert methods are NOT extracted, and add new assertions for the correct behavior.

**Files to Modify:**
- `server/src/__tests__/tcExtractor.test.ts`

**Steps:**

1. **Inline TcIO test** (around L367-390): The test creates a TcIO XML with `<Itf>` containing a method. Currently asserts `sections.length === 1` and method content is NOT present. Change to:
   - Expect `sections.length > 1` (top decl + method decl sections)
   - Assert the synthesized source (`r.source`) contains `METHOD PUBLIC DoSomething`, `END_METHOD`, and `END_INTERFACE`
   - Assert lineMap is consistent

2. **I_Disposable fixture test** (around L684-700): Currently asserts `METHOD PUBLIC Dispose` is NOT present. Change to:
   - Assert the extracted source DOES contain `METHOD PUBLIC Dispose` and `END_METHOD`
   - Assert `END_INTERFACE` is present
   - Verify lineMap consistency

3. **I_LinkedList fixture test** (around L702-720): Add assertions that:
   - Source contains method names (`AddAfter`, `AddBefore`, `AddFirst`, `AddLast`, `GetEnumerator`, `RemoveFirst`, `RemoveLast`, `TrimExcess` — or whatever methods exist)
   - Source contains property names (`First`, `Last`)
   - Source contains `END_METHOD`, `END_PROPERTY`, and `END_INTERFACE`

4. **Add a round-trip test**: Extract TcIO → parse → verify AST:
   ```typescript
   it('should round-trip TcIO through parser with methods and properties', () => {
     const xml = readFixture('I_LinkedList.TcIO');
     const result = extractST(xml, 'I_LinkedList.TcIO');
     const { ast } = parse(result.source);
     const iface = ast.declarations.find(d => d.kind === 'InterfaceDeclaration');
     expect(iface).toBeDefined();
     expect(iface.methods.length).toBeGreaterThan(0);
     expect(iface.properties.length).toBeGreaterThan(0);
   });
   ```

**Acceptance Criteria:**
- [ ] All tcExtractor tests pass with new assertions
- [ ] Round-trip parse test confirms AST has methods and properties
- [ ] `npm run typecheck` passes

---

### Phase 3: Fix Go-to-Definition for Interface Members

**Objective:** When clicking on `myIntf.MethodName` where `myIntf` is interface-typed, navigate to the method/property declaration in the interface.

**Files to Modify:**
- `server/src/handlers/definition.ts`: Add `InterfaceDeclaration` handling in MemberExpression handler (around L401-432)

**Steps:**

1. In the MemberExpression handler (around L401-432), after the existing `FunctionBlockDeclaration` loop, add an `InterfaceDeclaration` branch:
   ```typescript
   // After the FB loop, add:
   if (decl.kind === 'InterfaceDeclaration') {
     const iface = decl as InterfaceDeclaration;
     if (iface.name.toUpperCase() !== fbTypeName.toUpperCase()) continue;
     const method = iface.methods.find(m => m.name.toUpperCase() === memberName.toUpperCase());
     if (method) return { uri: srcUri, range: method.range };
     const prop = iface.properties.find(p => p.name.toUpperCase() === memberName.toUpperCase());
     if (prop) return { uri: srcUri, range: prop.range };
     // Walk EXTENDS chain
     for (const ext of iface.extendsRefs) {
       // Recursively search parent interface (use same pattern as existing code)
     }
   }
   ```
   
   > **Important:** Study the exact return type and pattern used by the existing FB handler. The interface handler must match the same return shape (e.g., `Location` or `{ uri, range }`).

2. Ensure the EXTENDS chain is walked — if `I_Child EXTENDS I_Parent` and the method is on `I_Parent`, navigation should still work. Follow the same cross-file resolution pattern used by `findMemberType()` in completion.ts.

3. Similarly, check if `ProgramDeclaration` member access works in go-to-definition. Programs can have methods too. (Out of scope for this plan, but note it.)

**Tests to Write:**
- `server/src/__tests__/definition.test.ts`: Add tests for:
  - `myIntf.MethodName` where myIntf is interface-typed → navigates to method declaration
  - `myIntf.PropertyName` → navigates to property declaration
  - EXTENDS chain: method defined in parent interface

**Acceptance Criteria:**
- [ ] `myIntf.Start` navigates to `METHOD Start` in `InterfaceDeclaration`
- [ ] `myIntf.Value` navigates to `PROPERTY Value` in `InterfaceDeclaration`
- [ ] EXTENDS chain works: parent interface methods reachable
- [ ] Existing go-to-definition tests still pass
- [ ] `npm run typecheck` passes

---

### Phase 4: Fix References Handler for Interface Members

**Objective:** The references handler should traverse interface members so that find-all-references works for names used inside interface method signatures and property types.

**Files to Modify:**
- `server/src/handlers/references.ts`: Replace the no-op `InterfaceDeclaration` case (L261) with proper traversal

**Steps:**

1. Find the `InterfaceDeclaration` case in the AST visitor (around L261). It currently has just `break`. Replace with:
   ```typescript
   case 'InterfaceDeclaration': {
     const iface = node as InterfaceDeclaration;
     for (const ext of iface.extendsRefs) visitNode(ext); // if NamedRef is visitable
     for (const method of iface.methods) visitNode(method);
     for (const prop of iface.properties) visitNode(prop);
     break;
   }
   ```
   
   > **Important:** Study how other declaration types (e.g., `FunctionBlockDeclaration`) traverse their children. Match the same visiting pattern — some may use AST walking helpers, others may manually iterate children.

2. Verify that `MethodDeclaration` and `PropertyDeclaration` are already handled by the visitor (they should be, since they exist in FBs too).

**Tests to Write:**
- `server/src/__tests__/references.test.ts`: Add test:
  - Find references to a type name used in an interface method's VAR_INPUT → should find the reference

**Acceptance Criteria:**
- [ ] Find-all-references on a type name discovers usages inside interface method signatures
- [ ] Existing references tests still pass

---

### Phase 5: Add Interface Names to Flat Completion

**Objective:** When typing a variable declaration like `myVar : I_`, interface names should appear as completion suggestions.

**Files to Modify:**
- `server/src/handlers/completion.ts`: Add `InterfaceDeclaration` to sections 5 (same-file POUs, ~L960-977) and 7 (workspace-file POUs, ~L1028-1070)

**Steps:**

1. In **section 5** (same-file POUs, around L960-977), add an `InterfaceDeclaration` case:
   ```typescript
   case 'InterfaceDeclaration':
     items.push({
       label: decl.name,
       kind: CompletionItemKind.Interface,
       detail: 'Interface',
     });
     break;
   ```

2. In **section 7** (workspace-file POUs, around L1028-1070), add the same `InterfaceDeclaration` case.

   > **Important:** Check the exact switch/if-else structure in both sections. The interface should use `CompletionItemKind.Interface` (not Class or Module).

**Tests to Write:**
- `server/src/__tests__/completion.test.ts`: Add test:
  - Interface declared in same file → appears as completion item when typing a type name
- `server/src/__tests__/crossFileCompletion.test.ts`: Add test:
  - Interface from another file in workspace → appears as completion item

**Acceptance Criteria:**
- [ ] `I_Motor` appears in completion when typing a variable type
- [ ] `CompletionItemKind.Interface` is used
- [ ] Both same-file and cross-file scenarios work
- [ ] Existing completion tests still pass

---

### Phase 6: Add Integration Tests for Interface Dot-Member Completion

**Objective:** Add comprehensive test coverage for the dot-member completion flow with interfaces.

**Files to Modify:**
- `server/src/__tests__/completion.test.ts`: Add same-file interface dot-completion tests
- `server/src/__tests__/crossFileCompletion.test.ts`: Add cross-file interface dot-completion tests

**Steps:**

1. **Same-file interface dot-completion** — Add test in `completion.test.ts`:
   ```
   INTERFACE I_Motor
     METHOD Start : BOOL END_METHOD
     METHOD Stop END_METHOD
     PROPERTY Speed : INT END_PROPERTY
   END_INTERFACE
   
   FUNCTION_BLOCK FB_Test
   VAR
     motor : I_Motor;
   END_VAR
   motor.| ← cursor here
   ```
   Expect: `Start` (Method), `Stop` (Method), `Speed` (Property)

2. **EXTENDS chain completion** — Add test:
   ```
   INTERFACE I_Base
     METHOD BaseMethod END_METHOD
   END_INTERFACE
   
   INTERFACE I_Child EXTENDS I_Base
     METHOD ChildMethod END_METHOD
   END_INTERFACE
   
   FUNCTION_BLOCK FB_Test
   VAR
     child : I_Child;
   END_VAR
   child.| ← cursor here
   ```
   Expect: `ChildMethod` AND `BaseMethod`

3. **Cross-file interface dot-completion** — Add test in `crossFileCompletion.test.ts`:
   - Define interface in one "file" (workspace index entry)
   - Use it in another "file" as a variable type
   - Trigger dot-completion
   - Expect interface methods/properties

4. **Multi-level chain** — If `I_Motor` has a property `Config : I_Config`, test `motor.Config.Setting` completion.

**Acceptance Criteria:**
- [ ] All new completion tests pass
- [ ] Same-file, cross-file, EXTENDS chain, and multi-level scenarios covered
- [ ] All existing tests still pass
- [ ] `npm run typecheck` passes
- [ ] `vitest` full run passes

---

## Open Questions

1. **Should `SUPER^.` in an interface-extending FB show interface methods?**
   - **Option A:** No — `SUPER^.` should only show the parent FB's methods, not the interface contract. This is the current behavior and matches IEC 61131-3 semantics.
   - **Option B:** Yes — if the FB doesn't have a parent FB but implements an interface, SUPER^. could theoretically reference the interface.
   - **Recommendation:** Option A — maintain current behavior. `SUPER^.` is for FB inheritance chains, not interface implementation.

2. **Should go-to-definition on interface-typed variables offer "Go to Implementation" (find the implementing FB)?**
   - **Option A:** Not now — too complex, requires scanning all FBs for `IMPLEMENTS` refs.
   - **Option B:** Add as a separate feature later.
   - **Recommendation:** Option A for this plan; mark as future enhancement.

3. **Property accessor bodies in TcIO:** TcIO properties have `<Get>` accessors with empty `<Declaration>` CDATAs. The extraction already skips empty content. This is correct — interfaces only declare property signatures, never implementations.
   - **No action needed.**

## Risks & Mitigation

- **Risk:** Changing the extraction for TcIO may break lineMap consistency (offset tracking between extracted source and original XML positions).
  - **Mitigation:** `buildResult()` already handles methods/properties with lineMap tracking for POU containers. The same logic applies. Verify with existing lineMap assertion tests.

- **Risk:** Parser may not handle METHOD/PROPERTY inside INTERFACE blocks correctly if the extracted source has subtle formatting differences vs TcPOU.
  - **Mitigation:** The parser's `parseInterfaceDeclaration()` already calls `parseMethodDeclaration()` and `parsePropertyDeclaration()` — the same parsing functions used for FBs. Add a round-trip parse test (Phase 2) to catch any issues.

- **Risk:** Interleaved methods and properties in TcIO XML may produce different ordering in extracted source (methods first, then properties) vs the original XML order.
  - **Mitigation:** This is existing behavior for POU extraction and is acceptable. The parser handles any order of METHOD/PROPERTY within INTERFACE blocks.

## Success Criteria

- [ ] `myIntf.` shows interface methods and properties in completion suggestions (both same-file and cross-file)
- [ ] EXTENDS chain for interfaces works in completion (parent interface members included)
- [ ] `myIntf.Method` go-to-definition navigates to the method declaration in the interface
- [ ] Interface names appear as type suggestions in completion
- [ ] Find-all-references traverses interface members
- [ ] All phases have passing tests
- [ ] `npm run typecheck` and `vitest` pass cleanly

## Notes for Atlas

- **Phase 1 is the highest-impact fix** — it unblocks all downstream features by making interface members visible in the AST.
- **Phase 2 should be done immediately after Phase 1** — existing tests will fail until assertions are updated.
- The completion handler ALREADY supports `InterfaceDeclaration` in `findMemberType()` and `getMembersFromDeclarations()` — so once Phase 1 populates the AST, dot-member completion should "just work" for interfaces. But add tests to confirm!
- For the definition handler (Phase 3), study the exact return types and cross-file resolution pattern used by the existing FB MemberExpression handler. The interface handler should follow the same pattern.
- For the references handler (Phase 4), study how `FunctionBlockDeclaration` traverses its children in the visitor — apply the same pattern to `InterfaceDeclaration`.
- Test fixtures `I_Disposable.TcIO` and `I_LinkedList.TcIO` are already available in `tests/fixtures/mobject-core/`.
- Run all tests after each phase: `npx vitest run` from `server/`.
