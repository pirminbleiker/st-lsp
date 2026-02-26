import { describe, it, expect } from 'vitest';
import { format } from '../handlers/formatting';

const FMT = (src: string) => format(src, { tabSize: 2 });

// ---------------------------------------------------------------------------
// Keyword uppercasing
// ---------------------------------------------------------------------------

describe('keyword uppercasing', () => {
  it('uppercases IF/THEN/END_IF', () => {
    const src = 'if x then\nx := 1;\nend_if';
    const out = FMT(src);
    expect(out).toContain('IF x THEN');
    expect(out).toContain('END_IF');
  });

  it('uppercases PROGRAM/END_PROGRAM', () => {
    const out = FMT('program main\nend_program');
    expect(out).toMatch(/^PROGRAM/);
    expect(out).toContain('END_PROGRAM');
  });

  it('uppercases VAR/END_VAR', () => {
    const out = FMT('program p\nvar\n  x : INT;\nend_var\nend_program');
    expect(out).toContain('VAR');
    expect(out).toContain('END_VAR');
  });

  it('preserves identifier case', () => {
    const out = FMT('PROGRAM Main\nEND_PROGRAM');
    expect(out).toContain('Main');
  });

  it('preserves string literal content', () => {
    const src = "PROGRAM p\nVAR s : STRING; END_VAR\ns := 'hello if then';\nEND_PROGRAM";
    const out = FMT(src);
    expect(out).toContain("'hello if then'");
  });

  it('preserves line comment content', () => {
    const src = 'PROGRAM p\n// if this is a comment\nEND_PROGRAM';
    const out = FMT(src);
    expect(out).toContain('// if this is a comment');
  });

  it('preserves block comment content', () => {
    const src = 'PROGRAM p\n(* var x := if *)\nEND_PROGRAM';
    const out = FMT(src);
    expect(out).toContain('(* var x := if *)');
  });
});

// ---------------------------------------------------------------------------
// Indentation — PROGRAM / VAR block
// ---------------------------------------------------------------------------

describe('indentation — PROGRAM with VAR block', () => {
  const src = [
    'program main',
    'var',
    'x : INT := 0;',
    'y : BOOL;',
    'end_var',
    'x := 1;',
    'end_program',
  ].join('\n');

  it('PROGRAM header at indent 0', () => {
    const out = FMT(src);
    expect(out.split('\n')[0]).toBe('PROGRAM main');
  });

  it('VAR at indent 1', () => {
    const lines = FMT(src).split('\n');
    const varLine = lines.find(l => l.trimStart().startsWith('VAR'));
    expect(varLine).toBe('  VAR');
  });

  it('variable declarations at indent 2', () => {
    const lines = FMT(src).split('\n');
    const xLine = lines.find(l => l.includes('x : INT'));
    expect(xLine?.startsWith('    ')).toBe(true);
  });

  it('END_VAR at indent 1', () => {
    const lines = FMT(src).split('\n');
    const evLine = lines.find(l => l.trimStart().startsWith('END_VAR'));
    expect(evLine).toBe('  END_VAR');
  });

  it('body statement at indent 1', () => {
    const lines = FMT(src).split('\n');
    const stmtLine = lines.find(l => l.includes('x := 1'));
    expect(stmtLine).toBe('  x := 1;');
  });

  it('END_PROGRAM at indent 0', () => {
    const lines = FMT(src).split('\n');
    const last = lines.find(l => l.startsWith('END_PROGRAM'));
    expect(last).toBe('END_PROGRAM');
  });
});

// ---------------------------------------------------------------------------
// Indentation — IF / ELSE / ELSIF / END_IF
// ---------------------------------------------------------------------------

