import { describe, it, expect } from 'vitest';
import { parse } from '../parser/parser';
import {
  ActionDeclaration,
  FunctionBlockDeclaration,
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
});
