---
layout: default
title: Features
nav_order: 3
has_children: true
---

# Features

ST LSP provides a full set of language intelligence features for IEC 61131-3 Structured Text in VS Code.

## Completion

| Feature | Description |
|---------|-------------|
| [Keyword completion](completion.md#keywords) | All IEC 61131-3 reserved words |
| [Type completion](completion.md#built-in-types) | Elementary types (BOOL, INT, REAL, …) |
| [Standard FB completion](completion.md#standard-function-blocks) | TON, CTU, R_TRIG and more |
| [Variable completion](completion.md#local-variables-and-pous) | Local vars, POUs, global vars |
| [Dot-accessor completion](completion.md#dot-accessor-member-completion) | `myTimer.Q`, FB outputs and STRUCT fields |
| [Enum-aware completion](completion.md#enum-aware-completion) | `:=` and CASE assignments show enum values |
| [Library-aware completion](completion.md#library-aware-completion) | Filters FBs to referenced libraries |
| [SUPER^ completion](completion.md#super-completion) | Parent FB members in derived FBs |

## Diagnostics & Code Actions

| Feature | Description |
|---------|-------------|
| [Syntax diagnostics](diagnostics.md#syntax-diagnostics) | Real-time parser error reporting |
| [Semantic diagnostics](diagnostics.md#semantic-diagnostics) | Type mismatch, undefined identifiers, duplicate names |
| [Library diagnostics](diagnostics.md#library-diagnostics) | Warns when standard FBs are used without library reference |
| [QuickFix: declare variable](diagnostics.md#quickfix-declare-variable) | Inserts variable declaration into VAR block |
| [QuickFix: uppercase keyword](diagnostics.md#quickfix-uppercase-keyword) | Converts lowercase keyword to uppercase |

## Navigation

| Feature | Description |
|---------|-------------|
| [Hover](navigation.md#hover-documentation) | Type info, stdlib docs, pragma documentation |
| [Go-to-Definition](navigation.md#go-to-definition) | Local declarations and cross-file POU navigation |
| [Find References](navigation.md#find-references) | All usages of a symbol across the workspace |
| [Rename Symbol](navigation.md#rename-symbol) | Cross-file rename of variables, POUs, types |
| [Workspace Symbols](navigation.md#workspace-symbols) | Quick open symbol by name (`Ctrl+T`) |
| [Document Symbols](navigation.md#document-symbols) | Outline view with nested POU hierarchy |
| [Inlay Hints](navigation.md#inlay-hints) | Inline parameter name hints for function calls |
| [Signature Help](navigation.md#signature-help) | Parameter list popup while typing function calls |

## Formatting & Appearance

| Feature | Description |
|---------|-------------|
| [Document formatting](formatting.md#document-formatting) | Keyword uppercasing and consistent indentation |
| [Semantic tokens](formatting.md#semantic-tokens) | Rich syntax highlighting by symbol kind |
| [Code Lens](formatting.md#code-lens) | Implementation count above INTERFACE and FUNCTION_BLOCK |
| [Folding ranges](formatting.md#folding-ranges) | Collapse POU and VAR blocks |

## TwinCAT Integration

| Feature | Description |
|---------|-------------|
| [TwinCAT XML files](twincat.md#twincat-xml-files) | `.TcPOU`, `.TcGVL`, `.TcDUT`, `.TcIO` support |
| [Project file indexing](twincat.md#project-file-indexing) | `.plcproj` / `.tsproj` discovery and cross-file navigation |
| [ACTION blocks](twincat.md#action-blocks) | Navigation and completion inside TwinCAT ACTION sections |
| [Pragma documentation](twincat.md#pragma-documentation) | Hover docs for `{attribute ...}` pragmas |
| [Standard library catalog](twincat.md#standard-library-catalog) | Built-in Tc2_Standard and other library FBs |
