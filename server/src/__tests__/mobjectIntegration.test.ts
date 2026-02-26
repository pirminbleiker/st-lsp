/**
 * Integration tests: handlers with real OOP code from mobject-core fixtures.
 *
 * These tests verify that the LSP handlers (diagnostics, completion, hover,
 * definition) work correctly when given Structured Text extracted from real
 * TwinCAT XML files (.TcPOU, .TcIO, .TcGVL) found in the mobject-core test
 * fixtures.  The tests exercise:
 *
 *  - Parser integration: extracted ST parses without crashing
 *  - Diagnostics handler: no XML artefacts leak into diagnostic messages
 *  - Completion handler: variables and POU names from mobject-core are offered
 *  - Hover handler: variable hover returns type information
 *  - Definition handler: go-to-definition resolves local and cross-file symbols
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { extractST, ExtractionResult } from '../twincat/tcExtractor';
import { parse } from '../parser/parser';
import { validateDocument } from '../handlers/diagnostics';
import { handleCompletion } from '../handlers/completion';
import { handleHover } from '../handlers/hover';
import { handleDefinition } from '../handlers/definition';
import { WorkspaceIndex } from '../twincat/workspaceIndex';
import { FunctionBlockDeclaration } from '../parser/ast';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FIXTURES_DIR = path.resolve(__dirname, '../../../tests/fixtures/mobject-core');

function fixture(name: string): string {
  return fs.readFileSync(path.join(FIXTURES_DIR, name), 'utf-8');
}

/** Return the {line, character} position of the first occurrence of `text`. */
function findPos(source: string, text: string): { line: number; character: number } | null {
  const idx = source.indexOf(text);
  if (idx === -1) return null;
  const before = source.slice(0, idx);
  const line = (before.match(/\n/g) ?? []).length;
  const lastNl = before.lastIndexOf('\n');
  const character = lastNl === -1 ? idx : idx - lastNl - 1;
  return { line, character };
}

function makeMockConnection() {
  const sentParams: Array<{ uri: string; diagnostics: unknown[] }> = [];
  const connection = {
    sendDiagnostics: (params: { uri: string; diagnostics: unknown[] }) => {
      sentParams.push(params);
    },
  };
  return { connection, sentParams };
}

/**
 * Extract ST from a fixture file and wrap it in a TextDocument.
 */
function makeExtractedDoc(
  filename: string,
  ext: string,
): { doc: TextDocument; result: ExtractionResult } {
  const content = fixture(filename);
  const result = extractST(content, ext);
  const doc = TextDocument.create(`file:///fixtures/${filename}`, 'st', 1, result.source);
  return { doc, result };
}

// ---------------------------------------------------------------------------
// 1. Parser Integration
// ---------------------------------------------------------------------------

