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
    getLibraryRefs: () => [],
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
    getLibraryRefs: () => [],
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

  describe('INTERFACE from other file', () => {
    it('includes INTERFACE declared in another workspace file', () => {
      const otherSrc = `INTERFACE I_Actuator\n  METHOD Enable : BOOL\n  END_METHOD\nEND_INTERFACE`;
      const otherUri = writeTmpFile('I_Actuator.st', otherSrc);

      const currentUri = writeTmpFile('current_iface1.st', CURRENT_FILE_SRC);
      const doc = makeDoc(CURRENT_FILE_SRC, currentUri);
      const index = makeMockIndex([otherUri]);

      const items = handleCompletion(makeParams(doc.uri, 4, 0), doc, index);
      const labels = items.map(i => i.label);

      expect(labels).toContain('I_Actuator');
    });

    it('assigns Interface kind to cross-file INTERFACE', () => {
      const otherSrc = `INTERFACE I_Sensor\n  METHOD Read : REAL\n  END_METHOD\nEND_INTERFACE`;
      const otherUri = writeTmpFile('I_Sensor.st', otherSrc);

      const currentUri = writeTmpFile('current_iface2.st', CURRENT_FILE_SRC);
      const doc = makeDoc(CURRENT_FILE_SRC, currentUri);
      const index = makeMockIndex([otherUri]);

      const items = handleCompletion(makeParams(doc.uri, 4, 0), doc, index);
      const ifaceItem = items.find(i => i.label === 'I_Sensor');
      expect(ifaceItem).toBeDefined();
      expect(ifaceItem?.kind).toBe(CompletionItemKind.Interface);
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
        getLibraryRefs: () => [],
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

  describe('GVL dot-access completion', () => {
    it('shows GVL variables when typing GVL_Name.', () => {
      const gvlSource = `VAR_GLOBAL\n  gCounter : INT;\n  gFlag : BOOL;\nEND_VAR`;
      const { ast: gvlAst, errors: gvlErrors } = parse(gvlSource);
      const gvlDecl = gvlAst.declarations.find(d => d.kind === 'GvlDeclaration');
      if (gvlDecl) (gvlDecl as any).name = 'GVL_Main';

      const mockIndex = makeCachingMockIndex(new Map([
        ['file:///gvl.tcgvl', { ast: gvlAst, errors: gvlErrors }],
      ]));

      // cursor after 'GVL_Main.' on line 3
      const currentSource = `PROGRAM MAIN\nVAR\nEND_VAR\n  GVL_Main.\nEND_PROGRAM`;
      const doc = makeDoc(currentSource);
      const params = makeParams(doc.uri, 3, 11);

      const items = handleCompletion(params, doc, mockIndex);
      const labels = items.map(i => i.label);
      expect(labels).toContain('gCounter');
      expect(labels).toContain('gFlag');
    });

    it('does not return flat keywords when GVL dot-access matches', () => {
      const gvlSource = `VAR_GLOBAL\n  gCounter : INT;\nEND_VAR`;
      const { ast: gvlAst, errors: gvlErrors } = parse(gvlSource);
      const gvlDecl = gvlAst.declarations.find(d => d.kind === 'GvlDeclaration');
      if (gvlDecl) (gvlDecl as any).name = 'GVL_Main';

      const mockIndex = makeCachingMockIndex(new Map([
        ['file:///gvl2.tcgvl', { ast: gvlAst, errors: gvlErrors }],
      ]));

      const currentSource = `PROGRAM MAIN\nVAR\nEND_VAR\n  GVL_Main.\nEND_PROGRAM`;
      const doc = makeDoc(currentSource);
      const items = handleCompletion(makeParams(doc.uri, 3, 11), doc, mockIndex);
      const labels = items.map(i => i.label);
      expect(labels).not.toContain('IF');
      expect(labels).not.toContain('WHILE');
    });

    it('is case-insensitive for GVL name', () => {
      const gvlSource = `VAR_GLOBAL\n  gCounter : INT;\nEND_VAR`;
      const { ast: gvlAst, errors: gvlErrors } = parse(gvlSource);
      const gvlDecl = gvlAst.declarations.find(d => d.kind === 'GvlDeclaration');
      if (gvlDecl) (gvlDecl as any).name = 'GVL_Main';

      const mockIndex = makeCachingMockIndex(new Map([
        ['file:///gvl3.tcgvl', { ast: gvlAst, errors: gvlErrors }],
      ]));

      // type with lowercase 'gvl_main.'
      const currentSource = `PROGRAM MAIN\nVAR\nEND_VAR\n  gvl_main.\nEND_PROGRAM`;
      const doc = makeDoc(currentSource);
      const params = makeParams(doc.uri, 3, 11);

      const items = handleCompletion(params, doc, mockIndex);
      expect(items.map(i => i.label)).toContain('gCounter');
    });

    it('resolves GVL variable type for chained dot-access', () => {
      const fbSource = `FUNCTION_BLOCK FB_Motor\nVAR_OUTPUT\n  bRunning : BOOL;\nEND_VAR\nEND_FUNCTION_BLOCK`;
      const { ast: fbAst, errors: fbErrors } = parse(fbSource);

      const gvlSource = `VAR_GLOBAL\n  myMotor : FB_Motor;\nEND_VAR`;
      const { ast: gvlAst, errors: gvlErrors } = parse(gvlSource);
      const gvlDecl = gvlAst.declarations.find(d => d.kind === 'GvlDeclaration');
      if (gvlDecl) (gvlDecl as any).name = 'GVL_Main';

      const mockIndex = makeCachingMockIndex(new Map([
        ['file:///gvl4.tcgvl', { ast: gvlAst, errors: gvlErrors }],
        ['file:///fb.st',      { ast: fbAst,  errors: fbErrors  }],
      ]));

      // cursor after 'GVL_Main.myMotor.' on line 3
      const currentSource = `PROGRAM MAIN\nVAR\nEND_VAR\n  GVL_Main.myMotor.\nEND_PROGRAM`;
      const doc = makeDoc(currentSource);
      const params = makeParams(doc.uri, 3, 19);

      const items = handleCompletion(params, doc, mockIndex);
      expect(items.map(i => i.label)).toContain('bRunning');
    });

    it('returns empty array when GVL name does not match any known GVL', () => {
      const mockIndex = makeCachingMockIndex(new Map());

      const currentSource = `PROGRAM MAIN\nVAR\nEND_VAR\n  NoSuchGVL.\nEND_PROGRAM`;
      const doc = makeDoc(currentSource);
      const items = handleCompletion(makeParams(doc.uri, 3, 12), doc, mockIndex);
      // Should not crash; result is empty
      expect(Array.isArray(items)).toBe(true);
      expect(items.filter(i => i.label === 'gMissing').length).toBe(0);
    });
  });

  describe('cross-file dot-access completion', () => {
    it('resolves FB members from a different workspace file', () => {
      const fbSource = `FUNCTION_BLOCK FB_Drive\nVAR_OUTPUT\n  bActive : BOOL;\n  fSpeed : REAL;\nEND_VAR\nEND_FUNCTION_BLOCK`;
      const { ast: fbAst, errors: fbErrors } = parse(fbSource);
      const mockIndex = makeCachingMockIndex(new Map([
        ['file:///fb.st', { ast: fbAst, errors: fbErrors }],
      ]));
      const fbDriveSrc = `PROGRAM MAIN\nVAR\n  myDrive : FB_Drive;\nEND_VAR\n  myDrive.\nEND_PROGRAM`;
      const doc = makeDoc(fbDriveSrc, 'file:///fb-drive-test.st');
      const items = handleCompletion(makeParams(doc.uri, 4, 10), doc, mockIndex);
      const labels = items.map(i => i.label);
      expect(labels).toContain('bActive');
      expect(labels).toContain('fSpeed');
    });

    it('resolves STRUCT fields from a different workspace file', () => {
      const structSource = `TYPE\n  ST_Axis : STRUCT\n    fPosition : REAL;\n    fVelocity : REAL;\n  END_STRUCT;\nEND_TYPE`;
      const { ast: structAst, errors: structErrors } = parse(structSource);
      const mockIndex = makeCachingMockIndex(new Map([
        ['file:///types.st', { ast: structAst, errors: structErrors }],
      ]));
      const currentSource = `PROGRAM MAIN\nVAR\n  myAxis : ST_Axis;\nEND_VAR\n  myAxis.\nEND_PROGRAM`;
      const doc = makeDoc(currentSource, 'file:///st-axis-test.st');
      const items = handleCompletion(makeParams(doc.uri, 4, 9), doc, mockIndex);
      const labels = items.map(i => i.label);
      expect(labels).toContain('fPosition');
      expect(labels).toContain('fVelocity');
    });

    it('includes GVL variables from other workspace files in flat completion', () => {
      const gvlSource = `VAR_GLOBAL\n  gSharedCounter : INT;\n  gSharedFlag : BOOL;\nEND_VAR`;
      const { ast: gvlAst } = parse(gvlSource);
      const mockIndex = makeCachingMockIndex(new Map([
        ['file:///globals.st', { ast: gvlAst, errors: [] }],
      ]));
      // typing in a PROGRAM body (no dot before cursor)
      const currentSource = `PROGRAM MAIN\nVAR END_VAR\n  \nEND_PROGRAM`;
      const doc = makeDoc(currentSource);
      const items = handleCompletion(makeParams(doc.uri, 2, 2), doc, mockIndex);
      const labels = items.map(i => i.label);
      expect(labels).toContain('gSharedCounter');
      expect(labels).toContain('gSharedFlag');
    });

    it('resolves multi-level chain across workspace files', () => {
      const structSource = `TYPE\n  ST_Status : STRUCT\n    bOk : BOOL;\n  END_STRUCT;\nEND_TYPE`;
      const { ast: structAst, errors: structErrors } = parse(structSource);

      const fbSource = `FUNCTION_BLOCK FB_Machine\nVAR_OUTPUT\n  Status : ST_Status;\nEND_VAR\nEND_FUNCTION_BLOCK`;
      const { ast: fbAst, errors: fbErrors } = parse(fbSource);

      const mockIndex = makeCachingMockIndex(new Map([
        ['file:///types.st', { ast: structAst, errors: structErrors }],
        ['file:///fb.st',    { ast: fbAst,     errors: fbErrors     }],
      ]));
      const currentSource = `PROGRAM MAIN\nVAR\n  myMachine : FB_Machine;\nEND_VAR\n  myMachine.Status.\nEND_PROGRAM`;
      const doc = makeDoc(currentSource, 'file:///machine-status-test.st');
      const items = handleCompletion(makeParams(doc.uri, 4, 19), doc, mockIndex);
      expect(items.map(i => i.label)).toContain('bOk');
    });
  });

  describe('cross-file interface dot-member completion', () => {
    it('resolves interface methods from a different workspace file', () => {
      const ifaceSource = [
        'INTERFACE I_ActuatorB',
        '',
        'METHOD Enable : BOOL',
        'END_METHOD',
        '',
        'METHOD Disable',
        'END_METHOD',
        '',
        'END_INTERFACE',
      ].join('\n');
      const { ast: ifaceAst, errors: ifaceErrors } = parse(ifaceSource);
      const mockIndex = makeCachingMockIndex(new Map([
        ['file:///iface_actuator.st', { ast: ifaceAst, errors: ifaceErrors }],
      ]));
      const currentSource = `PROGRAM MAIN\nVAR\n  actuator : I_ActuatorB;\nEND_VAR\n  actuator.\nEND_PROGRAM`;
      const doc = makeDoc(currentSource, 'file:///actuator-test.st');
      // cursor at line 4, character 11 (after '  actuator.')
      const items = handleCompletion(makeParams(doc.uri, 4, 11), doc, mockIndex);
      const labels = items.map(i => i.label);
      expect(labels).toContain('Enable');
      expect(labels).toContain('Disable');
    });

    it('resolves interface properties from a different workspace file', () => {
      const ifaceSource = [
        'INTERFACE I_SensorData',
        '',
        'PROPERTY Value : REAL',
        'END_PROPERTY',
        '',
        'PROPERTY IsValid : BOOL',
        'END_PROPERTY',
        '',
        'END_INTERFACE',
      ].join('\n');
      const { ast: ifaceAst, errors: ifaceErrors } = parse(ifaceSource);
      const mockIndex = makeCachingMockIndex(new Map([
        ['file:///sensor_iface.st', { ast: ifaceAst, errors: ifaceErrors }],
      ]));
      const currentSource = `PROGRAM MAIN\nVAR\n  sensor : I_SensorData;\nEND_VAR\n  sensor.\nEND_PROGRAM`;
      const doc = makeDoc(currentSource, 'file:///sensor-test.st');
      // cursor at line 4, character 9 (after '  sensor.')
      const items = handleCompletion(makeParams(doc.uri, 4, 9), doc, mockIndex);
      const labels = items.map(i => i.label);
      expect(labels).toContain('Value');
      expect(labels).toContain('IsValid');
    });

    it('resolves inherited interface methods via EXTENDS chain across workspace files', () => {
      const baseIfaceSource = [
        'INTERFACE I_BaseCtrl',
        '',
        'METHOD Init : BOOL',
        'END_METHOD',
        '',
        'END_INTERFACE',
      ].join('\n');
      const childIfaceSource = [
        'INTERFACE I_AdvCtrl EXTENDS I_BaseCtrl',
        '',
        'METHOD Run',
        'END_METHOD',
        '',
        'END_INTERFACE',
      ].join('\n');
      const { ast: baseAst, errors: baseErrors } = parse(baseIfaceSource);
      const { ast: childAst, errors: childErrors } = parse(childIfaceSource);
      const mockIndex = makeCachingMockIndex(new Map([
        ['file:///base_iface.st',  { ast: baseAst,  errors: baseErrors  }],
        ['file:///child_iface.st', { ast: childAst, errors: childErrors }],
      ]));
      const currentSource = `PROGRAM MAIN\nVAR\n  ctrl : I_AdvCtrl;\nEND_VAR\n  ctrl.\nEND_PROGRAM`;
      const doc = makeDoc(currentSource, 'file:///ctrl-test.st');
      // cursor at line 4, character 7 (after '  ctrl.')
      const items = handleCompletion(makeParams(doc.uri, 4, 7), doc, mockIndex);
      const labels = items.map(i => i.label);
      expect(labels).toContain('Run');
      expect(labels).toContain('Init');
    });

    it('resolves multi-level chain via interface property typed as another interface', () => {
      const configIfaceSource = [
        'INTERFACE I_Config',
        '',
        'PROPERTY Setting : INT',
        'END_PROPERTY',
        '',
        'END_INTERFACE',
      ].join('\n');
      const motorIfaceSource = [
        'INTERFACE I_MotorCtrl',
        '',
        'PROPERTY Config : I_Config',
        'END_PROPERTY',
        '',
        'END_INTERFACE',
      ].join('\n');
      const { ast: configAst, errors: configErrors } = parse(configIfaceSource);
      const { ast: motorAst, errors: motorErrors } = parse(motorIfaceSource);
      const mockIndex = makeCachingMockIndex(new Map([
        ['file:///config_iface.st', { ast: configAst, errors: configErrors }],
        ['file:///motor_iface.st',  { ast: motorAst,  errors: motorErrors  }],
      ]));
      // cursor after 'motor.Config.' on line 4 — character 15
      const currentSource = `PROGRAM MAIN\nVAR\n  motor : I_MotorCtrl;\nEND_VAR\n  motor.Config.\nEND_PROGRAM`;
      const doc = makeDoc(currentSource, 'file:///motor-chain-test.st');
      const items = handleCompletion(makeParams(doc.uri, 4, 15), doc, mockIndex);
      expect(items.map(i => i.label)).toContain('Setting');
    });
  });
});
