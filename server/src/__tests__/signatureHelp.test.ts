import { describe, it, expect } from 'vitest';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { handleSignatureHelp } from '../handlers/signatureHelp';
import { SignatureHelpParams } from 'vscode-languageserver/node';
import type { LibrarySymbol } from '../twincat/libraryZipReader';
import type { WorkspaceIndex } from '../twincat/workspaceIndex';

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

function makeMockIndex(symbols: LibrarySymbol[] = []): WorkspaceIndex {
  return {
    getLibrarySymbols: () => symbols,
  } as unknown as WorkspaceIndex;
}

describe('handleSignatureHelp', () => {
  describe('standard FB: TON', () => {
    it('returns TON signature with 4 parameters (inputs + outputs)', () => {
      const src = 'TON(';
      const doc = makeDoc(src);
      const result = handleSignatureHelp(makeParams(doc.uri, 0, 4), doc);

      expect(result).not.toBeNull();
      expect(result!.signatures).toHaveLength(1);

      const sig = result!.signatures[0];
      expect(sig.label).toContain('TON');
      expect(sig.parameters).toHaveLength(4);
      // Inputs (no prefix)
      expect(sig.parameters![0].label).toBe('IN: BOOL');
      expect(sig.parameters![1].label).toBe('PT: TIME');
      // Outputs (OUT prefix)
      expect(sig.parameters![2].label).toBe('OUT Q: BOOL');
      expect(sig.parameters![3].label).toBe('OUT ET: TIME');
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

    it('TON signature label has correct format with outputs', () => {
      const src = 'TON(';
      const doc = makeDoc(src);
      const result = handleSignatureHelp(makeParams(doc.uri, 0, 4), doc);

      expect(result).not.toBeNull();
      expect(result!.signatures[0].label).toBe(
        'TON(IN: BOOL, PT: TIME, OUT Q: BOOL, OUT ET: TIME)',
      );
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
    it('CTU returns 5 parameters (3 inputs + 2 outputs)', () => {
      const src = 'CTU(';
      const doc = makeDoc(src);
      const result = handleSignatureHelp(makeParams(doc.uri, 0, 4), doc);

      expect(result).not.toBeNull();
      expect(result!.signatures[0].parameters).toHaveLength(5);
      expect(result!.signatures[0].parameters![0].label).toBe('CU: BOOL');
      expect(result!.signatures[0].parameters![1].label).toBe('R: BOOL');
      expect(result!.signatures[0].parameters![2].label).toBe('PV: INT');
      expect(result!.signatures[0].parameters![3].label).toBe('OUT Q: BOOL');
      expect(result!.signatures[0].parameters![4].label).toBe('OUT CV: INT');
    });

    it('R_TRIG returns 2 parameters (1 input + 1 output)', () => {
      const src = 'R_TRIG(';
      const doc = makeDoc(src);
      const result = handleSignatureHelp(makeParams(doc.uri, 0, src.length), doc);

      expect(result).not.toBeNull();
      expect(result!.signatures[0].parameters).toHaveLength(2);
      expect(result!.signatures[0].parameters![0].label).toBe('CLK: BOOL');
      expect(result!.signatures[0].parameters![1].label).toBe('OUT Q: BOOL');
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

    it('returns signature for user-defined FUNCTION with return type', () => {
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
      expect(sig.label).toBe('MyAdd(a: INT, b: INT) : INT');
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

  describe('user-defined FUNCTION_BLOCK with all parameter directions', () => {
    const src = [
      'FUNCTION_BLOCK MyFB',
      'VAR_INPUT',
      '  enable : BOOL;',
      '  setpoint : REAL;',
      'END_VAR',
      'VAR_OUTPUT',
      '  done : BOOL;',
      '  result : REAL;',
      'END_VAR',
      'VAR_IN_OUT',
      '  buffer : INT;',
      'END_VAR',
      'END_FUNCTION_BLOCK',
      'PROGRAM Main',
      'VAR',
      '  fb : MyFB;',
      'END_VAR',
      '  fb(',
      'END_PROGRAM',
    ].join('\n');

    it('returns signature with all directions labeled', () => {
      const doc = makeDoc(src);
      const result = handleSignatureHelp(
        makeParams(doc.uri, 17, '  fb('.length),
        doc,
      );

      expect(result).not.toBeNull();
      const sig = result!.signatures[0];
      expect(sig.label).toContain('MyFB');
      expect(sig.parameters).toHaveLength(5);
      // Inputs (no prefix)
      expect(sig.parameters![0].label).toBe('enable: BOOL');
      expect(sig.parameters![1].label).toBe('setpoint: REAL');
      // Outputs (OUT prefix)
      expect(sig.parameters![2].label).toBe('OUT done: BOOL');
      expect(sig.parameters![3].label).toBe('OUT result: REAL');
      // In/out (INOUT prefix)
      expect(sig.parameters![4].label).toBe('INOUT buffer: INT');
    });
  });

  describe('optional parameters with default values', () => {
    const src = [
      'FUNCTION MyFunc : BOOL',
      'VAR_INPUT',
      '  required : INT;',
      '  optional1 : INT := 42;',
      '  optional2 : BOOL := TRUE;',
      'END_VAR',
      '  MyFunc := TRUE;',
      'END_FUNCTION',
      'PROGRAM Main',
      'VAR x : BOOL; END_VAR',
      '  x := MyFunc(',
      'END_PROGRAM',
    ].join('\n');

    it('marks parameters with default values as optional', () => {
      const doc = makeDoc(src);
      const line10 = '  x := MyFunc(';
      const result = handleSignatureHelp(
        makeParams(doc.uri, 10, line10.length),
        doc,
      );

      expect(result).not.toBeNull();
      const sig = result!.signatures[0];
      expect(sig.parameters).toHaveLength(3);
      // Required param (no ? marker)
      expect(sig.parameters![0].label).toBe('required: INT');
      // Optional params (? marker + default value)
      expect(sig.parameters![1].label).toBe('optional1?: INT := 42');
      expect(sig.parameters![2].label).toBe('optional2?: BOOL := TRUE');
    });

    it('shows return type in the signature label', () => {
      const doc = makeDoc(src);
      const line10 = '  x := MyFunc(';
      const result = handleSignatureHelp(
        makeParams(doc.uri, 10, line10.length),
        doc,
      );

      expect(result).not.toBeNull();
      const sig = result!.signatures[0];
      expect(sig.label).toBe(
        'MyFunc(required: INT, optional1?: INT := 42, optional2?: BOOL := TRUE) : BOOL',
      );
    });
  });

  describe('library method resolution', () => {
    it('resolves method parameters from LibrarySymbol.methods', () => {
      const src = [
        'PROGRAM Main',
        'VAR',
        '  axis : MC_MoveAbsolute;',
        'END_VAR',
        '  axis.Execute(',
        'END_PROGRAM',
      ].join('\n');

      const libSymbols: LibrarySymbol[] = [
        {
          name: 'MC_MoveAbsolute',
          kind: 'functionBlock',
          namespace: 'Tc2_MC2',
          inputs: [
            { name: 'Execute', type: 'BOOL', direction: 'input' },
            { name: 'Position', type: 'LREAL', direction: 'input' },
          ],
          outputs: [
            { name: 'Done', type: 'BOOL', direction: 'output' },
          ],
          methods: [
            {
              name: 'Execute',
              description: 'Execute the move',
              inputs: [
                { name: 'Param1', type: 'LREAL', direction: 'input' },
              ],
              outputs: [
                { name: 'Status', type: 'INT', direction: 'output' },
              ],
              returnType: 'BOOL',
            },
          ],
        },
      ];

      const doc = makeDoc(src);
      const mockIndex = makeMockIndex(libSymbols);
      const line4 = '  axis.Execute(';
      const result = handleSignatureHelp(
        makeParams(doc.uri, 4, line4.length),
        doc,
        mockIndex,
      );

      expect(result).not.toBeNull();
      const sig = result!.signatures[0];
      expect(sig.label).toBe('MC_MoveAbsolute.Execute(Param1: LREAL, OUT Status: INT) : BOOL');
      expect(sig.parameters).toHaveLength(2);
      expect(sig.parameters![0].label).toBe('Param1: LREAL');
      expect(sig.parameters![1].label).toBe('OUT Status: INT');
    });
  });

  describe('library symbol direct call', () => {
    it('shows library symbol inputs and outputs', () => {
      const libSymbols: LibrarySymbol[] = [
        {
          name: 'FB_MyLib',
          kind: 'functionBlock',
          namespace: 'TestLib',
          description: 'A library FB',
          inputs: [
            { name: 'Enable', type: 'BOOL', direction: 'input' },
          ],
          outputs: [
            { name: 'Active', type: 'BOOL', direction: 'output' },
          ],
          inOuts: [
            { name: 'Data', type: 'INT', direction: 'inOut' },
          ],
          returnType: undefined,
        },
      ];

      const src = 'FB_MyLib(';
      const doc = makeDoc(src);
      const mockIndex = makeMockIndex(libSymbols);
      const result = handleSignatureHelp(
        makeParams(doc.uri, 0, src.length),
        doc,
        mockIndex,
      );

      expect(result).not.toBeNull();
      const sig = result!.signatures[0];
      expect(sig.parameters).toHaveLength(3);
      expect(sig.parameters![0].label).toBe('Enable: BOOL');
      expect(sig.parameters![1].label).toBe('OUT Active: BOOL');
      expect(sig.parameters![2].label).toBe('INOUT Data: INT');
    });
  });

  describe('user-defined FB method call', () => {
    const src = [
      'FUNCTION_BLOCK MyController',
      'VAR_INPUT',
      '  gain : REAL;',
      'END_VAR',
      '',
      'METHOD Calculate : REAL',
      'VAR_INPUT',
      '  input : REAL;',
      '  offset : REAL := 0.0;',
      'END_VAR',
      'VAR_OUTPUT',
      '  error : BOOL;',
      'END_VAR',
      '  Calculate := input * gain + offset;',
      'END_METHOD',
      'END_FUNCTION_BLOCK',
      'PROGRAM Main',
      'VAR',
      '  ctrl : MyController;',
      '  val : REAL;',
      'END_VAR',
      '  val := ctrl.Calculate(',
      'END_PROGRAM',
    ].join('\n');

    it('resolves method signature with all directions and return type', () => {
      const doc = makeDoc(src);
      const line21 = '  val := ctrl.Calculate(';
      const result = handleSignatureHelp(
        makeParams(doc.uri, 21, line21.length),
        doc,
      );

      expect(result).not.toBeNull();
      const sig = result!.signatures[0];
      expect(sig.label).toBe(
        'MyController.Calculate(input: REAL, offset?: REAL := 0.0, OUT error: BOOL) : REAL',
      );
      expect(sig.parameters).toHaveLength(3);
      expect(sig.parameters![0].label).toBe('input: REAL');
      expect(sig.parameters![1].label).toBe('offset?: REAL := 0.0');
      expect(sig.parameters![2].label).toBe('OUT error: BOOL');
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

// ---------------------------------------------------------------------------
// TwinCAT XML (.TcPOU) extraction tests
// ---------------------------------------------------------------------------

describe('handleSignatureHelp — TcPOU XML extraction', () => {
  // 'TON(' is on original line 10 (extracted line 5).
  // offsets: { 0:4, 1:5, 2:6, 3:7, 4:9, 5:10 }
  const xmlPou = [
    '<?xml version="1.0" encoding="utf-8"?>',  // line 0
    '<TcPlcObject Version="1.1.0.1">',           // line 1
    '  <POU Name="TestFB">',                     // line 2
    '    <Declaration><![CDATA[',                // line 3
    'FUNCTION_BLOCK TestFB',                     // line 4  (extracted line 0)
    'VAR',                                       // line 5  (extracted line 1)
    '  counter : INT := 0;',                     // line 6  (extracted line 2)
    'END_VAR]]></Declaration>',                  // line 7  (extracted line 3)
    '    <Implementation>',                      // line 8
    '      <ST><![CDATA[',                       // line 9  (extracted line 4 — blank separator)
    'TON(',                                      // line 10 (extracted line 5)
    ']]></ST>',                                  // line 11
    '    </Implementation>',                     // line 12
    '  </POU>',                                  // line 13
    '</TcPlcObject>',                            // line 14
  ].join('\n');

  it('returns signature help when cursor is inside a call in a TcPOU at original-file position', () => {
    const doc = TextDocument.create('file:///test.TcPOU', 'iec-st', 1, xmlPou);
    // Cursor at original line 10, character 4 (after "TON(")
    const params = makeParams(doc.uri, 10, 4);
    const result = handleSignatureHelp(params, doc);

    expect(result).not.toBeNull();
    expect(result!.signatures).toHaveLength(1);
    expect(result!.signatures[0].label).toContain('TON');
  });
});
