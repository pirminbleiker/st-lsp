/**
 * Scope analysis and text-based cursor context detection for completion.
 *
 * Provides functions for:
 * - Collecting variable declarations from the enclosing POU
 * - Detecting dot-access, SUPER^., assignment, and CASE contexts
 * - Finding the EXTENDS name of an enclosing FB
 */

import {
  FunctionBlockDeclaration,
  FunctionDeclaration,
  ProgramDeclaration,
  TopLevelDeclaration,
  VarDeclaration,
  Position,
} from '../parser/ast';
import { positionContains } from '../parser/astUtils';

/**
 * Collect all VarDeclaration nodes from the enclosing POU's var blocks.
 */
export function collectVarDeclarations(
  declarations: TopLevelDeclaration[],
  pos: Position,
): Array<{ vd: VarDeclaration; constant?: boolean }> {
  for (const decl of declarations) {
    if (!positionContains(decl.range.start, decl.range.end, pos)) continue;

    // Check if it's a POU
    if (decl.kind === 'ProgramDeclaration' ||
        decl.kind === 'FunctionBlockDeclaration' ||
        decl.kind === 'FunctionDeclaration') {
      const vars: Array<{ vd: VarDeclaration; constant?: boolean }> = [];
      const pou = decl as ProgramDeclaration | FunctionBlockDeclaration | FunctionDeclaration;
      for (const vb of pou.varBlocks) {
        for (const vd of vb.declarations) {
          vars.push({ vd, constant: vb.constant });
        }
      }
      return vars;
    }
  }
  return [];
}

/**
 * If the character immediately before the cursor is '.', return the identifier
 * that precedes it; otherwise return null.
 */
export function getIdentifierBeforeDot(text: string, line: number, character: number): string | null {
  const lines = text.split('\n');
  if (line >= lines.length) return null;
  const lineText = lines[line];
  if (character === 0 || lineText[character - 1] !== '.') return null;

  let i = character - 2;
  while (i >= 0 && /[a-zA-Z0-9_.^]/.test(lineText[i])) i--;
  const ident = lineText.slice(i + 1, character - 1).replace(/\^/g, '');
  return ident.length > 0 ? ident : null;
}

/**
 * Return true if the text immediately before the cursor ends with `SUPER^.`
 * (case-insensitive, with optional whitespace around `^` and `.`).
 */
export function isSuperBeforeDot(text: string, line: number, character: number): boolean {
  const lines = text.split('\n');
  if (line >= lines.length) return false;
  const lineText = lines[line];
  // The cursor must be at/after a '.' that follows SUPER^
  const prefix = lineText.slice(0, character);
  return /\bSUPER\s*\^\s*\.\s*$/i.test(prefix);
}

/**
 * Return the `extends` name of the FUNCTION_BLOCK enclosing `pos`, or null.
 */
export function getEnclosingFbExtends(
  declarations: TopLevelDeclaration[],
  pos: Position,
): string | null {
  for (const decl of declarations) {
    if (decl.kind !== 'FunctionBlockDeclaration') continue;
    const fb = decl as FunctionBlockDeclaration;
    if (!positionContains(fb.range.start, fb.range.end, pos)) continue;
    return fb.extendsRef?.name ?? null;
  }
  return null;
}

/**
 * If the line up to the cursor contains `<ident> :=`, return the LHS identifier.
 * Returns null if not in an assignment context.
 */
export function getLhsIdentifierForAssignment(text: string, line: number, character: number): string | null {
  const lines = text.split('\n');
  if (line >= lines.length) return null;
  const lineUpToCursor = lines[line].slice(0, character);
  const assignIdx = lineUpToCursor.lastIndexOf(':=');
  if (assignIdx < 0) return null;
  // After := there should only be whitespace or a partial identifier (no operators)
  const afterAssign = lineUpToCursor.slice(assignIdx + 2);
  if (/[^A-Za-z0-9_.\s]/.test(afterAssign)) return null;
  const beforeAssign = lineUpToCursor.slice(0, assignIdx).trimEnd();
  const identMatch = beforeAssign.match(/\b([A-Za-z_][A-Za-z0-9_]*)$/);
  return identMatch ? identMatch[1] : null;
}

/**
 * If the cursor is inside a CASE...OF block, return the selector identifier.
 * Scans backwards to find the nearest enclosing CASE...OF, accounting for nesting.
 */
export function getCaseSelectorIdentifier(text: string, line: number): string | null {
  const lines = text.split('\n');
  let depth = 0;
  for (let l = line; l >= 0; l--) {
    const lineText = lines[l];
    if (/\bEND_CASE\b/i.test(lineText)) depth++;
    const match = /\bCASE\s+([A-Za-z_][A-Za-z0-9_]*)\s+OF\b/i.exec(lineText);
    if (match) {
      if (depth > 0) {
        depth--;
      } else {
        return match[1];
      }
    }
  }
  return null;
}

// ---- Variants that operate on pre-split lines (for use with extracted ST source) ----

export function getIdentifierBeforeDotInLines(lines: string[], line: number, character: number): string | null {
  if (line >= lines.length) return null;
  const lineText = lines[line];
  if (character === 0 || lineText[character - 1] !== '.') return null;
  let i = character - 2;
  while (i >= 0 && /[a-zA-Z0-9_.^]/.test(lineText[i])) i--;
  const ident = lineText.slice(i + 1, character - 1).replace(/\^/g, '');
  return ident.length > 0 ? ident : null;
}

export function isSuperBeforeDotInLines(lines: string[], line: number, character: number): boolean {
  if (line >= lines.length) return false;
  const prefix = lines[line].slice(0, character);
  return /\bSUPER\s*\^\s*\.\s*$/i.test(prefix);
}

export function getLhsIdentifierForAssignmentInLines(lines: string[], line: number, character: number): string | null {
  if (line >= lines.length) return null;
  const lineUpToCursor = lines[line].slice(0, character);
  const assignIdx = lineUpToCursor.lastIndexOf(':=');
  if (assignIdx < 0) return null;
  const afterAssign = lineUpToCursor.slice(assignIdx + 2);
  if (/[^A-Za-z0-9_.\s]/.test(afterAssign)) return null;
  const beforeAssign = lineUpToCursor.slice(0, assignIdx).trimEnd();
  const identMatch = beforeAssign.match(/\b([A-Za-z_][A-Za-z0-9_]*)$/);
  return identMatch ? identMatch[1] : null;
}

export function getCaseSelectorIdentifierInLines(lines: string[], line: number): string | null {
  let depth = 0;
  for (let l = line; l >= 0; l--) {
    const lineText = lines[l];
    if (/\bEND_CASE\b/i.test(lineText)) depth++;
    const match = /\bCASE\s+([A-Za-z_][A-Za-z0-9_]*)\s+OF\b/i.exec(lineText);
    if (match) {
      if (depth > 0) {
        depth--;
      } else {
        return match[1];
      }
    }
  }
  return null;
}
