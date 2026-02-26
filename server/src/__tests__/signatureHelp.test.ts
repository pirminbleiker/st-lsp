import { describe, it, expect } from 'vitest';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { handleSignatureHelp } from '../handlers/signatureHelp';
import { SignatureHelpParams } from 'vscode-languageserver/node';

function makeDoc(content: string): TextDocument {
  return TextDocument.create('file:///test.st', 'st', 1, content);
}

function makeParams(uri: string, line: number, character: number): SignatureHelpParams {
  return {
    textDocument: { uri },
    position: { line, character },
    context: undefined,
  };
}

describe('handleSignatureHelp', () => {
  describe('standard FB: TON', () => {
    it('returns TON signature with 2 parameters when cursor is right after TON(', () => {
      // Line 0: "TON("
      //          0123
      const src = 'TON(';
      const doc = makeDoc(src);
      const result = handleSignatureHelp(makeParams(doc.uri, 0, 4), doc);

      expect(result).not.toBeNull();
      expect(result!.signatures).toHaveLength(1);

      const sig = result!.signatures[0];
      expect(sig.label).toContain('TON');
      expect(sig.parameters).toHaveLength(2);
      // First param is IN: BOOL
      expect(sig.parameters![0].label).toBe('IN: BOOL');
      // Second param is PT: TIME
      expect(sig.parameters![1].label).toBe('PT: TIME');
    });

    it('sets activeSignature to 0 and activeParameter to 0 for first param', () => {
      const src = 'TON(';
      const doc = makeDoc(src);
      const result = handleSignatureHelp(makeParams(doc.uri, 0, 4), doc);

      expect(result).not.toBeNull();
      expect(result!.activeSignature).toBe(0);
      expect(result!.activeParameter).toBe(0);
    });

    it('returns activeParameter = 1 after a comma (second parameter)', () => {
      // "TON(IN := x, "  — cursor after the comma+space
      const src = 'TON(IN := x, ';
      const doc = makeDoc(src);
      const result = handleSignatureHelp(makeParams(doc.uri, 0, src.length), doc);

      expect(result).not.toBeNull();
      expect(result!.activeParameter).toBe(1);
    });

    it('TON signature label has correct format', () => {
      const src = 'TON(';
      const doc = makeDoc(src);
      const result = handleSignatureHelp(makeParams(doc.uri, 0, 4), doc);

      expect(result).not.toBeNull();
      expect(result!.signatures[0].label).toBe('TON(IN: BOOL, PT: TIME)');
    });

    it('includes documentation for standard FB', () => {
      const src = 'TON(';
      const doc = makeDoc(src);
      const result = handleSignatureHelp(makeParams(doc.uri, 0, 4), doc);

      expect(result).not.toBeNull();
      const doc_ = result!.signatures[0].documentation;
      expect(doc_).toBeDefined();
      // documentation should mention TON or timer
      const value = (doc_ as { kind: string; value: string }).value;
      expect(value.toLowerCase()).toMatch(/timer|ton/i);
    });
  });

  describe('standard FBs: others', () => {
    it('CTU returns 3 parameters (CU, R, PV)', () => {
      const src = 'CTU(';
      const doc = makeDoc(src);
      const result = handleSignatureHelp(makeParams(doc.uri, 0, 4), doc);

      expect(result).not.toBeNull();
      expect(result!.signatures[0].parameters).toHaveLength(3);
      expect(result!.signatures[0].parameters![0].label).toBe('CU: BOOL');
      expect(result!.signatures[0].parameters![1].label).toBe('R: BOOL');
      expect(result!.signatures[0].parameters![2].label).toBe('PV: INT');
    });

    it('R_TRIG returns 1 parameter (CLK)', () => {
      const src = 'R_TRIG(';
      const doc = makeDoc(src);
      const result = handleSignatureHelp(makeParams(doc.uri, 0, src.length), doc);

      expect(result).not.toBeNull();
      expect(result!.signatures[0].parameters).toHaveLength(1);
      expect(result!.signatures[0].parameters![0].label).toBe('CLK: BOOL');
    });

    it('case-insensitive: ton( matches TON', () => {
      const src = 'ton(';
      const doc = makeDoc(src);
      const result = handleSignatureHelp(makeParams(doc.uri, 0, 4), doc);

      expect(result).not.toBeNull();
      expect(result!.signatures[0].label).toContain('TON');
    });
  });

  describe('unknown function', () => {
    it('returns null for an unrecognised function name', () => {
      const src = 'UnknownFn(';
      const doc = makeDoc(src);
      const result = handleSignatureHelp(makeParams(doc.uri, 0, src.length), doc);

      expect(result).toBeNull();
    });
  });

  describe('no document', () => {
    it('returns null when document is undefined', () => {
      const params = makeParams('file:///missing.st', 0, 0);
      const result = handleSignatureHelp(params, undefined);
      expect(result).toBeNull();
    });
  });

  describe('user-defined FUNCTION in the same file', () => {
    const src = [
      'FUNCTION MyAdd : INT',
      'VAR_INPUT',
      '  a : INT;',
      '  b : INT;',
      'END_VAR',
      '  MyAdd := a + b;',
      'END_FUNCTION',
      'PROGRAM Main',
      'VAR result : INT; END_VAR',
      '  result := MyAdd(',
      'END_PROGRAM',
    ].join('\n');

    it('returns signature for user-defined FUNCTION', () => {
      const doc = makeDoc(src);
      // Line 9: "  result := MyAdd("  — cursor at end
      const line9 = '  result := MyAdd(';
      const result = handleSignatureHelp(
        makeParams(doc.uri, 9, line9.length),
        doc,
      );

      expect(result).not.toBeNull();
      expect(result!.signatures).toHaveLength(1);
      const sig = result!.signatures[0];
      expect(sig.label).toContain('MyAdd');
      expect(sig.parameters).toHaveLength(2);
      expect(sig.parameters![0].label).toBe('a: INT');
      expect(sig.parameters![1].label).toBe('b: INT');
    });

    it('activeParameter = 1 for second param of user-defined function', () => {
      const srcWithComma = [
        'FUNCTION MyAdd : INT',
        'VAR_INPUT',
        '  a : INT;',
        '  b : INT;',
        'END_VAR',
        '  MyAdd := a + b;',
        'END_FUNCTION',
        'PROGRAM Main',
        'VAR result : INT; END_VAR',
        '  result := MyAdd(1, ',
        'END_PROGRAM',
      ].join('\n');

      const doc = makeDoc(srcWithComma);
      const line9 = '  result := MyAdd(1, ';
      const result = handleSignatureHelp(
        makeParams(doc.uri, 9, line9.length),
        doc,
      );

      expect(result).not.toBeNull();
      expect(result!.activeParameter).toBe(1);
    });
  });

  describe('user-defined FUNCTION_BLOCK in the same file', () => {
    const src = [
      'FUNCTION_BLOCK MyFB',
      'VAR_INPUT',
      '  enable : BOOL;',
      '  setpoint : REAL;',
      'END_VAR',
      'END_FUNCTION_BLOCK',
      'PROGRAM Main',
      'VAR',
      '  fb : MyFB;',
      'END_VAR',
      '  fb(',
      'END_PROGRAM',
    ].join('\n');

    it('returns signature for user-defined FUNCTION_BLOCK', () => {
      const doc = makeDoc(src);
      // Line 10: "  fb("  — cursor at end
      const result = handleSignatureHelp(
        makeParams(doc.uri, 10, '  fb('.length),
        doc,
      );

      expect(result).not.toBeNull();
      const sig = result!.signatures[0];
      expect(sig.label).toContain('MyFB');
      expect(sig.parameters).toHaveLength(2);
      expect(sig.parameters![0].label).toBe('enable: BOOL');
      expect(sig.parameters![1].label).toBe('setpoint: REAL');
    });
  });

  describe('nested calls: active call is the outermost unclosed paren', () => {
    it('handles cursor inside a nested call argument correctly', () => {
      // "TON(IN := NOT(x), "  — after comma, activeParam = 1 (PT)
      const src = 'TON(IN := NOT(x), ';
      const doc = makeDoc(src);
      const result = handleSignatureHelp(makeParams(doc.uri, 0, src.length), doc);

      expect(result).not.toBeNull();
      // The outer call is TON, and we've passed 1 comma at depth 0
      expect(result!.signatures[0].label).toContain('TON');
      expect(result!.activeParameter).toBe(1);
    });
  });
});
