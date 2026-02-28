import { describe, test, expect } from 'vitest';
import { spawn } from 'child_process';
import * as path from 'path';

const BUNDLE_PATH = path.resolve(__dirname, '../../bundle/server.js');

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
					const timer = setTimeout(
						() => reject(new Error('Server initialize timeout after 15s')),
						15_000,
					);

					proc.stdout.on('data', (chunk: Buffer) => {
						buf += chunk.toString('utf8');
						if (parseFirstMessage(buf) !== null) {
							clearTimeout(timer);
							resolve(buf);
						}
					});

					proc.stderr.on('data', () => {
						/* server writes logs to stderr — ignore */
					});

					proc.on('error', (err) => {
						clearTimeout(timer);
						reject(err);
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
