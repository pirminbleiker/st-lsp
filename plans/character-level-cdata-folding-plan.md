# Plan: Character-Level CDATA Folding for TcPOU Files

**Created:** 2026-02-28  
**Status:** Ready for Atlas Execution

## Summary

Upgrade TcPOU XML wrapper folding from line-level to **character-level** precision. Currently, folding operates at line granularity, which leaves XML markup visible on lines that mix XML tags with CDATA content (e.g., `<Declaration><![CDATA[{attribute 'linkalways'}`). The LSP `FoldingRange` type supports `startCharacter`, `endCharacter`, and `collapsedText` (since LSP 3.17.0). By using these fields, we can fold **exactly** the XML portions — including partial lines — so only the CDATA content (ST code) is visible when folds are collapsed.

## Context & Analysis

### Current Behavior (screenshot shows the problem)

```
Line 1:  > <?xml version="1.0" encoding="utf-8"?>…        ← folded (good)
Line 4:      <Declaration><![CDATA[{attribute 'linkalways'}  ← XML prefix VISIBLE (bad)
...
Line 12: ]]></Declaration>…                                  ← XML visible (bad)
Line 14: >     <ST><![CDATA[]]></ST>…                        ← XML visible (bad)
Line 19:     <Declaration><![CDATA[METHOD PUBLIC AddOrUpdate  ← XML prefix VISIBLE (bad)
...
Line 24: ]]></Declaration>                                   ← XML visible (bad)
```

### Desired Behavior

```
Line 1:  …{attribute 'linkalways'}            ← preamble XML folded inline, only ST visible
...
Line 11: END_VAR
Line 12: …METHOD PUBLIC AddOrUpdate            ← inter-section XML folded inline
...
```

Every character outside `<![CDATA[` ... `]]>` boundaries is folded away. The user sees only ST content with `…` collapse indicators for the hidden XML.

### How `getXmlRanges()` Already Provides Character-Level Ranges

The existing `getXmlRanges(text)` function in `tcExtractor.ts` already returns **character-level** ranges covering all text outside CDATA content:

```typescript
export interface XmlRange {
  start: { line: number; character: number };
  end: { line: number; character: number };
}
```

Each range spans from a `]]>` position (or file start) to the position right after the next `<![CDATA[` (or file end). These are **exactly** the regions we want to fold.

### LSP `FoldingRange` Character-Level Support

`vscode-languageserver-types` (installed version) supports:

```typescript
export interface FoldingRange {
    startLine: uinteger;
    startCharacter?: uinteger;  // ← fold starts here (content before is visible)
    endLine: uinteger;
    endCharacter?: uinteger;    // ← fold ends here (content after is visible)
    kind?: FoldingRangeKind;
    collapsedText?: string;     // ← shown when collapsed (e.g., "…")
}
```

When `startCharacter` is set: text before that position on `startLine` remains visible.  
When `endCharacter` is set: text from that position onward on `endLine` remains visible.

### Client Capability: `lineFoldingOnly`

VS Code sends `textDocument.foldingRange.lineFoldingOnly` in `InitializeParams.capabilities`. If `true`, the client ignores `startCharacter` and `endCharacter`. We should check this capability and fall back to line-level folding if the client doesn't support character-level folds. VS Code (since ~1.87) supports character-level folds, so modern VS Code versions will have `lineFoldingOnly: false` or undefined.

### Relevant Files

| File | Role | Change |
|------|------|--------|
| `server/src/handlers/foldingRange.ts` | Folding range handler | **Major**: Emit character-level folds with `startCharacter`, `endCharacter`, `collapsedText` |
| `server/src/server.ts` | LSP capability registration | **Small**: Store `lineFoldingOnly` from client capabilities, pass to handler |
| `server/src/__tests__/foldingRange.test.ts` | Folding tests | **Major**: Update all TcPOU fold assertions for character-level ranges |
| `server/src/twincat/tcExtractor.ts` | XML range provider | **None**: `getXmlRanges()` already returns character-level data |
| `client/package.json` | Extension config | **None**: `editor.foldingImportsByDefault` already set |

### Key Functions

- `getXmlRanges(text)` in tcExtractor.ts → Already returns `XmlRange[]` with character-level `{line, character}` positions
- `handleFoldingRangesXml()` in foldingRange.ts → Currently discards character info: `const foldStart = xmlRange.start.line` — needs to use `.character` too
- `handleFoldingRanges()` in foldingRange.ts → Entry point, needs access to `lineFoldingOnly` flag
- Server `onInitialize` in server.ts → Needs to extract `lineFoldingOnly` from client capabilities

