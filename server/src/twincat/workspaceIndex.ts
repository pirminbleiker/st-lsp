/**
 * TwinCAT 3 workspace index.
 *
 * Watches the workspace for .tsproj and .plcproj project files, keeps an
 * up-to-date set of all project source files, and exposes a simple API for
 * callers to query membership.
 *
 * Design principles:
 * - Pure in-process state: no external daemon or IPC.
 * - Lazy: scanning only happens when first requested or when a watcher fires.
 * - Observable: emits events when the index changes so LSP consumers can
 *   invalidate diagnostics / completion caches.
 */

import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';
import {
  isProjectFile,
  PROJECT_FILE_EXTENSIONS,
  readProjectFile,
  LibraryRef,
} from './projectReader';
import { parse } from '../parser/parser';
import { SourceFile, ParseError } from '../parser/ast';
import { extractST, ExtractionResult } from './tcExtractor';
import { findFilesSync } from './fsUtils';
import { isLibraryFile, readLibraryIndex, LibraryIndex, LibrarySymbol } from './libraryZipReader';
export { findFilesSync } from './fsUtils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A fully cached entry for a source file: parsed AST, parse errors, and the
 * extraction result (needed to reconstruct a PositionMapper for TcPOU files).
 */
export interface CachedParseResult {
  ast: SourceFile;
  errors: ParseError[];
  extraction: ExtractionResult;
}

export interface WorkspaceIndexOptions {
  /**
   * Workspace root URI (file://…) or absolute path.
   * The index will scan and watch this directory tree.
   */
  workspaceRoot: string;
}

export interface WorkspaceIndexEvents {
  /** Emitted whenever the set of tracked files changes. */
  change: [];
  /** Emitted when an error occurs during scanning or watching. */
  error: [error: Error];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function uriToPath(uri: string): string {
  if (!uri.startsWith('file://')) return uri;

  // Strip the 'file://' scheme prefix → gives '/home/foo' on POSIX or '/C:/foo' on Windows
  const raw = decodeURIComponent(uri.slice('file://'.length));

  // On Windows, a file URI path looks like '/C:/...' — strip the leading slash.
  if (raw.length >= 3 && raw[0] === '/' && /[A-Za-z]/.test(raw[1]) && raw[2] === ':') {
    return raw.slice(1);
  }

  return raw;
}

function pathToUri(absPath: string): string {
  const normalised = absPath.split(path.sep).join('/');
  return normalised.startsWith('/') ? `file://${normalised}` : `file:///${normalised}`;
}

/**
 * Recursively collect all files matching a predicate under a directory.
 * Re-exported from fsUtils for backward compatibility.
 */

// ---------------------------------------------------------------------------
// WorkspaceIndex
// ---------------------------------------------------------------------------

/**
 * Maintains a live index of all TwinCAT source files belonging to any project
 * file found under the workspace root.
 *
 * ### Usage
 *
 * ```ts
 * const idx = new WorkspaceIndex({ workspaceRoot: '/path/to/workspace' });
 * await idx.initialize();
 *
 * // Query
 * const files = idx.getProjectFiles('/path/to/workspace');
 * const belongs = idx.isProjectFile('file:///path/to/workspace/Main.TcPOU');
 *
 * // Clean up when the server shuts down
 * idx.dispose();
 * ```
 */
export class WorkspaceIndex extends EventEmitter {
  private readonly rootPath: string;

  /** Map from project file path → set of source file URIs it provides. */
  private readonly projectSources = new Map<string, Set<string>>();

  /** Map from project file path → library refs declared in that project. */
  private readonly projectLibraryRefs = new Map<string, LibraryRef[]>();

  /**
   * Map from project file path → library indexes extracted from the library
   * files (.library / .compiled-library*) referenced by that project.
   */
  private readonly projectLibraryIndexes = new Map<string, LibraryIndex[]>();

  /** Map from source file URI → the project file path that owns it. */
  private readonly fileToProject = new Map<string, string>();

  /** Merged flat set of all source file URIs across all projects. */
  private allSourceUris = new Set<string>();

  /** Cached parse results keyed by source file URI. */
  private readonly astCache = new Map<string, CachedParseResult>();

  /** FSWatcher instances keyed by watched path. */
  private readonly watchers = new Map<string, fs.FSWatcher>();

  private initialised = false;
  private disposed = false;

  constructor(options: WorkspaceIndexOptions) {
    super();
    this.rootPath = uriToPath(options.workspaceRoot);
  }

  // ── Public API ─────────────────────────────────────────────────────────

  /**
   * Scan the workspace for project files and set up file watchers.
   * Safe to call multiple times (subsequent calls are no-ops).
   */
  initialize(): void {
    if (this.initialised || this.disposed) return;
    this.initialised = true;

    this.scan();
    this.watchRoot();
  }