describe('indentation — IF statement', () => {
  const src = [
    'PROGRAM p',
    'VAR x : INT; END_VAR',
    'if x > 0 then',
    'x := x - 1;',
    'elsif x < -5 then',
    'x := -5;',
    'else',
    'x := 0;',
    'end_if',
    'END_PROGRAM',
  ].join('\n');

  it('IF at body indent (1)', () => {
    const lines = FMT(src).split('\n');
    const ifLine = lines.find(l => l.trimStart().startsWith('IF'));
    expect(ifLine).toBe('  IF x > 0 THEN');
  });

  it('IF body at indent 2', () => {
    const lines = FMT(src).split('\n');
    // First x := x - 1 after IF
    const bodyLine = lines.find(l => l.includes('x - 1'));
    expect(bodyLine?.startsWith('    ')).toBe(true);
  });

  it('ELSIF at indent 1', () => {
    const lines = FMT(src).split('\n');
    const elsifLine = lines.find(l => l.trimStart().startsWith('ELSIF'));
    expect(elsifLine).toBe('  ELSIF x < -5 THEN');
  });

  it('ELSE at indent 1', () => {
    const lines = FMT(src).split('\n');
    const elseLine = lines.find(l => l.trim() === 'ELSE');
    expect(elseLine).toBe('  ELSE');
  });

  it('ELSE body at indent 2', () => {
    const lines = FMT(src).split('\n');
    const elseBodyLine = lines.find(l => l.includes('x := 0'));
    expect(elseBodyLine?.startsWith('    ')).toBe(true);
  });

  it('END_IF at indent 1', () => {
    const lines = FMT(src).split('\n');
    const endIfLine = lines.find(l => l.trimStart().startsWith('END_IF'));
    expect(endIfLine).toBe('  END_IF');
  });
});

// ---------------------------------------------------------------------------
// Indentation — FOR loop
// ---------------------------------------------------------------------------

describe('indentation — FOR loop', () => {
  const src = [
    'PROGRAM p',
    'VAR i : INT; END_VAR',
    'for i := 0 to 9 do',
    'i := i + 1;',
    'end_for',
    'END_PROGRAM',
  ].join('\n');

  it('FOR at indent 1', () => {
    const lines = FMT(src).split('\n');
    const forLine = lines.find(l => l.trimStart().startsWith('FOR'));
    expect(forLine).toBe('  FOR i := 0 TO 9 DO');
  });

  it('FOR body at indent 2', () => {
    const lines = FMT(src).split('\n');
    const bodyLine = lines.find(l => l.includes('i + 1'));
    expect(bodyLine?.startsWith('    ')).toBe(true);
  });

  it('END_FOR at indent 1', () => {
    const lines = FMT(src).split('\n');
    const endForLine = lines.find(l => l.trimStart().startsWith('END_FOR'));
    expect(endForLine).toBe('  END_FOR');
  });
});

// ---------------------------------------------------------------------------
// Indentation — WHILE loop
// ---------------------------------------------------------------------------

describe('indentation — WHILE loop', () => {
  const src = [
    'PROGRAM p',
    'VAR x : INT; END_VAR',
    'while x > 0 do',
    'x := x - 1;',
    'end_while',
    'END_PROGRAM',
  ].join('\n');

  it('WHILE at indent 1', () => {
    const lines = FMT(src).split('\n');
    const whileLine = lines.find(l => l.trimStart().startsWith('WHILE'));
    expect(whileLine).toBe('  WHILE x > 0 DO');
  });

  it('END_WHILE at indent 1', () => {
    const lines = FMT(src).split('\n');
    const endLine = lines.find(l => l.trimStart().startsWith('END_WHILE'));
    expect(endLine).toBe('  END_WHILE');
  });
});

// ---------------------------------------------------------------------------
// Indentation — REPEAT loop
// ---------------------------------------------------------------------------

describe('indentation — REPEAT loop', () => {
  const src = [
    'PROGRAM p',
    'VAR x : INT; END_VAR',
    'repeat',
    'x := x - 1;',
    'until x = 0;',
    'END_PROGRAM',
  ].join('\n');

  it('REPEAT at indent 1', () => {
    const lines = FMT(src).split('\n');
    const repeatLine = lines.find(l => l.trim() === 'REPEAT');
    expect(repeatLine).toBe('  REPEAT');
  });

  it('REPEAT body at indent 2', () => {
    const lines = FMT(src).split('\n');
    const bodyLine = lines.find(l => l.includes('x - 1'));
    expect(bodyLine?.startsWith('    ')).toBe(true);
  });

  it('UNTIL at indent 1', () => {
    const lines = FMT(src).split('\n');
    const untilLine = lines.find(l => l.trimStart().startsWith('UNTIL'));
    expect(untilLine).toBe('  UNTIL x = 0;');
  });
});

