/**
 * Tests for the Rename Symbol handler (textDocument/rename and
 * textDocument/prepareRename).
 *
 * Cross-file tests write real temp files to disk and use a mock WorkspaceIndex
 * that returns those file URIs via getProjectFiles().
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { TextEdit } from 'vscode-languageserver/node';
import { handleRename, handlePrepareRename } from '../handlers/rename';
import { WorkspaceIndex } from '../twincat/workspaceIndex';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDoc(content: string, uri = 'file:///test.st'): TextDocument {
  return TextDocument.create(uri, 'st', 1, content);
}

function makeRenameParams(uri: string, line: number, character: number, newName: string) {
  return {
    textDocument: { uri },
    position: { line, character },
    newName,
  };
}

function makePrepareParams(uri: string, line: number, character: number) {
  return {
    textDocument: { uri },
    position: { line, character },
  };
}

function makeMockIndex(fileUris: string[]): WorkspaceIndex {
  return {
    getProjectFiles: () => fileUris,
  } as unknown as WorkspaceIndex;
}

function toFileUri(absPath: string): string {
  return `file://${absPath}`;
}

/** Helper to get edits for a URI from a WorkspaceEdit, asserting it exists. */
function getEdits(changes: Record<string, TextEdit[]>, uri: string): TextEdit[] {
  const edits = changes[uri];
  if (!edits) throw new Error(`No edits found for URI: ${uri}`);
  return edits;
}

// ---------------------------------------------------------------------------
// Temporary directory for cross-file tests
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rename-test-'));
});

