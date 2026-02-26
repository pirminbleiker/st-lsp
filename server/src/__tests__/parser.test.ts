import { describe, it, expect } from 'vitest';
import { parse } from '../parser/parser';
import {
  ProgramDeclaration,
  FunctionDeclaration,
  AssignmentStatement,
  IfStatement,
  ForStatement,
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
});
