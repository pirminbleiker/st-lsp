# Plan: Workspace-Wide Dot-Member Completion

**Created:** 2026-03-02  
**Status:** Ready for Atlas Execution

## Summary

Improve dot-member completion (`myVar.` → shows members) to work reliably across the entire workspace. The core infrastructure already exists (`getDotAccessMembers`, `findMemberType`, `getMembersFromDeclarations`, `collectAllDeclSets`) but has critical gaps: GVL dot-access (`GVL_Name.Variable`), Program instance members, Union members, `THIS^.` in dot-path, pointer-dereference before dot (`myPtr^.Member`), FB VAR visibility filtering, and standard FB inputs not shown. This plan addresses all these gaps incrementally.

## Context & Analysis

**Relevant Files:**
- `server/src/handlers/completion.ts`: Main completion handler — `handleCompletion()`, `getDotAccessMembers()`, `getIdentifierBeforeDotInLines()`, `findMemberType()`, `getMembersFromDeclarations()`, `collectAllDeclSets()`, `collectVarDeclarations()`
- `server/src/parser/ast.ts`: AST types — `GvlDeclaration` (no `name` field), `ProgramDeclaration`, `UnionDeclaration`, `TypeRef` (has `isPointer`/`isReference` flags)
- `server/src/parser/parser.ts`: Parser — `parseGvlDeclaration()` produces nameless nodes
- `server/src/twincat/tcExtractor.ts`: TwinCAT XML extraction — does NOT capture `<GVL Name="...">` attribute
- `server/src/twincat/workspaceIndex.ts`: Workspace index — caches ASTs per file URI
- `server/src/twincat/stdlib.ts`: Standard FB catalog — has `inputs` and `outputs` arrays
- `server/src/__tests__/completion.test.ts`: Existing dot-completion tests (single-file only)
- `server/src/__tests__/crossFileCompletion.test.ts`: Cross-file tests (flat completion only, no dot-completion)

**Key Functions/Classes:**
- `getDotAccessMembers()` in completion.ts: Resolves dot chain → CompletionItem[]. Currently only resolves first segment as local variable.
- `getIdentifierBeforeDotInLines()` in completion.ts: Regex `[a-zA-Z0-9_.]` — fails on `^`, `[`, `(`.
- `findMemberType()` in completion.ts: Walks FB/Interface/Struct/Alias EXTENDS chains. Missing: Union, Program, GVL.
- `getMembersFromDeclarations()` in completion.ts: Returns all members of a type. Missing: Union, Program, GVL. Bug: exposes FB VAR (internal).
- `collectAllDeclSets()` in completion.ts: Gathers declarations from current file + workspace index. Works correctly.
- `GvlDeclaration` in ast.ts: Has `varBlocks` but no `name` field.
- `extractTopLevelCDATAs()` in tcExtractor.ts: Captures `<GVL>` tag but doesn't extract `Name` attribute.

**Dependencies:**
- `vscode-languageserver`: CompletionItem, CompletionItemKind types
- `vitest`: Test framework

**Patterns & Conventions:**
- Case-insensitive comparisons via `.toUpperCase()`
- Discriminated unions via `kind` string literal
- Cycle detection via `visited: Set<string>` in recursive type walks
- Test helpers: `makeDoc(content, uri?)`, `makeParams(uri, line, char)`, `makeCachingMockIndex(map)`

## Implementation Phases

### Phase 1: GVL Name Extraction & AST Enhancement

**Objective:** Give `GvlDeclaration` a `name` field so GVLs can be identified by name for dot-access resolution. Extract the name from TwinCAT XML `<GVL Name="...">` attribute.

**Files to Modify:**
- `server/src/parser/ast.ts`: Add optional `name?: string` and `nameRange?: Range` to `GvlDeclaration`
- `server/src/twincat/tcExtractor.ts`: Extract `Name` attribute from `<GVL>` / `<DUT>` / `<Itf>` container tags. Add `containerName?: string` to extraction result. Inject a synthetic comment or pragma into the emitted source that the parser can pick up, OR add `containerName` to the extraction result and have the server inject it post-parse.
- `server/src/twincat/workspaceIndex.ts`: After parsing a GVL file, if the extraction result has `containerName`, set `gvlDeclaration.name = containerName` on the cached AST node.
- `server/src/handlers/shared.ts`: Same post-parse name injection in `getOrParse()`.

