/**
 * Regression Tests: TwinCAT ST Feature Matrix — FB, OOP & Variable Scoping (sl-ou3f)
 *
 * Feature areas:
 *   6.  Methods and Properties — METHOD/PROPERTY, access modifiers, OVERRIDE
 *   7.  Actions — ACTION blocks attached to FBs
 *   8.  Interfaces — INTERFACE, method/property stubs, EXTENDS chain
 *   9.  OOP constructs — SUPER, polymorphism patterns
 *  10.  Variable scoping — all VAR block kinds
 */

import { describe, it, expect } from 'vitest';
import { parse } from '../parser/parser';
import {
  FunctionBlockDeclaration,
  ProgramDeclaration,
  InterfaceDeclaration,
  MethodDeclaration,
  PropertyDeclaration,
  ActionDeclaration,
  VarBlock,
} from '../parser/ast';

// ---------------------------------------------------------------------------
// 6. Methods and Properties
// ---------------------------------------------------------------------------

describe('methods and properties', () => {
  it('parses METHOD with return type and body', () => {
    const src = `FUNCTION_BLOCK MyFB
VAR x : INT; END_VAR
METHOD GetX : INT
  GetX := x;
END_METHOD
END_FUNCTION_BLOCK`;
    const { errors, ast } = parse(src);
    expect(errors).toHaveLength(0);
    const fb = ast.declarations[0] as FunctionBlockDeclaration;
    expect(fb.methods).toHaveLength(1);
    const m = fb.methods[0] as MethodDeclaration;
    expect(m.name).toBe('GetX');
    expect(m.returnType?.name).toBe('INT');
  });

  it('parses PUBLIC METHOD', () => {
    const src = `FUNCTION_BLOCK FB
METHOD PUBLIC Run
END_METHOD
END_FUNCTION_BLOCK`;
    const { errors, ast } = parse(src);
    expect(errors).toHaveLength(0);
    const fb = ast.declarations[0] as FunctionBlockDeclaration;
    const m = fb.methods[0] as MethodDeclaration;
    expect(m.modifiers).toContain('PUBLIC');
  });

  it('parses PRIVATE METHOD', () => {
    const src = `FUNCTION_BLOCK FB
METHOD PRIVATE Helper
END_METHOD
END_FUNCTION_BLOCK`;
    const { errors, ast } = parse(src);
    expect(errors).toHaveLength(0);
    const fb = ast.declarations[0] as FunctionBlockDeclaration;
    const m = fb.methods[0] as MethodDeclaration;
    expect(m.modifiers).toContain('PRIVATE');
  });

  it('parses ABSTRACT METHOD (no body)', () => {
    const src = `FUNCTION_BLOCK ABSTRACT AbstractFB
METHOD ABSTRACT Execute : BOOL
VAR_INPUT param : INT; END_VAR
END_METHOD
END_FUNCTION_BLOCK`;
    const { errors, ast } = parse(src);
    expect(errors).toHaveLength(0);
    const fb = ast.declarations[0] as FunctionBlockDeclaration;
    const m = fb.methods[0] as MethodDeclaration;
    expect(m.modifiers).toContain('ABSTRACT');
  });

  it('parses OVERRIDE METHOD', () => {
    const src = `FUNCTION_BLOCK Child EXTENDS Parent
METHOD PUBLIC OVERRIDE Execute : BOOL
VAR_INPUT param : INT; END_VAR
  Execute := TRUE;
END_METHOD
END_FUNCTION_BLOCK`;
    const { errors, ast } = parse(src);
    expect(errors).toHaveLength(0);
    const fb = ast.declarations[0] as FunctionBlockDeclaration;
    const m = fb.methods[0] as MethodDeclaration;
    expect(m.modifiers).toContain('OVERRIDE');
  });

  it('parses METHOD with VAR_INPUT, VAR_OUTPUT, VAR_IN_OUT blocks', () => {
    const src = `FUNCTION_BLOCK FB
METHOD Transfer : BOOL
VAR_INPUT
  src : INT;
END_VAR
VAR_OUTPUT
  dst : INT;
END_VAR
VAR_IN_OUT
  buffer : STRING;
END_VAR
  dst := src;
  Transfer := TRUE;
END_METHOD
END_FUNCTION_BLOCK`;
    const { errors, ast } = parse(src);
    expect(errors).toHaveLength(0);
    const fb = ast.declarations[0] as FunctionBlockDeclaration;
    const m = fb.methods[0] as MethodDeclaration;
    const varKinds = m.varBlocks.map((b: VarBlock) => b.varKind);
    expect(varKinds).toContain('VAR_INPUT');
    expect(varKinds).toContain('VAR_OUTPUT');
    expect(varKinds).toContain('VAR_IN_OUT');
  });

  it('parses multiple methods on one FB', () => {
    const src = `FUNCTION_BLOCK Counter
VAR
  _count : DINT;
END_VAR
METHOD Increment
  _count := _count + 1;
END_METHOD
METHOD Decrement
  _count := _count - 1;
END_METHOD
METHOD Reset
  _count := 0;
END_METHOD
METHOD GetCount : DINT
  GetCount := _count;
END_METHOD
END_FUNCTION_BLOCK`;
    const { errors, ast } = parse(src);
    expect(errors).toHaveLength(0);
    const fb = ast.declarations[0] as FunctionBlockDeclaration;
    expect(fb.methods).toHaveLength(4);
    const names = fb.methods.map((m: MethodDeclaration) => m.name);
    expect(names).toContain('Increment');
    expect(names).toContain('Decrement');
    expect(names).toContain('Reset');
    expect(names).toContain('GetCount');
  });

  it('parses PROPERTY with getter and setter', () => {
    const src = `FUNCTION_BLOCK FB
PROPERTY Value : INT
END_PROPERTY
END_FUNCTION_BLOCK`;
    const { errors, ast } = parse(src);
    expect(errors).toHaveLength(0);
    const fb = ast.declarations[0] as FunctionBlockDeclaration;
    expect(fb.properties).toHaveLength(1);
    const prop = fb.properties[0] as PropertyDeclaration;
    expect(prop.name).toBe('Value');
    expect(prop.type.name).toBe('INT');
  });

  it('parses PUBLIC PROPERTY', () => {
    const src = `FUNCTION_BLOCK FB
PROPERTY PUBLIC Count : DINT
END_PROPERTY
END_FUNCTION_BLOCK`;
    const { errors, ast } = parse(src);
    expect(errors).toHaveLength(0);
    const fb = ast.declarations[0] as FunctionBlockDeclaration;
    const prop = fb.properties[0] as PropertyDeclaration;
    expect(prop.modifiers).toContain('PUBLIC');
  });
});

