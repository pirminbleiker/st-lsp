import * as path from 'path';
import { ExtensionContext } from 'vscode';
import {
	LanguageClient,
	LanguageClientOptions,
	ServerOptions,
	TransportKind,
} from 'vscode-languageclient/node';

let client: LanguageClient;

export function activate(context: ExtensionContext): void {
	const serverModule = context.asAbsolutePath(
		path.join('server-out', 'server.js')
	);

	const serverOptions: ServerOptions = {
		run: {
			module: serverModule,
			transport: TransportKind.ipc,
		},
		debug: {
			module: serverModule,
			transport: TransportKind.ipc,
			options: {
				execArgv: ['--nolazy', '--inspect=6009'],
			},
		},
	};

	const clientOptions: LanguageClientOptions = {
		documentSelector: [
			{ scheme: 'file', language: 'iec-st' },
			{ scheme: 'file', pattern: '**/*.TcPOU' },
			{ scheme: 'file', pattern: '**/*.TcGVL' },
			{ scheme: 'file', pattern: '**/*.TcDUT' },
			{ scheme: 'file', pattern: '**/*.TcIO' },
		],
		synchronize: {
			fileEvents: undefined,
		},
	};

	client = new LanguageClient(
		'st-lsp',
		'Structured Text Language Server',
		serverOptions,
		clientOptions
	);

	client.start();
}

export function deactivate(): Thenable<void> | undefined {
	if (!client) {
		return undefined;
	}
	return client.stop();
}