**Approach — Post-parse injection (simplest):**
1. In `tcExtractor.ts`, extract the `Name="..."` attribute from the container element regex (already matches `<GVL Name="GVL_Main">` — just needs a capture group).
2. Add `containerName?: string` to `ExtractionResult`.
3. In `workspaceIndex.ts` `parseAndCache()`, after parsing, if `extraction.containerName` exists and the AST has a `GvlDeclaration`, set its `name`.
4. In `shared.ts` `getOrParse()`, same injection.

**Tests to Write (in existing test files):**
- `server/src/__tests__/tcExtractor.test.ts`: Test that `extractST()` for a `.tcgvl` file returns `containerName: 'GVL_Main'`
- `server/src/__tests__/parser.test.ts`: Test that `GvlDeclaration` accepts optional `name` field

**Steps:**
1. Write test: `extractST` for `.tcgvl` content returns `containerName: 'GVL_Main'`
2. Run test → should fail (no `containerName` in result)
3. Modify `extractTopLevelCDATAs()` to capture `Name` attribute: change regex from `/<(POU|GVL|DUT|Itf)\b[^>]*>/i` to `/<(POU|GVL|DUT|Itf)\b[^>]*?\bName="([^"]*)"[^>]*>/i` (or extract name separately after match)
4. Propagate `containerName` through `TopLevelExtractionData` → `ExtractionResult`
5. Run test → should pass
6. Add `name?: string` and `nameRange?: Range` to `GvlDeclaration` in ast.ts
7. In `workspaceIndex.ts` `parseAndCache()`: after `parse()`, find `GvlDeclaration` in AST, set `.name = extraction.containerName`
8. In `shared.ts` `getOrParse()`: same injection
9. Run typecheck

**Acceptance Criteria:**
- [ ] `GvlDeclaration` has optional `name` field in AST
- [ ] TwinCAT extractor captures `Name` attribute from `<GVL Name="...">` XML
- [ ] Cached ASTs have named GVL declarations
- [ ] All existing tests still pass

---

### Phase 2: GVL Dot-Access Completion (`GVL_Name.variable`)

**Objective:** When user types `GVL_Main.`, show all global variables declared in that GVL. Works across workspace files.

**Files to Modify:**
- `server/src/handlers/completion.ts`:
  - In `getDotAccessMembers()`: Before the existing local-variable lookup, check if `parts[0]` matches a `GvlDeclaration.name` in `collectAllDeclSets()`. If match found:
    - If `parts.length === 1`: return all variables from the GVL's `varBlocks`
    - If `parts.length > 1`: resolve `parts[1]` as a GVL variable, get its type, then walk remaining chain via existing `findMemberType()`

**Tests to Write:**
- `server/src/__tests__/completion.test.ts`: Single-file test — GVL + PROGRAM in same file, `GVL_Test.` shows global vars
- `server/src/__tests__/crossFileCompletion.test.ts`: Cross-file test — GVL in cached AST (other file), PROGRAM in current file, `GVL_Test.` shows vars from other file
- Test chained access: `GVL_Test.myFb.Member` resolves correctly

**Steps:**
1. Write test: GVL `GVL_Test` with `VAR_GLOBAL myVar : INT; END_VAR`, PROGRAM with cursor at `GVL_Test.` → expect `myVar` in results
2. Run test → should fail
3. In `getDotAccessMembers()`, add GVL name lookup: iterate `collectAllDeclSets()`, find `GvlDeclaration` where `d.name?.toUpperCase() === parts[0].toUpperCase()`
4. If found with `parts.length === 1`: return all var declarations as CompletionItems (Variable kind)
5. If found with `parts.length > 1`: resolve `parts[1]` as a variable in the GVL's varBlocks, get its `type.name`, then continue walking chain with existing code
6. Run test → should pass
7. Write cross-file test using `makeCachingMockIndex`
8. Run all tests

**Acceptance Criteria:**
- [ ] `GVL_Name.` shows all global variables from that GVL
- [ ] Cross-file GVL resolution works via workspace index
- [ ] Chained access `GVL_Name.fbInstance.Member` works
- [ ] Case-insensitive matching

---

### Phase 3: Program Instance & Union Member Completion

**Objective:** Support dot-completion for Program instances and Union type members.

**Files to Modify:**
- `server/src/handlers/completion.ts`:
  - `findMemberType()`: Add `ProgramDeclaration` branch (search varBlocks for member)
  - `getMembersFromDeclarations()`: Add `ProgramDeclaration` branch (return VAR_OUTPUT and VAR_IN_OUT variables), Add `UnionDeclaration` branch (return fields)
  - `getDotAccessMembers()`: When resolving first segment, also search for `ProgramDeclaration` names matching `parts[0]` (programs can be instantiated as variables, but they can also be accessed directly by name in TwinCAT)

