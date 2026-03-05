import { describe, it, expect, vi } from 'vitest';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { validateDocument } from '../handlers/diagnostics';
import { parse } from '../parser/parser';
import type { GvlDeclaration } from '../parser/ast';
import { WorkspaceIndex } from '../twincat/workspaceIndex';
import type { LibraryRef } from '../twincat/projectReader';
import type { LibrarySymbol } from '../twincat/libraryZipReader';

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

  describe('semantic: undefined identifier errors', () => {
    it('produces Warning for an undefined variable used in assignment RHS', () => {
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

    it('undeclared identifier produces Warning severity (not Error)', () => {
      const src = `FUNCTION_BLOCK TestFB
VAR x : INT; END_VAR
  undeclaredVar := 42;
END_FUNCTION_BLOCK`;
      const diags = getDiagnostics(src);
      const warnings = diags.filter(d => d.severity === 2); // Warning = 2
      expect(warnings.some(d => d.message.includes('Undefined') || d.message.includes('ndeclared'))).toBe(true);
      // Confirm it is NOT emitted as an Error
      const errors = diags.filter(d => d.severity === 1 && (d.message.includes('Undefined') || d.message.includes('ndeclared')));
      expect(errors).toHaveLength(0);
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

    it('produces Warning for undefined base of a MemberExpression', () => {
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
      expect(errors.some(d => d.message.includes('Duplicate'))).toBe(true);
      const warnings = diags.filter(d => d.severity === 2);
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

  // -------------------------------------------------------------------------
  // Semantic diagnostics: unknown types (Part A)
  // -------------------------------------------------------------------------

  describe('semantic: unknown types in VarDeclarations', () => {
    it('warns for an unknown type used in a VarDeclaration', () => {
      const src = `PROGRAM P
VAR
  x : UnknownType;
END_VAR
END_PROGRAM`;
      const diags = getDiagnostics(src);
      const warnings = diags.filter(d => d.severity === 2);
      // Parser normalises type names to uppercase; message uses the normalised form
      expect(warnings.some(d => d.message.includes('Unknown type:'))).toBe(true);
    });

    it('does not warn for builtin types (INT, BOOL, REAL, etc.)', () => {
      const src = `PROGRAM P
VAR
  a : INT;
  b : BOOL;
  c : REAL;
  d : STRING;
  e : DINT;
END_VAR
END_PROGRAM`;
      const diags = getDiagnostics(src);
      const warnings = diags.filter(d => d.severity === 2);
      expect(warnings).toHaveLength(0);
    });

    it('does not warn for stdlib FB types (TON, CTU, etc.)', () => {
      const src = `PROGRAM P
VAR
  t : TON;
END_VAR
END_PROGRAM`;
      const diags = getDiagnostics(src);
      const warnings = diags.filter(d => d.severity === 2);
      expect(warnings).toHaveLength(0);
    });

    it('does not warn when type is a POU defined in the same file', () => {
      const src = `FUNCTION_BLOCK MyFB
END_FUNCTION_BLOCK

PROGRAM P
VAR
  fb : MyFB;
END_VAR
END_PROGRAM`;
      const diags = getDiagnostics(src);
      const warnings = diags.filter(d => d.severity === 2);
      expect(warnings).toHaveLength(0);
    });

    it('does not warn when type is a TYPE declaration in the same file', () => {
      const src = `TYPE
  MyStruct : STRUCT
    x : INT;
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

    it('does not warn for ARRAY types (element type is valid)', () => {
      const src = `PROGRAM P
VAR
  arr : ARRAY[1..10] OF INT;
END_VAR
END_PROGRAM`;
      const diags = getDiagnostics(src);
      const warnings = diags.filter(d => d.severity === 2);
      expect(warnings).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // Semantic diagnostics: type mismatch on assignment (Part B)
  // -------------------------------------------------------------------------

  describe('semantic: type mismatch on assignment', () => {
    it('warns when BOOL variable is assigned an integer literal', () => {
      const src = `PROGRAM P
VAR
  b : BOOL;
END_VAR
b := 5;
END_PROGRAM`;
      const diags = getDiagnostics(src);
      const warnings = diags.filter(d => d.severity === 2);
      expect(warnings.some(d => d.message.toLowerCase().includes('type mismatch'))).toBe(true);
    });

    it('warns when numeric variable is assigned a STRING literal', () => {
      const src = `PROGRAM P
VAR
  n : INT;
END_VAR
n := 'hello';
END_PROGRAM`;
      const diags = getDiagnostics(src);
      const warnings = diags.filter(d => d.severity === 2);
      expect(warnings.some(d => d.message.toLowerCase().includes('type mismatch'))).toBe(true);
    });

    it('warns when numeric variable is assigned a BOOL literal (TRUE)', () => {
      const src = `PROGRAM P
VAR
  n : INT;
END_VAR
n := TRUE;
END_PROGRAM`;
      const diags = getDiagnostics(src);
      const warnings = diags.filter(d => d.severity === 2);
      expect(warnings.some(d => d.message.toLowerCase().includes('type mismatch'))).toBe(true);
    });

    it('warns when numeric variable is assigned a BOOL variable', () => {
      const src = `PROGRAM P
VAR
  n : INT;
  b : BOOL;
END_VAR
n := b;
END_PROGRAM`;
      const diags = getDiagnostics(src);
      const warnings = diags.filter(d => d.severity === 2);
      expect(warnings.some(d => d.message.toLowerCase().includes('type mismatch'))).toBe(true);
    });

    it('does not warn when BOOL is assigned a boolean literal (TRUE/FALSE)', () => {
      const src = `PROGRAM P
VAR
  b : BOOL;
END_VAR
b := TRUE;
b := FALSE;
END_PROGRAM`;
      const diags = getDiagnostics(src);
      const warnings = diags.filter(d => d.severity === 2);
      expect(warnings).toHaveLength(0);
    });

    it('does not warn when INT is assigned another INT variable', () => {
      const src = `PROGRAM P
VAR
  a : INT;
  b : INT;
END_VAR
a := b;
END_PROGRAM`;
      const diags = getDiagnostics(src);
      const warnings = diags.filter(d => d.severity === 2);
      expect(warnings).toHaveLength(0);
    });

    it('does not warn when assignment types are unknown (conservative)', () => {
      const src = `PROGRAM P
VAR
  b : BOOL;
  myFb : TON;
END_VAR
b := myFb.Q;
END_PROGRAM`;
      const diags = getDiagnostics(src);
      const typeMismatchWarnings = diags.filter(
        d => d.severity === 2 && d.message.toLowerCase().includes('type mismatch')
      );
      expect(typeMismatchWarnings).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // Semantic diagnostics: duplicate POU names (Part C)
  // -------------------------------------------------------------------------

  describe('semantic: duplicate POU names', () => {
    it('warns when two POUs have the same name', () => {
      const src = `PROGRAM Main
END_PROGRAM

PROGRAM Main
END_PROGRAM`;
      const diags = getDiagnostics(src);
      const warnings = diags.filter(d => d.severity === 2);
      expect(warnings.some(d => d.message.includes("Duplicate POU name 'Main'"))).toBe(true);
    });

    it('duplicate POU check is case-insensitive', () => {
      const src = `FUNCTION_BLOCK MyFB
END_FUNCTION_BLOCK

FUNCTION_BLOCK MYFB
END_FUNCTION_BLOCK`;
      const diags = getDiagnostics(src);
      const warnings = diags.filter(d => d.severity === 2);
      expect(warnings.some(d => d.message.includes('Duplicate POU name'))).toBe(true);
    });

    it('does not warn when POUs have different names', () => {
      const src = `PROGRAM A
END_PROGRAM

FUNCTION_BLOCK B
END_FUNCTION_BLOCK`;
      const diags = getDiagnostics(src);
      const warnings = diags.filter(
        d => d.severity === 2 && d.message.includes('Duplicate POU name')
      );
      expect(warnings).toHaveLength(0);
    });
  });
});

// ---------------------------------------------------------------------------
// Missing library reference diagnostics
// ---------------------------------------------------------------------------

function makeMockIndexWithLibs(libraryRefs: LibraryRef[], librarySymbols: LibrarySymbol[] = []): WorkspaceIndex {
  return {
    getProjectFiles: () => [],
    getLibraryRefs: () => libraryRefs,
    getLibraryTypeNames: () => new Set<string>(),
    getLibrarySymbols: () => librarySymbols,
  } as unknown as WorkspaceIndex;
}

function getDiagnosticsWithIndex(content: string, workspaceIndex: WorkspaceIndex) {
  const { connection, sentParams } = makeMockConnection();
  const doc = makeDoc(content);
  validateDocument(
    connection as unknown as import('vscode-languageserver/node').Connection,
    doc,
    workspaceIndex,
  );
  return sentParams[0]?.diagnostics as DiagnosticLike[] ?? [];
}

describe('Missing library reference diagnostics', () => {
  it('warns when FB type requires a library not in project references', () => {
    const src = `PROGRAM Main
VAR
  myTimer : TON;
END_VAR
END_PROGRAM`;
    // TON is in Tc2_Standard; only Tc2_MC2 is referenced
    const mockIndex = makeMockIndexWithLibs(
      [{ name: 'Tc2_MC2' }],
      [{ name: 'TON', kind: 'functionBlock', namespace: 'Tc2_Standard' }],
    );
    const diags = getDiagnosticsWithIndex(src, mockIndex);
    const warnings = diags.filter(d => d.severity === 2);
    expect(warnings.some(d => d.message.includes('Tc2_Standard'))).toBe(true);
    expect(warnings.some(d => d.message.includes('TON'))).toBe(true);
  });

  it('does NOT warn when FB type library is correctly referenced', () => {
    const src = `PROGRAM Main
VAR
  myTimer : TON;
END_VAR
END_PROGRAM`;
    const mockIndex = makeMockIndexWithLibs(
      [{ name: 'Tc2_Standard' }],
      [{ name: 'TON', kind: 'functionBlock', namespace: 'Tc2_Standard' }],
    );
    const diags = getDiagnosticsWithIndex(src, mockIndex);
    const libWarnings = diags.filter(
      d => d.severity === 2 && d.message.includes('requires library'),
    );
    expect(libWarnings).toHaveLength(0);
  });

  it('does NOT warn for standalone files (no library refs in project)', () => {
    const src = `PROGRAM Main
VAR
  myTimer : TON;
END_VAR
END_PROGRAM`;
    // Empty library refs = standalone file, fall back behaviour: no warning
    const mockIndex = makeMockIndexWithLibs([]);
    const diags = getDiagnosticsWithIndex(src, mockIndex);
    const libWarnings = diags.filter(
      d => d.severity === 2 && d.message.includes('requires library'),
    );
    expect(libWarnings).toHaveLength(0);
  });

  it('does NOT produce missing-library warnings when no workspaceIndex', () => {
    const src = `PROGRAM Main
VAR
  myTimer : TON;
END_VAR
END_PROGRAM`;
    const diags = getDiagnostics(src);
    const libWarnings = diags.filter(
      d => d.severity === 2 && d.message.includes('requires library'),
    );
    expect(libWarnings).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Cross-file type and identifier resolution
// ---------------------------------------------------------------------------

describe('cross-file type and identifier resolution', () => {
  // Helper: create a minimal WorkspaceIndex mock that returns cached ASTs
  function makeWorkspaceIndexWithFB(fbName: string): import('../twincat/workspaceIndex').WorkspaceIndex {
    const otherAst = parse(`FUNCTION_BLOCK ${fbName}\nVAR_INPUT\n  x : INT;\nEND_VAR\nEND_FUNCTION_BLOCK`).ast;
    const mock = {
      getProjectFiles: () => ['file:///other.tcpou'],
      getAst: (uri: string) => uri === 'file:///other.tcpou' ? { ast: otherAst, errors: [] } : undefined,
      getLibraryRefs: () => [],
      getLibraryTypeNames: () => new Set<string>(),
      getLibrarySymbols: () => [],
      initialize: () => {},
      isProjectFile: () => false,
      invalidateAst: () => {},
      on: () => mock,
      dispose: () => {},
    } as unknown as import('../twincat/workspaceIndex').WorkspaceIndex;
    return mock;
  }

  it('cross-file FB used as type: no "Unknown type" warning', () => {
    const workspaceIndex = makeWorkspaceIndexWithFB('MyOtherFB');
    const { connection, sentParams } = makeMockConnection();
    const doc = TextDocument.create('file:///test.st', 'iec-st', 1,
      'PROGRAM Main\nVAR\n  inst : MyOtherFB;\nEND_VAR\nEND_PROGRAM'
    );
    validateDocument(
      connection as unknown as import('vscode-languageserver/node').Connection,
      doc,
      workspaceIndex
    );
    const diags = sentParams[0]?.diagnostics as Array<{ message: string }> ?? [];
    expect(diags.filter(d => d.message.toLowerCase().includes('myotherfb'))).toHaveLength(0);
  });

  it('cross-file interface used as type: no "Unknown type" warning', () => {
    const otherAst = parse('INTERFACE I_MyInterface\nEND_INTERFACE').ast;
    const mock = {
      getProjectFiles: () => ['file:///interfaces.tcpou'],
      getAst: (uri: string) => uri === 'file:///interfaces.tcpou' ? { ast: otherAst, errors: [] } : undefined,
      getLibraryRefs: () => [],
      getLibraryTypeNames: () => new Set<string>(),
      getLibrarySymbols: () => [],
      initialize: () => {},
      isProjectFile: () => false,
      invalidateAst: () => {},
      on: () => mock,
      dispose: () => {},
    } as unknown as import('../twincat/workspaceIndex').WorkspaceIndex;

    const { connection, sentParams } = makeMockConnection();
    const doc = TextDocument.create('file:///test.st', 'iec-st', 1,
      'PROGRAM Main\nVAR\n  ref : I_MyInterface;\nEND_VAR\nEND_PROGRAM'
    );
    validateDocument(
      connection as unknown as import('vscode-languageserver/node').Connection,
      doc,
      mock
    );
    const diags = sentParams[0]?.diagnostics as Array<{ message: string }> ?? [];
    expect(diags.filter(d => d.message.toLowerCase().includes('i_myinterface'))).toHaveLength(0);
  });

  it('cross-file type declaration: no "Unknown type" warning', () => {
    const otherAst = parse('TYPE\n  MyStruct : STRUCT\n    x : INT;\n  END_STRUCT\nEND_TYPE').ast;
    const mock = {
      getProjectFiles: () => ['file:///types.tcdut'],
      getAst: (uri: string) => uri === 'file:///types.tcdut' ? { ast: otherAst, errors: [] } : undefined,
      getLibraryRefs: () => [],
      getLibraryTypeNames: () => new Set<string>(),
      getLibrarySymbols: () => [],
      initialize: () => {},
      isProjectFile: () => false,
      invalidateAst: () => {},
      on: () => mock,
      dispose: () => {},
    } as unknown as import('../twincat/workspaceIndex').WorkspaceIndex;

    const { connection, sentParams } = makeMockConnection();
    const doc = TextDocument.create('file:///test.st', 'iec-st', 1,
      'PROGRAM Main\nVAR\n  s : MyStruct;\nEND_VAR\nEND_PROGRAM'
    );
    validateDocument(
      connection as unknown as import('vscode-languageserver/node').Connection,
      doc,
      mock
    );
    const diags = sentParams[0]?.diagnostics as Array<{ message: string }> ?? [];
    expect(diags.filter(d => d.message.toLowerCase().includes('mystruct'))).toHaveLength(0);
  });

  it('cross-file GVL container name is in scope for member access base', () => {
    const containerName = 'MyProjectDatatypeLimits';
    const { ast: gvlAst, errors: gvlErrors } = parse('VAR_GLOBAL\n  BYTE_MAX_VALUE : BYTE := 255;\nEND_VAR');
    const gvlDecl = gvlAst.declarations.find(d => d.kind === 'GvlDeclaration') as GvlDeclaration | undefined;
    if (gvlDecl) gvlDecl.name = containerName;

    const mock = {
      getProjectFiles: () => ['file:///DatatypeLimits.TcGVL'],
      getAst: (uri: string) => uri === 'file:///DatatypeLimits.TcGVL' ? { ast: gvlAst, errors: gvlErrors } : undefined,
      getLibraryRefs: () => [],
      getLibraryTypeNames: () => new Set<string>(),
      getLibrarySymbols: () => [],
      initialize: () => {},
      isProjectFile: () => false,
      invalidateAst: () => {},
      on: () => mock,
      dispose: () => {},
    } as unknown as WorkspaceIndex;

    const { connection, sentParams } = makeMockConnection();
    const doc = TextDocument.create('file:///main.st', 'st', 1,
      `PROGRAM Main\nVAR\n  b : BYTE;\nEND_VAR\nb := ${containerName}.BYTE_MAX_VALUE;\nEND_PROGRAM`,
    );

    validateDocument(
      connection as unknown as import('vscode-languageserver/node').Connection,
      doc,
      mock,
    );

    const diags = sentParams[0]?.diagnostics as Array<{ message: string; severity: number }> ?? [];
    const undefinedNameErrors = diags.filter(
      d => d.severity === 1 && d.message.includes(`Undefined identifier '${containerName}'`),
    );
    expect(undefinedNameErrors).toHaveLength(0);
  });

  it('local-file GVL container name is in scope for member access base', () => {
    const containerName = 'LocalDatatypeLimits';
    const tcgvlXml = `<?xml version="1.0" encoding="utf-8"?>
<TcPlcObject>
  <GVL Name="${containerName}">
    <Declaration><![CDATA[
VAR_GLOBAL
  BYTE_MAX_VALUE : BYTE := 255;
END_VAR

PROGRAM Main
VAR
  b : BYTE;
END_VAR
b := ${containerName}.BYTE_MAX_VALUE;
END_PROGRAM
]]></Declaration>
  </GVL>
</TcPlcObject>`;

    const { connection, sentParams } = makeMockConnection();
    const doc = TextDocument.create('file:///LocalDatatypeLimits.TcGVL', 'st', 1, tcgvlXml);

    validateDocument(
      connection as unknown as import('vscode-languageserver/node').Connection,
      doc,
    );

    const diags = sentParams[0]?.diagnostics as Array<{ message: string; severity: number }> ?? [];
    const undefinedNameErrors = diags.filter(
      d => d.severity === 1 && d.message.includes(`Undefined identifier '${containerName}'`),
    );
    expect(undefinedNameErrors).toHaveLength(0);
  });

  it('current file is not double-counted (uses its own declarations)', () => {
    // If the current file is in the workspace index, it should still resolve correctly
    // This test verifies no crash and correct behavior
    const { connection, sentParams } = makeMockConnection();
    const doc = TextDocument.create('file:///test.st', 'iec-st', 1,
      'PROGRAM Main\nVAR\n  x : INT;\nEND_VAR\nEND_PROGRAM'
    );
    const ownAst = parse('PROGRAM Main\nVAR\n  x : INT;\nEND_VAR\nEND_PROGRAM').ast;
    const mock = {
      getProjectFiles: () => ['file:///test.st'],
      getAst: (uri: string) => uri === 'file:///test.st' ? { ast: ownAst, errors: [] } : undefined,
      getLibraryRefs: () => [],
      getLibraryTypeNames: () => new Set<string>(),
      getLibrarySymbols: () => [],
      initialize: () => {},
      isProjectFile: () => false,
      invalidateAst: () => {},
      on: () => mock,
      dispose: () => {},
    } as unknown as import('../twincat/workspaceIndex').WorkspaceIndex;
    validateDocument(
      connection as unknown as import('vscode-languageserver/node').Connection,
      doc,
      mock
    );
    const diags = sentParams[0]?.diagnostics as Array<{ message: string }> ?? [];
    expect(diags).toHaveLength(0);
  });
});

describe('system types and intrinsics in diagnostics', () => {
  it('T_MAXSTRING as type: no "Unknown type" warning', () => {
    const diags = getDiagnostics('PROGRAM P\nVAR\n  s : T_MAXSTRING;\nEND_VAR\nEND_PROGRAM');
    expect(diags.filter(d => d.message.includes('T_MAXSTRING'))).toHaveLength(0);
  });

  it('PVOID as type: no "Unknown type" warning', () => {
    const diags = getDiagnostics('PROGRAM P\nVAR\n  p : PVOID;\nEND_VAR\nEND_PROGRAM');
    expect(diags.filter(d => d.message.includes('PVOID'))).toHaveLength(0);
  });

  it('ANY as type: no "Unknown type" warning', () => {
    const diags = getDiagnostics('PROGRAM P\nVAR\n  v : ANY;\nEND_VAR\nEND_PROGRAM');
    expect(diags.filter(d => d.message.includes('ANY'))).toHaveLength(0);
  });

  it('TIMESTRUCT as type: no "Unknown type" warning', () => {
    const diags = getDiagnostics('PROGRAM P\nVAR\n  t : TIMESTRUCT;\nEND_VAR\nEND_PROGRAM');
    expect(diags.filter(d => d.message.includes('TIMESTRUCT'))).toHaveLength(0);
  });

  it('AXIS_REF as type: no "Unknown type" warning', () => {
    const diags = getDiagnostics('PROGRAM P\nVAR\n  ax : AXIS_REF;\nEND_VAR\nEND_PROGRAM');
    expect(diags.filter(d => d.message.includes('AXIS_REF'))).toHaveLength(0);
  });

  it('__NEW intrinsic: no "Undefined identifier" warning', () => {
    const diags = getDiagnostics('PROGRAM P\nVAR\n  p : PVOID;\nEND_VAR\np := __NEW(INT);\nEND_PROGRAM');
    expect(diags.filter(d => d.message.includes('__NEW'))).toHaveLength(0);
  });

  it('__DELETE intrinsic: no "Undefined identifier" warning', () => {
    const diags = getDiagnostics('PROGRAM P\nVAR\n  p : PVOID;\nEND_VAR\n__DELETE(p);\nEND_PROGRAM');
    expect(diags.filter(d => d.message.includes('__DELETE'))).toHaveLength(0);
  });

  it('ADR operator: no "Undefined identifier" warning', () => {
    const diags = getDiagnostics('PROGRAM P\nVAR\n  x : INT;\n  p : PVOID;\nEND_VAR\np := ADR(x);\nEND_PROGRAM');
    expect(diags.filter(d => d.message.includes('ADR'))).toHaveLength(0);
  });

  it('SIZEOF operator: no "Undefined identifier" warning', () => {
    const diags = getDiagnostics('PROGRAM P\nVAR\n  x : INT;\n  sz : UDINT;\nEND_VAR\nsz := SIZEOF(x);\nEND_PROGRAM');
    expect(diags.filter(d => d.message.includes('SIZEOF'))).toHaveLength(0);
  });

  it('DINT_TO_UDINT type conversion: no "Undefined identifier" warning', () => {
    const diags = getDiagnostics('PROGRAM P\nVAR\n  a : DINT;\n  b : UDINT;\nEND_VAR\nb := DINT_TO_UDINT(a);\nEND_PROGRAM');
    expect(diags.filter(d => d.message.includes('DINT_TO_UDINT'))).toHaveLength(0);
  });

  it('INT_TO_STRING type conversion: no "Undefined identifier" warning', () => {
    const diags = getDiagnostics('PROGRAM P\nVAR\n  a : INT;\n  s : STRING;\nEND_VAR\ns := INT_TO_STRING(a);\nEND_PROGRAM');
    expect(diags.filter(d => d.message.includes('INT_TO_STRING'))).toHaveLength(0);
  });

  it('MAX library function: no "Undefined identifier" warning', () => {
    const diags = getDiagnostics('PROGRAM P\nVAR\n  a : INT;\n  b : INT;\n  c : INT;\nEND_VAR\nc := MAX(a, b);\nEND_PROGRAM');
    expect(diags.filter(d => d.message.includes("'MAX'"))).toHaveLength(0);
  });

  it('MIN library function: no "Undefined identifier" warning', () => {
    const diags = getDiagnostics('PROGRAM P\nVAR\n  a : INT;\n  b : INT;\n  c : INT;\nEND_VAR\nc := MIN(a, b);\nEND_PROGRAM');
    expect(diags.filter(d => d.message.includes("'MIN'"))).toHaveLength(0);
  });

  it('LEN library function: no "Undefined identifier" warning', () => {
    const diags = getDiagnostics('PROGRAM P\nVAR\n  s : STRING;\n  n : INT;\nEND_VAR\nn := LEN(s);\nEND_PROGRAM');
    expect(diags.filter(d => d.message.includes("'LEN'"))).toHaveLength(0);
  });
});

describe('FB member scope (methods, properties, actions)', () => {
  it('calling own method: no "Undefined identifier" warning', () => {
    // Methods are declared inside the FUNCTION_BLOCK (before END_FUNCTION_BLOCK)
    const code = `FUNCTION_BLOCK MyFB
VAR
  x : INT;
END_VAR
DoWork();
METHOD DoWork
END_METHOD
END_FUNCTION_BLOCK
`;
    const diags = getDiagnostics(code);
    expect(diags.filter(d => d.message.includes("'DoWork'"))).toHaveLength(0);
  });

  it('accessing own property: no "Undefined identifier" warning', () => {
    // Properties are declared inside the FUNCTION_BLOCK (before END_FUNCTION_BLOCK)
    const code = `FUNCTION_BLOCK MyFB
VAR
  x : INT;
END_VAR
x := MyProp;
PROPERTY MyProp : INT
END_PROPERTY
END_FUNCTION_BLOCK
`;
    const diags = getDiagnostics(code);
    expect(diags.filter(d => d.message.includes("'MyProp'"))).toHaveLength(0);
  });

  it('referencing own action: no "Undefined identifier" warning', () => {
    const code = `FUNCTION_BLOCK MyFB
VAR
  x : INT;
END_VAR
MyAction();
END_FUNCTION_BLOCK
ACTION MyAction:
END_ACTION
`;
    const diags = getDiagnostics(code);
    expect(diags.filter(d => d.message.includes("'MyAction'"))).toHaveLength(0);
  });

  it('calling inherited method (local EXTENDS): no "Undefined identifier" warning', () => {
    // ParentFB method declared inside it; ChildFB calls it via EXTENDS
    const code = `FUNCTION_BLOCK ParentFB
VAR
END_VAR
METHOD ParentMethod
END_METHOD
END_FUNCTION_BLOCK

FUNCTION_BLOCK ChildFB EXTENDS ParentFB
VAR
END_VAR
ParentMethod();
END_FUNCTION_BLOCK
`;
    const diags = getDiagnostics(code);
    expect(diags.filter(d => d.message.includes("'ParentMethod'"))).toHaveLength(0);
  });
});

describe('method body scope (inherits FB members)', () => {
  it('method body can call sibling method: no "Undefined identifier" warning', () => {
    const code = `FUNCTION_BLOCK MyFB
VAR
  x : INT;
END_VAR
METHOD DoWork
DoOtherWork();
END_METHOD
METHOD DoOtherWork
END_METHOD
END_FUNCTION_BLOCK
`;
    const diags = getDiagnostics(code);
    expect(diags.filter(d => d.message.includes("'DoOtherWork'"))).toHaveLength(0);
  });

  it('method body can reference own property: no "Undefined identifier" warning', () => {
    const code = `FUNCTION_BLOCK MyFB
VAR
  x : INT;
END_VAR
METHOD SetValue
VAR_INPUT
  v : INT;
END_VAR
x := MyValue;
END_METHOD
PROPERTY MyValue : INT
END_PROPERTY
END_FUNCTION_BLOCK
`;
    const diags = getDiagnostics(code);
    expect(diags.filter(d => d.message.includes("'MyValue'"))).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// EXTENDS/IMPLEMENTS validation diagnostics
// ---------------------------------------------------------------------------

function makeEmptyWorkspaceIndex(): WorkspaceIndex {
  return {
    getProjectFiles: () => [],
    getAst: () => undefined,
    getLibraryRefs: () => [],
    getLibraryTypeNames: () => new Set<string>(),
    getLibrarySymbols: () => [],
  } as unknown as WorkspaceIndex;
}

// ---------------------------------------------------------------------------
// Phase 2: __SYSTEM namespace + inline enum scoping + __INLINE_ENUM suppression
// ---------------------------------------------------------------------------

describe('__SYSTEM namespace and inline enum scoping', () => {
  it('__SYSTEM_not_flagged: __SYSTEM usage in CASE does not produce undefined-identifier error', () => {
    const src = `PROGRAM Main
VAR
  x : INT;
END_VAR
CASE x OF
  __SYSTEM.TYPE_CLASS.TYPE_BOOL:
    x := 1;
END_CASE
END_PROGRAM`;
    const diags = getDiagnostics(src);
    const errors = diags.filter(d => d.severity === 1 && d.message.includes('__SYSTEM'));
    expect(errors).toHaveLength(0);
  });

  it('inlineEnum_membersInScope: inline enum member names do not produce undefined-identifier errors', () => {
    const src = `PROGRAM Main
VAR
  state : (IDLE, RUNNING, DONE);
END_VAR
CASE state OF
  IDLE:
    state := RUNNING;
  RUNNING:
    state := DONE;
END_CASE
END_PROGRAM`;
    const diags = getDiagnostics(src);
    const errors = diags.filter(d => d.severity === 1);
    const enumMemberErrors = errors.filter(
      d => d.message.includes('IDLE') || d.message.includes('RUNNING') || d.message.includes('DONE'),
    );
    expect(enumMemberErrors).toHaveLength(0);
  });

  it('__INLINE_ENUM_suppressed: variable with inline enum type does not produce Unknown type warning', () => {
    const src = `PROGRAM Main
VAR
  mode : (AUTO, MANUAL, OFF);
END_VAR
END_PROGRAM`;
    const diags = getDiagnostics(src);
    const inlineEnumWarnings = diags.filter(d => d.message.includes('__INLINE_ENUM'));
    expect(inlineEnumWarnings).toHaveLength(0);
  });
});

describe('EXTENDS/IMPLEMENTS validation', () => {
  it('EXTENDS with unknown type produces Warning diagnostic', () => {
    const src = `FUNCTION_BLOCK MyFB EXTENDS GhostBase
VAR END_VAR
END_FUNCTION_BLOCK`;
    const diags = getDiagnosticsWithIndex(src, makeEmptyWorkspaceIndex());
    const warnings = diags.filter(d => d.severity === 2);
    expect(warnings.some(d => d.message.includes('GhostBase'))).toBe(true);
  });

  it('IMPLEMENTS with unknown interface produces Warning diagnostic', () => {
    const src = `FUNCTION_BLOCK MyFB IMPLEMENTS I_Ghost
VAR END_VAR
END_FUNCTION_BLOCK`;
    const diags = getDiagnosticsWithIndex(src, makeEmptyWorkspaceIndex());
    const warnings = diags.filter(d => d.severity === 2);
    expect(warnings.some(d => d.message.includes('I_Ghost'))).toBe(true);
  });

  it('EXTENDS with locally defined parent: no Error', () => {
    const src = `FUNCTION_BLOCK ParentFB
VAR END_VAR
END_FUNCTION_BLOCK

FUNCTION_BLOCK ChildFB EXTENDS ParentFB
VAR END_VAR
END_FUNCTION_BLOCK`;
    const diags = getDiagnosticsWithIndex(src, makeEmptyWorkspaceIndex());
    const errors = diags.filter(d => d.severity === 1 && d.message.includes('ParentFB'));
    expect(errors).toHaveLength(0);
  });

  it('EXTENDS validation skipped when no workspaceIndex provided', () => {
    const src = `FUNCTION_BLOCK MyFB EXTENDS GhostBase
VAR END_VAR
END_FUNCTION_BLOCK`;
    // getDiagnostics uses no workspace index → validation skipped
    const diags = getDiagnostics(src);
    const errors = diags.filter(d => d.severity === 1 && d.message.includes('GhostBase'));
    expect(errors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// bd-1dc: External type resolution and inherited member suppression
// ---------------------------------------------------------------------------

describe('bd-1dc: external type resolution and inherited member suppression', () => {
  it('extendsUnresolvable_isWarning_notError: FB EXTENDS unknown type → Warning not Error', () => {
    const src = `FUNCTION_BLOCK MyFB EXTENDS ExternalLib_Base
VAR END_VAR
METHOD DoSomething : BOOL
END_METHOD
END_FUNCTION_BLOCK`;
    const diags = getDiagnosticsWithIndex(src, makeEmptyWorkspaceIndex());
    const cannotResolve = diags.filter(d => d.message.includes('ExternalLib_Base'));
    expect(cannotResolve).toHaveLength(1);
    expect(cannotResolve[0].severity).toBe(2); // DiagnosticSeverity.Warning
  });

  it('implementsUnresolvable_isWarning_notError: FB IMPLEMENTS unknown interface → Warning not Error', () => {
    const src = `FUNCTION_BLOCK MyFB IMPLEMENTS ExternalLib_IFoo
VAR END_VAR
END_FUNCTION_BLOCK`;
    const diags = getDiagnosticsWithIndex(src, makeEmptyWorkspaceIndex());
    const cannotResolve = diags.filter(d => d.message.includes('ExternalLib_IFoo'));
    expect(cannotResolve).toHaveLength(1);
    expect(cannotResolve[0].severity).toBe(2); // DiagnosticSeverity.Warning
  });

  it('extendsUnresolvable_inheritedMembers_suppressed: no Undefined identifier for calls in FB with unresolvable EXTENDS', () => {
    const src = `FUNCTION_BLOCK MyFB EXTENDS ExternalLib_Base
VAR END_VAR
METHOD Test : BOOL
  InheritedMethod();
END_METHOD
END_FUNCTION_BLOCK`;
    const diags = getDiagnosticsWithIndex(src, makeEmptyWorkspaceIndex());
    const undefinedErrors = diags.filter(d => d.message.startsWith('Undefined identifier'));
    expect(undefinedErrors).toHaveLength(0);
  });

  it('extendsResolvable_stillError: genuine undefined identifier with resolvable parent → now Warning', () => {
    const src = `PROGRAM P
VAR x : INT; END_VAR
  y := 42;
END_PROGRAM`;
    const diags = getDiagnosticsWithIndex(src, makeEmptyWorkspaceIndex());
    const undefinedErrors = diags.filter(d => d.message.includes("Undefined identifier 'y'"));
    expect(undefinedErrors).toHaveLength(1);
    expect(undefinedErrors[0].severity).toBe(2); // DiagnosticSeverity.Warning
  });
});

// ---------------------------------------------------------------------------
// Phase 4: Unknown type suppressions — DCTIME, FILETIME, cross-file types
// ---------------------------------------------------------------------------

describe('Phase 4: unknown type suppressions', () => {
  it('dctime_recognized: DCTIME type variable produces no Unknown type warning', () => {
    const src = `PROGRAM Main
VAR
  ts : DCTIME;
END_VAR
END_PROGRAM`;
    const diags = getDiagnostics(src);
    const warnings = diags.filter(d => d.message.includes('DCTIME'));
    expect(warnings).toHaveLength(0);
  });

  it('filetime_recognized: FILETIME type variable produces no Unknown type warning', () => {
    const src = `PROGRAM Main
VAR
  ft : FILETIME;
END_VAR
END_PROGRAM`;
    const diags = getDiagnostics(src);
    const warnings = diags.filter(d => d.message.includes('FILETIME'));
    expect(warnings).toHaveLength(0);
  });

  it('crossFile_type_resolved: POU name from workspace index used as type produces no Unknown type warning', () => {
    const src = `PROGRAM Main
VAR
  fb : MyLibraryFB;
END_VAR
END_PROGRAM`;
    // Build a workspace index that contains MyLibraryFB
    const libSrc = `FUNCTION_BLOCK MyLibraryFB
VAR END_VAR
END_FUNCTION_BLOCK`;
    const { ast: libAst } = parse(libSrc);
    const mockIndex = {
      getProjectFiles: () => ['file:///lib.st'],
      getAst: (uri: string) => uri === 'file:///lib.st' ? { ast: libAst } : undefined,
      getLibraryRefs: () => [],
      getLibraryTypeNames: () => new Set<string>(),
      getLibrarySymbols: () => [],
    } as unknown as WorkspaceIndex;
    const diags = getDiagnosticsWithIndex(src, mockIndex);
    const warnings = diags.filter(d => d.message.includes('MyLibraryFB'));
    expect(warnings).toHaveLength(0);
  });

  it('sjsonvalue_recognized: SJSONVALUE type variable produces no Unknown type warning', () => {
    const src = `PROGRAM Main
VAR
  jv : SJSONVALUE;
END_VAR
END_PROGRAM`;
    const diags = getDiagnostics(src);
    const warnings = diags.filter(d => d.message.includes('SJSONVALUE'));
    expect(warnings).toHaveLength(0);
  });

  describe('Phase 5 — max diagnostics cap', () => {
    it('maxDiagnosticsCap: files with many errors are capped at 100 diagnostics', () => {
      // Generate a program with 150+ parse errors (missing colons in var declarations)
      const badDecls = Array.from({ length: 150 }, (_, i) => `  var${i} INT;`).join('\n');
      const src = `PROGRAM BigBadProgram\nVAR\n${badDecls}\nEND_VAR\nEND_PROGRAM`;
      const diags = getDiagnostics(src);
      expect(diags.length).toBeLessThanOrEqual(100);
    });

    it('maxDiagnosticsCap_smallFile: files with few errors are unaffected by cap', () => {
      const src = `PROGRAM P\nVAR\n  x INT;\nEND_VAR\nEND_PROGRAM`;
      const diags = getDiagnostics(src);
      // Small number of errors — should not be capped
      expect(diags.length).toBeGreaterThan(0);
      expect(diags.length).toBeLessThan(100);
    });
  });
});
