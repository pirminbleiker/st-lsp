import { describe, it, expect } from 'vitest';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { handleCompletion } from '../handlers/completion';
import { CompletionItemKind } from 'vscode-languageserver/node';
import { WorkspaceIndex } from '../twincat/workspaceIndex';
import type { LibraryRef } from '../twincat/projectReader';
import type { LibrarySymbol } from '../twincat/libraryZipReader';

function makeDoc(content: string): TextDocument {
  return TextDocument.create('file:///test.st', 'st', 1, content);
}

function makeParams(uri: string, line: number, character: number) {
  return {
    textDocument: { uri },
    position: { line, character },
  };
}

describe('handleCompletion', () => {
  const src = `PROGRAM Main
VAR
  myVar : BOOL;
  counter : INT;
END_VAR
END_PROGRAM`;

  describe('keywords', () => {
    it('completion list includes IF keyword', () => {
      const doc = makeDoc(src);
      const items = handleCompletion(makeParams(doc.uri, 5, 0), doc);
      const labels = items.map(i => i.label);
      expect(labels).toContain('IF');
    });

    it('completion list includes WHILE keyword', () => {
      const doc = makeDoc(src);
      const items = handleCompletion(makeParams(doc.uri, 5, 0), doc);
      const labels = items.map(i => i.label);
      expect(labels).toContain('WHILE');
    });

    it('completion list includes FOR keyword', () => {
      const doc = makeDoc(src);
      const items = handleCompletion(makeParams(doc.uri, 5, 0), doc);
      const labels = items.map(i => i.label);
      expect(labels).toContain('FOR');
    });

    it('keyword items have Keyword kind', () => {
      const doc = makeDoc(src);
      const items = handleCompletion(makeParams(doc.uri, 5, 0), doc);
      const ifItem = items.find(i => i.label === 'IF');
      expect(ifItem).toBeDefined();
      expect(ifItem?.kind).toBe(CompletionItemKind.Keyword);
    });
  });

  describe('built-in types', () => {
    it('completion list includes BOOL type', () => {
      const doc = makeDoc(src);
      const items = handleCompletion(makeParams(doc.uri, 5, 0), doc);
      const labels = items.map(i => i.label);
      expect(labels).toContain('BOOL');
    });

    it('completion list includes INT type', () => {
      const doc = makeDoc(src);
      const items = handleCompletion(makeParams(doc.uri, 5, 0), doc);
      const labels = items.map(i => i.label);
      expect(labels).toContain('INT');
    });

    it('completion list includes REAL type', () => {
      const doc = makeDoc(src);
      const items = handleCompletion(makeParams(doc.uri, 5, 0), doc);
      const labels = items.map(i => i.label);
      expect(labels).toContain('REAL');
    });

    it('type items have TypeParameter kind', () => {
      const doc = makeDoc(src);
      const items = handleCompletion(makeParams(doc.uri, 5, 0), doc);
      const boolItem = items.find(i => i.label === 'BOOL');
      expect(boolItem).toBeDefined();
      expect(boolItem?.kind).toBe(CompletionItemKind.TypeParameter);
    });
  });

  describe('variables from enclosing PROGRAM VAR block', () => {
    it('includes myVar variable declared in VAR block', () => {
      const doc = makeDoc(src);
      // Position inside the PROGRAM body
      const items = handleCompletion(makeParams(doc.uri, 5, 0), doc);
      const labels = items.map(i => i.label);
      expect(labels).toContain('myVar');
    });

    it('includes counter variable declared in VAR block', () => {
      const doc = makeDoc(src);
      const items = handleCompletion(makeParams(doc.uri, 5, 0), doc);
      const labels = items.map(i => i.label);
      expect(labels).toContain('counter');
    });

    it('variable items have Variable kind', () => {
      const doc = makeDoc(src);
      const items = handleCompletion(makeParams(doc.uri, 5, 0), doc);
      const varItem = items.find(i => i.label === 'myVar');
      expect(varItem).toBeDefined();
      expect(varItem?.kind).toBe(CompletionItemKind.Variable);
    });
  });

  describe('undefined document', () => {
    it('returns empty array when document is undefined', () => {
      const params = makeParams('file:///missing.st', 0, 0);
      const result = handleCompletion(params, undefined);
      expect(result).toEqual([]);
    });
  });

  describe('dot-accessor completion', () => {
    describe('standard FB outputs (TON)', () => {
      const fbSrc = `PROGRAM Main
VAR
  myTimer : TON;
END_VAR
myTimer.`;
      // cursor is at end of line 4: character 8 (after the '.')

      it('returns Q output for TON instance', () => {
        const doc = makeDoc(fbSrc);
        const items = handleCompletion(makeParams(doc.uri, 4, 8), doc);
        const labels = items.map(i => i.label);
        expect(labels).toContain('Q');
      });

      it('returns ET output for TON instance', () => {
        const doc = makeDoc(fbSrc);
        const items = handleCompletion(makeParams(doc.uri, 4, 8), doc);
        const labels = items.map(i => i.label);
        expect(labels).toContain('ET');
      });

      it('returns IN input for TON instance', () => {
        const doc = makeDoc(fbSrc);
        const items = handleCompletion(makeParams(doc.uri, 4, 8), doc);
        const labels = items.map(i => i.label);
        expect(labels).toContain('IN');
      });

      it('returns PT input for TON instance', () => {
        const doc = makeDoc(fbSrc);
        const items = handleCompletion(makeParams(doc.uri, 4, 8), doc);
        const labels = items.map(i => i.label);
        expect(labels).toContain('PT');
      });

      it('does not return flat keywords in dot-access context', () => {
        const doc = makeDoc(fbSrc);
        const items = handleCompletion(makeParams(doc.uri, 4, 8), doc);
        const labels = items.map(i => i.label);
        expect(labels).not.toContain('IF');
        expect(labels).not.toContain('WHILE');
      });

      it('output items have Field kind', () => {
        const doc = makeDoc(fbSrc);
        const items = handleCompletion(makeParams(doc.uri, 4, 8), doc);
        const qItem = items.find(i => i.label === 'Q');
        expect(qItem).toBeDefined();
        expect(qItem?.kind).toBe(CompletionItemKind.Field);
      });
    });

    describe('user-defined FUNCTION_BLOCK members', () => {
      const fbSrc = `FUNCTION_BLOCK MyFB
VAR_INPUT
  Enable : BOOL;
END_VAR
VAR_OUTPUT
  Done : BOOL;
  Error : BOOL;
END_VAR
END_FUNCTION_BLOCK

PROGRAM Main
VAR
  myInst : MyFB;
END_VAR
myInst.`;
      // line 14, character 7

      it('returns VAR_OUTPUT Done', () => {
        const doc = makeDoc(fbSrc);
        const items = handleCompletion(makeParams(doc.uri, 14, 7), doc);
        const labels = items.map(i => i.label);
        expect(labels).toContain('Done');
      });

      it('returns VAR_OUTPUT Error', () => {
        const doc = makeDoc(fbSrc);
        const items = handleCompletion(makeParams(doc.uri, 14, 7), doc);
        const labels = items.map(i => i.label);
        expect(labels).toContain('Error');
      });

      it('returns VAR_INPUT Enable on instance access', () => {
        const doc = makeDoc(fbSrc);
        const items = handleCompletion(makeParams(doc.uri, 14, 7), doc);
        const labels = items.map(i => i.label);
        expect(labels).toContain('Enable');
      });
    });

    describe('FUNCTION_BLOCK external visibility — only VAR_INPUT/OUTPUT/IN_OUT', () => {
      const src = `FUNCTION_BLOCK FB_Sensor
VAR_INPUT
  bEnable : BOOL;
END_VAR
VAR_OUTPUT
  bValid : BOOL;
  rValue : REAL;
END_VAR
VAR_IN_OUT
  nBuffer : DWORD;
END_VAR
VAR
  nInternalState : INT;
  bPrivateFlag : BOOL;
END_VAR
VAR_TEMP
  nTemp : INT;
END_VAR
END_FUNCTION_BLOCK

PROGRAM MAIN
VAR
  mySensor : FB_Sensor;
END_VAR
  mySensor.`;
      // line 24, character 11

      it('shows VAR_INPUT bEnable', () => {
        const doc = makeDoc(src);
        const items = handleCompletion(makeParams(doc.uri, 24, 11), doc);
        const labels = items.map(i => i.label);
        expect(labels).toContain('bEnable');
      });

      it('shows VAR_OUTPUT bValid', () => {
        const doc = makeDoc(src);
        const items = handleCompletion(makeParams(doc.uri, 24, 11), doc);
        const labels = items.map(i => i.label);
        expect(labels).toContain('bValid');
      });

      it('shows VAR_OUTPUT rValue', () => {
        const doc = makeDoc(src);
        const items = handleCompletion(makeParams(doc.uri, 24, 11), doc);
        const labels = items.map(i => i.label);
        expect(labels).toContain('rValue');
      });

      it('shows VAR_IN_OUT nBuffer', () => {
        const doc = makeDoc(src);
        const items = handleCompletion(makeParams(doc.uri, 24, 11), doc);
        const labels = items.map(i => i.label);
        expect(labels).toContain('nBuffer');
      });

      it('does NOT show internal VAR nInternalState', () => {
        const doc = makeDoc(src);
        const items = handleCompletion(makeParams(doc.uri, 24, 11), doc);
        const labels = items.map(i => i.label);
        expect(labels).not.toContain('nInternalState');
      });

      it('does NOT show internal VAR bPrivateFlag', () => {
        const doc = makeDoc(src);
        const items = handleCompletion(makeParams(doc.uri, 24, 11), doc);
        const labels = items.map(i => i.label);
        expect(labels).not.toContain('bPrivateFlag');
      });

      it('does NOT show VAR_TEMP nTemp', () => {
        const doc = makeDoc(src);
        const items = handleCompletion(makeParams(doc.uri, 24, 11), doc);
        const labels = items.map(i => i.label);
        expect(labels).not.toContain('nTemp');
      });
    });

    describe('FUNCTION_BLOCK with methods', () => {
      const fbSrc = `FUNCTION_BLOCK MyFB
VAR_OUTPUT
  Status : INT;
END_VAR
METHOD Start : BOOL
END_METHOD
END_FUNCTION_BLOCK

PROGRAM Main
VAR
  myInst : MyFB;
END_VAR
myInst.`;
      // line 12, character 7

      it('returns method Start', () => {
        const doc = makeDoc(fbSrc);
        const items = handleCompletion(makeParams(doc.uri, 12, 7), doc);
        const labels = items.map(i => i.label);
        expect(labels).toContain('Start');
      });

      it('method item has Method kind', () => {
        const doc = makeDoc(fbSrc);
        const items = handleCompletion(makeParams(doc.uri, 12, 7), doc);
        const startItem = items.find(i => i.label === 'Start');
        expect(startItem).toBeDefined();
        expect(startItem?.kind).toBe(CompletionItemKind.Method);
      });
    });

    describe('STRUCT field access', () => {
      const structSrc = `TYPE
  ST_Motor : STRUCT
    bRunning : BOOL;
    rSpeed : REAL;
  END_STRUCT;
END_TYPE

PROGRAM Main
VAR
  myMotor : ST_Motor;
END_VAR
myMotor.`;
      // line 11, character 8

      it('returns field bRunning', () => {
        const doc = makeDoc(structSrc);
        const items = handleCompletion(makeParams(doc.uri, 11, 8), doc);
        const labels = items.map(i => i.label);
        expect(labels).toContain('bRunning');
      });

      it('returns field rSpeed', () => {
        const doc = makeDoc(structSrc);
        const items = handleCompletion(makeParams(doc.uri, 11, 8), doc);
        const labels = items.map(i => i.label);
        expect(labels).toContain('rSpeed');
      });

      it('field items have Field kind', () => {
        const doc = makeDoc(structSrc);
        const items = handleCompletion(makeParams(doc.uri, 11, 8), doc);
        const fieldItem = items.find(i => i.label === 'bRunning');
        expect(fieldItem).toBeDefined();
        expect(fieldItem?.kind).toBe(CompletionItemKind.Field);
      });
    });

    describe('unresolvable dot access', () => {
      it('returns empty list when variable type cannot be resolved', () => {
        const src = `PROGRAM Main
VAR
END_VAR
unknownVar.`;
        const doc = makeDoc(src);
        const items = handleCompletion(makeParams(doc.uri, 3, 11), doc);
        expect(items).toEqual([]);
      });

      it('returns empty list when variable is not in scope', () => {
        const src = `PROGRAM Main
VAR
  x : BOOL;
END_VAR
notDeclared.`;
        const doc = makeDoc(src);
        const items = handleCompletion(makeParams(doc.uri, 4, 12), doc);
        expect(items).toEqual([]);
      });
    });

    describe('flat completion not affected outside dot context', () => {
      it('still returns keywords when cursor is not after a dot', () => {
        const src = `PROGRAM Main\nVAR\n  myTimer : TON;\nEND_VAR\nIF `;
        const doc = makeDoc(src);
        const items = handleCompletion(makeParams(doc.uri, 4, 3), doc);
        const labels = items.map(i => i.label);
        expect(labels).toContain('IF');
        expect(labels).toContain('WHILE');
      });
    });

    describe('UNION field access', () => {
      const unionSrc = `TYPE
  ST_TrafficFields : STRUCT
    bRed : BOOL;
  END_STRUCT
END_TYPE

TYPE
  ST_Traffic : UNION
    nRaw : DWORD;
    stFields : ST_TrafficFields;
    bItems : ARRAY [0..2] OF BOOL;
  END_UNION
END_TYPE

PROGRAM MAIN
VAR
  mySignal : ST_Traffic;
END_VAR
  mySignal.
END_PROGRAM`;
      // cursor at line 18 (0-indexed), character 11 (after 'mySignal.')

      it('returns field nRaw', () => {
        const doc = makeDoc(unionSrc);
        const items = handleCompletion(makeParams(doc.uri, 18, 11), doc);
        const labels = items.map(i => i.label);
        expect(labels).toContain('nRaw');
      });

      it('returns field stFields', () => {
        const doc = makeDoc(unionSrc);
        const items = handleCompletion(makeParams(doc.uri, 18, 11), doc);
        const labels = items.map(i => i.label);
        expect(labels).toContain('stFields');
      });

      it('field items have Field kind', () => {
        const doc = makeDoc(unionSrc);
        const items = handleCompletion(makeParams(doc.uri, 18, 11), doc);
        const nRawItem = items.find(i => i.label === 'nRaw');
        expect(nRawItem).toBeDefined();
        expect(nRawItem?.kind).toBe(CompletionItemKind.Field);
      });
    });

    describe('PROGRAM instance member access', () => {
      const progSrc = `PROGRAM Actuator
VAR_OUTPUT
  bReady : BOOL;
  nStatus : INT;
END_VAR
VAR_IN_OUT
  nInOut : DWORD;
END_VAR
VAR
  nPrivate : INT;
END_VAR
  ;
END_PROGRAM

PROGRAM MAIN
VAR
  myActuator : Actuator;
END_VAR
  myActuator.
END_PROGRAM`;
      // cursor at line 18 (0-indexed), character 13 (after '  myActuator.')

      it('returns VAR_OUTPUT bReady', () => {
        const doc = makeDoc(progSrc);
        const items = handleCompletion(makeParams(doc.uri, 18, 13), doc);
        const labels = items.map(i => i.label);
        expect(labels).toContain('bReady');
      });

      it('returns VAR_OUTPUT nStatus', () => {
        const doc = makeDoc(progSrc);
        const items = handleCompletion(makeParams(doc.uri, 18, 13), doc);
        const labels = items.map(i => i.label);
        expect(labels).toContain('nStatus');
      });

      it('returns VAR_IN_OUT nInOut', () => {
        const doc = makeDoc(progSrc);
        const items = handleCompletion(makeParams(doc.uri, 18, 13), doc);
        const labels = items.map(i => i.label);
        expect(labels).toContain('nInOut');
      });

      it('does not return internal VAR nPrivate', () => {
        const doc = makeDoc(progSrc);
        const items = handleCompletion(makeParams(doc.uri, 18, 13), doc);
        const labels = items.map(i => i.label);
        expect(labels).not.toContain('nPrivate');
      });

      it('output items have Field kind', () => {
        const doc = makeDoc(progSrc);
        const items = handleCompletion(makeParams(doc.uri, 18, 13), doc);
        const bReadyItem = items.find(i => i.label === 'bReady');
        expect(bReadyItem).toBeDefined();
        expect(bReadyItem?.kind).toBe(CompletionItemKind.Field);
      });
    });

    describe('pointer dereference dot-completion', () => {
      const ptrSrc = `FUNCTION_BLOCK FB_Motor
VAR_OUTPUT
  bRunning : BOOL;
  nSpeed : INT;
END_VAR
END_FUNCTION_BLOCK

PROGRAM MAIN
VAR
  myMotorPtr : POINTER TO FB_Motor;
END_VAR
  myMotorPtr^.
END_PROGRAM`;
      // cursor at line 11, character 14 (after '  myMotorPtr^.')

      it('returns VAR_OUTPUT bRunning via pointer dereference', () => {
        const doc = makeDoc(ptrSrc);
        const items = handleCompletion(makeParams(doc.uri, 11, 14), doc);
        const labels = items.map(i => i.label);
        expect(labels).toContain('bRunning');
      });

      it('returns VAR_OUTPUT nSpeed via pointer dereference', () => {
        const doc = makeDoc(ptrSrc);
        const items = handleCompletion(makeParams(doc.uri, 11, 14), doc);
        const labels = items.map(i => i.label);
        expect(labels).toContain('nSpeed');
      });

      it('does not return flat keywords for pointer dot-access', () => {
        const doc = makeDoc(ptrSrc);
        const items = handleCompletion(makeParams(doc.uri, 11, 14), doc);
        const labels = items.map(i => i.label);
        expect(labels).not.toContain('IF');
      });
    });

    describe('THIS dot-completion inside FB', () => {
      const thisPtrSrc = `FUNCTION_BLOCK FB_Test
VAR_OUTPUT
  bDone : BOOL;
END_VAR
VAR
  nInternal : INT;
END_VAR
METHOD Execute : BOOL
END_METHOD
PROPERTY MyProp : INT
END_PROPERTY
  THIS^.
END_FUNCTION_BLOCK`;
      // cursor at line 11, character 8 (after '  THIS^.')

      it('returns VAR_OUTPUT bDone on THIS^. trigger', () => {
        const doc = makeDoc(thisPtrSrc);
        const items = handleCompletion(makeParams(doc.uri, 11, 8), doc);
        const labels = items.map(i => i.label);
        expect(labels).toContain('bDone');
      });

      it('returns VAR nInternal on THIS^. trigger (self-access)', () => {
        const doc = makeDoc(thisPtrSrc);
        const items = handleCompletion(makeParams(doc.uri, 11, 8), doc);
        const labels = items.map(i => i.label);
        expect(labels).toContain('nInternal');
      });

      it('returns method Execute on THIS^. trigger', () => {
        const doc = makeDoc(thisPtrSrc);
        const items = handleCompletion(makeParams(doc.uri, 11, 8), doc);
        const labels = items.map(i => i.label);
        expect(labels).toContain('Execute');
      });

      it('returns property MyProp on THIS^. trigger', () => {
        const doc = makeDoc(thisPtrSrc);
        const items = handleCompletion(makeParams(doc.uri, 11, 8), doc);
        const labels = items.map(i => i.label);
        expect(labels).toContain('MyProp');
      });

      it('does not return flat keywords on THIS^. trigger', () => {
        const doc = makeDoc(thisPtrSrc);
        const items = handleCompletion(makeParams(doc.uri, 11, 8), doc);
        const labels = items.map(i => i.label);
        expect(labels).not.toContain('IF');
      });

      const thisDotSrc = `FUNCTION_BLOCK FB_Test
VAR_OUTPUT
  bDone : BOOL;
END_VAR
VAR
  nInternal : INT;
END_VAR
METHOD Execute : BOOL
END_METHOD
PROPERTY MyProp : INT
END_PROPERTY
  THIS.
END_FUNCTION_BLOCK`;
      // cursor at line 11, character 7 (after '  THIS.')

      it('returns VAR_OUTPUT bDone on THIS. trigger', () => {
        const doc = makeDoc(thisDotSrc);
        const items = handleCompletion(makeParams(doc.uri, 11, 7), doc);
        const labels = items.map(i => i.label);
        expect(labels).toContain('bDone');
      });

      it('returns method Execute on THIS. trigger', () => {
        const doc = makeDoc(thisDotSrc);
        const items = handleCompletion(makeParams(doc.uri, 11, 7), doc);
        const labels = items.map(i => i.label);
        expect(labels).toContain('Execute');
      });

      it('returns property MyProp on THIS. trigger', () => {
        const doc = makeDoc(thisDotSrc);
        const items = handleCompletion(makeParams(doc.uri, 11, 7), doc);
        const labels = items.map(i => i.label);
        expect(labels).toContain('MyProp');
      });

      it('does not return flat keywords on THIS. trigger', () => {
        const doc = makeDoc(thisDotSrc);
        const items = handleCompletion(makeParams(doc.uri, 11, 7), doc);
        const labels = items.map(i => i.label);
        expect(labels).not.toContain('IF');
      });
    });
  });

  describe('SUPER^. member completion', () => {
    const parentSrc = `FUNCTION_BLOCK FB_Parent
VAR_OUTPUT
  Status : BOOL;
END_VAR
VAR_IN_OUT
  Buffer : INT;
END_VAR
METHOD DoWork : BOOL
END_METHOD
METHOD PRIVATE HideMe : BOOL
END_METHOD
METHOD FINAL SealMe : BOOL
END_METHOD
PROPERTY MyProp : INT
END_PROPERTY
PROPERTY PRIVATE HiddenProp : INT
END_PROPERTY
END_FUNCTION_BLOCK

FUNCTION_BLOCK FB_Child EXTENDS FB_Parent
VAR
  dummy : BOOL;
END_VAR
`;

    it('returns parent VAR_OUTPUT on SUPER^. trigger', () => {
      const src = parentSrc + `  SUPER^.`;
      const doc = makeDoc(src);
      // cursor at end of last line
      const lines = src.split('\n');
      const lastLine = lines.length - 1;
      const items = handleCompletion(makeParams(doc.uri, lastLine, lines[lastLine].length), doc);
      const labels = items.map(i => i.label);
      expect(labels).toContain('Status');
    });

    it('returns parent VAR_IN_OUT on SUPER^. trigger', () => {
      const src = parentSrc + `  SUPER^.`;
      const doc = makeDoc(src);
      const lines = src.split('\n');
      const lastLine = lines.length - 1;
      const items = handleCompletion(makeParams(doc.uri, lastLine, lines[lastLine].length), doc);
      const labels = items.map(i => i.label);
      expect(labels).toContain('Buffer');
    });

    it('returns accessible parent methods on SUPER^. trigger', () => {
      const src = parentSrc + `  SUPER^.`;
      const doc = makeDoc(src);
      const lines = src.split('\n');
      const lastLine = lines.length - 1;
      const items = handleCompletion(makeParams(doc.uri, lastLine, lines[lastLine].length), doc);
      const labels = items.map(i => i.label);
      expect(labels).toContain('DoWork');
    });

    it('excludes PRIVATE methods from SUPER^. completion', () => {
      const src = parentSrc + `  SUPER^.`;
      const doc = makeDoc(src);
      const lines = src.split('\n');
      const lastLine = lines.length - 1;
      const items = handleCompletion(makeParams(doc.uri, lastLine, lines[lastLine].length), doc);
      const labels = items.map(i => i.label);
      expect(labels).not.toContain('HideMe');
    });

    it('excludes FINAL methods from SUPER^. completion', () => {
      const src = parentSrc + `  SUPER^.`;
      const doc = makeDoc(src);
      const lines = src.split('\n');
      const lastLine = lines.length - 1;
      const items = handleCompletion(makeParams(doc.uri, lastLine, lines[lastLine].length), doc);
      const labels = items.map(i => i.label);
      expect(labels).not.toContain('SealMe');
    });

    it('returns accessible parent properties on SUPER^. trigger', () => {
      const src = parentSrc + `  SUPER^.`;
      const doc = makeDoc(src);
      const lines = src.split('\n');
      const lastLine = lines.length - 1;
      const items = handleCompletion(makeParams(doc.uri, lastLine, lines[lastLine].length), doc);
      const labels = items.map(i => i.label);
      expect(labels).toContain('MyProp');
    });

    it('excludes PRIVATE properties from SUPER^. completion', () => {
      const src = parentSrc + `  SUPER^.`;
      const doc = makeDoc(src);
      const lines = src.split('\n');
      const lastLine = lines.length - 1;
      const items = handleCompletion(makeParams(doc.uri, lastLine, lines[lastLine].length), doc);
      const labels = items.map(i => i.label);
      expect(labels).not.toContain('HiddenProp');
    });

    it('returns empty list when not inside an EXTENDS FB', () => {
      const src = `PROGRAM Main\nVAR\nEND_VAR\n  SUPER^.`;
      const doc = makeDoc(src);
      const lines = src.split('\n');
      const lastLine = lines.length - 1;
      const items = handleCompletion(makeParams(doc.uri, lastLine, lines[lastLine].length), doc);
      expect(items).toEqual([]);
    });

    it('handles chained EXTENDS (grandparent members accessible)', () => {
      const src = `FUNCTION_BLOCK FB_Grandparent
METHOD GrandMethod : BOOL
END_METHOD
END_FUNCTION_BLOCK
FUNCTION_BLOCK FB_Middle EXTENDS FB_Grandparent
END_FUNCTION_BLOCK
FUNCTION_BLOCK FB_Child EXTENDS FB_Middle
VAR
  dummy : BOOL;
END_VAR
  SUPER^.`;
      const doc = makeDoc(src);
      const lines = src.split('\n');
      const lastLine = lines.length - 1;
      const items = handleCompletion(makeParams(doc.uri, lastLine, lines[lastLine].length), doc);
      const labels = items.map(i => i.label);
      expect(labels).toContain('GrandMethod');
    });
  });
});

