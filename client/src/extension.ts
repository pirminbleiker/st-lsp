import * as path from 'path';
import { ExtensionContext, workspace } from 'vscode';
import {
	LanguageClient,
	LanguageClientOptions,
	ServerOptions,
	TransportKind,
} from 'vscode-languageclient/node';

let client: LanguageClient;

export function activate(context: ExtensionContext): void {
	const serverModule = process.env.ST_LSP_SERVER_PATH
		?? context.asAbsolutePath(path.join('server-out', 'server.js'));

	const useDevtools = process.env.ST_LSP_DEVTOOLS === '1';
	const serverOptions: ServerOptions = useDevtools
		? {
			command: 'lsp-devtools',
			args: ['agent', '--', 'node', serverModule, '--stdio'],
			transport: TransportKind.stdio,
		}
		: {
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

	const config = workspace.getConfiguration('st-lsp');
	const twincatInstallPath = config.get<string>('twincat.installPath') || undefined;

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
		initializationOptions: {
			twincatInstallPath,
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
