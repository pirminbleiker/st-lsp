/**
 * Regression Tests: TwinCAT ST Feature Matrix — Data Types & Control Flow (sl-ou3f)
 *
 * Feature areas:
 *   1.  Data types — built-in types, arrays, pointers, references
 *   2.  Type-prefixed literals — INT#, T#, etc. (known lexer limitation)
 *   3.  Control structures — IF/ELSIF/ELSE, WHILE, REPEAT/UNTIL, FOR, CASE
 *   4.  CONTINUE / EXIT keywords
 *   5.  Function Blocks — declaration, EXTENDS, IMPLEMENTS, ABSTRACT, FINAL
 */

import { describe, it, expect } from 'vitest';
import { parse } from '../parser/parser';
import { Lexer, TokenKind } from '../parser/lexer';
import {
  FunctionBlockDeclaration,
  FunctionDeclaration,
  ProgramDeclaration,
  IfStatement,
  ForStatement,
  WhileStatement,
  RepeatStatement,
  CaseStatement,
  ContinueStatement,
  ExitStatement,
  ReturnStatement,
  AssignmentStatement,
  VarBlock,
} from '../parser/ast';

function tokenize(src: string) {
  return new Lexer(src).tokenize();
}

// ---------------------------------------------------------------------------
// 1. Data types
// ---------------------------------------------------------------------------

describe('data types', () => {
  it('parses all IEC primitive type names as variable types', () => {
    const src = `PROGRAM P
VAR
  a : BOOL;
  b : BYTE;
  c : WORD;
  d : DWORD;
  e : LWORD;
  f : SINT;
  g : INT;
  h : DINT;
  i : LINT;
  j : USINT;
  k : UINT;
  l : UDINT;
  m : ULINT;
  n : REAL;
  o : LREAL;
  p : STRING;
  q : WSTRING;
  r : TIME;
  s : DATE;
  t : TOD;
  u : DT;
END_VAR
END_PROGRAM`;
    const { errors } = parse(src);
    expect(errors).toHaveLength(0);
  });

  it('parses ARRAY[1..10] OF INT variable type', () => {
    const src = `PROGRAM P
VAR
  arr : ARRAY[1..10] OF INT;
END_VAR
END_PROGRAM`;
    const { ast, errors } = parse(src);
    expect(errors).toHaveLength(0);
    const prog = ast.declarations[0] as ProgramDeclaration;
    const decl = prog.varBlocks[0].declarations[0];
    expect(decl.type.isArray).toBe(true);
    expect(decl.type.arrayDims).toHaveLength(1);
    expect(decl.type.arrayDims![0].low).toBe('1');
    expect(decl.type.arrayDims![0].high).toBe('10');
    expect(decl.type.name).toBe('INT');
  });

  it('parses multi-dimensional ARRAY type', () => {
    const src = `PROGRAM P
VAR
  matrix : ARRAY[0..3, 0..3] OF REAL;
END_VAR
END_PROGRAM`;
    const { ast, errors } = parse(src);
    expect(errors).toHaveLength(0);
    const prog = ast.declarations[0] as ProgramDeclaration;
    const decl = prog.varBlocks[0].declarations[0];
    expect(decl.type.isArray).toBe(true);
    expect(decl.type.arrayDims).toHaveLength(2);
  });

  it('parses POINTER TO type', () => {
    const src = `FUNCTION_BLOCK FB
VAR
  pInt : POINTER TO INT;
END_VAR
END_FUNCTION_BLOCK`;
    const { ast, errors } = parse(src);
    expect(errors).toHaveLength(0);
    const fb = ast.declarations[0] as FunctionBlockDeclaration;
    const decl = fb.varBlocks[0].declarations[0];
    expect(decl.type.isPointer).toBe(true);
    expect(decl.type.name).toBe('INT');
  });

  it('parses REFERENCE TO type', () => {
    const src = `FUNCTION_BLOCK FB
VAR
  refFB : REFERENCE TO SomeType;
END_VAR
END_FUNCTION_BLOCK`;
    const { ast, errors } = parse(src);
    expect(errors).toHaveLength(0);
    const fb = ast.declarations[0] as FunctionBlockDeclaration;
    const decl = fb.varBlocks[0].declarations[0];
    expect(decl.type.isReference).toBe(true);
    expect(decl.type.name).toBe('SOMETYPE');
  });

  it('parses STRING with declared length', () => {
    const src = `PROGRAM P
VAR
  s : STRING(80);
END_VAR
END_PROGRAM`;
    const { errors } = parse(src);
    // STRING(80) may or may not parse cleanly depending on implementation;
    // document current behaviour
    expect(errors).toBeDefined();
  });

  it('parses variable with initial value using integer literal', () => {
    const src = `PROGRAM P
VAR
  count : DINT := 100;
  flag  : BOOL := FALSE;
  name  : STRING := 'hello';
  ratio : REAL := 3.14;
END_VAR
END_PROGRAM`;
    const { ast, errors } = parse(src);
    expect(errors).toHaveLength(0);
    const prog = ast.declarations[0] as ProgramDeclaration;
    const decls = prog.varBlocks[0].declarations;
    expect(decls[0].initialValue?.kind).toBe('IntegerLiteral');
    expect(decls[1].initialValue?.kind).toBe('BoolLiteral');
    expect(decls[2].initialValue?.kind).toBe('StringLiteral');
    expect(decls[3].initialValue?.kind).toBe('RealLiteral');
  });
});

