/**
 * Member resolution for dot-access completion.
 *
 * Resolves types through EXTENDS chains, struct fields, interfaces,
 * aliases, unions, programs, library symbols, and system types.
 */

import * as fs from 'fs';
import {
  CompletionItem,
  CompletionItemKind,
} from 'vscode-languageserver/node';
import {
  FunctionBlockDeclaration,
  GvlDeclaration,
  InterfaceDeclaration,
  ProgramDeclaration,
  StructDeclaration,
  EnumDeclaration,
  UnionDeclaration,
  AliasDeclaration,
  TopLevelDeclaration,
  TypeDeclarationBlock,
  VarDeclaration,
} from '../parser/ast';
import { findStandardFB } from '../twincat/stdlib';
import { findSystemType, SYSTEM_NAMESPACE_MEMBERS, findSystemNamespaceMember, SystemNamespaceMember } from '../twincat/systemTypes';
import { WorkspaceIndex } from '../twincat/workspaceIndex';
import { LibrarySymbol } from '../twincat/libraryZipReader';
import { parse } from '../parser/parser';
import { extractStFromTwinCAT } from '../twincat/tcExtractor';
import { formatConstantValue } from './utils';
import { loadWorkspaceDeclarations } from './shared';

/** VAR kinds visible to external callers of a FUNCTION_BLOCK. */
const EXTERNAL_VISIBLE_VAR_KINDS = new Set(['VAR_INPUT', 'VAR_OUTPUT', 'VAR_IN_OUT']);

/** Access modifiers that block external visibility. */
const PRIVATE_MODIFIERS = new Set(['PRIVATE', 'PROTECTED']);

/**
 * Check whether a method or property is visible from a given access context.
 * In TwinCAT, the default visibility (no modifier) for methods/properties is PUBLIC.
 */
export function isMemberVisible(
  modifiers: string[],
  context: 'external' | 'this' | 'super' | 'local',
): boolean {
  switch (context) {
    case 'external': {
      // Reject PRIVATE and PROTECTED members
      for (const m of modifiers) {
        if (PRIVATE_MODIFIERS.has(m.toUpperCase())) return false;
      }
      return true;
    }
    case 'super': {
      // Reject PRIVATE members; allow PROTECTED, PUBLIC, INTERNAL
      for (const m of modifiers) {
        if (m.toUpperCase() === 'PRIVATE') return false;
      }
      return true;
    }
    case 'this':
    case 'local':
      // All members visible from own scope
      return true;
  }
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
  for (const { declarations: decls } of loadWorkspaceDeclarations(currentUri, workspaceIndex)) {
    sets.push(decls);
  }
  return sets;
}

/**
 * Collect members (VAR_OUTPUT, VAR_IN_OUT, non-PRIVATE non-FINAL methods and
 * properties) from the FB named `fbName`, searching `declarations` and the
 * workspace index.  Walks the EXTENDS chain recursively up to `maxDepth`.
 */
