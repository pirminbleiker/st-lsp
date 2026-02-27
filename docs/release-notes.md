---
layout: default
title: Release Notes
nav_order: 4
---

# Release Notes

## Canary

> Latest pre-release build. Install from [GitHub Releases](https://github.com/pirminbleiker/st-lsp/releases/tag/canary).

### Features
- **Syntax highlighting** for IEC 61131-3 Structured Text (`.st`, `.tcpou`, `.tcgvl`, `.tcdut`, `.tcio`, `.tctask`)
- **Code completion** — keywords, built-in types, standard function blocks, local variables
- **Hover documentation** — built-in types, standard FBs, local variables, POUs
- **Go-to-Definition** — local variables, POUs within a file, cross-file via TwinCAT project index
- **Diagnostics** — real-time syntax error reporting with error recovery
- **TwinCAT integration** — auto-indexes `.tsproj` / `.plcproj` projects for cross-file navigation

---

*This project follows [Semantic Versioning](https://semver.org/). A stable 1.0 release will be tagged once the feature set stabilises.*
