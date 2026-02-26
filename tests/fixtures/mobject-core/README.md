# mobject-core TwinCAT Test Fixtures

This directory contains extracted test fixtures from the [mobject-core](https://github.com/Mobject-Dev-Team/mobject-core) library, which serves as the stable reference implementation for object-oriented programming (OOP) patterns in TwinCAT 3.

## Purpose

These fixtures provide real-world TwinCAT examples for testing LSP functionality and parsing capabilities. They demonstrate:

- **Interface Contracts**: Type-safe polymorphism in TwinCAT
- **Abstract Base Classes**: Inheritance patterns and abstract methods
- **Generic Collections**: Generic types with ANY type parameters
- **Pointer Semantics**: Memory management and dynamic allocation
- **Lifecycle Management**: Destructors (FB_exit) and resource cleanup
- **Global State**: Cross-file references via .TcGVL files

## File Format Specification

TwinCAT source files are XML-based documents following the TwinCAT 3.x format (v1.1.0.1):

### Structure

All TwinCAT files follow this XML structure:

```xml
<?xml version="1.0" encoding="utf-8"?>
<TcPlcObject Version="1.1.0.1" ProductVersion="3.1.4024.12">
  <!-- Element varies by file type -->
</TcPlcObject>
```

### File Types

#### Interface Files (.TcIO)

Define interface contracts with methods but no implementation:

```xml
<Itf Name="InterfaceName" Id="{guid}">
  <Declaration><![CDATA[
    INTERFACE InterfaceName EXTENDS BaseInterface
  ]]></Declaration>
  <Method Name="MethodName" Id="{guid}">
    <Declaration><![CDATA[METHOD PUBLIC MethodName]]></Declaration>
  </Method>
</Itf>
```

**Attributes:**
- `INTERFACE` keyword declares an interface
- `EXTENDS` specifies parent interface (typically `__System.IQueryInterface`)
- `METHOD PUBLIC` declares public methods
- No `Implementation` element - interface has declaration only

#### Function Block Files (.TcPOU)

Implement function blocks (classes), potentially declaring methods:

```xml
<POU Name="ClassName" Id="{guid}" SpecialFunc="None">
  <Declaration><![CDATA[
    {attribute 'linkalways'}
    {attribute 'enable_dynamic_creation'}
    FUNCTION_BLOCK [ABSTRACT] ClassName [IMPLEMENTS Interface]
    VAR
      // Variable declarations
    END_VAR
  ]]></Declaration>
  <Implementation>
    <ST><![CDATA[// Implementation code ]]></ST>
  </Implementation>
  <Method Name="MethodName" Id="{guid}" [FolderPath="Folder\"]>
    <Declaration><![CDATA[METHOD PUBLIC MethodName]]></Declaration>
    <Implementation>
      <ST><![CDATA[// Method implementation ]]></ST>
    </Implementation>
  </Method>
</POU>
```

**Key Elements:**
- `{attribute 'linkalways'}` - Ensure symbol is linked even if not referenced
- `{attribute 'enable_dynamic_creation'}` - Allow dynamic instantiation
- `ABSTRACT` keyword - Mark class as abstract (cannot be instantiated directly)
- `IMPLEMENTS` - List implemented interfaces
- `<Folder>` - Organize methods into logical groups (e.g., "Destructor")
- `<Method FolderPath="Folder\">` - Place method in folder

#### Global Variable Files (.TcGVL)

Define global variables, constants, and types:

```xml
<GVL Name="GlobalNamespace" Id="{guid}">
  <Declaration><![CDATA[
    {attribute 'qualified_only'}
    VAR_GLOBAL CONSTANT
      // Constant declarations
    END_VAR
  ]]></Declaration>
</GVL>
```

#### Data Type Files (.TcDUT)

Define custom data types (structures, unions, enums):

```xml
<DUT Name="DataTypeName" Id="{guid}">
  <Declaration><![CDATA[
    TYPE DataTypeName :
      // TYPE definition
    END_TYPE
  ]]></Declaration>
</DUT>
```

## Fixture Contents

### Interfaces

- **I_Disposable.TcIO** - Resource management pattern for automatic cleanup
- **I_LinkedList.TcIO** - Generic collection contract
- **I_LinkedListNode.TcIO** - Internal node structure for linked list

### Classes

- **Disposable.TcPOU** - Abstract base class implementing lifecycle management
  - Demonstrates `ABSTRACT` keyword
  - Implements `I_Disposable` interface
  - Shows `FB_exit` destructor for cleanup

- **LinkedList.TcPOU** - Generic collection implementation
  - Demonstrates generic type parameters with `ANY` type
  - Implements `I_LinkedList` interface
  - Shows composition and iteration patterns

- **LinkedListNode.TcPOU** - Internal node class for linked list
  - Demonstrates generic types in nested contexts
  - Implements `I_LinkedListNode` interface

### Global Constants

- **DatatypeLimits.TcGVL** - System constant definitions
  - Min/max values for primitive types
  - Cross-file reference example

## XML Parsing Considerations

When parsing TwinCAT files:

1. **CDATA Sections**: PLC code is wrapped in `<![CDATA[...]]>` to preserve special characters
2. **GUIDs**: Each element has an `Id` attribute containing a GUID - maintain for reference integrity
3. **Attributes**: TwinCAT attributes (`{attribute '...'}`) are significant for behavior
4. **Folders**: Method organization using `<Folder>` elements - important for UI/navigation
5. **Whitespace**: Preserve original whitespace in Declaration/Implementation - may indicate logical structure

## Testing Applications

These fixtures can validate:

- **Parsing**: Lexer and parser handle XML structure correctly
- **Symbol Resolution**: Cross-file references (e.g., interface implementations)
- **Type System**: Generic types, inheritance, polymorphism
- **Semantic Analysis**: Abstract vs concrete classes, method signatures
- **LSP Features**:
  - Hover information over interface/class names
  - Go-to-definition for implemented interfaces
  - Symbol renaming across files
  - Completion for method names and variables

## Source Attribution

Files extracted from [Mobject-Dev-Team/mobject-core](https://github.com/Mobject-Dev-Team/mobject-core) under original license.
