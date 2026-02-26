# TwinCAT 3 File Format Quick Reference

Syntax guide for .TcPOU, .TcIO, .TcDUT, and .TcGVL files.

## XML Structure

```xml
<?xml version="1.0" encoding="utf-8"?>
<TcPlcObject Version="1.1.0.1" ProductVersion="3.1.4024.12">
  <!-- Element type varies by file -->
</TcPlcObject>
```

## Interfaces (.TcIO)

```
INTERFACE InterfaceName [EXTENDS BaseInterface]
  <METHOD declaration>
END_INTERFACE
```

**Keywords:**
- `INTERFACE` - Declare interface
- `EXTENDS` - Inherit from parent
- `PUBLIC` - Public method/property
- `METHOD` - Method signature only (no implementation)

**Example:**
```
INTERFACE I_Disposable EXTENDS __System.IQueryInterface
  METHOD PUBLIC Dispose
END_INTERFACE
```

## Function Blocks (.TcPOU)

```
[ABSTRACT] FUNCTION_BLOCK ClassName [IMPLEMENTS Interface1, Interface2, ...]
  VAR
    member : Type;
  END_VAR
  <METHOD declarations and implementations>
END_FUNCTION_BLOCK
```

**Keywords:**
- `ABSTRACT` - Cannot be instantiated directly
- `FUNCTION_BLOCK` - Class definition
- `IMPLEMENTS` - Interfaces implemented by this class
- `VAR` - Variable section
- `METHOD` - Method with implementation
- `FB_exit` - Special destructor method

**Example:**
```
{attribute 'enable_dynamic_creation'}
FUNCTION_BLOCK ABSTRACT Disposable IMPLEMENTS I_Disposable
  VAR
    _disposed : BOOL;
  END_VAR
  METHOD PUBLIC Dispose
    // Implementation
  END_METHOD
  METHOD FB_exit : BOOL
    VAR_INPUT
      bInCopyCode : BOOL;
    END_VAR
    // Cleanup code
  END_METHOD
END_FUNCTION_BLOCK
```

## Attributes

Attributes control compilation and behavior:

```
{attribute 'linkalways'} - Always link symbol
{attribute 'enable_dynamic_creation'} - Allow NEW() instantiation
{attribute 'no_explicit_call' := 'reason'} - Prevent direct calls
{attribute 'qualified_only'} - Require fully qualified access
```

## Generic Types

Use `ANY` for generic type parameters:

```
FUNCTION_BLOCK LinkedList
  VAR
    _items : ARRAY[0..99] OF ANY;
    _count : DINT;
  END_VAR
END_FUNCTION_BLOCK
```

## Pointers

```
pVar : POINTER TO TypeName;
pVar := ADR(variable);
__DELETE(pVar);
```

## Global Variables (.TcGVL)

```
{attribute 'qualified_only'}
VAR_GLOBAL CONSTANT
  CONSTANT_NAME : Type := Value;
END_VAR
```

## Data Types (.TcDUT)

```
TYPE TypeName :
  STRUCT
    field1 : Type1;
    field2 : Type2;
  END_STRUCT
END_TYPE
```

## Comments

```
// Single-line comment
(* Multi-line
   comment *)
```

## Variable Sections

```
VAR - Local variables (method scope)
VAR_INPUT - Input parameters
VAR_OUTPUT - Output parameters
VAR_IN_OUT - Input/output parameters
VAR_GLOBAL - Global variables
VAR_STATIC - Static variables (persisted across calls)
```

## Built-in Types

```
BOOL        - Boolean
BYTE, WORD, DWORD, QWORD - Unsigned integers (8, 16, 32, 64 bit)
SINT, INT, DINT, LINT - Signed integers
REAL, LREAL - Floating point
STRING      - Text
TIME, TOD, DATE, DT - Temporal types
```

## Type Modifiers

```
ARRAY[0..N] OF Type - Array
POINTER TO Type - Pointer
REFERENCE TO Type - Reference
ANY - Generic type parameter
```

## Control Structures

```
IF condition THEN
  statements
ELSIF condition THEN
  statements
ELSE
  statements
END_IF

WHILE condition DO
  statements
END_WHILE

FOR i := start TO end DO
  statements
END_FOR
```

## Methods

```
METHOD [PUBLIC|PROTECTED|PRIVATE] MethodName [: ReturnType]
  VAR
    // Local variables
  END_VAR
  // Implementation
END_METHOD
```

## Built-in Methods

```
__DELETE(pointer) - Delete object referenced by pointer
__NEW(Type) - Create new instance
THIS - Current object reference
ADR(variable) - Address of variable
SIZEOF(Type) - Size in bytes
```

## Documentation

In Declaration sections, use CDATA to preserve formatting:

```xml
<Declaration><![CDATA[
  METHOD PUBLIC MyMethod
]]></Declaration>
```

## File Elements Structure

```xml
<TcPlcObject ...>
  <Itf|POU|GVL|DUT Name="..." Id="{guid}">
    <Declaration><![CDATA[...]]></Declaration>
    <Implementation>
      <ST><![CDATA[...]]></ST>
    </Implementation>
    <Folder Name="GroupName" Id="{guid}" />
    <Method Name="..." Id="{guid}" [FolderPath="Folder\"]>
      <Declaration>...</Declaration>
      <Implementation>...</Implementation>
    </Method>
  </Itf|POU|GVL|DUT>
</TcPlcObject>
```