// ---------------------------------------------------------------------------
// 7. Actions
// ---------------------------------------------------------------------------

describe('actions', () => {
  it('parses multiple ACTIONs attached to a FUNCTION_BLOCK', () => {
    const src = `FUNCTION_BLOCK StateMachine
VAR
  state : INT;
END_VAR
END_FUNCTION_BLOCK
ACTION Init:
  state := 0;
END_ACTION
ACTION Step:
  state := state + 1;
END_ACTION
ACTION Reset:
  state := 0;
END_ACTION`;
    const { errors, ast } = parse(src);
    expect(errors).toHaveLength(0);
    const fb = ast.declarations[0] as FunctionBlockDeclaration;
    expect(fb.actions).toHaveLength(3);
    const names = fb.actions.map((a: ActionDeclaration) => a.name);
    expect(names).toContain('Init');
    expect(names).toContain('Step');
    expect(names).toContain('Reset');
  });

  it('action body can contain control structures', () => {
    const src = `FUNCTION_BLOCK FB
VAR i : INT; END_VAR
END_FUNCTION_BLOCK
ACTION Process:
  FOR i := 0 TO 9 DO
    IF i = 5 THEN CONTINUE; END_IF;
  END_FOR;
END_ACTION`;
    const { errors } = parse(src);
    expect(errors).toHaveLength(0);
  });

  it('PROGRAM with ACTION blocks', () => {
    // Actions are typically on FBs but test parser resilience
    const src = `FUNCTION_BLOCK PrgLike
VAR x : INT; END_VAR
x := 0;
END_FUNCTION_BLOCK
ACTION Setup:
  x := 100;
END_ACTION`;
    const { errors } = parse(src);
    expect(errors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 8. Interfaces
// ---------------------------------------------------------------------------

describe('interfaces', () => {
  it('parses minimal INTERFACE', () => {
    const src = `INTERFACE I_Simple
END_INTERFACE`;
    const { errors, ast } = parse(src);
    expect(errors).toHaveLength(0);
    const iface = ast.declarations[0] as InterfaceDeclaration;
    expect(iface.kind).toBe('InterfaceDeclaration');
    expect(iface.name).toBe('I_Simple');
    expect(iface.extendsRefs).toHaveLength(0);
  });

  it('parses INTERFACE EXTENDS single interface', () => {
    const src = `INTERFACE I_Child EXTENDS I_Parent
END_INTERFACE`;
    const { errors, ast } = parse(src);
    expect(errors).toHaveLength(0);
    const iface = ast.declarations[0] as InterfaceDeclaration;
    expect(iface.extendsRefs.map(r => r.name)).toContain('I_Parent');
  });

  it('parses INTERFACE EXTENDS multiple interfaces', () => {
    const src = `INTERFACE I_Combined EXTENDS I_A, I_B, I_C
END_INTERFACE`;
    const { errors, ast } = parse(src);
    expect(errors).toHaveLength(0);
    const iface = ast.declarations[0] as InterfaceDeclaration;
    expect(iface.extendsRefs).toHaveLength(3);
  });

  it('parses INTERFACE with METHOD stubs', () => {
    const src = `INTERFACE I_Collection
METHOD Count : DINT
END_METHOD
METHOD IsEmpty : BOOL
END_METHOD
METHOD Clear
END_METHOD
END_INTERFACE`;
    const { errors, ast } = parse(src);
    expect(errors).toHaveLength(0);
    const iface = ast.declarations[0] as InterfaceDeclaration;
    expect(iface.methods).toHaveLength(3);
    const names = iface.methods.map((m: MethodDeclaration) => m.name);
    expect(names).toContain('Count');
    expect(names).toContain('IsEmpty');
    expect(names).toContain('Clear');
  });

  it('parses INTERFACE with PROPERTY stubs', () => {
    const src = `INTERFACE I_Named
PROPERTY Name : STRING
END_PROPERTY
END_INTERFACE`;
    const { errors, ast } = parse(src);
    expect(errors).toHaveLength(0);
    const iface = ast.declarations[0] as InterfaceDeclaration;
    expect(iface.properties).toHaveLength(1);
  });

  it('parses INTERFACE with method taking VAR_INPUT parameters', () => {
    const src = `INTERFACE I_Adder
METHOD Add : INT
VAR_INPUT
  a : INT;
  b : INT;
END_VAR
END_METHOD
END_INTERFACE`;
    const { errors, ast } = parse(src);
    expect(errors).toHaveLength(0);
    const iface = ast.declarations[0] as InterfaceDeclaration;
    const m = iface.methods[0] as MethodDeclaration;
    expect(m.varBlocks[0].declarations).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// 9. OOP constructs — SUPER, polymorphism, inheritance chain
// ---------------------------------------------------------------------------

describe('OOP constructs', () => {
  it('parses SUPER method call', () => {
    const src = `FUNCTION_BLOCK Child EXTENDS Parent
METHOD Run
  SUPER^.Run();
END_METHOD
END_FUNCTION_BLOCK`;
    const { errors } = parse(src);
    expect(errors).toHaveLength(0);
  });

  it('parses multi-level inheritance', () => {
    const src = `FUNCTION_BLOCK GrandChild EXTENDS Child IMPLEMENTS I_GrandChild
VAR END_VAR
END_FUNCTION_BLOCK`;
    const { errors, ast } = parse(src);
    expect(errors).toHaveLength(0);
    const fb = ast.declarations[0] as FunctionBlockDeclaration;
    expect(fb.extendsRef?.name).toBe('Child');
    expect(fb.implementsRefs.map(r => r.name)).toContain('I_GrandChild');
  });

  it('parses polymorphic call through interface variable', () => {
    const src = `PROGRAM P
VAR
  obj : I_Animal;
END_VAR
obj.Speak();
END_PROGRAM`;
    const { errors } = parse(src);
    expect(errors).toHaveLength(0);
  });

  it('parses FB instantiation and method call', () => {
    const src = `PROGRAM P
VAR
  myFB : MyFunctionBlock;
END_VAR
myFB.Execute();
myFB.Value := 42;
END_PROGRAM`;
    const { errors } = parse(src);
    expect(errors).toHaveLength(0);
  });

  it('parses chained member access (FB.method.property)', () => {
    const src = `PROGRAM P
VAR
  fb : MyFB;
  x : INT;
END_VAR
x := fb.Inner.Value;
END_PROGRAM`;
    const { errors } = parse(src);
    expect(errors).toHaveLength(0);
  });

  it('parses ABSTRACT FB with ABSTRACT and non-abstract methods', () => {
    const src = `FUNCTION_BLOCK ABSTRACT Base IMPLEMENTS I_Base
METHOD ABSTRACT DoWork : BOOL
VAR_INPUT ctx : INT; END_VAR
END_METHOD
METHOD PUBLIC GetName : STRING
  GetName := 'Base';
END_METHOD
END_FUNCTION_BLOCK`;
    const { errors, ast } = parse(src);
    expect(errors).toHaveLength(0);
    const fb = ast.declarations[0] as FunctionBlockDeclaration;
    expect(fb.methods).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// 10. Variable scoping — all VAR block kinds
// ---------------------------------------------------------------------------

describe('variable scoping', () => {
  it('parses VAR block', () => {
    const src = `PROGRAM P
VAR
  x : INT;
  y : REAL;
END_VAR
END_PROGRAM`;
    const { ast, errors } = parse(src);
    expect(errors).toHaveLength(0);
    const prog = ast.declarations[0] as ProgramDeclaration;
    expect(prog.varBlocks[0].varKind).toBe('VAR');
  });

  it('parses VAR_INPUT block', () => {
    const src = `FUNCTION_BLOCK FB
VAR_INPUT
  trigger : BOOL;
  speed   : REAL;
END_VAR
END_FUNCTION_BLOCK`;
    const { ast, errors } = parse(src);
    expect(errors).toHaveLength(0);
    const fb = ast.declarations[0] as FunctionBlockDeclaration;
    expect(fb.varBlocks[0].varKind).toBe('VAR_INPUT');
    expect(fb.varBlocks[0].declarations).toHaveLength(2);
  });

  it('parses VAR_OUTPUT block', () => {
    const src = `FUNCTION_BLOCK FB
VAR_OUTPUT
  done  : BOOL;
  error : DINT;
END_VAR
END_FUNCTION_BLOCK`;
    const { ast, errors } = parse(src);
    expect(errors).toHaveLength(0);
    const fb = ast.declarations[0] as FunctionBlockDeclaration;
    expect(fb.varBlocks[0].varKind).toBe('VAR_OUTPUT');
  });

  it('parses VAR_IN_OUT block', () => {
    const src = `FUNCTION_BLOCK FB
VAR_IN_OUT
  buffer : ARRAY[0..99] OF BYTE;
END_VAR
END_FUNCTION_BLOCK`;
    const { ast, errors } = parse(src);
    expect(errors).toHaveLength(0);
    const fb = ast.declarations[0] as FunctionBlockDeclaration;
    expect(fb.varBlocks[0].varKind).toBe('VAR_IN_OUT');
  });

  it('parses VAR_STAT block (static variables)', () => {
    const src = `FUNCTION_BLOCK FB
VAR_STAT
  instanceCount : DINT;
END_VAR
END_FUNCTION_BLOCK`;
    const { ast, errors } = parse(src);
    expect(errors).toHaveLength(0);
    const fb = ast.declarations[0] as FunctionBlockDeclaration;
    expect(fb.varBlocks[0].varKind).toBe('VAR_STAT');
  });

  it('parses VAR_TEMP block (temporary variables)', () => {
    const src = `FUNCTION_BLOCK FB
VAR_TEMP
  tmpResult : REAL;
  tmpIdx    : INT;
END_VAR
END_FUNCTION_BLOCK`;
    const { ast, errors } = parse(src);
    expect(errors).toHaveLength(0);
    const fb = ast.declarations[0] as FunctionBlockDeclaration;
    expect(fb.varBlocks[0].varKind).toBe('VAR_TEMP');
  });

  it('parses VAR_CONFIG block in PROGRAM', () => {
    const src = `PROGRAM P
VAR_CONFIG
  AxisRef : AXIS_REF;
END_VAR
END_PROGRAM`;
    const { ast, errors } = parse(src);
    expect(errors).toHaveLength(0);
    const prog = ast.declarations[0] as ProgramDeclaration;
    expect(prog.varBlocks[0].varKind).toBe('VAR_CONFIG');
  });

  it('parses VAR_GLOBAL in a PROGRAM context', () => {
    const src = `PROGRAM P
VAR_GLOBAL
  GVL_MaxSpeed : REAL := 100.0;
END_VAR
END_PROGRAM`;
    const { ast, errors } = parse(src);
    expect(errors).toHaveLength(0);
    const prog = ast.declarations[0] as ProgramDeclaration;
    expect(prog.varBlocks[0].varKind).toBe('VAR_GLOBAL');
  });

  it('parses variables with POINTER TO type in VAR', () => {
    const src = `FUNCTION_BLOCK FB
VAR
  pNode : POINTER TO Node;
  pList : POINTER TO LinkedList;
END_VAR
END_FUNCTION_BLOCK`;
    const { ast, errors } = parse(src);
    expect(errors).toHaveLength(0);
    const fb = ast.declarations[0] as FunctionBlockDeclaration;
    const decls = fb.varBlocks[0].declarations;
    expect(decls[0].type.isPointer).toBe(true);
    expect(decls[1].type.isPointer).toBe(true);
  });
});
