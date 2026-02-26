import { describe, it, expect } from 'vitest';
import { format } from '../handlers/formatting';

const FMT = (src: string) => format(src, { tabSize: 2 });

describe('edge cases', () => {
  it('handles empty source', () => {
    const result = FMT('');
    expect(result).toBe('');
  });

  it('handles source without trailing newline', () => {
    const result = FMT('PROGRAM p\nEND_PROGRAM');
    expect(result).toContain('PROGRAM p');
    expect(result).toContain('END_PROGRAM');
  });

  it('handles only whitespace', () => {
    const result = FMT('   \n  \n\t\n');
    expect(result).toBeTruthy();
  });

  it('handles unary minus after binary operator (5 + -3)', () => {
    const result = FMT('PROGRAM p\nVAR x:INT;END_VAR\nx:=5+-3;\nEND_PROGRAM');
    expect(result).toContain('5 + -3');
  });

  it('handles double unary minus (--5)', () => {
    const result = FMT('PROGRAM p\nVAR x:INT;END_VAR\nx:=- -5;\nEND_PROGRAM');
    expect(result).toContain('- -5');
  });

  it('handles unary plus after assignment', () => {
    const result = FMT('PROGRAM p\nVAR x:INT;END_VAR\nx:=+5;\nEND_PROGRAM');
    expect(result).toContain(':= +5');
  });

  it('OF in ARRAY type does not cause indent increase', () => {
    const result = FMT('PROGRAM p\nVAR arr:ARRAY[1..10] OF INT;x:INT;END_VAR\nEND_PROGRAM');
    const lines = result.split('\n');
    const arrLine = lines.find(l => l.includes('ARRAY'));
    const xLine = lines.find(l => l.includes('x :'));
    
    expect(arrLine).toBeTruthy();
    expect(xLine).toBeTruthy();
    
    if (arrLine && xLine) {
      const arrIndent = arrLine.match(/^\s*/)?.[0].length ?? 0;
      const xIndent = xLine.match(/^\s*/)?.[0].length ?? 0;
      expect(arrIndent).toBe(xIndent);
    }
  });

  it('single-line VAR block does not affect statement indent', () => {
    const result = FMT('PROGRAM p\nVAR x:INT; END_VAR\nx:=1;\nEND_PROGRAM');
    const lines = result.split('\n');
    const varLine = lines.find(l => l.includes('VAR'));
    const stmtLine = lines.find(l => l.includes('x := 1'));
    
    expect(varLine).toBeTruthy();
    expect(stmtLine).toBeTruthy();
    
    if (varLine && stmtLine) {
      const varIndent = varLine.match(/^\s*/)?.[0].length ?? 0;
      const stmtIndent = stmtLine.match(/^\s*/)?.[0].length ?? 0;
      expect(varIndent).toBe(stmtIndent);
    }
  });

  it('handles CRLF line endings', () => {
    const result = FMT('PROGRAM p\r\nEND_PROGRAM');
    expect(result).toContain('PROGRAM p');
    expect(result).toContain('END_PROGRAM');
  });

  it('handles mixed line endings', () => {
    const result = FMT('PROGRAM p\r\nVAR x:INT;END_VAR\nx:=1;\nEND_PROGRAM');
    expect(result).toContain('PROGRAM p');
    expect(result).toContain('END_PROGRAM');
  });

  it('handles range operator (1..10)', () => {
    const result = FMT('PROGRAM p\nVAR arr:ARRAY[1..10]OF INT;END_VAR\nEND_PROGRAM');
    expect(result).toContain('1..10');
  });

  it('handles escaped characters in strings', () => {
    const result = FMT('PROGRAM p\nVAR s:STRING;END_VAR\ns:="test$"quote";\nEND_PROGRAM');
    expect(result).toContain('$"');
  });

  it('limits consecutive blank lines to 1', () => {
    const result = FMT('PROGRAM p\n\n\n\nEND_PROGRAM');
    const lines = result.split('\n');
    let maxConsecutiveBlank = 0;
    let currentConsecutiveBlank = 0;
    for (const line of lines) {
      if (line.trim() === '') {
        currentConsecutiveBlank++;
        maxConsecutiveBlank = Math.max(maxConsecutiveBlank, currentConsecutiveBlank);
      } else {
        currentConsecutiveBlank = 0;
      }
    }
    expect(maxConsecutiveBlank).toBeLessThanOrEqual(1);
  });

  it('handles unclosed block comment', () => {
    const result = FMT('PROGRAM p\n(* comment\nEND_PROGRAM');
    expect(result).toBeTruthy();
  });

  it('handles unclosed string', () => {
    const result = FMT('PROGRAM p\nVAR s:STRING;END_VAR\ns:="hello\nEND_PROGRAM');
    expect(result).toBeTruthy();
  });
});
