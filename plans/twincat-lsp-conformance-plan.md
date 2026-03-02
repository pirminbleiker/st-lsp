# Plan: TwinCAT LSP Conformance — Full-File Support & Language Gaps

**Created:** 2026-02-28  
**Status:** Ready for Atlas Execution

## Summary

The LSP doesn't work correctly across entire TcPOU files because: (1) most handlers use wrong coordinate systems — position mapping between XML-original and extracted-ST is broken/missing in hover, definition, completion, references, rename, inlayHints, codeLens, signatureHelp, documentSymbols, and codeActions; (2) critical IEC 61131-3 / TwinCAT language constructs are not parsed (typed literals `INT#`, pointer dereference `^`, `THIS^`, `STRING(n)`, Property GET/SET bodies, hex/octal/binary literals, `REF=`, `AT %` addressing, `VAR_INST`, multi-name VAR declarations); (3) the TcPOU extractor has bugs (interface methods/properties dropped, wrong `END_FUNCTION_BLOCK` for PROGRAMs/FUNCTIONs, stray `PUBLIC` from accessor CDATA).

This plan fixes all three areas in priority order across 10 phases.

## Context & Analysis

**Relevant Files:**

### TcPOU Extraction
- `server/src/twincat/tcExtractor.ts`: XML→ST extraction with lineMap. Has bugs for interfaces, non-FB POUs, and stray accessor declarations.
- `server/src/__tests__/tcExtractor.test.ts`: ~2000 lines of tests.

### Parser Pipeline
- `server/src/parser/lexer.ts`: 86 token kinds. Missing `^` (CARET), `#` (typed literal), `%` (AT address), `REF=`, `THIS`, `VAR_INST`, `GET`, `END_GET`, `SET`, `END_SET`.
- `server/src/parser/parser.ts`: ~1540-line recursive-descent. Property GET/SET bodies are **skipped**. No pointer dereference. No `THIS^`. NAMESPACE content is skipped.
- `server/src/parser/ast.ts`: ~325 lines. `PropertyDeclaration` has no getter/setter/varBlocks. No `DereferenceExpression`. No `TypedLiteral`.

### Handlers (broken for TcPOU)
- `server/src/handlers/hover.ts`: Uses `params.position` (original-file) to search extracted-source AST — **no position conversion**.
- `server/src/handlers/definition.ts`: Incoming AND outgoing positions wrong — **no position conversion**.
- `server/src/handlers/completion.ts`: Scope resolution uses mixed coordinate systems — **broken for TcPOU**.
- `server/src/handlers/inlayHints.ts`: Output positions not mapped back — **broken for TcPOU**.
- `server/src/handlers/references.ts`: **No TcPOU support at all** — parses raw XML as ST.
- `server/src/handlers/rename.ts`: **No TcPOU support at all** — parses raw XML as ST.
- `server/src/handlers/signatureHelp.ts`: Likely no TcPOU extraction (needs verification).
- `server/src/handlers/codeLens.ts`: Likely no position mapping (needs verification).
- `server/src/handlers/codeActions.ts`: Likely no TcPOU support.
- `server/src/handlers/documentSymbols.ts`: Likely output positions wrong.

### Handlers (working for TcPOU)
- `server/src/handlers/semanticTokens.ts`: ✅ Correct — has dedicated `handleSemanticTokensXml()` path.
- `server/src/handlers/foldingRange.ts`: ✅ Correct — has XML-aware path with lineMap.
- `server/src/handlers/diagnostics.ts`: ✅ Mostly correct — uses `applyOffsets` (minor character-offset issue on first CDATA lines).

### Server
- `server/src/server.ts`: Entry point; wires all handlers. Document change handling triggers diagnostics via `validateDocument`.

### Existing Plans (already done)
- `plans/tcpou-lsp-fixes-complete.md`: ✅ COMPLETED — XML dimming, auto-folding, method/property CDATA extraction.

**Key Functions/Classes:**
- `extractST(content, ext)` in `tcExtractor.ts`: New API returning `ExtractionResult { source, lineMap, sections }`.
- `extractStFromTwinCAT(filePath, content)` in `tcExtractor.ts`: Legacy API returning `{ stCode, offsets }`.
- `findNodeAtPosition(ast, line, character)`: AST traversal used by hover, definition, etc.
- `applyOffsets(diagnostics, offsets)` in `diagnostics.ts`: Forward line mapping (extracted→original).
- `getXmlRanges(text)` in `tcExtractor.ts`: Returns XML wrapper character ranges.

