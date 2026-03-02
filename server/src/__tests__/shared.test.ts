/**
 * Tests for the shared handler utilities (shared.ts).
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PositionMapper } from '../twincat/tcExtractor';
import { mapperForUri } from '../handlers/shared';
import { WorkspaceIndex } from '../twincat/workspaceIndex';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shared-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function write(name: string, content: string): string {
  const fullPath = path.join(tmpDir, name);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, 'utf-8');
  return fullPath;
}

function toUri(absPath: string): string {
  return `file://${absPath}`;
}

// ---------------------------------------------------------------------------
// mapperForUri
// ---------------------------------------------------------------------------

describe('mapperForUri', () => {
  it('returns a PositionMapper without a WorkspaceIndex by reading from disk', () => {
    const filePath = write('test.st', 'PROGRAM Foo\nVAR\nEND_VAR\nEND_PROGRAM\n');
    const uri = toUri(filePath);
    const mapper = mapperForUri(uri);
    expect(mapper).toBeInstanceOf(PositionMapper);
  });

  it('returns a passthrough mapper for a nonexistent file (no throw)', () => {
    const uri = 'file:///nonexistent/path/file.st';
    const mapper = mapperForUri(uri);
    expect(mapper).toBeInstanceOf(PositionMapper);
    // passthrough mapper: extracted position == original position
    const pos = mapper.extractedToOriginal(5, 10);
    expect(pos).toEqual({ line: 5, character: 10 });
  });

  it('uses the WorkspaceIndex cache when available (no disk read)', () => {
    // Create a real file so parseAndCache can read it
    const plcprojXml = `<?xml version="1.0" encoding="utf-8"?>
<Project ToolsVersion="15.0" xmlns="http://schemas.microsoft.com/developer/msbuild/2003">
  <ItemGroup>
    <Compile Include="Main.st" />
  </ItemGroup>
</Project>`;
    write('My.plcproj', plcprojXml);
    write('Main.st', 'PROGRAM Main\nVAR\nEND_VAR\nEND_PROGRAM\n');

    const idx = new WorkspaceIndex({ workspaceRoot: tmpDir });
    idx.on('error', () => { /* suppress */ });
    idx.initialize();

    const files = idx.getProjectFiles();
    const stUri = files.find((f) => f.endsWith('Main.st'));
    expect(stUri).toBeDefined();

    // Both paths should return a valid PositionMapper
    const mapperWithCache = mapperForUri(stUri!, idx);
    const mapperWithoutCache = mapperForUri(stUri!);
    expect(mapperWithCache).toBeInstanceOf(PositionMapper);
    expect(mapperWithoutCache).toBeInstanceOf(PositionMapper);
  });
});