// ---------------------------------------------------------------------------
// Library-aware FB completion
// ---------------------------------------------------------------------------

function makeMockIndexWithLibs(libraryRefs: LibraryRef[], librarySymbols: LibrarySymbol[] = []): WorkspaceIndex {
  return {
    getProjectFiles: () => [],
    getLibraryRefs: () => libraryRefs,
    getLibrarySymbols: () => librarySymbols,
  } as unknown as WorkspaceIndex;
}

describe('Library-aware FB completion', () => {
  const src = `PROGRAM Main\nVAR\nEND_VAR\nEND_PROGRAM`;

  it('includes Tc2_Standard FBs when Tc2_Standard is referenced', () => {
    const mockIndex = makeMockIndexWithLibs(
      [{ name: 'Tc2_Standard' }],
      [
        { name: 'TON', kind: 'functionBlock', namespace: 'Tc2_Standard' },
        { name: 'TOF', kind: 'functionBlock', namespace: 'Tc2_Standard' },
      ],
    );
    const doc = makeDoc(src);
    const items = handleCompletion(makeParams(doc.uri, 3, 0), doc, mockIndex);
    const labels = items.map(i => i.label);
    expect(labels).toContain('TON');
    expect(labels).toContain('TOF');
  });

  it('includes Tc2_MC2 FBs when Tc2_MC2 is referenced', () => {
    const mockIndex = makeMockIndexWithLibs(
      [{ name: 'Tc2_MC2' }],
      [{ name: 'MC_Power', kind: 'functionBlock', namespace: 'Tc2_MC2' }],
    );
    const doc = makeDoc(src);
    const items = handleCompletion(makeParams(doc.uri, 3, 0), doc, mockIndex);
    const labels = items.map(i => i.label);
    expect(labels).toContain('MC_Power');
  });

  it('does NOT include Tc2_MC2 FBs when only Tc2_Standard is referenced', () => {
    const mockIndex = makeMockIndexWithLibs(
      [{ name: 'Tc2_Standard' }],
      [
        { name: 'TON', kind: 'functionBlock', namespace: 'Tc2_Standard' },
        { name: 'TOF', kind: 'functionBlock', namespace: 'Tc2_Standard' },
      ],
    );
    const doc = makeDoc(src);
    const items = handleCompletion(makeParams(doc.uri, 3, 0), doc, mockIndex);
    const labels = items.map(i => i.label);
    expect(labels).not.toContain('MC_Power');
  });

  it('falls back to all stdlib when no library refs (standalone file)', () => {
    const mockIndex = makeMockIndexWithLibs([]);
    const doc = makeDoc(src);
    const items = handleCompletion(makeParams(doc.uri, 3, 0), doc, mockIndex);
    const labels = items.map(i => i.label);
    // All Tc2_Standard FBs should be present
    expect(labels).toContain('TON');
  });

  it('falls back to all stdlib when no workspaceIndex', () => {
    const doc = makeDoc(src);
    const items = handleCompletion(makeParams(doc.uri, 3, 0), doc);
    const labels = items.map(i => i.label);
    expect(labels).toContain('TON');
  });

  it('FB detail includes namespace when library is referenced', () => {
    const mockIndex = makeMockIndexWithLibs([{ name: 'Tc2_Standard' }]);
    const doc = makeDoc(src);
    const items = handleCompletion(makeParams(doc.uri, 3, 0), doc, mockIndex);
    const tonItem = items.find(i => i.label === 'TON');
    expect(tonItem?.detail).toContain('Tc2_Standard');
  });
});

