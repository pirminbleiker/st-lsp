/**
 * Find All References handler for IEC 61131-3 Structured Text.
 *
 * Given a cursor position, finds all occurrences of the identifier under the
 * cursor throughout the current document and optionally in other workspace
 * files via WorkspaceIndex.
 */

import * as fs from 'fs';
import * as path from 'path';
import { ReferenceParams, Location } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { WorkspaceIndex } from '../twincat/workspaceIndex';
import { extractST, PositionMapper } from '../twincat/tcExtractor';
import { parse } from '../parser/parser';
import { mapperForUri, getOrParse } from './shared';
import {
  AstNode,
  NameExpression,
  SourceFile,
  TypeRef,
  VarDeclaration,
} from '../parser/ast';
import { findNodeAtPosition, walkAst } from '../parser/visitor';

// ---------------------------------------------------------------------------
// AST walker — collect all NameExpressions and VarDeclaration names matching
// ---------------------------------------------------------------------------

/**
 * Recursively walk the AST and collect:
 *   - Every NameExpression node whose name matches `targetName` (case-insensitive)
 *   - Every VarDeclaration whose name matches `targetName` (declaration sites)
 *   - Every VarDeclaration whose type annotation name matches `targetName` (type usages)
 *   - ForStatement loop variable names (plain string, not a NameExpression)
 *   - InterfaceDeclaration EXTENDS references
 *   - PropertyDeclaration names and type annotations
 *
 * Returns a Location[] using the given `uri` for each match.
 */
export function collectNameExpressions(
  ast: SourceFile,
  targetName: string,
  uri: string,
): Location[] {
  const upper = targetName.toUpperCase();
  const results: Location[] = [];

  walkAst(ast, {
    enter(node: AstNode) {
      switch (node.kind) {
        case 'NameExpression': {
          const ne = node as NameExpression;
          if (ne.name.toUpperCase() === upper) {
            results.push({ uri, range: { start: ne.range.start, end: ne.range.end } });
          }
          break;
        }
        case 'VarDeclaration': {
          const vd = node as VarDeclaration;
          if (vd.name.toUpperCase() === upper) {
            results.push({ uri, range: { start: vd.range.start, end: vd.range.end } });
          }
          if (vd.type.name.toUpperCase() === upper) {
            results.push({ uri, range: { start: vd.type.nameRange.start, end: vd.type.nameRange.end } });
          }
          break;
        }
        case 'ForStatement': {
          const fs = node as import('../parser/ast').ForStatement;
          if (fs.variable.toUpperCase() === upper) {
            results.push({ uri, range: fs.variableRange });
          }
          break;
        }
        case 'InterfaceDeclaration': {
          const iface = node as import('../parser/ast').InterfaceDeclaration;
          for (const ref of iface.extendsRefs) {
            if (ref.name.toUpperCase() === upper) {
              results.push({ uri, range: ref.range });
            }
          }
          break;
        }
        case 'PropertyDeclaration': {
          const pd = node as import('../parser/ast').PropertyDeclaration;
          if (pd.name.toUpperCase() === upper) {
            results.push({ uri, range: { start: pd.range.start, end: pd.range.end } });
          }
          if (pd.type.name.toUpperCase() === upper) {
            results.push({ uri, range: { start: pd.type.nameRange.start, end: pd.type.nameRange.end } });
          }
          break;
        }
      }
    },
  });

  return results;
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

/**
 * Map a Location whose range is in extracted-source coordinates back to
 * original-file coordinates using the provided PositionMapper.
 */
function mapLocation(loc: Location, mapper: PositionMapper): Location {
  return {
    uri: loc.uri,
    range: {
      start: mapper.extractedToOriginal(loc.range.start.line, loc.range.start.character),
      end: mapper.extractedToOriginal(loc.range.end.line, loc.range.end.character),
    },
  };
}

/**
 * Build a PositionMapper for an arbitrary workspace file URI by reading the
 * file from disk.
 */

export function handleReferences(
  params: ReferenceParams,
  document: TextDocument | undefined,
  workspaceIndex?: WorkspaceIndex,
): Location[] {
  if (!document) return [];

  const { extraction, mapper, ast } = getOrParse(document!);

  const { line, character } = params.position;
  const extractedPos = mapper.originalToExtracted(line, character) ?? { line, character };
  const node = findNodeAtPosition(ast, extractedPos.line, extractedPos.character);
  if (!node) return [];

  // Extract the identifier name from either a NameExpression, a VarDeclaration,
  // a TypeRef (cursor on a type annotation), or a ForStatement (plain string field)
  let name: string | undefined;
  if (node.kind === 'NameExpression') {
    name = (node as NameExpression).name;
  } else if (node.kind === 'TypeRef') {
    name = (node as TypeRef).name;
  } else if (node.kind === 'VarDeclaration') {
    name = (node as VarDeclaration).name;
  } else if (node.kind === 'ForStatement') {
    name = (node as import('../parser/ast').ForStatement).variable;
  }

  if (!name) return [];

  const uri = params.textDocument.uri;

  // Collect all matching occurrences in the current document (in extracted space, then map back)
  const rawLocations: Location[] = collectNameExpressions(ast, name, uri);
  const locations: Location[] = rawLocations.map(loc => mapLocation(loc, mapper));

  // Optionally search other workspace files via WorkspaceIndex
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
      const otherLocations = collectNameExpressions(otherAst, name, fileUri);
      locations.push(...otherLocations.map(loc => mapLocation(loc, otherMapper)));
    }
  }

  return locations;
}
