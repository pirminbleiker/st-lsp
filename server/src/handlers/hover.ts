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
  EnumDeclaration,
  FunctionBlockDeclaration,
  MemberExpression,
  NameExpression,
  Pragma,
  SourceFile,
  StructDeclaration,
  TopLevelDeclaration,
  TypeDeclarationBlock,
  VarDeclaration,
  VarKind,
} from '../parser/ast';
import { collectVarDeclarations } from '../parser/astUtils';
import { findNodeAtPosition } from '../parser/visitor';
import { getOrParse } from './shared';
import { builtinTypeHover, findBuiltinType } from '../twincat/types';
import { findStandardFB, standardFBHover } from '../twincat/stdlib';
import { findSystemType, findSystemNamespaceMember } from '../twincat/systemTypes';
import { findPragmaDoc, pragmaHover } from '../twincat/pragmas';
import { WorkspaceIndex } from '../twincat/workspaceIndex';
import { LibrarySymbol, LibraryParam } from '../twincat/libraryZipReader';
import { formatConstantValue } from './utils';

// ---------------------------------------------------------------------------
// Hover markdown builders
// ---------------------------------------------------------------------------

function varDeclHover(vd: VarDeclaration, varKind: VarKind, qualifier?: string): string {
  const typeRef = vd.type;
  let typeName = typeRef.name;
  if (typeRef.isPointer) typeName = `POINTER TO ${typeName}`;
  else if (typeRef.isReference) typeName = `REFERENCE TO ${typeName}`;
  else if (typeRef.isArray && typeRef.arrayDims) {
    const dims = typeRef.arrayDims.map(d => `${d.low}..${d.high}`).join(', ');
    typeName = `ARRAY[${dims}] OF ${typeName}`;
  }
  let result = `\`${vd.name} : ${typeName}\``;

  if (qualifier === 'CONSTANT' && vd.initialValue) {
    result += ` = \`${formatConstantValue(vd.initialValue)}\``;
  }

  result += `\n\n*Block:* \`${varKind}${qualifier ? ` ${qualifier}` : ''}\``;

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
  const values = decl.values.map(v =>
    v.value ? `  ${v.name} := ${formatConstantValue(v.value)}` : `  ${v.name}`,
  ).join('\n');
  const baseTypeSuffix = decl.baseType ? ` : ${decl.baseType.name}` : '';
  return `**ENUM** \`${decl.name}${baseTypeSuffix}\`\n\`\`\`\n(\n${values}\n)\n\`\`\``;
}

function renderLibrarySymbolHover(
  symbol: LibrarySymbol,
  libraryVersion?: string,
  libraryVendor?: string,
): string {
  const lines: string[] = [];

  // Title with symbol kind and name
  lines.push(`**${symbol.kind === 'functionBlock' ? 'FUNCTION_BLOCK' : symbol.kind.toUpperCase()}** \`${symbol.name}\``);

  // Library metadata header
  if (libraryVersion || libraryVendor) {
    const parts = [];
    if (libraryVersion) parts.push(symbol.namespace);
    if (libraryVersion) parts.push(libraryVersion);
    const headerPart = parts.join(' ');
    const vendorPart = libraryVendor ? ` — ${libraryVendor}` : '';
    lines.push(`*${headerPart}${vendorPart}*`);
  } else if (symbol.namespace) {
    lines.push(`*${symbol.namespace}*`);
  }

  // Description
  if (symbol.description) {
    lines.push('');
    lines.push(symbol.description);
  }

  // Inheritance info
  if (symbol.extends || symbol.implements?.length) {
    lines.push('');
    if (symbol.extends) lines.push(`*Extends:* \`${symbol.extends}\``);
    if (symbol.implements?.length) {
      lines.push(`*Implements:* ${symbol.implements.map(i => `\`${i}\``).join(', ')}`);
    }
  }

  if (symbol.returnType) {
    lines.push(`*Returns:* \`${symbol.returnType}\``);
  }

  function renderParamTable(params: LibraryParam[], heading: string): void {
    lines.push('');
    lines.push(`**${heading}**`);

    // Check if any params have comments or if types are present
    const hasComments = params.some(p => p.comment);
    const hasTypes = params.some(p => p.type);

    if (hasComments && hasTypes) {
      lines.push('| Name | Type | Description |');
      lines.push('|------|------|-------------|');
      for (const p of params) {
        const type = p.type || 'ANY';
        const comment = p.comment || '';
        lines.push(`| \`${p.name}\` | \`${type}\` | ${comment} |`);
      }
    } else if (hasComments) {
      lines.push('| Name | Description |');
      lines.push('|------|-------------|');
      for (const p of params) {
        const comment = p.comment || '';
        lines.push(`| \`${p.name}\` | ${comment} |`);
      }
    } else if (hasTypes) {
      lines.push('| Name | Type |');
      lines.push('|------|------|');
      for (const p of params) {
        const type = p.type || 'ANY';
        lines.push(`| \`${p.name}\` | \`${type}\` |`);
      }
    } else {
      lines.push('| Name |');
      lines.push('|------|');
      for (const p of params) {
        lines.push(`| \`${p.name}\` |`);
      }
    }
  }

  if (symbol.inputs?.length) renderParamTable(symbol.inputs, 'VAR_INPUT');
  if (symbol.outputs?.length) renderParamTable(symbol.outputs, 'VAR_OUTPUT');
  if (symbol.inOuts?.length) renderParamTable(symbol.inOuts, 'VAR_IN_OUT');

  // Methods
  if (symbol.methods?.length) {
    lines.push('');
    lines.push(`**Methods** (${symbol.methods.length})`);
    // Show up to 15 methods, then truncate
    const shown = symbol.methods.slice(0, 15);
    for (const m of shown) {
      lines.push(`- \`${m.name}()\``);
    }
    if (symbol.methods.length > 15) {
      lines.push(`- *... and ${symbol.methods.length - 15} more*`);
    }
  }

  return lines.join('\n');
}

