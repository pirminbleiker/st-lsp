import { describe, it, expect } from 'vitest';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { handleSemanticTokens, TOKEN_TYPES, TOKEN_MODIFIERS } from '../handlers/semanticTokens';
import { Lexer, TokenKind } from '../parser/lexer';

function makeDoc(content: string): TextDocument {
  return TextDocument.create('file:///test.st', 'st', 1, content);
}

/** Decode the raw SemanticTokens data array into structured token entries. */
function decodeTokens(data: number[]): Array<{
  line: number;
  char: number;
  length: number;
  tokenType: string;
  modifiers: string[];
}> {
  const result = [];
  let prevLine = 0;
  let prevChar = 0;
  for (let i = 0; i < data.length; i += 5) {
    const deltaLine = data[i];
    const deltaChar = data[i + 1];
    const length = data[i + 2];
    const typeIdx = data[i + 3];
    const modBits = data[i + 4];

    const line = prevLine + deltaLine;
    const char = deltaLine === 0 ? prevChar + deltaChar : deltaChar;
    prevLine = line;
    prevChar = char;

    const modifiers: string[] = [];
    for (let b = 0; b < TOKEN_MODIFIERS.length; b++) {
      if (modBits & (1 << b)) modifiers.push(TOKEN_MODIFIERS[b]);
    }

    result.push({ line, char, length, tokenType: TOKEN_TYPES[typeIdx], modifiers });
  }
  return result;
}

