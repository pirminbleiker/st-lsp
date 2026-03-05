import { describe, it, expect } from 'vitest';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { validateDocument } from '../handlers/diagnostics';
import type { Diagnostic } from 'vscode-languageserver/node';

function makeDoc(content: string): TextDocument {
	return TextDocument.create('file:///test.st', 'st', 1, content);
}

function makeMockConnection() {
	const sentParams: Array<{ uri: string; diagnostics: Diagnostic[] }> = [];
	const connection = {
		sendDiagnostics: (params: { uri: string; diagnostics: Diagnostic[] }) => {
			sentParams.push(params);
		},
	};
	return { connection, sentParams };
}

function getDiagnostics(content: string): Diagnostic[] {
	const { connection, sentParams } = makeMockConnection();
	const doc = makeDoc(content);
	validateDocument(connection as unknown as import('vscode-languageserver/node').Connection, doc);
	return sentParams[0]?.diagnostics ?? [];
}

describe('Variable Initialization Validation', () => {
	it('should pass for simple literal initialization', () => {
		const code = `
			PROGRAM Test
			VAR
				x : INT := 5;
				y : BOOL := TRUE;
				z : STRING := 'hello';
			END_VAR
			END_PROGRAM
		`;
		const diagnostics = getDiagnostics(code);
		const initErrors = diagnostics.filter(d => d.message.includes('initialize'));
		expect(initErrors).toHaveLength(0);
	});

	it('should warn for undefined identifier in initializer', () => {
		const code = `
			PROGRAM Test
			VAR
				x : INT := undefined_var;
			END_VAR
			END_PROGRAM
		`;
		const diagnostics = getDiagnostics(code);
		const undefinedErrors = diagnostics.filter(d => d.message.includes('Undefined'));
		expect(undefinedErrors.length).toBeGreaterThan(0);
		expect(undefinedErrors[0].message).toContain('undefined_var');
	});

	it('should warn for type mismatch: numeric to BOOL', () => {
		const code = `
			PROGRAM Test
			VAR
				x : BOOL := 5;
			END_VAR
			END_PROGRAM
		`;
		const diagnostics = getDiagnostics(code);
		const typeErrors = diagnostics.filter(d => d.message.includes('Type mismatch'));
		expect(typeErrors.length).toBeGreaterThan(0);
		expect(typeErrors[0].message).toContain('cannot initialize BOOL');
	});

	it('should warn for type mismatch: BOOL to numeric', () => {
		const code = `
			PROGRAM Test
			VAR
				x : INT := TRUE;
			END_VAR
			END_PROGRAM
		`;
		const diagnostics = getDiagnostics(code);
		const typeErrors = diagnostics.filter(d => d.message.includes('Type mismatch'));
		expect(typeErrors.length).toBeGreaterThan(0);
		expect(typeErrors[0].message).toContain('cannot initialize numeric');
	});

	it('should warn for type mismatch: STRING to numeric', () => {
		const code = `
			PROGRAM Test
			VAR
				x : INT := 'string';
			END_VAR
			END_PROGRAM
		`;
		const diagnostics = getDiagnostics(code);
		const typeErrors = diagnostics.filter(d => d.message.includes('Type mismatch'));
		expect(typeErrors.length).toBeGreaterThan(0);
		expect(typeErrors[0].message).toContain('cannot initialize numeric');
	});

	it('should allow expression initialization with numeric literals', () => {
		const code = `
			PROGRAM Test
			VAR
				x : INT := 5 + 3;
				y : INT := 10 * 2;
			END_VAR
			END_PROGRAM
		`;
		const diagnostics = getDiagnostics(code);
		const typeErrors = diagnostics.filter(d => d.message.includes('Type mismatch'));
		expect(typeErrors).toHaveLength(0);
	});

	it('should allow reference to previously declared variable', () => {
		const code = `
			PROGRAM Test
			VAR
				x : INT := 5;
				y : INT := x + 1;
			END_VAR
			END_PROGRAM
		`;
		const diagnostics = getDiagnostics(code);
		const undefinedErrors = diagnostics.filter(d => d.message.includes('Undefined'));
		expect(undefinedErrors).toHaveLength(0);
	});

	it('should warn for forward reference to later declared variable', () => {
		const code = `
			PROGRAM Test
			VAR
				x : INT := y + 1;
				y : INT := 5;
			END_VAR
			END_PROGRAM
		`;
		const diagnostics = getDiagnostics(code);
		const undefinedErrors = diagnostics.filter(d => d.message.includes('Undefined'));
		expect(undefinedErrors.length).toBeGreaterThan(0);
		expect(undefinedErrors[0].message).toContain('y');
	});

	it('should allow reference across VAR blocks', () => {
		const code = `
			PROGRAM Test
			VAR
				x : INT := 5;
			END_VAR
			VAR
				y : INT := x + 1;
			END_VAR
			END_PROGRAM
		`;
		const diagnostics = getDiagnostics(code);
		const undefinedErrors = diagnostics.filter(d => d.message.includes('Undefined'));
		expect(undefinedErrors).toHaveLength(0);
	});

	it('should warn for undefined function in initializer', () => {
		const code = `
			PROGRAM Test
			VAR
				x : INT := undefined_func(5);
			END_VAR
			END_PROGRAM
		`;
		const diagnostics = getDiagnostics(code);
		const undefinedErrors = diagnostics.filter(d => d.message.includes('Undefined'));
		expect(undefinedErrors.length).toBeGreaterThan(0);
	});

	it('should allow reference to built-in functions in initializer', () => {
		const code = `
			PROGRAM Test
			VAR
				x : INT := ABS(-5);
				y : REAL := MAX(1.0, 2.0);
			END_VAR
			END_PROGRAM
		`;
		const diagnostics = getDiagnostics(code);
		const undefinedErrors = diagnostics.filter(d => d.message.includes('Undefined'));
		expect(undefinedErrors).toHaveLength(0);
	});

	it('should allow built-in constants in initializer', () => {
		const code = `
			PROGRAM Test
			VAR
				x : BOOL := TRUE;
				y : BOOL := FALSE;
				z : INT := NULL;
			END_VAR
			END_PROGRAM
		`;
		const diagnostics = getDiagnostics(code);
		const undefinedErrors = diagnostics.filter(d => d.message.includes('Undefined'));
		expect(undefinedErrors).toHaveLength(0);
	});

	it('should validate initializer in method VAR blocks', () => {
		const code = `
			FUNCTION_BLOCK MyFB
			VAR
				fb_var : INT := 10;
			END_VAR
			METHOD MyMethod
			VAR
				local_var : INT := fb_var + 1;
				another_var : INT := undefined_name;
			END_VAR
			END_METHOD
			END_FUNCTION_BLOCK
		`;
		const diagnostics = getDiagnostics(code);
		const undefinedErrors = diagnostics.filter(d => d.message.includes('Undefined'));
		expect(undefinedErrors.length).toBeGreaterThan(0);
		expect(undefinedErrors[0].message).toContain('undefined_name');
	});

	it('should allow reference to FB variables in method initializers', () => {
		const code = `
			FUNCTION_BLOCK MyFB
			VAR
				fb_var : INT := 10;
			END_VAR
			METHOD MyMethod
			VAR
				local_var : INT := fb_var + 1;
			END_VAR
			END_METHOD
			END_FUNCTION_BLOCK
		`;
		const diagnostics = getDiagnostics(code);
		const undefinedErrors = diagnostics.filter(d => d.message.includes('Undefined'));
		expect(undefinedErrors).toHaveLength(0);
	});

	it('should allow initialization with array literals', () => {
		const code = `
			PROGRAM Test
			VAR
				arr : ARRAY[1..3] OF INT := [1, 2, 3];
			END_VAR
			END_PROGRAM
		`;
		const diagnostics = getDiagnostics(code);
		// Array literal syntax should be accepted, type checking is deferred
		const typeErrors = diagnostics.filter(d => d.message.includes('Type mismatch'));
		expect(typeErrors).toHaveLength(0);
	});

	it('should handle complex expressions in initializers', () => {
		const code = `
			PROGRAM Test
			VAR
				a : INT := 5;
				b : INT := 10;
				c : INT := a + b * 2;
				d : BOOL := a > b AND b < 20;
			END_VAR
			END_PROGRAM
		`;
		const diagnostics = getDiagnostics(code);
		const undefinedErrors = diagnostics.filter(d => d.message.includes('Undefined'));
		expect(undefinedErrors).toHaveLength(0);
	});

	it('should no initialization error if initialValue is undefined', () => {
		const code = `
			PROGRAM Test
			VAR
				x : INT;
				y : BOOL;
			END_VAR
			END_PROGRAM
		`;
		const diagnostics = getDiagnostics(code);
		const initErrors = diagnostics.filter(d => d.message.includes('initialize'));
		expect(initErrors).toHaveLength(0);
	});

	it('should track variable scope across multiple VAR blocks correctly', () => {
		const code = `
			PROGRAM Test
			VAR
				x : INT := 1;
			END_VAR
			VAR CONSTANT
				c : INT := x + 5;
			END_VAR
			VAR
				y : INT := c * 2;
				z : INT := x + c;
			END_VAR
			END_PROGRAM
		`;
		const diagnostics = getDiagnostics(code);
		const undefinedErrors = diagnostics.filter(d => d.message.includes('Undefined'));
		expect(undefinedErrors).toHaveLength(0);
	});

	it('should warn for type mismatch with negative number assignment to BOOL', () => {
		const code = `
			PROGRAM Test
			VAR
				x : BOOL := -1;
			END_VAR
			END_PROGRAM
		`;
		const diagnostics = getDiagnostics(code);
		const typeErrors = diagnostics.filter(d => d.message.includes('Type mismatch'));
		expect(typeErrors.length).toBeGreaterThan(0);
	});
});
