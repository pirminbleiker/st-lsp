# Test Fixture Documentation

Individual fixture descriptions with use cases.

## Interfaces

### I_Disposable.TcIO

**Purpose:** Defines the resource management pattern for objects requiring cleanup.

**Key Features:**
- Single `Dispose()` method
- Extends `__System.IQueryInterface` base
- Establishes cleanup contract for implementing classes

**Use Cases:**
- Testing interface parsing and navigation
- Symbol resolution for interface implementations
- Hover information for interface names
- Go-to-definition for method declarations

**Code Structure:**
```
INTERFACE I_Disposable EXTENDS __System.IQueryInterface
  METHOD PUBLIC Dispose
END_INTERFACE
```

---

### I_LinkedList.TcIO

**Purpose:** Generic collection contract defining linked list operations.

**Key Features:**
- Multiple methods for list manipulation
- Generic type parameters (uses `ANY` for element types)
- Extends interface hierarchy

**Methods:**
- Node manipulation (AddFirst, AddLast, Remove)
- Item access (First, Last, Count)
- Iteration (GetEnumerator)

**Use Cases:**
- Testing generic type parsing
- Cross-file reference resolution
- Multiple method symbol completion
- Type-aware method signature validation

**Complexity:** Higher - demonstrates complex interface with multiple members

---

### I_LinkedListNode.TcIO

**Purpose:** Internal node interface for linked list implementation.

**Key Features:**
- Encapsulates node behavior
- Generic node with ANY type
- Part of collection abstraction

**Use Cases:**
- Testing nested generic types
- Interface composition patterns
- Partial symbol visibility (internal interfaces)

---

## Classes

### Disposable.TcPOU

**Purpose:** Abstract base class implementing resource lifecycle management.

**Key Features:**
- `ABSTRACT` keyword - cannot be directly instantiated
- Implements `I_Disposable` interface
- `{attribute 'enable_dynamic_creation'}` - allows dynamic creation
- `{attribute 'linkalways'}` - ensures symbol is linked
- `FB_exit` destructor for cleanup

**Methods:**
- `Dispose()` - Public cleanup method
- `FB_exit()` - System destructor called during object deletion

**Code Patterns Demonstrated:**
```
{attribute 'linkalways'}
{attribute 'no_explicit_call' := 'This FB is a CLASS...'}
{attribute 'enable_dynamic_creation'}
FUNCTION_BLOCK ABSTRACT Disposable IMPLEMENTS I_Disposable
  VAR
  END_VAR

  METHOD PUBLIC Dispose
    pDisposable : POINTER TO Disposable;
    // __DELETE(pDisposable) call
  END_METHOD

  METHOD FB_exit : BOOL
    VAR_INPUT
      bInCopyCode : BOOL;
    END_VAR
    // Cleanup implementation
  END_METHOD
END_FUNCTION_BLOCK
```

**Use Cases:**
- Parsing abstract classes and attributes
- Method folder organization (Destructor)
- Pointer semantics and __DELETE
- Inheritance chain analysis
- Destructor detection for resource management

**Complexity:** Medium - demonstrates attributes, destructors, abstract concepts

---

### LinkedList.TcPOU

**Purpose:** Generic collection implementation demonstrating advanced OOP patterns.

**Key Features:**
- Generic type with `ANY` parameters
- Implements `I_LinkedList` interface
- Complex method implementations
- Composition with LinkedListNode
- Iterator pattern

**Methods:**
- Node management (AddFirst, AddLast, RemoveFirst, etc.)
- Access methods (First, Last, Find)
- Modification (Clear, Remove)
- Iteration (GetEnumerator)

**Data Structures:**
```
VAR
  _head : POINTER TO LinkedListNode;
  _tail : POINTER TO LinkedListNode;
  _count : DINT;
  _version : DINT;
END_VAR
```

**Use Cases:**
- Testing generic type inference
- Complex symbol hierarchies
- Method name resolution in large types
- Pointer navigation and references
- Variable scope analysis
- Type system validation

**Complexity:** High - demonstrates real-world patterns

---

### LinkedListNode.TcPOU

**Purpose:** Internal node implementation for linked list structure.

**Key Features:**
- Generic node with ANY element type
- Implements I_LinkedListNode
- Bidirectional links (next, previous)
- Encapsulates node behavior

**Methods:**
- Link manipulation
- Value access
- Node navigation

**Code Pattern:**
```
FUNCTION_BLOCK LinkedListNode IMPLEMENTS I_LinkedListNode
  VAR
    _value : ANY;
    _next : POINTER TO LinkedListNode;
    _previous : POINTER TO LinkedListNode;
  END_VAR
  // Methods for link management
END_FUNCTION_BLOCK
```

**Use Cases:**
- Nested generic type handling
- Pointer chain analysis
- Bidirectional reference resolution
- Memory model understanding
- Recursive structure handling

**Complexity:** Medium-High - demonstrates pointer chains and generics

---

## Global Constants

### DatatypeLimits.TcGVL

**Purpose:** System-wide constant definitions for type limits.

**Key Features:**
- Global variable file (.TcGVL)
- Large set of constant definitions
- Cross-file reference example
- Type limit specifications

**Contents:**
- Min/max values for primitive types (SINT, INT, DINT, LINT, etc.)
- String length limits
- Array size limits
- Special constant values

**Use Cases:**
- Testing global variable parsing
- Constant resolution across files
- Cross-file reference navigation
- Type system validation
- Completion for constant names

**Complexity:** Low - demonstrative of global scope

---

## Testing Strategy

Use these fixtures to validate LSP functionality:

### Parsing Tests
- Verify all file types parse without errors
- Validate XML structure recognition
- Test CDATA handling

### Symbol Resolution
- Find declarations of interfaces/classes
- Resolve cross-file references (Disposable implements I_Disposable)
- Navigate between interface and implementation

### Type System
- Verify abstract class detection
- Generic type parameter inference
- Pointer type analysis
- Interface hierarchy walking

### LSP Features
- **Hover**: Display signatures for classes, methods, interfaces
- **Go-to-Definition**: Navigate from usage to declaration
- **Completion**: Method/variable name completion
- **Rename**: Refactor names across files
- **Find References**: Find all uses of a symbol
- **Diagnostics**: Detect type mismatches, undefined symbols

### Advanced Patterns
- Detect destructors (FB_exit)
- Resolve method folders
- Analyze generic specializations
- Build inheritance graphs

## Performance Considerations

- **File Sizes**: DatatypeLimits.TcGVL is large (~20KB) - tests large file handling
- **Symbol Count**: LinkedList.TcPOU has multiple methods - tests deep symbol trees
- **Reference Density**: Multiple files reference each other - tests cross-file performance

## Modification Notes

These fixtures are extracted from mobject-core and should remain unmodified to maintain compatibility with external reference. If needing test-specific variants, create new fixtures rather than modifying existing ones.