---

## Implementation Phases

### Phase 1: Character-Level XML Folding in `foldingRange.ts`

**Objective:** Emit character-level `FoldingRange` objects for XML wrapper regions in TcPOU files. Each XML range from `getXmlRanges()` becomes a single fold with precise `startCharacter` and `endCharacter`.

**Files to Modify:**
- `server/src/handlers/foldingRange.ts`
- `server/src/server.ts`

**Steps:**

1. **In `server/src/server.ts` — Capture `lineFoldingOnly` from client capabilities:**

   ```typescript
   let lineFoldingOnly = false;
   
   connection.onInitialize((params: InitializeParams): InitializeResult => {
     // ...existing code...
     lineFoldingOnly = params.capabilities.textDocument?.foldingRange?.lineFoldingOnly ?? false;
     // ...
   });
   ```

   Pass `lineFoldingOnly` to the handler. The simplest approach: export a getter or pass it via module-level variable. Since `handleFoldingRanges` is called from the server module, the cleanest approach is to add a parameter or use module-level state.
   
   **Recommended approach:** Add a `lineFoldingOnly` parameter to `handleFoldingRanges()`:
   ```typescript
   export function handleFoldingRanges(
     document: TextDocument | undefined,
     lineFoldingOnly?: boolean,
   ): FoldingRange[]
   ```
   
   Update the call site in `server.ts`:
   ```typescript
   connection.onFoldingRanges((params) => {
     const document = documents.get(params.textDocument.uri);
     return handleFoldingRanges(document, lineFoldingOnly);
   });
   ```

2. **In `server/src/handlers/foldingRange.ts` — Emit character-level folds for XML ranges:**

   Replace the current line-level XML fold logic:
   ```typescript
   // OLD (line-level)
   for (const xmlRange of getXmlRanges(text)) {
     const foldStart = xmlRange.start.line;
     const foldEnd   = xmlRange.end.line - 1;
     if (foldEnd > foldStart) {
       ranges.push({ startLine: foldStart, endLine: foldEnd, kind: FoldingRangeKind.Imports });
     }
   }
   ```
   
   With character-level folds:
   ```typescript
   // NEW (character-level with fallback)
   for (const xmlRange of getXmlRanges(text)) {
     const { start, end } = xmlRange;
     
     if (lineFoldingOnly) {
       // Fallback: line-level fold (skip lines that have CDATA content)
       const foldStart = start.line;
       const foldEnd = end.line - 1;
       if (foldEnd > foldStart) {
         ranges.push({ startLine: foldStart, endLine: foldEnd, kind: FoldingRangeKind.Imports });
       }
     } else {
       // Character-level fold: fold exactly the XML portion
       // Check fold validity: must span at least SOMETHING
       if (start.line < end.line || (start.line === end.line && start.character < end.character)) {
         ranges.push({
           startLine: start.line,
           startCharacter: start.character,
           endLine: end.line,
           endCharacter: end.character,
           kind: FoldingRangeKind.Imports,
           collapsedText: '…',
         });
       }
     }
   }
   ```

3. **Handle the `collapsedText`:**
   - Use `'…'` (unicode ellipsis U+2026) for a clean single-character indicator
   - The `collapsedText` property is since LSP 3.17.0 and is supported by `vscode-languageserver-types` v3.17+

**Tests to Write/Update:**
- Update existing TcPOU fold tests to check for `startCharacter` and `endCharacter`
- Add test: preamble fold has `startCharacter: 0` and `endCharacter` pointing after `<![CDATA[`
- Add test: inter-section fold has `startCharacter` pointing at `]]>` position and `endCharacter` after the next `<![CDATA[`
- Add test: `collapsedText` is `'…'`
- Add test: with `lineFoldingOnly=true`, falls back to line-level folds (no `startCharacter`/`endCharacter`)

**Acceptance Criteria:**
- [ ] XML wrapper folds include `startCharacter` and `endCharacter` matching the `getXmlRanges()` positions
- [ ] Each XML fold has `collapsedText: '…'`
- [ ] Each XML fold has `kind: FoldingRangeKind.Imports` (auto-collapse)
- [ ] When `lineFoldingOnly` is true, falls back to previous line-level behavior
- [ ] ST-internal folds (IF, FOR, VAR) remain line-level with no `startCharacter`/`endCharacter`
- [ ] All existing tests updated and passing

