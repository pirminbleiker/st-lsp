---
layout: default
title: Release Notes
nav_order: 4
---

# Release Notes

## v1.6.0

### Compiled library support
- Resolve compiled libraries (`.compiled-library`) from the TwinCAT installation path
- Library-aware completion, hover provenance, and missing-library diagnostics
- Filter library indexing by `.plcproj` library references

### Completion
- **POINTER TO / REFERENCE TO** offered as compound keywords in type contexts
- **`__SYSTEM.*`** qualified member access with completion and hover
- **Enum-aware completion** on `:=` assignment and `CASE` selector expressions
- **SUPER^** member completion and go-to-definition in extended function blocks
- **THIS^** completion with inheritance and access-visibility filtering
- Dot-access member completion on function block instances and structs
- Cross-file completion via the workspace index with prefix filtering
- Unqualified local completion for own methods, properties, and actions
- Visibility filtering — external dot-access hides private/protected members

### Diagnostics
- Semantic diagnostics for undefined variables and duplicate declarations
- Type-mismatch diagnostics (e.g., BOOL-to-numeric on assignment)
- Warning-level diagnostics — undefined identifiers and unresolvable `EXTENDS` downgraded from errors
- False-positive error reduction across nine phases of fixes

### Code actions
- QuickFix code actions attached to diagnostics

### Inlay hints
- Parameter-name inlay hints on function and function-block calls

### Hover
- Constant value resolution shown on hover
- Var-block kind and value range displayed on variable hover
- Pragma / attribute hover documentation

### Navigation
- Go-to-definition for type references, function-block members, and `SUPER^`
- Find All References extended to cover type annotations
- Rename Symbol for variables, for-loop counters, and POUs
- Workspace Symbol (`Ctrl+T`) search including GVL entries

### CodeLens
- Interface implementors, function-block children, and method-override counts

### Editor
- Signature help for function and function-block calls
- Folding ranges for ST constructs
- Document symbols with VAR sections grouped by kind
- Semantic tokens (full document)
- Document formatting and range formatting
- TcPOU XML/CDATA dimming and folding

### TwinCAT integration
- `.tsproj` / `.plcproj` project awareness with recursive discovery
- Virtual structured-text view for `.TcPOU` files
- System types and intrinsics catalog
- Type registry for compiled-library parameter types

### Parser and lexer
- POINTER and REFERENCE as proper keywords
- AND_THEN / OR_ELSE compound logical operators
- TYPE, STRUCT, ENUM, UNION, NAMESPACE, INTERFACE, METHOD support
- CASE sub-code recognition, typed enum parsing
- VAR CONSTANT, RETAIN, PERSISTENT qualifiers
- AST visitor pattern

---

*This project follows [Semantic Versioning](https://semver.org/).*
