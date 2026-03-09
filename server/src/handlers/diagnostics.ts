import {
	Connection,
	Diagnostic,
	DiagnosticSeverity,
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { OffsetMap } from '../twincat/tcExtractor';
import { getOrParse } from './shared';
import { WorkspaceIndex } from '../twincat/workspaceIndex';
import { SemanticAnalyzer } from '../analysis/semanticAnalyzer';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Maximum number of diagnostics reported per file to avoid flooding the client. */
const MAX_DIAGNOSTICS_PER_FILE = 100;

function applyOffsets(diagnostics: Diagnostic[], offsets: OffsetMap): Diagnostic[] {
	return diagnostics.map(d => ({
		...d,
		range: {
			start: {
				line: offsets[d.range.start.line] ?? d.range.start.line,
				character: d.range.start.character,
			},
			end: {
				line: offsets[d.range.end.line] ?? d.range.end.line,
				character: d.range.end.character,
			},
		},
	}));
}

function buildParseDiagnostics(errors: Array<{ severity?: string; range: { start: { line: number; character: number }; end: { line: number; character: number } }; message: string; code?: string }>): Diagnostic[] {
	return errors.map(err => ({
		severity: (err.severity ?? 'error') === 'warning' ? DiagnosticSeverity.Warning : DiagnosticSeverity.Error,
		range: {
			start: { line: err.range.start.line, character: err.range.start.character },
			end:   { line: err.range.end.line,   character: err.range.end.character },
		},
		message: err.message,
		source: 'st-lsp',
		code: err.code,
	}));
}

/**
 * Publish diagnostics for a workspace file that is NOT open in the editor,
 * using the cached parse result from WorkspaceIndex.
 */
export function validateUri(connection: Connection, uri: string, workspaceIndex: WorkspaceIndex): void {
	const cached = workspaceIndex.getAst(uri);
	if (!cached) return;
	const { ast, errors, extraction } = cached;

	const offsetMap: OffsetMap = {};
	extraction.lineMap.forEach((originalLine, extractedLine) => {
		offsetMap[extractedLine] = originalLine;
	});

	const parseDiags = buildParseDiagnostics(errors);

	const libraryRefs = workspaceIndex.getLibraryRefs(uri);
	const hasParseErrors = errors.some(e => (e.severity ?? 'error') !== 'warning');
	const semanticDiags = !hasParseErrors
		? new SemanticAnalyzer(ast, libraryRefs, workspaceIndex, uri).analyze()
		: [];

	const diagnostics = applyOffsets([...parseDiags, ...semanticDiags], offsetMap);
	connection.sendDiagnostics({ uri, diagnostics: diagnostics.slice(0, MAX_DIAGNOSTICS_PER_FILE) });
}

export function validateDocument(connection: Connection, document: TextDocument, workspaceIndex?: WorkspaceIndex): void {
	const { extraction: stExtraction, ast, errors } = getOrParse(document);
	const offsetMap: OffsetMap = {};
	stExtraction.lineMap.forEach((originalLine, extractedLine) => {
		offsetMap[extractedLine] = originalLine;
	});

	const parseDiags = buildParseDiagnostics(errors);

	const hasParseErrors = errors.some(e => (e.severity ?? 'error') !== 'warning');
	const libraryRefs = workspaceIndex?.getLibraryRefs(document.uri);
	const semanticDiags = !hasParseErrors
		? new SemanticAnalyzer(ast, libraryRefs, workspaceIndex, document.uri).analyze()
		: [];

	const diagnostics = applyOffsets([...parseDiags, ...semanticDiags], offsetMap);
	connection.sendDiagnostics({ uri: document.uri, diagnostics: diagnostics.slice(0, MAX_DIAGNOSTICS_PER_FILE) });
}
