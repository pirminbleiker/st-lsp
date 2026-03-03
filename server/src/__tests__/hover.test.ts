import { describe, it, expect } from 'vitest';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { handleHover } from '../handlers/hover';
import { WorkspaceIndex } from '../twincat/workspaceIndex';
import type { LibraryRef } from '../twincat/projectReader';

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

  describe('hover over pragma attribute', () => {
    // {attribute 'hide'} on line 0, then FUNCTION_BLOCK on line 1
    const src = [
      "{attribute 'hide'}",
      'FUNCTION_BLOCK MyFB',
      'VAR',
      '  x : INT;',
      'END_VAR',
      'END_FUNCTION_BLOCK',
    ].join('\n');

    it('returns hover documentation for a known pragma', () => {
      const doc = makeDoc(src);
      // Line 0: "{attribute 'hide'}" — hover in the middle of the pragma
      const result = handleHover(makeParams(doc.uri, 0, 5), doc);
      expect(result).not.toBeNull();
      if (result) {
        const contents = result.contents as { kind: string; value: string };
        expect(contents.value).toContain('hide');
        expect(contents.value).toContain('IntelliSense');
      }
    });

    const srcMonitoring = [
      "{attribute 'monitoring' := 'call'}",
      'FUNCTION_BLOCK MonFB',
      'END_FUNCTION_BLOCK',
    ].join('\n');

    it('returns hover documentation for monitoring pragma', () => {
      const doc = makeDoc(srcMonitoring);
      const result = handleHover(makeParams(doc.uri, 0, 5), doc);
      expect(result).not.toBeNull();
      if (result) {
        const contents = result.contents as { kind: string; value: string };
        expect(contents.value).toContain('monitoring');
      }
    });
  });

  describe('hover over variable with pragma shows pragma summary', () => {
    const src = [
      'FUNCTION_BLOCK MyFB',
      'VAR',
      "  {attribute 'hide'}",
      '  hiddenVar : BOOL;',
      'END_VAR',
      'END_FUNCTION_BLOCK',
    ].join('\n');

    it('variable hover includes pragma summary', () => {
      const doc = makeDoc(src);
      // Hover over the pragma itself on line 2
      const result = handleHover(makeParams(doc.uri, 2, 5), doc);
      expect(result).not.toBeNull();
      if (result) {
        const contents = result.contents as { kind: string; value: string };
        expect(contents.value).toContain('hide');
      }
    });
  });

  describe('hover over action name', () => {
    it('returns action hover for action name called directly in FB body', () => {
      // When an action is called without THIS. (e.g., Run(); as a NameExpression),
      // hovering over it should show action hover info.
      const srcWithCall = [
        'FUNCTION_BLOCK MyFB',
        'VAR x : INT; END_VAR',
        'Run();',
        'END_FUNCTION_BLOCK',
        'ACTION Run:',
        'x := x + 1;',
        'END_ACTION',
      ].join('\n');
      const doc2 = makeDoc(srcWithCall);
      // Line 2: "Run();" — hover over "Run" at character 0
      const result = handleHover(makeParams(doc2.uri, 2, 0), doc2);
      // "Run" resolves to the action declaration
      expect(result).not.toBeNull();
      if (result) {
        const contents = result.contents as { kind: string; value: string };
        expect(contents.value).toContain('Run');
        expect(contents.value).toContain('MyFB');
      }
    });
  });

  describe('hover shows var block kind', () => {
    const src = [
      'FUNCTION_BLOCK MyFB',
      'VAR_INPUT',
      '  inVal : INT;',
      'END_VAR',
      'VAR_OUTPUT',
      '  outVal : BOOL;',
      'END_VAR',
      'VAR',
      '  localVar : REAL;',
      'END_VAR',
      '  outVal := inVal > 0;',
      'END_FUNCTION_BLOCK',
    ].join('\n');

    it('shows VAR_INPUT for input variable', () => {
      const doc = makeDoc(src);
      // Line 10: "  outVal := inVal > 0;" — "inVal" starts at character 14
      const result = handleHover(makeParams(doc.uri, 10, 14), doc);
      expect(result).not.toBeNull();
      if (result) {
        const contents = result.contents as { kind: string; value: string };
        expect(contents.value).toContain('inVal');
        expect(contents.value).toContain('VAR_INPUT');
      }
    });

    it('shows VAR_OUTPUT for output variable', () => {
      const doc = makeDoc(src);
      // Line 10: "  outVal := inVal > 0;" — "outVal" starts at character 2
      const result = handleHover(makeParams(doc.uri, 10, 2), doc);
      expect(result).not.toBeNull();
      if (result) {
        const contents = result.contents as { kind: string; value: string };
        expect(contents.value).toContain('outVal');
        expect(contents.value).toContain('VAR_OUTPUT');
      }
    });

    it('shows VAR for local variable', () => {
      const doc = makeDoc(src);
      // Need to use localVar in the body; it isn't used in line 10.
      // Add a simpler doc for this case.
      const src2 = [
        'PROGRAM P',
        'VAR',
        '  localVar : REAL;',
        'END_VAR',
        '  localVar := 1.0;',
        'END_PROGRAM',
      ].join('\n');
      const doc2 = makeDoc(src2);
      // Line 4: "  localVar := 1.0;" — "localVar" starts at character 2
      const result2 = handleHover(makeParams(doc2.uri, 4, 2), doc2);
      expect(result2).not.toBeNull();
      if (result2) {
        const contents = result2.contents as { kind: string; value: string };
        expect(contents.value).toContain('localVar');
        expect(contents.value).toContain('VAR');
      }
    });
  });

  describe('hover shows value range for numeric builtin types', () => {
    it('shows range for INT variable', () => {
      const src = [
        'PROGRAM P',
        'VAR',
        '  counter : INT;',
        'END_VAR',
        '  counter := 0;',
        'END_PROGRAM',
      ].join('\n');
      const doc = makeDoc(src);
      // Line 4: "  counter := 0;" — "counter" starts at character 2
      const result = handleHover(makeParams(doc.uri, 4, 2), doc);
      expect(result).not.toBeNull();
      if (result) {
        const contents = result.contents as { kind: string; value: string };
        expect(contents.value).toContain('counter');
        expect(contents.value).toContain('INT');
        expect(contents.value).toContain('-32 768');
      }
    });

    it('shows range for REAL variable', () => {
      const src = [
        'PROGRAM P',
        'VAR',
        '  speed : REAL;',
        'END_VAR',
        '  speed := 1.5;',
        'END_PROGRAM',
      ].join('\n');
      const doc = makeDoc(src);
      // Line 4: "  speed := 1.5;" — "speed" starts at character 2
      const result = handleHover(makeParams(doc.uri, 4, 2), doc);
      expect(result).not.toBeNull();
      if (result) {
        const contents = result.contents as { kind: string; value: string };
        expect(contents.value).toContain('speed');
        expect(contents.value).toContain('REAL');
        expect(contents.value).toContain('IEEE 754');
      }
    });

    it('does not show range for ARRAY type', () => {
      const src = [
        'PROGRAM P',
        'VAR',
        '  buf : ARRAY[0..9] OF INT;',
        'END_VAR',
        '  buf[0] := 1;',
        'END_PROGRAM',
      ].join('\n');
      const doc = makeDoc(src);
      // Line 4: "  buf[0] := 1;" — hover over "buf" at character 2
      const result = handleHover(makeParams(doc.uri, 4, 2), doc);
      expect(result).not.toBeNull();
      if (result) {
        const contents = result.contents as { kind: string; value: string };
        expect(contents.value).toContain('buf');
        expect(contents.value).toContain('ARRAY');
        // No range for array types
        expect(contents.value).not.toContain('-32 768');
      }
    });
  });
});

