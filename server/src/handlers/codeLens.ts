/**
 * CodeLens handler for IEC 61131-3 Structured Text.
 *
 * Provides inline counts above declarations:
 *  - INTERFACE: '# implementations' (FBs that IMPLEMENTS this interface)
 *  - FUNCTION_BLOCK: '# children' (FBs that EXTENDS this FB)
 *  - METHOD on a FUNCTION_BLOCK: 'overridden in # FBs'
 */

import * as fs from 'fs';
import * as path from 'path';
import { CodeLens, CodeLensParams, Range } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { WorkspaceIndex } from '../twincat/workspaceIndex';
import { extractST, PositionMapper } from '../twincat/tcExtractor';
import { getOrParse } from './shared';
import { parse } from '../parser/parser';
import { collectNameExpressions } from './references';
import {
  SourceFile,
  FunctionBlockDeclaration,
  InterfaceDeclaration,
  MethodDeclaration,
  FunctionDeclaration,
  ProgramDeclaration,
  TypeDeclarationBlock,
  AstNode,
} from '../parser/ast';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toRange(node: { range: { start: { line: number; character: number }; end: { line: number; character: number } } }, mapper: PositionMapper): Range {
  return {
    start: mapper.extractedToOriginal(node.range.start.line, node.range.start.character),
    end: mapper.extractedToOriginal(node.range.end.line, node.range.end.character),
  };
}

/**
 * Parse or retrieve the AST for a file URI.
 * Uses the workspaceIndex cache when available.
 */
