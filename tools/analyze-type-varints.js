#!/usr/bin/env node
/**
 * Type-varint correlation analysis tool for TwinCAT compiled-library files.
 *
 * Purpose: Systematically search for varints that encode parameter data types
 * (BOOL, INT, WORD, TIME, etc.) across .meta, .object, and schema table files.
 *
 * Approach:
 * 1. Parse all POUs and their known parameter types (ground truth from IEC 61131-3)
 * 2. Dump full varint streams from .meta, .object, and schema table for each POU
 * 3. Build a correlation matrix: which varint positions/values change when types change
 * 4. Compare schema table varints against known CODESYS type enum values
 * 5. Report findings across 15+ POUs
 *
 * Run: node tools/analyze-type-varints.js <path-to.compiled-library>
 */

'use strict';

const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

// === ZIP parsing (shared with other tools) ===

function findEocd(buf) {
  for (let i = buf.length - 22; i >= 0; i--)
    if (buf.readUInt32LE(i) === 0x06054b50) return i;
  return -1;
}

function readZipEntries(buf) {
  const eocd = findEocd(buf);
  if (eocd < 0) return [];
  const n = buf.readUInt16LE(eocd + 10), cd = buf.readUInt32LE(eocd + 16);
  const entries = [];
  let p = cd;
  for (let i = 0; i < n; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10), cs = buf.readUInt32LE(p + 20);
    const us = buf.readUInt32LE(p + 24), fl = buf.readUInt16LE(p + 28);
    const el = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32);
    const lo = buf.readUInt32LE(p + 42);
    const fn = buf.slice(p + 46, p + 46 + fl).toString('utf8');
    entries.push({ filename: fn, method, cs, us, lo });
    p += 46 + fl + el + cl;
  }
  return entries;
}

function readEntry(buf, e) {
  const lh = e.lo;
  if (lh + 30 > buf.length || buf.readUInt32LE(lh) !== 0x04034b50) return Buffer.alloc(0);
  const fl = buf.readUInt16LE(lh + 26), el = buf.readUInt16LE(lh + 28), ds = lh + 30 + fl + el;
  const cd = buf.slice(ds, ds + e.cs);
  if (e.method === 0) return cd;
  if (e.method === 8) { try { return zlib.inflateRawSync(cd); } catch { return Buffer.alloc(0); } }
  return Buffer.alloc(0);
}

// === Varint / string table ===

function readVarint(buf, off) {
  let v = 0, s = 0;
  while (off < buf.length) {
    const b = buf[off++]; v |= (b & 0x7f) << s; if (!(b & 0x80)) break; s += 7;
  }
  return { value: v, offset: off };
}

function decodeStringTable(data) {
  const map = new Map();
  if (!data.length) return map;
  let p = 0;
  const r0 = readVarint(data, p); p = r0.offset;
  for (let i = 0; i < r0.value && p < data.length; i++) {
    const ri = readVarint(data, p); p = ri.offset;
    const rl = readVarint(data, p); p = rl.offset;
    if (p + rl.value > data.length) break;
    map.set(ri.value, data.slice(p, p + rl.value).toString('utf8'));
    p += rl.value;
  }
  return map;
}

function readAllVarints(buf, maxCount = 500) {
  const out = [];
  let p = 0;
  while (p < buf.length && out.length < maxCount) {
    const before = p;
    const r = readVarint(buf, p);
    if (r.offset === before) break;
    out.push({ value: r.value, offset: before });
    p = r.offset;
  }
  return out;
}

// === Ground truth: known parameter types for standard IEC 61131-3 FBs ===
// These are the expected types from the IEC standard specification.

