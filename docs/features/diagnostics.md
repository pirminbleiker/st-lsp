---
layout: default
title: Diagnostics
parent: Features
nav_order: 2
---

# Diagnostics & Code Actions

ST LSP reports errors and warnings in real time as you edit `.st` and TwinCAT source files. Issues appear as squiggly underlines in the editor and entries in the Problems panel (`Ctrl+Shift+M`).

## Syntax Diagnostics

Every keystroke re-parses the document using the built-in IEC 61131-3 parser. Parse errors are converted to VS Code diagnostics immediately.

**Example — missing `END_IF`:**

```iecst
IF x > 0 THEN
    y := 1;
(* Missing END_IF here *)
```

Problems panel:

```
[Error] Expected END_IF  (line 3)
```

The parser uses **error recovery**: it skips malformed statements and continues parsing, so a single file can report multiple errors at once rather than stopping at the first problem.

## Semantic Diagnostics

Beyond syntax, ST LSP performs scope and type analysis:

### Undefined Identifier

References to variables or POUs that are not declared in the current scope produce a warning:

```iecst
VAR
    count : INT;
END_VAR

total := count + offset;  // Warning: 'offset' is not defined
```

### Type Mismatch

Assignments where the value type is incompatible with the variable's declared type:

```iecst
VAR
    flag : BOOL;
    value : INT := 42;
END_VAR

flag := value;   // Warning: cannot assign INT to BOOL
```

### Duplicate Declarations

Declaring the same variable name twice in one POU, or defining two POUs with the same name:

```iecst
VAR
    counter : INT;
    counter : DINT;  // Error: duplicate variable 'counter'
END_VAR
```

### Undefined Type Reference

Using a type name that is not declared in the current file or workspace:

```iecst
VAR
    ctrl : UnknownController;  // Warning: type 'UnknownController' not found
END_VAR
```

> **Note:** Semantic diagnostics are reported as warnings (yellow) rather than errors (red) so that partially-written code remains navigable while you work.

## Library Diagnostics

When you use a standard function block that belongs to a library not referenced in your `.plcproj` file, ST LSP warns you:

```iecst
VAR
    timer : TON;   // Warning: 'TON' requires library 'Tc2_Standard' (not referenced)
END_VAR
```

This catches missing library references before you deploy to the PLC.

## QuickFix: Declare Variable

When ST LSP reports an undefined identifier, a lightbulb `💡` appears. Selecting **Declare variable** inserts a placeholder declaration into the nearest `VAR` block (or creates one if none exists):

```iecst
(* Before QuickFix *)
total := count + offset;   // Warning: 'offset' is not defined

(* After QuickFix: "Declare 'offset'" *)
VAR
    offset : UNKNOWN;      // <-- inserted; change UNKNOWN to the correct type
END_VAR
total := count + offset;
```

## QuickFix: Uppercase Keyword

Lowercase ST keywords produce a warning, with a QuickFix to convert them to uppercase:

```iecst
(* Before *)
if x > 0 then   // Warning: keyword should be uppercase

(* After QuickFix: "Uppercase keyword" *)
IF x > 0 THEN
```

> **Note:** For bulk formatting of an entire file, use **Format Document** (`Shift+Alt+F`). See [Document Formatting](formatting.md#document-formatting).
