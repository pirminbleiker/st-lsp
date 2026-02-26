/** IEC 61131-3 Structured Text formatter. Token-stream based. */

import { TextDocument } from 'vscode-languageserver-textdocument';
import {
  DocumentFormattingParams,
  DocumentRangeFormattingParams,
  TextEdit,
} from 'vscode-languageserver/node';

// ---------------------------------------------------------------------------
// Segment types (trivia-preserving tokenization)
// ---------------------------------------------------------------------------

type SegKind =
  | 'keyword'
  | 'identifier'
  | 'number'
  | 'string'
  | 'line_comment'
  | 'block_comment'
  | 'op'
  | 'newline'
  | 'whitespace';

interface Seg {
  kind: SegKind;
  text: string;
}

const ST_KEYWORDS = new Set([
  'PROGRAM', 'END_PROGRAM',
  'FUNCTION_BLOCK', 'END_FUNCTION_BLOCK',
  'FUNCTION', 'END_FUNCTION',
  'VAR', 'VAR_INPUT', 'VAR_OUTPUT', 'VAR_IN_OUT',
  'VAR_GLOBAL', 'VAR_EXTERNAL', 'VAR_TEMP', 'VAR_STAT', 'VAR_CONFIG',
  'END_VAR',
  'IF', 'THEN', 'ELSE', 'ELSIF', 'END_IF',
  'FOR', 'TO', 'BY', 'DO', 'END_FOR',
  'WHILE', 'END_WHILE',
  'REPEAT', 'UNTIL', 'END_REPEAT',
  'CASE', 'OF', 'END_CASE',
  'RETURN', 'EXIT', 'CONTINUE',
  'NOT', 'AND', 'OR', 'XOR', 'MOD',
  'TRUE', 'FALSE',
  'TYPE', 'END_TYPE',
  'STRUCT', 'END_STRUCT',
  'ENUM', 'END_ENUM',
  'UNION', 'END_UNION',
  'NAMESPACE', 'END_NAMESPACE',
  'METHOD', 'END_METHOD',
  'PROPERTY', 'END_PROPERTY',
  'INTERFACE', 'END_INTERFACE',
  'EXTENDS', 'IMPLEMENTS',
  'ABSTRACT', 'OVERRIDE', 'FINAL',
  'SUPER',
  'PUBLIC', 'PRIVATE', 'PROTECTED', 'INTERNAL',
]);

// ---------------------------------------------------------------------------
// Scanner — produces segments preserving comments, strings, newlines
// ---------------------------------------------------------------------------

function scan(src: string): Seg[] {
  const segs: Seg[] = [];
  let i = 0;
  const n = src.length;
  const at = (off = 0): string => src[i + off] ?? '';

  while (i < n) {
    const ch = at();

    if (ch === '\r' || ch === '\n') {
      let t = src[i++];
      if (ch === '\r' && at() === '\n') t += src[i++];
      segs.push({ kind: 'newline', text: t });
      continue;
    }

    if (ch === ' ' || ch === '\t') {
      let t = '';
      while (i < n && (at() === ' ' || at() === '\t')) t += src[i++];
      segs.push({ kind: 'whitespace', text: t });
      continue;
    }

    // Block comment (* ... *)
    if (ch === '(' && at(1) === '*') {
      let t = src[i++] + src[i++];
      while (i < n) {
        if (at() === '*' && at(1) === ')') { t += src[i++] + src[i++]; break; }
        t += src[i++];
      }
      segs.push({ kind: 'block_comment', text: t });
      continue;
    }

    // Line comment // ...
    if (ch === '/' && at(1) === '/') {
      let t = '';
      while (i < n && at() !== '\r' && at() !== '\n') t += src[i++];
      segs.push({ kind: 'line_comment', text: t });
      continue;
    }

    // String literals
    if (ch === "'" || ch === '"') {
      const q = src[i++];
      let t = q;
      while (i < n) {
        const c = src[i++];
        t += c;
        if (c === '$' && i < n) { t += src[i++]; continue; }
        if (c === q) break;
      }
      segs.push({ kind: 'string', text: t });
      continue;
    }

    // Number literals
    if (ch >= '0' && ch <= '9') {
      let t = '';
      while (i < n && ((at() >= '0' && at() <= '9') || at() === '_')) t += src[i++];
      if (at() === '.' && at(1) !== '.') {
        t += src[i++];
        while (i < n && ((at() >= '0' && at() <= '9') || at() === '_')) t += src[i++];
      }
      if (at() === 'E' || at() === 'e') {
        t += src[i++];
        if (at() === '+' || at() === '-') t += src[i++];
        while (i < n && at() >= '0' && at() <= '9') t += src[i++];
      }
      segs.push({ kind: 'number', text: t });
      continue;
    }

    // Identifiers and keywords
    if (isIdentStart(ch)) {
      let t = '';
      while (i < n && isIdentCont(at())) t += src[i++];
      const up = t.toUpperCase();
      if (ST_KEYWORDS.has(up)) {
        segs.push({ kind: 'keyword', text: up });
      } else {
        segs.push({ kind: 'identifier', text: t });
      }
      continue;
    }

    // Operators and punctuation
    i++;
    switch (ch) {
      case ':':
        if (at() === '=') { i++; segs.push({ kind: 'op', text: ':=' }); }
        else segs.push({ kind: 'op', text: ':' });
        break;
      case '=':
        if (at() === '>') { i++; segs.push({ kind: 'op', text: '=>' }); }
        else segs.push({ kind: 'op', text: '=' });
        break;
      case '<':
        if (at() === '=') { i++; segs.push({ kind: 'op', text: '<=' }); }
        else if (at() === '>') { i++; segs.push({ kind: 'op', text: '<>' }); }
        else segs.push({ kind: 'op', text: '<' });
        break;
      case '>':
        if (at() === '=') { i++; segs.push({ kind: 'op', text: '>=' }); }
        else segs.push({ kind: 'op', text: '>' });
        break;
      case '*':
        if (at() === '*') { i++; segs.push({ kind: 'op', text: '**' }); }
        else segs.push({ kind: 'op', text: '*' });
        break;
      case '.':
        if (at() === '.') { i++; segs.push({ kind: 'op', text: '..' }); }
        else segs.push({ kind: 'op', text: '.' });
        break;
      default:
        segs.push({ kind: 'op', text: ch });
    }
  }

  return segs;
}