describe('enum-aware assignment completion', () => {
  const src = `TYPE
  E_Mode : (Auto, Manual, Off);
END_TYPE

PROGRAM Main
VAR
  eMode : E_Mode;
  counter : INT;
END_VAR
eMode :=
END_PROGRAM`;
  // line 9: "eMode := " (cursor at char 9, after ":= ")

  it('returns only enum values on RHS of := for enum-typed variable', () => {
    const doc = makeDoc(src);
    const items = handleCompletion(makeParams(doc.uri, 9, 9), doc);
    const labels = items.map(i => i.label);
    expect(labels).toContain('E_Mode.Auto');
    expect(labels).toContain('E_Mode.Manual');
    expect(labels).toContain('E_Mode.Off');
  });

  it('enum member items have EnumMember kind', () => {
    const doc = makeDoc(src);
    const items = handleCompletion(makeParams(doc.uri, 9, 9), doc);
    const item = items.find(i => i.label === 'E_Mode.Auto');
    expect(item).toBeDefined();
    expect(item?.kind).toBe(CompletionItemKind.EnumMember);
  });

  it('enum member items have correct detail', () => {
    const doc = makeDoc(src);
    const items = handleCompletion(makeParams(doc.uri, 9, 9), doc);
    const item = items.find(i => i.label === 'E_Mode.Auto');
    expect(item?.detail).toBe('E_Mode enum value');
  });

  it('does not return keywords when in enum assignment context', () => {
    const doc = makeDoc(src);
    const items = handleCompletion(makeParams(doc.uri, 9, 9), doc);
    const labels = items.map(i => i.label);
    expect(labels).not.toContain('IF');
    expect(labels).not.toContain('WHILE');
  });

  it('falls through to flat completion for non-enum-typed variable assignment', () => {
    const src2 = `PROGRAM Main\nVAR\n  counter : INT;\nEND_VAR\ncounter := \nEND_PROGRAM`;
    const doc2 = makeDoc(src2);
    const items = handleCompletion(makeParams(doc2.uri, 4, 11), doc2);
    const labels = items.map(i => i.label);
    expect(labels).toContain('IF');
  });
});