const GROUND_TRUTH = {
  // Bistable FBs
  SR:    { params: { S1: 'BOOL', R: 'BOOL', Q1: 'BOOL' } },
  RS:    { params: { SET: 'BOOL', RESET1: 'BOOL', Q1: 'BOOL' } },
  // Edge detection
  R_TRIG: { params: { CLK: 'BOOL', Q: 'BOOL' } },
  F_TRIG: { params: { CLK: 'BOOL', Q: 'BOOL' } },
  // Counters
  CTU:   { params: { CU: 'BOOL', RESET: 'BOOL', PV: 'WORD', Q: 'BOOL', CV: 'WORD' } },
  CTD:   { params: { CD: 'BOOL', LOAD: 'BOOL', PV: 'WORD', Q: 'BOOL', CV: 'WORD' } },
  CTUD:  { params: { CU: 'BOOL', CD: 'BOOL', RESET: 'BOOL', LOAD: 'BOOL', PV: 'WORD', QU: 'BOOL', QD: 'BOOL', CV: 'WORD' } },
  // Timers
  TP:    { params: { IN: 'BOOL', PT: 'TIME', Q: 'BOOL', ET: 'TIME' } },
  TON:   { params: { IN: 'BOOL', PT: 'TIME', Q: 'BOOL', ET: 'TIME' } },
  TOF:   { params: { IN: 'BOOL', PT: 'TIME', Q: 'BOOL', ET: 'TIME' } },
  // LTIME variants (TwinCAT extended)
  LTP:   { params: { IN: 'BOOL', PT: 'LTIME', Q: 'BOOL', ET: 'LTIME' } },
  LTON:  { params: { IN: 'BOOL', PT: 'LTIME', Q: 'BOOL', ET: 'LTIME' } },
  LTOF:  { params: { IN: 'BOOL', PT: 'LTIME', Q: 'BOOL', ET: 'LTIME' } },
  // Semaphore
  SEMA:  { params: { CLAIM: 'BOOL', RELEASE: 'BOOL', BUSY: 'BOOL' } },
  // LTIME counters
  LCTU:  { params: { CU: 'BOOL', RESET: 'BOOL', PV: 'DWORD', Q: 'BOOL', CV: 'DWORD' } },
  LCTD:  { params: { CD: 'BOOL', LOAD: 'BOOL', PV: 'DWORD', Q: 'BOOL', CV: 'DWORD' } },
  LCTUD: { params: { CU: 'BOOL', CD: 'BOOL', RESET: 'BOOL', LOAD: 'BOOL', PV: 'DWORD', QU: 'BOOL', QD: 'BOOL', CV: 'DWORD' } },
};

// Known CODESYS type enum candidates (speculative — checking if any varints match)
const CODESYS_TYPE_ENUMS = {
  // Possible type IDs based on common PLC type systems
  BOOL: [0x01, 0x21, 0x41, 16, 33],
  BYTE: [0x02, 0x22, 17],
  WORD: [0x03, 0x04, 0x23, 18, 19],
  DWORD: [0x05, 0x25, 20],
  INT: [0x06, 0x26, 21],
  DINT: [0x07, 0x27, 22],
  REAL: [0x08, 0x28, 23],
  LREAL: [0x09, 0x29, 24],
  STRING: [0x0A, 0x2A, 25],
  TIME: [0x0B, 0x10, 0x2B, 26, 30],
  LTIME: [0x0C, 0x11, 0x2C, 27, 31],
  SINT: [0x0D, 14],
  USINT: [0x0E, 15],
  UINT: [0x0F, 0x2F, 28],
  UDINT: [0x10, 0x30, 29],
};

const META_MAGIC = 0x28092002;

function hexDump(buf, maxBytes = 64, base = 0) {
  const lines = [];
  for (let i = 0; i < Math.min(buf.length, maxBytes); i += 16) {
    const chunk = buf.slice(i, i + 16);
    const hex = [...chunk].map(b => b.toString(16).padStart(2, '0')).join(' ');
    const asc = [...chunk].map(b => (b >= 0x20 && b <= 0x7e) ? String.fromCharCode(b) : '.').join('');
    lines.push(`  ${(base + i).toString(16).padStart(6, '0')}  ${hex.padEnd(48)}  ${asc}`);
  }
  return lines.join('\n');
}