// ---------------------------------------------------------------------------
// Indentation — CASE statement
// ---------------------------------------------------------------------------

describe('indentation — CASE statement', () => {
  const src = [
    'PROGRAM p',
    'VAR x : INT; END_VAR',
    'case x of',
    '1: x := 10;',
    '2: x := 20;',
    'else',
    'x := 0;',
    'end_case',
    'END_PROGRAM',
  ].join('\n');

  it('CASE at indent 1', () => {
    const lines = FMT(src).split('\n');
    const caseLine = lines.find(l => l.trimStart().startsWith('CASE'));
    expect(caseLine).toBe('  CASE x OF');
  });

  it('case labels at indent 2', () => {
    const lines = FMT(src).split('\n');
    const label1 = lines.find(l => l.includes('1 :') || l.includes('1:'));
    expect(label1?.startsWith('    ')).toBe(true);
  });

  it('END_CASE at indent 1', () => {
    const lines = FMT(src).split('\n');
    const endCaseLine = lines.find(l => l.trimStart().startsWith('END_CASE'));
    expect(endCaseLine).toBe('  END_CASE');
  });
});

// ---------------------------------------------------------------------------
// Indentation — nested IF
// ---------------------------------------------------------------------------

describe('indentation — nested IF', () => {
  const src = [
    'PROGRAM p',
    'VAR x : INT; END_VAR',
    'if x > 0 then',
    'if x > 5 then',
    'x := 5;',
    'end_if',
    'end_if',
    'END_PROGRAM',
  ].join('\n');

  it('outer IF at indent 1', () => {
    const lines = FMT(src).split('\n');
    expect(lines.filter(l => l.trimStart().startsWith('IF'))[0]).toBe('  IF x > 0 THEN');
  });

  it('inner IF at indent 2', () => {
    const lines = FMT(src).split('\n');
    expect(lines.filter(l => l.trimStart().startsWith('IF'))[1]).toBe('    IF x > 5 THEN');
  });

  it('inner body at indent 3', () => {
    const lines = FMT(src).split('\n');
    const bodyLine = lines.find(l => l.includes('x := 5'));
    expect(bodyLine?.startsWith('      ')).toBe(true);
  });

  it('inner END_IF at indent 2', () => {
    const lines = FMT(src).split('\n');
    expect(lines.filter(l => l.trimStart().startsWith('END_IF'))[0]).toBe('    END_IF');
  });

  it('outer END_IF at indent 1', () => {
    const lines = FMT(src).split('\n');
    expect(lines.filter(l => l.trimStart().startsWith('END_IF'))[1]).toBe('  END_IF');
  });
});

// ---------------------------------------------------------------------------
// Operator spacing
// ---------------------------------------------------------------------------

describe('operator spacing', () => {
  it('spaces around :=', () => {
    const out = FMT('PROGRAM p\nVAR x:INT;END_VAR\nx:=1;\nEND_PROGRAM');
    expect(out).toContain('x := 1');
  });

  it('spaces around comparison operators', () => {
    const out = FMT('PROGRAM p\nVAR x:INT;END_VAR\nif x>0 then\nx:=1;\nend_if\nEND_PROGRAM');
    expect(out).toContain('x > 0');
  });

  it('spaces around arithmetic operators', () => {
    const out = FMT('PROGRAM p\nVAR x:INT;END_VAR\nx:=x+1;\nEND_PROGRAM');
    expect(out).toContain('x + 1');
  });

  it('no space before semicolon', () => {
    const out = FMT('PROGRAM p\nVAR x:INT;END_VAR\nx:=1;\nEND_PROGRAM');
    expect(out).not.toContain(' ;');
  });

  it('no space before comma', () => {
    const out = FMT('PROGRAM p\nVAR x:INT;END_VAR\nMyFB(a:=1,b:=2);\nEND_PROGRAM');
    expect(out).not.toContain(' ,');
  });

  it('unary minus: no space between - and operand', () => {
    const out = FMT('PROGRAM p\nVAR x:INT;END_VAR\nx:=-5;\nEND_PROGRAM');
    expect(out).toContain(':= -5');
    expect(out).not.toContain(':= - 5');
  });

  it('no space inside parentheses', () => {
    const out = FMT('PROGRAM p\nVAR x:INT;END_VAR\nx:=(1+2)*3;\nEND_PROGRAM');
    expect(out).toContain('(1 + 2)');
    expect(out).not.toContain('( 1');
    expect(out).not.toContain('2 )');
  });

  it('no space before ( in function call', () => {
    const out = FMT('PROGRAM p\nVAR x:INT;END_VAR\nx:=MyFunc(1);\nEND_PROGRAM');
    expect(out).toContain('MyFunc(1)');
  });

  it('ARRAY type OF not indenting next line', () => {
    // OF in the middle of a line (array type) should NOT trigger indent increase
    const src = [
      'PROGRAM p',
      'VAR',
      '  arr : ARRAY [1..10] OF INT;',
      'END_VAR',
      'END_PROGRAM',
    ].join('\n');
    const lines = FMT(src).split('\n');
    const arrLine = lines.find(l => l.includes('ARRAY'));
    expect(arrLine?.startsWith('    ')).toBe(true); // indent 2 inside VAR
    // END_VAR should still be at indent 1
    const evLine = lines.find(l => l.trimStart().startsWith('END_VAR'));
    expect(evLine).toBe('  END_VAR');
  });
});