describe('handleSemanticTokens', () => {
  describe('keywords', () => {
    it('marks PROGRAM and END_PROGRAM as keyword', () => {
      const doc = makeDoc('PROGRAM Main\nEND_PROGRAM');
      const { data } = handleSemanticTokens(doc);
      const tokens = decodeTokens(data);
      const keywords = tokens.filter(t => t.tokenType === 'keyword');
      expect(keywords.some(t => t.line === 0 && t.char === 0 && t.length === 7)).toBe(true); // PROGRAM
      expect(keywords.some(t => t.line === 1 && t.char === 0)).toBe(true); // END_PROGRAM
    });
  });

  describe('POU name as function with declaration modifier', () => {
    it('marks PROGRAM name as function+declaration', () => {
      const doc = makeDoc('PROGRAM MyProg\nEND_PROGRAM');
      const { data } = handleSemanticTokens(doc);
      const tokens = decodeTokens(data);
      const nameToken = tokens.find(t => t.line === 0 && t.char === 8);
      expect(nameToken).toBeDefined();
      expect(nameToken!.tokenType).toBe('function');
      expect(nameToken!.modifiers).toContain('declaration');
    });
  });

  describe('builtin types', () => {
    it('marks INT as type+defaultLibrary', () => {
      const src = 'PROGRAM P\nVAR x : INT; END_VAR\nEND_PROGRAM';
      const doc = makeDoc(src);
      const { data } = handleSemanticTokens(doc);
      const tokens = decodeTokens(data);
      const intToken = tokens.find(t => t.tokenType === 'type' && t.modifiers.includes('defaultLibrary'));
      expect(intToken).toBeDefined();
      expect(intToken!.length).toBe(3); // "INT"
    });
  });

  describe('variable declarations', () => {
    it('marks declared variable name as variable+declaration', () => {
      const src = 'PROGRAM P\nVAR myVar : BOOL; END_VAR\nEND_PROGRAM';
      const doc = makeDoc(src);
      const { data } = handleSemanticTokens(doc);
      const tokens = decodeTokens(data);
      // myVar is declared in VAR block → variable + declaration
      const varToken = tokens.find(
        t => t.tokenType === 'variable' && t.modifiers.includes('declaration'),
      );
      expect(varToken).toBeDefined();
      expect(varToken!.length).toBe(5); // "myVar"
    });
  });

  describe('parameter declarations', () => {
    it('marks VAR_INPUT variable as parameter', () => {
      const src = [
        'FUNCTION_BLOCK MyFB',
        'VAR_INPUT',
        '  inVal : INT;',
        'END_VAR',
        'END_FUNCTION_BLOCK',
      ].join('\n');
      const doc = makeDoc(src);
      const { data } = handleSemanticTokens(doc);
      const tokens = decodeTokens(data);
      const paramToken = tokens.find(t => t.tokenType === 'parameter');
      expect(paramToken).toBeDefined();
      expect(paramToken!.length).toBe(5); // "inVal"
      expect(paramToken!.modifiers).toContain('declaration');
    });
  });

  describe('numbers and strings', () => {
    it('marks integer literal as number', () => {
      const doc = makeDoc('PROGRAM P\nVAR x : INT := 42; END_VAR\nEND_PROGRAM');
      const { data } = handleSemanticTokens(doc);
      const tokens = decodeTokens(data);
      expect(tokens.some(t => t.tokenType === 'number' && t.length === 2)).toBe(true); // "42"
    });

    it('marks string literal as string', () => {
      const doc = makeDoc("PROGRAM P\nVAR s : STRING := 'hello'; END_VAR\nEND_PROGRAM");
      const { data } = handleSemanticTokens(doc);
      const tokens = decodeTokens(data);
      expect(tokens.some(t => t.tokenType === 'string')).toBe(true);
    });
  });

  describe('comments', () => {
    it('marks line comment as comment', () => {
      const doc = makeDoc('// This is a comment\nPROGRAM P\nEND_PROGRAM');
      const { data } = handleSemanticTokens(doc);
      const tokens = decodeTokens(data);
      expect(tokens.some(t => t.tokenType === 'comment' && t.line === 0)).toBe(true);
    });

    it('marks block comment as comment', () => {
      const doc = makeDoc('(* block comment *)\nPROGRAM P\nEND_PROGRAM');
      const { data } = handleSemanticTokens(doc);
      const tokens = decodeTokens(data);
      expect(tokens.some(t => t.tokenType === 'comment' && t.line === 0)).toBe(true);
    });
  });

  describe('user-defined types', () => {
    it('marks struct name as type', () => {
      const src = [
        'TYPE',
        '  MyStruct : STRUCT',
        '    x : INT;',
        '  END_STRUCT;',
        'END_TYPE',
      ].join('\n');
      const doc = makeDoc(src);
      const { data } = handleSemanticTokens(doc);
      const tokens = decodeTokens(data);
      const structNameToken = tokens.find(
        t => t.tokenType === 'type' && !t.modifiers.includes('defaultLibrary'),
      );
      expect(structNameToken).toBeDefined();
    });
  });

  describe('enum members', () => {
    it('marks enum values as enumMember', () => {
      const src = [
        'TYPE',
        '  Color : ENUM',
        '    RED,',
        '    GREEN,',
        '    BLUE',
        '  END_ENUM;',
        'END_TYPE',
      ].join('\n');
      const doc = makeDoc(src);
      const { data } = handleSemanticTokens(doc);
      const tokens = decodeTokens(data);
      const enumTokens = tokens.filter(t => t.tokenType === 'enumMember');
      expect(enumTokens).toHaveLength(3); // RED, GREEN, BLUE
    });
  });

  describe('tokenizeWithTrivia', () => {
    it('emits COMMENT tokens for line comments', () => {
      const tokens = new Lexer('// hello\nPROGRAM').tokenizeWithTrivia();
      const comments = tokens.filter(t => t.kind === TokenKind.COMMENT);
      expect(comments).toHaveLength(1);
      expect(comments[0].text).toBe('// hello');
    });

    it('emits COMMENT tokens for block comments', () => {
      const tokens = new Lexer('(* block *) PROGRAM').tokenizeWithTrivia();
      const comments = tokens.filter(t => t.kind === TokenKind.COMMENT);
      expect(comments).toHaveLength(1);
      expect(comments[0].text).toBe('(* block *)');
    });

    it('existing tokenize() still skips comments', () => {
      const tokens = new Lexer('// comment\nPROGRAM Main END_PROGRAM').tokenize();
      expect(tokens.some(t => t.kind === TokenKind.COMMENT)).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// TcPOU (XML/CDATA) semantic token handling
// ---------------------------------------------------------------------------

function makeTcPouDoc(content: string): TextDocument {
  return TextDocument.create('file:///test.tcpou', 'iec-st', 1, content);
}

describe('handleSemanticTokens — TcPOU XML/CDATA files', () => {
  const xmlPou = [
    '<?xml version="1.0" encoding="utf-8"?>',  // line 0
    '<TcPlcObject>',                            // line 1
    '  <POU Name="Foo">',                       // line 2
    '    <Declaration><![CDATA[',               // line 3  ← xml only
    'FUNCTION_BLOCK Foo',                       // line 4  ← ST start
    'VAR',                                      // line 5
    '  x : INT;',                               // line 6
    'END_VAR]]></Declaration>',                 // line 7  ← ST end / xml closes
    '    <Implementation>',                     // line 8
    '      <ST><![CDATA[x := 1;]]></ST>',      // line 9
    '    </Implementation>',                    // line 10
    '  </POU>',                                 // line 11
    '</TcPlcObject>',                           // line 12
  ].join('\n');

  it('emits comment tokens for XML wrapper lines', () => {
    const doc = makeTcPouDoc(xmlPou);
    const { data } = handleSemanticTokens(doc);
    const tokens = decodeTokens(data);
    // Lines 0-3 are pure XML — they should all get comment tokens
    const commentTokens = tokens.filter(t => t.tokenType === 'comment');
    expect(commentTokens.some(t => t.line === 0)).toBe(true); // XML declaration line
    expect(commentTokens.some(t => t.line === 1)).toBe(true); // <TcPlcObject>
    expect(commentTokens.some(t => t.line === 2)).toBe(true); // <POU Name="Foo">
  });

  it('emits keyword token for FUNCTION_BLOCK on correct original line', () => {
    const doc = makeTcPouDoc(xmlPou);
    const { data } = handleSemanticTokens(doc);
    const tokens = decodeTokens(data);
    // FUNCTION_BLOCK is on line 4 (ST content line)
    const fbToken = tokens.find(t => t.tokenType === 'keyword' && t.line === 4 && t.char === 0);
    expect(fbToken).toBeDefined();
    expect(fbToken?.length).toBe('FUNCTION_BLOCK'.length);
  });

  it('emits keyword token for VAR on correct original line', () => {
    const doc = makeTcPouDoc(xmlPou);
    const { data } = handleSemanticTokens(doc);
    const tokens = decodeTokens(data);
    const varToken = tokens.find(t => t.tokenType === 'keyword' && t.line === 5 && t.char === 0);
    expect(varToken).toBeDefined();
  });

  it('no tokens overlap on mixed lines (line with ]]>)', () => {
    const doc = makeTcPouDoc(xmlPou);
    const { data } = handleSemanticTokens(doc);
    const tokens = decodeTokens(data);
    // Line 7 has 'END_VAR]]></Declaration>' — END_VAR ST token + comment for ']]>...'
    const line7Tokens = tokens.filter(t => t.line === 7);
    // Check no two tokens overlap
    for (let i = 0; i < line7Tokens.length - 1; i++) {
      const a = line7Tokens[i];
      const b = line7Tokens[i + 1];
      expect(a.char + a.length).toBeLessThanOrEqual(b.char);
    }
  });

  it('does not return garbage tokens for .st files (regression)', () => {
    const doc = TextDocument.create('file:///test.st', 'iec-st', 1, 'PROGRAM Main\nEND_PROGRAM');
    const { data } = handleSemanticTokens(doc);
    const tokens = decodeTokens(data);
    const kw = tokens.filter(t => t.tokenType === 'keyword');
    expect(kw.length).toBeGreaterThanOrEqual(2); // PROGRAM + END_PROGRAM
  });
});
