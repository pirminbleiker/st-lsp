import { describe, it, expect } from 'vitest';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { CodeActionParams, DiagnosticSeverity } from 'vscode-languageserver/node';
import { handleCodeActions } from '../handlers/codeActions';

const URI = 'file:///test.st';

function makeDoc(content: string): TextDocument {
	return TextDocument.create(URI, 'st', 1, content);
}

function makeParams(
	content: string,
	line: number,
	character: number,
	diagnostics: CodeActionParams['context']['diagnostics'] = [],
): CodeActionParams {
	return {
		textDocument: { uri: URI },
		range: {
			start: { line, character },
			end: { line, character },
		},
		context: { diagnostics },
	};
}

// ---------------------------------------------------------------------------
// Action 1: Declare variable
// ---------------------------------------------------------------------------

describe('handleCodeActions — Action 1: Declare variable', () => {
	it('offers to declare an undefined identifier when VAR block exists', () => {
		const content = [
			'PROGRAM Main',
			'VAR',
			'\ty : INT;',
			'END_VAR',
			'x := 1;',
			'END_PROGRAM',
		].join('\n');
		const doc = makeDoc(content);
		const diag = {
			severity: DiagnosticSeverity.Warning,
			range: { start: { line: 4, character: 0 }, end: { line: 4, character: 1 } },
			message: "Undefined identifier 'x'",
			source: 'st-lsp',
		};
		const params = makeParams(content, 4, 0, [diag]);
		const actions = handleCodeActions(params, doc);

		const action = actions.find(a => a.title === "Declare 'x' as VAR");
		expect(action).toBeDefined();
		expect(action?.kind).toBe('quickfix');

		const edits = action?.edit?.changes?.[URI];
		expect(edits).toHaveLength(1);
		// Should insert before END_VAR (line 3)
		expect(edits?.[0].range.start.line).toBe(3);
		expect(edits?.[0].newText).toContain('x : UNKNOWN;');
	});

	it('offers to declare an undefined identifier when no VAR block exists', () => {
		const content = [
			'PROGRAM Main',
			'x := 1;',
			'END_PROGRAM',
		].join('\n');
		const doc = makeDoc(content);
		const diag = {
			severity: DiagnosticSeverity.Warning,
			range: { start: { line: 1, character: 0 }, end: { line: 1, character: 1 } },
			message: "Undefined identifier 'x'",
			source: 'st-lsp',
		};
		const params = makeParams(content, 1, 0, [diag]);
		const actions = handleCodeActions(params, doc);

		const action = actions.find(a => a.title === "Declare 'x' as VAR");
		expect(action).toBeDefined();
		const edits = action?.edit?.changes?.[URI];
		expect(edits).toHaveLength(1);
		// Should insert a VAR block after the PROGRAM header (line 0 + 1 = line 1)
		expect(edits?.[0].range.start.line).toBe(1);
		expect(edits?.[0].newText).toContain('VAR');
		expect(edits?.[0].newText).toContain('x : UNKNOWN;');
		expect(edits?.[0].newText).toContain('END_VAR');
	});

	it('returns empty when no undefined-identifier diagnostics', () => {
		const content = 'PROGRAM Main\nVAR\n\tx : INT;\nEND_VAR\nx := 1;\nEND_PROGRAM';
		const doc = makeDoc(content);
		const params = makeParams(content, 4, 0);
		const actions = handleCodeActions(params, doc);
		const declareActions = actions.filter(a => a.title?.startsWith('Declare'));
		expect(declareActions).toHaveLength(0);
	});

	it('does not offer declaration when identifier is outside a POU', () => {
		// Diagnostic outside any POU (e.g. on a top-level statement — unusual but safe)
		const content = 'x := 1;';
		const doc = makeDoc(content);
		const diag = {
			severity: DiagnosticSeverity.Warning,
			range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
			message: "Undefined identifier 'x'",
			source: 'st-lsp',
		};
		const params = makeParams(content, 0, 0, [diag]);
		const actions = handleCodeActions(params, doc);
		const declareActions = actions.filter(a => a.title?.startsWith('Declare'));
		expect(declareActions).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// Action 2: Uppercase keyword
// ---------------------------------------------------------------------------

describe('handleCodeActions — Action 2: Uppercase keyword', () => {
	it('offers to uppercase a lowercase keyword at cursor position', () => {
		// 'if' is lowercase; cursor is on that word
		const content = 'PROGRAM Main\nVAR\n\tx : INT;\nEND_VAR\nif x > 0 THEN\n\tx := 1;\nEND_IF;\nEND_PROGRAM';
		const doc = makeDoc(content);
		// Cursor on 'if' — line 4, character 0
		const params: CodeActionParams = {
			textDocument: { uri: URI },
			range: { start: { line: 4, character: 0 }, end: { line: 4, character: 2 } },
			context: { diagnostics: [] },
		};
		const actions = handleCodeActions(params, doc);
		const action = actions.find(a => a.title?.includes("'if'") && a.title?.includes("'IF'"));
		expect(action).toBeDefined();
		expect(action?.kind).toBe('quickfix');
		const edits = action?.edit?.changes?.[URI];
		expect(edits?.[0].newText).toBe('IF');
	});

	it('does not offer uppercase for already-uppercase keyword', () => {
		const content = 'PROGRAM Main\nVAR\n\tx : INT;\nEND_VAR\nIF x > 0 THEN\n\tx := 1;\nEND_IF;\nEND_PROGRAM';
		const doc = makeDoc(content);
		const params: CodeActionParams = {
			textDocument: { uri: URI },
			range: { start: { line: 4, character: 0 }, end: { line: 4, character: 2 } },
			context: { diagnostics: [] },
		};
		const actions = handleCodeActions(params, doc);
		const uppercaseActions = actions.filter(a => a.title?.startsWith('Uppercase'));
		expect(uppercaseActions).toHaveLength(0);
	});

	it('does not offer uppercase for tokens outside the request range', () => {
		// lowercase 'for' on a different line than cursor
		const content = [
			'PROGRAM Main',
			'VAR',
			'\ti : INT;',
			'END_VAR',
			'for i := 1 TO 10 DO',
			'\t;',
			'END_FOR;',
			'END_PROGRAM',
		].join('\n');
		const doc = makeDoc(content);
		// Cursor on line 6 (END_FOR), not on 'for' (line 4)
		const params: CodeActionParams = {
			textDocument: { uri: URI },
			range: { start: { line: 6, character: 0 }, end: { line: 6, character: 0 } },
			context: { diagnostics: [] },
		};
		const actions = handleCodeActions(params, doc);
		const uppercaseActions = actions.filter(a => a.title?.includes("'for'"));
		expect(uppercaseActions).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// Action 3: Add missing END_IF / END_FOR / END_WHILE
// ---------------------------------------------------------------------------

describe('handleCodeActions — Action 3: Add missing end keyword', () => {
	it('offers to add END_IF when diagnostic says Expected END_IF', () => {
		// Use a valid document so the parser can find the enclosing POU.
		// The diagnostic is injected externally (as it would come from a previous
		// validation pass) to keep the parser from encountering malformed input.
		const content = [
			'PROGRAM Main',
			'VAR',
			'\tx : INT;',
			'END_VAR',
			'IF x > 0 THEN',
			'\tx := 1;',
			'END_IF;',
			'END_PROGRAM',
		].join('\n');
		const doc = makeDoc(content);
		// Simulate the diagnostic that the parser would have generated on a
		// previous (malformed) version of the document.
		const diag = {
			severity: DiagnosticSeverity.Error,
			range: { start: { line: 6, character: 0 }, end: { line: 6, character: 6 } },
			message: "Expected 'END_IF'",
			source: 'st-lsp',
		};
		const params = makeParams(content, 6, 0, [diag]);
		const actions = handleCodeActions(params, doc);

		const action = actions.find(a => a.title === "Add missing 'END_IF;'");
		expect(action).toBeDefined();
		expect(action?.kind).toBe('quickfix');
		const edits = action?.edit?.changes?.[URI];
		expect(edits).toHaveLength(1);
		expect(edits?.[0].newText).toContain('END_IF;');
	});

	it('offers to add END_FOR when diagnostic says Expected END_FOR', () => {
		// Valid document; diagnostic injected externally.
		const content = [
			'PROGRAM Main',
			'VAR',
			'\ti : INT;',
			'END_VAR',
			'FOR i := 1 TO 10 DO',
			'\t;',
			'END_FOR;',
			'END_PROGRAM',
		].join('\n');
		const doc = makeDoc(content);
		const diag = {
			severity: DiagnosticSeverity.Error,
			range: { start: { line: 6, character: 0 }, end: { line: 6, character: 7 } },
			message: "Expected 'END_FOR'",
			source: 'st-lsp',
		};
		const params = makeParams(content, 6, 0, [diag]);
		const actions = handleCodeActions(params, doc);

		const action = actions.find(a => a.title === "Add missing 'END_FOR;'");
		expect(action).toBeDefined();
		const edits = action?.edit?.changes?.[URI];
		expect(edits?.[0].newText).toContain('END_FOR;');
	});

	it('does not offer end-keyword action for unrelated diagnostics', () => {
		const content = 'PROGRAM Main\nEND_PROGRAM';
		const doc = makeDoc(content);
		const diag = {
			severity: DiagnosticSeverity.Error,
			range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
			message: "Some unrelated error",
			source: 'st-lsp',
		};
		const params = makeParams(content, 0, 0, [diag]);
		const actions = handleCodeActions(params, doc);
		const endActions = actions.filter(a => a.title?.startsWith("Add missing"));
		expect(endActions).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('handleCodeActions — edge cases', () => {
	it('returns empty array when document is undefined', () => {
		const params = makeParams('', 0, 0);
		const actions = handleCodeActions(params, undefined);
		expect(actions).toEqual([]);
	});
});
