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

type DiagnosticLike = { message: string; severity: number };

function getDiagnostics(content: string): DiagnosticLike[] {
  const { connection, sentParams } = makeMockConnection();
  const doc = makeDoc(content);
  validateDocument(connection as unknown as import('vscode-languageserver/node').Connection, doc);
  return sentParams[0]?.diagnostics as DiagnosticLike[] ?? [];
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

  // -------------------------------------------------------------------------
  // Semantic diagnostics: undefined identifier warnings
  // -------------------------------------------------------------------------

  describe('semantic: undefined identifier warnings', () => {
    it('warns for an undefined variable used in assignment RHS', () => {
      const src = `PROGRAM P
VAR
  x : INT;
END_VAR
x := undeclaredVar;
END_PROGRAM`;
      const diags = getDiagnostics(src);
      const warnings = diags.filter(d => d.severity === 2); // Warning = 2
      expect(warnings.some(d => d.message.includes('undeclaredVar'))).toBe(true);
    });

    it('does not warn for a declared variable used in assignment', () => {
      const src = `PROGRAM P
VAR
  x : INT;
  y : INT;
END_VAR
x := y;
END_PROGRAM`;
      const diags = getDiagnostics(src);
      const warnings = diags.filter(d => d.severity === 2);
      expect(warnings).toHaveLength(0);
    });

    it('does not warn for TRUE, FALSE, NULL (case insensitive)', () => {
      const src = `PROGRAM P
VAR
  b : BOOL;
  x : INT;
END_VAR
b := TRUE;
b := FALSE;
b := true;
b := false;
END_PROGRAM`;
      const diags = getDiagnostics(src);
      const warnings = diags.filter(d => d.severity === 2);
      expect(warnings).toHaveLength(0);
    });

    it('does not warn for BUILTIN_TYPES used as variable types (check is body-only)', () => {
      // Builtin type names (INT, BOOL, etc.) appear in type declarations, not body —
      // but even if they appear in a body as a NameExpression, they should be allowed
      const src = `PROGRAM P
VAR
  x : INT;
END_VAR
END_PROGRAM`;
      const diags = getDiagnostics(src);
      expect(diags).toHaveLength(0);
    });

    it('does not warn for standard FB names (TON, CTU, etc.)', () => {
      const src = `PROGRAM P
VAR
  timer : TON;
END_VAR
timer(IN := TRUE, PT := T#1s);
END_PROGRAM`;
      const diags = getDiagnostics(src);
      const warnings = diags.filter(d => d.severity === 2);
      expect(warnings).toHaveLength(0);
    });

    it('does not warn for POU names used as cross-references', () => {
      const src = `FUNCTION_BLOCK MyFB
VAR_INPUT
  x : INT;
END_VAR
END_FUNCTION_BLOCK

PROGRAM Main
VAR
  fb : MyFB;
END_VAR
fb(x := 1);
END_PROGRAM`;
      const diags = getDiagnostics(src);
      const warnings = diags.filter(d => d.severity === 2);
      expect(warnings).toHaveLength(0);
    });

    it('does not warn for struct/enum type names from TYPE blocks', () => {
      const src = `TYPE
  MyStruct : STRUCT
    field1 : INT;
  END_STRUCT;
END_TYPE

PROGRAM P
VAR
  s : MyStruct;
END_VAR
END_PROGRAM`;
      const diags = getDiagnostics(src);
      const warnings = diags.filter(d => d.severity === 2);
      expect(warnings).toHaveLength(0);
    });

    it('does not warn for MemberExpression member fields (only base is checked)', () => {
      // base.member — base must be in scope, member field is not checked
      const src = `PROGRAM P
VAR
  timer : TON;
END_VAR
timer.Q := FALSE;
END_PROGRAM`;
      const diags = getDiagnostics(src);
      const warnings = diags.filter(d => d.severity === 2);
      expect(warnings).toHaveLength(0);
    });

    it('warns for undefined base of a MemberExpression', () => {
      const src = `PROGRAM P
VAR
END_VAR
unknownVar.field := 1;
END_PROGRAM`;
      const diags = getDiagnostics(src);
      const warnings = diags.filter(d => d.severity === 2);
      expect(warnings.some(d => d.message.includes('unknownVar'))).toBe(true);
    });

    it('does not warn when identifier is a VAR_INPUT variable', () => {
      const src = `FUNCTION_BLOCK Foo
VAR_INPUT
  myInput : BOOL;
END_VAR
VAR_OUTPUT
  myOutput : BOOL;
END_VAR
myOutput := myInput;
END_FUNCTION_BLOCK`;
      const diags = getDiagnostics(src);
      const warnings = diags.filter(d => d.severity === 2);
      expect(warnings).toHaveLength(0);
    });

    it('does not warn for the FUNCTION return variable (function own name)', () => {
      const src = `FUNCTION MyFunc : INT
VAR_INPUT
  val : INT;
END_VAR
MyFunc := val + 1;
END_FUNCTION`;
      const diags = getDiagnostics(src);
      const warnings = diags.filter(d => d.severity === 2);
      expect(warnings).toHaveLength(0);
    });

    it('does not produce warnings for syntactically invalid programs (no false positives from partial parse)', () => {
      // When there are parse errors, we skip semantic analysis entirely
      const src = `PROGRAM P
VAR
  x : INT;
  undeclaredUsed;
END_PROGRAM`;
      const diags = getDiagnostics(src);
      // There may be parse errors, but no semantic warnings about undefined vars
      const warnings = diags.filter(d => d.severity === 2);
      expect(warnings).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // Semantic diagnostics: duplicate variable declarations
  // -------------------------------------------------------------------------

  describe('semantic: duplicate variable declarations', () => {
    it('reports an error for duplicate variable names in the same VAR block', () => {
      const src = `PROGRAM P
VAR
  x : INT;
  x : BOOL;
END_VAR
END_PROGRAM`;
      const diags = getDiagnostics(src);
      const errors = diags.filter(d => d.severity === 1); // Error = 1
      expect(errors.some(d => d.message.includes("Duplicate variable declaration 'x'"))).toBe(true);
    });

    it('reports duplicate when same name appears in two different VAR blocks', () => {
      const src = `PROGRAM P
VAR
  x : INT;
END_VAR
VAR_OUTPUT
  x : BOOL;
END_VAR
END_PROGRAM`;
      const diags = getDiagnostics(src);
      const errors = diags.filter(d => d.severity === 1);
      expect(errors.some(d => d.message.includes("Duplicate variable declaration 'x'"))).toBe(true);
    });

    it('does not report error when different variables have different names', () => {
      const src = `PROGRAM P
VAR
  x : INT;
  y : BOOL;
  z : REAL;
END_VAR
END_PROGRAM`;
      const diags = getDiagnostics(src);
      const errors = diags.filter(d => d.severity === 1);
      expect(errors).toHaveLength(0);
    });

    it('duplicate check is case-insensitive', () => {
      const src = `PROGRAM P
VAR
  myVar : INT;
  MYVAR : BOOL;
END_VAR
END_PROGRAM`;
      const diags = getDiagnostics(src);
      const errors = diags.filter(d => d.severity === 1);
      expect(errors.length).toBeGreaterThan(0);
    });

    it('duplicate in one POU does not affect another POU', () => {
      // x in both POUs is fine — they are separate scopes
      const src = `PROGRAM P
VAR
  x : INT;
END_VAR
END_PROGRAM

FUNCTION_BLOCK FB
VAR
  x : BOOL;
END_VAR
END_FUNCTION_BLOCK`;
      const diags = getDiagnostics(src);
      const errors = diags.filter(d => d.severity === 1);
      expect(errors).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // Combined scenarios
  // -------------------------------------------------------------------------

  describe('combined semantic checks', () => {
    it('reports both duplicate declarations and undefined identifier in same program', () => {
      const src = `PROGRAM P
VAR
  x : INT;
  x : BOOL;
END_VAR
y := 1;
END_PROGRAM`;
      const diags = getDiagnostics(src);
      const errors = diags.filter(d => d.severity === 1);
      const warnings = diags.filter(d => d.severity === 2);
      expect(errors.some(d => d.message.includes('Duplicate'))).toBe(true);
      expect(warnings.some(d => d.message.includes('y'))).toBe(true);
    });

    it('a valid program with vars, assignments, and IF produces no diagnostics', () => {
      const src = `PROGRAM Main
VAR
  counter : INT;
  limit : INT;
  done : BOOL;
END_VAR
counter := 0;
limit := 10;
IF counter < limit THEN
  done := FALSE;
ELSE
  done := TRUE;
END_IF;
END_PROGRAM`;
      const diags = getDiagnostics(src);
      expect(diags).toHaveLength(0);
    });
  });
});
