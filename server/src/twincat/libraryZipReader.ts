/**
 * TwinCAT library file reader.
 *
 * Extracts type/POU names from TwinCAT .library and .compiled-library* files.
 * Both formats are ZIP archives containing proprietary binary entries.
 *
 * Approach:
 * - Parse the ZIP central directory to locate named entries.
 * - Decompress __shared_data_storage_string_table__.auxiliary (DEFLATE).
 * - Scan the binary string table for length-prefixed ASCII strings that look
 *   like ST identifiers (contain at least one uppercase letter).
 * - Optionally read projectinformations.auxiliary to determine the library name.
 *
 * No external dependencies — uses only Node.js built-in `zlib` and `fs`.
 */

import * as zlib from 'zlib';
import * as fs from 'fs';
import * as path from 'path';
import { resolveParamType } from './typeRegistry';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LibraryParam {
  name: string;
  type: string;
  direction: 'input' | 'output' | 'inOut';
  comment?: string;
}

export interface LibraryMethod {
  name: string;
  description?: string;
  inputs?: LibraryParam[];
  outputs?: LibraryParam[];
  returnType?: string;
}

export interface LibrarySymbol {
  name: string;
  kind: 'functionBlock' | 'function' | 'interface' | 'struct' | 'type';
  namespace: string;
  description?: string;
  extends?: string;
  implements?: string[];
  inputs?: LibraryParam[];
  outputs?: LibraryParam[];
  inOuts?: LibraryParam[];
  methods?: LibraryMethod[];
  returnType?: string;
}

export interface LibraryIndex {
  name: string;
  symbols: LibrarySymbol[];
  hasSignatures: boolean;
}

/**
 * Result of reading a TwinCAT library file.
 */
export interface LibraryReadResult {
  /** Library name (derived from filename or projectinformations.auxiliary). */
  name: string;
  /** All identifier-like names exported by the library. */
  typeNames: string[];
}

// ---------------------------------------------------------------------------
// ZIP parsing (minimal, no external dependencies)
// ---------------------------------------------------------------------------

const LOCAL_HEADER_SIG = 0x04034b50;
const CD_HEADER_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;

interface ZipEntry {
  filename: string;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localOffset: number;
}

/** Find the End-of-Central-Directory record offset (searches from end). */
function findEocd(buf: Buffer): number {
  // EOCD is at most 65558 bytes from end (max comment size 65535 + 22)
  const start = Math.max(0, buf.length - 65558);
  for (let i = buf.length - 22; i >= start; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) return i;
  }
  return -1;
}

/** Read all entries from the ZIP central directory. */
function readZipEntries(buf: Buffer): ZipEntry[] {
  const eocdOffset = findEocd(buf);
  if (eocdOffset < 0) return [];

  const numEntries = buf.readUInt16LE(eocdOffset + 10);
  const cdOffset = buf.readUInt32LE(eocdOffset + 16);

  const entries: ZipEntry[] = [];
  let pos = cdOffset;

  for (let i = 0; i < numEntries; i++) {
    if (pos + 46 > buf.length) break;
    if (buf.readUInt32LE(pos) !== CD_HEADER_SIG) break;

    const method = buf.readUInt16LE(pos + 10);
    const compSize = buf.readUInt32LE(pos + 20);
    const uncompSize = buf.readUInt32LE(pos + 24);
    const fnLen = buf.readUInt16LE(pos + 28);
    const extraLen = buf.readUInt16LE(pos + 30);
    const commentLen = buf.readUInt16LE(pos + 32);
    const localOffset = buf.readUInt32LE(pos + 42);
    const filename = buf.slice(pos + 46, pos + 46 + fnLen).toString('utf8');

    entries.push({ filename, method, compressedSize: compSize, uncompressedSize: uncompSize, localOffset });
    pos += 46 + fnLen + extraLen + commentLen;
  }

  return entries;
}

