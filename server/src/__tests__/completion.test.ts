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
});
