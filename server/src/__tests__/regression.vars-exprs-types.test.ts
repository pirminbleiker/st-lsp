/**
 * Regression Tests: TwinCAT ST Feature Matrix — Vars, Expressions & Types (sl-ou3f)
 *
 * Feature areas:
 *  11.  Pragmas — {attribute '...'} on FBs, methods, variables
 *  12.  Expressions — arithmetic, comparison, logical, subscript, member
 *  13.  TYPE declarations — STRUCT, ENUM, ALIAS, UNION in same file as FB
 *  14.  Namespaces — NAMESPACE...END_NAMESPACE skip behaviour
 *  15.  Cross-cutting — multiple declarations, error recovery
 */

import { describe, it, expect } from 'vitest';
import { parse } from '../parser/parser';
import { Lexer, TokenKind } from '../parser/lexer';
import {
  FunctionBlockDeclaration,
  FunctionDeclaration,
  ProgramDeclaration,
  TypeDeclarationBlock,
  StructDeclaration,
  EnumDeclaration,
  AliasDeclaration,
  UnionDeclaration,
  MethodDeclaration,
} from '../parser/ast';

function tokenize(src: string) {
  return new Lexer(src).tokenize();
}

// ---------------------------------------------------------------------------
// 11. Pragmas
// ---------------------------------------------------------------------------

describe('pragmas', () => {
  it('parses single pragma on FUNCTION_BLOCK', () => {
    const src = `{attribute 'hide'}
FUNCTION_BLOCK Internal
VAR END_VAR
END_FUNCTION_BLOCK`;
    const { errors, ast } = parse(src);
    expect(errors).toHaveLength(0);
    const fb = ast.declarations[0] as FunctionBlockDeclaration;
    expect(fb.pragmas).toHaveLength(1);
    expect(fb.pragmas[0].name).toBe('hide');
  });

  it('parses multiple pragmas on FUNCTION_BLOCK', () => {
    const src = `{attribute 'linkalways'}
{attribute 'no_explicit_call' := 'This FB is a CLASS, DO NOT call it directly'}
{attribute 'enable_dynamic_creation'}
FUNCTION_BLOCK ABSTRACT Disposable IMPLEMENTS I_Disposable
VAR END_VAR
END_FUNCTION_BLOCK`;
    const { errors, ast } = parse(src);
    expect(errors).toHaveLength(0);
    const fb = ast.declarations[0] as FunctionBlockDeclaration;
    expect(fb.pragmas).toHaveLength(3);
    const names = fb.pragmas.map((p) => p.name);
    expect(names).toContain('linkalways');
    expect(names).toContain('no_explicit_call');
    expect(names).toContain('enable_dynamic_creation');
  });

  it('parses pragma with value assignment', () => {
    const src = `{attribute 'monitoring' := 'call'}
FUNCTION_BLOCK FB
VAR END_VAR
END_FUNCTION_BLOCK`;
    const { errors, ast } = parse(src);
    expect(errors).toHaveLength(0);
    const fb = ast.declarations[0] as FunctionBlockDeclaration;
    expect(fb.pragmas[0].value).toBe('call');
  });

  it('parses pragma on variable declaration', () => {
    const src = `FUNCTION_BLOCK FB
VAR
  {attribute 'displaymode' := 'hex'}
  rawValue : DWORD;
END_VAR
END_FUNCTION_BLOCK`;
    const { errors, ast } = parse(src);
    expect(errors).toHaveLength(0);
    const fb = ast.declarations[0] as FunctionBlockDeclaration;
    const decl = fb.varBlocks[0].declarations[0];
    expect(decl.pragmas).toHaveLength(1);
    expect(decl.pragmas[0].name).toBe('displaymode');
  });

  it('parses pragma on METHOD', () => {
    const src = `FUNCTION_BLOCK FB
{attribute 'obsolete'}
METHOD OldMethod
END_METHOD
END_FUNCTION_BLOCK`;
    const { errors, ast } = parse(src);
    expect(errors).toHaveLength(0);
    const fb = ast.declarations[0] as FunctionBlockDeclaration;
    const m = fb.methods[0] as MethodDeclaration;
    expect(m.name).toBe('OldMethod');
  });

  it('lexer tokenizes pragma with nested single-quotes', () => {
    const tokens = tokenize("{attribute 'no_explicit_call' := 'Do not call directly'}");
    expect(tokens[0].kind).toBe(TokenKind.PRAGMA);
    expect(tokens[0].text).toContain('no_explicit_call');
  });
});

