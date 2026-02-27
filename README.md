# ST LSP — Structured Text Language Server for VS Code

> Full-featured LSP extension for IEC 61131-3 Structured Text (TwinCAT 3 / Beckhoff PLCs)

[![CI](https://github.com/pirminbleiker/st-lsp/actions/workflows/ci.yml/badge.svg)](https://github.com/pirminbleiker/st-lsp/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/pirminbleiker/st-lsp?include_prereleases&label=canary)](https://github.com/pirminbleiker/st-lsp/releases/tag/canary)

---

## Features

### Intelligence
| Feature | Description |
|---------|-------------|
| **Completion** | Keywords, built-in types, stdlib FBs, local variables, cross-file POUs |
| **Member Completion** | Dot-accessor `.` for FUNCTION_BLOCK instances and STRUCT fields |
| **Enum-aware Completion** | Shows enum values after `:=` assignment and in CASE selectors |
| **Library-aware Completion** | Completion filtered to referenced libraries in `.plcproj` |
| **SUPER^ Completion** | Inherited method/property access in extended FBs |
| **Hover** | Type info, stdlib documentation, pragma attributes |
| **Go-to-Definition** | Local and cross-file navigation for POUs, variables, types |
| **Find References** | Cross-file reference lookup |
| **Rename Symbol** | Cross-file rename for POUs and variables |
| **Workspace Symbols** | Ctrl+T global symbol search |
| **Signature Help** | Parameter hints on function/FB calls |
| **Inlay Hints** | Parameter names shown inline in calls |

### Diagnostics
| Feature | Description |
|---------|-------------|
| **Syntax Diagnostics** | Parser errors with line/column positions |
| **Semantic Diagnostics** | Type mismatches, undefined types, undeclared identifiers |
| **Library Diagnostics** | Warns when using symbols from unreferenced libraries |
| **Code Actions** | QuickFix: declare variable, add library reference |

### Navigation & Editor
| Feature | Description |
|---------|-------------|
| **Document Symbols** | Outline view: POUs, methods, variables |
| **Folding Ranges** | Collapse VAR blocks, IF/FOR/WHILE/CASE, FB bodies |
| **Semantic Tokens** | Rich LSP-based syntax highlighting |
| **Document Formatting** | Keyword casing normalization (IF → IF, not if) |
| **Code Lens** | Shows implementation count on INTERFACE methods |

### TwinCAT-specific
| Feature | Description |
|---------|-------------|
| **TwinCAT XML** | Parses `.TcPOU`, `.TcGVL`, `.TcDUT`, `.TcIO` files natively |
| **Project Files** | Reads `.plcproj` / `.tspproj` (TcSmProject format) for source discovery |
| **ACTION blocks** | Full parser and LSP support for TwinCAT ACTION sections |
| **Pragma Docs** | Hover documentation for `{attribute 'hide'}`, `{attribute 'monitoring' := 'call'}`, etc. |
| **Standard Library** | Built-in catalog for `Tc2_Standard`, `Tc2_MC2`, `Tc2_System`, `Tc2_Utilities` |

---

## Installation

### From GitHub Releases (recommended for testing)

1. Download the latest `.vsix` from [GitHub Releases → Canary](https://github.com/pirminbleiker/st-lsp/releases/tag/canary)
2. In VS Code: `Extensions` → `...` → `Install from VSIX...`
3. Select the downloaded `.vsix` file

### From Source

```bash
git clone https://github.com/pirminbleiker/st-lsp.git
cd st-lsp
npm install
npm run compile
npm run package   # produces st-lsp-client-*.vsix in client/
```

Then install the generated `.vsix` as described above.

---

## Supported File Types

| Extension | Description |
|-----------|-------------|
| `.st` | Plain Structured Text |
| `.TcPOU` | TwinCAT Program Organization Unit (FB, Program, Function) |
| `.TcGVL` | TwinCAT Global Variable List |
| `.TcDUT` | TwinCAT Data Unit Type (STRUCT, ENUM, ALIAS) |
| `.TcIO` | TwinCAT I/O mapping |

---

## Development

```bash
npm install
npm run compile      # build server + client
npm run test         # run Jest tests (server)
npm run typecheck    # TypeScript type checking
npm run lint         # ESLint
```

Open the repo in VS Code and press **F5** to launch the Extension Development Host.

### Project Structure

```
st-lsp/
├── server/          # LSP server (TypeScript)
│   └── src/
│       ├── handlers/        # LSP request handlers
│       ├── parser/          # IEC 61131-3 lexer + AST parser
│       └── twincat/         # TwinCAT-specific: XML extraction, project reader, stdlib
├── client/          # VS Code extension (TypeScript)
│   └── src/
│       └── extension.ts     # Extension entry point, starts LSP server
└── tests/           # Integration tests
```

---

## Documentation

Full documentation available at **[pirminbleiker.github.io/st-lsp](https://pirminbleiker.github.io/st-lsp)**

- [Installation Guide](https://pirminbleiker.github.io/st-lsp/installation)
- [Feature Reference](https://pirminbleiker.github.io/st-lsp/features)
- [Release Notes](https://pirminbleiker.github.io/st-lsp/release-notes)
- [Contributing](https://pirminbleiker.github.io/st-lsp/contributing)
