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
  GvlDeclaration,
  Position,
  SourceFile,
  TypeDeclarationBlock,
  StructDeclaration,
  EnumDeclaration,
  UnionDeclaration,
  InterfaceDeclaration,
  AliasDeclaration,
} from '../parser/ast';
import { BUILTIN_TYPES } from '../twincat/types';
import { STANDARD_FBS } from '../twincat/stdlib';
import { WorkspaceIndex } from '../twincat/workspaceIndex';
import { extractStFromTwinCAT } from '../twincat/tcExtractor';
import { formatConstantValue } from './utils';
import { getOrParse } from './shared';
import { positionContains } from '../parser/astUtils';
import {
  collectVarDeclarations,
  getEnclosingFbExtends,
  getIdentifierBeforeDotInLines,
  isSuperBeforeDotInLines,
  getLhsIdentifierForAssignmentInLines,
  getCaseSelectorIdentifierInLines,
} from './scopeAnalysis';
import {
  getSuperMembers,
  getDotAccessMembers,
  findEnumDeclaration,
  enumValuesToCompletionItems,
  buildLibrarySymbolDoc,
} from './memberResolution';

// Re-export for external consumers
export { isMemberVisible } from './memberResolution';

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
  'UNION', 'END_UNION',
  'ARRAY', 'OF',
  'TRUE', 'FALSE',
  'AND', 'OR', 'NOT', 'XOR', 'MOD',
  'RETURN', 'EXIT', 'CONTINUE',
  'AT', 'CONSTANT', 'RETAIN', 'PERSISTENT',
  'EXTENDS', 'IMPLEMENTS',
  'THIS', 'SUPER',
  'POINTER', 'REFERENCE', 'TO',
  'ABSTRACT', 'FINAL', 'OVERRIDE',
  'PUBLIC', 'PRIVATE', 'PROTECTED', 'INTERNAL',
];

