import { describe, it, expect } from 'vitest';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { handleDefinition } from '../handlers/definition';

function makeDoc(content: string, uri = 'file:///test.st'): TextDocument {
  return TextDocument.create(uri, 'st', 1, content);
}

function makeParams(uri: string, line: number, character: number) {
  return {
    textDocument: { uri },
    position: { line, character },
  };
}

/** Find the (line, character) of the first occurrence of `needle` in `src`. */
function findPos(src: string, needle: string): { line: number; character: number } {
  const idx = src.indexOf(needle);
  if (idx === -1) throw new Error(`"${needle}" not found in source`);
  const before = src.slice(0, idx);
  const line = (before.match(/\n/g) ?? []).length;
  const lastNl = before.lastIndexOf('\n');
  const character = lastNl === -1 ? idx : idx - lastNl - 1;
  return { line, character };
}

describe('handleDefinition', () => {
  describe('SUPER^.Method go-to-definition', () => {
    const src = `FUNCTION_BLOCK FB_Parent
METHOD DoWork : BOOL
END_METHOD
PROPERTY MyProp : INT
END_PROPERTY
END_FUNCTION_BLOCK

FUNCTION_BLOCK FB_Child EXTENDS FB_Parent
VAR
  dummy : BOOL;
END_VAR
  SUPER^.DoWork();
END_FUNCTION_BLOCK
`;

    it('navigates to parent METHOD when cursor is on the member name', () => {
      const doc = makeDoc(src);
      // Find the position of 'DoWork' in 'SUPER^.DoWork()'
      const pos = findPos(src, 'SUPER^.DoWork');
      const memberPos = { line: pos.line, character: pos.character + 'SUPER^.'.length + 2 };
      const result = handleDefinition(makeParams(doc.uri, memberPos.line, memberPos.character), doc, undefined);
      expect(result).not.toBeNull();
      expect(result?.uri).toBe(doc.uri);
      // The target range should be on the METHOD DoWork declaration line
      const methodPos = findPos(src, 'METHOD DoWork');
      expect(result?.range.start.line).toBe(methodPos.line);
    });

    it('navigates to parent PROPERTY when cursor is on property name', () => {
      const propSrc = `FUNCTION_BLOCK FB_Parent
METHOD DoWork : BOOL
END_METHOD
PROPERTY MyProp : INT
END_PROPERTY
END_FUNCTION_BLOCK

FUNCTION_BLOCK FB_Child EXTENDS FB_Parent
VAR
  dummy : BOOL;
END_VAR
  dummy := SUPER^.MyProp;
END_FUNCTION_BLOCK
`;
      const doc = makeDoc(propSrc);
      const pos = findPos(propSrc, 'SUPER^.MyProp');
      const memberPos = { line: pos.line, character: pos.character + 'SUPER^.'.length + 2 };
      const result = handleDefinition(makeParams(doc.uri, memberPos.line, memberPos.character), doc, undefined);
      expect(result).not.toBeNull();
      const propPos = findPos(propSrc, 'PROPERTY MyProp');
      expect(result?.range.start.line).toBe(propPos.line);
    });

    it('returns null when the method does not exist in the parent', () => {
      const doc = makeDoc(src);
      const pos = findPos(src, 'SUPER^.DoWork');
      // Simulate cursor on a nonexistent member by testing after declaration
      // Instead just check a fully separate doc with no method
      const emptySrc = `FUNCTION_BLOCK FB_Parent
END_FUNCTION_BLOCK
FUNCTION_BLOCK FB_Child EXTENDS FB_Parent
VAR
  dummy : BOOL;
END_VAR
  SUPER^.NoSuchMethod();
END_FUNCTION_BLOCK
`;
      const emptyDoc = makeDoc(emptySrc);
      const ePos = findPos(emptySrc, 'SUPER^.NoSuchMethod');
      const eMemberPos = { line: ePos.line, character: ePos.character + 'SUPER^.'.length + 2 };
      const result = handleDefinition(makeParams(emptyDoc.uri, eMemberPos.line, eMemberPos.character), emptyDoc, undefined);
      expect(result).toBeNull();
    });

    it('returns null when there is no enclosing EXTENDS FB', () => {
      const noExtendsSrc = `FUNCTION_BLOCK FB_Standalone
VAR
  dummy : BOOL;
END_VAR
  SUPER^.DoWork();
END_FUNCTION_BLOCK
`;
      const doc = makeDoc(noExtendsSrc);
      const pos = findPos(noExtendsSrc, 'SUPER^.DoWork');
      const memberPos = { line: pos.line, character: pos.character + 'SUPER^.'.length + 2 };
      const result = handleDefinition(makeParams(doc.uri, memberPos.line, memberPos.character), doc, undefined);
      expect(result).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // Local variable declaration lookup
  // ---------------------------------------------------------------------------
  describe('local variable declaration lookup', () => {
    const src = `PROGRAM Main
VAR
  counter : INT;
  enabled : BOOL;
END_VAR
  counter := counter + 1;
END_PROGRAM
`;

    it('navigates to the VAR declaration when cursor is on a variable usage', () => {
      const doc = makeDoc(src);
      // cursor on second 'counter' (in the assignment RHS)
      const usagePos = findPos(src, 'counter + 1');
      const result = handleDefinition(makeParams(doc.uri, usagePos.line, usagePos.character), doc, undefined);
      expect(result).not.toBeNull();
      const declPos = findPos(src, 'counter : INT');
      expect(result?.range.start.line).toBe(declPos.line);
    });

    it('navigates to the declaration of another local variable', () => {
      const usageSrc = `PROGRAM Main
VAR
  counter : INT;
  enabled : BOOL;
END_VAR
  IF enabled THEN counter := 1; END_IF;
END_PROGRAM
`;
      const doc = makeDoc(usageSrc);
      // cursor on 'enabled' in the body (IF enabled)
      const pos = findPos(usageSrc, 'IF enabled');
      const enabledPos = { line: pos.line, character: pos.character + 'IF '.length };
      const result = handleDefinition(makeParams(doc.uri, enabledPos.line, enabledPos.character), doc, undefined);
      expect(result).not.toBeNull();
      const declPos = findPos(usageSrc, 'enabled : BOOL');
      expect(result?.range.start.line).toBe(declPos.line);
    });

    it('returns null for unknown identifier', () => {
      const unknownSrc = `PROGRAM Main
VAR
END_VAR
  unknown123 := 0;
END_PROGRAM
`;
      const doc = makeDoc(unknownSrc);
      const pos = findPos(unknownSrc, 'unknown123');
      const result = handleDefinition(makeParams(doc.uri, pos.line, pos.character), doc, undefined);
      expect(result).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // POU declaration lookup (same file)
  // ---------------------------------------------------------------------------
  describe('POU declaration lookup', () => {
    const src = `FUNCTION_BLOCK FB_Motor
VAR
END_VAR
END_FUNCTION_BLOCK

PROGRAM Main
VAR
  motor : FB_Motor;
END_VAR
END_PROGRAM
`;

    it('navigates to FB declaration when cursor is on POU name usage', () => {
      const doc = makeDoc(src);
      // cursor on 'FB_Motor' in the VAR block (type reference via TypeRef)
      const typePos = findPos(src, 'motor : FB_Motor');
      const fbMotorOffset = 'motor : '.length;
      const pos = { line: typePos.line, character: typePos.character + fbMotorOffset };
      const result = handleDefinition(makeParams(doc.uri, pos.line, pos.character), doc, undefined);
      expect(result).not.toBeNull();
      const declPos = findPos(src, 'FUNCTION_BLOCK FB_Motor');
      expect(result?.range.start.line).toBe(declPos.line);
    });
  });

  // ---------------------------------------------------------------------------
  // TypeRef navigation (cursor on type name in VAR declaration)
  // ---------------------------------------------------------------------------
  describe('TypeRef navigation', () => {
    it('navigates from type usage to FUNCTION_BLOCK declaration', () => {
      const src = `FUNCTION_BLOCK FB_Controller
VAR
END_VAR
END_FUNCTION_BLOCK

PROGRAM Main
VAR
  ctrl : FB_Controller;
END_VAR
END_PROGRAM
`;
      const doc = makeDoc(src);
      const varLine = findPos(src, 'ctrl : FB_Controller');
      const typePos = { line: varLine.line, character: varLine.character + 'ctrl : '.length };
      const result = handleDefinition(makeParams(doc.uri, typePos.line, typePos.character), doc, undefined);
      expect(result).not.toBeNull();
      const declLine = findPos(src, 'FUNCTION_BLOCK FB_Controller');
      expect(result?.range.start.line).toBe(declLine.line);
    });

    it('navigates from type usage to STRUCT declaration', () => {
      const src = `TYPE
  MyStruct : STRUCT
    x : INT;
    y : INT;
  END_STRUCT
END_TYPE

PROGRAM Main
VAR
  pt : MyStruct;
END_VAR
END_PROGRAM
`;
      const doc = makeDoc(src);
      const varLine = findPos(src, 'pt : MyStruct');
      const typePos = { line: varLine.line, character: varLine.character + 'pt : '.length };
      const result = handleDefinition(makeParams(doc.uri, typePos.line, typePos.character), doc, undefined);
      expect(result).not.toBeNull();
      expect(result?.uri).toBe(doc.uri);
      // The parser anchors StructDeclaration range to the TYPE block start (line 0)
      expect(result?.range.start.line).toBe(0);
    });

    it('returns null for built-in types (INT, BOOL, etc.)', () => {
      const src = `PROGRAM Main
VAR
  x : INT;
END_VAR
END_PROGRAM
`;
      const doc = makeDoc(src);
      const varLine = findPos(src, 'x : INT');
      const typePos = { line: varLine.line, character: varLine.character + 'x : '.length };
      const result = handleDefinition(makeParams(doc.uri, typePos.line, typePos.character), doc, undefined);
      expect(result).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // FB instance member access (myFb.Method)
  // ---------------------------------------------------------------------------
  describe('FB instance member access', () => {
    const src = `FUNCTION_BLOCK FB_Drive
METHOD Start : BOOL
END_METHOD
PROPERTY Speed : INT
END_PROPERTY
END_FUNCTION_BLOCK

PROGRAM Main
VAR
  drive : FB_Drive;
END_VAR
  drive.Start();
END_PROGRAM
`;

    it('navigates to METHOD when cursor is on the member name', () => {
      const doc = makeDoc(src);
      // cursor on 'Start' in 'drive.Start()'
      const callPos = findPos(src, 'drive.Start');
      const memberPos = { line: callPos.line, character: callPos.character + 'drive.'.length + 1 };
      const result = handleDefinition(makeParams(doc.uri, memberPos.line, memberPos.character), doc, undefined);
      expect(result).not.toBeNull();
      const methodDecl = findPos(src, 'METHOD Start');
      expect(result?.range.start.line).toBe(methodDecl.line);
    });

    it('navigates to PROPERTY when cursor is on property member name', () => {
      const propSrc = `FUNCTION_BLOCK FB_Drive
METHOD Start : BOOL
END_METHOD
PROPERTY Speed : INT
END_PROPERTY
END_FUNCTION_BLOCK

PROGRAM Main
VAR
  drive : FB_Drive;
END_VAR
  drive.Speed := 100;
END_PROGRAM
`;
      const doc = makeDoc(propSrc);
      const callPos = findPos(propSrc, 'drive.Speed');
      const memberPos = { line: callPos.line, character: callPos.character + 'drive.'.length + 1 };
      const result = handleDefinition(makeParams(doc.uri, memberPos.line, memberPos.character), doc, undefined);
      expect(result).not.toBeNull();
      const propDecl = findPos(propSrc, 'PROPERTY Speed');
      expect(result?.range.start.line).toBe(propDecl.line);
    });

    it('returns null when member does not exist on FB', () => {
      const doc = makeDoc(src);
      const callPos = findPos(src, 'drive.Start');
      // Simulate cursor on a nonexistent member by crafting a different source
      const noMethodSrc = `FUNCTION_BLOCK FB_Drive
END_FUNCTION_BLOCK

PROGRAM Main
VAR
  drive : FB_Drive;
END_VAR
  drive.NoSuchMethod();
END_PROGRAM
`;
      const noDoc = makeDoc(noMethodSrc);
      const nPos = findPos(noMethodSrc, 'drive.NoSuchMethod');
      const nMemberPos = { line: nPos.line, character: nPos.character + 'drive.'.length + 1 };
      const result = handleDefinition(makeParams(noDoc.uri, nMemberPos.line, nMemberPos.character), noDoc, undefined);
      expect(result).toBeNull();
    });

    it('returns null when instance variable type is not a known FB', () => {
      const unknownTypeSrc = `PROGRAM Main
VAR
  obj : UnknownFB;
END_VAR
  obj.DoSomething();
END_PROGRAM
`;
      const doc = makeDoc(unknownTypeSrc);
      const nPos = findPos(unknownTypeSrc, 'obj.DoSomething');
      const nMemberPos = { line: nPos.line, character: nPos.character + 'obj.'.length + 1 };
      const result = handleDefinition(makeParams(doc.uri, nMemberPos.line, nMemberPos.character), doc, undefined);
      expect(result).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // EXTENDS / IMPLEMENTS go-to-definition
  // ---------------------------------------------------------------------------
  describe('EXTENDS / IMPLEMENTS go-to-definition', () => {
    it('navigates to FB declaration when cursor is on EXTENDS name', () => {
      const src = [
        'FUNCTION_BLOCK Base',
        'VAR',
        '  x : INT;',
        'END_VAR',
        'END_FUNCTION_BLOCK',
        '',
        'FUNCTION_BLOCK Child EXTENDS Base',
        'VAR',
        'END_VAR',
        'END_FUNCTION_BLOCK',
      ].join('\n');
      const doc = makeDoc(src);
      const extPos = findPos(src, 'EXTENDS Base');
      const pos = { line: extPos.line, character: extPos.character + 'EXTENDS '.length };
      const result = handleDefinition(makeParams(doc.uri, pos.line, pos.character), doc, undefined);
      expect(result).not.toBeNull();
      const declPos = findPos(src, 'FUNCTION_BLOCK Base');
      expect(result?.range.start.line).toBe(declPos.line);
    });

    it('navigates to INTERFACE declaration when cursor is on IMPLEMENTS name', () => {
      const src = [
        'INTERFACE I_Foo',
        'END_INTERFACE',
        '',
        'FUNCTION_BLOCK MyFB IMPLEMENTS I_Foo',
        'VAR',
        'END_VAR',
        'END_FUNCTION_BLOCK',
      ].join('\n');
      const doc = makeDoc(src);
      const implPos = findPos(src, 'IMPLEMENTS I_Foo');
      const pos = { line: implPos.line, character: implPos.character + 'IMPLEMENTS '.length };
      const result = handleDefinition(makeParams(doc.uri, pos.line, pos.character), doc, undefined);
      expect(result).not.toBeNull();
      const declPos = findPos(src, 'INTERFACE I_Foo');
      expect(result?.range.start.line).toBe(declPos.line);
    });

    it('navigates to correct INTERFACE when cursor is on second IMPLEMENTS name', () => {
      const src = [
        'INTERFACE I_Alpha',
        'END_INTERFACE',
        '',
        'INTERFACE I_Beta',
        'END_INTERFACE',
        '',
        'FUNCTION_BLOCK MyFB IMPLEMENTS I_Alpha, I_Beta',
        'VAR',
        'END_VAR',
        'END_FUNCTION_BLOCK',
      ].join('\n');
      const doc = makeDoc(src);
      // Navigate to second implements interface I_Beta
      const implPos = findPos(src, ', I_Beta');
      const pos = { line: implPos.line, character: implPos.character + 2 }; // skip ', '
      const result = handleDefinition(makeParams(doc.uri, pos.line, pos.character), doc, undefined);
      expect(result).not.toBeNull();
      const declPos = findPos(src, 'INTERFACE I_Beta');
      expect(result?.range.start.line).toBe(declPos.line);
    });

    it('navigates to STRUCT when cursor is on STRUCT EXTENDS name', () => {
      const src = [
        'TYPE',
        '  BaseStruct : STRUCT',
        '    x : INT;',
        '  END_STRUCT',
        '',
        '  ChildStruct : STRUCT EXTENDS BaseStruct',
        '    y : INT;',
        '  END_STRUCT',
        'END_TYPE',
      ].join('\n');
      const doc = makeDoc(src);
      const extPos = findPos(src, 'EXTENDS BaseStruct');
      const pos = { line: extPos.line, character: extPos.character + 'EXTENDS '.length };
      const result = handleDefinition(makeParams(doc.uri, pos.line, pos.character), doc, undefined);
      expect(result).not.toBeNull();
      expect(result?.uri).toBe(doc.uri);
      // StructDeclaration range anchored to TYPE block start (line 0)
      expect(result?.range.start.line).toBe(0);
    });

    it('navigates to INTERFACE when cursor is on interface EXTENDS name', () => {
      const src = [
        'INTERFACE I_Base',
        'END_INTERFACE',
        '',
        'INTERFACE I_Child EXTENDS I_Base',
        'END_INTERFACE',
      ].join('\n');
      const doc = makeDoc(src);
      const extPos = findPos(src, 'EXTENDS I_Base');
      const pos = { line: extPos.line, character: extPos.character + 'EXTENDS '.length };
      const result = handleDefinition(makeParams(doc.uri, pos.line, pos.character), doc, undefined);
      expect(result).not.toBeNull();
      const declPos = findPos(src, 'INTERFACE I_Base');
      expect(result?.range.start.line).toBe(declPos.line);
    });

    it('returns null when EXTENDS target is not defined anywhere', () => {
      const src = [
        'FUNCTION_BLOCK Child EXTENDS NonexistentParent',
        'VAR',
        'END_VAR',
        'END_FUNCTION_BLOCK',
      ].join('\n');
      const doc = makeDoc(src);
      const extPos = findPos(src, 'EXTENDS NonexistentParent');
      const pos = { line: extPos.line, character: extPos.character + 'EXTENDS '.length };
      const result = handleDefinition(makeParams(doc.uri, pos.line, pos.character), doc, undefined);
      expect(result).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // Interface instance member access (myIntf.Method / myIntf.Property)
  // ---------------------------------------------------------------------------
  describe('Interface instance member access', () => {
    it('navigates to METHOD when cursor is on the member name of an interface-typed variable', () => {
      const src = `INTERFACE I_Motor
METHOD Start : BOOL
END_METHOD
END_INTERFACE

PROGRAM Main
VAR
  myIntf : I_Motor;
END_VAR
  myIntf.Start();
END_PROGRAM
`;
      const doc = makeDoc(src);
      const callPos = findPos(src, 'myIntf.Start');
      const memberPos = { line: callPos.line, character: callPos.character + 'myIntf.'.length + 1 };
      const result = handleDefinition(makeParams(doc.uri, memberPos.line, memberPos.character), doc, undefined);
      expect(result).not.toBeNull();
      const methodDecl = findPos(src, 'METHOD Start');
      expect(result?.range.start.line).toBe(methodDecl.line);
    });

    it('navigates to PROPERTY when cursor is on the property name of an interface-typed variable', () => {
      const src = `INTERFACE I_Motor
METHOD Start : BOOL
END_METHOD
PROPERTY Value : INT
END_PROPERTY
END_INTERFACE

PROGRAM Main
VAR
  myIntf : I_Motor;
END_VAR
  dummy := myIntf.Value;
END_PROGRAM
`;
      const doc = makeDoc(src);
      const callPos = findPos(src, 'myIntf.Value');
      const memberPos = { line: callPos.line, character: callPos.character + 'myIntf.'.length + 1 };
      const result = handleDefinition(makeParams(doc.uri, memberPos.line, memberPos.character), doc, undefined);
      expect(result).not.toBeNull();
      const propDecl = findPos(src, 'PROPERTY Value');
      expect(result?.range.start.line).toBe(propDecl.line);
    });

    it('navigates to METHOD declared in parent interface via EXTENDS chain', () => {
      const src = `INTERFACE I_Base
METHOD Run : BOOL
END_METHOD
END_INTERFACE

INTERFACE I_Child EXTENDS I_Base
END_INTERFACE

PROGRAM Main
VAR
  myIntf : I_Child;
END_VAR
  myIntf.Run();
END_PROGRAM
`;
      const doc = makeDoc(src);
      const callPos = findPos(src, 'myIntf.Run');
      const memberPos = { line: callPos.line, character: callPos.character + 'myIntf.'.length + 1 };
      const result = handleDefinition(makeParams(doc.uri, memberPos.line, memberPos.character), doc, undefined);
      expect(result).not.toBeNull();
      const methodDecl = findPos(src, 'METHOD Run');
      expect(result?.range.start.line).toBe(methodDecl.line);
    });

    it('returns null when member does not exist on interface', () => {
      const src = `INTERFACE I_Motor
METHOD Start : BOOL
END_METHOD
END_INTERFACE

PROGRAM Main
VAR
  myIntf : I_Motor;
END_VAR
  myIntf.NoSuchMethod();
END_PROGRAM
`;
      const doc = makeDoc(src);
      const callPos = findPos(src, 'myIntf.NoSuchMethod');
      const memberPos = { line: callPos.line, character: callPos.character + 'myIntf.'.length + 1 };
      const result = handleDefinition(makeParams(doc.uri, memberPos.line, memberPos.character), doc, undefined);
      expect(result).toBeNull();
    });
  });
});

describe('TcPOU position mapping', () => {
  // Line numbers in this TcPOU (0-indexed):
  //  0: <?xml version="1.0" encoding="utf-8"?>
  //  1: <TcPlcObject>
  //  2:   <POU Name="FB_DefTest">
  //  3:     <Declaration><![CDATA[
  //  4: FUNCTION_BLOCK FB_DefTest
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
    '  <POU Name="FB_DefTest">',
    '    <Declaration><![CDATA[',
    'FUNCTION_BLOCK FB_DefTest',
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

  it('go-to-def on variable usage at original line 12 finds VarDeclaration at original line 6', () => {
    const doc = makeTcPouDoc(tcpouContent);
    // Line 12 (original): "counter := counter + 1;"
    // "counter" (left-hand side) starts at character 0
    const result = handleDefinition(makeParams(doc.uri, 12, 0), doc, undefined);
    expect(result).not.toBeNull();
    if (result) {
      // The VarDeclaration for `counter` is at original line 6: "  counter : INT;"
      expect(result.range.start.line).toBe(6);
    }
  });

  it('returns null when go-to-def on XML-only line (line 0)', () => {
    const doc = makeTcPouDoc(tcpouContent);
    const result = handleDefinition(makeParams(doc.uri, 0, 5), doc, undefined);
    expect(result).toBeNull();
  });
});

describe('go-to-definition inside method body', () => {
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

  it('go-to-definition of VAR_INPUT variable inside method body finds its declaration', () => {
    const doc = makeDoc(src);
    // Line 8: "  counter := counter + amount;"
    // "amount" starts at character 23
    const result = handleDefinition(makeParams(doc.uri, 8, 23), doc, undefined);
    expect(result).not.toBeNull();
    if (result) {
      // amount is declared on line 6: "  amount : INT;"
      expect(result.range.start.line).toBe(6);
    }
  });

  it('go-to-definition of FB-level variable used inside method body finds its declaration', () => {
    const doc = makeDoc(src);
    // Line 8: "  counter := counter + amount;"
    // first "counter" starts at character 2
    const result = handleDefinition(makeParams(doc.uri, 8, 2), doc, undefined);
    expect(result).not.toBeNull();
    if (result) {
      // counter is declared on line 2: "  counter : INT := 0;"
      expect(result.range.start.line).toBe(2);
    }
  });
});
