# Plan: TcPOU XML-Wrapper Folding & Dimming

**Created:** 2026-02-27  
**Status:** Ready for Atlas Execution

## Summary

TwinCAT `.TcPOU` / `.TcGVL` / `.TcDUT` files embed Structured Text inside
`<![CDATA[…]]>` sections wrapped in XML boilerplate. The LSP already extracts
the ST via `extractST()` (tcExtractor.ts) for parsing/diagnostics, but
`foldingRange.ts` and `semanticTokens.ts` still work on the raw text.

This plan adds two features:
1. **Folding** — XML wrapper lines (everything outside CDATA content) become
   collapsible regions. ST-based fold regions (IF/FOR/VAR/… blocks) still work
   but are translated back to original file line numbers.
2. **Dimming** — XML wrapper lines are emitted as `comment`-style semantic
   tokens, which VS Code themes render greyed-out, making the ST code visually
   prominent.

Both changes are self-contained to two files and leverage the existing
`ExtractionResult.lineMap` / `ExtractionResult.sections` data.

---

## Context & Analysis

**Relevant Files:**

| File | Role | Change |
|------|------|--------|
| `server/src/handlers/foldingRange.ts` | Folding range handler | Major: add TcPOU path |
| `server/src/handlers/semanticTokens.ts` | Semantic token handler | Major: add TcPOU path |
| `server/src/twincat/tcExtractor.ts` | CDATA extractor (read-only) | No change — only consumed |
| `server/src/__tests__/foldingRange.test.ts` | Folding tests | Add TcPOU tests |
| `server/src/__tests__/semanticTokens.test.ts` | Semantic token tests | Add TcPOU tests |

**Key Interfaces from `tcExtractor.ts`:**

```ts
interface ExtractionResult {
  source:     string;      // extracted ST code
  lineMap:    number[];    // lineMap[extractedLine] = originalLine
  sections:   ExtractedSection[];
  passthrough: boolean;    // true for plain .st files
}
interface ExtractedSection {
  kind:      'declaration' | 'implementation' | 'action';
  content:   string;
  startLine: number;       // first original line of this section's content
  actionName?: string;
}
function extractST(content: string, ext: string): ExtractionResult
```

**Core Algorithm — "ST lines" vs "XML lines":**

```ts
// All original lines that contain ST content
const stLines = new Set<number>(extraction.lineMap);

// All other lines are XML wrapper → fold / dim them
```

`lineMap` has one entry per extracted-source line (including blank separator
lines). Any original file line NOT present in `stLines` is XML markup.

**TcPOU file structure reference:**

```
line 0:  <?xml version="1.0" …?>
line 1:  <TcPlcObject …>
line 2:    <POU Name="FB_Example" …>
line 3:      <Declaration><![CDATA[          ← XML line → fold/dim
line 4:        FUNCTION_BLOCK FB_Example     ← ST line (startLine=4)
line 5:        VAR_INPUT
line 6:          bEnable : BOOL;
line 7:        END_VAR
line 8:      ]]></Declaration>              ← XML line → fold/dim
line 9:      <Implementation>               ← XML line → fold/dim
line 10:       <ST><![CDATA[               ← XML line → fold/dim
line 11:         IF bEnable THEN            ← ST line (startLine=11)
line 12:           ;
line 13:         END_IF
line 14:       ]]></ST>                     ← XML line → fold/dim
line 15:     </Implementation>              ← XML line → fold/dim
line 16:   </POU>                           ← XML line → fold/dim
line 17: </TcPlcObject>                     ← XML line → fold/dim
```

lineMap = [4, 5, 6, 7, <sep:8>, 11, 12, 13]  
stLines = {4, 5, 6, 7, 8, 11, 12, 13}

XML lines = {0, 1, 2, 3, 9, 10, 14, 15, 16, 17}

Contiguous XML runs → fold regions:
- [0..3]   (preamble + Declaration opening)
- [9..10]  (Implementation + ST opening)
- [14..17] (ST/Implementation/POU closing + TcPlcObject closing)

---

## Implementation Phases

