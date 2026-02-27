---
layout: default
title: Navigation
parent: Features
nav_order: 3
---

# Navigation

ST LSP provides rich navigation features for IEC 61131-3 Structured Text.

## Hover Documentation

Hover over any symbol to see a documentation tooltip. ST LSP resolves what the symbol refers to and shows the most useful information for that kind.

**Built-in types** — size, value range, and description:

```iecst
VAR
    x : DINT;   // Hover over DINT → "32-bit signed integer, −2147483648 … 2147483647"
END_VAR
```

**Standard function blocks** — inputs, outputs, and description:

```
TON — Timer On-Delay  (Tc2_Standard)
Inputs:  IN: BOOL, PT: TIME
Outputs: Q: BOOL, ET: TIME
Starts timing when IN rises. Q becomes TRUE after PT has elapsed.
```

**Local variables** — declared type with array dimensions and qualifiers:

```iecst
VAR
    buffer : ARRAY[0..9] OF BYTE;
    pCtrl  : POINTER TO MyController;
END_VAR
(* Hover over 'buffer' → "ARRAY[0..9] OF BYTE" *)
(* Hover over 'pCtrl'  → "POINTER TO MyController" *)
```

**User-defined POUs** — POU kind and name:

```
FUNCTION_BLOCK PumpController
```

**STRUCT types** — field list with types:

```
STRUCT Point3D
  X : REAL
  Y : REAL
  Z : REAL
```

**ENUM types** — member list with values.

**TwinCAT pragmas** — documentation for `{attribute ...}` declarations. See [Pragma Documentation](twincat.md#pragma-documentation).

## Go-to-Definition

Press `F12` (or right-click → **Go to Definition**) on an identifier to jump to its declaration.

| Symbol | Where it jumps |
|--------|---------------|
| Local variable | VAR declaration in the same POU |
| FOR loop variable | `FOR i :=` header line |
| ACTION name | ACTION body in the same or cross-file FB |
| POU (same file) | PROGRAM / FUNCTION_BLOCK / FUNCTION declaration |
| POU (cross-file) | Declaration in any indexed file in the TwinCAT project |
| `SUPER^.Member` | Parent FB's method or property (follows EXTENDS chain) |

### Cross-file navigation

When a `.tsproj` or `.plcproj` file is present in the workspace, all ST source files (`.st`, `.TcPOU`, `.TcGVL`, `.TcDUT`, `.TcIO`) are indexed automatically. Go-to-Definition follows POU references across the entire project.

> **Note:** The workspace index is built on startup and updated whenever project files change. Large projects may take a moment to fully index.

## Find References

Press `Shift+F12` (or right-click → **Find All References**) to list every place a symbol is used.

```iecst
TYPE E_State : (Idle, Running, Fault) END_TYPE;
//       ↑ Find References on E_State shows all VAR declarations and CASE blocks using it
```

References are found in:
- The current file
- All indexed files in the workspace

Matching is **case-insensitive** (ST is a case-insensitive language).

## Rename Symbol

Press `F2` (or right-click → **Rename Symbol**) to rename a variable, POU, or type across the entire workspace in one step.

```iecst
(* Rename 'pumpSpeed' to 'motorSpeed' — updates all usages in all files *)
VAR
    pumpSpeed : REAL;
END_VAR
runPump(speed := pumpSpeed);
```

> **Note:** Member access like `obj.field` only renames the object (`obj`), not the field name. To rename a STRUCT field or FB member, position the cursor directly on the field declaration.

## Workspace Symbols

Press `Ctrl+T` and type a symbol name to search for POUs, methods, properties, and global variables across the entire workspace:

| Symbol kind | What is searched |
|-------------|-----------------|
| PROGRAM | Top-level programs |
| FUNCTION_BLOCK | FB type declarations |
| FUNCTION | Function declarations |
| METHOD | FB methods |
| PROPERTY | FB properties |
| VAR_GLOBAL | Global variable declarations |

Results are filtered by the query string (case-insensitive substring match), with up to 100 results returned.

## Document Symbols

The **Outline** panel (`Ctrl+Shift+O` or the breadcrumb bar) shows all symbols in the current file as a nested hierarchy:

```
MyController (FUNCTION_BLOCK)
├── VAR_INPUT
│   ├── Enable : BOOL
│   └── Setpoint : REAL
├── VAR
│   └── pid : PidAlgorithm
├── Run (METHOD)
├── Reset (METHOD)
└── Speed (PROPERTY)
```

STRUCT fields, ENUM members, and EXTENDS relationships are also shown.

## Inlay Hints

For function and FB calls that use positional arguments, ST LSP shows inline parameter name hints:

```iecst
(* Written as: *)
Move(source, destination, size);

(* Displayed as: *)
Move(src: source, dst: destination, len: size);
```

Named arguments (e.g. `Move(src := source, ...)`) are already explicit and do not show hints.

## Signature Help

While typing a function call, a popup shows the parameter list with the current parameter highlighted:

```iecst
MemCopy(pDest := buffer,  (* <-- popup: pDest: POINTER TO BYTE, pSrc: POINTER TO BYTE, n: UDINT *)
```

Signature help works for:
- Standard library function blocks (TON, CTU, …)
- User-defined FUNCTION and FUNCTION_BLOCK types
- Variable instances whose type is a known FB

The active parameter is tracked by counting commas at the current nesting level.

## Folding Ranges

VS Code's built-in folding (`Ctrl+Shift+[` to collapse, `Ctrl+Shift+]` to expand) works with ST LSP's structure, allowing you to collapse:

- PROGRAM / FUNCTION_BLOCK / FUNCTION bodies
- VAR / VAR_INPUT / VAR_OUTPUT blocks
- IF / FOR / WHILE / CASE blocks
- METHOD and PROPERTY bodies
