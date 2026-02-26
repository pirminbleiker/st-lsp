/**
 * Tests for cross-file completion via WorkspaceIndex.
 *
 * WorkspaceIndex requires real filesystem access, so we:
 *  1. Write temporary source files to disk for tests that need real file I/O.
 *  2. Create a minimal mock WorkspaceIndex whose getProjectFiles() returns the
 *     URIs of those temp files.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { CompletionItemKind } from 'vscode-languageserver/node';
import { handleCompletion } from '../handlers/completion';
import { WorkspaceIndex } from '../twincat/workspaceIndex';
import { parse } from '../parser/parser';
import { SourceFile, ParseError } from '../parser/ast';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDoc(content: string, uri = 'file:///current.st'): TextDocument {
  return TextDocument.create(uri, 'st', 1, content);
}

function makeParams(uri: string, line: number, character: number) {
  return {
    textDocument: { uri },
    position: { line, character },
  };
}

/**
 * Create a minimal WorkspaceIndex-shaped mock.
 * Only getProjectFiles() is used by handleCompletion.
 */
function makeMockIndex(fileUris: string[]): WorkspaceIndex {
  return {
    getProjectFiles: () => fileUris,
  } as unknown as WorkspaceIndex;
}

/**
 * Create a mock WorkspaceIndex that returns pre-parsed ASTs from getAst().
 * This lets us verify that handleCompletion uses the cache without hitting disk.
 */
function makeCachingMockIndex(
  cachedAsts: Map<string, { ast: SourceFile; errors: ParseError[] }>,
): WorkspaceIndex {
  return {
    getProjectFiles: () => Array.from(cachedAsts.keys()),
    getAst: (uri: string) => cachedAsts.get(uri),
  } as unknown as WorkspaceIndex;
}

/** Convert an absolute path to a file:// URI (POSIX style). */
function toFileUri(absPath: string): string {
  return `file://${absPath}`;
}

// ---------------------------------------------------------------------------
// Temporary directory for real files
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crossfile-test-'));
});