### Phase 1: TcPOU XML-Folding in `foldingRange.ts`

**Objective:**  
When the document is a TcPOU/TcGVL/TcDUT file, add folding regions for all
contiguous XML-wrapper line blocks. Also ensure ST-internal folding (IF/FOR/
VAR/…) still works by translating extracted-source line numbers to original
file coordinates via `lineMap`.

**Files to Modify:**
- `server/src/handlers/foldingRange.ts` — add TcPOU branch in `handleFoldingRanges`

**Files to Modify (tests):**
- `server/src/__tests__/foldingRange.test.ts` — add TcPOU-specific test cases

---

**Step 1 — Add `extractST` import and `path`:**

```ts
import * as path from 'path';
import { extractST, ExtractionResult } from '../twincat/tcExtractor';
```

---

**Step 2 — Refactor `handleFoldingRanges` to branch on file type:**

```ts
export function handleFoldingRanges(document: TextDocument | undefined): FoldingRange[] {
  if (!document) return [];
  const text = document.getText();

  const ext = path.extname(document.uri);
  const extraction = extractST(text, ext);

  if (!extraction.passthrough) {
    return buildTcPouFoldingRanges(text, extraction);
  }

  // ── existing plain-ST path ──────────────────────────────────────────────
  const { ast } = parse(text);
  const ranges: FoldingRange[] = [];
  // ... existing declaration loop ...
  collectBlockComments(text, ranges);
  return ranges;
}
```

---

**Step 3 — Implement `buildTcPouFoldingRanges`:**

```ts
function buildTcPouFoldingRanges(
  text: string,
  extraction: ExtractionResult,
): FoldingRange[] {
  const ranges: FoldingRange[] = [];

  // ── Part A: XML fold regions ───────────────────────────────────────────
  const stLines = new Set<number>(extraction.lineMap);
  const totalLines = text.split('\n').length;

  let runStart = -1;
  for (let i = 0; i <= totalLines; i++) {
    const isXml = i < totalLines && !stLines.has(i);
    if (isXml && runStart === -1) {
      runStart = i;
    } else if (!isXml && runStart !== -1) {
      if (i - 1 > runStart) {          // only fold if ≥2 XML lines
        addRegion(ranges, runStart, i - 1);
      }
      runStart = -1;
    }
  }

  // ── Part B: ST-internal fold regions (translated to original coords) ───
  const { ast } = parse(extraction.source);
  const stRanges: FoldingRange[] = [];

  for (const decl of ast.declarations) {
    switch (decl.kind) {
      case 'ProgramDeclaration':
        addRegion(stRanges, decl.range.start.line, decl.range.end.line);
        collectVarBlocks(decl.varBlocks, stRanges);
        collectStatements(decl.body, stRanges);
        break;
      case 'FunctionBlockDeclaration':
        addRegion(stRanges, decl.range.start.line, decl.range.end.line);
        collectVarBlocks(decl.varBlocks, stRanges);
        collectStatements(decl.body, stRanges);
        for (const m of decl.methods) collectMethod(m, stRanges);
        for (const a of decl.actions) collectAction(a, stRanges);
        for (const p of decl.properties)
          addRegion(stRanges, p.range.start.line, p.range.end.line);
        break;
      case 'FunctionDeclaration':
        addRegion(stRanges, decl.range.start.line, decl.range.end.line);
        collectVarBlocks(decl.varBlocks, stRanges);
        collectStatements(decl.body, stRanges);
        break;
      case 'TypeDeclarationBlock':
        addRegion(stRanges, decl.range.start.line, decl.range.end.line);
        break;
      case 'InterfaceDeclaration':
        addRegion(stRanges, decl.range.start.line, decl.range.end.line);
        for (const m of decl.methods) collectMethod(m, stRanges);
        for (const p of decl.properties)
          addRegion(stRanges, p.range.start.line, p.range.end.line);
        break;
    }
  }

  collectBlockComments(extraction.source, stRanges);

  // Translate extracted line numbers → original file line numbers
  for (const r of stRanges) {
    const origStart = extraction.lineMap[r.startLine];
    const origEnd   = extraction.lineMap[r.endLine];
    if (origStart !== undefined && origEnd !== undefined && origEnd > origStart) {
      ranges.push({ startLine: origStart, endLine: origEnd, kind: r.kind });
    }
  }

  return ranges;
}
```

