#!/usr/bin/env node
'use strict';
const zlib = require('zlib');
const fs = require('fs');

const filePath = process.argv[2];
const buf = fs.readFileSync(filePath);

function findEocd(b) {
  for (let i = b.length - 22; i >= 0; i--)
    if (b.readUInt32LE(i) === 0x06054b50) return i;
  return -1;
}
function readZipEntries(b) {
  const eocd = findEocd(b); if (eocd < 0) return [];
  const n = b.readUInt16LE(eocd + 10), cd = b.readUInt32LE(eocd + 16);
  const entries = []; let p = cd;
  for (let i = 0; i < n; i++) {
    if (p + 46 > b.length || b.readUInt32LE(p) !== 0x02014b50) break;
    const method = b.readUInt16LE(p + 10), cs = b.readUInt32LE(p + 20);
    const us = b.readUInt32LE(p + 24), fl = b.readUInt16LE(p + 28);
    const el = b.readUInt16LE(p + 30), cl = b.readUInt16LE(p + 32);
    const lo = b.readUInt32LE(p + 42);
    const fn = b.slice(p + 46, p + 46 + fl).toString('utf8');
    entries.push({ filename: fn, method, cs, us, lo }); p += 46 + fl + el + cl;
  }
  return entries;
}
function readEntry(b, e) {
  const lh = e.lo;
  if (lh + 30 > b.length || b.readUInt32LE(lh) !== 0x04034b50) return Buffer.alloc(0);
  const fl = b.readUInt16LE(lh + 26), el = b.readUInt16LE(lh + 28), ds = lh + 30 + fl + el;
  const cd = b.slice(ds, ds + e.cs);
  if (e.method === 0) return cd;
  if (e.method === 8) { try { return zlib.inflateRawSync(cd); } catch { return Buffer.alloc(0); } }
  return Buffer.alloc(0);
}

const entries = readZipEntries(buf);
// Find largest object file (the root)
const objEntries = entries.filter(e => e.filename.endsWith('.object'));
const rootObj = objEntries.sort((a, b) => b.us - a.us)[0];
console.error('Root object:', rootObj.filename, rootObj.us, 'bytes');

const data = readEntry(buf, rootObj);
const bomIdx = data.indexOf(Buffer.from([0xff, 0xfe]));
console.error('BOM at offset:', bomIdx);

if (bomIdx >= 0) {
  const xmlBuf = data.slice(bomIdx);
  const xmlText = xmlBuf.toString('utf16le');
  process.stdout.write(xmlText);
}