describe('CASE selector enum completion', () => {
  const src = `TYPE
  E_Mode : (Auto, Manual, Off);
END_TYPE

PROGRAM Main
VAR
  eMode : E_Mode;
END_VAR
CASE eMode OF

END_CASE
END_PROGRAM`;
  // line 9: "  " (cursor at char 2, blank inside CASE block)

  it('returns enum values when cursor is inside CASE block with enum selector', () => {
    const doc = makeDoc(src);
    const items = handleCompletion(makeParams(doc.uri, 9, 2), doc);
    const labels = items.map(i => i.label);
    expect(labels).toContain('E_Mode.Auto');
    expect(labels).toContain('E_Mode.Manual');
    expect(labels).toContain('E_Mode.Off');
  });

  it('does not return keywords when in CASE enum context', () => {
    const doc = makeDoc(src);
    const items = handleCompletion(makeParams(doc.uri, 9, 2), doc);
    const labels = items.map(i => i.label);
    expect(labels).not.toContain('IF');
  });
});

describe('completion for VAR CONSTANT shows value in detail', () => {
  it('constant var completion includes value in detail', () => {
    const src = [
      'PROGRAM Prog',
      'VAR CONSTANT',
      '  MAX_COUNT : INT := 100;',
      'END_VAR',
      'VAR',
      '  x : INT;',
      'END_VAR',
      'x := M',
      'END_PROGRAM',
    ].join('\n');
    const doc = makeDoc(src);
    // Cursor at end of line 7 (x := M|)
    const items = handleCompletion(makeParams(doc.uri, 7, 6), doc);
    const constItem = items.find(i => i.label === 'MAX_COUNT');
    expect(constItem).toBeDefined();
    if (constItem) {
      expect(constItem.detail).toContain('100');
    }
  });
});

