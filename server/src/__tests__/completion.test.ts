import { describe, it, expect } from 'vitest';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { handleCompletion } from '../handlers/completion';
import { CompletionItemKind } from 'vscode-languageserver/node';

function makeDoc(content: string): TextDocument {
  return TextDocument.create('file:///test.st', 'st', 1, content);
}

function makeParams(uri: string, line: number, character: number) {
  return {
    textDocument: { uri },
    position: { line, character },
  };
}

describe('handleCompletion', () => {
  const src = `PROGRAM Main
VAR
  myVar : BOOL;
  counter : INT;
END_VAR
END_PROGRAM`;

  describe('keywords', () => {
    it('completion list includes IF keyword', () => {
      const doc = makeDoc(src);
      const items = handleCompletion(makeParams(doc.uri, 5, 0), doc);
      const labels = items.map(i => i.label);
      expect(labels).toContain('IF');
    });

    it('completion list includes WHILE keyword', () => {
      const doc = makeDoc(src);
      const items = handleCompletion(makeParams(doc.uri, 5, 0), doc);
      const labels = items.map(i => i.label);
      expect(labels).toContain('WHILE');
    });

    it('completion list includes FOR keyword', () => {
      const doc = makeDoc(src);
      const items = handleCompletion(makeParams(doc.uri, 5, 0), doc);
      const labels = items.map(i => i.label);
      expect(labels).toContain('FOR');
    });

    it('keyword items have Keyword kind', () => {
      const doc = makeDoc(src);
      const items = handleCompletion(makeParams(doc.uri, 5, 0), doc);
      const ifItem = items.find(i => i.label === 'IF');
      expect(ifItem).toBeDefined();
      expect(ifItem?.kind).toBe(CompletionItemKind.Keyword);
    });
  });

  describe('built-in types', () => {
    it('completion list includes BOOL type', () => {
      const doc = makeDoc(src);
      const items = handleCompletion(makeParams(doc.uri, 5, 0), doc);
      const labels = items.map(i => i.label);
      expect(labels).toContain('BOOL');
    });

    it('completion list includes INT type', () => {
      const doc = makeDoc(src);
      const items = handleCompletion(makeParams(doc.uri, 5, 0), doc);
      const labels = items.map(i => i.label);
      expect(labels).toContain('INT');
    });

    it('completion list includes REAL type', () => {
      const doc = makeDoc(src);
      const items = handleCompletion(makeParams(doc.uri, 5, 0), doc);
      const labels = items.map(i => i.label);
      expect(labels).toContain('REAL');
    });

    it('type items have TypeParameter kind', () => {
      const doc = makeDoc(src);
      const items = handleCompletion(makeParams(doc.uri, 5, 0), doc);
      const boolItem = items.find(i => i.label === 'BOOL');
      expect(boolItem).toBeDefined();
      expect(boolItem?.kind).toBe(CompletionItemKind.TypeParameter);
    });
  });

  describe('variables from enclosing PROGRAM VAR block', () => {
    it('includes myVar variable declared in VAR block', () => {
      const doc = makeDoc(src);
      // Position inside the PROGRAM body
      const items = handleCompletion(makeParams(doc.uri, 5, 0), doc);
      const labels = items.map(i => i.label);
      expect(labels).toContain('myVar');
    });

    it('includes counter variable declared in VAR block', () => {
      const doc = makeDoc(src);
      const items = handleCompletion(makeParams(doc.uri, 5, 0), doc);
      const labels = items.map(i => i.label);
      expect(labels).toContain('counter');
    });

    it('variable items have Variable kind', () => {
      const doc = makeDoc(src);
      const items = handleCompletion(makeParams(doc.uri, 5, 0), doc);
      const varItem = items.find(i => i.label === 'myVar');
      expect(varItem).toBeDefined();
      expect(varItem?.kind).toBe(CompletionItemKind.Variable);
    });
  });

  describe('undefined document', () => {
    it('returns empty array when document is undefined', () => {
      const params = makeParams('file:///missing.st', 0, 0);
      const result = handleCompletion(params, undefined);
      expect(result).toEqual([]);
    });
  });

  describe('dot-accessor completion', () => {
    describe('standard FB outputs (TON)', () => {
      const fbSrc = `PROGRAM Main
VAR
  myTimer : TON;
END_VAR
myTimer.`;
      // cursor is at end of line 4: character 8 (after the '.')

      it('returns Q output for TON instance', () => {
        const doc = makeDoc(fbSrc);
        const items = handleCompletion(makeParams(doc.uri, 4, 8), doc);
        const labels = items.map(i => i.label);
        expect(labels).toContain('Q');
      });

      it('returns ET output for TON instance', () => {
        const doc = makeDoc(fbSrc);
        const items = handleCompletion(makeParams(doc.uri, 4, 8), doc);
        const labels = items.map(i => i.label);
        expect(labels).toContain('ET');
      });

      it('does not return VAR_INPUT IN for TON instance', () => {
        const doc = makeDoc(fbSrc);
        const items = handleCompletion(makeParams(doc.uri, 4, 8), doc);
        const labels = items.map(i => i.label);
        expect(labels).not.toContain('IN');
      });

      it('does not return flat keywords in dot-access context', () => {
        const doc = makeDoc(fbSrc);
        const items = handleCompletion(makeParams(doc.uri, 4, 8), doc);
        const labels = items.map(i => i.label);
        expect(labels).not.toContain('IF');
        expect(labels).not.toContain('WHILE');
      });

      it('output items have Field kind', () => {
        const doc = makeDoc(fbSrc);
        const items = handleCompletion(makeParams(doc.uri, 4, 8), doc);
        const qItem = items.find(i => i.label === 'Q');
        expect(qItem).toBeDefined();
        expect(qItem?.kind).toBe(CompletionItemKind.Field);
      });
    });

    describe('user-defined FUNCTION_BLOCK members', () => {
      const fbSrc = `FUNCTION_BLOCK MyFB
VAR_INPUT
  Enable : BOOL;
END_VAR
VAR_OUTPUT
  Done : BOOL;
  Error : BOOL;
END_VAR
END_FUNCTION_BLOCK

PROGRAM Main
VAR
  myInst : MyFB;
END_VAR
myInst.`;
      // line 14, character 7

      it('returns VAR_OUTPUT Done', () => {
        const doc = makeDoc(fbSrc);
        const items = handleCompletion(makeParams(doc.uri, 14, 7), doc);
        const labels = items.map(i => i.label);
        expect(labels).toContain('Done');
      });

      it('returns VAR_OUTPUT Error', () => {
        const doc = makeDoc(fbSrc);
        const items = handleCompletion(makeParams(doc.uri, 14, 7), doc);
        const labels = items.map(i => i.label);
        expect(labels).toContain('Error');
      });

      it('does not return VAR_INPUT Enable on instance access', () => {
        const doc = makeDoc(fbSrc);
        const items = handleCompletion(makeParams(doc.uri, 14, 7), doc);
        const labels = items.map(i => i.label);
        expect(labels).not.toContain('Enable');
      });
    });

    describe('FUNCTION_BLOCK with methods', () => {
      const fbSrc = `FUNCTION_BLOCK MyFB
VAR_OUTPUT
  Status : INT;
END_VAR
METHOD Start : BOOL
END_METHOD
END_FUNCTION_BLOCK

PROGRAM Main
VAR
  myInst : MyFB;
END_VAR
myInst.`;
      // line 12, character 7

      it('returns method Start', () => {
        const doc = makeDoc(fbSrc);
        const items = handleCompletion(makeParams(doc.uri, 12, 7), doc);
        const labels = items.map(i => i.label);
        expect(labels).toContain('Start');
      });

      it('method item has Method kind', () => {
        const doc = makeDoc(fbSrc);
        const items = handleCompletion(makeParams(doc.uri, 12, 7), doc);
        const startItem = items.find(i => i.label === 'Start');
        expect(startItem).toBeDefined();
        expect(startItem?.kind).toBe(CompletionItemKind.Method);
      });
    });

    describe('STRUCT field access', () => {
      const structSrc = `TYPE
  ST_Motor : STRUCT
    bRunning : BOOL;
    rSpeed : REAL;
  END_STRUCT;
END_TYPE

PROGRAM Main
VAR
  myMotor : ST_Motor;
END_VAR
myMotor.`;
      // line 11, character 8

      it('returns field bRunning', () => {
        const doc = makeDoc(structSrc);
        const items = handleCompletion(makeParams(doc.uri, 11, 8), doc);
        const labels = items.map(i => i.label);
        expect(labels).toContain('bRunning');
      });

      it('returns field rSpeed', () => {
        const doc = makeDoc(structSrc);
        const items = handleCompletion(makeParams(doc.uri, 11, 8), doc);
        const labels = items.map(i => i.label);
        expect(labels).toContain('rSpeed');
      });

      it('field items have Field kind', () => {
        const doc = makeDoc(structSrc);
        const items = handleCompletion(makeParams(doc.uri, 11, 8), doc);
        const fieldItem = items.find(i => i.label === 'bRunning');
        expect(fieldItem).toBeDefined();
        expect(fieldItem?.kind).toBe(CompletionItemKind.Field);
      });
    });

    describe('unresolvable dot access', () => {
      it('returns empty list when variable type cannot be resolved', () => {
        const src = `PROGRAM Main
VAR
END_VAR
unknownVar.`;
        const doc = makeDoc(src);
        const items = handleCompletion(makeParams(doc.uri, 3, 11), doc);
        expect(items).toEqual([]);
      });

      it('returns empty list when variable is not in scope', () => {
        const src = `PROGRAM Main
VAR
  x : BOOL;
END_VAR
notDeclared.`;
        const doc = makeDoc(src);
        const items = handleCompletion(makeParams(doc.uri, 4, 12), doc);
        expect(items).toEqual([]);
      });
    });

    describe('flat completion not affected outside dot context', () => {
      it('still returns keywords when cursor is not after a dot', () => {
        const src = `PROGRAM Main\nVAR\n  myTimer : TON;\nEND_VAR\nIF `;
        const doc = makeDoc(src);
        const items = handleCompletion(makeParams(doc.uri, 4, 3), doc);
        const labels = items.map(i => i.label);
        expect(labels).toContain('IF');
        expect(labels).toContain('WHILE');
      });
    });
  });
});
