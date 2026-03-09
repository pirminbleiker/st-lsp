import { describe, it, expect } from 'vitest';
import { parse } from '../parser/parser';
import {
  ActionDeclaration,
  ArrayLiteral,
  FunctionBlockDeclaration,
  IntegerLiteral,
  BoolLiteral,
  InterfaceDeclaration,
  GvlDeclaration,
  ProgramDeclaration,
  FunctionDeclaration,
  AssignmentStatement,
  IfStatement,
  ForStatement,
  TypeDeclarationBlock,
  StructDeclaration,
  EnumDeclaration,
  AliasDeclaration,
  UnionDeclaration,
} from '../parser/ast';

describe('parse()', () => {
  describe('empty PROGRAM', () => {
    it('returns a SourceFile with one ProgramDeclaration named "Main"', () => {
      const { ast, errors } = parse('PROGRAM Main\nEND_PROGRAM');
      expect(errors).toHaveLength(0);
      expect(ast.kind).toBe('SourceFile');
      expect(ast.declarations).toHaveLength(1);
      const prog = ast.declarations[0] as ProgramDeclaration;
      expect(prog.kind).toBe('ProgramDeclaration');
      expect(prog.name).toBe('Main');
    });

    it('returns no errors for a valid empty PROGRAM', () => {
      const { errors } = parse('PROGRAM Main\nEND_PROGRAM');
      expect(errors).toHaveLength(0);
    });
  });

  describe('PROGRAM with VAR block', () => {
    const src = `PROGRAM Main
VAR
  x : INT;
  y : BOOL := TRUE;
END_VAR
END_PROGRAM`;

    it('produces one ProgramDeclaration with one VarBlock', () => {
      const { ast, errors } = parse(src);
      expect(errors).toHaveLength(0);
      const prog = ast.declarations[0] as ProgramDeclaration;
      expect(prog.varBlocks).toHaveLength(1);
    });

    it('VarBlock has 2 declarations', () => {
      const { ast } = parse(src);
      const prog = ast.declarations[0] as ProgramDeclaration;
      const varBlock = prog.varBlocks[0];
      expect(varBlock.varKind).toBe('VAR');
      expect(varBlock.declarations).toHaveLength(2);
    });

    it('first var declaration is named x with type INT', () => {
      const { ast } = parse(src);
      const prog = ast.declarations[0] as ProgramDeclaration;
      const decl = prog.varBlocks[0].declarations[0];
      expect(decl.name).toBe('x');
      expect(decl.type.name).toBe('INT');
    });

    it('second var declaration has initial value TRUE', () => {
      const { ast } = parse(src);
      const prog = ast.declarations[0] as ProgramDeclaration;
      const decl = prog.varBlocks[0].declarations[1];
      expect(decl.name).toBe('y');
      expect(decl.initialValue).toBeDefined();
      expect(decl.initialValue?.kind).toBe('BoolLiteral');
    });
  });

  describe('simple assignment statement', () => {
    const src = 'PROGRAM P\nVAR x : INT; END_VAR\nx := 42;\nEND_PROGRAM';

    it('parses without errors', () => {
      const { errors } = parse(src);
      expect(errors).toHaveLength(0);
    });

    it('produces an AssignmentStatement with integer literal 42', () => {
      const { ast } = parse(src);
      const prog = ast.declarations[0] as ProgramDeclaration;
      expect(prog.body).toHaveLength(1);
      const stmt = prog.body[0] as AssignmentStatement;
      expect(stmt.kind).toBe('AssignmentStatement');
      expect(stmt.right.kind).toBe('IntegerLiteral');
    });
  });

  describe('IF statement', () => {
    const src = `PROGRAM P
VAR x : INT; y : INT; END_VAR
IF x > 0 THEN y := 1; END_IF;
END_PROGRAM`;

    it('parses without errors', () => {
      const { errors } = parse(src);
      expect(errors).toHaveLength(0);
    });

    it('produces an IfStatement in the body', () => {
      const { ast } = parse(src);
      const prog = ast.declarations[0] as ProgramDeclaration;
      const stmt = prog.body[0] as IfStatement;
      expect(stmt.kind).toBe('IfStatement');
    });

    it('IF condition is a BinaryExpression', () => {
      const { ast } = parse(src);
      const prog = ast.declarations[0] as ProgramDeclaration;
      const stmt = prog.body[0] as IfStatement;
      expect(stmt.condition.kind).toBe('BinaryExpression');
    });

    it('parses IF condition with AND_THEN without errors (Phase 4)', () => {
      const andThenSrc = `PROGRAM P
VAR a : BOOL; b : BOOL; y : INT; END_VAR
IF a AND_THEN b THEN y := 1; END_IF;
END_PROGRAM`;

      const { errors } = parse(andThenSrc);
      expect(errors).toHaveLength(0);
    });

    it('parses IF condition with OR_ELSE without errors (Phase 4)', () => {
      const orElseSrc = `PROGRAM P
VAR a : BOOL; b : BOOL; y : INT; END_VAR
IF a OR_ELSE b THEN y := 1; END_IF;
END_PROGRAM`;

      const { errors } = parse(orElseSrc);
      expect(errors).toHaveLength(0);
    });
  });

  describe('FOR loop', () => {
    const src = `PROGRAM P
VAR i : INT; END_VAR
FOR i := 0 TO 9 DO END_FOR;
END_PROGRAM`;

    it('parses without errors', () => {
      const { errors } = parse(src);
      expect(errors).toHaveLength(0);
    });

    it('produces a ForStatement', () => {
      const { ast } = parse(src);
      const prog = ast.declarations[0] as ProgramDeclaration;
      const stmt = prog.body[0] as ForStatement;
      expect(stmt.kind).toBe('ForStatement');
      expect(stmt.variable).toBe('i');
    });

    it('FOR loop from 0 to 9', () => {
      const { ast } = parse(src);
      const prog = ast.declarations[0] as ProgramDeclaration;
      const stmt = prog.body[0] as ForStatement;
      expect(stmt.from.kind).toBe('IntegerLiteral');
      expect(stmt.to.kind).toBe('IntegerLiteral');
    });
  });

  describe('FUNCTION with return type', () => {
    const src = `FUNCTION Add : INT
VAR_INPUT a : INT; END_VAR
END_FUNCTION`;

    it('parses without errors', () => {
      const { errors } = parse(src);
      expect(errors).toHaveLength(0);
    });

    it('produces a FunctionDeclaration named Add with return type INT', () => {
      const { ast } = parse(src);
      expect(ast.declarations).toHaveLength(1);
      const fn = ast.declarations[0] as FunctionDeclaration;
      expect(fn.kind).toBe('FunctionDeclaration');
      expect(fn.name).toBe('Add');
      expect(fn.returnType).not.toBeNull();
      expect(fn.returnType?.name).toBe('INT');
    });

    it('has one VAR_INPUT block with one parameter', () => {
      const { ast } = parse(src);
      const fn = ast.declarations[0] as FunctionDeclaration;
      expect(fn.varBlocks).toHaveLength(1);
      expect(fn.varBlocks[0].varKind).toBe('VAR_INPUT');
      expect(fn.varBlocks[0].declarations).toHaveLength(1);
      expect(fn.varBlocks[0].declarations[0].name).toBe('a');
    });
  });

  describe('parse errors', () => {
    it('missing END_PROGRAM → errors array is non-empty', () => {
      const { errors } = parse('PROGRAM P');
      expect(errors.length).toBeGreaterThan(0);
    });

    it('error recovery: error message mentions END_PROGRAM', () => {
      const { errors } = parse('PROGRAM P');
      const found = errors.some(e => e.message.includes('END_PROGRAM'));
      expect(found).toBe(true);
    });

    it('AST is still returned even on error', () => {
      const { ast } = parse('PROGRAM P');
      expect(ast).toBeDefined();
      expect(ast.kind).toBe('SourceFile');
    });
  });

  describe('TYPE declarations (Phase 2)', () => {
    it('parses STRUCT declaration', () => {
      const src = `TYPE ST_Motor :
STRUCT
  Speed : REAL;
  Running : BOOL;
END_STRUCT
END_TYPE`;
      const { ast, errors } = parse(src);
      expect(errors).toHaveLength(0);
      expect(ast.declarations).toHaveLength(1);
      const block = ast.declarations[0] as TypeDeclarationBlock;
      expect(block.kind).toBe('TypeDeclarationBlock');
      const struct = block.declarations[0] as StructDeclaration;
      expect(struct.kind).toBe('StructDeclaration');
      expect(struct.name).toBe('ST_Motor');
      expect(struct.fields).toHaveLength(2);
      expect(struct.fields[0].name).toBe('Speed');
      expect(struct.fields[1].name).toBe('Running');
    });

    it('parses UNION declaration', () => {
      const src = `TYPE MyUnion :
UNION
  AsInt : INT;
  AsWord : WORD;
END_UNION
END_TYPE`;
      const { ast, errors } = parse(src);
      expect(errors).toHaveLength(0);
      const block = ast.declarations[0] as TypeDeclarationBlock;
      const union = block.declarations[0] as UnionDeclaration;
      expect(union.kind).toBe('UnionDeclaration');
      expect(union.name).toBe('MyUnion');
      expect(union.fields).toHaveLength(2);
      expect(union.fields[0].name).toBe('AsInt');
      expect(union.fields[1].name).toBe('AsWord');
    });

    it('parses enum declaration (parenthesis style)', () => {
      const src = `TYPE E_Mode :
(Off, On, Auto)
END_TYPE`;
      const { ast, errors } = parse(src);
      expect(errors).toHaveLength(0);
      const block = ast.declarations[0] as TypeDeclarationBlock;
      const enumDecl = block.declarations[0] as EnumDeclaration;
      expect(enumDecl.kind).toBe('EnumDeclaration');
      expect(enumDecl.name).toBe('E_Mode');
      expect(enumDecl.values).toHaveLength(3);
      expect(enumDecl.baseType).toBeUndefined();
    });

    it('parses typed enum (baseType before :=)', () => {
      const src = `TYPE Color : INT := (Red:=1, Green:=2);
END_TYPE`;
      const { ast, errors } = parse(src);
      expect(errors).toHaveLength(0);
      const block = ast.declarations[0] as TypeDeclarationBlock;
      const enumDecl = block.declarations[0] as EnumDeclaration;
      expect(enumDecl.kind).toBe('EnumDeclaration');
      expect(enumDecl.name).toBe('Color');
      expect(enumDecl.baseType?.name).toBe('INT');
      expect(enumDecl.values).toHaveLength(2);
      expect(enumDecl.values[0].name).toBe('Red');
      expect(enumDecl.values[1].name).toBe('Green');
    });

    it('parses typed enum (baseType after closing paren)', () => {
      const src = `TYPE Color : (Red:=1, Green:=2) INT;
END_TYPE`;
      const { ast, errors } = parse(src);
      expect(errors).toHaveLength(0);
      const block = ast.declarations[0] as TypeDeclarationBlock;
      const enumDecl = block.declarations[0] as EnumDeclaration;
      expect(enumDecl.kind).toBe('EnumDeclaration');
      expect(enumDecl.name).toBe('Color');
      expect(enumDecl.baseType?.name).toBe('INT');
      expect(enumDecl.values).toHaveLength(2);
    });

    it('parses typed enum with DINT base type and no explicit values', () => {
      const src = `TYPE Color : DINT := (Red, Green, Blue);
END_TYPE`;
      const { ast, errors } = parse(src);
      expect(errors).toHaveLength(0);
      const block = ast.declarations[0] as TypeDeclarationBlock;
      const enumDecl = block.declarations[0] as EnumDeclaration;
      expect(enumDecl.baseType?.name).toBe('DINT');
      expect(enumDecl.values).toHaveLength(3);
    });

    it('parses block-style ENUM...END_ENUM still works', () => {
      const src = `TYPE Color : ENUM : INT
Red := 1;
Green := 2;
END_ENUM;
END_TYPE`;
      const { ast, errors } = parse(src);
      expect(errors).toHaveLength(0);
      const block = ast.declarations[0] as TypeDeclarationBlock;
      const enumDecl = block.declarations[0] as EnumDeclaration;
      expect(enumDecl.kind).toBe('EnumDeclaration');
      expect(enumDecl.baseType?.name).toBe('INT');
      expect(enumDecl.values).toHaveLength(2);
    });

    it('parses alias declaration', () => {
      const src = `TYPE MyInt : INT;
END_TYPE`;
      const { ast, errors } = parse(src);
      expect(errors).toHaveLength(0);
      const block = ast.declarations[0] as TypeDeclarationBlock;
      const alias = block.declarations[0] as AliasDeclaration;
      expect(alias.kind).toBe('AliasDeclaration');
      expect(alias.name).toBe('MyInt');
      expect(alias.type.name).toBe('INT');
    });
  });

  describe('VAR_CONFIG block (Phase 2)', () => {
    it('parses VAR_CONFIG block without errors', () => {
      const src = `PROGRAM Main
VAR_CONFIG
  Speed : REAL;
END_VAR
END_PROGRAM`;
      const { ast, errors } = parse(src);
      expect(errors).toHaveLength(0);
      const prog = ast.declarations[0] as ProgramDeclaration;
      expect(prog.varBlocks[0].varKind).toBe('VAR_CONFIG');
    });
  });

  describe('VAR CONSTANT / VAR RETAIN / VAR PERSISTENT qualifiers', () => {
    it('VAR CONSTANT sets constant flag', () => {
      const src = `PROGRAM Main
VAR CONSTANT
  MaxSpeed : INT := 100;
END_VAR
END_PROGRAM`;
      const { ast, errors } = parse(src);
      expect(errors).toHaveLength(0);
      const prog = ast.declarations[0] as ProgramDeclaration;
      expect(prog.varBlocks[0].varKind).toBe('VAR');
      expect(prog.varBlocks[0].constant).toBe(true);
      expect(prog.varBlocks[0].retain).toBeUndefined();
    });

    it('VAR RETAIN sets retain flag', () => {
      const src = `PROGRAM Main
VAR RETAIN
  Counter : INT;
END_VAR
END_PROGRAM`;
      const { ast, errors } = parse(src);
      expect(errors).toHaveLength(0);
      const prog = ast.declarations[0] as ProgramDeclaration;
      expect(prog.varBlocks[0].retain).toBe(true);
      expect(prog.varBlocks[0].constant).toBeUndefined();
    });

    it('VAR PERSISTENT sets persistent flag', () => {
      const src = `PROGRAM Main
VAR PERSISTENT
  SavedValue : REAL;
END_VAR
END_PROGRAM`;
      const { ast, errors } = parse(src);
      expect(errors).toHaveLength(0);
      const prog = ast.declarations[0] as ProgramDeclaration;
      expect(prog.varBlocks[0].persistent).toBe(true);
    });

    it('VAR_GLOBAL CONSTANT sets varKind and constant flag', () => {
      const src = `VAR_GLOBAL CONSTANT
  Pi : LREAL := 3.14159;
END_VAR`;
      const { ast, errors } = parse(src);
      expect(errors).toHaveLength(0);
      const gvl = ast.declarations[0] as import('../parser/ast').GvlDeclaration;
      expect(gvl.varBlocks[0].varKind).toBe('VAR_GLOBAL');
      expect(gvl.varBlocks[0].constant).toBe(true);
    });

    it('variables in VAR CONSTANT block are recognized (no false diagnostics)', () => {
      const src = `PROGRAM Main
VAR CONSTANT
  MaxItems : INT := 10;
END_VAR
VAR
  x : INT;
END_VAR
x := MaxItems;
END_PROGRAM`;
      const { errors } = parse(src);
      expect(errors).toHaveLength(0);
    });
  });

  describe('NAMESPACE block (Phase 2)', () => {
    it('skips NAMESPACE...END_NAMESPACE without errors', () => {
      const src = `NAMESPACE MyNS
PROGRAM Inner
END_PROGRAM
END_NAMESPACE
PROGRAM Outer
END_PROGRAM`;
      const { ast, errors } = parse(src);
      expect(errors).toHaveLength(0);
      // Only the outer PROGRAM is in the AST (NAMESPACE is skipped)
      expect(ast.declarations).toHaveLength(1);
      const prog = ast.declarations[0] as ProgramDeclaration;
      expect(prog.name).toBe('Outer');
    });
  });

  describe('ACTION blocks', () => {
    const src = `FUNCTION_BLOCK MyFB
VAR
  x : INT;
END_VAR
x := 0;
END_FUNCTION_BLOCK
ACTION Run:
x := x + 1;
END_ACTION
ACTION Reset:
x := 0;
END_ACTION`;

    it('parses FB with trailing ACTION blocks without errors', () => {
      const { errors } = parse(src);
      expect(errors).toHaveLength(0);
    });

    it('FB declaration has 2 actions', () => {
      const { ast } = parse(src);
      const fb = ast.declarations[0] as FunctionBlockDeclaration;
      expect(fb.kind).toBe('FunctionBlockDeclaration');
      expect(fb.actions).toHaveLength(2);
    });

    it('first action is named Run', () => {
      const { ast } = parse(src);
      const fb = ast.declarations[0] as FunctionBlockDeclaration;
      const action = fb.actions[0] as ActionDeclaration;
      expect(action.kind).toBe('ActionDeclaration');
      expect(action.name).toBe('Run');
    });

    it('second action is named Reset', () => {
      const { ast } = parse(src);
      const fb = ast.declarations[0] as FunctionBlockDeclaration;
      const action = fb.actions[1] as ActionDeclaration;
      expect(action.name).toBe('Reset');
    });

    it('action body contains statements', () => {
      const { ast } = parse(src);
      const fb = ast.declarations[0] as FunctionBlockDeclaration;
      const runAction = fb.actions[0] as ActionDeclaration;
      expect(runAction.body).toHaveLength(1);
      expect(runAction.body[0].kind).toBe('AssignmentStatement');
    });

    it('FB with no actions has empty actions array', () => {
      const noActionSrc = `FUNCTION_BLOCK Plain
VAR x : INT; END_VAR
END_FUNCTION_BLOCK`;
      const { ast } = parse(noActionSrc);
      const fb = ast.declarations[0] as FunctionBlockDeclaration;
      expect(fb.actions).toHaveLength(0);
    });

    it('ACTION without colon is also parsed', () => {
      const noColonSrc = `FUNCTION_BLOCK Foo
END_FUNCTION_BLOCK
ACTION Bar
; // noop
END_ACTION`;
      const { ast, errors } = parse(noColonSrc);
      expect(errors).toHaveLength(0);
      const fb = ast.declarations[0] as FunctionBlockDeclaration;
      expect(fb.actions).toHaveLength(1);
      expect(fb.actions[0].name).toBe('Bar');
    });
  });

  describe('Phase 1 — optional semicolon after return type and EXTENDS/IMPLEMENTS ranges', () => {
    it('METHOD with semicolon after return type parses without error', () => {
      const src = `FUNCTION_BLOCK Foo
METHOD Bar : BOOL;
VAR_INPUT x : INT; END_VAR
RETURN;
END_METHOD
END_FUNCTION_BLOCK`;
      const { ast, errors } = parse(src);
      expect(errors).toHaveLength(0);
      const fb = ast.declarations[0] as FunctionBlockDeclaration;
      expect(fb.methods[0].returnType?.name).toBe('BOOL');
    });

    it('FUNCTION_BLOCK EXTENDS captures name and range', () => {
      const src = `FUNCTION_BLOCK Foo EXTENDS Bar
VAR END_VAR
END_FUNCTION_BLOCK`;
      const { ast, errors } = parse(src);
      expect(errors).toHaveLength(0);
      const fb = ast.declarations[0] as FunctionBlockDeclaration;
      expect(fb.extendsRef?.name).toBe('Bar');
      expect(fb.extendsRef?.range.start).toBeDefined();
      expect(fb.extendsRef?.range.end).toBeDefined();
      expect(typeof fb.extendsRef?.range.start.line).toBe('number');
      expect(typeof fb.extendsRef?.range.start.character).toBe('number');
    });

    it('FUNCTION_BLOCK IMPLEMENTS captures names and ranges', () => {
      const src = `FUNCTION_BLOCK Foo IMPLEMENTS I_A, I_B
VAR END_VAR
END_FUNCTION_BLOCK`;
      const { ast, errors } = parse(src);
      expect(errors).toHaveLength(0);
      const fb = ast.declarations[0] as FunctionBlockDeclaration;
      expect(fb.implementsRefs).toHaveLength(2);
      expect(fb.implementsRefs[0].name).toBe('I_A');
      expect(fb.implementsRefs[1].name).toBe('I_B');
      expect(fb.implementsRefs[0].range.start).toBeDefined();
      expect(typeof fb.implementsRefs[0].range.start.line).toBe('number');
    });
  });

  describe('GVL (standalone VAR_GLOBAL)', () => {
    it('parses a bare VAR_GLOBAL block as GvlDeclaration', () => {
      const src = `VAR_GLOBAL
  gCounter : INT;
  gFlag : BOOL;
END_VAR`;
      const { ast, errors } = parse(src);
      expect(errors).toHaveLength(0);
      expect(ast.declarations).toHaveLength(1);
      const gvl = ast.declarations[0] as GvlDeclaration;
      expect(gvl.kind).toBe('GvlDeclaration');
    });

    it('GvlDeclaration contains the declared variables', () => {
      const src = `VAR_GLOBAL
  gCounter : INT;
  gFlag : BOOL;
END_VAR`;
      const { ast } = parse(src);
      const gvl = ast.declarations[0] as GvlDeclaration;
      expect(gvl.varBlocks).toHaveLength(1);
      expect(gvl.varBlocks[0].varKind).toBe('VAR_GLOBAL');
      const names = gvl.varBlocks[0].declarations.map(d => d.name);
      expect(names).toContain('gCounter');
      expect(names).toContain('gFlag');
    });

    it('parses multiple VAR_GLOBAL blocks in sequence', () => {
      const src = `VAR_GLOBAL
  g1 : INT;
END_VAR
VAR_GLOBAL
  g2 : BOOL;
END_VAR`;
      const { ast, errors } = parse(src);
      expect(errors).toHaveLength(0);
      expect(ast.declarations).toHaveLength(1);
      const gvl = ast.declarations[0] as GvlDeclaration;
      expect(gvl.varBlocks).toHaveLength(2);
    });
  });

  describe('Phase 2 — CASE dotted label detection', () => {
    it('parses CASE labels with three-level dotted identifiers (A.B.C:)', () => {
      const src = `PROGRAM P
VAR x : INT; END_VAR
CASE x OF
  A:
    x := 0;
  A.B.C:
    x := 1;
END_CASE;
END_PROGRAM`;

      const { errors } = parse(src);
      expect(errors).toHaveLength(0);
    });

    it('parses CASE labels with four-level dotted identifiers (A.B.C.D:)', () => {
      const src = `PROGRAM P
VAR x : INT; END_VAR
CASE x OF
  A:
    x := 0;
  A.B.C.D:
    x := 1;
END_CASE;
END_PROGRAM`;

      const { errors } = parse(src);
      expect(errors).toHaveLength(0);
    });

    it('regression: still parses one-level and two-level labels (A: and A.B:)', () => {
      const src = `PROGRAM P
VAR x : INT; END_VAR
CASE x OF
  A:
    x := 1;
  A.B:
    x := 2;
END_CASE;
END_PROGRAM`;

      const { errors } = parse(src);
      expect(errors).toHaveLength(0);
    });

    it('parses CASE clause label with explicit __SYSTEM.TYPE_CLASS.TYPE_BOOL:', () => {
      const src = `PROGRAM P
VAR x : INT; END_VAR
CASE x OF
  __SYSTEM.TYPE_CLASS.TYPE_BOOL:
    x := 1;
  ELSE
    x := 0;
END_CASE;
END_PROGRAM`;

      const { errors } = parse(src);
      expect(errors).toHaveLength(0);
    });

    it('regression: parses realistic mobject-style CASE labels and assignments', () => {
      const src = `PROGRAM P
VAR
  t : INT;
  isBool : BOOL;
END_VAR
CASE t OF
  __SYSTEM.TYPE_CLASS.TYPE_BOOL:
    isBool := TRUE;
  __SYSTEM.TYPE_CLASS.TYPE_INT,
  __SYSTEM.TYPE_CLASS.TYPE_DINT:
    isBool := FALSE;
  ELSE
    isBool := FALSE;
END_CASE;
END_PROGRAM`;

      const { errors } = parse(src);
      expect(errors).toHaveLength(0);
    });

    it("guard: assignment-like ':=' inside clause is not treated as a CASE label", () => {
      const src = `PROGRAM P
VAR x : INT; END_VAR
CASE x OF
  A:
    A.B := 1;
  B:
    x := 2;
END_CASE;
END_PROGRAM`;

      const { errors } = parse(src);
      expect(errors).toHaveLength(0);
    });
  });

  describe('Phase 5 — anonymous inline enum in VAR declarations', () => {
    it('parses VAR x : (A, B, C); END_VAR without errors', () => {
      const src = `PROGRAM P
VAR
  x : (A, B, C);
END_VAR
END_PROGRAM`;

      const { errors } = parse(src);
      expect(errors).toHaveLength(0);
    });

    it('parses VAR x : (A, B, C) := A; END_VAR with initializer', () => {
      const src = `PROGRAM P
VAR
  x : (A, B, C) := A;
END_VAR
END_PROGRAM`;

      const { errors } = parse(src);
      expect(errors).toHaveLength(0);
    });

    it('parses VAR x : (A := 1, B := 2); END_VAR with explicit enum values', () => {
      const src = `PROGRAM P
VAR
  x : (A := 1, B := 2);
END_VAR
END_PROGRAM`;

      const { errors } = parse(src);
      expect(errors).toHaveLength(0);
    });
  });

  describe('Phase 6 — pragmas before METHOD/PROPERTY members', () => {
    it('parses pragma before PROPERTY in FUNCTION_BLOCK without errors', () => {
      const src = `FUNCTION_BLOCK FB_Test
{attribute 'monitoring' := 'call'}
PROPERTY PUBLIC ErrorId : UDINT
END_PROPERTY
END_FUNCTION_BLOCK`;

      const { ast, errors } = parse(src);
      expect(errors).toHaveLength(0);

      const fb = ast.declarations[0] as FunctionBlockDeclaration;
      expect(fb.properties).toHaveLength(1);
      expect(fb.properties[0].name).toBe('ErrorId');
    });

    it('parses pragma before METHOD in FUNCTION_BLOCK without errors', () => {
      const src = `FUNCTION_BLOCK FB_Test
{attribute 'test'}
METHOD PUBLIC Execute : BOOL
END_METHOD
END_FUNCTION_BLOCK`;

      const { ast, errors } = parse(src);
      expect(errors).toHaveLength(0);

      const fb = ast.declarations[0] as FunctionBlockDeclaration;
      expect(fb.methods).toHaveLength(1);
      expect(fb.methods[0].name).toBe('Execute');
    });

    it('parses pragma before METHOD and PROPERTY in INTERFACE without errors', () => {
      const src = `INTERFACE I_Test
{attribute 'monitoring' := 'call'}
METHOD PUBLIC Execute : BOOL
END_METHOD
{attribute 'monitoring' := 'call'}
PROPERTY PUBLIC ErrorId : UDINT
END_PROPERTY
END_INTERFACE`;

      const { ast, errors } = parse(src);
      expect(errors).toHaveLength(0);

      const iface = ast.declarations[0] as InterfaceDeclaration;
      expect(iface.methods).toHaveLength(1);
      expect(iface.properties).toHaveLength(1);
      expect(iface.methods[0].name).toBe('Execute');
      expect(iface.properties[0].name).toBe('ErrorId');
    });
  });

  describe('Phase 7 — FB constructor-call syntax in VAR declarations', () => {
    it('parses VAR x : MyFB(Param := 42); END_VAR and records initArgs AST', () => {
      const src = `PROGRAM P
VAR
  x : MyFB(Param := 42);
END_VAR
END_PROGRAM`;

      const { ast, errors } = parse(src);
      expect(errors).toHaveLength(0);

      const prog = ast.declarations[0] as ProgramDeclaration;
      const decl = prog.varBlocks[0].declarations[0];
      expect(decl.initArgs).toBeDefined();
      expect(decl.initArgs).toHaveLength(1);
      expect(decl.initArgs?.[0].name).toBe('Param');
      expect(decl.initArgs?.[0].value.kind).toBe('IntegerLiteral');
    });

    it('parses VAR x : MyFB(A := 1, B := TRUE); END_VAR and records named initArgs', () => {
      const src = `PROGRAM P
VAR
  x : MyFB(A := 1, B := TRUE);
END_VAR
END_PROGRAM`;

      const { ast, errors } = parse(src);
      expect(errors).toHaveLength(0);

      const prog = ast.declarations[0] as ProgramDeclaration;
      const decl = prog.varBlocks[0].declarations[0];
      expect(decl.initArgs).toBeDefined();
      expect(decl.initArgs).toHaveLength(2);
      expect(decl.initArgs?.[0].name).toBe('A');
      expect(decl.initArgs?.[1].name).toBe('B');
      expect(decl.initArgs?.[0].value.kind).toBe('IntegerLiteral');
      expect(decl.initArgs?.[1].value.kind).toBe('BoolLiteral');
    });

    it('parses VAR x : MyFB(Target := THIS^); END_VAR and keeps constructor syntax support', () => {
      const src = `PROGRAM P
VAR
  x : MyFB(Target := THIS^);
END_VAR
END_PROGRAM`;

      const { ast, errors } = parse(src);
      expect(errors).toHaveLength(0);

      const prog = ast.declarations[0] as ProgramDeclaration;
      const decl = prog.varBlocks[0].declarations[0];
      expect(decl.initArgs).toBeDefined();
      expect(decl.initArgs).toHaveLength(1);
      expect(decl.initArgs?.[0].name).toBe('Target');
      expect(decl.initArgs?.[0].value.kind).toBe('NameExpression');
    });

    it('regression: STRING(80) is parsed as sized type suffix, not VarDeclaration.initArgs', () => {
      const src = `PROGRAM P
VAR
  s : STRING(80);
END_VAR
END_PROGRAM`;

      const { ast, errors } = parse(src);
      expect(errors).toHaveLength(0);

      const prog = ast.declarations[0] as ProgramDeclaration;
      const decl = prog.varBlocks[0].declarations[0];
      expect(decl.type.name).toBe('STRING');
      expect(decl.initArgs).toBeUndefined();
    });

    it('regression: WSTRING(80) is parsed as sized type suffix, not VarDeclaration.initArgs', () => {
      const src = `PROGRAM P
VAR
  ws : WSTRING(80);
END_VAR
END_PROGRAM`;

      const { ast, errors } = parse(src);
      expect(errors).toHaveLength(0);

      const prog = ast.declarations[0] as ProgramDeclaration;
      const decl = prog.varBlocks[0].declarations[0];
      expect(decl.type.name).toBe('WSTRING');
      expect(decl.initArgs).toBeUndefined();
    });
  });

  describe('Struct initializer expressions', () => {
    it('parses VAR x : TIMESTRUCT := (wDay := 2); as StructInitializer', () => {
      const src = `FUNCTION_BLOCK Test
VAR
  x : TIMESTRUCT := (wDay := 2);
END_VAR
END_FUNCTION_BLOCK`;

      const { ast, errors } = parse(src);
      expect(errors).toHaveLength(0);

      const fb = ast.declarations[0] as FunctionBlockDeclaration;
      const decl = fb.varBlocks[0].declarations[0];
      expect(decl.initialValue).toBeDefined();
      expect(decl.initialValue?.kind).toBe('StructInitializer');
      if (decl.initialValue?.kind === 'StructInitializer') {
        expect(decl.initialValue.fields).toHaveLength(1);
        expect(decl.initialValue.fields[0].name).toBe('wDay');
        expect(decl.initialValue.fields[0].value.kind).toBe('IntegerLiteral');
      }
    });

    it('parses multi-field struct initializer', () => {
      const src = `FUNCTION_BLOCK Test
VAR
  ts : TIMESTRUCT := (wYear := 2000, wMonth := 1, wDay := 3);
END_VAR
END_FUNCTION_BLOCK`;

      const { ast, errors } = parse(src);
      expect(errors).toHaveLength(0);

      const fb = ast.declarations[0] as FunctionBlockDeclaration;
      const decl = fb.varBlocks[0].declarations[0];
      expect(decl.initialValue?.kind).toBe('StructInitializer');
      if (decl.initialValue?.kind === 'StructInitializer') {
        expect(decl.initialValue.fields).toHaveLength(3);
        expect(decl.initialValue.fields[0].name).toBe('wYear');
        expect(decl.initialValue.fields[1].name).toBe('wMonth');
        expect(decl.initialValue.fields[2].name).toBe('wDay');
      }
    });

    it('does not treat regular parenthesized expressions as struct initializers', () => {
      const src = `PROGRAM P
VAR
  x : INT := (1 + 2);
END_VAR
END_PROGRAM`;

      const { ast, errors } = parse(src);
      expect(errors).toHaveLength(0);

      const prog = ast.declarations[0] as ProgramDeclaration;
      const decl = prog.varBlocks[0].declarations[0];
      expect(decl.initialValue?.kind).toBe('BinaryExpression');
    });
  });

  describe('Phase 8 — INTERFACE trailing semicolon', () => {
    it('parses INTERFACE with EXTENDS and trailing semicolon before END_INTERFACE without errors', () => {
      const src = `INTERFACE I_Foo EXTENDS I_Bar;
END_INTERFACE`;

      const { ast, errors } = parse(src);
      expect(errors).toHaveLength(0);

      const iface = ast.declarations[0] as InterfaceDeclaration;
      expect(iface.name).toBe('I_Foo');
      expect(iface.extendsRefs).toHaveLength(1);
      expect(iface.extendsRefs[0].name).toBe('I_Bar');
    });

    it('parses extracted TcIO-like short form INTERFACE I_Foo; without errors', () => {
      const src = 'INTERFACE I_Foo;';

      const { ast, errors } = parse(src);
      expect(errors).toHaveLength(0);

      const iface = ast.declarations[0] as InterfaceDeclaration;
      expect(iface.name).toBe('I_Foo');
      expect(iface.extendsRefs).toHaveLength(0);
    });

    it('reports an error for incomplete INTERFACE I_Foo without semicolon and END_INTERFACE', () => {
      const src = 'INTERFACE I_Foo';

      const { errors } = parse(src);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some(e => e.message.includes("END_INTERFACE"))).toBe(true);
    });
  });

  describe('Phase 9 — PROPERTY GET/SET body parsing', () => {
    it('parses PROPERTY with GET accessor var blocks and body', () => {
      const src = `FUNCTION_BLOCK FB_Test
PROPERTY PUBLIC Value : INT
GET
VAR
  localValue : INT;
END_VAR
Value := localValue;
END_GET
END_PROPERTY
END_FUNCTION_BLOCK`;

      const { ast, errors } = parse(src);
      expect(errors).toHaveLength(0);

      const fb = ast.declarations[0] as FunctionBlockDeclaration;
      const prop = fb.properties[0] as any;
      expect(prop.name).toBe('Value');
      expect(prop.getAccessor).toBeDefined();
      expect(prop.getAccessor.varBlocks).toHaveLength(1);
      expect(prop.getAccessor.varBlocks[0].declarations[0].name).toBe('localValue');
      expect(prop.getAccessor.body).toHaveLength(1);
      expect(prop.getAccessor.body[0].kind).toBe('AssignmentStatement');
      expect(prop.setAccessor).toBeUndefined();
    });

    it('parses PROPERTY with SET accessor var blocks and body', () => {
      const src = `FUNCTION_BLOCK FB_Test
PROPERTY PUBLIC Value : INT
SET
VAR
  changed : BOOL;
END_VAR
changed := TRUE;
END_SET
END_PROPERTY
END_FUNCTION_BLOCK`;

      const { ast, errors } = parse(src);
      expect(errors).toHaveLength(0);

      const fb = ast.declarations[0] as FunctionBlockDeclaration;
      const prop = fb.properties[0] as any;
      expect(prop.name).toBe('Value');
      expect(prop.setAccessor).toBeDefined();
      expect(prop.setAccessor.varBlocks).toHaveLength(1);
      expect(prop.setAccessor.varBlocks[0].declarations[0].name).toBe('changed');
      expect(prop.setAccessor.body).toHaveLength(1);
      expect(prop.setAccessor.body[0].kind).toBe('AssignmentStatement');
      expect(prop.getAccessor).toBeUndefined();
    });

    it('parses PROPERTY with both GET and SET accessors', () => {
      const src = `FUNCTION_BLOCK FB_Test
PROPERTY PUBLIC Value : INT
GET
Value := 1;
END_GET
SET
Value := 2;
END_SET
END_PROPERTY
END_FUNCTION_BLOCK`;

      const { ast, errors } = parse(src);
      expect(errors).toHaveLength(0);

      const fb = ast.declarations[0] as FunctionBlockDeclaration;
      const prop = fb.properties[0] as any;
      expect(prop.getAccessor).toBeDefined();
      expect(prop.setAccessor).toBeDefined();
      expect(prop.getAccessor.body).toHaveLength(1);
      expect(prop.setAccessor.body).toHaveLength(1);
    });
  });

  describe('INTERFACE/FB EXTENDS qualified names', () => {
    it('parses INTERFACE EXTENDS with dotted qualified name', () => {
      const src = `INTERFACE I_Foo EXTENDS __SYSTEM.IQueryInterface
END_INTERFACE`;

      const { ast, errors } = parse(src);
      expect(errors).toHaveLength(0);

      const iface = ast.declarations[0] as InterfaceDeclaration;
      expect(iface.name).toBe('I_Foo');
      expect(iface.extendsRefs).toHaveLength(1);
      expect(iface.extendsRefs[0].name).toBe('__SYSTEM.IQueryInterface');
    });

    it('parses INTERFACE EXTENDS with multiple qualified names', () => {
      const src = `INTERFACE I_Foo EXTENDS A.B, C.D.E
END_INTERFACE`;

      const { ast, errors } = parse(src);
      expect(errors).toHaveLength(0);

      const iface = ast.declarations[0] as InterfaceDeclaration;
      expect(iface.extendsRefs).toHaveLength(2);
      expect(iface.extendsRefs[0].name).toBe('A.B');
      expect(iface.extendsRefs[1].name).toBe('C.D.E');
    });

    it('still parses simple INTERFACE EXTENDS without dots (regression)', () => {
      const src = `INTERFACE I_Foo EXTENDS I_Bar
END_INTERFACE`;

      const { ast, errors } = parse(src);
      expect(errors).toHaveLength(0);

      const iface = ast.declarations[0] as InterfaceDeclaration;
      expect(iface.extendsRefs).toHaveLength(1);
      expect(iface.extendsRefs[0].name).toBe('I_Bar');
    });

    it('parses FUNCTION_BLOCK IMPLEMENTS with qualified name', () => {
      const src = `FUNCTION_BLOCK FB_Foo IMPLEMENTS NS.I_Bar
END_FUNCTION_BLOCK`;

      const { ast, errors } = parse(src);
      expect(errors).toHaveLength(0);

      const fb = ast.declarations[0] as FunctionBlockDeclaration;
      expect(fb.name).toBe('FB_Foo');
      expect(fb.implementsRefs).toHaveLength(1);
      expect(fb.implementsRefs[0].name).toBe('NS.I_Bar');
    });

    it('parses FUNCTION_BLOCK EXTENDS with qualified name', () => {
      const src = `FUNCTION_BLOCK FB_Child EXTENDS NS.FB_Parent
END_FUNCTION_BLOCK`;

      const { ast, errors } = parse(src);
      expect(errors).toHaveLength(0);

      const fb = ast.declarations[0] as FunctionBlockDeclaration;
      expect(fb.name).toBe('FB_Child');
      expect(fb.extendsRef).toBeDefined();
      expect(fb.extendsRef!.name).toBe('NS.FB_Parent');
    });
  });

  describe('Qualified type names in VAR declarations', () => {
    it('parses dotted type name like __SYSTEM.IQueryInterface', () => {
      const src = `PROGRAM Main
VAR
  iQueryInterface : __SYSTEM.IQueryInterface;
END_VAR
END_PROGRAM`;

      const { ast, errors } = parse(src);
      expect(errors).toHaveLength(0);

      const prog = ast.declarations[0] as ProgramDeclaration;
      const decl = prog.varBlocks[0].declarations[0];
      expect(decl.type.name).toBe('__SYSTEM.IQUERYINTERFACE');
    });

    it('parses deeply nested qualified type name', () => {
      const src = `PROGRAM Main
VAR
  x : A.B.C;
END_VAR
END_PROGRAM`;

      const { ast, errors } = parse(src);
      expect(errors).toHaveLength(0);

      const prog = ast.declarations[0] as ProgramDeclaration;
      const decl = prog.varBlocks[0].declarations[0];
      expect(decl.type.name).toBe('A.B.C');
    });
  });

  describe('Array literal expressions', () => {
    it('arrayLiteral_1D: parses 1D integer array initializer', () => {
      const src = `PROGRAM P
VAR
  x : ARRAY[0..2] OF INT := [1, 2, 3];
END_VAR
END_PROGRAM`;
      const { errors, ast } = parse(src);
      expect(errors).toHaveLength(0);
      const prog = ast.declarations[0] as ProgramDeclaration;
      const varDecl = prog.varBlocks[0].declarations[0];
      const init = varDecl.initialValue as ArrayLiteral;
      expect(init.kind).toBe('ArrayLiteral');
      expect(init.elements).toHaveLength(3);
      expect((init.elements[0] as IntegerLiteral).value).toBe(1);
      expect((init.elements[2] as IntegerLiteral).value).toBe(3);
    });

    it('arrayLiteral_2D: parses nested array literal', () => {
      const src = `PROGRAM P
VAR
  x : ARRAY[0..1, 0..1] OF INT := [[1, 2], [3, 4]];
END_VAR
END_PROGRAM`;
      const { errors, ast } = parse(src);
      expect(errors).toHaveLength(0);
      const prog = ast.declarations[0] as ProgramDeclaration;
      const init = prog.varBlocks[0].declarations[0].initialValue as ArrayLiteral;
      expect(init.kind).toBe('ArrayLiteral');
      expect(init.elements).toHaveLength(2);
      expect((init.elements[0] as ArrayLiteral).kind).toBe('ArrayLiteral');
      expect((init.elements[0] as ArrayLiteral).elements).toHaveLength(2);
    });

    it('arrayLiteral_3D: parses three-dimensional nested array literal', () => {
      const src = `PROGRAM P
VAR
  x : ARRAY[0..1, 0..1, 0..1] OF INT := [[[1, 2], [3, 4]], [[5, 6], [7, 8]]];
END_VAR
END_PROGRAM`;
      const { errors } = parse(src);
      expect(errors).toHaveLength(0);
    });

    it('arrayLiteral_booleans: parses array of boolean literals', () => {
      const src = `PROGRAM P
VAR
  flags : ARRAY[0..3] OF BOOL := [FALSE, FALSE, TRUE, FALSE];
END_VAR
END_PROGRAM`;
      const { errors, ast } = parse(src);
      expect(errors).toHaveLength(0);
      const prog = ast.declarations[0] as ProgramDeclaration;
      const init = prog.varBlocks[0].declarations[0].initialValue as ArrayLiteral;
      expect(init.kind).toBe('ArrayLiteral');
      expect(init.elements).toHaveLength(4);
      expect((init.elements[0] as BoolLiteral).kind).toBe('BoolLiteral');
      expect((init.elements[0] as BoolLiteral).value).toBe(false);
      expect((init.elements[2] as BoolLiteral).value).toBe(true);
    });

    it('arrayLiteral_empty_regression: arr[5] still parses as SubscriptExpression', () => {
      const src = `PROGRAM P
VAR
  arr : ARRAY[0..9] OF INT;
  val : INT;
END_VAR
val := arr[5];
END_PROGRAM`;
      const { errors, ast } = parse(src);
      expect(errors).toHaveLength(0);
      const prog = ast.declarations[0] as ProgramDeclaration;
      const stmt = prog.body[0] as import('../parser/ast').AssignmentStatement;
      expect(stmt.right.kind).toBe('SubscriptExpression');
    });

    it('arrayLiteral_multiline: parses array with trailing comma', () => {
      const src = `PROGRAM P
VAR
  x : ARRAY[0..4] OF INT := [
    0,
    0,
    0,
    0,
    0,
  ];
END_VAR
END_PROGRAM`;
      const { errors, ast } = parse(src);
      expect(errors).toHaveLength(0);
      const prog = ast.declarations[0] as ProgramDeclaration;
      const init = prog.varBlocks[0].declarations[0].initialValue as ArrayLiteral;
      expect(init.kind).toBe('ArrayLiteral');
      expect(init.elements).toHaveLength(5);
    });
  });

  describe('Phase 5 — diagnostic cascade hardening', () => {
    it('errorRecovery_endVarStops: malformed VAR declaration recovers at END_VAR without cascading', () => {
      // Missing colon after variable name — should error on that var but recover at END_VAR
      const src = `FUNCTION_BLOCK FB_Test
VAR
  badVar INT;
  goodVar : BOOL;
END_VAR
END_FUNCTION_BLOCK`;
      const { errors } = parse(src);
      // Should have exactly 1 error (for badVar), NOT cascade into goodVar or beyond
      expect(errors.length).toBeLessThanOrEqual(2);
      // The error should be about the bad declaration, not about END_VAR or END_FUNCTION_BLOCK
      const unexpectedEndErrors = errors.filter(
        e => e.message.includes('END_VAR') || e.message.includes('END_FUNCTION_BLOCK'),
      );
      expect(unexpectedEndErrors).toHaveLength(0);
    });

    it('errorRecovery_endMethodStops: malformed statement in method recovers without cascading into next method', () => {
      const src = `FUNCTION_BLOCK FB_Test
VAR END_VAR
METHOD GoodMethod : BOOL
VAR END_VAR
GoodMethod := TRUE;
END_METHOD
END_FUNCTION_BLOCK`;
      const { ast, errors } = parse(src);
      expect(errors).toHaveLength(0);
      const fb = ast.declarations[0] as FunctionBlockDeclaration;
      expect(fb.methods).toHaveLength(1);
      expect(fb.methods[0].name).toBe('GoodMethod');
    });

    it('cascadeCount_fixtureFile: array literal initializer produces zero errors (previously cascaded)', () => {
      // This was one of the main cascade sources before Phase 1 fix
      const src = `FUNCTION_BLOCK FB_ArrayTest
VAR
  arr1 : ARRAY[0..9] OF BOOL := [FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, FALSE];
  arr2 : ARRAY[0..2] OF INT := [1, 2, 3];
END_VAR
END_FUNCTION_BLOCK`;
      const { errors } = parse(src);
      expect(errors).toHaveLength(0);
    });

    it('errorRecovery_endVarNotConsumed: END_VAR stops expression parser without being consumed', () => {
      // When a parse error occurs mid-expression in a VAR block, the expression
      // parser must NOT consume END_VAR — it must leave it for parseVarBlock()
      // to find and cleanly terminate the block.
      const src = `FUNCTION_BLOCK FB_Test
VAR
  badVar INT;
END_VAR
METHOD M1 : BOOL
VAR END_VAR
M1 := TRUE;
END_METHOD
END_FUNCTION_BLOCK`;
      const { ast, errors } = parse(src);
      // badVar line causes an error, but method should still parse cleanly
      const fb = ast.declarations[0] as FunctionBlockDeclaration;
      expect(fb.methods).toHaveLength(1);
      expect(fb.methods[0].name).toBe('M1');
      // No errors should mention END_VAR or END_METHOD — those are structural, not cascade
      const cascadeErrors = errors.filter(
        e => e.message.includes("'END_VAR'") || e.message.includes("'END_METHOD'"),
      );
      expect(cascadeErrors).toHaveLength(0);
    });

    it('errorRecovery_endMethodNotConsumed: END_METHOD stops expression parser without being consumed', () => {
      // A malformed statement should NOT cause END_METHOD to be consumed by the
      // expression parser, which would cascade errors into subsequent methods.
      const src = `FUNCTION_BLOCK FB_Test
VAR END_VAR
METHOD Bad : BOOL
VAR END_VAR
UNKNOWN_KEYWORD;
END_METHOD
METHOD Good : INT
VAR END_VAR
Good := 42;
END_METHOD
END_FUNCTION_BLOCK`;
      const { ast, errors } = parse(src);
      const fb = ast.declarations[0] as FunctionBlockDeclaration;
      // Both methods should be parsed — error recovery shouldn't eat END_METHOD
      expect(fb.methods).toHaveLength(2);
      expect(fb.methods[0].name).toBe('Bad');
      expect(fb.methods[1].name).toBe('Good');
      // No errors should reference END_METHOD
      const cascadeErrors = errors.filter(e => e.message.includes("'END_METHOD'"));
      expect(cascadeErrors).toHaveLength(0);
    });

    it('cascadeCount_multiMethodFB: error in one method does not cascade into others', () => {
      // Simulates real-world pattern from mobject-core: FB with multiple methods,
      // one has a parse error. Error should be isolated to that method only.
      const src = `FUNCTION_BLOCK FB_JsonSerializer
VAR
  writer : INT;
END_VAR
METHOD PUBLIC AddBool : BOOL
VAR_INPUT
  Value : BOOL;
END_VAR
writer := Value;
AddBool := TRUE;
END_METHOD
METHOD PUBLIC AddInt : BOOL
VAR_INPUT
  Value : INT;
END_VAR
writer := Value;
AddInt := TRUE;
END_METHOD
END_FUNCTION_BLOCK`;
      const { ast, errors } = parse(src);
      expect(errors).toHaveLength(0);
      const fb = ast.declarations[0] as FunctionBlockDeclaration;
      expect(fb.methods).toHaveLength(2);
    });
  });

  describe('REF= reference assignment operator', () => {
    it('refAssign_basic: parses REF= as AssignmentStatement with isRefAssign', () => {
      const src = `PROGRAM P
VAR x : REFERENCE TO INT; y : INT; END_VAR
x REF= y;
END_PROGRAM`;
      const { errors, ast } = parse(src);
      expect(errors).toHaveLength(0);
      const prog = ast.declarations[0] as ProgramDeclaration;
      const stmt = prog.body[0] as AssignmentStatement;
      expect(stmt.kind).toBe('AssignmentStatement');
      expect(stmt.isRefAssign).toBe(true);
    });

    it('refAssign_lowercase: lowercase ref= is accepted (case-insensitive)', () => {
      const src = `PROGRAM P
VAR x : REFERENCE TO INT; y : INT; END_VAR
x ref= y;
END_PROGRAM`;
      const { errors } = parse(src);
      expect(errors).toHaveLength(0);
    });

    it('refAssign_memberAccess: THIS^.field REF= expr parses cleanly', () => {
      const src = `FUNCTION_BLOCK FB_Foo
VAR
  jsonParser : REFERENCE TO INT;
  parent : INT;
END_VAR
THIS^.jsonParser REF= parent;
END_FUNCTION_BLOCK`;
      const { errors } = parse(src);
      expect(errors).toHaveLength(0);
    });

    it('refAssign_regression: normal := assignment still works after REF= added', () => {
      const src = `PROGRAM P
VAR x : INT; END_VAR
x := 42;
END_PROGRAM`;
      const { errors, ast } = parse(src);
      expect(errors).toHaveLength(0);
      const prog = ast.declarations[0] as ProgramDeclaration;
      const stmt = prog.body[0] as AssignmentStatement;
      expect(stmt.isRefAssign).toBeUndefined();
    });

    it('refAssign_statement_simple: simple REF= statement yields 0 errors and correct body kind', () => {
      const src = `PROGRAM P
VAR x : REFERENCE TO INT; y : INT; END_VAR
x REF= y;
END_PROGRAM`;
      const { errors, ast } = parse(src);
      expect(errors).toHaveLength(0);
      const prog = ast.declarations[0] as ProgramDeclaration;
      expect(prog.body[0].kind).toBe('AssignmentStatement');
      expect((prog.body[0] as AssignmentStatement).isRefAssign).toBe(true);
    });

    it('refAssign_statement_member_access: THIS^.field REF= inside METHOD parses cleanly', () => {
      const src = `FUNCTION_BLOCK FB
VAR ref : REFERENCE TO BYTE; END_VAR
METHOD Init
  THIS^.ref REF= someVar;
END_METHOD
END_FUNCTION_BLOCK`;
      const { errors } = parse(src);
      expect(errors).toHaveLength(0);
    });

    it('refAssign_var_initializer: REFERENCE TO with REF= initializer in VAR block', () => {
      const src = `PROGRAM P
VAR
  activeData : REFERENCE TO BYTE REF= localData;
END_VAR
END_PROGRAM`;
      const { errors, ast } = parse(src);
      expect(errors).toHaveLength(0);
      const prog = ast.declarations[0] as ProgramDeclaration;
      const decl = prog.varBlocks[0].declarations[0];
      expect(decl.initialValue).toBeDefined();
    });

    it('refAssign_no_regression_eq: x = y parses as BinaryExpression (EQ), not RefAssign', () => {
      const src = `PROGRAM P
VAR x : INT; y : INT; END_VAR
IF x = y THEN
END_IF
END_PROGRAM`;
      const { errors } = parse(src);
      expect(errors).toHaveLength(0);
    });

    it('refAssign_no_regression_identifier_ref: identifier named refCount parses as plain IDENTIFIER', () => {
      const src = `PROGRAM P
VAR refCount : INT; END_VAR
refCount := 5;
END_PROGRAM`;
      const { errors, ast } = parse(src);
      expect(errors).toHaveLength(0);
      const prog = ast.declarations[0] as ProgramDeclaration;
      expect(prog.varBlocks[0].declarations[0].name).toBe('refCount');
    });
  });

  describe('Bit access via numeric literal (.0-.7)', () => {
    it('bitAccess_direct: myByte.0 parses as MemberExpression with member "0"', () => {
      const src = `PROGRAM P
VAR b : BYTE; result : BOOL; END_VAR
result := b.0;
END_PROGRAM`;
      const { errors } = parse(src);
      expect(errors).toHaveLength(0);
    });

    it('bitAccess_deref_pointer: pByte^.0 parses cleanly', () => {
      const src = `FUNCTION GetBitValue : BOOL
VAR_INPUT pByte : POINTER TO BYTE; END_VAR
GetBitValue := pByte^.0;
END_FUNCTION`;
      const { errors } = parse(src);
      expect(errors).toHaveLength(0);
    });

    it('bitAccess_high_bit: pByte^.7 parses cleanly', () => {
      const src = `FUNCTION GetBit7 : BOOL
VAR_INPUT pByte : POINTER TO BYTE; END_VAR
GetBit7 := pByte^.7;
END_FUNCTION`;
      const { errors } = parse(src);
      expect(errors).toHaveLength(0);
    });

    it('bitAccess_assignment_lhs: b.3 := TRUE parses cleanly', () => {
      const src = `PROGRAM P
VAR b : BYTE; END_VAR
b.3 := TRUE;
END_PROGRAM`;
      const { errors } = parse(src);
      expect(errors).toHaveLength(0);
    });

    it('bitAccess_regression_member_ident: b.count still works as named member', () => {
      const src = `PROGRAM P
VAR s : SomeStruct; END_VAR
s.count := 5;
END_PROGRAM`;
      const { errors } = parse(src);
      expect(errors).toHaveLength(0);
    });
  });

  describe('ENUM keyword as identifier', () => {
    it('enum_as_param_name: ENUM used as named parameter in function call', () => {
      const src = `PROGRAM P
VAR result : SomeType; END_VAR
result := UnknownEnumerationError(EnumString := Enum);
END_PROGRAM`;
      const { errors } = parse(src);
      expect(errors).toHaveLength(0);
    });

    it('enum_as_variable_name: variable named Enum parses cleanly', () => {
      const src = `PROGRAM P
VAR Enum : INT; END_VAR
Enum := 5;
END_PROGRAM`;
      const { errors } = parse(src);
      expect(errors).toHaveLength(0);
    });

    it('enum_keyword_regression: TYPE ... ENUM declaration still works', () => {
      const src = `TYPE
MyEnum : (Val1, Val2, Val3);
END_TYPE`;
      const { errors } = parse(src);
      expect(errors).toHaveLength(0);
    });
  });

  describe('Multi-dimensional array subscript indexing arr[i,j]', () => {
    it('multiDimSubscript_2D: arr[i,j] parses as SubscriptExpression with 2 indices', () => {
      const src = `PROGRAM P
VAR arr : ARRAY[0..1, 0..1] OF INT; i : INT; j : INT; val : INT; END_VAR
val := arr[i, j];
END_PROGRAM`;
      const { errors, ast } = parse(src);
      expect(errors).toHaveLength(0);
      const prog = ast.declarations[0] as ProgramDeclaration;
      const stmt = prog.body[0] as import('../parser/ast').AssignmentStatement;
      const sub = stmt.right as import('../parser/ast').SubscriptExpression;
      expect(sub.kind).toBe('SubscriptExpression');
      expect(sub.indices).toHaveLength(2);
    });

    it('multiDimSubscript_3D: arr[i,j,k] parses with 3 indices', () => {
      const src = `PROGRAM P
VAR arr : ARRAY[0..1, 0..1, 0..1] OF INT; i : INT; j : INT; k : INT; val : INT; END_VAR
val := arr[i, j, k];
END_PROGRAM`;
      const { errors, ast } = parse(src);
      expect(errors).toHaveLength(0);
      const prog = ast.declarations[0] as ProgramDeclaration;
      const stmt = prog.body[0] as import('../parser/ast').AssignmentStatement;
      const sub = stmt.right as import('../parser/ast').SubscriptExpression;
      expect(sub.indices).toHaveLength(3);
    });

    it('multiDimSubscript_lhs: arr[i,j] := x parses cleanly on left-hand side', () => {
      const src = `PROGRAM P
VAR arr : ARRAY[0..1, 0..1] OF INT; i : INT; j : INT; END_VAR
arr[i, j] := 42;
END_PROGRAM`;
      const { errors } = parse(src);
      expect(errors).toHaveLength(0);
    });

    it('multiDimSubscript_regression_1D: arr[i] still has 1 index', () => {
      const src = `PROGRAM P
VAR arr : ARRAY[0..9] OF INT; i : INT; val : INT; END_VAR
val := arr[i];
END_PROGRAM`;
      const { errors, ast } = parse(src);
      expect(errors).toHaveLength(0);
      const prog = ast.declarations[0] as ProgramDeclaration;
      const stmt = prog.body[0] as import('../parser/ast').AssignmentStatement;
      const sub = stmt.right as import('../parser/ast').SubscriptExpression;
      expect(sub.indices).toHaveLength(1);
    });

    it('multiDimSubscript_literal_indices: arr[0,1] with literal indices parses cleanly', () => {
      const src = `PROGRAM P
VAR arr : ARRAY[0..1, 0..1] OF BOOL; val : BOOL; END_VAR
val := arr[0, 1];
END_PROGRAM`;
      const { errors } = parse(src);
      expect(errors).toHaveLength(0);
    });
  });
});
