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
import { findNodeAtPosition } from './hover';
import {
  AstNode,
  FunctionBlockDeclaration,
  FunctionDeclaration,
  MethodDeclaration,
  NameExpression,
  ProgramDeclaration,
  SourceFile,
  TypeDeclarationBlock,
  TypeRef,
  VarDeclaration,
} from '../parser/ast';

// ---------------------------------------------------------------------------
// AST walker — collect all NameExpressions and VarDeclaration names matching
// ---------------------------------------------------------------------------

/**
 * Recursively walk the AST and collect:
 *   - Every NameExpression node whose name matches `targetName` (case-insensitive)
 *   - Every VarDeclaration whose name matches `targetName` (declaration sites)
 *   - Every VarDeclaration whose type annotation name matches `targetName` (type usages)
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

  function visitNode(node: AstNode): void {
    // If this node is a matching NameExpression (usage in expressions/body), collect it.
    if (node.kind === 'NameExpression') {
      const ne = node as NameExpression;
      if (ne.name.toUpperCase() === upper) {
        results.push({
          uri,
          range: {
            start: ne.range.start,
            end: ne.range.end,
          },
        });
      }
      // NameExpressions have no children — stop here.
      return;
    }

    // If this is a VarDeclaration whose name matches, collect it as a declaration site.
    // Also check whether the type annotation references targetName.
    if (node.kind === 'VarDeclaration') {
      const vd = node as VarDeclaration;
      if (vd.name.toUpperCase() === upper) {
        results.push({
          uri,
          range: {
            start: vd.range.start,
            end: vd.range.end,
          },
        });
      }
      // Check type annotation — e.g. `x : TON` when searching for TON
      if (vd.type.name.toUpperCase() === upper) {
        results.push({ uri, range: { start: vd.type.nameRange.start, end: vd.type.nameRange.end } });
      }
      // Also visit the initial value expression if present
      if (vd.initialValue) visitNode(vd.initialValue);
      return;
    }

    switch (node.kind) {
      case 'SourceFile': {
        const sf = node as SourceFile;
        for (const decl of sf.declarations) {
          visitNode(decl);
        }
        break;
      }

      case 'ProgramDeclaration':
      case 'FunctionBlockDeclaration': {
        const pou = node as ProgramDeclaration | FunctionBlockDeclaration;
        for (const vb of pou.varBlocks) visitNode(vb);
        for (const stmt of pou.body) visitNode(stmt);
        if (node.kind === 'FunctionBlockDeclaration') {
          const fb = node as FunctionBlockDeclaration;
          for (const method of fb.methods) visitNode(method);
        }
        break;
      }

      case 'FunctionDeclaration': {
        const fn = node as FunctionDeclaration;
        for (const vb of fn.varBlocks) visitNode(vb);
        for (const stmt of fn.body) visitNode(stmt);
        break;
      }

      case 'MethodDeclaration': {
        const method = node as MethodDeclaration;
        for (const vb of method.varBlocks) visitNode(vb);
        for (const stmt of method.body) visitNode(stmt);
        break;
      }

      case 'TypeDeclarationBlock': {
        const tb = node as TypeDeclarationBlock;
        for (const typeDecl of tb.declarations) {
          visitNode(typeDecl);
        }
        break;
      }

      case 'StructDeclaration': {
        const sd = node as import('../parser/ast').StructDeclaration;
        for (const field of sd.fields) visitNode(field);
        break;
      }

      case 'EnumDeclaration': {
        const ed = node as import('../parser/ast').EnumDeclaration;
        for (const val of ed.values) {
          if (val.value) visitNode(val.value);
        }
        break;
      }

      case 'VarBlock': {
        const vb = node as import('../parser/ast').VarBlock;
        for (const decl of vb.declarations) visitNode(decl);
        break;
      }

      // Statements
      case 'AssignmentStatement': {
        const s = node as import('../parser/ast').AssignmentStatement;
        visitNode(s.left);
        visitNode(s.right);
        break;
      }
      case 'CallStatement': {
        const s = node as import('../parser/ast').CallStatement;
        visitNode(s.callee);
        for (const arg of s.args) visitNode(arg.value);
        break;
      }
      case 'IfStatement': {
        const s = node as import('../parser/ast').IfStatement;
        visitNode(s.condition);
        for (const stmt of s.then) visitNode(stmt);
        for (const elsif of s.elsifs) {
          visitNode(elsif.condition);
          for (const stmt of elsif.body) visitNode(stmt);
        }
        if (s.else) for (const stmt of s.else) visitNode(stmt);
        break;
      }
      case 'ForStatement': {
        const s = node as import('../parser/ast').ForStatement;
        // The loop variable is stored as a plain string (not a NameExpression),
        // so we check it directly here.
        if (s.variable.toUpperCase() === upper) {
          results.push({
            uri,
            range: s.variableRange,
          });
        }
        visitNode(s.from);
        visitNode(s.to);
        if (s.by) visitNode(s.by);
        for (const stmt of s.body) visitNode(stmt);
        break;
      }
      case 'WhileStatement': {
        const s = node as import('../parser/ast').WhileStatement;
        visitNode(s.condition);
        for (const stmt of s.body) visitNode(stmt);
        break;
      }
      case 'RepeatStatement': {
        const s = node as import('../parser/ast').RepeatStatement;
        for (const stmt of s.body) visitNode(stmt);
        visitNode(s.condition);
        break;
      }
      case 'CaseStatement': {
        const s = node as import('../parser/ast').CaseStatement;
        visitNode(s.expression);
        for (const clause of s.cases) {
          for (const val of clause.values) {
            if (val.kind === 'single') visitNode(val.value);
            else { visitNode(val.low); visitNode(val.high); }
          }
          for (const stmt of clause.body) visitNode(stmt);
        }
        if (s.else) for (const stmt of s.else) visitNode(stmt);
        break;
      }

      // Expressions
      case 'BinaryExpression': {
        const e = node as import('../parser/ast').BinaryExpression;
        visitNode(e.left);
        visitNode(e.right);
        break;
      }
      case 'UnaryExpression': {
        const e = node as import('../parser/ast').UnaryExpression;
        visitNode(e.operand);
        break;
      }
      case 'SubscriptExpression': {
        const e = node as import('../parser/ast').SubscriptExpression;
        visitNode(e.base);
        visitNode(e.index);
        break;
      }
      case 'MemberExpression': {
        const e = node as import('../parser/ast').MemberExpression;
        visitNode(e.base);
        // e.member is a plain string — not an AST node, so no recursion needed
        break;
      }
      case 'CallExpression': {
        const e = node as import('../parser/ast').CallExpression;
        visitNode(e.callee);
        for (const arg of e.args) visitNode(arg.value);
        break;
      }

      // Leaf nodes with no children to traverse
      case 'IntegerLiteral':
      case 'RealLiteral':
      case 'StringLiteral':
      case 'BoolLiteral':
      case 'TypeRef':
      case 'ReturnStatement':
      case 'ExitStatement':
      case 'ContinueStatement':
      case 'EmptyStatement':
      case 'AliasDeclaration':
      case 'InterfaceDeclaration':
        break;

      default:
        break;
    }
  }

  visitNode(ast);
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
