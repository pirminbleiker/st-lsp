/**
 * Tests for Find All References (textDocument/references) handler.
 *
 * WorkspaceIndex requires real filesystem access, so cross-file tests write
 * temporary source files to disk and use a minimal mock WorkspaceIndex.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { handleReferences } from '../handlers/references';
import { WorkspaceIndex } from '../twincat/workspaceIndex';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDoc(content: string, uri = 'file:///test.st'): TextDocument {
  return TextDocument.create(uri, 'st', 1, content);
}

function makeParams(uri: string, line: number, character: number) {
  return {
    textDocument: { uri },
    position: { line, character },
    context: { includeDeclaration: true },
  };
}

/**
 * Create a minimal WorkspaceIndex-shaped mock.
 * Only getProjectFiles() is used by handleReferences.
 */
function makeMockIndex(fileUris: string[]): WorkspaceIndex {
  return {
    getProjectFiles: () => fileUris,
  } as unknown as WorkspaceIndex;
}

/** Convert an absolute path to a file:// URI (POSIX style). */
function toFileUri(absPath: string): string {
  return `file://${absPath}`;
}

// ---------------------------------------------------------------------------
// Temporary directory for cross-file tests
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'references-test-'));
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
// Tests
// ---------------------------------------------------------------------------

describe('handleReferences', () => {

  // ── Basic / guard tests ─────────────────────────────────────────────────

  it('returns empty array when document is undefined', () => {
    const params = makeParams('file:///missing.st', 0, 0);
    const result = handleReferences(params, undefined);
    expect(result).toEqual([]);
  });

  it('returns empty array when cursor is not on an identifier', () => {
    const src = `PROGRAM Main
VAR
  x : INT;
END_VAR
  x := 1;
END_PROGRAM`;
    const doc = makeDoc(src);
    // Position on the ':=' operator tokens - not a NameExpression
    // Line 4 col 4 is the space before :=
    const params = makeParams(doc.uri, 4, 9);
    const result = handleReferences(params, doc);
    expect(result).toEqual([]);
  });

  it('returns empty array when cursor is on a numeric literal', () => {
    const src = `PROGRAM Main
VAR
  x : INT;
END_VAR
  x := 42;
END_PROGRAM`;
    const doc = makeDoc(src);
    // Position on '42' literal (line 4, col 7)
    const params = makeParams(doc.uri, 4, 7);
    const result = handleReferences(params, doc);
    expect(result).toEqual([]);
  });

  // ── Single-file occurrence tests ────────────────────────────────────────

  it('finds all occurrences of a variable used in a PROGRAM body', () => {
    const src = `PROGRAM Main
VAR
  counter : INT;
END_VAR
  counter := counter + 1;
  counter := 0;
END_PROGRAM`;
    const doc = makeDoc(src);
    // Position on 'counter' in the body on line 4 (NameExpression on lhs of assignment)
    const params = makeParams(doc.uri, 4, 3);
    const result = handleReferences(params, doc);

    // Should find: VAR declaration (line 2), 2 usages on line 4, 1 usage on line 5 = 4 total
    expect(result.length).toBe(4);
    const uris = result.map(l => l.uri);
    expect(uris.every(u => u === doc.uri)).toBe(true);
  });

  it('finds the declaration AND usages with case-insensitive matching', () => {
    const src = `PROGRAM Main
VAR
  MyVar : BOOL;
END_VAR
  MYVAR := TRUE;
  myvar := FALSE;
END_PROGRAM`;
    const doc = makeDoc(src);
    // Position on 'MyVar' in VAR block (line 2, col 2)
    const params = makeParams(doc.uri, 2, 2);
    const result = handleReferences(params, doc);

    // Declaration on line 2 + usage on line 4 + usage on line 5 = 3 total
    expect(result.length).toBe(3);
  });

  it('finds references in an IF body', () => {
    const src = `PROGRAM Main
VAR
  flag : BOOL;
END_VAR
  IF flag THEN
    flag := FALSE;
  END_IF;
END_PROGRAM`;
    const doc = makeDoc(src);
    // Position on 'flag' in the IF condition (line 4, col 5)
    const params = makeParams(doc.uri, 4, 5);
    const result = handleReferences(params, doc);

    // VAR decl (line 2) + IF condition NameExpression (line 4) + assignment in body (line 5) = 3
    expect(result.length).toBe(3);
  });

  it('finds references in a FOR loop body', () => {
    const src = `PROGRAM Main
VAR
  i : INT;
  total : INT;
END_VAR
  FOR i := 0 TO 10 DO
    total := total + i;
  END_FOR;
END_PROGRAM`;
    const doc = makeDoc(src);
    // Position on 'i' in the VAR block (line 2, col 2) — cursor on VarDeclaration
    const params = makeParams(doc.uri, 2, 2);
    const result = handleReferences(params, doc);

    // VAR decl (line 2) + FOR variable pseudo-location (line 5) + usage in body (line 6) = 3
    expect(result.length).toBe(3);
    const uris = result.map(l => l.uri);
    expect(uris.every(u => u === doc.uri)).toBe(true);
  });

  it('finds references in a WHILE body', () => {
    const src = `PROGRAM Main
VAR
  running : BOOL;
END_VAR
  WHILE running DO
    running := FALSE;
  END_WHILE;
END_PROGRAM`;
    const doc = makeDoc(src);
    // Position on 'running' in WHILE condition (line 4, col 8)
    const params = makeParams(doc.uri, 4, 8);
    const result = handleReferences(params, doc);

    // VAR decl (line 2) + WHILE condition NameExpression (line 4) + body assignment (line 5) = 3
    expect(result.length).toBe(3);
  });

  it('returns multiple locations when identifier appears N times', () => {
    const src = `PROGRAM Main
VAR
  val : INT;
END_VAR
  val := 1;
  val := val + 2;
  val := val * val;
END_PROGRAM`;
    const doc = makeDoc(src);
    // Position on 'val' on line 4 (NameExpression in assignment lhs)
    const params = makeParams(doc.uri, 4, 2);
    const result = handleReferences(params, doc);

    // VAR decl (line 2) + line 4 lhs + line 5 lhs + line 5 rhs + line 6 lhs + line 6 rhs * 2 = 7
    expect(result.length).toBe(7);
  });

  it('does NOT return locations from unrelated identifiers', () => {
    const src = `PROGRAM Main
VAR
  alpha : INT;
  beta : INT;
END_VAR
  alpha := 1;
  beta := 2;
END_PROGRAM`;
    const doc = makeDoc(src);
    // Position on 'alpha' in VAR block (line 2, col 2)
    const params = makeParams(doc.uri, 2, 2);
    const result = handleReferences(params, doc);

    // alpha: VAR decl (line 2) + assignment (line 5) = 2 locations
    expect(result.length).toBe(2);
    // None should be on line 3 (beta decl) or line 6 (beta assignment)
    const lines = result.map(l => l.range.start.line);
    expect(lines).not.toContain(3); // beta decl line
    expect(lines).not.toContain(6); // beta usage line
  });

  it('works correctly when the target appears in both VAR block and body', () => {
    const src = `PROGRAM Main
VAR
  speed : INT;
END_VAR
  speed := 100;
  IF speed > 50 THEN
    speed := 50;
  END_IF;
END_PROGRAM`;
    const doc = makeDoc(src);
    // Position on 'speed' in VAR block (line 2, col 2)
    const params = makeParams(doc.uri, 2, 2);
    const result = handleReferences(params, doc);

    // VAR decl (line 2) + assignment lhs (line 4) + IF condition (line 5) + IF body assignment (line 6) = 4
    expect(result.length).toBe(4);
    const uris = result.map(l => l.uri);
    expect(uris.every(u => u === doc.uri)).toBe(true);
  });

  it('finds usages of a function block type name in expressions', () => {
    const src = `PROGRAM Main
VAR
  myVal : INT;
END_VAR
  myVal := myVal + myVal;
END_PROGRAM`;
    const doc = makeDoc(src);
    // Position on 'myVal' in body (line 4, col 2)
    const params = makeParams(doc.uri, 4, 2);
    const result = handleReferences(params, doc);

    // VAR decl (line 2) + 3 body usages (line 4 lhs, rhs1, rhs2) = 4
    expect(result.length).toBe(4);
  });

  // ── Cross-file tests ─────────────────────────────────────────────────────

  it('finds references in another workspace file', () => {
    const otherSrc = `PROGRAM Other
VAR
  sharedVar : INT;
END_VAR
  sharedVar := 42;
END_PROGRAM`;
    const otherUri = writeTmpFile('refs_other1.st', otherSrc);

    const currentSrc = `PROGRAM Main
VAR
  sharedVar : INT;
END_VAR
  sharedVar := 1;
END_PROGRAM`;
    const currentUri = writeTmpFile('refs_current1.st', currentSrc);
    const doc = makeDoc(currentSrc, currentUri);
    const index = makeMockIndex([otherUri]);

    // Position on 'sharedVar' in current file VAR block (line 2, col 2)
    const params = makeParams(doc.uri, 2, 2);
    const result = handleReferences(params, doc, index);

    // Current file: VAR decl (line 2) + usage (line 4) = 2
    // Other file: VAR decl (line 2) + usage (line 4) = 2
    // Total = 4
    expect(result.length).toBe(4);

    const currentFileResults = result.filter(l => l.uri === currentUri);
    const otherFileResults = result.filter(l => l.uri === otherUri);
    expect(currentFileResults.length).toBe(2);
    expect(otherFileResults.length).toBe(2);
  });

  it('does not crash when a project file URI points to a missing file', () => {
    const missingUri = toFileUri(path.join(tmpDir, 'does_not_exist_refs.st'));

    const currentSrc = `PROGRAM Main
VAR
  x : INT;
END_VAR
  x := 1;
END_PROGRAM`;
    const currentUri = writeTmpFile('refs_graceful.st', currentSrc);
    const doc = makeDoc(currentSrc, currentUri);
    const index = makeMockIndex([missingUri]);

    const params = makeParams(doc.uri, 2, 2);
    // Should not throw
    expect(() => handleReferences(params, doc, index)).not.toThrow();
  });

  it('still returns current file results when a project file cannot be read', () => {
    const missingUri = toFileUri(path.join(tmpDir, 'also_missing_refs.st'));

    const currentSrc = `PROGRAM Main
VAR
  x : INT;
END_VAR
  x := 1;
END_PROGRAM`;
    const currentUri = writeTmpFile('refs_graceful2.st', currentSrc);
    const doc = makeDoc(currentSrc, currentUri);
    const index = makeMockIndex([missingUri]);

    const params = makeParams(doc.uri, 2, 2);
    const result = handleReferences(params, doc, index);

    // Should still find x in current file: VAR decl (line 2) + usage (line 4) = 2
    expect(result.length).toBe(2);
    expect(result.every(l => l.uri === currentUri)).toBe(true);
  });

  // ── TypeRef (type annotation) tests ─────────────────────────────────────

  it('finds all usages of a type name when cursor is on a type annotation', () => {
    const src = `FUNCTION_BLOCK Main
VAR
  timer1 : TON;
  timer2 : TON;
  counter : CTU;
END_VAR
END_FUNCTION_BLOCK`;
    const doc = makeDoc(src);
    // Position on 'TON' in the first var declaration type annotation (line 2, col 11)
    const params = makeParams(doc.uri, 2, 11);
    const result = handleReferences(params, doc);

    // timer1 type (line 2) + timer2 type (line 3) = 2, NOT CTU on line 4
    expect(result.length).toBe(2);
    const lines = result.map(l => l.range.start.line);
    expect(lines).toContain(2);
    expect(lines).toContain(3);
    expect(lines).not.toContain(4);
  });

  it('finds type annotation usages across a struct declaration', () => {
    const src = `TYPE
  MyStruct : STRUCT
    a : REAL;
    b : REAL;
    c : INT;
  END_STRUCT;
END_TYPE`;
    const doc = makeDoc(src);
    // Position on 'REAL' in field a (line 2, col 8)
    const params = makeParams(doc.uri, 2, 8);
    const result = handleReferences(params, doc);

    // field a type (line 2) + field b type (line 3) = 2, NOT INT on line 4
    expect(result.length).toBe(2);
    const lines = result.map(l => l.range.start.line);
    expect(lines).toContain(2);
    expect(lines).toContain(3);
    expect(lines).not.toContain(4);
  });

  // ── Composite TypeRef nameRange tests ────────────────────────────────────

  it('reference range for POINTER TO type covers only the type name, not POINTER TO prefix', () => {
    const src = `PROGRAM Main
VAR
  p1 : POINTER TO MyFB;
  p2 : POINTER TO MyFB;
END_VAR
END_PROGRAM`;
    const doc = makeDoc(src);
    // Position on 'MyFB' in line 2 (col 18 = after 'POINTER TO ')
    const params = makeParams(doc.uri, 2, 18);
    const result = handleReferences(params, doc);

    // Both type annotations on lines 2 and 3 should match MyFB
    expect(result.length).toBe(2);
    for (const loc of result) {
      // The range should cover only 'MyFB' (4 chars), not 'POINTER TO MyFB' (15 chars)
      expect(loc.range.end.character - loc.range.start.character).toBe(4);
    }
  });

  it('reference range for ARRAY OF type covers only the type name, not ARRAY..OF prefix', () => {
    const src = `PROGRAM Main
VAR
  a1 : ARRAY[1..10] OF MyType;
  a2 : ARRAY[1..5] OF MyType;
END_VAR
END_PROGRAM`;
    const doc = makeDoc(src);
    // Position on 'MyType' in the ARRAY type on line 2 (col 21 = after 'ARRAY[1..10] OF ')
    const params = makeParams(doc.uri, 2, 21);
    const result = handleReferences(params, doc);

    // Both type annotations on lines 2 and 3 should match MyType
    expect(result.length).toBe(2);
    for (const loc of result) {
      // The range should cover only 'MyType' (6 chars), not the full ARRAY expression
      expect(loc.range.end.character - loc.range.start.character).toBe(6);
    }
  });

  it('reference range for REFERENCE TO type covers only the type name', () => {
    const src = `PROGRAM Main
VAR
  r1 : REFERENCE TO MyFB;
  r2 : REFERENCE TO MyFB;
END_VAR
END_PROGRAM`;
    const doc = makeDoc(src);
    // Position on 'MyFB' in line 2 (col 20 = after 'REFERENCE TO ')
    const params = makeParams(doc.uri, 2, 20);
    const result = handleReferences(params, doc);

    expect(result.length).toBe(2);
    for (const loc of result) {
      // The range should cover only 'MyFB' (4 chars)
      expect(loc.range.end.character - loc.range.start.character).toBe(4);
    }
  });
});