function isIdentStart(ch: string): boolean {
  return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_';
}

function isIdentCont(ch: string): boolean {
  return isIdentStart(ch) || (ch >= '0' && ch <= '9');
}

// ---------------------------------------------------------------------------
// Indentation rules
// ---------------------------------------------------------------------------

/** First-token-on-line: decrease indent by 1 before printing this line. */
const PRE_DEC = new Set([
  'END_VAR', 'END_IF', 'END_FOR', 'END_WHILE', 'END_REPEAT', 'END_CASE',
  'END_METHOD', 'END_PROPERTY', 'END_STRUCT', 'END_UNION', 'END_ENUM',
  'ELSE', 'ELSIF', 'UNTIL',
]);

/** First-token-on-line: reset indent to 0 before printing this line. */
const PRE_RESET = new Set([
  'END_PROGRAM', 'END_FUNCTION_BLOCK', 'END_FUNCTION',
  'END_TYPE', 'END_NAMESPACE', 'END_INTERFACE',
]);

/**
 * POU-header keywords: always increase indent for the next line,
 * regardless of position on the line.
 */
const POST_INC_ALWAYS = new Set([
  'PROGRAM', 'FUNCTION_BLOCK', 'FUNCTION',
  'METHOD', 'PROPERTY', 'INTERFACE', 'NAMESPACE', 'TYPE',
]);

/**
 * Body-opener keywords: increase indent for the next line only when
 * they appear as the last significant (non-comment) token on the line.
 * This avoids false positives like `ARRAY [1..10] OF INT` where OF is
 * not the last token and should not trigger an indent increase.
 */
const POST_INC_LAST = new Set([
  'THEN', 'DO', 'OF', 'ELSE', 'REPEAT',
  'VAR', 'VAR_INPUT', 'VAR_OUTPUT', 'VAR_IN_OUT',
  'VAR_GLOBAL', 'VAR_EXTERNAL', 'VAR_TEMP', 'VAR_STAT', 'VAR_CONFIG',
  'STRUCT', 'UNION', 'ENUM',
]);

// ---------------------------------------------------------------------------
// Spacing rules
// ---------------------------------------------------------------------------

const BINARY_OPS = new Set([
  ':=', '=>', '=', '<>', '<', '>', '<=', '>=', '+', '-', '*', '/', '**',
]);

/** No space before these tokens. */
const NO_SPACE_BEFORE = new Set([';', ',', ')', ']', '.', '..', '#']);

/** No space after these tokens. */
const NO_SPACE_AFTER = new Set(['(', '[', '.', '..', '#']);

/** Returns true when the preceding token makes a subsequent `-` or `+` unary. */
function isUnaryContext(prev: Seg | null): boolean {
  if (!prev) return true;
  if (prev.kind === 'op') {
    return [':=', '=>', '=', '<>', '<', '>', '<=', '>=',
      '+', '-', '*', '/', '**', '(', '[', ','].includes(prev.text);
  }
  if (prev.kind === 'keyword') {
    return ['NOT', 'AND', 'OR', 'XOR', 'MOD',
      'THEN', 'ELSE', 'DO', 'OF', 'TO', 'BY', 'RETURN'].includes(prev.text);
  }
  return false;
}

/**
 * Compute the space string to insert between tokens `prev` and `cur`.
 * `prevWasUnary` is true when the previous `-`/`+` was determined to be unary.
 */