---

### Phase 2: Merge Adjacent XML Ranges Around Empty CDATAs

**Objective:** When two XML ranges are separated only by empty CDATA content (like the empty `<Implementation><ST><![CDATA[]]></ST></Implementation>` in Dictionary.TcPOU), merge them into a single fold for cleaner UX. Without merging, empty CDATAs create two adjacent `…` markers that look like a glitch.

**Files to Modify:**
- `server/src/handlers/foldingRange.ts` (merge logic in the fold-generation loop)

**Steps:**

1. **Post-process XML ranges before emitting folds:**
   
   After getting XML ranges, check consecutive pairs: if the CDATA content between range N (ending at position A) and range N+1 (starting at position B) is empty or whitespace-only, merge them into one range.
   
   ```typescript
   function mergeAdjacentXmlRanges(text: string, xmlRanges: XmlRange[]): XmlRange[] {
     if (xmlRanges.length <= 1) return xmlRanges;
     
     const merged: XmlRange[] = [xmlRanges[0]];
     
     for (let i = 1; i < xmlRanges.length; i++) {
       const prev = merged[merged.length - 1];
       const curr = xmlRanges[i];
       
       // Text between prev.end and curr.start is the CDATA content between them
       // If it's empty/whitespace, merge the ranges
       const gapStart = positionToOffset(text, prev.end);
       const gapEnd = positionToOffset(text, curr.start);
       const gapText = text.slice(gapStart, gapEnd);
       
       if (gapText.trim() === '') {
         // Merge: extend prev to cover curr
         merged[merged.length - 1] = { start: prev.start, end: curr.end };
       } else {
         merged.push(curr);
       }
     }
     
     return merged;
   }
   ```
   
   Add a helper `positionToOffset()` that converts `{line, character}` back to a byte offset:
   ```typescript
   function positionToOffset(text: string, pos: { line: number; character: number }): number {
     let line = 0;
     let i = 0;
     while (i < text.length && line < pos.line) {
       if (text[i] === '\n') line++;
       i++;
     }
     return i + pos.character;
   }
   ```

2. **Use merged ranges in the fold-generation loop:**
   ```typescript
   const xmlRanges = mergeAdjacentXmlRanges(text, getXmlRanges(text));
   for (const xmlRange of xmlRanges) {
     // ... emit character-level folds as in Phase 1
   }
   ```

**Tests to Write:**
- Test with TcPOU that has an empty Implementation CDATA (like Dictionary.TcPOU): verify the fold from `]]></Declaration>` through `<![CDATA[]]></ST>` to the next `<![CDATA[` is ONE fold, not two
- Test that non-empty CDATAs are NOT merged (they remain separate folds)
- Test with multiple consecutive empty CDATAs

**Acceptance Criteria:**
- [ ] Empty CDATAs between XML ranges don't create redundant fold markers
- [ ] Non-empty CDATAs remain as separate visible regions between folds
- [ ] Folding ranges count is reduced for TcPOU files with empty Implementation bodies

---

### Phase 3: Update Tests and Validate with Dictionary.TcPOU

**Objective:** Comprehensive test coverage for the new character-level folding behavior.

**Files to Modify:**
- `server/src/__tests__/foldingRange.test.ts`
- `server/src/__tests__/tcExtractor.test.ts` (update Dictionary.TcPOU integration test for folding)

**Steps:**

1. **Update existing TcPOU fold tests in `foldingRange.test.ts`:**
   
   The test fixture:
   ```
   Line 0: <?xml version="1.0" encoding="utf-8"?>
   Line 1: <TcPlcObject>
   Line 2:   <POU Name="Foo">
   Line 3:     <Declaration><![CDATA[
   Line 4: FUNCTION_BLOCK Foo
   ...
   Line 8: ]]></Declaration>
   Line 9:     <Implementation>
   Line 10:      <ST><![CDATA[x := 1;]]></ST>
   Line 11:    </Implementation>
   Line 12:  </POU>
   Line 13: </TcPlcObject>
   ```
   
   Expected character-level folds:
   - **Preamble fold**: `startLine: 0, startCharacter: 0, endLine: 3, endCharacter: <after_CDATA_open>` — folds from file start to right after `<![CDATA[` on line 3
   - **Inter-section fold**: from `]]>` on line 8 to after `<![CDATA[` on line 10 — covers `]]></Declaration>` and `<Implementation><ST><![CDATA[`
   - **Postamble fold**: from `]]>` on line 10 (after `x := 1;`) to end of file — covers `]]></ST></Implementation></POU></TcPlcObject>`
   - All have `kind: FoldingRangeKind.Imports` and `collapsedText: '…'`

