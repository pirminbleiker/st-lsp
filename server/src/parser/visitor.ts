/**
 * AST Visitor pattern for IEC 61131-3 Structured Text.
 *
 * Provides `forEachChild` as the single source of truth for AST tree
 * structure, plus `walkAst`, `AstVisitor`, `BaseAstVisitor`, and
 * `findNodeAtPosition` built on top.
 *
 * Eliminates duplicated switch-on-kind traversal across handler files.
 */

import {
  ActionDeclaration,
  AstNode,
  FunctionBlockDeclaration,
  FunctionDeclaration,
  GvlDeclaration,
  InterfaceDeclaration,
  MethodDeclaration,
  Position,
  ProgramDeclaration,
  PropertyDeclaration,
  SourceFile,
} from './ast';
import { positionContains } from './astUtils';

// ---------------------------------------------------------------------------
// forEachChild — single source of truth for AST child structure
// ---------------------------------------------------------------------------

/**
 * Calls `cb` for each direct child AstNode of `node`.
 *
 * This is the canonical definition of the AST's tree structure. All
 * traversal utilities (walkAst, findNodeAtPosition, etc.) delegate to
 * this function, so adding a new node kind only requires updating one
 * switch statement.
 */
export function forEachChild(node: AstNode, cb: (child: AstNode) => void): void {
  switch (node.kind) {
    // Top-level
    case 'SourceFile': {
      const n = node as SourceFile;
      for (const d of n.declarations) cb(d);
      break;
    }

    case 'ProgramDeclaration': {
      const n = node as ProgramDeclaration;
      for (const p of n.pragmas) cb(p);
      for (const vb of n.varBlocks) cb(vb);
      for (const s of n.body) cb(s);
      break;
    }

    case 'FunctionBlockDeclaration': {
      const n = node as FunctionBlockDeclaration;
      for (const p of n.pragmas) cb(p);
      for (const vb of n.varBlocks) cb(vb);
      for (const s of n.body) cb(s);
      for (const m of n.methods) cb(m);
      for (const prop of n.properties) cb(prop);
      for (const a of n.actions) cb(a);
      break;
    }

    case 'FunctionDeclaration': {
      const n = node as FunctionDeclaration;
      for (const p of n.pragmas) cb(p);
      if (n.returnType) cb(n.returnType);
      for (const vb of n.varBlocks) cb(vb);
      for (const s of n.body) cb(s);
      break;
    }

    case 'GvlDeclaration': {
      const n = node as GvlDeclaration;
      for (const vb of n.varBlocks) cb(vb);
      break;
    }

    case 'InterfaceDeclaration': {
      const n = node as InterfaceDeclaration;
      for (const m of n.methods) cb(m);
      for (const p of n.properties) cb(p);
      break;
    }

    // Members
    case 'MethodDeclaration': {
      const n = node as MethodDeclaration;
      if (n.returnType) cb(n.returnType);
      for (const vb of n.varBlocks) cb(vb);
      for (const s of n.body) cb(s);
      break;
    }

    case 'ActionDeclaration': {
      const n = node as ActionDeclaration;
      for (const s of n.body) cb(s);
      break;
    }

    case 'PropertyDeclaration': {
      const n = node as PropertyDeclaration;
      cb(n.type);
      if (n.getAccessor) {
        for (const vb of n.getAccessor.varBlocks) cb(vb);
        for (const s of n.getAccessor.body) cb(s);
      }
      if (n.setAccessor) {
        for (const vb of n.setAccessor.varBlocks) cb(vb);
        for (const s of n.setAccessor.body) cb(s);
      }
      break;
    }

    // Type declarations
    case 'TypeDeclarationBlock': {
      const n = node as import('./ast').TypeDeclarationBlock;
      for (const td of n.declarations) cb(td);
      break;
    }

    case 'StructDeclaration': {
      const n = node as import('./ast').StructDeclaration;
      for (const f of n.fields) cb(f);
      break;
    }

    case 'EnumDeclaration': {
      const n = node as import('./ast').EnumDeclaration;
      for (const v of n.values) {
        if (v.value) cb(v.value);
      }
      break;
    }

    case 'AliasDeclaration': {
      const n = node as import('./ast').AliasDeclaration;
      cb(n.type);
      break;
    }

    case 'UnionDeclaration': {
      const n = node as import('./ast').UnionDeclaration;
      for (const f of n.fields) cb(f);
      break;
    }

    // Variables
    case 'VarBlock': {
      const n = node as import('./ast').VarBlock;
      for (const d of n.declarations) cb(d);
      break;
    }

    case 'VarDeclaration': {
      const n = node as import('./ast').VarDeclaration;
      for (const p of n.pragmas) cb(p);
      cb(n.type);
      if (n.initArgs) {
        for (const arg of n.initArgs) cb(arg.value);
      }
      if (n.initialValue) cb(n.initialValue);
      break;
    }

    // Statements
    case 'AssignmentStatement': {
      const n = node as import('./ast').AssignmentStatement;
      cb(n.left);
      cb(n.right);
      break;
    }

    case 'CallStatement': {
      const n = node as import('./ast').CallStatement;
      cb(n.callee);
      for (const arg of n.args) cb(arg.value);
      break;
    }

    case 'IfStatement': {
      const n = node as import('./ast').IfStatement;
      cb(n.condition);
      for (const s of n.then) cb(s);
      for (const elsif of n.elsifs) {
        cb(elsif.condition);
        for (const s of elsif.body) cb(s);
      }
      if (n.else) for (const s of n.else) cb(s);
      break;
    }

    case 'ForStatement': {
      const n = node as import('./ast').ForStatement;
      cb(n.from);
      cb(n.to);
      if (n.by) cb(n.by);
      for (const s of n.body) cb(s);
      break;
    }

    case 'WhileStatement': {
      const n = node as import('./ast').WhileStatement;
      cb(n.condition);
      for (const s of n.body) cb(s);
      break;
    }

    case 'RepeatStatement': {
      const n = node as import('./ast').RepeatStatement;
      for (const s of n.body) cb(s);
      cb(n.condition);
      break;
    }

    case 'CaseStatement': {
      const n = node as import('./ast').CaseStatement;
      cb(n.expression);
      for (const clause of n.cases) {
        for (const val of clause.values) {
          if (val.kind === 'single') cb(val.value);
          else { cb(val.low); cb(val.high); }
        }
        for (const s of clause.body) cb(s);
      }
      if (n.else) for (const s of n.else) cb(s);
      break;
    }

    // Expressions
    case 'BinaryExpression': {
      const n = node as import('./ast').BinaryExpression;
      cb(n.left);
      cb(n.right);
      break;
    }

    case 'UnaryExpression': {
      const n = node as import('./ast').UnaryExpression;
      cb(n.operand);
      break;
    }

    case 'SubscriptExpression': {
      const n = node as import('./ast').SubscriptExpression;
      cb(n.base);
      for (const idx of n.indices) cb(idx);
      break;
    }

    case 'MemberExpression': {
      const n = node as import('./ast').MemberExpression;
      cb(n.base);
      break;
    }

    case 'CallExpression': {
      const n = node as import('./ast').CallExpression;
      cb(n.callee);
      for (const arg of n.args) cb(arg.value);
      break;
    }

    case 'ArrayLiteral': {
      const n = node as import('./ast').ArrayLiteral;
      for (const elem of n.elements) cb(elem);
      break;
    }

    case 'StructInitializer': {
      const n = node as import('./ast').StructInitializer;
      for (const f of n.fields) cb(f.value);
      break;
    }

    // Leaf nodes — no children
    case 'TypeRef':
    case 'NameExpression':
    case 'IntegerLiteral':
    case 'RealLiteral':
    case 'StringLiteral':
    case 'BoolLiteral':
    case 'ReturnStatement':
    case 'ExitStatement':
    case 'ContinueStatement':
    case 'EmptyStatement':
    case 'Pragma':
      break;
  }
}