**Dependencies:**
- `vscode-languageserver`: LSP protocol types and connection framework.
- `vscode-languageserver-textdocument`: TextDocument line/offset utilities.

**Patterns & Conventions:**
- Handlers are pure: `(params, documents, index?) → result`.
- All keyword comparisons use `.toUpperCase()`.
- The lexer normalizes keywords to upper-case token kinds.
- Error recovery uses `skipToSemicolon()` with end-keyword boundaries.
- AST uses discriminated unions with `kind` string literal field.
- Every handler re-parses from scratch (no caching outside WorkspaceIndex).

---

## Implementation Phases

### Phase 1: Bidirectional Position Mapping Utility

**Objective:** Create a shared utility that converts positions between original-file coordinates and extracted-source coordinates, so all handlers can use it consistently.

**Files to Modify/Create:**
- `server/src/twincat/tcExtractor.ts`: Add `buildReverseLineMap(lineMap)` function and export a `PositionMapper` utility class/interface.
- `server/src/__tests__/tcExtractor.test.ts`: Add tests for bidirectional mapping.

**Steps:**
1. Write tests for `PositionMapper`:
   - `originalToExtracted(line, character)` → converted position
   - `extractedToOriginal(line, character)` → converted position
   - Test with multi-method TcPOU (methods at various offsets)
   - Test with first-line character offset (CDATA starting mid-line)
   - Test edge cases: position on synthetic lines, position on XML-only lines
2. Run tests (should fail).
3. Implement `PositionMapper` in `tcExtractor.ts`:
   - Takes `lineMap: number[]` and `sections: CDataSection[]`.
   - `extractedToOriginal(line, char)`: Use `lineMap[line]` for line; for character, find the section containing this line and apply `startChar` offset if it's the section's first line.
   - `originalToExtracted(line, char)`: Build a reverse map `Map<originalLine, extractedLine[]>` from `lineMap`. For character, reverse the `startChar` adjustment.
   - Handle positions falling on XML-only lines (return `null` or nearest valid position).
4. Run tests (should pass).
5. Lint/format.

**Acceptance Criteria:**
- [ ] `PositionMapper` correctly maps positions for a Dictionary.TcPOU-like file with 30+ methods/properties.
- [ ] Character offsets on first CDATA lines are handled correctly.
- [ ] Synthetic line positions (END_METHOD, etc.) map back to the corresponding XML tag line.
- [ ] Positions on XML-only lines return null/undefined.
- [ ] All existing tests still pass.

---

### Phase 2: Fix Hover Handler for TcPOU

**Objective:** Make hover work correctly in TcPOU files by converting incoming positions and outgoing ranges.

**Files to Modify:**
- `server/src/handlers/hover.ts`: Use `PositionMapper` for incoming `params.position` and outgoing hover `range`.
- `server/src/__tests__/hover.test.ts`: Add TcPOU-specific hover tests.

**Steps:**
1. Write tests:
   - Hover over a variable in a TcPOU method body → correct hover content AND range.
   - Hover over a type name in a TcPOU top-level declaration.
   - Hover on an XML-only line → no hover (null).
2. Run tests (should fail).
3. Modify `handleHover()`:
   - After extraction, create a `PositionMapper`.
   - Convert `params.position` from original→extracted before `findNodeAtPosition()`.
   - Convert the result `range` from extracted→original before returning.
   - If position maps to null (XML line), return null early.
4. Run tests (should pass).
5. Lint/format.

**Acceptance Criteria:**
- [ ] Hover shows correct info for variables/types in method bodies.
- [ ] Hover range highlights the correct text span in the XML file.
- [ ] Hover returns null for XML wrapper lines.
- [ ] All existing hover tests still pass.

---

### Phase 3: Fix Definition Handler for TcPOU

**Objective:** Make go-to-definition work correctly in TcPOU files (both incoming click position and outgoing definition location).

**Files to Modify:**
- `server/src/handlers/definition.ts`: Use `PositionMapper` for incoming and outgoing positions.
- `server/src/__tests__/definition.test.ts`: Add TcPOU-specific definition tests.