/** Decompress a ZIP entry and return its raw bytes. */
function readEntry(buf: Buffer, entry: ZipEntry): Buffer {
  const lh = entry.localOffset;
  if (lh + 30 > buf.length) return Buffer.alloc(0);
  if (buf.readUInt32LE(lh) !== LOCAL_HEADER_SIG) return Buffer.alloc(0);

  const fnLen = buf.readUInt16LE(lh + 26);
  const extraLen = buf.readUInt16LE(lh + 28);
  const dataStart = lh + 30 + fnLen + extraLen;
  if (dataStart + entry.compressedSize > buf.length) return Buffer.alloc(0);

  const compData = buf.slice(dataStart, dataStart + entry.compressedSize);

  if (entry.method === 0) return compData; // stored (no compression)
  if (entry.method === 8) {               // DEFLATE
    try {
      return zlib.inflateRawSync(compData);
    } catch {
      return Buffer.alloc(0);
    }
  }
  return Buffer.alloc(0);
}

// ---------------------------------------------------------------------------
// LEB128 varint + indexed string table parsing
// ---------------------------------------------------------------------------

/** Read a LEB128 varint from data at pos. Returns [value, newPos]. */
function readVarint(data: Buffer, pos: number): [number, number] {
  let result = 0;
  let shift = 0;
  while (pos < data.length) {
    const b = data[pos++];
    result |= (b & 0x7f) << shift;
    if ((b & 0x80) === 0) break;
    shift += 7;
  }
  return [result, pos];
}

/**
 * Parse the indexed string table format used in TwinCAT library files.
 * Format: varint(count) + repeated[varint(index), varint(length), bytes[length]]
 * Returns a Map from index to string value.
 */
function parseIndexedStringTable(data: Buffer): Map<number, string> {
  const entries = new Map<number, string>();
  let pos = 0;
  const [count, nextPos] = readVarint(data, pos);
  pos = nextPos;

  for (let i = 0; i < count; i++) {
    if (pos >= data.length) break;
    let idx: number, length: number;
    [idx, pos] = readVarint(data, pos);
    [length, pos] = readVarint(data, pos);
    if (pos + length > data.length) break;
    entries.set(idx, data.slice(pos, pos + length).toString('utf8'));
    pos += length;
  }
  return entries;
}

// ---------------------------------------------------------------------------
// Compiled library .meta file POU extraction
// ---------------------------------------------------------------------------

const META_MAGIC = 0x28092002;

interface MetaEntry {
  guidIndex: number;     // v[2] — self GUID string table index
  ownerGuidIndex: number; // v[3] — owner UUID (0 or null-UUID index for top-level POUs)
  name: string;          // string table entry at v[4]
  size: number;          // .meta file size in bytes
}

/**
 * Parse a .meta file and extract its varint-encoded metadata.
 * Returns undefined for folders (≤38 bytes) or unrecognized files.
 *
 * Size classification:
 * - ≤38 bytes: folder/category (skip)
 * - 40 bytes: method (v[3] = owner FB UUID)
 * - ~48 bytes: function or FB without BMP
 * - >3954 bytes: FB with BMP diagram
 */
function parseMetaEntry(data: Buffer, stringTable: Map<number, string>): MetaEntry | undefined {
  if (data.length <= 38) return undefined; // folders
  if (data.length < 24) return undefined;
  if (data.readUInt32LE(0) !== META_MAGIC) return undefined;

  // Skip 20-byte header, read varints [0..4]
  let pos = 20;
  const varints: number[] = [];
  for (let i = 0; i < 5; i++) {
    if (pos >= data.length) return undefined;
    let v: number;
    [v, pos] = readVarint(data, pos);
    varints.push(v);
  }

  const guidIndex = varints[2];      // self GUID string table index
  const ownerGuidIndex = varints[3]; // owner UUID index (null-UUID for top-level)
  const name = stringTable.get(varints[4]);
  if (!name || name === 'Global_Version') return undefined;

  return { guidIndex, ownerGuidIndex, name, size: data.length };
}

// ---------------------------------------------------------------------------
// Compiled library parameter block detection + parsing
// ---------------------------------------------------------------------------

interface ParamBlockEntry {
  index: number;
  value: string;
}

/**
 * Detect parameter block boundaries in the string table.
 * Scans indices in [startIdx, endIdx] for block-start patterns.
 *
 * Rules:
 * 1. Entry starts with "''DOCU" or "__COMMENT" → block start
 * 2. Entry starts with "\r\n" → block start (multi-line POU description)
 * 3. Entry starts with " " + contains "\r\n" + prev is NOT a param comment → block start
 * 4. Entry starts with " " + prev starts with "<TEMPORARY>" → block start
 */