function getAst(uri: string, workspaceIndex?: WorkspaceIndex): SourceFile | undefined {
  if (workspaceIndex) {
    const cached = workspaceIndex.getAst?.(uri);
    if (cached) return cached.ast;
  }
  try {
    const filePath = uri.startsWith('file://')
      ? decodeURIComponent(uri.replace(/^file:\/\//,''))
      : uri;
    const text = fs.readFileSync(filePath, 'utf8');
    const ext = path.extname(filePath);
    const extraction = extractST(text, ext);
    return parse(extraction.source).ast;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Cross-workspace scan
// ---------------------------------------------------------------------------

interface WorkspaceStats {
  /** interface name (upper) → count of FBs that implement it */
  implementors: Map<string, number>;
  /** FB name (upper) → count of FBs that extend it */
  children: Map<string, number>;
  /**
   * "FB_NAME.METHOD_NAME" (upper) → count of extending FBs that override the method.
   * Only populated for methods declared on FBs that are extended by at least one other FB.
   */
  methodOverrides: Map<string, number>;
}

function buildWorkspaceStats(
  currentUri: string,
  currentAst: SourceFile,
  workspaceIndex?: WorkspaceIndex,
): WorkspaceStats {
  const implementors = new Map<string, number>();
  const children = new Map<string, number>();
  const methodOverrides = new Map<string, number>();

  // Collect all ASTs to scan (current doc + workspace files)
  const allAsts: SourceFile[] = [currentAst];
  if (workspaceIndex) {
    for (const uri of workspaceIndex.getProjectFiles()) {
      if (uri === currentUri) continue;
      const ast = getAst(uri, workspaceIndex);
      if (ast) allAsts.push(ast);
    }
  }

  // Pass 1: gather all FBs and their implements/extends
  const allFBs: FunctionBlockDeclaration[] = [];
  for (const ast of allAsts) {
    for (const decl of ast.declarations) {
      if (decl.kind === 'FunctionBlockDeclaration') {
        allFBs.push(decl as FunctionBlockDeclaration);
      }
    }
  }

  // Count implementors per interface
  for (const fb of allFBs) {
    for (const iface of fb.implementsRefs) {
      const key = iface.name.toUpperCase();
      implementors.set(key, (implementors.get(key) ?? 0) + 1);
    }
  }

  // Count children per parent FB
  for (const fb of allFBs) {
    if (fb.extendsRef) {
      const key = fb.extendsRef.name.toUpperCase();
      children.set(key, (children.get(key) ?? 0) + 1);
    }
  }

  // Count method overrides: for each extending FB, check if it declares a method
  // with the same name as a method in its parent FB.
  // We need a lookup from FB name → its method names
  const fbMethodNames = new Map<string, Set<string>>();
  for (const fb of allFBs) {
    const names = new Set<string>();
    for (const method of fb.methods) {
      names.add(method.name.toUpperCase());
    }
    fbMethodNames.set(fb.name.toUpperCase(), names);
  }

  for (const fb of allFBs) {
    if (!fb.extendsRef) continue;
    const parentKey = fb.extendsRef.name.toUpperCase();
    const childMethods = fbMethodNames.get(fb.name.toUpperCase()) ?? new Set();
    for (const childMethodName of childMethods) {
      const mapKey = `${parentKey}.${childMethodName}`;
      methodOverrides.set(mapKey, (methodOverrides.get(mapKey) ?? 0) + 1);
    }
  }

  return { implementors, children, methodOverrides };
}

// ---------------------------------------------------------------------------
// Reference counting helper
// ---------------------------------------------------------------------------

/**
 * Count references to a symbol in the current document.
 * Excludes the declaration itself (position check).
 */
function countReferencesInDocument(
  ast: SourceFile,
  symbolName: string,
  uri: string,
  declRange: { start: { line: number; character: number }; end: { line: number; character: number } },
): number {
  const locations = collectNameExpressions(ast, symbolName, uri);
  // Filter out the declaration itself by checking if the location matches the declRange
  const usageCount = locations.filter(loc => {
    const isSameStart = loc.range.start.line === declRange.start.line &&
                        loc.range.start.character === declRange.start.character;
    const isSameEnd = loc.range.end.line === declRange.end.line &&
                      loc.range.end.character === declRange.end.character;
    return !(isSameStart && isSameEnd);
  }).length;
  return usageCount;
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

export function handleCodeLens(
  params: CodeLensParams,
  document: TextDocument | undefined,
  workspaceIndex?: WorkspaceIndex,
): CodeLens[] {
  if (!document) return [];

  const { extraction, mapper, ast } = getOrParse(document!);
  const uri = params.textDocument.uri;

  const stats = buildWorkspaceStats(uri, ast, workspaceIndex);
  const lenses: CodeLens[] = [];

  for (const decl of ast.declarations) {
    if (decl.kind === 'InterfaceDeclaration') {
      const iface = decl as InterfaceDeclaration;
      const count = stats.implementors.get(iface.name.toUpperCase()) ?? 0;
      if (count > 0) {
        lenses.push({
          range: toRange(iface, mapper),
          data: { type: 'implementations', name: iface.name },
          command: {
            title: count === 1 ? '1 implementation' : `${count} implementations`,
            command: '',
          },
        });
      }

      // Reference count lens
      const refCount = countReferencesInDocument(ast, iface.name, uri, iface.range);
      if (refCount > 0) {
        lenses.push({
          range: toRange(iface, mapper),
          data: { type: 'references', name: iface.name },
          command: {
            title: refCount === 1 ? '1 reference' : `${refCount} references`,
            command: '',
          },
        });
      }
    }

    if (decl.kind === 'FunctionBlockDeclaration') {
      const fb = decl as FunctionBlockDeclaration;

      // Children lens
      const childCount = stats.children.get(fb.name.toUpperCase()) ?? 0;
      if (childCount > 0) {
        lenses.push({
          range: toRange(fb, mapper),
          data: { type: 'children', name: fb.name },
          command: {
            title: childCount === 1 ? '1 child' : `${childCount} children`,
            command: '',
          },
        });
      }

      // Reference count lens
      const refCount = countReferencesInDocument(ast, fb.name, uri, fb.range);
      if (refCount > 0) {
        lenses.push({
          range: toRange(fb, mapper),
          data: { type: 'references', name: fb.name },
          command: {
            title: refCount === 1 ? '1 reference' : `${refCount} references`,
            command: '',
          },
        });
      }

      // Method override lenses
      for (const method of fb.methods) {
        const mapKey = `${fb.name.toUpperCase()}.${method.name.toUpperCase()}`;
        const overrideCount = stats.methodOverrides.get(mapKey) ?? 0;
        if (overrideCount > 0) {
          lenses.push({
            range: toRange(method as MethodDeclaration, mapper),
            data: { type: 'overrides', fbName: fb.name, methodName: method.name },
            command: {
              title: overrideCount === 1 ? 'overridden in 1 FB' : `overridden in ${overrideCount} FBs`,
              command: '',
            },
          });
        }
      }
    }

    if (decl.kind === 'FunctionDeclaration') {
      const fn = decl as FunctionDeclaration;

      // Reference count lens
      const refCount = countReferencesInDocument(ast, fn.name, uri, fn.range);
      if (refCount > 0) {
        lenses.push({
          range: toRange(fn, mapper),
          data: { type: 'references', name: fn.name },
          command: {
            title: refCount === 1 ? '1 reference' : `${refCount} references`,
            command: '',
          },
        });
      }
    }

    if (decl.kind === 'ProgramDeclaration') {
      const prog = decl as ProgramDeclaration;

      // Reference count lens
      const refCount = countReferencesInDocument(ast, prog.name, uri, prog.range);
      if (refCount > 0) {
        lenses.push({
          range: toRange(prog, mapper),
          data: { type: 'references', name: prog.name },
          command: {
            title: refCount === 1 ? '1 reference' : `${refCount} references`,
            command: '',
          },
        });
      }
    }

    if (decl.kind === 'TypeDeclarationBlock') {
      const typeBlock = decl as TypeDeclarationBlock;

      // For each type declaration in the block
      for (const typeDecl of typeBlock.declarations) {
        const refCount = countReferencesInDocument(ast, typeDecl.name, uri, typeDecl.range);
        if (refCount > 0) {
          lenses.push({
            range: toRange(typeDecl, mapper),
            data: { type: 'references', name: typeDecl.name },
            command: {
              title: refCount === 1 ? '1 reference' : `${refCount} references`,
              command: '',
            },
          });
        }
      }
    }
  }

  return lenses;
}
