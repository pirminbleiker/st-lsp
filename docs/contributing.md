---
layout: default
title: Contributing
nav_order: 5
---

# Contributing & Development Guide

## Prerequisites

- [Node.js](https://nodejs.org/) 18 or later
- [VS Code](https://code.visualstudio.com/) 1.75 or later
- Git

## Setup

```bash
git clone https://github.com/pirminbleiker/st-lsp.git
cd st-lsp
npm install
```

## Project Structure

```
st-lsp/
├── server/src/         # LSP server (language intelligence)
│   ├── server.ts       # Entry point, capability registration
│   ├── handlers/       # LSP feature handlers
│   ├── parser/         # Lexer, parser, AST definitions
│   └── twincat/        # TwinCAT project integration & type system
│       ├── workspaceIndex.ts   # Live index of all source files, file watching, AST cache
│       ├── projectReader.ts    # Parses .tsproj/.plcproj to discover sources & library refs
│       ├── tcExtractor.ts      # Extracts ST source from XML formats (.TcPOU, .TcGVL, etc.)
│       ├── types.ts            # Shared data structures (ExtractionResult, PositionMapper)
│       ├── stdlib.ts           # Standard function blocks (timers, counters, edge detectors)
│       ├── systemTypes.ts      # Built-in IEC types, compiler intrinsics, __SYSTEM namespace
│       ├── libraryRegistry.ts  # Ground-truth signatures for Beckhoff standard libraries
│       ├── libraryZipReader.ts # Reads .library/.compiled-library ZIP archives for symbols
│       ├── typeRegistry.ts     # Parameter type mappings for IEC 61131-3 function blocks
│       ├── pragmas.ts          # Pragma/attribute metadata lookup and hover docs
│       └── fsUtils.ts          # Recursive file finder utility
└── client/src/
    └── extension.ts    # VS Code extension (spawns server)
```

## Development Workflow

### Watch mode (recommended)

```bash
npm run watch
```

Then press **F5** in VS Code to launch an Extension Development Host with the extension loaded. Open any `.st` file to exercise the language server.

The debug port for the server is `6009`.

### One-off compile

```bash
npm run compile
```

### Type checking

```bash
npm run typecheck
```

### Linting

```bash
npm run lint
```

## Adding Features

### New LSP handler

1. Create `server/src/handlers/<feature>.ts` exporting `handle<Feature>()`.
2. Wire it up in `server/src/server.ts` under the appropriate `connection.on*()` call.
3. Declare the capability in the `capabilities` object in `onInitialize()`.

### New built-in type

Add an entry to `BUILTIN_TYPES` in `server/src/twincat/types.ts`.

### New standard function block

Add an entry to `STANDARD_FBS` in `server/src/twincat/stdlib.ts`.

## Submitting Changes

1. Fork the repository and create a feature branch.
2. Implement your change with tests where possible.
3. Open a pull request against `main`.

## Code Conventions

- TypeScript strict mode is enabled — no implicit `any`.
- Identifier comparisons must be case-insensitive (use `.toUpperCase()` / `.toLowerCase()`).
- Handlers must be pure functions: `(params, documents, index) → result`. No side effects.
- Follow [Conventional Commits](https://www.conventionalcommits.org/) for commit messages.
