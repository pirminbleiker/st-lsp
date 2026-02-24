# st-lsp

IEC 61131-3 Structured Text Language Server Protocol implementation for VS Code.

## Structure

This is a TypeScript monorepo with two packages:

- **`server/`** — LSP server using [vscode-languageserver-node](https://github.com/microsoft/vscode-languageserver-node)
- **`client/`** — VS Code extension that starts the server and communicates via LSP

## Getting Started

```bash
npm install
npm run compile
```

## Development

Open the repo in VS Code and press `F5` to launch the Extension Development Host.

## Features

- Syntax highlighting for `.st` files (IEC 61131-3 Structured Text)
- Language server with:
  - Text document synchronization
  - Completion provider
  - Hover provider
  - Go-to-definition provider

Actual ST language intelligence is implemented in follow-up PRs.