// ---------------------------------------------------------------------------
// AstVisitor interface and walkAst
// ---------------------------------------------------------------------------

/**
 * Visitor callbacks for AST traversal.
 *
 * `enter` is called before visiting children. Return `false` to skip
 * children for that node. `leave` is called after children are visited.
 */
export interface AstVisitor {
  enter?(node: AstNode): boolean | void;
  leave?(node: AstNode): void;
}

/**
 * Walk the AST depth-first, calling visitor.enter before and
 * visitor.leave after visiting each node's children.
 *
 * If `enter` returns `false`, the node's children are skipped.
 */
export function walkAst(root: AstNode, visitor: AstVisitor): void {
  const cont = visitor.enter?.(root);
  if (cont !== false) {
    forEachChild(root, child => walkAst(child, visitor));
  }
  visitor.leave?.(root);
}

// ---------------------------------------------------------------------------
// BaseAstVisitor — abstract class for subclassing
// ---------------------------------------------------------------------------

/**
 * Abstract base class for AST visitors.
 *
 * Override `enter` and/or `leave` to act on nodes. Call
 * `this.visitChildren(node)` for manual child traversal when not using
 * the automatic `walk()` method.
 */
export abstract class BaseAstVisitor implements AstVisitor {
  /** Walk the tree rooted at `root`, calling enter/leave on each node. */
  walk(root: AstNode): void {
    walkAst(root, this);
  }

  enter?(node: AstNode): boolean | void;
  leave?(node: AstNode): void;

  /** Visit all direct children of `node`. */
  protected visitChildren(node: AstNode): void {
    forEachChild(node, child => {
      const cont = this.enter?.(child);
      if (cont !== false) {
        this.visitChildren(child);
      }
      this.leave?.(child);
    });
  }
}

// ---------------------------------------------------------------------------
// findNodeAtPosition — NodeFinder visitor
// ---------------------------------------------------------------------------

/**
 * Walk the AST and return the deepest node whose range contains `pos`.
 * Returns `null` if no node covers the position.
 *
 * Uses `forEachChild` for traversal, keeping the tree structure in one place.
 */
export function findNodeAtPosition(ast: SourceFile, line: number, character: number): AstNode | null {
  const pos: Position = { line, character };
  let deepest: AstNode | null = null;

  function visit(node: AstNode): void {
    if (!positionContains(node.range.start, node.range.end, pos)) return;
    deepest = node;
    forEachChild(node, visit);
  }

  visit(ast);
  return deepest;
}
