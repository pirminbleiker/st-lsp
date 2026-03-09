---
layout: default
title: Release Notes
nav_order: 4
---

# Release Notes

## v1.7.1

> [GitHub Release](https://github.com/pirminbleiker/st-lsp/releases/tag/v1.7.1)

### Bug Fixes
- **Parser** — handle dotted type names (e.g. `__SYSTEM.IQueryInterface`) in `parseTypeRef()`, eliminating false "Unknown type" warnings for namespace-qualified types

## v1.7.0

> [GitHub Release](https://github.com/pirminbleiker/st-lsp/releases/tag/v1.7.0)

### Features
- **Signature Help** — show all parameter directions (`VAR_INPUT`, `VAR_OUTPUT`, `VAR_IN_OUT`), optional status, return types, and compiled library methods

### Bug Fixes
- Distinguish `FUNCTION` from `FUNCTION_BLOCK` in compiled libraries

## v1.6.0

> [GitHub Release](https://github.com/pirminbleiker/st-lsp/releases/tag/v1.6.0)

### Features
- **Compiled library support** — resolve compiled libraries from the TwinCAT installation path, enabling completion, hover, and diagnostics for installed libraries

## v1.5.0

> [GitHub Release](https://github.com/pirminbleiker/st-lsp/releases/tag/v1.5.0)

### Features
- **Completion** — `POINTER TO` and `REFERENCE TO` offered as compound keywords in type contexts
- **Completion / Hover** — resolve `__SYSTEM.*` qualified member access for system namespace types

## v1.4.0

> [GitHub Release](https://github.com/pirminbleiker/st-lsp/releases/tag/v1.4.0)

### Features
- **Library indexing** — filter library indexing by `.plcproj` library references, reducing noise from unused libraries

## v1.3.0

> [GitHub Release](https://github.com/pirminbleiker/st-lsp/releases/tag/v1.3.0)

### Features
- **Lexer** — `POINTER` and `REFERENCE` are now proper keywords with syntax highlighting and completion support

## v1.2.0

> [GitHub Release](https://github.com/pirminbleiker/st-lsp/releases/tag/v1.2.0)

### Features
- **Virtual ST view** — virtual structured text view for TcPOU files
- **Completion** — member-access dot completion on objects, `THIS^`/`SUPER^` completion with inheritance and visibility filtering, enum-aware completion on `:=` assignment and `CASE` selector, unqualified local completion for own methods/properties/actions
- **Hover** — constant value resolution, var block kind and value range display
- **Diagnostics** — semantic type diagnostics, BOOL-to-numeric mismatch detection, warning-level undefined identifier errors
- **Code Actions** — QuickFix suggestions for diagnostics
- **Inlay Hints** — parameter name hints on function/FB calls
- **CodeLens** — reference counts, interface implementors, FB children, method overrides
- **Parser** — AST visitor pattern, `TYPE`/`STRUCT`/`ENUM`/`METHOD`/`INTERFACE` support, typed enum parsing, `VAR CONSTANT`/`RETAIN`/`PERSISTENT`, `CASE` statement sub-code, `AND_THEN`/`OR_ELSE` operators, `TYPE`/`UNION`/`NAMESPACE` support
- **TwinCAT** — system types and intrinsics catalog, type registry for compiled library parameter types, recursive `.plcproj` discovery
- **Standard library** — symbol catalog for built-in types and standard function blocks

### Bug Fixes
- Downgrade unresolvable `EXTENDS` to warning, suppress inherited member errors
- Allow trailing semicolons after control structures
- Fix multiline semantic token lengths
- TcPOU extraction and position translation for references/rename/signatureHelp

## v1.1.0

> [GitHub Release](https://github.com/pirminbleiker/st-lsp/releases/tag/v1.1.0)

### Features
- **TcPOU** — XML/CDATA folding and dimming in TcPOU files

## v1.0.0

> [GitHub Release](https://github.com/pirminbleiker/st-lsp/releases/tag/v1.0.0)

Initial release with core Language Server Protocol features for IEC 61131-3 Structured Text:

- **Syntax highlighting** for `.st`, `.tcpou`, `.tcgvl`, `.tcdut`, `.tcio`, `.tctask` files
- **Code completion** — keywords, built-in types, standard function blocks, local and cross-file variables
- **Hover documentation** — built-in types, standard FBs, variables, POUs, pragma attributes
- **Go-to-Definition** — variables, POUs, type references, FB members, cross-file via workspace index
- **Find All References** — variables, type annotations, cross-file
- **Rename Symbol** — variables, `FOR` loop variables, cross-file
- **Signature Help** — function and function block call parameter hints
- **Diagnostics** — real-time syntax error reporting with error recovery
- **Document Symbols** — outline view with VAR section grouping
- **Workspace Symbols** — `Ctrl+T` search for POUs and types
- **Folding Ranges** — code folding for ST constructs
- **Formatting** — document and range formatting
- **Semantic Tokens** — enhanced syntax highlighting via semantic analysis
- **TwinCAT integration** — `.tsproj`/`.plcproj` project indexing, TcPOU XML extraction
- **VS Code extension** — bundled VSIX with client and server

---

*This project follows [Semantic Versioning](https://semver.org/).*
