/**
 * CodeLens handler for IEC 61131-3 Structured Text.
 *
 * Provides inline counts above declarations:
 *  - INTERFACE: '# implementations' (FBs that IMPLEMENTS this interface)
 *  - FUNCTION_BLOCK: '# children' (FBs that EXTENDS this FB)
 *  - METHOD on a FUNCTION_BLOCK: 'overridden in # FBs'
 */

import * as fs from 'fs';
import { CodeLens, CodeLensParams, Range } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { WorkspaceIndex } from '../twincat/workspaceIndex';
import { parse } from '../parser/parser';
import {
  SourceFile,
  FunctionBlockDeclaration,
  InterfaceDeclaration,
  MethodDeclaration,
} from '../parser/ast';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toRange(node: { range: { start: { line: number; character: number }; end: { line: number; character: number } } }): Range {
  return {
    start: { line: node.range.start.line, character: node.range.start.character },
    end: { line: node.range.end.line, character: node.range.end.character },
  };
}

/**
 * Parse or retrieve the AST for a file URI.
 * Uses the workspaceIndex cache when available.
 */
function getAst(uri: string, workspaceIndex?: WorkspaceIndex): SourceFile | undefined {
  if (workspaceIndex) {
    const cached = workspaceIndex.getAst(uri);
    if (cached) return cached.ast;
  }
  try {
    const filePath = uri.startsWith('file://')
      ? decodeURIComponent(uri.replace(/^file:\/\//, ''))
      : uri;
    const text = fs.readFileSync(filePath, 'utf8');
    return parse(text).ast;
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
    for (const iface of fb.implements) {
      const key = iface.toUpperCase();
      implementors.set(key, (implementors.get(key) ?? 0) + 1);
    }
  }

  // Count children per parent FB
  for (const fb of allFBs) {
    if (fb.extends) {
      const key = fb.extends.toUpperCase();
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
    if (!fb.extends) continue;
    const parentKey = fb.extends.toUpperCase();
    const childMethods = fbMethodNames.get(fb.name.toUpperCase()) ?? new Set();
    for (const childMethodName of childMethods) {
      const mapKey = `${parentKey}.${childMethodName}`;
      methodOverrides.set(mapKey, (methodOverrides.get(mapKey) ?? 0) + 1);
    }
  }

  return { implementors, children, methodOverrides };
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

  const text = document.getText();
  const { ast } = parse(text);
  const uri = params.textDocument.uri;

  const stats = buildWorkspaceStats(uri, ast, workspaceIndex);
  const lenses: CodeLens[] = [];

  for (const decl of ast.declarations) {
    if (decl.kind === 'InterfaceDeclaration') {
      const iface = decl as InterfaceDeclaration;
      const count = stats.implementors.get(iface.name.toUpperCase()) ?? 0;
      if (count > 0) {
        lenses.push({
          range: toRange(iface),
          data: { type: 'implementations', name: iface.name },
          command: {
            title: count === 1 ? '1 implementation' : `${count} implementations`,
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
          range: toRange(fb),
          data: { type: 'children', name: fb.name },
          command: {
            title: childCount === 1 ? '1 child' : `${childCount} children`,
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
            range: toRange(method as MethodDeclaration),
            data: { type: 'overrides', fbName: fb.name, methodName: method.name },
            command: {
              title: overrideCount === 1 ? 'overridden in 1 FB' : `overridden in ${overrideCount} FBs`,
              command: '',
            },
          });
        }
      }
    }
  }

  return lenses;
}
