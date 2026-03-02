/**
 * Inlay Hints handler for IEC 61131-3 Structured Text.
 *
 * For every CallExpression in the visible range, resolves the callee to its
 * declaration and emits InlayHint labels showing parameter names inline for
 * each positional (non-named) argument.
 *
 * Scope: FUNCTION calls, FUNCTION_BLOCK instantiation calls, METHOD calls.
 * Named arguments (myFB(IN := value)) are already explicit and are skipped.
 */

import { InlayHint, InlayHintKind, Range as LspRange } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import {
  CallExpression,
  CallStatement,
  FunctionBlockDeclaration,
  FunctionDeclaration,
  ProgramDeclaration,
  SourceFile,
  Statement,
  VarBlock,
  VarDeclaration,
} from '../parser/ast';
import { parse } from '../parser/parser';
import { STANDARD_FBS } from '../twincat/stdlib';
import { WorkspaceIndex } from '../twincat/workspaceIndex';
import { extractST } from '../twincat/tcExtractor';
import { getOrParse } from './shared';
import * as fs from 'fs';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Parameter resolution helpers (mirroring signatureHelp logic)
// ---------------------------------------------------------------------------

interface ParamList {
  names: string[];
}

function getInputParams(decl: FunctionDeclaration | FunctionBlockDeclaration): string[] {
  const names: string[] = [];
  for (const vb of decl.varBlocks) {
    const varBlock = vb as VarBlock;
    if (varBlock.varKind !== 'VAR_INPUT') continue;
    for (const vd of varBlock.declarations) {
      names.push((vd as VarDeclaration).name);
    }
  }
  return names;
}

function resolveVarTypeName(varName: string, ast: SourceFile): string | null {
  const upper = varName.toUpperCase();
  for (const decl of ast.declarations) {
    if (
      decl.kind !== 'ProgramDeclaration' &&
      decl.kind !== 'FunctionBlockDeclaration' &&
      decl.kind !== 'FunctionDeclaration'
    ) continue;
    const pou = decl as ProgramDeclaration | FunctionBlockDeclaration | FunctionDeclaration;
    for (const vb of pou.varBlocks) {
      for (const vd of vb.declarations) {
        const varDecl = vd as VarDeclaration;
        if (varDecl.name.toUpperCase() === upper) {
          return varDecl.type.name;
        }
      }
    }
  }
  return null;
}

function lookupParams(
  calleeName: string,
  ast: SourceFile,
  workspaceIndex: WorkspaceIndex | undefined,
  currentUri: string,
): ParamList | null {
  const upper = calleeName.toUpperCase();

  // 1. Standard library FBs
  const stdFb = STANDARD_FBS.find((fb) => fb.name === upper);
  if (stdFb) {
    return { names: stdFb.inputs.map((p) => p.name) };
  }

  // 2. User-defined FUNCTIONs and FUNCTION_BLOCKs in the current file
  for (const decl of ast.declarations) {
    if (
      decl.kind === 'FunctionDeclaration' ||
      decl.kind === 'FunctionBlockDeclaration'
    ) {
      const pou = decl as FunctionDeclaration | FunctionBlockDeclaration;
      if (pou.name.toUpperCase() === upper) {
        return { names: getInputParams(pou) };
      }
    }
  }

  // 3. Variable instance call: resolve var → type, then look up type
  const typeName = resolveVarTypeName(calleeName, ast);
  if (typeName) {
    const typeUpper = typeName.toUpperCase();
    const stdFbForType = STANDARD_FBS.find((fb) => fb.name === typeUpper);
    if (stdFbForType) {
      return { names: stdFbForType.inputs.map((p) => p.name) };
    }
    for (const decl of ast.declarations) {
      if (decl.kind === 'FunctionBlockDeclaration') {
        const fb = decl as FunctionBlockDeclaration;
        if (fb.name.toUpperCase() === typeUpper) {
          return { names: getInputParams(fb) };
        }
      }
    }
    // Cross-file lookup for instance type
    if (workspaceIndex) {
      const params = lookupInWorkspace(typeUpper, workspaceIndex, currentUri);
      if (params) return params;
    }
  }

  // 4. Cross-file POU lookup
  if (workspaceIndex) {
    const params = lookupInWorkspace(upper, workspaceIndex, currentUri);
    if (params) return params;
  }

  return null;
}