// === Main ===

const filePath = process.argv[2];
if (!filePath) {
  console.error('Usage: node analyze-type-varints.js <path-to.compiled-library>');
  process.exit(1);
}

const buf = fs.readFileSync(filePath);
const entries = readZipEntries(buf);
console.log(`\n=== Type-Varint Correlation Analysis: ${path.basename(filePath)} ===`);
console.log(`ZIP entries: ${entries.length}\n`);

// Load string table
const stEntry = entries.find(e => e.filename === '__shared_data_storage_string_table__.auxiliary');
if (!stEntry) { console.error('No string table found'); process.exit(1); }
const strings = decodeStringTable(readEntry(buf, stEntry));

// Load schema table
const schEntry = entries.find(e => e.filename === '__shared_data_storage_schema_table__.auxiliary');
const schemaData = schEntry ? readEntry(buf, schEntry) : Buffer.alloc(0);
const schemaVarints = readAllVarints(schemaData, 2000);

// === Step 1: Parse all .meta files to identify POUs ===

const metaEntries = entries.filter(e => e.filename.endsWith('.meta'));
const objEntries = entries.filter(e => e.filename.endsWith('.object'));

const pous = []; // { name, uuid, guidIndex, metaData, metaVarints, objData, objVarints }

for (const me of metaEntries) {
  const data = readEntry(buf, me);
  if (data.length <= 38) continue; // folders
  if (data.length < 20 || data.readUInt32LE(0) !== META_MAGIC) continue;

  let pos = 20;
  const hvs = [];
  for (let i = 0; i < 7 && pos < data.length; i++) {
    const r = readVarint(data, pos); hvs.push(r.value); pos = r.offset;
  }
  if (hvs.length < 5) continue;

  const name = strings.get(hvs[4]);
  const uuid = me.filename.slice(0, 36);
  if (!name || name === 'Global_Version') continue;

  // Find matching .object file
  const oe = objEntries.find(o => o.filename.startsWith(uuid));
  const objData = oe ? readEntry(buf, oe) : Buffer.alloc(0);

  // Read all varints from .meta (after header)
  const metaAllVarints = readAllVarints(data.slice(20), 500);

  // Read all varints from .object
  let objVarints = [];
  if (objData.length >= 20 && objData.readUInt32LE(0) === META_MAGIC) {
    objVarints = readAllVarints(objData.slice(20), 500);
  } else if (objData.length > 0) {
    objVarints = readAllVarints(objData, 500);
  }

  pous.push({
    name,
    uuid,
    guidIndex: hvs[2],
    ownerGuidIndex: hvs[3],
    metaSize: data.length,
    metaVarints: metaAllVarints,
    metaHeaderVarints: hvs,
    objSize: objData.length,
    objVarints,
    objRawHex: objData.slice(0, 64),
  });
}

// Separate FBs from methods
const fbs = pous.filter(p => p.metaSize !== 40); // 40-byte = methods
const methods = pous.filter(p => p.metaSize === 40);

console.log(`POUs found: ${pous.length} (${fbs.length} FBs/functions, ${methods.length} methods)\n`);

// === Step 2: Detailed varint dump for ground-truth POUs ===

console.log('=' .repeat(80));
console.log('SECTION 1: Varint Streams for Ground-Truth POUs');
console.log('=' .repeat(80));

const groundTruthPous = fbs.filter(p => GROUND_TRUTH[p.name]);
console.log(`\nFound ${groundTruthPous.length} ground-truth POUs in library\n`);

// Group by unique type signature for comparison
const typeSignatures = new Map(); // signature string -> [pou names]
for (const pou of groundTruthPous) {
  const gt = GROUND_TRUTH[pou.name];
  const types = Object.values(gt.params);
  const sig = [...new Set(types)].sort().join('+');
  if (!typeSignatures.has(sig)) typeSignatures.set(sig, []);
  typeSignatures.get(sig).push(pou.name);
}

