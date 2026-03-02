/**
 * Folding Range handler for IEC 61131-3 Structured Text.
 *
 * Walks the AST to collect collapsible regions:
 *  - POU bodies: PROGRAM, FUNCTION_BLOCK, FUNCTION
 *  - METHOD, ACTION, PROPERTY blocks
 *  - VAR blocks (all variants)
 *  - TYPE / STRUCT / ENUM / UNION declaration blocks
 *  - INTERFACE declarations
 *  - Control flow: IF, FOR, WHILE, REPEAT, CASE
 *  - Multi-line block comments (* ... *)
 *
 * For TwinCAT XML file formats (.TcPOU, .TcGVL, .TcDUT, .TcIO) the handler
 * additionally folds the XML wrapper sections that surround CDATA content,
 * and maps the ST folding positions back to the original file via lineMap.
 */

import * as path from 'path';
import { FoldingRange, FoldingRangeKind } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import {
  Statement,
  VarBlock,
  MethodDeclaration,
  ActionDeclaration,
  SourceFile,
} from '../parser/ast';
import { getXmlRanges, XmlRange } from '../twincat/tcExtractor';
import { getOrParse } from './shared';

// TwinCAT XML file extensions that need the XML-aware folding handler
const XML_EXT_SET = new Set(['.tcpou', '.tcgvl', '.tcdut', '.tcio', '.tctask']);

function addRegion(ranges: FoldingRange[], startLine: number, endLine: number): void {
  if (endLine > startLine) {
    ranges.push({ startLine, endLine, kind: FoldingRangeKind.Region });
  }
}

function collectStatements(stmts: Statement[], ranges: FoldingRange[]): void {
  for (const stmt of stmts) {
    switch (stmt.kind) {
      case 'IfStatement':
        addRegion(ranges, stmt.range.start.line, stmt.range.end.line);
        collectStatements(stmt.then, ranges);
        for (const elsif of stmt.elsifs) {
          collectStatements(elsif.body, ranges);
        }
        if (stmt.else) collectStatements(stmt.else, ranges);
        break;
      case 'ForStatement':
        addRegion(ranges, stmt.range.start.line, stmt.range.end.line);
        collectStatements(stmt.body, ranges);
        break;
      case 'WhileStatement':
        addRegion(ranges, stmt.range.start.line, stmt.range.end.line);
        collectStatements(stmt.body, ranges);
        break;
      case 'RepeatStatement':
        addRegion(ranges, stmt.range.start.line, stmt.range.end.line);
        collectStatements(stmt.body, ranges);
        break;
      case 'CaseStatement':
        addRegion(ranges, stmt.range.start.line, stmt.range.end.line);
        for (const c of stmt.cases) {
          collectStatements(c.body, ranges);
        }
        if (stmt.else) collectStatements(stmt.else, ranges);
        break;
    }
  }
}

function collectVarBlocks(varBlocks: VarBlock[], ranges: FoldingRange[]): void {
  for (const vb of varBlocks) {
    addRegion(ranges, vb.range.start.line, vb.range.end.line);
  }
}

function collectMethod(method: MethodDeclaration, ranges: FoldingRange[]): void {
  addRegion(ranges, method.range.start.line, method.range.end.line);
  collectVarBlocks(method.varBlocks, ranges);
  collectStatements(method.body, ranges);
}

function collectAction(action: ActionDeclaration, ranges: FoldingRange[]): void {
  addRegion(ranges, action.range.start.line, action.range.end.line);
  collectStatements(action.body, ranges);
}

function collectBlockComments(text: string, ranges: FoldingRange[]): void {
  let pos = 0;
  while (pos < text.length) {
    const start = text.indexOf('(*', pos);
    if (start === -1) break;
    const end = text.indexOf('*)', start + 2);
    if (end === -1) break;
    const startLine = countNewlinesBefore(text, start);
    const endLine = countNewlinesBefore(text, end + 1);
    if (endLine > startLine) {
      ranges.push({ startLine, endLine, kind: FoldingRangeKind.Comment });
    }
    pos = end + 2;
  }
}

function countNewlinesBefore(text: string, pos: number): number {
  let count = 0;
  for (let i = 0; i < pos; i++) {
    if (text[i] === '\n') count++;
  }
  return count;
}

function positionToOffset(text: string, pos: { line: number; character: number }): number {
  let line = 0;
  let i = 0;
  while (i < text.length && line < pos.line) {
    if (text[i] === '\n') line++;
    i++;
  }
  return i + pos.character;
}

