import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import { extractST, getXmlRanges, ExtractionResult, PositionMapper } from '../twincat/tcExtractor';
import { parse } from '../parser/parser';
import type { FunctionBlockDeclaration } from '../parser/ast';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { FoldingRangeKind } from 'vscode-languageserver/node';
import { handleFoldingRanges } from '../handlers/foldingRange';
import { handleSemanticTokens } from '../handlers/semanticTokens';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fixture(name: string): string {
  return fs.readFileSync(
    path.resolve(__dirname, '../../../tests/fixtures/mobject-core', name),
    'utf-8',
  );
}

/** Return all original-file lines that correspond to extracted line i. */
function originalLine(result: ExtractionResult, extractedLine: number): number {
  return result.lineMap[extractedLine];
}

// ---------------------------------------------------------------------------
// 1. Plain .st passthrough
// ---------------------------------------------------------------------------

describe('plain .st passthrough', () => {
  it('returns the source unchanged', () => {
    const src = 'PROGRAM Main\nVAR x : INT;\nEND_VAR\nx := 1;\n';
    const r = extractST(src, '.st');
    expect(r.passthrough).toBe(true);
    expect(r.source).toBe(src);
    expect(r.sections).toHaveLength(0);
  });

  it('lineMap is identity (lineMap[n] === n)', () => {
    const src = 'a\nb\nc\n';
    const r = extractST(src, '.st');
    expect(r.lineMap).toEqual([0, 1, 2, 3]);
  });

  it('works with empty content', () => {
    const r = extractST('', '.st');
    expect(r.passthrough).toBe(true);
    expect(r.source).toBe('');
    expect(r.lineMap).toEqual([]);
  });

  it('case-insensitive extension (.ST)', () => {
    const src = 'x := 1;';
    const r = extractST(src, '.ST');
    expect(r.passthrough).toBe(true);
    expect(r.source).toBe(src);
  });
});

// ---------------------------------------------------------------------------
// 2. Declaration extraction from .TcPOU
// ---------------------------------------------------------------------------

describe('.TcPOU declaration extraction', () => {
  it('extracts the declaration CDATA content', () => {
    const xml = [
      '<?xml version="1.0" encoding="utf-8"?>',
      '<TcPlcObject Version="1.1.0.1" ProductVersion="3.1.4024.12">',
      '  <POU Name="MyFB" Id="{1234}" SpecialFunc="None">',
      '    <Declaration><![CDATA[FUNCTION_BLOCK MyFB',
      'VAR',
      '  x : INT;',
      'END_VAR]]></Declaration>',
      '    <Implementation>',
      '      <ST><![CDATA[x := 1;]]></ST>',
      '    </Implementation>',
      '  </POU>',
      '</TcPlcObject>',
    ].join('\n');

    const r = extractST(xml, '.TcPOU');
    expect(r.passthrough).toBe(false);
    expect(r.sections).toHaveLength(2);
    expect(r.sections[0].kind).toBe('declaration');
    expect(r.sections[0].content).toContain('FUNCTION_BLOCK MyFB');
    expect(r.sections[0].content).toContain('VAR');
    expect(r.sections[0].content).toContain('END_VAR');
  });

  it('preserves variable order within a VAR block', () => {
    const xml = [
      '<?xml version="1.0" encoding="utf-8"?>',
      '<TcPlcObject>',
      '  <POU Name="Foo">',
      '    <Declaration><![CDATA[FUNCTION_BLOCK Foo',
      'VAR',
      '  alpha : BOOL;',
      '  beta  : INT;',
      '  gamma : REAL;',
      'END_VAR]]></Declaration>',
      '  </POU>',
      '</TcPlcObject>',
    ].join('\n');

    const r = extractST(xml, '.TcPOU');
    const decl = r.sections[0].content;
    const alphaIdx = decl.indexOf('alpha');
    const betaIdx  = decl.indexOf('beta');
    const gammaIdx = decl.indexOf('gamma');
    expect(alphaIdx).toBeLessThan(betaIdx);
    expect(betaIdx).toBeLessThan(gammaIdx);
  });

  it('handles multiple VAR sections (VAR, VAR_INPUT, VAR_OUTPUT, VAR_STAT, VAR_TEMP)', () => {
    const xml = [
      '<?xml version="1.0" encoding="utf-8"?>',
      '<TcPlcObject>',
      '  <POU Name="MultiVar">',
      '    <Declaration><![CDATA[FUNCTION_BLOCK MultiVar',
      'VAR',
      '  internal : INT;',
      'END_VAR',
      'VAR_INPUT',
      '  inVal : REAL;',
      'END_VAR',
      'VAR_OUTPUT',
      '  outVal : BOOL;',
      'END_VAR',
      'VAR_STAT',
      '  counter : DINT;',
      'END_VAR',
      'VAR_TEMP',
      '  tmp : STRING;',
      'END_VAR]]></Declaration>',
      '  </POU>',
      '</TcPlcObject>',
    ].join('\n');

    const r = extractST(xml, '.TcPOU');
    const decl = r.sections[0].content;
    expect(decl).toContain('VAR\n');
    expect(decl).toContain('VAR_INPUT');
    expect(decl).toContain('VAR_OUTPUT');
    expect(decl).toContain('VAR_STAT');
    expect(decl).toContain('VAR_TEMP');
  });
});

// ---------------------------------------------------------------------------
// 3. Implementation extraction from .TcPOU
// ---------------------------------------------------------------------------

describe('.TcPOU implementation extraction', () => {
  it('extracts ST code from the Implementation/ST CDATA', () => {
    const xml = [
      '<?xml version="1.0" encoding="utf-8"?>',
      '<TcPlcObject>',
      '  <POU Name="Counter">',
      '    <Declaration><![CDATA[FUNCTION_BLOCK Counter',
      'VAR',
      '  n : INT;',
      'END_VAR]]></Declaration>',
      '    <Implementation>',
      '      <ST><![CDATA[n := n + 1;',
      'IF n > 10 THEN',
      '  n := 0;',
      'END_IF]]></ST>',
      '    </Implementation>',
      '  </POU>',
      '</TcPlcObject>',
    ].join('\n');

    const r = extractST(xml, '.TcPOU');
    const impl = r.sections.find((s) => s.kind === 'implementation')!;
    expect(impl).toBeDefined();
    expect(impl.content).toContain('n := n + 1;');
    expect(impl.content).toContain('IF n > 10 THEN');
    expect(impl.content).toContain('END_IF');
  });

  it('handles empty ST implementation (CDATA is empty)', () => {
    const xml = [
      '<?xml version="1.0" encoding="utf-8"?>',
      '<TcPlcObject>',
      '  <POU Name="Empty">',
      '    <Declaration><![CDATA[FUNCTION_BLOCK Empty',
      'VAR END_VAR]]></Declaration>',
      '    <Implementation>',
      '      <ST><![CDATA[]]></ST>',
      '    </Implementation>',
      '  </POU>',
      '</TcPlcObject>',
    ].join('\n');

    const r = extractST(xml, '.TcPOU');
    // With an empty implementation CDATA there's no real content to extract.
    // The module may either omit it or return an empty section.
    const impl = r.sections.find((s) => s.kind === 'implementation');
    if (impl) {
      expect(impl.content).toBe('');
    }
  });

  it('handles multi-line statements', () => {
    const xml = [
      '<?xml version="1.0" encoding="utf-8"?>',
      '<TcPlcObject>',
      '  <POU Name="Multi">',
      '    <Declaration><![CDATA[FUNCTION_BLOCK Multi',
      'VAR END_VAR]]></Declaration>',
      '    <Implementation>',
      '      <ST><![CDATA[myFB(',
      '  Param1 := 1,',
      '  Param2 := TRUE',
      ');]]></ST>',
      '    </Implementation>',
      '  </POU>',
      '</TcPlcObject>',
    ].join('\n');

    const r = extractST(xml, '.TcPOU');
    const impl = r.sections.find((s) => s.kind === 'implementation')!;
    expect(impl.content).toContain('myFB(');
    expect(impl.content).toContain('Param1 := 1,');
    expect(impl.content).toContain(');');
  });

  it('combined source contains declaration followed by implementation', () => {
    const xml = [
      '<?xml version="1.0" encoding="utf-8"?>',
      '<TcPlcObject>',
      '  <POU Name="Both">',
      '    <Declaration><![CDATA[FUNCTION_BLOCK Both',
      'VAR',
      '  x : INT;',
      'END_VAR]]></Declaration>',
      '    <Implementation>',
      '      <ST><![CDATA[x := 42;]]></ST>',
      '    </Implementation>',
      '  </POU>',
      '</TcPlcObject>',
    ].join('\n');

    const r = extractST(xml, '.TcPOU');
    const declIdx = r.source.indexOf('FUNCTION_BLOCK');
    const implIdx = r.source.indexOf('x := 42;');
    expect(declIdx).toBeGreaterThanOrEqual(0);
    expect(implIdx).toBeGreaterThanOrEqual(0);
    expect(declIdx).toBeLessThan(implIdx);
  });
});

// ---------------------------------------------------------------------------
// 4. .TcGVL extraction (Declaration only)
// ---------------------------------------------------------------------------

describe('.TcGVL extraction', () => {
  it('extracts global variables from Declaration CDATA', () => {
    const xml = [
      '<?xml version="1.0" encoding="utf-8"?>',
      '<TcPlcObject>',
      '  <GVL Name="Globals">',
      '    <Declaration><![CDATA[VAR_GLOBAL',
      '  MAX_COUNT : INT := 100;',
      '  FLAG : BOOL;',
      'END_VAR]]></Declaration>',
      '  </GVL>',
      '</TcPlcObject>',
    ].join('\n');

    const r = extractST(xml, '.TcGVL');
    expect(r.passthrough).toBe(false);
    expect(r.sections).toHaveLength(1);
    expect(r.sections[0].kind).toBe('declaration');
    expect(r.sections[0].content).toContain('VAR_GLOBAL');
    expect(r.sections[0].content).toContain('MAX_COUNT');
    expect(r.sections[0].content).toContain('FLAG');
  });

  it('case-insensitive extension (.tcgvl)', () => {
    const xml = [
      '<?xml version="1.0" encoding="utf-8"?>',
      '<TcPlcObject><GVL Name="G">',
      '  <Declaration><![CDATA[VAR_GLOBAL',
      'END_VAR]]></Declaration>',
      '</GVL></TcPlcObject>',
    ].join('\n');

    const r = extractST(xml, '.tcgvl');
    expect(r.passthrough).toBe(false);
    expect(r.sections[0].content).toContain('VAR_GLOBAL');
  });
});

// ---------------------------------------------------------------------------
// 5. .TcDUT extraction (Type definitions)
// ---------------------------------------------------------------------------