function detectParamBlocks(
  stringTable: Map<number, string>,
  startIdx: number,
  endIdx: number,
): ParamBlockEntry[][] {
  const sortedIndices = [...stringTable.keys()]
    .filter(i => i >= startIdx && i <= endIdx)
    .sort((a, b) => a - b);

  const blockStarts: number[] = [];

  for (let k = 0; k < sortedIndices.length; k++) {
    const idx = sortedIndices[k];
    const entry = stringTable.get(idx)!;
    const prev = k > 0 ? stringTable.get(sortedIndices[k - 1])! : '';

    if (entry.startsWith("''DOCU") || entry.startsWith('__COMMENT')) {
      blockStarts.push(idx);
    } else if (entry.startsWith('\r\n')) {
      blockStarts.push(idx);
    } else if (entry.startsWith(' ') && entry.includes('\r\n')) {
      const prevIsParamComment = prev.startsWith(' ') && !prev.includes('\r\n') && prev.length > 5;
      if (!prevIsParamComment) {
        blockStarts.push(idx);
      }
    } else if (entry.startsWith(' ') && prev.startsWith('<TEMPORARY>')) {
      blockStarts.push(idx);
    }
  }

  // Build blocks
  const blocks: ParamBlockEntry[][] = [];
  for (let i = 0; i < blockStarts.length; i++) {
    const start = blockStarts[i];
    const end = i + 1 < blockStarts.length ? blockStarts[i + 1] : endIdx + 1;
    const block: ParamBlockEntry[] = [];
    for (const idx of sortedIndices) {
      if (idx >= start && idx < end) {
        block.push({ index: idx, value: stringTable.get(idx)! });
      }
    }
    blocks.push(block);
  }

  return blocks;
}

const DIRECTION_KEYWORDS: Record<string, string> = {
  'Input': 'input',
  'Output': 'output',
};

const SKIP_ENTRIES = new Set([
  'NORMAL',
  'conditionalshow', 'conditionalshow_all_locals',
]);

/**
 * Parse a parameter block into a description, parameter list, POU kind, and
 * return type.  The 'FunctionBlock' / 'Function' entries that appear in
 * compiled-library parameter blocks are used to distinguish POU kinds.
 * For functions, the entry immediately after 'Function' that looks like a
 * type name (all-uppercase ST identifier) is treated as the return type.
 */
function parseParamBlock(entries: ParamBlockEntry[]): {
  description: string | undefined;
  params: { name: string; comment?: string; direction: 'input' | 'output' }[];
  pouKind: 'function' | 'functionBlock' | undefined;
  returnType: string | undefined;
} {
  let description: string | undefined;
  const params: { name: string; comment?: string; direction: 'input' | 'output' }[] = [];
  let direction: 'input' | 'output' = 'input';
  let pendingComment: string | undefined;
  let pouKind: 'function' | 'functionBlock' | undefined;
  let returnType: string | undefined;
  let expectReturnType = false;

  for (const { value } of entries) {
    // Skip markers
    if (value.startsWith("''DOCU") || value.startsWith("__COMMENT") || value.startsWith("''NORMAL")) continue;
    if (value.startsWith('<TEMPORARY>') || value.startsWith('{attribute')) continue;
    if (SKIP_ENTRIES.has(value)) continue;

    // POU kind markers
    if (value === 'FunctionBlock') {
      pouKind = 'functionBlock';
      continue;
    }
    if (value === 'Function') {
      pouKind = 'function';
      expectReturnType = true;
      continue;
    }

    // Return type: first identifier-like entry after 'Function' that looks
    // like an ST type (uppercase, no spaces) and appears before any direction
    // keyword.
    if (expectReturnType && /^[A-Z_][A-Z0-9_]*$/.test(value) && !(value in DIRECTION_KEYWORDS)) {
      returnType = value;
      expectReturnType = false;
      continue;
    }
    expectReturnType = false;

    if (value in DIRECTION_KEYWORDS) {
      direction = DIRECTION_KEYWORDS[value] as 'input' | 'output';
      continue;
    }
    // Skip 'Local', 'None' direction keywords
    if (value === 'Local' || value === 'None') continue;

    // Description (first entry with \r\n or long space-prefixed text)
    if (description === undefined && (value.includes('\r\n') || (value.startsWith(' ') && value.length > 15))) {
      description = value.trim();
      continue;
    }

    // Comment (starts with space)
    if (value.startsWith(' ')) {
      pendingComment = value.trim();
      continue;
    }

    // Identifier = parameter name
    if (/^[A-Za-z_]/.test(value)) {
      const param: { name: string; comment?: string; direction: 'input' | 'output' } = {
        name: value,
        direction,
      };
      if (pendingComment) {
        param.comment = pendingComment;
        pendingComment = undefined;
      }
      params.push(param);
    }
  }

  return { description, params, pouKind, returnType };
}

