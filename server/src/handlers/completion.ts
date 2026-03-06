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
  VarDeclaration,
  Position,
  SourceFile,
  TopLevelDeclaration,
  TypeDeclarationBlock,
  StructDeclaration,
  EnumDeclaration,
  UnionDeclaration,
  InterfaceDeclaration,
  AliasDeclaration,
} from '../parser/ast';
import { BUILTIN_TYPES } from '../twincat/types';
import { STANDARD_FBS, findStandardFB } from '../twincat/stdlib';
import { findSystemType } from '../twincat/systemTypes';
import { WorkspaceIndex } from '../twincat/workspaceIndex';
import { LibrarySymbol } from '../twincat/libraryZipReader';
import { extractStFromTwinCAT } from '../twincat/tcExtractor';
import { formatConstantValue } from './utils';
import { getOrParse } from './shared';

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

/** VAR kinds visible to external callers of a FUNCTION_BLOCK. */
const EXTERNAL_VISIBLE_VAR_KINDS = new Set(['VAR_INPUT', 'VAR_OUTPUT', 'VAR_IN_OUT']);

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
function getIdentifierBeforeDot(text: string, line: number, character: number): string | null {
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
    return fb.extendsRef?.name ?? null;
  }
  return null;
}

/**
 * If the line up to the cursor contains `<ident> :=`, return the LHS identifier.
 * Returns null if not in an assignment context.
 */