function mergeAdjacentXmlRanges(text: string, xmlRanges: XmlRange[]): XmlRange[] {
  if (xmlRanges.length <= 1) return xmlRanges;
  const merged: XmlRange[] = [{ ...xmlRanges[0] }];
  for (let i = 1; i < xmlRanges.length; i++) {
    const prev = merged[merged.length - 1];
    const curr = xmlRanges[i];
    const gapStart = positionToOffset(text, prev.end);
    const gapEnd   = positionToOffset(text, curr.start);
    const gapText  = text.slice(gapStart, gapEnd);
    if (gapText.trim() === '') {
      merged[merged.length - 1] = { start: prev.start, end: curr.end };
    } else {
      merged.push({ ...curr });
    }
  }
  return merged;
}

/** Collect all ST folding ranges from a parsed AST + source text. */
function collectAstFoldingRanges(ast: SourceFile, text: string): FoldingRange[] {
  const ranges: FoldingRange[] = [];

  for (const decl of ast.declarations) {
    switch (decl.kind) {
      case 'ProgramDeclaration':
        addRegion(ranges, decl.range.start.line, decl.range.end.line);
        collectVarBlocks(decl.varBlocks, ranges);
        collectStatements(decl.body, ranges);
        break;

      case 'FunctionBlockDeclaration':
        addRegion(ranges, decl.range.start.line, decl.range.end.line);
        collectVarBlocks(decl.varBlocks, ranges);
        collectStatements(decl.body, ranges);
        for (const method of decl.methods) collectMethod(method, ranges);
        for (const action of decl.actions) collectAction(action, ranges);
        for (const prop of decl.properties) {
          addRegion(ranges, prop.range.start.line, prop.range.end.line);
        }
        break;

      case 'FunctionDeclaration':
        addRegion(ranges, decl.range.start.line, decl.range.end.line);
        collectVarBlocks(decl.varBlocks, ranges);
        collectStatements(decl.body, ranges);
        break;

      case 'TypeDeclarationBlock':
        addRegion(ranges, decl.range.start.line, decl.range.end.line);
        break;

      case 'InterfaceDeclaration':
        addRegion(ranges, decl.range.start.line, decl.range.end.line);
        for (const method of decl.methods) collectMethod(method, ranges);
        for (const prop of decl.properties) {
          addRegion(ranges, prop.range.start.line, prop.range.end.line);
        }
        break;
    }
  }

  collectBlockComments(text, ranges);
  return ranges;
}

export function handleFoldingRanges(document: TextDocument | undefined, lineFoldingOnly = false): FoldingRange[] {
  if (!document) return [];

  const ext = path.extname(document.uri).toLowerCase();
  if (XML_EXT_SET.has(ext)) {
    return handleFoldingRangesXml(document, ext, lineFoldingOnly);
  }

  const text = document.getText();
  const { ast } = getOrParse(document!);
  return collectAstFoldingRanges(ast, text);
}

/** Folding range handler for TwinCAT XML files (.TcPOU, .TcGVL, etc.). */
function handleFoldingRangesXml(document: TextDocument, ext: string, lineFoldingOnly = false): FoldingRange[] {
  const text = document.getText();
  const { extraction, ast } = getOrParse(document);
  const lm = extraction.lineMap;
  const ranges: FoldingRange[] = [];

  // 1. XML wrapper section folds (Imports kind → auto-collapsed by foldingImportsByDefault)
  const mergedXmlRanges = mergeAdjacentXmlRanges(text, getXmlRanges(text));
  for (const xmlRange of mergedXmlRanges) {
    const { start, end } = xmlRange;
    if (lineFoldingOnly) {
      // Fallback: line-level fold for clients that don't support character-level
      const foldStart = start.line;
      const foldEnd   = end.line - 1;
      if (foldEnd > foldStart) {
        ranges.push({ startLine: foldStart, endLine: foldEnd, kind: FoldingRangeKind.Imports });
      }
    } else {
      // Character-level fold: fold exactly the XML portion
      if (start.line < end.line || (start.line === end.line && start.character < end.character)) {
        ranges.push({
          startLine: start.line,
          startCharacter: start.character,
          endLine: end.line,
          endCharacter: end.character,
          kind: FoldingRangeKind.Imports,
          collapsedText: '…',
        });
      }
    }
  }

  // 2. ST content folds (computed in extracted-source space, remapped via lineMap).
  const stRanges = collectAstFoldingRanges(ast, extraction.source);
  for (const r of stRanges) {
    const origStart = lm[r.startLine] ?? r.startLine;
    const origEnd   = lm[r.endLine]   ?? r.endLine;
    if (origEnd > origStart) {
      ranges.push({ startLine: origStart, endLine: origEnd, kind: r.kind });
    }
  }

  return ranges;
}
