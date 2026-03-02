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
import { DefinitionParams, Location } from 'vscode-languageserver/node';
import { mapperForUri, getOrParse } from './shared';
import { TextDocument } from 'vscode-languageserver-textdocument';
import {
  FunctionBlockDeclaration,
  FunctionDeclaration,
  InterfaceDeclaration,
  MemberExpression,
  NameExpression,
  Position,
  ProgramDeclaration,
  SourceFile,
  StructDeclaration,
  TopLevelDeclaration,
  TypeDeclaration,
  TypeDeclarationBlock,
  TypeRef,
  VarDeclaration,
} from '../parser/ast';
import { parse } from '../parser/parser';
import { WorkspaceIndex } from '../twincat/workspaceIndex';
import { findNodeAtPosition } from './hover';
import { extractStFromTwinCAT, PositionMapper } from '../twincat/tcExtractor';

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
    // When cursor is inside a method, also collect that method's var blocks
    if (decl.kind === 'FunctionBlockDeclaration') {
      const fb = decl as FunctionBlockDeclaration;
      for (const method of fb.methods) {
        if (!positionContains(method.range.start, method.range.end, pos)) continue;
        for (const vb of method.varBlocks) {
          for (const vd of vb.declarations) {
            vars.push(vd);
          }
        }
        break;
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
    const cached = workspaceIndex.getAst?.(fileUri);
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
      if (fb.extendsRef) {
        return findSuperMemberDeclaration(
          fb.extendsRef.name, memberName, localDeclarations, workspaceFiles, currentUri, depth - 1,
        );
      }

      return null;
    }
  }

  return null;
}

/**
 * Find a method or property named `memberName` in the interface named `ifaceName`,
 * walking the EXTENDS chain recursively up to `maxDepth`.
 * Returns `{ uri, node }` for the matching declaration or null.
 */