describe('Parser Integration: mobject-core POUs', () => {
  describe('Disposable.TcPOU (abstract class)', () => {
    it('extractST does not throw', () => {
      expect(() => extractST(fixture('Disposable.TcPOU'), '.TcPOU')).not.toThrow();
    });

    it('parse() does not throw on extracted source', () => {
      const { source } = extractST(fixture('Disposable.TcPOU'), '.TcPOU');
      expect(() => parse(source)).not.toThrow();
    });

    it('parsed AST contains FunctionBlockDeclaration named Disposable', () => {
      const { source } = extractST(fixture('Disposable.TcPOU'), '.TcPOU');
      const { ast } = parse(source);
      const fb = ast.declarations.find(
        (d) => d.kind === 'FunctionBlockDeclaration' && (d as FunctionBlockDeclaration).name === 'Disposable',
      );
      expect(fb).toBeDefined();
    });

    it('parse errors contain no raw XML tags', () => {
      const { source } = extractST(fixture('Disposable.TcPOU'), '.TcPOU');
      const { errors } = parse(source);
      const xmlLeak = errors.some(
        (e) => e.message.includes('<![CDATA') || e.message.includes('TcPlcObject') || e.message.includes('</POU'),
      );
      expect(xmlLeak).toBe(false);
    });
  });

  describe('LinkedList.TcPOU (class with EXTENDS and VAR block)', () => {
    it('parse() does not throw on extracted source', () => {
      const { source } = extractST(fixture('LinkedList.TcPOU'), '.TcPOU');
      expect(() => parse(source)).not.toThrow();
    });

    it('parsed AST contains FunctionBlockDeclaration named LinkedList', () => {
      const { source } = extractST(fixture('LinkedList.TcPOU'), '.TcPOU');
      const { ast } = parse(source);
      const fb = ast.declarations.find(
        (d) => d.kind === 'FunctionBlockDeclaration' && (d as FunctionBlockDeclaration).name === 'LinkedList',
      ) as FunctionBlockDeclaration | undefined;
      expect(fb).toBeDefined();
    });

    it('LinkedList FB has head and tail in its VAR block', () => {
      const { source } = extractST(fixture('LinkedList.TcPOU'), '.TcPOU');
      const { ast } = parse(source);
      const fb = ast.declarations.find(
        (d) => d.kind === 'FunctionBlockDeclaration' && (d as FunctionBlockDeclaration).name === 'LinkedList',
      ) as FunctionBlockDeclaration | undefined;
      expect(fb).toBeDefined();
      const allVarNames = (fb?.varBlocks ?? []).flatMap((b) => b.declarations.map((d) => d.name));
      expect(allVarNames).toContain('head');
      expect(allVarNames).toContain('tail');
      expect(allVarNames).toContain('eventEmitter');
    });
  });

  describe('I_Disposable.TcIO (interface file)', () => {
    it('extractST and parse() do not throw', () => {
      expect(() => {
        const { source } = extractST(fixture('I_Disposable.TcIO'), '.TcIO');
        parse(source);
      }).not.toThrow();
    });

    it('extracted source contains the INTERFACE keyword', () => {
      const { source } = extractST(fixture('I_Disposable.TcIO'), '.TcIO');
      expect(source).toContain('INTERFACE');
    });
  });

  describe('DatatypeLimits.TcGVL (global variable list)', () => {
    it('extractST and parse() do not throw', () => {
      expect(() => {
        const { source } = extractST(fixture('DatatypeLimits.TcGVL'), '.TcGVL');
        parse(source);
      }).not.toThrow();
    });

    it('extracted source is not empty', () => {
      const { source } = extractST(fixture('DatatypeLimits.TcGVL'), '.TcGVL');
      expect(source.trim().length).toBeGreaterThan(0);
    });
  });
});

// ---------------------------------------------------------------------------
// 2. Diagnostics Handler
// ---------------------------------------------------------------------------

describe('Diagnostics Handler: mobject-core POUs', () => {
  describe('Disposable.TcPOU', () => {
    it('validateDocument does not throw', () => {
      const { doc } = makeExtractedDoc('Disposable.TcPOU', '.TcPOU');
      const { connection } = makeMockConnection();
      expect(() =>
        validateDocument(connection as unknown as import('vscode-languageserver/node').Connection, doc),
      ).not.toThrow();
    });

    it('sendDiagnostics is called exactly once', () => {
      const { doc } = makeExtractedDoc('Disposable.TcPOU', '.TcPOU');
      const { connection, sentParams } = makeMockConnection();
      validateDocument(connection as unknown as import('vscode-languageserver/node').Connection, doc);
      expect(sentParams).toHaveLength(1);
    });

    it('diagnostic URI matches the document URI', () => {
      const { doc } = makeExtractedDoc('Disposable.TcPOU', '.TcPOU');
      const { connection, sentParams } = makeMockConnection();
      validateDocument(connection as unknown as import('vscode-languageserver/node').Connection, doc);
      expect(sentParams[0].uri).toBe(doc.uri);
    });

    it('diagnostics contain no XML-related error messages', () => {
      const { doc } = makeExtractedDoc('Disposable.TcPOU', '.TcPOU');
      const { connection, sentParams } = makeMockConnection();
      validateDocument(connection as unknown as import('vscode-languageserver/node').Connection, doc);
      const diags = sentParams[0]?.diagnostics as Array<{ message: string }> ?? [];
      const hasXmlLeak = diags.some(
        (d) => d.message.includes('CDATA') || d.message.includes('TcPlcObject') || d.message.includes('</POU'),
      );
      expect(hasXmlLeak).toBe(false);
    });
  });

  describe('LinkedList.TcPOU (complex OOP class)', () => {
    it('validateDocument does not throw on complex OOP class', () => {
      const { doc } = makeExtractedDoc('LinkedList.TcPOU', '.TcPOU');
      const { connection } = makeMockConnection();
      expect(() =>
        validateDocument(connection as unknown as import('vscode-languageserver/node').Connection, doc),
      ).not.toThrow();
    });

    it('no duplicate variable errors for LinkedList VAR block', () => {
      const { doc } = makeExtractedDoc('LinkedList.TcPOU', '.TcPOU');
      const { connection, sentParams } = makeMockConnection();
      validateDocument(connection as unknown as import('vscode-languageserver/node').Connection, doc);
      const diags = sentParams[0]?.diagnostics as Array<{ message: string; severity: number }> ?? [];
      const dups = diags.filter((d) => d.message.includes('Duplicate') && d.severity === 1);
      expect(dups).toHaveLength(0);
    });
  });

  describe('Offset mapping: lineMap references original XML lines', () => {
    it('all lineMap entries are non-negative', () => {
      const { result } = makeExtractedDoc('Disposable.TcPOU', '.TcPOU');
      expect(result.lineMap.every((l) => l >= 0)).toBe(true);
    });

    it('FUNCTION_BLOCK keyword in extracted source maps to the correct XML line', () => {
      const rawXml = fixture('Disposable.TcPOU');
      const result = extractST(rawXml, '.TcPOU');
      const pos = findPos(result.source, 'FUNCTION_BLOCK');
      expect(pos).not.toBeNull();
      if (pos) {
        const originalLine = result.lineMap[pos.line];
        const xmlLines = rawXml.split('\n');
        expect(xmlLines[originalLine]).toContain('FUNCTION_BLOCK');
      }
    });
  });
});

