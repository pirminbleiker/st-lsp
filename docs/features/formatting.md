---
layout: default
title: Formatting & Appearance
parent: Features
nav_order: 4
---

# Formatting & Appearance

ST LSP enhances the visual presentation of Structured Text code through document formatting, semantic syntax highlighting, and code lens annotations.

## Document Formatting

Use **Format Document** (`Shift+Alt+F`) or enable **Format on Save** to automatically format an entire `.st` file. The formatter works on the token stream (not the AST) for robustness on partially-written code.

### Keyword Uppercasing

All IEC 61131-3 keywords are converted to uppercase:

```iecst
(* Before formatting *)
function_block myController
var_input
    enable : bool;
end_var

if enable then
    run();
end_if

end_function_block

(* After formatting *)
FUNCTION_BLOCK myController
VAR_INPUT
    enable : BOOL;
END_VAR

IF enable THEN
    run();
END_IF

END_FUNCTION_BLOCK
```

### Indentation

The formatter applies consistent two-space (or tab-based) indentation following IEC 61131-3 structure:

| Token | Effect |
|-------|--------|
| `END_IF`, `END_FOR`, `END_WHILE`, `END_VAR`, `ELSE`, `ELSIF` | Decrease indent before |
| `END_PROGRAM`, `END_FUNCTION_BLOCK`, `END_TYPE` | Reset to column 0 |
| `PROGRAM`, `FUNCTION_BLOCK`, `FUNCTION`, `METHOD`, `TYPE` | Increase indent after |
| `THEN`, `DO`, `REPEAT`, `VAR*`, `STRUCT` | Increase indent (if last token on line) |

### Operator Spacing

The formatter ensures consistent spacing around operators and punctuation:

| Rule | Example |
|------|---------|
| Space around binary operators | `a := b + c` (not `a:=b+c`) |
| No space before `;`, `,`, `)`, `]` | `foo(a, b);` |
| No space after `(`, `[` | `arr[0]` |
| No space around `.` | `timer.Q` |
| Unary minus treated correctly | `x := -1;` vs `x := a - 1;` |

Comments (inline `//` and block `(* *)`) are preserved exactly as written.

## Semantic Tokens

ST LSP provides **semantic syntax highlighting** on top of the standard TextMate grammar. Symbols are coloured by their actual meaning — not just their syntax — so variable names, type names, keywords, and function blocks each get a distinct colour.

### Token Types

| Token type | What is highlighted |
|-----------|---------------------|
| `keyword` | Control flow, declarations, operators |
| `type` | Built-in types, custom TYPEs, ALIASes |
| `function` | PROGRAM, FUNCTION_BLOCK, FUNCTION names |
| `variable` | VAR, VAR_GLOBAL declarations |
| `parameter` | VAR_INPUT, VAR_OUTPUT, VAR_IN_OUT |
| `enumMember` | Enum value names |
| `property` | FB PROPERTY declarations |
| `method` | FB METHOD declarations |
| `interface` | INTERFACE declarations |
| `comment` | `//` and `(* *)` comments |
| `string` | Quoted string literals |
| `number` | Integer and real literals |

### Token Modifiers

| Modifier | Meaning |
|----------|---------|
| `declaration` | The site where the symbol is declared |
| `abstract` | ABSTRACT method in an FB |
| `defaultLibrary` | Built-in type or standard library FB |

> **Note:** Semantic token colours follow your VS Code theme. Themes that support semantic highlighting (most modern themes do) will automatically apply distinct colours per token type.

## Code Lens

Code lens annotations appear above INTERFACE and FUNCTION_BLOCK declarations, showing relationship statistics computed from the workspace index:

**INTERFACE** — how many FBs implement it:

```iecst
(* 3 implementations *)
INTERFACE I_Sensor
    METHOD GetValue : REAL;
END_INTERFACE
```

**FUNCTION_BLOCK** — how many FBs extend it:

```iecst
(* 2 children *)
FUNCTION_BLOCK BasePump
END_FUNCTION_BLOCK
```

**METHOD** — how many extending FBs override it:

```iecst
FUNCTION_BLOCK BasePump
    (* overridden in 1 FB *)
    METHOD Run : BOOL
    END_METHOD
END_FUNCTION_BLOCK
```

Click the code lens annotation to jump to the list of implementations, children, or overrides.

> **Note:** Code lens counts are computed from the workspace index. If the count appears stale, save any modified files to trigger re-indexing.
