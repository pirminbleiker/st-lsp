/**
 * Go-to-definition handler for IEC 61131-3 Structured Text.
 *
 * Given a cursor position, parses the document, finds the identifier under
 * the cursor, and locates its declaration:
 *   1. TypeRef under cursor → POU / type declaration (same file then workspace)
 *   2. MemberExpression (non-SUPER) → method / property on the FB type of the base instance
 *   3. SUPER^.Member → member declaration in the parent FB (walking EXTENDS chain)
 *   4. VarDeclarations in the enclosing POU (local scope)
 *   5. POU / type declarations in the current file
 *   6. POU declarations in other workspace files (cross-file search)
 */

import * as fs from 'fs';
import * as path from 'path';
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
  TypeDeclaration,
  TypeDeclarationBlock,
  TypeRef,
  VarDeclaration,
} from '../parser/ast';
import { parse } from '../parser/parser';
import { WorkspaceIndex } from '../twincat/workspaceIndex';
import { findNodeAtPosition } from './hover';
import { extractST, extractStFromTwinCAT, PositionMapper } from '../twincat/tcExtractor';

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

/**
 * Find a named type declaration (struct, enum, alias, union) inside any
 * TypeDeclarationBlock in the file.
 */
function findTypeDeclaration(
  ast: SourceFile,
  name: string,
): TypeDeclaration | undefined {
  const upper = name.toUpperCase();
  for (const decl of ast.declarations) {
    if (decl.kind !== 'TypeDeclarationBlock') continue;
    const block = decl as TypeDeclarationBlock;
    const match = block.declarations.find(d => d.name.toUpperCase() === upper);
    if (match) return match;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Location builders
// ---------------------------------------------------------------------------

function toLocation(
  uri: string,
  decl: { range: { start: Position; end: Position } },
  mapper?: PositionMapper,
): Location {
  const start = mapper
    ? mapper.extractedToOriginal(decl.range.start.line, decl.range.start.character)
    : { line: decl.range.start.line, character: decl.range.start.character };
  const end = mapper
    ? mapper.extractedToOriginal(decl.range.end.line, decl.range.end.character)
    : { line: decl.range.end.line, character: decl.range.end.character };
  return { uri, range: { start, end } };
}

/**
 * Build a PositionMapper for any workspace file URI.
 * For .st files (passthrough), returns an identity mapper.
 * Reads the file from disk; callers should catch exceptions.
 */
function mapperForUri(fileUri: string): PositionMapper {
  try {
    const filePath = fileUri.startsWith('file://')
      ? decodeURIComponent(fileUri.replace(/^file:\/\//, ''))
      : fileUri;
    const rawText = fs.readFileSync(filePath, 'utf8');
    const ext = path.extname(filePath);
    const result = extractST(rawText, ext);
    return new PositionMapper(result);
  } catch {
    return new PositionMapper({ source: '', lineMap: [], sections: [], passthrough: true });
  }
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
  const ext = path.extname(document.uri);
  const extraction = extractST(text, ext);
  const mapper = new PositionMapper(extraction);
  const { ast } = parse(extraction.source);

  const { line, character } = params.position;
  const extractedPos = mapper.originalToExtracted(line, character);
  if (!extractedPos) return null; // cursor on XML-only line
  const node = findNodeAtPosition(ast, extractedPos.line, extractedPos.character);
  if (!node) return null;

  const pos: Position = { line: extractedPos.line, character: extractedPos.character };
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
      if (found) return toLocation(found.uri, found.node, mapperForUri(found.uri));
    }
    return null;
  }

  // TypeRef navigation: cursor on a type name in a var declaration or return type.
  // Navigate to the POU, struct, enum, alias, or union declaration for that type.
  if (node.kind === 'TypeRef') {
    const typeName = (node as TypeRef).name;
    if (!typeName) return null;
    const pouMatch = findPouDeclaration(ast, typeName);
    if (pouMatch) return toLocation(uri, pouMatch, mapper);
    const typeMatch = findTypeDeclaration(ast, typeName);
    if (typeMatch) return toLocation(uri, typeMatch, mapper);
    // Search workspace files
    const wsFiles = loadWorkspaceDeclarations(uri, workspaceIndex);
    for (const { uri: fileUri, declarations } of wsFiles) {
      const upper = typeName.toUpperCase();
      const wsMatch = declarations.find(
        d => 'name' in d && (d as { name: string }).name.toUpperCase() === upper,
      );
      if (wsMatch) return toLocation(fileUri, wsMatch, mapperForUri(fileUri));
      // Also search inside TypeDeclarationBlocks from workspace files
      for (const decl of declarations) {
        if (decl.kind !== 'TypeDeclarationBlock') continue;
        const block = decl as TypeDeclarationBlock;
        const tdMatch = block.declarations.find(d => d.name.toUpperCase() === upper);
        if (tdMatch) return toLocation(fileUri, tdMatch, mapperForUri(fileUri));
      }
    }
    return null;
  }

  // Non-SUPER MemberExpression: myFb.Method → navigate to method/property on the FB type.
  if (node.kind === 'MemberExpression') {
    const memberExpr = node as MemberExpression;
    const memberName = memberExpr.member;
    if (!memberName || memberExpr.base.kind !== 'NameExpression') return null;
    const instanceName = (memberExpr.base as NameExpression).name;
    const localVars = collectLocalVars(ast, pos);
    const instanceVar = localVars.find(
      v => v.name.toUpperCase() === instanceName.toUpperCase(),
    );
    if (!instanceVar) return null;
    const fbTypeName = instanceVar.type.name;
    const wsFiles = loadWorkspaceDeclarations(uri, workspaceIndex);
    const allSources: Array<{ uri: string; declarations: TopLevelDeclaration[] }> = [
      { uri, declarations: ast.declarations },
      ...wsFiles,
    ];
    for (const { uri: srcUri, declarations } of allSources) {
      for (const decl of declarations) {
        if (decl.kind !== 'FunctionBlockDeclaration') continue;
        const fb = decl as FunctionBlockDeclaration;
        if (fb.name.toUpperCase() !== fbTypeName.toUpperCase()) continue;
        const method = fb.methods.find(m => m.name.toUpperCase() === memberName.toUpperCase());
        if (method) return toLocation(srcUri, method, srcUri === uri ? mapper : mapperForUri(srcUri));
        const prop = fb.properties.find(p => p.name.toUpperCase() === memberName.toUpperCase());
        if (prop) return toLocation(srcUri, prop, srcUri === uri ? mapper : mapperForUri(srcUri));
      }
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
  if (localMatch) return toLocation(uri, localMatch, mapper);

  // 2. Action declarations in any FB in the current file
  const actionMatch = findActionDeclaration(ast, name);
  if (actionMatch) return toLocation(uri, actionMatch.location, mapper);

  // 3. POU declarations in the current file
  const pouMatch = findPouDeclaration(ast, name);
  if (pouMatch) return toLocation(uri, pouMatch, mapper);

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
      if (otherMatch) return toLocation(fileUri, otherMatch, mapperForUri(fileUri));
    }
  }

  return null;
}