**Tests to Write:**
- `completion.test.ts`: Program with vars, `myProg.` shows VAR_OUTPUT/VAR_IN_OUT members
- `completion.test.ts`: Union type, `myUnion.` shows union fields

**Steps:**
1. Write test: UNION with fields, variable of union type, `myUnion.` → expect union fields
2. Run test → fail
3. In `getMembersFromDeclarations()`: add branch for `UnionDeclaration` — iterate `declarations` in `TypeDeclarationBlock`, check for `UnionDeclaration` matching `typeName`, return `fields` as CompletionItems
4. In `findMemberType()`: add similar branch for `UnionDeclaration` — find field matching `memberName`, return `field.type.name`
5. Run test → pass
6. Write test: PROGRAM with VAR_OUTPUT, another PROGRAM instance accesses `myProg.` → VAR_OUTPUT/VAR_IN_OUT shown
7. In `getMembersFromDeclarations()`: add `ProgramDeclaration` branch — filter to VAR_OUTPUT and VAR_IN_OUT
8. In `findMemberType()`: add `ProgramDeclaration` branch
9. In `getDotAccessMembers()`: when first segment isn't a local var, also search for ProgramDeclaration names
10. Run all tests

**Acceptance Criteria:**
- [ ] `myUnionVar.` shows union field members
- [ ] `myProgInstance.` shows program's external vars (VAR_OUTPUT, VAR_IN_OUT)
- [ ] Direct program name access works for single-instance programs
- [ ] Chain resolution through union and program types works

---

### Phase 4: Pointer Dereference & THIS^. Dot-Completion

**Objective:** Handle `myPtr^.Member` (pointer dereference before dot) and `THIS^.Member` in the dot-completion path.

**Files to Modify:**
- `server/src/handlers/completion.ts`:
  - `getIdentifierBeforeDotInLines()`: Extend regex to also accept `^` character: change `/[a-zA-Z0-9_.]/` to `/[a-zA-Z0-9_.^]/`. When extracting the chain, strip `^` characters since they are transparent for type resolution (pointer dereference yields the base type).
  - Handle `THIS^.` or `THIS.` in the dot-completion early path: if extracted chain (before dot) is `THIS` or `THIS^`, find the enclosing FB declaration and return its externally-visible members. Currently `THIS.` is only handled in the flat-completion section (line 838), where it only shows actions and methods. Move/duplicate this logic to the dot-completion path and include all appropriate members (methods, properties, actions, VAR_INPUT, VAR_OUTPUT, VAR_IN_OUT, plus internal VAR since THIS is self-access).

**Tests to Write:**
- `completion.test.ts`: `POINTER TO FB_Test` variable, `myPtr^.` → shows FB members
- `completion.test.ts`: Inside FB body, `THIS^.` → shows own methods, properties, vars
- `completion.test.ts`: Inside FB body, `THIS.` → shows own methods, properties, vars

**Steps:**
1. Write test: FB with methods/properties, inside body `THIS^.` → expect methods + properties + own vars
2. Run test → fail (THIS^ stops regex, falls through to flat completion)
3. Update `getIdentifierBeforeDotInLines()` regex to `/[a-zA-Z0-9_.^]/`
4. Add stripping of `^` from extracted identifier: `ident.replace(/\^/g, '')`
5. In `handleCompletion()` dot-access section (before calling `getDotAccessMembers`): check if chain is `THIS` → find enclosing FB → return all its members (methods, properties, actions, all var blocks since accessing own members)
6. Run test → pass
7. Write test: `POINTER TO FB_Test` variable, `myPtr^.` → shows FB members
8. The `^` stripping makes this work automatically since `TypeRef.name` already is the base type.
9. Run all tests

**Acceptance Criteria:**
- [ ] `myPtr^.` shows members of the pointed-to type
- [ ] `THIS^.` inside FB shows own methods, properties, actions, variables
- [ ] `THIS.` inside FB shows own methods, properties, actions, variables
- [ ] Chained pointer access `myPtr^.innerPtr^.Member` works
- [ ] Existing dot-completion tests still pass

---

### Phase 5: FB VAR Visibility Filtering

**Objective:** When accessing FB members externally (`myFb.`), only show VAR_INPUT, VAR_OUTPUT, and VAR_IN_OUT. Internal VAR and VAR_TEMP should not be shown. When accessing own members (THIS, SUPER), show all.

