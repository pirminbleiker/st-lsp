import {
	Connection,
	Diagnostic,
	DiagnosticSeverity,
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { parse } from '../parser/parser';

export function validateDocument(connection: Connection, document: TextDocument): void {
	const { errors } = parse(document.getText());

	const diagnostics: Diagnostic[] = errors.map(err => ({
		severity: DiagnosticSeverity.Error,
		range: {
			start: { line: err.range.start.line, character: err.range.start.character },
			end:   { line: err.range.end.line,   character: err.range.end.character },
		},
		message: err.message,
		source: 'st-lsp',
	}));

	connection.sendDiagnostics({ uri: document.uri, diagnostics });
}
