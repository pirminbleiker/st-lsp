# Plan: Virtual Structured Text View for TcPOU Files

**Created:** 2026-03-02
**Status:** Ready for Atlas Execution

## Summary

Implement an **"Open as Structured Text"** command in the VS Code extension that opens a clean, read-only virtual document showing *only* the extracted Structured Text content from a TcPOU/TcGVL/TcDUT file — with zero XML noise. This is fundamentally different from folding: there is no XML at all in the virtual view, not even collapsed. The virtual document uses language `iec-st` so syntax highlighting works, and it auto-refreshes when the underlying TcPOU file changes.

## Why Folding Alone Is Not Enough

| Approach | XML on mixed lines visible? | FBs/Methods visible? | Requires VS Code version |
|---|---|---|---|
| Line-level folding (old) | ✅ Yes (fold start lines show XML) | ✅ | ^1.85 |
| Character-level folding (current) | ⚠️ Only if VS Code ≥ 1.91 + lineFoldingOnly=false | ✅ | ≥1.91 |
| **Virtual ST document (this plan)** | ❌ No XML at all | ✅ | ^1.85 |

VS Code sends `lineFoldingOnly: true` for versions < 1.91, which falls back to our line-level code. Even on 1.91+, the fold indicator line itself remains visible. The virtual document approach eliminates XML entirely regardless of VS Code version.

## Context & Analysis

### Architecture

```
TcPOU file (file://)          Virtual ST view (tcpou-st://)
┌─────────────────────┐       ┌─────────────────────────┐
│ <?xml ...           │  ───▶ │ FUNCTION_BLOCK Foo       │
│ <Declaration>       │  cmd  │ VAR                      │
│   <![CDATA[         │       │   x : INT;              │
│ FUNCTION_BLOCK Foo  │       │ END_VAR                  │
│ ...                 │       │                          │
│ ]]></Declaration>   │       │ METHOD PUBLIC AddOrUpdate│
└─────────────────────┘       └─────────────────────────┘
  LSP features work here         Read-only, pure ST view
```

### Virtual Document URI Scheme

- TcPOU: `file:///path/to/Foo.TcPOU` → `tcpou-st:///path/to/Foo.TcPOU`
- TcGVL: `file:///path/to/Globals.TcGVL` → `tcpou-st:///path/to/Globals.TcGVL`
- Only TwinCAT XML extensions (`.TcPOU`, `.TcGVL`, `.TcDUT`, `.TcIO`) need this; `.st` files already are pure ST

### How `TextDocumentContentProvider` Works

```typescript
// Registered in extension.ts:
vscode.workspace.registerTextDocumentContentProvider('tcpou-st', {
  provideTextDocumentContent(uri: vscode.Uri): string {
    // uri is tcpou-st:///path/to/Foo.TcPOU
    // Returns the extracted ST source
  }
});
```

### Extraction on Client Side vs Server Request

**Option A (simpler): Client calls custom LSP request**
- Server handles `tcpou/extractedSource` request → calls `extractST()` → returns `{source: string}`
- Client calls this from the content provider
- Keeps extraction logic in one place (server)

**Option B: Client bundles extraction inline**
- Client imports/duplicates `extractST()` from `tcExtractor.ts`
- No round-trip to server, simpler
- BUT: violates DRY — any change to extraction must be updated in two places

**Recommendation:** Option A (LSP custom request). One source of truth.

### Key Files

| File | Role | Change |
|---|---|---|
| `server/src/server.ts` | LSP entry point | Add `connection.onRequest('tcpou/extractedSource', ...)` handler |
| `server/src/handlers/extractedSource.ts` | New handler | Returns extracted ST for a URI |
| `client/src/extension.ts` | VS Code extension | Register content provider + command + auto-refresh |
| `client/package.json` | Extension manifest | Register `st-lsp.openAsStructuredText` command + context menu |

### Key Functions/Classes

- `extractST(text, ext)` in `tcExtractor.ts` — already returns clean source; no changes needed
- `TextDocuments<TextDocument>` in `server.ts` — used to get file content for the request handler
- `vscode.workspace.registerTextDocumentContentProvider` — VS Code API for virtual documents
- `vscode.commands.registerCommand` — registers the "Open as ST" command