console.log('Type signature groups:');
for (const [sig, names] of typeSignatures) {
  console.log(`  ${sig}: ${names.join(', ')}`);
}
console.log();

for (const pou of groundTruthPous) {
  const gt = GROUND_TRUTH[pou.name];
  const typeList = Object.entries(gt.params).map(([n, t]) => `${n}:${t}`).join(', ');

  console.log(`\n${'─'.repeat(70)}`);
  console.log(`POU: ${pou.name} | Types: ${typeList}`);
  console.log(`  .meta size: ${pou.metaSize} bytes | .object size: ${pou.objSize} bytes`);
  console.log(`  GUID index: ${pou.guidIndex} | Owner: ${pou.ownerGuidIndex}`);

  console.log(`  .meta varints (${pou.metaVarints.length}):`);
  for (let i = 0; i < Math.min(pou.metaVarints.length, 20); i++) {
    const v = pou.metaVarints[i];
    const str = strings.get(v.value);
    const strLabel = str ? ` -> "${str.slice(0, 60)}"` : '';
    console.log(`    [${i.toString().padStart(2)}] @${v.offset.toString(16).padStart(4, '0')} = ${v.value.toString().padStart(6)}${strLabel}`);
  }

  console.log(`  .object varints (${pou.objVarints.length}):`);
  for (let i = 0; i < Math.min(pou.objVarints.length, 20); i++) {
    const v = pou.objVarints[i];
    const str = strings.get(v.value);
    const strLabel = str ? ` -> "${str.slice(0, 60)}"` : '';
    console.log(`    [${i.toString().padStart(2)}] @${v.offset.toString(16).padStart(4, '0')} = ${v.value.toString().padStart(6)}${strLabel}`);
  }

  if (pou.objRawHex.length > 0) {
    console.log(`  .object raw hex:`);
    console.log(hexDump(pou.objRawHex, 64));
  }
}

// === Step 3: Cross-POU varint comparison ===

console.log('\n\n' + '=' .repeat(80));
console.log('SECTION 2: Cross-POU Varint Comparison (.object files)');
console.log('=' .repeat(80));

// Compare .object varints across POUs with different type signatures
console.log('\n.object varint comparison (position -> value for each POU):');

const maxObjVarints = Math.max(...groundTruthPous.map(p => p.objVarints.length));
if (maxObjVarints > 0) {
  // Header
  const header = '  Pos | ' + groundTruthPous.map(p => p.name.padEnd(8)).join(' | ');
  console.log(header);
  console.log('  ' + '-'.repeat(header.length));

  for (let i = 0; i < Math.min(maxObjVarints, 20); i++) {
    const vals = groundTruthPous.map(p => {
      const v = p.objVarints[i];
      return v ? v.value.toString().padEnd(8) : '---     ';
    });
    console.log(`  [${i.toString().padStart(2)}] | ${vals.join(' | ')}`);
  }

  // Check if all .object files are identical
  const objHexes = groundTruthPous.map(p => p.objRawHex.toString('hex'));
  const allIdentical = objHexes.every(h => h === objHexes[0]);
  console.log(`\n  All .object files identical: ${allIdentical ? 'YES (types NOT in .object)' : 'NO (potential type encoding found!)'}`);

  if (!allIdentical) {
    console.log('\n  DIFFERENCES FOUND — analyzing byte-level differences:');
    for (let i = 1; i < groundTruthPous.length; i++) {
      const a = groundTruthPous[0].objRawHex;
      const b = groundTruthPous[i].objRawHex;
      const diffs = [];
      for (let j = 0; j < Math.min(a.length, b.length); j++) {
        if (a[j] !== b[j]) diffs.push({ offset: j, a: a[j], b: b[j] });
      }
      if (diffs.length > 0) {
        console.log(`  ${groundTruthPous[0].name} vs ${groundTruthPous[i].name}: ${diffs.length} byte diffs at offsets ${diffs.slice(0, 10).map(d => d.offset).join(', ')}`);
      }
    }
  }
}

