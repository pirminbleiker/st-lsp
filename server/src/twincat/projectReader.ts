/**
 * TwinCAT 3 project file reader.
 *
 * Parses .tsproj (TwinCAT Solution project) and .plcproj (PLC project) XML
 * files to discover which source files (.st / .TcPOU / .TcGVL / .TcDUT /
 * .TcIO) belong to the project.
 *
 * Both formats use MSBuild-style XML.  The relevant nodes are:
 *
 *   <ItemGroup>
 *     <Compile Include="Path\To\File.TcPOU" />
 *     …
 *   </ItemGroup>
 *
 * The returned file URIs are absolute `file://` URIs.
 */

import * as fs from 'fs';
import * as path from 'path';

/**
 * Result of reading a single project file.
 */
export interface ProjectReadResult {
  /** Absolute file URIs of every source file discovered in the project. */
  fileUris: string[];
  /** Any non-fatal warnings encountered during parsing. */
  warnings: string[];
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
 * Read a .tsproj or .plcproj file and return the list of source file URIs.
 *
 * @param projectFilePath Absolute path to the .tsproj or .plcproj file.
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
  const includes = extractCompileIncludes(xml);

  for (const include of includes) {
    if (!isSourceFile(include)) {
      // Skip non-source items (e.g. .tcxae, resources) silently
      continue;
    }
    const uri = toFileUri(projectDir, include);
    fileUris.push(uri);
  }

  if (fileUris.length === 0 && includes.length === 0) {
    warnings.push(
      `No <Compile Include="…"> items found in "${projectFilePath}". ` +
        'The file may be empty or use an unexpected format.',
    );
  }

  return { fileUris, warnings };
}

/**
 * Supported project file extensions.
 */
export const PROJECT_FILE_EXTENSIONS = ['.tsproj', '.plcproj'] as const;

export type ProjectFileExtension = (typeof PROJECT_FILE_EXTENSIONS)[number];

/**
 * Return true if the given file path looks like a TwinCAT project file.
 */
export function isProjectFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return PROJECT_FILE_EXTENSIONS.includes(ext as ProjectFileExtension);
}
