/**
 * Tests for WorkspaceIndex behaviour with TcSmProject (.tsproj) files whose
 * .plcproj lives in a subdirectory rather than the same directory.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WorkspaceIndex } from '../twincat/workspaceIndex';
import { parse } from '../parser/parser';
import { extractST } from '../twincat/tcExtractor';

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

const PLCPROJ_WITH_LIBS_XML = `<?xml version="1.0" encoding="utf-8"?>
<Project ToolsVersion="15.0" xmlns="http://schemas.microsoft.com/developer/msbuild/2003">
  <PropertyGroup>
    <Name>MyPLC</Name>
  </PropertyGroup>
  <ItemGroup>
    <Compile Include="POUs\\Main.TcPOU" />
  </ItemGroup>
  <ItemGroup>
    <PlcLibraryReference Include="Tc2_Standard, 3.4.3.0 (Beckhoff Automation GmbH)" />
    <PlcLibraryReference Include="Tc2_MC2, 3.3.5.0 (Beckhoff Automation GmbH)" />
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

  it('getAst() returns extraction alongside ast and errors after file discovery', () => {
    write('Solution.tsproj', TCSM_XML);
    write(path.join('PLCs', 'MyPLC', 'MyPLC.plcproj'), PLCPROJ_XML);
    write(path.join('PLCs', 'MyPLC', 'POUs', 'Main.TcPOU'), MAIN_TCPOU);

    const idx = new WorkspaceIndex({ workspaceRoot: tmpDir });
    idx.on('error', () => { /* suppress */ });
    idx.initialize();

    const files = idx.getProjectFiles();
    const tcpouUri = files.find((f) => f.endsWith('Main.TcPOU'));
    expect(tcpouUri).toBeDefined();

    const cached = idx.getAst(tcpouUri!);
    expect(cached).toBeDefined();
    expect(cached!.ast).toBeDefined();
    expect(cached!.errors).toBeDefined();
    expect(cached!.extraction).toBeDefined();
    // TcPOU files are wrapped in XML — passthrough should be false
    expect(cached!.extraction.passthrough).toBe(false);
  });

  it('getExtraction() returns the cached ExtractionResult for a .TcPOU file', () => {
    write('Solution.tsproj', TCSM_XML);
    write(path.join('PLCs', 'MyPLC', 'MyPLC.plcproj'), PLCPROJ_XML);
    write(path.join('PLCs', 'MyPLC', 'POUs', 'Main.TcPOU'), MAIN_TCPOU);

    const idx = new WorkspaceIndex({ workspaceRoot: tmpDir });
    idx.on('error', () => { /* suppress */ });
    idx.initialize();

    const files = idx.getProjectFiles();
    const tcpouUri = files.find((f) => f.endsWith('Main.TcPOU'));
    expect(tcpouUri).toBeDefined();

    const extraction = idx.getExtraction(tcpouUri!);
    expect(extraction).toBeDefined();
    expect(typeof extraction!.source).toBe('string');
    expect(extraction!.lineMap).toBeDefined();
  });

  it('getExtraction() returns undefined for a URI not in the index', () => {
    write('Solution.tsproj', TCSM_XML);
    write(path.join('PLCs', 'MyPLC', 'MyPLC.plcproj'), PLCPROJ_XML);

    const idx = new WorkspaceIndex({ workspaceRoot: tmpDir });
    idx.on('error', () => { /* suppress */ });
    idx.initialize();

    expect(idx.getExtraction('file:///nonexistent.st')).toBeUndefined();
  });

  it('updateAst() updates the cache entry for a known project URI', () => {
    write('Solution.tsproj', TCSM_XML);
    write(path.join('PLCs', 'MyPLC', 'MyPLC.plcproj'), PLCPROJ_XML);
    write(path.join('PLCs', 'MyPLC', 'POUs', 'Main.TcPOU'), MAIN_TCPOU);

    const idx = new WorkspaceIndex({ workspaceRoot: tmpDir });
    idx.on('error', () => { /* suppress */ });
    idx.initialize();

    const files = idx.getProjectFiles();
    const tcpouUri = files.find((f) => f.endsWith('Main.TcPOU'));
    expect(tcpouUri).toBeDefined();

    // Invalidate so we can verify updateAst re-populates
    idx.invalidateAst(tcpouUri!);
    expect(idx.getAst(tcpouUri!)).toBeUndefined();

    // Build a minimal fake parse result
    const text = 'FUNCTION_BLOCK Foo\nVAR\nEND_VAR\nEND_FUNCTION_BLOCK\n';
    const extraction = extractST(text, '.st');
    const { ast, errors } = parse(extraction.source);

    idx.updateAst(tcpouUri!, ast, errors, extraction);

    const updated = idx.getAst(tcpouUri!);
    expect(updated).toBeDefined();
    expect(updated!.ast).toBe(ast);
    expect(updated!.extraction).toBe(extraction);
  });

  it('updateAst() does not cache entries for URIs not in the project index', () => {
    write('Solution.tsproj', TCSM_XML);
    write(path.join('PLCs', 'MyPLC', 'MyPLC.plcproj'), PLCPROJ_XML);

    const idx = new WorkspaceIndex({ workspaceRoot: tmpDir });
    idx.on('error', () => { /* suppress */ });
    idx.initialize();

    const text = 'FUNCTION_BLOCK Bar\nVAR\nEND_VAR\nEND_FUNCTION_BLOCK\n';
    const extraction = extractST(text, '.st');
    const { ast, errors } = parse(extraction.source);

    const unknownUri = 'file:///some/random/file.st';
    idx.updateAst(unknownUri, ast, errors, extraction);

    // Should NOT be cached since it's not a known project URI
    expect(idx.getAst(unknownUri)).toBeUndefined();
  });

  it('only indexes library files matching plcproj libraryRefs', () => {
    // Set up a .plcproj that references Tc2_Standard and Tc2_MC2
    write('MyPLC.plcproj', PLCPROJ_WITH_LIBS_XML);
    write(path.join('POUs', 'Main.TcPOU'), MAIN_TCPOU);

    // Create _Libraries/ with referenced AND unreferenced libraries.
    // readLibraryIndex falls back to deriving the name from the filename
    // for non-ZIP files, so empty files work for name-matching tests.
    write(path.join('_Libraries', 'Beckhoff', 'Tc2_Standard', '3.4.3.0', 'Tc2_Standard.compiled-library'), '');
    write(path.join('_Libraries', 'Beckhoff', 'Tc2_MC2', '3.3.5.0', 'Tc2_MC2.compiled-library'), '');
    write(path.join('_Libraries', 'Beckhoff', 'Tc3_Unreferenced', '1.0.0.0', 'Tc3_Unreferenced.compiled-library'), '');

    const idx = new WorkspaceIndex({ workspaceRoot: tmpDir });
    idx.on('error', () => { /* suppress */ });
    idx.initialize();

    const files = idx.getProjectFiles();
    const mainUri = files.find(f => f.endsWith('Main.TcPOU'));
    expect(mainUri).toBeDefined();

    const typeNames = idx.getLibraryTypeNames(mainUri!);
    // Referenced libraries should be indexed
    expect(typeNames.has('TC2_STANDARD')).toBe(true);
    expect(typeNames.has('TC2_MC2')).toBe(true);
    // Unreferenced library should NOT be indexed
    expect(typeNames.has('TC3_UNREFERENCED')).toBe(false);
  });

  it('emits warning when a referenced library is not found in _Libraries/', () => {
    // Project references Tc2_Standard and Tc2_MC2, but only Tc2_Standard exists
    write('MyPLC.plcproj', PLCPROJ_WITH_LIBS_XML);
    write(path.join('POUs', 'Main.TcPOU'), MAIN_TCPOU);
    write(path.join('_Libraries', 'Beckhoff', 'Tc2_Standard', '3.4.3.0', 'Tc2_Standard.compiled-library'), '');

    const errors: string[] = [];
    const idx = new WorkspaceIndex({ workspaceRoot: tmpDir });
    idx.on('error', (err) => errors.push((err as Error).message));
    idx.initialize();

    expect(errors.some(msg => msg.includes('Tc2_MC2') && msg.includes('not found'))).toBe(true);
  });

  it('indexes all libraries when plcproj has no libraryRefs', () => {
    // Use the original PLCPROJ_XML which has no library refs
    write('MyPLC.plcproj', PLCPROJ_XML);
    write(path.join('POUs', 'Main.TcPOU'), MAIN_TCPOU);
    write(path.join('_Libraries', 'Vendor', 'SomeLib', '1.0', 'SomeLib.compiled-library'), '');
    write(path.join('_Libraries', 'Vendor', 'OtherLib', '2.0', 'OtherLib.compiled-library'), '');

    const idx = new WorkspaceIndex({ workspaceRoot: tmpDir });
    idx.on('error', () => { /* suppress */ });
    idx.initialize();

    const files = idx.getProjectFiles();
    const mainUri = files.find(f => f.endsWith('Main.TcPOU'));
    expect(mainUri).toBeDefined();

    const typeNames = idx.getLibraryTypeNames(mainUri!);
    // With no refs, all libraries should be indexed (fallback behavior)
    expect(typeNames.has('SOMELIB')).toBe(true);
    expect(typeNames.has('OTHERLIB')).toBe(true);
  });
});