// === Step 4: .meta varint comparison ===

console.log('\n\n' + '=' .repeat(80));
console.log('SECTION 3: Cross-POU Varint Comparison (.meta header varints)');
console.log('=' .repeat(80));

console.log('\n.meta header varints (first 7) for each POU:');
const metaHeader = '  Pos | ' + groundTruthPous.map(p => p.name.padEnd(8)).join(' | ');
console.log(metaHeader);
console.log('  ' + '-'.repeat(metaHeader.length));
for (let i = 0; i < 7; i++) {
  const vals = groundTruthPous.map(p => {
    const v = p.metaHeaderVarints[i];
    return v !== undefined ? v.toString().padEnd(8) : '---     ';
  });
  console.log(`  [${i.toString().padStart(2)}] | ${vals.join(' | ')}`);
}

// === Step 5: Schema table analysis ===

console.log('\n\n' + '=' .repeat(80));
console.log('SECTION 4: Schema Table Analysis');
console.log('=' .repeat(80));

console.log(`\nSchema table: ${schemaData.length} bytes, ${schemaVarints.length} varints`);

// Parse schema as pairs (index, type)
console.log('\nSchema entries (index -> type):');
let sp = 0;
const r0 = readVarint(schemaData, sp); sp = r0.offset;
console.log(`  Element count: ${r0.value}`);

const schemaPairs = [];
for (let i = 0; i < r0.value && sp < schemaData.length; i++) {
  const ri = readVarint(schemaData, sp); sp = ri.offset;
  const rt = readVarint(schemaData, sp); sp = rt.offset;
  const str = strings.get(ri.value);
  schemaPairs.push({ index: ri.value, type: rt.value, str });
  if (i < 60) {
    console.log(`  [${i.toString().padStart(3)}] idx=${ri.value.toString().padStart(5)} type=${rt.value.toString().padStart(4)}  ${str ? `"${str}"` : ''}`);
  }
}

// Check for type-related field names in schema
console.log('\nSchema entries with type-related names:');
const typeRelated = schemaPairs.filter(p => {
  const s = (p.str || '').toLowerCase();
  return s.includes('type') || s.includes('guid') || s.includes('param') ||
         s.includes('input') || s.includes('output') || s.includes('var');
});
for (const p of typeRelated) {
  console.log(`  idx=${p.index} type=${p.type} "${p.str}"`);
}

// === Step 6: CODESYS type enum correlation ===

console.log('\n\n' + '=' .repeat(80));
console.log('SECTION 5: CODESYS Type Enum Correlation');
console.log('=' .repeat(80));

console.log('\nSearching for known CODESYS type enum values in .object and schema varints...\n');

// For each ground-truth POU, check if any varint value matches expected type enum
for (const pou of groundTruthPous) {
  const gt = GROUND_TRUTH[pou.name];
  const uniqueTypes = [...new Set(Object.values(gt.params))];

  console.log(`${pou.name} (expects types: ${uniqueTypes.join(', ')}):`);

  // Collect all varint values from .object
  const objValues = new Set(pou.objVarints.map(v => v.value));
  // Collect all varint values from .meta (beyond header)
  const metaValues = new Set(pou.metaVarints.slice(7).map(v => v.value));

  for (const type of uniqueTypes) {
    const candidates = CODESYS_TYPE_ENUMS[type] || [];
    const objMatches = candidates.filter(c => objValues.has(c));
    const metaMatches = candidates.filter(c => metaValues.has(c));
    if (objMatches.length > 0 || metaMatches.length > 0) {
      console.log(`  ${type}: obj=[${objMatches.join(',')}] meta=[${metaMatches.join(',')}]`);
    } else {
      console.log(`  ${type}: no matches`);
    }
  }
}

