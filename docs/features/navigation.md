---
layout: default
title: Navigation
parent: Features
nav_order: 3
---

# Navigation

ST LSP supports hover documentation and Go-to-Definition for Structured Text symbols.

## Hover Documentation

Hovering over a symbol shows a documentation tooltip with:

- **Built-in types** — size, value range, description
- **Standard function blocks** — inputs, outputs, description
- **Local variables** — declared type and VAR section
- **POUs** — type (PROGRAM / FUNCTION_BLOCK / FUNCTION) and name

**Example — hover over `TON`:**

```
TON — Timer On-Delay
Inputs:  IN: BOOL, PT: TIME
Outputs: Q: BOOL, ET: TIME
Starts timing when IN rises. Q becomes TRUE after PT has elapsed.
```

## Go-to-Definition

Press `F12` (or right-click → **Go to Definition**) on any identifier to jump to its declaration.

### Supported targets

| Symbol | Resolution |
|--------|-----------|
| Local variable | Declaration in the same POU's VAR section |
| POU name | Declaration in the same file |
| Cross-file POU | Declaration in any indexed ST file in the TwinCAT project |

### TwinCAT cross-file navigation

When a `.tsproj` or `.plcproj` file is present in the workspace, all ST source files are indexed automatically. Go-to-Definition resolves POU names across the entire project.
