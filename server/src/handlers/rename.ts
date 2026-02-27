/**
 * Rename Symbol handler for IEC 61131-3 Structured Text.
 *
 * Given a cursor position and a new name, finds all occurrences of the
 * identifier under the cursor across the current document and all workspace
 * files, and returns a WorkspaceEdit that replaces each occurrence with the
 * new name.
 *
 * ST is case-insensitive, so matching is done case-insensitively, but the
 * replacement always uses the exact string supplied by the client (newName).
 *
 * MemberExpression handling: only the base expression is walked; the .member
 * field name is never renamed (it is a field access, not a reference to the
 * symbol being renamed).
 */

import * as fs from 'fs';
import {
  RenameParams,
  WorkspaceEdit,
  TextEdit,
  Range,
  TextDocumentPositionParams,
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { WorkspaceIndex } from '../twincat/workspaceIndex';
import { parse } from '../parser/parser';
import { findNodeAtPosition } from './hover';
import {
  AstNode,
  NameExpression,
  SourceFile,
  ProgramDeclaration,
  FunctionBlockDeclaration,
  FunctionDeclaration,
  VarDeclaration,
  VarBlock,
  AssignmentStatement,
  CallStatement,
  IfStatement,
  ForStatement,
  WhileStatement,
  RepeatStatement,
  CaseStatement,
  BinaryExpression,
  UnaryExpression,
  SubscriptExpression,
  MemberExpression,
  CallExpression,
  TypeDeclarationBlock,
  InterfaceDeclaration,
  MethodDeclaration,
} from '../parser/ast';

// ---------------------------------------------------------------------------
// AST walker — collect all NameExpression nodes matching a name
// ---------------------------------------------------------------------------

interface NameMatch {
  range: Range;
}

/**
 * Walk the entire AST and collect the ranges of all NameExpression nodes
 * whose name matches `targetName` (case-insensitive).
 *
 * MemberExpression: only the base is walked recursively; the .member string
 * is intentionally skipped so field names are not renamed.
 */
function collectNameMatches(ast: SourceFile, targetName: string): NameMatch[] {
  const upper = targetName.toUpperCase();
  const results: NameMatch[] = [];

  function visitExpr(node: AstNode): void {
    switch (node.kind) {
      case 'NameExpression': {
        const n = node as NameExpression;
        if (n.name.toUpperCase() === upper) {
          results.push({ range: n.range });
        }
        break;
      }
      case 'MemberExpression': {
        // Only walk the base; do NOT rename the .member field name
        const e = node as MemberExpression;
        visitExpr(e.base);
        break;
      }
      case 'BinaryExpression': {
        const e = node as BinaryExpression;
        visitExpr(e.left);
        visitExpr(e.right);
        break;
      }
      case 'UnaryExpression': {
        const e = node as UnaryExpression;
        visitExpr(e.operand);
        break;
      }
      case 'SubscriptExpression': {
        const e = node as SubscriptExpression;
        visitExpr(e.base);
        visitExpr(e.index);
        break;
      }
      case 'CallExpression': {
        const e = node as CallExpression;
        visitExpr(e.callee);
        for (const arg of e.args) visitExpr(arg.value);
        break;
      }
      // Literals — nothing to walk
      default:
        break;
    }
  }

  function visitStmt(node: AstNode): void {
    switch (node.kind) {
      case 'AssignmentStatement': {
        const s = node as AssignmentStatement;
        visitExpr(s.left);
        visitExpr(s.right);
        break;
      }
      case 'CallStatement': {
        const s = node as CallStatement;
        visitExpr(s.callee);
        for (const arg of s.args) visitExpr(arg.value);
        break;
      }
      case 'IfStatement': {
        const s = node as IfStatement;
        visitExpr(s.condition);
        for (const stmt of s.then) visitStmt(stmt);
        for (const elsif of s.elsifs) {
          visitExpr(elsif.condition);
          for (const stmt of elsif.body) visitStmt(stmt);
        }
        if (s.else) for (const stmt of s.else) visitStmt(stmt);
        break;
      }
      case 'ForStatement': {
        const s = node as ForStatement;
        if (s.variable.toUpperCase() === upper) {
          results.push({ range: s.variableRange });
        }
        visitExpr(s.from);
        visitExpr(s.to);
        if (s.by) visitExpr(s.by);
        for (const stmt of s.body) visitStmt(stmt);
        break;
      }
      case 'WhileStatement': {
        const s = node as WhileStatement;
        visitExpr(s.condition);
        for (const stmt of s.body) visitStmt(stmt);
        break;
      }
      case 'RepeatStatement': {
        const s = node as RepeatStatement;
        for (const stmt of s.body) visitStmt(stmt);
        visitExpr(s.condition);
        break;
      }
      case 'CaseStatement': {
        const s = node as CaseStatement;
        visitExpr(s.expression);
        for (const clause of s.cases) {
          for (const val of clause.values) {
            if (val.kind === 'single') visitExpr(val.value);
            else { visitExpr(val.low); visitExpr(val.high); }
          }
          for (const stmt of clause.body) visitStmt(stmt);
        }
        if (s.else) for (const stmt of s.else) visitStmt(stmt);
        break;
      }
      // ReturnStatement, ExitStatement, ContinueStatement, EmptyStatement —
      // no expressions to walk
      default:
        break;
    }
  }

  function visitVarBlock(vb: VarBlock): void {
    for (const vd of vb.declarations) {
      visitVarDecl(vd);
    }
  }

  function visitVarDecl(vd: VarDeclaration): void {
    if (vd.name.toUpperCase() === upper) {
      results.push({ range: vd.nameRange });
    }
    if (vd.initialValue) visitExpr(vd.initialValue);
  }

  function visitMethod(method: MethodDeclaration): void {
    for (const vb of method.varBlocks) visitVarBlock(vb);
    for (const stmt of method.body) visitStmt(stmt);
  }

  for (const decl of ast.declarations) {
    switch (decl.kind) {
      case 'ProgramDeclaration': {
        const pou = decl as ProgramDeclaration;
        for (const vb of pou.varBlocks) visitVarBlock(vb);
        for (const stmt of pou.body) visitStmt(stmt);
        break;
      }
      case 'FunctionBlockDeclaration': {
        const pou = decl as FunctionBlockDeclaration;
        for (const vb of pou.varBlocks) visitVarBlock(vb);
        for (const stmt of pou.body) visitStmt(stmt);
        for (const method of pou.methods) visitMethod(method);
        break;
      }
      case 'FunctionDeclaration': {
        const fn = decl as FunctionDeclaration;
        for (const vb of fn.varBlocks) visitVarBlock(vb);
        for (const stmt of fn.body) visitStmt(stmt);
        break;
      }
      case 'TypeDeclarationBlock': {
        // Type declarations don't contain expressions referencing symbols
        // (only type references), so nothing to walk for name expressions.
        const _ = decl as TypeDeclarationBlock;
        void _;
        break;
      }
      case 'InterfaceDeclaration': {
        const iface = decl as InterfaceDeclaration;
        for (const method of iface.methods) visitMethod(method);
        break;
      }
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// handleRename
// ---------------------------------------------------------------------------

/** Returns true if `pos` falls within `range` (inclusive start, exclusive end). */
function positionInRange(pos: { line: number; character: number }, range: Range): boolean {
  if (pos.line < range.start.line || pos.line > range.end.line) return false;
  if (pos.line === range.start.line && pos.character < range.start.character) return false;
  if (pos.line === range.end.line && pos.character >= range.end.character) return false;
  return true;
}

export function handleRename(
  params: RenameParams,
  document: TextDocument | undefined,
  workspaceIndex?: WorkspaceIndex,
): WorkspaceEdit | null {
  if (!document) return null;

  const text = document.getText();
  const { ast } = parse(text);

  const { line, character } = params.position;
  const node = findNodeAtPosition(ast, line, character);
  if (!node) return null;

  let targetName: string;
  if (node.kind === 'NameExpression') {
    targetName = (node as NameExpression).name;
  } else if (node.kind === 'ForStatement') {
    const fs = node as ForStatement;
    if (!positionInRange({ line, character }, fs.variableRange)) return null;
    targetName = fs.variable;
  } else if (node.kind === 'VarDeclaration') {
    const vd = node as VarDeclaration;
    if (!positionInRange({ line, character }, vd.nameRange)) return null;
    targetName = vd.name;
  } else {
    return null;
  }
  if (!targetName) return null;

  const newName = params.newName;
  const currentUri = params.textDocument.uri;

  const changes: { [uri: string]: TextEdit[] } = {};

  // --- Current document ---
  const currentMatches = collectNameMatches(ast, targetName);
  if (currentMatches.length > 0) {
    changes[currentUri] = currentMatches.map(m => TextEdit.replace(m.range, newName));
  }

  // --- Other workspace files ---
  if (workspaceIndex) {
    const projectFiles = workspaceIndex.getProjectFiles();
    for (const fileUri of projectFiles) {
      if (fileUri === currentUri) continue;

      let fileText: string;
      try {
        const filePath = fileUri.startsWith('file://')
          ? decodeURIComponent(fileUri.replace(/^file:\/\//, ''))
          : fileUri;
        fileText = fs.readFileSync(filePath, 'utf8');
      } catch {
        continue;
      }

      const { ast: otherAst } = parse(fileText);
      const otherMatches = collectNameMatches(otherAst, targetName);
      if (otherMatches.length > 0) {
        changes[fileUri] = otherMatches.map(m => TextEdit.replace(m.range, newName));
      }
    }
  }

  return { changes };
}

// ---------------------------------------------------------------------------
// handlePrepareRename
// ---------------------------------------------------------------------------

/**
 * Returns the range of the identifier under the cursor, or null if the cursor
 * is not on a renameable identifier. VSCode calls this before showing the
 * rename input box, to verify that rename is valid and to pre-fill the box.
 */
export function handlePrepareRename(
  params: TextDocumentPositionParams,
  document: TextDocument | undefined,
): Range | null {
  if (!document) return null;

  const text = document.getText();
  const { ast } = parse(text);

  const { line, character } = params.position;
  const node = findNodeAtPosition(ast, line, character);
  if (!node) return null;

  if (node.kind === 'NameExpression') {
    const name = (node as NameExpression).name;
    if (!name) return null;
    return { start: node.range.start, end: node.range.end };
  }

  if (node.kind === 'ForStatement') {
    const fs = node as ForStatement;
    if (!positionInRange({ line, character }, fs.variableRange)) return null;
    return { start: fs.variableRange.start, end: fs.variableRange.end };
  }

  if (node.kind === 'VarDeclaration') {
    const vd = node as VarDeclaration;
    if (!positionInRange({ line, character }, vd.nameRange)) return null;
    return { start: vd.nameRange.start, end: vd.nameRange.end };
  }

  return null;
}
