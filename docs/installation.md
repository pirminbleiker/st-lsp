---
layout: default
title: Installation
nav_order: 2
---

# Installation & Quick Start

## Prerequisites

- [Visual Studio Code](https://code.visualstudio.com/) 1.75 or later
- Node.js is **not** required — the extension bundles its own language server

## Install from Marketplace

1. Open VS Code
2. Press `Ctrl+P` (or `Cmd+P` on macOS)
3. Type `ext install st-lsp` and press Enter
4. Click **Install**

## Install from VSIX (Canary)

Download the latest `.vsix` from the [canary release](https://github.com/pirminbleiker/st-lsp/releases/tag/canary):

```bash
code --install-extension st-lsp-*.vsix
```

Or via the VS Code UI: **Extensions → ⋯ → Install from VSIX…**

## Quick Start

1. Open a folder containing `.st` files (or a TwinCAT project).
2. Open any `.st` file — the language server activates automatically.
3. Start typing to see completions, hover over symbols for documentation, and use **Go to Definition** (`F12`) to navigate.

## Supported File Extensions

| Extension | Description |
|-----------|-------------|
| `.st` / `.ST` | Standard IEC 61131-3 Structured Text |
| `.tcpou` | TwinCAT POU file |
| `.tcgvl` | TwinCAT Global Variable List |
| `.tcdut` | TwinCAT Data Unit Type |
| `.tcio` | TwinCAT I/O mapping |
| `.tctask` | TwinCAT Task configuration |

## TwinCAT Project Integration

For cross-file **Go-to-Definition**, open your workspace root containing a `.tsproj` or `.plcproj` file. The extension automatically indexes all ST source files in the project.