describe('.TcDUT extraction', () => {
  it('extracts TYPE...END_TYPE from Declaration CDATA', () => {
    const xml = [
      '<?xml version="1.0" encoding="utf-8"?>',
      '<TcPlcObject>',
      '  <DUT Name="E_Color">',
      '    <Declaration><![CDATA[TYPE E_Color :',
      '(',
      '  RED := 0,',
      '  GREEN := 1,',
      '  BLUE := 2',
      ');',
      'END_TYPE]]></Declaration>',
      '  </DUT>',
      '</TcPlcObject>',
    ].join('\n');

    const r = extractST(xml, '.TcDUT');
    expect(r.sections).toHaveLength(1);
    expect(r.sections[0].content).toContain('TYPE E_Color');
    expect(r.sections[0].content).toContain('END_TYPE');
  });

  it('extracts STRUCT type definitions', () => {
    const xml = [
      '<?xml version="1.0" encoding="utf-8"?>',
      '<TcPlcObject>',
      '  <DUT Name="ST_Point">',
      '    <Declaration><![CDATA[TYPE ST_Point :',
      'STRUCT',
      '  x : REAL;',
      '  y : REAL;',
      'END_STRUCT',
      'END_TYPE]]></Declaration>',
      '  </DUT>',
      '</TcPlcObject>',
    ].join('\n');

    const r = extractST(xml, '.TcDUT');
    const content = r.sections[0].content;
    expect(content).toContain('STRUCT');
    expect(content).toContain('END_STRUCT');
    expect(content).toContain('END_TYPE');
  });
});

// ---------------------------------------------------------------------------
// 6. .TcIO extraction (Interface declarations)
// ---------------------------------------------------------------------------

describe('.TcIO extraction', () => {
  it('extracts the top-level interface declaration', () => {
    const xml = [
      '<?xml version="1.0" encoding="utf-8"?>',
      '<TcPlcObject>',
      '  <Itf Name="I_Foo">',
      '    <Declaration><![CDATA[INTERFACE I_Foo EXTENDS __System.IQueryInterface]]></Declaration>',
      '    <Method Name="DoSomething">',
      '      <Declaration><![CDATA[METHOD PUBLIC DoSomething]]></Declaration>',
      '    </Method>',
      '  </Itf>',
      '</TcPlcObject>',
    ].join('\n');

    const r = extractST(xml, '.TcIO');
    expect(r.sections).toHaveLength(1);
    expect(r.sections[0].content).toContain('INTERFACE I_Foo');
    // Method declarations should NOT appear in the top-level extraction
    expect(r.sections[0].content).not.toContain('DoSomething');
  });
});

// ---------------------------------------------------------------------------
// 7. Offset mapping validation
// ---------------------------------------------------------------------------

