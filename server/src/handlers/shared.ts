/**
 * Shared utilities for LSP handlers.
 *
 * Centralises common operations so they are not duplicated across handlers.
 */

import * as fs from 'fs';
import * as path from 'path';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { extractST, ExtractionResult, PositionMapper } from '../twincat/tcExtractor';
import { WorkspaceIndex } from '../twincat/workspaceIndex';
import { parse } from '../parser/parser';
import { SourceFile, ParseError } from '../parser/ast';

/** An ExtractionResult that acts as a pass-through identity mapper. */
const PASSTHROUGH_EXTRACTION: ExtractionResult = {
  source: '',
  lineMap: [],
  sections: [],
  passthrough: true,
};

// ---------------------------------------------------------------------------
// Active-document parse cache
// ---------------------------------------------------------------------------

/**
 * A fully resolved parse for a specific document version.
 * Pre-computed by the server once per document version, then shared across
 * all handler invocations that process the same document.
 */
export interface DocumentParseResult {
  /** Document version this was computed for. */
  version: number;
  /** Extraction result (position mapping info for TcPOU / XML files). */
  extraction: ExtractionResult;
  /** PositionMapper for converting extracted↔original coordinates. */
  mapper: PositionMapper;
  /** Parsed AST. */
  ast: SourceFile;
  /** Parse errors. */
  errors: ParseError[];
}

/** Module-level cache shared across all server callbacks. */
const documentParseCache = new Map<string, DocumentParseResult & { _text: string }>();

/**
 * Return a cached parse result for `document`, computing it fresh when the
 * document version has changed since the last call, or when the content
 * differs (guards against test scenarios where version numbers are reused).
 */
export function getOrParse(document: TextDocument): DocumentParseResult {
  const uri = document.uri;
  const text = document.getText();
  const existing = documentParseCache.get(uri);
  if (existing && existing.version === document.version && existing._text === text) return existing;

  const ext = path.extname(uri);
  const extraction = extractST(text, ext);
  const mapper = new PositionMapper(extraction);
  const { ast, errors } = parse(extraction.source);
  if (extraction.containerName) {
    for (const decl of ast.declarations) {
      if (decl.kind === 'GvlDeclaration') {
        decl.name = extraction.containerName;
      }
    }
  }
  const entry = { version: document.version, extraction, mapper, ast, errors, _text: text };
  documentParseCache.set(uri, entry);
  return entry;
}

/**
 * Invalidate the cached parse result for a URI.
 * Should be called when a document's content changes or it is closed.
 */
export function invalidateDocumentCache(uri: string): void {
  documentParseCache.delete(uri);
}

// ---------------------------------------------------------------------------
// mapperForUri
// ---------------------------------------------------------------------------

/**
 * Return a PositionMapper for the given file URI.
 *
 * Lookup order:
 * 1. WorkspaceIndex cache (no disk I/O).
 * 2. Read from disk and extract (fallback when the URI is not yet cached or
 *    the file is not part of any indexed project).
 *
 * Never throws — returns a passthrough identity mapper on any error.
 */
export function mapperForUri(fileUri: string, workspaceIndex?: WorkspaceIndex): PositionMapper {
  // Try the workspace index cache first.
  const cached = workspaceIndex?.getExtraction?.(fileUri);
  if (cached) return new PositionMapper(cached);

  // Fallback: read from disk.
  try {
    const filePath = fileUri.startsWith('file://')
      ? decodeURIComponent(fileUri.replace(/^file:\/\//, ''))
      : fileUri;
    const rawText = fs.readFileSync(filePath, 'utf8');
    const ext = path.extname(filePath);
    return new PositionMapper(extractST(rawText, ext));
  } catch {
    return new PositionMapper(PASSTHROUGH_EXTRACTION);
  }
}
