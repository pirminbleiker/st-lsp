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
| Error | Syntax violations that prevent parsing |
| Warning | Recoverable issues (future — not yet implemented) |