describe('GVL variables in flat completion', () => {
  const gvlFlatSrc = `VAR_GLOBAL
  gCounter : INT;
  gFlag : BOOL;
END_VAR

PROGRAM MAIN
VAR END_VAR
  
END_PROGRAM`;
  // cursor at line 7, char 2 (empty line inside PROGRAM body)

  it('includes GVL variables in flat completion', () => {
    const doc = makeDoc(gvlFlatSrc);
    const items = handleCompletion(makeParams(doc.uri, 7, 2), doc);
    const labels = items.map(i => i.label);
    expect(labels).toContain('gCounter');
    expect(labels).toContain('gFlag');
  });

  it('GVL variables have Variable kind', () => {
    const doc = makeDoc(gvlFlatSrc);
    const items = handleCompletion(makeParams(doc.uri, 7, 2), doc);
    const item = items.find(i => i.label === 'gCounter');
    expect(item).toBeDefined();
    expect(item?.kind).toBe(CompletionItemKind.Variable);
  });
});

describe('completion for enum members shows value in detail', () => {
  it('enum member completion includes value in detail', () => {
    const src = [
      'TYPE',
      '  E_Color : (Red := 0, Green := 1, Blue := 2);',
      'END_TYPE',
      'PROGRAM Prog',
      'VAR',
      '  c : E_Color;',
      'END_VAR',
      'c := E',
      'END_PROGRAM',
    ].join('\n');
    const doc = makeDoc(src);
    // Cursor at end of line 7 (c := E|)
    const items = handleCompletion(makeParams(doc.uri, 7, 6), doc);
    const redItem = items.find(i => i.label === 'E_Color.Red');
    expect(redItem).toBeDefined();
    if (redItem) {
      expect(redItem.detail).toContain('0');
    }
  });
});

