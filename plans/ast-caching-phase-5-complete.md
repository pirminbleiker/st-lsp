## Phase 5 Complete: Cache Repopulation on Invalidation

After an active document edit, `onDidChangeContent` in `server.ts` now immediately repopulates the `WorkspaceIndex` cache via `updateAst()`. Cross-file handlers (references, rename, definition) that run concurrently no longer fall back to a stale disk read for the just-edited file — they find a fresh in-memory parse result in the index instead.

**Files created/changed:**
- `server/src/server.ts`

**Functions created/changed:**
- `documents.onDidChangeContent` handler — rewritten to call `getOrParse(doc)` then `workspaceIndex?.updateAst(...)` instead of `workspaceIndex?.invalidateAst(...)`

**Tests created/changed:**
- None needed for this phase — `updateAst()` is already covered by Phase 1 tests in `workspaceIndex.test.ts`

**Review Status:** APPROVED

**Git Commit Message:**
```
feat(lsp): repopulate WorkspaceIndex cache on document change

- Import getOrParse alongside invalidateDocumentCache in server.ts
- In onDidChangeContent: invalidate stale doc cache, parse fresh,
  then call workspaceIndex.updateAst() to push in-memory result
- Remove invalidateAst() call — updateAst() replaces the entry
  directly so cross-file handlers never see a missing cache entry
```
