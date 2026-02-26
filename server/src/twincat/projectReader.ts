/**
 * TwinCAT 3 project file reader.
 *
 * Parses .tsproj / .tspproj (TwinCAT Solution projects) and .plcproj (PLC
 * project) XML files to discover which source files (.st / .TcPOU / .TcGVL /
 * .TcDUT / .TcIO) belong to the project.
 *
 * Two XML formats are handled:
 *
 * 1. MSBuild-style (.plcproj, and older .tsproj):
 *
 *   <ItemGroup>
 *     <Compile Include="Path\To\File.TcPOU" />
 *     …
 *   </ItemGroup>
 *
 * 2. TcSmProject-style (.tsproj / .tspproj from TwinCAT XAE):
 *
 *   <TcSmProject …>
 *     <Project …>
 *       <Plc><Project File="mobject-core.xti"/></Plc>
 *     </Project>
 *   </TcSmProject>
 *
 *   In this case the .xti references are TwinCAT fragments; the actual
 *   Compile items live in the sibling .plcproj file(s) in the same directory.
 *
 * The returned file URIs are absolute `file://` URIs.
 */

import * as fs from 'fs';
import * as path from 'path';
import { extractStFromTwinCAT, OffsetMap } from './tcExtractor';

/**
 * Result of reading a single project file.
 */
export interface ProjectReadResult {
  /** Absolute file URIs of every source file discovered in the project. */
  fileUris: string[];
  /** Any non-fatal warnings encountered during parsing. */
  warnings: string[];
  /** Project metadata extracted from PropertyGroup elements. */
  metadata?: ProjectMetadata;
  /**
   * Virtual folder paths declared in the project (backslash-separated in the
   * XML; normalised to forward slashes in this result).
   */
  folders: string[];
  /**
   * Warning IDs that the project has explicitly disabled via
   * DisabledWarningIds in the XmlArchive blob.
   */
  disabledWarnings: number[];
}

/**
 * Project metadata extracted from MSBuild PropertyGroup elements.
 */
export interface ProjectMetadata {
  name?: string;
  namespace?: string;
  company?: string;
  version?: string;
}

/**
 * Result of extracting ST code from a source file.
 * TODO: Replace extraction logic with tcExtractor implementation (sl-adf4)
 */
export interface ExtractedStFile {
  /** The extracted ST code content */
  stCode: string;
  /** Offset mapping for location tracking */
  offsets: OffsetMap;
}

/**
 * Minimal XML attribute extractor.
 * Handles single- and double-quoted attribute values.
 */
function extractAttribute(tag: string, attr: string): string | undefined {
  // Match attr="value" or attr='value'
  const re = new RegExp(`${attr}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i');
  const m = re.exec(tag);
  if (!m) return undefined;
  return m[1] ?? m[2];
}

/**
 * Convert a Windows-style relative path from the project file to an absolute
 * file URI, resolving relative to the directory that contains the project file.
 */
function toFileUri(projectDir: string, includePath: string): string {
  // Normalise Windows path separators
  const normalised = includePath.replace(/\\/g, path.sep);
  const absolute = path.resolve(projectDir, normalised);
  // Convert to file URI (handle Windows drive letters)
  const uriPath = absolute.split(path.sep).join('/');
  return uriPath.startsWith('/') ? `file://${uriPath}` : `file:///${uriPath}`;
}

/**
 * Extract `<Compile Include="…" />` items from MSBuild XML text.
 *
 * The function is intentionally kept simple: it does not load a full XML
 * parser to avoid runtime dependencies.  The MSBuild format is regular
 * enough that regex extraction is reliable.
 */
function extractCompileIncludes(xml: string): string[] {
  const results: string[] = [];
  // Match self-closing or regular <Compile …> tags
  const tagRe = /<Compile\s([^>]*?)(?:\/>|>)/gi;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(xml)) !== null) {
    const include = extractAttribute(m[1], 'Include');
    if (include) results.push(include);
  }
  return results;
}

/**
 * Extract `<Folder Include="…" />` items from MSBuild XML text.
 * Returns paths with backslashes normalised to forward slashes.
 */
function extractFolderIncludes(xml: string): string[] {
  const results: string[] = [];
  const tagRe = /<Folder\s([^>]*?)(?:\/>|>)/gi;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(xml)) !== null) {
    const include = extractAttribute(m[1], 'Include');
    if (include) results.push(include.replace(/\\/g, '/'));
  }
  return results;
}

/**
 * Return true if the XML document uses the TcSmProject root element (the
 * TwinCAT XAE solution/project format) rather than plain MSBuild XML.
 */
function isTcSmProjectFormat(xml: string): boolean {
  return /<TcSmProject[\s>]/i.test(xml);
}

/**
 * Extract project metadata from MSBuild PropertyGroup elements.
 */
function extractMetadata(xml: string): ProjectMetadata | undefined {
  function tag(name: string): string | undefined {
    const re = new RegExp(`<${name}\\s*>([^<]*)</${name}>`, 'i');
    const m = re.exec(xml);
    return m ? m[1].trim() : undefined;
  }
  const name = tag('Name');
  const namespace = tag('DefaultNamespace');
  const company = tag('Company');
  const version = tag('ProjectVersion');
  if (!name && !namespace && !company && !version) return undefined;
  return { name, namespace, company, version };
}