describe('INTERFACE in same-file flat completion', () => {
  const ifaceSrc = [
    'INTERFACE I_Device',
    '  METHOD Execute : BOOL',
    '  END_METHOD',
    'END_INTERFACE',
    'PROGRAM Main',
    'VAR',
    '  dev : I_',
    'END_VAR',
    'END_PROGRAM',
  ].join('\n');

  it('includes INTERFACE declared in the same file', () => {
    const doc = makeDoc(ifaceSrc);
    // Cursor on line 6 after "  dev : I_"
    const items = handleCompletion(makeParams(doc.uri, 6, 10), doc);
    const labels = items.map(i => i.label);
    expect(labels).toContain('I_Device');
  });

  it('assigns Interface kind to same-file INTERFACE', () => {
    const doc = makeDoc(ifaceSrc);
    const items = handleCompletion(makeParams(doc.uri, 6, 10), doc);
    const ifaceItem = items.find(i => i.label === 'I_Device');
    expect(ifaceItem).toBeDefined();
    expect(ifaceItem?.kind).toBe(CompletionItemKind.Interface);
  });
});

describe('INTERFACE dot-member completion (same-file)', () => {
  const ifaceDotSrc = [
    'INTERFACE I_Motor',
    '',
    'METHOD Start : BOOL',
    'END_METHOD',
    '',
    'METHOD Stop',
    'END_METHOD',
    '',
    'PROPERTY Speed : INT',
    'END_PROPERTY',
    '',
    'END_INTERFACE',
    '',
    'FUNCTION_BLOCK FB_Test',
    'VAR',
    '  motor : I_Motor;',
    'END_VAR',
    '  motor.',
    'END_FUNCTION_BLOCK',
  ].join('\n');
  // cursor at line 17, character 8 (after '  motor.' — line length is 8)

  it('returns method Start for interface-typed variable', () => {
    const doc = makeDoc(ifaceDotSrc);
    const items = handleCompletion(makeParams(doc.uri, 17, 8), doc);
    const labels = items.map(i => i.label);
    expect(labels).toContain('Start');
  });

  it('returns method Stop for interface-typed variable', () => {
    const doc = makeDoc(ifaceDotSrc);
    const items = handleCompletion(makeParams(doc.uri, 17, 8), doc);
    const labels = items.map(i => i.label);
    expect(labels).toContain('Stop');
  });

  it('returns property Speed for interface-typed variable', () => {
    const doc = makeDoc(ifaceDotSrc);
    const items = handleCompletion(makeParams(doc.uri, 17, 8), doc);
    const labels = items.map(i => i.label);
    expect(labels).toContain('Speed');
  });

  it('method item has Method kind', () => {
    const doc = makeDoc(ifaceDotSrc);
    const items = handleCompletion(makeParams(doc.uri, 17, 8), doc);
    const startItem = items.find(i => i.label === 'Start');
    expect(startItem).toBeDefined();
    expect(startItem?.kind).toBe(CompletionItemKind.Method);
  });

  it('property item has Property kind', () => {
    const doc = makeDoc(ifaceDotSrc);
    const items = handleCompletion(makeParams(doc.uri, 17, 8), doc);
    const speedItem = items.find(i => i.label === 'Speed');
    expect(speedItem).toBeDefined();
    expect(speedItem?.kind).toBe(CompletionItemKind.Property);
  });

  it('does not return flat keywords in interface dot-access context', () => {
    const doc = makeDoc(ifaceDotSrc);
    const items = handleCompletion(makeParams(doc.uri, 17, 8), doc);
    const labels = items.map(i => i.label);
    expect(labels).not.toContain('IF');
    expect(labels).not.toContain('WHILE');
  });
});

