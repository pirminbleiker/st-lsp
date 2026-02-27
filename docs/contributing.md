---
layout: default
title: Contributing
nav_order: 5
---

# Contributing & Development Guide

## Prerequisites

- [Node.js](https://nodejs.org/) 20 or later
- [npm](https://www.npmjs.com/) (bundled with Node.js)
- [VS Code](https://code.visualstudio.com/) 1.75 or later
- Git

## Development Setup

### Clone and install

```bash
git clone https://github.com/pirminbleiker/st-lsp.git
cd st-lsp
npm install
npm run compile
```

### Launch the extension host

Press **F5** in VS Code to open an Extension Development Host window with the extension loaded. Open any `.st` or `.TcPOU` file to exercise the language server. The server debug port is `6009`.

### Available scripts

| Script | Command | Description |
|--------|---------|-------------|
| Compile | `npm run compile` | One-off TypeScript build |
| Watch | `npm run watch` | Recompile on file changes |
| Test | `npm run test` | Run the Vitest test suite |
| Type-check | `npm run typecheck` | `tsc --noEmit` for both workspaces |
| Lint | `npm run lint` | ESLint on all TypeScript files |

## Architecture Overview

### Monorepo structure

The repository is an **npm workspaces** monorepo with two packages:

```
st-lsp/
├── server/              # LSP server — Node.js process, all language intelligence
│   └── src/
│       ├── server.ts    # Entry point: LSP connection + capability registration
│       ├── handlers/    # One file per LSP capability
│       ├── parser/      # IEC 61131-3 ST lexer, parser, AST types
│       └── twincat/     # TwinCAT integration: types, stdlib, project index
└── client/              # VS Code extension — thin client that starts the server
    └── src/
        └── extension.ts # activate() / deactivate() — starts the LSP server via IPC
```

The client spawns the server as a subprocess and communicates via **IPC**. No TCP or stdio transport is used.

### `server/src/parser/`

The parser pipeline processes ST source text into an AST on every document change:

| File | Responsibility |
|------|---------------|
| `lexer.ts` | Tokenizer — produces a `Token` stream (`TokenKind` enum + value + position) |
| `ast.ts` | AST node type definitions (interfaces + discriminated unions via `kind`) |
| `parser.ts` | Recursive-descent parser — produces a `SourceFile` AST and `ParseError[]` |

Each LSP handler call re-parses the document from scratch — there is no AST cache.

### `server/src/handlers/`

One file per LSP capability. Each handler follows a pure-function pattern:

```typescript
export function handleXxx(
  params: XxxParams,
  documents: TextDocuments<TextDocument>,
  index: WorkspaceIndex,
): XxxResult | null { ... }
```

### `server/src/twincat/`

TwinCAT / IEC 61131-3 support modules:

| File | Responsibility |
|------|---------------|
| `types.ts` | `BUILTIN_TYPES` catalog (BOOL, INT, REAL, …) |
| `stdlib.ts` | `STANDARD_FBS` catalog (TON, CTU, …) |
| `tcExtractor.ts` | Extracts POU declarations from TwinCAT XML source files |
| `projectReader.ts` | Parses `.tsproj` / `.plcproj` MSBuild XML to extract source file URIs |
| `workspaceIndex.ts` | Scans workspace for project files, builds cross-file symbol index |
| `libraryRegistry.ts` | Registry for TwinCAT library types and function blocks |
| `pragmas.ts` | Pragma / attribute parsing for TwinCAT-specific annotations |

### `client/src/extension.ts`

Registers the `iec-st` language (`.st`, `.ST`, `.TcPOU`, `.TcGVL`, `.TcDUT`) and starts the server subprocess on extension activation. Uses `TransportKind.ipc` for both run and debug modes.

## Testing

Tests live in `server/src/__tests__/` and run with **Vitest**.

```bash
npm run test          # Run all tests once
cd server && npm run test:watch  # Watch mode during development
```

The `tests/fixtures/` directory contains the **mobject-core** reference project — a real TwinCAT project used for integration and regression testing. Key test files:

| File | What it covers |
|------|----------------|
| `parser.test.ts` | Lexer and parser correctness |
| `completion.test.ts` | Keyword, type, and variable completion |
| `hover.test.ts` | Hover documentation |
| `definition.test.ts` | Go-to-definition (local + cross-file) |
| `diagnostics.test.ts` | Syntax error reporting |
| `mobjectIntegration.test.ts` | Full integration against mobject-core fixtures |
| `regression.*.test.ts` | Regression suite covering the TwinCAT feature matrix |

## Adding a New Handler

1. Create `server/src/handlers/myFeature.ts`:

   ```typescript
   import { MyFeatureParams, MyFeatureResult } from 'vscode-languageserver';
   import { TextDocuments } from 'vscode-languageserver/node';
   import { TextDocument } from 'vscode-languageserver-textdocument';
   import { WorkspaceIndex } from '../twincat/workspaceIndex';
   import { parse } from '../parser/parser';

   export function handleMyFeature(
     params: MyFeatureParams,
     documents: TextDocuments<TextDocument>,
     index: WorkspaceIndex,
   ): MyFeatureResult | null {
     const doc = documents.get(params.textDocument.uri);
     if (!doc) return null;
     const { ast } = parse(doc.getText());
     // ... walk AST and build result
     return result;
   }
   ```

2. Import and wire it up in `server/src/server.ts`:

   ```typescript
   import { handleMyFeature } from './handlers/myFeature';
   // inside the connection setup:
   connection.onMyFeature((params) => handleMyFeature(params, documents, index));
   ```

3. Declare the capability in `onInitialize()`:

   ```typescript
   capabilities: {
     myFeatureProvider: true,
   }
   ```

4. Add tests in `server/src/__tests__/myFeature.test.ts`.

## Extending the Parser / AST

### Add a token kind

Add a new member to the `TokenKind` enum in `lexer.ts`, then handle it in the lexer's `nextToken()` method.

### Add an AST node type

Add an interface in `ast.ts` extending `AstNode` with a `kind` string literal and the relevant fields. Add the new type to the appropriate union type (e.g., `Statement | Expression`).

### Add a parser rule

Add a `parse<Construct>()` method in `parser.ts`. Call `skipToSemicolon()` on parse errors — do not silently swallow errors; always push to the `errors` array.

### Test parser changes

Use the mobject-core fixtures for integration tests:

```typescript
import { readFileSync } from 'fs';
import { parse } from '../parser/parser';

const source = readFileSync('tests/fixtures/mobject-core-src/SomeFile.TcPOU', 'utf-8');
const { ast, errors } = parse(source);
```

## Adding Built-in Types or Standard Function Blocks

- **Types:** Add to `BUILTIN_TYPES` in `server/src/twincat/types.ts`. Provide `size`, `range`, and `description`.
- **Standard FBs:** Add to `STANDARD_FBS` in `server/src/twincat/stdlib.ts`. Provide `inputs`, `outputs`, and `description`.

Both catalogs are consumed automatically by `hover.ts` and `completion.ts`.

## Code Conventions

- **Strict TypeScript** — `"strict": true`, no implicit `any`.
- **Case-insensitive ST identifiers** — always use `.toUpperCase()` or `.toLowerCase()` for comparisons. The lexer normalizes keywords to upper-case token kinds but preserves original casing in `text`.
- **Pure handlers** — handlers take `(params, documents, index)` and return a result. Side effects (file I/O) belong in `workspaceIndex.ts` or `projectReader.ts`.
- **`readonly`** — use `readonly` arrays and properties where mutation is not intended.
- **Commit messages** — follow [Conventional Commits](https://www.conventionalcommits.org/): `feat(scope): subject`.

## Submitting Changes

1. Fork the repository and create a feature branch.
2. Implement your change and add tests where applicable.
3. Run the full quality suite before pushing:

   ```bash
   npm run typecheck
   npm run lint
   npm run test
   ```

4. Open a pull request against `main`. CI must pass before merge.
