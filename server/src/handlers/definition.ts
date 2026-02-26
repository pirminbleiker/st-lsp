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
  MemberExpression,
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
 * Also searches FB actions by name.
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

/**
 * Find an action declaration by name within any FB in the file.
 */
function findActionDeclaration(
  ast: SourceFile,
  name: string,
): { location: { range: { start: Position; end: Position } } } | undefined {
  const upper = name.toUpperCase();
  for (const decl of ast.declarations) {
    if (decl.kind !== 'FunctionBlockDeclaration') continue;
    const fb = decl as import('../parser/ast').FunctionBlockDeclaration;
    const action = fb.actions.find(a => a.name.toUpperCase() === upper);
    if (action) return { location: action };
  }
  return undefined;
}

/**
 * Collect declarations from the workspace index into an array of
 * `{ uri, declarations }` pairs (excluding `currentUri`).
 */
function loadWorkspaceDeclarations(
  currentUri: string,
  workspaceIndex: WorkspaceIndex | undefined,
): Array<{ uri: string; declarations: TopLevelDeclaration[] }> {
  if (!workspaceIndex) return [];
  const result: Array<{ uri: string; declarations: TopLevelDeclaration[] }> = [];
  for (const fileUri of workspaceIndex.getProjectFiles()) {
    if (fileUri === currentUri) continue;
    const cached = workspaceIndex.getAst(fileUri);
    if (cached) {
      result.push({ uri: fileUri, declarations: cached.ast.declarations });
    } else {
      try {
        const filePath = fileUri.startsWith('file://')
          ? decodeURIComponent(fileUri.replace(/^file:\/\//, ''))
          : fileUri;
        const rawText = fs.readFileSync(filePath, 'utf8');
        const fileText = extractStFromTwinCAT(filePath, rawText).stCode;
        result.push({ uri: fileUri, declarations: parse(fileText).ast.declarations });
      } catch {
        // skip unreadable files
      }
    }
  }
  return result;
}

/**
 * Find a method or property named `memberName` in the FB named `fbName`,
 * walking the EXTENDS chain recursively up to `maxDepth`.
 * Returns `{ uri, node }` for the matching declaration or null.
 */
function findSuperMemberDeclaration(
  fbName: string,
  memberName: string,
  localDeclarations: TopLevelDeclaration[],
  workspaceFiles: Array<{ uri: string; declarations: TopLevelDeclaration[] }>,
  currentUri: string,
  depth: number,
): { uri: string; node: { range: { start: Position; end: Position } } } | null {
  if (depth <= 0) return null;

  const upperFb = fbName.toUpperCase();
  const upperMember = memberName.toUpperCase();

  const allSources: Array<{ uri: string; declarations: TopLevelDeclaration[] }> = [
    { uri: currentUri, declarations: localDeclarations },
    ...workspaceFiles,
  ];

  for (const { uri, declarations } of allSources) {
    for (const decl of declarations) {
      if (decl.kind !== 'FunctionBlockDeclaration') continue;
      const fb = decl as FunctionBlockDeclaration;
      if (fb.name.toUpperCase() !== upperFb) continue;

      // Search methods
      const method = fb.methods.find(m => m.name.toUpperCase() === upperMember);
      if (method) return { uri, node: method };

      // Search properties
      const prop = fb.properties.find(p => p.name.toUpperCase() === upperMember);
      if (prop) return { uri, node: prop };

      // Recurse into parent chain
      if (fb.extends) {
        return findSuperMemberDeclaration(
          fb.extends, memberName, localDeclarations, workspaceFiles, currentUri, depth - 1,
        );
      }

      return null;
    }
  }

  return null;
}

/**
 * Find the enclosing FUNCTION_BLOCK declaration's `extends` field at `pos`.
 */
function getEnclosingFbExtends(ast: SourceFile, pos: Position): string | null {
  for (const decl of ast.declarations) {
    if (decl.kind !== 'FunctionBlockDeclaration') continue;
    const fb = decl as FunctionBlockDeclaration;
    if (!positionContains(fb.range.start, fb.range.end, pos)) continue;
    return fb.extends ?? null;
  }
  return null;
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
  if (!node) return null;

  const pos: Position = { line, character };
  const uri = params.textDocument.uri;

  // SUPER^.Member go-to-definition: navigate to the parent FB's member declaration.
  if (
    node.kind === 'MemberExpression' &&
    (node as MemberExpression).base.kind === 'NameExpression' &&
    ((node as MemberExpression).base as NameExpression).name.toUpperCase() === 'SUPER'
  ) {
    const memberName = (node as MemberExpression).member;
    const parentFbName = getEnclosingFbExtends(ast, pos);
    if (parentFbName && memberName) {
      const workspaceFiles = loadWorkspaceDeclarations(uri, workspaceIndex);
      const found = findSuperMemberDeclaration(
        parentFbName, memberName, ast.declarations, workspaceFiles, uri, 10,
      );
      if (found) return toLocation(found.uri, found.node);
    }
    return null;
  }

  if (node.kind !== 'NameExpression') return null;

  const name = (node as NameExpression).name;
  if (!name) return null;

  const nameUpper = name.toUpperCase();

  // 1. Local VarDeclarations in the enclosing POU
  const localVars = collectLocalVars(ast, pos);
  const localMatch = localVars.find(v => v.name.toUpperCase() === nameUpper);
  if (localMatch) return toLocation(uri, localMatch);

  // 2. Action declarations in any FB in the current file
  const actionMatch = findActionDeclaration(ast, name);
  if (actionMatch) return toLocation(uri, actionMatch.location);

  // 3. POU declarations in the current file
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