describe('INTERFACE EXTENDS chain dot-member completion', () => {
  const extendsDotSrc = [
    'INTERFACE I_Base',
    '',
    'METHOD BaseMethod : BOOL',
    'END_METHOD',
    '',
    'END_INTERFACE',
    '',
    'INTERFACE I_Child EXTENDS I_Base',
    '',
    'METHOD ChildMethod',
    'END_METHOD',
    '',
    'END_INTERFACE',
    '',
    'FUNCTION_BLOCK FB_Test',
    'VAR',
    '  child : I_Child;',
    'END_VAR',
    '  child.',
    'END_FUNCTION_BLOCK',
  ].join('\n');
  // cursor at line 18, character 8 (after '  child.' — line length is 8)

  it('returns ChildMethod from I_Child itself', () => {
    const doc = makeDoc(extendsDotSrc);
    const items = handleCompletion(makeParams(doc.uri, 18, 8), doc);
    const labels = items.map(i => i.label);
    expect(labels).toContain('ChildMethod');
  });

  it('returns BaseMethod inherited via EXTENDS from I_Base', () => {
    const doc = makeDoc(extendsDotSrc);
    const items = handleCompletion(makeParams(doc.uri, 18, 8), doc);
    const labels = items.map(i => i.label);
    expect(labels).toContain('BaseMethod');
  });

  it('does not return flat keywords in EXTENDS-chain dot context', () => {
    const doc = makeDoc(extendsDotSrc);
    const items = handleCompletion(makeParams(doc.uri, 18, 8), doc);
    const labels = items.map(i => i.label);
    expect(labels).not.toContain('IF');
  });
});