function getLhsIdentifierForAssignment(text: string, line: number, character: number): string | null {
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
function getCaseSelectorIdentifier(text: string, line: number): string | null {
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

function getIdentifierBeforeDotInLines(lines: string[], line: number, character: number): string | null {
  if (line >= lines.length) return null;
  const lineText = lines[line];
  if (character === 0 || lineText[character - 1] !== '.') return null;
  let i = character - 2;
  while (i >= 0 && /[a-zA-Z0-9_.^]/.test(lineText[i])) i--;
  const ident = lineText.slice(i + 1, character - 1).replace(/\^/g, '');
  return ident.length > 0 ? ident : null;
}

function isSuperBeforeDotInLines(lines: string[], line: number, character: number): boolean {
  if (line >= lines.length) return false;
  const prefix = lines[line].slice(0, character);
  return /\bSUPER\s*\^\s*\.\s*$/i.test(prefix);
}

function getLhsIdentifierForAssignmentInLines(lines: string[], line: number, character: number): string | null {
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

function getCaseSelectorIdentifierInLines(lines: string[], line: number): string | null {
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
      const cached = workspaceIndex.getAst?.(fileUri);
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
      if (fb.extendsRef) {
        const parentItems = getSuperMembers(
          fb.extendsRef.name, declarations, currentUri, workspaceIndex, depth - 1,
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
 * Find an EnumDeclaration by type name, searching local declarations then workspace index.
 */
function findEnumDeclaration(
  typeName: string,
  declarations: TopLevelDeclaration[],
  currentUri: string,
  workspaceIndex?: WorkspaceIndex,
): EnumDeclaration | null {
  const upperName = typeName.toUpperCase();

  for (const decl of declarations) {
    if (decl.kind === 'TypeDeclarationBlock') {
      const typeBlock = decl as TypeDeclarationBlock;
      for (const typeDecl of typeBlock.declarations) {
        if (typeDecl.kind === 'EnumDeclaration' && typeDecl.name.toUpperCase() === upperName) {
          return typeDecl as EnumDeclaration;
        }
      }
    }
  }

  if (workspaceIndex) {
    for (const fileUri of workspaceIndex.getProjectFiles()) {
      if (fileUri === currentUri) continue;
      let fileDeclarations: TopLevelDeclaration[] | undefined;
      const cached = workspaceIndex.getAst?.(fileUri);
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
      for (const decl of fileDeclarations) {
        if (decl.kind === 'TypeDeclarationBlock') {
          for (const typeDecl of (decl as TypeDeclarationBlock).declarations) {
            if (typeDecl.kind === 'EnumDeclaration' && typeDecl.name.toUpperCase() === upperName) {
              return typeDecl as EnumDeclaration;
            }
          }
        }
      }
    }
  }

  return null;
}

/**
 * Convert an EnumDeclaration into CompletionItems (EnumName.ValueName format).
 */
function enumValuesToCompletionItems(enumDecl: EnumDeclaration): CompletionItem[] {
  return enumDecl.values.map(v => ({
    label: `${enumDecl.name}.${v.name}`,
    kind: CompletionItemKind.EnumMember,
    detail: v.value
      ? `${enumDecl.name} enum value = ${formatConstantValue(v.value)}`
      : `${enumDecl.name} enum value`,
  }));
}

/**
 * Collect all declarations from the workspace index into an array of declaration sets.
 * The first entry is always `declarations` (current file).
 */
function collectAllDeclSets(
  declarations: TopLevelDeclaration[],
  currentUri: string,
  workspaceIndex?: WorkspaceIndex,
): TopLevelDeclaration[][] {
  const sets: TopLevelDeclaration[][] = [declarations];
  if (!workspaceIndex) return sets;
  for (const fileUri of workspaceIndex.getProjectFiles()) {
    if (fileUri === currentUri) continue;
    const cached = workspaceIndex.getAst?.(fileUri);
    if (cached) {
      sets.push(cached.ast.declarations);
    } else {
      try {
        const filePath = fileUri.startsWith('file://')
          ? decodeURIComponent(fileUri.replace(/^file:\/\//, ''))
          : fileUri;
        const rawText = fs.readFileSync(filePath, 'utf8');
        const fileText = extractStFromTwinCAT(filePath, rawText).stCode;
        sets.push(parse(fileText).ast.declarations);
      } catch {
        continue;
      }
    }
  }
  return sets;
}

/**
 * Find the declared type name of member `memberName` within the type `typeName`.
 * Searches local declarations and workspace index. Walks EXTENDS chains.
 */
function findMemberType(
  typeName: string,
  memberName: string,
  declarations: TopLevelDeclaration[],
  currentUri: string,
  workspaceIndex?: WorkspaceIndex,
  visited: Set<string> = new Set(),
): string | null {
  const upperTypeName = typeName.toUpperCase();
  const upperMemberName = memberName.toUpperCase();
  if (visited.has(upperTypeName)) return null;
  visited.add(upperTypeName);

  for (const decls of collectAllDeclSets(declarations, currentUri, workspaceIndex)) {
    for (const decl of decls) {
      if (decl.kind === 'FunctionBlockDeclaration') {
        const fb = decl as FunctionBlockDeclaration;
        if (fb.name.toUpperCase() !== upperTypeName) continue;
        for (const vb of fb.varBlocks) {
          const vd = vb.declarations.find(v => v.name.toUpperCase() === upperMemberName);
          if (vd) return vd.type.name;
        }
        for (const method of fb.methods) {
          if (method.name.toUpperCase() === upperMemberName) return method.returnType?.name ?? null;
        }
        for (const prop of fb.properties) {
          if (prop.name.toUpperCase() === upperMemberName) return prop.type.name;
        }
        if (fb.extendsRef) {
          return findMemberType(fb.extendsRef.name, memberName, declarations, currentUri, workspaceIndex, visited);
        }
        return null;
      }
      if (decl.kind === 'InterfaceDeclaration') {
        const itf = decl as InterfaceDeclaration;
        if (itf.name.toUpperCase() !== upperTypeName) continue;
        for (const method of itf.methods) {
          if (method.name.toUpperCase() === upperMemberName) return method.returnType?.name ?? null;
        }
        for (const prop of itf.properties) {
          if (prop.name.toUpperCase() === upperMemberName) return prop.type.name;
        }
        for (const extRef of itf.extendsRefs) {
          const t = findMemberType(extRef.name, memberName, declarations, currentUri, workspaceIndex, visited);
          if (t) return t;
        }
        return null;
      }
      if (decl.kind === 'TypeDeclarationBlock') {
        for (const typeDecl of (decl as TypeDeclarationBlock).declarations) {
          if (typeDecl.kind === 'StructDeclaration' && typeDecl.name.toUpperCase() === upperTypeName) {
            const struct = typeDecl as StructDeclaration;
            const field = struct.fields.find(f => f.name.toUpperCase() === upperMemberName);
            if (field) return field.type.name;
            if (struct.extendsRef) {
              return findMemberType(struct.extendsRef.name, memberName, declarations, currentUri, workspaceIndex, visited);
            }
            return null;
          }
          if (typeDecl.kind === 'AliasDeclaration' && typeDecl.name.toUpperCase() === upperTypeName) {
            return findMemberType(
              (typeDecl as AliasDeclaration).type.name, memberName, declarations, currentUri, workspaceIndex, visited,
            );
          }
          if (typeDecl.kind === 'UnionDeclaration' && typeDecl.name.toUpperCase() === upperTypeName) {
            const union = typeDecl as UnionDeclaration;
            const field = union.fields.find(f => f.name.toUpperCase() === upperMemberName);
            if (field) return field.type.name;
            return null;
          }
        }
      }
      if (decl.kind === 'ProgramDeclaration') {
        const prog = decl as ProgramDeclaration;
        if (prog.name.toUpperCase() !== upperTypeName) continue;
        for (const vb of prog.varBlocks) {
          const vd = vb.declarations.find(v => v.name.toUpperCase() === upperMemberName);
          if (vd) return vd.type.name;
        }
        return null;
      }
    }
  }
  return null;
}

/**
 * Return completion items for a library symbol's parameters.
 * Handles inputs, outputs, and inOut parameters from LibrarySymbol.
 */
function getMembersFromLibrarySymbol(symbol: LibrarySymbol): CompletionItem[] {
  const items: CompletionItem[] = [];

  // Input parameters
  if (symbol.inputs) {
    for (const param of symbol.inputs) {
      items.push({
        label: param.name,
        kind: CompletionItemKind.Field,
        detail: `${param.name} : ${param.type || 'ANY'}`,
        documentation: param.comment || undefined,
        sortText: `1_${param.name}`, // Sort inputs first
      });
    }
  }

  // Output parameters
  if (symbol.outputs) {
    for (const param of symbol.outputs) {
      items.push({
        label: param.name,
        kind: CompletionItemKind.Field,
        detail: `${param.name} : ${param.type || 'ANY'}`,
        documentation: param.comment || undefined,
        sortText: `2_${param.name}`, // Sort outputs after inputs
      });
    }
  }

  // In/Out parameters
  if (symbol.inOuts) {
    for (const param of symbol.inOuts) {
      items.push({
        label: param.name,
        kind: CompletionItemKind.Field,
        detail: `${param.name} : ${param.type || 'ANY'}`,
        documentation: param.comment || undefined,
        sortText: `3_${param.name}`, // Sort inOuts last
      });
    }
  }

  // Methods
  if (symbol.methods) {
    for (const method of symbol.methods) {
      items.push({
        label: method.name,
        kind: CompletionItemKind.Method,
        detail: method.returnType || undefined,
        documentation: method.description || undefined,
        sortText: `4_${method.name}`, // Sort methods after params
      });
    }
  }

  return items;
}

/**
 * Return completion items for all members exposed by `typeName`.
 * Handles FUNCTION_BLOCK (all var sections, methods, properties, EXTENDS chain),
 * STRUCT (fields, EXTENDS chain), INTERFACE (methods, properties, EXTENDS chain),
 * and ALIAS (dereferenced to target type).
 * Searches `declarations` (current file) and optionally the workspace index.
 */
function getMembersFromDeclarations(
  typeName: string,
  declarations: TopLevelDeclaration[],
  currentUri?: string,
  workspaceIndex?: WorkspaceIndex,
  visited: Set<string> = new Set(),
): CompletionItem[] | null {
  const upperName = typeName.toUpperCase();
  if (visited.has(upperName)) return null;
  visited.add(upperName);

  const uri = currentUri ?? '';
  for (const decls of collectAllDeclSets(declarations, uri, workspaceIndex)) {
    for (const decl of decls) {
      if (decl.kind === 'FunctionBlockDeclaration') {
        const fb = decl as FunctionBlockDeclaration;
        if (fb.name.toUpperCase() !== upperName) continue;

        const items: CompletionItem[] = [];
        for (const vb of fb.varBlocks) {
          if (!EXTERNAL_VISIBLE_VAR_KINDS.has(vb.varKind)) continue;
          for (const vd of vb.declarations) {
            items.push({ label: vd.name, kind: CompletionItemKind.Field, detail: vd.type.name });
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
        if (fb.extendsRef) {
          const parentItems = getMembersFromDeclarations(
            fb.extendsRef.name, declarations, currentUri, workspaceIndex, visited,
          );
          if (parentItems) {
            for (const pi of parentItems) {
              if (!items.some(i => i.label === pi.label)) items.push(pi);
            }
          }
        }
        return items;
      }

      if (decl.kind === 'InterfaceDeclaration') {
        const itf = decl as InterfaceDeclaration;
        if (itf.name.toUpperCase() !== upperName) continue;

        const items: CompletionItem[] = [];
        for (const method of itf.methods) {
          items.push({
            label: method.name,
            kind: CompletionItemKind.Method,
            detail: method.returnType?.name ?? 'void',
          });
        }
        for (const prop of itf.properties) {
          items.push({ label: prop.name, kind: CompletionItemKind.Property, detail: prop.type.name });
        }
        for (const extRef of itf.extendsRefs) {
          const parentItems = getMembersFromDeclarations(
            extRef.name, declarations, currentUri, workspaceIndex, visited,
          );
          if (parentItems) {
            for (const pi of parentItems) {
              if (!items.some(i => i.label === pi.label)) items.push(pi);
            }
          }
        }
        return items;
      }

      if (decl.kind === 'TypeDeclarationBlock') {
        const typeBlock = decl as TypeDeclarationBlock;
        for (const typeDecl of typeBlock.declarations) {
          if (typeDecl.kind === 'StructDeclaration' && typeDecl.name.toUpperCase() === upperName) {
            const struct = typeDecl as StructDeclaration;
            const items: CompletionItem[] = struct.fields.map(f => ({
              label: f.name,
              kind: CompletionItemKind.Field,
              detail: f.type.name,
            }));
            if (struct.extendsRef) {
              const parentItems = getMembersFromDeclarations(
                struct.extendsRef.name, declarations, currentUri, workspaceIndex, visited,
              );
              if (parentItems) {
                for (const pi of parentItems) {
                  if (!items.some(i => i.label === pi.label)) items.push(pi);
                }
              }
            }
            return items;
          }
          if (typeDecl.kind === 'AliasDeclaration' && typeDecl.name.toUpperCase() === upperName) {
            return getMembersFromDeclarations(
              (typeDecl as AliasDeclaration).type.name, declarations, currentUri, workspaceIndex, visited,
            );
          }
          if (typeDecl.kind === 'UnionDeclaration' && typeDecl.name.toUpperCase() === upperName) {
            const union = typeDecl as UnionDeclaration;
            return union.fields.map(f => ({
              label: f.name,
              kind: CompletionItemKind.Field,
              detail: f.type.name,
            }));
          }
        }
      }
      if (decl.kind === 'ProgramDeclaration') {
        const prog = decl as ProgramDeclaration;
        if (prog.name.toUpperCase() !== upperName) continue;
        const items: CompletionItem[] = [];
        for (const vb of prog.varBlocks) {
          if (vb.varKind === 'VAR_OUTPUT' || vb.varKind === 'VAR_IN_OUT') {
            for (const vd of vb.declarations) {
              items.push({ label: vd.name, kind: CompletionItemKind.Field, detail: vd.type.name });
            }
          }
        }
        return items;
      }
    }
  }
  return null;
}

/**
 * Resolve dot-access members for the expression `expression` (may be a dotted
 * chain like "myFb.inner"):
 *   1. Resolve the first segment as a local variable.
 *   2. Walk any remaining chain segments via findMemberType().
 *   3. Return completion items for the final resolved type.
 *
 * If the first segment is not a variable, fall back to treating it as a type
 * name directly (e.g. enum static access: E_Color. → show enum values).
 */
function getDotAccessMembers(
  expression: string,
  vars: VarDeclaration[],
  declarations: TopLevelDeclaration[],
  currentUri: string,
  workspaceIndex?: WorkspaceIndex,
): CompletionItem[] | null {
  const parts = expression.split('.');

  // Resolve the first part as a variable
  const vd = vars.find(v => v.name.toUpperCase() === parts[0].toUpperCase());

  let typeName: string;
  if (vd) {
    typeName = vd.type.name;
  } else {
    // Check if parts[0] matches a named GVL across all declaration sets
    for (const declSet of collectAllDeclSets(declarations, currentUri, workspaceIndex)) {
      for (const d of declSet) {
        if (d.kind !== 'GvlDeclaration') continue;
        const gvl = d as GvlDeclaration;
        if (!gvl.name || gvl.name.toUpperCase() !== parts[0].toUpperCase()) continue;

        // Collect all GVL variables
        const gvlVars: VarDeclaration[] = [];
        for (const vb of gvl.varBlocks) {
          gvlVars.push(...vb.declarations);
        }

        if (parts.length === 1) {
          // Return all GVL variables as completion items
          return gvlVars.map(v => ({
            label: v.name,
            kind: CompletionItemKind.Variable,
            detail: v.type.name,
          }));
        }

        // Resolve chain starting from parts[1] within the GVL's vars
        const gvlVar = gvlVars.find(v => v.name.toUpperCase() === parts[1].toUpperCase());
        if (!gvlVar) continue; // member not in this GVL, keep searching

        let innerTypeName = gvlVar.type.name;
        for (let i = 2; i < parts.length; i++) {
          const memberName = parts[i];
          const innerStdFb = findStandardFB(innerTypeName);
          if (innerStdFb) {
            const param = [...innerStdFb.inputs, ...innerStdFb.outputs].find(p => p.name.toUpperCase() === memberName.toUpperCase());
            if (!param?.type) return null;
            innerTypeName = param.type;
            continue;
          }
          const memberType = findMemberType(innerTypeName, memberName, declarations, currentUri, workspaceIndex);
          if (!memberType) return null;
          innerTypeName = memberType;
        }

        const innerStdFb = findStandardFB(innerTypeName);
        if (innerStdFb) {
          return [
            ...innerStdFb.inputs.map(i => ({
              label: i.name,
              kind: CompletionItemKind.Field,
              detail: i.type,
              documentation: i.description,
              sortText: `1_${i.name}`, // Sort inputs first
            })),
            ...innerStdFb.outputs.map(o => ({
              label: o.name,
              kind: CompletionItemKind.Field,
              detail: o.type,
              documentation: o.description,
              sortText: `2_${o.name}`, // Sort outputs after inputs
            })),
          ];
        }

        // Check system struct fields (TIMESTRUCT, FILETIME, etc.)
        const innerSysType = findSystemType(innerTypeName);
        if (innerSysType?.fields) {
          return innerSysType.fields.map(f => ({
            label: f.name,
            kind: CompletionItemKind.Field,
            detail: f.type,
            documentation: f.description,
            sortText: `1_${f.name}`,
          }));
        }

        // Check library symbols from workspace index
        if (workspaceIndex) {
          const upperInnerTypeName = innerTypeName.toUpperCase();
          const libSymbols = workspaceIndex.getLibrarySymbols(currentUri);
          const libSymbol = libSymbols.find(s => s.name.toUpperCase() === upperInnerTypeName);
          if (libSymbol) {
            return getMembersFromLibrarySymbol(libSymbol);
          }
        }

        return getMembersFromDeclarations(innerTypeName, declarations, currentUri, workspaceIndex);
      }
    }

    // Not a local variable or GVL — treat as a direct type name (e.g. enum static access)
    if (parts.length === 1) {
      const enumDecl = findEnumDeclaration(parts[0], declarations, currentUri, workspaceIndex);
      if (enumDecl) {
        return enumDecl.values.map(v => ({
          label: v.name,
          kind: CompletionItemKind.EnumMember,
          detail: `${enumDecl.name} enum value`,
        }));
      }
    }
    return null;
  }

  // Walk remaining chain segments to resolve the final type
  for (let i = 1; i < parts.length; i++) {
    const memberName = parts[i];
    const stdFb = findStandardFB(typeName);
    if (stdFb) {
      const param = [...stdFb.inputs, ...stdFb.outputs].find(p => p.name.toUpperCase() === memberName.toUpperCase());
      if (!param?.type) return null;
      typeName = param.type;
      continue;
    }

    // Check system struct fields
    const sysTypeChain = findSystemType(typeName);
    if (sysTypeChain?.fields) {
      const field = sysTypeChain.fields.find(f => f.name.toUpperCase() === memberName.toUpperCase());
      if (field) {
        typeName = field.type;
        continue;
      }
      return null; // member not found on system struct
    }

    // Check library symbols for member type resolution
    if (workspaceIndex) {
      const upperTypeName = typeName.toUpperCase();
      const libSymbols = workspaceIndex.getLibrarySymbols(currentUri);
      const libSymbol = libSymbols.find(s => s.name.toUpperCase() === upperTypeName);
      if (libSymbol) {
        const allParams = [...(libSymbol.inputs ?? []), ...(libSymbol.outputs ?? []), ...(libSymbol.inOuts ?? [])];
        const param = allParams.find(p => p.name.toUpperCase() === memberName.toUpperCase());
        if (!param?.type) return null;
        typeName = param.type;
        continue;
      }
    }

    const memberType = findMemberType(typeName, memberName, declarations, currentUri, workspaceIndex);
    if (!memberType) return null;
    typeName = memberType;
  }

  // Return members of the resolved type
  const stdFb = findStandardFB(typeName);
  if (stdFb) {
    return [
      ...stdFb.inputs.map(i => ({
        label: i.name,
        kind: CompletionItemKind.Field,
        detail: i.type,
        documentation: i.description,
        sortText: `1_${i.name}`, // Sort inputs first
      })),
      ...stdFb.outputs.map(o => ({
        label: o.name,
        kind: CompletionItemKind.Field,
        detail: o.type,
        documentation: o.description,
        sortText: `2_${o.name}`, // Sort outputs after inputs
      })),
    ];
  }

  // Check system types with struct fields (TIMESTRUCT, FILETIME, etc.)
  const sysType = findSystemType(typeName);
  if (sysType?.fields) {
    return sysType.fields.map(f => ({
      label: f.name,
      kind: CompletionItemKind.Field,
      detail: f.type,
      documentation: f.description,
      sortText: `1_${f.name}`,
    }));
  }

  // Check library symbols from workspace index
  if (workspaceIndex) {
    const upperTypeName = typeName.toUpperCase();
    const libSymbols = workspaceIndex.getLibrarySymbols(currentUri);
    const libSymbol = libSymbols.find(s => s.name.toUpperCase() === upperTypeName);
    if (libSymbol) {
      return getMembersFromLibrarySymbol(libSymbol);
    }
  }

  return getMembersFromDeclarations(typeName, declarations, currentUri, workspaceIndex);
}

function buildLibrarySymbolDoc(symbol: LibrarySymbol): string {
  const parts: string[] = [];
  if (symbol.extends) parts.push(`EXTENDS ${symbol.extends}`);
  if (symbol.implements?.length) parts.push(`IMPLEMENTS ${symbol.implements.join(', ')}`);
  if (symbol.returnType) parts.push(`Returns: ${symbol.returnType}`);
  if (symbol.inputs?.length) {
    parts.push('VAR_INPUT: ' + symbol.inputs.map(p => `${p.name} : ${p.type || 'ANY'}`).join(', '));
  }
  return parts.join('\n');
}

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
    // Special case: THIS (or THIS^ after caret-stripping) — return all members of the enclosing FB.
    if (identBeforeDot.toUpperCase() === 'THIS') {
      for (const decl of ast.declarations) {
        if (decl.kind !== 'FunctionBlockDeclaration') continue;
        const fb = decl as FunctionBlockDeclaration;
        if (!positionContains(fb.range.start, fb.range.end, pos)) continue;
        const thisItems: CompletionItem[] = [];
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

  // 4a. Global variables from GVL blocks in the current file
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
