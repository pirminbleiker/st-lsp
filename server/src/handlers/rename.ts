/**
 * Rename Symbol handler for IEC 61131-3 Structured Text.
 *
 * Given a cursor position and a new name, finds all occurrences of the
 * identifier under the cursor across the current document and all workspace
 * files, and returns a WorkspaceEdit that replaces each occurrence with the
 * new name.
 *
 * ST is case-insensitive, so matching is done case-insensitively, but the
 * replacement always uses the exact string supplied by the client (newName).
 *
 * MemberExpression handling: only the base expression is walked; the .member
 * field name is never renamed (it is a field access, not a reference to the
 * symbol being renamed).
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  RenameParams,
  WorkspaceEdit,
  TextEdit,
  Range,
  TextDocumentPositionParams,
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { WorkspaceIndex } from '../twincat/workspaceIndex';
import { extractST, PositionMapper } from '../twincat/tcExtractor';
import { parse } from '../parser/parser';
import { mapperForUri, getOrParse } from './shared';
import {
  AstNode,
  NameExpression,
  SourceFile,
  VarDeclaration,
  ForStatement,
} from '../parser/ast';
import { findNodeAtPosition, walkAst } from '../parser/visitor';

// ---------------------------------------------------------------------------
// AST walker — collect all NameExpression nodes matching a name
// ---------------------------------------------------------------------------

interface NameMatch {
  range: Range;
}

/**
 * Walk the entire AST and collect the ranges of all NameExpression nodes
 * whose name matches `targetName` (case-insensitive), plus VarDeclaration
 * name sites and ForStatement loop variables.
 *
 * MemberExpression: `forEachChild` naturally walks only the base expression;
 * the .member string field is not an AST node, so it is never visited.
 */
function collectNameMatches(ast: SourceFile, targetName: string): NameMatch[] {
  const upper = targetName.toUpperCase();
  const results: NameMatch[] = [];

  walkAst(ast, {
    enter(node: AstNode) {
      switch (node.kind) {
        case 'NameExpression': {
          const n = node as NameExpression;
          if (n.name.toUpperCase() === upper) {
            results.push({ range: n.range });
          }
          break;
        }
        case 'VarDeclaration': {
          const vd = node as VarDeclaration;
          if (vd.name.toUpperCase() === upper) {
            results.push({ range: vd.nameRange });
          }
          break;
        }
        case 'ForStatement': {
          const s = node as ForStatement;
          if (s.variable.toUpperCase() === upper) {
            results.push({ range: s.variableRange });
          }
          break;
        }
      }
    },
  });

  return results;
}

// ---------------------------------------------------------------------------
// handleRename
// ---------------------------------------------------------------------------

/** Returns true if `pos` falls within `range` (inclusive start, exclusive end). */
function positionInRange(pos: { line: number; character: number }, range: Range): boolean {
  if (pos.line < range.start.line || pos.line > range.end.line) return false;
  if (pos.line === range.start.line && pos.character < range.start.character) return false;
  if (pos.line === range.end.line && pos.character >= range.end.character) return false;
  return true;
}

/**
 * Map an AST range (in extracted-source coordinates) back to original-file
 * coordinates.
 */
function mapRange(r: Range, mapper: PositionMapper): Range {
  return {
    start: mapper.extractedToOriginal(r.start.line, r.start.character),
    end: mapper.extractedToOriginal(r.end.line, r.end.character),
  };
}

/**
 * Build a PositionMapper for an arbitrary workspace file URI.
 */


