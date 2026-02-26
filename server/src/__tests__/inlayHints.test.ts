import { describe, it, expect } from 'vitest';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { handleInlayHints } from '../handlers/inlayHints';
import { Range } from 'vscode-languageserver/node';

function makeDoc(content: string): TextDocument {
  return TextDocument.create('file:///test.st', 'st', 1, content);
}

function fullRange(doc: TextDocument): Range {
  return {
    start: { line: 0, character: 0 },
    end: doc.positionAt(doc.getText().length),
  };
}

describe('handleInlayHints', () => {
  describe('no document', () => {
    it('returns empty array when document is undefined', () => {
      const result = handleInlayHints(undefined, { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, undefined);
      expect(result).toEqual([]);
    });
  });

  describe('standard FB call: TON', () => {
    const src = [
      'PROGRAM Main',
      'VAR',
      '  timer : TON;',
      'END_VAR',
      '  TON(timer_var, t#500ms);',
      'END_PROGRAM',
    ].join('\n');

    it('emits InlayHints for positional TON args', () => {
      const doc = makeDoc(src);
      const hints = handleInlayHints(doc, fullRange(doc), undefined);
      expect(hints.length).toBeGreaterThanOrEqual(2);
      const labels = hints.map((h) => (typeof h.label === 'string' ? h.label : ''));
      expect(labels).toContain('IN:');
      expect(labels).toContain('PT:');
    });

    it('uses InlayHintKind.Parameter', () => {
      const doc = makeDoc(src);
      const hints = handleInlayHints(doc, fullRange(doc), undefined);
      for (const hint of hints) {
        expect(hint.kind).toBe(2); // InlayHintKind.Parameter = 2
      }
    });
  });

  describe('named arguments are skipped', () => {
    const src = [
      'PROGRAM Main',
      'VAR END_VAR',
      '  TON(IN := myBool, PT := t#1s);',
      'END_PROGRAM',
    ].join('\n');

    it('emits no hints when all args are named', () => {
      const doc = makeDoc(src);
      const hints = handleInlayHints(doc, fullRange(doc), undefined);
      expect(hints).toHaveLength(0);
    });
  });

  describe('user-defined FUNCTION call', () => {
    const src = [
      'FUNCTION Add : INT',
      'VAR_INPUT',
      '  a : INT;',
      '  b : INT;',
      'END_VAR',
      '  Add := a + b;',
      'END_FUNCTION',
      'PROGRAM Main',
      'VAR result : INT; END_VAR',
      '  result := Add(10, 20);',
      'END_PROGRAM',
    ].join('\n');

    it('emits hints for user-defined FUNCTION', () => {
      const doc = makeDoc(src);
      const hints = handleInlayHints(doc, fullRange(doc), undefined);
      const labels = hints.map((h) => (typeof h.label === 'string' ? h.label : ''));
      expect(labels).toContain('a:');
      expect(labels).toContain('b:');
    });
  });

  describe('user-defined FUNCTION_BLOCK call', () => {
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
      '  fb(TRUE, 3.14);',
      'END_PROGRAM',
    ].join('\n');

    it('emits hints for user-defined FUNCTION_BLOCK instance call', () => {
      const doc = makeDoc(src);
      const hints = handleInlayHints(doc, fullRange(doc), undefined);
      const labels = hints.map((h) => (typeof h.label === 'string' ? h.label : ''));
      expect(labels).toContain('enable:');
      expect(labels).toContain('setpoint:');
    });
  });

  describe('call with no args', () => {
    const src = [
      'PROGRAM Main',
      'VAR END_VAR',
      '  TON();',
      'END_PROGRAM',
    ].join('\n');

    it('emits no hints when there are no arguments', () => {
      const doc = makeDoc(src);
      const hints = handleInlayHints(doc, fullRange(doc), undefined);
      expect(hints).toHaveLength(0);
    });
  });

  describe('unknown callee', () => {
    const src = [
      'PROGRAM Main',
      'VAR END_VAR',
      '  UnknownFn(42);',
      'END_PROGRAM',
    ].join('\n');

    it('emits no hints for unresolvable callees', () => {
      const doc = makeDoc(src);
      const hints = handleInlayHints(doc, fullRange(doc), undefined);
      expect(hints).toHaveLength(0);
    });
  });

  describe('hint position', () => {
    const src = [
      'PROGRAM Main',
      'VAR END_VAR',
      '  TON(myBool, t#500ms);',
      'END_PROGRAM',
    ].join('\n');

    it('hint position is at the start of the argument expression', () => {
      const doc = makeDoc(src);
      const hints = handleInlayHints(doc, fullRange(doc), undefined);
      // First hint (IN:) should be at line 2 (0-based), before 'myBool'
      const inHint = hints.find((h) => (typeof h.label === 'string' ? h.label : '') === 'IN:');
      expect(inHint).toBeDefined();
      expect(inHint!.position.line).toBe(2);
    });
  });
});
