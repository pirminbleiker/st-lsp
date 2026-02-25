import {
  CompletionItem,
  CompletionItemKind,
  TextDocumentPositionParams,
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { parse } from '../parser/parser';
import {
  ProgramDeclaration,
  FunctionBlockDeclaration,
  FunctionDeclaration,
  VarDeclaration,
  Position,
  TopLevelDeclaration,
} from '../parser/ast';
import { BUILTIN_TYPES } from '../twincat/types';
import { STANDARD_FBS } from '../twincat/stdlib';

const KEYWORDS = [
  'IF', 'THEN', 'ELSE', 'ELSIF', 'END_IF',
  'FOR', 'TO', 'BY', 'DO', 'END_FOR',
  'WHILE', 'END_WHILE',
  'REPEAT', 'UNTIL', 'END_REPEAT',
  'CASE', 'OF', 'END_CASE',
  'PROGRAM', 'FUNCTION_BLOCK', 'FUNCTION', 'METHOD', 'PROPERTY', 'INTERFACE',
  'VAR', 'VAR_INPUT', 'VAR_OUTPUT', 'VAR_IN_OUT', 'VAR_GLOBAL', 'VAR_TEMP', 'VAR_STAT', 'VAR_EXTERNAL', 'VAR_CONFIG', 'END_VAR',
  'TYPE', 'STRUCT', 'END_STRUCT', 'ENUM', 'END_ENUM',
  'ARRAY', 'POINTER', 'REFERENCE', 'OF', 'EXTENDS', 'IMPLEMENTS',
  'RETURN', 'EXIT', 'CONTINUE',
  'TRUE', 'FALSE', 'NULL',
  'AND', 'OR', 'XOR', 'NOT',
  'MOD', 'ABS', 'TRUNC',
];

/**
 * Position helper: check if pos is within [start, end]
 */
function positionContains(nodeStart: Position, nodeEnd: Position, pos: Position): boolean {
  if (pos.line < nodeStart.line || pos.line > nodeEnd.line) return false;
  if (pos.line === nodeStart.line && pos.character < nodeStart.character) return false;
  if (pos.line === nodeEnd.line && pos.character > nodeEnd.character) return false;
  return true;
}

/**
 * Collect all VarDeclaration nodes from the enclosing POU's var blocks.
 */
function collectVarDeclarations(
  declarations: TopLevelDeclaration[],
  pos: Position,
): VarDeclaration[] {
  for (const decl of declarations) {
    if (!positionContains(decl.range.start, decl.range.end, pos)) continue;
    
    // Check if it's a POU
    if (decl.kind === 'ProgramDeclaration' || 
        decl.kind === 'FunctionBlockDeclaration' || 
        decl.kind === 'FunctionDeclaration') {
      const vars: VarDeclaration[] = [];
      const pou = decl as ProgramDeclaration | FunctionBlockDeclaration | FunctionDeclaration;
      for (const vb of pou.varBlocks) {
        for (const vd of vb.declarations) {
          vars.push(vd);
        }
      }
      return vars;
    }
  }
  return [];
}

export function handleCompletion(
  params: TextDocumentPositionParams,
  document: TextDocument | undefined,
): CompletionItem[] {
  if (!document) return [];

  const text = document.getText();
  const { ast } = parse(text);
  const pos = params.position;

  const items: CompletionItem[] = [];

  // 1. ST Keywords
  for (const kw of KEYWORDS) {
    items.push({
      label: kw,
      kind: CompletionItemKind.Keyword,
    });
  }

  // 2. Built-in types
  for (const type of BUILTIN_TYPES) {
    items.push({
      label: type.name,
      kind: CompletionItemKind.TypeParameter,
      detail: type.description,
    });
  }

  // 3. Standard FBs
  for (const fb of STANDARD_FBS) {
    items.push({
      label: fb.name,
      kind: CompletionItemKind.Class,
      detail: fb.description,
    });
  }

  // 4. Variables in scope
  const vars = collectVarDeclarations(ast.declarations, pos);
  for (const vd of vars) {
    items.push({
      label: vd.name,
      kind: CompletionItemKind.Variable,
    });
  }

  // 5. POUs in the same file
  for (const decl of ast.declarations) {
    if (decl.kind === 'ProgramDeclaration' || 
        decl.kind === 'FunctionBlockDeclaration' || 
        decl.kind === 'FunctionDeclaration') {
      const pou = decl as ProgramDeclaration | FunctionBlockDeclaration | FunctionDeclaration;
      items.push({
        label: pou.name,
        kind: decl.kind === 'FunctionDeclaration' ? CompletionItemKind.Function : CompletionItemKind.Class,
      });
    }
  }

  return items;
}
