/**
 * Tests for the codeLens handler.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { handleCodeLens } from '../handlers/codeLens';
import { WorkspaceIndex } from '../twincat/workspaceIndex';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDoc(content: string, uri = 'file:///current.st'): TextDocument {
  return TextDocument.create(uri, 'st', 1, content);
}

function makeParams(uri = 'file:///current.st') {
  return { textDocument: { uri } };
}

function makeMockIndex(fileUris: string[]): WorkspaceIndex {
  return {
    getProjectFiles: () => fileUris,
    getAst: () => undefined,
  } as unknown as WorkspaceIndex;
}

function toFileUri(absPath: string): string {
  return `file://${absPath}`;
}

// ---------------------------------------------------------------------------
// Temporary directory for real cross-file tests
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codelens-test-'));
});

afterAll(() => {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

// ---------------------------------------------------------------------------
// Single-file tests (no workspace index)
// ---------------------------------------------------------------------------

describe('handleCodeLens — single file', () => {
  it('returns empty array when no workspace index and no other FBs', () => {
    const doc = makeDoc(`
INTERFACE IMotor
END_INTERFACE
`);
    const lenses = handleCodeLens(makeParams(), doc, undefined);
    expect(lenses).toHaveLength(0);
  });

  it('shows 1 implementation when FB implements interface in the same file', () => {
    const doc = makeDoc(`
INTERFACE IMotor
END_INTERFACE

FUNCTION_BLOCK Motor IMPLEMENTS IMotor
END_FUNCTION_BLOCK
`, 'file:///same.st');
    const lenses = handleCodeLens({ textDocument: { uri: 'file:///same.st' } }, doc, undefined);
    const implLens = lenses.find(l => l.command?.title.includes('implementation'));
    expect(implLens).toBeDefined();
    expect(implLens!.command!.title).toBe('1 implementation');
  });

  it('shows 2 implementations for 2 FBs in same file', () => {
    const doc = makeDoc(`
INTERFACE IBase
END_INTERFACE

FUNCTION_BLOCK FB1 IMPLEMENTS IBase
END_FUNCTION_BLOCK

FUNCTION_BLOCK FB2 IMPLEMENTS IBase
END_FUNCTION_BLOCK
`, 'file:///multi.st');
    const lenses = handleCodeLens({ textDocument: { uri: 'file:///multi.st' } }, doc, undefined);
    const implLens = lenses.find(l => l.command?.title.includes('implementations'));
    expect(implLens).toBeDefined();
    expect(implLens!.command!.title).toBe('2 implementations');
  });

  it('shows 1 child when a FB extends another in the same file', () => {
    const doc = makeDoc(`
FUNCTION_BLOCK Base
END_FUNCTION_BLOCK

FUNCTION_BLOCK Child EXTENDS Base
END_FUNCTION_BLOCK
`, 'file:///extends.st');
    const lenses = handleCodeLens({ textDocument: { uri: 'file:///extends.st' } }, doc, undefined);
    const childLens = lenses.find(l => l.command?.title.includes('child'));
    expect(childLens).toBeDefined();
    expect(childLens!.command!.title).toBe('1 child');
  });

  it('shows N children for multiple extending FBs', () => {
    const doc = makeDoc(`
FUNCTION_BLOCK Base
END_FUNCTION_BLOCK

FUNCTION_BLOCK ChildA EXTENDS Base
END_FUNCTION_BLOCK

FUNCTION_BLOCK ChildB EXTENDS Base
END_FUNCTION_BLOCK
`, 'file:///multi_extends.st');
    const lenses = handleCodeLens({ textDocument: { uri: 'file:///multi_extends.st' } }, doc, undefined);
    const childLens = lenses.find(l => l.command?.title.includes('children'));
    expect(childLens).toBeDefined();
    expect(childLens!.command!.title).toBe('2 children');
  });

  it('shows method override lens when child overrides a method', () => {
    const doc = makeDoc(`
FUNCTION_BLOCK Base
  METHOD DoWork
  END_METHOD
END_FUNCTION_BLOCK

FUNCTION_BLOCK Child EXTENDS Base
  METHOD DoWork
  END_METHOD
END_FUNCTION_BLOCK
`, 'file:///methods.st');
    const lenses = handleCodeLens({ textDocument: { uri: 'file:///methods.st' } }, doc, undefined);
    const overrideLens = lenses.find(l => l.command?.title.includes('overridden'));
    expect(overrideLens).toBeDefined();
    expect(overrideLens!.command!.title).toBe('overridden in 1 FB');
  });

  it('does not show a children lens for FB with no children', () => {
    const doc = makeDoc(`
FUNCTION_BLOCK Standalone
END_FUNCTION_BLOCK
`, 'file:///standalone.st');
    const lenses = handleCodeLens({ textDocument: { uri: 'file:///standalone.st' } }, doc, undefined);
    expect(lenses.filter(l => l.command?.title.includes('child'))).toHaveLength(0);
  });

  it('does not show override lens for non-overridden methods', () => {
    const doc = makeDoc(`
FUNCTION_BLOCK Base
  METHOD UniqueMethod
  END_METHOD
END_FUNCTION_BLOCK

FUNCTION_BLOCK Child EXTENDS Base
  METHOD OtherMethod
  END_METHOD
END_FUNCTION_BLOCK
`, 'file:///no_override.st');
    const lenses = handleCodeLens({ textDocument: { uri: 'file:///no_override.st' } }, doc, undefined);
    expect(lenses.filter(l => l.command?.title.includes('overridden'))).toHaveLength(0);
  });

  it('returns empty array for document with no declarations', () => {
    const doc = makeDoc('');
    const lenses = handleCodeLens(makeParams(), doc, undefined);
    expect(lenses).toHaveLength(0);
  });

  it('returns empty array when document is undefined', () => {
    const lenses = handleCodeLens(makeParams(), undefined, undefined);
    expect(lenses).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Cross-file tests (with workspace index writing temp files)
// ---------------------------------------------------------------------------

describe('handleCodeLens — cross-file via WorkspaceIndex', () => {
  it('shows implementations from another file', () => {
    const currentUri = 'file:///cur.st';
    const currentDoc = makeDoc(`
INTERFACE ISensor
END_INTERFACE
`, currentUri);

    // Write implementor in another file
    const otherPath = path.join(tmpDir, 'implementor.st');
    fs.writeFileSync(otherPath, `
FUNCTION_BLOCK TempSensor IMPLEMENTS ISensor
END_FUNCTION_BLOCK
`);
    const otherUri = toFileUri(otherPath);
    const idx = makeMockIndex([currentUri, otherUri]);

    const lenses = handleCodeLens({ textDocument: { uri: currentUri } }, currentDoc, idx);
    const implLens = lenses.find(l => l.command?.title.includes('implementation'));
    expect(implLens).toBeDefined();
    expect(implLens!.command!.title).toBe('1 implementation');
  });

  it('shows children from another file', () => {
    const currentUri = 'file:///base.st';
    const currentDoc = makeDoc(`
FUNCTION_BLOCK BaseCtrl
END_FUNCTION_BLOCK
`, currentUri);

    const otherPath = path.join(tmpDir, 'child.st');
    fs.writeFileSync(otherPath, `
FUNCTION_BLOCK SpecialCtrl EXTENDS BaseCtrl
END_FUNCTION_BLOCK
`);
    const otherUri = toFileUri(otherPath);
    const idx = makeMockIndex([currentUri, otherUri]);

    const lenses = handleCodeLens({ textDocument: { uri: currentUri } }, currentDoc, idx);
    const childLens = lenses.find(l => l.command?.title.includes('child'));
    expect(childLens).toBeDefined();
    expect(childLens!.command!.title).toBe('1 child');
  });

  it('shows method override from a cross-file child', () => {
    const currentUri = 'file:///basefb.st';
    const currentDoc = makeDoc(`
FUNCTION_BLOCK BaseFB
  METHOD Execute
  END_METHOD
END_FUNCTION_BLOCK
`, currentUri);

    const otherPath = path.join(tmpDir, 'childfb.st');
    fs.writeFileSync(otherPath, `
FUNCTION_BLOCK ChildFB EXTENDS BaseFB
  METHOD Execute
  END_METHOD
END_FUNCTION_BLOCK
`);
    const otherUri = toFileUri(otherPath);
    const idx = makeMockIndex([currentUri, otherUri]);

    const lenses = handleCodeLens({ textDocument: { uri: currentUri } }, currentDoc, idx);
    const overrideLens = lenses.find(l => l.command?.title.includes('overridden'));
    expect(overrideLens).toBeDefined();
    expect(overrideLens!.command!.title).toBe('overridden in 1 FB');
  });
});

// ---------------------------------------------------------------------------
// Reference count tests
// ---------------------------------------------------------------------------

describe('handleCodeLens — reference counts', () => {
  it('shows 1 reference for a FUNCTION_BLOCK used once', () => {
    const doc = makeDoc(`
FUNCTION_BLOCK Motor
END_FUNCTION_BLOCK

PROGRAM Main
  VAR
    m : Motor;
  END_VAR
END_PROGRAM
`, 'file:///ref1.st');
    const lenses = handleCodeLens({ textDocument: { uri: 'file:///ref1.st' } }, doc, undefined);
    const refLens = lenses.find(l => l.command?.title.includes('reference'));
    expect(refLens).toBeDefined();
    expect(refLens!.command!.title).toBe('1 reference');
  });

  it('shows N references for a FUNCTION_BLOCK used multiple times', () => {
    const doc = makeDoc(`
FUNCTION_BLOCK Pump
END_FUNCTION_BLOCK

PROGRAM Main
  VAR
    p1 : Pump;
    p2 : Pump;
    p3 : Pump;
  END_VAR
END_PROGRAM
`, 'file:///ref3.st');
    const lenses = handleCodeLens({ textDocument: { uri: 'file:///ref3.st' } }, doc, undefined);
    const refLens = lenses.find(l => l.command?.title.includes('references'));
    expect(refLens).toBeDefined();
    expect(refLens!.command!.title).toBe('3 references');
  });

  it('does not show reference lens when symbol has no usages', () => {
    const doc = makeDoc(`
FUNCTION_BLOCK UnusedFB
END_FUNCTION_BLOCK
`, 'file:///unused.st');
    const lenses = handleCodeLens({ textDocument: { uri: 'file:///unused.st' } }, doc, undefined);
    const refLens = lenses.filter(l => l.command?.title.includes('reference'));
    expect(refLens).toHaveLength(0);
  });

  it('shows reference count for FUNCTION declarations', () => {
    const doc = makeDoc(`
FUNCTION Add : INT
  Add := 2 + 3;
END_FUNCTION

PROGRAM Main
  VAR
    result1 : INT;
    result2 : INT;
  END_VAR
  result1 := Add();
  result2 := Add();
END_PROGRAM
`, 'file:///fn_ref.st');
    const lenses = handleCodeLens({ textDocument: { uri: 'file:///fn_ref.st' } }, doc, undefined);
    const refLens = lenses.find(l => l.command?.title.includes('references'));
    expect(refLens).toBeDefined();
    // Add is in the function body (Add := 2+3) + 2 calls = 3 references
    expect(refLens!.command!.title).toBe('3 references');
  });

  it('does not show reference count for INTERFACE (uses "implementations" instead)', () => {
    const doc = makeDoc(`
INTERFACE ISensor
END_INTERFACE

FUNCTION_BLOCK TempSensor IMPLEMENTS ISensor
END_FUNCTION_BLOCK

FUNCTION_BLOCK PressureSensor IMPLEMENTS ISensor
END_FUNCTION_BLOCK
`, 'file:///iface_ref.st');
    const lenses = handleCodeLens({ textDocument: { uri: 'file:///iface_ref.st' } }, doc, undefined);
    // For INTERFACE, the lens is "implementations", not "references"
    const implLens = lenses.find(l => l.command?.title.includes('implementations'));
    expect(implLens).toBeDefined();
    expect(implLens!.command!.title).toBe('2 implementations');
    // There should not be a separate "references" lens for the interface
    const refLens = lenses.find(l => l.data?.type === 'references' && l.data?.name === 'ISensor');
    expect(refLens).toBeUndefined();
  });

  it('shows reference count for PROGRAM declarations', () => {
    const doc = makeDoc(`
PROGRAM Setup
END_PROGRAM

PROGRAM Worker
  VAR
    s : Setup;
  END_VAR
END_PROGRAM
`, 'file:///prog_ref.st');
    const lenses = handleCodeLens({ textDocument: { uri: 'file:///prog_ref.st' } }, doc, undefined);
    const refLens = lenses.find(l => l.command?.title.includes('reference'));
    expect(refLens).toBeDefined();
    expect(refLens!.command!.title).toBe('1 reference');
  });

  it('shows reference count for TYPE declarations', () => {
    const doc = makeDoc(`
TYPE
  MyInt : INT;
END_TYPE

FUNCTION SetValue
VAR_INPUT
  val : MyInt;
END_VAR
  SetValue := val;
END_FUNCTION
`, 'file:///type_ref.st');
    const lenses = handleCodeLens({ textDocument: { uri: 'file:///type_ref.st' } }, doc, undefined);
    const refLens = lenses.find(l => l.command?.title.includes('reference'));
    expect(refLens).toBeDefined();
    expect(refLens!.command!.title).toBe('1 reference');
  });

  it('excludes the declaration itself from reference count', () => {
    const doc = makeDoc(`
FUNCTION_BLOCK Counter
END_FUNCTION_BLOCK

PROGRAM Main
  VAR
    cnt : Counter;
  END_VAR
  cnt := Counter();
END_PROGRAM
`, 'file:///exclude_decl.st');
    const lenses = handleCodeLens({ textDocument: { uri: 'file:///exclude_decl.st' } }, doc, undefined);
    const refLens = lenses.find(l => l.command?.title.includes('references'));
    // Counter declared once, used in VAR and as function call = 2 references
    expect(refLens).toBeDefined();
    expect(refLens!.command!.title).toBe('2 references');
  });

  it('handles case-insensitive matching for references', () => {
    const doc = makeDoc(`
FUNCTION_BLOCK Motor
END_FUNCTION_BLOCK

PROGRAM Main
  VAR
    m : motor;
    m2 : MOTOR;
  END_VAR
END_PROGRAM
`, 'file:///case_insensitive.st');
    const lenses = handleCodeLens({ textDocument: { uri: 'file:///case_insensitive.st' } }, doc, undefined);
    const refLens = lenses.find(l => l.command?.title.includes('references'));
    expect(refLens).toBeDefined();
    expect(refLens!.command!.title).toBe('2 references');
  });
});
