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
} from './projectReader';
import { parse } from '../parser/parser';
import { SourceFile, ParseError } from '../parser/ast';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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
  if (uri.startsWith('file:///')) {
    // Windows: file:///C:/… → C:/…
    return decodeURIComponent(uri.slice('file:///'.length));
  }
  if (uri.startsWith('file://')) {
    // POSIX: file:///home/… → /home/…
    return decodeURIComponent(uri.slice('file://'.length));
  }
  return uri;
}

function pathToUri(absPath: string): string {
  const normalised = absPath.split(path.sep).join('/');
  return normalised.startsWith('/') ? `file://${normalised}` : `file:///${normalised}`;
}

/**
 * Recursively collect all files matching a predicate under a directory.
 * Silently skips directories that cannot be read.
 */
function findFilesSync(dir: string, predicate: (filePath: string) => boolean): string[] {
  const results: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findFilesSync(fullPath, predicate));
    } else if (entry.isFile() && predicate(fullPath)) {
      results.push(fullPath);
    }
  }
  return results;
}

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

  /** Merged flat set of all source file URIs across all projects. */
  private allSourceUris = new Set<string>();

  /** Cached parse results keyed by source file URI. */
  private readonly astCache = new Map<string, { ast: SourceFile; errors: ParseError[] }>();

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
  getAst(uri: string): { ast: SourceFile; errors: ParseError[] } | undefined {
    if (!this.initialised) this.initialize();
    const normalised = uri.startsWith('file://') ? uri : pathToUri(uri);
    return this.astCache.get(normalised);
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
      for (const w of result.warnings) {
        this.emit('error', new Error(w));
      }
    } catch (err) {
      this.emit('error', err instanceof Error ? err : new Error(String(err)));
      this.projectSources.delete(projectFilePath);
    }
    this.rebuildAllSources();
  }

  /**
   * Remove a project file from the index.
   */
  private removeProjectFile(projectFilePath: string): void {
    this.projectSources.delete(projectFilePath);
    this.rebuildAllSources();
  }

  /**
   * Rebuild the flat allSourceUris set from projectSources.
   * Pre-parses newly discovered files and evicts stale cache entries.
   */
  private rebuildAllSources(): void {
    const next = new Set<string>();
    for (const uris of this.projectSources.values()) {
      for (const uri of uris) next.add(uri);
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
      const result = parse(text);
      this.astCache.set(uri, { ast: result.ast, errors: result.errors });
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
