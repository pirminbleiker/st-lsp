# Plan Complete: TcPOU LSP Fixes — XML Styling, Auto-Folding & Method/Property Extraction

All 5 phases implemented, reviewed (APPROVED), and integration-tested.

**Phases Completed:** 5 of 5
1. ✅ Phase 1: Fix XML Dimming Color (Green → Barely Visible)
2. ✅ Phase 2: Enable Auto-Folding of XML Wrapper Regions
3. ✅ Phase 3: Extract Method CDATAs from TcPOU Files
4. ✅ Phase 4: Extract Property CDATAs from TcPOU Files
5. ✅ Phase 5: Integration Tests with Dictionary.TcPOU

**All Files Created/Modified:**
- server/src/handlers/semanticTokens.ts
- server/src/handlers/foldingRange.ts
- server/src/twincat/tcExtractor.ts
- client/package.json
- server/src/__tests__/semanticTokens.test.ts
- server/src/__tests__/foldingRange.test.ts
- server/src/__tests__/tcExtractor.test.ts

**Key Functions/Classes Added:**
- `extractMethodCDATAs()` in tcExtractor.ts — extracts all `<Method>` CDATAs from POU body
- `extractPropertyCDATAs()` in tcExtractor.ts — extracts all `<Property>` CDATAs (Get/Set accessors)
- `RawMethodData` interface in tcExtractor.ts
- `RawPropertyData` interface in tcExtractor.ts
- `TopLevelExtractionData` interface in tcExtractor.ts
- `TT_XML_MARKUP = 12` constant in semanticTokens.ts
- `collectXmlCommentTokens()` now emits `xmlMarkup` token type instead of `comment`

**Test Coverage:**
- Total new tests written: ~82 (20 method extraction + 20 property extraction + 57 integration - 15 overlap/polish)
- All pre-existing tests still pass
- 1 pre-existing failure (serverStartup 8s timeout) is unrelated

**Recommendations for Next Steps:**
- Fix broken handlers that don't use extractStFromTwinCAT: references.ts, rename.ts, signatureHelp.ts, codeLens.ts, codeActions.ts, documentSymbols.ts, formatting.ts — these all call parse(doc.getText()) directly on raw XML
- Consider adding the `#` typed-literal lexer fix (lsp-bugs-plan.md Bug 1) for TwinCAT hex literals like 16#FF
- Consider removing the redundant `"onLanguage:iec-st"` activation event from client/package.json (pre-existing lint warning)
