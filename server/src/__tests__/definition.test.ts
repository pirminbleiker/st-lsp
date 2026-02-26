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
});