**Steps:**
1. Write tests:
   - Go-to-def on a variable reference in a method → jumps to its declaration in VAR block (correct line in original file).
   - Go-to-def on a method call → jumps to method declaration.
   - Go-to-def on POU-level variable from within a method → correct location.
   - Cross-file go-to-def from one TcPOU to another → correct position in target file.
2. Run tests (should fail).
3. Modify `handleDefinition()`:
   - After extraction, create `PositionMapper`.
   - Convert incoming `params.position` from original→extracted.
   - Convert outgoing `Location.range` from extracted→original.
   - For cross-file definitions: if target file is also TcPOU, need to extract it and create a mapper for the target too.
4. Run tests (should pass).
5. Lint/format.

**Acceptance Criteria:**
- [ ] Go-to-def jumps to correct line/character in TcPOU files.
- [ ] Cross-file TcPOU → TcPOU definition works.
- [ ] Cross-file TcPOU → .st definition works.
- [ ] All existing definition tests still pass.

---

### Phase 4: Fix Completion Handler for TcPOU

**Objective:** Make auto-completion work in TcPOU files with correct scope resolution and text analysis.

**Files to Modify:**
- `server/src/handlers/completion.ts`: Use `PositionMapper` and operate on extracted source text for line analysis.
- `server/src/__tests__/completion.test.ts`: Add TcPOU-specific completion tests.

**Steps:**
1. Write tests:
   - Completion inside a method body → shows method-local vars, FB vars, and globals.
   - Dot-completion after an FB instance in a method → shows FB members.
   - Completion on first line of a CDATA section → correct results.
   - Completion on XML line → empty result.
2. Run tests (should fail).
3. Modify `handleCompletion()`:
   - Convert `params.position` to extracted coordinates.
   - Use extracted source text (not raw XML) for `getIdentifierBeforeDot`, `isSuperBeforeDot`, etc.
   - Convert the extracted position's line/character when calling `collectVarDeclarations()`.
   - Ensure scope resolution operates in extracted-source space consistently.
4. Run tests (should pass).
5. Lint/format.

**Acceptance Criteria:**
- [ ] Completion shows correct variables inside TcPOU method bodies.
- [ ] Dot-completion works after FB instances.
- [ ] No completions offered on XML wrapper lines.
- [ ] All existing completion tests still pass.

---

### Phase 5: Fix Remaining Handlers for TcPOU

**Objective:** Add TcPOU support (extraction + position mapping) to all remaining handlers that currently lack it.

**Files to Modify:**
- `server/src/handlers/references.ts`: Add extraction + bidirectional mapping.
- `server/src/handlers/rename.ts`: Add extraction + bidirectional mapping. **Note:** Rename edits must be mapped back to original coordinates AND must not modify XML structure.
- `server/src/handlers/inlayHints.ts`: Fix output position mapping.
- `server/src/handlers/signatureHelp.ts`: Add extraction + position mapping (verify current state first).
- `server/src/handlers/codeLens.ts`: Add extraction + output position mapping (verify current state first).
- `server/src/handlers/codeActions.ts`: Add extraction + position mapping (verify current state first).
- `server/src/handlers/documentSymbols.ts`: Fix output position mapping.
- Add TcPOU tests for each handler.