/**
 * Extract warning IDs from the DisabledWarningIds entry in an XmlArchive blob.
 *
 * The blob stores key-value pairs as adjacent <v> elements:
 *   <v>DisabledWarningIds</v><v>355,394</v>
 */
function extractDisabledWarnings(xml: string): number[] {
  const re = /<v>\s*DisabledWarningIds\s*<\/v>\s*<v>([^<]*)<\/v>/i;
  const m = re.exec(xml);
  if (!m) return [];
  return m[1]
    .split(',')
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => !isNaN(n));
}

/**
 * Source file extensions that are considered TwinCAT source files.
 */
const SOURCE_EXTENSIONS = new Set([
  '.st',
  '.tcpou',
  '.tcgvl',
  '.tcdut',
  '.tcio',
  '.tctask',
]);

function isSourceFile(filePath: string): boolean {
  return SOURCE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

/**
 * Read a .tsproj, .tspproj, or .plcproj file and return the list of source
 * file URIs together with metadata, folder declarations, and disabled warnings.
 *
 * @param projectFilePath Absolute path to the project file.
 */
export function readProjectFile(projectFilePath: string): ProjectReadResult {
  const warnings: string[] = [];
  const fileUris: string[] = [];

  let xml: string;
  try {
    xml = fs.readFileSync(projectFilePath, 'utf-8');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to read project file "${projectFilePath}": ${msg}`);
  }

  const projectDir = path.dirname(projectFilePath);

  // TcSmProject (.tsproj / .tspproj) — the Compile items live in the sibling
  // .plcproj file(s) in the same directory; read those instead.
  if (isTcSmProjectFormat(xml)) {
    let plcprojFiles: string[];
    try {
      plcprojFiles = fs
        .readdirSync(projectDir)
        .filter((f) => path.extname(f).toLowerCase() === '.plcproj')
        .map((f) => path.join(projectDir, f));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Failed to scan directory for .plcproj files next to "${projectFilePath}": ${msg}`,
      );
    }

    const allFolders: string[] = [];
    let combinedMetadata: ProjectMetadata | undefined;

    for (const plcproj of plcprojFiles) {
      let plcXml: string;
      try {
        plcXml = fs.readFileSync(plcproj, 'utf-8');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        warnings.push(`Could not read sibling .plcproj "${plcproj}": ${msg}`);
        continue;
      }
      const plcDir = path.dirname(plcproj);
      for (const include of extractCompileIncludes(plcXml)) {
        if (!isSourceFile(include)) continue;
        fileUris.push(toFileUri(plcDir, include));
      }
      allFolders.push(...extractFolderIncludes(plcXml));
      if (!combinedMetadata) combinedMetadata = extractMetadata(plcXml);
    }

    if (fileUris.length === 0 && plcprojFiles.length === 0) {
      warnings.push(
        `TcSmProject file "${projectFilePath}" has no sibling .plcproj files. ` +
          'No source files discovered.',
      );
    }

    const disabledWarnings = extractDisabledWarnings(xml);
    return {
      fileUris,
      warnings,
      metadata: combinedMetadata,
      folders: allFolders,
      disabledWarnings,
    };
  }

  // Standard MSBuild format (.plcproj or older .tsproj)
  const includes = extractCompileIncludes(xml);
  for (const include of includes) {
    if (!isSourceFile(include)) {
      // Skip non-source items (e.g. .tcxae, resources) silently
      continue;
    }
    fileUris.push(toFileUri(projectDir, include));
  }

  if (fileUris.length === 0 && includes.length === 0) {
    warnings.push(
      `No <Compile Include="…"> items found in "${projectFilePath}". ` +
        'The file may be empty or use an unexpected format.',
    );
  }

  return {
    fileUris,
    warnings,
    metadata: extractMetadata(xml),
    folders: extractFolderIncludes(xml),
    disabledWarnings: extractDisabledWarnings(xml),
  };
}

/**
 * Supported project file extensions.
 */
export const PROJECT_FILE_EXTENSIONS = ['.tsproj', '.tspproj', '.plcproj'] as const;

export type ProjectFileExtension = (typeof PROJECT_FILE_EXTENSIONS)[number];

/**
 * Return true if the given file path looks like a TwinCAT project file.
 */
export function isProjectFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return PROJECT_FILE_EXTENSIONS.includes(ext as ProjectFileExtension);
}

/**
 * Read a source file and extract ST code.
 * Handles both plain .st files and TwinCAT-wrapped formats (.TcPOU, .TcGVL, etc).
 *
 * TODO: Replace with tcExtractor implementation (sl-adf4)
 *
 * @param filePath - Absolute path to the source file
 * @returns Extracted ST code and offset information
 */
export function readAndExtractStFile(filePath: string): ExtractedStFile {
  let content: string;
  try {
    content = fs.readFileSync(filePath, 'utf-8');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to read file "${filePath}": ${msg}`);
  }

  // TODO: Replace with tcExtractor implementation (sl-adf4)
  const extracted = extractStFromTwinCAT(filePath, content);
  return {
    stCode: extracted.stCode,
    offsets: extracted.offsets,
  };
}

