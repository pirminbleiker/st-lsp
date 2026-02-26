import {
  DocumentSymbol,
  DocumentSymbolParams,
  SymbolKind,
  Range,
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
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
  VarBlock,
} from '../parser/ast';
import { parse } from '../parser/parser';

export function handleDocumentSymbols(
  params: DocumentSymbolParams,
  document: TextDocument | undefined,
): DocumentSymbol[] {
  if (!document) return [];
  const { ast } = parse(document.getText());
  return buildSymbols(ast);
}

function astRangeToLsp(range: import('../parser/ast').Range): Range {
  return {
    start: { line: range.start.line, character: range.start.character },
    end: { line: range.end.line, character: range.end.character },
  };
}

function varBlocksToSymbols(varBlocks: VarBlock[]): DocumentSymbol[] {
  const symbols: DocumentSymbol[] = [];
  for (const vb of varBlocks) {
    for (const vd of vb.declarations) {
      let typeName = vd.type.name;
      if (vd.type.isPointer) typeName = `POINTER TO ${typeName}`;
      else if (vd.type.isArray && vd.type.arrayDims) {
        const dims = vd.type.arrayDims.map(d => `${d.low}..${d.high}`).join(', ');
        typeName = `ARRAY[${dims}] OF ${typeName}`;
      }
      symbols.push({
        name: vd.name,
        kind: SymbolKind.Variable,
        range: astRangeToLsp(vd.range),
        selectionRange: astRangeToLsp(vd.range),
        detail: typeName,
      });
    }
  }
  return symbols;
}

function buildSymbols(ast: SourceFile): DocumentSymbol[] {
  const result: DocumentSymbol[] = [];

  for (const decl of ast.declarations) {
    if (decl.kind === 'ProgramDeclaration') {
      const prog = decl as ProgramDeclaration;
      const varSymbols = varBlocksToSymbols(prog.varBlocks);
      result.push({
        name: prog.name,
        kind: SymbolKind.Module,
        range: astRangeToLsp(prog.range),
        selectionRange: astRangeToLsp(prog.range),
        children: varSymbols.length > 0 ? varSymbols : undefined,
      });
    } else if (decl.kind === 'FunctionBlockDeclaration') {
      const fb = decl as FunctionBlockDeclaration;
      const detail = fb.extends ? `EXTENDS ${fb.extends}` : undefined;
      const children: DocumentSymbol[] = [];

      // Var declarations
      children.push(...varBlocksToSymbols(fb.varBlocks));

      // Methods
      for (const method of fb.methods) {
        children.push({
          name: method.name,
          kind: SymbolKind.Method,
          range: astRangeToLsp(method.range),
          selectionRange: astRangeToLsp(method.range),
          detail: method.returnType ? `: ${method.returnType.name}` : undefined,
        });
      }

      // Properties
      for (const prop of fb.properties) {
        children.push({
          name: prop.name,
          kind: SymbolKind.Property,
          range: astRangeToLsp(prop.range),
          selectionRange: astRangeToLsp(prop.range),
          detail: prop.type.name,
        });
      }

      result.push({
        name: fb.name,
        kind: SymbolKind.Class,
        range: astRangeToLsp(fb.range),
        selectionRange: astRangeToLsp(fb.range),
        detail,
        children: children.length > 0 ? children : undefined,
      });
    } else if (decl.kind === 'FunctionDeclaration') {
      const fn = decl as FunctionDeclaration;
      const detail = fn.returnType ? `: ${fn.returnType.name}` : undefined;
      const varSymbols = varBlocksToSymbols(fn.varBlocks);
      result.push({
        name: fn.name,
        kind: SymbolKind.Function,
        range: astRangeToLsp(fn.range),
        selectionRange: astRangeToLsp(fn.range),
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
          range: astRangeToLsp(method.range),
          selectionRange: astRangeToLsp(method.range),
          detail: method.returnType ? `: ${method.returnType.name}` : undefined,
        });
      }

      // Properties
      for (const prop of iface.properties) {
        children.push({
          name: prop.name,
          kind: SymbolKind.Property,
          range: astRangeToLsp(prop.range),
          selectionRange: astRangeToLsp(prop.range),
          detail: prop.type.name,
        });
      }

      result.push({
        name: iface.name,
        kind: SymbolKind.Interface,
        range: astRangeToLsp(iface.range),
        selectionRange: astRangeToLsp(iface.range),
        children: children.length > 0 ? children : undefined,
      });
    } else if (decl.kind === 'TypeDeclarationBlock') {
      const typeBlock = decl as TypeDeclarationBlock;
      for (const typeDecl of typeBlock.declarations) {
        if (typeDecl.kind === 'StructDeclaration') {
          const struct = typeDecl as StructDeclaration;
          const fieldSymbols: DocumentSymbol[] = struct.fields.map(field => {
            let typeName = field.type.name;
            if (field.type.isPointer) typeName = `POINTER TO ${typeName}`;
            else if (field.type.isArray && field.type.arrayDims) {
              const dims = field.type.arrayDims.map(d => `${d.low}..${d.high}`).join(', ');
              typeName = `ARRAY[${dims}] OF ${typeName}`;
            }
            return {
              name: field.name,
              kind: SymbolKind.Field,
              range: astRangeToLsp(field.range),
              selectionRange: astRangeToLsp(field.range),
              detail: typeName,
            };
          });
          result.push({
            name: struct.name,
            kind: SymbolKind.Struct,
            range: astRangeToLsp(struct.range),
            selectionRange: astRangeToLsp(struct.range),
            children: fieldSymbols.length > 0 ? fieldSymbols : undefined,
          });
        } else if (typeDecl.kind === 'EnumDeclaration') {
          const enumDecl = typeDecl as EnumDeclaration;
          const enumMembers: DocumentSymbol[] = enumDecl.values.map(ev => ({
            name: ev.name,
            kind: SymbolKind.EnumMember,
            range: astRangeToLsp(ev.range),
            selectionRange: astRangeToLsp(ev.range),
          }));
          result.push({
            name: enumDecl.name,
            kind: SymbolKind.Enum,
            range: astRangeToLsp(enumDecl.range),
            selectionRange: astRangeToLsp(enumDecl.range),
            children: enumMembers.length > 0 ? enumMembers : undefined,
          });
        } else if (typeDecl.kind === 'AliasDeclaration') {
          const alias = typeDecl as AliasDeclaration;
          result.push({
            name: alias.name,
            kind: SymbolKind.TypeParameter,
            range: astRangeToLsp(alias.range),
            selectionRange: astRangeToLsp(alias.range),
            detail: `= ${alias.type.name}`,
          });
        }
      }
    }
  }

  return result;
}
