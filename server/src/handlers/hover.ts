/**
 * Hover documentation handler for IEC 61131-3 Structured Text.
 *
 * Given a cursor position, parses the document, finds the identifier under the
 * cursor, and returns Markdown hover documentation for:
 *   - Built-in types (BOOL, INT, REAL, …)
 *   - Standard function blocks (TON, CTU, R_TRIG, …)
 *   - Variable declarations visible in scope
 *   - POU (PROGRAM / FUNCTION_BLOCK / FUNCTION) declarations
 *   - TwinCAT pragma attributes ({attribute '...'})
 */

import { Hover, MarkupKind, TextDocumentPositionParams } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import {
  AstNode,
  EnumDeclaration,
  FunctionBlockDeclaration,
  FunctionDeclaration,
  NameExpression,
  Position,
  Pragma,
  ProgramDeclaration,
  SourceFile,
  StructDeclaration,
  TopLevelDeclaration,
  TypeDeclarationBlock,
  VarDeclaration,
  VarKind,
} from '../parser/ast';
import { parse } from '../parser/parser';
import { builtinTypeHover, findBuiltinType } from '../twincat/types';
import { findStandardFB, standardFBHover } from '../twincat/stdlib';
import { extractStFromTwinCAT } from '../twincat/tcExtractor';
import { findPragmaDoc, pragmaHover } from '../twincat/pragmas';
import { WorkspaceIndex } from '../twincat/workspaceIndex';

// ---------------------------------------------------------------------------
// Position helpers
// ---------------------------------------------------------------------------

function positionContains(nodeStart: Position, nodeEnd: Position, pos: Position): boolean {
  if (pos.line < nodeStart.line || pos.line > nodeEnd.line) return false;
  if (pos.line === nodeStart.line && pos.character < nodeStart.character) return false;
  if (pos.line === nodeEnd.line && pos.character > nodeEnd.character) return false;
  return true;
}

// ---------------------------------------------------------------------------
// AST traversal — find deepest node at cursor position
// ---------------------------------------------------------------------------

/**
 * Walk the AST and return the deepest node whose range contains `pos`.
 * Returns `null` if no node covers the position.
 */