export function handleRename(
  params: RenameParams,
  document: TextDocument | undefined,
  workspaceIndex?: WorkspaceIndex,
): WorkspaceEdit | null {
  if (!document) return null;

  const { extraction, mapper, ast } = getOrParse(document!);

  const { line, character } = params.position;
  const extractedPos = mapper.originalToExtracted(line, character) ?? { line, character };
  const node = findNodeAtPosition(ast, extractedPos.line, extractedPos.character);
  if (!node) return null;

  let targetName: string;
  if (node.kind === 'NameExpression') {
    targetName = (node as NameExpression).name;
  } else if (node.kind === 'ForStatement') {
    const fs = node as ForStatement;
    // variableRange is in extracted space — convert to original for position check
    const mappedVarRange = mapRange(fs.variableRange, mapper);
    if (!positionInRange({ line, character }, mappedVarRange)) return null;
    targetName = fs.variable;
  } else if (node.kind === 'VarDeclaration') {
    const vd = node as VarDeclaration;
    const mappedNameRange = mapRange(vd.nameRange, mapper);
    if (!positionInRange({ line, character }, mappedNameRange)) return null;
    targetName = vd.name;
  } else {
    return null;
  }
  if (!targetName) return null;

  const newName = params.newName;
  const currentUri = params.textDocument.uri;

  const changes: { [uri: string]: TextEdit[] } = {};

  // --- Current document: matches in extracted space, map ranges back ---
  const currentMatches = collectNameMatches(ast, targetName);
  if (currentMatches.length > 0) {
    changes[currentUri] = currentMatches.map(m => TextEdit.replace(mapRange(m.range, mapper), newName));
  }

  // --- Other workspace files ---
  if (workspaceIndex) {
    const projectFiles = workspaceIndex.getProjectFiles();
    for (const fileUri of projectFiles) {
      if (fileUri === currentUri) continue;

      let otherAst: SourceFile;
      const cachedEntry = workspaceIndex.getAst?.(fileUri);
      if (cachedEntry) {
        otherAst = cachedEntry.ast;
      } else {
        let fileText: string;
        try {
          const filePath = fileUri.startsWith('file://')
            ? decodeURIComponent(fileUri.replace(/^file:\/\//, ''))
            : fileUri;
          fileText = fs.readFileSync(filePath, 'utf8');
        } catch {
          continue;
        }
        const otherExt = path.extname(fileUri);
        otherAst = parse(extractST(fileText, otherExt).source).ast;
      }

      const otherMapper = mapperForUri(fileUri, workspaceIndex);
      const otherMatches = collectNameMatches(otherAst, targetName);
      if (otherMatches.length > 0) {
        changes[fileUri] = otherMatches.map(m => TextEdit.replace(mapRange(m.range, otherMapper), newName));
      }
    }
  }

  return { changes };
}

// ---------------------------------------------------------------------------
// handlePrepareRename
// ---------------------------------------------------------------------------

/**
 * Returns the range of the identifier under the cursor, or null if the cursor
 * is not on a renameable identifier. VSCode calls this before showing the
 * rename input box, to verify that rename is valid and to pre-fill the box.
 */
export function handlePrepareRename(
  params: TextDocumentPositionParams,
  document: TextDocument | undefined,
): Range | null {
  if (!document) return null;

  const { extraction, mapper, ast } = getOrParse(document!);

  const { line, character } = params.position;
  const extractedPos = mapper.originalToExtracted(line, character) ?? { line, character };
  const node = findNodeAtPosition(ast, extractedPos.line, extractedPos.character);
  if (!node) return null;

  if (node.kind === 'NameExpression') {
    const name = (node as NameExpression).name;
    if (!name) return null;
    return {
      start: mapper.extractedToOriginal(node.range.start.line, node.range.start.character),
      end: mapper.extractedToOriginal(node.range.end.line, node.range.end.character),
    };
  }

  if (node.kind === 'ForStatement') {
    const fs = node as ForStatement;
    const mappedVarRange = {
      start: mapper.extractedToOriginal(fs.variableRange.start.line, fs.variableRange.start.character),
      end: mapper.extractedToOriginal(fs.variableRange.end.line, fs.variableRange.end.character),
    };
    if (!positionInRange({ line, character }, mappedVarRange)) return null;
    return mappedVarRange;
  }

  if (node.kind === 'VarDeclaration') {
    const vd = node as VarDeclaration;
    const mappedNameRange = {
      start: mapper.extractedToOriginal(vd.nameRange.start.line, vd.nameRange.start.character),
      end: mapper.extractedToOriginal(vd.nameRange.end.line, vd.nameRange.end.character),
    };
    if (!positionInRange({ line, character }, mappedNameRange)) return null;
    return mappedNameRange;
  }

  return null;
}