---

## Implementation Phases

### Phase 1: Server-side Custom Request Handler

**Objective:** Expose a custom LSP request `tcpou/extractedSource` that the client can call to get the clean ST source for any TcPOU file URI.

**Files to Modify/Create:**
- `server/src/server.ts` — add `connection.onRequest(...)` handler
- `server/src/handlers/extractedSource.ts` — new handler function

**Steps:**

1. **Create `server/src/handlers/extractedSource.ts`:**
   ```typescript
   import * as path from 'path';
   import { TextDocuments } from 'vscode-languageserver/node';
   import { TextDocument } from 'vscode-languageserver-textdocument';
   import { extractST } from '../twincat/tcExtractor';

   export interface ExtractedSourceParams {
     uri: string;
   }
   
   export interface ExtractedSourceResult {
     source: string;
   }

   const XML_EXT_SET = new Set(['.tcpou', '.tcgvl', '.tcdut', '.tcio', '.tctask']);

   export function handleExtractedSource(
     params: ExtractedSourceParams,
     documents: TextDocuments<TextDocument>,
   ): ExtractedSourceResult {
     const doc = documents.get(params.uri);
     if (!doc) return { source: '' };
     const ext = path.extname(doc.uri).toLowerCase();
     if (!XML_EXT_SET.has(ext)) return { source: doc.getText() };
     const { source } = extractST(doc.getText(), ext);
     return { source };
   }
   ```

2. **In `server/src/server.ts` — import and wire up:**
   ```typescript
   import { handleExtractedSource, ExtractedSourceParams, ExtractedSourceResult } from './handlers/extractedSource';
   ```
   
   Add the request handler (after `connection.onFoldingRanges`):
   ```typescript
   connection.onRequest(
     'tcpou/extractedSource',
     (params: ExtractedSourceParams): ExtractedSourceResult => {
       return handleExtractedSource(params, documents);
     }
   );
   ```

3. **Write tests in `server/src/__tests__/extractedSource.test.ts`:**
   - Test with `.TcPOU` document → returns extracted ST (no XML)
   - Test with `.st` document → returns original text unchanged
   - Test with unknown URI → returns empty string
   - Test with `.TcGVL` document → returns extracted declarations

**Acceptance Criteria:**
- [ ] `handleExtractedSource` returns only ST content for TcPOU/TcGVL/etc.
- [ ] Returns original text for `.st` files
- [ ] Returns `{ source: '' }` for unknown URIs
- [ ] Server registers the request handler at `tcpou/extractedSource`
- [ ] TypeScript compiles clean

---

### Phase 2: Client-side Virtual Document + Command

**Objective:** Register a `TextDocumentContentProvider`, a command, and auto-refresh logic in `extension.ts`. Add the command to the context menu for TcPOU files in `package.json`.

**Files to Modify:**
- `client/src/extension.ts`
- `client/package.json`

**Steps:**

