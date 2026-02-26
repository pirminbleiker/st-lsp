import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  readProjectFile,
  isProjectFile,
  PROJECT_FILE_EXTENSIONS,
} from '../twincat/projectReader';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'projectReader-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function write(file: string, content: string): string {
  const fullPath = path.join(tmpDir, file);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, 'utf-8');
  return fullPath;
}

// ---------------------------------------------------------------------------
// PROJECT_FILE_EXTENSIONS / isProjectFile
// ---------------------------------------------------------------------------

describe('PROJECT_FILE_EXTENSIONS', () => {
  it('includes .tspproj', () => {
    expect(PROJECT_FILE_EXTENSIONS).toContain('.tspproj');
  });

  it('includes .tsproj', () => {
    expect(PROJECT_FILE_EXTENSIONS).toContain('.tsproj');
  });

  it('includes .plcproj', () => {
    expect(PROJECT_FILE_EXTENSIONS).toContain('.plcproj');
  });
});

describe('isProjectFile', () => {
  it('returns true for .tspproj', () => {
    expect(isProjectFile('lib.tspproj')).toBe(true);
  });

  it('returns true for .tsproj', () => {
    expect(isProjectFile('project.tsproj')).toBe(true);
  });

  it('returns true for .plcproj', () => {
    expect(isProjectFile('plc.plcproj')).toBe(true);
  });

  it('returns false for unrecognised extension', () => {
    expect(isProjectFile('foo.sln')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// TcSmProject format
// ---------------------------------------------------------------------------

const TCSMPROJECT_XML = `<?xml version="1.0" encoding="utf-8"?>
<TcSmProject TcSmVersion="1.0.0.1" SchemaVersion="1.0.0.1">
  <Project Name="lib" Id="{12345678-1234-1234-1234-123456789012}">
    <Plc>
      <Project File="lib.xti"/>
    </Plc>
  </Project>
</TcSmProject>`;

const PLCPROJ_XML = `<?xml version="1.0" encoding="utf-8"?>
<Project ToolsVersion="15.0" xmlns="http://schemas.microsoft.com/developer/msbuild/2003">
  <PropertyGroup>
    <Name>mobject_core</Name>
    <DefaultNamespace>mobject-core</DefaultNamespace>
    <Company>mobject</Company>
    <ProjectVersion>0.8.0</ProjectVersion>
  </PropertyGroup>
  <ItemGroup>
    <Compile Include="Foo.TcPOU" />
    <Compile Include="Bar.TcGVL" />
    <Compile Include="Baz.txt" />
    <Folder Include="mobject-collections\\Dictionary" />
    <Folder Include="mobject-core\\Impl" />
    <PlcProjectOptions>
      <XmlArchive>
        <Data>
          <v>DisabledWarningIds</v><v>355,394</v>
        </Data>
      </XmlArchive>
    </PlcProjectOptions>
  </ItemGroup>
</Project>`;

describe('TcSmProject format (.tspproj)', () => {
  it('discovers source files via sibling .plcproj', () => {
    write('lib.tspproj', TCSMPROJECT_XML);
    write('lib.plcproj', PLCPROJ_XML);
    const result = readProjectFile(path.join(tmpDir, 'lib.tspproj'));
    expect(result.warnings).toHaveLength(0);
    expect(result.fileUris).toHaveLength(2);
    expect(result.fileUris.some((u) => u.endsWith('Foo.TcPOU'))).toBe(true);
    expect(result.fileUris.some((u) => u.endsWith('Bar.TcGVL'))).toBe(true);
  });

  it('emits no warning when sibling .plcproj is found', () => {
    write('lib.tspproj', TCSMPROJECT_XML);
    write('lib.plcproj', PLCPROJ_XML);
    const result = readProjectFile(path.join(tmpDir, 'lib.tspproj'));
    expect(result.warnings).toHaveLength(0);
  });

  it('emits a warning when no sibling .plcproj exists', () => {
    write('lib.tspproj', TCSMPROJECT_XML);
    const result = readProjectFile(path.join(tmpDir, 'lib.tspproj'));
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.fileUris).toHaveLength(0);
  });

  it('extracts metadata from sibling .plcproj', () => {
    write('lib.tspproj', TCSMPROJECT_XML);
    write('lib.plcproj', PLCPROJ_XML);
    const result = readProjectFile(path.join(tmpDir, 'lib.tspproj'));
    expect(result.metadata).toBeDefined();
    expect(result.metadata!.name).toBe('mobject_core');
    expect(result.metadata!.namespace).toBe('mobject-core');
    expect(result.metadata!.company).toBe('mobject');
    expect(result.metadata!.version).toBe('0.8.0');
  });

  it('extracts folders from sibling .plcproj with forward-slash normalisation', () => {
    write('lib.tspproj', TCSMPROJECT_XML);
    write('lib.plcproj', PLCPROJ_XML);
    const result = readProjectFile(path.join(tmpDir, 'lib.tspproj'));
    expect(result.folders).toContain('mobject-collections/Dictionary');
    expect(result.folders).toContain('mobject-core/Impl');
  });
});

// ---------------------------------------------------------------------------
// MSBuild format (.plcproj)
// ---------------------------------------------------------------------------

describe('MSBuild format (.plcproj)', () => {
  it('discovers source files', () => {
    write('lib.plcproj', PLCPROJ_XML);
    const result = readProjectFile(path.join(tmpDir, 'lib.plcproj'));
    expect(result.fileUris).toHaveLength(2);
    expect(result.fileUris.some((u) => u.endsWith('Foo.TcPOU'))).toBe(true);
    expect(result.fileUris.some((u) => u.endsWith('Bar.TcGVL'))).toBe(true);
  });

  it('skips non-source Compile entries silently', () => {
    write('lib.plcproj', PLCPROJ_XML);
    const result = readProjectFile(path.join(tmpDir, 'lib.plcproj'));
    expect(result.fileUris.every((u) => !u.endsWith('.txt'))).toBe(true);
  });

  it('returns empty warnings for valid file', () => {
    write('lib.plcproj', PLCPROJ_XML);
    const result = readProjectFile(path.join(tmpDir, 'lib.plcproj'));
    expect(result.warnings).toHaveLength(0);
  });

  it('emits a warning for empty project', () => {
    write('empty.plcproj', '<Project></Project>');
    const result = readProjectFile(path.join(tmpDir, 'empty.plcproj'));
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// PropertyGroup metadata
// ---------------------------------------------------------------------------

describe('PropertyGroup metadata extraction', () => {
  it('extracts all metadata fields from .plcproj', () => {
    write('lib.plcproj', PLCPROJ_XML);
    const result = readProjectFile(path.join(tmpDir, 'lib.plcproj'));
    expect(result.metadata).toBeDefined();
    expect(result.metadata!.name).toBe('mobject_core');
    expect(result.metadata!.namespace).toBe('mobject-core');
    expect(result.metadata!.company).toBe('mobject');
    expect(result.metadata!.version).toBe('0.8.0');
  });

  it('returns undefined metadata for project without PropertyGroup', () => {
    const xml = `<Project><ItemGroup><Compile Include="A.TcPOU" /></ItemGroup></Project>`;
    write('bare.plcproj', xml);
    const result = readProjectFile(path.join(tmpDir, 'bare.plcproj'));
    expect(result.metadata).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Folder structure
// ---------------------------------------------------------------------------

describe('Folder structure extraction', () => {
  it('returns folder paths with forward-slash normalisation', () => {
    write('lib.plcproj', PLCPROJ_XML);
    const result = readProjectFile(path.join(tmpDir, 'lib.plcproj'));
    expect(result.folders).toContain('mobject-collections/Dictionary');
    expect(result.folders).toContain('mobject-core/Impl');
  });

  it('returns empty folders array when no Folder elements present', () => {
    const xml = `<Project><ItemGroup><Compile Include="A.TcPOU" /></ItemGroup></Project>`;
    write('nofolders.plcproj', xml);
    const result = readProjectFile(path.join(tmpDir, 'nofolders.plcproj'));
    expect(result.folders).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// DisabledWarningIds extraction
// ---------------------------------------------------------------------------

describe('DisabledWarningIds extraction', () => {
  it('extracts warning IDs from XmlArchive in .plcproj', () => {
    write('lib.plcproj', PLCPROJ_XML);
    const result = readProjectFile(path.join(tmpDir, 'lib.plcproj'));
    expect(result.disabledWarnings).toEqual([355, 394]);
  });

  it('returns empty array when no DisabledWarningIds present', () => {
    const xml = `<Project><ItemGroup><Compile Include="A.TcPOU" /></ItemGroup></Project>`;
    write('nowarnings.plcproj', xml);
    const result = readProjectFile(path.join(tmpDir, 'nowarnings.plcproj'));
    expect(result.disabledWarnings).toEqual([]);
  });
});
