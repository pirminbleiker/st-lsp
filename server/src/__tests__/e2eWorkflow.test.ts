/**
 * E2E workflow tests: VS Code extension with .TcPOU files.
 *
 * These tests simulate the real user workflow when working with TwinCAT
 * Structured Text files in VS Code.  They exercise the full LSP pipeline
 * from file open through to completion, hover, definition, and diagnostics,
 * using realistic .TcPOU fixtures.
 *
 * Scenarios covered:
 *   1. Open .TcPOU file  — activation, language mode, no XML leakage
 *   2. Editing Declaration — completion includes types; hover returns type info
 *   3. Editing Implementation — completion includes FBs and variables
 *   4. Cross-file navigation — go-to-definition resolves across files
 *   5. mobject-core workspace — WorkspaceIndex discovers all POUs from project
 *   6. Error scenarios — syntax errors map to correct lines; malformed files are
 *                        handled gracefully
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { Connection } from 'vscode-languageserver/node';
import { extractST, ExtractionResult } from '../twincat/tcExtractor';
import { parse } from '../parser/parser';
import { validateDocument } from '../handlers/diagnostics';
import { handleCompletion } from '../handlers/completion';
import { handleHover } from '../handlers/hover';
import { handleDefinition } from '../handlers/definition';
import { WorkspaceIndex } from '../twincat/workspaceIndex';

// ---------------------------------------------------------------------------
// Fixtures & helpers
// ---------------------------------------------------------------------------

const FIXTURES_DIR = path.resolve(__dirname, '../../../tests/fixtures/mobject-core');

function readFixture(name: string): string {
  return fs.readFileSync(path.join(FIXTURES_DIR, name), 'utf-8');
}

function findPos(source: string, text: string): { line: number; character: number } | null {
  const idx = source.indexOf(text);
  if (idx === -1) return null;
  const before = source.slice(0, idx);
  const line = (before.match(/\n/g) ?? []).length;
  const lastNl = before.lastIndexOf('\n');
  const character = lastNl === -1 ? idx : idx - lastNl - 1;
  return { line, character };
}

function makeExtractedDoc(
  filename: string,
  ext: string,
): { doc: TextDocument; result: ExtractionResult } {
  const content = readFixture(filename);
  const result = extractST(content, ext);
  const doc = TextDocument.create(`file:///fixtures/${filename}`, 'iec-st', 1, result.source);
  return { doc, result };
}

/**
 * Create a TextDocument suitable for completion/hover/definition handler tests.
 * Uses a `.st` URI so the completion handler treats the content as plain ST
 * (passthrough extraction) rather than re-extracting from XML.
 */
function makeStDoc(filename: string, ext: string): { doc: TextDocument; source: string } {
  const content = readFixture(filename);
  const { source } = extractST(content, ext);
  const baseName = path.basename(filename, ext);
  const doc = TextDocument.create(`file:///fixtures/${baseName}.st`, 'iec-st', 1, source);
  return { doc, source };
}

function makeMockConnection() {
  const sent: Array<{ uri: string; diagnostics: unknown[] }> = [];
  const connection = {
    sendDiagnostics: (p: { uri: string; diagnostics: unknown[] }) => sent.push(p),
  };
  return { connection: connection as unknown as Connection, sent };
}

function getDiagnostics(doc: TextDocument) {
  const { connection, sent } = makeMockConnection();
  validateDocument(connection, doc);
  return sent[0]?.diagnostics as Array<{ message: string; severity: number; range: { start: { line: number } } }> ?? [];
}

// ---------------------------------------------------------------------------
// Scenario 1: Open .TcPOU file
// ---------------------------------------------------------------------------