  /**
   * Return the URIs of all source files belonging to projects under the
   * given workspace URI (or path).  If not yet initialised, triggers a
   * synchronous scan first.
   *
   * @param workspaceUri  Workspace root URI or absolute path.
   *                      The current implementation returns files across the
   *                      entire indexed workspace; the parameter is accepted
   *                      for future scoped queries.
   */
  getProjectFiles(_workspaceUri?: string): string[] {
    if (!this.initialised) this.initialize();
    return Array.from(this.allSourceUris);
  }

  /**
   * Return true if the given URI (or absolute path) belongs to any indexed
   * TwinCAT project.
   */
  isProjectFile(uri: string): boolean {
    if (!this.initialised) this.initialize();
    // Normalise to URI form for lookup
    const normalised = uri.startsWith('file://') ? uri : pathToUri(uri);
    return this.allSourceUris.has(normalised);
  }

  /**
   * Return the cached parse result for a source file URI, or undefined if not
   * yet cached.  The cache is populated on file discovery and invalidated on
   * file change.
   */
  getAst(uri: string): CachedParseResult | undefined {
    if (!this.initialised) this.initialize();
    const normalised = uri.startsWith('file://') ? uri : pathToUri(uri);
    return this.astCache.get(normalised);
  }

  /**
   * Return the cached ExtractionResult for a source file URI, or undefined if
   * not yet cached.  Used by handlers to build a PositionMapper without disk I/O.
   */
  getExtraction(uri: string): ExtractionResult | undefined {
    if (!this.initialised) this.initialize();
    const normalised = uri.startsWith('file://') ? uri : pathToUri(uri);
    return this.astCache.get(normalised)?.extraction;
  }

  /**
   * Update the cached entry for a source file (e.g. when the active document
   * changes and has been re-parsed from the in-memory TextDocument).
   * Only caches if the URI is known to the index (prevents cache pollution).
   */
  updateAst(uri: string, ast: SourceFile, errors: ParseError[], extraction: ExtractionResult): void {
    const normalised = uri.startsWith('file://') ? uri : pathToUri(uri);
    if (this.allSourceUris.has(normalised)) {
      this.astCache.set(normalised, { ast, errors, extraction });
    }
  }

  /**
   * Return the library references declared in the project that owns the given
   * source file URI.  Returns an empty array if the file is not part of any
   * indexed project or the project declares no library references.
   */
  getLibraryRefs(fileUri: string): LibraryRef[] {
    if (!this.initialised) this.initialize();
    const normalised = fileUri.startsWith('file://') ? fileUri : pathToUri(fileUri);
    const projectPath = this.fileToProject.get(normalised);
    if (!projectPath) return [];
    return this.projectLibraryRefs.get(projectPath) ?? [];
  }

  /**
   * Return all library symbols for the project that owns the given source file.
   * Includes full signature information (inputs, outputs, extends, etc.) for
   * source libraries, and stub symbols for compiled libraries.
   */
  getLibrarySymbols(fileUri: string): LibrarySymbol[] {
    if (!this.initialised) this.initialize();
    const normalised = fileUri.startsWith('file://') ? fileUri : pathToUri(fileUri);
    const projectPath = this.fileToProject.get(normalised);
    if (!projectPath) return [];
    const indexes = this.projectLibraryIndexes.get(projectPath) ?? [];
    return indexes.flatMap(idx => idx.symbols);
  }

  /**
   * Return the set of type/identifier names extracted from the library files
   * referenced by the project that owns the given source file URI.
   *
   * Returns an empty Set if the file is not part of any indexed project, the
   * project references no library files, or no library files were found on disk.
   */
  getLibraryTypeNames(fileUri: string): ReadonlySet<string> {
    if (!this.initialised) this.initialize();
    const normalised = fileUri.startsWith('file://') ? fileUri : pathToUri(fileUri);
    const projectPath = this.fileToProject.get(normalised);
    if (!projectPath) return new Set();
    const indexes = this.projectLibraryIndexes.get(projectPath) ?? [];
    const names = new Set<string>();
    for (const idx of indexes) {
      names.add(idx.name.toUpperCase()); // namespace name
      for (const sym of idx.symbols) {
        names.add(sym.name.toUpperCase());
      }
    }
    return names;
  }

  /**
   * Invalidate the cached AST for a URI.  Call this when a document's content
   * changes (e.g. from `documents.onDidChangeContent`).
   */
  invalidateAst(uri: string): void {
    const normalised = uri.startsWith('file://') ? uri : pathToUri(uri);
    this.astCache.delete(normalised);
  }