/**
 * Extract POU symbols with parameters from a compiled library using the
 * reverse-order GUID mapping algorithm.
 *
 * POUs sorted by GUID string table index DESCENDING map 1:1 to
 * parameter blocks sorted by string table index ASCENDING.
 */
function extractCompiledSymbols(
  zipBuf: Buffer,
  zipEntries: ZipEntry[],
  stringTable: Map<number, string>,
  namespace: string,
): LibrarySymbol[] {
  // Step 1: Parse all .meta files
  const allMeta: MetaEntry[] = [];
  for (const entry of zipEntries) {
    if (!entry.filename.endsWith('.meta')) continue;
    const data = readEntry(zipBuf, entry);
    const meta = parseMetaEntry(data, stringTable);
    if (meta) allMeta.push(meta);
  }

  if (allMeta.length === 0) return [];

  // Step 2: Identify the null-UUID index (used by top-level POUs as ownerGuidIndex)
  // Find the most common ownerGuidIndex among larger entries (≥48 bytes = POUs)
  const ownerCounts = new Map<number, number>();
  for (const m of allMeta) {
    if (m.size >= 48) {
      ownerCounts.set(m.ownerGuidIndex, (ownerCounts.get(m.ownerGuidIndex) ?? 0) + 1);
    }
  }
  // The null-UUID index is the most frequent owner among POUs
  let nullUuidIndex = 1; // default
  let maxCount = 0;
  for (const [idx, count] of ownerCounts) {
    if (count > maxCount) {
      nullUuidIndex = idx;
      maxCount = count;
    }
  }

  // Step 3: Separate POUs (top-level, v[3]=null-UUID) from methods (v[3]=FB UUID)
  const pous: MetaEntry[] = [];
  const methodEntries: MetaEntry[] = [];

  for (const m of allMeta) {
    if (m.ownerGuidIndex === nullUuidIndex) {
      pous.push(m);
    } else {
      methodEntries.push(m);
    }
  }

  // Build method lookup: ownerGuidIndex → method names
  const methodsByOwnerGuid = new Map<number, string[]>();
  for (const m of methodEntries) {
    const existing = methodsByOwnerGuid.get(m.ownerGuidIndex);
    if (existing) {
      existing.push(m.name);
    } else {
      methodsByOwnerGuid.set(m.ownerGuidIndex, [m.name]);
    }
  }

  // Sort POUs by GUID index DESCENDING (for reverse-order mapping)
  pous.sort((a, b) => b.guidIndex - a.guidIndex);

  // Step 4: Determine string table index ranges for parameter section
  const maxGuidIdx = Math.max(...pous.map(p => p.guidIndex));
  const paramStartIdx = maxGuidIdx + 10;
  const paramEndIdx = 400;

  // Step 5: Detect parameter blocks
  const blocks = detectParamBlocks(stringTable, paramStartIdx, paramEndIdx);

  // Step 6: Link POUs to blocks via reverse-order mapping + attach methods
  const symbols: LibrarySymbol[] = [];
  for (let i = 0; i < pous.length; i++) {
    const pou = pous[i];
    const symbol: LibrarySymbol = {
      name: pou.name,
      kind: 'functionBlock',
      namespace,
    };

    // Attach param block
    if (i < blocks.length) {
      const { description, params, pouKind, returnType } = parseParamBlock(blocks[i]);
      if (pouKind) {
        symbol.kind = pouKind;
      }
      if (returnType) {
        symbol.returnType = returnType;
      }
      if (description) {
        symbol.description = description;
      }
      const inputs = params.filter(p => p.direction === 'input');
      const outputs = params.filter(p => p.direction === 'output');
      if (inputs.length > 0) {
        symbol.inputs = inputs.map(p => ({
          name: p.name,
          type: resolveParamType(pou.name, p.name),
          direction: 'input' as const,
          comment: p.comment,
        }));
      }
      if (outputs.length > 0) {
        symbol.outputs = outputs.map(p => ({
          name: p.name,
          type: resolveParamType(pou.name, p.name),
          direction: 'output' as const,
          comment: p.comment,
        }));
      }
    }

    // Attach methods (v[3] of method = v[2] of this POU)
    const methodNames = methodsByOwnerGuid.get(pou.guidIndex);
    if (methodNames && methodNames.length > 0) {
      symbol.methods = methodNames.sort().map(name => ({ name }));
    }

    symbols.push(symbol);
  }

  return symbols;
}

