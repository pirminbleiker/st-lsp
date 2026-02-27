/**
 * Tests for WorkspaceIndex behaviour with TcSmProject (.tsproj) files whose
 * .plcproj lives in a subdirectory rather than the same directory.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WorkspaceIndex } from '../twincat/workspaceIndex';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workspaceIndex-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function write(relPath: string, content: string): string {
  const fullPath = path.join(tmpDir, relPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, 'utf-8');
  return fullPath;
}

const TCSM_XML = `<?xml version="1.0" encoding="utf-8"?>
<TcSmProject TcSmVersion="1.0.0.1" SchemaVersion="1.0.0.1">
  <Project Name="Solution" Id="{AAAABBBB-CCCC-DDDD-EEEE-FFFFFFFFFFFF}">
    <Plc>
      <Project File="PLCs\\MyPLC\\MyPLC.xti"/>
    </Plc>
  </Project>
</TcSmProject>`;

const PLCPROJ_XML = `<?xml version="1.0" encoding="utf-8"?>
<Project ToolsVersion="15.0" xmlns="http://schemas.microsoft.com/developer/msbuild/2003">
  <PropertyGroup>
    <Name>MyPLC</Name>
  </PropertyGroup>
  <ItemGroup>
    <Compile Include="POUs\\Main.TcPOU" />
  </ItemGroup>
</Project>`;

const MAIN_TCPOU = `FUNCTION_BLOCK Main
VAR
END_VAR
END_FUNCTION_BLOCK
`;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WorkspaceIndex', () => {
  it('indexes files from .plcproj in subdirectory of TcSmProject .tsproj', () => {
    write('Solution.tsproj', TCSM_XML);
    write(path.join('PLCs', 'MyPLC', 'MyPLC.plcproj'), PLCPROJ_XML);
    write(path.join('PLCs', 'MyPLC', 'POUs', 'Main.TcPOU'), MAIN_TCPOU);

    const idx = new WorkspaceIndex({ workspaceRoot: tmpDir });
    idx.on('error', () => { /* suppress */ });
    idx.initialize();

    const files = idx.getProjectFiles();
    expect(files.some((f) => f.endsWith('Main.TcPOU'))).toBe(true);
  });

  it('does not throw when TcSmProject has no .plcproj anywhere', () => {
    write('Solution.tsproj', TCSM_XML);

    const idx = new WorkspaceIndex({ workspaceRoot: tmpDir });
    idx.on('error', () => { /* suppress unhandled error events */ });

    expect(() => idx.initialize()).not.toThrow();
    expect(idx.getProjectFiles()).toEqual([]);
  });

  it('logs warning via error event when no .plcproj found', () => {
    write('Solution.tsproj', TCSM_XML);

    const errors: string[] = [];
    const idx = new WorkspaceIndex({ workspaceRoot: tmpDir });
    idx.on('error', (err) => errors.push((err as Error).message));
    idx.initialize();

    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((msg) => msg.toLowerCase().includes('no sibling') || msg.toLowerCase().includes('.plcproj'))).toBe(true);
  });
});