  /**
   * Stop all watchers and release resources.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const watcher of this.watchers.values()) {
      try { watcher.close(); } catch { /* ignore */ }
    }
    this.watchers.clear();
    this.astCache.clear();
    this.projectLibraryIndexes.clear();
    this.removeAllListeners();
  }

  // ── Internal ───────────────────────────────────────────────────────────

  /**
   * Scan rootPath for project files and index them all.
   */
  private scan(): void {
    const projectFiles = findFilesSync(this.rootPath, isProjectFile);
    for (const pf of projectFiles) {
      this.indexProjectFile(pf);
    }
  }

  /**
   * Read a single project file and update the index.
   */
  private indexProjectFile(projectFilePath: string): void {
    try {
      const result = readProjectFile(projectFilePath);
      this.projectSources.set(projectFilePath, new Set(result.fileUris));
      this.projectLibraryRefs.set(projectFilePath, result.libraryRefs);
      for (const w of result.warnings) {
        this.emit('error', new Error(w));
      }
      // Scan _Libraries/ directories for .library / .compiled-library* files
      // and extract type names from each one.
      this.indexLibraryFiles(projectFilePath);
    } catch (err) {
      this.emit('error', err instanceof Error ? err : new Error(String(err)));
      this.projectSources.delete(projectFilePath);
      this.projectLibraryRefs.delete(projectFilePath);
      this.projectLibraryIndexes.delete(projectFilePath);
    }
    this.rebuildAllSources();
  }

  /**
   * Remove a project file from the index.
   */
  private removeProjectFile(projectFilePath: string): void {
    this.projectSources.delete(projectFilePath);
    this.projectLibraryRefs.delete(projectFilePath);
    this.projectLibraryIndexes.delete(projectFilePath);
    this.rebuildAllSources();
  }

  /**
   * Scan `_Libraries/` directories for TwinCAT library files and extract type
   * names for the given project.
   *
   * TwinCAT always places the `_Libraries/` folder as a **sibling of the
   * `.plcproj`** file that references those libraries:
   *
   *   <plcproj-dir>/_Libraries/<vendor>/<libName>/<version>/<libName>.<ext>
   *
   * For TcSmProject files (`.tsproj` / `.tspproj`) the Compile items live in
   * sibling `.plcproj` files, so we must find those `.plcproj` files first and
   * look for `_Libraries/` next to each of them.
   *
   * Both .library and .compiled-library* formats are supported.
   */
  private indexLibraryFiles(projectFilePath: string): void {
    const refs = this.projectLibraryRefs.get(projectFilePath) ?? [];

    // Build a case-insensitive set of referenced library names for matching.
    const refNamesUpper = new Set(refs.map(r => r.name.toUpperCase()));

    // Determine which directories to scan for _Libraries/.
    const plcprojDirs = this.resolvePlcprojDirs(projectFilePath);

    const indexes: LibraryIndex[] = [];

    for (const dir of plcprojDirs) {
      const libsDir = path.join(dir, '_Libraries');
      let libraryFiles: string[];
      try {
        libraryFiles = findFilesSync(libsDir, isLibraryFile);
      } catch {
        continue; // _Libraries does not exist for this project — skip.
      }

      // When libraryRefs are available, only read files whose path contains a
      // referenced library name (the _Libraries/ layout places the library name
      // as a directory component: _Libraries/<vendor>/<libName>/<version>/...).
      const filesToRead = refNamesUpper.size > 0
        ? libraryFiles.filter(f => {
            const upper = f.toUpperCase();
            for (const name of refNamesUpper) {
              if (upper.includes(path.sep + name + path.sep) || upper.includes('/' + name + '/')) {
                return true;
              }
            }
            return false;
          })
        : libraryFiles;

      for (const libFile of filesToRead) {
        try {
          const idx = readLibraryIndex(libFile);
          // Double-check: only keep indexes whose name matches a ref.
          if (refNamesUpper.size === 0 || refNamesUpper.has(idx.name.toUpperCase())) {
            indexes.push(idx);
          }
        } catch {
          // Skip unreadable library files silently.
        }
      }
    }

    // Warn when a referenced library was not found on disk.
    if (refs.length > 0) {
      const foundNames = new Set(indexes.map(idx => idx.name.toUpperCase()));
      for (const ref of refs) {
        if (!foundNames.has(ref.name.toUpperCase())) {
          this.emit('error', new Error(
            `Referenced library '${ref.name}'${ref.version ? ` (${ref.version})` : ''} not found in _Libraries/`
          ));
        }
      }
    }

    this.projectLibraryIndexes.set(projectFilePath, indexes);
  }

  /**
   * Return the set of directories that own `.plcproj` files for the given
   * project entry point.
   *
   * - For a `.plcproj`: returns `[dirname(projectFilePath)]`.
   * - For a `.tsproj` / `.tspproj`: scans the project directory for sibling
   *   `.plcproj` files (as `readProjectFile` does) and returns their directories.
   */
  private resolvePlcprojDirs(projectFilePath: string): string[] {
    const ext = path.extname(projectFilePath).toLowerCase();
    if (ext === '.plcproj') {
      return [path.dirname(projectFilePath)];
    }

    // TcSmProject (.tsproj / .tspproj) — find sibling .plcproj files.
    const tsprojDir = path.dirname(projectFilePath);
    try {
      const plcprojFiles = findFilesSync(
        tsprojDir,
        (f) => path.extname(f).toLowerCase() === '.plcproj',
      );
      return plcprojFiles.map((f) => path.dirname(f));
    } catch {
      return [];
    }
  }

  /**
   * Rebuild the flat allSourceUris set from projectSources.
   * Pre-parses newly discovered files and evicts stale cache entries.
   */
  private rebuildAllSources(): void {
    const next = new Set<string>();
    const nextFileToProject = new Map<string, string>();
    for (const [projectPath, uris] of this.projectSources.entries()) {
      for (const uri of uris) {
        next.add(uri);
        nextFileToProject.set(uri, projectPath);
      }
    }
    // Rebuild fileToProject
    this.fileToProject.clear();
    for (const [uri, proj] of nextFileToProject) {
      this.fileToProject.set(uri, proj);
    }
    // Evict stale cache entries for files no longer in the index.
    for (const uri of this.astCache.keys()) {
      if (!next.has(uri)) this.astCache.delete(uri);
    }
    // Pre-parse newly discovered files.
    for (const uri of next) {
      if (!this.astCache.has(uri)) {
        this.parseAndCache(uri);
      }
    }
    this.allSourceUris = next;
    this.emit('change');
  }

  /**
   * Read and parse a source file, storing the result in the AST cache.
   * Silently no-ops if the file cannot be read.
   */
  private parseAndCache(uri: string): void {
    try {
      const filePath = uriToPath(uri);
      const text = fs.readFileSync(filePath, 'utf-8');
      const ext = path.extname(filePath);
      const extraction = extractST(text, ext);
      const result = parse(extraction.source);
      if (extraction.containerName) {
        for (const decl of result.ast.declarations) {
          if (decl.kind === 'GvlDeclaration') {
            decl.name = extraction.containerName;
          }
        }
      }
      this.astCache.set(uri, { ast: result.ast, errors: result.errors, extraction });
    } catch {
      // File may not exist or may not be readable yet — skip silently.
    }
  }

  /**
   * Watch the workspace root for project file additions/removals/changes.
   *
   * We use a single recursive watcher on the root when the platform supports
   * it (macOS, Windows) and fall back to polling otherwise.
   */
  private watchRoot(): void {
    if (this.disposed) return;
    try {
      const watcher = fs.watch(
        this.rootPath,
        { recursive: true, persistent: false },
        (eventType, filename) => {
          if (!filename) return;
          const fullPath = path.resolve(this.rootPath, filename);
          if (!isProjectFile(fullPath)) return;

          if (eventType === 'rename') {
            // File added or removed
            if (fs.existsSync(fullPath)) {
              this.indexProjectFile(fullPath);
              this.watchProjectFile(fullPath);
            } else {
              this.removeProjectFile(fullPath);
              const w = this.watchers.get(fullPath);
              if (w) { try { w.close(); } catch { /* ignore */ } this.watchers.delete(fullPath); }
            }
          } else if (eventType === 'change') {
            this.indexProjectFile(fullPath);
          }
        },
      );
      watcher.on('error', (err) => this.emit('error', err));
      this.watchers.set(this.rootPath, watcher);
    } catch {
      // Recursive watch not supported on this platform; watch individual
      // project files that were already discovered during the initial scan.
      for (const pf of this.projectSources.keys()) {
        this.watchProjectFile(pf);
      }
    }
  }

  /**
   * Watch a single project file for content changes.
   */
  private watchProjectFile(projectFilePath: string): void {
    if (this.disposed || this.watchers.has(projectFilePath)) return;
    try {
      const watcher = fs.watch(
        projectFilePath,
        { persistent: false },
        () => { this.indexProjectFile(projectFilePath); },
      );
      watcher.on('error', (err) => this.emit('error', err));
      this.watchers.set(projectFilePath, watcher);
    } catch {
      // File may have been deleted before we could watch it — ignore.
    }
  }
}

// ---------------------------------------------------------------------------
// Convenience factory
// ---------------------------------------------------------------------------

/**
 * Create and initialise a WorkspaceIndex for the given workspace URI or path.
 */
export function createWorkspaceIndex(workspaceRoot: string): WorkspaceIndex {
  const idx = new WorkspaceIndex({ workspaceRoot });
  idx.initialize();
  return idx;
}
