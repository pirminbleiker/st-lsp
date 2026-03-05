import { describe, it, expect } from 'vitest';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { validateDocument } from '../handlers/diagnostics';

function makeDoc(content: string): TextDocument {
	return TextDocument.create('file:///test.st', 'st', 1, content);
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

type DiagnosticLike = { message: string; severity: number; code?: string };

function getDiagnostics(content: string): DiagnosticLike[] {
	const { connection, sentParams } = makeMockConnection();
	const doc = makeDoc(content);
	validateDocument(connection as unknown as import('vscode-languageserver/node').Connection, doc);
	return sentParams[0]?.diagnostics as DiagnosticLike[] ?? [];
}

describe('Semicolon Diagnostics', () => {
	// ---------------------------------------------------------------------------
	// Task #3: Double/unnecessary semicolons in code
	// ---------------------------------------------------------------------------

	describe('Task #3: Unnecessary semicolons (double semicolons ;;)', () => {
		it('detects double semicolon after assignment', () => {
			const code = `
PROGRAM Main
VAR
  x : INT;
END_VAR
  x := 5;;
END_PROGRAM
`;
			const diags = getDiagnostics(code);
			const unnecessarySemicolons = diags.filter(d => d.code === 'unnecessary-semicolon' && d.severity === 2); // Warning
			expect(unnecessarySemicolons.length).toBeGreaterThan(0);
			expect(unnecessarySemicolons.some(d => d.message.includes('Unnecessary'))).toBe(true);
		});

		it('detects double semicolon after IF statement', () => {
			const code = `
PROGRAM Main
VAR
  x : INT;
END_VAR
  IF x > 5 THEN
    x := 10;
  END_IF;;
END_PROGRAM
`;
			const diags = getDiagnostics(code);
			const unnecessarySemicolons = diags.filter(d => d.code === 'unnecessary-semicolon');
			expect(unnecessarySemicolons.length).toBeGreaterThan(0);
		});

		it('detects standalone leading semicolon in statement body', () => {
			const code = `
PROGRAM Main
VAR
  x : INT;
END_VAR
  ;
  x := 5;
END_PROGRAM
`;
			const diags = getDiagnostics(code);
			const unnecessarySemicolons = diags.filter(d => d.code === 'unnecessary-semicolon');
			expect(unnecessarySemicolons.length).toBeGreaterThan(0);
		});

		it('allows single semicolon after statement', () => {
			const code = `
PROGRAM Main
VAR
  x : INT;
END_VAR
  x := 5;
END_PROGRAM
`;
			const diags = getDiagnostics(code);
			const unnecessarySemicolons = diags.filter(d => d.code === 'unnecessary-semicolon');
			expect(unnecessarySemicolons.length).toBe(0);
		});

		it('detects multiple consecutive empty statements', () => {
			const code = `
PROGRAM Main
VAR
  x : INT;
END_VAR
  x := 5;;;
END_PROGRAM
`;
			const diags = getDiagnostics(code);
			const unnecessarySemicolons = diags.filter(d => d.code === 'unnecessary-semicolon');
			// Should have at least 2 unnecessary semicolons
			expect(unnecessarySemicolons.length).toBeGreaterThanOrEqual(2);
		});

		it('detects unnecessary semicolons in FOR loop body', () => {
			const code = `
PROGRAM Main
VAR
  x : INT;
  i : INT;
END_VAR
  FOR i := 1 TO 10 DO
    x := i;;
  END_FOR;
END_PROGRAM
`;
			const diags = getDiagnostics(code);
			const unnecessarySemicolons = diags.filter(d => d.code === 'unnecessary-semicolon');
			expect(unnecessarySemicolons.length).toBeGreaterThan(0);
		});

		it('detects unnecessary semicolons in WHILE loop body', () => {
			const code = `
PROGRAM Main
VAR
  x : INT;
END_VAR
  WHILE x < 10 DO
    x := x + 1;;
  END_WHILE;
END_PROGRAM
`;
			const diags = getDiagnostics(code);
			const unnecessarySemicolons = diags.filter(d => d.code === 'unnecessary-semicolon');
			expect(unnecessarySemicolons.length).toBeGreaterThan(0);
		});

		it('detects unnecessary semicolons in CASE statement', () => {
			const code = `
PROGRAM Main
VAR
  x : INT;
END_VAR
  CASE x OF
    1:
      x := 10;;
    2:
      x := 20;
  END_CASE;
END_PROGRAM
`;
			const diags = getDiagnostics(code);
			const unnecessarySemicolons = diags.filter(d => d.code === 'unnecessary-semicolon');
			expect(unnecessarySemicolons.length).toBeGreaterThan(0);
		});

		it('detects unnecessary semicolons in method body (FB)', () => {
			const code = `
FUNCTION_BLOCK MyFB
VAR
  x : INT;
END_VAR
METHOD DoSomething
  x := 5;;
END_METHOD
END_FUNCTION_BLOCK
`;
			const diags = getDiagnostics(code);
			const unnecessarySemicolons = diags.filter(d => d.code === 'unnecessary-semicolon');
			expect(unnecessarySemicolons.length).toBeGreaterThan(0);
		});


		it('detects unnecessary semicolons in nested IF statements', () => {
			const code = `
PROGRAM Main
VAR
  x : INT;
  y : INT;
END_VAR
  IF x > 0 THEN
    IF y > 0 THEN
      x := 10;;
    END_IF;
  END_IF;
END_PROGRAM
`;
			const diags = getDiagnostics(code);
			const unnecessarySemicolons = diags.filter(d => d.code === 'unnecessary-semicolon');
			expect(unnecessarySemicolons.length).toBeGreaterThan(0);
		});
	});

	// ---------------------------------------------------------------------------
	// Task #2: Trailing semicolons in VAR blocks
	// ---------------------------------------------------------------------------

	describe('Task #2: Trailing semicolons in VAR blocks', () => {
		it('detects trailing semicolon in VAR block', () => {
			const code = `
PROGRAM Main
VAR
  x : INT;
  ;
END_VAR
END_PROGRAM
`;
			const diags = getDiagnostics(code);
			const unnecessarySemicolons = diags.filter(d => d.code === 'unnecessary-semicolon');
			expect(unnecessarySemicolons.length).toBeGreaterThan(0);
			expect(unnecessarySemicolons.some(d => d.message.includes('Unnecessary'))).toBe(true);
		});

		it('detects multiple trailing semicolons in VAR block', () => {
			const code = `
PROGRAM Main
VAR
  x : INT;
  ;;
END_VAR
END_PROGRAM
`;
			const diags = getDiagnostics(code);
			const unnecessarySemicolons = diags.filter(d => d.code === 'unnecessary-semicolon');
			expect(unnecessarySemicolons.length).toBeGreaterThanOrEqual(2);
		});

		it('allows normal VAR declaration without trailing semicolon', () => {
			const code = `
PROGRAM Main
VAR
  x : INT;
  y : REAL
END_VAR
END_PROGRAM
`;
			const diags = getDiagnostics(code);
			// This should have a parse error for missing semicolon after y
			// but not an unnecessary semicolon warning
			const unnecessarySemicolons = diags.filter(d => d.code === 'unnecessary-semicolon');
			expect(unnecessarySemicolons.length).toBe(0);
		});

		it('detects trailing semicolon in CONSTANT VAR block', () => {
			const code = `
PROGRAM Main
VAR CONSTANT
  x : INT := 5;
  ;
END_VAR
END_PROGRAM
`;
			const diags = getDiagnostics(code);
			const unnecessarySemicolons = diags.filter(d => d.code === 'unnecessary-semicolon');
			expect(unnecessarySemicolons.length).toBeGreaterThan(0);
		});

		it('detects trailing semicolon in RETAIN VAR block', () => {
			const code = `
FUNCTION_BLOCK MyFB
VAR RETAIN
  x : INT;
  ;
END_VAR
END_FUNCTION_BLOCK
`;
			const diags = getDiagnostics(code);
			const unnecessarySemicolons = diags.filter(d => d.code === 'unnecessary-semicolon');
			expect(unnecessarySemicolons.length).toBeGreaterThan(0);
		});

		it('detects trailing semicolon in VAR_INPUT block', () => {
			const code = `
FUNCTION_BLOCK MyFB
VAR_INPUT
  x : INT;
  ;
END_VAR
END_FUNCTION_BLOCK
`;
			const diags = getDiagnostics(code);
			const unnecessarySemicolons = diags.filter(d => d.code === 'unnecessary-semicolon');
			expect(unnecessarySemicolons.length).toBeGreaterThan(0);
		});

		it('detects trailing semicolon in VAR_OUTPUT block', () => {
			const code = `
FUNCTION_BLOCK MyFB
VAR_OUTPUT
  y : INT;
  ;
END_VAR
END_FUNCTION_BLOCK
`;
			const diags = getDiagnostics(code);
			const unnecessarySemicolons = diags.filter(d => d.code === 'unnecessary-semicolon');
			expect(unnecessarySemicolons.length).toBeGreaterThan(0);
		});

		it('detects trailing semicolon in VAR_IN_OUT block', () => {
			const code = `
FUNCTION_BLOCK MyFB
VAR_IN_OUT
  xy : INT;
  ;
END_VAR
END_FUNCTION_BLOCK
`;
			const diags = getDiagnostics(code);
			const unnecessarySemicolons = diags.filter(d => d.code === 'unnecessary-semicolon');
			expect(unnecessarySemicolons.length).toBeGreaterThan(0);
		});

		it('detects trailing semicolon in VAR_STAT block', () => {
			const code = `
PROGRAM Main
VAR_STAT
  x : INT;
  ;
END_VAR
END_PROGRAM
`;
			const diags = getDiagnostics(code);
			const unnecessarySemicolons = diags.filter(d => d.code === 'unnecessary-semicolon');
			expect(unnecessarySemicolons.length).toBeGreaterThan(0);
		});

		it('detects trailing semicolon in VAR_TEMP block', () => {
			const code = `
FUNCTION MyFunc : INT
VAR_TEMP
  x : INT;
  ;
END_VAR
  RETURN 0;
END_FUNCTION
`;
			const diags = getDiagnostics(code);
			const unnecessarySemicolons = diags.filter(d => d.code === 'unnecessary-semicolon');
			expect(unnecessarySemicolons.length).toBeGreaterThan(0);
		});

		it('detects trailing semicolon in VAR_EXTERNAL block', () => {
			const code = `
PROGRAM Main
VAR_EXTERNAL
  extVar : INT;
  ;
END_VAR
END_PROGRAM
`;
			const diags = getDiagnostics(code);
			const unnecessarySemicolons = diags.filter(d => d.code === 'unnecessary-semicolon');
			expect(unnecessarySemicolons.length).toBeGreaterThan(0);
		});
	});

	// ---------------------------------------------------------------------------
	// Severity checks
	// ---------------------------------------------------------------------------

	describe('Semicolon diagnostics severity', () => {
		it('reports unnecessary semicolons as warnings, not errors', () => {
			const code = `
PROGRAM Main
VAR
  x : INT;
END_VAR
  x := 5;;
END_PROGRAM
`;
			const diags = getDiagnostics(code);
			const unnecessarySemicolons = diags.filter(d => d.code === 'unnecessary-semicolon');
			expect(unnecessarySemicolons.length).toBeGreaterThan(0);
			// Severity 2 = Warning, Severity 1 = Error
			expect(unnecessarySemicolons.every(d => d.severity === 2)).toBe(true);
		});

		it('does not suppress other diagnostics when warning about semicolons', () => {
			const code = `
PROGRAM Main
VAR
  x : INT;
END_VAR
  undefinedVar := 5;;
END_PROGRAM
`;
			const diags = getDiagnostics(code);
			// Should have both undefined variable warning and unnecessary semicolon warning
			const semicolonWarnings = diags.filter(d => d.code === 'unnecessary-semicolon');
			const undefinedWarnings = diags.filter(d => d.message.includes('Undefined') || d.message.includes('undefined'));
			expect(semicolonWarnings.length).toBeGreaterThan(0);
			expect(undefinedWarnings.length).toBeGreaterThan(0);
		});
	});

	// ---------------------------------------------------------------------------
	// Edge cases
	// ---------------------------------------------------------------------------

	describe('Semicolon diagnostics edge cases', () => {
		it('handles empty statement at end of REPEAT...UNTIL', () => {
			const code = `
PROGRAM Main
VAR
  x : INT;
END_VAR
  REPEAT
    x := x + 1;
  UNTIL x > 10
  END_REPEAT;
END_PROGRAM
`;
			const diags = getDiagnostics(code);
			// Should not crash
			expect(diags).toBeDefined();
		});

		it('handles function without body errors', () => {
			const code = `
FUNCTION MyFunc : INT
VAR
  x : INT;
END_VAR
  RETURN 0;
END_FUNCTION
`;
			const diags = getDiagnostics(code);
			const unnecessarySemicolons = diags.filter(d => d.code === 'unnecessary-semicolon');
			expect(unnecessarySemicolons.length).toBe(0);
		});

		it('ignores semicolon in comments', () => {
			const code = `
PROGRAM Main
VAR
  x : INT;
END_VAR
  // This is a comment with ;;
  x := 5;
END_PROGRAM
`;
			const diags = getDiagnostics(code);
			const unnecessarySemicolons = diags.filter(d => d.code === 'unnecessary-semicolon');
			// Comments are stripped before parsing, so this should not trigger warning
			expect(unnecessarySemicolons.length).toBe(0);
		});

		it('handles multiple VAR blocks', () => {
			const code = `
FUNCTION_BLOCK MyFB
VAR
  x : INT;
  ;
END_VAR
VAR_INPUT
  y : INT;
  ;
END_VAR
END_FUNCTION_BLOCK
`;
			const diags = getDiagnostics(code);
			const unnecessarySemicolons = diags.filter(d => d.code === 'unnecessary-semicolon');
			// Should detect both trailing semicolons
			expect(unnecessarySemicolons.length).toBeGreaterThanOrEqual(2);
		});
	});
});
