#!/usr/bin/env node
/**
 * Analyze .object files and the full string table in a compiled library.
 * Focus: find where VAR_INPUT / parameter data lives.
 */

'use strict';

const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

function findEocd(buf) {
  for (let i = buf.length - 22; i >= 0; i--)
    if (buf.readUInt32LE(i) === 0x06054b50) return i;
  return -1;
}
function readZipEntries(buf) {
  const eocd = findEocd(buf); if (eocd < 0) return [];
  const n = buf.readUInt16LE(eocd + 10), cd = buf.readUInt32LE(eocd + 16);
  const entries = []; let p = cd;
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
  const fl = buf.readUInt16LE(lh + 26), el = buf.readUInt16LE(lh + 28);
  const ds = lh + 30 + fl + el;
  const cd = buf.slice(ds, ds + e.cs);
  if (e.method === 0) return cd;
  if (e.method === 8) { try { return zlib.inflateRawSync(cd); } catch { return Buffer.alloc(0); } }
  return Buffer.alloc(0);
}
function readVarint(buf, off) {
  let v = 0, s = 0;
  while (off < buf.length) {
    const b = buf[off++]; v |= (b & 0x7f) << s; if (!(b & 0x80)) break; s += 7;
  }
  return { value: v, offset: off };
}
function decodeStringTable(data) {
  const map = new Map(); if (!data.length) return map;
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

function hexDump(buf, maxBytes = 64, base = 0) {
  const lines = [];
  for (let i = 0; i < Math.min(buf.length, maxBytes); i += 16) {
    const chunk = buf.slice(i, i + 16);
    const hex = [...chunk].map(b => b.toString(16).padStart(2,'0')).join(' ');
    const asc = [...chunk].map(b => (b>=0x20&&b<=0x7e)?String.fromCharCode(b):'.').join('');
    lines.push(`  ${(base+i).toString(16).padStart(6,'0')}  ${hex.padEnd(48)}  ${asc}`);
  }
  return lines.join('\n');
}

const filePath = process.argv[2];
if (!filePath) { console.error('Usage: node analyze-objects.js <file>'); process.exit(1); }

const buf = fs.readFileSync(filePath);
const entries = readZipEntries(buf);

const stEntry = entries.find(e => e.filename === '__shared_data_storage_string_table__.auxiliary');
const stData = stEntry ? readEntry(buf, stEntry) : Buffer.alloc(0);
const strings = decodeStringTable(stData);

// Show FULL string table, search for parameter-like names
console.log('=== Full string table (ALL non-UUID strings) ===\n');
const sortedKeys = [...strings.keys()].sort((a,b) => a - b);
for (const k of sortedKeys) {
  const v = strings.get(k);
  console.log(`  [${k.toString().padStart(5)}] ${JSON.stringify(v)}`);
}

// All .object files
console.log('\n\n=== All .object files ===');
const objEntries = entries.filter(e => e.filename.endsWith('.object'));
for (const oe of objEntries) {
  const data = readEntry(buf, oe);
  const uuid = oe.filename.slice(0, 36);
  // Reverse lookup UUID → name
  let name = '?';
  for (const [k, v] of strings.entries()) {
    if (v === uuid) {
      // Find what POU this UUID belongs to
      const nameKey = k; // this is the index of the UUID in the string table
      // Try to find adjacent name entries
      name = `[str_idx=${k}]`;
      break;
    }
  }
  console.log(`\n  ${oe.filename.slice(0,8)}.object (${data.length} bytes) uuid_str=${name}`);
  console.log(hexDump(data, Math.min(data.length, 128)));

  // Try to read as varints
  let p = 0;
  const vs = [];
  while (p < data.length && vs.length < 50) {
    const before = p;
    const r = readVarint(data, p);
    if (r.offset === before) break;
    vs.push({ value: r.value, str: strings.get(r.value) });
    p = r.offset;
  }
  if (vs.length > 0) {
    console.log('  As varints:');
    vs.forEach((v, i) => {
      const s = v.str !== undefined ? ` → "${v.str}"` : '';
      console.log(`    [${i}] = ${v.value}${s}`);
    });
  }
}

// Show __shared_data_storage_schema_table__.auxiliary
console.log('\n\n=== __shared_data_storage_schema_table__.auxiliary ===');
const schemaEntry = entries.find(e => e.filename === '__shared_data_storage_schema_table__.auxiliary');
if (schemaEntry) {
  const data = readEntry(buf, schemaEntry);
  console.log(`Size: ${data.length} bytes`);
  console.log(hexDump(data, 256));
  console.log('\nAs varints (first 60):');
  let p = 0;
  for (let i = 0; i < 60 && p < data.length; i++) {
    const before = p;
    const r = readVarint(data, p);
    if (r.offset === before) break;
    const s = strings.get(r.value) !== undefined ? ` → "${strings.get(r.value)}"` : '';
    console.log(`  [${i.toString().padStart(2)}] @${p.toString(16).padStart(4,'0')} = ${r.value}${s}`);
    p = r.offset;
  }
}

// Show __languagemodel.auxiliary structure
console.log('\n\n=== __languagemodel.auxiliary (first 128 bytes hex) ===');
const lmEntry = entries.find(e => e.filename === '__languagemodel.auxiliary');
if (lmEntry) {
  const data = readEntry(buf, lmEntry);
  console.log(`Size: ${data.length}`);
  console.log(hexDump(data, 128));
  // Scan for "BM" pattern in language model
  for (let i = 0; i < data.length - 1; i++) {
    if (data[i] === 0x42 && data[i+1] === 0x4d) {
      console.log(`Found BM at offset ${i} = 0x${i.toString(16)}`);
      break;
    }
  }
  // Look for ST-like keywords in the languagemodel
  const text = data.toString('latin1');
  const ST_KWS = ['VAR_INPUT', 'VAR_OUTPUT', 'END_VAR', 'FUNCTION_BLOCK', 'CLK', 'BOOL', 'TIME'];
  for (const kw of ST_KWS) {
    const idx = text.indexOf(kw);
    if (idx >= 0) console.log(`  Found "${kw}" at offset 0x${idx.toString(16)}`);
  }
}

console.log('\n=== Done ===');
