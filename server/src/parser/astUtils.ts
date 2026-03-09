/**
 * Shared AST utility functions used across multiple LSP handlers.
 *
 * Pure AST operations with no filesystem or workspace dependencies.
 */

import {
  FunctionBlockDeclaration,
  FunctionDeclaration,
  Position,
  ProgramDeclaration,
  SourceFile,
  TopLevelDeclaration,
  VarDeclaration,
  VarKind,
} from './ast';

/**
 * Check whether a position falls within a node's range (inclusive).
 */
export function positionContains(nodeStart: Position, nodeEnd: Position, pos: Position): boolean {
  if (pos.line < nodeStart.line || pos.line > nodeEnd.line) return false;
  if (pos.line === nodeStart.line && pos.character < nodeStart.character) return false;
  if (pos.line === nodeEnd.line && pos.character > nodeEnd.character) return false;
  return true;
}

/**
 * Collect all VarDeclaration nodes from the enclosing POU's var blocks,
 * together with the VarKind and qualifier of the block they belong to.
 * Walks top-level declarations to find the POU that contains `pos`.
 * When the cursor is inside a method, also collects that method's var blocks.
 */
export function collectVarDeclarations(
  ast: SourceFile,
  pos: Position,
): Array<{ vd: VarDeclaration; varKind: VarKind; qualifier?: string }> {
  for (const decl of ast.declarations) {
    if (!positionContains(decl.range.start, decl.range.end, pos)) continue;
    if (
      decl.kind !== 'ProgramDeclaration' &&
      decl.kind !== 'FunctionBlockDeclaration' &&
      decl.kind !== 'FunctionDeclaration'
    ) continue;
    const vars: Array<{ vd: VarDeclaration; varKind: VarKind; qualifier?: string }> = [];
    const pou = decl as ProgramDeclaration | FunctionBlockDeclaration | FunctionDeclaration;
    for (const vb of pou.varBlocks) {
      const qualifier = vb.constant ? 'CONSTANT' : vb.retain ? 'RETAIN' : vb.persistent ? 'PERSISTENT' : undefined;
      for (const vd of vb.declarations) {
        vars.push({ vd, varKind: vb.varKind, qualifier });
      }
    }
    if (decl.kind === 'FunctionBlockDeclaration') {
      const fb = decl as FunctionBlockDeclaration;
      for (const method of fb.methods) {
        if (!positionContains(method.range.start, method.range.end, pos)) continue;
        for (const vb of method.varBlocks) {
          const qualifier = vb.constant ? 'CONSTANT' : undefined;
          for (const vd of vb.declarations) {
            vars.push({ vd, varKind: vb.varKind, qualifier });
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
 * Collect all VarDeclaration nodes from the POU that encloses `pos`.
 * When the cursor is inside a method, also collects that method's var blocks.
 * Returns plain VarDeclaration nodes without block metadata.
 */
export function collectLocalVars(ast: SourceFile, pos: Position): VarDeclaration[] {
  for (const decl of ast.declarations) {
    if (!positionContains(decl.range.start, decl.range.end, pos)) continue;
    const pou = decl as ProgramDeclaration | FunctionBlockDeclaration | FunctionDeclaration;
    const vars: VarDeclaration[] = [];
    for (const vb of pou.varBlocks) {
      for (const vd of vb.declarations) {
        vars.push(vd);
      }
    }
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
 * Collect all VarDeclaration names from a POU's var blocks (all sections).
 * Returns a Set of uppercase names.
 */
export function collectPouVarNames(
  pou: ProgramDeclaration | FunctionBlockDeclaration | FunctionDeclaration,
): Set<string> {
  const names = new Set<string>();
  for (const vb of pou.varBlocks) {
    for (const vd of vb.declarations) {
      names.add(vd.name.toUpperCase());
    }
  }
  return names;
}

/**
 * Find the first POU declaration whose name matches (case-insensitive).
 */
export function findPouDeclaration(
  ast: SourceFile,
  name: string,
): TopLevelDeclaration | undefined {
  const upper = name.toUpperCase();
  return ast.declarations.find(
    d => 'name' in d && (d as { name: string }).name.toUpperCase() === upper,
  );
}