**Files to Modify:**
- `server/src/handlers/completion.ts`:
  - `getMembersFromDeclarations()`: Add `accessContext?: 'external' | 'self' | 'super'` parameter. For `'external'` (default), filter FB varBlocks to only `VAR_INPUT`, `VAR_OUTPUT`, `VAR_IN_OUT`. For `'self'`, show everything. For `'super'`, show everything except `PRIVATE` methods.
  - `getDotAccessMembers()`: Pass `'external'` context to `getMembersFromDeclarations()`
  - THIS path: Pass `'self'` context
  - SUPER path: Already handles visibility correctly via `getSuperMembers()`

**Tests to Write:**
- `completion.test.ts`: FB with VAR (internal), VAR_INPUT, VAR_OUTPUT — `myFb.` should NOT show internal VAR members
- `completion.test.ts`: Inside FB, `THIS.` SHOULD show internal VAR members

**Steps:**
1. Write test: FB with `VAR internalVar : INT; END_VAR` and `VAR_OUTPUT outputVar : BOOL; END_VAR`, PROGRAM with `myFb.` → `outputVar` shown, `internalVar` NOT shown
2. Run test → fail (currently shows everything)
3. Add `accessContext` parameter to `getMembersFromDeclarations()`, default `'external'`
4. Filter varBlocks: for `'external'`, only include `VAR_INPUT`, `VAR_OUTPUT`, `VAR_IN_OUT`
5. For `'self'`, include all varBlocks
6. Update all call sites to pass appropriate context
7. Run test → pass
8. Verify SUPER tests still pass (uses separate `getSuperMembers()`)
9. Run all tests

**Acceptance Criteria:**
- [ ] External FB access only shows VAR_INPUT, VAR_OUTPUT, VAR_IN_OUT
- [ ] Self-access (THIS) shows all var kinds
- [ ] Methods and properties always shown (both external and self)
- [ ] No regression in existing completion tests

---

### Phase 6: Standard FB Input Members & Cross-File Dot-Completion Tests

**Objective:** Show standard FB inputs in dot-completion (e.g., `myTimer.IN`, `myTimer.PT`), and add comprehensive cross-file dot-completion tests.

**Files to Modify:**
- `server/src/handlers/completion.ts`:
  - In `getDotAccessMembers()` final member generation for standard FBs: return BOTH `inputs` and `outputs` (currently only `outputs`)
  - Add `detail` to distinguish input vs output (e.g., `detail: 'VAR_INPUT'` / `detail: 'VAR_OUTPUT'`)

**Tests to Write:**
- `completion.test.ts`: `myTimer : TON`, `myTimer.` → expect IN, PT (inputs) AND Q, ET (outputs)
- `crossFileCompletion.test.ts`: FB defined in file A, variable of that FB type in file B, `myFb.` → shows FB members from file A
- `crossFileCompletion.test.ts`: STRUCT defined in file A, variable in file B, `myStruct.` → shows fields from file A
- `crossFileCompletion.test.ts`: GVL in file A, PROGRAM in file B, `GVL_Name.` → shows GVL vars from file A
- `crossFileCompletion.test.ts`: Chain across files — FB in file A, STRUCT in file B, variable in file C, `myFb.structMember.field`

**Steps:**
1. Write test: `myTimer : TON`, `myTimer.` → expect both IN, PT and Q, ET
2. Run test → fail (only outputs shown)
3. In `getDotAccessMembers()` standard FB branch: change `stdFb.outputs.map(...)` to `[...stdFb.inputs.map(...), ...stdFb.outputs.map(...)]` with appropriate kind/detail labels
4. Run test → pass
5. Write cross-file dot-completion tests using `makeCachingMockIndex`
6. Verify they pass (should already work thanks to `collectAllDeclSets`)
7. If any failures, fix the resolution logic
8. Run all tests

**Acceptance Criteria:**
- [ ] Standard FB inputs (IN, PT for TON) shown in dot-completion
- [ ] Standard FB outputs still shown
- [ ] Cross-file FB member completion works
- [ ] Cross-file STRUCT field completion works
- [ ] Cross-file GVL dot-access works (depends on Phase 2)
- [ ] Cross-file chained resolution works

---

### Phase 7: GVL Variables in Scope (Flat Completion)

**Objective:** Make variables declared in GVLs available as flat completions (without dot-access) in all POUs across the workspace. When a user types inside a POU body, global variables from GVLs should appear in the completion list.

**Files to Modify:**
- `server/src/handlers/completion.ts`:
  - In `handleCompletion()` flat-completion section: After section 4 (variables in scope), add a section 4a that collects variables from all `GvlDeclaration` nodes in the current file AND workspace index
  - Format: show as `Variable` kind with detail indicating the GVL name (if available)
  - For named GVLs (from TcGVL files), optionally prefix or annotate with GVL name

