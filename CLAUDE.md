# CLAUDE.md — AI Assistant Guide for st-lsp

## Project Overview

**st-lsp** is a Language Server Protocol (LSP) implementation for IEC 61131-3 Structured Text (ST), the programming language used in industrial PLCs (Programmable Logic Controllers). It ships as a VS Code extension that provides:

- Syntax highlighting for `.st` / `.ST` files
- Code completion (keywords, built-in types, standard function blocks, variables)
- Hover documentation (types, variables, POUs)
- Go-to-definition (local variables, POUs, cross-file via TwinCAT project index)
- Syntax diagnostics (real-time parse error reporting)

---

## Repository Structure

```
st-lsp/
├── package.json              # Monorepo root — npm workspaces config + shared scripts
├── tsconfig.json             # Root TypeScript base config
├── package-lock.json
├── LICENSE                   # Apache-2.0
├── README.md
│
├── server/                   # LSP server (Node.js process)
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── server.ts         # Entry point: LSP connection + capability registration
│       ├── handlers/
│       │   ├── completion.ts # CompletionItem[] provider
│       │   ├── definition.ts # Go-to-definition provider
│       │   ├── diagnostics.ts# Syntax error → Diagnostic[] converter
│       │   └── hover.ts      # Hover documentation provider
│       ├── parser/
│       │   ├── ast.ts        # AST node type definitions (interfaces + enums)
│       │   ├── lexer.ts      # Tokenizer for IEC 61131-3 ST
│       │   └── parser.ts     # Recursive-descent parser → SourceFile AST
│       └── twincat/
│           ├── types.ts      # Built-in type catalog (BOOL, INT, REAL, …)
│           ├── stdlib.ts     # Standard function block catalog (TON, CTU, …)
│           ├── workspaceIndex.ts # Scans .tsproj/.plcproj, watches filesystem
│           └── projectReader.ts  # Parses MSBuild XML to extract source file URIs
│
└── client/                   # VS Code extension (thin client)
    ├── package.json          # Extension manifest (publisher, activation, language defs)
    ├── language-configuration.json  # Comment/bracket rules for iec-st
    ├── tsconfig.json
    └── src/
        └── extension.ts      # activate() / deactivate() — starts/stops LSP client
```

---

## Development Workflow

### Setup

```bash
npm install          # Install all workspace dependencies
npm run compile      # Compile both server and client TypeScript
```

### Development (Watch Mode)

```bash
npm run watch        # Recompiles on file changes (both workspaces)
```

### Running the Extension

1. Open the repo root in VS Code.
2. Press **F5** — this launches an Extension Development Host window with the extension loaded.
3. Open any `.st` file in the host window to test LSP features.
4. The debug port for the server is `6009` (configurable in `client/src/extension.ts`).

### Type Checking & Linting

```bash
npm run typecheck    # tsc --noEmit for both workspaces (strict mode)
npm run lint         # ESLint on all TypeScript files
```

### Build Outputs

Compiled JavaScript is emitted to `server/out/` and `client/out/`. These directories are `.gitignore`d.

---

## Architecture

### Monorepo with npm Workspaces

The `server` and `client` are separate npm packages managed as workspaces. They are compiled independently but share the root-level `tsconfig.json` base configuration.

### LSP Transport

The VS Code client spawns the server as a subprocess and communicates via **IPC**. The client registers for the `iec-st` language (`.st` / `.ST` files). No TCP or stdio transport is used.

### Parser Pipeline

```
Source text (.st)
      │
      ▼
  lexer.ts (Lexer)        → Token stream (TokenKind enum + value + position)
      │
      ▼
  parser.ts (Parser)      → SourceFile AST + ParseError[]
      │
      ▼
  handlers/*.ts           → LSP responses (CompletionItem[], Hover, Location, Diagnostic[])
```

### WorkspaceIndex

`workspaceIndex.ts` scans the workspace for TwinCAT project files (`.tsproj`, `.plcproj`) and builds an index of all ST source file URIs. This index enables cross-file go-to-definition. It uses Node.js `fs.watch` with a recursive fallback.

---

## Key Conventions

### TypeScript

- **Strict mode** is on (`"strict": true` in all `tsconfig.json` files). No implicit `any`.
- Target is **ES2020** with `"moduleResolution": "node16"`.
- Prefer **interfaces** over classes for data shapes. Use classes only when behavior (methods, EventEmitter) is needed.
- Use `readonly` arrays and properties where mutation is not intended.

### Naming

