import { describe, it, expect, vi } from 'vitest';
import { handleWorkspaceSymbol } from '../handlers/workspaceSymbol';
import { SymbolKind } from 'vscode-languageserver/node';
import { WorkspaceIndex } from '../twincat/workspaceIndex';
import { parse } from '../parser/parser';

function makeIndex(files: Record<string, string>): WorkspaceIndex {
  const uris = Object.keys(files);
  const index = {
    getProjectFiles: () => uris,
    getAst: (uri: string) => {
      const text = files[uri];
      if (text === undefined) return undefined;
      return parse(text);
    },
  } as unknown as WorkspaceIndex;
  return index;
}

function makeParams(query: string) {
  return { query };
}

describe('handleWorkspaceSymbol', () => {
  it('returns empty array when index is undefined', () => {
    expect(handleWorkspaceSymbol(makeParams(''), undefined)).toEqual([]);
  });

  it('returns empty array for empty workspace', () => {
    const index = makeIndex({});
    expect(handleWorkspaceSymbol(makeParams(''), index)).toEqual([]);
  });

  it('returns empty array when getAst returns undefined', () => {
    const index = {
      getProjectFiles: () => ['file:///missing.st'],
      getAst: () => undefined,
    } as unknown as WorkspaceIndex;
    expect(handleWorkspaceSymbol(makeParams(''), index)).toEqual([]);
  });

  describe('PROGRAM → Module', () => {
    it('returns Module symbol for PROGRAM', () => {
      const index = makeIndex({
        'file:///main.st': 'PROGRAM Main\nEND_PROGRAM',
      });
      const symbols = handleWorkspaceSymbol(makeParams(''), index);
      expect(symbols).toHaveLength(1);
      expect(symbols[0].name).toBe('Main');
      expect(symbols[0].kind).toBe(SymbolKind.Module);
      expect(symbols[0].location.uri).toBe('file:///main.st');
    });
  });

  describe('FUNCTION_BLOCK → Class', () => {
    it('returns Class symbol for FUNCTION_BLOCK', () => {
      const index = makeIndex({
        'file:///fb.st': 'FUNCTION_BLOCK FB_Valve\nEND_FUNCTION_BLOCK',
      });
      const symbols = handleWorkspaceSymbol(makeParams(''), index);
      expect(symbols).toHaveLength(1);
      expect(symbols[0].name).toBe('FB_Valve');
      expect(symbols[0].kind).toBe(SymbolKind.Class);
    });

    it('returns Method symbols for FB methods', () => {
      const index = makeIndex({
        'file:///fb.st': 'FUNCTION_BLOCK FB_Motor\nMETHOD Start : BOOL\nEND_METHOD\nEND_FUNCTION_BLOCK',
      });
      const symbols = handleWorkspaceSymbol(makeParams(''), index);
      const method = symbols.find(s => s.name === 'Start');
      expect(method).toBeDefined();
      expect(method!.kind).toBe(SymbolKind.Method);
    });
  });

  describe('FUNCTION → Function', () => {
    it('returns Function symbol', () => {
      const index = makeIndex({
        'file:///fn.st': 'FUNCTION Add : INT\nEND_FUNCTION',
      });
      const symbols = handleWorkspaceSymbol(makeParams(''), index);
      expect(symbols).toHaveLength(1);
      expect(symbols[0].name).toBe('Add');
      expect(symbols[0].kind).toBe(SymbolKind.Function);
    });
  });

  describe('INTERFACE → Interface', () => {
    it('returns Interface symbol', () => {
      const index = makeIndex({
        'file:///iface.st': 'INTERFACE IMotor\nEND_INTERFACE',
      });
      const symbols = handleWorkspaceSymbol(makeParams(''), index);
      expect(symbols).toHaveLength(1);
      expect(symbols[0].name).toBe('IMotor');
      expect(symbols[0].kind).toBe(SymbolKind.Interface);
    });

    it('returns Method symbols for interface methods', () => {
      const index = makeIndex({
        'file:///iface.st': 'INTERFACE IMotor\nMETHOD Start : BOOL\nEND_METHOD\nEND_INTERFACE',
      });
      const symbols = handleWorkspaceSymbol(makeParams(''), index);
      const method = symbols.find(s => s.name === 'Start');
      expect(method).toBeDefined();
      expect(method!.kind).toBe(SymbolKind.Method);
    });
  });

  describe('TYPE blocks', () => {
    it('returns Struct symbol for TYPE STRUCT', () => {
      const index = makeIndex({
        'file:///type.st': 'TYPE\n  ST_Point : STRUCT\n    x : REAL;\n  END_STRUCT\nEND_TYPE',
      });
      const symbols = handleWorkspaceSymbol(makeParams(''), index);
      expect(symbols).toHaveLength(1);
      expect(symbols[0].name).toBe('ST_Point');
      expect(symbols[0].kind).toBe(SymbolKind.Struct);
    });

    it('returns Enum symbol for TYPE ENUM', () => {
      const index = makeIndex({
        'file:///type.st': 'TYPE\n  E_Dir : (Forward, Backward);\nEND_TYPE',
      });
      const symbols = handleWorkspaceSymbol(makeParams(''), index);
      expect(symbols).toHaveLength(1);
      expect(symbols[0].name).toBe('E_Dir');
      expect(symbols[0].kind).toBe(SymbolKind.Enum);
    });

    it('returns TypeParameter symbol for TYPE alias', () => {
      const index = makeIndex({
        'file:///type.st': 'TYPE\n  T_MyInt : INT;\nEND_TYPE',
      });
      const symbols = handleWorkspaceSymbol(makeParams(''), index);
      expect(symbols).toHaveLength(1);
      expect(symbols[0].name).toBe('T_MyInt');
      expect(symbols[0].kind).toBe(SymbolKind.TypeParameter);
    });
  });

  describe('VAR_GLOBAL → Variable', () => {
    it('returns Variable symbols for VAR_GLOBAL block in PROGRAM', () => {
      const src = 'PROGRAM GVL\nVAR_GLOBAL\n  gCounter : INT;\n  gFlag : BOOL;\nEND_VAR\nEND_PROGRAM';
      const index = makeIndex({ 'file:///gvl.st': src });
      const symbols = handleWorkspaceSymbol(makeParams(''), index);
      const vars = symbols.filter(s => s.kind === SymbolKind.Variable);
      expect(vars.length).toBeGreaterThanOrEqual(2);
      expect(vars.some(v => v.name === 'gCounter')).toBe(true);
      expect(vars.some(v => v.name === 'gFlag')).toBe(true);
    });
  });

  describe('query filtering', () => {
    const src = 'PROGRAM Main\nEND_PROGRAM\nFUNCTION_BLOCK FB_Valve\nEND_FUNCTION_BLOCK\nFUNCTION Add : INT\nEND_FUNCTION';
    const index = makeIndex({ 'file:///multi.st': src });

    it('empty query returns all symbols', () => {
      const symbols = handleWorkspaceSymbol(makeParams(''), index);
      expect(symbols.length).toBeGreaterThanOrEqual(3);
    });

    it('filters by substring (case-insensitive)', () => {
      const symbols = handleWorkspaceSymbol(makeParams('valve'), index);
      expect(symbols).toHaveLength(1);
      expect(symbols[0].name).toBe('FB_Valve');
    });

    it('returns empty array when no match', () => {
      const symbols = handleWorkspaceSymbol(makeParams('xyz_no_match'), index);
      expect(symbols).toHaveLength(0);
    });

    it('matches partial name case-insensitively', () => {
      const symbols = handleWorkspaceSymbol(makeParams('MAIN'), index);
      expect(symbols).toHaveLength(1);
      expect(symbols[0].name).toBe('Main');
    });
  });

  describe('multi-file workspace', () => {
    it('searches all indexed files', () => {
      const index = makeIndex({
        'file:///a.st': 'PROGRAM Alpha\nEND_PROGRAM',
        'file:///b.st': 'FUNCTION_BLOCK FB_Beta\nEND_FUNCTION_BLOCK',
      });
      const symbols = handleWorkspaceSymbol(makeParams(''), index);
      expect(symbols).toHaveLength(2);
      expect(symbols.some(s => s.name === 'Alpha')).toBe(true);
      expect(symbols.some(s => s.name === 'FB_Beta')).toBe(true);
    });
  });

  describe('result limit', () => {
    it('limits results to 100 symbols', () => {
      const files: Record<string, string> = {};
      for (let i = 0; i < 200; i++) {
        files[`file:///file${i}.st`] = `PROGRAM Prog${i}\nEND_PROGRAM`;
      }
      const index = makeIndex(files);
      const symbols = handleWorkspaceSymbol(makeParams(''), index);
      expect(symbols.length).toBeLessThanOrEqual(100);
    });
  });
});
