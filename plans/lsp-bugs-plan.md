# LSP Bug Analysis — Additional Findings

> PROMETHEUS analysis pass, 2026-02-27  
> Scope: `server/src/` — all handler, parser and lexer files

---

## Summary

7 distinct bugs found across lexer, parser, handlers and diagnostics.
Listed by severity (critical → low).

---

## Bug 1 — Lexer: `#` typed-literal separator not tokenised (CRITICAL)

**File:** `server/src/parser/lexer.ts` — `readSymbol()` default branch (line ~512)

**Description:**  
TwinCAT / IEC 61131-3 uses `#` in several very common constructs:
- Based integer literals: `16#FF`, `2#1010_0011`, `8#177`
- Typed literals: `INT#16`, `DINT#-1`, `TIME#1s500ms`

The lexer's `readSymbol()` falls through on `#` and emits it as a single-character `IDENTIFIER`
token with text `#`. This completely breaks parsing of any code that uses hex or typed literals —
i.e. virtually every TwinCAT project.

**Fix:** In `readNumber()` and `readIdentOrKeyword()`, detect the `#` separator *after* reading the
prefix token and continue reading the value portion as the same token.

Concrete approach in `readNumber()`:
1. After reading the initial decimal digits, if `this.peek() === '#'` consume `#` and then read the
   rest as hex (`0-9A-Fa-f_`) for `16#…`, binary (`0-1_`) for `2#…`, octal (`0-7_`) for `8#…`.

Approach in `readIdentOrKeyword()` (for `INT#16`, `TIME#1s500ms`):
1. After reading the ident text, if `this.peek() === '#'` consume `#` and then read digits/letters
   to form the typed-literal suffix; emit the whole thing as `TokenKind.INTEGER` (or a new
   `TYPED_LITERAL` kind — INTEGER is fine for diagnostics).

---

## Bug 2 — Lexer / Parser: `^` (pointer dereference) treated as unknown IDENTIFIER (HIGH)

**Files:**  
- `server/src/parser/lexer.ts` — `readSymbol()` default branch  
- `server/src/parser/parser.ts` — `parsePrimary()` SUPER branch (~line 1054) and missing postfix `^`

**Description:**  
The `^` character is not listed in `readSymbol()` and falls through to the default, which emits it
as a single-character `IDENTIFIER` with text `^`. Two problems result:

1. **`SUPER^` parsing** (line ~1054) works *by accident* because the code checks
   `this.peek().kind === TokenKind.IDENTIFIER && this.peek().text === '^'`. If the lexer ever
   changes, this will silently break.

2. **Pointer dereference in other contexts** (`pPtr^`, `pPtr^.field`) is never parsed as a postfix
   operator. The `^` after an identifier is just a stray IDENTIFIER token that causes a parse error
   or is silently swallowed by the recovery logic.

**Fix:**
1. Add `TokenKind.CARET = '^'` to the enum.
2. In `readSymbol()` add `case '^': return this.tok(TokenKind.CARET, ch, startPos);`
3. In `parsePrimary()` SUPER branch replace the text check with `TokenKind.CARET`.
4. In `parsePostfixExpression()` (or equivalent) handle trailing `^` as a dereference node
   (either a `UnaryExpression` with op `'^'` or a dedicated `DerefExpression` AST node).

---

## Bug 3 — `references.ts` / `rename.ts` / `signatureHelp.ts`: TwinCAT files not extracted before parse (HIGH)

**Files:**  
- `server/src/handlers/references.ts` — `handleReferences()` (~line 292)  
- `server/src/handlers/rename.ts` — `handleRename()` / `handlePrepareRename()` (~lines 263, 340)  
- `server/src/handlers/signatureHelp.ts` — `handleSignatureHelp()` (~line 241)

**Description:**  
All three handlers call `parse(document.getText())` directly on the raw file text.  
For `.TcPOU` / `.TcGVL` / `.TcDUT` files this means parsing raw XML, not the extracted ST code.
The result is a completely wrong (or empty) AST, so all three features are silently broken for
TwinCAT project files.

`diagnostics.ts`, `completion.ts`, `hover.ts`, and `definition.ts` all correctly call
`extractStFromTwinCAT()` first. The above three handlers do not.

**Fix:**  
In each handler, replace the direct `parse(document.getText())` call with the same pattern used in
`diagnostics.ts`:
```ts
const extraction = extractStFromTwinCAT(document.uri, document.getText());
const { ast } = parse(extraction.stCode);
// then translate ranges back via extraction.offsets
```

Note: position parameters from the LSP client are in original-file coordinates.  Before using
them to find a node in the extracted AST, translate them forward (original → extracted line) using
the inverse of `extraction.offsets`.

---