2. **Update Dictionary.TcPOU integration test:**
   - Verify character-level fold covers the preamble through first `<![CDATA[`
   - Verify `collapsedText` is `'…'`
   - Verify total fold count reflects merged empty CDATAs

3. **Add `lineFoldingOnly` fallback test:**
   - Call `handleFoldingRanges(doc, true)` and verify it produces line-level folds without character offsets

**Acceptance Criteria:**
- [ ] All updated TcPOU fold tests pass with character-level assertions
- [ ] Dictionary.TcPOU integration test validates character-level folds
- [ ] Fallback to line-level folds when `lineFoldingOnly=true`
- [ ] All other tests (ST folds, block comments) continue to pass
- [ ] TypeScript compiles cleanly

---

## Open Questions

1. **What `collapsedText` to show?**
   - **Option A:** `'…'` (single unicode ellipsis) — minimal, clean
   - **Option B:** `'⟨xml⟩'` — informative but takes more horizontal space
   - **Option C:** `''` (empty) — VS Code shows its own default collapse indicator
   - **Recommendation:** Option A (`'…'`) — it's compact and universally understood. The user knows it's XML since they chose to open a `.TcPOU` file.

2. **Should we merge ALL adjacent empty-CDATA ranges or only specific patterns?**
   - **Option A:** Merge any two XML ranges separated by whitespace-only CDATA content
   - **Option B:** Only merge the Implementation→next section pattern
   - **Recommendation:** Option A — it's general and handles all cases (empty Implementation bodies, empty Get/Set accessors, etc.)

3. **What about the `lineFoldingOnly` fallback — should it use the current Phase-2 line-level behavior or something else?**
   - **Recommendation:** Use the exact current behavior (line-level with `Imports` kind). This preserves backward compatibility for older clients.

## Risks & Mitigation

- **Risk:** `lineFoldingOnly` is `true` in the user's VS Code version → character-level folds are silently ignored
  - **Mitigation:** Check the flag at initialization and fall back to line-level folds. VS Code 1.85+ (the minimum engine version in `client/package.json`) should support character-level folds.

- **Risk:** `collapsedText` not supported by the client → fold shows default text instead
  - **Mitigation:** The fold still works correctly, just without the custom `…` indicator. This is a graceful degradation.

- **Risk:** Performance impact from `positionToOffset()` conversion for each merge check
  - **Mitigation:** Only called during fold generation, which happens on document change. Dictionary.TcPOU has ~60 CDATA sections → trivial performance impact.

## Success Criteria

- [ ] Opening Dictionary.TcPOU shows only ST content — all XML markup is auto-folded inline
- [ ] Mixed XML+CDATA lines (like `<Declaration><![CDATA[{attribute 'linkalways'}`) show only the ST part
- [ ] User can click the `…` fold indicator to expand and see the hidden XML
- [ ] Empty Implementation blocks don't create double fold markers
- [ ] Semantic token dimming (xmlMarkup → #404040) still works for expanded XML regions
- [ ] All existing tests pass

## Notes for Atlas

- **Phase order matters:** Phase 1 (character-level folds) must be done first, Phase 2 (merging) refines the output, Phase 3 (tests) validates everything.
- **Do NOT change `getXmlRanges()` in tcExtractor.ts** — it already returns perfect character-level ranges.
- **Do NOT change `semanticTokens.ts`** — the `xmlMarkup` token dimming still works when XML is expanded; it's complementary to folding.
- **The `lineFoldingOnly` parameter must be optional** with a default of `false` so existing callers (tests) don't break.
- **The `handleFoldingRanges` function signature change** requires updating all call sites:
  - `server.ts` (the real call site) — pass `lineFoldingOnly`
  - Test files — no change needed if default is `false`
- For the test fixture in `foldingRange.test.ts`, compute the exact character positions of `<![CDATA[` and `]]>` markers to write precise assertions. Use the fixture string: `'    <Declaration><![CDATA['` — the `<![CDATA[` starts at character 20 and the content starts at character 29 (20 + 9 = 29).
