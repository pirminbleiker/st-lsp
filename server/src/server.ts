import {
	createConnection,
	TextDocuments,
	ProposedFeatures,
	InitializeParams,
	DidChangeConfigurationNotification,
	CompletionItem,
	TextDocumentPositionParams,
	TextDocumentSyncKind,
	InitializeResult,
	Hover,
	DefinitionParams,
	Location,
	DocumentSymbolParams,
	DocumentSymbol,
	SignatureHelp,
	SignatureHelpParams,
	ReferenceParams,
	RenameParams,
	WorkspaceEdit,
	PrepareRenameParams,
	CodeLens,
	CodeLensParams,
	DocumentFormattingParams,
	DocumentRangeFormattingParams,
	TextEdit,
	WorkspaceSymbolParams,
	WorkspaceSymbol,
	CodeAction,
	CodeActionParams,
	InlayHint,
	InlayHintParams,
	SemanticTokensParams,
	SemanticTokens,
	FoldingRange,
	FoldingRangeParams,
} from 'vscode-languageserver/node';

import { TextDocument } from 'vscode-languageserver-textdocument';
import { handleHover } from './handlers/hover';
import { validateDocument, validateUri } from './handlers/diagnostics';
import { handleDefinition } from './handlers/definition';
import { handleCompletion } from './handlers/completion';
import { handleDocumentSymbols } from './handlers/documentSymbols';
import { handleSignatureHelp } from './handlers/signatureHelp';
import { handleReferences } from './handlers/references';
import { handleRename, handlePrepareRename } from './handlers/rename';
import { handleCodeLens } from './handlers/codeLens';
import { handleFormatting, handleRangeFormatting } from './handlers/formatting';
import { handleWorkspaceSymbol } from './handlers/workspaceSymbol';
import { handleCodeActions } from './handlers/codeActions';
import { handleInlayHints } from './handlers/inlayHints';
import { handleFoldingRanges } from './handlers/foldingRange';
import { createWorkspaceIndex, WorkspaceIndex } from './twincat/workspaceIndex';
import { handleSemanticTokens, TOKEN_TYPES, TOKEN_MODIFIERS } from './handlers/semanticTokens';
import { getOrParse, invalidateDocumentCache } from './handlers/shared';

const connection = createConnection(ProposedFeatures.all) as any;
const documents = new TextDocuments(TextDocument);

let hasConfigurationCapability = false;
let hasWorkspaceFolderCapability = false;
let lineFoldingOnly = false;
let workspaceIndex: WorkspaceIndex | undefined;

connection.onInitialize((params: InitializeParams): InitializeResult => {
	const capabilities = params.capabilities;

	hasConfigurationCapability = !!(
		capabilities.workspace && !!capabilities.workspace.configuration
	);
	hasWorkspaceFolderCapability = !!(
		capabilities.workspace && !!capabilities.workspace.workspaceFolders
	);
	lineFoldingOnly = params.capabilities.textDocument?.foldingRange?.lineFoldingOnly ?? false;

	const workspaceRoot =
		params.workspaceFolders?.[0]?.uri ?? params.rootUri ?? undefined;
	if (workspaceRoot) {
		workspaceIndex = createWorkspaceIndex(workspaceRoot);
		workspaceIndex.on('error', (err) =>
			connection.console.warn('Workspace index: ' + (err as Error).message),
		);
		workspaceIndex.on('change', () => validateAllWorkspaceFiles());
	}

	const result: InitializeResult = {
		capabilities: {
			textDocumentSync: TextDocumentSyncKind.Incremental,
			completionProvider: {
				resolveProvider: true,
				triggerCharacters: ['.', ':'],
			},
			hoverProvider: true,
			definitionProvider: true,
			referencesProvider: true,
			renameProvider: {
				prepareProvider: true,
			},
			documentSymbolProvider: true,
			workspaceSymbolProvider: true,
			signatureHelpProvider: {
				triggerCharacters: ['(', ','],
			},
			codeLensProvider: {
				resolveProvider: false,
			},
			documentFormattingProvider: true,
			documentRangeFormattingProvider: true,
			codeActionProvider: {
				resolveProvider: false,
			},
			inlayHintProvider: true,
			foldingRangeProvider: true,
			semanticTokensProvider: {
				legend: {
					tokenTypes: [...TOKEN_TYPES],
					tokenModifiers: [...TOKEN_MODIFIERS],
				},
				full: true,
			},
		},
	};

	if (hasWorkspaceFolderCapability) {
		result.capabilities.workspace = {
			workspaceFolders: {
				supported: true,
			},
		};
	}

	return result;
});

function validateAllWorkspaceFiles(): void {
	if (!workspaceIndex) return;
	for (const uri of workspaceIndex.getProjectFiles()) {
		// Skip files that are open in the editor — onDidOpen / onDidChangeContent handle those
		if (!documents.get(uri)) {
			validateUri(connection, uri, workspaceIndex);
		}
	}
}

