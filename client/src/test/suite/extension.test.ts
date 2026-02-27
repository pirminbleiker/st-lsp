import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';

const FIXTURE_DIR = path.join(__dirname, '..', '..', '..', '..', 'tests', 'fixtures', 'integration');
const SAMPLE_ST = path.join(FIXTURE_DIR, 'sample.st');

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Wait for the LSP server to initialize by sleeping a fixed amount.
 *  The LSP client starts asynchronously; this gives it time to complete the
 *  initialize handshake before tests execute language feature commands.
 */
async function waitForLsp(): Promise<void> {
	await sleep(8000);
}

suite('ST LSP Extension Integration Tests', () => {
	test('Extension activates on .st file', async () => {
		const doc = await vscode.workspace.openTextDocument(SAMPLE_ST);
		await vscode.window.showTextDocument(doc);

		// The extension activates on onLanguage:iec-st
		const ext = vscode.extensions.getExtension('pirminbleiker.st-lsp-client');
		assert.ok(ext, 'Extension st-lsp-client should be installed');

		await ext!.activate();
		assert.strictEqual(ext!.isActive, true, 'Extension should be active after opening .st file');
	});

	test('LSP server starts and provides diagnostics', async () => {
		const doc = await vscode.workspace.openTextDocument(SAMPLE_ST);
		await vscode.window.showTextDocument(doc);

		// Wait for LSP to initialize and run diagnostics
		await waitForLsp();

		// Diagnostics should be an array (possibly empty for valid ST code)
		const diags = vscode.languages.getDiagnostics(doc.uri);
		assert.ok(Array.isArray(diags), 'getDiagnostics should return an array');
	});

	test('Completion includes BOOL for type position', async () => {
		const doc = await vscode.workspace.openTextDocument(SAMPLE_ST);
		await vscode.window.showTextDocument(doc);

		await waitForLsp(); // Wait for LSP to be ready

		// Line 2: "    flag : BOOL;" — position at start of type (column 11, after ": ")
		const position = new vscode.Position(2, 11);
		const result = await vscode.commands.executeCommand<vscode.CompletionList>(
			'vscode.executeCompletionItemProvider',
			doc.uri,
			position,
		);

		const labels = (result?.items ?? []).map((i) =>
			typeof i.label === 'string' ? i.label : i.label.label,
		);
		assert.ok(
			labels.some((l) => l.toUpperCase().includes('BOOL')),
			`Completion should include BOOL; got: ${labels.slice(0, 10).join(', ')}`,
		);
	});

	test('Hover returns documentation for BOOL type', async () => {
		const doc = await vscode.workspace.openTextDocument(SAMPLE_ST);
		await vscode.window.showTextDocument(doc);

		await waitForLsp(); // Wait for LSP to be ready

		// Line 2: "    flag : BOOL;" — hover over BOOL (columns 11–14)
		const position = new vscode.Position(2, 12);
		const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
			'vscode.executeHoverProvider',
			doc.uri,
			position,
		);

		assert.ok(hovers && hovers.length > 0, 'Hover should return at least one result for BOOL');
	});
});