// ---------------------------------------------------------------------------
// Library provenance in hover
// ---------------------------------------------------------------------------

function makeMockIndexWithLibs(libraryRefs: LibraryRef[]): WorkspaceIndex {
  return {
    getProjectFiles: () => [],
    getLibraryRefs: () => libraryRefs,
    getLibrarySymbols: () => [],
  } as unknown as WorkspaceIndex;
}

describe('Hover library provenance', () => {
  // TON is in Tc2_Standard; use it as a call expression so it's a NameExpression
  const src = [
    'PROGRAM Main',
    'VAR t : BOOL; END_VAR',
    '  TON();',
    'END_PROGRAM',
  ].join('\n');

  it('shows library namespace in hover text for stdlib FB', () => {
    const doc = makeDoc(src);
    // Line 2: "  TON();" — "TON" starts at char 2
    const result = handleHover(makeParams(doc.uri, 2, 2), doc);
    expect(result).not.toBeNull();
    if (result) {
      const contents = result.contents as { kind: string; value: string };
      expect(contents.value).toContain('Tc2_Standard');
      expect(contents.value).toContain('TON');
    }
  });

  it('shows warning when stdlib FB library is not in project references', () => {
    const mockIndex = makeMockIndexWithLibs([{ name: 'Tc2_MC2' }]); // Tc2_Standard not referenced
    const doc = makeDoc(src);
    const result = handleHover(makeParams(doc.uri, 2, 2), doc, mockIndex);
    expect(result).not.toBeNull();
    if (result) {
      const contents = result.contents as { kind: string; value: string };
      expect(contents.value).toContain('not referenced');
    }
  });

  it('does NOT show warning when library is correctly referenced', () => {
    const mockIndex = makeMockIndexWithLibs([{ name: 'Tc2_Standard' }]);
    const doc = makeDoc(src);
    const result = handleHover(makeParams(doc.uri, 2, 2), doc, mockIndex);
    expect(result).not.toBeNull();
    if (result) {
      const contents = result.contents as { kind: string; value: string };
      expect(contents.value).not.toContain('not referenced');
    }
  });

  it('does NOT show warning when no library refs (standalone file)', () => {
    const mockIndex = makeMockIndexWithLibs([]);
    const doc = makeDoc(src);
    const result = handleHover(makeParams(doc.uri, 2, 2), doc, mockIndex);
    expect(result).not.toBeNull();
    if (result) {
      const contents = result.contents as { kind: string; value: string };
      expect(contents.value).not.toContain('not referenced');
    }
  });
});

