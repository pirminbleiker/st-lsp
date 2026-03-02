## Plan Complete: AST Caching for Cross-File Search

The full AST caching pipeline is now in place. Every LSP handler now uses a shared in-memory parse cache instead of re-parsing on every request. Cross-file handlers (go-to-definition, references, rename) read from the WorkspaceIndex cache instead of hitting the disk. A critical Linux-only `uriToPath` bug that silently disabled the entire cache was also fixed as part of Phase 1.

**Phases Completed:** 5 of 5
1. ✅ Phase 1: Extend WorkspaceIndex Cache
2. ✅ Phase 2: Shared `mapperForUri` Utility
3. ✅ Phase 3: Cross-File Handlers Use Cache
4. ✅ Phase 4: Active-Document Cache via `getOrParse`
5. ✅ Phase 5: Cache Repopulation on Invalidation

**All Files Created/Modified:**
- `server/src/twincat/workspaceIndex.ts` — extended cache type, new methods, fixed `uriToPath` bug
- `server/src/handlers/shared.ts` (NEW) — `getOrParse`, `invalidateDocumentCache`, `mapperForUri`
- `server/src/handlers/definition.ts` — uses cache in cross-file loop, removed duplicate `mapperForUri`
- `server/src/handlers/references.ts` — uses cache in cross-file loop, removed duplicate `mapperForUri`
- `server/src/handlers/rename.ts` — uses cache in cross-file loop, removed duplicate `mapperForUri`
- `server/src/handlers/hover.ts` — uses `getOrParse`
- `server/src/handlers/completion.ts` — uses `getOrParse`, uses cache in cross-file loops
- `server/src/handlers/diagnostics.ts` — uses `getOrParse`, uses cache in cross-file loops
- `server/src/handlers/documentSymbols.ts` — uses `getOrParse`
- `server/src/handlers/signatureHelp.ts` — uses `getOrParse`
- `server/src/handlers/codeLens.ts` — uses `getOrParse`, uses cache in cross-file loop
- `server/src/handlers/codeActions.ts` — uses `getOrParse`
- `server/src/handlers/inlayHints.ts` — uses `getOrParse`, uses cache in cross-file loop
- `server/src/handlers/foldingRange.ts` — uses `getOrParse`
- `server/src/handlers/formatting.ts` — uses `getOrParse`
- `server/src/handlers/semanticTokens.ts` — uses `getOrParse`
- `server/src/server.ts` — invalidates doc cache on change/close, calls `updateAst` after parse
- `server/src/__tests__/workspaceIndex.test.ts` — 5 new tests for cache methods
- `server/src/__tests__/shared.test.ts` (NEW) — 3 tests for `mapperForUri`

**Key Functions/Classes Added:**
- `CachedParseResult` interface (exported from `workspaceIndex.ts`)
- `WorkspaceIndex.getExtraction(uri)` — cache lookup for extraction only
- `WorkspaceIndex.updateAst(uri, ast, errors, extraction)` — write-back to cache
- `DocumentParseResult` interface (in `shared.ts`)
- `getOrParse(document)` — version-keyed active-document cache
- `invalidateDocumentCache(uri)` — clears stale document parse cache entry
- `mapperForUri(fileUri, workspaceIndex?)` — cache-first PositionMapper factory

**Test Coverage:**
- Total tests written: 8 (5 workspaceIndex + 3 shared)
- All tests passing: ✅ (969/970 — 1 pre-existing failure in `serverStartup.test.ts` requires compiled bundle)

**Recommendations for Next Steps:**
- Add a test that verifies `getOrParse` returns the same cached object for the same document version (no double-parse)
- Consider adding cache hit/miss telemetry for performance profiling in the future
- The `serverStartup.test.ts` failure is pre-existing and unrelated — it requires `bundle/server.js` to be built first