afterAll(() => {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

/** Write a file to tmpDir and return its file:// URI. */
function writeTmpFile(name: string, content: string): string {
  const filePath = path.join(tmpDir, name);
  fs.writeFileSync(filePath, content, 'utf8');
  return toFileUri(filePath);
}

// ---------------------------------------------------------------------------
// ST source snippets
// ---------------------------------------------------------------------------

const CURRENT_FILE_SRC = `PROGRAM Main
VAR
  localVar : BOOL;
END_VAR
END_PROGRAM`;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('handleCompletion — cross-file via WorkspaceIndex', () => {

  describe('without workspaceIndex', () => {
    it('still returns local items when workspaceIndex is undefined', () => {
      const doc = makeDoc(CURRENT_FILE_SRC);
      const items = handleCompletion(makeParams(doc.uri, 4, 0), doc, undefined);
      const labels = items.map(i => i.label);
      // Keywords should still appear
      expect(labels).toContain('IF');
      // Local POU names should still appear
      expect(labels).toContain('Main');
    });

    it('does not crash when workspaceIndex is undefined', () => {
      const doc = makeDoc(CURRENT_FILE_SRC);
      expect(() => handleCompletion(makeParams(doc.uri, 4, 0), doc, undefined)).not.toThrow();
    });
  });

  describe('PROGRAM from other file', () => {
    it('includes PROGRAM declared in another workspace file', () => {
      const otherSrc = `PROGRAM MyProg\nVAR\n  x : INT;\nEND_VAR\nEND_PROGRAM`;
      const otherUri = writeTmpFile('MyProg.st', otherSrc);

      const currentUri = writeTmpFile('current.st', CURRENT_FILE_SRC);
      const doc = makeDoc(CURRENT_FILE_SRC, currentUri);
      const index = makeMockIndex([otherUri]);

      const items = handleCompletion(makeParams(doc.uri, 4, 0), doc, index);
      const labels = items.map(i => i.label);

      expect(labels).toContain('MyProg');
    });

    it('assigns Class kind to cross-file PROGRAM', () => {
      const otherSrc = `PROGRAM MyProg\nVAR\n  x : INT;\nEND_VAR\nEND_PROGRAM`;
      const otherUri = writeTmpFile('MyProg2.st', otherSrc);

      const currentUri = writeTmpFile('current2.st', CURRENT_FILE_SRC);
      const doc = makeDoc(CURRENT_FILE_SRC, currentUri);
      const index = makeMockIndex([otherUri]);

      const items = handleCompletion(makeParams(doc.uri, 4, 0), doc, index);
      const myProgItem = items.find(i => i.label === 'MyProg');
      expect(myProgItem).toBeDefined();
      expect(myProgItem?.kind).toBe(CompletionItemKind.Class);
    });
  });

  describe('FUNCTION_BLOCK from other file', () => {
    it('includes FUNCTION_BLOCK declared in another workspace file', () => {
      const otherSrc = `FUNCTION_BLOCK MyFB\nVAR_INPUT\n  enable : BOOL;\nEND_VAR\nEND_FUNCTION_BLOCK`;
      const otherUri = writeTmpFile('MyFB.st', otherSrc);

      const currentUri = writeTmpFile('current3.st', CURRENT_FILE_SRC);
      const doc = makeDoc(CURRENT_FILE_SRC, currentUri);
      const index = makeMockIndex([otherUri]);

      const items = handleCompletion(makeParams(doc.uri, 4, 0), doc, index);
      const labels = items.map(i => i.label);

      expect(labels).toContain('MyFB');
    });

    it('assigns Class kind to cross-file FUNCTION_BLOCK', () => {
      const otherSrc = `FUNCTION_BLOCK MyFB\nVAR_INPUT\n  enable : BOOL;\nEND_VAR\nEND_FUNCTION_BLOCK`;
      const otherUri = writeTmpFile('MyFB2.st', otherSrc);

      const currentUri = writeTmpFile('current4.st', CURRENT_FILE_SRC);
      const doc = makeDoc(CURRENT_FILE_SRC, currentUri);
      const index = makeMockIndex([otherUri]);

      const items = handleCompletion(makeParams(doc.uri, 4, 0), doc, index);
      const myFbItem = items.find(i => i.label === 'MyFB');
      expect(myFbItem).toBeDefined();
      expect(myFbItem?.kind).toBe(CompletionItemKind.Class);
    });
  });

  describe('FUNCTION from other file', () => {
    it('includes FUNCTION declared in another workspace file', () => {
      const otherSrc = `FUNCTION MyFunc : INT\nVAR_INPUT\n  a : INT;\nEND_VAR\nEND_FUNCTION`;
      const otherUri = writeTmpFile('MyFunc.st', otherSrc);

      const currentUri = writeTmpFile('current5.st', CURRENT_FILE_SRC);
      const doc = makeDoc(CURRENT_FILE_SRC, currentUri);
      const index = makeMockIndex([otherUri]);

      const items = handleCompletion(makeParams(doc.uri, 4, 0), doc, index);
      const labels = items.map(i => i.label);

      expect(labels).toContain('MyFunc');
    });

    it('assigns Function kind to cross-file FUNCTION', () => {
      const otherSrc = `FUNCTION MyFunc : INT\nVAR_INPUT\n  a : INT;\nEND_VAR\nEND_FUNCTION`;
      const otherUri = writeTmpFile('MyFunc2.st', otherSrc);

      const currentUri = writeTmpFile('current6.st', CURRENT_FILE_SRC);
      const doc = makeDoc(CURRENT_FILE_SRC, currentUri);
      const index = makeMockIndex([otherUri]);

      const items = handleCompletion(makeParams(doc.uri, 4, 0), doc, index);
      const myFuncItem = items.find(i => i.label === 'MyFunc');
      expect(myFuncItem).toBeDefined();
      expect(myFuncItem?.kind).toBe(CompletionItemKind.Function);
    });
  });

  describe('STRUCT from other file', () => {
    it('includes STRUCT declared in another workspace file', () => {
      const otherSrc = `TYPE\n  MyStruct : STRUCT\n    field1 : INT;\n  END_STRUCT;\nEND_TYPE`;
      const otherUri = writeTmpFile('MyStruct.st', otherSrc);

      const currentUri = writeTmpFile('current7.st', CURRENT_FILE_SRC);
      const doc = makeDoc(CURRENT_FILE_SRC, currentUri);
      const index = makeMockIndex([otherUri]);

      const items = handleCompletion(makeParams(doc.uri, 4, 0), doc, index);
      const labels = items.map(i => i.label);

      expect(labels).toContain('MyStruct');
    });

    it('assigns Struct kind to cross-file STRUCT', () => {
      const otherSrc = `TYPE\n  MyStruct : STRUCT\n    field1 : INT;\n  END_STRUCT;\nEND_TYPE`;
      const otherUri = writeTmpFile('MyStruct2.st', otherSrc);

      const currentUri = writeTmpFile('current8.st', CURRENT_FILE_SRC);
      const doc = makeDoc(CURRENT_FILE_SRC, currentUri);
      const index = makeMockIndex([otherUri]);

      const items = handleCompletion(makeParams(doc.uri, 4, 0), doc, index);
      const myStructItem = items.find(i => i.label === 'MyStruct');
      expect(myStructItem).toBeDefined();
      expect(myStructItem?.kind).toBe(CompletionItemKind.Struct);
    });
  });

  describe('ENUM from other file', () => {
    it('includes ENUM declared in another workspace file', () => {
      const otherSrc = `TYPE\n  MyEnum : (Alpha, Beta, Gamma);\nEND_TYPE`;
      const otherUri = writeTmpFile('MyEnum.st', otherSrc);

      const currentUri = writeTmpFile('current9.st', CURRENT_FILE_SRC);
      const doc = makeDoc(CURRENT_FILE_SRC, currentUri);
      const index = makeMockIndex([otherUri]);

      const items = handleCompletion(makeParams(doc.uri, 4, 0), doc, index);
      const labels = items.map(i => i.label);

      expect(labels).toContain('MyEnum');
    });

    it('assigns Enum kind to cross-file ENUM', () => {
      const otherSrc = `TYPE\n  MyEnum : (Alpha, Beta, Gamma);\nEND_TYPE`;
      const otherUri = writeTmpFile('MyEnum2.st', otherSrc);

      const currentUri = writeTmpFile('current10.st', CURRENT_FILE_SRC);
      const doc = makeDoc(CURRENT_FILE_SRC, currentUri);
      const index = makeMockIndex([otherUri]);

      const items = handleCompletion(makeParams(doc.uri, 4, 0), doc, index);
      const enumItem = items.find(i => i.label === 'MyEnum');
      expect(enumItem).toBeDefined();
      expect(enumItem?.kind).toBe(CompletionItemKind.Enum);
    });

    it('includes enum member values from other file', () => {
      const otherSrc = `TYPE\n  MyEnum : (Alpha, Beta, Gamma);\nEND_TYPE`;
      const otherUri = writeTmpFile('MyEnum3.st', otherSrc);

      const currentUri = writeTmpFile('current11.st', CURRENT_FILE_SRC);
      const doc = makeDoc(CURRENT_FILE_SRC, currentUri);
      const index = makeMockIndex([otherUri]);

      const items = handleCompletion(makeParams(doc.uri, 4, 0), doc, index);
      const labels = items.map(i => i.label);

      expect(labels).toContain('MyEnum.Alpha');
      expect(labels).toContain('MyEnum.Beta');
      expect(labels).toContain('MyEnum.Gamma');
    });
  });

  describe('deduplication', () => {
    it('does not duplicate a POU name that is already in the current file', () => {
      // Other file also declares a PROGRAM named Main — same as the current file
      const sameNameSrc = `PROGRAM Main\nVAR\n  x : INT;\nEND_VAR\nEND_PROGRAM`;
      const otherUri = writeTmpFile('dup_Main.st', sameNameSrc);

      const currentUri = writeTmpFile('dup_current.st', CURRENT_FILE_SRC);
      const doc = makeDoc(CURRENT_FILE_SRC, currentUri);
      const index = makeMockIndex([otherUri]);

      const items = handleCompletion(makeParams(doc.uri, 4, 0), doc, index);
      const mainItems = items.filter(i => i.label === 'Main');

      // Should appear exactly once (from the current file)
      expect(mainItems).toHaveLength(1);
    });

    it('skips reading the current document URI even when listed in project files', () => {
      const currentSrc = `PROGRAM Main\nVAR\n  localVar : BOOL;\nEND_VAR\nEND_PROGRAM`;
      const currentFilePath = path.join(tmpDir, 'skip_current.st');
      fs.writeFileSync(currentFilePath, currentSrc, 'utf8');
      const currentUri = toFileUri(currentFilePath);

      const doc = makeDoc(currentSrc, currentUri);
      // Index lists only the current file — the handler should skip it, not read it twice
      const index = makeMockIndex([currentUri]);

      const items = handleCompletion(makeParams(doc.uri, 4, 0), doc, index);
      const mainItems = items.filter(i => i.label === 'Main');

      // Should appear exactly once (from current file's local parse, not re-read from disk)
      expect(mainItems).toHaveLength(1);
    });
  });

  describe('graceful handling of unreadable files', () => {
    it('does not crash when a project file URI points to a missing file', () => {
      const missingUri = toFileUri(path.join(tmpDir, 'does_not_exist.st'));

      const currentUri = writeTmpFile('graceful_current.st', CURRENT_FILE_SRC);
      const doc = makeDoc(CURRENT_FILE_SRC, currentUri);
      const index = makeMockIndex([missingUri]);

      // Should not throw
      expect(() => handleCompletion(makeParams(doc.uri, 4, 0), doc, index)).not.toThrow();
    });

    it('still returns local items when a project file cannot be read', () => {
      const missingUri = toFileUri(path.join(tmpDir, 'also_missing.st'));

      const currentUri = writeTmpFile('graceful2_current.st', CURRENT_FILE_SRC);
      const doc = makeDoc(CURRENT_FILE_SRC, currentUri);
      const index = makeMockIndex([missingUri]);

      const items = handleCompletion(makeParams(doc.uri, 4, 0), doc, index);
      const labels = items.map(i => i.label);

      // Keywords and local POUs should still be present
      expect(labels).toContain('IF');
      expect(labels).toContain('Main');
    });
  });

  describe('AST cache (getAst)', () => {
    it('returns symbols from cached AST without needing files on disk', () => {
      // Build a cached AST in memory — no file is written to disk
      const otherSrc = `PROGRAM CachedProg\nVAR\n  x : INT;\nEND_VAR\nEND_PROGRAM`;
      const { ast, errors } = parse(otherSrc);
      const otherUri = 'file:///non_existent_cached.st';

      const cachedAsts = new Map([[ otherUri, { ast, errors } ]]);
      const index = makeCachingMockIndex(cachedAsts);

      const currentUri = writeTmpFile('cache_current.st', CURRENT_FILE_SRC);
      const doc = makeDoc(CURRENT_FILE_SRC, currentUri);

      const items = handleCompletion(makeParams(doc.uri, 4, 0), doc, index);
      const labels = items.map(i => i.label);

      expect(labels).toContain('CachedProg');
    });

    it('falls back to disk when getAst returns undefined', () => {
      const otherSrc = `PROGRAM DiskProg\nVAR\n  x : INT;\nEND_VAR\nEND_PROGRAM`;
      const otherUri = writeTmpFile('disk_fallback.st', otherSrc);

      // Index reports the file but getAst always returns undefined
      const index = {
        getProjectFiles: () => [otherUri],
        getAst: (_uri: string) => undefined,
      } as unknown as WorkspaceIndex;

      const currentUri = writeTmpFile('disk_fallback_current.st', CURRENT_FILE_SRC);
      const doc = makeDoc(CURRENT_FILE_SRC, currentUri);

      const items = handleCompletion(makeParams(doc.uri, 4, 0), doc, index);
      const labels = items.map(i => i.label);

      expect(labels).toContain('DiskProg');
    });

    it('returns struct types from cached AST', () => {
      const otherSrc = `TYPE\n  CachedStruct : STRUCT\n    f : INT;\n  END_STRUCT;\nEND_TYPE`;
      const { ast, errors } = parse(otherSrc);
      const otherUri = 'file:///non_existent_struct.st';

      const cachedAsts = new Map([[ otherUri, { ast, errors } ]]);
      const index = makeCachingMockIndex(cachedAsts);

      const currentUri = writeTmpFile('cache_struct_current.st', CURRENT_FILE_SRC);
      const doc = makeDoc(CURRENT_FILE_SRC, currentUri);

      const items = handleCompletion(makeParams(doc.uri, 4, 0), doc, index);
      const labels = items.map(i => i.label);

      expect(labels).toContain('CachedStruct');
    });
  });

  describe('prefix filtering', () => {
    it('returns only symbols matching the typed prefix', () => {
      const otherSrc = `PROGRAM AlphaBlock\nEND_PROGRAM\nPROGRAM BetaBlock\nEND_PROGRAM`;
      const { ast, errors } = parse(otherSrc);
      const otherUri = 'file:///prefix_filter.st';

      const cachedAsts = new Map([[ otherUri, { ast, errors } ]]);
      const index = makeCachingMockIndex(cachedAsts);

      // Source with cursor after typing "Alp" on a new line
      const src = `PROGRAM Main\nVAR\nEND_VAR\nAlp`;
      const doc = makeDoc(src, 'file:///prefix_current.st');
      // Position: line 3, character 3 (after "Alp")
      const items = handleCompletion(makeParams(doc.uri, 3, 3), doc, index);
      const labels = items.map(i => i.label);

      expect(labels).toContain('AlphaBlock');
      expect(labels).not.toContain('BetaBlock');
    });

    it('returns all symbols when no prefix is typed (empty line)', () => {
      const otherSrc = `PROGRAM AlphaBlock\nEND_PROGRAM\nPROGRAM BetaBlock\nEND_PROGRAM`;
      const { ast, errors } = parse(otherSrc);
      const otherUri = 'file:///no_prefix_filter.st';

      const cachedAsts = new Map([[ otherUri, { ast, errors } ]]);
      const index = makeCachingMockIndex(cachedAsts);

      const doc = makeDoc(CURRENT_FILE_SRC, 'file:///no_prefix_current.st');
      // Position at start of line — no prefix
      const items = handleCompletion(makeParams(doc.uri, 4, 0), doc, index);
      const labels = items.map(i => i.label);

      expect(labels).toContain('AlphaBlock');
      expect(labels).toContain('BetaBlock');
    });

    it('prefix matching is case-insensitive', () => {
      const otherSrc = `PROGRAM MyController\nEND_PROGRAM`;
      const { ast, errors } = parse(otherSrc);
      const otherUri = 'file:///case_filter.st';

      const cachedAsts = new Map([[ otherUri, { ast, errors } ]]);
      const index = makeCachingMockIndex(cachedAsts);

      // Cursor after "myc" (lowercase)
      const src = `PROGRAM Main\nVAR\nEND_VAR\nmyc`;
      const doc = makeDoc(src, 'file:///case_prefix_current.st');
      const items = handleCompletion(makeParams(doc.uri, 3, 3), doc, index);
      const labels = items.map(i => i.label);

      expect(labels).toContain('MyController');
    });
  });
});