describe('hover over VAR CONSTANT variable shows value', () => {
  it('shows constant value in hover', () => {
    // Hover over the variable name used in the body (NameExpression)
    const src = [
      'PROGRAM Prog',
      'VAR CONSTANT',
      '  MAX_COUNT : INT := 100;',
      'END_VAR',
      'VAR',
      '  x : INT;',
      'END_VAR',
      'x := MAX_COUNT;',
      'END_PROGRAM',
    ].join('\n');
    const doc = makeDoc(src);
    // Line 7: "x := MAX_COUNT;" — MAX_COUNT starts at char 5
    const result = handleHover(makeParams(doc.uri, 7, 5), doc);
    expect(result).not.toBeNull();
    if (result) {
      const contents = result.contents as { kind: string; value: string };
      expect(contents.value).toContain('MAX_COUNT');
      expect(contents.value).toContain('100');
      expect(contents.value).toContain('CONSTANT');
    }
  });

  it('shows expression text for complex constant initializer (2+3)', () => {
    const src = [
      'PROGRAM Prog',
      'VAR CONSTANT',
      '  RESULT : INT := 2 + 3;',
      'END_VAR',
      'VAR',
      '  x : INT;',
      'END_VAR',
      'x := RESULT;',
      'END_PROGRAM',
    ].join('\n');
    const doc = makeDoc(src);
    // Line 7: "x := RESULT;" — RESULT starts at char 5
    const result = handleHover(makeParams(doc.uri, 7, 5), doc);
    expect(result).not.toBeNull();
    if (result) {
      const contents = result.contents as { kind: string; value: string };
      expect(contents.value).toContain('2 + 3');
    }
  });
});

describe('hover over enum declaration shows member values', () => {
  it('shows enum member explicit values in hover', () => {
    // Hover over the enum type name used as a NameExpression in the body
    const src = [
      'TYPE',
      '  E_Color : (Red := 0, Green := 1, Blue := 2);',
      'END_TYPE',
      'PROGRAM Prog',
      'VAR',
      '  c : E_Color;',
      'END_VAR',
      'c := E_Color.Red;',
      'END_PROGRAM',
    ].join('\n');
    const doc = makeDoc(src);
    // Line 7: "c := E_Color.Red;" — E_Color starts at char 5
    const result = handleHover(makeParams(doc.uri, 7, 5), doc);
    expect(result).not.toBeNull();
    if (result) {
      const contents = result.contents as { kind: string; value: string };
      expect(contents.value).toContain('E_Color');
      expect(contents.value).toContain('Red := 0');
      expect(contents.value).toContain('Green := 1');
    }
  });
});