// ---------------------------------------------------------------------------
// Blank line collapsing
// ---------------------------------------------------------------------------

describe('blank line collapsing', () => {
  it('preserves a single blank line', () => {
    const src = 'PROGRAM p\nVAR x:INT;END_VAR\n\nx:=1;\nEND_PROGRAM';
    const out = FMT(src);
    expect(out).toContain('\n\n');
  });

  it('collapses multiple blank lines to one', () => {
    const src = 'PROGRAM p\nVAR x:INT;END_VAR\n\n\n\nx:=1;\nEND_PROGRAM';
    const out = FMT(src);
    // Should not have 3+ consecutive newlines (which would mean 2+ blank lines)
    expect(out).not.toMatch(/\n\n\n/);
  });
});

// ---------------------------------------------------------------------------
// FUNCTION_BLOCK with METHOD
// ---------------------------------------------------------------------------

describe('indentation — FUNCTION_BLOCK with METHOD', () => {
  const src = [
    'function_block MyFB',
    'var',
    'x : INT;',
    'end_var',
    'method M : INT',
    'var_input',
    'a : INT;',
    'end_var',
    'M := a;',
    'end_method',
    'end_function_block',
  ].join('\n');

  it('FUNCTION_BLOCK at indent 0', () => {
    const lines = FMT(src).split('\n');
    expect(lines[0]).toBe('FUNCTION_BLOCK MyFB');
  });

  it('METHOD at indent 1', () => {
    const lines = FMT(src).split('\n');
    const mLine = lines.find(l => l.trimStart().startsWith('METHOD'));
    expect(mLine).toBe('  METHOD M : INT');
  });

  it('METHOD VAR_INPUT at indent 2', () => {
    const lines = FMT(src).split('\n');
    const viLine = lines.find(l => l.trimStart().startsWith('VAR_INPUT'));
    expect(viLine).toBe('    VAR_INPUT');
  });

  it('METHOD body at indent 2', () => {
    const lines = FMT(src).split('\n');
    const bodyLine = lines.find(l => l.includes('M :='));
    expect(bodyLine).toBe('    M := a;');
  });

  it('END_METHOD at indent 1', () => {
    const lines = FMT(src).split('\n');
    const emLine = lines.find(l => l.trimStart().startsWith('END_METHOD'));
    expect(emLine).toBe('  END_METHOD');
  });

  it('END_FUNCTION_BLOCK at indent 0', () => {
    const lines = FMT(src).split('\n');
    const efbLine = lines.find(l => l.startsWith('END_FUNCTION_BLOCK'));
    expect(efbLine).toBe('END_FUNCTION_BLOCK');
  });
});

// ---------------------------------------------------------------------------
// configurable tabSize
// ---------------------------------------------------------------------------

describe('configurable tabSize', () => {
  it('uses 4-space indent when tabSize=4', () => {
    const src = 'PROGRAM p\nVAR\nx : INT;\nEND_VAR\nEND_PROGRAM';
    const out = format(src, { tabSize: 4 });
    const varLine = out.split('\n').find(l => l.trimStart().startsWith('VAR'));
    expect(varLine).toBe('    VAR');
  });
});