// === Step 7: Unique value analysis ===

console.log('\n\n' + '=' .repeat(80));
console.log('SECTION 6: Differential Analysis — Values Unique to Type Groups');
console.log('=' .repeat(80));

// Group POUs by their type signatures, find varint values unique to each group
const boolOnly = groundTruthPous.filter(p => {
  const types = new Set(Object.values(GROUND_TRUTH[p.name].params));
  return types.size === 1 && types.has('BOOL');
});
const hasTime = groundTruthPous.filter(p => {
  const types = new Set(Object.values(GROUND_TRUTH[p.name].params));
  return types.has('TIME');
});
const hasWord = groundTruthPous.filter(p => {
  const types = new Set(Object.values(GROUND_TRUTH[p.name].params));
  return types.has('WORD');
});

function collectAllValues(pous) {
  const all = new Set();
  for (const p of pous) {
    for (const v of p.objVarints) all.add(v.value);
    for (const v of p.metaVarints.slice(7)) all.add(v.value);
  }
  return all;
}

const boolValues = collectAllValues(boolOnly);
const timeValues = collectAllValues(hasTime);
const wordValues = collectAllValues(hasWord);
const allValues = collectAllValues(groundTruthPous);

console.log(`\nBOOL-only POUs: ${boolOnly.map(p => p.name).join(', ') || '(none)'}`);
console.log(`TIME POUs: ${hasTime.map(p => p.name).join(', ') || '(none)'}`);
console.log(`WORD POUs: ${hasWord.map(p => p.name).join(', ') || '(none)'}`);

// Values in TIME POUs but NOT in BOOL-only POUs
const timeUnique = [...timeValues].filter(v => !boolValues.has(v)).sort((a, b) => a - b);
console.log(`\nValues in TIME POUs but NOT in BOOL-only: [${timeUnique.slice(0, 30).join(', ')}]${timeUnique.length > 30 ? '...' : ''}`);

// Values in WORD POUs but NOT in BOOL-only POUs
const wordUnique = [...wordValues].filter(v => !boolValues.has(v)).sort((a, b) => a - b);
console.log(`Values in WORD POUs but NOT in BOOL-only: [${wordUnique.slice(0, 30).join(', ')}]${wordUnique.length > 30 ? '...' : ''}`);

// Values in TIME POUs but NOT in WORD POUs
const timeNotWord = [...timeValues].filter(v => !wordValues.has(v)).sort((a, b) => a - b);
console.log(`Values in TIME POUs but NOT in WORD: [${timeNotWord.slice(0, 30).join(', ')}]${timeNotWord.length > 30 ? '...' : ''}`);

// === Step 8: Byte-level raw comparison ===

console.log('\n\n' + '=' .repeat(80));
console.log('SECTION 7: Raw Byte Comparison of .object Files');
console.log('=' .repeat(80));

// Compare raw bytes of ALL .object files
const objByName = new Map();
for (const pou of groundTruthPous) {
  const oe = objEntries.find(o => o.filename.startsWith(pou.uuid));
  if (oe) objByName.set(pou.name, readEntry(buf, oe));
}

if (objByName.size > 0) {
  const names = [...objByName.keys()];
  const reference = objByName.get(names[0]);
  console.log(`\nReference: ${names[0]} (${reference.length} bytes)`);
  console.log(hexDump(reference, reference.length));

  let anyDiff = false;
  for (let i = 1; i < names.length; i++) {
    const other = objByName.get(names[i]);
    if (reference.length !== other.length) {
      console.log(`\n${names[i]}: DIFFERENT SIZE (${other.length} vs ${reference.length})`);
      console.log(hexDump(other, other.length));
      anyDiff = true;
      continue;
    }
    const diffs = [];
    for (let j = 0; j < reference.length; j++) {
      if (reference[j] !== other[j]) diffs.push(j);
    }
    if (diffs.length > 0) {
      anyDiff = true;
      console.log(`\n${names[i]}: ${diffs.length} bytes differ at [${diffs.join(', ')}]`);
      console.log(hexDump(other, other.length));
    }
  }

  if (!anyDiff) {
    console.log(`\nAll ${names.length} .object files are BYTE-IDENTICAL — types are NOT encoded in .object files.`);
  }
}

