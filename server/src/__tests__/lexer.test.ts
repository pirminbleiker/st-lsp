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
});
