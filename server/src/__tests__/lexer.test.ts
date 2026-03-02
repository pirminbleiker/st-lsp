import { describe, it, expect } from 'vitest';
import { Lexer, TokenKind } from '../parser/lexer';

function tokenize(src: string) {
  return new Lexer(src).tokenize();
}

describe('Lexer', () => {
  describe('PROGRAM Main END_PROGRAM', () => {
    it('produces PROGRAM, IDENTIFIER, END_PROGRAM, EOF tokens', () => {
      const tokens = tokenize('PROGRAM Main END_PROGRAM');
      expect(tokens).toHaveLength(4);
      expect(tokens[0].kind).toBe(TokenKind.PROGRAM);
      expect(tokens[1].kind).toBe(TokenKind.IDENTIFIER);
      expect(tokens[1].text).toBe('Main');
      expect(tokens[2].kind).toBe(TokenKind.END_PROGRAM);
      expect(tokens[3].kind).toBe(TokenKind.EOF);
    });
  });

  describe('case-insensitive keywords', () => {
    it('lowercase "program" tokenizes as PROGRAM', () => {
      const tokens = tokenize('program');
      expect(tokens[0].kind).toBe(TokenKind.PROGRAM);
    });

    it('mixed-case "End_Program" tokenizes as END_PROGRAM', () => {
      const tokens = tokenize('End_Program');
      expect(tokens[0].kind).toBe(TokenKind.END_PROGRAM);
    });

    it('lowercase "if" tokenizes as IF', () => {
      const tokens = tokenize('if');
      expect(tokens[0].kind).toBe(TokenKind.IF);
    });
  });

  describe('integer literals', () => {
    it('tokenizes 42 as INTEGER', () => {
      const tokens = tokenize('42');
      expect(tokens[0].kind).toBe(TokenKind.INTEGER);
      expect(tokens[0].text).toBe('42');
    });

    it('tokenizes 1_000 as INTEGER (with underscore separator)', () => {
      const tokens = tokenize('1_000');
      expect(tokens[0].kind).toBe(TokenKind.INTEGER);
      expect(tokens[0].text).toBe('1_000');
    });
  });

  describe('real literals', () => {
    it('tokenizes 3.14 as REAL', () => {
      const tokens = tokenize('3.14');
      expect(tokens[0].kind).toBe(TokenKind.REAL);
      expect(tokens[0].text).toBe('3.14');
    });

    it('tokenizes 1.5e10 as REAL', () => {
      const tokens = tokenize('1.5e10');
      expect(tokens[0].kind).toBe(TokenKind.REAL);
      expect(tokens[0].text).toBe('1.5e10');
    });
  });

  describe('string literals', () => {
    it("tokenizes 'hello' as STRING", () => {
      const tokens = tokenize("'hello'");
      expect(tokens[0].kind).toBe(TokenKind.STRING);
      // The text includes the surrounding quotes
      expect(tokens[0].text).toContain('hello');
    });

    it('tokenizes "world" as STRING', () => {
      const tokens = tokenize('"world"');
      expect(tokens[0].kind).toBe(TokenKind.STRING);
      expect(tokens[0].text).toContain('world');
    });
  });

  describe('comments', () => {
    it('skips block comments (* ... *)', () => {
      const tokens = tokenize('(* this is a comment *) 42');
      expect(tokens[0].kind).toBe(TokenKind.INTEGER);
      expect(tokens[0].text).toBe('42');
    });

    it('skips line comments // ...', () => {
      const tokens = tokenize('// this is a line comment\n42');
      expect(tokens[0].kind).toBe(TokenKind.INTEGER);
      expect(tokens[0].text).toBe('42');
    });

    it('skips multi-line block comments', () => {
      const tokens = tokenize('(* line 1\n   line 2 *) x');
      expect(tokens[0].kind).toBe(TokenKind.IDENTIFIER);
      expect(tokens[0].text).toBe('x');
    });
  });

  describe('operators', () => {
    it(':= tokenizes as ASSIGN', () => {
      const tokens = tokenize(':=');
      expect(tokens[0].kind).toBe(TokenKind.ASSIGN);
      expect(tokens[0].text).toBe(':=');
    });

    it('=> tokenizes as OUTPUT_ASSIGN', () => {
      const tokens = tokenize('=>');
      expect(tokens[0].kind).toBe(TokenKind.OUTPUT_ASSIGN);
      expect(tokens[0].text).toBe('=>');
    });

    it('** tokenizes as POWER', () => {
      const tokens = tokenize('**');
      expect(tokens[0].kind).toBe(TokenKind.POWER);
      expect(tokens[0].text).toBe('**');
    });

    it('.. tokenizes as DOTDOT', () => {
      const tokens = tokenize('..');
      expect(tokens[0].kind).toBe(TokenKind.DOTDOT);
      expect(tokens[0].text).toBe('..');
    });

    it('<> tokenizes as NEQ', () => {
      const tokens = tokenize('<>');
      expect(tokens[0].kind).toBe(TokenKind.NEQ);
      expect(tokens[0].text).toBe('<>');
    });

    it('<= tokenizes as LTE', () => {
      const tokens = tokenize('<=');
      expect(tokens[0].kind).toBe(TokenKind.LTE);
    });

    it('>= tokenizes as GTE', () => {
      const tokens = tokenize('>=');
      expect(tokens[0].kind).toBe(TokenKind.GTE);
    });
  });

  describe('token ranges', () => {
    it('PROGRAM on line 0 starts at character 0', () => {
      const tokens = tokenize('PROGRAM');
      expect(tokens[0].range.start.line).toBe(0);
      expect(tokens[0].range.start.character).toBe(0);
    });

    it('identifier on second line has correct line number', () => {
      const tokens = tokenize('PROGRAM\nMain');
      // Main is on line 1
      expect(tokens[1].range.start.line).toBe(1);
      expect(tokens[1].range.start.character).toBe(0);
    });

    it('second token on first line has correct character offset', () => {
      const tokens = tokenize('IF x');
      // 'x' starts at character 3 (after "IF ")
      expect(tokens[1].range.start.line).toBe(0);
      expect(tokens[1].range.start.character).toBe(3);
    });
  });

  describe('new keywords (Phase 2)', () => {
    it('tokenizes VAR_CONFIG as VAR_CONFIG', () => {
      const tokens = tokenize('VAR_CONFIG');
      expect(tokens[0].kind).toBe(TokenKind.VAR_CONFIG);
    });

    it('tokenizes NAMESPACE as NAMESPACE', () => {
      const tokens = tokenize('NAMESPACE');
      expect(tokens[0].kind).toBe(TokenKind.NAMESPACE);
    });

    it('tokenizes END_NAMESPACE as END_NAMESPACE', () => {
      const tokens = tokenize('END_NAMESPACE');
      expect(tokens[0].kind).toBe(TokenKind.END_NAMESPACE);
    });

    it('tokenizes UNION as UNION', () => {
      const tokens = tokenize('UNION');
      expect(tokens[0].kind).toBe(TokenKind.UNION);
    });

    it('tokenizes END_UNION as END_UNION', () => {
      const tokens = tokenize('END_UNION');
      expect(tokens[0].kind).toBe(TokenKind.END_UNION);
    });
  });

  describe('pragma tokens', () => {
    it('tokenizes {attribute \'hide\'} as PRAGMA', () => {
      const tokens = tokenize("{attribute 'hide'}");
      expect(tokens[0].kind).toBe(TokenKind.PRAGMA);
      expect(tokens[0].text).toBe("{attribute 'hide'}");
    });

    it('tokenizes {attribute \'monitoring\' := \'call\'} as PRAGMA', () => {
      const tokens = tokenize("{attribute 'monitoring' := 'call'}");
      expect(tokens[0].kind).toBe(TokenKind.PRAGMA);
      expect(tokens[0].text).toBe("{attribute 'monitoring' := 'call'}");
    });

    it('pragma token has correct range', () => {
      const tokens = tokenize("{attribute 'hide'}");
      expect(tokens[0].range.start).toEqual({ line: 0, character: 0 });
      expect(tokens[0].range.end.character).toBeGreaterThan(0);
    });

    it('pragma followed by identifier tokenizes both', () => {
      const tokens = tokenize("{attribute 'hide'} myVar");
      expect(tokens[0].kind).toBe(TokenKind.PRAGMA);
      expect(tokens[1].kind).toBe(TokenKind.IDENTIFIER);
      expect(tokens[1].text).toBe('myVar');
    });
  });

  describe('typed literals (Phase 1)', () => {
    it('tokenizes SINT#-128 as a single INTEGER token', () => {
      const tokens = tokenize('SINT#-128');
      expect(tokens).toHaveLength(2);
      expect(tokens[0].kind).toBe(TokenKind.INTEGER);
      expect(tokens[0].text).toBe('SINT#-128');
    });

    it('tokenizes LREAL#1.79E+308 as a single REAL token', () => {
      const tokens = tokenize('LREAL#1.79E+308');
      expect(tokens).toHaveLength(2);
      expect(tokens[0].kind).toBe(TokenKind.REAL);
      expect(tokens[0].text).toBe('LREAL#1.79E+308');
    });

    it('tokenizes DWORD#16#FFFFFFFF as a single INTEGER token', () => {
      const tokens = tokenize('DWORD#16#FFFFFFFF');
      expect(tokens).toHaveLength(2);
      expect(tokens[0].kind).toBe(TokenKind.INTEGER);
      expect(tokens[0].text).toBe('DWORD#16#FFFFFFFF');
    });

    it('tokenizes DATE#1970-1-1 as a single token', () => {
      const tokens = tokenize('DATE#1970-1-1');
      expect(tokens).toHaveLength(2);
      expect(tokens[0].text).toBe('DATE#1970-1-1');
    });

    it('tokenizes DT#1970-1-1-0:0:0 as a single token', () => {
      const tokens = tokenize('DT#1970-1-1-0:0:0');
      expect(tokens).toHaveLength(2);
      expect(tokens[0].text).toBe('DT#1970-1-1-0:0:0');
    });

    it('tokenizes TOD#23:59:59.999 as a single token', () => {
      const tokens = tokenize('TOD#23:59:59.999');
      expect(tokens).toHaveLength(2);
      expect(tokens[0].text).toBe('TOD#23:59:59.999');
    });

    it('tokenizes T#49D17H2M47S295MS as a single token', () => {
      const tokens = tokenize('T#49D17H2M47S295MS');
      expect(tokens).toHaveLength(2);
      expect(tokens[0].text).toBe('T#49D17H2M47S295MS');
    });

    it('keeps BYTE#0 tokenization working', () => {
      const tokens = tokenize('BYTE#0');
      expect(tokens).toHaveLength(2);
      expect(tokens[0].kind).toBe(TokenKind.INTEGER);
      expect(tokens[0].text).toBe('BYTE#0');
    });

    it('does not regress normal subtraction tokenization', () => {
      const tokens = tokenize('a - b');
      expect(tokens).toHaveLength(4);
      expect(tokens[0].kind).toBe(TokenKind.IDENTIFIER);
      expect(tokens[1].kind).toBe(TokenKind.MINUS);
      expect(tokens[2].kind).toBe(TokenKind.IDENTIFIER);
    });

    it('does not swallow subtraction after typed numeric literal', () => {
      const tokens = tokenize('SINT#128-2');
      expect(tokens).toHaveLength(4);
      expect(tokens[0].text).toBe('SINT#128');
      expect(tokens[1].kind).toBe(TokenKind.MINUS);
      expect(tokens[2].text).toBe('2');
    });

    it('does not swallow subtraction after TOD typed literal', () => {
      const tokens = tokenize('TOD#23:59:59.999-1');
      expect(tokens).toHaveLength(4);
      expect(tokens[0].text).toBe('TOD#23:59:59.999');
      expect(tokens[1].kind).toBe(TokenKind.MINUS);
      expect(tokens[2].kind).toBe(TokenKind.INTEGER);
      expect(tokens[2].text).toBe('1');
    });

    it('does not swallow subtraction after DT typed literal', () => {
      const tokens = tokenize('DT#1970-1-1-0:0:0-1');
      expect(tokens).toHaveLength(4);
      expect(tokens[0].text).toBe('DT#1970-1-1-0:0:0');
      expect(tokens[1].kind).toBe(TokenKind.MINUS);
      expect(tokens[2].kind).toBe(TokenKind.INTEGER);
      expect(tokens[2].text).toBe('1');
    });

    it('does not swallow addition after T typed literal', () => {
      const tokens = tokenize('T#49D17H2M47S295MS+1');
      expect(tokens).toHaveLength(4);
      expect(tokens[0].text).toBe('T#49D17H2M47S295MS');
      expect(tokens[1].kind).toBe(TokenKind.PLUS);
      expect(tokens[2].kind).toBe(TokenKind.INTEGER);
      expect(tokens[2].text).toBe('1');
    });
  });
});