/**
 * Return hover markdown for a __SYSTEM.* qualified name, or null if not found.
 * Handles both namespace members (__SYSTEM.TYPE_CLASS) and enum values
 * (__SYSTEM.TYPE_CLASS.TYPE_BOOL).
 */
function systemNamespaceHover(qualifiedName: string): string | null {
  const member = findSystemNamespaceMember(qualifiedName);
  if (member) {
    if (member.kind === 'interface') {
      let value = `**INTERFACE** \`__SYSTEM.${member.name}\`\n\n*TwinCAT System Namespace*\n\n${member.description}`;
      if (member.methods?.length) {
        value += '\n\n**Methods**';
        for (const m of member.methods) {
          value += `\n- \`${m.name}()\`${m.returnType ? ` : \`${m.returnType}\`` : ''} — ${m.description}`;
        }
      }
      return value;
    }
    let value = `**ENUM** \`__SYSTEM.${member.name}\`\n\n*TwinCAT System Namespace*\n\n${member.description}`;
    if (member.values.length) {
      const vals = member.values.map(v => `  ${v.name}`).join('\n');
      value += `\n\`\`\`\n(\n${vals}\n)\n\`\`\``;
    }
    return value;
  }
  // Check for enum member (e.g. __SYSTEM.TYPE_CLASS.TYPE_BOOL)
  const dotParts = qualifiedName.split('.');
  if (dotParts.length === 3) {
    const parentMember = findSystemNamespaceMember(`${dotParts[0]}.${dotParts[1]}`);
    if (parentMember?.kind === 'enum') {
      const enumVal = parentMember.values.find(v => v.name.toUpperCase() === dotParts[2].toUpperCase());
      if (enumVal) {
        return `\`__SYSTEM.${parentMember.name}.${enumVal.name}\`\n\n*${parentMember.name} enum value*\n\n${enumVal.description}`;
      }
    }
  }
  return null;
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

  const { extraction, mapper, ast } = getOrParse(document!);

  const { line, character } = params.position;
  const extractedPos = mapper.originalToExtracted(line, character);
  if (!extractedPos) return null; // cursor on XML-only line
  const node = findNodeAtPosition(ast, extractedPos.line, extractedPos.character);
  if (!node) return null;

  /** Map an extracted-source node range to original-file coordinates. */
  const nodeRange = () => ({
    start: mapper.extractedToOriginal(node.range.start.line, node.range.start.character),
    end: mapper.extractedToOriginal(node.range.end.line, node.range.end.character),
  });

  // We handle Pragma nodes and NameExpression nodes
  if (node.kind === 'Pragma') {
    const pragma = node as Pragma;
    const doc = findPragmaDoc(pragma.name);
    const value = doc ? pragmaHover(doc) : `**\`${pragma.raw}\`**`;
    return {
      contents: { kind: MarkupKind.Markdown, value },
      range: nodeRange(),
    };
  }

  // Handle hovering directly on a variable declaration (inside a VAR block)
  if (node.kind === 'VarDeclaration') {
    const vd = node as VarDeclaration;
    // Determine which var block kind this declaration belongs to
    const varBlock = ast.declarations.flatMap(decl => {
      const pou = decl as { varBlocks?: import('../parser/ast').VarBlock[] };
      return pou.varBlocks ?? [];
    }).find(vb => vb.declarations.some((d: VarDeclaration) => d === vd));
    const varKind = varBlock?.varKind ?? 'VAR';
    return {
      contents: { kind: MarkupKind.Markdown, value: varDeclHover(vd, varKind, undefined) },
      range: {
        start: mapper.extractedToOriginal(vd.nameRange.start.line, vd.nameRange.start.character),
        end: mapper.extractedToOriginal(vd.nameRange.end.line, vd.nameRange.end.character),
      },
    };
  }

  // Handle MemberExpression for __SYSTEM.* hover (e.g. hovering on "TYPE_CLASS" in __SYSTEM.TYPE_CLASS)
  if (node.kind === 'MemberExpression') {
    const memberExpr = node as MemberExpression;
    // Build the full qualified name by walking the base chain
    const buildQualifiedName = (expr: MemberExpression): string | null => {
      if (expr.base.kind === 'NameExpression') {
        return `${(expr.base as NameExpression).name}.${expr.member}`;
      }
      if (expr.base.kind === 'MemberExpression') {
        const baseName = buildQualifiedName(expr.base as MemberExpression);
        return baseName ? `${baseName}.${expr.member}` : null;
      }
      return null;
    };
    const qualifiedName = buildQualifiedName(memberExpr);
    if (qualifiedName?.toUpperCase().startsWith('__SYSTEM.')) {
      const hoverValue = systemNamespaceHover(qualifiedName);
      if (hoverValue) {
        return { contents: { kind: MarkupKind.Markdown, value: hoverValue }, range: nodeRange() };
      }
    }
    return null;
  }

  // We only produce hover for NameExpression nodes (identifiers)
  if (node.kind !== 'NameExpression') return null;
  const name = (node as NameExpression).name;
  if (!name) return null;

  // 0. __SYSTEM namespace hover
  const upperName = name.toUpperCase();
  if (upperName === '__SYSTEM') {
    return {
      contents: {
        kind: MarkupKind.Markdown,
        value: '**NAMESPACE** `__SYSTEM`\n\n*TwinCAT built-in namespace*\n\nProvides runtime interfaces and type enumerations (IQueryInterface, TYPE_CLASS, ExceptionId).',
      },
      range: nodeRange(),
    };
  }
  if (upperName.startsWith('__SYSTEM.')) {
    const hoverValue = systemNamespaceHover(name);
    if (hoverValue) {
      return { contents: { kind: MarkupKind.Markdown, value: hoverValue }, range: nodeRange() };
    }
  }

  // 1. Check library symbols from workspace index
  if (workspaceIndex) {
    const libSymbols = workspaceIndex.getLibrarySymbols(params.textDocument.uri);
    const upperName = name.toUpperCase();
    const libSym = libSymbols.find(s => s.name.toUpperCase() === upperName);
    if (libSym) {
      // Look up library version and vendor from the document's library references
      let libVersion: string | undefined;
      let libVendor: string | undefined;
      const libRefs = workspaceIndex.getLibraryRefs(params.textDocument.uri);
      const libRef = libRefs.find(
        r => r.name.toUpperCase() === libSym.namespace.toUpperCase(),
      );
      if (libRef) {
        libVersion = libRef.version;
        libVendor = libRef.vendor;
      }

      return {
        contents: {
          kind: MarkupKind.Markdown,
          value: renderLibrarySymbolHover(libSym, libVersion, libVendor),
        },
        range: nodeRange(),
      };
    }
  }

  // 2. Built-in type?
  const builtinType = findBuiltinType(name);
  if (builtinType) {
    return {
      contents: { kind: MarkupKind.Markdown, value: builtinTypeHover(builtinType) },
      range: nodeRange(),
    };
  }

  // 2b. System type (TIMESTRUCT, FILETIME, etc.)?
  const sysType = findSystemType(name);
  if (sysType) {
    let value = `**STRUCT** \`${sysType.name}\`\n\n*TwinCAT System Type*\n\n${sysType.description}`;
    if (sysType.fields?.length) {
      const fields = sysType.fields.map(f => `  ${f.name} : ${f.type};`).join('\n');
      value += `\n\`\`\`\nSTRUCT\n${fields}\nEND_STRUCT\n\`\`\``;
    }
    return {
      contents: { kind: MarkupKind.Markdown, value },
      range: nodeRange(),
    };
  }

  // 3. Standard function block?
  const stdFB = findStandardFB(name);
  if (stdFB) {
    // Look up library version and vendor for standard FBs
    let libVersion: string | undefined;
    let libVendor: string | undefined;
    if (workspaceIndex) {
      const libRefs = workspaceIndex.getLibraryRefs(params.textDocument.uri);
      const libRef = libRefs.find(
        r => r.name.toUpperCase() === stdFB.namespace.toUpperCase(),
      );
      if (libRef) {
        libVersion = libRef.version;
        libVendor = libRef.vendor;
      }
    }

    // Convert StandardFB to hover format (shape-compatible with renderLibrarySymbolHover)
    const hoverText = renderLibrarySymbolHover(
      {
        name: stdFB.name,
        kind: 'functionBlock' as const,
        namespace: stdFB.namespace,
        description: stdFB.description,
        inputs: stdFB.inputs.map(p => ({
          name: p.name,
          type: p.type,
          direction: 'input' as const,
          comment: p.description,
        })),
        outputs: stdFB.outputs.map(p => ({
          name: p.name,
          type: p.type,
          direction: 'output' as const,
          comment: p.description,
        })),
      },
      libVersion,
      libVendor,
    );

    // Warn if the library is not referenced by the document's project
    let finalText = hoverText;
    if (workspaceIndex && libVersion === undefined) {
      const libRefs = workspaceIndex.getLibraryRefs(params.textDocument.uri);
      if (libRefs.length > 0 && stdFB.namespace) {
        const referenced = libRefs.some(
          (r) => r.name.toUpperCase() === stdFB.namespace.toUpperCase(),
        );
        if (!referenced) {
          finalText += `\n\n> ⚠️ Library \`${stdFB.namespace}\` is not referenced in this project.`;
        }
      }
    }

    return {
      contents: { kind: MarkupKind.Markdown, value: finalText },
      range: nodeRange(),
    };
  }

  // 4. VarDeclaration in scope?
  const vars = collectVarDeclarations(ast, extractedPos);
  const varMatch = vars.find(v => v.vd.name.toUpperCase() === name.toUpperCase());
  if (varMatch) {
    return {
      contents: { kind: MarkupKind.Markdown, value: varDeclHover(varMatch.vd, varMatch.varKind, varMatch.qualifier) },
      range: nodeRange(),
    };
  }

  // 5. POU declaration?
  const pouDecl = ast.declarations.find(
    d => 'name' in d && (d as { name: string }).name.toUpperCase() === name.toUpperCase(),
  );
  if (pouDecl) {
    return {
      contents: { kind: MarkupKind.Markdown, value: pouHover(pouDecl) },
      range: nodeRange(),
    };
  }

  // 5a. Action declaration inside a FUNCTION_BLOCK?
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
        range: nodeRange(),
      };
    }
  }

  // 6. Struct or enum declaration inside TYPE...END_TYPE blocks?
  for (const decl of ast.declarations) {
    if (decl.kind !== 'TypeDeclarationBlock') continue;
    const typeBlock = decl as TypeDeclarationBlock;
    for (const typeDecl of typeBlock.declarations) {
      if (typeDecl.name.toUpperCase() !== name.toUpperCase()) continue;
      if (typeDecl.kind === 'StructDeclaration') {
        return {
          contents: { kind: MarkupKind.Markdown, value: structHover(typeDecl as StructDeclaration) },
          range: nodeRange(),
        };
      }
      if (typeDecl.kind === 'EnumDeclaration') {
        return {
          contents: { kind: MarkupKind.Markdown, value: enumHover(typeDecl as EnumDeclaration) },
          range: nodeRange(),
        };
      }
    }
  }

  return null;
}
