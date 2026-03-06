# Plan: Improve Completion Suggestions for Variabe Members and Scope Visibility

**Created:** March 6, 2026
**Status:** Ready for Atlas Execution

## Summary

The current completion engine lacks strict and context-aware visibility filtering for Object-Oriented elements (Methods, Properties, Variables). When a user requests completion (`Ctrl+Space` or `.`), all internal members (like `VAR`, `VAR_TEMP`, or `PRIVATE`/`PROTECTED` methods) are either inappropriately proposed or completely missing from the own scope. This plan outlines the necessary refactoring to ensure `PUBLIC`, `INTERNAL` (project-level), `PROTECTED`, and `PRIVATE` access modifiers are respected based on the context of the completion request (external access vs. `THIS^.` vs. `SUPER^.` vs. local scope).

## Context & Analysis

**Relevant Files:**
- `server/src/handlers/completion.ts`: Main completion engine. Needs visibility checks during dot-access and local scope completion.
- `server/src/parser/ast.ts`: Represents AST nodes. Need to ensure `modifiers` (e.g., `PUBLIC`, `PRIVATE`) are accurately queried.
- `server/src/__tests__/completion.test.ts`: Test coverage for dot-completion and scope access.

**Key Functions/Classes:**
- `getMembersFromDeclarations` in `completion.ts`: Currently blindly returns all methods and properties. Needs to filter based on external visibility (`PUBLIC`, `INTERNAL`, `VAR_INPUT`, `VAR_OUTPUT`, `VAR_IN_OUT`).
- `getDotAccessMembers` in `completion.ts`: Triggers member resolution.
- `handleCompletion` in `completion.ts`: Handles un-dotted `Ctrl+Space`. Currently misses own methods/properties. Needs to offer local POU methods/properties and inherited members.

**Patterns & Conventions:**
- Default visibility in TwinCAT is `PUBLIC` for Methods/Properties.
- `VAR` (without specifier) is implicitly private to the POU.
- `INTERNAL` means public within the same project (we can treat it as `PUBLIC` for now since we operate mostly in single-project mode, or check workspace boundaries).

## Implementation Phases

### Phase 1: Implement Visibility Helper and Update External Access

**Objective:** Create a reusable visibility checker and apply it to external dot-access (`instance.`).

**Files to Modify/Create:**
- `server/src/handlers/completion.ts`
- `server/src/__tests__/completion.test.ts`

**Steps:**
1. Create a helper function `isMemberVisible(modifiers: string[], context: 'external' | 'this' | 'super' | 'local'): boolean` in `completion.ts`.
   - `external`: Only allow `PUBLIC`, `INTERNAL` (or empty modifiers if default is public for methods). Reject `PRIVATE`, `PROTECTED`.
   - `this` / `local`: Allow all.
   - `super`: Allow `PUBLIC`, `INTERNAL`, `PROTECTED`. Reject `PRIVATE`.
2. Update `getMembersFromDeclarations` to use `isMemberVisible` for `fb.methods`, `fb.properties`, and `fb.actions` with `context: 'external'`.
3. Ensure `getMembersFromDeclarations` ONLY returns `VAR_INPUT`, `VAR_OUTPUT`, `VAR_IN_OUT` for variables when accessed externally (this might already be partially there, but needs solidifying).
4. Update `completion.test.ts` to add tests for:
   - External access hiding `PRIVATE` / `PROTECTED` methods/properties.
   - External access hiding internal `VAR`.

**Acceptance Criteria:**
- [ ] `myFb.PrivateMethod` is NOT suggested.
- [ ] `myFb.PublicMethod` IS suggested.
- [ ] `myFb.InternalVar` is NOT suggested (unless VAR_INPUT/OUTPUT).

### Phase 2: Fix `THIS^.` and `SUPER^.` Completion

**Objective:** Ensure `THIS^.` and `SUPER^.` correctly walk the inheritance chain and respect visibility.

**Files to Modify/Create:**
- `server/src/handlers/completion.ts`
- `server/src/__tests__/completion.test.ts`

**Steps:**
1. In `handleCompletion` (where `THIS` is handled around line 985), change the hardcoded iteration to resolve not just the current FB, but also its base classes (via `EXTENDS`).
2. Apply `isMemberVisible(..., 'this')` for local members and `isMemberVisible(..., 'super')` for inherited members.
3. Update `getSuperMembers()` (or replace it with the unified logic) to properly resolve base class members using `isMemberVisible(..., 'super')`.
4. Add tests in `completion.test.ts` for `THIS^.` and `SUPER^.` accessing inherited methods/properties.

**Acceptance Criteria:**
- [ ] `THIS^.` shows local `PRIVATE` methods.
- [ ] `THIS^.` shows inherited `PROTECTED` methods.
- [ ] `SUPER^.` shows parent `PROTECTED` methods but NOT parent `PRIVATE` methods.

### Phase 3: Unqualified Local Completion (`Ctrl+Space`)

**Objective:** Show own methods, properties, and inherited accessible members when typing without a dot.

**Files to Modify/Create:**
- `server/src/handlers/completion.ts`
- `server/src/__tests__/completion.test.ts`

**Steps:**
1. In `handleCompletion`, when falling through to local scoped variables (`collectVarDeclarations`), we must also determine the enclosing POU (Function Block, Program, etc.).
2. If inside a POU, add its `methods`, `properties`, and `actions` to the completion items.
3. Walk the `EXTENDS` chain of the enclosing POU and add inherited `PUBLIC`, `INTERNAL`, and `PROTECTED` members to the completion items.
4. Add tests ensuring that inside a method body, typing `Ctrl+Space` offers the FB's other methods and properties.

**Acceptance Criteria:**
- [ ] Own methods are suggested in plain completion.
- [ ] Inherited protected methods are suggested in plain completion.
- [ ] Proper CompletionItemKind (Method, Property) is assigned.

## Open Questions

1. **INTERNAL Modifier:** We are treating `INTERNAL` the same as `PUBLIC` since we lack cross-project dependency resolution at the moment. Is this sufficient?
   - **Recommendation:** Yes, for a single workspace index, treating `INTERNAL` as `PUBLIC` is the safest and most accurate fallback.

## Risks & Mitigation

- **Risk:** Recursive inheritance walking might cause stack overflows on cyclic `EXTENDS` (though syntactically invalid, ST can have broken code).
  - **Mitigation:** Use a `visited: Set<string>` to track seen types during base-class traversal (as currently done in `getMembersFromDeclarations`).

## Success Criteria

- [ ] External dot-completion strictly follows PUBLIC/VAR_INPUT/VAR_OUTPUT limits.
- [ ] `THIS^.` and `SUPER^.` completions are inheritance-aware and visibility-aware.
- [ ] Local plain completion includes sibling methods and properties.
- [ ] All updated logic is heavily covered by existing and new tests in `completion.test.ts`.

## Notes for Atlas

- Check how `BUILTIN_TYPES` and `EXTENDS` strings are matched (use `.toUpperCase()` for case-insensitive ST lookup).
- Rely on `findMemberType` or similar existing lookup helpers to traverse the `WorkspaceIndex` for inherited types.