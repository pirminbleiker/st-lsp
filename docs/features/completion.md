---
layout: default
title: Code Completion
parent: Features
nav_order: 1
---

# Code Completion

ST LSP provides context-aware completions as you type in `.st` files.

## What Gets Completed

### Keywords
All IEC 61131-3 reserved words are available as completions:

```
IF, THEN, ELSE, ELSIF, END_IF
FOR, TO, BY, DO, END_FOR
WHILE, END_WHILE
CASE, OF, END_CASE
PROGRAM, FUNCTION_BLOCK, FUNCTION, END_PROGRAM, END_FUNCTION_BLOCK, END_FUNCTION
VAR, VAR_INPUT, VAR_OUTPUT, VAR_IN_OUT, VAR_GLOBAL, END_VAR
...
```

### Built-in Types
All IEC 61131-3 elementary data types:

| Type | Size | Range |
|------|------|-------|
| `BOOL` | 1 bit | TRUE / FALSE |
| `INT` | 16 bit | -32768 … 32767 |
| `DINT` | 32 bit | -2147483648 … 2147483647 |
| `REAL` | 32 bit | ±3.4×10³⁸ |
| `LREAL` | 64 bit | ±1.8×10³⁰⁸ |
| `STRING` | variable | text |
| `TIME` | 32 bit | duration |
| `DATE` | 32 bit | calendar date |
| … | | |

### Standard Function Blocks
IEC 61131-3 standard library FBs, including:

- **Timers**: `TON`, `TOF`, `TP`
- **Counters**: `CTU`, `CTD`, `CTUD`
- **Bistables**: `SR`, `RS`
- **Edge detectors**: `R_TRIG`, `F_TRIG`

### Local Variables
Variables declared in the current POU's `VAR` sections are offered as completions within that POU's body.

## Triggering Completion

Completion triggers automatically after typing or can be invoked manually with `Ctrl+Space`.

The server registers two trigger characters:

- **`.` (dot)** — triggers member completion on function blocks, structs, and enums
- **`:` (colon)** — triggers enum-aware completion after `:=`

## Member Completion

Typing `.` after a variable shows members of its resolved type.

```iecst
VAR
  fbMotor : FB_Motor;
END_VAR
fbMotor.  (* shows VAR_INPUT, VAR_OUTPUT, VAR_IN_OUT, methods, and properties *)
```

The server resolves the identifier before the dot, looks up its type, and returns matching members. This works through chains of nested types:

```iecst
fbMotor.stConfig.nMaxSpeed  (* resolves FB_Motor → stConfig's type → nMaxSpeed *)
```

Pointer dereference syntax is also supported — `myPtr^.` dereferences the pointer first, then shows members of the pointed-to type.

### Visibility Filtering

Access modifiers control which members appear depending on the access context:

| Modifier | External (`fbVar.`) | `SUPER^.` | `THIS^.` |
|----------|---------------------|-----------|----------|
| *(none / public)* | Visible | Visible | Visible |
| `INTERNAL` | Visible | Visible | Visible |
| `PROTECTED` | Hidden | Visible | Visible |
| `PRIVATE` | Hidden | Hidden | Visible |

- **External access** (`fbVar.`) only shows `VAR_INPUT`, `VAR_OUTPUT`, `VAR_IN_OUT`, and public methods/properties. Internal variables and private/protected members are excluded.
- **`THIS^.`** shows all own members plus inherited members (excluding inherited `PRIVATE` members).

### SUPER^ Completion

Inside a function block that uses `EXTENDS`, typing `SUPER^.` shows members inherited from the parent:

```iecst
FUNCTION_BLOCK FB_Child EXTENDS FB_Parent
VAR END_VAR
  SUPER^.  (* shows FB_Parent's members, walking up the EXTENDS chain *)
END_FUNCTION_BLOCK
```

`SUPER^` walks the entire inheritance chain recursively — grandparent members are included. `PRIVATE` members from parent FBs are excluded, but `PROTECTED` members are visible. `FINAL` methods appear normally (they are callable, just not overridable).

## Enum-Aware Completion

### After `:=` Assignment

When the left-hand side of `:=` is an enum-typed variable, completion offers only the matching enum values instead of the usual keyword list:

```iecst
TYPE
  E_Color : (Red, Green, Blue);
END_TYPE
VAR
  eColor : E_Color;
END_VAR
eColor :=   (* shows E_Color.Red, E_Color.Green, E_Color.Blue — no keywords *)
```

### Inside CASE Blocks

When a `CASE` selector variable has an enum type, completion inside the `CASE` body offers the enum values:

```iecst
CASE eColor OF
  (* completion here shows E_Color.Red, E_Color.Green, E_Color.Blue *)
END_CASE
```

For non-enum variables, the standard keyword and variable completions are returned as usual.
