import { describe, it, expect, vi } from 'vitest';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { validateDocument } from '../handlers/diagnostics';

function makeDoc(content: string): TextDocument {
  return TextDocument.create('file:///test.st', 'st', 1, content);
}

/**
 * Create a minimal mock for the LSP Connection object.
 * We only need `sendDiagnostics`.
 */
function makeMockConnection() {
  const sentParams: Array<{ uri: string; diagnostics: unknown[] }> = [];
  const connection = {
    sendDiagnostics: (params: { uri: string; diagnostics: unknown[] }) => {
      sentParams.push(params);
    },
  };
  return { connection, sentParams };
}

describe('validateDocument', () => {
  describe('valid program', () => {
    it('sendDiagnostics is called with empty diagnostics array', () => {
      const { connection, sentParams } = makeMockConnection();
      const doc = makeDoc('PROGRAM Main\nEND_PROGRAM');

      // Cast to unknown first to avoid full Connection type requirements
      validateDocument(connection as unknown as import('vscode-languageserver/node').Connection, doc);

      expect(sentParams).toHaveLength(1);
      expect(sentParams[0].diagnostics).toHaveLength(0);
    });

    it('sendDiagnostics URI matches the document URI', () => {
      const { connection, sentParams } = makeMockConnection();
      const doc = makeDoc('PROGRAM Main\nEND_PROGRAM');

      validateDocument(connection as unknown as import('vscode-languageserver/node').Connection, doc);

      expect(sentParams[0].uri).toBe(doc.uri);
    });
  });

  describe('invalid program (missing END_PROGRAM)', () => {
    it('sendDiagnostics is called with non-empty diagnostics array', () => {
      const { connection, sentParams } = makeMockConnection();
      const doc = makeDoc('PROGRAM P');

      validateDocument(connection as unknown as import('vscode-languageserver/node').Connection, doc);

      expect(sentParams).toHaveLength(1);
      expect(sentParams[0].diagnostics.length).toBeGreaterThan(0);
    });

    it('diagnostic message mentions END_PROGRAM', () => {
      const { connection, sentParams } = makeMockConnection();
      const doc = makeDoc('PROGRAM P');

      validateDocument(connection as unknown as import('vscode-languageserver/node').Connection, doc);

      const diagnostics = sentParams[0].diagnostics as Array<{ message: string }>;
      const found = diagnostics.some(d => d.message.includes('END_PROGRAM'));
      expect(found).toBe(true);
    });
  });

  describe('program with syntax error', () => {
    it('produces diagnostics for unclosed VAR block', () => {
      const { connection, sentParams } = makeMockConnection();
      const doc = makeDoc('PROGRAM P\nVAR\n  x : INT;\nEND_PROGRAM');

      validateDocument(connection as unknown as import('vscode-languageserver/node').Connection, doc);

      // Missing END_VAR — should produce errors
      expect(sentParams[0].diagnostics.length).toBeGreaterThan(0);
    });
  });
});
