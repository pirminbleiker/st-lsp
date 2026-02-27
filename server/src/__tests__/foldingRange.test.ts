import { describe, it, expect } from 'vitest';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { FoldingRangeKind } from 'vscode-languageserver/node';
import { handleFoldingRanges } from '../handlers/foldingRange';

function makeDoc(content: string): TextDocument {
  return TextDocument.create('file:///test.st', 'iec-st', 1, content);
}

describe('handleFoldingRanges', () => {
  it('returns empty array for undefined document', () => {
    expect(handleFoldingRanges(undefined)).toEqual([]);
  });

  it('folds PROGRAM...END_PROGRAM body', () => {
    const src = [
      'PROGRAM Main',
      'VAR',
      '  x : INT;',
      'END_VAR',
      '  x := 1;',
      'END_PROGRAM',
    ].join('\n');
    const ranges = handleFoldingRanges(makeDoc(src));
    const program = ranges.find(r => r.startLine === 0 && r.endLine === 5);
    expect(program).toBeDefined();
    expect(program?.kind).toBe(FoldingRangeKind.Region);
  });

  it('folds VAR block inside PROGRAM', () => {
    const src = [
      'PROGRAM Main',
      'VAR',
      '  x : INT;',
      'END_VAR',
      '  x := 1;',
      'END_PROGRAM',
    ].join('\n');
    const ranges = handleFoldingRanges(makeDoc(src));
    const varBlock = ranges.find(r => r.startLine === 1 && r.endLine === 3);
    expect(varBlock).toBeDefined();
    expect(varBlock?.kind).toBe(FoldingRangeKind.Region);
  });

  it('folds FUNCTION_BLOCK...END_FUNCTION_BLOCK', () => {
    const src = [
      'FUNCTION_BLOCK MyFB',
      'VAR_INPUT',
      '  x : INT;',
      'END_VAR',
      'END_FUNCTION_BLOCK',
    ].join('\n');
    const ranges = handleFoldingRanges(makeDoc(src));
    const fb = ranges.find(r => r.startLine === 0 && r.endLine === 4);
    expect(fb).toBeDefined();
    const varInput = ranges.find(r => r.startLine === 1 && r.endLine === 3);
    expect(varInput).toBeDefined();
  });

  it('folds FUNCTION...END_FUNCTION', () => {
    const src = [
      'FUNCTION Add : INT',
      'VAR_INPUT',
      '  a : INT;',
      '  b : INT;',
      'END_VAR',
      '  Add := a + b;',
      'END_FUNCTION',
    ].join('\n');
    const ranges = handleFoldingRanges(makeDoc(src));
    const fn = ranges.find(r => r.startLine === 0 && r.endLine === 6);
    expect(fn).toBeDefined();
  });

  it('folds IF...END_IF', () => {
    const src = [
      'PROGRAM Main',
      'VAR x : INT; END_VAR',
      '  IF x > 0 THEN',
      '    x := 1;',
      '  END_IF',
      'END_PROGRAM',
    ].join('\n');
    const ranges = handleFoldingRanges(makeDoc(src));
    const ifStmt = ranges.find(r => r.startLine === 2 && r.endLine === 4);
    expect(ifStmt).toBeDefined();
  });

  it('folds FOR...END_FOR', () => {
    const src = [
      'PROGRAM Main',
      'VAR i : INT; END_VAR',
      '  FOR i := 0 TO 10 DO',
      '    ;',
      '  END_FOR',
      'END_PROGRAM',
    ].join('\n');
    const ranges = handleFoldingRanges(makeDoc(src));
    const forStmt = ranges.find(r => r.startLine === 2 && r.endLine === 4);
    expect(forStmt).toBeDefined();
  });

  it('folds WHILE...END_WHILE', () => {
    const src = [
      'PROGRAM Main',
      'VAR i : INT; END_VAR',
      '  WHILE i < 10 DO',
      '    i := i + 1;',
      '  END_WHILE',
      'END_PROGRAM',
    ].join('\n');
    const ranges = handleFoldingRanges(makeDoc(src));
    const w = ranges.find(r => r.startLine === 2 && r.endLine === 4);
    expect(w).toBeDefined();
  });

  it('folds REPEAT...UNTIL', () => {
    const src = [
      'PROGRAM Main',
      'VAR i : INT; END_VAR',
      '  REPEAT',
      '    i := i + 1;',
      '  UNTIL i >= 10',
      '  END_REPEAT',
      'END_PROGRAM',
    ].join('\n');
    const ranges = handleFoldingRanges(makeDoc(src));
    const r = ranges.find(r => r.startLine === 2 && r.endLine === 5);
    expect(r).toBeDefined();
  });

  it('folds CASE...END_CASE', () => {
    const src = [
      'PROGRAM Main',
      'VAR x : INT; END_VAR',
      '  CASE x OF',
      '    1: x := 10;',
      '    2: x := 20;',
      '  END_CASE',
      'END_PROGRAM',
    ].join('\n');
    const ranges = handleFoldingRanges(makeDoc(src));
    const c = ranges.find(r => r.startLine === 2 && r.endLine === 5);
    expect(c).toBeDefined();
  });

  it('folds METHOD inside FUNCTION_BLOCK', () => {
    const src = [
      'FUNCTION_BLOCK MyFB',
      'METHOD MyMethod : BOOL',
      'VAR_INPUT',
      '  x : INT;',
      'END_VAR',
      '  MyMethod := TRUE;',
      'END_METHOD',
      'END_FUNCTION_BLOCK',
    ].join('\n');
    const ranges = handleFoldingRanges(makeDoc(src));
    const method = ranges.find(r => r.startLine === 1 && r.endLine === 6);
    expect(method).toBeDefined();
  });

  it('folds TYPE...END_TYPE block', () => {
    const src = [
      'TYPE',
      '  MyStruct : STRUCT',
      '    x : INT;',
      '    y : INT;',
      '  END_STRUCT',
      'END_TYPE',
    ].join('\n');
    const ranges = handleFoldingRanges(makeDoc(src));
    const typeBlock = ranges.find(r => r.startLine === 0 && r.endLine === 5);
    expect(typeBlock).toBeDefined();
  });

  it('folds TYPE...END_TYPE block only (not individual struct ranges)', () => {
    const src = [
      'TYPE',
      '  MyStruct : STRUCT',
      '    x : INT;',
      '  END_STRUCT',
      'END_TYPE',
    ].join('\n');
    const ranges = handleFoldingRanges(makeDoc(src));
    const typeBlock = ranges.find(r => r.startLine === 0 && r.endLine === 4);
    expect(typeBlock).toBeDefined();
    // Individual struct declarations share the TYPE block's start position in
    // the parser, so we do not emit separate fold ranges for them.
    expect(ranges.length).toBe(1);
  });

  it('folds multi-line block comment as Comment kind', () => {
    const src = [
      '(* This is',
      '   a multi-line',
      '   comment *)',
      'PROGRAM Main',
      'END_PROGRAM',
    ].join('\n');
    const ranges = handleFoldingRanges(makeDoc(src));
    const comment = ranges.find(r => r.startLine === 0 && r.endLine === 2);
    expect(comment).toBeDefined();
    expect(comment?.kind).toBe(FoldingRangeKind.Comment);
  });

  it('does not fold single-line block comment', () => {
    const src = [
      '(* inline comment *)',
      'PROGRAM Main',
      'END_PROGRAM',
    ].join('\n');
    const ranges = handleFoldingRanges(makeDoc(src));
    const comment = ranges.find(r => r.kind === FoldingRangeKind.Comment);
    expect(comment).toBeUndefined();
  });

  it('folds INTERFACE...END_INTERFACE', () => {
    const src = [
      'INTERFACE IMyInterface',
      '  METHOD GetValue : INT',
      '  END_METHOD',
      'END_INTERFACE',
    ].join('\n');
    const ranges = handleFoldingRanges(makeDoc(src));
    const iface = ranges.find(r => r.startLine === 0 && r.endLine === 3);
    expect(iface).toBeDefined();
  });

  it('folds nested IF inside FOR', () => {
    const src = [
      'PROGRAM Main',
      'VAR i : INT; END_VAR',
      '  FOR i := 0 TO 10 DO',
      '    IF i > 5 THEN',
      '      ;',
      '    END_IF',
      '  END_FOR',
      'END_PROGRAM',
    ].join('\n');
    const ranges = handleFoldingRanges(makeDoc(src));
    const forStmt = ranges.find(r => r.startLine === 2 && r.endLine === 6);
    const ifStmt = ranges.find(r => r.startLine === 3 && r.endLine === 5);
    expect(forStmt).toBeDefined();
    expect(ifStmt).toBeDefined();
  });
});
