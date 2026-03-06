# Plan: Parser Architecture Refactoring

**Created:** 2026-03-06
**Status:** Ready for Atlas Execution

## Summary

The current implementation of the IEC 61131-3 ST parser is a monolithic class inside `parser.ts` containing over 1600 lines of code. This plan outlines the restructuring of the `server/src/parser/` directory to separate the parsing logic into distinct modules: core parsing utilities, declarations, statements, expressions, variables, and data types. This adheres to the Single Responsibility Principle and improves maintainability.

## Context & Analysis

**Relevant Files:**
- `server/src/parser/parser.ts`: Currently contains the entire recursive-descent parsing logic. Needs to be split up.
- `server/src/parser/ast.ts`: Contains the AST node definitions (remains as is or slightly adjusted if necessary).

**Key Functions/Classes:**
- `Parser` in `parser.ts`: Currently holds token state, error collection, and all grammatical rules.
- `parseExpression`, `parseStatement`, `parseTopLevelDeclaration`, `parseVarBlock`, `parseTypeRef` in `parser.ts`: Major parsing branches to be extracted.

**Patterns & Conventions:**
- Recursive-descent parsing: The new structure must maintain the exact same parsing logic, just distributed across multiple files.
- State sharing: The extracted parsing modules will need access to the token stream, position, and error collection. This requires a shared context or a base class.

## Implementation Phases

### Phase 1: Create Core Parser Context

**Objective:** Extract the fundamental token navigation and state management into a base class or shared context.

**Files to Modify/Create:**
- `server/src/parser/core.ts`: Create `ParserContext` or `BaseParser` class containing `tokens`, `pos`, `errors`, `peek()`, `advance()`, `check()`, `match()`, `expect()`, `skipToSemicolon()`, and error reporting helpers.
- `server/src/parser/parser.ts`: Make the `Parser` class inherit from or use the new core context.

**Steps:**
1. Create `core.ts` and define the base utilities.
2. Update `parser.ts` to extend the base class or pass the context.
3. Validate that the existing tests in `server/src/__tests__/parser.test.ts` still pass.

**Acceptance Criteria:**
- [ ] `core.ts` contains token navigation and error handling.
- [ ] `parser.ts` uses `core.ts` without logic duplication.
- [ ] All tests pass.

### Phase 2: Extract Expression Parsing

**Objective:** Move all expression-related parsing logic into a separate module.

**Files to Modify/Create:**
- `server/src/parser/expressions.ts`: Create functions/methods for `parseExpression`, `parseOr`, `parseAnd`, `parseComparison`, `parseAddition`, `parseMultiplication`, `parsePower`, `parseUnary`, `parsePostfixExpression`, `parsePrimary`, and call arguments.
- `server/src/parser/parser.ts`: Remove expression parsing logic and delegate to `expressions.ts`.

**Steps:**
1. Move expression methods to `expressions.ts`.
2. Ensure they accept the shared `ParserContext` or are part of a mixin/class extension.
3. Update references in `parser.ts`.
4. Run tests.

**Acceptance Criteria:**
- [ ] All expression parsing logic is in `expressions.ts`.
- [ ] All tests pass.

### Phase 3: Extract Statement Parsing

**Objective:** Move all statement-related parsing logic.

**Files to Modify/Create:**
- `server/src/parser/statements.ts`: Create methods for `parseStatement`, `parseStatementList`, `parseIfStatement`, `parseForStatement`, `parseWhileStatement`, `parseRepeatStatement`, `parseCaseStatement`, `parseAssignmentOrCall`.
- `server/src/parser/parser.ts`: Remove statement parsing logic and delegate to `statements.ts`.

**Steps:**
1. Move statement methods to `statements.ts`.
2. Update references and bindings.
3. Run tests.

**Acceptance Criteria:**
- [ ] All statement parsing logic is in `statements.ts`.
- [ ] All tests pass.

### Phase 4: Extract Types and Variables Parsing

**Objective:** Isolate parsing of types (`parseTypeRef`, array dims, inline enums) and vars (`parseVarBlocks`, `parseVarDeclarations`).

**Files to Modify/Create:**
- `server/src/parser/types.ts`: Methods for parsing `TypeRef` and related structures.
- `server/src/parser/variables.ts`: Methods for parsing `VAR` blocks and variable declarations.
- `server/src/parser/parser.ts`: Delegate to the new modules.

**Steps:**
1. Extract type parsing.
2. Extract variable parsing.
3. Ensure interdependent logic (e.g. types needed in vars) is correctly imported.
4. Run tests.

**Acceptance Criteria:**
- [ ] Type and variable parsing logic is separated.
- [ ] All tests pass.

### Phase 5: Extract Declarations Parsing

**Objective:** Move top-level declarations (Programs, FBs, FUNs, GVLs, Interfaces, Types blocks).

**Files to Modify/Create:**
- `server/src/parser/declarations.ts`: Methods for `parseTopLevelDeclaration`, `parseProgramDeclaration`, `parseFunctionBlockDeclaration`, `parseFunctionDeclaration`, `parseInterfaceDeclaration`, etc.
- `server/src/parser/parser.ts`: The main parser file now only orchestrates (`parseSourceFile`) and delegates everything else, becoming a clean entry point.

**Steps:**
1. Move declaration methods.
2. Clean up `parser.ts` to be purely the entry point.
3. Run tests.

**Acceptance Criteria:**
- [ ] `parser.ts` is under 200 lines and only orchestrates parsing.
- [ ] All tests pass.

## Open Questions

1. Architecture of shared state?
   - **Option A:** Class inheritance (BaseParser -> Parser with Mixins or huge subclassing).
   - **Option B:** Dependency injection (pass a `ParserContext` object to standalone `parseX(ctx)` functions).
   - **Recommendation:** Option B (Functional approach with `ParserContext`) is usually cleaner mapped to TypeScript modules, preventing a "god object" anti-pattern via subclassing.

## Risks & Mitigation

- **Risk:** Breaking existing AST node ranges or missing minor parsing edge cases during extraction.
  - **Mitigation:** Rely heavily on the existing comprehensive test suite (`parser.test.ts`, regression tests). Do not change grammatical logic, only move it.

## Success Criteria

- [ ] `parser.ts` is split into multiple files (`core.ts`, `expressions.ts`, `statements.ts`, `declarations.ts`, `types.ts`, `variables.ts`).
- [ ] All extracted branches retain full original functionality.
- [ ] All tests pass in the `__tests__` directory.
- [ ] Code is formatted and passes linting.

## Notes for Atlas

When extracting these modules, be careful with circular dependencies. `statements.ts` might need `parseExpression` from `expressions.ts`, and `declarations.ts` might need `parseStatementList` from `statements.ts`. If using Option B (functions with a shared context object), you can pass around an object containing references to the other parsing functions or import them directly.