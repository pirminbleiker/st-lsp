import {
  DocumentSymbol,
  DocumentSymbolParams,
  SymbolKind,
  Range,
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { PositionMapper } from '../twincat/tcExtractor';
import { getOrParse } from './shared';
import {
  SourceFile,
  ProgramDeclaration,
  FunctionBlockDeclaration,
  FunctionDeclaration,
  InterfaceDeclaration,
  TypeDeclarationBlock,
  StructDeclaration,
  EnumDeclaration,
  AliasDeclaration,
  UnionDeclaration,
  VarBlock,
} from '../parser/ast';

export function handleDocumentSymbols(
  params: DocumentSymbolParams,
  document: TextDocument | undefined,
): DocumentSymbol[] {
  if (!document) return [];
  const { mapper, ast } = getOrParse(document!);
  return buildSymbols(ast, mapper);
}

function astRangeToLsp(range: import('../parser/ast').Range, mapper: PositionMapper): Range {
  return {
    start: mapper.extractedToOriginal(range.start.line, range.start.character),
    end: mapper.extractedToOriginal(range.end.line, range.end.character),
  };
}

function formatTypeName(type: import('../parser/ast').TypeRef): string {
  if (type.isPointer) return `POINTER TO ${type.name}`;
  if (type.isArray && type.arrayDims) {
    const dims = type.arrayDims.map(d => `${d.low}..${d.high}`).join(', ');
    return `ARRAY[${dims}] OF ${type.name}`;
  }
  return type.name;
}

function varBlocksToSymbols(varBlocks: VarBlock[], mapper: PositionMapper): DocumentSymbol[] {
  const symbols: DocumentSymbol[] = [];
  for (const vb of varBlocks) {
    if (vb.declarations.length === 0) continue;
    const children: DocumentSymbol[] = vb.declarations.map(vd => ({
      name: vd.name,
      kind: SymbolKind.Variable,
      range: astRangeToLsp(vd.range, mapper),
      selectionRange: astRangeToLsp(vd.range, mapper),
      detail: formatTypeName(vd.type),
    }));
    symbols.push({
      name: vb.varKind,
      kind: SymbolKind.Variable,
      range: astRangeToLsp(vb.range, mapper),
      selectionRange: astRangeToLsp(vb.range, mapper),
      children,
    });
  }
  return symbols;
}

function buildSymbols(ast: SourceFile, mapper: PositionMapper): DocumentSymbol[] {
  const result: DocumentSymbol[] = [];

  for (const decl of ast.declarations) {
    if (decl.kind === 'ProgramDeclaration') {
      const prog = decl as ProgramDeclaration;
      const varSymbols = varBlocksToSymbols(prog.varBlocks, mapper);
      result.push({
        name: prog.name,
        kind: SymbolKind.Module,
        range: astRangeToLsp(prog.range, mapper),
        selectionRange: astRangeToLsp(prog.range, mapper),
        children: varSymbols.length > 0 ? varSymbols : undefined,
      });
    } else if (decl.kind === 'FunctionBlockDeclaration') {
      const fb = decl as FunctionBlockDeclaration;
      const detail = fb.extends ? `EXTENDS ${fb.extends}` : undefined;
      const children: DocumentSymbol[] = [];

      // Var declarations
      children.push(...varBlocksToSymbols(fb.varBlocks, mapper));

      // Methods
      for (const method of fb.methods) {
        children.push({
          name: method.name,
          kind: SymbolKind.Method,
          range: astRangeToLsp(method.range, mapper),
          selectionRange: astRangeToLsp(method.range, mapper),
          detail: method.returnType ? `: ${method.returnType.name}` : undefined,
        });
      }

      // Actions
      for (const action of fb.actions) {
        children.push({
          name: action.name,
          kind: SymbolKind.Method,
          range: astRangeToLsp(action.range, mapper),
          selectionRange: astRangeToLsp(action.range, mapper),
        });
      }

      // Properties
      for (const prop of fb.properties) {
        children.push({
          name: prop.name,
          kind: SymbolKind.Property,
          range: astRangeToLsp(prop.range, mapper),
          selectionRange: astRangeToLsp(prop.range, mapper),
          detail: prop.type.name,
        });
      }

      result.push({
        name: fb.name,
        kind: SymbolKind.Class,
        range: astRangeToLsp(fb.range, mapper),
        selectionRange: astRangeToLsp(fb.range, mapper),
        detail,
        children: children.length > 0 ? children : undefined,
      });
    } else if (decl.kind === 'FunctionDeclaration') {
      const fn = decl as FunctionDeclaration;
      const detail = fn.returnType ? `: ${fn.returnType.name}` : undefined;
      const varSymbols = varBlocksToSymbols(fn.varBlocks, mapper);
      result.push({
        name: fn.name,
        kind: SymbolKind.Function,
        range: astRangeToLsp(fn.range, mapper),
        selectionRange: astRangeToLsp(fn.range, mapper),
        detail,
        children: varSymbols.length > 0 ? varSymbols : undefined,
      });
    } else if (decl.kind === 'InterfaceDeclaration') {
      const iface = decl as InterfaceDeclaration;
      const children: DocumentSymbol[] = [];

      // Methods
      for (const method of iface.methods) {
        children.push({
          name: method.name,
          kind: SymbolKind.Method,
          range: astRangeToLsp(method.range, mapper),
          selectionRange: astRangeToLsp(method.range, mapper),
          detail: method.returnType ? `: ${method.returnType.name}` : undefined,
        });
      }

      // Properties
      for (const prop of iface.properties) {
        children.push({
          name: prop.name,
          kind: SymbolKind.Property,
          range: astRangeToLsp(prop.range, mapper),
          selectionRange: astRangeToLsp(prop.range, mapper),
          detail: prop.type.name,
        });
      }

      result.push({
        name: iface.name,
        kind: SymbolKind.Interface,
        range: astRangeToLsp(iface.range, mapper),
        selectionRange: astRangeToLsp(iface.range, mapper),
        children: children.length > 0 ? children : undefined,
      });
    } else if (decl.kind === 'TypeDeclarationBlock') {
      const typeBlock = decl as TypeDeclarationBlock;
      for (const typeDecl of typeBlock.declarations) {
        if (typeDecl.kind === 'StructDeclaration') {
          const struct = typeDecl as StructDeclaration;
          const fieldSymbols: DocumentSymbol[] = struct.fields.map(field => ({
            name: field.name,
            kind: SymbolKind.Field,
            range: astRangeToLsp(field.range, mapper),
            selectionRange: astRangeToLsp(field.range, mapper),
            detail: formatTypeName(field.type),
          }));
          result.push({
            name: struct.name,
            kind: SymbolKind.Struct,
            range: astRangeToLsp(struct.range, mapper),
            selectionRange: astRangeToLsp(struct.range, mapper),
            children: fieldSymbols.length > 0 ? fieldSymbols : undefined,
          });
        } else if (typeDecl.kind === 'EnumDeclaration') {
          const enumDecl = typeDecl as EnumDeclaration;
          const enumMembers: DocumentSymbol[] = enumDecl.values.map(ev => ({
            name: ev.name,
            kind: SymbolKind.EnumMember,
            range: astRangeToLsp(ev.range, mapper),
            selectionRange: astRangeToLsp(ev.range, mapper),
          }));
          result.push({
            name: enumDecl.name,
            kind: SymbolKind.Enum,
            range: astRangeToLsp(enumDecl.range, mapper),
            selectionRange: astRangeToLsp(enumDecl.range, mapper),
            children: enumMembers.length > 0 ? enumMembers : undefined,
          });
        } else if (typeDecl.kind === 'AliasDeclaration') {
          const alias = typeDecl as AliasDeclaration;
          result.push({
            name: alias.name,
            kind: SymbolKind.TypeParameter,
            range: astRangeToLsp(alias.range, mapper),
            selectionRange: astRangeToLsp(alias.range, mapper),
            detail: `= ${alias.type.name}`,
          });
        } else if (typeDecl.kind === 'UnionDeclaration') {
          const union = typeDecl as UnionDeclaration;
          const fieldSymbols: DocumentSymbol[] = union.fields.map(field => ({
            name: field.name,
            kind: SymbolKind.Field,
            range: astRangeToLsp(field.range, mapper),
            selectionRange: astRangeToLsp(field.range, mapper),
            detail: formatTypeName(field.type),
          }));
          result.push({
            name: union.name,
            kind: SymbolKind.Struct,
            range: astRangeToLsp(union.range, mapper),
            selectionRange: astRangeToLsp(union.range, mapper),
            children: fieldSymbols.length > 0 ? fieldSymbols : undefined,
          });
        }
      }
    }
  }

  return result;
}