1. **In `extension.ts` — register content provider and command:**

   ```typescript
   import * as vscode from 'vscode';
   import * as path from 'path';
   import { ExtensionContext, Uri } from 'vscode';
   import { LanguageClient, ... } from 'vscode-languageclient/node';
   ```

   After `client.start()`:
   ```typescript
   const VIRTUAL_SCHEME = 'tcpou-st';
   const XML_EXTS = new Set(['.tcpou', '.tcgvl', '.tcdut', '.tcio', '.tctask']);
   
   // Source cache: virtual URI string → extracted ST source
   const sourceCache = new Map<string, string>();
   
   // EventEmitter to trigger document refresh when TcPOU changes
   const onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri>();
   
   // Register TextDocumentContentProvider
   const contentProvider: vscode.TextDocumentContentProvider = {
     onDidChange: onDidChangeEmitter.event,
     async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
       // uri has scheme 'tcpou-st', convert to 'file' scheme
       const fileUri = uri.with({ scheme: 'file' });
       try {
         const result = await client.sendRequest<{ source: string }>(
           'tcpou/extractedSource',
           { uri: fileUri.toString() }
         );
         const src = result?.source ?? '';
         sourceCache.set(uri.toString(), src);
         return src;
       } catch {
         return sourceCache.get(uri.toString()) ?? '';
       }
     }
   };
   
   context.subscriptions.push(
     vscode.workspace.registerTextDocumentContentProvider(VIRTUAL_SCHEME, contentProvider)
   );
   
   // Command: Open as Structured Text
   context.subscriptions.push(
     vscode.commands.registerCommand('st-lsp.openAsStructuredText', async (resourceUri?: vscode.Uri) => {
       // Can be invoked from context menu (resourceUri) or command palette (use active editor)
       const fileUri = resourceUri ?? vscode.window.activeTextEditor?.document.uri;
       if (!fileUri) {
         vscode.window.showWarningMessage('No TcPOU file selected.');
         return;
       }
       const ext = path.extname(fileUri.fsPath).toLowerCase();
       if (!XML_EXTS.has(ext)) {
         vscode.window.showWarningMessage('This command only works on TwinCAT XML files (.TcPOU, .TcGVL, etc.)');
         return;
       }
       const virtualUri = fileUri.with({ scheme: VIRTUAL_SCHEME });
       const doc = await vscode.workspace.openTextDocument(virtualUri);
       await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside, preview: false });
     })
   );
   
   // Auto-refresh virtual document when the source TcPOU file changes
   context.subscriptions.push(
     vscode.workspace.onDidChangeTextDocument(event => {
       const uri = event.document.uri;
       const ext = path.extname(uri.fsPath).toLowerCase();
       if (XML_EXTS.has(ext) && uri.scheme === 'file') {
         const virtualUri = uri.with({ scheme: VIRTUAL_SCHEME });
         onDidChangeEmitter.fire(virtualUri);
       }
     })
   );
   ```

2. **In `client/package.json` — register command + context menu:**

   Add to `"contributes"`:
   ```json
   "commands": [
     {
       "command": "st-lsp.openAsStructuredText",
       "title": "Open as Structured Text",
       "category": "ST-LSP"
     }
   ],
   "menus": {
     "editor/title/context": [
       {
         "command": "st-lsp.openAsStructuredText",
         "when": "resourceExtname =~ /^\\.(TcPOU|TcGVL|TcDUT|TcIO)$/i",
         "group": "navigation"
       }
     ],
     "explorer/context": [
       {
         "command": "st-lsp.openAsStructuredText",
         "when": "resourceExtname =~ /^\\.(TcPOU|TcGVL|TcDUT|TcIO)$/i",
         "group": "navigation"
       }
     ]
   }
   ```

   The virtual document should use `iec-st` language so syntax highlighting works. This is automatic because VS Code maps the language based on the content, but we can also ensure it by using `languageId` in the `openTextDocument` call:
   ```typescript
   // The textDocument is opened as iec-st because the file extension triggers
   // the iec-st language mapping. If not, add:
   await vscode.languages.setTextDocumentLanguage(doc, 'iec-st');
   ```

**Acceptance Criteria:**
- [ ] Command `st-lsp.openAsStructuredText` appears in command palette
- [ ] Command appears in editor tab context menu for `.TcPOU` files
- [ ] Opening the command shows a side-by-side read-only `tcpou-st:` virtual document
- [ ] Document shows only ST content — no XML wrapper lines
- [ ] Virtual document has `iec-st` language and syntax highlighting
- [ ] Editing the TcPOU source refreshes the virtual view within ~1 second
- [ ] Non-XML files show a warning message when command is invoked
- [ ] TypeScript compiles clean

---

### Phase 3: Tests and Validation

**Objective:** Unit tests for the server handler; manual test checklist for the client command.

**Files to Modify/Create:**
- `server/src/__tests__/extractedSource.test.ts` — new test file

**Steps for server tests:**

```typescript
import { describe, it, expect } from 'vitest';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { handleExtractedSource } from '../handlers/extractedSource';
import { TextDocuments } from 'vscode-languageserver/node';

// Helper to build a mock TextDocuments map
function makeDocs(map: Record<string, { content: string; ext: string }>) {
  // Return object with .get() method
}

describe('handleExtractedSource', () => {
  it('returns only ST for a TcPOU document', () => { ... });
  it('returns original text for a .st document', () => { ... });
  it('returns empty for unknown URI', () => { ... });
  it('returns declarations for a TcGVL document', () => { ... });
});
```