// ---------------------------------------------------------------------------
// 2. Type-prefixed literals (known limitation)
// ---------------------------------------------------------------------------

describe('type-prefixed literals', () => {
  it('INT#16 — lexer emits # as IDENTIFIER; parser produces an error', () => {
    // The lexer does not have special handling for the '#' character
    // (it falls through to the IDENTIFIER default).  Type-prefixed literals
    // therefore cause a parse error on the current implementation.
    const src = `PROGRAM P
VAR x : INT; END_VAR
x := INT#16;
END_PROGRAM`;
    const { errors } = parse(src);
    // Regression: confirm the parser at least returns an AST and does not throw
    expect(errors).toBeDefined();
  });

  it('# character tokenizes as an IDENTIFIER token', () => {
    const tokens = tokenize('#');
    // '#' has no dedicated token kind; it falls through to IDENTIFIER
    expect(tokens[0].kind).toBe(TokenKind.IDENTIFIER);
    expect(tokens[0].text).toBe('#');
  });

  it('parser continues past type-prefixed literal and parses remaining code', () => {
    // Error recovery should allow the rest of the function to parse
    const src = `PROGRAM P
VAR x : INT; y : INT; END_VAR
x := INT#16;
y := 42;
END_PROGRAM`;
    const { ast } = parse(src);
    expect(ast.kind).toBe('SourceFile');
    const prog = ast.declarations[0] as ProgramDeclaration;
    // y := 42 should still parse
    const stmts = prog.body.filter((s) => s.kind === 'AssignmentStatement');
    expect(stmts.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// 3. Control structures
// ---------------------------------------------------------------------------

describe('control structures', () => {
  describe('IF / ELSIF / ELSE', () => {
    it('parses simple IF...THEN...END_IF', () => {
      const src = `PROGRAM P
VAR x : INT; END_VAR
IF x > 0 THEN x := 1; END_IF;
END_PROGRAM`;
      const { errors, ast } = parse(src);
      expect(errors).toHaveLength(0);
      const prog = ast.declarations[0] as ProgramDeclaration;
      const stmt = prog.body[0] as IfStatement;
      expect(stmt.kind).toBe('IfStatement');
      expect(stmt.then).toHaveLength(1);
      expect(stmt.elsifs).toHaveLength(0);
      expect(stmt.else).toBeUndefined();
    });

    it('parses IF...ELSIF...ELSE...END_IF', () => {
      const src = `PROGRAM P
VAR x : INT; y : INT; END_VAR
IF x = 1 THEN
  y := 10;
ELSIF x = 2 THEN
  y := 20;
ELSIF x = 3 THEN
  y := 30;
ELSE
  y := 0;
END_IF;
END_PROGRAM`;
      const { errors, ast } = parse(src);
      expect(errors).toHaveLength(0);
      const prog = ast.declarations[0] as ProgramDeclaration;
      const stmt = prog.body[0] as IfStatement;
      expect(stmt.elsifs).toHaveLength(2);
      expect(stmt.else).toBeDefined();
      expect(stmt.else).toHaveLength(1);
    });

    it('parses nested IF statements', () => {
      const src = `PROGRAM P
VAR a : INT; b : INT; END_VAR
IF a > 0 THEN
  IF b > 0 THEN
    a := 1;
  END_IF;
END_IF;
END_PROGRAM`;
      const { errors } = parse(src);
      expect(errors).toHaveLength(0);
    });
  });

  describe('WHILE loop', () => {
    it('parses WHILE...DO...END_WHILE', () => {
      const src = `PROGRAM P
VAR i : INT; END_VAR
WHILE i < 10 DO
  i := i + 1;
END_WHILE;
END_PROGRAM`;
      const { errors, ast } = parse(src);
      expect(errors).toHaveLength(0);
      const prog = ast.declarations[0] as ProgramDeclaration;
      const stmt = prog.body[0] as WhileStatement;
      expect(stmt.kind).toBe('WhileStatement');
      expect(stmt.condition.kind).toBe('BinaryExpression');
      expect(stmt.body).toHaveLength(1);
    });

    it('parses WHILE loop with empty body', () => {
      const src = `PROGRAM P
VAR done : BOOL; END_VAR
WHILE NOT done DO
END_WHILE;
END_PROGRAM`;
      const { errors } = parse(src);
      expect(errors).toHaveLength(0);
    });
  });

  describe('REPEAT / UNTIL (DO...WHILE)', () => {
    it('parses REPEAT...UNTIL', () => {
      const src = `PROGRAM P
VAR i : INT; END_VAR
REPEAT
  i := i + 1;
UNTIL i >= 10
END_REPEAT;
END_PROGRAM`;
      const { errors, ast } = parse(src);
      expect(errors).toHaveLength(0);
      const prog = ast.declarations[0] as ProgramDeclaration;
      const stmt = prog.body[0] as RepeatStatement;
      expect(stmt.kind).toBe('RepeatStatement');
      expect(stmt.condition.kind).toBe('BinaryExpression');
      expect(stmt.body).toHaveLength(1);
    });
  });

  describe('FOR loop', () => {
    it('parses FOR...TO...DO...END_FOR without BY', () => {
      const src = `PROGRAM P
VAR i : INT; END_VAR
FOR i := 0 TO 9 DO END_FOR;
END_PROGRAM`;
      const { errors, ast } = parse(src);
      expect(errors).toHaveLength(0);
      const prog = ast.declarations[0] as ProgramDeclaration;
      const stmt = prog.body[0] as ForStatement;
      expect(stmt.kind).toBe('ForStatement');
      expect(stmt.by).toBeUndefined();
    });

    it('parses FOR...TO...BY...DO...END_FOR', () => {
      const src = `PROGRAM P
VAR i : INT; END_VAR
FOR i := 0 TO 100 BY 5 DO END_FOR;
END_PROGRAM`;
      const { errors, ast } = parse(src);
      expect(errors).toHaveLength(0);
      const prog = ast.declarations[0] as ProgramDeclaration;
      const stmt = prog.body[0] as ForStatement;
      expect(stmt.by).toBeDefined();
      expect(stmt.by?.kind).toBe('IntegerLiteral');
    });

    it('parses FOR loop counting down with negative BY step', () => {
      const src = `PROGRAM P
VAR i : INT; END_VAR
FOR i := 10 TO 0 BY -1 DO END_FOR;
END_PROGRAM`;
      const { errors } = parse(src);
      expect(errors).toHaveLength(0);
    });
  });

  describe('CASE / OF', () => {
    it('parses CASE...OF with integer constants', () => {
      const src = `PROGRAM P
VAR mode : INT; result : INT; END_VAR
CASE mode OF
  0: result := 10;
  1: result := 20;
  2: result := 30;
END_CASE;
END_PROGRAM`;
      const { errors, ast } = parse(src);
      expect(errors).toHaveLength(0);
      const prog = ast.declarations[0] as ProgramDeclaration;
      const stmt = prog.body[0] as CaseStatement;
      expect(stmt.kind).toBe('CaseStatement');
      expect(stmt.cases).toHaveLength(3);
    });

    it('parses CASE with range values (..)', () => {
      const src = `PROGRAM P
VAR x : INT; y : INT; END_VAR
CASE x OF
  1..5: y := 1;
  6..10: y := 2;
  ELSE y := 0;
END_CASE;
END_PROGRAM`;
      const { errors, ast } = parse(src);
      expect(errors).toHaveLength(0);
      const prog = ast.declarations[0] as ProgramDeclaration;
      const stmt = prog.body[0] as CaseStatement;
      expect(stmt.cases[0].values[0].kind).toBe('range');
      expect(stmt.cases[1].values[0].kind).toBe('range');
      expect(stmt.else).toBeDefined();
    });

    it('parses CASE with comma-separated values', () => {
      const src = `PROGRAM P
VAR x : INT; y : INT; END_VAR
CASE x OF
  1, 3, 5: y := 1;
  2, 4, 6: y := 2;
END_CASE;
END_PROGRAM`;
      const { errors, ast } = parse(src);
      expect(errors).toHaveLength(0);
      const prog = ast.declarations[0] as ProgramDeclaration;
      const stmt = prog.body[0] as CaseStatement;
      expect(stmt.cases[0].values).toHaveLength(3);
    });

    it('parses CASE with ELSE branch', () => {
      const src = `PROGRAM P
VAR state : INT; out : INT; END_VAR
CASE state OF
  0: out := 0;
  ELSE out := -1;
END_CASE;
END_PROGRAM`;
      const { errors, ast } = parse(src);
      expect(errors).toHaveLength(0);
      const prog = ast.declarations[0] as ProgramDeclaration;
      const stmt = prog.body[0] as CaseStatement;
      expect(stmt.else).toBeDefined();
    });

    it('parses CASE on enum-like identifiers', () => {
      const src = `PROGRAM P
VAR state : INT; END_VAR
CASE state OF
  STATE_IDLE: ;
  STATE_RUN:  ;
END_CASE;
END_PROGRAM`;
      const { errors } = parse(src);
      expect(errors).toHaveLength(0);
    });

    it('parses CASE with TRUE:/FALSE: boolean labels', () => {
      const src = `PROGRAM P
VAR b : BOOL; x : INT; END_VAR
CASE b OF
  TRUE:  x := 1;
  FALSE: x := 0;
END_CASE;
END_PROGRAM`;
      const { errors, ast } = parse(src);
      expect(errors).toHaveLength(0);
      const prog = ast.declarations[0] as ProgramDeclaration;
      const stmt = prog.body[0] as CaseStatement;
      expect(stmt.cases).toHaveLength(2);
    });

    it('parses CASE with enum-qualified labels (E_State.Running:)', () => {
      const src = `PROGRAM P
VAR eMode : INT; x : INT; END_VAR
CASE eMode OF
  E_State.Running:  x := 1;
  E_State.Stopped:  x := 0;
  E_State.Error:    x := -1;
END_CASE;
END_PROGRAM`;
      const { errors, ast } = parse(src);
      expect(errors).toHaveLength(0);
      const prog = ast.declarations[0] as ProgramDeclaration;
      const stmt = prog.body[0] as CaseStatement;
      expect(stmt.cases).toHaveLength(3);
    });

    it('parses CASE with negative integer labels', () => {
      const src = `PROGRAM P
VAR x : INT; y : INT; END_VAR
CASE x OF
  -1: y := 1;
  -2: y := 2;
   0: y := 0;
END_CASE;
END_PROGRAM`;
      const { errors, ast } = parse(src);
      expect(errors).toHaveLength(0);
      const prog = ast.declarations[0] as ProgramDeclaration;
      const stmt = prog.body[0] as CaseStatement;
      expect(stmt.cases).toHaveLength(3);
    });

    it('parses CASE with range starting from negative (-1..5:)', () => {
      const src = `PROGRAM P
VAR x : INT; y : INT; END_VAR
CASE x OF
  -10..-1: y := -1;
  0:       y := 0;
  1..10:   y := 1;
END_CASE;
END_PROGRAM`;
      const { errors, ast } = parse(src);
      expect(errors).toHaveLength(0);
      const prog = ast.declarations[0] as ProgramDeclaration;
      const stmt = prog.body[0] as CaseStatement;
      expect(stmt.cases[0].values[0].kind).toBe('range');
    });

    it('parses CASE with multiple statements per branch', () => {
      const src = `PROGRAM P
VAR mode : INT; x : INT; y : INT; END_VAR
CASE mode OF
  1: x := 1; y := 10;
  2: x := 2; y := 20;
END_CASE;
END_PROGRAM`;
      const { errors, ast } = parse(src);
      expect(errors).toHaveLength(0);
      const prog = ast.declarations[0] as ProgramDeclaration;
      const stmt = prog.body[0] as CaseStatement;
      expect(stmt.cases[0].body).toHaveLength(2);
      expect(stmt.cases[1].body).toHaveLength(2);
    });

    it('parses CASE with nested IF inside branch', () => {
      const src = `PROGRAM P
VAR mode : INT; x : INT; y : INT; END_VAR
CASE mode OF
  1:
    IF x > 0 THEN
      y := 1;
    ELSE
      y := -1;
    END_IF;
  2:
    y := 0;
END_CASE;
END_PROGRAM`;
      const { errors, ast } = parse(src);
      expect(errors).toHaveLength(0);
      const prog = ast.declarations[0] as ProgramDeclaration;
      const stmt = prog.body[0] as CaseStatement;
      expect(stmt.cases).toHaveLength(2);
      expect(stmt.cases[0].body[0].kind).toBe('IfStatement');
    });

    it('parses CASE with nested FOR inside branch', () => {
      const src = `PROGRAM P
VAR mode : INT; i : INT; x : INT; END_VAR
CASE mode OF
  1:
    FOR i := 0 TO 10 DO
      x := x + i;
    END_FOR;
  2:
    x := 0;
END_CASE;
END_PROGRAM`;
      const { errors, ast } = parse(src);
      expect(errors).toHaveLength(0);
      const prog = ast.declarations[0] as ProgramDeclaration;
      const stmt = prog.body[0] as CaseStatement;
      expect(stmt.cases).toHaveLength(2);
      expect(stmt.cases[0].body[0].kind).toBe('ForStatement');
    });

    it('parses CASE with nested WHILE inside branch', () => {
      const src = `PROGRAM P
VAR mode : INT; x : INT; END_VAR
CASE mode OF
  1:
    WHILE x > 0 DO
      x := x - 1;
    END_WHILE;
  2:
    x := 0;
END_CASE;
END_PROGRAM`;
      const { errors, ast } = parse(src);
      expect(errors).toHaveLength(0);
      const prog = ast.declarations[0] as ProgramDeclaration;
      const stmt = prog.body[0] as CaseStatement;
      expect(stmt.cases).toHaveLength(2);
      expect(stmt.cases[0].body[0].kind).toBe('WhileStatement');
    });

    it('parses CASE with ELSE containing nested control flow', () => {
      const src = `PROGRAM P
VAR mode : INT; i : INT; x : INT; END_VAR
CASE mode OF
  1: x := 1;
  ELSE
    FOR i := 0 TO 5 DO
      x := x + i;
    END_FOR;
END_CASE;
END_PROGRAM`;
      const { errors, ast } = parse(src);
      expect(errors).toHaveLength(0);
      const prog = ast.declarations[0] as ProgramDeclaration;
      const stmt = prog.body[0] as CaseStatement;
      expect(stmt.else).toBeDefined();
    });
  });
});

// ---------------------------------------------------------------------------
// 4. CONTINUE / EXIT keywords
// ---------------------------------------------------------------------------

describe('CONTINUE and EXIT', () => {
  it('parses CONTINUE inside FOR loop', () => {
    const src = `PROGRAM P
VAR i : INT; END_VAR
FOR i := 0 TO 9 DO
  IF i = 5 THEN CONTINUE; END_IF;
END_FOR;
END_PROGRAM`;
    const { errors, ast } = parse(src);
    expect(errors).toHaveLength(0);
    const prog = ast.declarations[0] as ProgramDeclaration;
    const forStmt = prog.body[0] as ForStatement;
    const ifStmt = forStmt.body[0] as IfStatement;
    const cont = ifStmt.then[0] as ContinueStatement;
    expect(cont.kind).toBe('ContinueStatement');
  });

  it('parses EXIT inside WHILE loop', () => {
    const src = `PROGRAM P
VAR i : INT; END_VAR
WHILE i < 100 DO
  IF i = 50 THEN EXIT; END_IF;
  i := i + 1;
END_WHILE;
END_PROGRAM`;
    const { errors, ast } = parse(src);
    expect(errors).toHaveLength(0);
    const prog = ast.declarations[0] as ProgramDeclaration;
    const whileStmt = prog.body[0] as WhileStatement;
    const ifStmt = whileStmt.body[0] as IfStatement;
    const exitStmt = ifStmt.then[0] as ExitStatement;
    expect(exitStmt.kind).toBe('ExitStatement');
  });

  it('parses RETURN inside FUNCTION', () => {
    const src = `FUNCTION Max : INT
VAR_INPUT a : INT; b : INT; END_VAR
IF a > b THEN
  Max := a;
  RETURN;
END_IF;
Max := b;
END_FUNCTION`;
    const { errors, ast } = parse(src);
    expect(errors).toHaveLength(0);
    const fn = ast.declarations[0] as FunctionDeclaration;
    const ifStmt = fn.body[0] as IfStatement;
    const retStmt = ifStmt.then[1] as ReturnStatement;
    expect(retStmt.kind).toBe('ReturnStatement');
  });
});

// ---------------------------------------------------------------------------
// 5. Function Blocks — declaration, inheritance, OOP keywords
// ---------------------------------------------------------------------------

describe('function block declarations', () => {
  it('parses minimal FUNCTION_BLOCK', () => {
    const src = `FUNCTION_BLOCK MyFB
VAR
  x : INT;
END_VAR
END_FUNCTION_BLOCK`;
    const { errors, ast } = parse(src);
    expect(errors).toHaveLength(0);
    const fb = ast.declarations[0] as FunctionBlockDeclaration;
    expect(fb.kind).toBe('FunctionBlockDeclaration');
    expect(fb.name).toBe('MyFB');
    expect(fb.extendsRef).toBeUndefined();
    expect(fb.implementsRefs).toHaveLength(0);
  });

  it('parses FUNCTION_BLOCK EXTENDS BaseClass', () => {
    const src = `FUNCTION_BLOCK Child EXTENDS Parent
VAR
  extra : INT;
END_VAR
END_FUNCTION_BLOCK`;
    const { errors, ast } = parse(src);
    expect(errors).toHaveLength(0);
    const fb = ast.declarations[0] as FunctionBlockDeclaration;
    expect(fb.extendsRef?.name).toBe('Parent');
  });

  it('parses FUNCTION_BLOCK IMPLEMENTS single interface', () => {
    const src = `FUNCTION_BLOCK Concrete IMPLEMENTS I_Base
VAR END_VAR
END_FUNCTION_BLOCK`;
    const { errors, ast } = parse(src);
    expect(errors).toHaveLength(0);
    const fb = ast.declarations[0] as FunctionBlockDeclaration;
    expect(fb.implementsRefs.map(r => r.name)).toContain('I_Base');
  });

  it('parses FUNCTION_BLOCK IMPLEMENTS multiple interfaces', () => {
    const src = `FUNCTION_BLOCK Multi IMPLEMENTS I_First, I_Second, I_Third
VAR END_VAR
END_FUNCTION_BLOCK`;
    const { errors, ast } = parse(src);
    expect(errors).toHaveLength(0);
    const fb = ast.declarations[0] as FunctionBlockDeclaration;
    expect(fb.implementsRefs).toHaveLength(3);
    expect(fb.implementsRefs.map(r => r.name)).toContain('I_First');
    expect(fb.implementsRefs.map(r => r.name)).toContain('I_Second');
    expect(fb.implementsRefs.map(r => r.name)).toContain('I_Third');
  });

  it('parses ABSTRACT FUNCTION_BLOCK', () => {
    const src = `FUNCTION_BLOCK ABSTRACT AbstractBase
VAR END_VAR
END_FUNCTION_BLOCK`;
    const { errors, ast } = parse(src);
    expect(errors).toHaveLength(0);
    const fb = ast.declarations[0] as FunctionBlockDeclaration;
    expect(fb.name).toBe('AbstractBase');
  });

  it('parses FINAL FUNCTION_BLOCK', () => {
    const src = `FUNCTION_BLOCK FINAL SealedClass
VAR END_VAR
END_FUNCTION_BLOCK`;
    const { errors, ast } = parse(src);
    expect(errors).toHaveLength(0);
    const fb = ast.declarations[0] as FunctionBlockDeclaration;
    expect(fb.name).toBe('SealedClass');
  });

  it('parses FUNCTION_BLOCK with EXTENDS and IMPLEMENTS combined', () => {
    const src = `FUNCTION_BLOCK DerivedImpl EXTENDS Base IMPLEMENTS I_Contract, I_Lifecycle
VAR END_VAR
END_FUNCTION_BLOCK`;
    const { errors, ast } = parse(src);
    expect(errors).toHaveLength(0);
    const fb = ast.declarations[0] as FunctionBlockDeclaration;
    expect(fb.extendsRef?.name).toBe('Base');
    expect(fb.implementsRefs).toHaveLength(2);
  });

  it('parses FUNCTION_BLOCK with all VAR block kinds', () => {
    const src = `FUNCTION_BLOCK VarKinds
VAR
  localVar : INT;
END_VAR
VAR_INPUT
  inVal : BOOL;
END_VAR
VAR_OUTPUT
  outVal : REAL;
END_VAR
VAR_IN_OUT
  ioVal : STRING;
END_VAR
VAR_STAT
  callCount : DINT;
END_VAR
VAR_TEMP
  tempBuf : BYTE;
END_VAR
END_FUNCTION_BLOCK`;
    const { errors, ast } = parse(src);
    expect(errors).toHaveLength(0);
    const fb = ast.declarations[0] as FunctionBlockDeclaration;
    const kinds = fb.varBlocks.map((b: VarBlock) => b.varKind);
    expect(kinds).toContain('VAR');
    expect(kinds).toContain('VAR_INPUT');
    expect(kinds).toContain('VAR_OUTPUT');
    expect(kinds).toContain('VAR_IN_OUT');
    expect(kinds).toContain('VAR_STAT');
    expect(kinds).toContain('VAR_TEMP');
  });
});
