---
layout: default
title: Diagnostics
parent: Features
nav_order: 2
---

# Diagnostics

ST LSP reports syntax errors in real time as you edit `.st` files.

## How It Works

Every keystroke re-parses the document using the built-in IEC 61131-3 parser. Parse errors are converted to VS Code diagnostics and shown as:

- **Red squiggles** in the editor
- **Error entries** in the Problems panel (`Ctrl+Shift+M`)

## Error Recovery

The parser uses error recovery to continue past malformed statements, so multiple errors in a file are reported at once rather than stopping at the first problem.

## Example

Given an incomplete `IF` statement:

```st
IF x > 0
  y := 1;
// Missing END_IF
```

The diagnostics panel will show:

```
[Error] Expected END_IF  (line 3)
```

## Severity Levels

| Severity | When |
|----------|------|
| Error | Syntax violations that prevent parsing, duplicate variable declarations |
| Warning | Semantic issues that may indicate bugs or style problems |

## Warning Diagnostics

ST LSP reports warnings for several categories of issues:

### Unnecessary Semicolons

Extra semicolons after control structures, in VAR blocks, or after declaration headers are flagged.

```st
IF x > 0 THEN
  y := 1;
END_IF;  // ← Warning: Unnecessary semicolon
```

Diagnostic code: `unnecessary-semicolon`

### Undefined Identifiers

References to names not found in the current scope, workspace, or standard libraries.

```st
y := unknownVar + 1;  // ← Warning: Undefined identifier 'unknownVar'
```

### Unknown Types

Variable declarations using a type name that cannot be resolved.

```st
VAR
  x : NonExistentType;  // ← Warning: Unknown type: "NonExistentType"
END_VAR
```

### Type Mismatch

Assignments or initializations where the value type is incompatible with the declared variable type (e.g., assigning a numeric expression to a `BOOL`, or a `STRING` to a numeric variable).

```st
VAR
  flag : BOOL := 42;  // ← Warning: Type mismatch
END_VAR
```

### Duplicate POU Names

Multiple PROGRAM, FUNCTION_BLOCK, or FUNCTION declarations with the same name in a file.

### Missing Library References

A variable uses a type from a library that is not listed in the project's library references.

### Unresolved EXTENDS / IMPLEMENTS

A FUNCTION_BLOCK, INTERFACE, or STRUCT references a base type or interface that cannot be found.

### Multi-Variable Declarations

Multiple variables declared on a single line (e.g., `a, b, c : INT;`) produce a style warning suggesting they be split into separate lines.

Diagnostic code: `multi-variable-declaration`