---

**Tests to Write (`foldingRange.test.ts`):**

```ts
describe('TcPOU folding', () => {
  function makeTcDoc(xml: string): TextDocument {
    return TextDocument.create('file:///FB_Example.TcPOU', 'xml', 1, xml);
  }

  const SIMPLE_TCPOU = [
    '<?xml version="1.0"?>',             // 0  ← XML fold preamble
    '<TcPlcObject>',                      // 1
    '  <POU Name="FB_Ex">',              // 2
    '    <Declaration><![CDATA[',        // 3
    'FUNCTION_BLOCK FB_Ex',              // 4  ← ST content
    'VAR_INPUT',                         // 5
    '  x : INT;',                        // 6
    'END_VAR',                           // 7
    '    ]]></Declaration>',             // 8  ← XML fold inter
    '    <Implementation><ST><![CDATA[', // 9
    'IF x > 0 THEN',                     // 10 ← ST content
    '  x := 1;',                         // 11
    'END_IF',                            // 12
    '    ]]></ST></Implementation>',     // 13 ← XML fold postamble
    '  </POU>',                          // 14
    '</TcPlcObject>',                    // 15
  ].join('\n');

  it('adds fold region for XML preamble (lines 0..3)', () => {
    const ranges = handleFoldingRanges(makeTcDoc(SIMPLE_TCPOU));
    expect(ranges.some(r => r.startLine === 0 && r.endLine === 3)).toBe(true);
  });

  it('adds fold region for inter-section XML (lines 8..9)', () => {
    const ranges = handleFoldingRanges(makeTcDoc(SIMPLE_TCPOU));
    expect(ranges.some(r => r.startLine === 8 && r.endLine === 9)).toBe(true);
  });

  it('adds fold region for XML postamble (lines 13..15)', () => {
    const ranges = handleFoldingRanges(makeTcDoc(SIMPLE_TCPOU));
    expect(ranges.some(r => r.startLine === 13 && r.endLine === 15)).toBe(true);
  });

  it('adds translated ST fold for FUNCTION_BLOCK (lines 4..7)', () => {
    const ranges = handleFoldingRanges(makeTcDoc(SIMPLE_TCPOU));
    // FB declaration spans lines 4-7 in original
    expect(ranges.some(r => r.startLine === 4 && r.endLine === 7)).toBe(true);
  });

  it('adds translated ST fold for IF block (lines 10..12)', () => {
    const ranges = handleFoldingRanges(makeTcDoc(SIMPLE_TCPOU));
    expect(ranges.some(r => r.startLine === 10 && r.endLine === 12)).toBe(true);
  });

  it('plain .st files are unaffected', () => {
    const doc = TextDocument.create('file:///test.st', 'st', 1,
      'PROGRAM Main\nVAR x:INT; END_VAR\nEND_PROGRAM');
    const ranges = handleFoldingRanges(doc);
    expect(ranges.some(r => r.startLine === 0 && r.endLine === 2)).toBe(true);
  });
});
```

**Acceptance Criteria (Phase 1):**
- [ ] XML preamble (lines before first CDATA content) is foldable
- [ ] XML inter-section gap is foldable  
- [ ] XML postamble (lines after last CDATA content) is foldable
- [ ] ST-internal folds (IF/FOR/VAR/…) exist at correct *original file* lines
- [ ] Plain `.st` files: zero change in existing test results
- [ ] All existing `foldingRange.test.ts` tests still pass

---

### Phase 2: TcPOU XML Dimming in `semanticTokens.ts`

**Objective:**  
For TcPOU/TcGVL/etc. files: emit `comment`-style semantic tokens for all XML
wrapper lines so VS Code themes render them greyed-out. Emit normal ST semantic
tokens for CDATA content lines, translated to original file line numbers.

