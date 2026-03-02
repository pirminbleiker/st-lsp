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

// ---------------------------------------------------------------------------
// TcPOU (XML/CDATA) folding range handling
// ---------------------------------------------------------------------------

function makeTcPouDoc(content: string): TextDocument {
  return TextDocument.create('file:///test.tcpou', 'iec-st', 1, content);
}

describe('handleFoldingRanges — TcPOU XML/CDATA files', () => {
  const xmlPou = [
    '<?xml version="1.0" encoding="utf-8"?>',  // line 0
    '<TcPlcObject>',                            // line 1
    '  <POU Name="Foo">',                       // line 2
    '    <Declaration><![CDATA[',               // line 3
    'FUNCTION_BLOCK Foo',                       // line 4
    'VAR',                                      // line 5
    '  x : INT;',                               // line 6
    'END_VAR',                                  // line 7
    ']]></Declaration>',                        // line 8  ← CDATA close / xml
    '    <Implementation>',                     // line 9
    '      <ST><![CDATA[x := 1;]]></ST>',      // line 10
    '    </Implementation>',                    // line 11
    '  </POU>',                                 // line 12
    '</TcPlcObject>',                           // line 13
  ].join('\n');

  it('produces folding ranges for XML sections', () => {
    const ranges = handleFoldingRanges(makeTcPouDoc(xmlPou));
    const headerFold = ranges.find(r => r.startLine === 0);
    expect(headerFold).toBeDefined();
    expect(headerFold!.endLine).toBeGreaterThanOrEqual(3);
  });

  it('folds XML preamble as Imports (auto-collapsed) with character-level range', () => {
    const ranges = handleFoldingRanges(makeTcPouDoc(xmlPou));
    // Preamble XML region: from file start to right after '<![CDATA[' on line 3
    const preamble = ranges.find(r => r.startLine === 0 && r.startCharacter === 0 && r.endLine === 3 && r.endCharacter === 26);
    expect(preamble).toBeDefined();
    expect(preamble!.kind).toBe(FoldingRangeKind.Imports);
    expect(preamble!.collapsedText).toBe('\u2026');
  });

  it('folds XML inter-section between Declaration and Implementation with character-level range', () => {
    const ranges = handleFoldingRanges(makeTcPouDoc(xmlPou));
    // Inter-section: from ]]></Declaration> through <Implementation><ST><![CDATA[
    const interSection = ranges.find(r => r.startLine === 8 && r.startCharacter === 0 && r.endLine === 10 && r.endCharacter === 19);
    expect(interSection).toBeDefined();
    expect(interSection!.kind).toBe(FoldingRangeKind.Imports);
    expect(interSection!.collapsedText).toBe('\u2026');
  });

  it('folds XML postamble after the last CDATA with character-level range', () => {
    const ranges = handleFoldingRanges(makeTcPouDoc(xmlPou));
    // Postamble: from ]]></ST> to end of file
    const postamble = ranges.find(r => r.startLine === 10 && r.startCharacter === 26 && r.endLine === 13 && r.endCharacter === 14);
    expect(postamble).toBeDefined();
    expect(postamble!.kind).toBe(FoldingRangeKind.Imports);
    expect(postamble!.collapsedText).toBe('\u2026');
  });

  it('produces a folding range for the VAR block at correct original-file lines', () => {
    const ranges = handleFoldingRanges(makeTcPouDoc(xmlPou));
    // VAR starts at line 5, END_VAR at line 7 in the original file
    const varFold = ranges.find(r => r.startLine === 5 && r.endLine === 7);
    expect(varFold).toBeDefined();
  });

  it('produces a folding range for the POU body at correct original-file lines', () => {
    const ranges = handleFoldingRanges(makeTcPouDoc(xmlPou));
    // FUNCTION_BLOCK body: starts line 4, ends line 7 (END_VAR is last ST line before CDATA close)
    const pouFold = ranges.find(r => r.startLine === 4);
    expect(pouFold).toBeDefined();
  });

  it('does not produce negative-range folds', () => {
    const ranges = handleFoldingRanges(makeTcPouDoc(xmlPou));
    for (const r of ranges) {
      expect(r.endLine).toBeGreaterThan(r.startLine);
    }
  });

  it('falls back to line-level folds when lineFoldingOnly is true', () => {
    const ranges = handleFoldingRanges(makeTcPouDoc(xmlPou), true);
    // In lineFoldingOnly mode, XML folds should have no startCharacter/endCharacter
    const xmlFolds = ranges.filter(r => r.kind === FoldingRangeKind.Imports);
    expect(xmlFolds.length).toBeGreaterThan(0);
    for (const fold of xmlFolds) {
      expect(fold.startCharacter).toBeUndefined();
      expect(fold.endCharacter).toBeUndefined();
      expect(fold.collapsedText).toBeUndefined();
    }
  });

  it('still works correctly for plain .st files (regression)', () => {
    const doc = TextDocument.create('file:///test.st', 'iec-st', 1,
      'PROGRAM Main\nVAR x : INT; END_VAR\nEND_PROGRAM');
    const ranges = handleFoldingRanges(doc);
    expect(ranges.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// TcPOU: merging adjacent XML ranges separated by empty CDATAs
// ---------------------------------------------------------------------------

describe('handleFoldingRanges — mergeAdjacentXmlRanges (empty CDATAs)', () => {
  // A TcPOU with an empty CDATA section between two XML sections
  const xmlWithEmptyCdata = [
    '<?xml version="1.0" encoding="utf-8"?>',  // line 0
    '<TcPlcObject>',                            // line 1
    '  <POU Name="Empty">',                     // line 2
    '    <Declaration><![CDATA[',               // line 3
    'FUNCTION_BLOCK Empty',                     // line 4
    'END_FUNCTION_BLOCK',                       // line 5
    ']]></Declaration>',                        // line 6
    '    <Implementation>',                     // line 7
    '      <ST><![CDATA[]]></ST>',              // line 8 — empty CDATA
    '    </Implementation>',                    // line 9
    '  </POU>',                                 // line 10
    '</TcPlcObject>',                           // line 11
  ].join('\n');

  it('merges adjacent XML ranges separated by empty CDATA into one fold', () => {
    const ranges = handleFoldingRanges(makeTcPouDoc(xmlWithEmptyCdata));
    const xmlFolds = ranges.filter(r => r.kind === FoldingRangeKind.Imports);
    // The inter-section XML (]]></Declaration> ... <![CDATA[) and postamble
    // (]]></ST></Implementation>...) share an empty CDATA gap → they merge
    // into a single fold from ]]></Declaration> to end of file.
    // Preamble: lines 0-3 (before first <![CDATA[)
    // Merged inter+postamble: from ]]></Declaration> (line 6) to end
    expect(xmlFolds.length).toBe(2); // preamble + merged inter+postamble
  });

  it('preamble fold is still separate (has non-empty CDATA content)', () => {
    const ranges = handleFoldingRanges(makeTcPouDoc(xmlWithEmptyCdata));
    const preamble = ranges.find(r => r.startLine === 0 && r.kind === FoldingRangeKind.Imports);
    expect(preamble).toBeDefined();
    expect(preamble!.endLine).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// TcPOU: translated ST control-flow folds (IF / FOR / VAR)
// ---------------------------------------------------------------------------

describe('handleFoldingRanges — TcPOU translated ST folds', () => {
  // TcPOU with IF and FOR in the implementation body.
  // The implementation CDATA opens on its own line (line 10) so the ST content
  // begins on line 11 in the original file.
  const xmlWithControlFlow = [
    '<?xml version="1.0" encoding="utf-8"?>',  // line 0
    '<TcPlcObject>',                            // line 1
    '  <POU Name="Bar">',                       // line 2
    '    <Declaration><![CDATA[',               // line 3
    'FUNCTION_BLOCK Bar',                       // line 4
    'VAR',                                      // line 5
    '  x : INT;',                               // line 6
    'END_VAR',                                  // line 7
    ']]></Declaration>',                        // line 8
    '    <Implementation>',                     // line 9
    '      <ST><![CDATA[',                      // line 10
    'IF x > 0 THEN',                            // line 11
    '  x := x - 1;',                           // line 12
    'END_IF',                                   // line 13
    'FOR x := 0 TO 10 DO',                     // line 14
    '  ;',                                      // line 15
    'END_FOR',                                  // line 16
    ']]></ST>',                                 // line 17
    '    </Implementation>',                    // line 18
    '  </POU>',                                 // line 19
    '</TcPlcObject>',                           // line 20
  ].join('\n');

  it('folds IF...END_IF at translated original-file lines', () => {
    const ranges = handleFoldingRanges(makeTcPouDoc(xmlWithControlFlow));
    // IF at line 11, END_IF at line 13 in the original file
    const ifFold = ranges.find(r => r.startLine === 11 && r.endLine === 13);
    expect(ifFold).toBeDefined();
    expect(ifFold!.kind).toBe(FoldingRangeKind.Region);
  });

  it('folds FOR...END_FOR at translated original-file lines', () => {
    const ranges = handleFoldingRanges(makeTcPouDoc(xmlWithControlFlow));
    // FOR at line 14, END_FOR at line 16 in the original file
    const forFold = ranges.find(r => r.startLine === 14 && r.endLine === 16);
    expect(forFold).toBeDefined();
    expect(forFold!.kind).toBe(FoldingRangeKind.Region);
  });

  it('folds VAR block at translated original-file lines', () => {
    const ranges = handleFoldingRanges(makeTcPouDoc(xmlWithControlFlow));
    // VAR at line 5, END_VAR at line 7 in the original file
    const varFold = ranges.find(r => r.startLine === 5 && r.endLine === 7);
    expect(varFold).toBeDefined();
    expect(varFold!.kind).toBe(FoldingRangeKind.Region);
  });

  it('does not produce negative-range folds', () => {
    const ranges = handleFoldingRanges(makeTcPouDoc(xmlWithControlFlow));
    for (const r of ranges) {
      expect(r.endLine).toBeGreaterThan(r.startLine);
    }
  });
});
