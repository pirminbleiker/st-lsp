/**
 * Semantic tokens handler for IEC 61131-3 Structured Text.
 *
 * Implements textDocument/semanticTokens/full by walking the lexer token
 * stream and resolving identifier roles from the AST.
 */

import { SemanticTokens, SemanticTokensBuilder } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { Lexer, Token, TokenKind } from '../parser/lexer';
import { parse } from '../parser/parser';
import {
  EnumDeclaration,
  FunctionBlockDeclaration,
  FunctionDeclaration,
  InterfaceDeclaration,
  MethodDeclaration,
  ProgramDeclaration,
  SourceFile,
  StructDeclaration,
  TypeDeclarationBlock,
  UnionDeclaration,
  VarBlock,
  VarDeclaration,
} from '../parser/ast';
import { findBuiltinType } from '../twincat/types';
import { findStandardFB } from '../twincat/stdlib';

// ---------------------------------------------------------------------------
// Legend (order determines indices used in encoding)
// ---------------------------------------------------------------------------

export const TOKEN_TYPES = [
  'keyword',      // 0
  'type',         // 1
  'function',     // 2
  'variable',     // 3
  'parameter',    // 4
  'enumMember',   // 5
  'property',     // 6
  'method',       // 7
  'interface',    // 8
  'comment',      // 9
  'string',       // 10
  'number',       // 11
] as const;

export const TOKEN_MODIFIERS = [
  'declaration',    // bit 0
  'abstract',       // bit 1
  'static',         // bit 2
  'readonly',       // bit 3
  'defaultLibrary', // bit 4
] as const;

// Indices into TOKEN_TYPES
const TT_KEYWORD    = 0;
const TT_TYPE       = 1;
const TT_FUNCTION   = 2;
const TT_VARIABLE   = 3;
const TT_PARAMETER  = 4;
const TT_ENUM_MEMBER = 5;
const TT_PROPERTY   = 6;
const TT_METHOD     = 7;
const TT_INTERFACE  = 8;
const TT_COMMENT    = 9;
const TT_STRING     = 10;
const TT_NUMBER     = 11;

// Modifier bit flags
const MOD_DECLARATION  = 1 << 0;
const MOD_ABSTRACT     = 1 << 1;
const MOD_DEFAULT_LIB  = 1 << 4;

// Token kinds that map to the `keyword` semantic type
const KEYWORD_KINDS = new Set<TokenKind>([
  TokenKind.PROGRAM, TokenKind.END_PROGRAM,
  TokenKind.FUNCTION_BLOCK, TokenKind.END_FUNCTION_BLOCK,
  TokenKind.FUNCTION, TokenKind.END_FUNCTION,
  TokenKind.VAR, TokenKind.VAR_INPUT, TokenKind.VAR_OUTPUT, TokenKind.VAR_IN_OUT,
  TokenKind.VAR_GLOBAL, TokenKind.VAR_EXTERNAL, TokenKind.VAR_TEMP,
  TokenKind.VAR_STAT, TokenKind.VAR_CONFIG, TokenKind.END_VAR,
  TokenKind.IF, TokenKind.THEN, TokenKind.ELSE, TokenKind.ELSIF, TokenKind.END_IF,
  TokenKind.FOR, TokenKind.TO, TokenKind.BY, TokenKind.DO, TokenKind.END_FOR,
  TokenKind.WHILE, TokenKind.END_WHILE,
  TokenKind.REPEAT, TokenKind.UNTIL, TokenKind.END_REPEAT,
  TokenKind.CASE, TokenKind.OF, TokenKind.END_CASE,
  TokenKind.RETURN, TokenKind.EXIT, TokenKind.CONTINUE,
  TokenKind.NOT, TokenKind.AND, TokenKind.OR, TokenKind.XOR, TokenKind.MOD,
  TokenKind.TRUE, TokenKind.FALSE,
  TokenKind.TYPE, TokenKind.END_TYPE,
  TokenKind.STRUCT, TokenKind.END_STRUCT,
  TokenKind.ENUM, TokenKind.END_ENUM,
  TokenKind.METHOD, TokenKind.END_METHOD,
  TokenKind.PROPERTY, TokenKind.END_PROPERTY,
  TokenKind.INTERFACE, TokenKind.END_INTERFACE,
  TokenKind.EXTENDS, TokenKind.IMPLEMENTS,
  TokenKind.ABSTRACT, TokenKind.OVERRIDE, TokenKind.FINAL_KW,
  TokenKind.NAMESPACE, TokenKind.END_NAMESPACE,
  TokenKind.UNION, TokenKind.END_UNION,
  TokenKind.SUPER,
  TokenKind.PUBLIC, TokenKind.PRIVATE, TokenKind.PROTECTED, TokenKind.INTERNAL,
  TokenKind.CONSTANT, TokenKind.RETAIN, TokenKind.PERSISTENT,
]);

