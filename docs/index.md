---
layout: home
title: Home
nav_order: 1
---

# ST LSP — Structured Text Language Server

**IEC 61131-3 Structured Text language support for VS Code**

Bring modern IDE features to your PLC programming workflow with full LSP support for Structured Text (`.st`) files, including TwinCAT project integration.

---

## Features

| Feature | Description |
|---------|-------------|
| **Syntax Highlighting** | Full token-level highlighting for IEC 61131-3 ST |
| **Code Completion** | Keywords, built-in types, standard function blocks, local variables |
| **Hover Documentation** | Type info, variable declarations, POU signatures |
| **Go-to-Definition** | Navigate to local variables, POUs, and cross-file symbols |
| **Diagnostics** | Real-time parse error reporting with precise locations |

---

## Quick Start

1. Install from the VS Code Marketplace (search **ST LSP**), or install the `.vsix` from [Releases](https://github.com/pirminbleiker/st-lsp/releases/tag/canary).
2. Open any `.st` file — the language server activates automatically.
3. For TwinCAT cross-file features, open your workspace root containing a `.tsproj` or `.plcproj` file.

---

## Navigation

- [Installation](installation.md) — Install guide and quick-start
- [Features](features/) — Detailed feature reference
- [Release Notes](release-notes.md) — Changelog
- [Contributing](contributing.md) — Development setup and contribution guide
