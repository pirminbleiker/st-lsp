import {
  WorkspaceSymbol,
  WorkspaceSymbolParams,
  SymbolKind,
  Range,
} from 'vscode-languageserver/node';
import { WorkspaceIndex } from '../twincat/workspaceIndex';
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

const MAX_SYMBOLS = 100;

export function handleWorkspaceSymbol(
  params: WorkspaceSymbolParams,
  index: WorkspaceIndex | undefined,
): WorkspaceSymbol[] {
  if (!index) return [];

  const query = params.query.toLowerCase();
  const results: WorkspaceSymbol[] = [];

  for (const uri of index.getProjectFiles()) {
    if (results.length >= MAX_SYMBOLS) break;
    const cached = index.getAst(uri);
    if (!cached) continue;
    collectSymbols(cached.ast, uri, query, results);
  }

  return results;
}

function matches(name: string, query: string): boolean {
  return query === '' || name.toLowerCase().includes(query);
}

function astRangeToLsp(range: import('../parser/ast').Range): Range {
  return {
    start: { line: range.start.line, character: range.start.character },
    end: { line: range.end.line, character: range.end.character },
  };
}

function collectSymbols(
  ast: SourceFile,
  uri: string,
  query: string,
  results: WorkspaceSymbol[],
): void {
  for (const decl of ast.declarations) {
    if (results.length >= MAX_SYMBOLS) return;

    if (decl.kind === 'ProgramDeclaration') {
      const prog = decl as ProgramDeclaration;
      if (matches(prog.name, query)) {
        results.push({ name: prog.name, kind: SymbolKind.Module, location: { uri, range: astRangeToLsp(prog.range) } });
      }
      addGlobalVars(prog.varBlocks, uri, query, results);

    } else if (decl.kind === 'FunctionBlockDeclaration') {
      const fb = decl as FunctionBlockDeclaration;
      if (matches(fb.name, query)) {
        results.push({ name: fb.name, kind: SymbolKind.Class, location: { uri, range: astRangeToLsp(fb.range) } });
      }
      for (const method of fb.methods) {
        if (results.length >= MAX_SYMBOLS) return;
        if (matches(method.name, query)) {
          results.push({ name: method.name, kind: SymbolKind.Method, location: { uri, range: astRangeToLsp(method.range) } });
        }
      }
      addGlobalVars(fb.varBlocks, uri, query, results);

    } else if (decl.kind === 'FunctionDeclaration') {
      const fn = decl as FunctionDeclaration;
      if (matches(fn.name, query)) {
        results.push({ name: fn.name, kind: SymbolKind.Function, location: { uri, range: astRangeToLsp(fn.range) } });
      }
      addGlobalVars(fn.varBlocks, uri, query, results);

    } else if (decl.kind === 'InterfaceDeclaration') {
      const iface = decl as InterfaceDeclaration;
      if (matches(iface.name, query)) {
        results.push({ name: iface.name, kind: SymbolKind.Interface, location: { uri, range: astRangeToLsp(iface.range) } });
      }
      for (const method of iface.methods) {
        if (results.length >= MAX_SYMBOLS) return;
        if (matches(method.name, query)) {
          results.push({ name: method.name, kind: SymbolKind.Method, location: { uri, range: astRangeToLsp(method.range) } });
        }
      }

    } else if (decl.kind === 'TypeDeclarationBlock') {
      const typeBlock = decl as TypeDeclarationBlock;
      for (const typeDecl of typeBlock.declarations) {
        if (results.length >= MAX_SYMBOLS) return;
        if (typeDecl.kind === 'StructDeclaration') {
          const struct = typeDecl as StructDeclaration;
          if (matches(struct.name, query)) {
            results.push({ name: struct.name, kind: SymbolKind.Struct, location: { uri, range: astRangeToLsp(struct.range) } });
          }
        } else if (typeDecl.kind === 'EnumDeclaration') {
          const enumDecl = typeDecl as EnumDeclaration;
          if (matches(enumDecl.name, query)) {
            results.push({ name: enumDecl.name, kind: SymbolKind.Enum, location: { uri, range: astRangeToLsp(enumDecl.range) } });
          }
        } else if (typeDecl.kind === 'AliasDeclaration') {
          const alias = typeDecl as AliasDeclaration;
          if (matches(alias.name, query)) {
            results.push({ name: alias.name, kind: SymbolKind.TypeParameter, location: { uri, range: astRangeToLsp(alias.range) } });
          }
        }
      }
    }
  }
}

function addGlobalVars(
  varBlocks: VarBlock[],
  uri: string,
  query: string,
  results: WorkspaceSymbol[],
): void {
  for (const vb of varBlocks) {
    if (vb.varKind !== 'VAR_GLOBAL') continue;
    for (const vd of vb.declarations) {
      if (results.length >= MAX_SYMBOLS) return;
      if (matches(vd.name, query)) {
        results.push({ name: vd.name, kind: SymbolKind.Variable, location: { uri, range: astRangeToLsp(vd.range) } });
      }
    }
  }
}