export function getSuperMembers(
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

      // All var kinds are accessible via SUPER^ (inherited state)
      for (const vb of fb.varBlocks) {
        for (const vd of vb.declarations) {
          items.push({ label: vd.name, kind: CompletionItemKind.Field, detail: vd.type.name });
        }
      }

      // Methods — filter by 'super' visibility (excludes PRIVATE)
      for (const method of fb.methods) {
        if (!isMemberVisible(method.modifiers, 'super')) continue;
        items.push({
          label: method.name,
          kind: CompletionItemKind.Method,
          detail: method.returnType?.name ?? 'void',
        });
      }

      // Properties — filter by 'super' visibility (excludes PRIVATE)
      for (const prop of fb.properties) {
        if (!isMemberVisible(prop.modifiers, 'super')) continue;
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

  // Fall back to library symbols if parent not found in declarations
  if (workspaceIndex) {
    const libSymbols = workspaceIndex.getLibrarySymbols(currentUri);
    const libSymbol = libSymbols.find(s => s.name.toUpperCase() === upperName);
    if (libSymbol) {
      return getMembersFromLibrarySymbol(libSymbol, libSymbols);
    }
  }

  return [];
}

/**
 * Find an EnumDeclaration by type name, searching local declarations then workspace index.
 */
export function findEnumDeclaration(
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
export function enumValuesToCompletionItems(enumDecl: EnumDeclaration): CompletionItem[] {
  return enumDecl.values.map(v => ({
    label: `${enumDecl.name}.${v.name}`,
    kind: CompletionItemKind.EnumMember,
    detail: v.value
      ? `${enumDecl.name} enum value = ${formatConstantValue(v.value)}`
      : `${enumDecl.name} enum value`,
  }));
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
function getMembersFromLibrarySymbol(
  symbol: LibrarySymbol,
  allLibSymbols: LibrarySymbol[] = [],
  visited: Set<string> = new Set(),
): CompletionItem[] {
  const upperName = symbol.name.toUpperCase();
  if (visited.has(upperName)) return [];
  visited.add(upperName);

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

  // Walk EXTENDS chain for inherited members
  if (symbol.extends && allLibSymbols.length > 0) {
    const upperParent = symbol.extends.toUpperCase();
    const parentSymbol = allLibSymbols.find(s => s.name.toUpperCase() === upperParent);
    if (parentSymbol) {
      const parentItems = getMembersFromLibrarySymbol(parentSymbol, allLibSymbols, visited);
      for (const pi of parentItems) {
        if (!items.some(i => i.label === pi.label)) items.push(pi);
      }
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
export function getMembersFromDeclarations(
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
          if (!isMemberVisible(method.modifiers, 'external')) continue;
          items.push({
            label: method.name,
            kind: CompletionItemKind.Method,
            detail: method.returnType?.name ?? 'void',
          });
        }
        for (const prop of fb.properties) {
          if (!isMemberVisible(prop.modifiers, 'external')) continue;
          items.push({ label: prop.name, kind: CompletionItemKind.Property, detail: prop.type.name });
        }
        if (fb.extendsRef) {
          let parentItems = getMembersFromDeclarations(
            fb.extendsRef.name, declarations, currentUri, workspaceIndex, visited,
          );
          // Fall back to library symbols if parent not found in declarations
          if (!parentItems && workspaceIndex) {
            const libSymbols = workspaceIndex.getLibrarySymbols(currentUri ?? '');
            const upperParent = fb.extendsRef.name.toUpperCase();
            const parentLib = libSymbols.find(s => s.name.toUpperCase() === upperParent);
            if (parentLib) {
              parentItems = getMembersFromLibrarySymbol(parentLib, libSymbols);
            }
          }
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
          let parentItems = getMembersFromDeclarations(
            extRef.name, declarations, currentUri, workspaceIndex, visited,
          );
          // Fall back to library symbols if parent not found in declarations
          if (!parentItems && workspaceIndex) {
            const libSymbols = workspaceIndex.getLibrarySymbols(currentUri ?? '');
            const upperParent = extRef.name.toUpperCase();
            const parentLib = libSymbols.find(s => s.name.toUpperCase() === upperParent);
            if (parentLib) {
              parentItems = getMembersFromLibrarySymbol(parentLib, libSymbols);
            }
          }
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
              let parentItems = getMembersFromDeclarations(
                struct.extendsRef.name, declarations, currentUri, workspaceIndex, visited,
              );
              // Fall back to library symbols if parent not found in declarations
              if (!parentItems && workspaceIndex) {
                const libSymbols = workspaceIndex.getLibrarySymbols(currentUri ?? '');
                const upperParent = struct.extendsRef.name.toUpperCase();
                const parentLib = libSymbols.find(s => s.name.toUpperCase() === upperParent);
                if (parentLib) {
                  parentItems = getMembersFromLibrarySymbol(parentLib, libSymbols);
                }
              }
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
 * Return completion items for members of a __SYSTEM namespace member.
 * For enums, returns enum values; for interfaces, returns methods.
 */
function getSystemNamespaceMemberCompletions(member: SystemNamespaceMember): CompletionItem[] {
  if (member.kind === 'enum') {
    return member.values.map(v => ({
      label: v.name,
      kind: CompletionItemKind.EnumMember,
      detail: `${member.name}.${v.name}`,
      documentation: v.description,
    }));
  }
  if (member.kind === 'interface' && member.methods) {
    return member.methods.map(m => ({
      label: m.name,
      kind: CompletionItemKind.Method,
      detail: m.returnType ?? 'void',
      documentation: m.description,
    }));
  }
  return [];
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
export function getDotAccessMembers(
  expression: string,
  vars: VarDeclaration[],
  declarations: TopLevelDeclaration[],
  currentUri: string,
  workspaceIndex?: WorkspaceIndex,
): CompletionItem[] | null {
  const parts = expression.split('.');

  // Handle __SYSTEM namespace: __SYSTEM. → list namespace members,
  // __SYSTEM.TYPE_CLASS. → list enum values, etc.
  if (parts[0].toUpperCase() === '__SYSTEM') {
    if (parts.length === 1) {
      // __SYSTEM. → list all namespace members
      return SYSTEM_NAMESPACE_MEMBERS.map(m => ({
        label: m.name,
        kind: m.kind === 'enum' ? CompletionItemKind.Enum : CompletionItemKind.Interface,
        detail: m.description,
      }));
    }
    // __SYSTEM.TYPE_CLASS. → resolve the member and return its children
    const qualifiedName = `__SYSTEM.${parts[1]}`;
    const member = findSystemNamespaceMember(qualifiedName);
    if (!member) return null;
    if (parts.length === 2) {
      return getSystemNamespaceMemberCompletions(member);
    }
    // Deeper chains not supported for __SYSTEM (enum values are terminal)
    return null;
  }

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
            return getMembersFromLibrarySymbol(libSymbol, libSymbols);
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
      return getMembersFromLibrarySymbol(libSymbol, libSymbols);
    }
  }

  return getMembersFromDeclarations(typeName, declarations, currentUri, workspaceIndex);
}

export function buildLibrarySymbolDoc(symbol: LibrarySymbol): string {
  const parts: string[] = [];
  if (symbol.extends) parts.push(`EXTENDS ${symbol.extends}`);
  if (symbol.implements?.length) parts.push(`IMPLEMENTS ${symbol.implements.join(', ')}`);
  if (symbol.returnType) parts.push(`Returns: ${symbol.returnType}`);
  if (symbol.inputs?.length) {
    parts.push('VAR_INPUT: ' + symbol.inputs.map(p => `${p.name} : ${p.type || 'ANY'}`).join(', '));
  }
  return parts.join('\n');
}
