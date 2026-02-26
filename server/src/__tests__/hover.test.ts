import { describe, it, expect } from 'vitest';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { handleHover } from '../handlers/hover';

function makeDoc(content: string): TextDocument {
  return TextDocument.create('file:///test.st', 'st', 1, content);
}

function makeParams(uri: string, line: number, character: number) {
  return {
    textDocument: { uri },
    position: { line, character },
  };
}

describe('handleHover', () => {
  describe('hover over built-in type used as a variable name in body', () => {
    // BOOL is a NameExpression when used as a value — but built-in type hover
    // works via NameExpression. We call a function named INT to get a NameExpression.
    // Actually hover only works on NameExpression nodes, so let's hover over
    // a call to INT() conversion function in the body.
    const src = [
      'PROGRAM Main',
      'VAR',
      '  x : INT;',
      'END_VAR',
      '  x := INT(3.14);',
      'END_PROGRAM',
    ].join('\n');

    it('returns hover content for INT conversion call (built-in type NameExpression)', () => {
      const doc = makeDoc(src);
      // Line 4: "  x := INT(3.14);"
      // "INT" starts at character 7
      const result = handleHover(makeParams(doc.uri, 4, 7), doc);
      // INT is a built-in type, should return hover
      expect(result).not.toBeNull();
      if (result) {
        expect(result.contents).toBeDefined();
        const contents = result.contents as { kind: string; value: string };
        expect(contents.value).toContain('INT');
      }
    });
  });

  describe('hover over unknown identifier returns null', () => {
    const src = [
      'PROGRAM Main',
      'VAR x : INT; END_VAR',
      '  unknownVar := 1;',
      'END_PROGRAM',
    ].join('\n');

    it('returns null for an unknown identifier', () => {
      const doc = makeDoc(src);
      // Line 2: "  unknownVar := 1;"
      // "unknownVar" starts at character 2
      const result = handleHover(makeParams(doc.uri, 2, 2), doc);
      // unknownVar is not a built-in type, not a std FB, not declared in VAR,
      // so it should return null
      expect(result).toBeNull();
    });
  });

  describe('hover over a variable name returns its type declaration', () => {
    const src = [
      'PROGRAM Main',
      'VAR',
      '  myVar : INT;',
      'END_VAR',
      '  myVar := 42;',
      'END_PROGRAM',
    ].join('\n');

    it('returns hover content mentioning the variable and its type', () => {
      const doc = makeDoc(src);
      // Line 4: "  myVar := 42;"
      // "myVar" starts at character 2
      const result = handleHover(makeParams(doc.uri, 4, 2), doc);
      expect(result).not.toBeNull();
      if (result) {
        const contents = result.contents as { kind: string; value: string };
        expect(contents.value).toContain('myVar');
        expect(contents.value).toContain('INT');
      }
    });
  });

  describe('hover over a POU name returns POU kind info', () => {
    // To get hover over a POU name we need to use the POU name in an
    // expression — but this is tricky since the PROGRAM body is only
    // parsed for statements. Let's use a FUNCTION call.
    const src = [
      'FUNCTION MyFunc : INT',
      'VAR_INPUT a : INT; END_VAR',
      'END_FUNCTION',
      'PROGRAM Main',
      'VAR result : INT; END_VAR',
      '  result := MyFunc(a := 1);',
      'END_PROGRAM',
    ].join('\n');

    it('returns hover content for a POU name reference', () => {
      const doc = makeDoc(src);
      // Line 5: "  result := MyFunc(a := 1);"
      // "MyFunc" starts at character 12
      const result = handleHover(makeParams(doc.uri, 5, 12), doc);
      expect(result).not.toBeNull();
      if (result) {
        const contents = result.contents as { kind: string; value: string };
        // Should mention FUNCTION and MyFunc
        expect(contents.value).toContain('MyFunc');
      }
    });
  });

  describe('undefined document', () => {
    it('returns null when document is undefined', () => {
      const params = makeParams('file:///missing.st', 0, 0);
      const result = handleHover(params, undefined);
      expect(result).toBeNull();
    });
  });
});
