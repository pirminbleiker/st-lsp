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
});
