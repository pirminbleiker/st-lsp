/**
 * Go-to-definition handler for IEC 61131-3 Structured Text.
 *
 * Given a cursor position, parses the document, finds the identifier under
 * the cursor, and locates its declaration:
 *   1. VarDeclarations in the enclosing POU (local scope)
 *   2. POU declarations (PROGRAM / FUNCTION_BLOCK / FUNCTION) in the current file
 *   3. POU declarations in other workspace files (cross-file search)
 */

import * as fs from 'fs';
import { DefinitionParams, Location } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import {
  FunctionBlockDeclaration,
  FunctionDeclaration,
  NameExpression,
  Position,
  ProgramDeclaration,
  SourceFile,
  TopLevelDeclaration,
  VarDeclaration,
} from '../parser/ast';
import { parse } from '../parser/parser';
import { WorkspaceIndex } from '../twincat/workspaceIndex';
import { findNodeAtPosition } from './hover';
import { extractStFromTwinCAT } from '../twincat/tcExtractor';

// ---------------------------------------------------------------------------
// Scope helpers
// ---------------------------------------------------------------------------

function positionContains(
  nodeStart: Position,
  nodeEnd: Position,
  pos: Position,
): boolean {
  if (pos.line < nodeStart.line || pos.line > nodeEnd.line) return false;
  if (pos.line === nodeStart.line && pos.character < nodeStart.character) return false;
  if (pos.line === nodeEnd.line && pos.character > nodeEnd.character) return false;
  return true;
}

/**
 * Collect all VarDeclaration nodes from the POU that encloses `pos`.
 */
function collectLocalVars(ast: SourceFile, pos: Position): VarDeclaration[] {
  for (const decl of ast.declarations) {
    if (!positionContains(decl.range.start, decl.range.end, pos)) continue;
    const pou = decl as ProgramDeclaration | FunctionBlockDeclaration | FunctionDeclaration;
    const vars: VarDeclaration[] = [];
    for (const vb of pou.varBlocks) {
      for (const vd of vb.declarations) {
        vars.push(vd);
      }
    }
    return vars;
  }
  return [];
}

/**
 * Find the first POU declaration whose name matches (case-insensitive).
 */
function findPouDeclaration(
  ast: SourceFile,
  name: string,
): TopLevelDeclaration | undefined {
  const upper = name.toUpperCase();
  return ast.declarations.find(
    d => 'name' in d && (d as { name: string }).name.toUpperCase() === upper,
  );
}

// ---------------------------------------------------------------------------
// Location builders
// ---------------------------------------------------------------------------

function toLocation(uri: string, decl: { range: { start: Position; end: Position } }): Location {
  return {
    uri,
    range: {
      start: decl.range.start,
      end: decl.range.end,
    },
  };
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

export function handleDefinition(
  params: DefinitionParams,
  document: TextDocument | undefined,
  workspaceIndex: WorkspaceIndex | undefined,
): Location | null {
  if (!document) return null;

  const text = document.getText();
  const extraction = extractStFromTwinCAT(document.uri, text);
  const { ast } = parse(extraction.stCode);

  const { line, character } = params.position;
  const node = findNodeAtPosition(ast, line, character);
  if (!node || node.kind !== 'NameExpression') return null;

  const name = (node as NameExpression).name;
  if (!name) return null;

  const nameUpper = name.toUpperCase();
  const pos: Position = { line, character };
  const uri = params.textDocument.uri;

  // 1. Local VarDeclarations in the enclosing POU
  const localVars = collectLocalVars(ast, pos);
  const localMatch = localVars.find(v => v.name.toUpperCase() === nameUpper);
  if (localMatch) return toLocation(uri, localMatch);

  // 2. POU declarations in the current file
  const pouMatch = findPouDeclaration(ast, name);
  if (pouMatch) return toLocation(uri, pouMatch);

  // 3. Cross-file POU search via workspaceIndex
  if (workspaceIndex) {
    const projectFiles = workspaceIndex.getProjectFiles();
    for (const fileUri of projectFiles) {
      // Skip the current document (already searched above)
      if (fileUri === uri) continue;

      let fileText: string;
      try {
        // fileUri is already a file:// URI; strip to path for fs.readFileSync
        const filePath = fileUri.startsWith('file://')
          ? decodeURIComponent(fileUri.replace(/^file:\/\//, ''))
          : fileUri;
        const rawText = fs.readFileSync(filePath, 'utf8');
        fileText = extractStFromTwinCAT(filePath, rawText).stCode;
      } catch {
        continue;
      }

      const { ast: otherAst } = parse(fileText);
      const otherMatch = findPouDeclaration(otherAst, name);
      if (otherMatch) return toLocation(fileUri, otherMatch);
    }
  }

  return null;
}
