#!/usr/bin/env node
/**
 * Scan .meta files in a compiled library, detect the embedded BMP icon by its
 * magic bytes (0x42 0x4d = "BM"), skip it using the BMP file-size field, then
 * dump and annotate all varints that follow.
 *
 * This reveals the parameter-encoding section of large POU meta files.
 */

'use strict';

const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

// ── ZIP ────────────────────────────────────────────────────────────────────────
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

// ── Varint ────────────────────────────────────────────────────────────────────
function readVarint(buf, off) {
  let v = 0, s = 0;
  while (off < buf.length) {
    const b = buf[off++];
    v |= (b & 0x7f) << s; if (!(b & 0x80)) break; s += 7;
  }
  return { value: v, offset: off };
}

// ── String table ─────────────────────────────────────────────────────────────
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

const META_MAGIC = 0x28092002;
const HEADER_SIZE = 20;

/**
 * Find first occurrence of BM magic in buffer.
 * Returns the offset or -1.
 */
function findBmp(buf) {
  for (let i = 0; i < buf.length - 1; i++) {
    if (buf[i] === 0x42 && buf[i + 1] === 0x4d) return i;
  }
  return -1;
}

/**
 * Read all varints from buf[off..], return array.
 */
function readVarints(buf, startOff, strings, max = 500) {
  const out = []; let p = startOff;
  while (p < buf.length && out.length < max) {
    const before = p;
    const r = readVarint(buf, p);
    if (r.offset === before) break;
    out.push({ value: r.value, offset: before, str: strings.get(r.value) });
    p = r.offset;
  }
  return out;
}

// ── Main ──────────────────────────────────────────────────────────────────────
const filePath = process.argv[2];
if (!filePath) { console.error('Usage: node analyze-post-bmp.js <file>'); process.exit(1); }

const buf = fs.readFileSync(filePath);
const entries = readZipEntries(buf);

const stEntry = entries.find(e => e.filename === '__shared_data_storage_string_table__.auxiliary');
const stData = stEntry ? readEntry(buf, stEntry) : Buffer.alloc(0);
const strings = decodeStringTable(stData);

// Identify UUIDs that ARE POU metas (non-trivial names, known ST identifiers)
const metaEntries = entries.filter(e => e.filename.endsWith('.meta'));

// Only POUs we know
const TARGET_POUS = new Set(['R_TRIG', 'F_TRIG', 'TON', 'TOF', 'TP', 'CTU', 'CTD', 'CTUD', 'RS', 'SR', 'LTP', 'LTON', 'LTOF', 'SEMA']);

for (const me of metaEntries) {
  const data = readEntry(buf, me);
  if (data.length < HEADER_SIZE + 1 || data.readUInt32LE(0) !== META_MAGIC) continue;

  // Read first 7 header varints to get name
  let pos = HEADER_SIZE;
  const hvs = [];
  for (let i = 0; i < 7 && pos < data.length; i++) {
    const r = readVarint(data, pos); hvs.push(r.value); pos = r.offset;
  }
  const name = strings.get(hvs[4]) ?? '';
  if (!TARGET_POUS.has(name)) continue;

  console.log(`\n${'═'.repeat(70)}`);
  console.log(`POU: ${name}  (${me.filename.slice(0,8)}.meta, ${data.length} bytes)`);

  // Find BMP in the raw data (skip header bytes)
  const bmpOff = findBmp(data);
  if (bmpOff < 0) {
    console.log('  No BMP found in this meta file');
    continue;
  }
  const bmpSize = data.readUInt32LE(bmpOff + 2); // BMP filesize field
  const afterBmpOff = bmpOff + bmpSize;

  console.log(`  BMP found at offset 0x${bmpOff.toString(16)} (${bmpOff} bytes in), size=${bmpSize}`);
  console.log(`  After-BMP section starts at 0x${afterBmpOff.toString(16)}, has ${data.length - afterBmpOff} bytes`);

  // Show varints BEFORE the BMP (excluding the header ones we already read)
  console.log(`\n  Varints between header and BMP (offset 0x${pos.toString(16)}..0x${bmpOff.toString(16)}):`);
  const preBmp = readVarints(data, pos, strings, 100);
  for (const [i, v] of preBmp.entries()) {
    if (v.offset >= bmpOff) break;
    const s = v.str !== undefined ? `  → "${v.str}"` : '';
    console.log(`    [${i.toString().padStart(2)}] @${v.offset.toString(16).padStart(4,'0')} = ${v.value.toString().padStart(6)}${s}`);
  }

  // Show ALL varints AFTER the BMP
  if (afterBmpOff >= data.length) {
    console.log('  No data after BMP');
    continue;
  }

  console.log(`\n  Varints AFTER BMP (offset 0x${afterBmpOff.toString(16)}):`);
  const postBmp = readVarints(data, afterBmpOff, strings, 500);
  for (const [i, v] of postBmp.entries()) {
    const s = v.str !== undefined ? `  → "${v.str}"` : '';
    console.log(`    [${i.toString().padStart(3)}] @${v.offset.toString(16).padStart(4,'0')} = ${v.value.toString().padStart(6)}${s}`);
  }

  // Hex dump after BMP
  const tail = data.slice(afterBmpOff);
  if (tail.length > 0) {
    console.log(`\n  Hex dump after BMP (${tail.length} bytes):`);
    for (let i = 0; i < Math.min(tail.length, 256); i += 16) {
      const chunk = tail.slice(i, i + 16);
      const hex = [...chunk].map(b => b.toString(16).padStart(2, '0')).join(' ');
      const asc = [...chunk].map(b => (b >= 0x20 && b <= 0x7e) ? String.fromCharCode(b) : '.').join('');
      console.log(`    ${(afterBmpOff + i).toString(16).padStart(6,'0')}  ${hex.padEnd(48)}  ${asc}`);
    }
  }
}

console.log('\n=== Done ===');