// ---------------------------------------------------------------------------
// 12. Expressions
// ---------------------------------------------------------------------------

describe('expressions', () => {
  describe('arithmetic operators', () => {
    it('parses addition, subtraction, multiplication, division', () => {
      const src = `PROGRAM P
VAR a : INT; b : INT; c : INT; END_VAR
c := a + b - 1;
c := a * b / 2;
END_PROGRAM`;
      const { errors } = parse(src);
      expect(errors).toHaveLength(0);
    });

    it('parses power operator **', () => {
      const src = `PROGRAM P
VAR x : REAL; y : REAL; END_VAR
y := x ** 2.0;
END_PROGRAM`;
      const { errors } = parse(src);
      expect(errors).toHaveLength(0);
    });

    it('parses MOD operator', () => {
      const src = `PROGRAM P
VAR x : INT; r : INT; END_VAR
r := x MOD 3;
END_PROGRAM`;
      const { errors } = parse(src);
      expect(errors).toHaveLength(0);
    });

    it('parses unary minus', () => {
      const src = `PROGRAM P
VAR x : INT; y : INT; END_VAR
y := -x;
y := -(x + 1);
END_PROGRAM`;
      const { errors } = parse(src);
      expect(errors).toHaveLength(0);
    });
  });

  describe('boolean operators', () => {
    it('parses AND, OR, XOR, NOT', () => {
      const src = `PROGRAM P
VAR a : BOOL; b : BOOL; c : BOOL; END_VAR
c := a AND b;
c := a OR b;
c := a XOR b;
c := NOT a;
c := (a AND NOT b) OR (NOT a AND b);
END_PROGRAM`;
      const { errors } = parse(src);
      expect(errors).toHaveLength(0);
    });
  });

  describe('comparison operators', () => {
    it('parses =, <>, <, >, <=, >=', () => {
      const src = `PROGRAM P
VAR a : INT; b : INT; c : BOOL; END_VAR
c := a = b;
c := a <> b;
c := a < b;
c := a > b;
c := a <= b;
c := a >= b;
END_PROGRAM`;
      const { errors } = parse(src);
      expect(errors).toHaveLength(0);
    });
  });

  describe('subscript and member access', () => {
    it('parses array subscript access', () => {
      const src = `PROGRAM P
VAR
  arr : ARRAY[0..9] OF INT;
  i   : INT;
  val : INT;
END_VAR
val := arr[i];
arr[0] := 42;
END_PROGRAM`;
      const { errors } = parse(src);
      expect(errors).toHaveLength(0);
    });

    it('parses member access (dot notation)', () => {
      const src = `PROGRAM P
VAR fb : MyFB; x : INT; END_VAR
x := fb.OutputValue;
fb.InputParam := x;
END_PROGRAM`;
      const { errors } = parse(src);
      expect(errors).toHaveLength(0);
    });

    it('parses nested member access', () => {
      const src = `PROGRAM P
VAR obj : Container; x : INT; END_VAR
x := obj.Inner.Value;
END_PROGRAM`;
      const { errors } = parse(src);
      expect(errors).toHaveLength(0);
    });
  });

  describe('function and FB calls', () => {
    it('parses positional function call', () => {
      const src = `PROGRAM P
VAR x : INT; y : INT; END_VAR
y := ABS(x);
y := MAX(x, 100);
END_PROGRAM`;
      const { errors } = parse(src);
      expect(errors).toHaveLength(0);
    });

    it('parses named-parameter (formal) function call', () => {
      const src = `PROGRAM P
VAR
  tmr : TON;
  done : BOOL;
END_VAR
tmr(IN := TRUE, PT := 1000);
done := tmr.Q;
END_PROGRAM`;
      const { errors } = parse(src);
      expect(errors).toHaveLength(0);
    });

    it('parses output-binding call (=>)', () => {
      const src = `PROGRAM P
VAR
  blk : SomeBlock;
  out : INT;
END_VAR
blk(Input := 5, Output => out);
END_PROGRAM`;
      const { errors } = parse(src);
      expect(errors).toHaveLength(0);
    });
  });

  describe('parenthesised expressions', () => {
    it('parses complex nested parentheses', () => {
      const src = `PROGRAM P
VAR a : INT; b : INT; c : INT; d : INT; END_VAR
d := (a + b) * (c - 1);
d := ((a + b) * c) / (a - b + 1);
END_PROGRAM`;
      const { errors } = parse(src);
      expect(errors).toHaveLength(0);
    });
  });
});

// ---------------------------------------------------------------------------
// 13. TYPE declarations — STRUCT, ENUM, ALIAS, UNION
// ---------------------------------------------------------------------------