**Steps:**
1. For each handler, write a test exercising it with TcPOU content.
2. Run tests (should fail).
3. Apply the same `PositionMapper` pattern: extract, convert incoming positions, process, convert outgoing positions.
4. For `rename.ts`: Ensure `TextEdit` ranges are converted from extracted→original. Validate that edits within CDATA are safe (don't touch XML tags).
5. For `references.ts`: All result locations must be converted to original coordinates.
6. Run tests (should pass).
7. Lint/format.

**Acceptance Criteria:**
- [ ] Find References works in TcPOU files.
- [ ] Rename works for symbols within TcPOU files (within CDATA only).
- [ ] Inlay hints appear at correct positions.
- [ ] Signature help works in method bodies.
- [ ] Code lens shows correct counts mapped to correct positions.
- [ ] Document symbols outline is correct for TcPOU (methods, properties visible).
- [ ] All existing handler tests still pass.

---

### Phase 6: Fix TcPOU Extractor Bugs

**Objective:** Fix the 3 extractor bugs: (1) interface methods/properties dropped, (2) wrong END_FUNCTION_BLOCK for non-FB POUs, (3) stray `PUBLIC` from accessor CDATA.

**Files to Modify:**
- `server/src/twincat/tcExtractor.ts`: Fix all 3 bugs.
- `server/src/__tests__/tcExtractor.test.ts`: Add/update regression tests.

**Steps:**
1. Write tests:
   - **Bug 1:** Extract `I_LinkedList.TcIO` → verify method signatures and property declarations are present in output.
   - **Bug 2:** Extract a PROGRAM with methods → verify `END_PROGRAM` (not `END_FUNCTION_BLOCK`) is emitted. Same for FUNCTION.
   - **Bug 3:** Extract `LinkedListNode.TcPOU` → verify no stray `PUBLIC` keyword in output.
2. Run tests (should fail).
3. Fix Bug 1 — Interface methods/properties:
   - In `buildResult()`, remove the `isPOU` guard for method/property extraction. Allow `<Itf>` containers to extract nested `<Method>` and `<Property>` children.
   - Add synthetic `END_INTERFACE` closing (analogous to `END_FUNCTION_BLOCK`).
4. Fix Bug 2 — POU type-aware closing:
   - Detect the POU type from the declaration CDATA (scan for `FUNCTION_BLOCK`, `PROGRAM`, or `FUNCTION` keyword).
   - Emit the correct synthetic closer: `END_FUNCTION_BLOCK`, `END_PROGRAM`, or `END_FUNCTION`.
5. Fix Bug 3 — Stray accessor declarations:
   - In the `buildResult()` property section, filter out accessor declarations that contain ONLY access modifiers (`PUBLIC`, `PRIVATE`, `PROTECTED`, `INTERNAL`) with no actual VAR block content. Treat these as empty.
6. Run tests (should pass).
7. Lint/format.

**Acceptance Criteria:**
- [ ] Interface methods and properties are extracted from `.TcIO` files.
- [ ] PROGRAMs with methods get `END_PROGRAM` not `END_FUNCTION_BLOCK`.
- [ ] No stray `PUBLIC`/`PRIVATE`/`PROTECTED`/`INTERNAL` keywords in extracted output.
- [ ] All existing extractor tests still pass.
- [ ] Dictionary.TcPOU, LinkedList.TcPOU, LinkedListNode.TcPOU, I_LinkedList.TcIO integration tests pass.

---

### Phase 7: Lexer — Add Missing Token Types

**Objective:** Add all missing tokens needed for TwinCAT Structured Text: `^` (CARET), `#` handling for typed/hex/octal/binary literals, `%` for AT addressing, `REF=`, `THIS`, `VAR_INST`, `GET`, `END_GET`, `SET`, `END_SET`.

**Files to Modify:**
- `server/src/parser/lexer.ts`: Add new token kinds and lexing logic.
- `server/src/__tests__/lexer.test.ts`: Add tests for each new token.

**Steps:**
1. Write tests for each new token:
   - `^` → `TokenKind.CARET`
   - `THIS` → `TokenKind.THIS`
   - `VAR_INST` → `TokenKind.VAR_INST`
   - `GET` → `TokenKind.GET`
   - `END_GET` → `TokenKind.END_GET`
   - `SET` → `TokenKind.SET`
   - `END_SET` → `TokenKind.END_SET`
   - `REF=` → `TokenKind.REF_ASSIGN`
   - `16#FF` → `TokenKind.INTEGER` with value `16#FF`
   - `8#77` → `TokenKind.INTEGER` with value `8#77`
   - `2#1010` → `TokenKind.INTEGER` with value `2#1010`
   - `INT#42` → `TokenKind.TYPED_LITERAL` (or type prefix + hash + value)
   - `T#5s` → `TokenKind.TYPED_LITERAL`
   - `DT#2024-01-01-12:00:00` → `TokenKind.TYPED_LITERAL`
   - `TOD#08:30:00` → `TokenKind.TYPED_LITERAL`
   - `LTIME#100ms` → `TokenKind.TYPED_LITERAL`
   - `D#2024-01-01` → `TokenKind.TYPED_LITERAL`
   - `%IX0.0` → `TokenKind.AT_ADDRESS`
   - `%QW4` → `TokenKind.AT_ADDRESS`
   - `%MW100` → `TokenKind.AT_ADDRESS`
2. Run tests (should fail).
3. Implement in lexer:
   - Add all new `TokenKind` enum values.
   - In `readSymbol()`: Add case `'^'` → emit `CARET`.
   - In `readSymbol()`: Add case `'%'` → read `%[IQM][XBWDL]?` followed by digits/dots → emit `AT_ADDRESS`.
   - In `readNumber()`: After reading digits, check for `#` → continue reading base-specific digits → emit `INTEGER` with full `16#FF` text.
   - In `readIdentOrKeyword()`: After reading an identifier, check for `#`:
     - If the identifier is a type name (`INT`, `UINT`, `DINT`, `REAL`, `BYTE`, `WORD`, `DWORD`, `LWORD`, `SINT`, `USINT`, `LINT`, `ULINT`, `BOOL`, `STRING`, `WSTRING`, `TIME`, `LTIME`, `DATE`, `DT`, `TOD`, `DATE_AND_TIME`, `TIME_OF_DAY`) followed by `#`, read the literal value → emit `TYPED_LITERAL`.
     - If the identifier is `T`, `D`, `DT`, `TOD`, `LTIME`, `DATE` followed by `#`, read time/date literal → emit `TYPED_LITERAL`.
   - In `readIdentOrKeyword()`: Check for `REF` followed by `=` → emit `REF_ASSIGN`.
   - Add `THIS`, `VAR_INST`, `GET`, `END_GET`, `SET`, `END_SET` to `KEYWORDS` map.
4. Run tests (should pass).
5. Lint/format.

**Acceptance Criteria:**
- [ ] All new token types are correctly lexed.
- [ ] `16#FF`, `8#77`, `2#1010` tokenize as INTEGER.
- [ ] `INT#42`, `T#5s`, `DT#...` tokenize as TYPED_LITERAL.
- [ ] `^`, `THIS`, `REF=`, `%IX0.0`, `VAR_INST`, `GET`, `END_GET`, `SET`, `END_SET` have dedicated tokens.
- [ ] Existing lexer tests still pass (no regressions with `#` or `^` in existing valid code).

---

### Phase 8: Parser — Property GET/SET, THIS^, Pointer Dereference, STRING(n)

**Objective:** Parse the most impactful missing constructs: Property GET/SET bodies, `THIS^` expressions, general pointer dereference `ptr^`, `STRING(n)` sized types.

**Files to Modify:**
- `server/src/parser/ast.ts`: Add new AST nodes and fields.
- `server/src/parser/parser.ts`: Implement parsing for new constructs.
- `server/src/__tests__/parser.test.ts`: Add parser tests.

**Steps:**
1. **AST changes** — Write the new types first:
   - `PropertyDeclaration`: Add `varBlocks?: VarBlock[]`, `getter?: { varBlocks: VarBlock[], body: Statement[] }`, `setter?: { varBlocks: VarBlock[], body: Statement[] }`.
   - Add `DereferenceExpression { kind: 'DereferenceExpression', operand: Expression, range: Range }`.
   - Add `TypedLiteralExpression { kind: 'TypedLiteral', typeName: string, value: string, range: Range }`.
   - `TypeRef`: Add optional `stringLength?: Expression` field.
   - `VarDeclaration`: Add optional `atAddress?: string` field.
   - `SubscriptExpression`: Change `index: Expression` to `indices: Expression[]`.

2. Write parser tests:
   - Property with GET/SET bodies + local VARs → full AST including getter/setter bodies.
   - Property with GET only (no SET).
   - `THIS^.myVar := 5;` → assignment with DereferenceExpression(NameExpression('THIS')).MemberExpression.
   - `pData^ := 42;` → assignment with DereferenceExpression(NameExpression('pData')).
   - `pNode^.next^.value` → chained dereferences with member access.
   - `s : STRING(80);` → VarDeclaration with TypeRef having stringLength.
   - `s : STRING[80];` → same (bracket variant).
   - `matrix[i, j]` → SubscriptExpression with 2 indices.
   - `x AT %IX0.0 : BOOL;` → VarDeclaration with atAddress.
   - `a, b, c : INT;` → multiple VarDeclarations.
   - `VAR_INST x : INT; END_VAR` → parsed as var block.
   - `x := INT#42;` → TypedLiteralExpression.
   - `t := T#5s;` → TypedLiteralExpression.
   - `refVar REF= someVar;` → reference assignment statement.

3. Run tests (should fail).

4. Implement parser changes:
   - **Property GET/SET:** Rewrite `parsePropertyDeclaration()`:
     - After header, parse optional VAR blocks.
     - Look for `GET` token → parse var blocks + statement body until `END_GET`.
     - Look for `SET` token → parse var blocks + statement body until `END_SET`.
     - Consume `END_PROPERTY`.
   - **Pointer dereference:** In `parsePostfixExpression()`, after existing cases, add: if `peek()` is `CARET`, consume it and wrap the expression in `DereferenceExpression`.
   - **THIS^:** In `parsePrimary()`, add case for `THIS` token → emit `NameExpression('THIS')`. The `^` will be handled by the postfix dereference above.
   - **STRING(n):** In `parseTypeRef()`, after reading the type name, if the name is `STRING` or `WSTRING` and `peek()` is `(` or `[`, parse the length expression.
   - **Multi-dimensional subscript:** In `parsePostfixExpression()` `[` case, parse comma-separated expression list.
   - **AT addressing:** In `parseVarDeclaration()`, after the name, check for `AT` keyword + `AT_ADDRESS` token.
   - **VAR_INST:** Add `VAR_INST` to `VAR_KEYWORDS` set.
   - **Typed literals:** In `parsePrimary()`, add case for `TYPED_LITERAL` → emit `TypedLiteralExpression`.
   - **REF= assignment:** In `parseAssignmentOrCall()`, check for `REF_ASSIGN` token as alternative to `:=`.
   - **Multi-name VAR:** In `parseVarDeclaration()`, if after the first name a `,` follows, collect additional names and emit one `VarDeclaration` per name with the same type.

5. Run tests (should pass).
6. Lint/format.

**Acceptance Criteria:**
- [ ] Property GET/SET bodies are in the AST with var blocks and statement lists.
- [ ] `THIS^.x` and `ptr^.field` parse correctly as DereferenceExpression chains.
- [ ] `STRING(80)` and `WSTRING(255)` parse with stringLength in TypeRef.
- [ ] Multi-dimensional subscripts parse correctly.
- [ ] AT addressing parsed into VarDeclaration.
- [ ] `VAR_INST` blocks parse correctly.
- [ ] Typed literals parse as TypedLiteralExpression.
- [ ] `REF=` assignment parses.
- [ ] `a, b, c : INT;` produces 3 VarDeclaration nodes.
- [ ] All existing parser tests still pass.

---

### Phase 9: Update Handlers for New AST Nodes

**Objective:** Update all handlers to leverage the new AST nodes (Property GET/SET, DereferenceExpression, TypedLiteral, etc.) for better completion, hover, go-to-def, semantic tokens, and diagnostics.

**Files to Modify:**
- `server/src/handlers/completion.ts`: Property GET/SET var scoping; deref chain member resolution.
- `server/src/handlers/hover.ts`: Hover over THIS^, typed literals, AT addresses.
- `server/src/handlers/definition.ts`: Go-to-def through dereference chains; property accessor navigation.
- `server/src/handlers/semanticTokens.ts`: Color `THIS` as keyword; color typed literals; color AT addresses.
- `server/src/handlers/diagnostics.ts`: Validate property bodies; check VAR_INST usage.
- `server/src/handlers/documentSymbols.ts`: Show GET/SET as children of properties in outline.
- `server/src/handlers/signatureHelp.ts`: Support deref chains in call resolution.

**Steps:**
1. Write handler-specific tests for new constructs.
2. Run tests (should fail).
3. Update each handler:
   - **completion.ts:** When cursor is inside a property GET/SET body, include the property's var blocks in scope. For `ptr^.` dot-completion, resolve the pointer target type.
   - **hover.ts:** Show `THIS : <CurrentFBType>` when hovering `THIS`. Show typed literal type info.
   - **definition.ts:** Follow deref chains: `THIS^.x` → resolve `x` in current FB. `ptr^.field` → resolve field in pointer target type.
   - **semanticTokens.ts:** Register `THIS` as keyword token. Register typed literal prefixes.
   - **diagnostics.ts:** Remove false "undeclared identifier" for `THIS`. Validate `GET`/`SET` accessor body presence.
   - **documentSymbols.ts:** Add GET/SET as child symbols under property.
4. Run tests (should pass).
5. Lint/format.

**Acceptance Criteria:**
- [ ] Completion inside property GET/SET bodies shows local vars.
- [ ] `THIS^.` triggers member completion for current FB.
- [ ] `THIS` is colored as keyword in semantic tokens.
- [ ] Go-to-def through `THIS^.x` jumps to `x` declaration.
- [ ] Typed literals don't trigger "undeclared identifier" diagnostics.
- [ ] Property GET/SET show in document outline.
- [ ] All existing handler tests still pass.

---

### Phase 10: Parser — NAMESPACE Content, TwinCAT Extensions, Edge Cases

**Objective:** Parse NAMESPACE contents instead of skipping. Add __NEW/__DELETE/__QUERYINTERFACE/__ISVALIDREF as built-in functions. Handle remaining edge cases.

**Files to Modify:**
- `server/src/parser/parser.ts`: Replace `skipNamespaceBlock()` with real parsing.
- `server/src/parser/ast.ts`: Add `NamespaceDeclaration` node.
- `server/src/twincat/stdlib.ts`: Add TwinCAT extension functions.
- `server/src/twincat/types.ts`: Add ANY_INT, ANY_NUM, ANY_REAL, etc.
- `server/src/__tests__/parser.test.ts`: Add NAMESPACE content parsing tests.

**Steps:**
1. Write tests:
   - NAMESPACE with FB inside → NamespaceDeclaration containing FBDeclaration.
   - Nested NAMESPACE → NamespaceDeclaration containing NamespaceDeclaration.
   - `__NEW(MyFB)` → resolves as built-in function (hover shows documentation).
   - `__QUERYINTERFACE(obj, itf)` → resolves as built-in.
   - `ANY_INT`, `ANY_NUM` → recognized as types in hover/completion.
2. Run tests (should fail).
3. Implement:
   - Replace `skipNamespaceBlock()` with `parseNamespaceDeclaration()` that stores the namespace name and recursively calls `parseTopLevelDeclaration()` for its body until `END_NAMESPACE`.
   - Add `NamespaceDeclaration { kind: 'NamespaceDeclaration', name: string, declarations: Declaration[], range: Range }` to ast.ts.
   - Add `__NEW`, `__DELETE`, `__QUERYINTERFACE`, `__ISVALIDREF` to `stdlib.ts` or a new `extensions.ts` file with TwinCAT-specific built-in function documentation.
   - Add `ANY`, `ANY_INT`, `ANY_NUM`, `ANY_REAL`, `ANY_STRING`, `ANY_BIT`, `ANY_DATE`, `ANY_ELEMENTARY`, `ANY_MAGNITUDE`, `ANY_CHARS` to `types.ts`.
4. Run tests (should pass).
5. Lint/format.

**Acceptance Criteria:**
- [ ] NAMESPACE content is parsed into the AST (declarations accessible).
- [ ] Nested namespaces work.
- [ ] `__NEW`, `__DELETE`, `__QUERYINTERFACE`, `__ISVALIDREF` show in hover/completion.
- [ ] `ANY_INT` etc. recognized as valid types.
- [ ] All existing tests still pass.

---

## Open Questions

1. **Should the PositionMapper use the new `extractST` API or the legacy `extractStFromTwinCAT`?**
   - **Option A:** Build on `extractST` (newer, has `sections` for character-level accuracy).
   - **Option B:** Build on `extractStFromTwinCAT` (legacy, only line-level offsets).
   - **Recommendation:** Option A — `extractST` has section-level metadata needed for character offsets on first CDATA lines. Migrate handlers from legacy API to new API incrementally.

2. **Should rename in TcPOU files be supported for cross-CDATA renames?**
   - **Option A:** Only allow renames within a single CDATA section (safest — no risk of corrupting XML).
   - **Option B:** Allow renames across CDATA sections (e.g., renaming an FB-level variable that's used in method bodies).
   - **Recommendation:** Option B — this is the expected user experience. The rename edits must be mapped back to original coordinates within their respective CDATA sections.

3. **How should typed literals be tokenized — as a single composite token or as multiple tokens?**
   - **Option A:** Single `TYPED_LITERAL` token (e.g., `INT#42` is one token).
   - **Option B:** Three tokens: type name + `#` + value.
   - **Recommendation:** Option A — single token is simpler and prevents parser ambiguity with `#` character.

4. **Should `GET`/`SET` be context-sensitive keywords (only keywords inside PROPERTY)?**
   - **Option A:** Always keywords (risk: breaks existing code using `Get`/`Set` as identifiers).
   - **Option B:** Context-sensitive — only treated as keywords when inside a PROPERTY declaration.
   - **Recommendation:** Option B — `Get` and `Set` are extremely common identifier names in ST code. Make them keywords only when the parser is inside a `parsePropertyDeclaration()` context.

## Risks & Mitigation

- **Risk:** Changing the lexer's handling of `#` could break existing valid code that uses `#` in pragmas or attributes.
  - **Mitigation:** Pragmas are already handled as a special case (`{...}`). Ensure `#` handling only activates after digits (for hex/octal/binary) or type-name identifiers (for typed literals). Add regression tests for pragma parsing.

- **Risk:** Adding `THIS` as a keyword could break code that uses `THIS` as a variable name (invalid in TwinCAT but might exist in tests).
  - **Mitigation:** Search all test fixtures for `THIS` usage. In the parser, `THIS` as a keyword still resolves to the current instance — semantically correct.

- **Risk:** The bidirectional position mapping could introduce subtle off-by-one errors affecting all handlers.
  - **Mitigation:** Extensive unit tests with real TcPOU fixtures (Dictionary.TcPOU, LinkedList.TcPOU). Test with `lsp-devtools inspect` to verify live positions.

- **Risk:** Property GET/SET parsing changes could break error recovery for malformed property bodies.
  - **Mitigation:** Keep the existing skip-to-END_PROPERTY as the error recovery fallback. Only parse GET/SET bodies when the tokens are well-formed.

- **Risk:** Multi-name VAR declaration (`a, b, c : INT;`) could conflict with existing single-name parsing.
  - **Mitigation:** Only activate comma-separated parsing if a comma follows the first identifier before `:`. Existing single-name parsing remains the fast path.

## Success Criteria

- [ ] All LSP handlers work correctly in TcPOU files (hover, definition, completion, references, rename, inlay hints, signature help, code lens, code actions, document symbols).
- [ ] Position mapping is accurate for all handlers (verified with `lsp-devtools inspect`).
- [ ] Typed literals (`INT#42`, `T#5s`, `16#FF`), pointer dereference (`ptr^`), `THIS^`, `STRING(80)` all parse without errors.
- [ ] Property GET/SET bodies are fully parsed and support completion/hover/go-to-def.
- [ ] Interface methods/properties are extracted from `.TcIO` files.
- [ ] No regressions in existing tests.
- [ ] Real-world mobject-core library files parse without errors.

## Notes for Atlas

- **Phase execution order matters:** Phases 1-5 (position mapping) should be done first because they fix the most user-visible issues (handlers not working in TcPOU files). Phases 6-8 (extractor/parser fixes) can follow. Phase 9 depends on Phase 8. Phase 10 is lowest priority.
- **Use `lsp-devtools inspect`** (running in terminal) to verify handler responses after each phase. This shows raw LSP messages and helps catch position mapping bugs.
- **The `extractST` API** (newer) returns `ExtractionResult` with `sections` and `lineMap`. The legacy `extractStFromTwinCAT` returns `{ stCode, offsets }`. Phase 1 should build on the newer API. Handlers currently using the legacy API should be migrated.
- **Test with real files:** The `tests/fixtures/mobject-core-src/` directory has 676 TcPOU files. Use Dictionary.TcPOU, LinkedList.TcPOU, and LinkedListNode.TcPOU as primary test fixtures — they exercise methods, properties with GET/SET, EXTENDS, IMPLEMENTS, and complex call chains.
- **Vitest** is the test runner: `npx vitest run` from `server/` directory.
- **Be careful with GET/SET keywords:** They MUST be context-sensitive. Many TwinCAT Function Blocks have methods named `Get` or `Set` (e.g., Dictionary has `GetKeys`, `GetValues`). Only treat bare `GET`/`SET` as keywords when inside `parsePropertyDeclaration()`.