## Bug 4 — `semanticTokens.ts`: TwinCAT files not extracted + multi-line token skip (HIGH)

**File:** `server/src/handlers/semanticTokens.ts` — `handleSemanticTokens()` (lines 373-386)

**Sub-bug A — no extraction:**  
`handleSemanticTokens()` at line 374 does `const text = document.getText()` and then
`parse(text)` and `new Lexer(text).tokenizeWithTrivia()` directly on the raw document.  
For `.TcPOU` files this means semantic tokens are computed on raw XML markup.

**Sub-bug B — multi-line token silently skipped:**  
Line 385-386:
```ts
const length = tok.range.end.character - tok.range.start.character;
if (length <= 0) continue;
```
For a multi-line block comment or string whose last line ends at a *smaller* character offset
than where the first line starts, `length` is negative, and the token is silently skipped.
This means block comments that start far to the right on their first line are never highlighted.

**Fix A:** Use `extractStFromTwinCAT` and run the lexer on `extraction.stCode`.  
Translate resulting token line numbers forward via `extraction.offsets` before pushing to the
builder.

**Fix B:** Replace the `length <= 0` guard with `tok.text.length === 0` (true empty tokens only).
For multi-line tokens the per-line splitting code below already handles the correct segment lengths.

---

## Bug 5 — `diagnostics.ts`: GVL variable names absent from scope (MEDIUM)

**File:** `server/src/handlers/diagnostics.ts` — `runSemanticAnalysis()` (lines 402-418)

**Description:**  
`globalNames` is built by iterating `ast.declarations` and adding POU names, interface names, and
type-alias names. `GvlDeclaration` nodes are silently skipped.

This means every variable declared in a `VAR_GLOBAL … END_VAR` block (in a `.TcGVL` or in a
plain `.st` GVL file) is absent from the diagnostic scope. Any use of that global variable inside
a POU in the same workspace produces a false **"Undefined identifier"** warning.

**Fix:**  
Add a branch for `GvlDeclaration` in the `globalNames` loop:
```ts
} else if (decl.kind === 'GvlDeclaration') {
    const gvl = decl as GvlDeclaration;
    for (const vb of gvl.varBlocks) {
        for (const vd of vb.declarations) {
            globalNames.add(vd.name.toUpperCase());
        }
    }
}
```

---

## Bug 6 — `references.ts`: FOR loop variable uses statement start instead of `variableRange` (LOW)

**File:** `server/src/handlers/references.ts` — `ForStatement` case (~lines 182-192)

**Description:**  
When collecting references for the loop variable in a `FOR` statement the code emits:
```ts
range: {
    start: s.range.start,                                   // ← start of the FOR keyword
    end: { ..., character: s.range.start.character + s.variable.length }
}
```
The comment even says *"approximation since the variable has no dedicated range node"*, but
`ForStatement` has had a `variableRange: Range` field in `ast.ts` (line 176) for some time.

This causes the reference highlight to sit on the `FOR` keyword instead of the variable name.

**Fix:**  
Replace the hand-crafted range with `s.variableRange`:
```ts
results.push({ uri, range: s.variableRange });
```

---

## Bug 7 — `diagnostics.ts`: method duplicate-var check duplicates the logic of `findDuplicateVarDeclarations` (LOW / code quality)

**File:** `server/src/handlers/diagnostics.ts` — lines 628-652

**Description:**  
The FB method loop (lines 628-652) manually reimplements the exact logic from
`findDuplicateVarDeclarations()` instead of calling the function. Any future bug-fix or
feature change to the helper will not automatically apply to methods.

**Fix:**  
Replace the inline duplicate-detection block with a call to `findDuplicateVarDeclarations()`.
The function currently only accepts POU types; it can be made to accept a
`{ varBlocks: VarBlock[] }` shape, or a separate `findDuplicateVarDeclarationsInBlocks()`
helper can be extracted.

---

## Proposed bead grouping

| Bead | Title | Bugs |
|------|-------|------|
| sl-A | Lexer: `#` typed-literal support | Bug 1 |
| sl-B | Lexer/Parser: `^` dereference operator | Bug 2 |
| sl-C | TcPOU extraction in references/rename/signatureHelp | Bug 3 |
| sl-D | TcPOU extraction + token skip in semanticTokens | Bug 4 |
| sl-E | Diagnostics: GVL scope + method dup refactor | Bug 5 + Bug 7 |
| sl-F | References: FOR variable range fix | Bug 6 |

Bugs 1 and 2 are lexer-level, independent.  
Bug 3 and 4 both require adding the extractor pattern — can share a polecat or be split.  
Bugs 5 and 7 are both in `diagnostics.ts` and can be done together.  
Bug 6 is a 2-line fix in `references.ts`.