**Tests to Write:**
- `completion.test.ts`: GVL with `VAR_GLOBAL gCounter : INT;`, PROGRAM body → `gCounter` appears in flat completion
- `crossFileCompletion.test.ts`: GVL in another file → `gCounter` appears in flat completion

**Steps:**
1. Write test: GVL + PROGRAM in same file, cursor at empty line in PROGRAM body → `gCounter` in results
2. Run test → fail
3. In `handleCompletion()` after section 4: iterate `ast.declarations`, for each `GvlDeclaration`, add all vars to items
4. In section 7 (workspace index loop): for each `GvlDeclaration` in other file ASTs, add vars to items
5. Run test → pass
6. Write cross-file test
7. Run all tests

**Acceptance Criteria:**
- [ ] GVL variables appear in flat completion list
- [ ] Cross-file GVL variables appear
- [ ] No duplicate entries
- [ ] GVL variables annotated with source (GVL name or file)

---

## Open Questions

1. **GVL name for plain `.st` files?**
   - **Option A:** GVLs from `.st` files remain nameless — only accessible via their variable names in flat completion, not via `GVL_Name.` dot-access. Named GVLs only from TwinCAT XML files.
   - **Option B:** Use the filename as the GVL name for `.st` files.
   - **Recommendation:** Option A — this matches TwinCAT behavior where GVL names come from the project, not the filename. Plain `.st` files with `VAR_GLOBAL` blocks should surface their variables directly.

2. **FB VAR visibility — what about VAR_STAT?**
   - **Option A:** Treat `VAR_STAT` as internal (not shown externally) — this matches IEC 61131-3.
   - **Option B:** Show `VAR_STAT` externally since TwinCAT allows it in some contexts.
   - **Recommendation:** Option A — follow the standard. It can be relaxed later if user feedback indicates otherwise.

3. **Should `THIS.` show actions?**
   - **Option A:** Yes — actions are callable members of the FB.
   - **Option B:** No — actions are implicit and called differently.
   - **Recommendation:** Option A — the existing `THIS.` code in the flat-completion section already includes actions, so maintain consistency.

## Risks & Mitigation

- **Risk:** GVL name extraction regex might not match all TwinCAT XML variants (attributes in different order, single quotes, etc.)
  - **Mitigation:** Test with real TwinCAT project files from the test fixtures. Use a flexible regex that handles attribute ordering.

- **Risk:** FB VAR visibility filtering might break existing tests that expect internal vars in dot-completion.
  - **Mitigation:** Phase 5 runs after all other changes; update affected tests to match correct IEC 61131-3 visibility.

- **Risk:** Performance — adding GVL variable scanning to every completion request.
  - **Mitigation:** GVLs are already included in cached ASTs from workspace index. No additional parsing needed.

- **Risk:** The `^` character in identifier regex might match unwanted patterns.
  - **Mitigation:** Strip `^` after extraction and only use it for identifier chain detection. Write regression tests.

## Success Criteria

- [ ] `myFb.` shows externally-visible FB members (VAR_INPUT, VAR_OUTPUT, VAR_IN_OUT, methods, properties)
- [ ] `GVL_Name.` shows global variables from that GVL
- [ ] `myStruct.` shows struct fields
- [ ] `myUnionVar.` shows union fields
- [ ] `myPtr^.Member` works for pointer dereference
- [ ] `THIS^.` / `THIS.` shows own FB members
- [ ] `myTimer.` shows both inputs AND outputs of standard FBs
- [ ] All dot-completion works cross-file via workspace index
- [ ] GVL variables appear in flat completion (without dot)
- [ ] All existing tests pass
- [ ] New comprehensive test coverage for all scenarios

## Notes for Atlas

- The completion handler (`completion.ts`) is the primary file — most changes go here.
- The `collectAllDeclSets()` function already handles cross-file declaration gathering. Use it consistently rather than reimplementing.
- When testing cross-file scenarios, use `makeCachingMockIndex` from `crossFileCompletion.test.ts` — it avoids disk I/O.
- The extraction name injection (Phase 1) requires changes in both `workspaceIndex.ts` and `shared.ts` `getOrParse()` since both paths create cached ASTs.
- Phase 5 (visibility filtering) is the riskiest change — it changes existing behavior. Run all tests after this phase and update any tests that relied on the old (incorrect) behavior.
- Maintain case-insensitive comparisons (`toUpperCase()`) throughout — this is critical for IEC 61131-3 compliance.
- The `ExtractionResult` type from tcExtractor.ts is returned by `extractST()` — check the exact interface shape before modifying.
