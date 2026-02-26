import * as fs from 'fs';
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
  TypeDeclarationBlock,
  StructDeclaration,
  EnumDeclaration,
  UnionDeclaration,
} from '../parser/ast';
import { BUILTIN_TYPES } from '../twincat/types';
import { STANDARD_FBS } from '../twincat/stdlib';
import { WorkspaceIndex } from '../twincat/workspaceIndex';
import { extractStFromTwinCAT } from '../twincat/tcExtractor';

const KEYWORDS = [
  'IF', 'THEN', 'ELSE', 'ELSIF', 'END_IF',
  'FOR', 'TO', 'BY', 'DO', 'END_FOR',
  'WHILE', 'END_WHILE',
  'REPEAT', 'UNTIL', 'END_REPEAT',
  'CASE', 'OF', 'END_CASE',
  'PROGRAM', 'END_PROGRAM',
  'FUNCTION_BLOCK', 'END_FUNCTION_BLOCK',
  'FUNCTION', 'END_FUNCTION',
  'METHOD', 'END_METHOD',
  'PROPERTY', 'END_PROPERTY',
  'INTERFACE', 'END_INTERFACE',
  'VAR', 'VAR_INPUT', 'VAR_OUTPUT', 'VAR_IN_OUT', 'VAR_GLOBAL', 'VAR_TEMP', 'VAR_STAT', 'VAR_EXTERNAL', 'VAR_CONFIG', 'END_VAR',
  'TYPE', 'END_TYPE',
  'STRUCT', 'END_STRUCT',
  'ENUM', 'END_ENUM',
  'ARRAY', 'POINTER', 'REFERENCE', 'OF',
  'EXTENDS', 'IMPLEMENTS',
  'ABSTRACT', 'OVERRIDE', 'FINAL',
  'PUBLIC', 'PRIVATE', 'PROTECTED', 'INTERNAL',
  'SUPER',
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
  workspaceIndex?: WorkspaceIndex,
): CompletionItem[] {
  if (!document) return [];

  const text = document.getText();
  const extraction = extractStFromTwinCAT(document.uri, text);
  const { ast } = parse(extraction.stCode);
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

  // 6. Struct and enum type names from TYPE...END_TYPE blocks
  for (const decl of ast.declarations) {
    if (decl.kind === 'TypeDeclarationBlock') {
      const typeBlock = decl as TypeDeclarationBlock;
      for (const typeDecl of typeBlock.declarations) {
        if (typeDecl.kind === 'StructDeclaration') {
          const structDecl = typeDecl as StructDeclaration;
          items.push({
            label: structDecl.name,
            kind: CompletionItemKind.Struct,
            detail: 'STRUCT',
          });
        } else if (typeDecl.kind === 'EnumDeclaration') {
          const enumDecl = typeDecl as EnumDeclaration;
          items.push({
            label: enumDecl.name,
            kind: CompletionItemKind.Enum,
            detail: 'ENUM',
          });
          // Also add enum member values
          for (const enumVal of enumDecl.values) {
            items.push({
              label: `${enumDecl.name}.${enumVal.name}`,
              kind: CompletionItemKind.EnumMember,
              detail: `${enumDecl.name} enum member`,
            });
          }
        } else if (typeDecl.kind === 'AliasDeclaration') {
          items.push({
            label: typeDecl.name,
            kind: CompletionItemKind.TypeParameter,
            detail: `Alias for ${typeDecl.type.name}`,
          });
        } else if (typeDecl.kind === 'UnionDeclaration') {
          const unionDecl = typeDecl as UnionDeclaration;
          items.push({
            label: unionDecl.name,
            kind: CompletionItemKind.Struct,
            detail: 'UNION',
          });
        }
      }
    }
  }

  // 7. POUs and types from workspace index (other files)
  if (workspaceIndex) {
    // Build a set of labels already added from the current file to avoid duplicates
    const existingLabels = new Set(items.map(i => i.label));

    const currentUri = params.textDocument.uri;
    const projectFiles = workspaceIndex.getProjectFiles();

    for (const fileUri of projectFiles) {
      // Skip the current document (already covered by sections 4–6 above)
      if (fileUri === currentUri) continue;

      let fileText: string;
      try {
        const filePath = fileUri.startsWith('file://')
          ? decodeURIComponent(fileUri.replace(/^file:\/\//, ''))
          : fileUri;
        const rawText = fs.readFileSync(filePath, 'utf8');
        fileText = extractStFromTwinCAT(filePath, rawText).stCode;
      } catch {
        continue;
      }

      const { ast: otherAst } = parse(fileText);

      for (const decl of otherAst.declarations) {
        if (
          decl.kind === 'ProgramDeclaration' ||
          decl.kind === 'FunctionBlockDeclaration' ||
          decl.kind === 'FunctionDeclaration'
        ) {
          const pou = decl as ProgramDeclaration | FunctionBlockDeclaration | FunctionDeclaration;
          if (!existingLabels.has(pou.name)) {
            existingLabels.add(pou.name);
            items.push({
              label: pou.name,
              kind: decl.kind === 'FunctionDeclaration'
                ? CompletionItemKind.Function
                : CompletionItemKind.Class,
              detail: `(from ${fileUri})`,
            });
          }
        } else if (decl.kind === 'TypeDeclarationBlock') {
          const typeBlock = decl as TypeDeclarationBlock;
          for (const typeDecl of typeBlock.declarations) {
            if (typeDecl.kind === 'StructDeclaration') {
              const structDecl = typeDecl as StructDeclaration;
              if (!existingLabels.has(structDecl.name)) {
                existingLabels.add(structDecl.name);
                items.push({
                  label: structDecl.name,
                  kind: CompletionItemKind.Struct,
                  detail: 'STRUCT',
                });
              }
            } else if (typeDecl.kind === 'EnumDeclaration') {
              const enumDecl = typeDecl as EnumDeclaration;
              if (!existingLabels.has(enumDecl.name)) {
                existingLabels.add(enumDecl.name);
                items.push({
                  label: enumDecl.name,
                  kind: CompletionItemKind.Enum,
                  detail: 'ENUM',
                });
                for (const enumVal of enumDecl.values) {
                  const memberLabel = `${enumDecl.name}.${enumVal.name}`;
                  if (!existingLabels.has(memberLabel)) {
                    existingLabels.add(memberLabel);
                    items.push({
                      label: memberLabel,
                      kind: CompletionItemKind.EnumMember,
                      detail: `${enumDecl.name} enum member`,
                    });
                  }
                }
              }
            } else if (typeDecl.kind === 'AliasDeclaration') {
              if (!existingLabels.has(typeDecl.name)) {
                existingLabels.add(typeDecl.name);
                items.push({
                  label: typeDecl.name,
                  kind: CompletionItemKind.TypeParameter,
                  detail: `Alias for ${typeDecl.type.name}`,
                });
              }
            } else if (typeDecl.kind === 'UnionDeclaration') {
              const unionDecl = typeDecl as UnionDeclaration;
              if (!existingLabels.has(unionDecl.name)) {
                existingLabels.add(unionDecl.name);
                items.push({
                  label: unionDecl.name,
                  kind: CompletionItemKind.Struct,
                  detail: 'UNION',
                });
              }
            }
          }
        }
      }
    }
  }

  return items;
}