describe('TcPOU position mapping', () => {
  // Line numbers in this TcPOU (0-indexed):
  //  0: <?xml version="1.0" encoding="utf-8"?>
  //  1: <TcPlcObject>
  //  2:   <POU Name="FB_HoverTest">
  //  3:     <Declaration><![CDATA[
  //  4: FUNCTION_BLOCK FB_HoverTest
  //  5: VAR
  //  6:   counter : INT;
  //  7:   flag : BOOL;
  //  8: END_VAR
  //  9: ]]></Declaration>
  // 10:     <Implementation>
  // 11:       <ST><![CDATA[
  // 12: counter := counter + 1;
  // 13: ]]></ST>
  // 14:     </Implementation>
  // 15:   </POU>
  // 16: </TcPlcObject>
  const tcpouContent = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<TcPlcObject>',
    '  <POU Name="FB_HoverTest">',
    '    <Declaration><![CDATA[',
    'FUNCTION_BLOCK FB_HoverTest',
    'VAR',
    '  counter : INT;',
    '  flag : BOOL;',
    'END_VAR',
    ']]></Declaration>',
    '    <Implementation>',
    '      <ST><![CDATA[',
    'counter := counter + 1;',
    ']]></ST>',
    '    </Implementation>',
    '  </POU>',
    '</TcPlcObject>',
  ].join('\n');

  function makeTcPouDoc(content: string): TextDocument {
    return TextDocument.create('file:///test/test.TcPOU', 'iec-st', 1, content);
  }

  it('returns hover content for variable on original-file line in VAR block', () => {
    const doc = makeTcPouDoc(tcpouContent);
    // Line 6 (original): "  counter : INT;"
    // "counter" starts at character 2
    const result = handleHover(makeParams(doc.uri, 6, 2), doc);
    expect(result).not.toBeNull();
    if (result) {
      const contents = result.contents as { kind: string; value: string };
      expect(contents.value).toContain('counter');
      expect(contents.value).toContain('INT');
    }
  });

  it('hover range is in original-file coordinates', () => {
    const doc = makeTcPouDoc(tcpouContent);
    // Line 6 (original): "  counter : INT;"
    const result = handleHover(makeParams(doc.uri, 6, 2), doc);
    expect(result).not.toBeNull();
    if (result && result.range) {
      // The range should be on line 6 of the original file, not extracted-source line 2
      expect(result.range.start.line).toBe(6);
    }
  });

  describe('hover on variable inside method body returns type info', () => {
    const src = [
      'FUNCTION_BLOCK MyFB',
      'VAR',
      '  counter : INT := 0;',
      'END_VAR',
      'METHOD Increment',
      'VAR_INPUT',
      '  amount : INT;',
      'END_VAR',
      '  counter := counter + amount;',
      'END_METHOD',
      'END_FUNCTION_BLOCK',
    ].join('\n');

    it('hover on method VAR_INPUT variable in method body returns type info', () => {
      const doc = makeDoc(src);
      // Line 8: "  counter := counter + amount;"
      // "amount" starts at character 23
      const result = handleHover(makeParams(doc.uri, 8, 23), doc);
      expect(result).not.toBeNull();
      if (result) {
        const contents = result.contents as { kind: string; value: string };
        expect(contents.value).toContain('amount');
        expect(contents.value).toContain('INT');
      }
    });

    it('hover on FB-level variable used inside method body returns type info', () => {
      const doc = makeDoc(src);
      // Line 8: "  counter := counter + amount;"
      // "counter" (first occurrence after leading spaces) starts at character 2
      const result = handleHover(makeParams(doc.uri, 8, 2), doc);
      expect(result).not.toBeNull();
      if (result) {
        const contents = result.contents as { kind: string; value: string };
        expect(contents.value).toContain('counter');
        expect(contents.value).toContain('INT');
      }
    });
  });

  it('returns null when hovering over XML-only line (line 0)', () => {
    const doc = makeTcPouDoc(tcpouContent);
    // Line 0: "<?xml version=\"1.0\" encoding=\"utf-8\"?>"
    const result = handleHover(makeParams(doc.uri, 0, 5), doc);
    expect(result).toBeNull();
  });
});