// === Step 9: String table type name search ===

console.log('\n\n' + '=' .repeat(80));
console.log('SECTION 8: String Table Search for Standalone Type Names');
console.log('=' .repeat(80));

const TYPE_NAMES = ['BOOL', 'BYTE', 'WORD', 'DWORD', 'LWORD', 'SINT', 'USINT',
  'INT', 'UINT', 'DINT', 'UDINT', 'LINT', 'ULINT', 'REAL', 'LREAL',
  'STRING', 'WSTRING', 'TIME', 'LTIME', 'DATE', 'TOD', 'DT',
  'TIME_OF_DAY', 'DATE_AND_TIME', 'ANY', 'ANY_BIT', 'ANY_INT', 'ANY_REAL'];

const sortedKeys = [...strings.keys()].sort((a, b) => a - b);
console.log(`\nSearching ${strings.size} string table entries for standalone type names...`);

let foundTypes = 0;
for (const k of sortedKeys) {
  const v = strings.get(k).trim();
  if (TYPE_NAMES.includes(v)) {
    console.log(`  [${k}] = "${v}" (EXACT MATCH)`);
    foundTypes++;
  }
}
if (foundTypes === 0) {
  console.log('  No standalone type name entries found in string table.');
}

// Also search for type names as substrings
console.log('\nEntries containing type names as substrings (first 20):');
let substringCount = 0;
for (const k of sortedKeys) {
  if (substringCount >= 20) break;
  const v = strings.get(k);
  for (const tn of ['BOOL', 'WORD', 'TIME', 'LTIME', 'INT', 'REAL', 'STRING']) {
    if (v.includes(tn) && v.trim() !== tn) {
      console.log(`  [${k}] contains "${tn}": ${JSON.stringify(v.slice(0, 80))}`);
      substringCount++;
      break;
    }
  }
}

// === Summary ===

console.log('\n\n' + '=' .repeat(80));
console.log('SUMMARY: Type-Varint Correlation Results');
console.log('=' .repeat(80));

console.log(`
Library: ${path.basename(filePath)}
Ground-truth POUs analyzed: ${groundTruthPous.length}
Total POUs in library: ${fbs.length}
Type signature groups: ${typeSignatures.size}

Findings:
1. .object files identical across all POUs: ${objByName.size > 0 ? (groundTruthPous.every((p, i, arr) => {
     if (i === 0) return true;
     const a = objByName.get(arr[0].name);
     const b = objByName.get(p.name);
     return a && b && a.length === b.length && a.every((v, j) => v === b[j]);
   }) ? 'YES -> types NOT in .object' : 'NO -> INVESTIGATE DIFFERENCES') : 'N/A'}
2. Standalone type names in string table: ${foundTypes > 0 ? `YES (${foundTypes} found)` : 'NO'}
3. Schema table type-related fields: ${typeRelated.length} entries
4. Values unique to TIME POUs vs BOOL-only: ${timeUnique.length} values
5. Values unique to WORD POUs vs BOOL-only: ${wordUnique.length} values

Conclusion:
${foundTypes > 0
  ? 'Type names found in string table — further investigation needed to map varint indices.'
  : timeUnique.length > 0 || wordUnique.length > 0
    ? 'Varint differences detected between type groups — potential type encoding. Investigate unique values.'
    : 'No evidence of type encoding in plain-text structures. Types likely in encrypted __languagemodel.auxiliary.'}
`);

console.log('=== Analysis Complete ===');