export function handleCompletion(
  params: TextDocumentPositionParams,
  document: TextDocument | undefined,
  workspaceIndex?: WorkspaceIndex,
): CompletionItem[] {
  if (!document) return [];

  const text = document.getText();
  const { extraction, mapper, ast } = getOrParse(document!);
  const stCode = extraction.source;

  const { line, character } = params.position;
  // Convert cursor position to extracted-source coordinates.
  // If the cursor is on an XML-only line, fall back to raw position (for .st files the mapper
  // is a passthrough so this is always fine).
  const extractedPos = mapper.originalToExtracted(line, character) ?? { line, character };
  const pos: Position = { line: extractedPos.line, character: extractedPos.character };

  // Use extracted source lines for text-based analysis (not raw XML).
  const stLines = stCode.split('\n');
  const lineToInStCode = (origLine: number, origChar: number): { line: number; char: number } => {
    const ep = mapper.originalToExtracted(origLine, origChar);
    return ep ? { line: ep.line, char: ep.character } : { line: origLine, char: origChar };
  };
  const stCodeLine = lineToInStCode(line, character);

  // SUPER^. member completion: when inside a child FB and user types 'SUPER^.',
  // return the parent FB's inherited members.
  if (isSuperBeforeDotInLines(stLines, stCodeLine.line, stCodeLine.char)) {
    const parentName = getEnclosingFbExtends(ast.declarations, pos);
    if (parentName) {
      return getSuperMembers(
        parentName, ast.declarations, params.textDocument.uri, workspaceIndex, 10,
      );
    }
    return [];
  }

  // Dot-access member completion: when the user types '<ident>.', return only
  // the members of the resolved type rather than the flat keyword/type list.
  const identBeforeDot = getIdentifierBeforeDotInLines(stLines, stCodeLine.line, stCodeLine.char);
  if (identBeforeDot !== null) {
    // Special case: THIS (or THIS^ after caret-stripping) — return all members of the enclosing FB
    // plus inherited members from the EXTENDS chain.
    if (identBeforeDot.toUpperCase() === 'THIS') {
      for (const decl of ast.declarations) {
        if (decl.kind !== 'FunctionBlockDeclaration') continue;
        const fb = decl as FunctionBlockDeclaration;
        if (!positionContains(fb.range.start, fb.range.end, pos)) continue;
        const thisItems: CompletionItem[] = [];
        // Own members — 'this' context (all visible)
        for (const vb of fb.varBlocks) {
          for (const vd of vb.declarations) {
            thisItems.push({ label: vd.name, kind: CompletionItemKind.Variable, detail: vd.type.name });
          }
        }
        for (const method of fb.methods) {
          thisItems.push({ label: method.name, kind: CompletionItemKind.Method });
        }
        for (const prop of fb.properties) {
          thisItems.push({ label: prop.name, kind: CompletionItemKind.Property });
        }
        for (const action of fb.actions) {
          thisItems.push({ label: action.name, kind: CompletionItemKind.Method, detail: 'ACTION' });
        }
        // Inherited members via EXTENDS chain — 'super' context (PUBLIC+PROTECTED, not PRIVATE)
        if (fb.extendsRef) {
          const inheritedItems = getSuperMembers(
            fb.extendsRef.name, ast.declarations, params.textDocument.uri, workspaceIndex, 10,
          );
          for (const ii of inheritedItems) {
            if (!thisItems.some(i => i.label === ii.label)) thisItems.push(ii);
          }
        }
        return thisItems;
      }
      return [];
    }

    const vars = collectVarDeclarations(ast.declarations, pos);
    const members = getDotAccessMembers(
      identBeforeDot, vars.map(v => v.vd), ast.declarations, params.textDocument.uri, workspaceIndex,
    );
    return members ?? [];
  }

  // Enum-aware assignment completion: when cursor is on RHS of ':=', return
  // only the enum values if the LHS variable has an enum type.
  const lhsIdent = getLhsIdentifierForAssignmentInLines(stLines, stCodeLine.line, stCodeLine.char);
  if (lhsIdent !== null) {
    const vars = collectVarDeclarations(ast.declarations, pos);
    const vd = vars.find(v => v.vd.name.toUpperCase() === lhsIdent.toUpperCase());
    if (vd) {
      const enumDecl = findEnumDeclaration(
        vd.vd.type.name, ast.declarations, params.textDocument.uri, workspaceIndex,
      );
      if (enumDecl) return enumValuesToCompletionItems(enumDecl);
    }
  }

  // CASE selector enum completion: when cursor is inside a CASE...OF block where
  // the selector variable has an enum type, return only the relevant enum values.
  const caseSelectorIdent = getCaseSelectorIdentifierInLines(stLines, stCodeLine.line);
  if (caseSelectorIdent !== null) {
    const vars = collectVarDeclarations(ast.declarations, pos);
    const vd = vars.find(v => v.vd.name.toUpperCase() === caseSelectorIdent.toUpperCase());
    if (vd) {
      const enumDecl = findEnumDeclaration(
        vd.vd.type.name, ast.declarations, params.textDocument.uri, workspaceIndex,
      );
      if (enumDecl) return enumValuesToCompletionItems(enumDecl);
    }
  }

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

  // 3. Library symbols — from the workspace index (dynamic extraction from
  //    .library / .compiled-library* files).  Falls back to STANDARD_FBS for
  //    standalone files that are not part of any TwinCAT project.
  const libSymbols = workspaceIndex?.getLibrarySymbols(params.textDocument.uri) ?? [];
  const fbsToOffer = libSymbols.filter(s =>
    s.kind === 'functionBlock' || s.kind === 'function' || s.kind === 'interface'
  );
  if (fbsToOffer.length > 0) {
    for (const symbol of fbsToOffer) {
      items.push({
        label: symbol.name,
        kind: symbol.kind === 'function' ? CompletionItemKind.Function : CompletionItemKind.Class,
        detail: `(${symbol.namespace}) ${symbol.kind}`,
        documentation: buildLibrarySymbolDoc(symbol),
      });
    }
  } else {
    // Fallback: standalone file outside a project — use hardcoded stdlib
    for (const fb of STANDARD_FBS) {
      items.push({
        label: fb.name,
        kind: CompletionItemKind.Class,
        detail: fb.namespace ? `(${fb.namespace}) ${fb.description}` : fb.description,
      });
    }
  }

  // 4. Variables in scope
  const vars = collectVarDeclarations(ast.declarations, pos);
  for (const { vd, constant } of vars) {
    items.push({
      label: vd.name,
      kind: CompletionItemKind.Variable,
      ...(constant && vd.initialValue
        ? { detail: `= ${formatConstantValue(vd.initialValue)}` }
        : {}),
    });
  }

  // 4a. Own methods, properties, actions of enclosing FB (+ inherited members)
  for (const decl of ast.declarations) {
    if (decl.kind !== 'FunctionBlockDeclaration') continue;
    const fb = decl as FunctionBlockDeclaration;
    if (!positionContains(fb.range.start, fb.range.end, pos)) continue;

    for (const method of fb.methods) {
      items.push({ label: method.name, kind: CompletionItemKind.Method });
    }
    for (const prop of fb.properties) {
      items.push({ label: prop.name, kind: CompletionItemKind.Property });
    }
    for (const action of fb.actions) {
      items.push({ label: action.name, kind: CompletionItemKind.Method, detail: 'ACTION' });
    }

    // Inherited members via EXTENDS chain — 'super' context (PUBLIC+PROTECTED, not PRIVATE)
    if (fb.extendsRef) {
      const inheritedItems = getSuperMembers(
        fb.extendsRef.name, ast.declarations, params.textDocument.uri, workspaceIndex, 10,
      );
      for (const ii of inheritedItems) {
        if (!items.some(i => i.label === ii.label)) items.push(ii);
      }
    }
    break;
  }

  // 4b. Global variables from GVL blocks in the current file
  for (const decl of ast.declarations) {
    if (decl.kind !== 'GvlDeclaration') continue;
    const gvl = decl as GvlDeclaration;
    for (const vb of gvl.varBlocks) {
      for (const vd of vb.declarations) {
        items.push({
          label: vd.name,
          kind: CompletionItemKind.Variable,
          detail: gvl.name ? `${vd.type.name} (from ${gvl.name})` : vd.type.name,
        });
      }
    }
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
    } else if (decl.kind === 'InterfaceDeclaration') {
      const iface = decl as InterfaceDeclaration;
      items.push({
        label: iface.name,
        kind: CompletionItemKind.Interface,
        detail: 'INTERFACE',
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
              detail: enumVal.value
                ? `${enumDecl.name} enum member = ${formatConstantValue(enumVal.value)}`
                : `${enumDecl.name} enum member`,
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
    // Extract prefix typed at cursor for filtering (ST identifiers: letters, digits, underscore)
    const lines = text.split('\n');
    const lineUpToCursor = (lines[pos.line] ?? '').slice(0, pos.character);
    const prefixMatch = lineUpToCursor.match(/[A-Za-z_][A-Za-z0-9_]*$/);
    const prefix = prefixMatch ? prefixMatch[0].toUpperCase() : '';

    // Build a set of labels already added from the current file to avoid duplicates
    const existingLabels = new Set(items.map(i => i.label));

    const currentUri = params.textDocument.uri;
    const projectFiles = workspaceIndex.getProjectFiles();

    for (const fileUri of projectFiles) {
      // Skip the current document (already covered by sections 4–6 above)
      if (fileUri === currentUri) continue;

      // Use cached AST when available; fall back to reading from disk
      let otherAst: SourceFile;
      const cached = workspaceIndex.getAst?.(fileUri);
      if (cached) {
        otherAst = cached.ast;
      } else {
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
        ({ ast: otherAst } = parse(fileText));
      }

      for (const decl of otherAst.declarations) {
        if (
          decl.kind === 'ProgramDeclaration' ||
          decl.kind === 'FunctionBlockDeclaration' ||
          decl.kind === 'FunctionDeclaration'
        ) {
          const pou = decl as ProgramDeclaration | FunctionBlockDeclaration | FunctionDeclaration;
          if (!existingLabels.has(pou.name) && (!prefix || pou.name.toUpperCase().startsWith(prefix))) {
            existingLabels.add(pou.name);
            items.push({
              label: pou.name,
              kind: decl.kind === 'FunctionDeclaration'
                ? CompletionItemKind.Function
                : CompletionItemKind.Class,
              detail: `(from ${fileUri})`,
            });
          }
        } else if (decl.kind === 'InterfaceDeclaration') {
          const iface = decl as InterfaceDeclaration;
          if (!existingLabels.has(iface.name) && (!prefix || iface.name.toUpperCase().startsWith(prefix))) {
            existingLabels.add(iface.name);
            items.push({
              label: iface.name,
              kind: CompletionItemKind.Interface,
              detail: 'INTERFACE',
            });
          }
        } else if (decl.kind === 'TypeDeclarationBlock') {
          const typeBlock = decl as TypeDeclarationBlock;
          for (const typeDecl of typeBlock.declarations) {
            if (typeDecl.kind === 'StructDeclaration') {
              const structDecl = typeDecl as StructDeclaration;
              if (!existingLabels.has(structDecl.name) && (!prefix || structDecl.name.toUpperCase().startsWith(prefix))) {
                existingLabels.add(structDecl.name);
                items.push({
                  label: structDecl.name,
                  kind: CompletionItemKind.Struct,
                  detail: 'STRUCT',
                });
              }
            } else if (typeDecl.kind === 'EnumDeclaration') {
              const enumDecl = typeDecl as EnumDeclaration;
              if (!existingLabels.has(enumDecl.name) && (!prefix || enumDecl.name.toUpperCase().startsWith(prefix))) {
                existingLabels.add(enumDecl.name);
                items.push({
                  label: enumDecl.name,
                  kind: CompletionItemKind.Enum,
                  detail: 'ENUM',
                });
                for (const enumVal of enumDecl.values) {
                  const memberLabel = `${enumDecl.name}.${enumVal.name}`;
                  if (!existingLabels.has(memberLabel) && (!prefix || memberLabel.toUpperCase().startsWith(prefix))) {
                    existingLabels.add(memberLabel);
                    items.push({
                      label: memberLabel,
                      kind: CompletionItemKind.EnumMember,
                      detail: enumVal.value
                        ? `${enumDecl.name} enum member = ${formatConstantValue(enumVal.value)}`
                        : `${enumDecl.name} enum member`,
                    });
                  }
                }
              }
            } else if (typeDecl.kind === 'AliasDeclaration') {
              if (!existingLabels.has(typeDecl.name) && (!prefix || typeDecl.name.toUpperCase().startsWith(prefix))) {
                existingLabels.add(typeDecl.name);
                items.push({
                  label: typeDecl.name,
                  kind: CompletionItemKind.TypeParameter,
                  detail: `Alias for ${typeDecl.type.name}`,
                });
              }
            } else if (typeDecl.kind === 'UnionDeclaration') {
              const unionDecl = typeDecl as UnionDeclaration;
              if (!existingLabels.has(unionDecl.name) && (!prefix || unionDecl.name.toUpperCase().startsWith(prefix))) {
                existingLabels.add(unionDecl.name);
                items.push({
                  label: unionDecl.name,
                  kind: CompletionItemKind.Struct,
                  detail: 'UNION',
                });
              }
            }
          }
        } else if (decl.kind === 'GvlDeclaration') {
          const gvl = decl as GvlDeclaration;
          for (const vb of gvl.varBlocks) {
            for (const vd of vb.declarations) {
              if (!existingLabels.has(vd.name) && (!prefix || vd.name.toUpperCase().startsWith(prefix))) {
                existingLabels.add(vd.name);
                items.push({
                  label: vd.name,
                  kind: CompletionItemKind.Variable,
                  detail: gvl.name ? `${vd.type.name} (${gvl.name})` : vd.type.name,
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
