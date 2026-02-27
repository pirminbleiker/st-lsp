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
