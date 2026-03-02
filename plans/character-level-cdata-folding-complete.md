## Plan Complete: Character-Level CDATA Folding

Character-level XML folding is fully implemented. TcPOU XML wrapper sections now fold with character-level precision using LSP `startCharacter`, `endCharacter`, and `collapsedText: '…'`, so only the CDATA/ST content is visible when collapsed — including on mixed lines like `<Declaration><![CDATA[{attribute 'linkalways'}`. Adjacent XML ranges separated by empty CDATA content are merged into a single fold indicator to prevent double `…` markers.

**Phases Completed:** 3 of 3
1. ✅ Phase 1: Character-level XML folding with `lineFoldingOnly` fallback
2. ✅ Phase 2: Merge adjacent XML ranges around empty CDATAs
3. ✅ Phase 3: Update tests and validate with character-level assertions

**All Files Created/Modified:**
- `server/src/handlers/foldingRange.ts`
- `server/src/server.ts`
- `server/src/__tests__/foldingRange.test.ts`

**Key Functions/Classes Added:**
- `positionToOffset(text, pos)` — converts `{line, character}` to char offset
- `mergeAdjacentXmlRanges(text, xmlRanges)` — merges consecutive XML ranges separated by whitespace-only CDATA content
- `handleFoldingRanges(…, lineFoldingOnly?)` — updated signature with optional `lineFoldingOnly` param
- `handleFoldingRangesXml(…, lineFoldingOnly?)` — updated to emit character-level folds

**Test Coverage:**
- Total tests written: 6 new (2 updated test blocks + 4 new tests)
- Total folding tests: 32 (up from 26)
- All tests passing: ✅ (884/885, 1 pre-existing unrelated failure in serverStartup.test.ts)

**Recommendations for Next Steps:**
- Performance: `positionToOffset` walks from offset 0 on every call; for very large TcPOU files with many CDATA sections, a pre-built line offset table would be faster (not needed at current scale)
- The `lineFoldingOnly` module variable in `server.ts` is set once at initialize; if VS Code ever sends capability changes, this would need re-reading (not a current concern)
