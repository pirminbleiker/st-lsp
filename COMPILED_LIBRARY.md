# Compiled Library Reverse Engineering

## Status

| Task | Status | Owner |
|------|--------|-------|
| RE: Compiled-Library Binary Format | In Progress | re-binary |
| RE: Source .library Format | In Progress | re-source |
| Research: trust-platform IEC patterns | In Progress | researcher |
| LSP: Unresolved identifier warnings | Blocked (by RE tasks) | - |
| LSP: Reference counting | Blocked (by diagnostics) | - |

## Goal

Extract all POU information (names, parameters, types, directions, comments/descriptions) from TwinCAT compiled-library and source-library files. Use this data to power LSP features:
- Hover documentation with parameter details
- Completion with signatures
- Unresolved identifier warnings
- Reference counting

## Constraint

**Only compiled-library and source-library files may be used as data sources.**
No .st file fallback, no external repositories, no hardcoded definitions.

## File Formats

### Compiled Library (.compiled-library*)

ZIP archive containing:
- `__shared_data_storage_string_table__.auxiliary` — indexed string table with ALL text data
- `__shared_data_storage_schema_table__.auxiliary` — type/field layout encoding
- `*.meta` files — POU hierarchy (parent/child, names)
- `*.object` files — parameter counts and schema references
- `projectinformations.auxiliary` — library metadata (name, version)
- `__languagemodel.auxiliary` — ENCRYPTED, skip

#### String Table Format
```
varint(count) + repeated[varint(index), varint(length), bytes[length]]
```

Contains: POU names, parameter names, comments, direction keywords (Input, Output), structural keywords (FormalParams, Inputs, Outputs).

#### Known String Table Entries (Tc2_Standard, F_TRIG)
- [351] = ' signal to detect ' (INPUT CLK comment)
- [352] = 'CLK' (parameter name)
- [353] = ' falling edge at signal detected ' (OUTPUT Q comment)
- [257] = 'Q' (parameter name)
- [236] = 'Input', [240] = 'Output'
- [459] = 'Inputs', [592] = 'Outputs', [591] = 'FormalParams'

### Source Library (.library)

ZIP archive where the string table entries are complete ST declaration blocks:
```
FUNCTION_BLOCK MyFB
VAR_INPUT
  param1 : INT;
END_VAR
```

Parsed by `parseDeclarationBlock()` in `libraryZipReader.ts`.

## Findings (2026-03-05)

### Phase 1: String Table Decoding ✅
Successfully decoded the indexed string table format from both library types:
- Format is varint(count) + repeated[varint(index), varint(length), bytes[length]]
- Tc2_Standard contains 595 string entries
- Parameter names and descriptions ARE in the string table:
  - F_TRIG CLK: [352]='CLK', [351]=' signal to detect '
  - F_TRIG Q: [257]='Q', [353]=' falling edge at signal detected '
  - Direction keywords: [236]='Input', [240]='Output', [459]='Inputs', [592]='Outputs', [591]='FormalParams'

### Phase 2: Deep Binary Analysis (5 agents, exhaustive)

#### .meta Files
- Header: 20 bytes magic + varint metadata stream (UUID, name, parent, category)
- varint[18] = SIZE field for binary payload (BMP image data for UI visualization)
- F_TRIG.meta: 3954 bytes (24 bytes header/varints + 3898 bytes BMP payload)
- CTU.meta: 5522 bytes (56 bytes header/varints + 5466 bytes BMP payload)
- Size difference = different diagram sizes, NOT parameter count
- **No parameter indices found in .meta files** (searched varint + raw bytes)

#### .object Files
- Per-FB .object: ALL identical 28 bytes (7 varints: [15, 4, 20, 2, 768, 12, 21])
- "Project Settings" .object: 28072 bytes = UTF-16 XML project metadata, no parameters
- "Project Information" .object: 640 bytes = serialized .NET metadata, no parameter linkage

#### Schema Table
- 1439 bytes, 854 varints decoded
- Contains template definitions: "Inputs" [459], "Outputs" [592], "FormalParams" [591]
- Defines STRUCTURE of how data should be organized, not actual parameter values

#### __languagemodel.auxiliary (ENCRYPTED)
- 9616 bytes, encrypted with Beckhoff proprietary key
- No META_MAGIC header, random byte patterns
- False positive matches for parameter indices in encrypted stream
- **This is where TwinCAT stores the FB→Parameter linkage**
- Cannot be decoded without Beckhoff's proprietary decryption key

#### Conclusion
The FB→Parameter linkage is stored in `__languagemodel.auxiliary` which is **encrypted and proprietary**. TwinCAT has the decryption key built in. Without it, parameter-to-POU association cannot be extracted from compiled binaries alone.

### Phase 3: Source Libraries (.library) - FALLBACK APPROACH
Source libraries contain complete ST declarations in their string table, parseable by existing `parseDeclarationBlock()` function:
- mobject-core.library: 13,685 string table entries (project info + embedded ST code)
- Each entry may be a complete FUNCTION_BLOCK/FUNCTION/INTERFACE declaration
- Currently handles parameters, types, directions, and comments correctly

### Recommendation
Given the inability to decode parameter information from compiled libraries using current reverse engineering:
1. Use source .library files when available (read from project's _Libraries folder)
2. Fall back to identifier-only extraction for compiled-only libraries
3. This aligns with TwinCAT's approach: source libraries are always shipped for well-known FBs (Tc2_Standard, Tc2_System, etc.)

### Implementation: Hybrid Source/Compiled Approach ✅
Enhanced `readLibraryIndex()` to implement a hybrid strategy:
1. When given a compiled `.compiled-library*` path, check for `.library` source in same directory
2. If source exists, use it (full parameter extraction via `parseDeclarationBlock()`)
3. If source missing, fall back to compiled library (identifier-only)
4. Handles both source-first and compiled-only scenarios gracefully

**Status**: Implemented in `libraryZipReader.ts` (readLibraryIndex function).
Compilation and tests verified working.

---

## Architecture Notes

### Current Implementation
- `libraryZipReader.ts` — ZIP parsing, string table decoding, basic symbol extraction
- `workspaceIndex.ts` — scans projects, loads library indexes
- `stdlib.ts` — scans TwinCAT managed libraries installation
- `diagnostics.ts` — currently reports parse errors + some type checks

### Data Flow
```
.plcproj → library refs → _Libraries/ folder → .compiled-library* files
                                              → readLibraryIndex()
                                              → LibrarySymbol[] (with params)
                                              → used by completion/hover/diagnostics
```