**Files to Modify:**
- `server/src/handlers/semanticTokens.ts` — add TcPOU branch in `handleSemanticTokens`

**Files to Modify (tests):**
- `server/src/__tests__/semanticTokens.test.ts` — add TcPOU test cases

---

**Step 1 — Add `extractST` import and `path`:**

```ts
import * as path from 'path';
import { extractST } from '../twincat/tcExtractor';
```

---

**Step 2 — Refactor `handleSemanticTokens` to branch on file type:**

```ts
export function handleSemanticTokens(document: TextDocument): SemanticTokens {
  const text = document.getText();

  const ext = path.extname(document.uri);
  const extraction = extractST(text, ext);

  if (!extraction.passthrough) {
    return buildTcPouSemanticTokens(text, extraction);
  }

  // ── existing plain-ST path ──────────────────────────────────────────────
  const { ast } = parse(text);
  // ... existing code unchanged ...
}
```

---

**Step 3 — Implement `buildTcPouSemanticTokens`:**

```ts
function buildTcPouSemanticTokens(
  text: string,
  extraction: ExtractionResult,
): SemanticTokens {
  // Run normal ST semantic token logic on the *extracted* source
  const { ast } = parse(extraction.source);
  const nameMap = buildNameMap(ast);
  const stTokens = new Lexer(extraction.source).tokenizeWithTrivia();
  const declSites = buildDeclSites(stTokens);

  // Build a map: originalLine → list of tokens to emit (sorted by char)
  type PendingToken = { char: number; length: number; type: number; mod: number };
  const byOriginalLine = new Map<number, PendingToken[]>();

  for (const tok of stTokens) {
    const extractedLine = tok.range.start.line;
    const origLine = extraction.lineMap[extractedLine];
    if (origLine === undefined) continue;

    const char = tok.range.start.character;
    // Compute length: for single-line tokens only
    const spanLines = tok.range.end.line - tok.range.start.line;
    const length = spanLines === 0
      ? tok.range.end.character - char
      : tok.text.split('\n')[0].length;  // first line of multi-line token
    if (length <= 0) continue;

    // Determine token type + modifiers (same logic as existing handler)
    let tokenType = -1;
    let modifiers = 0;

    switch (tok.kind) {
      case TokenKind.INTEGER:
      case TokenKind.REAL:
        tokenType = TT_NUMBER;
        break;
      case TokenKind.STRING:
        tokenType = TT_STRING;
        break;
      case TokenKind.COMMENT:
        tokenType = TT_COMMENT;
        break;
      default:
        if (KEYWORD_KINDS.has(tok.kind)) {
          tokenType = TT_KEYWORD;
        } else if (tok.kind === TokenKind.IDENTIFIER) {
          const upper = tok.text.toUpperCase();
          const isDecl = declSites.has(`${extractedLine}:${char}`);
          modifiers = isDecl ? MOD_DECLARATION : 0;
          if (findBuiltinType(upper)) {
            tokenType = TT_TYPE; modifiers |= MOD_DEFAULT_LIB;
          } else if (findStandardFB(upper)) {
            tokenType = TT_FUNCTION; modifiers |= MOD_DEFAULT_LIB;
          } else {
            const role = nameMap.get(upper);
            if (role) { tokenType = role.tokenType; modifiers |= role.modifiers; }
          }
        }
    }
    if (tokenType === -1) continue;

    if (!byOriginalLine.has(origLine)) byOriginalLine.set(origLine, []);
    byOriginalLine.get(origLine)!.push({ char, length, type: tokenType, mod: modifiers });
  }

  // Emit tokens in original-file line order
  const stLineSet = new Set<number>(extraction.lineMap);
  const rawLines = text.split('\n');
  const builder = new SemanticTokensBuilder();

  for (let lineNum = 0; lineNum < rawLines.length; lineNum++) {
    if (stLineSet.has(lineNum)) {
      // ST content line — emit translated ST tokens
      const pending = byOriginalLine.get(lineNum) ?? [];
      pending.sort((a, b) => a.char - b.char);
      for (const t of pending) {
        builder.push(lineNum, t.char, t.length, t.type, t.mod);
      }
    } else {
      // XML wrapper line — dim as comment
      const lineText = rawLines[lineNum];
      const trimmed = lineText.trimStart();
      if (trimmed.length > 0) {
        const indent = lineText.length - trimmed.length;
        builder.push(lineNum, indent, trimmed.length, TT_COMMENT, 0);
      }
    }
  }

  return builder.build();
}
```