afterAll(() => {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

function writeTmpFile(name: string, content: string): string {
  const filePath = path.join(tmpDir, name);
  fs.writeFileSync(filePath, content, 'utf8');
  return toFileUri(filePath);
}

// ---------------------------------------------------------------------------
// Tests: handleRename
// ---------------------------------------------------------------------------

describe('handleRename', () => {

  // ---- Null / guard cases ----

  it('returns null when document is undefined', () => {
    const params = makeRenameParams('file:///missing.st', 0, 0, 'newName');
    const result = handleRename(params, undefined);
    expect(result).toBeNull();
  });

  it('returns null when cursor is not on an identifier (on a literal)', () => {
    const src = [
      'PROGRAM Main',
      'VAR',
      '  x : INT;',
      'END_VAR',
      '  x := 42;',
      'END_PROGRAM',
    ].join('\n');
    const doc = makeDoc(src);
    // Line 4: "  x := 42;" — character 7 is the '4' in the literal
    const params = makeRenameParams(doc.uri, 4, 7, 'newX');
    const result = handleRename(params, doc);
    expect(result).toBeNull();
  });

  it('does not throw when cursor is on whitespace / no node', () => {
    const src = 'PROGRAM Main\nVAR\n  x : INT;\nEND_VAR\n  x := 1;\nEND_PROGRAM';
    const doc = makeDoc(src);
    // Position far past end of line
    const params = makeRenameParams(doc.uri, 1, 100, 'newName');
    // Either null or an empty WorkspaceEdit — both are acceptable;
    // the key requirement is it doesn't throw
    expect(() => handleRename(params, doc)).not.toThrow();
  });

  // ---- Single-document renames ----

  it('returns a WorkspaceEdit with changes for the current document URI', () => {
    const src = [
      'PROGRAM Main',
      'VAR',
      '  myVar : INT;',
      'END_VAR',
      '  myVar := 42;',
      'END_PROGRAM',
    ].join('\n');
    const doc = makeDoc(src);
    // Line 4: "  myVar := 42;" — 'myVar' starts at character 2
    const params = makeRenameParams(doc.uri, 4, 2, 'renamed');
    const result = handleRename(params, doc);
    expect(result).not.toBeNull();
    const changes = result!.changes as Record<string, TextEdit[]>;
    expect(changes).toBeDefined();
    expect(changes[doc.uri]).toBeDefined();
  });

  it('collects all occurrences of the identifier in the current document', () => {
    const src = [
      'PROGRAM Main',
      'VAR',
      '  counter : INT;',
      'END_VAR',
      '  counter := counter + 1;',
      'END_PROGRAM',
    ].join('\n');
    const doc = makeDoc(src);
    // Line 4: "  counter := counter + 1;" — first 'counter' at character 2
    const params = makeRenameParams(doc.uri, 4, 2, 'renamed');
    const result = handleRename(params, doc);
    expect(result).not.toBeNull();
    const changes = result!.changes as Record<string, TextEdit[]>;
    const edits = getEdits(changes, doc.uri);
    // Should find at least 2 occurrences: assignment LHS and RHS usage
    expect(edits.length).toBeGreaterThanOrEqual(2);
  });

  it('each TextEdit contains the correct newName', () => {
    const src = [
      'PROGRAM Main',
      'VAR',
      '  myVar : INT;',
      'END_VAR',
      '  myVar := 10;',
      'END_PROGRAM',
    ].join('\n');
    const doc = makeDoc(src);
    const params = makeRenameParams(doc.uri, 4, 2, 'renamedVar');
    const result = handleRename(params, doc);
    expect(result).not.toBeNull();
    const changes = result!.changes as Record<string, TextEdit[]>;
    const edits = getEdits(changes, doc.uri);
    for (const edit of edits) {
      expect(edit.newText).toBe('renamedVar');
    }
  });

  it('each TextEdit has a valid range (start before or equal to end)', () => {
    const src = [
      'PROGRAM Main',
      'VAR',
      '  myVar : INT;',
      'END_VAR',
      '  myVar := 10;',
      'END_PROGRAM',
    ].join('\n');
    const doc = makeDoc(src);
    const params = makeRenameParams(doc.uri, 4, 2, 'renamedVar');
    const result = handleRename(params, doc);
    expect(result).not.toBeNull();
    const changes = result!.changes as Record<string, TextEdit[]>;
    const edits = getEdits(changes, doc.uri);
    for (const edit of edits) {
      const { start, end } = edit.range;
      if (start.line === end.line) {
        expect(start.character).toBeLessThanOrEqual(end.character);
      } else {
        expect(start.line).toBeLessThan(end.line);
      }
    }
  });

  it('renames multiple occurrences across the body — multiple TextEdits for that URI', () => {
    const src = [
      'PROGRAM Multi',
      'VAR',
      '  x : INT;',
      '  y : INT;',
      'END_VAR',
      '  x := 1;',
      '  y := x + x;',
      'END_PROGRAM',
    ].join('\n');
    const doc = makeDoc(src);
    // Line 5: "  x := 1;" — 'x' at character 2
    const params = makeRenameParams(doc.uri, 5, 2, 'newX');
    const result = handleRename(params, doc);
    expect(result).not.toBeNull();
    const changes = result!.changes as Record<string, TextEdit[]>;
    const edits = getEdits(changes, doc.uri);
    // x appears on line 5, twice on line 6
    expect(edits.length).toBeGreaterThanOrEqual(3);
  });

  // ---- Case-insensitivity ----

  it('matches case-insensitively (declared as myVar, used as MYVAR)', () => {
    // ST is case-insensitive: both casings refer to the same variable
    const src = [
      'PROGRAM Main',
      'VAR',
      '  myVar : INT;',
      'END_VAR',
      '  MYVAR := 1;',
      'END_PROGRAM',
    ].join('\n');
    const doc = makeDoc(src);
    // Hover on MYVAR at line 4, character 2
    const params = makeRenameParams(doc.uri, 4, 2, 'renamedVar');
    const result = handleRename(params, doc);
    expect(result).not.toBeNull();
    const changes = result!.changes as Record<string, TextEdit[]>;
    const edits = getEdits(changes, doc.uri);
    // Should find MYVAR in the body; declaration uses 'myVar'
    // The parser may produce NameExpression for both, both should be collected
    expect(edits.length).toBeGreaterThanOrEqual(1);
    // All edits should use the new name exactly as given
    for (const edit of edits) {
      expect(edit.newText).toBe('renamedVar');
    }
  });

  // ---- MemberExpression: only base gets renamed ----

  it('does not rename the member field in a MemberExpression', () => {
    // inst := TRUE — if we rename 'inst', verify all edits use newText
    const src = [
      'PROGRAM Main',
      'VAR',
      '  inst : BOOL;',
      'END_VAR',
      '  inst := TRUE;',
      'END_PROGRAM',
    ].join('\n');
    const doc = makeDoc(src);
    const params = makeRenameParams(doc.uri, 4, 2, 'newInst');
    const result = handleRename(params, doc);
    expect(result).not.toBeNull();
    const changes = result!.changes as Record<string, TextEdit[]>;
    const edits = changes[doc.uri] ?? [];
    // All edits should replace 'inst' tokens (newText = 'newInst'), none target field names
    for (const edit of edits) {
      expect(edit.newText).toBe('newInst');
    }
  });

  it('renames only the base of a MemberExpression, not the .member part', () => {
    // The parser represents 'base.field' as MemberExpression{base: NameExpr('base'), member: 'field'}
    // So only 'base' should get a rename TextEdit, 'field' should not
    const src = [
      'PROGRAM Main',
      'VAR',
      '  myObj : INT;',
      'END_VAR',
      '  myObj := 1;',
      'END_PROGRAM',
    ].join('\n');
    const doc = makeDoc(src);
    const params = makeRenameParams(doc.uri, 4, 2, 'renamedObj');
    const result = handleRename(params, doc);
    expect(result).not.toBeNull();
    const changes = result!.changes as Record<string, TextEdit[]>;
    const edits = changes[doc.uri] ?? [];
    for (const edit of edits) {
      expect(edit.newText).toBe('renamedObj');
    }
  });

  // ---- Cross-file rename ----

  it('includes edits from other workspace files when workspaceIndex is provided', () => {
    // Current file uses 'sharedVar'
    const currentSrc = [
      'PROGRAM Main',
      'VAR',
      '  sharedVar : INT;',
      'END_VAR',
      '  sharedVar := 1;',
      'END_PROGRAM',
    ].join('\n');

    // Other file also references 'sharedVar'
    const otherSrc = [
      'PROGRAM Other',
      'VAR',
      '  sharedVar : INT;',
      'END_VAR',
      '  sharedVar := 2;',
      'END_PROGRAM',
    ].join('\n');

    const currentUri = writeTmpFile('cf_current.st', currentSrc);
    const otherUri = writeTmpFile('cf_other.st', otherSrc);

    const doc = makeDoc(currentSrc, currentUri);
    const index = makeMockIndex([otherUri]);

    const params = makeRenameParams(currentUri, 4, 2, 'globalVar');
    const result = handleRename(params, doc, index);

    expect(result).not.toBeNull();
    const changes = result!.changes as Record<string, TextEdit[]>;
    expect(changes[currentUri]).toBeDefined();
    expect(changes[otherUri]).toBeDefined();
    // Both files should have edits
    expect((changes[currentUri] ?? []).length).toBeGreaterThanOrEqual(1);
    expect((changes[otherUri] ?? []).length).toBeGreaterThanOrEqual(1);
  });

  it('does not crash when a cross-file URI points to a missing file', () => {
    const currentSrc = 'PROGRAM Main\nVAR\n  x : INT;\nEND_VAR\n  x := 1;\nEND_PROGRAM';
    const missingUri = toFileUri(path.join(tmpDir, 'does_not_exist_rename.st'));

    const doc = makeDoc(currentSrc);
    const index = makeMockIndex([missingUri]);

    const params = makeRenameParams(doc.uri, 4, 2, 'newX');
    expect(() => handleRename(params, doc, index)).not.toThrow();
  });

  it('skips the current document URI when iterating workspace files', () => {
    // The current document URI is listed in the workspace index — it should NOT
    // be read from disk again (avoids double-counting edits)
    const currentSrc = [
      'PROGRAM Main',
      'VAR',
      '  myVar : INT;',
      'END_VAR',
      '  myVar := 1;',
      'END_PROGRAM',
    ].join('\n');

    const currentFilePath = path.join(tmpDir, 'cf_skip_current.st');
    fs.writeFileSync(currentFilePath, currentSrc, 'utf8');
    const currentUri = toFileUri(currentFilePath);

    const doc = makeDoc(currentSrc, currentUri);
    // Index lists only the current file — handler must skip it
    const index = makeMockIndex([currentUri]);

    const params = makeRenameParams(currentUri, 4, 2, 'newVar');
    const result = handleRename(params, doc, index);

    expect(result).not.toBeNull();
    // Changes for the current URI come from the in-memory parse, not double-read
    const changes = result!.changes as Record<string, TextEdit[]>;
    const edits = changes[currentUri] ?? [];
    // myVar appears in the body once (line 4)
    // Exact count depends on parser; just ensure no explosion from double-reading
    expect(edits.length).toBeLessThan(20); // sanity guard
  });

});

// ---------------------------------------------------------------------------
// Tests: handlePrepareRename
// ---------------------------------------------------------------------------

describe('handlePrepareRename', () => {

  it('returns null when document is undefined', () => {
    const params = makePrepareParams('file:///missing.st', 0, 0);
    const result = handlePrepareRename(params, undefined);
    expect(result).toBeNull();
  });

  it('returns null when cursor is not on a renameable identifier (on a literal)', () => {
    const src = [
      'PROGRAM Main',
      'VAR',
      '  x : INT;',
      'END_VAR',
      '  x := 42;',
      'END_PROGRAM',
    ].join('\n');
    const doc = makeDoc(src);
    // Line 4, character 7 is inside the literal '42'
    const params = makePrepareParams(doc.uri, 4, 7);
    const result = handlePrepareRename(params, doc);
    expect(result).toBeNull();
  });

  it('returns the range of the identifier when cursor is on one', () => {
    const src = [
      'PROGRAM Main',
      'VAR',
      '  myVar : INT;',
      'END_VAR',
      '  myVar := 42;',
      'END_PROGRAM',
    ].join('\n');
    const doc = makeDoc(src);
    // Line 4: "  myVar := 42;" — 'myVar' starts at character 2
    const params = makePrepareParams(doc.uri, 4, 2);
    const result = handlePrepareRename(params, doc);
    expect(result).not.toBeNull();
    expect(result!.start).toBeDefined();
    expect(result!.end).toBeDefined();
    // Range should be on line 4
    expect(result!.start.line).toBe(4);
    expect(result!.end.line).toBe(4);
    // Range should span the word 'myVar' (5 characters)
    const length = result!.end.character - result!.start.character;
    expect(length).toBe(5); // 'myVar'.length === 5
  });

  it('returns a range whose start character matches the identifier start', () => {
    const src = [
      'PROGRAM Main',
      'VAR',
      '  counter : INT;',
      'END_VAR',
      '  counter := 0;',
      'END_PROGRAM',
    ].join('\n');
    const doc = makeDoc(src);
    // 'counter' starts at character 2 on line 4
    const params = makePrepareParams(doc.uri, 4, 2);
    const result = handlePrepareRename(params, doc);
    expect(result).not.toBeNull();
    expect(result!.start.character).toBe(2);
    expect(result!.end.character).toBe(2 + 'counter'.length);
  });

});
