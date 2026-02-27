import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';

const EXTENSION_ID = 'pirminbleiker.st-lsp-client';
const SAMPLE_POU = path.resolve(__dirname, '../../testFixtures/sample.TcPOU');

suite('Extension Integration Tests', () => {
	test('extension is present and activates', async () => {
		const ext = vscode.extensions.getExtension(EXTENSION_ID);
		assert.ok(ext, `Extension "${EXTENSION_ID}" should be present`);
		await ext!.activate();
		assert.strictEqual(ext!.isActive, true, 'Extension should be active after activate()');
	});

	test('completion provides ST keywords for a TcPOU file', async () => {
		const doc = await vscode.workspace.openTextDocument(SAMPLE_POU);
		await vscode.window.showTextDocument(doc);

		// Give the language server time to initialise
		await new Promise<void>((r) => setTimeout(r, 3000));

		const position = new vscode.Position(0, 0);
		const completions =
			await vscode.commands.executeCommand<vscode.CompletionList>(
				'vscode.executeCompletionItemProvider',
				doc.uri,
				position,
			);

		assert.ok(completions, 'Should receive a CompletionList');
		assert.ok(completions.items.length > 0, 'CompletionList should not be empty');

		const labels = completions.items.map((item) =>
			typeof item.label === 'string' ? item.label : item.label.label,
		);
		const hasStKeyword = labels.some((l) =>
			['IF', 'PROGRAM', 'VAR', 'END_VAR', 'BOOL', 'INT'].includes(l),
		);
		assert.ok(hasStKeyword, `Expected an ST keyword in completions, got: ${labels.slice(0, 10).join(', ')}`);
	});
});