// ---------------------------------------------------------------------------
// Name role map — built from the AST
// ---------------------------------------------------------------------------

interface NameRole {
  tokenType: number;
  modifiers: number;
}

/**
 * Walk the AST and build a case-insensitive map of identifier names to their
 * semantic roles. The first role wins when a name appears in multiple contexts.
 */
function buildNameMap(ast: SourceFile): Map<string, NameRole> {
  const map = new Map<string, NameRole>();

  function add(name: string, tokenType: number, modifiers = 0): void {
    const key = name.toUpperCase();
    if (!map.has(key)) map.set(key, { tokenType, modifiers });
  }

  function collectVarBlocks(varBlocks: VarBlock[]): void {
    for (const vb of varBlocks) {
      const isParam =
        vb.varKind === 'VAR_INPUT' ||
        vb.varKind === 'VAR_OUTPUT' ||
        vb.varKind === 'VAR_IN_OUT';
      for (const decl of vb.declarations) {
        add(decl.name, isParam ? TT_PARAMETER : TT_VARIABLE);
      }
    }
  }

  function collectMethod(m: MethodDeclaration): void {
    const mods = m.modifiers.some(mod => mod.toUpperCase() === 'ABSTRACT') ? MOD_ABSTRACT : 0;
    add(m.name, TT_METHOD, mods);
    collectVarBlocks(m.varBlocks);
  }

  for (const decl of ast.declarations) {
    switch (decl.kind) {
      case 'ProgramDeclaration': {
        const p = decl as ProgramDeclaration;
        add(p.name, TT_FUNCTION);
        collectVarBlocks(p.varBlocks);
        break;
      }
      case 'FunctionBlockDeclaration': {
        const fb = decl as FunctionBlockDeclaration;
        add(fb.name, TT_FUNCTION);
        collectVarBlocks(fb.varBlocks);
        for (const m of fb.methods) collectMethod(m);
        for (const p of fb.properties) add(p.name, TT_PROPERTY);
        break;
      }
      case 'FunctionDeclaration': {
        const fn = decl as FunctionDeclaration;
        add(fn.name, TT_FUNCTION);
        collectVarBlocks(fn.varBlocks);
        break;
      }
      case 'InterfaceDeclaration': {
        const iface = decl as InterfaceDeclaration;
        add(iface.name, TT_INTERFACE);
        for (const m of iface.methods) collectMethod(m);
        for (const p of iface.properties) add(p.name, TT_PROPERTY);
        break;
      }
      case 'TypeDeclarationBlock': {
        const tb = decl as TypeDeclarationBlock;
        for (const td of tb.declarations) {
          add(td.name, TT_TYPE);
          if (td.kind === 'EnumDeclaration') {
            const ed = td as EnumDeclaration;
            for (const val of ed.values) add(val.name, TT_ENUM_MEMBER);
          } else if (td.kind === 'StructDeclaration') {
            for (const field of (td as StructDeclaration).fields) {
              add(field.name, TT_VARIABLE);
            }
          } else if (td.kind === 'UnionDeclaration') {
            for (const field of (td as UnionDeclaration).fields) {
              add(field.name, TT_VARIABLE);
            }
          }
        }
        break;
      }
    }
  }

  return map;
}

// ---------------------------------------------------------------------------
// Declaration site detection
// ---------------------------------------------------------------------------

/**
 * Walk the token stream with a simple state machine to identify tokens that
 * are at declaration sites (where a name is first introduced).
 * Returns a set of encoded positions "line:char".
 */