export function findNodeAtPosition(ast: SourceFile, line: number, character: number): AstNode | null {
  const pos: Position = { line, character };

  function visit(node: AstNode): AstNode | null {
    if (!positionContains(node.range.start, node.range.end, pos)) return null;

    let deepest: AstNode = node;

    switch (node.kind) {
      case 'SourceFile': {
        const sf = node as SourceFile;
        for (const decl of sf.declarations) {
          const child = visit(decl);
          if (child) deepest = child;
        }
        break;
      }

      case 'ProgramDeclaration':
      case 'FunctionBlockDeclaration': {
        const pou = node as ProgramDeclaration | FunctionBlockDeclaration;
        for (const p of pou.pragmas) {
          const child = visit(p); if (child) deepest = child;
        }
        for (const vb of pou.varBlocks) {
          const child = visit(vb);
          if (child) deepest = child;
        }
        for (const stmt of pou.body) {
          const child = visit(stmt);
          if (child) deepest = child;
        }
        break;
      }

      case 'FunctionDeclaration': {
        const fn = node as FunctionDeclaration;
        for (const p of fn.pragmas) {
          const child = visit(p); if (child) deepest = child;
        }
        for (const vb of fn.varBlocks) {
          const child = visit(vb);
          if (child) deepest = child;
        }
        for (const stmt of fn.body) {
          const child = visit(stmt);
          if (child) deepest = child;
        }
        break;
      }

      case 'VarBlock': {
        const vb = node as import('../parser/ast').VarBlock;
        for (const decl of vb.declarations) {
          const child = visit(decl);
          if (child) deepest = child;
        }
        break;
      }

      case 'VarDeclaration': {
        const vd = node as VarDeclaration;
        for (const p of vd.pragmas) {
          const child = visit(p); if (child) deepest = child;
        }
        const typeChild = visit(vd.type);
        if (typeChild) deepest = typeChild;
        if (vd.initialValue) {
          const exprChild = visit(vd.initialValue);
          if (exprChild) deepest = exprChild;
        }
        break;
      }

      case 'TypeDeclarationBlock': {
        const tb = node as import('../parser/ast').TypeDeclarationBlock;
        for (const typeDecl of tb.declarations) {
          const child = visit(typeDecl); if (child) deepest = child;
        }
        break;
      }

      case 'StructDeclaration': {
        const sd = node as import('../parser/ast').StructDeclaration;
        for (const field of sd.fields) {
          const child = visit(field); if (child) deepest = child;
        }
        break;
      }

      // Statements
      case 'AssignmentStatement': {
        const s = node as import('../parser/ast').AssignmentStatement;
        const l = visit(s.left); if (l) deepest = l;
        const r = visit(s.right); if (r) deepest = r;
        break;
      }
      case 'CallStatement': {
        const s = node as import('../parser/ast').CallStatement;
        const c = visit(s.callee); if (c) deepest = c;
        for (const arg of s.args) { const a = visit(arg.value); if (a) deepest = a; }
        break;
      }
      case 'IfStatement': {
        const s = node as import('../parser/ast').IfStatement;
        const cond = visit(s.condition); if (cond) deepest = cond;
        for (const stmt of s.then) { const t = visit(stmt); if (t) deepest = t; }
        for (const elsif of s.elsifs) {
          const ec = visit(elsif.condition); if (ec) deepest = ec;
          for (const stmt of elsif.body) { const t = visit(stmt); if (t) deepest = t; }
        }
        if (s.else) for (const stmt of s.else) { const t = visit(stmt); if (t) deepest = t; }
        break;
      }
      case 'ForStatement': {
        const s = node as import('../parser/ast').ForStatement;
        const f = visit(s.from); if (f) deepest = f;
        const t = visit(s.to); if (t) deepest = t;
        if (s.by) { const b = visit(s.by); if (b) deepest = b; }
        for (const stmt of s.body) { const c = visit(stmt); if (c) deepest = c; }
        break;
      }
      case 'WhileStatement': {
        const s = node as import('../parser/ast').WhileStatement;
        const cond = visit(s.condition); if (cond) deepest = cond;
        for (const stmt of s.body) { const c = visit(stmt); if (c) deepest = c; }
        break;
      }
      case 'RepeatStatement': {
        const s = node as import('../parser/ast').RepeatStatement;
        for (const stmt of s.body) { const c = visit(stmt); if (c) deepest = c; }
        const cond = visit(s.condition); if (cond) deepest = cond;
        break;
      }
      case 'CaseStatement': {
        const s = node as import('../parser/ast').CaseStatement;
        const expr = visit(s.expression); if (expr) deepest = expr;
        for (const clause of s.cases) {
          for (const val of clause.values) {
            if (val.kind === 'single') { const v = visit(val.value); if (v) deepest = v; }
            else { const l = visit(val.low); if (l) deepest = l; const h = visit(val.high); if (h) deepest = h; }
          }
          for (const stmt of clause.body) { const c = visit(stmt); if (c) deepest = c; }
        }
        if (s.else) for (const stmt of s.else) { const c = visit(stmt); if (c) deepest = c; }
        break;
      }

      // Expressions
      case 'BinaryExpression': {
        const e = node as import('../parser/ast').BinaryExpression;
        const l = visit(e.left); if (l) deepest = l;
        const r = visit(e.right); if (r) deepest = r;
        break;
      }
      case 'UnaryExpression': {
        const e = node as import('../parser/ast').UnaryExpression;
        const o = visit(e.operand); if (o) deepest = o;
        break;
      }
      case 'SubscriptExpression': {
        const e = node as import('../parser/ast').SubscriptExpression;
        const b = visit(e.base); if (b) deepest = b;
        const i = visit(e.index); if (i) deepest = i;
        break;
      }
      case 'MemberExpression': {
        const e = node as import('../parser/ast').MemberExpression;
        const b = visit(e.base); if (b) deepest = b;
        break;
      }
      case 'CallExpression': {
        const e = node as import('../parser/ast').CallExpression;
        const c = visit(e.callee); if (c) deepest = c;
        for (const arg of e.args) { const a = visit(arg.value); if (a) deepest = a; }
        break;
      }
    }

    return deepest;
  }

  return visit(ast);
}

// ---------------------------------------------------------------------------
// Scope resolution — collect VarDeclarations visible at a given node
// ---------------------------------------------------------------------------

/**
 * Collect all VarDeclaration nodes from the enclosing POU's var blocks,
 * together with the VarKind of the block they belong to.
 * We walk top-level declarations to find the POU that contains `pos`.
 */