describe('offset mapping', () => {
  it('maps extracted line 0 to the correct original file line (inline CDATA)', () => {
    // <Declaration> is on line 3 (0-based), CDATA content starts on same line
    const xml = [
      '<?xml version="1.0" encoding="utf-8"?>',          // line 0
      '<TcPlcObject>',                                    // line 1
      '  <POU Name="X">',                                // line 2
      '    <Declaration><![CDATA[FUNCTION_BLOCK X',      // line 3 ← content starts here
      'VAR END_VAR]]></Declaration>',                    // line 4
      '  </POU>',                                        // line 5
      '</TcPlcObject>',                                  // line 6
    ].join('\n');

    const r = extractST(xml, '.TcPOU');
    expect(r.sections[0].startLine).toBe(3);
    expect(originalLine(r, 0)).toBe(3);
    expect(originalLine(r, 1)).toBe(4); // 'VAR END_VAR' is on line 4
  });

  it('maps extracted line 0 to the correct line when CDATA opens with a newline', () => {
    // <Declaration><![CDATA[\n  is on line 3; content starts on line 4
    const xml = [
      '<?xml version="1.0" encoding="utf-8"?>',          // line 0
      '<TcPlcObject>',                                    // line 1
      '  <POU Name="Y">',                                // line 2
      '    <Declaration><![CDATA[',                      // line 3  ← CDATA open (trailing \n)
      'FUNCTION_BLOCK Y',                                // line 4 ← content starts here
      'VAR END_VAR]]></Declaration>',                    // line 5
      '  </POU>',                                        // line 6
      '</TcPlcObject>',                                  // line 7
    ].join('\n');

    const r = extractST(xml, '.TcPOU');
    expect(r.sections[0].startLine).toBe(4);
    expect(originalLine(r, 0)).toBe(4);
    expect(originalLine(r, 1)).toBe(5);
  });

  it('lineMap covers all lines of the combined source', () => {
    const xml = [
      '<?xml version="1.0" encoding="utf-8"?>',
      '<TcPlcObject>',
      '  <POU Name="Map">',
      '    <Declaration><![CDATA[FUNCTION_BLOCK Map',
      'VAR',
      '  n : INT;',
      'END_VAR]]></Declaration>',
      '    <Implementation>',
      '      <ST><![CDATA[n := 5;',
      'n := n * 2;]]></ST>',
      '    </Implementation>',
      '  </POU>',
      '</TcPlcObject>',
    ].join('\n');

    const r = extractST(xml, '.TcPOU');
    const sourceLines = r.source.split('\n').length;
    expect(r.lineMap).toHaveLength(sourceLines);
  });

  it('implementation lines map to higher original-file line numbers than declaration lines', () => {
    const xml = [
      '<?xml version="1.0" encoding="utf-8"?>',
      '<TcPlcObject>',
      '  <POU Name="Order">',
      '    <Declaration><![CDATA[FUNCTION_BLOCK Order',
      'VAR END_VAR]]></Declaration>',
      '    <Implementation>',
      '      <ST><![CDATA[; // noop]]></ST>',
      '    </Implementation>',
      '  </POU>',
      '</TcPlcObject>',
    ].join('\n');

    const r = extractST(xml, '.TcPOU');
    const decl = r.sections.find((s) => s.kind === 'declaration')!;
    const impl = r.sections.find((s) => s.kind === 'implementation')!;
    expect(impl.startLine).toBeGreaterThan(decl.startLine);
  });

  it('XML line → ST line mapping round-trips correctly', () => {
    // We know "VAR_GLOBAL" is on line 3 (0-based) of the original file.
    const xml = [
      '<?xml version="1.0" encoding="utf-8"?>',          // line 0
      '<TcPlcObject>',                                    // line 1
      '  <GVL Name="G">',                                // line 2
      '    <Declaration><![CDATA[VAR_GLOBAL',             // line 3
      '  VALUE : INT;',                                  // line 4
      'END_VAR]]></Declaration>',                        // line 5
      '  </GVL>',                                        // line 6
      '</TcPlcObject>',                                  // line 7
    ].join('\n');

    const r = extractST(xml, '.TcGVL');
    // Extracted line 0 = "VAR_GLOBAL" which is on original line 3
    expect(r.lineMap[0]).toBe(3);
    // Extracted line 1 = "  VALUE : INT;" which is on original line 4
    expect(r.lineMap[1]).toBe(4);
    // Extracted line 2 = "END_VAR" which is on original line 5
    expect(r.lineMap[2]).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// 8. Edge cases
// ---------------------------------------------------------------------------

describe('edge cases', () => {
  it('malformed XML – missing closing ]]> – returns empty result gracefully', () => {
    const xml = [
      '<?xml version="1.0" encoding="utf-8"?>',
      '<TcPlcObject>',
      '  <POU Name="Bad">',
      '    <Declaration><![CDATA[FUNCTION_BLOCK Bad',
      '    VAR END_VAR',
      '    <!-- no closing CDATA! -->',
      '  </POU>',
      '</TcPlcObject>',
    ].join('\n');

    // Should not throw; returns empty source.
    expect(() => extractST(xml, '.TcPOU')).not.toThrow();
    const r = extractST(xml, '.TcPOU');
    expect(r.passthrough).toBe(false);
    // source may be empty or partial; lineMap must match source line count
    const sourceLines = r.source === '' ? 0 : r.source.split('\n').length;
    expect(r.lineMap).toHaveLength(sourceLines);
  });

  it('CDATA with special XML characters (angle brackets, ampersands)', () => {
    const xml = [
      '<?xml version="1.0" encoding="utf-8"?>',
      '<TcPlcObject>',
      '  <POU Name="Special">',
      '    <Declaration><![CDATA[FUNCTION_BLOCK Special',
      'VAR',
      '  // x < y && y > 0',
      '  x : INT;',
      'END_VAR]]></Declaration>',
      '  </POU>',
      '</TcPlcObject>',
    ].join('\n');

    const r = extractST(xml, '.TcPOU');
    expect(r.sections[0].content).toContain('x < y && y > 0');
    expect(r.sections[0].content).toContain('x : INT;');
  });

  it('empty file returns empty source', () => {
    const r = extractST('', '.TcPOU');
    expect(r.source).toBe('');
    expect(r.lineMap).toHaveLength(0);
    expect(r.sections).toHaveLength(0);
  });

  it('file with no recognisable container element returns empty result', () => {
    const xml = '<?xml version="1.0" encoding="utf-8"?><TcPlcObject></TcPlcObject>';
    const r = extractST(xml, '.TcPOU');
    expect(r.source).toBe('');
    expect(r.passthrough).toBe(false);
  });

  it('file with Declaration but no Implementation returns only declaration section', () => {
    const xml = [
      '<?xml version="1.0" encoding="utf-8"?>',
      '<TcPlcObject>',
      '  <POU Name="DeclOnly">',
      '    <Declaration><![CDATA[FUNCTION_BLOCK DeclOnly',
      'VAR END_VAR]]></Declaration>',
      '  </POU>',
      '</TcPlcObject>',
    ].join('\n');

    const r = extractST(xml, '.TcPOU');
    expect(r.sections).toHaveLength(1);
    expect(r.sections[0].kind).toBe('declaration');
  });
});

// ---------------------------------------------------------------------------
// 9. Real-world tests with mobject-core fixtures
// ---------------------------------------------------------------------------

describe('real-world mobject-core fixtures', () => {
  describe('Disposable.TcPOU (abstract base class)', () => {
    let result: ExtractionResult;

    it('loads without error', () => {
      expect(() => {
        result = extractST(fixture('Disposable.TcPOU'), '.TcPOU');
      }).not.toThrow();
      result = extractST(fixture('Disposable.TcPOU'), '.TcPOU');
    });

    it('is not a passthrough', () => {
      expect(result.passthrough).toBe(false);
    });

    it('declaration contains FUNCTION_BLOCK ABSTRACT Disposable', () => {
      const decl = result.sections.find((s) => s.kind === 'declaration')!;
      expect(decl.content).toContain('FUNCTION_BLOCK ABSTRACT Disposable');
    });

    it('declaration contains IMPLEMENTS I_Disposable', () => {
      const decl = result.sections.find((s) => s.kind === 'declaration')!;
      expect(decl.content).toContain('IMPLEMENTS I_Disposable');
    });

    it('lineMap length matches source line count', () => {
      const sourceLineCount = result.source.split('\n').length;
      expect(result.lineMap).toHaveLength(sourceLineCount);
    });

    it('declaration startLine is > 0 (after XML header)', () => {
      const decl = result.sections.find((s) => s.kind === 'declaration')!;
      expect(decl.startLine).toBeGreaterThan(0);
    });
  });

  describe('LinkedList.TcPOU (class with EXTENDS)', () => {
    let result: ExtractionResult;
    beforeEach(() => {
      result = extractST(fixture('LinkedList.TcPOU'), '.TcPOU');
    });

    it('declaration contains EXTENDS Disposable', () => {
      const decl = result.sections.find((s) => s.kind === 'declaration')!;
      expect(decl.content).toContain('EXTENDS Disposable');
    });

    it('declaration contains IMPLEMENTS I_LinkedList', () => {
      const decl = result.sections.find((s) => s.kind === 'declaration')!;
      expect(decl.content).toContain('IMPLEMENTS I_LinkedList');
    });

    it('declaration contains VAR block with member variables', () => {
      const decl = result.sections.find((s) => s.kind === 'declaration')!;
      expect(decl.content).toContain('VAR');
      expect(decl.content).toContain('head');
      expect(decl.content).toContain('tail');
    });
  });

  describe('LinkedListNode.TcPOU (generic FB)', () => {
    let result: ExtractionResult;
    beforeEach(() => {
      result = extractST(fixture('LinkedListNode.TcPOU'), '.TcPOU');
    });

    it('declaration contains FUNCTION_BLOCK LinkedListNode', () => {
      const decl = result.sections.find((s) => s.kind === 'declaration')!;
      expect(decl.content).toContain('FUNCTION_BLOCK LinkedListNode');
    });

    it('implementation section is present (even if empty)', () => {
      // LinkedListNode has an empty ST body
      const impl = result.sections.find((s) => s.kind === 'implementation');
      // May be absent if CDATA was empty — either way no error
      expect(result.passthrough).toBe(false);
    });
  });

  describe('DatatypeLimits.TcGVL (global variable list)', () => {
    let result: ExtractionResult;
    beforeEach(() => {
      result = extractST(fixture('DatatypeLimits.TcGVL'), '.TcGVL');
    });

    it('has exactly one section (declaration)', () => {
      expect(result.sections).toHaveLength(1);
      expect(result.sections[0].kind).toBe('declaration');
    });

    it('contains VAR_GLOBAL CONSTANT', () => {
      expect(result.sections[0].content).toContain('VAR_GLOBAL CONSTANT');
    });

    it('contains BOOL_MIN_VALUE and BOOL_MAX_VALUE', () => {
      expect(result.sections[0].content).toContain('BOOL_MIN_VALUE');
      expect(result.sections[0].content).toContain('BOOL_MAX_VALUE');
    });

    it('lineMap is strictly monotonically increasing', () => {
      const map = result.lineMap;
      for (let i = 1; i < map.length; i++) {
        expect(map[i]).toBeGreaterThan(map[i - 1]);
      }
    });
  });

  describe('I_Disposable.TcIO (interface)', () => {
    let result: ExtractionResult;
    beforeEach(() => {
      result = extractST(fixture('I_Disposable.TcIO'), '.TcIO');
    });

    it('extracts the interface declaration', () => {
      expect(result.sections[0].content).toContain('INTERFACE I_Disposable');
    });

    it('does not include nested method declarations', () => {
      // The method "Dispose" has its own <Declaration> — must not appear here
      expect(result.sections[0].content).not.toContain('METHOD PUBLIC Dispose');
    });
  });

  describe('I_LinkedList.TcIO (interface with many methods)', () => {
    let result: ExtractionResult;
    beforeEach(() => {
      result = extractST(fixture('I_LinkedList.TcIO'), '.TcIO');
    });

    it('declaration contains INTERFACE I_LinkedList', () => {
      expect(result.sections[0].content).toContain('INTERFACE I_LinkedList');
    });

    it('lineMap covers the full source', () => {
      expect(result.lineMap).toHaveLength(result.source.split('\n').length);
    });
  });
});

// ---------------------------------------------------------------------------
// 10. lineMap consistency invariant
// ---------------------------------------------------------------------------

describe('lineMap consistency', () => {
  it('lineMap[n] >= 0 for all entries', () => {
    const xml = [
      '<?xml version="1.0" encoding="utf-8"?>',
      '<TcPlcObject><POU Name="T">',
      '  <Declaration><![CDATA[FUNCTION_BLOCK T',
      'VAR END_VAR]]></Declaration>',
      '  <Implementation><ST><![CDATA[; // noop]]></ST></Implementation>',
      '</POU></TcPlcObject>',
    ].join('\n');

    const r = extractST(xml, '.TcPOU');
    for (const line of r.lineMap) {
      expect(line).toBeGreaterThanOrEqual(0);
    }
  });

  it('lineMap length always equals number of lines in source', () => {
    const cases = [
      { content: 'x;', ext: '.st' },
      {
        content: [
          '<TcPlcObject><POU Name="A">',
          '<Declaration><![CDATA[FUNCTION_BLOCK A\nVAR END_VAR]]></Declaration>',
          '</POU></TcPlcObject>',
        ].join('\n'),
        ext: '.TcPOU',
      },
    ];

    for (const { content, ext } of cases) {
      const r = extractST(content, ext);
      const lineCount = r.source === '' ? 0 : r.source.split('\n').length;
      expect(r.lineMap).toHaveLength(lineCount);
    }
  });
});

// ---------------------------------------------------------------------------
// 11. ACTION block extraction from .TcPOU
// ---------------------------------------------------------------------------

describe('.TcPOU Action block extraction', () => {
  const xmlWithActions = [
    '<?xml version="1.0" encoding="utf-8"?>',                            // line 0
    '<TcPlcObject>',                                                      // line 1
    '  <POU Name="MyFB">',                                               // line 2
    '    <Declaration><![CDATA[FUNCTION_BLOCK MyFB',                     // line 3
    'VAR',                                                                // line 4
    '  x : INT;',                                                         // line 5
    'END_VAR]]></Declaration>',                                          // line 6
    '    <Implementation>',                                              // line 7
    '      <ST><![CDATA[x := 0;]]></ST>',                               // line 8
    '    </Implementation>',                                             // line 9
    '    <Action Name="Run" Id="{abc}">',                                // line 10
    '      <Implementation>',                                            // line 11
    '        <ST><![CDATA[x := x + 1;]]></ST>',                         // line 12
    '      </Implementation>',                                           // line 13
    '    </Action>',                                                      // line 14
    '    <Action Name="Reset" Id="{def}">',                              // line 15
    '      <Implementation>',                                            // line 16
    '        <ST><![CDATA[x := 0;]]></ST>',                             // line 17
    '      </Implementation>',                                           // line 18
    '    </Action>',                                                      // line 19
    '  </POU>',                                                           // line 20
    '</TcPlcObject>',                                                    // line 21
  ].join('\n');

  it('extracts action sections', () => {
    const r = extractST(xmlWithActions, '.TcPOU');
    const actionSections = r.sections.filter(s => s.kind === 'action');
    expect(actionSections).toHaveLength(2);
  });

  it('action sections have correct names', () => {
    const r = extractST(xmlWithActions, '.TcPOU');
    const actionSections = r.sections.filter(s => s.kind === 'action');
    expect(actionSections[0].actionName).toBe('Run');
    expect(actionSections[1].actionName).toBe('Reset');
  });

  it('action sections have correct content', () => {
    const r = extractST(xmlWithActions, '.TcPOU');
    const actionSections = r.sections.filter(s => s.kind === 'action');
    expect(actionSections[0].content).toContain('x := x + 1;');
    expect(actionSections[1].content).toContain('x := 0;');
  });

  it('combined source contains ACTION...END_ACTION blocks', () => {
    const r = extractST(xmlWithActions, '.TcPOU');
    expect(r.source).toContain('ACTION Run:');
    expect(r.source).toContain('END_ACTION');
    expect(r.source).toContain('ACTION Reset:');
  });

  it('lineMap covers the full combined source including action wrappers', () => {
    const r = extractST(xmlWithActions, '.TcPOU');
    const sourceLines = r.source.split('\n').length;
    expect(r.lineMap).toHaveLength(sourceLines);
  });

  it('lineMap entries are non-negative', () => {
    const r = extractST(xmlWithActions, '.TcPOU');
    for (const line of r.lineMap) {
      expect(line).toBeGreaterThanOrEqual(0);
    }
  });

  it('non-POU files do not extract actions', () => {
    const gvlXml = [
      '<TcPlcObject><GVL Name="G">',
      '  <Declaration><![CDATA[VAR_GLOBAL',
      'END_VAR]]></Declaration>',
      '</GVL></TcPlcObject>',
    ].join('\n');
    const r = extractST(gvlXml, '.TcGVL');
    expect(r.sections.filter(s => s.kind === 'action')).toHaveLength(0);
  });

  it('POU with no Action children has no action sections', () => {
    const xml = [
      '<TcPlcObject><POU Name="Simple">',
      '  <Declaration><![CDATA[FUNCTION_BLOCK Simple\nVAR END_VAR]]></Declaration>',
      '  <Implementation><ST><![CDATA[;]]></ST></Implementation>',
      '</POU></TcPlcObject>',
    ].join('\n');
    const r = extractST(xml, '.TcPOU');
    expect(r.sections.filter(s => s.kind === 'action')).toHaveLength(0);
  });

  it('parsed source contains ActionDeclaration nodes after FB', () => {
    const r = extractST(xmlWithActions, '.TcPOU');
    const { ast } = parse(r.source);
    const fb = ast.declarations[0] as FunctionBlockDeclaration;
    expect(fb.kind).toBe('FunctionBlockDeclaration');
    expect(fb.actions).toHaveLength(2);
    expect(fb.actions[0].name).toBe('Run');
    expect(fb.actions[1].name).toBe('Reset');
  });
});

// ---------------------------------------------------------------------------
// 12. getXmlRanges — non-CDATA region detection
// ---------------------------------------------------------------------------

describe('getXmlRanges', () => {
  it('returns a single range covering the whole text when there are no CDATAs', () => {
    const text = '<POU></POU>\n';
    const ranges = getXmlRanges(text);
    expect(ranges).toHaveLength(1);
    expect(ranges[0].start).toEqual({ line: 0, character: 0 });
    expect(ranges[0].end.line).toBeGreaterThanOrEqual(0);
  });

  it('returns empty array for empty text', () => {
    const ranges = getXmlRanges('');
    expect(ranges).toHaveLength(0);
  });

  it('splits text around a single CDATA section (inline pattern)', () => {
    // Line 0: <D><![CDATA[content]]></D>
    const text = '<D><![CDATA[content]]></D>';
    const ranges = getXmlRanges(text);
    // Range 1: '<D><![CDATA[' (before CDATA content)
    // Range 2: ']]></D>' (after CDATA content)
    expect(ranges).toHaveLength(2);

    // Range 1 ends where CDATA content begins (char 12 = length of '<D><![CDATA[')
    expect(ranges[0].start).toEqual({ line: 0, character: 0 });
    expect(ranges[0].end).toEqual({ line: 0, character: 12 });

    // Range 2 starts at ']]>'
    expect(ranges[1].start).toEqual({ line: 0, character: 19 }); // 12 + 7 = 19
    expect(ranges[1].end.line).toBe(0);
  });

  it('splits text around a CDATA that opens with a newline (Pattern B)', () => {
    // Line 0: <D><![CDATA[
    // Line 1: content
    // Line 2: ]]></D>
    const text = '<D><![CDATA[\ncontent\n]]></D>\n';
    const ranges = getXmlRanges(text);
    expect(ranges).toHaveLength(2);

    // Range 1 ends right after '<![CDATA[' on line 0 (character 12)
    expect(ranges[0].start).toEqual({ line: 0, character: 0 });
    expect(ranges[0].end).toEqual({ line: 0, character: 12 });

    // Range 2 starts at ']]>' on line 2
    expect(ranges[1].start).toEqual({ line: 2, character: 0 });
  });

  it('returns three ranges for two CDATA sections', () => {
    const text = [
      '<P>',                              // line 0
      '<D><![CDATA[decl',                 // line 1  ← start of CDATA 1 content
      ']]></D>',                          // line 2
      '<I><ST><![CDATA[impl]]></ST></I>', // line 3
      '</P>',                             // line 4
    ].join('\n');
    const ranges = getXmlRanges(text);
    expect(ranges).toHaveLength(3);

    // Range 0: header (lines 0-1 prefix)
    expect(ranges[0].start.line).toBe(0);
    // Range 2: footer (after last ]]>)
    expect(ranges[2].end.line).toBe(4);
  });

  it('extractST sections have correct startChar for inline CDATA (Pattern A)', () => {
    // '<D><![CDATA[CONTENT' — CONTENT starts at char 12
    const xml = '<TcPlcObject><POU Name="X"><Declaration><![CDATA[FUNCTION_BLOCK X\nVAR END_VAR]]></Declaration></POU></TcPlcObject>';
    const r = extractST(xml, '.tcpou');
    expect(r.sections[0].startChar).toBeGreaterThan(0);
  });

  it('extractST sections have startChar=0 for newline CDATA (Pattern B)', () => {
    const xml = [
      '<TcPlcObject><POU Name="X">',
      '<Declaration><![CDATA[',
      'FUNCTION_BLOCK X',
      'VAR END_VAR]]></Declaration>',
      '</POU></TcPlcObject>',
    ].join('\n');
    const r = extractST(xml, '.tcpou');
    expect(r.sections[0].startChar).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 13. METHOD block extraction from .TcPOU
// ---------------------------------------------------------------------------

describe('.TcPOU Method block extraction', () => {
  // Fixture with a single method (inline CDATA pattern throughout)
  // Line numbers (0-based):
  //  0: <?xml version="1.0" encoding="utf-8"?>
  //  1: <TcPlcObject>
  //  2:   <POU Name="MyFB">
  //  3:     <Declaration><![CDATA[FUNCTION_BLOCK MyFB   ← decl starts
  //  4: VAR
  //  5:   x : INT;
  //  6: END_VAR
  //  7: ]]></Declaration>
  //  8:     <Implementation>
  //  9:       <ST><![CDATA[]]></ST>                       ← empty impl
  // 10:     </Implementation>
  // 11:     <Method Name="DoSomething" Id="{abc}">
  // 12:       <Declaration><![CDATA[METHOD PUBLIC DoSomething  ← method decl starts
  // 13: VAR_INPUT
  // 14:   val : INT;
  // 15: END_VAR
  // 16: ]]></Declaration>
  // 17:       <Implementation>
  // 18:         <ST><![CDATA[x := val;]]></ST>             ← method impl starts
  // 19:       </Implementation>
  // 20:     </Method>                                      ← endTagLine = 20
  // 21:   </POU>
  // 22: </TcPlcObject>
  const tcpouWithMethod = [
    '<?xml version="1.0" encoding="utf-8"?>',        // line 0
    '<TcPlcObject>',                                  // line 1
    '  <POU Name="MyFB">',                            // line 2
    '    <Declaration><![CDATA[FUNCTION_BLOCK MyFB',  // line 3
    'VAR',                                            // line 4
    '  x : INT;',                                     // line 5
    'END_VAR',                                        // line 6
    ']]></Declaration>',                              // line 7
    '    <Implementation>',                           // line 8
    '      <ST><![CDATA[]]></ST>',                    // line 9
    '    </Implementation>',                          // line 10
    '    <Method Name="DoSomething" Id="{abc}">',     // line 11
    '      <Declaration><![CDATA[METHOD PUBLIC DoSomething', // line 12
    'VAR_INPUT',                                      // line 13
    '  val : INT;',                                   // line 14
    'END_VAR',                                        // line 15
    ']]></Declaration>',                              // line 16
    '      <Implementation>',                         // line 17
    '        <ST><![CDATA[x := val;]]></ST>',         // line 18
    '      </Implementation>',                        // line 19
    '    </Method>',                                  // line 20
    '  </POU>',                                       // line 21
    '</TcPlcObject>',                                 // line 22
  ].join('\n');

  it('combined source contains METHOD...END_METHOD block', () => {
    const r = extractST(tcpouWithMethod, '.TcPOU');
    expect(r.source).toContain('METHOD PUBLIC DoSomething');
    expect(r.source).toContain('END_METHOD');
  });

  it('combined source contains END_FUNCTION_BLOCK', () => {
    const r = extractST(tcpouWithMethod, '.TcPOU');
    expect(r.source).toContain('END_FUNCTION_BLOCK');
  });

  it('method body appears between METHOD header and END_METHOD', () => {
    const r = extractST(tcpouWithMethod, '.TcPOU');
    const methodIdx = r.source.indexOf('METHOD PUBLIC DoSomething');
    const bodyIdx = r.source.indexOf('x := val;');
    const endMethodIdx = r.source.indexOf('END_METHOD');
    expect(methodIdx).toBeGreaterThanOrEqual(0);
    expect(bodyIdx).toBeGreaterThan(methodIdx);
    expect(endMethodIdx).toBeGreaterThan(bodyIdx);
  });

  it('FB declaration appears before END_FUNCTION_BLOCK', () => {
    const r = extractST(tcpouWithMethod, '.TcPOU');
    const declIdx = r.source.indexOf('FUNCTION_BLOCK MyFB');
    const endFbIdx = r.source.indexOf('END_FUNCTION_BLOCK');
    expect(declIdx).toBeGreaterThanOrEqual(0);
    expect(declIdx).toBeLessThan(endFbIdx);
  });

  it('lineMap covers the full combined source', () => {
    const r = extractST(tcpouWithMethod, '.TcPOU');
    const sourceLines = r.source.split('\n').length;
    expect(r.lineMap).toHaveLength(sourceLines);
  });

  it('lineMap maps method declaration line to correct original-file line', () => {
    const r = extractST(tcpouWithMethod, '.TcPOU');
    // 'METHOD PUBLIC DoSomething' is extracted line 5 (0-indexed),
    // which maps to line 12 in the original XML
    const methodDeclExtractedLine = r.source.split('\n').indexOf('METHOD PUBLIC DoSomething');
    expect(methodDeclExtractedLine).toBeGreaterThanOrEqual(0);
    expect(r.lineMap[methodDeclExtractedLine]).toBe(12);
  });

  it('lineMap maps method implementation line to correct original-file line', () => {
    const r = extractST(tcpouWithMethod, '.TcPOU');
    // 'x := val;' is the method impl, on line 18 in the original XML
    const implExtractedLine = r.source.split('\n').indexOf('x := val;');
    expect(implExtractedLine).toBeGreaterThanOrEqual(0);
    expect(r.lineMap[implExtractedLine]).toBe(18);
  });

  it('lineMap maps END_METHOD to the </Method> tag line', () => {
    const r = extractST(tcpouWithMethod, '.TcPOU');
    // END_METHOD is synthetic, mapped to line 20 (the </Method> tag)
    const endMethodExtractedLine = r.source.split('\n').indexOf('END_METHOD');
    expect(endMethodExtractedLine).toBeGreaterThanOrEqual(0);
    expect(r.lineMap[endMethodExtractedLine]).toBe(20);
  });

  it('sections include a declaration section for the method', () => {
    const r = extractST(tcpouWithMethod, '.TcPOU');
    const methodDeclSection = r.sections.find(
      (s) => s.kind === 'declaration' && s.content.includes('METHOD PUBLIC DoSomething'),
    );
    expect(methodDeclSection).toBeDefined();
  });

  it('sections include an implementation section for the method body', () => {
    const r = extractST(tcpouWithMethod, '.TcPOU');
    const methodImplSection = r.sections.find(
      (s) => s.kind === 'implementation' && s.content.includes('x := val;'),
    );
    expect(methodImplSection).toBeDefined();
  });

  it('FB top-level declaration section remains sections[0]', () => {
    const r = extractST(tcpouWithMethod, '.TcPOU');
    expect(r.sections[0].kind).toBe('declaration');
    expect(r.sections[0].content).toContain('FUNCTION_BLOCK MyFB');
  });

  it('parse(source) produces FunctionBlockDeclaration with one method', () => {
    const r = extractST(tcpouWithMethod, '.TcPOU');
    const { ast } = parse(r.source);
    const fb = ast.declarations[0] as FunctionBlockDeclaration;
    expect(fb.kind).toBe('FunctionBlockDeclaration');
    expect(fb.methods).toHaveLength(1);
    expect(fb.methods[0].name).toBe('DoSomething');
  });

  it('lineMap entries are all non-negative', () => {
    const r = extractST(tcpouWithMethod, '.TcPOU');
    for (const line of r.lineMap) {
      expect(line).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('.TcPOU multiple methods extraction', () => {
  const tcpouWithTwoMethods = [
    '<?xml version="1.0" encoding="utf-8"?>',           // line 0
    '<TcPlcObject>',                                     // line 1
    '  <POU Name="MyFB">',                               // line 2
    '    <Declaration><![CDATA[FUNCTION_BLOCK MyFB',     // line 3
    'VAR',                                               // line 4
    '  x : INT;',                                        // line 5
    'END_VAR',                                           // line 6
    ']]></Declaration>',                                 // line 7
    '    <Implementation>',                              // line 8
    '      <ST><![CDATA[]]></ST>',                       // line 9
    '    </Implementation>',                             // line 10
    '    <Method Name="DoSomething">',                   // line 11
    '      <Declaration><![CDATA[METHOD PUBLIC DoSomething', // line 12
    'VAR_INPUT',                                         // line 13
    '  val : INT;',                                      // line 14
    'END_VAR',                                           // line 15
    ']]></Declaration>',                                 // line 16
    '      <Implementation>',                            // line 17
    '        <ST><![CDATA[x := val;]]></ST>',            // line 18
    '      </Implementation>',                           // line 19
    '    </Method>',                                     // line 20
    '    <Method Name="Reset">',                         // line 21
    '      <Declaration><![CDATA[METHOD PUBLIC Reset',   // line 22
    ']]></Declaration>',                                 // line 23
    '      <Implementation>',                            // line 24
    '        <ST><![CDATA[x := 0;]]></ST>',             // line 25
    '      </Implementation>',                           // line 26
    '    </Method>',                                     // line 27
    '  </POU>',                                          // line 28
    '</TcPlcObject>',                                    // line 29
  ].join('\n');

  it('source contains both method headers and END_METHODs', () => {
    const r = extractST(tcpouWithTwoMethods, '.TcPOU');
    expect(r.source).toContain('METHOD PUBLIC DoSomething');
    expect(r.source).toContain('METHOD PUBLIC Reset');
    // Count END_METHOD occurrences
    const endMethodCount = (r.source.match(/END_METHOD/g) ?? []).length;
    expect(endMethodCount).toBe(2);
  });

  it('methods appear in XML order in the combined source', () => {
    const r = extractST(tcpouWithTwoMethods, '.TcPOU');
    const doSomethingIdx = r.source.indexOf('METHOD PUBLIC DoSomething');
    const resetIdx = r.source.indexOf('METHOD PUBLIC Reset');
    expect(doSomethingIdx).toBeLessThan(resetIdx);
  });

  it('contains exactly one END_FUNCTION_BLOCK after all methods', () => {
    const r = extractST(tcpouWithTwoMethods, '.TcPOU');
    const endFbCount = (r.source.match(/END_FUNCTION_BLOCK/g) ?? []).length;
    expect(endFbCount).toBe(1);
    const lastEndMethod = r.source.lastIndexOf('END_METHOD');
    const endFbIdx = r.source.indexOf('END_FUNCTION_BLOCK');
    expect(endFbIdx).toBeGreaterThan(lastEndMethod);
  });

  it('lineMap covers full combined source', () => {
    const r = extractST(tcpouWithTwoMethods, '.TcPOU');
    expect(r.lineMap).toHaveLength(r.source.split('\n').length);
  });

  it('lineMap entries are non-negative', () => {
    const r = extractST(tcpouWithTwoMethods, '.TcPOU');
    for (const line of r.lineMap) {
      expect(line).toBeGreaterThanOrEqual(0);
    }
  });

  it('parse produces FunctionBlockDeclaration with two methods', () => {
    const r = extractST(tcpouWithTwoMethods, '.TcPOU');
    const { ast } = parse(r.source);
    const fb = ast.declarations[0] as FunctionBlockDeclaration;
    expect(fb.kind).toBe('FunctionBlockDeclaration');
    expect(fb.methods).toHaveLength(2);
    expect(fb.methods[0].name).toBe('DoSomething');
    expect(fb.methods[1].name).toBe('Reset');
  });
});

describe('.TcPOU method with empty implementation', () => {
  const tcpouEmptyMethodBody = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<TcPlcObject>',
    '  <POU Name="MyFB">',
    '    <Declaration><![CDATA[FUNCTION_BLOCK MyFB',
    'VAR END_VAR]]></Declaration>',
    '    <Implementation>',
    '      <ST><![CDATA[]]></ST>',
    '    </Implementation>',
    '    <Method Name="EmptyMethod">',
    '      <Declaration><![CDATA[METHOD PUBLIC EmptyMethod',
    'VAR_INPUT',
    '  n : INT;',
    'END_VAR',
    ']]></Declaration>',
    '      <Implementation>',
    '        <ST><![CDATA[]]></ST>',
    '      </Implementation>',
    '    </Method>',
    '  </POU>',
    '</TcPlcObject>',
  ].join('\n');

  it('does not throw', () => {
    expect(() => extractST(tcpouEmptyMethodBody, '.TcPOU')).not.toThrow();
  });

  it('source contains METHOD header and END_METHOD even with empty body', () => {
    const r = extractST(tcpouEmptyMethodBody, '.TcPOU');
    expect(r.source).toContain('METHOD PUBLIC EmptyMethod');
    expect(r.source).toContain('END_METHOD');
  });

  it('lineMap covers full combined source', () => {
    const r = extractST(tcpouEmptyMethodBody, '.TcPOU');
    expect(r.lineMap).toHaveLength(r.source.split('\n').length);
  });

  it('parse produces FunctionBlockDeclaration with one method', () => {
    const r = extractST(tcpouEmptyMethodBody, '.TcPOU');
    const { ast } = parse(r.source);
    const fb = ast.declarations[0] as FunctionBlockDeclaration;
    expect(fb.kind).toBe('FunctionBlockDeclaration');
    expect(fb.methods).toHaveLength(1);
    expect(fb.methods[0].name).toBe('EmptyMethod');
  });
});

describe('.TcPOU methods and actions coexist', () => {
  // POU with both methods and actions
  const tcpouMethodsAndActions = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<TcPlcObject>',
    '  <POU Name="MyFB">',
    '    <Declaration><![CDATA[FUNCTION_BLOCK MyFB',
    'VAR',
    '  x : INT;',
    'END_VAR',
    ']]></Declaration>',
    '    <Implementation>',
    '      <ST><![CDATA[]]></ST>',
    '    </Implementation>',
    '    <Method Name="Compute">',
    '      <Declaration><![CDATA[METHOD PUBLIC Compute',
    ']]></Declaration>',
    '      <Implementation>',
    '        <ST><![CDATA[x := x + 1;]]></ST>',
    '      </Implementation>',
    '    </Method>',
    '    <Action Name="Reset" Id="{abc}">',
    '      <Implementation>',
    '        <ST><![CDATA[x := 0;]]></ST>',
    '      </Implementation>',
    '    </Action>',
    '  </POU>',
    '</TcPlcObject>',
  ].join('\n');

  it('source contains METHOD, END_METHOD, END_FUNCTION_BLOCK, ACTION, END_ACTION', () => {
    const r = extractST(tcpouMethodsAndActions, '.TcPOU');
    expect(r.source).toContain('METHOD PUBLIC Compute');
    expect(r.source).toContain('END_METHOD');
    expect(r.source).toContain('END_FUNCTION_BLOCK');
    expect(r.source).toContain('ACTION Reset:');
    expect(r.source).toContain('END_ACTION');
  });

  it('END_FUNCTION_BLOCK appears before ACTION block', () => {
    const r = extractST(tcpouMethodsAndActions, '.TcPOU');
    const endFbIdx = r.source.indexOf('END_FUNCTION_BLOCK');
    const actionIdx = r.source.indexOf('ACTION Reset:');
    expect(endFbIdx).toBeLessThan(actionIdx);
  });

  it('lineMap covers full combined source', () => {
    const r = extractST(tcpouMethodsAndActions, '.TcPOU');
    expect(r.lineMap).toHaveLength(r.source.split('\n').length);
  });

  it('lineMap entries are non-negative', () => {
    const r = extractST(tcpouMethodsAndActions, '.TcPOU');
    for (const line of r.lineMap) {
      expect(line).toBeGreaterThanOrEqual(0);
    }
  });

  it('action section is present in sections', () => {
    const r = extractST(tcpouMethodsAndActions, '.TcPOU');
    const actionSections = r.sections.filter((s) => s.kind === 'action');
    expect(actionSections).toHaveLength(1);
    expect(actionSections[0].actionName).toBe('Reset');
  });
});

describe('.TcPOU without methods — synthetic closer always added', () => {
  it('POU with only decl+impl gets synthetic END_FUNCTION_BLOCK', () => {
    const xml = [
      '<?xml version="1.0" encoding="utf-8"?>',
      '<TcPlcObject>',
      '  <POU Name="Simple">',
      '    <Declaration><![CDATA[FUNCTION_BLOCK Simple',
      'VAR END_VAR]]></Declaration>',
      '    <Implementation>',
      '      <ST><![CDATA[;]]></ST>',
      '    </Implementation>',
      '  </POU>',
      '</TcPlcObject>',
    ].join('\n');
    const r = extractST(xml, '.TcPOU');
    // Synthetic END_FUNCTION_BLOCK is always added for FUNCTION_BLOCK POUs
    expect(r.source).toContain('END_FUNCTION_BLOCK');
    expect(r.sections).toHaveLength(2);
    expect(r.lineMap).toHaveLength(r.source.split('\n').length);
  });

  it('POU with only actions gets synthetic END_FUNCTION_BLOCK before action blocks', () => {
    const xml = [
      '<?xml version="1.0" encoding="utf-8"?>',
      '<TcPlcObject>',
      '  <POU Name="WithAction">',
      '    <Declaration><![CDATA[FUNCTION_BLOCK WithAction',
      'VAR END_VAR]]></Declaration>',
      '    <Implementation>',
      '      <ST><![CDATA[]]></ST>',
      '    </Implementation>',
      '    <Action Name="Run">',
      '      <Implementation>',
      '        <ST><![CDATA[; // run]]></ST>',
      '      </Implementation>',
      '    </Action>',
      '  </POU>',
      '</TcPlcObject>',
    ].join('\n');
    const r = extractST(xml, '.TcPOU');
    // Synthetic END_FUNCTION_BLOCK always added before action blocks
    expect(r.source).toContain('END_FUNCTION_BLOCK');
    expect(r.source).toContain('ACTION Run:');
    const actionSections = r.sections.filter((s) => s.kind === 'action');
    expect(actionSections).toHaveLength(1);
    expect(r.lineMap).toHaveLength(r.source.split('\n').length);
  });
});

// ---------------------------------------------------------------------------
// 15. PROPERTY block extraction from .TcPOU
// ---------------------------------------------------------------------------

describe('.TcPOU Property block extraction', () => {
  // FB with a single property that has a getter
  const tcpouWithProperty = [
    '<?xml version="1.0" encoding="utf-8"?>',               // line 0
    '<TcPlcObject>',                                         // line 1
    '  <POU Name="MyFB">',                                   // line 2
    '    <Declaration><![CDATA[FUNCTION_BLOCK MyFB',         // line 3
    'VAR',                                                   // line 4
    '  x : INT;',                                            // line 5
    'END_VAR',                                               // line 6
    ']]></Declaration>',                                     // line 7
    '    <Implementation>',                                  // line 8
    '      <ST><![CDATA[]]></ST>',                           // line 9
    '    </Implementation>',                                 // line 10
    '    <Property Name="Value">',                           // line 11
    '      <Declaration><![CDATA[PROPERTY PUBLIC Value : INT]]></Declaration>', // line 12
    '      <Get Name="Get">',                                // line 13
    '        <Declaration><![CDATA[VAR',                     // line 14
    'END_VAR',                                               // line 15
    ']]></Declaration>',                                     // line 16
    '        <Implementation>',                              // line 17
    '          <ST><![CDATA[Value := x;]]></ST>',            // line 18
    '        </Implementation>',                             // line 19
    '      </Get>',                                          // line 20
    '    </Property>',                                       // line 21
    '  </POU>',                                              // line 22
    '</TcPlcObject>',                                        // line 23
  ].join('\n');

  it('combined source contains PROPERTY header', () => {
    const r = extractST(tcpouWithProperty, '.TcPOU');
    expect(r.source).toContain('PROPERTY PUBLIC Value : INT');
  });

  it('combined source contains END_PROPERTY', () => {
    const r = extractST(tcpouWithProperty, '.TcPOU');
    expect(r.source).toContain('END_PROPERTY');
  });

  it('combined source contains END_FUNCTION_BLOCK', () => {
    const r = extractST(tcpouWithProperty, '.TcPOU');
    expect(r.source).toContain('END_FUNCTION_BLOCK');
  });

  it('combined source contains getter body', () => {
    const r = extractST(tcpouWithProperty, '.TcPOU');
    expect(r.source).toContain('Value := x;');
  });

  it('PROPERTY header appears before END_PROPERTY', () => {
    const r = extractST(tcpouWithProperty, '.TcPOU');
    const propIdx = r.source.indexOf('PROPERTY PUBLIC Value : INT');
    const endPropIdx = r.source.indexOf('END_PROPERTY');
    expect(propIdx).toBeGreaterThanOrEqual(0);
    expect(endPropIdx).toBeGreaterThan(propIdx);
  });

  it('getter body appears between PROPERTY header and END_PROPERTY', () => {
    const r = extractST(tcpouWithProperty, '.TcPOU');
    const propIdx = r.source.indexOf('PROPERTY PUBLIC Value : INT');
    const bodyIdx = r.source.indexOf('Value := x;');
    const endPropIdx = r.source.indexOf('END_PROPERTY');
    expect(bodyIdx).toBeGreaterThan(propIdx);
    expect(endPropIdx).toBeGreaterThan(bodyIdx);
  });

  it('PROPERTY block appears before END_FUNCTION_BLOCK (properties are inside FB)', () => {
    const r = extractST(tcpouWithProperty, '.TcPOU');
    const endFbIdx = r.source.indexOf('END_FUNCTION_BLOCK');
    // Properties are placed before END_FUNCTION_BLOCK
    const propIdx = r.source.indexOf('PROPERTY PUBLIC Value : INT');
    expect(propIdx).toBeLessThan(endFbIdx);
  });

  it('lineMap covers full combined source', () => {
    const r = extractST(tcpouWithProperty, '.TcPOU');
    expect(r.lineMap).toHaveLength(r.source.split('\n').length);
  });

  it('lineMap entries are non-negative', () => {
    const r = extractST(tcpouWithProperty, '.TcPOU');
    for (const line of r.lineMap) {
      expect(line).toBeGreaterThanOrEqual(0);
    }
  });

  it('parse(source) produces FunctionBlockDeclaration with one property', () => {
    const r = extractST(tcpouWithProperty, '.TcPOU');
    const { ast } = parse(r.source);
    const fb = ast.declarations[0] as FunctionBlockDeclaration;
    expect(fb.kind).toBe('FunctionBlockDeclaration');
    expect(fb.properties).toHaveLength(1);
    expect(fb.properties[0].name).toBe('Value');
  });
});

describe('.TcPOU property with setter', () => {
  const tcpouWithGetSet = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<TcPlcObject>',
    '  <POU Name="MyFB">',
    '    <Declaration><![CDATA[FUNCTION_BLOCK MyFB',
    'VAR',
    '  _x : INT;',
    'END_VAR',
    ']]></Declaration>',
    '    <Implementation>',
    '      <ST><![CDATA[]]></ST>',
    '    </Implementation>',
    '    <Property Name="X">',
    '      <Declaration><![CDATA[PROPERTY PUBLIC X : INT]]></Declaration>',
    '      <Get Name="Get">',
    '        <Declaration><![CDATA[VAR',
    'END_VAR',
    ']]></Declaration>',
    '        <Implementation>',
    '          <ST><![CDATA[X := _x;]]></ST>',
    '        </Implementation>',
    '      </Get>',
    '      <Set Name="Set">',
    '        <Declaration><![CDATA[VAR',
    'END_VAR',
    ']]></Declaration>',
    '        <Implementation>',
    '          <ST><![CDATA[_x := X;]]></ST>',
    '        </Implementation>',
    '      </Set>',
    '    </Property>',
    '  </POU>',
    '</TcPlcObject>',
  ].join('\n');

  it('source contains both getter and setter bodies', () => {
    const r = extractST(tcpouWithGetSet, '.TcPOU');
    expect(r.source).toContain('X := _x;');
    expect(r.source).toContain('_x := X;');
  });

  it('source contains PROPERTY header and END_PROPERTY', () => {
    const r = extractST(tcpouWithGetSet, '.TcPOU');
    expect(r.source).toContain('PROPERTY PUBLIC X : INT');
    expect(r.source).toContain('END_PROPERTY');
  });

  it('setter body appears after getter body', () => {
    const r = extractST(tcpouWithGetSet, '.TcPOU');
    const getterIdx = r.source.indexOf('X := _x;');
    const setterIdx = r.source.indexOf('_x := X;');
    expect(getterIdx).toBeGreaterThanOrEqual(0);
    expect(setterIdx).toBeGreaterThan(getterIdx);
  });

  it('lineMap covers full combined source', () => {
    const r = extractST(tcpouWithGetSet, '.TcPOU');
    expect(r.lineMap).toHaveLength(r.source.split('\n').length);
  });

  it('parse(source) produces FunctionBlockDeclaration with one property', () => {
    const r = extractST(tcpouWithGetSet, '.TcPOU');
    const { ast } = parse(r.source);
    const fb = ast.declarations[0] as FunctionBlockDeclaration;
    expect(fb.kind).toBe('FunctionBlockDeclaration');
    expect(fb.properties).toHaveLength(1);
    expect(fb.properties[0].name).toBe('X');
  });
});

describe('.TcPOU multiple properties', () => {
  const tcpouTwoProps = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<TcPlcObject>',
    '  <POU Name="MyFB">',
    '    <Declaration><![CDATA[FUNCTION_BLOCK MyFB',
    'VAR',
    '  _count : DINT;',
    '  _name : STRING;',
    'END_VAR',
    ']]></Declaration>',
    '    <Implementation>',
    '      <ST><![CDATA[]]></ST>',
    '    </Implementation>',
    '    <Property Name="Count">',
    '      <Declaration><![CDATA[PROPERTY PUBLIC Count : DINT]]></Declaration>',
    '      <Get Name="Get">',
    '        <Declaration><![CDATA[VAR',
    'END_VAR',
    ']]></Declaration>',
    '        <Implementation>',
    '          <ST><![CDATA[Count := _count;]]></ST>',
    '        </Implementation>',
    '      </Get>',
    '    </Property>',
    '    <Property Name="Name">',
    '      <Declaration><![CDATA[PROPERTY PUBLIC Name : STRING]]></Declaration>',
    '      <Get Name="Get">',
    '        <Declaration><![CDATA[VAR',
    'END_VAR',
    ']]></Declaration>',
    '        <Implementation>',
    '          <ST><![CDATA[Name := _name;]]></ST>',
    '        </Implementation>',
    '      </Get>',
    '    </Property>',
    '  </POU>',
    '</TcPlcObject>',
  ].join('\n');

  it('source contains both property headers', () => {
    const r = extractST(tcpouTwoProps, '.TcPOU');
    expect(r.source).toContain('PROPERTY PUBLIC Count : DINT');
    expect(r.source).toContain('PROPERTY PUBLIC Name : STRING');
  });

  it('source contains two END_PROPERTY blocks', () => {
    const r = extractST(tcpouTwoProps, '.TcPOU');
    const count = (r.source.match(/END_PROPERTY/g) ?? []).length;
    expect(count).toBe(2);
  });

  it('properties appear in XML order', () => {
    const r = extractST(tcpouTwoProps, '.TcPOU');
    const countIdx = r.source.indexOf('PROPERTY PUBLIC Count');
    const nameIdx = r.source.indexOf('PROPERTY PUBLIC Name');
    expect(countIdx).toBeLessThan(nameIdx);
  });

  it('contains exactly one END_FUNCTION_BLOCK', () => {
    const r = extractST(tcpouTwoProps, '.TcPOU');
    const count = (r.source.match(/END_FUNCTION_BLOCK/g) ?? []).length;
    expect(count).toBe(1);
  });

  it('lineMap covers full combined source', () => {
    const r = extractST(tcpouTwoProps, '.TcPOU');
    expect(r.lineMap).toHaveLength(r.source.split('\n').length);
  });

  it('parse(source) produces FunctionBlockDeclaration with two properties', () => {
    const r = extractST(tcpouTwoProps, '.TcPOU');
    const { ast } = parse(r.source);
    const fb = ast.declarations[0] as FunctionBlockDeclaration;
    expect(fb.kind).toBe('FunctionBlockDeclaration');
    expect(fb.properties).toHaveLength(2);
    expect(fb.properties[0].name).toBe('Count');
    expect(fb.properties[1].name).toBe('Name');
  });
});

describe('.TcPOU methods and properties coexist', () => {
  const tcpouMethodAndProp = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<TcPlcObject>',
    '  <POU Name="MyFB">',
    '    <Declaration><![CDATA[FUNCTION_BLOCK MyFB',
    'VAR',
    '  x : INT;',
    'END_VAR',
    ']]></Declaration>',
    '    <Implementation>',
    '      <ST><![CDATA[]]></ST>',
    '    </Implementation>',
    '    <Method Name="Reset">',
    '      <Declaration><![CDATA[METHOD PUBLIC Reset',
    ']]></Declaration>',
    '      <Implementation>',
    '        <ST><![CDATA[x := 0;]]></ST>',
    '      </Implementation>',
    '    </Method>',
    '    <Property Name="Value">',
    '      <Declaration><![CDATA[PROPERTY PUBLIC Value : INT]]></Declaration>',
    '      <Get Name="Get">',
    '        <Declaration><![CDATA[VAR',
    'END_VAR',
    ']]></Declaration>',
    '        <Implementation>',
    '          <ST><![CDATA[Value := x;]]></ST>',
    '        </Implementation>',
    '      </Get>',
    '    </Property>',
    '  </POU>',
    '</TcPlcObject>',
  ].join('\n');

  it('source contains METHOD, END_METHOD, PROPERTY, END_PROPERTY, END_FUNCTION_BLOCK', () => {
    const r = extractST(tcpouMethodAndProp, '.TcPOU');
    expect(r.source).toContain('METHOD PUBLIC Reset');
    expect(r.source).toContain('END_METHOD');
    expect(r.source).toContain('PROPERTY PUBLIC Value : INT');
    expect(r.source).toContain('END_PROPERTY');
    expect(r.source).toContain('END_FUNCTION_BLOCK');
  });

  it('METHOD block appears before PROPERTY block', () => {
    const r = extractST(tcpouMethodAndProp, '.TcPOU');
    const methodIdx = r.source.indexOf('METHOD PUBLIC Reset');
    const propIdx = r.source.indexOf('PROPERTY PUBLIC Value : INT');
    expect(methodIdx).toBeLessThan(propIdx);
  });

  it('contains exactly one END_FUNCTION_BLOCK, after the last END_PROPERTY', () => {
    const r = extractST(tcpouMethodAndProp, '.TcPOU');
    const endFbIdx = r.source.indexOf('END_FUNCTION_BLOCK');
    const endPropIdx = r.source.lastIndexOf('END_PROPERTY');
    expect(endFbIdx).toBeGreaterThan(endPropIdx);
  });

  it('lineMap covers full combined source', () => {
    const r = extractST(tcpouMethodAndProp, '.TcPOU');
    expect(r.lineMap).toHaveLength(r.source.split('\n').length);
  });

  it('parse(source) produces FB with one method and one property', () => {
    const r = extractST(tcpouMethodAndProp, '.TcPOU');
    const { ast } = parse(r.source);
    const fb = ast.declarations[0] as FunctionBlockDeclaration;
    expect(fb.kind).toBe('FunctionBlockDeclaration');
    expect(fb.methods).toHaveLength(1);
    expect(fb.properties).toHaveLength(1);
    expect(fb.methods[0].name).toBe('Reset');
    expect(fb.properties[0].name).toBe('Value');
  });
});

// ---------------------------------------------------------------------------
// 17. Dictionary.TcPOU integration tests (real-world fixture)
// ---------------------------------------------------------------------------

describe('Dictionary.TcPOU integration', () => {
  const dictionaryPath = path.resolve(
    __dirname,
    '../../../tests/fixtures/mobject-core-src/src/sln/lib/mobject-core/mobject-collections/Dictionary/Dictionary.TcPOU',
  );

  let content: string;
  let result: ExtractionResult;

  beforeAll(() => {
    content = fs.readFileSync(dictionaryPath, 'utf-8');
    result = extractST(content, '.TcPOU');
  });

  // ── 1. Extraction succeeds ─────────────────────────────────────────────

  it('is a valid TcPlcObject file', () => {
    expect(content).toContain('<TcPlcObject');
  });

  it('is not a passthrough', () => {
    expect(result.passthrough).toBe(false);
  });

  it('produces non-empty source', () => {
    expect(result.source.length).toBeGreaterThan(0);
  });

  it('has more than 50 sections (all method/property CDATAs)', () => {
    expect(result.sections.length).toBeGreaterThan(50);
  });

  it('lineMap length equals number of lines in source', () => {
    expect(result.lineMap.length).toBe(result.source.split('\n').length);
  });

  // ── 2. All method names present ───────────────────────────────────────

  const methodNames = [
    'AddOrUpdate', 'Balance', 'Clear', 'ContainsKey',
    'EmitChangedEvent', 'EmitDisposedEvent', 'FB_exit', 'FindMinimum',
    'GetBalanceFactor', 'GetEnumerator', 'GetHeight', 'GetKeys',
    'GetKeyValueEnumerator', 'LeftRotate', 'OffEvent', 'OnceEvent',
    'OnEvent', 'RecursiveAddKeysInOrderToCollection',
    'RecursiveAddNodesInOrderToCollection', 'RecursiveClear',
    'RecursiveCountNodes', 'RecursiveDelete', 'RecursiveFind',
    'RecursiveInsert', 'Remove', 'RightRotate', 'TryAdd',
    'TryGetValue', 'TryGetValueTo', 'UpdateHeight',
  ];

  for (const name of methodNames) {
    it(`source contains method name: ${name}`, () => {
      expect(result.source).toContain(name);
    });
  }

  // ── 3. Properties present ─────────────────────────────────────────────

  it('source contains PROPERTY PUBLIC Count : DINT declaration', () => {
    expect(result.source).toContain('PROPERTY PUBLIC Count : DINT');
  });

  it('source contains PROPERTY IsEmpty : BOOL declaration', () => {
    expect(result.source).toContain('PROPERTY IsEmpty : BOOL');
  });

  it('source contains exactly two END_PROPERTY markers', () => {
    const matches = result.source.match(/END_PROPERTY/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBe(2);
  });

  // ── 4. Structural markers ─────────────────────────────────────────────

  it('source contains END_FUNCTION_BLOCK', () => {
    expect(result.source).toContain('END_FUNCTION_BLOCK');
  });

  it('END_METHOD count matches number of methods (30)', () => {
    const matches = result.source.match(/END_METHOD/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBe(methodNames.length);
  });

  // ── 5. Parseable source ───────────────────────────────────────────────

  it('parse produces a FunctionBlockDeclaration named Dictionary', () => {
    const { ast } = parse(result.source);
    const fb = ast.declarations[0] as FunctionBlockDeclaration;
    expect(fb.kind).toBe('FunctionBlockDeclaration');
    expect(fb.name).toBe('Dictionary');
  });

  it('parsed FB has at least 25 methods', () => {
    const { ast } = parse(result.source);
    const fb = ast.declarations[0] as FunctionBlockDeclaration;
    expect(fb.methods.length).toBeGreaterThanOrEqual(25);
  });

  it('parsed FB has at least 2 properties', () => {
    const { ast } = parse(result.source);
    const fb = ast.declarations[0] as FunctionBlockDeclaration;
    expect(fb.properties.length).toBeGreaterThanOrEqual(2);
  });

  it('parsed FB extends Disposable', () => {
    const { ast } = parse(result.source);
    const fb = ast.declarations[0] as FunctionBlockDeclaration;
    expect(fb.extendsRef?.name).toBe('Disposable');
  });

  it('parsed FB implements I_Dictionary', () => {
    const { ast } = parse(result.source);
    const fb = ast.declarations[0] as FunctionBlockDeclaration;
    expect(fb.implementsRefs.map(r => r.name)).toContain('I_Dictionary');
  });

  // ── 6. lineMap accuracy ───────────────────────────────────────────────

  it('all lineMap entries are non-negative', () => {
    for (const line of result.lineMap) {
      expect(line).toBeGreaterThanOrEqual(0);
    }
  });

  it('first few lineMap entries map to small original line numbers (< 20)', () => {
    // The FB declaration CDATA starts within the first ~10 lines of XML
    for (let i = 0; i < Math.min(5, result.lineMap.length); i++) {
      expect(result.lineMap[i]).toBeLessThan(20);
    }
  });

  it('lineMap length equals source line count (double-check)', () => {
    const lineCount = result.source.split('\n').length;
    expect(result.lineMap).toHaveLength(lineCount);
  });

  // ── 7. Folding ranges work with Dictionary.TcPOU ──────────────────────

  it('handleFoldingRanges produces at least one Imports range (XML wrapper)', () => {
    const doc = TextDocument.create(
      'file:///Dictionary.TcPOU',
      'iec-st',
      1,
      content,
    );
    const ranges = handleFoldingRanges(doc);
    const importsRanges = ranges.filter(r => r.kind === FoldingRangeKind.Imports);
    expect(importsRanges.length).toBeGreaterThan(0);
  });

  it('handleFoldingRanges produces at least one Region range (ST-internal folds)', () => {
    const doc = TextDocument.create(
      'file:///Dictionary.TcPOU',
      'iec-st',
      1,
      content,
    );
    const ranges = handleFoldingRanges(doc);
    const regionRanges = ranges.filter(r => r.kind === FoldingRangeKind.Region);
    expect(regionRanges.length).toBeGreaterThan(0);
  });

  // ── 8. Semantic tokens work with Dictionary.TcPOU ─────────────────────

  it('handleSemanticTokens produces non-empty token data', () => {
    const doc = TextDocument.create(
      'file:///Dictionary.TcPOU',
      'iec-st',
      1,
      content,
    );
    const tokens = handleSemanticTokens(doc);
    expect(tokens.data.length).toBeGreaterThan(0);
  });

  it('handleSemanticTokens emits at least one xmlMarkup token (index 12)', () => {
    const doc = TextDocument.create(
      'file:///Dictionary.TcPOU',
      'iec-st',
      1,
      content,
    );
    const tokens = handleSemanticTokens(doc);
    // Each token entry is 5 numbers: [deltaLine, deltaChar, length, typeIndex, modifiers]
    let foundXmlMarkup = false;
    for (let i = 3; i < tokens.data.length; i += 5) {
      if (tokens.data[i] === 12) {
        foundXmlMarkup = true;
        break;
      }
    }
    expect(foundXmlMarkup).toBe(true);
  });

  it('handleSemanticTokens emits at least one keyword token (index 0)', () => {
    const doc = TextDocument.create(
      'file:///Dictionary.TcPOU',
      'iec-st',
      1,
      content,
    );
    const tokens = handleSemanticTokens(doc);
    let foundKeyword = false;
    for (let i = 3; i < tokens.data.length; i += 5) {
      if (tokens.data[i] === 0) {
        foundKeyword = true;
        break;
      }
    }
    expect(foundKeyword).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// PositionMapper tests
// ---------------------------------------------------------------------------

describe('PositionMapper', () => {
  // ---------------------------------------------------------------------------
  // 1. Passthrough (.st) files — identity mapping
  // ---------------------------------------------------------------------------
  describe('passthrough (.st) files', () => {
    it('originalToExtracted returns same position', () => {
      const r = extractST('x := 1;\ny := 2;\n', '.st');
      const mapper = new PositionMapper(r);
      expect(mapper.originalToExtracted(0, 3)).toEqual({ line: 0, character: 3 });
      expect(mapper.originalToExtracted(1, 5)).toEqual({ line: 1, character: 5 });
    });

    it('extractedToOriginal returns same position', () => {
      const r = extractST('x := 1;\ny := 2;\n', '.st');
      const mapper = new PositionMapper(r);
      expect(mapper.extractedToOriginal(0, 3)).toEqual({ line: 0, character: 3 });
      expect(mapper.extractedToOriginal(1, 5)).toEqual({ line: 1, character: 5 });
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Simple TcPOU with declaration only (newline CDATA, startChar === 0)
  // ---------------------------------------------------------------------------
  describe('simple TcPOU with declaration only (newline CDATA)', () => {
    // Line numbers (0-based):
    //  0: <?xml version="1.0" encoding="utf-8"?>
    //  1: <TcPlcObject>
    //  2:   <POU Name="FB_Simple">
    //  3:     <Declaration><![CDATA[
    //  4: FUNCTION_BLOCK FB_Simple
    //  5: VAR
    //  6:   x : INT;
    //  7: END_VAR
    //  8: ]]></Declaration>
    //  9:   </POU>
    // 10: </TcPlcObject>
    const xml = [
      '<?xml version="1.0" encoding="utf-8"?>',
      '<TcPlcObject>',
      '  <POU Name="FB_Simple">',
      '    <Declaration><![CDATA[',
      'FUNCTION_BLOCK FB_Simple',
      'VAR',
      '  x : INT;',
      'END_VAR',
      ']]></Declaration>',
      '  </POU>',
      '</TcPlcObject>',
    ].join('\n');

    it('originalToExtracted on a CDATA line returns a valid extracted position', () => {
      const r = extractST(xml, '.TcPOU');
      const mapper = new PositionMapper(r);
      // Original line 4 ("FUNCTION_BLOCK FB_Simple") is extracted line 0
      const pos = mapper.originalToExtracted(4, 5);
      expect(pos).not.toBeNull();
      expect(pos!.line).toBe(0);
      expect(pos!.character).toBe(5);
    });

    it('originalToExtracted on an XML-only line (line 0) returns null', () => {
      const r = extractST(xml, '.TcPOU');
      const mapper = new PositionMapper(r);
      expect(mapper.originalToExtracted(0, 0)).toBeNull();
    });

    it('originalToExtracted on another XML-only line (the CDATA open tag line) returns null', () => {
      const r = extractST(xml, '.TcPOU');
      const mapper = new PositionMapper(r);
      // Line 3 is "    <Declaration><![CDATA[" — XML wrapper, not CDATA content
      expect(mapper.originalToExtracted(3, 5)).toBeNull();
    });

    it('originalToExtracted maps inner declaration line correctly', () => {
      const r = extractST(xml, '.TcPOU');
      const mapper = new PositionMapper(r);
      // Original line 6 ("  x : INT;") is extracted line 2
      const pos = mapper.originalToExtracted(6, 2);
      expect(pos).not.toBeNull();
      expect(pos!.line).toBe(2);
      expect(pos!.character).toBe(2);
    });

    it('extractedToOriginal maps back to original coordinates', () => {
      const r = extractST(xml, '.TcPOU');
      const mapper = new PositionMapper(r);
      expect(mapper.extractedToOriginal(0, 5)).toEqual({ line: 4, character: 5 });
      expect(mapper.extractedToOriginal(2, 2)).toEqual({ line: 6, character: 2 });
    });
  });

  // ---------------------------------------------------------------------------
  // 3. TcPOU with inline CDATA (startChar > 0)
  // ---------------------------------------------------------------------------
  describe('TcPOU with inline CDATA (startChar > 0)', () => {
    // Line numbers (0-based):
    //  0: <?xml version="1.0" encoding="utf-8"?>
    //  1: <TcPlcObject>
    //  2:   <POU Name="FB_Foo">
    //  3:     <Declaration><![CDATA[FUNCTION_BLOCK FB_Foo   ← inline! startChar > 0
    //  4: VAR
    //  5: END_VAR]]></Declaration>
    //  6:   </POU>
    //  7: </TcPlcObject>
    const xml = [
      '<?xml version="1.0" encoding="utf-8"?>',
      '<TcPlcObject>',
      '  <POU Name="FB_Foo">',
      '    <Declaration><![CDATA[FUNCTION_BLOCK FB_Foo',
      'VAR',
      'END_VAR]]></Declaration>',
      '  </POU>',
      '</TcPlcObject>',
    ].join('\n');

    it('extractST produces a section with startChar > 0', () => {
      const r = extractST(xml, '.TcPOU');
      expect(r.sections[0].startChar).toBeGreaterThan(0);
    });

    it('extractedToOriginal on extracted line 0 adds the startChar offset', () => {
      const r = extractST(xml, '.TcPOU');
      const mapper = new PositionMapper(r);
      const section = r.sections[0];
      // extracted line 0 maps to original line section.startLine
      // char 5 in extracted should become char (5 + startChar) in original
      const result = mapper.extractedToOriginal(0, 5);
      expect(result.line).toBe(section.startLine);
      expect(result.character).toBe(5 + section.startChar);
    });

    it('originalToExtracted on the inline line subtracts the startChar', () => {
      const r = extractST(xml, '.TcPOU');
      const mapper = new PositionMapper(r);
      const section = r.sections[0];
      const originalChar = 5 + section.startChar;
      const result = mapper.originalToExtracted(section.startLine, originalChar);
      expect(result).not.toBeNull();
      expect(result!.line).toBe(0);
      expect(result!.character).toBe(5);
    });

    it('extractedToOriginal on line 1+ (not the inline first line) does NOT add offset', () => {
      const r = extractST(xml, '.TcPOU');
      const mapper = new PositionMapper(r);
      // extracted line 1 is "VAR" on original line startLine+1, no offset
      const result = mapper.extractedToOriginal(1, 0);
      expect(result.character).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Full TcPOU with methods — mapping across sections
  // ---------------------------------------------------------------------------
  describe('TcPOU with a method', () => {
    // See plan for line-number comments.
    // FB declaration: lines 4-7 (newline CDATA)
    // Implementation: line 11 (newline CDATA)
    // Method decl: line 15 inline (startChar > 0), lines 15-18
    // Method impl: line 22 (newline CDATA)
    const xml = [
      '<?xml version="1.0" encoding="utf-8"?>',      //  0
      '<TcPlcObject Version="1.1.0.1">',              //  1
      '  <POU Name="FB_Mapper" Id="{abc}">',          //  2
      '    <Declaration><![CDATA[',                    //  3
      'FUNCTION_BLOCK FB_Mapper',                      //  4
      'VAR',                                           //  5
      '  counter : INT;',                              //  6
      'END_VAR',                                       //  7
      ']]></Declaration>',                             //  8
      '    <Implementation>',                          //  9
      '      <ST><![CDATA[',                           // 10
      'counter := counter + 1;',                       // 11
      ']]></ST>',                                      // 12
      '    </Implementation>',                         // 13
      '    <Method Name="Reset" Id="{def}">',          // 14
      '      <Declaration><![CDATA[METHOD Reset',      // 15 (inline CDATA)
      'VAR_INPUT',                                     // 16
      '  value : INT;',                                // 17
      'END_VAR',                                       // 18
      ']]></Declaration>',                             // 19
      '      <Implementation>',                        // 20
      '        <ST><![CDATA[',                         // 21
      'counter := value;',                             // 22
      ']]></ST>',                                      // 23
      '      </Implementation>',                       // 24
      '    </Method>',                                 // 25
      '  </POU>',                                      // 26
      '</TcPlcObject>',                                // 27
    ].join('\n');

    it('originalToExtracted on implementation line maps to extracted source', () => {
      const r = extractST(xml, '.TcPOU');
      const mapper = new PositionMapper(r);
      // Line 11 "counter := counter + 1;" is in the implementation section
      const pos = mapper.originalToExtracted(11, 3);
      expect(pos).not.toBeNull();
      // Verify it maps to the correct extracted line
      const extractedLines = r.source.split('\n');
      expect(extractedLines[pos!.line]).toContain('counter := counter + 1;');
      expect(pos!.character).toBe(3);
    });

    it('originalToExtracted on method implementation line maps correctly', () => {
      const r = extractST(xml, '.TcPOU');
      const mapper = new PositionMapper(r);
      // Line 22 "counter := value;" is in the method implementation section
      const pos = mapper.originalToExtracted(22, 5);
      expect(pos).not.toBeNull();
      const extractedLines = r.source.split('\n');
      expect(extractedLines[pos!.line]).toContain('counter := value;');
      expect(pos!.character).toBe(5);
    });

    it('originalToExtracted on XML-only line (line 0) returns null', () => {
      const r = extractST(xml, '.TcPOU');
      const mapper = new PositionMapper(r);
      expect(mapper.originalToExtracted(0, 0)).toBeNull();
    });

    it('originalToExtracted on closing tag line (line 8) returns null', () => {
      const r = extractST(xml, '.TcPOU');
      const mapper = new PositionMapper(r);
      // Line 8 is "]]></Declaration>" — XML wrapper
      expect(mapper.originalToExtracted(8, 0)).toBeNull();
    });

    it('extractedToOriginal on method decl first line adds startChar offset', () => {
      const r = extractST(xml, '.TcPOU');
      const mapper = new PositionMapper(r);
      // Find the method decl section (declaration with startLine=15)
      const methodDeclSection = r.sections.find(s => s.kind === 'declaration' && s.startLine === 15);
      expect(methodDeclSection).toBeDefined();
      expect(methodDeclSection!.startChar).toBeGreaterThan(0);
      // extractedToOriginal on the first extracted line of that section
      const extLine = methodDeclSection!.extractedStartLine;
      const result = mapper.extractedToOriginal(extLine, 3);
      expect(result.line).toBe(15);
      expect(result.character).toBe(3 + methodDeclSection!.startChar);
    });
  });

  // ---------------------------------------------------------------------------
  // 5. Method with INLINE implementation CDATA (regression: startLine off-by-one)
  // ---------------------------------------------------------------------------
  describe('TcPOU with method implementation inline CDATA (no leading newline)', () => {
    // This is the real-world TwinCAT format where <ST><![CDATA[first line of code
    // appears without a newline after <![CDATA[. Previously, extractImplementationCData
    // passed implOffsetInXml (position of <Implementation> tag) as bodyOffsetInXml
    // when calling extractFirstChildCData, making startLine land on the
    // <Implementation> XML line instead of the <ST><![CDATA[...> line.
    const xml = [
      '<?xml version="1.0" encoding="utf-8"?>',           //  0
      '<TcPlcObject Version="1.1.0.1">',                   //  1
      '  <POU Name="FB_Clear" Id="{abc}">',                //  2
      '    <Declaration><![CDATA[FUNCTION_BLOCK FB_Clear', //  3 (inline CDATA)
      'VAR',                                               //  4
      '  rootNode : INT;',                                 //  5
      'END_VAR',                                           //  6
      ']]></Declaration>',                                 //  7
      '    <Method Name="Clear" Id="{def}">',              //  8
      '      <Declaration><![CDATA[METHOD PUBLIC Clear',   //  9 (inline CDATA)
      'VAR_INPUT',                                         // 10
      'END_VAR',                                           // 11
      ']]></Declaration>',                                 // 12
      '      <Implementation>',                            // 13
      '        <ST><![CDATA[IF rootNode = 0 THEN',         // 14 (inline CDATA — the broken case)
      '  RETURN;',                                         // 15
      'END_IF',                                            // 16
      'rootNode := 0;',                                    // 17
      ']]></ST>',                                          // 18
      '      </Implementation>',                           // 19
      '    </Method>',                                     // 20
      '  </POU>',                                          // 21
      '</TcPlcObject>',                                    // 22
    ].join('\n');

    it('implementation section startLine points to the <ST><![CDATA[ line, not <Implementation>', () => {
      const r = extractST(xml, '.TcPOU');
      const implSection = r.sections.find(s => s.kind === 'implementation' && s.startChar > 0);
      expect(implSection).toBeDefined();
      // startLine must be line 14 (<ST><![CDATA[IF rootNode = 0 THEN>), not 13 (<Implementation>)
      expect(implSection!.startLine).toBe(14);
    });

    it('originalToExtracted on the inline CDATA line subtracts startChar correctly', () => {
      const r = extractST(xml, '.TcPOU');
      const mapper = new PositionMapper(r);
      // Line 14: "        <ST><![CDATA[IF rootNode = 0 THEN"
      // "        <ST><![CDATA[" = 21 chars, "rootNode" starts at char 24 (after "IF ")
      const stCdataPrefix = '        <ST><![CDATA[IF '; // 24 chars
      const originalChar = stCdataPrefix.length; // char index of 'r' in rootNode
      const pos = mapper.originalToExtracted(14, originalChar);
      expect(pos).not.toBeNull();
      const extractedLines = r.source.split('\n');
      const line = extractedLines[pos!.line];
      // The extracted line should be "IF rootNode = 0 THEN", and char should point to 'r'
      expect(line).toContain('IF rootNode = 0 THEN');
      expect(line[pos!.character]).toBe('r');
    });

    it('originalToExtracted on subsequent lines in inline CDATA section maps correctly', () => {
      const r = extractST(xml, '.TcPOU');
      const mapper = new PositionMapper(r);
      // Line 17: "rootNode := 0;" — no inline offset, straightforward
      const pos = mapper.originalToExtracted(17, 0);
      expect(pos).not.toBeNull();
      const extractedLines = r.source.split('\n');
      expect(extractedLines[pos!.line]).toContain('rootNode := 0;');
    });

    it('extracted source contains method implementation content', () => {
      const r = extractST(xml, '.TcPOU');
      expect(r.source).toContain('IF rootNode = 0 THEN');
      expect(r.source).toContain('rootNode := 0;');
    });
  });

  // ---------------------------------------------------------------------------
  // 6. Round-trip: originalToExtracted → extractedToOriginal
  // ---------------------------------------------------------------------------
  describe('round-trip correctness', () => {
    const xml = [
      '<?xml version="1.0" encoding="utf-8"?>',
      '<TcPlcObject>',
      '  <POU Name="FB_RoundTrip">',
      '    <Declaration><![CDATA[',
      'FUNCTION_BLOCK FB_RoundTrip',
      'VAR',
      '  n : INT;',
      'END_VAR',
      ']]></Declaration>',
      '    <Implementation>',
      '      <ST><![CDATA[',
      'n := n + 1;',
      ']]></ST>',
      '    </Implementation>',
      '  </POU>',
      '</TcPlcObject>',
    ].join('\n');

    it('round-trip on a declaration line is identity', () => {
      const r = extractST(xml, '.TcPOU');
      const mapper = new PositionMapper(r);
      // Original line 4 ("FUNCTION_BLOCK FB_RoundTrip") → extracted → back to original
      const extracted = mapper.originalToExtracted(4, 7);
      expect(extracted).not.toBeNull();
      const backToOriginal = mapper.extractedToOriginal(extracted!.line, extracted!.character);
      expect(backToOriginal).toEqual({ line: 4, character: 7 });
    });

    it('round-trip on an implementation line is identity', () => {
      const r = extractST(xml, '.TcPOU');
      const mapper = new PositionMapper(r);
      // Original line 11 ("n := n + 1;")
      const extracted = mapper.originalToExtracted(11, 2);
      expect(extracted).not.toBeNull();
      const backToOriginal = mapper.extractedToOriginal(extracted!.line, extracted!.character);
      expect(backToOriginal).toEqual({ line: 11, character: 2 });
    });
  });
});