**Manual validation checklist (for Atlas to verify by reading code):**
- [ ] Context menu appears for `.TcPOU` files (correct `when` clause)
- [ ] Language ID is set to `iec-st` for the virtual document
- [ ] `onDidChange` event causes re-fetch from server (not just cache)
- [ ] Error handling if server not running (fallback to cache)

**Acceptance Criteria:**
- [ ] All tests pass
- [ ] `npm run compile` succeeds
- [ ] No regressions in existing tests

---

## Open Questions

1. **Should the virtual document be editable?**
   - **Option A:** Read-only (current plan) — simpler; LSP features (hover, completion) still work in the original TcPOU file
   - **Option B:** Editable with write-back (changes in virtual doc apply to TcPOU) — complex position remapping required
   - **Recommendation:** Option A. The virtual view is for *reading* the clean ST. Editing is done in the original TcPOU file where LSP features are active.

2. **What about `.st`-only mode (no XML at all)?**
   - The user could work exclusively with `.st` files instead of TwinCAT XML if they prefer
   - This is a TwinCAT workflow change, not an LSP concern

3. **Should LSP features work in the virtual document?**
   - Currently: No — the virtual `tcpou-st://` URI is not known to the server
   - Future: Could map `tcpou-st://` requests back to the underlying `file://` TcPOU file with position translation
   - **Recommendation:** Out of scope for this plan. The original TcPOU editor has full LSP features.

4. **Tab title for virtual document?**
   - VS Code will show the URI path as the title: `Foo.TcPOU — tcpou-st`
   - We could use a custom label via `vscode.window.showTextDocument({ label: 'Foo.st (ST View)' })` — but `label` on `TextDocumentShowOptions` is relatively new
   - **Recommendation:** Accept the default tab title; it's clear enough.

## Risks & Mitigation

- **Risk:** `client.sendRequest()` fails before server is ready (cold start)
  - **Mitigation:** Wrap in try/catch; return cached value or empty string. The retry will happen when `onDidChange` fires.

- **Risk:** Virtual document URI doesn't auto-detect `iec-st` language
  - **Mitigation:** Explicitly call `vscode.languages.setTextDocumentLanguage(doc, 'iec-st')` after opening.

- **Risk:** TextDocuments in server doesn't have the TcPOU file open if user opens virtual doc without first opening TcPOU
  - **Mitigation:** In the command handler, first `vscode.workspace.openTextDocument(fileUri)` to force VS Code to load the file (which triggers the LSP `textDocument/didOpen` notification), then open the virtual view.

## Success Criteria

- [ ] User can open any `.TcPOU` file and invoke "Open as Structured Text" to see a clean side-by-side ST view
- [ ] The virtual view shows all extracted ST: FB declarations, methods, properties, actions — no XML wrapper lines
- [ ] Syntax highlighting works in the virtual view
- [ ] The view updates automatically when the TcPOU file is edited
- [ ] Existing folding, semantic tokens, and all other LSP features still work unchanged in the original TcPOU editor

## Notes for Atlas

- **Phase order matters:** Phase 1 (server handler) must be done before Phase 2 (client calls it).
- **Do NOT change `tcExtractor.ts`** — `extractST()` already returns the perfect clean source.
- The `TextDocuments` mock in tests is tricky because `vscode-languageserver` doesn't export a simple constructor for tests. Use a `Map<string, TextDocument>` wrapped with a `.get()` method, or look at how other test files mock it.
- For `client/package.json` — check if `"commands"` and `"menus"` arrays already exist under `"contributes"` and merge, don't replace.
- The `when` clause for context menu uses `resourceExtname` — this is a VS Code context variable for the file extension *including the dot*. Use `=~` regex for case-insensitive match: `"resourceExtname =~ /^\\.(TcPOU|TcGVL|TcDUT|TcIO)$/i"`.
- The `vscode` import in `extension.ts` — add `Uri` and `EventEmitter` to the named imports if needed, or use `vscode.EventEmitter` and `vscode.Uri` directly.