describe('Library symbol member dot-completion', () => {
  const fbSrc = `PROGRAM Main
VAR
  myTimer : TON;
END_VAR
myTimer.`;
  // cursor at line 4, character 8 (after '  myTimer.')

  it('returns library FB inputs via dot-access (TON.IN)', () => {
    const doc = makeDoc(fbSrc);
    const items = handleCompletion(makeParams(doc.uri, 4, 8), doc);
    const labels = items.map(i => i.label);
    expect(labels).toContain('IN');
  });

  it('returns library FB inputs via dot-access (TON.PT)', () => {
    const doc = makeDoc(fbSrc);
    const items = handleCompletion(makeParams(doc.uri, 4, 8), doc);
    const labels = items.map(i => i.label);
    expect(labels).toContain('PT');
  });

  it('returns library FB outputs via dot-access (TON.Q)', () => {
    const doc = makeDoc(fbSrc);
    const items = handleCompletion(makeParams(doc.uri, 4, 8), doc);
    const labels = items.map(i => i.label);
    expect(labels).toContain('Q');
  });

  it('returns library FB outputs via dot-access (TON.ET)', () => {
    const doc = makeDoc(fbSrc);
    const items = handleCompletion(makeParams(doc.uri, 4, 8), doc);
    const labels = items.map(i => i.label);
    expect(labels).toContain('ET');
  });

  it('library FB member items have Field kind', () => {
    const doc = makeDoc(fbSrc);
    const items = handleCompletion(makeParams(doc.uri, 4, 8), doc);
    const qItem = items.find(i => i.label === 'Q');
    expect(qItem).toBeDefined();
    expect(qItem?.kind).toBe(CompletionItemKind.Field);
  });

  it('library FB member items include type detail', () => {
    const doc = makeDoc(fbSrc);
    const items = handleCompletion(makeParams(doc.uri, 4, 8), doc);
    const qItem = items.find(i => i.label === 'Q');
    expect(qItem).toBeDefined();
    expect(qItem?.detail).toBe('BOOL');
  });

  it('does not return flat keywords when accessing library FB members', () => {
    const doc = makeDoc(fbSrc);
    const items = handleCompletion(makeParams(doc.uri, 4, 8), doc);
    const labels = items.map(i => i.label);
    expect(labels).not.toContain('IF');
    expect(labels).not.toContain('WHILE');
  });

  it('sorts inputs before outputs by sortText', () => {
    const doc = makeDoc(fbSrc);
    const items = handleCompletion(makeParams(doc.uri, 4, 8), doc);
    const inItem = items.find(i => i.label === 'IN');
    const qItem = items.find(i => i.label === 'Q');
    expect(inItem?.sortText).toBeDefined();
    expect(qItem?.sortText).toBeDefined();
    if (inItem?.sortText && qItem?.sortText) {
      expect(inItem.sortText < qItem.sortText).toBe(true);
    }
  });

  it('completes TIMESTRUCT struct fields after dot', () => {
    const doc = makeDoc(
      'PROGRAM P\nVAR\n  ts : TIMESTRUCT;\nEND_VAR\n  ts.\nEND_PROGRAM',
    );
    const items = handleCompletion(makeParams(doc.uri, 4, 5), doc);
    const labels = items.map(i => i.label);
    expect(labels).toContain('wYear');
    expect(labels).toContain('wMonth');
    expect(labels).toContain('wDay');
    expect(labels).toContain('wHour');
    expect(labels).toContain('wMinute');
    expect(labels).toContain('wSecond');
    expect(labels).toContain('wMilliseconds');
  });

  it('TIMESTRUCT field completion includes type detail', () => {
    const doc = makeDoc(
      'PROGRAM P\nVAR\n  ts : TIMESTRUCT;\nEND_VAR\n  ts.\nEND_PROGRAM',
    );
    const items = handleCompletion(makeParams(doc.uri, 4, 5), doc);
    const wYear = items.find(i => i.label === 'wYear');
    expect(wYear?.detail).toBe('WORD');
  });
});