| Construct | Convention | Example |
|-----------|-----------|---------|
| Classes / Interfaces | PascalCase | `WorkspaceIndex`, `AstNode` |
| Functions / variables | camelCase | `findNodeAtPosition`, `tokenKind` |
| Enums | PascalCase (members UPPER_CASE) | `TokenKind.IDENTIFIER` |
| File names | camelCase | `workspaceIndex.ts` |

### ST Language Handling

- **Case-insensitive:** All identifier comparisons must use `.toUpperCase()` or `.toLowerCase()` consistently. The lexer normalizes keywords to upper-case token kinds but preserves original casing in `text`.
- **IEC 61131-3 grammar:** Follow the PLCopen standard. The parser covers the common subset used in TwinCAT (Beckhoff).
- **Source extensions supported:** `.st`, `.tcpou`, `.tcgvl`, `.tcdut`, `.tcio`, `.tctask`

### AST Design

- Every `AstNode` carries a `range: Range` (start/end `Position` with `line` and `character`, 0-indexed).
- Statements and expressions are discriminated unions via a `kind` string literal field.
- `ParseError` contains `message`, `range`, and optional `severity`.

### LSP Handler Pattern

All handlers follow this structure:

```typescript
export function handleXxx(
  params: XxxParams,
  documents: TextDocuments<TextDocument>,
  index: WorkspaceIndex,
): XxxResult | null {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return null;
  const { ast } = parse(doc.getText());
  // ... walk AST and build result
}
```

### Error Recovery in the Parser

The parser uses `skipToSemicolon()` to skip malformed statements and continue parsing. This ensures diagnostics are reported even on partially-valid files. Do not silently swallow parse errors — always push to the `errors` array.

---

## Adding New LSP Features

1. **New handler:** Create `server/src/handlers/<feature>.ts` exporting a single `handle<Feature>()` function.
2. **Register in server:** Import and wire up in `server/src/server.ts` under the appropriate `connection.on<Feature>()` or `connection.onRequest()` call.
3. **Declare capability:** Add the capability in the `capabilities` object returned from `onInitialize()` in `server.ts`.
4. **Test manually:** Run the extension via F5 and exercise the feature in an `.st` file.

---

## Adding Built-in Types or Standard Function Blocks

- **Types:** Add to the `BUILTIN_TYPES` map in `server/src/twincat/types.ts`. Provide `size`, `range`, and `description`.
- **Standard FBs:** Add to the `STANDARD_FBS` map in `server/src/twincat/stdlib.ts`. Provide `inputs`, `outputs`, and `description`.

Both catalogs are used by `hover.ts` and `completion.ts` automatically.

---

## No Test Suite (Current State)

There are currently **no automated tests**. When adding tests:

- Place server unit tests under `server/src/__tests__/` (Jest or Vitest recommended).
- The parser is a pure function (`parse(text)`) and is well-suited for snapshot or golden-file tests.
- For LSP integration tests, consider `vscode-languageserver-testing` utilities.

---

## Commit Message Style

Recent commits follow the **Conventional Commits** format:

```
<type>(<scope>): <subject> (<ticket-id>)
```

Examples:
- `feat(lsp): implement hover documentation handler for ST (sl-bf7)`
- `feat: implement auto-completion for ST keywords and variables (sl-6ae)`
- `chore: ignore .gemini/ directory`

Types used: `feat`, `fix`, `refactor`, `chore`, `docs`.

---

## Dependencies

| Package | Purpose |
|---------|---------|
| `vscode-languageserver` | LSP server framework (connection, protocol types) |
| `vscode-languageserver-textdocument` | `TextDocument` utility (line/offset conversion) |
| `vscode-languageclient` | VS Code extension client for LSP |
| `typescript` | Build toolchain |
| `@types/node` | Node.js type definitions |
| `@types/vscode` | VS Code extension API types |

No runtime dependencies outside the LSP libraries. No external parser generator (ANTLR, PEG.js, etc.).

---

## Important Notes for AI Assistants

- **Do not introduce an XML parser dependency** for project file reading — the existing regex-based approach in `projectReader.ts` is intentional.
- **Do not add an AST cache** without benchmarking evidence that it is needed.
- **Preserve case-insensitive matching** for all ST identifiers throughout handlers.
- **Keep handlers pure:** they should take `(params, documents, index)` and return a result. Side effects (file I/O, etc.) belong in `workspaceIndex.ts` or `projectReader.ts`.
- **The `out/` directories are build artifacts** — never commit them; they are in `.gitignore`.
- The extension language ID is `iec-st` (hyphenated) — match this exactly in document selectors.