function collectVarDeclarations(
  ast: SourceFile,
  pos: Position,
): Array<{ vd: VarDeclaration; varKind: VarKind }> {
  for (const decl of ast.declarations) {
    if (!positionContains(decl.range.start, decl.range.end, pos)) continue;
    if (
      decl.kind !== 'ProgramDeclaration' &&
      decl.kind !== 'FunctionBlockDeclaration' &&
      decl.kind !== 'FunctionDeclaration'
    ) continue;
    const vars: Array<{ vd: VarDeclaration; varKind: VarKind }> = [];
    const pou = decl as ProgramDeclaration | FunctionBlockDeclaration | FunctionDeclaration;
    for (const vb of pou.varBlocks) {
      for (const vd of vb.declarations) {
        vars.push({ vd, varKind: vb.varKind });
      }
    }
    return vars;
  }
  return [];
}

// ---------------------------------------------------------------------------
// Hover markdown builders
// ---------------------------------------------------------------------------

function varDeclHover(vd: VarDeclaration, varKind: VarKind): string {
  const typeRef = vd.type;
  let typeName = typeRef.name;
  if (typeRef.isPointer) typeName = `POINTER TO ${typeName}`;
  else if (typeRef.isReference) typeName = `REFERENCE TO ${typeName}`;
  else if (typeRef.isArray && typeRef.arrayDims) {
    const dims = typeRef.arrayDims.map(d => `${d.low}..${d.high}`).join(', ');
    typeName = `ARRAY[${dims}] OF ${typeName}`;
  }
  let result = `\`${vd.name} : ${typeName}\``;

  result += `\n\n*Block:* \`${varKind}\``;

  // Show value range for simple (non-compound) builtin types
  if (!typeRef.isPointer && !typeRef.isReference && !typeRef.isArray) {
    const builtinType = findBuiltinType(typeRef.name);
    if (builtinType) {
      result += `  \n*Range:* ${builtinType.range}`;
    }
  }

  if (vd.pragmas.length > 0) {
    const pragmaSummary = vd.pragmas.map(p => p.raw).join(' ');
    result += `\n\n*Pragmas:* \`${pragmaSummary}\``;
  }
  return result;
}

function pouHover(decl: TopLevelDeclaration): string {
  switch (decl.kind) {
    case 'ProgramDeclaration':
      return `**PROGRAM** \`${decl.name}\``;
    case 'FunctionBlockDeclaration':
      return `**FUNCTION_BLOCK** \`${decl.name}\``;
    case 'FunctionDeclaration': {
      const retType = decl.returnType ? ` : ${decl.returnType.name}` : '';
      return `**FUNCTION** \`${decl.name}${retType}\``;
    }
    case 'InterfaceDeclaration':
      return `**INTERFACE** \`${decl.name}\``;
    default:
      return '';
  }
}

function structHover(decl: StructDeclaration): string {
  const fields = decl.fields.map(f => {
    let typeName = f.type.name;
    if (f.type.isPointer) typeName = `POINTER TO ${typeName}`;
    else if (f.type.isReference) typeName = `REFERENCE TO ${typeName}`;
    else if (f.type.isArray && f.type.arrayDims) {
      const dims = f.type.arrayDims.map(d => `${d.low}..${d.high}`).join(', ');
      typeName = `ARRAY[${dims}] OF ${typeName}`;
    }
    return `  ${f.name} : ${typeName};`;
  }).join('\n');
  return `**STRUCT** \`${decl.name}\`\n\`\`\`\nSTRUCT\n${fields}\nEND_STRUCT\n\`\`\``;
}

function enumHover(decl: EnumDeclaration): string {
  const values = decl.values.map(v => `  ${v.name}`).join('\n');
  return `**ENUM** \`${decl.name}\`\n\`\`\`\n(\n${values}\n)\n\`\`\``;
}

// ---------------------------------------------------------------------------
// Main hover handler
// ---------------------------------------------------------------------------

