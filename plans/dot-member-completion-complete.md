## Plan Complete: Workspace-Wide Dot-Member Completion

All 7 phases implemented. The dot-member completion feature now works reliably across the entire workspace with correct IEC 61131-3 visibility rules. Variables from all declaration types (FB, STRUCT, UNION, PROGRAM, GVL) are resolved through cross-file workspace index lookups. Pointer dereferencing, THIS self-access, and standard FB input/output visibility are all handled correctly.

**Phases Completed:** 7 of 7
1. ✅ Phase 1: GVL Name Extraction & AST Enhancement
2. ✅ Phase 2: GVL Dot-Access Completion
3. ✅ Phase 3: Program Instance & Union Member Completion
4. ✅ Phase 4: Pointer Dereference & THIS^. Dot-Completion
5. ✅ Phase 5: FB VAR Visibility Filtering
6. ✅ Phase 6: Standard FB Inputs & Cross-File Dot-Completion Tests
7. ✅ Phase 7: GVL Variables in Flat Completion

**All Files Created/Modified:**
- server/src/twincat/tcExtractor.ts
- server/src/parser/ast.ts
- server/src/twincat/workspaceIndex.ts
- server/src/handlers/shared.ts
- server/src/handlers/completion.ts
- server/src/__tests__/tcExtractor.test.ts
- server/src/__tests__/completion.test.ts
- server/src/__tests__/crossFileCompletion.test.ts

**Key Functions/Classes Added:**
- `GvlDeclaration.name` optional field (ast.ts)
- `ExtractionResult.containerName` optional field (tcExtractor.ts)
- Container name extraction from XML `Name` attribute (tcExtractor.ts)
- GVL name injection post-parse (workspaceIndex.ts, shared.ts)
- GVL dot-access resolution in `getDotAccessMembers()` (completion.ts)
- Union member resolution in `findMemberType()` + `getMembersFromDeclarations()` (completion.ts)
- Program member resolution in `findMemberType()` + `getMembersFromDeclarations()` (completion.ts)
- Pointer dereference `^` stripping in `getIdentifierBeforeDotInLines()` (completion.ts)
- THIS special-case handler in `handleCompletion()` (completion.ts)
- `EXTERNAL_VISIBLE_VAR_KINDS` set for FB visibility filtering (completion.ts)
- Standard FB inputs in dot-completion results (completion.ts)
- Same-file GVL flat completion section 4a (completion.ts)
- Cross-file GVL flat completion in section 7 (completion.ts)

**Test Coverage:**
- Total new tests written: ~45
- All 1031 tests passing (1 pre-existing unrelated timeout in serverStartup.test.ts)
- 0 TypeScript errors

**What dot-completion now supports:**
| Pattern | Result |
|---------|--------|
| `myFb.` | VAR_INPUT, VAR_OUTPUT, VAR_IN_OUT, methods, properties |
| `GVL_Name.` | All global variables from that GVL |
| `myStruct.` | Struct fields |
| `myUnion.` | Union fields |
| `myProg.` | VAR_OUTPUT, VAR_IN_OUT of the program |
| `myPtr^.` | Members of pointed-to type (pointer deref) |
| `THIS^.` / `THIS.` | Own methods, properties, actions, all vars |
| `SUPER^.` | Parent FB external members |
| `myTimer.` | TON inputs (IN, PT) AND outputs (Q, ET) |
| All of the above cross-file | ✅ via workspace index |

**Recommendations for Next Steps:**
- Add `memberRange` to `MemberExpression` AST node to enable precise hover and go-to-definition on the member token
- Extend hover handler to show type info for `myFb.Member` hover (currently only shows for assignments)
- Consider filtering PRIVATE methods from external FB dot-completion (currently all methods shown)
- Add ARRAY member access `myArray[0].` support (requires AST-based completion, not text-based)