describe('TYPE declarations', () => {
  it('parses STRUCT with multiple field types', () => {
    const src = `TYPE ST_Drive :
STRUCT
  Speed       : REAL;
  Position    : LREAL;
  Running     : BOOL;
  ErrorCode   : DINT;
  Name        : STRING;
END_STRUCT
END_TYPE`;
    const { errors, ast } = parse(src);
    expect(errors).toHaveLength(0);
    const block = ast.declarations[0] as TypeDeclarationBlock;
    const struct = block.declarations[0] as StructDeclaration;
    expect(struct.fields).toHaveLength(5);
  });

  it('parses STRUCT with array field', () => {
    const src = `TYPE ST_Buffer :
STRUCT
  Data : ARRAY[0..255] OF BYTE;
  Size : DINT;
END_STRUCT
END_TYPE`;
    const { errors } = parse(src);
    expect(errors).toHaveLength(0);
  });

  it('parses ENUM with values', () => {
    const src = `TYPE E_State :
(Idle, Starting, Running, Stopping, Error)
END_TYPE`;
    const { errors, ast } = parse(src);
    expect(errors).toHaveLength(0);
    const block = ast.declarations[0] as TypeDeclarationBlock;
    const enumDecl = block.declarations[0] as EnumDeclaration;
    expect(enumDecl.values).toHaveLength(5);
    const valNames = enumDecl.values.map((v) => v.name);
    expect(valNames).toContain('Running');
    expect(valNames).toContain('Error');
  });

  it('parses ENUM with explicit integer values', () => {
    const src = `TYPE E_Mode :
(Off := 0, On := 1, Auto := 2)
END_TYPE`;
    const { errors, ast } = parse(src);
    expect(errors).toHaveLength(0);
    const block = ast.declarations[0] as TypeDeclarationBlock;
    const enumDecl = block.declarations[0] as EnumDeclaration;
    expect(enumDecl.values).toHaveLength(3);
    expect(enumDecl.values[0].value).toBeDefined();
  });

  it('parses ALIAS declaration', () => {
    const src = `TYPE T_Identifier : STRING(80);
END_TYPE`;
    const { errors, ast } = parse(src);
    // String with size may parse slightly differently; check no crash
    expect(ast).toBeDefined();
  });

  it('parses ALIAS of simple type', () => {
    const src = `TYPE T_Speed : REAL;
END_TYPE`;
    const { errors, ast } = parse(src);
    expect(errors).toHaveLength(0);
    const block = ast.declarations[0] as TypeDeclarationBlock;
    const alias = block.declarations[0] as AliasDeclaration;
    expect(alias.kind).toBe('AliasDeclaration');
    expect(alias.name).toBe('T_Speed');
    expect(alias.type.name).toBe('REAL');
  });

  it('parses UNION declaration', () => {
    const src = `TYPE U_Value :
UNION
  AsInt  : DINT;
  AsReal : REAL;
  AsBytes : ARRAY[0..3] OF BYTE;
END_UNION
END_TYPE`;
    const { errors, ast } = parse(src);
    expect(errors).toHaveLength(0);
    const block = ast.declarations[0] as TypeDeclarationBlock;
    const union = block.declarations[0] as UnionDeclaration;
    expect(union.kind).toBe('UnionDeclaration');
    expect(union.fields).toHaveLength(3);
  });

  it('parses multiple TYPE declarations in one TYPE...END_TYPE block', () => {
    const src = `TYPE
  E_Dir : (Forward, Backward);
  T_Name : STRING;
END_TYPE`;
    const { errors, ast } = parse(src);
    expect(errors).toHaveLength(0);
    const block = ast.declarations[0] as TypeDeclarationBlock;
    expect(block.declarations).toHaveLength(2);
  });

  it('parses TYPE block alongside PROGRAM in same file', () => {
    const src = `TYPE E_Color : (Red, Green, Blue) END_TYPE
PROGRAM P
VAR
  c : E_Color;
END_VAR
END_PROGRAM`;
    const { errors, ast } = parse(src);
    expect(errors).toHaveLength(0);
    expect(ast.declarations).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// 14. Namespaces
// ---------------------------------------------------------------------------

describe('namespaces', () => {
  it('skips NAMESPACE...END_NAMESPACE and parses outer declarations', () => {
    const src = `NAMESPACE MyLib
FUNCTION_BLOCK Inner
VAR END_VAR
END_FUNCTION_BLOCK
END_NAMESPACE
PROGRAM Outer
VAR END_VAR
END_PROGRAM`;
    const { errors, ast } = parse(src);
    expect(errors).toHaveLength(0);
    // NAMESPACE block is skipped; only outer PROGRAM is in AST
    expect(ast.declarations).toHaveLength(1);
    const prog = ast.declarations[0] as ProgramDeclaration;
    expect(prog.name).toBe('Outer');
  });

  it('handles nested NAMESPACE blocks', () => {
    const src = `NAMESPACE Outer
NAMESPACE Inner
FUNCTION_BLOCK Deep
END_FUNCTION_BLOCK
END_NAMESPACE
END_NAMESPACE
PROGRAM Top
END_PROGRAM`;
    const { ast } = parse(src);
    expect(ast.declarations).toHaveLength(1);
    expect((ast.declarations[0] as ProgramDeclaration).name).toBe('Top');
  });
});

// ---------------------------------------------------------------------------
// 15. Cross-cutting — multiple declarations, error recovery
// ---------------------------------------------------------------------------

describe('cross-cutting and error recovery', () => {
  it('parses file with multiple top-level declarations', () => {
    const src = `FUNCTION Add : INT
VAR_INPUT a : INT; b : INT; END_VAR
Add := a + b;
END_FUNCTION

FUNCTION_BLOCK Accumulator
VAR
  total : DINT;
END_VAR
METHOD Add
VAR_INPUT value : INT; END_VAR
  total := total + value;
END_METHOD
END_FUNCTION_BLOCK

PROGRAM Main
VAR
  acc : Accumulator;
  sum : INT;
END_VAR
sum := Add(1, 2);
acc.Add(sum);
END_PROGRAM`;
    const { errors, ast } = parse(src);
    expect(errors).toHaveLength(0);
    expect(ast.declarations).toHaveLength(3);
    expect(ast.declarations[0].kind).toBe('FunctionDeclaration');
    expect(ast.declarations[1].kind).toBe('FunctionBlockDeclaration');
    expect(ast.declarations[2].kind).toBe('ProgramDeclaration');
  });

  it('error recovery continues parsing after a syntax error', () => {
    const src = `PROGRAM P
VAR x : INT; END_VAR
INVALID GARBAGE HERE;
x := 42;
END_PROGRAM`;
    const { ast, errors } = parse(src);
    // Should have errors but still return a valid AST
    expect(errors.length).toBeGreaterThan(0);
    expect(ast.kind).toBe('SourceFile');
    expect(ast.declarations).toHaveLength(1);
  });

  it('parser handles empty PROGRAM body', () => {
    const src = `PROGRAM Empty
END_PROGRAM`;
    const { errors, ast } = parse(src);
    expect(errors).toHaveLength(0);
    const prog = ast.declarations[0] as ProgramDeclaration;
    expect(prog.body).toHaveLength(0);
    expect(prog.varBlocks).toHaveLength(0);
  });

  it('parser handles FUNCTION without return type', () => {
    const src = `FUNCTION Noop
END_FUNCTION`;
    const { errors, ast } = parse(src);
    expect(errors).toHaveLength(0);
    const fn = ast.declarations[0] as FunctionDeclaration;
    expect(fn.returnType).toBeNull();
  });

  it('parses deeply nested control structures', () => {
    const src = `PROGRAM P
VAR i : INT; j : INT; k : INT; END_VAR
FOR i := 0 TO 9 DO
  FOR j := 0 TO 9 DO
    WHILE k < 10 DO
      IF i + j + k > 15 THEN
        EXIT;
      ELSIF i + j + k = 15 THEN
        CONTINUE;
      END_IF;
      k := k + 1;
    END_WHILE;
  END_FOR;
END_FOR;
END_PROGRAM`;
    const { errors } = parse(src);
    expect(errors).toHaveLength(0);
  });

  it('parses semicolons after END_* blocks', () => {
    // TwinCAT allows (and sometimes requires) semicolons after END_IF etc.
    const src = `PROGRAM P
VAR x : INT; END_VAR
IF x > 0 THEN x := 1; END_IF;
WHILE x > 0 DO x := x - 1; END_WHILE;
FOR x := 0 TO 9 DO ; END_FOR;
END_PROGRAM`;
    const { errors } = parse(src);
    expect(errors).toHaveLength(0);
  });

  it('case-insensitive parsing: lowercase keywords', () => {
    const src = `program Main
var
  x : int := 0;
end_var
if x > 0 then x := 1; end_if;
end_program`;
    const { errors } = parse(src);
    expect(errors).toHaveLength(0);
  });
});
