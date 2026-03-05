#!/usr/bin/env node
/**
 * Targeted analysis of TwinCAT compiled-library .meta files.
 * Focuses on large .meta files (actual POUs) to find parameter data.
 *
 * Key insight: meta files contain an embedded BMP icon after varint[6].
 * After skipping the icon, more varints encode parameter information.
 */

'use strict';

const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

// ─── ZIP utils (minimal) ─────────────────────────────────────────────────────
function findEocd(buf) {
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) return i;
  }
  return -1;
}
function readZipEntries(buf) {
  const eocd = findEocd(buf);
  if (eocd < 0) return [];
  const n = buf.readUInt16LE(eocd + 10);
  const cd = buf.readUInt32LE(eocd + 16);
  const entries = [];
  let p = cd;
  for (let i = 0; i < n; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const cs = buf.readUInt32LE(p + 20);
    const us = buf.readUInt32LE(p + 24);
    const fl = buf.readUInt16LE(p + 28);
    const el = buf.readUInt16LE(p + 30);
    const cl = buf.readUInt16LE(p + 32);
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
  const fl = buf.readUInt16LE(lh + 26);
  const el = buf.readUInt16LE(lh + 28);
  const ds = lh + 30 + fl + el;
  const cd = buf.slice(ds, ds + e.cs);
  if (e.method === 0) return cd;
  if (e.method === 8) { try { return zlib.inflateRawSync(cd); } catch { return Buffer.alloc(0); } }
  return Buffer.alloc(0);
}

// ─── Varint ──────────────────────────────────────────────────────────────────
function readVarint(buf, off) {
  let v = 0, s = 0;
  while (off < buf.length) {
    const b = buf[off++];
    v |= (b & 0x7f) << s;
    if (!(b & 0x80)) break;
    s += 7;
  }
  return { value: v, offset: off };
}

// ─── String table ────────────────────────────────────────────────────────────
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

// ─── META_MAGIC check ────────────────────────────────────────────────────────
const META_MAGIC = 0x28092002;
const META_HEADER_SIZE = 20;

/**
 * Parse a .meta file, correctly handling the embedded BMP icon.
 * Returns { header, bmpSize, afterBmp: Buffer }
 */
function parseMetaFile(data, strings) {
  if (data.length < META_HEADER_SIZE + 1) return null;
  if (data.readUInt32LE(0) !== META_MAGIC) return null;

  const payloadSize = data.readUInt32LE(16);

  // Read header varints until we hit the BMP icon size
  // Structure: [typeUuid, typeUuid2, selfUuid, parentUuid, name, namespace, iconSize]
  let pos = META_HEADER_SIZE;
  const headerVarints = [];
  for (let i = 0; i < 7; i++) {
    if (pos >= data.length) break;
    const r = readVarint(data, pos);
    headerVarints.push({ value: r.value, offset: pos, str: strings.get(r.value) });
    pos = r.offset;
  }

  // headerVarints[6] = icon size
  let iconSize = 0;
  let afterIconPos = pos;
  if (headerVarints.length >= 7) {
    iconSize = headerVarints[6].value;
    // Verify it's a BMP: look for "BM" magic at pos
    if (iconSize > 0 && pos + 2 <= data.length &&
        data[pos] === 0x42 && data[pos + 1] === 0x4d) {
      afterIconPos = pos + iconSize;
    } else {
      // Not a BMP right here — icon may be 0 or absent
      iconSize = 0;
      afterIconPos = pos;
    }
  }

  return {
    payloadSize,
    headerVarints,
    iconSize,
    afterIconPos,
    afterBmp: data.slice(afterIconPos),
    totalSize: data.length,
  };
}

/**
 * Read all varints from a buffer, associating string lookups.
 */
function readAllVarints(buf, strings, maxCount = 500) {
  const out = [];
  let p = 0;
  while (p < buf.length && out.length < maxCount) {
    const before = p;
    const r = readVarint(buf, p);
    if (r.offset === before) break;
    out.push({ value: r.value, offset: before, str: strings.get(r.value) });
    p = r.offset;
  }
  return out;
}

// ─── Hex dump ────────────────────────────────────────────────────────────────
function hexDump(buf, maxBytes = 128, baseOffset = 0) {
  const lines = [];
  for (let i = 0; i < Math.min(buf.length, maxBytes); i += 16) {
    const chunk = buf.slice(i, i + 16);
    const hex = [...chunk].map(b => b.toString(16).padStart(2, '0')).join(' ');
    const ascii = [...chunk].map(b => (b >= 0x20 && b <= 0x7e) ? String.fromCharCode(b) : '.').join('');
    lines.push(`  ${(baseOffset + i).toString(16).padStart(6, '0')}  ${hex.padEnd(48)}  ${ascii}`);
  }
  return lines.join('\n');
}

// ─── Main ────────────────────────────────────────────────────────────────────
const filePath = process.argv[2];
if (!filePath) { console.error('Usage: node analyze-meta-params.js <file>'); process.exit(1); }

const buf = fs.readFileSync(filePath);
const entries = readZipEntries(buf);

// Get string table
const stEntry = entries.find(e => e.filename === '__shared_data_storage_string_table__.auxiliary');
const stData = stEntry ? readEntry(buf, stEntry) : Buffer.alloc(0);
const strings = decodeStringTable(stData);

// Print all strings
console.log(`\nAll strings in table (${strings.size}):`);
const sortedKeys = [...strings.keys()].sort((a,b) => a - b);
for (const k of sortedKeys) {
  const v = strings.get(k);
  // Filter: only show non-UUID strings or short names
  if (!v.match(/^[0-9a-f]{8}-/i)) {
    console.log(`  [${k.toString().padStart(4)}] ${JSON.stringify(v)}`);
  }
}

// Find large meta files (actual POUs, not folders)
const metaEntries = entries.filter(e => e.filename.endsWith('.meta'));
console.log(`\n\nAll .meta files:\n`);
for (const me of metaEntries) {
  const data = readEntry(buf, me);
  const parsed = parseMetaFile(data, strings);
  if (!parsed) { console.log(`  ${me.filename.slice(0,8)}: cannot parse`); continue; }

  const hv = parsed.headerVarints;
  const name = hv[4]?.str ?? '?';
  const parentStr = hv[3]?.str ?? '?';
  const isNull = hv[3]?.value === 1;

  console.log(`  ${me.filename.slice(0,8)} | size=${data.length.toString().padStart(5)} | name=${name.padEnd(30)} | parent=${isNull ? 'null' : parentStr.slice(0, 36)} | icon=${parsed.iconSize} | afterBmp=${parsed.afterBmp.length}`);
}

// ─── Deep-dive into specific POUs ────────────────────────────────────────────
// We know from strings: R_TRIG, TON, CTU, etc.
const knownPous = ['R_TRIG', 'F_TRIG', 'TON', 'TOF', 'TP', 'CTU', 'CTD', 'CTUD', 'RS', 'SR'];

console.log('\n\n=== Deep analysis of known POU meta files ===');

for (const me of metaEntries) {
  const data = readEntry(buf, me);
  const parsed = parseMetaFile(data, strings);
  if (!parsed) continue;
  const name = parsed.headerVarints[4]?.str;
  if (!name || !knownPous.includes(name)) continue;

  console.log(`\n${'─'.repeat(70)}`);
  console.log(`POU: ${name} (${me.filename.slice(0,8)}.meta, ${data.length} bytes)`);
  console.log(`Header varints:`);
  parsed.headerVarints.forEach((v, i) =>
    console.log(`  [${i}] = ${v.value}  ${v.str ? `"${v.str}"` : ''}`));
  console.log(`Icon: ${parsed.iconSize} bytes`);
  console.log(`After-icon data: ${parsed.afterBmp.length} bytes`);

  // Read varints from afterBmp section
  const varints = readAllVarints(parsed.afterBmp, strings, 300);
  console.log(`\nVarints after BMP (${varints.length} total):`);

  // Show all varints with string lookups
  for (let i = 0; i < Math.min(varints.length, 80); i++) {
    const v = varints[i];
    const strLabel = v.str !== undefined ? `  → "${v.str}"` : '';
    console.log(`  [${i.toString().padStart(3)}] @${v.offset.toString(16).padStart(4,'0')} = ${v.value.toString().padStart(6)}${strLabel}`);
  }

  // Hex dump of first 256 bytes after BMP
  console.log(`\nHex dump (afterBmp, first 256 bytes):`);
  console.log(hexDump(parsed.afterBmp, 256, parsed.afterIconPos));
}

console.log('\n=== Done ===');
