# Plan: Extract Data Types from Compiled Library using Varint Analysis

**Created:** 2026-03-06
**Status:** Ready for Atlas Execution

## Summary

The goal is to improve the LSP compiled library extraction by determining the data types of POU parameters. Although previous research indicated that types might be fully encrypted in `__languagemodel.auxiliary`, there is a strong hypothesis that data types (or indices pointing to a system type registry) are encoded using `varint` values in the `.meta`, `.object`, or `__shared_data_storage_schema_table__.auxiliary` files. This plan outlines a systematic approach to prove this hypothesis and implement the extraction.

## Context & Analysis

**Relevant Files:**
- `server/src/twincat/libraryZipReader.ts`: Existing ZIP parsing, string table decoding, and POU metadata loading.
- `tools/analyze-schema-and-objects.js`: Tool for analyzing schema and object files.
- `tools/analyze-meta-params.js`: Tool to parse `.meta` headers and varints.
- `COMPILED_LIBRARY.md`: Documentation on the current reverse-engineering status, identifying varint encoding (LEB128).

**Key Concepts:**
- **Varint Encoding Mode**: TwinCAT compiled libraries use LEB128 (7-bit little-endian) for integers.
- **Type GUID Mapping hypothesis**: Even if types are not stored as plain text, they might be referenced as varint indices pointing to external or schema type GUIDs.
- **Data flow**: `.compiled-library` -> extract varints from `.meta`/`.object`/schema -> map to primitive types (BOOL, INT, TIME) -> `LibrarySymbol[]`.

## Implementation Phases

### Phase 1: Deep Varint Mapping and Correlation

**Objective:** Identify the exact varints in `.meta`, `.object`, or schema files that correspond to known parameter data types.

**Files to Modify/Create:**
- `tools/analyze-type-varints.js`: A new analysis script to specifically correlate known POUs with their varint structures.

**Steps:**
1. Create `analyze-type-varints.js` to dump the raw varint streams for a set of varied standard FBs (e.g. `F_TRIG` with `BOOL`, `TON` with `TIME`, `CTU` with `WORD`).
2. Run statistical cross-referencing to find varints that uniquely change when the data types of the parameters change.
3. Compare the schema table varints against known type enums or GUIDs of the CODESYS type system.
4. Document the mapping logic discovered.

**Acceptance Criteria:**
- [ ] A correlation matrix between specific varints and primitive IEC types (BOOL, INT, etc.) is established.
- [ ] The discovered varint mapping rule holds true across at least 15 different POUs.

### Phase 2: Schema Type resolution

**Objective:** Build a resolver mapping the extracted varints to explicit string types for the LSP.

**Files to Modify/Create:**
- `server/src/twincat/typeRegistry.ts`: New file mapping varints to type strings or GUIDs.
- `server/src/twincat/libraryZipReader.ts`: Integrate type lookup during POU extraction.

**Steps:**
1. Implement a static map or resolution algorithm in `typeRegistry.ts` based on the Step 1 findings.
2. Update the `readVarint` stream parsing in `libraryZipReader.ts` to capture the type index varints alongside the parameter names.
3. Apply the type lookup to the `inputs` and `outputs` properties of the generated `LibrarySymbol` objects.

**Acceptance Criteria:**
- [ ] `typeRegistry.ts` exports a robust function `resolveVarintType(value: number): string`.
- [ ] `LibrarySymbol` generation includes the determined parameter types.

### Phase 3: LSP Integration and Testing

**Objective:** Serve the extracted parameter types in hovered tooltip documentation and completion signatures.

**Files to Modify/Create:**
- `server/src/handlers/hover.ts`: Update signature assembly to output `<param> : <type>`.
- `server/src/handlers/completion.ts`: Update completion snippet signatures.
- `server/src/__tests__/compiledLibExtraction.test.ts`: Add test assertions for data types.

**Steps:**
1. Update hovered document formatting to include parameter types safely (falling back to `ANY` or unknown if resolution fails).
2. Validate against `Tc2_Standard` usage in a test `.st` file.
3. Run `vitest` to verify no regressions in existing parsing.

**Acceptance Criteria:**
- [ ] Hovering over `TON.IN` displays `BOOL`.
- [ ] All unit tests pass.
- [ ] Code follows project conventions cleanly.

## Open Questions

1. **Where exactly are the target varints located?** 
   - **Option A:** They are embedded inside the `_schema_table__` and act as an offset.
   - **Option B:** They exist in the `.object` varint streams in a previously overlooked byte position.
   - **Recommendation:** Start analysis on `.object` files using FBs with wildly different signatures (e.g., heavily typed strings vs. simple booleans).

## Risks & Mitigation

- **Risk:** The varints pointing to types reside entirely within the encrypted `__languagemodel.auxiliary` and are not mirrored in plain structure files natively.
  - **Mitigation:** If proven impossible to read via varints natively, implement a type fallback mapping logic based strictly on parameter names (`b` prefix -> BOOL, `n` -> INT) or fallback to hardcoded `Tc2_Standard` type definitions.

## Success Criteria

- [ ] Data types are successfully extracted from Compiled Libraries without needing source files.
- [ ] The LSP correctly surfaces parameter data types.
- [ ] All phases complete with cleanly passing tests.
- [ ] Code reviewed and finalized iteratively.

## Notes for Atlas

Start execution with Phase 1 by creating a precise correlation script. Do not proceed to modifying the active LSP parser until the data type varint encoding logic is strictly proven.