function findInterfaceMemberDeclaration(
  ifaceName: string,
  memberName: string,
  localDeclarations: TopLevelDeclaration[],
  workspaceFiles: Array<{ uri: string; declarations: TopLevelDeclaration[] }>,
  currentUri: string,
  depth: number,
): { uri: string; node: { range: { start: Position; end: Position } } } | null {
  if (depth <= 0) return null;

  const upperIface = ifaceName.toUpperCase();
  const upperMember = memberName.toUpperCase();

  const allSources: Array<{ uri: string; declarations: TopLevelDeclaration[] }> = [
    { uri: currentUri, declarations: localDeclarations },
    ...workspaceFiles,
  ];

  for (const { uri, declarations } of allSources) {
    for (const decl of declarations) {
      if (decl.kind !== 'InterfaceDeclaration') continue;
      const iface = decl as InterfaceDeclaration;
      if (iface.name.toUpperCase() !== upperIface) continue;

      // Search methods
      const method = iface.methods.find(m => m.name.toUpperCase() === upperMember);
      if (method) return { uri, node: method };

      // Search properties
      const prop = iface.properties.find(p => p.name.toUpperCase() === upperMember);
      if (prop) return { uri, node: prop };

      // Walk EXTENDS chain
      for (const extendsRef of iface.extendsRefs) {
        const found = findInterfaceMemberDeclaration(
          extendsRef.name, memberName, localDeclarations, workspaceFiles, currentUri, depth - 1,
        );
        if (found) return found;
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
    return fb.extendsRef?.name ?? null;
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

/**
 * Locate a named type/POU/interface declaration: first in the current file,
 * then across workspace files.
 */
function findTypeLocation(
  name: string,
  ast: SourceFile,
  uri: string,
  workspaceIndex: WorkspaceIndex | undefined,
  mapper: PositionMapper,
): Location | null {
  const upper = name.toUpperCase();
  const pouMatch = findPouDeclaration(ast, name);
  if (pouMatch) return toLocation(uri, pouMatch, mapper);
  const typeMatch = findTypeDeclaration(ast, name);
  if (typeMatch) return toLocation(uri, typeMatch, mapper);
  const wsFiles = loadWorkspaceDeclarations(uri, workspaceIndex);
  for (const { uri: fileUri, declarations } of wsFiles) {
    const wsMatch = declarations.find(
      d => 'name' in d && (d as { name: string }).name.toUpperCase() === upper,
    );
    if (wsMatch) return toLocation(fileUri, wsMatch, mapperForUri(fileUri, workspaceIndex));
    for (const decl of declarations) {
      if (decl.kind !== 'TypeDeclarationBlock') continue;
      const block = decl as TypeDeclarationBlock;
      const tdMatch = block.declarations.find(d => d.name.toUpperCase() === upper);
      if (tdMatch) return toLocation(fileUri, tdMatch, mapperForUri(fileUri, workspaceIndex));
    }
  }
  return null;
}

/**
 * Check if the cursor position falls within any EXTENDS or IMPLEMENTS named
 * reference across all top-level declarations (FunctionBlock, Struct, Interface).
 * Returns a Location if a match is found, null if the ref is found but the
 * target is unresolvable, or undefined if the cursor is not on any such ref.
 */
function checkExtendsOrImplementsRefs(
  ast: SourceFile,
  pos: Position,
  uri: string,
  workspaceIndex: WorkspaceIndex | undefined,
  mapper: PositionMapper,
): Location | null | undefined {
  for (const decl of ast.declarations) {
    if (decl.kind === 'FunctionBlockDeclaration') {
      const fb = decl as FunctionBlockDeclaration;
      if (fb.extendsRef && positionContains(fb.extendsRef.range.start, fb.extendsRef.range.end, pos)) {
        return findTypeLocation(fb.extendsRef.name, ast, uri, workspaceIndex, mapper);
      }
      for (const ref of fb.implementsRefs) {
        if (positionContains(ref.range.start, ref.range.end, pos)) {
          return findTypeLocation(ref.name, ast, uri, workspaceIndex, mapper);
        }
      }
    } else if (decl.kind === 'TypeDeclarationBlock') {
      const block = decl as TypeDeclarationBlock;
      for (const td of block.declarations) {
        if (td.kind === 'StructDeclaration') {
          const struct = td as StructDeclaration;
          if (struct.extendsRef && positionContains(struct.extendsRef.range.start, struct.extendsRef.range.end, pos)) {
            return findTypeLocation(struct.extendsRef.name, ast, uri, workspaceIndex, mapper);
          }
        }
      }
    } else if (decl.kind === 'InterfaceDeclaration') {
      const iface = decl as InterfaceDeclaration;
      for (const ref of iface.extendsRefs) {
        if (positionContains(ref.range.start, ref.range.end, pos)) {
          return findTypeLocation(ref.name, ast, uri, workspaceIndex, mapper);
        }
      }
    }
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



// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

export function handleDefinition(
  params: DefinitionParams,
  document: TextDocument | undefined,
  workspaceIndex: WorkspaceIndex | undefined,
): Location | null {
  if (!document) return null;

  const { extraction, mapper, ast } = getOrParse(document!);

  const { line, character } = params.position;
  const extractedPos = mapper.originalToExtracted(line, character);
  if (!extractedPos) return null; // cursor on XML-only line

  const pos: Position = { line: extractedPos.line, character: extractedPos.character };
  const uri = params.textDocument.uri;

  // EXTENDS / IMPLEMENTS / interface EXTENDS go-to-definition:
  // Check if cursor lies within a named reference in a declaration header.
  const extendsResult = checkExtendsOrImplementsRefs(ast, pos, uri, workspaceIndex, mapper);
  if (extendsResult !== undefined) return extendsResult;

  const node = findNodeAtPosition(ast, extractedPos.line, extractedPos.character);
  if (!node) return null;

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
      if (found) return toLocation(found.uri, found.node, mapperForUri(found.uri, workspaceIndex));
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
      if (wsMatch) return toLocation(fileUri, wsMatch, mapperForUri(fileUri, workspaceIndex));
      // Also search inside TypeDeclarationBlocks from workspace files
      for (const decl of declarations) {
        if (decl.kind !== 'TypeDeclarationBlock') continue;
        const block = decl as TypeDeclarationBlock;
        const tdMatch = block.declarations.find(d => d.name.toUpperCase() === upper);
        if (tdMatch) return toLocation(fileUri, tdMatch, mapperForUri(fileUri, workspaceIndex));
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
        if (method) return toLocation(srcUri, method, srcUri === uri ? mapper : mapperForUri(srcUri, workspaceIndex));
        const prop = fb.properties.find(p => p.name.toUpperCase() === memberName.toUpperCase());
        if (prop) return toLocation(srcUri, prop, srcUri === uri ? mapper : mapperForUri(srcUri, workspaceIndex));
      }
    }
    // Also search InterfaceDeclaration (for interface-typed variables, including EXTENDS chain)
    const ifaceFound = findInterfaceMemberDeclaration(
      fbTypeName, memberName, ast.declarations, wsFiles, uri, 10,
    );
    if (ifaceFound) {
      return toLocation(ifaceFound.uri, ifaceFound.node, ifaceFound.uri === uri ? mapper : mapperForUri(ifaceFound.uri, workspaceIndex));
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

      let otherAst: SourceFile;
      const cachedEntry = workspaceIndex.getAst?.(fileUri);
      if (cachedEntry) {
        otherAst = cachedEntry.ast;
      } else {
        try {
          const filePath = fileUri.startsWith('file://')
            ? decodeURIComponent(fileUri.replace(/^file:\/\//, ''))
            : fileUri;
          const rawText = fs.readFileSync(filePath, 'utf8');
          otherAst = parse(extractStFromTwinCAT(filePath, rawText).stCode).ast;
        } catch {
          continue;
        }
      }

      const otherMatch = findPouDeclaration(otherAst, name);
      if (otherMatch) return toLocation(fileUri, otherMatch, mapperForUri(fileUri, workspaceIndex));
    }
  }

  return null;
}
