# Plan: TcPOU LSP Fixes — XML Styling, Auto-Folding & Method/Property Extraction

**Created:** 2026-02-28  
**Status:** Ready for Atlas Execution

## Summary

Three major problems with TcPOU file handling need fixing: (1) XML wrapper regions appear **green** instead of barely visible, (2) XML wrapper regions are **not auto-folded** on file open, and (3) **Method and Property CDATAs are not extracted** from TcPOU files, causing most LSP features (hover, completion, diagnostics, semantic tokens) to be broken for code inside methods/properties. Using `Dictionary.TcPOU` (25 methods, 2 properties) as the reference file.

## Context & Analysis

### Root Cause Analysis

**Problem 1 — Green XML instead of barely visible:**  
`handleSemanticTokensXml()` in `semanticTokens.ts` emits `comment` (token type index 9) for XML wrapper regions. The Dark+ theme renders `comment` tokens as green (#6A9955). There is no `semanticTokenColorCustomizations` or custom token type to override this. Need a dedicated token type with very dim foreground.

**Problem 2 — No auto-folding:**  
The server provides `FoldingRangeKind.Region` for XML wrapper regions. VS Code displays these as collapsible but doesn't auto-collapse them. VS Code only auto-collapses `FoldingRangeKind.Imports` ranges when `editor.foldingImportsByDefault` is true. Need to use `Imports` kind and set the per-language default.

**Problem 3 — Methods/Properties not extracted:**  
`extractTopLevelCDATAs()` in `tcExtractor.ts` only extracts:
- The first `<Declaration>` CDATA (FB/PROGRAM declaration + vars)
- The first `<Implementation>` CDATA (body statements)
- `<Action>` CDATAs (wrapped with ACTION.../END_ACTION)

It **completely ignores** `<Method>` and `<Property>` elements, each of which has its own `<Declaration>` and `<Implementation>` CDATAs. This means:
- No semantic tokens for method/property code (content falls between XML ranges and sections — gets **no tokens at all**)
- No diagnostics (parser never sees the code)
- No hover/completion/definition for method variables
- No folding for method/property blocks

### TcPOU Method/Property XML Structure (Dictionary.TcPOU reference)

```xml
<POU Name="Dictionary" ...>
  <Declaration><![CDATA[FUNCTION_BLOCK Dictionary EXTENDS Disposable...]]></Declaration>
  <Implementation><ST><![CDATA[]]></ST></Implementation>
  
  <Method Name="AddOrUpdate" Id="..." >
    <Declaration><![CDATA[METHOD PUBLIC AddOrUpdate
VAR_INPUT
  Key : T_MAXSTRING;
  Value : ANY;
END_VAR
]]></Declaration>
    <Implementation>
      <ST><![CDATA[rootNode := THIS^.RecursiveInsert(Key, Value, rootNode);
EmitChangedEvent();]]></ST>
    </Implementation>
  </Method>
  
  <Property Name="Count" ...>
    <Declaration><![CDATA[PROPERTY PUBLIC Count : DINT]]></Declaration>
    <Get Name="Get" ...>
      <Declaration><![CDATA[VAR
  NodeCount : DINT;
END_VAR
]]></Declaration>
      <Implementation>
        <ST><![CDATA[RecursiveCountNodes(rootNode, NodeCount);
Count := NodeCount;]]></ST>
      </Implementation>
    </Get>
  </Property>
</POU>
```

### How the extracted source should look (for parser)

```
FUNCTION_BLOCK Dictionary EXTENDS Disposable IMPLEMENTS I_Dictionary
VAR
  eventEmitter : EventEmitter;
  rootNode : I_DictionaryTreeNode;
END_VAR

METHOD PUBLIC AddOrUpdate
VAR_INPUT
  Key : T_MAXSTRING;
  Value : ANY;
END_VAR
rootNode := THIS^.RecursiveInsert(Key, Value, rootNode);
EmitChangedEvent();
END_METHOD

METHOD PRIVATE Balance : I_DictionaryTreeNode
VAR_INPUT
  Node : I_DictionaryTreeNode;
END_VAR
VAR
  balanceFactor : DINT;
END_VAR
balanceFactor := THIS^.GetBalanceFactor(Node);
(* ... more body ... *)
END_METHOD

PROPERTY PUBLIC Count : DINT
VAR
  NodeCount : DINT;
END_VAR
RecursiveCountNodes(rootNode, NodeCount);
Count := NodeCount;
END_PROPERTY

END_FUNCTION_BLOCK
```

The parser (`parseFunctionBlockDeclaration`) already handles this structure: it parses VAR blocks, then in a loop parses body statements, METHOD blocks, and PROPERTY blocks until END_FUNCTION_BLOCK.

### Relevant Files

| File | Role | Change needed |
|------|------|--------------|
| `server/src/twincat/tcExtractor.ts` | CDATA extraction | **Major**: Add method/property extraction, synthetic END_FUNCTION_BLOCK |
| `server/src/handlers/semanticTokens.ts` | Semantic tokens | **Medium**: Replace `comment` → `xmlMarkup` token type for XML regions |
| `server/src/handlers/foldingRange.ts` | Folding ranges | **Small**: Change XML wrapper kind to `Imports` |
| `client/package.json` | Extension manifest | **Medium**: Add `semanticTokenTypes`, `semanticTokenScopes`, `configurationDefaults` |
| `server/src/__tests__/tcExtractor.test.ts` | Extractor tests | **Major**: Add method/property extraction tests |
| `server/src/__tests__/semanticTokens.test.ts` | Token tests | Update for new token type |
| `server/src/__tests__/foldingRange.test.ts` | Folding tests | Update for Imports kind |
| `tests/fixtures/mobject-core-src/src/sln/lib/mobject-core/mobject-collections/Dictionary/Dictionary.TcPOU` | Test fixture | Read-only reference |

### Key Functions/Classes

- `extractTopLevelCDATAs()` in tcExtractor.ts: Main extraction function — needs method/property branches
- `buildResult()` in tcExtractor.ts: Combines CDATAs into ExtractionResult — needs compound section handling
- `collectXmlCommentTokens()` in semanticTokens.ts: Emits XML tokens as `comment` — change to `xmlMarkup`
- `handleFoldingRangesXml()` in foldingRange.ts: Assigns `FoldingRangeKind.Region` to XML — change to `Imports`
- `parseFunctionBlockDeclaration()` in parser.ts: Already handles METHOD/PROPERTY within FB — no changes needed

### Dependencies

- `vscode-languageserver`: SemanticTokensBuilder, FoldingRangeKind
- Parser already supports METHOD, PROPERTY, ACTION within FUNCTION_BLOCK

### Patterns & Conventions

- Case-insensitive identifier comparison via `.toUpperCase()`
- Regex-based XML parsing (no XML parser dependency)
- Extraction sections (`ExtractedSection[]`) drive semantic tokens — each section is lexed independently
- `lineMap[extractedLine] = originalLine` drives position remapping for diagnostics/folding
- Tests use vitest with `makeDoc()` helpers

---

## Implementation Phases

### Phase 1: Fix XML Dimming Color (Green → Barely Visible)

**Objective:** XML wrapper regions in TcPOU files should be rendered in a very dim, barely-visible color instead of theme-default green.

**Files to Modify:**
- `server/src/handlers/semanticTokens.ts`: Add `'xmlMarkup'` to `TOKEN_TYPES` array (index 12), add `TT_XML_MARKUP = 12` constant, change `collectXmlCommentTokens()` to use `TT_XML_MARKUP` instead of `TT_COMMENT`
- `client/package.json`: Add contributes sections for custom token type and dim styling

**Steps:**

1. In `server/src/handlers/semanticTokens.ts`:
   - Add `'xmlMarkup'` as the last entry in the `TOKEN_TYPES` array (becomes index 12)
   - Add constant: `const TT_XML_MARKUP = 12;`
   - In `collectXmlCommentTokens()`, change `tokenType: TT_COMMENT` to `tokenType: TT_XML_MARKUP`

2. In `client/package.json`, add to the `contributes` section:
   ```json
   "semanticTokenTypes": [
     {
       "id": "xmlMarkup",
       "superType": "comment",
       "description": "XML wrapper markup in TwinCAT source files"
     }
   ],
   "semanticTokenScopes": [
     {
       "language": "iec-st",
       "scopes": {
         "xmlMarkup": ["comment.block.xml"]
       }
     }
   ],
   "configurationDefaults": {
     "editor.semanticTokenColorCustomizations": {
       "rules": {
         "xmlMarkup:iec-st": {
           "foreground": "#3e3e3e",
           "fontStyle": ""
         }
       }
     }
   }
   ```

3. Update `server/src/__tests__/semanticTokens.test.ts`: Any test assertions checking for `comment` token type on XML regions should now expect `xmlMarkup` (index 12 instead of 9).

**Tests to Write/Update:**
- Update existing TcPOU semantic token test to verify XML regions emit token type index 12 instead of 9
- Verify ST comments still use token type index 9 (`comment`)

**Acceptance Criteria:**
- [ ] XML wrapper lines in TcPOU files render in very dim color (#3e3e3e or similar)
- [ ] Actual ST comments (`(* ... *)`, `//`) still render as normal `comment` tokens
- [ ] Extension manifest declares `xmlMarkup` semantic token type
- [ ] Default color customization applied for `iec-st` language
- [ ] Existing semantic token tests pass (with updated assertions)

---

### Phase 2: Enable Auto-Folding of XML Wrapper Regions

**Objective:** When opening a TcPOU/TcGVL/TcDUT/TcIO file, XML wrapper regions should be automatically collapsed.

**Files to Modify:**
- `server/src/handlers/foldingRange.ts`: Change XML wrapper fold kind from `Region` to `Imports`
- `client/package.json`: Add `editor.foldingImportsByDefault` per-language default

**Steps:**

1. In `server/src/handlers/foldingRange.ts`, function `handleFoldingRangesXml()`:
   - Change the XML wrapper fold creation from:
     ```typescript
     ranges.push({ startLine: foldStart, endLine: foldEnd, kind: FoldingRangeKind.Region });
     ```
     to:
     ```typescript
     ranges.push({ startLine: foldStart, endLine: foldEnd, kind: FoldingRangeKind.Imports });
     ```

2. In `client/package.json`, extend the `configurationDefaults` (from Phase 1) to include:
   ```json
   "configurationDefaults": {
     "[iec-st]": {
       "editor.foldingImportsByDefault": true
     },
     "editor.semanticTokenColorCustomizations": { ... }
   }
   ```

3. Update `server/src/__tests__/foldingRange.test.ts`: Any assertions checking `FoldingRangeKind.Region` for XML wrapper ranges should now check for `FoldingRangeKind.Imports`.

**Tests to Write/Update:**
- Update TcPOU folding test: XML wrapper ranges should have `kind: FoldingRangeKind.Imports`
- ST-level fold ranges (IF/FOR/VAR) should still have `kind: FoldingRangeKind.Region`

**Acceptance Criteria:**
- [ ] XML wrapper regions in TcPOU files are auto-collapsed on file open
- [ ] ST-internal folds (IF, FOR, VAR blocks) remain manually collapsible (not auto-collapsed)
- [ ] `editor.foldingImportsByDefault` is set to `true` only for `iec-st` language
- [ ] Folding tests pass with updated assertions

---

### Phase 3: Extract Method CDATAs from TcPOU Files

**Objective:** All `<Method>` elements within a POU are extracted, their Declaration and Implementation CDATAs combined into the full extracted source with correct lineMap entries, and proper `END_METHOD` synthetic lines added.

**Files to Modify:**
- `server/src/twincat/tcExtractor.ts`: Add `extractMethodCDATAs()` function, update `extractTopLevelCDATAs()` and `buildResult()`

**Steps:**

1. **Add `extractMethodCDATAs()` function** in `tcExtractor.ts`:
   - Similar pattern to existing `extractActionCDATAs()`
   - Use regex to find all `<Method\b([^>]*)>` tags within the POU body
   - Extract `Name` attribute from each `<Method>`
   - For each method:
     a. Extract the `<Declaration>` CDATA (contains `METHOD PUBLIC Name\nVAR_INPUT\n...\nEND_VAR`)
     b. Extract the `<Implementation><ST>` CDATA (contains body statements)
     c. Record both CDATAs with their original-file line positions
   - Return an array of structured method data (not plain RawCData — see below)

2. **Introduce a structured method/property extraction result:**
   ```typescript
   interface RawMethodData {
     decl: RawCData;           // Declaration CDATA
     impl: RawCData | null;    // Implementation CDATA (may be absent for abstract methods)
     closingTagLine: number;   // Line of </Method> in original file (for END_METHOD mapping)
   }
   ```

3. **Update `extractTopLevelCDATAs()` to call `extractMethodCDATAs()`:**
   ```typescript
   if (containerTagName.toUpperCase() === 'POU') {
     const methodResults = extractMethodCDATAs(xml, body, containerStart);
     // Store separately, don't push to RawCData[] directly
     const actionResults = extractActionCDATAs(xml, body, containerStart);
     // ...
   }
   ```

4. **Restructure `buildResult()` to handle compound sections:**
   
   The combined `source` output must place methods **inside** the FB block (between body and END_FUNCTION_BLOCK) for the parser to handle them correctly. The new build flow:

   a. Output top-level Declaration content (FB/PROGRAM declaration + vars)
   b. Output top-level Implementation content (body statements)
   c. For each method:
      - Output Declaration CDATA content (starts with METHOD..., includes VAR blocks)
      - Map each line to its original file position via `decl.startLine + i`
      - Output Implementation CDATA content (body statements)
      - Map each line via `impl.startLine + i`
      - Output synthetic `END_METHOD` line
      - Map to `closingTagLine`
   d. Add synthetic `END_FUNCTION_BLOCK` line (mapped to the `</POU>` line or last line before it)
   e. Output any actions (after END_FUNCTION_BLOCK, as currently done)

   **No separator blank line** between a method's Declaration and Implementation sections (they form one continuous METHOD block). Separators are added between methods.

5. **Update `sections` array for semantic tokens:**
   
   Each method contributes TWO `ExtractedSection` entries to `sections`:
   - One for the Declaration CDATA (with correct `startLine`/`startChar`)
   - One for the Implementation CDATA (with correct `startLine`/`startChar`)
   
   This is critical because `collectStSectionTokens()` uses `section.startLine + localLine` for position mapping. Each section must correspond to a contiguous CDATA region with consistent offset.

6. **Handle the `END_METHOD` and `END_FUNCTION_BLOCK` synthetic lines in sections:**
   
   Synthetic lines (END_METHOD, END_FUNCTION_BLOCK) are NOT CDATA content — they don't have semantic token sections. They only exist in the combined `source` for the parser. They're in `lineMap` but not in `sections`. The semantic tokens handler's `getXmlRanges()` will classify these positions as XML (since they're not inside any CDATA), and they'll get `xmlMarkup` tokens from the XML range pass. This is correct behavior — they're synthetic, so dimming them is fine.

   Wait — actually, END_METHOD is part of the extracted source but NOT in any CDATA. The `getXmlRanges()` function in the original text will see the `</Method>` closing tag as XML, which is correct. The synthetic `END_METHOD` text doesn't exist in the original file at all, so it won't be covered by any CDATA or XML range from `getXmlRanges()`.

   **Resolution:** Synthetic lines exist only in the combined `source` for parsing. They have `lineMap` entries pointing to the original XML line (e.g., `</Method>` line). For semantic tokens, `getXmlRanges()` runs on the **original text**, not the extracted source. The original text has `</Method>` at that position, which IS in an XML range, so it will get `xmlMarkup` tokens. The synthetic END_METHOD in the extracted source contributes nothing extra to semantic tokens — it's handled by the normal XML range logic.

**Tests to Write:**
- `server/src/__tests__/tcExtractor.test.ts`: Test `extractST()` with Dictionary.TcPOU-like content:
  - Verify `source` contains METHOD...END_METHOD blocks for each method
  - Verify `source` contains END_FUNCTION_BLOCK
  - Verify `lineMap` correctly maps method lines back to original positions
  - Verify `sections` contains entries for each method Declaration and Implementation CDATA
  - Verify `sections[i].startLine` and `sections[i].startChar` are correct

**Acceptance Criteria:**
- [ ] `extractST()` with a TcPOU containing methods returns combined source with METHOD...END_METHOD blocks
- [ ] Combined source is parseable: `parse(result.source)` produces a `FunctionBlockDeclaration` with `methods[]` populated
- [ ] `lineMap` entries for method lines map back to correct original-file positions
- [ ] `sections` array includes separate entries for each method's Declaration and Implementation CDATAs
- [ ] `getXmlRanges()` still correctly identifies XML vs CDATA boundaries (no change needed)
- [ ] All existing tcExtractor tests still pass
- [ ] Semantic tokens handler (`handleSemanticTokensXml`) correctly highlights method code without any changes to semanticTokens.ts
- [ ] Hover/completion/definition/diagnostics work for variables declared inside methods

---

### Phase 4: Extract Property CDATAs from TcPOU Files

**Objective:** All `<Property>` elements within a POU are extracted, including their `<Get>` and `<Set>` accessor CDATAs.

**Files to Modify:**
- `server/src/twincat/tcExtractor.ts`: Add `extractPropertyCDATAs()` function, update `extractTopLevelCDATAs()` and `buildResult()`

**Steps:**

1. **Add `extractPropertyCDATAs()` function** in `tcExtractor.ts`:
   - Find all `<Property\b([^>]*)>` tags within POU body
   - For each property:
     a. Extract the `<Declaration>` CDATA (contains `PROPERTY PUBLIC Name : Type`)
     b. Find `<Get>` element:
        - Extract its `<Declaration>` CDATA (local vars like `VAR\n...\nEND_VAR`)
        - Extract its `<Implementation><ST>` CDATA (getter body)
     c. Find `<Set>` element (if present):
        - Extract its `<Declaration>` CDATA (local vars)
        - Extract its `<Implementation><ST>` CDATA (setter body)
     d. Record all CDATAs with original-file line positions

2. **Introduce structured property extraction result:**
   ```typescript
   interface RawPropertyData {
     decl: RawCData;                // PROPERTY declaration CDATA
     getDecl: RawCData | null;      // Get accessor local vars
     getImpl: RawCData | null;      // Get accessor body
     setDecl: RawCData | null;      // Set accessor local vars  
     setImpl: RawCData | null;      // Set accessor body
     closingTagLine: number;        // Line of </Property>
   }
   ```

3. **Combine property CDATAs in `buildResult()`:**

   The parser's `parsePropertyDeclaration()` skips everything between PROPERTY and END_PROPERTY, so the exact internal structure doesn't need to match any specific format. The extracted source should be:
   ```
   PROPERTY PUBLIC Count : DINT
   VAR
     NodeCount : DINT;
   END_VAR
   RecursiveCountNodes(rootNode, NodeCount);
   Count := NodeCount;
   END_PROPERTY
   ```

   Build flow for each property:
   a. Output property Declaration content (`PROPERTY PUBLIC Count : DINT`)
   b. Output Get Declaration content (local vars) — no separator
   c. Output Get Implementation content (getter body) — no separator
   d. If Set exists: output Set Declaration + Implementation similarly
   e. Output synthetic `END_PROPERTY`
   f. Map each line to correct original position via respective startLine values

4. **Update `sections` for semantic tokens:**
   Each property contributes up to 5 `ExtractedSection` entries:
   - Property declaration CDATA
   - Get declaration CDATA (vars)
   - Get implementation CDATA (body)
   - Set declaration CDATA (vars) — if present
   - Set implementation CDATA (body) — if present

5. **Integrate into `extractTopLevelCDATAs()`:**
   ```typescript
   if (containerTagName.toUpperCase() === 'POU') {
     const methodResults = extractMethodCDATAs(xml, body, containerStart);
     const propertyResults = extractPropertyCDATAs(xml, body, containerStart);
     const actionResults = extractActionCDATAs(xml, body, containerStart);
   }
   ```

**Tests to Write:**
- `server/src/__tests__/tcExtractor.test.ts`: Test with Dictionary.TcPOU-like property content:
  - Verify PROPERTY...END_PROPERTY in combined source
  - Verify lineMap for property lines
  - Verify sections for property CDATAs (declaration, get-vars, get-body)

**Acceptance Criteria:**
- [ ] `extractST()` with properties returns combined source including PROPERTY...END_PROPERTY blocks
- [ ] Parser produces `FunctionBlockDeclaration` with `properties[]` populated
- [ ] Getter/setter code is highlighted by semantic tokens
- [ ] All existing tests pass

---

### Phase 5: Integration Tests with Dictionary.TcPOU

**Objective:** Verify end-to-end behavior using the Dictionary.TcPOU fixture file across multiple LSP features.

**Files to Create/Modify:**
- `server/src/__tests__/tcExtractor.test.ts`: Add comprehensive Dictionary.TcPOU test
- `server/src/__tests__/semanticTokens.test.ts`: Add method/property token tests
- `server/src/__tests__/foldingRange.test.ts`: Add method/property folding tests

**Steps:**

1. **TcExtractor integration test:**
   - Read Dictionary.TcPOU fixture file
   - Call `extractST(content, '.tcpou')`
   - Assert: all 25+ methods appear in `source` (search for each METHOD name)
   - Assert: both properties (Count, IsEmpty) appear in `source`
   - Assert: `source` contains exactly one `END_FUNCTION_BLOCK`
   - Assert: `sections.length` covers all CDATAs (2 per method + up to 5 per property + top-level)
   - Assert: `parse(result.source)` produces no critical errors
   - Assert: the parsed FB has `methods.length >= 25` and `properties.length >= 2`

2. **Semantic tokens test with methods:**
   - Create a minimal TcPOU with one method
   - Verify method keywords (METHOD, END_METHOD, VAR_INPUT, END_VAR) get `keyword` token type
   - Verify method body identifiers get appropriate token types
   - Verify XML between methods gets `xmlMarkup` token type

3. **Folding range test with methods:**
   - Verify XML ranges around methods get `FoldingRangeKind.Imports`
   - Verify VAR blocks inside methods get fold ranges
   - Verify IF/FOR/WHILE inside methods get fold ranges (via lineMap remapping)

**Acceptance Criteria:**
- [ ] Dictionary.TcPOU extracts all methods and properties
- [ ] Parsed AST has correct method and property counts
- [ ] Semantic tokens cover method/property code correctly
- [ ] Folding ranges work for method-internal structures
- [ ] All tests pass: `npm run test` in server workspace

---

## Open Questions

1. **Property accessor syntax in extracted source?**
   - **Option A:** Flatten: `PROPERTY name : type / VAR... / body... / END_PROPERTY` (simpler, parser skips content anyway)
   - **Option B:** Full syntax: `PROPERTY name : type / GET / VAR... / body... / END_GET / END_PROPERTY`
   - **Recommendation:** Option A — the parser's `parsePropertyDeclaration()` skips everything between PROPERTY and END_PROPERTY, so the internal structure doesn't matter for parsing. For semantic tokens, each CDATA is processed independently via sections. Option A is simpler and has fewer synthetic lines to manage.

2. **Ordering of methods/properties in extracted source?**
   - **Option A:** XML document order (as they appear in the TcPOU file)
   - **Option B:** Alphabetical
   - **Recommendation:** Option A — preserves document order which gives stable lineMap entries and matches user expectation.

3. **Handling abstract methods (no Implementation CDATA)?**
   - Abstract methods may have Declaration but no Implementation or an empty one
   - **Recommendation:** Handle gracefully — if Implementation CDATA is null/empty, output just Declaration + END_METHOD.

4. **What about `<Folder>` elements in TcPOU?**
   - Some methods/properties have `FolderPath="Private\"` attributes for organizational folders
   - `<Folder>` elements define the folder structure
   - **Recommendation:** Ignore `<Folder>` elements — they're purely organizational. Extract methods/properties regardless of folder structure.

## Risks & Mitigation

- **Risk:** Combined source with many methods may have lineMap inconsistencies causing incorrect diagnostic positions
  - **Mitigation:** Thorough lineMap testing with Dictionary.TcPOU; verify diagnostic positions for at least 3 methods at different positions in the file

- **Risk:** `buildResult()` restructuring may break existing action extraction
  - **Mitigation:** Keep existing action tests; run all tests after each modification

- **Risk:** Large TcPOU files (100+ methods) may slow down semantic token computation
  - **Mitigation:** Profile with Dictionary.TcPOU (25 methods); the current per-section lexing approach should scale linearly

- **Risk:** The `configurationDefaults` for `editor.semanticTokenColorCustomizations` may conflict with user's existing customizations
  - **Mitigation:** Extension defaults are lowest priority — user settings override them

## Success Criteria

- [ ] XML wrapper in TcPOU files renders barely visible (dim gray, not green)
- [ ] XML wrapper auto-folds when opening TcPOU files
- [ ] All methods in Dictionary.TcPOU get full LSP support (semantic tokens, hover, completion, diagnostics)
- [ ] All properties in Dictionary.TcPOU get full LSP support
- [ ] Existing tests continue to pass
- [ ] New tests cover method/property extraction and token generation

## Notes for Atlas

- **Phase order matters:** Phase 1 and 2 are independent quick wins. Phase 3 is the most critical and complex. Phase 4 builds on Phase 3's patterns. Phase 5 validates everything.
- **Do NOT change the parser** — it already handles METHOD/PROPERTY within FUNCTION_BLOCK correctly.
- **The `getXmlRanges()` function needs NO changes** — it already finds all CDATA sections in the file regardless of depth.
- **The semantic tokens handler needs minimal changes** (only Phase 1 token type rename). The method/property code will be automatically handled once extraction works, because `sections` entries drive per-section lexing.
- **Handlers that already use `extractStFromTwinCAT()`** (hover, completion, definition, diagnostics, inlayHints) will automatically benefit from the extraction improvements with no handler-side changes.
- **Test with the actual Dictionary.TcPOU file** at `tests/fixtures/mobject-core-src/src/sln/lib/mobject-core/mobject-collections/Dictionary/Dictionary.TcPOU` — it has 25 methods and 2 properties and exercises all the edge cases (private methods in folders, properties with only getters, empty implementation bodies).
- **The `configurationDefaults` in `client/package.json` must define per-language settings using `[iec-st]` notation** for `editor.foldingImportsByDefault`. The `editor.semanticTokenColorCustomizations` is applied globally but scoped via the `:iec-st` suffix in the rule selector.