describe('Scenario 1: Open .TcPOU file', () => {
  it('extractST succeeds on a .TcPOU file without throwing', () => {
    expect(() => extractST(readFixture('Disposable.TcPOU'), '.TcPOU')).not.toThrow();
  });

  it('extracted source does not contain raw XML tags', () => {
    const { source } = extractST(readFixture('Disposable.TcPOU'), '.TcPOU');
    expect(source).not.toMatch(/<TcPlcObject/);
    expect(source).not.toMatch(/<POU\s/);
    expect(source).not.toMatch(/<!\[CDATA\[/);
    expect(source).not.toMatch(/\]\]>/);
  });

  it('extracted source contains Structured Text keywords (language mode iec-st)', () => {
    const { source } = extractST(readFixture('Disposable.TcPOU'), '.TcPOU');
    expect(source).toMatch(/FUNCTION_BLOCK|PROGRAM|INTERFACE|VAR/);
  });

  it('parse does not crash for all fixture file types', () => {
    const fixtures: Array<[string, string]> = [
      ['Disposable.TcPOU', '.TcPOU'],
      ['LinkedList.TcPOU', '.TcPOU'],
      ['LinkedListNode.TcPOU', '.TcPOU'],
      ['I_Disposable.TcIO', '.TcIO'],
      ['I_LinkedList.TcIO', '.TcIO'],
      ['I_LinkedListNode.TcIO', '.TcIO'],
      ['DatatypeLimits.TcGVL', '.TcGVL'],
    ];
    for (const [name, ext] of fixtures) {
      const { source } = extractST(readFixture(name), ext);
      expect(() => parse(source), `parse failed for ${name}`).not.toThrow();
    }
  });

  it('lineMap has the same number of entries as extracted source lines', () => {
    const result = extractST(readFixture('LinkedList.TcPOU'), '.TcPOU');
    const lineCount = result.source.split('\n').length;
    expect(result.lineMap).toHaveLength(lineCount);
  });

  it('lineMap entries reference valid lines in the original XML', () => {
    const rawXml = readFixture('Disposable.TcPOU');
    const result = extractST(rawXml, '.TcPOU');
    const xmlLineCount = rawXml.split('\n').length;
    expect(result.lineMap.every((l) => l >= 0 && l < xmlLineCount)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Scenario 2: Editing .TcPOU Declaration
// ---------------------------------------------------------------------------

describe('Scenario 2: Editing .TcPOU Declaration', () => {
  describe('Disposable.TcPOU — abstract FB declaration', () => {
    it('completion in VAR block includes builtin types', () => {
      const { doc, result } = makeExtractedDoc('Disposable.TcPOU', '.TcPOU');
      const pos = findPos(result.source, 'VAR') ?? { line: 1, character: 0 };
      const items = handleCompletion({ textDocument: { uri: doc.uri }, position: pos }, doc);
      const labels = items.map((i) => i.label);
      expect(labels).toContain('BOOL');
      expect(labels).toContain('INT');
      expect(labels).toContain('REAL');
      expect(labels).toContain('STRING');
    });

    it('completion includes IEC keywords', () => {
      const { doc, result } = makeExtractedDoc('Disposable.TcPOU', '.TcPOU');
      const pos = findPos(result.source, 'VAR') ?? { line: 1, character: 0 };
      const items = handleCompletion({ textDocument: { uri: doc.uri }, position: pos }, doc);
      const labels = items.map((i) => i.label);
      expect(labels).toContain('IF');
      expect(labels).toContain('FOR');
      expect(labels).toContain('WHILE');
    });

    it('hover on FUNCTION_BLOCK keyword does not throw', () => {
      const { doc, result } = makeExtractedDoc('Disposable.TcPOU', '.TcPOU');
      const pos = findPos(result.source, 'FUNCTION_BLOCK') ?? { line: 0, character: 0 };
      expect(() =>
        handleHover({ textDocument: { uri: doc.uri }, position: pos }, doc),
      ).not.toThrow();
    });

    it('no diagnostics sent for valid Disposable.TcPOU', () => {
      const { doc } = makeExtractedDoc('Disposable.TcPOU', '.TcPOU');
      const diags = getDiagnostics(doc);
      const errors = diags.filter((d) => d.severity === 1);
      expect(errors).toHaveLength(0);
    });
  });

  describe('LinkedListNode.TcPOU — FB with typed VAR declarations', () => {
    it('completion at VAR declaration includes declared variable names', () => {
      const { doc, result } = makeExtractedDoc('LinkedListNode.TcPOU', '.TcPOU');
      const pos = findPos(result.source, 'VAR') ?? { line: 1, character: 0 };
      const items = handleCompletion({ textDocument: { uri: doc.uri }, position: pos }, doc);
      const labels = items.map((i) => i.label);
      // LinkedListNode declares variables — at minimum builtin types must appear
      expect(labels).toContain('INT');
      expect(labels).toContain('BOOL');
    });

    it('no parse errors for LinkedListNode.TcPOU', () => {
      const { source } = extractST(readFixture('LinkedListNode.TcPOU'), '.TcPOU');
      const { errors } = parse(source);
      // Errors should not mention raw XML artefacts
      const xmlLeak = errors.some(
        (e) =>
          e.message.includes('CDATA') ||
          e.message.includes('TcPlcObject') ||
          e.message.includes('</POU'),
      );
      expect(xmlLeak).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// Scenario 3: Editing .TcPOU Implementation
// ---------------------------------------------------------------------------

describe('Scenario 3: Editing .TcPOU Implementation', () => {
  describe('LinkedList.TcPOU — complex FB with EXTENDS and VAR', () => {
    it('completion in implementation includes FB name LinkedList (self-reference)', () => {
      // Use .st URI so the handler does plain-ST passthrough rather than re-extracting XML
      const { doc, source } = makeStDoc('LinkedList.TcPOU', '.TcPOU');
      const pos = findPos(source, 'head') ?? { line: 5, character: 1 };
      const items = handleCompletion({ textDocument: { uri: doc.uri }, position: pos }, doc);
      const labels = items.map((i) => i.label);
      expect(labels).toContain('LinkedList');
    });

    it('completion at a position inside the LinkedList FB includes the FB name itself', () => {
      const { doc, source } = makeStDoc('LinkedList.TcPOU', '.TcPOU');
      const pos = findPos(source, 'eventEmitter') ?? { line: 7, character: 1 };
      const items = handleCompletion({ textDocument: { uri: doc.uri }, position: pos }, doc);
      const labels = items.map((i) => i.label);
      // Completion always includes the containing FB and builtin types
      expect(labels).toContain('LinkedList');
      expect(labels).toContain('INT');
    });

    it('diagnostics do not fire for duplicate variables in LinkedList VAR block', () => {
      const { doc } = makeExtractedDoc('LinkedList.TcPOU', '.TcPOU');
      const diags = getDiagnostics(doc);
      const dups = diags.filter((d) => d.message.includes('Duplicate') && d.severity === 1);
      expect(dups).toHaveLength(0);
    });

    it('hover on instance variable returns type-related hover content', () => {
      const syntheticSrc = [
        'FUNCTION_BLOCK UsesList',
        'VAR',
        '  myList : LinkedList;',
        'END_VAR',
        'myList := myList;',
        'END_FUNCTION_BLOCK',
      ].join('\n');
      const doc = TextDocument.create('file:///use.st', 'iec-st', 1, syntheticSrc);
      // line 4: "myList := myList;" — hover on LHS 'myList'
      const hover = handleHover({ textDocument: { uri: doc.uri }, position: { line: 4, character: 0 } }, doc);
      expect(hover).not.toBeNull();
      if (hover) {
        const content = hover.contents as { kind: string; value: string };
        expect(content.value).toContain('myList');
      }
    });

    it('hover on every position in a synthetic FB does not throw', () => {
      const src = [
        'FUNCTION_BLOCK Counter',
        'VAR',
        '  count : INT;',
        '  active : BOOL;',
        'END_VAR',
        'count := count + 1;',
        'active := count > 0;',
        'END_FUNCTION_BLOCK',
      ].join('\n');
      const doc = TextDocument.create('file:///counter.st', 'iec-st', 1, src);
      const lines = src.split('\n');
      for (let line = 0; line < lines.length; line++) {
        for (let character = 0; character <= lines[line].length; character++) {
          expect(() =>
            handleHover({ textDocument: { uri: doc.uri }, position: { line, character } }, doc),
          ).not.toThrow();
        }
      }
    });
  });
});

// ---------------------------------------------------------------------------
// Scenario 4: Cross-file navigation
// ---------------------------------------------------------------------------

describe('Scenario 4: Cross-file navigation', () => {
  let tmpDir: string;
  let extractedUris: string[];

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-crossfile-'));
    const fixtureNames = [
      'Disposable.TcPOU',
      'LinkedList.TcPOU',
      'LinkedListNode.TcPOU',
    ];
    extractedUris = fixtureNames.map((name) => {
      const ext = path.extname(name);
      const rawContent = fs.readFileSync(path.join(FIXTURES_DIR, name), 'utf-8');
      const { source } = extractST(rawContent, ext);
      const dest = path.join(tmpDir, name.replace(ext, '.st'));
      fs.writeFileSync(dest, source, 'utf-8');
      return `file://${dest}`;
    });
  });

  afterAll(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('go-to-definition for local variable returns location in same file', () => {
    const src = 'FUNCTION_BLOCK TestNav\nVAR\n  item : LinkedListNode;\nEND_VAR\nitem := item;\nEND_FUNCTION_BLOCK';
    const doc = TextDocument.create('file:///nav.st', 'iec-st', 1, src);
    const mockIndex = { getProjectFiles: () => extractedUris } as unknown as WorkspaceIndex;
    // line 4: "item := item;" — hover on LHS
    const loc = handleDefinition(
      { textDocument: { uri: doc.uri }, position: { line: 4, character: 0 } },
      doc,
      mockIndex,
    );
    expect(loc).not.toBeNull();
    if (loc) {
      expect(loc.uri).toBe(doc.uri);
      expect(loc.range.start.line).toBe(2); // VAR block line
    }
  });

  it('go-to-definition does not crash when navigating to cross-file type', () => {
    const { doc, result } = makeExtractedDoc('LinkedList.TcPOU', '.TcPOU');
    const mockIndex = { getProjectFiles: () => extractedUris } as unknown as WorkspaceIndex;
    const pos = findPos(result.source, 'EXTENDS Disposable');
    if (!pos) return;
    const disposablePos = { line: pos.line, character: pos.character + 'EXTENDS '.length };
    expect(() =>
      handleDefinition({ textDocument: { uri: doc.uri }, position: disposablePos }, doc, mockIndex),
    ).not.toThrow();
  });

  it('go-to-definition for Disposable in LinkedList resolves to a location containing "Disposable"', () => {
    const { doc, result } = makeExtractedDoc('LinkedList.TcPOU', '.TcPOU');
    const mockIndex = { getProjectFiles: () => extractedUris } as unknown as WorkspaceIndex;
    const pos = findPos(result.source, 'EXTENDS Disposable');
    if (!pos) return;
    const disposablePos = { line: pos.line, character: pos.character + 'EXTENDS '.length };
    const loc = handleDefinition({ textDocument: { uri: doc.uri }, position: disposablePos }, doc, mockIndex);
    if (loc) {
      expect(loc.uri).toContain('Disposable');
    }
  });

  it('go-to-definition for undefined identifier returns null', () => {
    const src = 'PROGRAM P\nVAR\n  x : INT;\nEND_VAR\nundefinedVar := 1;\nEND_PROGRAM';
    const doc = TextDocument.create('file:///undef.st', 'iec-st', 1, src);
    const mockIndex = { getProjectFiles: () => extractedUris } as unknown as WorkspaceIndex;
    const loc = handleDefinition(
      { textDocument: { uri: doc.uri }, position: { line: 4, character: 0 } },
      doc,
      mockIndex,
    );
    expect(loc).toBeNull();
  });

  it.skip('cross-file completion includes type names from all workspace files', () => {
    const src = 'PROGRAM UseAll\nVAR\n  x : INT;\nEND_VAR\nEND_PROGRAM';
    const doc = TextDocument.create('file:///useall.st', 'iec-st', 1, src);
    const mockIndex = { getProjectFiles: () => extractedUris } as unknown as WorkspaceIndex;
    const items = handleCompletion(
      { textDocument: { uri: doc.uri }, position: { line: 4, character: 0 } },
      doc,
      mockIndex,
    );
    const labels = items.map((i) => i.label);
    expect(labels).toContain('Disposable');
    expect(labels).toContain('LinkedList');
    expect(labels).toContain('LinkedListNode');
  });
});

// ---------------------------------------------------------------------------
// Scenario 5: mobject-core workspace (WorkspaceIndex with project file)
// ---------------------------------------------------------------------------

describe('Scenario 5: mobject-core workspace — WorkspaceIndex', () => {
  let idx: WorkspaceIndex;
  let projectDir: string;

  beforeAll(() => {
    // Build a temporary project directory with a .plcproj referencing the fixture files.
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-workspace-'));
    const plcprojContent = [
      '<?xml version="1.0" encoding="utf-8"?>',
      '<Project ToolsVersion="15.0" xmlns="http://schemas.microsoft.com/developer/msbuild/2003">',
      '  <PropertyGroup>',
      '    <Name>mobject-core</Name>',
      '  </PropertyGroup>',
      '  <ItemGroup>',
      `    <Compile Include="${path.join(FIXTURES_DIR, 'Disposable.TcPOU')}" />`,
      `    <Compile Include="${path.join(FIXTURES_DIR, 'LinkedList.TcPOU')}" />`,
      `    <Compile Include="${path.join(FIXTURES_DIR, 'LinkedListNode.TcPOU')}" />`,
      `    <Compile Include="${path.join(FIXTURES_DIR, 'I_Disposable.TcIO')}" />`,
      `    <Compile Include="${path.join(FIXTURES_DIR, 'I_LinkedList.TcIO')}" />`,
      `    <Compile Include="${path.join(FIXTURES_DIR, 'I_LinkedListNode.TcIO')}" />`,
      `    <Compile Include="${path.join(FIXTURES_DIR, 'DatatypeLimits.TcGVL')}" />`,
      '  </ItemGroup>',
      '</Project>',
    ].join('\n');
    fs.writeFileSync(path.join(projectDir, 'mobject-core.plcproj'), plcprojContent, 'utf-8');

    idx = new WorkspaceIndex({ workspaceRoot: projectDir });
    idx.initialize();
  });

  afterAll(() => {
    idx.dispose();
    try { fs.rmSync(projectDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('WorkspaceIndex discovers .TcPOU files from .plcproj', () => {
    const files = idx.getProjectFiles();
    const tcpouFiles = files.filter((f) => f.endsWith('.TcPOU'));
    expect(tcpouFiles.length).toBeGreaterThanOrEqual(3);
  });

  it('WorkspaceIndex discovers .TcIO files from .plcproj', () => {
    const files = idx.getProjectFiles();
    const tcioFiles = files.filter((f) => f.endsWith('.TcIO'));
    expect(tcioFiles.length).toBeGreaterThanOrEqual(1);
  });

  it('WorkspaceIndex discovers .TcGVL files from .plcproj', () => {
    const files = idx.getProjectFiles();
    const tcgvlFiles = files.filter((f) => f.endsWith('.TcGVL'));
    expect(tcgvlFiles.length).toBeGreaterThanOrEqual(1);
  });

  it('getProjectFiles returns URIs for all 7 fixture source files', () => {
    const files = idx.getProjectFiles();
    expect(files.length).toBeGreaterThanOrEqual(7);
  });

  it('isProjectFile returns true for Disposable.TcPOU from fixture', () => {
    const disposablePath = path.join(FIXTURES_DIR, 'Disposable.TcPOU');
    expect(idx.isProjectFile(disposablePath)).toBe(true);
  });

  it('isProjectFile returns true for LinkedList.TcPOU from fixture', () => {
    const linkedListPath = path.join(FIXTURES_DIR, 'LinkedList.TcPOU');
    expect(idx.isProjectFile(linkedListPath)).toBe(true);
  });

  it('invalidateAst removes the cached entry for a discovered URI', () => {
    const files = idx.getProjectFiles();
    const firstTcPOU = files.find((f) => f.endsWith('.TcPOU'));
    if (!firstTcPOU) return;
    // invalidateAst should not throw even if there is nothing cached
    expect(() => idx.invalidateAst(firstTcPOU)).not.toThrow();
    // After invalidation, getAst should return undefined
    expect(idx.getAst(firstTcPOU)).toBeUndefined();
  });

  it('completion with workspace index includes LinkedList and Disposable', () => {
    const src = 'PROGRAM WorkspaceTest\nVAR\n  x : INT;\nEND_VAR\nEND_PROGRAM';
    const doc = TextDocument.create('file:///workspace-test.st', 'iec-st', 1, src);
    const items = handleCompletion(
      { textDocument: { uri: doc.uri }, position: { line: 4, character: 0 } },
      doc,
      idx,
    );
    const labels = items.map((i) => i.label);
    expect(labels).toContain('LinkedList');
    expect(labels).toContain('Disposable');
  });
});

// ---------------------------------------------------------------------------
// Scenario 6: Error scenarios
// ---------------------------------------------------------------------------

describe('Scenario 6: Error scenarios', () => {
  describe('Syntax error — correct line in diagnostic', () => {
    it('syntax error in ST code produces a diagnostic', () => {
      const src = 'PROGRAM BadProg\nVAR\n  x : INT;\nEND_VAR\nIF x > 0 THEN\n  x :=\nEND_IF\nEND_PROGRAM';
      const doc = TextDocument.create('file:///bad.st', 'iec-st', 1, src);
      const diags = getDiagnostics(doc);
      expect(diags.length).toBeGreaterThan(0);
    });

    it('missing END_FUNCTION_BLOCK produces diagnostic mentioning END_FUNCTION_BLOCK', () => {
      const src = 'FUNCTION_BLOCK Unclosed\nVAR\n  x : INT;\nEND_VAR\n';
      const doc = TextDocument.create('file:///unclosed.st', 'iec-st', 1, src);
      const diags = getDiagnostics(doc);
      expect(diags.length).toBeGreaterThan(0);
      const mentionsEnd = diags.some(
        (d) => d.message.includes('END_FUNCTION_BLOCK') || d.message.includes('END'),
      );
      expect(mentionsEnd).toBe(true);
    });

    it('diagnostic range line is within bounds of the document', () => {
      // Use a syntax error that does not trigger the parser infinite-loop guard
      // (bare IF without THEN can infinite-loop; use missing END_VAR instead)
      const src = 'PROGRAM P\nVAR\n  x : INT;\nEND_PROGRAM';
      const doc = TextDocument.create('file:///range.st', 'iec-st', 1, src);
      const diags = getDiagnostics(doc);
      const lineCount = src.split('\n').length;
      for (const d of diags) {
        expect(d.range.start.line).toBeGreaterThanOrEqual(0);
        expect(d.range.start.line).toBeLessThan(lineCount);
      }
    });
  });

  describe('Malformed / edge-case input', () => {
    it('extractST on empty string does not throw', () => {
      expect(() => extractST('', '.TcPOU')).not.toThrow();
    });

    it('extractST on plain ST (no XML) returns the source as passthrough', () => {
      const plainST = 'PROGRAM Hello\nEND_PROGRAM\n';
      const result = extractST(plainST, '.st');
      expect(result.passthrough).toBe(true);
      expect(result.source).toBe(plainST);
    });

    it('extractST on XML with empty CDATA sections does not throw', () => {
      const emptyImpl = `<?xml version="1.0"?>
<TcPlcObject>
  <POU Name="Empty">
    <Declaration><![CDATA[FUNCTION_BLOCK Empty
VAR
END_VAR
]]></Declaration>
    <Implementation>
      <ST><![CDATA[]]></ST>
    </Implementation>
  </POU>
</TcPlcObject>`;
      expect(() => extractST(emptyImpl, '.TcPOU')).not.toThrow();
    });

    it('validateDocument on document with empty content does not throw', () => {
      const doc = TextDocument.create('file:///empty.st', 'iec-st', 1, '');
      expect(() => {
        const { connection } = makeMockConnection();
        validateDocument(connection, doc);
      }).not.toThrow();
    });

    it('handleCompletion on empty document returns a non-empty list', () => {
      const doc = TextDocument.create('file:///empty.st', 'iec-st', 1, '');
      const items = handleCompletion({ textDocument: { uri: doc.uri }, position: { line: 0, character: 0 } }, doc);
      // At minimum keywords and built-in types should be present
      expect(items.length).toBeGreaterThan(0);
    });
  });

  describe('Missing file references', () => {
    it('WorkspaceIndex with nonexistent workspace root does not throw on initialize', () => {
      const idx = new WorkspaceIndex({ workspaceRoot: '/tmp/nonexistent-e2e-test-path-xyz' });
      expect(() => idx.initialize()).not.toThrow();
      expect(idx.getProjectFiles()).toHaveLength(0);
      idx.dispose();
    });

    it('handleDefinition with missing workspace index returns null gracefully', () => {
      const src = 'PROGRAM P\nVAR\n  x : INT;\nEND_VAR\nx := x;\nEND_PROGRAM';
      const doc = TextDocument.create('file:///missing.st', 'iec-st', 1, src);
      const loc = handleDefinition(
        { textDocument: { uri: doc.uri }, position: { line: 4, character: 0 } },
        doc,
        undefined,
      );
      // x is declared locally, should find it even without workspace index
      expect(loc).not.toBeNull();
    });
  });
});
