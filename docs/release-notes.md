---
layout: default
title: Release Notes
nav_order: 4
---

# Release Notes

## v0.1.0 — Initial Feature Complete
*Released: 2026-02-27*

This release marks the completion of the initial feature set for ST LSP — a full-featured Language Server Protocol implementation for IEC 61131-3 Structured Text, with deep TwinCAT integration.

### ✨ New Features

**Core Intelligence**
- **Member Completion** — dot-accessor completion for `FUNCTION_BLOCK` instances and `STRUCT` members ([sl-trov](https://github.com/pirminbleiker/st-lsp))
- **Enum-aware Completion** — type-aware suggestions on `:=` assignment and `CASE` selectors ([sl-pjr8](https://github.com/pirminbleiker/st-lsp))
- **Semantic Type Diagnostics** — type mismatch warnings and undefined type errors with precise locations ([sl-yz1m](https://github.com/pirminbleiker/st-lsp))
- **Library-aware Completion and Hover** — provenance shown in hover, missing-library diagnostics when symbol source is unavailable ([sl-wqzi](https://github.com/pirminbleiker/st-lsp))
- **SUPER^ Completion** — member completion and go-to-definition for `SUPER^` in extended function blocks ([sl-ifri](https://github.com/pirminbleiker/st-lsp))
- **Cross-file Completion** — workspace-wide symbol completion with prefix filtering via WorkspaceIndex ([sl-8zjk](https://github.com/pirminbleiker/st-lsp))
- **Standard Library Catalog** — built-in symbol catalog for `Tc2_Standard`, `Tc2_MC2`, `Tc2_System`, and `Tc2_Utilities` ([sl-chlu](https://github.com/pirminbleiker/st-lsp))

**Editor Features**
- **Document Formatting** — keyword normalization to UPPER_CASE for IEC 61131-3 compliance ([sl-71qj](https://github.com/pirminbleiker/st-lsp))
- **Inlay Hints** — parameter name hints on function block and function calls ([sl-ht3i](https://github.com/pirminbleiker/st-lsp))
- **Folding Ranges** — collapsible `VAR` blocks, `IF`/`FOR`/`WHILE` bodies, and function block bodies ([sl-m86e](https://github.com/pirminbleiker/st-lsp))
- **Semantic Tokens** — LSP-based syntax highlighting with token type and modifier classification ([sl-6sfv](https://github.com/pirminbleiker/st-lsp))
- **Code Actions / QuickFix** — context-aware quick fixes for diagnostics ([sl-5l3e](https://github.com/pirminbleiker/st-lsp))
- **Code Lens** — "N implementations" on `INTERFACE` methods, child FB count on base types ([sl-m9nw](https://github.com/pirminbleiker/st-lsp))
- **Workspace Symbol Search** — `Ctrl+T` search across all POUs, types, and global variables ([sl-zz12](https://github.com/pirminbleiker/st-lsp))

**TwinCAT-specific**
- **ACTION blocks** — full parser and LSP support for `.TcPOU` ACTION sections ([sl-s83g](https://github.com/pirminbleiker/st-lsp))
- **plcproj/tsproj parser** — TcSmProject format, `.tspproj` extension, metadata, and folder structure ([sl-cbov](https://github.com/pirminbleiker/st-lsp))
- **Pragma/Attribute documentation** — hover documentation for TwinCAT pragmas and attributes ([sl-ktnh](https://github.com/pirminbleiker/st-lsp))

**Tests & Quality**
- **Integration tests** — handler tests with real-world `mobject-core` POUs ([sl-eank](https://github.com/pirminbleiker/st-lsp))
- **Regression tests** — full TwinCAT feature matrix including `TYPE`, `UNION`, `NAMESPACE`, `INTERFACE`, `METHOD` ([sl-ou3f](https://github.com/pirminbleiker/st-lsp))
- **E2E workflow tests** — VS Code extension end-to-end tests with `.TcPOU` files ([sl-a48z](https://github.com/pirminbleiker/st-lsp))

**Foundation Features** *(shipped earlier in the pre-release cycle)*
- Auto-completion for ST keywords, built-in types, and local variables
- Hover documentation for built-in types, standard function blocks, and local variables
- Go-to-Definition for local variables, POUs within a file, and cross-file via TwinCAT project index
- Real-time syntax diagnostics with error recovery
- Rename Symbol and Find All References
- Signature Help for function and function block calls
- Document Symbols (`Ctrl+Shift+O`)
- Semantic diagnostics for undefined variables and duplicate declarations
- TwinCAT `.tsproj` / `.plcproj` workspace indexer

### 🚀 Distribution
- **VSIX packaging** — installable `.vsix` artifact via `npm run package` ([sl-mr4t](https://github.com/pirminbleiker/st-lsp))
- **CI/CD pipeline** — GitHub Actions workflow with lint, typecheck, and test gates ([sl-30i8](https://github.com/pirminbleiker/st-lsp))
- **Canary releases** — rolling pre-release builds on the `canary` tag

---

## What's Next

The following capabilities are planned for upcoming releases:

- **Signature Help improvements** — richer parameter documentation with type annotations
- **Rename across files** — workspace-wide symbol rename (currently single-file)
- **Test coverage expansion** — broader integration test coverage for edge cases
- **Performance optimisation** — AST caching layer for large workspaces
- **Find All References** — UI polish and cross-file reference aggregation
- **Additional TwinCAT formats** — `.tcdb`, `.tclib` import support

---

*This project follows [Semantic Versioning](https://semver.org/). A stable 1.0 release will be tagged once the API surface stabilises.*
