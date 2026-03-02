import * as fs from 'fs';
import * as path from 'path';
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
  InterfaceDeclaration,
  AliasDeclaration,
} from '../parser/ast';
import { BUILTIN_TYPES } from '../twincat/types';
import { STANDARD_FBS, findStandardFB } from '../twincat/stdlib';
import { getLibraryFBs } from '../twincat/libraryRegistry';
import { WorkspaceIndex } from '../twincat/workspaceIndex';
import { extractST, extractStFromTwinCAT, PositionMapper } from '../twincat/tcExtractor';
import { formatConstantValue } from './utils';

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
  while (i >= 0 && /[a-zA-Z0-9_.]/.test(lineText[i])) i--;
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
  while (i >= 0 && /[a-zA-Z0-9_.]/.test(lineText[i])) i--;
  const ident = lineText.slice(i + 1, character - 1);
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
    const cached = workspaceIndex.getAst(fileUri);
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
        if (fb.extends) {
          return findMemberType(fb.extends, memberName, declarations, currentUri, workspaceIndex, visited);
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
        for (const extName of itf.extends) {
          const t = findMemberType(extName, memberName, declarations, currentUri, workspaceIndex, visited);
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
            if (struct.extends) {
              return findMemberType(struct.extends, memberName, declarations, currentUri, workspaceIndex, visited);
            }
            return null;
          }
          if (typeDecl.kind === 'AliasDeclaration' && typeDecl.name.toUpperCase() === upperTypeName) {
            return findMemberType(
              (typeDecl as AliasDeclaration).type.name, memberName, declarations, currentUri, workspaceIndex, visited,
            );
          }
        }
      }
    }
  }
  return null;
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
        if (fb.extends) {
          const parentItems = getMembersFromDeclarations(
            fb.extends, declarations, currentUri, workspaceIndex, visited,
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
        for (const extName of itf.extends) {
          const parentItems = getMembersFromDeclarations(
            extName, declarations, currentUri, workspaceIndex, visited,
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
            if (struct.extends) {
              const parentItems = getMembersFromDeclarations(
                struct.extends, declarations, currentUri, workspaceIndex, visited,
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
        }
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
    // Not a local variable — treat as a direct type name (e.g. enum static access)
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
      const output = stdFb.outputs.find(o => o.name.toUpperCase() === memberName.toUpperCase());
      if (!output?.type) return null;
      typeName = output.type;
      continue;
    }
    const memberType = findMemberType(typeName, memberName, declarations, currentUri, workspaceIndex);
    if (!memberType) return null;
    typeName = memberType;
  }

  // Return members of the resolved type
  const stdFb = findStandardFB(typeName);
  if (stdFb) {
    return stdFb.outputs.map(o => ({
      label: o.name,
      kind: CompletionItemKind.Field,
      detail: o.type,
      documentation: o.description,
    }));
  }

  return getMembersFromDeclarations(typeName, declarations, currentUri, workspaceIndex);
}

export function handleCompletion(
  params: TextDocumentPositionParams,
  document: TextDocument | undefined,
  workspaceIndex?: WorkspaceIndex,
): CompletionItem[] {
  if (!document) return [];

  const text = document.getText();
  const ext = path.extname(document.uri);
  const extraction = extractST(text, ext);
  const mapper = new PositionMapper(extraction);
  // If extraction returned no code from non-empty content, the document content
  // is likely already-extracted ST fed to a handler with a TwinCAT file URI.
  // Fall back to parsing the raw text directly so completions are available.
  const stCode = extraction.source.length > 0 || text.length === 0 ? extraction.source : text;
  const { ast } = parse(stCode);

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

  // 3. Standard FBs — filtered to libraries referenced by the document's project.
  //    If no project is found (standalone file), fall back to all stdlib symbols.
  const libRefs = workspaceIndex?.getLibraryRefs?.(params.textDocument.uri) ?? [];
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
  for (const { vd, constant } of vars) {
    items.push({
      label: vd.name,
      kind: CompletionItemKind.Variable,
      ...(constant && vd.initialValue
        ? { detail: `= ${formatConstantValue(vd.initialValue)}` }
        : {}),
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
        }
      }
    }
  }

  return items;
}
