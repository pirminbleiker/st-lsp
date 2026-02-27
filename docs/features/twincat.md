---
layout: default
title: TwinCAT Integration
parent: Features
nav_order: 5
---

# TwinCAT Integration

ST LSP includes first-class support for **TwinCAT 3** (Beckhoff) project structures, enabling full language intelligence across multi-file TwinCAT projects.

## TwinCAT XML Files

TwinCAT stores PLC source code inside XML files. ST LSP transparently extracts the ST declarations and implementation from these files:

| File extension | Contents |
|---------------|----------|
| `.TcPOU` | PROGRAM, FUNCTION_BLOCK, or FUNCTION with Declaration + Implementation sections |
| `.TcGVL` | Global Variable List (`VAR_GLOBAL … END_VAR`) |
| `.TcDUT` | Data Unit Type (`TYPE … END_TYPE` for STRUCT, ENUM, ALIAS, UNION) |
| `.TcIO` | INTERFACE definition |

**Example `.TcPOU` structure:**

```xml
<TcPlcObject>
  <POU Name="PumpController" Id="{...}">
    <Declaration><![CDATA[
FUNCTION_BLOCK PumpController
VAR_INPUT
    Enable : BOOL;
    Setpoint : REAL;
END_VAR
VAR
    pid : PID;
END_VAR
    ]]></Declaration>
    <Implementation>
      <ST><![CDATA[
IF Enable THEN
    pid(Setpoint := Setpoint);
END_IF
      ]]></ST>
    </Implementation>
  </POU>
</TcPlcObject>
```

ST LSP extracts the `CDATA` sections, joins Declaration and Implementation with a newline, and parses the result as plain ST. Diagnostic positions are mapped back to the correct line numbers in the original XML file.

> **Note:** Plain `.st` files are also fully supported alongside `.TcPOU` files.

## Project File Indexing

When a `.tsproj` or `.plcproj` file is present in the workspace, ST LSP automatically discovers and indexes all ST source files in the project, enabling cross-file navigation (Go-to-Definition, Find References, Rename) across the entire PLC project.

### `.plcproj` (MSBuild format)

Standard TwinCAT PLC project files list source files as MSBuild `<Compile>` items:

```xml
<ItemGroup>
  <Compile Include="POUs\PumpController.TcPOU" />
  <Compile Include="GVLs\GlobalConstants.TcGVL" />
  <Compile Include="DUTs\E_PumpState.TcDUT" />
</ItemGroup>
```

### `.tsproj` (TcSmProject format)

Top-level TwinCAT solution files that reference PLC sub-projects:

```xml
<TcSmProject>
  <Project>
    <Plc>
      <Project File="MyPLC\MyPLC.plcproj" />
    </Plc>
  </Project>
</TcSmProject>
```

### Library references

ST LSP reads the library references from the `.plcproj` file to enable [library-aware completion](completion.md#library-aware-completion) and [library diagnostics](diagnostics.md#library-diagnostics):

```xml
<LibraryReference>
  <LibraryRef Name="Tc2_Standard" Version="*" Vendor="Beckhoff Automation GmbH" />
  <LibraryRef Name="Tc2_Math" Version="*" Vendor="Beckhoff Automation GmbH" />
</LibraryReference>
```

Only function blocks from referenced libraries are offered in completion lists.

## Action Blocks

TwinCAT FUNCTION_BLOCKs can have named ACTION blocks — separate method-like bodies within a single `.TcPOU` file:

```iecst
FUNCTION_BLOCK PumpController
VAR
    running : BOOL;
END_VAR
```

```iecst
(* ACTION: Start *)
running := TRUE;
```

```iecst
(* ACTION: Stop *)
running := FALSE;
```

ST LSP supports:
- **Go-to-Definition** on `PumpController.Start` jumps to the ACTION body
- **Hover** on action invocations shows the action name and owning FB
- **Document Symbols** lists actions as children of the FB in the Outline

## Pragma Documentation

TwinCAT uses `{attribute '...'}` pragmas to attach metadata to declarations. Hovering over a pragma shows its documentation:

| Pragma | Purpose |
|--------|---------|
| `{attribute 'hide'}` | Hides the symbol from IntelliSense and object browsers |
| `{attribute 'obsolete' := 'message'}` | Marks the symbol as deprecated with a custom warning message |
| `{attribute 'no_copy'}` | Prevents the FB from being copied (for resource-managing FBs) |
| `{attribute 'monitoring' := 'call'}` | Controls how the symbol appears in the watch window |
| `{attribute 'qualified_only'}` | Requires enum values to be fully qualified (`E_Color.RED`, not `RED`) |
| `{attribute 'reflection'}` | Enables runtime reflection support |
| `{attribute 'call_after_init'}` | Invokes the FB automatically after PLC initialization |
| `{attribute 'TcNoFPU'}` | Instructs the compiler not to generate FPU instructions |
| `{attribute 'enable_dynamic_creation'}` | Allows `__NEW` dynamic instantiation |
| `{attribute 'OPC.UA.DA' := '1'}` | Exposes the symbol via OPC UA Data Access |

**Example:**

```iecst
{attribute 'obsolete' := 'Use NewPumpController instead'}
FUNCTION_BLOCK OldPumpController
(* Hover shows: Marks this symbol as deprecated.
   Callers will receive a compiler warning. *)
```

## Standard Library Catalog

ST LSP includes a built-in catalog of Beckhoff standard library function blocks. The catalog provides:

- **Completion** — FB names appear in suggestions when the library is referenced
- **Hover** — inputs, outputs, and description shown on hover
- **Signature help** — parameter list shown while typing a call

### Tc2_Standard

The core IEC 61131-3 standard library, automatically catalogued:

| Category | Function Blocks |
|----------|----------------|
| Timers | `TON`, `TOF`, `TP`, `RTC` |
| Counters | `CTU`, `CTD`, `CTUD` |
| Edge detection | `R_TRIG`, `F_TRIG` |
| Bistables | `SR`, `RS` |
| String operations | `CONCAT`, `LEFT`, `RIGHT`, `MID`, `LEN`, `FIND`, … |
| Type conversion | `BOOL_TO_INT`, `INT_TO_REAL`, `REAL_TO_INT`, … |
| Math | `ABS`, `SQRT`, `SIN`, `COS`, `EXP`, `LOG`, … |

> **Note:** Additional Beckhoff libraries (Tc2_Math, Tc2_MC2, etc.) are recognized when referenced in the project file. The catalog is extensible via the `stdlib.ts` source file.