> **Note on multi-line ST tokens in TcPOU:** Block comments `(* … *)` can span
> multiple lines inside CDATA content. In the above, only the first line is
> handled inline. For subsequent lines of a multi-line token the token will
> have its own entry in `stTokens` via `tokenizeWithTrivia`. Since all lines
> of a block comment land on consecutive extracted lines they will all appear
> in `lineMap` and be handled correctly.

---

**Tests to Write (`semanticTokens.test.ts`):**

```ts
describe('TcPOU semantic tokens', () => {
  function makeTcDoc(xml: string) {
    return TextDocument.create('file:///FB_Ex.TcPOU', 'xml', 1, xml);
  }

  // Same SIMPLE_TCPOU fixture as Phase 1 test

  it('XML preamble lines are emitted as comment tokens', () => {
    const { data } = handleSemanticTokens(makeTcDoc(SIMPLE_TCPOU));
    const tokens = decodeTokens(data);
    // Line 0 is '<?xml …>' → should be comment
    const line0 = tokens.filter(t => t.line === 0);
    expect(line0.length).toBeGreaterThan(0);
    expect(line0.every(t => t.tokenType === 'comment')).toBe(true);
  });

  it('ST content lines are NOT emitted as comment', () => {
    const { data } = handleSemanticTokens(makeTcDoc(SIMPLE_TCPOU));
    const tokens = decodeTokens(data);
    // Line 4: 'FUNCTION_BLOCK FB_Ex' → keyword + function tokens
    const line4 = tokens.filter(t => t.line === 4);
    expect(line4.some(t => t.tokenType === 'keyword')).toBe(true);
    expect(line4.every(t => t.tokenType === 'comment')).toBe(false);
  });

  it('FUNCTION_BLOCK keyword on original line 4 is coloured as keyword', () => {
    const { data } = handleSemanticTokens(makeTcDoc(SIMPLE_TCPOU));
    const tokens = decodeTokens(data);
    expect(tokens.some(t =>
      t.line === 4 && t.tokenType === 'keyword' && t.length === 14 // 'FUNCTION_BLOCK'
    )).toBe(true);
  });

  it('plain .st files are unaffected', () => {
    const doc = TextDocument.create('file:///test.st', 'st', 1,
      'PROGRAM P\nVAR x : INT; END_VAR\nEND_PROGRAM');
    const { data } = handleSemanticTokens(doc);
    const tokens = decodeTokens(data);
    expect(tokens.some(t => t.tokenType === 'keyword' && t.line === 0)).toBe(true);
  });
});
```

**Acceptance Criteria (Phase 2):**
- [ ] Every XML wrapper line emits exactly one `comment`-type semantic token
  (spanning the non-whitespace part of the line)
- [ ] ST content lines emit properly typed tokens (`keyword`, `variable`, `type`, etc.)
  at their original file line numbers
- [ ] No tokens from ST content are accidentally emitted as `comment`
- [ ] Plain `.st` files: zero change in existing test results
- [ ] All existing `semanticTokens.test.ts` tests still pass

---

### Phase 3: Fix `semanticTokens.ts` multi-line-token length bug (quick fix)

**Objective:**  
While touching `semanticTokens.ts`, fix the existing single-character-length
bug for multi-line tokens reported in `lsp-bugs-plan.md` Bug 4 Sub-bug B.

**Problem:** Line 385-386 of current `semanticTokens.ts`:
```ts
const length = tok.range.end.character - tok.range.start.character;
if (length <= 0) continue;  // ← skips multi-line tokens whose last line ends early
```

