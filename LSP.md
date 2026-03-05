# LSP Improvement Tasks

This document tracks findings and implementation details for LSP quality improvements.

## Problem 1: Bracket `[]` Highlighting in Strings

**Status:** ✅ Completed
**Assigned to:** syntax-agent

**Issue:** VS Code's default bracket pair colorization overrides the LSP semantic tokens when `[` appears inside strings (e.g., `'ARRAY ['`). This causes inconsistent colors.

**Root Cause:**
VS Code's bracket pair colorizer is a global editor feature that scans the entire document character-by-character. Without a TextMate grammar, VS Code has no way to know which characters are inside strings, comments, or code. Therefore it colorizes all `[` and `]` pairs regardless of context.

**Solution:** TextMate Grammar Registration

Created a minimal but complete TextMate grammar file at `client/syntaxes/iec-st.tmLanguage.json` that scopes:

1. **Block comments:** `(* ... *)` → `comment.block.iec-st`
2. **Line comments:** `// ...` → `comment.line.double-slash.iec-st`
3. **Single-quoted strings:** `'...'` → `string.quoted.single.iec-st`
4. **Double-quoted strings:** `"..."` → `string.quoted.double.iec-st`
5. **Escape sequences:** `''` (doubled quote) and `\\.` in strings

**Implementation Details:**

- Grammar follows TextMate format with patterns in `repository` section
- Registers in `client/package.json` under `contributes.grammars`
- Uses `scopeName: "source.iec-st"` matching the LSP language ID
- Covers ST syntax: single/double quote strings and both comment types
- Escape handling: ST uses `''` for literal quote in single-quoted strings

**Why This Works:**

1. VS Code layers the TextMate grammar with semantic tokens
2. TextMate scopes provide character context (inside string vs code)
3. Bracket colorizer respects TextMate scopes and skips brackets inside `string.*` and `comment.*` scopes
4. LSP semantic tokens still apply for syntax highlighting within unscoped regions

**Testing:**
Created `tests/fixtures/bracket_test.st` with:
- Strings containing brackets: `'ARRAY [0..10]'`
- Actual array indexing: `arr[5]`
- Brackets in comments: `(* [comment] *)`
- Escaped quotes in strings: `'Test ''string'' with [brackets]'`

**Files Changed:**
- ✅ `client/syntaxes/iec-st.tmLanguage.json` (new)
- ✅ `client/package.json` (added grammar registration)
- ✅ `tests/fixtures/bracket_test.st` (new test file)

---

## Problem 2: Trailing Semicolons in FB Declarations

**Status:** In Progress
**Assigned to:** semicolon-agent

**Issue:** Trailing `;` after the last variable declaration before `END_VAR` is allowed by the TwinCAT compiler but is bad practice and often omitted. The LSP should emit a Warning diagnostic with a refactoring suggestion (code action to remove).

**IEC 61131-3 Reference:** Semicolons are statement/declaration terminators, not separators. An extra trailing `;` creates an empty element.

**Findings:**
- (pending investigation)

**Solution:**
- (pending)

---

## Problem 3: Double/Unnecessary Semicolons

**Status:** In Progress
**Assigned to:** semicolon-agent

**Issue:** Multiple consecutive `;` tokens (e.g., `x := 5;;` or standalone `;;`) are syntactically valid but are bad practice. The LSP should emit a Warning diagnostic with a refactoring suggestion (code action to remove extra semicolons).

**Findings:**
- (pending investigation)

**Solution:**
- (pending)

---

## Problem 4: Variable Initializations Not Resolved

**Status:** ✅ Completed
**Assigned to:** init-agent

**Issue:** Variable initializations in declaration sections (e.g., `x : INT := 5;`) are parsed by the parser (`initialValue` field on `VarDeclaration`) but not semantically analyzed. The diagnostics engine does not validate:
- Whether the initializer expression is type-compatible with the declared type
- Whether identifiers in the initializer are in scope
- Whether the initializer uses valid constant expressions

### Research Findings (Task #4 — COMPLETE)

Based on IEC 61131-3 standard and TwinCAT 3 documentation, variable initialization rules are:

#### Valid Initialization Expressions

1. **Literals** - Constant values of compatible type (integers, reals, booleans, strings)
   - Example: `nVar1 : INT := 12;`

2. **Constant Expressions** - Compile-time evaluable expressions combining literals and operators
   - Example: `nVar2 : INT := 13 + 8;`
   - Allowed operators: arithmetic (+, -, *, /, MOD), comparison, logical (AND, OR, XOR, NOT)

3. **Variable References** - References to already-declared or accessible variables (including globals)
   - Example: `nVar3 : INT := nVar1 + nVar2;`

4. **Function Calls** - Calls to functions that can be evaluated in initialization context
   - Example: `nVar4 : INT := F_MyFunction(10);`

5. **Array Literals** - Syntactically `[val1, val2, ...]` (parsed but validation deferred to runtime)
   - Example: `arr : ARRAY[1..3] OF INT := [1, 2, 3];`

6. **FB Constructor Arguments** - Function block initialization with named parameters
   - Example: `x : MyFB(A := 1, B := TRUE);`

#### Constraints

1. **Dependency Ordering** - Variables and functions referenced in an initializer must be:
   - Already declared in earlier VAR blocks, OR
   - Global variables/constants accessible in scope, OR
   - Built-in types/functions/constants

2. **Type Compatibility** - Initializer expression type must be compatible with declared variable type
   - Example: `x : INT := 5.5;` is allowed (implicit downcast), but `x : INT := TRUE;` may warn

3. **Constant vs Runtime Initialization**:
   - **Simple scalar types** (INT, REAL, BOOL, STRING): initialization at compile-time with constant expressions
   - **Structured/User-defined types**: can use runtime values, FB_init methods, and more flexibility

4. **VAR CONSTANT** - If declared as `VAR CONSTANT`, initializer is immutable and must be constant

5. **Array and Structure Initialization** - Can use nested structures and array literals

#### Undefined Identifier Handling
- References to undefined identifiers in initializers MUST produce **warnings** (not errors)
- Same severity as in statement bodies

### Documentation References
- [Beckhoff TC3 Variable Declaration](https://infosys.beckhoff.com/content/1033/tc3_plc_intro/2526557579.html)
- [IEC 61131-3 Expression Rules](https://www.fernhillsoftware.com/help/iec-61131/common-elements/expressions.html)
- [TwinCAT 3 Tutorial: Structured Text](https://www.contactandcoil.com/twincat-3-tutorial/structured-text/)

**Solution (Task #5 — COMPLETED):**

### Implementation Details

Added initialization validation in `server/src/handlers/diagnostics.ts` in the `runSemanticAnalysis()` function:

1. **Variable Initialization Scope Building** (after body statements check)
   - For each `VarDeclaration.initialValue`, build a scope containing:
     - Global names (POUs, types, interfaces, GVL variables)
     - Variables from earlier VAR blocks
     - Variables declared before this one in the same VAR block
     - Inline enum member names
     - FB methods, properties, actions (for FBs)
     - Inherited members from EXTENDS chain

2. **Identifier Resolution**
   - Use existing `walkExpression()` to visit all `NameExpression` nodes in initializers
   - Check each identifier against the scope
   - Report `DiagnosticSeverity.Warning` for undefined identifiers with message "Undefined identifier"
   - Skip always-allowed names (TRUE, FALSE, NULL, built-in functions, system types)

3. **Type Compatibility Checking**
   - Use existing `inferExprCategory()` and `varTypeCategory()` functions
   - Check compatibility between declared type and initializer type
   - Warn for:
     - BOOL variable initialized with numeric expression
     - Numeric variable initialized with BOOL expression
     - Numeric variable initialized with STRING expression

4. **Method Initialization Support**
   - Added same validation for method VAR blocks
   - Methods can reference FB variables and other method variables declared before them

### Files Changed
- ✅ `server/src/handlers/diagnostics.ts` — Added initialization validation in `runSemanticAnalysis()`
- ✅ `server/src/__tests__/initValidation.test.ts` — 19 new tests covering all scenarios

### Test Results
- **19 new tests** covering initialization validation: 100% pass rate
- **1237 total tests** pass (1183 baseline + 19 new + 35 other existing)
- All initialization-related diagnostics working as expected
- Type checking and scope validation verified across multiple scenarios

### Key Behaviors Validated
✓ Simple literal initialization (INT := 5, BOOL := TRUE)
✓ Undefined identifier warnings in initializers
✓ Type mismatch warnings (numeric/BOOL/STRING)
✓ Expression initialization (x := 5 + 3)
✓ Variable reference to earlier declarations
✓ Forward reference detection (variable initialized with not-yet-declared variable)
✓ Cross-VAR block references
✓ Built-in function calls in initializers (ABS, MAX, etc.)
✓ Built-in constants (TRUE, FALSE, NULL)
✓ Method initialization with FB variable scope
✓ Array literal support
✓ Complex expressions with multiple operators
✓ Multiple VAR blocks with dependency tracking

---

## Important Constraints

- **Undefined identifiers MUST remain errors/warnings** — never suppress real diagnostics
- **Wrong method usage and type mismatches MUST be reported** — no silent ignoring
- All changes must have tests
- All findings documented in this file
