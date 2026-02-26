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
  SourceFile,
  TopLevelDeclaration,
  TypeDeclarationBlock,
  StructDeclaration,
  EnumDeclaration,
  UnionDeclaration,
} from '../parser/ast';
import { BUILTIN_TYPES } from '../twincat/types';
import { STANDARD_FBS, findStandardFB } from '../twincat/stdlib';
import { getLibraryFBs } from '../twincat/libraryRegistry';
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

/**
 * If the character immediately before the cursor is '.', return the identifier
 * that precedes it; otherwise return null.
 */
function getIdentifierBeforeDot(text: string, line: number, character: number): string | null {
  const lines = text.split('\n');
  if (line >= lines.length) return null;
  const lineText = lines[line];
  if (character === 0 || lineText[character - 1] !== '.') return null;

  let i = character - 2;
  while (i >= 0 && /[a-zA-Z0-9_]/.test(lineText[i])) i--;
  const ident = lineText.slice(i + 1, character - 1);
  return ident.length > 0 ? ident : null;
}

/**
 * Return true if the text immediately before the cursor ends with `SUPER^.`
 * (case-insensitive, with optional whitespace around `^` and `.`).
 */
function isSuperBeforeDot(text: string, line: number, character: number): boolean {
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
function getEnclosingFbExtends(
  declarations: TopLevelDeclaration[],
  pos: Position,
): string | null {
  for (const decl of declarations) {
    if (decl.kind !== 'FunctionBlockDeclaration') continue;
    const fb = decl as FunctionBlockDeclaration;
    if (!positionContains(fb.range.start, fb.range.end, pos)) continue;
    return fb.extends ?? null;
  }
  return null;
}

/**
 * Collect members (VAR_OUTPUT, VAR_IN_OUT, non-PRIVATE non-FINAL methods and
 * properties) from the FB named `fbName`, searching `declarations` and the
 * workspace index.  Walks the EXTENDS chain recursively up to `maxDepth`.
 */
function getSuperMembers(
  fbName: string,
  declarations: TopLevelDeclaration[],
  currentUri: string,
  workspaceIndex: WorkspaceIndex | undefined,
  depth: number,
): CompletionItem[] {
  if (depth <= 0) return [];

  // Search current file, then workspace index
  const allDeclarations: TopLevelDeclaration[][] = [declarations];
  if (workspaceIndex) {
    for (const fileUri of workspaceIndex.getProjectFiles()) {
      if (fileUri === currentUri) continue;
      const cached = workspaceIndex.getAst(fileUri);
      if (cached) {
        allDeclarations.push(cached.ast.declarations);
      } else {
        try {
          const filePath = fileUri.startsWith('file://')
            ? decodeURIComponent(fileUri.replace(/^file:\/\//, ''))
            : fileUri;
          const rawText = fs.readFileSync(filePath, 'utf8');
          const fileText = extractStFromTwinCAT(filePath, rawText).stCode;
          allDeclarations.push(parse(fileText).ast.declarations);
        } catch {
          // skip unreadable files
        }
      }
    }
  }

  const upperName = fbName.toUpperCase();
  for (const decls of allDeclarations) {
    for (const decl of decls) {
      if (decl.kind !== 'FunctionBlockDeclaration') continue;
      const fb = decl as FunctionBlockDeclaration;
      if (fb.name.toUpperCase() !== upperName) continue;

      const items: CompletionItem[] = [];

      // VAR_OUTPUT and VAR_IN_OUT
      for (const vb of fb.varBlocks) {
        if (vb.varKind === 'VAR_OUTPUT' || vb.varKind === 'VAR_IN_OUT') {
          for (const vd of vb.declarations) {
            items.push({ label: vd.name, kind: CompletionItemKind.Field, detail: vd.type.name });
          }
        }
      }

      // Methods — exclude PRIVATE and FINAL
      for (const method of fb.methods) {
        const mods = method.modifiers.map(m => m.toUpperCase());
        if (mods.includes('PRIVATE') || mods.includes('FINAL')) continue;
        items.push({
          label: method.name,
          kind: CompletionItemKind.Method,
          detail: method.returnType?.name ?? 'void',
        });
      }

      // Properties — exclude PRIVATE and FINAL
      for (const prop of fb.properties) {
        const mods = prop.modifiers.map(m => m.toUpperCase());
        if (mods.includes('PRIVATE') || mods.includes('FINAL')) continue;
        items.push({ label: prop.name, kind: CompletionItemKind.Property, detail: prop.type.name });
      }

      // Recurse into grandparent chain
      if (fb.extends) {
        const parentItems = getSuperMembers(
          fb.extends, declarations, currentUri, workspaceIndex, depth - 1,
        );
        for (const pi of parentItems) {
          if (!items.some(i => i.label === pi.label)) items.push(pi);
        }
      }

      return items;
    }
  }

  return [];
}

/**
 * Return completion items for the members exposed by `typeName`.
 * Searches `declarations` for a matching FUNCTION_BLOCK or STRUCT.
 *
 * For FBs:     VAR_OUTPUT, VAR_IN_OUT, methods, and properties (not VAR_INPUT).
 * For STRUCTs: all fields.
 *
 * Returns null if the type is not found in `declarations`.
 */
function getMembersFromDeclarations(
  typeName: string,
  declarations: TopLevelDeclaration[],
): CompletionItem[] | null {
  const upperName = typeName.toUpperCase();

  for (const decl of declarations) {
    if (decl.kind === 'FunctionBlockDeclaration') {
      const fb = decl as FunctionBlockDeclaration;
      if (fb.name.toUpperCase() !== upperName) continue;

      const items: CompletionItem[] = [];
      for (const vb of fb.varBlocks) {
        if (vb.varKind === 'VAR_OUTPUT' || vb.varKind === 'VAR_IN_OUT') {
          for (const vd of vb.declarations) {
            items.push({ label: vd.name, kind: CompletionItemKind.Field, detail: vd.type.name });
          }
        }
      }
      for (const method of fb.methods) {
        items.push({
          label: method.name,
          kind: CompletionItemKind.Method,
          detail: method.returnType?.name ?? 'void',
        });
      }
      for (const prop of fb.properties) {
        items.push({ label: prop.name, kind: CompletionItemKind.Property, detail: prop.type.name });
      }
      return items;
    }

    if (decl.kind === 'TypeDeclarationBlock') {
      const typeBlock = decl as TypeDeclarationBlock;
      for (const typeDecl of typeBlock.declarations) {
        if (typeDecl.kind === 'StructDeclaration' && typeDecl.name.toUpperCase() === upperName) {
          const struct = typeDecl as StructDeclaration;
          return struct.fields.map(f => ({
            label: f.name,
            kind: CompletionItemKind.Field,
            detail: f.type.name,
          }));
        }
      }
    }
  }
  return null;
}

/**
 * Resolve dot-access members for the variable `varName`:
 *   1. Look up the variable's declared type in `vars`.
 *   2. Check standard FBs (e.g. TON → Q, ET).
 *   3. Search the current file's AST declarations.
 *   4. Search workspace index (other files).
 *
 * Returns a completion list, or null if the variable is not found.
 */
function getDotAccessMembers(
  varName: string,
  vars: VarDeclaration[],
  declarations: TopLevelDeclaration[],
  currentUri: string,
  workspaceIndex?: WorkspaceIndex,
): CompletionItem[] | null {
  const vd = vars.find(v => v.name.toUpperCase() === varName.toUpperCase());
  if (!vd) return null;

  const typeName = vd.type.name;

  // 1. Standard FBs
  const stdFb = findStandardFB(typeName);
  if (stdFb) {
    return stdFb.outputs.map(o => ({
      label: o.name,
      kind: CompletionItemKind.Field,
      detail: o.type,
      documentation: o.description,
    }));
  }

  // 2. Current file
  const localMembers = getMembersFromDeclarations(typeName, declarations);
  if (localMembers) return localMembers;

  // 3. Workspace index
  if (workspaceIndex) {
    for (const fileUri of workspaceIndex.getProjectFiles()) {
      if (fileUri === currentUri) continue;

      let fileDeclarations: TopLevelDeclaration[] | undefined;
      const cached = workspaceIndex.getAst(fileUri);
      if (cached) {
        fileDeclarations = cached.ast.declarations;
      } else {
        try {
          const filePath = fileUri.startsWith('file://')
            ? decodeURIComponent(fileUri.replace(/^file:\/\//, ''))
            : fileUri;
          const rawText = fs.readFileSync(filePath, 'utf8');
          const fileText = extractStFromTwinCAT(filePath, rawText).stCode;
          fileDeclarations = parse(fileText).ast.declarations;
        } catch {
          continue;
        }
      }

      const members = getMembersFromDeclarations(typeName, fileDeclarations);
      if (members) return members;
    }
  }

  return null;
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

  // SUPER^. member completion: when inside a child FB and user types 'SUPER^.',
  // return the parent FB's inherited members.
  if (isSuperBeforeDot(text, pos.line, pos.character)) {
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
  const identBeforeDot = getIdentifierBeforeDot(text, pos.line, pos.character);
  if (identBeforeDot !== null) {
    const vars = collectVarDeclarations(ast.declarations, pos);
    const members = getDotAccessMembers(
      identBeforeDot, vars, ast.declarations, params.textDocument.uri, workspaceIndex,
    );
    return members ?? [];
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

  // 3. Standard FBs — filtered to libraries referenced by the document's project.
  //    If no project is found (standalone file), fall back to all stdlib symbols.
  const libRefs = workspaceIndex?.getLibraryRefs(params.textDocument.uri) ?? [];
  const fbsToOffer =
    libRefs.length > 0
      ? libRefs.flatMap((ref) => getLibraryFBs(ref.name))
      : STANDARD_FBS;
  for (const fb of fbsToOffer) {
    items.push({
      label: fb.name,
      kind: CompletionItemKind.Class,
      detail: fb.namespace ? `(${fb.namespace}) ${fb.description}` : fb.description,
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

  // 5a. THIS. member completion: actions and methods of the enclosing FB
  const linePrefix = text.split('\n')[pos.line]?.slice(0, pos.character) ?? '';
  if (/\bTHIS\s*\.\s*$/i.test(linePrefix)) {
    for (const decl of ast.declarations) {
      if (decl.kind !== 'FunctionBlockDeclaration') continue;
      const fb = decl as FunctionBlockDeclaration;
      if (!positionContains(fb.range.start, fb.range.end, pos)) continue;
      for (const action of fb.actions) {
        items.push({ label: action.name, kind: CompletionItemKind.Method, detail: 'ACTION' });
      }
      for (const method of fb.methods) {
        items.push({ label: method.name, kind: CompletionItemKind.Method });
      }
      break;
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
                      detail: `${enumDecl.name} enum member`,
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
        }
      }
    }
  }

  return items;
}