connection.onInitialized(() => {
	if (hasConfigurationCapability) {
		connection.client.register(DidChangeConfigurationNotification.type, undefined);
	}
	if (hasWorkspaceFolderCapability) {
		connection.workspace.onDidChangeWorkspaceFolders((_event: any) => {
			connection.console.log('Workspace folder change event received.');
		});
	}
	// Publish diagnostics for all workspace files that are not yet open in the editor.
	// The initial WorkspaceIndex scan fires 'change' synchronously inside onInitialize
	// (before the listener in onInitialized is wired up), so we push once here as well.
	validateAllWorkspaceFiles();
});

connection.onCompletion(
	(params: TextDocumentPositionParams): CompletionItem[] => {
		const document = documents.get(params.textDocument.uri);
		return handleCompletion(params, document, workspaceIndex);
	}
);

connection.onCompletionResolve((item: CompletionItem): CompletionItem => {
	return item;
});

connection.onHover(
	(params: TextDocumentPositionParams): Hover | null => {
		const document = documents.get(params.textDocument.uri);
		return handleHover(params, document, workspaceIndex);
	}
);

connection.onDefinition(
	(params: DefinitionParams): Location | null => {
		const document = documents.get(params.textDocument.uri);
		return handleDefinition(params, document, workspaceIndex);
	}
);

connection.onReferences(
	(params: ReferenceParams): Location[] => {
		const document = documents.get(params.textDocument.uri);
		return handleReferences(params, document, workspaceIndex);
	}
);

connection.onPrepareRename(
	(params: PrepareRenameParams) => {
		const document = documents.get(params.textDocument.uri);
		return handlePrepareRename(params, document);
	}
);

connection.onRenameRequest(
	(params: RenameParams): WorkspaceEdit | null => {
		const document = documents.get(params.textDocument.uri);
		return handleRename(params, document, workspaceIndex);
	}
);

connection.onWorkspaceSymbol(
	(params: WorkspaceSymbolParams): WorkspaceSymbol[] => {
		return handleWorkspaceSymbol(params, workspaceIndex);
	}
);

connection.onDocumentSymbol(
	(params: DocumentSymbolParams): DocumentSymbol[] => {
		const document = documents.get(params.textDocument.uri);
		return handleDocumentSymbols(params, document);
	}
);

connection.onSignatureHelp(
	(params: SignatureHelpParams): SignatureHelp | null => {
		const document = documents.get(params.textDocument.uri);
		return handleSignatureHelp(params, document);
	}
);

connection.onCodeLens(
	(params: CodeLensParams): CodeLens[] => {
		const document = documents.get(params.textDocument.uri);
		return handleCodeLens(params, document, workspaceIndex);
	}
);

connection.onDocumentFormatting(
	(params: DocumentFormattingParams): TextEdit[] => {
		const document = documents.get(params.textDocument.uri);
		return handleFormatting(params, document);
	}
);

connection.onDocumentRangeFormatting(
	(params: DocumentRangeFormattingParams): TextEdit[] => {
		const document = documents.get(params.textDocument.uri);
		return handleRangeFormatting(params, document);
	}
);

connection.onCodeAction(
	(params: CodeActionParams): CodeAction[] => {
		const document = documents.get(params.textDocument.uri);
		return handleCodeActions(params, document);
	}
);

connection.languages.inlayHint.on(
	(params: InlayHintParams): InlayHint[] => {
		const document = documents.get(params.textDocument.uri);
		return handleInlayHints(document, params.range, workspaceIndex);
	}
);

connection.onFoldingRanges(
	(params: FoldingRangeParams): FoldingRange[] => {
		const document = documents.get(params.textDocument.uri);
		return handleFoldingRanges(document, lineFoldingOnly);
	}
);

connection.languages.semanticTokens.on(
	(params: SemanticTokensParams): SemanticTokens => {
		const document = documents.get(params.textDocument.uri);
		if (!document) return { data: [] };
		return handleSemanticTokens(document);
	}
);

documents.onDidChangeContent(change => {
	const doc = change.document;
	// Clear stale document parse cache, then compute fresh parse
	invalidateDocumentCache(doc.uri);
	const { ast, errors, extraction } = getOrParse(doc);
	// Push fresh in-memory parse into WorkspaceIndex so cross-file handlers
	// don't need to fall back to a stale disk read for the just-edited file
	workspaceIndex?.updateAst(doc.uri, ast, errors, extraction);
	validateDocument(connection, doc, workspaceIndex);
});
documents.onDidOpen(event => validateDocument(connection, event.document, workspaceIndex));

documents.onDidClose(event => {
	invalidateDocumentCache(event.document.uri);
});

documents.listen(connection);
connection.listen();