function buildDeclSites(tokens: Token[]): Set<string> {
  const sites = new Set<string>();
  const enc = (tok: Token) => `${tok.range.start.line}:${tok.range.start.character}`;

  let nextIdentIsDecl = false;  // after POU/method/property/namespace keyword

  // VAR block tracking
  let inVarBlock = false;
  let varPhase: 'name' | 'type' = 'type'; // 'name' = before ':', 'type' = after ':'

  // TYPE block tracking
  let inTypeBlock = false;
  let typePhase: 'name' | 'body' = 'body';

  // STRUCT / UNION field tracking
  let structDepth = 0;
  let structPhase: 'name' | 'type' = 'type';

  // ENUM block tracking (ENUM...END_ENUM style)
  let inEnumBlock = false;

  // Inline enum body tracking ( (...) style )
  let inParenEnum = false;
  let parenDepth = 0;

  for (const tok of tokens) {
    if (tok.kind === TokenKind.COMMENT) continue;

    switch (tok.kind) {
      // ── POU / declaration starters ───────────────────────────────────────
      case TokenKind.PROGRAM:
      case TokenKind.FUNCTION_BLOCK:
      case TokenKind.FUNCTION:
      case TokenKind.INTERFACE:
      case TokenKind.METHOD:
      case TokenKind.PROPERTY:
      case TokenKind.NAMESPACE:
        nextIdentIsDecl = true;
        break;

      // ── VAR blocks ───────────────────────────────────────────────────────
      case TokenKind.VAR:
      case TokenKind.VAR_INPUT:
      case TokenKind.VAR_OUTPUT:
      case TokenKind.VAR_IN_OUT:
      case TokenKind.VAR_GLOBAL:
      case TokenKind.VAR_EXTERNAL:
      case TokenKind.VAR_TEMP:
      case TokenKind.VAR_STAT:
      case TokenKind.VAR_CONFIG:
        inVarBlock = true;
        varPhase = 'name';
        break;

      case TokenKind.END_VAR:
        inVarBlock = false;
        varPhase = 'type';
        break;

      // ── TYPE block ───────────────────────────────────────────────────────
      case TokenKind.TYPE:
        inTypeBlock = true;
        typePhase = 'name';
        break;

      case TokenKind.END_TYPE:
        inTypeBlock = false;
        typePhase = 'body';
        break;

      // ── STRUCT / UNION ───────────────────────────────────────────────────
      case TokenKind.STRUCT:
      case TokenKind.UNION:
        structDepth++;
        structPhase = 'name';
        break;

      case TokenKind.END_STRUCT:
      case TokenKind.END_UNION:
        if (structDepth > 0) structDepth--;
        structPhase = 'type';
        break;

      // ── ENUM block ───────────────────────────────────────────────────────
      case TokenKind.ENUM:
        inEnumBlock = true;
        break;

      case TokenKind.END_ENUM:
        inEnumBlock = false;
        break;

      // ── Punctuation affecting phases ─────────────────────────────────────
      case TokenKind.COLON:
        if (inVarBlock) varPhase = 'type';
        if (inTypeBlock && structDepth === 0) {
          // After 'TypeName :' → entering type body; check next token
          typePhase = 'body';
          // If next is '(' it is an inline enum body
          // (handled when we see LPAREN below)
        }
        if (structDepth > 0) structPhase = 'type';
        break;

      case TokenKind.SEMICOLON:
        if (inVarBlock) varPhase = 'name';
        if (inTypeBlock && structDepth === 0) typePhase = 'name';
        if (structDepth > 0) structPhase = 'name';
        if (inParenEnum) { inParenEnum = false; parenDepth = 0; }
        break;

      case TokenKind.COMMA:
        // In inline enum body, comma separates values → next is a value
        if (inParenEnum && parenDepth === 1) {
          // stay in paren enum, next ident is enum value decl
        }
        break;

      case TokenKind.LPAREN:
        parenDepth++;
        if (inTypeBlock && typePhase === 'body' && parenDepth === 1) {
          // TYPE Name : ( ... ) inline enum body
          inParenEnum = true;
        }
        break;

      case TokenKind.RPAREN:
        if (parenDepth > 0) parenDepth--;
        if (inParenEnum && parenDepth === 0) {
          inParenEnum = false;
        }
        break;

      // ── IDENTIFIER: classify as declaration or not ───────────────────────
      case TokenKind.IDENTIFIER:
        if (nextIdentIsDecl) {
          sites.add(enc(tok));
          nextIdentIsDecl = false;
        } else if (inVarBlock && varPhase === 'name') {
          sites.add(enc(tok));
        } else if (inTypeBlock && structDepth === 0 && !inParenEnum && typePhase === 'name') {
          sites.add(enc(tok));
        } else if (structDepth > 0 && structPhase === 'name') {
          sites.add(enc(tok));
        } else if (inEnumBlock) {
          sites.add(enc(tok));
        } else if (inParenEnum) {
          sites.add(enc(tok));
        }
        break;

      default:
        // Any non-identifier token after nextIdentIsDecl=true and the token is
        // a keyword (modifier) keeps nextIdentIsDecl=true, waiting for the name.
        // Since keywords are never TokenKind.IDENTIFIER, we don't clear here.
        break;
    }
  }

  return sites;
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

export function handleSemanticTokens(document: TextDocument): SemanticTokens {
  const text = document.getText();
  const { ast } = parse(text);
  const nameMap = buildNameMap(ast);

  const tokens = new Lexer(text).tokenizeWithTrivia();
  const declSites = buildDeclSites(tokens);

  const builder = new SemanticTokensBuilder();

  for (const tok of tokens) {
    const { line, character } = tok.range.start;
    const length = tok.range.end.character - tok.range.start.character;
    if (length <= 0) continue;

    // Multi-line tokens (e.g. block comments) need per-line splitting.
    // For now handle the common case: single-line tokens.
    const spanLines = tok.range.end.line - tok.range.start.line;

    switch (tok.kind) {
      // ── Structural literals ──────────────────────────────────────────────
      case TokenKind.INTEGER:
      case TokenKind.REAL:
        builder.push(line, character, length, TT_NUMBER, 0);
        break;

      case TokenKind.STRING:
        if (spanLines === 0) {
          builder.push(line, character, length, TT_STRING, 0);
        } else {
          // Multi-line string: emit per-line segments
          const lines = tok.text.split('\n');
          for (let i = 0; i < lines.length; i++) {
            const segLen = lines[i].length;
            if (segLen > 0) {
              builder.push(line + i, i === 0 ? character : 0, segLen, TT_STRING, 0);
            }
          }
        }
        break;

      case TokenKind.COMMENT:
        if (spanLines === 0) {
          builder.push(line, character, length, TT_COMMENT, 0);
        } else {
          // Multi-line block comment: emit per-line segments
          const lines = tok.text.split('\n');
          for (let i = 0; i < lines.length; i++) {
            const segLen = lines[i].length;
            if (segLen > 0) {
              builder.push(line + i, i === 0 ? character : 0, segLen, TT_COMMENT, 0);
            }
          }
        }
        break;

      // ── Keywords ─────────────────────────────────────────────────────────
      default:
        if (KEYWORD_KINDS.has(tok.kind)) {
          builder.push(line, character, length, TT_KEYWORD, 0);
          break;
        }

        if (tok.kind !== TokenKind.IDENTIFIER) break;

        // ── Identifiers ────────────────────────────────────────────────────
        {
          const upper = tok.text.toUpperCase();
          const isDecl = declSites.has(`${line}:${character}`);
          const declMod = isDecl ? MOD_DECLARATION : 0;

          // 1. Builtin type?
          if (findBuiltinType(upper)) {
            builder.push(line, character, length, TT_TYPE, declMod | MOD_DEFAULT_LIB);
            break;
          }

          // 2. Standard function block?
          if (findStandardFB(upper)) {
            builder.push(line, character, length, TT_FUNCTION, declMod | MOD_DEFAULT_LIB);
            break;
          }

          // 3. User-defined name from AST?
          const role = nameMap.get(upper);
          if (role) {
            builder.push(line, character, length, role.tokenType, declMod | role.modifiers);
            break;
          }
        }
        break;
    }
  }

  return builder.build();
}
