#!/usr/bin/env node
/**
 * Analysis tool for TwinCAT .compiled-library files.
 * Run: node tools/analyze-compiled-library.js <path-to.compiled-library>
 *
 * Purpose: reverse-engineer the binary format to find where parameter
 * information (VAR_INPUT / VAR_OUTPUT / types) is stored.
 */

'use strict';

const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

// ─── ZIP parsing ──────────────────────────────────────────────────────────────

const LOCAL_HEADER_SIG = 0x04034b50;
const CD_HEADER_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;

function findEocd(buf) {
  const start = Math.max(0, buf.length - 65558);
  for (let i = buf.length - 22; i >= start; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) return i;
  }
  return -1;
}

function readZipEntries(buf) {
  const eocdOffset = findEocd(buf);
  if (eocdOffset < 0) return [];
  const numEntries = buf.readUInt16LE(eocdOffset + 10);
  const cdOffset = buf.readUInt32LE(eocdOffset + 16);
  const entries = [];
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

function readEntry(buf, entry) {
  const lh = entry.localOffset;
  if (lh + 30 > buf.length) return Buffer.alloc(0);
  if (buf.readUInt32LE(lh) !== LOCAL_HEADER_SIG) return Buffer.alloc(0);
  const fnLen = buf.readUInt16LE(lh + 26);
  const extraLen = buf.readUInt16LE(lh + 28);
  const dataStart = lh + 30 + fnLen + extraLen;
  if (dataStart + entry.compressedSize > buf.length) return Buffer.alloc(0);
  const compData = buf.slice(dataStart, dataStart + entry.compressedSize);
  if (entry.method === 0) return compData;
  if (entry.method === 8) {
    try { return zlib.inflateRawSync(compData); } catch { return Buffer.alloc(0); }
  }
  return Buffer.alloc(0);
}

// ─── Varint / string table ────────────────────────────────────────────────────

function readVarint(buf, offset) {
  let result = 0, shift = 0;
  while (offset < buf.length) {
    const b = buf[offset++];
    result |= (b & 0x7f) << shift;
    if (!(b & 0x80)) break;
    shift += 7;
  }
  return { value: result, offset };
}

function decodeIndexedStringTable(data) {
  const map = new Map();
  if (data.length === 0) return map;
  let pos = 0;
  const r0 = readVarint(data, pos);
  const count = r0.value;
  pos = r0.offset;
  for (let i = 0; i < count && pos < data.length; i++) {
    const ri = readVarint(data, pos); pos = ri.offset;
    const rl = readVarint(data, pos); pos = rl.offset;
    if (pos + rl.value > data.length) break;
    map.set(ri.value, data.slice(pos, pos + rl.value).toString('utf8'));
    pos += rl.value;
  }
  return map;
}

// ─── .meta decoder with full varint dump ─────────────────────────────────────

const META_MAGIC = 0x28092002;
const META_HEADER_SIZE = 20;

function decodeMetaFull(data, strings) {
  if (data.length < META_HEADER_SIZE + 1) return null;
  if (data.readUInt32LE(0) !== META_MAGIC) return null;

  const payloadSize = data.readUInt32LE(16);

  const varints = [];
  let pos = META_HEADER_SIZE;
  while (pos < data.length && varints.length < 200) {
    const before = pos;
    const r = readVarint(data, pos);
    if (r.offset === before) break;
    varints.push({ value: r.value, offset: before, str: strings.get(r.value) });
    pos = r.offset;
  }

  return { payloadSize, varints, rawHex: data.slice(META_HEADER_SIZE, META_HEADER_SIZE + 64).toString('hex') };
}

// ─── Extract printable ASCII runs ────────────────────────────────────────────

function extractAsciiStrings(data, minLen = 4) {
  const results = [];
  let current = '';
  let start = 0;
  for (let i = 0; i < data.length; i++) {
    const c = data[i];
    if ((c >= 0x20 && c <= 0x7e) || c === 0x0a || c === 0x0d || c === 0x09) {
      if (!current) start = i;
      current += String.fromCharCode(c);
    } else {
      if (current.length >= minLen) results.push({ offset: start, text: current });
      current = '';
    }
  }
  if (current.length >= minLen) results.push({ offset: start, text: current });
  return results;
}

// ─── Hex dump helper ─────────────────────────────────────────────────────────

function hexDump(buf, maxBytes = 256, offset = 0) {
  const lines = [];
  for (let i = 0; i < Math.min(buf.length, maxBytes); i += 16) {
    const chunk = buf.slice(i, i + 16);
    const hex = [...chunk].map(b => b.toString(16).padStart(2, '0')).join(' ');
    const ascii = [...chunk].map(b => (b >= 0x20 && b <= 0x7e) ? String.fromCharCode(b) : '.').join('');
    lines.push(`  ${(offset + i).toString(16).padStart(6, '0')}  ${hex.padEnd(48)}  ${ascii}`);
  }
  return lines.join('\n');
}

// ─── Main ────────────────────────────────────────────────────────────────────

const filePath = process.argv[2];
if (!filePath) {
  console.error('Usage: node analyze-compiled-library.js <file>');
  process.exit(1);
}

const buf = fs.readFileSync(filePath);
console.log(`\n=== ${path.basename(filePath)} (${buf.length} bytes) ===\n`);

if (buf.readUInt32LE(0) !== LOCAL_HEADER_SIG) {
  console.error('Not a ZIP file');
  process.exit(1);
}

const entries = readZipEntries(buf);
console.log(`ZIP entries (${entries.length} total):\n`);
for (const e of entries) {
  console.log(`  [${e.method === 8 ? 'deflate' : 'stored '}] ${e.filename.padEnd(70)} comp=${e.compressedSize} uncomp=${e.uncompressedSize}`);
}

// Find string table
const stEntry = entries.find(e => e.filename === '__shared_data_storage_string_table__.auxiliary');
if (!stEntry) { console.error('\nNo string table found'); process.exit(1); }

const stData = readEntry(buf, stEntry);
const strings = decodeIndexedStringTable(stData);
console.log(`\nString table: ${strings.size} entries`);

// Show all strings sorted by index
console.log('\n--- String table (first 100) ---');
const sortedKeys = [...strings.keys()].sort((a, b) => a - b);
for (const k of sortedKeys.slice(0, 100)) {
  const v = strings.get(k);
  console.log(`  [${k.toString().padStart(4)}] ${JSON.stringify(v)}`);
}

// Analyze all .meta files
const metaEntries = entries.filter(e => e.filename.endsWith('.meta'));
console.log(`\n=== .meta files (${metaEntries.length}) ===`);

// Group: show first 5 in detail
const SHOW_DETAIL = 5;
let shown = 0;
for (const me of metaEntries) {
  const data = readEntry(buf, me);
  const decoded = decodeMetaFull(data, strings);
  if (!decoded) { console.log(`  ${me.filename}: could not decode`); continue; }

  if (shown < SHOW_DETAIL) {
    console.log(`\n--- ${me.filename} (${data.length} bytes, payload=${decoded.payloadSize}) ---`);
    console.log('  Varints:');
    decoded.varints.forEach((v, i) => {
      const strLabel = v.str !== undefined ? ` → "${v.str}"` : '';
      console.log(`    [${i.toString().padStart(3)}] @${v.offset.toString(16).padStart(4,'0')} = ${v.value}${strLabel}`);
    });
    console.log('  Raw hex (post-header):');
    console.log(hexDump(data.slice(META_HEADER_SIZE), 128, META_HEADER_SIZE));
    shown++;
  }
}

// Analyze other .auxiliary files
console.log('\n=== Other .auxiliary files ===');
const auxEntries = entries.filter(e =>
  e.filename.endsWith('.auxiliary') &&
  e.filename !== '__shared_data_storage_string_table__.auxiliary' &&
  e.filename !== 'projectinformations.auxiliary'
);
for (const ae of auxEntries) {
  const data = readEntry(buf, ae);
  console.log(`\n--- ${ae.filename} (${data.length} bytes) ---`);
  // Check if it's text (XML)
  const sample = data.slice(0, 200).toString('utf8');
  if (sample.includes('<?xml') || sample.includes('<')) {
    console.log('  [XML]', sample.slice(0, 300).replace(/\n/g, ' '));
  } else {
    // Show all strings
    const strs = extractAsciiStrings(data, 3);
    console.log(`  ASCII strings (${strs.length}):`);
    for (const s of strs.slice(0, 20)) {
      console.log(`    @${s.offset.toString(16).padStart(4,'0')} ${JSON.stringify(s.text)}`);
    }
    // Hex dump
    console.log(hexDump(data, 64));
  }
}

// Look for a file that might contain declaration info (signatures)
// Scan all non-text files for ST keywords
const ST_KEYWORDS = ['VAR_INPUT', 'VAR_OUTPUT', 'VAR_IN_OUT', 'FUNCTION_BLOCK', 'FUNCTION', 'END_VAR'];
console.log('\n=== Scanning all entries for ST declaration keywords ===');
for (const e of entries) {
  const data = readEntry(buf, e);
  if (data.length === 0) continue;
  const text = data.toString('utf8');
  const found = ST_KEYWORDS.filter(kw => text.includes(kw));
  if (found.length > 0) {
    console.log(`  ${e.filename}: found ${found.join(', ')}`);
    // Show context
    for (const kw of found.slice(0, 2)) {
      const idx = text.indexOf(kw);
      const ctx = text.slice(Math.max(0, idx - 30), idx + 100).replace(/[\x00-\x1f]/g, '·');
      console.log(`    "${kw}" context: ...${ctx}...`);
    }
  }
}

// List all entry names that contain interesting keywords
console.log('\n=== Entry names with interesting keywords ===');
const INTERESTING = ['decl', 'signature', 'param', 'type', 'var', 'interface', 'pou', 'symbol'];
for (const e of entries) {
  const lower = e.filename.toLowerCase();
  if (INTERESTING.some(kw => lower.includes(kw))) {
    const data = readEntry(buf, e);
    console.log(`  ${e.filename} (${data.length} bytes)`);
    if (data.length > 0 && data.length < 2000) {
      const strs = extractAsciiStrings(data, 4);
      if (strs.length > 0) {
        console.log('    strings:', strs.slice(0, 10).map(s => JSON.stringify(s.text)).join(', '));
      }
    }
  }
}

console.log('\n=== Done ===');