function spaceBetween(prev: Seg | null, cur: Seg, prevWasUnary: boolean): string {
  if (!prev) return '';

  const pt = prev.text;
  const ct = cur.text;

  if (NO_SPACE_BEFORE.has(ct)) return '';
  if (NO_SPACE_AFTER.has(pt)) return '';

  // No space after a unary minus/plus, unless the next token is also +/-
  // (e.g., `- -5` must not become `--5`)
  if ((pt === '-' || pt === '+') && prevWasUnary && ct !== '-' && ct !== '+') return '';

  // No space before ( or [ when preceded by an identifier (function/array call)
  if ((ct === '(' || ct === '[') && prev.kind === 'identifier') return '';
  // No space before [ when preceded by a keyword like ARRAY
  if (ct === '[' && prev.kind === 'keyword') return '';

  // Space around binary operators
  if (cur.kind === 'op' && BINARY_OPS.has(ct)) return ' ';
  if (prev.kind === 'op' && BINARY_OPS.has(pt) && !prevWasUnary) return ' ';

  return ' ';
}

// ---------------------------------------------------------------------------
// Line renderer
// ---------------------------------------------------------------------------

function renderLine(segs: Seg[]): string {
  let result = '';
  let prev: Seg | null = null;
  let prevWasUnary = false;

  for (const seg of segs) {
    result += spaceBetween(prev, seg, prevWasUnary) + seg.text;

    if (seg.kind === 'op' && (seg.text === '-' || seg.text === '+')) {
      prevWasUnary = isUnaryContext(prev);
    } else {
      prevWasUnary = false;
    }
    prev = seg;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Core format function
// ---------------------------------------------------------------------------

export interface FormatOptions {
  tabSize: number;
}

export function format(src: string, opts: FormatOptions): string {
  const indentStr = ' '.repeat(opts.tabSize);
  const segs = scan(src);

  let indentLevel = 0;
  const outputLines: string[] = [];
  let lineSegs: Seg[] = [];
  let consecutiveBlanks = 0;

  function flushLine(): void {
    if (lineSegs.length === 0) {
      consecutiveBlanks++;
      if (consecutiveBlanks <= 1) outputLines.push('');
      return;
    }
    consecutiveBlanks = 0;

    // Compute indent for THIS line based on first keyword token
    const first = lineSegs[0];
    let lineIndent = indentLevel;
    if (first.kind === 'keyword') {
      if (PRE_RESET.has(first.text)) {
        lineIndent = 0;
      } else if (PRE_DEC.has(first.text)) {
        lineIndent = Math.max(0, indentLevel - 1);
      }
    }

    outputLines.push(indentStr.repeat(lineIndent) + renderLine(lineSegs));

    // Find effective last token (last non-comment segment)
    let effectiveLast: Seg | null = null;
    for (let j = lineSegs.length - 1; j >= 0; j--) {
      if (lineSegs[j].kind !== 'line_comment' && lineSegs[j].kind !== 'block_comment') {
        effectiveLast = lineSegs[j];
        break;
      }
    }

    // Compute indent for NEXT line.
    // Start from lineIndent (after pre-adjustment for the current line's first token).
    // Apply POST_INC for any keyword on this line; mid-line PRE_DEC is intentionally
    // ignored so that single-line compound forms (VAR x; END_VAR) have no net effect.
    let nextIndent = lineIndent;
    for (const seg of lineSegs) {
      if (seg.kind !== 'keyword') continue;
      if (POST_INC_ALWAYS.has(seg.text)) {
        nextIndent++;
      } else if (POST_INC_LAST.has(seg.text) && seg === effectiveLast) {
        nextIndent++;
      }
    }

    indentLevel = nextIndent;
    lineSegs = [];
  }

  for (const seg of segs) {
    if (seg.kind === 'newline') {
      flushLine();
      continue;
    }
    if (seg.kind === 'whitespace') continue; // strip and reconstruct
    lineSegs.push(seg);
  }

  // Flush any remaining tokens (source without trailing newline)
  if (lineSegs.length > 0) flushLine();

  const result = outputLines.join('\n');
  // For non-empty all-whitespace source, preserve a single newline (truthy output)
  if (src.length > 0 && result === '' && outputLines.length > 0) return '\n';
  return result;
}

// ---------------------------------------------------------------------------
// LSP handler functions
// ---------------------------------------------------------------------------

export function handleFormatting(
  params: DocumentFormattingParams,
  document: TextDocument | undefined,
): TextEdit[] {
  if (!document) return [];

  const text = document.getText();
  const tabSize = params.options.tabSize ?? 2;
  const formatted = format(text, { tabSize });
  if (formatted === text) return [];

  return [
    TextEdit.replace(
      { start: { line: 0, character: 0 }, end: document.positionAt(text.length) },
      formatted,
    ),
  ];
}

export function handleRangeFormatting(
  params: DocumentRangeFormattingParams,
  document: TextDocument | undefined,
): TextEdit[] {
  // Format the full document; range context determines correct indentation
  // for all lines, so a full-document reformat is the safest approach.
  if (!document) return [];

  const text = document.getText();
  const tabSize = params.options.tabSize ?? 2;
  const formatted = format(text, { tabSize });
  if (formatted === text) return [];

  return [
    TextEdit.replace(
      { start: { line: 0, character: 0 }, end: document.positionAt(text.length) },
      formatted,
    ),
  ];
}