function lookupInWorkspace(
  nameUpper: string,
  workspaceIndex: WorkspaceIndex,
  currentUri: string,
): ParamList | null {
  for (const fileUri of workspaceIndex.getProjectFiles()) {
    if (fileUri === currentUri) continue;
    let fileAst: SourceFile | undefined;
    const cached = workspaceIndex.getAst?.(fileUri);
    if (cached) {
      fileAst = cached.ast;
    } else {
      try {
        const filePath = fileUri.startsWith('file://')
          ? decodeURIComponent(fileUri.replace(/^file:\/\//, ''))
          : fileUri;
        const rawText = fs.readFileSync(filePath, 'utf8');
        const otherExt = path.extname(filePath);
        const otherExtraction = extractST(rawText, otherExt);
        fileAst = parse(otherExtraction.source).ast;
      } catch {
        continue;
      }
    }
    for (const decl of fileAst.declarations) {
      if (
        decl.kind === 'FunctionDeclaration' ||
        decl.kind === 'FunctionBlockDeclaration'
      ) {
        const pou = decl as FunctionDeclaration | FunctionBlockDeclaration;
        if (pou.name.toUpperCase() === nameUpper) {
          return { names: getInputParams(pou) };
        }
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Callee name extraction
// ---------------------------------------------------------------------------

/**
 * Extract the simple identifier name from a callee expression.
 * Handles NameExpression (plain call) and MemberExpression (obj.method).
 * Returns null for complex callees we cannot resolve.
 */
function getCalleeName(
  callee: import('../parser/ast').Expression,
): string | null {
  if (callee.kind === 'NameExpression') {
    return (callee as import('../parser/ast').NameExpression).name;
  }
  if (callee.kind === 'MemberExpression') {
    // method call: obj.Method — use the member name to look up method params
    return (callee as import('../parser/ast').MemberExpression).member;
  }
  return null;
}

// ---------------------------------------------------------------------------
// AST traversal — collect all CallExpressions in range
// ---------------------------------------------------------------------------

function rangeOverlaps(
  nodeStart: import('../parser/ast').Position,
  nodeEnd: import('../parser/ast').Position,
  range: LspRange,
): boolean {
  if (nodeEnd.line < range.start.line || nodeStart.line > range.end.line) return false;
  return true;
}

function collectCallExpressionsInRange(
  ast: SourceFile,
  range: LspRange,
): CallExpression[] {
  const results: CallExpression[] = [];

  function visitExpr(expr: import('../parser/ast').Expression): void {
    switch (expr.kind) {
      case 'CallExpression': {
        const ce = expr as CallExpression;
        if (rangeOverlaps(ce.range.start, ce.range.end, range)) {
          results.push(ce);
        }
        // visit callee and args recursively
        visitExpr(ce.callee);
        for (const arg of ce.args) visitExpr(arg.value);
        break;
      }
      case 'BinaryExpression': {
        const be = expr as import('../parser/ast').BinaryExpression;
        visitExpr(be.left);
        visitExpr(be.right);
        break;
      }
      case 'UnaryExpression':
        visitExpr((expr as import('../parser/ast').UnaryExpression).operand);
        break;
      case 'SubscriptExpression': {
        const se = expr as import('../parser/ast').SubscriptExpression;
        visitExpr(se.base);
        visitExpr(se.index);
        break;
      }
      case 'MemberExpression':
        visitExpr((expr as import('../parser/ast').MemberExpression).base);
        break;
      default:
        break;
    }
  }

  function visitStmt(stmt: Statement): void {
    switch (stmt.kind) {
      case 'CallStatement': {
        const cs = stmt as CallStatement;
        if (rangeOverlaps(cs.range.start, cs.range.end, range)) {
          // Synthesise a CallExpression from a CallStatement so we can handle
          // both uniformly. They share the same callee+args structure.
          results.push({
            kind: 'CallExpression',
            callee: cs.callee,
            args: cs.args,
            range: cs.range,
          });
          for (const arg of cs.args) visitExpr(arg.value);
        }
        visitExpr(cs.callee);
        break;
      }
      case 'AssignmentStatement': {
        const as_ = stmt as import('../parser/ast').AssignmentStatement;
        visitExpr(as_.left);
        visitExpr(as_.right);
        break;
      }
      case 'IfStatement': {
        const is_ = stmt as import('../parser/ast').IfStatement;
        visitExpr(is_.condition);
        for (const s of is_.then) visitStmt(s);
        for (const elsif of is_.elsifs) {
          visitExpr(elsif.condition);
          for (const s of elsif.body) visitStmt(s);
        }
        if (is_.else) for (const s of is_.else) visitStmt(s);
        break;
      }
      case 'ForStatement': {
        const fs_ = stmt as import('../parser/ast').ForStatement;
        visitExpr(fs_.from);
        visitExpr(fs_.to);
        if (fs_.by) visitExpr(fs_.by);
        for (const s of fs_.body) visitStmt(s);
        break;
      }
      case 'WhileStatement': {
        const ws = stmt as import('../parser/ast').WhileStatement;
        visitExpr(ws.condition);
        for (const s of ws.body) visitStmt(s);
        break;
      }
      case 'RepeatStatement': {
        const rs = stmt as import('../parser/ast').RepeatStatement;
        for (const s of rs.body) visitStmt(s);
        visitExpr(rs.condition);
        break;
      }
      case 'CaseStatement': {
        const cs_ = stmt as import('../parser/ast').CaseStatement;
        visitExpr(cs_.expression);
        for (const clause of cs_.cases) {
          for (const s of clause.body) visitStmt(s);
        }
        if (cs_.else) for (const s of cs_.else) visitStmt(s);
        break;
      }
      default:
        break;
    }
  }

  for (const decl of ast.declarations) {
    if (
      decl.kind === 'ProgramDeclaration' ||
      decl.kind === 'FunctionBlockDeclaration' ||
      decl.kind === 'FunctionDeclaration'
    ) {
      const pou = decl as ProgramDeclaration | FunctionBlockDeclaration | FunctionDeclaration;
      for (const stmt of pou.body) visitStmt(stmt);
      // Also visit method bodies
      if (decl.kind === 'FunctionBlockDeclaration') {
        const fb = decl as FunctionBlockDeclaration;
        for (const method of fb.methods) {
          for (const stmt of method.body) visitStmt(stmt);
        }
        for (const action of fb.actions) {
          for (const stmt of action.body) visitStmt(stmt);
        }
      }
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

export function handleInlayHints(
  document: TextDocument | undefined,
  range: LspRange,
  workspaceIndex: WorkspaceIndex | undefined,
): InlayHint[] {
  if (!document) return [];

  const { extraction, mapper, ast } = getOrParse(document!);

  // Convert the incoming visible range from original-file to extracted-source coordinates.
  const extractedRangeStart = mapper.originalToExtracted(range.start.line, range.start.character)
    ?? { line: range.start.line, character: range.start.character };
  const extractedRangeEnd = mapper.originalToExtracted(range.end.line, range.end.character)
    ?? { line: range.end.line, character: range.end.character };
  const extractedRange: LspRange = {
    start: { line: extractedRangeStart.line, character: extractedRangeStart.character },
    end: { line: extractedRangeEnd.line, character: extractedRangeEnd.character },
  };

  const callExprs = collectCallExpressionsInRange(ast, extractedRange);
  const hints: InlayHint[] = [];

  for (const ce of callExprs) {
    const calleeName = getCalleeName(ce.callee);
    if (!calleeName) continue;

    const params = lookupParams(calleeName, ast, workspaceIndex, document.uri);
    if (!params || params.names.length === 0) continue;

    // Walk positional (unnamed) arguments and emit hints
    let positionalIdx = 0;
    for (const arg of ce.args) {
      if (arg.name !== undefined) {
        // Named argument — already explicit, skip but don't count toward positional
        continue;
      }
      const paramName = params.names[positionalIdx];
      if (paramName !== undefined) {
        // Map hint position from extracted-source back to original-file coordinates.
        const hintPos = mapper.extractedToOriginal(
          arg.value.range.start.line,
          arg.value.range.start.character,
        );
        hints.push({
          position: hintPos,
          label: `${paramName}:`,
          kind: InlayHintKind.Parameter,
          paddingRight: true,
        });
      }
      positionalIdx++;
    }
  }

  return hints;
}
