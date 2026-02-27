import { describe, it, expect } from 'vitest';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { handleDocumentSymbols } from '../handlers/documentSymbols';
import { SymbolKind } from 'vscode-languageserver/node';

function makeDoc(content: string): TextDocument {
  return TextDocument.create('file:///test.st', 'iec-st', 1, content);
}

function makeParams(uri: string) {
  return {
    textDocument: { uri },
  };
}

describe('handleDocumentSymbols', () => {
  it('returns empty array for empty file', () => {
    const doc = makeDoc('');
    const symbols = handleDocumentSymbols(makeParams(doc.uri), doc);
    expect(symbols).toEqual([]);
  });

  it('returns empty array for undefined document', () => {
    const symbols = handleDocumentSymbols(makeParams('file:///test.st'), undefined);
    expect(symbols).toEqual([]);
  });

  describe('PROGRAM', () => {
    it('returns Module symbol for PROGRAM with 2 variables', () => {
      const src = `PROGRAM Main
VAR
  myVar : BOOL;
  counter : INT;
END_VAR
END_PROGRAM`;
      const doc = makeDoc(src);
      const symbols = handleDocumentSymbols(makeParams(doc.uri), doc);

      expect(symbols).toHaveLength(1);
      expect(symbols[0].name).toBe('Main');
      expect(symbols[0].kind).toBe(SymbolKind.Module);
      // VAR block as child container
      expect(symbols[0].children).toHaveLength(1);
      const varBlock = symbols[0].children![0];
      expect(varBlock.name).toBe('VAR');
      expect(varBlock.kind).toBe(SymbolKind.Variable);
      expect(varBlock.children).toHaveLength(2);
      expect(varBlock.children![0].name).toBe('myVar');
      expect(varBlock.children![0].kind).toBe(SymbolKind.Variable);
      expect(varBlock.children![1].name).toBe('counter');
    });

    it('returns Module symbol for PROGRAM with no variables', () => {
      const src = `PROGRAM Empty
END_PROGRAM`;
      const doc = makeDoc(src);
      const symbols = handleDocumentSymbols(makeParams(doc.uri), doc);

      expect(symbols).toHaveLength(1);
      expect(symbols[0].name).toBe('Empty');
      expect(symbols[0].kind).toBe(SymbolKind.Module);
    });
  });

  describe('FUNCTION_BLOCK', () => {
    it('returns Class symbol for FUNCTION_BLOCK', () => {
      const src = `FUNCTION_BLOCK FB_Valve
VAR
  bOpen : BOOL;
END_VAR
END_FUNCTION_BLOCK`;
      const doc = makeDoc(src);
      const symbols = handleDocumentSymbols(makeParams(doc.uri), doc);

      expect(symbols).toHaveLength(1);
      expect(symbols[0].name).toBe('FB_Valve');
      expect(symbols[0].kind).toBe(SymbolKind.Class);
    });

    it('includes EXTENDS detail for FUNCTION_BLOCK', () => {
      const src = `FUNCTION_BLOCK FB_Child EXTENDS FB_Base
END_FUNCTION_BLOCK`;
      const doc = makeDoc(src);
      const symbols = handleDocumentSymbols(makeParams(doc.uri), doc);

      expect(symbols).toHaveLength(1);
      expect(symbols[0].detail).toBe('EXTENDS FB_Base');
    });

    it('includes variable children for FUNCTION_BLOCK', () => {
      const src = `FUNCTION_BLOCK FB_Valve
VAR_INPUT
  bEnable : BOOL;
END_VAR
VAR_OUTPUT
  bActive : BOOL;
END_VAR
END_FUNCTION_BLOCK`;
      const doc = makeDoc(src);
      const symbols = handleDocumentSymbols(makeParams(doc.uri), doc);

      // Two VAR section groups: VAR_INPUT and VAR_OUTPUT
      const varSections = symbols[0].children!.filter(c => c.kind === SymbolKind.Variable);
      expect(varSections).toHaveLength(2);
      expect(varSections[0].name).toBe('VAR_INPUT');
      expect(varSections[0].children![0].name).toBe('bEnable');
      expect(varSections[1].name).toBe('VAR_OUTPUT');
      expect(varSections[1].children![0].name).toBe('bActive');
    });

    it('includes method children for FUNCTION_BLOCK', () => {
      const src = `FUNCTION_BLOCK FB_Motor
METHOD Start : BOOL
END_METHOD
METHOD Stop
END_METHOD
END_FUNCTION_BLOCK`;
      const doc = makeDoc(src);
      const symbols = handleDocumentSymbols(makeParams(doc.uri), doc);

      expect(symbols).toHaveLength(1);
      const methods = symbols[0].children?.filter(c => c.kind === SymbolKind.Method);
      expect(methods).toBeDefined();
      expect(methods!.length).toBeGreaterThanOrEqual(1);
      const startMethod = methods!.find(m => m.name === 'Start');
      expect(startMethod).toBeDefined();
    });
  });

  describe('FUNCTION', () => {
    it('returns Function symbol for FUNCTION with return type', () => {
      const src = `FUNCTION Add : INT
VAR_INPUT
  a : INT;
  b : INT;
END_VAR
END_FUNCTION`;
      const doc = makeDoc(src);
      const symbols = handleDocumentSymbols(makeParams(doc.uri), doc);

      expect(symbols).toHaveLength(1);
      expect(symbols[0].name).toBe('Add');
      expect(symbols[0].kind).toBe(SymbolKind.Function);
      expect(symbols[0].detail).toBe(': INT');
    });

    it('includes variable children for FUNCTION', () => {
      const src = `FUNCTION Add : INT
VAR_INPUT
  a : INT;
  b : INT;
END_VAR
END_FUNCTION`;
      const doc = makeDoc(src);
      const symbols = handleDocumentSymbols(makeParams(doc.uri), doc);

      // One VAR_INPUT section containing 2 variables
      expect(symbols[0].children).toHaveLength(1);
      const varInput = symbols[0].children![0];
      expect(varInput.name).toBe('VAR_INPUT');
      expect(varInput.children).toHaveLength(2);
      expect(varInput.children![0].name).toBe('a');
      expect(varInput.children![1].name).toBe('b');
    });

    it('returns Function symbol with no detail when no return type', () => {
      const src = `FUNCTION DoSomething
END_FUNCTION`;
      const doc = makeDoc(src);
      const symbols = handleDocumentSymbols(makeParams(doc.uri), doc);

      expect(symbols).toHaveLength(1);
      expect(symbols[0].name).toBe('DoSomething');
      expect(symbols[0].kind).toBe(SymbolKind.Function);
      expect(symbols[0].detail).toBeUndefined();
    });
  });

  describe('TYPE block with struct', () => {
    it('returns Struct symbol with field children', () => {
      const src = `TYPE
  ST_Point : STRUCT
    x : REAL;
    y : REAL;
    z : REAL;
  END_STRUCT
END_TYPE`;
      const doc = makeDoc(src);
      const symbols = handleDocumentSymbols(makeParams(doc.uri), doc);

      expect(symbols).toHaveLength(1);
      expect(symbols[0].name).toBe('ST_Point');
      expect(symbols[0].kind).toBe(SymbolKind.Struct);
      expect(symbols[0].children).toHaveLength(3);
      expect(symbols[0].children![0].name).toBe('x');
      expect(symbols[0].children![0].kind).toBe(SymbolKind.Field);
      expect(symbols[0].children![1].name).toBe('y');
      expect(symbols[0].children![2].name).toBe('z');
    });
  });

  describe('TYPE block with enum', () => {
    it('returns Enum symbol with EnumMember children', () => {
      const src = `TYPE
  E_Direction : (
    Forward,
    Backward,
    Stop
  );
END_TYPE`;
      const doc = makeDoc(src);
      const symbols = handleDocumentSymbols(makeParams(doc.uri), doc);

      expect(symbols).toHaveLength(1);
      expect(symbols[0].name).toBe('E_Direction');
      expect(symbols[0].kind).toBe(SymbolKind.Enum);
      expect(symbols[0].children).toHaveLength(3);
      expect(symbols[0].children![0].name).toBe('Forward');
      expect(symbols[0].children![0].kind).toBe(SymbolKind.EnumMember);
      expect(symbols[0].children![1].name).toBe('Backward');
      expect(symbols[0].children![2].name).toBe('Stop');
    });
  });

  describe('INTERFACE', () => {
    it('returns Interface symbol for INTERFACE', () => {
      const src = `INTERFACE IMotor
METHOD Start : BOOL
END_METHOD
END_INTERFACE`;
      const doc = makeDoc(src);
      const symbols = handleDocumentSymbols(makeParams(doc.uri), doc);

      expect(symbols).toHaveLength(1);
      expect(symbols[0].name).toBe('IMotor');
      expect(symbols[0].kind).toBe(SymbolKind.Interface);
    });

    it('returns Method children for INTERFACE', () => {
      const src = `INTERFACE IMotor
METHOD Start : BOOL
END_METHOD
METHOD Stop
END_METHOD
END_INTERFACE`;
      const doc = makeDoc(src);
      const symbols = handleDocumentSymbols(makeParams(doc.uri), doc);

      expect(symbols[0].children).toBeDefined();
      const methods = symbols[0].children!.filter(c => c.kind === SymbolKind.Method);
      expect(methods.length).toBeGreaterThanOrEqual(1);
      const startMethod = methods.find(m => m.name === 'Start');
      expect(startMethod).toBeDefined();
      expect(startMethod!.kind).toBe(SymbolKind.Method);
    });
  });

  describe('TYPE block with alias', () => {
    it('returns TypeParameter symbol for alias', () => {
      const src = `TYPE
  T_MyInt : INT;
END_TYPE`;
      const doc = makeDoc(src);
      const symbols = handleDocumentSymbols(makeParams(doc.uri), doc);

      expect(symbols).toHaveLength(1);
      expect(symbols[0].name).toBe('T_MyInt');
      expect(symbols[0].kind).toBe(SymbolKind.TypeParameter);
      expect(symbols[0].detail).toBe('= INT');
    });
  });

  describe('mixed file', () => {
    it('returns multiple top-level symbols for mixed declarations', () => {
      const src = `PROGRAM Main
VAR
  x : INT;
END_VAR
END_PROGRAM

FUNCTION_BLOCK FB_Valve
VAR
  bOpen : BOOL;
END_VAR
END_FUNCTION_BLOCK

FUNCTION Add : INT
END_FUNCTION

TYPE
  ST_Point : STRUCT
    x : REAL;
  END_STRUCT
END_TYPE

INTERFACE IMotor
END_INTERFACE`;
      const doc = makeDoc(src);
      const symbols = handleDocumentSymbols(makeParams(doc.uri), doc);

      expect(symbols.length).toBeGreaterThanOrEqual(5);

      const program = symbols.find(s => s.name === 'Main');
      expect(program).toBeDefined();
      expect(program!.kind).toBe(SymbolKind.Module);

      const fb = symbols.find(s => s.name === 'FB_Valve');
      expect(fb).toBeDefined();
      expect(fb!.kind).toBe(SymbolKind.Class);

      const fn = symbols.find(s => s.name === 'Add');
      expect(fn).toBeDefined();
      expect(fn!.kind).toBe(SymbolKind.Function);

      const struct = symbols.find(s => s.name === 'ST_Point');
      expect(struct).toBeDefined();
      expect(struct!.kind).toBe(SymbolKind.Struct);

      const iface = symbols.find(s => s.name === 'IMotor');
      expect(iface).toBeDefined();
      expect(iface!.kind).toBe(SymbolKind.Interface);
    });
  });

  describe('variable type details', () => {
    it('shows array type in variable detail', () => {
      const src = `PROGRAM Main
VAR
  arr : ARRAY[0..9] OF INT;
END_VAR
END_PROGRAM`;
      const doc = makeDoc(src);
      const symbols = handleDocumentSymbols(makeParams(doc.uri), doc);

      const varSection = symbols[0].children![0];
      expect(varSection.name).toBe('VAR');
      expect(varSection.children).toHaveLength(1);
      expect(varSection.children![0].detail).toBe('ARRAY[0..9] OF INT');
    });

    it('shows pointer type in variable detail', () => {
      const src = `PROGRAM Main
VAR
  pVal : POINTER TO INT;
END_VAR
END_PROGRAM`;
      const doc = makeDoc(src);
      const symbols = handleDocumentSymbols(makeParams(doc.uri), doc);

      const varSection = symbols[0].children![0];
      expect(varSection.name).toBe('VAR');
      expect(varSection.children).toHaveLength(1);
      expect(varSection.children![0].detail).toBe('POINTER TO INT');
    });
  });

  describe('FUNCTION_BLOCK with ACTION blocks', () => {
    it('shows actions as Method symbols under the FB', () => {
      const src = `FUNCTION_BLOCK MyFB
VAR x : INT; END_VAR
END_FUNCTION_BLOCK
ACTION Run:
x := x + 1;
END_ACTION
ACTION Reset:
x := 0;
END_ACTION`;
      const doc = makeDoc(src);
      const symbols = handleDocumentSymbols(makeParams(doc.uri), doc);

      expect(symbols).toHaveLength(1);
      expect(symbols[0].name).toBe('MyFB');
      const methodChildren = symbols[0].children!.filter(c => c.kind === SymbolKind.Method);
      expect(methodChildren).toHaveLength(2);
      expect(methodChildren[0].name).toBe('Run');
      expect(methodChildren[1].name).toBe('Reset');
    });
  });

  describe('FUNCTION_BLOCK with PROPERTY declarations', () => {
    it('shows properties as Property symbols under the FB', () => {
      const src = `FUNCTION_BLOCK FB_WithProp
PROPERTY Speed : REAL
END_PROPERTY
PROPERTY IsRunning : BOOL
END_PROPERTY
END_FUNCTION_BLOCK`;
      const doc = makeDoc(src);
      const symbols = handleDocumentSymbols(makeParams(doc.uri), doc);

      expect(symbols).toHaveLength(1);
      expect(symbols[0].kind).toBe(SymbolKind.Class);
      const props = symbols[0].children?.filter(c => c.kind === SymbolKind.Property);
      expect(props).toBeDefined();
      expect(props!.length).toBeGreaterThanOrEqual(1);
      const speed = props!.find(p => p.name === 'Speed');
      expect(speed).toBeDefined();
      expect(speed!.detail).toBe('REAL');
    });
  });

  describe('TYPE block with UNION', () => {
    it('returns Struct symbol with Field children for UNION', () => {
      const src = `TYPE
  U_Overlap : UNION
    asBytes : ARRAY[0..3] OF BYTE;
    asInt   : DINT;
  END_UNION
END_TYPE`;
      const doc = makeDoc(src);
      const symbols = handleDocumentSymbols(makeParams(doc.uri), doc);

      expect(symbols).toHaveLength(1);
      expect(symbols[0].name).toBe('U_Overlap');
      expect(symbols[0].kind).toBe(SymbolKind.Struct);
      const fields = symbols[0].children!;
      expect(fields).toHaveLength(2);
      expect(fields[0].name).toBe('asBytes');
      expect(fields[0].kind).toBe(SymbolKind.Field);
      expect(fields[1].name).toBe('asInt');
      expect(fields[1].detail).toBe('DINT');
    });
  });

  describe('VAR block grouping', () => {
    it('skips empty VAR blocks (no declarations)', () => {
      const src = `PROGRAM Main
END_PROGRAM`;
      const doc = makeDoc(src);
      const symbols = handleDocumentSymbols(makeParams(doc.uri), doc);

      expect(symbols[0].children).toBeUndefined();
    });

    it('groups multiple VAR section kinds as separate children', () => {
      const src = `FUNCTION_BLOCK FB_Multi
VAR_INPUT
  nIn : INT;
END_VAR
VAR_OUTPUT
  nOut : INT;
END_VAR
VAR
  nLocal : INT;
END_VAR
VAR_TEMP
  nTemp : INT;
END_VAR
END_FUNCTION_BLOCK`;
      const doc = makeDoc(src);
      const symbols = handleDocumentSymbols(makeParams(doc.uri), doc);

      const varSections = symbols[0].children!.filter(c => c.kind === SymbolKind.Variable);
      expect(varSections).toHaveLength(4);
      expect(varSections[0].name).toBe('VAR_INPUT');
      expect(varSections[1].name).toBe('VAR_OUTPUT');
      expect(varSections[2].name).toBe('VAR');
      expect(varSections[3].name).toBe('VAR_TEMP');
    });
  });
});
