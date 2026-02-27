---
layout: default
title: Code Completion
parent: Features
nav_order: 1
---

# Code Completion

ST LSP provides context-aware completions as you type in `.st` and TwinCAT source files. Press `Ctrl+Space` to trigger manually, or completions appear automatically after typing.

## Keywords

All IEC 61131-3 reserved words are offered as completions, including control flow, declarations, and operators:

```iecst
IF condition THEN
    // ...
ELSIF other THEN
    // ...
ELSE
    // ...
END_IF

FOR i := 0 TO 9 BY 1 DO
    // ...
END_FOR

WHILE running DO
    // ...
END_WHILE

CASE state OF
    0: action0();
    1: action1();
END_CASE
```

## Built-in Types

All IEC 61131-3 elementary data types appear as completions, with size and range information shown in the completion detail:

| Type | Size | Range |
|------|------|-------|
| `BOOL` | 1 bit | TRUE / FALSE |
| `BYTE` | 8 bit | 0 … 255 |
| `WORD` | 16 bit | 0 … 65535 |
| `INT` | 16 bit | −32768 … 32767 |
| `UINT` | 16 bit | 0 … 65535 |
| `DINT` | 32 bit | −2147483648 … 2147483647 |
| `UDINT` | 32 bit | 0 … 4294967295 |
| `LINT` | 64 bit | −2⁶³ … 2⁶³−1 |
| `REAL` | 32 bit | ±3.4×10³⁸ |
| `LREAL` | 64 bit | ±1.8×10³⁰⁸ |
| `STRING` | variable | text up to 255 chars |
| `TIME` | 32 bit | duration (e.g. `T#5S`) |
| `DATE` | 32 bit | calendar date |
| `TOD` | 32 bit | time of day |
| `DT` | 64 bit | date and time |

## Standard Function Blocks

IEC 61131-3 standard library function blocks appear as completions with their input and output signatures:

**Timers**

```iecst
VAR
    myTimer : TON;
END_VAR

myTimer(IN := startCondition, PT := T#5S);
IF myTimer.Q THEN
    // Timer elapsed
END_IF
```

| FB | Description |
|----|-------------|
| `TON` | Timer On-Delay |
| `TOF` | Timer Off-Delay |
| `TP` | Timer Pulse |
| `RTC` | Real-Time Clock |

**Counters**

| FB | Description |
|----|-------------|
| `CTU` | Up Counter |
| `CTD` | Down Counter |
| `CTUD` | Up/Down Counter |

**Edge Detectors & Bistables**

| FB | Description |
|----|-------------|
| `R_TRIG` | Rising Edge Detector |
| `F_TRIG` | Falling Edge Detector |
| `SR` | Set-Reset Bistable |
| `RS` | Reset-Set Bistable |

> **Note:** Only FBs from libraries referenced in your `.plcproj` project file are shown. See [Library-aware completion](#library-aware-completion).

## Local Variables and POUs

Variables declared in `VAR` sections of the current POU body are offered as completions. User-defined POUs (PROGRAM, FUNCTION_BLOCK, FUNCTION), custom TYPEs (STRUCT, ENUM, ALIAS), and global variables from `VAR_GLOBAL` blocks are also included.

```iecst
FUNCTION_BLOCK MyController
VAR_INPUT
    Enable : BOOL;
    Setpoint : REAL;
END_VAR
VAR
    pid : PID_Controller;    // <-- appears in completions
    errorSum : REAL;         // <-- appears in completions
END_VAR
```

## Dot-Accessor Member Completion

After typing a `.` on a variable, ST LSP resolves the variable's type and shows only the members that belong to it:

**Function Block outputs and inputs:**

```iecst
VAR
    timer : TON;
END_VAR

timer.Q    // <-- Q, ET, IN, PT suggested after the dot
```

**STRUCT fields:**

```iecst
TYPE MyPoint :
STRUCT
    X : REAL;
    Y : REAL;
    Z : REAL;
END_STRUCT
END_TYPE

VAR
    pos : MyPoint;
END_VAR

pos.X    // <-- X, Y, Z suggested after the dot
```

**Methods and Properties:**

```iecst
VAR
    ctrl : MyController;
END_VAR

ctrl.Start()    // <-- methods and properties suggested
```

## Enum-Aware Completion

When assigning to a variable with an enumeration type, or inside a CASE block whose selector is an enum, only the valid enum values are shown:

```iecst
TYPE E_Color : (RED, GREEN, BLUE) END_TYPE;

VAR
    color : E_Color;
END_VAR

color := E_Color.    // <-- RED, GREEN, BLUE suggested
```

**CASE block completion:**

```iecst
CASE color OF
    E_Color.    // <-- RED, GREEN, BLUE suggested here too
END_CASE
```

## Library-Aware Completion

ST LSP reads your `.plcproj` project file to discover which libraries are referenced. Standard function blocks are filtered to only show symbols from those libraries — preventing accidental use of unavailable FBs.

If you use a standard FB that is not in your project's library references, a [library diagnostic](../diagnostics.md#library-diagnostics) warning is reported.

> **Note:** Library-aware filtering applies to standard library FBs (e.g. Tc2_Standard). User-defined types from your own project files are always shown regardless.

## SUPER^ Completion

In a derived FUNCTION_BLOCK that uses `EXTENDS`, typing `SUPER^.` shows the parent FB's outputs, methods, and properties:

```iecst
FUNCTION_BLOCK ChildController EXTENDS BaseController
VAR_INPUT
    ExtraParam : REAL;
END_VAR

METHOD Run
    SUPER^.Run();       // <-- BaseController's Run method suggested
    SUPER^.Reset();     // <-- parent methods and outputs shown
END_METHOD
```

## THIS. Completion

Inside a FUNCTION_BLOCK method, `THIS.` shows the FB's own actions, methods, and properties:

```iecst
FUNCTION_BLOCK MyFB
METHOD Init
    THIS.Reset();    // <-- actions and methods of MyFB suggested
END_METHOD
```
