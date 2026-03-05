# Compiled Library Reverse Engineering

## Status (Final — 2026-03-05)

| Task | Status |
|------|--------|
| RE: Compiled-Library Binary Format | Complete — encrypted, no parameter extraction possible |
| RE: Source .library Format | Complete — full parameter extraction working |
| RE: Deep Binary Analysis (3 rounds, 8 agents) | Complete — confirms encryption |
| RE: RSAC 2024 / Microsoft CoDe16 Research | Complete — confirms proprietary format |
| RE: Web Research (13+ searches) | Complete — no public tools exist |
| LSP: Hybrid library loading | Complete |
| LSP: Unresolved identifier warnings | Complete (Warning severity) |
| LSP: Find All References | Complete (25 tests) |
| LSP: Reference counting CodeLens | Complete (22 tests) |

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
- `__shared_data_storage_schema_table__.auxiliary` — type/field layout encoding (recursive template definitions)
- `*.meta` files — POU hierarchy (parent/child, names) + BMP diagram payload
- `*.object` files — GUID references and schema IDs (28 bytes per FB)
- `projectinformations.auxiliary` — library metadata (name, version)
- `__languagemodel.auxiliary` — **ENCRYPTED** (AES/RC4 with Beckhoff-embedded key)

#### String Table Format
```
varint(count) + repeated[varint(index), varint(length), bytes[length]]
```

Contains: POU names, parameter names, comments, direction keywords (Input, Output), structural keywords (FormalParams, Inputs, Outputs). ALL data is present but FB-to-parameter linkage is NOT in this file.

#### Known String Table Entries (Tc2_Standard, F_TRIG)
- [351] = ' signal to detect ' (INPUT CLK comment)
- [352] = 'CLK' (parameter name)
- [353] = ' falling edge at signal detected ' (OUTPUT Q comment)
- [257] = 'Q' (parameter name)
- [236] = 'Input', [240] = 'Output'
- [459] = 'Inputs', [592] = 'Outputs', [591] = 'FormalParams'

#### Schema Table (1439 bytes, 854 varints)
Recursive template engine defining the CODESYS internal data model:
- Field definitions: [402]='Guid', [404]='Name', [405]='Properties', [407]='TypeGuid'
- Parameter structure: [459]='Inputs', [591]='FormalParams', [592]='Outputs'
- Defines HOW to read parameters, but actual values are in __languagemodel.auxiliary

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

### Phase 1: String Table Decoding
Successfully decoded the indexed string table format from both library types:
- Format is varint(count) + repeated[varint(index), varint(length), bytes[length]]
- Tc2_Standard contains 595 string entries
- Parameter names and descriptions ARE in the string table
- Direction and structure keywords present

### Phase 2: Deep Binary Analysis (8 agents, 3 rounds, exhaustive)

#### .meta Files
- Header: 20 bytes magic (0x28092002) + varint metadata stream (UUID, name, parent, category)
- Tail bytes are BMP image data (0x42 0x4D "BM" magic) for UI visualization diagrams
- F_TRIG.meta: 3954 bytes, CTU.meta: 5522 bytes — size difference = different diagram sizes
- **No parameter indices found in .meta files**

#### .object Files
- Per-FB .object: ALL identical 28 bytes (7 varints: [15, 4, 20, 2, 768, 12, 21])
- 768 = GUID reference, not a string table index
- 41 small objects (23-28 bytes), 2 large objects (640, 28KB)
- **No parameter linkage in .object files**

#### Schema Table
- 1439 bytes, 854 varints decoded
- Recursive template definitions for CODESYS data model
- Contains Inputs/Outputs/FormalParams structure templates
- Uses GUID references (768, 769) for type linking — not direct string indices
- **Defines structure, not data**

#### __languagemodel.auxiliary (ENCRYPTED)
- 9616 bytes, encrypted with Beckhoff proprietary key (AES/RC4)
- 250/256 unique byte values, no null bytes — confirms encryption
- First 16 bytes = format GUID (constant across libraries)
- 99.5% bytes differ between versions of same library = per-version key
- All XOR key spaces tested negative
- **This is where TwinCAT stores the FB-to-Parameter linkage**
- Cannot be decoded without Beckhoff's proprietary decryption key

### Phase 3: External Research

#### Web Research (13+ targeted searches)
- **Zero public tools** exist to decode compiled-library parameter data
- CODESYS Forge: community question about extracting library data went unanswered
- ICSREF framework: only covers CODESYS V2, not V3
- CODESYS docs: compiled libraries explicitly designed to hide source code
- No academic papers document the V3 compiled-library binary format

#### Microsoft CoDe16 Research (RSAC 2024)
- Vladimir Tokarev (Microsoft) reverse-engineered CODESYS V3 for security research
- Found 16 zero-day vulnerabilities, built Wireshark dissector
- Confirms format is "proprietary" requiring "deep knowledge of proprietary protocol"
- Focus was on protocol/vulnerabilities, not library parameter extraction
- Source: https://github.com/microsoft/CoDe16

#### CODESYS Documentation
- Compiled libraries "behave just like *.library files" for installation/referencing
- `__lmd__<language>.aux` files = localized documentation (HTML, not parameter data)
- Scripting Engine (IronPython) and TwinCAT Automation Interface (C# COM) CAN read parameters — but require IDE installation

### Final Conclusion

The FB-to-Parameter linkage is stored in `__languagemodel.auxiliary` which is **encrypted with a key embedded in the Beckhoff/CODESYS binary**. This is deliberate IP protection by 3S-Smart Software Solutions GmbH. Without the key, parameter-to-POU association cannot be extracted from compiled binaries alone.

### Solution: Hybrid Source/Compiled Approach

Enhanced `readLibraryIndex()` implements a hybrid strategy:
1. When given a compiled `.compiled-library*` path, check for `.library` source in same directory
2. If source exists, use it (full parameter extraction via `parseDeclarationBlock()`)
3. If source missing, fall back to compiled library (identifier-only)
4. All Beckhoff standard libraries ship source `.library` alongside compiled versions

**Status**: Implemented in `libraryZipReader.ts`. All tests passing.

### Future Alternatives (if needed)

| Approach | Pros | Cons |
|----------|------|------|
| TwinCAT Automation Interface (C# COM) | Full access to all library data | Requires TwinCAT IDE installed |
| CODESYS Scripting Engine (IronPython) | Full access inside IDE | Requires CODESYS IDE installed |
| PLCOpenXML export | Standardized, human-readable | Requires manual user export |
| Pre-generated parameter database | Fast, no IDE needed | Maintenance burden, may go stale |

---

## Architecture Notes

### Current Implementation
- `libraryZipReader.ts` — ZIP parsing, string table decoding, hybrid source/compiled extraction
- `workspaceIndex.ts` — scans projects, loads library indexes
- `stdlib.ts` — standard FB catalog from library data
- `diagnostics.ts` — parse errors + type checks + undefined identifier warnings
- `references.ts` — Find All References handler
- `codeLens.ts` — reference counting CodeLens

### Data Flow
```
.plcproj -> library refs -> _Libraries/ folder -> .compiled-library* files
                                                -> check for .library source
                                                -> readLibraryIndex()
                                                -> LibrarySymbol[] (with params from source)
                                                -> used by completion/hover/diagnostics/references/codeLens
```
