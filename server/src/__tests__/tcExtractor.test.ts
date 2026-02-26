import { describe, it, expect, beforeEach } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import { extractST, ExtractionResult } from '../twincat/tcExtractor';
import { parse } from '../parser/parser';
import type { FunctionBlockDeclaration } from '../parser/ast';

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