**Fix:** In the plain-ST code path (unchanged from Phase 2 refactor), the new
`buildTcPouSemanticTokens` already avoids this by using `tok.text.split('\n')[0].length`
for multi-line tokens. Apply the same fix to the original ST path in `handleSemanticTokens`:

Replace the early `length <= 0` guard:
```ts
// BEFORE
const length = tok.range.end.character - tok.range.start.character;
if (length <= 0) continue;

// AFTER
const spanLines = tok.range.end.line - tok.range.start.line;
const length = spanLines === 0
  ? tok.range.end.character - tok.range.start.character
  : tok.text.split('\n')[0].length;
if (length <= 0) continue;
```

**Acceptance Criteria (Phase 3):**
- [ ] Block comments that start far to the right are no longer silently skipped

---

## Open Questions

1. **Single-line XML wrapper lines — fold or not?**
   - **Current plan:** Only fold runs of ≥ 2 consecutive XML lines (guard: `i - 1 > runStart`)
   - **Alternative:** Fold runs of ≥ 1 line. This would fold e.g. the `]]></Declaration>` line on its own.
   - **Recommendation:** Keep ≥ 2 threshold. Folding a single line adds UI noise without much benefit; the dimming already makes single XML lines visually recede.

2. **`FoldingRangeKind` for XML regions**  
   - **Option A:** Use `FoldingRangeKind.Region` (current plan) — generic collapsible region
   - **Option B:** Use `FoldingRangeKind.Imports` — VS Code collapses imports by default
   - **Recommendation:** `Region`. The XML wrapper is not "imports" semantically. `Region` is neutral and correct.

3. **Dimming: trim leading whitespace or not?**  
   - **Current plan:** Trim leading indent; emit `comment` token starting after indentation.
     This preserves the indent visually while greying out the content.
   - **Alternative:** Emit the entire line including indent as a comment token.
   - **Recommendation:** Trim. Semantic tokens cover only text, not whitespace. Indentation
     stays neutral (editor background color).

---

## Risks & Mitigation

- **Risk:** `extractST` is called twice per request (once in folding, once in semantic tokens)
  for TcPOU files; minor performance cost.
  - **Mitigation:** Acceptable — files are small (<500 lines). If it becomes a bottleneck,
    cache in `WorkspaceIndex`.

- **Risk:** `path.extname(document.uri)` on a `file:///…` URI returns the correct extension
  because `extname` just looks for the last `.` in the string.
  - **Mitigation:** Already used this way in `extractStFromTwinCAT` in diagnostics.ts — no issue.

- **Risk:** A TcPOU file with only one XML line before the first CDATA (unlikely but possible)
  won't get a fold for the preamble, just dimming.
  - **Mitigation:** Acceptable by design (single-line fold has no UX value).

- **Risk:** TcPOU files with zero sections (`extraction.sections.length === 0`) would have
  ALL lines treated as XML → entire file greyed out.
  - **Mitigation:** Guard: `if (extraction.sections.length === 0) fall through to passthrough path`.

---

## Success Criteria

- [ ] Opening a `.TcPOU` file: XML lines appear greyed-out, CDATA content appears fully coloured
- [ ] XML preamble/postamble/inter-section gaps have fold triangles; can be collapsed
- [ ] ST-internal folds (VAR blocks, IF/FOR/…) still work at correct positions
- [ ] All existing tests pass (`npm test` in `server/`)
- [ ] New tests cover TcPOU folding and dimming cases

---

## Notes for Atlas

- Work entirely in `server/src/handlers/foldingRange.ts` and `server/src/handlers/semanticTokens.ts`.
- **Do not change `tcExtractor.ts`** — it is the stable data source.
- The key helper `extractST` is already tested and correct; trust its output.
- Run `npm test` from `server/` to execute the Vitest suite.
- The `lsp-improvements-plan.md` Phase 6 described "XML/CDATA dimming" at a high level —
  this plan is the detailed implementation specification for that feature.
- **Dependency:** Phase 1 (folding) and Phase 2 (dimming) are independent and can be
  implemented in any order or in parallel.
- Phase 3 is a one-line fix — include it when touching `semanticTokens.ts` in Phase 2.