export function handleHover(
  params: TextDocumentPositionParams,
  document: TextDocument | undefined,
  workspaceIndex?: WorkspaceIndex,
): Hover | null {
  if (!document) return null;

  const text = document.getText();
  const extraction = extractStFromTwinCAT(document.uri, text);
  const { ast } = parse(extraction.stCode);

  const { line, character } = params.position;
  const node = findNodeAtPosition(ast, line, character);
  if (!node) return null;

  // We handle Pragma nodes and NameExpression nodes
  if (node.kind === 'Pragma') {
    const pragma = node as Pragma;
    const doc = findPragmaDoc(pragma.name);
    const value = doc ? pragmaHover(doc) : `**\`${pragma.raw}\`**`;
    return {
      contents: { kind: MarkupKind.Markdown, value },
      range: { start: node.range.start, end: node.range.end },
    };
  }

  // We only produce hover for NameExpression nodes (identifiers)
  if (node.kind !== 'NameExpression') return null;
  const name = (node as NameExpression).name;
  if (!name) return null;

  // 1. Built-in type?
  const builtinType = findBuiltinType(name);
  if (builtinType) {
    return {
      contents: { kind: MarkupKind.Markdown, value: builtinTypeHover(builtinType) },
      range: { start: node.range.start, end: node.range.end },
    };
  }

  // 2. Standard function block?
  const stdFB = findStandardFB(name);
  if (stdFB) {
    let hoverText = standardFBHover(stdFB);
    // Prepend library namespace to the title line
    if (stdFB.namespace) {
      hoverText = `*(${stdFB.namespace})*\n\n` + hoverText;
    }
    // Warn if the library is not referenced by the document's project
    if (workspaceIndex) {
      const libRefs = workspaceIndex.getLibraryRefs(params.textDocument.uri);
      if (libRefs.length > 0 && stdFB.namespace) {
        const referenced = libRefs.some(
          (r) => r.name.toUpperCase() === stdFB.namespace.toUpperCase(),
        );
        if (!referenced) {
          hoverText += `\n\n> ⚠️ Library \`${stdFB.namespace}\` is not referenced in this project.`;
        }
      }
    }
    return {
      contents: { kind: MarkupKind.Markdown, value: hoverText },
      range: { start: node.range.start, end: node.range.end },
    };
  }

  // 3. VarDeclaration in scope?
  const vars = collectVarDeclarations(ast, { line, character });
  const varMatch = vars.find(v => v.vd.name.toUpperCase() === name.toUpperCase());
  if (varMatch) {
    return {
      contents: { kind: MarkupKind.Markdown, value: varDeclHover(varMatch.vd, varMatch.varKind) },
      range: { start: node.range.start, end: node.range.end },
    };
  }

  // 4. POU declaration?
  const pouDecl = ast.declarations.find(
    d => 'name' in d && (d as { name: string }).name.toUpperCase() === name.toUpperCase(),
  );
  if (pouDecl) {
    return {
      contents: { kind: MarkupKind.Markdown, value: pouHover(pouDecl) },
      range: { start: node.range.start, end: node.range.end },
    };
  }

  // 4a. Action declaration inside a FUNCTION_BLOCK?
  const nameUpper = name.toUpperCase();
  for (const decl of ast.declarations) {
    if (decl.kind !== 'FunctionBlockDeclaration') continue;
    const fb = decl as import('../parser/ast').FunctionBlockDeclaration;
    const action = fb.actions.find(a => a.name.toUpperCase() === nameUpper);
    if (action) {
      return {
        contents: {
          kind: MarkupKind.Markdown,
          value: `**ACTION** \`${action.name}\` *(in ${fb.name})*`,
        },
        range: { start: node.range.start, end: node.range.end },
      };
    }
  }

  // 5. Struct or enum declaration inside TYPE...END_TYPE blocks?
  for (const decl of ast.declarations) {
    if (decl.kind !== 'TypeDeclarationBlock') continue;
    const typeBlock = decl as TypeDeclarationBlock;
    for (const typeDecl of typeBlock.declarations) {
      if (typeDecl.name.toUpperCase() !== name.toUpperCase()) continue;
      if (typeDecl.kind === 'StructDeclaration') {
        return {
          contents: { kind: MarkupKind.Markdown, value: structHover(typeDecl as StructDeclaration) },
          range: { start: node.range.start, end: node.range.end },
        };
      }
      if (typeDecl.kind === 'EnumDeclaration') {
        return {
          contents: { kind: MarkupKind.Markdown, value: enumHover(typeDecl as EnumDeclaration) },
          range: { start: node.range.start, end: node.range.end },
        };
      }
    }
  }

  return null;
}