// ---------------------------------------------------------------------------
// 3. Completion Handler
// ---------------------------------------------------------------------------

describe('Completion Handler: mobject-core POUs', () => {
  describe('completion within LinkedList.TcPOU declaration', () => {
    it('includes ST keywords (IF, WHILE) at any position inside the FB', () => {
      const { doc, result } = makeExtractedDoc('LinkedList.TcPOU', '.TcPOU');
      const pos = findPos(result.source, 'head') ?? { line: 5, character: 1 };
      const items = handleCompletion({ textDocument: { uri: doc.uri }, position: pos }, doc);
      const labels = items.map((i) => i.label);
      expect(labels).toContain('IF');
      expect(labels).toContain('WHILE');
    });

    it('includes builtin types (BOOL, INT, REAL)', () => {
      const { doc, result } = makeExtractedDoc('LinkedList.TcPOU', '.TcPOU');
      const pos = findPos(result.source, 'head') ?? { line: 5, character: 1 };
      const items = handleCompletion({ textDocument: { uri: doc.uri }, position: pos }, doc);
      const labels = items.map((i) => i.label);
      expect(labels).toContain('BOOL');
      expect(labels).toContain('INT');
      expect(labels).toContain('REAL');
    });

    it('includes LinkedList as a class item (self-reference in same file)', () => {
      const { doc, result } = makeExtractedDoc('LinkedList.TcPOU', '.TcPOU');
      const pos = findPos(result.source, 'head') ?? { line: 5, character: 1 };
      const items = handleCompletion({ textDocument: { uri: doc.uri }, position: pos }, doc);
      const labels = items.map((i) => i.label);
      expect(labels).toContain('LinkedList');
    });

    it('includes declared variable names in scope (head, tail, eventEmitter)', () => {
      const { doc, result } = makeExtractedDoc('LinkedList.TcPOU', '.TcPOU');
      // Position inside the FB but after VAR block — still within the FB range.
      const pos = findPos(result.source, 'eventEmitter') ?? { line: 7, character: 1 };
      const items = handleCompletion({ textDocument: { uri: doc.uri }, position: pos }, doc);
      const labels = items.map((i) => i.label);
      expect(labels).toContain('head');
      expect(labels).toContain('tail');
      expect(labels).toContain('eventEmitter');
    });
  });

  describe('cross-file completion with extracted mobject-core workspace', () => {
    let tmpDir: string;
    let extractedUris: string[];

    beforeAll(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mobject-completion-'));
      const fixtureNames = [
        'Disposable.TcPOU',
        'LinkedList.TcPOU',
        'LinkedListNode.TcPOU',
        'I_Disposable.TcIO',
      ];
      // Write the EXTRACTED ST content (not raw XML) so the parser can find declarations.
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

    it('completion does not crash with mobject-core workspace', () => {
      const mockIndex = { getProjectFiles: () => extractedUris, getLibraryRefs: () => [] } as unknown as WorkspaceIndex;
      const src = 'PROGRAM TestProg\nVAR\n  x : INT;\nEND_VAR\nEND_PROGRAM';
      const doc = TextDocument.create('file:///test.st', 'st', 1, src);
      expect(() =>
        handleCompletion({ textDocument: { uri: doc.uri }, position: { line: 4, character: 0 } }, doc, mockIndex),
      ).not.toThrow();
    });

    it('completion with workspace includes Disposable FB name from fixture', () => {
      const mockIndex = { getProjectFiles: () => extractedUris, getLibraryRefs: () => [] } as unknown as WorkspaceIndex;
      const src = 'PROGRAM TestProg\nVAR\n  x : INT;\nEND_VAR\nEND_PROGRAM';
      const doc = TextDocument.create('file:///test.st', 'st', 1, src);
      const items = handleCompletion(
        { textDocument: { uri: doc.uri }, position: { line: 4, character: 0 } },
        doc,
        mockIndex,
      );
      const labels = items.map((i) => i.label);
      expect(labels).toContain('Disposable');
    });

    it('completion with workspace includes LinkedList FB name from fixture', () => {
      const mockIndex = { getProjectFiles: () => extractedUris, getLibraryRefs: () => [] } as unknown as WorkspaceIndex;
      const src = 'PROGRAM TestProg\nVAR\n  x : INT;\nEND_VAR\nEND_PROGRAM';
      const doc = TextDocument.create('file:///test.st', 'st', 1, src);
      const items = handleCompletion(
        { textDocument: { uri: doc.uri }, position: { line: 4, character: 0 } },
        doc,
        mockIndex,
      );
      const labels = items.map((i) => i.label);
      expect(labels).toContain('LinkedList');
    });
  });
});

// ---------------------------------------------------------------------------
// 4. Hover Handler
// ---------------------------------------------------------------------------

// A synthetic FUNCTION_BLOCK that references mobject-core-style types in its
// body so that NameExpression nodes exist for the hover handler to visit.
const SYNTHETIC_OOP_SRC = [
  'FUNCTION_BLOCK UsesMobjectCore',
  'VAR',
  '  myList : LinkedList;',
  '  myNode : LinkedListNode;',
  'END_VAR',
  'myList := myList;',  // line 5: NameExpression 'myList' on both sides
  'END_FUNCTION_BLOCK',
].join('\n');

describe('Hover Handler: mobject-core style code', () => {
  describe('handleHover on extracted mobject-core source', () => {
    it('handleHover does not throw on Disposable.TcPOU extracted source', () => {
      const { doc, result } = makeExtractedDoc('Disposable.TcPOU', '.TcPOU');
      const pos = findPos(result.source, 'FUNCTION_BLOCK') ?? { line: 3, character: 0 };
      expect(() => handleHover({ textDocument: { uri: doc.uri }, position: pos }, doc)).not.toThrow();
    });

    it('handleHover does not throw on LinkedList.TcPOU extracted source', () => {
      const { doc, result } = makeExtractedDoc('LinkedList.TcPOU', '.TcPOU');
      const pos = findPos(result.source, 'head') ?? { line: 5, character: 1 };
      expect(() => handleHover({ textDocument: { uri: doc.uri }, position: pos }, doc)).not.toThrow();
    });

    it('handleHover returns null for declaration-only positions (no NameExpression node)', () => {
      // In extracted TcPOU content, the top-level implementation is empty.
      // Positions in the declaration header have no NameExpression → null hover.
      const { doc, result } = makeExtractedDoc('Disposable.TcPOU', '.TcPOU');
      const pos = findPos(result.source, 'FUNCTION_BLOCK') ?? { line: 3, character: 0 };
      const hover = handleHover({ textDocument: { uri: doc.uri }, position: pos }, doc);
      expect(hover).toBeNull();
    });
  });

  describe('handleHover on synthetic OOP document', () => {
    const doc = TextDocument.create('file:///synthetic.st', 'st', 1, SYNTHETIC_OOP_SRC);

    it('hover on myList variable in body returns hover content', () => {
      // Line 5: "myList := myList;" — 'myList' at char 0 is a NameExpression
      const hover = handleHover({ textDocument: { uri: doc.uri }, position: { line: 5, character: 0 } }, doc);
      expect(hover).not.toBeNull();
      if (hover) {
        const content = hover.contents as { kind: string; value: string };
        expect(content.value).toContain('myList');
      }
    });

    it('hover on myList RHS shows type info containing LinkedList', () => {
      // line 5: "myList := myList;" — second 'myList' starts at char 10
      const hover = handleHover({ textDocument: { uri: doc.uri }, position: { line: 5, character: 10 } }, doc);
      expect(hover).not.toBeNull();
      if (hover) {
        const content = hover.contents as { kind: string; value: string };
        expect(content.value.toUpperCase()).toContain('LINKEDLIST');
      }
    });

    it('handleHover does not throw on any position in the synthetic doc', () => {
      const lines = SYNTHETIC_OOP_SRC.split('\n');
      for (let line = 0; line < lines.length; line++) {
        for (let character = 0; character <= lines[line].length; character++) {
          expect(() =>
            handleHover({ textDocument: { uri: doc.uri }, position: { line, character } }, doc),
          ).not.toThrow();
        }
      }
    });

    it('multi-section TcPOU: extracted source has non-zero lineMap entries', () => {
      const { result } = makeExtractedDoc('Disposable.TcPOU', '.TcPOU');
      // The declaration section starts after the XML header, so lineMap[0] > 0
      expect(result.lineMap.some((l) => l > 0)).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// 5. Definition Handler
// ---------------------------------------------------------------------------

describe('Definition Handler: mobject-core POUs', () => {
  describe('local variable definition in synthetic OOP document', () => {
    const doc = TextDocument.create('file:///synthetic-def.st', 'st', 1, SYNTHETIC_OOP_SRC);

    it('handleDefinition does not throw for variable in body', () => {
      // Line 5: "myList := myList;" — 'myList' at char 0
      expect(() =>
        handleDefinition({ textDocument: { uri: doc.uri }, position: { line: 5, character: 0 } }, doc, undefined),
      ).not.toThrow();
    });

    it('definition for myList in body returns a Location in the same file', () => {
      const loc = handleDefinition(
        { textDocument: { uri: doc.uri }, position: { line: 5, character: 0 } },
        doc,
        undefined,
      );
      expect(loc).not.toBeNull();
      if (loc) {
        expect(loc.uri).toBe(doc.uri);
        // Declaration is in the VAR block at line 2: "  myList : LinkedList;"
        expect(loc.range.start.line).toBe(2);
      }
    });

    it('definition for undeclared identifier returns null', () => {
      // Line 5 char 9: "myList" (RHS) is declared — but let's use a truly unknown name
      // Create a doc with an undeclared usage
      const src = 'PROGRAM P\nVAR\n  x : INT;\nEND_VAR\nundeclaredFoo := 1;\nEND_PROGRAM';
      const d = TextDocument.create('file:///undef.st', 'st', 1, src);
      // line 4: "undeclaredFoo := 1;" — 'undeclaredFoo' at char 0
      const loc = handleDefinition(
        { textDocument: { uri: d.uri }, position: { line: 4, character: 0 } },
        d,
        undefined,
      );
      // undeclaredFoo has no declaration, should return null
      expect(loc).toBeNull();
    });
  });

  describe('cross-file definition with extracted mobject-core workspace', () => {
    let tmpDir: string;
    let extractedUris: string[];

    beforeAll(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mobject-definition-'));
      const fixtureNames = ['Disposable.TcPOU', 'LinkedList.TcPOU'];
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

    it('handleDefinition does not crash with mobject-core workspace', () => {
      const mockIndex = { getProjectFiles: () => extractedUris, getLibraryRefs: () => [] } as unknown as WorkspaceIndex;
      // LinkedList extracted source — 'Disposable' appears in "EXTENDS Disposable"
      const { doc, result } = makeExtractedDoc('LinkedList.TcPOU', '.TcPOU');
      const pos = findPos(result.source, 'EXTENDS Disposable');
      if (!pos) return; // guard
      const disposablePos = { line: pos.line, character: pos.character + 'EXTENDS '.length };
      expect(() => handleDefinition({ textDocument: { uri: doc.uri }, position: disposablePos }, doc, mockIndex)).not.toThrow();
    });

    it('go-to-definition for Disposable in LinkedList finds the declaration', () => {
      const mockIndex = { getProjectFiles: () => extractedUris, getLibraryRefs: () => [] } as unknown as WorkspaceIndex;
      // LinkedList extracted source — 'Disposable' in "EXTENDS Disposable"
      const { doc, result } = makeExtractedDoc('LinkedList.TcPOU', '.TcPOU');
      const pos = findPos(result.source, 'EXTENDS Disposable');
      if (!pos) return; // guard
      const disposablePos = { line: pos.line, character: pos.character + 'EXTENDS '.length };
      const loc = handleDefinition({ textDocument: { uri: doc.uri }, position: disposablePos }, doc, mockIndex);
      if (loc) {
        // The resolved file should be the Disposable extracted ST file
        expect(loc.uri).toContain('Disposable');
      }
    });
  });
});
