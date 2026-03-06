import { describe, test, expect, beforeAll } from 'vitest';
import { execFileSync, spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

const SERVER_DIR = path.resolve(__dirname, '../..');
const BUNDLE_PATH = path.resolve(SERVER_DIR, 'bundle/server.js');

beforeAll(() => {
	if (!fs.existsSync(BUNDLE_PATH)) {
		execFileSync('npx', ['esbuild', 'src/server.ts', '--bundle', '--outfile=bundle/server.js', '--platform=node', '--format=cjs'], { cwd: SERVER_DIR, stdio: 'pipe' });
	}
});

function encodeMessage(method: string, id: number, params: unknown): Buffer {
	const content = JSON.stringify({ jsonrpc: '2.0', id, method, params });
	const header = `Content-Length: ${Buffer.byteLength(content, 'utf8')}\r\n\r\n`;
	return Buffer.concat([Buffer.from(header, 'ascii'), Buffer.from(content, 'utf8')]);
}

function parseFirstMessage(raw: string): Record<string, unknown> | null {
	const sep = raw.indexOf('\r\n\r\n');
	if (sep === -1) return null;
	const headerPart = raw.substring(0, sep);
	const m = headerPart.match(/Content-Length:\s*(\d+)/i);
	if (!m) return null;
	const len = parseInt(m[1], 10);
	const body = raw.substring(sep + 4, sep + 4 + len);
	if (body.length < len) return null;
	return JSON.parse(body) as Record<string, unknown>;
}

describe('Server Startup', () => {
	test(
		'responds to initialize with valid InitializeResult',
		async () => {
			const proc = spawn('node', [BUNDLE_PATH, '--stdio'], {
				stdio: ['pipe', 'pipe', 'pipe'],
			});

			let rawResponse: string;
			try {
				rawResponse = await new Promise<string>((resolve, reject) => {
					let buf = '';
					let settled = false;
					const timer = setTimeout(() => {
						settled = true;
						reject(new Error('Server initialize timeout after 15s'));
					}, 15_000);

					proc.stdout.on('data', (chunk: Buffer) => {
						buf += chunk.toString('utf8');
						if (!settled && parseFirstMessage(buf) !== null) {
							settled = true;
							clearTimeout(timer);
							resolve(buf);
						}
					});

					proc.stderr.on('data', () => {
						/* server writes logs to stderr — ignore */
					});

					proc.on('error', (err) => {
						if (settled) return;
						settled = true;
						clearTimeout(timer);
						reject(err);
					});

					proc.on('close', (code) => {
						if (settled) return;
						settled = true;
						clearTimeout(timer);
						reject(new Error(`Server process exited with code ${code} before responding`));
					});

					proc.stdin.write(
						encodeMessage('initialize', 1, {
							processId: null,
							rootUri: null,
							capabilities: {},
						}),
					);
				});
			} finally {
				proc.kill();
			}

			const parsed = parseFirstMessage(rawResponse);
			expect(parsed).not.toBeNull();
			expect(parsed!['id']).toBe(1);

			const result = parsed!['result'] as Record<string, unknown>;
			expect(result).toBeDefined();

			const caps = result['capabilities'] as Record<string, unknown>;
			expect(caps).toBeDefined();
			expect(caps['completionProvider']).toBeDefined();
			expect(caps['hoverProvider']).toBe(true);
			expect(caps['definitionProvider']).toBe(true);
			expect(caps['inlayHintProvider']).toBe(true);
		},
		20_000,
	);
});