// ---------------------------------------------------------------------------
// String / identifier extraction (fallback for unrecognized formats)
// ---------------------------------------------------------------------------

/**
 * Extract identifier-like strings from TwinCAT binary string table data.
 * Used as a fallback when the indexed string table format is not recognized.
 */
function extractIdentifiers(data: Buffer): string[] {
  const result = new Set<string>();

  for (let pos = 0; pos < data.length - 1; pos++) {
    const len = data[pos];
    if (len < 2 || len > 80 || pos + 1 + len > data.length) continue;

    let isAscii = true;
    for (let i = 0; i < len; i++) {
      const c = data[pos + 1 + i];
      if (c < 0x20 || c > 0x7e) { isAscii = false; break; }
    }
    if (!isAscii) continue;

    const s = data.slice(pos + 1, pos + 1 + len).toString('ascii');
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(s) && /[A-Z]/.test(s)) {
      result.add(s);
    }
  }

  return [...result];
}

/**
 * Parse the library name from `projectinformations.auxiliary` XML content.
 * Looks for <DefaultNamespace> first, then <Name>.
 */
function parseLibraryName(data: Buffer): string | undefined {
  const text = data.toString('utf8');
  const m =
    /<DefaultNamespace\s*>([^<]+)<\/DefaultNamespace>/i.exec(text) ??
    /<Name\s*>([^<]+)<\/Name>/i.exec(text);
  return m ? m[1].trim() : undefined;
}

// ---------------------------------------------------------------------------
// Source library ST declaration parser
// ---------------------------------------------------------------------------

type ParseState = 'IDLE' | 'IN_FB_DECL' | 'IN_VAR_INPUT' | 'IN_VAR_OUTPUT' | 'IN_VAR_IN_OUT' | 'IN_FB_BODY';

/**
 * Extract printable ASCII runs of at least `minLen` characters from a binary
 * buffer and return them joined as a single string.
 */
function extractAsciiRuns(data: Buffer, minLen: number): string {
  const runs: string[] = [];
  let current = '';
  for (let i = 0; i < data.length; i++) {
    const c = data[i];
    // Printable ASCII range (space through tilde) plus newline/carriage-return/tab
    if ((c >= 0x20 && c <= 0x7e) || c === 0x0a || c === 0x0d || c === 0x09) {
      current += String.fromCharCode(c);
    } else {
      if (current.length >= minLen) {
        runs.push(current);
      }
      current = '';
    }
  }
  if (current.length >= minLen) {
    runs.push(current);
  }
  return runs.join('\n');
}

/**
 * Parse a variable declaration line like `  name : TYPE; // comment`
 * Returns a LibraryParam or undefined if the line is not a valid declaration.
 */
function parseVarLine(line: string, direction: 'input' | 'output' | 'inOut'): LibraryParam | undefined {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('(*')) return undefined;

  // Match: name : TYPE  with optional := default and optional // comment
  const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([^;:]+?)(?:\s*:=[^;]*)?;\s*(?:\/\/\s*(.*))?$/.exec(trimmed);
  if (!m) return undefined;

  const param: LibraryParam = {
    name: m[1].trim(),
    type: m[2].trim(),
    direction,
  };
  if (m[3]) {
    param.comment = m[3].trim();
  }
  return param;
}

