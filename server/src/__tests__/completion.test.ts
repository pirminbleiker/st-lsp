import { describe, it, expect } from 'vitest';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { handleCompletion } from '../handlers/completion';
import { CompletionItemKind } from 'vscode-languageserver/node';
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

      it('does not return VAR_INPUT IN for TON instance', () => {
        const doc = makeDoc(fbSrc);
        const items = handleCompletion(makeParams(doc.uri, 4, 8), doc);
        const labels = items.map(i => i.label);
        expect(labels).not.toContain('IN');
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

function makeMockIndexWithLibs(libraryRefs: LibraryRef[]): WorkspaceIndex {
  return {
    getProjectFiles: () => [],
    getLibraryRefs: () => libraryRefs,
  } as unknown as WorkspaceIndex;
}

describe('Library-aware FB completion', () => {
  const src = `PROGRAM Main\nVAR\nEND_VAR\nEND_PROGRAM`;

  it('includes Tc2_Standard FBs when Tc2_Standard is referenced', () => {
    const mockIndex = makeMockIndexWithLibs([{ name: 'Tc2_Standard' }]);
    const doc = makeDoc(src);
    const items = handleCompletion(makeParams(doc.uri, 3, 0), doc, mockIndex);
    const labels = items.map(i => i.label);
    expect(labels).toContain('TON');
    expect(labels).toContain('TOF');
  });

  it('includes Tc2_MC2 FBs when Tc2_MC2 is referenced', () => {
    const mockIndex = makeMockIndexWithLibs([{ name: 'Tc2_MC2' }]);
    const doc = makeDoc(src);
    const items = handleCompletion(makeParams(doc.uri, 3, 0), doc, mockIndex);
    const labels = items.map(i => i.label);
    expect(labels).toContain('MC_Power');
  });

  it('does NOT include Tc2_MC2 FBs when only Tc2_Standard is referenced', () => {
    const mockIndex = makeMockIndexWithLibs([{ name: 'Tc2_Standard' }]);
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