/**
 * Parse ST declaration text found in source `.library` files and return
 * an array of LibrarySymbol objects with full signatures.
 */
function parseSourceDeclarations(text: string, namespace: string): LibrarySymbol[] {
  const symbols: LibrarySymbol[] = [];
  const lines = text.split(/\r?\n/);

  let state: ParseState = 'IDLE';
  let current: LibrarySymbol | undefined;

  for (const line of lines) {
    const trimmed = line.trim();
    const upper = trimmed.toUpperCase();

    if (state === 'IDLE') {
      // FUNCTION_BLOCK name [EXTENDS base] [IMPLEMENTS iface1, iface2]
      const fbMatch = /^FUNCTION_BLOCK\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s+EXTENDS\s+([A-Za-z_][A-Za-z0-9_]*))?(?:\s+IMPLEMENTS\s+(.+))?$/i.exec(trimmed);
      if (fbMatch) {
        current = {
          name: fbMatch[1],
          kind: 'functionBlock',
          namespace,
        };
        if (fbMatch[2]) current.extends = fbMatch[2];
        if (fbMatch[3]) {
          current.implements = fbMatch[3].split(',').map(s => s.trim()).filter(Boolean);
        }
        state = 'IN_FB_DECL';
        continue;
      }

      // FUNCTION name : RETURNTYPE
      const fnMatch = /^FUNCTION\s+([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([A-Za-z_][A-Za-z0-9_]*)$/i.exec(trimmed);
      if (fnMatch) {
        current = {
          name: fnMatch[1],
          kind: 'function',
          namespace,
          returnType: fnMatch[2],
        };
        state = 'IN_FB_DECL';
        continue;
      }

      // INTERFACE name [EXTENDS base]
      const ifMatch = /^INTERFACE\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s+EXTENDS\s+([A-Za-z_][A-Za-z0-9_]*))?$/i.exec(trimmed);
      if (ifMatch) {
        current = {
          name: ifMatch[1],
          kind: 'interface',
          namespace,
        };
        if (ifMatch[2]) current.extends = ifMatch[2];
        state = 'IN_FB_DECL';
        continue;
      }

      // TYPE name :
      const typeMatch = /^TYPE\s+([A-Za-z_][A-Za-z0-9_]*)\s*:?/i.exec(trimmed);
      if (typeMatch) {
        current = {
          name: typeMatch[1],
          kind: 'type',
          namespace,
        };
        // Check if it's a STRUCT
        const rest = trimmed.slice(typeMatch[0].length).trim().toUpperCase();
        if (rest === 'STRUCT' || rest.startsWith('STRUCT')) {
          current.kind = 'struct';
        }
        state = 'IN_FB_DECL';
        continue;
      }
    }

    if (state === 'IN_FB_DECL' || state === 'IN_FB_BODY') {
      if (upper.startsWith('VAR_INPUT')) { state = 'IN_VAR_INPUT'; continue; }
      if (upper.startsWith('VAR_OUTPUT')) { state = 'IN_VAR_OUTPUT'; continue; }
      if (upper.startsWith('VAR_IN_OUT')) { state = 'IN_VAR_IN_OUT'; continue; }

      if (upper.startsWith('END_FUNCTION_BLOCK') || upper.startsWith('END_FUNCTION') ||
          upper.startsWith('END_INTERFACE') || upper.startsWith('END_TYPE') ||
          upper.startsWith('END_STRUCT')) {
        if (current) {
          symbols.push(current);
          current = undefined;
        }
        state = 'IDLE';
        continue;
      }

      // Anything else in the declaration body — just stay in body
      state = 'IN_FB_BODY';
    }

    if (state === 'IN_VAR_INPUT' || state === 'IN_VAR_OUTPUT' || state === 'IN_VAR_IN_OUT') {
      if (upper.startsWith('END_VAR')) {
        state = 'IN_FB_BODY';
        continue;
      }
      if (!current) continue;

      const direction: 'input' | 'output' | 'inOut' =
        state === 'IN_VAR_INPUT' ? 'input' :
        state === 'IN_VAR_OUTPUT' ? 'output' : 'inOut';

      const param = parseVarLine(trimmed, direction);
      if (param) {
        if (direction === 'input') {
          if (!current.inputs) current.inputs = [];
          current.inputs.push(param);
        } else if (direction === 'output') {
          if (!current.outputs) current.outputs = [];
          current.outputs.push(param);
        } else {
          if (!current.inOuts) current.inOuts = [];
          current.inOuts.push(param);
        }
      }
    }
  }

  // If we still have an open symbol at end-of-text, push it
  if (current) {
    symbols.push(current);
  }

  return symbols;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Return true if the file path looks like a TwinCAT library file.
 */
export function isLibraryFile(filePath: string): boolean {
  const base = path.basename(filePath).toLowerCase();
  return base.endsWith('.library') || base.includes('.compiled-library');
}

/**
 * Read a TwinCAT library file and extract a full LibraryIndex with symbols.
 *
 * For source `.library` files, attempts to parse ST declarations from the
 * string table to extract full signatures (inputs, outputs, extends, etc.).
 *
 * For compiled `.compiled-library*` files, extracts identifier names only
 * and creates stub symbols with kind='functionBlock' and no signature info.
 *
 * @param filePath  Absolute path to the .library or .compiled-library* file.
 * @returns  LibraryIndex with symbols. Returns empty index on any error.
 */
export function readLibraryIndex(filePath: string): LibraryIndex {
  const base = path.basename(filePath);
  const defaultName = base.replace(/\.compiled-library.*|\.library$/i, '');
  const isSource = base.toLowerCase().endsWith('.library');

  let buf: Buffer;
  try {
    buf = fs.readFileSync(filePath);
  } catch {
    return { name: defaultName, symbols: [], hasSignatures: false };
  }

  if (buf.length < 4 || buf.readUInt32LE(0) !== LOCAL_HEADER_SIG) {
    return { name: defaultName, symbols: [], hasSignatures: false };
  }

  const entries = readZipEntries(buf);
  if (entries.length === 0) return { name: defaultName, symbols: [], hasSignatures: false };

  let libraryName = defaultName;
  let stringTableData: Buffer = Buffer.alloc(0);

  for (const entry of entries) {
    if (entry.filename === 'projectinformations.auxiliary') {
      const data = readEntry(buf, entry);
      const name = parseLibraryName(data);
      if (name) libraryName = name;
    } else if (entry.filename === '__shared_data_storage_string_table__.auxiliary') {
      stringTableData = readEntry(buf, entry);
    }
  }

  if (stringTableData.length === 0) {
    return { name: libraryName, symbols: [], hasSignatures: false };
  }

  if (isSource) {
    // Source library: extract ASCII runs and parse ST declarations
    const text = extractAsciiRuns(stringTableData, 10);
    const symbols = parseSourceDeclarations(text, libraryName);
    if (symbols.length > 0) {
      return { name: libraryName, symbols, hasSignatures: true };
    }
    // Fallback: if no declarations found, treat as compiled
  }

  // Compiled library: try indexed string table + .meta extraction
  const stringTable = parseIndexedStringTable(stringTableData);
  if (stringTable.size > 0) {
    const symbols = extractCompiledSymbols(buf, entries, stringTable, libraryName);
    if (symbols.length > 0) {
      return { name: libraryName, symbols, hasSignatures: symbols.some(s => (s.inputs?.length ?? 0) > 0 || (s.outputs?.length ?? 0) > 0) };
    }
  }

  // Fallback: extract identifiers as stub symbols
  const identifiers = extractIdentifiers(stringTableData);
  const symbols: LibrarySymbol[] = identifiers.map(name => ({
    name,
    kind: 'functionBlock' as const,
    namespace: libraryName,
  }));

  return { name: libraryName, symbols, hasSignatures: false };
}

/**
 * Read a TwinCAT library file and extract the identifier names it exports.
 *
 * Thin wrapper around `readLibraryIndex()` for backward compatibility.
 *
 * @param filePath  Absolute path to the .library or .compiled-library* file.
 * @returns  Library name and list of extracted identifier names.
 *           Returns empty result (no throws) on any read/parse error.
 */
export function readLibraryTypeNames(filePath: string): LibraryReadResult {
  const index = readLibraryIndex(filePath);
  return { name: index.name, typeNames: index.symbols.map(s => s.name) };
}
